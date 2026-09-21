(() => {
  'use strict';
  if(!window.TF_CLUB_DATA||!window.TFClubRecognition)return;
  const recognizer=window.TFClubRecognition.createRecognizer(window.TF_CLUB_DATA),root=document.querySelector('#app');
  const pending=new Set();let scheduled=false;
  function articleFor(card){
    let slug='';try{slug=decodeURIComponent(new URL(card.href,location.href).pathname.split('/').filter(Boolean).at(-1));}catch{}
    const article=window.TF_DATA.articles.find(a=>a.slug===slug);
    const record={...(article||{}),title:card.querySelector('h3')?.textContent||article?.title||''};
    if(card.hasAttribute('data-club-ids')){try{record.club_ids=JSON.parse(card.dataset.clubIds);}catch{record.club_badge=false;}}
    return record;
  }
  function render(card){
    if(!card.isConnected)return;
    const host=card.querySelector('.story-image');if(!host)return;
    const result=recognizer.detect(articleFor(card)),key=result.clubs.map(c=>c.id).join('|');
    card.dataset.clubReason=result.reason;
    if(card.dataset.clubMatch===key&&(!key||host.querySelector('.club-ribbon')))return;
    host.querySelector('.club-ribbon')?.remove();card.dataset.clubMatch=key;card.classList.toggle('club-aware',!!key);
    if(!key){card.style.removeProperty('--club-color');card.style.removeProperty('--club-ink');return;}
    const clubs=result.clubs.slice(0,2),ribbon=document.createElement('span');ribbon.className='club-ribbon';ribbon.dataset.count=String(clubs.length);ribbon.setAttribute('aria-hidden','true');
    card.style.setProperty('--club-color',clubs[0].color);card.style.setProperty('--club-ink',clubs[0].foreground);
    ribbon.title=result.clubs.map(c=>c.name).join(' · ');
    let failed=false;
    for(const club of clubs){
      const item=document.createElement('span');item.className='club-ribbon-item';item.style.setProperty('--club-color',club.color);item.style.setProperty('--club-ink',club.foreground);
      const logo=document.createElement('span');logo.className='club-ribbon-logo';const image=document.createElement('img');image.src=club.logo;image.alt='';image.decoding='async';image.draggable=false;
      image.addEventListener('error',()=>{if(failed)return;failed=true;ribbon.remove();card.classList.remove('club-aware');card.dataset.clubReason='logo-unavailable';},{once:true});
      const label=document.createElement('span');label.className='club-ribbon-name';label.textContent=club.name;logo.append(image);item.append(logo,label);ribbon.append(item);
    }
    if(result.clubs.length>2){const more=document.createElement('span');more.className='club-ribbon-more';more.textContent='+'+(result.clubs.length-2);ribbon.append(more);}
    host.append(ribbon);
  }
  function queue(card){if(!card)return;pending.add(card);if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;pending.forEach(render);pending.clear();});}
  function collect(node){if(node.nodeType!==1||node.closest('.club-ribbon'))return;if(node.matches('.story'))queue(node);node.querySelectorAll('.story').forEach(queue);}
  root.querySelectorAll('.story').forEach(render);
  new MutationObserver(records=>{
    for(const record of records){
      const target=record.target.nodeType===1?record.target:record.target.parentElement;
      if(target?.closest('.club-ribbon,.optical-panels,.hover-decoration'))continue;
      if(record.type==='attributes'||record.type==='characterData'||target?.closest('.story-copy'))queue(target?.closest('.story'));
      record.addedNodes.forEach(collect);
    }
  }).observe(root,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['href','data-club-ids']});
  window.TFClubBadges={recognizer,refresh(){root.querySelectorAll('.story').forEach(render);}};
  window.TF_CLUB_BADGES_READY=true;
})();
