// ---------------------------------------------------------------------------
// combat — whether a fight happens where the fight is.
//
// Nearly every effect in the game was spawned at `PLAT`, the plateau constant,
// rather than at the ground under it: the sparks off a blow, the flash off an
// impact, a tower's muzzle, the height a bolt flies at, and the height a corpse
// stops falling. On the plateau, where the settlement sits and where most of a
// night is fought, that is exactly right and invisible. March out to a nest and
// it is not: the ground out there rolls by several units, so sparks went off
// underground, corpses came to rest buried or hovering, and an arrow aimed at a
// fixed chest height landed in the dirt in front of anything standing uphill.
//
// This drives a real fight away from the flat and measures every effect against
// the terrain beneath it. `tools/instances.mjs` makes the same kind of claim
// about things that are drawn; this one is about things that are spawned, which
// no draw-time check can see because by then the number is already wrong.
//
// One gap, stated rather than papered over: of the seventeen call sites moved
// onto the ground, sixteen are exercised here. The seventeenth is the spark off
// a blow landed by one of YOUR melee units, and no arrangement tried would make
// it fire — a pinned bait is being hit rather than hitting, and soldiers moved
// next to a nest by hand never engage its garrison. Breaking that line alone
// leaves every check below green. It is the mirror of `strikeFx`, which is
// covered, so the mechanism is measured even where that one line is not.
//
//   node tools/combat.mjs
// ---------------------------------------------------------------------------
import { open, check, done } from './harness.mjs';

const { page, errors, close } = await open();

const m = await page.evaluate(() => {
  window.requestAnimationFrame = function () { return 0; };
  HF.setStat('fog', 'on', 0);
  __nw.start(7);
  const S = __nw.state();
  S.players[0].supply = 999999;
  __nw.hall(0, 0);
  __nw.run(24);
  // Soldiers, because the bait alone does not swing. A pinned unit is being
  // hit, not hitting, so a fight staged around it exercises the attacker's
  // blows and never the player's — and the one call site that spawns the
  // player's own melee sparks went unmeasured until soldiers were marched out
  // to stand in it.
  __nw.place('barracks', -6, 2);
  __nw.run(150);

  // Pick the nest whose ground sits furthest from the plateau. That choice is
  // the whole test: run this on the flat and the old code passes it.
  let nest = null, relief = 0;
  for (const n of S.nests) {
    const r = Math.abs(__nw.ground(n.x, n.z) - HF.PLAT);
    if (r > relief) { relief = r; nest = n; }
  }
  if (!nest) return { none: true };

  // Bait, held on the nest's inward side inside the guards' leash and kept
  // alive, exactly as tools/campaign.mjs does it — a nest sits near the rim and
  // bait placed outward ends up off the map, where the off-map rule reels
  // everything back toward the middle. A tower goes up beside it so a bolt path
  // is measured too.
  const leash = HF.statsOf('nest').leash;
  const L = Math.hypot(nest.x, nest.z) || 1;
  const bx = nest.x - (nest.x / L) * leash * 0.55;
  const bz = nest.z - (nest.z / L) * leash * 0.55;
  const bait = S.units[0];
  nest.hp = nest.max = 1e9;
  const troops = S.units.filter(u => u.t === 'soldier').slice(0, 6);
  troops.forEach((u, i) => {
    u.inside = false;
    u.x = u.px = bx + 1.0 + (i % 3) * 0.8;
    u.z = u.pz = bz + 1.0 + Math.floor(i / 3) * 0.8;
  });

  // Sample as it runs: effects live for a fraction of a second, so one frame
  // catches almost nothing. Only just-born particles count — a spark flies and
  // falls, and where it ends up says nothing about where it was made.
  const young = [];
  for (let i = 0; i < 30 * 25; i++) {
    bait.x = bait.px = bx; bait.z = bait.pz = bz; bait.hp = bait.max = 1e9;
    bait.inside = false;
    troops.forEach(u => { u.hp = u.max = 1e9; u.inside = false; });
    HFGAME.update(1 / 30);
    for (const p of S.parts) {
      const g = (p.gnd === undefined) ? __nw.ground(p.x, p.z) : p.gnd;
      if (p.life > p.max * 0.82) young.push({ over: p.y - g, ground: g - HF.PLAT });
    }
  }
  const offFlat = young.length
    ? young.map(y => Math.abs(y.ground)).sort((a, b) => a - b)[Math.floor(young.length / 2)] : 0;
  const under = young.filter(y => y.over < -0.05).length;
  const worstUnder = young.reduce((w, y) => Math.min(w, y.over), 0);
  // Whether the ground here is above or below the plateau decides which way a
  // PLAT-anchored effect goes wrong, and only one of the two directions is
  // "underneath". This nest sits below it, so the first version of this tool
  // watched melee sparks go off nearly four units over everyone's heads and
  // called it fine. Height above the ground has to be bounded both ways.
  const over = young.map(y => y.over).sort((a, b) => a - b);
  const medOver = +over[Math.floor(over.length / 2)].toFixed(2);
  const p99 = +over[Math.floor(over.length * 0.99)].toFixed(2);
  const high = young.filter(y => y.over > 2.2).length;
  const sign = +(young.length ? young[0].ground : 0).toFixed(2);

  // ---- a body lands on the ground it fell on -------------------------------
  // Driven directly rather than waited for. A nest guard takes a long time to
  // die to one commander, and what is under test is four lines of the corpse
  // step, not how long a fight lasts.
  const cx = bx + 1.5, cz = bz + 1.5, cg = __nw.ground(cx, cz);
  S.corpses.push({ x: cx, z: cz, rot: 0, sc: 1, life: 8.5, max: 8.5,
                   vx: 0.4, vz: 0.2, y: cg + 2.4, gnd: cg, vy: 1.2,
                   spin: 3, tum: 0, down: false });
  const body = S.corpses[S.corpses.length - 1];
  for (let i = 0; i < 30 * 4; i++) HFGAME.update(1 / 30);
  const rest = body.down ? +(body.y - __nw.ground(body.x, body.z)).toFixed(3) : null;

  // ---- a bolt flies at the chest of what it is aimed at ---------------------
  // A night wave, because that is when towers shoot: the towers stand on the
  // flat plateau and the attackers walking in to them do not, which is the
  // whole point — the target's ground is what decides the height, not the
  // shooter's and not the plateau's.
  __nw.start(7);
  const S2 = __nw.state();
  S2.players[0].supply = 999999;
  __nw.hall(0, 0); __nw.run(24);
  // The towers go out where the ground rolls, not on the plateau. Four towers
  // ringing the settlement shot at nothing but attackers standing on the flat,
  // where the target's chest and the plateau's chest are the same height and
  // the measurement below cannot tell them apart.
  let placed = 0;
  for (let a = 0; a < 6.2832 && placed < 4; a += 0.22) {
    for (let r = 17; r <= 27 && placed < 4; r += 2.5) {
      const px = Math.cos(a) * r, pz = Math.sin(a) * r;
      if (Math.abs(__nw.ground(px, pz) - HF.PLAT) < 0.7) continue;
      if (__nw.place('tower', px, pz)) placed++;
    }
  }
  __nw.run(60);
  __nw.invincible();
  for (let i = 0; i < 40 && S2.phase !== 'attack'; i++) __nw.run(10);
  // Each bolt is followed until it disappears, and the reading taken is its
  // last one — where it actually arrived. Sampling in mid-flight compares two
  // answers that have not diverged yet: at three units out a bolt is 0.40 from
  // one candidate height and 0.49 from the other, which decides nothing.
  const bolts = [];
  let live = new Map();
  for (let i = 0; i < 30 * 60; i++) {
    HFGAME.update(1 / 30);
    const now = new Map();
    for (const b of S2.bolts) {
      const t = b.t; if (!t) continue;
      now.set(b, { y: b.y, g: __nw.ground(t.x, t.z) });
    }
    for (const [b, last] of live) {
      if (now.has(b)) continue;                       // still flying
      if (Math.abs(last.g - HF.PLAT) < 0.3) continue; // on the flat both answers agree
      bolts.push({ y: last.y, want: last.g + 0.55, flat: HF.PLAT + 0.55 });
    }
    live = now;
    if (bolts.length > 300) break;
  }
  const close = bolts;
  const med = a => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
  const errWant = med(close.map(b => Math.abs(b.y - b.want)));
  const errFlat = med(close.map(b => Math.abs(b.y - b.flat)));

  return { relief: +relief.toFixed(2), offFlat: +offFlat.toFixed(2),
           parts: young.length, under, worstUnder: +worstUnder.toFixed(2),
           medOver, p99, high, sign, troops: troops.length,
           rest, placed, bolts: close.length, errWant, errFlat };
});

