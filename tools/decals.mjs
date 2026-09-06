// ---------------------------------------------------------------------------
// decals — the marks on the ground, and the two things that make them read as
// light rather than as painted plastic.
//
// Ground indicators have a failure mode that no instance count will catch: the
// geometry is exactly right, every chip is where it should be, and the picture
// still looks wrong because of what the renderer did to it afterwards. That is
// what happened here. Every ring was an opaque emissive box, so the ink pass
// found a depth and normal discontinuity at each one and drew a crisp black
// outline around it — a ring came out as a chain of beads, and no check that
// counted or positioned instances could have known.
//
// So these read pixels. The frame is rendered twice, once with a mark and once
// without, and the two are compared: a mark that adds light must only ever make
// the picture brighter. An outline is a darker pixel, and there is no other way
// to see one.
//
//   node tools/decals.mjs
// ---------------------------------------------------------------------------
import { open, check, done } from './harness.mjs';

const SEED = 4242;
const { page, errors, close } = await open();

await page.evaluate(seed => {
  HF.setStat('fog', 'on', 0);
  __nw.start(seed);
  const S = __nw.state();
  S.players[0].supply = 99999;
  __nw.hall(0, 0);
  __nw.run(26);
  // park the camera and stop the world: every pixel of the two frames below
  // has to be identical apart from the mark under test, and a walking worker
  // or a turning sun would swamp the difference being measured
  const c = HFGAME.cam();
  c.tx = 0; c.tz = 0; c.zoom = 16; c.az = 38; c.el = 36;
  S.units.forEach(u => { u.sel = false; });
  HFGAME.selectBuilding(null);
}, SEED);

// Read the default framebuffer straight after a draw. A screenshot would do the
// same job but has to come back through PNG; this is the same pixels, and it
// keeps the two frames in one task where nothing can tick between them.
await page.evaluate(() => {
  const cv = document.querySelector('canvas');
  const gl = cv.getContext('webgl2');
  window.__px = function (setup) {
    setup();
    __nw.frame();
    const w = cv.width, h = cv.height, buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return { w, h, buf };
  };
  // luminance difference, b minus a, per pixel
  window.__diff = function (A, B, thresh) {
    let up = 0, down = 0, worst = 0;
    for (let i = 0; i < A.buf.length; i += 4) {
      const la = 0.299 * A.buf[i] + 0.587 * A.buf[i + 1] + 0.114 * A.buf[i + 2];
      const lb = 0.299 * B.buf[i] + 0.587 * B.buf[i + 1] + 0.114 * B.buf[i + 2];
      const d = lb - la;
      if (d > thresh) up++;
      else if (d < -thresh) { down++; if (-d > worst) worst = -d; }
    }
    return { up, down, worst: Math.round(worst) };
  };
});

// ---- the batches are wired into the blended pass ---------------------------
const wiring = await page.evaluate(() => {
  const B = HFGAME.batches();
  const seen = [];
  const orig = window.__hf.gl.render;
  window.__hf.gl.render = function (cam, batches, flash, over, decals) {
    seen.push({ opaque: batches ? batches.length : 0,
                names: (decals || []).map(d => d.blend) });
    return orig.apply(this, arguments);
  };
  __nw.frame();
  window.__hf.gl.render = orig;
  const last = seen[seen.length - 1] || { names: [] };
  return { blends: last.names,
           inOpaque: ['rchip', 'dshade', 'marker', 'grid']
                       .filter(k => (window.__nwLIST || []).indexOf(B[k]) >= 0) };
});
check('every decal batch reaches the blended pass', wiring.blends.length === 4,
      `${wiring.blends.length} decal batches: ${wiring.blends.join(', ')}`);
check('...and the contact shade is the one that subtracts',
      wiring.blends.filter(b => b === 'mul').length === 1 &&
      wiring.blends.filter(b => b === 'add').length === 3,
      `${wiring.blends.join(', ')} — add brightens, mul takes light away`);

// ---- a ring is an even line, not a string of beads --------------------------
// Every chip fades to nothing at both ends so consecutive chips cross-fade, and
// two linear ramps crossing sum to what either one carries alone — but only if
// the ramp is as long as the gap it bridges. That makes chip length against
// neighbour spacing the one number that decides whether a ring is a line or a
// row of dots, and it is not visible in a screenshot of a straight-on ring.
const evenness = await page.evaluate(() => {
  const S = __nw.state();
  HFGAME.selectBuilding(S.players[0].hall);
  const rows = __nw.frame().rows.filter(r => r.b === 'rchip');
  HFGAME.selectBuilding(null);
  if (rows.length < 8) return { n: rows.length };
  let worst = 0, MESH = 1.60;
  for (const r of rows) {
    let near = 1e9;
    for (const o of rows) {
      if (o === r) continue;
      const d = Math.hypot(o.x - r.x, o.z - r.z);
      if (d < near) near = d;
    }
    const ratio = (r.sc * MESH) / (2 * near);
    worst = Math.max(worst, Math.abs(ratio - 1));
  }
  return { n: rows.length, worst };
});
check('a ring is drawn as chips long enough to reach their neighbours',
      evenness.n >= 8 && evenness.worst < 0.06,
      `${evenness.n} chips, worst chip is ${(evenness.worst * 100).toFixed(1)}% off twice its gap`);

