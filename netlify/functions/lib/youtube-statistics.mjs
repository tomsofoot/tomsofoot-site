import manualDefaults from './youtube-manual-stats.mjs';
const count=value=> /^(0|[1-9]\d*)$/.test(String(value ?? '')) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
export async function youtubeStatistics(video,{fetchImpl=fetch,key=process.env.YOUTUBE_API_KEY,manual=manualDefaults,now=Date.now}={}) {
  const stats={videoViews:null,channelViews:null,videoViewsLabel:video.publicViewsLabel || null,source:video.publicViewsLabel?'youtube-public':null,updatedAt:null,manualVideoAt:null,manualChannelAt:null};
  if(manual.updatedAt && Number.isFinite(Date.parse(manual.updatedAt)) && Date.parse(manual.updatedAt)<=now()) {
    if(manual.videoId===video.id)stats.videoViews=count(manual.videoViews);
    stats.channelViews=count(manual.channelViews);
    if(stats.videoViews!==null)stats.manualVideoAt=manual.updatedAt;
    if(stats.channelViews!==null)stats.manualChannelAt=manual.updatedAt;
    if(stats.videoViews!==null || stats.channelViews!==null){stats.source='manual';stats.updatedAt=manual.updatedAt;}
  }
  if(!key)return stats;
  // API Data v3 : statistiques vidéo + chaîne. La clé ne quitte jamais le serveur.
  const requests=[['videos',video.id,'snippet,statistics'],['channels',video.channelId,'statistics']];
  await Promise.all(requests.map(async([resource,id,part])=>{
    try{
      const url=new URL('https://www.googleapis.com/youtube/v3/'+resource);url.search=new URLSearchParams({id,part,key});
      const r=await fetchImpl(url,{signal:AbortSignal.timeout(6000)});if(!r.ok)return;
      const item=(await r.json()).items?.find(item=>item.id===id);if(!item)return;
      if(resource==='videos' && item.snippet?.channelId!==video.channelId)return;
      const value=count(item.statistics?.viewCount);if(value===null)return;
      stats[resource==='videos'?'videoViews':'channelViews']=value;
      stats[resource==='videos'?'manualVideoAt':'manualChannelAt']=null;
      stats.source='youtube-api';stats.updatedAt=new Date(now()).toISOString();
    }catch{/* Le défaut de statistiques ne masque jamais la vidéo. */}
  }));
  return stats;
}
