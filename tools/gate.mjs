// ---------------------------------------------------------------------------
// gate — whether a door is a door.
//
// A gate used to be a permanent hole in your own wall. Both sides walked
// through it whenever they liked, which meant a soldier could stand inside the
// line, step out to swing at whatever was chewing on the wall, and step back
// in — the palisade was decoration on the one axis it was supposed to matter,
// and the horde walked in through the front door on the other.
//
// Now it has two states, and the interesting thing about that is how many
// places have an opinion about it. Three systems decide where a body can go,
// and they are not the same code: the collision in moveUnit(), the A* your own
// orders route over, and the flow field the horde runs down. If any one of them
// disagrees with the other two you do not get a bug you can see — you get a
// unit walking confidently into a door and grinding there, or an attacker
// queueing at a gate that is barred. So every check below is run against a
// closed gate AND an open one, because "it blocks" and "it lets things through"
// are two claims and passing one of them is how you ship half a door.
//
//   node tools/gate.mjs
// ---------------------------------------------------------------------------
import { open, check, done } from './harness.mjs';

const SEED = 4242;
const { page, errors, close } = await open();

// A wall run with one gate in the middle of it, and a unit on each side. The
// wall is long enough that going round it is not the same as going through it:
// an early version of this had a three-cell stub, the pathfinder cheerfully
// walked around the end, and the tool reported that a closed gate blocked
// nothing because nothing had ever needed to use it.
const m = await page.evaluate(() => {
  HF.setStat('fog', 'on', 0);
  __nw.start(4242);
  const S = __nw.state();
  S.players[0].supply = 999999;
  __nw.hall(0, 0);
  __nw.run(26);

  // A north-south wall at x = 6, from z = -12 to z = 12, with a gate at z = 0.
  const GX = HF.w2gx(6);
  const line = [];
  for (let gz = HF.w2gx(-12); gz <= HF.w2gx(12); gz++) line.push(gz);
  const GZ = HF.w2gx(0);
  for (const gz of line) HFGAME.place(gz === GZ ? 'gate' : 'wall', GX, gz);
  __nw.run(12);                         // let the run finish building

  const gate = __nw.at(6, 0);
  const cellsBuilt = line.filter(gz => {
    const c = S.cells[GX + ',' + gz];
    return c && !(c.ref || c).site;
  }).length;

  // Two probes, one either side of the wall and level with the gate, so the
  // straight line between them runs through the doorway.
  const WEST = { x: 3.2, z: 0 }, EAST = { x: 9.0, z: 0 };

  function probe() {
    // 1. Collision: can a body step into the gate's own cell at all?
    const gx = HF.gx2w(GX), gz = HF.gx2w(GZ);
    const solid = HFGAME.solidAt(gx, gz);

    // 2. Your own orders: does the route from one side to the other go through
    //    the door, or round the end of the wall?
    //
    //    findPath() returns null when a straight line is already clear, because
    //    the answer is "just walk" — so a null here is not a failure, it is the
    //    strongest possible yes, and an earlier version of this check read it as
    //    a no and reported a working open gate as broken. The straight line is
    //    asked about separately for exactly that reason.
    const straight = HFGAME.losClear(WEST.x, WEST.z, EAST.x, EAST.z);
    const path = HFGAME.findPath(WEST.x, WEST.z, EAST.x, EAST.z);
    let len = straight ? Math.hypot(EAST.x - WEST.x, EAST.z - WEST.z) : 0;
    let viaGate = straight, reached = straight;
    if (path) {
      reached = true; len = 0; viaGate = false;
      let px = WEST.x, pz = WEST.z;
      for (const p of path) {
        len += Math.hypot(p.x - px, p.z - pz);
        if (Math.abs(p.x - gx) < HF.CELL && Math.abs(p.z - gz) < HF.CELL) viaGate = true;
        px = p.x; pz = p.z;
      }
    }

    // 3. The horde: the flow field is a distance to the halls, so what a gate is
    //    worth to an attacker is how much shorter standing ON it makes the walk
    //    home than standing on the wall immediately either side of it.
    //
    //    Either side, and not three cells along: the field is a distance, so a
    //    cell further from the hall reads higher for reasons that have nothing
    //    to do with gates. The two neighbours straddle the gate, so what is left
    //    after the subtraction is the door and one cell of geometry.
    const D = HFGAME.field();
    const N = HF.GN;
    const atGate = D[GZ * N + GX];
    const nb = (D[(GZ - 1) * N + GX] + D[(GZ + 1) * N + GX]) / 2;

    return { solid, len: +len.toFixed(1), viaGate, reached,
             atGate: +atGate.toFixed(1), atWall: +nb.toFixed(1),
             adv: +(nb - atGate).toFixed(1) };
  }

  const shut = probe();
  HFGAME.setGate(gate, false);
  const open_ = probe();
  HFGAME.setGate(gate, true);
  const reshut = probe();

  // What the frame draws: an open gate is marked on the ground, a shut one is
  // not, because the absence IS the other state and a marker under every gate
  // would say nothing at all.
  function ringsAtGate() {
    const rows = __nw.frame().rows;
    const gxw = HF.gx2w(GX), gzw = HF.gx2w(GZ);
    return rows.filter(r => r.b === 'rchip' &&
                            Math.hypot(r.x - gxw, r.z - gzw) < 1.6).length;
  }
  const shutRings = ringsAtGate();
  HFGAME.setGate(gate, false);
  const openRings = ringsAtGate();
  HFGAME.setGate(gate, true);

  // ---- the leaves ----------------------------------------------------------
  // The frame and the doors are separate assets, because the doors move and the
  // frame does not. Each leaf hinges at its own mesh origin and runs out along
  // +x, so the instance yaw every batch already carries IS the angle the door
  // stands at — no bone, no pitch slot, no shader. What that buys has to be
  // measured on the instances the renderer is handed, since a leaf drawn at the
  // wrong yaw is still a leaf and still counts.
  function leaves(cx, cz) {
    return __nw.frame().rows
      .filter(r => r.b === 'gatedoor' && Math.hypot(r.x - cx, r.z - cz) < 2)
      .map(r => ({ off: +Math.hypot(r.x - cx, r.z - cz).toFixed(3),
                   ax: +(r.x - cx).toFixed(3), az: +(r.z - cz).toFixed(3),
                   yaw: r.yaw }));
  }
  const gxw = HF.gx2w(GX), gzw = HF.gx2w(GZ);
  HFGAME.setGate(gate, true);
  __nw.run(2);
  const lShut = leaves(gxw, gzw);
  HFGAME.setGate(gate, false);
  const mid = [];
  for (let i = 0; i < 5; i++) { __nw.run(0.1, 0.05); mid.push(leaves(gxw, gzw)[0].yaw); }
  __nw.run(2);
  const lOpen = leaves(gxw, gzw);
  HFGAME.setGate(gate, true);
  __nw.run(2);

  // A second gate at a right angle to the first, because hinge offsets written
  // in world axes instead of the gate's own would sit correctly on one run and
  // inside the sill on the other. It needs a run of its own to align to: a lone
  // gate takes the default rotation, which is the first gate's, and the check
  // then compares a thing with itself and passes.
  const GZ2 = HF.w2gx(0);
  for (let gx = HF.w2gx(-13); gx <= HF.w2gx(-5); gx++)
    HFGAME.place(gx === HF.w2gx(-9) ? 'gate' : 'wall', gx, GZ2);
  __nw.run(12);
  const g2 = __nw.at(-9, 0);
  const g2x = HF.gx2w(HF.w2gx(-9)), g2z = HF.gx2w(HF.w2gx(0));
  const l2 = leaves(g2x, g2z);

  return { cellsBuilt, wanted: line.length, isGate: gate && gate.type === 'gate',
           shut, open: open_, reshut, shutRings, openRings,
           lShut, lOpen, mid, l2,
           rot: gate.rot, rot2: g2 ? g2.rot : null };
});

