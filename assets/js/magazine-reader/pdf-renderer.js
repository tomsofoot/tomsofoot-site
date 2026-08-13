// pdf-renderer.js — rend une "feuille" (page entière = double page, ou moitié
// gauche/droite sur mobile) sur un <canvas> à la résolution correcte de l'écran
// et du zoom, JAMAIS par étirement CSS. Ajoute la couche texte PDF.js
// sélectionnable, alignée sur le canvas. Annule proprement un rendu en cours.
import { pdfjsLib, ReaderError } from './pdf-loader.js';

// Cache des objets page PDF.js (getPage est coûteux).
const pageCache = new Map();
export async function getPage(pdf, pageNumber) {
  const key = pageNumber;
  if (pageCache.has(key)) return pageCache.get(key);
  const p = pdf.getPage(pageNumber);
  pageCache.set(key, p);
  return p;
}
export function clearPageCache() { pageCache.clear(); }

// Densité de pixels effective, bornée pour éviter des canvases démesurés.
export function currentDpr() {
  return Math.min(3, Math.max(1, window.devicePixelRatio || 1));
}

// Calcule l'échelle d'affichage (CSS px par unité PDF) pour remplir targetCssW.
// half: 'full' | 'left' | 'right'. Pour une moitié, la page entière fait 2×.
function displayScaleFor(baseViewport, targetCssW, half) {
  const pageUnitsWidth = half === 'full' ? baseViewport.width : baseViewport.width / 2;
  return targetCssW / pageUnitsWidth;
}

// Dimensions CSS d'une feuille pour une largeur cible donnée.
export function leafCssSize(baseViewport, targetCssW, half) {
  const scale = displayScaleFor(baseViewport, targetCssW, half);
  const fullH = baseViewport.height * scale;
  const cssW = half === 'full' ? baseViewport.width * scale : (baseViewport.width / 2) * scale;
  return { width: Math.round(cssW), height: Math.round(fullH), scale };
}

// Rendu d'une feuille. Retourne un objet { cancel() } et une promesse.
// Applique EXACTEMENT le principe HiDPI de la spécification (section 7).
// - targetCssW : largeur d'affichage CSS de la feuille (mise en page par StPageFlip)
// - superSample : sur-échantillonnage pour le zoom. La taille CSS ne change pas
//   (StPageFlip n'est pas perturbé) ; seule la résolution interne du canvas
//   augmente, ce qui garde le texte/les images nets quand le livre est agrandi
//   par transformation CSS. Au repos, on re-rend au bon superSample.
export function renderLeaf({ page, half, targetCssW, superSample = 1, canvas, textLayerDiv }) {
  const dpr = currentDpr();
  const base = page.getViewport({ scale: 1 });
  const displayScale = displayScaleFor(base, targetCssW, half);

  // offsetX : décale la page pour n'afficher que la moitié voulue.
  const halfCssW = (base.width / 2) * displayScale;
  const offsetX = half === 'right' ? -halfCssW : 0;

  // Viewport en pixels CSS (utilisé aussi par la couche texte).
  const cssViewport = page.getViewport({ scale: displayScale, offsetX, offsetY: 0 });

  const cssW = half === 'full' ? cssViewport.width : Math.round((base.width / 2) * displayScale);
  const cssH = cssViewport.height;

  const outputScale = dpr * Math.max(1, superSample);
  canvas.width = Math.floor(cssW * outputScale);
  canvas.height = Math.floor(cssH * outputScale);
  canvas.style.width = Math.floor(cssW) + 'px';
  canvas.style.height = Math.floor(cssH) + 'px';

  const ctx = canvas.getContext('2d', { alpha: false });
  const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

  let cancelled = false;
  let renderTask = null;

  const promise = (async () => {
    // Fond papier pour éviter tout flash transparent.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fbfaf6';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    try {
      renderTask = page.render({ canvasContext: ctx, viewport: cssViewport, transform });
      await renderTask.promise;
    } catch (err) {
      if (err?.name === 'RenderingCancelledException' || cancelled) return { cancelled: true };
      throw new ReaderError('render', 'Échec du rendu d\'une page.', err);
    }
    if (cancelled) return { cancelled: true };

    // Couche texte (sélectionnable) si demandée et si la page contient du texte.
    if (textLayerDiv) {
      await renderTextLayer(page, textLayerDiv, cssViewport, cssW, cssH, () => cancelled);
    }
    return { cancelled: false, cssW: Math.floor(cssW), cssH: Math.floor(cssH) };
  })();

  return {
    promise,
    cancel() {
      cancelled = true;
      try { renderTask?.cancel(); } catch (_) {}
    },
  };
}

async function renderTextLayer(page, container, cssViewport, cssW, cssH, isCancelled) {
  container.textContent = '';
  container.style.width = Math.floor(cssW) + 'px';
  container.style.height = Math.floor(cssH) + 'px';
  container.style.setProperty('--scale-factor', String(cssViewport.scale));

  let textContent;
  try {
    textContent = await page.getTextContent();
  } catch (_) {
    return; // pas de texte exploitable : on laisse la page image seule
  }
  if (isCancelled()) return;
  if (!textContent || !textContent.items || textContent.items.length === 0) return;

  try {
    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: textContent,
      container,
      viewport: cssViewport,
    });
    await textLayer.render();
  } catch (_) {
    // La couche texte est un plus ; son échec ne casse pas la lecture.
    container.textContent = '';
  }
}

// Indique si une page contient du vrai texte (pour signaler un PDF rasterisé).
export async function pageHasText(page) {
  try {
    const tc = await page.getTextContent();
    return !!(tc && tc.items && tc.items.some((i) => (i.str || '').trim().length));
  } catch (_) {
    return false;
  }
}
