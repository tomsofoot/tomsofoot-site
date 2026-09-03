-- 0010_regie_auto.sql
-- RÉGIE AUTOMATISÉE — fondations de données (Phase 1).
--
-- 100 % ADDITIF : ne modifie ni ne supprime aucune table/colonne existante (dont `players`).
-- Réutilise l'existant : public.is_current_user_admin() (verrou admin) et
-- public.jog_apply_squad_changes(ops, dry_run) (application transactionnelle + audit).
-- AUCUNE proposition n'est appliquée automatiquement : seule la validation humaine, via
-- jog_auto_apply_validated(), déclenche l'écriture (qui délègue à jog_apply_squad_changes).
--
-- SÉCURITÉ : RLS activée partout ; lecture réservée admin ; écritures uniquement par fonctions
-- SECURITY DEFINER admin-gated ; search_path='' ; verrous consultatifs (advisory locks) pour
-- l'idempotence et l'anti-doublon. Réversible : voir 0010_regie_auto_rollback.sql.
--
-- Persistance & reprise : lots (batches), items par club, propositions, décisions et progression
-- sont stockés en base → un travail se reprend plusieurs jours plus tard, à l'identique.

-- =====================================================================================
-- 1) IDENTITÉ CLUB PERMANENTE (indépendante du nom et du championnat) + alias
-- =====================================================================================
create table if not exists public.jog_clubs (
  id                uuid primary key default gen_random_uuid(),
  canonical_name    text not null,
  league            text null,
  apisports_team_id integer null,
  tm_verein_id      integer null,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists jog_clubs_apisports_uidx on public.jog_clubs(apisports_team_id) where apisports_team_id is not null;
create index if not exists jog_clubs_name_idx on public.jog_clubs(lower(canonical_name));

create table if not exists public.jog_club_aliases (
  id         bigint generated always as identity primary key,
  club_id    uuid not null references public.jog_clubs(id) on delete cascade,
  alias      text not null,
  source     text null,
  created_at timestamptz not null default now(),
  unique (club_id, alias)
);

-- =====================================================================================
-- 2) HISTORISATION DES APPARTENANCES (un joueur transféré n'est jamais supprimé)
-- =====================================================================================
create table if not exists public.jog_player_memberships (
  id             bigint generated always as identity primary key,
  player_id      text not null,                 -- réf. logique vers players.id (pas de FK dure : additif)
  club_from      text null,
  club_to        text null,
  league_from    text null,
  league_to      text null,
  movement_type  text not null default 'transfer'
                 check (movement_type in ('transfer','loan','loan_return','loan_extension','free',
                   'contract_end','retirement','reserve','first_team','unknown_club','future_transfer')),
  date_start     date null,
  date_end       date null,
  effective_date date null,
  source         text null,
  verified_at    timestamptz null,
  batch_id       uuid null,
  admin_uid      uuid null default auth.uid(),
  created_at     timestamptz not null default now()
);
create index if not exists jog_memberships_player_idx on public.jog_player_memberships(player_id);
create index if not exists jog_memberships_batch_idx  on public.jog_player_memberships(batch_id);

-- =====================================================================================
-- 3) VERROUS MANUELS DE FICHE (« ne pas modifier automatiquement ce joueur »)
-- =====================================================================================
create table if not exists public.jog_player_locks (
  player_id  text primary key,
  reason     text null,
  locked_by  uuid null default auth.uid(),
  created_at timestamptz not null default now()
);

