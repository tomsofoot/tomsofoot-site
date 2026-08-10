/* Jogadle — CONSTANTES PUBLIQUES du règlement (miroir exact de supabase/functions/_shared/rules.mjs).
   Source unique pour : le bloc « POINTS EN JEU », le récap de fin de partie, et la fenêtre
   « ⚠ RÈGLEMENT & POINTS ». Un test (tests/rules-public.consistency.mjs) vérifie que ces valeurs
   restent identiques au calcul serveur (aucune divergence règlement affiché / points réels).
   ⚠ Le CALCUL des points reste EXCLUSIVEMENT côté serveur : ce fichier n'attribue aucun point,
   il ne fait qu'AFFICHER le barème et calculer un potentiel informatif. */
(function (global) {
  "use strict";
  var ATTEMPT_POINTS = { 1: 100, 2: 50, 3: 45, 4: 35, 5: 25, 6: 15, 7: 5, 8: 3, 9: 1 }; // 10 et + = 0
  var R = {
    LEAGUES: ["ultimate", "pro", "rookie", "noob"],
    LEAGUE_LABELS: { ultimate: "Ultime", pro: "Pro", rookie: "Rookie", noob: "Noob" },
    PLACES_PER_LEAGUE: 20,
    ATTEMPT_POINTS: ATTEMPT_POINTS,
    HINT_PENALTY: 5,
    REVEAL_EARLY_PENALTY: 10,   // révélation avant le 7e essai
    REVEAL_LATE_PENALTY: 5,     // révélation à partir du 7e essai
    MIN_SEASON_TOTAL: 0,
    QUALIFICATION_DAYS: 14,
    MONEY_TIME: {
      hoursBeforeEnd: 48,
      penultimate: [50, 35, 20, 10, -10, -20, -35, -50],
      final: [100, 70, 40, 20, -20, -40, -70, -100],
      absencePenultimate: -50, absenceFinal: -100, absenceBoth: -150,
    },
    // Barème sous forme de lignes pour l'affichage (1..9 puis « 10 et + »).
    attemptRows: function () {
      var rows = [];
      for (var i = 1; i <= 9; i++) rows.push({ attempt: String(i), points: ATTEMPT_POINTS[i] || 0 });
      rows.push({ attempt: "10 et +", points: 0 });
      return rows;
    },
    base: function (attempts) { return ATTEMPT_POINTS[attempts] || 0; },
    potential: function (attemptNumber, hintRevealed) { return Math.max(0, (ATTEMPT_POINTS[attemptNumber] || 0) - (hintRevealed ? 5 : 0)); },
    win: function (attempts, hintRevealed) { return Math.max(0, (ATTEMPT_POINTS[attempts] || 0) - (hintRevealed ? 5 : 0)); },
    revealDelta: function (attemptsMade) { return attemptsMade < 7 ? -10 : -5; },
  };
  global.JogadleRules = R;
})(window);
