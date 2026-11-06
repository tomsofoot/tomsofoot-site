# « Défie ton pote » — intégration de l'animation validée (mobile et ordinateur)

Direction validée : **modèle 3, néon et effets spéciaux**. Boutons bleu nuit satinés, chiffres
blancs, six segments néon par case, deux épées 3D qui s'entrechoquent, traînées lumineuses, ondes
de choc, étincelles et révélation dorée. Chronologie de 8 s à 60 i/s : extinctions à **0,86 s**
et **1,79 s** (par paires), duel des deux finalistes, perdante éteinte à **3,16 s**, bandeau doré
à **3,25 s**.

## 1. Point bloquant (à lire en premier)

Le module **Pronostics** (classements général et privé, défi du jour) **n'est pas dans ce dépôt** :

- la production (`tomsofoot.fr`, déploiement Netlify `6aed1dc98ae6c6d280f4f813`, « v9.136 … Pronostics :
  classement, résultats par jour, défi du jour (2 points à voler à un pote) … ») est publiée **en CLI
  depuis le PC de Thomas** (`…\Codex\2026-09-20\j\work\tomsofoot-release/`), pas depuis `main` ;
- les fonctions serveur `pronostics`, `pronostics-resultats` (tâche toutes les 20 min) et
  `pronostics-moderation`, ainsi que le client du module, n'existent dans aucune branche de
  `tomsofoot/tomsofoot-site` ni dans les autres dépôts accessibles ;
- depuis l'environnement de travail, `tomsofoot.fr` et `*.netlify.app` sont inaccessibles (proxy) et
  aucun dossier du PC n'était partagé (Remote Control).

**Conséquence.** Cette livraison est l'**intégration visuelle indépendante** : un composant complet,
paramétré par les vraies données du défi, déterministe et **sans aucun appel serveur**. Le
branchement sur l'API réelle (section 3) et les règles serveur (mise, droits, règlement unique,
classements) restent à faire dans la source de production, qui doit d'abord être rapatriée dans le
dépôt ou partagée.

**Question ouverte (règle de jeu).** En production, le défi du jour vaut aujourd'hui **2 points**. La
grille validée propose **1, 2, 3, 5, 7, 10**. Il faut décider côté serveur comment la mise est
choisie parmi les montants autorisés (tirage serveur ? choix du joueur ?) et quels montants sont
autorisés (règle de la démo : ≤ solde du joueur le moins doté). Le composant affiche fidèlement ce
que le serveur décide ; il ne décide rien.

## 2. Ce que fait le composant

| Garantie | Comment |
|---|---|
| Vraies données | Joueurs, points, mise validée, montants autorisés et (facultatif) plan enregistré passés en paramètres. Plus aucun « 10 PTS », « Tomso 35 » ni indice d'élimination codé en dur. |
| Serveur = autorité | Le composant n'effectue **aucune requête** (vérifié par test : uniquement des GET de ressources locales). Il ne tire pas la mise : il l'affiche. |
| Même résultat partout | Plan d'extinction **dérivé de façon déterministe** de `(identifiant du défi, mise, montants autorisés)` (FNV-1a + mulberry32, aucun `Math.random`) ou **plan enregistré** fourni par le serveur et validé. Mobile, ordinateur, relecture : même plan (vérifié). |
| Aucun mouvement de points | Passer, Fermer, Rejouer, redimensionner, revenir d'arrière-plan ne font que redessiner. Aucun nouveau tirage, aucun envoi. |
| 6 → 4 → 2 → 1 | Six montants éligibles : deux paires puis la perdante finale. Moins d'éligibles : 5 → 4 → 2 → 1, 4 → 3 → 2 → 1, 3 → 3 → 2 → 1, 2 → 2 → 2 → 1. Cases non autorisées verrouillées (cadenas) et éteintes dès le départ. Aucune case éliminée ne se rallume (vérifié sur les 480 images). |
| Minimum 2 points | Un défi où un joueur a moins de 2 points est refusé (repli texte, aucune animation trompeuse). |
| Révélation ≠ victoire | Le texte annonce « Mise révélée : N points en jeu. Le meilleur pronostic remportera le duel. » |

### Composition responsive (même composant, même logique)

- **Portrait** (téléphones, tablette en portrait) : titre, duel, grille empilés aux proportions exactes
  de la référence. Si la hauteur manque, on recadre d'abord le haut vide de la vidéo des épées, puis
  on compacte le titre ; on ne rétrécit l'ensemble qu'en dernier recours.
- **Large** (ordinateur, tablette paysage, téléphone en paysage) : duel à gauche, titre et grille à
  droite, bandeau doré sur les lames. Bords de l'insert vidéo fondus par masque alpha.
- Le mode est choisi automatiquement : celui qui affiche la plus grande grille. La grille reste 3 × 2
  partout. Chiffres ≥ 18 px et unités ≥ 11 px à l'écran (agrandis et recentrés sur petit écran).
- Mobile : plein écran `100dvh`, zones sûres (`env(safe-area-inset-*)`), commandes ≥ 44 px. En paysage
  bas, commandes sur une seule ligne. Ordinateur et tablette : fenêtre centrée, dimensions bornées
  (≤ 1240 px de large).

### Lecture, accessibilité, performances

