// ---------------------------------------------------------------------------
// pathing — do your own units actually get where you send them?
//
// The horde has always had a flow field. Player units used to steer straight at
// the target and round obstacles reactively, which is fine in the open and
// hopeless anywhere else: a unit ordered into a walled yard walks to the
// outside of the wall and grinds there. This measures the four things the new
// A* is for, and the two rules it must not break.
//
//   node tools/pathing.mjs
// ---------------------------------------------------------------------------
import { open, check, done } from './harness.mjs';

const SEED = 4242;
const { page, errors, close } = await open();

const boot = await page.evaluate(seed => {
  __nw.start(seed);
  const S = __nw.state();
  S.players[0].supply = 99999;
  __nw.hall(0, 0);
  __nw.run(25);
  __nw.invincible();
  return { hall: !!S.players[0].hall };
}, SEED);
check('a round with a hall standing', boot.hall);

// A soldier we can put anywhere and order about, kept out of the way of the
// worker AI so nothing else is deciding where it goes.
const setup = await page.evaluate(() => {
  const G = __hf.game, S = __nw.state();
  __nw.place('barracks', 6, 10);
  __nw.run(14);
  const sold = S.units.filter(u => u.t === 'soldier');
  return { soldiers: sold.length };
});
check('and a soldier to order around', setup.soldiers > 0, `${setup.soldiers} mustered`);

// Drive one unit to a point and report how it went. Shared by every case below.
//
// It also reports whether the unit was standing anywhere legal to begin with.
// A* correctly declines to search from inside a building, and the fallback is a
// straight walk — so a start planted in the town hall's 3x3 footprint turns
// every case here into a test of reactive steering while still looking like a
// pathfinding test. That mistake cost three false failures and one false pass,
// so `startOk` is asserted rather than assumed. The hall spans +/-2.4 units
// about the origin; anything nearer than that is inside it.
const walkTo = (wall, from, to, seconds = 40) => page.evaluate(a => {
  const G = __hf.game, S = __nw.state();
  // clear anything left from the previous case
  Object.keys(S.cells).forEach(k => { if (S.cells[k].type !== 'hall') delete S.cells[k]; });
  S.distDirty = true; S.pathVer = (S.pathVer | 0) + 1;
  a.wall.forEach(c => __nw.place(c[2] || 'wall', c[0], c[1]));
  __nw.run(8);                                    // let the sites finish
  const u = S.units.filter(x => x.t === 'soldier')[0];
  u.x = a.from[0]; u.z = a.from[1];
  u.path = null; u.pathTo = null; u.shelter = false; u.target = null;
  const startOk = G.walkableCell(HF.w2gx(u.x), HF.w2gx(u.z));
  const route = G.findPath(u.x, u.z, a.to[0], a.to[1]);
  G.orderTo([u], a.to[0], a.to[1]);
  let t = 0;
  for (let i = 0; i < 30 * a.seconds; i++) {
    __nw.run(1 / 30); t += 1 / 30;
    if (Math.hypot(u.x - a.to[0], u.z - a.to[1]) < 1.4) break;
  }
  return { t, gap: Math.hypot(u.x - a.to[0], u.z - a.to[1]), startOk,
           legs: route ? route.length : 0,
           x: Math.round(u.x * 10) / 10, z: Math.round(u.z * 10) / 10 };
}, { wall, from, to, seconds });

// ---- 1. round a building ---------------------------------------------------
// A cottage squarely between the unit and its destination.
const around = await walkTo([[0, 6, 'cottage']], [0, 3.2], [0, 11]);
check('a unit walks around a building in the way',
      around.startOk && around.legs > 1 && around.gap < 1.4,
      `${around.legs}-leg route, ended ${around.gap.toFixed(2)}u away after ${around.t.toFixed(1)}s`);

// ---- 2. through a gate -----------------------------------------------------
// A wall right across the route with one gate in it. Reaching the far side at
// all means the gate was used — there is no other way through.
const WALL_Z = 6, GATE_X = 6;
const line = [];
for (let x = -9; x <= 9; x += 1.5) line.push([x, WALL_Z, Math.abs(x - GATE_X) < 0.5 ? 'gate' : 'wall']);
const gate = await walkTo(line, [0, 3.2], [0, 12], 60);
check('a wall with one gate is crossed through the gate',
      gate.startOk && gate.gap < 1.4,
      `ended ${gate.gap.toFixed(2)}u away at (${gate.x},${gate.z})`);

