# Modes

## Campaign

Six walled arenas. Each is a few rounds of bot minions (scrappers, brute dozers, buzzsaws, snow thieves) and then a
bot boss with telegraphed attacks. Beating a boss unlocks the next arena.

| # | Arena | Boss |
|---|---|---|
| 1 | Coldboot Glacier: *A rogue AI froze the relay station solid.* | FROSTBYTE |
| 2 | Inferno Quarry: *The Yard Boss moved somewhere hotter.* | BULLDOZA |
| 3 | Rust Basin: *Something huge is drilling under the red dust.* | THE GRINDER |
| 4 | The Thermal Divide: *Twins. One runs hot, one runs cold.* | SLUSH & SLEET |
| 5 | Golden Tower Plaza: *A very big rally. The biggest. Everybody says so.* | THE DONALD |
| 6 | The Omega Works: *The final machine builds itself.* | MEGAPLOW Ω |

THE DONALD is a gold-and-white caricature plow in a red cap: it builds snow-brick walls you smash with slams or
dashes, deports you to the far edge with a tractor beam, rallies a ring of red-cap bots at its podium, and goes GOLD
PLATED at half HP. The arenas are mid-way through a biome overhaul (glacier, lava, Mars, hot / cold split, summer
rally, neon factory; see [level-overhaul.md](level-overhaul.md)): names, bosses and order are final, the new looks and
terrain are landing arena by arena.

Every arena has **3 challenge stars** and, once cleared, a **Hard mode**:

- **Challenge stars**: 3 per arena (18 total): slam kills, ball size, clear times, combos, damage limits, boss-fight
  speed and a few plow-specific goals. They're judged on any winning run (normal or Hard), shown on the arena cards
  and the results screen, and each new star pays a one-time bonus (+75 to +800 by arena).
- **Hard mode**: ×1.8 bot HP, ×1.5 bot damage, about 35% more minions, the same boss, ×1.75 coins. It scales with
  your plow past mid-game: your power is the average effective level (Garage + gear) of the core four upgrades and
  your plow's own line. Up to 4 nothing changes; each level above that adds +15% bot HP and +8% bot damage, capped at
  10 levels (×2.5 HP, ×1.8 damage on top). A late-game garage (about level 9) faces about ×1.75 HP and ×1.4 damage.
  The Hard button's tooltip shows your current numbers. The first Hard clear pays 2.5× the arena's clear reward
  (repeats 0.6×) and earns a 💀 badge on its card. Hard clears never change unlocks.

