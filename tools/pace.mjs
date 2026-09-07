// ---------------------------------------------------------------------------
// pace — the knobs that decide how fast a round runs.
//
// These exist because the pacing of this game is a feel question, and the only
// honest way to answer a feel question is to play a round, move one number, and
// play another. That makes them a different kind of thing from the rest of the
// balance table: a slider nobody can reach is not a tuning surface, and a
// slider that moves nothing is worse than none at all, because it costs a
// playtest to find out.
//
// So every check here is the same shape. Move ONE knob, start a round, and read
// the quantity it claims to move — against a round started with everything at
// its shipped value and nothing else touched. A lever that reads the same on
// both sides is not wired up, whatever the panel says.
//
// They were multipliers once, over whatever the difficulty said. Two of the
// checks below only exist because of what replaced them: a knob that is stated
// as an absolute has to still let the difficulty decide when it is left alone,
// and a knob the panel shows in one unit and the table stores in another has to
// round-trip.
//
//   node tools/pace.mjs
// ---------------------------------------------------------------------------
import { open, check, done } from './harness.mjs';

const SEED = 4242;
const { page, errors, close } = await open();

const probe = await page.evaluate(seed => {
  window.requestAnimationFrame = function () { return 0; };
  HF.setStat('fog', 'on', 0);

  const KEYS = [['pace', 'supply'], ['pace', 'first'], ['pace', 'dayMin'],
                ['pace', 'nightMin'], ['nest', 'ramp'],
                ['salvage', 'amt'], ['salvage', 'nearK'],
                ['worker', 'gather'], ['worker', 'carry']];
  const def = (id, k) => HF.statDefs(id).fields.filter(x => x.k === k)[0].def;
  function reset() {
    for (const [id, k] of KEYS) HF.setStat(id, k, def(id, k));
    HFGAME.syncStats();
  }
  // One round, with one stat moved, reporting everything the panel claims to
  // govern. Stats are reset before AND after: they persist by design, which is
  // the whole point of them, and a run that left one set would measure the
  // previous check.
  function run(id, k, v) {
    reset();
    if (id) HF.setStat(id, k, v);
    HFGAME.syncStats();
    __nw.start(seed);
    const S = __nw.state();
    let salvage = 0, biggest = 0, smallest = Infinity;
    for (const n of S.nodes) {
      salvage += n.max;
      biggest = Math.max(biggest, n.max);
      smallest = Math.min(smallest, n.max);
    }
    // What the horde sends on night one and night five. Night five is read by
    // winding S.night forward rather than by playing four nights: the growth is
    // a function of the night number and nothing else, so playing them would
    // measure survival instead, which is balance.mjs's question.
    const first = HFGAME.waveSize();
    S.night = 5;
    const fifth = HFGAME.waveSize();
    S.night = 1;
    const W = HF.statsOf('worker');
    const out = { supply: S.players[0].supply, salvage: Math.round(salvage),
                  biggest: Math.round(biggest), smallest: Math.round(smallest),
                  first, fifth, nests: S.nests.length,
                  day: Math.round(S.dayLen), night: Math.round(S.nightLen),
                  gather: +W.gather.toFixed(3), carry: W.carry };
    reset();
    return out;
  }

  // What the panel shows against what the table stores, for the two knobs whose
  // units differ. Read straight off the rendered inputs, because the conversion
  // living in the panel is exactly the thing that can be wrong.
  function panel() {
    __hf.show('setup');
    const head = document.getElementById('paceHead');
    if (document.getElementById('paceBody').hidden) head.click();
    const out = {};
    document.querySelectorAll('#paceBody [data-pk]').forEach(inp => {
      out[inp.dataset.pid + '.' + inp.dataset.pk] = parseFloat(inp.value);
    });
    return out;
  }

  const base = run(null);
  const shown = panel();
  const D = HFGAME.DIFF.normal;
  const res = {
    base, shown,
    pileUp:   run('salvage', 'amt', def('salvage', 'amt') * 2),
    gatherUp: run('worker', 'gather', def('worker', 'gather') * 2),
    carryUp:  run('worker', 'carry', 12),
    supplySet: run('pace', 'supply', 500),
    firstSet: run('pace', 'first', 600),
    growthUp: run('nest', 'ramp', 1.5),
    dayUp:    run('pace', 'dayMin', 12),
    nightUp:  run('pace', 'nightMin', 5),
    after:    run(null)
  };
  __hf.show('menu');
  res.diff = { supply: D.supply, send: D.send, nests: D.nests };
  return res;
}, SEED);

const b = probe.base;

check('the panel starts a round on the shipped numbers',
      b.supply > 0 && b.salvage > 0 && b.first > 0 && b.day > 0 && b.night > 0,
      `${b.supply} supply, ${b.salvage} in piles, ${b.first} attackers the first ` +
      `night, ${b.day}s of day and ${b.night}s of dark`);

