// ---------------------------------------------------------------------------
// economy — how much a day pays, and how many of them the map lasts.
//
// A round runs for days now, so "the workers strip the map by dusk" is no
// longer the shape we want. This plays a settlement out day by day with a
// sensible worker loop and reports income per day, when the piles run dry, and
// what the nest caches add on top.
//
//   node tools/economy.mjs                  # the default difficulty
//   node tools/economy.mjs --days 12 --seeds 4
//   node tools/economy.mjs --diff easy,normal,hard
// ---------------------------------------------------------------------------
import { open, check, done } from './harness.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DAYS  = +arg('days', 10);
const DIFFS = arg('diff', 'normal').split(',');
const SEEDS = [4242, 31337, 90210, 5150, 8888, 1234].slice(0, +arg('seeds', 3));

// One settlement, played for real: workers on the nearest live pile, cottages
// bought as they become affordable, nights skipped so this measures the
// economy rather than the fighting.
function runEconomy({ seed, days, diff }) {
  const G = window.__hf.game;
  window.__hf.settings.difficulty = diff;
  __nw.start(seed);
  const S = __nw.state();
  __nw.hall(0, 0);
  __nw.run(25);
  if (!S.players[0].hall) return { error: 'hall never went up' };

  const assign = () => S.units.filter(u => u.t === 'worker' && !u.job).forEach(u => {
    let best = null, bd = 1e9;
    S.nodes.forEach(n => { if (n.amt <= 1) return;
      const d = Math.hypot(n.x - u.x, n.z - u.z); if (d < bd) { bd = d; best = n; } });
    if (best) G.assignJob([u], best);
  });

  const total = S.nodes.reduce((a, n) => a + n.max, 0);
  const perDay = [], workers = [];
  let last = 0, cottages = 0, dryOn = null;

  for (let day = 1; day <= days; day++) {
    // Spend the day gathering, buying a cottage whenever one is affordable.
    // The clock has to be held open: letting dayLeft reach zero calls
    // nightfall(), and the first version of this measured one real day followed
    // by nine nights with every worker dead.
    for (let t = 0; t < S.dayLen - 12; t += 10) {
      S.dayLeft = S.dayLen;
      assign(); __nw.run(10);
      // The same ring of houses round the hall as before, spaced for a building
      // that is 2x2 now rather than 1x1. WHERE a simulated player puts its
      // houses turns out to be part of what every number below means, and two
      // other answers were tried and rejected: the original tighter ring packed
      // them until `place` simply refused, so the thing limiting the workforce
      // was the room to put them and the price could be moved without the
      // reading changing at all; and a widening spiral out to radius 16 kept the
      // workforce growing all run, which flattened the income taper to 87% and
      // failed the check that says the near piles empty. Keep it a ring, and
      // keep it beside the hall.
      // Buy when a cottage plus a working reserve is affordable, in terms of
      // what a cottage actually costs. This was a hard 120, which was four
      // times the price when it was written and one and a half times it after
      // the cottage was repriced — so the tool's own spending changed shape for
      // a reason that had nothing to do with the game.
      const COTT = HFGAME.TYPES.cottage.cost * 1.4;
      while (S.players[0].supply >= COTT && cottages < 8) {
        const a = cottages * 1.15, r = 5.6 + (cottages % 3) * 2.4;
        if (!__nw.place('cottage', Math.cos(a) * r, Math.sin(a) * r)) break;
        cottages++;
      }
    }
    perDay.push(Math.round(S.gathered - last));
    last = S.gathered;
    workers.push(S.units.filter(u => u.t === 'worker').length);
    if (dryOn === null && G.salvageLeft() < 1) dryOn = day;
    // skip the night: this is the economy, not the fight
    S.night++;
    S.dayLeft = S.dayLen;
  }
  return {
    seed, diff, total: Math.round(total), perDay, workers, cottages,
    gathered: Math.round(S.gathered),
    left: Math.round(G.salvageLeft()), dryOn,
    nests: S.nests.length, cache: HF.statsOf('nest').cache,
    send: S.send, wave1: S.nests.length * S.send,
  };
}

// What the first day pays and what the first night sends are one decision, not
// two, and they live in different files — the piles are in STAT_DEFS and the
// send is in DIFF. Moving either alone is how an opening ends up frantic or
// free, so the ratio between them is what gets checked.
const PER = {};
const { page, errors, close } = await open();
const HFGAME_TYPES = await page.evaluate(() => {
  const o = {};
  for (const t in HFGAME.TYPES) o[t] = { cost: HFGAME.TYPES[t].cost };
  return o;
});
await page.evaluate(`window.__econ = ${runEconomy.toString()}`);

