/* Jogadle — nouvelle affiche (ORDINATEUR, ≥ 1100 px). Purement visuel.
   Place la phrase « Le Jogadle : retrouvez… » à droite de « Quel est le joueur mystère ? ».
   Sous 1100 px (ou sur la vue mobile), la phrase reste à sa place d'origine. */
(function (global) {
  "use strict";
  var doc = document;
  if (doc.documentElement.getAttribute("data-jg-view") === "mobile") return;
  var p = doc.querySelector(".td-hero > p"), label = doc.querySelector(".search-wrap > label");
  if (!p || !label) return;
  var home = p.nextSibling, row = doc.createElement("div");
  row.className = "jga-ask";
  var mq = global.matchMedia("(min-width: 1100px)");
  function apply() {
    if (mq.matches && !row.parentNode) {
      label.parentNode.insertBefore(row, label);
      row.appendChild(label); row.appendChild(p);
    } else if (!mq.matches && row.parentNode) {
      row.parentNode.insertBefore(label, row);
      home.parentNode.insertBefore(p, home);
      row.parentNode.removeChild(row);
    }
  }
  apply();
  if (mq.addEventListener) mq.addEventListener("change", apply); else if (mq.addListener) mq.addListener(apply);
})(window);
