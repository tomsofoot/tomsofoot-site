/* Repères de collaboration : aucun texte, style, lien ou ordre du site n'est modifié. */
(() => {
  'use strict';
  async function identify() {
    if(document.body.dataset.style !== 'club') return;
    try {
      const response = await fetch('/home/R03.19-content-identifiers.json');
      if(!response.ok) return;
      const blocks = await response.json();
      for(const block of blocks) {
        const element = document.querySelector(block.selector);
        if(element) element.dataset.contentId = block.code;
      }
    } catch { /* Un repère indisponible ne gêne jamais le fonctionnement du site. */ }
  }
  if(window.TF_HOME?.assembling)window.addEventListener('tomsofoot:home-ready',identify,{once:true});
  else if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',identify,{once:true});else identify();
})();
