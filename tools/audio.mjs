// ---------------------------------------------------------------------------
// audio — render every sound offline and measure it.
//
// "It did not throw" is not a test for a sound. A sound has a level, a length,
// a brightness and a stereo position, and every one of those is a number you
// can be wrong about. HFSND.render() builds the whole mixer into an
// OfflineAudioContext and hands back the samples, so all of them can be
// checked without anyone listening.
//
//   node tools/audio.mjs            # check every sound
//   node tools/audio.mjs --report   # ...and print the measurements
// ---------------------------------------------------------------------------
import { open, check, done } from './harness.mjs';

const REPORT = process.argv.includes('--report');
const { page, errors, close } = await open();

// Measurements computed in the page, from the rendered samples.
const MEASURE = `
window.__m = function (buf) {
  const L = buf.L, R = buf.R, sr = buf.sampleRate, n = L.length;
  let peak = 0, sum = 0, eL = 0, eR = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const l = L[i], r = R[i], m = (l + r) / 2, a = Math.abs(m);
    if (a > peak) peak = a;
    sum += m * m; eL += l * l; eR += r * r;
  }
  // Where it stops, relative to its own peak. An absolute threshold made a
  // quiet distant sound look shorter than the loud near one it came from, and
  // every per-second figure derived from it was then wrong by the same factor.
  const end = Math.max(1e-6, peak * 0.02);
  for (let i = 0; i < n; i++) {
    if (Math.abs((L[i] + R[i]) / 2) > end) last = i;
  }
  const rms = Math.sqrt(sum / n);
  const act = Math.max(1, last);
  // Brightness: zero crossings, but only inside the part that is actually
  // sounding and only above a floor. Counting them across the whole buffer
  // measured the noise under a decayed tail, which made a quiet distant sound
  // read as brighter than the loud near one it came from.
  let zc = 0, prev = 0, floor = peak * 0.03;
  for (let i = 0; i <= act; i++) {
    const m = (L[i] + R[i]) / 2;
    if (Math.abs(m) < floor) continue;
    if ((m > 0) !== (prev > 0)) zc++;
    prev = m;
  }
  // Weight: how much of the energy is under ~180 Hz. This is what "heavy"
  // means, and unlike a crossing rate it is not fooled by a bright tail.
  let lp = 0, lo = 0, all = 0;
  const alpha = 1 - Math.exp(-2 * Math.PI * 180 / sr);
  for (let i = 0; i <= act; i++) {
    const m = (L[i] + R[i]) / 2;
    lp += (m - lp) * alpha;
    lo += lp * lp; all += m * m;
  }
  return {
    peak: +peak.toFixed(4),
    rms: +rms.toFixed(5),
    seconds: +(act / sr).toFixed(3),
    bright: Math.round(zc / (act / sr)),
    weight: +(lo / (all + 1e-12)).toFixed(3),
    balance: +((eR - eL) / (eR + eL + 1e-12)).toFixed(3),
  };
};
window.__render = function (name, args, secs) {
  return HFSND.render(name, args, secs).then(b => b ? window.__m(b) : null);
};`;
await page.evaluate(MEASURE);
await page.evaluate(() => { HFSND.setVolume(1); });

// name, args, render seconds, and what it should be
const SOUNDS = [
  ['place',    [4, 2],            0.8],
  ['built',    [4, 2],            1.0],
  ['remove',   [4, 2],            1.2],
  ['shot',     ['tower', 4, 2],   0.8],
  ['shot',     ['ballista', 4, 2],1.2],
  ['loose',    [4, 2],            0.7],
  ['impact',   [false, 4, 2],     0.7, 'impact:light'],
  ['impact',   [true, 4, 2],      1.6, 'impact:heavy'],
  ['chew',     [4, 2],            0.8],
  ['hallHit',  [4, 2],            1.6],
  ['swing',    [4, 2],            0.7],
  ['death',    ['shambler', 4, 2],0.9],
  ['death',    ['brute', 4, 2],   1.4],
  ['unitDown', [4, 2],            1.0],
  ['gather',   [4, 2],            0.8],
  ['deposit',  [4, 2],            0.9],
  ['muster',   [4, 2],            1.0],
  ['order',    [],                0.7],
  ['waveStart',[],                3.0],
  ['dawn',     [],                2.2],
  ['win',      [],                3.2],
  ['lose',     [],                3.4],
];

const rows = [];
for (const [name, args, secs, label] of SOUNDS) {
  const m = await page.evaluate(a => window.__render(a.n, a.a, a.s),
                                { n: name, a: args, s: secs });
  rows.push({ name: label || name + (typeof args[0] === 'string' ? ':' + args[0] : ''), m, secs });
}

