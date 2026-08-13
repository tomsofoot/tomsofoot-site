// netlify/functions/twitch-live.mjs
// Renvoie l'état live d'une chaîne Twitch : { live: true|false, title?, viewers? }
// SÉCURITÉ : le Client ID et le secret ne sont JAMAIS dans le code ni le dépôt.
// Ils sont lus depuis les variables d'environnement Netlify (à déposer par Thomas) :
//   TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, (optionnel) TWITCH_CHANNEL=tomsofoot
// Appel côté site : fetch('/.netlify/functions/twitch-live').then(r=>r.json())

export default async (req) => {
  const cors = {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
    "cache-control": "public, max-age=45", // évite de marteler l'API Twitch
  };
  if (req.method === "OPTIONS") return new Response("", { headers: cors });

  const channel =
    new URL(req.url).searchParams.get("channel") ||
    process.env.TWITCH_CHANNEL ||
    "tomsofoot";
  const id = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;

  if (!id || !secret) {
    // Pas encore configuré : on répond proprement (badge masqué côté site).
    return new Response(JSON.stringify({ live: false, error: "not_configured" }), { headers: cors });
  }

  try {
    // 1) Jeton applicatif (client_credentials) — pas de données utilisateur.
    const tok = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}&grant_type=client_credentials`,
    }).then((r) => r.json());

    // 2) La chaîne est-elle en live ?
    const s = await fetch(
      `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(channel)}`,
      { headers: { "Client-ID": id, Authorization: `Bearer ${tok.access_token}` } }
    ).then((r) => r.json());

    const live = Array.isArray(s.data) && s.data.length > 0;
    const info = live ? { title: s.data[0].title, viewers: s.data[0].viewer_count } : {};
    return new Response(JSON.stringify({ live, ...info }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ live: false, error: "fetch_failed" }), { headers: cors });
  }
};
