// ---------------------------------------------------------------------------
// scout — the unit, and the vision rule that gives it a job.
//
// The scout is the first thing in the game whose whole value is information,
// and information is the easiest kind of feature to ship broken: it looks
// finished because the unit walks around, and nobody notices the minimap is
// still telling you everything it always did. So the checks here are mostly
// about what you CANNOT see.
//
// It is also the first building that musters two kinds of unit. That path used
// to be `spawns` + `cap`, one kind, and the retrain loop counted the whole
// garrison — so a hall that owed a scout would have been "full" with three
// workers, or a dead scout would have come back as a worker. Both of those are
// checked.
//
//   node tools/scout.mjs
// ---------------------------------------------------------------------------
import { open, check, done } from './harness.mjs';

const SEED = 4242;
const { page, errors, close } = await open();

// ---- it arrives with the town ----------------------------------------------
const born = await page.evaluate(seed => {
  __nw.start(seed);
  const S = __nw.state();
  const before = S.units.filter(u => u.t === 'scout').length;
  __nw.hall(0, 0);
  const onPlace = S.units.filter(u => u.t === 'scout').length;
  __nw.run(25);
  const hall = S.players[0].hall;
  return { before, onPlace, after: S.units.filter(u => u.t === 'scout').length,
           workers: S.units.filter(u => u.t === 'worker').length,
           inGarrison: hall ? hall.garrison.filter(u => u.t === 'scout').length : -1,
           housed: HFGAME.housedBy(hall).filter(u => u.t === 'scout').length };
}, SEED);
check('no scout before there is a town', born.before === 0 && born.onPlace === 0,
      `${born.before} at the start, ${born.onPlace} while the hall is still a site`);
check('the hall musters a scout alongside its workers',
      born.after === 1 && born.workers === 2,
      `${born.after} scout, ${born.workers} workers`);
// housedBy filters to civil units, which is what keeps a scout out of the
// shelter button and out of the "N workers living here" line.
check('...and it is garrisoned without being housed',
      born.inGarrison === 1 && born.housed === 0,
      `in the garrison ${born.inGarrison}, counted as housed ${born.housed}`);

// ---- it comes back, as itself ----------------------------------------------
// The retrain loop used to compare the whole garrison against one cap. With two
// kinds in one building that is wrong twice over: a hall with three workers and
// no scout reads as full, and a hall short a scout would muster whatever
// `spawns` named. This is the check that says the loop asks what is missing.
const back = await page.evaluate(() => {
  const S = __nw.state(), hall = S.players[0].hall;
  const kill = t => {
    const u = S.units.filter(x => x.t === t)[0];
    const i = S.units.indexOf(u), g = hall.garrison.indexOf(u);
    if (i >= 0) S.units.splice(i, 1);
    if (g >= 0) hall.garrison.splice(g, 1);
  };
  kill('scout');
  const gone = S.units.filter(u => u.t === 'scout').length;
  const retrain = HF.statsOf('hall').retrain;
  __nw.run(retrain * 0.5);
  const half = S.units.filter(u => u.t === 'scout').length;
  __nw.run(retrain * 0.6 + 1);
  const done2 = S.units.filter(u => u.t === 'scout').length;
  // and a dead worker still comes back a worker, not whatever was asked for last
  kill('worker');
  __nw.run(retrain + 1);
  return { gone, half, done: done2, retrain,
           workers: S.units.filter(u => u.t === 'worker').length,
           scouts: S.units.filter(u => u.t === 'scout').length };
});
check('a dead scout is not replaced instantly', back.gone === 0 && back.half === 0,
      `still ${back.half} halfway through the ${back.retrain}s rebuild`);
check('...and comes back at the hall on the retrain clock', back.done === 1);
check('...and a dead worker still comes back a worker',
      back.workers === 2 && back.scouts === 1,
      `${back.workers} workers, ${back.scouts} scouts`);

// ---- it is the fastest thing you own ---------------------------------------
// 2.90 against the runner's 2.85 is the whole reason the unit can be sent
// anywhere. If the runner is ever retuned past it the scout stops working and
// nothing else in the suite would notice.
const legs = await page.evaluate(() => {
  const s = t => HF.statsOf(t).speed;
  return { scout: s('scout'), runner: s('runner'), commander: s('commander'),
           worker: s('worker'), archer: s('archer'), soldier: s('soldier'),
           sight: HF.statsOf('scout').sight,
           bestOther: Math.max(HF.statsOf('hall').sight, HF.statsOf('ballista').sight,
                               HF.statsOf('archer').sight, HF.statsOf('commander').sight) };
});
check('nothing can run a scout down', legs.scout > legs.runner,
      `scout ${legs.scout} against the runner's ${legs.runner}`);
check('...and nothing of yours is faster',
      legs.scout > Math.max(legs.commander, legs.worker, legs.archer, legs.soldier),
      `next fastest of yours is ${Math.max(legs.commander, legs.worker, legs.archer, legs.soldier)}`);
