// main.js — point d'entrée du lecteur. Assemble le chargement PDF, le
// feuilletage, les contrôles, la reprise de lecture et la gestion d'erreurs.
import { loadPdf, ReaderError, checkBrowserSupport } from './pdf-loader.js';
import { getPage, pageHasText } from './pdf-renderer.js';
import { resolveFromLocation } from './source-adapter.js';
import { FlipbookController } from './flipbook-controller.js';
import { initControls } from './reader-controls.js';
import { loadState, saveState as persist, clearState } from './reader-state.js';
import { createAnnouncer, onReducedMotionChange } from './accessibility.js';

const $ = (id) => document.getElementById(id);

function showError(code, message, pdfUrl) {
  const map = {
    not_found: ['Publication introuvable', 'Le journal demandé n\'existe pas ou a été retiré.'],
    unavailable: ['Pas encore disponible', 'Cette publication n\'est pas encore publiée.'],
    network: ['Erreur réseau', 'La connexion a échoué pendant le chargement. Vérifiez votre réseau.'],
    invalid: ['Fichier invalide', 'Le fichier n\'est pas un PDF exploitable.'],
    password: ['Document protégé', 'Ce PDF est protégé par mot de passe.'],
    unsupported: ['Navigateur incompatible', 'Votre navigateur ne permet pas d\'afficher ce lecteur.'],
    render: ['Affichage impossible', 'Une page n\'a pas pu être affichée.'],
  };
  const [title, msg] = map[code] || ['Une erreur est survenue', message || ''];
  $('mr-errtitle').textContent = title;
  $('mr-errmsg').textContent = msg;
  const open = $('mr-openpdf');
  if (pdfUrl) { open.hidden = false; open.href = pdfUrl; } else { open.hidden = true; }
  $('mr-loading').hidden = true;
  $('mr-error').hidden = false;
}

async function boot() {
  const loadtxt = $('mr-loadtxt');
  const loadbar = $('mr-loadbar');

  if (!checkBrowserSupport()) { showError('unsupported'); return; }

  // 1) Résoudre la publication demandée.
  let pub;
  try {
    pub = await resolveFromLocation();
  } catch (err) {
    const e = err instanceof ReaderError ? err : new ReaderError('not_found', String(err));
    showError(e.code, e.message);
    return;
  }

  document.title = `${pub.title} — TomsoFoot`;
  $('mr-title').textContent = pub.title;
  if (pub.subtitle) $('mr-subtitle').textContent = pub.subtitle;

  // 2) Charger le PDF avec progression réelle.
  let pdf;
  try {
    const res = await loadPdf(pub.pdfUrl, {
      onProgress: (f) => { loadbar.style.width = Math.round(f * 90) + '%'; },
    });
    pdf = res.pdf;
  } catch (err) {
    const e = err instanceof ReaderError ? err : new ReaderError('invalid', String(err));
    showError(e.code, e.message, pub.pdfUrl);
    $('mr-retry').onclick = () => location.reload();
    return;
  }

  loadtxt.textContent = 'Préparation du journal…';
  loadbar.style.width = '96%';

  // 3) Détecter un PDF rasterisé (aucun texte) et le signaler honnêtement.
  try {
    const p1 = await getPage(pdf, 1);
    const hasText = await pageHasText(p1);
    if (!hasText) {
      $('mr-notice').hidden = false;
      $('mr-notice').textContent = 'Ce numéro ne contient pas de texte sélectionnable (PDF entièrement rasterisé). La netteté dépend de la résolution des images source.';
    }
  } catch (_) {}

  // 4) Construire le feuilletage.
  const stagebook = $('mr-stagebook');
  const announcer = createAnnouncer();
  const saveState = (patch) => persist(pub.slug, pub.pdfVersion, patch);

  let flipbook;
  const ctx = {
    els: {
      root: $('mr-root'), stage: $('mr-stage'), stageInner: $('mr-stage-inner'),
      prev: $('mr-prev'), next: $('mr-next'), cur: $('mr-cur'), tot: $('mr-tot'), prog: $('mr-prog'),
      fs: $('mr-fs'), zoomIn: $('mr-zoom-in'), zoomOut: $('mr-zoom-out'), zoomReset: $('mr-zoom-reset'), zoomLabel: $('mr-zoom-label'),
      thumbsBtn: $('mr-thumbs-btn'), thumbsPanel: $('mr-thumbs-panel'), thumbs: $('mr-thumbs'),
      download: $('mr-download'),
    },
    publication: pub, pdf, announcer, saveState,
    stage: $('mr-stage'), stageInner: $('mr-stage-inner'),
  };

  flipbook = new FlipbookController(stagebook, pdf, {
    onChange: (info) => ctx.updateCounter?.(info),
    onPageError: () => {},
  });
  ctx.flipbook = flipbook;

  try {
    await flipbook.build();
  } catch (err) {
    showError('render', err?.message, pub.pdfUrl);
    return;
  }

  // 5) Contrôles.
  const controls = initControls(ctx);
  flipbook.refresh(); // met à jour le compteur maintenant que les contrôles écoutent

  // Signaler la qualité image en zoom fort (une fois).
  let qualityShown = false;
  ctx.onZoom = (z) => {
    if (z >= 1.75 && !qualityShown) {
      qualityShown = true;
      const n = $('mr-notice');
      if (n.hidden) { n.hidden = false; n.textContent = 'Zoom fort : certaines photos sont en résolution web et peuvent s\'adoucir. C\'est une limite du PDF source, pas du lecteur.'; }
    }
  };

  // 6) Masquer le chargement.
  loadbar.style.width = '100%';
  setTimeout(() => { $('mr-loading').hidden = true; }, 180);

  // 7) Reprise de lecture.
  const saved = loadState(pub.slug, pub.pdfVersion);
  if (saved && saved.page > 1 && saved.page <= flipbook.totalLeaves) {
    const banner = $('mr-resume');
    $('mr-resume-page').textContent = saved.page;
    banner.hidden = false;
    $('mr-resume-yes').onclick = () => {
      banner.hidden = true;
      flipbook.goToMagazinePage(saved.page);
      if (saved.thumbsOpen) controls.toggleThumbs();
    };
    $('mr-resume-no').onclick = () => { banner.hidden = true; clearState(pub.slug, pub.pdfVersion); };
    setTimeout(() => { if (!banner.hidden) banner.hidden = true; }, 12000);
  } else if (saved && saved.thumbsOpen) {
    controls.toggleThumbs();
  }

  // 8) Mouvement réduit en direct.
  onReducedMotionChange((on) => flipbook.setReducedMotion(on));

  // 9) Redimensionnement fenêtre.
  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => flipbook.relayout(), 120); });
}

boot();
