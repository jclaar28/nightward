// ---------------------------------------------------------------------------
// text — is every word the player reads actually coming from the text table?
//
// The whole point of TEXT_DEFS is that there is exactly one copy of each string.
// That property is invisible in code review — a hard-coded label looks identical
// on screen to a routed one — so it has to be measured. This tool:
//
//   * resolves every key and fails on any that comes back as its own name
//   * walks the live DOM on every screen looking for words that no key owns
//   * types into the Text tab and checks the change reaches the game
//   * reloads and checks it survived, then reverts and checks it went back
//
//   node tools/text.mjs
// ---------------------------------------------------------------------------
import { open, check, done } from './harness.mjs';

const { page, errors, close, reopen } = await open();

// ---- the table itself ------------------------------------------------------
const table = await page.evaluate(() => {
  const keys = HF.textKeys();
  const unresolved = keys.filter(k => HF.textRaw(k) === null);
  const blank = keys.filter(k => !String(HF.textRaw(k)).trim());
  const groups = HF.textGroups().map(g => g.id);
  const orphanGroup = keys.filter(k => groups.indexOf(HF.textDef(k).g) < 0);
  // A def that declares {n} and never uses it, or uses one it did not declare,
  // would silently print a brace on screen.
  const braces = keys.filter(k => {
    const raw = String(HF.textRaw(k));
    const used = (raw.match(/\{(\w+)\}/g) || []).map(s => s.slice(1, -1));
    const declared = HF.textVars(k);
    return used.some(u => declared.indexOf(u) < 0);
  });
  return { n: keys.length, unresolved, blank, orphanGroup, braces };
});
check('every key resolves to a string', table.unresolved.length === 0,
      `${table.n} keys` + (table.unresolved.length ? ' · ' + table.unresolved.slice(0, 4) : ''));
check('none of them is blank', table.blank.length === 0, table.blank.slice(0, 4).join(', '));
check('every key belongs to a real group', table.orphanGroup.length === 0,
      table.orphanGroup.slice(0, 4).join(', '));
check('no def uses an undeclared placeholder', table.braces.length === 0,
      table.braces.slice(0, 4).join(', '));

// ---- nothing in the markup holds its own copy ------------------------------
// A data-t element whose text still equals its key means applyText never ran on
// it; an element with literal text and no key is a string that the Text tab
// cannot reach. The second is the one that actually rots.
const dom = await page.evaluate(async () => {
  const seen = { stale: [], loose: [] };
  // A text node has to match a key's SHAPE, not its literal text: "3 nests" is
  // produced by "{n} nests", and comparing against the raw template would
  // report every filled-in readout as an unkeyed string. So each def becomes a
  // pattern with its placeholders widened to a wildcard.
  const shapes = HF.textKeys().map(k => new RegExp('^' +
    String(HF.textRaw(k)).trim()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\{\w+\\\}/g, '[\\s\\S]+') + '$'));
  const owned = s => shapes.some(re => re.test(s));
  // ids that legitimately hold data rather than prose: numbers, codes, names
  // the player typed, and counts the game composes from a keyed template.
  const DATA = /^(supply|grpWorkN|grpArmyN|grpWorkIn|dayLeft|nightLeft|nightSend|wLeft|hallPct|bldHp|bldBar|dayBar|nightBar|hallBar|mRuns|mWins|mBest|mLast|mDiffTag|mAssets|mMapCount|libTextCount|libTris|libVerts|libPartCount|netOffer|netAnswer|netOfferIn|netAnswerIn|netStatus|netMapNote|nightNo|nightNo2|nestsLeft|nestsLeft2|newMapName|newMapNote|newMapPick|diffBlurb|bldName|bldHoused|bldIn|bldHint|troopWhat|dockWhat|dockSell|dockShelter|troopStance|ovTitle|ovBody|ovStats|pauseTag|pauseNote|libName|libNote|libGroupTag|libEyebrow|libTextOut|libOut)$/;
  const SKIP = new Set(['SCRIPT','STYLE','CANVAS','OPTION','TEXTAREA','INPUT']);

  for (const screen of ['menu','setup','settings','net','library','maps']) {
    __hf.show(screen);
    await new Promise(r => setTimeout(r, 60));
    document.querySelectorAll('[data-t]').forEach(n => {
      if (n.textContent === n.dataset.t) seen.stale.push(screen + ':' + n.dataset.t);
    });
    document.querySelectorAll('#screen-' + screen + ' *').forEach(n => {
      if (SKIP.has(n.tagName) || n.dataset.t || n.dataset.tPh) return;
      if (n.closest('[data-t]')) return;
      if (DATA.test(n.id)) return;
      // One text node at a time, not the element's text joined together: a card
      // built from three keyed fragments separated by <br> has three owned text
      // nodes and one meaningless concatenation of them, and comparing the
      // concatenation reports every composed element as unkeyed.
      n.childNodes.forEach(c => {
        if (c.nodeType !== 3) return;
        const own = c.textContent.replace(/\s+/g, ' ').trim();
        // one- and two-character glyphs are chrome (bullets, arrows, digits)
        if (own.length < 3 || /^[\d\s·×—↶↷▶←]+$/.test(own)) return;
        if (owned(own)) return;                    // some key produces this shape
        seen.loose.push(screen + ' <' + n.tagName.toLowerCase() +
                        (n.id ? '#' + n.id : '') + '> ' + own.slice(0, 46));
      });
    });
  }
  __hf.show('menu');
  return seen;
});
check('every data-t element got filled', dom.stale.length === 0, dom.stale.slice(0, 4).join(' | '));
// The Library and Maps editors are dev tools and deliberately out of the table,
// so they are reported rather than failed — the player-facing screens are not.
const player = dom.loose.filter(s => !/^(library|maps|settings)/.test(s));
check('no player-facing screen holds an unkeyed string', player.length === 0,
      player.length ? player.slice(0, 5).join(' | ') : `${dom.loose.length} dev-tool strings left alone`);

