/* Front-end du championnat Jogadle. Ne calcule JAMAIS les points. */
(function(global){
  "use strict";
  const NAMES={ultimate:"Ligue Ultime",pro:"Ligue Pro",rookie:"Ligue Rookie",noob:"Ligue Noob"};
  const root=document.querySelector("#jg-league");
  if(!root)return;
  // Feature flag : championnat masqué en production tant qu'il n'est pas activé.
  if(!(global.JOGADLE_FLAGS&&global.JOGADLE_FLAGS.CHAMPIONSHIP_VISIBLE))return;
  const list=root.querySelector("#jg-ranking");
  const title=root.querySelector("#jg-league-title");
  let current="pro";
  let unsubscribe=null;

  function esc(v){
    const entities={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};
    return String(v??"").replace(/[&<>"']/g,c=>entities[c]);
  }
  function evoClass(v){return v>0?"up":v<0?"down":"";}
  function evoText(v){return v>0?"↑ +"+v:v<0?"↓ "+Math.abs(v):"—";}

  /* Compte à rebours « Fin de saison dans » — purement visuel (aucune règle du jeu,
     aucun lien avec le joueur du jour ni la remise à zéro de minuit). On égrène
     J / H / M / S vers un instant cible (state.seasonEnd) fourni par l'API. */
  const seasonLeftEl=root.querySelector("#jg-season-left");
  let seasonEndTs=null, seasonTimer=null;
  function fmtSeasonLeft(ms){
    if(ms<0)ms=0;
    const t=Math.floor(ms/1000);
    const d=Math.floor(t/86400), h=Math.floor((t%86400)/3600), m=Math.floor((t%3600)/60), s=t%60;
    const p=n=>String(n).padStart(2,"0");
    return d+" J "+p(h)+" H "+p(m)+" M "+p(s)+" S";
  }
  function tickSeason(){ if(seasonLeftEl&&seasonEndTs!=null)seasonLeftEl.textContent=fmtSeasonLeft(seasonEndTs-Date.now()); }
  function ensureSeasonTimer(){ if(!seasonTimer)seasonTimer=setInterval(tickSeason,1000); }
  function stopSeasonTimer(){ if(seasonTimer){clearInterval(seasonTimer);seasonTimer=null;} }

  /* ---------------------------------------------------------------------------
     Rendu du classement avec animation de réordonnancement FLIP (First, Last,
     Invert, Play). PUREMENT VISUEL : ne calcule aucun point, ne change aucune
     règle, aucune ligue, aucune donnée. Les <li> sont RÉUTILISÉS (clés = user_id)
     et ne sont jamais recréés brutalement : seule leur position glisse.
     - la ligne qui dépasse glisse verticalement vers sa nouvelle place ;
     - les lignes dépassées descendent simultanément ;
     - la ligne en mouvement passe au premier plan (z-index) avec une légère
       lueur violet/bleu ;
     - le NUMÉRO de position (et les repères de zone) ne bascule proprement
       qu'à la FIN de l'animation.
  --------------------------------------------------------------------------- */
  const FLIP_MS=620;                              // durée ~500–700 ms
  const FLIP_EASE="cubic-bezier(.65,0,.35,1)";    // accélération/décélération (pas linéaire)
  let lastLeague=null;                            // pour ne pas animer un changement de ligue

  function posClasses(pos){
    return {
      zone: pos<=5?"zone-up":pos>=16?"zone-down":"",
      cut: pos===5?"cut-promotion":pos===15?"cut-relegation":""
    };
  }
  // Applique proprement le numéro de position + repères de zone à une ligne.
  function applyPos(li,pos){
    const c=posClasses(pos);
    li.classList.toggle("zone-up",c.zone==="zone-up");
    li.classList.toggle("zone-down",c.zone==="zone-down");
    li.classList.toggle("cut-promotion",c.cut==="cut-promotion");
    li.classList.toggle("cut-relegation",c.cut==="cut-relegation");
    const posEl=li.__posEl||(li.__posEl=li.querySelector(".pos"));
    posEl.textContent=li.__hasData?pos:pos; // toujours le numéro de rang
    li.__pos=pos;
  }
  // Fige/termine immédiatement une animation en cours sur une ligne.
  function settle(li){
    if(li.__finalize){const f=li.__finalize;li.__finalize=null;f();}
    li.style.transition="";
    li.style.transform="";
    li.classList.remove("is-moving","up-move","down-move");
  }

  function render(rows,myId){
    const normalized=Array.from({length:20},(_,i)=>rows[i]||null);
    const animate=(lastLeague===current)&&list.children.length>0;

    // Indexe les <li> existants par clé (user_id ou emplacement pour les vides).
    const existing=new Map();
    Array.from(list.children).forEach(li=>{
      const k=li.getAttribute("data-key");
      if(k)existing.set(k,li);
    });
    // Termine d'abord toute animation encore en vol (sécurité si rendus rapprochés).
    existing.forEach(settle);

    // FIRST : positions actuelles (avant réordonnancement).
    const firstTop=new Map();
    if(animate)existing.forEach((li,k)=>{firstTop.set(k,li.getBoundingClientRect().top);});

    // Construit l'ordre désiré en réutilisant les nœuds (jamais de innerHTML global).
    const order=[];
    const seen=new Set();
    normalized.forEach((p,i)=>{
      const pos=i+1;
      const key=p?("u:"+p.user_id):("ph:"+i);
      seen.add(key);
      let li=existing.get(key);
      const isNew=!li;
      if(!li){
        li=document.createElement("li");
        li.setAttribute("data-key",key);
        li.innerHTML='<span class="pos"></span><span class="name"></span><span class="pts"></span><span class="evo"></span>';
        li.__posEl=li.querySelector(".pos");
      }
      // Contenu qui se met à jour tout de suite (les points peuvent bouger avant le dépassement).
      li.__hasData=!!p;
      const nameEl=li.__nameEl||(li.__nameEl=li.querySelector(".name"));
      const ptsEl=li.__ptsEl||(li.__ptsEl=li.querySelector(".pts"));
      const evoEl=li.__evoEl||(li.__evoEl=li.querySelector(".evo"));
      if(p){
        li.setAttribute("data-user-id",p.user_id);
        nameEl.textContent=p.display_name;
        // Badge actif « saison précédente » (champion / promu / rétrogradé) — un seul par ligne.
        if(p.active_badge_label){
          const badge=document.createElement("small");
          badge.className="jg-active-badge";
          badge.textContent=p.active_badge_label;
          nameEl.appendChild(badge);
        }
        ptsEl.textContent=Number(p.points||0).toLocaleString("fr-FR");
        const ev=Number(p.evolution||0);
        evoEl.textContent=evoText(ev);
        evoEl.className="evo "+evoClass(ev);
        li.classList.toggle("is-me",p.user_id===myId);
      }else{
        li.removeAttribute("data-user-id");
        nameEl.textContent="—";ptsEl.textContent="—";evoEl.textContent="—";evoEl.className="evo";
        li.classList.remove("is-me");
      }
      order.push({li,pos,isNew});
    });

    // Réordonne les nœuds dans le DOM selon l'ordre désiré (LAST).
    order.forEach(({li})=>list.appendChild(li));
    // Retire les nœuds qui ne sont plus présents.
    existing.forEach((li,k)=>{if(!seen.has(k))li.remove();});

    // Applique le numéro de position : immédiatement si pas d'animation ou nouvelle ligne ;
    // sinon on décide après mesure (différé pour les lignes qui bougent).
    const moving=[];
    order.forEach(({li,pos,isNew})=>{
      if(!animate||isNew){applyPos(li,pos);return;}
      const before=firstTop.get(li.getAttribute("data-key"));
      const after=li.getBoundingClientRect().top;
      const delta=(before==null)?0:(before-after);
      if(Math.abs(delta)<0.5){applyPos(li,pos);return;} // ne bouge pas → maj immédiate
      // Ligne en mouvement : garde son ANCIEN numéro/zone pendant le glissement.
      moving.push({li,pos,delta});
    });

    if(moving.length){
      // INVERT : on place chaque ligne mobile à son ancienne position visuelle.
      moving.forEach(({li,delta})=>{
        li.style.transition="none";
        li.style.transform="translateY("+delta+"px)";
        li.classList.add("is-moving");
        li.classList.add(delta>0?"up-move":"down-move"); // delta>0 = la ligne remonte (dépassement)
      });
      // PLAY : au cadre suivant, on relâche vers la position naturelle avec l'easing.
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        moving.forEach(({li,pos,delta})=>{
          const done=()=>{
            li.removeEventListener("transitionend",onEnd);
            li.style.transition="";
            li.style.transform="";
            li.classList.remove("is-moving","up-move","down-move");
            applyPos(li,pos);          // numéro définitif mis à jour PROPREMENT à la fin
            li.__finalize=null;
          };
          const onEnd=(e)=>{if(e.propertyName==="transform")done();};
          li.__finalize=done;          // filet de sécurité si transitionend n'arrive pas
          li.addEventListener("transitionend",onEnd);
          li.style.transition="transform "+FLIP_MS+"ms "+FLIP_EASE;
          li.style.transform="";
        });
      }));
    }

    lastLeague=current;
  }

  async function load(){
    title.textContent=NAMES[current];
    root.querySelectorAll("[data-league]").forEach(b=>b.classList.toggle("is-active",b.dataset.league===current));
    const api=global.JogadleLeaderboardAPI;
    if(!api){ render([],null); return; }
    const state=await api.getLeague(current);
    render(state.rows||[],state.myUserId||null);
    if(state.seasonName)root.querySelector("#jg-season-name").textContent=state.seasonName;
    if(state.seasonEnd!=null){ seasonEndTs=Number(state.seasonEnd); tickSeason(); ensureSeasonTimer(); }
    else{ stopSeasonTimer(); seasonEndTs=null; if(state.seasonLeft&&seasonLeftEl)seasonLeftEl.textContent=state.seasonLeft; }
    if(state.unranked){
      root.querySelector("#jg-unranked-rank").textContent="#"+state.unranked.rank;
      root.querySelector("#jg-unranked-points").textContent=Number(state.unranked.points||0).toLocaleString("fr-FR")+" pts";
      const desc=root.querySelector("#jg-unranked > div:first-child span");
      if(desc){
        const gap=Number(state.unranked.gapToTop20);
        desc.textContent=Number.isFinite(gap)&&gap>0
          ? "À "+gap.toLocaleString("fr-FR")+" pts du top 20 · continuez à jouer pour intégrer la Ligue Noob."
          : "Continuez à jouer pour intégrer la Ligue Noob.";
      }
    }
  }

  function subscribe(){
    if(typeof unsubscribe==="function")unsubscribe();
    const api=global.JogadleLeaderboardAPI;
    if(api?.subscribe)unsubscribe=api.subscribe(()=>load().catch(console.error));
  }
  root.querySelectorAll("[data-league]").forEach(btn=>btn.addEventListener("click",()=>{current=btn.dataset.league;load().catch(console.error);}));
  load().then(subscribe).catch(console.error);
  global.JogadleLeagueUI={refresh:load,open:()=>root.classList.add("is-open"),close:()=>root.classList.remove("is-open")};
})(window);
