// netlify/functions/jog-effectifs-maj.mjs
// Date PUBLIQUE de dernière mise à jour des effectifs (lecture seule, aucun secret renvoyé).
//
// Affichée aux joueurs sous le compte à rebours (« Effectifs à jour le … »).
// Source, on prend la date la PLUS RÉCENTE parmi :
//   1) jog_source_runs.ran_at   — dernière vérification réussie des effectifs (API-Sports) ;
//   2) jog_auto_batches.updated_at (status='applique') — dernière application d'un lot de transferts.
// Ainsi la date bouge à chaque analyse mercato ET à chaque application validée.
//
// SÉCURITÉ : sbAdmin() est fail-closed (lib/x-core) → ne répond qu'en contexte PRODUCTION ;
// ne renvoie qu'une date ISO (aucune donnée joueur, aucun secret). Mise en cache 30 min.

import { json, sbAdmin } from './lib/x-core.mjs';

export default async () => {
  let best = null;
  const consider = (v) => { if (v && (!best || new Date(v) > new Date(best))) best = v; };

  try {
    const runs = await sbAdmin('jog_source_runs?status=in.(disponible,partielle)&select=ran_at&order=ran_at.desc&limit=1');
    if (Array.isArray(runs) && runs[0]) consider(runs[0].ran_at);
  } catch (_) { /* table/contexte indisponible : on ignore, on tentera l'autre source */ }

  try {
    const applied = await sbAdmin('jog_auto_batches?status=eq.applique&select=updated_at&order=updated_at.desc&limit=1');
    if (Array.isArray(applied) && applied[0]) consider(applied[0].updated_at);
  } catch (_) { /* idem */ }

  return json(200, { ok: true, updated_at: best }, { 'cache-control': 'public, max-age=1800' });
};
