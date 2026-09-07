// ---------------------------------------------------------------------------
// fog — what the map hides, what it remembers, and what it must never hide.
//
// Fog has one failure mode that looks like success: the picture goes dark and
// everything appears to work, while the thing you were trying to hide is still
// on screen at a lower brightness. That is not a hypothetical — the first pass
// here dimmed attackers instead of culling them, and at a gentler fog setting
// a nest in unexplored ground was plainly readable in the screenshot. Dimming
// is right for a place and wrong for anything that moves.
//
// So these checks count instances rather than looking at pixels: an attacker
// nobody can see is not merely dark, it is not in the buffer at all.
//
//   node tools/fog.mjs
// ---------------------------------------------------------------------------
import { open, check, done } from './harness.mjs';

const SEED = 4242;
const { page, errors, close } = await open();

// Everything the renderer was handed this frame, by what it belongs to.
const inject = () => page.evaluate(() => {
  window.__count = () => {
    const rows = __nw.frame().rows, out = {};
    for (const r of rows) out[r.b] = (out[r.b] || 0) + 1;
    const sum = (...ks) => ks.reduce((a, k) => a + (out[k] || 0), 0);
    return { horde: sum('swarm:body', 'runner:body', 'brute:body'),
             nest: out.nest || 0, salvage: out.salvage || 0,
             corpse: out.corpse || 0, hall: out.hall || 0, wall: out.wall || 0,
             all: rows.length };
  };
});
await inject();

// ---- a round opens dark ----------------------------------------------------
const dawn = await page.evaluate(seed => {
  __nw.start(seed);
  const S = __nw.state();
  HFGAME.fogStep();
  let seen = 0;
  for (let i = 0; i < S.fog.length; i++) if (S.fog[i]) seen++;
  return { seen, total: S.fog.length,
           nests: S.nests.length, drawnNests: __count().nest,
           piles: S.nodes.length, drawnPiles: __count().salvage };
}, SEED);
// One commander with sight 9 covers about 113 square units of a 14,400 unit
// map — a fraction, and the whole point of the opening.
check('a round opens on a map you have not seen',
      dawn.seen > 0 && dawn.seen < dawn.total * 0.05,
      `${dawn.seen} of ${dawn.total} cells known — ${(dawn.seen / dawn.total * 100).toFixed(1)}%`);
check('...with the nests still to be found',
      dawn.drawnNests === 0 && dawn.nests > 0,
      `${dawn.nests} nests on the map, ${dawn.drawnNests} drawn`);
check('...and the salvage too',
      dawn.drawnPiles < dawn.piles,
      `${dawn.piles} piles on the map, ${dawn.drawnPiles} drawn`);

// ---- what you have seen, you keep ------------------------------------------
// The difference between fog and a torch. Walk somewhere, leave, and the ground
// stays known while the things moving on it do not.
const memory = await page.evaluate(() => {
  const S = __nw.state();
  S.players[0].supply = 9999;
  __nw.hall(0, 0);
  __nw.run(26);
  // march a scout out to a nest and stamp the fog as it goes, the way walking
  // would — then bring it home
  const sc = S.units.filter(u => u.t === 'scout')[0];
  const nest = S.nests[0];
  for (let i = 0; i <= 60; i++) {
    sc.x = nest.x * i / 60; sc.z = nest.z * i / 60;
    HFGAME.fogStep();
  }
  const there = { nest: __count().nest, gx: HF.w2gx(nest.x), gz: HF.w2gx(nest.z) };
  const atNest = HFGAME.fogAt(there.gx, there.gz);
  sc.x = 0; sc.z = 4; HFGAME.fogStep();
  const home = { nest: __count().nest, fog: HFGAME.fogAt(there.gx, there.gz) };
  return { there, atNest, home };
});
check('walking to a nest reveals it', memory.atNest === 2 && memory.there.nest > 0,
      `in sight (${memory.atNest}), ${memory.there.nest} nest instances drawn`);
check('...and walking away leaves it remembered, not forgotten',
      memory.home.fog === 1 && memory.home.nest > 0,
      `explored but not in sight (${memory.home.fog}), still drawn`);

