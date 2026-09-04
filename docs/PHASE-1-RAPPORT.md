# Phase 1 — Rapport (fondations de données de la régie automatisée)

## État Git
- **Branche unique** : `feat-jog-squads` (créée via PR #48). J'y reste — pas d'alternance de branche.
- **`main` et la production : non modifiés.** Aucune fusion, aucun déploiement prod.
- **Aucun secret** ajouté au dépôt ; `APISPORTS_KEY` reste côté serveur (jamais affichée).
- Deploy Preview actif : `deploy-preview-48--cms-github-et-netlify-site-tomsofoot.netlify.app`.

## Fichiers de la Phase 1 (à committer sur `feat-jog-squads`)
- `supabase/migrations/0010_regie_auto.sql` — migration **additive + réversible** (tables + RPC).
- `supabase/migrations/0010_regie_auto_rollback.sql` — annulation.
- `docs/AUDIT-REGIE-AUTOMATISEE.md`, `docs/PHASE-0.5-COUVERTURE-APISPORTS.md`, ce rapport.
- (déjà sur la branche) `netlify/functions/jog-squads.mjs` — lecture seule API-Sports.

## Tables créées (toutes additives, RLS admin, aucune touche à `players`)
| Table | Rôle |
|---|---|
| `jog_clubs` | **Identité club permanente** (id interne stable, nom canonique, `apisports_team_id`, `tm_verein_id`). |
| `jog_club_aliases` | Alias de clubs (source → club interne). |
| `jog_player_memberships` | **Historisation** des appartenances (club/ligue avant→après, dates, source, lot, admin). Un transféré n'est jamais supprimé. |
| `jog_player_locks` | **Verrou manuel** de fiche (« ne pas modifier automatiquement »). |
| `jog_auto_batches` | **Lots d'analyse persistants** (statut, saison, ligues, progression, idempotence). |
| `jog_auto_batch_items` | Un **item par club** (statut, anomalies, dernière sauvegarde) → reprise + « relancer les erreurs ». |
| `jog_auto_proposals` | **Propositions** (joueur int/ext, mouvement, club avant/après, **confiance**, **preuve**, décision). |
| `jog_source_runs` | Journal des exécutions de source (disponible/ralentie/partielle/inaccessible/format modifié). |
| `jog_auto_schedules` | **Calendrier** (fuseau `Europe/Paris`, répétition, délai post-mercato, prochaines exécutions). |

**Statuts** — lot : `planifie, analyse_en_cours, interrompu, analyse_terminee, brouillon, anomalies,
pret_a_appliquer, applique, annule, echec_partiel`. Item : `planifie, en_cours, termine, echec`.
Proposition — confiance : `certaine, probable, ambigue, bloquante` ; décision : `en_attente, acceptee,
refusee, corrigee, en_pause`. Mouvement : `transfer, loan, loan_return, loan_extension, free,
contract_end, retirement, reserve, first_team, unknown_club, future_transfer`.

## RPC (SECURITY DEFINER, admin-gated, `search_path=''`)
- `jog_auto_start_batch(...)` — crée un lot + items ; **idempotent** via `idem_key` (anti-doublon).
- `jog_auto_save_progress(...)` — le worker sauvegarde un club : insère ses propositions, marque l'item,
  journalise la source. **Rejeu idempotent** (ne duplique pas les propositions encore en attente ; ne
  détruit jamais une décision humaine déjà prise).
- `jog_auto_record_decision(...)` — enregistre immédiatement une décision (acceptée/refusée/en pause/
  corrigée) + correction manuelle éventuelle.
- `jog_auto_simulate(batch)` — **aucune écriture** : comptes par confiance/décision, anomalies,
  fiches verrouillées.
- `jog_auto_apply_validated(batch)` — applique **uniquement** les propositions `acceptee`, **délègue à
  `jog_apply_squad_changes`** (transactionnel + audit, pas de doublon de logique), **historise** les
  appartenances, **ignore et signale** les fiches verrouillées. **Verrou consultatif** anti double
  validation.
- `jog_auto_rollback_batch(batch)` — rétablit les clubs de CE lot depuis les appartenances historisées.

## Tests locaux (PostgreSQL 16) — tous verts
Non-admin refusé sur chaque RPC · start_batch idempotent (même id) · save_progress insère 2 propositions
(1 anomalie) · rejeu sans duplication · décision enregistrée · simulate correct · apply_validated déplace
le joueur via `jog_apply_squad_changes` et historise l'appartenance · **fiche verrouillée ignorée et
signalée** · rollback rétablit le club d'origine. Migration **rejouable** (idempotente) et **réversible**.

## Sécurité / conformité au brief
- Aucune proposition appliquée automatiquement (seule `apply_validated` sur décisions humaines écrit).
- Aucune suppression/réécriture massive de `players`. Aucune donnée réelle modifiée pendant les tests.
- Persistance complète (reprise possible plusieurs jours après). Idempotence + anti-doublon.
- Clés de service exclusivement côté serveur. RLS admin sur toutes les nouvelles tables.

## Limites connues & raffinements prévus (phases suivantes)
- Après `apply_validated`, marquer les propositions traitées comme `appliquee` pour éviter tout
  re-traitement si la fonction est rappelée (aujourd'hui : ré-appel possible mais **idempotent** côté
  `move`, donc sans dégât ; raffinement cosmétique).
- Peuplement de `jog_clubs` (id API-Sports par club) — script de seed en Phase 2.
- Quota API-Sports exact via `/status` (fonction enrichie prête) — non bloquant.

## Prochaines phases
- **Phase 2** : worker Netlify (Scheduled Function) API-Sports → comparaison → `proposals` (confiance,
  mouvements, preuves) ; seed `jog_clubs`.
- **Phase 3** : UI régie (tableau de bord, travaux en cours, examen des changements, actions rapides).
- **Phase 4** : simulation d'impact (2 jeux) + validation/retour arrière dans l'UI.
- **Phase 5** : calendrier + scheduler + notifications.
- **Phase 6** : tests complets + captures responsive + rapport final + Deploy Preview à jour.

## Action requise de ta part (une seule, quand tu veux activer la Phase 1 côté base)
La migration `0010` est **additive et réversible**, testée en local. Pour l'appliquer à Supabase (comme
tu l'as fait pour `0009`) : ouvre **Supabase → SQL Editor**, colle tout `0010_regie_auto.sql`, **Run**.
(Elle ne modifie aucune donnée existante ; rollback dispo.) Tu peux aussi attendre la Phase 2 : je
peux continuer à construire sans que la base soit encore migrée.
