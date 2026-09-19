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
  return { match: null, confidence: 'probable', reason: 'joueur non présent dans le jeu (recrue)', isNew: true };
}

// Compare l'effectif API d'un club au roster jeu → propositions classées + liens d'identifiants à poser.
export function compareClub(apiSquad, gameRoster, club, league) {
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

  for (const g of gameRoster) {
    if (g.club === club && !matchedGameIds.has(g.id)) {
      proposals.push({
        player_id: g.id, player_ext_id: null, player_name: g.name,
        movement_type: 'unknown_club', club_from: club, club_to: null, league_from: league, league_to: null,
        confidence: 'ambigue', reason: 'présent au club côté jeu mais absent de l\'effectif API — départ probable à confirmer',
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
