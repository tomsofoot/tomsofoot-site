-- 0007_rls_tests.sql (v2) — Tests RLS + PRIVILÈGES de table (moindre privilège).
-- Chaque sonde s'exécute en se faisant RÉELLEMENT passer pour anon / authenticated (non-admin)
-- / authenticated (admin) via SET LOCAL ROLE + request.jwt.claims, puis revient au rôle initial.
-- Modèle attendu :
--   social_posts   : navigateur = LECTURE admin uniquement (aucun insert/update/delete direct).
--   social_settings: LECTURE admin + MISE À JOUR contrôlée admin ; aucune insertion, aucune suppression.
--   x_account      : non lisible via l'API (service_role only).
-- À exécuter sur le STAGING après 0007. Aucun secret, aucun appel réseau. Restaure les réglages.

drop table if exists _rls;
create temp table _rls(k int, test text, attendu text, obtenu text, pass boolean);

do $$
declare
  orig text; n int; err text;
  init_enabled boolean; init_delay int; init_err text; init_err_at timestamptz;
begin
  select current_user into orig;
  select x_enabled, delay_minutes, last_enqueue_error, last_enqueue_error_at
    into init_enabled, init_delay, init_err, init_err_at from public.social_settings where id=true;

  -- Ligne sonde créée en tant que rôle initial (contourne la RLS)
  delete from public.social_posts where article_slug in ('rls-probe','rls-anon-ins','rls-admin-ins');
  insert into public.social_posts(article_id, platform, status, scheduled_at, article_title, article_slug)
    values (null,'x','scheduled', now(), 'RLS probe', 'rls-probe');

  -- ========== social_posts : LECTURE ==========
  set local role anon; perform set_config('request.jwt.claims','{}',true);
  begin select count(*) into n from public.social_posts where article_slug='rls-probe';
  exception when others then n:=-1; end;
  execute format('set local role %I', orig);
  insert into _rls values (1,'anon NE PEUT PAS lire social_posts','0 ou refus',
     case when n<=0 then 'bloque('||n||')' else 'VISIBLE('||n||')' end, n<=0);

  set local role authenticated;
  perform set_config('request.jwt.claims','{"role":"authenticated","app_metadata":{"role":"editor"}}',true);
  begin select count(*) into n from public.social_posts where article_slug='rls-probe';
  exception when others then n:=-1; end;
  execute format('set local role %I', orig);
  insert into _rls values (2,'authenticated NON-admin NE PEUT PAS lire social_posts','0 ou refus',
     case when n<=0 then 'bloque('||n||')' else 'VISIBLE('||n||')' end, n<=0);

  set local role authenticated;
  perform set_config('request.jwt.claims','{"app_metadata":{"role":"admin"}}',true);
  begin select count(*) into n from public.social_posts where article_slug='rls-probe';
  exception when others then n:=-1; end;
  execute format('set local role %I', orig);
  insert into _rls values (3,'admin PEUT lire social_posts (>=1)','>=1', n::text, n>=1);

  -- ========== social_posts : ÉCRITURES REFUSÉES au navigateur ==========
  -- (4) admin ne peut PAS fabriquer une publication 'published' depuis le navigateur (INSERT refusé)
  set local role authenticated; perform set_config('request.jwt.claims','{"app_metadata":{"role":"admin"}}',true);
  err:=null;
  begin
    insert into public.social_posts(article_id,platform,status,scheduled_at,article_slug,article_title)
      values(null,'x','published',now(),'rls-admin-ins','faux publie'); err:='INSERE';
  exception when others then err:='refus'; end;
  execute format('set local role %I', orig);
  delete from public.social_posts where article_slug='rls-admin-ins';
  insert into _rls values (4,'admin NE PEUT PAS inserer une publi ''published'' via le navigateur','refus', err, err='refus');

  -- (5) admin ne peut PAS modifier l'historique depuis le navigateur (UPDATE refusé → chemin serveur uniquement)
  set local role authenticated; perform set_config('request.jwt.claims','{"app_metadata":{"role":"admin"}}',true);
  err:=null;
  begin
    update public.social_posts set last_error='hack' where article_slug='rls-probe';
    get diagnostics n=row_count; err:='MAJ('||n||')';
  exception when others then err:='refus'; end;
  execute format('set local role %I', orig);
  insert into _rls values (5,'admin NE PEUT PAS modifier social_posts via le navigateur (serveur only)','refus ou MAJ(0)',
     err, err='refus' or err='MAJ(0)');

  -- (6) admin ne peut PAS supprimer l'historique
  set local role authenticated; perform set_config('request.jwt.claims','{"app_metadata":{"role":"admin"}}',true);
  begin delete from public.social_posts where article_slug='rls-probe'; get diagnostics n=row_count;
  exception when others then n:=-1; end;
  execute format('set local role %I', orig);
  insert into _rls values (6,'admin NE PEUT PAS supprimer l''historique','0 ligne ou refus',
     case when n<=0 then 'bloque('||n||')' else 'SUPPRIME('||n||')' end, n<=0);

  -- (7) anon ne peut PAS insérer
  set local role anon; perform set_config('request.jwt.claims','{}',true);
  err:=null;
  begin insert into public.social_posts(article_id,platform,status,scheduled_at,article_slug)
        values(null,'x','scheduled',now(),'rls-anon-ins'); err:='INSERE';
  exception when others then err:='refus'; end;
  execute format('set local role %I', orig);
  delete from public.social_posts where article_slug='rls-anon-ins';
  insert into _rls values (7,'anon NE PEUT PAS inserer social_posts','refus', err, err='refus');

  -- (8) l'historique est toujours là après ces tentatives
  select count(*) into n from public.social_posts where article_slug='rls-probe';
  insert into _rls values (8,'historique toujours present apres tentatives','1', n::text, n=1);

  -- ========== social_settings : lecture admin + MAJ contrôlée ; ni insert ni delete ==========
  -- (9) anon ne peut pas lire
  set local role anon; perform set_config('request.jwt.claims','{}',true);
  begin select count(*) into n from public.social_settings where id=true;
  exception when others then n:=-1; end;
  execute format('set local role %I', orig);
  insert into _rls values (9,'anon NE PEUT PAS lire social_settings','0 ou refus',
     case when n<=0 then 'bloque('||n||')' else 'VISIBLE('||n||')' end, n<=0);

  -- (10) non-admin ne peut pas modifier les réglages (RLS)
  set local role authenticated; perform set_config('request.jwt.claims','{"app_metadata":{"role":"editor"}}',true);
  err:=null;
  begin update public.social_settings set delay_minutes=999 where id=true; get diagnostics n=row_count; err:='MAJ('||n||')';
  exception when others then err:='refus'; end;
  execute format('set local role %I', orig);
  insert into _rls values (10,'non-admin NE PEUT PAS modifier social_settings','refus ou MAJ(0)',
     err, err='refus' or err='MAJ(0)');

  -- (11) admin PEUT modifier les réglages (contrôlé)
  set local role authenticated; perform set_config('request.jwt.claims','{"app_metadata":{"role":"admin"}}',true);
  err:=null;
  begin update public.social_settings set delay_minutes=11 where id=true; get diagnostics n=row_count; err:='MAJ('||n||')';
  exception when others then err:='refus'; end;
  execute format('set local role %I', orig);
  insert into _rls values (11,'admin PEUT modifier social_settings (controle)','MAJ(1)', err, err='MAJ(1)');

  -- (12) admin ne peut PAS supprimer le singleton de réglages
  set local role authenticated; perform set_config('request.jwt.claims','{"app_metadata":{"role":"admin"}}',true);
  begin delete from public.social_settings where id=true; get diagnostics n=row_count;
  exception when others then n:=-1; end;
  execute format('set local role %I', orig);
  insert into _rls values (12,'admin NE PEUT PAS supprimer social_settings','0 ligne ou refus',
     case when n<=0 then 'bloque('||n||')' else 'SUPPRIME('||n||')' end, n<=0);

  -- (13) le singleton de réglages est toujours là
  select count(*) into n from public.social_settings where id=true;
  insert into _rls values (13,'singleton social_settings toujours present','1', n::text, n=1);

  -- ========== x_account : non lisible via l'API, même par un admin ==========
  set local role authenticated; perform set_config('request.jwt.claims','{"app_metadata":{"role":"admin"}}',true);
  begin select count(*) into n from public.x_account where id=true;
  exception when others then n:=-1; end;
  execute format('set local role %I', orig);
  insert into _rls values (14,'x_account NON lisible via API meme par admin (service_role only)','0 ou refus',
     case when n<=0 then 'bloque('||n||')' else 'VISIBLE('||n||')' end, n<=0);

  -- Restaure les réglages initiaux + nettoyage des sondes
  update public.social_settings set x_enabled=init_enabled, delay_minutes=init_delay,
         last_enqueue_error=init_err, last_enqueue_error_at=init_err_at where id=true;
  delete from public.social_posts where article_slug in ('rls-probe','rls-anon-ins','rls-admin-ins');
end $$;

select k, test, attendu, obtenu, case when pass then 'PASS' else 'FAIL' end as resultat
from _rls order by k;
drop table if exists _rls;
