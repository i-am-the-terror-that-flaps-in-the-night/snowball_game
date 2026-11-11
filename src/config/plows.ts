/** Starter plows. Picked in the Garage; all are free. Each multiplies the shared garage stats and has its own
 *  exclusive upgrade line (Classic: the 'classic' category, Inferno fire on F; VOLT-9: the 'volt' category, Thunderclap on F;
 *  BRUTUS: the 'brute' category, Ground Pound on F; ISOTOPE: the 'isotope' category, Meltdown on F). */
export type PlowKind = 'classic' | 'volt' | 'brute' | 'isotope' | 'arsenal';

export interface PlowDef {
  id: PlowKind;
  name: string;
  icon: string;
  tagline: string;
  /** Short perks / drawbacks: the picker card's tooltip and the chips on the Garage's plow-line tab. */
  traits: string[];
  hpMult: number;
  speedMult: number;
  accelMult: number;
  dashPowerMult: number;
  slamMult: number;
  /** Packed Ice levels past ICE_GROWTH_KNEE add this much to this plow's damage mult (the whole kit: slam, fire,
   *  whirl) and its ult power, eased by soft(): see Progression.computeStatsFor. */
  iceGrowth?: number;
  /** What F does with this plow. */
  fAbility: 'fire' | 'zap' | 'pound' | 'meltdown' | 'missiles';
  /** Not a snowplow (every kind but the Classic): no blade, never plows snow or holds a ball, and SPACE / E are the
   *  vehicle's own abilities (combat/shared.ts VehicleKit.primary / secondary) instead of slam / whirlwind. */
  noBall?: boolean;
  /** HEAVINESS: share of every knockback / shove / pull this plow takes (1 = full, 0.5 = half). Bots' rams, boss
   *  shockwaves and pulls, Duel hits and pulls all scale by it (knockScale). Heavy chassis shrug off being moved. */
  knockResist: number;
}

/** Share of a knockback, shove or pull a plow of this kind takes (PlowDef.knockResist; 1 for an unknown kind). Every
 *  source that moves a plow scales by it: Combat.hitPlow (bots, Brawl rivals, the Duel opponent), boss pulls
 *  (enemies/bosses.ts), and any Duel pull on the other plow (ARSENAL's disc). */
export function knockScale(kind: PlowKind | undefined): number {
  const k = kind ? PLOWS[kind]?.knockResist : undefined;
  return k ?? 1;
}

/** SPACE / E are the vehicle's own kit (not slam / whirlwind): a non-Classic kind not switched to the snowball kit. */
export function isVehicle(st: { plowKind: PlowKind; snowKit?: boolean }): boolean {
  return !!PLOWS[st.plowKind]?.noBall && !st.snowKit;
}

