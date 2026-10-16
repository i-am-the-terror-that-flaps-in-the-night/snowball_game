/** Starter plows. Picked in the Garage; all are free. Each multiplies the shared garage stats and has its own
 *  exclusive upgrade line (Classic: Inferno fire on F; VOLT-9: the 'volt' category, Thunderclap on F;
 *  BRUTUS: the 'brute' category, Ground Pound on F). */
export type PlowKind = 'classic' | 'volt' | 'brute';

export interface PlowDef {
  id: PlowKind;
  name: string;
  icon: string;
  tagline: string;
  /** Short perks / drawbacks shown on the picker card. */
  traits: string[];
  hpMult: number;
  speedMult: number;
  accelMult: number;
  dashPowerMult: number;
  slamMult: number;
  /** What F does with this plow. */
  fAbility: 'fire' | 'zap' | 'pound';
}

export const PLOWS: Record<PlowKind, PlowDef> = {
  classic: {
    id: 'classic',
    name: 'Classic Plow',
    icon: '🚜',
    tagline: 'The trusty orange municipal plow. Tough, heavy-hitting, runs on diesel.',
    traits: ['Full HP', 'Full slam damage', 'F: Inferno fire cone (free)', 'Own upgrade: Inferno Exhaust (hotter, faster fire)'],
    hpMult: 1,
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
    traits: ['+12% speed, +25% acceleration, +20% dash', '+15% damage (electrified blade), -15% HP', 'F: Thunderclap storm (free, costs HP)', 'Own Volt upgrades: chain lightning, Tesla field, clap, battery'],
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
    traits: ['+35% HP, +20% damage, bigger blade', '-12% speed, -15% acceleration, -10% dash', 'F: Ground Pound shockwave (free)', 'Own Brute upgrades: pound, Iron Hide, Momentum'],
    hpMult: 1.35,
    speedMult: 0.88,
    accelMult: 0.85,
    dashPowerMult: 0.9,
    slamMult: 1.2,
    fAbility: 'pound',
  },
};
