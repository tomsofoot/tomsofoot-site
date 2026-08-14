// source-adapter.js — résout une édition (slug) vers ses métadonnées + URL de PDF.
// Source PRINCIPALE : publications.json du dépôt (servi par Netlify, cache CDN).
// Un adaptateur Supabase est prévu (voir resolveViaSupabase) mais désactivé par
// défaut, conformément au choix "dépôt/Netlify maintenant".
import { ReaderError } from './pdf-loader.js';

const REGISTRY_URL = new URL('../../../publications.json', import.meta.url);

// Identifiants publics Supabase (clé « publishable », sans danger côté client).
const SB_URL = 'https://yubndvqmglttlntkugzm.supabase.co';
const SB_KEY = 'sb_publishable_8x7te6dRypwXn_vR5hyf9A_rh6h-JBZ';

let _registryPromise = null;
export function loadRegistry() {
  if (!_registryPromise) {
    _registryPromise = fetch(REGISTRY_URL.href, { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new ReaderError('not_found', 'Registre des publications introuvable.');
        return r.json();
      })
      .then((data) => Array.isArray(data?.publications) ? data.publications : [])
      .catch((err) => { _registryPromise = null; throw err instanceof ReaderError ? err : new ReaderError('network', 'Registre indisponible.', err); });
  }
  return _registryPromise;
}

// Une publication est-elle visible publiquement ?
// - published / archived : visibles (archives incluses)
// - scheduled : visible seulement une fois la date atteinte
// - draft : jamais
export function isPubliclyVisible(pub, now = Date.now()) {
  if (!pub || !pub.slug) return false;
  const when = pub.published_at ? Date.parse(pub.published_at) : (pub.publication_date ? Date.parse(pub.publication_date) : 0);
  switch (pub.status) {
    case 'published': return !when || when <= now;
    case 'archived': return true;
    case 'scheduled': return !!when && when <= now;
    default: return false; // draft ou statut inconnu
  }
}

// Résout une URL de ressource par rapport à la RACINE du site (là où se trouve
// publications.json), et non par rapport à la page /magazine/lecteur.html.
function siteAbsolute(u) {
  if (!u) return '';
  try { return new URL(u, REGISTRY_URL).href; } catch (_) { return u; }
}

export function normalizePub(pub) {
  return {
    slug: pub.slug,
    title: pub.title || 'Journal TomsoFoot',
    subtitle: pub.subtitle || '',
    excerpt: pub.excerpt || '',
    // Type déclaré par la régie : 'journal' (paysage) ou 'article' (A4 portrait).
    // Le lecteur s'en sert pour NE JAMAIS interpréter un A4 comme un journal.
    pubType: pub.pub_type || pub.kind || null,
    issueNumber: pub.issue_number ?? null,
    publicationDate: pub.publication_date || '',
    coverUrl: siteAbsolute(pub.cover_url),
    thumbnailUrl: siteAbsolute(pub.thumbnail_url || pub.cover_url),
    pdfUrl: siteAbsolute(pub.pdf_url),
    pdfVersion: pub.pdf_version || 'v1',
    pageCount: pub.page_count ?? null,
    featured: !!pub.featured,
    downloadEnabled: pub.download_enabled !== false,
    altText: pub.alt_text || pub.title || 'Couverture du journal',
    status: pub.status || 'published',
  };
}

// Liste publique triée (plus récent d'abord).
export async function listVisible() {
  const all = await loadRegistry();
  return all
    .filter((p) => isPubliclyVisible(p))
    .map(normalizePub)
    .sort((a, b) => (Date.parse(b.publicationDate || 0) - Date.parse(a.publicationDate || 0)));
}

// Publication mise à la une : featured visible, sinon la plus récente visible.
export async function getFeatured() {
  const visible = await listVisible();
  return visible.find((p) => p.featured) || visible[0] || null;
}

