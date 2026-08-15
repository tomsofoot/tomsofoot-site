-- 0005_articles.sql  (VERSION FINALE)
-- Système d'ARTICLES HTML + DOSSIERS de TomsoFoot, indépendant des journaux PDF.
--
-- GARANTIES (identiques à la v1, étendues) :
--   * 100 % ADDITIF : ne modifie/supprime AUCUN objet existant. Ne crée que des
--     objets NEUFS (articles*, dossiers, editorial_*, competitions, article_*,
--     editorial_seq) + colonnes ADDITIVES sur publications (add column if not exists).
--   * IDEMPOTENT / rejouable sans erreur ni doublon. Aucune suppression destructive.
--   * Réutilise public.is_current_user_admin() (NON redéfinie). N'utilise PAS l'enum
--     partagé publication_status : crée un enum DÉDIÉ public.article_status.
--   * Aucune clé service_role. RLS : lecture publique du publié/archivé, écriture admin.
--   * Publication/enregistrement TRANSACTIONNELS via RPC (aucune sauvegarde partielle).
--
-- ISOLATION : ne touche à AUCUNE table Jogadle / classement / points / comptes, ni au
-- lecteur PDF. La table publications (journaux) n'est QUE complétée de colonnes nullables.

create extension if not exists "pgcrypto";

-- =====================================================================
-- 0) Enum de statut DÉDIÉ aux articles (ajoute 'unpublished')
-- =====================================================================
do $$ begin
  create type public.article_status as enum ('draft','scheduled','published','unpublished','archived');
exception when duplicate_object then null; end $$;

-- =====================================================================
-- 1) Taxonomie canonique
-- =====================================================================
create table if not exists public.editorial_zones  (id text primary key, label_fr text not null, position int not null default 0);
create table if not exists public.competitions      (id text primary key, label_fr text not null, zone_id text references public.editorial_zones(id), position int not null default 0);
create table if not exists public.editorial_genres  (id text primary key, label_fr text not null, position int not null default 0);

insert into public.editorial_zones (id,label_fr,position) values
  ('angleterre','Angleterre',1),('france','France',2),('italie','Italie',3),('espagne','Espagne',4),
  ('allemagne','Allemagne',5),('europe','Europe',6),('international','International',7)
on conflict (id) do nothing;
insert into public.competitions (id,label_fr,zone_id,position) values
  ('premier-league','Premier League','angleterre',1),('ligue-1','Ligue 1','france',2),('serie-a','Serie A','italie',3),
  ('liga','Liga','espagne',4),('bundesliga','Bundesliga','allemagne',5),('ligue-des-champions','Ligue des champions','europe',6),
  ('ligue-europa','Ligue Europa','europe',7),('coupe-du-monde','Coupe du monde','international',8)
on conflict (id) do nothing;
insert into public.editorial_genres (id,label_fr,position) values
  ('actualite','Actualité',1),('analyse','Analyse',2),('entretien','Entretien',3),('reportage','Reportage',4),
  ('histoire','Histoire',5),('recit','Récit',6),('edito','Édito',7)
on conflict (id) do nothing;

-- =====================================================================
-- 2) Identifiant éditorial auto (TSF-ART-AAAAMMJJ-NNNN / TSF-DOS-…)
-- =====================================================================
create table if not exists public.editorial_seq (d date, kind text, n integer not null default 0, primary key (d,kind));
-- RLS activé SANS policy : table de compteur interne, inaccessible via l'API (anon/authenticated).
-- gen_editorial_id() est security definer, donc les triggers y accèdent malgré RLS.
alter table public.editorial_seq enable row level security;
create or replace function public.gen_editorial_id(p_kind text) returns text language plpgsql security definer set search_path=public as $$
declare d date := (now() at time zone 'Europe/Paris')::date; c int;
begin
  insert into public.editorial_seq(d,kind,n) values (d,p_kind,1)
    on conflict (d,kind) do update set n = public.editorial_seq.n + 1 returning n into c;
  return 'TSF-'||p_kind||'-'||to_char(d,'YYYYMMDD')||'-'||lpad(c::text,4,'0');
end $$;