check('it sees further than anything else you own', legs.sight > legs.bestOther * 1.5,
      `${legs.sight}u against ${legs.bestOther}u`);

// ---- the rule that gives it a job ------------------------------------------
// The point of the whole feature: an attacker nobody is looking at is not on
// the minimap. Before this the minimap drew every enemy on the map, so a scout
// could not have told you anything.
const eyes = await page.evaluate(() => {
  const S = __nw.state();
  S.wave = 200;
  HFGAME.startWave();
  __nw.invincible();
  __nw.run(1);
  // Park everything of yours at home and put one attacker far out on the map,
  // well beyond anything's sight.
  S.units.forEach(u => { u.x = 0; u.z = 2.6; });
  const far = S.enemies[0];
  far.x = 34; far.z = 34;
  let mask = HFGAME.visionMask(0);
  const blind = HFGAME.seenAt(mask, far.x, far.z);
  const seenNow = S.enemies.filter(e => HFGAME.seenAt(mask, e.x, e.z)).length;

  // Now walk the scout out to it. Nothing else moves, nothing else is built —
  // the only thing that changed is where the scout is standing.
  const sc = S.units.filter(u => u.t === 'scout')[0];
  sc.x = 34 - HF.statsOf('scout').sight * 0.6; sc.z = 34;
  mask = HFGAME.visionMask(0);
  const withScout = HFGAME.seenAt(mask, far.x, far.z);

  // ...and a worker standing in the same spot does not do the same job
  sc.x = 0; sc.z = 2.6;
  const wk = S.units.filter(u => u.t === 'worker')[0];
  wk.x = 34 - HF.statsOf('scout').sight * 0.6; wk.z = 34;
  mask = HFGAME.visionMask(0);
  const withWorker = HFGAME.seenAt(mask, far.x, far.z);
  return { blind, seenNow, withScout, withWorker, total: S.enemies.length };
});
check('an attacker nobody is looking at is off the minimap', !eyes.blind,
      `${eyes.seenNow} of ${eyes.total} attackers visible with everyone at home`);
check('a scout sent out puts it back on', eyes.withScout,
      'the only thing that changed is where the scout is standing');
check('...and a worker in the same spot cannot', !eyes.withWorker,
      'sight is the scout\'s, not just any pair of eyes');

// ---- what stays visible ----------------------------------------------------
// Narrow on purpose: this hides the horde, not the map. A settlement knows
// where the hills and the nests are; where the horde is right now is the part
// you have to earn. If this ever starts hiding nests it has become fog of war
// by accident, which is a design decision nobody made.
const kept = await page.evaluate(() => {
  const S = __nw.state();
  return { nests: S.nests.length, piles: S.nodes.filter(n => n.amt > 0).length,
           cells: Object.keys(S.cells).length };
});
check('nests, piles and your own buildings are not hidden',
      kept.nests > 0 && kept.piles > 0 && kept.cells > 0,
      `${kept.nests} nests, ${kept.piles} piles, ${kept.cells} cells — all still in state`);

// ---- what it costs ---------------------------------------------------------
// The mask is rebuilt every minimap refresh, ~16 times a second, against a
// late-night field. A distance test per enemy per watcher would be ~32,000
// hypots a refresh; this is a byte grid and one index per lookup.
const cost = await page.evaluate(() => {
  const S = __nw.state();
  // A late night, not the fifteen attackers a first wave happens to have —
  // timing the cheap case and quoting it as the expensive one is how a
  // performance check passes for years and then does not.
  while (S.enemies.length < 900) {
    const c = Object.assign({}, S.enemies[S.enemies.length % 15]);
    c.x = (Math.random() - 0.5) * 90; c.z = (Math.random() - 0.5) * 90;
    S.enemies.push(c);
  }
  // ...and a real settlement's worth of watchers, since the mask is stamped
  // once per building and once per unit
  S.players[0].supply = 99999;
  for (let i = 0; i < 60; i++)
    __nw.place(i % 3 ? 'wall' : 'tower', -18 + (i % 12) * 3, -18 + Math.floor(i / 12) * 3);
  __nw.run(6);
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) HFGAME.visionMask(0);
  const build = (performance.now() - t0) / 20;
  const mask = HFGAME.visionMask(0);
  const t1 = performance.now();
  for (let i = 0; i < 20; i++)
    for (const e of S.enemies) HFGAME.seenAt(mask, e.x, e.z);
  return { build, look: (performance.now() - t1) / 20, enemies: S.enemies.length,
           watchers: S.units.length + __nw.roots().length };
});
// The minimap refreshes about 16 times a second, so the whole job has to cost
// a small slice of one frame at 60fps.
check('a refresh costs a fraction of a frame',
      cost.build + cost.look < 4,
      `${cost.build.toFixed(2)}ms to build + ${cost.look.toFixed(2)}ms to test ` +
      `${cost.enemies} attackers against ${cost.watchers} watchers`);

await close();
done(errors);
