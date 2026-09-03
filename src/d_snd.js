// ===========================================================================
// Nightward — procedural audio. Every sound is synthesised at play time from
// oscillators and a noise buffer, so the build stays a single file with no
// asset downloads. Browsers refuse to start audio before a gesture, so the
// context is created lazily on the first real interaction.
// ===========================================================================
var HFSND=(function(){
"use strict";
var ctx=null, master=null, noise=null, vol=0.7, ready=false, muted=false;
var voices=0, VOICE_CAP=18;
var lastAt={};

function build(){
  if(ctx) return true;
  var AC=window.AudioContext||window.webkitAudioContext;
  if(!AC) return false;
  try{ ctx=new AC(); }catch(e){ return false; }
  master=ctx.createGain();
  master.gain.value=vol;
  master.connect(ctx.destination);
  // one second of white noise, reused by every percussive sound
  var n=Math.floor(ctx.sampleRate);
  noise=ctx.createBuffer(1,n,ctx.sampleRate);
  var d=noise.getChannelData(0);
  for(var i=0;i<n;i++) d[i]=Math.random()*2-1;
  ready=true;
  return true;
}
function resume(){
  if(!build()) return;
  if(ctx.state==="suspended") ctx.resume();
}
function ok(){ return ready && !muted && ctx && ctx.state==="running"; }

// Rate limit: a hundred simultaneous tower shots should read as a volley, not
// as clipping. Same-named sounds inside the window collapse into one.
function gate(name,ms){
  var t=(ctx?ctx.currentTime:0)*1000;
  if(lastAt[name]!==undefined && t-lastAt[name]<ms) return false;
  lastAt[name]=t;
  return true;
}
function slot(){
  if(voices>=VOICE_CAP) return false;
  voices++;
  return true;
}
function release(g,when){
  setTimeout(function(){ voices=Math.max(0,voices-1); try{g.disconnect();}catch(e){} },
             Math.max(40,when*1000+90));
}

function env(node,t0,peak,attack,decay){
  var g=ctx.createGain();
  g.gain.setValueAtTime(0.0001,t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002,peak),t0+attack);
  g.gain.exponentialRampToValueAtTime(0.0001,t0+attack+decay);
  node.connect(g);
  g.connect(master);
  return g;
}
function burst(t0,peak,dur,freq,q,type){
  var src=ctx.createBufferSource();
  src.buffer=noise;
  src.loop=true;
  var f=ctx.createBiquadFilter();
  f.type=type||"bandpass";
  f.frequency.setValueAtTime(freq,t0);
  f.Q.value=q||1.2;
  src.connect(f);
  var g=env(f,t0,peak,0.004,dur);
  src.start(t0);
  src.stop(t0+dur+0.05);
  release(g,dur);
  return {g:g,f:f};
}
function tone(t0,peak,dur,f0,f1,type){
  var o=ctx.createOscillator();
  o.type=type||"sine";
  o.frequency.setValueAtTime(f0,t0);
  if(f1!==undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20,f1),t0+dur);
  var g=env(o,t0,peak,0.006,dur);
  o.start(t0);
  o.stop(t0+dur+0.05);
  release(g,dur);
  return {g:g,o:o};
}

