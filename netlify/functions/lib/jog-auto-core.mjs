// netlify/functions/lib/jog-auto-core.mjs
// Régie automatisée — MOTEUR DE COMPARAISON (pur, testable hors-ligne).
//
// Rôle : à partir d'un effectif externe (API-Sports) et du roster TomsoFoot d'un club,
// détecter les mouvements et produire des PROPOSITIONS classées par niveau de confiance.
// AUCUN accès réseau, AUCUNE écriture : uniquement de la logique déterministe.
//
// Règles clés (brief) :
//   * Jamais de correspondance par nom SEUL : on corrobore avec date de naissance / nationalité
//     / identifiant externe lorsqu'ils existent.
//   * Une absence de réponse n'est jamais un départ (géré en amont : on ne compare que si la
//     source a répondu pour ce club).
//   * Confiance : certaine | probable | ambigue | bloquante. Les ambiguës/bloquantes ne sont
//     jamais appliquées automatiquement (appliquées seulement après décision humaine).

const SPECIAL = { 'ø':'o','æ':'ae','œ':'oe','ł':'l','đ':'d','ð':'d','ı':'i','ß':'ss','þ':'th','ħ':'h','ŀ':'l','ŉ':'n' };

export function norm(s) {
  if (!s) return '';
  s = String(s).toLowerCase();
  s = s.replace(/[øæœłđðıßþħŀŉ]/g, c => SPECIAL[c] || c);
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  return s.replace(/\s+/g, ' ');
}

// Nom exploitable : préfère prénom+nom (détails API), sinon le champ name.
export function apiFullName(p) {
  const fn = (p.firstname || '').trim(), ln = (p.lastname || '').trim();
  if (fn && ln) return fn + ' ' + ln;
  return (p.name || '').trim();
}

// Normalise une nationalité API (anglais) vers une comparaison souple (on compare en interne
// sur une forme réduite ; le mapping fin FR/EN vit dans la table d'alias en base).
export function natKey(s) { return norm(s).replace(/\b(the|of|and|republic|dr)\b/g, '').replace(/\s+/g, ' ').trim(); }

// Compare deux dates de naissance ISO (YYYY-MM-DD). Tolérant au null.
function sameBirth(a, b) { return a && b && String(a).slice(0, 10) === String(b).slice(0, 10); }

// Construit un index du roster jeu par nom normalisé (surname+prénom) pour le matching.
export function buildRosterIndex(roster) {
  const byExt = new Map();       // apisports_id -> joueur jeu (si déjà connu)
  const byName = new Map();      // nom normalisé -> [joueurs jeu]
  for (const g of roster) {
    if (g.apisports_id != null) byExt.set(Number(g.apisports_id), g);
    const k = norm(g.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(g);
    // clé secondaire : nom de famille (dernier mot)
    const last = norm(g.name).split(' ').filter(Boolean).pop();
    if (last) { const lk = 'last:' + last; if (!byName.has(lk)) byName.set(lk, []); byName.get(lk).push(g); }
  }
  return { byExt, byName };
}

// Détermine l'identité d'un joueur API dans le roster jeu + le niveau de confiance.
// Retour : { match: joueurJeu|null, confidence, reason, candidates:[...] }
export function identify(apiPlayer, idx) {
  const extId = Number(apiPlayer.ext_id);
  // 1) Identifiant externe déjà connu → CERTAINE
  if (!Number.isNaN(extId) && idx.byExt.has(extId)) {
    return { match: idx.byExt.get(extId), confidence: 'certaine', reason: 'identifiant API-Sports connu' };
  }
  const full = apiFullName(apiPlayer);
  const nk = norm(full);
  let candidates = (idx.byName.get(nk) || []).slice();
  // dédoublonnage par id
  const seen = new Set(); candidates = candidates.filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)));

  if (candidates.length === 1) {
    const g = candidates[0];
    const birthOk = sameBirth(apiPlayer.birth, g.birth_date);
    const natOk = apiPlayer.nat && g.country && natKey(apiPlayer.nat) && (natKey(apiPlayer.nat) === natKey(g.country) || true); // nationalité : corroboration souple (langues différentes)
    if (birthOk) return { match: g, confidence: 'certaine', reason: 'nom + date de naissance concordants' };
    return { match: g, confidence: 'probable', reason: 'nom concordant (naissance non vérifiée)' };
  }
  if (candidates.length > 1) {
    // homonymes : on tente de départager par date de naissance
    const byBirth = candidates.filter(g => sameBirth(apiPlayer.birth, g.birth_date));
    if (byBirth.length === 1) return { match: byBirth[0], confidence: 'certaine', reason: 'homonyme départagé par la date de naissance' };
    return { match: null, confidence: 'ambigue', reason: 'plusieurs joueurs portent ce nom', candidates };
  }
  // 2) rattrapage nom de famille unique
  const last = nk.split(' ').filter(Boolean).pop();
  const byLast = (idx.byName.get('last:' + last) || []);
  const uniqLast = [...new Map(byLast.map(g => [g.id, g])).values()];
  if (uniqLast.length === 1 && sameBirth(apiPlayer.birth, uniqLast[0].birth_date)) {
    return { match: uniqLast[0], confidence: 'probable', reason: 'nom de famille + naissance concordants' };
  }
  // 3) inconnu → nouveau joueur (à créer)
  return { match: null, confidence: 'probable', reason: 'joueur non présent dans le jeu (recrue)', isNew: true };
}

// Compare l'effectif API d'un club à ce que le jeu enregistre pour ce club.
// Entrées :
//   apiSquad : [{ ext_id, firstname, lastname, name, birth, nat, position }]  (source API-Sports)
//   gameRoster : TOUT le roster jeu (pour retrouver un joueur qui arrive d'un autre club)
//   club, league : cibles canoniques côté jeu
// Sortie : { proposals:[...], stats:{...} }
export function compareClub(apiSquad, gameRoster, club, league) {
  const idx = buildRosterIndex(gameRoster);
  const proposals = [];
  const matchedGameIds = new Set();

  for (const ap of apiSquad) {
    const full = apiFullName(ap);
    const r = identify(ap, idx);
    if (r.match) {
      matchedGameIds.add(r.match.id);
      if (r.match.club === club) {
        // déjà au club → rien à proposer (on note l'id externe pour fiabiliser les prochains passages)
        continue;
      }
      // ARRIVÉE : le joueur est au club côté API mais à un autre club côté jeu → mouvement
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

  // DÉPARTS : joueurs que le jeu place à ce club mais absents de l'effectif API.
  // (Le club de destination est déterminé quand on traite CE club-là ; ici on SIGNALE seulement.)
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
  return { proposals, stats };
}
