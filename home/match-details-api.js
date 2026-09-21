(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.TFMatchDetailsCore=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const id=value=>/^[1-9]\d{0,9}$/.test(String(value))?String(value):null;
  const number=value=>value!==null&&value!==undefined&&value!==''&&Number.isInteger(Number(value))&&Number(value)>=0?Number(value):null;
  function identify(match){const event=id(match.id);if(!event)return null;return {event,home:id(match.homeId)||id(String(match.homeLogo||'').match(/\/teams\/(\d+)\./)?.[1]),away:id(match.awayId)||id(String(match.awayLogo||'').match(/\/teams\/(\d+)\./)?.[1]),league:id(match.leagueId)||id(String(match.leagueLogo||'').match(/\/leagues\/(\d+)\./)?.[1])};}
  function minute(elapsed,extra){const n=number(elapsed),added=number(extra);return n===null?'':String(n)+(added?'+'+added:'')+'′';}
  function matchStatus(status={}){
    const code=status.short||'TBD',clock=minute(status.elapsed,status.extra);
    if(['1H','HT','2H','ET','BT','P','LIVE'].includes(code))return{state:'live',code,clock,label:code==='HT'?'Mi-temps':code==='BT'?'Pause avant prolongation':code==='ET'?'Prolongation':code==='P'?'Tirs au but':'En cours'};
    if(['FT','AET','PEN','AWD','WO'].includes(code))return{state:'post',code,clock:'',label:code==='AET'?'Après prolongation':code==='PEN'?'Après tirs au but':code==='AWD'?'Résultat attribué':code==='WO'?'Forfait':'Terminé'};
    if(['PST','CANC','SUSP','INT','ABD'].includes(code))return{state:'interrupted',code,clock,label:({PST:'Reporté',CANC:'Annulé',SUSP:'Suspendu',INT:'Interrompu',ABD:'Arrêté'})[code]};
    return {state:'pre',code,clock:'',label:code==='TBD'?'Horaire à confirmer':'À venir'};
  }
  function eventType(event){
    const type=String(event.type||'').toLowerCase(),detail=String(event.detail||'').toLowerCase();
    if(type==='card')return /yellow.*red|second.*yellow/.test(detail)?['second-yellow','Deuxième jaune · exclusion']:/red/.test(detail)?['red','Carton rouge']:/yellow/.test(detail)?['yellow','Carton jaune']:null;
    if(type==='subst')return ['substitution','Changement'];
    if(type==='var')return ['var',/goal.*cancel/.test(detail)?'But annulé':/penalty.*confirm/.test(detail)?'Penalty confirmé':'Décision VAR'];
    if(type==='goal')return /miss/.test(detail)?['penalty-missed','Penalty manqué']:['goal',/own/.test(detail)?'But contre son camp':/penalty/.test(detail)?'But sur penalty':'But'];
    return null;
  }
  function normalizeEvents(events){
    const seen=new Set();return events.map((e,order)=>{const type=eventType(e);if(!type)return null;
      // API-Football: player = outgoing player, assist = incoming player for substitutions.
      const players=type[0]==='substitution'?[e.assist?.name||'',e.player?.name||'']:[e.player?.name||''];
      const clock=number(e.time?.elapsed),added=number(e.time?.extra)||0,stamp=minute(clock,added);
      const key=[clock,added,e.team?.id,e.type,e.detail,e.player?.id||e.player?.name,e.assist?.id||e.assist?.name].join('|');if(seen.has(key))return null;seen.add(key);
      return{id:key,kind:type[0],label:type[1],minute:stamp||'Minute non précisée',team:String(e.team?.id||''),players,clock,added,order};
    }).filter(Boolean).sort((a,b)=>(a.clock??Infinity)-(b.clock??Infinity)||a.added-b.added||a.order-b.order);
  }
  function normalize(fixture,expected,fetchedAt=new Date().toISOString()){
    const f=fixture.fixture||{},home=fixture.teams?.home,away=fixture.teams?.away,league=fixture.league||{};
    const ref={event:id(f.id),home:id(home?.id),away:id(away?.id),league:id(league.id)};
    if(!ref.event||!ref.home||!ref.away||!ref.league||ref.event!==expected.event||['home','away','league'].some(k=>expected[k]&&expected[k]!==ref[k])||!Number.isFinite(Date.parse(f.date)))throw Error('fixture_mismatch');
    const status=matchStatus(f.status),team=t=>({id:String(t.id),name:t.name||'',logo:t.logo||''});
    const data={ref,source:'API-Football',fetchedAt,date:f.date,league:league.name||'',home:team(home),away:team(away),status,homeScore:status.state==='pre'?null:number(fixture.goals?.home),awayScore:status.state==='pre'?null:number(fixture.goals?.away),venue:f.venue?.name||'',city:f.venue?.city||'',referee:f.referee||'',broadcasts:[],broadcastRegion:'FR',events:status.state==='pre'?[]:normalizeEvents(fixture.events||[]),eventsAvailable:Array.isArray(fixture.events),penalties:{home:number(fixture.score?.penalty?.home),away:number(fixture.score?.penalty?.away)}};
    if(!valid(data,expected))throw Error('invalid_fixture');return data;
  }
  function valid(d,ref){return !!(d&&d.source==='API-Football'&&d.ref?.event===ref.event&&id(d.ref?.event)&&['home','away','league'].every(k=>id(d.ref[k])&&(!ref[k]||d.ref[k]===ref[k]))&&d.home?.id===d.ref.home&&d.away?.id===d.ref.away&&Number.isFinite(Date.parse(d.date))&&Number.isFinite(Date.parse(d.fetchedAt))&&Date.parse(d.fetchedAt)<=Date.now()+60000&&['pre','live','post','interrupted'].includes(d.status?.state)&&[d.homeScore,d.awayScore].every(v=>v===null||Number.isInteger(v)&&v>=0)&&Array.isArray(d.events)&&d.events.every(e=>e&&Array.isArray(e.players)&&e.players.every(p=>typeof p==='string'))&&Array.isArray(d.broadcasts)&&d.broadcastRegion==='FR');}
  function summaryUrl(ref){if(!id(ref.event))throw Error('invalid_fixture');return '/.netlify/functions/match-details?fixture='+ref.event;}
  return {identify,minute,matchStatus,eventType,normalizeEvents,normalize,valid,summaryUrl};
});
