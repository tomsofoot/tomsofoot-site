/* FLIP, comme Jogadle : nœuds conservés par équipe, rang et zone appliqués à l'arrivée. */
(() => {
  'use strict';
  const columns=[['played','J','Matchs joués'],['won','G','Matchs gagnés'],['drawn','N','Matchs nuls'],['lost','P','Matchs perdus'],['for','BP','Buts pour'],['against','BC','Buts contre'],['diff','Diff','Différence de buts'],['points','Pts','Points']];
  const duration=620, easing='cubic-bezier(.65,0,.35,1)';
  const pending=new Map();
  function settle(row){pending.get(row)?.();}
  function finishAll(){[...pending.values()].forEach(finish=>finish());}
  function element(tag,className,text){const node=document.createElement(tag);node.className=className;if(text!=null)node.textContent=text;return node;}
  function applyPosition(row,data,zones){
    const zone=zones[data.zone],rank=row.querySelector('.standing-rank');
    row.dataset.zone=zone?data.zone:'';
    row.dataset.zonePattern=zone?.pattern || '';
    if(zone){row.style.setProperty('--zone',zone.color);rank.title=zone.label;}
    else{row.style.removeProperty('--zone');rank.removeAttribute('title');}
    rank.querySelector('.standing-rank-value').textContent=String(data.rank).padStart(2,'0');
    rank.querySelector('.standing-zone-mark').textContent=zone?.symbol || '';
    rank.querySelector('.standings-sr').textContent=zone?' · '+zone.label:'';
    row.dataset.rank=String(data.rank);
  }
  function render(container,data,{full=false,clubInfo,zones,caption,animate=true,reduced=false}={}){
    const cols=full?columns:columns.filter(([key])=>['played','diff','points'].includes(key));
    let table=container.querySelector('table');
    const same=table?.dataset.league===data.league && table?.dataset.season===String(data.season) && table?.dataset.full===String(full);
    // Ne jamais animer le passage d'un championnat ou d'une saison à un autre.
    if(!same){
      container.querySelectorAll('tbody tr').forEach(settle);
      table=element('table','standings-table'+(full?' standings-table-full':''));
      Object.assign(table.dataset,{league:data.league,season:String(data.season),full:String(full)});
      table.append(element('caption','standings-sr',caption));
      const head=document.createElement('thead'),headRow=document.createElement('tr');
      for(const [key,label,title] of [['rank','#','Position'],['team','Club','Club'],...cols]){
        const cell=element('th','standing-'+key);cell.scope='col';
        const abbr=document.createElement('abbr');abbr.title=title;abbr.textContent=label;cell.append(abbr);headRow.append(cell);
      }
      head.append(headRow);table.append(head,document.createElement('tbody'));container.replaceChildren(table);
    }
    const tbody=table.tBodies[0],existing=new Map([...tbody.rows].map(row=>[row.dataset.teamId,row]));
    existing.forEach(settle);
    const box=container.getBoundingClientRect();
    const shouldAnimate=same && animate && !reduced && !document.hidden && !container.closest('[aria-hidden="true"]') && box.bottom>0 && box.top<innerHeight;
    // FIRST : toutes les mesures avant les écritures.
    const first=new Map();
    if(shouldAnimate)existing.forEach((row,id)=>first.set(id,row.getBoundingClientRect().top));
    const order=data.rows.map(item=>{
      let row=existing.get(item.id);const isNew=!row;
      if(!row){
        row=document.createElement('tr');row.dataset.teamId=item.id;
        const rank=element('td','standing-rank'),mark=element('span','standing-zone-mark');mark.setAttribute('aria-hidden','true');
        rank.append(element('span','standing-rank-value'),mark,element('span','standings-sr'));
        const team=element('th','standing-team');team.scope='row';
        const club=element('span','standing-club');club.append(element('span','standing-crest'),element('span','standing-club-name'));team.append(club);
        row.append(rank,team,...cols.map(([key])=>element('td','standing-'+key)));
      }
      const club=clubInfo(item),name=row.querySelector('.standing-club-name'),crest=row.querySelector('.standing-crest');
      if(name.textContent!==club.name)name.textContent=club.name;
      name.title=club.name;
      if(crest.dataset.logo!==(club.logo || '')){
        crest.dataset.logo=club.logo || '';crest.replaceChildren();
        if(club.logo){const img=document.createElement('img');img.src=club.logo;img.alt='';img.width=24;img.height=24;img.addEventListener('error',()=>{img.hidden=true;},{once:true});crest.append(img);}
      }
      // Les statistiques viennent exclusivement du relevé. Une absence reste vide, pas zéro.
      for(const [key] of cols){
        const cell=row.querySelector('.standing-'+key),valid=Number.isInteger(item[key]);
        cell.textContent=valid?(key==='diff'&&item[key]>0?'+':'')+item[key]:'';
        if(valid)cell.removeAttribute('aria-label');else cell.setAttribute('aria-label','Donnée indisponible');
      }
      return {row,item,isNew};
    });
    const ids=new Set(data.rows.map(row=>row.id));
    existing.forEach((row,id)=>{if(!ids.has(id))row.remove();});
    // LAST : réordonner les nœuds, sans remplacer le tableau ni réinitialiser le scroll.
    let cursor=tbody.firstElementChild;
    for(const {row} of order){if(row!==cursor)tbody.insertBefore(row,cursor);cursor=row.nextElementSibling;}
    const moving=[];
    for(const entry of order){
      const {row,item,isNew}=entry;
      const delta=shouldAnimate&&!isNew?first.get(item.id)-row.getBoundingClientRect().top:0;
      if(!Number.isFinite(delta)||Math.abs(delta)<.5||typeof row.animate!=='function')applyPosition(row,item,zones);
      else moving.push({...entry,delta});
    }
    // INVERT / PLAY : les lignes montantes passent au-dessus des lignes descendantes.
    for(const {row,item,delta} of moving){
      row.classList.add('standing-moving',delta>0?'standing-moving-up':'standing-moving-down');
      let animation,timer,done=false;
      const finish=()=>{
        if(done)return;done=true;clearTimeout(timer);pending.delete(row);
        animation?.cancel();row.classList.remove('standing-moving','standing-moving-up','standing-moving-down');
        applyPosition(row,item,zones);
      };
      pending.set(row,finish);
      animation=row.animate([{transform:`translateY(${delta}px)`},{transform:'translateY(0)'}],{duration,easing,fill:'both'});
      animation.finished.then(finish,finish);
      timer=setTimeout(finish,duration+160); // Fin garantie si l'onglet devient inactif.
    }
    return table;
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)finishAll();});
  window.addEventListener('resize',finishAll,{passive:true});
  window.TFStandingsTable={render,finishAll};
})();
