# Nightward

An isometric, real-time settlement-defence game. You get one day to raise a town
and one night to keep it. Then the next day is shorter than it felt.

It is written as raw WebGL2 — no engine, no framework, no build tooling beyond
one Python script that glues eight files together. The result is a single
self-contained HTML file you can open from disk with no server.

**[Play it](https://jclaar28.github.io/nightward/nightward.html)** · or download
[`nightward.html`](nightward.html) and open it in a browser.

---

## The round

A commander walks onto an unbuilt map with a small purse. Where you put the town
hall costs you the time it takes him to walk there, so the round opens with a
decision rather than a click.

Six minutes of daylight: workers strip the map of salvage, cottages compound the
workforce, and everything you place arrives as a heap of materials that becomes a
building a few seconds later. Two minutes of night: the nests empty out and come
for the hall. You cannot call the night early and you cannot skip it — you hold
until dawn.

Lose the hall and you are out. In a two-player round the other settlement fights
on alone until it falls too.

## Playing

| | |
|---|---|
| Left-drag | select units, or paint a wall run |
| Right-click | move, attack, gather, repair — whatever is under the cursor |
| Middle-drag | rotate the camera |
| WASD / edge | pan · hold Shift to pan faster |
| Wheel | zoom |
| `1`–`9` | pick a building · `R` rotates it · `Esc` puts it back |
| `Ctrl`+`D` | deselect |
| `Esc` | the menu — settings, controls, quit |

Workers gather by day and mend walls by night. Soldiers block a lane so the
swarm stops to fight instead of walking past it; archers out-range everything and
fold if anything reaches them. The commander makes everyone near him swing
faster. A hall or a cottage can take its people inside, which is often the
difference between losing two workers and losing the day after.

## Two players

Two computers, no server. One player makes an invite, the other pastes back a
reply, and from then on the two browsers talk directly over a WebRTC data
channel. Nothing is hosted, nothing is matchmade, nothing has to stay running.

The host owns the simulation and ships a snapshot fifteen times a second; the
guest sends what its player clicked and draws the last snapshot it received. The
two worlds are identical by construction, because there is only one world.

Both players defend the same map from their own side of it. Lose your hall and
you are eliminated but the round continues; when both halls are down, the night
has won.

## Building it

```sh
python3 src/build.py
```

That writes `nightward.html`. There is nothing to install.

`src/d_shell.html` holds the markup, the styles and eight placeholders. Each one
is replaced with the matching module verbatim — that is the entire toolchain,
and the reason the shipped file has no dependencies, no imports and no network
requests.

| file | lines | what it is |
|---|---:|---|
| `d_core.js` | 1716 | palette, the declarative asset definitions, terrain, and the balance table |
| `d_gl.js` | 514 | the renderer: instanced draws, cel shading, shadow maps, the ink-outline pass |
| `d_snd.js` | 221 | WebAudio, synthesised — there are no audio files |
| `d_game.js` | 2929 | simulation, pathing, input, and everything that packs instances for a frame |
| `d_lib.js` | 1070 | the in-game library: inspect and edit any asset or balance number live |
| `d_map.js` | 583 | the map editor |
| `d_net.js` | 248 | the two-player peer connection |
| `d_app.js` | 1129 | screens, HUD, settings |

## How it is put together

**Assets are data, not meshes.** Every building, unit and prop is a list of
primitives — boxes, wedges, gables, cones, cylinders — with positions, sizes and
a shade. A repeat mode gives you mirrored limbs, stacked courses or a ring of
crown points from one entry. Nothing is modelled in an external tool, and the
in-game library can edit any of it while a round is running.

**One draw call per kind of thing.** Everything is instanced through a twelve-float
stride that carries position, yaw, two colours, a scale and a pitch. Hundreds of
attackers cost one draw. Limbs are separate bone batches driven by that per-instance
pitch, which is how a horde walks without a skeleton per body.

**The balance table is the only source of truth.** Every number a unit or
building uses — hit points, reload, range, build time — is defined once, edited
live from the library, and read straight out of that table by both the simulation
and the HUD. There is no second copy to drift.

**Attackers path, defenders steer.** The horde runs a Dijkstra flow field over
the grid, recomputed only when the layout changes, so a wall's path cost is what
pushes them somewhere else and a gate's low cost is what invites them in. Your
own units steer directly and follow walls around obstacles, because a player's
order should be obeyed literally rather than re-planned.

## Licence

MIT — see [LICENSE](LICENSE).
