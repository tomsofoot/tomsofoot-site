/* Jogadle — jeu (page dédiée). Piloté par l'ADAPTATEUR (serveur R2 ou mock) : aucune cible côté client.
   Chaque proposition est envoyée au serveur qui renvoie uniquement les états visuels des 7 cases. */
(function (global) {
  "use strict";
  var API = global.JogadleAPI;
  var root = document.querySelector(".jogadle");
  if (!root || !API) return;
  var CFG = global.JOGADLE_CONFIG || {};

  var el = {
    input: root.querySelector("#td-input"), sugg: root.querySelector("#td-suggestions"),
    search: root.querySelector("#td-search"), field: root.querySelector("#td-field"),
    board: root.querySelector("#td-board-area"),
    end: root.querySelector("#td-end"), count: root.querySelector("#td-count"),
    hint: root.querySelector("#td-hint"), edition: root.querySelector("#td-puzzle"),
  };
  var HEAD = ["Joueur", "Confédération", "Club", "Ligue", "Nation", "Poste", "Âge", "N°"];
  var BAREME = { 1: 100, 2: 50, 3: 45, 4: 35, 5: 25, 6: 15, 7: 5, 8: 5 };
  // Révélation séquentielle des 8 cases : 350 ms de décalage par case (comme la version premium).
  // La dernière case (--delay 2450 ms) + 460 ms d'animation finit vers 2910 ms : REVEAL_MS couvre tout.
  var CELL_STAGGER = 350;
  var REVEAL_MS = 3100;
  var REDUCED = !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
  function lockInput(on) {
    if (el.field) el.field.classList.toggle("locked", on);
    if (el.input) { el.input.disabled = on; el.input.placeholder = on ? "Révélation en cours…" : "Rechercher un joueur…"; }
  }

  var state = { guesses: [], status: "active", hintRevealed: false, hintLetter: null, playersById: {}, busy: false };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ageOf(bd) { if (!bd) return null; var b = new Date(bd + "T00:00:00Z"), t = new Date(); var a = t.getUTCFullYear() - b.getUTCFullYear(); var m = t.getUTCMonth() - b.getUTCMonth(); if (m < 0 || (m === 0 && t.getUTCDate() < b.getUTCDate())) a--; return a; }

  // ---------- Recherche / autocomplétion (via search-players côté serveur) ----------
  var searchTimer = null;
  el.input.addEventListener("input", function () {
    clearTimeout(searchTimer); var q = el.input.value.trim();
    if (q.length < 2 || state.status !== "active") { hideSugg(); return; }
    searchTimer = setTimeout(function () { runSearch(q); }, 160);
  });
  el.input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); var b = el.sugg.querySelector("button[data-id]"); if (b) pick(b.getAttribute("data-id")); } else if (e.key === "Escape") hideSugg(); });
  document.addEventListener("click", function (e) { if (!el.search.contains(e.target)) hideSugg(); });
  function hideSugg() { el.sugg.hidden = true; el.sugg.innerHTML = ""; }
  // Prénom du joueur (nom complet moins le nom de famille = short_name).
  function firstNameOf(p) {
    var full = String(p.name || "").trim(), last = String(p.short_name || "").trim();
    if (last && full.toLowerCase().slice(-last.length) === last.toLowerCase()) return full.slice(0, full.length - last.length).trim();
    var parts = full.split(/\s+/); return parts.length > 1 ? parts.slice(0, -1).join(" ") : "";
  }
  function isGuessed(id) { return state.guesses.some(function (g) { return g.player && g.player.id === id; }); }
  async function runSearch(q) {
    var res = await API.searchPlayers(q); if (!res || !res.length) { hideSugg(); return; }
    res.forEach(function (p) { state.playersById[p.id] = p; });
    // À gauche le NOM de famille, à droite le PRÉNOM (plus le club). Un joueur déjà
    // essayé réapparaît avec la mention stylisée « joueur déjà utilisé » (non cliquable).
    el.sugg.innerHTML = res.map(function (p) {
      var last = esc(p.short_name || p.name), first = esc(firstNameOf(p));
      if (isGuessed(p.id)) {
        return '<div class="sugg-used" aria-disabled="true"><span>' + last + '</span><em class="sugg-used__tag">joueur déjà utilisé</em><small>' + first + '</small></div>';
      }
      return '<button type="button" data-id="' + esc(p.id) + '"><span>' + last + '</span><small>' + first + '</small></button>';
    }).join("");
    el.sugg.hidden = false;
    el.sugg.querySelectorAll("button[data-id]").forEach(function (b) { b.addEventListener("mousedown", function (e) { e.preventDefault(); pick(b.getAttribute("data-id")); }); });
  }

  // ---------- Proposition ----------
  async function pick(id) {
    if (state.busy || state.status !== "active") return; state.busy = true;
    lockInput(true);                                  // entrée verrouillée pendant la révélation
    el.input.value = ""; hideSugg();
    try {
      var r = await API.submitGuess(id);
      if (r && r.error) { state.busy = false; lockInput(false); return; }
      var player = state.playersById[id] || { id: id, short_name: id };
      state.guesses.push({ player: player, states: r.states });
      state.status = r.status || (r.isWin ? "won" : "active");
      renderBoard(true);                              // la ligne fraîche se retourne case par case
      updateCount(); refreshHint(); refreshPoints();
      // Bruitage : « bonne réponse » quand la dernière case (verte) se retourne, sinon « mauvaise réponse ».
      var soundDelay = REDUCED ? 0 : (7 * CELL_STAGGER + 250);
      setTimeout(function () { if (global.JogadleSound) { r.isWin ? global.JogadleSound.correct() : global.JogadleSound.wrong(); } }, soundDelay);
      // Fin de la révélation SÉQUENTIELLE : on attend que les 8 cases aient fini de se retourner
      // avant de figer la ligne et, le cas échéant, d'afficher le Bravo.
      var finish = function () {
        var row = el.board.querySelector(".guess-row.revealing");
        if (row) { row.classList.remove("revealing"); row.classList.add("revealed"); }
        state.busy = false; lockInput(false);
        if (r.isWin) showBravo();
      };
      if (REDUCED) finish(); else setTimeout(finish, REVEAL_MS + 200);
    } catch (e) { state.busy = false; lockInput(false); /* mode dégradé */ }
  }

  function updateCount() { if (el.count) el.count.textContent = String(state.guesses.length).padStart(2, "0"); root.classList.toggle("has-guesses", state.guesses.length > 0); }

  // ---------- Rendu du plateau (miroir du style premium) ----------
  function cell(html, cls, delay) {
    return '<div class="flip-cell" style="--delay:' + (delay * CELL_STAGGER) + 'ms"><div class="flip-inner"><div class="flip-face flip-front" aria-hidden="true"><span>T</span></div><div class="flip-face flip-back ' + cls + '"><span>' + html + '</span></div></div></div>';
  }
  function rowHTML(g, revealCls) {
    var p = g.player, s = g.states;
    var ARW = function (d) { return d === "up" ? '<svg class="arw up" viewBox="0 0 100 100"><path d="M42 12 h16 v47 h18 L50 88 24 59 h18 Z"/></svg>' : d === "down" ? '<svg class="arw" viewBox="0 0 100 100"><path d="M42 12 h16 v47 h18 L50 88 24 59 h18 Z"/></svg>' : ""; };
    var by = {}; s.forEach(function (x) { by[x.key] = x; });
    var age = ageOf(p.birth_date);
    var numCell = p.number != null ? ('<span class="fig">' + p.number + "</span>" + ARW(by.number && by.number.direction))
      : '<span class="fig dash" title="Ce joueur n\'a pas encore de numéro officiel.">—</span><i class="no-num">(pas de n° officiel)</i>';
    var cells = [
      '<div class="flip-cell" style="--delay:0ms"><div class="flip-inner"><div class="flip-face flip-front" aria-hidden="true"><span>T</span></div><div class="flip-face flip-back player-cell"><b>' + esc(p.short_name || p.name) + "</b></div></div></div>",
      cell(esc(p.confederation || "—"), "result " + st(by.confederation), 1),
      cell(esc(p.club || "—"), "result " + st(by.club), 2),
      cell(esc(p.league || "—"), "result " + st(by.league), 3),
      cell(esc(p.country || "—"), "result " + st(by.country), 4),
      cell(esc(p.position || "—"), "result " + st(by.position), 5),
      cell('<span class="fig">' + (age == null ? "—" : age) + "</span>" + ARW(by.age && by.age.direction), "result num " + st(by.age), 6),
      cell(numCell, "result num " + st(by.number), 7),
    ].join("");
    return '<div class="guess-row ' + revealCls + '" data-id="' + esc(p.id) + '">' + cells + "</div>";
  }
  function st(x) { return x && x.state === "correct" ? "correct" : "wrong"; }

  function renderBoard(animateLast) {
    if (!state.guesses.length) { el.board.innerHTML = ""; return; }
    var head = '<div class="board-head">' + HEAD.map(function (h) { return "<span>" + h + "</span>"; }).join("") + "</div>";
    var older = state.guesses.slice(0, -1).map(function (g) { return rowHTML(g, "revealed"); }).reverse().join("");
    var fresh = rowHTML(state.guesses[state.guesses.length - 1], animateLast ? "revealing" : "revealed");
    el.board.innerHTML = '<div class="board-wrap"><div class="board">' + head + fresh + older + "</div></div>";
    // La bascule .revealing -> .revealed est pilotée par pick() (finish), une fois toutes les cases retournées.
  }

  // ---------- Points potentiels ----------
  function refreshPoints() {
    var live = document.querySelector("#jg-points-live"); if (!live) return;
    if (state.status !== "active") { live.style.display = "none"; return; }
    live.style.display = "";
    var next = state.guesses.length + 1;
    var pot = Math.max(0, (BAREME[next] || 0) - (state.hintRevealed ? 5 : 0));
    live.querySelector("strong").textContent = pot + " pts";
    live.classList.toggle("is-perfect", pot === 100);
  }

  // ---------- Indice (débloqué après 5 mauvaises) ----------
  function wrongCount() { return state.guesses.filter(function (g) { return !g.states.every(function (s) { return s.state === "correct"; }) && g.states.some(function (s) { return s.state === "wrong"; }); }).length; }
  function refreshHint() {
    if (!el.hint || el.hint.classList.contains("is-open")) return;
    var w = wrongCount();
    if (w >= 5) { el.hint.classList.add("is-ready"); el.hint.classList.remove("is-locked"); }
    else { el.hint.classList.add("is-locked"); el.hint.classList.remove("is-ready"); var c = el.hint.querySelector(".hint-fab__count"); if (c) c.textContent = w + "/5"; }
  }
  if (el.hint) {
    var btn = el.hint.querySelector(".hint-fab__btn");
    if (btn) btn.addEventListener("click", async function () {
      if (el.hint.classList.contains("is-open")) return;
      if (!el.hint.classList.contains("is-ready")) { el.hint.classList.add("show-tip"); setTimeout(function () { el.hint.classList.remove("show-tip"); }, 3000); return; }
      var r = await API.revealHint();
      if (r && r.letter) { state.hintRevealed = true; var b = el.hint.querySelector(".hint-fab__reveal b"); if (b) b.textContent = r.letter; el.hint.classList.add("is-open"); refreshPoints(); }
    });
  }

  // ---------- Révéler la réponse ----------
  var revealBtn = root.querySelector("#td-reveal");
  if (revealBtn) revealBtn.addEventListener("click", function () {
    if (state.status !== "active") return;
    var attempts = state.guesses.length; var pen = attempts < 7 ? -10 : -5;
    if (!confirm("Révéler la réponse ? Ce n'est pas une victoire." + (API.isGuest && API.isGuest() ? " (invité : aucun point)" : " Pénalité de saison : " + pen + " pts."))) return;
    API.revealAnswer().then(function (r) {
      state.status = "revealed";
      el.end.innerHTML = '<div class="end-card"><span>Réponse révélée</span><h3>C\'était ' + esc(r.answer && r.answer.name) + '</h3><p>Aucune victoire, aucun point de victoire.</p></div>';
      refreshPoints(); scrollToEnd();
    });
  });

  // ---------- Bravo + défilement ----------
  function showBravo() {
    if (el.search) el.search.style.display = "none";
    var n = state.guesses.length;
    el.end.innerHTML = '<div class="end-card"><span>Bravo !</span><h3>Trouvé en ' + n + " proposition" + (n > 1 ? "s" : "") + '</h3><p>Revenez demain à minuit pour un nouveau joueur.</p><div class="end-actions"><button type="button" data-td-share>Partager</button><button type="button" class="secondary" data-td-png>Télécharger le PNG</button></div></div>';
    refreshPoints(); scrollToEnd();
  }
  function scrollToEnd() {
    var card = el.end.querySelector(".end-card"); if (!card) return;
    var desktop = global.matchMedia && global.matchMedia("(min-width:1100px)").matches;
    var scroller = desktop ? document.querySelector(".jogadle-game") : null;
    if (!scroller) return;
    var sRect = scroller.getBoundingClientRect(), cRect = card.getBoundingClientRect();
    var target = scroller.scrollTop + (cRect.top - sRect.top) - (scroller.clientHeight - card.offsetHeight) / 2;
    setTimeout(function () { try { scroller.scrollTo({ top: Math.max(0, target), behavior: "smooth" }); } catch (e) { scroller.scrollTop = Math.max(0, target); } }, 340);
  }

  // ---------- Partage / PNG (carte de résultat quotidienne) ----------
  function rowsForShare() { return state.guesses.map(function (g) { return g.states.map(function (s) { return s.state; }); }); }
  if (el.end) el.end.addEventListener("click", function (e) {
    if (e.target.closest("[data-td-png]") && global.JogadleShareCard) {
      global.JogadleShareCard.download({ puzzleId: (el.edition && el.edition.textContent || "#100").replace("#", ""), score: state.guesses.length, rows: rowsForShare(), logoSrc: "assets/tomsofoot-logo.png" });
    } else if (e.target.closest("[data-td-share]")) {
      var txt = "Jogadle " + (el.edition && el.edition.textContent || "#100") + " — trouvé en " + state.guesses.length + " propositions\nJouez sur tomsofoot.fr/jeu";
      if (navigator.share) navigator.share({ title: "Mon score Jogadle", text: txt }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(txt);
    }
  });

  // ---------- Reprise après rafraîchissement ----------
  // Reconstruit TOUTES les lignes/couleurs à partir des propositions renvoyées par le serveur,
  // en récupérant les attributs PUBLICS des joueurs proposés (jamais la cible avant la fin).
  async function rebuildFromResume(s) {
    var raw = s.guesses || [];
    var ids = raw.map(function (g) { return g.guess_player_id; }).filter(Boolean);
    var players = [];
    try { players = await API.getPlayersByIds(ids); } catch (e) { players = []; }
    (players || []).forEach(function (p) { if (p && p.id) state.playersById[p.id] = p; });
    state.guesses = raw.map(function (g) {
      var p = state.playersById[g.guess_player_id] || { id: g.guess_player_id, short_name: g.guess_player_id };
      return { player: p, states: g.states };
    });
    state.status = s.status || "active";
    state.hintRevealed = !!s.hint_revealed;
    renderBoard(false);                 // aucune animation à la reprise
    updateCount(); refreshHint(); refreshPoints();

    // Indice déjà révélé : on restaure la lettre (appel idempotent côté serveur).
    if (state.hintRevealed && el.hint && !el.hint.classList.contains("is-open")) {
      try { var h = await API.revealHint(); if (h && h.letter) { var b = el.hint.querySelector(".hint-fab__reveal b"); if (b) b.textContent = h.letter; el.hint.classList.remove("is-locked"); el.hint.classList.add("is-ready", "is-open"); } } catch (e) {}
    }
    // Partie déjà terminée : on restaure l'écran de fin (Bravo ou Réponse révélée).
    if (state.status === "won") showBravo();
    else if (state.status === "revealed") {
      var name = s.answer && s.answer.name ? s.answer.name : "—";
      el.end.innerHTML = '<div class="end-card"><span>Réponse révélée</span><h3>C\'était ' + esc(name) + '</h3><p>Aucune victoire, aucun point de victoire.</p></div>';
      refreshPoints();
    }
  }

  // ---------- Démarrage ----------
  async function boot() {
    try {
      var d = await API.getDailyPuzzle(); if (el.edition && d && d.edition) el.edition.textContent = "#" + d.edition;
      var s = await API.ensureSession();
      if (s && s.guesses && s.guesses.length) {
        await rebuildFromResume(s);
      } else {
        state.status = (s && s.status) || "active"; state.hintRevealed = !!(s && s.hint_revealed);
        updateCount(); refreshHint(); refreshPoints();
      }
    } catch (e) { degrade(); }
  }
  function degrade() {
    if (CFG.TEST_MODE) return;
    var g = document.querySelector(".game-shell");
    if (g) g.insertAdjacentHTML("afterbegin", '<div class="jg-degraded">Le championnat est momentanément indisponible. Réessayez plus tard.</div>');
  }

  global.JogadleGame = { boot: boot };
  boot();
})(window);