check('the fight is happening off the flat', !m.none && m.offFlat > 0.4,
      `the ground under it sits ${m.offFlat} from the plateau (the nest itself ${m.relief}) — ` +
      `measured on the plateau every check below passes with the bug in place`);
check('there is a fight to measure', m.parts > 200 && m.troops >= 2,
      `${m.parts} effects spawned in twenty-five seconds of it, with ${m.troops} of ` +
      `your own swinging back`);
check('nothing is spawned underneath the ground it happens on',
      m.under === 0,
      m.under ? `${m.under} of ${m.parts} effects started below their own ground, worst by ` +
                `${(-m.worstUnder).toFixed(2)} — a spark under a hillside is a spark nobody sees`
              : 'every spark started above the ground it came off');
check('...nor floating over it',
      m.medOver < 1.2,
      `a typical effect in that fight went off ${m.medOver} above the ground it came from, ` +
      `on ground sitting ${m.sign} from the plateau (p99 ${m.p99}, ${m.high} above 2.2) — ` +
      `a blow anchored to the plateau instead sprays sparks that far over everyone's heads`);
check('a body lies on the ground it fell on',
      m.rest !== null && Math.abs(m.rest - 0.02) < 0.05,
      m.rest === null ? 'the body never settled — check the scene, not the code'
                      : `it settled ${m.rest} above its own ground, which is the clearance the corpse step gives it`);
check('a bolt flies at its target\'s chest, not the plateau\'s',
      m.bolts > 20 && m.errWant !== null && m.errWant < m.errFlat * 0.5,
      `${m.placed} towers out on rolling ground, ${m.bolts} arriving bolts aimed at ` +
      `targets standing off the flat: they sit ` +
      `${m.errWant?.toFixed(2)} from their target's chest and ${m.errFlat?.toFixed(2)} from ` +
      `the height the old code aimed at`);

await close();
done(errors);