// ---- a place is remembered; a body is not ----------------------------------
const kinds = await page.evaluate(() => {
  const S = __nw.state();
  const far = S.nests[0];
  S.wave = 200; HFGAME.startWave(); __nw.invincible(); __nw.run(1);
  S.enemies.forEach(e => { e.x = far.x; e.z = far.z; });
  // a corpse out at the same nest, pushed after the wave so nothing resets it
  S.corpses.length = 0;
  S.corpses.push({ x: far.x, z: far.z, rot: 0, sc: 1, life: 8, max: 8, gnd: 0 });
  HFGAME.fogStep();
  const away = __count();
  // now put the scout back on top of them
  const sc = S.units.filter(u => u.t === 'scout')[0];
  sc.x = far.x; sc.z = far.z; HFGAME.fogStep();
  const watching = __count();
  return { away, watching, enemies: S.enemies.length };
});
check('attackers in ground nobody is watching are not drawn at all',
      kinds.away.horde === 0 && kinds.watching.horde > 0,
      `${kinds.enemies} on the field: ${kinds.away.horde} drawn unwatched, ` +
      `${kinds.watching.horde} once a scout is there`);
// This is the one the first pass got wrong. Dimming leaves a silhouette, and a
// silhouette is all anybody needed.
check('...and it is a cull, not a dimming', kinds.away.horde === 0,
      'zero instances, not dark ones');
check('a corpse is an event and goes with the sight',
      kinds.away.corpse === 0 && kinds.watching.corpse > 0,
      `${kinds.away.corpse} unwatched, ${kinds.watching.corpse} watched`);
check('...while the nest beside it stays remembered',
      kinds.away.nest > 0, `${kinds.away.nest} nest instances with nobody there`);

// ---- your own people are never in the dark ---------------------------------
// A unit that vanished because it walked out of its own sight would be a bug
// wearing a rule's clothes.
const mine = await page.evaluate(() => {
  const S = __nw.state();
  const sc = S.units.filter(u => u.t === 'scout')[0];
  sc.x = -52; sc.z = -52;                       // a corner nobody has ever been to
  HFGAME.fogStep();
  return { fog: HFGAME.fogAt(HF.w2gx(-52), HF.w2gx(-52)),
           drawn: __nw.frame().rows.filter(r => r.b.indexOf('scout') === 0).length };
});
check('your own unit is drawn wherever it is', mine.drawn > 0,
      `standing in fog level ${mine.fog}, still ${mine.drawn} instances`);

// ---- the switch actually switches ------------------------------------------
const off = await page.evaluate(() => {
  const S = __nw.state();
  S.enemies.forEach(e => { e.x = 40; e.z = 40; });     // nowhere anybody is looking
  HFGAME.fogStep();
  const on = __count();
  HF.setStat('fog', 'on', 0);
  const gone = __count();
  HF.setStat('fog', 'on', 1);
  return { on, gone };
});
check('turning fog off puts the whole map back',
      off.on.horde === 0 && off.gone.horde > 0 && off.gone.all > off.on.all,
      `${off.on.all} instances with fog, ${off.gone.all} without`);

// ---- what it costs ---------------------------------------------------------
// Rebuilt every frame rather than cached, because the thing that changes it is
// a unit walking and that happens every frame anyway. It has to be cheap enough
// that not caching it is the right call.
const cost = await page.evaluate(() => {
  const S = __nw.state();
  while (S.enemies.length < 900) {
    const c = Object.assign({}, S.enemies[S.enemies.length % 8]);
    c.x = (Math.random() - 0.5) * 90; c.z = (Math.random() - 0.5) * 90;
    S.enemies.push(c);
  }
  const t0 = performance.now();
  for (let i = 0; i < 30; i++) HFGAME.fogStep();
  return { ms: (performance.now() - t0) / 30, cells: S.fog.length,
           enemies: S.enemies.length };
});
check('a frame of fog costs a fraction of a frame', cost.ms < 3,
      `${cost.ms.toFixed(2)}ms over ${cost.cells} cells, ${cost.enemies} attackers on the field`);

