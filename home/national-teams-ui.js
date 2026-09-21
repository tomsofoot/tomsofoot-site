(() => {
  const catalog=window.TFNationalTeams;
  if(!catalog)return;
  function attachNationality(){
    const card=document.getElementById('jogadle-card');
    const cells=card?.querySelectorAll('.hints>div')||[];
    for(const cell of cells){
      if(catalog.normalize(cell.querySelector('span')?.textContent)!=='nationalite')continue;
      const name=cell.querySelector('strong')?.textContent||'';
      const team=catalog.get(name);
      if(cell.dataset.nationalTeam===(team?.id||''))continue;
      cell.querySelector('.national-logo')?.remove();
      const icon=cell.querySelector('svg');if(icon)icon.style.display='';
      cell.classList.toggle('has-national-logo',!!team);cell.dataset.nationalTeam=team?.id||'';
      if(!team)continue;
      const image=document.createElement('img');image.src=team.logo;image.alt='';image.className='national-logo';image.decoding='async';
      image.addEventListener('error',()=>{image.remove();cell.classList.remove('has-national-logo');if(icon)icon.style.display='';},{once:true});
      if(icon)icon.style.display='none';cell.prepend(image);
    }
  }
  const nationalCompetitions=new Set(['coupe-du-monde','euro','ligue-des-nations','nations-league']);
  function teamsForArticle(article){
    if(Array.isArray(article.national_team_ids))return [...new Set(article.national_team_ids.map(id=>catalog.get(id)).filter(Boolean))];
    if(!nationalCompetitions.has(article.competition_id))return [];
    // Noms entiers uniquement dans une rubrique de sélections. Le chapô n'est pas analysé.
    return catalog.findInTitle(article.title);
  }
  function addSelectionDirectory(){
    const group=[...document.querySelectorAll('.rgroup')].find(el=>catalog.normalize(el.querySelector('h2')?.textContent)==='selections');
    if(!group||group.querySelector('.national-directory'))return;
    const directory=document.createElement('details');directory.className='national-directory';
    directory.innerHTML='<summary>Équipes nationales <span aria-hidden="true">+</span></summary><div class="national-directory-body"><label for="national-search">Rechercher une sélection</label><input id="national-search" type="search" placeholder="France, Norvège…" autocomplete="off"><p class="national-directory-count" role="status"></p><ul class="national-directory-list" aria-label="Logos des sélections"></ul></div>';
    const search=directory.querySelector('input'),list=directory.querySelector('ul'),count=directory.querySelector('[role="status"]');
    const render=()=>{
      const query=catalog.normalize(search.value);
      const matches=catalog.all.filter(team=>catalog.normalize(team.name).includes(query)||catalog.normalize(team.id).includes(query));
      list.replaceChildren();
      matches.forEach(team=>{
        const item=document.createElement('li'),img=document.createElement('img'),name=document.createElement('span');
        img.src=team.logo;img.alt='';img.loading='lazy';img.width=32;img.height=36;img.addEventListener('error',()=>img.remove(),{once:true});
        name.textContent=team.name;item.append(img,name);list.append(item);
      });
      count.textContent=matches.length ? matches.length+' logo'+(matches.length>1?'s':'')+' disponible'+(matches.length>1?'s':'') : 'Aucune sélection trouvée.';
    };
    search.addEventListener('input',render);directory.addEventListener('toggle',()=>{if(directory.open&&!list.childElementCount)render();});
    group.append(directory);
  }
  function attachArticleTeams(){
    document.querySelectorAll('.story').forEach(card=>{
      const slug=decodeURIComponent(new URL(card.href,location.href).pathname.split('/').filter(Boolean).at(-1)||'');
      const article=(window.TF_DATA?.articles||[]).find(item=>item.slug===slug);
      if(!article)return;
      const teams=teamsForArticle(article),key=teams.map(team=>team.id).join('|');
      if(card.dataset.nationalTeams===key)return;
      card.dataset.nationalTeams=key;card.querySelector('.national-article-teams')?.remove();
      if(!teams.length)return;
      const row=document.createElement('div');row.className='national-article-teams';row.setAttribute('aria-label','Sélections concernées');
      teams.forEach(team=>{
        const item=document.createElement('span');item.className='national-article-team';
        const image=document.createElement('img');image.src=team.logo;image.alt='';image.loading='lazy';image.addEventListener('error',()=>image.remove(),{once:true});
        item.append(image,document.createTextNode(team.name));row.append(item);
      });
      card.querySelector('.story-copy')?.append(row);
    });
  }
  let queued=false;
  const refresh=()=>{queued=false;attachNationality();attachArticleTeams();};
  addSelectionDirectory();refresh();
  new MutationObserver(records=>{
    if(queued||records.every(record=>record.target.parentElement?.closest('.national-article-teams')||record.target.closest?.('.national-article-teams')))return;
    queued=true;queueMicrotask(refresh);
  }).observe(document.getElementById('app'),{childList:true,subtree:true,characterData:true});
  window.TFNationalTeamUI={refresh,teamsForArticle};
})();
