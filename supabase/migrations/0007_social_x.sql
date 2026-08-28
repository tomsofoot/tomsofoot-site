-- 0007_social_x.sql  (VERSION DURCIE — staging)
-- Automatisation « article publié → publication X (Twitter) après délai ».
--
-- GARANTIES :
--   * 100 % ADDITIF / NON DESTRUCTIF : ne crée que des objets NEUFS (social_*, x_*).
--     Ne modifie/supprime AUCUN objet existant. Ajoute UN trigger sur public.articles,
--     au corps PROTÉGÉ : la publication d'un article ne peut jamais échouer à cause
--     de l'automatisation (mais l'erreur d'enqueue est désormais TRACÉE, pas masquée).
--   * IDEMPOTENT : rejouable sans erreur ni doublon.
--   * Réutilise public.is_current_user_admin() (définie par le prérequis staging 0000).
--   * TRAÇABILITÉ : l'historique social_posts SURVIT à la suppression d'un article
--     (article_id nullable + ON DELETE SET NULL + snapshot titre/slug/URL).
--   * SÉCURITÉ : jetons X jamais lisibles par anon/authenticated ; fonctions
--     SECURITY DEFINER durcies (search_path vide + objets qualifiés par schéma).
--   * ANTI-DOUBLON : index unique partiel (article_id, platform) tant que article_id existe.
--
-- Dépendances (doivent exister AVANT) : public.articles, public.article_versions,
--   public.is_current_user_admin(). Voir la procédure de build staging.

create extension if not exists "pgcrypto";

-- =====================================================================
-- 0) Enum de statut des tâches sociales
-- =====================================================================
do $$ begin
  create type public.social_post_status as enum ('scheduled','processing','published','failed','cancelled');
exception when duplicate_object then null; end $$;

-- =====================================================================
-- 1) Réglages globaux de l'automatisation (une seule ligne)
--    + traçabilité de la dernière erreur d'enqueue (visible en régie).
-- =====================================================================
create table if not exists public.social_settings (
  id                  boolean primary key default true,            -- singleton : toujours true
  x_enabled           boolean not null default false,              -- interrupteur « Publication automatique sur X »
  delay_minutes       int     not null default 10 check (delay_minutes between 0 and 1440),
  last_enqueue_error  text,                                        -- dernier échec du trigger d'enqueue (sans secret)
  last_enqueue_error_at timestamptz,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id) on delete set null,
  constraint social_settings_singleton check (id = true)
);
insert into public.social_settings (id) values (true) on conflict (id) do nothing;
-- Rejeu : ajoute les colonnes de traçabilité si la table existait déjà sans elles.
alter table public.social_settings add column if not exists last_enqueue_error text;
alter table public.social_settings add column if not exists last_enqueue_error_at timestamptz;

-- =====================================================================
-- 2) Compte X connecté (une seule ligne). Jetons = CHIFFRÉS opaques.
--    Base table VERROUILLÉE : aucun accès anon/authenticated (service_role only).
-- =====================================================================
create table if not exists public.x_account (
  id                 boolean primary key default true,             -- singleton
  x_user_id          text,
  username           text,
  name               text,
  avatar_url         text,
  scopes             text,
  access_token_enc   text,                                         -- AES-GCM (clé côté Netlify, jamais en base)
  refresh_token_enc  text,
  token_expires_at   timestamptz,
  status             text not null default 'disconnected'
                     check (status in ('connected','reconnect_needed','disconnected')),
  connected_at       timestamptz,
  updated_at         timestamptz not null default now(),
  constraint x_account_singleton check (id = true)
);
insert into public.x_account (id) values (true) on conflict (id) do nothing;

-- État éphémère de l'échange OAuth (PKCE). service_role only.
-- Expiration courte + usage unique (supprimé après consommation) + nettoyage des états expirés.
create table if not exists public.x_oauth_state (
  state          text primary key,
  code_verifier  text not null,
  redirect_uri   text not null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default (now() + interval '10 minutes'),
  created_by     uuid references auth.users(id) on delete set null
);
-- Rejeu : ajoute expires_at si la table préexistait sans.
alter table public.x_oauth_state add column if not exists expires_at timestamptz not null default (now() + interval '10 minutes');
create index if not exists x_oauth_state_expires_idx on public.x_oauth_state (expires_at);

