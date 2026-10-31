# Balance pass

Numbers from the headless balance sim, `scripts/balance/sim.ts`. Run the report with:

```sh
npm run balance
```

It is a separate vitest config (`scripts/balance.config.ts`), so it is not part of `npm test`. A few invariants from
it do run in `npm test`: `tests/balance.test.ts`.

## What the sim measures

The sim builds the real `Combat` (every plow kit, the ultimates and the Duel damage path) on fake plows, with no
browser, and drives it at 60 Hz:

- **Rotation.** Every F ability goes off when it is ready, ARSENAL holds the minigun and fires the laser on cooldown.
  The Plow drives slam, whirl and dash, and the sim has no snow field or driving, so these three are scheduled from an
  engagement model (`MELEE` in sim.ts). The blade gathers 5 m³/s of snow while fighting (about half the open-field
  rate) times Snow Compactor. You slam once the ball reaches 80% of max radius, whirl on every recharge holding a
  half-size ball, and land a dash strike on every second dash.
- **1-target DPS.** Sustained damage on one stationary bot 4.5 m ahead over 60 s, with the ultimate held back. The
  "vs plow mean" column compares against the mean of the four snowball plows (ARSENAL is compared, not averaged).
- **Cluster DPS.** The same, on 6 bots packed ahead of the plow.
- **Ult fill.** Average seconds of the full rotation to fill the meter, in two fights:
  - *fight*: five finite-HP bots in reach (80 / 200 / 500 HP per tier), each wrecked bot replaced 1 s later. Overkill
    counts for nothing, as in the game.
  - *boss*: one huge-HP target, where nothing is overkill (the damage-limited end).
- **Ult dmg.** Total damage of the ultimate plus its aftermath (fire field, burns, fallout pool) over 8 s on 8 bots
  spread 3 to 17 m around the plow, minus the same 8 s without it. Also how many of the 8 it touched.
- **Duel TTK.** The attacker runs the full rotation (ultimate used when full) against a parked, same-tier plow of each
  of the 5 kinds, 5.1 m ahead and facing it. Damage goes through the real `OpponentTarget` and the victim's
  `Combat.hitPlow`: DUEL_DAMAGE_SCALE, the Brawl hit cap, ability diminishing returns, i-frames, `direct`
  'round'/'beam', shields, Iron Hide and Second Wind. The table shows the average over the 5 defenders, and the
  fastest kill. The minigun line pads the victim's HP so it can't die, which is why the old numbers run past max HP.

**Tiers.** Fresh is every level 0 with no gear. Mid is Engine / Armor / Packed Ice / Hopper at 4, the plow's own line
at 3, and item level 3 commons and rares: Steel Wedge, Scrap Recycler, Turbine Fan, Pack Compactor, Repair Drone (the Adrenaline Shot before the gear reshape
below).
High is the core four at 10, the line at 8, and item level 8 legendaries and epics: Avalanche Blade, Phoenix Plating,
Jet Turbine, Overclock Chip, Repair Drone. Phoenix Plating gives everyone Second Wind at high tier. Duel TTKs there
include that 1.5 s save. With it turned off, the fastest high-tier kill is 4.2 s (ARSENAL vs VOLT-9).

## Before

#### fresh

| plow | HP | 1-target DPS (vs plow mean) | cluster DPS | ult fill: fight / boss (s) | ult dmg, bots hit (vs mean) | duel TTK avg (vs mean) / min (s) |
|---|---|---|---|---|---|---|
| classic | 150 | 85 (+23%) | 368 | 17.5 / 12.1 | 3395, 6 (+38%) | 3.6 (-20%) / 2.9 |
| volt | 102 | 77 (+12%) | 301 | 9.2 / 12.0 | 2125, 8 (-14%) | 6.1 (+35%) / 6.0 |
| brute | 162 | 59 (-14%) | 256 | 12.5 / 17.1 | 2304, 8 (-6%) | 5.9 (+30%) / 2.9 |
| isotope | 132 | 55 (-20%) | 182 | 16.0 / 32.8 | 3376, 8 (+37%) | 5.3 (+16%) / 2.9 |
| arsenal | 108 | 134 (+94%) | 204 | 8.3 / 7.7 | 1100, 5 (-55%) | 1.8 (-61%) / 1.3 |