-- =====================================================================
-- 3) Dossiers
-- =====================================================================
create table if not exists public.dossiers (
  id uuid primary key default gen_random_uuid(),
  editorial_id  text unique,
  slug text not null unique,
  title text not null,
  intro text,
  description text,
  cover_image text,
  status public.article_status not null default 'draft',
  featured boolean not null default false,
  publication_id uuid references public.publications(id) on delete set null,  -- lien FACULTATIF vers un journal
  zone_id text references public.editorial_zones(id),
  competition_id text references public.competitions(id),
  genre_id text references public.editorial_genres(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint dossiers_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
comment on table public.dossiers is 'Dossiers éditoriaux TomsoFoot (regroupent des articles-chapitres). Lien facultatif à un journal PDF.';
create unique index if not exists dossiers_single_featured on public.dossiers (featured) where featured = true;

-- =====================================================================
-- 4) Articles
-- =====================================================================
create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  editorial_id  text unique,
  slug text not null unique,
  title text not null,
  deck text,
  hero_image text, hero_alt text, hero_caption text, hero_credit text, hero_cover boolean not null default false,
  author text,
  status public.article_status not null default 'draft',
  published_at timestamptz, scheduled_at timestamptz,
  featured boolean not null default false,
  reading_time int,
  seo_title text, seo_description text, og_image text,
  zone_id text references public.editorial_zones(id),
  competition_id text references public.competitions(id),
  genre_id text references public.editorial_genres(id),
  dossier_id uuid references public.dossiers(id) on delete set null,
  chapter_position int,
  chapter_label text,
  journal_slug text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint articles_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
comment on table public.articles is 'Articles HTML natifs TomsoFoot. Indépendants des journaux PDF. Isolé du jeu.';
create unique index if not exists articles_single_featured on public.articles (featured) where featured = true;
create index if not exists articles_status_pub_idx on public.articles (status, published_at desc);
create index if not exists articles_dossier_idx on public.articles (dossier_id, chapter_position);
create index if not exists articles_zone_idx on public.articles (zone_id);
create index if not exists articles_competition_idx on public.articles (competition_id);
create index if not exists articles_genre_idx on public.articles (genre_id);

-- =====================================================================
-- 5) Blocs, versions, suggestions manuelles
-- =====================================================================
create table if not exists public.article_blocks (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  position int not null,
  type text not null,
  content jsonb not null default '{}'::jsonb,
  constraint article_blocks_type_chk check (type in
    ('paragraph','heading','subheading','image','spacer','quote','stats','table','video','embed','divider','related','continue'))
);
create index if not exists article_blocks_article_pos_idx on public.article_blocks (article_id, position);

create table if not exists public.article_versions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  label text,
  snapshot jsonb not null,     -- { article:{...}, blocks:[...] } (métadonnées + intégralité des blocs)
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists article_versions_article_idx on public.article_versions (article_id, created_at desc);

create table if not exists public.article_related (
  article_id uuid not null references public.articles(id) on delete cascade,
  related_id uuid not null references public.articles(id) on delete cascade,
  position int not null default 0,
  primary key (article_id, related_id)
);

-- =====================================================================
-- 6) Colonnes ADDITIVES sur publications (format détecté du journal) — nullable, sans défaut lourd
-- =====================================================================
alter table public.publications add column if not exists format_label text;
alter table public.publications add column if not exists orientation  text;
alter table public.publications add column if not exists ratio        numeric;
alter table public.publications add column if not exists page_w        numeric;
alter table public.publications add column if not exists page_h        numeric;
alter table public.publications add column if not exists dossier_id    uuid references public.dossiers(id) on delete set null;

-- =====================================================================
-- 7) Triggers : updated_at + génération editorial_id
-- =====================================================================
create or replace function public.tg_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists articles_touch on public.articles;
create trigger articles_touch before update on public.articles for each row execute function public.tg_touch_updated_at();
drop trigger if exists dossiers_touch on public.dossiers;
create trigger dossiers_touch before update on public.dossiers for each row execute function public.tg_touch_updated_at();

create or replace function public.tg_articles_edid() returns trigger language plpgsql as $$
begin if new.editorial_id is null then new.editorial_id := public.gen_editorial_id('ART'); end if; return new; end $$;
drop trigger if exists articles_edid on public.articles;
create trigger articles_edid before insert on public.articles for each row execute function public.tg_articles_edid();

create or replace function public.tg_dossiers_edid() returns trigger language plpgsql as $$
begin if new.editorial_id is null then new.editorial_id := public.gen_editorial_id('DOS'); end if; return new; end $$;
drop trigger if exists dossiers_edid on public.dossiers;
create trigger dossiers_edid before insert on public.dossiers for each row execute function public.tg_dossiers_edid();

-- =====================================================================
-- 8) RLS — lecture publique du visible, écriture admin
-- =====================================================================
alter table public.articles         enable row level security;
alter table public.article_blocks   enable row level security;
alter table public.article_versions enable row level security;
alter table public.article_related  enable row level security;
alter table public.dossiers         enable row level security;
alter table public.editorial_zones  enable row level security;
alter table public.competitions     enable row level security;
alter table public.editorial_genres enable row level security;

