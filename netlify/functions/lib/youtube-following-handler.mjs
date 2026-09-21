import {initialData, TOMSOFOOT_CHANNEL} from './youtube-long-handler.mjs';

// Même chaîne et même secret que Coup d'envoi. Ces paramètres restent serveur.
export const RECENT_WINDOW = 30;
const validId = value => /^[\w-]{11}$/.test(value || '');
const clean = value => typeof value === 'string' ? value.trim() : '';
const exactCount = value => /^(0|[1-9]\d*)$/.test(String(value ?? '')) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const hasShortsTag = value => /#shorts?\b/iu.test(value || '');
export function secondsFromISO(value) {
  const parts = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value || '');
  return parts ? Number(parts[1] || 0)*86400 + Number(parts[2] || 0)*3600 + Number(parts[3] || 0)*60 + Number(parts[4] || 0) : null;
}
const durationLabel = seconds => {
  const n = Math.floor(seconds), h = Math.floor(n/3600), m = Math.floor(n/60)%60, s = String(n%60).padStart(2,'0');
  return h ? `${h}:${String(m).padStart(2,'0')}:${s}` : `${m}:${s}`;
};
export function classicVideo(video, channelId = TOMSOFOOT_CHANNEL) {
  const {width,height} = video;
  // Une miniature n'indique PAS le format de la vidéo. On utilise le lecteur.
  if (!validId(video.id) || video.channelId !== channelId || !clean(video.title) ||
      !Number.isFinite(video.seconds) || video.seconds <= 60 || video.live ||
      !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
      height > width || (height === width && video.seconds <= 180) ||
      hasShortsTag(video.title+' '+(video.description || '')) || video.tags?.some(tag => /^#?shorts?$/i.test(tag)) ||
      exactCount(video.views) === null) return null;
  return {id:video.id, channelId, title:clean(video.title), views:exactCount(video.views),
    duration:durationLabel(video.seconds), durationSeconds:video.seconds, isShort:false,
    width, height, publishedAt:video.publishedAt || null,
    url:`https://www.youtube.com/watch?v=${video.id}`,
    thumbnail:`https://i.ytimg.com/vi/${video.id}/hq720.jpg`};
}
export function rankVideos(videos) {
  return [...new Map(videos.filter(Boolean).map(v=>[v.id,v])).values()]
    .sort((a,b)=>b.views-a.views || (Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0) || a.id.localeCompare(b.id));
}
// Analyse JSON bornée, jamais d'eval ni d'exécution des scripts YouTube.
export function playerData(html) {
  const marker='var ytInitialPlayerResponse = ', offset=html.indexOf(marker);
  if(offset<0)throw Error('youtube_player_unavailable');
  let depth=0,quoted=false,escaped=false;
  const start=offset+marker.length;
  for(let i=start;i<html.length;i++){
    const c=html[i];
    if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}' && --depth===0)return JSON.parse(html.slice(start,i+1));
  }
  throw Error('youtube_player_unavailable');
}
export function recentPublicIds(data,channelId=TOMSOFOOT_CHANNEL,limit=RECENT_WINDOW) {
  if(data?.metadata?.channelMetadataRenderer?.externalId!==channelId)throw Error('youtube_channel_mismatch');
  const tab=data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.find(x=>x.tabRenderer?.selected)?.tabRenderer;
  if(!/\/videos(?:\?|$)/.test(tab?.endpoint?.commandMetadata?.webCommandMetadata?.url || ''))throw Error('youtube_videos_tab_required');
  const grid=tab?.content?.richGridRenderer;
  const selected=grid?.header?.chipBarViewModel?.chips?.find(x=>x.chipViewModel?.selected)?.chipViewModel;
  if(!/^(Les plus récentes|Latest|Récentes)$/i.test(selected?.text || ''))throw Error('youtube_latest_sort_required');
  const ids=[];
  for(const item of grid.contents || []){
    const c=item.richItemRenderer?.content, l=c?.lockupViewModel, r=c?.videoRenderer;
    const id=l?.contentId || r?.videoId;
    const url=l?.rendererContext?.commandContext?.onTap?.innertubeCommand?.commandMetadata?.webCommandMetadata?.url || r?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url;
    if(validId(id) && /^\/watch\?/.test(url || '') && new URL(url,'https://www.youtube.com').searchParams.get('v')===id)ids.push(id);
    if(ids.length>=limit)break;
  }
  if(!ids.length)throw Error('youtube_recent_unavailable');
  return [...new Set(ids)];
}
async function mapLimit(values,limit,fn) {
  let next=0;const result=new Array(values.length);
  await Promise.all(Array.from({length:Math.min(limit,values.length)},async()=>{while(next<values.length){const i=next++;result[i]=await fn(values[i]);}}));
  return result;
}
export function createYoutubeFollowingHandler({fetchImpl=fetch, now=Date.now,
  key=process.env.YOUTUBE_API_KEY, channelId=process.env.YOUTUBE_CHANNEL_ID || TOMSOFOOT_CHANNEL,
  recentLimit=RECENT_WINDOW, allowPublic=true}={}) {
  const limit=Math.max(1,Math.min(50,Number(recentLimit)||RECENT_WINDOW));
  let cached=null,pending=null,failedAt=null;
  const ttl=600000, maxStale=86400000;
  async function getJSON(url){const r=await fetchImpl(url,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('youtube_unavailable');return r.json();}
  async function getHTML(url){const r=await fetchImpl(url,{headers:{'User-Agent':'Mozilla/5.0 TomsoFoot/1.0','Accept-Language':'fr-FR,fr;q=0.9'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('youtube_unavailable');const h=await r.text();if(h.length>8000000)throw Error('youtube_response_too_large');return h;}
  async function api(resource,params){
    const url=new URL('https://www.googleapis.com/youtube/v3/'+resource);
    url.search=new URLSearchParams({...params,key});
    // Aucune URL amont ni erreur Google (susceptible de contenir la clé) n'est renvoyée.
    const data=await getJSON(url);if(data.error || !Array.isArray(data.items))throw Error('youtube_unavailable');return data;
  }
  async function playerSize(id){
    const data=await getJSON('https://www.youtube.com/oembed?'+new URLSearchParams({url:`https://www.youtube.com/watch?v=${id}`,format:'json'}));
    return {width:Number(data.width),height:Number(data.height)};
  }
  async function fromAPI(){
    const channel=(await api('channels',{part:'contentDetails',id:channelId})).items.find(x=>x.id===channelId);
    const playlistId=channel?.contentDetails?.relatedPlaylists?.uploads;
    if(!playlistId)throw Error('youtube_channel_unavailable');
    const uploads=await api('playlistItems',{part:'contentDetails',playlistId,maxResults:String(limit)});
    const ids=[...new Set(uploads.items.map(x=>x.contentDetails?.videoId).filter(validId))];
    if(!ids.length)return {videos:[],source:'youtube-api',inspected:0,incomplete:false};
    const items=(await api('videos',{part:'snippet,contentDetails,statistics,status,player',id:ids.join(','),maxWidth:'1280',maxResults:'50'})).items;
    let incomplete=false;
    const videos=await mapLimit(items,4,async(item)=>{
      if(!ids.includes(item.id) || item.status?.privacyStatus!=='public')return null;
      const snippet=item.snippet || {}, seconds=secondsFromISO(item.contentDetails?.duration);
      if(!seconds || seconds<=60 || snippet.liveBroadcastContent!=='none' || hasShortsTag(snippet.title+' '+snippet.description))return null;
      let size={width:Number(item.player?.embedWidth),height:Number(item.player?.embedHeight)};
      if(!size.width || !size.height){try{size=await playerSize(item.id);}catch{incomplete=true;return null;}}
      if(exactCount(item.statistics?.viewCount)===null)incomplete=true;
      return classicVideo({id:item.id,channelId:snippet.channelId,title:snippet.title,description:snippet.description,tags:snippet.tags,
        seconds,views:item.statistics?.viewCount,publishedAt:snippet.publishedAt,...size},channelId);
    });
    return {videos:rankVideos(videos),source:'youtube-api',inspected:ids.length,incomplete};
  }
  async function fromPublic(){
    // Repli identique à Coup d'envoi : onglet Vidéos récent, puis métadonnées
    // publiques de chaque lecteur. Jamais de conversion des vues arrondies « 42 k ».
    const data=initialData(await getHTML(`https://www.youtube.com/channel/${channelId}/videos?hl=fr`));
    const ids=recentPublicIds(data,channelId,limit);let incomplete=false;
    const videos=await mapLimit(ids,4,async(id)=>{
      try{
        const player=playerData(await getHTML(`https://www.youtube.com/watch?v=${id}&hl=fr`));
        const v=player.videoDetails, micro=player.microformat?.playerMicroformatRenderer;
        if(!v || v.videoId!==id)throw Error('youtube_video_unavailable');
        if(v.isLiveContent || Number(v.lengthSeconds)<=60 || hasShortsTag(v.title+' '+v.shortDescription))return null;
        const size=await playerSize(id);
        if(exactCount(v.viewCount)===null)incomplete=true;
        return classicVideo({id,channelId:v.channelId,title:v.title,description:v.shortDescription,
          tags:v.keywords,seconds:Number(v.lengthSeconds),views:v.viewCount,publishedAt:micro?.publishDate,...size},channelId);
      }catch{incomplete=true;return null;}
    });
    if(!videos.some(Boolean) && incomplete)throw Error('youtube_unavailable');
    return {videos:rankVideos(videos),source:'youtube-public',inspected:ids.length,incomplete};
  }
  async function retrieve(){
    if(!/^UC[\w-]{22}$/.test(channelId))throw Error('youtube_channel_invalid');
    let result;
    if(key){try{result=await fromAPI();}catch{if(!allowPublic)throw Error('youtube_unavailable');}}
    if(!result){if(!allowPublic)throw Error('youtube_unavailable');result=await fromPublic();}
    cached={...result,channelId,recentLimit:limit,selection:'recent-classic-by-views',fetchedAt:new Date(now()).toISOString()};
    failedAt=null;return cached;
  }
  return async function handler(event={}){
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=60, s-maxage=300'};
    if(event.httpMethod && event.httpMethod!=='GET')return {statusCode:405,headers:{...headers,Allow:'GET'},body:JSON.stringify({error:'method_not_allowed'})};
    try{
      if(cached && now()-Date.parse(cached.fetchedAt)<ttl)return {statusCode:200,headers,body:JSON.stringify({...cached,stale:false})};
      if(failedAt!==null && now()-failedAt<60000)throw Error('retry_later');
      if(!pending)pending=retrieve().catch(error=>{failedAt=now();throw error;}).finally(()=>{pending=null;});
      return {statusCode:200,headers,body:JSON.stringify({...await pending,stale:false})};
    }catch{
      headers['Cache-Control']='no-store';
      if(cached && now()-Date.parse(cached.fetchedAt)<maxStale)return {statusCode:200,headers,body:JSON.stringify({...cached,stale:true})};
      return {statusCode:503,headers,body:JSON.stringify({error:'youtube_unavailable'})};
    }
  };
}
