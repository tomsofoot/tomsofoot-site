-- 0011_players_apisports_id.sql
-- Pont joueur <-> API-Sports : fiabilise les mises à jour d'effectifs (reconnaissance par identifiant).
-- 100 % ADDITIF & IDEMPOTENT : ajoute une colonne nullable + un index. Ne modifie aucune donnée.
-- À appliquer (SQL editor Supabase, projet Jogadle-prod) AVANT le déploiement du code qui lit
-- players.apisports_id (jog-auto-worker / jog-backfill-extids), sinon ces fonctions échouent.
-- Retour arrière : alter table public.players drop column if exists apisports_id;

alter table public.players add column if not exists apisports_id integer;

-- Un id API-Sports ne peut appartenir qu'à un seul joueur (les NULL sont ignorés).
create unique index if not exists players_apisports_id_uidx
  on public.players (apisports_id) where apisports_id is not null;