// ---- 3. out of a pocket ----------------------------------------------------
// Three sides of a box. Reactive steering walks into the mouth and sticks; a
// search goes round the outside. This is the case that could not be solved
// before at all.
const box = [];
for (let x = -6; x <= 6; x += 1.5) box.push([x, 9]);
for (let z = 0; z <= 9; z += 1.5) { box.push([-6, z]); box.push([6, z]); }
const pocket = await walkTo(box, [0, 4], [0, 15], 70);
check('a unit escapes a three-sided pocket instead of grinding on the wall',
      pocket.startOk && pocket.gap < 1.4,
      `ended ${pocket.gap.toFixed(2)}u away at (${pocket.x},${pocket.z})`);

// ---- 4. the rules it must not break ----------------------------------------
const rules = await page.evaluate(() => {
  const G = __hf.game, S = __nw.state();
  Object.keys(S.cells).forEach(k => { if (S.cells[k].type !== 'hall') delete S.cells[k]; });
  S.distDirty = true; S.pathVer = (S.pathVer | 0) + 1;
  S.roadN.length = 0; S.roadE.length = 0; S.roadVer++;
  __nw.run(2);

  // a. open ground with nothing in the way is still a straight line.
  //    The lane is z = 8, well clear of the hall: the obvious diagonal from
  //    (-12,-12) to (12,12) runs straight through the town hall at the origin,
  //    so a unit that dutifully walked round it failed this check for doing
  //    exactly the right thing.
  const LANE = 8;
  const u = S.units.filter(x => x.t === 'soldier')[0];
  u.x = -12; u.z = LANE; u.path = null; u.pathTo = null; u.shelter = false;
  const clear = G.losClear(-12, LANE, 12, LANE) && !G.findPath(-12, LANE, 12, LANE);
  G.orderTo([u], 12, LANE);
  let maxOff = 0;
  for (let i = 0; i < 30 * 40; i++) {
    __nw.run(1 / 30);
    maxOff = Math.max(maxOff, Math.abs(u.z - LANE));   // drift off the lane
    if (Math.hypot(u.x - 12, u.z - LANE) < 1.4) break;
  }
  const straightGap = Math.hypot(u.x - 12, u.z - LANE);

  // b. the horde's field never learns about any of this
  S.distDirty = true; __nw.run(1 / 30);
  const withPathing = Array.from(S.dist || []);

  return { maxOff, straightGap, clear, field: withPathing.length };
});
check('an order across open ground is still a straight walk',
      rules.clear && rules.straightGap < 1.4 && rules.maxOff < 2.0,
      `strayed ${rules.maxOff.toFixed(2)}u from the line, ended ${rules.straightGap.toFixed(2)}u away`);
check('the horde still has a flow field to follow', rules.field > 0,
      `${rules.field} cells`);

// ---- 5. what it costs ------------------------------------------------------
// A* per order is the price of all of the above. Ordering a whole army at once
// is the worst case a player can actually create, so that is what is timed.
const cost = await page.evaluate(() => {
  const G = __hf.game, S = __nw.state();
  const wall = [];
  for (let x = -12; x <= 12; x += 1.5) wall.push([x, 6]);
  wall.forEach(c => __nw.place('wall', c[0], c[1]));
  __nw.run(8);
  // twenty units, all ordered to the far side of a solid wall at once: every
  // one of them has to find the long way round on the same frame
  const list = [];
  for (let i = 0; i < 20; i++) {
    const u = JSON.parse(JSON.stringify(S.units[0]));
    u.x = -10 + i * 0.9; u.z = 0; u.uid = 9000 + i;
    u.path = null; u.pathTo = null; u.sel = false; u.shelter = false;
    S.units.push(u); list.push(u);
  }
  const t0 = performance.now();
  G.orderTo(list, 0, 14);
  __nw.run(1 / 30);                       // the frame every path is planned on
  const t1 = performance.now();
  return { ms: t1 - t0, n: list.length };
});
check('planning a whole army at once costs one frame, not a hitch',
      cost.ms < 60, `${cost.n} units planned in ${cost.ms.toFixed(1)}ms`);

await close();
done(errors);
