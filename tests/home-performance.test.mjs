import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.resolve(process.argv[2]||root);
process.env.CONTEXT='production';
process.env.SUPABASE_URL='https://fixture.invalid';
process.env.SUPABASE_ANON='public-test-key';
process.env.SITE_ORIGIN='https://site.invalid';
const calls=[];
const sourceFetch=async raw=>{
  const url=String(raw);calls.push(url);
  let body;
  if(url.includes('/articles?'))body=[{id:'visible',slug:'article',title:'Fixture de test',published_at:'2020-01-01T00:00:00Z'},{id:'future',slug:'future',title:'Fixture future',published_at:'2100-01-01T00:00:00Z'}];
  else if(url.includes('/competitions?')||url.includes('/editorial_genres?'))body=[];
  else if(url.includes('get-yesterday-hints'))body={country:'France'};
  else if(url.includes('youtube-documentaries'))body={videos:[{id:'test'}]};
  else if(url.includes('contenu.json'))body={manifeste:{texte:'Fixture'}};
  else body={youtube:12};
  return new Response(JSON.stringify(body));
};
globalThis.fetch=sourceFetch;
// Import réel du garde-fou existant. Seul le transport HTTP est simulé.
let code=fs.readFileSync(path.join(root,'netlify/functions/home-data.mjs'),'utf8');
code=code.replace("'./lib/x-core.mjs'",JSON.stringify(pathToFileURL(path.join(source,'netlify/functions/lib/x-core.mjs')).href));
const handler=(await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).default;
const request=part=>new Request('https://site.invalid/.netlify/functions/home-data'+(part?'?part='+part:''));

// Une source secondaire qui ne répond jamais ne doit même pas être appelée au démarrage.
globalThis.fetch=raw=> /youtube|views|get-yesterday-hints/.test(String(raw)) ? new Promise(()=>{}) : sourceFetch(raw);
let timer;
const response=await Promise.race([handler(request('primary')),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Le primaire attend une source secondaire')),500);})]);
clearTimeout(timer);
const primary=await response.json();
assert.equal(response.status,200);
assert.equal(primary.articles.length,1);assert.equal(primary.articles[0].id,'visible');
assert(calls.every(url=>! /youtube|views|get-yesterday-hints/.test(url)));
assert.equal(calls.length,4);
assert(calls.find(url=>url.includes('/articles?')).includes('status=eq.published'));
assert(!JSON.stringify(primary).includes('public-test-key'));

globalThis.fetch=sourceFetch;calls.length=0;
const secondary=await(await handler(request('secondary'))).json();
assert.equal(calls.length,3);assert(calls.every(url=>!url.includes('/rest/v1/')));
assert.equal(secondary.hints.country,'France');assert.equal(secondary.views.youtube,12);
assert.equal(secondary.articles.length,0);
calls.length=0;
const all=await(await handler(request())).json();
assert.equal(calls.length,7);assert.equal(all.articles.length,1);assert.equal(all.docs.videos.length,1);

globalThis.fetch=async()=>{throw Error('Panne simulée');};
const failure=await handler(request('primary'));const missing=await failure.json();
assert.deepEqual(missing.articles,[]);assert.deepEqual(missing.views,{});
assert.equal(failure.headers.get('cache-control'),'no-store');
assert.equal(missing.errors.articles,'unavailable');
assert.equal((await handler(new Request('https://site.invalid',{method:'POST'}))).status,405);
assert.equal((await handler(request('unknown'))).status,400);

const build=JSON.parse(fs.readFileSync(path.join(root,'home/performance-build.json'),'utf8'));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert.equal((html.match(/rel="stylesheet"/g)||[]).length,1);
assert.equal((html.match(/<script\b/g)||[]).length,2);
assert(!html.includes('/home/scripts.json'));
const bundle=fs.readFileSync(path.join(root,build.assets.app),'utf8');
assert.equal((bundle.match(/\/\* Source : home\//g)||[]).length,35);
assert(bundle.includes('window.TF_HOME.finish()'));
const css=fs.readFileSync(path.join(root,build.assets.css),'utf8');
assert(!css.includes('@import'));
assert(css.includes('/home/assets/font-1.ttf'));
assert(css.includes('/home/assets/joueur-du-jour-2026.png'));
assert(html.includes('/assets/brand/logotf4.png'));
console.log('OK : primaire indépendant, contrat historique conservé, secondaires isolés, articles futurs exclus, erreurs non mises en cache, aucun secret retourné, bundle et CSS complets.');
