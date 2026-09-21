(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.TFClubRecognition=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function normalize(value){
    return String(value||'').replace(/\b(?:[a-z]\.){2,}(?:[a-z]\.?)?/gi,s=>s.replace(/\./g,''))
      .replace(/œ/gi,'oe').replace(/ø/gi,'o').replace(/ß/g,'ss').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  }
  function createRecognizer(data){
    const clubs=new Map(),trie=new Map(),lookup=new Map();
    const suffixes=new Set(['fc','cf','sc','afc','ac','as','rc','rcd','sv','vfl','vfb','tsv','fsv','bsc','fk','sk','bk','if','ik','ff','kv','ksv','fg','bv','cd','sd','ud','us','c','r','cp','sl','gnk','sfp','pfk','cf','ssc','rcs','rfc']);
    function add(alias,id,explicit){
      const key=normalize(alias);if(!key)return;
      let node=trie;for(const token of key.split(' ')){if(!node.has(token))node.set(token,new Map());node=node.get(token);}
      if(!node.has('$'))node.set('$',new Map());const set=node.get('$');set.set(id,(set.get(id)||false)||explicit);
      if(!lookup.has(key))lookup.set(key,new Set());lookup.get(key).add(id);
    }
    for(const [id,name,sourceName,color,foreground,aliases] of data.clubs){
      clubs.set(id,{id,name,sourceName,color,foreground,logo:'/home/assets/clubs/'+id+'.png'});
      const words=normalize(sourceName).split(' ');
      // A rare one-word locality is not automatically treated as a football club.
      if(words.length>=2)add(sourceName,id,false);
      const short=[...words];while(short.length>1&&suffixes.has(short[0]))short.shift();while(short.length>1&&suffixes.has(short.at(-1)))short.pop();
      if(short.length>=2)add(short.join(' '),id,false);
      for(const alias of aliases||[])add(alias,id,true);
    }
    // Known names outside this European catalogue must not inherit a namesake's badge.
    ['Liverpool Fútbol Club','Liverpool Montevideo','Liverpool de Montevideo','Liverpool Uruguay','Barcelona SC','Barcelona Sporting Club','Barcelona Guayaquil','Arsenal de Sarandí','Arsenal Sarandí'].forEach(alias=>add(alias,null,true));
    function scan(text){
      const tokens=normalize(text).split(' ').filter(Boolean),hits=[];
      for(let start=0;start<tokens.length;start++){
        let node=trie;
        for(let end=start;end<Math.min(tokens.length,start+14);end++){
          node=node.get(tokens[end]);if(!node)break;
          const found=node.get('$');if(!found)continue;
          let candidates=[...found];if(candidates.some(([,explicit])=>explicit))candidates=candidates.filter(([,explicit])=>explicit);
          if(candidates.length===1)hits.push({id:candidates[0][0],start,end,length:end-start+1});
        }
      }
      // Keep the longest phrase first: Liverpool must not override City of Liverpool FC.
      hits.sort((a,b)=>b.length-a.length||a.start-b.start);
      const accepted=[];
      for(const hit of hits)if(!accepted.some(other=>hit.start<=other.end&&hit.end>=other.start))accepted.push(hit);
      accepted.sort((a,b)=>a.start-b.start);
      return [...new Set(accepted.map(hit=>hit.id).filter(Boolean))].map(id=>clubs.get(id));
    }
    function explicitClub(value){
      if(clubs.has(value))return clubs.get(value);
      const values=lookup.get(normalize(value));return values?.size===1?clubs.get([...values][0]):null;
    }
    function detect(article={}){
      if(article.club_badge===false)return {clubs:[],reason:'disabled'};
      if(Array.isArray(article.club_ids)){
        const mapped=article.club_ids.map(explicitClub).filter(Boolean);
        return {clubs:[...new Map(mapped.map(c=>[c.id,c])).values()],reason:'editorial'};
      }
      const title=scan(article.title);
      if(title.length>=2)return {clubs:title,reason:'title'};
      const summary=article.deck||article.excerpt||'',deck=scan(summary);
      const combined=[...new Map([...title,...deck].map(club=>[club.id,club])).values()];
      // A player-led headline can name only one side: the summary supplies the other.
      // More than two candidates in the summary may include unrelated historical comparisons.
      if(title.length){
        if(combined.length===2)return {clubs:combined,reason:'title-and-summary'};
        return {clubs:title,reason:'title'};
      }
      if(deck.length===2){
        // Two clubs in the same sentence describe a pair more reliably than scattered mentions.
        // Preserve dotted club abbreviations before identifying sentence boundaries.
        const sentences=String(summary).replace(/\b(?:[a-z]\.){2,}(?:[a-z]\.?)?/gi,s=>s.replace(/\./g,'')).split(/[.!?]+(?:\s+|$)|[\r\n]+/);
        if(sentences.some(sentence=>scan(sentence).length===2))return {clubs:deck,reason:'paired-summary'};
      }
      if(deck.length===1)return {clubs:deck,reason:'unique-summary'};
      return {clubs:[],reason:deck.length>1?'ambiguous-summary':'no-club'};
    }
    return {normalize,detect,scan,get:id=>clubs.get(id),size:clubs.size};
  }
  return {normalize,createRecognizer};
});
