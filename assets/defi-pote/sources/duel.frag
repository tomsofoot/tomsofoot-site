#version 330 core
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uJitter;
uniform vec3 uClashes;
const float PI=3.14159265359;
struct Hit{float d;float id;};
Hit obj(float d,float id){return Hit(d,id);}
Hit nearH(Hit a,Hit b){return a.d<b.d?a:b;}
float box(vec3 p,vec3 b){vec3 q=abs(p)-b;return length(max(q,0.0))+min(max(q.x,max(q.y,q.z)),0.0);}
float roundBox(vec3 p,vec3 b,float r){return box(p,b-vec3(r))-r;}
float cyl(vec3 p,float r,float h){vec2 q=abs(vec2(length(p.xz),p.y))-vec2(r,h);return min(max(q.x,q.y),0.0)+length(max(q,0.0));}
vec3 rz(vec3 p,float a){return vec3(cos(a)*p.x-sin(a)*p.y,sin(a)*p.x+cos(a)*p.y,p.z);}
vec3 ry(vec3 p,float a){return vec3(cos(a)*p.x+sin(a)*p.z,p.y,-sin(a)*p.x+cos(a)*p.z);}
float ease(float p){return 1.0-pow(1.0-clamp(p,0.0,1.0),3.0);}
float hitAngle(int i){return i==0?.69:i==1?.73:.78;}
float angleAt(float t){
 for(int i=0;i<3;i++){
  float impact=uClashes[i],start=i==0?0.0:uClashes[i-1]+.32;
  if(t<impact){float q=clamp((t-start)/(impact-start),0.0,1.0);return mix(.32,hitAngle(i),pow(q,3.0));}
  float age=t-impact;
  if(i<2&&age<.32)return mix(hitAngle(i),.32,ease(age/.32));
  if(i==2)return .78-.035*sin(age*31.0)*exp(-age*4.8);
 }
 return .78;
}
float diamondBlade(vec3 p){
 float width=.205*clamp((3.45-p.y)/.72,0.0,1.0);
 float side=abs(p.x)-width;
 float diamond=(abs(p.z)+abs(p.x)*.25-.061)*.95;
 return max(max(side,diamond),max(.15-p.y,p.y-3.45));
}
Hit sword(vec3 p,int side){
 float a=angleAt(uTime),sign=side==0?-1.0:1.0;
 vec3 pivot=vec3(sign*1.55,-1.18,side==0?.065:-.065);
 vec3 q=ry(rz(p-pivot,-sign*a),side==0?-.10:.10);
 Hit h=obj(diamondBlade(q),1.0+float(side)*.1);
 // Quillons, collar, leather binding and a metal pommel are genuine volumes.
 h=nearH(h,obj(roundBox(q-vec3(0,.035,0),vec3(.59,.115,.14),.055),2.0+float(side)*.1));
 h=nearH(h,obj(cyl(q-vec3(0,.12,0),.17,.11),2.0+float(side)*.1));
 h=nearH(h,obj(cyl(q-vec3(0,-.44,0),.125,.39),3.0+float(side)*.1));
 vec3 bind=q-vec3(0,-.44,0);float bands=max(cyl(bind,.132,.375),abs(mod(bind.y+.05,.115)-.0575)-.013);
 h=nearH(h,obj(bands,4.0));
 h=nearH(h,obj(cyl(q-vec3(0,-.83,0),.16,.065),2.0+float(side)*.1));
 vec3 pommel=q-vec3(0,-.98,0);
 h=nearH(h,obj(length(pommel*vec3(1,1.05,1.3))-.205,2.0+float(side)*.1));
 return h;
}
Hit map(vec3 p){vec3 q=(p-vec3(0,-.45,0))/.80;Hit h=nearH(sword(q,0),sword(q,1));h.d*=.80;return h;}
vec3 normAt(vec3 p){vec2 e=vec2(.0012,0);return normalize(vec3(map(p+e.xyy).d-map(p-e.xyy).d,map(p+e.yxy).d-map(p-e.yxy).d,map(p+e.yyx).d-map(p-e.yyx).d));}
float pulse(float t){float sum=0.0;for(int i=0;i<3;i++){float age=t-uClashes[i];if(age>=0.0)sum+=exp(-age*24.0);}return sum;}
vec3 metal(vec3 p,vec3 n,vec3 rd,float id){
 vec3 base=vec3(.42,.51,.60);float rough=.16,metalness=.98;
 if(id>1.5&&id<2.5){base=id<2.05?vec3(.58,.32,.065):vec3(.20,.30,.43);rough=.22;}
 if(id>2.5&&id<3.5){base=id<3.05?vec3(.035,.065,.09):vec3(.11,.045,.021);rough=.65;metalness=.06;}
 if(id>3.5){base=vec3(.19,.12,.055);rough=.45;metalness=.45;}
 vec3 l1=normalize(vec3(-3.5,5.0,5.0)-p),l2=normalize(vec3(4,1.0,4.0)-p);
 vec3 h1=normalize(l1-rd),h2=normalize(l2-rd);
 float d1=max(dot(n,l1),0.0),d2=max(dot(n,l2),0.0);
 float spec1=pow(max(dot(n,h1),0.0),90.0*(1.0-rough)+8.0);
 float spec2=pow(max(dot(n,h2),0.0),70.0*(1.0-rough)+8.0);
 vec3 reflection=reflect(rd,n);
 float strip1=pow(max(dot(reflection,normalize(vec3(-.55,.45,1))),0.0),20.0);
 float strip2=pow(max(dot(reflection,normalize(vec3(.75,.3,1))),0.0),32.0);
 float brush=1.0+.025*sin(p.y*330.0+p.x*41.0);
 vec3 color=base*(vec3(.10,.18,.27)+vec3(.65,.82,1.0)*d1*.42+vec3(.30,.50,.70)*d2*.32)*brush;
 vec3 f0=mix(vec3(.035),base,metalness);
 color+=f0*(spec1*2.1+spec2*1.2+strip1*2.0+strip2*.8);
 float fres=pow(1.0-max(dot(n,-rd),0.0),4.0);color+=vec3(.04,.18,.30)*fres;
 color+=vec3(.90,.69,.30)*pulse(uTime)*(.15+.65*max(dot(n,normalize(vec3(-p.xy,1))),0.0));
 color=clamp((color*(2.51*color+.03))/(color*(2.43*color+.59)+.14),0.0,1.0);
 return pow(color,vec3(1.0/2.2));
}
float seg(vec2 p,vec2 a,vec2 b){vec2 v=p-a,w=b-a;return length(v-w*clamp(dot(v,w)/dot(w,w),0.0,1.0));}
vec3 sparkField(vec2 pixel){
 vec3 result=vec3(0);
 for(int i=0;i<3;i++){
  float age=uTime-uClashes[i];if(age<0.0||age>.54)continue;
  float theta=hitAngle(i),cy=(-1.18+1.55/tan(theta))*.80-.45;
  vec2 origin=uResolution*.5+vec2(0,cy*1.70/8.0*uResolution.y);
  float radius=14.0+age*45.0,dist=length(pixel-origin);
  result+=vec3(.80,.87,1.0)*exp(-dist*dist/(radius*radius))*exp(-age*22.0)*2.7;
  result+=vec3(.35,.65,1.0)*exp(-abs(pixel.y-origin.y)/2.0)*exp(-abs(pixel.x-origin.x)/170.0)*exp(-age*30.0);
  for(int j=0;j<26;j++){
   float seed=float(j)+float(i)*35.0,dir=seed*2.399963;
   vec2 v=vec2(cos(dir),sin(dir))*(210.0+mod(seed*73.0,390.0));
   vec2 a=origin+v*age+vec2(0,-240.0*age*age);
   vec2 b=a-normalize(v)*(8.0+age*35.0);
   float d=seg(pixel,a,b),intensity=exp(-d*d*.65)*pow(1.0-age/.54,1.4);
   result+=vec3(1.0,.67,.20)*intensity;
  }
 }
 return result;
}
void main(){
 vec2 pixel=gl_FragCoord.xy+uJitter;
 // Navy and blue halo follow the framing and palette of the approved insert.
 vec2 center=vec2(uResolution.x*.52,uResolution.y*.42);
 vec2 q=(pixel-center)/vec2(390.0,510.0);
 float halo=exp(-dot(q,q)*1.3);
 vec3 color=vec3(.0,.026,.047)+vec3(0,.43,.70)*halo;
 color+=vec3(0,.08,.14)*exp(-length((pixel-center)/vec2(250.0,360.0))*2.0);
 vec2 xy=(pixel-uResolution*.5)/uResolution.y;
 vec3 ro=vec3(0,0,8.0),rd=normalize(vec3(xy,-1.7));
 float t=6.5;Hit h=obj(1e5,0.0);
 for(int i=0;i<92;i++){h=map(ro+rd*t);if(h.d<.0011||t>10.0)break;t+=h.d*.78;}
 if(t<=10.0){vec3 p=ro+rd*t;color=metal(p,normAt(p),rd,h.id);}
 color+=sparkField(pixel);
 fragColor=vec4(clamp(color,0.0,1.0),1);
}
