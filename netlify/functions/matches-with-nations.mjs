import clubsHandler from './matches.mjs';
import feedModule from './lib/nations-feed.cjs';
const nations=feedModule.createFeed();
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'public, max-age=30'}});
export default async req=>{
 if(req.method!=='GET')return json({error:'method_not_allowed'},405);
 const [clubs,national]=await Promise.allSettled([
  Promise.resolve(clubsHandler(req)).then(async r=>{const d=await r.json();if(!r.ok||d.error||!Array.isArray(d.matches))throw Error();return d;}),nations.upcoming()
 ]);
 if(clubs.status==='rejected'&&national.status==='rejected')return json({error:'upstream_unavailable'},503);
 const items=[...(clubs.status==='fulfilled'?clubs.value.matches:[]),...(national.status==='fulfilled'?national.value.matches:[])];
 const matches=[...new Map(items.map(m=>[String(m.id),m])).values()].sort((a,b)=>Date.parse(a.ts)-Date.parse(b.ts));
 const missing=clubs.status==='rejected'?' · Flux des clubs momentanément indisponible':national.status==='rejected'?' · Flux des sélections momentanément indisponible':'';
 const stale=national.status==='fulfilled'&&national.value.stale?' · Sélections : dernier relevé conservé du '+new Date(national.value.fetchedAt).toLocaleString('fr-FR',{timeZone:'Europe/Paris'}):'';
 return json({matches,sourceNote:'Sources : TomsoFoot (clubs) · ESPN (Ligue des nations, 7 prochains jours)'+missing+stale+'. Ouvrez une carte pour les détails.'});
};
