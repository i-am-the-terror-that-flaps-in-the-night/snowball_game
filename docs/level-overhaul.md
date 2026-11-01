# Level overhaul plan

Status: in progress. This is the agreed design; keep it updated as work lands.

Goal: move the campaign off "snow only" into six distinct biomes, add real 3D movement (slopes, jumps, air slam, boss
leap), and finish on a huge multi-level factory. Most changes are cosmetic or additive; the core loop (plow snow into
a ball, slam bots, upgrade) stays.

## Arenas

| # | Save id | Name | Boss | Biome | Terrain | Hazard |
|---|---|---|---|---|---|---|
| 1 | `yard` | **Coldboot Glacier**: *A rogue AI froze the relay station solid.* | FROSTBYTE (slight nerf) | Snow and ice: glacier relay station, frozen server racks, aurora sky | Gentle: two low ice ramps, shallow bowl | Ice sheets (slippery) |
| 2 | `junkyard` | **Inferno Quarry**: *The Yard Boss moved somewhere hotter.* | BULLDOZA (slight buff, phase-2 leap) | Lava hellscape: black basalt, lava rivers, ash fall, red smoke sky | Moderate: central quarry pit, lava rivers with jump ramps, berms | Lava, 8 HP/s (bots too) |
| 3 | `foundry` | **Rust Basin**: *Something huge is drilling under the red dust.* | THE GRINDER | Mars wasteland: rust dunes, craters, mesas, dust haze, pale sun | Big: overlapping craters, dunes, mesa ramps | Low gravity (x0.6) |
| 4 | `bowl` | **The Thermal Divide**: *Twins. One runs hot, one runs cold.* | SLUSH & SLEET | Split: red geothermal half, frozen blue half | Light: shallow central dip, a couple of small ramps | Lava vents (hot side), ice (cold side) |
| 5 | `plaza` | **Golden Tower Plaza**: *A very big rally. The biggest. Everybody says so.* | THE DONALD | Summer rally: gold, banners, crowd; confetti instead of snow | Flat; the Donald's walls are the terrain | None beyond his attacks |
| 6 | `summit` | **The Omega Works**: *The final machine builds itself.* | MEGAPLOW Ω | Neon mega-factory at night: chrome, glowing circuit floor, pistons | Huge (160 x 160 m) multi-level: decks, bridges, overhangs, ramps, pistons, conveyors | Conveyors, pistons |

### Swaps and saves

- **1 <-> 2 swap:** the slot keeps its rounds, difficulty multipliers, rewards, challenges and save id. Only the boss,
  look and name move. Arena 1 stays the intro (scrappers + a brute). No save migration.
- **5 <-> 6 swap:** the Plaza's rounds use themed `rallybot`s and its challenges are Donald jokes, so its rounds,
  challenges and save id (`plaza`) move with it to slot 5; Omega's move to slot 6 (`summit`). `unlockedZones` is a
  prefix count, so a pre-Plaza save (5 arenas, Omega cleared, `unlockedZones` 5) would leave the cleared Works locked
  past the prefix. Loading (localStorage and import) therefore opens every arena up to the highest cleared one:
  `unlockedZones = max(unlockedZones, highestClearedIndex + 1)` (`openClearedArenas` in `src/core/Progression.ts`).
- Boss HP already shifts with the slot multipliers (x1.0 / x1.2 / ... / x2.1 / x2.4):
  FROSTBYTE 960 -> 800 effective, BULLDOZA 650 -> 780, THE DONALD 6240 -> 5460, MEGAPLOW 5040 -> 5760. On top:
  FROSTBYTE speed 7 -> 6.5, ram 18 -> 16; BULLDOZA armour 3 -> 4, ram 26 -> 28. Verify with `npm run balance`.
- Rename boss-flavoured challenge / trophy titles that no longer fit (ids unchanged).

### Other modes

- **Brawl:** random biome per match (plus the classic Snowdome), ground terrain only (no decks). Rival plows use ramps.
- **Duel:** same biome pool, host picks or random. Height, vertical speed and ARSENAL aim are synced.
- **Survival / Daily:** biome rotates every 5 waves, ground terrain only.
- **Tutorial:** new steps for slopes, a ramp jump and an air slam (arena 1 is now the glacier).
- **Main menu backdrop:** a random campaign biome each launch.

## Systems

### Biomes (`ZoneDef.biome`)

Per arena: ground and snow tint, particles (snowfall, embers, dust, confetti), sky / fog / light, prop set, hazard
visuals, ambience. The plowable layer is still snow and is still called "Snowball"; it is tinted per biome (ash-grey in
the quarry, rusty CO₂ frost on Mars, confetti colours at the Plaza).

### Terrain (`src/world/Terrain.ts`, `ctx.terrain`, `ZoneDef.terrain`)

