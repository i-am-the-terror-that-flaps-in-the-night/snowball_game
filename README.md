# Snowplow Showdown

A Three.js + TypeScript browser brawler. Plow snow into a snowball on your blade — it's your weapon and your
shield — then fight bots up close: slam the ball into them, ram them, dash-strike through them, and spin a
whirlwind. No projectiles, no base to defend: just plows.

Everything is procedural — models, textures, sound effects and music are generated in code, no asset files.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173  (add ?debug for 100k coins + every arena unlocked)
npm run build      # typecheck + production build into dist/
npm test           # vitest unit tests (tests/*.test.ts)
```

## Controls

| Key | Gamepad | Action |
|---|---|---|
| W / S (↑ / ↓) | Left stick / d-pad, RT / LT | Drive / reverse |
| A / D (← / →) | Left stick / d-pad | Steer |
| Space | A | **Slam** your snowball into whatever is in front (bigger ball = much more damage) |
| Shift | B / RB | **Dash** — a long burst; hitting a bot mid-dash is a Dash Strike |
| E | X | **Whirlwind** — spin, pull bots in, blast them out, suck up snow |
| F | Y | **Inferno** fire cone (Classic Plow), **Thunderclap** lightning blast (VOLT-9; small self-shock that escalates fast if you chain-spam it — the meter over the F icon shows the next clap's cost) or **Ground Pound** hop-and-slam shockwave (BRUTUS) |
| Esc / P | Start | Pause |
| M | | Mute |

Keys can be rebound in **⚙ Settings** (arrows, right Shift and Esc stay as fixed alternates; Esc and M can't be
bound). In menus the gamepad d-pad / stick moves, A selects and B goes back. The controls lists, HUD key labels
and tutorial cards follow your bindings.

## Settings & save

**⚙ Settings** (main menu or pause menu) has master / music / SFX volume, screen-shake strength, LOW / HIGH
graphics (LOW = 1x pixel ratio, no shadows), key rebinding and save management: **EXPORT** (an `SPS1:` code,
copied to the clipboard), **IMPORT** (validated; a bad code leaves your save untouched) and **RESET PROGRESS**
(click twice). Settings live in localStorage separately from progress.

## Modes

- **Campaign** — five walled arenas. Each is a few rounds of bot minions (scrappers, brute dozers, buzzsaws,
  snow thieves) and then a bot boss with telegraphed attacks: BULLDOZA, FROSTBYTE, THE GRINDER, SLUSH & SLEET,
  and MEGAPLOW Ω. Beating a boss unlocks the next arena.
- **Snowdome Brawl** — a 180 m free-for-all against 8 named rival plows that hunt everyone, including each other.
  Kill streaks multiply your coins (×1.5 → ×4), shutting down a streak pays a bounty, and placement pays a bonus.
  Rookie / Pro / Legend lobbies; elite clan-tagged bots farm streaks, and every bot rolls its own garage around
  your upgrade levels. Some rivals roll as VOLT-9s (⚡ name badge, VOLT wedge body) with a telegraphed bot
  Thunderclap, others as BRUTUS (🦏 badge, tracked dozer) with a telegraphed hop-and-slam Ground Pound (damage ring,
  outward knockback, short stun) — get out of the amber ring.
- **Survival** (unlocked by beating arena 1) — endless waves in the Frozen Foundry. Bot HP, damage and coins scale
  every wave, a boss arrives every 5th wave (cycling the campaign bosses, with escorts on later loops), and you
  get a short breather plus a partial repair between waves. Your best wave is saved.
- **Tutorial** — a 7-step guided Training Yard (drive, snowball, slam, dash, whirlwind, your plow's F ability,
  ball-shield). Runs once on a fresh save; replay it from **🎓 TUTORIAL** on the main menu, Esc skips.

Coins from both modes buy permanent upgrades in the Garage. Stat upgrades are **endless**: full-strength gains up
to the pips, then speed/size/cooldown stats taper toward a ceiling while damage, HP and regen keep growing.
**Pilot perks** (Salvage Rig, Second Wind, Wrecking Ball, Adrenaline, Inferno Exhaust, Vitality Core, Overclock)
are player-only: Brawl bots never roll them into their garages. Overclock tops out at -60% cooldowns, and no
ability ever recharges faster than 0.35s.

**Starter plows** (picked in the Garage): the **Classic Plow** (+25% HP, free Inferno fire on F that grows with Packed Ice and its own Inferno Exhaust upgrade) or the
electric **VOLT-9** (faster, more fragile) with its own upgrade line — Chain Lightning, Tesla Field, Thunderclap
and Battery Shield — or the armored **BRUTUS** (+35% HP, +20% damage, bigger blade; sluggish to accelerate) with a free Ground Pound on F (AoE damage ring, short knockback, stun) and its own line —
Ground Pound, Iron Hide (less damage taken), Momentum (rams and dash strikes scale with speed) and Buzzsaws
(spinning saws on the blade ends that shred every bot in front of and beside you).

## Project layout

```
src/core      Game loop + mode switching, shared contracts (types.ts), events, input + gamepad, settings,
              save/progression (export / import)
src/config    Tuning data: upgrades (FX curves), plows, campaign bots + arenas, Brawl difficulties
src/entities  Player plow, melee combat resolution, campaign bots/bosses + round director
src/brawl     Brawl mode: rival AI, VOLT-9 + BRUTUS rivals, streaks/coins, respawns, rival models, name tags
src/survival  Survival mode: endless wave generator + scaling
src/world     Deformable snow field, arenas / Snowdome environment
src/fx        Particles, camera rig, coin pickups
src/audio     WebAudio synth (SFX + music)
src/ui        Menus, HUD, shop/garage, Brawl HUD, Settings overlay, Tutorial
tests         vitest unit tests: upgrade costs/curves, brawlHit, computeStats, save import/export, settings
```

## Tests

`npm test` runs the vitest suite in `tests/` (pure logic, no browser; `localStorage` is faked in-memory).

## Headless playtests

Each script boots Vite and drives the game in headless Chrome via `window.__game`:

```bash
node scripts/smoke.mjs                 # campaign smoke test + screenshots
node scripts/combat-probe.mjs          # slam / ram / boss numbers
node scripts/brawl-probe.mjs --noshots # Brawl: bot fights, dash/whirl numbers, respawn, match end
node scripts/legend-probe.mjs legend 12   # balance: autopilot player at upgrade level 12 vs a Legend lobby
```

`archive/base-defense-v1.tar.gz` holds the original base-defense prototype this game grew out of.
