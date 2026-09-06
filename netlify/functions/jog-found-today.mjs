// netlify/functions/jog-found-today.mjs
// Nombre PUBLIC de joueurs ayant TROUVÉ le joueur du jour (invités + connectés).
// Affiché sous le compte à rebours (« X joueurs ont déjà trouvé aujourd'hui »).
//
// Puzzle du jour : le plus récent "open" dans official_puzzles (repli : le plus récent).
// Décompte, connectés = daily_results.won = true ; invités = guest_sessions.status = 'won'.
// Les deux populations sont disjointes (user_id vs guest_token) → pas de double comptage.
//
// SÉCURITÉ : lecture via service_role (server-only), garde-fou fail-closed (assertDbSafe) →
// ne répond qu'en contexte PRODUCTION ; ne renvoie qu'un entier (aucune donnée joueur). Cache 60 s.

import { json, SUPABASE_URL, SERVICE_ROLE, assertDbSafe } from './lib/x-core.mjs';

function svcHeaders(extra) {
  const h = { apikey: SERVICE_ROLE, ...(extra || {}) };
  if (/^eyJ/.test(SERVICE_ROLE)) h.authorization = 'Bearer ' + SERVICE_ROLE; // clé service_role JWT
  return h;
}
async function getJson(path) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers: svcHeaders() });
  return r.ok ? r.json() : null;
}
// Compte EXACT sans rapatrier les lignes : en-tête count=exact + Range 0-0 → Content-Range "…/<total>".
async function countRows(path) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers: svcHeaders({ prefer: 'count=exact', range: '0-0' }) });
  const cr = r.headers.get('content-range') || '';
  const n = parseInt((cr.split('/')[1] || '0'), 10);
  return Number.isFinite(n) ? n : 0;
}

export default async () => {
  try { assertDbSafe(); } catch (e) { return json(200, { ok: false, count: null }); }
  try {
    let arr = await getJson('official_puzzles?status=eq.open&select=id&order=puzzle_date.desc&limit=1');
    if (!Array.isArray(arr) || !arr.length) arr = await getJson('official_puzzles?select=id&order=puzzle_date.desc&limit=1');
    const pid = Array.isArray(arr) && arr[0] && arr[0].id;
    if (!pid) return json(200, { ok: true, count: 0 });

    const logged = await countRows(`daily_results?puzzle_id=eq.${pid}&won=is.true`);
    const guests = await countRows(`guest_sessions?puzzle_id=eq.${pid}&status=eq.won`);
    return json(200, { ok: true, count: logged + guests }, { 'cache-control': 'public, max-age=60' });
  } catch (e) {
    return json(200, { ok: false, count: null });
  }
};
