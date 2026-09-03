// netlify/functions/jog-auto-launch.mjs
// Régie automatisée — LANCE un lot d'analyse (Phase 2). Admin uniquement.
//
// Crée un lot persistant (jog_auto_batches) + un item par club (jog_auto_batch_items), à partir de
// la table d'identité jog_clubs (mapping club interne <-> apisports_team_id) pour les championnats
// demandés. Idempotent via une clé (idem_key) = saison+ligues+jour → pas de doublon de lot.
//
// SÉCURITÉ : accès ADMIN vérifié via le jeton Supabase de l'appelant (requireAdmin, lib/x-core) ;
// écritures via service_role, garde-fou « fail-closed » (pas d'écriture prod hors production).

import { sbAdmin, requireAdmin } from './lib/x-core.mjs';

const J = (s, o) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,authorization', 'access-control-allow-methods': 'POST,OPTIONS' } });
  if (req.method !== 'POST') return J(405, { error: 'method_not_allowed' });

  try { await requireAdmin(req); } catch (e) { return J(e.status || 401, { error: e.message || 'unauthorized' }); }

  let body; try { body = await req.json(); } catch { return J(400, { error: 'bad_json' }); }
  const season = parseInt(body.season, 10);
  const leagues = Array.isArray(body.leagues) ? body.leagues : [];
  const name = (body.name || ('Analyse ' + new Date().toISOString().slice(0, 10))).slice(0, 120);
  if (!season || !leagues.length) return J(400, { error: 'season + leagues requis' });

  // Idempotence : un lot par (saison, ligues triées, jour).
  const idem = 'auto:' + season + ':' + [...leagues].sort().join('|') + ':' + new Date().toISOString().slice(0, 10);

  // Clubs à analyser = jog_clubs des ligues demandées ayant un apisports_team_id.
  const inList = leagues.map(l => encodeURIComponent(l)).join(',');
  const clubs = await sbAdmin(`jog_clubs?active=eq.true&apisports_team_id=not.is.null&league=in.(${inList})&select=canonical_name,league,apisports_team_id`);
  if (!clubs || !clubs.length) return J(422, { error: 'aucun club mappé (jog_clubs) pour ces championnats — seed requis', hint: 'Peupler jog_clubs (apisports_team_id) avant de lancer.' });

  // Idempotence : si un lot existe déjà pour cette clé, on le renvoie (pas de doublon).
  const existing = await sbAdmin(`jog_auto_batches?idem_key=eq.${encodeURIComponent(idem)}&select=id`);
  if (existing && existing.length) {
    return J(200, { ok: true, batch_id: existing[0].id, clubs: clubs.length, idem_key: idem, existing: true,
      next: '/.netlify/functions/jog-auto-worker?batch=' + existing[0].id });
  }

  // Création directe via service_role (requireAdmin a déjà validé l'appelant humain).
  const created = await sbAdmin('jog_auto_batches', {
    method: 'POST',
    body: { name, season, source: 'api-sports', leagues, status: 'planifie', idem_key: idem },
    prefer: 'return=representation',
  });
  const batchId = (created && created[0] && created[0].id) || null;
  if (!batchId) return J(502, { error: 'batch_create_failed' });

  const items = clubs.map(c => ({ batch_id: batchId, apisports_team_id: c.apisports_team_id, club_name: c.canonical_name, league: c.league, status: 'planifie' }));
  await sbAdmin('jog_auto_batch_items', { method: 'POST', body: items, prefer: 'return=minimal' });

  return J(200, { ok: true, batch_id: batchId, clubs: clubs.length, idem_key: idem,
    next: '/.netlify/functions/jog-auto-worker?batch=' + batchId });
};
