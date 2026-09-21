/* Club : on déplace les blocs existants, leurs identifiants et leurs écouteurs restent intacts. */
(() => {
  'use strict';
  if (document.body.dataset.style !== 'club') return;
  const $ = selector => document.querySelector(selector);
  const main = $('#main'), games = $('#formats'), hero = $('#hero-une');
  if (!main || !games || !hero) return;
  const data = window.TF_DATA;
  const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  function section(id, classes) {
    const node = document.createElement('section');
    node.id = id; node.className = classes;
    return node;
  }
  function heading(id, kicker, title) {
    return `<div class="section-head"><div><span class="kicker">${kicker}</span><h2 id="${id}">${title}</h2></div></div>`;
  }
  function changeHeading(node, tagName) {
    const replacement = document.createElement(tagName);
    for (const attribute of node.attributes) replacement.setAttribute(attribute.name, attribute.value);
    replacement.append(...node.childNodes); node.replaceWith(replacement);
  }

  // 1. Les deux jeux, avec Jogadle comme titre principal de la page.
  const career = $('#mode-carriere'), youtube = $('.feature.youtube'), live = $('.live-card'), films = $('.feature.films');
  document.querySelectorAll('#app img[src="/home/assets/manager-reference.jpg"],#game-choice img[src="/home/assets/manager-reference.jpg"]').forEach(image => { image.src = '/home/assets/mode-carriere-premium.webp'; });
  games.classList.add('home-games');
  games.setAttribute('aria-labelledby', 'games-heading');
  games.querySelector('.section-head').innerHTML = '<div><span class="kicker">Les jeux TomsoFoot</span><h2 id="games-heading">Choisissez votre terrain</h2></div><a class="career-shortcut" href="#mode-carriere">Mode Carrière '+arrow+'</a>';
  games.querySelector('.experience-grid').append(career);
  changeHeading($('.fc-copy h3'), 'h1');

  // L'article conserve son rendez-vous éditorial ; le magazine quitte l'accueil.
  const editorial = section('editorial', 'home-editorial section shell');
  editorial.setAttribute('aria-labelledby', 'editorial-heading');
  editorial.innerHTML = heading('editorial-heading', 'Le football, raconté autrement', 'À la une') + '<div class="editorial-grid"></div>';
  hero.classList.remove('shell');
  changeHeading($('#hero-title'), 'h3');
  editorial.querySelector('.editorial-grid').append(hero);
  $('#cms-bandeau').textContent = 'À la une · ' + hero.querySelector('#hero-title').textContent;
  document.querySelectorAll('#app a[href*="/magazine/"]').forEach(link => {
    if (link.closest('.mobile-tabs,.bottom-nav')) {
      link.href = '#coup-denvoi';
      link.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7Z"/></svg><span>Vidéos</span>';
    } else link.remove();
  });
  document.querySelector('[data-count="magazine"]')?.closest('span')?.remove();
  const ticker = $('.now-rail'); ticker.classList.remove('shell'); editorial.append(ticker);

  // 3. Les archives et rubriques restent disponibles sans couper le fil de l'accueil.
  const latest = $('#derniers-articles'), archives = $('#archives'), rubrics = $('.rubrics');
  const explorer = document.createElement('details'); explorer.className = 'article-explorer';
  explorer.innerHTML = '<summary><span>Parcourir par compétition<small>Les archives et toutes les rubriques</small></span><span class="explorer-plus" aria-hidden="true">+</span></summary>';
  archives.classList.remove('shell'); rubrics.classList.remove('shell');
  explorer.append(rubrics, archives); latest.append(explorer);
  function revealArchives() {
    if (location.hash !== '#archives') return;
    explorer.open = true;
    requestAnimationFrame(() => archives.scrollIntoView({block: 'start'}));
  }
  window.addEventListener('hashchange', revealArchives); revealArchives();

  // 4. Le module documentaire complet conserve sa sélection et son carrousel.
  const docs = $('#videos');
  docs.querySelector('.section-head .kicker').textContent = films.querySelector('.kicker').textContent;
  const filmLink = films.querySelector('.feature-copy a');
  filmLink.className = 'see-all';
  // Le lien et son contenu sont repris dans le module complet : pas de carte doublon.
  filmLink.href = 'https://www.youtube.com/@Tomso-Foot';
  docs.querySelector('.section-head .see-all').replaceWith(filmLink); films.remove();

  // 5. La chaîne dispose de son propre emplacement, après les documentaires.
  const kickoff = section('coup-denvoi', 'home-kickoff section shell');
  kickoff.setAttribute('aria-labelledby', 'kickoff-heading');
  youtube.querySelector('h3').id = 'kickoff-heading';
  changeHeading(youtube.querySelector('h3'), 'h2');
  kickoff.append(youtube);

  // 6. Seul un état explicitement « live » peut afficher le grand visuel Twitch.
  const liveSection = section('live', 'home-live shell');
  liveSection.setAttribute('aria-label', 'Le Live TomsoFoot');
  liveSection.append(live);

  // Les rencontres remontent juste après les jeux ; les classements restent plus bas.
  const matches = $('#match-center');
  matches.classList.add('home-live-matches');
  matches.querySelector('h2').textContent = 'Match en direct';
  matches.querySelector('.kicker').textContent = 'En cours et à venir';
  const football = section('football', 'home-football');
  football.setAttribute('aria-label', 'Les classements');
  football.append(...[$('#classements')].filter(Boolean));
  main.append(...[games, $('#game-reminders'), matches, editorial, latest, football, docs, kickoff, liveSection, $('#newsletter'), $('#vision')].filter(Boolean));
  document.body.classList.add('home-ready');
})();
