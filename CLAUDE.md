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

**One building can muster more than one kind of unit.** `spawns` plus `cap` was
a single kind for a long time and the retrain loop counted the whole garrison
against one number. The hall musters workers *and* a scout, so that shape is
gone: `rosterOf(type)` returns a list of `{t, n}`, `shortOf(b)` says which kind
the building owes, and the retrain loop asks. Counting the garrison as a total
again would make a hall with three workers read as full, and a dead scout come
back as a worker.

**Fog dims places and culls things.** A building, a nest or a salvage pile you
have found stays drawn once you leave — that is what "explored" means, and the
shader greys it rather than hiding it. Anything alive gets culled outright:
attackers, corpses, the other player's units. Dimming something that moves does
not hide it — a dark silhouette crossing a dark field is still a silhouette, and
at a gentler `fog.dark` it is plainly readable. `tools/fog.mjs` counts instances
rather than sampling pixels for exactly this reason: "it went dark" and "it is
not in the buffer" are different claims and only one of them is hiding.

**Your own units are never fogged.** They are the eyes. A unit that vanished
because it walked out of its own sight would be a bug wearing a rule's clothes.

**Fog is a texture, not a per-instance flag.** `fogStep()` writes one byte per
cell — 0 never seen, 128 seen before, 255 in sight — and `R.setFog()` uploads
it; `FS_COMMON` samples it by world XZ. That is what makes the boundary a smooth
curve instead of a staircase of 1.5-unit cells, and it is why terrain, props,
buildings and units all obey fog without a single draw site knowing it exists.
The emissive early-out and the ink outline pass both had to be taught about it
separately — a lamp that skips the fog glows across a black map, and the outline
comes from depth and normals, neither of which knows anything. The fog level
rides in the normal buffer's alpha for the outline's sake.

**Sight is one number per thing, and everything downstream reads it.**
Everything you own has a `sight` in the balance table; `visionMask(pid)` stamps
those into a byte grid and both the fog and the minimap are built from that one
grid. There is no second notion of "can see" anywhere — if you add one, the
minimap and the world will disagree about what is visible and only one of them
will be wrong in a way anybody notices. `tools/scout.mjs` and `tools/fog.mjs`
check the two ends of it.

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

**A road is not a building and must never reach `S.cells`.** Roads are the one
thing the player places off the grid: nodes at free positions in `S.roadN`,
edges in `S.roadE`. `TYPES.road.road` is `true` and every piece of cell code
checks it — `canPlace` refuses it outright, the ghost and grid skip it, and a
click does nothing because a road needs two ends. Putting one through the cell
path would quantise away the only thing it has that a building does not.

**Roads must stay invisible to the flow field.** Not a lower path cost, not a
tiebreak. `roadSpeed()` is called from `stepToward` and `stepToBuilding` only,
both of which are reached solely from the player's own unit code; the attacker
loop moves off `m.spd` and never consults it. A road that reaches the field is
a highway to your hall, and it would read as a pathing bug rather than a design
mistake. `tools/roads.mjs` diffs the field with and without roads present.

**Anything that lies on the ground and is bigger than a cell has to be many
instances.** One instance carries one transform, so a mesh cannot bend over
terrain: a flat annulus placed at `gy()` of its own centre buries its uphill
half and floats its downhill half, which is what every range ring, aura,
selection ring and move marker used to do. `groundRing()` lays a run of
`ringchip` segments, each sampling `gy()` where it lands, spaced finer than the
1.5-unit terrain cell so the run cannot step over a ridge. The same rule already
governs roads and is why they are pads rather than one long quad. A consequence
worth remembering: the instance count is now set by how much the player built,
so it gets the same cap check roads get.

**A gait is two rates off one phase.** `u.ph` advances with distance walked.
The legs swing once per stride — `sin(ph)` — and the body rises once per foot
planted, which is twice per stride, which is `abs(sin(ph))`. The sway is the
weight going side to side, once per stride, so it is `sin(ph)` too. `cos(2*ph)`
already runs at twice the stride and `abs(cos(2*ph))` runs at four times: that
shipped, and it read as a rapid jitter with no relationship to the feet. It is
invisible in a screenshot and unmistakable in motion, so `tools/instances.mjs`
counts peaks per stride rather than anyone looking at it.

