// ---------------------------------------------------------------------------
// roads — does the road system do the four things it exists to do?
//
// Roads are the first feature in this game that is a graph rather than cells,
// the first thing workers build with their hands rather than a timer, and the
// first thing that changes how fast a unit moves. Each of those can be wrong in
// a way that still looks fine on screen, so each is measured here:
//
//   * snapping JOINS rather than duplicating — a route that looks connected is
//   * progress only moves while a worker is standing on it
//   * a built road actually makes a hauling trip faster, in seconds
//   * a direct order still walks straight, and the flow field never sees a road
//
//   node tools/roads.mjs
// ---------------------------------------------------------------------------
import { open, check, done } from './harness.mjs';

const SEED = 4242;
const { page, errors, close } = await open();

// A round with the hall actually up. Faking the site flags leaves p.hall null,
// which silently refuses every road — worth doing properly once here.
const boot = await page.evaluate(seed => {
  __nw.start(seed);
  const S = __nw.state();
  S.players[0].supply = 9999;
  __nw.hall(0, 0);
  __nw.run(25);
  return { hall: !!S.players[0].hall, workers: S.units.filter(u => u.t === 'worker').length };
}, SEED);
check('the round opens with a hall and workers', boot.hall && boot.workers > 0,
      `hall ${boot.hall}, ${boot.workers} workers`);

// ---- the graph -------------------------------------------------------------
const graph = await page.evaluate(() => {
  const G = __hf.game, S = __nw.state();
  const okA = G.queueRoad(0, 0, 12, 0);
  const okB = G.queueRoad(12, 0, 12, 10);
  // deliberately a fraction off the (12,0) node: must reuse it, not add a twin
  const okC = G.queueRoad(12.4, 0.3, 20, 6);
  const short = G.queueRoad(30, 30, 30.4, 30);
  const long = G.queueRoad(-40, -40, 40, 40);
  const ids = S.roadN.map(n => n.id);
  return {
    placed: [!!okA, !!okB, !!okC], short: !short, long: !long,
    nodes: S.roadN.length, edges: S.roadE.length,
    shared: S.roadE.filter(e => e.a === ids[1] || e.b === ids[1]).length,
    refusalShort: G.roadRefusal(0, 0, 0.4, 0),
    refusalLong: G.roadRefusal(-40, -40, 40, 40)
  };
});
check('three drags become three edges', graph.placed.every(Boolean) && graph.edges === 3,
      `${graph.edges} edges`);
check('a near-miss endpoint joins the existing node instead of twinning it',
      graph.nodes === 4 && graph.shared === 3,
      `${graph.nodes} nodes, ${graph.shared} edges meet at the junction`);
check('a misclick-length drag is refused', graph.short && !!graph.refusalShort,
      graph.refusalShort || '');
check('so is one that spans the map', graph.long && !!graph.refusalLong,
      graph.refusalLong || '');

// ---- workers build it, and only while they are there ------------------------
const labour = await page.evaluate(() => {
  const S = __nw.state();
  const e = S.roadE[0];
  // Nobody near it: a timer would tick anyway. This is the check that tells
  // road work apart from every other construction site in the game.
  const before = e.prog;
  S.units.filter(u => u.t === 'worker').forEach(u => { u.x = -60; u.z = -60; u.shelter = true; });
  __nw.run(6);
  const idle = e.prog - before;
  // put them back on the doorstep before releasing them: the point is that
  // work needs a worker present, not that a worker can cross the map
  S.units.filter(u => u.t === 'worker').forEach(u => {
    u.shelter = false; u.inside = false; u.x = 1; u.z = 1; u.route = null;
  });
  __nw.run(30);
  const worked = e.prog - before;
  return { idle, worked, need: e.need, done: e.done,
           onJob: S.units.filter(u => u.mode === 'road').length };
});
check('an unattended road does not build itself', labour.idle < 0.01,
      `${labour.idle.toFixed(3)}s of progress with nobody there`);
check('workers walk to it and build it', labour.worked > 1,
      `${labour.worked.toFixed(1)}s progress, ${labour.onJob} on the job`);

// ---- it actually makes a trip faster ---------------------------------------
// Same worker, same two points, once off-road and once on. The road is finished
// outright rather than waiting for the crew, so this measures travel and not
// how long a road takes to lay.
const speed = await page.evaluate(() => {
  const G = __hf.game, S = __nw.state();
  const walk = (useRoad) => {
    S.roadE.forEach(e => { e.done = useRoad; e.prog = useRoad ? e.need : 0; });
    S.roadVer++;
    const u = S.units.filter(x => x.t === 'worker')[0];
    u.x = 0; u.z = 0; u.route = null;
    let t = 0;
    const U = G.UNITS.worker;
    // drive the primitive directly: this is a travel measurement, not a
    // measurement of the worker AI deciding what it feels like doing
    for (let i = 0; i < 30 * 60; i++) {
      t += 1 / 30;
      if (G.stepVia(u, U, 12, 10, 0.4)) break;
    }
    return t;
  };
  const off = walk(false), on = walk(true);
  // The road above is a dogleg, so most of its speed goes on the extra
  // distance. A road laid ALONG the route should hand over nearly the whole
  // bonus, and that is the number a regression would show up in.
  G.queueRoad(0, -20, 20, -20);
  const straightEdge = S.roadE[S.roadE.length - 1];
  const direct = (useRoad) => {
    S.roadE.forEach(e => { e.done = false; e.prog = 0; });
    straightEdge.done = useRoad; straightEdge.prog = straightEdge.need;
    S.roadVer++;
    const u = S.units.filter(x => x.t === 'worker')[0];
    u.x = 0; u.z = -20; u.route = null;
    let t = 0;
    for (let i = 0; i < 30 * 60; i++) { t += 1 / 30; if (G.stepVia(u, G.UNITS.worker, 20, -20, 0.4)) break; }
    return t;
  };
  const dOff = direct(false), dOn = direct(true);
  return { off, on, dOff, dOn, bonus: HF.statsOf('road').speed };
});
check('a finished road makes the same trip faster',
      speed.on < speed.off * 0.92,
      `dogleg: ${speed.off.toFixed(1)}s off-road vs ${speed.on.toFixed(1)}s on it ` +
      `(${Math.round((1 - speed.on / speed.off) * 100)}% quicker)`);
