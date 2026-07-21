# TomsoFoot — Comment publier un nouveau numéro

## Le principe

Le lecteur (`lecteur.html`) lit **directement un fichier PDF**. Il découpe tout seul
les doubles pages exportées depuis Canva, affiche la double page sur ordinateur
et une seule page sur téléphone. Aucune conversion à faire.

## Publier un nouveau numéro en 3 étapes

1. Exportez votre numéro depuis Canva en **PDF**.
2. Renommez-le simplement, sans espaces ni accents, par exemple `n13.pdf`,
   puis placez-le dans le dossier `numeros/`.
3. Dans `index.html`, remplacez partout `numeros/n12.pdf` par `numeros/n13.pdf`.

Puis redéposez le dossier complet sur Netlify.

## Voir un numéro directement

L'adresse du lecteur accepte le nom du fichier :

- `lecteur.html?pdf=numeros/n12.pdf`
- `lecteur.html?pdf=numeros/n13.pdf`

Les anciens numéros restent donc lisibles tant que leur PDF est dans `numeros/`.

## Alléger un PDF trop lourd

Un export Canva dépasse souvent 10 Mo, ce qui est long à charger sur téléphone.
Le numéro 12 a été ramené de 11 Mo à 3,4 Mo sans perte visible.
Visez moins de 5 Mo. Sur Canva, exportez en « PDF standard » plutôt que
« PDF impression », ou demandez une compression.

## Contenu du dossier

- `index.html` — la page d'accueil
- `lecteur.html` — le lecteur tourne-pages
- `numeros/` — vos PDF
- `images/` — les photos utilisées sur l'accueil
- `lib/` — les bibliothèques du lecteur (ne pas modifier)
- `favicon.svg` — le logo affiché dans l'onglet du navigateur

## Ce qui n'est pas encore automatique

Les titres, les textes et les photos de la page d'accueil sont écrits
directement dans `index.html`. Pour les changer sans toucher au code,
il faudra ajouter un espace d'administration (CMS).
