# Nightward — working rules

Read this before touching anything. It is written for an agent working in this
repository, and it exists because several things here are load-bearing in ways
the surrounding code does not advertise.

Two people work on this repo, each with their own Claude. Assume the other side
is editing at the same time. Prefer small, self-contained commits; say what you
changed and why in the message, not just what file it touched.

---

## Shape of the thing

A single self-contained HTML file. No engine, no framework, no dependencies, no
network requests at runtime. `src/d_shell.html` holds the markup, the styles and
eight placeholders; `src/build.py` replaces each with the matching module
verbatim and writes `nightward.html` at the repo root.

```sh
python3 src/build.py     # the entire toolchain
```

| module | what it owns |
|---|---|
| `d_core.js` | palette, asset definitions, terrain, the balance table. Exposed as the global `HF`. |
| `d_gl.js` | the renderer. Instanced draws, cel shading, shadow maps, ink outlines. |
| `d_snd.js` | synthesised WebAudio. There are no audio files. |
| `d_game.js` | simulation, pathing, input, and `pack()`, which builds every frame's instances. Global `HFGAME`. |
| `d_lib.js` | the in-game library: inspect and edit any asset or balance number live. |
| `d_map.js` | the map editor. |
| `d_net.js` | the two-player peer connection. Global `HFNET`. |
| `d_app.js` | screens, HUD, settings. Owns the DOM. |

**Edit the modules, never `nightward.html`.** It is a build product. If you find
yourself editing it, you have lost the thread — rebuild instead.

---

## Rules that break things silently

These are the ones that cost real time when violated. None of them fail loudly.

**The instance stride is twelve floats and every slot is spoken for.**
`put(arr, n, x, y, z, rot, colA, scale, colB)` writes
`iPosRot(x,y,z,yaw) · iColA(r,g,b,scale) · iColB(r,g,b,pitch)`. The last slot is
pitch, read by the vertex shader to swing a limb about its mesh pivot — that is
what `putP()` is for. Writing anything else there rotates a body part.

**Batch buffers are pre-sized and never grow.** `buf[k]` is allocated from a
`CAP` table at init. A new kind of instance needs an entry in `B`, a slot in
`BATCHES`, a name in the `buf` list, a cap, and a zero in the per-frame `n`
counter reset. Miss the counter and it silently draws nothing; miss the cap and
it silently truncates.

**`BATCHES` has a seam.** Rig bones are spliced in at `BATCHES.indexOf(B.nest)`
so they draw between the buildings and the effects. It used to be a hard-coded
index and drifted twice. Do not put an index back.

**Nothing sits at a fixed height.** `gy(x,z)` returns the terrain height and
every draw site uses it. `PLAT` is the plateau constant, not the ground. Hard-
coding `PLAT` is how the nests ended up floating half a unit in the air across
the whole map.

**`spark()` uses `g` for the green channel.** Particle records are colour
records. Their ground height is `gnd`. Do not reuse single letters on those
objects without checking.

**Buildings live in `S.cells`, keyed `"gx,gz"`, and a multi-cell footprint has
one root plus references.** A cell with `.ref` points at the root; `rootOf(c)`
resolves it. Iterating `S.cells` without skipping `.ref` counts a town hall
nine times.

**A construction site is not a building.** `b.site` means materials on the
ground. Sites do not shoot, train, house, light, or accept repair, and each of
those is a separate guard in a separate loop. If you add a behaviour driven by a
building, ask whether a site should have it, and the answer is almost always no.

**Audio is layered, varied, placed and limited.** Every sound is a transient, a
body and a tail; nothing repeats without jitter on pitch, filter and timing;
everything carries a world position so the mixer can pan it, attenuate it and
dull it with distance; and everything shares one reverb and one soft ceiling.
A new sound that is one oscillator, at one pitch, dry and centred will sound
exactly like the thing this pass was undoing. `tools/audio.mjs` measures them.

**Every player-facing string lives in one table too.** `TEXT_DEFS` in
`d_core.js` defines it; `M.t(key, vars)` resolves it through the live overrides.
Static markup carries `data-t="key"` (or `data-t-ph` for a placeholder) and gets
filled by `applyText()`; anything composed at runtime calls `M.t()` at the point
of use. A def may carry `{placeholders}`, and dropping one is the failure mode
that hurts — the sentence still reads, it just has no number in it — so the Text
tab flags a missing one and `tools/text.mjs` sweeps the whole table. Building and
unit names come from the same table, which is why `TYPES[t].name` is assigned in
`syncText()` rather than written in the literal. **Never type a player-facing
string into markup or a template.** `node tools/text.mjs` walks every screen and
fails on one that no key owns.

