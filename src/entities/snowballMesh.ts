import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/* Shared snowball look (unit radius) — used by the plow's held ball and any bot that carries a ball. */

let sharedGeo: THREE.BufferGeometry | null = null;
let sharedMat: THREE.MeshStandardMaterial | null = null;
let sharedIceMat: THREE.MeshStandardMaterial | null = null;

function hashNoise(x: number, y: number, z: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/** Unit-radius slightly lumpy snowball (smooth shaded, vertex-colored white with faint blue). Shared — do not dispose. */
export function getSnowballGeometry(): THREE.BufferGeometry {
  if (sharedGeo) return sharedGeo;
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 3);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-4);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const n =
      Math.sin(v.x * 4.1 + v.y * 2.3) * 0.5 +
      Math.sin(v.y * 5.7 - v.z * 3.1) * 0.35 +
      (hashNoise(v.x, v.y, v.z) - 0.5) * 0.5;
    const s = 1 + n * 0.045;
    pos.setXYZ(i, v.x * s, v.y * s, v.z * s);
    const b = 0.5 + 0.5 * Math.sin(v.x * 3.3 + v.z * 2.7 + v.y * 1.3);
    colors[i * 3] = 0.93 - b * 0.07;
    colors[i * 3 + 1] = 0.96 - b * 0.03;
    colors[i * 3 + 2] = 1.0;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  sharedGeo = g;
  return g;
}

/** Shared snowball material. `ice` = glassy blue variant (frost / bot balls). Shared — do not mutate. */
export function getSnowballMaterial(ice = false): THREE.MeshStandardMaterial {
  if (!ice) {
    if (!sharedMat) {
      sharedMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.82,
        metalness: 0,
        emissive: 0x9cc6ff,
        emissiveIntensity: 0.1,
      });
    }
    return sharedMat;
  }
  if (!sharedIceMat) {
    sharedIceMat = new THREE.MeshStandardMaterial({
      color: 0xdff1ff,
      vertexColors: true,
      roughness: 0.5,
      metalness: 0.05,
      emissive: 0x6fb8ff,
      emissiveIntensity: 0.25,
    });
  }
  return sharedIceMat;
}
