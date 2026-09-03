// ===========================================================================
// Nightward — Map editor
//   · the generator's constants become knobs, with a live rebuild
//   · nests, salvage piles and scenery are placed by clicking the ground
//   · a map is a seed plus what you changed, so a save is a few hundred bytes
// ===========================================================================
var HFMAP=(function(){
"use strict";
var M=HF;
var R=null, canvas=null, onEdit=null, onPlay=null;
var active=false, cur=null, sel=null;              // sel: {k:"node"|"nest", i}
var az=38, el=42, zoom=44;
var B=null, buf={}, T=null, staticMesh=null, dirty=true;
var TOOL="select", PROP="tree", BRUSH=4.0;
var HIST=[], REDO=[];

function E(id){ return document.getElementById(id); }
function round(v,n){ var f=Math.pow(10,n===undefined?2:n); return Math.round(v*f)/f; }
function clone(x){ return JSON.parse(JSON.stringify(x)); }

// ---- terrain rebuild ------------------------------------------------------
// The whole map is regenerated from its numbers whenever one changes. It is a
// few milliseconds and it means the preview can never disagree with the round
// you actually play.
function rebuild(){
  if(!cur) return;
  M.setBuildR((cur.round&&cur.round.buildR)||M.GEN_DEF.buildR);
  T=M.makeTerrain(cur.seed,cur.gen,cur.nests);
  staticMesh=M.buildStatic(T,cur.props);
  R.setStatic(staticMesh);
  dirty=false;
  refreshCounts();
}
function markEdit(){
  if(onEdit) onEdit();
}

// ---- history --------------------------------------------------------------
function push(){
  if(!cur) return;
  HIST.push(clone(cur));
  if(HIST.length>40) HIST.shift();
  REDO.length=0;
  refreshHist();
}
function undo(){
  if(!HIST.length||!cur) return;
  REDO.push(clone(cur));
  var prev=HIST.pop();
  copyInto(cur,prev);
  rebuild(); renderPanel(); markEdit(); refreshHist();
}
function redo(){
  if(!REDO.length||!cur) return;
  HIST.push(clone(cur));
  copyInto(cur,REDO.pop());
  rebuild(); renderPanel(); markEdit(); refreshHist();
}
function copyInto(dst,src){
  for(var k in dst) delete dst[k];
  for(k in src) dst[k]=src[k];
}
function refreshHist(){
  var u=E("mapUndo"), r=E("mapRedo");
  if(u) u.disabled=!HIST.length;
  if(r) r.disabled=!REDO.length;
}

// ---- map list -------------------------------------------------------------
function buildList(){
  var maps=M.getMaps(), h="";
  if(!maps.length) h='<p class="libEmpty">No maps yet. Press New to make one.</p>';
  maps.forEach(function(m){
    h+='<button class="libRow" type="button" data-mid="'+m.id+'" aria-current="false">'+
       '<span>'+esc(m.name)+'</span><span class="lt">'+m.seed+'</span></button>';
  });
  E("mapList").innerHTML=h;
  E("mapList").querySelectorAll(".libRow").forEach(function(b){
    b.addEventListener("click",function(){ select(b.dataset.mid); });
  });
  markCurrent();
}
function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;"); }
function markCurrent(){
  document.querySelectorAll("#mapList .libRow").forEach(function(b){
    b.setAttribute("aria-current", (cur&&b.dataset.mid===cur.id)?"true":"false");
  });
}
function select(id){
  var m=M.mapById(id);
  if(!m) return;
  cur=m; sel=null; HIST.length=0; REDO.length=0;
  markCurrent(); rebuild(); renderPanel(); refreshHist();
}
function newMap(from){
  var m=M.blankMap(from?(from.name+" copy"):"New Map");
  if(from){
    m.seed=from.seed; m.gen=clone(from.gen); m.note=from.note;
    m.nests=from.nests?clone(from.nests):null;
    m.nodes=from.nodes?clone(from.nodes):null;
    m.props=clone(from.props); m.round=clone(from.round);
  }
  M.addMap(m); buildList(); select(m.id); markEdit();
}

// ---- panel ----------------------------------------------------------------
var GEN_FIELDS=[
  ["hill","Hills",0.1,"how tall the big hills get"],
  ["rough","Roughness",0.05,"medium bumps and ridges"],
  ["grain","Grain",0.05,"small surface detail"],
  ["freqL","Hill size",0.002,"lower = wider, gentler hills"],
  ["plat","Flat edge",0.1,"level ground just outside your base"],
  ["fall","Slope",0.5,"how quickly the ground rises past that"],
  ["dry","Dry ground",1,"how far out the grass turns dry"],
  ["trees","Trees",10,null],
  ["scrub","Scrub & rocks",10,null],
  ["growth","Corrupted plants",10,null]
];
var ROUND_FIELDS=[
  ["buildR","Build area",0.5,"how much ground you can build on"],
  ["supply","Starting supply",5,"leave blank to use the difficulty setting"],
  ["wave","Enemies",1,"leave blank to use the difficulty setting"],
  ["hp","Enemy health",1,"leave blank to use the difficulty setting"],
  ["day","Daylight",5,"seconds you get to build"],
  ["night","Night length",5,"seconds you have to hold before dawn"]
];

function renderPanel(){
  var host=E("mapPanelBody");
  if(!cur){ host.innerHTML='<p class="libEmpty">Pick a map on the left, or press New.</p>'; return; }
  var G=M.genOf(cur.gen), h="";

  h+='<label class="fRow"><span class="fk">Name</span>'+
     '<input type="text" value="'+esc(cur.name)+'" data-m="name"></label>';
  h+='<label class="fRow"><span class="fk">Seed</span>'+
     '<input type="number" step="1" value="'+cur.seed+'" data-m="seed">'+
     '<span class="fh">the same number always makes the same map</span></label>';
  h+='<div class="fRow"><span class="fk"></span><button class="mBtn" id="mapReroll" type="button">Reroll seed</button></div>';

  h+='<div class="fGroup">Terrain</div>';
  GEN_FIELDS.forEach(function(f){
    h+='<label class="fRow"><span class="fk">'+f[1]+'</span>'+
       '<input type="number" step="'+f[2]+'" value="'+round(G[f[0]],4)+'" data-g="'+f[0]+'">'+
       (f[3]?'<span class="fh">'+f[3]+'</span>':'')+'</label>';
  });

  h+='<div class="fGroup">Nests</div>';
  var nests=nestList();
  nests.forEach(function(l,i){
    h+='<div class="mRow'+(sel&&sel.k==="nest"&&sel.i===i?" on":"")+'" data-pick="nest:'+i+'">'+
       '<b>Nest '+(i+1)+'</b>'+
       '<span>'+Math.round(Math.hypot(l.x,l.z))+'u · '+Math.round((l.share||0)*100)+'%</span>'+
       '<button class="mX" type="button" data-del="nest:'+i+'">×</button></div>';
  });
  h+='<div class="fRow"><span class="fk"></span>'+
     '<button class="mBtn" id="mapSeedNests" type="button">'+
     (cur.nests?"Use random nests":"Place nests myself")+'</button></div>';
  if(sel&&sel.k==="nest"&&nests[sel.i]){
    var L=nests[sel.i];
    h+=numRow("Corruption size",round(L.r,1),0.5,"nest.r","how much ground it turns red");
    h+=numRow("Share of enemies",round(L.share,2),0.05,"nest.share","1 = all of them, 0.5 = half");
    h+=numRow("Health",Math.round(L.hp),20,"nest.hp","destroy it and it stops sending enemies");
    h+='<p class="fh mHint">With the Nest tool, click empty ground to move it.</p>';
  }

  h+='<div class="fGroup">Scrap piles</div>';
  var nodes=nodeList();
  nodes.forEach(function(n,i){
    h+='<div class="mRow'+(sel&&sel.k==="node"&&sel.i===i?" on":"")+'" data-pick="node:'+i+'">'+
       '<b>Pile '+(i+1)+'</b>'+
       '<span>'+Math.round(Math.hypot(n.x,n.z))+'u · '+Math.round(n.amt)+'</span>'+
       '<button class="mX" type="button" data-del="node:'+i+'">×</button></div>';
  });
  h+='<div class="fRow"><span class="fk"></span>'+
     '<button class="mBtn" id="mapSeedNodes" type="button">'+
     (cur.nodes?"Use random piles":"Place piles myself")+'</button></div>';
  if(sel&&sel.k==="node"&&nodes[sel.i]){
    h+=numRow("Amount",Math.round(nodes[sel.i].amt),5,"node.amt");
    h+='<p class="fh mHint">With the Scrap tool, drag it or click empty ground to move it.</p>';
  }

  h+='<div class="fGroup">Round</div>';
  ROUND_FIELDS.forEach(function(f){
    var v=cur.round[f[0]];
    h+='<label class="fRow"><span class="fk">'+f[1]+'</span>'+
       '<input type="number" step="'+f[2]+'" value="'+(v===undefined?"":v)+'" data-r="'+f[0]+'" placeholder="—">'+
       (f[3]?'<span class="fh">'+f[3]+'</span>':'')+'</label>';
  });

  h+='<div class="fGroup">Scenery</div>';
  h+='<p class="fh mHint">'+((cur.props.add||[]).length)+' placed · '+
     ((cur.props.remove||[]).length)+' cleared areas</p>';
  h+='<div class="fRow"><span class="fk"></span><button class="mBtn" id="mapClearProps" type="button">Reset scenery</button></div>';

  host.innerHTML=h;
  wirePanel();
}
function numRow(label,val,step,path,hint){
  return '<label class="fRow"><span class="fk">'+label+'</span>'+
    '<input type="number" step="'+step+'" value="'+val+'" data-p="'+path+'">'+
    (hint?'<span class="fh">'+hint+'</span>':'')+'</label>';
}

function wirePanel(){
  var host=E("mapPanelBody");
  host.querySelectorAll("[data-m]").forEach(function(n){
    n.addEventListener("change",function(){
      push();
      if(n.dataset.m==="name"){ cur.name=n.value||"Map"; buildList(); }
      else if(n.dataset.m==="seed"){ cur.seed=parseInt(n.value,10)||1; rebuild(); buildList(); }
      markEdit();
    });
  });
  host.querySelectorAll("[data-g]").forEach(function(n){
    n.addEventListener("change",function(){
      var v=parseFloat(n.value);
      if(!isFinite(v)) return;
      push(); cur.gen[n.dataset.g]=v; rebuild(); markEdit();
    });
  });
  host.querySelectorAll("[data-r]").forEach(function(n){
    n.addEventListener("change",function(){
      push();
      var raw=n.value.trim();
      if(raw==="") delete cur.round[n.dataset.r];
      else cur.round[n.dataset.r]=parseFloat(raw);
      if(n.dataset.r==="buildR") rebuild();
      renderPanel(); markEdit();
    });
  });
  host.querySelectorAll("[data-p]").forEach(function(n){
    n.addEventListener("change",function(){
      var v=parseFloat(n.value);
      if(!isFinite(v)||!sel) return;
      push();
      var p=n.dataset.p;
      if(p==="nest.r"){ nestList()[sel.i].r=Math.max(3,v); rebuild(); }
      else if(p==="nest.share") nestList()[sel.i].share=Math.max(0,v);
      else if(p==="nest.hp") nestList()[sel.i].hp=Math.max(20,v);
      else if(p==="node.amt") nodeList()[sel.i].amt=Math.max(1,v);
      renderPanel(); markEdit();
    });
  });
  host.querySelectorAll("[data-pick]").forEach(function(n){
    n.addEventListener("click",function(ev){
      if(ev.target.dataset.del) return;
      var p=n.dataset.pick.split(":");
      sel={k:p[0], i:parseInt(p[1],10)};
      renderPanel();
    });
  });
  host.querySelectorAll("[data-del]").forEach(function(n){
    n.addEventListener("click",function(ev){
      ev.stopPropagation();
      var p=n.dataset.del.split(":"), i=parseInt(p[1],10);
      push();
      if(p[0]==="nest"){ var L=nestList(); if(L.length>1) L.splice(i,1); rebuild(); }
      else { nodeList().splice(i,1); }
      sel=null; renderPanel(); markEdit();
    });
  });
  var rr=E("mapReroll");
  if(rr) rr.addEventListener("click",function(){
    push(); cur.seed=Math.floor(Math.random()*900000)+1000;
    rebuild(); renderPanel(); buildList(); markEdit();
  });
  var sN=E("mapSeedNests");
  if(sN) sN.addEventListener("click",function(){
    push();
    cur.nests = cur.nests ? null : clone(M.seedNests(cur.seed,cur.gen));
    sel=null; rebuild(); renderPanel(); markEdit();
  });
  var sn=E("mapSeedNodes");
  if(sn) sn.addEventListener("click",function(){
    push();
    if(cur.nodes) cur.nodes=null;
    else cur.nodes=clone(seededNodes());
    sel=null; renderPanel(); markEdit();
  });
  var cp=E("mapClearProps");
  if(cp) cp.addEventListener("click",function(){
    push(); cur.props={add:[],remove:[]}; rebuild(); renderPanel(); markEdit();
  });
}

// Lanes and piles are stored as null until you touch them, meaning "use the
// seed". These materialise the seeded values the first time you edit.
function nestList(){
  if(!cur.nests) cur.nests=clone(M.seedNests(cur.seed,cur.gen));
  return cur.nests;
}
function seededNodes(){
  var st=M.statsOf("salvage")||{nearN:2,farN:3,amt:78,farK:1.75};
  var rng=M.rngFrom((cur.seed||1)*7919+13), out=[], i, a, r;
  for(i=0;i<(st.nearN|0);i++){
    a=(i+rng())*(Math.PI*2/Math.max(1,st.nearN|0)); r=6.2+rng()*3.2;
    out.push({x:Math.cos(a)*r,z:Math.sin(a)*r,amt:Math.round(st.amt*(0.85+rng()*0.3)),rot:rng()*6.28});
  }
  for(i=0;i<(st.farN|0);i++){
    a=(i+rng())*(Math.PI*2/Math.max(1,st.farN|0)); r=13.8+rng()*4.6;
    out.push({x:Math.cos(a)*r,z:Math.sin(a)*r,amt:Math.round(st.amt*st.farK*(0.85+rng()*0.3)),rot:rng()*6.28});
  }
  return out;
}
function nodeList(){
  if(!cur.nodes) cur.nodes=clone(seededNodes());
  return cur.nodes;
}
function refreshCounts(){
  var n=E("mapCounts");
  if(!n||!cur) return;
  var tri=staticMesh?Math.round(staticMesh.count()/3):0;
  n.textContent=tri.toLocaleString()+" triangles";
}

// ---- view -----------------------------------------------------------------
function camera(){
  var a=az*Math.PI/180, e=el*Math.PI/180;
  var sz=R.size(), aspect=(sz[0]||16)/(sz[1]||9);
  var dir=[Math.cos(e)*Math.cos(a),Math.sin(e),Math.cos(e)*Math.sin(a)];
  var target=[0,M.PLAT,0], eye=[dir[0]*140,target[1]+dir[1]*140,dir[2]*140];
  var f=M.nz([-dir[0],-dir[1],-dir[2]]);
  var r=M.nz(M.crs(f,[0,1,0])), u=M.crs(r,f);
  return { vp:M.mul(M.ortho(-zoom*aspect,zoom*aspect,-zoom,zoom,1,320),
                    M.lookAt(eye,target,[0,1,0])), eye:eye, r:r, u:u, zoom:zoom };
}
// Screen point to a spot on the flat plateau.
function ground(cssX,cssY){
  var rect=canvas.getBoundingClientRect();
  var nx=((cssX-rect.left)/rect.width)*2-1, ny=1-((cssY-rect.top)/rect.height)*2;
  var C=camera(), a=az*Math.PI/180, e=el*Math.PI/180;
  var dir=[Math.cos(e)*Math.cos(a),Math.sin(e),Math.cos(e)*Math.sin(a)];
  var sz=R.size(), aspect=(sz[0]||16)/(sz[1]||9);
  var f=[-dir[0],-dir[1],-dir[2]];
  var r=M.nz(M.crs(f,[0,1,0])), u=M.crs(r,f);
  var o=[dir[0]*140+r[0]*nx*zoom*aspect+u[0]*ny*zoom,
         M.PLAT+dir[1]*140+r[1]*nx*zoom*aspect+u[1]*ny*zoom,
         dir[2]*140+r[2]*nx*zoom*aspect+u[2]*ny*zoom];
  if(Math.abs(f[1])<1e-5) return null;
  var t=(M.PLAT-o[1])/f[1];
  if(t<0) return null;
  return {x:o[0]+f[0]*t, z:o[2]+f[2]*t};
}
function put(arr,n,x,y,z,rot,ca,sc,cb){
  var o=n*12;
  arr[o]=x;arr[o+1]=y;arr[o+2]=z;arr[o+3]=rot;
  arr[o+4]=ca[0];arr[o+5]=ca[1];arr[o+6]=ca[2];arr[o+7]=sc;
  arr[o+8]=cb[0];arr[o+9]=cb[1];arr[o+10]=cb[2];arr[o+11]=0;
  return n+1;
}

function init(renderer,cv,editCb,playCb){
  R=renderer; canvas=cv; onEdit=editCb; onPlay=playCb;
  B={ ring:R.makeBatch(M.buildAsset("ring"),false),
      tile:R.makeBatch(M.meshTile(),false),
      salvage:R.makeBatch(M.buildAsset("salvage")),
      marker:R.makeBatch(M.buildAsset("marker"),false),
      nest:R.makeBatch(M.buildAsset("nest")) };
  buf.ring=new Float32Array(12*80);
  buf.tile=new Float32Array(12*400);
  buf.salvage=new Float32Array(12*64);
  buf.marker=new Float32Array(12*64);
  buf.nest=new Float32Array(12*32);
  buildList();
  wireInput();
  document.querySelectorAll("#mapTools [data-tool]").forEach(function(b){
    b.addEventListener("click",function(){ setTool(b.dataset.tool); });
  });
  document.querySelectorAll("#mapProps [data-prop]").forEach(function(b){
    b.addEventListener("click",function(){
      PROP=b.dataset.prop;
      document.querySelectorAll("#mapProps [data-prop]").forEach(function(x){
        x.setAttribute("aria-pressed", x.dataset.prop===PROP?"true":"false");
      });
    });
  });
  E("mapBrush").addEventListener("input",function(){ BRUSH=parseFloat(this.value)||4; });
  E("mapNew").addEventListener("click",function(){ newMap(null); });
  E("mapDup").addEventListener("click",function(){ if(cur) newMap(cur); });
  E("mapDel").addEventListener("click",function(){
    if(!cur) return;
    M.deleteMap(cur.id); cur=null; sel=null;
    buildList(); renderPanel(); markEdit();
    if(M.getMaps().length) select(M.getMaps()[0].id);
  });
  E("mapUndo").addEventListener("click",undo);
  E("mapRedo").addEventListener("click",redo);
  E("mapPlay").addEventListener("click",function(){ if(cur&&onPlay) onPlay(cur); });
  E("mapExport").addEventListener("click",function(){
    if(!cur) return;
    var t=E("mapJson"); t.value=JSON.stringify(cur,null,1); t.hidden=false; t.select();
  });
  E("mapImport").addEventListener("click",function(){
    var t=E("mapJson");
    if(t.hidden){ t.hidden=false; t.value=""; t.focus(); return; }
    try{
      var o=JSON.parse(t.value);
      o.id="map"+Date.now().toString(36);
      M.setMaps(M.getMaps().concat([o]));
      buildList(); select(o.id); markEdit(); t.hidden=true;
    }catch(e){ t.value="Could not read that JSON: "+e.message; }
  });
  setTool("select");
}
function setTool(t){
  TOOL=t;
  document.querySelectorAll("#mapTools [data-tool]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.tool===t?"true":"false");
  });
  E("mapPropRow").hidden=(t!=="scenery");
  E("mapBrushRow").hidden=(t!=="erase");
}

function enter(){
  active=true;
  if(!cur){
    if(!M.getMaps().length) newMap(null);
    else select(M.getMaps()[0].id);
  } else rebuild();
  renderPanel(); refreshHist();
}
function exit(){ active=false; }
function update(){}

function draw(){
  if(!active||!cur) return;
  var n={ring:0,tile:0,salvage:0,marker:0,nest:0}, i;
  var BR=(cur.round&&cur.round.buildR)||M.GEN_DEF.buildR;
  n.ring=put(buf.ring,n.ring,0,M.PLAT+0.05,0,0,[0.56,0.48,0.29],BR+0.3,[0.56,0.48,0.29]);

  // nests, with the ring showing exactly the ground each one taints
  var nests=(T&&T.nests)||[], nm=M.assetMeta("nest");
  var nA=(nm&&nm.colA)||[0.30,0.10,0.10], nB=(nm&&nm.colB)||[0.19,0.07,0.07];
  for(i=0;i<nests.length;i++){
    var ne=nests[i], on=(sel&&sel.k==="nest"&&sel.i===i);
    var col=on?[1.35,0.45,0.28]:[0.72,0.16,0.14];
    n.nest=put(buf.nest,n.nest,ne.x,M.PLAT,ne.z,0,
               on?[1.05,0.42,0.34]:nA,(nm&&nm.scale||1)*1.5,on?[0.85,0.34,0.30]:nB);
    // only the nest you are editing shows its reach, since that ring is an
    // authoring aid rather than something the game wants on screen
    if(on) n.ring=put(buf.ring,n.ring,ne.x,M.PLAT+0.05,ne.z,0,col,ne.r||16,col);
    // a dotted run back toward the settlement: which way this one attacks from
    var la=Math.atan2(-ne.z,-ne.x), lr=Math.hypot(ne.x,ne.z);
    for(var k=1;k<=6;k++){
      var f=k/7;
      n.marker=put(buf.marker,n.marker,ne.x+Math.cos(la)*lr*f,M.PLAT+0.06,ne.z+Math.sin(la)*lr*f,0,
                   col,0.42,col);
    }
  }
  var nodes=cur.nodes||[], sm=M.assetMeta("salvage");
  var sA=(sm&&sm.colA)||[0.43,0.40,0.30], sB=(sm&&sm.colB)||[0.55,0.52,0.47];
  for(i=0;i<nodes.length;i++){
    var nd=nodes[i], onN=(sel&&sel.k==="node"&&sel.i===i);
    n.salvage=put(buf.salvage,n.salvage,nd.x,M.PLAT,nd.z,nd.rot||0,
                  sA,(sm&&sm.scale||1)*(0.8+Math.min(1.4,nd.amt/140)),sB);
    if(onN) n.ring=put(buf.ring,n.ring,nd.x,M.PLAT+0.06,nd.z,0,[1.4,0.75,0.35],1.3,[1.4,0.75,0.35]);
  }
  var cuts=(cur.props&&cur.props.remove)||[];
  for(i=0;i<cuts.length;i++)
    n.ring=put(buf.ring,n.ring,cuts[i].x,M.PLAT+0.05,cuts[i].z,0,[0.35,0.55,0.75],cuts[i].r,[0.35,0.55,0.75]);

  R.setInstances(B.ring,buf.ring,n.ring);
  R.setInstances(B.tile,buf.tile,n.tile);
  R.setInstances(B.salvage,buf.salvage,n.salvage);
  R.setInstances(B.marker,buf.marker,n.marker);
  R.setInstances(B.nest,buf.nest,n.nest);
  R.render(camera(),[B.salvage,B.nest,B.tile,B.ring,B.marker],[0,0,0],null);
}

// ---- input ----------------------------------------------------------------
var drag=false,lx=0,ly=0,downX=0,downY=0,moved=0,dragNode=-1;
function nodeAt(x,z){
  var nodes=cur.nodes||[], best=-1, bd=2.2;
  for(var i=0;i<nodes.length;i++){
    var d=Math.hypot(nodes[i].x-x,nodes[i].z-z);
    if(d<bd){ bd=d; best=i; }
  }
  return best;
}
function wireInput(){
  canvas.addEventListener("contextmenu",function(e){ e.preventDefault(); });
  canvas.addEventListener("pointerdown",function(ev){
    if(!active||!cur) return;
    canvas.setPointerCapture(ev.pointerId);
    drag=true; lx=downX=ev.clientX; ly=downY=ev.clientY; moved=0; dragNode=-1;
    if(ev.button===2) return;                    // right-drag orbits
    var g=ground(ev.clientX,ev.clientY);
    if(!g) return;
    if(TOOL==="salvage"){
      var hit=nodeAt(g.x,g.z);
      if(hit>=0){ sel={k:"node",i:hit}; dragNode=hit; push(); renderPanel(); }
    }
  });
  canvas.addEventListener("pointermove",function(ev){
    if(!active||!drag) return;
    moved+=Math.abs(ev.clientX-lx)+Math.abs(ev.clientY-ly);
    if(dragNode>=0){
      var g=ground(ev.clientX,ev.clientY);
      if(g){ var nd=nodeList()[dragNode]; nd.x=g.x; nd.z=g.z; }
      lx=ev.clientX; ly=ev.clientY;
      return;
    }
    az-=(ev.clientX-lx)*0.30;
    el=Math.max(14,Math.min(80,el+(ev.clientY-ly)*0.18));
    lx=ev.clientX; ly=ev.clientY;
  });
  function up(ev){
    if(active&&cur&&ev&&moved<5&&ev.button!==2&&dragNode<0) click(ev);
    if(dragNode>=0){ renderPanel(); markEdit(); }
    drag=false; dragNode=-1;
    if(ev&&ev.pointerId!==undefined&&canvas.hasPointerCapture(ev.pointerId))
      canvas.releasePointerCapture(ev.pointerId);
  }
  canvas.addEventListener("pointerup",up);
  canvas.addEventListener("pointercancel",function(){ drag=false; dragNode=-1; });
  canvas.addEventListener("wheel",function(ev){
    if(!active) return;
    ev.preventDefault();
    zoom=Math.max(14,Math.min(78,zoom*(ev.deltaY>0?1.09:0.92)));
  },{passive:false});
}
function click(ev){
  var g=ground(ev.clientX,ev.clientY);
  if(!g) return;
  if(TOOL==="select"){
    var hit=nodeAt(g.x,g.z);
    sel = hit>=0 ? {k:"node",i:hit} : null;
    renderPanel();
    return;
  }
  if(TOOL==="salvage"){
    push();
    nodeList().push({x:g.x,z:g.z,amt:90,rot:Math.random()*6.28});
    sel={k:"node",i:nodeList().length-1};
    renderPanel(); markEdit();
    return;
  }
  if(TOOL==="nest"){
    push();
    var L=nestList();
    // clicking near one moves it; clicking clear ground adds another
    var near=-1, nd2=4.0;
    for(var q=0;q<L.length;q++){
      var dq=Math.hypot(L[q].x-g.x,L[q].z-g.z);
      if(dq<nd2){ nd2=dq; near=q; }
    }
    if(sel&&sel.k==="nest"&&L[sel.i]){ L[sel.i].x=g.x; L[sel.i].z=g.z; }
    else if(near>=0) sel={k:"nest",i:near};
    else { L.push({x:g.x,z:g.z,r:16,share:0.5,hp:520}); sel={k:"nest",i:L.length-1}; }
    rebuild(); renderPanel(); markEdit();
    return;
  }
  if(TOOL==="scenery"){
    push();
    cur.props.add.push({k:PROP,x:g.x,z:g.z,s:0.8+Math.random()*0.6,r:Math.random()*6.28});
    rebuild(); renderPanel(); markEdit();
    return;
  }
  if(TOOL==="erase"){
    push();
    cur.props.remove.push({x:g.x,z:g.z,r:BRUSH});
    // anything hand-placed inside the circle goes too
    cur.props.add=cur.props.add.filter(function(p){
      return Math.hypot(p.x-g.x,p.z-g.z)>BRUSH;
    });
    rebuild(); renderPanel(); markEdit();
  }
}
function keydown(ev){
  if(!active) return false;
  var meta=ev.ctrlKey||ev.metaKey;
  if(meta&&(ev.key==="z"||ev.key==="Z")){ ev.preventDefault(); if(ev.shiftKey) redo(); else undo(); return true; }
  if(meta&&(ev.key==="y"||ev.key==="Y")){ ev.preventDefault(); redo(); return true; }
  var K={v:"select",s:"salvage",n:"nest",p:"scenery",x:"erase"};
  if(!meta&&K[ev.key]){ setTool(K[ev.key]); return true; }
  return false;
}

return { init:init, enter:enter, exit:exit, update:update, draw:draw,
         keydown:keydown, buildList:buildList, select:select,
         current:function(){ return cur; },
         isActive:function(){ return active; } };
})();
