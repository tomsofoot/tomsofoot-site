/* TomsoFoot — « Défie ton pote » : plan visuel d'élimination (logique pure, sans DOM).

   RÔLE : traduire un défi DÉJÀ VALIDÉ par le serveur (montant retenu + montants autorisés)
   en une chronologie d'extinction des six cases. Ce module ne tire RIEN au hasard au sens
   du jeu : le montant vient du serveur. Il ne fait que décider, de façon déterministe,
   quelles cases perdantes s'éteignent à chaque choc d'épées.

   - Même défi + même montant + mêmes montants autorisés => même plan, sur tous les appareils
     et à chaque relecture (hachage FNV-1a + générateur mulberry32, aucun Math.random).
   - Un plan enregistré côté serveur (`plan`) est accepté tel quel s'il est cohérent.
   - Aucune case éliminée ne se rallume ; les cases non autorisées restent verrouillées.
   - Six cases éligibles : 6 → 4 → 2 → 1 (paires à 0,86 s et 1,79 s, perdante finale à 3,16 s).

   Utilisable dans le navigateur (window.TomsoDefiPlan) et dans Node (require). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TomsoDefiPlan = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CHOICES = [1, 2, 3, 5, 7, 10];
  var MIN_POINTS_TO_CHALLENGE = 2;
  // Chronologie validée (référence 8 s / 60 i/s) : les trois chocs des épées et la révélation.
  var TIMELINE = Object.freeze({
    fps: 60,
    duration: 8,
    clashes: Object.freeze([0.86, 1.79, 3.16]),
    fades: Object.freeze([0.12, 0.12, 0.08]),
    reveal: 3.25,
    duelStart: 1.91,
    settled: 4.6 // tous les effets de révélation sont terminés : image finale fixe
  });

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function ease(x) { return 1 - Math.pow(1 - clamp(x, 0, 1), 3); }

  // FNV-1a 32 bits sur l'UTF-8 de la clé : identique dans tous les moteurs JS.
  function hash(str) {
    var bytes = unescape(encodeURIComponent(String(str))), h = 0x811c9dc5;
    for (var i = 0; i < bytes.length; i++) { h ^= bytes.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function toNumber(v) { var n = Number(v); return isFinite(n) ? n : NaN; }

  /* Montants autorisés, dans l'ordre de la grille.
     Priorité aux montants fournis par le serveur ; à défaut, règle de la démo validée :
     un montant est jouable s'il ne dépasse pas le solde du joueur le moins doté. */
  function eligibleAmounts(input) {
    if (input && Array.isArray(input.allowedAmounts)) {
      var allowed = input.allowedAmounts.map(toNumber);
      return CHOICES.filter(function (c) { return allowed.indexOf(c) !== -1; });
    }
    var pts = (input && input.players || []).map(function (p) { return toNumber(p && p.points); });
    if (pts.length < 2 || pts.some(isNaN)) return [];
    var max = Math.min.apply(null, pts);
    return CHOICES.filter(function (c) { return c <= max; });
  }

  function fail(code, message) { return { ok: false, error: code, message: message }; }

  /* Répartition des perdantes sur les trois chocs.
     n éligibles => n-1 perdantes ; la dernière part toujours seule au 3e choc (duel final),
     les autres se répartissent entre les deux premiers chocs (au plus deux par choc).
       6 : 2 / 2 / 1  (6 → 4 → 2 → 1)      5 : 1 / 2 / 1  (5 → 4 → 2 → 1)
       4 : 1 / 1 / 1  (4 → 3 → 2 → 1)      3 : 0 / 1 / 1  (3 → 3 → 2 → 1)
       2 : 0 / 0 / 1                        1 : aucune extinction                         */
  function groupSizes(n) {
    var losers = Math.max(0, n - 1);
    if (!losers) return [0, 0, 0];
    var rest = losers - 1, second = Math.ceil(rest / 2), first = rest - second;
    return [first, second, 1];
  }

  function buildEvents(groups) {
    return groups.map(function (indices, k) {
      return { at: TIMELINE.clashes[k], fade: TIMELINE.fades[k], indices: indices.slice().sort(function (a, b) { return a - b; }) };
    });
  }

  function validatePlan(plan, eligibleIdx, winnerIdx) {
    if (!plan || !Array.isArray(plan.eliminations) || plan.eliminations.length !== 3) return "plan_format";
    var seen = {}, losers = eligibleIdx.filter(function (i) { return i !== winnerIdx; });
    for (var k = 0; k < 3; k++) {
      var g = plan.eliminations[k];
      if (!Array.isArray(g) || g.length > 2) return "plan_format";
      for (var j = 0; j < g.length; j++) {
        var i = g[j];
        if (typeof i !== "number" || i === winnerIdx || eligibleIdx.indexOf(i) === -1 || seen[i]) return "plan_incoherent";
        seen[i] = true;
      }
    }
    if (plan.eliminations[2].length !== (losers.length ? 1 : 0)) return "plan_incoherent";
    if (Object.keys(seen).length !== losers.length) return "plan_incoherent";
    return null;
  }

  /* Point d'entrée.
     input = {
       challengeId: "…",            // identifiant stable du défi (obligatoire)
       amount: 10,                  // montant VALIDÉ par le serveur
       allowedAmounts: [1,2,3,5],   // facultatif : montants autorisés par le serveur
       players: [{name, points}, {name, points}],  // soldes affichés
       plan: { eliminations: [[i,j],[k,l],[m]] }   // facultatif : plan enregistré
     }                                                                               */
  function createPlan(input) {
    input = input || {};
    var id = input.challengeId == null ? "" : String(input.challengeId);
    if (!id) return fail("challenge_id_manquant", "Identifiant du défi manquant.");
    var amount = toNumber(input.amount);
    var winnerIdx = CHOICES.indexOf(amount);
    if (winnerIdx === -1) return fail("montant_inconnu", "Le montant " + input.amount + " ne fait pas partie de la grille.");
    var players = input.players || [];
    if (players.length === 2) {
      var low = Math.min(toNumber(players[0].points), toNumber(players[1].points));
      if (!(low >= MIN_POINTS_TO_CHALLENGE)) return fail("points_insuffisants", "Il faut au moins " + MIN_POINTS_TO_CHALLENGE + " points de chaque côté pour lancer un défi.");
    }
    var eligible = eligibleAmounts(input);
    if (eligible.indexOf(amount) === -1) return fail("montant_non_autorise", "Le montant " + amount + " n'est pas autorisé pour ce défi.");
    var eligibleIdx = eligible.map(function (v) { return CHOICES.indexOf(v); });

    var groups, source;
    if (input.plan) {
      var err = validatePlan(input.plan, eligibleIdx, winnerIdx);
      if (err) return fail(err, "Le plan visuel enregistré ne correspond pas à ce défi.");
      groups = input.plan.eliminations.map(function (g) { return g.slice(); });
      source = "enregistre";
    } else {
      var rand = mulberry32(hash("defi-pote|v1|" + id + "|" + amount + "|" + eligible.join(",")));
      var losers = eligibleIdx.filter(function (i) { return i !== winnerIdx; });
      for (var i = losers.length - 1; i > 0; i--) { // Fisher-Yates déterministe
        var j = Math.floor(rand() * (i + 1)), tmp = losers[i]; losers[i] = losers[j]; losers[j] = tmp;
      }
      var sizes = groupSizes(eligibleIdx.length), pos = 0;
      groups = sizes.map(function (s) { var g = losers.slice(pos, pos + s); pos += s; return g; });
      source = "derive";
    }
    var events = buildEvents(groups);
    var finalist = events[2].indices.length ? events[2].indices[0] : -1;
    return {
      ok: true,
      version: 1,
      source: source,
      challengeId: id,
      amount: amount,
      winnerIndex: winnerIdx,
      finalistIndex: finalist,
      choices: CHOICES.slice(),
      eligible: CHOICES.map(function (c) { return eligible.indexOf(c) !== -1; }),
      eliminations: events,
      timeline: TIMELINE
    };
  }

  // ---------- Lecture du plan à l'instant t (utilisé par le rendu et par les tests) ----------
  function eventFor(plan, index) {
    for (var k = 0; k < plan.eliminations.length; k++) if (plan.eliminations[k].indices.indexOf(index) !== -1) return plan.eliminations[k];
    return null;
  }
  function caseLight(plan, t, index) {
    if (!plan.eligible[index]) return 0;
    var ev = eventFor(plan, index);
    return ev ? 1 - ease((t - ev.at) / ev.fade) : 1;
  }
  // Les six segments d'une case s'éteignent de gauche à droite pendant la même transition.
  function segmentLight(plan, t, index, segment) {
    if (!plan.eligible[index]) return 0;
    var ev = eventFor(plan, index);
    if (!ev) return 1;
    var step = ev.fade / 6;
    return 1 - ease((t - ev.at - segment * step) / step);
  }
  function litIndices(plan, t) {
    return plan.choices.map(function (_, i) { return i; }).filter(function (i) { return caseLight(plan, t, i) > 0.001; });
  }
  function isDecided(plan, t) { return t >= plan.timeline.clashes[2]; }
  function isRevealed(plan, t) { return t >= plan.timeline.reveal; }

  function label(amount) { return amount + (amount === 1 ? " PT" : " PTS"); }
  function spoken(amount) { return amount + (amount === 1 ? " point" : " points"); }

  return {
    CHOICES: CHOICES,
    MIN_POINTS_TO_CHALLENGE: MIN_POINTS_TO_CHALLENGE,
    TIMELINE: TIMELINE,
    createPlan: createPlan,
    eligibleAmounts: eligibleAmounts,
    groupSizes: groupSizes,
    caseLight: caseLight,
    segmentLight: segmentLight,
    litIndices: litIndices,
    isDecided: isDecided,
    isRevealed: isRevealed,
    label: label,
    spoken: spoken,
    _hash: hash
  };
});
