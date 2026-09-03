// ===========================================================================
// Nightward — solo round: build phase, attack phase, resolution
// ===========================================================================
var HFGAME=(function(){
"use strict";
var M=HF;
var CELL=M.CELL, GN=M.GN, PLAT=M.PLAT, BUILD_R=M.BUILD_R;

var R=null, canvas=null, SET=null, onEnd=null, active=false;
var SND=(typeof HFSND!=="undefined")?HFSND:null;
var B=null, BATCHES=null, buf={};

// ---- balance --------------------------------------------------------------
// Structure and art live here; every gameplay number comes from the balance
// registry in the core, so the Library is the single place they are edited.
// hall keeps cost 0 — it is placed, not bought.
// `cat` places a building in the hotbar; `blurb(b)` is its one-line summary,
// read from live stats so the hotbar never disagrees with the Library.
var CATS=[
  {id:"core",  name:"Base",     note:"What you are protecting, and what pays for the rest."},
  {id:"guns",  name:"Defences", note:"They do the killing. Put them where you want the fighting to happen."},
  {id:"walls", name:"Walls",    note:"They stop nothing. They decide where it happens."},
  {id:"muster",name:"Troops",   note:"People, not buildings. Right-click to send them somewhere."}
];
var TYPES={
  hall : {name:"Town Hall", cat:"core", foot:3, scale:1.00, cost:0,
          colA:M.PAL.plaster, colB:M.PAL.slate, spawns:"worker",
          blurb:function(t){ return t.cap+" live here · raise "+t.raise+"s"; }},
  cottage:{name:"Cottage", cat:"core", foot:1, scale:0.66, spawns:"worker",
          colA:M.PAL.plaster, colB:M.PAL.thatch,
          blurb:function(t){ return t.cap+" more hands · "+t.retrain+"s each"; }},
  tower: {name:"Watchtower", cat:"guns", foot:1, scale:0.70,
          colA:M.PAL.timberL, colB:M.PAL.iron,
          blurb:function(t){ return t.dmg+" every "+t.fire+"s · close"; }},
  ballista:{name:"Ballista", cat:"guns", foot:1, scale:0.78, boltScale:2.1,
          colA:M.PAL.timberL, colB:M.PAL.iron,
          blurb:function(t){ return t.dmg+" and splash · slow"; }},
  brazier:{name:"Brazier", cat:"guns", foot:1, scale:0.90,
          colA:M.PAL.stone, colB:M.PAL.iron,
          blurb:function(t){ return "reloads the guns near it"; }},
  wall : {name:"Palisade", cat:"walls", foot:1, scale:1.00,
          colA:M.PAL.timber, colB:M.PAL.iron,
          blurb:function(t){ return t.hp+" health · drag a run"; }},
  gate : {name:"Gate", cat:"walls", foot:1, scale:1.00,
          colA:M.PAL.timberL, colB:M.PAL.iron,
          blurb:function(t){ return t.hp+" health · they like it"; }},
  barracks:{name:"Barracks", cat:"muster", foot:1, scale:0.72, spawns:"soldier",
          colA:M.PAL.timber, colB:M.PAL.slate,
          blurb:function(t){ return t.cap+" soldiers · "+t.retrain+"s each"; }},
  archery:{name:"Archery Range", cat:"muster", foot:1, scale:0.72, spawns:"archer",
          colA:M.PAL.timberL, colB:M.PAL.thatch,
          blurb:function(t){ return t.cap+" archers · "+t.retrain+"s each"; }}
};

// ---- defenders ------------------------------------------------------------
// Soldiers hold a lane with their bodies; archers out-range everything and die
// to anything that reaches them. Both are mustered by a building and belong to
// it, so losing the building costs you the replacements, not the survivors.
var UNITS={
  soldier:{name:"Soldier", asset:"soldier", melee:true,
           scBase:1.26, scVar:0.08, colA:[0.475,0.395,0.262], colB:[0.610,0.650,0.685],
           gib:[0.72,0.70,0.58]},
  archer :{name:"Archer",  asset:"archer",  melee:false,
           scBase:1.20, scVar:0.08, colA:[0.352,0.430,0.372], colB:[0.545,0.470,0.300],
           gib:[0.62,0.70,0.60]},
  worker :{name:"Worker",  asset:"worker",  civil:true,
           scBase:1.18, scVar:0.08, colA:[0.430,0.398,0.300], colB:[0.545,0.520,0.470],
           gib:[0.70,0.66,0.56]},
  // One per player, on the field before anything is built. It is the only unit
  // that can raise a hall, which is why the round starts with a walk rather
  // than a click: where you put the hall costs you the time to get there.
  commander:{name:"Commander", asset:"commander", melee:true, hero:true,
           scBase:1.42, scVar:0.00, colA:[0.300,0.330,0.395], colB:[0.545,0.560,0.590],
           gib:[0.62,0.66,0.72]}
};

// ---- attackers ------------------------------------------------------------
// Three silhouettes doing three jobs. The runner punishes an unfinished
// perimeter, the brute punishes a perimeter with no concentrated damage behind
// it, and the shambler is the mass that makes both of those matter.
var ENEMY={
  shambler:{name:"Shambler", asset:"swarm",
            scBase:0.86, scVar:0.26, gib:[0.62,0.58,0.44],
            colA:[0.255,0.272,0.235], colB:[0.345,0.352,0.305]},
  runner  :{name:"Runner",   asset:"runner",
            scBase:0.78, scVar:0.16, gib:[0.70,0.62,0.46],
            colA:[0.243,0.255,0.220], colB:[0.412,0.408,0.348]},
  brute   :{name:"Brute",    asset:"brute",
            scBase:1.14, scVar:0.16, gib:[0.52,0.44,0.34],
            colA:[0.228,0.218,0.192], colB:[0.318,0.306,0.258]}
};

// ---- enemy rigs -----------------------------------------------------------
// Each attacker is drawn as five instances — a body, two arms, two legs —
// instead of one baked mesh. Pivots are read from the live asset, so editing a
// leg in the Library moves the joint it swings from rather than breaking it.
// `gait` is the whole animation vocabulary: how far a limb swings, how fast the
// cadence runs per unit of speed, how much the body rises and leans.
var RIGDEF={
  swarm:{ body:["torso","neck","head","eyes"], arm:["arms"], leg:["legs"],
          gait:{swing:0.62, armK:0.72, cad:2.55, bob:0.055, lean:0.14, sway:0.10,
                reach:0.95, wind:0.75} },
  runner:{ body:["torso","neck","head","eyes"], arm:["arms"], leg:["legs"],
          gait:{swing:0.95, armK:0.88, cad:2.15, bob:0.085, lean:0.30, sway:0.06,
                reach:1.05, wind:0.55} },
  brute:{ body:["torso","hump","shldr","head","eyes"], arm:["arms","fists"], leg:["legs"],
          gait:{swing:0.42, armK:0.50, cad:2.90, bob:0.070, lean:0.10, sway:0.16,
                reach:1.25, wind:1.15} },
  // Your own people get the same treatment, with one difference that matters:
  // `armL` names a second, left-hand bone. The horde swings two of the same
  // arm; a soldier carries a spear in one hand and a shield in the other, so
  // each side needs its own mesh or the weapon doubles.
  soldier:{ body:["tunic","torso","neck","head","helm","sig"],
          arm:["arms","spear","tip"], armL:["arms","shield","boss"], leg:["legs"],
          // a spear pivots at the shoulder, so a swing that suits a horde's
          // stubby arm turns a 1.5-unit shaft into a windmill: the angles here
          // are small on purpose, and read as a thrust
          gait:{swing:0.52, armK:0.28, cad:2.30, bob:0.045, lean:0.02, sway:0.06,
                reach:0.40, wind:0.24} },
  archer:{ body:["cloak","belt","head","hood","quiver","shafts","sig"],
          arm:["arms","bowU","bowL"], armL:["arms"], leg:["legs"],
          // a bow is drawn back and released, so the wind-up is the whole story
          gait:{swing:0.50, armK:0.22, cad:2.35, bob:0.040, lean:0.03, sway:0.05,
                reach:0.16, wind:0.50} },
  worker:{ body:["torso","apron","head","cap","sig"],
          arm:["arms","haft","head2"], armL:["arms"], leg:["legs"],
          gait:{swing:0.55, armK:0.40, cad:2.45, bob:0.055, lean:0.04, sway:0.07,
                reach:0.55, wind:0.38} },
  commander:{ body:["tabard","cuirass","sash","pauldron","mantle","cloakC","cloakM",
                    "cloakO","clasp","neck","head","crown","points","jewel","scab","sig"],
          arm:["arms","grip","guard","sword"], armL:["arms"], leg:["legs","boots"],
          gait:{swing:0.48, armK:0.26, cad:2.10, bob:0.040, lean:0.01, sway:0.05,
                reach:0.52, wind:0.32} }
};
var RIG={};
// Build (or rebuild) the bone meshes and remember each joint in asset space.
function buildRigs(makeBatch){
  for(var id in RIGDEF){
    var d=RIGDEF[id];
    var hip=M.jointTop(id,d.leg[0])||[0.1,0.4,0];
    var sho=M.jointTop(id,d.arm[0])||[0.25,0.9,0];
    var tor=M.partBase(id,d.body[0])||[0,0.4,0];
    var r=RIG[id]||(RIG[id]={});
    r.hip=hip; r.sho=sho; r.rootY=tor[1]; r.gait=d.gait;
    var bodyM=M.buildBone(id,d.body,[0,tor[1],0]);
    var armM =M.buildBone(id,d.arm,sho,{single:true});
    var legM =M.buildBone(id,d.leg,hip,{single:true});
    var armLM=d.armL ? M.buildBone(id,d.armL,[-sho[0],sho[1],sho[2]],{side:-1}) : null;
    r.twoArms=!!d.armL;
    if(makeBatch){
      r.bBody=R.makeBatch(bodyM); r.bArm=R.makeBatch(armM); r.bLeg=R.makeBatch(legM);
      if(armLM) r.bArmL=R.makeBatch(armLM);
    } else {
      R.rebuildBatch(r.bBody,bodyM); R.rebuildBatch(r.bArm,armM); R.rebuildBatch(r.bLeg,legM);
      if(armLM&&r.bArmL) R.rebuildBatch(r.bArmL,armLM);
    }
  }
}

// Copy resolved stats onto the live tables. Called on boot, at the start of a
// round, and whenever the Library edits a number — so a change in the editor
// reaches a round already in progress.
var NEST={};
function syncStats(){
  var t,k,st;
  // The nests are not in TYPES/UNITS/ENEMY, so their block is read straight out
  // of the balance table here and re-read whenever the library edits it.
  NEST=M.statsOf("nest")||{};
  for(t in TYPES){
    st=M.statsOf(t);
    if(st) for(k in st) TYPES[t][k]=st[k];
  }
  for(t in ENEMY){
    st=M.statsOf(ENEMY[t].asset);
    if(st) for(k in st) ENEMY[t][k]=st[k];
  }
  for(t in UNITS){
    st=M.statsOf(UNITS[t].asset);
    if(st) for(k in st) UNITS[t][k]=st[k];
  }
}
syncStats();
// Difficulty sets the shape of the game, not just its numbers: how many nests
// ring you, and how many each one sends on the first night. The wave is the sum
// of what the living nests send, so pulling one down is a permanent cut to
// every night after — which is the whole reason to leave the walls.
// `send` is per nest per night one; `nests` is how many the map seeds.
var DIFF={
  easy  :{supply:60, nests:3, send:112, hp:36, label:"Easy",
          mix:{shambler:0.76, runner:0.20, brute:0.04}},
  normal:{supply:45, nests:5, send:104, hp:42, label:"Normal",
          mix:{shambler:0.66, runner:0.25, brute:0.09}},
  hard  :{supply:30, nests:8, send:98,  hp:46, label:"Hard",
          mix:{shambler:0.58, runner:0.28, brute:0.14}}
};
var BOLT_SPEED=30;
// Two settlements sit this far either side of the middle, far enough apart that
// their build rings never touch but close enough to see each other fight.
// Two towns on a 120-unit map want real distance between them; 32 apart was
// sized for a grid a third this wide.
var SEAT=[[[0,0]], [[-34,0],[34,0]]];
var SEAT_COL=[[0.62,0.72,0.86],[0.86,0.72,0.50]];   // player tints on the map
var MAX_PARTS=640, MAX_CORPSES=200;

var S=null;
function conf(){ return DIFF[(SET&&SET.difficulty)||"normal"]||DIFF.normal; }

// ---- lifecycle ------------------------------------------------------------
function init(renderer, cv, settings, endCb){
  R=renderer; canvas=cv; SET=settings; onEnd=endCb;
  syncStats();
  B={
    hall :R.makeBatch(M.buildAsset("hall")),  tower:R.makeBatch(M.buildAsset("tower")),
    wall :R.makeBatch(M.buildAsset("wall")),  gate :R.makeBatch(M.buildAsset("gate")),
    wpost:R.makeBatch(M.buildAsset("wallpost")),
    ballista:R.makeBatch(M.buildAsset("ballista")), brazier:R.makeBatch(M.buildAsset("brazier")),
    barracks:R.makeBatch(M.buildAsset("barracks")), archery:R.makeBatch(M.buildAsset("archery")),
    soldier:R.makeBatch(M.buildAsset("soldier")), archer:R.makeBatch(M.buildAsset("archer")),
    worker:R.makeBatch(M.buildAsset("worker")), cottage:R.makeBatch(M.buildAsset("cottage")),
    commander:R.makeBatch(M.buildAsset("commander")),
    salvage:R.makeBatch(M.buildAsset("salvage")),
    nest:R.makeBatch(M.buildAsset("nest")),
    arrow:R.makeBatch(M.buildAsset("arrow"),false),
    marker:R.makeBatch(M.buildAsset("marker"),false),
    debris:R.makeBatch(M.buildAsset("spark"),false),
    corpse:R.makeBatch(M.buildAsset("corpse")),
    bolt :R.makeBatch(M.buildAsset("tracer"),false),
    spark:R.makeBatch(M.buildAsset("spark"),false),
    ring :R.makeBatch(M.buildAsset("ring"),false), tile:R.makeBatch(M.meshTile(),false),
    grid :R.makeBatch(M.buildAsset("grid"),false),
    site :R.makeBatch(M.buildAsset("site"))
  };
  // corpses first so living attackers and effects draw over them; a site is
  // ground clutter, so it sits with the salvage rather than with the buildings
  BATCHES=[B.corpse,B.salvage,B.site,B.hall,B.tower,B.ballista,B.brazier,
           B.barracks,B.archery,B.cottage,
           B.wall,B.wpost,B.gate,
           B.nest,B.soldier,B.archer,B.worker,B.commander,
           B.bolt,B.arrow,B.spark,B.debris,B.ring,B.marker,B.tile,B.grid];
  buildRigs(true);
  // bones draw with the living attackers, between the buildings and the effects
  var rigB=[];
  for(var rk in RIG){
    rigB.push(RIG[rk].bLeg,RIG[rk].bArm,RIG[rk].bBody);
    if(RIG[rk].bArmL) rigB.push(RIG[rk].bArmL);
  }
  // found the seam rather than counting it — the list has grown twice already
  var cut=BATCHES.indexOf(B.nest);
  BATCHES=BATCHES.slice(0,cut).concat(rigB,BATCHES.slice(cut));
  // Late nights are an order of magnitude bigger than the old single wave, and
  // a batch that overflows its buffer truncates silently.
  var CAP={swarm:2600,runner:1900,brute:900,corpse:MAX_CORPSES,spark:MAX_PARTS,
           debris:MAX_PARTS,
           bolt:400,arrow:300,wall:1400,soldier:120,archer:120,worker:120,
           commander:8,
           marker:24,salvage:24,cottage:120,nest:24,site:600};
  ["hall","tower","ballista","brazier","barracks","archery","cottage",
   "wall","wpost","gate",
   "soldier","archer","worker","commander","salvage","nest",
   "corpse","bolt","arrow","spark","debris","ring","marker","tile","grid","site"].forEach(function(k){
    buf[k]=new Float32Array(12*(CAP[k]||700));
  });
  // one buffer per bone: body holds one instance per attacker, arms and legs two
  for(var ek in RIGDEF){
    buf[ek+"Body"]=new Float32Array(12*(CAP[ek]||700));
    buf[ek+"Arm"] =new Float32Array(24*(CAP[ek]||700));
    buf[ek+"Leg"] =new Float32Array(24*(CAP[ek]||700));
    if(RIGDEF[ek].armL) buf[ek+"ArmL"]=new Float32Array(12*(CAP[ek]||700));
  }
  wireInput();
}

function newGame(seed,map,opt){
  syncStats();
  map=map||null; opt=opt||{};
  var RD=(map&&map.round)||{};
  // the map's own settings win over the difficulty preset where it sets them
  M.setBuildR(RD.buildR||M.GEN_DEF.buildR);
  BUILD_R=M.buildR();
  var pn=Math.max(1,Math.min(2,(opt&&opt.players)|0||1));
  var seats=SEAT[pn-1];
  var mapNests=(map&&map.nests&&map.nests.length)?map.nests:null;
  var C=conf();
  // A hand-built map places its own nests; otherwise the difficulty says how
  // many to ring the settlement with, which is what makes easy and hard
  // different games rather than the same game with bigger numbers.
  var gen=map?map.gen:null;
  if(!mapNests){
    var g2={}; for(var gk in (gen||{})) g2[gk]=gen[gk];
    if(g2.nestN===undefined||g2.nestN===null) g2.nestN=RD.nests||C.nests||5;
    gen=g2;
  }
  var T=M.makeTerrain(seed,gen,mapNests,seats);
  var mesh=M.buildStatic(T,map?map.props:null);
  R.setStatic(mesh);
  // live copies: a nest is a target, so it carries hp and takes hits
  var nests=T.nests.map(function(n){
    // A map may pin a nest's health; otherwise the balance table decides. `dmg`
    // records who has hurt it, because the cache goes to whoever did the work.
    var hp=n.hp||NEST.hp||2600;
    return {x:n.x, z:n.z, r:n.r||16, share:n.share||1, hp:hp, max:hp,
            hit:0, kx:0, kz:0, stag:0, nest:true, dead:false, pulse:Math.random()*6.28,
            dmg:{}, callCd:0, guards:0};
  });
  var dayLen=RD.day||DAY_LEN, nightLen=RD.night||NIGHT_LEN;
  S={
    seed:seed, T:T, staticMesh:mesh, map:map,
    net:opt.net||null,            // "host" | "guest" | null
    nests:nests,
    // one seat per player: where their ring is, what they have spent, and
    // whether their town hall is still up
    players:seats.map(function(c,i){
      return {id:i, cx:c[0], cz:c[1], name:"Player "+(i+1),
              supply:RD.supply||C.supply, hall:null, site:null, cmd:null, out:false,
              stance:"hold", col:SEAT_COL[i]};
    }),
    me:Math.max(0,Math.min(pn-1,(opt.me|0)||0)),
    multi:pn>1,
    phase:"build", supply:RD.supply||C.supply, ehp:RD.hp||C.hp, wave:0,
    send:RD.send||C.send||104,     // what one nest sends on the first night
    cells:{}, hall:null, enemies:[], bolts:[], parts:[], corpses:[], queue:[],
    units:[], markers:[], stance:"hold", marquee:null,
    nodes:makeNodes(seed,map), gathered:0,
    dayLeft:dayLen, dayLen:dayLen,
    nightLeft:nightLen, nightLen:nightLen,
    spawnLeft:0, spawnTimer:0, waveClock:0, shake:0, dawnBurn:0,
    night:1,                       // which night is coming; 1 is the first
    lastBurn:0, lastHeld:0,        // what the previous night cost, for the HUD
    sel:null, bsel:null, hover:null, flash:0, dist:null, distDirty:true, kills:0,
    rotStep:0, rotAuto:true,
    dayP:0.00, dayTo:0.44, daySpd:DAY_DUSK
  };
  // Everybody starts the same way: one crowned officer standing on open ground
  // with no town behind them.
  if(S.net!=="guest"){
    for(var pi=0;pi<S.players.length;pi++) spawnCommander(S.players[pi]);
    garrisonNests();          // the nests are occupied from the first morning
  }
  cam.az=38; cam.el=36; cam.zoom=17;
  var mySeat=S.players[S.me];
  cam.tx=mySeat.cx; cam.tz=mySeat.cz;
  if(UI.phase) UI.phase();
  return S;
}
function start(seed,map,opt){
  active=true;
  newGame(seed||(map&&map.seed)||(Math.floor(Math.random()*900000)+1000), map, opt);
}
function stop(){ active=false; }
function resume(){ active=true; }
function restoreScene(){ if(S&&S.staticMesh) R.setStatic(S.staticMesh); }
// pick up Library edits without restarting the round
function rebuildAssets(){
  syncStats();
  if(!B) return;
  [["hall","hall"],["tower","tower"],["wall","wall"],["gate","gate"],
   ["bolt","tracer"],["ring","ring"],["grid","grid"],["debris","spark"],
   ["wpost","wallpost"],["ballista","ballista"],["brazier","brazier"],
   ["corpse","corpse"],["spark","spark"],["nest","nest"],
   ["barracks","barracks"],["archery","archery"],
   ["soldier","soldier"],["archer","archer"],["worker","worker"],
   ["commander","commander"],
   ["cottage","cottage"],["salvage","salvage"],
   ["arrow","arrow"],["marker","marker"]]
  .forEach(function(pair){ R.rebuildBatch(B[pair[0]], M.buildAsset(pair[1])); });
  buildRigs(false);
}

// ---- grid -----------------------------------------------------------------
function key(gx,gz){ return gx+","+gz; }
function cellAt(gx,gz){ return S.cells[key(gx,gz)]||null; }
function rootOf(c){ return c ? (c.ref||c) : null; }
function me(){ return S.players[S.me]; }
function livePlayers(){
  return S.players.filter(function(p){ return !p.out; });
}
// Each player builds inside their own ring. `p` defaults to whoever is playing
// on this client, so every single-player call site keeps working.
// There is no perimeter any more: the map is the limit. What still stops you
// is the ground itself — you cannot build off the edge of it, and you cannot
// build on the tainted ring a nest has already claimed.
function inBuildZone(gx,gz,p){
  if(gx<1||gz<1||gx>=M.GN-1||gz>=M.GN-1) return false;
  var x=M.gx2w(gx), z=M.gx2w(gz);
  for(var i=0;i<S.nests.length;i++){
    var nn=S.nests[i];
    if(nn.dead) continue;
    if(Math.hypot(nn.x-x,nn.z-z) <= nn.r*0.85) return false;
  }
  return true;
}
function footCells(t,gx,gz){
  var out=[], f=TYPES[t].foot, r=(f-1)/2;
  for(var dx=-r;dx<=r;dx++) for(var dz=-r;dz<=r;dz++) out.push([gx+dx,gz+dz]);
  return out;
}
function canPlace(t,gx,gz,p){
  p=p||me();
  if(p.out) return false;
  if(t==="hall" && (p.hall||p.site)) return false;
  if(t==="hall" && !cmdOf(p)) return false;      // nobody left to raise it
  if(t!=="hall" && !p.hall) return false;
  if(TYPES[t].cost>p.supply) return false;
  var cs=footCells(t,gx,gz);
  for(var i=0;i<cs.length;i++){
    if(!inBuildZone(cs[i][0],cs[i][1],p)) return false;
    if(cellAt(cs[i][0],cs[i][1])) return false;
    // you cannot wall an attacker in: the ground has to be clear first
    if(S.phase==="attack" &&
       nearestEnemy(M.gx2w(cs[i][0]),M.gx2w(cs[i][1]),M.CELL*0.72)) return false;
  }
  return true;
}
// Walls and gates align to their neighbours by default; pressing R takes
// manual control and the chosen facing is baked into the placed building.
function ghostRot(t,gx,gz){
  if(S.rotAuto) return (t==="wall"||t==="gate") ? wallRot(gx,gz) : 0;
  return S.rotStep*Math.PI/2;
}
function bRot(b){
  if(b.rotAuto && (b.type==="wall"||b.type==="gate")) return wallRot(b.gx,b.gz);
  return b.rot||0;
}
// Building is not a day job. The dock, the ghost, rotation, selling back — all
// of it stays live through the night, because a hole in the wall at 1:40 is
// exactly when you most want to plug it.
function playable(){ return !!S && (S.phase==="build"||S.phase==="attack"); }
function rotate(back){
  if(!playable()) return;
  S.rotAuto=false;
  S.rotStep=((S.rotStep+(back?3:1))%4+4)%4;
  if(UI.rot) UI.rot();
}
function rotAuto(){
  if(!playable()) return;
  S.rotAuto=true; S.rotStep=0;
  if(UI.rot) UI.rot();
}

function place(t,gx,gz,pid,rotOv){
  // A guest never touches the world directly: it asks, the host decides, and
  // the next snapshot is the answer.
  if((pid===undefined||pid===null)&&guest())
    return intent({m:"pl",t:t,gx:gx,gz:gz,r:r2(ghostRot(t,gx,gz))});
  var p=(pid===undefined||pid===null)?me():S.players[pid];
  if(!p||!canPlace(t,gx,gz,p)) return false;
  var b={type:t,gx:gx,gz:gz,hp:TYPES[t].hp,max:TYPES[t].hp,cd:Math.random()*0.4,
         rot:(rotOv===undefined?ghostRot(t,gx,gz):rotOv),
         rotAuto:(rotOv===undefined?S.rotAuto:false), own:p.id};
  footCells(t,gx,gz).forEach(function(c){
    S.cells[key(c[0],c[1])] = (c[0]===gx&&c[1]===gz) ? b : {ref:b,type:t,own:p.id};
  });
  p.supply-=TYPES[t].cost;
  if(SND&&p.id===S.me) SND.place(M.gx2w(gx),M.gx2w(gz));
  // A hall is not placed, it is started. The commander has to walk over and
  // raise it, and until it stands there is nothing to build behind.
  if(t==="hall"){
    b.site=true; b.prog=0; b.need=Math.max(1,TYPES.hall.raise||14);
    b.hp=Math.max(1,Math.round(b.max*0.15));
    p.site=b; p.placed=true;
    if(p.id===S.me) S.sel=null;   // nothing is held after a click, by design
  } else {
    // Everything else goes up on its own, but it still goes up: what you place
    // is a heap of materials that becomes the building when the work is done.
    // Nothing shoots, trains, houses or lights from a heap of materials.
    var rz=+TYPES[t].raise||0;
    if(rz>0){
      b.site=true; b.prog=0; b.need=rz;
      b.hp=Math.max(1,Math.round(b.max*0.30));
    } else finishBuild(b);
  }
  S.distDirty=true; S.netCellsDirty=true;
  if(UI.hotbar) UI.hotbar();
  if(UI.phase) UI.phase();
  return true;
}
function removeAt(gx,gz,pid){
  if(!playable()) return;
  if((pid===undefined||pid===null)&&guest()) return intent({m:"rm",gx:gx,gz:gz});
  var c=cellAt(gx,gz); if(!c) return;
  var b=rootOf(c);
  var p=S.players[(b.own===undefined)?((pid===undefined)?S.me:pid):b.own];
  if(pid!==undefined && pid!==null && b.own!==undefined && b.own!==pid) return;  // not yours
  if(b.type==="hall"&&p){ p.hall=null; p.site=null; p.placed=false; }
  evict(b);
  if(b.garrison) disband(b);
  if(S.bsel===b) S.bsel=null;
  footCells(b.type,b.gx,b.gz).forEach(function(cc){ delete S.cells[key(cc[0],cc[1])]; });
  if(p) p.supply+=Math.round(TYPES[b.type].cost*0.8);
  if(SND) SND.remove(M.gx2w(b.gx),M.gx2w(b.gz));
  S.distDirty=true; S.netCellsDirty=true;
  if(UI.hotbar) UI.hotbar();
  if(UI.phase) UI.phase();
}

// ---- salvage ---------------------------------------------------------------
// Finite piles, seeded with the map. Two modest ones inside the ring you can
// work in safety, and richer ones out where the lanes run — which is the whole
// economic decision: the supply you need most is in the place you least want to
// leave your workers standing.
var DAY_LEN=360;                 // six minutes to build
var NIGHT_LEN=120;               // two minutes to hold, then the sun comes up
function makeNodes(seed,map){
  // a map that places its piles by hand replaces the seeded scatter wholesale
  if(map&&map.nodes&&map.nodes.length){
    return map.nodes.map(function(n){
      var a=Math.round(n.amt)||60;
      return {x:n.x, z:n.z, amt:a, max:a, rot:n.rot||0};
    });
  }
  var st=M.statsOf("salvage")||{nearN:2,farN:3,amt:78,farK:1.75};
  var rng=M.rngFrom((seed||1)*7919+13), out=[], i, a, r;
  function push(a,r,amt){
    out.push({x:Math.cos(a)*r, z:Math.sin(a)*r, amt:amt, max:amt,
              rot:rng()*Math.PI*2});
  }
  // Inside piles sit just past the plateau, where a worker is safe and the walk
  // is short. Outside piles are spread across the open ground between the town
  // and the nests: worth more, and worth an escort.
  for(i=0;i<(st.nearN|0);i++){
    a=(i+rng())*(Math.PI*2/Math.max(1,st.nearN|0));
    r=6.4+rng()*4.0;
    push(a,r,Math.round(st.amt*(0.85+rng()*0.3)));
  }
  for(i=0;i<(st.farN|0);i++){
    a=(i+rng())*(Math.PI*2/Math.max(1,st.farN|0));
    r=16.0+Math.pow(rng(),0.8)*22.0;
    push(a,r,Math.round(st.amt*st.farK*(0.85+rng()*0.3)));
  }
  return out;
}
function salvageLeft(){
  var n=0;
  for(var i=0;i<S.nodes.length;i++) n+=Math.max(0,S.nodes[i].amt);
  return Math.round(n);
}
// Daylight is the build phase. dayP is derived from what is left of it, so the
// sun visibly crosses the sky as your window closes.
function stepDay(dt){
  if(S.phase!=="build") return;
  S.dayLeft=Math.max(0,S.dayLeft-dt);
  S.dayP=0.44*(1-S.dayLeft/Math.max(1,S.dayLen));
  if(S.dayLeft<=0) nightfall();
}

// ---- defenders ------------------------------------------------------------
// A unit belongs to the building that mustered it and remembers a post: the
// spot it returns to when nothing is in reach. Right-clicking moves the post,
// which is why an order sticks instead of being undone by the next idle tick.
var UIDC=0;
function spawnCommander(p){
  var U=UNITS.commander;
  var a=-Math.PI/2, u={
    t:"commander", home:null,
    x:p.cx, z:p.cz+1.2, px:p.cx, pz:p.cz+1.2,
    hp:U.hp, max:U.hp, rot:a, rot0:a, cd:0, hit:0, sel:false,
    sc:U.scBase, target:null, own:p.id,
    uid:(++UIDC), job:null, carry:0, mode:"idle",
    ph:Math.random()*6.283, atk:-1, atkT:0.75
  };
  S.units.push(u);
  p.cmd=u;
  return u;
}
// The commander is alive as long as it is standing in the unit list.
function cmdOf(p){
  if(p.cmd&&p.cmd.hp>0&&S.units.indexOf(p.cmd)>=0) return p.cmd;
  p.cmd=null;
  return null;
}
// Out of the front, clear of the footprint. A hall is three cells across, so
// the old fixed radius put its workers inside the building.
function doorOf(b,spread){
  var bx=M.gx2w(b.gx), bz=M.gx2w(b.gz);
  var face=bRot(b)+Math.PI/2;             // the side the door is on
  var a=face+(Math.random()-0.5)*(spread===undefined?1.5:spread);
  var r=standOff(b)+0.25+Math.random()*0.35;
  return [bx+Math.cos(a)*r, bz+Math.sin(a)*r, a];
}
function muster(b){
  var kind=TYPES[b.type].spawns, U=UNITS[kind];
  if(!U) return null;
  var d=doorOf(b), a=d[2], r=0;
  var u={
    t:kind, home:b,
    x:d[0], z:d[1],
    px:d[0], pz:d[1],                           // post
    hp:U.hp, max:U.hp, rot:a, rot0:a, cd:Math.random()*0.5, hit:0, sel:false,
    sc:U.scBase+Math.random()*U.scVar, target:null, own:(b.own||0),
    uid:(++UIDC), job:null, carry:0, mode:"idle", shelter:false, inside:false,
    ph:Math.random()*6.283, atk:-1, atkT:0.75
  };
  S.units.push(u);
  b.garrison.push(u);
  return u;
}
function musterAll(b){
  var cap=TYPES[b.type].cap|0;
  for(var i=b.garrison.length;i<cap;i++) muster(b);
}
function disband(b){
  if(!b.garrison) return;
  for(var i=0;i<b.garrison.length;i++){
    var u=b.garrison[i], k=S.units.indexOf(u);
    if(k>=0) S.units.splice(k,1);
  }
  b.garrison.length=0;
}
// The materials become the building. Everything that makes a building a
// building — its garrison, its aura, its guns — starts here and not a moment
// before, so a site is never a functioning structure wearing a different mesh.
function finishBuild(b){
  b.site=false; b.prog=b.need||0; b.hp=b.max;
  if(TYPES[b.type].spawns && !b.garrison){
    b.garrison=[]; b.trainCd=0; musterAll(b);
  }
  var fx=M.gx2w(b.gx), fz=M.gx2w(b.gz);
  spark(fx,gy(fx,fz)+0.9,fz,8,[1.05,0.90,0.58],0.9,2.2,0.45,0.9);
  if(SND) SND.built(fx,fz);
  S.distDirty=true; S.netCellsDirty=true;
  if(UI.hotbar) UI.hotbar();
  if(UI.units) UI.units();
}
// An unfinished hall knocked down is a setback, not a loss: the ground clears
// and the commander can start again somewhere else, if there is day left.
function collapseSite(p){
  var b=p.site;
  if(!b) return;
  var bx=M.gx2w(b.gx), bz=M.gx2w(b.gz);
  spark(bx,PLAT+0.9,bz,10,[0.85,0.70,0.48],1.1,3.0,0.55,1.0);
  footCells(b.type,b.gx,b.gz).forEach(function(c){ delete S.cells[key(c[0],c[1])]; });
  p.site=null; p.placed=false;
  S.distDirty=true; S.netCellsDirty=true;
  if(UI.hotbar) UI.hotbar();
  if(UI.phase) UI.phase();
}
// The moment the hall stands: full strength, and the first two people walk out
// of it. Everything else you can build is gated behind this.
function finishHall(p,b){
  b.site=false; b.prog=b.need; b.hp=b.max;
  p.site=null; p.hall=b;
  b.garrison=[]; b.trainCd=0;
  musterAll(b);
  var hx=M.gx2w(b.gx), hz=M.gx2w(b.gz);
  spark(hx,PLAT+1.6,hz,14,[1.15,0.98,0.62],1.2,3.2,0.55,1.1);
  if(SND) SND.built(hx,hz);
  S.distDirty=true; S.netCellsDirty=true;
  if(UI.hotbar) UI.hotbar();
  if(UI.phase) UI.phase();
}
// ---- shelter ---------------------------------------------------------------
// Workers can be put inside the building that houses them. Inside they are not
// drawn, not targetable and not doing anything — the whole point is that the
// horde cannot reach them. It costs you the night's gathering and mending, so
// it is a real choice rather than a free save.
function homeOf(u){
  var p=S.players[u.own||0];
  var h=u.home;
  if(h && rootOf(S.cells[key(h.gx,h.gz)])===h && !h.site) return h;
  return (p&&p.hall)||null;                 // burnt-out house: fall back to the hall
}
function shelteredCount(pid){
  var n=0;
  for(var i=0;i<S.units.length;i++)
    if(S.units[i].inside&&(S.units[i].own|0)===(pid|0)) n++;
  return n;
}
// The hall speaks for the whole settlement; any other house speaks for its own.
function housedBy(b){
  var out=[], i;
  if(b.type==="hall"){
    for(i=0;i<S.units.length;i++){
      var u=S.units[i];
      if((u.own|0)!==(b.own|0)||!UNITS[u.t].civil) continue;
      out.push(u);
    }
    return out;
  }
  if(!b.garrison) return out;
  for(i=0;i<b.garrison.length;i++)
    if(UNITS[b.garrison[i].t].civil) out.push(b.garrison[i]);
  return out;
}
function sheltering(b){
  var list=housedBy(b);
  if(!list.length) return false;
  for(var i=0;i<list.length;i++) if(!list[i].shelter) return false;
  return true;                              // only "sheltered" when every one is
}
function setShelter(b,on,net){
  if(!b) return 0;
  if(guest()&&!net) return intent({m:"sh",gx:b.gx,gz:b.gz,on:on?1:0});
  var list=housedBy(b), n=0;
  for(var i=0;i<list.length;i++){
    var u=list[i];
    if(!!u.shelter===!!on) continue;
    u.shelter=!!on;
    if(on){ u.job=null; u.fix=null; u.fixOrder=false; u.mode="toHome"; }
    else {
      if(u.inside) popOut(u);
      u.mode="idle";
    }
    n++;
  }
  if(n&&SND) SND.order();
  if(UI.units) UI.units();
  return n;
}
function popOut(u){
  var h=homeOf(u);
  u.inside=false;
  if(h){
    var d=doorOf(h,2.2);
    u.x=d[0]; u.z=d[1]; u.rot=d[2];
  }
  u.px=u.x; u.pz=u.z;
}
// Ordered out by hand: they leave the door and walk to the spot you clicked.
function sendOut(b,x,z,net){
  if(!b) return 0;
  if(guest()&&!net) return intent({m:"og",gx:b.gx,gz:b.gz,x:r2(x),z:r2(z)});
  var list=housedBy(b);
  if(!list.length) return 0;
  for(var i=0;i<list.length;i++){
    var u=list[i];
    u.shelter=false;
    if(u.inside) popOut(u);
  }
  orderTo(list,x,z,true);
  return list.length;
}
// A house that comes down turns its people out into whatever is outside it.
function evict(b){
  for(var i=0;i<S.units.length;i++){
    var u=S.units[i];
    if(!u.inside||homeOf(u)!==b) continue;
    u.inside=false; u.shelter=false; u.mode="idle";
    var a=Math.random()*Math.PI*2, r=1.3;
    u.x=M.gx2w(b.gx)+Math.cos(a)*r; u.z=M.gx2w(b.gz)+Math.sin(a)*r;
    u.px=u.x; u.pz=u.z;
  }
}

function builtInCat(cat){
  var n=0;
  for(var k in S.cells){
    var c=S.cells[k];
    if(!c.ref && TYPES[c.type] && TYPES[c.type].cat===cat) n++;
  }
  return n;
}
function selectedUnits(){
  var out=[];
  for(var i=0;i<S.units.length;i++) if(S.units[i].sel) out.push(S.units[i]);
  return out;
}
function clearSelection(){
  for(var i=0;i<S.units.length;i++) S.units[i].sel=false;
  if(UI.units) UI.units();
}
// Formation offsets so a group ordered to one point spreads instead of stacking.
function orderTo(list,x,z,net){
  if(!list.length) return;
  if(guest()&&!net) intent({m:"or",u:uids(list),x:r2(x),z:r2(z)});
  var cols=Math.ceil(Math.sqrt(list.length)), gap=1.05;
  for(var i=0;i<list.length;i++){
    var cx=(i%cols)-(cols-1)/2, cz=Math.floor(i/cols)-(Math.ceil(list.length/cols)-1)/2;
    list[i].px=x+cx*gap; list[i].pz=z+cz*gap;
    list[i].target=null;
    if(UNITS[list[i].t].civil){
      list[i].job=null; list[i].fix=null; list[i].fixOrder=false; list[i].mode="idle";
    }
  }
  S.markers.push({x:x,z:z,life:0.9,max:0.9});
  if(S.markers.length>12) S.markers.shift();
  if(SND) SND.order();
}

// Right-clicking a pile assigns; the loop is walk out, fill up, walk the load
// back to the hall, repeat until the pile is empty or you say otherwise.
function assignJob(list,node,net){
  if(guest()&&!net) intent({m:"jb",u:uids(list),n:S.nodes.indexOf(node)});
  var n=0;
  for(var i=0;i<list.length;i++){
    var u=list[i];
    if(!UNITS[u.t].civil) continue;
    u.job=node; u.mode="toNode"; n++;
  }
  if(n){
    S.markers.push({x:node.x,z:node.z,life:0.9,max:0.9});
    if(S.markers.length>12) S.markers.shift();
    if(SND) SND.order();
  }
  return n;
}
function nodeAtWorld(x,z,rad){
  var best=null, bd=rad;
  for(var i=0;i<S.nodes.length;i++){
    var nd=S.nodes[i];
    if(nd.amt<=0) continue;
    var d=Math.hypot(nd.x-x,nd.z-z);
    if(d<bd){ bd=d; best=nd; }
  }
  return best;
}
function updateWorker(u,U,dt){
  var op=S.players[u.own||0];
  // sheltering outranks every other errand
  if(u.shelter){
    if(u.inside) return;
    var h=homeOf(u);
    if(!h){ u.shelter=false; }
    else {
      u.carry=0; u.job=null; u.fix=null; u.mode="toHome";
      var hx=M.gx2w(h.gx), hz=M.gx2w(h.gz);
      if(stepToBuilding(u,U,h)){
        u.inside=true;
        spark(hx,PLAT+0.5,hz,3,[1.05,0.95,0.68],0.7,1.4,0.26,0.45);
        if(UI.units) UI.units();
      }
      return;
    }
  }
  // once the horde is out there nothing is worth carrying, but plenty is worth
  // mending — the night stops being something you only watch
  if(S.phase!=="build"){
    u.job=null; u.carry=0;
    updateMender(u,U,dt,op);
    return;
  }
  if(u.fix){ u.fix=null; u.fixOrder=false; }
  if(!u.job || u.job.amt<=0){
    u.job=null; u.mode="idle";
    stepToward(u,U,u.px,u.pz,0.18);
    return;
  }
  var U2=U;
  if(u.mode==="toNode"||u.mode==="idle"){
    if(stepToward(u,U2,u.job.x,u.job.z,1.15)) u.mode="gather";
    return;
  }
  if(u.job) u.job.worked=true;
  if(u.mode==="gather"){
    if(u.atk<0) u.atk=0;
    var take=Math.min(U2.gather*dt, U2.carry-u.carry, u.job.amt);
    u.carry+=take; u.job.amt-=take;
    u.rot=Math.atan2(u.job.z-u.z,u.job.x-u.x);
    if(Math.random()<dt*2.2)
      spark(u.job.x,PLAT+0.5,u.job.z,1,[1.1,0.95,0.62],0.9,1.5,0.35,0.5);
    if(u.carry>=U2.carry-1e-6 || u.job.amt<=0) u.mode="toHall";
    return;
  }
  if(u.mode==="toHall"){
    if(!op||!op.hall){ u.mode="idle"; return; }
    if(stepToBuilding(u,U2,op.hall)){
      op.supply+=Math.round(u.carry);
      S.gathered+=Math.round(u.carry);
      u.carry=0; u.mode="toNode";
      if(SND) SND.deposit(u.x,u.z);
      if(UI.hotbar) UI.hotbar();
    }
    return;
  }
}
// ---- mending ---------------------------------------------------------------
// A worker will walk to a hurt building and put health back into it. Left to
// themselves they only mend what is quiet, because a worker caught at the wall
// dies to the first thing that reaches it; told to go by name, they go anyway.
// A footprint is a square, so "next to it" is the distance to the box, not to
// the centre. A radius has no answer that works: big enough to clear the
// corners and it is unreachable the moment another building is packed against
// the side — which is exactly what stalled every worker's deposit run when a
// cottage went up beside the hall.
function boxDist(x,z,b){
  var half=((TYPES[b.type].foot||1)*CELL)/2;
  var dx=Math.max(0,Math.abs(x-M.gx2w(b.gx))-half);
  var dz=Math.max(0,Math.abs(z-M.gx2w(b.gz))-half);
  return Math.hypot(dx,dz);
}
var TOUCH=0.95;
// Walk at a building until you are standing against it. Collision keeps the
// unit out of the walls, so aiming straight at the middle is safe.
function stepToBuilding(u,U,b,margin){
  margin=(margin===undefined)?TOUCH:margin;
  if(boxDist(u.x,u.z,b)<=margin) return true;
  var bx=M.gx2w(b.gx), bz=M.gx2w(b.gz);
  var dx=bx-u.x, dz=bz-u.z, L=Math.hypot(dx,dz)||1;
  var sp=U.speed*dt_;
  moveUnit(u,u.x+dx/L*sp,u.z+dz/L*sp);
  u.rot=Math.atan2(dz,dx);
  return false;
}
function standOff(b){ return ((TYPES[b.type].foot||1)*CELL)/2+TOUCH; }
function repairable(b,p){
  return b && !b.ref && !b.site && b.hp<b.max && (b.own|0)===(p.id|0);
}
function pickRepair(u,p){
  if(!p) return null;
  var best=null, bd=1e9;
  for(var k in S.cells){
    var b=S.cells[k];
    if(!repairable(b,p)) continue;
    var d=Math.hypot(M.gx2w(b.gx)-u.x,M.gx2w(b.gz)-u.z);
    if(d<bd){ bd=d; best=b; }
  }
  return best;
}
function updateMender(u,U,dt,op){
  // Nerve is about the worker, not the wall: they will happily mend a wall
  // something is hammering on the far side, and they run the moment it gets
  // round to their side of it.
  if(U.nerve>0 && nearestEnemy(u.x,u.z,U.nerve)){
    u.fix=null; u.fixOrder=false; u.mode="flee";
    if(op&&op.hall){
      var fx=M.gx2w(op.hall.gx), fz=M.gx2w(op.hall.gz);
      u.px=fx+Math.cos(u.rot0)*3.1; u.pz=fz+Math.sin(u.rot0)*3.1;
    }
    stepToward(u,U,u.px,u.pz,0.18);
    return;
  }
  var b=u.fix;
  // the target has to still be there, still be theirs, and still be hurt
  if(b && (rootOf(S.cells[key(b.gx,b.gz)])!==b || !repairable(b,op))) b=u.fix=null;
  if(!b){ u.fixOrder=false; b=u.fix=pickRepair(u,op); }
  if(!b){                                   // nothing to mend: shelter by the hall
    u.mode="flee";
    if(op&&op.hall){
      var hx0=M.gx2w(op.hall.gx), hz0=M.gx2w(op.hall.gz);
      u.px=hx0+Math.cos(u.rot0)*3.1; u.pz=hz0+Math.sin(u.rot0)*3.1;
    }
    stepToward(u,U,u.px,u.pz,0.18);
    return;
  }
  var bx=M.gx2w(b.gx), bz=M.gx2w(b.gz);
  if(!stepToBuilding(u,U,b)){ u.mode="toFix"; return; }
  u.mode="fixing";
  u.rot=Math.atan2(bz-u.z,bx-u.x);
  if(u.atk<0) u.atk=0;                    // the same loop the commander uses
  b.hp=Math.min(b.max, b.hp+(U.repair||16)*dt);
  if(Math.random()<dt*3.4)
    spark(bx+(Math.random()-0.5)*1.4, PLAT+0.75, bz+(Math.random()-0.5)*1.4,
          1, [1.15,1.02,0.68], 0.8, 1.6, 0.30, 0.5);
  if(b.hp>=b.max){ u.fix=null; u.fixOrder=false; }
}
// Told by name: the safety check is off, because the player looked at the same
// screen and decided the wall was worth a worker.
function assignRepair(list,b,net){
  if(guest()&&!net) return intent({m:"fx",u:uids(list),gx:b.gx,gz:b.gz});
  var n=0;
  for(var i=0;i<list.length;i++){
    var u=list[i];
    if(!UNITS[u.t].civil) continue;
    u.fix=b; u.fixOrder=true; u.job=null; u.mode="toFix"; n++;
  }
  if(n){
    S.markers.push({x:M.gx2w(b.gx),z:M.gx2w(b.gz),life:0.9,max:0.9});
    if(S.markers.length>12) S.markers.shift();
    if(SND) SND.order();
  }
  return n;
}

function gaitStep(u,x0,z0){
  var r=RIG[UNITS[u.t].asset];
  if(!r) return;
  u.ph+=Math.hypot(u.x-x0,u.z-z0)*r.gait.cad;
}
// ---- getting round things --------------------------------------------------
// Units used to walk straight through walls. They now slide along whatever they
// hit, and if a wall is dead ahead they follow it — each unit picks a side once
// and keeps it, so a group does not oscillate. This is not pathfinding: a
// sealed perimeter with no gate will hold your own people out too, which is
// what a sealed perimeter is for.
function solidAt(x,z){
  var c=cellAt(M.w2gx(x),M.w2gx(z));
  if(!c) return false;
  var b=rootOf(c);
  return b.type!=="gate";                 // a gate is yours to walk through
}
var TURNS=[0.60,1.05,1.57,2.10];
function moveUnit(u,nx,nz){
  if(!solidAt(nx,nz)){ u.x=nx; u.z=nz; return true; }
  if(solidAt(u.x,u.z)){ u.x=nx; u.z=nz; return true; }   // already stuck: let it out
  var dx=nx-u.x, dz=nz-u.z, L=Math.hypot(dx,dz);
  if(L<1e-6) return false;
  // An axis slide only counts if it actually carries you somewhere. A step
  // almost square-on to a wall slides by a hair and reports progress, and the
  // unit spends the rest of the day creeping along the face by a millimetre a
  // frame — which is exactly how every worker stalled beside a cottage.
  var MIN=L*0.35;
  if(Math.abs(dx)>MIN && !solidAt(nx,u.z)){ u.x=nx; return true; }
  if(Math.abs(dz)>MIN && !solidAt(u.x,nz)){ u.z=nz; return true; }
  // Dead ahead. Turn the step aside a bit at a time and take the first opening,
  // preferring whichever way this unit went last. Committing to that side is
  // what stops it flip-flopping on the spot — an earlier version alternated
  // every frame and workers simply never arrived.
  if(u.side===undefined) u.side=(Math.random()<0.5?-1:1);
  // Once a unit starts going round something it keeps going the same way for a
  // moment. Re-deciding every frame let it pick left, then right, then left,
  // and it rocked on the spot in front of a cottage forever instead of walking
  // round it. The timer is the whole fix.
  var sticky=(u.avoid||0)>0;
  for(var i=0;i<TURNS.length;i++){
    for(var q=0;q<(sticky?1:2);q++){
      var ang=(q?-u.side:u.side)*TURNS[i];
      var c=Math.cos(ang), sn=Math.sin(ang);
      var tx=u.x+(dx*c-dz*sn), tz=u.z+(dx*sn+dz*c);
      if(!solidAt(tx,tz)){
        u.x=tx; u.z=tz;
        if(q) u.side=-u.side;                            // that way works: keep it
        u.avoid=1.1;
        return true;
      }
    }
  }
  if(sticky) u.avoid=0;              // that side is a dead end: free to swap
  return false;
}
// returns true once it is standing close enough
// The epsilon matters: without it a worker converges on the stop distance and
// creeps toward it by ever-smaller floats, never arriving.
function stepToward(u,U,tx,tz,stop){
  var dx=tx-u.x, dz=tz-u.z, L=Math.hypot(dx,dz);
  if(L<=stop+0.02) return true;
  var sp=U.speed*dt_, k=Math.min(sp,L-stop);
  moveUnit(u, u.x+dx/L*k, u.z+dz/L*k);
  u.rot=Math.atan2(dz,dx);
  return false;
}
var dt_=1/60;

function nearestEnemy(x,z,rad){
  var best=null, bd=rad;
  for(var i=0;i<S.enemies.length;i++){
    var e=S.enemies[i];
    if(e.hp<=0) continue;
    var d=Math.hypot(e.x-x,e.z-z);
    if(d<bd){ bd=d; best=e; }
  }
  return best;
}
// A nest is shaped like a target — x, z, hp, hit — so every existing damage
// path works on it unchanged. It just never moves and is bigger to reach.
function nearestNest(x,z,rad){
  var best=null, bd=rad;
  for(var i=0;i<S.nests.length;i++){
    var nn=S.nests[i];
    if(nn.dead) continue;
    var d=Math.hypot(nn.x-x,nn.z-z)-1.6;      // its bulk, so they stop at the rim
    if(d<bd){ bd=d; best=nn; }
  }
  return best;
}
function updateUnits(dt){
  for(var ni=0;ni<S.nodes.length;ni++) S.nodes[ni].worked=false;
  for(var i=S.units.length-1;i>=0;i--){
    var u=S.units[i], U=UNITS[u.t];
    u.hit=Math.max(0,u.hit-dt*4);
    if(u.hp<=0){
      dropGib(u.x,u.z,u.rot,u.sc,U.gib);
      if(u.home&&u.home.garrison){
        var g=u.home.garrison.indexOf(u);
        if(g>=0) u.home.garrison.splice(g,1);
      }
      if(SND) SND.unitDown(u.x,u.z);
      S.units.splice(i,1);
      if(UI.units) UI.units();
      continue;
    }
    u.cd-=dt;
    // The gait is driven by ground covered, not by time, so it stays in step
    // whatever the framerate — and a swing runs its own short clock.
    var gx0=u.x, gz0=u.z;
    if(u.avoid>0) u.avoid=Math.max(0,u.avoid-dt);
    if(u.atk>=0){ u.atk+=dt; if(u.atk>=u.atkT) u.atk=-1; }
    if(U.civil){ dt_=dt; updateWorker(u,U,dt); gaitStep(u,gx0,gz0); continue; }

    // Raising the hall comes before everything else the commander could be
    // doing — except defending itself, because standing still and hammering
    // while something eats you is not a decision anyone would make.
    if(u.t==="commander"){
      var op2=S.players[u.own||0], site=op2&&op2.site;
      if(site&&!nearestEnemy(u.x,u.z,U.reach+0.9)){
        var sx=M.gx2w(site.gx), sz=M.gx2w(site.gz);
        var sdx=sx-u.x, sdz=sz-u.z;
        dt_=dt;
        if(!stepToBuilding(u,U,site,TOUCH+0.25)){
          /* still walking */
        } else {
          u.rot=Math.atan2(sdz,sdx);
          var work=(U.build||1)*dt;
          site.prog+=work;
          site.hp=Math.min(site.max, site.hp+site.max*work/site.need);
          if(Math.random()<dt*4.0)
            spark(sx+(Math.random()-0.5)*2.6, PLAT+0.9, sz+(Math.random()-0.5)*2.6,
                  1, [1.20,1.00,0.62], 0.85, 1.7, 0.34, 0.55);
          if(u.atk<0) u.atk=0;        // keep the hammer swinging while it works
          if(site.prog>=site.need) finishHall(op2,site);
        }
        u.px=u.x; u.pz=u.z;             // the post follows, so it stays put after
        gaitStep(u,gx0,gz0);
        continue;
      }
    }

    // acquire: hold stays near the post, pursue reaches a full leash further
    var lead = (stanceOf(u.own)==="hold") ? Math.min(U.leash,2.4) : U.leash;
    var scan = U.melee ? (U.reach+lead) : U.range;
    var tgt = (u.target&&u.target.hp>0) ? u.target : nearestEnemy(u.px,u.pz,scan+0.6);
    if(!tgt) tgt=nearestNest(u.px,u.pz,scan+2.6);   // march them out and they bite
    if(tgt && Math.hypot(tgt.x-u.px,tgt.z-u.pz) > scan+(tgt.nest?3.4:1.4)) tgt=null;
    u.target=tgt;

    var mx=u.px, mz=u.pz, engaging=false;
    if(tgt){
      var d=Math.hypot(tgt.x-u.x,tgt.z-u.z);
      var strike = U.melee ? U.reach : U.range;
      if(d<=strike){
        engaging=true;
        u.rot=Math.atan2(tgt.z-u.z,tgt.x-u.x);
        if(u.cd<=0){
          u.cd = (U.melee ? U.swing : U.fire) * rallyOf(u);
          u.atkT=Math.max(0.22,Math.min(0.95,u.cd*0.82));
          u.atk=0;                        // and the animation runs off it
          if(U.melee){
            hurtTarget(tgt,U.dmg,u.own|0);
            spark((u.x+tgt.x)/2,PLAT+0.55,(u.z+tgt.z)/2,3,[1.9,1.9,1.6],1.0,2.2,0.20,0.6);
            if(SND) SND.swing(u.x,u.z);
          } else {
            S.bolts.push({x:u.x,y:gy(u.x,u.z)+0.95,z:u.z,t:tgt,dmg:U.dmg,rot:0,
                          spd:34, sc:1, splash:0, splashK:0, friendly:true,
                          own:u.own|0});
            if(SND) SND.loose(u.x,u.z);
          }
        }
      } else if(d<=strike+lead){
        mx=tgt.x; mz=tgt.z; engaging=true;   // close the gap, but only within leash
      }
    }

    var dx=mx-u.x, dz=mz-u.z, L=Math.hypot(dx,dz);
    var stop = engaging ? (U.melee?U.reach*0.85:U.range*0.9) : 0.16;
    if(L>stop){
      var sp=U.speed*dt, k=Math.min(sp,L);
      moveUnit(u, u.x+dx/L*k, u.z+dz/L*k);
      if(!tgt) u.rot=Math.atan2(dz,dx);
    }
    gaitStep(u,gx0,gz0);
  }

  // materials become buildings. The hall is not in here: it waits on the
  // commander's hands rather than on the clock.
  for(var sk in S.cells){
    var sb=S.cells[sk];
    if(sb.ref||!sb.site||sb.type==="hall") continue;
    sb.prog+=dt;
    if(sb.prog>=sb.need) finishBuild(sb);
  }

  // barracks retrain their losses, but only while they are standing
  for(var k in S.cells){
    var b=S.cells[k];
    if(b.ref||b.site||!b.garrison) continue;
    var cap=TYPES[b.type].cap|0;
    if(b.garrison.length>=cap){ b.trainCd=0; continue; }
    // the clock starts when the loss happens, so a replacement always costs the
    // full retrain time rather than arriving on the same frame
    if(b.trainCd<=0) b.trainCd=TYPES[b.type].retrain;
    b.trainCd-=dt;
    if(b.trainCd<=0){
      b.trainCd=0;
      muster(b);
      if(SND) SND.muster(M.gx2w(b.gx),M.gx2w(b.gz));
      if(UI.units) UI.units();
    }
  }

  for(var m=S.markers.length-1;m>=0;m--){
    S.markers[m].life-=dt;
    if(S.markers[m].life<=0) S.markers.splice(m,1);
  }
}
function dropGib(x,z,rot,sc,col){
  S.corpses.push({x:x,z:z,rot:rot-Math.PI/2,sc:sc,life:8.5,max:8.5});
  if(S.corpses.length>MAX_CORPSES) S.corpses.shift();
  spark(x,gy(x,z)+0.55*sc,z,7,col,1.1,3.2,0.5,0.85*sc);
}

// ---- flow field -----------------------------------------------------------
function rebuildField(){
  var N=GN, dist=new Float64Array(N*N); dist.fill(1e9);
  var halls=[];
  for(var pq=0;pq<S.players.length;pq++)
    if(S.players[pq].hall) halls.push(S.players[pq].hall);
  if(!halls.length){ S.dist=dist; S.distDirty=false; return; }
  var heap=[], hn=0;
  function push(i,d){
    heap[hn]={i:i,d:d}; var c=hn++;
    while(c>0){ var p=(c-1)>>1; if(heap[p].d<=heap[c].d) break;
      var t=heap[p];heap[p]=heap[c];heap[c]=t;c=p; }
  }
  function pop(){
    var top=heap[0]; heap[0]=heap[--hn]; heap.length=hn;
    var c=0;
    for(;;){ var l=c*2+1,r=l+1,s=c;
      if(l<hn&&heap[l].d<heap[s].d)s=l;
      if(r<hn&&heap[r].d<heap[s].d)s=r;
      if(s===c)break; var t=heap[s];heap[s]=heap[c];heap[c]=t;c=s; }
    return top;
  }
  // seeded from every standing hall at once, so the field naturally sends each
  // attacker to the nearer settlement
  halls.forEach(function(H){
    footCells("hall",H.gx,H.gz).forEach(function(c){
      if(c[0]<0||c[1]<0||c[0]>=N||c[1]>=N) return;
      var i=c[1]*N+c[0]; dist[i]=0; push(i,0);
    });
  });
  var DX=[1,-1,0,0,1,1,-1,-1], DZ=[0,0,1,-1,1,-1,1,-1];
  while(hn>0){
    var t0=pop(), i0=t0.i;
    if(t0.d>dist[i0]) continue;
    var x=i0%N, z=(i0-x)/N;
    for(var k=0;k<8;k++){
      var nx=x+DX[k], nz=z+DZ[k];
      if(nx<0||nz<0||nx>=N||nz>=N) continue;
      var c2=cellAt(nx,nz), extra=c2?TYPES[rootOf(c2).type].pathCost:0;
      var nd=t0.d+(k<4?1:1.414)+extra, ni=nz*N+nx;
      if(nd<dist[ni]-1e-9){ dist[ni]=nd; push(ni,nd); }
    }
  }
  S.dist=dist; S.distDirty=false;
  applyAuras();
}
// A brazier speeds up every turret in its circle. Recomputed whenever the
// layout changes rather than per shot, so firing stays a subtraction.
function applyAuras(){
  var braz=[], k;
  for(k in S.cells){ var c=S.cells[k];
    if(!c.ref&&!c.site&&c.type==="brazier") braz.push(c); }
  for(k in S.cells){
    var t=S.cells[k];
    if(t.ref||!TYPES[t.type].range) continue;
    var x=M.gx2w(t.gx), z=M.gx2w(t.gz), n=0;
    for(var i=0;i<braz.length;i++)
      if(Math.hypot(M.gx2w(braz[i].gx)-x,M.gx2w(braz[i].gz)-z)<=TYPES.brazier.aura) n++;
    t.lit=n;
    t.fireMul=Math.pow(TYPES.brazier.auraK,Math.min(2,n));
  }
}
function bestStep(gx,gz){
  var N=GN, best=null, bd=1e9;
  var DX=[1,-1,0,0,1,1,-1,-1], DZ=[0,0,1,-1,1,-1,1,-1];
  for(var k=0;k<8;k++){
    var nx=gx+DX[k], nz=gz+DZ[k];
    if(nx<0||nz<0||nx>=N||nz>=N) continue;
    var d=S.dist[nz*N+nx];
    if(d<bd){ bd=d; best=[nx,nz]; }
  }
  return best;
}

// ---- wave -----------------------------------------------------------------
// ---- day/night clock ------------------------------------------------------
// One number on the renderer's 0..2 axis. Build phase is a slow afternoon;
// pressing Ready drops the light into night over a few seconds; holding the
// hall brings the dawn up. The clock runs in every phase, so the dusk and
// dawn transitions still play while nothing else is simulating.
var DAY_DUSK=0.140, DAY_NIGHT=0.0016, DAY_DAWN=0.100;
// During the attack the sky is driven by the night clock rather than eased
// toward a target, so the light itself tells you how much is left: dusk over
// the first few seconds, deepest around the middle, and grey in the sky before
// the timer runs out.
function nightSky(){
  var t=1-Math.max(0,Math.min(1,S.nightLeft/Math.max(1,S.nightLen)));
  if(t<0.06) return 0.44+(1.02-0.44)*(t/0.06);       // dusk falls fast
  if(t<0.80) return 1.02+0.30*((t-0.06)/0.74);       // the long dark
  return 1.32+0.26*((t-0.80)/0.20);                  // first grey of morning
}
function stepClock(dt){
  if(S.phase==="build"){ stepDay(dt); return; }
  if(S.phase==="attack"){ S.dayP=nightSky(); return; }
  if(S.dayP===S.dayTo) return;
  var d=S.dayTo-S.dayP, step=S.daySpd*dt;
  S.dayP = (Math.abs(d)<=step) ? S.dayTo : S.dayP+(d>0?step:-step);
}

// Runners lead, brutes trail, and the jitter keeps it from reading as a parade.
var ORDER={runner:0, shambler:0.55, brute:1.15};
function buildQueue(total,mix){
  var q=[],k;
  for(k in mix){
    var n=Math.round(total*mix[k]);
    for(var i=0;i<n;i++) q.push(k);
  }
  while(q.length<total) q.push("shambler");
  q.length=total;
  q.sort(function(a,b){ return (ORDER[a]+Math.random()*0.9)-(ORDER[b]+Math.random()*0.9); });
  return q;
}
// The clock does not wait for you. Whoever has not got a hall standing when
// the light goes has lost the round on the only thing that mattered.
function nightfall(){
  for(var i=0;i<S.players.length;i++){
    var P=S.players[i];
    if(P.out||P.hall) continue;
    eliminate(i);
  }
  if(!livePlayers().length){ if(S.phase==="build") endRound(false); return; }
  startWave();
}
// Only nightfall calls this. There is no way to bring the night on early —
// the day is the day, and what you have built when it ends is what you have.
function startWave(){
  if(!livePlayers().some(function(p){ return !!p.hall; })||S.phase!=="build") return;
  S.wave=waveSize();
  S.phase="attack"; S.spawnLeft=S.wave; S.spawnTimer=1.2; S.waveClock=0;
  // The nests empty out. A guard is only a guard by daylight; once the horde is
  // moving it goes with them, which is why clearing a garrison in the afternoon
  // is worth doing even though they come back.
  for(var gq=0;gq<S.enemies.length;gq++){ S.enemies[gq].guard=false; S.enemies[gq].home=null; }
  S.dayLeft=0;
  S.nightLeft=S.nightLen;
  for(var wi=0;wi<S.units.length;wi++){
    var wu=S.units[wi];
    if(UNITS[wu.t].civil){ wu.job=null; wu.carry=0; wu.mode="flee"; }
  }
  S.queue=buildQueue(S.wave,conf().mix);
  for(var bk in S.cells){                       // top every garrison up before the wave
    var bb=S.cells[bk];
    if(!bb.ref&&bb.garrison) musterAll(bb);
  }
  S.dayTo=1.02; S.daySpd=DAY_DUSK; S.dayP=nightSky();
  if(SND) SND.waveStart();
  rebuildField();
  if(UI.phase) UI.phase();
  if(UI.hotbar) UI.hotbar();
}
// Chips off whatever was struck. Same pool as sparks but its own batch, so
// masonry reads as tumbling shards rather than embers.
function debris(m,bx,bz,rad,n){
  var dx=m.x-bx, dz=m.z-bz, L=Math.hypot(dx,dz)||1;
  for(var i=0;i<n;i++){
    if(S.parts.length>=MAX_PARTS) return;
    var sp=1.6+Math.random()*2.2, sy=1.7+Math.random()*2.0;
    var jx=(Math.random()-0.5)*1.5, jz=(Math.random()-0.5)*1.5;
    S.parts.push({x:bx+dx/L*rad, y:gy(bx,bz)+0.45+Math.random()*0.7, z:bz+dz/L*rad,
      gnd:gy(bx,bz),
      vx:(dx/L+jx)*sp, vy:sy, vz:(dz/L+jz)*sp,
      life:0.55+Math.random()*0.35, max:0.9,
      r:0.55,g:0.53,b:0.48, sc:0.5+Math.random()*0.5, chip:1});
  }
}

// Attacks are swings, not a damage faucet. Damage per swing is the old rate
// times the swing period, so average DPS — and every balance number tuned
// against it — is unchanged; it just arrives in readable chunks you can see.
var ATK_T={shambler:0.85, runner:0.62, brute:1.25};
function swingTick(m,dt){
  var per=ATK_T[m.t]||0.85;
  m.atkT=per;
  if(m.atk<0){ m.atk=0; m.swung=false; }
  m.atk+=dt;
  if(!m.swung && m.atk>=per*0.58){ m.swung=true; return per; }
  if(m.atk>=per){ m.atk=0; m.swung=false; }
  return 0;
}
// The visible half of a connecting blow: a burst where the blow lands, chips
// off what was struck, and a shove back on the thing that swung.
function strikeFx(m,tx,ty,tz,heavy){
  var dx=tx-m.x, dz=tz-m.z, L=Math.hypot(dx,dz)||1;
  var hx=m.x+dx*0.62, hz=m.z+dz*0.62;
  spark(hx,ty,hz, heavy?9:5, [0.92,0.80,0.58], 0.85, heavy?3.2:2.1, 0.34, heavy?0.85:0.55);
  // recoil from your own blow is render-only. Moving the attacker here pushed
  // it out of its own reach, so it bounced back and forth instead of fighting.
  m.rec=heavy?0.20:0.12;
  if(heavy) S.shake=Math.min(0.18,S.shake+0.05);
}

// Every blow that lands on an attacker or a nest goes through here. (Note the
// name: hurt() is the colour ramp for a damaged building, and `strike` is a
// local inside updateUnits — both were tried and both collided.) A nest
// keeps a ledger of who hurt it, because its cache is paid to whoever did the
// work, and it wakes defenders when something starts hitting it.
function hurtTarget(tgt,amt,pid){
  tgt.hp-=amt; tgt.hit=1;
  if(!tgt.nest||tgt.dead) return;
  if(pid!==undefined&&pid!==null) tgt.dmg[pid]=(tgt.dmg[pid]||0)+amt;
  callDefenders(tgt);
}
// A nest under attack empties out. The cooldown is what stops a stream of
// arrows from summoning an endless queue.
function callDefenders(n){
  if(n.dead||n.callCd>0) return;
  var cnt=NEST.callN===undefined?4:NEST.callN;
  if(cnt<=0) return;
  n.callCd=NEST.callGap||5;
  for(var i=0;i<cnt;i++) spawnGuard(n);
  if(SND) SND.waveStart();
}
// The nearest living defender to a point — what a nest guard reaches for.
function nearestUnit(x,z,r){
  var best=null, bd=r;
  for(var i=0;i<S.units.length;i++){
    var u=S.units[i];
    if(u.hp<=0||u.inside) continue;
    var d=Math.hypot(u.x-x,u.z-z);
    if(d<bd){ bd=d; best=u; }
  }
  return best;
}
function liveNests(){
  var out=[];
  for(var i=0;i<S.nests.length;i++) if(!S.nests[i].dead) out.push(S.nests[i]);
  return out;
}
function pickNest(){
  var live=liveNests();
  if(!live.length) return null;
  var tot=0, i;
  for(i=0;i<live.length;i++) tot+=Math.max(0.001,live[i].share);
  var r=Math.random()*tot;
  for(i=0;i<live.length;i++){ r-=Math.max(0.001,live[i].share); if(r<=0) return live[i]; }
  return live[live.length-1];
}
// A guard is an ordinary attacker that belongs to a nest: it lives there by
// day, chases what comes near, and goes home when the chase runs long. At
// nightfall it stops being a guard and joins the wave like everything else.
function spawnGuard(nest){
  if(!nest||nest.dead) return null;
  var m=makeAttacker(nest,"shambler");
  if(!m) return null;
  m.home=nest; m.guard=true;
  nest.guards++;
  return m;
}
// What the nests will send tonight: each living one contributes its share,
// ramping with the night. Kill a nest and its share is gone for good — that is
// the payoff for marching out, and the reason the total accelerates only while
// you leave them alone.
function nestSend(night){
  var ramp=(NEST.ramp===undefined?1.28:NEST.ramp);
  return Math.max(1,Math.round((S.send||104)*Math.pow(ramp,Math.max(0,(night||1)-1))));
}
function waveSize(){ return liveNests().length*nestSend(S.night); }
// A nest starts with a few of them loitering and fills up as the nights go on,
// so an early assault is a raid and a late one is a siege.
function guardWant(){
  var base=(NEST.guard===undefined?3:NEST.guard);
  var step=(NEST.guardStep===undefined?2:NEST.guardStep);
  var cap=(NEST.guardMax===undefined?16:NEST.guardMax);
  return Math.max(0,Math.min(cap,Math.round(base+step*Math.max(0,S.night-1))));
}
function garrisonNests(){
  var want=guardWant();
  liveNests().forEach(function(n){
    n.guards=0;
    for(var i=0;i<S.enemies.length;i++) if(S.enemies[i].home===n) n.guards++;
    while(n.guards<want && spawnGuard(n)) {}
  });
}
function spawnOne(){
  var nest=pickNest();
  if(!nest) return;                       // every nest down: nothing left to send
  makeAttacker(nest, S.queue.length?S.queue.shift():"shambler");
}
// One attacker, out of one nest. Everything that puts a body on the field goes
// through here, so a guard and a wave attacker differ only in what is set on
// them afterwards.
function makeAttacker(nest,kind){
  if(!nest||nest.dead) return null;
  var a=Math.random()*Math.PI*2, r=1.1+Math.random()*1.6;
  var tk=kind||"shambler", E=ENEMY[tk], hp=S.ehp*E.hpK;
  var m={t:tk,x:nest.x+Math.cos(a)*r,z:nest.z+Math.sin(a)*r,hp:hp,max:hp,
    spd:E.speed, dmgB:E.dmgBuild, dmgH:E.dmgHall, reach:E.reach,
    rot:Math.atan2(-nest.z,-nest.x),ox:(Math.random()-0.5)*0.85,oz:(Math.random()-0.5)*0.85,
    sc:E.scBase+Math.random()*E.scVar,hit:0, dx:0, dz:0,
    ph:Math.random()*Math.PI*2,      // gait phase, so a crowd never marches in step
    atk:-1, atkT:0, swung:false,     // attack timer; -1 means not fighting
    stag:0, kx:0, kz:0,              // flinch, and knockback carried by the body
    rec:0,                           // recoil from its own swing — drawn, not simulated
    rise:0};                         // spawn-in: 0 underground, 1 fully up
  S.enemies.push(m);
  return m;
}

// ---- effects --------------------------------------------------------------
// One particle pool behind every burst in the game. Sparks arc, bounce once off
// the ground and fade; the instanced spark mesh means a few hundred cost nothing.
function spark(x,y,z,n,col,spread,speed,life,sc){
  var gnd=gy(x,z);
  for(var i=0;i<n;i++){
    if(S.parts.length>=MAX_PARTS) return;
    var a=Math.random()*Math.PI*2, e=(0.15+Math.random()*spread);
    var sp=speed*(0.45+Math.random()*0.85);
    S.parts.push({x:x,y:y,z:z,gnd:gnd,
      vx:Math.cos(a)*Math.cos(e)*sp, vy:Math.sin(e)*sp, vz:Math.sin(a)*Math.cos(e)*sp,
      life:life*(0.65+Math.random()*0.7), max:life,
      r:col[0],g:col[1],b:col[2], sc:sc*(0.7+Math.random()*0.7)});
  }
}
function dropCorpse(m){
  // thrown along the killing blow, tumbling for the first half second before it
  // settles — an instant swap to a flat corpse is what made deaths read as a pop
  var d=Math.hypot(m.dx||0,m.dz||0);
  var tk=(m.t==="brute"?1.5:3.2)/Math.max(0.6,ENEMY[m.t].hpK||1);
  S.corpses.push({x:m.x,z:m.z,rot:m.rot-Math.PI/2,sc:m.sc,life:8.5,max:8.5,
    vx:d?(m.dx*tk):0, vz:d?(m.dz*tk):0, y:gy(m.x,m.z)+0.35*m.sc, gnd:gy(m.x,m.z),
    vy:1.5+Math.random()*1.1,
    spin:(Math.random()<0.5?-1:1)*(2.4+Math.random()*2.6), tum:0, down:false});
  if(S.corpses.length>MAX_CORPSES) S.corpses.shift();
}
function damageBuilding(b,amt){
  b.hp-=amt;
  if(b.hp<=0){
    S.netCellsDirty=true;
    if(b.type==="hall"){
      var ob=S.players[b.own||0];
      if(b.site){ if(ob) collapseSite(ob); return; }   // an unfinished hall collapses
      if(ob) ob.hall=null;
      eliminate(b.own||0); return;
    }
    evict(b);
    if(S.bsel===b) S.bsel=null;
    footCells(b.type,b.gx,b.gz).forEach(function(c){ delete S.cells[key(c[0],c[1])]; });
    S.distDirty=true; S.netCellsDirty=true;
  }
}

// Local-only motion on the guest: particles fall, corpses settle, gaits keep
// walking, and every entity eases toward the last position the host sent.
function guestStep(dt){
  S.flash=Math.max(0,S.flash-dt*2.2);
  S.shake=Math.max(0,S.shake-dt*0.55);
  var i,k=1-Math.exp(-dt*16);
  for(i=0;i<S.enemies.length;i++){
    var m=S.enemies[i];
    m.hit=Math.max(0,m.hit-dt*4);
    m.stag=Math.max(0,m.stag-dt*3.4);
    m.rec=Math.max(0,(m.rec||0)-dt*0.9);
    if(m.rise<1) m.rise=Math.min(1,m.rise+dt*1.5);
    if(m.tx!==undefined){ m.x+=(m.tx-m.x)*k; m.z+=(m.tz-m.z)*k; }
    if(m.atk<0) m.ph+=dt*m.spd*(RIG[ENEMY[m.t].asset]?RIG[ENEMY[m.t].asset].gait.cad:2.4);
    else m.atk+=dt;
  }
  for(i=0;i<S.units.length;i++){
    var u=S.units[i];
    u.hit=Math.max(0,u.hit-dt*4);
    var ux0=u.x, uz0=u.z;
    if(u.tx!==undefined){ u.x+=(u.tx-u.x)*k; u.z+=(u.tz-u.z)*k; }
    if(u.atk>=0){ u.atk+=dt; if(u.atk>=(u.atkT||0.75)) u.atk=-1; }
    gaitStep(u,ux0,uz0);          // the gait rides on the eased motion
  }
  for(i=0;i<S.nests.length;i++){
    S.nests[i].hit=Math.max(0,S.nests[i].hit-dt*4);
    S.nests[i].pulse+=dt*1.3;
  }
  for(i=S.parts.length-1;i>=0;i--){
    var pa=S.parts[i];
    pa.life-=dt;
    if(pa.life<=0){ S.parts.splice(i,1); continue; }
    pa.vy-=15*dt;
    pa.x+=pa.vx*dt; pa.y+=pa.vy*dt; pa.z+=pa.vz*dt;
    var pg=(pa.gnd===undefined?PLAT:pa.gnd)+0.06;
    if(pa.y<pg){ pa.y=pg; pa.vy*=-0.34; pa.vx*=0.62; pa.vz*=0.62; }
  }
  for(i=S.corpses.length-1;i>=0;i--){
    var co=S.corpses[i];
    co.life-=dt;
    if(co.life<=0){ S.corpses.splice(i,1); continue; }
    if(!co.down){
      co.vy-=16*dt;
      co.x+=co.vx*dt; co.z+=co.vz*dt; co.y+=co.vy*dt; co.tum+=co.spin*dt;
      var fr=Math.exp(-dt*3.0); co.vx*=fr; co.vz*=fr;
      var cg=(co.gnd===undefined?PLAT:co.gnd)+0.02;
      if(co.y<=cg){ co.y=cg; co.down=true; co.tum=0; }
    }
  }
  for(i=S.bolts.length-1;i>=0;i--){
    var bo=S.bolts[i];
    bo.life=(bo.life===undefined?0.25:bo.life-dt);
    if(bo.life<=0) S.bolts.splice(i,1);
  }
  if(S.dayLeft>0&&S.phase==="build") S.dayLeft=Math.max(0,S.dayLeft-dt);
  if(R.setTime) R.setTime(S.dayP);
  R.setLamps(packLamps());
}

// Everything that fights: the horde, the guns, and what they throw. Split out
// of update() so it can run in the build phase as well, where the only bodies
// on the field are the nests' own.
function stepCombat(dt){
  if(S.distDirty) rebuildField();

  for(var e=S.enemies.length-1;e>=0;e--){
    var m=S.enemies[e];
    m.hit=Math.max(0,m.hit-dt*4);
    m.stag=Math.max(0,m.stag-dt*3.4);
    m.rec=Math.max(0,(m.rec||0)-dt*0.9);
    if(m.rise<1){ m.rise=Math.min(1,m.rise+dt*1.5); }
    // knockback is applied to the body and bleeds off fast — a shove, not a slide
    if(m.kx||m.kz){
      m.x+=m.kx*dt; m.z+=m.kz*dt;
      var kd=Math.exp(-dt*7.0);
      m.kx*=kd; m.kz*=kd;
      if(Math.abs(m.kx)<0.01&&Math.abs(m.kz)<0.01){ m.kx=0; m.kz=0; }
    }
    if(m.hp<=0){
      var EK=ENEMY[m.t]||ENEMY.shambler;
      dropCorpse(m);
      spark(m.x,gy(m.x,m.z)+0.55*m.sc,m.z, m.t==="brute"?11:6, EK.gib, 1.1, 3.4, 0.55, 0.9*m.sc);
      if(m.t==="brute") S.shake=Math.min(0.20,S.shake+0.09);
      if(SND) SND.death(m.t,m.x,m.z);
      S.enemies.splice(e,1); S.kills++; continue;
    }
    var gx=M.w2gx(m.x), gz=M.w2gx(m.z);
    if(gx<0||gz<0||gx>=GN||gz>=GN){ m.x*=0.98; m.z*=0.98; continue; }
    // a defender in the way is fought, not walked around — that is what makes a
    // line of soldiers a wall you can move
    var blockU=null, bud=m.reach+0.55;
    for(var ui=0;ui<S.units.length;ui++){
      var fu=S.units[ui];
      if(fu.hp<=0||fu.inside) continue;
      var fd=Math.hypot(fu.x-m.x,fu.z-m.z);
      if(fd<bud){ bud=fd; blockU=fu; }
    }
    if(blockU){
      m.rot=Math.atan2(blockU.z-m.z,blockU.x-m.x);
      var per=swingTick(m,dt);
      if(per>0){
        blockU.hp-=m.dmgB*per; blockU.hit=1;
        var bd=Math.hypot(blockU.x-m.x,blockU.z-m.z)||1;
        blockU.x+=(blockU.x-m.x)/bd*0.10; blockU.z+=(blockU.z-m.z)/bd*0.10;
        strikeFx(m,blockU.x,PLAT+0.62,blockU.z,m.t==="brute");
        if(SND) SND.swing(m.x,m.z);
      }
      continue;
    }
    // whichever town hall it has reached
    var hitHall=null, hhx=0, hhz=0;
    for(var hp2=0;hp2<S.players.length;hp2++){
      var HH=S.players[hp2].hall;
      if(!HH) continue;
      var ax=M.gx2w(HH.gx), az2=M.gx2w(HH.gz);
      if(Math.hypot(m.x-ax,m.z-az2)<2.35+m.reach){ hitHall=HH; hhx=ax; hhz=az2; break; }
    }
    if(hitHall){
      m.rot=Math.atan2(hhz-m.z,hhx-m.x);
      var perH=swingTick(m,dt);
      if(perH>0){
        var mine=(hitHall.own||0)===S.me;
        damageBuilding(hitHall,m.dmgH*perH);
        if(mine){
          S.flash=Math.min(0.10,S.flash+0.05);
          S.shake=Math.min(0.16,S.shake+0.045);
        }
        debris(m,hhx,hhz,2.35,m.t==="brute"?7:4);
        strikeFx(m,hhx,PLAT+0.85,hhz,m.t==="brute");
        if(SND&&mine) SND.hallHit(hhx,hhz);
        // that blow may have ended the round — but this step also runs by day,
        // so the test is "is it over", not "is it night"
        if(S.phase==="won"||S.phase==="lost") return;
      }
      continue;
    }
    // A guard belongs to its nest. It holds there, chases what comes close, and
    // turns back once the chase runs past its leash — otherwise a single archer
    // could walk a whole garrison across the map. At nightfall the flag comes
    // off and it joins the wave like everything else.
    if(m.guard){
      if(!m.home||m.home.dead){ m.guard=false; m.home=null; }
      else {
        var leash=NEST.leash||9;
        var hx3=m.home.x, hz3=m.home.z;
        var prey=nearestUnit(m.x,m.z,leash);
        var tgx=hx3, tgz=hz3, hold=1.6+Math.random()*0.2;
        if(prey && Math.hypot(prey.x-hx3,prey.z-hz3)<=leash){
          tgx=prey.x; tgz=prey.z; hold=m.reach*0.85;
        }
        var gdx=tgx-m.x, gdz=tgz-m.z, gL=Math.hypot(gdx,gdz)||1;
        if(gL>hold){
          var gw=m.spd*(m.stag>0?0.45:1)*m.rise;
          m.x+=gdx/gL*gw*dt; m.z+=gdz/gL*gw*dt;
          m.rot=Math.atan2(gdz,gdx);
          m.atk=-1; m.swung=false;
          m.ph+=dt*gw*(RIG[ENEMY[m.t].asset]?RIG[ENEMY[m.t].asset].gait.cad:2.4);
        }
        continue;
      }
    }
    var step=bestStep(gx,gz); if(!step) continue;
    var blocker=rootOf(cellAt(step[0],step[1]));
    var tx=M.gx2w(step[0]), tz=M.gx2w(step[1]);
    if(blocker){
      var bx=M.gx2w(blocker.gx), bz=M.gx2w(blocker.gz);
      if(Math.hypot(m.x-bx,m.z-bz)<(TYPES[blocker.type].foot*CELL)/2+m.reach){
        m.rot=Math.atan2(bz-m.z,bx-m.x);
        var perB=swingTick(m,dt);
        if(perB>0){
          damageBuilding(blocker,m.dmgB*perB);
          debris(m,bx,bz,(TYPES[blocker.type].foot*CELL)/2,m.t==="brute"?6:3);
          strikeFx(m,bx,PLAT+0.6,bz,m.t==="brute");
          if(SND) SND.chew(bx,bz);
          if(S.phase==="won"||S.phase==="lost") return;
        }
        continue;
      }
    }
    var dx=(tx+m.ox)-m.x, dz=(tz+m.oz)-m.z, L=Math.hypot(dx,dz)||1;
    var walk=m.spd*(m.stag>0?0.45:1)*m.rise;   // a flinch and a spawn both slow it
    m.x+=dx/L*walk*dt; m.z+=dz/L*walk*dt;
    m.rot=Math.atan2(dz,dx);
    m.atk=-1; m.swung=false;
    m.ph+=dt*walk*(RIG[ENEMY[m.t].asset]?RIG[ENEMY[m.t].asset].gait.cad:2.4);
  }

  for(var k2 in S.cells){
    var c=S.cells[k2];
    if(c.ref) continue;
    var tyr=TYPES[c.type];
    if(!tyr.range||c.site) continue;         // a pile of timber does not shoot
    c.cd-=dt;
    if(c.cd>0) continue;
    var tx2=M.gx2w(c.gx), tz2=M.gx2w(c.gz), best=null, bd=tyr.range;
    // A ballista is wasted on a straggler: it prefers the heaviest thing in reach.
    var wantHeavy=!!tyr.splash, bestW=-1;
    for(var q=0;q<S.enemies.length;q++){
      var en=S.enemies[q];
      if(en.hp<=0) continue;
      var d=Math.hypot(en.x-tx2,en.z-tz2);
      if(d>=tyr.range) continue;
      if(wantHeavy){
        var w=en.max-d*0.4;
        if(w>bestW){ bestW=w; best=en; }
      } else if(d<bd){ bd=d; best=en; }
    }
    if(!best){ c.cd=0.12; continue; }
    c.cd=tyr.fire*(c.fireMul||1);
    var muzY=PLAT+(c.type==="ballista"?2.6:3.0);
    S.bolts.push({x:tx2,y:muzY,z:tz2,t:best,dmg:tyr.dmg,rot:0,
                  spd:tyr.boltSpeed||BOLT_SPEED, sc:tyr.boltScale||1,
                  splash:tyr.splash||0, splashK:(tyr.splashK===undefined?0.7:tyr.splashK),
                  own:c.own|0});
    spark(tx2,muzY,tz2, wantHeavy?4:2, [2.5,1.7,0.7], 0.7, wantHeavy?2.6:1.8, 0.16, 0.7);
    if(SND) SND.shot(c.type,tx2,tz2);
  }

  for(var b2=S.bolts.length-1;b2>=0;b2--){
    var bo=S.bolts[b2];
    if(!bo.t||bo.t.hp<=0){ S.bolts.splice(b2,1); continue; }
    var sp2=bo.spd||BOLT_SPEED;
    var vx=bo.t.x-bo.x, vy=(PLAT+0.55)-bo.y, vz=bo.t.z-bo.z, L2=Math.hypot(vx,vy,vz);
    bo.rot=Math.atan2(vz,vx)+Math.PI/2;
    if(L2<sp2*dt){
      var hx2=bo.t.x, hz2=bo.t.z;
      hurtTarget(bo.t,bo.dmg,bo.own);
      // A nest is a legal target and is not an attacker: it has no type in the
      // enemy table and it never moves, so it takes the damage and none of the
      // flinch. Reading its hit points off ENEMY was a crash waiting for the
      // first archer to come within range of one.
      var EB=ENEMY[bo.t.t];
      if(EB){
        // flinch away from the shot, harder on light attackers than on a brute
        var kk2=(bo.splash?3.4:1.7)/Math.max(0.5,EB.hpK||1);
        var bl=Math.hypot(vx,vz)||1;
        bo.t.kx+=vx/bl*kk2; bo.t.kz+=vz/bl*kk2;
        bo.t.stag=Math.min(1,bo.t.stag+(bo.splash?0.9:0.5));
        bo.t.dx=vx/bl; bo.t.dz=vz/bl;            // remembered for the death throw
      }
      if(bo.splash){
        for(var si=0;si<S.enemies.length;si++){
          var se=S.enemies[si];
          if(se===bo.t||se.hp<=0) continue;
          var sd=Math.hypot(se.x-hx2,se.z-hz2);
          if(sd<bo.splash){
            hurtTarget(se,bo.dmg*bo.splashK*(1-sd/bo.splash),bo.own);
            var sl=Math.max(0.3,sd), fk=(1-sd/bo.splash)*4.2;
            se.kx+=(se.x-hx2)/sl*fk; se.kz+=(se.z-hz2)/sl*fk;
            se.stag=Math.min(1,se.stag+0.7);
            se.dx=(se.x-hx2)/sl; se.dz=(se.z-hz2)/sl;
          }
        }
        spark(hx2,PLAT+0.5,hz2,9,[2.4,1.35,0.5],1.2,4.2,0.42,1.15);
        S.shake=Math.min(0.18,S.shake+0.05);
      } else spark(hx2,PLAT+0.6,hz2,3,
                   bo.friendly?[1.1,2.2,2.3]:[2.3,1.5,0.6],1.0,2.4,0.22,0.65);
      if(SND) SND.impact(!!bo.splash,hx2,hz2);
      S.bolts.splice(b2,1); continue;
    }
    bo.x+=vx/L2*sp2*dt; bo.y+=vy/L2*sp2*dt; bo.z+=vz/L2*sp2*dt;
  }
}

function update(dt){
  if(!active||!S) return;
  stepPan(dt);
  // The guest owns nothing: the host decides every position and hit point, and
  // this side only advances the cosmetic parts so the picture stays smooth
  // between snapshots.
  if(S.net==="guest"){ guestStep(dt); return; }
  stepClock(dt);
  // effects and defenders run in the build phase too, so you can walk your line
  // into position before pressing Ready
  S.flash=Math.max(0,S.flash-dt*2.2);
  S.shake=Math.max(0,S.shake-dt*0.55);
  // A hall can reach zero by any route, so elimination is decided from state
  // rather than hooked onto one damage call.
  if(S.phase==="attack"||S.phase==="build"){
    for(var pe=0;pe<S.players.length;pe++){
      var PE=S.players[pe];
      if(PE.out) continue;
      // Once the hall stands it is the objective, as it always was. Before
      // that there is no hall to lose, so the commander carries the round.
      if(PE.site&&PE.site.hp<=0) collapseSite(PE);
      if(PE.hall){ if(PE.hall.hp<=0) eliminate(pe); continue; }
      if(PE.placed&&!PE.site){ eliminate(pe); continue; }
      if(!cmdOf(PE)) eliminate(pe);
    }
  }
  for(var nq=0;nq<S.nests.length;nq++){
    var nz=S.nests[nq];
    nz.hit=Math.max(0,nz.hit-dt*4);
    nz.pulse+=dt*1.3;
    nz.kx=0; nz.kz=0;                       // targetable, but it never moves
    nz.callCd=Math.max(0,nz.callCd-dt);
    if(!nz.dead&&nz.hp<=0){
      nz.dead=true;
      spark(nz.x,gy(nz.x,nz.z)+1.2,nz.z,22,[0.72,0.20,0.16],1.3,5.2,0.9,1.7);
      S.shake=Math.min(0.30,S.shake+0.22);
      // The cache goes to whoever did the most damage bringing it down. In a
      // two-player round that is the answer to "who actually took it".
      var top=null, best=0;
      for(var dk in nz.dmg){ if(nz.dmg[dk]>best){ best=nz.dmg[dk]; top=+dk; } }
      var pay=NEST.cache===undefined?320:NEST.cache;
      if(top!==null&&S.players[top]&&!S.players[top].out&&pay>0){
        S.players[top].supply+=pay;
        if(UI.phase) UI.phase();
        if(UI.hotbar) UI.hotbar();
      }
      // its garrison dies with it — a nest is the only thing holding them here
      for(var gi=S.enemies.length-1;gi>=0;gi--){
        var ge=S.enemies[gi];
        if(ge.home!==nz) continue;
        spark(ge.x,gy(ge.x,ge.z)+0.6,ge.z,4,[1.3,0.9,0.5],1.0,2.4,0.35,0.8);
        dropGib(ge.x,ge.z,ge.rot,ge.sc,ENEMY[ge.t].gib);
        S.enemies.splice(gi,1);
      }
      if(SND){ SND.death("brute",nz.x,nz.z); SND.impact(true,nz.x,nz.z); }
      if(UI.phase) UI.phase();
      // the last nest is the round: nothing is left to send anything
      if(!liveNests().length){ endRound(true); return; }
    }
  }
  for(var pi=S.parts.length-1;pi>=0;pi--){
    var pa=S.parts[pi];
    pa.life-=dt;
    if(pa.life<=0){ S.parts.splice(pi,1); continue; }
    pa.vy-=15*dt;
    pa.x+=pa.vx*dt; pa.y+=pa.vy*dt; pa.z+=pa.vz*dt;
    var pg=(pa.gnd===undefined?PLAT:pa.gnd)+0.06;
    if(pa.y<pg){ pa.y=pg; pa.vy*=-0.34; pa.vx*=0.62; pa.vz*=0.62; }
  }
  for(var ci=S.corpses.length-1;ci>=0;ci--){
    var co=S.corpses[ci];
    co.life-=dt;
    if(co.life<=0){ S.corpses.splice(ci,1); continue; }
    if(!co.down){
      co.vy-=16*dt;
      co.x+=co.vx*dt; co.z+=co.vz*dt; co.y+=co.vy*dt;
      co.tum+=co.spin*dt;
      var fr=Math.exp(-dt*3.0); co.vx*=fr; co.vz*=fr;
      if(co.y<=PLAT+0.02){                  // landed: stop tumbling, lie flat
        co.y=PLAT+0.02; co.down=true; co.tum=0;
      }
    }
  }
  updateUnits(dt);
  // Attackers, turrets and bolts run in the build phase too. They have to: the
  // nests keep a standing guard by day, so marching a line out to one is a real
  // fight and the towers behind you are part of it.
  if(S.phase!=="build"&&S.phase!=="attack") return;
  if(S.phase!=="attack"){ stepCombat(dt); return; }
  S.waveClock+=dt;

  S.nightLeft=Math.max(0,S.nightLeft-dt);
  if(S.spawnLeft>0){
    // pull every nest down and the rest of the wave never comes — that is the
    // whole payoff for marching a line out instead of turtling
    if(!liveNests().length){
      S.spawnLeft=0;
      if(UI.phase) UI.phase();
    } else {
      // The wave is paced to arrive across the first four-fifths of the night,
      // so the last of them still has time to reach you. Falling behind that
      // schedule shortens the gap rather than dumping the remainder at dawn.
      S.spawnTimer-=dt;
      if(S.spawnTimer<=0){
        var burst=Math.min(S.spawnLeft,2+Math.floor(Math.random()*3));
        for(var i=0;i<burst;i++){ spawnOne(); S.spawnLeft--; }
        var runway=Math.max(2,S.nightLeft-S.nightLen*0.20);
        var due=runway/Math.max(1,S.spawnLeft/3.2);
        S.spawnTimer=Math.max(0.16,Math.min(2.4,due))*(0.75+Math.random()*0.5);
      }
    }
  }
  stepCombat(dt);
  if(S.phase!=="attack") return;

  // Dawn is not the win condition any more — it is the next day. Surviving a
  // night buys you another one, and the round only ends when every hall is gone
  // or every nest is.
  if(S.nightLeft<=0){ dawn(); return; }
  if(S.spawnLeft===0&&S.enemies.length===0) dawn();
}

// The light burns off whatever is still standing in the open, the nests knit
// back together, and the next night is bigger than the one you just held.
function dawn(){
  S.dawnBurn=S.enemies.length+S.spawnLeft;
  for(var i=S.enemies.length-1;i>=0;i--){
    var de=S.enemies[i];
    spark(de.x,gy(de.x,de.z)+0.7,de.z,5,[1.5,1.15,0.62],1.0,2.6,0.4,0.9);
    dropGib(de.x,de.z,de.rot,de.sc,ENEMY[de.t].gib);
  }
  S.enemies.length=0; S.spawnLeft=0; S.queue.length=0;
  if(!liveNests().length){ endRound(true); return; }   // nothing left to send
  if(!livePlayers().length){ endRound(false); return; }

  S.lastBurn=S.dawnBurn; S.lastHeld=S.night;
  S.night++;
  // The wave is not carried forward and grown — it is recomputed from what is
  // still out there. Attacker health creeps up alongside it.
  S.wave=waveSize();
  S.ehp=S.ehp*(NEST.ehpK||1.05);
  // A nest you only wounded is a nest you did not kill.
  var regen=(NEST.regen===undefined?0.5:NEST.regen);
  liveNests().forEach(function(n){ n.hp=Math.min(n.max,n.hp+n.max*regen); });

  S.phase="build";
  S.dayLeft=S.dayLen;
  S.nightLeft=S.nightLen;
  S.dayTo=0.44; S.daySpd=DAY_DAWN;
  for(var wi=0;wi<S.units.length;wi++){       // everyone back to work
    var wu=S.units[wi];
    if(UNITS[wu.t].civil&&wu.mode==="flee") wu.mode="idle";
  }
  garrisonNests();
  if(SND) SND.dawn();
  if(UI.phase) UI.phase();
  if(UI.hotbar) UI.hotbar();
  if(UI.units) UI.units();
}

// A player whose town hall falls is out. Everything they built goes with it,
// which clears the map for whoever is left and makes the loss unmistakable.
// The round only ends when nobody is standing.
function eliminate(pid){
  var p=S.players[pid];
  if(!p||p.out) return;
  p.out=true;
  p.hall=null;
  for(var k in S.cells){
    var c=S.cells[k];
    if(c.ref||((c.own||0)!==pid)) continue;
    var bx=M.gx2w(c.gx), bz=M.gx2w(c.gz);
    spark(bx,PLAT+0.9,bz,7,[0.85,0.62,0.42],1.1,3.4,0.6,1.0);
    if(c.garrison) disband(c);
    footCells(c.type,c.gx,c.gz).forEach(function(cc){ delete S.cells[key(cc[0],cc[1])]; });
  }
  for(var u=S.units.length-1;u>=0;u--){
    if((S.units[u].own||0)!==pid) continue;
    dropGib(S.units[u].x,S.units[u].z,S.units[u].rot,S.units[u].sc,UNITS[S.units[u].t].gib);
    S.units.splice(u,1);
  }
  S.distDirty=true;
  S.flash=Math.min(0.16,S.flash+0.12);
  S.shake=Math.min(0.30,S.shake+0.22);
  if(SND) SND.lose();
  if(UI.phase) UI.phase();
  if(UI.units) UI.units();
  if(!livePlayers().length) endRound(false);
}

function endRound(won){
  S.phase=won?"won":"lost";
  if(won){ S.dayTo=2.00; S.daySpd=DAY_DAWN; }   // the sun comes up on a standing hall
  else   { S.dayTo=1.42; S.daySpd=DAY_NIGHT; }
  S.enemies.length=0; S.bolts.length=0; S.parts.length=0; S.shake=0;
  S.markers.length=0;
  clearSelection();
  if(SND) (won?SND.win():SND.lose());
  if(UI.phase) UI.phase();
  if(onEnd) onEnd({
    won:won, kills:S.kills, wave:S.wave, dawn:(S.dawnBurn|0),
    nights:Math.max(0,S.night-(won?0:1)), nests:liveNests().length,
    hallPct: me().hall?Math.round(100*me().hall.hp/TYPES.hall.hp):0,
    seconds:Math.round(S.waveClock),
    difficulty:(SET&&SET.difficulty)||"normal"
  });
}

// ---- camera + picking -----------------------------------------------------
var cam={az:38, el:36, zoom:17, tx:0, tz:0};
function camera(steady){
  var a=cam.az*Math.PI/180, e=cam.el*Math.PI/180;
  var sz=R.size(), aspect=(sz[0]||16)/(sz[1]||9);
  var dir=[Math.cos(e)*Math.cos(a),Math.sin(e),Math.cos(e)*Math.sin(a)];
  // Shake moves the look-at point, not the projection, so the isometric
  // framing survives it. Picking always asks for the steady camera.
  var sk=(!steady&&S&&S.shake)?S.shake:0;
  var target=[(cam.tx||0)+(Math.random()-0.5)*sk, PLAT+(Math.random()-0.5)*sk*0.6,
              (cam.tz||0)+(Math.random()-0.5)*sk];
  var eye=[target[0]+dir[0]*100,target[1]+dir[1]*100,target[2]+dir[2]*100];
  var f=M.nz([-dir[0],-dir[1],-dir[2]]);
  var r=M.nz(M.crs(f,[0,1,0])), u=M.crs(r,f);
  return {
    vp:M.mul(M.ortho(-cam.zoom*aspect,cam.zoom*aspect,-cam.zoom,cam.zoom,1,260),
             M.lookAt(eye,target,[0,1,0])),
    eye:eye, f:f, r:r, u:u, target:target, aspect:aspect
  };
}
// Standard slab test. Returns how far along the ray the box is first entered,
// or null if the ray misses it.
function rayBox(O,D,lo,hi){
  var tmin=-1e9, tmax=1e9;
  for(var i=0;i<3;i++){
    if(Math.abs(D[i])<1e-9){ if(O[i]<lo[i]||O[i]>hi[i]) return null; continue; }
    var t1=(lo[i]-O[i])/D[i], t2=(hi[i]-O[i])/D[i];
    if(t1>t2){ var sw=t1; t1=t2; t2=sw; }
    if(t1>tmin) tmin=t1;
    if(t2<tmax) tmax=t2;
    if(tmin>tmax) return null;
  }
  return tmax<0 ? null : Math.max(tmin,0);
}
// A building is a solid box, not a hole in the ground. Testing only the ground
// plane meant clicking a tower's roof picked whatever tile was behind it — from
// this camera angle that is several cells away, and it selected the wrong thing
// every time.
function pick(cx,cy){
  var C=camera(true), rect=canvas.getBoundingClientRect();
  var nx=((cx-rect.left)/rect.width)*2-1, ny=1-((cy-rect.top)/rect.height)*2;
  var hw=cam.zoom*C.aspect, hh=cam.zoom;
  var O=[C.target[0]+C.r[0]*nx*hw+C.u[0]*ny*hh,
         C.target[1]+C.r[1]*nx*hw+C.u[1]*ny*hh,
         C.target[2]+C.r[2]*nx*hw+C.u[2]*ny*hh];
  if(Math.abs(C.f[1])<1e-6) return null;
  // O sits on the plane through the camera target, so half the scene is behind
  // it and its distances come out negative — which made every comparison
  // against the ground hit meaningless. Push the origin back past everything
  // first and every t is a real, comparable distance.
  var back=260;
  O[0]-=C.f[0]*back; O[1]-=C.f[1]*back; O[2]-=C.f[2]*back;
  var t=(PLAT-O[1])/C.f[1];
  var best=t, hitB=null;
  for(var k in S.cells){
    var c=S.cells[k];
    if(c.ref) continue;
    var half=((TYPES[c.type].foot||1)*CELL)/2;
    var bx=M.gx2w(c.gx), bz=M.gx2w(c.gz);
    var top=PLAT+(BAR_Y[c.type]||2.4)*0.86;
    var th=rayBox(O,C.f,[bx-half,PLAT,bz-half],[bx+half,top,bz+half]);
    if(th!==null&&th<best){ best=th; hitB=c; }
  }
  if(hitB) return {x:M.gx2w(hitB.gx), z:M.gx2w(hitB.gz),
                   gx:hitB.gx, gz:hitB.gz, onBuilding:true};
  var p=[O[0]+C.f[0]*t, PLAT, O[2]+C.f[2]*t];
  return {x:p[0], z:p[2], gx:M.w2gx(p[0]), gz:M.w2gx(p[2])};
}

// ---- instance packing -----------------------------------------------------
// Everything in the world sits on the terrain, not on the platform height.
// The middle of the map is flat so the difference never showed there, but a
// nest is seeded well out where the ground rolls, and drawing it at PLAT left
// it hanging most of a unit above its own shadow.
function gy(x,z){ return (S&&S.T)?S.T.h(x,z):PLAT; }
function put(arr,n,x,y,z,rot,ca,sc,cb){
  var o=n*12;
  arr[o]=x;arr[o+1]=y;arr[o+2]=z;arr[o+3]=rot;
  arr[o+4]=ca[0];arr[o+5]=ca[1];arr[o+6]=ca[2];arr[o+7]=sc;
  arr[o+8]=cb[0];arr[o+9]=cb[1];arr[o+10]=cb[2];arr[o+11]=0;
  return n+1;
}
// Same, with the pitch the renderer reads out of the spare colour-B slot. This
// is what lets a limb swing about its joint rather than slide.
function putP(arr,n,x,y,z,rot,ca,sc,cb,pitch){
  var o=n*12;
  arr[o]=x;arr[o+1]=y;arr[o+2]=z;arr[o+3]=rot;
  arr[o+4]=ca[0];arr[o+5]=ca[1];arr[o+6]=ca[2];arr[o+7]=sc;
  arr[o+8]=cb[0];arr[o+9]=cb[1];arr[o+10]=cb[2];arr[o+11]=pitch||0;
  return n+1;
}
function dim(c,k){ return [c[0]*k,c[1]*k,c[2]*k]; }
// A ghost you cannot place used to just go dark, which reads as "far away" more
// than "no". Blocked ghosts are pushed hard toward the one saturated red the
// palette reserves for threat, so the answer is a colour and not a brightness.
var NO_COL=[0.66,0.13,0.11];
function ghostCol(c,ok){
  if(ok) return dim(c,0.85);
  var k=0.78;                               // how far toward red, not a fade
  return [c[0]*(1-k)+NO_COL[0]*k,
          c[1]*(1-k)+NO_COL[1]*k,
          c[2]*(1-k)+NO_COL[2]*k];
}

// ---- guest intents ---------------------------------------------------------
// One direction only. The guest's clicks become small messages; the host runs
// them through exactly the same functions a local click would, so there is no
// second code path to keep honest.
var netSend=null;
function setNetSend(fn){ netSend=fn; }
function guest(){ return !!(S&&S.net==="guest"); }
function intent(m){ if(netSend) netSend(m); return false; }
function uids(list){ return list.map(function(u){ return u.uid; }); }
function byUid(ids,pid){
  var want={}, out=[], i;
  for(i=0;i<ids.length;i++) want[ids[i]]=1;
  for(i=0;i<S.units.length;i++)
    if(want[S.units[i].uid]&&(S.units[i].own|0)===pid) out.push(S.units[i]);
  return out;
}
// Every message carries the seat it came from, filled in by the transport, so
// a guest can only ever move its own troops and spend its own supply.
function applyIntent(msg,pid){
  if(!S||!msg||!S.players[pid]) return;
  switch(msg.m){
    case "pl": place(msg.t,msg.gx|0,msg.gz|0,pid,msg.r||0); break;
    case "rm": removeAt(msg.gx|0,msg.gz|0,pid); break;
    case "or": orderTo(byUid(msg.u||[],pid),msg.x,msg.z,true); break;
    case "jb":
      var nd=S.nodes[msg.n|0];
      if(nd) assignJob(byUid(msg.u||[],pid),nd,true);
      break;
    case "fx":
      var fb=rootOf(cellAt(msg.gx|0,msg.gz|0));
      if(fb&&(fb.own|0)===pid&&!fb.site) assignRepair(byUid(msg.u||[],pid),fb,true);
      break;
    case "sh":
      var sb=rootOf(cellAt(msg.gx|0,msg.gz|0));
      if(sb&&(sb.own|0)===pid&&!sb.site) setShelter(sb,!!msg.on,true);
      break;
    case "og":
      var ob=rootOf(cellAt(msg.gx|0,msg.gz|0));
      if(ob&&(ob.own|0)===pid&&!ob.site) sendOut(ob,msg.x,msg.z,true);
      break;
    case "st": setStance(msg.v==="pursue"?"pursue":"hold",pid); break;
  }
}

// ---- network snapshots ----------------------------------------------------
// The host owns the simulation outright and ships a picture of it; the guest
// only ever sends intents. Positions are rounded to two decimals because the
// guest eases toward them anyway, and that halves the size of every packet.
var EK_I={shambler:0,runner:1,brute:2}, EK_N=["shambler","runner","brute"];
var UK_I={soldier:0,archer:1,worker:2,commander:3};
var UK_N=["soldier","archer","worker","commander"];
function r2(v){ return Math.round(v*100)/100; }

function snapshot(full){
  if(!S) return null;
  var i, out={
    ph:S.phase, dp:r2(S.dayP), dl:r2(S.dayLeft), sl:S.spawnLeft, kl:S.kills,
    nl:r2(S.nightLeft), ng:S.night|0, wv:S.wave|0,
    pl:S.players.map(function(p){
      return [p.supply|0, p.out?1:0, p.hall?Math.round(p.hall.hp):0, p.placed?1:0,
              p.stance==="pursue"?1:0, p.site?r2(p.site.prog):-1];
    }),
    ne:S.nests.map(function(n){ return [Math.round(n.hp), n.dead?1:0]; }),
    nd:S.nodes.map(function(n){ return Math.round(n.amt); }),
    en:[], un:[]
  };
  for(i=0;i<S.enemies.length;i++){
    var m=S.enemies[i];
    out.en.push([EK_I[m.t]|0, r2(m.x), r2(m.z), r2(m.rot), Math.round(m.hp),
                 r2(m.ph), r2(m.atk), r2(m.rise), r2(m.sc), m.hit>0.01?1:0,
                 Math.round(m.max)]);
  }
  for(i=0;i<S.units.length;i++){
    var u=S.units[i];
    out.un.push([u.uid, UK_I[u.t]|0, u.own|0, r2(u.x), r2(u.z), r2(u.rot),
                 Math.round(u.hp), r2(u.sc), u.hit>0.01?1:0, Math.round(u.carry),
                 u.inside?1:0, r2(u.atk), r2(u.atkT||0.75)]);
  }
  // buildings only when they change, since they are the bulk of a packet
  if(full||S.netCellsDirty){
    out.cl=[];
    for(var k in S.cells){
      var c=S.cells[k];
      if(c.ref) continue;
      out.cl.push([c.type, c.gx, c.gz, Math.round(c.hp), c.own|0, r2(bRot(c)),
                   c.site?1:0, c.site?r2(c.prog):0]);
    }
    S.netCellsDirty=false;
  }
  return out;
}

function applySnapshot(sn){
  if(!S||!sn) return;
  var wasPh=S.phase;
  S.phase=sn.ph; S.dayP=sn.dp; S.dayLeft=sn.dl;
  S.spawnLeft=sn.sl; S.kills=sn.kl;
  if(sn.nl!==undefined) S.nightLeft=sn.nl;
  if(sn.ng) S.night=sn.ng;
  if(sn.wv) S.wave=sn.wv;
  var i;
  for(i=0;i<sn.pl.length&&i<S.players.length;i++){
    var P=S.players[i], q=sn.pl[i];
    P.supply=q[0]; P.out=!!q[1]; P.placed=!!q[3];
    P.stance=q[4]?"pursue":"hold";
    if(P.site&&q[5]>=0) P.site.prog=q[5];
    if(i===S.me) S.stance=P.stance;
  }
  for(i=0;i<sn.ne.length&&i<S.nests.length;i++){
    S.nests[i].hp=sn.ne[i][0];
    S.nests[i].dead=!!sn.ne[i][1];
  }
  for(i=0;i<sn.nd.length&&i<S.nodes.length;i++) S.nodes[i].amt=sn.nd[i];

  if(sn.cl){
    S.cells={};
    for(i=0;i<sn.cl.length;i++){
      var r=sn.cl[i], t=r[0];
      var b={type:t,gx:r[1],gz:r[2],hp:r[3],max:TYPES[t].hp,own:r[4],
             rot:r[5],rotAuto:false,cd:0,
             site:!!r[6], prog:r[7]||0,
             need:Math.max(0.001, (t==="hall") ? (TYPES.hall.raise||14)
                                               : (+TYPES[t].raise||1))};
      footCells(t,r[1],r[2]).forEach(function(c){
        S.cells[key(c[0],c[1])]=(c[0]===r[1]&&c[1]===r[2])?b:{ref:b,type:t,own:r[4]};
      });
      if(t==="hall"){
        if(b.site){ S.players[r[4]].site=b; S.players[r[4]].hall=null; }
        else { S.players[r[4]].hall=b; S.players[r[4]].site=null; }
      }
    }
    for(i=0;i<S.players.length;i++){
      var hp2=S.players[i].hall, st2=S.players[i].site;
      if(hp2&&!S.cells[key(hp2.gx,hp2.gz)]) S.players[i].hall=null;
      if(st2&&!S.cells[key(st2.gx,st2.gz)]) S.players[i].site=null;
    }
  }
  // hall hit points ride in the player row so they stay current between
  // building refreshes
  for(i=0;i<sn.pl.length&&i<S.players.length;i++)
    if(S.players[i].hall) S.players[i].hall.hp=sn.pl[i][2];

  syncList(S.enemies, sn.en, function(row){
    var t=EK_N[row[0]], E=ENEMY[t];
    return {t:t, x:row[1], z:row[2], tx:row[1], tz:row[2], rot:row[3], hp:row[4],
            max:row[10], ph:row[5], atk:row[6], atkT:0.85, rise:row[7], sc:row[8],
            hit:row[9], spd:E.speed, reach:E.reach, stag:0, kx:0, kz:0, rec:0,
            dx:0, dz:0, swung:false, ox:0, oz:0, dmgB:0, dmgH:0};
  }, function(e,row){
    e.tx=row[1]; e.tz=row[2]; e.rot=row[3]; e.hp=row[4];
    e.atk=row[6]; e.rise=row[7]; if(row[9]) e.hit=1;
  });

  syncList(S.units, sn.un, function(row){
    var t=UK_N[row[1]], U=UNITS[t];
    return {uid:row[0], t:t, own:row[2], x:row[3], z:row[4], tx:row[3], tz:row[4],
            rot:row[5], hp:row[6], max:U.hp, sc:row[7], hit:row[8], carry:row[9],
            rot0:row[5], px:row[3], pz:row[4], sel:false, cd:0, mode:"idle",
            job:null, target:null, inside:!!row[10], shelter:!!row[10],
            ph:Math.random()*6.283, atk:(row[11]===undefined?-1:row[11]),
            atkT:(row[12]||0.75)};
  }, function(u,row){
    // a unit that went indoors is teleported rather than eased: it is not
    // walking any more, it is gone from the field
    if(!u.inside&&row[10]){ u.x=row[3]; u.z=row[4]; }
    u.inside=!!row[10]; u.shelter=!!row[10];
    // a swing that has just started on the host starts here too
    if(row[11]!==undefined){
      if(row[11]>=0&&(u.atk<0||row[11]<u.atk)) u.atk=row[11];
      else if(row[11]<0) u.atk=-1;
      u.atkT=row[12]||0.75;
    }
    u.tx=row[3]; u.tz=row[4]; u.rot=row[5]; u.hp=row[6];
    u.carry=row[9]; if(row[8]) u.hit=1;
  }, "uid", 0);

  for(i=0;i<S.players.length;i++) S.players[i].cmd=null;
  for(i=0;i<S.units.length;i++)
    if(S.units[i].t==="commander"&&S.players[S.units[i].own|0])
      S.players[S.units[i].own|0].cmd=S.units[i];

  // The host decides when the round is over; this is the guest hearing it.
  if(wasPh!=="won"&&wasPh!=="lost"&&(S.phase==="won"||S.phase==="lost")){
    var won=S.phase==="won";
    if(SND) (won?SND.win():SND.lose());
    if(UI.phase) UI.phase();
    if(onEnd) onEnd({
      won:won, kills:S.kills, wave:S.wave, dawn:(S.dawnBurn|0),
      nights:Math.max(0,S.night-(won?0:1)), nests:liveNests().length,
      hallPct: me().hall?Math.round(100*me().hall.hp/TYPES.hall.hp):0,
      seconds:Math.round(S.waveClock),
      difficulty:(SET&&SET.difficulty)||"normal"
    });
  }
}

// Reconcile a live array against a snapshot list. Units are matched by id so
// selection survives; enemies are matched by index, which is fine because they
// are interchangeable and nobody clicks one.
function syncList(arr,rows,make,upd,idKey){
  var i;
  if(idKey){
    var byId={};
    for(i=0;i<arr.length;i++) byId[arr[i][idKey]]=arr[i];
    var seen={};
    for(i=0;i<rows.length;i++){
      var id=rows[i][0], cur=byId[id];
      if(cur) upd(cur,rows[i]);
      else { cur=make(rows[i]); arr.push(cur); }
      seen[id]=1;
    }
    for(i=arr.length-1;i>=0;i--) if(!seen[arr[i][idKey]]) arr.splice(i,1);
    return;
  }
  for(i=0;i<rows.length;i++){
    if(i<arr.length) upd(arr[i],rows[i]);
    else arr.push(make(rows[i]));
  }
  if(arr.length>rows.length) arr.length=rows.length;
}

// ---- attacker animation ---------------------------------------------------
// Five instances make one attacker. Legs and arms swing about their joints on
// an alternating cycle driven by distance walked, so the gait stays in step
// with the speed whatever the framerate. A swing overrides the walk on the
// arms and leans the whole body into the blow.
function drawEnemy(m,n){
  var EK=ENEMY[m.t]||ENEMY.shambler, id=EK.asset, r=RIG[id];
  var hurtA=m.hit>0.01, sc=m.sc;
  var body=hurtA?[1.05,0.42,0.32]:EK.colA;
  var head=hurtA?[1.25,0.55,0.42]:EK.colB;
  if(!r) return;                       // no rig means no batch to draw into

  var g=r.gait, yaw=m.rot-Math.PI/2, ph=m.ph;
  var st=Math.sin(ph), st2=Math.cos(ph*2);
  var moving=(m.atk<0);

  // attack: 0 while idle, else 0..1 across the swing. The wind-up is the slow
  // part and the strike snaps, which is what makes a blow read as a blow.
  var a=0, strike=0;
  if(m.atk>=0){
    a=Math.min(1,m.atk/Math.max(0.01,m.atkT));
    strike = a<0.58 ? -Math.pow(a/0.58,1.6)*g.wind        // draw back
                    : Math.pow((a-0.58)/0.42,0.45)*g.reach; // and through
  }
  var stag=m.stag;
  // legs: alternating swing while walking, braced apart while swinging
  var legSw = moving ? st*g.swing : Math.abs(st)*0.10;
  var legF  = moving ? 0 : -0.18;
  // arms counter the legs, then the strike takes them over entirely
  var armSw = moving ? -st*g.swing*g.armK : 0;
  var armA  = armSw + strike + stag*0.5;

  var bobY  = (moving? Math.abs(st2)*g.bob : 0) - Math.abs(strike)*0.05;
  var lean  = g.lean + (moving? st2*g.sway*0.35 : 0)
              + strike*0.30 - stag*0.42;    // a flinch rocks it backwards

  // spawn-in: rises out of the ground, so nothing pops into being
  var rise=m.rise, sink=(1-rise)*1.35*sc;
  if(rise<=0.001) return;

  var c=Math.cos(yaw), sn=Math.sin(yaw), mg=gy(m.x,m.z);
  // recoil pushes the whole figure back along its facing, purely in the draw
  var rc=m.rec||0, rx=-Math.cos(m.rot)*rc, rz=-Math.sin(m.rot)*rc;
  function place(ox,oy,oz){                 // asset space -> world
    return [m.x + rx + (ox*c - oz*sn)*sc, mg + oy*sc - sink, m.z + rz + (ox*sn + oz*c)*sc];
  }
  var hp=r.hip, sh=r.sho;

  // body pivots at the hips so the lean tips the chest, not the whole figure
  var bp=place(0, r.rootY + bobY, 0);
  n[id+"Body"]=putP(buf[id+"Body"],n[id+"Body"],bp[0],bp[1],bp[2],yaw,body,sc,head,lean);

  var li, side, lp, ap;
  for(li=0;li<2;li++){
    side=li?-1:1;
    lp=place(hp[0]*side, hp[1]+bobY*0.35, hp[2]);
    n[id+"Leg"]=putP(buf[id+"Leg"],n[id+"Leg"],lp[0],lp[1],lp[2],yaw,body,sc,head,
                     legF + legSw*(li?-1:1));
    ap=place(sh[0]*side, sh[1]+bobY, sh[2]);
    n[id+"Arm"]=putP(buf[id+"Arm"],n[id+"Arm"],ap[0],ap[1],ap[2],yaw,body,sc,head,
                     armA + (moving?(li?-armSw*2:0):0) + (li?0.06:-0.06));
  }
}

// The same five-instance rig the horde uses, driven from a unit's own state.
// Two differences: a friendly figure stands upright rather than hunched, and
// where it has two distinct arms each side gets its own bone.
function drawUnit(u,n,ca,cb){
  var UK=UNITS[u.t], id=UK.asset, r=RIG[id];
  if(!r) return false;
  var g=r.gait, yaw=u.rot-Math.PI/2, ph=u.ph||0, sc=u.sc;
  var st=Math.sin(ph), st2=Math.cos(ph*2);
  var busy=(u.atk>=0);
  var a=0, strike=0;
  if(busy){
    a=Math.min(1,u.atk/Math.max(0.01,u.atkT||0.75));
    strike = a<0.55 ? -Math.pow(a/0.55,1.6)*g.wind
                    : Math.pow((a-0.55)/0.45,0.45)*g.reach;
  }
  // A figure standing still still shifts its weight; one walking swings from
  // the hip. The gait phase is the same number either way.
  var moving=!busy;
  var legSw = moving ? st*g.swing : Math.abs(st)*0.08;
  var legF  = moving ? 0 : -0.12;
  var armSw = moving ? -st*g.swing*g.armK : 0;
  var armA  = armSw + strike;
  var bobY  = (moving? Math.abs(st2)*g.bob : 0) - Math.abs(strike)*0.04;
  var lean  = g.lean + (moving? st2*g.sway*0.35 : 0) + strike*0.24;

  var c=Math.cos(yaw), sn=Math.sin(yaw), ug=gy(u.x,u.z);
  function place(ox,oy,oz){
    return [u.x + (ox*c - oz*sn)*sc, ug + oy*sc, u.z + (ox*sn + oz*c)*sc];
  }
  var hp=r.hip, sh=r.sho;
  var bp=place(0, r.rootY + bobY, 0);
  n[id+"Body"]=putP(buf[id+"Body"],n[id+"Body"],bp[0],bp[1],bp[2],yaw,ca,sc,cb,lean);

  var li, side, lp, ap;
  for(li=0;li<2;li++){
    side=li?-1:1;
    lp=place(hp[0]*side, hp[1]+bobY*0.35, hp[2]);
    n[id+"Leg"]=putP(buf[id+"Leg"],n[id+"Leg"],lp[0],lp[1],lp[2],yaw,ca,sc,cb,
                     legF + legSw*(li?-1:1));
  }
  // the weapon hand leads; the off hand counter-swings and never strikes
  ap=place(sh[0], sh[1]+bobY, sh[2]);
  n[id+"Arm"]=putP(buf[id+"Arm"],n[id+"Arm"],ap[0],ap[1],ap[2],yaw,ca,sc,cb,armA+0.05);
  ap=place(-sh[0], sh[1]+bobY, sh[2]);
  var offA=(r.twoArms? -armSw : armA) - 0.05;
  var key=r.twoArms?(id+"ArmL"):(id+"Arm");
  n[key]=putP(buf[key],n[key],ap[0],ap[1],ap[2],yaw,ca,sc,cb,offA);
  return true;
}

// Everything that can be hurt reports a world point, a fill fraction and how
// wide its bar should be. Only damaged things are listed, so an untouched
// settlement stays clean and a bar always means something is wrong.
var BAR_Y={hall:4.0, tower:3.2, ballista:2.7, archery:2.9, barracks:2.9,
           cottage:2.2, brazier:2.3, wall:1.7, gate:2.1};
var BAR_W={hall:46, wall:22, gate:26, brazier:26, cottage:30};
function hpAnchors(){
  var out=[], i;
  if(!S) return out;
  for(i=0;i<S.nests.length;i++){
    var nn=S.nests[i];
    if(nn.dead||nn.hp>=nn.max) continue;
    out.push({x:nn.x, y:gy(nn.x,nn.z)+4.1, z:nn.z, f:Math.max(0,nn.hp/nn.max), w:46, k:"foe"});
  }
  for(var kk in S.cells){
    var c=S.cells[kk];
    if(c.ref) continue;
    if(c.site){
      out.push({x:M.gx2w(c.gx), y:gy(M.gx2w(c.gx),M.gx2w(c.gz))+(BAR_Y[c.type]||2.6), z:M.gx2w(c.gz),
                f:Math.max(0,Math.min(1,c.prog/Math.max(0.001,c.need))),
                w:(BAR_W[c.type]||34), k:"work"});
      continue;
    }
    if(c.hp>=c.max) continue;
    out.push({x:M.gx2w(c.gx), y:gy(M.gx2w(c.gx),M.gx2w(c.gz))+(BAR_Y[c.type]||2.6), z:M.gx2w(c.gz),
              f:Math.max(0,c.hp/c.max), w:(BAR_W[c.type]||34), k:"own"});
  }
  for(i=0;i<S.units.length;i++){
    var u=S.units[i];
    if(u.hp>=u.max||u.inside) continue;
    out.push({x:u.x, y:gy(u.x,u.z)+1.55*u.sc, z:u.z,
              f:Math.max(0,u.hp/u.max), w:22, k:"own"});
  }
  return out;
}
function hurt(c,f){ var k=0.35+0.65*f; return [c[0]*k+0.02*(1-f),c[1]*k,c[2]*k]; }
// Which sides of this cell continue the wall line. The hovered ghost counts,
// so neighbours visibly reach toward a wall before you commit to placing it.
var DIRX=[1,0,-1,0], DIRZ=[0,1,0,-1];
function joins(gx,gz,ghost){
  if(ghost && ghost.gx===gx && ghost.gz===gz) return true;
  var c=cellAt(gx,gz);
  if(!c) return false;
  var t=rootOf(c).type;
  return t==="wall"||t==="gate";
}
function wallMask(gx,gz,ghost){
  var m=0;
  for(var d=0;d<4;d++) if(joins(gx+DIRX[d],gz+DIRZ[d],ghost)) m|=(1<<d);
  return m;
}
function armMask(b,ghost){
  if(!b.rotAuto){                       // manual facing: force a straight run
    var k=Math.round((b.rot||0)/(Math.PI/2))%4;
    if(k<0) k+=4;
    return (1<<k)|(1<<((k+2)%4));
  }
  var m=wallMask(b.gx,b.gz,ghost);
  return m||0x5;                        // isolated stub reads as a short run
}

function wallRot(gx,gz){
  function isW(c){ if(!c) return false; var t=rootOf(c).type; return t==="wall"||t==="gate"; }
  var h=(isW(cellAt(gx-1,gz))?1:0)+(isW(cellAt(gx+1,gz))?1:0);
  var v=(isW(cellAt(gx,gz-1))?1:0)+(isW(cellAt(gx,gz+1))?1:0);
  if(h>v) return 0;
  if(v>h) return Math.PI/2;
  return Math.abs(M.gx2w(gx))>Math.abs(M.gx2w(gz))?Math.PI/2:0;
}
function pack(){
  var n={hall:0,tower:0,ballista:0,brazier:0,barracks:0,archery:0,cottage:0,
         wall:0,wpost:0,gate:0,salvage:0,
         soldier:0,archer:0,worker:0,commander:0,nest:0,
         corpse:0,bolt:0,arrow:0,spark:0,debris:0,ring:0,marker:0,tile:0,grid:0,site:0};
  for(var rk0 in RIGDEF){
    n[rk0+"Body"]=0; n[rk0+"Arm"]=0; n[rk0+"Leg"]=0;
    if(RIGDEF[rk0].armL) n[rk0+"ArmL"]=0;
  }
  applyAuras();
  var ghostCell=null;
  if(playable() && S.hover && (S.sel==="wall"||S.sel==="gate")
     && canPlace(S.sel,S.hover.gx,S.hover.gz)) ghostCell=S.hover;
  for(var k in S.cells){
    var c=S.cells[k]; if(c.ref) continue;
    var ty=TYPES[c.type], f=c.hp/c.max;
    var x=M.gx2w(c.gx), z=M.gx2w(c.gz);
    var pc=(S.multi&&(c.own||0)!==S.me)?S.players[c.own||0].col:null;
    var ca=hurt(pc||ty.colA,f), cb=hurt(pc?[pc[0]*1.25,pc[1]*1.25,pc[2]*1.25]:ty.colB,f);
    var rt=bRot(c), by=gy(x,z);
    // Anything unbuilt is a heap of materials, the hall included — it is the
    // same mechanic, so it gets the same picture, and nothing half-built is ever
    // drawn: a site is materials right up to the moment it is the building. A
    // multi-cell footprint gets a heap per cell rather than one giant heap, so
    // a hall site reads as a builder's yard the size of the building and the
    // timbers stay timber-sized.
    if(c.site){
      var pr2=Math.max(0,Math.min(1,c.prog/Math.max(0.001,c.need)));
      var mA=pc?dim(pc,1.05):M.PAL.timberL, mB=pc?dim(pc,1.3):M.PAL.stone;
      var multi=(ty.foot||1)>1;
      // the heaps only settle — there is no rising frame to consume them, and
      // the progress bar is what says how far along the work is
      var msc=(multi?0.86:0.94)*(1.0-0.12*pr2);
      footCells(c.type,c.gx,c.gz).forEach(function(cc){
        var tx3=M.gx2w(cc[0]), tz3=M.gx2w(cc[1]), ty3=gy(tx3,tz3);
        n.tile=put(buf.tile,n.tile,tx3,ty3+0.035,tz3,0,
                   [0.42,0.36,0.20],1,[0.42,0.36,0.20]);
        if(!multi) return;
        // a deterministic yaw per cell, so nine heaps do not look stamped
        var hsh=((cc[0]*73856093)^(cc[1]*19349663))>>>0;
        n.site=put(buf.site,n.site,tx3,ty3,tz3,(hsh%628)/100,mA,msc,mB);
      });
      if(!multi) n.site=put(buf.site,n.site,x,by,z,rt,mA,msc,mB);
    }
    else if(c.type==="hall") n.hall=put(buf.hall,n.hall,x,by,z,rt,ca,ty.scale,cb);
    else if(c.type==="tower") n.tower=put(buf.tower,n.tower,x,by,z,rt,ca,ty.scale,cb);
    else if(c.type==="ballista") n.ballista=put(buf.ballista,n.ballista,x,by,z,rt,ca,ty.scale,cb);
    else if(c.type==="brazier") n.brazier=put(buf.brazier,n.brazier,x,by,z,rt,ca,ty.scale,cb);
    else if(c.type==="barracks") n.barracks=put(buf.barracks,n.barracks,x,by,z,rt,ca,ty.scale,cb);
    else if(c.type==="archery") n.archery=put(buf.archery,n.archery,x,by,z,rt,ca,ty.scale,cb);
    else if(c.type==="cottage") n.cottage=put(buf.cottage,n.cottage,x,by,z,rt,ca,ty.scale,cb);
    else if(c.type==="gate") n.gate=put(buf.gate,n.gate,x,by,z,rt,ca,ty.scale,cb);
    else if(c.type==="wall"){
      var mk=armMask(c,ghostCell);
      n.wpost=put(buf.wpost,n.wpost,x,by,z,0,ca,1,cb);
      for(var d2=0;d2<4;d2++)
        if(mk&(1<<d2)) n.wall=put(buf.wall,n.wall,x,by,z,d2*Math.PI/2,ca,1,cb);
    }
    if(S.bsel===c){
      var br=0.75+((ty.foot||1)-1)*0.75;
      n.ring=put(buf.ring,n.ring,x,by+0.05,z,0,[0.55,2.10,2.20],br,[0.55,2.10,2.20]);
    }
    if(playable()&&ty.range&&S.sel===c.type){
      var rc=c.lit?[0.62,0.50,0.26]:[0.30,0.56,0.47];
      n.ring=put(buf.ring,n.ring,x,by+0.05,z,0,rc,ty.range,rc);
    }
    if(playable()&&c.type==="brazier"&&S.sel&&(S.sel==="brazier"||TYPES[S.sel].range))
      n.ring=put(buf.ring,n.ring,x,by+0.05,z,0,[0.58,0.42,0.20],ty.aura,[0.58,0.42,0.20]);
  }
  for(var si=0;si<S.nodes.length;si++){
    var nd=S.nodes[si], nf=Math.max(0,nd.amt/nd.max);
    if(nf<=0.001) continue;
    var na=dim([0.348,0.276,0.190],0.45+0.55*nf), nb=dim([0.300,0.325,0.360],0.45+0.55*nf);
    n.salvage=put(buf.salvage,n.salvage,nd.x,gy(nd.x,nd.z),nd.z,nd.rot,na,0.62+0.62*nf,nb);
    if(nd.worked) n.ring=put(buf.ring,n.ring,nd.x,gy(nd.x,nd.z)+0.03,nd.z,0,
                             [0.72,1.10,0.42],1.35,[0.72,1.10,0.42]);
  }
  for(var i=0;i<S.corpses.length;i++){
    var cp=S.corpses[i], cf=Math.min(1,cp.life/cp.max);
    var cA=dim([0.150,0.156,0.135],0.35+0.65*cf), cB=dim([0.196,0.196,0.168],0.35+0.65*cf);
    n.corpse=putP(buf.corpse,n.corpse,cp.x,
                  cp.y===undefined?((cp.gnd===undefined?PLAT:cp.gnd)+0.02):cp.y,cp.z,cp.rot,
                  cA,cp.sc*(0.55+0.45*cf),cB,cp.tum||0);
  }
  var nestMeta=M.assetMeta("nest");
  for(i=0;i<S.nests.length;i++){
    var nn=S.nests[i];
    if(nn.dead) continue;
    var nf=Math.max(0,nn.hp/nn.max);
    var na=nn.hit>0.01?[1.35,0.55,0.42]:hurt(nestMeta.colA,nf);
    var nb=nn.hit>0.01?[1.55,0.70,0.55]:hurt(nestMeta.colB,nf);
    // no boundary ring: the tainted ground already says where it reaches
    n.nest=put(buf.nest,n.nest,nn.x,gy(nn.x,nn.z),nn.z,0,na,(nestMeta.scale||1)*1.5,nb);
  }
  for(i=0;i<S.enemies.length;i++) drawEnemy(S.enemies[i],n);
  for(i=0;i<S.units.length;i++){
    var u=S.units[i], UK=UNITS[u.t], uf=Math.max(0,u.hp/u.max);
    if(u.inside) continue;                  // indoors: nothing to draw
    if(u.sel) n.ring=put(buf.ring,n.ring,u.x,gy(u.x,u.z)+0.03,u.z,0,
                         [0.55,2.10,2.20],0.62,[0.55,2.10,2.20]);
    // the rally is only a decision if you can see where it reaches
    if(u.t==="commander"&&(u.own|0)===S.me){
      var UC=UNITS.commander, rr=(UC.rally===undefined?5.6:UC.rally);
      if(rr>0&&(u.sel||S.phase==="attack")){
        var rc=u.sel?[1.05,0.85,0.36]:[0.46,0.37,0.16];
        n.ring=put(buf.ring,n.ring,u.x,gy(u.x,u.z)+0.045,u.z,0,rc,rr,rc);
      }
    }
    // the other player's people carry their seat colour so a mixed fight reads
    var oc=(S.multi&&(u.own||0)!==S.me)?S.players[u.own||0].col:null;
    var ua=u.hit>0.01?[1.35,0.72,0.55]:hurt(oc||UK.colA,uf);
    var ub=u.hit>0.01?[1.45,0.85,0.66]:hurt(oc?[oc[0]*1.2,oc[1]*1.2,oc[2]*1.2]:UK.colB,uf);
    // rigged if the asset has bones, otherwise the old single instance
    if(!drawUnit(u,n,ua,ub))
      n[u.t]=put(buf[u.t],n[u.t],u.x,gy(u.x,u.z),u.z,u.rot-Math.PI/2,ua,u.sc,ub);
    if(u.carry>0.5){
      var cf=Math.min(1,u.carry/Math.max(1,UNITS[u.t].carry));
      var lc=[0.95+0.5*cf,0.78+0.35*cf,0.40];
      n.spark=put(buf.spark,n.spark,u.x,gy(u.x,u.z)+1.35*u.sc,u.z,0,lc,0.85+0.7*cf,lc);
    }
  }
  for(i=0;i<S.markers.length;i++){
    var mk=S.markers[i], mf=Math.max(0,mk.life/mk.max);
    var mc=[0.42*mf,1.55*mf,1.62*mf];
    n.marker=put(buf.marker,n.marker,mk.x,gy(mk.x,mk.z)+0.04,mk.z,0,mc,1.0+(1-mf)*1.5,mc);
  }
  for(i=0;i<S.bolts.length;i++){
    var bo=S.bolts[i];
    if(bo.friendly){
      var acol=[0.75,1.85,1.90];
      n.arrow=put(buf.arrow,n.arrow,bo.x,bo.y,bo.z,bo.rot,acol,1,acol);
    } else {
      var bcol=bo.splash?[2.4,1.2,0.45]:[2.2,1.5,0.6];
      n.bolt=put(buf.bolt,n.bolt,bo.x,bo.y,bo.z,bo.rot,bcol,bo.sc||1,bcol);
    }
  }
  for(i=0;i<S.parts.length;i++){
    var pa=S.parts[i], pf=Math.max(0,Math.min(1,pa.life/pa.max));
    var pc=[pa.r*pf,pa.g*pf,pa.b*pf];
    if(pa.chip){
      // masonry keeps its colour as it falls and tumbles; embers fade instead
      var pcc=[pa.r,pa.g,pa.b];
      n.debris=putP(buf.debris,n.debris,pa.x,pa.y,pa.z,pa.life*7.0,pcc,
                    pa.sc*(0.5+0.5*pf),pcc,pa.life*5.0);
    } else n.spark=put(buf.spark,n.spark,pa.x,pa.y,pa.z,0,pc,pa.sc*(0.45+0.55*pf),pc);
  }
  if(playable()){
    // The grid is a placement aid, so it only exists while you are placing. The
    // patch follows the cursor — there is no build ring any more, so a grid
    // pinned to the middle of the map would be no help out at the edge — but
    // its lines are the world's cell edges, not the cursor's. Snapping the
    // instance to a whole cell is what makes it read as ground you are moving
    // over rather than a mat dragged along under the building.
    if(S.sel&&S.hover){
      var grx=Math.round(S.hover.x/M.CELL)*M.CELL;
      var grz=Math.round(S.hover.z/M.CELL)*M.CELL;
      n.grid=put(buf.grid,n.grid,grx,gy(grx,grz)+0.02,grz,0,
                 [0.40,0.46,0.44],1,[0.40,0.46,0.44]);
    }
    if(S.hover&&S.sel){
      var ok=canPlace(S.sel,S.hover.gx,S.hover.gz);
      var tint=ok?[0.24,0.58,0.40]:[0.62,0.20,0.16];
      footCells(S.sel,S.hover.gx,S.hover.gz).forEach(function(cc){
        n.tile=put(buf.tile,n.tile,M.gx2w(cc[0]),gy(M.gx2w(cc[0]),M.gx2w(cc[1]))+0.035,M.gx2w(cc[1]),0,tint,1,tint);
      });
      var t2=TYPES[S.sel], gxw=M.gx2w(S.hover.gx), gzw=M.gx2w(S.hover.gz);
      var gA=ghostCol(t2.colA,ok), gB=ghostCol(t2.colB,ok);
      var rot=ghostRot(S.sel,S.hover.gx,S.hover.gz);
      var ghy=gy(gxw,gzw);
      if(S.sel==="hall") n.hall=put(buf.hall,n.hall,gxw,ghy,gzw,rot,gA,t2.scale,gB);
      else if(S.sel==="tower"||S.sel==="ballista"){
        var gk=S.sel;
        n[gk]=put(buf[gk],n[gk],gxw,ghy,gzw,rot,gA,t2.scale,gB);
        n.ring=put(buf.ring,n.ring,gxw,ghy+0.06,gzw,0,[0.80,0.68,0.33],t2.range,[0.80,0.68,0.33]);
      }
      else if(S.sel==="barracks"||S.sel==="archery"||S.sel==="cottage"){
        n[S.sel]=put(buf[S.sel],n[S.sel],gxw,ghy,gzw,rot,gA,t2.scale,gB);
      }
      else if(S.sel==="brazier"){
        n.brazier=put(buf.brazier,n.brazier,gxw,ghy,gzw,rot,gA,t2.scale,gB);
        n.ring=put(buf.ring,n.ring,gxw,ghy+0.06,gzw,0,[0.80,0.62,0.28],t2.aura,[0.80,0.62,0.28]);
      }
      else if(S.sel==="wall"){
        var gm=armMask({gx:S.hover.gx,gz:S.hover.gz,rotAuto:S.rotAuto,
                        rot:S.rotStep*Math.PI/2}, null);
        n.wpost=put(buf.wpost,n.wpost,gxw,ghy,gzw,0,gA,1,gB);
        for(var gd=0;gd<4;gd++)
          if(gm&(1<<gd)) n.wall=put(buf.wall,n.wall,gxw,ghy,gzw,gd*Math.PI/2,gA,1,gB);
      }
      else if(S.sel==="gate") n.gate=put(buf.gate,n.gate,gxw,ghy,gzw,rot,gA,t2.scale,gB);
    }
  }
  for(var kk2 in n){
    var tb=B[kk2];
    if(!tb){                                  // a rig bone, not a plain batch
      var base=kk2.replace(/(Body|ArmL|Arm|Leg)$/,""), rr=RIG[base];
      if(!rr) continue;
      tb = kk2.slice(-4)==="Body" ? rr.bBody
         : kk2.slice(-4)==="ArmL" ? rr.bArmL
         : kk2.slice(-3)==="Arm"  ? rr.bArm : rr.bLeg;
      if(!tb) continue;
    }
    R.setInstances(tb,buf[kk2],n[kk2]);
  }
}

// Lamp pools follow the buildings that carry a fire: the hall's windows, every
// tower's brazier, the ballista's sight lamp, and the brazier itself — which is
// the brightest thing on the field and the reason to build one away from the
// core. Braziers claim slots first, then whatever is nearest the hall.
var LAMPS=[];
var LAMP_SPEC={
  brazier :[2.35, 10.0, 1.00,0.66,0.30, 0.92],
  tower   :[2.70,  6.6, 1.00,0.62,0.28, 0.56],
  ballista:[2.60,  6.0, 1.00,0.68,0.34, 0.46],
  barracks:[1.65,  6.8, 1.00,0.72,0.38, 0.52],
  archery :[1.75,  6.2, 1.00,0.74,0.40, 0.44],
  cottage :[1.35,  5.6, 1.00,0.74,0.38, 0.46]
};
function packLamps(){
  LAMPS.length=0;
  var anyHall=false;
  for(var ph=0;ph<S.players.length;ph++){
    var H=S.players[ph].hall;
    if(!H) continue;
    anyHall=true;
    LAMPS.push([M.gx2w(H.gx),PLAT+1.60,M.gx2w(H.gz),8.6, 1.00,0.70,0.34, 0.78]);
  }
  if(!anyHall) return LAMPS;
  var hx=me().hall?M.gx2w(me().hall.gx):S.players[S.me].cx;
  var hz=me().hall?M.gx2w(me().hall.gz):S.players[S.me].cz;
  var lit=[], k;
  for(k in S.cells){
    var b=S.cells[k];
    if(!b||b.ref||!LAMP_SPEC[b.type]) continue;
    lit.push(b);
  }
  lit.sort(function(a,c){
    var pa=(a.type==="brazier")?0:1, pc=(c.type==="brazier")?0:1;
    if(pa!==pc) return pa-pc;
    return (Math.hypot(M.gx2w(a.gx)-hx,M.gx2w(a.gz)-hz)
          - Math.hypot(M.gx2w(c.gx)-hx,M.gx2w(c.gz)-hz));
  });
  for(var i=0;i<lit.length&&LAMPS.length<12;i++){
    var t=lit[i], sp=LAMP_SPEC[t.type];
    LAMPS.push([M.gx2w(t.gx),PLAT+sp[0],M.gx2w(t.gz),sp[1], sp[2],sp[3],sp[4], sp[5]]);
  }
  return LAMPS;
}

// The audio listener rides the camera. Sounds carry world positions; the mixer
// turns the difference into pan, level and how much air is in the way, so a
// tower on your left fires on your left and a nest across the map is distant.
var ambT=0, ambOn=false;
function draw(){
  if(!active||!S) return;
  if(R.setTime) R.setTime(S.dayP);
  if(R.setLamps) R.setLamps(packLamps());
  if(SND&&SND.listen){
    var CA=camera(true);
    SND.listen(CA.target[0],CA.target[2],CA.r[0],CA.r[2],cam.zoom);
    // The bed is told when the world changes under it — and retried until it
    // takes, because the first change usually lands before the browser has
    // allowed any audio at all.
    if(SND.ambience && (S.phase!==ambT||!ambOn)){
      ambOn=SND.ambience(S.phase,S.dayP); ambT=S.phase;
    }
  }
  pack();
  R.render(camera(),BATCHES,[S.flash*1.5,0,0]);
}

// ---- input ----------------------------------------------------------------
// Modes: 'orbit' (right-drag or shift-drag), 'paint' (left-drag with a wall or
// gate held), 'marquee' (left-drag otherwise), 'maybe' (a press that has not
// moved far enough to be a drag yet — resolved as a click on release).
var mode=null, lastX=0, lastY=0, downX=0, downY=0, downBtn=0, addSel=false;
var DRAG_PX=5;
function sens(){ return (SET&&SET.sens!==undefined)?SET.sens:1.0; }

// Project a world point to page pixels using the same VP the frame is drawn
// with — cheaper and steadier than a colour-readback pass for round bodies.
function projPt(vp,x,y,z,rect){
  var w=vp[3]*x+vp[7]*y+vp[11]*z+vp[15];
  if(!w) w=1;
  var cx=(vp[0]*x+vp[4]*y+vp[8]*z+vp[12])/w;
  var cy=(vp[1]*x+vp[5]*y+vp[9]*z+vp[13])/w;
  return [ (cx*0.5+0.5)*rect.width+rect.left,
           (1-(cy*0.5+0.5))*rect.height+rect.top ];
}
function unitAt(cx,cy){
  if(!S||!S.units.length) return null;
  var C=camera(true), rect=canvas.getBoundingClientRect();
  var best=null, bd=26;
  for(var i=0;i<S.units.length;i++){
    var u=S.units[i];
    if((u.own||0)!==S.me||u.inside) continue;
    var sp=projPt(C.vp,u.x,PLAT+0.62*u.sc,u.z,rect);
    var d=Math.hypot(sp[0]-cx,sp[1]-cy);
    if(d<bd){ bd=d; best=u; }
  }
  return best;
}
function unitsInBox(x0,y0,x1,y1){
  var C=camera(true), rect=canvas.getBoundingClientRect(), out=[];
  var ax=Math.min(x0,x1), bx=Math.max(x0,x1);
  var ay=Math.min(y0,y1), by=Math.max(y0,y1);
  for(var i=0;i<S.units.length;i++){
    var u=S.units[i];
    if((u.own||0)!==S.me||u.inside) continue;
    var sp=projPt(C.vp,u.x,PLAT+0.62*u.sc,u.z,rect);
    if(sp[0]>=ax&&sp[0]<=bx&&sp[1]>=ay&&sp[1]<=by) out.push(u);
  }
  return out;
}
function selectOnly(list){
  for(var i=0;i<S.units.length;i++) S.units[i].sel=false;
  for(var k=0;k<list.length;k++) list[k].sel=true;
  if(UI.units) UI.units();
}
function addToSelection(list){
  for(var k=0;k<list.length;k++) list[k].sel=true;
  if(UI.units) UI.units();
}
function selectAllUnits(kind){
  var out=[];
  for(var i=0;i<S.units.length;i++)
    if((S.units[i].own||0)===S.me && !S.units[i].inside
       && (!kind||S.units[i].t===kind)) out.push(S.units[i]);
  selectOnly(out);
  return out.length;
}
// The two groups the HUD counts: the people who carry things and the people who
// fight. Someone indoors is not on the field, so they are neither.
function myUnits(group){
  var out=[];
  for(var i=0;i<S.units.length;i++){
    var u=S.units[i];
    if((u.own||0)!==S.me) continue;
    var civ=!!UNITS[u.t].civil;
    if(group==="workers"&&!civ) continue;
    if(group==="army"&&civ) continue;
    out.push(u);
  }
  return out;
}
function groupCount(group){
  var list=myUnits(group), n=0;
  for(var i=0;i<list.length;i++) if(!list[i].inside) n++;
  return {total:list.length, out:n, inside:list.length-n};
}
function selectGroup(group){
  var list=myUnits(group), out=[];
  for(var i=0;i<list.length;i++) if(!list[i].inside) out.push(list[i]);
  selectOnly(out);
  return out.length;
}
// Standing with your people makes them fight faster. It is the only reason to
// think about where the commander is once the hall is up, and it is why he is
// worth keeping alive rather than parking behind the wall.
function rallyOf(u){
  if(u.t==="commander") return 1;
  var p=S.players[u.own||0];
  if(!p) return 1;
  var cm=cmdOf(p);
  if(!cm) return 1;
  var UC=UNITS.commander, r=(UC.rally===undefined?5.6:UC.rally);
  if(r<=0) return 1;
  return (Math.hypot(cm.x-u.x,cm.z-u.z)<=r) ? (UC.rallyK||0.70) : 1;
}
function stanceOf(pid){
  var p=S.players[pid||0];
  return (p&&p.stance)||S.stance||"hold";
}
function setStance(v,pid){
  if(pid===undefined||pid===null){
    if(guest()) return intent({m:"st",v:v});
    pid=S.me;
  }
  if(S.players[pid]) S.players[pid].stance=v;
  if(pid===S.me) S.stance=v;
  if(UI.units) UI.units();
}
// Put the held building back. Nothing is armed by default, so this is how the
// player gets back to a cursor that only inspects and selects.
function clearSel(){
  if(!S) return false;
  if(S.sel){ S.sel=null; if(UI.hotbar) UI.hotbar(); return true; }
  if(S.bsel){ selectBuilding(null); return true; }
  return false;
}
// Ctrl+D lets go of everything at once — what you are holding, the building
// you picked, and whoever is selected. Escape belongs to the pause menu now.
function deselectAll(){
  if(!S) return false;
  var had=!!(S.sel||S.bsel||selectedUnits().length);
  S.sel=null; S.bsel=null;
  clearSelection();
  if(UI.hotbar) UI.hotbar();
  if(UI.building) UI.building();
  return had;
}
// Clicking a building of yours with an empty cursor picks it up as a subject
// rather than selling it: that is what gives the hall somewhere to put a verb.
function selectBuilding(b){
  if(!S) return null;
  // A site is selectable so a misplacement can be called off before it stands —
  // the hall's is not, because there is nothing to fall back to if you scrap it.
  var pick=b&&(b.own|0)===S.me&&!(b.site&&b.type==="hall");
  S.bsel=pick?b:null;
  if(UI.building) UI.building();
  return S.bsel;
}

function wireInput(){
  canvas.addEventListener("contextmenu",function(e){ e.preventDefault(); });

  canvas.addEventListener("dblclick",function(ev){
    if(!active||!S) return;
    var u=unitAt(ev.clientX,ev.clientY);
    if(u) selectAllUnits(u.t);
  });

  canvas.addEventListener("pointerdown",function(ev){
    if(!active) return;
    // a pointer that has already gone away throws here, and an exception in
    // pointerdown would take the rest of the input handling with it
    try{ canvas.setPointerCapture(ev.pointerId); }catch(e){}
    downX=lastX=ev.clientX; downY=lastY=ev.clientY; downBtn=ev.button;
    addSel=ev.ctrlKey||ev.metaKey;

    // Turning the view is the middle button (or shift-drag, for a trackpad
    // with no middle click). The right button is only ever an order, so it can
    // never fight with moving troops.
    if(ev.button===1||ev.shiftKey){ ev.preventDefault(); mode="orbit"; return; }
    if(ev.button===2){ mode="order"; return; }

    var u=unitAt(ev.clientX,ev.clientY);
    if(u){
      if(addSel) addToSelection([u]); else selectOnly([u]);
      mode="none";
      return;
    }
    // holding a wall or gate means a drag is a paint stroke; anything else and
    // a drag is a selection box
    if(playable()&&(S.sel==="wall"||S.sel==="gate")){
      var p=pick(ev.clientX,ev.clientY);
      if(!p){ mode="none"; return; }
      mode="paint";
      // a stroke only builds: dragging across your own wall leaves it alone
      // rather than refunding it out from under you
      place(S.sel,p.gx,p.gz);
      return;
    }
    mode="maybe";
  });

  canvas.addEventListener("pointermove",function(ev){
    if(!active) return;
    if(mode==="orbit"){
      cam.az-=(ev.clientX-lastX)*0.30*sens();
      cam.el=Math.max(20,Math.min(72,cam.el+(ev.clientY-lastY)*0.18*sens()));
      lastX=ev.clientX; lastY=ev.clientY; return;
    }
    var p=pick(ev.clientX,ev.clientY);
    S.hover=p;
    if(mode==="paint"){
      if(p&&(S.sel==="wall"||S.sel==="gate")) place(S.sel,p.gx,p.gz);
      return;
    }
    if(mode==="maybe" &&
       Math.abs(ev.clientX-downX)+Math.abs(ev.clientY-downY)>DRAG_PX) mode="marquee";
    if(mode==="marquee"){
      S.marquee=[downX,downY,ev.clientX,ev.clientY];
      if(UI.marquee) UI.marquee();
    }
  });

  function up(ev){
    if(active&&S&&ev){
      var moved=Math.abs(ev.clientX-downX)+Math.abs(ev.clientY-downY);
      if(mode==="marquee"){
        var hit=unitsInBox(downX,downY,ev.clientX,ev.clientY);
        if(addSel) addToSelection(hit); else selectOnly(hit);
      } else if(mode==="maybe"&&moved<=DRAG_PX){
        // A click never sells. It places what you are holding, or picks up a
        // building as a subject; selling is one deliberate button in the dock.
        if(playable()){
          var p=pick(ev.clientX,ev.clientY);
          var hit=p?rootOf(cellAt(p.gx,p.gz)):null;
          if(p&&S.sel&&!hit){
            place(S.sel,p.gx,p.gz);
          } else if(hit&&(hit.own|0)===S.me&&!hit.site){
            selectBuilding(hit);
            if(!addSel) selectOnly([]);
          } else if(!hit){
            selectBuilding(null);
            if(!addSel) selectOnly([]);
          }
        } else { selectBuilding(null); if(!addSel) selectOnly([]); }
      } else if(mode==="order"&&downBtn===2){
        // Right-click is an order, full stop — there is no right-drag gesture
        // left for it to compete with. Requiring the mouse to be still first
        // meant an order given on the move simply vanished.
        var g=pick(ev.clientX,ev.clientY), list=selectedUnits();
        // a selected house turns its own people out to wherever you clicked
        if(g&&S.bsel&&housedBy(S.bsel).length&&!cellAt(g.gx,g.gz)) sendOut(S.bsel,g.x,g.z);
        if(g&&list.length){
          var civ=list.filter(function(u){ return UNITS[u.t].civil; });
          var hurtB=rootOf(cellAt(g.gx,g.gz));
          if(hurtB&&(hurtB.own|0)!==S.me) hurtB=null;
          if(hurtB&&(hurtB.site||hurtB.hp>=hurtB.max)) hurtB=null;
          var nd=hurtB?null:nodeAtWorld(g.x,g.z,2.4);
          var claimed=false;
          if(hurtB&&civ.length){ assignRepair(civ,hurtB); claimed=true; }
          else if(nd&&civ.length){ assignJob(civ,nd); claimed=true; }
          var rest=claimed?list.filter(function(u){ return !UNITS[u.t].civil; }):list;
          if(rest.length) orderTo(rest,g.x,g.z);
        }
      }
    }
    mode=null;
    if(S){ S.marquee=null; if(UI.marquee) UI.marquee(); }
    if(ev&&ev.pointerId!==undefined&&canvas.hasPointerCapture(ev.pointerId))
      canvas.releasePointerCapture(ev.pointerId);
  }
  canvas.addEventListener("pointerup",up);
  canvas.addEventListener("pointercancel",function(){
    mode=null;
    if(S){ S.marquee=null; if(UI.marquee) UI.marquee(); }
  });
  canvas.addEventListener("pointerleave",function(){ if(active&&S) S.hover=null; });
  canvas.addEventListener("wheel",function(ev){
    if(!active) return;
    ev.preventDefault();
    cam.zoom=Math.max(11,Math.min(34,cam.zoom*(1+Math.sign(ev.deltaY)*0.09)));
  },{passive:false});
}
// WASD pans. Holding is what makes a camera feel like a camera, so the keys
// set flags and the frame moves the target — a keydown repeat rate would make
// it stutter.
var panKeys={w:0,a:0,s:0,d:0}, panFast=false;
var PAN_SPD=17, PAN_FAST=2.5;
function panKey(ev,down){
  // Shift rides on every key event, so reading it here keeps the flag honest
  // whether shift went down before the direction key or after it.
  panFast=!!ev.shiftKey;
  var k=(ev.key||"").toLowerCase();
  if(k!=="w"&&k!=="a"&&k!=="s"&&k!=="d") return false;
  if(ev.ctrlKey||ev.metaKey) return false;      // ctrl+A and ctrl+D are their own
  panKeys[k]=down?1:0;
  if(down) ev.preventDefault();
  return true;
}
function stepPan(dt){
  var fr=panKeys.d-panKeys.a, fw=panKeys.w-panKeys.s;
  if(!fr&&!fw) return;
  // Take the directions from the camera's own basis rather than re-deriving
  // them from the azimuth. Doing that trig by hand put the whole thing a
  // quarter turn out — W walked the view sideways — and there is no reason to
  // guess at an answer the renderer already holds.
  var C=camera(true);
  var rx=C.r[0], rz=C.r[2], ax=C.f[0], az=C.f[2];   // screen right, screen away
  var rl=Math.hypot(rx,rz)||1, al=Math.hypot(ax,az)||1;
  rx/=rl; rz/=rl; ax/=al; az/=al;
  var dx=fr*rx+fw*ax, dz=fr*rz+fw*az;
  var L=Math.hypot(dx,dz)||1;
  // shift moves the view faster; it has nothing to do with how fast it turns
  var sp=PAN_SPD*dt*(cam.zoom/17)*(panFast?PAN_FAST:1);
  cam.tx+=dx/L*sp;
  cam.tz+=dz/L*sp;
  var lim=M.EXT*0.55;
  cam.tx=Math.max(-lim,Math.min(lim,cam.tx));
  cam.tz=Math.max(-lim,Math.min(lim,cam.tz));
}
function clearPan(){ panKeys.w=panKeys.a=panKeys.s=panKeys.d=0; panFast=false; }
function keydown(ev){
  if(!active||!S) return;
  if(panKey(ev,true)) return;
  if((ev.ctrlKey||ev.metaKey)&&(ev.key==="a"||ev.key==="A")){
    ev.preventDefault(); selectAllUnits(null); return;
  }
  if(ev.key==="h"||ev.key==="H") setStance(S.stance==="hold"?"pursue":"hold");
  if(ev.key==="q"||ev.key==="Q") cam.az-=15;
  if(ev.key==="e"||ev.key==="E") cam.az+=15;
  if(ev.key==="r"||ev.key==="R"){ if(ev.shiftKey) rotAuto(); else rotate(false); }
}
function keyup(ev){ panKey(ev,false); }
function panSpeeding(){ return panFast; }

var UI={phase:null,hotbar:null,rot:null,units:null,marquee:null,building:null};
return {
  init:init, start:start, stop:stop, resume:resume, update:update, draw:draw,
  keydown:keydown, keyup:keyup, clearPan:clearPan, panSpeeding:panSpeeding,
  deselectAll:deselectAll,
  startWave:startWave, clearSel:clearSel, RIG:RIG, RIGDEF:RIGDEF,
  liveNests:liveNests, cam:function(){ return cam; }, camera:camera,
  // how big tonight will be, from what is still standing out there
  waveSize:function(){ return S?waveSize():0; },
  nestSend:function(n){ return S?nestSend(n||(S?S.night:1)):0; },
  // exposed so a test can land credited damage on a nest without pretending to
  // be a soldier; the game itself only ever reaches it through hurtTarget
  hurtNest:function(n,amt,pid){ hurtTarget(n,amt,pid); },
  // The four ground corners of what the camera can currently see, so the
  // minimap can draw the same box you are looking through.
  viewQuad:function(){
    if(!S) return null;
    var C=camera(true);
    var hw=cam.zoom*C.aspect, hh=cam.zoom, out=[];
    var sx=[-1,1,1,-1], sy=[1,1,-1,-1];
    for(var i=0;i<4;i++){
      var o=[C.target[0]+C.r[0]*sx[i]*hw+C.u[0]*sy[i]*hh,
             C.target[1]+C.r[1]*sx[i]*hw+C.u[1]*sy[i]*hh,
             C.target[2]+C.r[2]*sx[i]*hw+C.u[2]*sy[i]*hh];
      var t=(PLAT-o[1])/(Math.abs(C.f[1])<1e-6?1e-6:C.f[1]);
      out.push([o[0]+C.f[0]*t, o[2]+C.f[2]*t]);
    }
    return out;
  },
  camAz:function(){ return cam.az; },
  snapshot:snapshot, applySnapshot:applySnapshot,
  setNetSend:setNetSend, applyIntent:applyIntent, isGuest:guest,
  players:function(){ return S?S.players:[]; },
  meIdx:function(){ return S?S.me:0; },
  livePlayers:livePlayers, eliminate:eliminate,
  lookAtSeat:function(i){
    if(!S||!S.players[i]) return;
    cam.tx=S.players[i].cx; cam.tz=S.players[i].cz;
  },
  hpAnchors:hpAnchors,
  bsel:function(){ return S?S.bsel:null; },
  selectBuilding:selectBuilding, setShelter:setShelter, sendOut:sendOut,
  housedBy:housedBy, sheltering:sheltering, shelteredCount:shelteredCount,
  select:function(t){ if(S) S.sel=(S.sel===t)?null:t; },
  held:function(){ return S?S.sel:null; },
  rotate:rotate, rotAuto:rotAuto,
  UNITS:UNITS, setStance:setStance, selectAll:selectAllUnits,
  selectGroup:selectGroup, groupCount:groupCount,
  salvageLeft:salvageLeft, assignJob:assignJob, nodeAtWorld:nodeAtWorld,
  DAY_LEN:DAY_LEN,
  dragMode:function(){ return mode; }, unitAt:unitAt, builtInCat:builtInCat,
  restoreScene:restoreScene, rebuildAssets:rebuildAssets,
  isActive:function(){ return active; },
  state:function(){ return S; },
  TYPES:TYPES, CATS:CATS, DIFF:DIFF, ENEMY:ENEMY, UI:UI, syncStats:syncStats,
  // The instance batches, keyed by name. Nothing in the game reads this — it is
  // here so a test can say "the grid batch" instead of guessing an index into
  // BATCHES, which is exactly the kind of guess that made an earlier check
  // measure the ghost building and report that the grid was fine.
  batches:function(){ return B; },
  canPlace:canPlace, place:place, removeAt:removeAt
};
})();
