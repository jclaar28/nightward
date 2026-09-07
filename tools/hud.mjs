// ---------------------------------------------------------------------------
// hud — the layer between the cursor and the world.
//
// Everything here used to answer against a flat plane at the plateau's height:
// where the cursor is pointing, where a unit is on screen for a click or a
// marquee, and where a building's box begins for a pick. That is exactly right
// in the middle of the map, which is flat, and wrong everywhere else — the
// camera looks down at 36 degrees, so three units of drop between the plane and
// the real hillside slides the answer nearly three cells sideways. A road goes
// in where you did not point, and a unit standing out on rolling ground cannot
// be clicked at all.
//
// None of that is visible in a screenshot and none of it throws. What it needs
// is a cursor put at a known place over known ground, and an answer compared
// against the terrain rather than against a constant.
//
//   node tools/hud.mjs
// ---------------------------------------------------------------------------
import { open, check, done } from './harness.mjs';

const { page, errors, close } = await open();

// The page's own frame loop is left running here, unlike the tools that read
// pixels. Everything inside one page.evaluate runs to completion before a
// rAF callback can interleave, so each block below is atomic; and the bars are
// drawn BY that loop, so stopping it would leave nothing to measure.
await page.evaluate(() => {
  HF.setStat('fog', 'on', 0);
  __nw.start(7);
  const S = __nw.state();
  S.players[0].supply = 999999;
  __nw.hall(0, 0);
  __nw.run(26);
});

// A patch of ground that is emphatically not the plateau, and a camera on it.
const spot = await page.evaluate(() => {
  let best = null, drop = 0;
  for (let x = -60; x <= 60; x += 3) for (let z = -60; z <= 60; z += 3) {
    const d = Math.abs(__nw.ground(x, z) - HF.PLAT);
    // wanted: a long way from the flat, but not a cliff face — a cliff makes
    // the check about the ray marcher's convergence rather than about the bug
    const rough = Math.abs(__nw.ground(x + 2, z) - __nw.ground(x - 2, z));
    if (d > drop && rough < 0.9 && !__nw.at(x, z)) { drop = d; best = [x, z]; }
  }
  if (!best) return null;
  const c = HFGAME.cam();
  c.tx = best[0]; c.tz = best[1]; c.zoom = 17; c.az = 38; c.el = 36;
  return { x: best[0], z: best[1], drop: +drop.toFixed(2),
           ground: +__nw.ground(best[0], best[1]).toFixed(2), plat: HF.PLAT };
});
check('there is rolling ground to test on', spot && spot.drop > 1.5,
      spot ? `standing on ground ${spot.drop} from the plateau (${spot.ground} against ` +
             `${spot.plat}) — on the flat every check below passes either way`
           : 'nowhere off the plateau was found');