export const PLOWS: Record<PlowKind, PlowDef> = {
  classic: {
    id: 'classic',
    name: 'Classic Plow',
    icon: '🚜',
    tagline: 'The close-range assassin: slam snow chunks out of them, then rush in 20 m and slam them home.',
    traits: [
      '+15% HP · sturdy: takes 20% less knockback · full slam damage, +5.5% more per Packed Ice level past 4',
      'SPACE tap: SLAM your snowball, as always; every bot it hits packs a ❄ snow chunk (max 10), and a slam that lands gives +20% speed for 1 s',
      'SPACE hold + release: PLOW RUSH, 1.5-20 m in a straight line (shares the dash meter), ending in your ball slam (at the first bot it touches); the chunks cash in for +5% radius / +4% damage each',
      'F: Inferno fire cone (10 m) + fireball finisher (free) · fire damage builds FIRESTORM: full = 360° fire nova on F',
    ],
    hpMult: 1.15,
    speedMult: 1,
    accelMult: 1,
    dashPowerMult: 1,
    slamMult: 1,
    // Classic buff (by request, mainly slam): +5.5% damage per Packed Ice level past 4: x1.33 at Packed Ice 10, easing
    // toward x1.66 at very high levels (soft(), never past +12 levels).
    // Sim high-tier 1-target 1259 -> 1663, cluster 5188 -> 6880; fresh / mid unchanged (docs/balance.md).
    iceGrowth: 0.055,
    fAbility: 'fire',
    knockResist: 0.8, // heavy pro plow: a diver that shouldn't bounce off its target
  },
  volt: {
    id: 'volt',
    name: 'VOLT-9',
    icon: '⚡',
    tagline: 'A quick, twitchy rover under a crackling coil tower. No blade, all voltage.',
    traits: ['True ranged: the Arc Lance reaches 14 m (~20 m late) and you reverse at 80% speed while it fires', 'Duel: the lance hits 40% softer bumper to bumper (full again 5 m out): keep your distance', '+12% speed, +25% acceleration, +20% dash', '+15% damage (overcharged coils), -5% HP', 'SPACE (hold): Arc Lance chains lightning through up to 7 bots, can PARALYSE, and grounds into lone bots for 1.75x, bosses for 2.6x · E: Static Field, a pulsing stun field that rides with you for 2.5 s', 'F: Thunderclap storm (free, costs HP) · damage builds SUPERCELL: 3 waves of sky lightning'],
    hpMult: 0.95,
    speedMult: 1.12,
    accelMult: 1.25,
    dashPowerMult: 1.2,
    slamMult: 1.15,
    fAbility: 'zap',
    noBall: true,
    knockResist: 1,
  },
  brute: {
    id: 'brute',
    name: 'BRUTUS',
    icon: '🦏',
    tagline: 'Tracked wrecking mech. Two piston fists, two buzzsaws, no patience.',
    traits: ['+35% HP, +20% damage', 'Heavy: takes half knockback and pull', '-8% acceleration, -10% dash', 'SPACE (hold): rapid Wrecking Fist combo, no cooldown: every landed jab staggers and cracks armour; E: Saw Charge', 'F: Ground Pound shockwave (free)', 'Damage builds EARTHQUAKE: full = 3 rolling shockwaves'],
    hpMult: 1.35,
    speedMult: 1,
    accelMult: 0.92,
    dashPowerMult: 0.9,
    slamMult: 1.2,
    fAbility: 'pound',
    noBall: true,
    knockResist: 0.5, // the close tank: half knockback, so it stays in your face
  },
  isotope: {
    id: 'isotope',
    name: 'ISOTOPE',
    icon: '☢️',
    tagline: 'A nuclear flatbed with a glowing reactor on its back. No blade; everything it hoses glows, then falls apart.',
    traits: ['Specialist: zone control, damage over time and tank-buster', 'Irradiated bots take +30% damage, burn, and hit you 20% softer (lead lining)', 'Tank-buster: radiation burn also eats 0.5% of max HP per second (bots counted up to 1500 HP; the bigger the plow, the harder it burns)', '+5% speed, +20% HP', 'SPACE (hold): Rad Sprayer soaks bots in a RAD DOSE that burns for 8-15 s and spreads · E: Fallout Trail of gripping toxic puddles for 4 s', 'F: Meltdown blast + fallout pool (free) · radiation builds Critical Mass: full = NUKE on F'],
    hpMult: 1.2, // ISOTOPE buff by request (secondary to the Rad Sprayer): 1.1 -> 1.2
    speedMult: 1.05,
    accelMult: 1,
    dashPowerMult: 1,
    slamMult: 1,
    fAbility: 'meltdown',
    noBall: true,
    knockResist: 0.85, // lead-lined reactor: a little ballast
  },
  arsenal: {
    id: 'arsenal',
    name: 'ARSENAL',
    icon: '🎯',
    tagline: 'Two giant front wheels, a hovering gyro core and a magnetic disc emitter on the nose. No blade, no snowball: a mid-range disruptor that keeps the fight at the end of its stream.',
    traits: ['No snowball: SPACE = Mag Discs (hold: a stream of homing magnetic discs out to ~10 m that boomerang back, hitting both ways and tugging targets in)', 'E = Mag Repulsor (forward wave, big hit + knockback) · F = Polarity Burst', '+10% speed, -10% HP', 'Damage builds SINGULARITY: a black hole that swallows the fight, 40 m pull'],
    hpMult: 0.9,
    speedMult: 1.1,
    accelMult: 1.1,
    dashPowerMult: 1,
    slamMult: 1,
    fAbility: 'missiles',
    noBall: true,
    knockResist: 1,
  },
};
