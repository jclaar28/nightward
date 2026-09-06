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

It also counts the gait: legs once per stride, body twice — one rise per foot
planted. That ratio is invisible in a screenshot and unmistakable in motion, and
it shipped wrong (four bounces per stride, from `abs(cos(2*ph))` doubling an
already-doubled rate). Two setup mistakes are worth copying the fix from: the
first version measured on this file's busy scene, where a wave has the units
walking and swinging on their own, and read 1.49 leg cycles per stride from
three sources of movement at once; and it counted raw body Y, which includes the
terrain under the unit, so a 0.055 bob was lost against a hillside. It runs its
own quiet round now and measures height above the ground.

And it checks that rings sit on the ground. Every ring in the game — selection,
rally, tower range, brazier aura, the move marker's pulse — used to be a single
flat annulus at the height of its own centre, so on a slope half of it was
buried and half hung in the air. They are runs of grounded chips now, and this
measures every chip against the terrain directly beneath it. Note what the check
does first: it hunts the map for the roughest ground it can find and stands the
commander there. Measured on the flat plateau where the hall usually goes, the
old code passes and proves nothing — confirmed the other way too, the check
reports 29 of 52 segments below ground against the flat version.

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

A queued road is a thing the player can see, pick and call off, so the second
half checks that: the whole run is staked from the moment it is ordered rather
than only as far as it is built, a click on the line picks it and one beside it
does not, picking a road and picking a building put each other down, and calling
one off takes the edge, its orphaned nodes and its speed bonus with it while
telling the routing the network moved. A separate seat is refused, because
`applyIntent` runs the same function a local click runs and without the
ownership check a guest could scrap the host's network.

One of those checks is there because the other one was not enough. "The marks
are drawn" and "the marks can be seen" are different claims: the first pass
staked the whole run in a dark grey the same value as the stones scattered on
the grass, every mark reached the buffer, and a count-only check passed while
the feature was invisible on screen. So the stakes are also measured against the
surface of a laid road, and a screenshot was read before it was called done.

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

**`scout.mjs`** — the scout, and the vision rule that gives it a job. The scout
is the first unit whose whole value is information, and information is the
easiest kind of feature to ship broken: it looks finished because the unit walks
around, and nobody notices the minimap is still telling you everything it always
did. So most of these checks are about what you *cannot* see — an attacker
nobody is looking at is off the map, a scout sent out puts it back on, and a
worker standing in the same spot cannot.

It also covers the first building that musters two kinds of unit. That path was
`spawns` + `cap` with the retrain loop counting the whole garrison, which is
wrong twice over once a hall owes both workers and a scout: three workers would
read as full, and a dead scout would come back as a worker. Both are checked.

Its cost check was weak first and is worth copying the fix from. It timed the
mask against the fifteen attackers a first wave happens to have while the
comment claimed a late night — timing the cheap case and quoting it as the
expensive one is how a performance check passes for years and then does not. It
now builds a 900-attacker field and a real settlement's worth of watchers.

**`fog.mjs`** — what the map hides, what it remembers, and what it must never
hide. Fog has one failure mode that looks exactly like success: the picture goes
dark, everything appears to work, and the thing you meant to hide is still on
screen at a lower brightness. That is not hypothetical — the first pass here
dimmed attackers instead of culling them, and at a gentler setting a nest in
unexplored ground was plainly readable in the screenshot. So every check counts
instances rather than sampling pixels: an attacker nobody can see is not merely
dark, it is not in the buffer.

The split it defends is places against things. A nest, a pile or a building you
have found stays drawn after you leave; an attacker, a corpse or the other
player's units go with the sight. It also checks the one that would read as a
bug rather than a rule — your own units are drawn wherever they are, because
they are the eyes — and that the `fog.on` switch actually restores the map,
since a feature with a broken off-switch is one nobody can bisect against.

Note that `instances.mjs` turns fog off for its whole run. Everything that tool
asserts is geometry, and fog answers a different question; leaving it on did not
make those checks stricter, it emptied them — the nest-grounding checks started
reporting "drawn []" because an undiscovered nest is correctly not drawn, and a
check with no subject is worse than no check.

**`turret.mjs`** — the turret pokes three holes in assumptions the rest of the
code makes, so each is measured. It is the second thing a worker builds with
their hands rather than a timer (checked by putting every worker indoors and
across the map, where a timer would tick anyway). It is the only building that
may be placed onto something already standing — onto your own palisade, never
onto a gate, and nothing else onto anything. And its garrison is units you put
there rather than units it makes, which is a different mechanic from the
barracks' and must not share the `inside` flag.

The check that carries the feature is the range one, and it is built to be
falsifiable: it parks an attacker between an archer's own range and the
turret's, asserts the target really is in that gap, then fires the same archer
at it from the platform and from the same spot on the ground. 18 arrows against
0. Measuring "it shot something" from up top alone would pass with the bonus set
to zero.

**`decals.mjs`** — the marks on the ground, and the one bug in them that no
instance count could ever have caught. Every ring in the game was geometrically
perfect and looked wrong anyway: the chips were opaque, so the ink pass found a
depth and normal discontinuity at each one and drew a crisp black outline around
it, and a ring came out as a chain of beads. `instances.mjs` had been measuring
those same chips for weeks and had nothing to say about it, because what was
wrong happened after the instances were handed over.

