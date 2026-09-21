/* Même article sélectionné et même option de cadrage que les données de la régie. */
(() => {
  const card = document.getElementById('hero-une');
  const img = card?.querySelector('.hero-visual img');
  if (!img) return;
  const articles = window.TF_DATA?.articles || [];
  const article = articles.find(item => item.featured) || articles[0];
  // Une option absente ne vaut jamais autorisation de recadrer.
  card.dataset.imageFit = article?.hero_cover === true ? 'cover' : 'natural';
  const loaded = () => {
    if (!img.naturalWidth || !img.naturalHeight) return;
    img.width = img.naturalWidth;
    img.height = img.naturalHeight;
    delete card.dataset.imageMissing;
  };
  img.addEventListener('load', loaded);
  img.addEventListener('error', () => { card.dataset.imageMissing = ''; });
  if (img.complete) {
    if (img.naturalWidth) loaded();
    else card.dataset.imageMissing = '';
  }
})();
