/* Les anciens rails de jeux deviennent les deux repères du parcours de l'accueil. */
(() => {
  'use strict';
  function init() {
    if(document.body.dataset.style!=='club')return;
    const main=document.querySelector('#main');if(!main)return;
    const definitions=[
      {id:'editorial',label:'À la une',zones:['editorial']},
      {id:'formats',label:'Les jeux',zones:['formats']},
      {id:'coup-denvoi',label:'Coup d’envoi',zones:['coup-denvoi']},
      {id:'live',label:'Le Live',zones:['live']},
      {id:'derniers-articles',label:'Derniers articles',zones:['derniers-articles']},
      {id:'match-center',label:'Match en direct',zones:['match-center']},
      {id:'classements',label:'Classements',zones:['football']},
      {id:'videos',label:'Documentaires',zones:['videos']},
      {id:'archives-explorer',label:'Archives',zones:['archives-explorer']},
      {id:'newsletter',label:'Newsletter',zones:['newsletter','vision']}
    ];
    // Le DOM final fait autorité, après le réagencement effectué par club-home.js.
    const sections=definitions.map(item=>({...item,target:document.getElementById(item.id)})).filter(item=>item.target)
      .sort((a,b)=>a.target.compareDocumentPosition(b.target)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
    if(sections.length<2)return;
    const zones=sections.flatMap((item,index)=>item.zones.map(id=>({element:document.getElementById(id),index}))).filter(item=>item.element);
    const footer=document.querySelector('#app > footer');if(footer)zones.push({element:footer,index:sections.length-1});
    const nav=document.getElementById('game-reminders') || document.createElement('nav');
    nav.id='game-reminders';nav.className='game-reminders context-navigation';
    nav.setAttribute('aria-label','Navigation contextuelle entre les sections');
    nav.setAttribute('aria-describedby','context-position');
    nav.innerHTML='<span id="context-position" class="context-sr-only"></span>';
    const arrow=direction=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${direction==='previous'?'M12 19V5m-6 6 6-6 6 6':'M12 5v14m-6-6 6 6 6-6'}"/></svg>`;
    const links={};
    for(const [direction,label] of [['previous','Précédent'],['next','Suivant']]) {
      const link=document.createElement('a');link.className='game-reminder context-link context-'+direction;
      link.dataset.direction=direction;
      link.innerHTML=arrow(direction)+`<span class="context-copy"><span class="context-direction">${label}</span><strong class="context-label"></strong></span>`;
      nav.append(link);links[direction]=link;
    }
    document.body.append(nav);
    const position=nav.querySelector('#context-position');
    const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
    let current=-1, preferred=-1, observer, frame=0;
    const line=()=>Math.min(220,Math.round(innerHeight*.25));
    function updateLink(link,item,direction) {
      link.hidden=!item;
      if(!item){link.removeAttribute('href');link.removeAttribute('aria-label');return;}
      link.href='#'+item.id;
      link.querySelector('.context-label').textContent=item.label;
      link.setAttribute('aria-label',`Section ${direction==='previous'?'précédente':'suivante'} : ${item.label}`);
    }
    function render(index) {
      if(index===current)return;
      const focused=nav.contains(document.activeElement)?document.activeElement:null;
      if(current>=0){sections[current].target.classList.remove('context-section-current');sections[current].target.removeAttribute('data-context-current');}
      current=index;
      const item=sections[index];
      item.target.classList.add('context-section-current');item.target.setAttribute('data-context-current','true');
      nav.dataset.current=item.id;
      nav.dataset.edge=index===0?'start':index===sections.length-1?'end':'middle';
      position.textContent=`Section actuelle : ${item.label}. Étape ${index+1} sur ${sections.length}.`;
      updateLink(links.previous,sections[index-1],'previous');
      updateLink(links.next,sections[index+1],'next');
      if(focused?.hidden)(index===0?links.next:links.previous).focus({preventScroll:true});
    }
    function refresh() {
      frame=0;
      const anchor=line();
      let best=0,distance=Infinity;
      for(const zone of zones){
        const rect=zone.element.getBoundingClientRect();if(rect.height<=0)continue;
        const gap=anchor<rect.top?rect.top-anchor:anchor>rect.bottom?anchor-rect.bottom:0;
        if(gap<distance || (gap===0 && zone.index===preferred)){best=zone.index;distance=gap;}
      }
      // Le pied de page reste rattaché à la dernière étape, sans lien suivant.
      if(scrollY+innerHeight>=document.documentElement.scrollHeight-3)best=sections.length-1;
      render(best);
    }
    function schedule(){if(!frame)frame=requestAnimationFrame(refresh);}
    function observe() {
      observer?.disconnect();
      const top=line();
      // Marges en pixels : les pourcentages d'IntersectionObserver dépendent de la largeur.
      observer=new IntersectionObserver(schedule,{rootMargin:`-${top}px 0px -${Math.max(0,innerHeight-top-2)}px 0px`,threshold:0});
      zones.forEach(zone=>observer.observe(zone.element));schedule();
    }
    for(const link of Object.values(links))link.addEventListener('click',event=>{
      if(event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
      const item=sections.find(item=>'#'+item.id===link.getAttribute('href'));if(!item)return;
      event.preventDefault();
      preferred=sections.indexOf(item);render(preferred);
      if(location.hash!=='#'+item.id)history.pushState(null,'','#'+item.id);
      const heading=item.target.querySelector('summary,h2,h1') || item.target;
      if(!heading.hasAttribute('tabindex')){
        heading.setAttribute('tabindex','-1');heading.classList.add('context-focus-target');
        heading.addEventListener('blur',()=>{heading.removeAttribute('tabindex');heading.classList.remove('context-focus-target');},{once:true});
      }
      heading.focus({preventScroll:true});
      item.target.scrollIntoView({behavior:reducedMotion.matches?'instant':'smooth',block:'start'});
      schedule();
    });
    // Le scroll ne recalcule pas la mise en page : IntersectionObserver garde ce rôle.
    // Les repères émergent doucement, puis s'effacent après 1,6 s de lecture immobile.
    let idleTimer=0;
    function showDuringScroll(){
      nav.classList.add('is-scrolling');
      clearTimeout(idleTimer);
      idleTimer=setTimeout(()=>nav.classList.remove('is-scrolling'),1600);
    }
    window.addEventListener('scroll',showDuringScroll,{passive:true});
    window.addEventListener('pagehide',()=>clearTimeout(idleTimer));
    // La pastille reste au-dessus des onglets existants, y compris avec safe-area.
    const bottom=document.querySelector('.bottom-nav');
    function measureBottom(){nav.style.setProperty('--context-bottom-space',(bottom?.getBoundingClientRect().height || 0)+'px');}
    const sizeObserver=new ResizeObserver(()=>{measureBottom();schedule();});
    sizeObserver.observe(main);if(bottom)sizeObserver.observe(bottom);
    window.addEventListener('resize',()=>{measureBottom();observe();},{passive:true});
    window.addEventListener('scrollend',schedule,{passive:true});
    window.addEventListener('hashchange',schedule);window.addEventListener('popstate',schedule);
    measureBottom();observe();
  }
  if(window.TF_HOME?.assembling)window.addEventListener('tomsofoot:home-ready',init,{once:true});
  else if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
