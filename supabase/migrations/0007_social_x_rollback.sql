-- 0007_social_x_rollback.sql  (v2 — déterministe, rejouable)
-- Rollback COMPLET de 0007_social_x.sql (v2). Ne retire QUE les objets créés par 0007.
-- N'affecte aucune table existante (articles, article_versions, publications, jeux, etc.).
-- Ne touche PAS au prérequis 0000 (is_current_user_admin).
-- Rejouable : tout est en « if exists ».

drop trigger  if exists articles_social_on_delete on public.articles;
drop function if exists public.tg_articles_social_on_delete();
drop trigger  if exists articles_social_enqueue on public.articles;
drop function if exists public.tg_articles_social_enqueue();
drop function if exists public.social_cancel(uuid);

drop view if exists public.x_account_public;

drop trigger if exists social_posts_touch    on public.social_posts;
drop trigger if exists social_settings_touch on public.social_settings;
drop trigger if exists x_account_touch        on public.x_account;

-- (les policies et index disparaissent avec leurs tables)
drop table if exists public.social_posts;
drop table if exists public.x_oauth_state;
drop table if exists public.x_account;
drop table if exists public.social_settings;

drop function if exists public.tg_touch_updated_at_social();

do $$ begin drop type if exists public.social_post_status; exception when others then null; end $$;

-- Fin 0007_social_x_rollback.sql (v2)
