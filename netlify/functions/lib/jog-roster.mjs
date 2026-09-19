// netlify/functions/lib/jog-roster.mjs
// Lecture COMPLÈTE de la table players (paginée).
//
// Pourquoi : l'API Supabase (PostgREST) plafonne chaque réponse à « Max rows » (1000 sur Jogadle-prod),
// quel que soit le `limit` demandé. `players?...&limit=5000` ne renvoyait donc que 1000 joueurs sur
// ~2800 : les autres étaient invisibles pour le moteur (faux « recrue à créer », départs non vus).
// Ici on lit par pages de 1000, triées par id (ordre stable), jusqu'à la dernière page.

const PAGE = 1000;

export async function loadAllPlayers(sbAdmin, select) {
  const out = [];
  let offset = 0;
  // On avance du nombre de lignes réellement reçues (robuste même si « Max rows » < PAGE)
  // et on s'arrête sur une page vide.
  for (let guard = 0; guard < 200; guard++) {
    const page = await sbAdmin(`players?select=${select}&order=id.asc&limit=${PAGE}&offset=${offset}`) || [];
    if (!page.length) break;
    out.push(...page);
    offset += page.length;
  }
  return out;
}
