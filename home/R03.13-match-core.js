/* IDs ESPN explicitement séparés de ceux d'API-Football. */
(()=>{
 const base=window.TFMatchDetailsCore,id=v=>/^[1-9]\d{0,9}$/.test(String(v));
 function identify(m){
  if(m.provider!=='espn')return base.identify(m);
  const event=String(m.id).match(/^espn:uefa\.nations:([1-9]\d{0,9})$/)?.[1];
  return event&&m.leagueId==='uefa.nations'&&id(m.homeId)&&id(m.awayId)?{provider:'espn',event,league:'uefa.nations',home:String(m.homeId),away:String(m.awayId)}:null;
 }
 function valid(d,r){
  if(r.provider!=='espn')return base.valid(d,r);
  return !!(d&&d.source==='ESPN'&&d.ref?.provider==='espn'&&['event','league','home','away'].every(k=>d.ref[k]===r[k])&&d.home?.id===r.home&&d.away?.id===r.away&&Number.isFinite(Date.parse(d.date))&&Number.isFinite(Date.parse(d.fetchedAt))&&Date.parse(d.fetchedAt)<=Date.now()+60000&&['pre','live','post','interrupted'].includes(d.status?.state)&&[d.homeScore,d.awayScore].every(v=>v===null||Number.isInteger(v)&&v>=0)&&Array.isArray(d.events)&&d.events.every(e=>Array.isArray(e.players)&&e.players.every(p=>typeof p==='string'))&&Array.isArray(d.broadcasts)&&d.broadcastRegion==='FR');
 }
 window.TFMatchDetailsCore={...base,identify,valid,summaryUrl:r=>r.provider==='espn'&&id(r.event)&&r.league==='uefa.nations'?'/.netlify/functions/national-match-details?event='+r.event:base.summaryUrl(r)};
})();
