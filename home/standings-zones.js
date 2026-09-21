/* Zones visuelles TomsoFoot : aucune modification des rangs ou statistiques ESPN. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.TFStandingsZones=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Palette et symboles uniques, partagés entre les lignes et toutes les légendes.
  const styles={
    champions:{label:'LDC · phase de ligue',color:'#5b9cf2',symbol:'●'},
    champions_qualifying:{label:'LDC · tours qualificatifs',color:'#a2d4f5',symbol:'○'},
    europa:{label:'Europa League',color:'#e9a05a',symbol:'■'},
    conference:{label:'Conference League',color:'#6abd98',symbol:'◆'},
    conference_qualifying:{label:'Qualifications Conference League',color:'#6abd98',symbol:'◇'},
    relegation_playoff:{label:'Barrage de maintien',color:'#d7b761',symbol:'↕',pattern:'hatched'},
    promotion_playoff:{label:'Barrage d’accession',color:'#d7b761',symbol:'↕',pattern:'hatched'},
    relegation:{label:'Relégation',color:'#df7c87',symbol:'↓'},
    round16:{label:'Huitièmes de finale',color:'#5b9cf2',symbol:'●'},
    playoff_seeded:{label:'Barrages · têtes de série',color:'#d7b761',symbol:'B+',pattern:'hatched'},
    playoff_unseeded:{label:'Barrages · non-têtes de série',color:'#d7b761',symbol:'B',pattern:'hatched'},
    eliminated:{label:'Élimination',color:'#df7c87',symbol:'×'}
  };
  const keys={ldc:'champions',ldcQ:'champions_qualifying',europa:'europa',conference:'conference',barrage:'relegation_playoff',barrageAccession:'promotion_playoff',releg:'relegation',huitiemes:'round16',barragesTetes:'playoff_seeded',barragesAutres:'playoff_unseeded',elimination:'eliminated'};

  // Année de DÉBUT du championnat affiché : 2026 = saison 2026–2027.
  // Grille éditoriale demandée pour cet aperçu. Ajuster ici après les EPS / coupes.
  // Copier une saison dans un nouvel objet ; ne jamais appliquer ses places à l'année suivante.
  // Chaque intervalle [premier, dernier] est inclusif ; null = aucune zone de ce type.
  const seasons={
    2026:{
      'eng.1':{name:'Premier League',clubs:20,ldc:[1,5],ldcQ:null,europa:[6,6],conference:[7,7],barrage:null,releg:[18,20]},
      'esp.1':{name:'La Liga',clubs:20,ldc:[1,5],ldcQ:null,europa:[6,6],conference:[7,7],barrage:null,releg:[18,20]},
      'ita.1':{name:'Serie A',clubs:20,ldc:[1,4],ldcQ:null,europa:[5,6],conference:[7,7],barrage:null,releg:[18,20]},
      'ger.1':{name:'Bundesliga',clubs:18,ldc:[1,4],ldcQ:null,europa:[5,5],conference:[6,6],barrage:[16,16],releg:[17,18]},
      'fra.1':{name:'Ligue 1',clubs:18,ldc:[1,3],ldcQ:[4,4],europa:[5,5],conference:[6,6],barrage:[16,16],releg:[17,18]},
      'uefa.champions':{name:'Ligue des champions',clubs:36,huitiemes:[1,8],barragesTetes:[9,16],barragesAutres:[17,24],elimination:[25,36]}
    }
  };
  function errorsFor(rule){
    const errors=[],occupied=new Set();
    if(!rule||typeof rule.name!=='string'||!Number.isInteger(rule.clubs)||rule.clubs<1)return ['Championnat invalide'];
    for(const [key,range] of Object.entries(rule)){
      if(['name','clubs'].includes(key))continue;
      if(!keys[key]){errors.push('Zone inconnue : '+key);continue;}
      if(range===null)continue;
      if(!Array.isArray(range)||range.length!==2||!range.every(Number.isInteger)||range[0]<1||range[0]>range[1]||range[1]>rule.clubs){errors.push('Intervalle invalide : '+key);continue;}
      for(let rank=range[0];rank<=range[1];rank++){
        if(occupied.has(rank))errors.push('Chevauchement au rang '+rank);
        occupied.add(rank);
      }
    }
    return errors;
  }
  function validate(config=seasons){
    const errors=[];
    for(const [season,leagues] of Object.entries(config)){
      if(!/^\d{4}$/.test(season)){errors.push('Saison invalide : '+season);continue;}
      for(const [league,rule] of Object.entries(leagues))errors.push(...errorsFor(rule).map(error=>`${season} / ${league} : ${error}`));
    }
    return errors;
  }
  function rulesFor(league,season,config=seasons){
    const rule=config[season]?.[league];
    return rule&&!errorsFor(rule).length?rule:null;
  }
  function legend(league,season,config=seasons){
    const rule=rulesFor(league,season,config);
    if(!rule)return [];
    return Object.entries(keys).filter(([key])=>Array.isArray(rule[key])).map(([key,id])=>({id,range:[...rule[key]],...styles[id]})).sort((a,b)=>a.range[0]-b.range[0]);
  }
  function zoneForRank(league,season,rank,config=seasons){
    if(!Number.isInteger(rank))return '';
    return legend(league,season,config).find(zone=>rank>=zone.range[0]&&rank<=zone.range[1])?.id || '';
  }
  function decorate(data,config=seasons){
    // Copie de présentation uniquement : le relevé et son cache ESPN restent intacts.
    const entries=legend(data.league,data.season,config),rule=rulesFor(data.league,data.season,config);
    const compatible=rule?.clubs===data.rows.length;
    return {...data,rows:data.rows.map(row=>({...row,zone:compatible&&Number.isInteger(row.rank)?entries.find(zone=>row.rank>=zone.range[0]&&row.rank<=zone.range[1])?.id || '':''}))};
  }
  return {styles,seasons,validate,rulesFor,legend,zoneForRank,decorate};
});
