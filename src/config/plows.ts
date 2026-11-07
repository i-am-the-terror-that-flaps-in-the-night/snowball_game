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
  /** What F does with this plow. */
  fAbility: 'fire' | 'zap' | 'pound' | 'meltdown' | 'missiles';
  /** Not a snowplow (every kind but the Classic): no blade, never plows snow or holds a ball, and SPACE / E are the
   *  vehicle's own abilities (combat/shared.ts VehicleKit.primary / secondary) instead of slam / whirlwind. */
  noBall?: boolean;
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
    tagline: 'The trusty orange municipal plow. Tough, heavy-hitting, runs on diesel.',
    traits: ['+25% HP', 'Full slam damage', 'F: Inferno fire cone + fireball finisher (free)', 'Fire damage builds FIRESTORM: full = 360° fire nova on F'],
    hpMult: 1.25,
    speedMult: 1,
    accelMult: 1,
    dashPowerMult: 1,
    slamMult: 1,
    fAbility: 'fire',
  },
  volt: {
    id: 'volt',
    name: 'VOLT-9',
    icon: '⚡',
    tagline: 'A quick, twitchy rover under a crackling coil tower. No blade, all voltage.',
    traits: ['+12% speed, +25% acceleration, +20% dash', '+15% damage (overcharged coils), -15% HP', 'SPACE (hold): Arc Lance chains lightning through 3 bots ahead · E: Static Field, a pulsing stun field that rides with you for 2.5 s', 'F: Thunderclap storm (free, costs HP) · damage builds SUPERCELL: 3 waves of sky lightning'],
    hpMult: 0.85,
    speedMult: 1.12,
    accelMult: 1.25,
    dashPowerMult: 1.2,
    slamMult: 1.15,
    fAbility: 'zap',
    noBall: true,
  },
  brute: {
    id: 'brute',
    name: 'BRUTUS',
    icon: '🦏',
    tagline: 'Tracked wrecking mech. Two piston fists, two buzzsaws, no patience.',
    traits: ['+35% HP, +20% damage', '-8% acceleration, -10% dash', 'SPACE (hold): rapid Wrecking Fist combo, no cooldown; E: Saw Charge', 'F: Ground Pound shockwave (free)', 'Damage builds EARTHQUAKE: full = 3 rolling shockwaves'],
    hpMult: 1.35,
    speedMult: 1,
    accelMult: 0.92,
    dashPowerMult: 0.9,
    slamMult: 1.2,
    fAbility: 'pound',
    noBall: true,
  },
  isotope: {
    id: 'isotope',
    name: 'ISOTOPE',
    icon: '☢️',
    tagline: 'A nuclear flatbed with a glowing reactor on its back. No blade; everything it hoses glows, then falls apart.',
    traits: ['Irradiated bots take +30% damage and burn', '+5% speed, +10% HP', 'SPACE (hold): Rad Sprayer cone irradiates bots ahead · E: Fallout Trail of gripping toxic puddles for 4 s', 'F: Meltdown blast + fallout pool (free) · radiation builds Critical Mass: full = NUKE on F'],
    hpMult: 1.1,
    speedMult: 1.05,
    accelMult: 1,
    dashPowerMult: 1,
    slamMult: 1,
    fAbility: 'meltdown',
    noBall: true,
  },
  arsenal: {
    id: 'arsenal',
    name: 'ARSENAL',
    icon: '🎯',
    tagline: 'Crawler tracks, an armoured hull and a turret-mounted pulse-laser cannon. No blade, no snowball, all firepower.',
    traits: ['No snowball: SPACE = pulse laser turret (hold, auto-aims across a 240° arc round the nose)', 'E = laser beam · F = homing missile salvo', '+10% speed, -10% HP', 'Damage builds MISSILE STORM: full = 21 heavy missiles, 75 m reach'],
    hpMult: 0.9,
    speedMult: 1.1,
    accelMult: 1.1,
    dashPowerMult: 1,
    slamMult: 1,
    fAbility: 'missiles',
    noBall: true,
  },
};
