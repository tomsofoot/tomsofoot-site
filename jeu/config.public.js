/* Jogadle — VALEURS PUBLIQUES du client (fichier statique servi tel quel par Netlify, publish=".").
   Netlify publie le dossier directement, SANS commande de build : il n'y a donc AUCUNE injection
   d'environnement au build. Les valeurs publiques sont lues dans CE fichier statique.

   Ce fichier ne doit contenir QUE :
     - SUPABASE_URL      : l'URL du projet Supabase
     - SUPABASE_ANON_KEY : la clé « anon » PUBLIQUE (destinée au navigateur)

   Il ne doit JAMAIS contenir la clé service_role, qui reste EXCLUSIVEMENT dans les
   Edge Functions Supabase (variables d'environnement côté serveur).

   Laisser les deux champs vides active le MODE DÉGRADÉ propre (aucune donnée fictive). */
window.JOGADLE_PUBLIC = {
  // Projet Supabase de PRODUCTION (Jogadle-prod).
  SUPABASE_URL: "https://yubndvqmglttlntkugzm.supabase.co",
  // Clé « publishable » PUBLIQUE (destinée au navigateur — jamais la clé service_role).
  SUPABASE_ANON_KEY: "sb_publishable_8x7te6dRypwXn_vR5hyf9A_rh6h-JBZ",
};
