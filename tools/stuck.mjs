// ---------------------------------------------------------------------------
// stuck — do units that were told to go somewhere actually get there, over a
// whole run, without anyone ordering them about?
//
// pathing.mjs asks whether a single unit can solve a single shaped obstacle.
// That is not what a player sees. A player builds a town, right-clicks a pile,
// and watches a dozen workers do the same round trip a hundred times; what they
// report is "units get stuck", and it is never the case pathing.mjs poses.
//
// So this one poses no case at all. It builds a town, puts the crew on the
// piles the way a player does, runs the clock, and watches every unit whose own
// mode says it is on its way somewhere. Two ways to fail, and they look very
// different from the inside:
//
//   MILLING  moving the whole time and getting nowhere — rocking against the
//            corner of a building inside a tenth of a unit. This is the one a
//            player calls stuck, and the one nothing here used to catch: the
//            old watchdog asked whether the unit had MOVED, and a milling unit
//            moves plenty.
//   holding  standing still on purpose, because there is genuinely no route —
//            a shut gate, a pile walled in. Not a bug. Grinding at it would be.
//
//   node tools/stuck.mjs
// ---------------------------------------------------------------------------
import { open, check, done } from './harness.mjs';

const { page, errors, close } = await open();

// One run of one town. Returns every stall it saw, split by kind.
const run = (scenario, seconds = 220) => page.evaluate(a => {
  HF.setStat('fog', 'on', 0);
  __nw.start(4242);
  const S = __nw.state();
  S.players[0].supply = 999999;
  __nw.hall(0, 0); __nw.run(26);

  // A real crew. One worker proves nothing about a round trip a dozen of them
  // are making at once.
  for (const p of [[5,-5],[-5,-6],[6,4],[-6,5],[0,-8]]) __nw.place('cottage', p[0], p[1]);
  __nw.run(50);

  const R = 10;
  if (a.scenario === 'walled' || a.scenario === 'sealed') {
    // A ring this tight leaves every pile outside it, so the whole crew crosses
    // the line twice a trip — which is the leg that had no route at all.
    for (let t = 0; t < 6.2832; t += 0.16) __nw.place('wall', Math.cos(t) * R, Math.sin(t) * R);
    if (a.scenario === 'walled') {
      // Cut the gate INTO the finished ring. Leaving an arc-shaped gap and
      // dropping a two-cell gate into it does not seal: the crew walks through
      // the leftover sliver rather than the door, and a fix that changed
      // nothing reads as a fix that worked.
      HFGAME.removeAt(HF.w2gx(R), HF.w2gx(0));
      HFGAME.removeAt(HF.w2gx(R), HF.w2gx(1.5));
      __nw.place('gate', R, 0);
    }
  } else if (a.scenario === 'dense') {
    for (let x = -9; x <= 9; x += 4) for (let z = -9; z <= 9; z += 4)
      if (Math.hypot(x, z) > 4) __nw.place('barracks', x, z);
  }
  __nw.run(60);

  const workers = S.units.filter(u => u.t === 'worker');
  const piles = S.nodes.filter(n => n.amt > 0);
  workers.forEach((u, i) => HFGAME.assignJob([u], piles[i % piles.length]));

  const MOVING = { toNode:1, toHall:1, toFix:1, toHome:1, flee:1, road:1 };
  const track = new Map(), rows = [];
  const WIN = 12;                              // seconds of no progress to care
  const g0 = S.gathered;

  for (let step = 0; step < 30 * a.seconds; step++) {
    // Hold the clock and the hall. This is a pathfinding run, not a pace one,
    // and a round that reaches nightfall and loses stops simulating — after
    // which every unit on the map reads as a unit that never moved.
    S.dayLeft = S.dayLen;
    const h = S.players[0].hall; if (h) h.hp = h.max;
    __nw.run(1 / 30);
    if (step % 6) continue;
    const t = step / 30;
    for (const u of S.units) {
      if (u.inside || u.tur || u.dock) { track.delete(u); continue; }
      const st = track.get(u);
      if (!st || !MOVING[u.mode] || st.mode !== u.mode ||
          Math.hypot(u.x - st.x, u.z - st.z) > 0.7) {
        track.set(u, { x: u.x, z: u.z, t, mode: u.mode });
        continue;
      }
      if (t - st.t > WIN && !st.logged) {
        st.logged = true;
        const hb = S.players[0].hall;
        const goal = u.mode === 'toNode' && u.job ? [u.job.x, u.job.z]
                   : u.mode === 'toHall' && hb ? HFGAME.bCentre(hb)
                   : u.mode === 'toFix'  && u.fix ? HFGAME.bCentre(u.fix)
                   : [u.px, u.pz];
        const route = HFGAME.findPath(u.x, u.z, goal[0], goal[1]);
        rows.push({
          holding: (u.noRoute || 0) > 0,
          t: +t.toFixed(1), unit: u.t, mode: u.mode,
          at: [+u.x.toFixed(1), +u.z.toFixed(1)],
          goal: [+goal[0].toFixed(1), +goal[1].toFixed(1)],
          route: route ? route.length
                       : (HFGAME.losClear(u.x, u.z, goal[0], goal[1]) ? 'straight' : 'none')
        });
      }
    }
    if (rows.length > 60) break;
  }
  return { milling: rows.filter(r => !r.holding), holding: rows.filter(r => r.holding).length,
           gained: Math.round(S.gathered - g0), workers: workers.length };
}, { scenario, seconds });

