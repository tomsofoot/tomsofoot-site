// netlify/functions/next-up.mjs
// Source dynamique COMMUNE du pop-up « Prolongez l'expérience ».
// Renvoie : date du jour (Europe/Paris), dernier article PUBLIÉ, dernière vidéo YouTube.
//   * Article : vue `articles_public` filtrée `status=published` (jamais brouillon /
//     aperçu / programmé non échu / archivé). Tri par published_at décroissant, 1er résultat.
//   * Vidéo : flux RSS officiel de la chaîne ; repli « Vidéo mise en avant » de la régie
//     (site_content.accueil.featuredVideo) si la récupération auto échoue.
// Aucun secret exposé : seule la clé anon (publique) est utilisée. Cache CDN court.

const SUPABASE_URL  = process.env.SUPABASE_URL  || 'https://yubndvqmglttlntkugzm.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON || 'sb_publishable_8x7te6dRypwXn_vR5hyf9A_rh6h-JBZ';
const YT_CHANNEL    = process.env.YOUTUBE_CHANNEL_ID || '';

function json(status, obj, cache) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cache || 'public, max-age=120, s-maxage=600, stale-while-revalidate=3600'
    }
  });
}
async function sb(path) {
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
      headers: { apikey: SUPABASE_ANON, authorization: 'Bearer ' + SUPABASE_ANON, accept: 'application/json' }
    });
    if (!r.ok) return null;
    return r.json();
  } catch (e) { return null; }
}
function parisDate() {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}
function fmtDate(iso) {
  if (!iso) return '';
  try { return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' }).format(new Date(iso)); }
  catch (e) { return ''; }
}

/* ---------------- Dernier article publié ---------------- */
async function latestArticle() {
  // La vue articles_public n'expose que archivé + publié(échu) ; on force status=published.
  const rows = await sb('articles_public?select=slug,title,hero_image,hero_alt,reading_time,published_at,competition_id,genre_id&status=eq.published&order=published_at.desc.nullslast&limit=1');
  if (!rows || !rows.length) return null;
  const a = rows[0];
  if (!a || !a.slug) return null;

  // Catégorie (surtitre) : label compétition · genre.
  let category = '';
  try {
    const ids = [];
    if (a.competition_id) ids.push(['competitions', a.competition_id]);
    if (a.genre_id) ids.push(['editorial_genres', a.genre_id]);
    const labels = await Promise.all(ids.map(([t, id]) => sb(t + '?select=label_fr&id=eq.' + encodeURIComponent(id))));
    category = labels.map(l => (l && l[0] && l[0].label_fr) || '').filter(Boolean).join(' · ');
  } catch (e) {}

  return {
    title: a.title || '',
    url: '/articles/' + a.slug,
    slug: a.slug,
    image: a.hero_image || '',
    alt: a.hero_alt || a.title || '',
    category: category || 'Article',
    readingTime: a.reading_time || null,
    publishedAt: a.published_at || null,
    dateLabel: fmtDate(a.published_at)
  };
}

/* ---------------- Dernière vidéo YouTube ---------------- */
function decodeXml(v = '') {
  return v.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
}
function tag(xml, name) {
  const t = name.replace(':', '\\:');
  const m = xml.match(new RegExp('<' + t + '(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</' + t + '>', 'i'));
  return decodeXml((m && m[1] ? m[1] : '').trim());
}
function fmtDuration(s) {
  s = Number(s); if (!Number.isFinite(s) || s <= 0) return null;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60), p = n => String(n).padStart(2, '0');
  return h > 0 ? h + ':' + p(m) + ':' + p(sec) : m + ':' + p(sec);
}
async function ytDuration(id) {
  try {
    const r = await fetch('https://www.youtube.com/watch?v=' + id + '&hl=en&gl=US', { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US,en;q=0.9' } });
    if (!r.ok) return null;
    const html = await r.text();
    const d = html.match(/"lengthSeconds":\s*"(\d+)"/);
    return d ? Number(d[1]) : null;
  } catch (e) { return null; }
}
async function latestVideoAuto() {
  if (!YT_CHANNEL) return null;
  try {
    const r = await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + YT_CHANNEL, { headers: { 'User-Agent': 'TomsoFoot/1.0' } });
    if (!r.ok) return null;
    const xml = await r.text();
    const entry = (xml.match(/<entry>([\s\S]*?)<\/entry>/i) || [])[1];
    if (!entry) return null;
    const id = tag(entry, 'yt:videoId'), title = tag(entry, 'title'), published = tag(entry, 'published');
    if (!id || !title) return null;
    const durationSeconds = await ytDuration(id);
    return {
      id, title,
      url: 'https://www.youtube.com/watch?v=' + id,
      thumbnail: 'https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg',
      fallbackThumbnail: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg',
      duration: fmtDuration(durationSeconds),
      publishedAt: published || null,
      source: 'youtube'
    };
  } catch (e) { return null; }
}
// Repli régie : site_content.accueil.featuredVideo = { url|id, title, thumbnail?, duration? }
async function featuredVideoFallback() {
  const rows = await sb('site_content?select=data&key=eq.accueil&limit=1');
  const fv = rows && rows[0] && rows[0].data && rows[0].data.featuredVideo;
  if (!fv || (!fv.url && !fv.id)) return null;
  let id = fv.id || '';
  if (!id && fv.url) { const m = String(fv.url).match(/(?:v=|youtu\.be\/|embed\/)([\w-]{6,})/); if (m) id = m[1]; }
  return {
    id: id || null,
    title: fv.title || 'À voir sur la chaîne',
    url: fv.url || (id ? 'https://www.youtube.com/watch?v=' + id : '#'),
    thumbnail: fv.thumbnail || (id ? 'https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg' : ''),
    duration: fv.duration || null,
    source: 'regie'
  };
}
async function latestVideo() {
  const auto = await latestVideoAuto();
  if (auto) return auto;
  return featuredVideoFallback();  // secours uniquement si l'auto échoue
}

export default async () => {
  try {
    const [article, video] = await Promise.all([latestArticle(), latestVideo()]);
    return json(200, {
      currentDate: parisDate(),
      latestPublishedArticle: article,     // null -> carte article masquée côté client
      latestPublishedVideo: video          // null -> carte vidéo masquée côté client
    });
  } catch (e) {
    return json(200, { currentDate: parisDate(), latestPublishedArticle: null, latestPublishedVideo: null }, 'no-store');
  }
};
