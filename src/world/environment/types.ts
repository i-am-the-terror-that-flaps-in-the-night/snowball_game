import * as THREE from 'three';
import type { ZoneDef } from '../../core/types';

export type Theme = ZoneDef['theme'];

export interface Item {
  x: number;
  y: number;
  z: number;
  ry: number;
  sx: number;
  sy: number;
  sz: number;
  rx?: number;
  rz?: number;
  color?: number;
}

export interface GateState {
  group: THREE.Group;
  /** Door instance matrix when fully closed; the roll-up scale.y is applied on top. */
  doorBase: THREE.Matrix4;
  doorScale: number;
  lightMat: THREE.MeshStandardMaterial;
  glowMat: THREE.SpriteMaterial;
  floorMat: THREE.MeshBasicMaterial;
  mouth: THREE.Vector3;
  open: number;
  openT: number;
  flashT: number;
  lastBurst: number;
  phase: number;
}

/** Materials shared by the three gates (created by the first one). */
export interface GateMats {
  trim?: THREE.MeshStandardMaterial;
  hazard?: THREE.MeshStandardMaterial;
  door?: THREE.MeshStandardMaterial;
  tunnel?: THREE.MeshStandardMaterial;
  back?: THREE.MeshBasicMaterial;
}

export interface Puff {
  x: number;
  y: number;
  z: number;
  r: number;
  rise?: number;
  drift?: number;
}

export interface Pulse {
  mat: THREE.Material;
  base: number;
  speed: number;
  phase: number;
}
