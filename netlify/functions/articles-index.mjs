// netlify/functions/articles-index.mjs
// Archive publique des articles : /articles/  (liste filtrable, jamais les brouillons).
//   * Filtres facultatifs : ?zone= &competition= &genre=  (ids canoniques).
//   * Article "à la une" (featured) mis en avant + suggestions (les plus récents).
//   * Lit la VUE articles_public (déjà limitée au publié/archivé) — RLS respecté.
const SUPABASE_URL  = process.env.SUPABASE_URL  || 'https://yubndvqmglttlntkugzm.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON || 'sb_publishable_8x7te6dRypwXn_vR5hyf9A_rh6h-JBZ';
const SITE = process.env.SITE_ORIGIN || 'https://tomsofoot.fr';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
  { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
function html(status, body){ return new Response(body, { status, headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=120'} }); }
async function sb(path){ const r = await fetch(SUPABASE_URL+'/rest/v1/'+path,{headers:{apikey:SUPABASE_ANON,authorization:'Bearer '+SUPABASE_ANON,accept:'application/json'}}); if(!r.ok) return null; return r.json(); }
function fmtDate(iso){ if(!iso) return ''; try{ return new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Paris'}).format(new Date(iso)); }catch(e){ return ''; } }

function card(a, labelMap, feat){
  const kick = [labelMap.comp[a.competition_id], labelMap.genre[a.genre_id]].filter(Boolean).join(' · ');
  return '<a class="x-card'+(feat?' x-card--feat':'')+'" href="'+esc('/articles/'+a.slug)+'">'
    + (a.hero_image?'<span class="x-card__img"><img src="'+esc(a.hero_image)+'" alt="'+esc(a.hero_alt||a.title)+'" loading="lazy" decoding="async"></span>':'<span class="x-card__img x-card__img--empty"></span>')
    + '<span class="x-card__b">'
    + (kick?'<span class="x-card__k">'+esc(kick)+'</span>':'')
    + '<span class="x-card__t">'+esc(a.title)+'</span>'
    + (a.deck?'<span class="x-card__d">'+esc(a.deck)+'</span>':'')
    + '<span class="x-card__m">'+(function(){var eff=a.published_at||a.created_at;return eff?esc(fmtDate(eff)):'';})()+(a.reading_time?' · '+a.reading_time+' min':'')+'</span>'
    + '</span></a>';
}

function page(feature, list, labelMap, tax, active){
  const title = 'Articles — TomsoFoot';
  const chip = (id,lab,cur)=> '<a class="x-chip'+(cur?' x-chip--on':'')+'" href="'+esc(id?('/articles/?competition='+id):'/articles/')+'">'+esc(lab)+'</a>';
  return '<!doctype html><html lang="fr"><head>'
  + '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<title>'+title+'</title><meta name="description" content="Tous les articles TomsoFoot : analyses, récits, entretiens et dossiers football.">'
  + '<link rel="canonical" href="'+esc(SITE+'/articles/')+'">'
  + '<meta property="og:title" content="'+title+'"><meta property="og:type" content="website"><meta property="og:url" content="'+esc(SITE+'/articles/')+'">'
  + '<link rel="icon" href="/favicon.svg" type="image/svg+xml">'
  + '<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Barlow+Condensed:wght@700;800&family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400&display=swap" rel="stylesheet">'
  + '<style>'+CSS+'</style></head><body>'
  + '<header class="x-topbar"><a class="x-brand" href="/">TOMSO<span>FOOT</span></a><nav class="x-nav"><a href="/">Accueil</a><a href="/articles/" aria-current="page">Articles</a><a href="/magazine/lecteur.html">Le journal</a></nav></header>'
  + '<main class="x-main">'
  + '<div class="x-head"><h1 class="x-h1">Les articles</h1><p class="x-sub">Analyses, récits et entretiens — le football raconté par TomsoFoot.</p></div>'
  + '<nav class="x-chips">'+ chip('', 'Tout', !active) + tax.comps.map(c=>chip(c.id,c.label_fr,active===c.id)).join('') + '</nav>'
  + (feature?'<section class="x-feature">'+card(feature,labelMap,true)+'</section>':'')
  + (list.length?'<section class="x-grid">'+list.map(a=>card(a,labelMap,false)).join('')+'</section>':'<p class="x-empty">Aucun article pour l\'instant. Reviens bientôt !</p>')
  + '</main>'
  + '<footer class="x-footer"><p>© TomsoFoot — Le football, notre passion.</p></footer>'
  + '</body></html>';
}

const CSS = `
:root{--ink:#0b1a33;--navy:#071426;--red:#ff334d;--paper:#fbfcfe;--muted:#5a6b83;--line:#e6ecf5}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,system-ui,Arial,sans-serif;line-height:1.55}
img{max-width:100%;height:auto;display:block}
.x-topbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 22px;background:var(--navy);color:#fff}
.x-brand{font-family:"Archivo Black",sans-serif;font-style:italic;text-decoration:none;color:#fff;font-size:18px}.x-brand span{color:var(--red)}
.x-nav a{color:#cdd9ea;text-decoration:none;font-weight:600;font-size:14px;margin-left:18px}.x-nav a[aria-current]{color:#fff}.x-nav a:hover{color:#fff}
.x-main{max-width:1080px;margin:0 auto;padding:26px 22px 44px}
.x-head{margin-bottom:14px}
.x-h1{font-family:"Archivo Black",sans-serif;font-size:clamp(28px,4vw,40px);margin:0 0 6px}
.x-sub{color:var(--muted);margin:0;font-size:16px}
.x-chips{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 22px}
.x-chip{text-decoration:none;color:var(--ink);border:1px solid var(--line);background:#fff;border-radius:999px;padding:7px 14px;font:600 13px Inter}
.x-chip--on,.x-chip:hover{border-color:var(--red);color:var(--red)}
.x-feature{margin-bottom:18px}
.x-card{display:grid;grid-template-columns:260px minmax(0,1fr);gap:18px;text-decoration:none;color:inherit;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;transition:transform .15s,box-shadow .15s,border-color .15s}
.x-card:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(11,26,51,.10);border-color:#cfe}
.x-card__img{background:#0d1f3a}.x-card__img img{width:100%;height:100%;object-fit:cover;min-height:150px}
.x-card__img--empty{background:linear-gradient(135deg,#0a2450,#12448c)}
.x-card__b{padding:16px 18px 16px 0;display:flex;flex-direction:column;gap:6px;min-width:0}
.x-card__k{color:var(--red);font-family:"Barlow Condensed",sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:.06em;font-size:13px}
.x-card__t{font-family:"Barlow Condensed",sans-serif;font-weight:800;font-size:24px;line-height:1.12}
.x-card__d{color:#31435d;font-size:15px}
.x-card__m{color:var(--muted);font-size:13px;font-weight:600;margin-top:2px}
.x-card--feat .x-card__t{font-size:30px}
.x-card--feat{grid-template-columns:minmax(0,1.2fr) minmax(0,1fr)}
.x-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
.x-grid .x-card{grid-template-columns:1fr}.x-grid .x-card__img img{min-height:170px}.x-grid .x-card__b{padding:14px 16px}
.x-empty{color:var(--muted);text-align:center;padding:40px}
.x-footer{border-top:1px solid var(--line);color:var(--muted);text-align:center;padding:24px;font-size:13px;margin-top:30px}
@media(max-width:640px){.x-feature .x-card,.x-card--feat{grid-template-columns:1fr}.x-card__img img{min-height:170px}.x-nav{display:none}}
`;

export default async (req) => {
  const u = new URL(req.url);
  const zone = (u.searchParams.get('zone')||'').replace(/[^a-z0-9-]/g,'');
  const comp = (u.searchParams.get('competition')||'').replace(/[^a-z0-9-]/g,'');
  const genre = (u.searchParams.get('genre')||'').replace(/[^a-z0-9-]/g,'');

  let filter = '';
  if(zone) filter += '&zone_id=eq.'+zone;
  if(comp) filter += '&competition_id=eq.'+comp;
  if(genre) filter += '&genre_id=eq.'+genre;

  const [zones, comps, genres] = await Promise.all([
    sb('editorial_zones?select=id,label_fr&order=position.asc'),
    sb('competitions?select=id,label_fr'),
    sb('editorial_genres?select=id,label_fr')
  ]);
  const labelMap = { comp:{}, genre:{}, zone:{} };
  (comps||[]).forEach(c=>labelMap.comp[c.id]=c.label_fr);
  (genres||[]).forEach(g=>labelMap.genre[g.id]=g.label_fr);
  (zones||[]).forEach(z=>labelMap.zone[z.id]=z.label_fr);

  // Filtres par compétition : on n'affiche QUE les compétitions réellement présentes
  // dans les articles (publiés/archivés), pour éviter des filtres qui mènent au vide.
  const present = await sb('articles_public?select=competition_id');
  const compChips = [...new Set((present||[]).map(a=>a.competition_id).filter(Boolean))]
    .map(id => ({ id, label_fr: labelMap.comp[id] || id }))
    .sort((a,b) => a.label_fr.localeCompare(b.label_fr, 'fr'));

  // Classement chronologique fiable : date effective = published_at || created_at, puis created_at, puis id.
  // Lecture sur la table (created_at disponible) ; RLS limite aux publiés/archivés visibles.
  const raw = (await sb('articles?select=slug,title,deck,hero_image,hero_alt,published_at,created_at,id,reading_time,featured,competition_id,genre_id,zone_id&status=in.(published,archived)'+filter+'&order=published_at.desc.nullslast,created_at.desc&limit=60')) || [];
  const effT = a => new Date(a.published_at||a.created_at||0).getTime();
  raw.sort((x,y)=>{ const d=effT(y)-effT(x); if(d) return d; const c=new Date(y.created_at||0)-new Date(x.created_at||0); if(c) return c; return String(y.id||'').localeCompare(String(x.id||'')); });
  const feature = raw.find(a=>a.featured) || null;
  const list = raw.filter(a=>a!==feature);

  return html(200, page(feature, list, labelMap, { comps: compChips }, comp||''));
};
