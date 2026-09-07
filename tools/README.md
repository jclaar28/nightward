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

**`terrain.mjs`** — whether the ground is a field or a chequerboard. The map is
40,000 quads of 1.2 units and every one of them used to take a single colour and
a single face normal, decided from values two neighbouring quads worked out
independently. That is a property of the mesh rather than of a picture, so it
can be measured exactly: every point that more than one quad touches must carry
one colour and one normal. Reverting to a colour per cell reports 199,216 of
199,599 shared corners disagreeing; reverting to face normals reports 197,796
and a 10.8° argument with the height field about which way the ground faces.

The check that took three attempts is "there is still something to look at",
which exists because smoothing something by erasing it also smooths it. Version
one measured the spread of colour across the whole map and passed with the grain
switched off, because the slow green-to-dry gradient from the middle of the map
to its edge is most of that number. Version two measured within 8x8 patches and
passed too, because a patch on a hillside varies by how much rock has come
through. It now measures each point against the average of its four neighbours,
where a smooth field of any wavelength answers near zero: 0.0032 with the grain,
0.0007 without.

It also counts random draws, which sounds like a style check and is not. The old
per-cell jitter drew exactly one number per quad and the trees are placed from
the same sequence right afterwards, so the bare `rnd()` left behind in the quad
loop is the only reason existing seeds still grow the same forest. It looks
exactly like dead code. Deleting it reports 0 draws for 40,000 cells.

**`hud.mjs`** — the layer between the cursor and the world. Where the cursor is
pointing, where a unit sits on screen for a click or a marquee, and where a
building's box begins for a pick were all answered against a flat plane at the
plateau's height. That is exactly right in the middle of the map and wrong
everywhere else: the camera looks down at 36 degrees, so three units of drop
between the plane and the real hillside slides the answer nearly three cells
sideways. Reverting the fix, the cursor reports a point 5.90 units from where
its own ray crosses the terrain, and a unit standing out there cannot be clicked
or marqueed at all — 0 selected, twice.

Ground truth for the cursor is computed inside the test by walking the camera's
ray down onto the height field in tenth-unit steps. That is deliberately not how
the game does it — the game solves it — so the check is a second opinion rather
than the same arithmetic run twice.

It is the one tool here that leaves the page's frame loop running, for a reason
worth knowing: everything inside a single `page.evaluate` runs to completion
before a rAF callback can interleave, so each block is atomic anyway, and the
health bars are DOM elements written by that loop — stopping it leaves nothing
to measure. The bar checks straddle two evaluates for the same reason: damage in
one, a frame, read in the next.

**`weather.mjs`** — the world moving when nothing in the simulation moves. The
trees are part of the static mesh — one buffer, one draw call, nothing per tree
to animate on the CPU — so the wind lives in the vertex shader, and what tells
it which vertices are foliage is a sway weight packed into the top of the
emissive channel: emit uses 0-2 and the finish uses the next two bits, so
everything from 32 up was free. That packing is the part that breaks silently.
Get the arithmetic wrong and a canopy stops being matte or a brazier stops being
a light, and nothing throws — so this decodes every vertex of the static mesh
and asserts the two fields the sway weight shares a float with still read back
as themselves.

The motion is measured against the clock rather than the wall: two draws at the
same clock value must be byte-identical, which is what makes a headless run
reproducible and is exactly what fails if somebody reaches for `Date.now()`.
Broken four ways — no wind (0% of the frame changes), sway applied to
everything (the settlement ripples), the weight packed over the finish bits
(heaviest weight reads 1 instead of 7), and the clock taken from the wall
(327,097 bytes differ between two draws that should match).

Its third check took two attempts and the fix is the useful part: "nothing else
moves" was measured on a patch found by checking only that the ground was level,
which framed a stand of pines fifteen units away and reported the ground
rippling at 3.9%. It looks at the buildable plateau now, at a zoom whose corners
stay inside the treeline, because the view is wider than it is tall and at zoom
9 the corners reach 16.9 units while the nearest trees start at 14.8.

**`combat.mjs`** — whether a fight happens where the fight is. Nearly every
effect in the game was spawned at `PLAT`, the plateau constant, rather than at
the ground under it: the sparks off a blow, the flash off an impact, a tower's
muzzle, the height a bolt flies at, the height a corpse stops falling. On the
plateau that is exactly right and invisible, which is why it survived so long —
march out to a nest, where the ground rolls by three units, and sparks go off
underground, bodies come to rest buried or hovering, and an arrow aimed at a
fixed chest height lands in the dirt in front of anything standing uphill.

