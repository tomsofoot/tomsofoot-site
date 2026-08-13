// accessibility.js — utilitaires d'accessibilité isolés.
// Détection du "mouvement réduit", piège de focus léger, annonces ARIA.

export function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function onReducedMotionChange(cb) {
  if (!window.matchMedia) return () => {};
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const handler = () => cb(mq.matches);
  mq.addEventListener ? mq.addEventListener('change', handler) : mq.addListener(handler);
  return () => (mq.removeEventListener ? mq.removeEventListener('change', handler) : mq.removeListener(handler));
}

// Région live pour annoncer le changement de page aux lecteurs d'écran.
export function createAnnouncer() {
  const el = document.createElement('div');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.className = 'mr-sr-only';
  document.body.appendChild(el);
  return {
    announce(msg) { el.textContent = msg; },
    destroy() { el.remove(); },
  };
}

// Détection basique d'un écran tactile (pour adapter les indices d'aide).
export function isTouch() {
  return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
}