**Every balance number lives in one table.** `STAT_DEFS` in `d_core.js` defines
it; `M.statsOf(id)` resolves it including live edits from the library; `syncStats()`
copies it onto `TYPES` / `UNITS` / `ENEMY`. The HUD reads the same table. Never
write a second copy of a number into a UI string or a simulation constant — the
in-game library edits these while a round is running, and a hard-coded duplicate
will not follow.

**Layout changes must set `S.distDirty`; anything the guest can see must set
`S.netCellsDirty`.** The flow field and the network cell list are both rebuilt
only on those flags.

**The guest never mutates the world.** In multiplayer, a guest action calls
`intent()` and returns; the host receives it in `applyIntent()` and runs the
*same* function a local click would. Current intents: `pl` place, `rm` remove,
`or` order, `jb` job, `fx` repair, `sh` shelter, `og` send out, `st` stance. A
new player action that changes the world needs an intent, a case in
`applyIntent`, and an ownership check — every case there re-verifies that the
target belongs to the sending player.

---

## Assets are data

Every building, unit and prop is a list of primitives in `d_core.js` — no
external models. Primitives: `box`, `wedge`, `gable`, `cone`, `cyl`, `ring`,
`quad`, `grid`.

A part is `{id, name, prim, p:[x,y,z], s:[…], shade, tint, ...}` where:

- **`p` is the base-centre, not the centre.** A box extends from `p[1]` *upward*
  by `s[1]`. This is why the worker's arm at `p[1]=0.46, s[1]=0.38` has its hand
  at 0.46 and its shoulder at 0.84.
- **`rot:[pitch, yaw, roll]`** rotates about that base point, applied roll → pitch
  → yaw. A bare `r:` is legacy shorthand for yaw only.
- **`anchorY:{to, mode, off}`** stacks a part on another's top by adding
  `p[1]+s[1]`. It knows nothing about rotation — on a tilted part it will place
  the child in mid-air. Position tilted children outright.
- **`rep`** repeats a part: `mirrorX`, `mirrorZ`, `mirrorXZ`, `linX`, `linY`,
  `linZ`, `ring`. Mirroring flips the yaw and roll it needs to.
- **`tint:1`** takes the asset's second colour slot; `col:` sets an absolute
  colour; `emit` / `ecol` make it a light source.

Units are split into bone batches by `RIGDEF`: `body`, `arm`, `armL`, `leg`,
plus a `gait` block. `armL` names a second left-hand bone — a soldier carries a
spear in one hand and a shield in the other, so each side needs its own mesh or
the weapon doubles.

---

## How to verify a change

The habit in this repo is to **measure, not eyeball**. Screenshots are for
judging how something looks; they are not evidence that it works. Nearly every
bug found here was found by reading numbers out of the running game.

**Run `node tools/smoke.mjs`, `node tools/instances.mjs` and
`node tools/campaign.mjs` after any change**, plus `node tools/text.mjs` for
anything that puts words on screen, `node tools/economy.mjs` for
anything touching salvage, workers or the map,
and `node tools/balance.mjs --ab id.key=value` for anything touching difficulty.
`tools/README.md` explains them; read it before writing a new one.

The build exposes `window.__hf = { show, game, lib, map, gl, settings, ... }`.
That is deliberate and is the whole test surface. `tools/harness.mjs` layers a
`window.__nw` helper on top of it. From either you can drive a round headlessly
with no input at all:

```js
__hf.show('play');
const G = __hf.game, S = G.state();
G.start(4242, null, null);                       // seed, map, opts
G.place('hall', HF.w2gx(0), HF.w2gx(0));
for (let i = 0; i < 30 * 20; i++) G.update(1/30); // 20 seconds, deterministic
```

Run it with Playwright against headless Chromium with SwiftShader — the harness
serves the repo itself, so a tool is one command:

```sh
npm install && npx playwright install chromium   # once
python3 src/build.py && node tools/smoke.mjs
```

Three techniques that keep the evidence honest:

**Read what the renderer is actually handed.** Wrap `__hf.gl.setInstances` and
capture the float arrays. This is how "the nests are floating" became "every
instance's Y against the terrain beneath it, 989 of them, zero below ground" and
how "the grid slides" became "21 cursor samples produced 9 grid positions, every
one an exact multiple of the 1.5-unit cell". Identify a batch by grabbing it off
a real `render()` call rather than guessing an index.

**Make the question falsifiable.** "Does a construction site shoot?" is only
answered by parking an enemy inside the tower's range, pinning the site
unfinished, and counting bolts — 0 while a site, 37 once built. An earlier
version of that test had the enemy 7.1 units from a 6.6-unit range and proved
nothing while appearing to pass.

**Beware circular tests.** The first grounding check compared a Y computed from
`T.h` against `T.h`. It passed and meant nothing.