So it stages a real fight away from the flat, by the bait method
`campaign.mjs` uses, and measures every effect against the terrain beneath it.
`instances.mjs` makes this kind of claim about things that are *drawn*; this one
is about things that are *spawned*, which no draw-time check can see, because by
then the number is already wrong.

Three of its checks needed a second attempt. "Nothing is spawned underneath the
ground" only catches one of the two ways this fails — whether the ground is
above or below the plateau decides the direction — and the chosen nest sits
below it, so the first version watched sparks go off four units over everyone's
heads and called it fine. The bolt check sampled mid-flight, where the two
candidate heights have not diverged yet (0.40 from one and 0.49 from the other,
which decides nothing); it follows each bolt until it disappears and reads where
it actually arrived, 0.19 from its target's chest against 0.85 from the height
the old code aimed at. And the corpse landing is driven directly rather than
waited for, because one commander takes a very long time to kill a nest guard
and what is under test is four lines of the corpse step.

**`lighting.mjs`** — whether you can see what is coming. A body stood 13 levels
of luminance off the ground behind it at night against 44 by day, so a wave of
ninety attackers was a wave you could pick out ten of. This measures the
contrast at the BOUNDARY of a shape rather than the average over its middle,
because that is what a silhouette reads by.

Three of its measurements were wrong before they were right, and each mistake is
worth knowing. Averaging the whole silhouette *including the shadow it casts*
reported dusk as the hardest hour to see a body — a unit's shadow at dusk is ten
times the area of the unit, so what that number described was the contrast of a
shadow. A reading of how far the outline stood off the *body* was added to tell a
pale outline from a dark one, worked at 15.2 against 9.1, and was then taken out
rather than left green: the wind shipped, a canopy came to rest behind the unit,
and against leaves rather than grass it read 21.1 against 21.7 — no separation
and the wrong way round. And the counterweight check — night must still be night
— passed with the edge light turned up eight times, because edges are a sliver of
the frame and the mean barely moves; it reads the bright tail as well now.

What it defends today is the sky rim in the lit pass: 17 levels at the boundary
at night with it, 13.6 with it removed. It used to also defend a screen-space
moonlit outline, with two checks counting cold thin marks in a night frame; that
effect is gone — it read as a blue wireframe over every tree and stone — and its
checks went with it.

The tool is bit-identical run to run, which took work: the page keeps its own
frame loop running while a test does its setup, so every reading was taken from
whatever it drew last rather than from the frame the test built, and a unit's
gait phase advances with distance walked, so two runs measured two different
stances and disagreed by twelve levels on an unchanged build. It stops the loop
and freezes the pose. Any tool here that reads pixels should do the same.

Checked by breaking the change five ways: no sky rim (13.6 at night against
17.7), the fire stops moving (0% swing), lamps pinned to the plateau again (2.35
and 1.79 above their own ground), the night lit until it is day (the brightest
half-percent reaches 199), and the depth gate dropped so every pebble is
outlined (19,772 cold marks against 9,087).

The gate on that outline is a band rather than a threshold, and the check for it
is separate because it needs a different measurement. A tree clears any
threshold set for a unit by a mile, so the first version lit every pine on the
map; the band falls away again above roughly two and a half units of standing
height. Telling the two apart needs a strict definition of a mark — at the loose
setting the band reads 80% of the threshold, which decides nothing, and at
24/22 it reads 64%. Both numbers were measured on both builds before the bar was
put between them.

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

**`economy.mjs`** — how much a day pays, how long the map lasts, and whether the
first night is sized against the first day. That last one is a ratio held in two
different files — what the piles give is in `STAT_DEFS.salvage`, what a nest
sends is in `DIFF` in `d_game.js` — and moving either alone is how an opening
ends up frantic or free. It is checked as a band around *normal* rather than one
band for all three, because a band wide enough to hold easy at 0.13 and hard at
0.31 would guard nothing; the other two are checked for their order instead,
which is the property that actually defines them. Broken three ways: the old
wave against the new economy (0.36), the new wave against the old piles (0.14),
and hard made lighter than normal (the order check).

The rest of it: Plays a
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
