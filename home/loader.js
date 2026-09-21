/* Chargement des données publiques du même déploiement avant les modules de présentation. */
(async()=>{
 'use strict';
 const blank={articles:[],competitions:[],genres:[],hints:{},docs:{videos:[]},local:{manifeste:{}},views:{},matches:{matches:[]},twitch:{live:false},assets:{},errors:{}};
 const read=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error();return r.json();};
 let data;
 try{data=await read('/.netlify/functions/home-data');}catch{data=blank;}
 window.TF_DATA=data;
 try{
  const scripts=await read('/home/scripts.json');
  for(const file of scripts)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/home/'+file;s.onload=resolve;s.onerror=reject;document.body.append(s);});
  if(!data.articles.length){
   document.querySelector('#hero-cta')?.setAttribute('href','/articles/');
   const meta=document.querySelector('#hero-meta');if(meta)meta.textContent='';
   document.querySelector('#hero-une .hero-visual img')?.remove();
   const latest=document.querySelector('#latest-articles');if(latest)latest.textContent='Les articles sont momentanément indisponibles. Retrouvez nos publications dans les archives.';
  }
  // Aucun faux « zéro consultation » si le compteur est absent.
  for(const element of document.querySelectorAll('[data-count]')){
   const value=data.views[element.dataset.count];if(Number.isSafeInteger(value)&&value>=0)element.textContent=new Intl.NumberFormat('fr-FR').format(value);else element.parentElement.hidden=true;
  }
  document.querySelector('#main')?.setAttribute('data-release','R03.24');
 }catch{
  const message=document.createElement('p');message.style.cssText='padding:32px;text-align:center';
  message.append('Le chargement a été interrompu. ');const link=document.createElement('a');link.href='/articles/';link.textContent='Lire les articles';message.append(link);document.querySelector('#app').prepend(message);
 }
})();
