// netlify/functions/jog-backfill-extids.mjs
// TomsoFoot — BACKFILL des identifiants API-Sports sur les joueurs existants (le "pont").
// One-shot supervisé : relie chaque joueur du jeu à son id API-Sports pour rendre les mises à jour
// d'effectifs fiables à 100%. N'écrit QUE la colonne players.apisports_id, rien d'autre.
//
// Auth : admin requis (requireAdmin). Écriture via service_role → par conception (x-core fail-closed),
// tout accès à la base de PROD (lecture comprise) n'est possible qu'en contexte production :
// en Deploy Preview la fonction répond « config_error » (garde-fou voulu). Simulation = dry_run=1.
//
// Usage (POST, en-tête "Authorization: Bearer <jwt admin>") :
//   /.netlify/functions/jog-backfill-extids?league=Ligue%201&dry_run=1     (simulation, recommandé d'abord)
//   /.netlify/functions/jog-backfill-extids?league=Ligue%201&dry_run=0     (application réelle, en prod)
//   /.netlify/functions/jog-backfill-extids?club=Olympique%20Lyonnais&dry_run=1
//   (sans param -> toutes les ligues ; ATTENTION au quota API-Sports : préfère ligue par ligue)

import { sbAdmin, requireAdmin } from './lib/x-core.mjs';
import { buildRosterIndex, identify, norm } from './lib/jog-auto-core.mjs';
import { loadAllPlayers } from './lib/jog-roster.mjs';

const APIKEY = process.env.APISPORTS_KEY;
const API = 'https://v3.football.api-sports.io';
// Codes ligues API-Football (cf. jog-squads.mjs)
const LEAGUE_CODE = {
  'Premier League': 39, 'Ligue 1': 61, 'Liga': 140, 'Serie A': 135,
  'Bundesliga': 78, 'Eredivisie': 88, 'Liga Portugal': 94, 'Süper Lig': 203,
};
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,authorization', 'access-control-allow-methods': 'POST,OPTIONS' };
const J = (s, o) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });

async function api(path) {
  const r = await fetch(API + path, { headers: { 'x-apisports-key': APIKEY } });
  return r.json().catch(() => ({}));
}

// Effectif détaillé (identité + naissance + nationalité), paginé.
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
      out.push({ ext_id: p.id, firstname: p.firstname, lastname: p.lastname, name: p.name,
                 birth: (p.birth && p.birth.date) || null, nat: p.nationality || null });
    });
    page++;
  } while (page <= total && page <= 8);
  return out;
}

