(() => {
  'use strict';
  const root=document.querySelector('#app');
  const selector='.hero,.daily,.live-card,.feature,.story,.match-card,.doc-feature,.doc-next button,.game-options>a';
  const fine=matchMedia('(hover:hover) and (pointer:fine)'),reduce=matchMedia('(prefers-reduced-motion:reduce)');
  let active=null,bounds=null,frame=0,x=0,y=0;
  function layer(className){const el=document.createElement('span');el.className='hover-decoration '+className;el.setAttribute('aria-hidden','true');return el;}
  function mode(card){
    if(card.matches('.hero'))return 'lift';
    if(card.matches('.story'))return 'edge';
    if(card.matches('.career'))return 'prism';
    if(card.matches('.youtube'))return 'scan';
    if(card.matches('.live-card'))return 'halo';
    if(card.matches('.doc-feature,.films'))return 'focus';
    if(card.matches('.match-card'))return 'line';
    return 'edge';
  }
  function decorate(node){
    if(node.nodeType!==1||node.closest('.hover-decoration'))return;
    const cards=node.matches(selector)?[node,...node.querySelectorAll(selector)]:[...node.querySelectorAll(selector)];
    cards.forEach(card=>{
      if(card.classList.contains('hover-card'))return;
      const kind=mode(card);card.classList.add('hover-card');card.dataset.hover=kind;card.append(layer('hover-edge'));
      if(kind==='line')card.append(layer('hover-line'));
      if(['prism','scan','halo','focus'].includes(kind)){
        const host=card.querySelector('.feature-image,.doc-image')||card;
        if(host!==card)host.classList.add('optical-host');
        host.append(layer('hover-film'));
      }
    });
  }
  decorate(root);
  new MutationObserver(records=>{
    records.forEach(record=>record.addedNodes.forEach(decorate));
    if(active&&!active.isConnected)reset();
  }).observe(root,{childList:true,subtree:true});
  function reset(){
    cancelAnimationFrame(frame);frame=0;
    if(active){active.classList.remove('is-hovered');['--hx','--hy','--rx','--ry'].forEach(p=>active.style.removeProperty(p));}
    active=null;bounds=null;
  }
  function paint(){
    frame=0;if(!active||!bounds)return;
    const px=Math.max(0,Math.min(1,(x-bounds.left)/bounds.width)),py=Math.max(0,Math.min(1,(y-bounds.top)/bounds.height));
    active.style.setProperty('--hx',px*100+'%');active.style.setProperty('--hy',py*100+'%');
    active.style.setProperty('--rx',((.5-py)*2.2).toFixed(2)+'deg');active.style.setProperty('--ry',((px-.5)*2.2).toFixed(2)+'deg');
  }
  root.addEventListener('pointerover',event=>{
    if(!fine.matches||event.pointerType==='touch')return;
    const card=event.target.closest('.hover-card');if(card===active)return;
    reset();if(!card)return;active=card;bounds=card.getBoundingClientRect();x=event.clientX;y=event.clientY;
    if(!reduce.matches)paint();card.classList.add('is-hovered');
  },{passive:true});
  root.addEventListener('pointermove',event=>{if(!active||!fine.matches||reduce.matches)return;x=event.clientX;y=event.clientY;if(!frame)frame=requestAnimationFrame(paint);},{passive:true});
  root.addEventListener('pointerout',event=>{if(active&&!active.contains(event.relatedTarget))reset();},{passive:true});
  window.addEventListener('blur',reset);window.addEventListener('scroll',()=>{if(active&&active.isConnected)bounds=active.getBoundingClientRect();},{passive:true});window.addEventListener('resize',reset,{passive:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)reset();});fine.addEventListener('change',reset);reduce.addEventListener('change',reset);
  window.TF_MOTION_READY=true;window.TF_CLUB_HOVER_READY=true;
})();