if (REPORT) {
  console.log('sound          peak     rms      length  bright   weight');
  for (const r of rows) {
    if (!r.m) { console.log(`${r.name.padEnd(14)} (no render)`); continue; }
    console.log(`${r.name.padEnd(14)} ${String(r.m.peak).padEnd(8)} ${String(r.m.rms).padEnd(8)}` +
                ` ${String(r.m.seconds).padEnd(7)} ${String(r.m.bright).padEnd(8)} ${r.m.weight}`);
  }
  console.log('');
}

check('every sound renders', rows.every(r => r.m), rows.filter(r => !r.m).map(r => r.name).join(', ') || 'all');
check('none is silent', rows.every(r => r.m && r.m.peak > 0.01),
      rows.filter(r => r.m && r.m.peak <= 0.01).map(r => r.name).join(', ') || 'quietest ' +
      Math.min(...rows.filter(r => r.m).map(r => r.m.peak)).toFixed(3));
check('none clips', rows.every(r => r.m && r.m.peak < 0.98),
      rows.filter(r => r.m && r.m.peak >= 0.999).map(r => r.name).join(', ') || 'loudest ' +
      Math.max(...rows.filter(r => r.m).map(r => r.m.peak)).toFixed(3));
// A tail should be proportionate to the event. A hammer tap that rings for a
// second is a reverb problem, not a hammer.
const SHORT = ['place','built','remove','shot:tower','loose','impact:light','chew',
               'swing','gather','deposit','order'];
const longTails = rows.filter(r => r.m && SHORT.indexOf(r.name) >= 0 && r.m.seconds > 0.75);
check('small sounds do not ring', longTails.length === 0,
      longTails.map(r => `${r.name} ${r.m.seconds}s`).join(', ') ||
      'longest ' + Math.max(...rows.filter(r => r.m && SHORT.indexOf(r.name) >= 0)
        .map(r => r.m.seconds)).toFixed(2) + 's');
check('nothing is cut off by its own window', rows.every(r => r.m && r.m.seconds < r.secs * 0.99),
      rows.filter(r => r.m && r.m.seconds >= r.secs * 0.99).map(r => r.name).join(', ') || 'all decay');

// The mix has to have a shape: chatter under events under moments.
const lvl = n => rows.find(r => r.name === n).m.peak;
// By category, not by pairs. Every sound here is randomised, so two individual
// renders of similarly-sized events can land either way round — an ordering
// between a tower shot and a light impact is a coin toss, and asserting it made
// this check fail on a run where nothing had changed.
const CHATTER = ['shot:tower','loose','impact:light','swing','chew','gather','deposit','order'];
const BIG     = ['impact:heavy','hallHit','waveStart','lose'];
const loudestChatter = Math.max(...CHATTER.map(lvl));
const quietestBig    = Math.min(...BIG.map(lvl));
check('combat chatter sits under the big moments',
      loudestChatter < quietestBig * 0.75,
      `loudest chatter ${loudestChatter.toFixed(3)}, quietest big moment ${quietestBig.toFixed(3)}`);
check('nothing is so quiet it may as well not fire',
      rows.every(r => r.m.peak > 0.05),
      'quietest ' + Math.min(...rows.map(r => r.m.peak)).toFixed(3));

// ---- the character checks: what "not digital" actually means --------------
// Heavy things are dark, small things are bright. A synth pass that got this
// backwards would still "play a sound" for every event.
const heavy = rows[7].m, light = rows[6].m;      // impact(true) vs impact(false)
// An absolute margin, not a ratio: the light impact's body is randomised
// either side of the 180 Hz measurement line, so its weight swings 0.33-0.43
// and a x2 test sat right on the edge of that swing.
check('a heavy impact carries more weight than a light one',
      heavy.weight > 0.7 && heavy.weight - light.weight > 0.25,
      `${heavy.weight} vs ${light.weight} of the energy under 180 Hz`);
const brute = rows[12].m, sham = rows[11].m;
check('a brute dies heavier and longer than a shambler',
      brute.weight > sham.weight && brute.seconds > sham.seconds,
      `brute ${brute.weight}/${brute.seconds}s, shambler ${sham.weight}/${sham.seconds}s`);
const ballista = rows[4].m, tower = rows[3].m, by3 = tower;
check('a ballista is heavier than a tower shot',
      ballista.weight > tower.weight && ballista.rms > tower.rms,
      `ballista weight ${ballista.weight}, tower ${tower.weight}`);

