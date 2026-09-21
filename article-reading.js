/* Lecture libre : seuil mesuré sur la hauteur réelle du corps, hors titre/photo/pied de page. */
(async () => {
  'use strict';
  const article=document.querySelector('.a-article[data-article-id]'), body=article?.querySelector('.a-body');
  if(!article || !body || article.dataset.privatePreview==='true')return;
  const id=article.dataset.articleId, endpoint='/.netlify/functions/article-views';
  const views=document.createElement('p');views.className='article-view-count';views.hidden=true;
  article.querySelector('.a-byline')?.after(views);
  let state=null, expanded=false, busy=false, ready=null;
  function showCount(data) {
    state=data;views.hidden=false;
    views.textContent=new Intl.NumberFormat('fr-FR').format(data.count)+' '+(data.count===1?'lecture':'lectures')+(data.preview?' · aperçu local':'');
    views.title='Lecteurs ayant cliqué sur « Voir plus ». Une seule lecture par article et par session de 24 h.';
  }
  async function request(method='GET',renewed=false) {
    const response=await fetch(endpoint+(method==='GET'?'?article_id='+encodeURIComponent(id):''),{
      method, credentials:'same-origin', headers:method==='POST'?{'Content-Type':'application/json'}:{},
      body:method==='POST'?JSON.stringify({article_id:id}):undefined, signal:AbortSignal.timeout(8000)
    });
    if(response.status===401 && method==='POST' && !renewed){await request();return request('POST',true);}
    if(!response.ok)throw Error('counter_unavailable');
    const data=await response.json();showCount(data);return data;
  }
  ready=(navigator.locks?navigator.locks.request('tf-article-session',()=>request()):request()).catch(()=>null); // L'ouverture lit seulement le compteur, elle ne l'incrémente pas.
  const gate=document.createElement('div');gate.className='reading-gate';gate.id='reading-gate';
  gate.innerHTML='<span class="reading-eyebrow">Vous êtes dans le match.</span><h2>La suite de l’analyse vous attend.</h2><p>Poursuivez votre lecture, librement.</p><button type="button" class="reading-more" aria-expanded="false" aria-controls="article-full-content">Voir plus <span aria-hidden="true">↓</span></button>';
  const status=document.createElement('p');status.className='reading-status';status.setAttribute('role','status');status.hidden=true;
  body.id='article-full-content';
  let originalNodes=null, originalText='', observer=null;
  // Couper à une fin de mot proche des 20 %, sans laisser une moitié de ligne visible.
  function applyPreview() {
    if(expanded)return;
    if(originalNodes)body.replaceChildren(...originalNodes);
    else {originalNodes=Array.from(body.childNodes);originalText=body.textContent;}
    const rect=body.getBoundingClientRect(), target=rect.top+rect.height*.2;
    article.dataset.readingFullHeight=String(Math.round(rect.height));
    const walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT), range=document.createRange();
    let node, cut=null;
    while((node=walker.nextNode())) {
      if(!node.textContent.trim())continue;
      range.selectNodeContents(node);
      const box=range.getBoundingClientRect();
      if(!box.height)continue;
      if(box.bottom<=target){cut={node,offset:node.length};continue;}
      if(box.top>target)break;
      let lo=0,hi=node.length;
      while(lo<hi){const mid=Math.ceil((lo+hi)/2);range.setStart(node,0);range.setEnd(node,mid);if(range.getBoundingClientRect().bottom<=target)lo=mid;else hi=mid-1;}
      if(lo>0){while(lo>0 && !/\s/.test(node.textContent[lo-1]))lo--;if(lo)cut={node,offset:lo};}
      break;
    }
    // Articles composés uniquement d'images : garder les blocs complets avant le seuil.
    range.selectNodeContents(body);
    if(cut)range.setEnd(cut.node,cut.offset);
    else {const first=body.firstElementChild; if(!first)return;range.setEndAfter(first);}
    const preview=range.cloneContents();
    // Les nœuds complets restent détachés : la suite est absente du focus et de l'arbre accessible.
    body.replaceChildren(preview);
    article.dataset.readingPreviewHeight=String(Math.round(body.getBoundingClientRect().height));
    body.after(gate,status);
    gate.classList.remove('is-reached');
    observer?.disconnect();
    observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){gate.classList.add('is-reached');observer.disconnect();}},{threshold:0});
    observer.observe(gate);
  }
  article.classList.add('reading-initial');
  try {
    await Promise.race([Promise.all([document.fonts.ready,...Array.from(body.querySelectorAll('img')).map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true});}))]),new Promise(resolve=>setTimeout(resolve,2200))]);
    article.classList.remove('reading-initial');applyPreview();
  } catch {article.classList.remove('reading-initial');if(originalNodes)body.replaceChildren(...originalNodes);return;}
  let resizeTimer, width=body.clientWidth;
  new ResizeObserver(()=>{if(!expanded && body.clientWidth!==width){width=body.clientWidth;clearTimeout(resizeTimer);resizeTimer=setTimeout(applyPreview,120);}}).observe(body);
  async function countClick() {
    if(busy)return;busy=true;
    try {
      await ready;
      if(!state)await request();
      // Le serveur reste l'autorité : le marqueur local n'est jamais utilisé comme preuve.
      if(!state.counted)await request('POST');
      try{localStorage.setItem('tf:read:'+state.sessionTag+':'+id,'1');}catch{}
      status.hidden=true;
    }catch{
      status.hidden=false;status.replaceChildren(document.createTextNode('La suite est ouverte. Le compteur est momentanément indisponible. '));
      const retry=document.createElement('button');retry.type='button';retry.textContent='Réessayer le comptage';retry.addEventListener('click',countClick);status.append(retry);
    }finally{busy=false;}
  }
  gate.querySelector('button').addEventListener('click',()=>{
    if(expanded)return;expanded=true;
    const y=window.scrollY;
    observer?.disconnect();body.replaceChildren(...originalNodes);
    article.dataset.readingExpanded='true';
    if(body.textContent!==originalText)console.warn('Le texte de l’article a changé pendant la lecture.');
    gate.querySelector('button').setAttribute('aria-expanded','true');gate.hidden=true;
    // Garder la position de lecture et annoncer la révélation aux lecteurs d'écran.
    body.setAttribute('tabindex','-1');body.focus({preventScroll:true});window.scrollTo({top:y,behavior:'instant'});
    countClick();
  });
})();
