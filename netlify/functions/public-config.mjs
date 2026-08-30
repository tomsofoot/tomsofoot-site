// netlify/functions/public-config.mjs
// Fournit au NAVIGATEUR la configuration Supabase PUBLIQUE du même contexte que le serveur,
// afin que client et serveur pointent TOUJOURS vers le même projet (jamais l'un sur staging
// et l'autre sur production). Ne renvoie QUE des valeurs publiques (URL + clé publishable).
// Applique le même garde-fou fail-closed : refuse de livrer une URL de PROD hors production.

import { json, SUPABASE_URL, ANON, NETLIFY_CONTEXT, assertDbSafe } from './lib/x-core.mjs';

export default async () => {
  try {
    assertDbSafe(); // refuse SUPABASE_URL absente, ou URL de prod en contexte non-production
  } catch (e) {
    return json(e.status || 500, { ok: false, error: e.code || 'config_error', message: e.message });
  }
  // ANON est la clé PUBLIQUE (publishable) — destinée au navigateur, aucun secret ici.
  return json(200, {
    ok: true,
    context: NETLIFY_CONTEXT || '(inconnu)',
    supabaseUrl: SUPABASE_URL,
    supabaseAnon: ANON,
  });
};
