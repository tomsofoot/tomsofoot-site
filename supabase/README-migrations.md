# Migrations Supabase — module magazine (lecteur de journal)

Ces migrations sont **livrées prêtes à appliquer** mais **non requises** dans le
mode actuel (« dépôt / Netlify »). Le lecteur lit aujourd'hui les PDF depuis le
dépôt (`numeros/…`) et les métadonnées depuis `publications.json`. Appliquez ces
migrations le jour où vous voulez passer au stockage Supabase et/ou proposer des
numéros privés (membres).

## Ce qui est créé (et RIEN d'autre)

- `public.publications` : table des numéros (isolée du jeu).
- `public.publications_public` : vue ne renvoyant que les numéros visibles.
- `public.is_admin()` : fonction déterminant l'administrateur (à adapter).
- RLS : lecture publique des numéros visibles, écriture **admin uniquement**.
- Bucket Storage `publications` : lecture publique, écriture admin uniquement.

Aucune table Jogadle / classement / points / comptes / Supabase Auth n'est
modifiée.

## Application

Ordre impératif : `0001` → `0002` → `0003`.

Option A — SQL editor (tableau de bord Supabase) : collez et exécutez chaque
fichier dans l'ordre.

Option B — CLI :

```bash
supabase link --project-ref VOTRE_REF
supabase db push        # applique les fichiers de supabase/migrations
```

## Définir l'administrateur

`is_admin()` renvoie vrai si le JWT contient `app_metadata.role = 'admin'`.
Pour promouvoir un compte (à exécuter par un rôle de service, jamais dans le
navigateur) :

```sql
update auth.users
set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb
where email = 'admin@tomsofoot.fr';
```

Adaptez `is_admin()` si vous utilisez plutôt une table `profiles(role)` ou une
liste d'emails autorisés.

## Basculer le lecteur vers Supabase

1. Appliquez `0001`–`0003`.
2. Renseignez la table `publications` (ou via la régie, cf.
   `magazine/regie-magazine.html`).
3. Dans `assets/js/magazine-reader/source-adapter.js`, activez
   `resolveViaSupabase()` (lecture via clé **anon** de `publications_public`) et
   faites pointer `resolveFromLocation` dessus. Le reste du lecteur est inchangé
   (il reçoit une URL de PDF).
4. Pour des numéros **privés** : bucket non public + URL signée générée par une
   Edge Function contrôlant les droits. **Jamais** de clé `service_role` côté
   navigateur.

## Règles de sécurité (rappel)

- Aucune clé `service_role` dans le navigateur, GitHub ou un fichier JS public.
- Écritures/suppressions réservées à l'admin (RLS + Storage policies).
- Validez type MIME, extension et taille avant tout téléversement.
- Ne réécrivez pas un PDF en gardant la même URL : changez de nom/version pour
  éviter qu'un ancien fichier reste en cache.
