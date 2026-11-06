(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.TomsoDefiReference=factory()})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const WIDTH=1080,HEIGHT=1920,DURATION=8,FPS=60;
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const ease=x=>1-Math.pow(1-clamp(x),3);
const CHOICES=[1,2,3,5,7,10];
const GRID={x:38,y:1290,w:1004,h:394,r:68};
const TICKS=[.86,1.79,3.16];
const ELIMINATIONS=[{at:.86,indices:[0,2],fade:.12},{at:1.79,indices:[1,3],fade:.12},{at:3.16,indices:[4],fade:.08}];
const TIMELINE={fps:FPS,duration:DURATION,ticks:TICKS,reveal:3.25,clashes:[.86,1.79,3.16],amounts:CHOICES,demoResult:10,eliminations:ELIMINATIONS,buttonStyle:'segments',effects:['neon','light-trails','shockwaves','sparks','gold-reveal']};
function rounded(ctx,x,y,w,h,r,fill){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill()}
function text(ctx,s,x,y,size,color='#fff',weight=700,italic=false,align='center'){ctx.font=(italic?'italic ':'')+weight+' '+size+'px DefiSans,Arial,sans-serif';ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(s,x,y)}
function glow(ctx,x,y,r,color){let g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2)}
function poly(ctx,points,color){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.fillStyle=color;ctx.fill()}
function lock(ctx,x,y){ctx.save();ctx.strokeStyle='#667785';ctx.lineWidth=3.25;ctx.beginPath();ctx.arc(x,y-5,8,Math.PI,0);ctx.stroke();rounded(ctx,x-11,y-5,22,17,4,'#667785');ctx.restore()}
function activeIndex(t){return t>=ELIMINATIONS[2].at?5:-1}
function caseLight(t,index){
 for(const event of ELIMINATIONS){if(event.indices.includes(index))return 1-ease((t-event.at)/event.fade)}
 return 1;
}
function remainingIndices(t){return CHOICES.map((_,i)=>i).filter(i=>caseLight(t,i)>.001)}
function mixColor(a,b,u){
 const pa=parseInt(a.slice(1),16),pb=parseInt(b.slice(1),16);
 const c=[16,8,0].map(shift=>Math.round(((pa>>shift)&255)*(1-u)+((pb>>shift)&255)*u));
 return 'rgb('+c.join(',')+')';
}

function title(ctx,t){
 const appear=ease((t+.25)/.45),scale=1+.035*Math.sin(clamp(t/.40)*Math.PI)*(t<.4?1:0);
 ctx.save();ctx.translate(540,265);ctx.rotate(-.115);ctx.scale(scale,scale);ctx.transform(1,0,-.10,1,0,0);
 const font='italic 900 154px DefiSans,Arial,sans-serif';ctx.font=font;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
 let edge=ctx.createLinearGradient(-420,-120,420,120);edge.addColorStop(0,'#e9ec42');edge.addColorStop(.5,'#73fa8b');edge.addColorStop(1,'#2eea8f');
 ctx.shadowColor='#61ee8b';ctx.shadowBlur=13;ctx.lineWidth=5;ctx.strokeStyle=edge;ctx.strokeText('DÉFIE',0,-75);ctx.shadowBlur=0;ctx.fillStyle='#002b3c';ctx.fillText('DÉFIE',0,-75);
 ctx.font='italic 900 126px DefiSans,Arial,sans-serif';ctx.lineWidth=4;ctx.strokeText('TON POTE',0,65);ctx.fillStyle='#f4fff7';ctx.fillText('TON POTE',0,65);
 ctx.lineWidth=2;ctx.strokeStyle='#6df3a38c';ctx.beginPath();ctx.moveTo(-435,3);ctx.lineTo(410,3);ctx.stroke();
 poly(ctx,[[-460,-86],[-430,-111],[-403,-93],[-422,-89],[-432,-103]],'#dfe947');
 poly(ctx,[[370,103],[407,90],[431,97],[404,98]],'#4ce88d');ctx.restore();
}

