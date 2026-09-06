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

**`text.mjs`** — every word on screen comes from `TEXT_DEFS`, and that property
is invisible in review: a hard-coded label looks identical to a routed one. So
this walks the live DOM on every screen and fails on any text node whose shape
no key produces, then drives the Library's Text tab for real — types into a
field, checks the HUD changed, reloads and checks it stuck, reverts and checks
every word went back. Two of its checks earned their keep immediately: comparing
a filled-in readout ("3 nests") against the raw template ("{n} nests") reported
every composed string as unkeyed, and joining an element's text nodes together
blamed a card built from three keyed fragments for the concatenation of them.
Both now compare per text node against the template's *shape*.

**`roads.mjs`** — roads are the first graph in a game of cells, the first thing
workers build with their hands, and the first thing that changes how fast a unit
moves; each can be wrong while looking fine. Checks that a near-miss endpoint
joins an existing node rather than twinning it, that an unattended road makes no
progress where every other site would tick anyway, that a finished road really
does shorten a trip in seconds, that a direct order still crosses a road instead
of turning down it, and that the flow field is byte-identical with roads
present.

It also checks the buffer cap against a network far bigger than anyone would
build — 40 full-length edges in a spoked web draw 2895 pads against a 5200 cap.
Roads are the only thing whose instance count is set by how much the player
decides to build, and "miss the cap and it silently truncates" is a documented
failure mode here, so the headroom is measured rather than assumed.

It also compares two frames three seconds apart: the worn look of a road is
scatter, and scatter drawn from `Math.random()` inside `pack()` would be redrawn
every frame and the road would boil. Hashing the noise off position is the fix
and this is the check that keeps it.

Two of its checks were weak first and are worth copying the fix from. The trip
it measured ran along a dogleg, which only wins ~10% because the extra distance
eats the bonus — true, but a bonus halved by accident would still have passed,
so it now also measures a road laid along the route, where the whole 35% is on
the table. And "the ordered unit strayed 0.00u sideways" is exactly what a unit
that never moved would report, so it now asserts the trip was actually made.

**`pathing.mjs`** — your own units, and whether they get where you sent them.
Drives one soldier through the three shapes that used to defeat reactive
steering — a building squarely in the way, a wall with a single gate, a
three-sided pocket — and then the two rules the search must not break: an order
across empty ground is still a straight walk, and the horde's flow field never
learns any of it. It closes by ordering twenty units through a solid wall on one
frame, because A* per order is the price of all of the above and a whole army
ordered at once is the worst case a player can actually create.

Read the `startOk` assertion before writing a case here. The town hall is a 3x3
footprint at the origin spanning ±2.4 units, A* correctly declines to search
from inside a building, and the fallback is a straight walk — so a start planted
in the hall turns a pathfinding test into a steering test that still reads like
a pathfinding test. That mistake produced three failures the code did not have
and one pass it did not deserve. The same trap sits in `roads.mjs`, where a walk
timed from the origin measured nothing at all.

Fixing those setups is what surfaced the real bug: workers had been routed and
soldiers had not, so an ordered squad still could not leave a walled yard. The
check had been passing the wrong thing and failing for the wrong reason at the
same time.

**`audio.mjs`** — renders every sound offline and measures it. "It did not
throw" is not a test for a sound: it has a level, a length, a weight and a
stereo position, and every one is a number you can be wrong about. Checks that
nothing is silent or clipping, that a heavy impact really does carry more
energy under 180 Hz than a light one, that no sound repeats itself sample for
sample, that pan and distance work, and that a night-sized volley stays under
the ceiling.

```sh
node tools/audio.mjs --report   # the measurements as a table
```

Two of its own metrics were wrong before the sounds were: counting zero
crossings across a whole buffer measured the noise under a decayed tail, and an
absolute end-threshold made a quiet distant sound look shorter than the loud
near one it came from. Both are now relative to the sound's own peak.

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
measure now that surviving one only buys you the next, and `--kill N` stands
in for a player who actually mounts assaults.

`--waves` was inert for a while and worth knowing about: it set `S.wave`, which
stopped being read the moment the wave became `liveNests() * send * ramp^n`.
Three "wave sizes" ran the identical config and the spread between them was
seed noise — a test that appeared to vary something and did not. It now sets
the per-nest send so the first night really is the size you asked for. If you
add an axis here, check it moves the number before you trust a ladder.

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
