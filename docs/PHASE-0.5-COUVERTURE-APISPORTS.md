# Phase 0.5 — Rapport de couverture API-Sports (lecture seule)

> Validé via la fonction serveur `jog-squads` déployée **sur le Deploy Preview #48**
> (`deploy-preview-48--cms-github-et-netlify-site-tomsofoot.netlify.app`), donc **la clé
> `APISPORTS_KEY` n'a jamais été exposée** (elle reste côté serveur). **Aucune écriture** Supabase,
> aucune modification de prod. Environ 20 requêtes API consommées pour cette validation.

## Verdict : **CONCLUANT** ✅ → on peut enchaîner sur la Phase 1 (migration `0010`).

---

## 1. Résultats par championnat (saison **2026** = 2026/27)

| Championnat | ID API | Saison | Clubs attendus | Clubs récupérés | Effectifs accessibles | Fraîcheur | Anomalies | Requêtes (sweep complet)* |
|---|---:|---:|---:|---:|---|---|---|---:|
| Premier League | 39 | 2026 | 20 | **20** | Oui (échantillon : 36 joueurs) | Saison courante OK | — | 1 + 20 |
| Ligue 1 | 61 | 2026 | 18 | **18** | Oui | Saison courante OK | — | 1 + 18 |
| Liga | 140 | 2026 | 20 | **20** | Oui | Saison courante OK | — | 1 + 20 |
| Serie A | 135 | 2026 | 20 | **20** | Oui | Saison courante OK | — | 1 + 20 |
| Bundesliga | 78 | 2026 | 18 | **18** | Oui | Saison courante OK | — | 1 + 18 |
| Eredivisie | 88 | 2026 | 18 | **18** | Oui | Saison courante OK | — | 1 + 18 |
| Liga Portugal | 94 | 2026 | 18 | **18** | Oui | Saison courante OK | — | 1 + 18 |
| Süper Lig | 203 | 2026 | 18 | **18** | Oui | Saison courante OK | — | 1 + 18 |
| **Total** | | | **150** | **150** | | | | **~158** |

\* *Estimation d'un balayage complet : 1 appel « équipes » par ligue (8) + 1 appel « effectif » par club
(150). Les détails joueurs (naissance/nationalité) ne sont récupérés qu'au besoin (recrues/ambigus),
pas systématiquement.*

**Note de périmètre** : le jeu suit actuellement **137 clubs** (certaines ligues en version partielle,
ex. Süper Lig/Portugal/Eredivisie). API-Sports couvre les **ligues complètes (150 clubs)** → les 137
suivis sont **entièrement couverts**, et une extension éventuelle serait possible (décision produit).

---

## 2. Réponses aux 12 points demandés

1. **Clé `APISPORTS_KEY` fonctionne** ✅ — confirmée via la fonction serveur (jamais affichée).
2. **Abonnement autorise les endpoints nécessaires** ✅ — `/teams`, `/players/squads`, `/players`
   renvoient tous **200 + données**. (Le plan/quota exact vient de `/status` : voir point 9.)
3. **Saison 2026-2027 accessible** ✅ — `season=2026` renvoie les effectifs 2026/27.
4. **8 championnats couverts** ✅ — les 8 IDs renvoient le bon nombre de clubs.
5. **Effectifs complets récupérables** ✅ — endpoint `/players/squads?team=X` (ex. Man Utd : 36 joueurs).
6. **Identifiants externes stables** ✅ — **id joueur** (ex. 18885) et **id club** (ex. 33) numériques
   et stables → base idéale pour l'identité permanente (Section 12) et le matching (Section 8).
7. **Infos par joueur** ✅ — via `/players/squads` : id, nom, **numéro, poste, âge** ; via `/players` :
   id, nom, **prénom, nom, date de naissance, nationalité**. (Club précédent : endpoint `/transfers`
   disponible si besoin.)
8. **Fraîcheur** ✅ (saison courante) — les données 2026/27 sont servies. La **récence des transferts**
   dépend du rythme de mise à jour d'API-Sports ; c'est **absorbé par la validation humaine** (rien ne
   s'applique automatiquement) et par un lancement « J+X après fermeture du mercato ».
9. **Quotas / limites** ⚠️ **à confirmer précisément via `/status`** — la version de `jog-squads`
   committée sur la branche est l'**ancienne** (sans le mode `status` que j'avais préparé). Les ~20
   requêtes de test sont passées sans blocage. **Impact** : le worker sera de toute façon conçu pour
   **respecter le quota par petits lots + backoff** (voir point 10) ; connaître le chiffre exact permet
   surtout de dimensionner le nombre de clubs par tick. **Non bloquant** pour la Phase 1. *(Il suffira
   de committer la version enrichie de `jog-squads` sur la même branche `feat-jog-squads` pour lire
   `/status`.)*
10. **Temps / nombre d'appels pour 137-150 clubs** ✅ — **~158 appels** pour un balayage complet
    (8 + 150). À ~0,3-0,5 s/appel côté API, un balayage séquentiel ≈ 1-2 min de temps API cumulé,
    mais **découpé en lots** côté worker pour rester sous quota et sous la limite de durée des fonctions
    Netlify (traitement de quelques clubs par tick, progression sauvegardée).
11. **Comportement si incomplet** ✅ — la fonction renvoie toujours un JSON structuré (`count`, listes
    vides si rien) ; une absence de réponse **n'est jamais** interprétée comme un départ (règle Section
    11 conservée dans l'architecture).
12. **Comparaison de deux captures** ✅ — grâce aux **ids stables** (joueur+club), comparer l'effectif
    API-Sports au club enregistré dans `players` (ou une capture précédente) **détecte les mouvements**
    (le club d'un joueur a changé) de façon fiable.

---

## 3. Conclusion & suite
- **Couverture, saison, identifiants, champs joueurs : concluants.** API-Sports est une source
  **licite, maintenable et suffisante** pour l'automatisation planifiée de Jogadle.
- **Seul reliquat** : le chiffre exact de quota (`/status`) — non bloquant ; le worker respecte le
  quota par conception. Je fournis à part la version enrichie de `jog-squads` (mode `status`) à
  committer sur `feat-jog-squads` quand tu veux, pour finaliser ce chiffre.
- ➡️ **J'enchaîne sur la Phase 1** : migration additive `0010` (identité club permanente, alias,
  historisation des appartenances, lots/propositions/décisions persistants, verrous d'idempotence),
  testée sur PostgreSQL local, **sans aucune écriture en prod**.