function segmentLight(t,index,segment){
 // Chaque paire s'éteint ensemble ; ses six segments s'éteignent de gauche à droite.
 for(const event of ELIMINATIONS){
  if(event.indices.includes(index)){
   const step=event.fade/6;
   return 1-ease((t-event.at-segment*step)/step);
  }
 }
 return 1;
}

const noise=n=>{const v=Math.sin(n*127.13+311.7)*43758.5453;return v-Math.floor(v)};
function impactPower(t){
 let power=0;
 for(const at of TICKS){const age=t-at;if(age>=0&&age<.65)power=Math.max(power,Math.exp(-age*9))}
 return power;
}
function flare(ctx,x,y,size,color,alpha){
 ctx.save();ctx.globalAlpha=alpha;
 glow(ctx,x,y,size,color);
 const g=ctx.createLinearGradient(x-size*2,y,x+size*2,y);
 g.addColorStop(0,'transparent');g.addColorStop(.5,'#eaffff');g.addColorStop(1,'transparent');
 ctx.fillStyle=g;ctx.fillRect(x-size*2,y-1.7,size*4,3.4);
 ctx.restore();
}
function neonButton(ctx,t,index,x,y,w,h,light,winner){
 if(light<=.001)return;
 const accent=winner?'#ffd944':'#3dffb0';
 const pulse=.85+.15*Math.sin(t*5.4),hit=impactPower(t);
 ctx.save();ctx.beginPath();ctx.rect(x-12,y-12,w+24,h+24);ctx.clip();
 // Émission néon sur le chanfrein, sans zigzag électrique.
 ctx.globalAlpha=light*(.38+hit*.35);ctx.strokeStyle=accent;
 ctx.shadowColor=accent;ctx.shadowBlur=18+hit*12;ctx.lineWidth=1.8+hit;
 ctx.beginPath();ctx.roundRect(x+1.8,y+1.8,w-3.6,h-3.6,25);ctx.stroke();
 ctx.shadowBlur=0;
 ctx.beginPath();ctx.roundRect(x+2,y+2,w-4,h-4,24);ctx.clip();
 ctx.globalAlpha=light*pulse;
 const wash=ctx.createLinearGradient(x,y+45,x,y+h);
 wash.addColorStop(0,'transparent');wash.addColorStop(1,winner?'#ffcc343d':'#26ffac3d');
 rounded(ctx,x,y,w,h,26,wash);
 // Un reflet continu traverse ensemble les boutons encore actifs.
 const phase=(t*.68)%1,sx=x-w+phase*w*3;
 const sweep=ctx.createLinearGradient(sx-45,y,sx+55,y+h);
 sweep.addColorStop(0,'transparent');sweep.addColorStop(.46,'transparent');
 sweep.addColorStop(.55,winner?'#ffe58932':'#9dffdd26');sweep.addColorStop(.65,'transparent');sweep.addColorStop(1,'transparent');
 ctx.fillStyle=sweep;ctx.fillRect(x,y,w,h);
 ctx.restore();
 if(winner&&t<3.8){
  const age=t-3.16,fade=clamp(1-age/.64);
  flare(ctx,x+w-13,y+10,33+age*30,'#ffe978',fade*.85);
 }
}

