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

await close();
done(errors);