for (const diff of DIFFS) {
  console.log(`\n--- ${diff} ---`);
  let dry = [], shares = [], tapers = [], day1 = [], wave1 = 0;
  for (const seed of SEEDS) {
    const r = await page.evaluate(a => window.__econ(a), { seed, days: DAYS, diff });
    if (r.error) { console.log(`seed ${seed}: ${r.error}`); continue; }
    dry.push(r.dryOn === null ? DAYS + 1 : r.dryOn);
    shares.push(Math.max(...r.perDay) / r.total);
    const working = r.perDay.filter(d => d > 0);
    tapers.push(working.length > 1 ? working[working.length - 1] / working[0] : 1);
    day1.push(r.perDay[0]); wave1 = r.wave1;
    console.log(`seed ${String(seed).padEnd(6)} ` +
      `map ${String(r.total).padStart(5)}  gathered ${String(r.gathered).padStart(5)}` +
      `  left ${String(r.left).padStart(5)}  dry on day ${r.dryOn === null ? '-' : r.dryOn}` +
      `  caches ${r.nests * r.cache}\n            per day  ${r.perDay.join(' ')}` +
      `\n            workers  ${r.workers.join(' ')}`);
  }
  const avgDry = dry.reduce((a, b) => a + b, 0) / dry.length;
  console.log(`  runs dry on day ${avgDry.toFixed(1)} on average` +
              ` (a floor only: stripping it early is the failure, lasting the run is not)`);
  // A floor, and no ceiling any more.
  //
  // This used to want the map dry around two thirds of the way through, so that
  // scarcity pushed you out to the nests for their caches. That stopped being
  // reachable once the cottage was priced to limit a workforce: a crew that
  // small cannot strip the map inside a run however long you give it, and
  // shrinking the piles to compensate makes it WORSE — less supply buys fewer
  // cottages, which is fewer workers, which is slower extraction. The two ends
  // pull against each other and the loop closes on itself.
  //
  // So the ceiling is gone, deliberately, and Jarrod's call: salvage now lasts
  // the run and a nest's cache is a bonus rather than a necessity. The floor
  // stays, because "you can strip the whole map in three days" is still a
  // failure and it is the one this reading was always best at catching.
  check(`${diff}: the map is not stripped early in the run`,
        avgDry >= DAYS * 0.45,
        `dry on day ${avgDry.toFixed(1)} of ${DAYS}` +
        (avgDry >= DAYS ? ` — it lasts the whole run, which is the shape a limited ` +
         `workforce gives you` : ''));
  // The shape that matters is the taper: a strong opening day is fine, a day
  // that strips a third of the map is not, and the last working day should be
  // visibly slower than the first as the near piles empty and the walks grow.
  check(`${diff}: no single day strips the map`,
        shares.every(f => f < 0.34),
        `biggest day took ${(Math.max(...shares) * 100).toFixed(0)}% of it`);
  check(`${diff}: income tapers as the near piles empty`,
        tapers.every(t => t < 0.75),
        `last working day was ${(Math.max(...tapers) * 100).toFixed(0)}% of the first`);
  day1.sort((a, b) => a - b);
  PER[diff] = { wave: wave1, day: day1[Math.floor(day1.length / 2)] || 1 };
  PER[diff].per = PER[diff].wave / PER[diff].day;
  console.log(`  first night ${PER[diff].wave} against ${PER[diff].day} supply on day one` +
              ` — ${PER[diff].per.toFixed(2)} of an attacker per supply`);
}

// A band around normal, because normal is the difficulty everything else is
// tuned against; a single band wide enough to hold all three would have to span
// 0.13 to 0.31 and would guard nothing. The other two are checked for their
// order instead, which is the property that actually defines them.
if (PER.normal) {
  check('normal: the first night is sized against what the first day pays',
        PER.normal.per > 0.16 && PER.normal.per < 0.30,
        `${PER.normal.wave} attackers against ${PER.normal.day} supply on day one — ` +
        `${PER.normal.per.toFixed(2)} of an attacker per supply gathered`);
}
if (PER.easy && PER.normal && PER.hard) {
  check('and the difficulties are in the order they claim',
        PER.easy.per < PER.normal.per && PER.normal.per < PER.hard.per,
        `${PER.easy.per.toFixed(2)} easy, ${PER.normal.per.toFixed(2)} normal, ` +
        `${PER.hard.per.toFixed(2)} hard — each one a heavier first night against the ` +
        `same day's work`);
}