// ---- the cursor points where it points ------------------------------------
// Ground truth is computed here, in the test, by walking the camera's own ray
// down onto the height field in small steps. That is deliberately not how the
// game does it — the game solves it — so this is a second opinion rather than
// the same arithmetic twice.
const hover = await page.evaluate(() => {
  const cv = document.querySelector('canvas'), rect = cv.getBoundingClientRect();
  const out = [];
  for (const [fx, fy] of [[0.5, 0.5], [0.35, 0.4], [0.62, 0.58], [0.45, 0.66]]) {
    const px = rect.left + rect.width * fx, py = rect.top + rect.height * fy;
    cv.dispatchEvent(new PointerEvent('pointermove',
      { clientX: px, clientY: py, bubbles: true, pointerId: 1 }));
    const h = __nw.state().hover;
    if (!h) continue;
    // march the same ray by brute force
    const C = HFGAME.camera(true);
    const nx = ((px - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((py - rect.top) / rect.height) * 2;
    const zoom = HFGAME.cam().zoom, hw = zoom * C.aspect, hh = zoom;
    const O = [C.target[0] + C.r[0] * nx * hw + C.u[0] * ny * hh,
               C.target[1] + C.r[1] * nx * hw + C.u[1] * ny * hh,
               C.target[2] + C.r[2] * nx * hw + C.u[2] * ny * hh];
    O[0] -= C.f[0] * 260; O[1] -= C.f[1] * 260; O[2] -= C.f[2] * 260;
    let t = 0, hit = null;
    for (let s = 0; s < 6000; s++) {
      const p = [O[0] + C.f[0] * t, O[1] + C.f[1] * t, O[2] + C.f[2] * t];
      if (p[1] <= __nw.ground(p[0], p[2])) { hit = p; break; }
      t += 0.1;
    }
    if (!hit) continue;
    out.push({ off: Math.hypot(h.x - hit[0], h.z - hit[2]),
               flat: Math.abs(__nw.ground(hit[0], hit[2]) - HF.PLAT) });
  }
  return out;
});
const worst = hover.length ? Math.max(...hover.map(h => h.off)) : 99;
check('the cursor lands where the ray meets the ground',
      hover.length >= 3 && worst < 0.7,
      `${hover.length} points, worst ${worst.toFixed(2)} units from where the ray really ` +
      `crosses the terrain — a plane at the plateau's height is out by 4.1 units for every ` +
      `3 it is wrong about the height`);

// ---- a unit off the flat can be picked up ---------------------------------
const clicked = await page.evaluate(() => {
  const S = __nw.state(), cv = document.querySelector('canvas');
  const rect = cv.getBoundingClientRect();
  const u = S.units.filter(x => !x.inside)[0];
  const c = HFGAME.cam();
  u.x = u.px = c.tx; u.z = u.pz = c.tz; u.path = null; u.ph = 0;
  S.units.forEach(x => { x.sel = false; });
  __nw.frame();
  // where the unit is on screen, by the projection the HUD itself uses
  const C = HFGAME.camera(true), vp = C.vp;
  const y = __nw.ground(u.x, u.z) + 0.62 * u.sc;
  let w = vp[3] * u.x + vp[7] * y + vp[11] * u.z + vp[15]; if (!w) w = 1;
  const sx = ((vp[0] * u.x + vp[4] * y + vp[8] * u.z + vp[12]) / w * 0.5 + 0.5) * rect.width + rect.left;
  const sy = (1 - ((vp[1] * u.x + vp[5] * y + vp[9] * u.z + vp[13]) / w * 0.5 + 0.5)) * rect.height + rect.top;
  const mk = (t, b) => new PointerEvent(t, { clientX: sx, clientY: sy, button: b,
                                             buttons: b === 2 ? 2 : 1, bubbles: true,
                                             pointerId: 1, isPrimary: true });
  cv.dispatchEvent(mk('pointerdown', 0));
  cv.dispatchEvent(mk('pointerup', 0));
  const one = S.units.filter(x => x.sel).length;
  // and a marquee dragged across the same place
  S.units.forEach(x => { x.sel = false; });
  const drag = (t, x, y2, b) => cv.dispatchEvent(new PointerEvent(t,
    { clientX: x, clientY: y2, button: 0, buttons: b, bubbles: true, pointerId: 1, isPrimary: true }));
  drag('pointerdown', sx - 60, sy - 60, 1);
  drag('pointermove', sx + 60, sy + 60, 1);
  drag('pointerup', sx + 60, sy + 60, 0);
  const box = S.units.filter(x => x.sel).length;
  return { one, box, unit: u.t };
});
check('a unit standing off the flat can be clicked', clicked.one === 1,
      `${clicked.one} selected by a click on the ${clicked.unit} itself`);
check('...and caught by a marquee drawn over it', clicked.box >= 1,
      `${clicked.box} selected by a box across the same place`);

// ---- the bar over its head -------------------------------------------------
// These have to straddle two evaluates: the bars are DOM elements written by
// the app's frame loop, so the damage is done in one call, a frame is allowed
// to happen, and the elements are read in the next.
await page.evaluate(() => {
  const S = __nw.state();
  const u = S.units.filter(x => !x.inside)[0];
  u.hp = u.max * 0.37;
  HFGAME.cam().zoom = 17;
});
await page.waitForTimeout(120);
const near = await page.evaluate(() => {
  const n = [...document.querySelectorAll('#worldBars .wBar')].filter(d => !d.hidden);
  return n.map(d => ({ w: parseFloat(d.style.width), h: parseFloat(d.style.height),
                       fill: parseFloat(d.firstChild.style.width) }));
});
await page.evaluate(() => {
  const S = __nw.state();
  S.units.filter(x => !x.inside).forEach(u => { u.hp = Math.min(u.hp, u.max * 0.37); });
  HFGAME.cam().zoom = 34;
});
await page.waitForTimeout(120);
const far = await page.evaluate(() =>
  [...document.querySelectorAll('#worldBars .wBar')].filter(d => !d.hidden)
    .map(d => ({ w: parseFloat(d.style.width), h: parseFloat(d.style.height) })));

const n0 = near[0], f0 = far[0];
check('a damaged thing gets a bar', near.length > 0 && !!n0,
      `${near.length} bars on screen`);
check('...filled to the fraction it has left',
      !!n0 && Math.abs(n0.fill - 37) < 2.0, `${n0?.fill}% wide for 37% of its health`);
check('...and sized by the camera rather than by the screen',
      !!n0 && !!f0 && f0.w < n0.w * 0.75,
      `${n0?.w}px across at zoom 17, ${f0?.w}px at 34 — a bar that keeps its pixels ` +
      `while the thing it belongs to halves stops belonging to it`);

await close();
done(errors);
