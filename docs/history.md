# How the game got here

Snowplow Showdown started as a different game. This page traces it from the archived first version to today, using
the git history (158 commits, Oct 15 to Nov 8 2026) and the archive that came in with the first real commit.

> Why the change? Jumping off a third-floor ramp to black-hole a top-tier boss is more fun than shooting a penguin
> with a snowball.

## Version 0: the cozy snowball-cannon base defense (archived, Oct 14)

`archive/base-defense-v1.tar.gz` (in commit `1c319c7`) holds the game before this repository: about 7,700 lines of
Three.js + TypeScript.

- **Defend the cabin.** A cocoa log cabin sat in the middle of the map with its own HP. Lose it and the run was over.
  It even had its own upgrade, *Cabin Walls* (tougher walls, more repair between waves).
- **Snowballs were ammunition.** You plowed snow to grow a ball, then fired it from a *Launch Cannon*. There were no
  slams, rams or whirlwinds.
- **Winter creatures, not robots.** Evil Snowman, Sled Penguin, Fire Imp, Ice Golem and Rogue Plow, with two bosses:
  King Frostbeard and The Abominable.
- **Storybook arenas.** Frosty Meadow (*"Gentle hills. Grumpy snowmen."*), Pine Ridge (*"Fire imps are melting the
  forest floor."*), Frozen Lake, Blizzard Pass and Yeti Peak (*"Home of the Abominable. Bring your biggest
  snowball."*).
- **15 upgrades** split between the plow (V8 Engine, Wide Blade, Snow Compactor, Mega Hopper, Rolling Growth, Snow
  Machine), the shots (Packed Ice, Frost Core freezing hits, Shatter Shot splitting balls, Avalanche Core) and
  survival / utility (Armor Plating, Cabin Walls, Coin Magnet, Turbo Boost).

## Version 1: the plow brawler (Oct 15)

By the time the repository's code landed (commit `1c319c7`, "Initial commit") the game had already pivoted:

- **No base.** The fight moved into the arena and only your plow can die.
- **The snowball became a weapon you swing.** It is your slam and your shield, alongside dash and whirlwind.
- **Robots replaced the creatures:** scrapper, brute dozer, spinner and thief, with boss machines BULLDOZA,
  FROSTBYTE, THE GRINDER, SLUSH & SLEET and the Omega.
- **The arenas turned industrial:** Frostbite Yard, Pine Junkyard, Frozen Foundry, Blizzard Bowl, Omega Summit.
- **Brawl** in the Snowdome: a free-for-all against rival plows.

## Version 2: more plows (Oct 16 to 19)

Pilot perks, then **VOLT-9** (electric, Thunderclap) and **BRUTUS** (Ground Pound, buzzsaws). Survival mode,
Settings, the Tutorial and the first tests arrived the same week.

## Version 3: the big expansion (Oct 25, 51 commits)

Built in parallel branches and merged the same day:

- **Meta progression:** Daily Survival, challenge stars, Hard mode for every arena, the Paint Shop, achievements and
  lifetime stats.
- **Performance:** instancing, merged static meshes and shadow proxies, guarded by a pixel-diff render probe.
- **ISOTOPE**, the fourth plow, and its NUKE.
- **Game feel:** hit-stop, slow-mo kills, camera punch, particles, scorch marks, bloom.
- **Golden Tower Plaza** and THE DONALD.
- **Online DUEL:** 1v1 over PeerJS, after a refactor that gives every plow its own pilot.

## Version 4: gear, ARSENAL and ultimates (Oct 31)

- **Gear:** 16 items with distinct identities, visible on the plow and dropped as loot. The Garage was trimmed to the
  core upgrades plus each plow's own line.
- **ARSENAL**, the fifth vehicle: a weapons platform, not a plow.
- **Ultimates** for every plow, and a kill-cam when one wipes a crowd.
- **Destructible props**, the per-plow combat modules, and the headless **balance sim** behind the first data-driven
  balance pass.

## Version 5: the level overhaul (Nov 1)

- **A new look:** a road-crew themed menu and a restyle of every screen.
- **Real terrain:** ramps, multiple levels, lava, low gravity, height-aware combat and a radar. The arenas were
  swapped and renamed into today's line-up, ending at **The Omega Works**, a night factory with a deck-leaping
  MEGAPLOW.
- **Vehicles with kits:** VOLT-9 became a Tesla rover, BRUTUS a wrecking mech, ISOTOPE a reactor hauler, each with
  its own SPACE / E / F.

## Version 6: identity, story and polish (Nov 2 to 8)

- **ARSENAL redesigned** as a magnetic gyro-hover vehicle with the Mag Shotgun, Mag Repulsor and SINGULARITY.
- **Distinct primaries:** ISOTOPE's lingering RAD DOSE, VOLT-9's long Arc Lance chains with paralysis, BRUTUS's solid
  Wrecking Fist, ARSENAL's Magnetic Reel and strip scrap.
- **Biome challenges and trophies:** Hot Tub, Moonshot and Meteor Strike.
- **The Frostvale story** (`src/config/lore.ts`): the WHITEOUT voice, the missing drivers, an evil MEGAPLOW Ω, and the
  Hard-mode PROTOCOL B arc.
- **Polish and balance:** BRUTUS back to steel grey, and ARSENAL nerfed against bots (bonus 3x to 1.5x, reach 11 m to
  8 m) after the bot sweeps showed it running away with the campaign.

## What survived from version 0

- **Upgrades:** *Mega Hopper* is still in the Garage, and *V8 Engine*, *Wide Blade* and *Packed Ice* live on in idea.
- **Rogue plows** became the Brawl rivals.
- **Arenas:** Pine Ridge became Pine Junkyard, then Inferno Quarry. Blizzard Pass became Blizzard Bowl, then The
  Thermal Divide.
- **The climb:** a run of arenas that ends in a boss on the peak (Yeti Peak, then Omega Summit, now The Omega Works)
  has been the shape since day one.

## By the numbers

| When | TypeScript files | Plows | What you fight |
|---|---|---|---|
| Oct 14 (archive) | 22 | 1 + a cabin to defend | snowmen, penguins, imps, golems, a yeti |
| Oct 15 | 31 | 1 | robots and boss machines |
| Oct 25 | 71 | 4 | the same, plus Brawl rivals and Duel players |
| Nov 8 | 113 (~52,000 lines) | 5 vehicles | five bot types, seven bosses, rival plows, players |