// ---- the economy -----------------------------------------------------------
check('supply per pile is the biggest pile on the map, not the smallest',
      Math.abs(b.biggest / (b.smallest / 0.48) - 1) < 0.35 &&
      b.biggest > b.smallest * 1.6,
      `the richest pile holds ${b.biggest} and the poorest ${b.smallest}. The number ` +
      `used to be the INSIDE pile's yield with the outside ones a multiple of it, so ` +
      `"how much is in a pile" answered for the two you can reach safely rather than ` +
      `for the five sevenths of the map's supply that is worth walking to`);
check('...and moving it moves every pile',
      Math.abs(probe.pileUp.salvage / b.salvage - 2) < 0.02 &&
      Math.abs(probe.pileUp.biggest / b.biggest - 2) < 0.02 &&
      Math.abs(probe.pileUp.smallest / b.smallest - 2) < 0.02,
      `${probe.pileUp.salvage} on the map against ${b.salvage}, with the inside piles ` +
      `keeping their share — the piles are the entire income, so this is the economy ` +
      `in one number`);

check('gather rate moves how fast a pile empties, and nothing about how much is in it',
      Math.abs(probe.gatherUp.gather / b.gather - 2) < 0.01 &&
      probe.gatherUp.salvage === b.salvage,
      `${probe.gatherUp.gather}/s against ${b.gather}/s, with the same ${b.salvage} ` +
      `still out there to carry`);
check('worker carry moves the load, not the rate',
      probe.carryUp.carry === 12 && probe.carryUp.gather === b.gather,
      `${probe.carryUp.carry} a trip against ${b.carry}, at the same ${b.gather}/s. ` +
      `Carry is the stronger of the two in practice: the walk home is most of a ` +
      `worker's day, and a bigger load removes walks rather than shortening them`);

// ---- the attackers ---------------------------------------------------------
check('starting attackers is the whole of night one, across every nest',
      probe.firstSet.first === 600,
      `set to 600 and night one is ${probe.firstSet.first} across ${b.nests} nests. ` +
      `It is stored per nest, because that is what the growth and the spite term act ` +
      `on — but "600 attackers" is a thing you have an opinion about and "120 each, ` +
      `and there are five" is arithmetic you should not have to do`);
check('...and growth compounds from it rather than adding a flat number',
      Math.abs(b.fifth / b.first - Math.pow(1.13, 4)) < 0.02 &&
      Math.abs(probe.growthUp.fifth / probe.growthUp.first - Math.pow(1.5, 4)) < 0.02,
      `at 13% night five is ${b.fifth} against night one's ${b.first}, and at 50% it is ` +
      `${probe.growthUp.fifth} against ${probe.growthUp.first} — each night is a ` +
      `percentage of the night before, so the gap widens as the run goes on`);

// ---- the clock -------------------------------------------------------------
check('day length is stated in minutes and the round runs in seconds',
      probe.dayUp.day === 720 && probe.dayUp.night === b.night,
      `12 minutes on the panel is ${probe.dayUp.day}s of build phase, with the night ` +
      `left where it was`);
check('night length likewise',
      probe.nightUp.night === 300 && probe.nightUp.day === b.day,
      `5 minutes is ${probe.nightUp.night}s of dark, with the day left where it was`);

// ---- zero means "whatever the difficulty says" ------------------------------
// The knobs that replaced multipliers have to keep easy/normal/hard meaning
// something when they are left alone, or stating them as absolutes has quietly
// taken the difficulty out of the game.
check('a starting figure left alone still comes from the difficulty',
      b.supply === probe.diff.supply && b.first === probe.diff.send * probe.diff.nests,
      `${b.supply} supply and ${b.first} attackers on normal, which is the difficulty's ` +
      `${probe.diff.supply} and ${probe.diff.nests}x${probe.diff.send} — zero on the panel means ` +
      `defer, and the box shows what it resolved to rather than a blank`);
check('...and a figure you state overrides it',
      probe.supplySet.supply === 500 && probe.supplySet.first === b.first,
      `${probe.supplySet.supply} supply, with night one still at ${probe.supplySet.first}`);

// ---- what the panel shows is what the table stores --------------------------
check('the two percentage knobs round-trip through the panel',
      probe.shown['worker.gather'] === 100 && probe.shown['nest.ramp'] === 13,
      `the panel reads ${probe.shown['worker.gather']}% gather and ` +
      `${probe.shown['nest.ramp']}% growth for a table holding ${b.gather}/s and 1.13. ` +
      `A rate of 2.4 is only judgeable against the one it shipped at, and 1.13 is a ` +
      `number you have to subtract one from before it means anything — so the panel ` +
      `converts and the table keeps its own units`);
check('...and a deferring field shows what it resolved to, not a zero',
      probe.shown['pace.first'] === b.first && probe.shown['pace.supply'] === b.supply,
      `${probe.shown['pace.first']} attackers and ${probe.shown['pace.supply']} supply ` +
      `in the boxes — a blank beside the words "starting attackers" is not an answer`);

check('a tool that moves these puts them back',
      probe.after.supply === b.supply && probe.after.salvage === b.salvage &&
      probe.after.first === b.first && probe.after.day === b.day &&
      probe.after.night === b.night && probe.after.gather === b.gather,
      `every number back where it started — these persist to disk by design, so a ` +
      `run that left one set would change the game on the machine that ran it`);

await close();
done(errors);