const one = r => r.milling.length
  ? `${r.milling.length} milling, first ${r.milling[0].unit} ${r.milling[0].mode} at ` +
    `(${r.milling[0].at}) route=${r.milling[0].route}`
  : `${r.workers} workers, ${r.gained} salvage delivered, ${r.holding} standing on no route`;

// ---- 1. open ground --------------------------------------------------------
const openrun = await run('open');
check('a crew works an open map without a single unit milling',
      openrun.milling.length === 0 && openrun.gained > 0, one(openrun));

// ---- 2. packed with buildings ----------------------------------------------
// 2x2 barracks on a four-unit grid: gaps a unit fits through and corners it can
// catch on, which is what a built-up town actually is.
const dense = await run('dense');
check('a crew works a town packed with 2x2 buildings without milling',
      dense.milling.length === 0 && dense.gained > 0, one(dense));

// ---- 3. every pile outside your own wall -----------------------------------
// The deposit leg used to skip routing entirely unless the map had roads on it,
// so a loaded worker steered straight at the hall, walked into its own wall,
// and stayed there. This is the case that found that.
const walled = await run('walled');
check('a loaded worker finds its way home through a wall with a gate in it',
      walled.milling.length === 0 && walled.gained > 0, one(walled));

// ---- 4. no way through at all ----------------------------------------------
// A sealed ring holds your own people out — that is what a sealed ring is for.
// The requirement is that they STAND rather than grind on it.
const sealed = await run('sealed');
check('a sealed wall makes units stand, not grind',
      sealed.milling.length === 0, one(sealed));

// ---- 5. and they pick the errand back up when the door opens ---------------
// The hold has to be a hold, not a hang: a worker that stops for good the first
// time a gate is shut has traded a visible bug for an invisible one.
const reopen = await page.evaluate(() => {
  HF.setStat('fog', 'on', 0);
  __nw.start(4242);
  const S = __nw.state();
  S.players[0].supply = 999999;
  __nw.hall(0, 0); __nw.run(26);
  for (const p of [[5,-5],[-5,-6],[6,4],[-6,5],[0,-8]]) __nw.place('cottage', p[0], p[1]);
  __nw.run(50);
  const R = 10;
  for (let t = 0; t < 6.2832; t += 0.16) __nw.place('wall', Math.cos(t) * R, Math.sin(t) * R);
  HFGAME.removeAt(HF.w2gx(R), HF.w2gx(0));
  HFGAME.removeAt(HF.w2gx(R), HF.w2gx(1.5));
  __nw.place('gate', R, 0);
  __nw.run(40);
  const workers = S.units.filter(u => u.t === 'worker');
  const piles = S.nodes.filter(n => n.amt > 0);
  workers.forEach((u, i) => HFGAME.assignJob([u], piles[i % piles.length]));
  const hold = n => { for (let i = 0; i < 30 * n; i++) {
    S.dayLeft = S.dayLen; const h = S.players[0].hall; if (h) h.hp = h.max; __nw.run(1 / 30); } };
  hold(90);
  const out = u => Math.hypot(u.x, u.z) > R + 0.6;
  const stranded = workers.filter(u => out(u) && u.mode === 'toHall' && u.carry > 0);
  let gate = null;
  for (const k in S.cells) { const c = S.cells[k]; if (!c.ref && c.type === 'gate') gate = c; }
  HFGAME.setGate(gate, false);
  hold(90);
  return { stranded: stranded.length, home: stranded.filter(u => !out(u) || u.carry === 0).length };
});
check('workers held out by a shut gate come back once it opens',
      reopen.stranded > 0 && reopen.home === reopen.stranded,
      `${reopen.home}/${reopen.stranded} stranded workers finished the trip`);

// ---- 6. what routing the errands costs -------------------------------------
// Every leg of every errand now plans, where the loaded half used to steer
// blind. That is a dozen more A* customers on a packed map, and the throttle in
// stepPath is the only thing keeping it to one plan per unit per half second
// rather than one per frame — which is the difference between this and a hang.
const cost = await page.evaluate(() => {
  HF.setStat('fog', 'on', 0);
  __nw.start(4242);
  const S = __nw.state();
  S.players[0].supply = 999999;
  __nw.hall(0, 0); __nw.run(26);
  for (const p of [[5,-5],[-5,-6],[6,4],[-6,5],[0,-8]]) __nw.place('cottage', p[0], p[1]);
  __nw.run(50);
  for (let x = -9; x <= 9; x += 4) for (let z = -9; z <= 9; z += 4)
    if (Math.hypot(x, z) > 4) __nw.place('barracks', x, z);
  __nw.run(60);
  const ws = S.units.filter(u => u.t === 'worker'), piles = S.nodes.filter(n => n.amt > 0);
  ws.forEach((u, i) => HFGAME.assignJob([u], piles[i % piles.length]));
  const t0 = performance.now();
  for (let i = 0; i < 30 * 60; i++) {
    S.dayLeft = S.dayLen; const h = S.players[0].hall; if (h) h.hp = h.max;
    __nw.run(1 / 30);
  }
  return { units: S.units.length, ms: (performance.now() - t0) / (30 * 60) };
});
check('a full crew running errands round a packed town is not a frame cost',
      cost.ms < 1.2, `${cost.units} units, ${cost.ms.toFixed(2)}ms a frame`);

await close();
done(errors);
