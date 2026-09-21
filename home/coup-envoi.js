(() => {
  'use strict';
  const card = document.querySelector('#coup-denvoi .youtube');
  if (!card) return;
  const channel = 'https://www.youtube.com/@Tomso-Foot/videos';
  card.classList.add('kickoff-channel');
  card.innerHTML = `<div class="kickoff-identity"><img class="kickoff-art" src="/home/assets/coup-envoi-cinema.webp" alt="" loading="lazy"><div class="kickoff-brand-copy"><span class="kicker">La chaîne YouTube TomsoFoot</span><h2 id="kickoff-heading">Coup<br>d’envoi.</h2><a class="button outline" href="${channel}" target="_blank" rel="noopener noreferrer">Voir ma chaîne <span aria-hidden="true">↗</span></a></div></div><div class="kickoff-latest"><p class="kicker" id="latest-video-label">Dernière vidéo · Hors Shorts</p><div class="latest-video" hidden><div class="latest-video-media"><button class="latest-video-play" type="button"><img class="latest-video-thumb" alt="" loading="lazy"><span class="latest-video-play-icon" aria-hidden="true">▶</span><span class="latest-video-duration"></span></button></div><div class="youtube-metrics"><span class="youtube-brand"><svg viewBox="0 0 28 20" aria-hidden="true"><rect width="28" height="20" rx="6" fill="#ff3048"/><path d="m11 5 8 5-8 5Z" fill="white"/></svg>YouTube</span><span class="youtube-video-views" hidden></span><span class="youtube-channel-views" hidden></span></div><h3><a class="latest-video-title" target="_blank" rel="noopener noreferrer"></a></h3><a class="latest-video-watch" target="_blank" rel="noopener noreferrer">Regarder sur YouTube <span aria-hidden="true">↗</span></a></div><p class="latest-video-status" role="status">Chargement de la dernière vidéo…</p></div>`;
  const $ = selector => card.querySelector(selector);
  const status = $('.latest-video-status'), video = $('.latest-video');
  let current = null, busy = false, playing = false, visible = false;
  function render(data) {
    if (!/^[\w-]{11}$/.test(data?.id || '') || data.channelId !== 'UCdM1YrE1qIwEzro69wuRtlQ' || data.isShort !== false || data.selection !== 'channel-videos-latest' || !data.title?.trim()) throw Error('invalid_video');
    if (playing) return;
    const changed = data.id !== current?.id;
    current = data;
    const url = `https://www.youtube.com/watch?v=${data.id}`;
    $('.latest-video-title').textContent = data.title;
    $('.latest-video-title').href = url;
    $('.latest-video-watch').href = url;
    $('.latest-video-duration').textContent = data.duration || '';
    $('.latest-video-duration').hidden = !data.duration;
    $('.latest-video-play').setAttribute('aria-label', 'Lire la vidéo : ' + data.title);
    if (changed) {
      const thumbnail = $('.latest-video-thumb');
      thumbnail.onerror = () => { thumbnail.onerror = null; thumbnail.src = `https://i.ytimg.com/vi/${data.id}/hqdefault.jpg`; };
      thumbnail.src = `https://i.ytimg.com/vi/${data.id}/hq720.jpg`;
    }
    $('#latest-video-label').textContent = data.stale ? 'À voir sur la chaîne · Hors Shorts' : 'Dernière vidéo · Hors Shorts';
    status.textContent = data.stale ? 'Actualisation momentanément indisponible. Dernière vidéo vérifiée conservée.' : '';
    status.hidden = !data.stale;
    const stats=data.statistics || {}, format=value=>new Intl.NumberFormat('fr-FR').format(value);
    const videoViews=$('.youtube-video-views'), channelViews=$('.youtube-channel-views');
    videoViews.textContent=Number.isSafeInteger(stats.videoViews) && stats.videoViews>=0 ? format(stats.videoViews)+' vues sur cette vidéo' : stats.videoViewsLabel || '';
    videoViews.hidden=!videoViews.textContent;
    channelViews.textContent=Number.isSafeInteger(stats.channelViews) && stats.channelViews>=0 ? format(stats.channelViews)+' vues sur la chaîne' : '';
    channelViews.hidden=!channelViews.textContent;
    if(stats.manualVideoAt)videoViews.textContent+=' · relevé du '+new Date(stats.manualVideoAt).toLocaleDateString('fr-FR');
    if(stats.manualChannelAt)channelViews.textContent+=' · relevé du '+new Date(stats.manualChannelAt).toLocaleDateString('fr-FR');
    $('.youtube-metrics').title=stats.source==='manual'?'Relevé du '+new Date(stats.updatedAt).toLocaleDateString('fr-FR'):stats.source==='youtube-public'?'Nombre arrondi affiché publiquement par YouTube':'Statistiques YouTube';
    video.hidden = false;
  }
  $('.latest-video-play').addEventListener('click', () => {
    if (!current || playing) return;
    playing = true;
    const frame = document.createElement('iframe');
    frame.title = current.title;
    frame.src = `https://www.youtube-nocookie.com/embed/${current.id}?autoplay=1&rel=0`;
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    $('.latest-video-media').replaceChildren(frame);
    frame.focus();
  });
  async function refresh() {
    if (busy || playing) return;
    busy = true;
    try {
      const response = await fetch('/.netlify/functions/youtube-latest-long', {signal: AbortSignal.timeout(15000)});
      if (!response.ok) throw Error('video_unavailable');
      render(await response.json());
    } catch {
      status.hidden = false;
      status.textContent = current ? 'Actualisation momentanément indisponible. Dernière vidéo vérifiée conservée.' : 'La vidéo est momentanément indisponible. Retrouvez les publications sur la chaîne.';
      if (current) $('#latest-video-label').textContent = 'À voir sur la chaîne · Hors Shorts';
    } finally { busy = false; }
  }
  refresh();
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; }).observe(card);
  setInterval(() => { if (visible && !document.hidden) refresh(); }, 300000);
})();
