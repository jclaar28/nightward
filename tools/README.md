# tools

Headless checks that run the real game and read numbers out of it.

There are no unit tests here and there probably shouldn't be. Almost every bug
worth catching in this codebase is a bug in what ends up on screen or in how the
simulation evolves, and neither is visible from a function signature. What these
do instead is drive an actual round in a headless browser and assert against
measurements — the float arrays the renderer is handed, the state after a known
number of simulated seconds.

## Setup

```sh
npm install                 # playwright
npx playwright install chromium
```

Each tool builds nothing and serves itself, so this is the whole loop:

```sh
python3 src/build.py
node tools/smoke.mjs
```

They exit non-zero if any check fails, so they work in a shell or in CI.

## What each one does

**`smoke.mjs`** — run this after any change. Plays a round end to end: the
commander raises the hall, one of every building goes up as a construction site
and finishes, a barracks musters nobody until it stands, an unbuilt tower fires
nothing while a built one fires, and the night draws a real frame.

**`instances.mjs`** — the rendering checks. Captures every instance for one
frame and asserts against it: nothing anchored is drawn below the terrain it
stands on, the nests sit on their own ground rather than the plateau, the build
grid locks to exact cell multiples instead of sliding with the cursor, and a
blocked ghost answers in hue rather than brightness.

**`campaign.mjs`** — the round loop. A night is not the end of anything, so
these drive several full day/night cycles: dawn hands you the next day, the
night counter advances, each wave is bigger than the last by a widening margin,
losing every hall ends it, clearing every nest wins it and pays its cache, and
the nest garrisons chase what comes close without leaving home or eating your
workers during the day.

**`economy.mjs`** — how much a day pays and how long the map lasts. Plays a
settlement out day by day with workers on the nearest live pile and cottages
bought as they become affordable, then reports income per day, when the piles
run dry, and what the nest caches add. Use it whenever you touch salvage,
gather rate, carry, or the map size.

```sh
node tools/economy.mjs --days 10 --seeds 3 --diff normal,hard
```

**`balance.mjs`** — plays a full day and holds a night, across seeds and
difficulty sizes. `--nights N` plays out that many, which is the meaningful
measure now that surviving one only buys you the next.

```sh
node tools/balance.mjs                          # the current ladder, mid build
node tools/balance.mjs --waves 400,600,850
node tools/balance.mjs --build strong,gated,mid,thin --seeds 12
node tools/balance.mjs --nights 12               # how deep a build gets
node tools/balance.mjs --nights 12 --kill 2      # ...if it also clears 2 nests
node tools/balance.mjs --ab tower.dmg=20         # that stat vs stock, same seeds
```

`--ab id.key=value` runs each seed twice, once with the shipped default and once
with the override, through identical code. Use it for anything that touches
difficulty.

`--kill N` pulls N nests down after the second night. The harness cannot micro
an army across the map, but the thing that matters downstream is the wave being
smaller, and that it can model honestly. It is the only way to measure the
intended winning line rather than the turtle.

The harness also spends every morning's income on more guns. A frozen defence
answers the wrong question — it measured 3 nights where a growing one measures
5, and the whole design depends on the difference.

## Writing a new one

`harness.mjs` gives you `open()`, `check(label, ok, detail)` and `done(errors)`,
plus a `window.__nw` helper inside the page on top of the build's own `__hf`
surface:

| call | what it does |
|---|---|
| `__nw.start(seed)` | show the play screen and start a round |
| `__nw.run(seconds)` | step the simulation deterministically at 1/30 |
| `__nw.hall(x,z)` / `__nw.place(type,x,z)` | place in world coordinates |
| `__nw.at(x,z)` | the building at a world point, resolved to its root |
| `__nw.roots()` | every building, references skipped |
| `__nw.invincible()` | pin every building's HP |
| `__nw.frame()` | `{counts, rows}` — every instance drawn this frame, tagged by batch name |
| `__nw.ground(x,z)` | terrain height under a point |

Four things that have each cost real time:

**Isolate the thing you are measuring.** The first version of the "does a site
shoot" check ran on a board where a ballista and a second tower were also
firing, and credited every shot on the map to the building under test.

**Make sure the question can fail.** An early version of that same check had the
nearest attacker 7.1 units from a 6.6-unit range. It passed and proved nothing.
Assert the setup, not just the result — `instances.mjs` checks that its "legal"
and "blocked" ghost positions really are legal and blocked, because an earlier
version compared two blocked ones and reported no change as success.

**Watch for circularity.** The first grounding check compared a Y computed from
`T.h` against `T.h`.

**Keep the round alive.** If the town falls, `update()` stops simulating and
everything after that measures a frozen world. Call `__nw.invincible()` when
survival isn't what you're testing. And never capture `S` before `start()` — it
is a different object afterwards.
