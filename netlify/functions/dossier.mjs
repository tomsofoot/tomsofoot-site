// netlify/functions/dossier.mjs
// Rendu SERVEUR d'un DOSSIER éditorial : /dossiers/:slug
//   * Sommaire des chapitres (articles liés, ordonnés par chapter_position).
//   * Lien FACULTATIF vers le journal PDF associé (publication_id).
//   * Texte en vrai HTML, SEO (canonique, OG, JSON-LD CollectionPage), RLS public.
//   * Aperçu privé admin : ?preview=1 + Authorization Bearer.
// N'affecte aucune autre fonctionnalité (lecteur PDF, jeux, classements, matchs).

const SUPABASE_URL  = process.env.SUPABASE_URL  || 'https://yubndvqmglttlntkugzm.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON || 'sb_publishable_8x7te6dRypwXn_vR5hyf9A_rh6h-JBZ';
const SITE = process.env.SITE_ORIGIN || 'https://tomsofoot.fr';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
  { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

function html(status, body){ return new Response(body, { status, headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=120'} }); }
async function sb(path, token){
  const headers = { apikey: SUPABASE_ANON, authorization: 'Bearer ' + (token || SUPABASE_ANON), accept:'application/json' };
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers });
  if(!r.ok) return null; return r.json();
}
function fmtDate(iso){ if(!iso) return ''; try{ return new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Paris'}).format(new Date(iso)); }catch(e){ return ''; } }

function header(){
  return '<header class="d-topbar"><a class="d-brand" href="/">TOMSO<span>FOOT</span></a>'
   + '<nav class="d-nav"><a href="/">Accueil</a><a href="/articles/">Articles</a><a href="/magazine/lecteur.html">Le journal</a></nav></header>';
}
function footer(){ return '<footer class="d-footer"><p>© TomsoFoot — Le football, notre passion.</p></footer>'; }

function chapterCard(a, n){
  const kicker = a.chapter_label || ('Chapitre ' + n);
  return '<a class="d-chap" href="'+esc('/articles/'+a.slug)+'">'
    + (a.hero_image?'<span class="d-chap__img"><img src="'+esc(a.hero_image)+'" alt="'+esc(a.hero_alt||a.title)+'" loading="lazy" decoding="async"></span>':'<span class="d-chap__img d-chap__img--empty"></span>')
    + '<span class="d-chap__body"><span class="d-chap__k">'+esc(kicker)+'</span>'
    + '<span class="d-chap__t">'+esc(a.title)+'</span>'
    + (a.deck?'<span class="d-chap__d">'+esc(a.deck)+'</span>':'')
    + '<span class="d-chap__go">Lire ce chapitre →</span></span></a>';
}

function page(d, chapters, labels, journal, isPreview){
  const url = SITE + '/dossiers/' + d.slug;
  const title = d.title;
  const desc  = d.description || d.intro || '';
  const ogimg = d.cover_image || (SITE+'/favicon.svg');
  const kicker = [labels.competition, labels.zone].filter(Boolean).join(' · ');
  const ld = {
    '@context':'https://schema.org','@type':'CollectionPage',
    name: title, description: desc, url,
    hasPart: chapters.map(c=>({ '@type':'NewsArticle', headline:c.title, url: SITE+'/articles/'+c.slug }))
  };
  const journalCta = journal
    ? '<a class="d-cta d-cta--ghost" href="/magazine/lecteur.html?pub='+esc(journal.slug||'')+'">Lire le journal PDF</a>' : '';

  return '<!doctype html><html lang="fr"><head>'
  + '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<title>'+esc(title)+' — Dossier TomsoFoot</title>'
  + '<meta name="description" content="'+esc(desc)+'">'
  + '<link rel="canonical" href="'+esc(url)+'">'
  + (isPreview?'<meta name="robots" content="noindex,nofollow">':'')
  + '<meta property="og:type" content="website"><meta property="og:title" content="'+esc(title)+'">'
  + '<meta property="og:description" content="'+esc(desc)+'"><meta property="og:url" content="'+esc(url)+'">'
  + '<meta property="og:image" content="'+esc(ogimg)+'"><meta property="og:site_name" content="TomsoFoot">'
  + '<meta name="twitter:card" content="summary_large_image">'
  + '<link rel="icon" href="/favicon.svg" type="image/svg+xml">'
  + '<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Barlow+Condensed:wght@700;800&family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500&display=swap" rel="stylesheet">'
  + '<script type="application/ld+json">'+JSON.stringify(ld).replace(/</g,'\\u003c')+'</script>'
  + '<style>'+CSS+'</style></head><body>'
  + (isPreview?'<div class="d-preview-bar">Aperçu privé — dossier non public</div>':'')
  + header()
  + '<main class="d-main">'
  + '<div class="d-hero">'
  +   (d.cover_image?'<div class="d-hero__img"><img src="'+esc(d.cover_image)+'" alt="'+esc(d.title)+'" fetchpriority="high" decoding="async"></div>':'')
  +   '<div class="d-hero__txt">'
  +     '<p class="d-label">Dossier'+(kicker?' · '+esc(kicker):'')+'</p>'
  +     '<h1 class="d-title">'+esc(d.title)+'</h1>'
  +     (d.intro?'<p class="d-intro">'+esc(d.intro)+'</p>':'')
  +     '<div class="d-meta">'+(d.published_at?'<time datetime="'+esc(d.published_at)+'">'+esc(fmtDate(d.published_at))+'</time>':'')
  +       '<span class="d-count">'+chapters.length+' chapitre'+(chapters.length>1?'s':'')+'</span>'+journalCta+'</div>'
  +   '</div>'
  + '</div>'
  + '<section class="d-chaps">'+chapters.map((c,i)=>chapterCard(c,i+1)).join('')+'</section>'
  + (chapters.length===0?'<p class="d-empty">Les chapitres de ce dossier arrivent bientôt.</p>':'')
  + '</main>'
  + footer()
  + '</body></html>';
}

const CSS = `
:root{--ink:#0b1a33;--navy:#071426;--red:#ff334d;--paper:#fbfcfe;--muted:#5a6b83;--line:#e6ecf5}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,system-ui,Arial,sans-serif;line-height:1.6}
img{max-width:100%;height:auto;display:block}
.d-preview-bar{background:#8a2eff;color:#fff;text-align:center;font:600 13px Inter;padding:8px}
.d-topbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 22px;background:var(--navy);color:#fff}
.d-brand{font-family:"Archivo Black",sans-serif;font-style:italic;letter-spacing:-.02em;text-decoration:none;color:#fff;font-size:18px}.d-brand span{color:var(--red)}
.d-nav a{color:#cdd9ea;text-decoration:none;font-weight:600;font-size:14px;margin-left:18px}.d-nav a:hover{color:#fff}
.d-main{max-width:1040px;margin:0 auto;padding:26px 22px 44px}
.d-hero{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:28px;align-items:center;margin-bottom:30px}
.d-hero__img img{width:100%;border-radius:14px}
.d-label{color:var(--red);font-family:"Barlow Condensed",sans-serif;font-weight:800;letter-spacing:.08em;text-transform:uppercase;font-size:15px;margin:0 0 10px}
.d-title{font-family:"Archivo Black",sans-serif;font-size:clamp(30px,4.6vw,46px);line-height:1.05;margin:0 0 14px}
.d-intro{font-family:"Source Serif 4",Georgia,serif;font-size:19px;color:#31435d;margin:0 0 16px}
.d-meta{display:flex;flex-wrap:wrap;align-items:center;gap:14px;color:var(--muted);font-size:14px;font-weight:600}
.d-count{background:#eef3fb;border-radius:999px;padding:5px 12px}
.d-cta{display:inline-flex;align-items:center;text-decoration:none;border-radius:999px;padding:7px 14px;font:700 13px Inter}
.d-cta--ghost{border:1px solid var(--navy);color:var(--navy)}
.d-chaps{display:grid;grid-template-columns:1fr;gap:14px}
.d-chap{display:grid;grid-template-columns:180px minmax(0,1fr);gap:18px;text-decoration:none;color:inherit;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;transition:transform .15s,box-shadow .15s,border-color .15s}
.d-chap:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(11,26,51,.10);border-color:#cfe}
.d-chap__img{background:#0d1f3a}.d-chap__img img{width:100%;height:100%;object-fit:cover;min-height:118px}
.d-chap__img--empty{background:linear-gradient(135deg,#0a2450,#12448c)}
.d-chap__body{padding:16px 18px 16px 0;display:flex;flex-direction:column;gap:6px;min-width:0}
.d-chap__k{color:var(--red);font-family:"Barlow Condensed",sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:.06em;font-size:13px}
.d-chap__t{font-family:"Barlow Condensed",sans-serif;font-weight:800;font-size:23px;line-height:1.12}
.d-chap__d{color:var(--muted);font-size:15px}
.d-chap__go{color:var(--navy);font-weight:700;font-size:13px;margin-top:2px}
.d-empty{color:var(--muted);text-align:center;padding:30px}
.d-footer{border-top:1px solid var(--line);color:var(--muted);text-align:center;padding:24px;font-size:13px;margin-top:30px}
@media(max-width:820px){.d-hero{grid-template-columns:1fr;gap:16px}.d-chap{grid-template-columns:120px minmax(0,1fr);gap:14px}.d-nav{display:none}}
@media(max-width:520px){.d-chap{grid-template-columns:1fr}.d-chap__img img{min-height:150px}.d-chap__body{padding:14px 16px}}
`;

async function checkAdmin(token){
  if(!token) return false;
  try{ const r = await fetch(SUPABASE_URL+'/rest/v1/rpc/is_current_user_admin',{method:'POST',headers:{'content-type':'application/json',apikey:SUPABASE_ANON,authorization:'Bearer '+token},body:'{}'});
    return r.ok ? (await r.json())===true : false; }catch(e){ return false; }
}

export default async (req) => {
  const u = new URL(req.url);
  let slug = (u.searchParams.get('slug') || u.pathname.replace(/^\/dossiers\/?/, '')).replace(/\/+$/,'').toLowerCase().replace(/[^a-z0-9-]/g,'');
  if(!slug) return html(404, notFound());

  const isPreview = u.searchParams.get('preview') === '1';
  let token = null;
  if(isPreview){
    token = (req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'') || u.searchParams.get('token') || null;
    if(!(await checkAdmin(token))) token = null;
  }

  const rows = await sb('dossiers?slug=eq.'+encodeURIComponent(slug)+'&select=*&limit=1', token);
  const d = rows && rows[0];
  if(!d) return html(404, notFound());

  const chapters = (await sb('articles?dossier_id=eq.'+d.id+'&select=slug,title,deck,hero_image,hero_alt,chapter_position,chapter_label,published_at,status&order=chapter_position.asc.nullslast,published_at.asc', token)) || [];

  const labels = {};
  if(d.competition_id){ const c = await sb('competitions?id=eq.'+encodeURIComponent(d.competition_id)+'&select=label_fr'); labels.competition = c && c[0] && c[0].label_fr; }
  if(d.zone_id){ const z = await sb('editorial_zones?id=eq.'+encodeURIComponent(d.zone_id)+'&select=label_fr'); labels.zone = z && z[0] && z[0].label_fr; }

  let journal = null;
  if(d.publication_id){ const p = await sb('publications?id=eq.'+d.publication_id+'&select=slug,title'); journal = p && p[0]; }

  return html(200, page(d, chapters, labels, journal, isPreview && !!token));
};

function notFound(){
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<title>Dossier introuvable — TomsoFoot</title><style>body{font-family:Inter,Arial,sans-serif;background:#071426;color:#fff;display:grid;place-items:center;height:100vh;margin:0;text-align:center}a{color:#ff334d}</style>'
  + '<div><h1>Dossier introuvable</h1><p>Ce dossier n\'existe pas ou n\'est pas encore publié.</p><p><a href="/articles/">Voir les articles</a></p></div>';
}