Two traps that have each cost an hour: the player is eliminated mid-test and
`update()` stops simulating, so pin `hall.hp` when you don't care about survival;
and `S` captured before `G.start()` is a stale object.

**Balance changes get an A/B.** `node tools/balance.mjs --ab tower.dmg=20` runs
each seed twice through identical code, once with the shipped default and once
with the override. Construction times were shipped only after 12 seeds showed
7/12 either way — small samples on knife-edge configs swing wildly and will tell
you whatever you want to hear.

---

## Design intent

Some of this looks arbitrary in the code and is not. Please do not "fix" these
without talking to Jarrod first.

- **You cannot call the night early.** There is no ready button and no space
  bar. `startWave()` is reachable only from `nightfall()`. The day is a fixed
  budget you spend, not a phase you skip when you feel prepared.
- **Surviving a night is not winning.** `dawn()` hands you the next day. A round
  ends only when every hall is gone or every nest is, and each night you leave
  the nests standing the next one is bigger by a widening margin. Holding
  forever is not a strategy the game will let you have.
- **Difficulty changes the shape, not the numbers.** It sets how many nests ring
  you — 3 easy, 5 normal, 8 hard — and how many each sends on the first night.
  The wave is the sum of what the living nests send, so pulling one down is a
  permanent cut to every night after. There is no global wave counter to grow;
  `waveSize()` recomputes it from what is still standing. It is chosen on the
  setup screen before a round, not in Settings — it decides the shape of the map
  you are about to get, so it belongs with the seed, and changing it mid-round
  would mean nothing anyway.
- **The nests are the objective and the bank.** They are tough, they knit back
  together each dawn, they keep a standing garrison by day, and they wake
  defenders when hit. Their cache is the only income after the map is stripped,
  which is what makes pushing out the thing that pays for pushing out.
- **The commander walks to the hall and raises it.** Where you put your town
  costs you the time to get there, so the round opens with a decision rather than
  a click. Losing him only matters before the hall stands.
- **Everything is a construction site first.** Placement is not instant. This
  costs nothing when you build with time to spare — that is the measured result,
  not a hope — and bites only when you place at the last second. That is the
  tension it exists to create.
- **Night is not a spectator phase.** Every control works. Workers repair,
  units move, buildings go up.
- **Selling is only ever a hotbar button** with a structure selected. It is
  never a click on the world, because a misclick that deletes a tower mid-wave
  is unforgivable.
- **Attackers path, defenders steer.** The horde runs a Dijkstra flow field, so
  a wall's high path cost pushes them elsewhere and a gate's low cost invites
  them in — that is the whole tactical language of the wall system. Your own
  units steer directly and follow walls around obstacles, deliberately: a
  player's order should be obeyed literally rather than re-planned.
- **The HUD has fixed homes.** Supply top-left, selection panels bottom-left,
  worker/army counts bottom-right, minimap and clock top-right, build cards in
  the bottom dock. The dock is where the player's hand lives during a round and
  must not change contents under it — selection panels appear in the corner
  instead.

---

## Style

The comments in this codebase explain *why*, not *what*. They are written for a
reader who can see the code and wants to know what problem it solves and what
went wrong before. Match that. A comment that restates the line below it is
noise; a comment naming the bug the line prevents is worth its space.

All of it lives in `TEXT_DEFS` and is editable in the Library's **Text** tab
while a round runs — so a rewrite is a thing you try rather than a thing you
guess at, and this section says what to aim for rather than what to type.

**Prose in the UI is written from inside the settlement, in plain words.** Not
from a manual, and not from a fantasy novel either. Every word in it is one a
person would actually use — the immersion comes from *what is said*, not from
archaic vocabulary or invented proper nouns. "The last nest is cold" and "you
have not been out yet" are the register; "Round complete" is too flat and "the
Marrow is broken" is too much.

Three things follow from that:

- **A button says what the player is doing, not what the software is doing.**
  "Set out", not "Start the round". "Tear down", not "Sell". "Call it off" when
  the thing was never built, because cancelling work and demolishing a building
  are different acts and the word has to know which one it is.
- **A readout names the thing, not the data.** "Massing 520" and "Still coming
  47" are the same numbers as "Coming" and "Enemies left" and cost nothing to
  read, but they say what the number *is*. Anything the player scans mid-fight
  still has to parse in one glance — that constraint wins over flavour every
  time, and it is why the stat lines are still Health / Damage / Range.
- **Errors stay exact.** Flavour goes in the framing, never in the diagnosis. No
  error message contains a stack trace, an internal state name, or the word
  "invalid" — and none of them gets dressed up either. "That reply was written
  for a different invite" is the whole job.

When a button is renamed, grep for the name: several messages quote button text
back at the player ("press Set out together"), and a rename that misses one of
those is worse than not renaming it.
