(()=>{
  'use strict';
  const core=window.TFStandingsCore,zoneConfig=window.TFStandingsZones;
  if(document.body.dataset.style!=='club'||!core||document.querySelector('#classements'))return;
  const leagues=core.leagues,count=leagues.length,totalLabel=String(count).padStart(2,'0'),season=core.seasonYear(),seasonLabel=`${season}–${season+1}`;
  const states=leagues.map(()=>({data:null,error:false,loading:true}));
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),small=matchMedia('(max-width: 760px)');
  let index=0,paused=false,visible=false,hovered=false,lastRotation=Date.now(),inFlight=false,opened=-1,launcher=null,oldOverflow='',openingTimer;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Badges fournis : fond marine pour le logo blanc de la Ligue 1.
  function leagueBadge(l){const src=window.TF_LEAGUE_BADGES?.[l.id];return src?`<span class="league-badge ${l.id==='fra.1'?'league-badge--white':''}" aria-hidden="true"><img src="${escape(src)}" alt=""></span>`:'';}
  function nationBadge(l){return l.folder?`<span class="nation-badge" aria-hidden="true"><img src="/home/assets/national-teams/${l.folder}.png" alt=""></span>`:leagueBadge(l);}
  const section=document.createElement('section');
  section.id='classements';section.className='section shell standings-section';
  section.setAttribute('aria-labelledby','standings-title');
  section.innerHTML=`
    <div class="section-head standings-heading"><div><span class="kicker">La course au sommet</span><h2 id="standings-title">Les classements.<br>Toutes les places comptent.</h2></div><p class="standings-intro">Les cinq grands championnats et la Ligue des champions.<br> Sélectionnez une carte pour voir grand.</p></div>
    <div class="standings-toolbar"><nav class="standings-leagues" aria-label="Choisir un championnat">${leagues.map((l,i)=>`<button type="button" data-league="${i}" aria-current="${i===0?'true':'false'}" style="--league:${l.color}">${nationBadge(l)}${l.short}</button>`).join('')}</nav><span class="standings-season">Saison ${seasonLabel}</span></div>
    <div class="standings-carousel" role="region" aria-roledescription="carrousel" aria-label="Classements complets des cinq grands championnats et de la Ligue des champions"><div class="standings-stage">${leagues.map((l,i)=>`
      <article class="standing-card" data-card="${i}" style="--league:${l.color};--league-light:${l.light}" aria-label="${escape(l.name)}" aria-roledescription="diapositive">
        <header class="standing-card-head"><div class="standing-country">${nationBadge(l)}${l.country}<small>${String(i+1).padStart(2,'0')} / ${totalLabel}</small></div><h3 class="league-title">${leagueBadge(l)}<span>${escape(l.name)}</span></h3><div class="standing-card-meta"><span>${l.teams} clubs</span><span>${seasonLabel}</span><span>Tableau défilant ↓</span></div></header>
        <div class="standing-table-slot" aria-busy="true" tabindex="0" role="region" aria-label="Classement de ${escape(l.name)}, tableau défilant"><p class="standing-empty">Chargement du classement…</p></div>
        <div class="standing-card-legend"></div>
        <footer class="standing-card-foot"><span class="standing-status">Connexion au classement…</span><span class="standing-expand" aria-hidden="true">↗</span></footer>
        <button type="button" class="standing-open" aria-label="Agrandir le classement complet : ${escape(l.name)}" aria-haspopup="dialog" aria-controls="standings-dialog" disabled></button>
      </article>`).join('')}</div></div>
    <div class="standings-navigation"><div class="standings-arrows"><button type="button" data-standings-prev aria-label="Compétition précédente">←</button><span class="standings-position" aria-live="polite">01 <span>/ ${totalLabel}</span></span><button type="button" data-standings-next aria-label="Compétition suivante">→</button></div><p class="standings-gesture">Un clic pour déplier le classement <span aria-hidden="true">↗</span></p><button type="button" class="standings-pause" aria-pressed="false">Ⅱ <span>Pause du carrousel</span></button></div>
    <div class="standings-source"><p><span class="standings-feed-state" role="status">Connexion aux classements…</span><span>Source : <a href="https://www.espn.com/soccer/standings/_/league/fra.1" target="_blank" rel="noopener noreferrer">ESPN ↗</a></span></p><p>Vérification toutes les 30 s lorsque ce module est visible. Les changements apparaissent dès leur publication par la source.</p><button type="button" class="standings-retry">Actualiser</button></div>`;
  document.querySelector('#match-center').insertAdjacentElement('afterend',section);
  const cards=[...section.querySelectorAll('.standing-card')],stage=section.querySelector('.standings-stage'),nav=[...section.querySelectorAll('[data-league]')];
  const dialog=document.createElement('dialog');dialog.id='standings-dialog';dialog.className='standings-dialog';
  dialog.setAttribute('aria-labelledby','standings-dialog-title');
  dialog.innerHTML=`<button type="button" class="standings-close" aria-label="Fermer le classement" autofocus>×</button><div class="standings-flipper"><div class="standings-face standings-front"><header class="standings-modal-head"><span class="standings-modal-kicker"></span><h2 id="standings-dialog-title"></h2><div><span class="standings-modal-season"></span><span class="standings-modal-status" role="status"></span></div></header><div class="standings-modal-scroll" tabindex="0" role="region" aria-label="Classement complet, tableau défilant"></div><footer class="standings-modal-foot"><p><span class="standings-scroll-hint">Glissez ← → pour parcourir les statistiques.</span><b>J</b> Joués · <b>G</b> Gagnés · <b>N</b> Nuls · <b>P</b> Perdus<br><b>BP / BC</b> Buts pour / contre · <b>Diff</b> Différence · <b>Pts</b> Points</p><a class="standings-modal-source" target="_blank" rel="noopener noreferrer">Source : ESPN ↗</a></footer></div><div class="standings-face standings-back" aria-hidden="true"><div class="standings-pitch"></div><span class="standings-back-brand">TOMSOFOOT <i>CLASSEMENTS</i></span><div class="standings-back-copy"><span class="standings-back-country"></span><strong class="standings-back-title"></strong><span class="standings-back-season"></span></div><span class="standings-back-caption">LE FOOTBALL, NOTRE PASSION.</span></div></div>`;
  document.body.append(dialog);
  const flipper=dialog.querySelector('.standings-flipper'),modalScroll=dialog.querySelector('.standings-modal-scroll');
  const modalLegend=document.createElement('div');modalLegend.className='standings-modal-legend';modalScroll.after(modalLegend);
  function sourceLink(i){return `https://www.espn.com/soccer/standings/_/league/${leagues[i].id}`;}
  function clockStamp(iso,full=false){return new Intl.DateTimeFormat('fr-FR',{...(full?{day:'2-digit',month:'2-digit',year:'numeric'}:{}),hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(iso));}
  function status(i){const s=states[i];return !s.data?(s.error?'Classement indisponible':'Chargement…'):s.error?`Dernier relevé : ${clockStamp(s.data.fetchedAt,true)}`:`Relevé à ${clockStamp(s.data.fetchedAt)}`;}
  function clubInfo(row){return window.TF_STANDINGS_LOGOS?.[row.id]||{name:row.name,logo:/^https:\/\/a\.espncdn\.com\//.test(row.logo)?row.logo:''};}
  function legend(data){
    const rule=zoneConfig.rulesFor(data.league,data.season);
    const entries=rule?.clubs===data.rows.length?zoneConfig.legend(data.league,data.season):[];
    if(!entries.length)return '';
    const range=([first,last])=>first===last?String(first):`${first}–${last}`;
    return `<div class="standing-legend" aria-label="Légende des zones"><p class="standing-legend-title">Légende des zones</p><ul>${entries.map(zone=>`<li style="--zone:${zone.color}"><span class="standing-zone-key" data-pattern="${zone.pattern || ''}" aria-hidden="true">${zone.symbol}</span><span><b>${range(zone.range)}</b> ${escape(zone.label)}</span></li>`).join('')}</ul><p class="standing-zone-note">${data.league==='uefa.champions'?'Zones de la phase de ligue.':'Zones indicatives · places européennes ajustables selon les coupes et les places supplémentaires.'}</p></div>`;
  }
  function renderTable(container,data,full=false,animate=true){
    const league=leagues.find(l=>l.id===data.league);
    return window.TFStandingsTable.render(container,zoneConfig.decorate(data),{full,clubInfo,zones:core.zones,
      caption:`Classement complet ${league.name}, saison ${seasonLabel}`,animate,reduced:reduced.matches});
  }
  // A missing crest must never break a row or hide the club's name.
  for(const parent of [section,dialog])parent.addEventListener('error',e=>{if(e.target.tagName==='IMG')e.target.hidden=true;},true);
  function drawData(i,previous=null){
    const s=states[i],card=cards[i],slot=card.querySelector('.standing-table-slot');
    if(s.data){const top=slot.scrollTop;renderTable(slot,s.data,false,Boolean(previous));slot.scrollTop=top;card.querySelector('.standing-card-legend').innerHTML=legend(s.data);}
    else slot.innerHTML='<p class="standing-empty">Le classement est momentanément indisponible.<br><span>Réessayez avec le bouton Actualiser.</span></p>';
    slot.setAttribute('aria-busy','false');card.querySelector('.standing-open').disabled=!s.data;
    card.classList.toggle('standing-stale',s.error);
    card.querySelector('.standing-status').textContent=status(i);
    card.querySelector('.standing-status').title=s.error?'Actualisation interrompue. Ce relevé conservé peut avoir changé.':'Heure de vérification auprès de la source.';
    if(opened===i){const top=modalScroll.scrollTop,left=modalScroll.scrollLeft;renderTable(modalScroll,s.data,true,Boolean(previous)&&!dialog.classList.contains('is-opening'));modalLegend.innerHTML=legend(s.data);modalScroll.scrollTop=top;modalScroll.scrollLeft=left;dialog.querySelector('.standings-modal-status').textContent=(s.error?'Actualisation interrompue · ':'')+status(i);}
    const failed=states.filter(s=>s.error).length,ready=states.filter(s=>s.data&&!s.error).length;
    const label=section.querySelector('.standings-feed-state');
    label.classList.toggle('has-error',failed>0);
    label.textContent=failed?`Actualisation interrompue pour ${failed} compétition${failed>1?'s':''} · relevés conservés quand disponibles`:(ready===count?'Actualisation automatique':'Chargement des classements…');
  }
  async function fallback(i){
    const league=leagues[i];
    try{const cached=JSON.parse(localStorage.getItem('tf-standings-'+league.id));if(core.isSnapshot(cached,league,season))return cached;}catch{}
    return null;
  }
  async function refresh(){
    if(inFlight)return;inFlight=true;section.querySelector('.standings-retry').disabled=true;
    await Promise.allSettled(leagues.map(async(league,i)=>{
      const previous=states[i].data;
      try{
        const endpoint=window.TF_STANDINGS_CONFIG?.endpoint;
        const url=endpoint?`${endpoint}?league=${league.id}&season=${season}`:core.sourceUrl(league.id,season);
        const response=await fetch(url,{signal:AbortSignal.timeout(14000),cache:'no-store'});
        if(!response.ok)throw Error('Classement indisponible');
        const raw=await response.json(),data=endpoint?raw:core.normalize(raw,league,season);
        if(!core.isSnapshot(data,league,season)||Date.now()-Date.parse(data.fetchedAt)>120000)throw Error('Relevé trop ancien ou incomplet');
        states[i]={data,error:false,loading:false};
        try{localStorage.setItem('tf-standings-'+league.id,JSON.stringify(data));}catch{}
      }catch{states[i]={data:previous||await fallback(i),error:true,loading:false};}
      drawData(i,previous);
    }));
    inFlight=false;section.querySelector('.standings-retry').disabled=false;
  }
  function position(){
    const stageWidth=stage.clientWidth,baseWidth=small.matches?stageWidth:innerWidth<1100?(stageWidth-30)/2.15:(stageWidth-48)/3,half=Math.floor(count/2);
    cards.forEach((card,i)=>{
      const offset=((i-index+count+half)%count)-half,shown=small.matches?offset===0:Math.abs(offset)<=1;
      const width=Math.round(baseWidth*(offset===0?1:.94));
      // Integer layout sizes keep text and crests sharp after the transition.
      card.style.width=width+'px';card.style.left=Math.round(stageWidth/2+offset*(baseWidth+24)-width/2)+'px';card.style.zIndex=offset===0?'3':'2';
      card.classList.toggle('is-active',offset===0);card.classList.toggle('is-outside',!shown);card.inert=!shown;card.setAttribute('aria-hidden',String(!shown));
    });
    nav.forEach((b,i)=>b.setAttribute('aria-current',String(i===index)));
    section.querySelector('.standings-position').innerHTML=`${String(index+1).padStart(2,'0')} <span>/ ${totalLabel}</span>`;
    section.querySelector('.standings-source a').href=sourceLink(index);
  }
  function select(i){window.TFStandingsTable.finishAll();index=(i+count)%count;lastRotation=Date.now();position();}
  const pauseButton=section.querySelector('.standings-pause');
  function drawPause(){const stopped=paused||reduced.matches;pauseButton.setAttribute('aria-pressed',String(stopped));pauseButton.innerHTML=`${stopped?'▷':'Ⅱ'} <span>${reduced.matches?'Animation réduite':paused?'Reprendre le carrousel':'Pause du carrousel'}</span>`;pauseButton.disabled=reduced.matches;}
  pauseButton.addEventListener('click',()=>{paused=!paused;lastRotation=Date.now();drawPause();});
  section.querySelector('[data-standings-prev]').addEventListener('click',()=>select(index-1));
  section.querySelector('[data-standings-next]').addEventListener('click',()=>select(index+1));
  nav.forEach((button,i)=>{
    button.addEventListener('click',()=>select(i));
    button.addEventListener('keydown',e=>{let next;if(e.key==='ArrowRight')next=(i+1)%count;else if(e.key==='ArrowLeft')next=(i+count-1)%count;else if(e.key==='Home')next=0;else if(e.key==='End')next=count-1;else return;e.preventDefault();select(next);nav[next].focus({preventScroll:true});});
  });
  section.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')hovered=true;});
  section.addEventListener('pointerleave',()=>{hovered=false;lastRotation=Date.now();});
  let touchStart=null,suppressClickUntil=0;
  stage.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')touchStart={x:e.clientX,y:e.clientY};});
  stage.addEventListener('pointercancel',()=>{touchStart=null;});
  stage.addEventListener('pointerup',e=>{if(!touchStart)return;const dx=e.clientX-touchStart.x,dy=e.clientY-touchStart.y;touchStart=null;if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.5){suppressClickUntil=Date.now()+450;select(index+(dx<0?1:-1));}});
  function open(i,button){
    if(dialog.open||!states[i].data||Date.now()<suppressClickUntil)return;
    opened=i;launcher=button;const league=leagues[i],data=states[i].data,origin=cards[i].getBoundingClientRect();
    dialog.style.setProperty('--league',league.color);dialog.style.setProperty('--league-light',league.light);
    dialog.querySelector('.standings-modal-kicker').innerHTML=nationBadge(league)+'<span class=standings-country-copy><b>'+escape(league.country)+'</b><small>Classement complet</small></span>';
    dialog.querySelector('#standings-dialog-title').innerHTML=leagueBadge(league)+'<span>'+escape(league.name)+'</span>';
    dialog.querySelector('.standings-modal-season').textContent='Saison '+seasonLabel+' · '+data.rows.length+' clubs · Tableau défilant ↓';
    dialog.querySelector('.standings-modal-status').textContent=(states[i].error?'Actualisation interrompue · ':'')+status(i);
    dialog.querySelector('.standings-modal-source').href=sourceLink(i);
    dialog.querySelector('.standings-back-country').innerHTML=nationBadge(league)+'<span>'+escape(league.country)+'</span>';
    dialog.querySelector('.standings-back-title').textContent=league.name;
    dialog.querySelector('.standings-back-season').textContent='SAISON '+seasonLabel;
    renderTable(modalScroll,data,true,false);modalLegend.innerHTML=legend(data);modalScroll.scrollTop=0;modalScroll.scrollLeft=0;
    oldOverflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.showModal();
    const dest=dialog.getBoundingClientRect();
    dialog.style.setProperty('--from-x',`${origin.x+origin.width/2-dest.x-dest.width/2}px`);
    dialog.style.setProperty('--from-y',`${origin.y+origin.height/2-dest.y-dest.height/2}px`);
    dialog.style.setProperty('--from-scale',Math.min(.92,origin.width/dest.width));
    if(!reduced.matches){dialog.classList.add('is-opening');openingTimer=setTimeout(finishOpening,1600);}
    dialog.querySelector('.standings-close').focus({preventScroll:true});
  }
  function finishOpening(){clearTimeout(openingTimer);dialog.classList.remove('is-opening');}
  flipper.addEventListener('animationend',e=>{if(e.animationName==='standings-unfold')finishOpening();});
  function cleanupDialog(){if(opened<0)return;window.TFStandingsTable.finishAll();finishOpening();opened=-1;document.body.style.overflow=oldOverflow;lastRotation=Date.now();launcher?.focus({preventScroll:true});}
  function close(){if(!dialog.open)return;finishOpening();dialog.close();cleanupDialog();}
  dialog.addEventListener('close',()=>{if(!dialog.open)cleanupDialog();});
  dialog.querySelector('.standings-close').addEventListener('click',close);
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  dialog.addEventListener('keydown',e=>{
    if(e.key!=='Tab')return;
    const stops=[...dialog.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]')],first=stops[0],last=stops[stops.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  });
  dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const b=dialog.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)close();});
  cards.forEach((card,i)=>{
    card.querySelector('.standing-open').addEventListener('click',e=>open(i,e.currentTarget));
    card.addEventListener('click',e=>{if(e.target.closest('button,a')||window.getSelection()?.toString())return;open(i,card.querySelector('.standing-open'));});
  });
  section.querySelector('.standings-retry').addEventListener('click',refresh);
  new IntersectionObserver(entries=>{const previous=visible;visible=entries[0].isIntersecting;if(visible&&!previous){lastRotation=Date.now();if(states.some(s=>!s.data||s.error||Date.now()-Date.parse(s.data.fetchedAt)>30000))refresh();}},{threshold:.05}).observe(section);
  setInterval(()=>{if((visible||dialog.open)&&!document.hidden)refresh();},30000);
  setInterval(()=>{if(Date.now()-lastRotation<8000)return;if(!visible||document.hidden||hovered||opened>=0||paused||reduced.matches||section.contains(document.activeElement)){lastRotation=Date.now();return;}select(index+1);},500);
  document.addEventListener('visibilitychange',()=>{lastRotation=Date.now();if(!document.hidden&&(visible||dialog.open))refresh();});
  window.addEventListener('online',()=>{if(visible||dialog.open)refresh();});
  small.addEventListener('change',()=>{const focused=cards.findIndex(c=>c.contains(document.activeElement));if(small.matches&&focused>=0)index=focused;position();});
  new ResizeObserver(position).observe(stage);
  reduced.addEventListener('change',()=>{drawPause();if(reduced.matches){finishOpening();window.TFStandingsTable.finishAll();}});
  position();drawPause();refresh();
})();
