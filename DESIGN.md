# Nightward — persistent map design

A design doc for where Nightward goes next, not a description of what ships
today. `nightward.html` is one map, one day, one night, over. This document
sketches a persistent map that runs across many nights, with exploration,
logistics, and a tech tree layered on top of what already exists. Nothing
here is built yet — treat it as the shared plan Tyler and Jarrod are working
from, expected to move as playtesting happens.

Read [HANDOFF.md](HANDOFF.md) and [CLAUDE.md](CLAUDE.md) first if you haven't
— this doc assumes the current game's core systems (the flow-field wall
mechanic, the balance table, the salvage/carry loop, construction sites) as a
foundation rather than re-explaining them.

Every section below is marked **MVP** or **Vision** so scope stays honest as
this grows. See [§9](#9-mvp-vs-vision) for the consolidated cut.

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
3. Repeat, escalating, until the player loses every hall or [win condition —
   **open question**, see [§10](#10-open-questions--risks)].

**Open question:** what ends a successful run? Survive to a set night count,
an endless high-score loop, or some other objective (destroy every node on
the map, hold a set duration)? Not yet discussed — needs an answer before
this is fully playable, even in an MVP slice.

---

## 3. Escalating nights — **MVP: quantity scaling, night-counter driven**

- **Quantity is the primary lever.** Wave size grows with the night counter,
  aiming squarely at the *They Are Billions* spectacle of a horde that
  visibly dwarfs your garrison. This is the headline power fantasy and the
  main balancing tool.
- **Stats (mostly HP) scale secondarily**, tuned by playtesting on top of the
  size curve rather than driving it.
- **Driven by a night counter**, not map state — night *N* maps to a defined
  wave size and stat multiplier, full stop. Simpler to build and tune than
  tying escalation to corruption or nest count; that's a **Vision** item
  worth revisiting once the counter-driven version is playtested.
- The existing `DIFF` table (`d_game.js:183`) already carries wave size, enemy
  HP, and unit mix per difficulty preset — this generalizes into a curve
  function of night number, with the current easy/normal/hard presets
  becoming a starting offset on that curve rather than three fixed points.

**Vision:** new enemy silhouettes introduced at threshold nights, not just
more of the original three (shambler/runner/brute). Each existing type has an
explicit job (`d_game.js:78`) — a new type at, say, night 8 should punish a
specific mistake the same way, not just add a stat line.

**Engineering risk, not a design question:** hundreds-to-thousands of units
on screen stresses both the renderer and the flow field. The instancing
architecture (one draw call per kind, per `d_gl.js`) is exactly what makes
large counts affordable, but the Dijkstra flow field recompute cost at that
population needs to be measured, not assumed — in keeping with this repo's
own "measure, not eyeball" rule. Profile early, before committing to a target
headcount.

---

## 4. Territory & control — **MVP**

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
  hp, build time) in the same `STAT_DEFS` shape as everything else.

---

## 5. Exploration — **MVP (scout unit) / fog of war is a prerequisite**

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

## 6. Resources & economy — **MVP**

- **Three base resources to start, count left open.** Existing salvage
  becomes tier one; two more gate progressively upgraded buildings and
  units. Exact identities/visuals are placeholders until we're building this.
- **One special resource, earned only by destroying a spawner node**
  ([§7](#7-nodes-enemy-spawners)). Given the risk of reaching and killing a
  node, this resource should feel disproportionate to earn — the working
  assumption is it's spent primarily at the workshop/forge on global
  research rather than routine construction, so it reads as a reward for
  aggression rather than another routine input. Not yet confirmed, just the
  doc's default.
- Logistics stay on the existing carry-loop pattern (a worker walks, carries,
  deposits) — no separate depot/inventory system, per Nightward's existing
  economy.

---

## 7. Nodes (enemy spawners) — **MVP**

- **Nodes are the map's primary enemy source** — a persistent spawner
  structure, in the spirit of a Factorio biter nest, rather than a wave that
  appears from nowhere. This is a direct evolution of the current game's
  nest mechanic, where clearing every nest ends a wave early (`d_game.js:1542`)
  — here that same payoff persists across many nights instead of one.
- **A lighter, secondary trickle spawns at the map edge during night**,
  lower density than what nodes produce. The bulk of every wave still comes
  from nodes, so hunting them down is a real way to blunt the escalating
  curve, not just a side quest.
- Destroying a node yields the special resource. **Open question:** one-time
  per node, or does a destroyed node eventually regenerate a new guardian and
  become farmable again? This doc defaults to one-time for MVP simplicity —
  rewards exploring the whole map rather than turning into a farm loop —
  with repeatable/regenerating nodes as a **Vision** item.
- Node placement is a natural extension of the corruption/taint field already
  generated around nests in `d_core.js` — worth reusing that system for node
  siting rather than inventing a second one, though this is an implementation
  opportunity, not a locked decision.

---

## 8. Logistics & roads — **MVP**

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
  thirty-second walk to a poor one usually isn't.
- **Vision:** an upgraded logistics tier (trains, or similar) once roads are
  proven out. Not designed yet, just reserved as the obvious next rung.

---

## 9. Tech tree & upgrades — **MVP: one full vertical slice; broad trees are Vision**

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
rather than a continuous damage tick (`d_game.js:1317`) — any status-effect
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

- **Win condition for a persistent map.** Not yet discussed at all.
- **Node respawn.** One-time-per-node is this doc's default assumption, not a
  confirmed decision.
- **Performance ceiling.** "A ton of units on screen" needs profiling against
  the existing flow-field and instancing architecture before a target
  headcount is picked.
- **Fog of war design.** Per-tile visibility model, persistence of
  previously-seen-but-not-visible areas, per-unit vision radii — none of this
  is designed yet, only assumed necessary.
- **Resource identities.** Tiers two and three, and the special resource,
  have no names, visuals, or exact gating rules yet.
- **Outpost balance.** New building, no stats drafted.
- **Status effects vs. the swing-based combat model.** How burn/slow tick
  (or don't) against a combat system built on discrete swings needs its own
  design pass, flagged in [§9](#9-tech-tree--upgrades).
- **Cross-map meta-progression.** Explicitly out of scope for now, called out
  by Tyler as a later item to revisit once a single persistent map is proven.

---

## 11. MVP vs. Vision

| System | MVP | Vision / later |
|---|---|---|
| Nights | Counter-driven quantity scaling, HP scaling | Corruption/nest-state-driven scaling; new enemy silhouettes |
| Territory | Hall + outpost control radius | — |
| Exploration | Scout unit, fog of war | — |
| Resources | 3 base tiers + 1 special (node kill) | Additional tiers as needed |
| Nodes | Primary spawn source, one-time kill reward, light edge-of-map night trickle | Regenerating/repeatable nodes |
| Logistics | Worker-hardened roads, player-only speed bonus | Trains / upgraded logistics tier |
| Tech | Workshop + forge, linear upgrades, one branching choice each (proves the status-effect subsystem) | Broad multi-branch trees |
| Meta | — (explicitly deferred) | Cross-map progression |

---

*This is a living document. Update it as decisions get made — it's meant to
be the thing Tyler and Jarrod (and whichever Claude either of them is
working with) build from next, the way `HANDOFF.md` orients a session to
where the shipped game stands today.*
