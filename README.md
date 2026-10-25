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
graphics (LOW = 1x pixel ratio, no shadows; Brawl on HIGH caps the pixel ratio at 1.5x, halves the shadow map and uses a cheaper snow shader for frame rate), key rebinding and save management: **EXPORT** (an `SPS1:` code,
copied to the clipboard), **IMPORT** (validated; a bad code leaves your save untouched) and **RESET PROGRESS**
(click twice). Settings live in localStorage separately from progress.

## Modes

- **Campaign** — five walled arenas. Each is a few rounds of bot minions (scrappers, brute dozers, buzzsaws,
  snow thieves) and then a bot boss with telegraphed attacks: BULLDOZA, FROSTBYTE, THE GRINDER, SLUSH & SLEET,
  and MEGAPLOW Ω. Beating a boss unlocks the next arena. Every arena has **3 challenge stars** and, once cleared,
  a **Hard mode** (see Meta progression).
- **Snowdome Brawl** — a 180 m free-for-all against 8 named rival plows that hunt everyone, including each other.
  Kill streaks multiply your coins (×1.5 → ×4), shutting down a streak pays a bounty, and placement pays a bonus.
  Rookie / Pro / Legend lobbies; elite clan-tagged bots farm streaks, and every bot rolls its own garage around
  your upgrade levels. Some rivals roll as VOLT-9s (⚡ name badge, VOLT wedge body) with a telegraphed bot
  Thunderclap, others as BRUTUS (🦏 badge, tracked dozer) with a telegraphed hop-and-slam Ground Pound (damage ring,
  outward knockback, short stun) — get out of the amber ring.
- **Survival** (unlocked by beating arena 1) — endless waves in the Frozen Foundry. Bot HP, damage and coins scale
  every wave, a boss arrives every 5th wave (cycling the campaign bosses, with escorts on later loops), and you
  get a short breather plus a partial repair between waves. Your best wave is saved.
- **Daily run** (📅 DAILY, unlocked with Survival) — one seeded Survival run per day: the same wave lineup for
  everyone on that date, plus one of 8 modifiers (Deep Snow, Whiteout, Swarm, Thief Night, Boss Rush, Heavy
  Hitters, Glass Cannon, Overclocked) that rotate so none repeats two days running. Pays ×1.25 coins. Your best
  wave for each day is saved separately from normal Survival, and the game-over screen shows the last 7 days.
- **Tutorial** — a 7-step guided Training Yard (drive, snowball, slam, dash, whirlwind, your plow's F ability,
  ball-shield). Runs once on a fresh save; replay it from **🎓 TUTORIAL** on the main menu, Esc skips.

## Meta progression

- **Challenge stars** — 3 per arena (15 total): slam kills, ball size, clear times, combos, damage limits,
  boss-fight speed and a few plow-specific goals. They're judged on any winning run (normal or Hard), shown on
  the arena cards and the results screen, and each new star pays a one-time bonus (+75 to +600 by arena).
- **Hard mode** — opens once an arena is cleared: ×1.8 bot HP, ×1.5 bot damage, ~35% more minions, same boss,
  ×1.75 coins. The first Hard clear pays 2.5× the arena's clear reward (repeats 0.6×) and earns a 💀 badge on
  its card. Hard clears never change unlocks.
- **🏆 Trophies** — 46 achievements (Campaign, Combat, Bosses, Brawl, Survival, Plows, Garage & loot) paying
  25–500 coins each, plus a lifetime STATS page. Unlocks are re-checked from the save, so old saves and imports
  get credit for what they've already done. Tutorial fights don't count.
- **🎨 Paint Shop** — 8 paints, 5 decals and 5 exhaust trails for your plow (all three starter plows), 150–2000
  coins. Purely visual; five premium items also need challenge stars or achievements. Hover or focus an item to
  preview it on the plow before buying.

Coins from every mode buy permanent upgrades in the Garage. Stat upgrades are **endless**: full-strength gains up
to the pips, then speed/size/cooldown stats taper toward a ceiling while damage, HP and regen keep growing.
**Pilot perks** (Salvage Rig, Second Wind, Wrecking Ball, Adrenaline, Last Stand, Overclock) are player-only:
Brawl bots never roll them into their garages. Wrecking Ball only matters in Brawl (it raises the Brawl hit cap).
Last Stand makes you hit harder and take less damage below 35% HP. Overclock cuts every cooldown — slam, dash,
whirl and your plow's F ability — by up to -60%, and no ability ever recharges faster than 0.35s.

**Starter plows** (picked in the Garage): the **Classic Plow** (+25% HP, free Inferno fire on F) with its own line — Inferno Exhaust
(hotter, faster fire), Shatter Slam (slams throw ice shards at bots around the impact), Snow Reserve (keep part of
your ball after a slam) and Slam Combo (back-to-back slams hit harder, stacking up to 3 times) — or the
electric **VOLT-9** (faster, more fragile) with its own upgrade line — Chain Lightning, Tesla Field, Thunderclap
and Battery Shield — or the armored **BRUTUS** (+35% HP, +20% damage, bigger blade; sluggish to accelerate) with a free Ground Pound on F (AoE damage ring, short knockback, stun) and its own line —
Ground Pound, Iron Hide (less damage taken the faster you're going), Momentum (rams and dash strikes scale with
speed) and Buzzsaws (spinning saws on the blade ends that shred every bot in front of and beside you).

The Garage is split into tabs (Drive, Snowball, Defense, Pilot, and your current plow's own line), each with a
count of upgrades you can afford; switch with Q / E or LB / RB. Hover a card for the full mechanics of that upgrade.

## Project layout

```
src/core      Game loop + mode switching, shared contracts (types.ts), events, input + gamepad, settings,
              save/progression (export / import)
src/config    Tuning data: upgrades (FX curves), plows, campaign bots + arenas, Brawl difficulties
src/entities  Player plow, melee combat resolution, campaign bots/bosses + round director
src/brawl     Brawl mode: rival AI, VOLT-9 + BRUTUS rivals, streaks/coins, respawns, rival models, name tags
src/survival  Survival mode: endless wave generator + scaling (seeded for the Daily run)
src/meta      Meta progression: challenge stars + Hard mode, achievements + lifetime stats, Daily run, cosmetics
src/world     Deformable snow field, arenas / Snowdome environment
src/fx        Particles, camera rig, coin pickups
src/audio     WebAudio synth (SFX + music)
src/ui        Menus, HUD, shop/garage, Brawl HUD, Settings overlay, Tutorial, Paint Shop, Trophies
tests         vitest unit tests: upgrade costs/curves, brawlHit, computeStats, save import/export, settings
```

## Tests

`npm test` runs the vitest suite in `tests/` (pure logic, no browser; `localStorage` is faked in-memory).

## Headless playtests

Each script boots Vite and drives the game in headless Chrome via `window.__game`:

```bash
node scripts/smoke.mjs                 # campaign smoke test + screenshots
node scripts/combat-probe.mjs          # slam / ram / boss numbers
node scripts/brawl-probe.mjs /tmp/brawl-probe --noshots # Brawl: bot fights, dash/whirl numbers, respawn, match end
node scripts/meta-probe.mjs            # Paint Shop, Trophies, stars + Hard mode, Daily run + results screens
node scripts/legend-probe.mjs legend 12   # balance: autopilot player at upgrade level 12 vs a Legend lobby
```

The original base-defense prototype this game grew out of is kept at the `base-defense-v1` git tag
(`archive/base-defense-v1.tar.gz` in that commit).