check('the wall under test actually got built',
      m.isGate && m.cellsBuilt === m.wanted,
      `${m.cellsBuilt} of ${m.wanted} cells standing with a gate in the middle — ` +
      `every reading below is about a body meeting this wall, and a wall with a ` +
      `hole in it from a failed placement would pass the lot`);

check('a gate you have just built is barred',
      m.shut.solid === true,
      `a new gate starts shut, which is what makes it a door rather than a hole ` +
      `you paid for`);
check('...and nothing walks through a barred one',
      m.shut.solid === true && m.open.solid === false,
      `solid ${m.shut.solid} shut, ${m.open.solid} open — the collision every ` +
      `body runs through, yours and theirs alike`);

check('your own orders route through an open gate',
      m.open.reached && m.open.viaGate,
      `the path from one side to the other goes through the doorway, ${m.open.len} ` +
      `units of walking`);
check('...and go the long way round a barred one',
      m.shut.reached && !m.shut.viaGate && m.shut.len > m.open.len * 1.8,
      `${m.shut.len} units round the end of the wall against ${m.open.len} through ` +
      `the door — the A* and the collision have to agree, or a unit is routed into ` +
      `a gate it cannot enter and grinds on it for the rest of the round`);

check('the horde prefers an open gate to the wall either side of it',
      m.open.adv > 8,
      `standing on the open gate is ${m.open.atGate} from your hall against ` +
      `${m.open.atWall} on the wall either side — ${m.open.adv} cheaper. An open gate ` +
      `is meant to be inviting, and that is the trade for opening it`);
