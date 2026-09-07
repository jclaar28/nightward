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
// So every check here is the same shape. Move ONE multiplier, start a round,
// and read the quantity it claims to move — against a round started with the
// multiplier at 1 and nothing else changed. A lever that reads the same on both
// sides is not wired up, whatever the panel says.
//
//   node tools/pace.mjs
// ---------------------------------------------------------------------------
import { open, check, done } from './harness.mjs';

const SEED = 4242;
const { page, errors, close } = await open();

// One round, started from a known seed with one stat moved, reporting the
// handful of numbers the pacing block claims to govern. Stats are reset between
// runs rather than assumed: they persist by design, which is the whole point of
// them, and a tool that left one set would measure the previous check.
const probe = await page.evaluate(seed => {
  window.requestAnimationFrame = function () { return 0; };
  HF.setStat('fog', 'on', 0);

  const KEYS = [['pace', 'supplyK'], ['pace', 'yieldK'], ['pace', 'sendK'],
                ['pace', 'nightK'], ['nest', 'ramp']];
  function reset() {
    for (const [id, k] of KEYS) {
      const f = HF.statDefs(id).fields.filter(x => x.k === k)[0];
      HF.setStat(id, k, f.def);
    }
    HFGAME.syncStats();
  }
  function run(id, k, v) {
    reset();
    if (id) HF.setStat(id, k, v);
    HFGAME.syncStats();
    __nw.start(seed);
    const S = __nw.state();
    let salvage = 0;
    for (const n of S.nodes) salvage += n.max;
    // What the horde sends on night one and on night five. Night five is read
    // by winding S.night forward rather than by playing four nights: the ramp
    // is a function of the night number and nothing else, so playing them would
    // measure survival instead.
    const first = HFGAME.waveSize();
    S.night = 5;
    const fifth = HFGAME.waveSize();
    S.night = 1;
    const out = { supply: S.players[0].supply, salvage: Math.round(salvage),
                  first, fifth, night: Math.round(S.nightLen) };
    reset();
    return out;
  }

  const base = run(null);
  return {
    base,
    supplyUp: run('pace', 'supplyK', 2),
    yieldUp:  run('pace', 'yieldK', 2),
    sendUp:   run('pace', 'sendK', 2),
    nightUp:  run('pace', 'nightK', 2),
    rampFlat: run('nest', 'ramp', 1),
    // Left where it started, after every one of the runs above moved it. The
    // stats persist to localStorage on purpose, so a tool that did not put them
    // back would leave a machine playing a different game than it shipped.
    after: run(null)
  };
}, SEED);

const b = probe.base;

check('the pacing block starts a round on the shipped numbers',
      b.supply > 0 && b.salvage > 0 && b.first > 0 && b.night > 0,
      `${b.supply} supply, ${b.salvage} salvage on the map, ${b.first} attackers the ` +
      `first night, ${b.night}s of dark`);

check('starting supply × moves what you begin with, and nothing else',
      probe.supplyUp.supply === b.supply * 2 &&
      probe.supplyUp.salvage === b.salvage && probe.supplyUp.first === b.first,
      `${probe.supplyUp.supply} against ${b.supply}, with the same ${b.salvage} salvage ` +
      `and the same ${b.first} attackers — a lever that moved three things at once ` +
      `would be untunable, because you could never tell which one did it`);

check('salvage yield × moves the whole economy',
      Math.abs(probe.yieldUp.salvage / b.salvage - 2) < 0.01 &&
      probe.yieldUp.supply === b.supply,
      `${probe.yieldUp.salvage} against ${b.salvage} in the piles — the piles are the ` +
      `entire income, so this is the economy in one number`);

check('attackers × moves every night, not just the first',
      probe.sendUp.first === b.first * 2 &&
      Math.abs(probe.sendUp.fifth / b.fifth - 2) < 0.02,
      `night one ${probe.sendUp.first} against ${b.first} and night five ` +
      `${probe.sendUp.fifth} against ${b.fifth} — it multiplies the base the ramp ` +
      `compounds, so the whole curve moves rather than only tonight`);

check('night length × moves how long you have to hold',
      probe.nightUp.night === b.night * 2 && probe.nightUp.first === b.first,
      `${probe.nightUp.night}s against ${b.night}s of dark, with the same wave ` +
      `arriving in it`);

check('the ramp is what makes a long run harder than a short one',
      b.fifth > b.first * 1.4 && probe.rampFlat.fifth === probe.rampFlat.first,
      `night five is ${b.fifth} against night one's ${b.first} as shipped, and ` +
      `${probe.rampFlat.fifth} against ${probe.rampFlat.first} with the ramp flat — ` +
      `flat is the setting where a tenth night is the same fight as the first`);

check('the shipped curve is gentler than it was',
      b.fifth / b.first < 1.8,
      `night five is ${(b.fifth / b.first).toFixed(2)}× night one. At the old 1.20 ` +
      `it was 2.07× and a run stopped being winnable before it was over; a slower ` +
      `curve is more nights, which is what was asked for`);

check('a tool that moves these puts them back',
      probe.after.supply === b.supply && probe.after.salvage === b.salvage &&
      probe.after.first === b.first && probe.after.night === b.night,
      `every number back where it started — these persist to disk by design, so a ` +
      `run that left one set would change the game on the machine that ran it`);

await close();
done(errors);
