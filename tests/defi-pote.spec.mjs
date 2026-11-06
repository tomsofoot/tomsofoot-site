// defi-pote.spec.mjs — tests navigateur de l'animation « Défie ton pote » (Playwright, sans framework).
// Lancer le serveur de test (requêtes Range, comme Netlify) : node tests/serveur-statique.mjs 8100
// puis :
//   DEFI_BASE=http://localhost:8100 node tests/defi-pote.spec.mjs
// DEFI_SHOTS=dossier : enregistre aussi les captures (densité ×2) dans ce dossier.
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.DEFI_BASE || 'http://localhost:8100';
const SHOTS = process.env.DEFI_SHOTS || '';
const PAGE = `${BASE}/assets/defi-pote/apercu.html`;
const CHOICES = [1, 2, 3, 5, 7, 10];
let pass = 0, fail = 0; const results = [];
function check(name, cond, extra = '') { (cond ? pass++ : fail++); results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); }
const url = (q) => `${PAGE}?open=1&${new URLSearchParams(q).toString()}`;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

async function openDefi(pg, q) {
  await pg.goto(url(q), { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => window.__defi && (window.__defi.layout() || !window.__defi.plan.ok), null, { timeout: 10000 });
  await pg.waitForFunction(() => !window.__defi.plan.ok || window.__defi.state().videoOk, null, { timeout: 5000 }).catch(() => {});
}
// Couleur moyenne d'un segment (au centre) dans le canvas, en pixels physiques.
async function segColor(pg, index, k = 2) {
  return pg.evaluate(([index, k]) => {
    const L = window.__defi.layout(), c = document.querySelector('.dp-canvas'), ctx = c.getContext('2d');
    const g = L.grid, bx = 48 + (index % 3) * 305, by = 48 + Math.floor(index / 3) * 176;
    const dpr = c.width / parseFloat(c.style.width);
    const x = Math.round((g.x + (bx + 29 + k * 38 + 14) * g.s) * dpr), y = Math.round((g.y + (by + 108.5) * g.s) * dpr);
    const d = ctx.getImageData(x - 1, y, 3, 1).data;
    return [Math.round((d[0] + d[4] + d[8]) / 3), Math.round((d[1] + d[5] + d[9]) / 3), Math.round((d[2] + d[6] + d[10]) / 3)];
  }, [index, k]);
}
const isGold = ([r, g, b]) => r > 200 && g > 160 && b < 150;
const isGreen = ([r, g, b]) => g > 180 && r < 170 && g > b;
const isDark = ([r, g, b]) => r < 70 && g < 90 && b < 100;
async function canvasHash(pg) {
  return pg.evaluate(() => { const c = document.querySelector('.dp-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) >>> 0; return h; });
}

const browser = await chromium.launch();
try {
  // ---------- 1) Composition sur chaque taille d'écran ----------
  const VIEWS = [
    ['mobile-320x568', 320, 568, true], ['mobile-390x844', 390, 844, true], ['mobile-430x932', 430, 932, true],
    ['tablette-768x1024', 768, 1024, true], ['ordinateur-1280x720', 1280, 720, false], ['ordinateur-1920x1080', 1920, 1080, false],
    ['mobile-paysage-844x390', 844, 390, true], ['mobile-paysage-568x320', 568, 320, true]
  ];
  const Q = { id: 'defi-2026-11-06-0042', amount: 7, n1: 'Maximilien-Alexandre de La Tour d’Auvergne', p1: 128, n2: 'Jo', p2: 35 };
  const identities = [];
  for (const [name, w, h, touch] of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: SHOTS ? 2 : 1, hasTouch: touch, isMobile: touch && w < 700 });
    const pg = await ctx.newPage();
    const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await openDefi(pg, Q);
    const stageBefore = await pg.evaluate(() => document.querySelector('.dp-stage').getBoundingClientRect().height);
    await pg.evaluate(() => window.__defi.renderAt(5));
    const stageAfter = await pg.evaluate(() => document.querySelector('.dp-stage').getBoundingClientRect().height);
    check(`${name} : pas de saut de mise en page à la révélation`, Math.abs(stageAfter - stageBefore) < 0.5, `${stageBefore} → ${stageAfter}`);
    const m = await pg.evaluate(() => {
      const L = window.__defi.layout(), st = document.querySelector('.dp-stage').getBoundingClientRect();
      const btns = [...document.querySelectorAll('.dp-dialog button')].filter(b => b.offsetParent).map(b => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, t: r.top, r: r.right, b: r.bottom }; });
      const gridR = { l: st.left + L.grid.x, t: st.top + L.grid.y, r: st.left + L.grid.x + 1004 * L.grid.s, b: st.top + L.grid.y + 394 * L.grid.s };
      const duelR = { t: st.top + L.duel.y, b: st.top + L.duel.y + L.duel.visible * L.duel.s };
      const pl = document.querySelector('.dp-players');
      return { mode: L.mode, vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, btns, gridR, duelR, st: { l: st.left, t: st.top, r: st.right, b: st.bottom },
        unitPx: 27 * L.grid.s * L.boost.unit, numPx: 68 * L.grid.s * L.boost.num, segW: 28 * L.grid.s,
        playersOverflow: pl.scrollWidth > pl.clientWidth + 1, plan: document.querySelector('.dp-dialog').dataset.plan, status: document.querySelector('.dp-status').textContent };
    });
    identities.push(m.plan + '|' + m.status);
    check(`${name} : aucune erreur JS`, errs.length === 0, errs.join(' | '));
    check(`${name} : pas de défilement horizontal`, m.sw <= m.vw, `${m.sw} > ${m.vw}`);
    check(`${name} : commandes ≥ 44 px et à l'écran`, m.btns.every(b => b.w >= 44 && b.h >= 44 && b.l >= 0 && b.t >= 0 && b.r <= m.vw + 0.5 && b.b <= m.vh + 0.5), JSON.stringify(m.btns.map(b => [Math.round(b.w), Math.round(b.h)])));
    check(`${name} : grille des six montants entièrement visible`, m.gridR.l >= m.st.l - 0.5 && m.gridR.r <= m.st.r + 0.5 && m.gridR.t >= m.st.t - 0.5 && m.gridR.b <= m.st.b + 0.5 && m.gridR.b <= m.vh);
    check(`${name} : épées visibles`, m.duelR.t >= m.st.t - 0.5 && m.duelR.b <= m.st.b + 0.5 && (m.duelR.b - m.duelR.t) > 90, `${Math.round(m.duelR.b - m.duelR.t)} px`);
    check(`${name} : chiffres ≥ 18 px, unités ≥ 11 px`, m.numPx >= 17.9 && m.unitPx >= 10.9, `chiffres ${m.numPx.toFixed(1)} px, unités ${m.unitPx.toFixed(1)} px (${m.mode})`);
    check(`${name} : pseudo long tronqué proprement`, !m.playersOverflow);
    const win = await segColor(pg, 4), lose = await segColor(pg, 0);
    check(`${name} : 7 PTS en doré, perdante éteinte`, isGold(win) && isDark(lose), `gagnant ${win} perdant ${lose}`);
    if (SHOTS) {
      for (const t of [0.4, 2.2, 3.32, 5]) {
        await pg.evaluate(t => window.__defi.renderAt(t), t);
        await pg.waitForFunction(() => { const v = document.querySelector('video.dp-media'); return !v || (!v.seeking && v.readyState >= 2); }, null, { timeout: 5000 }).catch(() => {});
        await pg.waitForTimeout(120);
        await pg.screenshot({ path: `${SHOTS}/${name}-t${String(t).replace('.', '_')}.png` });
      }
    }
    await ctx.close();
  }
  check('Même résultat et même plan sur toutes les tailles (mobile = ordinateur)', new Set(identities).size === 1, [...new Set(identities)].join(' ‖ '));

  // ---------- 2) Les six résultats possibles (six montants éligibles) ----------
  {
    const pg = await browser.newPage({ viewport: { width: 390, height: 844 } });
    for (const amount of CHOICES) {
      await openDefi(pg, { id: 'six-' + amount, amount, n1: 'Tomso', p1: 35, n2: 'Alex', p2: 35 });
      const t0 = await Promise.all(CHOICES.map((_, i) => (async () => { await pg.evaluate(() => window.__defi.renderAt(0.3)); return segColor(pg, i); })()));
      check(`${amount} pts : six cases allumées au départ`, t0.every(isGreen), JSON.stringify(t0));
      await pg.evaluate(() => window.__defi.renderAt(5));
      const fin = [];
      for (let i = 0; i < 6; i++) fin.push(await segColor(pg, i));
      const wi = CHOICES.indexOf(amount);
      check(`${amount} pts : seule la case ${amount} reste allumée, en doré`, fin.every((c, i) => i === wi ? isGold(c) : isDark(c)), JSON.stringify(fin));
      const st = await pg.textContent('.dp-status');
      check(`${amount} pts : annonce de la mise sans annoncer de vainqueur`, st.includes(`${amount} point`) && !/gagn|victoire|remporte le/i.test(st.replace('remportera', '')), st);
    }
    await pg.close();
  }

  // ---------- 3) Lecture : réseau, Passer, Rejouer, son, arrière-plan, redimensionnement, fermeture ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pg = await ctx.newPage();
    await pg.goto(PAGE);
    const reqs = [];
    pg.on('request', r => reqs.push({ m: r.method(), u: r.url(), t: r.resourceType() }));
    await pg.click('button[type=submit]');
    await pg.waitForFunction(() => window.__defi && window.__defi.state().videoOk, null, { timeout: 10000 });
    const plan0 = await pg.getAttribute('.dp-dialog', 'data-plan');
    await pg.waitForTimeout(400);
    let s = await pg.evaluate(() => window.__defi.state());
    check('Lecture démarrée automatiquement (mouvement autorisé)', s.playing && s.t > 0.1, JSON.stringify(s));
    check('Vidéo des épées lue pendant l’animation', s.videoPlaying);
    check('Son coupé par défaut (règles d’autoplay)', !s.sound && !s.audioPlaying);
    await pg.click('.dp-sound');
    await pg.waitForTimeout(250);
    s = await pg.evaluate(() => window.__defi.state());
    check('Commande Son : activation explicite, son lu en synchro', s.sound && s.audioPlaying && (await pg.getAttribute('.dp-sound', 'aria-pressed')) === 'true');
    check('Préférence de son mémorisée', (await pg.evaluate(() => localStorage.getItem('tomsofoot.defiPote.son'))) === '1');
    // Arrière-plan : pause puis reprise au même instant.
    await pg.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    const tHidden = (await pg.evaluate(() => window.__defi.state())).t;
    await pg.waitForTimeout(500);
    s = await pg.evaluate(() => window.__defi.state());
    check('Arrière-plan : animation et médias en pause', !s.playing && !s.audioPlaying && !s.videoPlaying && Math.abs(s.t - tHidden) < 0.001);
    await pg.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await pg.waitForTimeout(150);
    s = await pg.evaluate(() => window.__defi.state());
    check('Retour : reprise au même instant', s.playing && s.t >= tHidden && s.t < tHidden + 0.6, `${tHidden.toFixed(2)} → ${s.t.toFixed(2)}`);
    // Redimensionnement pendant la lecture.
    await pg.setViewportSize({ width: 390, height: 844 });
    await pg.waitForTimeout(250);
    check('Redimensionnement : nouvelle mise en page, même plan', (await pg.evaluate(() => window.__defi.layout().mode)) === 'portrait' && (await pg.getAttribute('.dp-dialog', 'data-plan')) === plan0);
    // Passer.
    await pg.click('.dp-primary');
    s = await pg.evaluate(() => window.__defi.state());
    check('Passer : image finale immédiate, médias arrêtés', !s.playing && s.t >= 4.6 && !s.audioPlaying && !s.videoPlaying);
    check('Passer : résultat textuel annoncé', /Mise révélée : 7 points en jeu/.test(await pg.textContent('.dp-status')));
    check('Passer : le bouton devient « Rejouer »', (await pg.textContent('.dp-primary')).trim() === 'Rejouer');
    await pg.waitForTimeout(500); // recalage de la vidéo sur la pose finale
    const h1 = await canvasHash(pg);
    // Rejouer : même plan, même image finale.
    await pg.click('.dp-primary');
    await pg.waitForTimeout(300);
    check('Rejouer : relance depuis 0', (await pg.evaluate(() => window.__defi.state())).playing);
    await pg.evaluate(() => window.__defi.skip());
    await pg.waitForTimeout(500);
    check('Rejouer : même image finale (aucun nouveau tirage)', (await canvasHash(pg)) === h1 && (await pg.getAttribute('.dp-dialog', 'data-plan')) === plan0);
    // Clavier : piège du focus et Échap.
    await pg.focus('.dp-close'); await pg.keyboard.press('Tab');
    const focusInside = await pg.evaluate(() => document.querySelector('.dp-dialog').contains(document.activeElement));
    check('Focus maintenu dans la fenêtre (Tab)', focusInside);
    await pg.keyboard.press('Escape');
    const closed = await pg.evaluate(() => ({ gone: !document.querySelector('.dp-overlay'), lock: document.documentElement.classList.contains('dp-lock'), focus: document.activeElement && document.activeElement.type, st: window.__defi.state() }));
    check('Échap : fenêtre fermée, page déverrouillée', closed.gone && !closed.lock);
    check('Fermeture : boucle et médias arrêtés', closed.st.closed && !closed.st.playing && !closed.st.audioPlaying && !closed.st.videoPlaying);
    check('Fermeture : focus rendu au bouton d’ouverture', closed.focus === 'submit');
    const bad = reqs.filter(r => r.m !== 'GET' || r.t === 'fetch' || r.t === 'xhr' || !r.u.startsWith(BASE));
    const kinds = [...new Set(reqs.map(r => r.u.replace(BASE, '').split('?')[0]))];
    check('Aucun appel serveur : uniquement des ressources locales en GET', bad.length === 0, bad.map(r => r.m + ' ' + r.u).join(', ') || kinds.join(', '));
    check('Aucune requête de points/défi (pas de double transfert possible côté client)', !reqs.some(r => /pronostic|defi(?!-pote)|points|function/i.test(r.u.replace(BASE, ''))));
    await ctx.close();
  }

  // ---------- 4) Mouvement réduit ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const pg = await ctx.newPage();
    await openDefi(pg, { id: 'reduit', amount: 5, n1: 'Tomso', p1: 35, n2: 'Alex', p2: 9 });
    await pg.waitForTimeout(400);
    const s = await pg.evaluate(() => window.__defi.state());
    check('Mouvement réduit : révélation immédiate, pas de lecture', !s.playing && s.t >= 4.6);
    check('Mouvement réduit : vrai montant annoncé', /5 points en jeu/.test(await pg.textContent('.dp-status')));
    check('Mouvement réduit : animation proposée à la demande', (await pg.textContent('.dp-primary')).trim() === 'Voir l’animation');
    check('Mouvement réduit : case 5 dorée', isGold(await segColor(pg, 3)));
    if (SHOTS) await pg.screenshot({ path: `${SHOTS}/mouvement-reduit-390x844.png` });
    await ctx.close();
  }

  // ---------- 5) Erreurs : vidéo indisponible, montant refusé ----------
  {
    const pg = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await pg.route('**/duel-epees.mp4', r => r.abort());
    await openDefi(pg, { id: 'sans-video', amount: 2, n1: 'Tomso', p1: 35, n2: 'Alex', p2: 35 });
    await pg.evaluate(() => window.__defi.renderAt(5));
    check('Vidéo en échec : animation dessinée quand même, résultat réel affiché', !(await pg.evaluate(() => window.__defi.state().videoOk)) && isGold(await segColor(pg, 1)) && /2 points en jeu/.test(await pg.textContent('.dp-status')));
    await pg.unroute('**/duel-epees.mp4');
    await openDefi(pg, { id: 'refuse', amount: 10, n1: 'Tomso', p1: 35, n2: 'Alex', p2: 6 });
    const fb = await pg.evaluate(() => ({ fallback: document.querySelector('.dp-dialog').classList.contains('dp-fallback'), status: document.querySelector('.dp-status').textContent }));
    check('Montant non autorisé : repli texte, pas d’animation trompeuse', fb.fallback && /10 points/.test(fb.status), fb.status);
    await pg.close();
  }

  // ---------- 6) Coût de rendu indicatif ----------
  for (const [w, h] of [[390, 844], [1920, 1080]]) {
    const pg = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await openDefi(pg, { id: 'perf', amount: 10, n1: 'A', p1: 35, n2: 'B', p2: 35 });
    const ms = await pg.evaluate(() => { const c = document.querySelector('.dp-canvas').getContext('2d'); window.__defi.renderAt(0.5); c.getImageData(0, 0, 1, 1); const t0 = performance.now(); for (let i = 0; i < 120; i++) { window.__defi.renderAt(0.8 + i / 60); c.getImageData(0, 0, 1, 1); } return (performance.now() - t0) / 120; });
    results.push(`INFO  Rendu moyen ${w}×${h} @2x (Chromium sans GPU) : ${ms.toFixed(1)} ms / image`);
    await pg.close();
  }
} finally {
  await browser.close();
}
console.log(results.join('\n'));
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
