/* Jogadle — classement « Duel + zones » (ORDINATEUR uniquement).
   Une carte compacte à droite : zone montée (1–5), « ta course » (tes voisins directs + l'écart
   à combler), zone descente (16–20). Le classement complet reste accessible en tiroir.

   PUREMENT VISUEL : ne calcule aucun point officiel, ne change aucune règle ni aucune donnée.
   Il lit le classement déjà rendu par leaderboard.js (#jg-ranking) et s'y resynchronise en direct.
   Inactif sur la vue mobile (html[data-jg-view="mobile"]) et si le championnat est masqué. */
(function (global) {
  "use strict";
  var doc = document, html = doc.documentElement;
  if (html.getAttribute("data-jg-view") === "mobile") return;
  if (!(global.JOGADLE_FLAGS && global.JOGADLE_FLAGS.CHAMPIONSHIP_VISIBLE)) return;
  var league = doc.getElementById("jg-league"), ranking = doc.getElementById("jg-ranking");
  if (!league || !ranking) return;

  html.classList.add("jgd-on");
  var LEAGUES = [["ultimate", "Ultime"], ["pro", "Pro"], ["rookie", "Rookie"], ["noob", "Noob"]];
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmt(n) { return Number(n || 0).toLocaleString("fr-FR"); }
  function txt(sel, root) { var n = (root || doc).querySelector(sel); return n ? String(n.textContent || "").trim() : ""; }

  // ---------- Lecture du classement affiché (source unique : leaderboard.js) ----------
  function rows() {
    var out = [];
    Array.prototype.forEach.call(ranking.children, function (li) {
      if (!li.getAttribute("data-user-id")) return;               // emplacements vides « — »
      var nameEl = li.querySelector(".name"), first = nameEl && nameEl.firstChild;
      var name = first && first.nodeType === 3 ? first.textContent.trim() : txt(".name", li);
      var pts = parseInt(txt(".pts", li).replace(/\D/g, ""), 10) || 0;
      out.push({ id: li.getAttribute("data-user-id"), name: name, pts: pts, me: li.classList.contains("is-me") });
    });
    // L'ordre du DOM peut être en pleine animation (FLIP) : on trie sur les points.
    out.sort(function (a, b) { return b.pts - a.pts; });
    out.forEach(function (r, i) { r.pos = i + 1; });
    return out;
  }
  function potential() {
    var live = doc.getElementById("jg-points-live");
    if (!live || live.style.display === "none") return null;
    var v = parseInt(txt("strong", live), 10);
    return isNaN(v) ? null : v;
  }
  function currentLeague() { var b = league.querySelector(".jg-league-tabs button.is-active"); return b ? b.getAttribute("data-league") : "pro"; }

  // ---------- Carte ----------
  var card = doc.createElement("aside");
  card.className = "jgd-card";
  card.setAttribute("aria-label", "Championnat Jogadle — résumé du classement");
  doc.body.appendChild(card);
  var backdrop = doc.createElement("div");
  backdrop.className = "jgd-backdrop";
  doc.body.appendChild(backdrop);

  var prevPos = {};
  function row(r, extra) {
    var medal = r.pos <= 3 ? " jgd-medal jgd-m" + r.pos : "";
    var moved = prevPos[r.id] && prevPos[r.id] !== r.pos ? " jgd-hot" : "";
    return '<div class="jgd-row' + (r.me ? " is-me" : "") + moved + '"><span class="jgd-pos' + medal + '">' + r.pos + '</span>' +
      '<span class="jgd-name">' + (r.me ? "Vous" : esc(r.name)) + '</span><span class="jgd-pts">' + fmt(r.pts) + (extra || "") + "</span></div>";
  }

  function render() {
    var R = rows(), lg = currentLeague();
    var title = txt("#jg-league-title") || "Ligue Pro";
    var tabs = '<div class="jgd-tabs" role="tablist">' + LEAGUES.map(function (l) {
      return '<button type="button" role="tab" data-jgd-league="' + l[0] + '" aria-selected="' + (l[0] === lg) + '"' + (l[0] === lg ? ' class="is-active"' : "") + ">" + l[1] + "</button>";
    }).join("") + "</div>";
    var h = '<div class="jgd-head"><div><div class="jgd-eyebrow">Championnat Jogadle</div><div class="jgd-title">' + esc(title) + '</div></div>' +
      '<span class="jgd-live"><i></i>En direct</span></div>' + tabs;

    if (!R.length) {
      card.innerHTML = h + '<div class="jgd-empty">Classement en cours de chargement…</div>' + footer();
      return;
    }
    var me = null; R.forEach(function (r) { if (r.me) me = r; });
    var top = R.slice(0, 5), bottom = R.length >= 20 ? R.slice(15, 20) : [];
    var shown = {}; top.concat(bottom).forEach(function (r) { shown[r.pos] = 1; });
    var upLabel = lg === "ultimate" ? "▲ Le haut du tableau" : "▲ Zone montée";
    var downLabel = lg === "noob" ? "▼ Bas de tableau" : "▼ Zone descente";

    h += '<section class="jgd-sec jgd-up"><div class="jgd-lab"><span>' + upLabel + '</span><small>1 – 5</small></div>' + top.map(function (r) { return row(r); }).join("") + "</section>";

    var g = potential();
    if (me) {
      var a = R[me.pos - 2] || null, b = R[me.pos] || null;
      var gapA = a ? a.pts - me.pts : 0, gapB = b ? me.pts - b.pts : 0;
      var mid = [a, me, b].filter(function (r) { return r && !shown[r.pos]; });
      var inner = mid.map(function (r) {
        return row(r, r === a ? '<em class="jgd-gap up">↑' + gapA + "</em>" : r === b ? '<em class="jgd-gap down">↓' + gapB + "</em>" : "");
      }).join("");
      var chase = "";
      if (a) {
        var fill = Math.max(4, Math.min(100, 100 - (gapA / Math.max(gapA + gapB, 1)) * 100));
        var note = g == null ? "" : g >= gapA && gapA > 0
          ? "✓ Si tu trouves maintenant (+" + g + " pts), tu le doubles !"
          : "Si tu trouves maintenant : +" + g + " pts" + (gapA > g ? " — il en manque " + (gapA - g) + "." : ".");
        chase = '<div class="jgd-chase"><p><b>' + gapA + " pts</b> pour doubler " + esc(a.name) + '</p>' +
          '<div class="jgd-track"><i style="width:' + fill + '%"></i><em style="left:' + fill + '%"></em></div>' + (note ? "<small>" + note + "</small>" : "") + "</div>";
      } else {
        chase = '<div class="jgd-chase"><p><b>Tu es en tête</b> de la ' + esc(title) + " 🏆</p>" + (b ? "<small>" + gapB + " pts d'avance sur " + esc(b.name) + ".</small>" : "") + "</div>";
      }
      h += '<div class="jgd-dots">• • •</div><section class="jgd-sec jgd-mid"><div class="jgd-lab"><span>Ta course</span><small>' + me.pos + "e · " + fmt(me.pts) + " pts</small></div>" + inner + chase + '</section><div class="jgd-dots">• • •</div>';
    } else {
      // Pas classé dans la ligue affichée : on reprend le bloc « Hors ligue » existant.
      var rank = txt("#jg-unranked-rank"), pts = txt("#jg-unranked-points");
      var join = doc.querySelector("#jg-identity .jg-id-join");
      h += '<div class="jgd-dots">• • •</div><section class="jgd-sec jgd-mid"><div class="jgd-lab"><span>Ta course</span><small>' + (rank && rank !== "—" ? "Hors ligue" : "") + "</small></div>" +
        (rank && rank !== "—" ? '<div class="jgd-row is-me"><span class="jgd-pos">' + esc(rank) + '</span><span class="jgd-name">Vous</span><span class="jgd-pts">' + esc(pts) + "</span></div>" : "") +
        '<div class="jgd-chase"><p>' + (join ? "Rejoins le championnat pour entrer dans la course." : "Continue à jouer pour entrer dans le top 20.") + "</p>" +
        (join ? '<button type="button" class="jgd-join" data-jgd-join>Rejoindre le championnat</button>' : "") + '</div></section><div class="jgd-dots">• • •</div>';
    }

    if (bottom.length) h += '<section class="jgd-sec jgd-down"><div class="jgd-lab"><span>' + downLabel + '</span><small>16 – 20</small></div>' + bottom.map(function (r) { return row(r); }).join("") + "</section>";
    card.innerHTML = h + footer();
    R.forEach(function (r) { prevPos[r.id] = r.pos; });
  }
  function footer() { return '<button type="button" class="jgd-all" data-jgd-all>Voir tout le classement <span aria-hidden="true">→</span></button>'; }

  // ---------- Interactions ----------
  function openFull() { if (global.JogadleLeagueUI) global.JogadleLeagueUI.open(); else league.classList.add("is-open"); }
  function closeFull() { if (global.JogadleLeagueUI) global.JogadleLeagueUI.close(); else league.classList.remove("is-open"); }
  card.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target : null; if (!t) return;
    var tab = t.closest("[data-jgd-league]");
    if (tab) { var real = league.querySelector('.jg-league-tabs [data-league="' + tab.getAttribute("data-jgd-league") + '"]'); if (real) real.click(); return; }
    if (t.closest("[data-jgd-all]")) { openFull(); return; }
    if (t.closest("[data-jgd-join]")) { var j = doc.querySelector("#jg-identity .jg-id-join"); if (j) j.click(); }
  });
  backdrop.addEventListener("click", closeFull);
  doc.addEventListener("keydown", function (e) { if (e.key === "Escape" && league.classList.contains("is-open")) closeFull(); });
  new MutationObserver(function () { html.classList.toggle("jgd-full", league.classList.contains("is-open")); })
    .observe(league, { attributes: true, attributeFilter: ["class"] });

  // ---------- Mise à jour en direct ----------
  var pending = false;
  function schedule() { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; render(); }); }
  new MutationObserver(schedule).observe(ranking, { childList: true, subtree: true, characterData: true });
  var live = doc.getElementById("jg-points-live");
  if (live) new MutationObserver(schedule).observe(live, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["style"] });
  var ident = doc.getElementById("jg-identity");
  if (ident) new MutationObserver(schedule).observe(ident, { childList: true, subtree: true });
  var ttl = doc.getElementById("jg-league-title");
  if (ttl) new MutationObserver(schedule).observe(ttl, { childList: true, characterData: true, subtree: true });
  var unr = doc.getElementById("jg-unranked");
  if (unr) new MutationObserver(schedule).observe(unr, { childList: true, characterData: true, subtree: true });
  render();
})(window);