// ---- the minimap tells the same story as the world -------------------------
// The minimap is a 2D canvas, so this reads its pixels rather than counting
// instances. It is here because the first fog pass gated the nests' tainted
// ground and not the nest markers drawn in a second loop below it, so every
// objective was still a red dot on an unexplored map — fogged world, honest-
// looking minimap, and the one thing the design asks you to go and find given
// away on the first frame. Two loops draw a nest; both have to ask.
const mini = await page.evaluate(async () => {
  const S = __nw.state(), cv = document.getElementById('minimap');
  // a fresh round so nothing has been explored yet
  HF.setStat('fog', 'on', 1);
  __nw.start(4242);
  const S2 = __nw.state();
  __hf.show('play');
  const red = () => {
    const g = cv.getContext('2d');
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    // the nest marker is rgb(255,86,58); nothing else on the map is that hot
    for (let i = 0; i < d.length; i += 4)
      if (d[i] > 200 && d[i + 1] < 140 && d[i + 2] < 110) n++;
    return n;
  };
  const paint = () => new Promise(r => requestAnimationFrame(() => r()));
  await paint(); await paint();
  const dark = red();
  // walk a unit onto a nest, the way finding one works
  const u = S2.units[0], nest = S2.nests[0];
  for (let i = 0; i <= 40; i++) {
    u.x = nest.x * i / 40; u.z = nest.z * i / 40; HFGAME.fogStep();
  }
  await paint(); await paint();
  return { dark, found: red(), nests: S2.nests.length };
});
check('an undiscovered nest is not on the minimap either',
      mini.dark === 0 && mini.nests > 0,
      `${mini.nests} nests, ${mini.dark} marker pixels before anybody has been`);
check('...and appears once somebody walks to it', mini.found > 0,
      `${mini.found} marker pixels after`);

// ---- fog is weather, not nightfall ------------------------------------------
// Fog used to scale the ground's colour toward black, and at noon that made
// three quarters of the screen a night scene with one lit patch in it — the
// complaint was that the game looked like midnight in the middle of the day.
// It blends toward the hour's own fog colour now, so the same code gives haze
// by day and darkness by night.
//
// The reading has to be a comparison, not a level: the same patch of the same
// map at the same hour, once hidden and once in plain sight. A threshold on
// brightness alone would pass a build that had simply turned every light up.
// And brightness alone is not the whole claim either — a fog bank that sits at
// the terrain's own brightness is still obviously fog, because it is flat and
// grey where the ground is grainy and green. So this measures all three.
const tone = await page.evaluate(() => {
  window.requestAnimationFrame = function () { return 0; };
  const S = __nw.state();
  const cv = document.querySelector('canvas'), gl = cv.getContext('webgl2');
  const c = HFGAME.cam(); c.tx = 0; c.tz = 0; c.zoom = 30;
  const L = (F, i) => 0.299 * F.b[i] + 0.587 * F.b[i + 1] + 0.114 * F.b[i + 2];
  function read() {
    __nw.frame();
    const w = cv.width, h = cv.height, b = new Uint8Array(w * h * 4), F = { w, h, b };
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
    // A corner of the frame, far from the commander and never walked to.
    let lum = 0, det = 0, chr = 0, n = 0;
    for (let y = 1; y < h * 0.35; y++) for (let x = 1; x < w * 0.3; x++) {
      const i = (y * w + x) * 4;
      lum += L(F, i);
      det += Math.abs(L(F, i) - L(F, i - 4)) + Math.abs(L(F, i) - L(F, i - w * 4));
      chr += Math.max(b[i], b[i + 1], b[i + 2]) - Math.min(b[i], b[i + 1], b[i + 2]);
      n++;
    }
    return { lum: +(lum / n).toFixed(1), detail: +(det / n).toFixed(2), chroma: +(chr / n).toFixed(1) };
  }
  const out = {};
  for (const [name, p] of [['day', 0.0], ['night', 1.0]]) {
    S.dayP = p;
    HF.setStat('fog', 'on', 1); const hid = read();
    HF.setStat('fog', 'on', 0); const vis = read();
    out[name] = { hid, vis };
  }
  HF.setStat('fog', 'on', 1);
  return out;
});
check('unexplored ground at noon is weather, not nightfall',
      tone.day.hid.lum > tone.day.vis.lum * 0.75,
      `hidden ground reads ${tone.day.hid.lum}/255 against ${tone.day.vis.lum} for the same ` +
      `ground in plain sight; scaling toward black instead of toward the hour's fog colour ` +
      `puts it at 2.3, which is what "the fog makes it look like night" was`);
