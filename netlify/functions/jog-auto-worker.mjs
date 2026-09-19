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
import { loadAllPlayers } from './lib/jog-roster.mjs';

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
    // API-Sports signale quota dépassé / clé invalide / saison indisponible dans `errors` avec une
    // réponse VIDE : on lève une erreur au lieu de traiter l'effectif comme vide (sinon tous les
    // joueurs du club passeraient pour « partis »).
    const errs = j && j.errors;
    if (errs && (Array.isArray(errs) ? errs.length : Object.keys(errs).length)) {
      throw new Error('api_sports: ' + JSON.stringify(errs).slice(0, 200));
    }
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

// Effectif OFFICIEL actuel (liste de l'équipe, sans dates de naissance) : [{ id, name }].
// Sert à confirmer les départs et à repérer les arrivées pas encore utilisées. null si indisponible.
async function apiOfficialSquad(teamId) {
  try {
    const j = await api(`/players/squads?team=${teamId}`);
    const errs = j && j.errors;
    if (errs && (Array.isArray(errs) ? errs.length : Object.keys(errs).length)) return null;
    const t = (j.response || [])[0];
    const list = (t && t.players) || [];
    return list.length ? list.map(p => ({ id: p.id, name: p.name })) : null;
  } catch (_) { return null; }
}

export default async (req) => {
  if (!APIKEY) return J(500, { error: 'no_apisports_key' });

  const url = new URL(req.url);
  let batchId = url.searchParams.get('batch');
  const max = Math.min(parseInt(url.searchParams.get('max') || '4', 10) || 4, 10); // clubs par tick (respect quota)

  let batch;
  try {
    if (!batchId) {
      // Tick planifié : prendre le plus ancien lot ayant encore des items à traiter (ordre stable par id,
      // le même que celui affiché dans la régie : « Prochains clubs »).
      const pend = await sbAdmin(`jog_auto_batch_items?status=in.(planifie,echec)&select=batch_id&order=id.asc&limit=1`);
      if (!pend || !pend.length) return J(200, { ok: true, idle: true });
      batchId = pend[0].batch_id;
    }
    const b = await sbAdmin(`jog_auto_batches?id=eq.${batchId}&select=*`);
    batch = (b || [])[0];
  } catch (e) { return J(e.status || 502, { error: 'db_read_failed', message: String(e.message || e) }); }
  if (!batch) return J(404, { error: 'lot introuvable' });

  // Items encore à traiter (planifie/echec), en petit lot.
  const items = await sbAdmin(
    `jog_auto_batch_items?batch_id=eq.${batchId}&status=in.(planifie,echec)&select=id,apisports_team_id,club_name,league&order=id.asc&limit=${max}`
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
      // Pas de réponse = pas de conclusion : un effectif vide n'est jamais « tout le monde est parti ».
      if (!squad.length) throw new Error('effectif API vide (saison ' + season + ') — club non analysé');
      // Roster jeu COMPLET (paginé : l'API Supabase plafonne à 1000 lignes par réponse), avec
      // l'identifiant API-Sports déjà connu → reconnaissance CERTAINE par id quand il existe.
      const rosterAll = await loadAllPlayers(sbAdmin, 'id,name,short_name,club,league,country,birth_date,apisports_id');

      const official = await apiOfficialSquad(it.apisports_team_id);
      const { proposals, stats, links } = compareClub(squad, rosterAll, it.club_name, it.league, { official });

      // Auto-cicatrisation : enregistre l'id API-Sports des joueurs reconnus de façon certaine qui
      // n'en ont pas encore. N'écrit QUE players.apisports_id. Non bloquant (un conflit d'unicité
      // ou une erreur isolée n'arrête pas l'analyse).
      for (const l of (links || [])) {
        try {
          await sbAdmin(`players?id=eq.${encodeURIComponent(l.player_id)}&apisports_id=is.null`,
            { method: 'PATCH', body: { apisports_id: l.apisports_id }, prefer: 'return=minimal' });
        } catch (_) { /* non bloquant */ }
      }

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
          // TOUTES les lignes doivent avoir exactement les mêmes clés, sinon PostgREST refuse le
          // paquet entier (400 PGRST102 « All object keys must match ») : colonnes absentes = null.
          for (const c of PROP_COLS) row[c] = (p[c] === undefined ? null : p[c]);
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