- Ground: analytic shapes (ramp, dome / bowl / crater, ridge / trench, mesa) summed into one height per (x, z).
- Decks (arena 6 only): oriented slabs with a top (flat or sloped), thickness and optional piston motion. Bridges you
  drive under, blocks you cannot climb, ramps between levels, ceilings you bonk on.
- Material patches (ice, lava) and conveyor strips. Gravity multiplier per arena.
- Every entity calls `surfaceAt(x, z, y)`; movement also uses `wallAt` / `pushOut` / `ceilingAt`; 3D weapons use
  `raycast` / `lineOfSight`. Default terrain is flat, so adoption is behaviour-neutral until an arena defines shapes.
- Snow depth lies on the ground layer only (never on decks).

### Movement

- **Slopes:** gravity along the slope (`-g * grad`) for plows, bots, loose balls and coins: faster going into a dip,
  slower climbing out.
- **Jumps:** plows have vertical velocity. When the ground falls away faster than gravity can follow (a ramp lip or
  crest at speed), you are airborne. No jump button. In the air: reduced steering, no plowing, ball kept.
- **Landing:** puff, camera thump, **stomp** damage to a bot underneath.
- **Air slam:** slam while airborne to dive; bigger shockwave on landing. Stacks with BRUTUS's Ground Pound.
- **Boss leap:** BULLDOZA phase 2 leaps and lands with a shockwave; MEGAPLOW leaps onto decks to stop camping.
- **Hazards:** ice = low grip, long drifts (bots too); lava = 8 HP/s burn (bots too; bots steer around it unless knocked
  in); low gravity in Rust Basin; conveyors push.
- **Height checks on every hit:** ground attacks (rams, slams, whirlwind, Inferno, Thunderclap, Ground Pound, meltdown)
  only hit targets near your height. High airborne plows dodge ground attacks.

### Camera and feel

- Camera follows height and handles occlusion (pulls in / fades geometry between it and the plow; decks overhead go
  see-through). Same for the kill-cam.
- Setting: "Reduce screen shake" (landings, slams).
- Audio: jump, land, air-slam sounds; per-biome ambience (wind, lava rumble, Mars dust, factory clanks).

### Lost-bot help (every arena)

Minimap during fights (reuses the Brawl minimap; bots above you hollow, below solid), off-screen arrows when 3 or
fewer bots remain, and the last 2 bots route straight to you.

### The Omega Works (arena 6)

- 160 x 160 m. A ring of ground-level snow fields around a raised factory core of decks, bridges and overhangs; pistons
  and conveyors. Snow grid ~25,600 cells (Brawl is 32,400).
- Bots spawn within ~35 m of the player. Gates scale with arena size.
- Bot routing: hand-placed waypoint graph (deck centres, ramp ends, ground points); BFS when the target is on another
  level, direct steering on the same level.
- Structures are merged or instanced; draw distance is fog-limited.

### ARSENAL in 3D

- Minigun: pitch -35° to +45° on top of the 360° turn; holds fire outside that range (lets you shoot down from
  the Assembly Floor at bots about 11 m away and up at it from about 6 m).
- Laser: aims anywhere within 80° of straight ahead (down limited to about -15°); stops at the first deck / ground hit.
- Missiles: full 3D homing on any target on any level; if a deck is in the way they swing around its edge and dive.
- Pitch / aim synced in Duel.
- **Arena 6 balance check (after it is playable):** extend the autopilot balance script (`scripts/legend-probe.mjs`)
  with a full Omega Works clear per plow at equal upgrade levels; compare clear time and damage taken. If ARSENAL
  trails: more HP in arena 6 only (zone multipliers) or widen the minigun to -45° / +60°. If it leads clearly: trim
  missile damage / lengthen the reload only where decks exist.

### Challenges and trophies

Retune time-based challenges for terrain and arena 6's size. Add biome challenges ("3 lava kills", "2 s of airtime",
"air-slam kill"). New trophies: airtime, lava kills, air-slam kills.

### Tests and probes

Probes and tests that assume arena positions (for example `scripts/donald-probe.mjs` expects THE DONALD in arena 6)
are updated with the swaps. The render-probe baseline is re-recorded.

## Work split

