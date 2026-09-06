// ---------------------------------------------------------------------------
// instances — read what the renderer is actually handed, and check it.
//
// This is the technique worth internalising. Instead of looking at a screenshot
// and deciding something looks right, wrap R.setInstances, capture the float
// arrays for one frame, and assert against them. It is how "the nests are
// floating" became a number, and how a fix could be shown to work rather than
// asserted to.
//
//   node tools/instances.mjs
// ---------------------------------------------------------------------------
import { open, check, done } from './harness.mjs';

const SEED = 4242;
const { page, errors, close } = await open();

// A busy frame: a town, a wave, corpses, particles, both nests on the map.
//
// Fog is off for the whole tool, deliberately. Everything asserted here is
// geometry — where an instance sits relative to the ground under it — and fog
// answers a different question, which is whether it should be in the buffer at
// all. Leaving it on does not make these checks stricter, it empties them: the
// nest-grounding checks failed with "drawn []" the moment fog shipped, because
// an undiscovered nest is correctly not drawn and there was nothing left to
// measure. A check with no subject is worse than no check.
const scene = await page.evaluate(seed => {
  HF.setStat('fog', 'on', 0);
  __nw.start(seed);
  __nw.hall(0, 0);
  __nw.run(22);
  const S = __nw.state();
  S.players[0].supply = 5000;
  const spots = [[10,10],[-12,8],[14,-9],[-16,-14],[22,4],[-4,20],[6,-22]];
  const kinds = ['tower','cottage','barracks','brazier','ballista','archery','wall'];
  spots.forEach((p, i) => __nw.place(kinds[i % kinds.length], p[0], p[1]));
  __nw.run(9);
  S.wave = 400;
  HFGAME.startWave();
  __nw.invincible();
  for (let i = 0; i < 30 * 25; i++) { __nw.invincible(); HFGAME.update(1 / 30); }
  __nw.invincible();
  return { units: S.units.length, enemies: S.enemies.length,
           buildings: __nw.roots().length, nests: S.nests.length,
           parts: (S.parts || []).length, corpses: (S.corpses || []).length };
}, SEED);
console.log(`scene: ${scene.buildings} buildings, ${scene.units} units, ` +
            `${scene.enemies} enemies, ${scene.corpses} corpses, ${scene.parts} particles\n`);

// ---- nothing anchored is drawn below the ground it stands on ---------------
// "Anchored" excludes bones, corpses and effects on purpose: an attacker rises
// out of the ground when it spawns (drawEnemy's `sink` term), a corpse settles
// into it, and a spark arcs. Those are below the terrain by design, and folding
// them in here would turn the check into noise. What must never be below the
// ground is a thing that stands on it.
const EFFECTS = ['corpse', 'spark', 'debris', 'bolt', 'arrow'];
const ground = await page.evaluate(effects => {
  const f = __nw.frame();
  const anchored = r => r.b.indexOf(':') < 0 && effects.indexOf(r.b) < 0;
  let below = 0, worst = 0, worstAt = null, n = 0;
  for (const r of f.rows) {
    if (!anchored(r)) continue;
    if (!isFinite(r.x) || !isFinite(r.y) || !isFinite(r.z)) continue;
    if (Math.abs(r.x) > 120 || Math.abs(r.z) > 120) continue;   // off-map scratch
    n++;
    const d = r.y - __nw.ground(r.x, r.z);
    if (d < -0.06) below++;
    if (d < worst) { worst = d; worstAt = [r.b, +r.x.toFixed(1), +r.z.toFixed(1), +d.toFixed(3)]; }
  }
  return { total: f.rows.length, checked: n, batches: Object.keys(f.counts).length,
           below, worst: +worst.toFixed(3), worstAt };
}, EFFECTS);
check('the frame is a real one', ground.total > 300,
      `${ground.total} instances across ${ground.batches} batches`);
check('every anchored instance sits on its terrain', ground.below === 0,
      ground.below ? `${ground.below} sunk, worst ${JSON.stringify(ground.worstAt)}`
                   : `${ground.checked} checked, worst deviation ${ground.worst}`);

// ---- the nests specifically: they used to be pinned to the plateau ---------
const nests = await page.evaluate(() => {
  const S = __nw.state(), f = __nw.frame();
  return S.nests.map(n => {
    const hit = f.rows.filter(r => Math.hypot(r.x - n.x, r.z - n.z) < 0.05).map(r => r.y);
    return { terrain: +__nw.ground(n.x, n.z).toFixed(3),
             plat: HF.PLAT, drawn: hit.map(v => +v.toFixed(3)) };
  });
});
for (const n of nests) {
  const onGround = n.drawn.length > 0 && n.drawn.every(y => Math.abs(y - n.terrain) < 0.01);
  check('nest sits on its terrain, not the plateau', onGround,
        `terrain ${n.terrain}, drawn ${JSON.stringify(n.drawn)} (plateau is ${n.plat})`);
}

