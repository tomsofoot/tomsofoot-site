(() => {
  const front=document.querySelector('#jogadle-card .fc-player');
  if(!front||front.closest('.fc-player-stack'))return;
  // Le second visuel est décoratif : il ne représente pas un nouvel indice.
  const back=front.cloneNode(true);
  back.classList.add('fc-player-back');
  back.setAttribute('aria-hidden','true');
  const silhouette=back.querySelector('.mystery-player');
  silhouette.src='/home/assets/jogadle-silhouette-cr7.png';
  silhouette.alt='';
  front.classList.add('fc-player-front');
  const stack=document.createElement('div');
  stack.className='fc-player-stack';
  front.replaceWith(stack);
  stack.append(back,front);
})();
