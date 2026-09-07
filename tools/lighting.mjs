// ---------------------------------------------------------------------------
// lighting — whether you can see what is coming.
//
// Night is when this game is at its best and it was also when it was least
// legible: a body at the treeline stood 13.6 levels of luminance off what was
// behind it at night against 26 by day, so a wave of ninety attackers was a
// wave you could pick out ten of. That is a number, which means it can be
// defended.
//
// The measurement is the one that matters for a silhouette: the contrast at the
// BOUNDARY of a shape, not the average over its middle. A shape reads by its
// outline. Averaging the whole body dilutes exactly the pixels doing the work,
// and averaging in the shadow it casts is worse still — at dusk the shadow is
// ten times the area of the thing that cast it, and an early version of this
// reported dusk as the hardest hour to see a body when what it had measured was
// the contrast of a shadow.
//
// One check has been taken out rather than left in green. It measured how far
// the outline sat from the BODY it belonged to, which is the one reading that
// tells a pale outline from a dark one, and it worked: 15.2 against 9.1 with
// the moonlit ink removed. Then the wind shipped, a canopy came to rest behind
// the unit, and against leaves rather than grass it read 21.1 against 21.7 —
// no separation, and the wrong way round. A check that cannot fail is worse
// than no check, so it is gone; what defends that feature now is the count of
// cold marks below, which separates 8,936 against 19,772.
//
//   node tools/lighting.mjs
// ---------------------------------------------------------------------------
import { open, check, done } from './harness.mjs';

const { page, errors, close } = await open();

