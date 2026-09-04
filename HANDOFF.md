# Nightward — handoff

Tyler: this is the orientation document. It is written for you, not for your
Claude — point it at [`CLAUDE.md`](CLAUDE.md) instead, which holds the rules and
invariants it needs to not break things.

The short version: Nightward is a settlement-defence game, roughly *They Are
Billions* in shape, written as raw WebGL2 in a single self-contained HTML file.
No engine, no framework, no dependencies, no build step beyond one Python
script. You can open `nightward.html` from disk and play it.

---

## Getting to a running game

```sh
git clone https://github.com/jclaar28/nightward
cd nightward
python3 src/build.py        # writes nightward.html
```

Then open `nightward.html`. That is the whole setup — there is nothing to
install and no server needed for single player.

For the two-player lobby, serve it over http rather than opening the file
directly — that's the only way it's been tested:

```sh
python3 -m http.server 8899   # then http://127.0.0.1:8899/nightward.html
```

**Edit the modules in `src/`, never `nightward.html`.** It's a build product.

---

## The five-minute tour

The map is a 120-unit grid — 80 cells of 1.5. You start with a commander and a
small purse. You place the
town hall, he walks to it and raises it, and it musters two workers. Six minutes
of daylight: workers strip salvage piles, cottages compound the workforce, and
you spend the proceeds on walls, towers and troops. Two minutes of night: the
nests empty and come for the hall.

Holding until dawn buys you the next day, not a win. The round ends when every
town hall is gone or every nest is — and each night you leave the nests
standing, the next one is bigger by a widening margin, so turtling loses slowly.
The map's salvage runs out on the first day; after that the only income is the
cache inside a nest, so the thing that pays for pushing out is pushing out.
Nests are tough, they keep a garrison by day, they wake defenders when you hit
them, and they knit back together every dawn — a nest has to come down in one
committed push, with your town left behind you.

Where the code lives:

| module | what it owns |
|---|---|
| `d_core.js` | palette, asset definitions, terrain generation, the balance table |
| `d_gl.js` | the renderer — instancing, cel shading, shadow maps, ink outlines |
| `d_snd.js` | synthesised audio; no audio files exist |
| `d_game.js` | simulation, pathing, input, and the per-frame instance packing |
| `d_lib.js` | the in-game library — edit any asset or balance number live |
| `d_map.js` | the map editor |
| `d_net.js` | the two-player peer connection |
| `d_app.js` | screens, HUD, settings |

`d_game.js` is where most of the work happens and it's the biggest file. The two
functions worth reading first are `update(dt)` and `pack()` — the simulation
step and the routine that turns the world into instance buffers.

---

## Four ideas that explain most of the codebase

**Assets are data, not meshes.** Every building, unit and prop is a list of
primitives with positions, sizes and a shade. Nothing is modelled in an external
tool. The in-game library (main menu → Library) lets you select any part of any
asset and drag it around while the game runs, which is how all of it was built.
If you want to change how something looks, that's the place to start, and
`CLAUDE.md` has the part-format details.

**One draw call per kind of thing.** Everything is instanced through a
twelve-float stride. Hundreds of attackers cost a single draw. Limbs are
separate bone batches driven by a per-instance pitch value — that's how a horde
walks without a skeleton per body.

**The balance table is the only source of truth.** Every number — hit points,
reload, range, build time, gather rate — is defined once in `STAT_DEFS`, edited
live from the library, and read from that table by both the simulation and the
HUD. There is deliberately no second copy anywhere. If you add a stat, add it
there and let it flow.

**So is the text table.** Every word the player reads is a key in `TEXT_DEFS`,
and the Library has a **Text** tab beside **Models** that edits all of them
live: type in a field and the HUD behind it changes, in a running round. Edits
persist in your browser, "Copy text edits" gives you a block to paste back into
`d_core.js`, and "Revert all text" puts the shipped words back. Building and
unit names are in there too, sharing one string with the Library's name field
rather than keeping two that drift. Nothing in the markup holds a literal — the
HTML carries `data-t="key"` — so if you want to try a different voice for the
whole game, you can do it without touching code, play a round in it, and only
then decide whether to paste it back.

---

## How we work

The habit worth adopting: **measure rather than eyeball.** The build exposes
`window.__hf` specifically so a headless browser can drive a full round with no
input, and nearly every bug found so far was found by reading numbers out of the
running game rather than by looking at it.