check('...and is still plainly hidden, by being flat and grey rather than dark',
      tone.day.hid.detail < tone.day.vis.detail * 0.72 &&
      tone.day.hid.chroma < tone.day.vis.chroma * 0.75,
      `half the local detail (${tone.day.hid.detail} against ${tone.day.vis.detail}) and half ` +
      `the colour (${tone.day.hid.chroma} against ${tone.day.vis.chroma}) — what reads as fog ` +
      `when the brightness matches`);
check('...while at night the hidden ground is darker than the lit ground, not brighter',
      tone.night.hid.lum < tone.night.vis.lum,
      `${tone.night.hid.lum} against ${tone.night.vis.lum} — the hour's fog colour is near ` +
      `black at 2am, so the one blend covers both ends of the day`);

// ---- the knobs that decide how it looks ------------------------------------
// Three numbers that change nothing about WHAT is hidden or when — that is
// dark, dim and sight — only what the hidden part looks like. They exist to be
// dragged while staring at the map, which makes them the same kind of thing as
// the pacing block: a knob that moves nothing is worse than no knob, because it
// costs a playtest to find out.
//
// Each one is measured where it can actually show, and the first version of
// this got that wrong twice. It sampled a corner of a fresh map for all three —
// but a fresh corner is UNEXPLORED, where the level is `dark` and the picture
// is 94% fog colour whatever the drain does, so drain read identical to itself.
// And it counted "hidden" by looking for green-dominant pixels, which this
// terrain is not: with the fog switched off the check still called 98% of the
// frame hidden. So the fog state is set deliberately here — everything
// unexplored for one reading, everything remembered for the other — and how
// much the fog is touching is measured against the same frame with fog off,
// which needs no colour threshold at all.
const look = await page.evaluate(() => {
  window.requestAnimationFrame = function () { return 0; };
  const S = __nw.state();
  const cv = document.querySelector('#view'), gl = cv.getContext('webgl2');
  const c = HFGAME.cam(); c.tx = 0; c.tz = 0; c.zoom = 30;
  const L = (F, i) => 0.299 * F.b[i] + 0.587 * F.b[i + 1] + 0.114 * F.b[i + 2];
  const KEYS = ['on', 'dark', 'dim', 'haze', 'keep', 'falloff'];
  const def = k => HF.statDefs('fog').fields.filter(f => f.k === k)[0].def;
  const reset = () => { for (const k of KEYS) HF.setStat('fog', k, def(k)); };
  function read(k, v, remembered) {
    reset();
    if (k) HF.setStat('fog', k, v);
    S.dayP = 0.0;
    // Walked everywhere and standing at home, or never walked at all. Both are
    // whole-map states, so the corner sampled below is unambiguous.
    for (let i = 0; i < S.fog.length; i++) S.fog[i] = remembered ? 1 : 0;
    HFGAME.fogStep();
    __nw.frame();
    const w = cv.width, h = cv.height, b = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
    const F = { w, h, b };
    let lum = 0, tint = 0, n = 0;
    for (let y = 1; y < h * 0.35; y++) for (let x = 1; x < w * 0.3; x++) {
      const i = (y * w + x) * 4;
      lum += L(F, i);
      // Green minus blue, SIGNED. Plain chroma — the spread between the
      // channels — is the wrong statistic here and reads non-monotonic: the
      // grass is green over blue and the fog colour is blue over green, so a
      // half-and-half mix of the two is greyer than either end and the middle
      // setting measured as the least colourful of the three. The signed
      // difference has no such fold: grass is +17, the fog colour is -8, and
      // grey is 0.
      tint += b[i + 1] - b[i + 2];
      n++;
    }
    reset();
    return { lum: +(lum / n).toFixed(1), tint: +(tint / n).toFixed(1), F };
  }
  // How much of the picture the fog is touching at all: pixels that differ from
  // the same frame with it switched off. No colour threshold, so no terrain to
  // be wrong about.
  const clear = read('on', 0, true);
  function touched(r) {
    let moved = 0, n = 0;
    for (let i = 0; i < r.F.b.length; i += 4) {
      n++;
      if (Math.abs(L(r.F, i) - L(clear.F, i)) >= 6) moved++;
    }
    return +(moved / n * 100).toFixed(1);
  }
  const unseen = read(null, 0, false);
  const remem  = read(null, 0, true);
  const out = {
    unseenLum: unseen.lum, rememTint: remem.tint, rememLum: remem.lum,
    hazeUp: read('haze', 1.6, false).lum,
    hazeDn: read('haze', 0.4, false).lum,
    keepOff: read('keep', 0, true).tint,
    keepAll: read('keep', 3, true).tint,
    tight: touched(read('falloff', 2.5, true)),
    loose: touched(read('falloff', 0.4, true)),
    shipped: touched(remem),
    off: touched(clear)
  };
  reset();
  HFGAME.syncStats();
  return out;
});

