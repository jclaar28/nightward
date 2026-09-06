# Nightward — persistent map design

What we are building next, and why. This doc says nothing about what the game
already does — for that, read [HANDOFF.md](HANDOFF.md) and
[CLAUDE.md](CLAUDE.md), which are maintained alongside the code. Everything
here assumes them.

It is a plan, not a specification. Where a decision has been made it is
stated as a decision and given its reason, because a reason is what lets the
next person disagree usefully. Where something is genuinely undecided it is
in [§7](#7-what-is-still-open) and nowhere else — a doc that hedges in every
paragraph is a doc nobody can build from.

---

## 1. The spine

Three decisions carry the rest of this document. They were settled by
building them and playing them, which is worth saying plainly, because the
alternatives are all reasonable and the reasons below are what make this one
better rather than merely first.

**The nests are the objective.** A round ends when every hall is gone or
every nest is. Not at dawn, not at a night count.

**The nests are also the clock.** Wave size is the number of nests still
standing times what each one sends, and what each one sends grows every
night. Pulling one down is therefore a permanent cut to every night after —
the only decision in the game that compounds.

**So the whole design points outward.** Everything below exists to make
leaving your walls possible, informed, and worth it: roads (shipped) make the
trip cheap, territory makes the ground you took stay taken, exploration tells you
which nest to hit, and the tech tree is what you spend the proceeds on. If a
proposed system does not serve that, it is probably not a Nightward system.

The alternative — a night counter that authors the difficulty curve directly
— is simpler to tune and was the original plan. It was dropped because a
global counter and "kill nests to shrink the wave" cannot both be the source
of truth, and of the two, only one gives the player a reason to be anywhere
but behind their own walls.

### What this costs

A run that is going well gets quieter as it goes. The last nest is, by
construction, the least dangerous fight of the round, and that is the wrong
shape for a climax.

We are keeping it anyway, because the alternative fixes — a trickle from the
map edge, or nests that grow back — both work by making your progress matter
less, and progress mattering is the entire point. Instead the survivors get
angrier: **`spite`** scales what each remaining nest sends by how few of them
are left. Clearing two of five now caps later nights at about 77% of what they
would have been rather than 60%, so the cut is real and the curve does not
flatten.

`spite` sits between 0 and 1 and the endpoints are both failures. At 0 the
curve flattens, which is the problem it exists to solve. At 1 the wave size
stops depending on nest count altogether, which removes any reason to clear.
It ships at 0.5.

**Two constraints, and they pull against each other. Any change to wave size
has to be checked against both:**

> **Clearing must pay.** A player who clears nests reaches a later night than
> one who does not, measurably, across seeds.
>
> **A cleared map must still escalate.** Every night is bigger than the last
> at every nest count, and the run does not go quiet because it is being won.

What is *not* a constraint — and was stated as one in an earlier draft of this
doc — is that a player who clears half the map should face a harder night than
one who cleared none. That is arithmetically the same as saying clearing
should hurt you: the two are equal exactly at `spite` 1, so anything stronger
means marching out makes your nights worse. The felt difficulty of an endgame
comes from the assault, not from the night at home, and that is what the next
paragraph is for.

**The last nest is the hardest fight, and that is already true.** A nest's
garrison grows every night it is left alone, to a cap — three defenders on
night one, sixteen by night ten. Hitting the final nest late means hitting the
most defended thing on the map, so the climax is the attack you choose to
make rather than the wave you wait for. That is the right place for it in a
game about leaving your walls.

---

## 2. Order of work

The three systems below are next, and they are not simultaneous — the
dependencies between them are real:

1. **Territory and outposts.** Independent of exploration. Gives ground taken
   a way to stay taken, which is what makes step 2 worth doing.
2. **Full fog of war.** The scout has shipped and so has the narrow version of
   sight — see §4 — so what is left here is the expensive part: hiding the 3D
   view rather than the minimap, and storing explored-but-not-currently-visible.
   Still do it after territory exists, so the information it reveals is
   information about something.
3. **Tech tree.** Last, because it drags in status effects, and because it is
   the one system that is more fun to design once there is a longer game to
   spend across.

Doing them in this order means each one ships into a game that already wants
it. Doing fog of war first means building a system whose payoff — knowing
where to go — has nothing to act on yet.

**Roads have shipped and have left this document.** That is the rule in
[§8](#8-keeping-this-doc-honest) working: once a thing exists, describing it
here is how this file goes stale. `HANDOFF.md` has it now.

---

## 3. Territory & control

**Halls and outposts project a control radius; roads do not.** Logistics and
territory stay separate concerns. Roads are how you move; control is what you
hold. Merging them makes both harder to reason about and makes a road a
military asset, which contradicts §3.

**The hall projects on its own.** A player should not have to build a
dedicated outpost to have territory around their own town — outposts extend
control outward from home, they do not create it.

**Land outside every radius is unclaimed**, and the horde roams it freely.
Patrols may reach and occupy a resource site before the player does, so
exploration has a clock on it rather than only a payoff.

**An outpost is a new building**, which in this codebase means: a `STAT_DEFS`
entry for cost, health and build time; a name and blurb in `TEXT_DEFS`; and a
decision about what a half-built one projects. That last one is settled —
**nothing**. A construction site does not shoot, house, light or accept
repair, and territory you hold before the building stands is territory you
got for free.

---

## 4. Exploration

**The scout has shipped, and with it the narrow half of sight.** Everything you
own has a vision radius and the minimap marks only the attackers something of
yours can see. `HANDOFF.md` and `ROSTER.md` describe the unit; what belongs here
is what is still missing.

**Full fog of war is not free and is not what shipped.** What exists hides the
horde on the minimap and nothing else — the map itself stays known, terrain and
nests included, and the 3D view hides nothing at all. Real fog needs per-tile
visibility, a persistent explored-but-not-currently-visible state, and a pass
over the renderer rather than the minimap. It would replace the narrow version
rather than extend it. Flagged here so it is never costed as already half done.

**The open question is whether the narrow version is enough**, because it
already buys the thing §1 wants: which way a night's wave came from is now
something you can know by having somebody out there, at a fraction of the cost.
What it does not yet answer is which nest to hit next — a nest's garrison is
visible to nobody, so choosing a target is still a guess. That gap is the
cheapest remaining piece of intel and probably the next one to close, with or
without full fog.

---

## 5. Resources

**Salvage plus the nest cache is the whole economy for now, deliberately.**
Salvage is already tuned for a long game — piles give up their contents
slowly and last many days, with the richer ones further out — and once the
map is stripped, nest caches are the income. That is the loop the spine
wants: the thing that pays for pushing out is pushing out.

**A second base resource is deferred until it has a job.** The bar it has to
clear: a second pile that also depletes on roughly the same curve adds
bookkeeping and no pressure. A second resource earns its place only if it
creates a *different* kind of scarcity — something you can run out of while
still having plenty of supply.

**The special resource from a nest kill is a split, not a new mechanic.**
Today a nest pays plain supply to whoever did the most damage bringing it
down, and the damage ledger that decides who gets paid already exists.
Splitting that payout into its own currency, spendable mainly on research
rather than routine construction, makes aggression read as its own reward
track. Worth doing when the tech tree lands, not before — a currency with
nowhere to be spent is a number.

**Logistics stay on the carry loop.** A worker walks, carries, deposits. No
depot or inventory system.

---

## 6. Tech tree & upgrades

Two layers, deliberately connected:

1. **Global research**, at a **workshop** (defences) or **forge** (troops).
   Researched once, applies to that whole class for the rest of the map.
   This is where "ice arrows become available to towers" lives.
2. **Per-building investment**, spent at an individual structure — either a
   linear rank against an existing `STAT_DEFS` field, or, once unlocked
   globally, a branching choice: *this* tower becomes fire or ice, not both.

Global research unlocks *that an option exists*; the player still spends at
each building to slot it in. That stops one research click becoming an
instant base-wide power spike, and gives per-building spending something to
do across a long map.

**Status effects are the real cost here, and they are not a balance-table
addition.** Nightward's combat is discrete, readable swings — every hit goes
through `hurtTarget`. Burn and slow imply a continuous tick, and a tick the
player cannot see is the opposite of how this game communicates. Any status
effect must be legible on the unit and on the numbers, or it does not ship.

**Scope:** workshop and forge, linear upgrades on a handful of fields, and
exactly one branching choice each — enough to build the status-effect
subsystem for real and find out what it costs. Broad multi-branch trees only
after that has proven out.

---

## 7. What is still open

- **What stops the map being fully paved by night nine.** Roads cost worker
  time, which is a real constraint early and nearly none late. A supply price
  per length, a cap on total length, or a build time that scales with distance
  from the hall would each fix it differently. Now shipped and unfixed — watch
  it in play before picking.
- **What roads do to the economy's shape.** Faster trips extract faster, so
  the day the piles empty should move earlier and their amounts probably have
  to rise. `tools/economy.mjs` reports both numbers and roads now exist, so
  this is measurable and simply has not been measured.
- **Whether workers should build anything else.** Roads introduced
  worker-driven construction to a game where every other site is a timer. If
  it feels good, the question is whether buildings should work that way too —
  a large change to how a day is spent, and not one to make by accident.
- **Whether `spite` is at the right value.** 0.5 was measured across eight
  seeds over twelve nights and satisfies both constraints in §1: clearing two
  of five still reaches 11.4 nights against 9.8 for clearing none, while the
  night-twelve wave a cleared player faces rises from 2318 to 2994. That is
  one sample of one build profile, though, and the useful range is wide.
- **Where nests sit relative to difficulty.** If the nearest nest is always
  the first one killed, the curve flattens predictably. Distance, garrison
  size and cache value should probably not be uniform across a map.
- **What a second base resource is for.** §6 states the bar; nothing clears
  it yet.
- **Fog of war's visibility model** — per-tile vs. per-unit-radius, how
  explored-but-not-visible is stored, and what it costs at the population
  sizes §1 implies. Half of this now exists and should be read before the rest
  is designed: everything you own has a `sight`, and the minimap marks only the
  attackers somebody is looking at. It is deliberately the narrow version — the
  map itself stays known, terrain and nests included, and nothing is hidden in
  the 3D view. Full fog is a different feature and would replace this rather
  than extend it; the open question is whether the narrow version is enough,
  because it already gives scouting a job at a fraction of the cost.
- **How status effects tick** against a swing-based combat model without
  becoming invisible.
- **Outpost balance.** New building, no numbers drafted.
- **The performance ceiling.** Hundreds to thousands of bodies stresses both
  the renderer and the Dijkstra flow field. The instancing architecture is
  what makes the draw side affordable; the flow-field recompute cost at that
  population has not been measured. It is cheap to find out —
  `tools/instances.mjs` captures every instance for a frame and the harness
  drives a headless round at any wave size — so this should be a measurement
  before it is a target. The player's own side has a second cost now: units
  run A* per order, which is affordable because orders are rare (twenty units
  routed round a wall on one frame costs ~4ms, measured in `tools/pathing.mjs`)
  but scales with army size rather than wave size. A persistent map grows both.
- **The two-player path is covered now, up to a point.** `tools/net.mjs` runs
  two browsers over a real peer connection and proves the handshake, the seed
  agreement, the intent round trip, the ownership checks and that both worlds
  hold the same units in the same places. What it does not cover is two
  machines on two networks: it connects over loopback with STUN unreachable, so
  NAT traversal, a relay-less hairpin and a flaky link are all still untested,
  and the ~855-character invite code has never been carried by a human through
  a chat client that might wrap it. Worth one real two-machine run before
  either of us builds on top of it.
- **Cross-map meta-progression.** Explicitly out of scope until one
  persistent map is proven.

---

## 8. Keeping this doc honest

The previous version of this file went stale in under a week. It is worth
saying why, because the failure was structural rather than careless.

It described the shipped game as a baseline, and the baseline moved. Sections
proposed building things that by then existed, one proposed the opposite of
what shipped, and four of its five source references pointed at the wrong
lines.

So: **this doc does not describe the current game.** `HANDOFF.md` does, and
it is maintained with the code. **Cite symbols, never line numbers** — a line
number in a document that outlives a commit is a liability. And when a
decision here is overtaken by one made at the keyboard, change the decision
in place rather than appending a note about it. A design doc is a statement
of intent; the argument that produced it belongs in the commit message.
