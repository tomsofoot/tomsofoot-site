// netlify/functions/jog-auto-worker.mjs
// Régie automatisée — WORKER persistant (Phase 2).
//
// Traite quelques clubs d'un lot à chaque passage (tick planifié OU appel admin) :
//   1) lit l'effectif API-Sports du club (clé serveur, jamais exposée) ;
//   2) lit le roster TomsoFoot du club (service_role, contourne la RLS) ;
//   3) compare via le moteur (lib/jog-auto-core) → propositions classées par confiance ;
//   4) écrit les propositions + met l'item à jour (service_role) ;
//   5) sauvegarde la progression → reprise possible plus tard.
//
// SÉCURITÉ : sbAdmin() est « fail-closed » (lib/x-core) → il REFUSE d'écrire dans la base de PROD
// depuis un contexte ≠ production (donc depuis un Deploy Preview). Le chemin d'ÉCRITURE ne
// s'exécute donc qu'en production ; en preview, la lecture+comparaison fonctionnent, l'écriture est
// refusée par conception (aucune écriture prod hors production). Idempotent, protégé contre les doublons.

import { SUPABASE_URL, SERVICE_ROLE, sbAdmin } from './lib/x-core.mjs';
import { compareClub } from './lib/jog-auto-core.mjs';

export const config = { schedule: '*/15 * * * *' }; // tick planifié toutes les 15 min (respect quota) ; aussi appelable à la demande avec ?batch=

const APIKEY = process.env.APISPORTS_KEY;
const API = 'https://v3.football.api-sports.io';
const J = (s, o) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function api(path) {
  const r = await fetch(API + path, { headers: { 'x-apisports-key': APIKEY } });
  return r.json().catch(() => ({}));
}

// Effectif détaillé d'une équipe (identité complète : prénom/nom, naissance, nationalité). Paginé.
async function apiSquad(teamId, season) {
  let page = 1, total = 1, out = [];
  do {
    const j = await api(`/players?team=${teamId}&season=${season}&page=${page}`);
    total = (j.paging && j.paging.total) || 1;
    (j.response || []).forEach(x => {
      const p = x.player || {};
      out.push({
        ext_id: p.id, firstname: p.firstname, lastname: p.lastname, name: p.name,
        birth: (p.birth && p.birth.date) || null, nat: p.nationality || null,
      });
    });
    page++;
  } while (page <= total && page <= 8);
  return out;
}

export default async (req) => {
  if (!APIKEY) return J(500, { error: 'no_apisports_key' });

  const url = new URL(req.url);
  let batchId = url.searchParams.get('batch');
  const max = Math.min(parseInt(url.searchParams.get('max') || '4', 10) || 4, 10); // clubs par tick (respect quota)

  let batch;
  try {
    if (!batchId) {
      // Tick planifié : prendre le plus ancien lot ayant encore des items à traiter.
      const pend = await sbAdmin(`jog_auto_batch_items?status=in.(planifie,echec)&select=batch_id&limit=1`);
      if (!pend || !pend.length) return J(200, { ok: true, idle: true });
      batchId = pend[0].batch_id;
    }
    const b = await sbAdmin(`jog_auto_batches?id=eq.${batchId}&select=*`);
    batch = (b || [])[0];
  } catch (e) { return J(e.status || 502, { error: 'db_read_failed', message: String(e.message || e) }); }
  if (!batch) return J(404, { error: 'lot introuvable' });

  // Items encore à traiter (planifie/echec), en petit lot.
  const items = await sbAdmin(
    `jog_auto_batch_items?batch_id=eq.${batchId}&status=in.(planifie,echec)&select=id,apisports_team_id,club_name,league&limit=${max}`
  );
  if (!items || !items.length) {
    await sbAdmin(`jog_auto_batches?id=eq.${batchId}`, { method: 'PATCH', body: { status: 'analyse_terminee', updated_at: new Date().toISOString() } });
    return J(200, { ok: true, done: true, processed: 0 });
  }

  const season = batch.season;
  let processed = 0, totalProposals = 0, errors = 0;

  for (const it of items) {
    try {
      // marquer en cours (anti-double-traitement simple)
      await sbAdmin(`jog_auto_batch_items?id=eq.${it.id}`, { method: 'PATCH', body: { status: 'en_cours' } });

      const squad = await apiSquad(it.apisports_team_id, season);
      // roster jeu du club (service_role)
      const roster = await sbAdmin(
        `players?club=eq.${encodeURIComponent(it.club_name)}&select=id,name,club,league,country,birth_date`
      );
      // roster complet léger pour retrouver une arrivée venue d'un autre club
      const rosterAll = await sbAdmin(`players?select=id,name,club,league,country,birth_date&limit=5000`);

      const { proposals, stats } = compareClub(squad, rosterAll || roster || [], it.club_name, it.league);

      // écrire les propositions (nettoyage idempotent des propositions encore en attente de ce club)
      const extIds = proposals.map(p => p.player_ext_id).filter(x => x != null);
      if (extIds.length) {
        await sbAdmin(`jog_auto_proposals?batch_id=eq.${batchId}&decision=eq.en_attente&player_ext_id=in.(${extIds.join(',')})`, { method: 'DELETE' });
      }
      if (proposals.length) {
        // N'insérer QUE les colonnes réelles de jog_auto_proposals : le moteur ajoute des
        // champs de travail (is_new, position, country, birth_date, is_departure) qui ne sont
        // PAS des colonnes → sinon PostgREST rejette tout le paquet (erreur 400).
        const PROP_COLS = ['player_id','player_ext_id','player_name','movement_type','club_from','club_to','league_from','league_to','confidence','source','evidence_url','observed_at','second_source','reason'];
        const rows = proposals.map(p => {
          const row = { batch_id: batchId };
          for (const c of PROP_COLS) if (p[c] !== undefined && p[c] !== null) row[c] = p[c];
          return row;
        });
        await sbAdmin('jog_auto_proposals', {
          method: 'POST',
          body: rows,
          prefer: 'return=minimal',
        });
      }
      await sbAdmin(`jog_auto_batch_items?id=eq.${it.id}`, { method: 'PATCH', body: { status: 'termine', anomalies_count: stats.ambiguous + stats.departures, last_saved_at: new Date().toISOString() } });
      await sbAdmin('jog_source_runs', { method: 'POST', body: { batch_id: batchId, source: 'api-sports', league: it.league, status: 'disponible' }, prefer: 'return=minimal' });

      processed++; totalProposals += proposals.length;
    } catch (e) {
      errors++;
      try { await sbAdmin(`jog_auto_batch_items?id=eq.${it.id}`, { method: 'PATCH', body: { status: 'echec' } }); } catch (_) {}
      try { await sbAdmin('jog_source_runs', { method: 'POST', body: { batch_id: batchId, source: 'api-sports', league: it.league, status: 'inaccessible', detail: String(e.message || e).slice(0, 200) }, prefer: 'return=minimal' }); } catch (_) {}
    }
  }

  const remaining = await sbAdmin(`jog_auto_batch_items?batch_id=eq.${batchId}&status=in.(planifie,echec)&select=id`);
  const status = (remaining && remaining.length) ? 'analyse_en_cours' : (errors ? 'echec_partiel' : 'analyse_terminee');
  await sbAdmin(`jog_auto_batches?id=eq.${batchId}`, { method: 'PATCH', body: { status, updated_at: new Date().toISOString() } });

  return J(200, { ok: true, processed, proposals: totalProposals, errors, remaining: (remaining || []).length });
};
