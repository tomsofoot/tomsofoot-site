// netlify/functions/lib/jog-auto-core.mjs
// Régie automatisée — MOTEUR DE COMPARAISON (pur, testable hors-ligne). VERSION DURCIE.
// Règles : jamais de "certaine" sur un simple nom sans corroboration (date de naissance / id externe).
// Une absence de réponse n'est jamais un départ (géré en amont). Confiance : certaine|probable|ambigue.

const SPECIAL = { 'ø':'o','æ':'ae','œ':'oe','ł':'l','đ':'d','ð':'d','ı':'i','ß':'ss','þ':'th','ħ':'h','ŀ':'l','ŉ':'n' };
const SUFFIX = new Set(['jr', 'junior', 'sr', 'senior', 'ii', 'iii', 'iv']);

export function norm(s) {
  if (!s) return '';
  s = String(s).toLowerCase();
  s = s.replace(/[øæœłđðıßþħŀŉ]/g, c => SPECIAL[c] || c);
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  return s.replace(/\s+/g, ' ');
}
function tokens(s) { return norm(s).split(' ').filter(t => t && !SUFFIX.has(t)); }

// Nom exploitable : préfère prénom+nom (détails API), sinon le champ name.
export function apiFullName(p) {
  const fn = (p.firstname || '').trim(), ln = (p.lastname || '').trim();
  if (fn && ln) return fn + ' ' + ln;
  return (p.name || '').trim();
}
export function natKey(s) { return norm(s).replace(/\b(the|of|and|republic|dr)\b/g, '').replace(/\s+/g, ' ').trim(); }
function sameBirth(a, b) { return a && b && String(a).slice(0, 10) === String(b).slice(0, 10); }

// Formes normalisées d'un nom : ordre direct, ordre inversé (prénom/nom), et tri (insensible à l'ordre).
function nameForms(full) {
  const t = tokens(full), forms = new Set();
  if (!t.length) return forms;
  forms.add(t.join(' '));
  forms.add([...t].reverse().join(' '));
  forms.add([...t].sort().join(' '));
  return forms;
}
function uniqById(list) { const m = new Map(); (list || []).forEach(g => m.set(g.id, g)); return [...m.values()]; }

export function buildRosterIndex(roster) {
  const byExt = new Map();
  const byName = new Map();
  const byBirth = new Map(); // date de naissance -> [joueurs jeu] (rattrapage surnoms / noms d'usage)
  const add = (k, g) => { if (!k) return; if (!byName.has(k)) byName.set(k, []); byName.get(k).push(g); };
  for (const g of roster) {
    if (g.apisports_id != null) byExt.set(Number(g.apisports_id), g);
    for (const f of nameForms(g.name)) add(f, g);
    if (g.short_name) for (const f of nameForms(g.short_name)) add(f, g);
    const t = tokens(g.name); const last = t[t.length - 1];
    if (last) add('last:' + last, g);
    const b = g.birth_date ? String(g.birth_date).slice(0, 10) : '';
    if (b) { if (!byBirth.has(b)) byBirth.set(b, []); byBirth.get(b).push(g); }
  }
  return { byExt, byName, byBirth };
}

