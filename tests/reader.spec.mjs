// reader.spec.mjs — tests automatisés du lecteur (Playwright, sans framework).
// Lancer un serveur statique à la racine du dépôt puis :
//   READER_BASE=http://localhost:8100 node tests/reader.spec.mjs
// CHROME_PATH permet de pointer un binaire Chromium précis.
import { chromium } from 'playwright';

const BASE = process.env.READER_BASE || 'http://localhost:8100';
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const EDITION = 'n12-argentine-angleterre';
const readerURL = `${BASE}/magazine/lecteur.html?edition=${EDITION}`;

let pass = 0, fail = 0; const results = [];
function check(name, cond, extra = '') { (cond ? pass++ : fail++); results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); }

async function waitReader(pg) {
  await pg.goto(readerURL, { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => { const l = document.getElementById('mr-loading'); return l && l.hidden; }, { timeout: 20000 }).catch(() => {});
  await pg.waitForTimeout(900);
}

const b = await chromium.launch({ executablePath: EXE });
try {
  // 1) Desktop : rendu net + double page + sélection + navigation
  const pg = await b.newPage({ viewport: { width: 1366, height: 800 }, deviceScaleFactor: 2 });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await waitReader(pg);
  const d = await pg.evaluate(() => {
    const cv = document.querySelector('.mr-slot--right .mr-canvas');
    return {
      total: document.getElementById('mr-tot').textContent,
      backing: cv ? cv.width : 0,
      cssW: cv ? parseInt(cv.style.width) : 0,
      twoup: document.querySelector('.mr-book').classList.contains('is-twoup'),
      spansL: document.querySelectorAll('.mr-slot--left .textLayer span').length,
      spansR: document.querySelectorAll('.mr-slot--right .textLayer span').length,
    };
  });
  check('Chargement sans erreur JS', errs.length === 0, errs.join(' | '));
  check('28 pages détectées', d.total === '28', 'total=' + d.total);
  check('Double page active (desktop)', d.twoup === true);
  check('Canvas HiDPI (backing > cssW)', d.backing >= d.cssW * 1.8, `backing=${d.backing} css=${d.cssW}`);
  check('Couche texte présente et sélectionnable', d.spansR > 20, 'spans=' + d.spansR);

  const sel = await pg.evaluate(() => {
    const tl = document.querySelector('.mr-slot--right .textLayer');
    const r = document.createRange(); r.selectNodeContents(tl);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    return getSelection().toString();
  });
  check('Sélection de texte non vide', sel.trim().length > 30);
  check('Accents français préservés', /[éèàêîôûçœ]/i.test(sel), sel.slice(0, 40));

  const c0 = await pg.$eval('#mr-cur', e => e.textContent);
  await pg.click('#mr-next');
  await pg.waitForFunction((prev) => document.getElementById('mr-cur').textContent !== prev, c0, { timeout: 4000 }).catch(() => {});
  const c1 = await pg.$eval('#mr-cur', e => e.textContent);
  check('La page suivante change le compteur', c0 !== c1, `${c0} -> ${c1}`);

  // Zoom : re-rend à résolution supérieure (backing augmente)
  const before = await pg.$eval('.mr-slot--right .mr-canvas', c => c.width);
  await pg.click('#mr-zoom-in'); await pg.click('#mr-zoom-in'); await pg.waitForTimeout(600);
  const after = await pg.$eval('.mr-slot--right .mr-canvas', c => c.width);
  check('Zoom re-rend (backing augmente, pas d\'étirement)', after > before, `${before} -> ${after}`);
  await pg.close();

  // 2) Mobile : une seule page
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  await waitReader(m);
  const md = await m.evaluate(() => ({
    oneup: document.querySelector('.mr-book').classList.contains('is-oneup'),
    leftHidden: getComputedStyle(document.querySelector('.mr-slot--left')).display === 'none',
    backing: (document.querySelector('.mr-slot--right .mr-canvas') || {}).width || 0,
  }));
  check('Mobile : une seule page', md.oneup && md.leftHidden);
  check('Mobile : rendu HiDPI (dpr 3)', md.backing > 800, 'backing=' + md.backing);
  await m.close();

  // 3) Mouvement réduit : tournage instantané (pas d'animation bloquante)
  const rm = await b.newPage({ viewport: { width: 1366, height: 800 }, deviceScaleFactor: 1 });
  await rm.emulateMedia({ reducedMotion: 'reduce' });
  await waitReader(rm);
  const rc0 = await rm.$eval('#mr-cur', e => e.textContent);
  const t0 = Date.now();
  await rm.click('#mr-next');
  await rm.waitForFunction((prev) => document.getElementById('mr-cur').textContent !== prev, rc0, { timeout: 3000 }).catch(() => {});
  const elapsed = Date.now() - t0;
  const rc1 = await rm.$eval('#mr-cur', e => e.textContent);
  check('Reduced-motion : changement de page immédiat', rc0 !== rc1 && elapsed < 900, `${rc0} -> ${rc1} en ${elapsed}ms`);
  await rm.close();

  // 4) Erreur : édition inexistante
  const er = await b.newPage();
  await er.goto(`${BASE}/magazine/lecteur.html?edition=nexistepas`, { waitUntil: 'domcontentloaded' });
  await er.waitForFunction(() => { const e = document.getElementById('mr-error'); return e && !e.hidden; }, { timeout: 15000 }).catch(() => {});
  const errShown = await er.evaluate(() => { const e = document.getElementById('mr-error'); return e && !e.hidden && document.getElementById('mr-errtitle').textContent; });
  check('Édition inexistante : message d\'erreur clair', !!errShown, String(errShown));
  await er.close();

  // 5) Non-régression accueil : lien magazine -> lecteur natif + Jogadle présent
  const h = await b.newPage();
  await h.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await h.waitForTimeout(600);
  const home = await h.evaluate(() => ({
    magLinks: [...document.querySelectorAll('a[href*="magazine/lecteur.html"]')].length,
    heyzine: [...document.querySelectorAll('a[href*="heyzine.com"]')].length,
    jeuLink: [...document.querySelectorAll('a[href="/jeu"], a[href*="/jeu"]')].length,
  }));
  check('Accueil : liens magazine -> lecteur natif', home.magLinks >= 3, 'liens=' + home.magLinks);
  check('Accueil : plus aucun lien Heyzine externe', home.heyzine === 0);
  check('Accueil : lien vers le jeu conservé', home.jeuLink >= 1);
  await h.close();
} finally {
  await b.close();
}

console.log('\n' + results.join('\n'));
console.log(`\n${pass} PASS · ${fail} FAIL`);
process.exit(fail ? 1 : 0);
