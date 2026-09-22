# TomsoFoot — Document de reprise

*Dernière mise à jour : 22 septembre 2026. Rédigé pour permettre de reprendre le développement du site après une longue interruption.*

Le site : **https://tomsofoot.fr** — « Le football, raconté autrement » (analyses, documentaires, jeux).

---

## 1. Vue d'ensemble technique

- **Hébergement / déploiement** : Netlify.
  - Projet Netlify : `cms-github-et-netlify-site-tomsofoot`
  - Site ID : `495edd5d-908c-4815-a501-19365e66fbd3`
  - Domaine : `tomsofoot.fr`
  - Dépôt lié : `github.com/tomsofoot/tomsofoot-site`
- **Base de données / API publique** : Supabase (projet de production `yubndvqmglttlntkugzm`).
- **Fonctions serveur** : Netlify Functions (dossier `netlify/functions/`, ~36 fonctions), API v2 (Node), bundler `none`.
- **Front-end de l'accueil** : HTML + CSS + JavaScript « maison », sans framework. L'accueil (R03.24) est modulaire : une coquille HTML minimale + un chargeur qui récupère les données puis assemble le DOM.
- **Jeux** : Jogadle (« Le joueur du jour ») et Mode Carrière, générés depuis `mc-src/` au build.
- **Pas de secret dans le dépôt** : toutes les clés vivent dans les variables d'environnement Netlify (voir §5). Le `.gitignore` exclut `node_modules/`, `.netlify/`, `.env*`.

---

## 2. Structure du dépôt (l'essentiel)

```
index.html               Coquille de l'accueil (générée par le build — NE PAS éditer à la main)
home/                     Accueil R03.24 : sources CSS/JS modulaires + build
  index.template.html     Gabarit source de l'accueil (à éditer, pas index.html)
  loader.js               Chargeur : récupère home-data puis charge le bundle
  scripts.json            Ordre des 35 modules JS de l'accueil
  performance-assets.json Ordre des feuilles CSS de l'accueil
  performance.css         Styles ajoutés par le correctif de performance (PERF01)
  R03.19-content-identifiers.json   Carte des blocs (codes 1a, 2a… — voir §4)
  dist/                   Fichiers COMPILÉS (bundle CSS + bundle JS + chargeur), générés
  *.css / *.js            Modules sources (design, R03.x, clubs, standings, jogadle, etc.)
  assets/                 Images et polices de l'accueil (logos, joueur-du-jour, polices .ttf/.otf…)
tools/build-home.mjs      Build de l'accueil : regroupe CSS + JS en bundles empreintés, régénère index.html
tests/                    Tests Node (dont home-performance.test.mjs)
netlify/functions/        Fonctions serveur (home-data, articles, article, dossier, youtube-*, twitch-live, newsletter, x-*, jog-*, matches, standings…)
  lib/x-core.mjs          Cœur commun : lecture des variables d'env + garde-fous de sécurité
mc-src/                   Sources du Mode Carrière + Jogadle (build via build_full.py au déploiement)
mode-carriere/            Sortie générée du Mode Carrière
supabase/migrations/      Migrations SQL de la base
articles/ (routes)        Articles rendus côté serveur via les fonctions (voir netlify.toml)
regie-*.html              La « régie » = interface d'administration/CMS interne (articles, effectifs, X, publications…)
assets/, images/, numeros/, magazine/, jeu/, lib/   Ressources et pages annexes
netlify.toml              Build, redirections (/articles, /dossiers…), en-têtes de cache
package.json              Dépendances Node
```

**Règle d'or de l'accueil** : on édite les **sources** (`home/index.template.html`, `home/*.css`, `home/*.js`, `home/scripts.json`, `home/performance-assets.json`) puis on relance le build. On n'édite jamais `index.html` ni `home/dist/*` à la main : ils sont régénérés.

---

## 3. Lancer, tester, déployer

### Prérequis
- Node.js (v22 utilisé). `npm install` à la racine pour les dépendances.
- Python 3.11 (pour le build du Mode Carrière, avec Pillow).

### Build de l'accueil
```
node tools/build-home.mjs
```
Regroupe les 35 scripts en un bundle + un chargeur, et les ~39 feuilles CSS en une seule, tous nommés par empreinte de contenu (cache long sûr). Régénère `index.html` et `home/dist/`. À relancer après toute modification des sources de l'accueil ou des modules/styles.