So this reads pixels. It renders the frame twice, once with a mark and once
without, and compares: a mark that adds light must only ever make the picture
brighter, and an outline is a darker pixel. There is no other way to see one.
Its counterpart is the contact shade under a selected unit, which must make
pixels darker — that is what stops "nothing got darker" from passing by drawing
nothing at all.

It also measures the invariant that makes a run of chips a line rather than a
row of dots: each one fades to nothing at both ends, so consecutive chips
cross-fade and sum to what either carries alone, but only while the ramp is as
long as the gap. Chip length against neighbour spacing is that number, it is one
multiply in `groundRing`, and nothing on screen names it. Left at a fixed scale
it reads 24.9% out.

Read the note above the pixel checks before adding one. The first version
selected the hall and then a unit standing next to it — a hall is a 3x3 footprint
spanning 2.4 units either way, so both marks were inside the building and every
pixel of them was occluded. It reported no darker pixels, which is exactly what
a working decal pass reports.

Checked by breaking the change four ways: put the ring batch back in the opaque
list (4 failures, one of them "5193 pixels went darker, worst by 116/255" —
which is the outline, measured), make the contact shade additive (2), drop the
chip scaling (1), and put an indicator colour back over 1.0 (1).

**`select.mjs`** — what picks things up and what puts them down. Selection is
touched on every click of a round and almost all of its rules live in an input
handler, where which button means what depends on what is held, picked and
selected at that moment. So this dispatches real `PointerEvent`s and
`KeyboardEvent`s at the canvas rather than calling the handlers: the branch
order in `up()` is the thing under test, and calling `deselectAll()` by hand
would skip exactly the part that can be wrong.

The two rules it holds down are that a right-click is a dismissal only when
there are no troops to give an order to — a building and a worker selected
together means the click is an order and the panel stays — and that Escape lets
go before it opens the menu. The awkward case is a house full of people: the
right-click turns them out *and* keeps the panel, which is why the deselect
branch is checked last. It also keeps the opposite failure honest, that "escape
deselects" must not become "escape does nothing": with an empty cursor and an
empty selection the menu still opens.

Its one piece of setup worth copying: the open ground it right-clicks on is
found, not assumed. The camera is wherever the round left it, so it sweeps
screen points with `pointermove` and reads `S.hover` — asking the game what is
under the cursor rather than redoing the projection by hand.

Confirmed falsifiable by reverting each half in the built file: without the
right-click branch, 1 failure; without the Escape branch, 4.

**`net.mjs`** — the two-player path, which had no cover at all and is the
riskiest thing to leave that way: a regression here is silent. Nothing throws,
no frame looks wrong, and it is only discoverable by two people at two machines
failing to start a game. It runs two pages in one browser and drives the real
screen — presses Create invite, carries the code across by hand the way a player
carries it over chat, pastes the reply back, presses Connect and then Set out —
because the buttons and their disabled states are half of what has broken here
before. Then: both sides built the same ground from the seed, a guest click
changes nothing on the guest and reaches the world by way of the host, a guest
cannot pull down the host's hall, a road dragged and called off by the guest
travels both ways, and the two worlds hold the same units in the same places.

Three things it needs that are not obvious. Chrome hides local IPs behind
`.local` mDNS candidates, which never resolve in a sandbox, so two pages gather
candidates neither can use and the handshake times out looking healthy —
`openMany(2, {webrtc:true})` turns that off. Only one of two tabs is frontmost
and Chrome throttles the other's frame loop to about 1fps, which stalls whichever
side is the host; the same launch adds the three backgrounding flags. And every
round trip polls rather than sleeping, because a fixed wait that works here is a
flake on a busier machine.

It was checked by breaking the netcode three ways and confirming each break
fails the right line: stop the host shipping snapshots (7 failures), let a guest
mutate its own world (1), drop the invite-id guard (1). Worth repeating on any
test you add here — the first version of "host and guest hold the same units"
compared counts, and the guest builds the same starting world from the same seed
whether or not a single packet arrives, so a dead channel passed it. It compares
positions now, and separately asserts they are not where the guest first drew
them.

```sh
node tools/net.mjs        # ~40s, two browsers, a real peer connection
```

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
surface. `openMany(n, {webrtc})` is the same thing with several pages that can
reach each other — see `net.mjs` for what that costs in launch flags.

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

**Do not assume a spot is buildable.** The seed changes every run, and a cell
that is fine on one map is inside a nest's exclusion zone on the next. A refused
placement and a broken feature look identical from the outside — "the building
never appeared" — so search for a legal cell with `HFGAME.canPlace(t,gx,gz,p)`
and assert you found one, rather than hard-coding an offset and inheriting a
flake that only shows up on a seed you never ran. This cost two rounds of
chasing the wrong thing in `net.mjs`, once for a cottage and once for a hall.

## Not a check

**`roster.mjs`** — writes `ROSTER.md`, every unit and structure with the
numbers the game actually resolves, split into yours and theirs. It exists as a
generator rather than a document because a hand-written roster is a second copy
of every value in `STAT_DEFS`, which is the one duplication this codebase is
strict about: the in-game library edits those while a round runs and a copy does
not follow. Re-run it after any balance change. The prose in it comes from the
assets' own `note` fields, which were already written to say what each thing is
for — the first draft printed the derived figures underneath those notes as
well, and a table row followed by the same numbers in a lowercase fragment reads
like a leak, so everything derived now lives in a table column instead.

```sh
node tools/roster.mjs            # rewrites ROSTER.md
node tools/roster.mjs --print    # to stdout
```