drop policy if exists articles_read_public on public.articles;
create policy articles_read_public on public.articles for select to anon, authenticated
using ( status='archived'
   or (status='published' and (published_at is null or published_at <= now()))
   or (status='scheduled' and published_at is not null and published_at <= now())
   or public.is_current_user_admin() );
drop policy if exists articles_write_admin on public.articles;
create policy articles_write_admin on public.articles for all to authenticated
using (public.is_current_user_admin()) with check (public.is_current_user_admin());

drop policy if exists dossiers_read_public on public.dossiers;
create policy dossiers_read_public on public.dossiers for select to anon, authenticated
using ( status='archived' or (status='published' and (published_at is null or published_at <= now())) or public.is_current_user_admin() );
drop policy if exists dossiers_write_admin on public.dossiers;
create policy dossiers_write_admin on public.dossiers for all to authenticated
using (public.is_current_user_admin()) with check (public.is_current_user_admin());

drop policy if exists article_blocks_read_public on public.article_blocks;
create policy article_blocks_read_public on public.article_blocks for select to anon, authenticated
using (exists (select 1 from public.articles a where a.id=article_blocks.article_id and (
  a.status='archived' or (a.status='published' and (a.published_at is null or a.published_at<=now()))
  or (a.status='scheduled' and a.published_at is not null and a.published_at<=now()) or public.is_current_user_admin())));
drop policy if exists article_blocks_write_admin on public.article_blocks;
create policy article_blocks_write_admin on public.article_blocks for all to authenticated
using (public.is_current_user_admin()) with check (public.is_current_user_admin());

drop policy if exists article_versions_admin on public.article_versions;
create policy article_versions_admin on public.article_versions for all to authenticated
using (public.is_current_user_admin()) with check (public.is_current_user_admin());
drop policy if exists article_related_read on public.article_related;
create policy article_related_read on public.article_related for select to anon, authenticated using (true);
drop policy if exists article_related_write on public.article_related;
create policy article_related_write on public.article_related for all to authenticated
using (public.is_current_user_admin()) with check (public.is_current_user_admin());

drop policy if exists tax_zones_read on public.editorial_zones;  create policy tax_zones_read on public.editorial_zones for select to anon, authenticated using (true);
drop policy if exists tax_zones_write on public.editorial_zones; create policy tax_zones_write on public.editorial_zones for all to authenticated using (public.is_current_user_admin()) with check (public.is_current_user_admin());
drop policy if exists tax_comp_read on public.competitions;      create policy tax_comp_read on public.competitions for select to anon, authenticated using (true);
drop policy if exists tax_comp_write on public.competitions;     create policy tax_comp_write on public.competitions for all to authenticated using (public.is_current_user_admin()) with check (public.is_current_user_admin());
drop policy if exists tax_genre_read on public.editorial_genres; create policy tax_genre_read on public.editorial_genres for select to anon, authenticated using (true);
drop policy if exists tax_genre_write on public.editorial_genres;create policy tax_genre_write on public.editorial_genres for all to authenticated using (public.is_current_user_admin()) with check (public.is_current_user_admin());

-- =====================================================================
-- 9) Vues publiques
-- =====================================================================
create or replace view public.articles_public as
  select id,editorial_id,slug,title,deck,hero_image,hero_alt,hero_caption,hero_credit,hero_cover,author,status,
         published_at,featured,reading_time,seo_title,seo_description,og_image,zone_id,competition_id,genre_id,
         dossier_id,chapter_position,chapter_label,journal_slug,updated_at
  from public.articles
  where status='archived' or (status='published' and (published_at is null or published_at <= now()));

create or replace view public.dossiers_public as
  select id,editorial_id,slug,title,intro,description,cover_image,status,featured,publication_id,
         zone_id,competition_id,genre_id,published_at,updated_at
  from public.dossiers
  where status='archived' or (status='published' and (published_at is null or published_at <= now()));

