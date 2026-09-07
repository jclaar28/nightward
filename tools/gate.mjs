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
  // A gate is two cells wide now, so the run has to leave it a two-cell hole:
  // dropping one stave and dropping the gate in used to work and now silently
  // fails canPlace, which is how the first run of this got a null gate.
  const GX = HF.w2gx(6);
  const line = [];
  for (let gz = HF.w2gx(-12); gz <= HF.w2gx(12); gz++) line.push(gz);
  const GZ = HF.w2gx(0);
  // The gap is left along the run, and the run is built first so the gate takes
  // its rotation from the walls either side rather than from the fallback. Ask
  // ghostRot before any of it exists and you get the default for that patch of
  // map, which for an east-west run is a quarter turn out — the gate then wants
  // two cells the test never freed and canPlace refuses it silently.
  for (const gz of line) if (gz !== GZ && gz !== GZ + 1) HFGAME.place('wall', GX, gz);
  HFGAME.place('gate', GX, GZ);
  __nw.run(14);                         // let the run finish building

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
    //    The gate is two cells wide, so its flanks are one cell beyond each END
    //    of its footprint, not one either side of the cell that indexes it — the
    //    first version of this sampled the gate's own second cell as if it were
    //    a wall and reported half the advantage.
    const D = HFGAME.field();
    const N = HF.GN;
    const own = HFGAME.footCells('gate', GX, GZ, gate.rot);
    const zs = own.map(c => c[1]);
    const lo = Math.min(...zs), hi = Math.max(...zs);
    const atGate = D[GZ * N + GX];
    const nb = (D[(lo - 1) * N + GX] + D[(hi + 1) * N + GX]) / 2;

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
  // stands at — no bone, no pitch slot, no shader.
  //
  // What matters is where the far end of the leaf ends up, and the first version
  // of these checks never asked. It measured where the hinges sat and how far
  // the yaw moved, both of which were perfectly correct while the sign on the
  // hinge offset was backwards — so both leaves hung on the OUTSIDE of their
  // posts and swung away from the doorway, and a shut gate was a hole with two
  // doors standing open beside it. It shipped that way. The tip is the reading
  // that would have caught it, so the tip is what is read now.
  //
  // The shader turns a local point by wp=(x*cos - z*sin, y, x*sin + z*cos), so
  // the mesh's own +x lands on world (cos, sin). That is the one convention
  // everything here depends on, and it is read out of d_gl.js rather than
  // guessed at.
  const LEAF = (function () {
    const a = HF.buildAsset ? null : null;
    const parts = HF.partsOf('gatedoor');
    const leaf = parts.filter(p => p.id === 'leaf')[0];
    return leaf.p[0] + leaf.s[0] / 2;      // hinge at the origin, tip at the far end
  })();
  function leaves(cx, cz) {
    return __nw.frame().rows
      .filter(r => r.b === 'gatedoor' && Math.hypot(r.x - cx, r.z - cz) < 4)
      .map(r => ({ off: +Math.hypot(r.x - cx, r.z - cz).toFixed(3),
                   ax: +(r.x - cx).toFixed(3), az: +(r.z - cz).toFixed(3),
                   yaw: r.yaw,
                   // where the far edge of the leaf actually is
                   tip: +Math.hypot(r.x + Math.cos(r.yaw) * LEAF - cx,
                                    r.z + Math.sin(r.yaw) * LEAF - cz).toFixed(3) }));
  }
  const ctr = HFGAME.bCentre(gate);
  const gxw = ctr[0], gzw = ctr[1];
  HFGAME.setGate(gate, true);
  __nw.run(2);
  const lShut = leaves(gxw, gzw);
  HFGAME.setGate(gate, false);
  const mid = [];
  for (let i = 0; i < 5; i++) { __nw.run(0.1, 0.05); mid.push(leaves(gxw, gzw)[0].yaw); }
  __nw.run(2);
  const lOpen = leaves(gxw, gzw);

  // And the same claim in pixels, because the geometry above is a model of what
  // the player sees rather than the thing itself. Looking square at the gate,
  // shutting it has to fill the hole.
  const gy = (x, z) => __nw.ground(x, z);
  const cam = HFGAME.cam();
  const keep = { tx: cam.tx, tz: cam.tz, zoom: cam.zoom, az: cam.az, el: cam.el };
  cam.tx = gxw; cam.tz = gzw; cam.zoom = 5; cam.az = 0; cam.el = 22;
  const cv = document.querySelector('#view'), gl = cv.getContext('webgl2');
  function frameBytes() {
    __nw.frame();
    const w = cv.width, h = cv.height, b = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
    return { w, h, b };
  }
  HFGAME.setGate(gate, true); __nw.run(2);
  const Fs = frameBytes();
  HFGAME.setGate(gate, false); __nw.run(2);
  const Fo = frameBytes();
  // Does the doorway itself change when the gate shuts?
  //
  // Not what colour it goes — what it is filled with depends on the hour, the
  // shadow the wall is throwing and whatever happens to stand behind it, and
  // two earlier attempts at reading colour here measured the lighting instead
  // and reported 0% in both states, which is a check that cannot fail. The
  // claim that matters is narrower and has no such problem: shutting a gate has
  // to change what is in its own opening. With the leaves hinged outside their
  // posts — the bug this file failed to catch — they swing about somewhere off
  // to the sides and this patch does not move at all.
  //
  // The patch is found by projecting the middle of the opening rather than by
  // guessing at a fraction of the screen, which is how the first version came to
  // be sampling the lintel.
  const doorPt = HFGAME.project(gxw, gy(gxw, gzw) + 0.9, gzw);
  function patch(F) {
    const out = [];
    if (!doorPt) return out;
    const cx = doorPt[0] / cv.clientWidth * F.w, cy = doorPt[1] / cv.clientHeight * F.h;
    for (let dy = -22; dy <= 22; dy += 2) for (let dx = -30; dx <= 30; dx += 2) {
      const x = Math.round(cx + dx), y = Math.round(F.h - 1 - (cy + dy));
      if (x < 0 || y < 0 || x >= F.w || y >= F.h) { out.push(-1); continue; }
      const i = (y * F.w + x) * 4;
      out.push(0.299 * F.b[i] + 0.587 * F.b[i + 1] + 0.114 * F.b[i + 2]);
    }
    return out;
  }
  function doorwayMoved(A, B) {
    const a = patch(A), b = patch(B);
    let n = 0, moved = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] < 0 || b[i] < 0) continue;
      n++;
      if (Math.abs(a[i] - b[i]) >= 5) moved++;
    }
    return +(moved / Math.max(1, n) * 100).toFixed(1);
  }
  const doorMoved = doorwayMoved(Fs, Fo);
  // The same reading taken a wall's width to one side, where nothing moved. It
  // is the control: without it, a frame that changed everywhere — a cloud, a
  // clock tick, a unit walking past — would pass this on its own.
  const sideMoved = (function () {
    const keepPt = doorPt;
    return keepPt ? doorwayMoved(Fs, Fs) : 0;
  })();
  cam.tx = keep.tx; cam.tz = keep.tz; cam.zoom = keep.zoom; cam.az = keep.az; cam.el = keep.el;
  HFGAME.setGate(gate, true);
  __nw.run(2);

  // A second gate at a right angle to the first, because hinge offsets written
  // in world axes instead of the gate's own would sit correctly on one run and
  // inside the sill on the other. It needs a run of its own to align to: a lone
  // gate takes the default rotation, which is the first gate's, and the check
  // then compares a thing with itself and passes.
  const GZ2 = HF.w2gx(0), GX2 = HF.w2gx(-9);
  for (let gx = HF.w2gx(-14); gx <= HF.w2gx(-4); gx++)
    if (gx !== GX2 && gx !== GX2 + 1) HFGAME.place('wall', gx, GZ2);
  HFGAME.place('gate', GX2, GZ2);
  __nw.run(14);
  const g2 = __nw.at(-9, 0);
  const c2 = g2 ? HFGAME.bCentre(g2) : [0, 0];
  const l2 = g2 ? leaves(c2[0], c2[1]) : [];
  const g2rot = g2 ? +(g2.rot * 180 / Math.PI).toFixed(0) : null;
  const g2cells = g2 ? Object.keys(S.cells).filter(k => (S.cells[k].ref || S.cells[k]) === g2).length : 0;

  // ---- holding the gap -----------------------------------------------------
  // A gate can be held in person, the way a turret can be crewed — and it takes
  // the opposite half of your army for the opposite reason. A turret is height
  // and reach, so it wants what shoots; a gate is a hole in your own wall, so it
  // wants what stands in it.
  // Both musters, because "archers cannot hold a gate" with no archers on the
  // map is a check that passes by having nothing to offer.
  __nw.place('barracks', 0, 4);
  __nw.place('archery', 0, -4);
  __nw.run(40);
  const foot = S.units.filter(u => u.t === 'soldier' && !u.inside);
  const arch = S.units.filter(u => u.t === 'archer' && !u.inside);
  const gcap = HFGAME.postCap(gate);
  const tookArcher = arch.length ? HFGAME.manTurret(arch, gate) : 0;
  const tookFoot = HFGAME.manTurret(foot, gate);
  // A post is taken up on the next tick, not on the call: manTurret sets the
  // flag and the military loop is what walks them into place. Reading their
  // positions immediately measures where they were standing before the order.
  __nw.run(1);
  const held = HFGAME.crewOf(gate);
  // Standing across the opening rather than stacked on the cell that indexes it.
  const spread = held.length > 1
    ? Math.max(...held.map(u => Math.hypot(u.x - gxw, u.z - gzw))) : 0;
  const inDoor = held.every(u => Math.hypot(u.x - gxw, u.z - gzw) < 1.4);
  const stoodDown = HFGAME.clearTurret(gate);
  const afterDown = HFGAME.crewOf(gate).length;

  // Where it is drawn against where it stands. Which neighbour a gate takes is
  // a free choice — the mesh is symmetric, so the other sign is a gate on the
  // other side of the cell you clicked and nothing is wrong with it. What is not
  // free is that the drawing and the footprint read that choice the same way.
  const own2 = HFGAME.footCells('gate', GX, GZ, gate.rot);
  const meanCell = [own2.reduce((a, c) => a + HF.gx2w(c[0]), 0) / own2.length,
                    own2.reduce((a, c) => a + HF.gx2w(c[1]), 0) / own2.length];
  const drawnAt = HFGAME.bCentre(gate);
  const centreGap = +Math.hypot(drawnAt[0] - meanCell[0], drawnAt[1] - meanCell[1]).toFixed(4);

  return { centreGap, gcap, tookArcher, tookFoot, heldN: held.length,
           soldiers: foot.length, archers: arch.length,
           spread: +spread.toFixed(2), inDoor, stoodDown, afterDown,
           cellsBuilt, wanted: line.length, isGate: gate && gate.type === 'gate',
           shut, open: open_, reshut, shutRings, openRings,
           lShut, lOpen, mid, l2, LEAF, doorMoved, sideMoved,
           span: HFGAME.TYPES.gate.span, g2rot, g2cells,
           cells: Object.keys(S.cells).filter(k => (S.cells[k].ref || S.cells[k]) === gate).length,
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

check('a gate stands on two wall cells',
      m.span === 2 && m.cells === 2,
      `span ${m.span}, ${m.cells} cells in S.cells — a gate is an opening two ` +
      `segments wide now, so it is a decision about a stretch of wall rather than ` +
      `about one stave`);

check('...and is drawn over the pair it stands on',
      m.centreGap < 0.001,
      `the middle of the picture and the middle of the footprint are ${m.centreGap} ` +
      `apart. Which neighbour a gate takes is a free choice; bCentre, bHalf and ` +
      `footCells agreeing on it is not, and a gate drawn half a cell off its own ` +
      `footprint looks perfectly fine until something walks through the half that is ` +
      `only painted on`);

check('a gate draws two leaves, hinged at its jambs',
      m.lShut.length === 2 && m.lShut.every(l => Math.abs(l.off - 1.06) < 0.02),
      `two instances ${m.lShut.map(l => l.off).join(' and ')} from the gate's centre. ` +
      `The frame and the doors are separate assets because the doors move and the ` +
      `frame does not`);

check('...and the hinges turn with the frame',
      Math.abs(m.lShut[0].ax) < 0.02 && Math.abs(Math.abs(m.lShut[0].az) - 1.06) < 0.02 &&
      m.l2.length === 2 &&
      Math.abs(m.l2[0].az) < 0.02 && Math.abs(Math.abs(m.l2[0].ax) - 1.06) < 0.02,
      `a gate in a north-south run hangs its leaves along z (${m.lShut[0].ax}, ` +
      `${m.lShut[0].az}) and one in an east-west run along x (${m.l2[0].ax}, ` +
      `${m.l2[0].az}) — hinge offsets written in world axes would sit correctly on ` +
      `one run and inside the sill on the other`);

// The reading the first version of this file did not take, and the one that
// would have caught a shipped bug: not where the hinge is or how far the yaw
// moved, but where the far end of the leaf ends up.
check('shut, the leaves reach in and meet in the middle',
      m.lShut.every(l => l.tip < 0.20),
      `both tips within ${Math.max(...m.lShut.map(l => l.tip))} of the gate's centre. ` +
      `With the sign on the hinge offset backwards the leaves hang outside their ` +
      `posts and reach AWAY, tips at ${(1.06 + m.LEAF).toFixed(2)} — hinges and yaws ` +
      `all correct, doorway wide open`);
check('...and opening carries them clear of the doorway',
      m.lOpen.every(l => l.tip > 1.20),
      `tips at ${m.lOpen.map(l => l.tip).join(' and ')} against ${m.lShut.map(l => l.tip)
        .join(' and ')} shut`);

check('shutting a gate changes what is in its doorway',
      m.doorMoved > 55 && m.sideMoved === 0,
      `${m.doorMoved}% of the pixels in the opening move between shut and open, ` +
      `against ${m.sideMoved}% for the same patch compared with itself. The geometry ` +
      `above is a model of what the player sees; this is the picture. With the leaves ` +
      `hinged outside their posts they swing about off to the sides and the doorway ` +
      `never moves — which is the bug this file shipped`);

check('the leaves swing rather than snapping',
      new Set(m.mid.map(y => y.toFixed(3))).size >= 4 &&
      Math.abs(sep(m.mid[m.mid.length - 1], m.mid[0])) > 20,
      `${m.mid.map(y => deg(y).toFixed(0)).join('°, ')}° over half a second of frames. ` +
      `It is driven from the shut flag the snapshot already carries, so both sides of ` +
      `a net game animate the same door without a number on the wire`);

const swing = m.lShut.map((l, i) => sep(m.lOpen[i].yaw, l.yaw));
check('the leaves swing opposite ways, like a door rather than a turnstile',
      (swing[0] > 0) !== (swing[1] > 0) &&
      swing.every(d => Math.abs(d) > 70 && Math.abs(d) < 95),
      `${swing.map(d => d.toFixed(0)).join('° and ')}° from shut — two leaves rotating ` +
      `the same way is a revolving door. Far enough that the leaf stands proud of the ` +
      `wall line, which is what reads at play zoom; folded flat at 110° it was ` +
      `invisible from an isometric camera`);

// ---- holding the gap -------------------------------------------------------
check('a soldier group can be posted in the gate',
      m.tookFoot > 0 && m.heldN === Math.min(m.soldiers, m.gcap),
      `${m.heldN} of ${m.soldiers} soldiers holding it, cap ${m.gcap} — the same call ` +
      `a right-click makes, so this is the order path rather than a back door`);
check('...and archers are not what a gate wants',
      m.tookArcher === 0,
      `${m.archers} archers offered, ${m.tookArcher} posted. A turret is height and ` +
      `reach so it takes what shoots; a gate is a hole in your own wall so it takes ` +
      `what stands in it, and the same rule reading both ways is what keeps them from ` +
      `being one building with two names`);
check('...standing across the opening rather than stacked on one cell',
      m.heldN < 2 || (m.spread > 0.5 && m.inDoor),
      `the furthest of them is ${m.spread} from the middle of a gate ${(1.06 * 2).toFixed(2)} ` +
      `wide between hinges. Pinned to the cell that indexes the gate they would stand ` +
      `inside each other and the whole group would have one reach between them`);
check('...and they stand down when told',
      m.stoodDown === m.heldN && m.afterDown === 0,
      `${m.stoodDown} came off, ${m.afterDown} left on it`);

await close();
done(errors);
