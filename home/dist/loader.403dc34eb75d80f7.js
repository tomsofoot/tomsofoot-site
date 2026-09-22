/* Premier affichage : les articles seuls sont prioritaires. Aucune navigation/recharge. */
(() => {
  'use strict';
  const blank = () => ({articles:[], competitions:[], genres:[], hints:{}, docs:{videos:[]},
    local:{manifeste:{}}, views:{}, matches:{matches:[]}, twitch:{live:false}, assets:{}, errors:{}});
  async function read(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {signal:controller.signal});
      if (!response.ok) throw Error('source_unavailable');
      return await response.json();
    } finally { clearTimeout(timeout); }
  }
  function normalize(input) {
    const data = {...blank(), ...input};
    for (const key of ['articles','competitions','genres']) if (!Array.isArray(data[key])) data[key] = [];
    if (!data.local?.manifeste) data.local = {manifeste:{}};
    for (const key of ['assets','views','hints','errors']) if (!data[key] || typeof data[key] !== 'object') data[key] = {};
    return data;
  }
  function updateCounts() {
    for (const element of document.querySelectorAll('[data-count]')) {
      const value = window.TF_DATA.views[element.dataset.count];
      const valid = Number.isSafeInteger(value) && value >= 0;
      element.parentElement.hidden = !valid;
      // Une absence de donnée n'est jamais présentée comme un zéro.
      if (valid) element.textContent = new Intl.NumberFormat('fr-FR').format(value);
    }
  }
  function updateHints() {
    const hints = window.TF_DATA.hints;
    const year = Number(String(hints.for || '').slice(0,4)), birth = Number(hints.birthYear);
    const age = Number.isInteger(year) && Number.isInteger(birth) && birth > 0 && year > birth && year-birth < 120
      ? `${year-birth-1}–${year-birth} ans` : '—';
    const values = {'Poste':hints.position, 'Nationalité':hints.country, 'Âge':age, 'Championnats':hints.league};
    for (const cell of document.querySelectorAll('#jogadle-card .hints > div')) {
      const label = cell.querySelector('span')?.textContent;
      const value = cell.querySelector('strong');
      if (value && Object.hasOwn(values,label)) value.textContent = values[label] || '—';
    }
    window.TFNationalTeamUI?.refresh();
  }
  async function loadSecondary() {
    try {
      const extra = await read('/.netlify/functions/home-data?part=secondary');
      // Ne jamais remplacer les articles ou le DOM global après le premier affichage.
      for (const key of ['docs','hints','views']) if (extra[key] && typeof extra[key] === 'object') window.TF_DATA[key] = extra[key];
      Object.assign(window.TF_DATA.errors, extra.errors || {});
    } catch { window.TF_DATA.errors.secondary = 'unavailable'; }
    finally {
      state.secondaryPending = false;
      updateCounts(); updateHints();
      window.dispatchEvent(new Event('tomsofoot:home-secondary'));
    }
  }
  let finished = false;
  const state = window.TF_HOME = {
    assembling:false, secondaryPending:true,
    primary:read('/.netlify/functions/home-data?part=primary')
      .then(normalize)
      .catch(() => ({...blank(),errors:{articles:'unavailable'}}))
      .then(data => {
        window.TF_DATA = data;
        // L'image prioritaire commence à charger pendant le téléchargement du bundle.
        const article = data.articles.find(item => item.featured) || data.articles[0];
        const url = data.assets[article?.hero_image] || article?.hero_image;
        if (url) {
          const link = document.createElement('link');
          link.rel = 'preload'; link.as = 'image'; link.href = url; link.fetchPriority = 'high';
          document.head.append(link);
        }
        return data;
      }),
    finish() {
      if (finished) return;
      finished = true; state.assembling = false;
      if (!window.TF_DATA.articles.length) {
        document.querySelector('#hero-cta')?.setAttribute('href','/articles/');
        const meta = document.querySelector('#hero-meta'); if (meta) meta.textContent = '';
        document.querySelector('#hero-une .hero-visual img')?.remove();
        const latest = document.querySelector('#latest-articles');
        if (latest) latest.textContent = 'Les articles sont momentanément indisponibles. Retrouvez nos publications dans les archives.';
      }
      updateCounts();
      document.querySelector('#main')?.setAttribute('data-release','R03.24');
      document.querySelector('#app')?.setAttribute('aria-busy','false');
      document.documentElement.dataset.homeReady = 'true';
      window.dispatchEvent(new Event('tomsofoot:home-ready'));
      performance.mark('tomsofoot-home-ready');
      // Les ancres existent maintenant : honorer le lien entrant sans animation.
      // Puis laisser peindre l'accueil avant les requêtes secondaires.
      requestAnimationFrame(() => {
        if (location.hash) {
          try { document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({behavior:'instant',block:'start'}); }
          catch { /* Une ancre mal formée ne doit pas empêcher le chargement. */ }
        }
        setTimeout(loadSecondary,0);
      });
    },
    fail() {
      state.assembling = false;
      const app = document.querySelector('#app'); if (!app) return;
      app.setAttribute('aria-busy','false');
      const message = document.createElement('p'); message.className = 'home-load-error'; message.setAttribute('role','status');
      message.append('L’accueil est momentanément indisponible. ');
      const link = document.createElement('a'); link.href = '/articles/'; link.textContent = 'Accéder aux articles';
      message.append(link); app.prepend(message);
    }
  };
})();
