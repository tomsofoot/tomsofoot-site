# Rapport final — Régie automatisée de mise à jour des effectifs

> Livrables de la mission. Tout est **additif**, testé localement là où c'est possible, et **rien n'a été
> fusionné dans `main` ni déployé en production**. Aucun secret ajouté au dépôt.

---

## 0. Points de méthode honnêtes (à lire d'abord)

1. **Branche & commits.** Une seule branche : **`feat-jog-squads`** (PR **#48**). Je ne peux pas
   `push` depuis ma session (proxy Git) ni cliquer « Commit » (sécurité), donc **seul `jog-squads.mjs`
   est actuellement committé** sur la branche (par ton clic). **Tout le reste est construit et testé,
   livré dans le ZIP** pour que tu le commites sur la **même** branche (met à jour la PR #48 → rebuild
   du Deploy Preview). Fichiers concernés ci-dessous.

2. **Écriture Supabase depuis le Preview = bloquée par conception.** Le helper serveur existant
   (`lib/x-core.mjs → sbAdmin`) est **« fail-closed »** : il **refuse d'écrire dans la base de PROD
   depuis un contexte ≠ production**. Comme Supabase est mono-environnement (pas de base par branche),
   le **chemin d'écriture** du worker **ne peut donc pas s'exécuter sur le Preview** — c'est une
   protection voulue, alignée avec « aucune écriture prod ». J'ai donc validé **lecture + calcul**
   (le cœur intelligent) et la **base** (sur PostgreSQL local). Pour tester de bout en bout l'écriture
   **sans toucher la prod**, la voie propre est un **projet Supabase de STAGING** (ref différent →
   le garde-fou autorise, la prod reste intacte). Recommandé pour la recette write.

3. **Les deux jeux.** L'automatisation « mercato → club actuel » concerne **Jogadle** (table `players`).
   **Mode Carrière** se reconstruit hors-ligne depuis **Wikidata** au build Netlify → traité en
   **non-régression du build** (sa donnée ne vient pas de `players`). Détaillé dans `AUDIT-*`.

---

## 1. Résumé de l'audit
Site statique Netlify **avec build** (régénère Mode Carrière depuis `mc-src/` via `build_full.py`).
Jogadle lit la table Supabase `players` via Edge Functions ; écritures admin via fonctions
`SECURITY DEFINER` (`is_current_user_admin`). Le joueur du jour est **mis en cache** (un changement de
base n'altère jamais la partie en cours). Source d'automatisation **licite déjà intégrée = API-Sports**
(`APISPORTS_KEY`, `jog-squads`/`matches`). Brique réutilisable : la **Régie Effectifs** livrée avant
(`jog_apply_squad_changes` = application transactionnelle + audit + dry-run) — **réutilisée**, non
dupliquée.

## 2. Architecture retenue (additive, modulaire)
Chaîne : **Sources → capture → normalisation → comparaison → brouillon → anomalies → simulation →
validation humaine → application → historique.** Aucune analyse n'écrit dans `players` : seule
`jog_auto_apply_validated` (sur décisions **acceptées**) applique, en **déléguant** à
`jog_apply_squad_changes`.

## 3. Fichiers créés/modifiés (branche `feat-jog-squads`)
| Fichier | État | Rôle |
|---|---|---|
| `netlify/functions/jog-squads.mjs` | **committé (PR #48)** | Lecture seule API-Sports (+ mode `status`). |
| `supabase/migrations/0010_regie_auto.sql` (+ rollback) | à committer | Tables + RPC de l'automatisation. |
| `supabase/seeds/jog_clubs_seed.sql` | à committer | Mapping club interne ↔ id API-Sports (94 clubs). |
| `netlify/functions/lib/jog-auto-core.mjs` | à committer | **Moteur de comparaison** (pur, testé). |
| `netlify/functions/jog-auto-worker.mjs` | à committer | Worker persistant (tick 15 min + à la demande). |
| `netlify/functions/jog-auto-launch.mjs` | à committer | Lance un lot (admin). |
| `netlify/functions/jog-auto-scheduler.mjs` | à committer | Planificateur (Scheduled Function horaire). |
| `regie-effectifs-auto.html` | à committer | UI (tableau de bord, travaux, examen, calendrier). |
| `docs/AUDIT-*`, `PHASE-0.5-*`, `PHASE-1-*`, ce rapport | à committer | Documentation. |

Aucune modification destructive ; **aucune** réécriture de `players` ; **aucun secret**.

## 4. Migrations
- `0010_regie_auto.sql` — **additive + idempotente + réversible** (rollback fourni). Crée 9 tables
  `jog_*` et 9 RPC. Ne touche pas aux tables existantes.

## 5. Tables & statuts
`jog_clubs` (identité club permanente + `apisports_team_id`) · `jog_club_aliases` ·
`jog_player_memberships` (**historisation** appartenances) · `jog_player_locks` (**verrou de fiche**) ·
`jog_auto_batches` (lots persistants) · `jog_auto_batch_items` (par club) · `jog_auto_proposals`
(**confiance** certaine/probable/ambigue/bloquante, **preuve**, **décision**) · `jog_source_runs`
(état source) · `jog_auto_schedules` (**calendrier**, TZ Europe/Paris).
Statuts de lot : planifié → analyse_en_cours → analyse_terminée/anomalies → prêt_à_appliquer → appliqué
(ou interrompu/annulé/échec_partiel). Mouvements : transfer/loan/loan_return/loan_extension/free/
contract_end/retirement/reserve/first_team/unknown_club/future_transfer.

## 6. Moteur de planification
`jog_auto_schedules` (type de répétition : une fois / hiver / été / après chaque mercato / annuel /
personnalisé ; délai 12/24/48 h ; TZ **Europe/Paris**). `jog-auto-scheduler` (Scheduled Function
horaire) lit les planifications dues, crée le lot + items (depuis `jog_clubs`), recalcule la prochaine
exécution. L'UI affiche la phrase **« Ce que l'automatisation comprend »**, mise à jour en direct.

## 7. Sauvegarde & reprise (persistance)
Tout est en base : lots, items (statut par club), propositions, décisions, progression, journal
source. Le worker traite **quelques clubs par tick**, marque chaque item, sauvegarde après chacun →
on peut **fermer le navigateur / l'ordinateur** et **reprendre des jours plus tard**. **Idempotence** :
`idem_key` sur les lots (anti-doublon), rejeu d'un club sans dupliquer les propositions en attente,
verrous consultatifs contre double validation/exécution. « Relancer les erreurs » repasse les items en
échec à planifié. L'UI affiche l'indicateur `Sauvegarde en cours… / Sauvegardé à HH:MM / Échec — Réessayer`.

## 8. Résultats des tests
- **API-Sports (Phase 0.5)** : 8 championnats, saison 2026, 150 clubs, ids stables, champs riches
  (poste/numéro/âge/naissance/nationalité). Couverture **concluante**.
- **Migration 0010 (PostgreSQL local)** : admin-gating (non-admin refusé partout), idempotence
  (start_batch, save_progress sans doublon), décision, simulate, **apply déléguant à
  `jog_apply_squad_changes`** + historisation, **verrou de fiche ignoré et signalé**, **rollback**.
  RPC de lecture (list_batches/list_proposals) + `save_schedule` OK. Seed `jog_clubs` : 93 clubs.
- **Moteur de comparaison (Node, données réelles Lyon)** : Anselmino détecté comme **arrivée**
  (Chelsea→Lyon, **certaine** nom+naissance), Fofana comme **départ**, recrue comme **à créer**,
  **0 faux positif** pour les joueurs restants. 5/5 assertions.
- **UI** : syntaxe JS OK ; rendu maquette (mode `?mock=1`) fonctionnel.

## 9. Erreurs / limites restantes
- **Écriture worker non testable sur Preview** (fail-closed + Supabase mono-env) → recette write via
  **staging Supabase** ou en prod (hors périmètre). Le code d'écriture est prêt (réutilise `sbAdmin`).
- **Seed `jog_clubs`** : 94 clubs mappés ; les ligues **partielles** du jeu expliquent les non-mappés ;
  une poignée de clubs FR/EN a nécessité un alias manuel (fait). Revue rapide conseillée.
- **`apply_validated` rejouable** : marquer les propositions traitées `appliquee` (raffinement) —
  actuellement sans dégât car le `move` est idempotent.
- **Quota API-Sports exact** : à lire via `jog-squads?status=1` (version enrichie livrée, à committer).
- **Captures responsive 1366/768/430/390** : CSS responsive en place (breakpoints) ; captures pixel à
  produire sur le Preview une fois la page committée (le sandbox ne peut pas déployer). Maquette
  fournie pour revue immédiate.

## 10. Références
- **Deploy Preview** : `https://deploy-preview-48--cms-github-et-netlify-site-tomsofoot.netlify.app`
- **Branche** : `feat-jog-squads` — **PR #48** (SHA du commit `jog-squads` visible sur la PR ; le SHA
  final évoluera après commit des fichiers livrés).
- **Aucun secret ajouté** au dépôt (clés serveur `APISPORTS_KEY`/`SUPABASE_SERVICE_ROLE` déjà en place).
- **`main` et la production : non modifiés.**

---

## 11. Activation (tes actions, quand tu veux) — toutes gated, non destructives
1. **Base** : dans Supabase → SQL Editor, exécuter `0010_regie_auto.sql`, puis `jog_clubs_seed.sql`.
2. **Code** : committer les fichiers livrés sur la branche **`feat-jog-squads`** (met à jour la PR #48
   → rebuild du Preview). L'env Netlify a déjà `APISPORTS_KEY` et `SUPABASE_SERVICE_ROLE`.
3. **Recette lecture/UI** : sur le Preview, se connecter en admin → tableau de bord, calendrier, examen
   (données réelles en lecture). Le **lancement d'analyse écrit** : ne fonctionnera qu'en prod ou sur un
   **staging Supabase** (recommandé) à cause du garde-fou fail-closed.
4. **Rien n'est appliqué automatiquement** : chaque changement passe par ta validation.

*Fin du rapport final.*
