import * as THREE from 'three';
import type { BrawlDifficulty } from '../core/types';
import type { RivalKind, RivalRig } from './models';

/* VOLT-9 rivals: some Brawl bots roll the electric starter plow. They get VOLT-9's stat multipliers
 * (src/config/plows.ts), an electric skin (blue paint, glowing blade, twin Tesla coils) and a bot Thunderclap —
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

const VOLT_PAINT = new THREE.Color(0x1f5fe0);
const VOLT_BLADE = new THREE.Color(0x9fe8ff);

/** Where the coils sit on each body (local y of the mounting surface, z along the body). */
const COIL_MOUNT: Record<RivalKind, { y: number; z: number; x: number }> = {
  pickup: { y: 0.77, z: -1.0, x: 0.45 },
  tractor: { y: 2.21, z: -0.7, x: 0.45 },
  monster: { y: 2.47, z: -0.2, x: 0.45 },
  dozer: { y: 2.22, z: -0.55, x: 0.38 },
  rally: { y: 1.2, z: -0.25, x: 0.4 },
  zamboni: { y: 1.8, z: -0.9, x: 0.5 },
};

let baseGeo: THREE.BufferGeometry | null = null;
let ringGeos: THREE.BufferGeometry[] | null = null;
let topGeo: THREE.BufferGeometry | null = null;
let telegraphGeo: THREE.BufferGeometry | null = null;
let baseMat: THREE.MeshStandardMaterial | null = null;

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

/** Repaint a rival rig in VOLT-9 colors and bolt on twin Tesla coils + a clap telegraph ring. */
export function attachVoltRig(rig: RivalRig, kind: RivalKind): VoltRig {
  // Keep a hint of the rival's identity color so two VOLT rivals still read apart.
  rig.paint.color.lerp(VOLT_PAINT, 0.7);
  rig.blade.color.copy(VOLT_BLADE);
  rig.blade.emissive.setHex(0x1a8cff);
  rig.blade.emissiveIntensity = 0.6;

  if (!baseGeo) {
    baseGeo = new THREE.CylinderGeometry(0.16, 0.22, 0.42, 10);
    baseGeo.translate(0, 0.21, 0);
    ringGeos = [0, 1, 2].map((i) => {
      const g = new THREE.TorusGeometry(0.14 - i * 0.02, 0.04, 6, 14);
      g.rotateX(Math.PI / 2);
      g.translate(0, 0.5 + i * 0.12, 0);
      return g;
    });
    topGeo = new THREE.SphereGeometry(0.17, 12, 8);
    telegraphGeo = new THREE.RingGeometry(0.88, 1, 48);
    telegraphGeo.rotateX(-Math.PI / 2);
    baseMat = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.4, metalness: 0.7, flatShading: true });
  }
  const coilMat = new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x2fb8ff, emissiveIntensity: 1.5, roughness: 0.3, metalness: 0.4 });
  const m = COIL_MOUNT[kind];
  const coilTops: THREE.Object3D[] = [];
  for (const sx of [m.x, -m.x]) {
    const coil = new THREE.Group();
    coil.position.set(sx, m.y, m.z);
    const base = new THREE.Mesh(baseGeo, baseMat!);
    base.castShadow = true;
    coil.add(base);
    for (const g of ringGeos!) coil.add(new THREE.Mesh(g, coilMat));
    const top = new THREE.Mesh(topGeo!, coilMat);
    top.position.y = 0.88;
    coil.add(top);
    coilTops.push(top);
    rig.body.add(coil);
  }

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
      coilMat.dispose();
      telegraphMat.dispose();
    },
  };
}
