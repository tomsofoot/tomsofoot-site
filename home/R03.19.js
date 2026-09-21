/* Déplacer le bloc existant conserve ses filtres, ses liens et ses écouteurs. */
(() => {
  const explorer = document.querySelector('.article-explorer');
  const documentaries = document.getElementById('videos');
  if (!explorer || !documentaries) return;
  explorer.id = 'archives-explorer';
  explorer.classList.add('shell', 'r03-archives-panel');
  explorer.dataset.contentId = '5b';
  explorer.open = true;
  documentaries.after(explorer);
})();
