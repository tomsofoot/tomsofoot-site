/* Jogadle — configuration centralisée du client officiel (page dédiée /jeu).
   AUCUN SECRET ici. La clé service_role n'apparaît JAMAIS côté client : elle reste
   EXCLUSIVEMENT dans les Edge Functions Supabase.

   - CHAMPIONSHIP_ENABLED : le championnat reste masqué par défaut (activé après validation serveur).
   - TEST_MODE : true UNIQUEMENT en prévisualisation locale (données fictives). false en production.
   - SUPABASE_URL / SUPABASE_ANON_KEY : lus dans le fichier statique `config.public.js`
     (clé anon PUBLIQUE seulement). Netlify publie le dossier tel quel, SANS build : il n'y a
     donc aucune injection d'environnement au build — les valeurs viennent du fichier statique. */
(function (global) {
  var PUBLIC = global.JOGADLE_PUBLIC || {};   // renseigné par config.public.js (valeurs publiques)
  global.JOGADLE_CONFIG = Object.assign({
    CHAMPIONSHIP_ENABLED: true,
    TEST_MODE: false,
    SUPABASE_URL: PUBLIC.SUPABASE_URL || "",
    SUPABASE_ANON_KEY: PUBLIC.SUPABASE_ANON_KEY || "",
    // Clé de site Turnstile (publique) — anti-robot sur l'envoi du lien magique.
    TURNSTILE_SITE_KEY: PUBLIC.TURNSTILE_SITE_KEY || "",
    // Base des Edge Functions ; par défaut dérivée de SUPABASE_URL.
    get FUNCTIONS_BASE() { return this.SUPABASE_URL ? this.SUPABASE_URL.replace(/\/$/, "") + "/functions/v1" : ""; },
    // Fonction Netlify existante (préservée) pour la vidéo de victoire.
    YOUTUBE_LATEST_API: "/.netlify/functions/youtube-latest",
  }, global.JOGADLE_CONFIG || {});

  // Drapeaux globaux. Le championnat est VISIBLE si activé OU en prévisualisation locale (TEST_MODE).
  // En production (TEST_MODE=false, CHAMPIONSHIP_ENABLED=false) il reste masqué jusqu'à validation.
  global.JOGADLE_FLAGS = {
    CHAMPIONSHIP_ENABLED: !!global.JOGADLE_CONFIG.CHAMPIONSHIP_ENABLED,
    CHAMPIONSHIP_VISIBLE: !!(global.JOGADLE_CONFIG.CHAMPIONSHIP_ENABLED || global.JOGADLE_CONFIG.TEST_MODE),
  };
  try { document.documentElement.setAttribute("data-champ", global.JOGADLE_FLAGS.CHAMPIONSHIP_VISIBLE ? "on" : "off"); } catch (e) {}
})(window);
