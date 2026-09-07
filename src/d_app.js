// ===========================================================================
// Nightward — app shell: screens, settings, save
// ===========================================================================
(function(){
"use strict";
var M=HF;
var canvas=document.getElementById("view");
var R=HFGL.create(canvas);
if(!R){ document.getElementById("fatal").hidden=false; return; }

function el(id){ return document.getElementById(id); }

// ---- persistence ----------------------------------------------------------
var KEY_SET="holdfast.settings.v1", KEY_SAVE="holdfast.save.v1", KEY_ASSETS="holdfast.assets.v1";
var KEY_STATS="holdfast.stats.v1", KEY_USER="holdfast.user.v1", KEY_META="holdfast.meta.v1";
var KEY_MAPS="holdfast.maps.v1", KEY_TEXT="holdfast.text.v1";
var playMap=null;                       // the custom map the next round will use
var SET={ difficulty:"normal", outline:true, scale:1.0, sens:1.0, vol:0.7, help:true };
var SAVE={ runs:0, wins:0, bestHall:0, bestTime:null, lastResult:null };

function loadJSON(k,fallback){
  try{
    var raw=window.localStorage.getItem(k);
    if(!raw) return fallback;
    var o=JSON.parse(raw);
    return (o&&typeof o==="object")?o:fallback;
  }catch(e){ return fallback; }
}
function saveJSON(k,v){
  try{ window.localStorage.setItem(k,JSON.stringify(v)); }catch(e){}
}
function loadAll(){
  var s=loadJSON(KEY_SET,null);
  if(s){
    if(s.difficulty&&HFGAME.DIFF[s.difficulty]) SET.difficulty=s.difficulty;
    if(typeof s.outline==="boolean") SET.outline=s.outline;
    if(typeof s.scale==="number") SET.scale=Math.max(0.5,Math.min(1,s.scale));
    if(typeof s.sens==="number") SET.sens=Math.max(0.3,Math.min(2.5,s.sens));
    if(typeof s.vol==="number") SET.vol=Math.max(0,Math.min(1,s.vol));
    if(typeof s.help==="boolean") SET.help=s.help;
  }
  var ov=loadJSON(KEY_ASSETS,null);
  if(ov&&typeof ov==="object") M.setOverrides(ov);
  var st=loadJSON(KEY_STATS,null);
  if(st&&typeof st==="object") M.setStatOverrides(st);
  var ua=loadJSON(KEY_USER,null);
  if(ua&&ua.length) M.setUserAssets(ua);
  var mt=loadJSON(KEY_META,null);
  if(mt&&typeof mt==="object") M.setMetaAll(mt);
  var mp=loadJSON(KEY_MAPS,null);
  if(mp&&mp.length) M.setMaps(mp);
  var tx=loadJSON(KEY_TEXT,null);
  if(tx&&typeof tx==="object") M.setTextOverrides(tx);
  var g=loadJSON(KEY_SAVE,null);
  if(g){
    SAVE.runs=g.runs|0; SAVE.wins=g.wins|0;
    SAVE.bestHall=g.bestHall|0;
    SAVE.bestTime=(typeof g.bestTime==="number")?g.bestTime:null;
    SAVE.lastResult=g.lastResult||null;
  }
}
function applySettings(){
  R.setOptions({outline:SET.outline, scale:SET.scale});
  if(window.HFSND) HFSND.setVolume(SET.vol);
  saveJSON(KEY_SET,SET);
}

// Browsers will not start audio until the user has interacted, so the very
// first click or keypress anywhere is what actually opens the context.
function primeAudio(){
  if(window.HFSND) HFSND.resume();
  window.removeEventListener("pointerdown",primeAudio,true);
  window.removeEventListener("keydown",primeAudio,true);
}
window.addEventListener("keyup",function(ev){
  if(screen==="play"&&HFGAME.keyup) HFGAME.keyup(ev);
});
// a pan key held while the window loses focus would otherwise never come up
window.addEventListener("blur",function(){ if(HFGAME.clearPan) HFGAME.clearPan(); });
window.addEventListener("pointerdown",primeAudio,true);
window.addEventListener("keydown",primeAudio,true);

// ---- backdrop -------------------------------------------------------------
var backdrop=null, bdAz=24, bdClock=0;
function ensureBackdrop(){
  if(!backdrop) backdrop=M.buildStatic(M.makeTerrain(70707));
  return backdrop;
}
function backdropCam(){
  var a=bdAz*Math.PI/180, e=30*Math.PI/180;
  var sz=R.size(), aspect=(sz[0]||16)/(sz[1]||9), z=23;
  var dir=[Math.cos(e)*Math.cos(a),Math.sin(e),Math.cos(e)*Math.sin(a)];
  var target=[0,M.PLAT,0], eye=[dir[0]*100,target[1]+dir[1]*100,dir[2]*100];
  return { vp:M.mul(M.ortho(-z*aspect,z*aspect,-z,z,1,260), M.lookAt(eye,target,[0,1,0])),
           eye:eye };
}

// ---- screens --------------------------------------------------------------
var screen="menu";
var SCREENS=["menu","play","setup","library","maps","settings","net"];
function show(name){
  if(screen==="library"&&name!=="library") HFLIB.exit();
  if(screen==="maps"&&name!=="maps") HFMAP.exit();
  if(screen==="play"&&name!=="play") HFGAME.stop();
  screen=name;
  SCREENS.forEach(function(s){
    var n=el("screen-"+s);
    if(n) n.hidden=(s!==name);
  });
  el("hud").hidden=(name!=="play");
  if(name!=="play") el("overlay").hidden=true;
  if(name!=="play") R.setLamps([]);
  if(name==="menu"||name==="settings"||name==="net"||name==="setup"){ R.setStatic(ensureBackdrop()); }
  if(name==="setup") drawSetup();
  if(name==="library"){ R.setTime(0.08); HFLIB.enter(); }
  if(name==="maps"){ R.setTime(0.06); HFMAP.enter(); }
  if(name==="menu") refreshMenu();
  document.body.dataset.screen=name;
}

function refreshMenu(){
  el("mRuns").textContent=SAVE.runs;
  el("mWins").textContent=SAVE.wins;
  el("mBest").textContent=SAVE.runs? (SAVE.bestHall+"%") : "—";
  var lr=SAVE.lastResult;
  el("mLast").textContent = lr
    ? M.t("menu.last.line",{result:M.t(lr.won?"menu.last.won":"menu.last.lost"),
          difficulty:lr.difficulty, hall:lr.hallPct, seconds:lr.seconds})
    : M.t("menu.last.none");
  el("mDiffTag").textContent=HFGAME.DIFF[SET.difficulty].label;
  var na=el("mAssets");
  if(na&&M.allAssets) na.textContent=M.t("menu.library.sub",{n:M.allAssets().length});
  var nm=el("mMapCount");
  if(nm) nm.textContent=M.getMaps().length
    ? M.t("menu.maps.sub",{n:M.getMaps().length}) : M.t("menu.maps.none");
}

// ---- game hooks -----------------------------------------------------------
function onRoundEnd(res){
  SAVE.runs++;
  if(res.won) SAVE.wins++;
  if(res.hallPct>SAVE.bestHall) SAVE.bestHall=res.hallPct;
  if(res.won&&(SAVE.bestTime===null||res.seconds<SAVE.bestTime)) SAVE.bestTime=res.seconds;
  SAVE.lastResult=res;
  saveJSON(KEY_SAVE,SAVE);

  var SS=HFGAME.state(), multi=!!(SS&&SS.multi), mine=multi&&SS.players[SS.me].out;
  var both=multi&&SS.players.every(function(p){ return !p.out; });
  // A round is won by pulling every nest down, not by seeing one dawn. That
  // changes what the end screen is congratulating you for.
  el("ovTitle").textContent = res.won
    ? M.t(mine?"end.win.ally.title":"end.win.title")
    : M.t(multi?"end.lose.multi.title":"end.lose.title");
  var nights=res.nights|0;
  var nightsSaid=M.t(nights===1?"end.nights.one":"end.nights",{n:nights});
  el("ovBody").textContent = res.won
    ? (mine ? M.t("end.win.ally")
            : (multi ? M.t(both?"end.win.both":"end.win.alone",{nights:nightsSaid})
                     : M.t("end.win.solo",{nights:nightsSaid})))
    : M.t(multi?"end.lose.multi":"end.lose.solo");
  el("ovAgain").hidden=multi;
  el("ovStats").innerHTML=
    '<div><b>'+res.kills+'</b><span>'+M.t("end.stat.kills")+'</span></div>'+
    '<div><b>'+nights+'</b><span>'+M.t(nights===1?"end.stat.nights.one":"end.stat.nights")+'</span></div>'+
    '<div><b>'+res.nests+'</b><span>'+M.t("end.stat.nests")+'</span></div>';
  el("overlay").hidden=false;
  setPause(false);
}

HFGAME.UI.phase=function(){
  var S=HFGAME.state(); if(!S) return;
  var build=S.phase==="build";
  var P=S.players[S.me];
  // The dock, the controls and everything they drive stay up through the night
  var live=build||S.phase==="attack";
  el("dayBox").hidden=!build;
  el("hotWrap").hidden=!live||P.out;
  el("supplyBox").hidden=!live;
  showCatOf(S.sel);
  el("waveBox").hidden=build;
  el("army").hidden=(S.phase==="won"||S.phase==="lost");
  HFGAME.UI.units();
};

// The one place you can see both what is selected and whether it will chase.
HFGAME.UI.units=function(){
  var S=HFGAME.state(); if(!S) return;
  var mine=S.units.filter(function(u){ return (u.own||0)===S.me; });
  var total=mine.length, sel=0, kinds={};
  for(var i=0;i<total;i++){
    var u=mine[i];
    if(!u.sel) continue;
    sel++; kinds[u.t]=(kinds[u.t]||0)+1;
  }
  var parts=[];
  for(var k in kinds) parts.push(kinds[k]+" "+HFGAME.UNITS[k].name.toLowerCase()+(kinds[k]>1?"s":""));
  selParts=parts;

  // Two counts, each one a button that takes the whole group. Anyone indoors is
  // counted but not selectable, so the number says how many you have and the
  // note says how many of them are out of reach.
  var wg=HFGAME.groupCount("workers"), ag=HFGAME.groupCount("army");
  el("grpWorkN").textContent=wg.total;
  el("grpArmyN").textContent=ag.total;
  el("grpWorkIn").textContent=wg.inside?M.t("hud.workers.in",{n:wg.inside}):"";
  el("grpWorkers").disabled=!wg.out;
  el("grpArmy").disabled=!ag.out;
  var selW=0, selA=0;
  for(var q=0;q<mine.length;q++){
    if(!mine[q].sel) continue;
    if(HFGAME.UNITS[mine[q].t].civil) selW++; else selA++;
  }
  el("grpWorkers").setAttribute("aria-pressed",
    (selW&&selW===wg.out&&!selA)?"true":"false");
  el("grpArmy").setAttribute("aria-pressed",
    (selA&&selA===ag.out&&!selW)?"true":"false");
  el("army").hidden=(!total&&S.phase==="build")||S.phase==="won"||S.phase==="lost";
  dockMode();
};
var selParts=[];
// The selected building's panel: what it is, how it is holding up, who lives
// there, and the one verb that matters for a house.
HFGAME.UI.building=function(){
  var S=HFGAME.state(), box=el("bldPanel");
  if(!box) return;
  var b=S&&HFGAME.bsel();
  var rd=S&&HFGAME.rsel();
  var pl=S&&HFGAME.psel();
  if(S&&rd&&S.phase!=="won"&&S.phase!=="lost"){ roadPanel(box,rd); return; }
  if(S&&pl&&S.phase!=="won"&&S.phase!=="lost"){ pilePanel(box,pl); return; }
  if(!b||S.phase==="won"||S.phase==="lost"){ box.hidden=true; dockActs(null); return; }
  box.hidden=false;
  // While it is still a heap of materials the bar answers "how far along", not
  // "how hurt" — health on a thing that is not built yet is the wrong question.
  var T=HFGAME.TYPES[b.type], site=!!b.site;
  var f=site ? Math.max(0,Math.min(1,b.prog/Math.max(0.001,b.need)))
             : Math.max(0,b.hp/b.max);
  el("bldName").textContent=T.name+(site?M.t("sel.site.suffix"):"");
  el("bldHp").textContent=site ? M.t("sel.site.left",{n:Math.max(0,Math.ceil(b.need-b.prog))})
                              : Math.ceil(f*100)+"%";
  el("bldBar").style.width=(f*100).toFixed(1)+"%";
  el("bldBar").classList.toggle("crit",!site&&f<0.35);

  // A turret's people are a crew, not residents: they are not sheltered, they
  // are standing on it shooting. Different line, different verb.
  if(b.type==="turret"&&!site){
    var crew=HFGAME.crewOf(b), tcap=HF.statsOf('turret').cap|0;
    el("bldHouse").hidden=false;
    el("bldHoused").textContent=crew.length
      ? M.t("sel.turret.crew",{n:crew.length}) : M.t("sel.turret.empty");
    el("bldIn").textContent=crew.length?(crew.length+"/"+tcap):"";
    el("bldHint").textContent=crew.length?"":M.t("sel.turret.hint");
    dockActs(b,T,[]);
    return;
  }
  if(b.type==="gate"&&!site){
    el("bldHouse").hidden=false;
    el("bldHoused").textContent=M.t(b.shut?"sel.gate.isshut":"sel.gate.isopen");
    el("bldIn").textContent="";
    el("bldHint").textContent=M.t(b.shut?"sel.gate.hint.shut":"sel.gate.hint.open");
    dockActs(b,T,[]);
    return;
  }
  var housed=HFGAME.housedBy(b), inside=0;
  for(var i=0;i<housed.length;i++) if(housed[i].inside) inside++;
  var house=el("bldHouse");
  house.hidden=!housed.length;
  if(housed.length){
    el("bldHoused").textContent=M.t(b.type==="hall"?"sel.housed.hall":"sel.housed.other",
      {n:housed.length, noun:M.t(housed.length===1?"sel.worker.one":"sel.worker.many")});
    el("bldIn").textContent=inside?M.t("sel.indoors",{n:inside}):"";
  }
  // The rail says what this building is; the dock is where you act on it. One
  // place for state, one place for verbs — and selling only ever happens there.
  el("bldHint").textContent=housed.length?M.t("sel.hint.send"):"";
  dockActs(b,T,housed);
};
// A road borrows the same panel. It has the same four things to say — what it
// is, how far along, who is on it, and the one verb — so giving it a second
// panel would be two layouts to keep in step for no gain.
function roadPanel(box,e){
  var T=HFGAME.TYPES.road, done=!!e.done;
  var f=done?1:Math.max(0,Math.min(1,e.prog/Math.max(0.001,e.need)));
  box.hidden=false;
  el("bldName").textContent=T.name+(done?"":M.t("sel.road.staked"));
  // Unbuilt, the number is what is left to do — which is the question the
  // player is asking when they are thinking about calling it off. Built, it is
  // how much road they got.
  el("bldHp").textContent=done
    ? M.t("sel.road.len",{n:Math.round(HFGAME.edgeLen(e))})
    : M.t("sel.road.left",{n:Math.max(0,Math.ceil(e.need-e.prog))});
  el("bldBar").style.width=(f*100).toFixed(1)+"%";
  el("bldBar").classList.toggle("crit",false);
  var crew=done?0:HFGAME.roadCrew(e);
  el("bldHouse").hidden=done;
  if(!done){
    el("bldHoused").textContent=crew
      ? M.t("sel.road.crew",{n:crew, noun:M.t(crew===1?"sel.worker.one":"sel.worker.many")})
      : M.t("sel.road.nocrew");
    el("bldIn").textContent="";
  }
  el("bldHint").textContent=M.t("sel.road.hint");
  dockActs(e,T,[],true);
}
// And so does a salvage pile. The one thing worth knowing about a pile is how
// much is left in it — the whole economic decision in this game is which pile
// to walk to next, and until now the only way to answer that was to watch the
// heap shrink. The bar is what is left of what it started with, so a pile that
// is nearly out reads at a glance rather than as a number you have to compare
// against a number you do not have.
//
// There is no dock verb: a pile is not yours, there is nothing to do to it.
function pilePanel(box,nd){
  var left=Math.max(0,Math.round(nd.amt)), f=Math.max(0,Math.min(1,nd.amt/Math.max(1,nd.max)));
  box.hidden=false;
  el("bldName").textContent=M.t("sel.pile.name");
  el("bldHp").textContent=left?M.t("sel.pile.left",{n:left}):M.t("sel.pile.spent");
  el("bldBar").style.width=(f*100).toFixed(1)+"%";
  el("bldBar").classList.toggle("crit",f<0.20);
  var crew=HFGAME.pileCrew(HFGAME.pileIndex());
  el("bldHouse").hidden=false;
  el("bldHoused").textContent=crew
    ? M.t("sel.pile.crew",{n:crew, noun:M.t(crew===1?"sel.worker.one":"sel.worker.many")})
    : M.t("sel.pile.nocrew");
  el("bldIn").textContent="";
  el("bldHint").textContent=M.t("sel.pile.hint",{n:Math.round(nd.max)});
  dockActs(null);
}
// ---- what a selected unit is worth ----------------------------------------
// The numbers come straight out of the balance table, so a value edited in the
// library shows up here without a second copy to keep in step. Damage is quoted
// as the swing and the rate it works out to, because "19 a hit" and "19 a hit
// every 0.85s" are different weapons.
function num(v,d){ return (Math.round(v*(d||1))/(d||1)).toString(); }
function dps(dmg,every){ return every>0 ? num(dmg/every,10) : num(dmg,1); }
function statLine(lab,val){
  return '<div class="uStat"><span>'+lab+'</span><b>'+val+'</b></div>';
}
// The one-line reason you would build this unit rather than the other one.
function abilityOf(t,s){
  if(t==="commander")
    return M.t("unit.commander.ability",
               {rally:num(s.rally,10), pct:Math.round((1-s.rallyK)*100)});
  if(t==="archer") return M.t("unit.archer.ability",{range:num(s.range,10)});
  if(t==="soldier") return M.t("unit.soldier.ability");
  if(t==="scout")   return M.t("unit.scout.ability",{sight:num(s.sight,10)});
  if(t==="worker")  return M.t("unit.worker.ability",{repair:s.repair});
  return "";
}
function statBlock(t,s,one){
  var U=HFGAME.UNITS[t], h="";
  h+=statLine(M.t("sel.stat.health"), one ? Math.ceil(one.hp)+" / "+s.hp : s.hp);
  if(U.civil){
    h+=statLine(M.t("sel.stat.gather"),
                M.t("sel.stat.gather.v",{rate:num(s.gather,10), carry:s.carry}));
    h+=statLine(M.t("sel.stat.repair"), M.t("sel.stat.repair.v",{n:s.repair}));
  }else if(U.melee){
    h+=statLine(M.t("sel.stat.damage"),
                M.t("sel.stat.rate.v",{dmg:s.dmg, every:num(s.swing,100), dps:dps(s.dmg,s.swing)}));
    h+=statLine(M.t("sel.stat.reach"), M.t("sel.stat.units.v",{n:num(s.reach,100)}));
  }else{
    h+=statLine(M.t("sel.stat.damage"),
                M.t("sel.stat.rate.v",{dmg:s.dmg, every:num(s.fire,100), dps:dps(s.dmg,s.fire)}));
    h+=statLine(M.t("sel.stat.range"), M.t("sel.stat.units.v",{n:num(s.range,10)}));
  }
  h+=statLine(M.t("sel.stat.speed"), M.t("sel.stat.speed.v",{n:num(s.speed,100)}));
  var ab=abilityOf(t,s);
  if(ab) h+='<div class="uAbil">'+ab+'</div>';
  return h;
}
// The dock answers to whatever is selected. A building puts its own verbs
// there; troops put theirs; workers — and an empty cursor — get the building
// cards, because making things is what a worker is for.
function dockMode(){
  var S=HFGAME.state();
  if(!S) return;
  var troops=el("dockTroops");
  var selA=0, selW=0, kinds={}, only=null, lone=null;
  for(var i=0;i<S.units.length;i++){
    var u=S.units[i];
    if(!u.sel||(u.own||0)!==S.me) continue;
    if(HFGAME.UNITS[u.t].civil) selW++; else selA++;
    kinds[u.t]=(kinds[u.t]||0)+1;
    lone=u;
  }
  // The troop card and the building card stack in the corner; neither one
  // touches the dock any more, so they no longer have to take turns.
  var onTroops=(selA+selW)>0 && S.phase!=="won" && S.phase!=="lost";
  troops.hidden=!onTroops;
  if(!onTroops) return;
  el("troopWhat").textContent=selParts.join(", ");

  // Stance is a fighting order, so it only appears when something that fights
  // is in the selection. Workers get the panel without it.
  el("troopMove").hidden=!selA;
  var st=el("troopStance");
  st.textContent=M.t((S.stance==="hold")?"sel.stance.hold":"sel.stance.chase");
  st.setAttribute("aria-pressed",S.stance==="hold"?"true":"false");

  // One kind selected: the full card, and a live health reading if it is a
  // single unit. A mixed selection gets one line per kind instead — quoting
  // any one unit's reach for a crowd of three different ones would be a lie.
  var ks=Object.keys(kinds), box=el("troopStats");
  if(ks.length===1){
    var t=ks[0], s=HF.statsOf(t);
    box.innerHTML=s ? statBlock(t,s,(kinds[t]===1)?lone:null) : "";
  }else{
    var h="";
    for(var k=0;k<ks.length;k++){
      var kt=ks[k], sk=HF.statsOf(kt);
      if(!sk) continue;
      h+='<div class="uKind"><span>'+
         M.t("sel.kind.line",{name:HFGAME.UNITS[kt].name, n:kinds[kt]})+'</span><b>'+
         M.t(HFGAME.UNITS[kt].civil?"sel.kind.civil":"sel.kind.armed",{hp:sk.hp, dmg:sk.dmg})+
         '</b></div>';
    }
    box.innerHTML=h;
  }
}
// The same verbs again, down where the cursor already is. The dock is where a
// player's hand lives during a round, so an action they need mid-fight belongs
// there as well as in the rail.
function dockActs(b,T,housed,road){
  var box=el("dockActs");
  if(!box) return;
  if(!b){ box.hidden=true; dockMode(); return; }
  box.hidden=false;
  el("dockWhat").textContent=T.name;
  var ds=el("dockShelter");
  if(!road&&b.type==="turret"&&!b.site){
    var tc=HFGAME.crewOf(b).length;
    ds.hidden=!tc;
    if(tc){ ds.textContent=M.t("sel.turret.down"); ds.setAttribute("aria-pressed","false"); }
    var dsell2=el("dockSell");
    dsell2.hidden=false;
    dsell2.textContent=M.t(b.site?"sel.cancel":"sel.selldown",{n:HFGAME.refundOf(b.type)});
    return;
  }
  // A gate's verb is its door. It borrows the shelter button the way the
  // turret's "stand down" does — same slot, same two-state look — because a
  // gate has exactly one thing you can do to it and a button of its own would
  // be a third layout to keep in step for no gain.
  if(!road&&b.type==="gate"&&!b.site){
    ds.hidden=false;
    ds.textContent=M.t(b.shut?"sel.gate.open":"sel.gate.shut");
    ds.setAttribute("aria-pressed",b.shut?"true":"false");
    var dsell3=el("dockSell");
    dsell3.hidden=false;
    dsell3.textContent=M.t("sel.selldown",{n:HFGAME.refundOf(b.type)});
    return;
  }
  ds.hidden=road||!housed.length;
  if(!road&&housed.length){
    var on=HFGAME.sheltering(b);
    ds.textContent=M.t(on?"sel.shelter.out":"sel.shelter.in");
    ds.setAttribute("aria-pressed",on?"true":"false");
  }
  // Same button, same refund — but scrapping something that was never built is
  // calling off work, not tearing a building down, and the word has to say so.
  // A road carries no figure at all: it never cost supply, so a "+0" on the
  // button would be answering a question nobody asked.
  var dsell=el("dockSell");
  if(road){
    dsell.hidden=false;
    dsell.textContent=M.t(b.done?"sel.road.tearup":"sel.road.calloff");
    return;
  }
  dsell.hidden=(b.type==="hall");
  dsell.textContent=M.t(b.site?"sel.cancel":"sel.selldown",{n:HFGAME.refundOf(b.type)});
}
HFGAME.UI.marquee=function(){
  var S=HFGAME.state(); if(!S) return;
  var n=el("marquee"), m=S.marquee;
  if(!m){ n.hidden=true; return; }
  n.hidden=false;
  n.style.left=Math.min(m[0],m[2])+"px";
  n.style.top=Math.min(m[1],m[3])+"px";
  n.style.width=Math.abs(m[2]-m[0])+"px";
  n.style.height=Math.abs(m[3]-m[1])+"px";
};
// ---- hotbar ---------------------------------------------------------------
// Tabs and slots are generated from HFGAME.CATS and HFGAME.TYPES, so a new
// building appears in the dock the moment it exists in the balance table.
// Inline SVG so the icons stay in the single file and inherit the tab's colour
// through currentColor — no image requests, no second palette to maintain.
var CAT_ICONS={
  core:'<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">'+
       '<path fill="currentColor" d="M8 1.5 15 7.3 13 7.3 13 14.4 3 14.4 3 7.3 1 7.3Z"/></svg>',
  guns:'<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">'+
       '<path fill="currentColor" d="M8 0.7 13.2 4.9 2.8 4.9Z"/>'+
       '<rect x="2.1" y="5.4" width="11.8" height="1.7" fill="currentColor"/>'+
       '<path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"'+
       ' d="M5 7.5 3.1 15M11 7.5 12.9 15"/>'+
       '<path stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none"'+
       ' d="M4.2 11.3 11.8 11.3"/></svg>',
  walls:'<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">'+
       '<path fill="currentColor" d="M1 6.3 2.7 3.4 4.4 6.3 4.4 14.4 1 14.4Z'+
       'M6.3 6.3 8 3.4 9.7 6.3 9.7 14.4 6.3 14.4ZM11.6 6.3 13.3 3.4 15 6.3 15 14.4 11.6 14.4Z"/>'+
       '<rect x="0.7" y="8.5" width="14.6" height="1.5" fill="currentColor"/></svg>',
  muster:'<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">'+
       '<circle cx="11.3" cy="5" r="1.9" fill="currentColor" opacity=".72"/>'+
       '<path fill="currentColor" opacity=".72" d="M8.7 14.4v-3a2.9 2.9 0 0 1 5.8 0v3z"/>'+
       '<circle cx="5.6" cy="4.1" r="2.3" fill="currentColor"/>'+
       '<path fill="currentColor" d="M2.1 14.4v-3.7a3.5 3.5 0 0 1 7 0v3.7z"/></svg>'
};
var hotCat=HFGAME.CATS[0].id;
function catTypes(cat){
  var out=[];
  for(var t in HFGAME.TYPES) if(HFGAME.TYPES[t].cat===cat) out.push(t);
  return out;
}
function buildHotbar(){
  var tabs="";
  HFGAME.CATS.forEach(function(c){
    tabs+='<button class="hotTab" type="button" role="tab" data-cat="'+c.id+'"'+
          ' aria-selected="false" title="'+c.note+'">'+
          '<span class="ti">'+(CAT_ICONS[c.id]||"")+'</span>'+
          '<span class="tl">'+c.name+'</span></button>';
  });
  el("hotTabs").innerHTML=tabs;
  el("hotTabs").querySelectorAll(".hotTab").forEach(function(b){
    b.addEventListener("click",function(){ setCat(b.dataset.cat); });
  });

  var slots="";
  HFGAME.CATS.forEach(function(c){
    catTypes(c.id).forEach(function(t,i){
      var T=HFGAME.TYPES[t];
      slots+='<button class="slot" type="button" data-type="'+t+'" data-cat="'+c.id+'"'+
             ' aria-pressed="false">'+
             '<div class="k">'+(i+1)+'</div>'+
             '<div class="n">'+T.name+'</div>'+
             '<div class="c"></div><div class="s"></div></button>';
    });
  });
  el("hotbar").innerHTML=slots;
  el("hotbar").querySelectorAll(".slot").forEach(function(n){
    n.addEventListener("click",function(){
      if(n.classList.contains("locked")) return;
      HFGAME.select(n.dataset.type);
      HFGAME.UI.hotbar();
    });
  });
  setCat(hotCat);
}
function setCat(cat){
  hotCat=cat;
  el("hotTabs").querySelectorAll(".hotTab").forEach(function(b){
    b.setAttribute("aria-selected", b.dataset.cat===cat?"true":"false");
  });
  el("hotbar").querySelectorAll(".slot").forEach(function(n){
    n.hidden=(n.dataset.cat!==cat);
  });
  HFGAME.UI.hotbar();
}
function cycleCat(back){
  var ids=HFGAME.CATS.map(function(c){ return c.id; });
  var i=ids.indexOf(hotCat);
  setCat(ids[((i+(back?-1:1))%ids.length+ids.length)%ids.length]);
}
// picking a building from anywhere brings its tab forward, so the dock always
// shows what is actually selected
function showCatOf(t){
  var T=HFGAME.TYPES[t];
  if(T&&T.cat!==hotCat) setCat(T.cat);
}
function pickInCat(i){
  var list=catTypes(hotCat);
  if(i<0||i>=list.length) return false;
  var t=list[i], S=HFGAME.state();
  if(!S) return false;
  // a number key must not arm what the dock has greyed out
  var n=el("hotbar").querySelector('.slot[data-type="'+t+'"]');
  if(n&&n.classList.contains("locked")) return false;
  HFGAME.select(t);
  HFGAME.UI.hotbar();
  return true;
}

HFGAME.UI.hotbar=function(){
  var S=HFGAME.state(); if(!S) return;
  var P=S.players[S.me];
  el("supply").textContent=P.supply;
  el("hotbar").querySelectorAll(".slot").forEach(function(n){
    var t=n.dataset.type, T=HFGAME.TYPES[t];
    var locked=P.out||(t==="hall"&&P.hall)||(t!=="hall"&&!P.hall)||T.cost>P.supply;
    n.classList.toggle("locked",!!locked);
    n.setAttribute("aria-pressed",S.sel===t?"true":"false");
    var c=n.querySelector(".c"), b=n.querySelector(".s");
    // Three different kinds of price, and "free · required" belongs only to the
    // hall. A road costs no supply but is not free — it costs the workers who
    // are not gathering while they lay it, and the card should say so.
    if(c) c.textContent = T.road ? M.t("bld.labour")
                        : T.cost ? M.t("bld.supply",{n:T.cost})
                        : (M.t("bld.free")+" · "+M.t("bld.required"));
    if(b) b.textContent=T.blurb?T.blurb(T):"";
  });
};
// The mix is what makes the build decision legible: runners punish gaps,
// brutes punish thin damage, so naming both beats a single wave number.
function clock(sec){
  sec=Math.max(0,Math.ceil(sec));
  return Math.floor(sec/60)+":"+("0"+(sec%60)).slice(-2);
}
// Daylight is the build phase, so the bar draining is the pressure
function refreshDay(){
  var S=HFGAME.state();
  if(!S||S.phase!=="build") return;
  var f=Math.max(0,S.dayLeft/Math.max(1,S.dayLen));
  el("dayBar").style.width=(f*100).toFixed(1)+"%";
  el("dayLeft").textContent=clock(S.dayLeft);
  el("dayBar").classList.toggle("crit",f<0.22);
  // A round runs until every hall or every nest is gone, so both readouts have
  // to say where in that it is — the clock alone stopped being the whole story.
  // What is coming matters more than the clock once a round runs for days: the
  // nests you have not pulled down are the number that keeps climbing.
  var live=HFGAME.liveNests().length;
  el("nightNo").textContent=M.t("hud.night",{n:S.night});
  el("nestsLeft").textContent=M.t(live===1?"hud.nests.one":"hud.nests",{n:live});
  el("nightSend").textContent=(HFGAME.waveSize?HFGAME.waveSize():S.wave);
  el("supply").textContent=S.players[S.me].supply;
}
function refreshWave(){
  var S=HFGAME.state();
  if(!S||S.phase!=="attack") return;
  var nf=Math.max(0,S.nightLeft/Math.max(1,S.nightLen));
  el("nightBar").style.width=(nf*100).toFixed(1)+"%";
  el("nightLeft").textContent=clock(S.nightLeft);
  el("nightBar").classList.toggle("crit",nf<0.20);
  el("wLeft").textContent=S.enemies.length+S.spawnLeft;
  var lv2=HFGAME.liveNests().length;
  el("nightNo2").textContent=M.t("hud.night",{n:S.night});
  el("nestsLeft2").textContent=M.t(lv2===1?"hud.nests.left.one":"hud.nests.left",{n:lv2});
  el("supply").textContent=S.players[S.me].supply;
  var H=S.players[S.me].hall;
  var f=H?Math.max(0,H.hp/HFGAME.TYPES.hall.hp):0;
  el("hallBar").style.width=(f*100).toFixed(1)+"%";
  el("hallPct").textContent=Math.ceil(f*100)+"%";
  el("hallBar").classList.toggle("crit",f<0.35);
}

// ---- world-anchored health bars -------------------------------------------
// Projected to screen and drawn as real elements rather than geometry: an
// instance carries only a uniform scale, so a mesh bar cannot be stretched to
// a fraction — it would have to be built from segments. A div gives a genuinely
// thin line that depletes smoothly at any zoom.
var wBars=[];
function worldBars(){
  var S=HFGAME.state(), host=el("worldBars");
  if(!host||!S||!HFGAME.hpAnchors) return;
  var list=HFGAME.hpAnchors();
  while(wBars.length<list.length){
    var d=document.createElement("div");
    d.className="wBar"; d.innerHTML="<i></i>";
    host.appendChild(d);
    wBars.push(d);
  }
  for(var i=list.length;i<wBars.length;i++) wBars[i].hidden=true;
  if(!list.length) return;
  var C=HFGAME.camera(true), rect=canvas.getBoundingClientRect(), vp=C.vp;
  for(i=0;i<list.length;i++){
    var a=list[i];
    var w=vp[3]*a.x+vp[7]*a.y+vp[11]*a.z+vp[15]; if(!w) w=1;
    var sx=((vp[0]*a.x+vp[4]*a.y+vp[8]*a.z+vp[12])/w*0.5+0.5)*rect.width+rect.left;
    var sy=(1-((vp[1]*a.x+vp[5]*a.y+vp[9]*a.z+vp[13])/w*0.5+0.5))*rect.height+rect.top;
    var n=wBars[i];
    n.hidden=false;
    n.style.left=Math.round(sx)+"px";
    n.style.top=Math.round(sy)+"px";
    // Scaled by the camera, not fixed in pixels. `a.w` is the width at the
    // default zoom of 17; zoomed out to 34 a soldier is half the size it was
    // and a 22px bar over it is a placard. Clamped at both ends so a bar stays
    // a bar: legible when far out, and not a slab when right in.
    var k=Math.max(0.60,Math.min(1.25,17/(HFGAME.cam?HFGAME.cam().zoom:17)));
    var w=Math.round((a.w||46)*k);
    n.style.width=w+"px";
    n.style.height=Math.max(2,Math.round(3*k))+"px";
    n.style.marginLeft=(-w/2)+"px";
    n.classList.toggle("own",a.k==="own");
    n.classList.toggle("work",a.k==="work");
    var f=n.firstChild;
    f.style.width=(a.f*100).toFixed(1)+"%";
    f.classList.toggle("low",a.f<0.34);
  }
}

// ---- minimap --------------------------------------------------------------
// A plain 2D canvas rather than a second 3D pass: the whole point is a flat
// read of where the tainted ground is, and that is cheaper and clearer drawn
// directly. Refreshed a few times a second, not every frame.
var MM=null, mmT=0, MM_EXT=42;            // world units from centre to edge
function minimap(dt){
  var S=HFGAME.state();
  var cv=el("minimap");
  if(!cv||!S) return;
  mmT-=dt;
  if(mmT>0) return;
  mmT=0.06;
  if(!MM) MM=cv.getContext("2d");
  var W=cv.width, H=cv.height, cx=W/2, cy=H/2, k=(W/2)/MM_EXT;
  // The minimap turns with the view, so up on it is always away from you on
  // screen. These are the same two axes the camera uses: screen-right is
  // (sin az, -cos az) on the ground and screen-away is -(cos az, sin az).
  var maz=(HFGAME.camAz?HFGAME.camAz():0)*Math.PI/180;
  var mc=Math.cos(maz), ms=Math.sin(maz);
  function px(x,z){
    return [cx+(x*ms-z*mc)*k, cy+(x*mc+z*ms)*k];
  }
  MM.clearRect(0,0,W,H);
  MM.fillStyle="#141a15"; MM.fillRect(0,0,W,H);

  // Everything below asks the fog first. A round now opens on a black map and
  // the nests are found by walking, so a nest drawn before anybody has been
  // near it would give away the one thing the whole design asks you to go and
  // learn.
  var seen=function(x,z){ return HFGAME.fogAt(HF.w2gx(x),HF.w2gx(z))>0; };
  // tainted ground: one soft red pool per nest, exactly the radius it claims
  for(var i=0;i<S.nests.length;i++){
    var nn=S.nests[i];
    if(!seen(nn.x,nn.z)) continue;
    var p=px(nn.x,nn.z), rr=nn.r*k;
    var g=MM.createRadialGradient(p[0],p[1],0,p[0],p[1],rr);
    var dead=nn.dead;
    g.addColorStop(0, dead?"rgba(70,64,60,.55)":"rgba(196,54,42,.62)");
    g.addColorStop(0.55, dead?"rgba(60,56,52,.26)":"rgba(150,38,32,.30)");
    g.addColorStop(1,"rgba(0,0,0,0)");
    MM.fillStyle=g;
    MM.beginPath(); MM.arc(p[0],p[1],rr,0,6.2832); MM.fill();
  }
  // the edge of the ground you can actually build on
  var half=(HF.GN*HF.CELL)/2, e0=px(-half,-half), e1=px(half,-half),
      e2=px(half,half), e3=px(-half,half);
  MM.strokeStyle="rgba(217,178,120,.28)"; MM.lineWidth=1;
  MM.beginPath(); MM.moveTo(e0[0],e0[1]); MM.lineTo(e1[0],e1[1]);
  MM.lineTo(e2[0],e2[1]); MM.lineTo(e3[0],e3[1]); MM.closePath(); MM.stroke();

  // salvage
  MM.fillStyle="rgba(214,196,140,.9)";
  for(i=0;i<S.nodes.length;i++){
    if(S.nodes[i].amt<=0) continue;
    if(!seen(S.nodes[i].x,S.nodes[i].z)) continue;
    var q=px(S.nodes[i].x,S.nodes[i].z);
    MM.fillRect(q[0]-1.5,q[1]-1.5,3,3);
  }
  // your buildings, the hall picked out
  for(var kk in S.cells){
    var c=S.cells[kk];
    if(c.ref) continue;
    if(HFGAME.fogAt(c.gx,c.gz)<1) continue;      // including the other town's
    var b=px(HF.gx2w(c.gx),HF.gx2w(c.gz));
    MM.fillStyle=(c.type==="hall")?"rgba(240,236,228,.95)":"rgba(150,166,158,.85)";
    var sz=(c.type==="hall")?4:2;
    MM.fillRect(b[0]-sz/2,b[1]-sz/2,sz,sz);
  }
  // What you have eyes on. Drawn before the marks rather than as an overlay
  // over them, so it reads as ground you are watching rather than a filter laid
  // on top. Without this the horde simply vanishes at the edge of your sight
  // and that reads as a bug, not as a rule — the lit patch is the explanation.
  // Three states, drawn as two washes: a light one over what you are looking at
  // now, and nothing over what you merely remember. Unexplored ground gets no
  // mark of any kind, which is what makes the shape of what you have walked
  // legible at a glance.
  // One path, one fill. A fillRect per cell overlaps its neighbours by the
  // 0.6px seam-closer, and at 8% alpha every overlap darkens twice — which at
  // 2.3 screen pixels per cell reads as a moiré of dots rather than a lit
  // region. Collecting the cells into a single path applies the alpha to the
  // union once.
  var mask=HFGAME.visionMask(S.me), gn=HF.GN, cell=HF.CELL*k;
  MM.fillStyle="rgba(150,190,180,.10)";
  MM.beginPath();
  for(var mz=0;mz<gn;mz++){
    for(var mx=0;mx<gn;mx++){
      if(!mask[mz*gn+mx]) continue;
      var mp=px(HF.gx2w(mx),HF.gx2w(mz));
      MM.rect(mp[0]-cell/2,mp[1]-cell/2,cell+0.8,cell+0.8);
    }
  }
  MM.fill();
  // units and attackers
  MM.fillStyle="rgba(110,200,210,.95)";
  for(i=0;i<S.units.length;i++){
    if(S.units[i].inside) continue;
    var u=px(S.units[i].x,S.units[i].z);
    MM.fillRect(u[0]-1,u[1]-1,2,2);
  }
  // The horde only appears where somebody of yours is looking. This is the
  // whole reason the scout exists: parked out on a lane it is the difference
  // between knowing which way the night is coming and finding out when it
  // arrives.
  MM.fillStyle="rgba(232,96,72,.95)";
  for(i=0;i<S.enemies.length;i++){
    var en=S.enemies[i];
    if(!HFGAME.seenAt(mask,en.x,en.z)) continue;
    var e=px(en.x,en.z);
    MM.fillRect(e[0]-1,e[1]-1,2,2);
  }
  // nests last so they sit on top of their own pool
  for(i=0;i<S.nests.length;i++){
    var n2=S.nests[i];
    // Two loops draw a nest — the tainted pool above and the marker here — and
    // gating only the first one left the red dots on an unexplored map, which
    // gave away every objective on the first frame while looking fogged.
    if(!seen(n2.x,n2.z)) continue;
    var p2=px(n2.x,n2.z);
    MM.beginPath(); MM.arc(p2[0],p2[1],4,0,6.2832);
    MM.fillStyle=n2.dead?"rgba(96,92,88,.9)":"rgba(255,86,58,1)";
    MM.fill();
    if(!n2.dead){
      MM.strokeStyle="rgba(255,150,120,.85)"; MM.lineWidth=1;
      MM.beginPath(); MM.arc(p2[0],p2[1],6.5,0,6.2832); MM.stroke();
    }
  }
  // what the camera can see, drawn last so it reads over everything
  var q=HFGAME.viewQuad&&HFGAME.viewQuad();
  if(q){
    MM.strokeStyle="rgba(237,235,231,.62)"; MM.lineWidth=1.25;
    MM.beginPath();
    for(var vi=0;vi<4;vi++){
      var vp2=px(q[vi][0],q[vi][1]);
      if(vi) MM.lineTo(vp2[0],vp2[1]); else MM.moveTo(vp2[0],vp2[1]);
    }
    MM.closePath(); MM.stroke();
  }
  // North, so a rotating map still has one fixed thing to read it against.
  // North is world -Z; on the minimap that is (cos az, -sin az), the same
  // direction the two axes above put it in.
  // It rides the frame, not a circle inside it. The minimap is square, so a
  // marker at a fixed radius sits well clear of the border on the diagonals and
  // almost on it at the sides — it looks like it is drifting as the view turns.
  // Casting the north ray at the actual border keeps it welded to the edge.
  var dxN=mc, dzN=-ms;
  var tN=Math.min((W/2-2)/Math.max(1e-4,Math.abs(dxN)),
                  (H/2-2)/Math.max(1e-4,Math.abs(dzN)));
  var ta=Math.atan2(dzN,dxN);
  MM.save();
  MM.translate(cx+dxN*(tN-7), cy+dzN*(tN-7));   // 7 is the arrow's own length,
  MM.rotate(ta);                                // so the tip lands on the line
  MM.fillStyle="rgba(232,225,214,.92)";
  MM.beginPath();
  MM.moveTo(7,0); MM.lineTo(-2,-4.2); MM.lineTo(-2,4.2);
  MM.closePath(); MM.fill();
  MM.restore();
  MM.fillStyle="rgba(232,225,214,.85)";
  MM.font='600 9px "IBM Plex Mono", monospace';
  MM.textAlign="center"; MM.textBaseline="middle";
  MM.fillText("N", cx+dxN*(tN-19), cy+dzN*(tN-19));

  MM.strokeStyle="rgba(237,235,231,.12)"; MM.lineWidth=1;
  MM.strokeRect(0.5,0.5,W-1,H-1);
}

// ---- pause -----------------------------------------------------------------
// Escape opens this rather than dumping you back to the menu. In a single
// round the simulation actually stops; in a two-player round it cannot, because
// the other town is still being attacked — so the card says so and the clock
// keeps running behind it.
var paused=false, fromPause=false;
function canFreeze(){ return !HFNET.active(); }
function setPause(on){
  var S=HFGAME.state();
  if(!S||screen!=="play"||!el("overlay").hidden){ on=false; }
  paused=!!on;
  if(paused&&HFGAME.clearPan) HFGAME.clearPan();
  el("pause").hidden=!paused;
  if(paused){
    el("pauseKeys").hidden=true;
    el("pControls").setAttribute("aria-pressed","false");
    var live=!canFreeze();
    el("pauseTag").textContent=M.t(live?"pause.tag.live":"pause.tag");
    el("pauseNote").textContent=M.t(live?"pause.note.live":"pause.note.frozen");
  }
}
function resumePlay(){
  setPause(false);
  if(HFGAME.resume) HFGAME.resume();
}

// ---- two players ----------------------------------------------------------
// The rival panel is the whole story of the other town in three lines: whether
// their hall is up, how much of it is left, and whether they are out.
function refreshRivals(){
  var S=HFGAME.state(), box=el("rivals");
  if(!box) return;
  if(!S||!S.multi){ box.hidden=true; return; }
  box.hidden=(S.phase==="won"||S.phase==="lost");
  var html="", order=[S.me];
  for(var j=0;j<S.players.length;j++) if(j!==S.me) order.push(j);
  for(var oi=0;oi<order.length;oi++){
    var i=order[oi], p=S.players[i], mine=(i===S.me);
    var f=p.hall?Math.max(0,p.hall.hp/HFGAME.TYPES.hall.hp):(p.placed?0:1);
    var note=p.out?M.t("hud.rival.fallen")
                  :(p.hall?Math.ceil(f*100)+"%":M.t("hud.rival.nohall"));
    html+='<div class="rv'+(p.out?" out":"")+(mine?" me":"")+'">'+
          '<i style="background:'+rgb(p.col)+'"></i>'+
          '<span>'+M.t(mine?"hud.rival.you":"hud.rival.them")+'</span>'+
          '<b>'+note+'</b>'+
          '<div class="rvBar"><span style="width:'+(p.out?0:f*100).toFixed(1)+'%"></span></div>'+
          '</div>';
  }
  box.innerHTML=html;
}
function rgb(c){
  if(!c) return "var(--muted)";
  return "rgb("+Math.round(c[0]*255)+","+Math.round(c[1]*255)+","+Math.round(c[2]*255)+")";
}
// A guest runs no simulation, so nothing calls the HUD hooks for it; the frame
// loop does, and only when something actually moved.
var lastPhase=null, lastOut=null;
function netHud(){
  var S=HFGAME.state(); if(!S) return;
  var out=!!S.players[S.me].out;
  // Being knocked out is not a phase change, but it changes everything the
  // panel says, so it gets the same treatment.
  if(S.phase!==lastPhase||out!==lastOut){
    lastPhase=S.phase; lastOut=out;
    if(HFGAME.UI.phase) HFGAME.UI.phase();
  }
  // the building strip and the group counts are live numbers, so they refresh
  // with the frame rather than waiting for an event that may never come
  if(HFGAME.UI.building) HFGAME.UI.building();
  if(HFGAME.UI.units) HFGAME.UI.units();
  if(!S.multi) return;
  if(S.net==="guest" && HFGAME.UI.hotbar) HFGAME.UI.hotbar();
  refreshRivals();
}

// ---- multiplayer lobby ----------------------------------------------------
(function(){
  var mode="host", offerCode="", answerCode="";
  function setMode(m){
    mode=m;
    el("netModeHost").setAttribute("aria-pressed",m==="host"?"true":"false");
    el("netModeJoin").setAttribute("aria-pressed",m==="join"?"true":"false");
    el("netHost").hidden=(m!=="host");
    el("netJoin").hidden=(m!=="join");
    HFNET.reset();
    offerCode=""; answerCode="";
    status("Not connected.");
    el("netStart").disabled=true;
    el("netCreate").disabled=false;
    el("netReply").disabled=false;
    el("netConnect").disabled=!el("netAnswerIn").value.trim();
  }
  function status(msg,kind){
    var n=el("netStatus");
    n.textContent=msg;
    n.className=(kind==="good"||kind==="bad")?kind:"";
  }
  function copy(text,btn){
    var done=function(){ var t=btn.textContent; btn.textContent="Copied"; 
      setTimeout(function(){ btn.textContent=t; },1200); };
    if(navigator.clipboard&&navigator.clipboard.writeText)
      navigator.clipboard.writeText(text).then(done,function(){ fallback(); });
    else fallback();
    function fallback(){
      var ta=(btn.id==="netCopyOffer")?el("netOffer"):el("netAnswer");
      ta.focus(); ta.select();
      try{ document.execCommand("copy"); done(); }catch(e){ status("Select the code and copy it by hand.","bad"); }
    }
  }
  function mapNote(){
    // The host's difficulty is the round's, so the host should be able to see
    // it here rather than having to remember what they last picked.
    var d=HFGAME.DIFF[SET.difficulty];
    el("netMapNote").textContent = (playMap
      ? M.t("net.note.custom",{map:playMap.name})
      : M.t("net.note.random"))
      + M.t("net.note.tail",{difficulty:d.label.toLowerCase(), nests:d.nests});
  }

  HFNET.init({
    status:status,
    begin:function(o){
      // Both sides land here: the host after it presses Start, the guest the
      // moment the host's first message arrives.
      if(o.seat===1&&o.diff&&HFGAME.DIFF[o.diff]&&SET.difficulty!==o.diff){
        SET.difficulty=o.diff; applySettings();
      }
      var m=o.map||null;
      startRun(m,{players:2, me:o.seat, net:(o.seat===0?"host":"guest"), seed:o.seed});
      if(o.seat===1) HFGAME.setNetSend(HFNET.sendIntent);
    },
    open:function(role){
      if(role==="host"){ el("netStart").disabled=false; }
      // The handshake is done. Both of its buttons are now traps: Connect
      // would hand a spent reply back to a settled peer, and Create invite
      // would quietly throw away the connection you just made.
      el("netConnect").disabled=true;
      el("netCreate").disabled=true;
      el("netReply").disabled=true;
    },
    closed:function(wasLive){
      el("netStart").disabled=true;
      el("netCreate").disabled=false;
      el("netReply").disabled=false;
      if(wasLive&&screen==="play"){
        status("The other player disconnected.","bad");
        show("net");
      }
    }
  });

  el("netModeHost").addEventListener("click",function(){ setMode("host"); });
  el("netModeJoin").addEventListener("click",function(){ setMode("join"); });
  el("netBack").addEventListener("click",function(){ HFNET.leave(); show("menu"); });

  el("netCreate").addEventListener("click",function(){
    var again=!!offerCode;
    el("netCreate").disabled=true;
    HFNET.host().then(function(code){
      offerCode=code;
      el("netOffer").value=code;
      el("netCopyOffer").disabled=false;
      el("netCreate").disabled=false;
      // A new invite makes the old one dead, and any reply written for it too.
      // Clearing the box is the difference between "nothing happens" and a
      // player pasting a reply that can no longer possibly work.
      el("netAnswerIn").value="";
      el("netConnect").disabled=true;
      if(again) status("New invite made — the previous one no longer works. "+
                       "Send them this one.","bad");
    },function(e){
      status("Could not make an invite: "+e.message,"bad");
      el("netCreate").disabled=false;
    });
  });
  el("netCopyOffer").addEventListener("click",function(){ copy(offerCode,this); });
  // Typing in the reply box arms Connect — unless the handshake is already
  // done, in which case there is nothing left to connect and re-arming it is
  // how a player ends up pressing it twice.
  el("netAnswerIn").addEventListener("input",function(){
    el("netConnect").disabled=HFNET.live()||!this.value.trim();
  });
  el("netConnect").addEventListener("click",function(){
    var v=el("netAnswerIn").value.trim();
    if(!v) return;
    el("netConnect").disabled=true;
    HFNET.accept(v).catch(function(e){
      status(e.message||"That reply did not work.","bad");
      el("netConnect").disabled=false;
    });
  });
  el("netStart").addEventListener("click",function(){
    if(!HFNET.live()) return;
    var seed=(playMap&&playMap.seed)||(Math.floor(Math.random()*900000)+1000);
    HFNET.beginHost(seed, playMap, SET.difficulty);
  });

  el("netReply").addEventListener("click",function(){
    var v=el("netOfferIn").value.trim();
    if(!v) return;
    el("netReply").disabled=true;
    HFNET.join(v).then(function(code){
      answerCode=code;
      el("netAnswer").value=code;
      el("netCopyAnswer").disabled=false;
      el("netReply").disabled=false;
    },function(e){
      status(e.message||"That invite did not work.","bad");
      el("netReply").disabled=false;
    });
  });
  el("netCopyAnswer").addEventListener("click",function(){ copy(answerCode,this); });

  // refresh the map line whenever the lobby opens
  var obs=el("screen-net");
  new MutationObserver(function(){ if(!obs.hidden) mapNote(); })
    .observe(obs,{attributes:true,attributeFilter:["hidden"]});
})();

// ---- wiring ---------------------------------------------------------------
function startRun(map,opt){
  el("overlay").hidden=true;
  playMap=(map&&map.id)?map:null;      // guard: a stray Event is not a map
  opt=opt||null;
  show("play");
  HFGAME.start(opt&&opt.seed?opt.seed:(playMap?playMap.seed:null), playMap, opt);
  setCat(HFGAME.CATS[0].id);
  lastPhase=null; lastOut=null;
  paused=false; fromPause=false; el("pause").hidden=true;
  refreshRivals();
}
// "Go again" must not silently drop out of a two-player round, so it only
// restarts what it can restart on its own.
function playAgain(){
  if(HFNET.active()) return;
  startRun(playMap);
}
// Play opens the setup screen. Difficulty is a decision about the round you
// are about to start, not a preference that lives in a menu with the render
// options — it cannot be changed once the first night is coming.
el("btnPlay").addEventListener("click",function(){ show("setup"); });
el("btnLibrary").addEventListener("click",function(){ show("library"); });
el("btnMaps").addEventListener("click",function(){ show("maps"); });
el("btnNet").addEventListener("click",function(){ show("net"); });
el("btnSettings").addEventListener("click",function(){ show("settings"); });
document.querySelectorAll("[data-back]").forEach(function(b){
  b.addEventListener("click",function(){
    if(fromPause&&screen==="settings"){
      fromPause=false;
      show("play");
      HFGAME.restoreScene();
      if(HFGAME.resume) HFGAME.resume();
      setPause(true);
      return;
    }
    fromPause=false;
    show("menu");
  });
});
el("ovAgain").addEventListener("click",playAgain);
el("ovMenu").addEventListener("click",function(){
  el("overlay").hidden=true; HFNET.leave(); show("menu");
});
el("pResume").addEventListener("click",resumePlay);
el("pQuit").addEventListener("click",function(){
  setPause(false); HFNET.leave(); show("menu");
});
el("pControls").addEventListener("click",function(){
  var k=el("pauseKeys"), on=k.hidden;
  k.hidden=!on;
  el("pControls").setAttribute("aria-pressed",on?"true":"false");
});
el("pSettings").addEventListener("click",function(){
  // the round stays alive behind the settings card; Back returns to it
  fromPause=true;
  el("pause").hidden=true;
  show("settings");
});

el("grpWorkers").addEventListener("click",function(){
  HFGAME.selectGroup("workers"); HFGAME.UI.units();
});
el("grpArmy").addEventListener("click",function(){
  HFGAME.selectGroup("army"); HFGAME.UI.units();
});
el("dockShelter").addEventListener("click",function(){
  var b=HFGAME.bsel(); if(!b) return;
  if(b.type==="turret"){ HFGAME.clearTurret(b); HFGAME.UI.building(); return; }
  if(b.type==="gate"){ HFGAME.setGate(b,!b.shut); HFGAME.UI.building(); return; }
  HFGAME.setShelter(b,!HFGAME.sheltering(b));
  HFGAME.UI.building();
});
el("dockSell").addEventListener("click",function(){
  // One button, two subjects. The road check comes first because selecting a
  // road clears the building selection, so the two can never both be live.
  var rd=HFGAME.rsel();
  if(rd){ HFGAME.cancelRoad(rd.a,rd.b); HFGAME.selectRoad(null); return; }
  var b=HFGAME.bsel(); if(!b||b.type==="hall") return;
  HFGAME.removeAt(b.gx,b.gz);
  HFGAME.selectBuilding(null);
});
el("troopStance").addEventListener("click",function(){
  var S=HFGAME.state(); if(!S) return;
  HFGAME.setStance(S.stance==="hold"?"pursue":"hold");
  HFGAME.UI.units();
});

// settings controls
function wireSettings(){
  // Difficulty used to live here. It belongs to a round, not to a profile, so
  // it moved to the setup screen you pass through on the way into one.
  var o=el("setOutline");
  o.checked=SET.outline;
  o.addEventListener("change",function(){ SET.outline=o.checked; applySettings(); });
  var sc=el("setScale");
  sc.value=SET.scale;
  el("setScaleOut").textContent=Math.round(SET.scale*100)+"%";
  sc.addEventListener("input",function(){
    SET.scale=parseFloat(sc.value);
    el("setScaleOut").textContent=Math.round(SET.scale*100)+"%";
    applySettings();
  });
  var vo=el("setVol");
  vo.value=SET.vol;
  el("setVolOut").textContent=Math.round(SET.vol*100)+"%";
  vo.addEventListener("input",function(){
    SET.vol=parseFloat(vo.value);
    el("setVolOut").textContent=Math.round(SET.vol*100)+"%";
    applySettings();
  });
  var se=el("setSens");
  se.value=SET.sens;
  el("setSensOut").textContent=SET.sens.toFixed(2)+"×";
  se.addEventListener("input",function(){
    SET.sens=parseFloat(se.value);
    el("setSensOut").textContent=SET.sens.toFixed(2)+"×";
    applySettings();
  });
  el("setWipe").addEventListener("click",function(){
    SAVE={runs:0,wins:0,bestHall:0,bestTime:null,lastResult:null};
    saveJSON(KEY_SAVE,SAVE);
    refreshMenu();
    el("setWipe").textContent="Progress cleared";
    setTimeout(function(){ el("setWipe").textContent="Clear saved progress"; },1600);
  });
  el("setWipeAssets").addEventListener("click",function(){
    M.setOverrides({});
    M.setStatOverrides({});
    M.setMetaAll({});
    saveJSON(KEY_ASSETS,{});
    saveJSON(KEY_STATS,{});
    saveJSON(KEY_META,{});
    HFGAME.rebuildAssets();
    HFLIB.refreshCounts();
    HFLIB.refreshStats&&HFLIB.refreshStats();
    el("setWipeAssets").textContent="Edits cleared";
    setTimeout(function(){ el("setWipeAssets").textContent="Clear asset & balance edits"; },1600);
  });
}
// ---- the pre-game setup screen -------------------------------------------
// Everything here is read from the balance table, so a difficulty edited in the
// Library describes itself correctly without a second copy of its numbers.
function drawSetup(){
  var box=el("diffPick");
  if(!box) return;
  box.innerHTML="";
  Object.keys(HFGAME.DIFF).forEach(function(k){
    var C=HFGAME.DIFF[k];
    // The card quotes what the round will use, multipliers included — a card
    // that still said 290 while the pacing block below it had halved the waves
    // would be the one number on this screen that lies.
    var P=M.statsOf("pace");
    var first=(C.nests|0)*Math.max(1,Math.round(C.send*P.sendK));
    var startSupply=Math.round(C.supply*P.supplyK);
    var b=document.createElement("button");
    b.type="button"; b.className="diffCard"; b.dataset.diff=k;
    b.setAttribute("aria-pressed",k===SET.difficulty?"true":"false");
    b.innerHTML='<span class="dn">'+C.label+'</span><span class="dm">'+
      M.t("setup.card.nests",{n:C.nests})+'<br>'+
      M.t("setup.card.first",{n:first})+'<br>'+
      M.t("setup.card.supply",{n:startSupply})+'</span>';
    b.addEventListener("click",function(){
      SET.difficulty=k; applySettings(); refreshMenu(); drawSetup();
    });
    box.appendChild(b);
  });
  var C2=HFGAME.DIFF[SET.difficulty];
  el("diffBlurb").textContent=(M.textRaw("setup.blurb."+SET.difficulty)===null)
    ? C2.label : M.t("setup.blurb."+SET.difficulty);
  el("newMapName").textContent=playMap?playMap.name:M.t("setup.map.random");
  el("newMapNote").textContent=M.t(playMap?"setup.map.custom.note":"setup.map.random.note");
  el("newMapPick").textContent=M.t(playMap?"setup.map.change":"setup.map.choose");
  if(el("paceSummary")) drawPaceSummary();
}
// ---- pacing ----------------------------------------------------------------
// Four multipliers and the night-on-night ramp, on the screen you are already
// on when you decide what kind of round you want. They are ordinary balance
// stats, so they persist and reset through the same machinery as everything in
// the Library — there is no second copy of them and nothing here owns a number.
//
// The ramp is the odd one out: it lives with the nests, because it is the nests
// that send them, and it is surfaced here rather than duplicated because it is
// the single strongest lever on how long a run lasts.
var PACE_ROWS=[
  {id:"salvage", k:"amt"},
  {id:"worker",  k:"gather", pct:true, label:"setup.pace.gather", hint:"setup.pace.gather.hint"},
  {id:"worker",  k:"carry",  label:"setup.pace.carry", hint:"setup.pace.carry.hint"},
  {id:"pace",    k:"supply", auto:true},
  {id:"pace",    k:"first",  auto:true},
  {id:"nest",    k:"ramp",   growth:true, label:"setup.pace.ramp", hint:"setup.pace.ramp.hint"},
  {id:"pace",    k:"dayMin"},
  {id:"pace",    k:"nightMin"}
];
function paceField(r){
  return M.statDefs(r.id).fields.filter(function(f){ return f.k===r.k; })[0];
}
// Three of these are stored in units nobody wants to type. A gather rate is
// 2.4 supply a second, which is a rate you can only judge against the one it
// shipped at; a growth of 1.13 is a number you have to subtract one from and
// multiply by a hundred before it means anything. So the panel reads and writes
// percentages and the table keeps its own units — a presentation, not a second
// copy. The stored value is still the stat, and the Library still shows it raw.
function paceToView(r,v){
  var f=paceField(r);
  if(r.pct)    return Math.round(v/f.def*100);
  if(r.growth) return Math.round((v-1)*1000)/10;
  return v;
}
function paceFromView(r,v){
  var f=paceField(r);
  if(r.pct)    return f.def*v/100;
  if(r.growth) return 1+v/100;
  return v;
}
function paceStep(r){
  var f=paceField(r);
  if(r.pct)    return 5;
  if(r.growth) return 1;
  return f.step;
}
function paceEdited(){
  var n=0;
  PACE_ROWS.forEach(function(r){
    var o=M.getStatOverrides()[r.id];
    if(o&&o[r.k]!==undefined&&o[r.k]!==paceField(r).def) n++;
  });
  return n;
}
// What the numbers actually buy, in attackers on three nights. Growth
// compounds, so a player reading "13%" has no idea what they have chosen until
// they see where it lands — and the first night is a `0 means the difficulty`
// field, so the panel has to resolve it the same way the round will.
function paceCurve(){
  var C=HFGAME.DIFF[SET.difficulty], P=M.statsOf("pace"), N=M.statsOf("nest");
  var one=(P.first>0)?P.first:(C.send*(C.nests|0));
  var r=N.ramp;
  return {a:Math.round(one), b:Math.round(one*Math.pow(r,4)),
          c:Math.round(one*Math.pow(r,9))};
}
function drawPace(){
  var body=el("paceBody");
  if(!body) return;
  var h="";
  PACE_ROWS.forEach(function(r){
    var f=paceField(r);
    var raw=M.statsOf(r.id)[r.k];
    var o=M.getStatOverrides()[r.id]||{};
    var dirty=(o[r.k]!==undefined&&o[r.k]!==f.def);
    // A field that defers to the difficulty shows the figure the round will
    // actually use rather than the zero that means "defer". A blank box beside
    // the words "starting attackers" is not an answer to the question.
    var view=paceToView(r,raw);
    if(r.auto&&!(raw>0)) view=paceAuto(r);
    var unit=r.pct||r.growth?"%":(f.unit?" "+f.unit:"");
    h+='<label class="paceRow"><span><span class="pk'+(dirty?" pEdit":"")+'">'+
       (r.label?M.t(r.label):f.label)+(unit?'<span class="pu">'+unit+'</span>':'')+'</span>'+
       '<span class="ph">'+(r.hint?M.t(r.hint):(f.hint||("shipped "+f.def)))+'</span></span>'+
       '<input type="number" value="'+view+'" step="'+paceStep(r)+
       '" data-pid="'+r.id+'" data-pk="'+r.k+'" data-prow="'+PACE_ROWS.indexOf(r)+'"></label>';
  });
  body.innerHTML=h;
  body.querySelectorAll("[data-pk]").forEach(function(inp){
    inp.addEventListener("input",function(){
      var v=parseFloat(inp.value);
      if(!isFinite(v)) return;
      var r=PACE_ROWS[inp.dataset.prow|0];
      M.setStat(r.id,r.k,paceFromView(r,v));
      HFGAME.syncStats();
      saveJSON(KEY_STATS,M.getStatOverrides());
      drawPaceSummary(); drawSetup();
    });
  });
  drawPaceSummary();
}
// What a deferring field is worth right now, so the box can show it.
function paceAuto(r){
  var C=HFGAME.DIFF[SET.difficulty];
  if(r.k==="supply") return C.supply;
  if(r.k==="first")  return C.send*(C.nests|0);
  return paceField(r).def;
}
function drawPaceSummary(){
  var n=paceEdited(), c=paceCurve();
  el("paceSummary").textContent=
    (n?M.t("setup.pace.some",{n:n}):M.t("setup.pace.stock"))+" · "+
    M.t("setup.pace.curve",{a:c.a,b:c.b,c:c.c});
  el("paceReset").hidden=!n;
}
el("paceHead").addEventListener("click",function(){
  var body=el("paceBody"), open=body.hidden;
  body.hidden=!open;
  this.setAttribute("aria-expanded",open?"true":"false");
  if(open) drawPace();
});
el("paceReset").addEventListener("click",function(){
  PACE_ROWS.forEach(function(r){
    var f=M.statDefs(r.id).fields.filter(function(x){ return x.k===r.k; })[0];
    M.setStat(r.id,r.k,f.def);
  });
  HFGAME.syncStats();
  saveJSON(KEY_STATS,M.getStatOverrides());
  drawPace(); drawSetup();
});
el("newGo").addEventListener("click",function(){ startRun(playMap); });
el("newBack").addEventListener("click",function(){ show("menu"); });
el("newMapPick").addEventListener("click",function(){ show("maps"); });

window.addEventListener("keydown",function(ev){
  if(screen==="library" && HFLIB.keydown(ev)) return;
  if(screen==="maps" && HFMAP.keydown(ev)) return;
  if(ev.key==="Escape"){
    if(screen==="settings"&&fromPause){
      fromPause=false;
      show("play"); HFGAME.restoreScene();
      if(HFGAME.resume) HFGAME.resume();
      setPause(true);
      return;
    }
    if(screen==="library"||screen==="settings"||screen==="setup") show("menu");
    else if(screen==="play"&&el("overlay").hidden){
      // Escape lets go before it opens anything. A player reaching for it
      // mid-round usually means "never mind, I did not want that" rather than
      // "stop the game", and having to press ctrl+D first to get out of a
      // held building is one keystroke of friction in the exact moment there
      // is no time for it. Only an empty cursor and an empty selection get
      // the menu.
      if(paused) resumePlay();
      else if(!HFGAME.deselectAll()) setPause(true);
    }
    return;
  }
  if(screen==="play"){
    // Ctrl+D is the one that lets go of things now
    if((ev.ctrlKey||ev.metaKey)&&(ev.key==="d"||ev.key==="D")){
      ev.preventDefault();
      HFGAME.deselectAll();
      return;
    }
    if(paused) return;                    // nothing else reaches a paused round
    if(ev.key==="Tab"){ ev.preventDefault(); cycleCat(ev.shiftKey); return; }
    if(ev.key>="1"&&ev.key<="9"){
      var S=HFGAME.state();
      if(S&&(S.phase==="build"||S.phase==="attack")&&pickInCat(parseInt(ev.key,10)-1)){
        ev.preventDefault(); return; }
    }
    HFGAME.keydown(ev);
  }
});

// ---- text -----------------------------------------------------------------
// Static markup carries a key, not a string: `data-t` fills textContent and
// `data-t-ph` a placeholder. Nothing in the HTML holds a copy of the words, so
// a line edited in the Library's Text tab has exactly one place to change.
// Anything the game composes at runtime calls M.t() at the point of use
// instead, which is why applyText only has to walk the document once per edit.
function applyText(root){
  (root||document).querySelectorAll("[data-t]").forEach(function(n){
    n.textContent=M.t(n.dataset.t);
  });
  (root||document).querySelectorAll("[data-t-ph]").forEach(function(n){
    n.placeholder=M.t(n.dataset.tPh);
  });
}
// A text edit can land while any screen is up, so everything that prints a
// composed string is refreshed too rather than waiting for the next event that
// happens to redraw it.
function retext(){
  applyText();
  refreshMenu();
  if(el("screen-setup")&&!el("screen-setup").hidden) drawSetup();
  buildHotbar();
  if(HFGAME.UI.hotbar) HFGAME.UI.hotbar();
  if(HFGAME.state()){
    if(HFGAME.UI.phase) HFGAME.UI.phase();
    if(HFGAME.UI.units) HFGAME.UI.units();
    if(HFGAME.UI.building) HFGAME.UI.building();
  }
}

// ---- boot -----------------------------------------------------------------
loadAll();
applyText();
applySettings();
HFGAME.init(R,canvas,SET,onRoundEnd);
buildHotbar();
HFMAP.init(R,canvas,function(){
  saveJSON(KEY_MAPS,M.getMaps());
},function(m){
  saveJSON(KEY_MAPS,M.getMaps());
  startRun(m);
});
HFLIB.init(R,canvas,function(){
  // an edit in the Library is the single source of truth: persist it and
  // rebuild the game's batches so placed buildings match immediately
  saveJSON(KEY_ASSETS,M.getOverrides());
  saveJSON(KEY_STATS,M.getStatOverrides());
  saveJSON(KEY_USER,M.getUserAssets());
  saveJSON(KEY_META,M.getMeta());
  saveJSON(KEY_TEXT,M.getTextOverrides());
  HFGAME.rebuildAssets();
  retext();
});
wireSettings();
show("menu");

var last=performance.now();
function frame(now){
  var dt=Math.min(0.05,(now-last)/1000); last=now;
  if(screen==="play"){
    if(!(paused&&canFreeze())) HFGAME.update(dt);
    HFNET.tick(dt);
    netHud();
    refreshDay();
    refreshWave();
    minimap(dt);
    worldBars();
    HFGAME.draw();
  } else if(screen==="library"){
    HFLIB.update(dt);
    HFLIB.draw();
  } else if(screen==="maps"){
    HFMAP.update(dt);
    HFMAP.draw();
  } else {
    // the menu backdrop drifts slowly between afternoon and dusk, so the
    // cycle is visible before you press Play — but never dark enough to
    // swallow the panel behind it
    bdAz+=2.4*dt; bdClock+=dt;
    R.setTime(0.40+0.34*Math.sin(bdClock*0.070));
    R.render(backdropCam(),[],null);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__hf={ show:function(s){show(s);}, game:HFGAME, lib:HFLIB, map:HFMAP, gl:R,
              settings:SET, save:function(){return SAVE;},
              playMap:function(){ return playMap; } };
})();
