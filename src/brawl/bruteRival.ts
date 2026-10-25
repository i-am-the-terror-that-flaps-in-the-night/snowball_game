import * as THREE from 'three';
import type { BrawlDifficulty } from '../core/types';
import type { RivalRig } from './models';

/* BRUTUS rivals: some Brawl bots roll the armored starter plow. They get BRUTUS's stat multipliers
 * (src/config/plows.ts: more HP and damage, slower), the tracked-dozer body (src/entities/plowModels.ts, in the
 * rival's own paint) and a bot Ground Pound — a clearly telegraphed hop-and-slam shockwave on a long cooldown:
 * AoE damage (falls off toward the rim), outward knockback and a short stun on everything it catches. The Brute
 * upgrade line (Iron Hide, Momentum) stays player-only. */

/** Chance a rival rolls BRUTUS, per lobby (rolled alongside VOLT-9; see BrawlManager.rivalStats). Elites add
 *  BRUTE_ELITE_BONUS. */
export const BRUTE_RIVAL_CHANCE: Record<BrawlDifficulty, number> = { rookie: 0.18, pro: 0.27, legend: 0.36 };
export const BRUTE_ELITE_BONUS = 0.18;

/** Bot Ground Pound timing: POUND_CROUCH s of crouch + growing ground ring, then a POUND_HOP s hop; the slam
 *  lands at POUND_WIND. */
export const POUND_CROUCH = 0.45;
export const POUND_HOP = 0.35;
export const POUND_WIND = POUND_CROUCH + POUND_HOP;
export const POUND_HOP_H = 1.3;
/** Cooldown (s), ring radius (m), raw damage at the center (x rival damage mult, then the brawl hit cap; the rim
 *  takes POUND_RIM_FRAC of it), outward knockback (m/s). */
export const POUND_CD = 10;
export const POUND_R = 7;
export const POUND_DMG = 40;
export const POUND_RIM_FRAC = 0.6;
export const POUND_KB = 18;
/** Stun: rivals hard-stunned (no driving / attacks) for POUND_STUN s; the player is held for POUND_STUN_PLAYER s
 *  (kept short — the player can't see the bot's cooldown). */
export const POUND_STUN = 0.8;
export const POUND_STUN_PLAYER = 0.35;

const BRUTE_BLADE = new THREE.Color(0x7a828e);

let telegraphGeo: THREE.BufferGeometry | null = null;
let fillGeo: THREE.BufferGeometry | null = null;

export interface BruteRig {
  /** Ground ring that grows to the pound radius during the telegraph. */
  telegraph: THREE.Mesh;
  telegraphMat: THREE.MeshBasicMaterial;
  /** Faint filled disc showing the danger zone. */
  fill: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
  /** Cleat track phase (m travelled). */
  trackPhase: number;
  dispose(): void;
}

/** Arm a BRUTUS rival rig (built with createRivalRig(kind, color, 'brute')): steel blade tinted with the
 *  rival's color + the pound telegraph (hazard-amber ring and danger disc). */
export function attachBruteRig(rig: RivalRig): BruteRig {
  rig.blade.color.lerp(BRUTE_BLADE, 0.65);
  if (!telegraphGeo) {
    telegraphGeo = new THREE.RingGeometry(0.9, 1, 48);
    telegraphGeo.rotateX(-Math.PI / 2);
    fillGeo = new THREE.CircleGeometry(1, 40);
    fillGeo.rotateX(-Math.PI / 2);
  }
  const telegraphMat = new THREE.MeshBasicMaterial({ color: 0xffb21f, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  // A flat ring: one pass draws exactly what the back + front passes would (no extra draw / program switch).
  telegraphMat.forceSinglePass = true;
  const telegraph = new THREE.Mesh(telegraphGeo, telegraphMat);
  telegraph.position.y = 0.09;
  telegraph.visible = false;
  rig.root.add(telegraph);
  const fillMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const fill = new THREE.Mesh(fillGeo!, fillMat);
  fill.position.y = 0.07;
  fill.scale.setScalar(POUND_R);
  fill.visible = false;
  rig.root.add(fill);
  return {
    telegraph,
    telegraphMat,
    fill,
    fillMat,
    trackPhase: 0,
    dispose() {
      telegraphMat.dispose();
      fillMat.dispose();
    },
  };
}
