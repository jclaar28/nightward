// ===========================================================================
// Nightward — procedural audio.
//
// Every sound is synthesised at play time. There are no audio files, and there
// is no download, which is the same reason the rest of the game has no assets:
// the build is one HTML file you can open from disk.
//
// The thing that makes synthesis sound synthetic is not the synthesis. It is
// playing one oscillator, at one pitch, dry, in the middle of the stereo field,
// identically every time. So the rules here are:
//
//   * every sound is layered — a transient you hear first, a body that gives it
//     material, and a tail that says how big the room is;
//   * nothing repeats exactly — pitch, filter and timing are jittered per hit,
//     because a hundred identical arrows is the loudest tell there is;
//   * everything is placed — panned and attenuated against the camera, and
//     dulled with distance, since air eats treble long before it eats bass;
//   * everything shares one reverb and one limiter, so a wave of two hundred
//     dying attackers thickens instead of clipping.
//
// Browsers refuse to start audio before a gesture, so the context is built
// lazily on the first real interaction.
// ===========================================================================
var HFSND=(function(){
"use strict";

var ctx=null, master=null, comp=null, dryBus=null, wetBus=null, ambBus=null;
var noise=null, noiseDark=null, ready=false, muted=false, vol=0.7;

// ---- voices ---------------------------------------------------------------
// A cap, and a per-name burst budget. The old code collapsed same-named sounds
// inside a window into one, which turned a volley of ten towers into a single
// shot. Now the first few play at full weight and the rest fold in quieter, so
// a volley reads as a volley.
var voices=0, VOICE_CAP=26;
var burstAt={}, burstN={};
var offline=false;

function rnd(a,b){ return a+Math.random()*(b-a); }
function jit(f,cents){ return f*Math.pow(2,rnd(-cents,cents)/1200); }

function mkNoise(seconds,dark){
  var n=Math.floor(ctx.sampleRate*seconds);
  var b=ctx.createBuffer(1,n,ctx.sampleRate), d=b.getChannelData(0);
  var last=0;
  for(var i=0;i<n;i++){
    var w=Math.random()*2-1;
    if(dark){ last=last*0.86+w*0.14; d[i]=last*3.2; }   // one-pole: brown-ish
    else d[i]=w;
  }
  return b;
}

// A room, made rather than recorded: noise shaped by an exponential decay,
// decorrelated between the two channels so it has width, and darkened toward
// the tail the way a real space loses its highs first.
function makeIR(seconds,decay,damp){
  var n=Math.floor(ctx.sampleRate*seconds);
  var b=ctx.createBuffer(2,n,ctx.sampleRate);
  for(var c=0;c<2;c++){
    var d=b.getChannelData(c), lp=0;
    for(var i=0;i<n;i++){
      var t=i/n;
      var w=(Math.random()*2-1)*Math.pow(1-t,decay);
      lp=lp+(w-lp)*(damp*(1-t*0.7)+0.02);              // damps further out
      d[i]=lp*(1-t*0.15);
    }
    // a little pre-delay so the tail sits behind the transient
    var pre=Math.floor(ctx.sampleRate*0.012);
    for(var k=n-1;k>=pre;k--) d[k]=d[k-pre];
    for(var k2=0;k2<pre;k2++) d[k2]=0;
  }
  return b;
}

// `into` is only ever passed by the offline renderer below. Everything else
// calls build() with nothing and gets the one live context.
function build(into){
  if(ctx&&!into) return true;
  if(into){ ctx=into; }
  else {
    var AC=window.AudioContext||window.webkitAudioContext;
    if(!AC) return false;
    try{ ctx=new AC(); }catch(e){ return false; }
  }

  master=ctx.createGain();
  master.gain.value=vol;

  // One limiter across everything that fires. Without it, a night with two
  // hundred deaths in it either clips or has to be gated down to nothing.
  comp=ctx.createDynamicsCompressor();
  comp.threshold.value=-16;
  comp.knee.value=12;
  comp.ratio.value=7;
  comp.attack.value=0.004;
  comp.release.value=0.16;

  // A soft ceiling after the compressor. tanh is transparent at the levels a
  // single sound reaches and bends anything above into a limit it can never
  // cross, so the worst night the game can produce still cannot clip. The
  // compressor alone left a full volley peaking at 0.995, which is not a
  // margin, it is luck.
  var shaper=ctx.createWaveShaper();
  var N=2048, curve=new Float32Array(N);
  for(var ci=0;ci<N;ci++){
    var u=(ci/(N-1))*2-1;
    curve[ci]=Math.tanh(3*u);
  }
  shaper.curve=curve;
  shaper.oversample="4x";
  var pre=ctx.createGain(); pre.gain.value=1/3;   // the curve's own input scale
  comp.connect(pre); pre.connect(shaper); shaper.connect(master);
  master.connect(ctx.destination);

  // Makeup. A bandpass at Q 3 keeps a sliver of the noise it is given, so the
  // layer peaks written below arrive a good 12 dB under their face value. This
  // puts the mix back where the limiter can actually do its job.
  dryBus=ctx.createGain(); dryBus.gain.value=4.8; dryBus.connect(comp);

  var conv=ctx.createConvolver();
  conv.buffer=makeIR(1.25,3.4,0.26);
  wetBus=ctx.createGain(); wetBus.gain.value=1.0;
  wetBus.connect(conv);
  var wetOut=ctx.createGain(); wetOut.gain.value=1.15;
  conv.connect(wetOut); wetOut.connect(comp);

  // The bed does not go through the limiter: it should not duck every time a
  // tower fires, it should just sit under everything.
  ambBus=ctx.createGain(); ambBus.gain.value=0.0; ambBus.connect(master);

  noise=mkNoise(2.0,false);
  noiseDark=mkNoise(2.0,true);
  ready=true;
  return true;
}
function resume(){
  if(offline) return;                 // an offline render has nothing to resume
  if(!build()) return;
  if(ctx.state==="suspended"&&ctx.resume) ctx.resume();
}
function ok(){ return ready && !muted && ctx && (offline||ctx.state==="running"); }

// Returns a gain multiplier: 1 for the first of a burst, tapering after, and 0
// once the budget is spent.
function budget(name,ms,max){
  var t=ctx.currentTime*1000;
  if(burstAt[name]===undefined||t-burstAt[name]>ms){ burstAt[name]=t; burstN[name]=0; }
  var n=burstN[name]++;
  if(n>=max) return 0;
  return 1/(1+n*0.55);
}
function slot(){ if(voices>=VOICE_CAP) return false; voices++; return true; }
function free(when){ setTimeout(function(){ voices=Math.max(0,voices-1); },
                                Math.max(60,when*1000+120)); }

// ---- listener -------------------------------------------------------------
// The game pushes the camera here once a frame. Sounds carry a world position;
// everything else falls out of the difference.
var LX=0, LZ=0, LRX=1, LRZ=0, LREF=26;
function listen(tx,tz,rx,rz,zoom){
  LX=tx; LZ=tz; LRX=rx; LRZ=rz;
  LREF=Math.max(9,zoom*1.5);        // zoomed out, everything is further away
}
// pan, level and how much air is between you and it
function place(x,z){
  if(x===undefined||x===null) return {p:0,g:1,lp:18000,wet:0.16};
  var dx=x-LX, dz=z-LZ;
  var lat=dx*LRX+dz*LRZ;                       // along the camera's right
  var d=Math.sqrt(dx*dx+dz*dz);
  var k=d/LREF;
  var g=1/(1+k*k*1.35);
  var p=Math.max(-0.92,Math.min(0.92,lat/(LREF*0.85)));
  // air absorbs treble long before it absorbs anything else — this is most of
  // what makes a distant sound read as distant rather than as a quiet near one
  var lp=Math.max(900,17000/(1+k*k*3.2));
  return {p:p, g:Math.max(0.05,g), lp:lp, wet:Math.min(0.5,0.12+k*0.30)};
}

// ---- one sound ------------------------------------------------------------
// Every effect builds a voice, hangs layers off it, and lets it go. The voice
// owns the placement — pan, distance rolloff, and how much of it reaches the
// room — so a layer only has to worry about its own shape.
function Voice(t0,x,z,gain){
  var pl=place(x,z);
  var out=ctx.createGain();
  out.gain.value=Math.max(0.0001,(gain===undefined?1:gain)*pl.g);
  var lp=ctx.createBiquadFilter();
  lp.type="lowpass"; lp.frequency.value=pl.lp; lp.Q.value=0.0001;
  out.connect(lp);
  var pan=ctx.createStereoPanner?ctx.createStereoPanner():null;
  var tail=lp;
  if(pan){ pan.pan.value=pl.p; lp.connect(pan); tail=pan; }
  tail.connect(dryBus);
  var send=ctx.createGain(); send.gain.value=pl.wet;
  tail.connect(send); send.connect(wetBus);
  return {t:t0, node:out, pl:pl,
    // shaped noise: the transient and the texture of nearly everything
    nz:function(peak,dur,f0,f1,q,type,atk){
      var s=ctx.createBufferSource();
      s.buffer=(f0<420)?noiseDark:noise;
      s.loop=true;
      s.playbackRate.value=rnd(0.92,1.09);
      var f=ctx.createBiquadFilter();
      f.type=type||"bandpass"; f.Q.value=q||1.2;
      f.frequency.setValueAtTime(f0,t0);
      if(f1!==undefined&&f1!==f0)
        f.frequency.exponentialRampToValueAtTime(Math.max(30,f1),t0+dur);
      var g=ctx.createGain();
      var a=atk===undefined?0.002:atk;
      g.gain.setValueAtTime(0.0001,t0);
      g.gain.linearRampToValueAtTime(Math.max(0.0002,peak),t0+a);
      g.gain.exponentialRampToValueAtTime(0.0001,t0+a+dur);
      s.connect(f); f.connect(g); g.connect(out);
      s.start(t0+rnd(0,0.004)); s.stop(t0+a+dur+0.05);
      return this;
    },
    // a pitched body: what the thing is made of
    osc:function(peak,dur,f0,f1,type,atk){
      var o=ctx.createOscillator();
      o.type=type||"sine";
      o.frequency.setValueAtTime(f0,t0);
      if(f1!==undefined&&f1!==f0)
        o.frequency.exponentialRampToValueAtTime(Math.max(18,f1),t0+dur);
      var g=ctx.createGain();
      var a=atk===undefined?0.003:atk;
      g.gain.setValueAtTime(0.0001,t0);
      g.gain.linearRampToValueAtTime(Math.max(0.0002,peak),t0+a);
      g.gain.exponentialRampToValueAtTime(0.0001,t0+a+dur);
      o.connect(g); g.connect(out);
      o.start(t0); o.stop(t0+a+dur+0.05);
      return this;
    },
    // scattered debris: splinters, rubble, coins. Irregular on purpose.
    ticks:function(n,spread,peak,f0,f1,dur){
      for(var i=0;i<n;i++){
        var s=ctx.createBufferSource();
        s.buffer=noise; s.loop=true;
        var f=ctx.createBiquadFilter();
        f.type="bandpass"; f.Q.value=rnd(4,11);
        f.frequency.value=rnd(f0,f1);
        var g=ctx.createGain();
        var tt=t0+Math.pow(Math.random(),1.6)*spread;
        var dd=dur*rnd(0.5,1.4);
        g.gain.setValueAtTime(0.0001,tt);
        g.gain.linearRampToValueAtTime(peak*rnd(0.35,1),tt+0.0015);
        g.gain.exponentialRampToValueAtTime(0.0001,tt+dd);
        s.connect(f); f.connect(g); g.connect(out);
        s.start(tt); s.stop(tt+dd+0.03);
      }
      return this;
    },
    done:function(dur){ free(dur); setTimeout(function(){ try{out.disconnect();}catch(e){} },
                                              Math.max(200,dur*1000+400)); return this; }
  };
}
// The common opening: check we can play, spend the burst budget, take a slot.
function begin(name,ms,max,x,z,extra){
  if(!ok()) return null;
  var b=budget(name,ms,max);
  if(b<=0||!slot()) return null;
  return Voice(ctx.currentTime+rnd(0,0.008),x,z,b*(extra===undefined?1:extra));
}

// ---- ambience -------------------------------------------------------------
// Two beds, crossfaded by the clock. Wind is noise through a slowly wandering
// filter; night is a pair of detuned drones an octave down with the same wind
// underneath, quieter and darker. Neither ever stops, so there is no gap.
var amb=null, ambTimer=null, ambPhase="build", ambDayP=0;
function startAmbience(){
  if(amb||!ready) return;
  function windChain(dark){
    var s=ctx.createBufferSource();
    s.buffer=dark?noiseDark:noise; s.loop=true; s.playbackRate.value=dark?0.7:1;
    var f=ctx.createBiquadFilter();
    f.type="bandpass"; f.frequency.value=dark?190:430; f.Q.value=0.55;
    var g=ctx.createGain(); g.gain.value=0.0001;
    s.connect(f); f.connect(g); g.connect(ambBus);
    s.start();
    // a slow wander, so it breathes instead of hissing
    var lfo=ctx.createOscillator(), la=ctx.createGain();
    lfo.type="sine"; lfo.frequency.value=dark?0.045:0.07;
    la.gain.value=dark?70:190;
    lfo.connect(la); la.connect(f.frequency); lfo.start();
    return g;
  }
  function drone(f0){
    var o=ctx.createOscillator(), o2=ctx.createOscillator();
    o.type="sawtooth"; o.frequency.value=f0;
    o2.type="sawtooth"; o2.frequency.value=f0*1.0075;   // beating, not unison
    var lp=ctx.createBiquadFilter();
    lp.type="lowpass"; lp.frequency.value=210; lp.Q.value=0.7;
    var g=ctx.createGain(); g.gain.value=0.0001;
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(ambBus);
    o.start(); o2.start();
    return g;
  }
  amb={ day:windChain(false), night:windChain(true), drone:drone(48) };
  ambBus.gain.value=0.0;
  scheduleAmbOne();
}
// Occasional one-shots so the bed is not a texture loop: a bird by day, a far
// howl by night. Sparse and quiet — they should register without being noticed.
function scheduleAmbOne(){
  clearTimeout(ambTimer);
  ambTimer=setTimeout(function(){
    if(ok()&&amb){
      var night=(ambPhase==="attack");
      var v=Voice(ctx.currentTime, LX+rnd(-40,40), LZ+rnd(-40,40), night?0.22:0.16);
      if(night){
        v.osc(0.05,rnd(0.8,1.4),rnd(150,230),rnd(70,110),"sawtooth",0.35).done(1.6);
      } else {
        var f=rnd(1800,3200);
        v.osc(0.028,0.055,f,f*1.35,"sine",0.01)
         .osc(0.022,0.05,f*1.4,f*0.9,"sine",0.012).done(0.4);
      }
    }
    scheduleAmbOne();
  }, rnd(4000,13000));
}
// Self-starting on purpose. The game calls this when the phase changes, and the
// first phase change usually happens before the browser has let us open an
// audio context at all — so if the bed does not exist yet, build it here rather
// than waiting for a second change that may never come.
function ambience(phase,dayP){
  ambPhase=phase||"build"; ambDayP=dayP||0;
  if(!ok()) return false;
  if(!amb) startAmbience();
  if(!amb) return false;
  var t=ctx.currentTime, night=(phase==="attack");
  var over=(phase==="won"||phase==="lost"||phase==="menu");
  var bed=over?0:0.5;
  ambBus.gain.setTargetAtTime(bed,t,1.2);
  amb.day.gain.setTargetAtTime(night?0.004:0.055,t,night?2.5:4.0);
  amb.night.gain.setTargetAtTime(night?0.075:0.010,t,2.5);
  amb.drone.gain.setTargetAtTime(night?0.030:0.0001,t,3.0);
  return true;
}

// ===========================================================================
// The sounds. Each one is a material first and an event second: wood, stone,
// gut, iron. The comments say what is being imitated, because the numbers on
// their own are unreadable six months later.
// ===========================================================================
var API={
  init:function(){ if(build()) startAmbience(); },
  resume:function(){ resume(); startAmbience(); },
  listen:listen,
  ambience:ambience,
  setVolume:function(v){
    vol=Math.max(0,Math.min(1,v));
    muted=(vol<=0.001);
    if(master) master.gain.setTargetAtTime(vol,ctx.currentTime,0.05);
  },
  volume:function(){ return vol; },

  // --- building ----------------------------------------------------------
  // A mallet on a timber peg: two strikes, the second lighter, and the dull
  // ring of the post it went into.
  place:function(x,z){
    var v=begin("place",90,3,x,z); if(!v) return;
    v.nz(0.30,0.045,rnd(320,420),160,1.1,"bandpass",0.001)
     .osc(0.16,0.14,rnd(150,190),90,"triangle",0.002)
     .ticks(2,0.09,0.10,600,1400,0.03)
     .done(0.25);
  },
  // Timber pulled down: a crack, then the rubble settling.
  remove:function(x,z){
    var v=begin("remove",120,2,x,z); if(!v) return;
    v.nz(0.26,0.09,700,220,1.4,"bandpass",0.001)
     .osc(0.10,0.22,120,60,"triangle",0.004)
     .ticks(9,0.34,0.09,500,2600,0.045)
     .done(0.45);
  },
  // A building finished: a last hammer blow and a small bright lift.
  built:function(x,z){
    var v=begin("built",150,2,x,z); if(!v) return;
    v.nz(0.20,0.05,380,200,1.0,"bandpass",0.001)
     .osc(0.09,0.30,rnd(300,340),rnd(440,470),"triangle",0.02)
     .done(0.4);
  },

  // --- guns --------------------------------------------------------------
  // Tower: a crossbow. String snap, the lath flexing, and air off the bolt.
  // Ballista: the same event an octave down with rope creak and real weight.
  shot:function(kind,x,z){
    if(kind==="ballista"){
      var b=begin("bal",110,4,x,z); if(!b) return;
      b.nz(0.34,0.030,rnd(230,300),110,1.6,"bandpass",0.0008)   // timber release
       .osc(0.26,0.16,rnd(90,110),42,"triangle",0.002)          // the arm's weight
       .nz(0.13,0.20,900,300,0.8,"bandpass",0.02)               // rope and air
       .ticks(3,0.05,0.10,1200,2600,0.02)
       .done(0.35);
      return;
    }
    var v=begin("shot",90,7,x,z); if(!v) return;
    v.nz(0.62,0.018,rnd(1500,2100),700,3.2,"bandpass",0.0006)   // string
     .nz(0.34,0.055,rnd(520,680),260,1.4,"bandpass",0.001)      // lath thock
     .osc(0.11,0.05,rnd(700,900),380,"triangle",0.001)
     .done(0.12);
  },
  // An archer's bow is softer and woodier than the tower's mechanism.
  loose:function(x,z){
    var v=begin("loose",90,6,x,z); if(!v) return;
    v.nz(0.46,0.022,rnd(1100,1500),600,2.6,"bandpass",0.0008)
     .nz(0.22,0.075,rnd(380,460),200,1.2,"bandpass",0.002)
     .done(0.12);
  },

  // --- impacts -----------------------------------------------------------
  // Light: a bolt into a body — a wet slap with almost no ring.
  // Heavy: the ballista's burst — sub, a broadband crack, and debris after.
  impact:function(heavy,x,z){
    if(heavy){
      var b=begin("boom",130,4,x,z); if(!b) return;
      b.osc(0.50,0.34,rnd(70,88),30,"sine",0.002)               // the sub
       .nz(0.34,0.11,rnd(1600,2400),260,0.7,"lowpass",0.0008)   // the crack
       .nz(0.16,0.42,180,70,0.6,"lowpass",0.01)                 // the rumble
       .ticks(12,0.42,0.11,700,3200,0.05)                       // what it threw
       .done(0.7);
      return;
    }
    var v=begin("tick",70,8,x,z); if(!v) return;
    v.nz(0.40,0.035,rnd(700,1000),300,1.1,"lowpass",0.0007)
     .osc(0.14,0.05,rnd(180,240),110,"triangle",0.001)
     .done(0.1);
  },
  // Something hammering on a wall: splintering, not a tone.
  chew:function(x,z){
    var v=begin("chew",170,3,x,z); if(!v) return;
    v.nz(0.30,0.055,rnd(260,340),150,1.0,"lowpass",0.001)
     .ticks(5,0.11,0.16,900,2800,0.028)
     .done(0.2);
  },
  // The hall taking a hit: a deep timber boom you feel through the floor.
  hallHit:function(x,z){
    var v=begin("hall",240,2,x,z); if(!v) return;
    v.osc(0.44,0.42,rnd(56,68),26,"sine",0.003)
     .nz(0.20,0.16,rnd(300,420),120,0.8,"lowpass",0.002)
     .ticks(7,0.30,0.09,400,1800,0.05)
     .done(0.6);
  },
  // A melee swing: air first, and only then whatever it lands in.
  swing:function(x,z){
    var v=begin("swing",80,6,x,z); if(!v) return;
    v.nz(0.30,0.085,rnd(900,1300),300,1.5,"bandpass",0.018)     // the arc
     .nz(0.40,0.030,rnd(400,560),200,1.1,"lowpass",0.0008)      // the landing
     .done(0.15);
  },

  // --- bodies ------------------------------------------------------------
  // A death is short, wet and low. The brute's is longer and an octave under.
  death:function(kind,x,z){
    var v=begin("die",70,7,x,z); if(!v) return;
    if(kind==="brute"){
      v.osc(0.30,0.40,rnd(95,125),40,"sawtooth",0.006)
       .nz(0.22,0.30,rnd(400,560),140,0.9,"lowpass",0.004)
       .ticks(6,0.22,0.09,300,1200,0.05)
       .done(0.55);
    } else {
      v.osc(0.15,0.17,rnd(230,340),95,"sawtooth",0.005)
       .nz(0.14,0.13,rnd(600,900),220,1.1,"lowpass",0.003)
       .done(0.25);
    }
  },
  // One of yours going down: a short grunt, formant-ish, then nothing.
  unitDown:function(x,z){
    var v=begin("down",140,4,x,z); if(!v) return;
    v.osc(0.20,0.16,rnd(210,290),rnd(120,160),"sawtooth",0.012)
     .nz(0.10,0.20,rnd(500,700),200,1.6,"bandpass",0.01)
     .done(0.3);
  },

  // --- work --------------------------------------------------------------
  // A pick working a scrap heap: grit, not a note.
  gather:function(x,z){
    var v=begin("gath",200,3,x,z); if(!v) return;
    v.nz(0.26,0.075,rnd(560,820),300,1.1,"bandpass",0.004)
     .ticks(4,0.09,0.13,700,2000,0.025)
     .done(0.18);
  },
  // A load going into the store: metal and wood into a wooden box.
  deposit:function(x,z){
    var v=begin("dep",120,3,x,z); if(!v) return;
    v.nz(0.30,0.055,rnd(300,380),170,1.0,"lowpass",0.001)
     .ticks(6,0.12,0.26,1400,4200,0.035)
     .done(0.25);
  },
  // Somebody new steps out of a building: a short signal whistle.
  muster:function(x,z){
    var v=begin("must",320,2,x,z); if(!v) return;
    var f=rnd(560,680);
    v.osc(0.13,0.16,f,f*1.35,"triangle",0.02)
     .nz(0.04,0.10,f*2,f*1.4,2.2,"bandpass",0.02)
     .done(0.3);
  },
  // An order given. A wooden click and a soft acknowledgement, not a beep —
  // this one fires more than any other sound in the game, so it has to be
  // something the ear can hear five hundred times without tiring of it.
  order:function(x,z){
    var v=begin("order",70,3,undefined,undefined,0.8); if(!v) return;
    v.nz(0.30,0.022,rnd(1100,1500),600,2.2,"bandpass",0.0007)
     .osc(0.09,0.07,rnd(330,390),rnd(430,500),"triangle",0.006)
     .done(0.15);
  },

  // --- the round ---------------------------------------------------------
  // Nightfall: a horn over a swell. Detuned, slow to open, and long enough in
  // the tail that the first attacker arrives inside it.
  waveStart:function(){
    resume();
    if(!ok()||!slot()) return;
    var t=ctx.currentTime, v=Voice(t,undefined,undefined,1);
    v.osc(0.30,1.9,58,55,"sawtooth",0.55)
     .osc(0.22,1.8,87,84,"sawtooth",0.70)
     .osc(0.16,1.7,116.5,116,"sawtooth",0.85)
     .nz(0.10,1.5,200,90,0.5,"lowpass",0.6)
     .done(2.4);
    var w=Voice(t+0.05,undefined,undefined,1);
    w.osc(0.13,1.2,233,231,"triangle",0.9).done(1.6);
  },
  // Dawn, and another day: a short lift, not a fanfare.
  dawn:function(){
    if(!ok()||!slot()) return;
    var t=ctx.currentTime, v=Voice(t,undefined,undefined,0.9);
    v.osc(0.12,1.1,196,294,"triangle",0.35)
     .osc(0.08,1.2,294,392,"triangle",0.55)
     .nz(0.05,1.0,900,2200,0.6,"bandpass",0.5)
     .done(1.6);
  },
  // The last nest down. Low, wide and slow — the pressure coming off.
  win:function(){
    if(!ok()||!slot()) return;
    var t=ctx.currentTime;
    [[65,0],[98,0.16],[131,0.32],[196,0.5]].forEach(function(p){
      var v=Voice(t+p[1],undefined,undefined,1);
      v.osc(0.18,1.9,p[0],p[0]*1.002,"triangle",0.25).done(2.2);
    });
    var s=Voice(t+0.5,undefined,undefined,1);
    s.nz(0.05,2.0,1200,3000,0.5,"bandpass",0.8).done(2.6);
  },
  // The hall gone. Everything falls.
  // ---- measurement ------------------------------------------------------
  // Render one call into an OfflineAudioContext and hand back the samples.
  // Nothing in the game uses this. It exists because "the sound did not throw"
  // is not a test: a sound has a level, a length, a brightness and a stereo
  // position, and every one of those is a number you can be wrong about.
  // `name` may also be an array of [name,args] pairs, which renders all of
  // them into the same window — the only way to hear what a volley does to the
  // limiter without waiting for a real night.
  render:function(name,args,seconds){
    var OAC=window.OfflineAudioContext||window.webkitOfflineAudioContext;
    var many=Object.prototype.toString.call(name)==="[object Array]";
    if(!OAC||(!many&&!API[name])) return null;
    var save={ctx:ctx,master:master,comp:comp,dry:dryBus,wet:wetBus,amb:ambBus,
              noise:noise,dark:noiseDark,ready:ready,voices:voices,amb2:amb};
    var sr=44100, len=Math.round(sr*(seconds||1.5));
    var oc=new OAC(2,len,sr);
    ctx=null; ready=false; amb=null; voices=0; burstAt={}; burstN={};
    offline=true;
    build(oc);
    var out=null;
    try{
      if(many) for(var i=0;i<name.length;i++){
        var c=name[i];
        if(API[c[0]]) API[c[0]].apply(API,c[1]||[]);
      }
      else API[name].apply(API,args||[]);
      out=oc.startRendering();
    }catch(e){ out=null; }
    var restore=function(){
      offline=false;
      ctx=save.ctx; master=save.master; comp=save.comp; dryBus=save.dry;
      wetBus=save.wet; ambBus=save.amb; noise=save.noise; noiseDark=save.dark;
      ready=save.ready; voices=save.voices; amb=save.amb2;
      burstAt={}; burstN={};
    };
    if(!out){ restore(); return null; }
    return out.then(function(buf){
      restore();
      return {sampleRate:buf.sampleRate,
              L:Array.prototype.slice.call(buf.getChannelData(0)),
              R:Array.prototype.slice.call(buf.getChannelData(1))};
    },function(){ restore(); return null; });
  },

  lose:function(){
    if(!ok()||!slot()) return;
    var t=ctx.currentTime, v=Voice(t,undefined,undefined,1);
    v.osc(0.34,2.2,150,34,"sawtooth",0.02)
     .osc(0.20,2.4,75,26,"sine",0.05)
     .nz(0.16,2.0,300,80,0.5,"lowpass",0.05)
     .ticks(14,1.2,0.09,300,1600,0.09)
     .done(2.8);
  }
};
return API;
})();
