// ---------------------------------------------------------------------------
// net — does a second player still connect, and do both sides see one world?
//
// This is the only part of the game with no automated cover at all, and the
// riskiest part to leave that way: a regression here is silent. Nothing throws,
// no frame looks wrong, and it is only discoverable by two people sitting at
// two machines trying to start a game. Every string on that screen moved into
// the text table recently; `tools/text.mjs` proves the words resolve and proves
// nothing about whether a peer connects.
//
// So this drives the real screen. It presses Create invite, carries the code to
// the other browser by hand the way a player carries it over chat, pastes the
// reply back, presses Connect and then Set out — no back channel into HFNET,
// because the buttons and their disabled states are half of what has broken
// here before.
//
// Two pages in one headless Chromium can reach each other over loopback, but
// only with mDNS local-IP hiding turned off: otherwise both sides gather
// candidates neither can resolve and the handshake times out looking perfectly
// healthy. `openMany(2, {webrtc:true})` is that flag.
//
//   node tools/net.mjs
// ---------------------------------------------------------------------------
import { openMany, check, done } from './harness.mjs';

const { pages, errors, close } = await openMany(2, { webrtc: true });
const [H, G] = pages;
const wait = ms => new Promise(r => setTimeout(r, ms));
// A round trip is a guest intent, a host frame, a snapshot and a guest apply —
// four things on a real clock rather than a stepped one. Waiting a fixed 900ms
// works here and is a flake on a busier machine, so every "did it come back"
// polls for the answer and only gives up at the timeout.
const until = async (page, fn, arg, ms = 5000) => {
  try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; }
  catch (e) { return false; }
};
const state = p => p.evaluate(() => {
  const S = HFGAME.state();
  if (!S) return null;
  return {
    me: S.me, net: S.net, seed: S.seed, phase: S.phase, night: S.night | 0,
    diff: S.diff || null,
    supply: S.players.map(x => x.supply | 0),
    units: S.units.length,
    uids: S.units.map(u => u.uid).sort((a, b) => a - b),
    // Positions, not just a count. The guest runs startRun on the same seed, so
    // it spawns the same four people whether or not a single packet ever
    // arrives — "4 units on both sides" is what a dead channel looks like too.
    // Where those people are standing after a few seconds is not something the
    // guest can produce on its own, because it does not simulate.
    where: S.units.slice().sort((u, v) => u.uid - v.uid)
      .map(u => [Math.round(u.x * 20), Math.round(u.z * 20)]),
    cells: Object.keys(S.cells).filter(k => !S.cells[k].ref).sort(),
    roads: S.roadE.length,
    // the terrain is generated from the seed on each side rather than sent, so
    // it is the one thing that proves both worlds were built the same way
    ground: [[0, 0], [12, -7], [-20, 15], [31, 26]]
      .map(p => Math.round(__nw.ground(p[0], p[1]) * 1000)),
  };
});

// ---- the handshake ---------------------------------------------------------
await H.evaluate(() => __hf.show('net'));
await G.evaluate(() => __hf.show('net'));
await H.click('#netModeHost');
await G.click('#netModeJoin');

let shook = true, why = '';
try {
  await H.click('#netCreate');
  await H.waitForFunction(() => document.getElementById('netOffer').value.length > 50,
                          null, { timeout: 20000 });
  const offer = await H.inputValue('#netOffer');

  await G.fill('#netOfferIn', offer);
  await G.click('#netReply');
  await G.waitForFunction(() => document.getElementById('netAnswer').value.length > 50,
                          null, { timeout: 20000 });
  const answer = await G.inputValue('#netAnswer');

  await H.fill('#netAnswerIn', answer);
  await H.click('#netConnect');
  await H.waitForFunction(() => HFNET.live(), null, { timeout: 20000 });
  await G.waitForFunction(() => HFNET.live(), null, { timeout: 20000 });
  globalThis.__answer = answer;
} catch (e) { shook = false; why = e.message.split('\n')[0]; }

check('an invite and a reply connect two browsers', shook, why || 'both sides live');
if (!shook) { await close(); done(errors); }

// The handshake is done, so both of its buttons are traps: Connect would hand a
// spent reply back to a settled peer and Create invite would throw away the
// connection just made. Being disabled is the guard.
const armed = await H.evaluate(() => ({
  connect: document.getElementById('netConnect').disabled,
  create: document.getElementById('netCreate').disabled,
  start: document.getElementById('netStart').disabled,
}));
check('the handshake buttons disarm and Set out arms',
      armed.connect && armed.create && !armed.start,
      `connect ${armed.connect}, create ${armed.create}, start locked ${armed.start}`);

