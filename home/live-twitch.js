(() => {
  'use strict';
  const section=document.querySelector('#live'), card=section?.querySelector('.live-card');if(!card)return;
  const link=card.querySelector('a').href;
  card.className='twitch-stage';
  card.innerHTML='<img class="twitch-backdrop" src="/home/assets/live-background.png" alt="" loading="lazy"><div class="twitch-shade"></div><div class="twitch-orbit" aria-hidden="true"></div><div class="twitch-content"><div class="twitch-topline"><span class="twitch-wordmark"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 2 1 6v16h6v2l4-2h4l7-7V2H4zm16 12-4 4h-5l-4 3v-3H4V4h16v10zm-4-7h2v6h-2V7zm-5 0h2v6h-2V7z"/></svg>Twitch</span><span class="twitch-status"><i></i><span>Le rendez-vous live</span></span></div><span class="twitch-eyebrow">Le football se vit ensemble.</span><h2>Le Live<br><em>TomsoFoot.</em></h2><p class="twitch-title">Prochain live à venir</p><div class="twitch-bottom"><a class="twitch-watch" target="_blank" rel="noopener noreferrer">Regarder le live <span aria-hidden="true">↗</span></a><span class="twitch-viewers" hidden></span><span class="twitch-offline-note">Retrouvez-nous sur la chaîne Twitch.</span></div></div>';
  card.querySelector('a').href=link;
  const $=selector=>card.querySelector(selector);
  function render(state) {
    const live=state?.live===true && !state.error, known=typeof state?.live==='boolean' && !state.error;
    card.classList.toggle('is-on-air',live);
    $('.twitch-status span').textContent=live?'EN DIRECT':known?'HORS LIGNE':'LE RENDEZ-VOUS LIVE';
    $('.twitch-title').textContent=live && typeof state.title==='string' && state.title.trim()?state.title:known?'Prochain live à venir':'Retrouvez le direct sur Twitch';
    const viewers=$('.twitch-viewers');viewers.hidden=!(live && Number.isInteger(state.viewers) && state.viewers>=0);
    viewers.textContent=viewers.hidden?'':new Intl.NumberFormat('fr-FR').format(state.viewers)+(state.viewers===1?' spectateur':' spectateurs');
    $('.twitch-offline-note').hidden=live;
    $('.twitch-offline-note').textContent=known?'Retrouvez-nous sur la chaîne Twitch.':'Le statut du direct est momentanément indisponible.';
    const img=$('.twitch-backdrop');let thumbnail=null;
    try{const u=new URL(state.thumbnail);if(u.protocol==='https:' && u.hostname==='static-cdn.jtvnw.net')thumbnail=u.href;}catch{}
    const source=live && thumbnail?thumbnail:'/home/assets/live-background.png';
    if(img.getAttribute('src')!==source){img.onerror=()=>{img.onerror=null;img.src='/home/assets/live-background.png';};img.src=source;}
  }
  // Connexion conservée pour les intégrations existantes et les tests isolés.
  window.TF_HOME_LIVE={setState:render};
  window.addEventListener('tomsofoot:twitch-state',e=>render(e.detail));
  render(null);
  let busy=false;
  async function refresh(){if(busy)return;busy=true;try{const r=await fetch('/.netlify/functions/twitch-live',{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();render(await r.json());}catch{render(null);}finally{busy=false;}}
  refresh();setInterval(()=>{if(!document.hidden)refresh();},60000);
})();
