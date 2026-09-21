import core from '../../../match-details-api.js';

const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
const LIVE_MS=15000,PRE_MS=5*60000,POST_MS=60*60000,STALE_MS=24*60*60000;
const period=data=>data.status.state==='live'?LIVE_MS:data.status.state==='post'?POST_MS:data.status.state==='pre'?Math.max(LIVE_MS,Math.min(PRE_MS,Date.parse(data.date)-Date.parse(data.fetchedAt))):PRE_MS;

// Netlify Blobs in production, memory only in the local preview.
export function createMatchDetailsHandler({getKey=()=>process.env.APISPORTS_KEY,store,fetcher=fetch,now=Date.now}={}){
  const pending=new Map(),memory=new Map(),retryAfter=new Map();
  async function remember(key,value){memory.set(key,value);if(memory.size>100)memory.delete(memory.keys().next().value);try{await store?.setJSON(key,value);}catch{}}
  async function retrieve(key){const local=memory.get(key);if(local?.data&&now()-Date.parse(local.data.fetchedAt)<period(local.data))return local;try{return await store?.get(key,{type:'json',consistency:'strong'})||local;}catch{return local;}}
  async function load(ref){
    const key='match-detail-v1:'+ref.event,cached=await retrieve(key),old=cached?.data;
    const usable=old&&core.valid(old,ref)&&now()-Date.parse(old.fetchedAt)<STALE_MS;
    if(usable&&now()-Date.parse(old.fetchedAt)<period(old))return {data:old,stale:false};
    if((retryAfter.get(key)||0)>now())return usable?{data:old,stale:true,error:'upstream_unavailable'}:{error:'upstream_unavailable',status:503};
    const apiKey=getKey();if(!apiKey)return usable?{data:old,stale:true,error:'no_key'}:{error:'no_key',status:503};
    try{
      const response=await fetcher('https://v3.football.api-sports.io/fixtures?ids='+ref.event+'&timezone=Europe%2FParis',{headers:{'x-apisports-key':apiKey},signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw Error('upstream_http');
      const raw=await response.json();
      // API-Sports can return HTTP 200 with an errors object (quota, account, etc.).
      if(!raw||Object.keys(raw.errors||{}).length||!Array.isArray(raw.response))throw Error('upstream_error');
      if(raw.response.length===0)return usable?{data:old,stale:true,error:'not_found'}:{error:'not_found',status:404};
      if(raw.response.length!==1)throw Error('unexpected_fixtures');
      const data=core.normalize(raw.response[0],ref,new Date(now()).toISOString());
      await remember(key,{data});retryAfter.delete(key);return {data,stale:false};
    }catch{
      retryAfter.set(key,now()+60000);
      return usable?{data:old,stale:true,error:'upstream_unavailable'}:{error:'upstream_unavailable',status:502};
    }
  }
  return async request=>{
    if(request.method!=='GET')return reply({error:'method_not_allowed'},405);
    const params=new URL(request.url).searchParams,value=params.get('fixture');
    if(params.getAll('fixture').length!==1||!/^[1-9]\d{0,9}$/.test(value||'')||[...params.keys()].some(k=>k!=='fixture'))return reply({error:'invalid_fixture'},400);
    if(!pending.has(value))pending.set(value,load({event:value}));
    let result;try{result=await pending.get(value);}finally{pending.delete(value);}
    if(result.data)return reply({data:result.data,stale:result.stale,error:result.error||null,refreshAfter:Math.max(1,Math.ceil((period(result.data)-(now()-Date.parse(result.data.fetchedAt)))/1000))});
    return reply({error:result.error},result.status);
  };
}
