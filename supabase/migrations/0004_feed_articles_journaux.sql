-- 0004_feed_articles_journaux.sql
-- Fil unifié « Articles & journaux » de TomsoFoot.
-- Objectif : la régie glisser-déposer publie des IMAGES (articles) et des PDF
-- (journaux Canva). Le plus récent passe « à la une », les précédents glissent
-- dans l'encart « Articles et journaux précédents » (triable par mois/année).
--
-- ISOLATION : ne touche à AUCUNE table Jogadle / classement / points / comptes.
-- N'ajoute que ce qui est nécessaire au module publications (table + bucket).
-- Idempotent : peut être ré-exécuté sans risque (create/alter ... if not exists).
-- Contrôle admin : réutilise la fonction EXISTANTE public.is_current_user_admin()
-- (même vérification que tes régies actuelles). Aucune clé service_role côté client.

create extension if not exists "pgcrypto";

-- 1) Type de statut (réutilisé si déjà créé par 0001).
do $$ begin
  create type public.publication_status as enum ('draft','scheduled','published','archived');
exception when duplicate_object then null; end $$;

-- 2) Table (créée si absente ; sinon complétée par les ALTER plus bas).
create table if not exists public.publications (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  title            text not null,
  subtitle         text,
  excerpt          text,
  issue_number     integer,
  publication_date date,
  published_at     timestamptz,
  status           public.publication_status not null default 'published',
  cover_url        text,
  thumbnail_url    text,
  pdf_url          text,
  pdf_version      text not null default 'v1',
  page_count       integer,
  featured         boolean not null default false,
  download_enabled boolean not null default true,
  alt_text         text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null,
  constraint slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

comment on table public.publications is 'Fil unifié TomsoFoot : articles (image) et journaux (PDF feuilletable). Isolé du jeu.';

-- 3) Colonnes ajoutées par CE fil unifié (sans casser une table 0001 existante).
alter table public.publications add column if not exists kind        text not null default 'journal';
alter table public.publications add column if not exists category    text;         -- ex. « Grand format », « Chronique »
alter table public.publications add column if not exists link_url    text;         -- lien externe optionnel (article Canva, etc.)
alter table public.publications add column if not exists sort_date   date;         -- jour de publication (classement mois/année)

-- Un article n'a pas forcément de PDF : on relâche la contrainte NOT NULL si 0001 l'avait posée.
alter table public.publications alter column pdf_url drop not null;

-- kind ∈ {article, journal}
do $$ begin
  alter table public.publications
    add constraint publications_kind_chk check (kind in ('article','journal'));
exception when duplicate_object then null; end $$;

-- Renseigne sort_date pour les lignes existantes (jour de publication).
update public.publications
   set sort_date = coalesce(sort_date, publication_date, (published_at at time zone 'UTC')::date, created_at::date)
 where sort_date is null;

-- 4) Un seul élément « à la une » à la fois.
create unique index if not exists publications_single_featured
  on public.publications (featured) where featured = true;

create index if not exists publications_feed_idx
  on public.publications (sort_date desc, published_at desc);

-- 5) updated_at automatique.
create or replace function public.tg_publications_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists publications_updated_at on public.publications;
create trigger publications_updated_at
  before update on public.publications
  for each row execute function public.tg_publications_updated_at();

-- 6) RLS : lecture publique des éléments visibles ; écriture ADMIN uniquement.
alter table public.publications enable row level security;

drop policy if exists publications_read_public on public.publications;
create policy publications_read_public
  on public.publications for select
  to anon, authenticated
  using (
    status = 'archived'
    or (status = 'published' and (published_at is null or published_at <= now()))
    or (status = 'scheduled' and published_at is not null and published_at <= now())
    or public.is_current_user_admin()   -- l'admin voit aussi brouillons/programmés
  );

drop policy if exists publications_write_admin on public.publications;
create policy publications_write_admin
  on public.publications for all
  to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

-- 7) Bucket de stockage public (lecture) ; écriture réservée à l'admin.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'publications', 'publications', true,
  52428800,                                   -- 50 Mo max / fichier
  array['application/pdf','image/webp','image/jpeg','image/png']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists publications_obj_read on storage.objects;
create policy publications_obj_read
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'publications');

drop policy if exists publications_obj_write on storage.objects;
create policy publications_obj_write
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'publications' and public.is_current_user_admin());

drop policy if exists publications_obj_update on storage.objects;
create policy publications_obj_update
  on storage.objects for update
  to authenticated
  using (bucket_id = 'publications' and public.is_current_user_admin())
  with check (bucket_id = 'publications' and public.is_current_user_admin());

drop policy if exists publications_obj_delete on storage.objects;
create policy publications_obj_delete
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'publications' and public.is_current_user_admin());

-- Organisation conseillée des chemins :
--   publications/2026/08/<slug>/journal-v1.pdf
--   publications/2026/08/<slug>/couverture.webp
--   publications/2026/08/<slug>/image.webp   (article)
