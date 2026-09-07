// ---------------------------------------------------------------------------
// campaign — the round runs until every hall is gone or every nest is.
//
// A night is no longer the end of anything. These checks drive several full
// day/night cycles headlessly and assert on both endings, on the escalation
// between nights, and on the nests being a real objective rather than a
// formality.
//
//   node tools/campaign.mjs
// ---------------------------------------------------------------------------
import { open, check, done } from './harness.mjs';

const SEED = 4242;
const { page, errors, close } = await open();

// A helper that runs the clock forward until the phase changes or time is up.
const untilPhase = `
window.__until = function (want, capSeconds) {
  const S = __nw.state();
  const steps = Math.round((capSeconds || 600) * 30);
  for (let i = 0; i < steps; i++) {
    HFGAME.update(1 / 30);
    if (S.phase === want) return { ok: true, at: i / 30 };
    if (S.phase === 'won' || S.phase === 'lost') return { ok: false, ended: S.phase };
  }
  return { ok: false, timeout: true, phase: S.phase };
};`;
await page.evaluate(untilPhase);

// ---- surviving a night gives you the next day, not a victory ---------------
const cycles = await page.evaluate(seed => {
  __nw.start(seed);
  __nw.hall(0, 0);
  __nw.run(25);
  const S = __nw.state();
  const log = [];
  for (let night = 0; night < 3; night++) {
    S.players[0].supply = 100000;          // not an economy test
    // a wall of towers so the town actually holds
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * 6.283;
      __nw.place('tower', Math.cos(a) * 6.5, Math.sin(a) * 6.5);
    }
    __nw.run(12);
    // S.wave is only set at nightfall now, so ask what tonight will be rather
    // than reading last night's number (which is 0 before the first one).
    const before = { night: S.night, wave: HFGAME.waveSize(), ehp: +S.ehp.toFixed(1) };
    __until('attack', 600);                // ride the day out to nightfall
    const inWave = S.phase === 'attack';
    // This checks the loop, not the difficulty. Pin the hall through the night
    // so a lost fight cannot be misread as "the cycle does not continue" —
    // whether a given wave is survivable is balance.mjs's question, not this
    // one, and leaving it to chance made this test flap.
    const steps = Math.round(300 * 30);
    for (let i = 0; i < steps; i++) {
      const h = S.players[0].hall; if (h) { h.hp = h.max; }
      HFGAME.update(1 / 30);
      if (S.phase !== 'attack') break;
    }
    log.push({ ...before, reachedNight: inWave, phaseAfter: S.phase,
               nightAfter: S.night, waveAfter: S.wave });
  }
  return { log, nests: S.nests.filter(n => !n.dead).length };
}, SEED);

check('the first night ends in a new day, not a win',
      cycles.log[0] && cycles.log[0].phaseAfter === 'build',
      `phase after night 1: ${cycles.log[0] && cycles.log[0].phaseAfter}`);
check('three nights held in a row',
      cycles.log.length === 3 && cycles.log.every(c => c.phaseAfter === 'build'),
      cycles.log.map(c => c.phaseAfter).join(','));
check('the night counter advances',
      cycles.log.map(c => c.night).join(',') === '1,2,3',
      cycles.log.map(c => c.night).join(','));

// ---- and each night is bigger than the last, by a widening margin ----------
const waves = cycles.log.map(c => c.wave);
const gaps = waves.slice(1).map((w, i) => w - waves[i]);
check('each night is bigger than the last', gaps.every(g => g > 0), waves.join(' → '));

