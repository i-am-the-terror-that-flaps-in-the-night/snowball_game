import * as THREE from 'three';
import { bakeGeometry, relativeMatrix } from '../../render/mergeStatic';
import { STREAK_MAX, streakColor, streakDeep } from '../combat/classicStreak';

/* The Classic Plow's STREAK on the hull (owned by the Plow, driven from plain numbers each frame): AFTERIMAGES (ghost
 * copies of the hull silhouette left behind while it moves, more and brighter with the stacks, tinted by stack), an
 * edge outline round the hull and a ground underglow ring in the stack colour that pulse faster with the stacks.
 * Everything is normal-blended in solid colours with a deep outline shade, so it reads on sunlit snow and at night
 * alike (additive white would vanish on the snow). The combat side (stack pops, ON STREAK embers and arcs, the
 * finisher) lives in combat/classic.ts. */

/** Afterimage pool and the hull outline's inflation (scale about the silhouette's centre). */
const GHOSTS = 14;
const GHOST_EDGE = 1.09;
const HULL_EDGE = 1.055;
/** Per stack 1..4: metres travelled between afterimages (distinct copies, not a smear), their life (s) and peak fill /
 *  outline opacity. */
const GHOST_GAP = [3, 2.6, 2.2, 1.8] as const;
const GHOST_LIFE = [0.32, 0.38, 0.45, 0.55] as const;
const GHOST_FILL = [0.24, 0.28, 0.32, 0.36] as const;
const GHOST_RIM = [0.7, 0.8, 0.9, 1] as const;
/** Seconds an afterimage takes to fade in (the newest one sits on the hull: it must not paint over it). */
const GHOST_IN = 0.08;
/** Afterimages only spawn above this ground speed (m/s). */
const GHOST_SPEED = 3;
/** Hull outline / underglow pulse (Hz) at 1 stack, plus this much per stack. */
const PULSE_HZ = 1.4;
const PULSE_HZ_STACK = 1.5;

interface Ghost {
  root: THREE.Group;
  fill: THREE.Mesh;
  edge: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
  edgeMat: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  peak: number;
  rim: number;
  active: boolean;
}

/** One position-only indexed geometry of every shadow-proxy caster under `roots` (the merged low-poly hull the
 *  shadow pass draws: see render/shadowProxy.ts) plus the `extra` geometries (each with its matrix into `frame`), in
 *  `frame`'s space. */
export function hullSilhouette(roots: readonly THREE.Object3D[], frame: THREE.Object3D, extra: readonly { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[] = []): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  for (const r of roots) {
    r.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || (mesh.material as THREE.Material).name !== 'shadowProxy') return;
      parts.push(bakeGeometry(mesh.geometry, relativeMatrix(mesh, frame, m), ['position']));
    });
  }
  for (const e of extra) parts.push(bakeGeometry(e.geometry, e.matrix, ['position']));
  let nv = 0;
  let ni = 0;
  for (const p of parts) {
    nv += p.getAttribute('position').count;
    ni += p.index!.count;
  }
  const pos = new Float32Array(nv * 3);
  const idx = new Uint32Array(ni);
  let v = 0;
  let k = 0;
  for (const p of parts) {
    const a = p.getAttribute('position');
    for (let i = 0; i < a.count; i++) {
      pos[(v + i) * 3] = a.getX(i);
      pos[(v + i) * 3 + 1] = a.getY(i);
      pos[(v + i) * 3 + 2] = a.getZ(i);
    }
    const ix = p.index!;
    for (let i = 0; i < ix.count; i++) idx[k++] = ix.getX(i) + v;
    v += a.count;
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const solid = (side: THREE.Side) => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side, toneMapped: false });

export class StreakFx {
  private geo: THREE.BufferGeometry;
  private readonly center = new THREE.Vector3();
  private readonly ghosts: Ghost[] = [];
  /** Hull outline (child of the hull's frame: rides with it) and the ground underglow ring (world space). */
  private readonly hullEdge: THREE.Mesh;
  private readonly hullEdgeMat = solid(THREE.BackSide);
  private readonly glow: THREE.Mesh;
  private readonly glowMat = solid(THREE.DoubleSide);
  private readonly glowCore: THREE.Mesh;
  private readonly glowCoreMat = solid(THREE.DoubleSide);
  /** Where the last afterimage was left (NaN: none yet / start over). */
  private lastX = NaN;
  private lastZ = NaN;
  private phase = 0;
  private shown = 0;

