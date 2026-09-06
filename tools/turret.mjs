// ---------------------------------------------------------------------------
// turret — the platform, and the three things about it that are not like
// anything else in the game.
//
// It is the second thing a worker builds with their hands rather than a timer,
// the only building that may be placed onto something already standing, and the
// only one whose garrison is units you put there rather than units it makes.
// Each of those is a hole in an assumption the rest of the code makes, so each
// is measured here.
//
//   node tools/turret.mjs
// ---------------------------------------------------------------------------
import { open, check, done } from './harness.mjs';

const SEED = 4242;
const { page, errors, close } = await open();

const boot = await page.evaluate(seed => {
  HF.setStat('fog', 'on', 0);          // this is not a test about seeing things
  __nw.start(seed);
  const S = __nw.state();
  S.players[0].supply = 99999;
  __nw.hall(0, 0);
  __nw.run(26);
  __nw.place('archery', 8, 8);
  __nw.run(14);
  return { archers: S.units.filter(u => u.t === 'archer').length };
}, SEED);
check('a round with archers to put somewhere', boot.archers > 0, `${boot.archers} mustered`);

// ---- a timer will not finish it --------------------------------------------
// Every other building goes up whether anybody came. This one does not, and
// that asymmetry is the feature: the cost of a turret is the workers who are
// not gathering while it goes up.
const labour = await page.evaluate(() => {
  const S = __nw.state();
  __nw.place('turret', -14, -14);
  const t = __nw.at(-14, -14);
  const wasSite = !!t.site;
  // everybody far away and indoors: a timer would tick anyway
  S.units.filter(u => u.t === 'worker').forEach(u => { u.x = 40; u.z = 40; u.shelter = true; });
  __nw.run(14);
  const idle = t.prog;
  S.units.filter(u => u.t === 'worker').forEach(u => {
    u.shelter = false; u.inside = false; u.x = -13; u.z = -13; u.route = null; u.job = null;
  });
  __nw.run(30);
  return { wasSite, idle, worked: t.prog, need: t.need, done: !t.site };
});
check('a turret starts as a site like everything else', labour.wasSite);
check('...but no timer finishes it', labour.idle < 0.01,
      `${labour.idle.toFixed(3)}s of progress in 14s with nobody there`);
check('...workers walk to it and build it with their hands',
      labour.worked > 1 && labour.done,
      `${labour.worked.toFixed(1)}s of labour against ${labour.need}, standing ${labour.done}`);

// ---- it can be built onto a wall -------------------------------------------
// The only building in the game that may be placed on an occupied cell, and
// only onto your own finished palisade. Everything else about placement assumes
// an empty cell, so both halves of that are checked.
const onWall = await page.evaluate(() => {
  const S = __nw.state();
  const line = [];
  for (let x = -6; x <= 6; x += 1.5) { __nw.place('wall', x, 12); line.push(x); }
  __nw.place('gate', 9, 12);
  __nw.run(6);
  const gx = HF.w2gx(0), gz = HF.w2gx(12);
  const before = __nw.at(0, 12).type;
  const okWall = HFGAME.canPlace('turret', gx, gz, S.players[0]);
  const okGate = HFGAME.canPlace('turret', HF.w2gx(9), gz, S.players[0]);
  const okTower = HFGAME.canPlace('tower', gx, gz, S.players[0]);
  __nw.place('turret', 0, 12);
  const now = __nw.at(0, 12);
  // the run either side has to grow an arm into it, which is wallRot/joins
  // counting the turret as a neighbour rather than anything drawn by hand
  const west = __nw.at(-1.5, 12), east = __nw.at(1.5, 12);
  const arms = HFGAME.armMask ? -1 : -1;
  return { before, okWall, okGate, okTower, now: now.type, site: !!now.site,
           neighbours: (west ? west.type : '-') + '/' + (east ? east.type : '-'),
           cells: Object.keys(S.cells).filter(k => S.cells[k].type === 'wall').length };
});
check('a turret may be placed onto your own palisade', onWall.okWall && onWall.before === 'wall');
check('...but not onto a gate', !onWall.okGate,
      'a gate is a decision about where they are invited through');
check('...and nothing else may be placed onto anything', !onWall.okTower,
      'canPlace still refuses an occupied cell for every other type');
check('...and the wall it replaced is gone, not buried under it',
      onWall.now === 'turret' && onWall.neighbours === 'wall/wall',
      `cell is ${onWall.now}, neighbours ${onWall.neighbours}`);

// The wall run has to close around it, and that is joins() counting the turret
// as wallish rather than any drawing code knowing about turrets.
const joined = await page.evaluate(() => {
  const S = __nw.state();
  const t = __nw.at(0, 12);
  t.site = false; t.prog = t.need; t.hp = t.max;
  HFGAME.update(1 / 60);
  const rows = __nw.frame().rows;
  // a palisade emits one arm per connected neighbour; the two cells either side
  // of the turret should each be emitting one toward it
  // count only the run at z=12, not the standalone turret from the check above
  const near = q => Math.abs(q.z - HF.gx2w(HF.w2gx(12))) < 1.0;
  return { walls: rows.filter(r => r.b === 'wall' && near(r)).length,
           turrets: rows.filter(r => r.b === 'turret' && near(r)).length };
});
check('the palisades either side grow their arms into it',
      joined.turrets === 1 && joined.walls > 8,
      `${joined.turrets} turret, ${joined.walls} wall arms in the run`);

