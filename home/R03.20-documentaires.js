(() => {
  // Le module se monte une seule fois, à réception des données secondaires.
  let started=false;
  function start(){
  'use strict';
  const root=document.getElementById('docs-root'), data=window.TF_DATA;
  if(!root||started)return;
  if(!data?.docs?.videos?.length && window.TF_HOME?.secondaryPending){root.setAttribute('aria-busy','true');root.innerHTML='<p role="status">Les documentaires se chargent…</p>';return;}
  root.setAttribute('aria-busy','false');
  if(!data?.docs?.videos?.length){root.innerHTML='<p>Les documentaires sont momentanément indisponibles. <a href="https://www.youtube.com/@Tomso-Foot">Voir la chaîne YouTube ↗</a></p>';return;}
  started=true;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const asset=url=>data.assets[url] || url, pad=n=>String(n).padStart(2,'0');
  const channelId='UCdM1YrE1qIwEzro69wuRtlQ', channel=`https://www.youtube.com/channel/${channelId}/videos`;
  const play='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7Z"/></svg>';
  const originals=data.docs.videos;
  let index=0,selected=null,feed=null,busy=false,visible=false,status='Chargement des vidéos récentes…';
  const current=()=>selected || originals[index];
  const views=video=>Number.isSafeInteger(video.views) ? new Intl.NumberFormat('fr-FR').format(video.views)+' vues' : video.views || '';
  const metadata=video=>[views(video),video.duration].filter(Boolean).join(' · ');
  function renderQueue(){
    const aside=root.querySelector('.doc-next');if(!aside)return;
    const currentURL=current().url;
    const rows=(feed?.videos || []).map((video,i)=>({video,rank:i+1})).filter(({video})=>video.url!==currentURL).slice(0,3);
    aside.innerHTML=`<span class="kicker" id="doc-queue-heading">À suivre</span><p class="doc-queue-note">Vidéos récentes · Les plus vues d’abord</p>${rows.map(({video:v,rank})=>`<button type="button" data-queue-video="${escape(v.id)}" aria-label="Voir : ${escape(v.title)}"><span class="doc-rank" aria-hidden="true">${pad(rank)}</span><img src="${escape(v.thumbnail)}" alt="" loading="lazy"><span><strong>${escape(v.title)}</strong><small>${escape(metadata(v))}</small></span></button>`).join('')}<p class="doc-queue-status" role="status">${escape(status)}</p>${!rows.length?`<a class="doc-queue-channel" href="${channel}" target="_blank" rel="noopener noreferrer">Voir les vidéos sur YouTube ↗</a>`:''}`;
    aside.setAttribute('aria-labelledby','doc-queue-heading');
  }
  function render(){
    const v=current(), count=selected?feed.videos.length:originals.length;
    const position=selected?feed.videos.findIndex(item=>item.id===selected.id)+1:index+1;
    const format=selected?'Vidéo':'Documentaire';
    root.innerHTML=`<div class="doc-layout"><div class="doc-feature"><a class="doc-image" href="${escape(v.url)}"><img loading="lazy" decoding="async" src="${escape(asset(v.thumbnail))}" alt="${escape(v.title)}"><span class="play">${play}</span>${v.duration?`<span class="duration">${escape(v.duration)}</span>`:''}</a><div class="doc-copy"><span class="kicker">${selected?'À suivre sur la chaîne':'Documentaire à la une'}</span><h3 id="doc-title">${escape(v.title)}</h3><p class="meta">${escape(metadata(v))}</p><a class="button primary" id="doc-watch" href="${escape(v.url)}">${selected?'Regarder la vidéo':'Regarder le film'} ${play}</a></div></div><aside class="doc-next"></aside></div><div class="doc-band"><div><span>Format</span><strong>${format}</strong></div>${views(v)?`<div><span>Vues</span><strong>${escape(views(v))}</strong></div>`:''}${v.duration?`<div><span>Durée</span><strong>${escape(v.duration)}</strong></div>`:''}<div class="doc-navigation"><span id="doc-pos">${pad(position)} / ${pad(count)}</span><button type="button" data-doc-prev aria-label="${selected?'Vidéo':'Documentaire'} précédent">←</button><button type="button" data-doc-next aria-label="${selected?'Vidéo':'Documentaire'} suivant">→</button></div></div>`;
    renderQueue();
  }
  root.addEventListener('click',event=>{
    const button=event.target.closest('[data-queue-video],[data-doc-prev],[data-doc-next]');if(!button)return;
    const wasQueue=button.hasAttribute('data-queue-video');
    if(wasQueue){selected=feed?.videos.find(v=>v.id===button.dataset.queueVideo);if(!selected)return;}
    else {
      const step=button.hasAttribute('data-doc-next')?1:-1;
      if(selected){const list=feed.videos,pos=list.findIndex(v=>v.id===selected.id);selected=list[(pos+step+list.length)%list.length];}
      else index=(index+step+originals.length)%originals.length;
    }
    render();
    // Le clavier reste dans le module après reconstruction, sans déplacement animé forcé.
    root.querySelector(wasQueue?'#doc-watch':button.hasAttribute('data-doc-next')?'[data-doc-next]':'[data-doc-prev]')?.focus({preventScroll:true});
  });
  root.addEventListener('error',event=>{
    const img=event.target;
    if(img.tagName!=='IMG')return;
    const match=/^https:\/\/i\.ytimg\.com\/vi\/([\w-]{11})\/hq720\.jpg$/.exec(img.src);
    if(match)img.src=`https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg`;
  },true);
  async function refresh(){
    if(busy)return;busy=true;
    try{
      const response=await fetch('/.netlify/functions/youtube-following',{signal:AbortSignal.timeout(60000)});
      if(!response.ok)throw Error('unavailable');
      const next=await response.json();
      if(next.channelId!==channelId || next.selection!=='recent-classic-by-views' || !Array.isArray(next.videos))throw Error('invalid');
      if(next.videos.some((v,i)=>!/^[\w-]{11}$/.test(v.id) || !v.title || v.channelId!==channelId || v.isShort!==false ||
        !Number.isSafeInteger(v.views) || v.views<0 || !(v.durationSeconds>60) ||
        v.url!==`https://www.youtube.com/watch?v=${v.id}` || v.thumbnail!==`https://i.ytimg.com/vi/${v.id}/hq720.jpg` ||
        (i>0 && next.videos[i-1].views<v.views)))throw Error('invalid');
      // Une actualisation ne remplace pas un film que le lecteur vient de choisir.
      if(selected && !next.videos.some(v=>v.id===selected.id))return;
      feed=next;
      status=next.stale?'Actualisation indisponible · dernière sélection vérifiée conservée.':next.incomplete?'Certaines vidéos sont momentanément indisponibles.':!next.videos.length?'Aucune vidéo classique disponible pour le moment.':'';
    }catch{status=feed?'Actualisation indisponible · dernière sélection vérifiée conservée.':'La sélection est momentanément indisponible. Retrouvez les vidéos sur la chaîne.';}
    finally{
      busy=false;
      // Ne retire pas le bouton sous le focus pendant une consultation au clavier.
      if(!root.querySelector('.doc-next')?.contains(document.activeElement))renderQueue();
    }
  }
  render();
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible && !feed)refresh();},{rootMargin:'600px'}).observe(root);
  setInterval(()=>{if(visible && !document.hidden)refresh();},300000);
  root.addEventListener('focusout',()=>{requestAnimationFrame(()=>{if(!root.querySelector('.doc-next')?.contains(document.activeElement))renderQueue();});});
  }
  window.addEventListener('tomsofoot:home-secondary',start,{once:true});
  start();
})();
