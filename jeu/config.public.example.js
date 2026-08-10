/* Jogadle — MODÈLE de configuration publique.
   Copiez ce fichier en `config.public.js` puis renseignez les deux valeurs publiques.
   (Netlify publie le dossier directement, sans build : ces valeurs statiques sont lues telles quelles.)

   Rappel de sécurité :
     - Uniquement l'URL Supabase et la clé anon PUBLIQUE.
     - JAMAIS la clé service_role : elle reste exclusivement dans les Edge Functions Supabase. */
window.JOGADLE_PUBLIC = {
  SUPABASE_URL: "",        // ex: https://xxxxxxxxxxxx.supabase.co
  SUPABASE_ANON_KEY: "",   // clé « anon » publique (jamais service_role)
};