// ---- supply is counted in fives -------------------------------------------
// Every number a player is charged or paid is a multiple of 5, so the smallest
// coin in the game is a 5 and nothing on screen asks them to think in ones.
// This is the kind of rule that holds for a week and then rots: it costs
// nothing to type 34 into a cost field, it looks fine, and the only symptom is
// a supply counter that drifts off the grid an hour into a round.
//
// It is checked at the source AND on a real map, because the two can disagree:
// a pile's contents come out of a multiply and a random jitter, so the table
// being right says nothing about what a player actually finds out there.
const grid = await page.evaluate(() => {
  __nw.start(4242);
  const S = __nw.state();
  const bad = [];
  const on5 = (label, v) => { if (Math.round(v) % 5 !== 0) bad.push(label + '=' + v); };
  for (const t in HFGAME.TYPES) {
    const T = HFGAME.TYPES[t];
    if (!T.cost) continue;
    on5(t + '.cost', T.cost);
    on5(t + '.refund', HFGAME.refundOf(t));
  }
  on5('nest.cache', HF.statsOf('nest').cache);
  on5('salvage.amt', HF.statsOf('salvage').amt);
  for (const d in HFGAME.DIFF) on5(d + '.supply', HFGAME.DIFF[d].supply);
  const piles = S.nodes.map(n => n.max);
  piles.forEach((v, i) => on5('pile' + i, v));
  // A supply field the Library steps in ones would walk a player straight off
  // the grid with the arrow keys, which is the same rot arriving by a different
  // door.
  const steps = [];
  for (const id in HF.STAT_DEFS)
    for (const f of HF.STAT_DEFS[id].fields)
      if (f.unit === 'supply' && f.step % 5 !== 0) steps.push(id + '.' + f.k);
  return { bad, steps, piles, costs: Object.keys(HFGAME.TYPES)
    .filter(t => HFGAME.TYPES[t].cost)
    .map(t => t + ' ' + HFGAME.TYPES[t].cost + '/' + HFGAME.refundOf(t)) };
});
check('every price, refund and pile is a multiple of five',
      grid.bad.length === 0,
      grid.bad.length ? grid.bad.slice(0, 6).join(', ')
        : `${grid.costs.join(', ')} — cost/refund, and ${grid.piles.length} piles ` +
          `from ${Math.min(...grid.piles)} to ${Math.max(...grid.piles)}`);
check('...and the Library cannot step one off it',
      grid.steps.length === 0,
      grid.steps.length ? grid.steps.join(', ')
        : `every supply field moves in fives`);

// ---- what the cottage is for ----------------------------------------------
// It is the one building that pays for itself, so its price is the only thing
// that decides how many hands a run ends up with. That makes "it costs more"
// and "there are fewer workers" the same claim, and the second one is the one
// worth checking: a price rise that changed nothing about the workforce would
// have been a tax rather than a limit.
const hands = await page.evaluate(() => {
  const was = HFGAME.TYPES.cottage.cost;
  function run(cost) {
    HF.setStat('cottage', 'cost', cost);
    HFGAME.syncStats();
    __nw.start(4242);
    const S = __nw.state();
    __nw.hall(0, 0);
    __nw.run(26);
    let cottages = 0;
    for (let t = 0; t < S.dayLen - 12; t += 10) {
      S.dayLeft = S.dayLen;
      S.units.filter(u => u.t === 'worker').forEach(u => {
        let best = null, bd = 1e9;
        S.nodes.forEach(n => { if (n.amt <= 1) return;
          const d = Math.hypot(n.x - u.x, n.z - u.z); if (d < bd) { bd = d; best = n; } });
        if (best) HFGAME.assignJob([u], best);
      });
      __nw.run(10);
      while (S.players[0].supply >= HFGAME.TYPES.cottage.cost * 1.4 && cottages < 8) {
        const a = cottages * 1.15, r = 5.6 + (cottages % 3) * 2.4;
        if (!__nw.place('cottage', Math.cos(a) * r, Math.sin(a) * r)) break;
        cottages++;
      }
    }
    return { cottages, workers: S.units.filter(u => u.t === 'worker').length,
             gathered: Math.round(S.gathered) };
  }
  const dear = run(HF.statDefs('cottage').fields.filter(f => f.k === 'cost')[0].def);
  const cheap = run(30);
  HF.setStat('cottage', 'cost', was);
  HFGAME.syncStats();
  return { dear, cheap, price: HF.statDefs('cottage').fields.filter(f => f.k === 'cost')[0].def };
});

check('the cottage price is what limits a workforce',
      hands.dear.workers < hands.cheap.workers && hands.dear.cottages < hands.cheap.cottages,
      `${hands.dear.workers} workers off ${hands.dear.cottages} cottages at ` +
      `${hands.price} supply, against ${hands.cheap.workers} off ${hands.cheap.cottages} ` +
      `at the old 30 — one day of the same seed. A price rise that left the workforce ` +
      `where it was would have been a tax rather than a limit`);
check('...and it is the dearest thing you can put up',
      Object.keys(HFGAME_TYPES).every(t => t === 'cottage' ||
        !HFGAME_TYPES[t].cost || HFGAME_TYPES[t].cost <= hands.price),
      `${hands.price} against ${Object.keys(HFGAME_TYPES).filter(t => HFGAME_TYPES[t].cost)
        .map(t => t + ' ' + HFGAME_TYPES[t].cost).join(', ')} — how many hands you have is ` +
      `the whole shape of a run, so it should be the most expensive decision on the bar`);

await close();
done(errors);
