/** Starter plows. Picked in the Garage; both are free. Each multiplies the shared garage stats and has its own
 *  exclusive upgrade line (Classic: Inferno fire on F; VOLT-9: the 'volt' category, Thunderclap on F). */
export type PlowKind = 'classic' | 'volt';

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
  fAbility: 'fire' | 'zap';
}

export const PLOWS: Record<PlowKind, PlowDef> = {
  classic: {
    id: 'classic',
    name: 'Classic Plow',
    icon: '🚜',
    tagline: 'The trusty orange municipal plow. Tough, heavy-hitting, runs on diesel.',
    traits: ['Full HP', 'Full slam damage', 'F: Inferno fire (Pilot perk)'],
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
    traits: ['+12% speed, +25% acceleration', '+20% dash power', '-15% HP, -10% slam damage', 'Own Volt upgrades: chain lightning, Tesla field, Thunderclap (F), battery shield'],
    hpMult: 0.85,
    speedMult: 1.12,
    accelMult: 1.25,
    dashPowerMult: 1.2,
    slamMult: 0.9,
    fAbility: 'zap',
  },
};
