# Audit & plan — Régie automatisée de mise à jour des effectifs

> Réponse à la mission « Régie automatisée ». Phase 1 = **audit + état des lieux + architecture retenue**
> (étape obligatoire du brief, Section 2). Aucun changement de production, aucune donnée de prod
> modifiée, aucun secret ajouté. Branche de travail locale : `feat-regie-effectifs`
> (une branche dédiée `feat-regie-auto` sera créée pour l'implémentation).

---

## 0. Deux constats honnêtes à lire en premier

Le brief demande explicitement de signaler tout blocage de faisabilité, de durabilité ou d'autorisation.
Deux points structurants :

### A. Push de branche & Deploy Preview « autonomes » : non réalisables seuls depuis cet environnement
- Le **proxy Git** de ma session refuse les `push` vers `tomsofoot/tomsofoot-site` (« repository not in
  this session's authorized repository set »).
- La **couche de sécurité** m'empêche de cliquer « Commit » sur GitHub — c'est pourquoi, jusqu'ici,
  **tu** as cliqué « Commit changes » à chaque publication.
- **Conséquence** : je peux tout construire (branche locale, migrations, code, tests), mais la création
  de la **branche distante + Deploy Preview** se fait **ensemble** (tu cliques « Commit » en choisissant
  « Create a new branch » au lieu de `main`). Netlify génère alors le Deploy Preview de la PR. C'est
  conforme à tes exclusions (fusion `main` et prod restent hors périmètre).
- Option pour lever ce point à l'avenir : ajouter le dépôt aux sources autorisées de la session, ou me
  fournir un accès `push` dédié. Sinon, le flux « je prépare / tu valides le commit » reste la voie sûre.

### B. Les deux jeux n'ont PAS la même architecture de données (point central)
L'audit montre que « mettre à jour les effectifs pour les deux jeux » ne recouvre pas la même réalité :

| | **Jeu 1 — Jogadle** (`jeu/`) | **Jeu 2 — Mode Carrière** (`mode-carriere/`) |
|---|---|---|
| Nature | Deviner le **joueur mystère du jour** via son **club actuel** + attributs | Deviner un joueur via sa **carrière** (clubs successifs, palmarès) |
| Données | Table Supabase **`players`** (live, effectif de la saison) | Fichier **construit hors-ligne** par `mc-src/build_full.py` |
| Source | Édition manuelle / Régie Effectifs / API-Sports | **Wikidata (SPARQL)** + JSON (`regie-jogadle.json`, palmarès, logos…) au **build Netlify** |
| Sensibilité au mercato | **Forte** (le club actuel change) | **Faible** (un transfert ajoute juste un club à une carrière ; recalculé au rebuild) |

**Conséquence** : l'automatisation « mercato → club actuel » concerne **essentiellement Jogadle**.
Mode Carrière se met à jour en **reconstruisant** sa base (Wikidata) au déploiement, pas via la table
`players`. La « simulation d'impact sur les deux jeux » (Section 14) doit donc traiter les deux
différemment : pour Jogadle, impact réel sur `players`/pool/joueur du jour ; pour Mode Carrière,
vérifier surtout que le **build** reste cohérent (aucune régression), la donnée venant de Wikidata.
Je le documente ici pour ne pas construire une fausse « source commune ».

### C. Source d'automatisation licite et maintenable (Section 1)
Transfermarkt **interdit le scraping automatisé** (CGU) et bloquerait un usage planifié à l'échelle
(137 clubs, répété). **Il ne peut donc pas être la source de l'automatisation planifiée.**
La bonne source, **déjà intégrée et licenciée**, est **API-Sports / API-Football**
(`APISPORTS_KEY`, utilisée par `jog-squads.mjs` et `matches.mjs`). Recommandation :
- **Pipeline planifié → API-Sports** (licite, maintenable, clé déjà en place côté serveur).
- **Transfermarkt → uniquement en comparaison manuelle, à la demande, un club à la fois** (l'outil
  déjà construit dans la Régie Effectifs), jamais en tâche planifiée de masse.
- Réserve connue : API-Sports peut être en retard sur le mercato « très récent ». Comme le pipeline
  produit des **propositions à valider par un humain** (jamais d'application auto), ce décalage est
  absorbé par l'étape de validation. Pour un lancement « J+2 après fermeture », les données sont à jour.

---

## 1. État des lieux — architecture actuelle

### 1.1 Structure du dépôt (`tomsofoot/tomsofoot-site`)
- Site **statique servi par Netlify**, **avec** une étape de build (`netlify.toml`) qui **régénère
  Mode Carrière** depuis `mc-src/` à chaque déploiement (prod ET preview). Un échec de build conserve
  le dernier déploiement (la prod ne casse pas).
- `jeu/` : le jeu Jogadle (HTML + `js/` : api.js, game.js, auth-supabase.js, identity.js…).
- `mode-carriere/` : Mode Carrière (index.html généré). Sources dans `mc-src/` (build_full.py, JSON).
- `netlify/functions/*.mjs` : ~22 fonctions (articles, réseaux X, `jog-squads` [API-Sports],
  `tm-squad` [Transfermarkt], `matches`, `public-config`, `save-accueil`…).
- `supabase/migrations/` : 0000→0009 (0009 = Régie Effectifs, **déjà appliquée**).
- Régies privées : `regie.html` (menu), `regie-articles`, `regie-x`, `regie-effectifs` (nouvelle).

### 1.2 Données Jogadle (Supabase — projet `yubndvqmglttlntkugzm`)
Tables clés déjà connues/utilisées (recensement RLS complet = 1re action d'implémentation, à faire
dans l'éditeur SQL) : `players` (effectifs), `official_puzzles` + `official_puzzle_public` (puzzle du
jour, `target_id`), `game_sessions`, `daily_results`, saisons, profils/classement, `jog_squad_audit`
(journal de la Régie Effectifs), plus les tables articles/publications/social_x des autres modules.
- **RLS** : `players` bloquée aux anonymes ; écritures via fonctions `SECURITY DEFINER` admin
  (`is_current_user_admin()` = claim JWT `app_metadata.role='admin'`).
- **Joueur du jour** : servi par une Edge Function Supabase (`get-daily-puzzle`) ; **la réponse est
  mise en cache** — un changement de `target_id` en base ne modifie **pas** la partie déjà servie
  (constaté en test). Donc : mettre à jour les effectifs n'altère jamais la partie en cours ; l'impact
  ne vaut que pour les **prochaines** parties. (Aligné avec l'exigence Section 14.)

### 1.3 Brique déjà en place et RÉUTILISABLE (ne pas réécrire)
La **Régie Effectifs** livrée aujourd'hui fournit déjà, proprement :
- `jog_admin_players(league)` — lecture roster admin (paginée côté client).
- `jog_apply_squad_changes(ops, dry_run)` — **application transactionnelle**, admin-gated, avec
  **mode simulation (dry_run)**, liste blanche des ligues, et **journal d'audit**.
- `jog_squad_audit` — historique des applications.
- Le **moteur de reconnaissance des noms** (normalisation, homonymes → ambigu, 0 faux positif sur 2785).
- L'**import** (Transfermarkt manuel) + la **création pré-remplie** + le **retrait de club**.

➡️ Le système automatisé se construit **au-dessus** de ces briques : il produit des *propositions*,
puis, à la validation, appelle `jog_apply_squad_changes` (déjà transactionnel et audité). **Additif.**

---

## 2. Architecture retenue (additive, modulaire)

Chaîne imposée par le brief, respectée :
**Sources → capture → normalisation → comparaison → brouillon → anomalies → simulation → validation → application → historique.**
Aucune analyse automatique n'écrit dans `players` : seule la validation humaine déclenche
`jog_apply_squad_changes`.

### 2.1 Nouvelles tables Supabase (migration additive `0010_regie_auto.sql`)
Toutes préfixées `jog_auto_` / `jog_`, RLS admin, aucune modification des tables existantes :

- `jog_clubs` — **identité club permanente** (id interne stable, nom canonique, `league`,
  `apisports_team_id`, `tm_verein_id`, alias) → règle Section 12 « id permanent indépendant du nom ».
- `jog_club_aliases` — alias de clubs (source → club interne).
- `jog_auto_batches` — un **lot d'analyse persistant** : id unique, saison, source, championnats,
  statut, progression, date création/maj, auteur, horodatage. (Sections 6-7.)
- `jog_auto_batch_items` — une ligne **par club** dans un lot : statut (planifié/en cours/terminé/
  échec), dernière sauvegarde, nb anomalies → permet reprise et « relancer les erreurs ».
- `jog_auto_proposals` — une **proposition** par changement détecté : joueur (id interne + externe),
  type de mouvement, club avant/après, ligue avant/après, **niveau de confiance**
  (certaine/probable/ambiguë/bloquante), source + lien de preuve + date de consultation, décision
  humaine (acceptée/refusée/en attente/corrigée), note, date d'effet. (Sections 8-11-13-15.)
- `jog_player_memberships` — **historisation des appartenances** : joueur, club avant/après, ligue
  avant/après, dates début/fin/effet, source, date de vérification, lot d'origine, admin validateur.
  Un joueur transféré n'est jamais supprimé ; son historique reste consultable. (Section 10.)
- `jog_player_locks` — **verrouillage manuel** d'une fiche (« ne pas modifier automatiquement »),
  avec motif. (Section 12.)
- `jog_source_runs` — journal des exécutions de source (disponible/ralentie/inaccessible/format
  modifié) → une absence de réponse **ne vaut jamais** un départ. (Section 11.)
- `jog_auto_schedules` — **calendrier** : date/heure/fuseau (`Europe/Paris` par défaut), type de
  répétition (une fois / hiver / été / après chaque mercato / annuel / personnalisé par championnat),
  délai après fermeture (12/24/48 h), championnats concernés, prochaines exécutions, actif/suspendu.
  (Section 5.)

Fonctions RPC additives (SECURITY DEFINER, admin) : `jog_auto_start_batch`, `jog_auto_save_progress`,
`jog_auto_record_decision`, `jog_auto_simulate(batch)`, `jog_auto_apply_validated(batch)` (qui délègue
à `jog_apply_squad_changes`), `jog_auto_rollback_batch(batch)`. Verrou transactionnel (advisory lock)
pour empêcher deux validations/deux exécutions du même lot en parallèle (Sections 6, 15).

### 2.2 Tâches serveur persistantes (Section 6) — sans dépendre du navigateur
Netlify Functions étant à durée limitée, le pattern durable est :
- **`launch`** (fonction admin) : crée le lot + les `batch_items` (un par club) en base → statut
  `planifié`. Retour immédiat. Le navigateur peut être fermé.
- **`worker`** (Netlify **Scheduled Function**, cron court) : à chaque tick, prend **quelques clubs**
  `planifié`, interroge **API-Sports**, compare, écrit les `proposals`, marque le club `terminé`,
  sauvegarde la progression. Idempotent (clé = batch_item), reprise automatique, pas de double
  exécution (advisory lock + statut). « Relancer les erreurs » = repasser les items en `échec` à
  `planifié`. (Sections 6-7.)
- **`scheduler`** (Netlify Scheduled Function) : lit `jog_auto_schedules`, calcule les prochaines
  exécutions (fuseau Europe/Paris, changement d'heure géré côté serveur), et crée les lots dus.

### 2.3 Interface (régie) — additive, cohérente avec l'existant
Nouvelle page `regie-effectifs-auto.html` (ou onglets dans la Régie Effectifs), réutilisant le login
Supabase + Turnstile + le style existant. Écrans : **Tableau de bord** (Section 4), **Calendrier**
(Section 5), **Travaux en cours** (Section 7), **Examen des changements** (certains vs anomalies,
preuves, actions rapides — Sections 11-13), **Simulation d'impact** (deux jeux — Section 14),
**Validation & retour arrière** (Section 15). Boutons dangereux distincts + confirmation ; statuts non
basés uniquement sur la couleur ; responsive 1366/768/430/390. La phrase « Ce que l'automatisation
comprend » se met à jour en direct (Section 5).

---

## 3. Risques identifiés & incohérences potentielles
- **Push/preview non autonomes** (voir 0.A) → flux « je prépare / tu valides le commit ».
- **Transfermarkt non automatisable** (CGU + blocage) → source planifiée = API-Sports (voir 0.C).
- **Deux modèles de données** (voir 0.B) → périmètre d'automatisation = Jogadle ; Mode Carrière traité
  en « non-régression du build ».
- **Décalage API-Sports** sur le mercato récent → absorbé par la validation humaine.
- **Identité club** : aujourd'hui le club est une chaîne de texte dans `players` ; introduire
  `jog_clubs` (id permanent + alias + ids externes) est la clé pour fiabiliser matching, promotions/
  relégations et renommages (Section 12).
- **Cache du joueur du jour** : à préserver (le joueur du jour reste figé ; l'auto n'impacte que les
  prochaines parties).
- **Quotas API-Sports** : prévoir limitation/temporisation (Section 17) — le worker traite par petits
  lots pour rester sous quota.

---

## 4. Plan par phases (réaliste et additif)

| Phase | Contenu | Écrit en prod ? |
|---|---|---|
| **0 (fait)** | Audit + état des lieux + architecture (ce document) | Non |
| **1** | Migration additive `0010` : `jog_clubs`, aliases, `jog_player_memberships`, `jog_auto_*`, RPC + verrous. Peuplement `jog_clubs` depuis le roster + ids API-Sports. Tests sur PostgreSQL local. | Non (préparée) |
| **2** | Worker API-Sports + comparaison → `proposals` (confiance, mouvements, preuves). Tests hors-ligne. | Non |
| **3** | UI : Tableau de bord + Travaux en cours + Examen des changements (actions rapides, anomalies). | Non |
| **4** | Simulation d'impact (2 jeux) + Validation + retour arrière (délègue à `jog_apply_squad_changes`). | Non |
| **5** | Calendrier + Scheduler + tâches serveur persistantes + notifications. | Non |
| **6** | Tests complets (Section 19) + captures 1366/768/430/390 + rapport final. | Non |
| **7** | **Toi** : commit sur branche `feat-regie-auto` → **Deploy Preview** (jamais `main`/prod). | Preview only |

Chaque phase est livrée sous forme de fichiers prêts à committer + tests, avec un compte rendu.

---

## 5. Ce dont j'ai besoin de toi (pour lever les blocages)
1. **Confirmer la stratégie source** : API-Sports pour l'automatisation planifiée, Transfermarkt en
   manuel à la demande. (Je pars sur ça sauf objection — c'est la seule option licite/maintenable.)
2. **Le flux branche/preview** : pour créer la branche + Deploy Preview, il faudra tes clics « Commit »
   (option « Create a new branch »), sauf si tu ajoutes le dépôt aux sources autorisées de la session.
3. Rien d'autre : je peux enchaîner l'implémentation en local et te livrer chaque phase à committer.

*Fin de l'audit — Phase 0.*
