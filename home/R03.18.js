/* Une classe et un pictogramme identiques ; libellés et actions restent en place. */
(() => {
  const targets = '#hero-cta, #jogadle-card .daily-action button, #mode-carriere .feature-copy > a, #live .twitch-watch';
  document.querySelectorAll(targets).forEach(button => {
    button.classList.add('tf-premium-cta');
    if (button.querySelector('.tf-cta-icon')) return;
    // Remplacer seulement la flèche décorative déjà présente.
    button.querySelectorAll(':scope > svg, :scope > span[aria-hidden="true"]').forEach(icon => icon.remove());
    const arrow = document.createElement('span');
    arrow.className = 'tf-cta-icon';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
    button.append(arrow);
  });
})();
