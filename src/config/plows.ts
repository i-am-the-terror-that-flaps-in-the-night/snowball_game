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
  /** No blade and no snowball (ARSENAL): Space / E fire weapons instead of slam / whirlwind. */
  noBall?: boolean;
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
    tagline: 'Experimental electric plow. Quick and twitchy, crackling with stored charge.',
    traits: ['+12% speed, +25% acceleration, +20% dash', '+15% damage (electrified blade), -15% HP', 'F: Thunderclap storm (free, costs HP)'],
    hpMult: 0.85,
    speedMult: 1.12,
    accelMult: 1.25,
    dashPowerMult: 1.2,
    slamMult: 1.15,
    fAbility: 'zap',
  },
  brute: {
    id: 'brute',
    name: 'BRUTUS',
    icon: '🦏',
    tagline: 'Armored demolition rig. Slow to get rolling, impossible to stop once it is.',
    traits: ['+35% HP, +20% damage, bigger blade', '-8% acceleration, -10% dash', 'F: Ground Pound shockwave (free)'],
    hpMult: 1.35,
    speedMult: 1,
    accelMult: 0.92,
    dashPowerMult: 0.9,
    slamMult: 1.2,
    fAbility: 'pound',
  },
  isotope: {
    id: 'isotope',
    name: 'ISOTOPE',
    icon: '☢️',
    tagline: 'Lead-lined reactor hauler. Everything it touches glows, and then it falls apart.',
    traits: ['Irradiated bots take +15% damage', '+5% speed, +10% HP', 'F: Meltdown blast + fallout pool (free)', 'Radiation damage builds Critical Mass: full = NUKE on F'],
    hpMult: 1.1,
    speedMult: 1.05,
    accelMult: 1,
    dashPowerMult: 1,
    slamMult: 1,
    fAbility: 'meltdown',
  },
  arsenal: {
    id: 'arsenal',
    name: 'ARSENAL',
    icon: '🎯',
    tagline: 'Not a plow at all: a hover-tracked weapons platform. No blade, no snowball, all firepower.',
    traits: ['No snowball: SPACE = autocannon (hold, auto-aims)', 'E = laser beam · F = homing missile salvo', '+10% speed, -10% HP'],
    hpMult: 0.9,
    speedMult: 1.1,
    accelMult: 1.1,
    dashPowerMult: 1,
    slamMult: 1,
    fAbility: 'missiles',
    noBall: true,
  },
};
