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

- **Rotation.** Every F ability goes off when it is ready, ARSENAL holds its SPACE weapon (now the Mag Shotgun) and fires its E (now the Mag Repulsor) on cooldown.
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

**Multi-equip.** Gear is no longer one item per slot: every owned item can be equipped at once. The sim tiers still
wear five items (one per slot), so the tables below don't include a fully stacked plow. For reference, a Classic with
the high-tier core and line but all 16 items at ★8 (instead of five) gets: blade width 2.6 -> 4.6 m, damage taken
x1.0 -> x0.75, dash cooldown 1.25 -> 0.56 s, whirl cooldown 3.1 -> 1.3 s, whirl damage 10 -> 32, ram damage 14 -> 45,
15% lifesteal, Ice Shield and Frost on top of Avalanche. In the sim that is about +5 to 15% single-target DPS and +1
to 27% cluster DPS depending on the plow, and in a mirror where both duellists are fully stacked TTKs go up (more
armour and lifesteal), e.g. Brute 5.1 -> 8.7 s. The Duel catch-up already values every equipped item at cost (the
high-tier garage goes from about 100k to 140k), so a weaker garage still gets the whole gap in coins.

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
  SUPERCELL 900 became 2300, EARTHQUAKE 900 became 1800, ORBITAL 1000 became 1700 (MISSILE STORM later dropped to 1200: it charges about 30% faster).
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

## Current numbers (ARSENAL's PvE bonus cut to 1.5x)

The tables in the sections above predate the ARSENAL buff commits (cone blast, plate pierce, Mag Shotgun range / rate,
Repulsor cooldown). After those, with every ARSENAL weapon hitting bots 3x as hard (`PVE_MULT`), it out-damaged the
snowball plows about 3x on one target (+194% / +211% / +231% by tier) and doubled their ultimate damage. The bot sweep
(`scripts/omega-probe.mjs`) showed it in real runs too: fresh, it cleared The Omega Works in 72 s against 177-256 s for
the others, and at mid / high it finished most arenas 10-25% faster while barely getting hit.

`PVE_MULT` is now 1.5 (the Duel never used it), and the SINGULARITY meter's matching divisor (`PVE_ULT`,
`ultimates.ts`) went from 2.4 to 1.75 so it still fills in about 16 s fresh. ARSENAL keeps an edge on single targets
(no ball shield, no slam / whirl, less HP); its cluster damage is now in line with the others.

Damage alone barely moved its real clear times (wave pacing sets most of a run): the sweep showed its edge was
safety, killing from 11 m and reeling bots into point-blank, so it was rarely hit. The Mag Shotgun's base reach went
11 m -> 8 m (full damage still to 6 m). One ARSENAL-only sweep after both changes, against the other four plows:
fresh it now clears arenas 1-4 at the fast end of the pack (Rust Basin 66 s vs 77-100 s; it was 47 s), mid it is
level on the Plaza / Omega Works (54 / 49 s vs 55-80 / 50-81 s) and ~15% quicker on Rust Basin / Thermal Divide, high
it is level everywhere. It still clears the last two arenas fresh in ~90 s against the others' 3-4 minutes, but
nobody plays those without upgrades.

The distinct-primaries pass (Rad Dose, Arc Lance chains + paralysis, Wrecking Fist stagger, Magnetic Reel, strip
scrap) left the sim's numbers unchanged: its dummies have 10M HP and stand still, so lingering doses, reels and shed
shards barely register.

#### fresh

| plow | HP | 1-target DPS (vs plow mean) | cluster DPS | ult fill: fight / boss (s) | ult dmg, bots hit (vs mean) | duel TTK avg (vs mean) / min (s) |
| classic | 150 | 78 (+5%) | 334 | 24.1 / 17.0 | 2722, 6 (-13%) | 6.3 (-7%) / 4.8 |
| volt | 102 | 67 (-10%) | 272 | 20.7 / 39.4 | 2832, 8 (-9%) | 6.1 (-10%) / 4.7 |
| brute | 162 | 82 (+10%) | 333 | 20.7 / 27.1 | 2850, 8 (-8%) | 6.7 (-1%) / 5.7 |
| isotope | 132 | 71 (-5%) | 248 | 22.5 / 39.9 | 2908, 8 (-7%) | 7.7 (+14%) / 7.0 |
| arsenal | 108 | 114 (+52%) | 358 | 15.9 / 18.7 | 4256, 8 (+37%) | 7.0 (+4%) / 5.5 |

