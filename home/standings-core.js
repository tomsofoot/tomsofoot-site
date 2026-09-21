(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./standings-zones.js'));
  else root.TFStandingsCore=factory(root.TFStandingsZones);
})(typeof globalThis!=='undefined'?globalThis:this,function(zoneConfig){
  'use strict';
  const leagues=[
    {id:'fra.1',short:'Ligue 1',name:'Ligue 1 McDonald’s',country:'France',code:'FR',folder:'france',teams:18,color:'#0a4eb8',light:'#8ae9ff'},
    {id:'eng.1',short:'Premier League',name:'Premier League',country:'Angleterre',code:'EN',folder:'angleterre',teams:20,color:'#491c72',light:'#dbbaff'},
    {id:'ger.1',short:'Bundesliga',name:'Bundesliga',country:'Allemagne',code:'DE',folder:'allemagne',teams:18,color:'#aa2536',light:'#ffb2b4'},
    {id:'esp.1',short:'La Liga',name:'LALIGA EA SPORTS',country:'Espagne',code:'ES',folder:'espagne',teams:20,color:'#a83d2c',light:'#ffcfb5'},
    {id:'ita.1',short:'Serie A',name:'Serie A',country:'Italie',code:'IT',folder:'italie',teams:20,color:'#096779',light:'#a4f0e5'},
    {id:'uefa.champions',short:'Ligue des champions',name:'Ligue des champions',country:'Europe',code:'UE',folder:'',teams:36,color:'#142c80',light:'#a5caff'}
  ];
  const zones=zoneConfig.styles;
  const zoneNames={
    'Champions League':'champions','Champions League qualifying':'champions_qualifying',
    'Europa League':'europa','Conference League':'conference','Conference League qualifying':'conference_qualifying',
    'Relegation playoff':'relegation_playoff','Relegation':'relegation','Relegated':'relegation',
    'Qualifies for round of 16':'round16','Knockout phase playoffs - seeded':'playoff_seeded',
    'Knockout phase playoffs - unseeded':'playoff_unseeded','Eliminated':'eliminated'
  };
  const statKeys={rank:'rank',played:'gamesPlayed',won:'wins',drawn:'ties',lost:'losses',for:'pointsFor',against:'pointsAgainst',diff:'pointDifferential',points:'points'};
  function coherent(row){
    const known=keys=>keys.every(key=>Number.isInteger(row[key]));
    return (!known(['played','won','drawn','lost'])||row.played===row.won+row.drawn+row.lost)
      &&(!known(['diff','for','against'])||row.diff===row.for-row.against);
  }
  function seasonYear(date=new Date()){return date.getUTCFullYear()-(date.getUTCMonth()<6?1:0);}
  function sourceUrl(id,season){
    if(!leagues.some(l=>l.id===id)||!Number.isInteger(season)||season<2020||season>2100)throw Error('Championnat ou saison invalide');
    return `https://site.web.api.espn.com/apis/v2/sports/soccer/${id}/standings?season=${season}`;
  }
  function normalize(raw,league,season,fetchedAt=new Date().toISOString()){
    if(!leagues.some(l=>l.id===league.id)||raw?.season?.year!==season)throw Error('Saison incorrecte');
    // Keep provider rankings and point deductions. Never derive points from wins.
    const groups=[];
    function visit(node){if(node.standings?.entries)groups.push(node.standings.entries);for(const c of node.children||[])visit(c);}
    visit(raw);
    if(groups.length!==1||groups[0].length!==league.teams)throw Error('Classement incomplet');
    const rows=groups[0].map(e=>{
      const stats=new Map((e.stats||[]).map(s=>[s.name,s.value]));
      const row={id:String(e.team?.id||''),name:e.team?.displayName||'',abbreviation:e.team?.abbreviation||'',logo:e.team?.logos?.[0]?.href||'',zone:zoneNames[e.note?.description]||''};
      if(!row.id||!row.name)throw Error('Équipe manquante');
      for(const [key,stat] of Object.entries(statKeys)){
        const value=stats.get(stat);
        // Un rang est indispensable ; une statistique absente reste absente à l'écran.
        if(key!=='rank' && value==null){row[key]=null;continue;}
        if(!Number.isInteger(value))throw Error('Statistique manquante : '+stat);
        if(!['points','diff'].includes(key)&&value<0)throw Error('Statistique invalide : '+stat);
        row[key]=value;
      }
      if(!coherent(row))throw Error('Statistiques incohérentes');
      return row;
    }).sort((a,b)=>a.rank-b.rank);
    const result={league:league.id,season,fetchedAt,source:'ESPN',rows};
    if(!isSnapshot(result,league,season))throw Error('Rangs ou équipes dupliqués');
    return result;
  }
  function isSnapshot(data,league,season){
    if(data?.league!==league.id||data?.season!==season||data?.source!=='ESPN'||!Number.isFinite(Date.parse(data.fetchedAt))||Date.parse(data.fetchedAt)>Date.now()+60000||!Array.isArray(data.rows)||data.rows.length!==league.teams)return false;
    const ids=new Set();
    return data.rows.every((r,index)=>{
      if(typeof r.id!=='string'||!r.id||ids.has(r.id)||typeof r.name!=='string'||!r.name||r.rank!==index+1||typeof r.zone!=='string'||(r.zone&&!zones[r.zone]))return false;
      ids.add(r.id);
      return Object.keys(statKeys).every(k=>Number.isInteger(r[k])||(k!=='rank'&&r[k]===null))&&coherent(r)&&['played','won','drawn','lost','for','against'].every(k=>r[k]===null||r[k]>=0);
    });
  }
  return {leagues,zones,seasonYear,sourceUrl,normalize,isSnapshot};
});
