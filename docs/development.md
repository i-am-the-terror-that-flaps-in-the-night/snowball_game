# Development

## Project layout

```
src/core           Game loop + mode switching, shared contracts (types.ts), events, input + gamepad, settings,
                   save / progression (export / import, migrations)
src/config         Tuning data: upgrades (FX curves), gear, loot tables, plows, campaign bots + arenas, Brawl, Duel
src/entities       Player plow (Plow.ts), plow models, gear attachments (gearVisuals.ts), campaign bots / bosses,
                   round director, and Combat.ts: the combat class the game talks to (damage in / out, ultimate
                   meter, net sync), which delegates each plow's kit to src/entities/combat/
src/entities/combat  Per-plow kits: melee.ts (slam / ram / dash / whirl), classic.ts, volt.ts, brute.ts, isotope.ts,
                   arsenal.ts, ultimates.ts (SUPERCELL / EARTHQUAKE / MISSILE STORM) and shared.ts (helpers, the
                   threat map ARSENAL's targeting uses)
src/brawl          Brawl mode: rival AI, VOLT-9 + BRUTUS rivals, streaks / coins, respawns, rival models, name tags
src/survival       Survival mode: endless wave generator + scaling (seeded for the Daily run)
src/duel           Online Duel: match flow + host-authoritative netcode (DuelManager), opponent adapter, duel garage
                   wallet (catch-up coins for upgrades and gear)
src/net            Duel wire protocol (binary snapshots / input / snow patches) and the PeerJS + BroadcastChannel
                   transports
src/meta           Meta progression: challenge stars + Hard mode, achievements + lifetime stats, Daily run, cosmetics
src/world          Deformable snow field, arenas / Snowdome environment, destructible props (Props.ts)
src/fx             Particles, camera rig (incl. the ultimate kill-cam swing), impact feel (hit-stop / slow-mo),
                   kill-cam trigger (ultCam.ts), coin pickups
src/render         Post-processing, static mesh merging, shadow proxies, reflections, shader warm-up (warmup.ts;
                   ?nowarm turns it off for measuring)
src/audio          WebAudio synth (SFX + music)
src/ui             Menus, HUD, Garage (core / gear / plow line), loot reveal cards, Brawl HUD, Duel UI, Settings,
                   Tutorial, Paint Shop, Trophies
tests              vitest unit tests (pure logic, no browser)
scripts            Headless playtest probes (Playwright)
```

## Tests

`npm test` runs the vitest suite in `tests/` (no browser; `localStorage` is faked in memory). `npm run typecheck`
runs `tsc --noEmit`. A few suites enforce data rules rather than behaviour, for example `tests/gear.test.ts` (every
gear stat on exactly one item) and `tests/gearVisuals.test.ts` (every item has a look on every plow).

## Headless playtests

Each script boots Vite and drives the game in headless Chromium via `window.__game` (its `tick(dt)` advances the sim
without waiting on real time). In environments with a preinstalled browser, point Playwright at it (for example
`PW_EXE=/opt/pw-browsers/chromium` for the duel, smoke and donald probes; add `PROBE_GPU=0` for the donald probe off
macOS).

