-- 0003_storage_publications.sql
-- Bucket de stockage "publications" (PDF, couvertures, miniatures) + policies.
-- Lecture publique ; écriture/suppression réservées à l'administrateur.
-- Validation MIME/taille recommandée côté client ET via le bucket.

-- 1) Bucket public (lecture) — les écritures restent protégées par les policies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'publications', 'publications', true,
  52428800,                                   -- 50 Mo max par fichier
  array['application/pdf','image/webp','image/jpeg','image/png']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2) Policies storage.objects pour ce bucket uniquement.
drop policy if exists publications_obj_read on storage.objects;
create policy publications_obj_read
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'publications');

drop policy if exists publications_obj_write on storage.objects;
create policy publications_obj_write
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'publications' and public.is_admin());

drop policy if exists publications_obj_update on storage.objects;
create policy publications_obj_update
  on storage.objects for update
  to authenticated
  using (bucket_id = 'publications' and public.is_admin())
  with check (bucket_id = 'publications' and public.is_admin());

drop policy if exists publications_obj_delete on storage.objects;
create policy publications_obj_delete
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'publications' and public.is_admin());

-- Organisation conseillée des chemins (évite d'écraser un ancien PDF en cache) :
--   publications/2026/08/n13-<slug>/journal-v1.pdf
--   publications/2026/08/n13-<slug>/couverture.webp
--   publications/2026/08/n13-<slug>/miniature.webp
-- Pour un remplacement : nouveau nom/version (journal-v2.pdf) + pdf_version = 'v2'.
--
-- NUMÉROS PRIVÉS / MEMBRES (optionnel) : créer un bucket séparé NON public
-- (ex. 'publications-prive'), lecture via URL signée générée par une Edge
-- Function qui vérifie les droits. Ne jamais exposer la clé service_role.
