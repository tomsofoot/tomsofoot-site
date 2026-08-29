-- 0007_social_x_rollback.sql  (v3 — déterministe, REJOUABLE deux fois de suite)
-- Rollback COMPLET de 0007_social_x.sql. Ne retire QUE les objets créés par 0007.
-- N'affecte aucune table existante (articles, article_versions, publications, jeux, etc.).
-- Ne touche PAS au prérequis 0000 (is_current_user_admin).
--
-- REJOUABILITÉ (correctif v3) :
--   * On ne fait PLUS « drop trigger ... on public.social_posts/social_settings/x_account » :
--     ces triggers disparaissent AUTOMATIQUEMENT avec leur table (drop table). Les garder
--     échouait au 2e passage car « drop trigger if exists ... ON <table> » lève une erreur
--     quand la TABLE n'existe plus (le IF EXISTS ne protège que le trigger, pas la table).
--   * Les triggers sur public.articles (table CONSERVÉE) sont, eux, retirés explicitement.
--   * L'enum est retiré par « drop type if exists » SANS masquer d'erreur : à ce stade toutes
--     les tables qui l'utilisaient sont déjà supprimées, donc aucune dépendance ne subsiste.

-- 1) Triggers/fonctions rattachés à public.articles (table NON supprimée → retrait explicite requis)
drop trigger  if exists articles_social_on_delete on public.articles;
drop function if exists public.tg_articles_social_on_delete();
drop trigger  if exists articles_social_enqueue on public.articles;
drop function if exists public.tg_articles_social_enqueue();

-- 2) Aides / vue
drop function if exists public.social_cancel(uuid);
drop view     if exists public.x_account_public;

-- 3) Tables 0007 — leur suppression retire d'elle-même leurs propres triggers (…_touch) et policies/index.
drop table if exists public.social_posts;
drop table if exists public.x_oauth_state;
drop table if exists public.x_account;
drop table if exists public.social_settings;

-- 4) Fonction de touch (plus référencée par aucun trigger une fois les tables supprimées)
drop function if exists public.tg_touch_updated_at_social();

-- 5) Type enum — plus aucune dépendance ici ; PAS de « exception when others then null »
drop type if exists public.social_post_status;

-- Fin 0007_social_x_rollback.sql (v3)
