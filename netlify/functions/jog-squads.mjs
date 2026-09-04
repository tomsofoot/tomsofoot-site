// TomsoFoot — Effectifs API-Sports pour l'audit/mise à jour du jeu Jogadle.
// LECTURE SEULE. La clé API reste STRICTEMENT côté serveur (variable d'env APISPORTS_KEY),
// jamais renvoyée au client. Sert uniquement à comparer l'effectif du jeu à l'effectif réel.
//
// Usage :
//   /.netlify/functions/jog-squads?league=61&season=2026   -> liste des équipes de la ligue
//   /.netlify/functions/jog-squads?team=80                  -> effectif d'une équipe
//   /.netlify/functions/jog-squads?players=team&team=80&season=2026 -> détails joueurs (nationalité, naissance)
//
// Codes ligues API-Football utiles : L1=61, PL=39, Liga=140, SerieA=135, Bundesliga=78,
// Eredivisie=88, Liga Portugal=94, Süper Lig=203.

const KEY  = process.env.APISPORTS_KEY;
const BASE = 'https://v3.football.api-sports.io';
const H = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
};

async function api(path) {
  const r = await fetch(BASE + path, { headers: { 'x-apisports-key': KEY } });
  const j = await r.json().catch(() => ({}));
  return j;
}

export default async (req) => {
  if (!KEY) return new Response(JSON.stringify({ error: 'no_key' }), { status: 500, headers: H });

  const url    = new URL(req.url);
  const season = url.searchParams.get('season') || '2026';
  const league = url.searchParams.get('league');
  const team   = url.searchParams.get('team');
  const players = url.searchParams.get('players');

  try {
    // Détails joueurs d'une équipe (pour les recrues à insérer) — paginé.
    if (players === 'team' && team) {
      let page = 1, all = [], total = 1;
      do {
        const j = await api(`/players?team=${encodeURIComponent(team)}&season=${encodeURIComponent(season)}&page=${page}`);
        total = (j.paging && j.paging.total) || 1;
        (j.response || []).forEach(x => {
          const p = x.player || {};
          all.push({
            id: p.id, name: p.name, firstname: p.firstname, lastname: p.lastname,
            birth: (p.birth && p.birth.date) || null, nationality: p.nationality || null,
          });
        });
        page++;
      } while (page <= total && page <= 6);
      return new Response(JSON.stringify({ team, season, count: all.length, players: all }), { headers: H });
    }

    // Effectif d'une équipe (nom, numéro, poste, âge).
    if (team) {
      const s  = await api(`/players/squads?team=${encodeURIComponent(team)}`);
      const sq = (s.response && s.response[0]) || {};
      const list = (sq.players || []).map(p => ({
        id: p.id, name: p.name, number: p.number, position: p.position, age: p.age,
      }));
      return new Response(JSON.stringify({ team: sq.team || { id: Number(team) }, count: list.length, players: list }), { headers: H });
    }

    // Équipes d'une ligue pour une saison.
    if (league) {
      const t = await api(`/teams?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}`);
      const teams = (t.response || []).map(x => ({
        id: x.team && x.team.id, name: x.team && x.team.name, country: x.team && x.team.country,
      }));
      return new Response(JSON.stringify({ league, season, count: teams.length, teams }), { headers: H });
    }

    return new Response(JSON.stringify({
      error: 'params',
      usage: '?league=61&season=2026  |  ?team=80  |  ?players=team&team=80&season=2026',
    }), { status: 400, headers: H });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'fetch_failed', message: e.message }), { status: 502, headers: H });
  }
};