// The claim is that the ramp COMPOUNDS — that night ten is worse than nine
// times as much extra as night two. Three consecutive nights cannot show that
// any more: the wave is a whole number of attackers per nest, and at the
// gentler ramp the rounding on two adjacent nights is bigger than the
// difference between their steps. This reads the curve over a span where
// rounding cannot reach, which is what the claim was always about; playing
// those nights would measure survival instead, and that is balance.mjs's
// question rather than this one's.
const curve = await page.evaluate(() => {
  const S = __nw.state(), keep = S.night, out = [];
  for (const n of [1, 4, 7, 10]) { S.night = n; out.push(HFGAME.waveSize()); }
  S.night = keep;
  return out;
});
const cGaps = curve.slice(1).map((w, i) => w - curve[i]);
check('the growth accelerates', cGaps[cGaps.length - 1] > cGaps[0] * 1.2,
      `nights 1, 4, 7 and 10 are ${curve.join(', ')} — steps of ${cGaps.join(', ')}. ` +
      `A ramp that added a flat number every night would give three equal steps, and ` +
      `a long run would be no harder than a short one per night survived`);

// ---- losing every hall still ends it ---------------------------------------
const lost = await page.evaluate(seed => {
  __nw.start(seed);
  __nw.hall(0, 0);
  __nw.run(25);
  const S = __nw.state();
  __until('attack', 600);
  const steps = Math.round(300 * 30);
  for (let i = 0; i < steps; i++) {
    HFGAME.update(1 / 30);
    if (S.phase === 'lost' || S.phase === 'won') break;
  }
  return { phase: S.phase, night: S.night, out: S.players[0].out };
}, SEED);
check('an undefended town loses the round', lost.phase === 'lost',
      `phase ${lost.phase} on night ${lost.night}`);

// ---- nests are garrisoned, and defend themselves ---------------------------
const guards = await page.evaluate(seed => {
  __nw.start(seed);
  const S = __nw.state();
  const atStart = S.enemies.filter(e => e.guard).length;
  __nw.hall(0, 0);
  __nw.run(25);
  // walk one soldier's worth of damage into a nest and see what answers
  const n = S.nests[0];
  const before = S.enemies.filter(e => e.home === n).length;
  HFGAME.update(1 / 30);
  const hp0 = n.hp;
  // hit it the way a unit would, crediting seat 0
  for (let i = 0; i < 20; i++) { n.hp -= 5; HFGAME.update(1 / 30); }
  n.hp = hp0;                                  // the damage was the trigger, not the point
  const stat = HF.statsOf('nest');
  return { atStart, before, want: stat.guard,
           nestHp: n.max, cache: stat.cache, leash: stat.leash };
}, SEED);
check('nests are garrisoned from the first morning',
      guards.atStart >= guards.want, `${guards.atStart} guards, want ${guards.want} per nest`);
check('a nest is worth marching out for', guards.nestHp >= 1000 && guards.cache > 0,
      `${guards.nestHp} hp, ${guards.cache} supply cache`);

// ---- guards stay home, and the day is still safe to work -------------------
// Attackers now exist during the build phase, which is a change that could
// quietly gut the economy: if a garrison wandered in and killed the workers,
// nothing else in the game would report it.
const day = await page.evaluate(seed => {
  __nw.start(seed);
  __nw.hall(0, 0);
  __nw.run(25);
  const S = __nw.state();
  const assign = () => S.units.filter(u => u.t === 'worker').forEach(u => {
    let best = null, bd = 1e9;
    S.nodes.forEach(n => { if (n.amt <= 1) return;
      const d = Math.hypot(n.x - u.x, n.z - u.z); if (d < bd) { bd = d; best = n; } });
    if (best) HFGAME.assignJob([u], best);
  });
  const civil = () => S.units.filter(u => HFGAME.UNITS[u.t].civil).length;
  let peak = civil(), roam = 0;
  for (let t = 0; t < 300; t += 5) {
    assign(); __nw.run(5);
    peak = Math.max(peak, civil());
    S.enemies.forEach(e => {
      if (!e.home) return;
      roam = Math.max(roam, Math.hypot(e.x - e.home.x, e.z - e.home.z));
    });
  }
  const leash = HF.statsOf('nest').leash;
  return { peak, atDusk: civil(), gathered: Math.round(S.gathered),
           roam: +roam.toFixed(2), leash, phase: S.phase };
}, SEED);
check('no worker is lost to a nest guard during the day',
      day.atDusk >= day.peak, `${day.peak} at peak, ${day.atDusk} at dusk`);
