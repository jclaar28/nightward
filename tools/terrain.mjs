// ---------------------------------------------------------------------------
// terrain — whether the ground is a field or a chequerboard.
//
// The map is 40,000 quads of 1.2 units, and for a long time each one took a
// single colour: a random jitter, a damp/dry noise read once at the quad's
// midpoint, a hard switch to dry grass past a radius, and a slope threshold
// that painted a whole quad stone the moment its corners differed by 0.62.
// Every one of those is a value two neighbouring quads drew independently, so
// every quad edge was a step, and the ground read as tiling — grey tiles
// scattered over rolling hills, and a chequerboard of greens everywhere else.
// The normals had the same shape of problem: a face normal per triangle means
// the light steps at every seam, and the ink pass then draws a line along it.
//
// The fix is to sample by position rather than by cell, so two quads sharing a
// corner ask about the same point and get the same answer. That is a property
// of the mesh, which means it can be measured exactly rather than looked at:
// every vertex that appears more than once must carry one colour and one
// normal, and no step between neighbours may be bigger than the ground itself
// warrants.
//
//   node tools/terrain.mjs
// ---------------------------------------------------------------------------
import { open, check, done } from './harness.mjs';

const SEED = 4242;
const { page, errors, close } = await open();

// All of it runs in the page: the terrain mesh is 240,000 vertices of ten
// floats and there is no reason to carry that across the wire to count it.
const m = await page.evaluate(seed => {
  const T = HF.makeTerrain(seed, null, null, null);
  const mesh = HF.buildStatic(T, null);
  const d = mesh.data(), ST = 10;
  const GRID = 200, EXT = HF.EXT, step = (EXT * 2) / GRID;
  const TERRAIN = GRID * GRID * 6;          // the ground is emitted before the props
  const key = i => `${d[i].toFixed(3)},${d[i + 2].toFixed(3)}`;

  // ---- one colour and one normal per point on the ground -------------------
  const at = new Map();
  let seams = 0, worstSeam = 0, worstNrm = 0, nseam = 0;
  for (let v = 0; v < TERRAIN; v++) {
    const i = v * ST, k = key(i);
    const cur = { n: [d[i + 3], d[i + 4], d[i + 5]], c: [d[i + 6], d[i + 7], d[i + 8]] };
    const had = at.get(k);
    if (!had) { at.set(k, cur); continue; }
    let dc = 0, dn = 0;
    for (let q = 0; q < 3; q++) {
      dc = Math.max(dc, Math.abs(had.c[q] - cur.c[q]));
      dn = Math.max(dn, Math.abs(had.n[q] - cur.n[q]));
    }
    if (dc > 1e-6 || dn > 1e-6) {
      seams++;
      worstSeam = Math.max(worstSeam, dc);
      worstNrm = Math.max(worstNrm, dn);
    }
    nseam++;
  }

  // ---- the ground still has something to look at ---------------------------
  // A seamless field is trivial to get by painting the whole map one flat
  // colour, so this is the check that stops "smoothed" from meaning "erased".
  //
  // It measures the FINE texture specifically — each point against the average
  // of its four neighbours — and that precision was arrived at the hard way.
  // The first version took the spread across all 40,000 points and passed with
  // the grain switched off entirely, because the slow green-to-dry gradient
  // from the middle of the map to its edge is most of that number. The second
  // took the spread within 8x8 patches and passed too, because a patch on a
  // hillside varies by how much rock has come through. Both were measuring the
  // ground's shape, which no amount of flattening the grain would remove. A
  // smooth field of any wavelength has a near-zero answer here; only variation
  // at the scale of the vertices themselves shows up.
  const lumAt = v => 0.299 * v.c[0] + 0.587 * v.c[1] + 0.114 * v.c[2];
  const fine = [];
  const pt = (i, j) => at.get(`${((i - GRID / 2) * step).toFixed(3)},${((j - GRID / 2) * step).toFixed(3)}`);
  for (let i = 6; i < GRID - 6; i += 3) {
    for (let j = 6; j < GRID - 6; j += 3) {
      const c0 = pt(i, j), n = [pt(i - 1, j), pt(i + 1, j), pt(i, j - 1), pt(i, j + 1)];
      if (!c0 || n.some(v => !v)) continue;
      const avg = n.reduce((a, v) => a + lumAt(v), 0) / 4;
      fine.push(Math.abs(lumAt(c0) - avg));
    }
  }
  fine.sort((a, b) => a - b);
  const sd = fine[Math.floor(fine.length / 2)] || 0;

  // ---- how much the ground still varies between one point and the next ------
  // Reported rather than bounded. A step here is not an edge: every point on
  // the ground carries one colour (checked above), so what this measures is the
  // amplitude of the grain, and the grain is meant to be there. The number is
  // worth printing because it is the one that would climb if somebody put a
  // per-cell value back in without breaking the sharing.
  const slope = (x, z) => {
    const e = step;
    const gx = (T.h(x + e, z) - T.h(x - e, z)) / (2 * e);
    const gz = (T.h(x, z + e) - T.h(x, z - e)) / (2 * e);
    return Math.sqrt(gx * gx + gz * gz);
  };
  let worstStep = 0, worstAny = 0, pairs = 0;
  const grab = (i, j) => at.get(`${((i - GRID / 2) * step).toFixed(3)},${((j - GRID / 2) * step).toFixed(3)}`);
  for (let i = 1; i < GRID; i++) {
    for (let j = 1; j < GRID; j++) {
      const x = (i - GRID / 2) * step, z = (j - GRID / 2) * step;
      const a = grab(i, j), b = grab(i + 1, j), c = grab(i, j + 1);
      if (!a || !b || !c) continue;
      const inf = T.infAt(x, z), gentle = slope(x, z) < 0.18;
      for (const o of [[b, x + step, z], [c, x, z + step]]) {
        let dc = 0;
        for (let q = 0; q < 3; q++) dc = Math.max(dc, Math.abs(a.c[q] - o[0].c[q]));
        if (dc > worstAny) worstAny = dc;
        if (!gentle || slope(o[1], o[2]) >= 0.18) continue;
        if (Math.abs(inf - T.infAt(o[1], o[2])) > 0.03) continue;
        pairs++;
        if (dc > worstStep) worstStep = dc;
      }
    }
  }

  // ---- the ground still takes one random number per cell -------------------
  // Not a style point. The old per-cell jitter drew once per quad, and the trees
  // are placed from the same sequence afterwards — so dropping that draw when
  // the jitter went would have quietly re-grown every map anyone had ever
  // played, on every existing seed. There is a bare `rnd()` in the quad loop
  // holding the sequence in place, it looks exactly like dead code, and this is
  // what will object when somebody deletes it.
  //
  // Measured with the props turned off, so the count is the ground's alone.
  const bare = HF.makeTerrain(seed, { trees: 0, scrub: 0, growth: 0 }, null, null);
  let draws = 0;
  const realRnd = bare.rnd;
  bare.rnd = function () { draws++; return realRnd(); };
  HF.buildStatic(bare, null);

  // ---- the normal at a point is the ground's, not its triangle's ------------
  // Checked against the height function itself rather than against the mesh's
  // own idea of the gradient, so this is an independent statement: sample h()
  // either side of the vertex and see whether the mesh agrees about which way
  // the ground faces there. Face normals disagree by tens of degrees.
  let worstTilt = 0;
  for (let i = 8; i < GRID - 8; i += 7) {
    for (let j = 8; j < GRID - 8; j += 7) {
      const x = (i - GRID / 2) * step, z = (j - GRID / 2) * step;
      const e = step;
      const gx = (T.h(x + e, z) - T.h(x - e, z)) / (2 * e);
      const gz = (T.h(x, z + e) - T.h(x, z - e)) / (2 * e);
      const L = Math.sqrt(gx * gx + gz * gz + 1);
      const want = [-gx / L, 1 / L, -gz / L];
      const got = grab(i, j);
      if (!got) continue;
      const dot = want[0] * got.n[0] + want[1] * got.n[1] + want[2] * got.n[2];
      worstTilt = Math.max(worstTilt, Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI);
    }
  }

  return { verts: TERRAIN, points: at.size, shared: nseam, seams, worstSeam,
           sd, patches: fine.length, worstNrm,
           worstStep, worstAny, pairs, worstTilt, draws, cells: GRID * GRID };
}, SEED);

