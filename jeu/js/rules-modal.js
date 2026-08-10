/* Jogadle — bouton « ⚠ RÈGLEMENT & POINTS » + fenêtre modale accessible.
   Les tableaux de points sont GÉNÉRÉS depuis window.JogadleRules (mêmes constantes que le serveur),
   pour qu'il n'y ait jamais d'écart entre le règlement affiché et le vrai calcul.
   Ouverture dans la même page (aucun rechargement, aucun changement d'URL). Accessible :
   fermeture par bouton / Échap / clic extérieur, focus renvoyé, attributs ARIA. */
(function (global) {
  "use strict";
  var R = global.JogadleRules;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function rowsTable(rows, h1, h2) {
    return '<table class="jg-rules-tbl"><thead><tr><th>' + esc(h1) + '</th><th>' + esc(h2) + '</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>'; }).join("") + '</tbody></table>';
  }
  function signed(n) { return (n > 0 ? "+" + n : "" + n); }

  function buildContent() {
    var rr = R || {};
    var bareme = (rr.attemptRows ? rr.attemptRows() : []).map(function (r) { return [r.attempt, r.points + " pts"]; });
    var mt = rr.MONEY_TIME || { penultimate: [], final: [] };
    var mtPen = mt.penultimate.map(function (v, i) { return [String(i + 1), signed(v)]; });
    var mtFin = mt.final.map(function (v, i) { return [String(i + 1), signed(v)]; });

    return '' +
    '<section class="jg-rules-sec jg-rules-summary"><h3>En bref</h3>' +
      '<ul><li>On gagne des points <b>une seule fois</b> : en trouvant le joueur.</li>' +
      '<li>Moins d\'essais = plus de points. Une mauvaise proposition ne retire <b>jamais</b> de points.</li>' +
      '<li>L\'indice révélé coûte <b>−5</b>. Révéler la réponse n\'est <b>pas</b> une victoire.</li>' +
      '<li>Total de saison jamais négatif. Invité = pas de points ni de classement.</li></ul></section>' +

    '<section class="jg-rules-sec"><h3>1. Gagner des points</h3><p>Les points tombent <b>une seule fois</b> : quand vous trouvez le joueur. Une journée non jouée = 0 point, sans pénalité.</p></section>' +

    '<section class="jg-rules-sec"><h3>2. Barème des tentatives</h3>' + rowsTable(bareme, "Tentative de victoire", "Points de base") + '</section>' +

    '<section class="jg-rules-sec"><h3>3. Indice</h3><p>Un seul indice (première lettre du nom), disponible <b>après 5 mauvaises réponses</b>. L\'ouvrir ne coûte rien ; le <b>révéler</b> retire <b>−5</b> sur la journée (minimum 0).</p>' +
      '<p class="jg-rules-ex">Ex. : victoire au 6ᵉ essai = 15 pts ; avec indice = 10 pts. Dès le 7ᵉ essai, l\'indice ramène le gain à 0.</p></section>' +

    '<section class="jg-rules-sec"><h3>4. Révéler la réponse</h3><p>Ce n\'est <b>jamais</b> une victoire. Pénalité : <b>−' + (rr.REVEAL_EARLY_PENALTY || 10) + '</b> avant le 7e essai, <b>−' + (rr.REVEAL_LATE_PENALTY || 5) + '</b> à partir du 7e.</p></section>' +

    '<section class="jg-rules-sec"><h3>5. Compte et pseudo</h3><p>Un compte (Google ou lien magique, sans mot de passe) est requis pour le classement. Le pseudo se change <b>une seule fois</b>, puis il est verrouillé.</p></section>' +

    '<section class="jg-rules-sec"><h3>6. Ligues</h3><p>Quatre ligues classées de 1 à 20 : <b>Ultime, Pro, Rookie, Noob</b>. Les joueurs Hors Ligue accumulent des points pour entrer en Noob.</p></section>' +

    '<section class="jg-rules-sec"><h3>7. Qualification</h3><p>Départ Hors Ligue pendant <b>' + (rr.QUALIFICATION_DAYS || 14) + ' jours</b>. À la clôture : 1–20 → Ultime, 21–40 → Pro, 41–60 → Rookie, 61–80 → Noob, 81+ → Hors Ligue.</p></section>' +

    '<section class="jg-rules-sec"><h3>8. Montées et descentes</h3><p>Chaque fin de saison (minuit, Paris) : places <b>1–5</b> montent, <b>16–20</b> descendent, 6–15 restent. Les points repartent à 0 ; titres conservés.</p></section>' +

    '<section class="jg-rules-sec"><h3>9. Money Time (48 h)</h3><p>À H‑48 : groupe haut (1–8) et groupe bas (13–20) ; 9–12 jouent normalement. Le résultat <b>remplace</b> le gain du jour.</p>' +
      '<div class="jg-rules-two">' + rowsTable(mtPen, "Rang — avant‑dernier jour", "Variation") + rowsTable(mtFin, "Rang — dernier jour", "Variation") + '</div>' +
      '<p class="jg-rules-ex">Absence : −' + Math.abs(mt.absencePenultimate || 50) + ' (avant‑dernier), −' + Math.abs(mt.absenceFinal || 100) + ' (dernier).</p></section>' +

    '<section class="jg-rules-sec"><h3>10. Départages</h3><p>À points égaux : plus de journées jouées, plus de victoires, meilleure moyenne d\'essais, classement précédent. L\'heure de jeu ne compte <b>jamais</b>.</p></section>' +

    '<section class="jg-rules-sec"><h3>11. Saisons et palmarès</h3><p>Une saison = un mois. Les points repartent à 0 ; l\'historique et les titres restent. Champions : Noob (cookie), Rookie (bronze), Pro (argent), Ultime (or).</p></section>' +
    '<p class="jg-rules-foot">Tous les points sont calculés côté serveur.</p>';
  }

  var overlay, lastFocus;
  function open() {
    if (overlay) return;
    lastFocus = document.activeElement;
    overlay = document.createElement("div");
    overlay.className = "jg-rules-overlay";
    overlay.innerHTML =
      '<div class="jg-rules-modal" role="dialog" aria-modal="true" aria-labelledby="jg-rules-title">' +
      '<header class="jg-rules-head"><h2 id="jg-rules-title"><span class="jg-rules-warn" aria-hidden="true">⚠</span> Règlement &amp; points</h2>' +
      '<button type="button" class="jg-rules-close" aria-label="Fermer le règlement">×</button></header>' +
      '<div class="jg-rules-body">' + buildContent() + '</div></div>';
    document.body.appendChild(overlay);
    document.body.classList.add("jg-rules-lock");
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    overlay.querySelector(".jg-rules-close").addEventListener("click", close);
    document.addEventListener("keydown", onKey, true);
    var c = overlay.querySelector(".jg-rules-close"); if (c) c.focus();
  }
  function close() {
    if (!overlay) return;
    document.removeEventListener("keydown", onKey, true);
    overlay.remove(); overlay = null;
    document.body.classList.remove("jg-rules-lock");
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "Tab" && overlay) {
      var f = overlay.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function mountButton() {
    if (document.querySelector(".jg-rules-btn")) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "jg-rules-btn";
    btn.innerHTML = '<span class="jg-rules-btn__warn" aria-hidden="true">⚠</span> Règlement &amp; points';
    btn.addEventListener("click", open);
    var host = document.querySelector(".td-hero") || document.querySelector(".game-shell") || document.body;
    host.appendChild(btn);
  }
  if (document.readyState !== "loading") mountButton(); else document.addEventListener("DOMContentLoaded", mountButton);

  global.JogadleRulesUI = { open: open, close: close };
})(window);
