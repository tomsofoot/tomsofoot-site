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
    used: root.querySelector("#td-used"), reveal: root.querySelector("#td-reveal"),
  };
  // Anti-triche : « Révéler la réponse » n'est utilisable qu'à partir de 7 tentatives.
  var REVEAL_MIN = 7;
  var HEAD = ["Joueur", "Confédération", "Club", "Ligue", "Nation", "Poste", "Âge", "N°"];
  // Barème officiel : source unique = window.JogadleRules (miroir du serveur). 7=5, 8=3, 9=1, 10+=0.
  var RULES = global.JogadleRules || { potential: function (n, h) { var m = { 1: 100, 2: 50, 3: 45, 4: 35, 5: 25, 6: 15, 7: 5, 8: 3, 9: 1 }; return Math.max(0, (m[n] || 0) - (h ? 5 : 0)); }, base: function (n) { var m = { 1: 100, 2: 50, 3: 45, 4: 35, 5: 25, 6: 15, 7: 5, 8: 3, 9: 1 }; return m[n] || 0; } };
  // Révélation séquentielle des 8 cases : 350 ms de décalage par case (comme la version premium).
  // La dernière case (--delay 2450 ms) + 460 ms d'animation finit vers 2910 ms : REVEAL_MS couvre tout.
  var CELL_STAGGER = 350;
  var REVEAL_MS = 3100;
  var REDUCED = !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
  function lockInput(on) {
    if (el.field) el.field.classList.toggle("locked", on);
    if (el.input) { el.input.disabled = on; el.input.placeholder = on ? "Révélation en cours…" : "Rechercher un joueur…"; }
  }

  var state = { guesses: [], status: "active", hintRevealed: false, hintLetter: null, playersById: {}, busy: false, winRecap: null };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ageOf(bd) { if (!bd) return null; var b = new Date(bd + "T00:00:00Z"), t = new Date(); var a = t.getUTCFullYear() - b.getUTCFullYear(); var m = t.getUTCMonth() - b.getUTCMonth(); if (m < 0 || (m === 0 && t.getUTCDate() < b.getUTCDate())) a--; return a; }

  // ---------- Recherche / autocomplétion (via search-players côté serveur) ----------
  var searchTimer = null;
  // Dès que le joueur commence à taper / cible le champ, on réveille la fonction serveur
  // (pré-chauffage anti démarrage-à-froid) : elle sera déjà prête au moment de la proposition.
  if (el.input) el.input.addEventListener("focus", function () { if (API.warm) API.warm(); });
  el.input.addEventListener("input", function () {
    clearTimeout(searchTimer); var q = el.input.value.trim();
    if (q.length < 2 || state.status !== "active") { hideSugg(); return; }
    if (API.warm) API.warm();
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
    renderPending();                                  // ligne d'attente stylisée « chargement » (cases masquées)
    try {
      var r = await API.submitGuess(id);
      if (r && r.error) { state.busy = false; lockInput(false); renderBoard(false); return; }
      var player = state.playersById[id] || { id: id, short_name: id };
      state.guesses.push({ player: player, states: r.states });
      state.status = r.status || (r.isWin ? "won" : "active");
      state.winRecap = r.isWin ? (r.win || null) : null;   // récap serveur (calcul déjà fait côté serveur)
      renderBoard(true);                              // la ligne fraîche se retourne case par case
      renderUsedList();                               // liste « joueurs déjà utilisés » mise à jour
      updateCount(); refreshHint(); refreshPoints(); refreshReveal();
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
    } catch (e) { state.busy = false; lockInput(false); renderBoard(false); /* mode dégradé : on retire la ligne d'attente */ }
  }

  function updateCount() { if (el.count) el.count.textContent = String(state.guesses.length).padStart(2, "0"); root.classList.toggle("has-guesses", state.guesses.length > 0); }

  // ---------- Rendu du plateau (miroir du style premium) ----------
  function cell(html, cls, delay) {
    return '<div class="flip-cell" style="--delay:' + (delay * CELL_STAGGER) + 'ms"><div class="flip-inner"><div class="flip-face flip-front" aria-hidden="true"><span>T</span></div><div class="flip-face flip-back ' + cls + '"><span>' + html + '</span></div></div></div>';
  }
  function rowHTML(g, revealCls) {
    var p = g.player, s = g.states || [];
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

  // Retour IMMÉDIAT : dès la validation, on affiche une ligne « en attente » (cases côté face,
  // avec une pulsation) le temps que le serveur calcule les couleurs. Ça masque la latence réseau
  // (le résultat n'est jamais côté client, pour l'anti-triche) : ça paraît instantané.
  // Ligne « en attente » : cases MASQUÉES (rien n'est dévoilé), mais stylisées « chargement de la
  // réponse » — un reflet violet (shimmer) balaie la ligne en vague. Les cases se retournent ensuite
  // pour révéler le résultat (méthode d'origine conservée : l'effet de surprise reste intact).
  function renderPending() {
    if (!el.board) return;
    var head = '<div class="board-head">' + HEAD.map(function (h) { return "<span>" + h + "</span>"; }).join("") + "</div>";
    var older = state.guesses.map(function (g) { return rowHTML(g, "revealed"); }).reverse().join("");
    var c = "";
    for (var i = 0; i < 8; i++) {
      c += '<div class="flip-cell"><div class="pending-cell" style="animation-delay:' + (i * 85) + 'ms"></div></div>';
    }
    var pend = '<div class="guess-row is-pending" aria-label="Chargement de la réponse en cours">' + c + "</div>";
    el.board.innerHTML = '<div class="board-wrap"><div class="board">' + head + pend + older + "</div></div>";
  }

  // ---------- Liste « joueurs déjà utilisés » (sous la recherche, mise à jour automatique) ----------
  // Dès qu'une proposition n'est pas la bonne, le joueur apparaît ici avec la mention stylisée
  // « joueur déjà utilisé » suivie de son nom et de son prénom.
  function renderUsedList() {
    if (!el.used) return;
    var used = state.guesses.filter(function (g) {
      return !(g.states && g.states.length && g.states.every(function (s) { return s.state === "correct"; }));
    });
    if (!used.length) { el.used.hidden = true; el.used.innerHTML = ""; return; }
    el.used.hidden = false;
    el.used.innerHTML = used.slice().reverse().map(function (g) {
      var p = g.player;
      return '<div class="used-item"><em class="used-item__tag">joueur déjà utilisé</em>' +
        '<span class="used-item__name">' + esc(p.short_name || p.name) + '</span>' +
        '<small class="used-item__first">' + esc(firstNameOf(p)) + '</small></div>';
    }).join("");
  }

  // ---------- Points potentiels ----------
  function refreshPoints() {
    var live = document.querySelector("#jg-points-live"); if (!live) return;
    if (state.status !== "active") { live.style.display = "none"; return; }
    live.style.display = "";
    var next = state.guesses.length + 1;
    var pot = RULES.potential(next, state.hintRevealed);
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
  // Verrou anti-triche : le bouton reste inactif tant que < REVEAL_MIN tentatives.
  function refreshReveal() {
    if (!el.reveal) return;
    var n = state.guesses.length;
    if (state.status !== "active") { el.reveal.disabled = true; return; }
    if (n >= REVEAL_MIN) {
      el.reveal.disabled = false;
      el.reveal.textContent = "Révéler la réponse";
      el.reveal.removeAttribute("title");
    } else {
      var left = REVEAL_MIN - n;
      el.reveal.disabled = true;
      el.reveal.textContent = "Révéler la réponse (encore " + left + " essai" + (left > 1 ? "s" : "") + ")";
      el.reveal.setAttribute("title", "Disponible après " + REVEAL_MIN + " tentatives");
    }
  }
  var revealBtn = el.reveal;
  if (revealBtn) revealBtn.addEventListener("click", function () {
    if (state.status !== "active") return;
    if (state.guesses.length < REVEAL_MIN) { refreshReveal(); return; }   // garde-fou
    var attempts = state.guesses.length; var pen = attempts < 7 ? -10 : -5;
    if (!confirm("Révéler la réponse ? Ce n'est pas une victoire." + (API.isGuest && API.isGuest() ? " (invité : aucun point)" : " Pénalité de saison : " + pen + " pts."))) return;
    API.revealAnswer().then(function (r) {
      state.status = "revealed";
      var a = r.answer || {};
      var full = a.name || a.short_name || "—";
      var club = a.club ? ' <small class="end-club">(' + esc(a.club) + ')</small>' : '';
      el.end.innerHTML = '<div class="end-card"><span>Réponse révélée</span><h3>C\'était ' + esc(full) + club + '</h3><p>Aucune victoire, aucun point de victoire.</p></div>';
      refreshPoints(); scrollToEnd();
    });
  });
  refreshReveal();   // état initial : verrouillé tant que < 7 tentatives

  // ---------- Bravo + défilement ----------
  function leagueLabel(key) {
    var L = (RULES && RULES.LEAGUE_LABELS) || { ultimate: "Ultime", pro: "Pro", rookie: "Rookie", noob: "Noob" };
    return L[key] || null;
  }
  // Récapitulatif détaillé de fin de partie. Toutes les valeurs proviennent du serveur (state.winRecap) ;
  // le client ne fait qu'AFFICHER (aucun point n'est calculé ici).
  function recapHTML() {
    var w = state.winRecap;
    if (!w) return "";                                   // invité / mode dégradé : pas de récap chiffré
    var rows = [];
    rows.push(["Essais", String(w.attempts)]);
    if (w.moneyTime) {
      // Jour de Money Time : le gain quotidien est remplacé par la variation de championnat (calculée à part).
      return '<div class="bravo-recap"><div class="bravo-recap__mt">Money Time — votre variation de championnat remplace le gain quotidien. ' +
        'Elle sera appliquée à la clôture du groupe.</div></div>';
    }
    rows.push(["Points de base", "+" + w.base]);
    if (w.hintPenalty) rows.push(["Indice révélé", "−" + w.hintPenalty]);
    var recapLines = rows.map(function (r) {
      var neg = /^−/.test(r[1]);
      return '<div class="bravo-recap__row"><span>' + esc(r[0]) + '</span><b class="' + (neg ? "is-neg" : "") + '">' + esc(r[1]) + '</b></div>';
    }).join("");
    var won = '<div class="bravo-recap__row bravo-recap__row--won"><span>Points gagnés</span><b>+' + w.pointsWon + '</b></div>';
    var totalBlock = '';
    if (typeof w.totalAfter === "number") {
      totalBlock = '<div class="bravo-recap__total"><span>Total de saison</span>' +
        '<em>' + (typeof w.totalBefore === "number" ? w.totalBefore + ' → ' : '') + '<b>' + w.totalAfter + ' pts</b></em></div>';
    }
    var pos = '';
    var lbl = leagueLabel(w.league);
    if (lbl && w.rank != null) {
      var ev = w.evolution || 0;
      var evTxt = ev > 0 ? '<i class="up">▲ +' + ev + '</i>' : ev < 0 ? '<i class="down">▼ ' + Math.abs(ev) + '</i>' : '<i class="flat">— stable</i>';
      pos = '<div class="bravo-recap__pos"><span>Ligue ' + esc(lbl) + '</span><em>' + esc(w.rank) + '<sup>e</sup> ' + evTxt + '</em></div>';
    }
    return '<div class="bravo-recap">' + recapLines + won + totalBlock + pos + '</div>';
  }
  function showBravo() {
    if (el.search) el.search.style.display = "none";
    var n = state.guesses.length;
    el.end.innerHTML = '<div class="end-card"><span>Bravo !</span><h3>Trouvé en ' + n + " proposition" + (n > 1 ? "s" : "") + '</h3>' +
      recapHTML() +
      '<p>Revenez demain à minuit pour un nouveau joueur.</p><div class="end-actions"><button type="button" data-td-share>Partager</button><button type="button" class="secondary" data-td-png>Télécharger le PNG</button></div></div>';
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
  // Squelette de reprise : affiche INSTANTANÉMENT autant de lignes « en chargement » que de
  // propositions à restaurer, pour un retour visuel immédiat pendant la récupération des attributs
  // publics (évite l'impression d'écran figé pendant le chargement).
  function renderResumeSkeleton(n) {
    if (!el.board || !n) return;
    var head = '<div class="board-head">' + HEAD.map(function (h) { return "<span>" + h + "</span>"; }).join("") + "</div>";
    var rows = "";
    for (var r = 0; r < n; r++) {
      var c = "";
      for (var i = 0; i < 8; i++) { c += '<div class="flip-cell"><div class="pending-cell" style="animation-delay:' + (i * 85) + 'ms"></div></div>'; }
      rows += '<div class="guess-row is-pending" aria-hidden="true">' + c + "</div>";
    }
    el.board.innerHTML = '<div class="board-wrap"><div class="board">' + head + rows + "</div></div>";
  }

  async function rebuildFromResume(s) {
    var raw = s.guesses || [];
    renderResumeSkeleton(raw.length);   // feedback immédiat pendant la récupération des attributs
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
    renderUsedList();                   // restaure la liste « joueurs déjà utilisés »
    updateCount(); refreshHint(); refreshPoints(); refreshReveal();

    // Indice déjà révélé : on restaure la lettre (appel idempotent côté serveur).
    if (state.hintRevealed && el.hint && !el.hint.classList.contains("is-open")) {
      try { var h = await API.revealHint(); if (h && h.letter) { var b = el.hint.querySelector(".hint-fab__reveal b"); if (b) b.textContent = h.letter; el.hint.classList.remove("is-locked"); el.hint.classList.add("is-ready", "is-open"); } } catch (e) {}
    }
    // Partie déjà terminée : on restaure l'écran de fin (Bravo ou Réponse révélée).
    if (state.status === "won") showBravo();
    else if (state.status === "revealed") {
      var name = s.answer && s.answer.name ? s.answer.name : "—";
      var clubR = s.answer && s.answer.club ? ' <small class="end-club">(' + esc(s.answer.club) + ')</small>' : '';
      el.end.innerHTML = '<div class="end-card"><span>Réponse révélée</span><h3>C\'était ' + esc(name) + clubR + '</h3><p>Aucune victoire, aucun point de victoire.</p></div>';
      refreshPoints();
    }
  }

  // ---------- Démarrage ----------
  async function boot() {
    try {
      if (API.warm) API.warm();   // pré-chauffe la fonction dès l'ouverture du jeu
      // Les deux appels d'ouverture sont INDÉPENDANTS : on les lance EN PARALLÈLE au lieu de les
      // enchaîner en série, ce qui réduit fortement le temps de chargement (surtout au démarrage à
      // froid des fonctions). L'édition du jour s'affiche dès qu'elle arrive, sans bloquer le plateau.
      var puzzleP = API.getDailyPuzzle();
      var sessionP = API.ensureSession();
      puzzleP.then(function (d) { if (el.edition && d && d.edition) el.edition.textContent = "#" + d.edition; }).catch(function () {});
      var s = await sessionP;
      if (s && s.guesses && s.guesses.length) {
        await rebuildFromResume(s);
      } else {
        state.status = (s && s.status) || "active"; state.hintRevealed = !!(s && s.hint_revealed);
        updateCount(); refreshHint(); refreshPoints(); refreshReveal();
      }
      try { await puzzleP; } catch (e) {}   // édition déjà gérée ci-dessus ; on absorbe une éventuelle erreur
    } catch (e) { degrade(); }
  }
  function degrade() {
    if (CFG.TEST_MODE) return;
    var g = document.querySelector(".game-shell");
    if (g) g.insertAdjacentHTML("afterbegin", '<div class="jg-degraded">Le championnat est momentanément indisponible. Réessayez plus tard.</div>');
  }

  // ---------- Rafraîchissement automatique au changement de jour (minuit, Paris) ----------
  // À minuit (heure de Paris) le joueur du jour change. Sans rechargement de page, tout ce qui
  // concerne la partie de la veille (plateau, propositions, liste « déjà utilisés », recherche,
  // écran de fin) doit disparaître, puis la partie du nouveau jour se charge. Fonctionne en mode
  // CONNECTÉ comme INVITÉ, et se déclenche aussi au retour sur l'onglet.
  function parisDayKey() {
    try {
      return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    } catch (e) {
      var n = new Date(); return n.getUTCFullYear() + "-" + (n.getUTCMonth() + 1) + "-" + n.getUTCDate();
    }
  }
  var currentDayKey = parisDayKey();
  function resetForNewDay() {
    // On repart d'un état vierge : plus aucune trace des joueurs testés la veille (y compris dans
    // les suggestions de la barre de recherche, qui s'appuient sur state.guesses / « déjà utilisé »).
    state = { guesses: [], status: "active", hintRevealed: false, hintLetter: null, playersById: {}, busy: false, winRecap: null };
    if (el.input) { el.input.value = ""; el.input.disabled = false; }
    hideSugg();
    if (el.board) el.board.innerHTML = "";
    if (el.used) { el.used.hidden = true; el.used.innerHTML = ""; }
    if (el.end) el.end.innerHTML = "";
    if (el.search) el.search.style.display = "";
    if (el.hint) {
      el.hint.classList.remove("is-open", "is-ready");
      el.hint.classList.add("is-locked");
      var hb = el.hint.querySelector(".hint-fab__reveal b"); if (hb) hb.textContent = "";
      var hc = el.hint.querySelector(".hint-fab__count"); if (hc) hc.textContent = "0/5";
    }
    lockInput(false);
    updateCount(); refreshHint(); refreshPoints(); refreshReveal();
    boot();   // recharge le joueur du jour (nouvelle session serveur) ; degrade() si indisponible
  }
  function checkDayRollover() {
    var k = parisDayKey();
    if (k !== currentDayKey) { currentDayKey = k; resetForNewDay(); }
  }
  setInterval(checkDayRollover, 15000);   // vérification légère toutes les 15 s
  document.addEventListener("visibilitychange", function () { if (!document.hidden) checkDayRollover(); });

  global.JogadleGame = { boot: boot, resetForNewDay: resetForNewDay };
  boot();
})(window);