Duel minigun alone, 2 s held: 73 HP of a 150-HP Classic; 73 of a 108-HP ARSENAL mirror.

#### mid

| plow | HP | 1-target DPS (vs plow mean) | cluster DPS | ult fill: fight / boss (s) | ult dmg, bots hit (vs mean) | duel TTK avg (vs mean) / min (s) |
|---|---|---|---|---|---|---|
| classic | 325 | 468 (+16%) | 1852 | 4.8 / 1.8 | 18557, 6 (+63%) | 2.5 (-7%) / 2.2 |
| volt | 221 | 424 (+5%) | 2088 | 2.1 / 2.3 | 9715, 8 (-15%) | 3.1 (+13%) / 2.5 |
| brute | 351 | 398 (-1%) | 2038 | 1.9 / 2.5 | 9360, 8 (-18%) | 3.2 (+17%) / 2.9 |
| isotope | 286 | 322 (-20%) | 1487 | 2.1 / 3.6 | 14977, 8 (+31%) | 4.1 (+48%) / 3.2 |
| arsenal | 234 | 784 (+94%) | 1269 | 2.2 / 1.4 | 4360, 5 (-62%) | 0.8 (-71%) / 0.7 |

Duel minigun alone, 2 s held: 397 HP of a 325-HP Classic; 292 of a 234-HP ARSENAL mirror.

#### high

| plow | HP | 1-target DPS (vs plow mean) | cluster DPS | ult fill: fight / boss (s) | ult dmg, bots hit (vs mean) | duel TTK avg (vs mean) / min (s) |
|---|---|---|---|---|---|---|
| classic | 500 | 1312 (-31%) | 5529 | 1.5 / 0.8 | 50195, 6 (+71%) | 3.4 (+4%) / 3.2 |
| volt | 340 | 2638 (+39%) | 14781 | 0.7 / 0.5 | 24956, 8 (-15%) | 2.9 (-9%) / 2.6 |
| brute | 540 | 1546 (-18%) | 8828 | 0.8 / 1.2 | 23069, 8 (-22%) | 3.9 (+21%) / 3.4 |
| isotope | 440 | 2084 (+10%) | 12047 | 0.8 / 0.6 | 38095, 8 (+30%) | 3.9 (+21%) / 3.9 |
| arsenal | 360 | 4115 (+117%) | 11303 | 0.7 / 0.3 | 10644, 5 (-64%) | 2.0 (-37%) / 2.0 |

Duel minigun alone, 2 s held: 1109 HP of a 500-HP Classic; 867 of a 360-HP ARSENAL mirror.

## After

#### fresh

| plow | HP | 1-target DPS (vs plow mean) | cluster DPS | ult fill: fight / boss (s) | ult dmg, bots hit (vs mean) | duel TTK avg (vs mean) / min (s) |
|---|---|---|---|---|---|---|
| classic | 150 | 78 (+14%) | 334 | 24.1 / 17.0 | 2722, 6 (+10%) | 6.3 (-10%) / 4.8 |
| volt | 102 | 72 (+5%) | 275 | 24.1 / 32.1 | 2318, 8 (-6%) | 7.5 (+8%) / 6.3 |
| brute | 162 | 65 (-6%) | 287 | 25.0 / 30.0 | 2664, 8 (+8%) | 6.8 (-2%) / 6.2 |
| isotope | 132 | 60 (-13%) | 201 | 22.5 / 45.7 | 2592, 8 (+5%) | 6.8 (-2%) / 6.2 |
| arsenal | 108 | 64 (-7%) | 100 | 22.9 / 26.4 | 2040, 6 (-17%) | 7.3 (+5%) / 6.0 |

Duel minigun alone, 2 s held: 17 HP of a 150-HP Classic; 17 of a 108-HP ARSENAL mirror.

#### mid

