# Progression

Coins from every mode go to the Garage (core upgrades, your plow's line, gear), the Paint Shop, and Survival pit
stop repairs.

## Garage

The Garage has three tabs, each with a badge counting what you can afford; switch with Q / E or LB / RB.

- **Core:** V8 Engine, Packed Ice, Mega Hopper, Armor Plating. These are **endless**: full-strength gains up to the
  pips, then speed / size stats taper toward a ceiling while damage and HP keep growing.
- **Gear:** see below.
- **Your plow's line:** the four upgrades of the plow you're driving (see [plows.md](plows.md)). Lines for other
  plows stay bought; they apply whenever you drive that plow.

Hover a card for the full mechanics of that upgrade.

## Gear

Prodigy-style items in 5 slots. Buy an item once, level it up to ★10, and equip it. **Any number of items can be
equipped at once**: each owned item is switched on or off on its own, and a newly bought or looted item is equipped
straight away. The slots are browsing categories in the Garage. The grants of every equipped item add up (two items
that grant the same stat, such as Turbine Fan and Frostbite Edge for Whirlwind, stack their levels). Gear works on
every plow and shows on the model: blade items dress the blade edge (ARSENAL's nose), chassis items the hull sides,
boosters add a rear pod and tint the dash flame, cores put a glowing gem on the deck, and charms hang a little
ornament. Each slot has one mount, so with several items of a slot equipped the model shows the highest-rarity one
(the priciest on a tie).

Every gear stat comes from exactly one item. The three one-time cores (Frost, Avalanche, Ice Shield) also carry a
small levelling secondary so item levels still matter. An item's next level costs 0.6× its price × 1.35 per level
already owned.

### 🔪 Blade

| Item | Rarity | Price | Effect | ★1 → ★10 |
|---|---|---|---|---|
| 🔪 Steel Wedge | common | 60 | A wider blade: slams hit a bigger area. | +1 → +6 Wide Blade |
| 🦔 Spiked Plowshare | rare | 300 | Rams and dash strikes hurt a lot more. | +2 → +9 Ram Spikes |
| ❄️ Frostbite Edge | epic | 1000 | Slams freeze bots for 3 s; a stronger whirlwind. | Frost Core, +1 → +3 Whirlwind |
| 🌋 Avalanche Blade | legendary | 1600 | Slams hit 50% wider and send bots flying; snow piles back faster. | Avalanche Core, +1 → +3 Snow Machine |

### 🛡️ Chassis

| Item | Rarity | Price | Effect | ★1 → ★10 |
|---|---|---|---|---|
| 🔩 Riveted Frame | common | 60 | Take less damage from every hit. | +1 → +6 Reinforced Frame |
| 🔧 Scrap Recycler | rare | 380 | Part of the damage you deal repairs your plow. | +1 → +7 Salvage Rig |
| 🧱 Glacier Shell | epic | 850 | Your snowball blocks 75% of frontal damage; packs snow faster. | Ice Shield, +1 → +3 Snow Compactor |
| ❤️‍🔥 Phoenix Plating | legendary | 1600 | Survive a lethal hit (Second Wind) and hit harder below 35% HP (Last Stand). | +1 → +6 Second Wind, +1 → +5 Last Stand |

### 🚀 Booster

| Item | Rarity | Price | Effect | ★1 → ★10 |
|---|---|---|---|---|
| 🚀 Nitro Tank | common | 80 | Dash recharges faster and goes farther. | +1 → +5 Nitro Dash |
| 🌀 Turbine Fan | common | 90 | Bigger, harder-hitting whirlwind that recharges faster. | +1 → +5 Whirlwind |
| ✈️ Jet Turbine | rare | 550 | Every kill refunds part of your dash + whirlwind recharge. | +1 → +5 Adrenaline |

### 💠 Core

| Item | Rarity | Price | Effect | ★1 → ★10 |
|---|---|---|---|---|
| 🧊 Pack Compactor | common | 70 | Packs plowed snow into your ball faster. | +1 → +6 Snow Compactor |
| ⏱️ Overclock Chip | legendary | 1500 | Cuts every ability cooldown, up to -60% at max level. | +1 → +10 Overclock |

### 🍀 Charm

| Item | Rarity | Price | Effect | ★1 → ★10 |
|---|---|---|---|---|
| 🧲 Lucky Magnet | common | 50 | Grab dropped coins from farther away. | +1 → +6 Bolt Magnet |
| 🌨️ Snow Globe | common | 70 | Snow falls back onto plowed ground faster. | +1 → +6 Snow Machine |
| 🧰 Repair Drone | rare | 340 | Regenerates HP over time and repairs more between rounds. | +1 → +6 Repair Kit |

The source of truth is `src/config/gear.ts`; `tests/gear.test.ts` enforces the one-item-per-stat rules.

## Loot

Gear also drops. A drop rolls a rarity from its source's odds, then a random item of that rarity. A new item arrives
at ★1 (equipped), an owned one gains a level, and a ★10 item pays half its price in coins
instead. The drop appears as a card on the results screen (or the Survival pit stop).

| Source | Drop chance | Common | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Campaign first clear | 100% | 50% | 35% | 12% | 3% |
| Campaign repeat clear | 35% | 60% | 30% | 8% | 2% |
| Hard mode first clear | 100% | 20% | 40% | 28% | 12% |
| Hard mode repeat clear | 35% | 20% | 40% | 28% | 12% |
| Survival boss wave | 30%, +2% per wave past 5 (max 75%) | 45% | 35% | 15% | 5% |
| Brawl 1st place | 100% | 35% | 40% | 18% | 7% |
| Brawl 2nd place | 40% | 55% | 32% | 10% | 3% |
| Brawl 3rd place | 20% | 55% | 32% | 10% | 3% |

There's no loot in the Tutorial or the Duel. Tables live in `src/config/loot.ts`.

## Trophies, Paint Shop, stats

- **🏆 Trophies**: 56 achievements (Campaign, Combat, Bosses, Brawl, Survival, Plows, Collection) paying 25–500
  coins each, plus a lifetime STATS page. Unlocks are re-checked from the save, so old saves and imports get credit
  for what they've already done. Tutorial fights don't count. Newer ones: **Grounded** (finish a boss with VOLT-9's
  Arc Lance: kills tagged `weapon: 'arcLance'`), **Exciting Opportunity** (all PROTOCOL B fragments = every arena on
  Hard, with progress) and **Q4: Total Defeat** (Hard Omega Works with 0 HP lost in the boss round,
  `runFinished.bossDamage`).
- **🎨 Paint Shop**: 8 paints, 5 decals, 5 exhaust trails, 6 blade skins, 5 slam horns and 5 kill effects, 150–2000
  coins. Purely visual; five premium items also need challenge stars or achievements. Hover or focus an item to
  preview it on the plow before buying.

## Old saves

Saves migrate on load and on import. Coins spent on upgrades that became gear, on the cut Wrecking Ball upgrade, and
on removed gear items (Wrecker Core, Adrenaline Shot) are refunded once, and removed items are unequipped. Items
that got cheaper in the gear reshape (Spiked Plowshare, Avalanche Blade, Scrap Recycler, Glacier Shell, Jet Turbine)
pay their owners the difference for the levels they hold, once. Saves from before multi-equip stored one equipped
item per slot (`equipped: { slot: id }`); they load as that list of ids (`equipped: [id, ...]`), so the same items stay
equipped and the rest of what you own stays off until you equip it. Unknown, unowned and repeated ids are dropped.