-- =====================================================================
-- 3) File d'attente des tâches sociales — l'historique SURVIT à l'article.
--    article_id NULLABLE + ON DELETE SET NULL. Snapshot minimal conservé.
-- =====================================================================
create table if not exists public.social_posts (
  id             uuid primary key default gen_random_uuid(),
  article_id     uuid references public.articles(id) on delete set null,   -- NULLABLE : préserve l'historique
  platform       text not null default 'x',
  status         public.social_post_status not null default 'scheduled',
  -- Snapshot minimal (identité de l'article au moment de la tâche) : survit à la suppression.
  article_title  text,
  article_slug   text,
  article_url    text,
  scheduled_at   timestamptz not null,
  published_at   timestamptz,
  attempt_count  int not null default 0,
  last_error     text,
  x_post_id      text,
  x_post_url     text,
  dry_run        boolean not null default false,
  preview        jsonb,
  article_version uuid references public.article_versions(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- Rejeu : si une version antérieure avait article_id NOT NULL / ON DELETE CASCADE / contrainte unique,
-- on aligne sans perdre de données.
alter table public.social_posts add column if not exists article_title text;
alter table public.social_posts add column if not exists article_slug  text;
alter table public.social_posts add column if not exists article_url   text;
alter table public.social_posts alter column article_id drop not null;
do $$ begin
  alter table public.social_posts drop constraint if exists social_posts_unique_article_platform;
exception when others then null; end $$;
do $$ begin
  alter table public.social_posts drop constraint social_posts_article_id_fkey;
exception when others then null; end $$;
do $$ begin
  alter table public.social_posts
    add constraint social_posts_article_id_fkey
    foreign key (article_id) references public.articles(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ANTI-DOUBLON : unique UNIQUEMENT tant que l'article existe (article_id non null).
-- Après suppression de l'article (article_id devient null), la ligne d'historique reste,
-- et n'entre plus en conflit (plusieurs null autorisés).
create unique index if not exists social_posts_unique_active_article
  on public.social_posts (article_id, platform) where article_id is not null;
create index if not exists social_posts_due_idx on public.social_posts (status, scheduled_at);
create index if not exists social_posts_article_idx on public.social_posts (article_id);

-- updated_at automatique (trigger durci : search_path vide).
create or replace function public.tg_touch_updated_at_social() returns trigger
language plpgsql security definer set search_path = '' as $$
begin new.updated_at = pg_catalog.now(); return new; end $$;
revoke all on function public.tg_touch_updated_at_social() from public, anon, authenticated;

drop trigger if exists social_posts_touch on public.social_posts;
create trigger social_posts_touch before update on public.social_posts for each row execute function public.tg_touch_updated_at_social();
drop trigger if exists social_settings_touch on public.social_settings;
create trigger social_settings_touch before update on public.social_settings for each row execute function public.tg_touch_updated_at_social();
drop trigger if exists x_account_touch on public.x_account;
create trigger x_account_touch before update on public.x_account for each row execute function public.tg_touch_updated_at_social();

-- =====================================================================
-- 4) Enqueue automatique à la publication d'un article
--    * fire quand l'article DEVIENT publié
--    * délai = social_settings.delay_minutes (défaut 10)
--    * enregistre le SNAPSHOT (titre + slug) pour la traçabilité
--    * anti-doublon via l'index unique partiel (ON CONFLICT DO NOTHING)
--    * PUBLICATION PRIORITAIRE : toute erreur est rattrapée pour ne jamais bloquer
--      la publication de l'article, MAIS elle est TRACÉE (RAISE WARNING + social_settings).
--    * DURCIE : SECURITY DEFINER, search_path vide, objets qualifiés par schéma.
-- =====================================================================
create or replace function public.tg_articles_social_enqueue() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_delay int;
begin
  begin
    -- Annulation : l'article n'est plus publié → on annule la tâche non encore envoyée
    if tg_op = 'UPDATE'
       and pg_catalog.coalesce(old.status::text,'') = 'published'
       and pg_catalog.coalesce(new.status::text,'') <> 'published' then
      update public.social_posts
         set status = 'cancelled',
             last_error = 'Article dépublié avant l''envoi'
       where article_id = new.id and platform = 'x' and status = 'scheduled';
      return new;
    end if;

    -- Enqueue : l'article devient publié
    if pg_catalog.coalesce(new.status::text,'') = 'published' and new.published_at is not null
       and ( tg_op = 'INSERT'
             or pg_catalog.coalesce(old.status::text,'') <> 'published'
             or old.published_at is distinct from new.published_at ) then
      select delay_minutes into v_delay from public.social_settings where id = true;
      insert into public.social_posts (article_id, platform, status, scheduled_at, article_title, article_slug)
      values (new.id, 'x', 'scheduled',
              new.published_at + pg_catalog.make_interval(mins => pg_catalog.coalesce(v_delay,10)),
              new.title, new.slug)
      on conflict (article_id, platform) where article_id is not null do nothing;
    end if;
  exception when others then
    -- PUBLICATION PRIORITAIRE : on ne bloque jamais l'article...
    -- ...mais on ne masque plus l'erreur : trace log + état visible en régie (sans secret).
    raise warning 'social_enqueue: echec pour article % : %', new.id, sqlerrm;
    begin
      update public.social_settings
         set last_enqueue_error = 'Article '||new.id::text||' : '||left(sqlerrm, 200),
             last_enqueue_error_at = pg_catalog.now()
       where id = true;
    exception when others then null; end;
  end;
  return new;
end $$;
revoke all on function public.tg_articles_social_enqueue() from public, anon, authenticated;

drop trigger if exists articles_social_enqueue on public.articles;
create trigger articles_social_enqueue after insert or update on public.articles
  for each row execute function public.tg_articles_social_enqueue();

-- =====================================================================
-- 5) Vue publique du compte X : SANS AUCUN JETON (pour l'affichage régie serveur)
-- =====================================================================
create or replace view public.x_account_public as
  select x_user_id, username, name, avatar_url, scopes, token_expires_at, status, connected_at, updated_at
  from public.x_account where id = true;

-- =====================================================================
-- 6) RLS
-- =====================================================================
alter table public.social_posts   enable row level security;
alter table public.social_settings enable row level security;
alter table public.x_account       enable row level security;
alter table public.x_oauth_state   enable row level security;

drop policy if exists social_posts_read_admin on public.social_posts;
create policy social_posts_read_admin on public.social_posts for select to authenticated
  using (public.is_current_user_admin());
drop policy if exists social_posts_write_admin on public.social_posts;
create policy social_posts_write_admin on public.social_posts for all to authenticated
  using (public.is_current_user_admin()) with check (public.is_current_user_admin());

drop policy if exists social_settings_rw_admin on public.social_settings;
create policy social_settings_rw_admin on public.social_settings for all to authenticated
  using (public.is_current_user_admin()) with check (public.is_current_user_admin());

-- x_account / x_oauth_state : AUCUNE policy → tout refusé pour anon/authenticated.
-- Seul le service_role (fonctions Netlify) y accède (il contourne la RLS).

-- La vue x_account_public n'est lue que côté serveur (service_role). On ne l'expose PAS.
revoke all on public.x_account_public from anon, authenticated;

-- =====================================================================
-- 7) Aide admin : annulation manuelle. SECURITY DEFINER durcie.
-- =====================================================================
create or replace function public.social_cancel(p_id uuid)
returns public.social_posts language plpgsql security definer set search_path = '' as $$
declare r public.social_posts;
begin
  if not public.is_current_user_admin() then raise exception 'not_admin'; end if;
  update public.social_posts set status='cancelled', last_error='Annulé manuellement'
    where id=p_id and status in ('scheduled','failed') returning * into r;
  return r;
end $$;

-- =====================================================================
-- 8) GRANT / REVOKE explicites (droits minimaux)
-- =====================================================================
-- Fonctions trigger : jamais appelables directement.
revoke all on function public.tg_articles_social_enqueue() from public, anon, authenticated;
revoke all on function public.tg_touch_updated_at_social() from public, anon, authenticated;
-- social_cancel : réservé aux authentifiés, ET protégé par le contrôle admin interne.
revoke all on function public.social_cancel(uuid) from public, anon;
grant execute on function public.social_cancel(uuid) to authenticated;

-- Fin 0007_social_x.sql