Boss clears drop gear: the first clear always does, repeat clears sometimes, and Hard clears with better odds (always on the first Hard clear)
(see [progression.md](progression.md#loot)).

## Snowdome Brawl

A 180 m free-for-all against 8 named rival plows that hunt everyone, including each other. Kill streaks multiply your
coins (×1.5 → ×4), shutting down a streak pays a bounty, and placement pays a bonus. Rookie / Pro / Legend lobbies;
elite clan-tagged bots farm streaks, and every bot rolls its own garage around your upgrade levels. Some rivals roll
as VOLT-9s (⚡ name badge) with a telegraphed Thunderclap, others as BRUTUS (🦏 badge) with a telegraphed
hop-and-slam Ground Pound; get out of the amber ring.

One hit can take at most 60% of a fighter's max HP (a smooth taper, so small hits are barely affected); the player's
own hits on rivals cap at 75%. 1st place always drops gear, 2nd and 3rd sometimes.

## Survival

Unlocked by beating arena 1. Endless waves in arena 3's layout (Rust Basin). Bot HP, damage and coins scale every wave, a boss
arrives every 5th wave (cycling the campaign bosses, with escorts on later loops), and you get a short breather plus
a partial repair between waves. Named special waves (Swarm, Thief Raid, Blitz, Saw Storm, Heavy Metal, Elite Squad)
break up the mix about twice per boss cycle and pay extra, and the between-wave pit stop previews what's next.
**🏁 END RUN** at the pit stop banks the run on the wave you just cleared. Your best wave is saved, overall and per
plow (the results screen lists every plow's record, the menu tile shows the selected plow's). Boss waves can drop gear,
with the chance rising the deeper you go.

**Wave modifiers**: from wave 7, every 3rd wave (never a boss or milestone wave) rolls one announced twist, shown
with a banner at the countdown, previewed at the pit stop and tagged on the HUD while it lasts. They can ride on a
special wave unless the pair would double up.

| Modifier | From | Effect | Coins |
|---|---|---|---|
| 🌨️ Blizzard | 7 | Whiteout gale: fog closes in to ~58 m, dense wind-driven snow; bots drive 15% slower | ×1.2 |
| ⏩ Overdrive | 7 | Bots drive 25% faster | ×1.25 |
| 💰 Gold Rush | 7 | Nothing else | ×2 |
| 🔩 Armored | 10 | Bots +50% HP | ×1.35 |
| 🐜 Horde | 13 | Twice the spawn budget and bot cap (at most 48), half HP (never on Swarm / Elite Squad) | ×0.65 per kill |
| 😡 Frenzy | 13 | Spawns come twice as fast, bots hit 20% harder (never on Blitz) | ×1.3 |

The coin multiplier covers kill coins and the wave bonus. The pick rotates through the table from a per-run offset
(from the seed on the Daily, so everyone gets the same ones).

**Milestones** (every 10th wave): a campaign boss at 45% HP (FROSTBYTE, BULLDOZA or THE GRINDER, never a copy of the
wave's own boss) rolls in 8 s after the wave's lineup; twin-boss waves skip it (two boss bars). The pit stop names the
coming mini-boss. Clearing a milestone
pays 150 + 15 × wave coins, repairs 40% of max HP, always drops gear (better odds than a boss wave) and gives an 8 s
breather into the next wave.

**Daily run** (📅 DAILY, unlocked with Survival): one seeded Survival run per day, with the same wave lineup for
everyone on that date plus one of 8 modifiers (Deep Snow, Whiteout, Swarm, Thief Night, Boss Rush, Heavy Hitters,
Glass Cannon, Overclocked) that rotate so none repeats two days running. It pays ×1.25 coins. Your best wave for each
day is saved separately from normal Survival, and the game-over screen shows the last 7 days.

## Duel

An online best-of-3 against a friend in a shrunk Snowdome (Brawl's venues at 120 m, two thirds of the dome), with
ultimates that charge in about a round and carry over between rounds. See [duel.md](duel.md).

## Tutorial

A 7-step guided Training Yard (drive, snowball, slam, dash, whirlwind, your plow's F ability, ball shield). It runs
once on a fresh save; replay it from **🎓 TUTORIAL** on the main menu, and Esc skips it. ARSENAL has no snowball, so
when it's selected the Tutorial trains you on the Classic Plow.

## Destructible props

Campaign and Survival arenas have 14 wooden crates and ice blocks (the Brawl Snowdome has 26) that block movement
until they break. Ram one at speed or dash through it; slams, whirlwinds, every F ability and ultimate, missiles,
the laser and stray pulse-laser bolts smash them too. Bots break them as well: a bot you knock flying into one, a heavy
or boss mid-charge, or a Brawl rival dashing or driving fast. Broken props drop a couple of coins outside Brawl when
you caused the break, either directly or by knocking a bot into it. A bot breaking one under its own power drops
nothing. Everything stands back up each round. Props have only two states (standing / broken): one InstancedMesh
per prop type and a circle collider each, with no physics. There are none in the Duel or the Tutorial.

## Settings and save

**⚙ Settings** (main menu or pause menu) has master / music / SFX volume, screen-shake strength, graphics quality
(below), bloom, reduced flashes, the **Ultimate kill-cam** toggle, key rebinding and save management:
**EXPORT** (an `SPS1:` code, copied to the clipboard), **IMPORT** (validated; a bad code leaves your save untouched)
and **RESET PROGRESS** (click twice). Settings live in localStorage separately from progress.

**Graphics quality.** Every lever of a tier is in one table, `preset()` in `src/core/settings.ts`:

| | HIGH (default) | MEDIUM | LOW |
|---|---|---|---|
| Pixel ratio cap (Brawl / Omega Works) | 2× (1.5×) | 1.5× (1.5×) | 1× |
| Sun shadows (map size, Brawl dome) | on, 2048 (1024) | on, 1024 (1024) | off |
| Bloom (with the Bloom setting on) | on | off | off |
| Impact flash lights | on | on | hidden |
| Particle bursts / sparks / smoke / spray | 100% | 100% | 50% |
| Black-hole lens screen grab | on | on | off (undistorted fallback) |
| Weather particles | 100% | 100% | 50%, no dust / steam haze |
| Stadium crowd | 100% | 100% | 50% |

Brawl also uses a cheaper snow shader and bloom chain on every tier. Pixel ratio, shadows, bloom, lights,
particles and the lens change at once; weather and crowd are built with the arena, so they change from the next
arena. The crowd is thinned only after the full list is built, so the rest of the venue (flags etc., which share
its seeded random stream) stays where it is. **AUTO** (opt-in, never the default) starts from the GPU's renderer
string (software renderers and weak integrated GPUs start on LOW, mid-range integrated graphics on MEDIUM) and then
measures the median frame time of each arena after the countdown: slower than 25 ms steps one tier down, faster than
18 ms one tier up, but never back up to a tier that was too slow. It also measures the frame interval in the menu (a
light scene), which is the display's or the browser's frame cap: on a 30 Hz screen or a laptop in power-saver mode
(~33 ms whatever the work) a frame only counts as slow when it is 25% over that cap. Switching away from AUTO drops
its state, so coming back starts from a fresh guess. A decision waits for the next arena start, and the UI shows the
tier in use (`AUTO · MEDIUM`). The resolved tier is never written to the saved settings. Unknown saved
values load as HIGH; an older build that only knows LOW / HIGH reads MEDIUM / AUTO as HIGH and writes HIGH back the
next time any setting changes there.
