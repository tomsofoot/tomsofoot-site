-- 0007_social_x.sql  (VERSION DURCIE v2 — corrections de pré-validation)
-- Automatisation « article publié → publication X (Twitter) après délai ».
--
-- CORRECTIONS v2 (par rapport à la version auditée) :
--   (a) Republication après annulation/échec, SANS doublon : l'enqueue RÉ-ARME la tâche
--       existante 'cancelled'/'failed' au lieu de ne rien faire (pas de 2e ligne).
--   (b) Jamais de reprogrammation d'un post DÉJÀ publié : les statuts 'published'/'processing'
--       ne sont jamais touchés par l'enqueue ni par retry/publish_now.
--   (c) scheduled_at mis à jour si published_at change (tant que la tâche est 'scheduled').
--   (d) Suppression d'un article → sa tâche 'scheduled' est ANNULÉE (trigger BEFORE DELETE),
--       l'historique déjà publié est conservé (snapshot + article_id null).
--   (e) x_enabled pris en compte PAR LE TRIGGER (n'enqueue que si l'automatisation est active)
--       ET par le worker (ne poste pas si désactivé).
--   (f) Bandeau d'erreur EFFACÉ après un enqueue réussi.
--   (g) Historique NON supprimable via le navigateur : aucune policy DELETE (seul service_role
--       ou la cascade DB peut supprimer).
--   (h) article_url / article_version : remplis par le WORKER au moment de l'envoi (voir note).
--   (i) Permissions SQL explicites et minimales ; fonctions trigger non appelables directement.
--   (j) Rollback déterministe fourni (0007_social_x_rollback.sql).
--
-- Dépendances (AVANT) : public.articles, public.article_versions, public.is_current_user_admin().

create extension if not exists "pgcrypto";

-- 0) Enum de statut
do $$ begin
  create type public.social_post_status as enum ('scheduled','processing','published','failed','cancelled');
exception when duplicate_object then null; end $$;

-- 1) Réglages globaux (singleton) + traçabilité de la dernière erreur d'enqueue
create table if not exists public.social_settings (
  id                    boolean primary key default true,
  x_enabled             boolean not null default false,
  delay_minutes         int not null default 10 check (delay_minutes between 0 and 1440),
  last_enqueue_error    text,
  last_enqueue_error_at timestamptz,
  updated_at            timestamptz not null default now(),
  updated_by            uuid references auth.users(id) on delete set null,
  constraint social_settings_singleton check (id = true)
);
insert into public.social_settings (id) values (true) on conflict (id) do nothing;
alter table public.social_settings add column if not exists last_enqueue_error text;
alter table public.social_settings add column if not exists last_enqueue_error_at timestamptz;

-- 2) Compte X (singleton). Jetons chiffrés opaques. Table VERROUILLÉE (service_role only).
create table if not exists public.x_account (
  id                 boolean primary key default true,
  x_user_id          text, username text, name text, avatar_url text, scopes text,
  access_token_enc   text, refresh_token_enc text, token_expires_at timestamptz,
  status             text not null default 'disconnected'
                     check (status in ('connected','reconnect_needed','disconnected')),
  connected_at       timestamptz,
  updated_at         timestamptz not null default now(),
  constraint x_account_singleton check (id = true)
);
insert into public.x_account (id) values (true) on conflict (id) do nothing;

-- État OAuth PKCE éphémère (service_role only) : expiration courte + usage unique + nettoyage.
create table if not exists public.x_oauth_state (
  state text primary key, code_verifier text not null, redirect_uri text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_by uuid references auth.users(id) on delete set null
);
alter table public.x_oauth_state add column if not exists expires_at timestamptz not null default (now() + interval '10 minutes');
create index if not exists x_oauth_state_expires_idx on public.x_oauth_state (expires_at);

