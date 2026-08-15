// netlify/functions/lt-check.mjs
// Proxy serveur pour LanguageTool (correction orthographe/grammaire/ponctuation FR).
//
// PRINCIPES (cf. cahier des charges Thomas) :
//  - AUCUNE clé API exposée au navigateur. La clé premium éventuelle reste
//    côté serveur dans process.env.LT_API_KEY / LT_USERNAME (facultatif).
//  - Passage 100 % côté serveur : le navigateur n'appelle jamais LanguageTool
//    directement, il appelle CETTE fonction.
//  - Correction NON destructive : renvoie seulement des suggestions ; n'altère rien.
//  - Ne bloque JAMAIS l'enregistrement/publication : en cas d'indisponibilité,
//    renvoie { available:false, matches:[] } avec un code 200, jamais une erreur dure.
//  - Réservé aux administrateurs connectés (vérif. is_current_user_admin via le
//    Bearer token du navigateur) pour éviter tout abus du proxy.
//
// Entrée  (POST JSON) : { text: string, language?: 'fr' (défaut) }
// Sortie  (200 JSON)  : { available: boolean, matches: [...], language, note? }

const SUPABASE_URL  = process.env.SUPABASE_URL  || 'https://yubndvqmglttlntkugzm.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON || 'sb_publishable_8x7te6dRypwXn_vR5hyf9A_rh6h-JBZ';
// Endpoint LanguageTool : par défaut l'API publique gratuite ; surchargée par env pour un serveur dédié/premium.
const LT_ENDPOINT   = process.env.LT_ENDPOINT   || 'https://api.languagetool.org/v2/check';
const LT_API_KEY    = process.env.LT_API_KEY    || '';   // premium (facultatif) — jamais renvoyé au client
const LT_USERNAME   = process.env.LT_USERNAME   || '';   // premium (facultatif)
const MAX_CHARS     = 40000;                              // garde-fou anti-abus / limites API

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

async function isAdmin(req) {
  const auth = req.headers.get('authorization') || '';
  if (!/^Bearer\s+/i.test(auth)) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_current_user_admin`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON, 'authorization': auth, 'content-type': 'application/json' },
      body: '{}'
    });
    if (!r.ok) return false;
    return (await r.json()) === true;
  } catch { return false; }
}

export default async (req) => {
  if (req.method !== 'POST') return json({ available: false, matches: [], note: 'method_not_allowed' }, 405);

  // Réservé admin — le proxy ne doit pas être ouvert à tous.
  if (!(await isAdmin(req))) return json({ available: false, matches: [], note: 'not_admin' }, 200);

  let body;
  try { body = await req.json(); } catch { return json({ available: false, matches: [], note: 'bad_json' }, 200); }
  let text = (body && typeof body.text === 'string') ? body.text : '';
  const language = (body && body.language) || 'fr';
  if (!text.trim()) return json({ available: true, matches: [], language });
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);

  // Appel LanguageTool côté serveur, avec timeout : jamais bloquant.
  const params = new URLSearchParams();
  params.set('text', text);
  params.set('language', language);
  params.set('level', 'picky');       // ponctuation, accords, répétitions, typographie FR
  params.set('enabledCategories', 'TYPOS,GRAMMAR,PUNCTUATION,TYPOGRAPHY,CASING,REDUNDANCY,STYLE,MISC');
  if (LT_API_KEY && LT_USERNAME) { params.set('apiKey', LT_API_KEY); params.set('username', LT_USERNAME); }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(LT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'accept': 'application/json' },
      body: params.toString(),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!r.ok) return json({ available: false, matches: [], language, note: 'lt_http_' + r.status });
    const data = await r.json();
    // On ne renvoie que le strict nécessaire, aucune donnée serveur/clé.
    const matches = (data.matches || []).map(m => ({
      offset: m.offset,
      length: m.length,
      message: m.message,
      shortMessage: m.shortMessage || '',
      category: (m.rule && m.rule.category && m.rule.category.name) || '',
      ruleId: (m.rule && m.rule.id) || '',
      issueType: (m.rule && m.rule.issueType) || '',
      replacements: (m.replacements || []).slice(0, 6).map(x => x.value),
      context: m.context ? { text: m.context.text, offset: m.context.offset, length: m.context.length } : null
    }));
    return json({ available: true, language, matches });
  } catch (e) {
    clearTimeout(timer);
    // Indisponible (timeout, réseau, quota) → n'empêche RIEN côté éditeur.
    return json({ available: false, matches: [], language, note: 'lt_unavailable' });
  }
};