-- =====================================================================================
-- 4) LOTS D'ANALYSE PERSISTANTS + items par club (Sections 6-7)
-- =====================================================================================
create table if not exists public.jog_auto_batches (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  season       integer not null,
  source       text not null default 'api-sports',
  leagues      text[] not null default '{}',
  status       text not null default 'planifie'
               check (status in ('planifie','analyse_en_cours','interrompu','analyse_terminee',
                 'brouillon','anomalies','pret_a_appliquer','applique','annule','echec_partiel')),
  progress     jsonb not null default '{}'::jsonb,
  idem_key     text null,                       -- clé d'idempotence (anti-doublon de lot)
  created_by   uuid null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists jog_auto_batches_idem_uidx on public.jog_auto_batches(idem_key) where idem_key is not null;

create table if not exists public.jog_auto_batch_items (
  id              bigint generated always as identity primary key,
  batch_id        uuid not null references public.jog_auto_batches(id) on delete cascade,
  league          text null,
  club_name       text null,
  apisports_team_id integer null,
  status          text not null default 'planifie'
                  check (status in ('planifie','en_cours','termine','echec')),
  anomalies_count integer not null default 0,
  last_saved_at   timestamptz null,
  created_at      timestamptz not null default now(),
  unique (batch_id, apisports_team_id)
);
create index if not exists jog_auto_items_batch_idx on public.jog_auto_batch_items(batch_id, status);

-- =====================================================================================
-- 5) PROPOSITIONS (une par changement détecté) — confiance, mouvement, preuve, décision
-- =====================================================================================
create table if not exists public.jog_auto_proposals (
  id             bigint generated always as identity primary key,
  batch_id       uuid not null references public.jog_auto_batches(id) on delete cascade,
  player_id      text null,                     -- id interne (players.id) si identifié
  player_ext_id  integer null,                  -- id API-Sports
  player_name    text not null,
  movement_type  text not null default 'transfer'
                 check (movement_type in ('transfer','loan','loan_return','loan_extension','free',
                   'contract_end','retirement','reserve','first_team','unknown_club','future_transfer')),
  club_from      text null,
  club_to        text null,
  league_from    text null,
  league_to      text null,
  confidence     text not null default 'ambigue'
                 check (confidence in ('certaine','probable','ambigue','bloquante')),
  source         text null,
  evidence_url   text null,
  observed_at    timestamptz null,
  second_source  text null,
  reason         text null,
  decision       text not null default 'en_attente'
                 check (decision in ('en_attente','acceptee','refusee','corrigee','en_pause')),
  decision_note  text null,
  effective_date date null,
  decided_by     uuid null,
  decided_at     timestamptz null,
  created_at     timestamptz not null default now()
);
create index if not exists jog_auto_props_batch_idx on public.jog_auto_proposals(batch_id, decision, confidence);
create index if not exists jog_auto_props_player_idx on public.jog_auto_proposals(player_id);

-- =====================================================================================
-- 6) JOURNAL DES EXÉCUTIONS DE SOURCE (disponible/ralentie/inaccessible…) — Section 11
-- =====================================================================================
create table if not exists public.jog_source_runs (
  id             bigint generated always as identity primary key,
  batch_id       uuid null,
  source         text not null default 'api-sports',
  league         text null,
  status         text not null default 'disponible'
                 check (status in ('disponible','ralentie','partielle','inaccessible','format_modifie')),
  detail         text null,
  requests_used  integer null,
  ran_at         timestamptz not null default now()
);

-- =====================================================================================
-- 7) CALENDRIER / AUTOMATISATION (Section 5)
-- =====================================================================================
create table if not exists public.jog_auto_schedules (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  tz           text not null default 'Europe/Paris',
  repeat_type  text not null default 'once'
               check (repeat_type in ('once','winter','summer','after_each_mercato','yearly','custom')),
  leagues      text[] not null default '{}',
  delay_hours  integer not null default 0,      -- 12/24/48h après fermeture
  run_at       timestamptz null,                -- pour 'once'
  next_run_at  timestamptz null,                -- calculé
  active       boolean not null default true,
  config       jsonb not null default '{}'::jsonb,
  created_by   uuid null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- =====================================================================================
-- 8) RLS — lecture réservée admin ; écritures uniquement via les fonctions ci-dessous
-- =====================================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'jog_clubs','jog_club_aliases','jog_player_memberships','jog_player_locks',
    'jog_auto_batches','jog_auto_batch_items','jog_auto_proposals','jog_source_runs','jog_auto_schedules'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_read_admin', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (public.is_current_user_admin())$p$, t||'_read_admin', t);
  end loop;
end $$;

-- =====================================================================================
-- 9) RPC (SECURITY DEFINER, admin-gated, search_path='')
-- =====================================================================================

