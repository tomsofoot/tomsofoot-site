// Secrets Twitch exclusivement dans les variables serveur Netlify.
let token=null, cached=null, pending=null;
export default async function(req) {
  const headers={'Content-Type':'application/json','Cache-Control':'public, max-age=30, s-maxage=45'};
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  if(req.method!=='GET')return reply(405,{error:'method_not_allowed'});
  const client=process.env.TWITCH_CLIENT_ID,secret=process.env.TWITCH_CLIENT_SECRET,channel=process.env.TWITCH_CHANNEL || 'tomsofoot';
  if(!client || !secret)return reply(503,{live:null,error:'not_configured'});
  try {
    if(cached && Date.now()-cached.at<45000)return reply(200,cached.data);
    if(!pending)pending=(async()=>{
      if(!token || Date.now()>token.until){
        const r=await fetch('https://id.twitch.tv/oauth2/token',{method:'POST',body:new URLSearchParams({client_id:client,client_secret:secret,grant_type:'client_credentials'}),signal:AbortSignal.timeout(8000)});
        if(!r.ok)throw Error();const t=await r.json();if(!t.access_token)throw Error();token={value:t.access_token,until:Date.now()+Math.max(0,Number(t.expires_in)-60)*1000};
      }
      const r=await fetch('https://api.twitch.tv/helix/streams?user_login='+encodeURIComponent(channel),{headers:{'Client-ID':client,Authorization:'Bearer '+token.value},signal:AbortSignal.timeout(8000)});
      if(r.status===401)token=null;if(!r.ok)throw Error();const j=await r.json();if(!Array.isArray(j.data))throw Error();
      const s=j.data[0];const data=s?{live:true,title:s.title,viewers:s.viewer_count,thumbnail:typeof s.thumbnail_url==='string'?s.thumbnail_url.replace('{width}','1280').replace('{height}','720'):null}:{live:false};
      cached={at:Date.now(),data};return data;
    })().finally(()=>pending=null);
    return reply(200,await pending);
  } catch {headers['Cache-Control']='no-store';return reply(503,{live:null,error:'twitch_unavailable'});}
}