check('haze brightness lifts and drops the unseen map',
      look.hazeUp > look.unseenLum * 1.15 && look.hazeDn < look.unseenLum * 0.75,
      `${look.hazeDn} at 0.4x, ${look.unseenLum} shipped, ${look.hazeUp} at 1.6x, on ` +
      `ground nobody has walked. It scales the hour's own fog colour, so a round played ` +
      `at 0.4 is heavy weather at every hour rather than a dark noon and an unchanged ` +
      `midnight`);
check('colour in memory decides how grey a remembered field goes',
      look.keepOff < look.rememTint - 1.5 && look.keepAll > look.rememTint + 1.5,
      `the ground's own tint reads ${look.keepOff} at 0, ${look.rememTint} shipped and ` +
      `${look.keepAll} at 3 — measured on ground that has been walked, which is the only ` +
      `place it can show, since unexplored ground is grey before this touches it. It ` +
      `shipped as "drain" and moved the other way: the number is the weight on the ` +
      `ground's own colour, so turning it up keeps more`);
check('the edge knob moves how much of the picture the fog is holding',
      look.tight > look.shipped + 2 && look.loose < look.shipped - 2,
      `${look.loose}% of the frame differs from a fog-free one at 0.4, ${look.shipped}% ` +
      `shipped, ${look.tight}% at 2.5. The texture is filtered, so there is no threshold ` +
      `to sharpen — the gamma bends where the middle of that gradient sits, which is the ` +
      `same thing to the eye`);
check('...and none of them is the off switch',
      look.off === 0 && look.shipped > 40,
      `${look.off}% with the fog off against ${look.shipped}% on. Three look knobs and a ` +
      `rule knob in one block is a place to lose an hour wondering why the map is dark`);