// Identité d'un joueur API dans le roster jeu + niveau de confiance.
export function identify(apiPlayer, idx) {
  const extId = Number(apiPlayer.ext_id);
  if (!Number.isNaN(extId) && idx.byExt.has(extId)) {
    return { match: idx.byExt.get(extId), confidence: 'certaine', reason: 'identifiant API-Sports connu' };
  }
  const full = apiFullName(apiPlayer);
  // Formes testées : nom complet (prénom + nom) ET nom d'usage API (« Pedri », « Vinícius Júnior »).
  const forms = new Set([...nameForms(full), ...nameForms(apiPlayer.name)]);
  let cand = [];
  for (const f of forms) cand = cand.concat(idx.byName.get(f) || []);
  cand = uniqById(cand);

  if (cand.length === 1) {
    const g = cand[0];
    if (sameBirth(apiPlayer.birth, g.birth_date)) return { match: g, confidence: 'certaine', reason: 'nom + date de naissance concordants' };
    return { match: g, confidence: 'probable', reason: 'nom concordant (naissance non vérifiée)' };
  }
  if (cand.length > 1) {
    const byBirth = cand.filter(g => sameBirth(apiPlayer.birth, g.birth_date));
    if (byBirth.length === 1) return { match: byBirth[0], confidence: 'certaine', reason: 'homonyme départagé par la date de naissance' };
    return { match: null, confidence: 'ambigue', reason: 'plusieurs joueurs portent ce nom', candidates: cand };
  }
  // rattrapage 1 : même date de naissance + au moins un morceau de nom en commun, et UN SEUL
  // joueur du jeu dans ce cas → certaine (ex. nom légal complet côté API vs nom d'usage côté jeu).
  const b = apiPlayer.birth ? String(apiPlayer.birth).slice(0, 10) : '';
  if (b && idx.byBirth && idx.byBirth.has(b)) {
    const apiTok = new Set([...tokens(full), ...tokens(apiPlayer.name)].filter(x => x.length >= 3));
    const hits = uniqById(idx.byBirth.get(b).filter(g =>
      [...tokens(g.name), ...tokens(g.short_name)].some(x => apiTok.has(x))));
    if (hits.length === 1) return { match: hits[0], confidence: 'certaine', reason: 'date de naissance + nom concordants (nom d\'usage)' };
  }
  // rattrapage 2 : nom de famille unique + date de naissance
  const t = tokens(full); const last = t[t.length - 1];
  const byLast = uniqById(idx.byName.get('last:' + last) || []);
  if (byLast.length === 1 && sameBirth(apiPlayer.birth, byLast[0].birth_date)) {
    return { match: byLast[0], confidence: 'probable', reason: 'nom de famille + naissance concordants' };
  }
  // rattrapage 3 : nom complet API qui CONTIENT le nom du jeu (« Adam James Wharton » ⊃ « Adam Wharton »,
  // « Jurriën David Norman Timber » ⊃ « Jurriën Timber »), même nom de famille, UN SEUL joueur du jeu.
  // Sans date de naissance concordante → « probable » (un humain valide).
  if (last) {
    const apiAll = new Set([...t, ...tokens(apiPlayer.name)]);
    const sub = byLast.filter(g => { const gt = tokens(g.name); return gt.length >= 2 && gt.every(x => apiAll.has(x)); });
    if (sub.length === 1) {
      return sameBirth(apiPlayer.birth, sub[0].birth_date)
        ? { match: sub[0], confidence: 'certaine', reason: 'nom complet + date de naissance concordants' }
        : { match: sub[0], confidence: 'probable', reason: 'nom complet API contenant le nom du jeu (naissance différente ou absente)' };
    }
  }
  return { match: null, confidence: 'probable', reason: 'joueur non présent dans le jeu (recrue)', isNew: true };
}

