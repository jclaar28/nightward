// ---------------------------------------------------------------------------
// weather — the world moving when nothing in the simulation moves.
//
// The trees are part of the static mesh: one buffer, one draw call, nothing per
// tree to animate on the CPU. So the wind lives in the vertex shader, and what
// tells it which vertices are foliage is a sway weight packed into the top of
// the emissive channel — emit uses 0-2 and the finish uses the next two bits,
// so everything from 32 up was free. That packing is the part that can break
// silently: get the arithmetic wrong and a canopy stops being matte, or a
// brazier stops being a light, and nothing throws.
//
// The motion itself is checked against the clock rather than against the wall,
// because the whole point of driving it from the simulation's own cosmetic
// timer is that a headless run of a known number of steps draws the same frame
// every time.
//
//   node tools/weather.mjs
// ---------------------------------------------------------------------------
import { open, check, done } from './harness.mjs';

const { page, errors, close } = await open();

const m = await page.evaluate(() => {
  window.requestAnimationFrame = function () { return 0; };
  HF.setStat('fog', 'on', 0);
  __nw.start(9);
  const S = __nw.state();
  __nw.hall(0, 0);
  __nw.run(24);
  S.dayP = 0.0;

  const cv = document.querySelector('canvas'), gl = cv.getContext('webgl2');
  const R = window.__hf.gl;
  const shot = () => {
    __nw.frame();
    const w = cv.width, h = cv.height, b = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
    return b;
  };
  const moved = (A, B) => {
    let n = 0, tot = 0;
    for (let i = 0; i < A.length; i += 4) {
      tot++;
      const la = 0.299 * A[i] + 0.587 * A[i + 1] + 0.114 * A[i + 2];
      const lb = 0.299 * B[i] + 0.587 * B[i + 1] + 0.114 * B[i + 2];
      if (Math.abs(la - lb) > 6) n++;
    }
    return +(100 * n / tot).toFixed(2);
  };
  const look = (x, z) => {
    const c = HFGAME.cam(); c.tx = x; c.tz = z; c.zoom = 13; c.az = 38; c.el = 36;
  };
  const at = t => { S.tt = t; return shot(); };

  // ---- a stand of trees, two clock readings apart --------------------------
  look(26, 26);
  const A = at(10), B = at(11.4), again = at(10);
  const forest = moved(A, B);
  let identical = 0;
  for (let i = 0; i < A.length; i++) if (A[i] !== again[i]) identical++;

  // ---- the same two readings with the wind turned off ----------------------
  const orig = R.setClock;
  R.setClock = function (t) { return orig.call(this, t, 0); };
  const C = at(10), D = at(11.4);
  R.setClock = orig;
  const still = moved(C, D);

  // ---- the plateau, where nothing should move at all -----------------------
  // The buildable middle of the map: flat, and trees are seeded from
  // buildR + 3.4 outward, so a close view of it contains ground, buildings and
  // units and not one thing that is allowed to sway. A first version hunted for
  // "open grass" by checking only that the ground was level, framed a stand of
  // pines fifteen units away, and reported the ground rippling at 3.9%.
  // zoom 6, not 9: the view is wider than it is tall, so at 9 the corners reach
  // 16.9 units out and the nearest trees start at 14.8. That difference is the
  // whole of a 1.27% reading that looked like the ground rippling.
  look(0, 0);
  const c0 = HFGAME.cam(); c0.zoom = 6;
  const grass = moved(at(10), at(11.4));
  c0.zoom = 13;

  // ---- the packing ---------------------------------------------------------
  const T = HF.makeTerrain(9, null, null, null);
  const mesh = HF.buildStatic(T, null), d = mesh.data(), ST = 10;
  const GROUND = 200 * 200 * 6;
  let groundSway = 0, swayed = 0, maxSway = 0, badEmit = 0, badMat = 0, verts = 0;
  for (let v = 0; v < d.length / ST; v++) {
    const e = d[v * ST + 9];
    const sway = Math.floor(e / 32), emit = e % 8, mat = Math.floor((e % 32) / 8);
    verts++;
    if (sway > 0) { swayed++; if (sway > maxSway) maxSway = sway; }
    if (v < GROUND && sway > 0) groundSway++;
    if (emit !== 0 && emit !== 1 && emit !== 2) badEmit++;
    if (mat < 0 || mat > 3) badMat++;
  }

  return { forest, still, grass, identical, verts, swayed, maxSway,
           groundSway, badEmit, badMat,
           swayPct: +(100 * swayed / verts).toFixed(1) };
});

check('the wind moves a forest without the simulation moving',
      m.forest > 2, `${m.forest}% of the frame changed between two clock readings ` +
      `1.4s apart, with nothing else touched`);
check('...and it is the wind doing it', m.still === 0,
      `${m.still}% changed over the same two readings with the wind set to zero`);
check('...and nothing else in the world moves with it', m.grass < 0.4,
      `${m.grass}% changed on a close view of the settlement — flat ground, buildings and ` +
      `units, and no tree within reach of the frame`);
check('the same clock draws the same frame', m.identical === 0,
      m.identical ? `${m.identical} bytes differ between two draws at the same clock — ` +
                    `the wind is running off something other than the clock`
                  : 'byte for byte, which is what a headless run needs');
check('foliage carries a sway weight and the ground carries none',
      m.groundSway === 0 && m.swayed > 1000 && m.maxSway === 7,
      `${m.swayed} of ${m.verts} vertices sway (${m.swayPct}%), heaviest ${m.maxSway}, ` +
      `${m.groundSway} of them terrain`);
check('...and packing it there left emit and finish alone',
      m.badEmit === 0 && m.badMat === 0,
      `${m.badEmit} vertices decode to an impossible emissive level, ${m.badMat} to an ` +
      `impossible finish — the two fields the sway weight shares a float with`);

await close();
done(errors);