| Track | Owner | Scope | Owns (edits) |
|---|---|---|---|
| Foundation | lead | `Terrain` contract + `ctx.terrain` wiring, this plan | `src/world/Terrain.ts`, `tests/terrain.test.ts` |
| A. Swap and content | agent | Arena order / names / taglines / boss tuning, challenge + trophy retune and new ones, probes and tests | `src/config/zones.ts` (order, names, rounds), `src/config/enemies.ts` (stats), `src/config/challenges.ts`, `src/config/achievements.ts`, `src/config/duel.ts`, `scripts/*.mjs`, affected tests |
| B. Biomes and arenas 1-5 | agent | Biome system, arena sets 1-5 (terrain data, props, sky, particles, hazard visuals), Brawl / Duel / Survival / Daily biome rotation, menu backdrop, ambience | `src/world/Environment.ts`, `src/world/SnowField.ts` (tint), `src/fx/particles.ts`, `src/audio/Audio.ts` (ambience), `ZoneDef.biome` + `terrain` data for arenas 1-5 / Brawl |
| C. Terrain physics | agent | Plow + bot + ball + coin movement on terrain, slopes, airtime, landing, hazards (ice / lava / gravity / conveyors), bot hazard avoidance, camera height + occlusion, reduce-shake setting, Duel sync of height | `src/entities/Plow.ts` (movement), `src/entities/Enemies.ts`, `src/entities/enemies/ai.ts`, `src/fx/CameraRig.ts`, `src/net/protocol.ts`, `src/ui/Settings.ts`, pickups / balls |
| D. Combat in 3D | agent | Height checks on every hit, stomp, air slam, Ground Pound synergy, BULLDOZA leap, telegraphs on slopes, jump / land / air-slam sounds | `src/entities/Combat.ts`, `src/entities/combat/*` (not `arsenal.ts`), `src/entities/enemies/bosses.ts` |
| E. Modes and UX | agent | Minimap + lost-bot arrows + last-bot hunt in every arena, Tutorial steps, Brawl rivals using ramps | `src/ui/*` HUD bits, `src/ui/Tutorial.ts`, `src/brawl/BrawlManager.ts`, `src/core/Game.ts` (mode wiring) |
| F. The Omega Works + ARSENAL 3D | lead | Arena 6: size, decks, bridges, pistons, conveyors, waypoint routing, camera fade, spawns, MEGAPLOW anti-camping; minigun / laser / missile 3D aim | `src/world/omega/*`, `src/entities/combat/arsenal.ts`, arena 6 data |

Integration order: A lands first (small); B, C, D, E run in parallel on top of it; F builds on C's movement. Each track
runs `npx tsc --noEmit`, `npx vitest run`, and its relevant probe before handing back.

## Follow-ups

Deferred from Track A (an independent check listed them). Owner track in brackets; **Done** items are kept for the
record.

- **Done. [B] Survival / Daily base zone:** `src/survival/SurvivalManager.ts` spreads `ZONES[2]` (Rust Basin) as its base, so
  it will inherit that arena's terrain, low gravity and biome. Build it from an explicit neutral zone and pin biome /
  terrain per 5-wave rotation (ground only). Fix the stale "Frozen Foundry scenery" comment; optionally start the boss
  cycle with FROSTBYTE. `tests/daily.test.ts` also uses `ZONES[2]`. *Landed:* `SURVIVAL_BASE` is an explicit neutral
  zone; the biome (look + ground terrain) rotates every 5 waves in campaign order (glacier first, so FROSTBYTE closes
  the first block), the Daily seeds its start biome, and a biome switch re-seats the plow with `Plow.reset()` (keeps
  the run's hp only).
- **[C] `run.airtime` stat** (plus its lifetime counterpart in `src/meta/achievements.ts`), for the airtime challenge
  and trophy.
- **[D] `killsBy.lava` and `killsBy.airSlam`** (new `KillSource` values in `src/core/events.ts` plus lifetime stats),
  for the lava / air-slam challenges and trophies.
- **Done. [E] Tutorial zone and menu backdrop:** `src/core/Game.ts` `TUTORIAL_ZONE`, the menu backdrop zone and the
  menu / default `ctx.zone` spread `ZONES[0]` and will inherit the glacier's terrain and ice. Pin an explicit flat
  tutorial zone (`terrain: undefined`, fixed look) and pick the backdrop from a random campaign biome per launch.
  *Landed:* `TUTORIAL_ZONE` and `pickMenuZone` in `src/core/modeZones.ts`.
- **[A, after C / D and terrain land] Challenges and trophies:** add the three biome challenges ("3 lava kills",
  "2 s of airtime", "air-slam kill") and three trophies (airtime, lava kills, air-slam kills), then retune the
  time-based challenges for terrain and arena 6's size (the `TODO`s in `src/config/challenges.ts`). Until then Inferno
  Quarry's "Eviction Notice" (30 s boss kill) is temporarily loose: BULLDOZA dies in about 9-14 s on autopilot.
- **[B, deviation] Duel venue:** "Other modes" says the Duel host picks the venue or it is random. As built, both peers
  derive it from the room code (`duelVenueFor` in `src/config/duel.ts`, FNV-1a over the code), so it is effectively
  random and needs no protocol message, but the host cannot choose. A host choice can ride in the host's hello (a venue
  key) later, with `duelVenueFor` kept as the default.
