import * as THREE from 'three';
import type { BrawlDifficulty } from '../core/types';
import type { RivalRig } from './models';

/* VOLT-9 rivals: some Brawl bots roll the electric starter plow. They get VOLT-9's stat multipliers
 * (src/config/plows.ts), the VOLT wedge body (src/entities/plowModels.ts, in the rival's own paint) with a
 * glowing blade and twin Tesla coils, and a bot Thunderclap —
 * a telegraphed lightning blast on a long cooldown. No Overclock / Second Wind / lifesteal (player-only). */

/** Chance a rival rolls VOLT-9, per lobby. Elites add VOLT_ELITE_BONUS. */
export const VOLT_RIVAL_CHANCE: Record<BrawlDifficulty, number> = { rookie: 0.2, pro: 0.3, legend: 0.4 };
export const VOLT_ELITE_BONUS = 0.2;

/** Bot Thunderclap: crackle telegraph (s), cooldown (s), blast radius (m), raw damage (x rival damage mult,
 *  then the brawl hit cap), shock-slow on rivals (s), knockback (m/s). */
export const VOLT_CLAP_WIND = 0.6;
export const VOLT_CLAP_CD = 9;
export const VOLT_CLAP_R = 8.5;
export const VOLT_CLAP_DMG = 42;
export const VOLT_CLAP_STUN = 1.2;
export const VOLT_CLAP_KB = 14;

const VOLT_BLADE = new THREE.Color(0x9fe8ff);

let telegraphGeo: THREE.BufferGeometry | null = null;

export interface VoltRig {
  coilTops: THREE.Object3D[];
  coilMat: THREE.MeshStandardMaterial;
  /** Ground ring that grows to the clap radius during the telegraph. */
  telegraph: THREE.Mesh;
  telegraphMat: THREE.MeshBasicMaterial;
  /** Seconds until the next idle arc between the coils. */
  arcT: number;
  /** Seconds until the next telegraph crackle bolt. */
  crackleT: number;
  dispose(): void;
}

/** Electrify a VOLT-9 rival rig (built with createRivalRig(kind, color, 'volt'): the VOLT wedge body with Tesla
 *  coils, in the rival's own paint): glowing blade + a clap telegraph ring. */
export function attachVoltRig(rig: RivalRig): VoltRig {
  rig.blade.color.copy(VOLT_BLADE);
  rig.blade.emissive.setHex(0x1a8cff);
  rig.blade.emissiveIntensity = 0.6;
  if (!telegraphGeo) {
    telegraphGeo = new THREE.RingGeometry(0.88, 1, 48);
    telegraphGeo.rotateX(-Math.PI / 2);
  }
  // The coil material belongs to the rig (and is disposed with it).
  const coilMat = rig.coilMat ?? new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x2fb8ff, emissiveIntensity: 1.5 });
  const coilTops = rig.coilTops;

  const telegraphMat = new THREE.MeshBasicMaterial({ color: 0x7fdcff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const telegraph = new THREE.Mesh(telegraphGeo!, telegraphMat);
  telegraph.position.y = 0.08;
  telegraph.visible = false;
  rig.root.add(telegraph);

  return {
    coilTops,
    coilMat,
    telegraph,
    telegraphMat,
    arcT: Math.random(),
    crackleT: 0,
    dispose() {
      telegraphMat.dispose();
    },
  };
}
