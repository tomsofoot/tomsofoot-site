/* jeux-init.js — Adaptateur d'intégration du pop-up « Choisissez votre défi ».
 *
 * Rôle : brancher le composant fourni (window.TomsoFootGameChoice) sur les VRAIES
 * routes des deux jeux et sur leur ÉTAT DU JOUR, sans jamais calculer de score,
 * créditer des points, ni décider si un résultat est officiel.
 *
 * - Routes officielles :
 *     Le Joueur du Jour → /jeu           (jeu 1, existant)
 *     Mode Carrière     → /mode-carriere/ (jeu 2)
 * - État du jour : lu depuis les balises locales déjà écrites par chaque jeu
 *     (localStorage  tfjeux:<id>:<date Europe/Paris>  = { state }).
 *   'completed' ou 'revealed' → carte « TERMINÉ » (bouton « Rejouer hors classement »).
 *   sinon → 'available'. (Cross-appareils pour comptes connectés = évolution serveur ultérieure.)
 *
 * N'écrit dans aucune table, n'appelle aucun backend.
 */
(function () {
  'use strict';

  var ROUTES = { 'daily-player': '/jeu', 'career-mode': '/mode-carriere/' };

  function parisDate() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
    catch (e) { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  }
  function beacon(id) {
    try {
      var raw = window.localStorage.getItem('tfjeux:' + id + ':' + parisDate());
      if (!raw) return null;
      var o = JSON.parse(raw); return o && o.state ? o.state : null;
    } catch (e) { return null; }
  }
  function stateFor(id) {
    var s = beacon(id);
    return (s === 'completed' || s === 'revealed') ? 'completed' : 'available';
  }
  function buildGames() {
    return [
      { id: 'daily-player', state: stateFor('daily-player'), href: ROUTES['daily-player'] },
      { id: 'career-mode',  state: stateFor('career-mode'),  href: ROUTES['career-mode'] },
    ];
  }

  function start() {
    if (!window.TomsoFootGameChoice) return;
    window.TomsoFootGameChoice.init({ games: buildGames(), openOnLoad: false });

    // Repli progressif : les déclencheurs restent des liens vers /jeu si le JS échoue ;
    // ici on empêche la navigation pour ouvrir le pop-up à la place.
    document.querySelectorAll('[data-open-game-choice]').forEach(function (el) {
      el.addEventListener('click', function (e) { e.preventDefault(); });
    });

    // Rafraîchir les états au retour sur l'accueil (après avoir joué).
    window.addEventListener('pageshow', function () { try { window.TomsoFootGameChoice.setGames(buildGames()); } catch (e) {} });
  }

  if (document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);
})();
