-- 0006_articles_prive.sql
-- Bucket PRIVÉ pour les PDF d'ARTICLES au format A4 (brouillons ET publiés).
-- Même modèle de sécurité que 0005_journaux_prive.sql (bucket 'journaux') :
--   - accès uniquement par URL signée temporaire générée par le serveur Storage ;
--   - un visiteur anonyme n'obtient une signature QUE si un article visible
--     (published / archived, échéance respectée) référence exactement l'objet ;
--   - un brouillon (draft) n'est signable que par le compte administrateur.
-- Aucune clé service_role. ADDITIF : ne modifie aucune table/donnée existante,
-- ne touche ni Jogadle, ni le classement, ni les comptes, ni le bucket 'journaux'.
--
-- La colonne publications.pdf_bucket (créée en 0005) porte déjà 'journaux' ou
-- 'articles' ; la colonne kind ('journal' | 'article') distingue le type.
-- La couverture/miniature reste dans le bucket PUBLIC 'publications'.

-- 1) Bucket privé (public = false), PDF uniquement.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('articles', 'articles', false, 104857600, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2) Policies storage.objects — portée « articles » uniquement.
-- Lecture (= droit de signer) pour ANON : seulement si un article réellement
-- visible pointe sur cet objet. Un brouillon n'a pas de ligne visible par anon
-- (RLS de publications) → non signable publiquement.
drop policy if exists articles_read_public on storage.objects;
create policy articles_read_public
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'articles'
    and exists (
      select 1 from public.publications p
      where p.pdf_bucket = 'articles'
        and p.pdf_path = storage.objects.name
        and (
          p.status = 'archived'
          or (p.status = 'published' and (p.published_at is null or p.published_at <= now()))
        )
    )
  );

-- L'admin lit tout le bucket (prévisualisation des brouillons).
drop policy if exists articles_read_admin on storage.objects;
create policy articles_read_admin
  on storage.objects for select to authenticated
  using (bucket_id = 'articles' and public.is_current_user_admin());

-- Écriture / mise à jour / suppression : administrateur uniquement.
drop policy if exists articles_write_admin on storage.objects;
create policy articles_write_admin
  on storage.objects for insert to authenticated
  with check (bucket_id = 'articles' and public.is_current_user_admin());

drop policy if exists articles_update_admin on storage.objects;
create policy articles_update_admin
  on storage.objects for update to authenticated
  using (bucket_id = 'articles' and public.is_current_user_admin())
  with check (bucket_id = 'articles' and public.is_current_user_admin());

drop policy if exists articles_delete_admin on storage.objects;
create policy articles_delete_admin
  on storage.objects for delete to authenticated
  using (bucket_id = 'articles' and public.is_current_user_admin());

-- Organisation des chemins (versionnée, jamais d'écrasement) :
--   AAAA/MM/<slug>/article-vN-<horodatage>.pdf
