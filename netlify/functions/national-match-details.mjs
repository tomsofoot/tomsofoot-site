import feedModule from './lib/nations-feed.cjs';
const nations=feedModule.createFeed();
export default async req=>{
 let body,status=200;
 if(req.method!=='GET'){body={error:'method_not_allowed'};status=405;}
 else try{body=await nations.detail(new URL(req.url).searchParams.get('event')||'');}
 catch(e){status=e.message==='invalid_fixture'?400:e.message==='not_found'?404:503;body={error:status===503?'upstream_unavailable':e.message};}
 return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
};
