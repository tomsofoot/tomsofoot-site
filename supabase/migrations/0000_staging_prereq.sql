-- 0000_staging_prereq.sql  (BUILD D'UN ENVIRONNEMENT VIERGE — ex. staging)
--
-- POURQUOI : les migrations 0004, 0005 et 0007 utilisent public.is_current_user_admin()
-- mais NE LA DÉFINISSENT PAS. Sur un projet vierge, il faut donc la créer AVANT 0004.
-- Ce fichier installe la MÊME définition canonique que 0008_admin_fn.sql (aucune divergence).
--
-- NON-RÉGRESSION : création UNIQUEMENT SI ABSENTE (garde sur pg_proc). Sur un projet où la
-- fonction existe déjà (ex. prod), ce fichier est un NO-OP : il ne modifie rien.
-- Idempotent. Ne copie AUCUN email/secret réel.
--
-- Définition IDENTIQUE, mot pour mot, à celle de 0008_admin_fn.sql.

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

-- ---------------------------------------------------------------------------
-- DURCISSEMENT STAGING OPTIONNEL (ne PAS mettre dans une migration appliquée en prod) :
-- pour empêcher anon/authenticated de créer des objets dans public sur le STAGING,
-- exécute manuellement, uniquement sur le projet staging :
--     revoke create on schema public from anon, authenticated;
-- (Laissé hors du corps applicable pour ne jamais risquer d'altérer la prod.)
-- ---------------------------------------------------------------------------

-- Fin 0000_staging_prereq.sql
