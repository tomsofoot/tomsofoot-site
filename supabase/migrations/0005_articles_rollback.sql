-- 0005_articles_rollback.sql  (VERSION FINALE — correspond à 0005_articles.sql final)
-- RETOUR ARRIÈRE COMPLET du système d'ARTICLES HTML + DOSSIERS.
-- À N'EXÉCUTER QUE pour annuler entièrement 0005_articles.sql.
--
-- Ne touche QUE les objets créés par 0005 :
--   articles*, article_blocks/versions/related, dossiers, editorial_zones/genres,
--   competitions, editorial_seq, gen_editorial_id(), save_article()/publish_article(),
--   triggers tg_* dédiés, enum public.article_status, vues *_public, bucket 'articles'
--   et ses policies, + les 5 colonnes ADDITIVES ajoutées sur publications.
--
-- NE SUPPRIME PAS (partagés / préexistants, volontairement conservés) :
--   public.is_current_user_admin(), l'enum public.publication_status,
--   la table publications (journaux), Jogadle, classements, points, comptes.
--
-- ATTENTION : supprime les articles HTML, dossiers et leurs blocs/versions.
-- Les journaux PDF, le jeu et le reste ne sont pas concernés.
-- Faire une sauvegarde avant si besoin.

begin;

-- ---------------------------------------------------------------------
-- 1) RPC transactionnels (dédiés 0005)
-- ---------------------------------------------------------------------
drop function if exists public.publish_article(uuid, boolean, timestamptz);
drop function if exists public.save_article(jsonb, jsonb);

-- ---------------------------------------------------------------------
-- 2) Policies du bucket de stockage 'articles'
-- ---------------------------------------------------------------------
drop policy if exists articles_obj_read   on storage.objects;
drop policy if exists articles_obj_write  on storage.objects;
drop policy if exists articles_obj_update on storage.objects;
drop policy if exists articles_obj_delete on storage.objects;
-- Le bucket 'articles' : retiré seulement s'il est vide (décommenter au besoin).
-- delete from storage.buckets where id = 'articles';

-- ---------------------------------------------------------------------
-- 3) Vues publiques
-- ---------------------------------------------------------------------
drop view if exists public.dossiers_public;
drop view if exists public.articles_public;

-- ---------------------------------------------------------------------
-- 4) Policies RLS des nouvelles tables
-- ---------------------------------------------------------------------
drop policy if exists articles_read_public       on public.articles;
drop policy if exists articles_write_admin        on public.articles;
drop policy if exists dossiers_read_public         on public.dossiers;
drop policy if exists dossiers_write_admin         on public.dossiers;
drop policy if exists article_blocks_read_public   on public.article_blocks;
drop policy if exists article_blocks_write_admin   on public.article_blocks;
drop policy if exists article_versions_admin       on public.article_versions;
drop policy if exists article_related_read         on public.article_related;
drop policy if exists article_related_write        on public.article_related;
drop policy if exists tax_zones_read  on public.editorial_zones;
drop policy if exists tax_zones_write on public.editorial_zones;
drop policy if exists tax_comp_read   on public.competitions;
drop policy if exists tax_comp_write  on public.competitions;
drop policy if exists tax_genre_read  on public.editorial_genres;
drop policy if exists tax_genre_write on public.editorial_genres;

-- ---------------------------------------------------------------------
-- 5) Colonnes ADDITIVES retirées de publications (retour à l'état initial)
--    (drop column if exists : sans effet si déjà absentes)
-- ---------------------------------------------------------------------
alter table public.publications drop column if exists dossier_id;
alter table public.publications drop column if exists page_h;
alter table public.publications drop column if exists page_w;
alter table public.publications drop column if exists ratio;
alter table public.publications drop column if exists orientation;
alter table public.publications drop column if exists format_label;

-- ---------------------------------------------------------------------
-- 6) Triggers + fonctions de trigger (dédiés 0005)
-- ---------------------------------------------------------------------
drop trigger if exists articles_touch on public.articles;
drop trigger if exists dossiers_touch on public.dossiers;
drop trigger if exists articles_edid  on public.articles;
drop trigger if exists dossiers_edid  on public.dossiers;
drop function if exists public.tg_articles_edid();
drop function if exists public.tg_dossiers_edid();
-- tg_touch_updated_at() : dédiée 0005 également (aucun autre objet ne l'utilise ici).
drop function if exists public.tg_touch_updated_at();

-- ---------------------------------------------------------------------
-- 7) Tables (ordre : dépendances d'abord)
-- ---------------------------------------------------------------------
drop table if exists public.article_related;
drop table if exists public.article_versions;
drop table if exists public.article_blocks;
drop table if exists public.articles;
drop table if exists public.dossiers;
drop table if exists public.competitions;
drop table if exists public.editorial_genres;
drop table if exists public.editorial_zones;
drop table if exists public.editorial_seq;

-- ---------------------------------------------------------------------
-- 8) Fonction d'ID éditorial + enum dédié
-- ---------------------------------------------------------------------
drop function if exists public.gen_editorial_id(text);
drop type     if exists public.article_status;

-- NB : public.publication_status et public.is_current_user_admin() sont
-- VOLONTAIREMENT conservés (partagés avec le module publications / les régies).
-- L'extension pgcrypto est laissée en place (inoffensive, souvent déjà requise ailleurs).

commit;