- **Passer** (bouton ou toucher de l'animation) : image finale immédiate, vidéo recalée sur la pose finale.
- **Son** : coupé par défaut, bouton explicite (`aria-pressed`), préférence mémorisée ; lecture
  uniquement après interaction, resynchronisée sur l'horloge de l'animation. AAC (`son.m4a`), WAV en secours.
- **Clavier** : focus initial sur l'action principale, Tab piégé dans la fenêtre, Échap ferme, focus
  rendu au bouton d'ouverture. Dialogue `role="dialog"` `aria-modal`, résultat annoncé (`role="status"`).
- **prefers-reduced-motion** : image finale et vrai montant immédiatement ; « Voir l'animation » à la demande.
- **Arrière-plan** : pause (boucle et médias), reprise au même instant au retour.
- **Erreurs** : vidéo indisponible → animation sans l'insert ; canvas indisponible ou plan refusé →
  résultat textuel.
- **Démontage** : arrêt de `requestAnimationFrame`, pause et déchargement des médias, retrait des écouteurs.
- **Densité** : ratio de pixels plafonné (2, ou 1,5 sur mobile modeste), particules réduites sur
  mobile (0,85) et appareils modestes (0,6), halos (`shadowBlur`) remis à l'échelle pour garder les néons.

## 3. Branchement sur le vrai défi (à faire dans la source Pronostics)

```html
<link rel="stylesheet" href="/assets/css/defi-pote.css">
<script src="/assets/js/defi-pote/defi-plan.js" defer></script>
<script src="/assets/js/defi-pote/defi-scene.js" defer></script>
<script src="/assets/js/defi-pote/defi-player.js" defer></script>
```

Après la réponse du serveur qui **crée ou relit** le défi (jamais avant) :

```js
TomsoDefiPote.open({
  challengeId: defi.id,                    // identifiant stable du défi
  amount: defi.mise,                       // mise validée et enregistrée par le serveur
  allowedAmounts: defi.montants_autorises, // montants autorisés par le serveur
  plan: defi.plan_visuel ? { eliminations: defi.plan_visuel } : undefined, // facultatif
  players: [
    { name: defi.lanceur.pseudo, points: defi.lanceur.points },
    { name: defi.adversaire.pseudo, points: defi.adversaire.points }
  ],
  onClose: function () { /* rafraîchir l'affichage du défi si besoin, sans renvoyer de requête d'écriture */ }
});
```

Contrat serveur proposé (les noms de champs sont à aligner sur l'API existante) :

1. À la création : vérifier les droits et le minimum de 2 points de chaque côté, calculer les montants
   autorisés, choisir la mise **une seule fois** (idempotent sur l'identifiant du défi) et l'enregistrer.
   Optionnel : enregistrer aussi `plan_visuel` (sinon le client le dérive de l'identifiant et de la mise).
2. Relecture : renvoyer exactement la même mise et le même plan.
3. Règlement du duel (meilleur pronostic, règles existantes) : transférer les points **une seule fois**
   (transaction + contrainte d'unicité ou clé d'idempotence sur l'identifiant du défi), puis laisser les
   classements général et privé se mettre à jour par les mécanismes existants
   (`pronostics-resultats`).

## 4. Fichiers

| Fichier | Rôle |
|---|---|
| `assets/js/defi-pote/defi-plan.js` | Logique pure : montants autorisés, validation, plan déterministe, lumière des cases et segments à l'instant t. Navigateur + Node. |
| `assets/js/defi-pote/defi-scene.js` | Rendu Canvas fidèle à la référence, découpé en zones (titre, duel, grille, bandeau) et mise en page portrait / large. |
| `assets/js/defi-pote/defi-player.js` | Fenêtre : lecture, Passer, Son, clavier, focus, mouvement réduit, arrière-plan, redimensionnement, erreurs, démontage. |
| `assets/css/defi-pote.css` | Mise en page responsive, zones sûres, polices locales. |
| `assets/defi-pote/duel-epees.mp4` | Épées 3D (1080 × 788, 60 i/s, 480 images, 8 s). |
| `assets/defi-pote/son.m4a`, `son.wav` | Son synchronisé (chocs à 0,86 / 1,79 / 3,16 s, révélation à 3,25 s). |
| `assets/defi-pote/polices/` | DejaVu Sans / Bold, sous-ensemble latin woff2 (≈ 20 Ko chacune) + licence. |
| `assets/defi-pote/apercu.html` | Page d'aperçu non indexée : saisie des joueurs, points, mise, montants autorisés ; démo validée. |
| `assets/defi-pote/sources/` | Générateurs exacts : `duel.frag`, `render_swords.py`, `son.py`, `timeline.json`, `scene-reference.js` (démo d'origine, référence visuelle). |
| `assets/defi-pote/PREPARER-MEDIAS.py` | Régénère les médias dans `sources/` (voir § 5). |
| `tests/defi-pote.unit.mjs`, `tests/defi-pote.spec.mjs`, `tests/serveur-statique.mjs` | Tests (§ 6). |

## 5. Médias

La pièce jointe binaire n'ayant pas pu être transmise, `duel-epees.mp4` et `son.wav` ont été
**régénérés avec les générateurs exacts** fournis (`render_swords.py --samples 3`, rendu EGL/Mesa ;
`son.py` + normalisation `loudnorm`). `son.m4a` est un encodage AAC 160 kb/s de `son.wav`. Si le
binaire approuvé du dossier ZIP diffère légèrement (pilote OpenGL différent), il suffit de remplacer
le fichier sous le même nom : aucun code à modifier.

Dépendances de régénération : Python 3 + numpy + Pillow, ffmpeg, libEGL (Mesa : `libegl1 libegl-mesa0`),
polices DejaVu (`fonts-dejavu-core`).

## 6. Vérifications

```bash
node tests/defi-pote.unit.mjs
```

```bash
node tests/serveur-statique.mjs 8100
```

```bash
DEFI_BASE=http://localhost:8100 node tests/defi-pote.spec.mjs
```

`DEFI_SHOTS=dossier` enregistre aussi les captures (densité ×2). Le serveur de test gère les requêtes
`Range` (nécessaires pour se positionner dans la vidéo, comme Netlify) ; `python -m http.server` ne
les gère pas et fige les épées sur la première image.