function duelEffects(ctx,t){
 ctx.save();ctx.beginPath();ctx.rect(24,475,1032,805);ctx.clip();
 ctx.globalCompositeOperation='screen';
 const gold=t>=3.16,accent=gold?'#ffd652':'#48ffc1';
 // Particules d'ambiance et deux traînées orbitales autour du combat.
 for(let i=0;i<22;i++){
  const x=150+noise(i+10)*780,y=1250-((t*(35+noise(i+70)*48)+noise(i+25)*780)%780);
  const alpha=.13+.18*Math.sin(t*2+i)**2;
  ctx.globalAlpha=alpha;ctx.fillStyle=accent;
  ctx.beginPath();ctx.arc(x,y,1.4+noise(i+41)*1.6,0,Math.PI*2);ctx.fill();
 }
 ctx.lineCap='round';
 for(let i=0;i<2;i++){
  const angle=t*.8+i*Math.PI;
  ctx.globalAlpha=.21;ctx.strokeStyle=accent;ctx.lineWidth=2;ctx.shadowColor=accent;ctx.shadowBlur=12;
  ctx.beginPath();ctx.ellipse(540,930,355,244,-.18,angle,angle+1.15);ctx.stroke();
  const a=angle+1.15,px=Math.cos(a)*355,py=Math.sin(a)*244;
  const rx=px*Math.cos(-.18)-py*Math.sin(-.18),ry=px*Math.sin(-.18)+py*Math.cos(-.18);
  ctx.globalAlpha=.55;ctx.fillStyle='#d6fff1';ctx.beginPath();ctx.arc(540+rx,930+ry,2.5,0,Math.PI*2);ctx.fill();
 }
 ctx.shadowBlur=0;
 for(let n=0;n<TICKS.length;n++){
  const age=t-TICKS[n];if(age<-.18||age>.78)continue;
  const warm=n===2,color=warm?'#ffd65a':'#59ffd6';
  // Deux rubans lumineux accompagnent l'approche et le choc des lames.
  const slash=clamp((age+.18)/.18)*clamp(1-age/.32);
  if(slash>0){
   for(let side=0;side<2;side++){
    ctx.save();if(side){ctx.translate(1080,0);ctx.scale(-1,1)}
    ctx.globalAlpha=slash*.58;ctx.strokeStyle=color;ctx.lineWidth=3.6;
    ctx.shadowColor=color;ctx.shadowBlur=18;
    ctx.beginPath();ctx.moveTo(170,1100);ctx.bezierCurveTo(180,805,330,705,540,915);ctx.stroke();
    ctx.globalAlpha=slash*.14;ctx.lineWidth=14;ctx.stroke();ctx.restore();
   }
  }
  if(age<0)continue;
  const life=clamp(1-age/.78),radius=34+age*530;
  ctx.save();ctx.translate(540,915);
  ctx.globalAlpha=life*.78;ctx.strokeStyle=color;ctx.lineWidth=2.6;
  ctx.shadowColor=color;ctx.shadowBlur=17;
  ctx.beginPath();ctx.ellipse(0,0,radius,radius*.54,-.08,0,Math.PI*2);ctx.stroke();
  ctx.globalAlpha=life*.22;ctx.lineWidth=9;
  ctx.beginPath();ctx.ellipse(0,0,radius+16,(radius+16)*.54,-.08,0,Math.PI*2);ctx.stroke();
  ctx.shadowBlur=0;
  for(let j=0;j<32;j++){
   const angle=j*2.399+noise(n*100+j)*.4,speed=180+noise(j+n*80)*420;
   const dist=25+age*speed,px=Math.cos(angle)*dist,py=Math.sin(angle)*dist*.72+age*age*90;
   const tail=(9+noise(j+111)*30)*life;
   ctx.globalAlpha=life*(.45+noise(j+69)*.5);ctx.strokeStyle=j%4?color:'#fff7d3';ctx.lineWidth=j%5?1.7:3;
   ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px-Math.cos(angle)*tail,py-Math.sin(angle)*tail*.72);ctx.stroke();
  }
  ctx.restore();
  flare(ctx,540,915,110*Math.exp(-age*9)+22,color,Math.exp(-age*6));
 }
 ctx.restore();
}

function revealEffects(ctx,t){
 const age=t-3.25;if(age<0||age>1.25)return;
 const life=clamp(1-age/1.25);
 ctx.save();ctx.beginPath();ctx.rect(15,410,1050,870);ctx.clip();ctx.globalCompositeOperation='screen';
 ctx.globalAlpha=life*.6;glow(ctx,540,594,260+age*320,'#ffc63a70');
 ctx.strokeStyle='#ffe480';ctx.lineWidth=3;ctx.shadowColor='#ffd451';ctx.shadowBlur=23;
 ctx.globalAlpha=life*.85;ctx.beginPath();ctx.ellipse(540,594,120+age*720,65+age*370,-.045,0,Math.PI*2);ctx.stroke();
 ctx.shadowBlur=0;
 for(let i=0;i<44;i++){
  const a=i*2.399,dist=70+age*(280+noise(i+163)*420),x=540+Math.cos(a)*dist,y=594+Math.sin(a)*dist*.62;
  const tail=12+32*life;ctx.globalAlpha=life*(.35+noise(i+219)*.6);
  ctx.strokeStyle=i%4?'#ffe46b':'#fffce1';ctx.lineWidth=i%6?2:3.5;
  ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-Math.cos(a)*tail,y-Math.sin(a)*tail*.62);ctx.stroke();
 }
 ctx.restore();
}