```bash
node scripts/smoke.mjs                 # campaign smoke test + screenshots
node scripts/ui-tour.mjs /tmp/ui       # screenshot every menu screen (hub tabs, arenas, garage, shops, HUD, pause)
node scripts/combat-probe.mjs          # slam / ram / boss numbers
node scripts/brawl-probe.mjs /tmp/brawl-probe --noshots # Brawl: bot fights, dash/whirl numbers, respawn, match end
node scripts/meta-probe.mjs            # Paint Shop, Trophies, stars + Hard mode, Daily run + results screens
node scripts/donald-probe.mjs          # arena 5 + THE DONALD: every attack, phase 2, model / stage / crowd shots
node scripts/legend-probe.mjs legend 12   # balance: autopilot player at upgrade level 12 vs a Legend lobby
node scripts/render-probe.mjs baseline    # deterministic render metrics + pixel-diff gate (then: compare); the
                                          # level overhaul renamed a5-* to a6-* (The Omega Works): re-record
                                          # no GPU (cloud container): PW_EXE=/opt/pw-browsers/chromium PROBE_GPU=0
                                          # PROBE_DPR=1 PROBE_LOOPS=3 (pixel diff only, minutes not hours)
node scripts/duel-probe.mjs /tmp/duel-probe  # Duel: two pages over BroadcastChannel (lobby, catch-up garage,
                                             # best of 3, rematch, NUKE / Inferno, ARSENAL, pause, leave, lag)
node scripts/duel-probe.mjs /tmp/duel-probe --only=peer   # same over the real PeerJS cloud server (needs internet)
node scripts/biome-probe.mjs /tmp/biomes   # biome looks: menu / follow / sky / top-down shots of arenas 1-5 and
                                          # the six Brawl venues (--only=0,2 --menu --game --sky --top --brawl;
                                          # --audio plays every ambience loop + the jump / land / slam / lava sounds)
node scripts/terrain-probe.mjs /tmp/terrain  # terrain physics on the dev test terrain (src/world/devTerrain.ts): flat
                                             # parity, ramp airtime + land events, bowl speed, lava 8 HP/s, ice grip,
                                             # conveyor, bots on height / around lava, last-bot hunt;
                                             # plow mid-air + bowl shots.
                                             # Compares the flat drive to scripts/terrain-probe.flat.json (recorded on
                                             # the pre-terrain build; --record-flat rewrites it, known-good builds only)
node scripts/combat3d-probe.mjs /tmp/combat3d  # 3D combat: air slam kills off the dev ramp, stomp damage, a hopping
                                               # plow dodging BULLDOZA's leap shockwave, the leap telegraph draped
                                               # over Inferno Quarry's pit + landing on it (shots); --noshots
node scripts/warmup-probe.mjs            # shader warm-up: program counts before / after each first event (kill,
                                         # Inferno, ARSENAL ultimate, DONALD props, Brawl wreck, quality toggle),
                                         # warm-up on vs ?nowarm (--only=on|off, --scenarios=...); PROBE_GPU=0 off-GPU
```

The realtime lagged-fight session of the duel probe needs a real GPU to keep frame rate; on software rendering it
can fail even when nothing is wrong.

## UI look and the menu hub

All UI colours, fonts and shapes are tokens on `.ss-root` at the top of `src/ui/ui.css` ("road crew": asphalt
slabs, hazard yellow, signal red, condensed display type, chamfered corners via `clip-path: var(--chamfer)`). Use the
tokens rather than raw hex. Because `clip-path` clips outlines, focus is drawn with inset box-shadows. Fonts are
bundled from `@fontsource` (`src/ui/fonts.css`), so the game needs no network for them.

The main menu is a hub: category tabs (PLAY / BUILD / RECORD / SYSTEM, Q/E to switch) over a tile grid. A new
destination is one `this.tile(category, icon, name, subtitle, onClick)` call in `UI.buildMenu`; `hero`, `tall`, `wide`
and `hot` size or accent it, and icons are line SVGs in `src/ui/icons.ts`. Coins, sound and settings sit in the
top-right utility strip on every tab.

## Balance harness

`npm run balance` runs the headless balance sim (`scripts/balance/sim.ts`, its own vitest config
`scripts/balance.config.ts`, so it is not part of `npm test`). For each plow at three garage tiers it reports
single-target and cluster DPS, ultimate fill time and damage, and Duel time-to-kill. A few invariants from it (ultimate
fill floors, Duel kill-time floor, minigun cap) run in `npm test` via `tests/balance.test.ts`. Results and reasoning
are in [balance.md](balance.md).

## History

The original base-defense prototype this game grew out of is kept at the `base-defense-v1` git tag
(`archive/base-defense-v1.tar.gz` in that commit).
