-- 0008_admin_fn.sql  (RÉCONCILIATION — versionne is_current_user_admin dans le dépôt)
--
-- CONTEXTE : is_current_user_admin() a été créée MANUELLEMENT en production et n'est
-- présente dans aucune migration 0001–0007. Ce fichier la VERSIONNE désormais dans Git,
-- avec un numéro SUPÉRIEUR aux migrations déjà appliquées, pour être pris naturellement
-- comme « prochaine migration » par l'outil (sans dépendre du rejeu d'un fichier antérieur).
--
-- SÉCURITÉ / NON-RÉGRESSION (point clé) :
--   * On N'UTILISE PAS « create or replace » : cela écraserait la définition de prod.
--   * On crée la fonction UNIQUEMENT SI ELLE EST ABSENTE (garde sur pg_proc).
--     → en PRODUCTION (où elle existe déjà) ce fichier est un NO-OP total :
--       il ne modifie ni le corps, ni les droits, ni le comportement existants.
--     → sur un projet où elle manque, il installe la définition canonique ci-dessous.
--   * Idempotent : rejouable sans effet de bord.
--
-- IMPORTANT : la définition ci-dessous est la définition CANONIQUE reconstruite à partir
-- de la convention documentée dans 0002 (claim JWT app_metadata.role = 'admin') et de
-- l'usage réel (RPC booléen appelé par les régies et les fonctions Netlify). Elle n'a PAS
-- été comparée automatiquement à la définition vivante en production depuis cet
-- environnement (aucun accès base ici). Avant d'appliquer ce fichier en production, exécute
-- la requête d'introspection fournie séparément et confirme l'équivalence ; de toute façon,
-- la garde « si absente » garantit qu'aucune application n'écrasera la fonction de prod.

do $$
begin
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'is_current_user_admin'
       and pg_get_function_identity_arguments(p.oid) = ''      -- signature () sans argument
  ) then
    execute $def$
      create function public.is_current_user_admin()
      returns boolean
      language sql
      stable
      security definer
      set search_path = ''
      as $body$
        select coalesce(
          ( (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' ),
          false
        )
      $body$
    $def$;
    execute 'revoke all on function public.is_current_user_admin() from public';
    execute 'grant execute on function public.is_current_user_admin() to anon, authenticated';
  end if;
end $$;

-- Fin 0008_admin_fn.sql