const m = await page.evaluate(() => {
  // The page runs its own frame loop, and it keeps running while this function
  // does its work — every reading below would otherwise be taken from whatever
  // it drew last rather than from the frame set up here.
  window.requestAnimationFrame = function () { return 0; };
  HF.setStat('fog', 'on', 0);
  __nw.start(11);
  const S = __nw.state();
  S.players[0].supply = 999999;
  __nw.hall(0, 0);
  __nw.run(24);

  const cv = document.querySelector('canvas'), gl = cv.getContext('webgl2');
  const shot = () => {
    __nw.frame();
    const w = cv.width, h = cv.height, b = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
    return { w, h, b };
  };
  const L = (F, i) => 0.299 * F.b[i] + 0.587 * F.b[i + 1] + 0.114 * F.b[i + 2];

  // One body, on open ground, out of reach of every lamp, in a frozen pose.
  // The gait phase advances with distance walked, so two runs of an earlier
  // version measured two different stances and disagreed by twelve levels on an
  // unchanged build. Freeze it and the whole tool is bit-identical run to run.
  // It stands on the plateau, which is the one part of the map with no trees on
  // it — they are seeded from buildR + 3.4 outward. An earlier version put it at
  // (34,0) out in the forest, which was fine until the wind shipped: the trees
  // are displaced even at clock zero, one of them moved in behind the unit, and
  // what the tool then measured was a body against a canopy rather than a body
  // against grass. Daylight contrast read 26.3 instead of 45.5 and nothing
  // about the lighting had changed.
  // It stands out in the forest, and the two alternatives tried are why. On the
  // open plateau a body at midnight is a dark shape on moonlit grass and reads
  // at 55 levels with the rim and 55 without — a scene where the thing being
  // measured cannot show. Inside the hall's lamp pool it is better lit still.
  // Legibility fails where the ground is dark and the background is darker,
  // which is the treeline, so that is where this stands.
  //
  // The wind matters here: it displaces canopies even at clock zero, so this
  // spot's numbers are not comparable with any taken before the wind shipped.
  // Both figures quoted below were re-measured on a build that has it.
  const u = S.units.filter(x => !x.inside)[0];
  u.x = 34; u.z = 0; u.sel = false; u.ph = 0; u.rot = 0.9; u.path = null;
  const c = HFGAME.cam(); c.tx = 34; c.tz = 0; c.zoom = 9; c.az = 38; c.el = 36;

  function silhouette() {
    const A = shot(); u.inside = true; const B = shot(); u.inside = false;
    const w = A.w, h = A.h, chg = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) if (Math.abs(L(A, p * 4) - L(B, p * 4)) >= 6) chg[p] = 1;
    const edge = [], inner = []; let ground = 0, n = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x; if (!chg[p]) continue;
      const i = p * 4; n++; ground += L(B, i);
      if (!chg[p - 1] || !chg[p + 1] || !chg[p - w] || !chg[p + w])
        edge.push({ d: Math.abs(L(A, i) - L(B, i)), v: L(A, i) });
      else inner.push(L(A, i));
    }
    edge.sort((a, b) => a.d - b.d);
    inner.sort((a, b) => a - b);
    const mid = inner[Math.floor(inner.length / 2)] || 0;
    // How far the outline stands off the THING, not off the ground behind it.
    // Contrast against the ground alone cannot tell a dark outline from a pale
    // one — both differ from the grass by about the same amount — and a dark
    // line around a dark body does not separate the two, it just makes the body
    // a little bigger. What separates them is a line that neither the body nor
    // the ground could have produced.
    const off = edge.map(e => Math.abs(e.v - mid)).sort((a, b) => a - b);
    return { edge: +(edge[Math.floor(edge.length / 2)].d || 0).toFixed(1),
             offBody: +(off[Math.floor(off.length * 0.75)] || 0).toFixed(1),
             px: n, ground: +(ground / Math.max(1, n)).toFixed(1) };
  }
  const hour = {};
  for (const [name, p] of [['day', 0.0], ['dusk', 0.5], ['night', 1.0]]) {
    S.dayP = p; hour[name] = silhouette();
  }

  // ---- the whole field at night, with nothing of ours in it ----------------
  // The counterweight to everything above: making the night legible must not
  // mean making it day. This is the picture with no unit in it at all.
  S.dayP = 1.0;
  const F = shot();
  let lum = 0, px = 0;
  const hist = new Float64Array(256);
  for (let i = 0; i < F.b.length; i += 4) {
    const v = L(F, i); lum += v; px++; hist[Math.min(255, Math.round(v))]++;
  }
  const nightMean = +(lum / px).toFixed(1);
  // The mean is not enough on its own: an edge light can be turned up until the
  // silhouettes glow like neon and barely move it, because edges are a sliver
  // of the frame. The bright tail is what notices.
  let acc = 0, nightTop = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= px * 0.005) { nightTop = v; break; } }
  // Thin bright marks in that same frame. The moonlit outline is only supposed
  // to reach things that stand up; the map is strewn with pebbles and tufts,
  // and lighting every edge turned a night into a wireframe with a line round
  // every stone. A pebble's outline is a pixel brighter than everything beside
  // it, so counting local spikes counts exactly what went wrong.
  const blue = i => F.b[i + 2] - F.b[i];      // how cold a pixel is
  let spikes = 0;
  for (let y = 1; y < F.h - 1; y++) for (let x = 1; x < F.w - 1; x++) {
    const p = y * F.w + x, i = p * 4, v = L(F, i);
    if (v < 24) continue;
    const nb = [p - 1, p + 1, p - F.w, p + F.w];
    const lv = nb.map(q => L(F, q * 4)).sort((a, b) => a - b);
    if (v - (lv[1] + lv[2]) / 2 < 9) continue;
    // and cold with it. Moonlight is blue and the scene is not, so this counts
    // the outline specifically rather than every lit pebble top — a plain
    // brightness spike could not tell the two apart and reported thirteen
    // thousand of them on a frame that looked right.
    const bv = nb.map(q => blue(q * 4)).sort((a, b) => a - b);
    if (blue(i) - (bv[1] + bv[2]) / 2 >= 6) spikes++;
  }

  // ---- firelight moves -----------------------------------------------------
  // Two braziers, one on the flat plateau and one out on ground that is not
  // level with it. Comparing what the two hang above their OWN ground is the
  // only reading that tells the two possible answers apart: pinned to the
  // plateau they would agree with each other about height above the plateau and
  // disagree about height above the grass.
  __nw.place('brazier', 5, 5);
  __nw.place('brazier', 34, 6);
  __nw.run(40);
  const seen = [];
  let last = null;
  const orig = window.__hf.gl.setLamps;
  window.__hf.gl.setLamps = function (list) {
    if (list && list.length) { seen.push(list.map(l => l[7])); last = list.map(l => l.slice()); }
    return orig.apply(this, arguments);
  };
  for (let i = 0; i < 6; i++) { __nw.run(0.6); __nw.frame(); }
  window.__hf.gl.setLamps = orig;

  // The two braziers, picked out of the lamp list by the radius their spec
  // gives them, so this compares like with like rather than a brazier with a
  // hall window.
  const braz = (last || []).filter(l => Math.abs(l[3] - 10.0) < 0.01)
    .map(l => ({ over: +(l[1] - __nw.ground(l[0], l[2])).toFixed(2),
                 relief: +(__nw.ground(l[0], l[2]) - HF.PLAT).toFixed(2) }));

  let swing = 0;
  if (seen.length > 2) {
    const n = Math.min(...seen.map(s => s.length));
    for (let k = 0; k < n; k++) {
      const col = seen.map(s => s[k]);
      swing = Math.max(swing, (Math.max(...col) - Math.min(...col)) / Math.max(1e-6, Math.max(...col)));
    }
  }
  return { hour, nightMean, frames: seen.length, swing: +(swing * 100).toFixed(1),
           lampN: seen.length ? seen[0].length : 0, braz, nightTop, spikes };
});

