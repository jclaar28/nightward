// ---------------------------------------------------------------------------
// smoke — does a round actually work, end to end, with nothing on fire?
//
// Run this after any change. It plays a real round headlessly: raises the hall,
// builds one of everything, waits out construction, and holds a night. Every
// assertion is a number read out of the running game, not a screenshot.
//
//   node tools/smoke.mjs
// ---------------------------------------------------------------------------
import { open, check, done } from './harness.mjs';

const SEED = 4242;

const { page, errors, close } = await open();

// ---- the opening: a commander, no hall, nothing built ----------------------
const boot = await page.evaluate(seed => {
  __nw.start(seed);
  const S = __nw.state();
  return { units: S.units.map(u => u.t), hall: !!S.players[0].hall,
           supply: S.players[0].supply, phase: S.phase,
           day: Math.round(S.dayLeft || 0) };
}, SEED);
check('round opens with a lone commander', boot.units.join(',') === 'commander', boot.units.join(','));
check('no hall until you place one', boot.hall === false);

// ---- the commander walks over and raises it --------------------------------
const raised = await page.evaluate(() => {
  __nw.hall(0, 0);
  const S = __nw.state();
  const wasSite = !!S.players[0].site;
  __nw.run(25);
  return { wasSite, hall: !!S.players[0].hall,
           units: S.units.map(u => u.t).sort().join(',') };
});
check('placing the hall creates a site, not a building', raised.wasSite);
check('commander raises it', raised.hall);
check('the hall musters two workers', raised.units === 'commander,worker,worker', raised.units);

// ---- everything else goes up as a construction site first ------------------
const built = await page.evaluate(() => {
  const S = __nw.state();
  S.players[0].supply = 5000;
  const kinds = ['tower','ballista','brazier','barracks','archery','cottage','wall','gate'];
  const spots = [[6,6],[9,6],[-6,6],[6,-6],[-6,-6],[9,-6],[-9,6],[-9,3]];
  const onPlace = {}, longest = Math.max(...kinds.map(k => +HFGAME.TYPES[k].raise || 0));
  kinds.forEach((k, i) => {
    __nw.place(k, spots[i][0], spots[i][1]);
    const c = __nw.at(spots[i][0], spots[i][1]);
    onPlace[k] = !!(c && c.site);
  });
  const armyDuring = S.units.filter(u => !HFGAME.UNITS[u.t].civil).length;
  __nw.run(longest + 2);
  const after = {};
  kinds.forEach((k, i) => {
    const c = __nw.at(spots[i][0], spots[i][1]);
    after[k] = !!(c && !c.site && c.hp >= c.max);
  });
  return { allSites: kinds.every(k => onPlace[k]),
           allBuilt: kinds.every(k => after[k]),
           armyDuring,
           armyAfter: S.units.filter(u => !HFGAME.UNITS[u.t].civil).length,
           longest };
});
check('every building starts as a site', built.allSites);
check('every building finishes on its own', built.allBuilt, `within ${built.longest + 2}s`);
check('a barracks musters nobody until it stands',
      built.armyDuring === 1 && built.armyAfter > 1,
      `${built.armyDuring} during, ${built.armyAfter} after`);

// ---- a site is inert: it does not shoot ------------------------------------
// A fresh round with one hall and one tower. Isolation is the point: the first
// version of this ran on the board above, where a built ballista and a second
// tower were also firing, and every shot on the map was credited to the one
// building under test.
const inert = await page.evaluate(seed => {
  __nw.start(seed);
  __nw.hall(0, 0);
  __nw.run(25);
  const S = __nw.state();
  S.players[0].supply = 5000;
  __nw.place('tower', 4, 4);
  const twr = __nw.at(4, 4);
  S.wave = 200;
  HFGAME.startWave();
  const tx = HF.gx2w(twr.gx), tz = HF.gx2w(twr.gz);
  // Park an attacker inside the tower's range and keep the town standing, so
  // "did it shoot" is a real question and the round does not end mid-test.
  const step = () => {
    __nw.invincible();
    const e = S.enemies[0];
    if (e) { e.x = tx + 1.2; e.z = tz + 1.2; e.hp = e.max = 1e9; }
  };
  let asSite = 0, closest = 99;
  for (let i = 0; i < 30 * 12; i++) {
    twr.prog = 0; step();
    const n = S.bolts.length; HFGAME.update(1 / 30);
    if (S.bolts.length > n) asSite += S.bolts.length - n;
    for (const e of S.enemies) closest = Math.min(closest, Math.hypot(e.x - tx, e.z - tz));
  }
  const stillSite = !!twr.site;
  let built = 0;
  for (let i = 0; i < 30 * 12; i++) {
    step();
    const n = S.bolts.length; HFGAME.update(1 / 30);
    if (S.bolts.length > n) built += S.bolts.length - n;
  }
  return { asSite, built, stillSite, nowBuilt: !twr.site,
           inRange: closest <= HFGAME.TYPES.tower.range, closest: +closest.toFixed(2) };
}, SEED);
check('an attacker was actually inside the tower\'s range', inert.inRange, `closest ${inert.closest}`);
check('the tower stayed unfinished for the first half', inert.stillSite && inert.nowBuilt);
check('an unbuilt tower fires nothing', inert.asSite === 0, `${inert.asSite} bolts`);
check('a built tower fires', inert.built > 0, `${inert.built} bolts`);

// ---- the night runs and the frame draws ------------------------------------
const night = await page.evaluate(() => {
  const S = __nw.state();
  const f = __nw.frame();
  return { phase: S.phase, enemies: S.enemies.length,
           instances: f.rows.length, batches: Object.keys(f.counts).length };
});
check('the wave is on the field', night.phase === 'attack' && night.enemies > 0,
      `${night.enemies} enemies`);
check('the frame draws something', night.instances > 100,
      `${night.instances} instances across ${night.batches} batches`);

await close();
done(errors);
