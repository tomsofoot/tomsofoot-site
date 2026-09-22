import {assertPublicReadSafe, SUPABASE_URL, ANON, SITE, NETLIFY_CONTEXT} from './lib/x-core.mjs';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':status===200&&!Object.keys(body.errors||{}).length?'public, max-age=30':'no-store'}});
const read=async(url,headers={})=>{const r=await fetch(url,{headers,signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('source_unavailable');return r.json();};
export default async req=>{
 if(req.method!=='GET')return json({error:'method_not_allowed'},405);
 try{if(!NETLIFY_CONTEXT)throw Error();assertPublicReadSafe();if(!ANON)throw Error();}catch{return json({error:'public_config_unavailable'},503);}
 const headers={apikey:ANON,accept:'application/json'};
 const sb=p=>read(SUPABASE_URL+'/rest/v1/'+p,headers);
 const part=new URL(req.url).searchParams.get('part')||'all';
 if(!['all','primary','secondary'].includes(part))return json({error:'invalid_part'},400);
 // Aucune requête YouTube/compteurs/indices ne retarde les articles.
 const primary=part!=='secondary', secondary=part!=='primary';
 const jobs={
  ...(primary?{
  articles:sb('articles?select=id,slug,title,deck,hero_image,hero_alt,hero_cover,reading_time,published_at,created_at,featured,competition_id,genre_id&status=eq.published&order=published_at.desc.nullslast,created_at.desc&limit=1000'),
  competitions:sb('competitions?select=id,label_fr'),genres:sb('editorial_genres?select=id,label_fr'),
  local:read(SITE+'/contenu.json')
  }:{}),
  ...(secondary?{hints:read(SUPABASE_URL+'/functions/v1/get-yesterday-hints'),
  docs:read(SITE+'/.netlify/functions/youtube-documentaries'),
  views:read(SITE+'/.netlify/functions/views')}:{})
 };
 const out={articles:[],competitions:[],genres:[],hints:{},docs:{videos:[]},local:{manifeste:{}},views:{},matches:{matches:[]},twitch:{live:false},assets:{},errors:{},capturedAt:new Date().toISOString()};
 await Promise.all(Object.entries(jobs).map(async([key,p])=>{try{const value=await p;if(value?.error)throw Error();out[key]=value;}catch{out.errors[key]='unavailable';}}));
 out.articles=Array.isArray(out.articles)?out.articles.filter(a=>a.id&&a.slug&&a.title&&(!a.published_at||Date.parse(a.published_at)<=Date.now())):[];
 out.articles.sort((a,b)=>Date.parse(b.published_at||b.created_at)-Date.parse(a.published_at||a.created_at)||String(b.id).localeCompare(String(a.id)));
 for(const key of ['competitions','genres'])if(!Array.isArray(out[key]))out[key]=[];
 if(!out.local?.manifeste)out.local={manifeste:{}};
 if(!Array.isArray(out.docs?.videos))out.docs={videos:[]};
 return json(out);
};
