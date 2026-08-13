# Lecteur de journal TomsoFoot — fichier de reprise (dev / IA)

Document de passation : architecture, décisions, points d'attention.

## But

Feuilleter les journaux Canva (PDF multipages) page à page, **net** (jamais de
JPG), **texte sélectionnable**, sur ordinateur (double page) et mobile (une
page). Indépendant du jeu Jogadle.

## Arborescence

```
magazine/
  index.html              Kiosque (liste des numéros, à la une + archives)
  lecteur.html            Coquille HTML du lecteur (charge le module)
  regie-magazine.html     Régie admin (chemin Supabase, optionnel)
assets/
  css/magazine-reader.css Styles + couche texte PDF.js + responsive + reduced-motion
  js/magazine-reader/
    pdf-loader.js         Charge le PDF (worker vendorisé), erreurs typées
    pdf-renderer.js       Rendu HiDPI d'une page/moitié + couche texte + annulation
    flipbook-controller.js Feuilletage MAISON (CSS 3D), pas de dépendance externe
    reader-controls.js    Barre d'outils, clavier, zoom, plein écran, miniatures
    reader-state.js       Reprise de lecture (localStorage, par slug+version)
    accessibility.js      reduced-motion, annonces ARIA, tactile
    source-adapter.js     Résout ?edition=slug -> métadonnées + URL PDF
    main.js               Orchestration + états (chargement/erreur/reprise)
  vendor/
    pdfjs/                PDF.js (moteur + worker, paire identique), local
    page-flip/            (présent mais NON utilisé, cf. décision ci-dessous)
    VERSIONS.md
publications.json         Registre des numéros (featured, archives, statut…)
supabase/migrations/      0001 table · 0002 RLS · 0003 storage (prêts à appliquer)
docs/                     PUBLIER-UN-JOURNAL.md, ce fichier
tests/                    reader.spec.mjs (Playwright), CHECKLIST.md
```

## Modèle de pagination (important)

Le PDF est composé en **doubles pages paysage** (1080×705 pt) : 1 page PDF = 2
pages de magazine. Le lecteur découpe chaque page PDF en **moitié gauche** et
**moitié droite** (via un viewport PDF.js décalé `offsetX`). Résultat :
`2 × numPages` feuilles. Sur desktop, StPageFlip-like : couverture seule puis
paires (2-3, 4-5…) ; sur mobile, une feuille à la fois.

## Netteté (cœur du sujet)

`pdf-renderer.js` applique le principe HiDPI de la spécification : le canvas est
rendu à `tailleCSS × devicePixelRatio (× superSample zoom)`, jamais étiré en CSS.
La couche texte PDF.js (`TextLayer`) est superposée, alignée, sélectionnable
(accents FR corrects). Au zoom, on **re-rend** (superSample) au repos ; pendant
le geste, une transformation CSS temporaire est tolérée.

## Décision clé : moteur de feuilletage maison

`page-flip` (StPageFlip 2.0.7) était prévu, mais son **mode HTML rasterise les
pages en interne et se déforme sur écran Retina/mobile (devicePixelRatio ≥ 2)** —
inacceptable puisque la netteté est une exigence ferme. Il a été **remplacé par
un moteur maison** (`flipbook-controller.js`) : feuilles rigides en **CSS 3D
(rotateY autour de la reliure)**, qui conservent le **vrai canvas DOM + la couche
texte** (net à toute densité, sélectionnable). Compromis assumé : tournage de
page **rigide et élégant** plutôt que courbure « papier souple » (cette dernière
n'existe, dans StPageFlip, qu'en mode rasterisé — donc flou au zoom). Le dossier
`vendor/page-flip/` est conservé pour référence mais n'est plus chargé.

## Source des données

`source-adapter.js` lit `publications.json` (racine), applique la visibilité
(published/scheduled échu/archived ; draft masqué), résout `?edition=slug`,
gère les anciens liens `?pdf=` et absolutise les URLs par rapport à la racine du
site. Hook `resolveViaSupabase()` prêt (désactivé) pour basculer vers Supabase.

## Rendu / performance

Rendu paresseux : seules les feuilles visibles (± voisines) sont peintes ;
placeholders sinon ; annulation propre des rendus périmés
(`RenderingCancelledException`). Cache des objets `page` PDF.js.

## Accessibilité / erreurs

Clavier (flèches, Home/End, +/- zoom, F plein écran, T sommaire, Échap),
`prefers-reduced-motion` (tournage instantané), focus visible, annonces ARIA,
messages d'erreur distincts (introuvable / réseau / invalide / rendu / navigateur)
avec « Réessayer » et « Ouvrir le PDF dans le navigateur ».

## Limites connues

- Photos du PDF source en résolution web (~112–285 ppp) : nettes à 100 %, elles
  s'adoucissent au zoom fort — **signalé** dans l'UI, non « inventé ».
- Tournage rigide (voir décision moteur).
- Recherche plein-texte dans le journal : non incluse (la couche texte est en
  place ; base pour l'ajouter ultérieurement).

## Pour étendre

- Nouveau numéro : `docs/PUBLIER-UN-JOURNAL.md`.
- Basculer Supabase : `supabase/README-migrations.md` + activer
  `resolveViaSupabase`.
- Mettre à jour PDF.js : remplacer **moteur ET worker** ensemble (cf.
  `assets/vendor/VERSIONS.md`).
