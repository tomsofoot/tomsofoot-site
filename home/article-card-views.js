/* Les cartes lisent le même compteur que le lecteur ; seul « Voir plus » l'incrémente. */
(() => {
  'use strict';
  const roots=['latest-articles','arch-out'].map(id=>document.getElementById(id)).filter(Boolean);
  if(!roots.length)return;
  const formatter=new Intl.NumberFormat('fr-FR');
  const seen=new WeakSet(), labels=new Map(), loaded=new Set(), cache=new Map();
  let queue=Promise.resolve();
  function display(id,data){
    for(const label of labels.get(id) || []){
      if(!label.isConnected)continue;
      label.textContent=' · '+formatter.format(data.count)+' déjà consulté';
      label.title='Lecteurs ayant cliqué sur « Voir plus », une fois par session de 24 h.'+(data.preview?' Compteur de l’aperçu local.':'');
      label.hidden=false;
    }
  }
  function load(id){
    loaded.add(id);
    if(!cache.has(id)){
      // Une seule requête à la fois évite de créer plusieurs cookies à la première visite.
      const request=()=>fetch('/.netlify/functions/article-views?article_id='+encodeURIComponent(id),{
        credentials:'same-origin',signal:AbortSignal.timeout(8000)
      }).then(async response=>{
        if(!response.ok)throw Error('counter_unavailable');
        const data=await response.json();
        if(!Number.isSafeInteger(data.count) || data.count<0)throw Error('invalid_counter');
        return data;
      });
      const result=queue.then(()=>navigator.locks?navigator.locks.request('tf-article-session',request):request());
      queue=result.catch(()=>null);
      cache.set(id,result);
    }
    cache.get(id).then(data=>display(id,data)).catch(()=>{
      // Une donnée absente ne devient jamais un faux zéro.
      cache.delete(id);
      for(const label of labels.get(id) || [])label.hidden=true;
    });
  }
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries){
      if(!entry.isIntersecting)continue;
      observer.unobserve(entry.target);
      const id=entry.target.querySelector('[data-article-views]')?.dataset.articleViews;
      if(id)load(id);
    }
  },{rootMargin:'120px'});
  function scan(){
    for(const root of roots)for(const label of root.querySelectorAll('[data-article-views]')){
      if(seen.has(label))continue;
      seen.add(label);
      const id=label.dataset.articleViews;
      if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))continue;
      if(!labels.has(id))labels.set(id,new Set());
      const group=labels.get(id);
      for(const old of group)if(!old.isConnected)group.delete(old);
      group.add(label);
      observer.observe(label.closest('.story'));
    }
  }
  const mutations=new MutationObserver(scan);
  roots.forEach(root=>mutations.observe(root,{childList:true,subtree:true}));
  function refresh(){for(const id of loaded){cache.delete(id);load(id);}}
  window.addEventListener('pageshow',event=>{if(event.persisted)refresh();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  window.addEventListener('storage',event=>{
    if(!event.key?.startsWith('tf:read:'))return;
    const id=event.key.split(':').at(-1);
    if(loaded.has(id)){cache.delete(id);load(id);}
  });
  scan();
})();