// ---- the garrison ----------------------------------------------------------
// Not the barracks' kind of garrison. These are units you already own, put
// there by hand, and the building makes none of its own.
const crew = await page.evaluate(() => {
  const S = __nw.state();
  const t = __nw.at(0, 12);
  const archers = S.units.filter(u => u.t === 'archer');
  const soldiers = S.units.filter(u => u.t === 'soldier');
  const workers = S.units.filter(u => u.t === 'worker');
  const cap = HF.statsOf('turret').cap | 0;
  const putAll = HFGAME.manTurret(archers.concat(soldiers, workers), t);
  const up = HFGAME.crewOf(t);
  return { cap, putAll, n: up.length,
           kinds: up.map(u => u.t).filter((v, i, a) => a.indexOf(v) === i),
           archers: archers.length };
});
check('archers go up and nothing else does',
      crew.kinds.length === 1 && crew.kinds[0] === 'archer',
      `on the platform: ${crew.kinds.join(',') || 'nobody'}`);
check('...and only as many as it holds', crew.n === crew.cap,
      `${crew.n} up, cap ${crew.cap}, offered ${crew.archers} archers plus melee and workers`);

// ---- the range is the whole point ------------------------------------------
const reach = await page.evaluate(() => {
  const S = __nw.state();
  const t = __nw.at(0, 12);
  const a = HFGAME.crewOf(t)[0];
  const base = HF.statsOf('archer').range, bonus = HF.statsOf('turret').range;
  S.wave = 200; HFGAME.startWave(); __nw.invincible();
  __nw.run(1);
  const tx = HF.gx2w(t.gx), tz = HF.gx2w(t.gz);
  // one attacker, parked between the archer's own range and the turret's
  const d = base + bonus * 0.5;
  const shots = (range) => {
    S.enemies.forEach((e, i) => { e.hp = e.max = 1e9; e.x = tx + (i ? 400 : d); e.z = tz; });
    let n = 0;
    for (let i = 0; i < 30 * 6; i++) {
      __nw.invincible();
      S.enemies.forEach((e, i2) => { e.x = tx + (i2 ? 400 : d); e.z = tz; e.hp = 1e9; });
      const before = S.bolts.length;
      HFGAME.update(1 / 30);
      if (S.bolts.length > before) n += S.bolts.length - before;
    }
    return n;
  };
  const onTop = shots();
  // now take the same archer down and stand it in the same spot on the ground
  HFGAME.clearTurret(t);
  a.x = tx; a.z = tz; a.px = tx; a.pz = tz;
  S.units.filter(u => u.t === 'archer' && u !== a).forEach(u => { u.x = 300; u.z = 300; });
  const onGround = shots();
  return { base, bonus, d, onTop, onGround };
});
check('the test target is out of an archer\'s own reach and inside the turret\'s',
      reach.d > reach.base && reach.d < reach.base + reach.bonus,
      `target at ${reach.d.toFixed(1)}u, archer reaches ${reach.base}, turret adds ${reach.bonus}`);
check('an archer on the platform hits it', reach.onTop > 0, `${reach.onTop} arrows`);
check('...and the same archer on the ground cannot', reach.onGround === 0,
      `${reach.onGround} arrows from the same spot without the platform`);

// ---- what happens when it comes down ---------------------------------------
// The counterplay to a garrison the horde cannot reach: it can reach the
// building, and the archers land in the open at whatever health they had.
const fall = await page.evaluate(() => {
  const S = __nw.state();
  const t = __nw.at(0, 12);
  const a = S.units.filter(u => u.t === 'archer')[0];
  HFGAME.manTurret([a], t);
  const up = !!HFGAME.crewOf(t).length;
  // melee cannot reach somebody on a platform — the horde is all melee, so this
  // is what "safe until it falls" actually is
  const reachable = (() => {
    let n = 0;
    for (const u of S.units) if (!u.inside && !u.tur) n++;
    return n;
  })();
  const wasOn = S.units.filter(u => u.tur).length;
  HFGAME.removeAt(t.gx, t.gz);
  return { up, wasOn, stillOn: S.units.filter(u => u.tur).length,
           alive: S.units.indexOf(a) >= 0, reachable };
});
check('a unit on a platform is not something a melee attacker can reach',
      fall.up && fall.wasOn > 0,
      `${fall.wasOn} on the platform, skipped by the attacker\'s target scan`);
check('and when the turret goes, they come down alive and in the open',
      fall.stillOn === 0 && fall.alive,
      'crew released, not deleted');

await close();
done(errors);