// Résolution d'une édition à partir des paramètres d'URL.
// - ?edition=slug  -> publication précise
// - ?pdf=chemin    -> compatibilité avec les anciens liens (lecteur historique)
// - rien           -> publication à la une
export async function resolveFromLocation(search = location.search) {
  const params = new URLSearchParams(search);
  const slug = params.get('edition');
  const directPdf = params.get('pdf');

  if (slug) {
    // 1) Supabase (numéros récents) : PDF privé + URL signée temporaire.
    const viaSb = await resolveViaSupabase(slug);
    if (viaSb) return viaSb;
    // 2) Repli : registre statique publications.json (anciens numéros).
    const all = await loadRegistry();
    const rec = all.find((p) => p.slug === slug);
    if (rec && isPubliclyVisible(rec)) return normalizePub(rec);
    throw new ReaderError('not_found', 'Cette publication n\'existe pas ou n\'est pas disponible.');
  }

  if (directPdf) {
    // Lien direct : ouvre un PDF donné (ex. prévisualisation d'un brouillon via
    // une URL signée fournie par la régie admin). Métadonnées facultatives en
    // paramètres pour afficher le bon titre / n° / nombre de pages / couverture.
    return normalizePub({
      slug: params.get('slug') || 'lien-direct',
      title: params.get('title') || 'Journal TomsoFoot',
      subtitle: params.get('subtitle') || '',
      pub_type: params.get('pubtype') || null,
      issue_number: params.get('issue') ? Number(params.get('issue')) : null,
      cover_url: params.get('cover') || '',
      page_count: params.get('pages') ? Number(params.get('pages')) : null,
      pdf_url: directPdf,
      pdf_version: 'v1',
      status: 'published',
      download_enabled: params.get('dl') !== '0',
    });
  }

  const featured = await getFeatured();
  if (!featured) throw new ReaderError('not_found', 'Aucune publication disponible.');
  return featured;
}

// --- Adaptateur Supabase (numéros publiés/archivés) ----------------------
// Récupère la fiche du numéro via l'API REST (clé anon, lecture publique des
// numéros visibles) puis demande au serveur Storage une URL SIGNÉE temporaire
// pour le PDF privé. La RLS n'autorise cette signature que pour un numéro
// réellement visible : un brouillon reste privé. Aucune clé service_role.
// Retourne null si le numéro est introuvable ou non visible (repli possible).
export async function resolveViaSupabase(slug) {
  if (!slug) return null;
  let row = null;
  try {
    const sel = 'slug,title,subtitle,excerpt,kind,issue_number,publication_date,published_at,status,cover_url,thumbnail_url,pdf_path,pdf_bucket,pdf_version,page_count,featured,download_enabled,alt_text';
    const r = await fetch(`${SB_URL}/rest/v1/publications?slug=eq.${encodeURIComponent(slug)}&select=${sel}&limit=1`,
      { headers: { apikey: SB_KEY, authorization: 'Bearer ' + SB_KEY }, cache: 'no-store' });
    if (!r.ok) return null;
    const rows = await r.json();
    row = Array.isArray(rows) ? rows[0] : null;
  } catch (_) { return null; }
  if (!row || !row.pdf_path) return null;

  let signed = '';
  try {
    const bucket = row.pdf_bucket || 'journaux';
    const s = await fetch(`${SB_URL}/storage/v1/object/sign/${bucket}/${row.pdf_path}`, {
      method: 'POST',
      headers: { apikey: SB_KEY, authorization: 'Bearer ' + SB_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    if (!s.ok) return null; // non visible → non signable (brouillon privé)
    const j = await s.json();
    if (j && j.signedURL) signed = SB_URL + '/storage/v1' + j.signedURL;
  } catch (_) { return null; }
  if (!signed) return null;

  return {
    slug: row.slug,
    title: row.title || 'Journal TomsoFoot',
    subtitle: row.subtitle || '',
    excerpt: row.excerpt || '',
    pubType: row.kind || null,
    issueNumber: row.issue_number ?? null,
    publicationDate: row.publication_date || '',
    coverUrl: row.cover_url || '',
    thumbnailUrl: row.thumbnail_url || row.cover_url || '',
    pdfUrl: signed,
    pdfVersion: row.pdf_version || 'v1',
    pageCount: row.page_count ?? null,
    featured: !!row.featured,
    downloadEnabled: row.download_enabled !== false,
    altText: row.alt_text || row.title || 'Couverture du journal',
    status: row.status || 'published',
  };
}