#### mid

| plow | HP | 1-target DPS (vs plow mean) | cluster DPS | ult fill: fight / boss (s) | ult dmg, bots hit (vs mean) | duel TTK avg (vs mean) / min (s) |
| classic | 325 | 436 (+21%) | 1716 | 23.4 / 9.7 | 11161, 6 (-9%) | 6.1 (-13%) / 5.2 |
| volt | 221 | 291 (-19%) | 1490 | 20.5 / 38.3 | 11166, 8 (-9%) | 7.2 (+3%) / 5.8 |
| brute | 351 | 412 (+14%) | 1747 | 19.3 / 21.4 | 11127, 8 (-9%) | 6.1 (-13%) / 5.9 |
| isotope | 286 | 305 (-15%) | 1338 | 15.8 / 30.7 | 10846, 8 (-11%) | 9.1 (+29%) / 8.3 |
| arsenal | 234 | 568 (+57%) | 2139 | 17.1 / 15.9 | 16773, 8 (+37%) | 6.6 (-6%) / 5.6 |

#### high

| plow | HP | 1-target DPS (vs plow mean) | cluster DPS | ult fill: fight / boss (s) | ult dmg, bots hit (vs mean) | duel TTK avg (vs mean) / min (s) |
| classic | 500 | 1259 (-15%) | 5188 | 21.6 / 14.5 | 27603, 6 (-8%) | 7.2 (+9%) / 6.3 |
| volt | 340 | 1433 (-4%) | 7497 | 26.4 / 33.1 | 27874, 8 (-8%) | 7.3 (+10%) / 6.7 |
| brute | 540 | 1673 (+12%) | 7323 | 27.3 / 24.9 | 28048, 8 (-7%) | 5.3 (-21%) / 5.1 |
| isotope | 440 | 1591 (+7%) | 7736 | 26.1 / 30.1 | 26451, 8 (-12%) | 7.3 (+9%) / 6.6 |
| arsenal | 360 | 2472 (+66%) | 7611 | 26.0 / 16.8 | 40855, 8 (+35%) | 6.2 (-7%) / 6.0 |

The four snowball plows sit within about ±20% of each other and every Duel kill takes at least 4.7 s (floor 4 s).

## Follow-up: Hard mode sweep, reel removed, grounded arc, Hard scaling

A Hard sweep (mid / high garages, every arena) after the ARSENAL nerfs showed three things:

- **ARSENAL was still the safest plow on Hard** (fastest on every arena at mid, usually 0 HP lost) thanks to the
  Magnetic Reel pinning bots in front of its nose. The reel is gone: a point-blank blast shoves again, a far one
  nudges. On the rerun it takes real damage (434 HP on Hard Plaza at mid, was 0).
- **VOLT-9 crawled through big bosses** (51-56 s on the Plaza / Omega Works Hard bosses at mid, others 22-40 s): its
  2.1-damage arc ticks were eaten by boss armour 6-8. GROUNDED ARC: on a boss, or on a bot with nothing to chain to,
  the arc does 1.75x and faces half armour (bots only; Duel unchanged). The sim's lone dummy always counts as
  grounded, so VOLT's single-target row reads +19% / +26% / +39% by tier (its `balance.test.ts` match-ARSENAL band
  is 25% instead of 18% for that reason).
- **Hard barely bit a late-game garage** (18-56 s clears, bosses in 1-16 s, about the same as normal). Hard now
  scales with the pilot past mid-game (see [modes.md](modes.md)): a late-game garage faces about x1.75 bot HP and
  x1.4 bot damage on top of Hard's own. On the rerun the late-game Plaza / Omega Works Hard clears went from about 50 s
  to 60-79 s, bosses took about twice as long, and HP lost roughly doubled.

## Correction: the sweeps' autopilot never fired three primaries

Until commit `4f80f0f`, `scripts/omega-probe.mjs` only pressed SPACE when it held a snowball (0.5 m+), so in every
sweep before it VOLT-9, BRUTUS and ISOTOPE never used their Arc Lance, Wrecking Fist or Rad Sprayer (ARSENAL had its
own branch and always fired). Read the earlier sweep numbers in this file with that in mind:

