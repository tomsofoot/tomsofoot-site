# Publier un nouveau journal (sans toucher au code)

Le lecteur affiche les numéros décrits dans **`publications.json`**. La
publication mise « à la une » sur l'accueil est celle marquée `featured: true`
(et non une URL codée en dur).

## Ce qui se met à jour AUTOMATIQUEMENT à chaque publication

Dès qu'un numéro devient le `featured` visible, **sans code et sans IA** :

- le **bandeau rouge** de l'accueil (« Le numéro N est en ligne · <titre> ») ;
- la **carte magazine** de l'accueil (surtitre « Le magazine · N°N », **titre**,
  pastille « N°N », bouton, couverture, lien) ;
- le **lien** magazine (accueil, menu, carrousel) ouvre ce numéro précis ;
- le **kiosque** `magazine/index.html` (à la une + archives) et le **lecteur**.

Le grand **titre héros** en haut de l'accueil reste piloté par `contenu.json`
(c'est un « article du jour » que vous éditez quand vous voulez).

Régle d'or : mettez **un seul** numéro en `featured: true`. Pour changer la une,
passez l'ancien à `featured: false` et le nouveau à `featured: true`.

## Préparer le PDF (Canva)

Exportez depuis Canva : **Partager → Télécharger → PDF pour impression → Toutes
les pages**. Ne cochez **pas** « Aplatir le PDF », pas de traits de coupe, pas
de fond perdu. Le texte doit rester **vectoriel et sélectionnable**.

Le journal TomsoFoot est composé en **doubles pages paysage** : 1 page PDF = 2
pages de magazine. Un journal de 14 pages PDF = 28 pages de magazine.

## Méthode A — Régie no-code (Pages CMS) · mode actuel

1. Ouvrez la régie (Pages CMS) du dépôt.
2. Menu **« Numéros (PDF) »** → téléversez votre `nXX.pdf` (il arrive dans
   `numeros/`).
3. Menu **« Journaux (lecteur) »** → **Ajouter** un numéro et remplissez :
   - **Slug** : identifiant d'URL unique (minuscules-tirets), ex. `n13-france-bresil`.
   - **Titre**, **Sous-titre**, **Résumé**, **N° d'édition**.
   - **Date de publication** ; **Publier à partir de** (ISO) pour programmer.
   - **Statut** : `draft` (invisible), `scheduled` (apparaît à la date),
     `published` (visible), `archived` (reste dans les archives).
   - **Couverture** / **Miniature** (images).
   - **Chemin du PDF** : `numeros/nXX.pdf`.
   - **Version du PDF** : `v1` (incrémentez à chaque remplacement, cf. plus bas).
   - **Nombre de pages** (magazine), **À la une**, **Autoriser le téléchargement**,
     **Texte alternatif**.
4. Enregistrez. Pages CMS crée un commit. Après déploiement Netlify, le numéro
   est en ligne : `https://tomsofoot.fr/magazine/lecteur.html?edition=SLUG`.

Aucune modification de code, aucune IA nécessaire.

## Méthode B — Édition directe de `publications.json`

Ajoutez un objet dans le tableau `publications` (mêmes champs, en `snake_case`).
Committez `publications.json` et le PDF dans `numeros/`.

```json
{
  "slug": "n13-france-bresil",
  "title": "France–Brésil, la finale",
  "subtitle": "Atlanta, l'apothéose",
  "issue_number": 13,
  "publication_date": "2026-08-20",
  "status": "published",
  "cover_url": "images/couverture-n13.jpg",
  "thumbnail_url": "images/couverture-n13.jpg",
  "pdf_url": "numeros/n13.pdf",
  "pdf_version": "v1",
  "page_count": 28,
  "featured": true,
  "download_enabled": true,
  "alt_text": "Couverture du numéro 13"
}
```

Mettre **un seul** numéro en `featured: true` (c'est lui qui s'ouvre depuis la
carte magazine de l'accueil).

## Remplacer un PDF déjà publié

Ne réécrivez **pas** le même fichier avec la même URL (risque de cache). Donnez
un nouveau nom (`n13-v2.pdf`) et passez `pdf_version` à `v2`. Le lecteur repart
alors proprement (et la reprise de lecture ne pointe pas vers une page obsolète).

## Programmer une parution

`status: "scheduled"` + `published_at` (ISO, ex. `2026-08-20T08:00:00Z`). Le
numéro apparaît automatiquement à cette date (horloge du visiteur).

## Passer au stockage Supabase (optionnel)

Voir `supabase/README-migrations.md` et la régie `magazine/regie-magazine.html`
(téléversement PDF + couverture + miniature, comptage de pages automatique).
