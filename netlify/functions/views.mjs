// TomsoFoot — compteurs de consultation par rubrique (YouTube / magazine / jeux).
// Stockage persistant via Netlify Blobs (aucune donnée perso ; un identifiant
// aléatoire par appareil sert uniquement à dédupliquer 1 vue / jour / rubrique).
// GET  -> { youtube, magazine, jeux }  (lecture publique)
// POST { rubric, visitor } -> incrémente si pas déjà compté aujourd'hui, renvoie les totaux.
import { getStore } from "@netlify/blobs";

const RUBRICS = ["youtube", "magazine", "jeux"];

function parisDay() {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date()); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}
async function totals(store) {
  const out = {};
  for (const r of RUBRICS) out[r] = Number((await store.get(`count:${r}`)) || 0);
  return out;
}
const HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

export default async (req) => {
  const store = getStore({ name: "rubric-views", consistency: "strong" });
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: HEADERS });

  if (req.method === "GET") {
    return new Response(JSON.stringify(await totals(store)), { headers: HEADERS });
  }

  if (req.method === "POST") {
    let body = {};
    try { body = await req.json(); } catch (e) {}
    const rubric = String(body.rubric || "");
    const visitor = String(body.visitor || "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64);
    if (!RUBRICS.includes(rubric) || !visitor) {
      return new Response(JSON.stringify({ error: "bad_request" }), { status: 400, headers: HEADERS });
    }
    const seenKey = `seen:${rubric}:${parisDay()}:${visitor}`;
    const already = await store.get(seenKey);
    if (!already) {
      await store.set(seenKey, "1");
      const next = Number((await store.get(`count:${rubric}`)) || 0) + 1;
      await store.set(`count:${rubric}`, String(next));
    }
    return new Response(JSON.stringify(await totals(store)), { headers: HEADERS });
  }

  return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: HEADERS });
};
