/* Jogadle — REALTIME RÉEL (Supabase Realtime).
   S'abonne aux changements de la projection publique du classement (public.public_leaderboard)
   et notifie le classement à chaque INSERT / UPDATE / DELETE, ce qui relit la ligue concernée
   et déclenche l'animation FLIP. Ne manipule QUE public_ref (jamais l'UUID Auth).

   - Réutilise le client Supabase partagé par auth-supabase.js (window.__JOGADLE_SB).
   - Désabonnement propre (removeChannel) via la fonction renvoyée par subscribe().
   - Si Realtime est indisponible, api.js conserve son repli en polling léger. */
(function (global) {
  "use strict";
  var CFG = global.JOGADLE_CONFIG || {};
  if (CFG.TEST_MODE) return; // inerte en prévisualisation locale (le mock gère le réordonnancement)

  function client() { return global.__JOGADLE_SB || (global.JogadleAuth && global.JogadleAuth.client && global.JogadleAuth.client()); }

  global.JogadleRealtime = {
    // subscribe(onChange) : onChange reçoit un objet { league, public_ref, eventType } (ou rien),
    // charge à l'appelant de relire la ligue concernée. Renvoie une fonction de désabonnement.
    subscribe: function (onChange) {
      var channel = null, cancelled = false;

      function attach(sb) {
        if (!sb || cancelled) return;
        channel = sb.channel("jogadle-leaderboard")
          .on("postgres_changes",
            { event: "*", schema: "public", table: "public_leaderboard" },
            function (payload) {
              var row = payload.new || payload.old || {};
              try { onChange({ league: row.league, public_ref: row.public_ref, eventType: payload.eventType }); }
              catch (e) {}
            })
          .subscribe(function (status) {
            // "SUBSCRIBED" = OK ; en cas d'échec, api.js garde son repli polling côté appelant.
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { cleanup(); }
          });
      }

      function cleanup() {
        if (channel) { var sb = client(); try { if (sb) sb.removeChannel(channel); } catch (e) {} channel = null; }
      }

      var sb = client();
      if (sb) attach(sb);
      else if (global.JogadleAuth && global.JogadleAuth.ready) global.JogadleAuth.ready.then(function () { attach(client()); });

      return function unsubscribe() { cancelled = true; cleanup(); };
    },
    available: function () { return !!client(); },
  };
})(window);
