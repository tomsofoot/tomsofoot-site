// netlify/functions/jog-verif-club.mjs
// Agent de vérification des effectifs — CONTRÔLE INSTANTANÉ d'un club (ou d'une petite liste).
//
// LECTURE SEULE : compare l'effectif API-Sports actuel au roster du jeu et renvoie les mouvements
// détectés (arrivées, recrues à créer, départs probables, cas douteux). N'écrit RIEN en base :
// les décisions se prennent ensuite dans la régie (regie-effectifs-auto.html).
//
// Auth : admin requis (jeton Supabase de la régie). Base de PROD accessible uniquement en contexte
// production (garde-fou fail-closed de lib/x-core).
//
// Usage (POST, en-tête "Authorization: Bearer <jwt admin>") :
//   /.netlify/functions/jog-verif-club?club=Olympique%20Lyonnais
//   /.netlify/functions/jog-verif-club?club=Olympique%20Lyonnais&club=Ajax%20Amsterdam   (max 4 clubs)
//   &season=2026 (défaut : saison en cours)

import { sbAdmin, requireAdmin } from './lib/x-core.mjs';
import { compareClub } from './lib/jog-auto-core.mjs';
import { loadAllPlayers } from './lib/jog-roster.mjs';

const APIKEY = process.env.APISPORTS_KEY;
const API = 'https://v3.football.api-sports.io';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,authorization', 'access-control-allow-methods': 'POST,OPTIONS' };
const J = (s, o) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });

async function api(path) {
  const r = await fetch(API + path, { headers: { 'x-apisports-key': APIKEY } });
  return r.json().catch(() => ({}));
}

async function apiSquad(teamId, season) {
  let page = 1, total = 1, out = [];
  do {
    const j = await api(`/players?team=${teamId}&season=${season}&page=${page}`);
    const errs = j && j.errors;
    if (errs && (Array.isArray(errs) ? errs.length : Object.keys(errs).length)) {
      throw new Error('api_sports: ' + JSON.stringify(errs).slice(0, 200));
    }
    total = (j.paging && j.paging.total) || 1;
    (j.response || []).forEach(x => {
      const p = x.player || {};
      const st = (x.statistics && x.statistics[0] && x.statistics[0].games) || {};
      out.push({ ext_id: p.id, firstname: p.firstname, lastname: p.lastname, name: p.name,
                 birth: (p.birth && p.birth.date) || null, nat: p.nationality || null, position: st.position || null });
    });
    page++;
  } while (page <= total && page <= 8);
  return out;
}

function currentSeason() { const d = new Date(); return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; }

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { headers: CORS });
  if (req.method !== 'POST') return J(405, { error: 'method_not_allowed' });
  if (!APIKEY) return J(500, { error: 'no_apisports_key' });
  try { await requireAdmin(req); } catch (e) { return J(e.status || 401, { error: String(e.message || e) }); }

  const url = new URL(req.url);
  const names = url.searchParams.getAll('club').filter(Boolean).slice(0, 4);
  const season = parseInt(url.searchParams.get('season') || String(currentSeason()), 10);
  if (!names.length) return J(400, { error: 'paramètre club requis' });

  const inList = names.map(n => '"' + n.replace(/"/g, '') + '"').map(encodeURIComponent).join(',');
  const clubs = await sbAdmin(`jog_clubs?canonical_name=in.(${inList})&select=canonical_name,league,apisports_team_id`) || [];
  const unknown = names.filter(n => !clubs.some(c => c.canonical_name === n));

  const roster = await loadAllPlayers(sbAdmin, 'id,name,short_name,club,league,country,birth_date,apisports_id');
  const results = [];
  for (const c of clubs) {
    if (!c.apisports_team_id) { results.push({ club: c.canonical_name, error: 'club sans apisports_team_id dans jog_clubs' }); continue; }
    try {
      const squad = await apiSquad(c.apisports_team_id, season);
      if (!squad.length) { results.push({ club: c.canonical_name, error: 'effectif API vide (saison ' + season + ')' }); continue; }
      const { proposals, stats, links } = compareClub(squad, roster, c.canonical_name, c.league);
      const pick = p => ({ name: p.player_name, from: p.club_from, to: p.club_to, confidence: p.confidence, reason: p.reason,
                           player_id: p.player_id || null, ext_id: p.player_ext_id || null, birth: p.birth_date || null, position: p.position || null });
      results.push({
        club: c.canonical_name, league: c.league, season, stats,
        arrivals: proposals.filter(p => p.player_id && p.club_to === c.canonical_name && !p.is_departure).map(pick),
        new_players: proposals.filter(p => p.is_new).map(pick),
        departures: proposals.filter(p => p.is_departure).map(pick),
        ambiguous: proposals.filter(p => p.confidence === 'ambigue' && !p.is_departure).map(pick),
        ids_to_link: (links || []).length,
      });
    } catch (e) { results.push({ club: c.canonical_name, error: String(e.message || e) }); }
  }
  return J(200, { ok: true, season, unknown_clubs: unknown, results });
};
