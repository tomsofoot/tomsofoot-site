(()=>{
  'use strict';
  const core=window.TFMatchDetailsCore,cards=window.TF_MATCH_CARDS;
  if(document.body.dataset.style!=='club'||!core||!cards)return;
  const recognizer=window.TFClubRecognition.createRecognizer(window.TF_CLUB_DATA),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const imageUrl=s=>/^(assets\/[a-zA-Z0-9_./-]+|https:\/\/(?:a[0-9]*\.espncdn\.com|media\.api-sports\.io)\/[^\s"<>]+)$/.test(s||'')?s:'';
  const crest=(team,cls='')=>imageUrl(team.logo)?`<img class="${cls}" src="${escape(imageUrl(team.logo))}" alt="" loading="eager">`:'';
  const dateText=(d,options)=>new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',...options}).format(new Date(d));
  const kickoff=d=>dateText(d,{hour:'2-digit',minute:'2-digit'}),calendar=d=>dateText(d,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const identities=new Map(cards.matches.map(m=>[String(m.id),core.identify(m)]));
  const cache=new Map();let visible=false,boardBusy=false,boardChecked=0,current=null,animation=null,closing=false,overflow='',generation=0;
  const stage=document.querySelector('#mc-stage'),section=document.querySelector('#match-center');
  const note=document.createElement('p');note.className='match-feed-note';note.textContent='Ouvrez une carte pour consulter le stade, la diffusion et le fil du match.';section.append(note);
  const modal=document.createElement('dialog');modal.id='match-detail-dialog';modal.setAttribute('aria-labelledby','match-detail-title');
  modal.innerHTML=`<button type="button" class="match-detail-close" aria-label="Fermer la fiche du match">Fermer <span aria-hidden="true">×</span></button><div class="match-detail-flipper"><div class="match-detail-front"><div class="match-detail-topline"></div><div class="match-detail-scroll" tabindex="0" role="region" aria-label="Informations et événements du match"><div class="match-scoreboard"></div><div class="match-detail-body"><dl class="match-info-grid"></dl><div class="match-timeline-head"><h2>Le fil du match</h2><span>Les moments qui comptent<br>Du coup d’envoi au coup de sifflet</span></div><div class="match-timeline"></div></div></div><div class="match-detail-footer"><p class="match-detail-freshness"></p><button type="button" class="match-detail-retry">Actualiser ↻</button></div></div><div class="match-detail-back" aria-hidden="true"></div></div><p class="match-detail-notice" role="status" aria-live="polite"></p>`;
  document.body.append(modal);
  const $=s=>modal.querySelector(s),flipper=$('.match-detail-flipper'),closeButton=$('.match-detail-close'),retry=$('.match-detail-retry');
  async function json(url,signal){const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,12000);try{const r=await fetch(url,{signal:controller.signal,cache:'no-store'});const data=await r.json().catch(()=>({error:'unavailable'}));if(!r.ok){const error=Error('Source indisponible');error.code=data.error;throw error;}return data;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}}
  function localLogos(data){if(data.source==='ESPN')return data;for(const team of [data.home,data.away]){const clubs=recognizer.scan(team.name);if(clubs.length===1)team.logo=clubs[0].logo;}return data;}
  function updateCard(m,d){m.gh=d.homeScore;m.ga=d.awayScore;m.status=d.status.code;m.detailStatus=d.status.label;m.detailClock=d.status.clock;m.time=m.timeKnown===false?'Horaire à confirmer':kickoff(d.date);if(imageUrl(d.home.logo))m.homeLogo=d.home.logo;if(imageUrl(d.away.logo))m.awayLogo=d.away.logo;}
  function known(m){return{date:m.ts,league:m.league,home:{id:identities.get(String(m.id))?.home,name:m.home,logo:m.homeLogo},away:{id:identities.get(String(m.id))?.away,name:m.away,logo:m.awayLogo},status:core.matchStatus({short:m.status,elapsed:m.elapsed}),homeScore:m.gh,awayScore:m.ga,source:m.provider==='espn'?'ESPN':'API-Football',venue:m.venue||'',city:m.city||'',referee:'',broadcasts:[],events:[],eventsAvailable:false};}
  function eventSymbol(kind){if(['goal','shootout'].includes(kind))return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="10"/><path d="m12 6 5 4-2 6H9l-2-6 5-4Zm0-4v4M2.5 9l4.5 1m-1 10 3-4m9 4-3-4m6.5-7L17 10"/></svg>';return kind==='substitution'?'⇄':kind==='var'?'VAR':kind==='penalty-missed'?'×':'';}
  function eventsHtml(d){
    if(!d.events.length){const pre=d.status.state==='pre';return `<div class="match-events-empty"><span aria-hidden="true">${pre?'◷':'≡'}</span><p><strong>${pre?'Le match n’a pas encore commencé.':d.eventsAvailable?'Aucun événement communiqué.':'Le fil du match n’est pas encore disponible.'}</strong>${pre?'Les événements disponibles auprès de la source apparaîtront ici avec les noms des joueurs et les minutes.':'Les événements s’affichent dès leur publication par la source.'}</p></div>`;}
    return `<ol class="match-events" aria-label="Événements du match, dans l’ordre chronologique">${d.events.map(e=>{const team=e.team===d.home.id?d.home:e.team===d.away.id?d.away:null;const players=e.kind==='substitution'?`<span class="in">↗ ${escape(e.players[0]||'Joueur non renseigné')} <span>(entre)</span></span><span class="out">↙ ${escape(e.players[1]||'Joueur non renseigné')} (sort)</span>`:escape(e.players[0]||'Joueur non renseigné');return `<li class="match-event" data-event-id="${escape(e.id)}" data-kind="${escape(e.kind)}"><time>${escape(e.minute)}</time><span class="match-event-symbol" data-kind="${escape(e.kind)}" aria-hidden="true">${eventSymbol(e.kind)}</span><div><span class="match-event-label">${escape(e.label)}${team?' · '+escape(team.name):''}</span><div class="match-event-player">${players}</div></div><span class="match-event-club" aria-hidden="true">${team?crest(team):''}</span></li>`;}).join('')}</ol>`;
  }
  function render(){
    if(!current)return;const restoreSourceFocus=document.activeElement?.classList.contains('match-source-link');const d=current.data||known(current.match),score=d.status.state==='pre'?(current.match.timeKnown===false?'À confirmer':kickoff(d.date)):d.homeScore!=null&&d.awayScore!=null?`${d.homeScore} – ${d.awayScore}`:'—';
    $('.match-detail-topline').innerHTML=`<strong>${escape(current.match.league)}</strong><span class="match-detail-state" data-state="${escape(d.status.state)}">${escape(d.status.label)}</span>`;
    $('.match-scoreboard').innerHTML=`<p class="match-detail-date">${escape(calendar(d.date))}${current.match.timeKnown===false?'':' · '+escape(kickoff(d.date))} <span>(heure de Paris)</span></p><div class="match-score-grid" id="match-detail-title" aria-label="${escape(d.home.name+' – '+d.away.name)}"><div class="match-detail-team">${crest(d.home)}<strong>${escape(d.home.name)}</strong></div><div class="match-detail-score"><span>${d.status.state==='pre'?'Coup d’envoi':escape(d.status.label)}</span><b>${escape(score)}</b>${d.status.clock?`<small>${escape(d.status.clock)}</small>`:''}</div><div class="match-detail-team">${crest(d.away)}<strong>${escape(d.away.name)}</strong></div></div>`;
    const info=window.TFMatchInfo.fields(d),infoGrid=$('.match-info-grid');
    infoGrid.hidden=info.length===0;
    infoGrid.innerHTML=info.map(field=>`<div><dt>${escape(field.label)}</dt><dd>${escape(field.value)}${field.detail?`<small>${escape(field.detail)}</small>`:''}</dd></div>`).join('');
    const timeline=eventsHtml(d);if($('.match-timeline').innerHTML!==timeline)$('.match-timeline').innerHTML=timeline;
    const fresh=$('.match-detail-freshness');fresh.classList.toggle('is-stale',current.error||!current.fresh);
    const stamp=d.fetchedAt?dateText(d.fetchedAt,{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'';
    fresh.innerHTML=current.error?(stamp?`Actualisation interrompue · dernier relevé ${escape(stamp)}`:current.errorCode==='no_key'?'Connexion API-Football en attente dans cet aperçu.':current.errorCode==='not_found'?'La fiche n’est pas encore disponible auprès du fournisseur.':'Les informations détaillées sont momentanément indisponibles.'):(current.loading?'Actualisation de la fiche…':stamp?`${current.fresh?'Relevé':'Dernier relevé'} du ${escape(stamp)}`:'Connexion à la fiche du match…');
    fresh.innerHTML+=`<small><a class="match-source-link" href="${d.source==='ESPN'?'https://www.espn.com/soccer/match/_/gameId/'+identities.get(current.id).event:'https://www.api-football.com/'}" target="_blank" rel="noopener noreferrer">Source : ${d.source==='ESPN'?'ESPN':'API-Football'} ↗</a>${d.ref?' · Actualisation automatique, selon le délai de la source.':''}</small>`;
    retry.disabled=!!current.loading;
    if(restoreSourceFocus)$('.match-source-link')?.focus({preventScroll:true});
  }
  function back(d){$('.match-detail-back').innerHTML=`<span class="match-back-brand">TomsoFoot</span><div class="match-back-logos">${crest(d.home)}<b>VS</b>${crest(d.away)}</div><p class="match-back-title">${escape(d.home.name)}<br>${escape(d.away.name)}</p><span class="match-back-league">${escape(current.match.league)}</span>`;}
  async function refresh(){
    if(!current||closing||current.loading||document.hidden)return;const session=current,token=generation;session.loading=true;session.lastAttempt=Date.now();session.controller=new AbortController();render();
    try{const identity=identities.get(session.id);if(!identity)throw Error('Identifiant du match indisponible');const result=await json(core.summaryUrl(identity),session.controller.signal);if(!core.valid(result.data,identity))throw Error('Fiche non conforme');const data=localLogos(result.data);if(token!==generation||current!==session||closing)return;
      const before=session.data;session.data=data;session.fresh=!result.stale;session.error=!!result.stale;session.errorCode=result.error;session.refreshAfter=Math.max(data.status.state==='live'?15000:60000,Math.min(3600000,(Number(result.refreshAfter)||60)*1000));cache.set(session.id,data);updateCard(session.match,data);
      if(before&&(before.homeScore!==data.homeScore||before.awayScore!==data.awayScore||before.events.length!==data.events.length))$('.match-detail-notice').textContent='La fiche du match a été actualisée. '+data.status.label+(data.homeScore!=null?' : '+data.homeScore+' à '+data.awayScore:'')+'.';
    }catch(error){if(token===generation&&current===session&&!closing){session.error=true;session.errorCode=error.code;session.refreshAfter=60000;}}finally{if(token===generation&&current===session&&!closing){session.loading=false;render();}}
  }
  function completeClose(){if(!current)return;const id=current.id;current.controller?.abort();generation++;current=null;closing=false;animation?.cancel();animation=null;modal.close();document.body.style.overflow=overflow;cards.setModalOpen(false);cards.render();stage.querySelector(`[data-match-id="${CSS.escape(id)}"] .match-open`)?.focus({preventScroll:true});}
  function close(){if(!current||closing)return;closing=true;generation++;current.controller?.abort();if(reduced.matches||!animation||!animation.currentTime){completeClose();return;}animation.reverse();animation.onfinish=completeClose;}
  async function open(button){
    if(current)return;const id=button.closest('[data-match-id]').dataset.matchId,match=cards.matches.find(m=>String(m.id)===id);if(!match)return;
    const rect=button.closest('.match-card').getBoundingClientRect();cards.setModalOpen(true);current={id,match,data:cache.get(id),fresh:false,error:false,loading:false,lastAttempt:0};generation++;const token=generation;closing=false;overflow=document.body.style.overflow;document.body.style.overflow='hidden';$('.match-detail-notice').textContent='';render();back(current.data||known(match));modal.showModal();$('.match-detail-scroll').scrollTop=0;closeButton.focus({preventScroll:true});
    if(!reduced.matches){const target=flipper.getBoundingClientRect(),dx=rect.x+rect.width/2-target.x-target.width/2,dy=rect.y+rect.height/2-target.y-target.height/2,sx=rect.width/target.width,sy=rect.height/target.height;
      animation=flipper.animate([{transform:`translate(${dx}px,${dy}px) scale(${sx},${sy}) rotateY(0deg)`},{offset:.5,transform:`translate(${dx*.15}px,${dy*.15}px) scale(.85) rotateY(180deg)`},{transform:'translate(0,0) scale(1) rotateY(360deg)'}],{duration:1500,easing:'cubic-bezier(.22,.65,.25,1)',fill:'both'});
    }
    refresh();
  }
  stage.addEventListener('click',e=>{const button=e.target.closest('.match-open');if(button)open(button);});closeButton.addEventListener('click',close);modal.addEventListener('cancel',e=>{e.preventDefault();close();});modal.addEventListener('click',e=>{if(e.target===modal)close();});retry.addEventListener('click',refresh);
  modal.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const items=[...modal.querySelectorAll('button:not(:disabled),a[href],[tabindex="0"]')];const index=items.indexOf(document.activeElement);if(e.shiftKey&&index<=0){e.preventDefault();items.at(-1)?.focus();}else if(!e.shiftKey&&(index<0||index===items.length-1)){e.preventDefault();items[0]?.focus();}});
  reduced.addEventListener('change',()=>{if(reduced.matches&&animation){if(closing)completeClose();else{animation.cancel();animation=null;}}});
  async function refreshCards(){
    if(boardBusy||!visible||document.hidden||current)return;boardBusy=true;boardChecked=Date.now();
    try{const result=await json('/.netlify/functions/matches-with-nations');if(result.error||!Array.isArray(result.matches))throw Error('Flux indisponible');
      const incoming=result.matches;if(incoming.some(m=>!core.identify(m)||!Number.isFinite(Date.parse(m.ts))||typeof m.home!=='string'||typeof m.away!=='string'))throw Error('Liste incomplète');
      if(current)return;const existing=new Map(cards.matches.map(m=>[String(m.id),m]));
      const next=incoming.map(m=>{const ref=core.identify(m);identities.set(String(m.id),ref);const item={...m};const detail=cache.get(String(m.id));if(detail&&core.valid(detail,ref)&&Date.now()-Date.parse(detail.fetchedAt)<60000)updateCard(item,detail);return item;});
      // Keep a finished fixture already read on the current page; the site's feed only lists upcoming matches.
      for(const [id,m] of existing)if(cache.get(id)?.status.state==='post'&&!next.some(n=>String(n.id)===id))next.push(m);
      cards.matches.splice(0,cards.matches.length,...next);cards.setFeedState('ready');cards.render();
      const upcoming=next.find(m=>Date.parse(m.ts)>=Date.now()),ticker=document.getElementById('next-match');
      if(ticker)ticker.textContent=upcoming?'À suivre · '+upcoming.home+' – '+upcoming.away+(upcoming.time?' · '+upcoming.time:''):'';note.textContent=result.sourceNote||'Sources : TomsoFoot et ESPN. Ouvrez une carte pour consulter les détails.';
    }catch{cards.setFeedState('error');cards.render();note.textContent=cards.matches.length?'Flux TomsoFoot momentanément indisponible · derniers renseignements conservés.':'Flux TomsoFoot momentanément indisponible.';}finally{boardBusy=false;}
  }
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible&&Date.now()-boardChecked>60000)refreshCards();},{rootMargin:'100px'}).observe(section);
  setInterval(()=>{if(current&&!closing){const delay=current.refreshAfter||(current.data?.status.state==='live'?15000:60000);if(Date.now()-current.lastAttempt>=delay)refresh();}else if(Date.now()-boardChecked>=60000)refreshCards();},1000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(current&&!closing)refresh();else refreshCards();}});
})();