// ---- the round -------------------------------------------------------------
await H.click('#netStart');
await H.waitForFunction(() => HFGAME.state() && HFGAME.state().phase, null, { timeout: 15000 });
await G.waitForFunction(() => HFGAME.state() && HFGAME.state().phase, null, { timeout: 15000 });
await wait(600);

let a = await state(H), b = await state(G);
check('the host starts the round for both sides',
      a && b && a.seed === b.seed && a.me === 0 && b.me === 1 &&
      a.net === 'host' && b.net === 'guest',
      `seed ${a && a.seed}, seats ${a && a.me}/${b && b.me}`);
// The seed is sent; the terrain is not. Both sides run the same generator over
// it, and if that ever stopped being true the two players would be walking
// around different maps while agreeing about everything else.
check('...and both built the same ground from it',
      JSON.stringify(a.ground) === JSON.stringify(b.ground),
      `${a.ground.join('/')} vs ${b.ground.join('/')}`);

// Halls for both seats, placed by the host because the host owns the world.
// The commander is standing on the spot already, so filling in the progress
// lets the next frame raise it: this tool runs on a live frame loop rather
// than a stepped clock, and fifteen real seconds of watching a man build a
// house is fifteen seconds of not testing the connection.
//
// The spot is searched for rather than assumed. A player's spawn can land
// inside a nest's exclusion zone on some seeds, and the seed is different every
// run — placing blind there leaves p.site null, no hall ever stands, and the
// tool times out somewhere further down blaming whatever it was waiting on.
const raised = await H.evaluate(() => {
  const S = HFGAME.state();
  return S.players.map((p, i) => {
    p.supply = 9999;
    const cx = HF.w2gx(p.cx), cz = HF.w2gx(p.cz);
    for (let r = 0; r < 10; r++)
      for (let d = 0; d < (r ? 8 : 1); d++) {
        const gx = cx + [r, r, 0, -r, -r, -r, 0, r][d], gz = cz + [0, r, r, r, 0, -r, -r, -r][d];
        if (!HFGAME.canPlace('hall', gx, gz, p)) continue;
        HFGAME.place('hall', gx, gz, i);
        if (p.site) p.site.prog = p.site.need;   // the commander is standing there
        return true;
      }
    return false;
  });
});
const stood = raised.every(Boolean) &&
  await until(H, () => HFGAME.state().players.every(p => p.hall), null, 25000);
check('both seats get a hall up', stood,
      stood ? 'host and guest both have somewhere to build from'
            : `placed ${raised.join('/')} — no legal hall spot on this seed`);
if (!stood) { await close(); done(errors); }

// ---- a guest never mutates the world --------------------------------------
// The rule this checks is the whole shape of the netcode: a guest action calls
// intent() and returns, and the host runs the same function a local click runs.
// So the guest's own click must NOT show up in the guest's own world until the
// answer comes back — if it does, the two sides have started disagreeing and
// only a full snapshot will hide it.
//
// The spot is chosen on the host, by asking the host whether seat 1 could
// legally build there. A refused placement and a lost intent look identical
// from the guest — both are "the building never appeared" — and the seed is
// different every run, so a hard-coded offset lands inside a nest's exclusion
// zone some fraction of the time and blames the netcode for it.
const spot = await H.evaluate(() => {
  const S = HFGAME.state(), p = S.players[1];
  const hx = p.hall.gx, hz = p.hall.gz;
  for (let r = 3; r < 12; r++)
    for (let d = 0; d < 8; d++) {
      const gx = hx + [r, r, 0, -r, -r, -r, 0, r][d], gz = hz + [0, r, r, r, 0, -r, -r, -r][d];
      if (HFGAME.canPlace('cottage', gx, gz, p)) return { gx, gz };
    }
  return null;
});
check('there is somewhere legal for the guest to build',
      !!spot, spot ? `cell ${spot.gx},${spot.gz}` : 'nowhere within 12 cells of its hall');

const gp = spot ? await G.evaluate(s => {
  const S = HFGAME.state();
  const before = Object.keys(S.cells).length;
  const ret = HFGAME.place('cottage', s.gx, s.gz);   // the guest's own click
  return { ret, before, after: Object.keys(S.cells).length };
}, spot) : { ret: null, before: 0, after: -1 };
check('a guest click changes nothing on the guest',
      gp.ret === false && gp.after === gp.before,
      `place() returned ${gp.ret}, ${gp.before} cells before and ${gp.after} after`);

