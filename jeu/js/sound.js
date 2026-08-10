/* Jogadle — bruitages bonne/mauvaise réponse + bouton haut-parleur (mode nuit).
   - Son « mauvaise réponse » à chaque proposition fausse.
   - Son « bonne réponse » quand la dernière case verte se retourne (victoire).
   - Volume modéré. Bouton haut-parleur (dans les actions du haut) pour couper/rétablir le son.
   - État coupé mémorisé (localStorage). Les sons ne démarrent qu'après une action du joueur
     (clic sur une proposition), ce qui respecte les règles d'autoplay des navigateurs. */
(function (global) {
  "use strict";
  var VOL = 0.35;                    // volume modéré
  var KEY = "jogadle.muted.v1";
  var muted = false;
  try { muted = global.localStorage.getItem(KEY) === "1"; } catch (e) {}

  function mk(src) { try { var a = new Audio(src); a.preload = "auto"; a.volume = VOL; return a; } catch (e) { return null; } }
  var A = { wrong: mk("assets/sfx-mauvaise-reponse.wav"), correct: mk("assets/sfx-bonne-reponse.wav") };

  function play(name) {
    if (muted) return;
    var a = A[name]; if (!a) return;
    try { a.currentTime = 0; var p = a.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  }

  // ---- Bouton haut-parleur (réutilise le style .icon-button existant) ----
  var ICON_ON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a9 9 0 0 1 0 12"/></svg>';
  var ICON_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none"/><path d="M16 9l5 6M21 9l-5 6"/></svg>';
  var btn;
  function render() {
    if (!btn) return;
    btn.innerHTML = muted ? ICON_OFF : ICON_ON;
    btn.classList.toggle("is-muted", muted);
    btn.setAttribute("aria-pressed", muted ? "true" : "false");
    btn.title = muted ? "Son coupé — cliquez pour activer" : "Couper le son";
    btn.setAttribute("aria-label", muted ? "Activer le son" : "Couper le son");
  }
  function toggle() { muted = !muted; try { global.localStorage.setItem(KEY, muted ? "1" : "0"); } catch (e) {} render(); }
  function mount() {
    var host = document.querySelector(".top-actions") || document.body;
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-button sound-toggle";
    btn.addEventListener("click", toggle);
    host.appendChild(btn);
    render();
  }
  if (document.readyState !== "loading") mount(); else document.addEventListener("DOMContentLoaded", mount);

  global.JogadleSound = {
    wrong: function () { play("wrong"); },
    correct: function () { play("correct"); },
    isMuted: function () { return muted; },
  };
})(window);
