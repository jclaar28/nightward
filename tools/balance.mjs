// ---------------------------------------------------------------------------
// balance — play a night out, many times, and count.
//
// Every balance number lives in STAT_DEFS and can be changed at runtime with
// HF.setStat + syncStats(), which makes an honest A/B possible: same seeds,
// same script, one variable moved. Use it that way. A five-seed sample on a
// knife-edge configuration will tell you whatever you want to hear — one
// config here read 5/5 against 2/5 and came back 7/12 against 7/12 when run
// properly.
//
//   node tools/balance.mjs                          # the current ladder
//   node tools/balance.mjs --waves 400,600,850      # specific wave sizes
//   node tools/balance.mjs --build mid --seeds 12   # one build, more samples
//   node tools/balance.mjs --nights 5               # how deep a build gets
//   node tools/balance.mjs --ab tower.dmg=20        # A/B one stat against stock
// ---------------------------------------------------------------------------
import { open, done } from './harness.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const WAVES  = arg('waves', '400,600,850').split(',').map(Number);
const BUILDS = arg('build', 'mid').split(',');
const NSEEDS = +arg('seeds', 5);
const AB     = arg('ab', null);   // e.g. "tower.dmg=20" or "wall.hp=200"
const NIGHTS = +arg('nights', 1); // how many nights to play out per run

const SEEDS = [31337, 5150, 90210, 4242, 8888, 1234, 777, 2468, 13579, 60606, 42, 999]
  .slice(0, Math.max(1, Math.min(12, NSEEDS)));

// The whole run, inside the page. It plays a full day — gather, cottages,
// defence — then holds a night, and reports what happened.
function playRound({ seed, wave, build, stat, nights }) {
  nights = nights || 1;
  const G = window.__hf.game;
  // A/B switch: apply an override, or explicitly restore the shipped default,
  // so both columns of a comparison run through identical code.
  if (stat) {
    const def = HF.statDefs(stat.id).fields.filter(f => f.k === stat.key)[0].def;
    HF.setStat(stat.id, stat.key, stat.on ? stat.value : def);
    G.syncStats();
  }
  __nw.start(seed);
  const S = __nw.state();
  S.wave = wave;
  S.players[0].supply = 40;

  __nw.hall(0, 0);
  __nw.run(18);
  if (!S.players[0].hall) return { seed, wave, build, error: 'hall never went up' };

  // put every worker on the nearest pile that still has something in it
  const assign = () => {
    S.units.filter(u => u.t === 'worker').forEach(u => {
      let best = null, bd = 1e9;
      S.nodes.forEach(n => {
        if (n.amt <= 1) return;
        const d = Math.hypot(n.x - u.x, n.z - u.z);
        if (d < bd) { bd = d; best = n; }
      });
      if (best) G.assignJob([u], best);
    });
  };
  assign();

  // spend the day on cottages so the workforce compounds
  let cottages = 0;
  for (let t = 0; t < 320; t += 15) {
    __nw.run(15);
    while (S.players[0].supply >= 40 && cottages < 5) {
      const a = cottages / 5 * 6.283;
      if (!__nw.place('cottage', Math.cos(a) * 4.5, Math.sin(a) * 4.5)) break;
      cottages++;
    }
    assign();
  }
  const gathered = Math.round(S.gathered), purse = S.players[0].supply;

  // spend it on a defence
  const spent = { tower: 0, ballista: 0, wall: 0, gate: 0, barracks: 0 };
  const ring = (type, rad, count) => {
    for (let i = 0; i < count; i++) {
      const a = i / count * 6.283;
      if (__nw.place(type, Math.cos(a) * rad, Math.sin(a) * rad)) spent[type]++;
    }
  };
  if (build === 'strong') {
    ring('barracks', 3.0, 2); ring('tower', 6.5, 10); ring('ballista', 5.0, 3);
    ring('tower', 8.0, 10);
    for (let r = 0; r < 2; r++) ring('wall', 9.6 + r * 1.5, 44);
  } else if (build === 'gated') {
    // the build the game's own hints describe: a sealed ring with two gates,
    // and the guns stacked on the ground those gates pull attackers onto
    const GA = [0, Math.PI];
    for (let i = 0; i < 40; i++) {
      const a = i / 40 * 6.283;
      const near = GA.some(g => Math.abs(((a - g + Math.PI) % 6.283) - Math.PI) < 0.16);
      if (__nw.place(near ? 'gate' : 'wall', Math.cos(a) * 9.6, Math.sin(a) * 9.6))
        spent[near ? 'gate' : 'wall']++;
    }
    GA.forEach(g => {
      for (let k = 0; k < 6; k++) {
        const rr = 5.2 + (k % 3) * 1.4, off = k < 3 ? -0.30 : 0.30;
        if (__nw.place('tower', Math.cos(g + off) * rr, Math.sin(g + off) * rr)) spent.tower++;
      }
      if (__nw.place('ballista', Math.cos(g) * 3.4, Math.sin(g) * 3.4)) spent.ballista++;
    });
    ring('barracks', 2.2, 2);
  } else if (build === 'mid') {
    ring('wall', 9.6, 40); ring('tower', 6.8, 8); ring('ballista', 5.0, 1);
    ring('barracks', 3.0, 1); ring('tower', 8.2, 6);
  } else {                       // 'thin' — a distracted player
    for (let r = 0; r < 2; r++) ring('wall', 9.6 + r * 1.5, 44);
    ring('tower', 7.0, 5); ring('barracks', 3.0, 1);
  }

  // Buildings are construction sites now, so give the defence the few seconds
  // of daylight a real player's last placements get. Without this the harness
  // measures a wave hitting bare foundations, which is not the game.
  __nw.run(10);
  const unfinished = __nw.roots().filter(b => b.site).length;

  // Holding a night no longer ends the round, so the measure is how many of
  // them a build survives before the accelerating waves take it.
  let peak = 0, held = 0, firstWave = S.wave;
  for (let night = 0; night < nights; night++) {
    G.startWave();
    for (let n = 0; n < 200 && S.phase === 'attack'; n++) {
      __nw.run(1);
      peak = Math.max(peak, S.enemies.length);
    }
    if (S.phase !== 'build') break;      // lost, or the nests are gone
    held++;
    __nw.run(Math.max(1, S.dayLen - 2)); // spend the day doing nothing but repair
  }
  return {
    seed, wave: firstWave, build, gathered, purse, cottages, unfinished,
    result: S.phase, held, lastWave: S.wave, kills: S.kills, peak,
    hall: S.players[0].hall ? Math.round(100 * S.players[0].hall.hp / G.TYPES.hall.hp) : 0,
    spent,
  };
}

