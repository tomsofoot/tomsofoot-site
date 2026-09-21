// Flux public ESPN limité à la Ligue des nations. Aucun secret ni écriture distante.
const catalog=require('./national-teams.json');
const ids=require('./national-espn-teams.json');
const teams=new Map(catalog.map(t=>[t.id,t]));
const LEAGUE='uefa.nations',NAME='Ligue des nations UEFA';
const endpoint='https://site.api.espn.com/apis/site/v2/sports/soccer/'+LEAGUE;
const integer=v=>v!==null&&v!==undefined&&v!==''&&Number.isInteger(Number(v))&&Number(v)>=0?Number(v):null;
const text=v=>typeof v==='string'?v.trim():'';
function team(t){const local=teams.get(ids[String(t.id)]);return{id:String(t.id),name:local?.name||text(t.displayName),logo:local?.logo||(/^https:\/\/a\.espncdn\.com\//.test(t.logo||'')?t.logo:'')};}
function status(s){
 const type=s?.type||{},name=type.name||'';
 const interrupted={STATUS_POSTPONED:['PST','Reporté'],STATUS_CANCELED:['CANC','Annulé'],STATUS_SUSPENDED:['SUSP','Suspendu'],STATUS_ABANDONED:['ABD','Arrêté']};
 if(interrupted[name])return{state:'interrupted',code:interrupted[name][0],label:interrupted[name][1],clock:''};
 if(type.state==='in')return{state:'live',code:'LIVE',label:name==='STATUS_HALFTIME'?'Mi-temps':'En cours',clock:text(s.displayClock)};
 if(type.state==='post')return{state:'post',code:'FT',label:'Terminé',clock:''};
 if(type.state==='pre')return{state:'pre',code:'NS',label:'À venir',clock:''};
 return{state:'interrupted',code:'INT',label:'État à confirmer',clock:''};
}
function events(details=[]){return details.flatMap((e,i)=>{
 let kind,label;
 if(e.redCard){kind='red';label='Carton rouge';}
 else if(e.yellowCard){kind='yellow';label='Carton jaune';}
 else if(e.scoringPlay&&e.scoreValue>0){kind='goal';label=e.ownGoal?'But contre son camp':e.penaltyKick?'But sur penalty':'But';}
 else return [];
 const players=(e.athletesInvolved||[]).map(p=>text(p.displayName)).filter(Boolean);
 return[{id:String(e.id||[e.clock?.value,e.team?.id,e.type?.id,i].join(':')),kind,label,minute:text(e.clock?.displayValue),team:String(e.team?.id||''),players,clock:integer(e.clock?.value),added:0,order:i}];
 }).sort((a,b)=>(a.clock??Infinity)-(b.clock??Infinity));}
function normalize(e,fetchedAt){
 const c=e.competitions?.[0],h=c?.competitors?.find(t=>t.homeAway==='home'),a=c?.competitors?.find(t=>t.homeAway==='away');
 if(!/^[1-9]\d{0,9}$/.test(String(e.id))||!h?.team?.id||!a?.team?.id||!Number.isFinite(Date.parse(e.date)))throw Error('invalid_fixture');
 const home=team(h.team),away=team(a.team),s=status(c.status||e.status),score=t=>s.state==='pre'?null:integer(t.score);
 const data={ref:{provider:'espn',event:String(e.id),league:LEAGUE,home:home.id,away:away.id},source:'ESPN',fetchedAt,date:e.date,league:NAME,home,away,status:s,homeScore:score(h),awayScore:score(a),venue:text(c.venue?.fullName),city:text(c.venue?.address?.city),referee:'',broadcasts:[],broadcastRegion:'FR',events:s.state==='pre'?[]:events(c.details),eventsAvailable:Array.isArray(c.details),penalties:{home:null,away:null}};
 return{data,card:{id:'espn:'+LEAGUE+':'+e.id,provider:'espn',leagueId:LEAGUE,league:NAME,leagueLogo:'assets/leagues/nations-league.png',homeId:home.id,awayId:away.id,home:home.name,away:away.name,homeLogo:home.logo,awayLogo:away.logo,ts:e.date,timeKnown:c.timeValid===true,time:c.timeValid===true?new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'}).format(new Date(e.date)):'Horaire à confirmer',status:s.code,detailStatus:s.label,detailClock:s.clock,gh:data.homeScore,ga:data.awayScore,venue:data.venue,city:data.city}};
}
function createFeed({fetcher=fetch,now=()=>Date.now()}={}){
 const years=new Map(),pending=new Map(),detailCache=new Map();
 async function json(url){const r=await fetcher(url,{signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('upstream_unavailable');return r.json();}
 async function year(y){
  const old=years.get(y),ttl=old?.rows.some(r=>r.data.status.state==='live')?30000:300000;
  if(old&&now()-old.at<ttl)return{...old,stale:false};
  if(!pending.has(y))pending.set(y,(async()=>{
   try{const raw=await json(endpoint+'/scoreboard?dates='+y+'&limit=1000');if(!Array.isArray(raw.events)||!raw.leagues?.some(l=>l.slug===LEAGUE))throw Error('invalid_feed');
    const result={at:now(),rows:raw.events.map(e=>normalize(e,new Date(now()).toISOString()))};years.set(y,result);return{...result,stale:false};
   }catch(error){if(old&&now()-old.at<86400000)return{...old,stale:true};throw error;}
  })().finally(()=>pending.delete(y)));
  return pending.get(y);
 }
 async function upcoming(){
  const start=now(),end=start+7*86400000,keys=[...new Set([new Date(start).getUTCFullYear(),new Date(end).getUTCFullYear()])];
  const batches=await Promise.all(keys.map(year));
  return{matches:batches.flatMap(b=>b.rows).filter(r=>r.data.status.state==='live'||r.data.status.state==='pre'&&Date.parse(r.card.ts)>=start&&Date.parse(r.card.ts)<=end).map(r=>r.card).sort((a,b)=>Date.parse(a.ts)-Date.parse(b.ts)),stale:batches.some(b=>b.stale),fetchedAt:new Date(Math.min(...batches.map(b=>b.at))).toISOString()};
 }
 async function detail(event){
  if(!/^[1-9]\d{0,9}$/.test(event))throw Error('invalid_fixture');
  let row=[...years.values()].flatMap(b=>b.rows).find(r=>r.data.ref.event===event);
  if(!row){await year(new Date(now()).getUTCFullYear());row=[...years.values()].flatMap(b=>b.rows).find(r=>r.data.ref.event===event);}
  if(!row)throw Error('not_found');
  const old=detailCache.get(event),ttl=old?.data.status.state==='live'?30000:300000;
  if(old&&now()-old.at<ttl)return{data:old.data,refreshAfter:ttl/1000};
  try{
   const raw=await json(endpoint+'/summary?event='+event),head=raw.header;
   if(String(head?.id)!==event)throw Error('fixture_mismatch');
   const c=head.competitions?.[0],result=normalize({...head,date:c?.date||head.date},new Date(now()).toISOString()).data;
   if(['home','away'].some(k=>result.ref[k]!==row.data.ref[k]))throw Error('fixture_mismatch');
   result.venue=text(raw.gameInfo?.venue?.fullName)||result.venue||row.data.venue;
   result.city=text(raw.gameInfo?.venue?.address?.city)||result.city||row.data.city;
   // Ne jamais déduire une chaîne française depuis la diffusion d'un autre pays.
   // Un arbitre n'est repris que si son rôle est explicitement identifié.
   const official=raw.gameInfo?.officials?.find(o=>o.type?.displayName==='Referee');
   result.referee=text(official?.displayName);
   detailCache.set(event,{at:now(),data:result});return{data:result,refreshAfter:result.status.state==='live'?30:300};
  }catch(error){return{data:old?.data||row.data,stale:true,error:'upstream_unavailable',refreshAfter:60};}
 }
 return{upcoming,detail};
}
module.exports={normalize,status,createFeed};
