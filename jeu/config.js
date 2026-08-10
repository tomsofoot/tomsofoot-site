/* Jogadle — configuration centralisée du client officiel (page dédiée /jeu).
   AUCUN SECRET ici. La clé service_role n'apparaît JAMAIS côté client : elle reste
   EXCLUSIVEMENT dans les Edge Functions Supabase. */
(function (global) {
  var PUBLIC = global.JOGADLE_PUBLIC || {};   // renseigné par config.public.js (valeurs publiques)
  global.JOGADLE_CONFIG = Object.assign({
    CHAMPIONSHIP_ENABLED: true,
    TEST_MODE: false,
    SUPABASE_URL: PUBLIC.SUPABASE_URL || "",
    SUPABASE_ANON_KEY: PUBLIC.SUPABASE_ANON_KEY || "",
    get FUNCTIONS_BASE() { return this.SUPABASE_URL ? this.SUPABASE_URL.replace(/\/$/, "") + "/functions/v1" : ""; },
    YOUTUBE_LATEST_API: "/.netlify/functions/youtube-latest",
  }, global.JOGADLE_CONFIG || {});

  global.JOGADLE_FLAGS = {
    CHAMPIONSHIP_ENABLED: !!global.JOGADLE_CONFIG.CHAMPIONSHIP_ENABLED,
    CHAMPIONSHIP_VISIBLE: !!(global.JOGADLE_CONFIG.CHAMPIONSHIP_ENABLED || global.JOGADLE_CONFIG.TEST_MODE),
  };
  try { document.documentElement.setAttribute("data-champ", global.JOGADLE_FLAGS.CHAMPIONSHIP_VISIBLE ? "on" : "off"); } catch (e) {}
})(window);
