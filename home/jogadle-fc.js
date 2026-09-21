(()=>{
  'use strict';
  const card=document.querySelector('[data-style="club"] .daily-poster');
  if(!card||card.classList.contains('daily-fc'))return;
  const kicker=card.querySelector(':scope > .kicker'),title=card.querySelector('h3'),description=card.querySelector(':scope > p'),poster=card.querySelector('.mystery-player');
  if(!kicker||!title||!description||!poster)return;
  card.classList.add('daily-fc');card.id='jogadle-card';
  const field=document.createElement('div');field.className='fc-field';field.setAttribute('aria-hidden','true');field.innerHTML='<i></i><i></i><i></i>';
  const top=document.createElement('div');top.className='fc-topline';top.append(kicker);const signal=document.createElement('span');signal.className='fc-signal';signal.setAttribute('aria-hidden','true');signal.innerHTML='<i></i><i></i><i></i><i></i>';top.append(signal);
  const main=document.createElement('div');main.className='fc-main';const copy=document.createElement('div');copy.className='fc-copy';copy.append(title,description);
  const player=document.createElement('div');player.className='fc-player';
  const image=document.createElement('div');image.className='fc-player-image';image.append(poster);
  const graphics=document.createElement('div');graphics.className='fc-player-graphics';graphics.setAttribute('aria-hidden','true');graphics.innerHTML='<span class="fc-player-question">?</span><span class="fc-player-wordmark">JOGADLE</span><span class="fc-player-chevron"></span>';
  player.append(image,graphics);main.append(copy,player);card.prepend(field,top,main);
})();