// speed 0.55 means 1.55x, so a trip straight along a road should take about
// 1/1.55 = 65% of the time. Allow slack for the last stop-distance metre.
check('...and a road laid along the route hands over nearly all of the bonus',
      speed.dOn < speed.dOff * 0.72,
      `direct: ${speed.dOff.toFixed(1)}s vs ${speed.dOn.toFixed(1)}s ` +
      `(${Math.round((1 - speed.dOn / speed.dOff) * 100)}% quicker, bonus ${speed.bonus})`);

// ---- the rules it must not break -------------------------------------------
const rules = await page.evaluate(() => {
  const G = __hf.game, S = __nw.state();
  S.roadE.forEach(e => { e.done = true; e.prog = e.need; });
  S.roadVer++;

  // 1. the horde never gets the bonus: an attacker parked on a road walks at
  //    exactly the speed it walks anywhere
  const onRoad = G.roadSpeed(6, 0), offRoad = G.roadSpeed(6, 40);

  // 2. a direct order is literal. Ordered straight across a road corridor, the
  //    unit must not detour along it.
  const u = S.units.filter(x => x.t === 'worker')[0];
  u.x = 6; u.z = -9; u.route = null; u.shelter = false;
  G.orderTo([u], 6, 9);
  let maxSide = 0, moved = 0;
  const sx = u.x, sz = u.z;
  for (let i = 0; i < 30 * 25; i++) {
    __nw.run(1 / 30);
    maxSide = Math.max(maxSide, Math.abs(u.x - 6));
    moved = Math.hypot(u.x - sx, u.z - sz);
    if (Math.hypot(u.x - 6, u.z - 9) < 1) break;
  }
  const arrived = Math.hypot(u.x - 6, u.z - 9) < 1.5;

  // 3. the flow field is byte-identical with roads present
  S.distDirty = true;
  __nw.run(1 / 30);
  const withRoads = Array.from(S.dist || []);
  const keep = S.roadE.slice();
  S.roadE = []; S.distDirty = true;
  __nw.run(1 / 30);
  const without = Array.from(S.dist || []);
  S.roadE = keep;
  let diff = 0;
  for (let i = 0; i < Math.max(withRoads.length, without.length); i++)
    if (withRoads[i] !== without[i]) diff++;

  return { onRoad, offRoad, maxSide, moved, arrived,
           fieldLen: withRoads.length, diff };
});
check('a road is worth something to walk on', rules.onRoad > 1.01 && rules.offRoad === 1,
      `on ${rules.onRoad}, off ${rules.offRoad}`);
// Zero sideways drift is also what a unit that never moved would report, and
// an earlier version of this check could not tell the two apart.
check('the ordered unit actually made the trip', rules.arrived && rules.moved > 15,
      `walked ${rules.moved.toFixed(1)}u, arrived ${rules.arrived}`);
check('...and crossed the road rather than turning down it',
      rules.maxSide < 2.5, `strayed ${rules.maxSide.toFixed(2)}u sideways`);
check('the flow field cannot see roads', rules.fieldLen > 0 && rules.diff === 0,
      `${rules.diff} of ${rules.fieldLen} cells differ`);

// ---- and it draws, without crawling ----------------------------------------
// The worn look comes from scatter, and scatter drawn from Math.random() would
// be redrawn every frame — a road that boils. It reads as deliberate in a
// screenshot and as a bug in motion, so the noise has to be a hash of position
// and this is the check that says so.
const drawn = await page.evaluate(async () => {
  const road = () => __nw.frame().rows.filter(r => r.b === 'road');
  const sig = rs => rs.map(r => [r.x, r.z, r.yaw].map(v => Math.round(v * 1000)).join(':')).join(',');
  const first = road();
  const a = sig(first);
  await new Promise(r => setTimeout(r, 400));
  __nw.run(3);                        // time passes, the world moves on
  const second = road();
  return { road: first.length, batches: Object.keys(__nw.frame().counts).length,
           stable: a === sig(second),
           spread: Math.max(...first.map(r => r.yaw)) - Math.min(...first.map(r => r.yaw)) };
});
check('the road reaches the renderer', drawn.road > 20,
      `${drawn.road} pads across ${drawn.batches} batches`);
check('the pads are scattered rather than laid on a ruler', drawn.spread > 0.1,
      `${drawn.spread.toFixed(2)} rad of yaw across the run`);
check('...and the scatter is fixed, not redrawn every frame', drawn.stable,
      drawn.stable ? 'identical after three seconds' : 'the road is crawling');

await close();
done(errors);