const key = spot ? spot.gx + ',' + spot.gz : '';
const landed = spot ? [
  await until(H, k => !!HFGAME.state().cells[k], key),
  await until(G, k => !!HFGAME.state().cells[k], key),
] : [false, false];
check('...and reaches the world by way of the host',
      landed[0] && landed[1],
      `host has it ${landed[0]}, guest sees it back ${landed[1]}`);

// ---- ownership -------------------------------------------------------------
// applyIntent runs the same function a local click runs, so every case there
// has to re-verify the target belongs to the sender. This aims a guest's
// intent at the HOST's hall — the one building whose loss ends a round.
const theft = await H.evaluate(() => {
  const S = HFGAME.state(), h = S.players[0].hall;
  const before = Object.keys(S.cells).length;
  HFGAME.applyIntent({ m: 'rm', gx: h.gx, gz: h.gz }, 1);      // seat 1 asking
  const mid = Object.keys(S.cells).length;
  HFGAME.applyIntent({ m: 'rm', gx: h.gx, gz: h.gz }, 0);      // the owner asking
  return { before, mid, after: Object.keys(S.cells).length, stillHall: !!S.players[0].hall };
});
check('a guest cannot pull down the host\'s hall',
      theft.mid === theft.before && theft.after < theft.before,
      `seat 1 changed nothing, seat 0 removed it`);

// ---- roads over the wire ---------------------------------------------------
// Roads are the newest intent pair and the only state rebuilt wholesale from
// every snapshot, which is exactly the shape that goes stale quietly.
await G.evaluate(() => {
  const p = HFGAME.state().players[1];
  HFGAME.queueRoad(p.cx + 2, p.cz + 2, p.cx + 14, p.cz + 2);
});
const laid = await until(G, () => HFGAME.state().roadE.length === 1);
const road = await G.evaluate(() => {
  const e = HFGAME.state().roadE[0];
  return e ? { own: e.own, a: e.a, b: e.b } : { own: -1, a: 0, b: 0 };
});
check('a road the guest drags is laid by the host and comes back',
      laid && road.own === 1, `owned by seat ${road.own}`);

await G.evaluate(e => HFGAME.cancelRoad(e.a, e.b), road);
const gone = await until(G, () => HFGAME.state().roadE.length === 0);
const hostGone = await until(H, () => HFGAME.state().roadE.length === 0);
check('...and calling it off travels the same way', gone && hostGone,
      `guest cleared ${gone}, host cleared ${hostGone}`);

// ---- the two worlds agree --------------------------------------------------
// The guest runs no simulation at all: it draws whatever the last snapshot
// said. So after a few seconds of a live round the two states are not merely
// close, they are the same list of things.
const spawn = b.where;                    // where the guest put them on its own
await wait(2500);
a = await state(H); b = await state(G);
const same = k => JSON.stringify(a[k]) === JSON.stringify(b[k]);
// Two claims, and only together do they mean anything: the guest's people are
// standing exactly where the host's are, AND they are not standing where the
// guest first drew them. The second is what tells a live channel apart from a
// guest quietly running its own copy of the same seed.
const moved = JSON.stringify(b.where) !== JSON.stringify(spawn);
check('host and guest hold the same units, in the same places',
      a.units === b.units && same('uids') && same('where') && moved,
      `${a.units} units, moved since the round opened ${moved}`);
check('...the same buildings', same('cells'), `${a.cells.length} vs ${b.cells.length}`);
check('...and the same supply on both books', same('supply'),
      `${a.supply.join('/')} vs ${b.supply.join('/')}`);
// The host's hall came down in the ownership check above, which is not
// something the guest could have arrived at on its own from the seed.
check('...and the guest saw the host\'s hall come down',
      !b.cells.some(k => a.cells.indexOf(k) < 0) && b.cells.length === a.cells.length,
      `${b.cells.length} buildings on both sides`);

// ---- the reply guard -------------------------------------------------------
// A reply written for a replaced invite is accepted by the SDP layer without
// complaint and simply never connects — a two-minute silence instead of a
// sentence. The id echoed through the codes is what turns that into words, and
// this is the check that it still does.
const stale = await H.evaluate(async (old) => {
  HFNET.reset();
  const fresh = await HFNET.host();          // a new invite kills the old reply
  let msg = null;
  try { await HFNET.accept(old); } catch (e) { msg = e.message; }
  return { made: fresh.length > 50, msg };
}, globalThis.__answer);
check('a reply written for a replaced invite is refused in words',
      stale.made && !!stale.msg && /different invite|does not match/.test(stale.msg),
      stale.msg ? '"' + stale.msg.slice(0, 58) + '…"' : 'it was accepted');

await close();
done(errors);
