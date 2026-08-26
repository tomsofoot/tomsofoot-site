/**
 * /.netlify/functions/youtube-documentaries
 * Source unique : la playlist publique « Documentaires » de la chaîne TomsoFoot.
 * - récupère TOUTES les vidéos de la playlist (pagination playlistItems.list) ;
 * - complète via videos.list (snippet, contentDetails, statistics, status) par lots de 50 ;
 * - exclut les vidéos non publiques / indisponibles / non intégrables ;
 * - trie par nombre de vues réel (statistics.viewCount) décroissant ;
 *   égalité -> plus récente d'abord, puis videoId (départage déterministe) ;
 * - formate vues (fr) et durée (ISO 8601 -> fr) ;
 * - cache CDN 6 h + repli sur le dernier jeu valide en cas de panne API.
 * La clé YOUTUBE_API_KEY reste STRICTEMENT côté serveur : jamais renvoyée, jamais loggée.
 */

const API_KEY = process.env.YOUTUBE_API_KEY;
const PLAYLIST_ID = process.env.YOUTUBE_DOCUMENTARIES_PLAYLIST_ID;
const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || null;
const API = "https://www.googleapis.com/youtube/v3";
const SIX_HOURS = 6 * 60 * 60; // secondes

// Repli en mémoire (dernier jeu valide, tant que l'instance est chaude)
let LAST_GOOD = null; // { generatedAt, ...payload }

function json(statusCode, payload, cacheSeconds) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (cacheSeconds) {
    // Cache côté CDN Netlify ; sert la version périmée en cas d'erreur/pendant la revalidation.
    headers["Netlify-CDN-Cache-Control"] =
      `public, max-age=${cacheSeconds}, stale-while-revalidate=86400, stale-if-error=604800`;
    headers["Cache-Control"] = "public, max-age=0, must-revalidate";
  }
  return { statusCode, headers, body: JSON.stringify(payload) };
}

async function yt(path, params) {
  const url = new URL(API + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("key", API_KEY);
  const r = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!r.ok) {
    // Ne jamais exposer l'URL (elle contient la clé) dans le message d'erreur.
    const e = new Error(`YouTube API ${path} -> HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

async function fetchAllPlaylistVideoIds() {
  const ids = [];
  let pageToken = "";
  do {
    const data = await yt("/playlistItems", {
      part: "contentDetails,status",
      playlistId: PLAYLIST_ID,
      maxResults: "50",
      ...(pageToken ? { pageToken } : {})
    });
    for (const it of data.items || []) {
      const vid = it.contentDetails?.videoId;
      if (vid) ids.push(vid);
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return ids;
}

async function fetchVideos(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const data = await yt("/videos", {
      part: "snippet,contentDetails,statistics,status",
      id: batch.join(","),
      maxResults: "50"
    });
    out.push(...(data.items || []));
  }
  return out;
}

function pickThumb(thumbs = {}) {
  const order = ["maxres", "standard", "high", "medium", "default"];
  for (const k of order) if (thumbs[k]?.url) return thumbs[k].url;
  return null;
}

// Durée ISO 8601 -> français : PT24M18S -> "24 min" ; PT1H08M -> "1 h 08 min"
function formatDuration(iso) {
  if (!iso) return null;
  const m = iso.match(/P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!m) return null;
  const h = parseInt(m[1] || "0", 10);
  const min = parseInt(m[2] || "0", 10);
  if (h > 0) return `${h} h ${String(min).padStart(2, "0")} min`;
  return `${min} min`;
}

// Vues -> français : 984 vues ; 12,4 k vues ; 523 k vues ; 1,2 M vues
function formatViews(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const trim = (x) => {
    const s = (Math.round(x * 10) / 10).toString().replace(".", ",");
    return s.endsWith(",0") ? s.slice(0, -2) : s;
  };
  if (v < 1000) return `${v} vue${v > 1 ? "s" : ""}`;
  if (v < 1_000_000) return `${trim(v / 1000)} k vues`;
  return `${trim(v / 1_000_000)} M vues`;
}

function isDisplayable(v) {
  const st = v.status || {};
  if (st.privacyStatus && st.privacyStatus !== "public") return false;
  if (st.uploadStatus && st.uploadStatus !== "processed") return false;
  if (st.embeddable === false) return false;
  if (!v.contentDetails?.duration) return false;
  return true;
}

async function build() {
  const ids = await fetchAllPlaylistVideoIds();
  const raw = await fetchVideos(ids);
  const videos = raw
    .filter(isDisplayable)
    .map((v) => ({
      id: v.id,
      title: v.snippet?.title || "",
      publishedAt: v.snippet?.publishedAt || null,
      thumbnail: pickThumb(v.snippet?.thumbnails),
      url: `https://www.youtube.com/watch?v=${v.id}`,
      viewCount: Number(v.statistics?.viewCount || 0),
      views: formatViews(v.statistics?.viewCount || 0),
      duration: formatDuration(v.contentDetails?.duration),
      durationIso: v.contentDetails?.duration || null
    }))
    .sort((a, b) => {
      if (b.viewCount !== a.viewCount) return b.viewCount - a.viewCount; // vues desc
      const da = new Date(a.publishedAt || 0).getTime();
      const db = new Date(b.publishedAt || 0).getTime();
      if (db !== da) return db - da; // plus récente d'abord
      return String(a.id).localeCompare(String(b.id)); // départage déterministe
    });

  return {
    ok: true,
    source: "youtube-playlist",
    channelId: CHANNEL_ID,
    playlistId: PLAYLIST_ID,
    total: videos.length,
    generatedAt: new Date().toISOString(),
    videos
  };
}

export async function handler() {
  if (!API_KEY || !PLAYLIST_ID) {
    // Configuration absente : si on a un dernier jeu valide, on le sert, sinon 500 propre.
    if (LAST_GOOD) return json(200, { ...LAST_GOOD, stale: true, reason: "config-missing" }, SIX_HOURS);
    return json(500, {
      ok: false,
      error: "Configuration serveur incomplète (YOUTUBE_API_KEY / YOUTUBE_DOCUMENTARIES_PLAYLIST_ID)."
    });
  }
  try {
    const payload = await build();
    LAST_GOOD = payload; // mémorise le dernier jeu valide pour le repli
    return json(200, payload, SIX_HOURS);
  } catch (err) {
    // Repli : ne jamais faire disparaître la section à cause d'une panne API.
    if (LAST_GOOD) {
      return json(200, { ...LAST_GOOD, stale: true, reason: "api-error" }, SIX_HOURS);
    }
    return json(502, { ok: false, error: "Indisponibilité temporaire de l'API YouTube." });
  }
}
