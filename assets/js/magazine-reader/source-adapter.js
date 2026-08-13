// source-adapter.js — résout une édition (slug) vers ses métadonnées + URL de PDF.
// Source PRINCIPALE : publications.json du dépôt (servi par Netlify, cache CDN).
// Un adaptateur Supabase est prévu (voir resolveViaSupabase) mais désactivé par
// défaut, conformément au choix "dépôt/Netlify maintenant".
import { ReaderError } from './pdf-loader.js';

const REGISTRY_URL = new URL('../../../publications.json', import.meta.url);

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
  const legacyPdf = params.get('pdf');

  if (slug) {
    const all = await loadRegistry();
    const found = all.map(normalizePub).find((p) => p.slug === slug);
    if (!found) throw new ReaderError('not_found', 'Cette publication n\'existe pas.');
    if (!isPubliclyVisible(all.find((p) => p.slug === slug))) {
      throw new ReaderError('unavailable', 'Cette publication n\'est pas encore disponible.');
    }
    return found;
  }

  if (legacyPdf) {
    // Lien historique : on ouvre le PDF tel quel, sans métadonnées de régie.
    return normalizePub({
      slug: 'lien-direct',
      title: 'Journal TomsoFoot',
      pdf_url: legacyPdf,
      pdf_version: 'v1',
      status: 'published',
      download_enabled: true,
    });
  }

  const featured = await getFeatured();
  if (!featured) throw new ReaderError('not_found', 'Aucune publication disponible.');
  return featured;
}

// --- Hook Supabase (désactivé par défaut) --------------------------------
// À activer si le site passe en stockage Supabase (voir supabase/migrations).
// N'utilise QUE la clé anon (jamais service_role). Pour un bucket privé,
// remplacer par un appel à une Edge Function qui renvoie une URL signée.
export async function resolveViaSupabase(/* slug, { supabaseUrl, anonKey } */) {
  throw new ReaderError('unsupported', 'Adaptateur Supabase non activé (mode dépôt/Netlify).');
}
