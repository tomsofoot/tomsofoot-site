// netlify/functions/sitemap-articles.mjs
// Sitemap XML des ARTICLES et DOSSIERS PUBLICS uniquement (jamais brouillons/programmés).
//   Lit les vues articles_public / dossiers_public (RLS : publié/archivé seulement).
//   Sert /sitemap-articles.xml — à référencer dans le sitemap principal / robots.txt.
const SUPABASE_URL  = process.env.SUPABASE_URL  || 'https://yubndvqmglttlntkugzm.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON || 'sb_publishable_8x7te6dRypwXn_vR5hyf9A_rh6h-JBZ';
const SITE = process.env.SITE_ORIGIN || 'https://tomsofoot.fr';

async function sb(path){ const r = await fetch(SUPABASE_URL+'/rest/v1/'+path,{headers:{apikey:SUPABASE_ANON,authorization:'Bearer '+SUPABASE_ANON,accept:'application/json'}}); if(!r.ok) return []; return r.json(); }
const escX = (s)=>String(s==null?'':s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&apos;','"':'&quot;'}[c]));

export default async () => {
  const [arts, doss] = await Promise.all([
    sb('articles_public?select=slug,updated_at,published_at&order=published_at.desc.nullslast&limit=1000'),
    sb('dossiers_public?select=slug,updated_at,published_at&order=published_at.desc.nullslast&limit=500')
  ]);
  const urls = [];
  urls.push({ loc: SITE+'/articles/', lastmod:null, priority:'0.7', freq:'daily' });
  (arts||[]).forEach(a=>urls.push({ loc: SITE+'/articles/'+a.slug, lastmod:a.updated_at||a.published_at, priority:'0.7', freq:'weekly' }));
  (doss||[]).forEach(d=>urls.push({ loc: SITE+'/dossiers/'+d.slug, lastmod:d.updated_at||d.published_at, priority:'0.6', freq:'weekly' }));

  const body = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map(u=>'  <url><loc>'+escX(u.loc)+'</loc>'
        + (u.lastmod?'<lastmod>'+escX(String(u.lastmod).slice(0,10))+'</lastmod>':'')
        + '<changefreq>'+u.freq+'</changefreq><priority>'+u.priority+'</priority></url>').join('\n')
    + '\n</urlset>\n';

  return new Response(body, { status:200, headers:{ 'content-type':'application/xml; charset=utf-8', 'cache-control':'public, max-age=600' } });
};