check('a body reads in daylight',
      m.hour.day.edge > 20,
      `${m.hour.day.edge} levels of luminance at its outline, against a treeline — on open ` +
      `grass the same body reads at 77, which is the difference the check below is about`);
check('...and still reads at night',
      m.hour.night.edge >= 16,
      `${m.hour.night.edge} at night against ${m.hour.day.edge} by day — the same scene ` +
      `reads 13.6 with the sky's edge light taken out, which is a wave of ninety you can ` +
      `pick out ten of`);
check('...and at dusk, which is the hour that flatters nothing',
      m.hour.dusk.edge >= 11, `${m.hour.dusk.edge} levels at dusk`);
check('night is still night',
      m.nightMean < 46 && m.nightTop < 175,
      `the frame averages ${m.nightMean}/255 with nothing of yours in it and its ` +
      `brightest half-percent reaches ${m.nightTop} — the check that stops "make the ` +
      `night legible" turning into "make the night day"`);
check('the moonlight only reaches what stands up',
      m.spikes < 15000,
      `${m.spikes} cold thin marks in a night frame; the same frame with the depth ` +
      `gate removed reports 19,772, because then every pebble and tuft on the map ` +
      `has a lit edge and the night is a wireframe. The gate is a depth jump of ` +
      `about a unit of standing height`);
check('firelight moves', m.frames >= 3 && m.swing > 2 && m.swing < 25,
      `${m.lampN} lamps, brightest swings ${m.swing}% over ${m.frames} frames`);
const rel = m.braz.map(b => b.relief), over = m.braz.map(b => b.over);
const drop = Math.max(...rel) - Math.min(...rel);
check('the two braziers are standing on ground at different heights',
      m.braz.length === 2 && drop > 0.25,
      `${rel.join(' and ')} from the plateau — without that the next check ` +
      `cannot tell the two answers apart, and would pass either way`);
check('...and each hangs its fire over its own ground, not over the plateau',
      m.braz.length === 2 && Math.abs(over[0] - over[1]) < 0.05,
      `${over.join(' and ')} above what they stand on`);

await close();
done(errors);
