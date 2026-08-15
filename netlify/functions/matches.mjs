// TomsoFoot — matchs via api-sports.io (API-Football v3).
// Filtre : Premier League + Ligue 1 (toutes) ; clubs Real Madrid, FC Barcelone,
// Atlético Madrid, Bayern Munich, Borussia Dortmund, RB Leipzig (toutes compétitions).
// Affiche les matchs du jour ; quand il n'y a plus aucun match à venir aujourd'hui,
// bascule automatiquement sur les matchs de demain (J+1).
// 1 seul appel API par date et par fenêtre de cache (Netlify Blobs) pour économiser le quota.
import { getStore } from "@netlify/blobs";

const KEY = process.env.APISPORTS_KEY;
const LEAGUES = new Set([39, 61]);                         // Premier League, Ligue 1
const TEAMS   = new Set([541, 529, 530, 157, 165, 173]);   // Real, Barça, Atlético, Bayern, Dortmund, Leipzig
const CACHE_MS = 20 * 60 * 1000;

// statuts « à venir ou en cours » : tant qu'il en reste aujourd'hui, on reste sur aujourd'hui.
const UPCOMING = new Set(["TBD", "NS", "1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"]);
const FINISHED = new Set(["FT", "AET", "PEN"]);

const H = { "content-type": "application/json", "cache-control": "public, max-age=300" };

function parisDate(offsetDays) {
  const d = new Date();
  if (offsetDays) d.setUTCDate(d.getUTCDate() + offsetDays);
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(d); }
  catch (e) { return d.toISOString().slice(0, 10); }
}
function parisTime(iso) {
  try { return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); }
  catch (e) { return ""; }
}

// Récupère + filtre + normalise les matchs d'une date donnée, avec cache par date.
async function fetchDay(store, date) {
  const cacheKey = `fixtures:${date}`;
  try {
    const c = await store.get(cacheKey, { type: "json" });
    if (c && (Date.now() - c.ts) < CACHE_MS) return { matches: c.matches, cached: true };
  } catch (e) {}

  let data;
  const url = `https://v3.football.api-sports.io/fixtures?date=${date}&timezone=Europe/Paris`;
  const r = await fetch(url, { headers: { "x-apisports-key": KEY } });
  data = await r.json();

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
  return { matches, cached: false };
}

export default async () => {
  if (!KEY) return new Response(JSON.stringify({ error: "no_key", matches: [], day: "today" }), { headers: H });

  const store = getStore("apisports-cache");
  const todayStr = parisDate(0);

  try {
    const today = await fetchDay(store, todayStr);
    // matchs du jour non terminés (à venir ou en cours)
    const liveOrUpcoming = today.matches.filter(m => UPCOMING.has(m.status));
    let shown = today.matches.filter(m => !FINISHED.has(m.status));
    let dayShown = "today";

    // Plus aucun match à venir aujourd'hui -> on bascule sur demain (J+1).
    if (liveOrUpcoming.length === 0) {
      const tmr = await fetchDay(store, parisDate(1));
      shown = tmr.matches.filter(m => !FINISHED.has(m.status));
      dayShown = "tomorrow";
    }

    shown = shown.map(m => ({ ...m, day: dayShown }));
    return new Response(JSON.stringify({ matches: shown, day: dayShown }), { headers: H });
  } catch (e) {
    return new Response(JSON.stringify({ error: "fetch_failed", matches: [], day: "today" }), { headers: H });
  }
};
