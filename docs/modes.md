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
- **Hard mode**: ×1.8 bot HP, ×1.5 bot damage, about 35% more minions, the same boss, ×1.75 coins. The first Hard
  clear pays 2.5× the arena's clear reward (repeats 0.6×) and earns a 💀 badge on its card. Hard clears never change
  unlocks.

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
**🏁 END RUN** at the pit stop banks the run on the wave you just cleared. Your best wave is saved. Boss waves can
drop gear, with the chance rising the deeper you go.

**Daily run** (📅 DAILY, unlocked with Survival): one seeded Survival run per day, with the same wave lineup for
everyone on that date plus one of 8 modifiers (Deep Snow, Whiteout, Swarm, Thief Night, Boss Rush, Heavy Hitters,
Glass Cannon, Overclocked) that rotate so none repeats two days running. It pays ×1.25 coins. Your best wave for each
day is saved separately from normal Survival, and the game-over screen shows the last 7 days.

## Duel

An online best-of-3 against a friend. See [duel.md](duel.md).

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

**⚙ Settings** (main menu or pause menu) has master / music / SFX volume, screen-shake strength, LOW / HIGH graphics
(LOW = 1× pixel ratio, no shadows; Brawl on HIGH caps the pixel ratio at 1.5×, halves the shadow map and uses a
cheaper snow shader), bloom, reduced flashes, the **Ultimate kill-cam** toggle, key rebinding and save management:
**EXPORT** (an `SPS1:` code, copied to the clipboard), **IMPORT** (validated; a bad code leaves your save untouched)
and **RESET PROGRESS** (click twice). Settings live in localStorage separately from progress.