**A road's worn look is hashed, never random.** The meander, the pad scatter
and the verge gravel all come out of `padHash(a,b,i,salt)`. `pack()` runs every
frame, so `Math.random()` there would redraw the noise 60 times a second and
the whole network would boil — which looks deliberate in a screenshot and awful
in motion. The same rule holds for anything else decorative drawn per frame.
`tools/roads.mjs` compares two frames three seconds apart.

**A queued road is a promise you can see, pick and take back.** The whole run
is staked from the moment it is ordered, not just the part that is finished —
staking only as far as the progress mark meant a road you had just ordered drew
a single dot, and you could tell something had happened but not what you had
asked for. The marks are chalk-pale on purpose: an earlier pass drew them in the
same dark grey as the stones already scattered on the grass, so every mark was
in the buffer and none of them could be seen. Anything drawn flat on the ground
here has to beat the ground litter on value, not just exist.

**Road work is the only construction that needs a worker.** Every other site is
`prog += dt` and finishes whether anyone came; a road edge advances only while
a worker stands on it. That asymmetry is the feature — it is what makes the
cost of a road the workers who are not gathering — so do not "fix" it into a
timer for consistency.

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
`or` order, `jb` job, `fx` repair, `sh` shelter, `og` send out, `st` stance,
`rd` road. A
new player action that changes the world needs an intent, a case in
`applyIntent`, and an ownership check — every case there re-verifies that the
target belongs to the sending player. `tools/net.mjs` runs two real browsers
over a real peer connection and aims a guest's intent at the host's hall; add
your new intent to it, because nothing else in the repo will notice when this
breaks. Intents added since: `rx` cancel road.

**A road is named by its two node ids, never by an index or an object.** The
guest rebuilds `S.roadN` / `S.roadE` wholesale out of every snapshot, so an edge
object held anywhere outside those arrays points at a discarded object one
packet later — which is why `S.rsel` and `S.rhover` store `{a,b}` and resolve
through `edgeAB()`. An index is worse: it would mean a guest cancelling whatever
road happened to slide into that slot.

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
anything that puts words on screen, `node tools/roads.mjs` and
`node tools/pathing.mjs` for anything touching roads, movement or worker jobs,
`node tools/economy.mjs` for
anything touching salvage, workers or the map, `node tools/scout.mjs` and `node tools/fog.mjs` for
anything touching sight, fog, the minimap or who a building musters, `node tools/net.mjs` for anything
touching intents, the snapshot or the two-player screen,
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
- **The destination is literal; the route is not.** A right-click names a place,
  and the unit goes to that place — not to somewhere near it, not to whatever
  the game thinks you meant. How it gets there is the game's problem: it rounds
  buildings, takes a gate rather than leaning on the stones, and runs the road
  when the road is quicker. If a route exists the unit walks it however long it
  is; there is no detour cap, because a unit that gives up and grinds on a wall
  is the failure this replaced. The literal half still has teeth — ordered
  across a road corridor the unit crosses it rather than turning down it, and
  breaking *that* during a night, when someone points at a gap in the wall, is
  what the rule exists to prevent. `tools/pathing.mjs` measures both halves.
- **The horde does not path, and defenders do not flow.** Two separate systems
  on purpose. The horde runs a Dijkstra flow field, so a wall's high path cost
  pushes them elsewhere and a gate's low cost invites them in — that is the
  whole tactical language of the wall system, and it is rebuilt once for the
  whole army. Player units run A* per order, which is affordable only because
  a player issues a handful of orders a minute. Do not merge them: a flow field
  that knows about roads is a highway to your hall, and A* per attacker is a
  hitch every night.
- **A soldier closing on an enemy still steers.** `stepPath` is for the march;
  the last few units onto a moving target are a straight line. Routing at a
  target that moves every frame would be a search per soldier per frame and buy
  nothing. The split is the `engaging` branch in the military loop.
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
