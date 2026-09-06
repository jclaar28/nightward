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
    // Clear of the hall's 3x3 footprint. Starting at the origin puts the unit
    // INSIDE the town hall, where pathfinding correctly declines to search and
    // the walk falls back to a straight line — which quietly measured nothing.
    u.x = -1; u.z = -3; u.route = null; u.path = null; u.pathTo = null;
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
    u.x = 0; u.z = -20; u.route = null; u.path = null; u.pathTo = null;
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

// ---- and a big network still fits the buffer -------------------------------
// "Miss the cap and it silently truncates" is a documented failure mode in this
// codebase, and roads are the only thing whose instance count is set by how
// much the player chooses to build. So the headroom is measured, not assumed.
const dense = await page.evaluate(() => {
  const G = __hf.game, S = __nw.state();
  S.roadN.length = 0; S.roadE.length = 0; S.roadSeq = 0;
  // a spider's web of full-length spokes with a ring joining them: far more
  // road than a real player would lay, and every segment finished
  let laid = 0;
  for (let k = 0; k < 20; k++) {
    const a = k / 20 * 6.283, b = (k + 1) / 20 * 6.283;
    if (G.queueRoad(0, 0, Math.cos(a) * 25, Math.sin(a) * 25)) laid++;
    if (G.queueRoad(Math.cos(a) * 25, Math.sin(a) * 25,
                    Math.cos(b) * 25, Math.sin(b) * 25)) laid++;
  }
  S.roadE.forEach(e => { e.done = true; e.prog = e.need; });
  S.roadVer++;
  return { laid, edges: S.roadE.length, pads: __nw.frame().counts.road || 0 };
});
check('a network far bigger than anyone would build still fits',
      dense.pads > 0 && dense.pads < 5200,
      `${dense.edges} edges drew ${dense.pads} pads against a 5200 cap`);

// ---- a queued road is a thing you can see, pick and call off ---------------
// Ordering a road used to produce almost nothing on screen: the stakes stopped
// at the progress mark, so a road with no work done drew a single dot. You
// could tell something had happened and not what you had asked for.
const staked = await page.evaluate(() => {
  const G = __hf.game, S = __nw.state();
  S.roadN.length = 0; S.roadE.length = 0; S.roadSeq = 0; S.rsel = null; S.rhover = null;
  S.roadVer++;
  G.queueRoad(-20, 14, 0, 14);
  const e = S.roadE[0];
  const pads = () => __nw.frame().rows.filter(r => r.b === 'road').length;
  const marks = () => __nw.frame().rows.filter(r => r.b === 'road');
  const fresh = pads();                       // nothing done yet
  const lum = rs => rs.reduce((m, r) => Math.max(m, (r.ca[0] + r.ca[1] + r.ca[2]) / 3), 0);
  const stakeLum = lum(marks());
  e.prog = e.need * 0.5; S.roadVer++;
  const half = pads();
  // ...against the surface a finished road actually has
  e.done = true; e.prog = e.need; S.roadVer++;
  const dirtLum = lum(marks());
  e.done = false; e.prog = 0; S.roadVer++;
  return { fresh, half, stakeLum, dirtLum };
});
// The full run is staked whether or not any of it is laid, so the two counts
// match. Before this they were 1 and about half the run.
check('a road you have just ordered is staked out end to end',
      staked.fresh > 8 && staked.fresh === staked.half,
      `${staked.fresh} marks across 20u, unchanged at half built`);
// Drawing the marks is not the same as being able to see them. The first
// version of this staked the whole run in a dark grey the same value as the
// stones already scattered on the grass: every mark was in the buffer and none
// of them was visible, and a count-only check passed the whole way through.
check('...in something you can actually pick out of the grass',
      staked.stakeLum > staked.dirtLum * 1.6,
      `stakes at ${staked.stakeLum.toFixed(2)} against a laid road at ${staked.dirtLum.toFixed(2)}`);

const pickables = await page.evaluate(() => {
  const G = __hf.game, S = __nw.state();
  const e = S.roadE[0];
  const on = G.roadAt(-10, 14), beside = G.roadAt(-10, 18), past = G.roadAt(9, 14);
  // Selecting a road and selecting a building are the same act on one panel,
  // so each has to put the other down.
  __nw.place('cottage', 12, 12); __nw.run(8);
  G.selectRoad(e);
  const roadPicked = !!G.rsel(), bClear = !G.bsel();
  G.selectBuilding(__nw.at(12, 12));
  const bPicked = !!G.bsel(), rClear = !G.rsel();
  G.selectBuilding(null);
  return { on: on === e, beside: !beside, past: !past,
           roadPicked, bClear, bPicked, rClear };
});
check('a click on the line picks the road, one off it picks nothing',
      pickables.on && pickables.beside && pickables.past,
      `on ${pickables.on}, 4u off ${pickables.beside}, past the end ${pickables.past}`);
