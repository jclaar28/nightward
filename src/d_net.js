// ============================================================================
// NETWORK — two browsers, no server
// ----------------------------------------------------------------------------
// There is nothing between the two players but a peer connection they set up by
// hand: one side makes an invite, the other pastes it back a reply, and after
// that the data channel carries the whole game. No matchmaking, no relay we
// pay for, nothing to keep running.
//
// The host owns the simulation. It runs the same loop it runs single-player
// and ships a snapshot fifteen times a second. The guest runs no simulation at
// all: it sends what its player clicked and draws whatever the last snapshot
// said. That keeps the two worlds identical by construction — there is only
// one world, and the guest is looking at a photograph of it.
// ============================================================================
var HFNET=(function(){
"use strict";

var ICE=[{urls:"stun:stun.l.google.com:19302"},
         {urls:"stun:stun1.l.google.com:19302"}];

var TICK=1/15;            // snapshot rate
var FULL_EVERY=2.0;       // a complete picture this often, so a dropped
                          // building update can never stick

var pc=null, ch=null, role=null, hooks={};
// Every invite carries a random id, and the reply echoes it back. Without it a
// reply written for a replaced invite is accepted by the SDP layer without
// complaint and simply never connects — a two-minute silence instead of a
// sentence telling you what went wrong.
var sid=null;
var acc=0, fullT=0, live=false, started=false;
var pending=[];           // intents that arrived before the round existed
var stat={sent:0,recv:0,bytes:0,rate:0,rt:0};

// ---- codes ----------------------------------------------------------------
// The blob the players paste to each other. Base64 keeps line breaks and
// smart-quoting chat clients from mangling the SDP.
function enc(o){
  return "NW1"+btoa(unescape(encodeURIComponent(JSON.stringify(o))));
}
function dec(t){
  t=(t||"").replace(/\s+/g,"");
  if(t.slice(0,3)==="NW1") t=t.slice(3);
  return JSON.parse(decodeURIComponent(escape(atob(t))));
}

function say(msg,kind){ if(hooks.status) hooks.status(msg,kind||"info"); }

// ---- connection -----------------------------------------------------------
function mkPC(){
  pc=new RTCPeerConnection({iceServers:ICE});
  pc.onconnectionstatechange=function(){
    var s=pc.connectionState;
    if(s==="failed"||s==="disconnected"||s==="closed") drop(s);
  };
}

// Trickle ICE needs a signalling server we do not have, so we wait for the
// candidates to finish gathering and bake them into the one blob we hand over.
function gathered(){
  return new Promise(function(res){
    if(pc.iceGatheringState==="complete") return res();
    var done=false;
    function fin(){ if(done) return; done=true; res(); }
    var t=setTimeout(fin,4000);
    pc.onicegatheringstatechange=function(){
      if(pc.iceGatheringState==="complete"){ clearTimeout(t); fin(); }
    };
  });
}

function wireChannel(c){
  ch=c;
  ch.binaryType="arraybuffer";
  ch.onopen=function(){
    live=true;
    say(role==="host"?"Connected — starting the round":"Connected — waiting for the host","good");
    if(hooks.open) hooks.open(role);
  };
  ch.onclose=function(){ drop("closed"); };
  ch.onmessage=function(ev){
    stat.recv++;
    var m; try{ m=JSON.parse(ev.data); }catch(e){ return; }
    handle(m);
  };
}

function host(){
  reset();
  role="host";
  sid=Math.random().toString(36).slice(2,10);
  mkPC();
  wireChannel(pc.createDataChannel("nw",{ordered:true}));
  say("Making an invite…");
  return pc.createOffer()
    .then(function(o){ return pc.setLocalDescription(o); })
    .then(gathered)
    .then(function(){
      say("Send this invite to the other player, then paste their reply below.");
      return enc({t:"o",s:pc.localDescription.sdp,id:sid});
    });
}

function join(code){
  reset();
  role="guest";
  mkPC();
  pc.ondatachannel=function(ev){ wireChannel(ev.channel); };
  var off;
  try{ off=dec(code); }catch(e){ return Promise.reject(new Error("That invite code is not readable.")); }
  if(!off||off.t!=="o"||!off.s) return Promise.reject(new Error("That is not an invite code."));
  sid=off.id||null;                       // echoed back so the host can match
  say("Reading the invite…");
  return pc.setRemoteDescription({type:"offer",sdp:off.s})
    .then(function(){ return pc.createAnswer(); })
    .then(function(a){ return pc.setLocalDescription(a); })
    .then(gathered)
    .then(function(){
      say("Send this reply back to the host and wait.");
      return enc({t:"a",s:pc.localDescription.sdp,id:sid});
    });
}

// A reply can only be taken once, and only by a host that is still waiting for
// one. Everything below is checked here rather than left to the SDP layer,
// which answers a second attempt with "Called in wrong state: stable" — true,
// and no use whatsoever to somebody trying to play a game.
function accept(code){
  if(!pc||role!=="host")
    return Promise.reject(new Error("Press Create invite first, then paste their reply here."));
  if(pc.signalingState!=="have-local-offer"){
    return Promise.reject(new Error(live
      ? "You are already connected — press Start the round."
      : "This invite has already been answered. Press Create invite for a fresh one."));
  }
  var ans;
  try{ ans=dec(code); }catch(e){ return Promise.reject(new Error("That reply code is not readable.")); }
  if(!ans||ans.t!=="a"||!ans.s) return Promise.reject(new Error("That is not a reply code."));
  if(sid && ans.id && ans.id!==sid)
    return Promise.reject(new Error("That reply was written for a different invite. "+
      "Send them the invite showing above and paste the reply to that one."));
  say("Connecting…");
  return pc.setRemoteDescription({type:"answer",sdp:ans.s}).catch(function(){
    // the usual cause is a reply written for an invite that has since been
    // replaced, which the SDP layer reports as a credential mismatch
    throw new Error("That reply does not match this invite. If you pressed "+
                    "Create invite again, send them the new one.");
  });
}

function drop(why){
  if(!role) return;
  var wasLive=live;
  live=false;
  say(wasLive?"The other player disconnected.":"The connection failed ("+why+").","bad");
  if(hooks.closed) hooks.closed(wasLive);
  role=null; started=false;
}

function reset(){
  // Take the handlers off before closing. Closing a peer connection raises its
  // state change on a later task, so the old connection's death notice used to
  // arrive after a new one had already been built and land on that one instead:
  // drop() would clear the fresh role, and from then on no reply could ever be
  // accepted. Pressing Create invite twice was enough to do it.
  var oc=ch, op=pc;
  ch=null; pc=null; role=null; live=false; started=false; sid=null;
  acc=0; fullT=0; pending.length=0;
  try{ if(oc){ oc.onopen=oc.onclose=oc.onmessage=null; oc.close(); } }catch(e){}
  try{ if(op){ op.onconnectionstatechange=null; op.onicegatheringstatechange=null;
               op.ondatachannel=null; op.close(); } }catch(e){}
}

function send(o){
  if(!ch||ch.readyState!=="open") return false;
  var s=JSON.stringify(o);
  try{ ch.send(s); }catch(e){ return false; }
  stat.sent++; stat.bytes+=s.length;
  return true;
}

// ---- messages -------------------------------------------------------------
function handle(m){
  if(m.k==="init"){                       // host → guest, once, at kickoff
    started=true;
    if(hooks.begin) hooks.begin({seed:m.seed, map:m.map, seat:1, diff:m.diff});
    send({k:"ready"});
    return;
  }
  if(m.k==="snap"){
    if(started) HFGAME.applySnapshot(m.d);
    return;
  }
  if(m.k==="int"){                        // guest → host
    if(!started){ pending.push(m.d); return; }
    HFGAME.applyIntent(m.d,1);
    return;
  }
  if(m.k==="ready"){                      // guest is in; flush anything queued
    for(var i=0;i<pending.length;i++) HFGAME.applyIntent(pending[i],1);
    pending.length=0;
    send({k:"snap",d:HFGAME.snapshot(true)});
    return;
  }
  if(m.k==="bye"){ drop("left"); }
}

// The host starts the round for both sides: it builds the world, then tells
// the guest which seed and map to build so the two terrains are the same.
function beginHost(seed,map,diff){
  started=true;
  if(hooks.begin) hooks.begin({seed:seed, map:map, seat:0, diff:diff});
  send({k:"init", seed:seed, map:map||null, diff:diff||"normal"});
}

// Called once a frame while a networked round is running.
function tick(dt){
  if(!live||!started||role!=="host") return;
  acc+=dt; fullT+=dt;
  if(acc<TICK) return;
  acc=0;
  var full=false;
  if(fullT>=FULL_EVERY){ fullT=0; full=true; }
  var sn=HFGAME.snapshot(full);
  if(sn) send({k:"snap",d:sn});
}

// The guest's own clicks, on their way to the only machine that can act on
// them. HFGAME calls this; it never mutates the world itself.
function sendIntent(msg){ send({k:"int",d:msg}); }

function leave(){
  if(ch&&ch.readyState==="open") send({k:"bye"});
  reset();
}

function init(h){ hooks=h||{}; }

return {
  init:init, host:host, join:join, accept:accept,
  beginHost:beginHost, tick:tick, sendIntent:sendIntent,
  leave:leave, reset:reset,
  live:function(){ return live; },
  role:function(){ return role; },
  active:function(){ return !!role && started; },
  stats:function(){ return stat; }
};
})();