function grid(ctx,t,max,fx=true){
 const {x,y,w,h,r}=GRID;
 rounded(ctx,x,y,w,h,r,'#20384dd9');
 const duel=t>=1.91&&t<3.16,decided=t>=3.16;
 for(let i=0;i<6;i++){
  const bx=x+48+(i%3)*305,by=y+48+Math.floor(i/3)*176,bw=276,bh=134;
  const eligible=CHOICES[i]<=max,light=eligible?caseLight(t,i):0;
  const finalist=duel&&(i===4||i===5),winner=decided&&i===5;
  // Surface satinée et chanfrein discret, comme le modèle 3 du comparatif.
  const face=ctx.createLinearGradient(bx,by,bx,by+bh);
  face.addColorStop(0,mixColor('#09141e',winner?'#25352e':'#1a3a4e',light));
  face.addColorStop(.48,mixColor('#08121b',winner?'#162a28':'#102b3d',light));
  face.addColorStop(1,mixColor('#071018','#0a1f2d',light));
  ctx.save();ctx.shadowColor='#00000042';ctx.shadowBlur=9;ctx.shadowOffsetY=5;
  rounded(ctx,bx,by,bw,bh,26,face);ctx.restore();
  ctx.save();ctx.beginPath();ctx.roundRect(bx+1,by+1,bw-2,bh-2,25);
  ctx.lineWidth=winner?2.1:1.5;
  ctx.strokeStyle=mixColor('#142530',winner?'#d9cb60':finalist?'#4b8a83':'#35576b',light);
  ctx.stroke();
  // Mince reflet supérieur, sans éclair ni halo autour des boutons.
  ctx.beginPath();ctx.moveTo(bx+27,by+2);ctx.lineTo(bx+bw-27,by+2);
  ctx.strokeStyle=mixColor('#142530',winner?'#e3d878':'#557487',light);
  ctx.lineWidth=1;ctx.stroke();ctx.restore();
  if(fx)neonButton(ctx,t,i,bx,by,bw,bh,light,winner);
  const color=mixColor('#293741','#f6f9fc',light);
  ctx.save();if(fx){ctx.shadowColor=winner?'#ffe35a70':'#57ffbd50';ctx.shadowBlur=8*light}
  text(ctx,String(CHOICES[i]),bx+bw*(CHOICES[i]===10?.39:.43),by+56,68,color,900);
  text(ctx,CHOICES[i]===1?'PT':'PTS',bx+bw*(CHOICES[i]===10?.76:.70),by+61,27,color,700);
  ctx.restore();
  for(let k=0;k<6;k++){
   const sx=bx+29+k*38,sy=by+103,power=eligible?segmentLight(t,i,k):0;
   const c=mixColor('#20323f',winner?(fx?'#ffe250':'#f4d44d'):(fx?'#68ffbb':'#65efad'),power);
   ctx.save();
   if(fx&&power>.001){
    ctx.beginPath();ctx.rect(bx-12,by-12,bw+24,bh+24);ctx.clip();
    ctx.shadowColor=winner?'#ffd332':'#32ffac';ctx.shadowBlur=22+impactPower(t)*12;
   }
   rounded(ctx,sx,sy,28,11,2.3,c);ctx.restore();
   if(power>.001){
    ctx.save();ctx.globalAlpha=power*.44;
    rounded(ctx,sx+1,sy+.7,26,2,1,'#e9fff5');ctx.restore();
   }
  }
  if(!eligible)lock(ctx,bx+bw-29,by+23);
 }
}

