-- 0007_tests.sql — Suite de validation de l'automatisation X (corrigée v2).
-- À exécuter sur le STAGING après application de 0007 (v2). Ne crée que des données de test,
-- qu'il nettoie à la fin. Renvoie une table (test, attendu, obtenu, PASS/FAIL).
-- N'exécute AUCUN appel réseau / aucun appel à X : tout est au niveau base.

drop table if exists _res;
create temp table _res(k int, test text, attendu text, obtenu text, pass boolean);

do $$
declare
  a1 uuid; a2 uuid; n int; s text; sa1 timestamptz; sa2 timestamptz; ver uuid;
begin
  -- Réglages : automatisation ACTIVE, délai 10 min, pas d'erreur résiduelle
  update public.social_settings set x_enabled=true, delay_minutes=10, last_enqueue_error='ancienne erreur', last_enqueue_error_at=now() where id=true;

  -- T1 : publication -> 1 tâche 'scheduled' à published_at + 10 min
  insert into public.articles(slug,title,deck,status,published_at)
    values('t-e2e-1','E2E 1','x','published', now()) returning id into a1;
  select count(*), max(scheduled_at) into n, sa1 from public.social_posts where article_id=a1;
  insert into _res values (1,'T1 publication -> 1 tache scheduled','1', n::text, n=1);
  insert into _res values (1,'T1 scheduled_at = published_at+10min','~10min',
     (extract(epoch from (sa1 - (select published_at from public.articles where id=a1)))/60)::int::text,
     abs(extract(epoch from (sa1 - (select published_at from public.articles where id=a1)))/60 - 10) < 0.5);

  -- T12 : enqueue reussi -> bandeau d'erreur EFFACE
  select last_enqueue_error into s from public.social_settings where id=true;
  insert into _res values (12,'T12 bandeau erreur efface apres enqueue','NULL', coalesce(s,'NULL'), s is null);

  -- T3 : anti-doublon — re-UPDATE publie du meme article -> toujours 1 ligne
  update public.articles set title='E2E 1 bis' where id=a1;   -- ne change pas published_at
  update public.articles set published_at = now() where id=a1; -- re-declenche l'enqueue
  select count(*) into n from public.social_posts where article_id=a1;
  insert into _res values (3,'T3 anti-doublon (toujours 1 ligne)','1', n::text, n=1);

  -- T7 : published_at change -> scheduled_at reprogramme (tache encore scheduled)
  select scheduled_at into sa1 from public.social_posts where article_id=a1;
  update public.articles set published_at = now() + interval '1 hour' where id=a1;
  select scheduled_at into sa2 from public.social_posts where article_id=a1;
  insert into _res values (7,'T7 scheduled_at reprogramme si date change','change', case when sa2>sa1 then 'change' else 'inchange' end, sa2 > sa1);

  -- T4 : republication apres annulation -> RE-ARME la meme ligne (pas de 2e)
  update public.social_posts set status='cancelled' where article_id=a1;
  update public.articles set published_at = now() where id=a1;  -- re-publie
  select count(*), max(status::text) into n, s from public.social_posts where article_id=a1;
  insert into _res values (4,'T4 republi. apres annulation: 1 ligne re-armee','1/scheduled', n::text||'/'||s, n=1 and s='scheduled');

  -- T5 : republication apres echec 'failed' -> re-armee
  update public.social_posts set status='failed', attempt_count=3, last_error='x' where article_id=a1;
  update public.articles set published_at = now() where id=a1;
  select status::text, attempt_count into s, n from public.social_posts where article_id=a1;
  insert into _res values (5,'T5 republi. apres echec: re-armee + compteur reset','scheduled/0', s||'/'||n::text, s='scheduled' and n=0);

  -- T6 : pas de reprogrammation d'un 'published' reel
  update public.social_posts set status='published', dry_run=false, scheduled_at=now()-interval '1 day' where article_id=a1;
  select scheduled_at into sa1 from public.social_posts where article_id=a1;
  update public.articles set published_at = now() where id=a1;  -- tentative de re-enqueue
  select status::text, scheduled_at into s, sa2 from public.social_posts where article_id=a1;
  insert into _res values (6,'T6 pas de reprog. d''un post publie','published/inchange', s||'/'||case when sa2=sa1 then 'inchange' else 'change' end, s='published' and sa2=sa1);

  -- T8 : depublication -> tache scheduled annulee
  insert into public.articles(slug,title,status,published_at) values('t-e2e-2','E2E 2','published', now()) returning id into a2;
  update public.articles set status='draft' where id=a2;
  select status::text into s from public.social_posts where article_id=a2;
  insert into _res values (8,'T8 depublication -> tache annulee','cancelled', coalesce(s,'(aucune)'), s='cancelled');

  -- T2 : x_enabled=false -> aucune tache creee
  update public.social_settings set x_enabled=false where id=true;
  insert into public.articles(slug,title,status,published_at) values('t-e2e-3','E2E 3','published', now()) returning id into a1;
  select count(*) into n from public.social_posts where article_id=a1;
  insert into _res values (2,'T2 x_enabled=false -> aucune tache','0', n::text, n=0);
  update public.social_settings set x_enabled=true where id=true;

  -- T9 + T11 : suppression d'un article -> tache scheduled annulee, snapshot conserve, article_id null
  insert into public.articles(slug,title,status,published_at) values('t-e2e-4','E2E 4 titre','published', now()) returning id into a2;
  -- simule un post deja publie (historique a conserver)
  update public.social_posts set status='published', dry_run=true, article_title='E2E 4 titre', article_slug='t-e2e-4', article_url='https://tomsofoot.fr/articles/t-e2e-4' where article_id=a2;
  delete from public.articles where id=a2;
  select count(*), max(article_title), max(article_id::text) into n, s, ver::text from public.social_posts where article_slug='t-e2e-4';
  insert into _res values (9,'T9/T11 suppression: historique conserve, article_id null, snapshot ok','1/E2E 4 titre/null',
     n::text||'/'||coalesce(s,'null')||'/'||coalesce((select article_id::text from public.social_posts where article_slug='t-e2e-4'),'null'),
     n=1 and s='E2E 4 titre' and (select article_id from public.social_posts where article_slug='t-e2e-4') is null);

  -- T10 : aucune policy DELETE sur social_posts (historique non supprimable via API)
  select count(*) into n from pg_policies where schemaname='public' and tablename='social_posts' and cmd='DELETE';
  insert into _res values (10,'T10 aucune policy DELETE sur social_posts','0', n::text, n=0);

  -- T13 : anon/authenticated ne peuvent PAS executer les fonctions trigger
  select count(*) into n from information_schema.role_routine_grants
    where routine_schema='public' and routine_name in ('tg_articles_social_enqueue','tg_articles_social_on_delete','tg_touch_updated_at_social')
      and grantee in ('anon','authenticated') and privilege_type='EXECUTE';
  insert into _res values (13,'T13 fonctions trigger non executables par anon/authenticated','0', n::text, n=0);

  -- T13b : social_cancel executable par authenticated, PAS par anon
  select count(*) into n from information_schema.role_routine_grants
    where routine_schema='public' and routine_name='social_cancel' and grantee='anon' and privilege_type='EXECUTE';
  insert into _res values (13,'T13b social_cancel non executable par anon','0', n::text, n=0);

  -- Nettoyage des donnees de test
  delete from public.social_posts where article_slug like 't-e2e-%' or article_id in (a1,a2);
  delete from public.articles where slug like 't-e2e-%';
  update public.social_settings set last_enqueue_error=null, last_enqueue_error_at=null where id=true;
end $$;

-- Résultats
select k, test, attendu, obtenu, case when pass then 'PASS' else 'FAIL' end as resultat
from _res order by k, test;
drop table if exists _res;