// ---- a mark that adds light never darkens a pixel ---------------------------
// Both halves of this are measured on open ground well away from the hall, and
// that is not fussiness. The first attempt selected the hall itself and then a
// unit standing beside it: a hall is a 3x3 footprint spanning 2.4 units either
// way, so the ring under it was inside the building and every pixel of it was
// occluded. The check reported no darker pixels because it was looking at no
// pixels at all, which is the same reading a working decal pass gives.
const scene = await page.evaluate(() => {
  const S = __nw.state();
  __nw.place('tower', 12, 0);
  __nw.run(9);
  const t = __nw.at(12, 0);
  const u = S.units.filter(x => !x.inside)[0];
  if (u) { u.x = 12; u.z = 7; }
  return { tower: !!t, unit: !!u };
});
check('the scene has a tower and a unit standing clear of anything else',
      scene.tower && scene.unit);

const glow = await page.evaluate(() => {
  const S = __nw.state();
  const c = HFGAME.cam(); c.tx = 12; c.tz = 0; c.zoom = 16;
  S.hover = null;                        // no cursor, so no ghost and no grid
  const A = window.__px(() => { HFGAME.select(null); });
  const B = window.__px(() => { HFGAME.select('tower'); });   // draws its range
  const d = window.__diff(A, B, 3);
  HFGAME.select(null);
  return d;
});
check('a range ring lights up ground that was not lit before',
      glow.up > 400, `${glow.up} pixels brighter — the ring is on screen to be judged`);
check('...and not one pixel of it is darker than it was',
      glow.down === 0,
      glow.down ? `${glow.down} pixels went darker, worst by ${glow.worst}/255 — that is an ` +
                  `outline drawn around the mark, which is what made rings read as beads`
                : 'no outline, no rim, nothing subtracted');

// ---- ...and the shade is the one that does take light away ------------------
// The counterpart, and the reason the check above cannot pass by drawing
// nothing at all: a unit's selection puts a pool of darkness under it, so this
// asserts the subtractive path is still subtractive.
const shade = await page.evaluate(() => {
  const S = __nw.state();
  const u = S.units.filter(x => !x.inside && x.x === 12)[0] ||
            S.units.filter(x => !x.inside)[0];
  if (!u) return null;
  const c = HFGAME.cam(); c.tx = u.x; c.tz = u.z; c.zoom = 12;
  const A = window.__px(() => { u.sel = false; });
  const B = window.__px(() => { u.sel = true; });
  const d = window.__diff(A, B, 3);
  u.sel = false;
  return d;
});
check('a selected unit is planted on a pool of shade',
      shade && shade.down > 30,
      shade ? `${shade.down} pixels darker under the unit, ${shade.up} brighter around it`
            : 'no unit outdoors to select');

// ---- nothing is asked for more light than the screen has --------------------
// The old rings were written as 2.10 and 2.20 of green and blue, which is what
// a colour looks like when it was tuned by turning it up until it showed
// through an outline. Every one of them clamped, so a rally, a range and a
// selection came out as the same blown cyan.
const palette = await page.evaluate(() => {
  const rows = __nw.frame().rows.filter(r => r.b === 'rchip' || r.b === 'marker' ||
                                             r.b === 'dshade' || r.b === 'grid');
  let worst = 0;
  const S = __nw.state();
  S.units.forEach(u => { u.sel = true; });
  HFGAME.selectBuilding(S.players[0].hall);
  const all = __nw.frame().rows.filter(r => ['rchip', 'marker', 'dshade', 'grid'].includes(r.b));
  for (const r of all) worst = Math.max(worst, r.ca[0], r.ca[1], r.ca[2]);
  S.units.forEach(u => { u.sel = false; });
  HFGAME.selectBuilding(null);
  return { n: all.length, worst, seeded: rows.length };
});
check('no indicator asks for more light than the display can show',
      palette.n > 0 && palette.worst <= 1.0,
      `brightest channel across ${palette.n} marks is ${palette.worst.toFixed(2)}`);

await close();
done(errors);
