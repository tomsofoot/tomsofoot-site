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

  // Compte à rebours vers minuit (heure de Paris) — affichage uniquement.
  var nextEl = document.querySelector("#td-next");
  if (nextEl) {
    var clock = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    function secs() { var p = clock.formatToParts(new Date()); var v = function (t) { return parseInt(p.find(function (x) { return x.type === t; }).value, 10); }; var h = v("hour"); if (h === 24) h = 0; return (86400 - (h * 3600 + v("minute") + 0 * 0 + v("second"))) % 86400; }
    function fmt(t) { var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60, p = function (n) { return String(n).padStart(2, "0"); }; return p(h) + " : " + p(m) + " : " + p(s); }
    var tick = function () { nextEl.textContent = fmt(secs()); }; tick(); setInterval(tick, 1000);
  }

  // Titre du headline sur une seule ligne (ajustement léger).
  var line = document.querySelector("[data-fitline]");
  if (line) { var fit = function () { line.style.removeProperty("font-size"); var w = Math.min((document.querySelector(".jogadle") || document.body).clientWidth - 32, 1510); var sz = parseFloat(getComputedStyle(line).fontSize); while (line.scrollWidth > w && sz > 18) { sz -= 1; line.style.fontSize = sz + "px"; } }; fit(); global.addEventListener("resize", fit, { passive: true }); }

  // Aide.
  var help = document.querySelector("[data-td-help]");
  if (help) help.addEventListener("click", function () { alert("Proposez des joueurs : après chaque proposition, les couleurs se révèlent. Vert = exact, Rouge = différent, flèche = plus grand/plus petit. Indice après 5 mauvaises réponses."); });
})(window);
