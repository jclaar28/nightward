// ---------------------------------------------------------------------------
// select — what picks things up, and what puts them down.
//
// Selection is the one system a player touches on literally every click, and
// the one with the most rules that only exist in an input handler: which button
// means what depends on what is currently held, picked and selected, and every
// combination is a branch somebody has to have thought about.
//
// So this drives real events — a keydown for Escape, pointerdown/pointerup with
// button 2 for a right-click — rather than calling the handlers directly. The
// branch order in up() is the thing under test, and calling deselectAll() by
// hand would skip exactly the part that can be wrong.
//
//   node tools/select.mjs
// ---------------------------------------------------------------------------
import { open, check, done } from './harness.mjs';

const SEED = 4242;
const { page, errors, close } = await open();

await page.evaluate(seed => {
  HF.setStat('fog', 'on', 0);
  __nw.start(seed);
  const S = __nw.state();
  S.players[0].supply = 99999;
  __nw.hall(0, 0);
  __nw.run(26);
  __nw.place('tower', 9, 0);
  __nw.place('cottage', -9, 0);
  __nw.run(9);
}, SEED);

// Real events on the real canvas. The right-click handler lives in a
// pointerup, so a synthetic click() would not reach it.
const rightClickAt = (sx, sy) => page.evaluate(a => {
  const cv = document.querySelector('canvas');
  const mk = (t, b) => new PointerEvent(t, { clientX: a.x, clientY: a.y, button: b,
                                             buttons: b === 2 ? 2 : 1, bubbles: true,
                                             pointerId: 1, isPrimary: true });
  cv.dispatchEvent(mk('pointerdown', 2));
  cv.dispatchEvent(mk('pointerup', 2));
}, { x: sx, y: sy });
const esc = () => page.evaluate(() =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
const sel = () => page.evaluate(() => {
  const S = __nw.state();
  return { held: S.sel, bsel: !!HFGAME.bsel(), rsel: !!HFGAME.rsel(),
           units: S.units.filter(u => u.sel).length,
           paused: !!document.getElementById('pause') &&
                   !document.getElementById('pause').hidden };
});

// A screen point that lands on open ground, found rather than assumed — the
// camera is wherever the round left it, and a hard-coded pixel that happens to
// be over a building tests something else entirely.
const ground = await page.evaluate(() => {
  const cv = document.querySelector('canvas');
  const w = cv.clientWidth, h = cv.clientHeight;
  for (let y = 0.35; y < 0.8; y += 0.05)
    for (let x = 0.2; x < 0.8; x += 0.05) {
      const px = Math.round(w * x), py = Math.round(h * y);
      // S.hover is what the game itself thinks is under the cursor, set by a
      // pointermove — so ask it rather than doing the projection by hand
      cv.dispatchEvent(new PointerEvent('pointermove', { clientX: px, clientY: py,
                                                         bubbles: true, pointerId: 1 }));
      const S = __nw.state();
      if (S.hover && !__nw.at(S.hover.x, S.hover.z)) return { x: px, y: py };
    }
  return null;
});
check('there is a patch of open ground to right-click on', !!ground,
      ground ? `screen ${ground.x},${ground.y}` : 'the whole view is built on');

// ---- right-click puts down what is not a unit ------------------------------
const pickedB = await page.evaluate(() => {
  HFGAME.selectBuilding(__nw.at(9, 0));
  __nw.state().units.forEach(u => u.sel = false);
  return !!HFGAME.bsel();
});
check('a building can be picked', pickedB);
await rightClickAt(ground.x, ground.y);
let s = await sel();
check('right-click with no troops selected puts the building down',
      !s.bsel, `bsel ${s.bsel}`);

// ...but not while troops are selected, because then it is an order
const ordered = await page.evaluate(() => {
  HFGAME.selectBuilding(__nw.at(9, 0));
  const S = __nw.state();
  const u = S.units.filter(x => x.t === 'worker')[0];
  HFGAME.selectOnly ? HFGAME.selectOnly([u]) : (u.sel = true);
  u.sel = true;
  return { bsel: !!HFGAME.bsel(), sel: S.units.filter(x => x.sel).length };
});
check('a building and a worker can be selected together', ordered.bsel && ordered.sel > 0);
await rightClickAt(ground.x, ground.y);
s = await sel();
check('...and right-click is an order, so the building stays picked',
      s.bsel && s.units > 0,
      `bsel ${s.bsel}, ${s.units} selected — the click was an order, not a dismissal`);

// A house with people in it turns them out on a right-click, and must not lose
// the panel in the same press: the player is about to use it again.
const house = await page.evaluate(() => {
  const S = __nw.state();
  S.units.forEach(u => u.sel = false);
  HFGAME.selectBuilding(S.players[0].hall);
  return { bsel: !!HFGAME.bsel(), housed: HFGAME.housedBy(S.players[0].hall).length };
});
check('the hall has people to turn out', house.bsel && house.housed > 0,
      `${house.housed} housed`);
await rightClickAt(ground.x, ground.y);
s = await sel();
check('...so right-click sends them out rather than dropping the hall', s.bsel,
      'the panel is still there to press again');

// ---- escape lets go before it opens anything -------------------------------
const holdThen = async (setup) => {
  await page.evaluate(setup);
  await esc();
  return sel();
};
s = await holdThen(() => {
  const S = __nw.state();
  S.units.forEach(u => u.sel = false);
  HFGAME.selectBuilding(null); HFGAME.selectRoad(null);
  HFGAME.select('tower');                     // holding one, ready to place
});
check('escape puts down what you are holding, and does not pause',
      !s.held && !s.paused, `held ${s.held}, paused ${s.paused}`);

s = await holdThen(() => { HFGAME.selectBuilding(__nw.at(9, 0)); });
check('escape puts down a picked building, and does not pause',
      !s.bsel && !s.paused, `bsel ${s.bsel}, paused ${s.paused}`);

s = await holdThen(() => {
  const S = __nw.state();
  HFGAME.selectBuilding(null);
  S.units.forEach(u => u.sel = false);
  S.units[0].sel = true;
});
check('escape lets go of troops, and does not pause',
      s.units === 0 && !s.paused, `${s.units} still selected, paused ${s.paused}`);

// Only an empty cursor and an empty selection get the menu. This is the check
// that stops "escape deselects" from becoming "escape does nothing".
s = await holdThen(() => {
  const S = __nw.state();
  HFGAME.selectBuilding(null); HFGAME.selectRoad(null);
  S.sel = null;
  S.units.forEach(u => u.sel = false);
});
check('escape with nothing to let go of opens the menu', s.paused,
      `paused ${s.paused}`);

await close();
done(errors);