  constructor(scene: THREE.Scene, private readonly frame: THREE.Object3D, geo: THREE.BufferGeometry) {
    this.geo = geo;
    for (let i = 0; i < GHOSTS; i++) {
      const fillMat = solid(THREE.FrontSide);
      const edgeMat = solid(THREE.BackSide);
      const root = new THREE.Group();
      const fill = new THREE.Mesh(geo, fillMat);
      const edge = new THREE.Mesh(geo, edgeMat);
      fill.renderOrder = 3;
      edge.renderOrder = 2;
      root.add(edge, fill);
      root.visible = false;
      scene.add(root);
      this.ghosts.push({ root, fill, edge, fillMat, edgeMat, age: 0, life: 1, peak: 0, rim: 0, active: false });
    }
    this.hullEdge = new THREE.Mesh(geo, this.hullEdgeMat);
    this.hullEdge.renderOrder = 2;
    this.hullEdge.visible = false;
    frame.add(this.hullEdge);
    const ringGeo = new THREE.RingGeometry(0.78, 1, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.glow = new THREE.Mesh(ringGeo, this.glowMat);
    this.glow.renderOrder = 2;
    this.glow.visible = false;
    scene.add(this.glow);
    const coreGeo = new THREE.RingGeometry(0.55, 0.7, 48);
    coreGeo.rotateX(-Math.PI / 2);
    this.glowCore = new THREE.Mesh(coreGeo, this.glowCoreMat);
    this.glowCore.renderOrder = 2;
    this.glowCore.visible = false;
    scene.add(this.glowCore);
    this.setSilhouette(geo);
  }

  /** Swap in a rebuilt hull silhouette (the blade width changed); the old one is disposed. */
  setSilhouette(geo: THREE.BufferGeometry): void {
    if (geo !== this.geo) this.geo.dispose();
    this.geo = geo;
    geo.boundingBox!.getCenter(this.center);
    for (const g of this.ghosts) {
      g.fill.geometry = geo;
      g.edge.geometry = geo;
      g.edge.position.copy(this.center).multiplyScalar(1 - GHOST_EDGE);
      g.edge.scale.setScalar(GHOST_EDGE);
    }
    this.hullEdge.geometry = geo;
    this.hullEdge.position.copy(this.center).multiplyScalar(1 - HULL_EDGE);
    this.hullEdge.scale.setScalar(HULL_EDGE);
  }

  /**
   * One frame: `stacks` 0..STREAK_MAX (0 = none: the ghosts already out fade on), `left` the share of the window left
   * (the glow dims as it runs out), `speed` the ground speed, (x, groundY, z) the hull on its floor: the underglow
   * sits there and the afterimages are spaced by the distance it travels.
   */
  update(dt: number, stacks: number, left: number, speed: number, x: number, groundY: number, z: number): void {
    for (const g of this.ghosts) {
      if (!g.active) continue;
      g.age += dt;
      const t = g.age / g.life;
      if (t >= 1) {
        g.active = false;
        g.root.visible = false;
        continue;
      }
      const f = (1 - t) * Math.min(1, g.age / GHOST_IN);
      g.fillMat.opacity = g.peak * f * Math.sqrt(1 - t);
      g.edgeMat.opacity = g.rim * f;
      const s = 1 + 0.06 * t;
      g.root.scale.set(s, s, s);
    }
    const k = Math.max(0, Math.min(STREAK_MAX, Math.round(stacks)));
    if (k <= 0) {
      if (this.shown > 0) this.hideHull();
      this.lastX = NaN;
      return;
    }
    this.shown = k;
    this.phase += dt * (PULSE_HZ + PULSE_HZ_STACK * k) * Math.PI * 2;
    const pulse = 0.5 + 0.5 * Math.sin(this.phase);
    const on = k >= STREAK_MAX;
    // Fading out as the window runs down (never below 35%), flickering hot ON STREAK.
    const life = 0.35 + 0.65 * Math.min(1, left * 1.6);
    const flick = on ? 0.85 + 0.15 * Math.random() : 1;
    this.hullEdge.visible = true;
    this.hullEdgeMat.color.setHex(streakColor(k));
    this.hullEdgeMat.opacity = (0.35 + 0.12 * k + 0.25 * pulse) * life * flick;
    this.glow.visible = this.glowCore.visible = true;
    this.glow.position.set(x, groundY + 0.1, z);
    this.glowCore.position.set(x, groundY + 0.1, z);
    const R = 2.9 + 0.25 * k + 0.25 * pulse;
    this.glow.scale.setScalar(R);
    this.glowCore.scale.setScalar(R);
    this.glowMat.color.setHex(streakDeep(k));
    this.glowMat.opacity = (0.45 + 0.08 * k + 0.2 * pulse) * life * flick;
    this.glowCoreMat.color.setHex(streakColor(k));
    this.glowCoreMat.opacity = (0.3 + 0.1 * k + 0.25 * pulse) * life * flick;
    if (Math.abs(speed) < GHOST_SPEED) return;
    if (Number.isNaN(this.lastX)) {
      this.lastX = x;
      this.lastZ = z;
    }
    if (Math.hypot(x - this.lastX, z - this.lastZ) < GHOST_GAP[k - 1]) return;
    this.lastX = x;
    this.lastZ = z;
    this.spawnGhost(k);
  }

  /** A ghost at the hull's current pose. */
  private spawnGhost(k: number): void {
    let g = this.ghosts[0];
    for (const x of this.ghosts) {
      if (!x.active) {
        g = x;
        break;
      }
      if (x.age / x.life > g.age / g.life) g = x;
    }
    this.frame.updateWorldMatrix(true, false);
    this.frame.matrixWorld.decompose(g.root.position, g.root.quaternion, g.root.scale);
    g.active = true;
    g.age = 0;
    g.life = GHOST_LIFE[k - 1];
    g.peak = GHOST_FILL[k - 1];
    g.rim = GHOST_RIM[k - 1];
    // ON STREAK: the afterimages flicker between hot red-orange and gold, like a flame trail.
    const hot = k >= STREAK_MAX && Math.random() < 0.35;
    g.fillMat.color.setHex(streakColor(hot ? k - 1 : k));
    g.edgeMat.color.setHex(streakDeep(k));
    g.fillMat.opacity = 0;
    g.edgeMat.opacity = 0;
    g.root.visible = true;
  }

  private hideHull(): void {
    this.shown = 0;
    this.hullEdge.visible = false;
    this.glow.visible = this.glowCore.visible = false;
  }

  /** Hide everything now (death, reset, out of the world). */
  hide(): void {
    this.hideHull();
    this.lastX = NaN;
    for (const g of this.ghosts) {
      g.active = false;
      g.root.visible = false;
    }
  }
}