// ---- names come from the table, not from a second copy ---------------------
const names = await page.evaluate(() => {
  const before = { type: HFGAME.TYPES.tower.name, asset: HF.assetMeta('tower').name };
  HF.setText('bld.tower.name', 'Bell Tower');
  HFGAME.rebuildAssets();
  const after = { type: HFGAME.TYPES.tower.name, asset: HF.assetMeta('tower').name };
  HF.resetText('bld.tower.name');
  HFGAME.rebuildAssets();
  return { before, after, back: HFGAME.TYPES.tower.name };
});
check('a building name has one home, not two',
      names.after.type === 'Bell Tower' && names.after.asset === 'Bell Tower',
      `type ${names.after.type}, library ${names.after.asset}`);
check('and reverting puts it back', names.back === 'Watchtower', names.back);

// ---- typing in the Text tab reaches the screen -----------------------------
const live = await page.evaluate(async () => {
  __hf.show('library');
  __hf.lib.setMode('text');
  await new Promise(r => setTimeout(r, 80));
  document.getElementById('libTextFind').value = 'hud.massing';
  document.getElementById('libTextFind').dispatchEvent(new Event('input'));
  await new Promise(r => setTimeout(r, 60));
  const ta = document.querySelector('[data-key="hud.massing"]');
  if (!ta) return { found: false };
  ta.value = 'Gathering';
  ta.dispatchEvent(new Event('input'));
  await new Promise(r => setTimeout(r, 60));

  // now look at the actual HUD element, not at the table
  __hf.show('play');
  __hf.game.start(4242, null, null);
  await new Promise(r => setTimeout(r, 120));
  const onScreen = document.querySelector('[data-t="hud.massing"]').textContent;
  const stored = JSON.parse(localStorage.getItem('holdfast.text.v1') || '{}');
  return { found: true, onScreen, stored: stored['hud.massing'],
           edited: HF.textEdited('hud.massing') };
});
check('the key is listed in the Text tab', live.found);
check('typing a word changes the HUD in place', live.onScreen === 'Gathering', live.onScreen);
check('and it is written to storage', live.stored === 'Gathering', String(live.stored));

// ---- it survives a reload --------------------------------------------------
await reopen();
const after = await page.evaluate(() => ({
  raw: HF.textRaw('hud.massing'),
  onScreen: document.querySelector('[data-t="hud.massing"]').textContent,
  edited: HF.textEdited('hud.massing')
}));
check('the edit survives a reload', after.raw === 'Gathering' && after.onScreen === 'Gathering',
      `${after.raw} / ${after.onScreen}`);

// ---- reverting puts every word back ----------------------------------------
const reverted = await page.evaluate(async () => {
  __hf.show('library');
  __hf.lib.setMode('text');
  await new Promise(r => setTimeout(r, 60));
  document.getElementById('libTextRevert').click();
  await new Promise(r => setTimeout(r, 80));
  const stored = JSON.parse(localStorage.getItem('holdfast.text.v1') || '{}');
  return { raw: HF.textRaw('hud.massing'),
           onScreen: document.querySelector('[data-t="hud.massing"]').textContent,
           anyLeft: Object.keys(stored).length };
});
check('Revert all text puts the shipped words back',
      reverted.raw === 'Massing' && reverted.onScreen === 'Massing',
      `${reverted.raw} / ${reverted.onScreen}`);
check('and clears the stored overrides', reverted.anyLeft === 0, `${reverted.anyLeft} left`);

// ---- a lost placeholder is flagged, not swallowed --------------------------
const warn = await page.evaluate(async () => {
  document.getElementById('libTextFind').value = 'hud.night';
  document.getElementById('libTextFind').dispatchEvent(new Event('input'));
  await new Promise(r => setTimeout(r, 60));
  const ta = document.querySelector('[data-key="hud.night"]');
  ta.value = 'Nightfall';                       // drops the {n}
  ta.dispatchEvent(new Event('input'));
  await new Promise(r => setTimeout(r, 60));
  const flagged = ta.classList.contains('tBad');
  const warnShown = !document.getElementById('libTextWarn').hidden;
  const text = document.getElementById('libTextWarn').textContent;
  document.getElementById('libTextRevert').click();
  await new Promise(r => setTimeout(r, 60));
  return { flagged, warnShown, text };
});
check('an edit that drops a placeholder is marked', warn.flagged);
check('and says which one is missing', warn.warnShown && /\{n\}/.test(warn.text), warn.text);

await close();
done(errors);