-- =====================================================================
-- 10) Bucket de stockage 'articles' (AVIF autorisé pour l'avenir)
-- =====================================================================
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('articles','articles',true,26214400,array['image/webp','image/avif','image/jpeg','image/png'])
on conflict (id) do update set public=excluded.public, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists articles_obj_read   on storage.objects; create policy articles_obj_read   on storage.objects for select to anon, authenticated using (bucket_id='articles');
drop policy if exists articles_obj_write  on storage.objects; create policy articles_obj_write  on storage.objects for insert to authenticated with check (bucket_id='articles' and public.is_current_user_admin());
drop policy if exists articles_obj_update on storage.objects; create policy articles_obj_update on storage.objects for update to authenticated using (bucket_id='articles' and public.is_current_user_admin()) with check (bucket_id='articles' and public.is_current_user_admin());
drop policy if exists articles_obj_delete on storage.objects; create policy articles_obj_delete on storage.objects for delete to authenticated using (bucket_id='articles' and public.is_current_user_admin());

-- =====================================================================
-- 11) RPC TRANSACTIONNELS (aucune sauvegarde/publication partielle)
--     security definer + contrôle admin explicite à l'intérieur.
-- =====================================================================
create or replace function public.save_article(p_article jsonb, p_blocks jsonb)
returns public.articles language plpgsql security definer set search_path=public as $$
declare a public.articles; b jsonb; i int := 0;
begin
  if not public.is_current_user_admin() then raise exception 'not_admin'; end if;
  insert into public.articles as t (
    id,slug,title,deck,hero_image,hero_alt,hero_caption,hero_credit,hero_cover,author,status,published_at,scheduled_at,
    featured,reading_time,seo_title,seo_description,og_image,zone_id,competition_id,genre_id,dossier_id,chapter_position,chapter_label,journal_slug)
  values (
    coalesce((p_article->>'id')::uuid, gen_random_uuid()),
    p_article->>'slug', p_article->>'title', p_article->>'deck',
    p_article->>'hero_image', p_article->>'hero_alt', p_article->>'hero_caption', p_article->>'hero_credit',
    coalesce((p_article->>'hero_cover')::bool,false), p_article->>'author',
    coalesce((p_article->>'status')::public.article_status,'draft'),
    (p_article->>'published_at')::timestamptz, (p_article->>'scheduled_at')::timestamptz,
    coalesce((p_article->>'featured')::bool,false), (p_article->>'reading_time')::int,
    p_article->>'seo_title', p_article->>'seo_description', p_article->>'og_image',
    p_article->>'zone_id', p_article->>'competition_id', p_article->>'genre_id',
    (p_article->>'dossier_id')::uuid, (p_article->>'chapter_position')::int, p_article->>'chapter_label', p_article->>'journal_slug')
  on conflict (id) do update set
    slug=excluded.slug,title=excluded.title,deck=excluded.deck,hero_image=excluded.hero_image,hero_alt=excluded.hero_alt,
    hero_caption=excluded.hero_caption,hero_credit=excluded.hero_credit,hero_cover=excluded.hero_cover,author=excluded.author,
    status=excluded.status,published_at=excluded.published_at,scheduled_at=excluded.scheduled_at,featured=excluded.featured,
    reading_time=excluded.reading_time,seo_title=excluded.seo_title,seo_description=excluded.seo_description,og_image=excluded.og_image,
    zone_id=excluded.zone_id,competition_id=excluded.competition_id,genre_id=excluded.genre_id,dossier_id=excluded.dossier_id,
    chapter_position=excluded.chapter_position,chapter_label=excluded.chapter_label,journal_slug=excluded.journal_slug
  returning * into a;
  -- blocs : remplacement atomique
  delete from public.article_blocks where article_id = a.id;
  if p_blocks is not null then
    for b in select * from jsonb_array_elements(p_blocks) loop
      insert into public.article_blocks(article_id,position,type,content)
      values (a.id, i, b->>'type', coalesce(b->'content','{}'::jsonb));
      i := i + 1;
    end loop;
  end if;
  return a;
end $$;

create or replace function public.publish_article(p_id uuid, p_featured boolean default false, p_when timestamptz default now())
returns public.articles language plpgsql security definer set search_path=public as $$
declare a public.articles;
begin
  if not public.is_current_user_admin() then raise exception 'not_admin'; end if;
  update public.articles set status='published', published_at=coalesce(p_when,now()) where id=p_id returning * into a;
  if a.id is null then raise exception 'article_not_found'; end if;
  if p_featured then
    update public.articles set featured=false where featured=true and id<>p_id;   -- l'ancien reste 'published'
    update public.articles set featured=true  where id=p_id;
  end if;
  insert into public.article_versions(article_id,label,snapshot,created_by)
  values (a.id, 'publication', jsonb_build_object(
            'article', to_jsonb(a),
            'blocks', coalesce((select jsonb_agg(jsonb_build_object('type',type,'content',content) order by position) from public.article_blocks where article_id=a.id),'[]'::jsonb)),
          auth.uid());
  return a;
end $$;

revoke all on function public.save_article(jsonb,jsonb) from anon;
revoke all on function public.publish_article(uuid,boolean,timestamptz) from anon;
grant execute on function public.save_article(jsonb,jsonb) to authenticated;
grant execute on function public.publish_article(uuid,boolean,timestamptz) to authenticated;

-- Fin 0005_articles.sql (final)
