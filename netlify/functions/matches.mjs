// TomsoFoot — matchs du jour via api-sports.io (API-Football v3).
// Filtre : Premier League + Ligue 1 (toutes) ; clubs Real Madrid, FC Barcelone,
// Atlético Madrid, Bayern Munich, Borussia Dortmund, RB Leipzig (toutes compétitions).
// 1 seul appel API par fenêtre de cache (Netlify Blobs) pour économiser le quota.
import { getStore } from "@netlify/blobs";

const KEY = process.env.APISPORTS_KEY;
const LEAGUES = new Set([39, 61]);                         // Premier League, Ligue 1
const TEAMS   = new Set([541, 529, 530, 157, 165, 173]);   // Real, Barça, Atlético, Bayern, Dortmund, Leipzig
const CACHE_MS = 20 * 60 * 1000;

const H = { "content-type": "application/json", "cache-control": "public, max-age=300" };

function parisDate() {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date()); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}
function parisTime(iso) {
  try { return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); }
  catch (e) { return ""; }
}

export default async () => {
  if (!KEY) return new Response(JSON.stringify({ error: "no_key", matches: [] }), { headers: H });

  const store = getStore("apisports-cache");
  const day = parisDate();
  const cacheKey = `fixtures:${day}`;

  try {
    const c = await store.get(cacheKey, { type: "json" });
    if (c && (Date.now() - c.ts) < CACHE_MS) {
      return new Response(JSON.stringify({ matches: c.matches, cached: true, day }), { headers: H });
    }
  } catch (e) {}

  let data;
  try {
    const url = `https://v3.football.api-sports.io/fixtures?date=${day}&timezone=Europe/Paris`;
    const r = await fetch(url, { headers: { "x-apisports-key": KEY } });
    data = await r.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "fetch_failed", matches: [] }), { headers: H });
  }

  // api-football renvoie { errors, response }. On expose errors pour le debug si besoin.
  const apiErrors = data && data.errors && (Array.isArray(data.errors) ? data.errors.length : Object.keys(data.errors).length) ? data.errors : null;
  const raw = (data && Array.isArray(data.response)) ? data.response : [];

  const matches = raw.filter(f => {
    const lid = f.league && f.league.id;
    const hid = f.teams && f.teams.home && f.teams.home.id;
    const aid = f.teams && f.teams.away && f.teams.away.id;
    return LEAGUES.has(lid) || TEAMS.has(hid) || TEAMS.has(aid);
  }).map(f => ({
    id: f.fixture && f.fixture.id,
    ts: f.fixture && f.fixture.date,
    time: parisTime(f.fixture && f.fixture.date),
    status: (f.fixture && f.fixture.status && f.fixture.status.short) || "NS",
    elapsed: (f.fixture && f.fixture.status && f.fixture.status.elapsed) || null,
    league: f.league && f.league.name,
    leagueLogo: f.league && f.league.logo,
    home: f.teams && f.teams.home && f.teams.home.name,
    homeLogo: f.teams && f.teams.home && f.teams.home.logo,
    away: f.teams && f.teams.away && f.teams.away.name,
    awayLogo: f.teams && f.teams.away && f.teams.away.logo,
    gh: f.goals && f.goals.home,
    ga: f.goals && f.goals.away
  })).sort((a, b) => String(a.ts).localeCompare(String(b.ts)));

  try { await store.setJSON(cacheKey, { ts: Date.now(), matches }); } catch (e) {}

  return new Response(JSON.stringify({ matches, cached: false, day, apiErrors }), { headers: H });
};
