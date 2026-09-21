export const validEmail=value=>typeof value==='string'&&value.trim().length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
export function createNewsletterHandler({store,origin}){
 return async req=>{
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
  if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
  if(req.headers.get('origin')!==origin||!/^application\/json(?:;|$)/i.test(req.headers.get('content-type')||''))return reply({error:'invalid_origin'},403);
  let body;try{const text=await req.text();if(text.length>2048)return reply({error:'body_too_large'},413);body=JSON.parse(text);}catch{return reply({error:'invalid_body'},400);}
  if(!validEmail(body?.email))return reply({status:'invalid_email'},400);
  if(body?.consent!==true)return reply({status:'consent_required'},400);
  try{
   const result=await store('subscribe_newsletter',{p_email:body.email.trim().toLowerCase(),p_consent:true});
   if(!['subscribed','already_subscribed','invalid_email','consent_required'].includes(result?.status))throw Error();
   return reply(result,['invalid_email','consent_required'].includes(result.status)?400:200);
  }catch{return reply({error:'temporarily_unavailable'},503);}
 };
}
