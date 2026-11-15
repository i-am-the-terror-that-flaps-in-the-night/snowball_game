# Modes

## Campaign

Six walled arenas. Each is a few rounds of bot minions (scrappers, brute dozers, buzzsaws, snow thieves and, from
arena 2 on, flurry gunners, slushpiles and bulwarks) and then a bot boss with telegraphed attacks. Beating a boss
unlocks the next arena.

The three later minions each ask for something different (stats and tuning in `src/config/enemies.ts`, AI in
`src/entities/enemies/ai.ts`):

- **Flurry Gunner**: the only ranged bot. It strafes 10 to 14 m out, backs off if you close inside 6.5 m, and between
  shots aims for 0.55 s (cyan barrel glow, a ground stripe along the line) before firing one slow snowball bolt (15
  m/s, 9 damage) at where you are. Drive sideways and it misses; your ball shield blocks it like any frontal hit.
  26 HP: close in and it pops.
- **Bulwark**: a slow tread-tank behind a curved plow-shield. Direct hits inside its front 90° lose 75% (BLOCK
  sparks); sides take full damage and its rear vent takes ×1.3. Slams, stomps, blasts, shockwaves and ultimates go
  round the shield. It turns at 1 rad/s, so running rings round it works; up close it shield-bashes for a big shove.
- **Slushpile**: 70 HP of slush on treads that belly-flops into you. Wrecked, it bursts into 3 slushlings (12 HP,
  fast, 1 coin each): finish it with area damage to catch the minis too.

Survival draws them as well (gunners from wave 4, slushpiles from 6, bulwarks from 7).

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

Every arena has **5 challenge stars** and, once cleared, a **Hard mode**:

- **Challenge stars**: 5 per arena (30 total): slam kills, ball size, clear times, combos, damage limits, boss-fight
  speed and plow signature goals. They're judged on any winning run (normal or Hard), shown on the arena cards
  and the results screen, and each new star pays a one-time bonus (+75 to +800 by arena). Every plow mechanic has a
  star somewhere (targets eased by about a third since): the Classic's Plow Rush hits (Coldboot Glacier, *Rush Hour*,
  5 hits), ISOTOPE's radiation-burn kills (Inferno Quarry, *Tank-Buster*, 3), ARSENAL's Singularity kills (Rust
  Basin, *Event Horizon*, 2), VOLT-9's Arc Lance kills (The Thermal Divide, *Lightning Rod*, 6), ARSENAL's Polarity
  Burst kills (*Polar Opposites*, 2) and Mag Laser kills (Golden Tower Plaza, *Laser Light Show*, 9), REVENANT's
  WILD HUNT kills (Golden Tower Plaza, *Danse Macabre*, 8: rider tramples and the finale eruption; it replaced the
  Plaza's clear-time star), BRUTUS tanking 250 HP (The Omega Works, *Crash Test Dummy*), plus the older VOLT-9
  (*Live Wire*) and BRUTUS (*Rhino Rampage*) stars. The other new ones: *Cold Shoulder* (< 70 HP from FROSTBYTE),
  *Demolition Derby* (5 ram kills), *Drill Sergeant* (THE GRINDER in 45 s) and *Quality Control* (The Omega Works
  losing < 200 HP). Weapon kills come from
  `enemyKilled`'s `weapon` tag (`core/events.ts` KillWeapon), rush hits from the `plowRush` event; both only credit
  the player's own weapons, so they never touch combat numbers or the Duel.
- **Story beats**: each campaign arena opens with a one-line Road Crew radio call (a toast as the run starts, normal
  mode) and its boss gets last words after the fight (results screen, above the chapter ending); both also show on
  the arena's chapter card in the Story overlay (`ZONE_BEATS` in `src/config/lore.ts`).
- **Hard mode**: ×1.8 bot HP, ×1.5 bot damage, about 35% more minions, the same boss, ×1.75 coins. It scales with
  your plow past mid-game: your power is the average effective level (Garage + gear) of the core four upgrades and
  your plow's own line. Up to 4 nothing changes; each level above that adds +15% bot HP and +8% bot damage, capped at
  10 levels (×2.5 HP, ×1.8 damage on top). A late-game garage (about level 9) faces about ×1.75 HP and ×1.4 damage.
  The Hard button's tooltip shows your current numbers. The first Hard clear pays 2.5× the arena's clear reward
  (repeats 0.6×) and earns a 💀 badge on its card. Hard clears never change unlocks.

Boss clears drop gear: the first clear always does, repeat clears sometimes, and Hard clears with better odds (always on the first Hard clear)
(see [progression.md](progression.md#loot)).

## Protocol C

The secret seventh arena (build stages 1-2 of 5: foundation, echo holograms + tuning; THE CHAIRMAN, THE WHITEOUT, rewards and its own stars come
later). Code: `src/config/protocol.ts` (zone + waves), `src/meta/protocol.ts` (unlock, record, checkpoint),
`src/world/protocol/layout.ts` (floor), `src/world/environment/ProtocolScenery.ts` (venue).

- **Not a campaign arena**: `PROTOCOL_ZONE` is not in `ZONES`, so the arena unlock prefix, the finale (results /
  Story), `clear_all` / `hard_all` and the 30-star total are untouched. After the normal Omega clear the arena select
  shows a glitched, locked seventh card ("PROTOCOL C: TODO — clear every arena on Hard", with the Hard count); it opens
  once every arena is cleared on normal and Hard, showing its best time, best wave and reward.
- **Run**: 7 boss waves on one stadium (±30 m, stands on four sides, a glass boardroom box over the north stand, gold
  on ice; always night). Wave n = campaign boss n PROTOCOL-upgraded: at least its Hard-campaign HP +15% (home HP ×
  max(1.6, 1.8 × 1.15)), ×1.25 damage, and its cooldowns between moves run ×1.3 as fast (wind-ups and telegraphs keep
  their length); the bosses already beaten walk back in as **echoes** (×0.35 home HP, ×0.85 damage, "ECHO" in the
  HUD) one by one, 6 s apart. Wave 7 is every headline as an echo, in two groups, around a stand-in final boss (THE DONALD at
  headline strength until THE CHAIRMAN lands in stage 3). Base difficulty is Hard's (×1.8 HP / ×1.5 damage on summoned
  minions and bot hits, scaled with your power like Hard). The normal upgrade shop runs between waves.
- **Echoes** keep one or two signature moves and never reach phase 2 or summon: FROSTBYTE ball slam · BULLDOZA charge +
  leap · THE GRINDER auger pull · SLUSH charge / SLEET shove (as a pair) · THE DONALD wall (+ its steamroll) · Ω ground
  pound. Twins pair by spawn partner and THE DONALD's props follow the Donald that raised them (passing to the other
  Donald if it falls; they collapse with the last one), so two of a kind can share a fight. An echo is a translucent
  gold **hologram** (scanlines, a sweeping glitch band, fresnel rim, flicker; eyes / glow strips / FROSTBYTE's ball
  keep their own look); it flashes white on hits, dims on the leash and shatters into gold chunks. One shader for every
  echo, compiled by each arena build's warm-up (`src/entities/enemies/hologram.ts`), so the first echo never stalls a
  frame; LOW draws only its front faces (one transparent pass instead of two).
  Echo kills count as bosses scrapped but not toward a boss's own trophy.
- **Boss leash**: at most 4 bosses fight at once (`ZoneDef.maxActiveBosses`); headlines always do, the extra echoes
  circle 15 m out (dimmed bar, grey badge) and rotate in every ~9 s. The HUD stacks up to 8 boss bars: the headline
  full width, echoes as slim gold bars four to a row (three on narrow screens; the campaign's one / two bar layouts are
  unchanged).
- **Restructuring**: during each shop the floor is swapped: 1 ice rink · 2 + a broken lava ring · 3 + craters and two
  launch ramps · 4 rink + hot (lava vents, scorched) west / cold (ice) east · 5 + a rally stage behind the north wall
  (in front of THE DONALD's rally spot) · 6 + two low gold decks with ramps · 7 everything. The plow is set back on
  its spawn with its HP; destructible props never stand on or against the decks, nor within 4 m of a deck ramp.
- **Deck routing** (waves 6-7): a small nav graph (`PROTOCOL_NAV` in the layout, like the Omega Works') is set for
  the deck waves: a boss between moves whose plow is up on a deck heads for the nearest ramp foot and drives up (or
  drops off the side to come back down), goes round a slab / ramp side that walls off its way, shoves through crates,
  and holds its next move until it is on the plow's level. Parking on a deck no longer keeps them off you.
- **Checkpoints**: each wave's start is saved (HP fraction, kills, coins, run time, retries). Wrecked on wave 2 or
  later, the results screen offers RETRY WAVE n (restores it, +1 retry) or a full restart; a saved run can also be resumed from the card.
  Coins and upgrades are permanent as everywhere else. A clear records the best total time (fights only) and whether
  it used no retries, and pays 6,000 coins the first time (40% after) plus Hard-grade loot ("PROTOCOL C clear"). A run
  that used a retry never counts as a clean clear ("Not a Scratch"); the shop preview reads "Wave n of 7".
- **Testing**: `__game.startProtocol(wave)` in the console starts any wave without the unlock. Such a dev run records
  nothing (no clear, best time / wave, checkpoint or clear reward) unless the arena is unlocked and it starts on wave 1.

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

Campaign and Survival arenas have 14 crates and blocks (the Brawl Snowdome has 26) that block movement until they
break. Each arena dresses them its own way (frozen server crates and ice in the glacier, ore crates and obsidian in
the quarry, cargo pods and sandstone on Mars, gift boxes and marble at the rally, neon cargo in the Works, presents in
the Snowdome); the two kinds behave the same everywhere. Ram one at speed or dash through it; slams, whirlwinds, every F ability and ultimate, missiles,
the laser and stray pulse-laser bolts smash them too. Bots break them as well: a bot you knock flying into one, a heavy
or boss mid-charge, or a Brawl rival dashing or driving fast. Broken props drop a couple of coins outside Brawl when
you caused the break, either directly or by knocking a bot into it. A bot breaking one under its own power drops
nothing. Everything stands back up each round. Props have only two states (standing / broken): one InstancedMesh
per prop type and a circle collider each, with no physics. There are none in the Duel or the Tutorial.

## Settings and save

**⚙ Settings** (main menu or pause menu) has master / music / SFX volume, screen-shake strength, graphics quality
(below), time of day (below), bloom, reduced flashes, the **Ultimate kill-cam** toggle, key rebinding and save management:
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
| PROTOCOL C echo hologram back faces | on | on | off (front faces only, from the next echo) |

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

**Time of day.** DAY (default) / NIGHT / AUTO, applied from the next arena start (`src/core/timeOfDay.ts`; AUTO
alternates per arena start: the 1st, 3rd, 5th... arena of a session is at night). Purely local and visual: nothing the
simulation reads changes (colliders, spawns, hazards, props), every client lights its own arena (fine in the online
Duel), and the night-only dressing draws from its own seeded rng so the venue layout's random stream is identical day
or night. NIGHT relights every venue (`src/world/environment/night.ts`, one entry per biome / venue): a dark themed sky
with stars (the glacier's aurora, the Divide's split hot / cold sky, a moon disc), darker fog in the arena's colours, a
dim moon as the shadow-casting sun, a lowered but readable ambient, the two floodlight spots turned up, and the arena's
own emissives (neon, lava, windows, gate lights, ramp lips) boosted. `NightScenery.ts` dresses the stadium: floodlight
banks on the stand backs (and on The Omega Works' corner towers), additive light cones (not on LOW) with soft pools on
the snow, a scrolling LED ribbon above the walls, a packed house (the seats the day layout leaves empty get a
spectator; the crowd keeps at least 75% of its figures on LOW at night, never fewer than by day), a floodlight wash on
the crowd, and one Points draw of phone torches / glow sticks (bobbing with their spectator), camera flashes and lamp
halos. The Omega Works, which has no stands by day, gets a spectator gallery over its walls at night. About six extra
draw calls, no extra real lights.
