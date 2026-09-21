/* Les champs absents ne créent ni étiquette vide ni information de remplacement. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TFMatchInfo = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  'use strict';
  function knownText(value) {
    if (typeof value !== 'string') return '';
    const text = value.trim();
    const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return /^(?:non communique(?:e|s|es)?(?: pour la france)?|non renseigne(?:e)?|inconnu(?:e)?|indisponible|a confirmer|tbd|tba|n\/?a|unknown|null|undefined|[-–—])\.?$/.test(normalized) ? '' : text;
  }
  function fields(data = {}) {
    const result = [], venue = knownText(data.venue), referee = knownText(data.referee) || knownText(data.arbitre);
    if (venue) result.push({label: 'Le stade', value: venue, detail: knownText(data.city)});
    const broadcasts = [...new Set((Array.isArray(data.broadcasts) ? data.broadcasts : []).map(knownText).filter(Boolean))];
    if (broadcasts.length) result.push({label: 'Diffusion · FR', value: broadcasts.join(' · ')});
    if (referee) result.push({label: 'L’arbitre', value: referee});
    return result;
  }
  return {knownText, fields};
});