check('the ground is one mesh with shared corners',
      m.shared > 100000, `${m.points} points carrying ${m.verts} vertices`);
check('every point on the ground has one colour and one normal',
      m.seams === 0,
      m.seams ? `${m.seams} of ${m.shared} shared corners disagree — worst by ` +
                `${m.worstSeam.toFixed(3)} in colour, ${m.worstNrm.toFixed(3)} in normal. ` +
                `A seam at every cell edge is what deciding either per cell looks like`
              : 'no corner disagrees with itself');
check('...and there is still something to look at',
      m.sd > 0.0015,
      `a typical point sits ${m.sd.toFixed(4)} in luminance off the average of its ` +
      `four neighbours (median of ${m.patches} samples)`);
check('...spread over the map rather than heaped into a few points',
      m.pairs > 20000 && m.worstStep < 0.045,
      `worst step between two neighbours on quiet ground is ${m.worstStep.toFixed(4)} ` +
      `over ${m.pairs} pairs (${m.worstAny.toFixed(4)} counting cliffs and nest taint, ` +
      `where a fast change is the ground and not the mesh)`);
check('the ground still takes one random number per cell, so old seeds grow the same trees',
      m.draws === m.cells,
      `${m.draws} draws for ${m.cells} cells` +
      (m.draws === m.cells ? '' : ' — the sequence has moved, and every existing map with it'));
check('the normal at a point is the ground\'s, not its triangle\'s',
      m.worstTilt < 6,
      `worst disagreement with the height field is ${m.worstTilt.toFixed(2)}°`);

await close();
done(errors);
