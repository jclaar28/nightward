# Nightward — persistent map design

A design doc for where Nightward goes next, not a description of what ships
today. It sketches a persistent map with exploration, logistics and a tech
tree layered on top of what already exists — the shared plan Tyler and Jarrod
are working from, expected to move as playtesting happens.

**Revised after the September build.** When this was written the game was one
map, one day, one night, over. That is no longer true, and the difference is
not cosmetic: the round already runs across many nights, escalation is already
driven by map state, and the nests are already the objective. Parts of this
doc's MVP have shipped, one part shipped in a way that **contradicts the plan
below** ([§3](#3-escalating-nights)), and the original's `d_game.js:NNN`
references have been replaced with symbol names, because line numbers here rot
within a commit or two. [§0](#0-what-has-landed) is the delta; the rest of the
doc is Tyler's, edited only where the ground moved under it.

Read [HANDOFF.md](HANDOFF.md) and [CLAUDE.md](CLAUDE.md) first if you haven't
— this doc assumes the current game's core systems (the flow-field wall
mechanic, the balance table, the salvage/carry loop, construction sites) as a
foundation rather than re-explaining them.

Every section below is marked **MVP**, **Vision**, or **Shipped** so scope
stays honest as this grows. See [§11](#11-mvp-vs-vision) for the consolidated
cut.

---

## 0. What has landed

Since this doc was written, the following moved from plan to shipped. Each one
changes what the sections below are proposing *against*.

- **The round no longer ends at dawn.** `dawn()` hands you the next day, and a
  round ends only when every hall is gone or every nest is. The core loop in
  [§2](#2-core-loop) is, in its skeleton, already the game.
- **The win condition is answered: destroy every nest.** This was the doc's
  largest open question. It was settled by building it, not by discussion, so
  it is open to being re-opened — but it is what ships today.
- **Escalation is already map-state driven, which is the opposite of what
  [§3](#3-escalating-nights) proposes.** `waveSize()` is
  `liveNests().length * nestSend(night)` — the night counter raises what *each*
  nest sends, and the number of living nests multiplies it. Pulling a nest down
  is a permanent cut to every night after. See §3 for what to do about the
  disagreement.
- **Nests are already the persistent spawner of [§7](#7-nodes-enemy-spawners).**
  They are tough, regenerate a share of their health each dawn, hold a standing
  garrison that grows nightly (`guardWant()`), wake defenders when hit, chase
  within a leash and go home, and pay a supply cache to whoever did the most
  damage bringing them down. The special-resource-for-node-kill idea exists in
  primitive form as that cache.
- **Distant salvage is already richer than near salvage** (`farN` piles outside
  the ring at `farK` × the inside yield), which is the economic premise
  [§8](#8-logistics--roads) needs roads to pay off against. It is measured, not
  assumed: `tools/economy.mjs` reports a map's total and how many days it lasts.
- **Everything is a construction site first** — placement is not instant, and a
  site does not shoot, train, house, light or accept repair. Any new building
  this doc adds inherits that and needs the same guards.
- **The balance table now has a sibling: the text table.** `TEXT_DEFS` in
  `d_core.js` owns every player-facing string the way `STAT_DEFS` owns every
  number, editable live from the Library's Text tab. New systems here need
  their names and blurbs put there, not typed into markup.
- **`tools/` exists** — six headless checks that measure the running game
  rather than eyeballing it. The performance question in §3 is answerable with
  one of these rather than by argument.

Still true, still unbuilt: fog of war, outposts and control radius, the scout,
resource tiers beyond salvage, roads, and the whole of the tech tree.

---

## 1. Vision

Same identity, longer game. Continuous-time RTS, workers who can't fight,
walls that steer the horde rather than stop it, one balance table as the only
source of truth. What's new: the map doesn't end after one night. Players
explore outward, claim ground, build a resource network, and research
upgrades, while the horde grows night over night until it's an on-screen mass
in the *They Are Billions* sense — hundreds to thousands of bodies, not dozens.

The throughline from current Nightward that must survive this expansion:
**everything reads on the map.** A road, an outpost's control radius, a
spawner node, a researched upgrade — a player should be able to look at the
map and understand what it means without opening a menu.

---

## 2. Core loop

Place the hall, same as now. From there, day and night keep alternating on
one persistent map instead of ending after the first night:

1. **Day** — gather, build, expand the perimeter, send scouts and workers
   into unclaimed land, invest in roads to distant nodes, spend at the
   workshop/forge.
2. **Night** — the horde comes, scaled up from the previous night. Hold.
3. Repeat, escalating, until every hall is gone or every node is.

**The win condition is settled: destroy every node.** It shipped that way —
clearing the last nest ends the round as a win, and each nest cleared before
then permanently shrinks every night after. That makes marching out the
central decision of a long map rather than a side quest, which is what the
rest of this doc wants anyway.

Worth being honest that it was settled by building it rather than by
discussing it, so it is fair game to revisit — but the alternatives on the
table (survive to night N, endless high score) both make the nodes optional,
and the moment nodes are optional most of [§7](#7-nodes-enemy-spawners) and
[§8](#8-logistics--roads) lose their reason to exist.

---

## 3. Escalating nights

**Shipped — but not as this section planned. See the warning below.**

- **Quantity is the primary lever.** Still true and still right: wave size
  grows nightly, aiming at the *They Are Billions* spectacle of a horde that
  visibly dwarfs your garrison.
- **Stats (mostly HP) scale secondarily.** Shipped as `ehpK`, a per-night
  multiplier on attacker health, tuned on top of the size curve rather than
  driving it — exactly as this section asked.
- **Driven by a night counter, not map state.** ⚠️ **This is the one place the
  shipped game contradicts the doc.** What actually ships is
  `waveSize() = liveNests().length * nestSend(night)`: the counter raises what
  each nest sends (`ramp` to the power of night − 1), and the number of nests
  still standing multiplies it. Escalation is therefore a function of map
  state, which this section explicitly deferred to Vision.

  It was not a considered rejection of the plan — it fell out of making the
  nests the objective, because a global wave counter and "kill nests to shrink
  the wave" cannot both be the source of truth. Two ways forward, and this
  needs Tyler's call rather than a default:

  1. **Keep it.** Clearing a nest is then a permanent, legible cut to every
     night after, which is the strongest argument the game has for leaving the
     walls. Measured: turtling dies around night 5, clearing one of five nests
     reaches 8.7, clearing two holds all 12.
  2. **Force it back to counter-driven** by setting `ramp` to carry the whole
     curve and making `waveSize()` ignore the nest count. Both live in the
     balance table, so this is an afternoon, not a rewrite — but it costs the
     reason to march out, and something else has to replace it.

- The `DIFF` table (`DIFF` in `d_game.js`) no longer carries a global wave
  size. It carries `send` **per nest per night one**, plus `nests`, `supply`,
  `hp` and the unit mix; the per-night curve lives in the `nest` block of
  `STAT_DEFS` (`ramp`, `ehpK`). The generalization this section wanted — presets
  as an offset on a curve rather than three fixed points — is effectively how
  it works now.

**Vision:** new enemy silhouettes introduced at threshold nights, not just
more of the original three (shambler/runner/brute). Each existing type has an
explicit job (the `ENEMY` table in `d_game.js`) — a new type at, say, night 8
should punish a
specific mistake the same way, not just add a stat line.

**Engineering risk, not a design question:** hundreds-to-thousands of units
on screen stresses both the renderer and the flow field. The instancing
architecture (one draw call per kind, per `d_gl.js`) is exactly what makes
large counts affordable, but the Dijkstra flow field recompute cost at that
population needs to be measured, not assumed — in keeping with this repo's
own "measure, not eyeball" rule. Profile early, before committing to a target
headcount.

---

## 4. Territory & control

**MVP.**

- **Outposts and the town hall both project a control radius.** The hall
  covers home turf on its own, so a player isn't forced to build a dedicated
  outpost just to have territory around their main base — outposts extend
  control outward from there.
- **Roads carry no control.** Territory is purely an outpost/hall system;
  logistics and territory are deliberately separate concerns. (This resolves
  an earlier open question in this doc's brainstorming — roads were
  considered as a control mechanism and rejected in favor of keeping the two
  systems distinct.)
- Land outside every hall/outpost radius is unclaimed. Patrols roam it freely
  and may contest or occupy resource nodes found there before the player
  reaches them — exploration has a clock on it, not just a payoff.
- An outpost is a new building type and needs its own balance entry (cost,
  hp, build time) in the same `STAT_DEFS` shape as everything else, a name and
  blurb in `TEXT_DEFS`, and — since everything is a construction site first —
  a decision about what a half-built outpost projects. Nothing, most likely:
  a site does not shoot or light, and territory you get before the building
  stands would be territory you get for free.
- There is now a working precedent for a radius that means something: a nest's
  garrison leash. It is a plain distance test in the sim rather than a claimed
  region, so control radius still needs building — but the "how far from a
  thing" plumbing and its balance-table field already exist to copy.

---

## 5. Exploration

**MVP (scout unit). Fog of war is a prerequisite and is not built.**

- **Fog of war does not exist in current Nightward** and is a dependency for
  everything in this section — flagged explicitly so it isn't assumed free.
  Needs its own implementation pass: per-tile visibility, persistent
  explored-but-not-currently-visible state, and vision radius per unit.
- **Scout unit**: fast, lightly armed, fires while moving (kite-capable), but
  meaningfully weaker than a soldier or archer in a sustained fight. Its
  combat kit exists for self-defense and harassing an isolated patrol, not
  for holding a line. Once fog of war exists, it carries the largest vision
  radius of any unit — its real job is intel: patrol routes, node locations,
  an incoming wave spotted early.
- Exploration reveals node locations, contested/patrol activity, and — since
  distant nodes hold larger stockpiles — enough information to judge whether
  a road out to one is worth the investment.

---

## 6. Resources & economy

**MVP. Tier one ships; the rest do not.**

- **Three base resources to start, count left open.** Existing salvage
  becomes tier one; two more gate progressively upgraded buildings and
  units. Exact identities/visuals are placeholders until we're building this.
  Note that salvage was rebalanced for a long game while this doc sat: piles
  now give up their contents slowly and last many days, split into a few poor
  ones inside the ring and more, richer ones outside it. Tier one already has
  the shape a long map needs — a second resource should be a *different* kind
  of pressure, not a second number that also runs out around day seven.
- **One special resource, earned only by destroying a spawner node**
  ([§7](#7-nodes-enemy-spawners)). Today a node kill pays plain supply, so this
  is a split rather than a new mechanic. Given the risk of reaching and killing
  a node, this resource should feel disproportionate to earn — the working
  assumption is it's spent primarily at the workshop/forge on global
  research rather than routine construction, so it reads as a reward for
  aggression rather than another routine input. Not yet confirmed, just the
  doc's default.
- Logistics stay on the existing carry-loop pattern (a worker walks, carries,
  deposits) — no separate depot/inventory system, per Nightward's existing
  economy.

---

## 7. Nodes (enemy spawners)

**Largely shipped. See below for what is not.**

- **Nodes are the map's primary enemy source** — a persistent spawner
  structure, in the spirit of a Factorio biter nest, rather than a wave that
  appears from nowhere. **This has shipped.** Nests are now the only source of
  a wave, they persist across every night of a round, and clearing the last
  one wins it (`endRound` via `hurtTarget`). They are also tough enough to be
  a real target: high health, a share of it knitted back each dawn, a standing
  garrison that grows every night you leave them alone (`guardWant()`), and
  defenders that wake when the nest is hit, chase within a leash, and go home.
- **A lighter, secondary trickle spawns at the map edge during night**,
  lower density than what nodes produce. **Not shipped, and now a real design
  question rather than flavour:** today 100% of a wave comes from nests, which
  is what makes clearing them pay. An edge trickle is a floor under the
  difficulty — it stops a cleared map going quiet — but every body it adds is
  one that clearing a nest does not remove. Worth adding *because* of that,
  not despite it, but the ratio wants deciding deliberately.
- Destroying a node yields the special resource. **Shipped in primitive
  form:** a nest pays a supply `cache` to whichever player did the most damage
  bringing it down, and that cache is most of the income once the map is
  stripped — which is what makes pushing out the thing that pays for pushing
  out. What has *not* shipped is a distinct resource; it pays plain supply.
  Splitting it out is still the right call, and the ledger that decides who
  gets paid (`hurtTarget` tracks damage per player) is already there to hang it
  on.
- **Still open:** one-time per node, or does a destroyed node eventually
  regenerate a guardian and become farmable? Shipped behaviour is one-time —
  a dead nest stays dead and stops spawning for good — which matches this
  doc's MVP default. Repeatable nodes remain **Vision**.
- Node placement is a natural extension of the corruption/taint field already
  generated around nests in `d_core.js` — worth reusing that system for node
  siting rather than inventing a second one, though this is an implementation
  opportunity, not a locked decision.

---

## 8. Logistics & roads

**MVP. Nothing here is built.**

- **Roads harden from repeated worker trips** — no separate placement UI, in
  keeping with "everything reads on the map." A path a worker walks
  frequently becomes a road over time.
- **Roads speed up player units more than the horde.** If an enemy happens to
  path onto a road tile it gets a smaller speed bonus, but **the horde's flow
  field does not treat roads as lower path cost** — attackers never seek
  roads out, they only benefit if their route happens to cross one. This
  keeps roads a pure economic and mobility investment without turning them
  into an accidental highway to your hall.
- **Distant nodes hold larger stockpiles**, which is what makes the road
  investment pay off — a two-minute walk to a rich node is worth paving, a
  thirty-second walk to a poor one usually isn't. **This premise already
  holds:** salvage outside the buildable ring is worth `farK` × what the piles
  inside it give, and there are more of them. The walk is already the cost, so
  roads have something real to be measured against from day one —
  `tools/economy.mjs` reports supply per day and how deep into a run the map
  runs dry, which is exactly the number a road is supposed to move.
- **Vision:** an upgraded logistics tier (trains, or similar) once roads are
  proven out. Not designed yet, just reserved as the obvious next rung.

---

## 9. Tech tree & upgrades

**MVP: one full vertical slice. Broad trees are Vision. Nothing here is built.**

Two layers, stacked, because "per-building upgrades" and "a tech tree behind
buildings" turned out to be two different systems rather than one:

1. **Global research**, unlocked at a **workshop** (defenses) or **forge**
   (troops) — researched once, applies to every building/unit of that class
   for the rest of the map. This is where a choice like "unlock ice arrows as
   an option for towers" lives.
2. **Per-building investment**, spent at an individual structure — either a
   **linear** bump (more rate of fire, more damage: a simple purchasable rank
   against an existing `STAT_DEFS` field) or, once unlocked globally, a
   **branching choice** (this specific tower becomes fire *or* ice, not both).

The two layers are deliberately connected: global research unlocks *that an
option exists at all*; the player still has to spend at each individual
building to actually slot it in. That avoids one research click becoming an
instant power spike across the whole base, and it gives ongoing per-building
spending something to do across a long map.

**New engineering dependency, not just data:** branching choices like
fire/ice imply **status effects** (burn, slow) that don't exist in the
current sim at all. Nightward's combat is built on discrete, readable swings
rather than a continuous damage tick (every hit goes through `hurtTarget`) —
any status-effect
system needs to be designed to fit that same "damage you can see" philosophy
rather than becoming an invisible background tick. This is real scope, not a
balance-table addition, and the MVP should prove it end-to-end on a small
slice (one branching choice, one status effect) before it's trusted to
generalize.

**MVP cut:** workshop and forge exist; each supports linear upgrades on a
handful of fields, plus exactly one branching choice each (enough to build
and test the status-effect subsystem for real). Broad, many-branch trees are
**Vision**.

---

## 10. Open questions & risks

Collected here so nothing gets quietly assumed:

- ~~**Win condition for a persistent map.**~~ **Answered: destroy every
  node.** Shipped. Re-openable, but see [§2](#2-core-loop) for what the
  alternatives cost.
- **Counter-driven vs. map-state-driven escalation.** The live disagreement.
  Shipped behaviour went to map-state; the doc asked for a counter. Needs
  Tyler's call — [§3](#3-escalating-nights) has both options and what each
  costs.
- **Node respawn.** One-time-per-node is both this doc's default and what
  ships. Still not a confirmed *decision*, just the standing behaviour.
- **How much of a wave should come from the map edge**, now that clearing
  nests is the whole reward loop. Every edge-spawned body is one that clearing
  a nest does not remove.
- **Performance ceiling.** "A ton of units on screen" needs profiling against
  the existing flow-field and instancing architecture before a target
  headcount is picked. Cheaper to answer than it was: `tools/instances.mjs`
  already captures every instance the renderer is handed for a frame, and the
  harness can drive a headless round at any wave size, so this is a
  measurement someone can take in an afternoon rather than an argument.
- **Fog of war design.** Per-tile visibility model, persistence of
  previously-seen-but-not-visible areas, per-unit vision radii — none of this
  is designed yet, only assumed necessary.
- **Resource identities.** Tiers two and three, and the special resource,
  have no names, visuals, or exact gating rules yet.
- **Outpost balance.** New building, no stats drafted.
- **Status effects vs. the swing-based combat model.** How burn/slow tick
  (or don't) against a combat system built on discrete swings needs its own
  design pass, flagged in [§9](#9-tech-tree--upgrades).
- **What a second resource is *for*.** Salvage now behaves correctly for a
  long map on its own; a second tier that is simply another depleting pile
  adds bookkeeping rather than pressure.
- **Cross-map meta-progression.** Explicitly out of scope for now, called out
  by Tyler as a later item to revisit once a single persistent map is proven.

---

## 11. MVP vs. Vision

| System | Shipped | Still MVP | Vision / later |
|---|---|---|---|
| Round loop | Many nights; ends when every hall or every node is gone | — | — |
| Nights | Nest-state × per-night ramp, HP scaling (`ehpK`) | Settle counter vs. map-state ([§3](#3-escalating-nights)) | New enemy silhouettes |
| Nodes | Persistent spawner, tough, regenerating, growing garrison, one-time kill reward | Distinct special resource; edge-of-map night trickle | Regenerating/repeatable nodes |
| Resources | Salvage tuned for a long map; richer piles further out | 2 more base tiers + 1 special | Additional tiers as needed |
| Territory | — | Hall + outpost control radius | — |
| Exploration | — | Scout unit, fog of war | — |
| Logistics | The distance-pays premise roads need | Worker-hardened roads, player-only speed bonus | Trains / upgraded logistics tier |
| Tech | — | Workshop + forge, linear upgrades, one branching choice each (proves the status-effect subsystem) | Broad multi-branch trees |
| Meta | — | — (explicitly deferred) | Cross-map progression |

---

*This is a living document. Update it as decisions get made — it's meant to
be the thing Tyler and Jarrod (and whichever Claude either of them is
working with) build from next, the way `HANDOFF.md` orients a session to
where the shipped game stands today.*

*A note on keeping it honest: this doc drifted out of date within a week,
because it described the game as a baseline and the baseline moved. The fix
that seems to work is to cite **symbols** rather than line numbers, and to
state what a section is proposing **against** rather than restating what
exists — `HANDOFF.md` and `CLAUDE.md` are where "what exists" belongs, and
they are maintained with the code.*
