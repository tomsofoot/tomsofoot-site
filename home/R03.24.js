(() => {
  const image = document.querySelector('#game-choice .game-options a[href$="/jeu"] > img');
  if (!image) return;
  image.src = '/home/assets/jogadle-choix-stade.png';
  image.alt = 'Trois joueurs mystères dans un stade éclairé en bleu';
  image.classList.add('jogadle-choice-image');
})();
