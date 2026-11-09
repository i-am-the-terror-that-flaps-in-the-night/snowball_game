import * as THREE from 'three';
import { makeSurface } from '../../world/Terrain';

/* Module-level scratch objects of entities/Plow.ts, shared by every layer of the Plow class exactly as they were
 * shared by its methods before the split (e.g. update() leaves _fwd set for the collision passes it calls). */

export const _fwd = new THREE.Vector3();
export const _right = new THREE.Vector3();
export const _a = new THREE.Vector3();
export const _b = new THREE.Vector3();
export const _c = new THREE.Vector3();
export const _dir = new THREE.Vector3();
export const _q = new THREE.Quaternion();
export const _m = new THREE.Matrix4();
export const _s = new THREE.Vector3();
export const _col = new THREE.Color();
export const _e = new THREE.Euler();
export const _p = new THREE.Vector3();
export const _one = new THREE.Vector3(1, 1, 1);
export const _up = new THREE.Vector3(0, 1, 0);
export const _ballSurf = makeSurface();
