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
  var brand = el("div", "mcm-brand", '<b>JOGADLE <i>2</i></b><span>Mode Carrière</span>');
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
  move($("#levelSelector", app), top);           // Amateur / Pro / Expert (même logique, mêmes verrous)

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

  doc.body.appendChild(top);
  doc.body.appendChild(dock);
  doc.body.appendChild(sheet);

  // ---------- Hauteurs réelles des barres → marges du contenu ----------
  function syncHeights() {
    html.style.setProperty("--mcm-top", top.offsetHeight + "px");
    html.style.setProperty("--mcm-dock", dock.offsetHeight + "px");
  }
  syncHeights();
  if (global.ResizeObserver) { var ro = new ResizeObserver(syncHeights); ro.observe(top); ro.observe(dock); }
  global.addEventListener("resize", syncHeights);

  // ---------- Clavier virtuel : la barre du bas reste collée au-dessus du clavier ----------
  var vv = global.visualViewport;
  function followKeyboard() {
    if (!vv) return;
    var hidden = Math.max(0, global.innerHeight - vv.height - vv.offsetTop);
    dock.style.transform = hidden > 1 ? "translateY(" + (-hidden) + "px)" : "";
    top.style.transform = vv.offsetTop > 1 ? "translateY(" + vv.offsetTop + "px)" : "";
    html.style.setProperty("--mcm-vvh", Math.round(vv.height) + "px");
  }
  if (vv) { vv.addEventListener("resize", followKeyboard); vv.addEventListener("scroll", followKeyboard); followKeyboard(); }

  var input = $("#guessInput");
  if (input) {
    // Le jeu place le curseur dans la recherche au chargement : on n'entre en « mode saisie » (barre
    // compacte, suggestions visibles) que lorsque le joueur touche vraiment la recherche ou tape.
    var typing = function () { html.classList.add("mcm-typing"); setTimeout(followKeyboard, 60); };
    input.addEventListener("pointerdown", typing);
    input.addEventListener("input", typing);
    input.addEventListener("focus", function () { if (vv && global.innerHeight - vv.height > 120) typing(); });
    input.addEventListener("blur", function () { setTimeout(function () { html.classList.remove("mcm-typing"); followKeyboard(); }, 120); });
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

  // Changement de niveau : on remonte en haut pour voir le nouveau parcours.
  var sel = $("#levelSelector");
  if (sel) sel.addEventListener("click", function (e) {
    if (e.target.closest(".level-button")) setTimeout(function () { global.scrollTo({ top: 0, behavior: "smooth" }); }, 30);
  });
})(window);
