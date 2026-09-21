import { randomBytes, createHmac, createHash, timingSafeEqual } from 'node:crypto';
const uuid = value => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value || '');
const cookieName = 'tf_article_session';
const lifetime = 86400; // Une session de lecture de 24 h, réutilisée entre les onglets.
export function createArticleViewsHandler({store, secret, origin, preview=false, now=Date.now}) {
  const sign = data => createHmac('sha256',secret).update(data).digest('hex');
  function readSession(req) {
    const raw = (req.headers.get('cookie') || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1) || '';
    const match = /^([a-f0-9]{64})\.(\d{10})\.([a-f0-9]{64})$/.exec(raw);
    if (!match || Number(match[2])*1000<=now() || Number(match[2])*1000>now()+(lifetime+60)*1000) return null;
    const payload=match[1]+'.'+match[2];
    return timingSafeEqual(Buffer.from(match[3],'hex'),Buffer.from(sign(payload),'hex')) ? payload : null;
  }
  return async req => {
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Vary':'Cookie'};
    const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
    if (!secret || secret.length<32 || !store || !origin) return reply(503,{error:'counter_not_configured'});
    if (!['GET','POST'].includes(req.method)) {headers.Allow='GET, POST';return reply(405,{error:'method_not_allowed'});}
    // Pas de CORS public ni de POST depuis une autre origine.
    if (req.method==='POST' && (req.headers.get('origin')!==origin || !/^application\/json(?:;|$)/i.test(req.headers.get('content-type')||''))) return reply(403,{error:'invalid_origin'});
    const url=new URL(req.url);
    let id=url.searchParams.get('article_id');
    if(req.method==='POST') {
      try {const raw=await req.text();if(raw.length>1024)return reply(413,{error:'body_too_large'});id=JSON.parse(raw).article_id;} catch{return reply(400,{error:'invalid_body'});}
    }
    if(!uuid(id))return reply(400,{error:'invalid_article'});
    let session=readSession(req);
    if(!session && req.method==='POST')return reply(401,{error:'session_required'});
    if(!session) {
      session=randomBytes(32).toString('hex')+'.'+Math.floor(now()/1000+lifetime);
      headers['Set-Cookie']=`${cookieName}=${session}.${sign(session)}; Path=/; Max-Age=${lifetime}; HttpOnly; SameSite=Lax${origin.startsWith('https:')?'; Secure':''}`;
    }
    // Une empreinte différente par article : pas d'identifiant brut de lecteur en base.
    const hash=createHmac('sha256',secret).update(session+'|'+id).digest('hex');
    const sessionTag=createHash('sha256').update(session).digest('hex').slice(0,24);
    try {
      const state=await store(req.method==='POST'?'increment_article_view':'article_view_state',{p_article_id:id,p_session_hash:hash});
      if(!state || !Number.isSafeInteger(Number(state.count)) || Number(state.count)<0)throw Error('invalid_counter');
      return reply(200,{...state,count:Number(state.count),sessionTag,preview});
    }catch(error){return reply(error.code==='P0002'?404:503,{error:error.code==='P0002'?'article_not_found':'counter_unavailable'});}
  };
}