check('...and a barred one buys it almost nothing',
      m.shut.adv < 1.5,
      `${m.shut.adv} cheaper than the wall either side against ${m.open.adv} when it ` +
      `is open — what is left is one cell of geometry, not a door. With a shut gate ` +
      `still reading as the cheap way in, the horde walks the whole map to queue at ` +
      `a door that is not going to open`);

check('shutting a gate again puts everything back',
      m.reshut.solid === m.shut.solid && m.reshut.viaGate === m.shut.viaGate &&
      m.reshut.adv === m.shut.adv,
      `collision, paths and the flow field all return to what they were — the ` +
      `three of them are invalidated by hand on every toggle, and a stale one is ` +
      `a door that is only shut until something recomputes`);

check('an open gate is marked on the ground and a shut one is not',
      m.openRings > 0 && m.shutRings === 0,
      `${m.openRings} ring segments under an open gate, ${m.shutRings} under a shut ` +
      `one — the player has to be able to see which of their gates are standing open ` +
      `without clicking every one of them`);

// ---- the leaves swing ------------------------------------------------------
const deg = r => r * 180 / Math.PI;
const sep = (a, b) => {
  let d = deg(a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};

check('a gate draws two leaves, hinged at its jambs',
      m.lShut.length === 2 &&
      m.lShut.every(l => Math.abs(l.off - 0.525) < 0.01),
      `two instances ${m.lShut.map(l => l.off).join(' and ')} from the gate's centre. ` +
      `The frame and the doors are separate assets because the doors move and the ` +
      `frame does not`);

check('...and the hinges turn with the frame',
      Math.abs(m.lShut[0].ax) < 0.01 && Math.abs(m.lShut[0].az - 0.525) < 0.01 &&
      Math.abs(m.l2[0].az) < 0.01 && Math.abs(Math.abs(m.l2[0].ax) - 0.525) < 0.01,
      `a gate in a north-south run hangs its leaves along z (${m.lShut[0].ax}, ` +
      `${m.lShut[0].az}) and one in an east-west run along x (${m.l2[0].ax}, ` +
      `${m.l2[0].az}) — hinge offsets written in world axes would sit correctly on ` +
      `one run and inside the sill on the other`);

const swing = m.lShut.map((l, i) => sep(m.lOpen[i].yaw, l.yaw));
check('opening swings both leaves clear of the doorway',
      swing.every(d => Math.abs(d) > 70 && Math.abs(d) < 95),
      `${swing.map(d => d.toFixed(0)).join('° and ')}° from shut. Far enough that the ` +
      `leaf stands proud of the wall line and breaks its silhouette, which is what ` +
      `reads at play zoom; folded flat against the wall at 110° it was invisible from ` +
      `an isometric camera and the whole change bought nothing`);
check('...and they swing opposite ways, like a door rather than a turnstile',
      (swing[0] > 0) !== (swing[1] > 0),
      `${swing.map(d => d.toFixed(0)).join('° and ')}° — two leaves rotating the same ` +
      `way is a revolving door`);

check('the leaves swing rather than snapping',
      new Set(m.mid.map(y => y.toFixed(3))).size >= 4 &&
      Math.abs(sep(m.mid[m.mid.length - 1], m.mid[0])) > 20,
      `${m.mid.map(y => deg(y).toFixed(0)).join('°, ')}° over half a second of frames. ` +
      `It is driven from the shut flag the snapshot already carries, so both sides of ` +
      `a net game animate the same door without a number on the wire`);

await close();
done(errors);