// ---- nothing is painted on top of the fog ----------------------------------
// A decal is BLENDED: what it writes is what it adds. So "hidden" means it adds
// nothing — and blending one toward the fog COLOUR instead paints that colour on
// top of ground which is already that colour. The mist lattice covers the whole
// map, so every patch of it became a pale disc of daylight-grey on the dark, and
// a night of mist was a field of bright circles. It shipped that way in the
// commit that made fog weather rather than nightfall.
//
// The reading is structure where there should be none. Hidden ground is a flat
// blend toward one colour, so its brightest pixels should sit close to its mean;
// a disc added on top is a large local excursion and nothing else is.
const paint = await page.evaluate(() => {
  window.requestAnimationFrame = function () { return 0; };
  // Its own round. This file has started several by the time it gets here and
  // marched units all over them, so inheriting whatever the last one left meant
  // the camera sat where nothing had been walked: 14,904 hidden samples and 0
  // visible ones, and the control half of the check was empty.
  HF.setStat('fog', 'on', 1);
  __nw.start(4242);
  const S = __nw.state();
  S.players[0].supply = 99999;
  __nw.hall(0, 0);
  __nw.run(30);
  const cv = document.querySelector('#view'), gl = cv.getContext('webgl2');
  // Close enough that the circle you can actually see is a real share of the
  // frame: at zoom 30 it was 89 pixels against 14,815 hidden ones, and the
  // control half of the check had nothing in it to control with.
  const c = HFGAME.cam(); c.tx = 0; c.tz = 0; c.zoom = 11;
  const KEYS = ['on', 'dark', 'dim', 'haze', 'keep', 'mist', 'falloff'];
  for (const k of KEYS)
    HF.setStat('fog', k, HF.statDefs('fog').fields.filter(f => f.k === k)[0].def);
  const L = (F, i) => 0.299 * F.b[i] + 0.587 * F.b[i + 1] + 0.114 * F.b[i + 2];
  // The same frame at the same hour with the mist on and off, which is the only
  // comparison that isolates it. Absolute thresholds on "how flat is the hidden
  // ground" were tried twice and both measured the framing instead: a ring
  // around the whole frame reads a big lift before the mist is even up, because
  // the top of it is sky, and trimming to the sides below the horizon still
  // leaves trees, lit grass and the edge of the visible circle in it.
  function at(p, mist) {
    HF.setStat('fog', 'mist', mist);
    HFGAME.syncStats();
    S.dayP = p;
    __nw.frame();
    const w = cv.width, h = cv.height, b = new Uint8Array(w * h * 4), F = { w, h, b };
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
    return F;
  }
  // Split by what the fog says about the ground under each pixel rather than by
  // where it lands on screen, so nothing about the camera can put a lit pixel in
  // the hidden bucket. The pixel's world position comes from the same ray the
  // cursor uses.
  function split(A, B) {
    let hidN = 0, hidD = 0, visN = 0, visD = 0;
    for (let y = A.h * 0.42; y < A.h * 0.92; y += 6) for (let x = 4; x < A.w - 4; x += 6) {
      const i = ((y | 0) * A.w + (x | 0)) * 4;
      const g = HFGAME.pickWorld(x, A.h - y);
      if (!g) continue;
      const lit = HFGAME.fogAt(HF.w2gx(g.x), HF.w2gx(g.z)) >= 2;
      const d = Math.abs(L(A, i) - L(B, i));
      if (lit) { visN++; visD += d; } else { hidN++; hidD += d; }
    }
    return { hidden: +(hidD / Math.max(1, hidN)).toFixed(2), hidN,
             visible: +(visD / Math.max(1, visN)).toFixed(2), visN };
  }
  const on = at(0.55, 1), off = at(0.55, 0);
  const misty = split(on, off);
  // ...and that the knob is a scale rather than a switch. Without this, taking
  // the multiply out of mistK() and leaving only its zero guard passes
  // everything above, because every reading here is on against off.
  const thick = split(at(0.55, 2), off);
  const onN = at(1.0, 1), offN = at(1.0, 0);
  const night = split(onN, offN);
  for (const k of KEYS)
    HF.setStat('fog', k, HF.statDefs('fog').fields.filter(f => f.k === k)[0].def);
  HFGAME.syncStats();
  return { misty, night, thick };
});

check('the mist does not paint on ground you cannot see',
      paint.misty.hidden < paint.misty.visible * 0.25 && paint.misty.visible > 2,
      `switching the mist off at the same hour changes hidden ground by ` +
      `${paint.misty.hidden}/255 and the ground you can see by ${paint.misty.visible} ` +
      `(${paint.misty.hidN} hidden samples, ${paint.misty.visN} visible). A decal is ` +
      `blended, so hidden has to mean it adds nothing — blended toward the fog COLOUR ` +
      `instead it paints that colour on top of ground which is already that colour, and ` +
      `every patch of the lattice becomes a pale disc on the dark`);
check('...and the mist knob is a dial, not a switch',
      paint.thick.visible > paint.misty.visible * 1.4,
      `${paint.thick.visible} of change at 2x against ${paint.misty.visible} at 1x`);
check('...at any hour of the night',
      paint.night.hidden < paint.night.visible * 0.25 && paint.night.visible > 2,
      `${paint.night.hidden} hidden against ${paint.night.visible} visible at two in ` +
      `the morning — the visible half is the control, and without it this passes by the ` +
      `mist never being drawn at all`);

await close();
done(errors);
