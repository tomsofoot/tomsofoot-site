// netlify/functions/save-accueil.mjs
// Enregistre le contenu de l'accueil (contenu.json) depuis l'éditeur régie.
// SÉCURITÉ :
//  - Le jeton GitHub (écriture) est lu depuis process.env.GITHUB_TOKEN, JAMAIS
//    exposé au navigateur (variable d'environnement Netlify).
//  - L'accès est réservé à l'ADMIN : on vérifie le jeton Supabase de l'appelant
//    via la fonction is_current_user_admin() (même contrôle que les régies).
//  - Aucune clé service_role côté client.

const SUPABASE_URL = 'https://yubndvqmglttlntkugzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_8x7te6dRypwXn_vR5hyf9A_rh6h-JBZ';
const REPO = 'tomsofoot/tomsofoot-site';
const FILE = 'contenu.json';
const BRANCH = 'main';

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' } });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body;
  try { body = await req.json(); } catch (_) { return json(400, { error: 'bad_json' }); }
  const { contenu, accessToken } = body || {};
  if (!accessToken) return json(401, { error: 'no_token' });
  if (!contenu || typeof contenu !== 'object' || Array.isArray(contenu)) return json(400, { error: 'no_contenu' });

  // 1) Vérifier que l'appelant est administrateur (Supabase RPC).
  let isAdmin = false;
  try {
    const adminRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_current_user_admin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON, authorization: 'Bearer ' + accessToken },
      body: '{}',
    });
    if (adminRes.ok) { const v = await adminRes.json(); isAdmin = v === true; }
  } catch (_) { isAdmin = false; }
  if (!isAdmin) return json(403, { error: 'not_admin' });

  // 2) Écrire contenu.json dans le dépôt via l'API GitHub (jeton serveur).
  const GH = process.env.GITHUB_TOKEN;
  if (!GH) return json(500, { error: 'server_not_configured', hint: 'Définir GITHUB_TOKEN dans les variables Netlify.' });

  const api = `https://api.github.com/repos/${REPO}/contents/${FILE}`;
  const ghHeaders = { authorization: 'Bearer ' + GH, accept: 'application/vnd.github+json', 'user-agent': 'tomsofoot-regie', 'x-github-api-version': '2022-11-28' };

  let sha;
  try {
    const cur = await fetch(`${api}?ref=${BRANCH}`, { headers: ghHeaders });
    if (cur.ok) sha = (await cur.json()).sha;
  } catch (_) {}

  const encoded = Buffer.from(JSON.stringify(contenu, null, 2) + '\n', 'utf8').toString('base64');
  try {
    const put = await fetch(api, {
      method: 'PUT',
      headers: { ...ghHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Régie accueil : mise à jour du contenu (contenu.json)', content: encoded, sha, branch: BRANCH }),
    });
    if (!put.ok) return json(502, { error: 'github_error', detail: (await put.text()).slice(0, 300) });
    const out = await put.json();
    return json(200, { ok: true, commit: out?.commit?.sha || null });
  } catch (err) {
    return json(502, { error: 'github_exception', detail: String(err).slice(0, 200) });
  }
};