// ---- variation: the loudest tell of synthetic audio ------------------------
const varied = await page.evaluate(async () => {
  const out = [];
  for (const [name, args] of [['shot', ['tower', 4, 2]], ['death', ['shambler', 4, 2]],
                              ['impact', [false, 4, 2]], ['swing', [4, 2]]]) {
    const a = await HFSND.render(name, args, 0.7);
    const b = await HFSND.render(name, args, 0.7);
    if (!a || !b) { out.push({ name, same: true }); continue; }
    let diff = 0, n = Math.min(a.L.length, b.L.length);
    for (let i = 0; i < n; i++) diff += Math.abs(a.L[i] - b.L[i]);
    out.push({ name, diff: +(diff / n).toFixed(6) });
  }
  return out;
});
check('no sound repeats itself exactly', varied.every(v => v.diff > 1e-5),
      varied.map(v => `${v.name} ${v.diff}`).join(', '));

// ---- placement: pan, level and air ----------------------------------------
const spatial = await page.evaluate(async () => {
  const at = async (x, z) => {
    HFSND.listen(0, 0, 1, 0, 17);           // camera at origin, right = +x
    const b = await HFSND.render('shot', ['tower', x, z], 0.8);
    return b ? window.__m(b) : null;
  };
  return { left: await at(-22, 0), right: await at(22, 0),
           near: await at(2, 0), far: await at(70, 0) };
});
check('a sound on the right lands on the right', spatial.right.balance > 0.25,
      `balance ${spatial.right.balance}`);
check('a sound on the left lands on the left', spatial.left.balance < -0.25,
      `balance ${spatial.left.balance}`);
check('distance makes it quieter', spatial.far.rms < spatial.near.rms * 0.5,
      `near ${spatial.near.rms}, far ${spatial.far.rms}`);
check('distance makes it duller', spatial.far.bright < spatial.near.bright * 0.8,
      `near ${spatial.near.bright}, far ${spatial.far.bright} crossings/s` +
      ` (weight ${spatial.near.weight} → ${spatial.far.weight})`);

// ---- the limiter: a wave should thicken, not clip --------------------------
const wall = await page.evaluate(async () => {
  HFSND.listen(0, 0, 1, 0, 17);
  // A night, compressed into one render: twenty guns, a dozen deaths, splash.
  const calls = [];
  for (let i = 0; i < 20; i++) calls.push(['shot', ['tower', (i % 7) - 3, i % 5]]);
  for (let i = 0; i < 12; i++) calls.push(['death', ['shambler', i - 6, 2]]);
  for (let i = 0; i < 6; i++) calls.push(['impact', [true, i - 3, 1]]);
  for (let i = 0; i < 10; i++) calls.push(['swing', [i - 5, 3]]);
  const b = await HFSND.render(calls, null, 1.6);
  return b ? window.__m(b) : null;
});
check('a night-sized volley stays under the ceiling', !!wall && wall.peak < 0.98,
      wall ? `peak ${wall.peak}, rms ${wall.rms}` : 'no render');
check('...and is still louder than one shot', !!wall && wall.rms > by3.rms * 1.5,
      wall ? `volley rms ${wall.rms} vs one shot ${by3.rms}` : '');

// ---- the bed --------------------------------------------------------------
// The wind layer was pulled, so day is deliberately open: the only continuous
// bed left is the night drone. These checks say exactly that, because "the day
// bed makes sound" used to pass on the wind and would now be asserting that a
// thing we removed is still there.
const bed = await page.evaluate(async () => {
  const day = await HFSND.render([['ambience', ['build', 0]]], null, 2.5);
  const night = await HFSND.render([['ambience', ['attack', 1]]], null, 2.5);
  const over = await HFSND.render([['ambience', ['lost', 1]]], null, 2.5);
  return { day: day && window.__m(day), night: night && window.__m(night),
           over: over && window.__m(over) };
});
check('the night bed makes sound', !!bed.night && bed.night.rms > 0.0002,
      bed.night ? `rms ${bed.night.rms}` : 'no render');
check('day is open — no bed under the build phase', !!bed.day && bed.day.rms < 0.0002,
      bed.day ? `rms ${bed.day.rms}` : 'no render');
check('the night bed is heavier than day', !!bed.night && bed.night.weight > bed.day.weight,
      bed.night ? `night ${bed.night.weight} vs day ${bed.day.weight} under 180 Hz` : '');
check('the bed sits under everything, not over it',
      !!bed.night && bed.night.rms < rows.find(r => r.name === 'shot:tower').m.rms,
      bed.night ? `bed ${bed.night.rms} vs a tower shot ${rows.find(r => r.name === 'shot:tower').m.rms}` : '');
check('the bed stops when the round does', !!bed.over && bed.over.rms < 0.0002,
      bed.over ? `rms ${bed.over.rms}` : 'no render');

await close();
done(errors);
