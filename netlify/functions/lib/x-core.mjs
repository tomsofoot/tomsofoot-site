// netlify/lib/x-core.mjs
// Cœur PARTAGÉ de l'automatisation X (Twitter). Importé par les fonctions Netlify.
// N'est PAS un point d'entrée HTTP (hors du dossier functions/). Aucun secret en dur.
//
// Sécurité :
//   * Jetons X chiffrés en base (AES-256-GCM, clé = X_TOKEN_ENC_KEY, jamais stockée en base).
//   * Accès base privilégié via SUPABASE_SERVICE_ROLE (server-only).
//   * Vérif admin via le jeton Supabase de l'appelant (is_current_user_admin).

import crypto from 'node:crypto';

export const SITE          = process.env.SITE_ORIGIN || 'https://tomsofoot.fr';
export const SUPABASE_URL  = process.env.SUPABASE_URL || 'https://yubndvqmglttlntkugzm.supabase.co';
export const SERVICE_ROLE  = process.env.SUPABASE_SERVICE_ROLE || '';
export const ANON          = process.env.SUPABASE_ANON || '';
export const DRY_RUN       = String(process.env.SOCIAL_DRY_RUN || 'true').toLowerCase() !== 'false'; // simulation par défaut
export const X_CLIENT_ID   = process.env.X_CLIENT_ID || '';
export const X_CLIENT_SECRET = process.env.X_CLIENT_SECRET || '';
export const X_SCOPES      = 'tweet.read tweet.write users.read media.write offline.access';
export const X_MAX_WEIGHT  = 280;
export const X_URL_WEIGHT  = 23;   // toute URL compte pour 23 (t.co), comme chez X

// ---------------------------------------------------------------------------
// Réponses HTTP
// ---------------------------------------------------------------------------
export function json(status, obj, extra) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(extra || {}) } });
}
export function redirect(url) { return new Response(null, { status: 302, headers: { location: url } }); }

// ---------------------------------------------------------------------------
// Chiffrement des jetons (AES-256-GCM). Format base64 : iv(12) | tag(16) | ciphertext.
// La clé de 32 octets est dérivée par SHA-256 de X_TOKEN_ENC_KEY (jamais en base).
// ---------------------------------------------------------------------------
function encKey() {
  const raw = process.env.X_TOKEN_ENC_KEY || '';
  if (!raw) throw new Error('X_TOKEN_ENC_KEY manquant');
  return crypto.createHash('sha256').update(raw, 'utf8').digest(); // 32 octets
}
export function encrypt(plain) {
  if (plain == null) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}
export function decrypt(b64) {
  if (!b64) return null;
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', encKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Supabase REST (service_role → contourne la RLS, server-only)
// ---------------------------------------------------------------------------
export async function sbAdmin(path, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: SERVICE_ROLE,
    authorization: 'Bearer ' + SERVICE_ROLE,
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (prefer) headers.prefer = prefer;
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  let data = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  if (!r.ok) { const e = new Error('supabase_' + r.status); e.status = r.status; e.data = data; throw e; }
  return data;
}
export async function rpcAdmin(fn, args) {
  return sbAdmin('rpc/' + fn, { method: 'POST', body: args || {} });
}

// ---------------------------------------------------------------------------
// Vérif admin : le jeton Supabase de l'appelant (régie) doit être administrateur.
// Renvoie { userId } ou lève une erreur { status:401|403 }.
// ---------------------------------------------------------------------------
export async function requireAdmin(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) { const e = new Error('no_token'); e.status = 401; throw e; }
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/is_current_user_admin', {
    method: 'POST',
    headers: { apikey: ANON || SERVICE_ROLE, authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: '{}',
  });
  const ok = r.ok && (await r.json().catch(() => false)) === true;
  if (!ok) { const e = new Error('not_admin'); e.status = 403; throw e; }
  return { token };
}

// ---------------------------------------------------------------------------
// Comptage PONDÉRÉ compatible X (pas un simple text.length)
//   * toute URL compte pour 23
//   * plage « poids 1 » de twitter-text (Latin, ponctuation courante) ; sinon poids 2
//     → emoji et CJK comptent pour 2, comme chez X.
// ---------------------------------------------------------------------------
const URL_RE = /\bhttps?:\/\/[^\s]+/gi;
function cpWeight(cp) {
  if ((cp >= 0 && cp <= 4351) || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247)) return 1;
  return 2;
}
export function weightedLength(text) {
  if (!text) return 0;
  const noUrls = String(text).replace(URL_RE, '');
  const urls = (String(text).match(URL_RE) || []).length;
  let w = 0;
  for (const ch of noUrls) w += cpWeight(ch.codePointAt(0));
  return w + urls * X_URL_WEIGHT;
}