// ---- the build grid locks to world cells rather than sliding ---------------
// The patch follows the cursor, but its lines must land on real cell edges, so
// the instance position has to be an exact multiple of the cell size.
const grid = await page.evaluate(() => {
  const S = __nw.state(), CELL = HF.CELL, seen = new Set();
  let worst = 0, missing = 0;
  for (let k = 0; k <= 20; k++) {
    const hx = 3 + k * (CELL / 5), hz = 1 + k * (CELL / 5);
    S.sel = 'cottage';
    S.hover = { x: hx, z: hz, gx: HF.w2gx(hx), gz: HF.w2gx(hz) };
    const rows = __nw.frame().rows.filter(r => r.b === 'grid');
    if (!rows.length) { missing++; continue; }
    const g = rows[0];
    seen.add(g.x.toFixed(4) + ',' + g.z.toFixed(4));
    worst = Math.max(worst,
      Math.abs(g.x / CELL - Math.round(g.x / CELL)),
      Math.abs(g.z / CELL - Math.round(g.z / CELL)));
  }
  S.sel = null; S.hover = null;
  const idle = __nw.frame().rows.filter(r => r.b === 'grid').length;
  return { samples: 21, missing, positions: seen.size, worst, idle };
});
check('the grid draws while a building is held', grid.missing === 0);
check('every grid position is an exact cell multiple', grid.worst === 0,
      `${grid.samples} cursor samples → ${grid.positions} positions, worst offset ${grid.worst}`);
check('the grid disappears when nothing is held', grid.idle === 0);

// ---- a blocked ghost answers in colour, not brightness ---------------------
const ghost = await page.evaluate(() => {
  const S = __nw.state();
  // Pick the ghost out by position, not by taking the first row: there is a
  // real cottage on this board and it draws into the same batch.
  const sample = (x, z) => {
    S.sel = 'cottage';
    S.hover = { x, z, gx: HF.w2gx(x), gz: HF.w2gx(z) };
    const cx = HF.gx2w(HF.w2gx(x)), cz = HF.gx2w(HF.w2gx(z));
    const rows = __nw.frame().rows.filter(r =>
      r.b === 'cottage' && Math.hypot(r.x - cx, r.z - cz) < 0.01);
    return rows.length ? rows[rows.length - 1].ca : null;
  };
  const legal = (x, z) => HFGAME.canPlace('cottage', HF.w2gx(x), HF.w2gx(z));
  const red = c => c[0] / Math.max(1e-6, (c[1] + c[2]) / 2);
  const lum = c => (c[0] + c[1] + c[2]) / 3;
  // Report whether the two spots really are legal and illegal. The first
  // version of this compared open ground at (30,30) — off the edge of a
  // 51-unit map — against the hall, so both ghosts were blocked and the check
  // passed itself as "no change".
  const OK = [0, 12], NO = [0, 0];
  const ok = sample(OK[0], OK[1]), no = sample(NO[0], NO[1]);
  const legality = { open: legal(OK[0], OK[1]), blocked: legal(NO[0], NO[1]) };
  S.sel = null; S.hover = null;
  return { legality,
           okRed: +red(ok).toFixed(2), noRed: +red(no).toFixed(2),
           okLum: +lum(ok).toFixed(3), noLum: +lum(no).toFixed(3) };
});
check('the two ghost spots really are legal and illegal',
      ghost.legality.open === true && ghost.legality.blocked === false,
      JSON.stringify(ghost.legality));
check('a blocked ghost shifts hue', ghost.noRed > ghost.okRed * 2,
      `red ratio ${ghost.okRed} → ${ghost.noRed}`);
check('and is not merely dimmed', ghost.noLum > ghost.okLum * 0.6,
      `brightness ${ghost.okLum} → ${ghost.noLum}`);

// ---- the walk is locked to the feet ----------------------------------------
// A gait is two claims about one phase: the legs swing once per stride, and the
// body rises once per foot planted — so twice per stride. Getting the ratio
// wrong is invisible in a screenshot and unmistakable in motion, which is
// exactly the kind of bug this file exists for.
//
// It shipped wrong: bob was abs(cos(2*ph)). cos(2*ph) already runs at twice the
// stride and the abs doubled it again, giving four bounces per leg cycle — a
// rapid jitter with no relationship to the feet. Measured, not eyeballed.
//
// It needs its own round. The busy scene above has a wave on the field, so the
// units walk and swing on their own and the phase picks up distance from three
// sources at once — the first version of this measured 1.49 leg cycles per
// stride, which is what "isolate the thing you are measuring" looks like when
// you skip it.
const gait = await page.evaluate(seed => {
  __nw.start(seed);
  const S = __nw.state();
  __nw.hall(0, 0);
  __nw.run(26);
  S.enemies.length = 0;                       // nothing to fight, nothing to chase
  const u = S.units.filter(x => x.t === 'worker')[0];
  u.job = null; u.mode = 'idle'; u.atk = -1; u.target = null; u.shelter = false;
  u.x = -30; u.z = 26;                        // open ground, clear of the town
  const ys = [], legs = [];
  // It walks under its own power. Nudging u.x by hand does not work: gaitStep
  // measures the distance the simulation moved the unit, so a position written
  // before update() is already the new one and the phase never advances.
  HFGAME.orderTo([u], 30, 26);
  const ph0 = u.ph;
  for (let i = 0; i < 240; i++) {
    HFGAME.update(1 / 60);
    const rows = __nw.frame().rows;
    const body = rows.filter(q => q.b === u.t + ':body')[0];
    const leg = rows.filter(q => q.b === u.t + ':leg')[0];
    // Body Y includes the terrain under it, and a 0.055 bob is nothing against
    // a hillside — measure the height above the ground it is standing on, or
    // you count the landscape instead of the walk.
    if (body && leg) { ys.push(body.y - __nw.ground(u.x, u.z)); legs.push(leg.pitch); }
  }
  const peaks = a => { let n = 0; for (let i = 1; i < a.length - 1; i++)
                         if (a[i] > a[i - 1] && a[i] >= a[i + 1]) n++; return n; };
  const strides = (u.ph - ph0) / (2 * Math.PI);
  return { bob: peaks(ys) / strides, leg: peaks(legs) / strides, strides };
}, SEED);
check('the legs swing once per stride', Math.abs(gait.leg - 1) < 0.25,
      `${gait.leg.toFixed(2)} leg cycles per stride over ${gait.strides.toFixed(1)} strides`);
