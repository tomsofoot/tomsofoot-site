// netlify/functions/tm-squad.mjs
// Régie Effectifs — récupère la liste des joueurs d'un effectif Transfermarkt (lecture serveur).
//
// SÉCURITÉ :
//   * N'accepte QUE des URL du domaine transfermarkt.* (garde anti-SSRF : impossible de
//     faire pointer la fonction vers un autre hôte).
//   * Lecture seule, aucune donnée sensible, aucune écriture.
//   * Transfermarkt bloque parfois les accès automatisés : en cas d'échec on renvoie une
//     erreur EXPLICITE, et la page bascule proprement sur le collage manuel.

const H = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET, OPTIONS',
};

function isTransfermarkt(u) {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return /(^|\.)transfermarkt\.[a-z.]{2,6}$/.test(h);
  } catch (_) { return false; }
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { headers: H });

  const url = new URL(req.url).searchParams.get('url') || '';
  if (!url || !isTransfermarkt(url)) {
    return new Response(JSON.stringify({ error: 'bad_url', message: 'URL Transfermarkt attendue (ex. .../kader/verein/583/saison_id/2026).' }), { status: 400, headers: H });
  }

  try {
    const r = await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
    });
    if (!r.ok) {
      return new Response(JSON.stringify({ error: 'blocked', status: r.status, message: 'Transfermarkt a refusé la requête (HTTP ' + r.status + ').' }), { status: 502, headers: H });
    }

    const html = await r.text();

    // Noms des joueurs : cellule "hauptlink" (le nom du joueur) contenant un lien vers /profil/spieler/<id>.
    // La cellule de valeur marchande est "rechts hauptlink" (deux classes) => exclue par le motif exact.
    const players = [];
    const seen = new Set();
    // Tolérant aux balises imbriquées dans le lien (icône capitaine, etc.) : on capture tout
    // jusqu'à </a> puis on retire les balises.
    const re = /<td class="hauptlink">\s*<a\b[^>]*\/profil\/spieler\/\d+[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const name = decodeEntities(m[1].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      players.push(name);
    }

    // Nom du club (depuis le <title> : "Paris Saint-Germain - Effectif détaillé …").
    let club = '';
    const t = html.match(/<title>([^<]+)<\/title>/i);
    if (t) club = decodeEntities(t[1]).split(' - ')[0].trim();

    if (!players.length) {
      return new Response(JSON.stringify({ error: 'no_players', message: 'Aucun joueur trouvé (page probablement bloquée ou format inattendu).' }), { status: 502, headers: H });
    }

    return new Response(JSON.stringify({ ok: true, club, count: players.length, players }), { headers: H });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'fetch_failed', message: String(e).slice(0, 200) }), { status: 502, headers: H });
  }
};
