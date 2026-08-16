/* ============================================================
 * TomsoFoot — Pop-up « Prolongez l'expérience »  (window.TomsoFootContinue)
 * Composant PARTAGÉ par Le Joueur du Jour (/jeu) et Mode Carrière (/mode-carriere/).
 *
 * Un seul pop-up dynamique. Moteur : playerOfTheDayCompleted / careerModeCompleted.
 *   -> la grande carte propose TOUJOURS le jeu quotidien NON terminé (jamais
 *      « l'autre jeu » selon la page ; on examine l'état réel des deux défis du jour).
 *   -> les deux terminés : vidéo + article deviennent prioritaires.
 *
 * Ne calcule aucun score, ne crédite aucun point, n'écrit aucune table.
 * État du jour : balises locales `tfjeux:<id>:<date Europe/Paris>` (invité) +
 * confirmation serveur silencieuse si un résolveur est fourni (connecté).
 * Contenus dynamiques : /.netlify/functions/next-up (article + vidéo + date).
 * ============================================================ */
(function (global) {
  'use strict';
  var doc = global.document;

  var ENDPOINT = '/.netlify/functions/next-up';
  var GAMES = {
    'daily-player': {
      id: 'daily-player', route: '/jeu', cls: 'tsf-cx__hero--player', kicker: 'JEU 1 · TOMSOFOOT',
      name: 'LE JOUEUR DU JOUR', label: 'LE JOUEUR DU JOUR',
      desc: 'Devinez le footballeur mystère et grimpez au championnat.',
      info: 'CHAMPIONNAT EN DIRECT · 100 PTS EN JEU', cta: 'JOUER MAINTENANT',
      assets: ['/jeu/js/game.js', '/jeu/css/base.css']
    },
    'career-mode': {
      id: 'career-mode', route: '/mode-carriere/', cls: 'tsf-cx__hero--career', kicker: 'JEU 2 · TOMSOFOOT',
      name: 'MODE CARRIÈRE', label: 'MODE CARRIÈRE',
      desc: "Retrouvez le joueur d'après son parcours en clubs.",
      info: null, cta: 'COMMENCER LE PARCOURS',
      assets: ['/mode-carriere/game.js']
    }
  };

  /* ---------- utilitaires date / stockage ---------- */
  function parisDate() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
    catch (e) { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  }
  function lsGet(k) { try { return global.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { global.localStorage.setItem(k, v); } catch (e) {} }

  function beaconKey(id, d) { return 'tfjeux:' + id + ':' + (d || parisDate()); }
  function isDone(id) {
    var raw = lsGet(beaconKey(id)); if (!raw) return false;
    try { var o = JSON.parse(raw); return !!(o && (o.state === 'completed' || o.state === 'revealed')); } catch (e) { return false; }
  }
  function markCompleted(id, state) { lsSet(beaconKey(id), JSON.stringify({ state: state || 'completed', at: Date.now() })); }
  function popupKey(id, d) { return 'tfjeux:popup:' + id + ':' + (d || parisDate()); }
  function popupShown(id) { return lsGet(popupKey(id)) === '1'; }
  function setPopupShown(id) { lsSet(popupKey(id), '1'); }

  /* ---------- source dynamique (article + vidéo + date) ---------- */
  var _data = null, _dataAt = 0, _dataPromise = null;
  function fetchData() {
    var now = Date.now();
    if (_data && (now - _dataAt) < 120000) return Promise.resolve(_data);
    if (_dataPromise) return _dataPromise;
    _dataPromise = fetch(ENDPOINT, { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { _dataPromise = null; if (j) { _data = j; _dataAt = Date.now(); } return _data || fallbackData(); })
      .catch(function () { _dataPromise = null; return _data || fallbackData(); });
    return _dataPromise;
  }
  function fallbackData() { return { currentDate: parisDate(), latestPublishedArticle: null, latestPublishedVideo: null }; }

  /* ---------- résolveur serveur optionnel (connecté) ---------- */
  var serverResolver = null; // function() -> Promise<{player:bool, career:bool}>
  function setServerStateResolver(fn) { serverResolver = (typeof fn === 'function') ? fn : null; }

  /* ---------- préchargement de l'autre jeu ---------- */
  var _preloaded = {};
  function preload(id) {
    var g = GAMES[id]; if (!g || _preloaded[id]) return; _preloaded[id] = true;
    (g.assets || []).forEach(function (u) {
      try { var l = doc.createElement('link'); l.rel = 'prefetch'; l.href = u; l.as = /\.css$/.test(u) ? 'style' : 'script'; doc.head.appendChild(l); } catch (e) {}
    });
  }

  /* ---------- construction du DOM ---------- */
  var root = null, dialog = null, lastFocus = null, selfId = null, keydownHandler = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function build() {
    root = doc.createElement('div');
    root.className = 'tsf-cx';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'tsf-cx-title');
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
      '<div class="tsf-cx__backdrop" data-cx-close></div>' +
      '<div class="tsf-cx__dialog" tabindex="-1">' +
        '<header class="tsf-cx__header">' +
          '<p class="tsf-cx__eyebrow" data-cx="eyebrow">PROLONGEZ L\'EXPÉRIENCE</p>' +
          '<h2 class="tsf-cx__title" id="tsf-cx-title" data-cx="title">LE MATCH CONTINUE</h2>' +
          '<p class="tsf-cx__sub" data-cx="sub"></p>' +
          '<span class="tsf-cx__pill" data-cx="pill"></span>' +
          '<button class="tsf-cx__close" type="button" aria-label="Fermer" data-cx-close><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
        '</header>' +
        '<div class="tsf-cx__body">' +
          '<article class="tsf-cx__hero" data-cx="hero">' +
            '<div class="tsf-cx__art"></div><div class="tsf-cx__glow"></div><div class="tsf-cx__shade"></div>' +
            '<div class="tsf-cx__hero-content">' +
              '<div class="tsf-cx__hero-top">' +
                '<span class="tsf-cx__badge" data-cx="badge"></span>' +
                '<span class="tsf-cx__kicker" data-cx="kicker"></span>' +
              '</div>' +
              '<p class="tsf-cx__hero-eyebrow" data-cx="heroEyebrow">IL VOUS RESTE UN DÉFI</p>' +
              '<h3 class="tsf-cx__name" data-cx="name"></h3>' +
              '<p class="tsf-cx__desc" data-cx="desc"></p>' +
              '<p class="tsf-cx__info tsf-cx__hidden" data-cx="info"><span class="dot"></span><span data-cx="infoTxt"></span></p>' +
              '<a class="tsf-cx__cta" data-cx="cta" href="#"><span data-cx="ctaTxt"></span><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>' +
            '</div>' +
          '</article>' +
          '<div class="tsf-cx__done" data-cx="done"><span class="chk"><svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg></span><span data-cx="doneTxt"></span><span class="tag">DÉFI VALIDÉ</span></div>' +
          '<div class="tsf-cx__secondary" data-cx="secondary">' +
            '<a class="tsf-cx__tile art tsf-cx__order-article" data-cx="article" href="#">' +
              '<div class="tsf-cx__media"><img alt="" data-cx="artImg"><span class="tsf-cx__tbadge art">Dernier article</span></div>' +
              '<div class="tsf-cx__tbody"><span class="tsf-cx__tkicker" data-cx="artKicker"></span><span class="tsf-cx__ttitle" data-cx="artTitle"></span><span class="tsf-cx__tmeta" data-cx="artMeta"></span>' +
              '<span class="tsf-cx__tcta"><span>LIRE L\'ARTICLE</span><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span></div>' +
            '</a>' +
            '<a class="tsf-cx__tile yt tsf-cx__order-video" data-cx="video" href="#" target="_blank" rel="noopener">' +
              '<div class="tsf-cx__media"><img alt="" data-cx="vidImg"><span class="tsf-cx__tbadge yt">Dernière vidéo</span><span class="tsf-cx__dur tsf-cx__hidden" data-cx="vidDur"></span>' +
              '<span class="tsf-cx__play"><span><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span></span></div>' +
              '<div class="tsf-cx__tbody"><span class="tsf-cx__tkicker">YouTube · TomsoFoot</span><span class="tsf-cx__ttitle" data-cx="vidTitle"></span><span class="tsf-cx__tmeta">Nouvelle vidéo de la chaîne</span>' +
              '<span class="tsf-cx__tcta"><span>VOIR LA VIDÉO</span><svg viewBox="0 0 24 24"><path d="M14 3h7v7M21 3l-9 9M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg></span></div>' +
            '</a>' +
          '</div>' +
        '</div>' +
        '<footer class="tsf-cx__footer"><span class="tsf-cx__brand">TOMSO<i>FOOT</i></span><span class="tsf-cx__rule"></span><span class="tsf-cx__hint">Échap ou clic extérieur pour fermer</span></footer>' +
      '</div>';
    doc.body.appendChild(root);
    dialog = root.querySelector('.tsf-cx__dialog');
    // Fermetures
    root.querySelectorAll('[data-cx-close]').forEach(function (el) {
      el.addEventListener('click', function (e) { if (el.classList.contains('tsf-cx__backdrop') && e.target !== el) return; close(); });
    });
  }
  function q(name) { return root.querySelector('[data-cx="' + name + '"]'); }

  /* ---------- rendu selon l'état ---------- */
  function render(states, data) {
    var playerDone = states.player, careerDone = states.career, bothDone = playerDone && careerDone;
    // Grande carte = jeu NON terminé (règle fondamentale). Repli : l'autre jeu que la page courante.
    var targetKey;
    if (bothDone) targetKey = (selfId === 'daily-player') ? 'career-mode' : 'daily-player';
    else if (!playerDone && !careerDone) targetKey = (selfId === 'daily-player') ? 'career-mode' : 'daily-player';
    else targetKey = !playerDone ? 'daily-player' : 'career-mode';
    var doneKey = targetKey === 'daily-player' ? 'career-mode' : 'daily-player';
    var t = GAMES[targetKey], d = GAMES[doneKey];

    var hero = q('hero');
    hero.className = 'tsf-cx__hero ' + t.cls + (bothDone ? ' done-secondary' : ' is-primary');
    q('kicker').textContent = t.kicker;
    q('name').textContent = t.name;
    q('desc').textContent = t.desc;
    var cta = q('cta'); cta.setAttribute('href', t.route); q('ctaTxt').textContent = t.cta;
    var info = q('info');
    if (t.info && !bothDone) { info.classList.remove('tsf-cx__hidden'); q('infoTxt').textContent = t.info; }
    else info.classList.add('tsf-cx__hidden');

    var badge = q('badge');
    if (!bothDone) {
      q('eyebrow').textContent = "PROLONGEZ L'EXPÉRIENCE";
      q('title').textContent = 'LE MATCH CONTINUE';
      q('sub').textContent = 'Votre défi est terminé. Il reste encore du football à vivre.';
      var pill = q('pill'); pill.className = 'tsf-cx__pill'; pill.innerHTML = '<span>1<b>/2</b> défi joué</span>';
      badge.className = 'tsf-cx__badge'; badge.textContent = "À JOUER AUJOURD'HUI";
      q('done').style.display = ''; q('doneTxt').textContent = d.label + ' — TERMINÉ';
      preload(targetKey); // navigation rapide
    } else {
      q('eyebrow').textContent = 'JOURNÉE PARFAITE';
      q('title').textContent = 'VOS DEUX DÉFIS SONT TERMINÉS';
      q('sub').textContent = "Merci d'avoir joué aujourd'hui. Le football continue sur TomsoFoot.";
      var pill2 = q('pill'); pill2.className = 'tsf-cx__pill ok'; pill2.innerHTML = '<span>2<b>/2</b> DÉFIS TERMINÉS</span>';
      badge.className = 'tsf-cx__badge done'; badge.textContent = 'DÉJÀ TERMINÉ';
      q('done').style.display = 'none';
    }

    // Article
    var art = data && data.latestPublishedArticle, aEl = q('article');
    if (art && art.url) {
      aEl.classList.remove('tsf-cx__hidden');
      aEl.setAttribute('href', art.url);
      var img = q('artImg'); img.src = art.image || ''; img.alt = art.alt || art.title || '';
      q('artKicker').textContent = art.category || 'Article';
      q('artTitle').textContent = art.title || '';
      q('artMeta').textContent = [art.readingTime ? (art.readingTime + ' min de lecture') : '', art.dateLabel || ''].filter(Boolean).join(' · ');
    } else aEl.classList.add('tsf-cx__hidden');

    // Vidéo
    var vid = data && data.latestPublishedVideo, vEl = q('video');
    if (vid && vid.url) {
      vEl.classList.remove('tsf-cx__hidden');
      vEl.setAttribute('href', vid.url);
      var vimg = q('vidImg'); vimg.src = vid.thumbnail || ''; vimg.alt = vid.title || '';
      q('vidTitle').textContent = vid.title || '';
      var dur = q('vidDur'); if (vid.duration) { dur.classList.remove('tsf-cx__hidden'); dur.textContent = vid.duration; } else dur.classList.add('tsf-cx__hidden');
    } else vEl.classList.add('tsf-cx__hidden');

    // Une seule proposition restante -> elle occupe l'espace
    var only = ((art && art.url) ? 1 : 0) + ((vid && vid.url) ? 1 : 0);
    q('secondary').style.gridTemplateColumns = (only < 2) ? '1fr' : '';
  }

  /* ---------- ouverture / fermeture + accessibilité ---------- */
  function focusables() {
    return Array.prototype.slice.call(root.querySelectorAll('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])'))
      .filter(function (el) { return el.offsetParent !== null && !el.closest('.tsf-cx__hidden'); });
  }
  function onKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      var f = focusables(); if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  function doOpen(states) {
    if (!root) build();
    fetchData().then(function (data) {
      render(states, data);
      root.setAttribute('aria-hidden', 'false');
      root.classList.add('is-open');
      doc.body.classList.add('tsf-cx-lock');
      lastFocus = doc.activeElement;
      keydownHandler = onKeydown; doc.addEventListener('keydown', keydownHandler, true);
      setTimeout(function () { try { (root.querySelector('.tsf-cx__close') || dialog).focus(); } catch (e) {} }, 30);
      // Confirmation serveur silencieuse (connecté) : re-rendu si l'état diffère.
      if (serverResolver) {
        try {
          Promise.resolve(serverResolver()).then(function (srv) {
            if (srv && (srv.player !== states.player || srv.career !== states.career)) {
              if (srv.player) markCompleted('daily-player'); if (srv.career) markCompleted('career-mode');
              if (root.classList.contains('is-open')) render(srv, _data || data);
            }
          }).catch(function () {});
        } catch (e) {}
      }
    });
  }
  function close() {
    if (!root) return;
    root.classList.remove('is-open');
    root.setAttribute('aria-hidden', 'true');
    doc.body.classList.remove('tsf-cx-lock');
    if (keydownHandler) { doc.removeEventListener('keydown', keydownHandler, true); keydownHandler = null; }
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }

  function currentStates() { return { player: isDone('daily-player'), career: isDone('career-mode') }; }

  /* ---------- API publique ---------- */
  var API = {
    // À appeler par un jeu quand SA partie officielle vient de se terminer (frais).
    // opts.state : 'completed' (victoire) | 'revealed' (réponse révélée). opts.delay : ms (def. 1500).
    notifyFinished: function (id, opts) {
      opts = opts || {};
      selfId = id;
      markCompleted(id, opts.state || 'completed');
      if (popupShown(id)) return;                 // déjà ouvert automatiquement aujourd'hui pour ce jeu
      var delay = (opts.delay != null) ? opts.delay : 1500;
      setTimeout(function () {
        if (popupShown(id)) return;
        setPopupShown(id);                         // une seule ouverture auto / jeu / jour
        doOpen(currentStates());
      }, delay);
    },
    // Réouverture manuelle (bouton « Continuer sur TomsoFoot ») — ignore le garde once/day.
    open: function (fromId) { if (fromId) selfId = fromId; doOpen(currentStates()); },
    close: close,
    markCompleted: markCompleted,
    isDone: isDone,
    setSelf: function (id) { selfId = id; },
    setServerStateResolver: setServerStateResolver,
    preload: preload,
    parisDate: parisDate,
    // Injecte un bouton discret « Continuer sur TomsoFoot » dans un conteneur (écran de fin).
    mountReopenButton: function (container, fromId) {
      if (!container) return null;
      if (container.querySelector('.tsf-cx-reopen')) return container.querySelector('.tsf-cx-reopen');
      var b = doc.createElement('button');
      b.type = 'button'; b.className = 'tsf-cx-reopen';
      b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg><span>CONTINUER SUR TOMSOFOOT</span>';
      b.addEventListener('click', function () { API.open(fromId); });
      container.appendChild(b);
      return b;
    }
  };
  global.TomsoFootContinue = API;
})(window);