// Tronque un texte à `maxWeight` SANS couper de mot, ajoute « … » si tronqué.
function trimWords(text, maxWeight) {
  if (!text) return { text: '', truncated: false };
  if (weightedLength(text) <= maxWeight) return { text, truncated: false };
  const budget = Math.max(0, maxWeight - 1); // réserve pour «…» (poids 1)
  const words = String(text).trim().split(/\s+/);
  let out = '';
  for (const word of words) {
    const candidate = out ? out + ' ' + word : word;
    if (weightedLength(candidate) > budget) break;
    out = candidate;
  }
  out = out.replace(/[\s,;:.!?–—-]+$/u, '');
  return { text: (out ? out + '…' : '…'), truncated: true };
}

// ---------------------------------------------------------------------------
// Construction du POST
//   Priorité : 1) URL intégrale  2) titre intégral  3) chapô raccourci proprement
//   Un article = un seul post.
// ---------------------------------------------------------------------------
export function buildPost({ title, deck, url }) {
  const HEADER = '🔴 NOUVEL ARTICLE';
  const CTA = 'Lire l\'article 👇';
  title = (title || '').trim();
  deck = (deck || '').trim();
  url = (url || '').trim();

  // Coût fixe : header + titre(placeholder) + CTA + url, séparés par des sauts de ligne.
  const fixedNoTitleNoDeck = weightedLength(HEADER) + weightedLength(CTA) + weightedLength(url) + 3 /* 3 sauts de ligne */;
  let budgetTitle = X_MAX_WEIGHT - fixedNoTitleNoDeck;

  // 2) titre : intégral si possible, sinon tronqué proprement (priorité sur le chapô)
  let outTitle = title;
  if (weightedLength(title) > budgetTitle) {
    outTitle = trimWords(title, budgetTitle).text;
    deck = ''; // plus de place pour le chapô
  }

  // 3) chapô : occupe le reste, tronqué sans couper de mot
  let outDeck = '';
  if (deck) {
    const used = weightedLength(HEADER) + weightedLength(outTitle) + weightedLength(CTA) + weightedLength(url) + 4; // +1 saut pour le chapô
    const remaining = X_MAX_WEIGHT - used;
    if (remaining >= 12) { // n'affiche un chapô que s'il reste une place utile
      outDeck = trimWords(deck, remaining).text;
    }
  }

  const lines = [HEADER, outTitle];
  if (outDeck) lines.push(outDeck);
  lines.push(CTA, url);
  const text = lines.join('\n');
  return { text, weighted: weightedLength(text), max: X_MAX_WEIGHT, titleTruncated: outTitle !== title, deckTruncated: !!deck && outDeck !== deck };
}

// ---------------------------------------------------------------------------
// URL canonique publique d'un article (jamais un Deploy Preview / admin)
// ---------------------------------------------------------------------------
export function canonicalUrl(slug) { return SITE.replace(/\/+$/, '') + '/articles/' + slug; }

// Image sociale officielle de repli (si l'image principale est indisponible).
export const FALLBACK_SOCIAL_IMAGE = SITE.replace(/\/+$/, '') + '/images/tomsofoot-home-master.png';

// ---------------------------------------------------------------------------
// Appels API X — utilisés UNIQUEMENT hors DRY RUN (jamais en simulation)
// ---------------------------------------------------------------------------
export async function xRefreshToken(refreshToken) {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: X_CLIENT_ID });
  const basic = Buffer.from(X_CLIENT_ID + ':' + X_CLIENT_SECRET).toString('base64');
  const r = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + basic },
    body,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error('x_refresh_failed'); e.status = r.status; e.data = d; throw e; }
  return d; // { access_token, refresh_token?, expires_in, scope }
}

export async function xUploadMedia(accessToken, imageBytes, mime) {
  // Upload média v2 (image). Requiert le scope media.write.
  const form = new FormData();
  form.append('media', new Blob([imageBytes], { type: mime || 'image/jpeg' }));
  form.append('media_category', 'tweet_image');
  const r = await fetch('https://api.x.com/2/media/upload', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + accessToken },
    body: form,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error('x_media_failed'); e.status = r.status; e.data = d; throw e; }
  return d.id || d.media_id_string || (d.data && d.data.id);
}

export async function xCreatePost(accessToken, text, mediaId, altText) {
  const payload = { text };
  if (mediaId) {
    payload.media = { media_ids: [String(mediaId)] };
    if (altText) payload.media.tagged_user_ids = undefined;
  }
  const r = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + accessToken, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error('x_post_failed'); e.status = r.status; e.data = d; throw e; }
  return d.data; // { id, text }
}
