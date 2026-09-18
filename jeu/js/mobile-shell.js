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

  // ---------- Une seule proposition à l'écran ----------
  // game.js reconstruit le plateau à chaque proposition (la plus récente en premier).
  // Sur mobile on n'affiche que la dernière : la précédente s'efface, la nouvelle apparaît.
  // Les essais précédents restent consultables via un bouton (fermé par défaut). Purement visuel.
  var boardArea = $("#td-board-area", root);
  var historyOpen = false;
  function label(open, k) { return k > 1 ? (open ? "Masquer les " : "Voir les ") + k + " essais précédents" : (open ? "Masquer" : "Voir") + " l'essai précédent"; }
  function decorate() {
    if (!boardArea) return;
    var rows = boardArea.querySelectorAll(".guess-row:not(.jgm-ghost)");
    var n = rows.length;
    if (!n) historyOpen = false;
    for (var i = 0; i < n; i++) {
      var first = rows[i].querySelector(".flip-cell");
      if (first) first.setAttribute("data-n", String(n - i));
      rows[i].classList.toggle("jgm-old", i > 0);
    }
    html.classList.toggle("jgm-history-open", historyOpen);
    var btn = boardArea.querySelector(".jgm-history");
    var older = n - 1;
    if (older < 1 || rows[0].classList.contains("is-pending") && rows[1] && rows[1].classList.contains("is-pending")) { if (btn) btn.remove(); return; }
    if (!btn) {
      btn = el("button", "jgm-history");
      btn.type = "button";
      btn.addEventListener("click", function () { historyOpen = !historyOpen; decorate(); });
    }
    btn.setAttribute("aria-expanded", String(historyOpen));
    btn.innerHTML = label(historyOpen, older) + ' <i aria-hidden="true">' + (historyOpen ? "▴" : "▾") + "</i>";
    if (btn.previousSibling !== rows[0]) rows[0].parentNode.insertBefore(btn, rows[0].nextSibling);
  }
  // Transition « réponse → réponse suivante » : la nouvelle tentative monte depuis la barre de
  // recherche (bas → haut) avec une traînée lumineuse et se pose avec un halo ; l'ancienne s'efface vers le haut.
  var REDUCE = !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var lastTop = null, sawReveal = false, enterAt = 0, rise = 0, ENTER_MS = 1370;
  function crossfade() {
    if (!boardArea) return;
    var rows = boardArea.querySelectorAll(".guess-row");
    var fresh = rows[0];
    if (fresh && fresh.classList.contains("revealing") && !fresh.__jgmSeen) {
      fresh.__jgmSeen = true; sawReveal = true;
      // Victoire : toutes les cases vertes → la fête part quand la dernière case se retourne.
      var res = fresh.querySelectorAll(".flip-back.result");
      var allOk = res.length && Array.prototype.every.call(res, function (c) { return c.classList.contains("correct"); });
      if (allOk && !REDUCE) setTimeout(function () { celebrate(fresh); }, 7 * 350 + 380);
    }
    if (fresh && fresh.classList.contains("is-pending") && !REDUCE && (lastTop || boardArea.querySelectorAll(".guess-row").length === 1)) {
      var boardEl = fresh.parentNode, topPx = fresh.offsetTop + "px";
      // Distance entre la carte et la barre de recherche : la nouvelle tentative « sort » de la barre.
      var r = fresh.getBoundingClientRect();
      rise = Math.max(160, Math.round((global.innerHeight - dock.offsetHeight + 24) - r.top));
      fresh.style.setProperty("--jgm-rise", rise + "px");
      fresh.classList.add("jgm-enter"); enterAt = Date.now();
      var beam = el("div", "jgm-beam");
      beam.style.top = topPx; beam.style.height = (rise + r.height) + "px";
      boardEl.appendChild(beam);
      var junk = [beam];
      if (lastTop) {
        var ghost = lastTop.cloneNode(true);
        ghost.classList.remove("jgm-old", "revealing", "jgm-enter");
        ghost.classList.add("jgm-ghost", "revealed");
        ghost.style.top = topPx; ghost.style.animationDelay = "";
        boardEl.appendChild(ghost); junk.push(ghost);
      }
      setTimeout(function () { junk.forEach(function (x) { if (x.parentNode) x.parentNode.removeChild(x); }); }, 1850);
    } else if (fresh && fresh.classList.contains("revealing") && enterAt && Date.now() - enterAt < ENTER_MS) {
      // La réponse du serveur arrive pendant la montée : on poursuit la même animation sans à-coup.
      fresh.style.setProperty("--jgm-rise", rise + "px");
      fresh.classList.add("jgm-enter"); fresh.style.animationDelay = (-(Date.now() - enterAt)) + "ms";
    }
    if (fresh && !fresh.classList.contains("is-pending")) { lastTop = fresh; }
    if (!fresh) { lastTop = null; sawReveal = false; }
  }

  // ---------- Victoire : flash + carte gagnante illuminée + confettis TomsoFoot ----------
  function celebrate(win) {
    if (REDUCE) return;
    if (win) { win.classList.add("jgm-win"); setTimeout(function () { win.classList.remove("jgm-win"); }, 2600); }
    var flash = el("div", "jgm-flash"); doc.body.appendChild(flash);
    setTimeout(function () { flash.remove(); }, 900);
    confetti();
  }
  function confetti() {
    var cv = el("canvas", "jgm-confetti"); doc.body.appendChild(cv);
    var dpr = Math.min(global.devicePixelRatio || 1, 2), W = global.innerWidth, H = global.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    var ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
    var COLORS = ["#6f55ff", "#335bff", "#f02f45", "#22ca72", "#ffffff", "#ffd76a", "#8fd0ff"];
    var P = [];
    function burst(x, y, angle, spread, n, speed) {
      for (var i = 0; i < n; i++) {
        var a = angle + (Math.random() - .5) * spread, v = speed * (.55 + Math.random() * .6);
        P.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: 6 + Math.random() * 6, h: 9 + Math.random() * 8,
          r: Math.random() * 6.28, vr: (Math.random() - .5) * .35, c: COLORS[(Math.random() * COLORS.length) | 0],
          shape: Math.random() < .25 ? 1 : 0, life: 0, max: 150 + Math.random() * 70, wob: Math.random() * 6.28 });
      }
    }
    burst(0, H * .92, -Math.PI / 3, .9, 90, 17);          // canon bas gauche
    burst(W, H * .92, -Math.PI * 2 / 3, .9, 90, 17);      // canon bas droit
    setTimeout(function () { burst(W / 2, H * .32, -Math.PI / 2, 6.28, 70, 9); }, 260);   // gerbe centrale
    var t0 = null;
    function step(ts) {
      if (!t0) t0 = ts;
      ctx.clearRect(0, 0, W, H);
      var alive = 0;
      for (var i = 0; i < P.length; i++) {
        var p = P[i]; if (p.life > p.max) continue; alive++;
        p.life++; p.vx *= .985; p.vy = p.vy * .985 + .32; p.wob += .12;
        p.x += p.vx + Math.sin(p.wob) * .6; p.y += p.vy; p.r += p.vr;
        var fade = p.life > p.max - 40 ? (p.max - p.life) / 40 : 1;
        ctx.save(); ctx.globalAlpha = Math.max(0, fade); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
        if (p.shape) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2.4, 0, 6.28); ctx.fill(); }
        else { ctx.scale(1, Math.cos(p.wob)); ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); }
        ctx.restore();
      }
      if (alive && ts - t0 < 5000) requestAnimationFrame(step); else cv.remove();
    }
    requestAnimationFrame(step);
  }

  if (boardArea) {
    if (global.MutationObserver) new MutationObserver(function () { crossfade(); decorate(); }).observe(boardArea, { childList: true });
    decorate();
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