function banner(ctx,t){
 if(t<3.25)return;
 const enter=clamp((t-3.25)/.18),shift=(1-ease(enter))*-1150;
 ctx.save();ctx.translate(shift,0);
 const points=[[25,541],[1056,411],[1056,775],[25,705]];
 ctx.save();ctx.shadowColor='#b8e83d';ctx.shadowBlur=23*clamp((t-3.25)*4);poly(ctx,points,'#ffe00b');ctx.restore();
 ctx.save();ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.clip();
 for(let i=-2;i<7;i++)poly(ctx,[[i*290,900],[i*290+140,900],[i*290+540,350],[i*290+410,350]],'#ffed5480');
 ctx.restore();
 ctx.lineWidth=8;ctx.strokeStyle='#132b33';ctx.beginPath();ctx.moveTo(25,538);ctx.lineTo(1056,408);ctx.moveTo(25,707);ctx.lineTo(1056,777);ctx.stroke();
 poly(ctx,[[26,520],[174,499],[222,500],[59,530]],'#fff0a2');
 poly(ctx,[[813,419],[1056,386],[1056,399],[876,429]],'#eada0b');
 poly(ctx,[[36,551],[48,570],[54,548]],'#15313b');poly(ctx,[[1035,424],[1037,443],[1024,433]],'#15313b');
 poly(ctx,[[1026,745],[1041,759],[1008,750]],'#15313b');
 ctx.save();ctx.translate(540,594);ctx.rotate(-.045);ctx.transform(1,0,-.08,1,0,0);text(ctx,'10 PTS',0,0,148,'#122a30',900,true);ctx.restore();
 // A small number of particles follows the reveal, matching the reference's burst.
 const age=t-3.25;
 if(age<1.15){for(let i=0;i<15;i++){
  const angle=i*2.399,dist=60+age*(170+i*12),px=540+Math.cos(angle)*dist*1.5,py=590+Math.sin(angle)*dist*.65;
  ctx.globalAlpha=clamp(1-age/1.15);poly(ctx,[[px,py],[px+13,py+3],[px+25,py-5]],i%3?'#e9ee28':'#53ed8f');
 }}
 ctx.restore();
}

function render(ctx,t,asset,options={}){
 t=clamp(t,0,DURATION);const w=ctx.canvas.width,h=ctx.canvas.height,max=Math.min(10,options.a??35,options.b??35);
 ctx.save();ctx.scale(w/WIDTH,h/HEIGHT);ctx.clearRect(0,0,WIDTH,HEIGHT);
 let bg=ctx.createRadialGradient(540,1030,5,540,1000,1230);bg.addColorStop(0,'#0066aa');bg.addColorStop(.36,'#003552');bg.addColorStop(.75,'#00121e');bg.addColorStop(1,'#00050b');ctx.fillStyle=bg;ctx.fillRect(0,0,WIDTH,HEIGHT);
 if(asset){ctx.drawImage(asset,0,500,1080,788);}
 // The insert contains two 3D swords; the validated surrounding interface is unchanged.
 const top=ctx.createLinearGradient(0,500,0,570);top.addColorStop(0,'#001725');top.addColorStop(1,'#00172500');ctx.fillStyle=top;ctx.fillRect(0,0,1080,570);
 text(ctx,'TOUCHER POUR PASSER',540,1735,34,'#5d7282',400);
 text(ctx,'TOMSO  35 PTS     ·     ALEX  35 PTS',540,1798,29,'#9aabb5',700);
 text(ctx,'TOMSOFOOT',540,1870,63,'#b0b8c0',900,true);
 const fx=options.effects!==false;
 if(fx)duelEffects(ctx,t);
 title(ctx,t);grid(ctx,t,max,fx);
 if(fx)revealEffects(ctx,t);
 banner(ctx,t);
 ctx.restore();
}
return {WIDTH,HEIGHT,DURATION,FPS,CHOICES,TIMELINE,ELIMINATIONS,activeIndex,caseLight,segmentLight,remainingIndices,render};
});
