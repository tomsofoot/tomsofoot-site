/* Jogadle — habillage MOBILE (vue 9:16, pensée pour le pouce).
   Actif UNIQUEMENT si <html data-jg-view="mobile"> (posé dans le <head> de jeu/index.html).
   Sur ordinateur, ce script s'arrête immédiatement : la version PC reste strictement identique.

   Aucune logique de jeu ici : le moteur reste game.js + api.js (serveur, anti-triche, points).
   Ce fichier se contente de DÉPLACER des éléments existants dans deux barres fixes (haut / bas).
   game.js garde ses références aux nœuds, qui continuent donc de fonctionner normalement. */
(function (global) {
  "use strict";
  var doc = document, html = doc.documentElement;
  if (html.getAttribute("data-jg-view") !== "mobile") return;

  var root = doc.querySelector(".jogadle");
  if (!root) return;
  var $ = function (s, ctx) { return (ctx || doc).querySelector(s); };
  function el(tag, cls, inner) { var n = doc.createElement(tag); if (cls) n.className = cls; if (inner) n.innerHTML = inner; return n; }
  function move(node, host) { if (node && host && node.parentNode !== host) host.appendChild(node); }

  // ---------- Barre du HAUT : marque + édition + outils, puis 3 compteurs ----------
  var top = el("header", "jgm-top");
  var row = el("div", "jgm-top__row");
  var brand = el("div", "jgm-brand", '<b>JOGA<i>DLE</i></b>');
  var tools = el("div", "jgm-tools");
  var stats = el("div", "jgm-stats");
  var sEssais = el("div", "jgm-stat jgm-stat--count", "<span>Essais</span>");
  var sPoints = el("div", "jgm-stat jgm-stat--points");
  var sClock = el("div", "jgm-stat jgm-stat--clock", "<span>Prochain joueur</span>");
  row.appendChild(brand); row.appendChild(tools);
  stats.appendChild(sEssais); stats.appendChild(sPoints); stats.appendChild(sClock);
  top.appendChild(row); top.appendChild(stats);

  move($(".dm-edition", root), brand);           // « Édition #100 » (#td-puzzle rempli par game.js)
  move($(".top-actions", root), tools);          // « ? » + son (sound.js s'y ajoute)
  move($("#td-count", root), sEssais);           // compteur de propositions (game.js)
  move($("#jg-points-live", root), sPoints);     // points en jeu (game.js)
  move($(".td-countdown__tiles", root), sClock); // HH:MM:SS (main.js)

  // ---------- Barre du BAS (zone du pouce) : joueurs utilisés, actions, recherche ----------
  var dock = el("div", "jgm-dock");
  var dockIn = el("div", "jgm-dock__in");
  var actions = el("div", "jgm-actions");
  dock.appendChild(dockIn);
  move($("#td-used", root), dockIn);             // chips « déjà testés » (game.js)
  dockIn.appendChild(actions);
  move($(".jg-open-btn"), actions);              // Classement (leaderboard.js)
  move($("#td-hint", root), actions);            // Indice (game.js)
  move($("#td-search", root), dockIn);           // recherche + suggestions (game.js)

  doc.body.appendChild(top);
  doc.body.appendChild(dock);

  // Bouton « Règlement & points » : injecté par rules-modal.js au DOMContentLoaded → rangé dans les outils.
  function adoptRules() {
    var b = $(".jg-rules-btn");
    if (b && b.parentNode !== tools) { tools.insertBefore(b, tools.firstChild); b.setAttribute("aria-label", "Règlement et points"); }
    return !!b;
  }
  if (!adoptRules()) {
    var mo = new MutationObserver(function () { if (adoptRules()) mo.disconnect(); });
    mo.observe(doc.body, { childList: true, subtree: true });
    setTimeout(function () { mo.disconnect(); }, 10000);
  }

  // ---------- Hauteurs réelles des barres → marges du contenu ----------
  function syncHeights() {
    html.style.setProperty("--jgm-top", top.offsetHeight + "px");
    html.style.setProperty("--jgm-dock", dock.offsetHeight + "px");
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
    html.style.setProperty("--jgm-vvh", Math.round(vv.height) + "px");
  }
  if (vv) { vv.addEventListener("resize", followKeyboard); vv.addEventListener("scroll", followKeyboard); followKeyboard(); }

  var input = $("#td-input");
  if (input) {
    input.addEventListener("focus", function () { html.classList.add("jgm-typing"); setTimeout(followKeyboard, 60); });
    input.addEventListener("blur", function () { html.classList.remove("jgm-typing"); setTimeout(followKeyboard, 60); });
    input.setAttribute("enterkeyhint", "search");
    input.setAttribute("autocapitalize", "words");
  }

  // ---------- Défilement automatique ----------
  // Nouvelle proposition (ligne en attente puis révélation) : on ramène le haut du plateau à l'écran.
  var board = $("#td-board-area", root), end = $("#td-end", root);
  function scrollToNode(node) {
    if (!node) return;
    var y = node.getBoundingClientRect().top + global.pageYOffset - (top.offsetHeight + 10);
    try { global.scrollTo({ top: Math.max(0, y), behavior: "smooth" }); } catch (e) { global.scrollTo(0, Math.max(0, y)); }
  }
  if (board && global.MutationObserver) {
    new MutationObserver(function () {
      var fresh = board.querySelector(".guess-row.is-pending, .guess-row.revealing");
      if (!fresh) return;
      var r = fresh.getBoundingClientRect();
      if (r.top < top.offsetHeight || r.top > global.innerHeight * 0.45) scrollToNode(board);
    }).observe(board, { childList: true });
  }
  // Fin de partie (victoire / réponse révélée) : la carte de résultat passe en tête.
  if (end && global.MutationObserver) {
    new MutationObserver(function () {
      var done = !!end.querySelector(".end-card");
      html.classList.toggle("jgm-ended", done);
      if (done) setTimeout(function () { scrollToNode(end); }, 120);
      syncHeights();
    }).observe(end, { childList: true });
  }
  // La recherche est masquée par game.js après la victoire : on recalcule la hauteur du bas.
  var search = $("#td-search");
  if (search && global.MutationObserver) new MutationObserver(syncHeights).observe(search, { attributes: true, attributeFilter: ["style"] });
  var used = $("#td-used");
  if (used && global.MutationObserver) new MutationObserver(function () { syncHeights(); used.scrollLeft = 0; }).observe(used, { attributes: true, childList: true });

  html.classList.add("jgm-ready");
})(window);