// Compare l'effectif API d'un club au roster jeu → propositions classées + liens d'identifiants à poser.
// opts.official : effectif OFFICIEL actuel du club (API-Sports /players/squads) = [{ id, name }].
// La liste « /players » (avec dates de naissance) ne contient que les joueurs déjà utilisés dans la
// saison : un titulaire blessé en est absent. L'effectif officiel sert donc (a) à ne PAS proposer de
// faux départs, (b) à repérer une arrivée d'un joueur déjà relié (par identifiant) qui n'a pas encore joué.
export function compareClub(apiSquad, gameRoster, club, league, opts = {}) {
  const idx = buildRosterIndex(gameRoster);
  const proposals = [];
  const matchedGameIds = new Set();
  // Liens à enregistrer (players.apisports_id) : joueurs reconnus de façon CERTAINE qui n'ont
  // pas encore d'identifiant API-Sports — y compris ceux déjà au bon club (le cas le plus courant).
  const links = [];

  for (const ap of apiSquad) {
    const full = apiFullName(ap);
    const r = identify(ap, idx);
    if (r.match) {
      matchedGameIds.add(r.match.id);
      if (r.confidence === 'certaine' && r.match.apisports_id == null && ap.ext_id != null) {
        links.push({ player_id: r.match.id, apisports_id: Number(ap.ext_id) });
      }
      if (r.match.club === club) continue; // déjà au club
      proposals.push({
        player_id: r.match.id, player_ext_id: ap.ext_id, player_name: r.match.name,
        movement_type: 'transfer', club_from: r.match.club, club_to: club,
        league_from: r.match.league, league_to: league,
        confidence: r.confidence, reason: r.reason,
        source: 'api-sports', observed_at: new Date().toISOString(),
      });
    } else if (r.confidence === 'ambigue') {
      proposals.push({
        player_id: null, player_ext_id: ap.ext_id, player_name: full,
        movement_type: 'transfer', club_from: null, club_to: club, league_from: null, league_to: league,
        confidence: 'ambigue', reason: r.reason, source: 'api-sports', observed_at: new Date().toISOString(),
      });
    } else if (r.isNew) {
      proposals.push({
        player_id: null, player_ext_id: ap.ext_id, player_name: full,
        movement_type: 'transfer', club_from: null, club_to: club, league_from: null, league_to: league,
        confidence: 'probable', reason: 'recrue à créer', source: 'api-sports', observed_at: new Date().toISOString(),
        is_new: true, position: ap.position || null, country: ap.nat || null, birth_date: ap.birth || null,
      });
    }
  }

  // Arrivées vues seulement dans l'effectif officiel (joueur déjà relié par identifiant, pas encore utilisé).
  const official = Array.isArray(opts.official) ? opts.official : null;
  const seenExt = new Set(apiSquad.map(ap => Number(ap.ext_id)));
  if (official) {
    for (const o of official) {
      const id = Number(o.id);
      if (seenExt.has(id) || !idx.byExt.has(id)) continue;
      const g = idx.byExt.get(id);
      matchedGameIds.add(g.id);
      if (g.club === club) continue;
      proposals.push({
        player_id: g.id, player_ext_id: id, player_name: g.name,
        movement_type: 'transfer', club_from: g.club, club_to: club,
        league_from: g.league, league_to: league,
        confidence: 'certaine', reason: 'identifiant API-Sports connu (effectif officiel)',
        source: 'api-sports', observed_at: new Date().toISOString(),
      });
    }
  }
  // Noms de l'effectif officiel (formes courtes « W. Saliba ») pour les joueurs du jeu encore sans id.
  const officialIds = new Set((official || []).map(o => Number(o.id)));
  const officialLast = new Map();
  for (const o of (official || [])) {
    const ot = tokens(o.name); const l = ot[ot.length - 1]; if (!l) continue;
    if (!officialLast.has(l)) officialLast.set(l, []);
    officialLast.get(l).push(ot);
  }
  function inOfficial(g) {
    if (!official) return false;
    if (g.apisports_id != null && officialIds.has(Number(g.apisports_id))) return true;
    const gt = tokens(g.name); const l = gt[gt.length - 1];
    const cands = officialLast.get(l) || [];
    // même nom de famille + même initiale de prénom (ou nom d'usage d'un seul mot)
    return cands.some(ot => gt.length === 1 || ot.length === 1 || (ot[0] && gt[0] && ot[0][0] === gt[0][0]));
  }

  for (const g of gameRoster) {
    if (g.club === club && !matchedGameIds.has(g.id)) {
      if (inOfficial(g)) continue; // toujours dans l'effectif officiel : pas un départ
      proposals.push({
        player_id: g.id, player_ext_id: null, player_name: g.name,
        movement_type: 'unknown_club', club_from: club, club_to: null, league_from: league, league_to: null,
        confidence: 'ambigue', reason: official ? 'absent de l\'effectif officiel du club — départ probable à confirmer' : 'présent au club côté jeu mais absent de l\'effectif API — départ probable à confirmer',
        source: 'api-sports', observed_at: new Date().toISOString(), is_departure: true,
      });
    }
  }

  const stats = {
    api_count: apiSquad.length,
    arrivals: proposals.filter(p => p.club_to === club && !p.is_new && !p.is_departure).length,
    new_players: proposals.filter(p => p.is_new).length,
    departures: proposals.filter(p => p.is_departure).length,
    ambiguous: proposals.filter(p => p.confidence === 'ambigue').length,
  };
  return { proposals, stats, links };
}