### Tests
```
node tests/home-performance.test.mjs
```
Vérifie : réponse « primaire » indépendante des sources lentes, contrat historique conservé, articles futurs exclus, erreurs non mises en cache, aucun secret renvoyé, bundle et CSS complets. D'autres tests existent dans `tests/` (articles, newsletter, standings, matchs…).

### Aperçu local
Des serveurs d'aperçu locaux existent dans l'espace de travail (ex. `release-preview.mjs`, `bundle-preview.mjs`) : ils servent une copie des données publiques pour valider l'interface, sans écrire dans Supabase.

### Déploiement — deux voies

**A. Voie Git (recommandée pour l'avenir, non encore active).**
Netlify est branché sur `github.com/tomsofoot/tomsofoot-site` avec publication automatique **depuis `main`**. Un `git push` sur `main` déclenche un build Netlify (commande dans `netlify.toml` : build de l'accueil + build du Mode Carrière) qui publie en **contexte `production`**. C'est la voie propre à terme (contexte production correct, newsletter pleinement fonctionnelle). ⚠️ Elle n'a pas encore été basculée : la prod actuelle vient de la voie B.

**B. Voie manuelle par CLI (celle utilisée aujourd'hui).**
Déploiement depuis l'espace de travail `work/` via la CLI Netlify, en **contexte deploy-preview**, puis promotion manuelle en production via l'interface Netlify (« Publish deploy »). Commande qui fonctionne (depuis `work/`, avec `netlify.toml` local, bundler `none`) :
```
netlify deploy --draft --site 495edd5d-908c-4815-a501-19365e66fbd3 \
  --dir tomsofoot-preview-public --functions tomsofoot-release/netlify/functions \
  --alias r03-24-validation --context deploy-preview --env TOMSOFOOT_PREVIEW=1 \
  --message "…"
```
**Deux réglages indispensables, appris à la dure :**
1. **`--draft`** : sans lui, `--alias` crée un *Branch Deploy* qui tombe dans le contexte `branch-deploy` (variables Supabase vides → articles en 503). Avec `--draft`, le déploiement est un *Deploy Preview* et récupère les variables du contexte deploy-preview.
2. **Contexte `NETLIFY_CONTEXT`** : les déploiements CLI n'injectent pas toujours la variable Netlify `CONTEXT` au runtime. La fonction `home-data` exige un contexte non vide. On s'appuie donc sur `TOMSOFOOT_PREVIEW=1`, **définie dans les variables Netlify pour le contexte « Deploy Preview »** (le drapeau `--env` en ligne de commande n'atteint PAS le runtime des fonctions — il faut la variable côté Netlify). Ce marqueur ne peut désigner QUE le contexte non-production (garde-fou dans `x-core.mjs`).

Promotion en production : ouvrir le déploiement dans Netlify → **Publish deploy**. Le déploiement conserve son contexte deploy-preview même une fois publié (c'est pourquoi `public-config` renvoie `PROD_IN_NON_PROD` en prod — voir §7).

**Retour arrière** : dans Netlify → Deploys, ouvrir un ancien déploiement → **Publish deploy**. C'est immédiat et réversible.

---

## 4. Les blocs de l'accueil (codes 1a, 2a, 2b…)

L'accueil est découpé en blocs identifiés par un code court, défini dans `home/R03.19-content-identifiers.json`. Ces codes servent de langage commun pour désigner une zone précise (utile pour la régie et pour demander une modification ciblée). Chaque entrée a un `code`, un `name`, un `selector` CSS et un `type` (bloc, sous-bloc, groupe, fenêtre, navigation).

| Code | Zone | Sélecteur | Type |
|------|------|-----------|------|
| 1a | Les classements — Toutes les places comptent | `#classements` | bloc |
| 1b | Classement déplié | `#standings-dialog` | fenêtre |
| 2a | Jogadle — Le joueur du jour | `#jogadle-card` | bloc |
| 2b | Mode Carrière | `#mode-carriere` | bloc |
| 2c | Ensemble Jeux — Choisissez votre terrain (contient 2a, 2b) | `#formats` | groupe |
| 2d | Fenêtre de choix des jeux | `#game-choice` | fenêtre |
| 3a | Match en direct | `#match-center` | bloc |
| 3b | Fiche détaillée d'un match | `#match-detail-dialog` | fenêtre |
| 4a | À la une (contient 4b) | `#editorial` | bloc |
| 4b | TomsoFoot maintenant — Bandeau défilant | `.now-rail` | sous-bloc |
| 5a | Derniers articles | `#derniers-articles` | bloc |
| 5b | Parcourir par compétition — Rubriques et archives | `.article-explorer` | bloc |
| 6a | Les documentaires | `#videos` | bloc |
| 7a | Coup d'envoi — YouTube | `#coup-denvoi` | bloc |
| 8a | Le Live TomsoFoot — Twitch | `#live` | bloc |
| 9a | Newsletter — Le vestiaire TomsoFoot | `#newsletter` | bloc |
| 10a | Manifeste — Notre vision | `#vision` | bloc |
| 10b | Pied de page | `#app > footer` | bloc |
| 11a | Bandeau d'annonce en haut | `#cms-bandeau` | navigation |
| 11b | En-tête — Logo, menu, modes de lecture (contient 11c, 11d) | `.site-header` | navigation |
| 11c | Liens de navigation ordinateur | `.desktop-nav` | navigation |
| 11d | Menu déroulant | `#menu-panel` | navigation |
| 11e | Onglets mobiles en haut | `.mobile-tabs` | navigation |
| 11f | Barre de navigation mobile en bas | `.bottom-nav` | navigation |
| 12a | Rappels contextuels Précédent / Suivant | `#game-reminders` | navigation |

*La source de vérité reste le fichier `home/R03.19-content-identifiers.json` : le mettre à jour si un bloc est ajouté/renommé.*

---

## 5. Services utilisés et où ils sont configurés (sans secrets)

Toutes les clés/valeurs sont dans **Netlify → Project configuration → Environment variables** (jamais dans le dépôt). Ci-dessous, uniquement les **noms** des variables et à quoi elles servent.

| Service | Rôle | Variables Netlify (noms) | Où c'est configuré |
|---------|------|--------------------------|--------------------|
| **Supabase** | Base de données (articles, effectifs, newsletter…), lecture publique via clé anon | `SUPABASE_URL`, `SUPABASE_ANON`, `SUPABASE_SERVICE_ROLE` | Console Supabase (projet `yubndvqmglttlntkugzm`) + variables Netlify. `SUPABASE_URL`/`SUPABASE_ANON` sont publiques (présentes côté client) ; `SUPABASE_SERVICE_ROLE` est secrète (écritures serveur uniquement). |
| **YouTube Data API** | Documentaires, vidéos « Coup d'envoi » | `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID`, `YOUTUBE_DOCUMENTARIES_PLAYLIST_ID` | Google Cloud Console + variables Netlify. |
| **Twitch** | Statut du live | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | Console développeurs Twitch + variables Netlify. |
| **API-Football (API-Sports)** | Matchs, classements, effectifs | `APISPORTS_KEY` | Compte API-Sports + variables Netlify. |
| **X / Twitter** | Automatisation de publications (régie X) | `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_TOKEN_ENC_KEY`, `X_DRY_RUN` | Portail développeurs X + variables Netlify. **`X_DRY_RUN=true`** = mode simulation, aucune publication réelle. À laisser sur `true` tant que l'automatisation n'est pas validée. |
| **Netlify** | Hébergement, fonctions, build, déploiement | `TOMSOFOOT_PREVIEW` (=1, contexte Deploy Preview uniquement, voir §3) | Console Netlify. |

Contextes de déploiement Netlify : `production`, `deploy-preview`, `branch-deploy`, etc. Les variables peuvent avoir une valeur différente par contexte. Point important : `SUPABASE_URL`/`SUPABASE_ANON` sont définies pour `production` **et** `deploy-preview` (même base de prod), mais **pas** pour `branch-deploy` (d'où les 503 si un déploiement tombe en contexte branche).

Garde-fous de sécurité (dans `netlify/functions/lib/x-core.mjs`) :
- `assertPublicReadSafe()` : autorise la lecture publique (clé anon) quel que soit le contexte, tant que `SUPABASE_URL` est présent.
- `assertDbSafe()` : **refuse** d'utiliser la base de PRODUCTION en contexte non-production pour les écritures (fail-closed). C'est ce qui protège la prod pendant les aperçus.

---

## 6. Version en production vs version en aperçu

- **En production (tomsofoot.fr)** : **R03.24 + correctif de performance PERF01**.
  - PERF01 = CSS regroupé en une feuille + 35 scripts regroupés en un bundle + `home-data` scindé en `primary` (articles, immédiat) / `secondary` (YouTube, compteurs, indices — chargés après affichage) + images différées.
  - Déployée par la voie manuelle B (contexte deploy-preview promu en production).
- **En aperçu (`https://r03-24-validation--cms-github-et-netlify-site-tomsofoot.netlify.app/`)** : la même version PERF01 (l'aperçu ayant servi à valider avant la mise en prod).
- **Sources à jour** : branche Git **`feat/accueil-r03-24`** du dépôt (c'est là que vit R03.24/PERF01). La branche `main` contient encore la version **antérieure** à R03.24 (accueil monolithique). La bascule de `main` vers R03.24 fait partie des travaux en attente (voir §7).

---

## 7. Modifications en attente et problèmes connus

**En attente :**
1. **Migration vers le déploiement Git en production.** Aujourd'hui la prod passe par un déploiement manuel CLI en contexte deploy-preview. Le passer en voie Git (branche `main`, contexte `production`) donnerait un fonctionnement plus propre et automatique. C'est un chantier à part (fusionner `feat/accueil-r03-24` dans `main` après vérification, s'assurer que le build Netlify reproduit bien l'accueil + le Mode Carrière). ⚠️ À faire avec prudence : un push sur `main` publie automatiquement en prod.
2. **Newsletter** : les migrations Supabase `0012` et `0013` (table d'inscrits) ne sont **pas** appliquées en production. L'inscription réelle ne fonctionnera donc pas tant qu'elles ne sont pas appliquées. Les tests en base locale sont validés.
3. **Compteurs de consultations d'articles** : pas de fausse valeur « 0 » affichée si le compteur est absent (comportement volontaire), mais le compteur n'est pleinement actif qu'une fois les données en place.

**Problèmes connus / points de vigilance :**
- **`public-config` renvoie `PROD_IN_NON_PROD` en production.** C'est normal dans le montage actuel : la prod tourne en contexte `deploy-preview` (déploiement manuel), et le garde-fou refuse la base de prod pour les écritures en contexte non-production. Les **lectures publiques** (articles) fonctionnent quand même via `assertPublicReadSafe`. La voie Git (point 1) réglerait ce point.
- **Contexte des déploiements CLI** : voir §3.B — toujours `--draft` + `TOMSOFOOT_PREVIEW=1` (côté Netlify, contexte Deploy Preview). Le drapeau `--env` en CLI n'atteint pas le runtime.
- **Validation mobile** : le rendu mobile n'a pas pu être forcé en 390 px via l'outillage distant lors de la dernière mise en ligne ; le CSS responsive étant inchangé, le comportement mobile est identique à la version précédente (validée en 390×693). À vérifier visuellement sur un vrai téléphone en cas de doute.
- **Deux clones locaux existent** sur la machine : `Documents/GitHub/tomsofoot-site` (ancien, branche `feat/accueil-glace-jour-nuit`) et l'espace de travail `…/Codex/2026-09-20/j/work/tomsofoot-release` (à jour, branche `feat/accueil-r03-24`). C'est ce dernier qui fait foi pour R03.24/PERF01.

---

## 8. Architecture de chargement de l'accueil (pour comprendre PERF01)

1. `index.html` (coquille ~1,6 Ko) charge un **chargeur** (`home/dist/loader.*.js`) + précharge le **bundle** applicatif, + une **feuille CSS** unique.
2. Le chargeur appelle `/.netlify/functions/home-data?part=primary` → articles + compétitions + genres + manifeste (rapide, sans dépendre de YouTube/compteurs).
3. Il précharge l'image « À la une » (priorité haute), puis le bundle applicatif exécute les 35 modules **dans une seule tâche** (aucune attente réseau entre modules) et construit le DOM une seule fois → `TF_HOME.finish()`.
4. Après le premier affichage, `home-data?part=secondary` charge documentaires, indices Jogadle et compteurs, et met à jour uniquement les blocs concernés (jamais de reconstruction du DOM).
5. `home-data` sans paramètre (`part=all`) conserve l'ancien contrat complet (compatibilité).

`home-data` reste fail-closed : en cas de panne d'une source, aucun faux article/score/compteur ; l'accès aux archives (`/articles/`) est toujours proposé.

---

*Fin du document. Pour toute reprise : commencer par §3 (build + tests en local), puis consulter §6 pour savoir où se trouve la version à jour (branche `feat/accueil-r03-24`).*
