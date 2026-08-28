-- 0007_social_x.sql
-- Automatisation « article publié → publication X (Twitter) 10 min après ».
--
-- GARANTIES (mêmes principes que 0005/0006) :
--   * 100 % ADDITIF / NON DESTRUCTIF : ne crée que des objets NEUFS (social_*, x_*).
--     Ne modifie/supprime AUCUN objet existant. Ajoute UN trigger sur public.articles,
--     dont le corps est ENTIÈREMENT protégé (exception → NULL) : la publication d'un
--     article ne peut JAMAIS échouer à cause de l'automatisation X.
--   * IDEMPOTENT : rejouable sans erreur ni doublon.
--   * Réutilise public.is_current_user_admin() (NON redéfinie).
--   * SÉCURITÉ : les jetons X ne sont JAMAIS lisibles par anon/authenticated.
--     La régie (admin) ne voit que la VUE public.x_account_public (sans aucun jeton).
--     Les jetons stockés sont des chiffrés opaques (AES-GCM côté fonction Netlify) :
--     la base ne détient ni la clé ni le clair.
--   * ANTI-DOUBLON : contrainte d'unicité (article_id, platform) sur social_posts.
--
-- ISOLATION : n'affecte ni les jeux, ni le lecteur PDF, ni les classements, ni les
-- autres fonctions Netlify. Le rendu et la publication des articles restent inchangés.

create extension if not exists "pgcrypto";

-- =====================================================================
-- 0) Enum de statut des tâches sociales
-- =====================================================================
do $$ begin
  create type public.social_post_status as enum ('scheduled','processing','published','failed','cancelled');
exception when duplicate_object then null; end $$;

-- =====================================================================
-- 1) Réglages globaux de l'automatisation (une seule ligne)
-- =====================================================================
create table if not exists public.social_settings (
  id             boolean primary key default true,             -- singleton : toujours true
  x_enabled      boolean not null default false,               -- interrupteur « Publication automatique sur X »
  delay_minutes  int     not null default 10 check (delay_minutes between 0 and 1440),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id) on delete set null,
  constraint social_settings_singleton check (id = true)
);
insert into public.social_settings (id) values (true) on conflict (id) do nothing;

-- =====================================================================
-- 2) Compte X connecté (une seule ligne). Jetons = CHIFFRÉS opaques.
--    Base table VERROUILLÉE : aucun accès anon/authenticated (service_role only).
-- =====================================================================
create table if not exists public.x_account (
  id                 boolean primary key default true,          -- singleton
  x_user_id          text,
  username           text,
  name               text,
  avatar_url         text,
  scopes             text,
  access_token_enc   text,                                      -- AES-GCM (clé côté Netlify, jamais en base)
  refresh_token_enc  text,
  token_expires_at   timestamptz,
  status             text not null default 'disconnected'       -- connected | reconnect_needed | disconnected
                     check (status in ('connected','reconnect_needed','disconnected')),
  connected_at       timestamptz,
  updated_at         timestamptz not null default now(),
  constraint x_account_singleton check (id = true)
);
insert into public.x_account (id) values (true) on conflict (id) do nothing;

-- État éphémère de l'échange OAuth (PKCE). service_role only. Nettoyé par TTL applicatif.
create table if not exists public.x_oauth_state (
  state          text primary key,
  code_verifier  text not null,
  redirect_uri   text not null,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null
);

