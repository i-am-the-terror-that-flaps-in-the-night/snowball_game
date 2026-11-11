import * as THREE from 'three';

/* Plow tuning constants (moved verbatim from entities/Plow.ts). */

/* Model layout (local, facing +Z): rear dump bed at -Z, cab mid-front, hood, blade at BLADE_Z. */
export const BLADE_Z = 2.35;
export const TIP_Z = BLADE_Z + 0.15;
/** Driving into a destructible prop faster than this (m/s), or dashing, smashes it. */
export const PROP_SMASH_SPEED = 6;
export const REAR_Z = 2.15;
export const WHEEL_R = 0.48;
/** BRUTUS's taller, deeper blade (visual scale on Y / Z; width still follows bladeWidth). */
export const BRUTE_BLADE_Y = 1.28;
export const BRUTE_BLADE_Z = 1.15;
/** Buzzsaw spin (rad/s) at rest; the halo is fully grown at SAW_SPIN_BASE + SAW_SPIN_FULL. */
export const SAW_SPIN_BASE = 16;
export const SAW_SPIN_FULL = 75;
/** Full fury multiplies the spin by 1 + SAW_FURY_SPIN. */
export const SAW_FURY_SPIN = 2;
/** Damage dealt / taken that fills the saw fury from empty; it drains SAW_FURY_DRAIN per second. */
export const SAW_FURY_DEALT = 250;
export const SAW_FURY_TAKEN = 60;
export const SAW_FURY_DRAIN = 0.15;
export const _haloCool = new THREE.Color(0xffc040);
export const _haloHot = new THREE.Color(0xff3010);

/** Reverse top speed as a share of maxSpeed; VOLT-9 backs off much faster while the Arc Lance is held (KITING: the
 *  true ranged pilot can keep a diver at lance range). */
export const REV_SPEED = 0.45;
export const VOLT_KITE_REV = 0.7;
/** ...in the online Duel (pvp): divers (the Classic's rush, BRUTUS) must not simply walk a kiting VOLT-9 down. */
export const VOLT_KITE_REV_PVP = 0.8;
/** Reverse top speed (m/s) for this kind: VOLT_KITE_REV (VOLT_KITE_REV_PVP in the Duel) x maxSpeed for VOLT-9 while
 *  its Arc Lance fires, else REV_SPEED. */
export const reverseCap = (maxSpeed: number, kind: string, arcHeld: boolean, pvp = false): number =>
  maxSpeed * (kind === 'volt' && arcHeld ? (pvp ? VOLT_KITE_REV_PVP : VOLT_KITE_REV) : REV_SPEED);

export const SLAM_WINDUP = 0.12;
export const SLAM_LUNGE = 0.2;
export const SLAM_IMPACT_AT = 0.05;
export const SLAM_LUNGE_SPEED = 8;
export const SLAM_COOLDOWN = 0.5;
/** Dash: full-power burst (ignores the speed cap), then eases back to the cap. */
export const DASH_SECONDS = 0.5;
export const DASH_EASE = 0.3;
export const DASH_IFRAMES = 0.2;
export const DASH_STEER = 0.4;
/** Dash speed after a dash strike (plows through the target). */
export const DASH_STRIKE_KEEP = 0.8;
export const WHIRL_SECONDS = 0.9;
export const WHIRL_TICKS = [0.1, 0.35, 0.6, 0.85];
export const WHIRL_TURNS = 2;
export const WHIRL_SPEED = 0.75;
export const WHIRL_STEER = 0.85;
export const SPAWN_PROTECT = 2;
export const INPUT_BUFFER = 0.2;
export const MAX_GHOSTS = 8;
export const MAX_STREAKS = 40;
export const STREAK_LIFE = 0.24;
/** Cosmetic trail: seconds between puffs while cruising / dashing, and the speed it starts at. */
export const TRAIL_EVERY = 0.07;
export const TRAIL_EVERY_DASH = 0.025;
export const TRAIL_MIN_SPEED = 2.5;
/** Share of camera shake a duel opponent's plow causes on this screen. */
export const REMOTE_SHAKE = 0.35;
/** Terrain: plow height (m) for ceiling bonks / deck walls; slope speed bonus decay (m/s²) above the speed cap. */
export const PLOW_HEIGHT = 2.4;
export const SLOPE_BOOST_DECAY = 1.5;
/** Seconds of reduced grip that linger after leaving ice (blend back to full grip). */
export const ICE_LINGER = 0.35;
/** Lava: seconds between 'lavaBurn' sounds, and between batched plowDamaged events. */
export const LAVA_SFX_GAP = 0.45;
export const LAVA_EVENT_GAP = 0.5;