check('picking a road and picking a building put each other down',
      pickables.roadPicked && pickables.bClear && pickables.bPicked && pickables.rClear);

// Selection has to change what is drawn or it is not selection.
const litUp = await page.evaluate(() => {
  const G = __hf.game, S = __nw.state();
  const sig = () => __nw.frame().rows.filter(r => r.b === 'road')
                      .map(r => r.ca.concat([r.sc]).map(v => Math.round(v * 100)).join(':')).join(',');
  S.rsel = null; const plain = sig();
  G.selectRoad(S.roadE[0]); const picked = sig();
  S.rsel = null; S.rhover = { a: S.roadE[0].a, b: S.roadE[0].b }; const hovered = sig();
  S.rhover = null;
  return { changedOnPick: plain !== picked, changedOnHover: plain !== hovered };
});
check('a picked road looks different from an idle one',
      litUp.changedOnPick && litUp.changedOnHover,
      `pick ${litUp.changedOnPick}, hover ${litUp.changedOnHover}`);

const called = await page.evaluate(() => {
  const G = __hf.game, S = __nw.state();
  const e = S.roadE[0], before = { edges: S.roadE.length, nodes: S.roadN.length,
                                   pv: S.pathVer | 0, rv: S.roadVer | 0 };
  G.selectRoad(e);
  const ok = G.cancelRoad(e.a, e.b);
  return { ok, before, edges: S.roadE.length, nodes: S.roadN.length,
           stillSel: !!G.rsel(), pv: S.pathVer | 0, rv: S.roadVer | 0,
           pads: __nw.frame().rows.filter(r => r.b === 'road').length };
});
check('calling off a queued road takes the road with it',
      called.ok && called.edges === 0 && called.pads === 0 && !called.stillSel,
      `${called.before.edges} edges → ${called.edges}, ${called.pads} pads left`);
// A node is only the end of an edge. One left behind is not merely litter: it
// still snaps, so the next road drawn nearby would be quietly dragged onto a
// junction that no longer exists.
check('...and takes its orphaned nodes with it',
      called.nodes === 0, `${called.before.nodes} nodes → ${called.nodes}`);
check('...and tells the routing that the network moved',
      called.pv > called.before.pv && called.rv > called.before.rv,
      `pathVer ${called.before.pv}→${called.pv}, roadVer ${called.before.rv}→${called.rv}`);

// A finished road comes up too, and the speed it was worth goes with it.
const tornUp = await page.evaluate(() => {
  const G = __hf.game, S = __nw.state();
  G.queueRoad(-18, -14, 2, -14);
  const e = S.roadE[0];
  e.done = true; e.prog = e.need; S.roadVer++;
  const before = G.roadSpeed(-8, -14);
  const ok = G.cancelRoad(e.a, e.b);
  return { ok, before, after: G.roadSpeed(-8, -14), edges: S.roadE.length };
});
check('a finished road can be torn up, and the bonus goes with it',
      tornUp.ok && tornUp.before > 1.01 && tornUp.after === 1 && tornUp.edges === 0,
      `speed ${tornUp.before} → ${tornUp.after}`);

// The ownership check is the one that matters: applyIntent runs the same
// function a local click runs, so without it a guest could scrap the host's
// network. Seat 1 is not the owner of a road seat 0 laid.
const notYours = await page.evaluate(() => {
  const G = __hf.game, S = __nw.state();
  G.queueRoad(-16, 20, 0, 20);
  const e = S.roadE[0];
  const refused = G.cancelRoad(e.a, e.b, 1);          // a different seat asking
  const mine = G.cancelRoad(e.a, e.b, 0);             // the owner asking
  return { refused: !refused, survived: refused === false, mine, edges: S.roadE.length };
});
check('another seat cannot call off a road that is not theirs',
      notYours.refused && notYours.mine && notYours.edges === 0,
      `refused for seat 1, removed for seat 0`);

await close();
done(errors);
