-- 0001_publications_table.sql
-- Table des publications (journaux) du lecteur TomsoFoot.
-- ISOLÉE du jeu : ne touche à aucune table Jogadle / classement / comptes.
-- À appliquer dans le SQL editor Supabase OU via `supabase db push`.

create extension if not exists "pgcrypto";

do $$ begin
  create type public.publication_status as enum ('draft','scheduled','published','archived');
exception when duplicate_object then null; end $$;

create table if not exists public.publications (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  title            text not null,
  subtitle         text,
  excerpt          text,
  issue_number     integer,
  publication_date date,
  published_at     timestamptz,          -- visible à partir de cette date (programmation)
  status           public.publication_status not null default 'draft',
  cover_url        text,
  thumbnail_url    text,
  pdf_url          text not null,        -- URL publique (bucket) ou chemin repo
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

comment on table public.publications is 'Journaux TomsoFoot feuilletables dans le lecteur (module magazine, isolé du jeu).';

-- Un seul numéro "à la une" à la fois (index partiel unique).
create unique index if not exists publications_single_featured
  on public.publications (featured) where featured = true;

create index if not exists publications_status_date_idx
  on public.publications (status, published_at desc);

-- Met à jour updated_at automatiquement.
create or replace function public.tg_publications_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists publications_updated_at on public.publications;
create trigger publications_updated_at
  before update on public.publications
  for each row execute function public.tg_publications_updated_at();

-- Vue publique : uniquement ce qui est réellement visible (published/scheduled échu,
-- ou archived). Le client anonyme lit cette vue (ou la table via RLS, cf. 0002).
create or replace view public.publications_public as
  select id, slug, title, subtitle, excerpt, issue_number, publication_date,
         status, cover_url, thumbnail_url, pdf_url, pdf_version, page_count,
         featured, download_enabled, alt_text
  from public.publications
  where status = 'archived'
     or (status = 'published' and (published_at is null or published_at <= now()))
     or (status = 'scheduled' and published_at is not null and published_at <= now());