check('...and the body rises once per footfall, not four times',
      Math.abs(gait.bob - 2) < 0.35,
      `${gait.bob.toFixed(2)} bounces per stride (2 is one per foot; it was 4)`);

// ---- rings follow the ground -----------------------------------------------
// Every ring in the game — selection, rally, tower range, brazier aura, the
// move marker's pulse — used to be one flat annulus placed at the height of its
// own centre. One instance carries one transform, so on a slope the uphill half
// of a 5.6-unit rally ring sank into the hill and the downhill half hung over
// it. They are runs of grounded chips now, and this measures every chip against
// the terrain directly beneath it.
//
// It deliberately hunts for the worst ground on the map first. Measuring this
// on the flat plateau where the hall usually goes would pass with the old code
// and prove nothing.
const rings = await page.evaluate(seed => {
  HF.setStat('fog', 'on', 0);
  __nw.start(seed);
  const S = __nw.state();
  S.players[0].supply = 9999;
  const R = HF.statsOf('commander').rally;
  let best = null;
  for (let x = -40; x <= 40; x += 3)
    for (let z = -40; z <= 40; z += 3) {
      let lo = 9, hi = -9;
      for (let a = 0; a < 8; a++) {
        const g = __nw.ground(x + Math.cos(a / 8 * 6.283) * R,
                              z + Math.sin(a / 8 * 6.283) * R);
        lo = Math.min(lo, g); hi = Math.max(hi, g);
      }
      if (!best || hi - lo > best.d) best = { x, z, d: hi - lo };
    }
  __nw.hall(best.x, best.z);
  __nw.run(26);
  const cmd = S.units.filter(u => u.t === 'commander')[0];
  cmd.x = best.x; cmd.z = best.z; cmd.sel = true;
  HFGAME.update(1 / 60);
  const rows = __nw.frame().rows.filter(q => q.b === 'rchip');
  let worst = 0, below = 0;
  for (const q of rows) {
    const d = q.y - __nw.ground(q.x, q.z);
    if (d < 0) below++;
    worst = Math.max(worst, Math.abs(d));
  }
  return { relief: best.d, chips: rows.length, below, worst };
}, SEED);
check('the ring test is standing on ground worth testing on',
      rings.relief > 1.5 && rings.chips > 20,
      `${rings.relief.toFixed(2)}u of relief across the ring, ${rings.chips} chips`);
check('every ring segment sits on the ground under it',
      rings.below === 0 && rings.worst < 0.2,
      `${rings.below} below ground, worst gap ${rings.worst.toFixed(3)}u`);

// A ring is many instances now, so the count is set by how much the player
// built — the same failure shape roads have, and "miss the cap and it silently
// truncates" is a documented one here. So it is measured, not assumed.
const ringCap = await page.evaluate(seed => {
  __nw.start(seed);
  const S = __nw.state();
  S.players[0].supply = 999999;
  __nw.hall(0, 0); __nw.run(26);
  let n = 0;
  for (let i = 0; i < 40; i++)
    if (__nw.place('tower', -30 + (i % 10) * 6, -24 + Math.floor(i / 10) * 8)) n++;
  for (let i = 0; i < 20; i++) __nw.place('ballista', -28 + (i % 10) * 6, 20);
  __nw.run(10);
  S.sel = 'tower';                       // every one of them draws its range
  S.units.forEach(u => u.sel = true);
  HFGAME.update(1 / 60);
  return { towers: n, chips: __nw.frame().counts.rchip || 0 };
}, SEED);
check('a defence far bigger than anyone builds still fits the ring buffer',
      ringCap.chips > 500 && ringCap.chips < 6000,
      `${ringCap.towers} towers drew ${ringCap.chips} segments against a 6000 cap`);

await close();
done(errors);
