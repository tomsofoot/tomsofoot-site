(() => {
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const teams = window.TF_NATIONAL_TEAMS || [];
  const names = new Map();
  teams.forEach(team => [team.id,team.name].forEach(name=>names.set(normalize(name),team)));
  const aliases = {
    norvege:['Norway','NOR','NO'],france:['FRA','FR'],allemagne:['Germany','GER','DEU','DE'],
    espagne:['Spain','ESP','ES'],italie:['Italy','ITA','IT'],angleterre:['England','ENG'],
    ecosse:['Scotland','SCO'],'pays-de-galles':['Wales','WAL'],
    'irlande-du-nord':['Northern Ireland','NIR'],irlande:['Ireland','IRL'],
    bresil:['Brazil','BRA','BR'],argentine:['Argentina','ARG','AR'],portugal:['POR','PRT','PT'],
    belgique:['Belgium','BEL','BE'],'pays-bas':['Netherlands','Holland','NED','NL'],
    suisse:['Switzerland','SUI','CHE','CH'],suede:['Sweden','SWE','SE'],danemark:['Denmark','DEN','DK'],
    'republique-tcheque':['Tchéquie','Czechia','Czech Republic','CZE'],
    'cote-d-ivoire':["Côte d’Ivoire",'Ivory Coast','CIV'],
    'republique-democratique-du-congo':['RD Congo','RDC','DR Congo','COD'],
    'etats-unis':['USA','United States','US'],maroc:['Morocco','MAR'],algerie:['Algeria','ALG'],
    senegal:['SEN'],tunisie:['Tunisia','TUN'],japon:['Japan','JPN'],
    'coree-du-sud':['South Korea','Korea Republic','KOR'],turquie:['Turkey','Türkiye','TUR']
  };
  Object.entries(aliases).forEach(([id,list])=>{const team=names.get(normalize(id));if(team)list.forEach(name=>names.set(normalize(name),team));});
  // Dans un titre, seuls les noms complets sont recherchés : les codes courts
  // restent réservés au champ de nationalité pour éviter les faux positifs.
  const titleNames=new Map();
  teams.forEach(team=>[team.id,team.name].forEach(name=>titleNames.set(normalize(name),team)));
  Object.entries(aliases).forEach(([id,list])=>{
    const team=names.get(normalize(id));
    if(team)list.filter(name=>normalize(name).length>3).forEach(name=>titleNames.set(normalize(name),team));
  });
  function findInTitle(value){
    const title=' '+normalize(value)+' ',matches=[];
    titleNames.forEach((team,name)=>{
      let start=title.indexOf(' '+name+' ');
      while(start!==-1){matches.push({team,start,end:start+name.length+1});start=title.indexOf(' '+name+' ',start+1);}
    });
    // Une mention longue a priorité sur son sous-nom au même endroit, mais
    // « Congo contre RD Congo » conserve bien les deux sélections distinctes.
    const accepted=[];
    matches.sort((a,b)=>(b.end-b.start)-(a.end-a.start)).forEach(match=>{
      if(!accepted.some(other=>match.start<other.end&&match.end>other.start))accepted.push(match);
    });
    return [...new Set(accepted.sort((a,b)=>a.start-b.start).map(match=>match.team))];
  }
  // Aucune déduction approximative : une nationalité inconnue garde son texte seul.
  window.TFNationalTeams={all:teams,normalize,get:name=>names.get(normalize(name))||null,findInTitle};
})();