- ARSENAL's lead in the sweeps was overstated: it was the only vehicle shooting. Its PvE-bonus cut still stands on the
  balance sim's evidence (3x everyone else, with every weapon firing).
- VOLT-9's "slow bosses" were mostly the autopilot not attacking; the GROUNDED ARC buff was made on that evidence.

With the autopilot fixed (normal mode, mid garage, one run each) the five plows clear every arena within a few
seconds of each other (Plaza 51-63 s, Omega Works 49-62 s), and on Hard (mid and high garage, 60 runs, no errors)
the late arenas take 69-92 s at mid with bosses at 20-31 s, and 47-60 s at high with bosses at 8-14 s.

Replicate runs (3 per plow, Plaza / Omega Works, mid) separated noise from signal: BRUTUS's slow first Plaza run was
noise, but VOLT-9 was the slowest in every run, its boss fights about twice as long as the Classic's or ARSENAL's.
The Arc Lance only locks a boss inside a 60° cone within 9 m, and THE DONALD and Ω charge, leap and climb, so
VOLT-9 got a BOSS LOCK (wide cone and a 3 m hold on bosses; see [plows.md](plows.md)).

## Follow-up: VOLT-9 buff

VOLT-9 had the lowest HP (0.85x) and the lowest crowd damage at fresh / mid of the five, trailed on Plaza / Omega
Works (normal and Hard), and its boss rounds ran ~30 s on Hard. By request the buff is **mainly primary (Arc Lance)
damage**, and VOLT is not meant to be the top late-game damage dealer (ARSENAL is). Final buff:

- HP 0.85x -> 0.95x.
- Arc Lance chain hops at 60% of the arc (was 50%).
- Arc Lance 2.1 -> 2.7 damage per 0.15 s tick (+29%, chain hops and GROUNDED ARC included).
- Static Field pulse back to 14 (an interim 18 was reverted: the buff belongs on the primary).

Sim (`npm run balance`, fresh / mid / high; before = Arc 2.1, Static 18): HP 114 / 247 / 380; 1-target 83 -> 87 /
387 -> 423 / 2034 -> 2337; cluster 304 -> 284 / 1642 -> 1629 / 7999 -> 8789; ult fill (fight) 20.5 -> 19.4 / 19.1 ->
19.2 / 26.1 -> 26.0 s; fastest Duel kill 4.4 -> 5.3 / 6.0 -> 6.0 / 6.8 -> 6.5 s (floor 4 s; the Static Field was most
of VOLT's fresh Duel burst). ARSENAL stays the top single-target plow at every tier (114 / 568 / 2472).

The sim's lone dummy always gets the GROUNDED ARC (1.75x), so VOLT's table 1-target figure (+36% at high) overstates
it. The report now also prints VOLT with a second bot near the dummy (no grounding, as on a typical bot in a wave):
72 / 287 / 1488 (was 71 / 285 / 1354), at or below ARSENAL's duel-equivalent (76 / 379 / 1648). `tests/balance.test.ts`
measures VOLT that way, so it is back on the same 18% band against ARSENAL as BRUTUS / ISOTOPE (it had 25% for the
lone-dummy artifact), and the spread no longer drags Classic out of the 25% band. VOLT's fresh ult floor is 19 s (was
20): the stronger lance also fills SUPERCELL a little faster (19.4 s).

Sweeps (mid, current autopilot; VOLT 1 run on normal, 2 on Hard; others from the reference sweeps), clear / boss:

| arena | VOLT before | VOLT now | others |
|---|---|---|---|
| a3 normal | 41.3 / 6.0 | 39.6 / 3.1 | classic 37.2, arsenal 37.7, isotope 39.8, brute 46.6 |
| Plaza normal | 64.9 / 19.5 | 59.9 / 16.7 | arsenal ~52, isotope ~54, classic ~57, brute ~58 |
| Omega Works normal | 70.4 / 21.6 | 53.5 / 12.0 | isotope ~51, brute ~51, arsenal ~53, classic ~54 |
| Plaza Hard | 88.8 / 30.1 | 72.8 / 19.4 | arsenal 69.3, isotope 70.5, brute 74.4, classic 80.7 |
| Omega Works Hard | 86.2 / 30.8 | 72.7 / 19.6 | arsenal 70.2, brute 71.1, isotope 81.6, classic 92.0 |

