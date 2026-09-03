-- 0010_regie_auto_rollback.sql
-- Annule 0010_regie_auto.sql. Ne touche PAS à la table players ni à jog_apply_squad_changes.
-- Par sécurité, conserve les données historisées si tu ne veux pas tout perdre : commente les DROP TABLE.

drop function if exists public.jog_auto_save_schedule(text,text,text,text[],integer,text);
drop function if exists public.jog_auto_list_proposals(uuid);
drop function if exists public.jog_auto_list_batches();
drop function if exists public.jog_auto_rollback_batch(uuid);
drop function if exists public.jog_auto_apply_validated(uuid);
drop function if exists public.jog_auto_simulate(uuid);
drop function if exists public.jog_auto_record_decision(bigint,text,text,jsonb);
drop function if exists public.jog_auto_save_progress(uuid,integer,text,jsonb,text,integer);
drop function if exists public.jog_auto_start_batch(text,integer,text[],jsonb,text,text);

drop table if exists public.jog_auto_proposals;
drop table if exists public.jog_auto_batch_items;
drop table if exists public.jog_source_runs;
drop table if exists public.jog_auto_schedules;
drop table if exists public.jog_auto_batches;
drop table if exists public.jog_player_locks;
drop table if exists public.jog_player_memberships;
drop table if exists public.jog_club_aliases;
drop table if exists public.jog_clubs;

-- Fin 0010_regie_auto_rollback.sql
