// ===========================================================================
// Nightward — solo round: build phase, attack phase, resolution
// ===========================================================================
var HFGAME=(function(){
"use strict";
var M=HF;
var CELL=M.CELL, GN=M.GN, PLAT=M.PLAT, BUILD_R=M.BUILD_R;

var R=null, canvas=null, SET=null, onEnd=null, active=false;
var SND=(typeof HFSND!=="undefined")?HFSND:null;
var B=null, BATCHES=null, DECALS=null, buf={};

// ---- balance --------------------------------------------------------------
// Structure and art live here; every gameplay number comes from the balance
// registry in the core, so the Library is the single place they are edited.
// hall keeps cost 0 — it is placed, not bought.
// `cat` places a building in the hotbar; `blurb(b)` is its one-line summary,
// read from live stats so the hotbar never disagrees with the Library.
// name and note come from the text table, refreshed by syncStats() so a line
// edited in the Library reaches the hotbar without a reload.
var CATS=[{id:"core"},{id:"guns"},{id:"walls"},{id:"muster"}];
var TYPES={
  // `also` is a second kind in the same garrison. The hall is the only building
  // that musters two, and it gets a second field rather than a second building
  // because a scout is not something you choose to build — it comes with having
  // a town at all.
  hall : {cat:"core", foot:3, scale:1.00, cost:0,
          colA:M.PAL.plaster, colB:M.PAL.slate, spawns:"worker", also:"scout",
          blurb:function(t){ return M.t("bld.hall.blurb",{cap:t.cap, raise:t.raise}); }},
  // A road is in here so the dock, the tabs and the number keys treat it like
  // anything else you hold. `road:true` is the flag every piece of cell code
  // checks: it is never placed into S.cells, has no footprint and no asset, and
  // input diverts on it before place() is ever reached.
  road : {cat:"core", road:true, foot:0, scale:1.00, cost:0,
          colA:M.PAL.stone, colB:M.PAL.timber,
          blurb:function(t){ return M.t("bld.road.blurb"); }},
  cottage:{cat:"core", foot:1, scale:0.66, spawns:"worker",
          colA:M.PAL.plaster, colB:M.PAL.thatch,
          blurb:function(t){ return M.t("bld.cottage.blurb",{cap:t.cap, retrain:t.retrain}); }},
  tower: {cat:"guns", foot:1, scale:0.70,
          colA:M.PAL.timberL, colB:M.PAL.iron,
          blurb:function(t){ return M.t("bld.tower.blurb",{dmg:t.dmg, fire:t.fire}); }},
  ballista:{cat:"guns", foot:1, scale:0.78, boltScale:2.1,
          colA:M.PAL.timberL, colB:M.PAL.iron,
          blurb:function(t){ return M.t("bld.ballista.blurb",{dmg:t.dmg}); }},
  brazier:{cat:"guns", foot:1, scale:0.90,
          colA:M.PAL.stone, colB:M.PAL.iron,
          blurb:function(t){ return M.t("bld.brazier.blurb",{}); }},
  wall : {cat:"walls", foot:1, scale:1.00, wallish:true,
          colA:M.PAL.timber, colB:M.PAL.iron,
          blurb:function(t){ return M.t("bld.wall.blurb",{hp:t.hp}); }},
  gate : {cat:"walls", foot:1, scale:1.00, wallish:true,
          colA:M.PAL.timberL, colB:M.PAL.iron,
          blurb:function(t){ return M.t("bld.gate.blurb",{hp:t.hp}); }},
  // `wallish` puts it in a wall run: joins() and wallRot() count it as a
  // neighbour, so the palisades either side grow their arms into it and the
  // join builds itself rather than being drawn. `hand` makes it a worker's job
  // rather than a timer — the road's rule, applied to a second thing.
  turret:{cat:"walls", foot:1, scale:1.00, wallish:true, hand:true,
          colA:M.PAL.timber, colB:M.PAL.iron,
          blurb:function(t){ return M.t((t.cap|0)===1?"bld.turret.blurb.one":"bld.turret.blurb",
                                        {cap:t.cap, range:t.range}); }},
  barracks:{cat:"muster", foot:1, scale:0.72, spawns:"soldier",
          colA:M.PAL.timber, colB:M.PAL.slate,
          blurb:function(t){ return M.t("bld.barracks.blurb",{cap:t.cap, retrain:t.retrain}); }},
  archery:{cat:"muster", foot:1, scale:0.72, spawns:"archer",
          colA:M.PAL.timberL, colB:M.PAL.thatch,
          blurb:function(t){ return M.t("bld.archery.blurb",{cap:t.cap, retrain:t.retrain}); }}
};

// ---- defenders ------------------------------------------------------------
// Soldiers hold a lane with their bodies; archers out-range everything and die
// to anything that reaches them. Both are mustered by a building and belong to
// it, so losing the building costs you the replacements, not the survivors.
var UNITS={
  soldier:{asset:"soldier", melee:true,
           scBase:1.26, scVar:0.08, colA:[0.475,0.395,0.262], colB:[0.610,0.650,0.685],
           gib:[0.72,0.70,0.58]},
  archer :{asset:"archer",  melee:false,
           scBase:1.20, scVar:0.08, colA:[0.352,0.430,0.372], colB:[0.545,0.470,0.300],
           gib:[0.62,0.70,0.60]},
  worker :{asset:"worker",  civil:true,
           scBase:1.18, scVar:0.08, colA:[0.430,0.398,0.300], colB:[0.545,0.520,0.470],
           gib:[0.70,0.66,0.56]},
  // Military rather than civil: it holds a post, takes a stance, counts with
  // your army and stays out at night. Which is the point — a scout that ran
  // indoors at dusk would be asleep for the only hours it is useful.
  scout  :{asset:"scout",   melee:true,
           scBase:1.16, scVar:0.06, colA:[0.318,0.372,0.352], colB:[0.585,0.512,0.352],
           gib:[0.64,0.68,0.62]},
  // One per player, on the field before anything is built. It is the only unit
  // that can raise a hall, which is why the round starts with a walk rather
  // than a click: where you put the hall costs you the time to get there.
  commander:{asset:"commander", melee:true, hero:true,
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
  // The spyglass rides on the arm bone so it swings with the hand rather than
  // floating beside the head. Long, light stride: the fastest cadence and the
  // most lean of anything you own, which is most of how the speed reads.
  scout:{ body:["torso","cape","belt","head","hat","crownH","horn","satch","sig"],
          arm:["arms","glass","lens"], armL:["arms"], leg:["legs"],
          gait:{swing:0.66, armK:0.30, cad:2.70, bob:0.062, lean:0.09, sway:0.08,
                reach:0.30, wind:0.30} },
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
// Names and one-line summaries live in the text table, and the table is live:
// re-reading them here means an edit in the Library's Text tab reaches the
// hotbar and the selection panels on the next sync rather than the next reload.
function syncText(){
  var i,t;
  for(i=0;i<CATS.length;i++){
    CATS[i].name=M.t("bld.cat."+CATS[i].id);
    CATS[i].note=M.t("bld.cat."+CATS[i].id+".note");
  }
  for(t in DIFF) DIFF[t].label=M.t("setup.diff."+t);
  for(t in TYPES) TYPES[t].name=M.t("bld."+t+".name");
  for(t in UNITS) UNITS[t].name=M.t("unit."+t+".name");
}
function syncStats(){
  var t,k,st;
  syncText();
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
// Difficulty sets the shape of the game, not just its numbers: how many nests
// ring you, and how many each one sends on the first night. The wave is the sum
// of what the living nests send, so pulling one down is a permanent cut to
// every night after — which is the whole reason to leave the walls.
// `send` is per nest per night one; `nests` is how many the map seeds.
var DIFF={
  easy  :{supply:60, nests:3, send:112, hp:36,
          mix:{shambler:0.76, runner:0.20, brute:0.04}},
  normal:{supply:45, nests:5, send:104, hp:42,
          mix:{shambler:0.66, runner:0.25, brute:0.09}},
  hard  :{supply:30, nests:8, send:98,  hp:46,
          mix:{shambler:0.58, runner:0.28, brute:0.14}}
};
// After DIFF, not before: syncText() names the difficulties out of the text
// table, and `for (t in undefined)` runs zero times without complaining — so a
// sync placed above this declaration would silently leave every label blank.
syncStats();
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
    turret:R.makeBatch(M.buildAsset("turret")),
    soldier:R.makeBatch(M.buildAsset("soldier")), archer:R.makeBatch(M.buildAsset("archer")),
    worker:R.makeBatch(M.buildAsset("worker")), cottage:R.makeBatch(M.buildAsset("cottage")),
    scout:R.makeBatch(M.buildAsset("scout")),
    commander:R.makeBatch(M.buildAsset("commander")),
    salvage:R.makeBatch(M.buildAsset("salvage")),
    nest:R.makeBatch(M.buildAsset("nest")),
    arrow:R.makeBatch(M.buildAsset("arrow"),false),
    // The three decals. They are batches like any other, but they are drawn in
    // their own blended pass — see DECALS below and the decal block in
    // d_gl.render — so they are the one group that must NOT be in BATCHES.
    marker:R.makeBatch(M.buildAsset("marker"),false,"add"),
    dshade:R.makeBatch(M.buildAsset("shadepatch"),false,"mul"),
    debris:R.makeBatch(M.buildAsset("spark"),false),
    corpse:R.makeBatch(M.buildAsset("corpse")),
    bolt :R.makeBatch(M.buildAsset("tracer"),false),
    spark:R.makeBatch(M.buildAsset("spark"),false),
    // The flat annulus asset is still in the Library to look at, but nothing
    // draws one any more: every ring in the game follows the ground now and is
    // made of ringchip segments. See groundRing().
    tile:R.makeBatch(M.meshTile(),false),
    rchip:R.makeBatch(M.buildAsset("ringchip"),false,"add"),
    grid :R.makeBatch(M.buildAsset("grid"),false,"add"),
    road :R.makeBatch(M.meshRoadPad(),false),
    site :R.makeBatch(M.buildAsset("site"))
  };
  // corpses first so living attackers and effects draw over them; a site is
  // ground clutter, so it sits with the salvage rather than with the buildings
  BATCHES=[B.road,B.corpse,B.salvage,B.site,B.hall,B.tower,B.ballista,B.brazier,
           B.barracks,B.archery,B.cottage,
           B.wall,B.wpost,B.gate,B.turret,
           B.nest,B.soldier,B.archer,B.worker,B.scout,B.commander,
           B.bolt,B.arrow,B.spark,B.debris,B.tile];
  // Drawn after everything solid, blended, and in this order: the shade is
  // taken out of the ground first so the light that follows lands on top of it.
  DECALS=[B.dshade,B.grid,B.rchip,B.marker];
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
           bolt:400,arrow:300,wall:1400,turret:200,soldier:120,archer:120,worker:120,
           scout:40, commander:8,
           marker:24,salvage:24,cottage:120,nest:24,site:600,road:5200,
           rchip:9000,dshade:3200};
  ["hall","tower","ballista","brazier","barracks","archery","cottage",
   "wall","wpost","gate","turret",
   "soldier","archer","worker","scout","commander","salvage","nest",
   "corpse","bolt","arrow","spark","debris","rchip","dshade","marker","tile","grid","site",
   "road"].forEach(function(k){
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
    // Roads are a graph in world space, not cells: nodes sit wherever the
    // player put them and edges run between them at any angle. Deliberately
    // NOT in S.cells — that is keyed by grid position and would quantise away
    // the only thing roads have that buildings do not.
    roadN:[], roadE:[], roadSeq:0, roadVer:0, roadDirty:true,
    // Which road is picked, and which one the cursor is over. Both are stored
    // as the pair of node ids rather than as the edge object: a guest rebuilds
    // S.roadE wholesale out of every snapshot, so a held reference would point
    // at a discarded object one packet later and the selection would vanish
    // for no visible reason.
    rsel:null, rhover:null,
    pathVer:0,                     // bumped whenever the walkable layout moves
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
  // A dark map with one lit man in it is correct and, on the first frame of a
  // round, unreadable — the player has not been given anything to decide with
  // yet. `grace` lights a patch around where he is standing; it ships at 0
  // because the answer chosen was "nothing but what you can see", and it is a
  // stat rather than a constant so that answer stays cheap to revisit.
  fogInit();
  var gr=+FOG().grace||0;
  if(gr>0){
    for(var gz=0;gz<M.GN;gz++) for(var gx=0;gx<M.GN;gx++)
      if(Math.hypot(M.gx2w(gx)-mySeat.cx,M.gx2w(gz)-mySeat.cz)<=gr) S.fog[gz*M.GN+gx]=1;
  }
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
  // This list is the SIXTH place a batch has to be registered, after B,
  // BATCHES, the buf list, CAP and the per-frame counter reset — and the only
  // one that fails at runtime rather than silently, because it dereferences
  // B[name] directly. Deleting the flat ring batch without deleting its line
  // here shipped a crash that only fires when the Library rebuilds assets,
  // which is a path only tools/text.mjs walks.
  [["hall","hall"],["tower","tower"],["wall","wall"],["gate","gate"],
   ["turret","turret"],
   ["bolt","tracer"],["rchip","ringchip"],["grid","grid"],["debris","spark"],
   ["wpost","wallpost"],["ballista","ballista"],["brazier","brazier"],
   ["corpse","corpse"],["spark","spark"],["nest","nest"],
   ["barracks","barracks"],["archery","archery"],
   ["soldier","soldier"],["archer","archer"],["worker","worker"],
   ["commander","commander"],
   ["cottage","cottage"],["salvage","salvage"],
   ["arrow","arrow"],["marker","marker"],["dshade","shadepatch"]]
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
// The one cell a building may be placed onto rather than beside.
function upgradable(c,p){
  var b=rootOf(c);
  return b.type==="wall" && !b.site && (b.own|0)===(p.id|0);
}
function canPlace(t,gx,gz,p){
  if(TYPES[t]&&TYPES[t].road) return false;   // roads are not cells; see queueRoad
  p=p||me();
  if(p.out) return false;
  if(t==="hall" && (p.hall||p.site)) return false;
  if(t==="hall" && !cmdOf(p)) return false;      // nobody left to raise it
  if(t!=="hall" && !p.hall) return false;
  if(TYPES[t].cost>p.supply) return false;
  var cs=footCells(t,gx,gz);
  for(var i=0;i<cs.length;i++){
    if(!inBuildZone(cs[i][0],cs[i][1],p)) return false;
    // A turret is the one thing that may be placed on something already there,
    // and only on a finished palisade of your own: it takes that cell over and
    // the run closes around it. Not a gate — a gate is a decision about where
    // the horde is invited through, and quietly replacing one would change the
    // shape of a defence the player thought they had.
    var occ=cellAt(cs[i][0],cs[i][1]);
    if(occ && !(t==="turret" && upgradable(occ,p))) return false;
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
  // A turret took whatever rotation the cursor happened to be holding, which is
  // why it sometimes faced the wrong way: the drum is symmetric so nobody
  // notices until the ladder ends up buried in the wall run. It faces ACROSS
  // the run — wallRot is along it — so the ladder and the loopholes always look
  // out from the line rather than into it.
  if(b.type==="turret") return wallRot(b.gx,b.gz)+Math.PI/2;
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
  // Take the old palisade out before the turret goes in, or its cells outlive
  // it in S.cells and the run draws an arm into a wall that is not there.
  if(t==="turret"){
    var oc=cellAt(gx,gz);
    if(oc){
      var ob=rootOf(oc);
      footCells(ob.type,ob.gx,ob.gz).forEach(function(cc){ delete S.cells[key(cc[0],cc[1])]; });
    }
  }
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
    // A hand-built type measures its work in worker-seconds under `build`
    // rather than wall-clock seconds under `raise`, because the two are not the
    // same number and calling both `raise` would make a turret look like it
    // takes nine seconds when it takes nine seconds of somebody's hands.
    var rz=TYPES[t].hand ? (+TYPES[t].build||0) : (+TYPES[t].raise||0);
    if(rz>0){
      b.site=true; b.prog=0; b.need=rz;
      b.hp=Math.max(1,Math.round(b.max*0.30));
    } else finishBuild(b);
  }
  S.distDirty=true; S.netCellsDirty=true; S.pathVer=(S.pathVer|0)+1;
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
  if(b.type==="turret") clearTurret(b,true);   // nobody is left standing on air
  footCells(b.type,b.gx,b.gz).forEach(function(cc){ delete S.cells[key(cc[0],cc[1])]; });
  if(p) p.supply+=Math.round(TYPES[b.type].cost*0.8);
  if(SND) SND.remove(M.gx2w(b.gx),M.gx2w(b.gz));
  S.distDirty=true; S.netCellsDirty=true; S.pathVer=(S.pathVer|0)+1;
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
// What a building keeps in its garrison: a list of kinds and how many of each.
// Every building but the hall musters one kind, which is all `spawns` and `cap`
// have ever meant; the hall musters two. Making the roster the general form and
// the single-kind case a roster of one is what keeps the retrain loop from
// growing a special case — it asks what the building is short of and does not
// care how many kinds the answer could have come from.
function rosterOf(t){
  var T=TYPES[t]; if(!T||!T.spawns) return null;
  var s=M.statsOf(t)||{};
  var out=[{t:T.spawns, n:s.cap|0}];
  if(T.also&&(s.scouts|0)>0) out.push({t:T.also, n:s.scouts|0});
  return out;
}
function countIn(b,kind){
  var n=0;
  for(var i=0;i<b.garrison.length;i++) if(b.garrison[i].t===kind) n++;
  return n;
}
// The kind this building owes, or null when its roster is full.
function shortOf(b){
  var r=rosterOf(b.type); if(!r) return null;
  for(var i=0;i<r.length;i++) if(countIn(b,r[i].t)<r[i].n) return r[i].t;
  return null;
}
function muster(b,kind){
  kind=kind||TYPES[b.type].spawns;
  var U=UNITS[kind];
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
  var r=rosterOf(b.type); if(!r) return;
  for(var i=0;i<r.length;i++)
    for(var j=countIn(b,r[i].t);j<r[i].n;j++) muster(b,r[i].t);
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
  S.distDirty=true; S.netCellsDirty=true; S.pathVer=(S.pathVer|0)+1;
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
  S.distDirty=true; S.netCellsDirty=true; S.pathVer=(S.pathVer|0)+1;
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
  S.distDirty=true; S.netCellsDirty=true; S.pathVer=(S.pathVer|0)+1;
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
// ---- the turret platform ---------------------------------------------------
// Distinct from shelter, which is workers hiding and doing nothing. A garrison
// is archers standing up top and shooting further, and the two must not share a
// flag: `inside` means invisible and inert, and an archer on a platform is
// neither. It gets `u.tur`, the turret it is standing on.
function turretOf(u){
  var t=u.tur;
  if(!t) return null;
  // the turret it remembers may have come down under it
  var c=S.cells[key(t.gx,t.gz)];
  if(!c||rootOf(c)!==t||t.site){ u.tur=null; return null; }
  return t;
}
function crewOf(b){
  var out=[];
  for(var i=0;i<S.units.length;i++) if(turretOf(S.units[i])===b) out.push(S.units[i]);
  return out;
}
// Only ranged units, because the whole benefit is range and a soldier up a
// tower is a soldier not blocking a lane.
function canCrew(u){ return !UNITS[u.t].civil && !UNITS[u.t].melee; }
function manTurret(list,b,net){
  if(!b||b.type!=="turret"||b.site) return 0;
  if(guest()&&!net) return intent({m:"tu",gx:b.gx,gz:b.gz,u:uids(list)});
  if((b.own|0)!==(list.length?(list[0].own|0):-1)) return 0;
  var cap=(M.statsOf("turret").cap|0), have=crewOf(b).length, n=0;
  for(var i=0;i<list.length&&have+n<cap;i++){
    var u=list[i];
    if(!canCrew(u)||(u.own|0)!==(b.own|0)||turretOf(u)===b) continue;
    u.tur=b; u.job=null; u.target=null; u.shelter=false; u.inside=false;
    n++;
  }
  if(n){
    if(SND) SND.order();
    if(UI.building) UI.building();
    if(UI.units) UI.units();
  }
  return n;
}
// Coming down is an order like any other, and it is also what happens when the
// turret does: see turretOf().
function clearTurret(b,net){
  if(!b) return 0;
  if(guest()&&!net) return intent({m:"td",gx:b.gx,gz:b.gz});
  var list=crewOf(b), i;
  for(i=0;i<list.length;i++){
    var u=list[i], d=doorOf(b,2.4);
    u.tur=null; u.x=d[0]; u.z=d[1]; u.px=u.x; u.pz=u.z; u.mode="idle";
  }
  if(list.length&&UI.building) UI.building();
  return list.length;
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
  // Road work outranks salvage, and a worker without a pile takes it too. It is
  // the one job in the game that only advances while somebody is standing on
  // it — every other site is a timer that runs whether anyone came or not — so
  // the whole cost of a road is the workers who are not gathering meanwhile.
  if(updateRoadwork(u,U,dt,op)) return;
  if(!u.job || u.job.amt<=0){
    u.job=null; u.mode="idle";
    stepPath(u,U,u.px,u.pz,0.18);
    return;
  }
  var U2=U;
  if(u.mode==="toNode"||u.mode==="idle"){
    if(stepVia(u,U2,u.job.x,u.job.z,1.15)) u.mode="gather";
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
    // The loaded leg routes too — it is the same job, and a road that only
    // helped the empty half would be half a road.
    var hx2=M.gx2w(op.hall.gx), hz2=M.gx2w(op.hall.gz);
    if(S.roadE.length&&Math.hypot(hx2-u.x,hz2-u.z)>standOff(op.hall)+1.2){
      if(!stepVia(u,U2,hx2,hz2,standOff(op.hall))) return;
    }
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
// ---- pathfinding ----------------------------------------------------------
// The horde runs a flow field seeded from the halls; your units cannot, because
// every order has its own destination. So this is an A* per order over the same
// cell grid, with a cost function that is deliberately NOT the horde's:
//
//   * a building blocks, a gate does not — the same rule solidAt() uses, so
//     what the path believes and what moveUnit() will allow cannot disagree
//   * a road cell is cheaper, so a route takes the road when the road is
//     genuinely quicker and ignores it when it is not
//
// This replaces the road-graph Dijkstra that shipped with roads. That searched
// a graph of tens of nodes and could only answer "is there a faster way along
// the road"; this answers that and "is there a way at all", which is the
// question a unit standing in front of a wall actually has.
//
// The horde's field is untouched. Roads must never enter it — a road that
// lowers path cost for attackers is a highway to your hall.
var roadMask=null, roadMaskVer=-1;
function roadMaskAt(gx,gz){
  // The road graph is free-angle and the grid is not, so this is an index over
  // the truth rather than the truth itself: it says "a road passes near this
  // cell", which is all the path search needs. roadSpeed() still does the exact
  // segment test, using this only as a cheap reject.
  if(roadMaskVer!==(S.roadVer|0)){
    roadMask=new Uint8Array(GN*GN);
    // Exactly the width roadSpeed() uses, with no padding. Marking a cell that
    // the road does not actually cover hands the search a discount the unit
    // will not receive, so a route would prefer a road it then walks beside.
    var R=ROAD(), w=(R.width===undefined?1.1:R.width);
    for(var e2=0;e2<S.roadE.length;e2++){
      var ed=S.roadE[e2];
      if(!ed.done) continue;
      var a=nodeById(ed.a), b=nodeById(ed.b);
      if(!a||!b) continue;
      var L=Math.hypot(b.x-a.x,b.z-a.z), steps=Math.max(1,Math.ceil(L/(M.CELL*0.5)));
      for(var q2=0;q2<=steps;q2++){
        var t2=q2/steps, px=a.x+(b.x-a.x)*t2, pz=a.z+(b.z-a.z)*t2;
        var cgx=M.w2gx(px), cgz=M.w2gx(pz);
        for(var ox=-1;ox<=1;ox++) for(var oz=-1;oz<=1;oz++){
          var mx=cgx+ox, mz=cgz+oz;
          if(mx<0||mz<0||mx>=GN||mz>=GN) continue;
          if(Math.hypot(M.gx2w(mx)-px,M.gx2w(mz)-pz)<=w) roadMask[mz*GN+mx]=1;
        }
      }
    }
    roadMaskVer=S.roadVer|0;
  }
  return roadMask[gz*GN+gx];
}
// A gate is yours to walk through; everything else you built is not. Kept in
// step with solidAt() on purpose — a path that routes through a cottage would
// walk a unit into it and leave it grinding on the wall forever.
function walkableCell(gx,gz){
  if(gx<0||gz<0||gx>=GN||gz>=GN) return false;
  var c=cellAt(gx,gz);
  if(!c) return true;
  return rootOf(c).type==="gate";
}
// Straight line clear of buildings? Sampled finely enough that it cannot step
// over a one-cell wall, which is the only kind this game has.
function losClear(ax,az,bx,bz){
  var d=Math.hypot(bx-ax,bz-az), n2=Math.ceil(d/(M.CELL*0.4));
  for(var i2=0;i2<=n2;i2++){
    var t3=n2?i2/n2:0;
    if(solidAt(ax+(bx-ax)*t3, az+(bz-az)*t3)) return false;
  }
  return true;
}
var PATH_CAP=9000;                       // nodes visited before we give up
function findPath(sx,sz,tx,tz){
  var s0x=M.w2gx(sx), s0z=M.w2gx(sz), t0x=M.w2gx(tx), t0z=M.w2gx(tz);
  if(s0x===t0x&&s0z===t0z) return null;                  // same cell: just walk
  // A clear line is only the answer when there is nothing that could beat it.
  // With a road on the map there might be, and skipping the search here is what
  // made roads invisible to routing on open ground — which is almost all of it.
  var anyRoad=false;
  for(var r0=0;r0<S.roadE.length;r0++) if(S.roadE[r0].done){ anyRoad=true; break; }
  if(!anyRoad && losClear(sx,sz,tx,tz)) return null;     // nothing in the way
  // A destination inside a building is a click on a building. Walking at it is
  // the right behaviour — the unit stops against the wall — so do not path.
  if(!walkableCell(t0x,t0z)) return null;
  // Standing inside one is the mirror case: a unit caught under a building that
  // went up around it. A* cannot leave a blocked cell, and it should not try —
  // moveUnit()'s "already stuck: let it out" is what gets a unit free, and it
  // only works if we hand control back rather than searching from nowhere.
  if(!walkableCell(s0x,s0z)) return null;
  var R=ROAD(), roadK=Math.max(0.05,1/(1+(R.speed===undefined?0.55:R.speed)));
  var N=GN, g=new Float64Array(N*N); g.fill(Infinity);
  var came=new Int32Array(N*N); came.fill(-1);
  var open=[], on=0, seen=new Uint8Array(N*N), visited=0;
  function h(x,z){                                        // octile, admissible
    var dx=Math.abs(x-t0x), dz=Math.abs(z-t0z);
    return (dx>dz) ? dx+0.414*dz : dz+0.414*dx;
  }
  function push(i,f){
    open[on]={i:i,f:f}; var c=on++;
    while(c>0){ var p=(c-1)>>1; if(open[p].f<=open[c].f) break;
      var t=open[p];open[p]=open[c];open[c]=t;c=p; }
  }
  function pop(){
    var top=open[0]; open[0]=open[--on]; open.length=on;
    var c=0;
    for(;;){ var l=c*2+1,r=l+1,sm=c;
      if(l<on&&open[l].f<open[sm].f)sm=l;
      if(r<on&&open[r].f<open[sm].f)sm=r;
      if(sm===c)break; var t=open[sm];open[sm]=open[c];open[c]=t;c=sm; }
    return top;
  }
  var si=s0z*N+s0x, ti=t0z*N+t0x;
  g[si]=0; push(si,h(s0x,s0z));
  var DX=[1,-1,0,0,1,1,-1,-1], DZ=[0,0,1,-1,1,-1,1,-1];
  var found=false;
  while(on>0){
    var cur=pop(), ci=cur.i;
    if(seen[ci]) continue;
    seen[ci]=1;
    if(++visited>PATH_CAP) break;
    if(ci===ti){ found=true; break; }
    var cx=ci%N, cz=(ci-cx)/N;
    for(var k=0;k<8;k++){
      var nx=cx+DX[k], nz=cz+DZ[k];
      if(!walkableCell(nx,nz)) continue;
      // no cutting a diagonal past a corner: both orthogonals must be open, or
      // a unit clips the corner of a building and jams on it
      if(k>=4 && (!walkableCell(cx+DX[k],cz) || !walkableCell(cx,cz+DZ[k]))) continue;
      var ni=nz*N+nx;
      if(seen[ni]) continue;
      var step=(k<4?1:1.414)*(roadMaskAt(nx,nz)?roadK:1);
      var ng=g[ci]+step;
      if(ng<g[ni]-1e-9){ g[ni]=ng; came[ni]=ci; push(ni,ng+h(nx,nz)); }
    }
  }
  if(!found) return null;
  var pts=[], node=ti, guard=0;
  while(node!==-1&&node!==si&&guard++<N*N){
    var px2=node%N, pz2=(node-px2)/N;
    pts.unshift({x:M.gx2w(px2), z:M.gx2w(pz2)});
    node=came[node];
  }
  if(!pts.length) return null;
  pts[pts.length-1]={x:tx,z:tz};                          // land on the real spot
  return pullString(sx,sz,pts);
}
// What a straight walk between two points really costs, roads included. This
// is the same currency findPath() minimises in, so the two cannot disagree.
function segCost(ax,az,bx,bz){
  var R=ROAD(), roadK=Math.max(0.05,1/(1+(R.speed===undefined?0.55:R.speed)));
  var d=Math.hypot(bx-ax,bz-az), n2=Math.max(1,Math.ceil(d/(M.CELL*0.5))), c=0;
  for(var i2=0;i2<n2;i2++){
    var t3=(i2+0.5)/n2, px=ax+(bx-ax)*t3, pz=az+(bz-az)*t3;
    var gx=M.w2gx(px), gz=M.w2gx(pz);
    var on=(gx>=0&&gz>=0&&gx<GN&&gz<GN)?roadMaskAt(gx,gz):0;
    c+=(d/n2)*(on?roadK:1);
  }
  return c;
}
// Raw A* output is a staircase across cell centres: robotic to walk and longer
// than it needs to be. So drop every waypoint that can be skipped — but skip on
// COST, not on line of sight.
//
// Line of sight only knows about buildings. On open ground every shortcut is
// "clear", so a path that had carefully routed along a road collapsed straight
// back to the direct line and threw the road away. Comparing cost instead means
// a shortcut is taken when it is genuinely quicker and refused when it would
// step off a road to save distance it does not have.
function pullString(sx,sz,pts){
  var out=[], cx=sx, cz=sz, i=0;
  while(i<pts.length){
    var j=pts.length-1;
    for(;j>i;j--){
      if(!losClear(cx,cz,pts[j].x,pts[j].z)) continue;
      var direct=segCost(cx,cz,pts[j].x,pts[j].z), legs=0, ax=cx, az=cz;
      for(var k2=i;k2<=j;k2++){ legs+=segCost(ax,az,pts[k2].x,pts[k2].z);
                                ax=pts[k2].x; az=pts[k2].z; }
      if(direct<=legs+1e-6) break;              // genuinely no worse: take it
    }
    if(j<=i) j=i;                               // nothing better than the next step
    out.push(pts[j]); cx=pts[j].x; cz=pts[j].z; i=j+1;
  }
  return out;
}
// Give a unit a route to a point. Null path means "walk straight at it", which
// is both the common case and the fallback when no route exists.
function pathTo(u,tx,tz){
  u.path=findPath(u.x,u.z,tx,tz);
  u.pathI=0;
  u.pathVer=(S.roadVer|0)^((S.pathVer|0)<<8);
  u.pathTo=[tx,tz];
}
// Follow it. Returns true on arrival, exactly like stepToward, so every caller
// keeps its shape.
//
// The throttle is not an optimisation, it is the difference between working and
// hanging. An earlier version re-planned whenever the unit could not see its
// next waypoint, which is true every frame for a unit pressed against the
// corner it is rounding — so it ran a full A* per unit per frame and the game
// stopped. Re-plan on three things only: the destination moved, the layout
// changed under the route, or the unit has genuinely stopped making progress.
function stepPath(u,U,tx,tz,stop){
  var ver=(S.roadVer|0)^((S.pathVer|0)<<8);
  var moved=!u.pathTo||Math.abs(u.pathTo[0]-tx)>0.5||Math.abs(u.pathTo[1]-tz)>0.5;
  if(u.pathCd>0) u.pathCd-=dt_;
  // progress watchdog: local steering handles a corner, but a unit that has not
  // moved in three quarters of a second is wedged and wants a new route
  var d2=(u.ppx===undefined)?1:((u.x-u.ppx)*(u.x-u.ppx)+(u.z-u.ppz)*(u.z-u.ppz));
  u.ppx=u.x; u.ppz=u.z;
  u.pathStuck = (d2<1e-6) ? (u.pathStuck||0)+dt_ : 0;
  var wedged=u.pathStuck>0.75;
  if(moved || u.pathVer!==ver || (wedged&&!(u.pathCd>0))){
    pathTo(u,tx,tz);
    u.pathCd=0.5; u.pathStuck=0;
  }
  var p=u.path;
  if(!p||u.pathI>=p.length) return stepToward(u,U,tx,tz,stop);
  var w=p[u.pathI];
  // Waypoints are corners, so arriving near one is arriving. A tight radius
  // makes a unit orbit the corner it is trying to round.
  while(u.pathI<p.length-1 && Math.hypot(w.x-u.x,w.z-u.z)<=0.6){
    u.pathI++; w=p[u.pathI];
  }
  var last=(u.pathI===p.length-1);
  var here=stepToward(u,U,w.x,w.z,last?stop:0.15);
  return last&&here;
}
// Kept as the name the worker code and the road tests already call. Roads are
// now just cheap cells to the search, so there is nothing separate to do.
function stepVia(u,U,tx,tz,stop){ return stepPath(u,U,tx,tz,stop); }

// ---- road work ------------------------------------------------------------
// Returns true when the worker is busy laying road and nothing else should run.
//
// A worker claims the nearest unbuilt edge belonging to its own player, walks
// to the point on that edge nearest itself — not to an end, so a crew spreads
// along a long run instead of queueing at one stake — and only then does the
// progress move. Several workers on one edge finish it proportionally faster,
// which is the whole reason to pull a crew off salvage.
// Same shape as the road below it: walk to it, and only then does the work
// move. Standing somewhere else does nothing at all, which is the whole point.
function updateSiteWork(u,U,dt,job){
  if(u.carry>0) return false;               // finish the delivery first
  u.job=null;
  u.mode="road";
  if(!stepToBuilding(u,U,job.b,0.35)) return true;
  u.rot=Math.atan2(job.z-u.z,job.x-u.x);
  if(u.atk<0) u.atk=0;
  job.b.prog+=dt;
  job.b.hp=Math.min(job.b.max, job.b.hp+job.b.max*dt/Math.max(0.001,job.b.need));
  if(Math.random()<dt*1.8)
    spark(job.x+(Math.random()-0.5)*1.2, gy(job.x,job.z)+0.7, job.z+(Math.random()-0.5)*1.2,
          1,[0.78,0.72,0.60],0.6,1.2,0.22,0.45);
  if(job.b.prog>=job.b.need) finishBuild(job.b);
  return true;
}
function nearestRoadwork(u,pid){
  var best=null, bd=1e9;
  for(var i=0;i<S.roadE.length;i++){
    var e=S.roadE[i];
    if(e.done||(e.own|0)!==(pid|0)) continue;
    var a=nodeById(e.a), b=nodeById(e.b);
    if(!a||!b) continue;
    var q=segNear(u.x,u.z,a.x,a.z,b.x,b.z);
    if(q.d<bd){ bd=q.d; best={e:e,x:q.x,z:q.z,d:q.d}; }
  }
  return best;
}
// Hand-built sites, alongside road edges. Two kinds of job, one queue: a worker
// takes whichever is nearest, so a turret does not sit unbuilt because a road
// happened to be asked for first. The turret is the second thing in the game
// that a timer will not finish, and generalising here rather than adding a
// parallel loop is what keeps "does this need a worker" a property of the type
// instead of a place in the code.
function nearestHandSite(u,pid){
  var best=null, bd=1e9;
  for(var k in S.cells){
    var b=S.cells[k];
    if(b.ref||!b.site||(b.own|0)!==(pid|0)||!TYPES[b.type].hand) continue;
    var bx=M.gx2w(b.gx), bz=M.gx2w(b.gz);
    var d=Math.hypot(bx-u.x,bz-u.z);
    if(d<bd){ bd=d; best={b:b, x:bx, z:bz, d:d}; }
  }
  return best;
}
function updateRoadwork(u,U,dt,op){
  var site=nearestHandSite(u,u.own|0);
  var job=S.roadE.length?nearestRoadwork(u,u.own|0):null;
  if(site&&(!job||site.d<job.d)) return updateSiteWork(u,U,dt,site);
  if(!job){ if(u.mode==="road") u.mode="idle"; return false; }
  // Carrying a load? Finish the delivery first. Dropping salvage on the ground
  // to go and dig is the kind of "helpful" reshuffle that loses a player's
  // afternoon of hauling.
  if(u.carry>0) return false;
  u.job=null;
  u.mode="road";
  if(!stepToward(u,U,job.x,job.z,0.35)) return true;
  u.rot=Math.atan2(job.z-u.z,job.x-u.x);
  if(u.atk<0) u.atk=0;
  job.e.prog+=dt;
  if(Math.random()<dt*1.6)
    spark(job.x,PLAT+0.25,job.z,1,[0.72,0.66,0.54],0.6,1.1,0.22,0.4);
  if(job.e.prog>=job.e.need){
    job.e.prog=job.e.need;
    job.e.done=true;
    S.roadDirty=true; S.roadVer++;   // a finished edge changes every cached route
    if(SND&&(u.own|0)===S.me) SND.place(job.x,job.z);
  }
  return true;
}

// Walk at a building until you are standing against it. Collision keeps the
// unit out of the walls, so aiming straight at the middle is safe.
function stepToBuilding(u,U,b,margin){
  margin=(margin===undefined)?TOUCH:margin;
  if(boxDist(u.x,u.z,b)<=margin) return true;
  var bx=M.gx2w(b.gx), bz=M.gx2w(b.gz);
  var dx=bx-u.x, dz=bz-u.z, L=Math.hypot(dx,dz)||1;
  var sp=U.speed*roadSpeed(u.x,u.z)*dt_;
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
    stepPath(u,U,u.px,u.pz,0.18);
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
    stepPath(u,U,u.px,u.pz,0.18);
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
  // The road bonus lives here and in stepToBuilding, and nowhere else. Both are
  // reached only from the player's own unit code — the horde walks in its own
  // loop off m.spd and never consults this, which is the whole of "the speed
  // is yours alone".
  var sp=U.speed*roadSpeed(u.x,u.z)*dt_, k=Math.min(sp,L-stop);
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

    // On a platform: it does not move, it does not chase, and it shoots
    // further. Everything below that depends on walking is skipped rather than
    // given a special case, because a unit that is standing on a building has
    // no post to return to and no leash to run out.
    var TUR=turretOf(u);
    if(TUR){
      u.x=M.gx2w(TUR.gx); u.z=M.gx2w(TUR.gz); u.px=u.x; u.pz=u.z;
      u.shelter=false; u.inside=false;
    }
    var turBonus = TUR ? (+M.statsOf("turret").range||0) : 0;
    // acquire: hold stays near the post, pursue reaches a full leash further
    var lead = TUR ? 0 : ((stanceOf(u.own)==="hold") ? Math.min(U.leash,2.4) : U.leash);
    var scan = U.melee ? (U.reach+lead) : (U.range+turBonus);
    var tgt = (u.target&&u.target.hp>0) ? u.target : nearestEnemy(u.px,u.pz,scan+0.6);
    if(!tgt) tgt=nearestNest(u.px,u.pz,scan+2.6);   // march them out and they bite
    if(tgt && Math.hypot(tgt.x-u.px,tgt.z-u.pz) > scan+(tgt.nest?3.4:1.4)) tgt=null;
    u.target=tgt;

    var mx=u.px, mz=u.pz, engaging=false;
    if(tgt){
      var d=Math.hypot(tgt.x-u.x,tgt.z-u.z);
      var strike = U.melee ? U.reach : (U.range+turBonus);
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

    // Closing on something is a heading; marching to a post is a route. The
    // difference matters: a target moves every frame and is a few units away,
    // so re-planning at it would be a search per soldier per frame for no gain,
    // while a soldier sent to the far side of a wall has to find the gate
    // rather than lean on the stones. This loop used to do the first for both,
    // which is why an ordered squad could not get out of a walled yard.
    if(TUR){
      gaitStep(u,gx0,gz0);            // still animates, just never goes anywhere
      continue;
    }
    if(engaging){
      var dx=mx-u.x, dz=mz-u.z, L=Math.hypot(dx,dz);
      var stop=(U.melee?U.reach*0.85:U.range*0.9);
      if(L>stop){
        var sp=U.speed*dt, k=Math.min(sp,L);
        moveUnit(u, u.x+dx/L*k, u.z+dz/L*k);
      }
    } else {
      stepPath(u,U,mx,mz,0.16);
    }
    gaitStep(u,gx0,gz0);
  }

  // materials become buildings. The hall is not in here: it waits on the
  // commander's hands rather than on the clock.
  for(var sk in S.cells){
    var sb=S.cells[sk];
    // The hall waits on the commander's hands; a hand-built site waits on a
    // worker's. Everything else is a timer that runs whether anybody came.
    if(sb.ref||!sb.site||sb.type==="hall"||TYPES[sb.type].hand) continue;
    sb.prog+=dt;
    if(sb.prog>=sb.need) finishBuild(sb);
  }

  // barracks retrain their losses, but only while they are standing
  for(var k in S.cells){
    var b=S.cells[k];
    if(b.ref||b.site||!b.garrison) continue;
    var want=shortOf(b);
    if(!want){ b.trainCd=0; continue; }
    // the clock starts when the loss happens, so a replacement always costs the
    // full retrain time rather than arriving on the same frame
    if(b.trainCd<=0) b.trainCd=TYPES[b.type].retrain;
    b.trainCd-=dt;
    if(b.trainCd<=0){
      b.trainCd=0;
      muster(b,want);
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
// ---- what you can see ------------------------------------------------------
// The minimap used to draw every attacker on the map unconditionally, which
// meant a scout could not tell you anything you did not already know. Now
// everything you own has a `sight` in the balance table and the minimap only
// marks what somebody is looking at.
//
// Deliberately narrow: this hides ATTACKERS and nothing else. Nests, salvage,
// terrain and your own buildings stay on the map, because the map itself is
// known ground — a settlement knows where the hills and the nests are. It is
// where the horde is right now that you have to earn.
//
// A grid rather than a distance test per enemy per watcher: a late night is
// ~800 attackers against ~40 watchers, and 32,000 hypots several times a second
// to draw a 150-pixel canvas is not a trade worth making. Stamping discs into a
// byte grid is ~4,000 writes and the lookup is one index.
// What you have ever seen, one byte per cell, for the seat sitting at this
// screen. Deliberately NOT in the snapshot: each side accumulates its own from
// the units and buildings it already receives, so fog costs the network nothing
// and a guest's memory is genuinely its own rather than a copy of the host's.
// It is also why this is keyed to S.me and not to a player id — it is what this
// screen has been shown, which is a property of the screen.
function fogInit(){
  S.fog=new Uint8Array(M.GN*M.GN);
  S.fogTex=new Uint8Array(M.GN*M.GN);
  S.fogT=0;
}
function FOG(){ return M.statsOf("fog")||{}; }
// Fold this instant's sight into the memory, and build the byte the renderer
// samples: 0 never seen, 128 seen before, 255 in sight now.
function fogStep(){
  if(!S.fog) fogInit();
  var mask=visionMask(S.me|0), i, n=S.fog.length;
  for(i=0;i<n;i++){
    if(mask[i]) S.fog[i]=1;
    S.fogTex[i]=mask[i] ? 255 : (S.fog[i] ? 128 : 0);
  }
  return S.fogTex;
}
// 0 never seen, 1 seen before, 2 in sight now — by world position, for the
// draw code. Reads the same byte the shader is handed, so what is culled and
// what is dimmed can never disagree.
function lookingAt(x,z){
  if(!S.fogTex) return 2;
  var gx=M.w2gx(x), gz=M.w2gx(z);
  if(gx<0||gz<0||gx>=M.GN||gz>=M.GN) return 0;
  var v=S.fogTex[gz*M.GN+gx];
  return v===255?2:(v?1:0);
}
var seeMask=null, seeOwn=-1;
function visionMask(pid){
  pid=pid|0;
  var N=M.GN;
  if(!seeMask||seeMask.length!==N*N) seeMask=new Uint8Array(N*N);
  else seeMask.fill(0);
  seeOwn=pid;
  var i;
  function stamp(x,z,r){
    if(!(r>0)) return;
    var g0x=M.w2gx(x-r), g1x=M.w2gx(x+r), g0z=M.w2gx(z-r), g1z=M.w2gx(z+r);
    if(g0x<0) g0x=0; if(g0z<0) g0z=0;
    if(g1x>=N) g1x=N-1; if(g1z>=N) g1z=N-1;
    var r2=r*r;
    for(var gz=g0z;gz<=g1z;gz++){
      var wz=M.gx2w(gz), dz=wz-z;
      for(var gx=g0x;gx<=g1x;gx++){
        var dx=M.gx2w(gx)-x;
        if(dx*dx+dz*dz<=r2) seeMask[gz*N+gx]=1;
      }
    }
  }
  for(i=0;i<S.units.length;i++){
    var u=S.units[i];
    if((u.own|0)!==pid||u.inside||u.hp<=0) continue;
    stamp(u.x,u.z,(M.statsOf(u.t)||{}).sight||0);
  }
  for(var k in S.cells){
    var c=S.cells[k];
    if(c.ref||(c.own|0)!==pid) continue;
    // A site is a heap of materials. It does not shoot, house, light or accept
    // repair, and it does not keep watch either.
    if(c.site) continue;
    stamp(M.gx2w(c.gx),M.gx2w(c.gz),(M.statsOf(c.type)||{}).sight||0);
  }
  return seeMask;
}
// Cheap enough to call per enemy once the mask is built for this frame.
function seenAt(mask,x,z){
  var gx=M.w2gx(x), gz=M.w2gx(z);
  if(gx<0||gz<0||gx>=M.GN||gz>=M.GN) return false;
  return !!mask[gz*M.GN+gx];
}
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
// ===========================================================================
// Roads
// ===========================================================================
// A node-and-edge graph in world space. Nodes are free positions; an edge is
// two node ids plus how much of it has been built. Nothing here touches
// S.cells, the flow field, or S.distDirty — a road changes how fast your own
// units cross ground, never where anything decides to go.
function ROAD(){ return M.statsOf("road")||{}; }
// A stable value in [0,1) for one pad of one edge. Everything that makes a road
// look worn is derived from this rather than from Math.random(), because the
// draw runs every frame: fresh noise per frame would make the whole network
// crawl, which reads as deliberate in a screenshot and as a bug in motion.
function padHash(a,b,i,salt){
  var h=(a*73856093)^(b*19349663)^(i*83492791)^(salt*2654435761);
  h=Math.imul(h^(h>>>13),1274126177);
  h=h^(h>>>16);
  return (h>>>0)/4294967296;
}
function roadNode(x,z){
  var R=ROAD(), snap=(R.snap===undefined?2.4:R.snap);
  // Snap first: an endpoint a fraction of a unit from an existing node looks
  // joined and is not, and a route that looks connected but is not will not
  // route. Reusing the node IS the network.
  var best=null, bd=snap*snap;
  for(var i=0;i<S.roadN.length;i++){
    var n=S.roadN[i], d=(n.x-x)*(n.x-x)+(n.z-z)*(n.z-z);
    if(d<=bd){ bd=d; best=n; }
  }
  if(best) return best;
  var mk={id:++S.roadSeq, x:x, z:z};
  S.roadN.push(mk);
  return mk;
}
function nodeById(id){
  for(var i=0;i<S.roadN.length;i++) if(S.roadN[i].id===id) return S.roadN[i];
  return null;
}
// Where a drag endpoint really lands: an existing node wins, then a building's
// centre, then a salvage pile. Those three are the things worth connecting, so
// they are what a road reaches for rather than the bare cursor position.
function roadAnchor(x,z){
  var R=ROAD(), snap=(R.snap===undefined?2.4:R.snap), s2=snap*snap;
  var best=null, bd=s2, i;
  for(i=0;i<S.roadN.length;i++){
    var n=S.roadN[i], d=(n.x-x)*(n.x-x)+(n.z-z)*(n.z-z);
    if(d<=bd){ bd=d; best={x:n.x,z:n.z,kind:"node"}; }
  }
  if(best) return best;
  for(var k in S.cells){
    var c=S.cells[k];
    if(c.ref) continue;
    var bx=M.gx2w(c.gx), bz=M.gx2w(c.gz), db=(bx-x)*(bx-x)+(bz-z)*(bz-z);
    if(db<=bd){ bd=db; best={x:bx,z:bz,kind:"building"}; }
  }
  for(i=0;i<S.nodes.length;i++){
    var p=S.nodes[i];
    if(p.amt<=1) continue;
    var dp=(p.x-x)*(p.x-x)+(p.z-z)*(p.z-z);
    if(dp<=bd){ bd=dp; best={x:p.x,z:p.z,kind:"pile"}; }
  }
  return best||{x:x,z:z,kind:"open"};
}
function edgeLen(e){
  var a=nodeById(e.a), b=nodeById(e.b);
  if(!a||!b) return 0;
  return Math.hypot(b.x-a.x,b.z-a.z);
}
// Why a drag is refused, in words the caller can show. Null means it is fine.
function roadRefusal(ax,az,bx,bz){
  var R=ROAD(), L=Math.hypot(bx-ax,bz-az);
  if(L<(R.minLen===undefined?2:R.minLen)) return "bld.road.tooshort";
  if(L>(R.maxLen===undefined?26:R.maxLen)) return "bld.road.toolong";
  return null;
}
// The player-facing entry point, and the only one input calls. Same shape as
// place(): a guest asks and the host answers with the next snapshot.
function queueRoad(ax,az,bx,bz,pid){
  if((pid===undefined||pid===null)&&guest())
    return intent({m:"rd",ax:r2(ax),az:r2(az),bx:r2(bx),bz:r2(bz)});
  var p=(pid===undefined||pid===null)?me():S.players[pid];
  if(!p||p.out||!p.hall) return false;
  var e=addRoad(ax,az,bx,bz,p.id);
  if(e&&SND&&p.id===S.me) SND.place(ax,az);
  return !!e;
}
function addRoad(ax,az,bx,bz,own){
  if(roadRefusal(ax,az,bx,bz)) return null;
  var a=roadNode(ax,az), b=roadNode(bx,bz);
  if(a===b) return null;
  for(var i=0;i<S.roadE.length;i++){
    var e=S.roadE[i];
    if((e.a===a.id&&e.b===b.id)||(e.a===b.id&&e.b===a.id)) return e;  // already there
  }
  var R=ROAD(), len=Math.hypot(b.x-a.x,b.z-a.z);
  var mk={a:a.id, b:b.id, prog:0, need:len*(R.build===undefined?2.6:R.build),
          done:false, own:own|0};
  S.roadE.push(mk);
  S.roadDirty=true; S.roadVer++;
  return mk;
}
// ---- picking a road, and calling it off ------------------------------------
// An edge is named by its endpoints everywhere outside S.roadE itself. See the
// note on S.rsel: the guest throws its edge objects away every snapshot.
function edgeAB(a,b){
  for(var i=0;i<S.roadE.length;i++){
    var e=S.roadE[i];
    if((e.a===a&&e.b===b)||(e.a===b&&e.b===a)) return e;
  }
  return null;
}
function selRoad(){ return (S&&S.rsel)?edgeAB(S.rsel.a,S.rsel.b):null; }
// The edge under a world point, yours only. The pick radius is wider than the
// road because a staked-out road is a dotted line on open ground, and asking a
// player to hit a line with a mouse in an isometric view is asking too much.
function roadAt(x,z){
  var R=ROAD(), w=(R.width===undefined?1.1:R.width)+0.7;
  var best=null, bd=w;
  for(var i=0;i<S.roadE.length;i++){
    var e=S.roadE[i];
    if((e.own|0)!==(S.me|0)) continue;
    var a=nodeById(e.a), b=nodeById(e.b);
    if(!a||!b) continue;
    var q=segNear(x,z,a.x,a.z,b.x,b.z);
    if(q.d<bd){ bd=q.d; best=e; }
  }
  return best;
}
function selectRoad(e){
  if(!S) return null;
  S.rsel=(e&&(e.own|0)===(S.me|0))?{a:e.a,b:e.b}:null;
  if(S.rsel) S.bsel=null;             // one subject at a time; they share a panel
  if(UI.building) UI.building();
  return selRoad();
}
// How many of your workers are actually on this edge right now. The player is
// deciding whether to call it off, and "three workers are on it" is the fact
// that decides it — a road nobody has reached is free to abandon.
// Counted off position rather than off u.mode, which is not in the snapshot:
// reading the mode would make this correct on the host and permanently zero on
// the guest. Standing on an unbuilt edge is what makes it advance anyway, so
// the position IS the answer to "who is laying this".
function roadCrew(e){
  if(!e||e.done) return 0;
  var a=nodeById(e.a), b=nodeById(e.b), n=0;
  if(!a||!b) return 0;
  for(var i=0;i<S.units.length;i++){
    var u=S.units[i];
    if(!UNITS[u.t].civil||(u.own|0)!==(e.own|0)||u.inside) continue;
    if(segNear(u.x,u.z,a.x,a.z,b.x,b.z).d<0.9) n++;
  }
  return n;
}
// The counterpart to queueRoad, and the same act whether the stakes are fresh
// or the surface is laid: a road costs no supply, so there is nothing to refund
// and nothing to weigh up. What it cost was worker hours, and those are spent
// either way — which is exactly why calling one off has to be possible without
// a confirmation dance.
function cancelRoad(a,b,pid){
  if(!playable()) return false;
  if((pid===undefined||pid===null)&&guest()) return intent({m:"rx",a:a|0,b:b|0});
  var e=edgeAB(a|0,b|0);
  if(!e) return false;
  var who=(pid===undefined||pid===null)?S.me:pid;
  if((e.own|0)!==(who|0)) return false;                  // not yours
  var na=nodeById(e.a), nb=nodeById(e.b);
  S.roadE.splice(S.roadE.indexOf(e),1);
  pruneRoadNodes();
  if(S.rsel&&edgeAB(S.rsel.a,S.rsel.b)===null) S.rsel=null;
  S.rhover=null;
  // Any worker who was laying it needs a new job this frame, and every cached
  // route was costed against a network that no longer contains this.
  for(var i=0;i<S.units.length;i++) if(S.units[i].mode==="road") S.units[i].mode="idle";
  S.roadDirty=true; S.roadVer++; S.pathVer=(S.pathVer|0)+1;
  if(SND&&na&&nb&&who===S.me) SND.remove((na.x+nb.x)/2,(na.z+nb.z)/2);
  if(UI.building) UI.building();
  return true;
}
// A node only means anything as the end of an edge. One with nothing left on it
// is not just litter — it still snaps, so the next road you drew would be
// quietly dragged to a junction that is no longer there.
function pruneRoadNodes(){
  var used={};
  for(var i=0;i<S.roadE.length;i++){ used[S.roadE[i].a]=1; used[S.roadE[i].b]=1; }
  for(var j=S.roadN.length-1;j>=0;j--) if(!used[S.roadN[j].id]) S.roadN.splice(j,1);
}
// Distance from a point to a segment, and how far along it that lands. Used
// both for "am I on a road" and for finding the nearest point to walk to.
function segNear(px,pz,ax,az,bx,bz){
  var dx=bx-ax, dz=bz-az, L2=dx*dx+dz*dz;
  var t=L2>0?((px-ax)*dx+(pz-az)*dz)/L2:0;
  t=t<0?0:(t>1?1:t);
  var qx=ax+dx*t, qz=az+dz*t;
  return {d:Math.hypot(px-qx,pz-qz), t:t, x:qx, z:qz};
}
// The speed multiplier at a point: 1 off-road, 1+speed on a finished one.
// Only ever called for the player's own units — the attacker loop does not
// consult it, which is the whole of "the horde gets nothing".
function roadSpeed(x,z){
  if(!S.roadE.length) return 1;
  var R=ROAD(), w=(R.width===undefined?1.1:R.width);
  for(var i=0;i<S.roadE.length;i++){
    var e=S.roadE[i];
    if(!e.done) continue;
    var a=nodeById(e.a), b=nodeById(e.b);
    if(!a||!b) continue;
    if(segNear(x,z,a.x,a.z,b.x,b.z).d<=w) return 1+(R.speed===undefined?0.55:R.speed);
  }
  return 1;
}
// What one nest sends tonight: its share of the night, ramping as the nights
// go on, and pushed harder still by every sibling you have already pulled down.
//
// That last term is the difference between a campaign and a victory lap. Kill a
// nest and its share is gone for good — that is the payoff for marching out —
// but with nothing else in play, clearing two of five caps every night after at
// 60% of what it was, and a run gets quieter the closer it comes to winning.
// `spite` claws part of that back: at 0.5 a two-nest clear leaves the survivors
// sending about 77% rather than 60%, so the cut is real but the curve does not
// flatten. At 1.0 it would cancel the cut exactly and clearing would stop
// mattering, which is the opposite failure.
function nestSend(night){
  var ramp=(NEST.ramp===undefined?1.28:NEST.ramp);
  var base=(S.send||104)*Math.pow(ramp,Math.max(0,(night||1)-1));
  return Math.max(1,Math.round(base*spiteK()));
}
// Nests are seeded once and never added to, so the roster is the denominator.
// Guarded rather than assumed: waveSize() is read by the HUD before a round has
// a map, and pow(0/0) would put NaN on screen rather than a number.
function spiteK(){
  var k=(NEST.spite===undefined?0.5:NEST.spite);
  if(!k||!S.nests||!S.nests.length) return 1;
  var live=liveNests().length;
  if(live<1||live>=S.nests.length) return 1;
  return Math.pow(S.nests.length/live,k);
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
    // The platform is gone, so its archers are on the ground — hurt, in the
    // open, and exactly where the thing that killed the turret is standing.
    // That is the counterplay to a garrison being unreachable.
    if(b.type==="turret") clearTurret(b,true);
    if(S.bsel===b) S.bsel=null;
    footCells(b.type,b.gx,b.gz).forEach(function(c){ delete S.cells[key(c[0],c[1])]; });
    S.distDirty=true; S.netCellsDirty=true; S.pathVer=(S.pathVer|0)+1;
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
      // Nothing on a platform is reachable from the ground. The horde is
      // entirely melee today, so in practice a garrison is safe — but the rule
      // is "you cannot reach it", not "it cannot be hurt", so a ranged attacker
      // added later shoots at it without anything here changing.
      if(fu.hp<=0||fu.inside||fu.tur) continue;
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
    // The host re-snaps the guest's endpoints against its own graph rather than
    // trusting the ones sent: the two sides can disagree about what existed
    // when the drag started, and only one of them is authoritative.
    case "rd": queueRoad(msg.ax,msg.az,msg.bx,msg.bz,pid); break;
    // Named by node id, not by index: the two sides agree on ids because the
    // host authors them and the snapshot carries them, and an index would mean
    // a guest cancelling whichever road happened to slide into that slot.
    case "rx": cancelRoad(msg.a|0,msg.b|0,pid); break;
    case "tu":
      var tb=rootOf(cellAt(msg.gx|0,msg.gz|0));
      if(tb&&(tb.own|0)===pid) manTurret(byUid(msg.u||[],pid),tb,true);
      break;
    case "td":
      var tb2=rootOf(cellAt(msg.gx|0,msg.gz|0));
      if(tb2&&(tb2.own|0)===pid) clearTurret(tb2,true);
      break;
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
    rn:S.roadN.map(function(n){ return [n.id, r2(n.x), r2(n.z)]; }),
    re:S.roadE.map(function(e){ return [e.a, e.b, r2(e.prog), r2(e.need),
                                        e.done?1:0, e.own|0]; }),
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
                 u.inside?1:0, r2(u.atk), r2(u.atkT||0.75),
                 u.tur?(u.tur.gx*100+u.tur.gz):-1]);
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

  // Roads are rebuilt wholesale rather than diffed. The lists are tens of
  // entries and only change when somebody places or finishes one, so the
  // simple thing is also the cheap thing — and it cannot drift, which a diff
  // against a graph the guest never authored certainly could.
  if(sn.rn&&sn.re){
    S.roadN=sn.rn.map(function(a){ return {id:a[0], x:a[1], z:a[2]}; });
    S.roadE=sn.re.map(function(a){ return {a:a[0], b:a[1], prog:a[2], need:a[3],
                                           done:!!a[4], own:a[5]|0}; });
    S.roadVer++;
  }

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
    // The platform, resolved back to the building on this side. Without it a
    // guest draws the garrison standing on the ground inside the turret.
    var tk=(row[13]===undefined?-1:row[13]);
    if(tk<0) u.tur=null;
    else {
      var tc=S.cells[key(Math.floor(tk/100),tk%100)];
      u.tur=tc?rootOf(tc):null;
    }
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
  // st is the stride: one full cycle per pair of steps, which is what the legs
  // swing on. bobK is the footfall — the body rises once per foot planted, so
  // twice per stride, which is |sin| of the same phase.
  //
  // This used to be abs(cos(2*ph)). cos(2*ph) already runs at twice the stride,
  // and taking its absolute value doubled it again: four bounces per stride
  // against one leg cycle, measured, which is why the walk read as a rapid
  // jitter that had nothing to do with the feet. swayK is the weight shifting
  // side to side, which happens once per stride, not twice.
  var st=Math.sin(ph), bobK=Math.abs(st), swayK=st;
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

  var bobY  = (moving? bobK*g.bob : 0) - Math.abs(strike)*0.05;
  var lean  = g.lean + (moving? swayK*g.sway*0.35 : 0)
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
// How high a garrisoned archer stands. Read off the asset rather than typed in,
// so moving the platform in the Library moves the archers with it.
var DECK_Y=null;
function deckY(){
  if(DECK_Y===null){
    var m=M.partBase("turret","deck");
    DECK_Y=m?m[1]+0.18:2.45;
  }
  return DECK_Y;
}
function drawUnit(u,n,ca,cb){
  var UK=UNITS[u.t], id=UK.asset, r=RIG[id];
  if(!r) return false;
  var g=r.gait, yaw=u.rot-Math.PI/2, ph=u.ph||0, sc=u.sc;
  // st is the stride: one full cycle per pair of steps, which is what the legs
  // swing on. bobK is the footfall — the body rises once per foot planted, so
  // twice per stride, which is |sin| of the same phase.
  //
  // This used to be abs(cos(2*ph)). cos(2*ph) already runs at twice the stride,
  // and taking its absolute value doubled it again: four bounces per stride
  // against one leg cycle, measured, which is why the walk read as a rapid
  // jitter that had nothing to do with the feet. swayK is the weight shifting
  // side to side, which happens once per stride, not twice.
  var st=Math.sin(ph), bobK=Math.abs(st), swayK=st;
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
  var bobY  = (moving? bobK*g.bob : 0) - Math.abs(strike)*0.04;
  var lean  = g.lean + (moving? swayK*g.sway*0.35 : 0) + strike*0.24;

  var c=Math.cos(yaw), sn=Math.sin(yaw), ug=gy(u.x,u.z);
  // Standing on the platform rather than on the ground. Crew are spread around
  // the deck so two archers are two figures rather than one in two places.
  var tur=turretOf(u), ox0=0, oz0=0;
  if(tur){
    var crew=crewOf(tur), ix=crew.indexOf(u), cn=Math.max(1,crew.length);
    var ang=(ix<0?0:ix)/cn*6.2832;
    ox0=Math.cos(ang)*0.30; oz0=Math.sin(ang)*0.30;
    ug+=deckY();
  }
  function place(ox,oy,oz){
    return [u.x+ox0 + (ox*c - oz*sn)*sc, ug + oy*sc, u.z+oz0 + (ox*sn + oz*c)*sc];
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
  return !!TYPES[rootOf(c).type].wallish;
}
function wallMask(gx,gz,ghost){
  var m=0;
  for(var d=0;d<4;d++) if(joins(gx+DIRX[d],gz+DIRZ[d],ghost)) m|=(1<<d);
  return m;
}
function armMask(b,ghost){
  // A turret has no facing of its own to force — it is a drum, it looks the
  // same from every side, and honouring a manual rotation here would make it
  // emit arms into empty ground.
  if(!b.rotAuto&&b.type!=="turret"){    // manual facing: force a straight run
    var k=Math.round((b.rot||0)/(Math.PI/2))%4;
    if(k<0) k+=4;
    return (1<<k)|(1<<((k+2)%4));
  }
  var m=wallMask(b.gx,b.gz,ghost);
  return m||0x5;                        // isolated stub reads as a short run
}

function wallRot(gx,gz){
  function isW(c){ if(!c) return false; return !!TYPES[rootOf(c).type].wallish; }
  var h=(isW(cellAt(gx-1,gz))?1:0)+(isW(cellAt(gx+1,gz))?1:0);
  var v=(isW(cellAt(gx,gz-1))?1:0)+(isW(cellAt(gx,gz+1))?1:0);
  if(h>v) return 0;
  if(v>h) return Math.PI/2;
  return Math.abs(M.gx2w(gx))>Math.abs(M.gx2w(gz))?Math.PI/2:0;
}
// A ring that follows the ground. Every one of these used to be a single flat
// annulus placed at gy() of its own centre, so on a slope the uphill half sank
// into the hill and the downhill half hung in the air — worst on the biggest
// ones, which is why the commander's rally was where it showed.
//
// One instance carries one transform, so there is no way to bend a mesh over
// terrain here: a ring that follows the ground has to be a run of short chips,
// each sampling gy() where it lands. Spacing is finer than the 1.5-unit terrain
// cell so the run cannot step over a ridge, and the chip is longer than the
// spacing so it reads as a line rather than a dashed one.
var RING_STEP=0.8;                       // and the chip mesh is exactly twice this
// Each chip is scaled to twice the spacing it actually lands at, which is what
// makes the run add up to an even line instead of a string of beads. The chip
// fades linearly to nothing at both ends, so where two of them overlap the two
// ramps cross and sum to the value either one carries alone — but only if the
// ramp is as long as the gap. Left at a fixed length the sums go wrong in both
// directions: a tight ring (where cnt hits its floor of 8) piles four chips on
// the same spot and glares, and the chord of a 1.6-unit chip on a 0.62-unit
// ring is longer than the ring is wide.
function ringScale(r,cnt){ return (6.2832*r/cnt)/RING_STEP; }
function groundRing(n,x,z,r,col,lift,bat){
  if(!(r>0)) return;
  bat=bat||"rchip";
  // 22 is a smoothness floor rather than a spacing one: a selection ring is
  // small enough that RING_STEP alone gives it eight chips, and eight straight
  // chords is an octagon you can count the sides of.
  var cnt=Math.max(22,Math.min(220,Math.round(6.2832*r/RING_STEP)));
  var ly=(lift===undefined?0.05:lift), sc=ringScale(r,cnt);
  for(var i=0;i<cnt;i++){
    var a=i/cnt*6.2832, rx=x+Math.cos(a)*r, rz=z+Math.sin(a)*r;
    // yaw is the tangent, so the chip lies along the circle rather than across
    n[bat]=put(buf[bat],n[bat],rx,gy(rx,rz)+ly,rz,a+1.5708,col,sc,col);
  }
}
// Short marks stepping inward from a boundary, every few units around it. A
// range ring that is only a line tells you where the edge is and nothing about
// which side of it you are on; the ticks point at the thing the ring belongs to,
// which is the whole difference between a boundary and a circle.
function groundTicks(n,x,z,r,col,lift,len){
  if(!(r>1)) return;
  var cnt=Math.max(6,Math.min(64,Math.round(6.2832*r/2.4)));
  var ly=(lift===undefined?0.05:lift);
  var L=(len||Math.min(0.9,r*0.16)), sc=L/(RING_STEP*2), rr=r-L*0.5-0.05;
  for(var i=0;i<cnt;i++){
    var a=i/cnt*6.2832, rx=x+Math.cos(a)*rr, rz=z+Math.sin(a)*rr;
    // yaw is the radius, not the tangent: the mark points at the centre
    n.rchip=put(buf.rchip,n.rchip,rx,gy(rx,rz)+ly,rz,a,col,sc,col);
  }
}
// A boundary, drawn the way the player asked for it: a soft edge with marks
// stepping inward off it, and nothing filling the middle.
function rangeRing(n,x,z,r,col,tick,lift){
  groundRing(n,x,z,r,col,lift);
  groundTicks(n,x,z,r,tick||col,lift);
}
// What plants a unit on the ground rather than hanging a hoop around it: a ring
// of darkness just inside its selection glow, drawn subtractively. It is the
// same strip as any other ring, so it follows the terrain the same way; a flat
// disc under the feet would sink into the first slope it met.
// Every indicator colour in one place, and all of them low numbers on purpose.
// These are added to the ground rather than painted over it, so the value is
// how much light the mark contributes, not what colour it is: 0.34 of green is
// a clear cool wash on grass, and the 2.10 this used to carry was three times
// what the display could show — which is why every ring came out the same
// flat, blown, identical cyan whatever it was meant to mean.
var IND={
  sel   :[0.105,0.330,0.390],   // picked, yours
  range :[0.055,0.145,0.130],   // how far a weapon reaches
  rangeT:[0.090,0.225,0.195],
  lit   :[0.150,0.120,0.058],   // ...when the brazier is feeding it
  litT  :[0.230,0.180,0.085],
  aura  :[0.180,0.118,0.046],   // firelight
  auraT :[0.255,0.165,0.060],
  rally :[0.195,0.148,0.054],   // where the commander's people will stand
  rallyT:[0.255,0.195,0.070],
  rallyQ:[0.072,0.055,0.020],   // ...when he is not the one selected
  work  :[0.085,0.165,0.052],   // a pile someone is working
  ghost :[0.185,0.150,0.070],   // what the thing in your hand would cover
  grid  :[0.115,0.150,0.140]    // the cells you could put it on
};
var SHADE_COL=[0.40,0.38,0.30];
function contactShade(n,x,z,r,k){
  groundRing(n,x,z,r,k===undefined?SHADE_COL:[SHADE_COL[0]*k,SHADE_COL[1]*k,SHADE_COL[2]*k],
             0.022,"dshade");
}
function pack(){
  var n={hall:0,tower:0,ballista:0,brazier:0,barracks:0,archery:0,cottage:0,
         wall:0,wpost:0,gate:0,turret:0,salvage:0,
         soldier:0,archer:0,worker:0,scout:0,commander:0,nest:0,
         corpse:0,bolt:0,arrow:0,spark:0,debris:0,rchip:0,dshade:0,marker:0,tile:0,grid:0,site:0,
         road:0};
  for(var rk0 in RIGDEF){
    n[rk0+"Body"]=0; n[rk0+"Arm"]=0; n[rk0+"Leg"]=0;
    if(RIGDEF[rk0].armL) n[rk0+"ArmL"]=0;
  }
  applyAuras();
  var ghostCell=null;
  if(playable() && S.hover && (S.sel==="wall"||S.sel==="gate")
     && canPlace(S.sel,S.hover.gx,S.hover.gz)) ghostCell=S.hover;
  // fogOn is read once here and reused by every cull below it
  var fogOn=!!FOG().on;
  for(var k in S.cells){
    var c=S.cells[k]; if(c.ref) continue;
    // A building is a place, so it is remembered: seen once, it keeps standing
    // in your picture of the map whether or not anybody is looking at it. That
    // is the whole difference between explored and visible, and it is why the
    // other town's walls stay on your map after you have walked past them.
    if(fogOn&&lookingAt(M.gx2w(c.gx),M.gx2w(c.gz))<1) continue;
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
    else if(c.type==="turret"){
      n.turret=put(buf.turret,n.turret,x,by,z,rt,ca,ty.scale,cb);
      // A turret emits the same arms a palisade does, into whichever sides have
      // a neighbour. Without them the run stops 0.75 from the turret's centre
      // while the staves stop at 0.575, and that 0.175-unit hole is visible
      // from every angle. Reusing the wall's own arm rather than widening the
      // turret means the join is the same geometry on both sides of it — and
      // the arm's inner end is buried inside the drum, which is opaque, so only
      // the gap-filling part of it shows.
      var tm=armMask(c,ghostCell);
      for(var d3=0;d3<4;d3++)
        if(tm&(1<<d3)) n.wall=put(buf.wall,n.wall,x,by,z,d3*Math.PI/2,
                                  TYPES.wall.colA,1,TYPES.wall.colB);
    }
    else if(c.type==="wall"){
      var mk=armMask(c,ghostCell);
      n.wpost=put(buf.wpost,n.wpost,x,by,z,0,ca,1,cb);
      for(var d2=0;d2<4;d2++)
        if(mk&(1<<d2)) n.wall=put(buf.wall,n.wall,x,by,z,d2*Math.PI/2,ca,1,cb);
    }
    if(S.bsel===c){
      var br=0.75+((ty.foot||1)-1)*0.75;
      // no contact shade on a building: it casts a real shadow already, and a
      // second dark ring around the first reads as a stain rather than as depth
      groundRing(n,x,z,br,IND.sel,0.05);
    }
    if(playable()&&ty.range&&S.sel===c.type)
      rangeRing(n,x,z,ty.range,c.lit?IND.lit:IND.range,c.lit?IND.litT:IND.rangeT,0.05);
    if(playable()&&c.type==="brazier"&&S.sel&&(S.sel==="brazier"||TYPES[S.sel].range))
      rangeRing(n,x,z,ty.aura,IND.aura,IND.auraT,0.05);
  }
  for(var si=0;si<S.nodes.length;si++){
    var nd=S.nodes[si], nf=Math.max(0,nd.amt/nd.max);
    if(nf<=0.001) continue;
    if(fogOn&&lookingAt(nd.x,nd.z)<1) continue;   // a pile you have found stays found
    var na=dim([0.348,0.276,0.190],0.45+0.55*nf), nb=dim([0.300,0.325,0.360],0.45+0.55*nf);
    n.salvage=put(buf.salvage,n.salvage,nd.x,gy(nd.x,nd.z),nd.z,nd.rot,na,0.62+0.62*nf,nb);
    if(nd.worked) groundRing(n,nd.x,nd.z,1.35,IND.work,0.03);
  }
  for(var i=0;i<S.corpses.length;i++){
    var cp=S.corpses[i], cf=Math.min(1,cp.life/cp.max);
    if(fogOn&&lookingAt(cp.x,cp.z)<2) continue;   // a body is not a landmark
    var cA=dim([0.150,0.156,0.135],0.35+0.65*cf), cB=dim([0.196,0.196,0.168],0.35+0.65*cf);
    n.corpse=putP(buf.corpse,n.corpse,cp.x,
                  cp.y===undefined?((cp.gnd===undefined?PLAT:cp.gnd)+0.02):cp.y,cp.z,cp.rot,
                  cA,cp.sc*(0.55+0.45*cf),cB,cp.tum||0);
  }
  var nestMeta=M.assetMeta("nest");
  for(i=0;i<S.nests.length;i++){
    var nn=S.nests[i];
    if(nn.dead) continue;
    if(fogOn&&lookingAt(nn.x,nn.z)<1) continue;   // the objective, once you find it
    var nf=Math.max(0,nn.hp/nn.max);
    var na=nn.hit>0.01?[1.35,0.55,0.42]:hurt(nestMeta.colA,nf);
    var nb=nn.hit>0.01?[1.55,0.70,0.55]:hurt(nestMeta.colB,nf);
    // no boundary ring: the tainted ground already says where it reaches
    n.nest=put(buf.nest,n.nest,nn.x,gy(nn.x,nn.z),nn.z,0,na,(nestMeta.scale||1)*1.5,nb);
  }
  // Anything alive in ground you are not looking at is not drawn at all.
  // Dimming is right for terrain and for a building you remember; it is wrong
  // for something that moves, because a dark silhouette crossing a dark field
  // is still a silhouette, and at a gentler fog setting it is plainly readable.
  // Memory is for places. A horde is not a place.
  for(i=0;i<S.enemies.length;i++){
    var em=S.enemies[i];
    if(fogOn&&lookingAt(em.x,em.z)<2) continue;
    drawEnemy(em,n);
  }
  for(i=0;i<S.units.length;i++){
    var u=S.units[i], UK=UNITS[u.t], uf=Math.max(0,u.hp/u.max);
    if(u.inside) continue;                  // indoors: nothing to draw
    // Your own people are always drawn — they are the eyes, so they cannot be
    // in the dark by definition, and a unit that vanished because it walked
    // out of its own sight would be a bug rather than a rule. The other
    // player's are subject to the same fog as anything else that moves.
    if(fogOn&&(u.own|0)!==(S.me|0)&&lookingAt(u.x,u.z)<2) continue;
    if(u.sel){
      // the shade first and inside the light: a pool under the feet with the
      // glow sitting on its rim is what makes a unit look planted on the field
      // rather than standing in the middle of a hoop
      contactShade(n,u.x,u.z,0.42);
      groundRing(n,u.x,u.z,0.62,IND.sel,0.03);
    }
    // the rally is only a decision if you can see where it reaches
    if(u.t==="commander"&&(u.own|0)===S.me){
      var UC=UNITS.commander, rr=(UC.rally===undefined?5.6:UC.rally);
      if(rr>0&&(u.sel||S.phase==="attack")){
        // ticks only while he is the one selected — during a night every
        // commander on the field would otherwise be drawing them at once
        if(u.sel) rangeRing(n,u.x,u.z,rr,IND.rally,IND.rallyT,0.045);
        else groundRing(n,u.x,u.z,rr,IND.rallyQ,0.045);
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
    // The ripple keeps its brightness as it widens and the pool under it fades:
    // a ring that dims while it grows reads as a mistake being erased, and this
    // is the one indicator whose whole job is to say "yes, heard, there".
    var rc2=[0.085*mf+0.055,0.30*mf+0.16,0.32*mf+0.17];
    var pc=[0.10*mf,0.34*mf,0.36*mf];
    groundRing(n,mk.x,mk.z,0.42*(1.0+(1-mf)*1.5),rc2,0.04);
    n.marker=put(buf.marker,n.marker,mk.x,gy(mk.x,mk.z)+0.035,mk.z,0,pc,0.52,pc);
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
  // ---- roads ---------------------------------------------------------------
  // The line in S.roadE is dead straight, and drawn straight it reads as
  // tiling. So the centre stays exactly where the simulation put it — speed and
  // routing use the true segment — and only the pads wander around it.
  //
  // The surface and the edge are drawn by different rules, and that split is
  // the whole trick. Varying colour, size and angle on every pad makes each one
  // legible as its own square — splotchy. So the body is near-uniform and
  // heavily overlapped, and the raggedness is silhouette only: the edge pads
  // are the SAME colour as the body, which means they can change the shape of
  // the strip without ever reading as a patch inside it. Only the grit, which
  // is tiny and sparse, is allowed to differ in colour at all.
  //
  // All of it comes out of padHash, never Math.random(). pack() runs every
  // frame, so random scatter would boil.
  var RDS=ROAD(), pad=(RDS.pad===undefined?0.9:RDS.pad);
  var rough=(RDS.rough===undefined?1:RDS.rough);
  var DIRT=[0.375,0.325,0.250];
  for(i=0;i<S.roadE.length;i++){
    var re=S.roadE[i], ra=nodeById(re.a), rb=nodeById(re.b);
    if(!ra||!rb) continue;
    var rdx=rb.x-ra.x, rdz=rb.z-ra.z, rL=Math.hypot(rdx,rdz);
    if(rL<0.01) continue;
    var ux=rdx/rL, uz=rdz/rL, nx=-uz, nz=ux;   // along, and across
    var yaw=Math.atan2(rdz,rdx);
    var f=re.done?1:Math.max(0,Math.min(1,re.prog/Math.max(0.001,re.need)));
    var ph=padHash(re.a,re.b,0,7)*6.283, wav=5.0+padHash(re.a,re.b,0,8)*7.0;

    // 0 plain, 1 under the cursor, 2 picked. The picked colour is the same
    // over-bright cyan the building ring uses, so "this is selected" looks the
    // same whatever kind of thing is selected.
    var lit=(S.rsel&&((S.rsel.a===re.a&&S.rsel.b===re.b)||(S.rsel.a===re.b&&S.rsel.b===re.a)))?2
           :(S.rhover&&((S.rhover.a===re.a&&S.rhover.b===re.b)||(S.rhover.a===re.b&&S.rhover.b===re.a)))?1:0;
    var LITC=[0.55,2.10,2.20];

    if(!re.done){
      // Stakes: tidy, on the line, sparse. A marked-out route should read as
      // intent rather than as a badly made road.
      //
      // The whole run is staked, not just the part that is finished. It used to
      // stop at the progress mark, which meant a road you had only just ordered
      // drew a single dot — you could see that something had happened and not
      // what you had asked for. The laid part is the brighter half, so the pair
      // still reads as a progress bar lying on the ground.
      // Pale, and close enough together to read as a dashed line. The first
      // version of this was a dark grey pad at a third of this spacing, which
      // is indistinguishable from the stones already scattered on the grass —
      // the marks were all being drawn and none of them could be seen. A route
      // somebody paced out and marked is chalk-coloured, not earth-coloured.
      var STAKE=[0.74,0.72,0.60], LAID=[0.46,0.40,0.30];
      var scnt=Math.max(1,Math.floor(rL/(pad*1.5)));
      for(var sq=0;sq<=scnt;sq++){
        var st2=sq/scnt, laid=(st2<=f+0.02), end=(sq===0||sq===scnt);
        var sx=ra.x+rdx*st2, sz=ra.z+rdz*st2;
        var base=laid?LAID:STAKE, sk=(lit===1?1.25:1);
        var scol=(lit===2)?LITC:[base[0]*sk,base[1]*sk,base[2]*sk];
        // The ends carry a heavier mark: what a road connects is the thing you
        // are checking when you look at one you have not built yet.
        n.road=put(buf.road,n.road,sx,gy(sx,sz)+0.03,sz,yaw,scol,
                   (end?0.62:(laid?0.44:0.34))*(lit?1.15:1),scol);
      }
      continue;
    }
    // A finished road has no stakes left, so picking one puts them back as an
    // overlay: same marks, same spacing, sitting just above the surface. It is
    // the one drawing that says "this edge, not the junction next to it".
    if(lit){
      var hcnt=Math.max(1,Math.floor(rL/(pad*1.5)));   // the staking spacing
      var hcol=(lit===2)?LITC:[0.74,0.72,0.60];
      for(var hq=0;hq<=hcnt;hq++){
        var ht=hq/hcnt, hx=ra.x+rdx*ht, hz=ra.z+rdz*ht;
        n.road=put(buf.road,n.road,hx,gy(hx,hz)+0.055,hz,yaw,hcol,
                   (hq===0||hq===hcnt)?0.58:0.34,hcol);
      }
    }

    // Half-spacing: consecutive pads overlap by more than half their length, so
    // the strip closes up instead of showing seams.
    var step=pad*0.5, cnt=Math.max(1,Math.ceil(rL/step));
    for(var q=0;q<=cnt;q++){
      var t=q/cnt, along=t*rL;
      // the meander is a property of the road, so body and verges share it
      var mean=(Math.sin(ph+along/wav)*0.30 +
                Math.sin(ph*1.7+along/(wav*0.43))*0.12)*rough;
      var h1=padHash(re.a,re.b,q,1), h2=padHash(re.a,re.b,q,2),
          h3=padHash(re.a,re.b,q,3), h4=padHash(re.a,re.b,q,4);
      // Colour drifts along the run, not per pad, and gently: a short
      // wavelength here bands the road into visible stripes across its width.
      var sh=1+Math.sin(ph*2.3+along*0.085)*0.030;
      var col=[DIRT[0]*sh, DIRT[1]*sh, DIRT[2]*sh];
      var bx=ra.x+ux*along+nx*mean, bz=ra.z+uz*along+nz*mean;
      // body: near-uniform, barely turned, so nothing reads as a separate tile
      n.road=put(buf.road,n.road,bx,gy(bx,bz)+0.03,bz,
                 yaw+(h1-0.5)*0.10*rough, col, 1.0+(h2-0.5)*0.10, col);
      if(rough<=0) continue;
      // Edge bulge: a smaller pad pushed just off one side, in the body's own
      // colour and at the body's own angle. It widens the strip irregularly and
      // is invisible as an object — which is the point. Anything bigger, or a
      // shade off, comes back as a tab stuck to the side of the road.
      if(h3>0.30){
        var vs=((h4>0.5)?1:-1)*(0.26+h3*0.26)*rough;
        var vx=bx+nx*vs, vz=bz+nz*vs;
        n.road=put(buf.road,n.road,vx,gy(vx,vz)+0.029,vz,
                   yaw+(h2-0.5)*0.16*rough, col, 0.50+h1*0.28, col);
      }
      // Grit: the only thing allowed its own colour, and small enough that a
      // few specks read as loose stone rather than as a second surface.
      if(h2>0.80){
        var gs=((h1>0.5)?1:-1)*(0.62+h4*0.42)*rough;
        var gx=bx+nx*gs, gz2=bz+nz*gs;
        var gc=[col[0]*1.10,col[1]*1.11,col[2]*1.14];
        n.road=put(buf.road,n.road,gx,gy(gx,gz2)+0.028,gz2,
                   yaw+(h3-0.5)*3.0, gc, 0.13+h4*0.10, gc);
      }
    }
  }
  // The drag preview: the run you would get, in the colour of whether you can
  // have it. Drawn from the snapped anchors, not the cursor, so what you see
  // is exactly what releasing would build.
  if(S.roadDrag){
    var dg=S.roadDrag, ddx=dg.bx-dg.ax, ddz=dg.bz-dg.az;
    var dL=Math.hypot(ddx,ddz), dcol=dg.bad?[0.66,0.13,0.11]:[0.30,0.62,0.44];
    var dyaw=Math.atan2(ddz,ddx), dn=Math.max(1,Math.floor(dL/pad));
    for(var w2=0;w2<=dn;w2++){
      var dt2=w2/dn, dpx=dg.ax+ddx*dt2, dpz=dg.az+ddz*dt2;
      n.road=put(buf.road,n.road,dpx,gy(dpx,dpz)+0.05,dpz,dyaw,dcol,0.8,dcol);
    }
  }

  if(playable()){
    // The grid is a placement aid, so it only exists while you are placing. The
    // patch follows the cursor — there is no build ring any more, so a grid
    // pinned to the middle of the map would be no help out at the edge — but
    // its lines are the world's cell edges, not the cursor's. Snapping the
    // instance to a whole cell is what makes it read as ground you are moving
    // over rather than a mat dragged along under the building.
    if(S.sel&&S.hover&&!TYPES[S.sel].road){
      var grx=Math.round(S.hover.x/M.CELL)*M.CELL;
      var grz=Math.round(S.hover.z/M.CELL)*M.CELL;
      n.grid=put(buf.grid,n.grid,grx,gy(grx,grz)+0.02,grz,0,
                 IND.grid,1,IND.grid);
    }
    if(S.hover&&S.sel&&!TYPES[S.sel].road){
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
        rangeRing(n,gxw,gzw,t2.range,IND.ghost,IND.ghost,0.06);
      }
      else if(S.sel==="barracks"||S.sel==="archery"||S.sel==="cottage"){
        n[S.sel]=put(buf[S.sel],n[S.sel],gxw,ghy,gzw,rot,gA,t2.scale,gB);
      }
      else if(S.sel==="brazier"){
        n.brazier=put(buf.brazier,n.brazier,gxw,ghy,gzw,rot,gA,t2.scale,gB);
        rangeRing(n,gxw,gzw,t2.aura,IND.ghost,IND.ghost,0.06);
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
  // Fog is rebuilt per frame rather than cached: everything that changes it is
  // a unit walking, which is every frame anyway. It is ~10k byte writes over a
  // 6400-cell grid and the upload is 6.4KB — cheaper than the bookkeeping that
  // would tell us whether it needed doing.
  if(R.setFog){
    var FG=FOG();
    if(FG.on) R.setFog(fogStep(),M.GN,(M.GN*M.CELL)/2,M.CELL,FG.dark,FG.dim);
    else R.setFog(null);
  }
  pack();
  R.render(camera(),BATCHES,[S.flash*1.5,0,0],null,DECALS);
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
// Letting go of everything at once — what you are holding, the building or road
// you picked, and whoever is selected. Bound to ctrl+D, and to Escape, which
// tries this first and only opens the pause menu when there was nothing to drop.
// Returns whether it actually let go of anything, which is what lets Escape
// tell those two cases apart.
//
// There used to be a stepwise clearSel() beside this that dropped one thing per
// press. It had no callers — Escape was the obvious home for it and Escape went
// to the pause menu — so it has gone rather than sitting here looking wired.
function deselectAll(){
  if(!S) return false;
  var had=!!(S.sel||S.bsel||S.rsel||selectedUnits().length);
  S.sel=null; S.bsel=null; S.rsel=null;
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
  if(S.bsel) S.rsel=null;             // one subject at a time; they share a panel
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
    // A road is drawn, not painted: press anchors one end, release lands the
    // other. Both ends snap, so the anchor is taken through roadAnchor rather
    // than from the raw cursor.
    if(playable()&&S.sel==="road"){
      var pr=pick(ev.clientX,ev.clientY);
      if(!pr){ mode="none"; return; }
      mode="road";
      var an=roadAnchor(pr.x,pr.z);
      S.roadDrag={ax:an.x, az:an.z, aKind:an.kind, bx:an.x, bz:an.z,
                  bKind:an.kind, bad:"bld.road.tooshort"};
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
    if(mode==="road"){
      if(p&&S.roadDrag){
        var bn=roadAnchor(p.x,p.z);
        S.roadDrag.bx=bn.x; S.roadDrag.bz=bn.z; S.roadDrag.bKind=bn.kind;
        S.roadDrag.bad=roadRefusal(S.roadDrag.ax,S.roadDrag.az,bn.x,bn.z);
      }
      return;
    }
    if(mode==="paint"){
      if(p&&(S.sel==="wall"||S.sel==="gate")) place(S.sel,p.gx,p.gz);
      return;
    }
    // Roads light up under an empty cursor. Not while you are holding
    // something: the ghost is the answer to "what happens if I click here" and
    // a second thing glowing under it is noise.
    var rh=(p&&!S.sel&&playable())?roadAt(p.x,p.z):null;
    S.rhover=rh?{a:rh.a,b:rh.b}:null;
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
      if(mode==="road"){
        var rd=S.roadDrag;
        // A refused drag leaves nothing behind. The preview has been showing
        // why in red the whole time it was refused, so releasing on a bad
        // stroke is a no-op rather than a surprise.
        if(rd&&!rd.bad) queueRoad(rd.ax,rd.az,rd.bx,rd.bz);
        S.roadDrag=null;
      } else if(mode==="marquee"){
        var hit=unitsInBox(downX,downY,ev.clientX,ev.clientY);
        if(addSel) addToSelection(hit); else selectOnly(hit);
      } else if(mode==="maybe"&&moved<=DRAG_PX){
        // A click never sells. It places what you are holding, or picks up a
        // building as a subject; selling is one deliberate button in the dock.
        if(playable()){
          var p=pick(ev.clientX,ev.clientY);
          var hit=p?rootOf(cellAt(p.gx,p.gz)):null;
          if(p&&S.sel&&TYPES[S.sel].road){
            /* a road takes a drag, not a click: one point is not a route */
          } else if(p&&S.sel&&!hit){
            place(S.sel,p.gx,p.gz);
          } else if(hit&&(hit.own|0)===S.me&&!hit.site){
            selectBuilding(hit);
            if(!addSel) selectOnly([]);
          } else if(!hit){
            // Nothing built here — but a road might run through it. Roads are
            // not cells, so they are invisible to the hit test above and have
            // to be asked for separately.
            var rp=p?roadAt(p.x,p.z):null;
            if(rp) selectRoad(rp); else selectBuilding(null);
            if(!addSel) selectOnly([]);
          }
        } else { selectBuilding(null); selectRoad(null); if(!addSel) selectOnly([]); }
      } else if(mode==="order"&&downBtn===2){
        // Right-click is an order, full stop — there is no right-drag gesture
        // left for it to compete with. Requiring the mouse to be still first
        // meant an order given on the move simply vanished.
        var g=pick(ev.clientX,ev.clientY), list=selectedUnits();
        // a selected house turns its own people out to wherever you clicked
        var sent=0;
        if(g&&S.bsel&&housedBy(S.bsel).length&&!cellAt(g.gx,g.gz)) sent=sendOut(S.bsel,g.x,g.z);
        // A right-click on your own turret with ranged troops selected puts
        // them on it. It comes before the order below because "go and stand
        // there" and "go and stand on that" are the same gesture, and the
        // turret is the more specific reading.
        var turB=g?rootOf(cellAt(g.gx,g.gz)):null;
        if(turB&&turB.type==="turret"&&!turB.site&&(turB.own|0)===S.me){
          var crewList=selectedUnits().filter(canCrew);
          if(crewList.length&&manTurret(crewList,turB)) { mode=null; S.marquee=null; return; }
        }
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
        // With no troops selected there is no order to give, so the right
        // button goes back to meaning "never mind" and puts down whatever is
        // picked. It is checked last on purpose: a building with people in it
        // has already turned them out above, and dropping the selection in the
        // same click would take the panel away from under the player just as
        // they used it.
        else if(!sent&&(S.bsel||S.rsel)){ selectBuilding(null); selectRoad(null); }
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
  startWave:startWave, RIG:RIG, RIGDEF:RIGDEF,
  liveNests:liveNests, cam:function(){ return cam; }, camera:camera,
  // how big tonight will be, from what is still standing out there
  waveSize:function(){ return S?waveSize():0; },
  nestSend:function(n){ return S?nestSend(n||(S?S.night:1)):0; },
  // exposed so a test can land credited damage on a nest without pretending to
  // be a soldier; the game itself only ever reaches it through hurtTarget
  hurtNest:function(n,amt,pid){ hurtTarget(n,amt,pid); },
  // Roads, for the tools: queueRoad is the same door the player's drag uses,
  // so a test exercises the real snapping rather than a back channel.
  queueRoad:queueRoad, roadSpeed:roadSpeed, roadAnchor:roadAnchor,
  roadRefusal:roadRefusal, stepVia:stepVia,
  // vision and fog, for the minimap and the tools
  visionMask:visionMask, seenAt:seenAt, fogStep:fogStep,
  // 0 never seen, 1 seen before, 2 in sight now
  fogAt:function(gx,gz){
    if(!S||!S.fog||gx<0||gz<0||gx>=M.GN||gz>=M.GN) return 2;
    var i=gz*M.GN+gx;
    return (S.fogTex&&S.fogTex[i]===255)?2:(S.fog[i]?1:0);
  },
  cancelRoad:cancelRoad, roadAt:roadAt, selectRoad:selectRoad,
  rsel:selRoad, roadCrew:roadCrew, edgeLen:edgeLen,
  // pathfinding, for the tools: findPath is the search, stepPath the follower
  findPath:findPath, stepPath:stepPath, losClear:losClear,
  walkableCell:function(gx,gz){ return walkableCell(gx,gz); },
  // the same call a right-click makes, so a test measures the real order path
  orderTo:function(list,x,z){ orderTo(list,x,z); },
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
  crewOf:crewOf, manTurret:manTurret, clearTurret:clearTurret, canCrew:canCrew,
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
