/* taxonomy.js — Source UNIQUE du classement TomsoFoot (zones, compétitions,
 * rubriques) + normalisation des anciennes valeurs libres (mapping d'alias).
 *
 * Trois AXES distincts, à ne pas mélanger :
 *   - zone        : périmètre géographique (Monde, Europe, France, Angleterre…)
 *   - competition : épreuve (Ligue 1, Premier League, LaLiga…), rattachée à une zone
 *   - rubrique    : genre éditorial (Analyse, Récit, Portrait, Histoire…)
 *
 * Chaque entrée a un CODE stable (kebab-case, jamais traduit/renommé) et un
 * LABEL affiché (FR). Les codes sont ce qu'on stocke en base ; les libellés
 * peuvent évoluer sans casser les données.
 *
 * Chargé en <script src> classique : expose window.TFTaxo. Utilisable aussi
 * comme module (export en bas).
 */
(function (root) {
  'use strict';

  var ZONES = [
    { code: 'monde',        label: 'Monde' },
    { code: 'europe',       label: 'Europe' },
    { code: 'france',       label: 'France' },
    { code: 'angleterre',   label: 'Angleterre' },
    { code: 'espagne',      label: 'Espagne' },
    { code: 'italie',       label: 'Italie' },
    { code: 'allemagne',    label: 'Allemagne' },
    { code: 'amerique-sud', label: 'Amérique du Sud' },
    { code: 'afrique',      label: 'Afrique' },
    { code: 'autre',        label: 'Autre / International' },
  ];

  // Chaque compétition porte sa zone implicite (pré-remplissage de la régie).
  var COMPETITIONS = [
    { code: 'coupe-du-monde',      label: 'Coupe du monde',        zone: 'monde' },
    { code: 'euro',                label: 'Championnat d’Europe', zone: 'europe' },
    { code: 'ligue-des-nations',   label: 'Ligue des Nations',     zone: 'europe' },
    { code: 'ligue-des-champions', label: 'Ligue des Champions',   zone: 'europe' },
    { code: 'ligue-europa',        label: 'Ligue Europa',          zone: 'europe' },
    { code: 'ligue-conference',    label: 'Ligue Conférence', zone: 'europe' },
    { code: 'ligue-1',             label: 'Ligue 1',               zone: 'france' },
    { code: 'premier-league',      label: 'Premier League',        zone: 'angleterre' },
    { code: 'laliga',              label: 'LaLiga',                zone: 'espagne' },
    { code: 'serie-a',             label: 'Serie A',               zone: 'italie' },
    { code: 'bundesliga',          label: 'Bundesliga',            zone: 'allemagne' },
    { code: 'copa-america',        label: 'Copa América',     zone: 'amerique-sud' },
    { code: 'autre',               label: 'Autre / Hors compétition', zone: 'autre' },
  ];

  var RUBRIQUES = [
    { code: 'analyse',      label: 'Analyse' },
    { code: 'recit',        label: 'Récit' },
    { code: 'portrait',     label: 'Portrait' },
    { code: 'histoire',     label: 'Histoire' },
    { code: 'edito',        label: 'Édito' },
    { code: 'entretien',    label: 'Entretien' },
    { code: 'reportage',    label: 'Reportage' },
    { code: 'chronique',    label: 'Chronique' },
    { code: 'grand-format', label: 'Grand format' },
    { code: 'tactique',     label: 'Tactique' },
  ];

  function _norm(s) {
    return (s || '').toString().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')  // enlève accents
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Table d'alias (valeurs libres historiques → code canonique).
  var COMPETITION_ALIAS = {
    'coupe du monde': 'coupe-du-monde', 'mondial': 'coupe-du-monde', 'world cup': 'coupe-du-monde',
    'euro': 'euro', 'championnat d europe': 'euro', 'euro 2024': 'euro',
    'ligue des nations': 'ligue-des-nations', 'nations league': 'ligue-des-nations',
    'ligue des champions': 'ligue-des-champions', 'champions league': 'ligue-des-champions', 'ldc': 'ligue-des-champions', 'c1': 'ligue-des-champions',
    'ligue europa': 'ligue-europa', 'europa league': 'ligue-europa', 'c3': 'ligue-europa',
    'ligue conference': 'ligue-conference', 'conference league': 'ligue-conference', 'europa conference league': 'ligue-conference',
    'ligue 1': 'ligue-1', 'l1': 'ligue-1', 'ligue1': 'ligue-1',
    'premier league': 'premier-league', 'pl': 'premier-league',
    'laliga': 'laliga', 'la liga': 'laliga', 'liga': 'laliga',
    'serie a': 'serie-a', 'seria a': 'serie-a',
    'bundesliga': 'bundesliga',
    'copa america': 'copa-america',
  };
  var RUBRIQUE_ALIAS = {
    'analyse': 'analyse',
    'recit': 'recit', 'recits': 'recit',
    'portrait': 'portrait', 'portraits': 'portrait',
    'histoire': 'histoire', 'histoires': 'histoire',
    'edito': 'edito', 'editorial': 'edito',
    'entretien': 'entretien', 'entretiens': 'entretien', 'interview': 'entretien',
    'reportage': 'reportage', 'reportages': 'reportage',
    'chronique': 'chronique', 'chroniques': 'chronique',
    'grand format': 'grand-format',
    'tactique': 'tactique',
  };

  function _index(list) { var m = {}; list.forEach(function (x) { m[x.code] = x; }); return m; }
  var ZI = _index(ZONES), CI = _index(COMPETITIONS), RI = _index(RUBRIQUES);

  function zoneLabel(code) { return (ZI[code] && ZI[code].label) || ''; }
  function competitionLabel(code) { return (CI[code] && CI[code].label) || ''; }
  function rubriqueLabel(code) { return (RI[code] && RI[code].label) || ''; }
  function zoneForCompetition(code) { return (CI[code] && CI[code].zone) || ''; }

  // Normalise une valeur libre vers un code canonique (ou '' si inconnu).
  function canonCompetition(v) { if (CI[v]) return v; return COMPETITION_ALIAS[_norm(v)] || ''; }
  function canonRubrique(v) { if (RI[v]) return v; return RUBRIQUE_ALIAS[_norm(v)] || ''; }
  function canonZone(v) { if (ZI[v]) return v; var n = _norm(v).replace(/\s+/g, '-'); return ZI[n] ? n : ''; }

  // Range une ancienne « category » libre sur le bon axe. Renvoie ce qui a matché.
  function classifyLegacy(freeText) {
    var comp = canonCompetition(freeText);
    if (comp) return { competition: comp, zone: zoneForCompetition(comp), rubrique: '' };
    var rub = canonRubrique(freeText);
    if (rub) return { competition: '', zone: '', rubrique: rub };
    var z = canonZone(freeText);
    if (z) return { competition: '', zone: z, rubrique: '' };
    return { competition: '', zone: '', rubrique: '' };
  }

  var api = {
    ZONES: ZONES, COMPETITIONS: COMPETITIONS, RUBRIQUES: RUBRIQUES,
    zoneLabel: zoneLabel, competitionLabel: competitionLabel, rubriqueLabel: rubriqueLabel,
    zoneForCompetition: zoneForCompetition,
    canonZone: canonZone, canonCompetition: canonCompetition, canonRubrique: canonRubrique,
    classifyLegacy: classifyLegacy,
  };
  root.TFTaxo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
