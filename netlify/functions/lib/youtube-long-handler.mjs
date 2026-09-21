// La sélection vient uniquement de l'onglet Vidéos, trié par date : pas du RSS mêlant Shorts et vidéos.
import {youtubeStatistics} from './youtube-statistics.mjs';
export const TOMSOFOOT_CHANNEL = 'UCdM1YrE1qIwEzro69wuRtlQ';
const text = value => typeof value === 'string' ? value.trim() : '';
const ytText = value => text(value?.simpleText) || (value?.runs || []).map(run => text(run.text)).join('');
const validId = value => /^[\w-]{11}$/.test(value || '');
const durationSeconds = value => /^\d{1,3}:\d{2}(?::\d{2})?$/.test(value || '') ? value.split(':').reduce((sum, part) => sum * 60 + Number(part), 0) : 0;

export function initialData(html) {
  // Lecture JSON uniquement : aucun script de la page distante n'est exécuté.
  const marker = 'var ytInitialData = ';
  const offset = html.indexOf(marker);
  if (offset < 0) throw new Error('youtube_structure_unavailable');
  let depth = 0, quoted = false, escaped = false;
  const start = offset + marker.length;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  throw new Error('youtube_structure_unavailable');
}

export function selectLatestVideo(data, channelId = TOMSOFOOT_CHANNEL) {
  const channel = data?.metadata?.channelMetadataRenderer;
  if (channel?.externalId !== channelId) throw new Error('youtube_channel_mismatch');
  const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
  const selected = tabs.find(item => item.tabRenderer?.selected)?.tabRenderer;
  const tabUrl = selected?.endpoint?.commandMetadata?.webCommandMetadata?.url || '';
  if (!/\/videos(?:\?|$)/.test(tabUrl)) throw new Error('youtube_videos_tab_required');
  const grid = selected.content?.richGridRenderer;
  const chips = grid?.header?.chipBarViewModel?.chips || [];
  const selectedChip = chips.find(item => item.chipViewModel?.selected)?.chipViewModel;
  if (!/^(Les plus récentes|Latest|Récentes)$/i.test(selectedChip?.text || '')) throw new Error('youtube_latest_sort_required');

  for (const item of grid.contents || []) {
    const content = item.richItemRenderer?.content;
    const lockup = content?.lockupViewModel, renderer = content?.videoRenderer;
    let id, title, duration, target, publicViewsLabel=null;
    if (lockup?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
      id = lockup.contentId;
      title = text(lockup.metadata?.lockupMetadataViewModel?.title?.content);
      const parts=lockup.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.flatMap(row=>row.metadataParts || []) || [];
      const views=parts.find(part=>/vues|views/i.test(part.accessibilityLabel || part.text?.accessibility?.accessibilityData?.label || part.text?.content || ''));
      const candidate=text(views?.text?.content).replace(/\s*(vues|views)$/i,'').trim();
      if(/^[\d\s.,]+\s*[kmb]?$/i.test(candidate))publicViewsLabel=candidate+' vues';
      target = lockup.rendererContext?.commandContext?.onTap?.innertubeCommand?.commandMetadata?.webCommandMetadata?.url;
      const overlays = lockup.contentImage?.thumbnailViewModel?.overlays || [];
      duration = overlays.flatMap(item => item.thumbnailBottomOverlayViewModel?.badges || []).map(item => item.thumbnailBadgeViewModel?.text).find(item => durationSeconds(item) > 0);
    } else if (renderer && !renderer.upcomingEventData && !renderer.isLive) {
      id = renderer.videoId; title = ytText(renderer.title); duration = ytText(renderer.lengthText);
      target = renderer.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url;
    } else continue;
    // Les cartes Shorts, liens /shorts, directs et premières sans durée sont écartés.
    // Pas de seuil arbitraire de 3 minutes : une vidéo classique courte reste éligible.
    const seconds = durationSeconds(duration);
    if (!validId(id) || !title || !seconds || !/^\/watch\?/.test(target || '')) continue;
    if (new URL(target, 'https://www.youtube.com').searchParams.get('v') !== id) continue;
    return {
      id, title, duration, durationSeconds: seconds, channelId, channelTitle: text(channel.title), publicViewsLabel,
      isShort: false, selection: 'channel-videos-latest',
      url: `https://www.youtube.com/watch?v=${id}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/hq720.jpg`,
      fallbackThumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      channelUrl: `https://www.youtube.com/channel/${channelId}/videos`
    };
  }
  throw new Error('youtube_video_unavailable');
}

export function createYoutubeLongHandler({fetchImpl = fetch, now = Date.now, channelId = process.env.YOUTUBE_CHANNEL_ID || TOMSOFOOT_CHANNEL} = {}) {
  let cached = null, pending = null;
  const ttl = 300000;
  async function retrieve() {
    if (!/^UC[\w-]{22}$/.test(channelId)) throw new Error('youtube_channel_invalid');
    const response = await fetchImpl(`https://www.youtube.com/channel/${channelId}/videos?hl=fr`, {
      headers: {'User-Agent': 'Mozilla/5.0 TomsoFoot/1.0', 'Accept-Language': 'fr-FR,fr;q=0.9'},
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error('youtube_unavailable');
    const html = await response.text();
    if (html.length > 8000000) throw new Error('youtube_response_too_large');
    const video = selectLatestVideo(initialData(html), channelId);
    const statistics=await youtubeStatistics(video,{fetchImpl,now});
    cached = {at: now(), video: {...video, statistics, fetchedAt: new Date(now()).toISOString()}};
    return cached.video;
  }
  return async function handler(event = {}) {
    const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60, s-maxage=300'};
    if (event.httpMethod && event.httpMethod !== 'GET') return {statusCode:405,headers:{...headers,Allow:'GET'},body:JSON.stringify({error:'method_not_allowed'})};
    try {
      if (cached && now() - cached.at < ttl) return {statusCode:200,headers,body:JSON.stringify({...cached.video,stale:false})};
      if (!pending) pending = retrieve().finally(() => { pending = null; });
      return {statusCode:200,headers,body:JSON.stringify({...await pending,stale:false})};
    } catch {
      // Ne jamais remplacer la vidéo par un titre, une miniature ou une URL inventés.
      headers['Cache-Control'] = 'no-store';
      if (cached && now() - cached.at < 86400000) return {statusCode:200,headers,body:JSON.stringify({...cached.video,stale:true})};
      return {statusCode:503,headers,body:JSON.stringify({error:'youtube_unavailable'})};
    }
  };
}
