/* Jogadle — bootstrap du client officiel (page dédiée). Relie identité, jeu et classement. */
(function (global) {
  "use strict";
  // Identité : rend le bloc « Rejoindre le championnat » et réagit aux changements (connexion/déconnexion).
  if (global.JogadleIdentity) {
    global.JogadleIdentity.init(function () {
      if (global.JogadleLeagueUI && global.JogadleLeagueUI.refresh) global.JogadleLeagueUI.refresh();
    });
  }
  // Boutons mobile ouvrir/fermer classement gérés par JogadleLeagueUI (leaderboard.js).

  // Compte à rebours vers minuit (heure de Paris) — tuiles Heures / Min / Sec (affichage uniquement).
  var hEl = document.querySelector("#td-h"), mEl = document.querySelector("#td-m"), sEl = document.querySelector("#td-s");
  if (hEl && mEl && sEl) {
    var clock = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    var pad2 = function (n) { return String(n).padStart(2, "0"); };
    function secs() { var p = clock.formatToParts(new Date()); var v = function (t) { return parseInt(p.find(function (x) { return x.type === t; }).value, 10); }; var h = v("hour"); if (h === 24) h = 0; return (86400 - (h * 3600 + v("minute") + v("second"))) % 86400; }
    var tick = function () { var t = secs(), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; hEl.textContent = pad2(h); mEl.textContent = pad2(m); sEl.textContent = pad2(s); };
    tick(); setInterval(tick, 1000);
  }

  // « Effectifs à jour le … » — date renvoyée par la fonction serveur same-origin (lecture seule).
  // Si indisponible (aucune donnée / hors production), la ligne reste masquée : aucun état vide affiché.
  var majBox = document.querySelector("#td-maj"), majOut = document.querySelector("#td-maj-date");
  if (majBox && majOut) {
    fetch("/.netlify/functions/jog-effectifs-maj", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.updated_at) return;
        var dt = new Date(d.updated_at); if (isNaN(dt.getTime())) return;
        majOut.textContent = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" }).format(dt);
        majBox.hidden = false;
      })
      .catch(function () {});
  }

  // Titre du headline sur une seule ligne (ajustement léger).
  var line = document.querySelector("[data-fitline]");
  if (line) { var fit = function () { line.style.removeProperty("font-size"); var w = Math.min((document.querySelector(".jogadle") || document.body).clientWidth - 32, 1510); var sz = parseFloat(getComputedStyle(line).fontSize); while (line.scrollWidth > w && sz > 18) { sz -= 1; line.style.fontSize = sz + "px"; } }; fit(); global.addEventListener("resize", fit, { passive: true }); }

  // Aide.
  var help = document.querySelector("[data-td-help]");
  if (help) help.addEventListener("click", function () { alert("Proposez des joueurs : après chaque proposition, les couleurs se révèlent. Vert = exact, Rouge = différent, flèche = plus grand/plus petit. Indice après 5 mauvaises réponses."); });
})(window);