VOLT is now in the pack on Hard and on most normal arenas, still behind ARSENAL on every clear time; on normal Plaza it is last, about 5 s back (single runs there swing 5-10 s). Its boss rounds are now the fastest on Hard, by a few seconds, as the boss-fight
plow. Arc 2.5 left it 6-9 s behind on Omega Works; 2.9 put it ahead of everyone on Hard Plaza.

## Follow-up: Classic buff

The Classic was the weakest plow late: at high it had the lowest single-target (1259, -27%) and cluster DPS (5188),
and it was the slowest plow in the Hard sweeps. By request the buff leans on its primary, the **slam**. Pure slam
multipliers do nothing at high, though: there a full ball takes ~160 s to fill, so the sim lands no slams, and more snow
supply breaks the 4 s Duel floor at fresh. A flat `slamMult` raise was ruled out too (x1.1 already puts mid at +18%,
x1.35 breaks the Duel floor). Final buff:

- New `PlowDef.iceGrowth` (Classic 0.055): each Packed Ice level past `ICE_GROWTH_KNEE = 4` adds 5.5% to the Classic's
  slam-damage stat (`damageMult`, which like Packed Ice and `slamMult` also scales its fire) and its `ultPower`,
  through `soft(levels past 4, 6)`: linear for 6 levels (x1.33 at Packed Ice 10), then easing
  toward +12 levels (x1.66) and never past it. The sim's fresh and mid builds
  are at or below the knee, so only high changes.
- Slam Combo per stack: `0.12 + 0.03 * grow(L, 5)` -> `0.12 + 0.04 * grow(L, 5)` (L3 21% -> 24%, L8 32% -> 39%). The
  sim doesn't model it, but slams and other basic attacks are 25-32% of the Classic's real damage.

Sim (`npm run balance`, Classic, before -> after): fresh and mid rows unchanged (150 HP, 78 (-1%) / 334; 325 HP,
436 (+11%) / 1716). High: 1-target 1259 (-27%) -> 1663 (-9%; about +3% on the honest VOLT figure the tests use),
level with BRUTUS 1673 and ahead of ISOTOPE 1591; cluster 5188 -> 6880 (still last, BRUTUS 7323); ult fill (fight /
boss) 21.6 / 14.5 -> 28.6 / 14.5 s (the meter scales with `ultPower`); FIRESTORM 27603 -> 36712, still under ARSENAL's
40855; Duel TTK 7.3 / 6.8 -> 6.7 / 6.3 s (floor 4 s). `tests/balance.test.ts` passes without band changes. An
`iceGrowth` of 0.035 left the Classic last at high (1516); 0.08 made it the top single-target plow at high on the honest
figures and tied ARSENAL's ult (40852), with no sweep gain over 0.055.

Sweeps (Classic, 1 run per cell; others from the reference sweeps), clear / boss / HP lost:

| arena | Classic before | Classic now | others |
|---|---|---|---|
| Plaza Hard high | 54.5 / 10.6 / 271 | 52.1 / 6.1 / 20 | isotope 47.0, volt 47.4 (pre-buff), brute 51.6, arsenal 53.6 |
| Omega Works Hard high | 58.5 / 10.8 / 197 | 52.3 / 8.8 / 97 | brute 49.6, isotope 54.5, volt 54.8 (pre-buff), arsenal 59.9 |
| Plaza Hard mid | 80.7 / - / 677 | 80.6 / 24.9 / 733 | arsenal 69.3, isotope 70.5, volt ~72.8, brute 74.4 |
| Omega Works Hard mid | 92.0 | 88.6 / 28.4 / 390 | arsenal 70.2, brute 71.1, volt ~72.7, isotope 81.6 |
| a3 normal mid | 37.2 | 42.3 / 3.7 / 32 | arsenal 37.7, volt 39.6, isotope 39.8, brute 46.6 |
| Plaza normal mid | 54.4-59.3 | 60.1 / 10.4 / 130 | arsenal 50-53, isotope 51.5-55.5, brute 55.8-62.9, volt ~59.9 |
| Omega Works normal mid | 51.1-56.4 | 53.3 / 13.0 / 87 | isotope ~49, arsenal 50-57.6, brute 47-62, volt ~53.5 |

