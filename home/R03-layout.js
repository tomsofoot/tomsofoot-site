/* R03 : déplacement des nœuds existants. Aucun contenu cloné ou supprimé. */
(() => {
  'use strict';
  if (document.body.dataset.proposal !== 'R03') return;
  const $ = selector => document.querySelector(selector);
  const main = $('#main'), games = $('#formats'), editorial = $('#editorial');
  if (!main || !games || !editorial) return;
  const frame = className => Object.assign(document.createElement('div'), {className});
  const top = frame('r03-top-grid shell');
  const media = frame('r03-media-stack');
  const stories = frame('r03-stories-grid shell');
  // Le DOM et le parcours clavier suivent la lecture : haut, gauche, centre, droite.
  media.append($('#coup-denvoi'), $('#live'));
  top.append(games, media);
  stories.append($('#derniers-articles'), $('#match-center'));
  main.prepend(editorial, top, stories);
  // Le même slogan et le même titre sont placés dans le bandeau éditorial.
  const editorialHeading = editorial.querySelector('.section-head');
  editorialHeading.classList.add('r03-editorial-heading');
  $('#hero-inner').prepend(editorialHeading);
  const gamesHeading = games.querySelector('.section-head');
  top.prepend(gamesHeading);
  gamesHeading.classList.add('r03-games-heading');
  // Dans les cartes compactes, un espace remplace le saut de ligne du titre.
  document.querySelectorAll('.kickoff-brand-copy h2 br,.twitch-stage h2 br').forEach(br => br.replaceWith(document.createTextNode(' ')));
  // La pagination existante se recalcule après le passage des matchs en colonne.
  window.TF_MATCH_CARDS?.render();
  document.body.classList.add('r03-ready');
})();
