/* Ajuste uniquement la taille du titre. Son texte reste intégral et sélectionnable. */
(() => {
  const title = document.getElementById('hero-title');
  const panel = document.getElementById('hero-inner');
  if (!title || !panel) return;
  const minSize = 28;
  const preferredLines = 3;
  let frame = 0, previousWidth = -1;
  function fitTitle() {
    frame = 0;
    if (!title.clientWidth) return;
    title.style.removeProperty('font-size');
    const maxSize = parseFloat(getComputedStyle(title).fontSize);
    const fits = size => {
      title.style.fontSize = size + 'px';
      const lineHeight = parseFloat(getComputedStyle(title).lineHeight);
      return title.scrollHeight <= lineHeight * preferredLines + 1
        && title.scrollWidth <= title.clientWidth + 1;
    };
    if (fits(maxSize)) return;
    let low = Math.min(minSize, maxSize), high = maxSize;
    // Si trois lignes ne suffisent pas à cette taille, le bloc grandit : jamais de coupe.
    if (!fits(low)) return;
    for (let step = 0; step < 9; step++) {
      const middle = (low + high) / 2;
      if (fits(middle)) low = middle;
      else high = middle;
    }
    title.style.fontSize = (Math.floor(low * 10) / 10) + 'px';
  }
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fitTitle); };
  // La taille est recalculée pour un nouveau titre, la largeur disponible et les polices.
  new MutationObserver(schedule).observe(title, {childList:true, characterData:true, subtree:true});
  new ResizeObserver(entries => {
    const width = entries[0].contentRect.width;
    if (Math.abs(width - previousWidth) < 0.5) return;
    previousWidth = width;
    schedule();
  }).observe(panel);
  window.addEventListener('resize', schedule, {passive:true});
  if (document.fonts) {
    document.fonts.ready.then(schedule);
    document.fonts.addEventListener('loadingdone', schedule);
  }
  schedule();
})();
