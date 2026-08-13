// flipbook-controller.js — moteur de feuilletage propre (sans dépendance externe
// de rendu) : garde le VRAI canvas DOM + la couche texte (net à toute densité de
// pixels, sélectionnable), et anime une page rigide qui tourne autour de la
// reliure (rotateY). Corrige le défaut HiDPI de StPageFlip (déformation sur
// écrans Retina/mobile). Couverture seule, double page sur large écran, une
// seule page sur mobile, mode sans animation respecté.
import { getPage, renderLeaf } from './pdf-renderer.js';
import { prefersReducedMotion } from './accessibility.js';

const TWO_UP_MIN = 820; // largeur minimale pour la double page
const TURN_MS = 620;

export class FlipbookController {
  constructor(container, pdf, opts = {}) {
    this.container = container;
    this.pdf = pdf;
    this.opts = opts;
    this.reduced = prefersReducedMotion();
    this.superSample = 1;
    this.onChange = opts.onChange || (() => {});
    this.animating = false;

    // Feuilles = pages de magazine (moitié gauche/droite de chaque page PDF).
    this.leaves = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      this.leaves.push({ pageNumber: p, half: 'left' });
      this.leaves.push({ pageNumber: p, half: 'right' });
    }
    this.P = this.leaves.length;

    // Ouvertures (openings) pour la double page : couverture seule puis paires.
    this.openings = [{ left: null, right: 0 }];
    for (let k = 1; 2 * k - 1 <= this.P - 1; k++) {
      const left = 2 * k - 1;
      const right = 2 * k <= this.P - 1 ? 2 * k : null;
      this.openings.push({ left, right });
    }
    this.o = 0;        // index d'ouverture (mode double page)
    this.page = 0;     // page courante (mode une page / compteur)
  }

  get totalLeaves() { return this.P; }

  async build() {
    const root = document.createElement('div');
    root.className = 'mr-book';
    root.innerHTML =
      '<div class="mr-sheet">' +
      '  <div class="mr-slot mr-slot--left">' + slotInner() + '</div>' +
      '  <div class="mr-spine" aria-hidden="true"></div>' +
      '  <div class="mr-slot mr-slot--right">' + slotInner() + '</div>' +
      '</div>' +
      '<div class="mr-turn" aria-hidden="true">' +
      '  <div class="mr-face mr-face--front">' + slotInner() + '<div class="mr-shade"></div></div>' +
      '  <div class="mr-face mr-face--back">' + slotInner() + '<div class="mr-shade"></div></div>' +
      '</div>' +
      // zones cliquables discrètes sur les bords
      '<button class="mr-edge mr-edge--prev" type="button" aria-label="Page précédente" tabindex="-1"></button>' +
      '<button class="mr-edge mr-edge--next" type="button" aria-label="Page suivante" tabindex="-1"></button>';
    this.container.appendChild(root);
    this.root = root;
    this.sheet = root.querySelector('.mr-sheet');
    this.slotL = root.querySelector('.mr-slot--left');
    this.slotR = root.querySelector('.mr-slot--right');
    this.turn = root.querySelector('.mr-turn');
    this.faceF = root.querySelector('.mr-face--front');
    this.faceB = root.querySelector('.mr-face--back');

    root.querySelector('.mr-edge--prev').addEventListener('click', () => this.prev());
    root.querySelector('.mr-edge--next').addEventListener('click', () => this.next());

    // Gestes tactiles (glissement horizontal pour tourner).
    let sx = 0, sy = 0, sw = false;
    this.sheet.addEventListener('touchstart', (e) => { if (e.touches.length === 1) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; sw = true; } }, { passive: true });
    this.sheet.addEventListener('touchend', (e) => {
      if (!sw) return; sw = false;
      const dx = (e.changedTouches[0].clientX - sx), dy = Math.abs(e.changedTouches[0].clientY - sy);
      if (Math.abs(dx) > 45 && Math.abs(dx) > dy) { dx < 0 ? this.next() : this.prev(); }
    }, { passive: true });

    this._computeMode();
    await this._renderCurrent();
    this._emit();
    return this;
  }

  refresh() { this._emit(); }

  _computeMode() {
    const w = this.container.getBoundingClientRect().width || window.innerWidth;
    this.twoUp = w >= TWO_UP_MIN;
    this.root.classList.toggle('is-twoup', this.twoUp);
    this.root.classList.toggle('is-oneup', !this.twoUp);
    this._sizeBook();
  }

  _sizeBook() {
    const rect = this.container.getBoundingClientRect();
    const base = this._base || { width: 1080, height: 705 };
    const pageAspect = (base.width / 2) / base.height; // largeur/hauteur d'une page
    const availW = Math.max(200, rect.width - 8);
    const availH = Math.max(200, rect.height - 8);
    let pageH, pageW;
    if (this.twoUp) {
      pageH = Math.min(availH, availW / (2 * pageAspect));
      pageW = pageH * pageAspect;
      this.root.style.width = (pageW * 2) + 'px';
    } else {
      pageH = Math.min(availH, availW / pageAspect);
      pageW = pageH * pageAspect;
      this.root.style.width = pageW + 'px';
    }
    this.root.style.height = pageH + 'px';
    this.pageW = pageW; this.pageH = pageH;
    this.root.style.setProperty('--mr-page-w', pageW + 'px');
    this.root.style.setProperty('--mr-page-h', pageH + 'px');
  }

  async _ensureBase() {
    if (!this._base) this._base = (await getPage(this.pdf, 1)).getViewport({ scale: 1 });
    return this._base;
  }

  // Rendu d'une page de magazine dans un conteneur .mr-slot / .mr-face.
  async _paint(host, pageIndex) {
    const wrap = host.querySelector('.mr-canvas-wrap');
    const canvas = host.querySelector('.mr-canvas');
    const tl = host.querySelector('.textLayer');
    const ph = host.querySelector('.mr-ph');
    if (pageIndex == null) { host.classList.add('is-blank'); if (ph) ph.style.display = 'none'; canvas.width = 0; tl.textContent = ''; return; }
    host.classList.remove('is-blank');
    const leaf = this.leaves[pageIndex];
    host._renderer?.cancel();
    const page = await getPage(this.pdf, leaf.pageNumber);
    const ctrl = renderLeaf({ page, half: leaf.half, targetCssW: this.pageW, superSample: this.superSample, canvas, textLayerDiv: tl });
    host._renderer = ctrl;
    try {
      const r = await ctrl.promise;
      if (r && !r.cancelled) { host.classList.add('is-rendered'); if (ph) ph.style.display = 'none'; }
    } catch (_) { if (ph) ph.innerHTML = '<span class="mr-ph-err">Page indisponible</span>'; }
  }

  async _renderCurrent() {
    await this._ensureBase();
    this._sizeBook();
    if (this.twoUp) {
      const op = this.openings[this.o];
      await Promise.all([this._paint(this.slotL, op.left), this._paint(this.slotR, op.right)]);
      this.page = op.left != null ? op.left : op.right;
    } else {
      // une page : slot droit centré
      this.slotL.classList.add('is-blank');
      await this._paint(this.slotR, this.page);
    }
  }

  // --- Navigation ---------------------------------------------------------
  canNext() { return this.twoUp ? this.o < this.openings.length - 1 : this.page < this.P - 1; }
  canPrev() { return this.twoUp ? this.o > 0 : this.page > 0; }

  async next() { if (this.animating || !this.canNext()) return; await this._go(1); }
  async prev() { if (this.animating || !this.canPrev()) return; await this._go(-1); }

  async _go(dir) {
    if (this.reduced) { this._applyStep(dir); await this._renderCurrent(); this._emit(); return; }
    this.animating = true;
    await this._animate(dir);
    this._applyStep(dir);
    await this._renderCurrent();
    this.turn.classList.remove('is-on', 'is-fwd', 'is-bwd');
    this.turn.style.transform = '';
    this.animating = false;
    this._emit();
  }

  _applyStep(dir) {
    if (this.twoUp) this.o = Math.max(0, Math.min(this.openings.length - 1, this.o + dir));
    else this.page = Math.max(0, Math.min(this.P - 1, this.page + dir));
  }

  // Anime une page rigide qui tourne autour de la reliure.
  async _animate(dir) {
    const fwd = dir > 0;
    let frontIdx, backIdx, origin, startDeg, endDeg, left;
    if (this.twoUp) {
      const cur = this.openings[this.o];
      const nxt = this.openings[this.o + dir];
      if (fwd) { frontIdx = cur.right; backIdx = nxt ? nxt.left : null; origin = 'left center'; startDeg = 0; endDeg = -180; left = '50%'; }
      else { frontIdx = cur.left; backIdx = nxt ? nxt.right : null; origin = 'right center'; startDeg = 0; endDeg = 180; left = '0px'; }
    } else {
      origin = 'left center'; left = '0px';
      if (fwd) { frontIdx = this.page; backIdx = this.page + 1; startDeg = 0; endDeg = -180; }
      else { frontIdx = this.page - 1; backIdx = this.page; startDeg = -180; endDeg = 0; }
    }
    await Promise.all([this._paint(this.faceF, frontIdx), this._paint(this.faceB, backIdx)]);

    const t = this.turn;
    t.classList.add('is-on');
    t.style.left = left; t.style.right = 'auto';
    t.style.transformOrigin = origin;
    t.style.transition = 'none';
    t.style.transform = `rotateY(${startDeg}deg)`;
    void t.offsetWidth; // reflow
    t.style.transition = `transform ${TURN_MS}ms cubic-bezier(.25,.6,.2,1)`;
    t.style.transform = `rotateY(${endDeg}deg)`;
    await new Promise((r) => setTimeout(r, TURN_MS + 20));
    t.style.transition = '';
  }

  goToLeaf(i) {
    const idx = Math.max(0, Math.min(this.P - 1, i));
    if (this.twoUp) {
      const o = this.openings.findIndex((op) => op.left === idx || op.right === idx);
      this.o = o < 0 ? 0 : o;
    } else { this.page = idx; }
    this._renderCurrent().then(() => this._emit());
  }
  goToMagazinePage(p) { this.goToLeaf(p - 1); }
  currentLeaf() {
    if (this.twoUp) { const op = this.openings[this.o]; return op.left != null ? op.left : op.right; }
    return this.page;
  }

  setReducedMotion(on) { this.reduced = on; }

  async setSuperSample(z) {
    this.superSample = Math.max(1, z);
    await this._renderCurrent();
  }

  relayout() {
    const wasTwo = this.twoUp;
    this._computeMode();
    // conserve la position : si on passe de 2up à 1up, prendre la page gauche
    if (wasTwo && !this.twoUp) this.page = this.openings[this.o].left ?? this.openings[this.o].right ?? 0;
    if (!wasTwo && this.twoUp) { const o = this.openings.findIndex((op) => op.left === this.page || op.right === this.page); this.o = o < 0 ? 0 : o; }
    clearTimeout(this._rz);
    this._rz = setTimeout(() => this._renderCurrent().then(() => this._emit()), 40);
  }

  _emit() {
    let magFrom, magTo;
    if (this.twoUp) {
      const op = this.openings[this.o];
      magFrom = (op.left != null ? op.left : op.right) + 1;
      magTo = (op.right != null ? op.right : op.left) + 1;
    } else { magFrom = magTo = this.page + 1; }
    this.onChange({
      leaf: this.currentLeaf(),
      totalLeaves: this.P,
      magFrom, magTo, totalMag: this.P,
      atStart: !this.canPrev(), atEnd: !this.canNext(),
      isSpread: this.twoUp && magFrom !== magTo,
    });
  }

  destroy() {
    [this.slotL, this.slotR, this.faceF, this.faceB].forEach((h) => h?._renderer?.cancel());
    this.root?.remove();
  }
}

function slotInner() {
  return '<div class="mr-canvas-wrap"><canvas class="mr-canvas" aria-hidden="true"></canvas>' +
    '<div class="textLayer"></div><div class="mr-ph"><span class="mr-ph-dot"></span></div></div>';
}