That is what `tools/` is:

```sh
npm install && npx playwright install chromium   # once
npm run check                                    # build + smoke + instances
```

`tools/smoke.mjs` plays a round end to end. `tools/campaign.mjs` drives several
day/night cycles and both endings. `tools/instances.mjs` captures every
instance the renderer is handed for one frame and asserts against it.
`tools/balance.mjs` plays a full day and holds a night across seeds, with an
`--ab` mode for comparing one stat against stock. `tools/text.mjs` walks every
screen and fails on a word that no text key owns. `tools/README.md` covers
writing new ones and the traps worth knowing.

A worked example. "The nests are floating" could have been fixed by nudging a
constant until it looked right. Instead: terrain height at each nest was −0.17
and −0.49 against a hard-coded 0.3, so the drift was 0.47 and 0.79 units;
`gy(x,z)` replaced the constant at ~30 draw sites; then the renderer's instance
upload was hooked and every Y it received was checked against the terrain
beneath it — 989 instances, zero below ground, both nests landing exactly on
their terrain height. That's the standard. `CLAUDE.md` has the technique and the
traps.

Balance changes get an A/B on the same seeds with one variable switched. Small
samples lie: a config that looked 5/5 versus 2/5 came back 7/12 versus 7/12 when
run properly.

---

## Where it stands

**Working and verified.** Full day/night cycle. Commander, workers, soldiers,
archers, all animated. Walls, gates, towers, ballistae, braziers, barracks,
archery ranges, cottages. Construction sites. Repair, shelter, stances. Salvage
economy. The map editor and the live asset/balance library. Two-player rounds
over WebRTC with the host and guest in exact agreement — measured drift of zero.

**Rough or unfinished.**

- *The difficulty curve is tuned but thinly sampled.* Measured on three seeds
  with a defence that spends every morning's income: a player who never leaves
  the walls dies around **night 5**; clearing one of five nests reaches **8.7**;
  clearing two holds all **12**. That is the shape the design wants — holding is
  not a strategy — but the harness kills nests for free, so the real curve sits
  between the one-nest and two-nest lines. Worth re-running with more seeds, and
  worth checking that an assault is actually affordable in troops.
- *Nest count scales with difficulty, and so do the caches.* Hard rings you with
  8 nests, which is both far more danger and 8 x 320 supply of reward. That may
  want a per-difficulty cache; nobody has measured it.
- *The multiplayer invite code is ~855 characters.* It is the WebRTC session
  description itself, so a short code would need a rendezvous server. Jarrod
  decided to leave it alone rather than take on infrastructure — worth knowing
  before you propose shortening it.
- *No music.* The sound effects have had a full pass — layered, varied, panned
  and attenuated by distance, through a shared reverb and limiter, with an
  ambient bed that crossfades day to night — but there is no score.
- *No meta-progression.* Each run is standalone. The original concept had a
  rogue-lite layer between runs; nothing of it is built.
- *Single map size, three difficulties.* No campaign, no scenario structure.

**Deliberately left alone.** The design decisions listed under "Design intent"
in `CLAUDE.md` — no calling the night early, the commander walking to the hall,
selling only from the hotbar, defenders steering rather than pathing. They look
like oversights in the code and aren't. Please raise them with Jarrod before
changing any of them.

---

## Working in parallel

We're two people on one small repo, so the seams matter more than the process.

The cleanest places to work independently:

- **`d_core.js` assets** — adding or reshaping a building or unit touches one
  array entry and nothing else.
- **`STAT_DEFS` balance** — numbers only; conflicts are trivial to resolve.
- **`d_map.js`** and **`d_lib.js`** — largely self-contained tools.
- **`d_snd.js`** — nothing else depends on its internals.
- **`tools/`** — adding a check touches nothing the game reads.

The places to coordinate before starting:

- **`pack()` in `d_game.js`** — every draw goes through it and it's a long
  function; two people editing it will conflict.
- **`d_shell.html` + `d_app.js` HUD** — markup, CSS and wiring are three files
  apart for one visual change.
- **The instance batch list** — adding a batch touches five places at once (see
  `CLAUDE.md`), and two people doing it simultaneously will both be wrong.

Rebuild and commit `nightward.html` with your source changes. It's checked in
deliberately so the repo is playable without a build, which does mean it
conflicts on every concurrent edit — take either side and rerun
`python3 src/build.py`, since it's generated and the sources are what matter.
