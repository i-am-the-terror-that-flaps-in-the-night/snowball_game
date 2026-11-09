import * as THREE from 'three';
import type { Deck } from '../../world/Terrain';

/** The deck with this id (a short scan; no allocation), or null. */
export function deckById(decks: readonly Deck[], id: number): Deck | null {
  for (let i = 0; i < decks.length; i++) if (decks[i].id === id) return decks[i];
  return null;
}

export interface Streak {
  x: number;
  y: number;
  z: number;
  h: number;
  len: number;
  age: number;
  active: boolean;
}

let tornadoTex: THREE.CanvasTexture | null = null;
/** Streaky white-on-black noise (additive => black is transparent). Wraps horizontally. */
export function getTornadoTexture(): THREE.CanvasTexture {
  if (tornadoTex) return tornadoTex;
  const W = 256;
  const H = 128;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const len = 30 + Math.random() * 110;
    const slope = (Math.random() - 0.3) * 0.25;
    g.strokeStyle = `rgba(255,255,255,${0.08 + Math.random() * 0.45})`;
    g.lineWidth = 1 + Math.random() * 4;
    for (const ox of [0, -W]) {
      g.beginPath();
      g.moveTo(x + ox, y);
      g.lineTo(x + ox + len, y + len * slope);
      g.stroke();
    }
  }
  // Soft puffs.
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const r = 6 + Math.random() * 16;
    for (const ox of [0, -W, W]) {
      const grd = g.createRadialGradient(x + ox, y, 0, x + ox, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.35)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(x + ox - r, y - r, r * 2, r * 2);
    }
  }
  tornadoTex = new THREE.CanvasTexture(cv);
  tornadoTex.wrapS = THREE.RepeatWrapping;
  tornadoTex.wrapT = THREE.RepeatWrapping;
  tornadoTex.colorSpace = THREE.SRGBColorSpace;
  return tornadoTex;
}

/** Open, flared tube (bottom r=0.55, top r=1, height 1, base at y=0) with twisted UVs and a vertical
 *  vertex-color fade so it dissolves at the top and bottom. */
export function makeTornadoGeometry(twist: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 0.55, 1, 40, 8, true);
  g.translate(0, 0.5, 0);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    uv.setX(i, uv.getX(i) + y * twist);
    const f = Math.min(1, y * 5) * (1 - y * 0.8);
    colors[i * 3] = f * 0.85;
    colors[i * 3 + 1] = f * 0.95;
    colors[i * 3 + 2] = f;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

export interface Ghost {
  group: THREE.Group;
  blade: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  active: boolean;
}

export interface Debris {
  obj: THREE.Object3D;
  parent: THREE.Object3D;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  rest: number;
  popped: boolean;
}
