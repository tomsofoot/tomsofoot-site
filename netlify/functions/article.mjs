// netlify/functions/article.mjs
// Rendu SERVEUR d'un article HTML natif TomsoFoot : /articles/:slug
//   * Texte en VRAI HTML (net, sélectionnable, accessible, indexable) — jamais d'image/canvas.
//   * SEO : <title>, meta description, canonique, Open Graph, JSON-LD NewsArticle.
//   * Images responsives <picture>/<srcset>/<sizes> (Retina), sans agrandissement.
//   * Sécurité : lecture via clé anon + RLS (brouillons/programmés invisibles au public).
//     Aperçu privé admin : ?preview=1 + en-tête Authorization (jeton Supabase de l'admin).
//   * Intégrations limitées à une liste blanche (YouTube, Twitch, Dailymotion) — pas de HTML brut.
//
// N'affecte AUCUNE autre fonctionnalité (lecteur PDF, jeux, classements, API matchs).

const SUPABASE_URL  = process.env.SUPABASE_URL  || 'https://yubndvqmglttlntkugzm.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON || 'sb_publishable_8x7te6dRypwXn_vR5hyf9A_rh6h-JBZ';
const SITE = process.env.SITE_ORIGIN || 'https://tomsofoot.fr';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
  { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const escAttr = esc;

function json(status, obj){ return new Response(JSON.stringify(obj), { status, headers:{'content-type':'application/json'} }); }
function html(status, body){ return new Response(body, { status, headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=120'} }); }

async function sb(path, token){
  const headers = { apikey: SUPABASE_ANON, authorization: 'Bearer ' + (token || SUPABASE_ANON), accept:'application/json' };
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers });
  if(!r.ok) return null;
  return r.json();
}

// ---- Whitelist des intégrations externes -----------------------------------
function videoEmbed(v){
  // v = { provider, id }  OU  { url }
  const provider = (v.provider||'').toLowerCase();
  const id = String(v.id||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,40);
  let src = null, title = esc(v.title||'Vidéo');
  if(provider==='youtube' && id) src = 'https://www.youtube-nocookie.com/embed/'+id;
  else if(provider==='twitch' && id) src = 'https://player.twitch.tv/?video='+id+'&parent='+new URL(SITE).hostname;
  else if(provider==='dailymotion' && id) src = 'https://www.dailymotion.com/embed/video/'+id;
  if(!src) return '';
  return '<div class="a-embed"><iframe src="'+escAttr(src)+'" title="'+title+'" loading="lazy" allowfullscreen '
       + 'allow="accelerometer; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>';
}

// ---- Image responsive : content.image = {alt,caption,credit,fallback,variants:[{url,w,type}]} ----
function pictureTag(img, sizes, cls){
  if(!img || !img.fallback && !(img.variants&&img.variants.length)) return '';
  const variants = (img.variants||[]).filter(v=>v && v.url && v.w);
  const byType = {};
  variants.forEach(v=>{ const t=v.type||'image/webp'; (byType[t]=byType[t]||[]).push(v); });
  let sources = '';
  for(const t of Object.keys(byType)){
    const set = byType[t].sort((a,b)=>a.w-b.w).map(v=>escAttr(v.url)+' '+v.w+'w').join(', ');
    sources += '<source type="'+escAttr(t)+'" srcset="'+set+'" sizes="'+escAttr(sizes||'100vw')+'">';
  }
  const fb = img.fallback || (variants[variants.length-1]||{}).url || '';
  const w = img.width||''; const h = img.height||'';
  const imgTag = '<img src="'+escAttr(fb)+'" alt="'+escAttr(img.alt||'')+'"'
       + (w?(' width="'+w+'"'):'')+(h?(' height="'+h+'"'):'')
       + ' loading="lazy" decoding="async"'+(cls?(' class="'+cls+'"'):'')+'>';
  return '<picture>'+sources+imgTag+'</picture>';
}

function tableBlock(t){
  if(!t || !Array.isArray(t.rows)) return '';
  const head = t.head && Array.isArray(t.head)
    ? '<thead><tr>'+t.head.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead>' : '';
  const body = '<tbody>'+t.rows.map(r=>'<tr>'+(r||[]).map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')+'</tbody>';
  return '<div class="a-table-wrap"><table class="a-table"'+colorStyle(t.textColor)+'>'+(t.caption?'<caption>'+esc(t.caption)+'</caption>':'')+head+body+'</table></div>';
}

// Couleur validée : #RGB / #RRGGBB / rgb() -> #RRGGBB majuscules, sinon null.
function normColor(v){
  if(v==null) return null;
  let s = String(v).trim();
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(s);
  if(rgb){ const to=n=>Math.max(0,Math.min(255,+n)).toString(16).padStart(2,'0'); return ('#'+to(rgb[1])+to(rgb[2])+to(rgb[3])).toUpperCase(); }
  s = s.replace(/^#/,'');
  if(/^[0-9a-fA-F]{3}$/.test(s)) s = s.split('').map(c=>c+c).join('');
  if(!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return '#'+s.toUpperCase();
}
function colorStyle(v){ const c = normColor(v); return c ? ' style="color:'+c+'"' : ''; }
function colorSpan(text, v){ const c = normColor(v); return c ? '<span style="color:'+c+'">'+text+'</span>' : text; }

// Sanitizeur inline serveur : le texte des paragraphes/citations est déjà nettoyé
// côté régie (liste blanche), mais on re-filtre ici par prudence (defense-in-depth).
// Autorise : b,i,em,strong,u,a[href],ul,ol,li,sup,sub,br + span[style=color validée]. Le reste est neutralisé.
function safeInline(htmlStr){
  const allowed = new Set(['b','i','em','strong','u','a','ul','ol','li','sup','sub','br','span']);
  let s = String(htmlStr == null ? '' : htmlStr);
  // Les contenus collés (Word / Google Docs / contenteditable) enveloppent souvent
  // le texte dans des <div>/<p> imbriqués (+ commentaires <!--StartFragment-->).
  // Historiquement ces balises n'étaient pas dans la liste blanche : elles étaient
  // échappées en TEXTE LITTÉRAL, ce qui affichait « <div><div>… » à l'écran.
  // On les « déballe » désormais. POINT CLÉ (correctif : rendu public = aperçu régie) :
  // les sauts de ligne LITTÉRAUX (\n) présents dans le texte enregistré ne sont PAS des retours
  // voulus. Dans l'aperçu de la régie (iframe rendu « <p> + texte » avec le MÊME CSS), le
  // navigateur affiche ces \n comme un simple ESPACE. On reproduit exactement ce comportement :
  // un bloc paragraphe reste UN paragraphe fluide, jamais fragmenté en <br>/paragraphes. Seules
  // les vraies séparations (blocs éditoriaux distincts, ou fermeture d'un <div>/<p> réellement
  // collé) marquent une rupture. Les <br> saisis volontairement par l'auteur sont préservés.
  s = s.replace(/<!--[\s\S]*?-->/g, '');                  // commentaires de collage -> supprimés
  s = s.replace(/\r\n?|\n/g, ' ');                         // sauts de ligne LITTÉRAUX -> espace (comme l'aperçu)
  s = s.replace(/<\s*(?:div|p)\b[^>]*>/gi, '');            // ouvertures  <div ...>    -> rien
  s = s.replace(/<\s*\/\s*(?:div|p)\s*>/gi, '\x01');        // fermetures  </div>/</p>  -> placeholder de rupture
  s = s.replace(/(?:[ \t]*\x01[ \t]*)+/g, '\x01');          // ruptures multiples (imbrication) -> 1 seule
  s = s.replace(/^[\s\x01]+/, '').replace(/[\s\x01]+$/, ''); // rupture/espaces en tête / queue -> supprimés
  s = s.replace(/\x01/g, '<br>');                           // placeholder -> <br> (rupture réelle collée)
  s = s.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (m, tag, attrs) => {
    const t = tag.toLowerCase();
    if(!allowed.has(t)) return esc(m);
    const close = /^<\//.test(m);
    if(t === 'a'){
      const hrefM = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs || '');
      let href = hrefM ? (hrefM[2] || hrefM[3] || hrefM[4] || '') : '';
      if(!/^https?:|^\//i.test(href)) return close ? '</a>' : '';
      return close ? '</a>' : '<a href="'+escAttr(href)+'" rel="noopener nofollow" target="_blank">';
    }
    if(t === 'span'){
      if(close) return '</span>';
      const cm = /(?:^|[;\s"'({])color\s*:\s*([^;"')}]+)/i.exec(attrs || '');
      const col = cm ? normColor(cm[1]) : null;
      return col ? '<span style="color:'+col+'">' : '<span>';   // aucune autre propriété conservée
    }
    return close ? '</'+t+'>' : '<'+t+'>';
  });
  // On NE fusionne PAS les <br> : les <br><br> voulus par l'auteur (écarts entre
  // paragraphes) doivent être conservés. On retire seulement ceux en tête / queue.
  s = s.replace(/^(?:\s*<br\s*\/?>\s*)+/i, '');          // <br> en tête   -> supprimés
  s = s.replace(/(?:\s*<br\s*\/?>\s*)+$/i, '');          // <br> en queue  -> supprimés
  return s;
}

function renderBlock(b){
  const c = b.content || {};
  const cs = colorStyle(c.textColor);
  switch(b.type){
    case 'paragraph': { const t = safeInline(c.text||''); return t.trim() ? '<p'+cs+'>'+t+'</p>' : ''; }
    case 'heading':   return '<h2 class="a-h2"'+cs+' id="'+escAttr((c.id||slugify(c.text||'')))+'">'+esc(c.text||'')+'</h2>';
    case 'subheading':return '<h3 class="a-h3"'+cs+'>'+esc(c.text||'')+'</h3>';
    case 'spacer':    return '<div class="a-spacer" style="height:'+({petit:14,normal:30,grand:56}[c.size]||30)+'px"></div>';
    case 'image':     { const im=c.image||{}; return '<figure class="a-figure">'+pictureTag(im, '(min-width:800px) 720px, 100vw')
                           + ((im.caption||im.credit) ? '<figcaption>'+colorSpan(esc(im.caption||''), im.captionColor)
                           + (im.credit?' <span class="a-credit"'+colorStyle(im.creditColor)+'>© '+esc(im.credit)+'</span>':'')+'</figcaption>' : '')
                           + '</figure>'; }
    case 'quote':     return '<blockquote class="a-quote"'+cs+'><p>'+safeInline(c.text||'')+'</p>'
                           + (c.cite?'<cite>'+esc(c.cite)+'</cite>':'')+'</blockquote>';
    case 'stats':     return statsBlock(c);
    case 'video':     return videoEmbed(c) || '';
    case 'embed':     return videoEmbed(c) || '';
    case 'table':     return tableBlock(c);
    case 'divider':   return '<hr class="a-hr">';
    case 'related':   return relatedBlock(c);
    case 'continue':  return relatedBlock(Object.assign({ title: c.title || 'Poursuivre le dossier' }, c));
    default: return '';
  }
}

function statsBlock(c){
  const rows = (c.rows||[]).filter(r=>r && (r.k||r.v));
  if(!rows.length) return '';
  return '<div class="a-stats"'+colorStyle(c.textColor)+'>'+rows.map(r=>'<div class="a-stat"><b>'+esc(r.v||'')+'</b><span>'+esc(r.k||'')+'</span></div>').join('')+'</div>';
}

function relatedBlock(c){
  const items = (c.items||[]).slice(0,4);
  if(!items.length) return '';
  return '<aside class="a-related"><h2 class="a-related__t">'+esc(c.title||'À lire aussi')+'</h2><ul>'
    + items.map(it=>'<li><a href="'+escAttr('/articles/'+(it.slug||''))+'">'+esc(it.title||it.slug||'')+'</a></li>').join('')
    + '</ul></aside>';
}

function slugify(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60); }

function fmtDate(iso){
  if(!iso) return '';
  try{ return new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Paris'}).format(new Date(iso)); }
  catch(e){ return ''; }
}

function page(a, blocks, labels, isPreview, hc){
  hc = hc || {};
  const url = SITE + '/articles/' + a.slug;
  const kicker = [labels.competition, labels.genre].filter(Boolean).join(' · ');
  const title = a.seo_title || a.title;
  const desc  = a.seo_description || a.deck || '';
  const ogimg = a.og_image || a.hero_image || (SITE+'/favicon.svg');
  const bodyHtml = blocks.map(renderBlock).join('\n');
  const ld = {
    '@context':'https://schema.org','@type':'NewsArticle',
    headline: a.title, description: desc,
    datePublished: a.published_at || undefined, dateModified: a.updated_at || a.published_at || undefined,
    author: a.author ? { '@type':'Person', name:a.author } : { '@type':'Organization', name:'TomsoFoot' },
    publisher: { '@type':'Organization', name:'TomsoFoot' },
    image: a.hero_image ? [a.hero_image] : undefined,
    mainEntityOfPage: url,
    articleSection: labels.genre || labels.competition || undefined
  };
  const heroFig = a.hero_image
    ? '<figure class="a-hero"><picture><img src="'+escAttr(a.hero_image)+'" alt="'+escAttr(a.hero_alt||a.title)+'" width="1600" height="900" fetchpriority="high" decoding="async"></picture>'
      + ((a.hero_caption||a.hero_credit)?'<figcaption'+colorStyle(hc.hero_caption)+'>'+esc(a.hero_caption||'')+(a.hero_credit?' <span class="a-credit"'+colorStyle(hc.hero_credit)+'>© '+esc(a.hero_credit)+'</span>':'')+'</figcaption>':'')
      + '</figure>' : '';
  const journalCta = a.journal_slug
    ? '<a class="a-cta a-cta--ghost" href="/magazine/lecteur.html?pub='+escAttr(a.journal_slug)+'">Lire le journal</a>' : '';

  return '<!doctype html><html lang="fr"><head>'
  + '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<title>'+esc(title)+' — TomsoFoot</title>'
  + '<meta name="description" content="'+escAttr(desc)+'">'
  + '<link rel="canonical" href="'+escAttr(url)+'">'
  + (isPreview?'<meta name="robots" content="noindex,nofollow">':'')
  + '<meta property="og:type" content="article"><meta property="og:title" content="'+escAttr(title)+'">'
  + '<meta property="og:description" content="'+escAttr(desc)+'"><meta property="og:url" content="'+escAttr(url)+'">'
  + '<meta property="og:image" content="'+escAttr(ogimg)+'"><meta property="og:site_name" content="TomsoFoot">'
  + '<meta name="twitter:card" content="summary_large_image">'
  + '<link rel="icon" href="/favicon.svg" type="image/svg+xml">'
  + '<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Barlow+Condensed:ital,wght@0,700;0,800;1,800&family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&display=swap" rel="stylesheet">'
  + '<script type="application/ld+json">'+JSON.stringify(ld).replace(/</g,'\\u003c')+'</script>'
  + '<style>'+CSS+'</style></head><body>'
  + (isPreview?'<div class="a-preview-bar">Aperçu privé — brouillon/programmé non public</div>':'')
  + header()
  + '<main class="a-main">'
  + '<article class="a-article">'
  +   '<div class="a-head">'
  +     (kicker?'<p class="a-kicker"'+colorStyle(hc.kicker)+'>'+esc(kicker)+'</p>':'')
  +     '<h1 class="a-title"'+colorStyle(hc.title)+'>'+esc(a.title)+'</h1>'
  +     (a.deck?'<p class="a-deck"'+colorStyle(hc.deck)+'>'+esc(a.deck)+'</p>':'')
  +     '<div class="a-byline">'
  +       (a.author?'<span class="a-author">Par '+esc(a.author)+'</span>':'<span class="a-author">La rédaction</span>')
  +       (a.published_at?'<span class="a-dot">·</span><time datetime="'+escAttr(a.published_at)+'">'+esc(fmtDate(a.published_at))+'</time>':'')
  +       (a.reading_time?'<span class="a-dot">·</span><span>'+a.reading_time+' min de lecture</span>':'')
  +     '</div>'
  +     '<div class="a-actions">'
  +       '<button type="button" class="a-share" data-share aria-label="Partager">Partager</button>'
  +       '<button type="button" class="a-share" data-copy aria-label="Copier le lien">Copier le lien</button>'
  +       journalCta
  +     '</div>'
  +   '</div>'
  +   heroFig
  +   '<div class="a-body">'+bodyHtml+'</div>'
  + '</article>'
  + aside(labels)
  + '</main>'
  + footer()
  + '<script>'+JS+'</script>'
  + '</body></html>';
}

function header(){
  return '<header class="a-topbar"><a class="a-brand" href="/">TOMSO<span>FOOT</span></a>'
   + '<nav class="a-nav"><a href="/">Accueil</a><a href="/articles/">Articles</a><a href="/magazine/lecteur.html">Le journal</a></nav></header>';
}
function aside(labels){
  return '<aside class="a-side"><div class="a-side__box"><p class="a-side__t">Sur TomsoFoot</p>'
   + '<a class="a-side__link" href="/articles/">Tous les articles</a>'
   + '<a class="a-side__link" href="/magazine/lecteur.html">Le dernier journal</a>'
   + '<a class="a-side__link" href="/#a-suivre">Les prochains matchs</a>'
   + '</div></aside>';
}
function footer(){ return '<footer class="a-footer"><p>© TomsoFoot — Le football, notre passion.</p></footer>'; }

const CSS = `
:root{--ink:#0b1a33;--navy:#071426;--red:#ff334d;--paper:#fbfcfe;--muted:#5a6b83;--line:#e6ecf5;--maxread:730px}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,system-ui,Arial,sans-serif;line-height:1.6}
img,picture{max-width:100%;height:auto;display:block}
.a-preview-bar{background:#8a2eff;color:#fff;text-align:center;font:600 13px Inter;padding:8px}
.a-topbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 22px;background:var(--navy);color:#fff}
.a-brand{font-family:"Archivo Black",sans-serif;font-style:italic;letter-spacing:-.02em;text-decoration:none;color:#fff;font-size:18px}.a-brand span{color:var(--red)}
.a-nav a{color:#cdd9ea;text-decoration:none;font-weight:600;font-size:14px;margin-left:18px}.a-nav a:hover{color:#fff}
.a-main{max-width:1100px;margin:0 auto;padding:26px 22px 40px;display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:40px}
.a-article{min-width:0;max-width:var(--maxread);margin:0 auto;width:100%}
.a-kicker{color:var(--red);font-family:"Barlow Condensed",sans-serif;font-weight:800;letter-spacing:.08em;text-transform:uppercase;font-size:15px;margin:0 0 10px}
.a-title{font-family:"Archivo Black",sans-serif;font-size:clamp(30px,4.6vw,44px);line-height:1.06;letter-spacing:-.01em;margin:0 0 14px}
.a-deck{font-family:"Source Serif 4",Georgia,serif;font-size:20px;line-height:1.5;color:#31435d;margin:0 0 18px}
.a-byline{display:flex;flex-wrap:wrap;align-items:center;gap:9px;color:var(--muted);font-size:14px;font-weight:500}
.a-byline .a-author{color:var(--ink);font-weight:700}.a-dot{opacity:.5}
.a-actions{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0 4px}
.a-share{appearance:none;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:999px;padding:8px 15px;font:600 13px Inter;cursor:pointer}
.a-share:hover{border-color:var(--red);color:var(--red)}
.a-cta{display:inline-flex;align-items:center;text-decoration:none;border-radius:999px;padding:8px 15px;font:700 13px Inter}
.a-cta--ghost{border:1px solid var(--navy);color:var(--navy)}
.a-hero{margin:22px 0 8px}.a-hero img{width:100%;border-radius:12px}
.a-figure{margin:26px 0}.a-figure img{width:100%;border-radius:10px}
figcaption{color:var(--muted);font-size:13px;margin-top:8px;line-height:1.45}.a-credit{opacity:.8}
.a-body{font-size:19px}
.a-body p{margin:0 0 20px}
.a-h2{font-family:"Barlow Condensed",sans-serif;font-weight:800;font-size:27px;letter-spacing:.01em;margin:34px 0 12px;line-height:1.15}
.a-h3{font-family:"Barlow Condensed",sans-serif;font-weight:800;font-size:20px;margin:26px 0 10px;color:#26374f;line-height:1.2}
.a-body a{color:#0b57c9;text-decoration:underline;text-underline-offset:2px}.a-body a:hover{color:var(--red)}
.a-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin:26px 0;padding:18px;background:#f2f6fc;border:1px solid var(--line);border-radius:12px}
.a-stat b{display:block;font-family:"Archivo Black",sans-serif;font-size:26px;color:var(--ink)}.a-stat span{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em}
.a-quote{margin:28px 0;padding:6px 0 6px 22px;border-left:3px solid var(--red)}
.a-quote p{font-family:"Source Serif 4",Georgia,serif;font-size:23px;line-height:1.45;font-style:italic;margin:0 0 8px}
.a-quote cite{color:var(--muted);font-style:normal;font-size:14px;font-weight:600}
.a-hr{border:0;border-top:1px solid var(--line);margin:30px 0}
.a-embed{position:relative;aspect-ratio:16/9;margin:26px 0;border-radius:10px;overflow:hidden;background:#000}
.a-embed iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.a-table-wrap{overflow-x:auto;margin:26px 0}
.a-table{border-collapse:collapse;width:100%;font-size:15px}
.a-table caption{caption-side:top;text-align:left;color:var(--muted);font-size:13px;margin-bottom:8px}
.a-table th,.a-table td{border:1px solid var(--line);padding:9px 12px;text-align:left}
.a-table thead th{background:#f1f5fb;font-weight:800}
.a-related{margin:30px 0;padding:18px 20px;background:#f2f6fc;border:1px solid var(--line);border-radius:12px}
.a-related__t{font-family:"Barlow Condensed",sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:.06em;font-size:16px;margin:0 0 10px}
.a-related ul{margin:0;padding:0;list-style:none}.a-related li{padding:7px 0;border-top:1px solid var(--line)}
.a-related li:first-child{border-top:0}.a-related a{color:var(--ink);text-decoration:none;font-weight:600}.a-related a:hover{color:var(--red)}
.a-side__box{position:sticky;top:78px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px}
.a-side__t{font-family:"Barlow Condensed",sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-size:14px;margin:0 0 10px}
.a-side__link{display:block;padding:9px 0;border-top:1px solid var(--line);color:var(--ink);text-decoration:none;font-weight:600}
.a-side__link:first-of-type{border-top:0}.a-side__link:hover{color:var(--red)}
.a-footer{border-top:1px solid var(--line);color:var(--muted);text-align:center;padding:24px;font-size:13px}
@media(max-width:900px){.a-main{grid-template-columns:1fr;gap:24px}.a-side{order:2}.a-side__box{position:static}.a-body{font-size:18px}}
@media(max-width:560px){.a-main{padding:18px 16px 32px}.a-nav{display:none}.a-body{font-size:17px}.a-deck{font-size:18px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
`;

const JS = `
document.addEventListener('click',function(e){
  var s=e.target.closest('[data-share]'); var c=e.target.closest('[data-copy]');
  if(s){ if(navigator.share){navigator.share({title:document.title,url:location.href}).catch(function(){});}else{copy();} }
  if(c){ copy(); }
});
function copy(){ try{ navigator.clipboard.writeText(location.href); }catch(e){} }
`;

export default async (req) => {
  const u = new URL(req.url);
  let slug = (u.searchParams.get('slug') || u.pathname.replace(/^\/articles\/?/, '')).replace(/\/+$/,'').toLowerCase();
  slug = slug.replace(/[^a-z0-9-]/g,'');
  if(!slug) return html(404, notFound());

  const isPreview = u.searchParams.get('preview') === '1';
  // Aperçu privé : jeton admin transmis par la régie (en-tête Authorization ou ?token=).
  let token = null;
  if(isPreview){
    const h = req.headers.get('authorization') || '';
    token = h.replace(/^Bearer\s+/i,'') || u.searchParams.get('token') || null;
    // Vérifie que l'appelant est bien admin (sinon on ignore le jeton -> vue publique).
    if(token){
      try{
        const adminRes = await fetch(SUPABASE_URL+'/rest/v1/rpc/is_current_user_admin', {
          method:'POST', headers:{ 'content-type':'application/json', apikey:SUPABASE_ANON, authorization:'Bearer '+token }, body:'{}' });
        const ok = adminRes.ok ? (await adminRes.json())===true : false;
        if(!ok) token = null;
      }catch(e){ token = null; }
    }
  }

  const rows = await sb('articles?slug=eq.'+encodeURIComponent(slug)+'&select=*&limit=1', token);
  const a = rows && rows[0];
  if(!a) return html(404, notFound());   // brouillon/programmé => invisible en anonyme (RLS)

  const blocks = (await sb('article_blocks?article_id=eq.'+a.id+'&select=type,position,content&order=position.asc', token)) || [];

  // Libellés canoniques (zone/compétition/genre)
  const labels = {};
  if(a.competition_id){ const c = await sb('competitions?id=eq.'+encodeURIComponent(a.competition_id)+'&select=label_fr'); labels.competition = c && c[0] && c[0].label_fr; }
  if(a.genre_id){ const g = await sb('editorial_genres?id=eq.'+encodeURIComponent(a.genre_id)+'&select=label_fr'); labels.genre = g && g[0] && g[0].label_fr; }
  if(a.zone_id){ const z = await sb('editorial_zones?id=eq.'+encodeURIComponent(a.zone_id)+'&select=label_fr'); labels.zone = z && z[0] && z[0].label_fr; }

  // Couleurs d'en-tête (surtitre/titre/chapô/légende hero) : sidecar public facultatif, best-effort.
  let hcolors = {};
  try {
    const ctrl = new AbortController(); const timer = setTimeout(()=>ctrl.abort(), 1500);
    const mr = await fetch(SUPABASE_URL+'/storage/v1/object/public/articles/meta/'+a.id+'.json', { signal: ctrl.signal });
    clearTimeout(timer);
    if(mr.ok){ const j = await mr.json(); if(j && j.headerColors) hcolors = j.headerColors; }
  } catch(e){}

  return html(200, page(a, blocks, labels, isPreview && !!token, hcolors));
};

function notFound(){
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<title>Article introuvable — TomsoFoot</title><style>body{font-family:Inter,Arial,sans-serif;background:#071426;color:#fff;display:grid;place-items:center;height:100vh;margin:0;text-align:center}a{color:#ff334d}</style>'
  + '<div><h1>Article introuvable</h1><p>Cet article n\'existe pas ou n\'est pas encore publié.</p><p><a href="/articles/">Voir tous les articles</a></p></div>';
}