| plow | HP | 1-target DPS (vs plow mean) | cluster DPS | ult fill: fight / boss (s) | ult dmg, bots hit (vs mean) | duel TTK avg (vs mean) / min (s) |
|---|---|---|---|---|---|---|
| classic | 325 | 429 (+14%) | 1692 | 23.0 / 9.7 | 11161, 6 (+9%) | 6.8 (-7%) / 6.0 |
| volt | 221 | 341 (-9%) | 1576 | 23.0 / 28.9 | 9804, 8 (-5%) | 8.0 (+10%) / 6.5 |
| brute | 351 | 403 (+8%) | 2069 | 14.2 / 18.7 | 9648, 8 (-6%) | 6.4 (-11%) / 5.9 |
| isotope | 286 | 327 (-13%) | 1514 | 12.9 / 22.8 | 12735, 8 (+24%) | 8.1 (+11%) / 7.0 |
| arsenal | 234 | 302 (-19%) | 501 | 25.9 / 23.5 | 8040, 6 (-22%) | 7.1 (-2%) / 6.3 |

Duel minigun alone, 2 s held: 48 HP of a 325-HP Classic; 0 of a 234-HP ARSENAL mirror.

#### high

| plow | HP | 1-target DPS (vs plow mean) | cluster DPS | ult fill: fight / boss (s) | ult dmg, bots hit (vs mean) | duel TTK avg (vs mean) / min (s) |
|---|---|---|---|---|---|---|
| classic | 500 | 1354 (-5%) | 5676 | 27.2 / 14.5 | 27603, 6 (+9%) | 6.9 (-1%) / 6.3 |
| volt | 340 | 1603 (+12%) | 8254 | 26.7 / 26.3 | 24522, 8 (-3%) | 7.2 (+3%) / 5.4 |
| brute | 540 | 1531 (+7%) | 8743 | 22.8 / 23.2 | 22680, 8 (-11%) | 7.0 (0%) / 5.2 |
| isotope | 440 | 1227 (-14%) | 6888 | 21.6 / 27.7 | 32494, 8 (+28%) | 7.3 (+5%) / 6.7 |
| arsenal | 360 | 1372 (-4%) | 2499 | 31.9 / 24.3 | 19584, 6 (-23%) | 6.5 (-7%) / 5.7 |

Duel minigun alone, 2 s held: 88 HP of a 500-HP Classic; 0 of a 360-HP ARSENAL mirror.

## What changed and why

**ARSENAL was double everyone else's damage at every tier** (1-target +98% / +97% / +119%). Its minigun alone did
what another plow's whole F kit does, and missile count doubled with upgrades (4 to 8 at level 8, 10 max).

- Minigun 9 + 3.5/level dmg × 7 + 0.6/level rounds/s became 4 + 1.3/level × 6 + 0.4/level.
- Laser 120 + 40/level dps became 70 + 25/level, recharge 3 + 3e^-L/4 s became 5 + 2e^-L/4 s.
- Missiles 55 + 18/level became 34 + 11/level. Count is now 4 to 8, one more every 2.5 soft levels instead of 1.5.
  Recharge 3.5 + 3e^-L/4 became 5.5 + 2e^-L/4.
- Result: 7% / 19% / 4% under the snowball plows. It is ranged, so it should sit a little under them.

**Late game diverged (high-tier spread -30% to +37%).** Overclock (legendary) halves every cooldown. That nearly
doubles the cooldown-bound kits (Thunderclap, Meltdown pools) but not Inferno, whose 1.4 s of flame doesn't shrink.

- Inferno: burn dps 45 + 26/level became 40 + 30/level, recharge 2.5 + 3.5e^-L/4 became 3.2 + 2.8e^-L/8.
  Weaker fresh (+25% became +14%), less of a mid-game spike, and it keeps up late (-30% became -4%).
- Thunderclap: 70 + 30/level became 70 + 26/level, recharge 3 + 3e^-L/4 became 4.5 + 1.5e^-L/4. It is still 6 s
  fresh but no longer reaches 1.8 s with Overclock. Storm strikes went from 7 to 6.
- Meltdown: 110 + 40/level became 125 + 44/level, pool 22 + 12/level dps became 26 + 14/level. Overlapping fallout
  pools no longer stack. At high tier, four 10 s pools from a 2.3 s Meltdown were stacking 4× on one bot, which made
  the late game a pool-stacking contest. Now each bot takes one dose per tick.
- Ground Pound: 160 + 55/level became 185 + 50/level (BRUTUS was 13% under fresh).
- Result: within ±15% of the mean at every tier.

**Ultimate meters filled in seconds once upgraded** (mid 1.4 to 4.8 s, high 0.3 to 1.5 s). Each meter was a fixed
amount of damage, while damage dealt grows about 20× by the high tier.

