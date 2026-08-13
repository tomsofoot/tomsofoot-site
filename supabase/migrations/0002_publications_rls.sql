-- 0002_publications_rls.sql
-- Sécurité niveau ligne (RLS) pour public.publications.
-- Principe : lecture publique des seuls numéros visibles ; écriture réservée à
-- l'administrateur. AUCUNE clé service_role côté navigateur.
-- N'affecte que la table du module magazine.

alter table public.publications enable row level security;

-- Détermine si l'utilisateur courant est administrateur.
-- Par défaut : présence du claim JWT app_metadata.role = 'admin'.
-- Adaptez à votre convention (table profiles.role, allowlist d'emails, etc.).
create or replace function public.is_admin()
returns boolean language sql stable as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;

-- Lecture publique : uniquement les numéros visibles (mêmes règles que la vue).
drop policy if exists publications_read_public on public.publications;
create policy publications_read_public
  on public.publications for select
  to anon, authenticated
  using (
    status = 'archived'
    or (status = 'published' and (published_at is null or published_at <= now()))
    or (status = 'scheduled' and published_at is not null and published_at <= now())
    or public.is_admin()   -- l'admin voit aussi brouillons/programmés
  );

-- Écriture (insert/update/delete) : administrateur uniquement.
drop policy if exists publications_write_admin on public.publications;
create policy publications_write_admin
  on public.publications for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Rappel : le client public utilise UNIQUEMENT la clé anon. Les écritures
-- échouent pour tout utilisateur non-admin grâce aux policies ci-dessus.
