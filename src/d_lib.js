// ===========================================================================
// Nightward — Library: asset catalogue + per-part editor
//   · click-to-select in the viewport (unique-colour readback)
//   · undo / redo per asset, with coalescing on rapid field edits
//   · linked repeat groups and Y anchors, so tuning converges
// ===========================================================================
var HFLIB=(function(){
"use strict";
var M=HF;
var R=null, canvas=null, batch=null, hiBatch=null, pickBatch=null, onEdit=null;
var active=false, cur=null, sel=null, showGuides=true;
var az=38, el=27, zoom=6, targetY=0.6, userZoom=false;
var inst=new Float32Array(12), hiInst=new Float32Array(12), pkInst=new Float32Array(12);
var gizBatch=null, gizPick=null, gizInst=new Float32Array(12), gizOK=false, gizRad=1;
var hidden={}, hiOK=false;
var HIST={};                      // assetId -> {u:[],r:[]}
var lastKey=null, lastAt=0;

function E(id){ return document.getElementById(id); }
function round(v,n){ var f=Math.pow(10,n===undefined?3:n); return Math.round(v*f)/f; }
function clone(x){ return JSON.parse(JSON.stringify(x)); }

// ---- transform gizmo ------------------------------------------------------
// Three tools sharing one overlay batch and one ID-coloured pick batch. Handles
// are emissive so they ignore scene lighting, and they are sized from the part's
// own bounds so they always stick out past the geometry you are grabbing.
var AXCOL=[[1.85,0.42,0.36],[0.46,1.75,0.52],[0.44,0.78,1.95]];
var AXV=[[1,0,0],[0,1,0],[0,0,1]];
var TOOL="move";

function axMesh(mode,rad,pick){
  var Mh=new M.Mesh(true);
  // rotations that take +Y onto each axis
  var ROT=[[0,0,-Math.PI/2],[0,0,0],[Math.PI/2,0,0]];
  for(var i=0;i<3;i++){
    var rot=ROT[i], c=pick?[(i+1)/255,0,0]:AXCOL[i], P=M.xform(0,0,0,rot);
    // flat all the way through: the pick pass needs an exact ID and the visible
    // gizmo wants solid colour rather than lit shading
    Mh.flat=c; Mh.emitAll=1.0;
    if(mode==="rotate"){
      // A flat annulus built straight in the ring's own plane — orienting little
      // bars along each chord was where the last version fell apart.
      var seg=40, rr=rad*1.00, th=Math.max(0.018,rad*0.055);
      for(var q=0;q<seg;q++){
        var a0=q/seg*Math.PI*2, a1=(q+1)/seg*Math.PI*2;
        var i0=P(Math.cos(a0)*(rr-th),0,Math.sin(a0)*(rr-th));
        var o0=P(Math.cos(a0)*(rr+th),0,Math.sin(a0)*(rr+th));
        var i1=P(Math.cos(a1)*(rr-th),0,Math.sin(a1)*(rr-th));
        var o1=P(Math.cos(a1)*(rr+th),0,Math.sin(a1)*(rr+th));
        Mh.quad(i0,o0,o1,i1,c,1.0);
        Mh.quad(i1,o1,o0,i0,c,1.0);      // both faces, so it reads from any side
      }
    } else if(mode==="scale"){
      M.box(Mh,0,0,0,rad*0.055,rad*0.92,rad*0.055,rot,c,1.0);
      var t=P(0,rad*0.92,0);
      M.box(Mh,t[0],t[1],t[2],rad*0.16,rad*0.16,rad*0.16,rot,c,1.0);
    } else {
      M.box(Mh,0,0,0,rad*0.055,rad*0.80,rad*0.055,rot,c,1.0);
      var a=P(0,rad*0.80,0);
      M.cone(Mh,a[0],a[1],a[2],rad*0.13,rad*0.30,8,c,rot);
    }
  }
  Mh.flat=null; Mh.emitAll=null;
  return Mh;
}
function gizmoRadius(){
  // sized off the camera, not the part, so handles stay the same size on screen
  // whatever you have selected
  return Math.max(0.25, zoom*0.26)/Math.max(0.05,cur.scale||1);
}
function gizmoOrigin(){
  var pt=partById(sel);
  if(!pt) return [0,0,0];
  var reps=M.expandRep(pt);
  var q=reps[0]?reps[0].p:pt.p;
  return [q[0],q[1],q[2]];
}

// ---- helpers --------------------------------------------------------------
function bracketMesh(bb,t){
  var Mh=new M.Mesh(true);
  var x0=bb.mn[0],y0=bb.mn[1],z0=bb.mn[2],x1=bb.mx[0],y1=bb.mx[1],z1=bb.mx[2];
  var cx=(x0+x1)/2, cy=(y0+y1)/2, cz=(z0+z1)/2;
  var lx=(x1-x0)+t, ly=(y1-y0)+t, lz=(z1-z0)+t, C=[1,1,1];
  function bar(px,py,pz,sx,sy,sz){ M.box(Mh,px,py-sy/2,pz,sx,sy,sz,0,C,1.0); }
  var xx,yy,zz;
  for(yy=0;yy<2;yy++) for(zz=0;zz<2;zz++) bar(cx, yy?y1:y0, zz?z1:z0, lx,t,t);
  for(xx=0;xx<2;xx++) for(yy=0;yy<2;yy++) bar(xx?x1:x0, yy?y1:y0, cz, t,t,lz);
  for(xx=0;xx<2;xx++) for(zz=0;zz<2;zz++) bar(xx?x1:x0, cy+ly/2, zz?z1:z0, t,ly,t);
  return Mh;
}
function bbox(mesh,scale){
  var v=mesh.v, st=mesh.stride(), s=scale||1;
  var mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
  for(var i=0;i<v.length;i+=st) for(var k=0;k<3;k++){
    var q=v[i+k]*s;
    if(q<mn[k]) mn[k]=q;
    if(q>mx[k]) mx[k]=q;
  }
  if(mn[0]>mx[0]){ mn=[0,0,0]; mx=[1,1,1]; }
  return {mn:mn,mx:mx};
}
function flash(btn,msg){
  var old=btn.textContent;
  btn.textContent=msg;
  setTimeout(function(){ btn.textContent=old; },1400);
}

// ---- setup ----------------------------------------------------------------
function init(renderer, cv, editCb){
  R=renderer; canvas=cv; onEdit=editCb;
  batch=R.makeBatch(M.buildAsset("hall"));
  hiBatch=R.makeBatch(bracketMesh({mn:[-1,-1,-1],mx:[1,1,1]},0.02),false);
  gizBatch=R.makeBatch(axMesh("move",1,false),false);
  gizPick=R.makeBatch(axMesh("move",1,true),false);
  pickBatch=R.makeBatch(M.buildAsset("hall",{idColors:true}),false);
  buildList();
  wireInput();
  wireText();
  E("libGuides").addEventListener("click",function(){
    showGuides=!showGuides; this.setAttribute("aria-pressed",showGuides?"true":"false");
  });
  E("libUndo").addEventListener("click",undo);
  E("libRedo").addEventListener("click",redo);
  E("libRevert").addEventListener("click",function(){
    if(!cur) return;
    pushHistory();
    var o=M.getOverrides(); delete o[cur.id]; M.setOverrides(o);
    M.resetStats(cur.id);
    commit(); renderStats(); renderPartList();
    selectPart(parts().length?parts()[0].id:null);
    flash(E("libRevert"),"Reverted");
  });
  E("libCopy").addEventListener("click",function(){ copyOut(false); });
  E("libCopyAll").addEventListener("click",function(){ copyOut(true); });
  E("libBalReset").addEventListener("click",function(){
    if(!cur||!M.hasStats(cur.id)) return;
    pushHistory();
    M.resetStats(cur.id);
    commit(); renderStats();
    flash(E("libBalReset"),"reset ✓");
  });
  E("libNew").addEventListener("click",function(){
    var id=M.newAsset(null);
    buildList(); select(id); if(onEdit) onEdit();
  });
  E("libDupAsset").addEventListener("click",function(){
    if(!cur) return;
    var id=M.newAsset(cur.id);
    buildList(); select(id); if(onEdit) onEdit();
  });
  E("libDelete").addEventListener("click",function(){
    if(!cur||!M.isUser(cur.id)) return;
    var id=cur.id;
    if(!M.deleteAsset(id)) return;
    delete HIST[id];
    buildList(); select(M.allAssets()[0].id); if(onEdit) onEdit();
  });
  E("libSnap").addEventListener("change",function(){ snap=parseFloat(E("libSnap").value)||0; });
  document.querySelectorAll("[data-tool]").forEach(function(b){
    b.addEventListener("click",function(){ setTool(b.dataset.tool); });
  });
  E("libAdd").addEventListener("click",addPart);
  E("libDup").addEventListener("click",dupPart);
  E("libDel").addEventListener("click",delPart);
}

function buildList(){
  var host=E("libList"), groups={}, order=[];
  M.allAssets().forEach(function(a0){
    var a=M.assetMeta(a0.id);
    if(!groups[a.group]){ groups[a.group]=[]; order.push(a.group); }
    groups[a.group].push(a);
  });
  var html="";
  order.forEach(function(g){
    html+='<div class="libGroup">'+g+'</div>';
    groups[g].forEach(function(a){
      html+='<button class="libRow" data-id="'+a.id+'" type="button">'+
            '<span class="ln">'+a.name+'</span>'+
            '<span class="lt" data-tri="'+a.id+'"></span></button>';
    });
  });
  host.innerHTML=html;
  host.querySelectorAll(".libRow").forEach(function(b){
    b.addEventListener("click",function(){ select(b.dataset.id); });
  });
  refreshCounts();
}
function refreshCounts(){
  M.allAssets().forEach(function(a){
    var n=E("libList").querySelector('[data-tri="'+a.id+'"]');
    if(n) n.textContent=(M.buildAsset(a.id).count()/3)+" tri";
  });
}

// ---- working copy + history ----------------------------------------------
function parts(){ return M.partsOf(cur.id); }
function edited(){ return !!M.getOverrides()[cur.id] || M.statsEdited(cur.id) || M.metaEdited(cur.id); }
function ensureWorking(){
  var o=M.getOverrides();
  if(!o[cur.id]) o[cur.id]=M.cloneParts(cur.id);
  M.setOverrides(o);
  return o[cur.id];
}
function hist(){
  if(!HIST[cur.id]) HIST[cur.id]={u:[],r:[]};
  return HIST[cur.id];
}
// A snapshot is the whole editable state of one asset: its part list and its
// balance numbers. Either may be null, meaning "as shipped".
function snapshot(){
  var o=M.getOverrides(), so=M.getStatOverrides();
  return { parts: o[cur.id] ? clone(o[cur.id]) : null,
           stats: so[cur.id] ? clone(so[cur.id]) : null };
}
function pushHistory(key){
  var h=hist(), now=Date.now();
  // rapid edits to the same field collapse into one undo step
  if(key && key===lastKey && now-lastAt<700){ lastAt=now; return; }
  lastKey=key||null; lastAt=now;
  h.u.push(snapshot());
  if(h.u.length>80) h.u.shift();
  h.r.length=0;
  refreshHistBtns();
}
function applySnapshot(sn){
  var o=M.getOverrides();
  if(!sn||sn.parts===null) delete o[cur.id]; else o[cur.id]=clone(sn.parts);
  M.setOverrides(o);
  var so=M.getStatOverrides();
  M.resetStats(cur.id);
  if(sn&&sn.stats) for(var k in sn.stats) M.setStat(cur.id,k,sn.stats[k]);
}
function undo(){
  if(!cur) return;
  var h=hist();
  if(!h.u.length){ return; }
  h.r.push(snapshot());
  applySnapshot(h.u.pop());
  lastKey=null;
  afterHistory();
}
function redo(){
  if(!cur) return;
  var h=hist();
  if(!h.r.length) return;
  h.u.push(snapshot());
  applySnapshot(h.r.pop());
  lastKey=null;
  afterHistory();
}
function afterHistory(){
  commit();
  renderStats();
  renderPartList();
  if(!partById(sel)) sel=parts().length?parts()[0].id:null;
  selectPart(sel);
  refreshHistBtns();
}
function refreshHistBtns(){
  var h=cur?hist():{u:[],r:[]};
  E("libUndo").disabled=!h.u.length;
  E("libRedo").disabled=!h.r.length;
}
function commit(){
  rebuild();
  refreshCounts();
  E("libEditedTag").hidden=!edited();
  refreshHistBtns();
  if(onEdit) onEdit();
}

// ---- selection ------------------------------------------------------------
function select(id){
  var base=M.assetById(id);
  if(!base) return;
  cur=M.assetMeta(id);
  cur.parts=null;
  sel=null; hidden={}; userZoom=false; lastKey=null;
  document.querySelectorAll(".libRow").forEach(function(b){
    b.setAttribute("aria-current", b.dataset.id===id?"true":"false");
  });
  renderMeta();
  renderStats();
  renderPartList();
  selectPart(parts().length?parts()[0].id:null);
  rebuild();
  refreshHistBtns();
}
function selectPart(id){
  sel=id||null;
  document.querySelectorAll(".partRow").forEach(function(b){
    b.setAttribute("aria-current", b.dataset.pid===id?"true":"false");
  });
  renderInspector();
  rebuild();
  showXform();
}
function partById(id){
  if(!id) return null;
  var ps=parts();
  for(var i=0;i<ps.length;i++) if(ps[i].id===id) return ps[i];
  return null;
}
function linkedTo(pt){
  if(!pt||!pt.link) return [];
  return parts().filter(function(q){ return q.link===pt.link && q.id!==pt.id; });
}

// ---- asset metadata -------------------------------------------------------
function hex(c){
  function h(v){ var n=Math.round(Math.max(0,Math.min(1,v))*255).toString(16); return n.length<2?"0"+n:n; }
  return "#"+h(c[0])+h(c[1])+h(c[2]);
}
function unhex(x){
  return [parseInt(x.substr(1,2),16)/255, parseInt(x.substr(3,2),16)/255,
          parseInt(x.substr(5,2),16)/255];
}
// A swatch of what a part will actually look like: base colour times its
// brightness, clamped, so glow colours above 1 still show as something.
function cssCol(c,k){
  function b(v){ return Math.round(Math.max(0,Math.min(1,v*(k===undefined?1:k)))*255); }
  return "rgb("+b(c[0])+","+b(c[1])+","+b(c[2])+")";
}
function renderMeta(){
  var m=M.assetMeta(cur.id);
  cur=m; cur.parts=null;
  E("libName").textContent=m.name;
  E("libGroupTag").textContent=m.group;
  E("libNote").textContent=m.note||"";
  E("libEditedTag").hidden=!edited();
  E("libDelete").disabled=!M.isUser(cur.id);
  var h='<label class="fRow"><span class="fk">Name</span>'+
        '<input type="text" value="'+String(m.name).replace(/"/g,"&quot;")+'" data-meta="name"></label>'+
        '<label class="fRow"><span class="fk">Group</span>'+
        '<input type="text" value="'+String(m.group).replace(/"/g,"&quot;")+'" data-meta="group"></label>'+
        '<label class="fRow"><span class="fk">Play scale</span>'+
        '<input type="number" step="0.01" value="'+round(m.scale,3)+'" data-meta="scale">'+
        '<span class="fh">size in the world</span></label>'+
        '<label class="fRow"><span class="fk">Tint A</span>'+
        '<input type="color" value="'+hex(m.colA)+'" data-meta="colA"></label>'+
        '<label class="fRow"><span class="fk">Tint B</span>'+
        '<input type="color" value="'+hex(m.colB)+'" data-meta="colB"></label>'+
        '<label class="fRow"><span class="fk">Note</span>'+
        '<textarea rows="2" data-meta="note">'+String(m.note||"")+'</textarea></label>';
  E("libMeta").innerHTML=h;
  E("libMeta").querySelectorAll("[data-meta]").forEach(function(inp){
    inp.addEventListener(inp.type==="color"?"input":"input",function(){
      pushHistory(cur.id+"/meta/"+inp.dataset.meta);
      var k=inp.dataset.meta, v;
      if(k==="colA"||k==="colB") v=unhex(inp.value);
      else if(k==="scale") v=parseFloat(inp.value)||1;
      else v=inp.value;
      M.setMeta(cur.id,k,v);
      cur=M.assetMeta(cur.id); cur.parts=null;
      E("libName").textContent=cur.name;
      E("libGroupTag").textContent=cur.group;
      E("libNote").textContent=cur.note||"";
      commit(); buildList();
      E("libList").querySelector('[data-id="'+cur.id+'"]')
        &&E("libList").querySelector('[data-id="'+cur.id+'"]').setAttribute("aria-current","true");
    });
  });
  var sw=E("libSwatch"); sw.innerHTML="";
  [m.colA,m.colB].forEach(function(c,i){
    var d=document.createElement("span");
    d.className="sw";
    d.style.background="rgb("+Math.round(Math.min(1,c[0])*255)+","+
      Math.round(Math.min(1,c[1])*255)+","+Math.round(Math.min(1,c[2])*255)+")";
    d.title=i?"tint B":"tint A";
    sw.appendChild(d);
  });
  var sh=""; (m.slots||[]).forEach(function(x){ sh+="<li>"+x+"</li>"; });
  E("libSlots").innerHTML=sh;
}

// ---- balance panel --------------------------------------------------------
// Numbers that decide how the asset plays, edited in the same place as its
// geometry. Changes apply to a round already in progress.
function renderStats(){
  var host=E("libBalance"), sec=E("libBalSec"), btn=E("libBalReset");
  var defs=cur?M.statDefs(cur.id):null;
  sec.hidden=!defs;
  host.innerHTML="";
  if(!defs) return;
  var vals=M.statsOf(cur.id), over=M.getStatOverrides()[cur.id]||{};
  btn.hidden=!M.statsEdited(cur.id);
  var h='<p id="libBalNote">'+defs.note+'</p>';
  defs.fields.forEach(function(f){
    var dirty=(over[f.k]!==undefined);
    var hint=f.hint||("shipped "+f.def);
    h+='<label class="fRow"><span class="fk'+(dirty?" bEdit":"")+'">'+f.label+'</span>'+
       '<input type="number" value="'+round(vals[f.k],4)+'" step="'+f.step+
       '" min="'+f.lo+'" max="'+f.hi+'" data-stat="'+f.k+'">'+
       '<span class="fh">'+(f.unit?f.unit+" · ":"")+hint+'</span></label>';
  });
  host.innerHTML=h;
  host.querySelectorAll("[data-stat]").forEach(function(inp){
    inp.addEventListener("input",function(){ applyStat(inp); });
  });
}
function applyStat(inp){
  var k=inp.dataset.stat, v=parseFloat(inp.value);
  if(!isFinite(v)) return;
  pushHistory(cur.id+"/stat/"+k);
  M.setStat(cur.id,k,v);
  commit();
  // reflect clamping and the edited markers without stealing the caret
  var vals=M.statsOf(cur.id), over=M.getStatOverrides()[cur.id]||{};
  E("libBalReset").hidden=!M.statsEdited(cur.id);
  E("libBalance").querySelectorAll("[data-stat]").forEach(function(n){
    var key=n.dataset.stat;
    if(n!==inp) n.value=round(vals[key],4);
    n.parentNode.querySelector(".fk").classList.toggle("bEdit",over[key]!==undefined);
  });
}

// ---- part list ------------------------------------------------------------
function renderPartList(){
  var ps=parts(), html="";
  ps.forEach(function(pt){
    var reps=M.expandRep(pt).length;
    html+='<div class="partRow" data-pid="'+pt.id+'" role="button" tabindex="0"'+
          (pt.id===sel?' aria-current="true"':'')+'>'+
      '<span class="pn">'+pt.name+'</span>'+
      (pt.link?'<span class="pLink" title="linked repeat: '+pt.link+'">⇄</span>':'')+
      (pt.anchorY?'<span class="pLink" title="anchored to '+pt.anchorY.to+'">⇧</span>':'')+
      '<span class="pp">'+pt.prim+(reps>1?" ×"+reps:"")+'</span>'+
      '<button class="pEye" data-eye="'+pt.id+'" type="button" title="show / hide" '+
        'aria-pressed="'+(hidden[pt.id]?"false":"true")+'">'+(hidden[pt.id]?"○":"●")+'</button>'+
    '</div>';
  });
  E("libParts").innerHTML=html;
  E("libPartCount").textContent=ps.length;
  E("libParts").querySelectorAll(".partRow").forEach(function(n){
    n.addEventListener("click",function(ev){
      if(ev.target.classList.contains("pEye")) return;
      selectPart(n.dataset.pid);
    });
    n.addEventListener("keydown",function(ev){
      if(ev.key==="Enter"||ev.key===" "){ ev.preventDefault(); selectPart(n.dataset.pid); }
    });
  });
  E("libParts").querySelectorAll(".pEye").forEach(function(b){
    b.addEventListener("click",function(ev){
      ev.stopPropagation();
      hidden[b.dataset.eye]=!hidden[b.dataset.eye];
      renderPartList(); rebuild();
    });
  });
}

// ---- inspector ------------------------------------------------------------
var REP_MODES=[["none","single"],["mirrorX","mirror X"],["mirrorZ","mirror Z"],
  ["mirrorXZ","mirror X+Z"],["linX","row along X"],["linZ","row along Z"],
  ["linY","stack up Y"],["ring","ring"]];

function num(label,val,step,path,hint,dis){
  return '<label class="fRow"><span class="fk">'+label+'</span>'+
    '<input type="number" value="'+round(val)+'" step="'+step+'" data-path="'+path+'"'+
    (dis?" disabled":"")+'>'+(hint?'<span class="fh">'+hint+'</span>':'')+'</label>';
}
function sizeLabels(prim){
  if(prim==="cone"||prim==="cyl") return ["Radius","Height",null];
  if(prim==="ring") return ["Radius",null,null];
  if(prim==="quad") return ["Size X",null,"Size Z"];
  if(prim==="gable") return ["Length X","Rise","Depth Z"];
  return ["Size X","Size Y","Size Z"];
}

function renderInspector(){
  var host=E("libInspect"), pt=partById(sel);
  if(!pt){ host.innerHTML='<p class="libEmpty">Select a part — click it in the viewport or pick it from the list.</p>'; return; }
  var h="", ps=parts();

  h+='<div class="iHead"><input class="iName" value="'+String(pt.name).replace(/"/g,"&quot;")+
     '" data-path="name"><select class="iPrim" data-path="prim">';
  ["box","wedge","gable","cone","cyl","ring","quad","glow","gdisc"].forEach(function(k){
    h+='<option value="'+k+'"'+(pt.prim===k?" selected":"")+'>'+k+'</option>';
  });
  h+='</select></div>';

  // ---- material ----------------------------------------------------------
  var mSlot=pt.col?"custom":(pt.tint?"1":"0");
  var base=pt.col?pt.col:(pt.tint?cur.colB:cur.colA);
  var shv=(pt.shade===undefined?1:pt.shade);
  h+='<div class="fGroup">Material</div>';
  h+='<label class="fRow"><span class="fk">Colour</span>'+
     '<select data-path="colMode">'+
     '<option value="0"'+(mSlot==="0"?" selected":"")+'>Tint A — shared</option>'+
     '<option value="1"'+(mSlot==="1"?" selected":"")+'>Tint B — shared</option>'+
     '<option value="custom"'+(mSlot==="custom"?" selected":"")+'>Custom — this part</option>'+
     '</select>'+
     '<span class="fh">'+(pt.col?"independent of the asset tints"
        :"follows "+(pt.tint?"tint B":"tint A")+", so recolouring the asset moves it")+'</span></label>';
  if(pt.col)
    h+='<label class="fRow"><span class="fk">Custom</span>'+
       '<input type="color" value="'+hex(pt.col)+'" data-path="col"></label>';
  h+='<label class="fRow"><span class="fk">Brightness</span>'+
     '<input type="range" min="0.15" max="1.6" step="0.01" value="'+shv+'" data-path="shade">'+
     '<span class="fh">'+round(shv,2)+' × base'+
     '<i class="mSw" style="background:'+cssCol(base,shv)+'"></i></span></label>';
  h+='<label class="fRow"><span class="fk">Finish</span><select data-path="mat">';
  M.MAT_MODES.forEach(function(m,i){
    h+='<option value="'+i+'"'+((Math.round(pt.mat||0))===i?" selected":"")+'>'+m[0]+'</option>';
  });
  h+='</select><span class="fh">'+M.MAT_MODES[Math.round(pt.mat||0)][1]+'</span></label>';
  h+='<label class="fRow"><span class="fk">Glow</span>'+
     '<input type="checkbox" data-path="emit"'+(pt.emit?" checked":"")+'>'+
     '<span class="fh">lit from within — ignores sun and shadow</span></label>';
  if(pt.emit)
    h+='<label class="fRow"><span class="fk">Glow colour</span>'+
       '<input type="color" value="'+hex(pt.ecol||[1.9,1.16,0.46])+'" data-path="ecol">'+
       '<span class="fh">brightens after dusk</span></label>';

  // ---- surface -----------------------------------------------------------
  var tex=pt.tex||"none";
  h+='<div class="fGroup">Surface</div>';
  h+='<label class="fRow"><span class="fk">Grain</span><select data-path="tex">';
  M.TEX_MODES.forEach(function(t){
    h+='<option value="'+t[0]+'"'+(tex===t[0]?" selected":"")+'>'+t[1]+'</option>';
  });
  h+='</select>'+(tex==="none"?'<span class="fh">flat faces — cheapest</span>':'')+'</label>';
  if(tex!=="none"){
    var amt=(pt.texAmt===undefined?0.35:pt.texAmt);
    h+='<label class="fRow"><span class="fk">Depth</span>'+
       '<input type="range" min="0" max="1" step="0.01" value="'+amt+'" data-path="texAmt">'+
       '<span class="fh">'+round(amt,2)+'</span></label>';
    h+=num("Detail",pt.tess||3,1,"tess","cells per face edge — "+
           Math.pow(Math.max(1,Math.round(pt.tess||3)),2)*2+" triangles per face");
  }

  h+='<div class="fGroup">Placement</div>';
  h+='<label class="fRow"><span class="fk">Anchor Y to</span><select data-path="anchorY.to">'+
     '<option value="">— free —</option>';
  ps.forEach(function(q){
    if(q.id===pt.id) return;
    h+='<option value="'+q.id+'"'+(pt.anchorY&&pt.anchorY.to===q.id?" selected":"")+'>'+q.name+'</option>';
  });
  h+='</select></label>';
  if(pt.anchorY){
    h+='<label class="fRow"><span class="fk">Anchor edge</span><select data-path="anchorY.mode">'+
       '<option value="top"'+(pt.anchorY.mode!=="bottom"?" selected":"")+'>top</option>'+
       '<option value="bottom"'+(pt.anchorY.mode==="bottom"?" selected":"")+'>base</option>'+
       '</select></label>';
    h+=num("Anchor offset",pt.anchorY.off||0,0.01,"anchorY.off",
           "effective Y "+round(M.anchoredY(ps,pt),3));
  }
  var shapeH="";
  if(pt.prim==="cone"||pt.prim==="cyl"||pt.prim==="ring") shapeH+=num("Segments",pt.seg||6,1,"seg");
  if(pt.prim==="cyl")
    shapeH+='<label class="fRow"><span class="fk">End cap</span>'+
       '<input type="checkbox" data-path="cap"'+(pt.cap!==false?" checked":"")+'></label>';
  if(pt.prim==="ring") shapeH+=num("Line weight",pt.weight===undefined?0.015:pt.weight,0.001,"weight");
  if(pt.prim==="gable"){
    shapeH+=num("Shingle courses",pt.courses||0,1,"courses","0 for a smooth roof");
    shapeH+=num("Eave overhang",pt.over===undefined?0.20:pt.over,0.01,"over");
  }
  if(shapeH) h+='<div class="fGroup">Shape</div>'+shapeH;

  var rep=pt.rep||{mode:"none"}, sib=linkedTo(pt);
  h+='<div class="fGroup">Repeat</div>';
  h+='<label class="fRow"><span class="fk">Link group</span>'+
     '<input type="text" value="'+String(pt.link||"").replace(/"/g,"&quot;")+
     '" placeholder="—" data-path="link">'+
     (sib.length?'<span class="fh">shared with '+sib.map(function(q){return q.name;}).join(", ")+'</span>'
                :'<span class="fh">name it to share repeat settings</span>')+'</label>';
  h+='<label class="fRow"><span class="fk">Pattern</span><select data-path="rep.mode">';
  REP_MODES.forEach(function(m){
    h+='<option value="'+m[0]+'"'+(rep.mode===m[0]?" selected":"")+'>'+m[1]+'</option>';
  });
  h+='</select></label>';
  if(rep.mode==="linX"||rep.mode==="linZ"||rep.mode==="linY"||rep.mode==="ring"){
    h+=num("Count",rep.n===undefined?3:rep.n,1,"rep.n");
    if(rep.mode==="ring"){
      h+=num("Radius",rep.r===undefined?1:rep.r,0.01,"rep.r");
      h+=num("Start °",rep.a0||0,1,"rep.a0");
    } else h+=num("Step",rep.step===undefined?0.3:rep.step,0.01,"rep.step");
    h+=num("Rise / step",rep.rise||0,0.01,"rep.rise");
    h+=num("Alt jog Y",rep.jog||0,0.01,"rep.jog","every other copy");
    h+=num("Taper",rep.taper===undefined?1:rep.taper,0.01,"rep.taper","scale × per copy");
  }
  if(rep.mode&&rep.mode!=="none") h+=num("Alt shade",rep.altShade||0,0.01,"rep.altShade");

  host.innerHTML=h;
  host.querySelectorAll("[data-path]").forEach(function(inp){
    var ev=(inp.type==="checkbox"||inp.tagName==="SELECT")?"change":"input";
    inp.addEventListener(ev,function(){ applyField(inp); });
  });
}

var REP_SHARED={n:1,step:1,r:1,a0:1,rise:1,jog:1,taper:1,altShade:1,mode:1};

// Refresh one row's hint (and the material swatch) without re-rendering the
// inspector, which would yank the control out from under a live drag.
function liveHint(inp,text,pt){
  if(text!==null&&text!==undefined){
    var row=inp.closest?inp.closest(".fRow"):null;
    var fh=row&&row.querySelector(".fh");
    if(fh){
      var keep=fh.querySelector(".mSw");
      fh.textContent=text;
      if(keep) fh.appendChild(keep);
    }
  }
  if(!pt) return;
  var sw=E("libInspect").querySelector(".mSw");
  if(!sw) return;
  var base=pt.col?pt.col:(pt.tint?cur.colB:cur.colA);
  sw.style.background=cssCol(base,(pt.shade===undefined?1:pt.shade));
}

function applyField(inp){
  var path=inp.dataset.path;
  pushHistory(cur.id+"/"+sel+"/"+path);
  var live=ensureWorking(), pt=null, i;
  for(i=0;i<live.length;i++) if(live[i].id===sel) pt=live[i];
  if(!pt) return;

  var val = inp.type==="checkbox" ? inp.checked
          : (inp.type==="text"||inp.type==="color"||inp.tagName==="SELECT") ? inp.value
          : parseFloat(inp.value);
  if(typeof val==="number" && !isFinite(val)) return;

  var reRender=false;
  if(path==="name"){ pt.name=String(val); renderPartList(); return; }
  else if(path==="link"){ pt.link=String(val).trim()||undefined; reRender=true; }
  else if(path.indexOf("rot.")===0){
    var ri=parseInt(path.slice(4),10);
    var cr=M.partRot(pt);
    cr[ri]=val*Math.PI/180;
    pt.rot=cr; delete pt.r;
  }
  else if(path==="prim"){ pt.prim=String(val); reRender=true; }
  else if(path==="courses") pt.courses=Math.max(0,Math.round(val));
  else if(path==="colMode"){
    if(val==="custom"){
      // seed the picker from whichever shared tint it was using, so switching
      // to custom does not change how the part looks
      if(!pt.col) pt.col=(pt.tint?cur.colB:cur.colA).slice();
    } else { delete pt.col; pt.tint=parseInt(val,10)||0; }
    reRender=true;
  }
  // colours and sliders fire continuously while dragging, so they update the
  // hint text in place rather than rebuilding the panel out from under the
  // control the user is still holding
  else if(path==="col"){ pt.col=unhex(String(val)); liveHint(inp,null,pt); }
  else if(path==="ecol"){ pt.ecol=unhex(String(val)); }
  else if(path==="mat") pt.mat=parseInt(val,10)||0;
  else if(path==="tex"){
    if(val==="none") delete pt.tex; else pt.tex=String(val);
    if(pt.tex&&pt.tess===undefined) pt.tess=3;
    reRender=true;
  }
  else if(path==="texAmt"){ pt.texAmt=val; liveHint(inp,round(val,2)); }
  else if(path==="tess"){
    pt.tess=Math.max(1,Math.min(8,Math.round(val)));
    liveHint(inp,"cells per face edge — "+(pt.tess*pt.tess*2)+" triangles per face");
  }
  else if(path==="shade"){ pt.shade=val; liveHint(inp,round(val,2)+" × base",pt); }
  else if(path==="tint") pt.tint=parseInt(val,10)||0;
  else if(path==="emit"){ pt.emit=!!val; reRender=true; }
  else if(path==="cap") pt.cap=!!val;
  else if(path==="anchorY.to"){
    if(!val) delete pt.anchorY;
    else pt.anchorY={to:val, mode:(pt.anchorY&&pt.anchorY.mode)||"top", off:(pt.anchorY&&pt.anchorY.off)||0};
    reRender=true;
  }
  else if(path==="anchorY.mode"){ if(pt.anchorY){ pt.anchorY.mode=val; reRender=true; } }
  else if(path==="anchorY.off"){ if(pt.anchorY){ pt.anchorY.off=val; reRender=true; } }
  else if(path.indexOf("p.")===0) pt.p[parseInt(path.slice(2),10)]=val;
  else if(path.indexOf("s.")===0){
    var k=parseInt(path.slice(2),10);
    if(!pt.s) pt.s=[1,1,1];
    while(pt.s.length<=k) pt.s.push(pt.s[0]);
    pt.s[k]=val;
    if(pt.s[1]!==undefined) reRender=true;      // anchored siblings may move
  }
  else if(path.indexOf("rep.")===0){
    var f=path.slice(4);
    if(!pt.rep) pt.rep={mode:"none"};
    pt.rep[f]=val;
    // linked parts share repeat settings — edit one, move them all
    if(pt.link && REP_SHARED[f]){
      for(i=0;i<live.length;i++){
        if(live[i].id!==pt.id && live[i].link===pt.link){
          if(!live[i].rep) live[i].rep={mode:"none"};
          live[i].rep[f]=val;
        }
      }
    }
    if(f==="mode") reRender=true;
  }
  else pt[path]=val;

  commit();
  renderPartList();
  if(reRender) renderInspector();

}

// ---- add / duplicate / delete --------------------------------------------
function uniqueId(base){
  var live=parts(), n=1, id=base;
  function taken(x){ for(var i=0;i<live.length;i++) if(live[i].id===x) return true; return false; }
  while(taken(id)) id=base+(++n);
  return id;
}
function addPart(){
  if(!cur) return;
  pushHistory();
  var live=ensureWorking(), id=uniqueId("part");
  live.push({id:id,name:"New box",prim:"box",p:[0,0,0],s:[0.4,0.4,0.4],shade:1.0});
  commit(); renderPartList(); selectPart(id);
}
function dupPart(){
  if(!cur||!sel) return;
  pushHistory();
  var live=ensureWorking(), src=null, i;
  for(i=0;i<live.length;i++) if(live[i].id===sel) src=live[i];
  if(!src) return;
  var copy=clone(src);
  copy.id=uniqueId(src.id+"-copy");
  copy.name=src.name+" copy";
  live.splice(live.indexOf(src)+1,0,copy);
  commit(); renderPartList(); selectPart(copy.id);
}
function delPart(){
  if(!cur||!sel) return;
  var live0=parts();
  if(live0.length<=1){ flash(E("libDel"),"Keep one"); return; }
  pushHistory();
  var live=ensureWorking();
  for(var i=0;i<live.length;i++) if(live[i].id===sel){ live.splice(i,1); break; }
  commit(); renderPartList(); selectPart(parts().length?parts()[0].id:null);
}

// ---- export ---------------------------------------------------------------
function exportText(all){
  if(all){
    var o=M.getOverrides(), so=M.getStatOverrides(), P={}, T={}, k;
    for(k in o) P[k]=o[k];
    for(k in so) if(M.statsEdited(k)) T[k]=so[k];
    return JSON.stringify({parts:P, stats:T},null,2);
  }
  var one={id:cur.id, parts:parts()};
  if(M.hasStats(cur.id)) one.stats=M.statsOf(cur.id);
  return JSON.stringify(one,null,2);
}
function copyOut(all){
  var txt=exportText(all);
  E("libOut").value=txt;
  E("libOutWrap").hidden=false;
  var btn=all?E("libCopyAll"):E("libCopy");
  function fallback(){
    E("libOut").select();
    try{ document.execCommand("copy"); flash(btn,"Copied"); }
    catch(e){ flash(btn,"Select & copy ↓"); }
  }
  if(navigator.clipboard&&navigator.clipboard.writeText)
    navigator.clipboard.writeText(txt).then(function(){ flash(btn,"Copied"); },fallback);
  else fallback();
}

// ---- render ---------------------------------------------------------------
function rebuild(){
  var mesh=M.buildAsset(cur.id,{hide:hidden});
  R.rebuildBatch(batch,mesh);
  R.rebuildBatch(pickBatch,M.buildAsset(cur.id,{idColors:true,hide:hidden}));

  var full=M.buildAsset(cur.id);
  var bb=bbox(full,cur.scale||1);
  var hgt=bb.mx[1]-bb.mn[1], wide=Math.max(bb.mx[0]-bb.mn[0],bb.mx[2]-bb.mn[2]);
  targetY=(bb.mn[1]+bb.mx[1])/2;
  if(!userZoom) zoom=Math.max(hgt*0.80,wide*0.90)+0.55;
  R.setStatic(M.meshPedestal(Math.max(1.0,wide*0.78+0.55)));

  if(sel&&!hidden[sel]){
    var pm=M.buildAsset(cur.id,{only:sel});
    if(pm.count()){
      var pb=bbox(pm,1);
      var span=Math.max(pb.mx[0]-pb.mn[0],pb.mx[1]-pb.mn[1],pb.mx[2]-pb.mn[2]);
      R.rebuildBatch(hiBatch,bracketMesh(pb,Math.max(0.014,span*0.020)));
      hiOK=true;
    } else hiOK=false;
  } else hiOK=false;

  rebuildGizmo();
  E("libTris").textContent=(full.count()/3).toLocaleString();
  E("libVerts").textContent=full.count().toLocaleString();
}

function rebuildGizmo(){
  if(!gizBatch||!cur||!sel||hidden[sel]){ gizOK=false; return; }
  gizRad=gizmoRadius();
  R.rebuildBatch(gizBatch,axMesh(TOOL,gizRad,false));
  R.rebuildBatch(gizPick,axMesh(TOOL,gizRad,true));
  gizOK=true;
}
function setTool(t){
  TOOL=t;
  document.querySelectorAll("[data-tool]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.tool===t?"true":"false");
  });
  rebuildGizmo();
  showXform();
}
function showXform(){
  var pt=partById(sel), n=E("libXform");
  if(!n) return;
  if(!pt){ n.textContent=""; return; }
  var r=M.partRot(pt), s2=pt.s||[1,1,1];
  n.innerHTML='<b>'+pt.name+'</b>'+
    '<span>pos '+round(pt.p[0],2)+' '+round(pt.p[1],2)+' '+round(pt.p[2],2)+'</span>'+
    '<span>rot '+Math.round(r[0]*180/Math.PI)+'° '+Math.round(r[1]*180/Math.PI)+'° '+
      Math.round(r[2]*180/Math.PI)+'°</span>'+
    '<span>size '+round(s2[0],2)+' '+round(s2[1]===undefined?1:s2[1],2)+' '+
      round(s2[2]===undefined?s2[0]:s2[2],2)+'</span>';
}

function enter(){
  active=true;
  if(!cur) select(M.allAssets()[0].id);
  else { renderStats(); renderPartList(); rebuild(); refreshHistBtns(); }
}
function exit(){ active=false; }
function update(){}   // the viewport only moves when you drag it

function camera(){
  var a=az*Math.PI/180, e=el*Math.PI/180;
  var sz=R.size(), aspect=(sz[0]||16)/(sz[1]||9);
  var dir=[Math.cos(e)*Math.cos(a),Math.sin(e),Math.cos(e)*Math.sin(a)];
  var target=[0,targetY,0], eye=[dir[0]*90,target[1]+dir[1]*90,dir[2]*90];
  var f=M.nz([-dir[0],-dir[1],-dir[2]]);
  var r=M.nz(M.crs(f,[0,1,0])), u=M.crs(r,f);
  return { vp:M.mul(M.ortho(-zoom*aspect,zoom*aspect,-zoom,zoom,1,240),
                    M.lookAt(eye,target,[0,1,0])), eye:eye, r:r, u:u, zoom:zoom };
}
function setInst(arr,ca,cb,s){
  arr[0]=0;arr[1]=0;arr[2]=0;arr[3]=0;
  arr[4]=ca[0];arr[5]=ca[1];arr[6]=ca[2];arr[7]=s;
  arr[8]=cb[0];arr[9]=cb[1];arr[10]=cb[2];arr[11]=0;
}
function draw(){
  if(!active||!cur) return;
  var s=cur.scale||1;
  setInst(inst,cur.colA,cur.colB,s);
  R.setInstances(batch,inst,1);
  // An overlay asset is previewed the way the game draws it: in the blended
  // decal pass, so a ring segment shows as the soft mark it becomes on the
  // field rather than as an opaque quad with a black rim around it. The
  // contact shade is the one that subtracts rather than adds.
  var deco=(cur&&cur.group==="Overlays")?
             [Object.assign(batch,{blend:cur.id==="shadepatch"?"mul":"add"})]:null;
  var list=deco?[]:[batch], over=[];
  if(sel&&showGuides&&hiOK&&!hidden[sel]){
    setInst(hiInst,[1.55,0.82,0.36],[1.55,0.82,0.36],s);
    R.setInstances(hiBatch,hiInst,1);
    list.push(hiBatch);
  }
  if(gizOK&&sel&&!hidden[sel]){
    var o=gizmoOrigin();
    gizInst[0]=o[0]*s; gizInst[1]=o[1]*s; gizInst[2]=o[2]*s; gizInst[3]=0;
    gizInst[4]=1;gizInst[5]=1;gizInst[6]=1;gizInst[7]=s;
    gizInst[8]=1;gizInst[9]=1;gizInst[10]=1;gizInst[11]=0;
    R.setInstances(gizBatch,gizInst,1);
    over.push(gizBatch);
  }
  R.render(camera(),list,null,over,deco);
}

// ---- input ----------------------------------------------------------------
// Dragging on the selected part moves it; dragging anywhere else orbits. Screen
// pixels are converted through the camera's own right/up axes, so a drag pushes
// the part the way it looks like it should whatever angle you are viewing from.
var drag=false,lx=0,ly=0,moved=0,downX=0,downY=0;
var moving=false, movePart=null, snap=0.05;
var gAxis=-1, gStart=null, gAng0=0, gCentre=null;
function projPt(vp,x,y,z,rect){
  var w=vp[3]*x+vp[7]*y+vp[11]*z+vp[15]; if(!w) w=1;
  return [ ((vp[0]*x+vp[4]*y+vp[8]*z+vp[12])/w*0.5+0.5)*rect.width+rect.left,
           (1-((vp[1]*x+vp[5]*y+vp[9]*z+vp[13])/w*0.5+0.5))*rect.height+rect.top ];
}
function handleUnder(cssX,cssY){
  if(!gizOK||!sel) return -1;
  var rect=canvas.getBoundingClientRect(), sc=cur.scale||1, o=gizmoOrigin();
  gizInst[0]=o[0]*sc; gizInst[1]=o[1]*sc; gizInst[2]=o[2]*sc; gizInst[3]=0;
  gizInst[4]=1;gizInst[5]=1;gizInst[6]=1;gizInst[7]=sc;
  gizInst[8]=1;gizInst[9]=1;gizInst[10]=1;gizInst[11]=0;
  R.setInstances(gizPick,gizInst,1);
  var idx=R.pickAt(camera(),gizPick,cssX-rect.left,cssY-rect.top,rect.width,rect.height);
  return idx?idx-1:-1;
}
// A vector rotated back into the part's own frame, for local-axis scaling.
function unrot(v,rot){
  var rx=rot[0]||0, ry=rot[1]||0, rz=rot[2]||0;
  var cY=Math.cos(-ry),sY=Math.sin(-ry);
  var x1=v[0]*cY+v[2]*sY, z1=-v[0]*sY+v[2]*cY, y1=v[1];
  var cX=Math.cos(-rx),sX=Math.sin(-rx);
  var y2=y1*cX-z1*sX, z2=y1*sX+z1*cX;
  var cZ=Math.cos(-rz),sZ=Math.sin(-rz);
  return [x1*cZ-y2*sZ, x1*sZ+y2*cZ, z2];
}
function snapv(v){ return snap>0 ? Math.round(v/snap)*snap : v; }
function livePart(id){
  var live=ensureWorking();
  for(var i=0;i<live.length;i++) if(live[i].id===id) return live[i];
  return null;
}
function nudge(dx,dy,dz){
  if(!cur||!sel) return;
  pushHistory(cur.id+"/"+sel+"/nudge");
  var pt=livePart(sel);
  if(!pt) return;
  var st=snap>0?snap:0.05;
  pt.p=[round(pt.p[0]+dx*st,4), round(pt.p[1]+dy*st,4), round(pt.p[2]+dz*st,4)];
  commit(); renderInspector();
}
function partUnder(cssX,cssY){
  var rect=canvas.getBoundingClientRect();
  setInst(pkInst,[1,1,1],[1,1,1],cur.scale||1);
  R.setInstances(pickBatch,pkInst,1);
  var idx=R.pickAt(camera(),pickBatch,cssX-rect.left,cssY-rect.top,rect.width,rect.height);
  if(!idx) return null;
  var ps=parts();
  return (idx-1<ps.length)?ps[idx-1].id:null;
}
function pickPart(cssX,cssY){
  var id=partUnder(cssX,cssY);
  if(id) selectPart(id);
}
function wireInput(){
  canvas.addEventListener("pointerdown",function(ev){
    if(!active) return;
    drag=true; lx=downX=ev.clientX; ly=downY=ev.clientY; moved=0;
    moving=false; movePart=null; gAxis=-1;
    // Only a gizmo handle starts an edit drag. Dragging anywhere else orbits,
    // and a press that does not travel is a click: select what is under it, or
    // deselect when that is nothing.
    if(!ev.altKey&&sel){
      var hAx=handleUnder(ev.clientX,ev.clientY);
      if(hAx>=0){
        var gp=partById(sel);
        if(gp){
          gAxis=hAx; moving=true; movePart=sel;
          var r0=M.partRot(gp), sz=gp.s||[1,1,1];
          gStart={p:[gp.p[0],gp.p[1],gp.p[2]], r:[r0[0],r0[1],r0[2]],
                  s:[sz[0], sz[1]===undefined?1:sz[1], sz[2]===undefined?sz[0]:sz[2]]};
          var rect0=canvas.getBoundingClientRect(), C0=camera(), o0=gizmoOrigin(), sc0=cur.scale||1;
          gCentre=projPt(C0.vp,o0[0]*sc0,o0[1]*sc0,o0[2]*sc0,rect0);
          gAng0=Math.atan2(ev.clientY-gCentre[1],ev.clientX-gCentre[0]);
        }
      }
    }
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener("pointermove",function(ev){
    if(!active||!drag) return;
    moved+=Math.abs(ev.clientX-lx)+Math.abs(ev.clientY-ly);
    if(moving&&movePart&&gAxis>=0){
      var C=camera(), rect=canvas.getBoundingClientRect();
      var wpp=(2*C.zoom)/Math.max(1,rect.height);
      var dx=(ev.clientX-downX)*wpp, dy=-(ev.clientY-downY)*wpp;
      var w=[C.r[0]*dx+C.u[0]*dy, C.r[1]*dx+C.u[1]*dy, C.r[2]*dx+C.u[2]*dy];
      pushHistory(cur.id+"/"+movePart+"/"+(gAxis>=0?TOOL+gAxis:"drag"));
      var pt=livePart(movePart);
      if(pt){
        if(gAxis>=0){
          var A=AXV[gAxis];
          if(TOOL==="move"){
            var d=w[0]*A[0]+w[1]*A[1]+w[2]*A[2];
            // snap only the axis being dragged; the other two keep their exact
            // values rather than being quietly pulled onto the grid
            var np=[gStart.p[0],gStart.p[1],gStart.p[2]];
            np[gAxis]=snapv(gStart.p[gAxis]+d);
            pt.p=np;
          } else if(TOOL==="scale"){
            var lw=unrot(w,gStart.r);
            var dl=lw[gAxis]*(gAxis===1?1:2);      // width/depth grow both ways
            var ns=Math.max(0.02,gStart.s[gAxis]+dl);
            var s2=[gStart.s[0],gStart.s[1],gStart.s[2]];
            s2[gAxis]=snap>0?Math.max(0.02,Math.round(ns/snap)*snap):ns;
            pt.s=s2;
          } else {
            var ang=Math.atan2(ev.clientY-gCentre[1],ev.clientX-gCentre[0]);
            var da=ang-gAng0;
            while(da>Math.PI) da-=Math.PI*2;
            while(da<-Math.PI) da+=Math.PI*2;
            var view=[C.r[1]*C.u[2]-C.r[2]*C.u[1], C.r[2]*C.u[0]-C.r[0]*C.u[2],
                      C.r[0]*C.u[1]-C.r[1]*C.u[0]];
            if(view[0]*A[0]+view[1]*A[1]+view[2]*A[2] < 0) da=-da;
            var step=Math.PI/36;                    // 5° snap
            var nr=[gStart.r[0],gStart.r[1],gStart.r[2]];
            nr[gAxis]=snap>0?Math.round((gStart.r[gAxis]+da)/step)*step:(gStart.r[gAxis]+da);
            pt.rot=nr; delete pt.r;
          }
        }
        commit(); showXform();
      }
      lx=ev.clientX; ly=ev.clientY;
      return;
    }
    az-=(ev.clientX-lx)*0.35;
    el=Math.max(4,Math.min(86,el+(ev.clientY-ly)*0.20));
    lx=ev.clientX; ly=ev.clientY;
  });
  function up(ev){
    if(active&&drag&&moved<5&&ev&&!moving){
      var id=partUnder(ev.clientX,ev.clientY);
      selectPart(id||null);                       // empty space clears the selection
    }
    if(moving){ renderInspector(); showXform(); }
    drag=false; moving=false; movePart=null; gAxis=-1;
    if(ev&&ev.pointerId!==undefined&&canvas.hasPointerCapture(ev.pointerId))
      canvas.releasePointerCapture(ev.pointerId);
  }
  canvas.addEventListener("pointerup",up);
  canvas.addEventListener("pointercancel",function(){ drag=false; });
  canvas.addEventListener("wheel",function(ev){
    if(!active) return;
    ev.preventDefault();
    userZoom=true;
    zoom=Math.max(0.4,Math.min(28,zoom*(1+Math.sign(ev.deltaY)*0.10)));
    rebuildGizmo();
  },{passive:false});
}
function keydown(ev){
  if(!active) return false;
  // W/E/R are tool shortcuts, and every one of them is also a letter somebody
  // is trying to type into a text field. The field wins.
  var tg=ev.target&&ev.target.tagName;
  if(txMode==="text"||tg==="TEXTAREA"||tg==="INPUT") return false;
  var meta=ev.ctrlKey||ev.metaKey;
  if(meta&&(ev.key==="z"||ev.key==="Z")){
    ev.preventDefault();
    if(ev.shiftKey) redo(); else undo();
    return true;
  }
  if(meta&&(ev.key==="y"||ev.key==="Y")){ ev.preventDefault(); redo(); return true; }
  if(!meta&&(ev.key==="w"||ev.key==="W")){ setTool("move"); return true; }
  if(!meta&&(ev.key==="e"||ev.key==="E")){ setTool("rotate"); return true; }
  if(!meta&&(ev.key==="r"||ev.key==="R")){ setTool("scale"); return true; }
  var K={ArrowLeft:[-1,0,0],ArrowRight:[1,0,0],ArrowUp:[0,0,-1],ArrowDown:[0,0,1]};
  if(K[ev.key]){
    ev.preventDefault();
    var d=K[ev.key];
    if(ev.shiftKey) nudge(0,d[0]||-d[2],0); else nudge(d[0],0,d[2]);
    return true;
  }
  return false;
}

// ===========================================================================
// The text tab
// ===========================================================================
// The model editor and this one share the screen and nothing else: this one has
// no asset, no history and no 3D, because a string is not a thing you can undo
// a drag on. What it does share is `onEdit` — the same persist-and-refresh hook
// the balance sliders use — so a word typed here reaches the running game by
// exactly the route a number does.
var txMode="models", txFind="", txGroup="all";
function setLibMode(m){
  txMode=(m==="text")?"text":"models";
  document.body.dataset.libmode=txMode;
  E("libModeModels").setAttribute("aria-pressed",txMode==="models"?"true":"false");
  E("libModeText").setAttribute("aria-pressed",txMode==="text"?"true":"false");
  E("libEyebrow").textContent = txMode==="text"
    ? "edit any word in the game" : "edit any model in the game";
  // Undo/redo belong to the model editor's history, which text edits are not in.
  E("libUndo").hidden=E("libRedo").hidden=(txMode==="text");
  if(txMode==="text") renderText();
}
// A def's placeholders are the one thing an edit can break that the eye will
// not catch: a line that loses its {n} still reads fine and just has no number
// in it. So they are listed beside the key and checked on every keystroke.
function missingVars(key,val){
  var want=M.textVars(key), out=[];
  for(var i=0;i<want.length;i++)
    if(val.indexOf("{"+want[i]+"}")<0) out.push(want[i]);
  return out;
}
function txMatch(key){
  if(txGroup!=="all" && M.textDef(key).g!==txGroup) return false;
  if(!txFind) return true;
  var q=txFind.toLowerCase();
  return key.toLowerCase().indexOf(q)>=0 ||
         String(M.textRaw(key)).toLowerCase().indexOf(q)>=0;
}
function renderText(){
  var groups=M.textGroups(), keys=M.textKeys();
  var gb=E("libTextGroups");
  if(!gb.childElementCount){
    var gh='<button type="button" data-g="all" aria-pressed="true">All</button>';
    groups.forEach(function(g){
      gh+='<button type="button" data-g="'+g.id+'" aria-pressed="false">'+g.name+'</button>';
    });
    gb.innerHTML=gh;
    gb.querySelectorAll("[data-g]").forEach(function(b){
      b.addEventListener("click",function(){
        txGroup=b.dataset.g;
        gb.querySelectorAll("[data-g]").forEach(function(o){
          o.setAttribute("aria-pressed",o.dataset.g===txGroup?"true":"false");
        });
        renderText();
      });
    });
  }
  var shown=keys.filter(txMatch), html="", lastG=null, edits=0;
  keys.forEach(function(k){ if(M.textEdited(k)) edits++; });
  groups.forEach(function(g){
    var mine=shown.filter(function(k){ return M.textDef(k).g===g.id; });
    if(!mine.length) return;
    html+='<div class="tGroup">'+g.name+'</div>';
    mine.forEach(function(k){
      var v=M.textRaw(k), on=M.textEdited(k), vars=M.textVars(k);
      html+='<div class="tRow'+(on?' tIsEdit':'')+'" data-row="'+k+'">'+
            '<div class="tKey'+(on?' tEdit':'')+'">'+k+
              (vars.length?'<span class="tVars">{'+vars.join("} {")+'}</span>':'')+'</div>'+
            '<textarea data-key="'+k+'" rows="1" spellcheck="false"></textarea>'+
            '<button class="tUndo" type="button" data-undo="'+k+'">reset</button></div>';
    });
  });
  E("libTextList").innerHTML=html ||
    '<p class="libEmpty" style="padding:14px 0">Nothing matches that.</p>';
  // set values as properties, never as markup: a string with a quote or an
  // angle bracket in it must not be able to close the field it lives in
  E("libTextList").querySelectorAll("[data-key]").forEach(function(ta){
    ta.value=M.textRaw(ta.dataset.key);
    fitRow(ta);
    ta.addEventListener("input",function(){ applyTextEdit(ta); });
  });
  E("libTextList").querySelectorAll("[data-undo]").forEach(function(b){
    b.addEventListener("click",function(){
      M.resetText(b.dataset.undo);
      commitText();
      renderText();
    });
  });
  E("libTextCount").textContent=shown.length+" of "+keys.length+
    (edits?" · "+edits+" edited":"");
  E("libTextRevert").disabled=!edits;
  checkTextWarn();
}
function fitRow(ta){
  ta.style.height="auto";
  ta.style.height=Math.min(150,Math.max(31,ta.scrollHeight+2))+"px";
}
function applyTextEdit(ta){
  var k=ta.dataset.key;
  M.setText(k,ta.value);
  commitText();
  fitRow(ta);
  var row=ta.closest(".tRow"), on=M.textEdited(k);
  row.classList.toggle("tIsEdit",on);
  row.querySelector(".tKey").classList.toggle("tEdit",on);
  ta.classList.toggle("tBad",missingVars(k,ta.value).length>0);
  var edits=0;
  M.textKeys().forEach(function(key){ if(M.textEdited(key)) edits++; });
  E("libTextRevert").disabled=!edits;
  checkTextWarn();
}
function checkTextWarn(){
  var bad=[];
  M.textKeys().forEach(function(k){
    var miss=missingVars(k,String(M.textRaw(k)));
    if(miss.length) bad.push(k+" is missing {"+miss.join("} {")+"}");
  });
  var w=E("libTextWarn");
  w.hidden=!bad.length;
  w.textContent=bad.length
    ? (bad.length===1?bad[0]:bad.length+" lines have lost a placeholder: "+bad[0]+", …")
    : "";
}
// The same shape the asset export uses: a block you paste back into d_core.js,
// so an edit made in a browser can become the shipped default.
function copyTextEdits(){
  var over=M.getTextOverrides(), keys=Object.keys(over).sort(), out;
  if(!keys.length) out="// no text edits";
  else{
    out="// paste into TEXT_DEFS in d_core.js, replacing each key's def\n";
    keys.forEach(function(k){
      out+='"'+k+'":{g:"'+M.textDef(k).g+'",def:'+JSON.stringify(over[k])+'},\n';
    });
  }
  E("libTextOut").value=out;
  E("libTextOutWrap").hidden=false;
  E("libTextOut").focus(); E("libTextOut").select();
  try{ document.execCommand("copy"); }catch(e){}
}
function commitText(){ if(onEdit) onEdit(); }
function wireText(){
  E("libModeModels").addEventListener("click",function(){ setLibMode("models"); });
  E("libModeText").addEventListener("click",function(){ setLibMode("text"); });
  E("libTextFind").addEventListener("input",function(){
    txFind=this.value.trim(); renderText();
  });
  E("libTextCopy").addEventListener("click",copyTextEdits);
  E("libTextRevert").addEventListener("click",function(){
    M.resetAllText();
    E("libTextOutWrap").hidden=true;
    commitText();
    renderText();
  });
  setLibMode("models");
}

return { init:init, enter:enter, exit:exit, update:update, draw:draw,
         select:select, refreshCounts:refreshCounts, keydown:keydown,
         refreshStats:renderStats, rebuildList:buildList,
         mode:function(){ return txMode; }, setMode:setLibMode,
         renderText:renderText,
         hitAt:function(x,y){ return partUnder(x,y); },
         handleAt:function(x,y){ return handleUnder(x,y); },
         // where each axis handle lands on screen, for verification
         gizmoProbe:function(){
           if(!gizOK||!sel) return null;
           var rect=canvas.getBoundingClientRect(), sc=cur.scale||1;
           var o=gizmoOrigin(), rad=gizmoRadius(), C=camera(), out=[];
           var len=(TOOL==="scale")?rad*0.92:rad*0.88;
           for(var i=0;i<3;i++){
             var w=[o[0],o[1],o[2]];
             if(TOOL==="rotate"){
               // rings sit perpendicular to their axis; sample at 45 degrees
               // between the other two so the three probes never coincide
               var r=rad*0.7071;
               for(var k=0;k<3;k++) if(k!==i) w[k]+=r;
             } else w[i]+=len;
             out.push(projPt(C.vp,w[0]*sc,w[1]*sc,w[2]*sc,rect));
           }
           return {rect:{l:rect.left,t:rect.top,w:rect.width,h:rect.height},
                   origin:projPt(C.vp,o[0]*sc,o[1]*sc,o[2]*sc,rect), tips:out};
         },
         tool:function(){ return TOOL; }, setTool:setTool,
         dragState:function(){ return {moving:moving, movePart:movePart, snap:snap, sel:sel}; },
         isActive:function(){ return active; } };
})();