- New `PlayerStats.ultPower` = Packed Ice multiplier × (1 + 0.35 × the F-ability upgrade's level curve), 1 on a fresh
  plow. Every meter is now `base × ultPower / cooldownMult` (`ultCharge` in combat/ultimates.ts). It grows with the
  pilot, and with Overclock, which speeds up every ability and so the damage.
- Bases were re-tuned for about 25 s fresh in the five-bot fight: FIRESTORM 700 became 870, NUKE 900 became 1500,
  SUPERCELL 900 became 2300, EARTHQUAKE 900 became 1800, ORBITAL 1000 became 1700.
- Fight fills are now 21 to 32 s at every tier, except BRUTUS / ISOTOPE at mid (13 to 14 s: Buzzsaws and Rad Aura
  unlock and hit every bot in reach). Boss fills are 10 to 46 s. Everything is over the 12 s floor at high tier.
- Inferno is all burst and only fire fills the FIRESTORM meter, so the Classic sits furthest from its boss time (fight
  24 s, boss 17 s fresh).

**Ultimates weren't comparable.** Fresh: ORBITAL STRIKE 1100 next to FIRESTORM / NUKE ~3400. High: FIRESTORM 50k,
because it scaled with Inferno's burn dps, the steepest curve in the game.

- ORBITAL STRIKE marks 6 targets instead of 5, at 10× missile damage instead of 4× (missiles got much weaker).
- NUKE is 2.6× Meltdown (was 4×), and its pool lasts 1.5× pool time (was 2×).
- FIRESTORM uses its own storm dps = fresh burn dps × the Inferno part of `ultPower`, so it grows like the other
  ultimates. Its nova and burning ground (3 s, was 4) both run on storm dps, and so do the burns it lights.
- SUPERCELL is 1.2× clap damage per wave (was 1.1).
- Result: every ultimate within -23% to +28% of the tier mean. ORBITAL is single-target-ish, so it has the lowest total
  on a spread-out crowd.

**Duel kills were too fast and uneven** (ARSENAL 0.8 s average at mid, classic 2.2 s fastest). The minigun's
`direct: 'round'` skips i-frames and diminishing returns, and that fix for a real bug stays. Instead:

- DUEL_ROUND_SCALE = 0.8 (0.7 after the follow-up below) is applied to minigun rounds against a plow, on top of the rest. With the minigun nerf, 2 s of
  held fire takes 11 to 18% of a same-tier Classic (it was 49% to over 200%).
- DUEL_DAMAGE_SCALE went from 0.6 to 0.45. Ability diminishing returns kick in at 15% of max HP (was 20%) and decay
  over 2 s (was 1.5 s). Tick-heavy kits (Inferno burns, saws, laser, storms) shred a lone human the most.
- DUEL_POWER_DAMP = 0.4: PvP damage is divided by the attacker's `ultPower` ^ 0.4. Upgrades multiply damage about 20×
  on about 3× the HP, so without it a late-game duel ended in under 3 s. Both duelists have equal garages after the
  catch-up, so it does not favour either side.
- Result: average TTK 6.3 to 8.1 s at every tier, each plow within ±12% of the tier mean, fastest kill 4.8 s.

## Follow-up: after the gear reshape

The gear list was reshaped so each stat comes from exactly one item (see [progression.md](progression.md#gear)). That
took the free plating off Phoenix Plating and the nitro / whirl off Jet Turbine, so high-tier plows got a little
squishier and ARSENAL's fastest Duel kill dropped to 3.9 s (against VOLT-9), under the 4 s floor in
`tests/balance.test.ts`. ARSENAL was already the fastest killer at that tier, so DUEL_ROUND_SCALE went from 0.8 to
0.7 rather than putting plating back on a chassis item. The mid-tier sim loadout swaps the removed Adrenaline Shot
for the Repair Drone. Current numbers:

#### fresh

| plow | HP | 1-target DPS (vs plow mean) | cluster DPS | ult fill: fight / boss (s) | ult dmg, bots hit (vs mean) | duel TTK avg (vs mean) / min (s) |
|---|---|---|---|---|---|---|
| classic | 150 | 78 (+14%) | 334 | 24.1 / 17.0 | 2722, 6 (+10%) | 6.3 (-11%) / 4.8 |
| volt | 102 | 72 (+5%) | 275 | 24.1 / 32.1 | 2318, 8 (-6%) | 7.5 (+7%) / 6.3 |
| brute | 162 | 65 (-6%) | 287 | 25.0 / 30.0 | 2664, 8 (+8%) | 6.8 (-3%) / 6.2 |
| isotope | 132 | 60 (-13%) | 201 | 22.5 / 45.7 | 2592, 8 (+5%) | 6.8 (-3%) / 6.2 |
| arsenal | 108 | 64 (-7%) | 100 | 22.7 / 26.4 | 2040, 6 (-17%) | 7.8 (+11%) / 6.9 |

Duel minigun alone, 2 s held: 15 HP of a 150-HP Classic; 15 of a 108-HP ARSENAL mirror.

#### mid

| plow | HP | 1-target DPS (vs plow mean) | cluster DPS | ult fill: fight / boss (s) | ult dmg, bots hit (vs mean) | duel TTK avg (vs mean) / min (s) |
|---|---|---|---|---|---|---|
| classic | 325 | 436 (+15%) | 1716 | 23.4 / 9.7 | 11161, 6 (+9%) | 6.1 (-15%) / 5.2 |
| volt | 221 | 338 (-11%) | 1604 | 22.7 / 29.5 | 9804, 8 (-5%) | 8.4 (+18%) / 6.1 |
| brute | 351 | 409 (+8%) | 2093 | 13.9 / 18.7 | 9648, 8 (-6%) | 6.3 (-13%) / 5.9 |
| isotope | 286 | 333 (-12%) | 1541 | 13.0 / 22.8 | 12735, 8 (+24%) | 7.6 (+6%) / 6.3 |
| arsenal | 234 | 299 (-21%) | 498 | 26.0 / 23.9 | 8040, 6 (-22%) | 7.4 (+3%) / 6.7 |

Duel minigun alone, 2 s held: 42 HP of a 325-HP Classic; 0 of a 234-HP ARSENAL mirror.

#### high

| plow | HP | 1-target DPS (vs plow mean) | cluster DPS | ult fill: fight / boss (s) | ult dmg, bots hit (vs mean) | duel TTK avg (vs mean) / min (s) |
|---|---|---|---|---|---|---|
| classic | 500 | 1259 (-4%) | 5188 | 21.6 / 14.5 | 27603, 6 (+9%) | 7.2 (+3%) / 6.3 |
| volt | 340 | 1423 (+8%) | 8086 | 29.1 / 28.3 | 24522, 8 (-3%) | 7.4 (+5%) / 6.8 |
| brute | 540 | 1447 (+10%) | 8277 | 24.4 / 24.9 | 22680, 8 (-11%) | 6.6 (-6%) / 5.3 |
| isotope | 440 | 1136 (-14%) | 6398 | 20.3 / 27.7 | 32494, 8 (+28%) | 7.4 (+6%) / 6.3 |
| arsenal | 360 | 1353 (+3%) | 2480 | 32.4 / 24.7 | 19584, 6 (-23%) | 6.5 (-8%) / 5.6 |

Duel minigun alone, 2 s held: 86 HP of a 500-HP Classic; 0 of a 360-HP ARSENAL mirror.

## Limits of the model

- The dummies have no armour. In the game, armour comes off each hit (minimum 1), so many-small-hit weapons lose more
  against armoured bots and bosses than the table shows. The minigun nerf cut damage per round to 4 (from 9), which
  against flat armour 3 to 8 would have left 1 per round, so minigun rounds and laser ticks (`DamageOpts.direct`) now
  face only half a bot's armour (Enemies, DIRECT_ARMOR). That keeps them about as effective against armour, relative
  to their raw damage, as before the nerf. Burn and pool ticks still face full armour.
- Slam, whirl and dash come from the engagement model above, not from real driving. They are 10 to 30% of each snowball
  plow's damage, and they are the same model for all four.
- The duel victim is parked and never fights back, dodges, dashes or blocks with a ball. Real duels run longer. The
  numbers compare plows; they don't predict round length.
- Thunderclap's storm strikes and other effects roll `Math.random`. The report and the tests seed it, so runs repeat
  exactly.
