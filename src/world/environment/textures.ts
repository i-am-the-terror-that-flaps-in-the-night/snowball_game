import * as THREE from 'three';
import { merge } from './layout';

/* ---------------------------------------------------------------- canvas textures */

export let glowTex: THREE.Texture | null = null;
export let hazardTex: THREE.Texture | null = null;
export let doorTex: THREE.Texture | null = null;
export let bannerTex: THREE.Texture | null = null;
export let chevronTex: THREE.Texture | null = null;

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

export function toTex(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export function radial(size: number, stops: [number, string][]): HTMLCanvasElement {
  const [c, g] = canvas(size, size);
  const h = size / 2;
  const grd = g.createRadialGradient(h, h, 0, h, h, h);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

export function getGlowTex(): THREE.Texture {
  return (glowTex ??= toTex(radial(128, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']])));
}

export function drawHazard(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, period: number): void {
  g.save();
  g.beginPath();
  g.rect(x0, y0, w, h);
  g.clip();
  g.fillStyle = '#f2c230';
  g.fillRect(x0, y0, w, h);
  g.fillStyle = '#1b1b1f';
  for (let x = x0 - h - period; x < x0 + w + period; x += period) {
    g.beginPath();
    g.moveTo(x, y0 + h);
    g.lineTo(x + period / 2, y0 + h);
    g.lineTo(x + period / 2 + h, y0);
    g.lineTo(x + h, y0);
    g.closePath();
    g.fill();
  }
  g.restore();
}

export function getHazardTex(): THREE.Texture {
  if (hazardTex) return hazardTex;
  const [c, g] = canvas(128, 32);
  drawHazard(g, 0, 0, 128, 32, 32);
  hazardTex = toTex(c, true);
  hazardTex.repeat.set(5, 1);
  return hazardTex;
}

export function getDoorTex(): THREE.Texture {
  if (doorTex) return doorTex;
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#ccd1d8';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 220; y += 27) {
    g.fillStyle = '#8b929c';
    g.fillRect(0, y, 256, 4);
    g.fillStyle = '#eceff3';
    g.fillRect(0, y + 4, 256, 2);
  }
  g.fillStyle = '#20252e';
  for (let i = 0; i < 4; i++) g.fillRect(18 + i * 60, 38, 44, 13);
  drawHazard(g, 0, 222, 256, 34, 34);
  doorTex = toTex(c);
  return doorTex;
}

export function getBannerTex(): THREE.Texture {
  if (bannerTex) return bannerTex;
  const [c, g] = canvas(128, 192);
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(128, 0);
  g.lineTo(128, 192);
  g.lineTo(64, 150);
  g.lineTo(0, 192);
  g.closePath();
  g.fillStyle = '#ffffff';
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#a6abb3';
  g.stroke();
  g.fillStyle = '#3a3f48';
  g.fillRect(0, 0, 128, 16);
  // snowflake emblem
  g.save();
  g.translate(64, 80);
  g.strokeStyle = '#3a3f48';
  g.lineCap = 'round';
  g.lineWidth = 9;
  for (let k = 0; k < 6; k++) {
    g.rotate(Math.PI / 3);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -34);
    g.moveTo(0, -20);
    g.lineTo(-10, -30);
    g.moveTo(0, -20);
    g.lineTo(10, -30);
    g.stroke();
  }
  g.restore();
  bannerTex = toTex(c);
  return bannerTex;
}

export function getChevronTex(): THREE.Texture {
  if (chevronTex) return chevronTex;
  const [c, g] = canvas(64, 64);
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 10;
  g.lineJoin = 'miter';
  g.beginPath();
  g.moveTo(8, 16);
  g.lineTo(32, 42);
  g.lineTo(56, 16);
  g.stroke();
  chevronTex = toTex(c, true);
  chevronTex.repeat.set(1, 3.5);
  return chevronTex;
}

export const hexCss = (hex: number) => '#' + hex.toString(16).padStart(6, '0');

/** A w x h flag plane with a baked ripple; hoist edge at x = 0, hanging below y = 0.4 + h / 2 ... centred on y = 0.4. */
export function wavyFlag(w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, 10, 1).translate(w / 2, 0.4, 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    p.setZ(i, Math.sin(x * 4.2) * 0.09 * (x / w));
    p.setY(i, p.getY(i) - (x / w) * 0.08);
  }
  g.computeVertexNormals();
  return g;
}

/** A tapering 4-leg lattice mast `h` tall, `w` wide at the base (merged, origin at the foot). */
export function latticeMast(h: number, w: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const half = (y: number) => (w / 2) * (1 - (0.65 * y) / h);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const b = new THREE.Vector3(sx * half(0), 0, sz * half(0));
    const t = new THREE.Vector3(sx * half(h), h, sz * half(h));
    const len = b.distanceTo(t);
    const g = new THREE.CylinderGeometry(0.09, 0.12, len, 4).translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), t.clone().sub(b).normalize()));
    parts.push(g.translate(b.x, b.y, b.z));
  }
  for (let y = 1.5; y < h; y += 2.4) {
    const k = half(y) * 2;
    parts.push(new THREE.BoxGeometry(k, 0.08, 0.08).translate(0, y, half(y)), new THREE.BoxGeometry(k, 0.08, 0.08).translate(0, y, -half(y)));
    parts.push(new THREE.BoxGeometry(0.08, 0.08, k).translate(half(y), y, 0), new THREE.BoxGeometry(0.08, 0.08, k).translate(-half(y), y, 0));
  }
  parts.push(new THREE.CylinderGeometry(0.06, 0.06, 4, 4).translate(0, h + 2, 0));
  return merge(parts);
}