At high the Classic moves from last to the middle of the pack (2nd on Hard Omega Works, the quickest boss on Hard
Plaza), fastest at clear time nowhere. The mid rows are unchanged mechanically (apart from Combo), so their differences
are run-to-run noise (~5 s): **Hard mid is not fixed**, the Classic is still the slowest there. A knee of 3 would add
about +5% at mid, but mid is already +11% (report) / +19% (honest), so that needs a multi-run Hard-mid probe first. The
Packed Ice shop label still shows only the shared multiplier, so it understates the Classic past level 4.

## Follow-up: ISOTOPE buff

ISOTOPE had the lowest mid single-target (305, -23%) and cluster DPS (1338) of the five, the slowest mid Duel (9.1 s),
and in bot sweeps it took the most damage of any plow (Hard Plaza mid 641 HP lost and a death; Hard Omega Works mid
81.6 s, the slowest bar the Classic). By request the buff is **mainly its primary, the Rad Sprayer** (as for VOLT-9),
and passing ARSENAL is allowed. Final buff:

- Rad Sprayer damage per 0.12 s tick 1.6 -> 2.4; splash on the other bots in the cone 55% -> 65%.
- Cone half angle 0.75 -> 0.85 rad (43° -> 49°), so it reaches bots sitting about 45° off the nose.
- Reactor (Meltdown) scaling exponent 0.8 -> 0.6: less of the sprayer's power comes from high-level Meltdown, more
  from the base, which shifts it from high toward fresh / mid.
- Half of each spray hit lands on contact (was 35%; the rest is still the RAD DOSE). Real 200-HP bots die faster (the
  slow dose was only ~2% of the damage actually dealt in sweeps) and more of the damage feeds lifesteal.
- Rad Sprayer line (`isoSpray`): `1 + 0.1 * grow(L, 5)` -> `1 + 0.25 * grow(L, 3, 0.25)` (x1.75 at L3, x2.06 at L8;
  was x1.3 / x1.68).
- One secondary change: HP 1.1x -> 1.2x (it brawls inside ~6 m with no shield, range or damage reduction).

Sim (`npm run balance`, ISOTOPE, before -> after, both on top of the Classic buff):

| tier | HP | 1-target DPS | cluster DPS | ult fill fight / boss (s) | Duel TTK avg / min (s) |
|---|---|---|---|---|---|
| fresh | 132 -> 144 | 71 (-11%) -> 80 (-2%) | 248 -> 320 | 22.5 / 39.9 -> 21.8 / 36.0 | 7.7 / 7.0 -> 7.8 / 7.0 |
| mid | 286 -> 312 | 305 (-23%) -> 363 (-11%) | 1338 -> 1697 | 15.8 / 30.7 -> 16.0 / 27.3 | 9.1 / 8.3 -> 9.0 / 8.6 |
| high | 440 -> 480 | 1591 (-12%) -> 1799 (-4%) | 7736 -> 8969 | 26.1 / 30.1 -> 28.7 / 27.8 | 7.4 / 6.6 -> 7.4 / 7.0 |