check('the day still pays', day.gathered > 100, `${day.gathered} salvage gathered`);
check('guards stay within their leash of home', day.roam <= day.leash + 2,
      `furthest ${day.roam} from its nest, leash ${day.leash}`);

// Nothing came near a nest in that run, so the chase never ran. Walk something
// up to one and watch: a guard that never moves is dead code that passes.
const chase = await page.evaluate(seed => {
  __nw.start(seed);
  __nw.hall(0, 0);
  __nw.run(25);
  const S = __nw.state();
  const n = S.nests[0], leash = HF.statsOf('nest').leash;
  // Bait, stood inside the leash and kept alive. It has to sit on the nest's
  // *inward* side: nests are near the rim, and the first version of this put the
  // bait past the edge of the grid, where the off-map rule drags anything that
  // reaches it back toward the middle. The guards were chasing correctly and
  // being reeled in, which read as "they stop four units short".
  const bait = S.units[0];
  const L = Math.hypot(n.x, n.z) || 1;
  const bx = n.x - (n.x / L) * leash * 0.7, bz = n.z - (n.z / L) * leash * 0.7;
  const half = HF.GN * HF.CELL / 2;
  const onMap = Math.abs(bx) < half - 1 && Math.abs(bz) < half - 1;
  let closed = 99, roam = 0;
  for (let i = 0; i < 30 * 20; i++) {
    bait.x = bait.px = bx; bait.z = bait.pz = bz; bait.hp = bait.max = 1e9;
    HFGAME.update(1 / 30);
    S.enemies.forEach(e => {
      if (e.home !== n) return;
      closed = Math.min(closed, Math.hypot(e.x - bx, e.z - bz));
      roam = Math.max(roam, Math.hypot(e.x - n.x, e.z - n.z));
    });
  }
  // now take the bait away and let them settle back
  bait.x = bait.px = 0; bait.z = bait.pz = 0;
  for (let i = 0; i < 30 * 25; i++) HFGAME.update(1 / 30);
  let home = 0;
  S.enemies.forEach(e => { if (e.home === n)
    home = Math.max(home, Math.hypot(e.x - n.x, e.z - n.z)); });
  return { closed: +closed.toFixed(2), roam: +roam.toFixed(2), onMap,
           settled: +home.toFixed(2), leash, reach: HFGAME.ENEMY.shambler.reach };
}, SEED);
check('the bait is actually on the map', chase.onMap === true);
check('a guard comes for something that walks up to its nest',
      chase.closed <= chase.reach + 0.6,
      `closed to ${chase.closed}, reach ${chase.reach}`);
check('and never chases past the leash', chase.roam <= chase.leash + 1.5,
      `strayed ${chase.roam}, leash ${chase.leash}`);
check('and goes home once it is gone', chase.settled <= 3,
      `settled ${chase.settled} from the nest`);

// ---- killing every nest wins, and pays --------------------------------------
const won = await page.evaluate(seed => {
  __nw.start(seed);
  __nw.hall(0, 0);
  __nw.run(25);
  const S = __nw.state();
  const purse = S.players[0].supply;
  // credit the damage to seat 0 the way a unit's blows would, then finish it
  const doDamage = n => {
    while (n.hp > 0 && !n.dead) { HFGAME.hurtNest(n, 400, 0); HFGAME.update(1 / 30); }
  };
  S.nests.forEach(doDamage);
  for (let i = 0; i < 60; i++) HFGAME.update(1 / 30);
  return { phase: S.phase, live: S.nests.filter(n => !n.dead).length,
           gained: S.players[0].supply - purse, cache: HF.statsOf('nest').cache,
           nests: S.nests.length };
}, SEED);
check('clearing every nest wins the round', won.phase === 'won',
      `phase ${won.phase}, ${won.live} nests left`);
check('each nest paid its cache to whoever took it',
      won.gained === won.cache * won.nests,
      `${won.gained} supply for ${won.nests} nests at ${won.cache} each`);

await close();
done(errors);