-- 3) File des tâches — l'historique SURVIT à l'article (article_id nullable + ON DELETE SET NULL + snapshot).
create table if not exists public.social_posts (
  id             uuid primary key default gen_random_uuid(),
  article_id     uuid references public.articles(id) on delete set null,
  platform       text not null default 'x',
  status         public.social_post_status not null default 'scheduled',
  article_title  text, article_slug text, article_url text,
  scheduled_at   timestamptz not null,
  published_at   timestamptz,
  attempt_count  int not null default 0,
  last_error     text, x_post_id text, x_post_url text,
  dry_run        boolean not null default false,
  preview        jsonb,
  article_version uuid references public.article_versions(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.social_posts add column if not exists article_title text;
alter table public.social_posts add column if not exists article_slug  text;
alter table public.social_posts add column if not exists article_url   text;
alter table public.social_posts alter column article_id drop not null;
do $$ begin alter table public.social_posts drop constraint if exists social_posts_unique_article_platform; exception when others then null; end $$;
do $$ begin alter table public.social_posts drop constraint social_posts_article_id_fkey; exception when others then null; end $$;
do $$ begin
  alter table public.social_posts add constraint social_posts_article_id_fkey
    foreign key (article_id) references public.articles(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ANTI-DOUBLON : unique tant que l'article existe (garde-fou ultime).
create unique index if not exists social_posts_unique_active_article
  on public.social_posts (article_id, platform) where article_id is not null;
create index if not exists social_posts_due_idx on public.social_posts (status, scheduled_at);
create index if not exists social_posts_article_idx on public.social_posts (article_id);

-- updated_at auto (trigger durci)
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

-- 4) Enqueue à la publication — logique EXPLICITE (pas d'ON CONFLICT ambigu).
--    * respecte x_enabled ; (b) ne touche jamais 'published'/'processing' ;
--    * (a) ré-arme 'cancelled'/'failed' ; (c) reprogramme 'scheduled' si la date change ;
--    * (f) efface le bandeau d'erreur en cas de succès ; corps 100 % protégé (publication prioritaire, mais tracée).
create or replace function public.tg_articles_social_enqueue() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_delay int; v_enabled boolean; v_sched timestamptz; v_existing record;
begin
  begin
    select x_enabled, delay_minutes into v_enabled, v_delay from public.social_settings where id = true;

    -- Dépublication : annule la tâche non encore envoyée
    if tg_op = 'UPDATE'
       and coalesce(old.status::text,'') = 'published'
       and coalesce(new.status::text,'') <> 'published' then
      update public.social_posts set status='cancelled', last_error='Article dépublié avant l''envoi'
       where article_id = new.id and platform='x' and status in ('scheduled','failed');
      return new;
    end if;

    -- Enqueue seulement si l'automatisation est ACTIVE et l'article DEVIENT publié
    if coalesce(v_enabled,false)
       and coalesce(new.status::text,'') = 'published' and new.published_at is not null
       and ( tg_op = 'INSERT'
             or coalesce(old.status::text,'') <> 'published'
             or old.published_at is distinct from new.published_at ) then

      v_sched := new.published_at + pg_catalog.make_interval(mins => coalesce(v_delay,10));
      select id, status into v_existing from public.social_posts
        where article_id = new.id and platform='x' limit 1;

      if v_existing.id is null then
        insert into public.social_posts (article_id, platform, status, scheduled_at, article_title, article_slug)
        values (new.id, 'x', 'scheduled', v_sched, new.title, new.slug);
      elsif v_existing.status = 'scheduled' then
        -- (c) reprogramme sans doublon
        update public.social_posts set scheduled_at=v_sched, article_title=new.title, article_slug=new.slug
          where id = v_existing.id;
      elsif v_existing.status in ('cancelled','failed') then
        -- (a) ré-arme sans doublon
        update public.social_posts
           set status='scheduled', scheduled_at=v_sched, article_title=new.title, article_slug=new.slug,
               last_error=null, attempt_count=0
         where id = v_existing.id;
      end if;
      -- (b) si v_existing.status in ('published','processing') → on ne touche à RIEN.

      -- (f) enqueue réussi → efface le bandeau d'erreur précédent
      update public.social_settings set last_enqueue_error=null, last_enqueue_error_at=null
        where id=true and last_enqueue_error is not null;
    end if;
  exception when others then
    raise warning 'social_enqueue: echec pour article % : %', new.id, sqlerrm;
    begin
      update public.social_settings
         set last_enqueue_error='Article '||new.id::text||' : '||left(sqlerrm,200),
             last_enqueue_error_at=pg_catalog.now()
       where id=true;
    exception when others then null; end;
  end;
  return new;
end $$;
revoke all on function public.tg_articles_social_enqueue() from public, anon, authenticated;
drop trigger if exists articles_social_enqueue on public.articles;
create trigger articles_social_enqueue after insert or update on public.articles
  for each row execute function public.tg_articles_social_enqueue();

-- 4bis) (d) Suppression d'un article → annule sa tâche encore 'scheduled' (BEFORE DELETE).
--       L'historique déjà publié est conservé (article_id passera à null par ON DELETE SET NULL).
create or replace function public.tg_articles_social_on_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    update public.social_posts set status='cancelled', last_error='Article supprimé avant l''envoi'
     where article_id = old.id and platform='x' and status in ('scheduled','failed');
  exception when others then null; end;
  return old;
end $$;
revoke all on function public.tg_articles_social_on_delete() from public, anon, authenticated;
drop trigger if exists articles_social_on_delete on public.articles;
create trigger articles_social_on_delete before delete on public.articles
  for each row execute function public.tg_articles_social_on_delete();

-- 5) Vue publique du compte X : SANS AUCUN JETON
create or replace view public.x_account_public as
  select x_user_id, username, name, avatar_url, scopes, token_expires_at, status, connected_at, updated_at
  from public.x_account where id = true;

-- 6) RLS — (g) historique NON supprimable via l'API (aucune policy DELETE).
alter table public.social_posts   enable row level security;
alter table public.social_settings enable row level security;
alter table public.x_account       enable row level security;
alter table public.x_oauth_state   enable row level security;