-- 9.1 Démarrer un lot (idempotent via idem_key). Crée le lot + un item par club fourni.
create or replace function public.jog_auto_start_batch(
  p_name    text,
  p_season  integer,
  p_leagues text[],
  p_clubs   jsonb default '[]'::jsonb,          -- [{ "apisports_team_id":33, "club_name":"...", "league":"..." }, ...]
  p_source  text default 'api-sports',
  p_idem_key text default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_c  jsonb;
begin
  if not public.is_current_user_admin() then raise exception 'not_admin' using errcode='42501'; end if;

  -- Idempotence : si un lot existe déjà pour cette clé, on le renvoie (anti-doublon).
  if p_idem_key is not null then
    select id into v_id from public.jog_auto_batches where idem_key = p_idem_key;
    if v_id is not null then return v_id; end if;
  end if;

  insert into public.jog_auto_batches (name, season, source, leagues, status, idem_key)
  values (coalesce(nullif(p_name,''),'Analyse'), p_season, p_source, coalesce(p_leagues,'{}'), 'planifie', p_idem_key)
  returning id into v_id;

  if p_clubs is not null and jsonb_typeof(p_clubs) = 'array' then
    insert into public.jog_auto_batch_items (batch_id, league, club_name, apisports_team_id)
    select v_id, nullif(c->>'league',''), nullif(c->>'club_name',''), nullif(c->>'apisports_team_id','')::integer
      from jsonb_array_elements(p_clubs) as c;
  end if;

  return v_id;
end;
$$;

-- 9.2 Sauvegarder la progression d'un club (worker) : marque l'item + insère ses propositions.
--     Idempotent : re-jouer un item remplace ses propositions (on efface celles de l'item via batch+ext).
create or replace function public.jog_auto_save_progress(
  p_batch    uuid,
  p_team_id  integer,
  p_status   text,
  p_proposals jsonb default '[]'::jsonb,
  p_source_status text default 'disponible',
  p_requests_used integer default null
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_n integer := 0;
  v_anom integer := 0;
  v_p jsonb;
begin
  if not public.is_current_user_admin() then raise exception 'not_admin' using errcode='42501'; end if;

  -- Verrou consultatif : évite deux workers sur le même (lot, club).
  perform pg_advisory_xact_lock(hashtextextended(p_batch::text || ':' || coalesce(p_team_id,0)::text, 0));

  -- Nettoyer d'anciennes propositions de CE club dans CE lot (rejeu idempotent) — uniquement
  -- celles encore 'en_attente' (on ne détruit jamais une décision humaine déjà prise).
  delete from public.jog_auto_proposals
   where batch_id = p_batch and decision = 'en_attente'
     and player_ext_id in (
       select (x->>'player_ext_id')::integer from jsonb_array_elements(coalesce(p_proposals,'[]'::jsonb)) x
       where (x->>'player_ext_id') is not null
     );

  if p_proposals is not null and jsonb_typeof(p_proposals)='array' then
    for v_p in select * from jsonb_array_elements(p_proposals) loop
      insert into public.jog_auto_proposals
        (batch_id, player_id, player_ext_id, player_name, movement_type,
         club_from, club_to, league_from, league_to, confidence, source, evidence_url, observed_at,
         second_source, reason)
      values (
        p_batch,
        nullif(v_p->>'player_id',''),
        nullif(v_p->>'player_ext_id','')::integer,
        coalesce(nullif(v_p->>'player_name',''),'?'),
        coalesce(nullif(v_p->>'movement_type',''),'transfer'),
        nullif(v_p->>'club_from',''), nullif(v_p->>'club_to',''),
        nullif(v_p->>'league_from',''), nullif(v_p->>'league_to',''),
        coalesce(nullif(v_p->>'confidence',''),'ambigue'),
        nullif(v_p->>'source',''), nullif(v_p->>'evidence_url',''),
        nullif(v_p->>'observed_at','')::timestamptz,
        nullif(v_p->>'second_source',''), nullif(v_p->>'reason','')
      );
      v_n := v_n + 1;
      if coalesce(v_p->>'confidence','') in ('ambigue','bloquante') then v_anom := v_anom + 1; end if;
    end loop;
  end if;

  update public.jog_auto_batch_items
     set status = coalesce(nullif(p_status,''),'termine'),
         anomalies_count = v_anom,
         last_saved_at = now()
   where batch_id = p_batch and apisports_team_id = p_team_id;

  insert into public.jog_source_runs (batch_id, source, status, requests_used)
  values (p_batch, 'api-sports', coalesce(nullif(p_source_status,''),'disponible'), p_requests_used);

  update public.jog_auto_batches
     set status = 'analyse_en_cours', updated_at = now(),
         progress = progress || jsonb_build_object('last_team', p_team_id, 'last_saved', now())
   where id = p_batch;

  return jsonb_build_object('ok', true, 'inserted', v_n, 'anomalies', v_anom);
end;
$$;

-- 9.3 Enregistrer une décision humaine sur une proposition (persistée immédiatement).
create or replace function public.jog_auto_record_decision(
  p_proposal bigint,
  p_decision text,
  p_note     text default null,
  p_patch    jsonb default null                 -- correction manuelle éventuelle (club_to, league_to, player_id…)
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not public.is_current_user_admin() then raise exception 'not_admin' using errcode='42501'; end if;
  if coalesce(p_decision,'') not in ('en_attente','acceptee','refusee','corrigee','en_pause') then
    raise exception 'decision invalide' using errcode='22023';
  end if;
  update public.jog_auto_proposals p set
    decision = p_decision,
    decision_note = coalesce(p_note, p.decision_note),
    player_id  = coalesce(nullif(p_patch->>'player_id',''),  p.player_id),
    club_to    = coalesce(nullif(p_patch->>'club_to',''),    p.club_to),
    league_to  = coalesce(nullif(p_patch->>'league_to',''),  p.league_to),
    effective_date = coalesce(nullif(p_patch->>'effective_date','')::date, p.effective_date),
    decided_by = auth.uid(),
    decided_at = now()
  where p.id = p_proposal;
  if not found then raise exception 'proposition introuvable' using errcode='P0002'; end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- 9.4 SIMULATION d'impact (aucune écriture) : compte par type/confiance/décision + joueurs verrouillés.
create or replace function public.jog_auto_simulate(p_batch uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  if not public.is_current_user_admin() then raise exception 'not_admin' using errcode='42501'; end if;
  select jsonb_build_object(
    'batch', p_batch,
    'total', count(*),
    'by_decision', coalesce(jsonb_object_agg(decision, n) filter (where decision is not null), '{}'::jsonb),
    'accepted_to_apply', count(*) filter (where decision='acceptee'),
    'anomalies', count(*) filter (where confidence in ('ambigue','bloquante') and decision='en_attente'),
    'locked_skipped', count(*) filter (where decision='acceptee' and player_id in (select player_id from public.jog_player_locks))
  )
  into v
  from (
    select decision, confidence, player_id, count(*) over (partition by decision) as n
      from public.jog_auto_proposals where batch_id = p_batch
  ) s;
  return coalesce(v, jsonb_build_object('batch', p_batch, 'total', 0));
end;
$$;

-- 9.5 APPLIQUER les propositions VALIDÉES (acceptée) — délègue à jog_apply_squad_changes (transactionnel
--     + audit), historise les appartenances, marque le lot. Ignore les fiches verrouillées et l'explique.
--     Verrou consultatif sur le lot pour empêcher deux validations simultanées.
create or replace function public.jog_auto_apply_validated(p_batch uuid)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_ops     jsonb := '[]'::jsonb;
  v_locked  jsonb := '[]'::jsonb;
  v_applied jsonb;
  r record;
begin
  if not public.is_current_user_admin() then raise exception 'not_admin' using errcode='42501'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('apply:'||p_batch::text, 0)) then
    raise exception 'validation déjà en cours pour ce lot' using errcode='55P03';
  end if;

  for r in
    select * from public.jog_auto_proposals
     where batch_id = p_batch and decision = 'acceptee'
       and player_id is not null and club_to is not null and league_to is not null
  loop
    if exists (select 1 from public.jog_player_locks l where l.player_id = r.player_id) then
      v_locked := v_locked || jsonb_build_object('player_id', r.player_id, 'reason', 'fiche verrouillée');
      continue;
    end if;
    -- Historisation de l'appartenance (avant application).
    insert into public.jog_player_memberships
      (player_id, club_from, club_to, league_from, league_to, movement_type, effective_date,
       source, verified_at, batch_id)
    values (r.player_id, r.club_from, r.club_to, r.league_from, r.league_to, r.movement_type,
       r.effective_date, r.source, now(), p_batch);
    -- Opération à appliquer (move) — réutilise le format de jog_apply_squad_changes.
    v_ops := v_ops || jsonb_build_object('op','move','id', r.player_id, 'club', r.club_to, 'league', r.league_to);
  end loop;

  if jsonb_array_length(v_ops) = 0 then
    update public.jog_auto_batches set status='applique', updated_at=now() where id=p_batch;
    return jsonb_build_object('ok', true, 'applied', 0, 'locked_skipped', v_locked);
  end if;

  -- Application RÉELLE via la fonction existante (transactionnelle + audit). Pas de doublon de logique.
  v_applied := public.jog_apply_squad_changes(v_ops, false);

  update public.jog_auto_batches set status='applique', updated_at=now() where id=p_batch;
  return jsonb_build_object('ok', true, 'applied_ops', jsonb_array_length(v_ops),
                            'engine', v_applied->'totals', 'locked_skipped', v_locked);
end;
$$;

-- 9.6 RETOUR ARRIÈRE d'un lot appliqué : rétablit les clubs à partir des appartenances historisées
--     de CE lot uniquement (sans toucher aux mouvements ultérieurs).
create or replace function public.jog_auto_rollback_batch(p_batch uuid)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare v_ops jsonb := '[]'::jsonb; r record; v_applied jsonb;
begin
  if not public.is_current_user_admin() then raise exception 'not_admin' using errcode='42501'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('rollback:'||p_batch::text, 0)) then
    raise exception 'retour arrière déjà en cours' using errcode='55P03';
  end if;

  for r in
    select m.* from public.jog_player_memberships m
     where m.batch_id = p_batch and m.club_from is not null and m.league_from is not null
  loop
    v_ops := v_ops || jsonb_build_object('op','move','id', r.player_id, 'club', r.club_from, 'league', r.league_from);
  end loop;

  if jsonb_array_length(v_ops) > 0 then
    v_applied := public.jog_apply_squad_changes(v_ops, false);
  end if;
  update public.jog_auto_batches set status='annule', updated_at=now() where id=p_batch;
  return jsonb_build_object('ok', true, 'reverted', jsonb_array_length(v_ops), 'engine', v_applied->'totals');
end;
$$;

-- 9.7 Lecture des lots (avec compteurs) pour l'UI (admin).
create or replace function public.jog_auto_list_batches()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.updated_at desc), '[]'::jsonb)
  from (
    select b.id, b.name, b.season, b.leagues, b.status, b.updated_at,
           (select count(*) from public.jog_auto_batch_items i where i.batch_id=b.id) as total,
           (select count(*) from public.jog_auto_batch_items i where i.batch_id=b.id and i.status='termine') as done,
           (select coalesce(sum(i.anomalies_count),0) from public.jog_auto_batch_items i where i.batch_id=b.id) as anomalies,
           (select count(*) from public.jog_auto_proposals p where p.batch_id=b.id and p.confidence='certaine') as certain
    from public.jog_auto_batches b
    where public.is_current_user_admin()
  ) t;
$$;

-- 9.8 Lecture des propositions d'un lot (admin).
create or replace function public.jog_auto_list_proposals(p_batch uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.is_current_user_admin() then
    coalesce((select jsonb_agg(row_to_json(p) order by
       array_position(array['bloquante','ambigue','probable','certaine']::text[], p.confidence), p.player_name)
     from public.jog_auto_proposals p where p.batch_id=p_batch), '[]'::jsonb)
  else '[]'::jsonb end;
$$;

-- 9.9 Créer / mettre à jour une planification (admin).
create or replace function public.jog_auto_save_schedule(
  p_name text, p_repeat text, p_tz text, p_leagues text[], p_delay_hours integer default 0, p_run_at text default null
) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_id uuid; v_run timestamptz := nullif(p_run_at,'')::timestamptz;
begin
  if not public.is_current_user_admin() then raise exception 'not_admin' using errcode='42501'; end if;
  insert into public.jog_auto_schedules (name, repeat_type, tz, leagues, delay_hours, run_at, next_run_at, active)
  values (coalesce(nullif(p_name,''),'Planification'), coalesce(nullif(p_repeat,''),'once'),
          coalesce(nullif(p_tz,''),'Europe/Paris'), coalesce(p_leagues,'{}'), coalesce(p_delay_hours,0),
          v_run, v_run, true)
  returning id into v_id;
  return v_id;
end;
$$;

-- =====================================================================================
-- 10) Droits d'exécution (verrou réel à l'intérieur via is_current_user_admin()).
-- =====================================================================================
do $$
declare f text;
begin
  foreach f in array array[
    'public.jog_auto_start_batch(text,integer,text[],jsonb,text,text)',
    'public.jog_auto_save_progress(uuid,integer,text,jsonb,text,integer)',
    'public.jog_auto_record_decision(bigint,text,text,jsonb)',
    'public.jog_auto_simulate(uuid)',
    'public.jog_auto_apply_validated(uuid)',
    'public.jog_auto_rollback_batch(uuid)',
    'public.jog_auto_list_batches()',
    'public.jog_auto_list_proposals(uuid)',
    'public.jog_auto_save_schedule(text,text,text,text[],integer,text)'
  ] loop
    execute 'revoke all on function '||f||' from public';
    execute 'grant execute on function '||f||' to authenticated';
  end loop;
end $$;

-- Fin 0010_regie_auto.sql
