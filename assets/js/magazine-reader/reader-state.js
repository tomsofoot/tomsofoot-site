// reader-state.js — mémorise localement l'état de lecture par publication.
// Clé liée au slug ET à la version du PDF (pour ne pas reprendre à une page qui
// n'existe plus après remplacement). Rien n'est envoyé au serveur.
const PREFIX = 'tsf-reader:';

function keyFor(slug, version) {
  return PREFIX + encodeURIComponent(slug || 'default') + ':' + encodeURIComponent(version || 'v1');
}

export function loadState(slug, version) {
  try {
    const raw = localStorage.getItem(keyFor(slug, version));
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (typeof s !== 'object' || s === null) return null;
    return {
      page: Number.isFinite(s.page) ? s.page : 1,
      zoom: Number.isFinite(s.zoom) ? s.zoom : 1,
      thumbsOpen: !!s.thumbsOpen,
      updatedAt: s.updatedAt || 0,
    };
  } catch (_) {
    return null; // localStorage indisponible (mode privé strict) : dégradation silencieuse
  }
}

export function saveState(slug, version, patch) {
  try {
    const prev = loadState(slug, version) || {};
    const next = { ...prev, ...patch, updatedAt: Date.now() };
    localStorage.setItem(keyFor(slug, version), JSON.stringify(next));
  } catch (_) {
    /* ignore */
  }
}

export function clearState(slug, version) {
  try { localStorage.removeItem(keyFor(slug, version)); } catch (_) {}
}
