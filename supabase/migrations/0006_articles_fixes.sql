-- 0006_articles_fixes.sql
-- Correctifs CIBLÉS du système d'articles (3 problèmes diagnostiqués). Ne touche à RIEN d'autre.
--
-- GARANTIES :
--   * 100 % ADDITIF / NON DESTRUCTIF : uniquement `create or replace` d'objets EXISTANTS
--     (vue articles_public + RPC save_article/publish_article). Aucune table, colonne ni donnée
--     supprimée. Aucun backfill (décision : repli calculé, pas d'écriture des données).
--   * IDEMPOTENT : rejouable sans erreur ni doublon.
--   * Réutilise public.is_current_user_admin() (NON redéfinie).
--   * N'ajoute AUCUNE colonne aux tables. La date « effective » est CALCULÉE dans la vue.
--
-- PÉRIMÈTRE : n'affecte pas la programmation (chantier séparé), ni le lecteur PDF, ni les jeux,
-- ni les classements/points, ni aucune autre fonctionnalité.

-- =====================================================================
-- 1) Vue publique : + created_at  + effective_published_at = coalesce(published_at, created_at)
--    NB : `create or replace view` n'autorise QUE l'ajout de colonnes EN FIN de liste
--         (les 26 colonnes existantes restent identiques, dans le même ordre).
-- =====================================================================
create or replace view public.articles_public as
  select id,editorial_id,slug,title,deck,hero_image,hero_alt,hero_caption,hero_credit,hero_cover,author,status,
         published_at,featured,reading_time,seo_title,seo_description,og_image,zone_id,competition_id,genre_id,
         dossier_id,chapter_position,chapter_label,journal_slug,updated_at,
         -- Ajouts (fin de liste) :
         created_at,
         coalesce(published_at, created_at) as effective_published_at
  from public.articles
  where status='archived' or (status='published' and (published_at is null or published_at <= now()));

comment on view public.articles_public is
  'Vue publique des articles (publiés/archivés). effective_published_at = coalesce(published_at, created_at) : sert au tri chronologique et à l''affichage (repli sans réécriture des données).';

-- =====================================================================
-- 2) save_article : PRÉSERVE published_at / scheduled_at quand la clé est ABSENTE du payload.
--    Correctif : l'enregistrement d'un article publié (y compris l'autosave) ne doit JAMAIS
--    remettre published_at à NULL. On distingue « clé absente » (on garde l'existant) de
--    « clé présente » (valeur explicite, même null → volontaire). Le reste est identique à 0005.
-- =====================================================================
create or replace function public.save_article(p_article jsonb, p_blocks jsonb)
returns public.articles language plpgsql security definer set search_path=public as $$
declare a public.articles; b jsonb; i int := 0;
begin
  if not public.is_current_user_admin() then raise exception 'not_admin'; end if;
  insert into public.articles as t (
    id,slug,title,deck,hero_image,hero_alt,hero_caption,hero_credit,hero_cover,author,status,published_at,scheduled_at,
    featured,reading_time,seo_title,seo_description,og_image,zone_id,competition_id,genre_id,dossier_id,chapter_position,chapter_label,journal_slug)
  values (
    coalesce((p_article->>'id')::uuid, gen_random_uuid()),
    p_article->>'slug', p_article->>'title', p_article->>'deck',
    p_article->>'hero_image', p_article->>'hero_alt', p_article->>'hero_caption', p_article->>'hero_credit',
    coalesce((p_article->>'hero_cover')::bool,false), p_article->>'author',
    coalesce((p_article->>'status')::public.article_status,'draft'),
    (p_article->>'published_at')::timestamptz, (p_article->>'scheduled_at')::timestamptz,
    coalesce((p_article->>'featured')::bool,false), (p_article->>'reading_time')::int,
    p_article->>'seo_title', p_article->>'seo_description', p_article->>'og_image',
    p_article->>'zone_id', p_article->>'competition_id', p_article->>'genre_id',
    (p_article->>'dossier_id')::uuid, (p_article->>'chapter_position')::int, p_article->>'chapter_label', p_article->>'journal_slug')
  on conflict (id) do update set
    slug=excluded.slug,title=excluded.title,deck=excluded.deck,hero_image=excluded.hero_image,hero_alt=excluded.hero_alt,
    hero_caption=excluded.hero_caption,hero_credit=excluded.hero_credit,hero_cover=excluded.hero_cover,author=excluded.author,
    status=excluded.status,
    -- PRÉSERVATION : si le payload ne fournit PAS la clé, on garde la valeur existante (t.*).
    published_at = case when p_article ? 'published_at' then excluded.published_at else t.published_at end,
    scheduled_at = case when p_article ? 'scheduled_at' then excluded.scheduled_at else t.scheduled_at end,
    featured=excluded.featured,
    reading_time=excluded.reading_time,seo_title=excluded.seo_title,seo_description=excluded.seo_description,og_image=excluded.og_image,
    zone_id=excluded.zone_id,competition_id=excluded.competition_id,genre_id=excluded.genre_id,dossier_id=excluded.dossier_id,
    chapter_position=excluded.chapter_position,chapter_label=excluded.chapter_label,journal_slug=excluded.journal_slug
  returning * into a;
  -- blocs : remplacement atomique (inchangé)
  delete from public.article_blocks where article_id = a.id;
  if p_blocks is not null then
    for b in select * from jsonb_array_elements(p_blocks) loop
      insert into public.article_blocks(article_id,position,type,content)
      values (a.id, i, b->>'type', coalesce(b->'content','{}'::jsonb));
      i := i + 1;
    end loop;
  end if;
  return a;
end $$;

-- =====================================================================
-- 3) publish_article : la date de publication est FIGÉE à la 1re publication.
--    Correctif : re-publier un article déjà daté NE réécrit PAS published_at.
--    - p_when fourni (non null)  -> date volontaire (règle 6 : changement explicite)
--    - sinon, published_at existant -> conservé (règle 4 : une correction ne remonte pas l'article)
--    - sinon (1re publication)     -> now()
--    Le reste (featured atomique, version archivée) est identique à 0005.
-- =====================================================================
create or replace function public.publish_article(p_id uuid, p_featured boolean default false, p_when timestamptz default null)
returns public.articles language plpgsql security definer set search_path=public as $$
declare a public.articles;
begin
  if not public.is_current_user_admin() then raise exception 'not_admin'; end if;
  update public.articles
     set status='published',
         published_at = coalesce(p_when, published_at, now())
   where id=p_id returning * into a;
  if a.id is null then raise exception 'article_not_found'; end if;
  if p_featured then
    update public.articles set featured=false where featured=true and id<>p_id;   -- l'ancien reste 'published'
    update public.articles set featured=true  where id=p_id;
  end if;
  insert into public.article_versions(article_id,label,snapshot,created_by)
  values (a.id, 'publication', jsonb_build_object(
            'article', to_jsonb(a),
            'blocks', coalesce((select jsonb_agg(jsonb_build_object('type',type,'content',content) order by position) from public.article_blocks where article_id=a.id),'[]'::jsonb)),
          auth.uid());
  return a;
end $$;

-- Droits (identiques à 0005 ; ré-affirmés par sécurité).
revoke all on function public.save_article(jsonb,jsonb) from anon;
revoke all on function public.publish_article(uuid,boolean,timestamptz) from anon;
grant execute on function public.save_article(jsonb,jsonb) to authenticated;
grant execute on function public.publish_article(uuid,boolean,timestamptz) to authenticated;

-- Fin 0006_articles_fixes.sql