-- social_posts : le NAVIGATEUR n'a que la LECTURE (admin). Aucune écriture directe :
--   insert/update/delete passent par les fonctions serveur (service_role, hors RLS) ou la RPC social_cancel.
drop policy if exists social_posts_read_admin   on public.social_posts;
create policy social_posts_read_admin   on public.social_posts for select to authenticated using (public.is_current_user_admin());
drop policy if exists social_posts_write_admin  on public.social_posts;   -- ancienne policy ALL (incluait DELETE) : retirée
drop policy if exists social_posts_insert_admin on public.social_posts;   -- retirée : pas d'insertion via le navigateur
drop policy if exists social_posts_update_admin on public.social_posts;   -- retirée : pas de modification via le navigateur
-- AUCUNE policy INSERT / UPDATE / DELETE pour authenticated : tâches et historique non modifiables via le navigateur.

-- social_settings : LECTURE admin + MISE À JOUR contrôlée admin. Aucune insertion, aucune suppression.
drop policy if exists social_settings_rw_admin     on public.social_settings;   -- ancienne policy FOR ALL (permettait delete/insert) : retirée
drop policy if exists social_settings_read_admin   on public.social_settings;
create policy social_settings_read_admin   on public.social_settings for select to authenticated using (public.is_current_user_admin());
drop policy if exists social_settings_update_admin on public.social_settings;
create policy social_settings_update_admin on public.social_settings for update to authenticated
  using (public.is_current_user_admin()) with check (public.is_current_user_admin());
-- AUCUNE policy INSERT (le singleton existe déjà) ni DELETE (singleton non supprimable).

-- x_account / x_oauth_state : AUCUNE policy → tout refusé (service_role only).
revoke all on public.x_account_public from anon, authenticated;

-- 7) Aide admin : annulation manuelle. SECURITY DEFINER durcie.
create or replace function public.social_cancel(p_id uuid)
returns public.social_posts language plpgsql security definer set search_path = '' as $$
declare r public.social_posts;
begin
  if not public.is_current_user_admin() then raise exception 'not_admin'; end if;
  update public.social_posts set status='cancelled', last_error='Annulé manuellement'
    where id=p_id and status in ('scheduled','failed') returning * into r;
  return r;
end $$;

-- 8) GRANT / REVOKE explicites (minimaux)
revoke all on function public.tg_articles_social_enqueue()   from public, anon, authenticated;
revoke all on function public.tg_articles_social_on_delete() from public, anon, authenticated;
revoke all on function public.tg_touch_updated_at_social()   from public, anon, authenticated;
revoke all on function public.social_cancel(uuid) from public, anon;
grant execute on function public.social_cancel(uuid) to authenticated;

-- 8bis) GRANT / REVOKE explicites sur les TABLES (moindre privilège ; complète les policies RLS).
--   Le navigateur (anon/authenticated) n'écrit JAMAIS en direct : tout passe par les fonctions
--   serveur (service_role, hors RLS) ou la RPC social_cancel. Les triggers sont SECURITY DEFINER.
revoke all on public.social_posts, public.social_settings, public.x_account, public.x_oauth_state from anon, authenticated;
grant select         on public.social_posts    to authenticated;   -- lecture seule (RLS -> admin)
grant select, update on public.social_settings to authenticated;   -- lecture + MAJ contrôlée (RLS -> admin) ; ni insert ni delete
-- x_account / x_oauth_state : AUCUN grant navigateur (service_role uniquement).

-- NOTE (h) article_url / article_version :
--   Le TRIGGER ne connaît pas l'origine publique (SITE_ORIGIN est une variable Netlify, pas en base)
--   ni la version « au moment de l'envoi ». Ces deux champs sont donc renseignés par le WORKER,
--   de façon transactionnelle, dans l'UNIQUE PATCH de finalisation de la tâche (statut → published) :
--     * article_url     = canonicalUrl(slug) calculée à l'envoi ;
--     * article_version = id de la dernière public.article_versions de l'article (snapshot publié).
--   Voir netlify/functions/lib/x-worker.mjs (finalize).

-- Fin 0007_social_x.sql (v2)