// Repli si jog_clubs n'a pas d'apisports_team_id : associe les équipes API d'une ligue à tes clubs
// (par nom normalisé). Retourne [{canonical_name, league, apisports_team_id}] + la liste des non-appariés.
async function clubsFromApi(leagues, season, distinctGameClubsByLeague) {
  const clubs = [], unmatched = [];
  for (const lg of leagues) {
    const code = LEAGUE_CODE[lg];
    if (!code) { unmatched.push({ league: lg, note: 'code ligue inconnu' }); continue; }
    const t = await api(`/teams?league=${code}&season=${season}`);
    const teams = (t.response || []).map(x => ({ id: x.team && x.team.id, name: x.team && x.team.name }));
    const gameClubs = distinctGameClubsByLeague[lg] || [];
    const byNorm = new Map(gameClubs.map(c => [norm(c), c]));
    for (const tm of teams) {
      const hit = byNorm.get(norm(tm.name));
      if (hit) clubs.push({ canonical_name: hit, league: lg, apisports_team_id: tm.id });
      else unmatched.push({ league: lg, api_team: tm.name, api_team_id: tm.id });
    }
  }
  return { clubs, unmatched };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { headers: CORS });
  if (req.method !== 'POST') return J(405, { error: 'method_not_allowed' });
  if (!APIKEY) return J(500, { error: 'no_apisports_key' });
  try { await requireAdmin(req); } catch (e) { return J(e.status || 401, { error: String(e.message || e) }); }

  const url = new URL(req.url);
  const season = parseInt(url.searchParams.get('season') || '2026', 10);
  const dryRun = url.searchParams.get('dry_run') !== '0'; // défaut : simulation
  const oneLeague = url.searchParams.get('league');
  const oneClub = url.searchParams.get('club');
  const ALL_LEAGUES = ['Premier League', 'Ligue 1', 'Bundesliga', 'Serie A', 'Liga', 'Süper Lig', 'Liga Portugal', 'Eredivisie'];

  // Roster complet (pour retrouver aussi un joueur mal-clubbé) — inclut apisports_id.
  // (paginé : l'API Supabase plafonne à 1000 lignes par réponse)
  const rosterAll = await loadAllPlayers(sbAdmin, 'id,name,short_name,club,league,country,birth_date,apisports_id');
  const idx = buildRosterIndex(rosterAll);

  // Clubs cibles : d'abord jog_clubs.
  let clubs = await sbAdmin(`jog_clubs?select=canonical_name,league,apisports_team_id,active&apisports_team_id=not.is.null&active=eq.true`) || [];
  clubs = clubs.map(c => ({ canonical_name: c.canonical_name, league: c.league, apisports_team_id: c.apisports_team_id }));

  // Repli si jog_clubs vide.
  let clubMapUnmatched = [];
  if (!clubs.length) {
    const leagues = oneLeague ? [oneLeague] : ALL_LEAGUES;
    const distinctByLeague = {};
    for (const g of rosterAll) { (distinctByLeague[g.league] = distinctByLeague[g.league] || new Set()).add(g.club); }
    Object.keys(distinctByLeague).forEach(k => distinctByLeague[k] = [...distinctByLeague[k]]);
    const res = await clubsFromApi(leagues, season, distinctByLeague);
    clubs = res.clubs; clubMapUnmatched = res.unmatched;
  }

  if (oneClub) clubs = clubs.filter(c => c.canonical_name === oneClub);
  if (oneLeague) clubs = clubs.filter(c => c.league === oneLeague);
  if (!clubs.length) return J(200, { ok: true, note: 'Aucun club cible (vérifie jog_clubs ou le filtre).', club_mapping_unmatched: clubMapUnmatched });

  const report = { season, dry_run: dryRun, clubs: 0, to_link: 0, already: 0,
                   linked: [], ambiguous: [], unmatched: [], api_errors: [], club_mapping_unmatched: clubMapUnmatched };
  const toWrite = []; // {id, apisports_id}
  const seenIds = new Set(), seenExt = new Set();

  for (const c of clubs) {
    let squad;
    try { squad = await apiSquad(c.apisports_team_id, season); }
    catch (e) { report.api_errors.push({ club: c.canonical_name, error: String(e.message || e) }); continue; }
    if (!squad.length) { report.api_errors.push({ club: c.canonical_name, error: 'effectif API vide (saison ' + season + ')' }); continue; }
    report.clubs++;
    for (const ap of squad) {
      const label = (ap.firstname && ap.lastname) ? (ap.firstname + ' ' + ap.lastname) : (ap.name || '?');
      const r = identify(ap, idx);
      if (r.match) {
        const g = r.match;
        if (g.apisports_id != null) { report.already++; continue; }        // déjà relié
        if (r.confidence === 'certaine') {
          if (seenIds.has(g.id) || seenExt.has(Number(ap.ext_id))) { report.already++; continue; } // même joueur vu dans 2 effectifs (prêt)
          seenIds.add(g.id); seenExt.add(Number(ap.ext_id));
          toWrite.push({ id: g.id, apisports_id: ap.ext_id });
          report.linked.push({ id: g.id, name: g.name, apisports_id: ap.ext_id, club: c.canonical_name, via: r.reason });
        } else {
          report.ambiguous.push({ api_name: label, ext_id: ap.ext_id, guess_id: g.id, guess_name: g.name,
            club: c.canonical_name, confidence: r.confidence, reason: r.reason, birth_api: ap.birth, birth_game: g.birth_date });
        }
      } else if (r.confidence === 'ambigue') {
        report.ambiguous.push({ api_name: label, ext_id: ap.ext_id, club: c.canonical_name, reason: r.reason,
          candidates: (r.candidates || []).map(x => ({ id: x.id, name: x.name, club: x.club })) });
      } else {
        report.unmatched.push({ api_name: label, ext_id: ap.ext_id, club: c.canonical_name, birth: ap.birth, nat: ap.nat });
      }
    }
  }
  report.to_link = toWrite.length;

  if (!dryRun && toWrite.length) {
    // Écriture ciblée : PATCH par joueur (service_role, bypasse la RLS ; refusé hors prod par x-core).
    // PATCH (et pas upsert) pour éviter tout souci de colonnes NOT NULL.
    let written = 0;
    for (const w of toWrite) {
      try {
        // « apisports_id=is.null » : on ne remplace jamais un lien déjà posé.
        await sbAdmin(`players?id=eq.${encodeURIComponent(w.id)}&apisports_id=is.null`, { method: 'PATCH', body: { apisports_id: w.apisports_id }, prefer: 'return=minimal' });
        written++;
      } catch (e) { report.api_errors.push({ id: w.id, error: String(e.message || e) }); }
    }
    report.written = written;
  }

  return J(200, { ok: true, ...report });
};
