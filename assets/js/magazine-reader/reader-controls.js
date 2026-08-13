// reader-controls.js — barre d'outils, clavier, plein écran, zoom (avec re-rendu
// net au repos), miniatures, téléchargement. Isolé de la logique de rendu.
import { getPage, renderLeaf } from './pdf-renderer.js';

const ZOOM_MIN = 1, ZOOM_MAX = 3, ZOOM_STEP = 0.25;

export function initControls(ctx) {
  const { els, flipbook, publication, pdf, saveState, announcer, stageInner, stage } = ctx;
  let zoom = 1;
  let thumbsBuilt = false;

  // --- Compteur de pages ---------------------------------------------------
  function updateCounter(info) {
    const label = info.isSpread && info.magTo !== info.magFrom
      ? `${info.magFrom}–${info.magTo}` : `${info.magFrom}`;
    els.cur.textContent = label;
    els.tot.textContent = info.totalMag;
    els.prog.style.width = (info.magFrom / info.totalMag * 100) + '%';
    els.prev.disabled = info.atStart;
    els.next.disabled = info.atEnd;
    announcer?.announce(`Page ${label} sur ${info.totalMag}`);
    saveState?.({ page: info.leaf + 1 });
    // met à jour la miniature active
    if (els.thumbs) {
      els.thumbs.querySelectorAll('.mr-thumb').forEach((t) => t.classList.remove('is-active'));
      els.thumbs.querySelector(`.mr-thumb[data-leaf="${info.leaf}"]`)?.classList.add('is-active');
    }
  }
  ctx.updateCounter = updateCounter;

  // --- Navigation ----------------------------------------------------------
  els.prev.addEventListener('click', () => flipbook.prev());
  els.next.addEventListener('click', () => flipbook.next());

  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    switch (e.key) {
      case 'ArrowLeft': case 'PageUp': flipbook.prev(); break;
      case 'ArrowRight': case 'PageDown': flipbook.next(); break;
      case 'Home': flipbook.goToLeaf(0); break;
      case 'End': flipbook.goToLeaf(flipbook.totalLeaves - 1); break;
      case '+': case '=': setZoom(zoom + ZOOM_STEP); break;
      case '-': case '_': setZoom(zoom - ZOOM_STEP); break;
      case '0': setZoom(1); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 't': case 'T': toggleThumbs(); break;
      case 'Escape': if (document.fullscreenElement) document.exitFullscreen?.(); else if (els.thumbsPanel.classList.contains('is-open')) toggleThumbs(); break;
    }
  });

  // --- Plein écran ---------------------------------------------------------
  function toggleFullscreen() {
    const root = els.root;
    if (!document.fullscreenElement) root.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  }
  els.fs.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    els.root.classList.toggle('is-fullscreen', !!document.fullscreenElement);
    setTimeout(() => flipbook.relayout(), 80);
  });

  // --- Zoom (re-rendu net au repos) ---------------------------------------
  let zoomIdle = null;
  function setZoom(z) {
    z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 100) / 100));
    if (z === zoom && z === 1) { applyZoomVisual(z); return; }
    zoom = z;
    applyZoomVisual(z);
    els.zoomLabel.textContent = Math.round(z * 100) + '%';
    stage.classList.toggle('is-zoomed', z > 1);
    saveState?.({ zoom: z });
    ctx.onZoom?.(z);
    clearTimeout(zoomIdle);
    // Pendant le geste : transformation CSS (peut être légèrement adoucie).
    // Au repos : on re-rend la fenêtre visible à la résolution supérieure.
    zoomIdle = setTimeout(() => { flipbook.setSuperSample(z); }, 190);
  }
  function applyZoomVisual(z) {
    stageInner.style.transform = z > 1 ? `scale(${z})` : '';
    stageInner.style.transformOrigin = 'center top';
  }
  els.zoomIn.addEventListener('click', () => setZoom(zoom + ZOOM_STEP));
  els.zoomOut.addEventListener('click', () => setZoom(zoom - ZOOM_STEP));
  els.zoomReset.addEventListener('click', () => setZoom(1));

  // Ctrl + molette
  stage.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(zoom + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
  }, { passive: false });

  // Double-tap / double-clic : bascule 1 <-> 2
  let lastTap = 0;
  stage.addEventListener('pointerup', (e) => {
    const now = performance.now ? performance.now() : Date.now();
    if (now - lastTap < 300) setZoom(zoom > 1 ? 1 : 2);
    lastTap = now;
  });

  // Pincement tactile (2 doigts)
  let pinchStart = 0, pinchZoom = 1;
  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) { pinchStart = dist(e.touches); pinchZoom = zoom; }
  }, { passive: true });
  stage.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && pinchStart) {
      const r = dist(e.touches) / pinchStart;
      setZoom(pinchZoom * r);
    }
  }, { passive: true });
  function dist(t) { const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.hypot(dx, dy); }

  // --- Miniatures / sommaire ----------------------------------------------
  async function buildThumbs() {
    if (thumbsBuilt) return;
    thumbsBuilt = true;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < flipbook.totalLeaves; i++) {
      const leaf = flipbook.leaves[i];
      const btn = document.createElement('button');
      btn.className = 'mr-thumb';
      btn.type = 'button';
      btn.dataset.leaf = String(i);
      btn.setAttribute('aria-label', `Aller à la page ${i + 1}`);
      const c = document.createElement('canvas');
      c.className = 'mr-thumb-c';
      btn.appendChild(c);
      const n = document.createElement('span'); n.className = 'mr-thumb-n'; n.textContent = i + 1;
      btn.appendChild(n);
      btn.addEventListener('click', () => { flipbook.goToLeaf(i); if (window.matchMedia('(max-width:820px)').matches) toggleThumbs(); });
      frag.appendChild(btn);
      // rendu miniature (sans couche texte)
      const page = await getPage(pdf, leaf.pageNumber);
      renderLeaf({ page, half: leaf.half, targetCssW: 104, superSample: 1, canvas: c, textLayerDiv: null });
    }
    els.thumbs.appendChild(frag);
    els.thumbs.querySelector(`.mr-thumb[data-leaf="${flipbook.currentLeaf()}"]`)?.classList.add('is-active');
  }
  function toggleThumbs() {
    const open = els.thumbsPanel.classList.toggle('is-open');
    els.thumbsBtn.setAttribute('aria-expanded', String(open));
    els.root.classList.toggle('has-thumbs', open);
    saveState?.({ thumbsOpen: open });
    if (open) buildThumbs();
    setTimeout(() => flipbook.relayout(), 60);
  }
  els.thumbsBtn.addEventListener('click', toggleThumbs);
  ctx.openThumbsIfSaved = (wasOpen) => { if (wasOpen) toggleThumbs(); };

  // --- Téléchargement (activable depuis la régie) -------------------------
  if (publication.downloadEnabled && publication.pdfUrl) {
    els.download.hidden = false;
    els.download.href = publication.pdfUrl;
    els.download.setAttribute('download', '');
  } else {
    els.download.remove();
  }

  return { updateCounter, setZoom, toggleThumbs };
}