var API={
  init:function(){ build(); },
  resume:resume,
  setVolume:function(v){
    vol=Math.max(0,Math.min(1,v));
    muted=(vol<=0.001);
    if(master) master.gain.value=vol;
  },
  volume:function(){ return vol; },

  // --- build phase -------------------------------------------------------
  place:function(){
    if(!ok()||!gate("place",40)||!slot()) return;
    var t=ctx.currentTime;
    burst(t,0.16,0.09,320,0.9,"lowpass");
    tone(t,0.09,0.10,180,120,"triangle");
  },
  remove:function(){
    if(!ok()||!gate("remove",40)||!slot()) return;
    var t=ctx.currentTime;
    burst(t,0.13,0.13,700,1.6);
  },

  // --- combat ------------------------------------------------------------
  shot:function(kind){
    if(!ok()) return;
    if(kind==="ballista"){
      if(!gate("bal",70)||!slot()) return;
      var t=ctx.currentTime;
      tone(t,0.26,0.16,150,58,"square");
      burst(t,0.20,0.13,420,0.8,"lowpass");
    } else {
      if(!gate("shot",55)||!slot()) return;
      var t2=ctx.currentTime;
      burst(t2,0.10,0.055,1750,2.4);
      tone(t2,0.05,0.05,760,420,"triangle");
    }
  },
  impact:function(heavy){
    if(!ok()) return;
    if(heavy){
      if(!gate("boom",80)||!slot()) return;
      var t=ctx.currentTime;
      tone(t,0.30,0.30,96,38,"sine");
      burst(t,0.22,0.20,300,0.7,"lowpass");
    } else {
      if(!gate("tick",70)||!slot()) return;
      burst(ctx.currentTime,0.055,0.045,1150,3.0);
    }
  },
  death:function(kind){
    if(!ok()||!gate("die",90)||!slot()) return;
    var t=ctx.currentTime;
    if(kind==="brute"){
      tone(t,0.20,0.34,132,52,"sawtooth");
      burst(t,0.16,0.26,520,0.9,"lowpass");
    } else {
      tone(t,0.10,0.16,300+Math.random()*90,110,"sawtooth");
      burst(t,0.09,0.13,900,1.4);
    }
  },
  chew:function(){
    if(!ok()||!gate("chew",150)||!slot()) return;
    burst(ctx.currentTime,0.05,0.10,240,0.8,"lowpass");
  },
  // --- defenders ---------------------------------------------------------
  order:function(){
    if(!ok()||!gate("order",60)||!slot()) return;
    var t=ctx.currentTime;
    tone(t,0.10,0.10,620,880,"triangle");
  },
  swing:function(){
    if(!ok()||!gate("swing",60)||!slot()) return;
    burst(ctx.currentTime,0.09,0.07,900,1.1,"bandpass");
  },
  loose:function(){
    if(!ok()||!gate("loose",70)||!slot()) return;
    var t=ctx.currentTime;
    burst(t,0.07,0.06,2300,2.8);
    tone(t,0.04,0.05,1150,700,"triangle");
  },
  unitDown:function(){
    if(!ok()||!gate("down",120)||!slot()) return;
    var t=ctx.currentTime;
    tone(t,0.14,0.30,360,150,"triangle");
    burst(t,0.08,0.18,700,1.0,"lowpass");
  },
  deposit:function(){
    if(!ok()||!gate("dep",90)||!slot()) return;
    var t=ctx.currentTime;
    tone(t,0.10,0.13,520,780,"triangle");
    burst(t,0.06,0.07,1500,2.0);
  },
  gather:function(){
    if(!ok()||!gate("gath",180)||!slot()) return;
    burst(ctx.currentTime,0.05,0.08,540,1.3,"lowpass");
  },
  muster:function(){
    if(!ok()||!gate("must",300)||!slot()) return;
    var t=ctx.currentTime;
    tone(t,0.11,0.20,440,660,"triangle");
  },
  hallHit:function(){
    if(!ok()||!gate("hall",220)||!slot()) return;
    var t=ctx.currentTime;
    tone(t,0.22,0.26,72,44,"sine");
  },

  // --- phase stings ------------------------------------------------------
  waveStart:function(){
    resume();
    if(!ok()||!slot()) return;
    var t=ctx.currentTime;
    tone(t,0.26,1.15,116,110,"sawtooth");
    tone(t+0.10,0.18,1.05,87,84,"sawtooth");
    burst(t,0.10,0.9,190,0.5,"lowpass");
  },
  win:function(){
    if(!ok()||!slot()) return;
    var t=ctx.currentTime;
    [262,330,392,523].forEach(function(f,i){
      tone(t+i*0.11,0.16,0.55,f,f,"triangle");
    });
  },
  lose:function(){
    if(!ok()||!slot()) return;
    var t=ctx.currentTime;
    tone(t,0.26,1.5,150,44,"sawtooth");
    burst(t,0.14,1.2,150,0.5,"lowpass");
  }
};
return API;
})();
