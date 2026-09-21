/* Décoration réutilisable : aucun lien, texte ou gestionnaire d'action modifié. */
(() => {
  'use strict';
  const selector = 'button, a[href], summary, [role="button"], input[type="submit"], input[type="button"], input[type="reset"]';
  function decorate(element) {
    if (!(element instanceof HTMLElement) || !element.matches(selector)) return;
    if (!element.classList.contains('tf-glow-button')) {
      // L'ombre initiale est conservée pendant le halo, sans figer le style au repos.
      const shadow = getComputedStyle(element).boxShadow;
      if (shadow !== 'none') element.style.setProperty('--tf-rest-shadow', shadow);
      element.classList.add('tf-glow-button');
    }
    // Les inputs remplacés ne supportent pas les enfants : leur box-shadow suffit.
    if (element.tagName === 'INPUT' || element.querySelector(':scope > tf-glow-halo')) return;
    const halo = document.createElement('tf-glow-halo');
    halo.setAttribute('aria-hidden', 'true');
    element.append(halo);
  }
  function scan(root) {
    decorate(root);
    root.querySelectorAll?.(selector).forEach(decorate);
  }
  scan(document.body);
  // Les carrousels et dialogues recréent leurs commandes ; les décorer aussi.
  // Observer le parent rétablit le halo après un changement de textContent.
  new MutationObserver(records => {
    const roots = new Set();
    for (const record of records) {
      if (record.type === 'attributes') roots.add(record.target);
      else {
        roots.add(record.target);
        record.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'TF-GLOW-HALO') roots.add(node);
        });
      }
    }
    roots.forEach(root => {
      // Pas de scan global à chaque seconde du compte à rebours.
      decorate(root);
      if (root.nodeType === Node.ELEMENT_NODE && !root.matches(selector)) scan(root);
    });
  }).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'role']});
})();
