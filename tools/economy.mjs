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
      while (S.players[0].supply >= 120 && cottages < 8) {
        const a = cottages * 1.1, r = 5.0 + (cottages % 3) * 1.6;
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
              ` (target: about two-thirds of a ${DAYS}-night game, so ~${Math.round(DAYS * 0.67)})`);
  check(`${diff}: the map lasts most of the game but not all of it`,
        avgDry >= DAYS * 0.45 && avgDry <= DAYS * 0.95,
        `dry on day ${avgDry.toFixed(1)} of ${DAYS}`);
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

await close();
done(errors);