const { page, errors, close } = await open();
await page.evaluate(`window.__play = ${playRound.toString()}`);

let stat = null;
if (AB) {
  const m = /^([a-z]+)\.([a-zA-Z]+)=(-?[\d.]+)$/.exec(AB);
  if (!m) { console.error(`--ab wants id.key=value, e.g. tower.dmg=20`); process.exit(2); }
  stat = { id: m[1], key: m[2], value: +m[3] };
}

console.log(stat ? `A/B: ${stat.id}.${stat.key} — stock vs ${stat.value}\n` : '');
const tally = {};
for (const wave of WAVES) {
  for (const build of BUILDS) {
    for (const seed of SEEDS) {
      const runs = stat ? [false, true] : [null];
      const out = [];
      for (const on of runs) {
        const r = await page.evaluate(a => window.__play(a),
          { seed, wave, build, nights: NIGHTS, stat: stat ? { ...stat, on } : null });
        if (r.error) { console.log(`wave ${wave} ${build} seed ${seed}: ${r.error}`); continue; }
        const key = `${wave}|${build}|${on === true ? 'B' : 'A'}`;
        tally[key] = tally[key] || { held: 0, nights: 0, n: 0 };
        tally[key].n++;
        tally[key].nights += r.held;
        if (r.held >= NIGHTS || r.result === 'won') tally[key].held++;
        out.push(r);
      }
      const line = out.map(r =>
        `${r.held}/${NIGHTS} nights  ${r.result === 'lost' ? 'FELL' : 'held'}` +
        ` hall ${String(r.hall).padStart(3)}`).join('  |  ');
      const first = out[0] || {};
      console.log(`wave ${String(wave).padStart(4)}  ${build.padEnd(6)} seed ${String(seed).padEnd(6)}` +
                  `  ${line}   kills ${String(first.kills || 0).padStart(4)}` +
                  `  peak ${String(first.peak || 0).padStart(3)}` +
                  `  unfinished@dusk ${first.unfinished}`);
    }
  }
}

console.log('\n--- held / played ---');
for (const k of Object.keys(tally).sort()) {
  const [wave, build, col] = k.split('|');
  const t = tally[k];
  const label = stat ? (col === 'A' ? 'stock' : `${stat.key}=${stat.value}`) : '';
  console.log(`wave ${wave.padStart(4)}  ${build.padEnd(6)} ${label.padEnd(14)} ` +
              `${t.held}/${t.n} runs full distance   ` +
              `${(t.nights / t.n).toFixed(1)} nights held on average`);
}

await close();
done(errors);
