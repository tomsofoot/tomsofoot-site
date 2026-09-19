/* Jogadle 2 · Mode Carrière — habillage MOBILE (pensé pour le pouce, comme le jeu 1).
   Actif UNIQUEMENT si <html data-mc-view="mobile"> (posé dans le <head> de mode-carriere/index.html).
   Sur ordinateur, ce script s'arrête immédiatement : la version PC reste strictement identique.

   Aucune logique de jeu ici : ce fichier DÉPLACE des éléments existants dans deux barres fixes
   (haut / bas). Le script du jeu garde ses références aux nœuds, qui continuent de fonctionner. */
(function (global) {
  "use strict";
  var doc = document, html = doc.documentElement;
  if (html.getAttribute("data-mc-view") !== "mobile") return;

  var app = doc.getElementById("jogadle");
  if (!app) return;
  var $ = function (s, ctx) { return (ctx || doc).querySelector(s); };
  function el(tag, cls, inner) { var n = doc.createElement(tag); if (cls) n.className = cls; if (inner) n.innerHTML = inner; return n; }
  function move(node, host, before) { if (node && host && node.parentNode !== host) host.insertBefore(node, before || null); }

  // ---------- Barre du HAUT : marque + compte à rebours + menu, puis les 3 niveaux ----------
  var top = el("header", "mcm-top");
  var row = el("div", "mcm-top__row");
  var brand = el("div", "mcm-brand", '<b>JOGA<i>DLE</i> 2</b>');
  var tools = el("div", "mcm-tools");
  var clock = el("div", "mcm-clock", '<span class="mcm-clock__label">Nouveaux joueurs</span>');
  var menuBtn = el("button", "mcm-menu-btn", '<span aria-hidden="true"><i></i><i></i><i></i></span>');
  menuBtn.type = "button";
  menuBtn.setAttribute("aria-label", "Menu : récompenses, défis précédents, joueurs d'hier");
  menuBtn.setAttribute("aria-expanded", "false");
  tools.appendChild(clock); tools.appendChild(menuBtn);
  row.appendChild(brand); row.appendChild(tools);
  top.appendChild(row);
  move($("#timerValue", app), clock);            // HH:MM:SS (mis à jour par le jeu)

  // ---------- AFFICHE (même esprit que l'affiche du jeu 1) : titre Enforce + question, puis les niveaux ----------
  var hero = el("section", "mcm-hero",
    '<p class="mcm-hero__kicker">Jogadle 2 · Mode Carrière</p>' +
    '<h1 class="mcm-hero__title"><span>Un parcours.</span> <em>Un seul joueur.</em></h1>' +
    '<p class="mcm-hero__ask">Quel est le joueur mystère ?</p>');
  app.insertBefore(hero, app.firstChild);
  move($("#levelSelector", app), hero);          // Amateur / Pro / Expert (même logique, mêmes verrous)

  // ---------- Menu (feuille qui monte du bas) : récompenses, défis précédents, joueurs d'hier ----------
  var sheet = el("div", "mcm-sheet");
  sheet.setAttribute("aria-hidden", "true");
  var sheetIn = el("div", "mcm-sheet__in", '<div class="mcm-sheet__grab" aria-hidden="true"></div><div class="mcm-sheet__title">Menu</div>');
  sheetIn.setAttribute("role", "dialog");
  sheetIn.setAttribute("aria-label", "Menu");
  sheet.appendChild(sheetIn);
  move($(".daily-links", app), sheetIn);         // les boutons gardent leur data-act → mêmes écrans
  var sheetNote = el("div", "mcm-sheet__note");
  var sub = $(".dt-sub", app);
  if (sub) sheetNote.textContent = sub.textContent;
  sheetIn.appendChild(sheetNote);
  function openSheet(on) {
    html.classList.toggle("mcm-sheet-open", on);
    sheet.setAttribute("aria-hidden", on ? "false" : "true");
    menuBtn.setAttribute("aria-expanded", on ? "true" : "false");
  }
  menuBtn.addEventListener("click", function () { openSheet(!html.classList.contains("mcm-sheet-open")); });
  sheet.addEventListener("click", function (e) {
    if (e.target === sheet || e.target.closest("[data-act]")) openSheet(false);  // un choix ouvre l'écran et ferme le menu
  });
  doc.addEventListener("keydown", function (e) { if (e.key === "Escape") openSheet(false); });

  // ---------- Barre du BAS (zone du pouce) : joueurs utilisés, message, actions, recherche ----------
  var dock = el("div", "mcm-dock");
  var dockIn = el("div", "mcm-dock__in");
  var actions = el("div", "mcm-actions");
  dock.appendChild(dockIn);
  move($("#usedPlayers", app), dockIn);          // « joueurs déjà utilisés » (rempli par le jeu)
  move($("#message", app), dockIn);              // messages du jeu (« Ce n'est pas lui », etc.)
  dockIn.appendChild(actions);
  move($("#hintButton", app), actions);          // Indice ultime
  var browse = el("button", "mcm-browse", '<span aria-hidden="true">☰</span> Tous les<br>joueurs');
  browse.type = "button";
  browse.setAttribute("data-act", "browse-open"); // même action que « Parcourir tous les joueurs »
  actions.appendChild(browse);
  move($("#revealAnswerButton", app), actions);  // Révéler la réponse
  move($("#guessForm", app), dockIn);            // recherche + suggestions + VALIDER

  // ---------- Scène de jeu : affiche + parcours + indices, toujours visibles d'un seul bloc ----------
  var stage = el("div", "mcm-stage");
  var careerSec = $(".career-section", app);
  app.insertBefore(stage, hero);
  [hero, careerSec, $(".career-caption", app), $(".game-controls", app)].forEach(function (n) { if (n) stage.appendChild(n); });

  doc.body.appendChild(top);
  doc.body.appendChild(dock);
  doc.body.appendChild(sheet);

  // Barre du haut transparente sur l'affiche, opaque dès qu'on fait défiler.
  function onScroll() { html.classList.toggle("mcm-scrolled", (global.scrollY || 0) > 8); }
  global.addEventListener("scroll", onScroll, { passive: true }); onScroll();

  // ---------- Hauteurs réelles des barres → marges du contenu ----------
  function syncHeights() {
    html.style.setProperty("--mcm-top", top.offsetHeight + "px");
    html.style.setProperty("--mcm-dock", dock.offsetHeight + "px");
    fitStage();
  }

  // Pendant la partie, la page ne défile pas : la scène (titre, cases, indices) est ajustée pour tenir
  // entre la barre du haut et la barre de recherche, avec une MARGE DE SÉCURITÉ d'environ 2 cm entre
  // les indices et la barre de recherche (≈ 63 px CSS par cm sur téléphone). Si la place manque,
  // la scène est réduite proportionnellement : la barre ne recouvre jamais les indices.
  var SAFE = 2 * 63;
  // Hauteur d'écran STABLE : la barre d'adresse de Safari qui se masque/réapparaît fait varier la
  // hauteur de ~50-100 px pendant le défilement. On ignore ces petites variations (sinon la scène se
  // redimensionne à chaque geste → la page tremble) ; seule une vraie rotation / un vrai changement compte.
  var stableH = 0, stableW = 0;
  function stableHeight() {
    var h = doc.documentElement.clientHeight || global.innerHeight, w = global.innerWidth;
    if (!stableH || w !== stableW || Math.abs(h - stableH) > 140) { stableH = h; stableW = w; }
    return stableH;
  }
  var fitting = false;
  function fitStage() {
    if (fitting || !stage) return;
    var play = !html.classList.contains("mcm-done");
    html.classList.toggle("mcm-play", play);
    if (!play) { stage.style.transform = ""; stage.style.marginBottom = ""; return; }
    if (html.classList.contains("mcm-typing")) return;          // clavier ouvert : on ne bouge rien
    fitting = true;
    var prevT = stage.style.transform, prevM = stage.style.marginBottom;
    stage.style.transform = ""; stage.style.marginBottom = "";
    var natural = stage.offsetHeight;
    var avail = stableHeight() - top.offsetHeight - dock.offsetHeight - SAFE - 6;
    var sc = natural > 0 ? Math.min(1, Math.max(0.45, avail / natural)) : 1;
    // Écart minime (< 2 %) : on garde l'échelle actuelle, pour ne jamais « respirer » pendant un geste.
    var prevSc = parseFloat((prevT.match(/scale\(([\d.]+)\)/) || [])[1] || "1");
    if (Math.abs(sc - prevSc) < 0.02) { stage.style.transform = prevT; stage.style.marginBottom = prevM; fitting = false; return; }
    if (sc < 0.999) {
      stage.style.transform = "scale(" + sc.toFixed(4) + ")";
      stage.style.marginBottom = (-(natural * (1 - sc))).toFixed(1) + "px";
    }
    html.style.setProperty("--mcm-stage-scale", sc.toFixed(4));
    fitting = false;
  }
  syncHeights();
  if (global.ResizeObserver) { var ro = new ResizeObserver(syncHeights); ro.observe(top); ro.observe(dock); }
  global.addEventListener("resize", syncHeights);

  // ---------- Clavier virtuel : la barre reste collée au clavier, SANS rebond ----------
  // Sur iPhone, ouvrir le clavier fait défiler la page et décale la zone visible par à-coups.
  // Pendant la saisie : 1) la page derrière est figée (elle ne glisse plus) ; 2) la barre est
  // recalée à CHAQUE image (requestAnimationFrame) sur le bord haut du clavier, au lieu d'attendre
  // les événements du navigateur qui arrivent en retard → elle monte une fois avec le clavier et y reste.
  var vv = global.visualViewport;
  function followKeyboard() {
    if (!vv) return;
    var hidden = Math.max(0, global.innerHeight - vv.height - vv.offsetTop);
    // Anti-tremblement : hors saisie, on ne suit QUE le clavier (> 150 px), jamais les petites
    // variations de la barre d'adresse de Safari qui apparaît/disparaît quand on fait défiler.
    if (!html.classList.contains("mcm-typing") && hidden < 150) hidden = 0;
    var dockT = hidden > 1 ? "translate3d(0," + (-hidden) + "px,0)" : "";
    var topT = (vv.offsetTop > 1 && html.classList.contains("mcm-typing")) ? "translate3d(0," + vv.offsetTop + "px,0)" : "";
    if (dock.style.transform !== dockT) dock.style.transform = dockT;
    if (top.style.transform !== topT) top.style.transform = topT;
    html.style.setProperty("--mcm-vvh", Math.round(vv.height) + "px");
  }
  if (vv) { vv.addEventListener("resize", followKeyboard); vv.addEventListener("scroll", followKeyboard); followKeyboard(); }

  var raf = 0, rafUntil = 0;
  function pump() { followKeyboard(); raf = (Date.now() < rafUntil || html.classList.contains("mcm-typing")) ? global.requestAnimationFrame(pump) : 0; }
  function track(ms) { rafUntil = Math.max(rafUntil, Date.now() + (ms || 900)); if (!raf) raf = global.requestAnimationFrame(pump); }

  // Page figée pendant la saisie (elle reprend exactement sa position ensuite)
  var lockedY = null;
  function lockPage() {
    if (lockedY !== null) return;
    lockedY = global.scrollY || 0;
    var b = doc.body.style;
    b.position = "fixed"; b.top = (-lockedY) + "px"; b.left = "0"; b.right = "0"; b.width = "100%";
    html.classList.add("mcm-locked");
  }
  function unlockPage() {
    if (lockedY === null) return;
    var y = lockedY; lockedY = null;
    var b = doc.body.style;
    b.position = ""; b.top = ""; b.left = ""; b.right = ""; b.width = "";
    html.classList.remove("mcm-locked");
    global.scrollTo(0, y);
  }

  var input = $("#guessInput");
  if (input) {
    // Le jeu place le curseur dans la recherche au chargement : on n'entre en « mode saisie » (barre
    // compacte, suggestions visibles) que lorsque le joueur touche vraiment la recherche ou tape.
    var typing = function () { lockPage(); html.classList.add("mcm-typing"); track(1200); };
    // Toucher la recherche : on donne le focus nous-mêmes SANS laisser Safari faire défiler la page.
    input.addEventListener("touchend", function (e) {
      if (doc.activeElement === input) return;
      e.preventDefault(); typing();
      try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); }
    }, { passive: false });
    input.addEventListener("pointerdown", typing);
    input.addEventListener("input", typing);
    input.addEventListener("focus", function () { if (vv && global.innerHeight - vv.height > 120) typing(); });
    input.addEventListener("blur", function () {
      setTimeout(function () {
        if (doc.activeElement === input) return;
        html.classList.remove("mcm-typing"); unlockPage(); track(900);
      }, 120);
    });
    if (vv) vv.addEventListener("resize", function () { track(700); });
    input.setAttribute("autocapitalize", "words");
  }

  // ---------- Niveau résolu / révélé : la carte de fin prend la place, la barre du bas se replie ----------
  var result = $("#gameResult", app);
  var msg = $("#message");
  var wasDone = null;
  function syncState() {
    var done = !!(result && result.classList.contains("show"));
    // Retour au jeu (niveau suivant, défi précédent…) : on remonte voir le nouveau parcours en entier.
    if (wasDone === true && !done) setTimeout(function () { global.scrollTo({ top: 0, behavior: "smooth" }); }, 60);
    // Niveau terminé : on ferme le clavier et on libère la page pour afficher la carte du joueur.
    if (done && !wasDone) {
      var inp = $("#guessInput");
      if (inp && doc.activeElement === inp) inp.blur();
      html.classList.remove("mcm-typing"); unlockPage(); track(600);
    }
    wasDone = done;
    html.classList.toggle("mcm-done", done);
    html.classList.toggle("mcm-has-msg", !!(msg && msg.textContent.trim()));
    syncHeights();
  }
  if (global.MutationObserver) {
    if (result) new MutationObserver(syncState).observe(result, { attributes: true, attributeFilter: ["class"] });
    if (msg) new MutationObserver(syncState).observe(msg, { childList: true, characterData: true, subtree: true });
  }
  syncState();

  // Écrans en superposition (tous les joueurs, calendrier, récompenses, partage…) : on masque les
  // deux barres pendant qu'ils sont ouverts, pour qu'ils occupent tout l'écran.
  var OVERLAYS = ".cal-overlay, .browse-overlay, .yd-overlay, .sr-overlay, .rw-overlay, .id-overlay, .cu-overlay";
  function syncOverlay() {
    var open = [].some.call(doc.querySelectorAll(OVERLAYS), function (o) { return o.getAttribute("aria-hidden") === "false"; });
    html.classList.toggle("mcm-overlay", open);
  }
  if (global.MutationObserver) {
    [].forEach.call(doc.querySelectorAll(OVERLAYS), function (o) {
      new MutationObserver(syncOverlay).observe(o, { attributes: true, attributeFilter: ["aria-hidden", "class"] });
    });
  }
  syncOverlay();

  // ---------- Parcours : tous les clubs à l'écran, sur plusieurs rangées si besoin ----------
  // (ex. Anelka : 12 clubs → 4 colonnes × 3 rangées de petites cases). Purement visuel.
  var steps = $("#careerSteps");
  function layoutCareer() {
    if (!steps) return;
    var n = steps.children.length;
    var cols = n <= 4 ? Math.max(n, 1) : (n <= 8 ? 4 : (n <= 12 ? 4 : 5));
    steps.setAttribute("data-cols", String(cols));
    steps.style.setProperty("--mcm-cols", cols);
    html.classList.toggle("mcm-many", n > 8);
    html.classList.toggle("mcm-multirow", n > cols);
    setTimeout(function () { fitNames(); fitStage(); }, 0);
  }
  // Noms de clubs : on réduit la police juste assez pour que le mot le plus long tienne dans la case
  // (« KAISERSLAUTERN », « FENERBAHÇE »…) au lieu de le couper au milieu.
  var cvs = doc.createElement("canvas").getContext("2d");
  function fitNames() {
    if (!steps) return;
    [].forEach.call(steps.querySelectorAll(".club-name"), function (el) {
      el.style.fontSize = "";
      var card = el.closest(".career-card"); if (!card) return;
      var cs = global.getComputedStyle(el), size = parseFloat(cs.fontSize) || 8;
      var avail = card.clientWidth - 8; if (avail <= 0) return;
      var words = (el.textContent || "").toUpperCase().split(/\s+/), longest = 0;
      cvs.font = cs.fontWeight + " " + size + "px " + cs.fontFamily;
      words.forEach(function (w) { longest = Math.max(longest, cvs.measureText(w).width * (1 + (parseFloat(cs.letterSpacing) || 0) / size)); });
      if (longest > avail) el.style.fontSize = Math.max(5.6, size * avail / longest).toFixed(2) + "px";
    });
  }
  global.addEventListener("resize", function () { setTimeout(fitNames, 50); });
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { fitNames(); fitStage(); });
  if (global.ResizeObserver) { var roStage = new ResizeObserver(function () { if (!fitting) fitStage(); }); [].forEach.call(stage.children, function (c) { roStage.observe(c); }); }
  if (steps && global.MutationObserver) new MutationObserver(layoutCareer).observe(steps, { childList: true });
  layoutCareer();

  // Changement de niveau : on remonte en haut pour voir le nouveau parcours.
  var sel = $("#levelSelector");
  if (sel) sel.addEventListener("click", function (e) {
    if (e.target.closest(".level-button")) setTimeout(function () { global.scrollTo({ top: 0, behavior: "smooth" }); }, 30);
  });
})(window);
