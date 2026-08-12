/* Jogadle — adaptateur backend. Choisit le MOCK (TEST_MODE) ou le vrai backend R2 (Edge Functions).
   Aucune cible n'est jamais connue du client : toutes les propositions sont vérifiées côté serveur.
   Invité => guest-play (sans points) ; connecté => submit-guess/reveal-* (avec points).
   Mode DÉGRADÉ propre si Supabase est indisponible. Aucun secret : seule la clé anon (publique) est utilisée. */
(function (global) {
  "use strict";
  var CFG = global.JOGADLE_CONFIG || {};

  // 1) Prévisualisation locale : on branche le mock (données fictives) tel quel.
  if (CFG.TEST_MODE && global.JogadleMock) {
    global.JogadleAPI = Object.assign({ mode: "mock", degraded: false }, global.JogadleMock);
    return;
  }

  // 2) Production : vrai backend. Sans URL/clé anon => mode dégradé (aucune donnée fictive).
  var ready = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  function connected() { return !!global.__JOGADLE_JWT; } // JWT réel posé par auth-supabase.js

  function fnUrl(name) { return CFG.FUNCTIONS_BASE + "/" + name; }
  async function call(name, body) {
    var headers = { "Content-Type": "application/json", "apikey": CFG.SUPABASE_ANON_KEY,
      "Authorization": "Bearer " + (global.__JOGADLE_JWT || CFG.SUPABASE_ANON_KEY) };
    var r = await fetch(fnUrl(name), { method: "POST", headers: headers, body: JSON.stringify(body || {}) });
    if (!r.ok && r.status >= 500) throw new Error("server_" + r.status);
    return r.json();
  }

  // ---- Jeton invité PERSISTANT (R2, point 6) : localStorage, clé VERSIONNÉE, réutilisé après refresh.
  var GUEST_KEY = "jogadle.guest.v1";
  function isUuid(v) { return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v); }
  function newUuid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (global.crypto && crypto.getRandomValues) ? crypto.getRandomValues(new Uint8Array(1))[0] % 16 : Math.floor(Math.random() * 16);
      var v = c === "x" ? r : (r & 0x3 | 0x8); return v.toString(16);
    });
  }
  function guestToken() {
    var t = null;
    try { t = global.localStorage.getItem(GUEST_KEY); } catch (e) {}
    if (!isUuid(t)) {                       // renouvelé UNIQUEMENT si absent/invalide
      t = newUuid();
      try { global.localStorage.setItem(GUEST_KEY, t); } catch (e) { global.__JOGADLE_GUEST = t; }
    }
    return t;
  }

  // Pré-chauffage : réveille l'isolate de la fonction (préflight OPTIONS, sans effet de bord)
  // pour supprimer le « démarrage à froid » Supabase. Appelé à l'ouverture du jeu et pendant la
  // partie, afin que la 1re proposition (et les suivantes) réponde quasi instantanément.
  var lastWarm = 0;
  function warmFns() {
    if (!ready) return;
    var now = Date.now();
    if (now - lastWarm < 20000) return;   // au plus une fois toutes les 20 s
    lastWarm = now;
    var names = connected() ? ["submit-guess"] : ["guest-play"];
    names.forEach(function (n) {
      try { fetch(fnUrl(n), { method: "OPTIONS" }).catch(function () {}); } catch (e) {}
    });
  }

  var real = {
    mode: "supabase",
    degraded: !ready,
    warm: warmFns,
    async getDailyPuzzle() {
      var d = await call("get-daily-puzzle", {});
      return { edition: d.puzzle && d.puzzle.edition, seasonName: d.season && d.season.label, raw: d };
    },
    async ensureSession() {
      if (connected()) {
        var s = await call("start-or-resume-game", {});
        return { status: s.session && s.session.status, hint_revealed: s.session && s.session.hint_revealed, guesses: s.guesses || [], answer: s.answer || null };
      }
      var g = await call("guest-play", { action: "start", guestToken: guestToken() });
      return { status: g.session && g.session.status, hint_revealed: g.session && g.session.hint_revealed, guesses: g.guesses || [], answer: g.answer || null, guest: true };
    },
    async submitGuess(id) {
      return connected() ? call("submit-guess", { guessPlayerId: id })
                         : call("guest-play", { action: "guess", guestToken: guestToken(), guessPlayerId: id });
    },
    async revealHint() {
      return connected() ? call("reveal-hint", {}) : call("guest-play", { action: "reveal-hint", guestToken: guestToken() });
    },
    async revealAnswer() {
      return connected() ? call("reveal-answer", {}) : call("guest-play", { action: "reveal-answer", guestToken: guestToken() });
    },
    async searchPlayers(q) { var r = await call("search-players", { q: q }); return r.results || []; },
    // Attributs PUBLICS des joueurs déjà proposés (reprise de partie) — jamais la cible.
    async getPlayersByIds(ids) { if (!ids || !ids.length) return []; var r = await call("get-players-by-ids", { ids: ids }); return r.results || []; },
    // Profil serveur (jamais de public_ref fabriqué côté client).
    async getMyProfile() { return call("get-my-profile", {}); },
    async getOrCreateProfile(pseudo) { return call("get-or-create-profile", { pseudo: pseudo }); },
    async updatePseudo(pseudo) { return call("update-pseudo", { pseudo: pseudo }); },
    async chooseUltimateCard(seasonId, variant) { return call("choose-ultimate-card", { seasonId: seasonId, variant: variant }); },
    isGuest() { return !connected(); },
  };

  // Classement réel : lecture via get-leaderboard (public_ref, jamais d'UUID Auth). Realtime branché
  // par realtime.js si un client Supabase est disponible ; sinon repli sur polling léger.
  global.JogadleLeaderboardAPI = {
    async getLeague(league) {
      if (!ready) return { rows: [], myUserId: null, seasonName: "—", seasonLeft: "—", unranked: null };
      var d = await call("get-leaderboard", { league: league });
      var meRef = global.__JOGADLE_ME ? global.__JOGADLE_ME.public_ref : null;
      return {
        rows: (d.rows || []).map(function (r) {
          return { user_id: r.public_ref, public_ref: r.public_ref, display_name: r.display_name, points: r.points, evolution: r.evolution, active_badge_label: r.badge, isMe: (meRef && r.public_ref === meRef) };
        }),
        myUserId: meRef,
        seasonName: d.season && d.season.label,
        seasonEnd: d.season && d.season.ends_at ? Date.parse(d.season.ends_at) : null,
        // Hors Ligue RÉEL renvoyé par le serveur pour le joueur connecté (R2, point 4).
        unranked: d.me && d.me.league === "unranked" ? { rank: d.me.rank, points: d.me.points, gapToNoob: d.me.gap_to_noob } : null,
      };
    },
    subscribe: function (onChange) {
      if (global.JogadleRealtime && global.JogadleRealtime.subscribe) return global.JogadleRealtime.subscribe(onChange);
      var t = setInterval(onChange, 5000); return function () { clearInterval(t); }; // repli polling
    },
  };

  global.JogadleAPI = real;
})(window);
