// ===========================================================================
// Nightward — mesh library, terrain, and instanced base meshes
// ===========================================================================
var HF = (function(){
"use strict";

// ---- math -----------------------------------------------------------------
function sub(a,b){return[a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
function crs(a,b){return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function dt(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
function nz(a){var l=Math.hypot(a[0],a[1],a[2])||1;return[a[0]/l,a[1]/l,a[2]/l];}
function m4(){return new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);}
function mul(a,b){
  var o=new Float32Array(16);
  for(var c=0;c<4;c++)for(var r=0;r<4;r++){
    var s=0; for(var k=0;k<4;k++) s+=a[k*4+r]*b[c*4+k];
    o[c*4+r]=s;
  }
  return o;
}
function ortho(l,r,b,t,n,f){
  var o=m4();
  o[0]=2/(r-l);o[5]=2/(t-b);o[10]=-2/(f-n);
  o[12]=-(r+l)/(r-l);o[13]=-(t+b)/(t-b);o[14]=-(f+n)/(f-n);
  return o;
}
function lookAt(e,c,u){
  var z=nz(sub(e,c)),x=nz(crs(u,z)),y=crs(z,x),o=m4();
  o[0]=x[0];o[1]=y[0];o[2]=z[0];
  o[4]=x[1];o[5]=y[1];o[6]=z[1];
  o[8]=x[2];o[9]=y[2];o[10]=z[2];
  o[12]=-dt(x,e);o[13]=-dt(y,e);o[14]=-dt(z,e);
  return o;
}

// ---- rng / noise ----------------------------------------------------------
function rngFrom(seed){
  var a=seed>>>0;
  return function(){
    a|=0; a=a+0x6D2B79F5|0;
    var t=Math.imul(a^a>>>15,1|a);
    t=t+Math.imul(t^t>>>7,61|t)^t;
    return ((t^t>>>14)>>>0)/4294967296;
  };
}
function makeNoise(rnd){
  var p=new Uint8Array(512),perm=[];
  for(var i=0;i<256;i++) perm[i]=i;
  for(i=255;i>0;i--){var j=Math.floor(rnd()*(i+1)),t=perm[i];perm[i]=perm[j];perm[j]=t;}
  for(i=0;i<512;i++) p[i]=perm[i&255];
  function fade(t){return t*t*t*(t*(t*6-15)+10);}
  function grad(h,x,y){var u=(h&1)?x:-x,v=(h&2)?y:-y;return u+v;}
  return function(x,y){
    var X=Math.floor(x)&255,Y=Math.floor(y)&255;
    x-=Math.floor(x); y-=Math.floor(y);
    var u=fade(x),v=fade(y),A=p[X]+Y,B=p[X+1]+Y;
    return (1-v)*((1-u)*grad(p[A],x,y)+u*grad(p[B],x-1,y))
         +   v  *((1-u)*grad(p[A+1],x,y-1)+u*grad(p[B+1],x-1,y-1));
  };
}

// ---- mesh -----------------------------------------------------------------
// static layout : pos3 nrm3 col3 emit1                (10 floats)
// instanced     : pos3 nrm3 shade3 tint1 emit1        (11 floats)
// `flat` forces one colour on every face and `emitAll` forces one emissive
// level, both bypassing the per-face shading the primitives apply internally.
// That shading is why ID-colour picking used to misreport: a handle written as
// red=3 came back as 2 or 1 depending on which of its faces you clicked.
function Mesh(inst){
  this.v=[]; this.inst=!!inst; this.tint=0; this.flat=null; this.emitAll=null;
  this.tess=1; this.tex=0; this.texAmt=0;
}
Mesh.prototype.tri=function(a,b,c,col,emit){
  if(this.flat) col=this.flat;
  if(this.emitAll!==null&&this.emitAll!==undefined) emit=this.emitAll;
  var n=nz(crs(sub(c,a),sub(b,a))), e=emit||0, V=this.v, pts=[a,c,b];
  for(var i=0;i<3;i++){
    V.push(pts[i][0],pts[i][1],pts[i][2], n[0],n[1],n[2], col[0],col[1],col[2]);
    if(this.inst) V.push(this.tint);
    V.push(e);
  }
};
// Deterministic 0..1 from a point, so a surface looks the same every rebuild
// and never crawls when the camera moves.
function hash3(x,y,z){
  var n=Math.sin(x*127.1+y*311.7+z*74.7)*43758.5453;
  return n-Math.floor(n);
}
function lerp3(a,b,t){
  return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
}
// Surface treatment is baked into vertex colour at build time rather than
// sampled from a texture: no UVs to author, no atlas, and it costs the shader
// nothing. `tess` splits a face into a grid first, because a jitter applied to
// two big triangles reads as a blotch, not as a material.
Mesh.prototype.surf=function(col,i,j,t,p){
  var m=this.tex, amt=this.texAmt;
  if(!m||!amt) return col;
  var k=1;
  var h=hash3(p[0]*7.3+i*0.77, p[1]*7.3+j*0.31, p[2]*7.3);
  if(m===1)      k=1+(h-0.5)*amt;                             // stipple
  else if(m===2) k=1+((j%2)?-amt*0.5:amt*0.5)+(h-0.5)*amt*0.35;  // courses
  else if(m===3) k=1+((i%2)?-amt*0.5:amt*0.5)+(h-0.5)*amt*0.35;  // boards
  else if(m===4) k=1-amt*0.55*Math.pow(h,2.2);                // pitted
  if(k<0.05) k=0.05;
  return [col[0]*k,col[1]*k,col[2]*k];
};
Mesh.prototype.quad=function(a,b,c,d,col,emit){
  var t=this.tess|0;
  if(t<1) t=1;
  if(t<2&&!this.tex){ this.tri(a,b,c,col,emit); this.tri(a,c,d,col,emit); return; }
  // u runs a→b, v runs a→d, so on a box side u is across and v is up
  for(var i=0;i<t;i++){
    for(var j=0;j<t;j++){
      var u0=i/t,u1=(i+1)/t,v0=j/t,v1=(j+1)/t;
      var t00=lerp3(a,b,u0), b00=lerp3(d,c,u0);
      var t10=lerp3(a,b,u1), b10=lerp3(d,c,u1);
      var p00=lerp3(t00,b00,v0), p01=lerp3(t00,b00,v1);
      var p10=lerp3(t10,b10,v0), p11=lerp3(t10,b10,v1);
      var cc=this.surf(col,i,j,t,p00);
      this.tri(p00,p10,p11,cc,emit);
      this.tri(p00,p11,p01,cc,emit);
    }
  }
};
Mesh.prototype.stride=function(){ return this.inst?11:10; };
Mesh.prototype.count=function(){ return this.v.length/this.stride(); };
Mesh.prototype.data=function(){ return new Float32Array(this.v); };

function shade(c,k){ return [c[0]*k,c[1]*k,c[2]*k]; }
function jit(c,rnd,a){ var k=1+(rnd()-0.5)*(a||0.1); return [c[0]*k,c[1]*k,c[2]*k]; }

// A part's rotation is [pitch, yaw, roll] in radians, applied roll → pitch →
// yaw about the part's own origin. A plain number still means yaw, so every
// asset written before this kept working.
function xform(cx,cy,cz,rot){
  var rx=0,ry=0,rz=0;
  if(typeof rot==="number") ry=rot;
  else if(rot){ rx=rot[0]||0; ry=rot[1]||0; rz=rot[2]||0; }
  if(!rx&&!ry&&!rz) return function(x,y,z){ return [cx+x,cy+y,cz+z]; };
  var cX=Math.cos(rx),sX=Math.sin(rx),cY=Math.cos(ry),sY=Math.sin(ry),
      cZ=Math.cos(rz),sZ=Math.sin(rz);
  return function(x,y,z){
    var x1=x*cZ-y*sZ, y1=x*sZ+y*cZ, z1=z;
    var y2=y1*cX-z1*sX, z2=y1*sX+z1*cX;
    return [cx + x1*cY + z2*sY, cy + y2, cz - x1*sY + z2*cY];
  };
}

function box(M,cx,cy,cz,sx,sy,sz,rot,col,emit){
  var hx=sx/2,hz=sz/2,P=xform(cx,cy,cz,rot);
  var a=P(-hx,0,-hz),b=P(hx,0,-hz),c=P(hx,0,hz),d=P(-hx,0,hz);
  var e=P(-hx,sy,-hz),f=P(hx,sy,-hz),g=P(hx,sy,hz),h=P(-hx,sy,hz);
  M.quad(e,f,g,h,col,emit);
  M.quad(d,c,b,a,shade(col,.55),emit);
  M.quad(a,b,f,e,shade(col,.80),emit);
  M.quad(b,c,g,f,shade(col,.92),emit);
  M.quad(c,d,h,g,shade(col,.72),emit);
  M.quad(d,a,e,h,shade(col,.86),emit);
}

// Triangular prism: full height at -Z, tapering to nothing at +Z. Closed on
// every face, so it can never leak however it is rotated.
function wedge(M,cx,cy,cz,sx,sy,sz,rot,col,emit){
  var hx=sx/2,hz=sz/2,P=xform(cx,cy,cz,rot);
  var a=P(-hx,0,-hz),b=P(hx,0,-hz),c=P(hx,0,hz),d=P(-hx,0,hz);
  var e=P(-hx,sy,-hz),f=P(hx,sy,-hz);
  M.quad(d,c,b,a,shade(col,.55),emit);     // floor
  M.quad(a,b,f,e,shade(col,.80),emit);     // back wall
  M.quad(e,f,c,d,col,emit);                // slope
  M.tri(b,c,f,shade(col,.92),emit);        // +X end
  M.tri(d,a,e,shade(col,.86),emit);        // -X end
}

function cone(M,cx,cy,cz,r,h,seg,col,rot){
  var P=xform(cx,cy,cz,rot), prev=null, apex=P(0,h,0);
  for(var i=0;i<=seg;i++){
    var t=i/seg*Math.PI*2, p=P(Math.cos(t)*r,0,Math.sin(t)*r);
    if(prev) M.tri(prev,p,apex,shade(col,0.72+0.28*(0.5+0.5*Math.cos(t-2.2))));
    prev=p;
  }
}
function cyl(M,cx,cy,cz,r,h,seg,col,cap,rot){
  var P=xform(cx,cy,cz,rot), prev=null, ring=[];
  for(var i=0;i<=seg;i++){
    var t=i/seg*Math.PI*2, lo=P(Math.cos(t)*r,0,Math.sin(t)*r), hi=P(Math.cos(t)*r,h,Math.sin(t)*r);
    ring.push(hi);
    if(prev) M.quad(prev[0],lo,hi,prev[1],shade(col,0.70+0.30*(0.5+0.5*Math.cos(t-2.2))));
    prev=[lo,hi];
  }
  if(cap!==false) for(var j=1;j<ring.length-1;j++) M.tri(ring[0],ring[j],ring[j+1],col);
}

// A clean, closed solid: two slopes, two triangular ends, a soffit spanning the
// full overhang. `courses` optionally lays real slabs on each slope — each one a
// closed box, so shingles cannot open gaps however the roof is angled.
function gable(M,cx,cy,cz,sx,sy,sz,rot,col,courses,over){
  var hx=sx/2, hz=sz/2, P=xform(cx,cy,cz,rot);
  var ov=(over===undefined?0.20:over);
  var ez=hz+ov;                                   // eave line, past the walls
  var a=P(-hx,0,-ez), b=P(hx,0,-ez), c=P(hx,0,ez), d=P(-hx,0,ez);
  var r0=P(-hx,sy,0), r1=P(hx,sy,0);
  M.quad(d,c,b,a,shade(col,0.42));                // soffit
  M.quad(a,b,r1,r0,shade(col,1.00));              // -Z slope
  M.quad(c,d,r0,r1,shade(col,0.78));              // +Z slope
  M.tri(b,c,r1,shade(col,0.86));                  // +X end
  M.tri(d,a,r0,shade(col,0.86));                  // -X end
  var n=Math.max(0,Math.round(courses||0));
  if(!n) return;
  // Courses are closed slabs lying on the slope, each overlapping the one below.
  // Built in a frame of (across, up-slope, out-of-slope); the up-slope axis is
  // negated on the far side so both slopes stay the same handedness as box(),
  // which is what keeps every face wound outward.
  var run=Math.hypot(ez,sy), step=run/n, th=Math.min(0.09,step*0.36);
  for(var side=-1;side<=1;side+=2){
    var uz=-side*ez/run, uy=sy/run;      // up-slope
    var nz= side*sy/run, ny=ez/run;      // out of the slope
    for(var i=0;i<n;i++){
      var t=(i+0.5)/n, zc=side*ez*(1-t), yc=sy*t, hl=step*0.62;
      var S=(function(zc,yc){ return function(x,w,v){
        var ww=w*(-side);
        return P(x, yc+ww*uy+v*ny, zc+ww*uz+v*nz);
      };})(zc,yc);
      var a0=S(-hx,-hl,0), b0=S(hx,-hl,0), c0=S(hx,hl,0), d0=S(-hx,hl,0);
      var a1=S(-hx,-hl,th), b1=S(hx,-hl,th), c1=S(hx,hl,th), d1=S(-hx,hl,th);
      var sc=shade(col,(side<0?1.0:0.78)*((i%2)?1.0:0.90));
      M.quad(a1,b1,c1,d1,sc);
      M.quad(d0,c0,b0,a0,shade(sc,0.55));
      M.quad(a0,b0,b1,a1,shade(sc,0.80));
      M.quad(b0,c0,c1,b1,shade(sc,0.92));
      M.quad(c0,d0,d1,c1,shade(sc,0.72));
      M.quad(d0,a0,a1,d1,shade(sc,0.86));
    }
  }
}

// ---- palette --------------------------------------------------------------
// Register borrowed from They Are Billions: desaturated and somber, with red
// held back for the threat alone and warm light doing the only shouting.
var PAL={
  // ground
  grass:[0.228,0.258,0.165], grassDry:[0.310,0.298,0.196],
  path:[0.270,0.245,0.205], rock:[0.250,0.252,0.255], cliff:[0.160,0.163,0.170],
  // built
  timber:[0.235,0.185,0.130], timberL:[0.348,0.276,0.190],
  plaster:[0.458,0.450,0.422], stone:[0.312,0.314,0.314],
  thatch:[0.330,0.280,0.170],
  slate:[0.218,0.229,0.258],                  // roofs — cold, not red
  iron:[0.205,0.222,0.252], ironL:[0.300,0.325,0.360],
  brass:[0.440,0.330,0.150], brassL:[0.560,0.430,0.205],
  verd:[0.185,0.335,0.300],                   // aged copper
  soot:[0.115,0.118,0.128],
  // life
  leaf:[0.135,0.180,0.125], leafD:[0.098,0.140,0.100],
  trunk:[0.160,0.130,0.098],
  // threat — the only place saturated red is allowed
  flesh:[0.300,0.105,0.100], fleshD:[0.180,0.065,0.068],
  infect:[0.210,0.075,0.078],
  // legacy slots kept so older definitions still resolve
  tile:[0.290,0.150,0.105], tileDark:[0.215,0.115,0.088],
  cloth:[0.380,0.175,0.125], metal:[0.265,0.285,0.300], bone:[0.455,0.430,0.365]
};
var GLOW_WARM=[1.90,1.16,0.46];               // habitation, fire
var GLOW_COLD=[0.50,1.30,1.55];
var GLOW_SIG=[0.42,1.62,1.70];   // friendly signal lamp — reads against the horde's red               // machinery, boilers

// ---- world constants ------------------------------------------------------
var CELL=1.5, GN=34, PLAT=0.30;
var BUILD_R=11.4;                 // buildable radius, world units
var EXT=76, GRID=124;

function gx2w(gx){ return (gx-GN/2+0.5)*CELL; }
function w2gx(x){ return Math.floor(x/CELL + GN/2); }

// ---- terrain --------------------------------------------------------------
// Every shipped map is still one seed; GEN just names the constants that used
// to be inline, so the editor has something to turn. Defaults reproduce the
// original generator exactly.
var GEN_DEF={
  hill:4.60, rough:1.75, grain:0.55,           // noise amplitudes, coarse to fine
  freqL:0.028, freqM:0.072, freqH:0.170,       // and their scales
  plat:2.40, fall:9.00,                        // flat margin past the build ring, blend out
  buildR:11.40,
  dry:26.0,                                    // radius where grass gives way to dry
  nestN:2, nestR:16.0, nestDist:24.0,          // seeded nests: count, taint radius, distance out
  infNoise:0.30,                               // how ragged the tainted edge reads
  trees:520, scrub:420, growth:220
};
function genOf(g){
  var o={}, k;
  for(k in GEN_DEF) o[k]=(g&&g[k]!==undefined&&g[k]!==null)?g[k]:GEN_DEF[k];
  return o;
}
// Where the horde lives. A map may place these by hand; otherwise they are
// spread evenly around the settlement from the seed. Everything about the
// corruption on the ground is derived from them, so moving a nest moves the
// taint, the dead trees and the growths with it.
// Nests ring the whole settled area, so they stay clear of every base however
// many players are on the map.
function seedNests(seed,gen,centres){
  var G=genOf(gen), rnd=rngFrom((seed||1)*31337+7), out=[];
  var a0=rnd()*Math.PI*2, n=Math.max(1,G.nestN|0);
  var reach=0, C=centres&&centres.length?centres:[[0,0]];
  for(var q=0;q<C.length;q++) reach=Math.max(reach,Math.hypot(C[q][0],C[q][1]));
  var base=Math.max(G.nestDist, reach+G.buildR+9);
  for(var i=0;i<n;i++){
    var a=a0+i*(Math.PI*2/n)+(rnd()-0.5)*0.5;
    var d=base*(0.90+rnd()*0.20);
    // No health here: the balance table owns that number, and a copy baked into
    // the seeded map was silently winning over it.
    out.push({x:Math.cos(a)*d, z:Math.sin(a)*d, r:G.nestR*(0.85+rnd()*0.3),
              share:1/n});
  }
  return out;
}
function makeTerrain(seed,gen,nests,centres){
  var G=genOf(gen);
  var rnd=rngFrom(seed), noise=makeNoise(rngFrom(seed^0x9e37));
  var seedA=rnd()*Math.PI*2;                   // drawn to keep the rest of the
  var CS=(centres&&centres.length)?centres:[[0,0]];          // sequence stable
  var NS=(nests&&nests.length)?nests:seedNests(seed,gen,CS);
  var flatR=G.buildR+G.plat;

  // distance to the nearest settlement, so every base sits on level ground
  function nearC(x,z){
    var best=1e9;
    for(var i=0;i<CS.length;i++){
      var d=Math.hypot(x-CS[i][0],z-CS[i][1]);
      if(d<best) best=d;
    }
    return best;
  }
  function h(x,z){
    var d=nearC(x,z);
    var n=noise(x*G.freqL,z*G.freqL)*G.hill
         +noise(x*G.freqM,z*G.freqM)*G.rough
         +noise(x*G.freqH,z*G.freqH)*G.grain;
    if(d<flatR) return PLAT;
    var t=Math.min(1,(d-flatR)/Math.max(0.5,G.fall));
    return PLAT*(1-t)+n*t;
  }
  // Taint is the strongest claim any nest has on this spot. The cull keeps
  // ground well clear of every nest exactly clean, and cheap.
  function infAt(x,z){
    var best=0;
    for(var i=0;i<NS.length;i++){
      var nn=NS[i], dx=x-nn.x, dz=z-nn.z, r=nn.r||G.nestR;
      var d=Math.sqrt(dx*dx+dz*dz);
      if(d>=r*1.35) continue;
      var t=1-d/r
           +noise(x*0.10,z*0.10)*G.infNoise+noise(x*0.27,z*0.27)*(G.infNoise*0.5);
      if(t>best) best=t;
    }
    return Math.max(0,Math.min(1,best));
  }
  return {h:h, infAt:infAt, nests:NS, seedA:seedA, rnd:rnd, noise:noise, G:G,
          centres:CS, nearC:nearC};
}

function buildStatic(T,props){
  var M=new Mesh(false), rnd=T.rnd, noise=T.noise, h=T.h;
  var G=T.G||GEN_DEF;
  // hand-placed additions and erased circles, both authored in the map editor
  var addP=(props&&props.add)||[], cutP=(props&&props.remove)||[];
  function erased(x,z){
    for(var q=0;q<cutP.length;q++){
      var c=cutP[q];
      if((x-c.x)*(x-c.x)+(z-c.z)*(z-c.z) < c.r*c.r) return true;
    }
    return false;
  }
  var half=GRID/2, step=(EXT*2)/GRID, H=[];
  for(var i=0;i<=GRID;i++){
    H[i]=[];
    for(var j=0;j<=GRID;j++) H[i][j]=h((i-half)*step,(j-half)*step);
  }
  for(i=0;i<GRID;i++){
    for(var j2=0;j2<GRID;j2++){
      var x0=(i-half)*step,z0=(j2-half)*step,x1=x0+step,z1=z0+step;
      var a=[x0,H[i][j2],z0],b=[x1,H[i+1][j2],z0],
          c=[x1,H[i+1][j2+1],z1],d=[x0,H[i][j2+1],z1];
      var mx=(x0+x1)/2,mz=(z0+z1)/2,dd=Math.hypot(mx,mz);
      var dh=Math.max(Math.abs(a[1]-c[1]),Math.abs(b[1]-d[1]));
      var col;
      if((T.nearC?T.nearC(mx,mz):dd)<G.buildR+1.0) col=jit(PAL.grass,rnd,0.07);
      else if(dh>1.15) col=jit(PAL.cliff,rnd,0.15);
      else if(dh>0.62) col=jit(PAL.rock,rnd,0.12);
      else {
        var wet=noise(mx*0.19,mz*0.19);
        var base=(dd>G.dry||a[1]>3.0)?PAL.grassDry:PAL.grass;
        col=jit([base[0]*(1+wet*0.2),base[1]*(1+wet*0.16),base[2]*(1+wet*0.1)],rnd,0.08);
      }
      var inf=T.infAt(mx,mz);
      if(inf>0.04){
        var k=Math.min(1,inf*1.05)*(0.72+0.28*(0.5+0.5*noise(mx*0.33,mz*0.33)));
        col=[col[0]*(1-k)+PAL.infect[0]*k,col[1]*(1-k)+PAL.infect[1]*k,col[2]*(1-k)+PAL.infect[2]*k];
      }
      M.quad(a,b,c,d,col);
    }
  }
  // trees + rocks outside the buildable plateau
  function tree(x,z,s,dead){
    var y=h(x,z)-0.1, hgt=(2.0+rnd()*1.7)*s;
    cyl(M,x,y,z,0.20*s,hgt*0.62,6,jit(PAL.trunk,rnd,0.2));
    if(dead){
      for(var b=0;b<4;b++){
        var ba=rnd()*Math.PI*2;
        box(M,x+Math.cos(ba)*0.35*s,y+hgt*0.45+b*0.22,z+Math.sin(ba)*0.35*s,
            1.0*s,0.11,0.11,ba,jit(PAL.trunk,rnd,0.2));
      }
      return;
    }
    var lay=2+Math.floor(rnd()*2);
    for(var l=0;l<lay;l++){
      var f=1-l*0.28;
      cone(M,x,y+hgt*(0.50+l*0.30),z,(1.35*s)*f,(1.5*s)*f,7,jit(l%2?PAL.leafD:PAL.leaf,rnd,0.18));
    }
  }
  var nearC=T.nearC||function(x,z){ return Math.hypot(x,z); };
  for(var t=0;t<(G.trees|0);t++){
    var ang=rnd()*Math.PI*2, rad=G.buildR+3.4+Math.pow(rnd(),0.72)*(EXT-G.buildR-12);
    var tx=Math.cos(ang)*rad, tz=Math.sin(ang)*rad;
    if(nearC(tx,tz)<G.buildR+3.0) continue;
    if(erased(tx,tz)) continue;
    tree(tx,tz,0.75+rnd()*0.6, rnd()<T.infAt(tx,tz)*0.95);
  }
  for(t=0;t<(G.scrub|0);t++){
    ang=rnd()*Math.PI*2; rad=Math.sqrt(rnd())*30+G.buildR*0.2;
    tx=Math.cos(ang)*rad; tz=Math.sin(ang)*rad;
    if(nearC(tx,tz)<G.buildR+0.6 && rnd()<0.8) continue;
    if(erased(tx,tz)) continue;
    var y=h(tx,tz)-0.05;
    if(rnd()<0.75){
      var cc=T.infAt(tx,tz)>0.45?jit(PAL.fleshD,rnd,0.25):jit(PAL.leafD,rnd,0.3);
      for(var b2=0;b2<3;b2++){
        var a3=rnd()*Math.PI*2,rr=rnd()*0.16;
        cone(M,tx+Math.cos(a3)*rr,y,tz+Math.sin(a3)*rr,0.055+rnd()*0.05,0.2+rnd()*0.26,4,cc);
      }
    } else {
      box(M,tx,y,tz,0.24+rnd()*0.3,0.13+rnd()*0.16,0.22+rnd()*0.26,rnd()*3,jit(PAL.rock,rnd,0.24));
    }
  }
  // corruption growths on the infected side
  for(t=0;t<(G.growth|0);t++){
    ang=rnd()*Math.PI*2; rad=G.buildR+2+rnd()*34;
    tx=Math.cos(ang)*rad; tz=Math.sin(ang)*rad;
    if(rnd()>T.infAt(tx,tz)*1.15) continue;
    if(nearC(tx,tz)<G.buildR+1.5) continue;
    if(erased(tx,tz)) continue;
    var yy=h(tx,tz)-0.05;
    cone(M,tx,yy,tz,0.16+rnd()*0.26,0.5+rnd()*1.9,5,jit(PAL.flesh,rnd,0.3));
    if(rnd()<0.3) cyl(M,tx,yy,tz,0.42+rnd()*0.3,0.16,6,jit(PAL.fleshD,rnd,0.25));
  }
  // hand-placed scenery last, so an erase circle never eats what you put down
  for(t=0;t<addP.length;t++){
    var ap=addP[t], ay=h(ap.x,ap.z)-0.05, as=ap.s||1;
    if(ap.k==="tree"||ap.k==="dead") tree(ap.x,ap.z,as,ap.k==="dead");
    else if(ap.k==="rock")
      box(M,ap.x,ay,ap.z,0.34*as,0.22*as,0.30*as,ap.r||0,jit(PAL.rock,rnd,0.24));
    else if(ap.k==="scrub"){
      var sc=jit(PAL.leafD,rnd,0.3);
      for(var b3=0;b3<3;b3++){
        var a4=rnd()*Math.PI*2, r4=rnd()*0.16;
        cone(M,ap.x+Math.cos(a4)*r4,ay,ap.z+Math.sin(a4)*r4,
             (0.055+rnd()*0.05)*as,(0.2+rnd()*0.26)*as,4,sc);
      }
    } else if(ap.k==="growth"){
      cone(M,ap.x,ay,ap.z,(0.16+rnd()*0.26)*as,(0.5+rnd()*1.9)*as,5,jit(PAL.flesh,rnd,0.3));
      cyl(M,ap.x,ay,ap.z,(0.42+rnd()*0.3)*as,0.16,6,jit(PAL.fleshD,rnd,0.25));
    }
  }
  return M;
}

// ---- declarative asset catalogue ------------------------------------------
// Every asset is DATA: an ordered list of parts, each one a primitive with a
// position, size, rotation and optional repeat pattern. The Library edits this
// list directly; the game builds meshes from the same list.
var W=[1,1,1];

// ---- repeat expansion -----------------------------------------------------
// A part can stamp itself several times. Repeats keep the definition small
// without giving up per-part editing: you tune one post, all of them move.
function partRot(pt){
  if(pt.rot) return [pt.rot[0]||0, pt.rot[1]||0, pt.rot[2]||0];
  return [0, pt.r||0, 0];              // legacy: a bare number meant yaw
}
function expandRep(pt){
  var p=pt.p||[0,0,0], r=partRot(pt), rep=pt.rep;
  if(!rep||!rep.mode||rep.mode==="none") return [{p:p,r:r,i:0,n:1}];
  var out=[], i, n, s;
  var jog=(rep.jog||0), rise=(rep.rise||0), taper=(rep.taper===undefined?1:rep.taper);
  if(rep.mode==="mirrorX"){
    // mirroring about X flips yaw and roll, leaves pitch alone
    for(s=-1;s<=1;s+=2) out.push({p:[p[0]*s,p[1],p[2]],
      r:(s<0?[r[0],-r[1],-r[2]]:r),i:(s<0?0:1),n:2,k:1});
  } else if(rep.mode==="mirrorZ"){
    for(s=-1;s<=1;s+=2) out.push({p:[p[0],p[1],p[2]*s],
      r:(s<0?[-r[0],-r[1],r[2]]:r),i:(s<0?0:1),n:2,k:1});
  } else if(rep.mode==="mirrorXZ"){
    var idx=0;
    for(var a=-1;a<=1;a+=2) for(var b=-1;b<=1;b+=2)
      out.push({p:[p[0]*a,p[1],p[2]*b],
        r:[a*b<0?-r[0]:r[0], (a<0)!==(b<0)?-r[1]:r[1], a<0?-r[2]:r[2]],
        i:idx++,n:4,k:1});
  } else if(rep.mode==="linX"||rep.mode==="linZ"||rep.mode==="linY"){
    n=Math.max(1,Math.round(rep.n||3));
    var st=(rep.step===undefined?0.3:rep.step);
    for(i=0;i<n;i++){
      var off=(rep.mode==="linY")?i*st:(i-(n-1)/2)*st;
      var q=[p[0],p[1],p[2]];
      if(rep.mode==="linX") q[0]+=off;
      else if(rep.mode==="linZ") q[2]+=off;
      else q[1]+=off;
      q[1]+=(i%2)*jog + i*rise;
      out.push({p:q,r:r,i:i,n:n,k:Math.pow(taper,i)});
    }
  } else if(rep.mode==="ring"){
    n=Math.max(1,Math.round(rep.n||4));
    var rad=(rep.r===undefined?1:rep.r), a0=(rep.a0||0)*Math.PI/180;
    for(i=0;i<n;i++){
      var ang=a0+i/n*Math.PI*2;
      out.push({p:[p[0]+Math.cos(ang)*rad, p[1]+i*rise+(i%2)*jog, p[2]+Math.sin(ang)*rad],
                r:[r[0], r[1]+(rep.face===false?0:ang), r[2]], i:i, n:n, k:Math.pow(taper,i)});
    }
  } else {
    out.push({p:p,r:r,i:0,n:1,k:1});
  }
  return out;
}

// ---- primitives the editor can place --------------------------------------
function ringMesh(M,cx,cy,cz,r1,weight,seg,col){
  var r0=Math.max(0.001,r1-weight);
  for(var i=0;i<seg;i++){
    var a=i/seg*Math.PI*2, b=(i+1)/seg*Math.PI*2;
    M.quad([cx+Math.cos(a)*r0,cy,cz+Math.sin(a)*r0],[cx+Math.cos(a)*r1,cy,cz+Math.sin(a)*r1],
           [cx+Math.cos(b)*r1,cy,cz+Math.sin(b)*r1],[cx+Math.cos(b)*r0,cy,cz+Math.sin(b)*r0],col,1.0);
  }
}
function quadMesh(M,cx,cy,cz,sx,sz,rot,col,emit){
  var hx=sx/2,hz=sz/2,co=Math.cos(rot||0),si=Math.sin(rot||0);
  function P(x,z){ return [cx+x*co-z*si, cy, cz+x*si+z*co]; }
  M.quad(P(-hx,-hz),P(hx,-hz),P(hx,hz),P(-hx,hz),col,emit);
}
function gridMesh(M,col){
  var t=0.034, n=GN;
  for(var i=0;i<=n;i++){
    var p=(i-n/2)*CELL;
    if(Math.abs(p)>BUILD_R+CELL) continue;
    var ext=Math.sqrt(Math.max(0,(BUILD_R+0.4)*(BUILD_R+0.4)-p*p));
    if(ext<0.4) continue;
    M.quad([p-t,0,-ext],[p+t,0,-ext],[p+t,0,ext],[p-t,0,ext],col,1.0);
    M.quad([-ext,0,p-t],[ext,0,p-t],[ext,0,p+t],[-ext,0,p+t],col,1.0);
  }
}

// ---- part emitter ---------------------------------------------------------
// A part may anchor its Y to another part, so "cap sits on post" survives a
// height change instead of needing both numbers kept in sync by hand.
function resolveParts(list){
  var out=[], byId={}, i;
  for(i=0;i<list.length;i++){
    var p=list[i];
    if(p.anchorY && p.anchorY.to && p.anchorY.to!==p.id && byId[p.anchorY.to]){
      var t=byId[p.anchorY.to];
      var base=t.p[1] + (p.anchorY.mode==="bottom" ? 0
                        : ((t.s&&t.s[1]!==undefined)?t.s[1]:0));
      var q={};
      for(var k in p) q[k]=p[k];
      q.p=[p.p[0], base+(p.anchorY.off||0), p.p[2]];
      p=q;
    }
    byId[p.id]=p;
    out.push(p);
  }
  return out;
}
function anchoredY(list,pt){
  var r=resolveParts(list);
  for(var i=0;i<r.length;i++) if(r[i].id===pt.id) return r[i].p[1];
  return pt.p[1];
}

// Named surfaces, and the finishes the shader knows how to light.
var TEX_MODES=[["none","Smooth"],["stipple","Stipple"],["courses","Courses"],
               ["boards","Boards"],["pitted","Pitted"]];
var TEXI={none:0,stipple:1,courses:2,boards:3,pitted:4};
var MAT_MODES=[["Matte","even, no highlight"],["Chalk","plaster, thatch, dust"],
               ["Satin","waxed timber, cloth"],["Metal","iron, brass, glass"]];

function emitPart(M,pt,override,forceEmit){
  if(pt.off) return;
  var reps=expandRep(pt);
  var baseShade=(pt.shade===undefined?1:pt.shade);
  var s=pt.s||[1,1,1];
  for(var j=0;j<reps.length;j++){
    var t=reps[j], k=(t.k===undefined?1:t.k);
    var sh=baseShade*(1+((pt.rep&&pt.rep.altShade)?((t.i%2)?pt.rep.altShade:0):0));
    var e=0;
    if(forceEmit) e=1.0;
    else if(pt.emit) e=pt.ecol?2.0:1.0;
    // A part normally takes one of the asset's two tint slots. `col` overrides
    // that with an absolute colour, flagged to the shader as tint slot 2.
    var abs=(!override&&e<1.5&&pt.col)?pt.col:null;
    var col=override||(e>1.5?pt.ecol:shade(abs||W,sh));
    var sx=s[0]*k, sy=s[1]*k, sz=(s[2]===undefined?s[0]:s[2])*k;
    M.tint=override?0:(abs?2:(pt.tint||0));
    // one colour and one emissive level for the whole part, so neither the
    // pick ID nor an emissive material is diluted by face shading
    M.flat=override||null;
    // finish rides in the top bits of the emissive channel — no new vertex
    // attribute, so the buffer layout and every existing asset stay put
    M.emitAll=e+(override?0:(Math.round(pt.mat||0)*8));
    if(override){ M.tess=1; M.tex=0; M.texAmt=0; }
    else {
      M.tex=TEXI[pt.tex]||0;
      M.texAmt=M.tex?(pt.texAmt===undefined?0.35:pt.texAmt):0;
      M.tess=Math.max(1,Math.min(8,Math.round(pt.tess||(M.tex?3:1))));
    }
    switch(pt.prim){
      case "box":   box(M,t.p[0],t.p[1],t.p[2],sx,sy,sz,t.r,col,e); break;
      case "wedge": wedge(M,t.p[0],t.p[1],t.p[2],sx,sy,sz,t.r,col,e); break;
      case "gable": gable(M,t.p[0],t.p[1],t.p[2],sx,sy,sz,t.r,col,
                          pt.courses||0,(pt.over===undefined?0.20:pt.over)); break;
      case "cone":  cone(M,t.p[0],t.p[1],t.p[2],sx,sy,Math.max(3,Math.round(pt.seg||6)),col,t.r); break;
      case "cyl":   cyl(M,t.p[0],t.p[1],t.p[2],sx,sy,Math.max(3,Math.round(pt.seg||6)),col,pt.cap!==false,t.r); break;
      case "ring":  ringMesh(M,t.p[0],t.p[1],t.p[2],sx,(pt.weight===undefined?0.015:pt.weight),Math.max(8,Math.round(pt.seg||96)),col); break;
      case "quad":  quadMesh(M,t.p[0],t.p[1],t.p[2],sx,sz,(t.r&&t.r[1])||0,col,1.0); break;
      case "grid":  gridMesh(M,col); break;
    }
    M.flat=null; M.emitAll=null; M.tess=1; M.tex=0; M.texAmt=0;
  }
  M.tint=0;
}

// ---- asset registry -------------------------------------------------------
// `parts` is the shipped definition. The Library may hold an override list
// (same shape); buildAsset merges by using the override wholesale when present.
var ASSETS=[
{ id:"hall", name:"Town Hall", group:"Structures",
  colA:PAL.plaster, colB:PAL.slate, scale:1.0,
  note:"The objective. 3×3 footprint (4.5 units), impassable. Timber-framed over a stone base course, with a banded door and shuttered windows — the vocabulary every other building borrows.",
  slots:["A — plaster (walls, stone)","B — slate (roof, iron, banner)"],
  parts:[
    {id:"plinth", name:"Stone plinth",  prim:"box", p:[0,0,0],          s:[4.50,0.32,4.50], shade:0.60},
    {id:"course", name:"Base course",   prim:"box", p:[0,0.30,0],       s:[4.08,0.46,4.08], shade:0.74},
    {id:"walls",  name:"Walls",         prim:"box", p:[0,0.30,0],       s:[3.90,1.85,3.90], shade:1.00},

    {id:"footing",name:"Post footings", prim:"box", p:[1.88,0.28,1.88], s:[0.56,0.40,0.56], shade:0.66,
       rep:{mode:"mirrorXZ"}},
    {id:"posts",  name:"Corner posts",  prim:"box", p:[1.88,0.66,1.88], s:[0.36,1.20,0.36], shade:0.58,
       rep:{mode:"mirrorXZ"}},
    {id:"capital",name:"Post capitals", prim:"box", p:[1.88,1.86,1.88], s:[0.54,0.22,0.54], shade:0.70,
       anchorY:{to:"posts", mode:"top", off:0}, rep:{mode:"mirrorXZ"}},
    {id:"beltZ",  name:"Belt rail · front/back", prim:"box", p:[0,1.44,1.96], s:[3.92,0.15,0.10],
       shade:0.62, rep:{mode:"mirrorZ"}},
    {id:"beltX",  name:"Belt rail · sides",      prim:"box", p:[1.96,1.44,0], s:[0.10,0.15,3.92],
       shade:0.62, rep:{mode:"mirrorX"}},

    {id:"plate",  name:"Top plate",     prim:"box", p:[0,2.00,0],       s:[4.14,0.17,4.14], shade:0.95},
    {id:"roof",   name:"Roof",          prim:"gable", p:[0,2.06,0],     s:[4.50,1.85,4.50], tint:1, courses:7, over:0.26},
    {id:"fascia", name:"Eave board",    prim:"box", p:[0,2.02,2.42],    s:[4.86,0.21,0.15],
       tint:1, shade:0.70, rep:{mode:"mirrorZ"}},
    {id:"barge",  name:"Barge board",   prim:"box", p:[2.28,2.02,0],    s:[0.15,0.21,4.72],
       tint:1, shade:0.62, rep:{mode:"mirrorX"}},

    {id:"chimney",name:"Chimney",       prim:"box", p:[1.30,2.15,1.10], s:[0.52,1.36,0.52], shade:0.56},
    {id:"chimcap",name:"Chimney cap",   prim:"box", p:[1.30,3.51,1.10], s:[0.70,0.16,0.70], shade:0.70,
       anchorY:{to:"chimney", mode:"top", off:0}},

    {id:"step",   name:"Door step",     prim:"box", p:[0,0.30,2.06],    s:[1.46,0.20,0.44], shade:0.68},
    {id:"djamb",  name:"Door jambs",    prim:"box", p:[0.62,0.48,1.98], s:[0.19,1.26,0.15], shade:0.58,
       rep:{mode:"mirrorX"}},
    {id:"dlintel",name:"Door lintel",   prim:"box", p:[0,1.66,1.98],    s:[1.52,0.24,0.17], shade:0.66},
    {id:"door",   name:"Doorway glow",  prim:"box", p:[0,0.48,1.95],    s:[1.05,1.18,0.09],
       emit:true, ecol:GLOW_WARM},
    {id:"dband",  name:"Door bands",    prim:"box", p:[0,0.78,2.01],    s:[1.07,0.12,0.06],
       tint:1, shade:0.38, rep:{mode:"linY", n:2, step:0.60}},
    {id:"banner", name:"Banner",        prim:"box", p:[0,1.14,2.11],    s:[0.38,0.80,0.05],
       shade:0.92},

    {id:"sillF",  name:"Window sills · front", prim:"box", p:[1.30,0.86,2.03], s:[0.78,0.13,0.28],
       shade:0.72, rep:{mode:"mirrorX"}},
    {id:"surrF",  name:"Window surrounds · front", prim:"box", p:[1.30,0.97,1.98], s:[0.72,0.76,0.10],
       shade:0.60, rep:{mode:"mirrorX"}},
    {id:"paneF",  name:"Window panes · front", prim:"box", p:[1.30,1.03,2.01], s:[0.52,0.58,0.09],
       emit:true, ecol:GLOW_WARM, rep:{mode:"mirrorX"}},
    {id:"mullF",  name:"Window mullions · front", prim:"box", p:[1.30,1.03,2.06], s:[0.09,0.62,0.05],
       tint:1, shade:0.46, rep:{mode:"mirrorX"}},

    {id:"sillS",  name:"Window sills · sides", prim:"box", p:[2.03,0.86,1.20], s:[0.28,0.13,0.78],
       shade:0.72, rep:{mode:"mirrorXZ"}},
    {id:"surrS",  name:"Window surrounds · sides", prim:"box", p:[1.98,0.97,1.20], s:[0.10,0.76,0.72],
       shade:0.60, rep:{mode:"mirrorXZ"}},
    {id:"paneS",  name:"Window panes · sides", prim:"box", p:[2.01,1.03,1.20], s:[0.09,0.58,0.52],
       emit:true, ecol:GLOW_WARM, rep:{mode:"mirrorXZ"}},
    {id:"mullS",  name:"Window mullions · sides", prim:"box", p:[2.06,1.03,1.20], s:[0.05,0.62,0.09],
       tint:1, shade:0.46, rep:{mode:"mirrorXZ"}}
  ]},

{ id:"tower", name:"Watchtower", group:"Structures",
  colA:PAL.timberL, colB:PAL.iron, scale:0.70,
  note:"13 damage every 0.42 s at the nearest attacker within 6.6 units — deliberately short, so a tower covers an approach rather than the whole map. Drawn at 0.70 scale in play.",
  slots:["A — timberL (frame)","B — iron (cap)"],
  parts:[
    {id:"base",  name:"Base pad",   prim:"box", p:[0,0,0],       s:[2.00,0.30,2.00], shade:0.60},
    {id:"legs",  name:"Legs",       prim:"box", p:[0.72,0.26,0.72], s:[0.26,3.50,0.26], shade:0.85,
       rep:{mode:"mirrorXZ"}},
    {id:"brace", name:"Mid brace",  prim:"box", p:[0,1.72,0],    s:[1.70,0.16,1.70], shade:0.70},
    {id:"plat",  name:"Platform",   prim:"box", p:[0,3.76,0],    s:[2.50,0.30,2.50], shade:1.00},
    {id:"railZ", name:"Railing ±Z", prim:"box", p:[0,4.06,1.17], s:[2.50,0.62,0.16], shade:0.80,
       rep:{mode:"mirrorZ"}},
    {id:"railX", name:"Railing ±X", prim:"box", p:[1.17,4.06,0], s:[0.16,0.62,2.50], shade:0.80,
       rep:{mode:"mirrorX"}},
    {id:"roof",  name:"Roof",       prim:"cone", p:[0,4.68,0],   s:[1.85,1.35], seg:4, tint:1},
    {id:"brazier",name:"Brazier",   prim:"box", p:[0.78,4.06,0.78], s:[0.34,0.34,0.34],
       emit:true, ecol:GLOW_WARM}
  ]},

{ id:"wall", name:"Palisade Run", group:"Structures",
  colA:PAL.timber, colB:PAL.iron, scale:1.0,
  note:"Half a cell, growing from the centre toward +X. A wall cell emits one run per connected neighbour, so corners, tees and crossings build themselves.",
  slots:["A — timber","B — iron (banding)"],
  parts:[
    {id:"sill",  name:"Sill",  prim:"box", p:[0.45,0,0], s:[0.60,0.22,0.46], shade:0.58},
    {id:"posts", name:"Posts", prim:"cyl", p:[0.45,0.18,0], s:[0.168,1.65], seg:6, cap:false, shade:0.90,
       link:"postRow",
       rep:{mode:"linX", n:2, step:0.30, jog:0.10, altShade:0.10}},
    {id:"caps",  name:"Post caps", prim:"cone", p:[0.45,1.83,0], s:[0.168,0.30], seg:6, shade:1.05,
       link:"postRow", anchorY:{to:"posts", mode:"top", off:0},
       rep:{mode:"linX", n:2, step:0.30, jog:0.10}},
    {id:"rail",  name:"Iron band", prim:"box", p:[0.465,1.06,0.13], s:[0.63,0.15,0.12],
       tint:1, shade:0.95}
  ]},

{ id:"wallpost", name:"Palisade Post", group:"Structures",
  colA:PAL.timber, colB:PAL.iron, scale:1.0,
  note:"The hub at every wall cell's centre. Slightly stouter than a run post so junctions read as corners rather than kinks.",
  slots:["A — timber","B — iron (cap, footing)"],
  parts:[
    {id:"pad",  name:"Footing", prim:"box", p:[0,0,0],    s:[0.48,0.22,0.48], tint:1, shade:0.80},
    {id:"post", name:"Post",    prim:"cyl", p:[0,0.18,0], s:[0.185,1.78], seg:7, cap:false, shade:1.00},
    {id:"cap",  name:"Iron cap", prim:"cone", p:[0,1.96,0], s:[0.185,0.34], seg:7,
       tint:1, shade:1.05, anchorY:{to:"post", mode:"top", off:0}}
  ]},

{ id:"gate", name:"Gate", group:"Structures",
  colA:PAL.timberL, colB:PAL.iron, scale:1.0,
  note:"Path cost 2 — cheaper than open ground, so the swarm prefers to walk through it.",
  slots:["A — timberL (frame)","B — iron (hood, plating)"],
  parts:[
    {id:"sill",  name:"Sill",   prim:"box", p:[0,0,0],       s:[1.50,0.22,1.10], shade:0.58},
    {id:"posts", name:"Posts",  prim:"box", p:[0.62,0.18,0], s:[0.34,2.35,0.44], shade:0.82,
       rep:{mode:"mirrorX"}},
    {id:"lintel",name:"Lintel", prim:"box", p:[0,2.53,0],    s:[1.70,0.28,0.58], shade:0.95},
    {id:"hood",  name:"Hood",   prim:"box", p:[0,2.81,0],    s:[1.95,0.22,0.85], tint:1},
    {id:"doors", name:"Doors",  prim:"box", p:[0,0.18,0],    s:[1.05,1.85,0.16], shade:0.66},
    {id:"brace", name:"Brace",  prim:"box", p:[0,0.95,0.10], s:[1.05,0.14,0.06], shade:0.45}
  ]},

{ id:"ballista", name:"Ballista", group:"Structures",
  colA:PAL.timberL, colB:PAL.iron, scale:0.78,
  note:"Slow, heavy, splashing. One bolt every 1.75 s out to 9.6 units: 105 damage on the target and 70% of that falling off across a 2.4 unit blast. Targets the heaviest thing in reach rather than the nearest, so it answers brutes and packed runners and wastes itself on stragglers.",
  slots:["A — timberL (frame, bed)","B — iron (limbs, banding)"],
  parts:[
    {id:"pad",   name:"Base pad",   prim:"box", p:[0,0,0],          s:[2.30,0.32,2.30], shade:0.58},
    {id:"legs",  name:"Legs",       prim:"box", p:[0.80,0.28,0.80], s:[0.32,1.90,0.32], shade:0.82,
       rep:{mode:"mirrorXZ"}},
    {id:"brace", name:"Cross brace",prim:"box", p:[0,1.06,0.80],    s:[1.92,0.16,0.14], shade:0.62,
       rep:{mode:"mirrorZ"}},
    {id:"deck",  name:"Deck",       prim:"box", p:[0,2.14,0],       s:[2.60,0.28,2.60], shade:1.00},
    {id:"mount", name:"Turntable",  prim:"cyl", p:[0,2.42,0],       s:[0.52,0.34], seg:8,
       tint:1, shade:0.78},
    {id:"bed",   name:"Bolt bed",   prim:"box", p:[0,2.72,0.10],    s:[0.46,0.26,2.30], shade:0.96},
    {id:"limbs", name:"Bow limbs",  prim:"box", p:[0.86,2.90,-0.42], s:[1.30,0.18,0.24], r:0.38,
       tint:1, shade:1.00, rep:{mode:"mirrorX"}},
    {id:"stock", name:"Stock",      prim:"box", p:[0,2.90,-0.86],   s:[0.40,0.34,0.62], shade:0.70},
    {id:"bolt",  name:"Loaded bolt",prim:"box", p:[0,2.98,0.62],    s:[0.15,0.15,1.85], shade:1.08},
    {id:"tip",   name:"Bolt head",  prim:"cone",p:[0,2.98,1.54],    s:[0.16,0.42], seg:4,
       tint:1, shade:1.10, r:0.79},
    {id:"lamp",  name:"Sight lamp", prim:"box", p:[0.62,2.86,-0.72], s:[0.22,0.24,0.22],
       emit:true, ecol:GLOW_WARM}
  ]},

{ id:"brazier", name:"Brazier", group:"Structures",
  colA:PAL.stone, colB:PAL.iron, scale:1.05,
  note:"No attack. Every tower and ballista within 4.8 units reloads 22% faster, and the fire throws the brightest light pool on the field. Stacks to two — a third adds light but no speed.",
  slots:["A — stone (footing, column)","B — iron (bowl, straps)"],
  parts:[
    {id:"foot",  name:"Footing",   prim:"box", p:[0,0,0],    s:[1.10,0.26,1.10], shade:0.60},
    {id:"step",  name:"Step",      prim:"box", p:[0,0.24,0], s:[0.82,0.20,0.82], shade:0.74},
    {id:"column",name:"Column",    prim:"cyl", p:[0,0.42,0], s:[0.34,2.05], seg:7, shade:1.00},
    {id:"strap", name:"Iron strap",prim:"box", p:[0,1.02,0], s:[0.68,0.14,0.68],
       tint:1, shade:0.90},
    {id:"bowl",  name:"Fire bowl", prim:"cyl", p:[0,1.84,0], s:[0.64,0.40], seg:8,
       tint:1, shade:1.05, anchorY:{to:"column", mode:"top", off:0}},
    {id:"coals", name:"Coals",     prim:"box", p:[0,2.20,0], s:[0.92,0.14,0.92],
       emit:true, ecol:[2.30,1.05,0.34]},
    {id:"flame", name:"Flame",     prim:"cone",p:[0,2.28,0], s:[0.46,0.86], seg:5,
       emit:true, ecol:[2.55,1.42,0.52]}
  ]},

{ id:"barracks", name:"Barracks", group:"Structures",
  colA:PAL.timber, colB:PAL.slate, scale:0.72,
  note:"Houses three soldiers. They muster the moment you place it, so you can walk them into position during the build phase, and it retrains one loss at a time for as long as it stands.",
  slots:["A — timber (walls, posts)","B — slate (roof, banner)"],
  parts:[
    {id:"pad",    name:"Ground pad",  prim:"box", p:[0,0,0],          s:[2.40,0.26,1.90], shade:0.58},
    {id:"walls",  name:"Walls",       prim:"box", p:[0,0.24,0],       s:[2.10,1.20,1.60], shade:1.00},
    {id:"posts",  name:"Corner posts",prim:"box", p:[1.02,0.24,0.78], s:[0.18,1.25,0.18], shade:0.62,
       rep:{mode:"mirrorXZ"}},
    {id:"plate",  name:"Top plate",   prim:"box", p:[0,1.42,0],       s:[2.24,0.12,1.74], shade:0.88},
    {id:"roof",   name:"Roof",        prim:"gable", p:[0,1.48,0],     s:[2.40,0.95,1.90], tint:1, courses:5, over:0.22},
    {id:"rack",   name:"Weapon rack", prim:"box", p:[-1.32,0.24,0],   s:[0.16,1.05,1.30], shade:0.70},
    {id:"spears", name:"Racked spears",prim:"cyl",p:[-1.32,0.60,-0.45], s:[0.052,1.25], seg:5,
       shade:0.92, rep:{mode:"linZ", n:4, step:0.30, jog:0.06}},
    {id:"step",   name:"Door step",   prim:"box", p:[0,0.24,0.90],    s:[0.98,0.15,0.28], shade:0.68},
    {id:"djamb",  name:"Door jambs",  prim:"box", p:[0.44,0.34,0.81], s:[0.15,0.94,0.12], shade:0.56,
       rep:{mode:"mirrorX"}},
    {id:"dlintel",name:"Door lintel", prim:"box", p:[0,1.26,0.81],    s:[1.06,0.17,0.14], shade:0.64},
    {id:"door",   name:"Doorway glow",prim:"box", p:[0,0.34,0.79],    s:[0.74,0.92,0.08],
       emit:true, ecol:GLOW_WARM},
    {id:"dband",  name:"Door bands",  prim:"box", p:[0,0.60,0.84],    s:[0.76,0.09,0.05],
       tint:1, shade:0.42, rep:{mode:"linY", n:2, step:0.44}},
    {id:"banner", name:"Banner",      prim:"box", p:[-0.72,0.86,0.86],s:[0.34,0.64,0.05], shade:1.16},
    {id:"wsill",  name:"Window sills",prim:"box", p:[0.78,0.72,0.86], s:[0.46,0.09,0.18], shade:0.72,
       rep:{mode:"mirrorX"}},
    {id:"wsurr",  name:"Window surrounds",prim:"box",p:[0.78,0.80,0.82],s:[0.42,0.44,0.09], shade:0.58,
       rep:{mode:"mirrorX"}},
    {id:"wpane",  name:"Window panes",prim:"box", p:[0.78,0.84,0.85], s:[0.28,0.32,0.08],
       emit:true, ecol:GLOW_WARM, rep:{mode:"mirrorX"}},
    {id:"lamp",   name:"Muster lamp", prim:"box", p:[0.94,1.30,0.84], s:[0.20,0.22,0.20],
       emit:true, ecol:GLOW_SIG}
  ]},

{ id:"archery", name:"Archery Range", group:"Structures",
  colA:PAL.timberL, colB:PAL.thatch, scale:0.72,
  note:"Houses three archers. Same muster-and-retrain rule as the barracks — archers out-range everything you own but fold the moment something reaches them.",
  slots:["A — timberL (frame)","B — thatch (canopy, butts)"],
  parts:[
    {id:"pad",    name:"Ground pad",  prim:"box", p:[0,0,0],          s:[2.40,0.26,1.90], shade:0.58},
    {id:"posts",  name:"Canopy posts",prim:"cyl", p:[0.98,0.24,0.72], s:[0.13,1.55], seg:6, shade:0.86,
       rep:{mode:"mirrorXZ"}},
    {id:"canopy", name:"Canopy",      prim:"box", p:[0,1.79,0],       s:[2.34,0.20,1.86], tint:1,
       anchorY:{to:"posts", mode:"top", off:0}},
    {id:"bench",  name:"Shooting bench",prim:"box",p:[0,0.24,-0.56],  s:[2.00,0.62,0.42], shade:0.74},
    {id:"quivers",name:"Quivers",     prim:"cyl", p:[-0.80,0.86,-0.56], s:[0.13,0.42], seg:6,
       shade:0.95, rep:{mode:"linX", n:3, step:0.52}},
    {id:"shafts", name:"Arrow shafts",prim:"cyl", p:[-0.80,1.24,-0.56], s:[0.035,0.34], seg:4,
       shade:1.05, anchorY:{to:"quivers", mode:"top", off:0},
       rep:{mode:"linX", n:3, step:0.52}},
    {id:"butts",  name:"Straw butts", prim:"cyl", p:[0.62,0.24,0.66], s:[0.40,0.66], seg:7,
       tint:1, shade:0.90, rep:{mode:"linX", n:2, step:-0.92}},
    {id:"rings",  name:"Target mark", prim:"box", p:[0.62,0.66,0.66], s:[0.30,0.30,0.30],
       emit:true, ecol:[1.70,0.62,0.34], rep:{mode:"linX", n:2, step:-0.92}},
    {id:"lamp",   name:"Muster lamp", prim:"box", p:[0.98,1.56,0.72], s:[0.20,0.22,0.20],
       emit:true, ecol:GLOW_SIG}
  ]},

{ id:"cottage", name:"Cottage", group:"Structures",
  colA:PAL.plaster, colB:PAL.thatch, scale:0.66,
  note:"Houses two workers. They wake up the moment you place it and go idle until you give them a pile to work; it rebuilds a lost worker for as long as it stands.",
  slots:["A — plaster (walls)","B — thatch (roof)"],
  parts:[
    {id:"pad",    name:"Ground pad", prim:"box", p:[0,0,0],          s:[2.05,0.24,1.75], shade:0.58},
    {id:"walls",  name:"Walls",      prim:"box", p:[0,0.22,0],       s:[1.72,1.05,1.42], shade:1.00},
    {id:"posts",  name:"Corner posts",prim:"box",p:[0.82,0.22,0.68], s:[0.15,1.08,0.15], shade:0.55,
       rep:{mode:"mirrorXZ"}},
    {id:"plate",  name:"Top plate",  prim:"box", p:[0,1.25,0],       s:[1.86,0.11,1.56], shade:0.86},
    {id:"roof",   name:"Roof",       prim:"gable",p:[0,1.30,0],      s:[2.05,0.86,1.75], tint:1, courses:5, over:0.20},
    {id:"chimney",name:"Chimney",    prim:"box", p:[0.58,1.36,0.42], s:[0.32,0.95,0.32], shade:0.52},
    {id:"step",   name:"Door step",  prim:"box", p:[0,0.22,0.80],    s:[0.76,0.14,0.26], shade:0.68},
    {id:"djamb",  name:"Door jambs",  prim:"box", p:[0.33,0.32,0.72], s:[0.13,0.82,0.11], shade:0.58,
       rep:{mode:"mirrorX"}},
    {id:"dlintel",name:"Door lintel", prim:"box", p:[0,1.10,0.72],    s:[0.82,0.15,0.13], shade:0.66},
    {id:"door",   name:"Doorway glow",prim:"box", p:[0,0.32,0.70],    s:[0.54,0.78,0.08],
       emit:true, ecol:GLOW_WARM},
    {id:"dband",  name:"Door band",   prim:"box", p:[0,0.62,0.75],    s:[0.56,0.08,0.05],
       tint:1, shade:0.44},
    {id:"wsill",  name:"Window sill", prim:"box", p:[-0.55,0.58,0.76],s:[0.50,0.09,0.19], shade:0.72},
    {id:"wsurr",  name:"Window surround",prim:"box",p:[-0.55,0.66,0.72],s:[0.46,0.48,0.09], shade:0.60},
    {id:"wpane",  name:"Window pane", prim:"box", p:[-0.55,0.70,0.75],s:[0.32,0.36,0.08],
       emit:true, ecol:GLOW_WARM},
    {id:"wmull",  name:"Window mullion",prim:"box",p:[-0.55,0.70,0.79],s:[0.06,0.38,0.04],
       tint:1, shade:0.46}
  ]},

{ id:"nest", name:"Nest", group:"Structures",
  colA:[0.300,0.105,0.100], colB:[0.185,0.070,0.072], scale:1.0,
  note:"Where a wave comes from. Taints the ground around it, and stops spawning for good once it is pulled down — the only target worth marching your line out to.",
  slots:["A — flesh","B — dark tissue"],
  parts:[
    {id:"base",  name:"Mound",     prim:"cyl",  p:[0,0,0],      s:[1.45,0.55], seg:9, shade:0.72,
       tex:"pitted", texAmt:0.45, tess:3},
    {id:"body",  name:"Body",      prim:"cone", p:[0,0.45,0],   s:[1.15,1.75], seg:7, shade:1.00,
       tex:"stipple", texAmt:0.30, tess:3},
    {id:"lip",   name:"Maw lip",   prim:"cyl",  p:[0,1.70,0],   s:[0.52,0.28], seg:8, shade:0.62, tint:1},
    {id:"maw",   name:"Maw",       prim:"cyl",  p:[0,1.86,0],   s:[0.36,0.14], seg:8,
       emit:true, ecol:[2.60,0.30,0.16]},
    {id:"spine", name:"Spines",    prim:"cone", p:[0.95,0.10,0], s:[0.16,0.95], seg:5, shade:0.58,
       rot:[0,0,-0.42], rep:{mode:"ring", n:6, r:0.95}},
    {id:"vent",  name:"Vents",     prim:"cone", p:[0.52,0.62,0], s:[0.20,0.42], seg:5, shade:0.80,
       tint:1, rot:[0,0,-0.75], rep:{mode:"ring", n:4, r:0.52, a0:40}}
  ]},

{ id:"salvage", name:"Salvage Pile", group:"Scenery",
  colA:PAL.timberL, colB:PAL.iron, scale:1.0,
  note:"A finite cache of the old world. Workers carry it back to the hall a load at a time, and the pile visibly shrinks as it is worked out. Drawn at a scale set per instance from what is left.",
  slots:["A — crates, timber","B — banded iron, scrap"],
  parts:[
    {id:"base",  name:"Ground scatter", prim:"box", p:[0,0,0],        s:[1.55,0.12,1.35], shade:0.55},
    {id:"crateA",name:"Crate · large",  prim:"box", p:[-0.28,0.10,-0.10], s:[0.72,0.62,0.62], shade:1.00},
    {id:"bandA", name:"Crate banding",  prim:"box", p:[-0.28,0.38,-0.10], s:[0.76,0.11,0.66],
       tint:1, shade:0.92},
    {id:"crateB",name:"Crate · small",  prim:"box", p:[0.42,0.10,0.22], s:[0.50,0.44,0.46], shade:0.86, r:0.42},
    {id:"barrel",name:"Barrel",         prim:"cyl", p:[0.46,0.10,-0.38], s:[0.24,0.58], seg:7,
       tint:1, shade:0.94},
    {id:"planks",name:"Planks",         prim:"box", p:[-0.10,0.74,-0.10], s:[0.96,0.09,0.34],
       shade:1.06, r:0.28, rep:{mode:"linY", n:2, step:0.11, jog:0.04}},
    {id:"scrap", name:"Scrap",          prim:"cone",p:[0.02,0.12,0.52], s:[0.30,0.36], seg:5,
       tint:1, shade:0.72}
  ]},

{ id:"swarm", name:"Swarm Attacker", group:"Units",
  colA:[0.255,0.272,0.235], colB:[0.345,0.352,0.305], scale:1.0,
  note:"Base HP, 1.5 u/s. Pale on purpose — the horde reads as a light mass against dark ground. One instanced batch — hundreds of them cost a single draw call.",
  slots:["A — ragged cloth","B — pallid skin"],
  parts:[
    {id:"legs", name:"Legs",  prim:"box", p:[0.11,0,0],    s:[0.13,0.42,0.14], shade:0.70,
       rep:{mode:"mirrorX"}},
    {id:"torso",name:"Torso", prim:"box", p:[0,0.40,0],    s:[0.36,0.52,0.27], shade:1.00},
    {id:"neck", name:"Neck",  prim:"box", p:[0,0.90,0],    s:[0.16,0.10,0.16], shade:0.70, tint:1},
    {id:"head", name:"Head",  prim:"box", p:[0,0.99,0.05], s:[0.25,0.24,0.24], tint:1},
    {id:"arms", name:"Arms",  prim:"box", p:[0.24,0.44,0.05], s:[0.11,0.44,0.13], shade:0.86,
       rep:{mode:"mirrorX"}},
    {id:"eyes", name:"Eyes",  prim:"box", p:[0.060,1.105,0.172], s:[0.060,0.050,0.040],
       emit:true, ecol:[2.30,0.42,0.28], rep:{mode:"mirrorX"}}
  ]},

{ id:"runner", name:"Runner", group:"Units",
  colA:[0.243,0.255,0.220], colB:[0.412,0.408,0.348], scale:1.0,
  note:"42% of base HP at 2.85 u/s — nearly twice a shambler's pace. Arrives well ahead of the mass and goes straight for whatever gap you left. Dies to almost anything that connects.",
  slots:["A — rag","B — bleached skin"],
  parts:[
    {id:"legs", name:"Legs",   prim:"box", p:[0.095,0,0],     s:[0.105,0.54,0.115], shade:0.70,
       rep:{mode:"mirrorX"}},
    {id:"torso",name:"Torso",  prim:"box", p:[0,0.50,0.055],  s:[0.290,0.40,0.225], shade:1.00},
    {id:"neck", name:"Neck",   prim:"box", p:[0,0.86,0.105],  s:[0.130,0.09,0.130], shade:0.70, tint:1},
    {id:"head", name:"Head",   prim:"box", p:[0,0.93,0.145],  s:[0.215,0.20,0.215], tint:1},
    {id:"arms", name:"Arms",   prim:"box", p:[0.195,0.52,0.115], s:[0.090,0.42,0.100], shade:0.86,
       rep:{mode:"mirrorX"}},
    {id:"eyes", name:"Eyes",   prim:"box", p:[0.052,1.010,0.248], s:[0.052,0.044,0.036],
       emit:true, ecol:[2.55,0.34,0.20], rep:{mode:"mirrorX"}}
  ]},

{ id:"brute", name:"Brute", group:"Units",
  colA:[0.228,0.218,0.192], colB:[0.318,0.306,0.258], scale:1.0,
  note:"3.8× base HP and 2.4× the damage, at 0.92 u/s. Soaks a watchtower's whole magazine without slowing — walls buy the time, ballistae do the killing.",
  slots:["A — hide","B — swollen flesh"],
  parts:[
    {id:"legs",  name:"Legs",      prim:"box", p:[0.215,0,0],      s:[0.235,0.46,0.255], shade:0.68,
       rep:{mode:"mirrorX"}},
    {id:"torso", name:"Torso",     prim:"box", p:[0,0.44,0],       s:[0.640,0.62,0.460], shade:1.00},
    {id:"hump",  name:"Hump",      prim:"box", p:[0,0.98,-0.11],   s:[0.480,0.24,0.320], shade:0.86, tint:1},
    {id:"shldr", name:"Shoulders", prim:"box", p:[0.352,0.84,0],   s:[0.270,0.28,0.360], shade:0.90,
       rep:{mode:"mirrorX"}},
    {id:"head",  name:"Head",      prim:"box", p:[0,0.94,0.150],   s:[0.270,0.25,0.245], tint:1},
    {id:"arms",  name:"Arms",      prim:"box", p:[0.430,0.40,0.045], s:[0.190,0.66,0.215], shade:0.84,
       rep:{mode:"mirrorX"}},
    {id:"fists", name:"Fists",     prim:"box", p:[0.430,0.02,0.045], s:[0.245,0.22,0.260], shade:0.72,
       tint:1, rep:{mode:"mirrorX"}},
    {id:"eyes",  name:"Eyes",      prim:"box", p:[0.072,1.055,0.268], s:[0.070,0.058,0.044],
       emit:true, ecol:[2.60,0.34,0.18], rep:{mode:"mirrorX"}}
  ]},

{ id:"soldier", name:"Soldier", group:"Units",
  colA:[0.475,0.395,0.262], colB:[0.610,0.650,0.685], scale:1.0,
  note:"Your line. Holds a spot, steps out to meet whatever comes near, and blocks a lane with its body — attackers stop to fight it instead of walking past.",
  slots:["A — leather","B — steel (helm, shield, spearhead)"],
  parts:[
    {id:"legs",  name:"Legs",      prim:"box", p:[0.115,0,0],       s:[0.135,0.42,0.145], shade:0.70,
       rep:{mode:"mirrorX"}},
    {id:"tunic", name:"Tunic",     prim:"box", p:[0,0.38,0],        s:[0.360,0.30,0.270], shade:0.82},
    {id:"torso", name:"Cuirass",   prim:"box", p:[0,0.62,0],        s:[0.375,0.42,0.285], tint:1, shade:0.92},
    {id:"neck",  name:"Neck",      prim:"box", p:[0,1.04,0],        s:[0.150,0.07,0.150], shade:0.70},
    {id:"head",  name:"Head",      prim:"box", p:[0,1.10,0.02],     s:[0.235,0.22,0.225], shade:1.05},
    {id:"helm",  name:"Helm",      prim:"cone",p:[0,1.30,0.02],     s:[0.185,0.26], seg:6,
       tint:1, shade:1.00, anchorY:{to:"head", mode:"top", off:0}},
    {id:"arms",  name:"Arms",      prim:"box", p:[0.245,0.60,0.02], s:[0.105,0.40,0.115], shade:0.86,
       rep:{mode:"mirrorX"}},
    {id:"shield",name:"Shield",    prim:"box", p:[-0.325,0.58,0.14],s:[0.090,0.56,0.44], tint:1, shade:1.02},
    {id:"boss",  name:"Shield boss",prim:"cone",p:[-0.395,0.58,0.14],s:[0.115,0.13], seg:6, r:1.571,
       tint:1, shade:1.12},
    {id:"spear", name:"Spear",     prim:"cyl", p:[0.320,0.20,0.10], s:[0.045,1.55], seg:5, shade:0.95},
    {id:"tip",   name:"Spearhead", prim:"cone",p:[0.320,1.75,0.10], s:[0.070,0.30], seg:4,
       tint:1, shade:1.15, anchorY:{to:"spear", mode:"top", off:0}},
    {id:"sig",   name:"Signal lamp",prim:"box",p:[0,0.86,0.155],    s:[0.095,0.085,0.055],
       emit:true, ecol:GLOW_SIG}
  ]},

{ id:"commander", name:"Commander", group:"Units",
  colA:[0.365,0.400,0.475], colB:[0.620,0.640,0.672], scale:1.0,
  note:"The one unit you start with, and the only one who can raise a town hall. Taller than a soldier, hits harder, and wears the crown — until the hall is up, losing the commander loses the round.",
  slots:["A — royal cloth","B — polished steel"],
  scaleHint:"stands a head taller than a soldier",
  parts:[
    {id:"legs",   name:"Legs",        prim:"box", p:[0.125,0,0],      s:[0.140,0.44,0.150], shade:0.68,
       rep:{mode:"mirrorX"}},
    {id:"boots",  name:"Boots",       prim:"box", p:[0.125,0,0.02],   s:[0.158,0.13,0.185], tint:1, shade:0.78,
       rep:{mode:"mirrorX"}},
    {id:"tabard", name:"Tabard",      prim:"box", p:[0,0.40,0],       s:[0.365,0.34,0.275], shade:0.94},
    {id:"cuirass",name:"Cuirass",     prim:"box", p:[0,0.68,0],       s:[0.395,0.44,0.300], tint:1, shade:0.98},
    {id:"sash",   name:"Sash of rank",prim:"box", p:[0,0.60,0.160],   s:[0.300,0.10,0.030],
       col:PAL.brass, shade:1.00},
    {id:"pauldron",name:"Pauldrons",  prim:"box", p:[0.235,0.86,0],   s:[0.115,0.14,0.315], tint:1, shade:1.08,
       rep:{mode:"mirrorX"}},
    // A cloak is five panels, not a slab: each one is built from its hem
    // upward and tipped forward at the top, so the cloth grips the shoulders
    // and kicks away at the ground. The pairs fan wider and hang shorter the
    // further out they sit, which is what gives it a ragged hem and a bit of
    // depth from any angle.
    {id:"mantle", name:"Shoulder mantle",prim:"box",p:[0,0.99,-0.055],s:[0.440,0.14,0.320],
       shade:0.80},
    {id:"cloakC", name:"Cloak · back",  prim:"box", p:[0,0.22,-0.210], s:[0.240,0.80,0.055],
       shade:0.74, rot:[0.15,0,0]},
    {id:"cloakM", name:"Cloak · folds", prim:"box", p:[0.125,0.26,-0.192],s:[0.150,0.76,0.055],
       shade:0.66, rot:[0.14,-0.26,-0.07], rep:{mode:"mirrorX"}},
    {id:"cloakO", name:"Cloak · edges", prim:"box", p:[0.206,0.34,-0.166],s:[0.130,0.64,0.055],
       shade:0.58, rot:[0.17,-0.50,-0.13], rep:{mode:"mirrorX"}},
    {id:"clasp",  name:"Cloak clasp",   prim:"box", p:[0,1.04,0.132],  s:[0.075,0.065,0.045],
       col:PAL.brassL, shade:1.18},
    {id:"neck",   name:"Neck",        prim:"box", p:[0,1.10,0],       s:[0.150,0.07,0.150], shade:0.68},
    {id:"head",   name:"Head",        prim:"box", p:[0,1.16,0.02],    s:[0.235,0.22,0.225], shade:1.05},
    {id:"crown",  name:"Crown band",  prim:"cyl", p:[0,1.35,0.02],    s:[0.138,0.100], seg:12,
       cap:false, col:PAL.brassL, shade:1.14, anchorY:{to:"head", mode:"top", off:-0.03}},
    {id:"points", name:"Crown points", prim:"cone",p:[0,1.45,0.02],    s:[0.034,0.105], seg:4,
       col:PAL.brassL, shade:1.26, anchorY:{to:"crown", mode:"top", off:-0.008},
       rep:{mode:"ring", n:7, r:0.120, a0:90}},
    {id:"jewel",  name:"Crown jewel",  prim:"box", p:[0,1.38,0.152],   s:[0.058,0.058,0.030],
       emit:true, ecol:[1.85,1.42,0.62]},
    {id:"arms",   name:"Arms",        prim:"box", p:[0.255,0.64,0.02],s:[0.105,0.40,0.115], shade:0.86,
       rep:{mode:"mirrorX"}},
    {id:"grip",   name:"Grip",        prim:"cyl", p:[0.335,0.44,0.08],s:[0.036,0.18], seg:5, shade:0.78},
    {id:"guard",  name:"Crossguard",  prim:"box", p:[0.335,0.60,0.08],s:[0.200,0.055,0.055], tint:1, shade:1.10},
    {id:"sword",  name:"Longsword",   prim:"box", p:[0.335,0.64,0.08],s:[0.050,0.92,0.020], tint:1, shade:1.20},
    {id:"scab",   name:"Scabbard",   prim:"box", p:[-0.300,0.30,-0.06],s:[0.060,0.66,0.075],
       tint:1, shade:0.82, rot:[0.12,0,0.16]},
    {id:"sig",    name:"Signal lamp", prim:"box", p:[0,0.92,0.168],   s:[0.100,0.090,0.055],
       emit:true, ecol:GLOW_SIG}
  ]},

{ id:"archer", name:"Archer", group:"Units",
  colA:[0.352,0.430,0.372], colB:[0.545,0.470,0.300], scale:1.0,
  note:"Out-ranges every attacker in the game and dies to any of them. Wants a wall in front and a soldier between it and whatever gets through.",
  slots:["A — hooded cloak","B — bow, quiver, leather"],
  parts:[
    {id:"legs",  name:"Legs",     prim:"box", p:[0.100,0,0],        s:[0.115,0.44,0.125], shade:0.70,
       rep:{mode:"mirrorX"}},
    {id:"cloak", name:"Cloak",    prim:"box", p:[0,0.40,-0.02],     s:[0.320,0.44,0.265], shade:1.00},
    {id:"belt",  name:"Belt",     prim:"box", p:[0,0.44,0],         s:[0.335,0.08,0.280], tint:1, shade:0.80},
    {id:"head",  name:"Head",     prim:"box", p:[0,0.86,0.02],      s:[0.205,0.20,0.200], shade:1.02},
    {id:"hood",  name:"Hood",     prim:"cone",p:[0,1.06,0.02],      s:[0.190,0.30], seg:5,
       shade:0.88, anchorY:{to:"head", mode:"top", off:0}},
    {id:"arms",  name:"Arms",     prim:"box", p:[0.205,0.52,0.06],  s:[0.090,0.38,0.100], shade:0.86,
       rep:{mode:"mirrorX"}},
    {id:"bowU",  name:"Bow · upper",prim:"box",p:[0.245,0.86,0.20], s:[0.055,0.52,0.070], r:0.30,
       tint:1, shade:1.05},
    {id:"bowL",  name:"Bow · lower",prim:"box",p:[0.245,0.34,0.20], s:[0.055,0.52,0.070], r:-0.30,
       tint:1, shade:1.05},
    {id:"quiver",name:"Quiver",   prim:"cyl", p:[-0.185,0.58,-0.16],s:[0.090,0.44], seg:6,
       tint:1, shade:0.90, r:0.26},
    {id:"shafts",name:"Arrows",   prim:"cyl", p:[-0.185,0.98,-0.16],s:[0.028,0.26], seg:4,
       shade:1.10, anchorY:{to:"quiver", mode:"top", off:0}},
    {id:"sig",   name:"Signal lamp",prim:"box",p:[0,0.66,0.145],    s:[0.085,0.080,0.050],
       emit:true, ecol:GLOW_SIG}
  ]},

{ id:"worker", name:"Worker", group:"Units",
  colA:[0.430,0.398,0.300], colB:[0.545,0.520,0.470], scale:1.0,
  note:"Gathers, carries, and cannot fight. Runs for the hall when the horde comes and dies to anything that catches it — losing workers costs you the next day, not just this night.",
  slots:["A — homespun","B — apron, tool haft"],
  parts:[
    {id:"legs",  name:"Legs",     prim:"box", p:[0.095,0,0],       s:[0.115,0.44,0.125], shade:0.70,
       rep:{mode:"mirrorX"}},
    {id:"torso", name:"Torso",    prim:"box", p:[0,0.40,0],        s:[0.310,0.42,0.245], shade:1.00},
    {id:"apron", name:"Apron",    prim:"box", p:[0,0.38,0.128],    s:[0.250,0.34,0.045], tint:1, shade:0.88},
    {id:"head",  name:"Head",     prim:"box", p:[0,0.84,0.015],    s:[0.210,0.20,0.205], shade:1.04},
    {id:"cap",   name:"Cap",      prim:"box", p:[0,1.04,0.015],    s:[0.235,0.09,0.230],
       tint:1, shade:0.78, anchorY:{to:"head", mode:"top", off:0}},
    {id:"arms",  name:"Arms",     prim:"box", p:[0.200,0.46,0.03], s:[0.085,0.38,0.095], shade:0.86,
       rep:{mode:"mirrorX"}},
    // A hand hammer, not a sledge on a pole. It used to stand a head taller than
    // the worker with the head laid across the body, which from this camera read
    // as a signpost rather than a tool. Now the haft tops out at the shoulder and
    // the head runs fore-and-aft on the same yaw as the haft, so the two agree.
    // The haft starts at the hand — the bottom of the arm box, y 0.46 — and
    // leans back over the shoulder. It used to start below the hand and run
    // straight up past the elbow, which put it inside the arm: two parallel
    // sticks in the same place read as one limb, not a man holding a tool.
    // No anchorY here: that helper adds the length straight up the Y axis and
    // knows nothing about the tilt, so the head is positioned outright.
    {id:"haft",  name:"Tool haft",prim:"cyl", p:[0.212,0.44,0.055],s:[0.030,0.47], seg:5,
       tint:1, shade:0.95, rot:[-0.46,0,0]},
    {id:"head2", name:"Tool head",prim:"box", p:[0.212,0.775,-0.115],s:[0.095,0.095,0.170],
       tint:1, shade:1.10, rot:[-0.46,0,0]},
    {id:"sig",   name:"Signal lamp",prim:"box",p:[0,0.62,0.140],   s:[0.080,0.075,0.048],
       emit:true, ecol:GLOW_SIG}
  ]},

{ id:"corpse", name:"Corpse", group:"Units",
  colA:[0.150,0.156,0.135], colB:[0.196,0.196,0.168], scale:1.0,
  note:"What is left where an attacker went down. Fades over about eight seconds; the field stays readable but you can still see where the pressure landed.",
  slots:["A — rag","B — flesh"],
  parts:[
    {id:"heap", name:"Heap", prim:"box", p:[0,0,0],          s:[0.54,0.15,0.36], shade:0.85},
    {id:"lump", name:"Lump", prim:"box", p:[0.17,0.11,0.03], s:[0.26,0.13,0.24], shade:1.00, tint:1},
    {id:"limb", name:"Limb", prim:"box", p:[-0.26,0.03,-0.11], s:[0.34,0.10,0.11], r:0.42, shade:0.62}
  ]},

{ id:"conifer", name:"Conifer", group:"Scenery",
  colA:PAL.trunk, colB:PAL.leaf, scale:1.0,
  note:"Scattered outside the buildable ring, roughly 430 per map.",
  slots:["A — trunk","B — foliage"],
  parts:[
    {id:"trunk", name:"Trunk",  prim:"cyl", p:[0,0,0], s:[0.20,1.86], seg:6, shade:0.55},
    {id:"crowns",name:"Crowns", prim:"cone", p:[0,1.02,0], s:[1.35,1.50], seg:7, tint:1,
       rep:{mode:"linY", n:3, step:0.86, taper:0.72, altShade:-0.20}}
  ]},

{ id:"deadtree", name:"Dead Tree", group:"Scenery",
  colA:PAL.trunk, colB:PAL.trunk, scale:1.0,
  note:"Replaces conifers where the corruption field is high.",
  slots:["A — trunk"],
  parts:[
    {id:"trunk",   name:"Trunk",    prim:"cyl", p:[0,0,0], s:[0.19,1.87], seg:6, shade:1.00},
    {id:"branches",name:"Branches", prim:"box", p:[0,1.04,0], s:[1.00,0.11,0.11], shade:0.86,
       rep:{mode:"ring", n:4, r:0.36, a0:23, rise:0.22}}
  ]},

{ id:"rock", name:"Boulder", group:"Scenery",
  colA:PAL.rock, colB:PAL.rock, scale:1.0,
  note:"Ground clutter — cheap silhouette break-up, about 90 per map.",
  slots:["A — rock"],
  parts:[
    {id:"c1", name:"Chunk 1", prim:"box", p:[0,0,0],          s:[0.45,0.25,0.41], r:0.0,  shade:1.00},
    {id:"c2", name:"Chunk 2", prim:"box", p:[0.12,0,0.09],    s:[0.37,0.21,0.35], r:2.3,  shade:0.89},
    {id:"c3", name:"Chunk 3", prim:"box", p:[-0.14,0,0.13],   s:[0.29,0.16,0.27], r:4.6,  shade:0.78}
  ]},

{ id:"tuft", name:"Grass Tuft", group:"Scenery",
  colA:PAL.leafD, colB:PAL.leafD, scale:1.0,
  note:"About 530 per map. Turns fleshy inside the corruption field.",
  slots:["A — leafD (clean) / fleshD (corrupted)"],
  parts:[
    {id:"blades", name:"Blades", prim:"cone", p:[0,0,0], s:[0.055,0.34], seg:4, shade:0.90,
       rep:{mode:"ring", n:5, r:0.09, a0:0, altShade:0.18}}
  ]},

{ id:"tracer", name:"Tower Bolt", group:"Effects",
  colA:[2.2,1.5,0.6], colB:[2.2,1.5,0.6], scale:1.0,
  note:"Travels 30 u/s and applies damage on arrival. Fully emissive — skips lighting entirely.",
  slots:["A — emissive amber"],
  parts:[
    {id:"bolt", name:"Bolt", prim:"box", p:[0,0,0], s:[0.10,0.10,0.62], emit:true}
  ]},

{ id:"spark", name:"Spark", group:"Effects",
  colA:[2.40,1.55,0.62], colB:[2.40,1.55,0.62], scale:1.0,
  note:"One instanced cube reused for muzzle flash, bolt impacts and death bursts. Colour and size come from the instance, so the same mesh covers every effect in the game.",
  slots:["A — emissive, set per instance"],
  parts:[
    {id:"bit", name:"Mote", prim:"box", p:[0,0,0], s:[0.13,0.13,0.13], emit:true}
  ]},

{ id:"arrow", name:"Archer Arrow", group:"Effects",
  colA:[0.75,1.85,1.90], colB:[0.75,1.85,1.90], scale:1.0,
  note:"Cold to the horde's warm bolts, so at a glance you can tell your archers' fire from your towers'.",
  slots:["A — emissive, set per instance"],
  parts:[
    {id:"shaft", name:"Shaft", prim:"box", p:[0,0,0], s:[0.07,0.07,0.52], emit:true}
  ]},

{ id:"marker", name:"Move Marker", group:"Overlays",
  colA:[0.42,1.55,1.62], colB:[0.42,1.55,1.62], scale:1.0,
  note:"Drops where you right-click and fades. Scaled per instance so it can pulse without a second mesh.",
  slots:["A — emissive teal"],
  parts:[
    {id:"ring", name:"Ring", prim:"ring", p:[0,0,0], s:[0.42], weight:0.055, seg:28, emit:true},
    {id:"pip",  name:"Pip",  prim:"box",  p:[0,0.02,0], s:[0.09,0.02,0.09], emit:true}
  ]},

{ id:"ring", name:"Range Ring", group:"Overlays",
  colA:[0.30,0.56,0.47], colB:[0.30,0.56,0.47], scale:2.4,
  note:"Unit radius, scaled per instance to the tower's range.",
  slots:["A — emissive teal"],
  parts:[
    {id:"ring", name:"Annulus", prim:"ring", p:[0,0,0], s:[1.0], weight:0.015, seg:96, emit:true}
  ]},

{ id:"site", name:"Building Site", group:"Overlays",
  colA:PAL.timberL, colB:PAL.stone, scale:1.0,
  note:"What every building is before it is a building: materials dropped on trodden ground. One instance per site, scaled to the footprint, swapped for the real thing the moment the work finishes. Deliberately low and unmistakable — a site should never be mistaken for something that shoots back.",
  slots:["A — timber, planks","B — stone, mortar"],
  parts:[
    {id:"pad",    name:"Trodden ground", prim:"box", p:[0,0,0],            s:[1.30,0.07,1.30], shade:0.50},
    // a stack of beams, each course jogged so it reads as hand-laid
    {id:"beams",  name:"Timber stack",   prim:"box", p:[-0.26,0.05,-0.18], s:[0.92,0.13,0.22], shade:1.00,
       rep:{mode:"linY", n:3, step:0.14, jog:0.06}},
    {id:"blockA", name:"Stone block",    prim:"box", p:[0.38,0.05,0.30],   s:[0.42,0.28,0.36],
       tint:1, shade:0.92},
    {id:"blockB", name:"Stone block",    prim:"box", p:[0.32,0.32,0.26],   s:[0.32,0.22,0.28],
       tint:1, shade:1.04, r:0.44},
    {id:"heap",   name:"Mortar heap",    prim:"cone",p:[-0.42,0.05,0.42],  s:[0.30,0.28], seg:6,
       tint:1, shade:0.70},
    {id:"legs",   name:"Trestle legs",   prim:"box", p:[0.28,0.05,-0.42],  s:[0.09,0.34,0.09], shade:0.78,
       rep:{mode:"mirrorX"}},
    {id:"bench",  name:"Trestle top",    prim:"box", p:[0,0.37,-0.42],     s:[0.78,0.09,0.24], shade:1.06},
    // one plank left leaning against the stack — the detail that says "in progress"
    {id:"lean",   name:"Leaning plank",  prim:"box", p:[-0.05,0.30,0.10],  s:[0.10,0.86,0.20],
       rot:[0,0.5,-0.62], shade:0.88}
  ]},

{ id:"grid", name:"Build Grid", group:"Overlays",
  colA:[0.40,0.46,0.44], colB:[0.40,0.46,0.44], scale:0.42,
  note:"Clipped to the buildable circle. One instance, drawn only during the build phase.",
  slots:["A — emissive grey"],
  parts:[
    {id:"lines", name:"Grid lines", prim:"grid", p:[0,0,0], s:[1,1,1], emit:true}
  ]}
];

// ---- build ----------------------------------------------------------------
var OVERRIDES={};                       // assetId -> parts array

// ---- balance registry -----------------------------------------------------
// Every number that decides how a thing PLAYS, declared next to the asset that
// owns it. Same override/persist shape as the part lists, so the Library can
// edit stats exactly the way it edits geometry, and the game reads the resolved
// values rather than literals.
//   k     field name the game reads
//   def   shipped value
//   lo/hi slider-ish bounds for the editor (clamped on entry, not on read)
//   step  editor increment; int:true keeps it whole
//   unit  suffix shown after the field
var STAT_DEFS={
  hall:{ note:"The objective. Your commander raises it, and it houses your first workers.", fields:[
    {k:"hp",       label:"Hit points",     def:600, lo:100, hi:3000, step:10, int:true},
    {k:"raise",    label:"Raising time",   def:14,  lo:1,   hi:120,  step:0.5, unit:"s",
     hint:"how long the commander works before it stands"},
    {k:"cap",      label:"Workers housed", def:2,   lo:0,   hi:12,   step:1,  int:true},
    {k:"retrain",  label:"Rebuild time",   def:18,  lo:1,   hi:90,   step:0.5, unit:"s"},
    {k:"pathCost", label:"Path cost",      def:999, lo:0,   hi:999,  step:1,  int:true,
     hint:"how hard attackers try to route around it"}
  ]},
  tower:{ note:"Volume damage. Short range on purpose.", fields:[
    {k:"cost",     label:"Cost",           def:30,  lo:1,   hi:200,  step:1,  int:true, unit:"supply"},
    {k:"hp",       label:"Hit points",     def:170, lo:20,  hi:1200, step:10, int:true},
    {k:"range",    label:"Range",          def:6.6, lo:2,   hi:20,   step:0.1, unit:"u"},
    {k:"fire",     label:"Reload",         def:0.42,lo:0.05,hi:5,    step:0.01,unit:"s"},
    {k:"dmg",      label:"Damage",         def:13,  lo:1,   hi:300,  step:1,  int:true,
     hint:"per bolt, single target"},
    {k:"boltSpeed",label:"Bolt speed",     def:30,  lo:4,   hi:120,  step:1,  int:true, unit:"u/s"},
    {k:"raise",    label:"Build time",     def:4, lo:0,   hi:120,  step:0.5, unit:"s",
     hint:"materials sit on the ground until this runs out"},
    {k:"pathCost", label:"Path cost",      def:60,  lo:0,   hi:999,  step:1,  int:true}
  ]},
  ballista:{ note:"Reach and splash. Targets the heaviest thing in range.", fields:[
    {k:"cost",     label:"Cost",           def:48,  lo:1,   hi:300,  step:1,  int:true, unit:"supply"},
    {k:"hp",       label:"Hit points",     def:200, lo:20,  hi:1200, step:10, int:true},
    {k:"range",    label:"Range",          def:9.6, lo:2,   hi:24,   step:0.1, unit:"u"},
    {k:"fire",     label:"Reload",         def:1.75,lo:0.1, hi:8,    step:0.05,unit:"s"},
    {k:"dmg",      label:"Damage",         def:105, lo:1,   hi:600,  step:5,  int:true},
    {k:"splash",   label:"Blast radius",   def:2.4, lo:0,   hi:8,    step:0.1, unit:"u"},
    {k:"splashK",  label:"Blast falloff",  def:0.70,lo:0,   hi:1,    step:0.05,
     hint:"share of damage at the centre of the blast"},
    {k:"boltSpeed",label:"Bolt speed",     def:22,  lo:4,   hi:80,   step:1,  int:true, unit:"u/s"},
    {k:"raise",    label:"Build time",     def:7, lo:0,   hi:120,  step:0.5, unit:"s",
     hint:"materials sit on the ground until this runs out"},
    {k:"pathCost", label:"Path cost",      def:60,  lo:0,   hi:999,  step:1,  int:true}
  ]},
  brazier:{ note:"No attack. Buys reload speed and light.", fields:[
    {k:"cost",     label:"Cost",           def:12,  lo:1,   hi:120,  step:1,  int:true, unit:"supply"},
    {k:"hp",       label:"Hit points",     def:70,  lo:10,  hi:600,  step:5,  int:true},
    {k:"aura",     label:"Aura radius",    def:4.8, lo:1,   hi:16,   step:0.1, unit:"u"},
    {k:"auraK",    label:"Reload ×",       def:0.78,lo:0.3, hi:1,    step:0.01,
     hint:"multiplies turret reload; stacks twice"},
    {k:"raise",    label:"Build time",     def:2.5, lo:0,   hi:120,  step:0.5, unit:"s",
     hint:"materials sit on the ground until this runs out"},
    {k:"pathCost", label:"Path cost",      def:8,   lo:0,   hi:999,  step:1,  int:true}
  ]},
  wall:{ note:"Cheap time. High path cost pushes the swarm elsewhere.", fields:[
    {k:"cost",     label:"Cost",           def:3,   lo:1,   hi:60,   step:1,  int:true, unit:"supply"},
    {k:"hp",       label:"Hit points",     def:110, lo:10,  hi:900,  step:5,  int:true},
    {k:"raise",    label:"Build time",     def:1, lo:0,   hi:120,  step:0.5, unit:"s",
     hint:"materials sit on the ground until this runs out"},
    {k:"pathCost", label:"Path cost",      def:14,  lo:0,   hi:999,  step:1,  int:true}
  ]},
  gate:{ note:"Deliberately inviting — low path cost pulls the swarm in.", fields:[
    {k:"cost",     label:"Cost",           def:7,   lo:1,   hi:80,   step:1,  int:true, unit:"supply"},
    {k:"hp",       label:"Hit points",     def:90,  lo:10,  hi:900,  step:5,  int:true},
    {k:"raise",    label:"Build time",     def:1.5, lo:0,   hi:120,  step:0.5, unit:"s",
     hint:"materials sit on the ground until this runs out"},
    {k:"pathCost", label:"Path cost",      def:2,   lo:0,   hi:999,  step:1,  int:true,
     hint:"below open ground, so they choose to walk through"}
  ]},

  barracks:{ note:"Musters soldiers on placement, retrains losses while it stands.", fields:[
    {k:"cost",    label:"Cost",          def:44,  lo:1,  hi:300, step:1, int:true, unit:"supply"},
    {k:"hp",      label:"Hit points",    def:220, lo:20, hi:1200,step:10,int:true},
    {k:"cap",     label:"Garrison",      def:3,   lo:1,  hi:12,  step:1, int:true,
     hint:"soldiers housed"},
    {k:"retrain", label:"Retrain time",  def:11,  lo:1,  hi:90,  step:0.5, unit:"s",
     hint:"per replacement, only while it stands"},
    {k:"raise",    label:"Build time",     def:6, lo:0,   hi:120,  step:0.5, unit:"s",
     hint:"materials sit on the ground until this runs out"},
    {k:"pathCost",label:"Path cost",     def:40,  lo:0,  hi:999, step:1, int:true}
  ]},
  archery:{ note:"Musters archers on placement, retrains losses while it stands.", fields:[
    {k:"cost",    label:"Cost",          def:40,  lo:1,  hi:300, step:1, int:true, unit:"supply"},
    {k:"hp",      label:"Hit points",    def:160, lo:20, hi:1200,step:10,int:true},
    {k:"cap",     label:"Garrison",      def:3,   lo:1,  hi:12,  step:1, int:true,
     hint:"archers housed"},
    {k:"retrain", label:"Retrain time",  def:13,  lo:1,  hi:90,  step:0.5, unit:"s"},
    {k:"raise",    label:"Build time",     def:5.5, lo:0,   hi:120,  step:0.5, unit:"s",
     hint:"materials sit on the ground until this runs out"},
    {k:"pathCost",label:"Path cost",     def:40,  lo:0,  hi:999, step:1, int:true}
  ]},

  cottage:{ note:"Houses workers. The only building that makes supply instead of spending it.", fields:[
    {k:"cost",    label:"Cost",          def:26,  lo:1,  hi:300, step:1, int:true, unit:"supply"},
    {k:"hp",      label:"Hit points",    def:90,  lo:20, hi:1200,step:5, int:true},
    {k:"cap",     label:"Workers",       def:2,   lo:1,  hi:12,  step:1, int:true},
    {k:"retrain", label:"Rebuild time",  def:14,  lo:1,  hi:90,  step:0.5, unit:"s"},
    {k:"raise",    label:"Build time",     def:4.5, lo:0,   hi:120,  step:0.5, unit:"s",
     hint:"materials sit on the ground until this runs out"},
    {k:"pathCost",label:"Path cost",     def:30,  lo:0,  hi:999, step:1, int:true}
  ]},
  worker:{ note:"Gathers by day, mends by night. Cannot fight.", fields:[
    {k:"hp",      label:"Hit points",    def:45,  lo:10, hi:900, step:5, int:true},
    {k:"speed",   label:"Speed",         def:2.45,lo:0.2,hi:10,  step:0.05, unit:"u/s"},
    {k:"gather",  label:"Gather rate",   def:3.5, lo:0.5,hi:60,  step:0.5, unit:"/s",
     hint:"supply pulled from a pile per second"},
    {k:"carry",   label:"Carry",         def:4,   lo:1,  hi:200, step:1, int:true,
     hint:"a full load, then it walks back"},
    {k:"repair",  label:"Repair rate",   def:17,  lo:1,  hi:200, step:1, int:true, unit:"hp/s",
     hint:"health put back into a damaged building"},
    {k:"nerve",   label:"Nerve",         def:2.1, lo:0, hi:20,   step:0.1, unit:"u",
     hint:"how close an attacker gets before a worker drops the job and runs"}
  ]},
  // The nests are the objective and the bank. A round runs until every hall is
  // gone or every nest is, so these numbers decide how long that takes.
  nest:{ note:"The source of the horde, and the only thing worth marching out for.", fields:[
    {k:"hp",      label:"Hit points",     def:2600,lo:200, hi:20000,step:50, int:true,
     hint:"one committed push, not a chip over several days"},
    {k:"regen",   label:"Knits back",     def:0.50,lo:0,   hi:1,    step:0.05,
     hint:"share of full health recovered each dawn"},
    {k:"cache",   label:"Cache",          def:320, lo:0,   hi:3000, step:10, int:true, unit:"supply",
     hint:"paid to whoever did the most damage bringing it down"},
    {k:"guard",   label:"Standing guard", def:6,   lo:0,   hi:40,   step:1,  int:true,
     hint:"attackers that live at the nest by day"},
    {k:"callN",   label:"Call · size",    def:4,   lo:0,   hi:30,   step:1,  int:true,
     hint:"defenders it wakes when something starts hitting it"},
    {k:"callGap", label:"Call · cooldown",def:5.0, lo:0.5, hi:60,   step:0.5, unit:"s"},
    {k:"leash",   label:"Guard leash",    def:9.0, lo:1,   hi:30,   step:0.5, unit:"u",
     hint:"how far a guard will follow before going home"},
    // Each night is bigger than the last and the gap widens, so a long game is
    // not a safe one. These live here because it is the nests that send them.
    {k:"grow",    label:"Night growth",    def:0.20,lo:0,   hi:2,    step:0.01,
     hint:"how much bigger the second night is than the first"},
    {k:"accel",   label:"Growth · added",  def:0.06,lo:0,   hi:1,    step:0.01,
     hint:"added to that growth every further night"},
    {k:"ehpK",    label:"Attacker health ×",def:1.05,lo:1,  hi:2,    step:0.01,
     hint:"multiplies attacker health each night"}
  ]},

  salvage:{ note:"How much is out there, and how it is spread.", fields:[
    {k:"nearN",   label:"Piles · inside", def:2,  lo:0,  hi:8,   step:1, int:true,
     hint:"within the build ring, safe to work"},
    {k:"farN",    label:"Piles · outside",def:3,  lo:0,  hi:10,  step:1, int:true,
     hint:"out where the lanes run"},
    {k:"amt",     label:"Yield · inside", def:95, lo:5,  hi:600, step:2, int:true, unit:"supply"},
    {k:"farK",    label:"Yield · outside",def:1.75,lo:0.2,hi:6,  step:0.05,
     hint:"× the inside yield"}
  ]},

  soldier:{ note:"Blocks with its body. Attackers stop to fight it.", fields:[
    {k:"hp",      label:"Hit points",    def:105, lo:10, hi:900, step:5, int:true},
    {k:"speed",   label:"Speed",         def:2.10,lo:0.2,hi:10,  step:0.05, unit:"u/s"},
    {k:"dmg",     label:"Damage",        def:19,  lo:1,  hi:300, step:1, int:true,
     hint:"per swing"},
    {k:"swing",   label:"Swing time",    def:0.85,lo:0.1,hi:5,   step:0.05, unit:"s"},
    {k:"reach",   label:"Reach",         def:1.35,lo:0.3,hi:5,   step:0.05, unit:"u"},
    {k:"leash",   label:"Leash",         def:4.0, lo:0.5,hi:20,  step:0.5, unit:"u",
     hint:"how far it will chase from its post"}
  ]},
  commander:{ note:"Starts the round. Raises the hall, then fights as your heaviest soldier.", fields:[
    {k:"hp",      label:"Hit points",    def:260, lo:20, hi:2000,step:10,int:true},
    {k:"speed",   label:"Speed",         def:2.55,lo:0.2,hi:10,  step:0.05, unit:"u/s"},
    {k:"dmg",     label:"Damage",        def:32,  lo:1,  hi:400, step:1, int:true,
     hint:"per swing"},
    {k:"swing",   label:"Swing time",    def:0.80,lo:0.1,hi:5,   step:0.05, unit:"s"},
    {k:"reach",   label:"Reach",         def:1.50,lo:0.3,hi:5,   step:0.05, unit:"u"},
    {k:"leash",   label:"Leash",         def:5.5, lo:0.5,hi:20,  step:0.5, unit:"u",
     hint:"how far it will chase from its post"},
    {k:"build",   label:"Build speed",   def:1.0, lo:0.2,hi:6,   step:0.1, unit:"x",
     hint:"multiplies how fast the hall goes up"},
    {k:"rally",   label:"Rally range",   def:5.6, lo:0,  hi:20,  step:0.2, unit:"u",
     hint:"your people fight faster inside this"},
    {k:"rallyK",  label:"Rally speed",   def:0.70,lo:0.2,hi:1,   step:0.02,
     hint:"multiplies their attack interval — lower is faster"}
  ]},
  archer:{ note:"Out-ranges everything. Folds if anything reaches it.", fields:[
    {k:"hp",      label:"Hit points",    def:52,  lo:10, hi:900, step:2, int:true},
    {k:"speed",   label:"Speed",         def:2.30,lo:0.2,hi:10,  step:0.05, unit:"u/s"},
    {k:"dmg",     label:"Damage",        def:15,  lo:1,  hi:300, step:1, int:true,
     hint:"per arrow"},
    {k:"fire",    label:"Draw time",     def:1.05,lo:0.1,hi:6,   step:0.05, unit:"s"},
    {k:"range",   label:"Range",         def:8.2, lo:1,  hi:24,  step:0.1, unit:"u"},
    {k:"leash",   label:"Leash",         def:1.5, lo:0.5,hi:20,  step:0.5, unit:"u",
     hint:"archers hold position rather than close"}
  ]},

  swarm:{ note:"The mass. Every other attacker is measured against it.", fields:[
    {k:"speed",    label:"Speed",          def:1.50,lo:0.2, hi:8,    step:0.05,unit:"u/s"},
    {k:"hpK",      label:"Hit points ×",   def:1.00,lo:0.05,hi:12,   step:0.05,
     hint:"multiplies the difficulty's base HP"},
    {k:"dmgBuild", label:"Damage · walls", def:8,   lo:0,   hi:120,  step:1,  int:true, unit:"dps"},
    {k:"dmgHall",  label:"Damage · hall",  def:13,  lo:0,   hi:200,  step:1,  int:true, unit:"dps"},
    {k:"reach",    label:"Reach",          def:1.15,lo:0.2, hi:5,    step:0.05,unit:"u"}
  ]},
  runner:{ note:"Arrives first. Punishes an unfinished perimeter.", fields:[
    {k:"speed",    label:"Speed",          def:2.85,lo:0.2, hi:10,   step:0.05,unit:"u/s"},
    {k:"hpK",      label:"Hit points ×",   def:0.42,lo:0.05,hi:12,   step:0.05},
    {k:"dmgBuild", label:"Damage · walls", def:5,   lo:0,   hi:120,  step:1,  int:true, unit:"dps"},
    {k:"dmgHall",  label:"Damage · hall",  def:8,   lo:0,   hi:200,  step:1,  int:true, unit:"dps"},
    {k:"reach",    label:"Reach",          def:1.05,lo:0.2, hi:5,    step:0.05,unit:"u"}
  ]},
  brute:{ note:"Soaks a tower's whole magazine. Needs concentrated damage.", fields:[
    {k:"speed",    label:"Speed",          def:0.92,lo:0.2, hi:8,    step:0.05,unit:"u/s"},
    {k:"hpK",      label:"Hit points ×",   def:3.80,lo:0.05,hi:20,   step:0.1},
    {k:"dmgBuild", label:"Damage · walls", def:19,  lo:0,   hi:200,  step:1,  int:true, unit:"dps"},
    {k:"dmgHall",  label:"Damage · hall",  def:31,  lo:0,   hi:300,  step:1,  int:true, unit:"dps"},
    {k:"reach",    label:"Reach",          def:1.30,lo:0.2, hi:5,    step:0.05,unit:"u"}
  ]}
};

var STAT_OVER={};
function statDefs(id){ return STAT_DEFS[id]||null; }
function hasStats(id){ return !!STAT_DEFS[id]; }
function statsOf(id){
  var d=STAT_DEFS[id];
  if(!d) return null;
  var o=STAT_OVER[id]||{}, out={};
  for(var i=0;i<d.fields.length;i++){
    var f=d.fields[i];
    out[f.k]=(o[f.k]===undefined)?f.def:o[f.k];
  }
  return out;
}
function statField(id,k){
  var d=STAT_DEFS[id];
  if(!d) return null;
  for(var i=0;i<d.fields.length;i++) if(d.fields[i].k===k) return d.fields[i];
  return null;
}
function setStat(id,k,v){
  var f=statField(id,k);
  if(!f || !isFinite(v)) return;
  v=Math.max(f.lo,Math.min(f.hi,v));
  if(f.int) v=Math.round(v);
  if(!STAT_OVER[id]) STAT_OVER[id]={};
  STAT_OVER[id][k]=v;
}
function statsEdited(id){
  var o=STAT_OVER[id];
  if(!o) return false;
  for(var k in o) return true;
  return false;
}
function resetStats(id){ delete STAT_OVER[id]; }
function getStatOverrides(){ return STAT_OVER; }
function setStatOverrides(o){
  STAT_OVER={};
  if(!o) return;
  for(var id in o){
    if(!STAT_DEFS[id]) continue;
    for(var k in o[id]) setStat(id,k,o[id][k]);   // re-clamped on load
  }
}

// ---- user assets + metadata ----------------------------------------------
// Shipped assets stay immutable; anything you change about one is a metadata
// override, and anything you invent is a user asset. Both persist, both export.
var USER=[], META={};
var META_KEYS={name:1,group:1,note:1,scale:1,colA:1,colB:1};
function allAssets(){ return ASSETS.concat(USER); }
function baseById(id){
  var i;
  for(i=0;i<ASSETS.length;i++) if(ASSETS[i].id===id) return ASSETS[i];
  for(i=0;i<USER.length;i++) if(USER[i].id===id) return USER[i];
  return null;
}
function isUser(id){
  for(var i=0;i<USER.length;i++) if(USER[i].id===id) return true;
  return false;
}
function assetMeta(id){
  var b=baseById(id);
  if(!b) return null;
  var m=META[id]||{}, out={id:id};
  for(var k in META_KEYS) out[k]=(m[k]!==undefined)?m[k]:b[k];
  out.slots=b.slots||[];
  return out;
}
function setMeta(id,k,v){
  if(!META_KEYS[k]||!baseById(id)) return;
  if(isUser(id)){ baseById(id)[k]=v; return; }
  if(!META[id]) META[id]={};
  META[id][k]=v;
}
function metaEdited(id){
  var m=META[id];
  if(!m) return false;
  for(var k in m) return true;
  return false;
}
function resetMeta(id){ delete META[id]; }
function getMeta(){ return META; }
function setMetaAll(o){ META={}; if(o) for(var id in o) if(baseById(id)) META[id]=o[id]; }
function getUserAssets(){ return USER; }
function setUserAssets(list){
  USER=[];
  if(!list||!list.length) return;
  for(var i=0;i<list.length;i++){
    var a=list[i];
    if(!a||!a.id||baseById(a.id)) continue;
    USER.push({id:a.id, name:a.name||a.id, group:a.group||"Custom",
               note:a.note||"", scale:a.scale||1,
               colA:a.colA||[0.45,0.44,0.42], colB:a.colB||[0.30,0.32,0.34],
               slots:a.slots||["A — primary","B — accent"],
               parts:a.parts&&a.parts.length?a.parts:[blankPart("part")]});
  }
}
function blankPart(id){
  return {id:id,name:"Box",prim:"box",p:[0,0,0],s:[0.6,0.6,0.6],shade:1.0};
}
function uniqueAssetId(base){
  var id=base, n=1;
  while(baseById(id)) id=base+"-"+(++n);
  return id;
}
function newAsset(fromId){
  var src=fromId?baseById(fromId):null;
  var id=uniqueAssetId(fromId?fromId+"-copy":"asset");
  var def;
  if(src){
    var m=assetMeta(fromId);
    def={id:id, name:m.name+" copy", group:m.group, note:m.note, scale:m.scale,
         colA:m.colA.slice(), colB:m.colB.slice(), slots:(src.slots||[]).slice(),
         parts:JSON.parse(JSON.stringify(partsOf(fromId)))};
  } else {
    def={id:id, name:"New Structure", group:"Custom", note:"", scale:1.0,
         colA:[0.45,0.44,0.42], colB:[0.30,0.32,0.34],
         slots:["A — primary","B — accent"],
         parts:[{id:"base",name:"Base",prim:"box",p:[0,0,0],s:[1.4,0.24,1.4],shade:0.7},
                {id:"body",name:"Body",prim:"box",p:[0,0.22,0],s:[1.1,1.0,1.1],shade:1.0},
                {id:"roof",name:"Roof",prim:"gable",p:[0,1.20,0],s:[1.4,0.7,1.4],
                 tint:1,courses:4,over:0.16}]};
  }
  USER.push(def);
  return id;
}
function deleteAsset(id){
  for(var i=0;i<USER.length;i++) if(USER[i].id===id){
    USER.splice(i,1);
    delete META[id];
    var o=OVERRIDES; delete o[id];
    return true;
  }
  return false;
}

function setOverrides(o){ OVERRIDES=o||{}; }
function getOverrides(){ return OVERRIDES; }
function assetByIdShipped(id){
  for(var i=0;i<ASSETS.length;i++) if(ASSETS[i].id===id) return ASSETS[i];
  return null;
}
function partsOf(id){
  var a=baseById(id);
  if(!a) return [];
  return OVERRIDES[id] || a.parts;
}
// highlightId: build only that part, flat-shaded, for the selection overlay
// ---- map registry ---------------------------------------------------------
// A map is small: a seed, the generator settings, and whatever you placed by
// hand. Terrain stays a function rather than stored data, so a saved map is a
// few hundred bytes and still round-trips through JSON.
var MAPS=[];
function blankMap(name){
  return { id:"map"+Date.now().toString(36), name:name||"New Map", note:"",
           seed:Math.floor(Math.random()*900000)+1000,
           gen:{}, nests:null, nodes:null,
           props:{add:[],remove:[]},
           round:{} };
}
function mapById(id){
  for(var i=0;i<MAPS.length;i++) if(MAPS[i].id===id) return MAPS[i];
  return null;
}
function addMap(m){ MAPS.push(m); return m; }
function deleteMap(id){
  for(var i=0;i<MAPS.length;i++) if(MAPS[i].id===id){ MAPS.splice(i,1); return true; }
  return false;
}
function getMaps(){ return MAPS; }
function setMaps(list){
  MAPS=[];
  if(!list||!list.length) return;
  for(var i=0;i<list.length;i++){
    var m=list[i];
    if(!m||!m.id) continue;
    MAPS.push({ id:m.id, name:m.name||"Map", note:m.note||"",
                seed:m.seed|0 || 1234,
                gen:m.gen||{},
                nests:m.nests||null, nodes:m.nodes||null,
                props:{add:(m.props&&m.props.add)||[], remove:(m.props&&m.props.remove)||[]},
                round:m.round||{} });
  }
}

function buildAsset(id,opts){
  var parts=resolveParts(partsOf(id)), M=new Mesh(true);
  opts=opts||{};
  for(var i=0;i<parts.length;i++){
    var pt=parts[i];
    if(opts.only && pt.id!==opts.only) continue;
    if(opts.hide && opts.hide[pt.id]) continue;
    if(opts.idColors){
      // flat unique colour per part, for click-to-select readback
      emitPart(M,pt,[(i+1)/255,0,0],true);
    } else {
      emitPart(M,pt,opts.flat?[1,1,1]:null);
    }
  }
  return M;
}
// One bone of a rigged asset: the named parts, moved so `pivot` sits at the
// mesh origin. The renderer's per-instance pitch turns about that origin, so a
// leg built with its pivot at the hip swings from the hip instead of sliding.
// `single` drops a mirrored repeat, leaving one limb the caller draws twice.
// `side:-1` asks for the left-hand copy of a limb. A part that was declared as
// a mirrored pair flips to -X; a part that was already declared on the left (a
// shield, say) is taken as it stands. That is what lets one arm carry a spear
// and the other a shield while both still swing.
function buildBone(id,ids,pivot,opts){
  var parts=resolveParts(partsOf(id)), Mh=new Mesh(true), set={}, i;
  opts=opts||{};
  var left=(opts.side===-1);
  for(i=0;i<ids.length;i++) set[ids[i]]=1;
  for(i=0;i<parts.length;i++){
    var pt=parts[i];
    if(!set[pt.id]) continue;
    var q=clonePart(pt);
    if(left && q.rep && q.rep.mode==="mirrorX"){
      var r0=partRot(q);
      q.p=[-q.p[0], q.p[1], q.p[2]];
      q.rot=[r0[0], -r0[1], -r0[2]];
      delete q.r;
    }
    if(opts.single||left) delete q.rep;
    q.p=[q.p[0]-pivot[0], q.p[1]-pivot[1], q.p[2]-pivot[2]];
    delete q.anchorY;                    // already resolved into p
    emitPart(Mh,q,null);
  }
  return Mh;
}
// Where a bone hangs from: the top of a limb box, in the asset's own space.
function jointTop(id,partId){
  var parts=resolveParts(partsOf(id));
  for(var i=0;i<parts.length;i++){
    var p=parts[i];
    if(p.id!==partId) continue;
    var s=p.s||[1,1,1];
    return [p.p[0], p.p[1]+(s[1]===undefined?0:s[1]), p.p[2]];
  }
  return null;
}
function partBase(id,partId){
  var parts=resolveParts(partsOf(id));
  for(var i=0;i<parts.length;i++) if(parts[i].id===partId) return parts[i].p.slice();
  return null;
}
function clonePart(pt){ return JSON.parse(JSON.stringify(pt)); }
function cloneParts(id){ return JSON.parse(JSON.stringify(partsOf(id))); }

function meshPedestal(rad){
  var M=new Mesh(false), seg=64, r=rad||3.4;
  for(var i=0;i<seg;i++){
    var a=i/seg*Math.PI*2, b=(i+1)/seg*Math.PI*2;
    M.tri([0,0,0],[Math.cos(a)*r,0,Math.sin(a)*r],[Math.cos(b)*r,0,Math.sin(b)*r],[0.215,0.235,0.145]);
    M.quad([Math.cos(a)*r,0,Math.sin(a)*r],[Math.cos(b)*r,0,Math.sin(b)*r],
           [Math.cos(b)*r,-1.2,Math.sin(b)*r],[Math.cos(a)*r,-1.2,Math.sin(a)*r],[0.15,0.15,0.15]);
  }
  return M;
}
function meshTile(){
  var M=new Mesh(true), s=CELL*0.46;
  M.quad([-s,0,-s],[s,0,-s],[s,0,s],[-s,0,s],W,1.0);
  return M;
}

return {
  sub:sub, crs:crs, dt:dt, nz:nz, m4:m4, mul:mul, ortho:ortho, lookAt:lookAt,
  rngFrom:rngFrom, makeNoise:makeNoise, Mesh:Mesh, box:box, gable:gable,
  cone:cone, cyl:cyl, shade:shade, jit:jit, PAL:PAL,
  CELL:CELL, GN:GN, PLAT:PLAT, BUILD_R:BUILD_R, EXT:EXT,
  GEN_DEF:GEN_DEF, genOf:genOf,
  buildR:function(){ return BUILD_R; },
  setBuildR:function(v){ BUILD_R=Math.max(5,Math.min(24,v||11.4)); },
  seedNests:seedNests,
  blankMap:blankMap, mapById:mapById, addMap:addMap, deleteMap:deleteMap,
  getMaps:getMaps, setMaps:setMaps,
  gx2w:gx2w, w2gx:w2gx,
  makeTerrain:makeTerrain, buildStatic:buildStatic,
  ASSETS:ASSETS, allAssets:allAssets, buildAsset:buildAsset, assetById:baseById,
  assetMeta:assetMeta, setMeta:setMeta, metaEdited:metaEdited, resetMeta:resetMeta,
  getMeta:getMeta, setMetaAll:setMetaAll,
  getUserAssets:getUserAssets, setUserAssets:setUserAssets,
  newAsset:newAsset, deleteAsset:deleteAsset, isUser:isUser, blankPart:blankPart,
  partsOf:partsOf,
  cloneParts:cloneParts, clonePart:clonePart,
  setOverrides:setOverrides, getOverrides:getOverrides,
  STAT_DEFS:STAT_DEFS, statDefs:statDefs, hasStats:hasStats, statsOf:statsOf,
  statField:statField, setStat:setStat, statsEdited:statsEdited, resetStats:resetStats,
  getStatOverrides:getStatOverrides, setStatOverrides:setStatOverrides,
  expandRep:expandRep, resolveParts:resolveParts, anchoredY:anchoredY, partRot:partRot,
  wedge:wedge, xform:xform,
  buildBone:buildBone, jointTop:jointTop, partBase:partBase,
  TEX_MODES:TEX_MODES, MAT_MODES:MAT_MODES,
  meshPedestal:meshPedestal, meshTile:meshTile
};
})();
