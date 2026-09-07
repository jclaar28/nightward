// ===========================================================================
// Nightward — cel-shaded renderer with instanced batches
// ===========================================================================
var HFGL = (function(){
"use strict";
var M=HF;

var FS_COMMON=
"precision highp float;\n"+
"in vec3 vN; in vec3 vC; in vec3 vW; in float vE; in float vM; in vec4 vLP;\n"+
"uniform highp sampler2DShadow uShadow;\n"+
"uniform mat4 uLightVP;\n"+
"uniform float uSMWorld;\n"+
"uniform vec3 uLightDir,uEye,uSun,uSky,uBounce;\n"+
"uniform float uEmit;\n"+
"#define NL 12\n"+
"uniform vec4 uLampP[NL];\n"+
"uniform vec4 uLampC[NL];\n"+
"uniform int uLampN;\n"+
"uniform vec2 uShadowTexel;\n"+
// Skylight caught on an edge. rgb is the colour of it, a is how much of it
// there is at this hour — near nothing at midday, most of it at night.
"uniform vec4 uRim;\n"+
// War fog. One 80x80 R8 texture for the whole scene, sampled by world XZ:
// 0 never seen, ~0.5 seen before, 1 in sight now. Doing it here rather than
// per instance is what makes the boundary a smooth curve instead of a staircase
// of 1.5-unit cells — the texture is filtered, so the edge falls between texels.
// It also means terrain, props, buildings and units all obey it without a
// single call site knowing about fog, because every one of them ends up here.
"uniform sampler2D uWarTex;\n"+
"uniform vec3 uWarK;\n"+      // x on/off, y unexplored level, z explored level
"uniform vec2 uWarSO;\n"+     // world XZ -> uv: scale, offset
"layout(location=0) out vec4 oColor;\n"+
"layout(location=1) out vec4 oNormal;\n"+
"float warLevel(){\n"+
"  if(uWarK.x<0.5) return 1.0;\n"+
"  float v=texture(uWarTex, vW.xz*uWarSO.x+uWarSO.y).r;\n"+
"  return (v<0.5) ? mix(uWarK.y,uWarK.z,v*2.0) : mix(uWarK.z,1.0,(v-0.5)*2.0);\n"+
"}\n"+
// Colour drains before brightness does: what you remember is grey, what you are
// looking at is not. Dimming alone reads as night rather than as memory.
"vec3 warApply(vec3 col,float f){\n"+
"  if(uWarK.x<0.5) return col;\n"+
"  float g=dot(col,vec3(0.299,0.587,0.114));\n"+
"  return mix(vec3(g),col,clamp((f-uWarK.y)/max(0.001,1.0-uWarK.y)*1.25,0.0,1.0))*f;\n"+
"}\n"+
"float shadowAt(){\n"+
"  vec3 N=normalize(vN);\n"+
"  float ndl=clamp(dot(N,uLightDir),0.0,1.0);\n"+
// Normal offset, not a depth push. Biasing along the light ray slid every
// shadow away from whatever cast it — that is the gap under a tree trunk.
// Moving the *sample* along the surface normal instead keeps contact shadows
// attached, and it scales with the shadow texel so thin geometry survives.
"  float slope=clamp(1.0-ndl,0.0,1.0);\n"+
"  vec3 wp=vW + N*(uSMWorld*(0.9+2.6*slope));\n"+
"  vec4 lp=uLightVP*vec4(wp,1.0);\n"+
"  vec3 p=lp.xyz/lp.w*0.5+0.5;\n"+
"  if(p.z>1.0||p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0) return 1.0;\n"+
"  float ref=p.z-0.00016;\n"+
"  float s=0.0;\n"+
"  for(int y=-1;y<=1;y++){ for(int x=-1;x<=1;x++){\n"+
"    s+=texture(uShadow,vec3(p.xy+vec2(float(x),float(y))*uShadowTexel*1.25,ref)); } }\n"+
"  return s/9.0;\n"+
"}\n"+
"void main(){\n"+
"  vec3 N=normalize(vN);\n"+
"  float wf=warLevel();\n"+
// A lamp is geometry too. Letting the emissive path skip the fog is how a
// brazier you have never found still glows at you across a black map.
"  if(vE>0.5){ oColor=vec4(warApply(vC*((vE>1.5)?uEmit:1.0),wf),1.0);\n"+
"               oNormal=vec4(N*0.5+0.5,wf); return; }\n"+
"  float shd=shadowAt();\n"+
"  float lit=max(dot(N,uLightDir),0.0)*shd;\n"+
"  float band = lit>0.62 ? 1.0 : (lit>0.22 ? 0.66 : (lit>0.045 ? 0.40 : 0.30));\n"+
"  band = mix(band, smoothstep(0.0,0.85,lit)*0.72+0.30, 0.22);\n"+
// finish: 0 matte, 1 chalk, 2 satin, 3 metal. Everything a cel shader can
// honestly say about a material lives in three numbers — how hard the bands
// step, how hot the rim reads, and whether there is a highlight at all.
"  float rimK=0.42, specK=0.0, specP=20.0, lo=0.30, hi=0.55;\n"+
"  if(vM>2.5){ rimK=1.45; specK=1.30; specP=42.0; lo=0.42; hi=0.52;\n"+
"              band=clamp((band-0.58)*1.75+0.46,0.10,1.45); }\n"+   // polished
"  else if(vM>1.5){ rimK=0.72; specK=0.30; specP=26.0; lo=0.34; hi=0.86; }\n"+ // sheen
"  else if(vM>0.5){ rimK=0.08; band=mix(band,0.84,0.62); }\n"+      // powdery
"  float sky=0.5+0.5*N.y;\n"+
"  vec3 col = vC*(uSun*band + mix(uBounce,uSky,sky));\n"+
"  vec3 Vs=normalize(uEye-vW);\n"+
"  if(specK>0.0){\n"+
// half-vector, not a mirror lobe: on faceted low-poly geometry a mirror
// highlight flips a whole face on or off, while this sweeps across it
"    float sp=pow(max(dot(N,normalize(uLightDir+Vs)),0.0),specP);\n"+
"    sp=smoothstep(lo,hi,sp);\n"+
"    vec3 tintS=(vM>2.5)?mix(vec3(1.0),normalize(vC+0.004),0.70):vec3(1.0);\n"+
"    col += tintS*uSun*sp*specK*shd;\n"+
"  }\n"+
"  for(int i=0;i<NL;i++){\n"+
"    if(i>=uLampN) break;\n"+
"    vec3 d=uLampP[i].xyz-vW;\n"+
"    float dist=length(d);\n"+
"    float f=max(0.0,1.0-dist/uLampP[i].w); f=f*f*(3.0-2.0*f);\n"+
"    float wrap=max(dot(N,d/max(dist,0.001)),0.0)*0.62+0.38;\n"+
"    col += (vC*0.72+0.28)*uLampC[i].rgb*(f*wrap*uLampC[i].a*uEmit);\n"+
"  }\n"+
"  float rim=pow(1.0-max(dot(N,Vs),0.0),(vM>2.5)?2.2:3.5);\n"+
"  col += vC*0.9*rim*rimK*(uSun*0.72+uSky*0.55);\n"+
// The material rim above is the object lighting its own edge, which is no help
// to a thing that is nearly black: at night an attacker sat 12 levels off the
// ground behind it against 26 by day, and a rim scaled by its own colour would
// have left it there. This one adds the sky's colour rather than the object's,
// so a dark silhouette catches an edge exactly because it is dark. It picks out
// what it should: the ground faces the camera at a glancing angle and takes
// almost none of it, while anything standing up is all edge.
// A sharper falloff than the material rim on purpose. At 3.5 the ground takes
// a twentieth of it, which is enough to lift the whole field by six levels and
// give back most of the contrast the edge had just gained; at 6.0 the ground
// takes a two-hundredth and only a true silhouette catches it.
"  float srim=pow(1.0-max(dot(N,Vs),0.0),6.0);\n"+
"  col += uRim.rgb*srim*uRim.a;\n"+
// the fog level rides in the normal buffer alpha so the ink pass can fade too
"  oColor=vec4(warApply(col,wf),1.0);\n"+
"  oNormal=vec4(N*0.5+0.5,wf);\n"+
"}";

// Wind, in the one place it can be cheap: the vertex shader.
//
// The trees are part of the static mesh — one buffer, one draw call, no
// instances — so there is nothing per tree to animate on the CPU. What there
// is, is a spare range in the emissive channel: emit uses 0-2 and finish uses
// the next two bits, so everything above 32 was free. A tree's foliage is baked
// with a sway weight there, its trunk with none, and the terrain with none.
//
// The offset is driven by the vertex's own position, so neighbouring trees are
// never in step, and it is scaled by that weight, so a canopy moves and the
// trunk it sits on does not. The shadow pass runs the identical function: a
// tree that sways while its shadow stands still is worse than no wind at all.
var GLSL_SWAY=
"uniform float uTime; uniform float uWind;\n"+
"vec3 swayAt(vec3 p,float w){\n"+
"  if(w<0.5||uWind<0.001) return p;\n"+
// 0.17 of a world unit at the top of the tallest layer, at full wind. The
// first pass left this at 1.0 and a stand of pines swung a metre each way like
// kelp — a quarter of every pixel in a forest view changed between two frames
// a second and a half apart.
"  float k=w*(1.0/7.0)*uWind*0.17;\n"+
"  float a=uTime*1.05 + p.x*0.31 + p.z*0.19;\n"+
"  float b=uTime*0.61 + p.z*0.24 - p.x*0.13;\n"+
"  p.x += (sin(a)*0.72 + sin(b*1.7)*0.28)*k;\n"+
"  p.z += (sin(b)*0.68 + sin(a*1.3)*0.32)*k*0.85;\n"+
"  return p;\n"+
"}\n";

var VS_STATIC="#version 300 es\n"+GLSL_SWAY+
"in vec3 aPos; in vec3 aNrm; in vec3 aCol; in float aEmit;\n"+
"uniform mat4 uVP,uLightVP;\n"+
"out vec3 vN; out vec3 vC; out vec3 vW; out float vE; out float vM; out vec4 vLP;\n"+
"void main(){\n"+
"  vec3 wp=swayAt(aPos, floor(aEmit/32.0));\n"+
"  vN=aNrm; vC=aCol; vW=wp;\n"+
"  vE=mod(aEmit,8.0); vM=floor(mod(aEmit,32.0)/8.0);\n"+
"  vLP=uLightVP*vec4(wp,1.0); gl_Position=uVP*vec4(wp,1.0); }";

var VS_INST="#version 300 es\n"+
"in vec3 aPos; in vec3 aNrm; in vec3 aShade; in float aTint; in float aEmit;\n"+
"in vec4 iPosRot; in vec4 iColA; in vec4 iColB;\n"+
"uniform mat4 uVP,uLightVP;\n"+
"out vec3 vN; out vec3 vC; out vec3 vW; out float vE; out float vM; out vec4 vLP;\n"+
"void main(){\n"+
"  float c=cos(iPosRot.w), s=sin(iPosRot.w), sc=iColA.w;\n"+
// pitch rides in the spare w of iColB: a limb whose mesh pivot sits at its
// hip or shoulder then swings about that joint, which is what makes it a bone
"  float pt=iColB.w, pc=cos(pt), ps=sin(pt);\n"+
"  vec3 p=aPos*sc;\n"+
"  p=vec3(p.x, p.y*pc-p.z*ps, p.y*ps+p.z*pc);\n"+
"  vec3 nr=vec3(aNrm.x, aNrm.y*pc-aNrm.z*ps, aNrm.y*ps+aNrm.z*pc);\n"+
"  vec3 wp=vec3(p.x*c-p.z*s, p.y, p.x*s+p.z*c)+iPosRot.xyz;\n"+
"  vN=vec3(nr.x*c-nr.z*s, nr.y, nr.x*s+nr.z*c);\n"+
"  float em=mod(aEmit,8.0);\n"+
// tint 2 means the vertex already carries its final colour: a part that opted
// out of the asset's two shared slots
"  vC=(em>1.5||aTint>1.5)?aShade:mix(iColA.rgb,iColB.rgb,aTint)*aShade;\n"+
"  vW=wp; vE=em; vM=floor(mod(aEmit,32.0)/8.0);\n"+
"  vLP=uLightVP*vec4(wp,1.0); gl_Position=uVP*vec4(wp,1.0); }";

var VS_SHADOW_STATIC="#version 300 es\n"+GLSL_SWAY+
"in vec3 aPos; in float aEmit; uniform mat4 uLightVP;\n"+
"void main(){ gl_Position=uLightVP*vec4(swayAt(aPos, floor(aEmit/32.0)),1.0); }";

var VS_SHADOW_INST="#version 300 es\n"+
"in vec3 aPos; in vec4 iPosRot; in vec4 iColA; in vec4 iColB;\n"+
"uniform mat4 uLightVP;\n"+
"void main(){\n"+
"  float c=cos(iPosRot.w), s=sin(iPosRot.w), sc=iColA.w;\n"+
"  float pt=iColB.w, pc=cos(pt), ps=sin(pt);\n"+
"  vec3 p=aPos*sc;\n"+
"  p=vec3(p.x, p.y*pc-p.z*ps, p.y*ps+p.z*pc);\n"+
"  vec3 wp=vec3(p.x*c-p.z*s, p.y, p.x*s+p.z*c)+iPosRot.xyz;\n"+
"  gl_Position=uLightVP*vec4(wp,1.0); }";

var FS_EMPTY="#version 300 es\nprecision highp float; void main(){}";

var VS_POST="#version 300 es\n"+
"const vec2 P[3]=vec2[3](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));"+
"out vec2 vUv;"+
"void main(){ vec2 p=P[gl_VertexID]; vUv=p*0.5+0.5; gl_Position=vec4(p,0.,1.); }";

var FS_POST="#version 300 es\nprecision highp float;\n"+
"in vec2 vUv;\n"+
"uniform sampler2D uColor,uNormal,uDepth;\n"+
"uniform vec2 uTexel; uniform float uOutline; uniform vec3 uFlash;\n"+
"uniform vec3 uFog,uSkyTop,uSkyBot;\n"+
// how much of the outline turns pale where the picture is dark
"uniform float uInk;\n"+
"out vec4 o;\n"+
"float lum(vec3 c){ return dot(c,vec3(0.299,0.587,0.114)); }\n"+
"void main(){\n"+
"  vec3 c=texture(uColor,vUv).rgb;\n"+
"  float d=texture(uDepth,vUv).r;\n"+
"  vec3 n=texture(uNormal,vUv).rgb*2.0-1.0;\n"+
"  float sky=step(0.99995,d);\n"+
"  c=mix(c,mix(uSkyBot,uSkyTop,pow(clamp(vUv.y,0.,1.),0.75)),sky);\n"+
"  float e=0.0, gap=0.0;\n"+
"  for(int i=0;i<4;i++){\n"+
"    vec2 off = i==0?vec2(1.,0.): i==1?vec2(-1.,0.): i==2?vec2(0.,1.):vec2(0.,-1.);\n"+
"    vec2 uv2=vUv+off*uTexel*1.35;\n"+
"    float d2=texture(uDepth,uv2).r;\n"+
"    vec3 n2=texture(uNormal,uv2).rgb*2.0-1.0;\n"+
"    e=max(e, smoothstep(0.00028,0.0016,abs(d-d2)));\n"+
"    e=max(e, smoothstep(0.42,0.86,1.0-dot(n,n2))*0.85);\n"+
// How far the depth jumps, on a much coarser scale than the outline uses. The
// camera is orthographic, so this is linear in world units: the band below
// starts at about a unit of standing height and saturates near two and a half.
// It is what separates a thing from a speck — the map is strewn with pebbles
// and tufts, and lighting every edge indiscriminately turned the night into a
// wireframe with a bright line around every stone.
"    float dz=abs(d-d2);\n"+
"    gap=max(gap, smoothstep(0.0035,0.0075,dz)*(1.0-smoothstep(0.0085,0.0130,dz)));\n"+
"  }\n"+
// The ink pass would happily draw a crisp outline around a building sitting in
// unexplored ground: the edge comes from depth and normals, neither of which
// knows about fog. That is what the alpha written above is for.
"  float wf=texture(uNormal,vUv).a;\n"+
"  e*=(1.0-sky)*uOutline*wf;\n"+
// The outline is drawn in ink by day and in moonlight at night. A dark line
// around a dark shape on dark ground is not an outline, it is nothing, which is
// why a night wave was 88 attackers you could pick out ten of. A fresnel rim
// was tried first and does almost nothing here: these are boxes and cones, so
// there is no curvature for a rim to sweep across — a face is either edge-on
// and one pixel wide or it faces you and takes none. The edge the eye actually
// reads is the one the depth-and-normal pass already finds, so that is the one
// to light. Only pixels that are themselves dark switch over, so a lamp-lit
// wall keeps its ink and the horde in the field outside it does not.
"  float l0=lum(c);\n"+
"  vec3 inkD=mix(vec3(0.055,0.045,0.055),c*0.16,0.35);\n"+
"  float ik=uInk*gap*(1.0-smoothstep(0.05,0.26,l0));\n"+
"  c=mix(c,mix(inkD,vec3(0.50,0.60,0.86),ik),clamp(e,0.0,1.0)*0.92);\n"+
"  float fogT=smoothstep(0.28,0.80,d)*(1.0-sky);\n"+
"  c=mix(c,uFog,fogT*0.88);\n"+
"  c=pow(max(c,0.0),vec3(0.95));\n"+
"  float l=lum(c);\n"+
"  c=mix(vec3(l),c,mix(0.48,0.80,smoothstep(0.04,0.50,l)));\n"+
"  c=mix(c, c*vec3(0.88,0.95,1.18), (1.0-smoothstep(0.0,0.42,l))*0.62);\n"+
"  c=mix(c, c*vec3(1.06,1.00,0.90), smoothstep(0.45,0.95,l)*0.5);\n"+
"  c=c*1.04-0.015; c=clamp(c,0.0,1.0);\n"+
"  c=c*c*(3.0-2.0*c)*0.30+c*0.70;\n"+
"  c+=uFlash;\n"+
"  vec2 q=vUv-0.5; c*=clamp(1.0-dot(q,q)*0.52,0.0,1.0);\n"+
"  float g=fract(sin(dot(vUv*vec2(1231.7,913.3),vec2(12.9898,78.233)))*43758.5453);\n"+
"  c+=(g-0.5)*0.018;\n"+
"  o=vec4(clamp(c,0.0,1.0),1.0);\n"+
"}";

function create(canvas){
  var gl=canvas.getContext("webgl2",{antialias:false,alpha:false});
  if(!gl) return null;

  function sh(t,src){
    var s=gl.createShader(t); gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function prog(vs,fs){
    var p=gl.createProgram();
    gl.attachShader(p,sh(gl.VERTEX_SHADER,vs));
    gl.attachShader(p,sh(gl.FRAGMENT_SHADER,fs));
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  // ---- war fog texture ----------------------------------------------------
  // One channel, one texel per cell, LINEAR so the boundary lands between
  // texels rather than on a cell edge. NEAREST here is the difference between
  // fog and a chequerboard.
  var warTex=gl.createTexture(), warN=0, warSO=[0,0], warK=[0,0.06,0.42];
  gl.bindTexture(gl.TEXTURE_2D,warTex);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D,null);

  var pStatic=prog(VS_STATIC,"#version 300 es\n"+FS_COMMON);
  var pInst  =prog(VS_INST,  "#version 300 es\n"+FS_COMMON);
  var pShS   =prog(VS_SHADOW_STATIC,FS_EMPTY);
  var pShI   =prog(VS_SHADOW_INST,FS_EMPTY);
  var pPost  =prog(VS_POST,FS_POST);

  function attr(p,name,size,stride,off,div){
    var loc=gl.getAttribLocation(p,name);
    if(loc<0) return;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc,size,gl.FLOAT,false,stride,off);
    if(div) gl.vertexAttribDivisor(loc,div);
  }

  // ---- static geometry ----------------------------------------------------
  var st={vbo:gl.createBuffer(),vao:gl.createVertexArray(),vaoS:gl.createVertexArray(),n:0};
  function setStatic(mesh){
    var S=40;
    gl.bindBuffer(gl.ARRAY_BUFFER,st.vbo);
    gl.bufferData(gl.ARRAY_BUFFER,mesh.data(),gl.STATIC_DRAW);
    gl.bindVertexArray(st.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER,st.vbo);
    attr(pStatic,"aPos",3,S,0); attr(pStatic,"aNrm",3,S,12);
    attr(pStatic,"aCol",3,S,24); attr(pStatic,"aEmit",1,S,36);
    gl.bindVertexArray(st.vaoS);
    gl.bindBuffer(gl.ARRAY_BUFFER,st.vbo);
    attr(pShS,"aPos",3,S,0); attr(pShS,"aEmit",1,S,36);
    gl.bindVertexArray(null);
    st.n=mesh.count();
  }

  // ---- instanced batches --------------------------------------------------
  var IS=48;   // instance stride, bytes (12 floats)
  function makeBatch(mesh,castShadow,blend){
    var S=44;
    var b={vbo:gl.createBuffer(),ibo:gl.createBuffer(),
           vao:gl.createVertexArray(),vaoS:gl.createVertexArray(),
           n:mesh.count(),count:0,shadow:castShadow!==false,
           blend:blend||null};
    gl.bindBuffer(gl.ARRAY_BUFFER,b.vbo);
    gl.bufferData(gl.ARRAY_BUFFER,mesh.data(),gl.STATIC_DRAW);

    gl.bindVertexArray(b.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER,b.vbo);
    attr(pInst,"aPos",3,S,0); attr(pInst,"aNrm",3,S,12);
    attr(pInst,"aShade",3,S,24); attr(pInst,"aTint",1,S,36); attr(pInst,"aEmit",1,S,40);
    gl.bindBuffer(gl.ARRAY_BUFFER,b.ibo);
    attr(pInst,"iPosRot",4,IS,0,1); attr(pInst,"iColA",4,IS,16,1); attr(pInst,"iColB",4,IS,32,1);

    gl.bindVertexArray(b.vaoS);
    gl.bindBuffer(gl.ARRAY_BUFFER,b.vbo);
    attr(pShI,"aPos",3,S,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,b.ibo);
    attr(pShI,"iPosRot",4,IS,0,1); attr(pShI,"iColA",4,IS,16,1);
    attr(pShI,"iColB",4,IS,32,1);        // pitch, so a limb's shadow swings too

    gl.bindVertexArray(null);
    return b;
  }
  function rebuildBatch(b,mesh){
    gl.bindBuffer(gl.ARRAY_BUFFER,b.vbo);
    gl.bufferData(gl.ARRAY_BUFFER,mesh.data(),gl.STATIC_DRAW);
    b.n=mesh.count();
  }
  function setInstances(b,arr,count){
    b.count=count;
    if(count===0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER,b.ibo);
    gl.bufferData(gl.ARRAY_BUFFER,arr.subarray(0,count*12),gl.DYNAMIC_DRAW);
  }

  // ---- targets ------------------------------------------------------------
  var SM=2048, smTex=gl.createTexture(), smFbo=gl.createFramebuffer();
  gl.bindTexture(gl.TEXTURE_2D,smTex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT24,SM,SM,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);
  // COMPARE_REF_TO_TEXTURE with LINEAR gives bilinear-filtered depth
  // comparisons in hardware: each of the 9 PCF taps below is itself smoothed
  // across 4 texels, so a single texel flipping no longer steps the whole pixel.
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_COMPARE_MODE,gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_COMPARE_FUNC,gl.LEQUAL);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER,smFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,smTex,0);
  gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);

  var W=0,H=0,colTex=null,nrmTex=null,depTex=null,mainFbo=gl.createFramebuffer();
  var OPT={outline:1.0, scale:1.0};
  function setOptions(o){
    if(o.outline!==undefined) OPT.outline=o.outline?1.0:0.0;
    if(o.scale!==undefined){ OPT.scale=Math.max(0.5,Math.min(1.0,o.scale)); W=0; }
  }
  var quadVao=gl.createVertexArray();
  function mkTex(fmt,ifmt,type,w,h,filter){
    var t=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texImage2D(gl.TEXTURE_2D,0,ifmt,w,h,0,fmt,type,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter||gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter||gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    return t;
  }
  function resize(){
    var dpr=Math.min(window.devicePixelRatio||1,2)*OPT.scale;
    var cw=canvas.clientWidth||window.innerWidth, ch=canvas.clientHeight||window.innerHeight;
    var w=Math.max(320,Math.round(cw*dpr)), h=Math.max(240,Math.round(ch*dpr));
    if(w>2400){ h=Math.round(h*2400/w); w=2400; }
    if(w===W&&h===H) return;
    W=w;H=h;canvas.width=W;canvas.height=H;
    [colTex,nrmTex,depTex].forEach(function(t){ if(t) gl.deleteTexture(t); });
    colTex=mkTex(gl.RGBA,gl.RGBA8,gl.UNSIGNED_BYTE,W,H);
    nrmTex=mkTex(gl.RGBA,gl.RGBA8,gl.UNSIGNED_BYTE,W,H,gl.NEAREST);
    depTex=mkTex(gl.DEPTH_COMPONENT,gl.DEPTH_COMPONENT24,gl.UNSIGNED_INT,W,H,gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER,mainFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,colTex,0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1,gl.TEXTURE_2D,nrmTex,0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,depTex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  }

  // ---- lighting: day/night keyframes --------------------------------------
  // One 0..2 axis: 0 day, 0.5 dusk, 1 night, 1.5 dawn, 2 day again. Every
  // lighting value in the frame is interpolated from this table, so the whole
  // scene (sun colour, ambient, fog, sky gradient, lamp brightness) moves
  // together instead of drifting apart.
  var SKY=[
   {p:0.00, az:108, el:54, sun:[1.36,1.28,1.14], sky:[0.360,0.420,0.530], bnc:[0.225,0.222,0.220],
    fog:[0.400,0.430,0.470], top:[0.255,0.335,0.455], bot:[0.560,0.575,0.585], em:0.30,
    rim:[0.62,0.68,0.82], rk:0.10, ink:0.00},
   {p:0.50, az:122, el:15, sun:[1.42,1.02,0.66], sky:[0.330,0.352,0.430], bnc:[0.200,0.180,0.180],
    fog:[0.360,0.300,0.290], top:[0.150,0.180,0.265], bot:[0.520,0.395,0.320], em:0.85,
    rim:[0.92,0.62,0.42], rk:0.85, ink:0.42},
   {p:1.00, az:152, el:40, sun:[0.470,0.560,0.760], sky:[0.205,0.252,0.372], bnc:[0.112,0.124,0.158],
    fog:[0.105,0.128,0.192], top:[0.032,0.044,0.078], bot:[0.086,0.100,0.152], em:1.45,
    rim:[0.46,0.60,0.92], rk:1.15, ink:0.80},
   {p:1.50, az:62,  el:13, sun:[1.14,0.86,0.70], sky:[0.262,0.292,0.400], bnc:[0.132,0.126,0.140],
    fog:[0.330,0.322,0.332], top:[0.150,0.170,0.250], bot:[0.470,0.392,0.352], em:0.90,
    rim:[0.86,0.66,0.50], rk:0.80, ink:0.38},
   {p:2.00, az:108, el:54, sun:[1.36,1.28,1.14], sky:[0.360,0.420,0.530], bnc:[0.225,0.222,0.220],
    fog:[0.400,0.430,0.470], top:[0.255,0.335,0.455], bot:[0.560,0.575,0.585], em:0.30,
    rim:[0.62,0.68,0.82], rk:0.10, ink:0.00}
  ];
  // Lamp pools: unshadowed point lights so the settlement stays legible
  // after dark. Scaled by uEmit, so they fade out in daylight for free.
  var LAMP_N=12;
  var lampP=new Float32Array(LAMP_N*4), lampC=new Float32Array(LAMP_N*4), lampN=0;
  function setLamps(list){
    lampN=Math.min(LAMP_N,list?list.length:0);
    for(var i=0;i<lampN;i++){
      var L=list[i];
      lampP[i*4]=L[0]; lampP[i*4+1]=L[1]; lampP[i*4+2]=L[2]; lampP[i*4+3]=L[3];
      lampC[i*4]=L[4]; lampC[i*4+1]=L[5]; lampC[i*4+2]=L[6]; lampC[i*4+3]=L[7];
    }
  }
  function bindLamps(p){
    gl.uniform1i(u(p,"uLampN"),lampN);
    if(lampN){ gl.uniform4fv(u(p,"uLampP"),lampP); gl.uniform4fv(u(p,"uLampC"),lampC); }
  }

  function lerp3(a,b,t){ return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]; }
  var SKYNOW={sun:[1,1,1], sky:[0,0,0], bnc:[0,0,0], fog:[0,0,0], top:[0,0,0], bot:[0,0,0],
              rim:[0,0,0], rk:0, ink:0, em:1};
  var SM_HALF=34;                       // light frustum half-extent, world units
  var SM_WORLD=(SM_HALF*2)/SM;         // world units per shadow texel
  var lightDir, lightVP, dayPhase=0.5;
  // One clock for everything that moves without the simulation moving it. It
  // comes in from the game rather than from Date.now() so a headless run of a
  // known number of steps draws the same frame every time.
  var clockT=0, windK=1.0;
  function setClock(t,w){ clockT=t||0; if(w!==undefined) windK=w; }

  function setTime(p){
    p=p%2; if(p<0) p+=2;
    dayPhase=p;
    var i=0; while(i<SKY.length-2 && SKY[i+1].p<=p) i++;
    var a=SKY[i], b=SKY[i+1];
    var t=(p-a.p)/Math.max(1e-6,(b.p-a.p));
    t=t*t*(3-2*t);                       // ease so keyframes don't pop
    SKYNOW.sun=lerp3(a.sun,b.sun,t);
    SKYNOW.sky=lerp3(a.sky,b.sky,t);
    SKYNOW.bnc=lerp3(a.bnc,b.bnc,t);
    SKYNOW.fog=lerp3(a.fog,b.fog,t);
    SKYNOW.top=lerp3(a.top,b.top,t);
    SKYNOW.bot=lerp3(a.bot,b.bot,t);
    SKYNOW.rim=lerp3(a.rim,b.rim,t);
    SKYNOW.rk =a.rk+(b.rk-a.rk)*t;
    SKYNOW.ink=a.ink+(b.ink-a.ink)*t;
    SKYNOW.em =a.em+(b.em-a.em)*t;
    var az=(a.az+(b.az-a.az)*t)*Math.PI/180, el=(a.el+(b.el-a.el)*t)*Math.PI/180;
    lightDir=M.nz([Math.cos(el)*Math.cos(az),Math.sin(el),Math.cos(el)*Math.sin(az)]);
    var LV=M.lookAt([lightDir[0]*70,lightDir[1]*70,lightDir[2]*70],[0,0,0],[0,1,0]);
    // Snap the light frustum to whole shadow texels. Without this the sampling
    // grid slides a fraction of a texel every frame as the sun turns, and edge
    // texels flip in and out — read as flicker rather than as the sun moving.
    var half=SM_HALF, texel=(half*2)/SM;
    var ox=Math.round(LV[12]/texel)*texel - LV[12];
    var oy=Math.round(LV[13]/texel)*texel - LV[13];
    LV[12]+=ox; LV[13]+=oy;
    lightVP=M.mul(M.ortho(-half,half,-half,half,1,200),LV);
  }
  setTime(0.0);

  function u(p,n){ return gl.getUniformLocation(p,n); }

  function render(cam,batches,flash,overlay,decals){
    resize();
    // shadow pass
    gl.bindFramebuffer(gl.FRAMEBUFFER,smFbo);
    gl.viewport(0,0,SM,SM);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(pShS);
    gl.uniformMatrix4fv(u(pShS,"uLightVP"),false,lightVP);
    gl.uniform1f(u(pShS,"uTime"),clockT); gl.uniform1f(u(pShS,"uWind"),windK);
    gl.bindVertexArray(st.vaoS);
    gl.drawArrays(gl.TRIANGLES,0,st.n);
    gl.useProgram(pShI);
    gl.uniformMatrix4fv(u(pShI,"uLightVP"),false,lightVP);
    for(var i=0;i<batches.length;i++){
      var b=batches[i];
      if(!b.count||!b.shadow) continue;
      gl.bindVertexArray(b.vaoS);
      gl.drawArraysInstanced(gl.TRIANGLES,0,b.n,b.count);
    }

    // main pass
    gl.bindFramebuffer(gl.FRAMEBUFFER,mainFbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);
    gl.viewport(0,0,W,H);
    gl.cullFace(gl.BACK);
    gl.clearBufferfv(gl.COLOR,0,[0,0,0,1]);
    gl.clearBufferfv(gl.COLOR,1,[0.5,0.5,0.5,1]);
    gl.clearBufferfv(gl.DEPTH,0,[1.0]);

    function common(p){
      gl.uniformMatrix4fv(u(p,"uVP"),false,cam.vp);
      gl.uniformMatrix4fv(u(p,"uLightVP"),false,lightVP);
      gl.uniform3fv(u(p,"uLightDir"),lightDir);
      gl.uniform3fv(u(p,"uEye"),cam.eye);
      gl.uniform3fv(u(p,"uSun"),SKYNOW.sun);
      gl.uniform3fv(u(p,"uSky"),SKYNOW.sky);
      gl.uniform3fv(u(p,"uBounce"),SKYNOW.bnc);
      gl.uniform1f(u(p,"uEmit"),SKYNOW.em);
      gl.uniform4f(u(p,"uRim"),SKYNOW.rim[0],SKYNOW.rim[1],SKYNOW.rim[2],SKYNOW.rk);
      bindLamps(p);
      gl.uniform2f(u(p,"uShadowTexel"),1/SM,1/SM);
      gl.uniform1f(u(p,"uSMWorld"),SM_WORLD);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,smTex);
      gl.uniform1i(u(p,"uShadow"),0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,warTex);
      gl.uniform1i(u(p,"uWarTex"),1);
      gl.uniform3f(u(p,"uWarK"),warN?warK[0]:0,warK[1],warK[2]);
      gl.uniform2f(u(p,"uWarSO"),warSO[0],warSO[1]);
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.useProgram(pStatic); common(pStatic);
    gl.uniform1f(u(pStatic,"uTime"),clockT); gl.uniform1f(u(pStatic,"uWind"),windK);
    gl.bindVertexArray(st.vao);
    gl.drawArrays(gl.TRIANGLES,0,st.n);

    gl.useProgram(pInst); common(pInst);
    for(i=0;i<batches.length;i++){
      var b2=batches[i];
      if(!b2.count) continue;
      gl.bindVertexArray(b2.vao);
      gl.drawArraysInstanced(gl.TRIANGLES,0,b2.n,b2.count);
    }
    // Decals: marks on the ground — selection, range, orders. Three things make
    // them read as light lying on the field rather than as painted plastic.
    //
    // They are blended, so their colour is their strength and they never
    // silhouette against what they cross. They do not write depth, so a ring
    // laid over a slope cannot z-fight with it. And attachment 1 is switched
    // off for the whole pass, which is the one that matters: the ink pass finds
    // its outlines by comparing depth and normals, and with the overlay writing
    // neither, the pixels under a decal still carry the terrain's. Before this
    // every chip of every ring came back with a crisp black outline drawn
    // around it, which is what made a ring look like a chain of beads.
    //
    // "mul" batches darken instead of brighten — dst*(1-src) — because a
    // contact shade cannot be made by adding light.
    if(decals&&decals.length){
      gl.enable(gl.BLEND);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);           // a decal is one flat face, seen from either side
      gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.NONE]);
      var bmode=null;
      for(i=0;i<decals.length;i++){
        var db=decals[i];
        if(!db.count) continue;
        if(db.blend!==bmode){
          bmode=db.blend;
          if(bmode==="mul") gl.blendFunc(gl.ZERO,gl.ONE_MINUS_SRC_COLOR);
          else              gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
        }
        gl.bindVertexArray(db.vao);
        gl.drawArraysInstanced(gl.TRIANGLES,0,db.n,db.count);
      }
      gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);
      gl.enable(gl.CULL_FACE);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // Overlay batches are squeezed into the nearest slice of the depth range, so
    // editor handles sit in front of everything while still sorting against each
    // other. Clearing depth instead would make the post pass read the whole
    // frame as sky.
    if(overlay&&overlay.length){
      gl.depthRange(0,0.06);
      for(i=0;i<overlay.length;i++){
        var ob=overlay[i];
        if(!ob.count) continue;
        gl.bindVertexArray(ob.vao);
        gl.drawArraysInstanced(gl.TRIANGLES,0,ob.n,ob.count);
      }
      gl.depthRange(0,1);
    }

    // post
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.viewport(0,0,W,H);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.useProgram(pPost);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,colTex);
    gl.uniform1i(u(pPost,"uColor"),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,nrmTex);
    gl.uniform1i(u(pPost,"uNormal"),1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D,depTex);
    gl.uniform1i(u(pPost,"uDepth"),2);
    gl.uniform2f(u(pPost,"uTexel"),1/W,1/H);
    gl.uniform1f(u(pPost,"uOutline"),OPT.outline);
    gl.uniform1f(u(pPost,"uInk"),SKYNOW.ink);
    gl.uniform3f(u(pPost,"uFlash"),flash?flash[0]:0,flash?flash[1]:0,flash?flash[2]:0);
    gl.uniform3fv(u(pPost,"uFog"),SKYNOW.fog);
    gl.uniform3fv(u(pPost,"uSkyTop"),SKYNOW.top);
    gl.uniform3fv(u(pPost,"uSkyBot"),SKYNOW.bot);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }

  // Flat unique-colour pass read back one pixel: click-to-select in the
  // viewport without maintaining a separate CPU-side collision model.
  function pickAt(cam,b,cssX,cssY,cssW,cssH){
    if(!b||!b.count||!W||!H) return 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER,mainFbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.NONE]);
    gl.viewport(0,0,W,H);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.clearBufferfv(gl.COLOR,0,[0,0,0,1]);
    gl.clearBufferfv(gl.DEPTH,0,[1.0]);
    gl.useProgram(pInst);
    gl.uniformMatrix4fv(u(pInst,"uVP"),false,cam.vp);
    gl.uniformMatrix4fv(u(pInst,"uLightVP"),false,lightVP);
    gl.uniform3fv(u(pInst,"uLightDir"),lightDir);
    gl.uniform3fv(u(pInst,"uEye"),cam.eye);
    gl.uniform2f(u(pInst,"uShadowTexel"),1/SM,1/SM);
    gl.uniform1f(u(pInst,"uSMWorld"),SM_WORLD);
    gl.uniform1f(u(pInst,"uEmit"),1.0);
    gl.uniform1i(u(pInst,"uLampN"),0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,smTex);
    gl.uniform1i(u(pInst,"uShadow"),0);
    gl.bindVertexArray(b.vao);
    gl.drawArraysInstanced(gl.TRIANGLES,0,b.n,b.count);
    var px=Math.round(cssX*(W/Math.max(1,cssW)));
    var py=H-1-Math.round(cssY*(H/Math.max(1,cssH)));
    px=Math.max(0,Math.min(W-1,px)); py=Math.max(0,Math.min(H-1,py));
    var out=new Uint8Array(4);
    gl.readPixels(px,py,1,1,gl.RGBA,gl.UNSIGNED_BYTE,out);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return out[0];
  }

  // The simulation owns what has been seen; this only draws it. `data` is one
  // byte per cell — 0 never seen, 128 seen before, 255 in sight — and `half` is
  // the world half-extent the grid covers. Pass null to switch fog off, which
  // is what every tool that is not testing fog wants.
  function setFog(data,n,half,cell,dark,dim){
    if(!data||!n){ warN=0; return; }
    warN=n;
    warK=[1, dark===undefined?0.06:dark, dim===undefined?0.42:dim];
    // Texel centres, not texel corners: cell i covers uv [i/n,(i+1)/n] and its
    // centre is (i+0.5)/n, while gx2w(i) is the corner. Half a cell out is half
    // a cell of fog lag on every edge, and it reads as the fog trailing you.
    var span=half*2;
    warSO=[1/span, (half+cell*0.5)/span];
    gl.bindTexture(gl.TEXTURE_2D,warTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,n,n,0,gl.RED,gl.UNSIGNED_BYTE,data);
    gl.bindTexture(gl.TEXTURE_2D,null);
  }
  return {gl:gl, setStatic:setStatic, makeBatch:makeBatch, rebuildBatch:rebuildBatch, setInstances:setInstances, pickAt:pickAt,
          render:render, setOptions:setOptions, setTime:setTime, setClock:setClock,
          setLamps:setLamps, setFog:setFog,
          time:function(){return dayPhase;}, size:function(){return [W,H];}};
}

return {create:create};
})();
