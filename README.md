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
```

## Controls

| Key | Action |
|---|---|
| W / S (↑ / ↓) | Drive / reverse |
| A / D (← / →) | Steer |
| Space | **Slam** your snowball into whatever is in front (bigger ball = much more damage) |
| Shift | **Dash** — a long burst; hitting a bot mid-dash is a Dash Strike |
| E | **Whirlwind** — spin, pull bots in, blast them out, suck up snow |
| F | **Inferno** fire cone (Classic Plow) or **Thunderclap** lightning blast (VOLT-9) |
| Esc / P | Pause |
| M | Mute |

## Modes

- **Campaign** — five walled arenas. Each is a few rounds of bot minions (scrappers, brute dozers, buzzsaws,
  snow thieves) and then a bot boss with telegraphed attacks: BULLDOZA, FROSTBYTE, THE GRINDER, SLUSH & SLEET,
  and MEGAPLOW Ω. Beating a boss unlocks the next arena.
- **Snowdome Brawl** — a 180 m free-for-all against 8 named rival plows that hunt everyone, including each other.
  Kill streaks multiply your coins (×1.5 → ×4), shutting down a streak pays a bounty, and placement pays a bonus.
  Rookie / Pro / Legend lobbies; elite clan-tagged bots farm streaks, and every bot rolls its own garage around
  your upgrade levels.

Coins from both modes buy permanent upgrades in the Garage. Stat upgrades are **endless**: full-strength gains up
to the pips, then speed/size/cooldown stats taper toward a ceiling while damage, HP and regen keep growing.
**Pilot perks** (Salvage Rig, Second Wind, Wrecking Ball, Adrenaline, Inferno Exhaust, Vitality Core) are
player-only: Brawl bots never roll them into their garages.

**Starter plows** (picked in the Garage): the **Classic Plow** (tough, heavy-hitting, Inferno fire) or the
electric **VOLT-9** (faster, more fragile) with its own upgrade line — Chain Lightning, Tesla Field, Thunderclap
and Battery Shield.

## Project layout

```
src/core      Game loop + mode switching, shared contracts (types.ts), events, input, save/progression
src/config    Tuning data: upgrades (FX curves), campaign bots + arenas, Brawl difficulties
src/entities  Player plow, melee combat resolution, campaign bots/bosses + round director
src/brawl     Brawl mode: rival AI, streaks/coins, respawns, rival models, name tags
src/world     Deformable snow field, arenas / Snowdome environment
src/fx        Particles, camera rig, coin pickups
src/audio     WebAudio synth (SFX + music)
src/ui        Menus, HUD, shop/garage, Brawl HUD
```

## Headless playtests

Each script boots Vite and drives the game in headless Chrome via `window.__game`:

```bash
node scripts/smoke.mjs                 # campaign smoke test + screenshots
node scripts/combat-probe.mjs          # slam / ram / boss numbers
node scripts/brawl-probe.mjs --noshots # Brawl: bot fights, dash/whirl numbers, respawn, match end
node scripts/legend-probe.mjs legend 12   # balance: autopilot player at upgrade level 12 vs a Legend lobby
```

`archive/base-defense-v1.tar.gz` holds the original base-defense prototype this game grew out of.