-- =====================================================================
-- 3) File d'attente des tâches sociales
-- =====================================================================
create table if not exists public.social_posts (
  id             uuid primary key default gen_random_uuid(),
  article_id     uuid not null references public.articles(id) on delete cascade,
  platform       text not null default 'x',
  status         public.social_post_status not null default 'scheduled',
  scheduled_at   timestamptz not null,
  published_at   timestamptz,
  attempt_count  int not null default 0,
  last_error     text,
  x_post_id      text,
  x_post_url     text,
  dry_run        boolean not null default false,
  preview        jsonb,                                        -- texte + média calculés (aperçu régie / DRY RUN)
  article_version uuid references public.article_versions(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint social_posts_unique_article_platform unique (article_id, platform)  -- ANTI-DOUBLON
);
create index if not exists social_posts_due_idx on public.social_posts (status, scheduled_at);
create index if not exists social_posts_article_idx on public.social_posts (article_id);

create or replace function public.tg_touch_updated_at_social() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists social_posts_touch on public.social_posts;
create trigger social_posts_touch before update on public.social_posts for each row execute function public.tg_touch_updated_at_social();
drop trigger if exists social_settings_touch on public.social_settings;
create trigger social_settings_touch before update on public.social_settings for each row execute function public.tg_touch_updated_at_social();
drop trigger if exists x_account_touch on public.x_account;
create trigger x_account_touch before update on public.x_account for each row execute function public.tg_touch_updated_at_social();

-- =====================================================================
-- 4) Enqueue automatique à la publication d'un article
--    * fire quand l'article DEVIENT publié (status='published' + published_at)
--    * délai = social_settings.delay_minutes (défaut 10)
--    * ON CONFLICT DO NOTHING → jamais deux tâches pour un même article
--    * CORPS 100 % PROTÉGÉ : toute erreur est avalée (la publication réussit quand même)
--    * si l'article quitte 'published' (dépublié/archivé) → annule la tâche encore en attente
-- =====================================================================
create or replace function public.tg_articles_social_enqueue() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_delay int;
begin
  begin
    -- Annulation : l'article n'est plus publié → on annule la tâche non encore envoyée
    if tg_op = 'UPDATE'
       and coalesce(old.status::text,'') = 'published'
       and coalesce(new.status::text,'') <> 'published' then
      update public.social_posts
         set status = 'cancelled',
             last_error = 'Article dépublié avant l''envoi'
       where article_id = new.id and platform = 'x' and status = 'scheduled';
      return new;
    end if;

    -- Enqueue : l'article devient publié
    if coalesce(new.status::text,'') = 'published' and new.published_at is not null
       and ( tg_op = 'INSERT'
             or coalesce(old.status::text,'') <> 'published'
             or old.published_at is distinct from new.published_at ) then
      select delay_minutes into v_delay from public.social_settings where id = true;
      insert into public.social_posts (article_id, platform, status, scheduled_at)
      values (new.id, 'x', 'scheduled', new.published_at + make_interval(mins => coalesce(v_delay,10)))
      on conflict (article_id, platform) do nothing;   -- anti-doublon : ne recrée jamais
    end if;
  exception when others then
    -- SÉCURITÉ ABSOLUE : jamais bloquer la publication de l'article.
    null;
  end;
  return new;
end $$;

drop trigger if exists articles_social_enqueue on public.articles;
create trigger articles_social_enqueue after insert or update on public.articles
  for each row execute function public.tg_articles_social_enqueue();

-- =====================================================================
-- 5) Vue publique du compte X : SANS AUCUN JETON (pour l'affichage régie)
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

-- social_posts : lecture admin, écriture admin (les fonctions serveur utilisent le service_role,
-- qui contourne la RLS ; l'admin peut lire l'historique depuis la régie).
drop policy if exists social_posts_read_admin on public.social_posts;
create policy social_posts_read_admin on public.social_posts for select to authenticated
  using (public.is_current_user_admin());
drop policy if exists social_posts_write_admin on public.social_posts;
create policy social_posts_write_admin on public.social_posts for all to authenticated
  using (public.is_current_user_admin()) with check (public.is_current_user_admin());

-- social_settings : lecture + écriture admin (interrupteur régie).
drop policy if exists social_settings_rw_admin on public.social_settings;
create policy social_settings_rw_admin on public.social_settings for all to authenticated
  using (public.is_current_user_admin()) with check (public.is_current_user_admin());

-- x_account : AUCUNE policy → aucun accès anon/authenticated. Les jetons ne sortent
-- JAMAIS via l'API publique. Seul le service_role (fonctions Netlify) y accède.
-- (RLS activé sans policy = tout refusé pour anon/authenticated.)

-- x_oauth_state : idem, service_role only.

-- La vue x_account_public ne renvoie AUCUN jeton. Elle n'est lue que côté serveur par le
-- service_role (fonctions Netlify), qui contourne la RLS ; on ne l'expose donc PAS aux
-- rôles anon/authenticated (rien n'est accessible via l'API publique).
revoke all on public.x_account_public from anon, authenticated;

-- =====================================================================
-- 7) Aides admin (facultatif) : appelées via fonctions serveur en service_role.
--    Aucune donnée sensible. Sécurité par is_current_user_admin().
-- =====================================================================
create or replace function public.social_cancel(p_id uuid)
returns public.social_posts language plpgsql security definer set search_path=public as $$
declare r public.social_posts;
begin
  if not public.is_current_user_admin() then raise exception 'not_admin'; end if;
  update public.social_posts set status='cancelled', last_error='Annulé manuellement'
    where id=p_id and status in ('scheduled','failed') returning * into r;
  return r;
end $$;

revoke all on function public.social_cancel(uuid) from anon;
grant execute on function public.social_cancel(uuid) to authenticated;

-- Fin 0007_social_x.sql
