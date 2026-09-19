/* Jogadle — nouvelle affiche (ORDINATEUR, ≥ 1100 px). Purement visuel : on ne fait que
   déplacer des éléments existants, et tout est remis en place sous 1100 px.
   - « Le Jogadle : retrouvez… » à droite de « Quel est le joueur mystère ? »
   - le minuteur « Prochain joueur dans » dans la rangée Propositions (à gauche du compteur)
   - « Règlement & points » + « ? » / son en haut à droite, au-dessus du classement */
(function (global) {
  "use strict";
  var doc = document;
  if (doc.documentElement.getAttribute("data-jg-view") === "mobile") return;
  var mq = global.matchMedia("(min-width: 1100px)");
  var moves = [];   // { el, mark (commentaire laissé à la place d'origine) }

  function moveTo(el, parent, before) {
    if (!el || !parent) return;
    var mark = doc.createComment("affiche");
    el.parentNode.insertBefore(mark, el);
    moves.push({ el: el, mark: mark });
    parent.insertBefore(el, before || null);
  }
  function restore() {
    while (moves.length) { var m = moves.pop(); m.mark.parentNode.insertBefore(m.el, m.mark); m.mark.parentNode.removeChild(m.mark); }
    Array.prototype.forEach.call(doc.querySelectorAll(".jga-ask, .jga-tools"), function (n) { n.parentNode.removeChild(n); });
  }
  function apply() {
    if (!mq.matches) { restore(); return; }
    if (moves.length) return;
    var label = doc.querySelector(".search-wrap > label"), p = doc.querySelector(".td-hero > p");
    if (label && p) {
      var ask = doc.createElement("div"); ask.className = "jga-ask";
      label.parentNode.insertBefore(ask, label);
      moveTo(label, ask); moveTo(p, ask);
    }
    var row = doc.querySelector(".progress-row"), cd = doc.querySelector(".td-hero .td-countdown");
    if (row && cd) moveTo(cd, row, row.querySelector(".attempt-count"));
    var rules = doc.querySelector(".td-hero > .jg-rules-btn"), actions = doc.querySelector(".td-hero > .top-actions");
    if (rules || actions) {
      var tools = doc.createElement("div"); tools.className = "jga-tools";
      doc.body.appendChild(tools);
      moveTo(rules, tools); moveTo(actions, tools);
    }
  }
  function start() {
    apply();
    if (mq.addEventListener) mq.addEventListener("change", apply); else if (mq.addListener) mq.addListener(apply);
  }
  // Après rules-modal.js et sound.js, qui créent leurs boutons au DOMContentLoaded.
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start); else start();
})(window);