ISOTOPE is off the bottom of mid single-target (now inside the 25% band) and of cluster DPS at every tier (mid ahead of
VOLT's 1644; high now the best cluster figure, 8969). It stays below ARSENAL on single-target everywhere (+32..+40%) and
keeps the slowest mid Duel; its fastest Duel kill is 7.0 s or more (floor 4 s). NUKE is untouched (26451 at high).
`tests/balance.test.ts` passes without band changes. Smaller variants: spray 2.2 / direct 0.45 / no line or HP change
left mid at -18% and still last, and cost a little at high (the flatter reactor exponent); adding the line reshape and 65% splash gave -13% but no survivability.

Sweeps (ISOTOPE, 1 run per cell after; before = reference sweeps), clear / boss / HP lost:

| arena | ISOTOPE before | ISOTOPE now | others (clear) |
|---|---|---|---|
| a3 normal mid | 39.8 / 7.3 / 77 | 43.8 / 7.3 / 70 | classic 37.2, arsenal 37.7, volt 41.3, brute 46.6 |
| Plaza normal mid | ~53.7 / - / ~272 | 53.0 / 12.9 / 331 | arsenal ~51.6, classic ~56.6, brute ~59.7, volt ~64 |
| Omega Works normal mid | ~50.2 / - / ~178 | 46.1 / 12.0 / 181 | brute best 47.3, arsenal ~52.4, classic ~53.2, volt ~67.7 |
| Plaza Hard mid | 70.5 / 23.6 / 641, 1 death | 69.9 / 25.7 / 725, 1 death | arsenal 69.3, brute 74.4, classic 80.7, volt 88.8 |
| Plaza Hard high | 47.0 / 10.5 / 249 | 44.0 / 9.0 / 114 | volt 47.4, brute 51.6, arsenal 53.6, classic 54.5 |
| Omega Works Hard mid | 81.6 / 24.8 / 459 | 75.1 / 27.5 / 525 | arsenal 70.2, brute 71.1, volt 86.2, classic 92.0 |
| Omega Works Hard high | 54.5 / - / 213 | 46.0 / 8.8 / 125 | brute 49.6, volt 54.8, classic 58.5, arsenal 59.9 |

("others" are pre-buff VOLT / Classic reference runs.) ISOTOPE is now the fastest clear on Omega Works normal mid and on
both Hard high arenas, ties ARSENAL on Hard Plaza mid and is no longer near last on Hard Omega Works mid. a3 looks like
noise (single runs swing ~5 s). At high its damage taken roughly halves, since bots die sooner. **Mid survivability is
not fixed**: it still loses the most HP on every mid run and still dies once on Hard Plaza mid; the +10% HP only makes
that a smaller share of its pool. Possible follow-ups (code, not numbers): let the dose soak heal too, or teach the bot
autopilot to hold spray range. If the high tier proves too hot, spray 2.2 gives about -11% at mid and 0% at high.

**Dose lifesteal (by request).** The RAD DOSE now heals through lifesteal: the dose's share of each 0.5 s burn repays
`DOSE_HEAL` = 1 x lifesteal (same as a normal hit); the base burn, trail, pools and aura still don't heal. In the probe
tiers only mid has lifesteal (Scrap Recycler 3 = 6%); high has no Scrap Recycler, so high is unchanged by construction.
`npm run balance` rows and bands are identical (it measures damage, and the duel defender is parked). Hard sweeps, 3 runs:
Plaza mid 68.9 s / 771 HP lost (725 / 811 / 776), still 1 death every run; Omega Works mid 66.0 s / 391 HP lost, 0 deaths
(reference ~74 s / ~774 and ~70 s / ~400). That is within noise: real 200-HP bots die before their dose burns off (the
dose is ~2% of damage dealt), so the heal adds only a few HP per run. A half-strength variant (0.5) measured the same.
**Mid survivability is still not fixed.** Bigger levers, not swept: heal on the whole burn (base + dose), let pools /
aura / trail heal, or more Salvage at mid; the first two grow with crowd size and would want a per-second heal cap
(today the only cap is max HP). Dose healing is bounded by the total dose (at most 1.25x the spray, with contagion).

**Lead lining (by request, the structural fix).** Hits from a bot ISOTOPE has irradiated deal 20% less
(`LEAD_LINING`, applied in `Combat.hitPlow` after the garage damage reduction; bots only, so Duel / Brawl and the sim
rows are unchanged). Hard sweeps, 3 runs, HP lost before (dose-heal reference) -> after:

| arena | mid | high |
|---|---|---|
| Plaza Hard | 771 -> 622 (594 / 629 / 643), still 1 death every run | 264 -> 307 (238 / 275 / 408) |
| Omega Works Hard | 391 -> 368, 0 deaths | 155 -> 150 |

Mid Plaza, the worst cell, drops about 19%, so nearly all of its damage comes from bots it has dosed; the Plaza mid death
stays (622 lost is still about two full 312-HP pools). High is noise (one 408 outlier; the other two runs sit
at or under the reference). Clear times unchanged (Plaza mid 69.4 s, Omega mid 69.6 s, high 45.7 / 52.6 s). If the
death should go too, 30% is the next step; past that it starts to make ISOTOPE the tank it was never meant to be.

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
