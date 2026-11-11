import * as THREE from 'three';
import type { SnowFieldAPI } from '../../core/types';
import type { Terrain } from '../../world/Terrain';
import { floorTop } from '../combat/shared';
import { SWIPE_FX_SECONDS, SWIPE_HALF, SWIPE_RANGE } from '../combat/classicRush';

/* The Classic Plow's SPACE kit visuals (world space, owned by the Plow): the PLOW RUSH telegraph (a ground line from the
 * blade to the landing point, a landing ring and a charge aura under the hull) and the BLADE SWIPE's snow arc. Both
 * are driven from plain numbers, so a Duel puppet replays them from its snapshot fields exactly like the host's plow. */

/** Telegraph strip segments (the line is draped over the floor / snow, one height sample per vertex pair). */
const SEG = 24;
const LINE_W = 0.55;
const LIFT = 0.12;

const _f = new THREE.Vector3();

export class RushFx {
  private readonly lineGeo = new THREE.BufferGeometry();
  private readonly linePos = new Float32Array((SEG + 1) * 2 * 3);
  // Normal blending in saturated colours: additive white would vanish on the snow (the other pilot must read it).
  private readonly lineMat = new THREE.MeshBasicMaterial({ color: 0x2b9bff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  private readonly line: THREE.Mesh;
  private readonly endMat = new THREE.MeshBasicMaterial({ color: 0x1a7fff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  private readonly end: THREE.Mesh;
  private readonly auraMat = new THREE.MeshBasicMaterial({ color: 0x2b9bff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  private readonly aura: THREE.Mesh;
  /** Swipe: a faint full 100° sector and a bright wedge sweeping across it. */
  private readonly swipe = new THREE.Group();
  private readonly sectorMat = new THREE.MeshBasicMaterial({ color: 0x6fbfff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  private readonly wedgeMat = new THREE.MeshBasicMaterial({ color: 0xf4fbff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  private readonly wedge: THREE.Mesh;
  private swipeT = -1;
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.lineGeo.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3));
    const idx: number[] = [];
    for (let i = 0; i < SEG; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.lineGeo.setIndex(idx);
    this.line = new THREE.Mesh(this.lineGeo, this.lineMat);
    this.line.frustumCulled = false;
    this.line.renderOrder = 3;
    this.line.visible = false;
    scene.add(this.line);

    const endGeo = new THREE.RingGeometry(0.82, 1, 40);
    endGeo.rotateX(-Math.PI / 2);
    this.end = new THREE.Mesh(endGeo, this.endMat);
    this.end.renderOrder = 3;
    this.end.visible = false;
    scene.add(this.end);

    const auraGeo = new THREE.RingGeometry(2.2, 2.9, 40);
    auraGeo.rotateX(-Math.PI / 2);
    this.aura = new THREE.Mesh(auraGeo, this.auraMat);
    this.aura.renderOrder = 3;
    this.aura.visible = false;
    scene.add(this.aura);

    // Ring sectors lie in XY; laid flat (-90° about X) local -Y is the group's +Z (the plow's forward).
    const fwd = -Math.PI / 2;
    const sector = new THREE.Mesh(new THREE.RingGeometry(0.6, SWIPE_RANGE + 0.3, 20, 1, fwd - SWIPE_HALF, SWIPE_HALF * 2), this.sectorMat);
    sector.rotation.x = -Math.PI / 2;
    this.wedge = new THREE.Mesh(new THREE.RingGeometry(1.2, SWIPE_RANGE + 0.5, 8, 1, fwd - 0.2, 0.4), this.wedgeMat);
    this.wedge.rotation.order = 'YXZ';
    this.wedge.rotation.x = -Math.PI / 2;
    this.swipe.add(sector, this.wedge);
    this.swipe.visible = false;
    this.swipe.renderOrder = 3;
    scene.add(this.swipe);
  }

  /**
   * Telegraph for a rush being charged: `charge` 0..1 (< 0 hides it), the line from the blade tip (tx, tz) along the
   * heading for `dist` m, the landing ring sized `ringR`, the aura round the hull at (px, pz). Heights follow the floor
   * of the plow's level (feet `y`).
   */
  telegraph(dt: number, charge: number, dist: number, ringR: number, heading: number, px: number, pz: number, tx: number, tz: number, y: number, terrain: Terrain | undefined, snow: SnowFieldAPI | null | undefined): void {
    this.time += dt;
    if (charge < 0 || dist <= 0) {
      this.line.visible = this.end.visible = this.aura.visible = false;
      return;
    }
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const rx = fz * LINE_W * 0.5;
    const rz = -fx * LINE_W * 0.5;
    const p = this.linePos;
    for (let i = 0; i <= SEG; i++) {
      const k = (i / SEG) * dist;
      const x = tx + fx * k;
      const z = tz + fz * k;
      const h = floorTop(terrain, snow, y, x, z) + LIFT;
      const o = i * 6;
      p[o] = x - rx;
      p[o + 1] = h;
      p[o + 2] = z - rz;
      p[o + 3] = x + rx;
      p[o + 4] = h;
      p[o + 5] = z + rz;
    }
    (this.lineGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.lineGeo.computeBoundingSphere();
    const pulse = 0.5 + 0.5 * Math.sin(this.time * (8 + 10 * charge));
    this.line.visible = true;
    this.lineMat.opacity = 0.35 + 0.35 * charge + 0.15 * pulse;
    // Full charge: hazard yellow (the rush will go the whole 20 m / as far as the meter pays).
    const full = charge >= 1;
    this.lineMat.color.setHex(full ? 0xffc21a : 0x2b9bff);
    this.endMat.color.setHex(full ? 0xffb000 : 0x1a7fff);
    const ex = tx + fx * dist;
    const ez = tz + fz * dist;
    this.end.visible = true;
    this.end.position.set(ex, floorTop(terrain, snow, y, ex, ez) + LIFT, ez);
    this.end.scale.setScalar(Math.max(0.8, ringR) * (1 + 0.06 * pulse));
    this.endMat.opacity = 0.5 + 0.3 * charge + 0.2 * pulse;
    this.aura.visible = true;
    this.aura.position.set(px, floorTop(terrain, snow, y, px, pz) + LIFT, pz);
    this.aura.scale.setScalar(0.8 + 0.25 * charge + 0.04 * pulse);
    this.auraMat.opacity = 0.25 + 0.4 * charge * (0.6 + 0.4 * pulse);
    this.auraMat.color.setHex(full ? 0xffc21a : 0x2b9bff);
  }

  /** Start the swipe arc at the blade tip `tip` (y = floor there), facing `heading`. */
  startSwipe(tip: THREE.Vector3, heading: number): void {
    this.swipeT = 0;
    this.swipe.visible = true;
    this.swipe.position.copy(tip);
    this.swipe.position.y += 0.8; // blade height: it reads round the held ball
    this.swipe.rotation.set(0, heading, 0);
    this.updateSwipe(0);
  }

  /** Advance the swipe arc (sweeps left to right across the blade, then fades). */
  updateSwipe(dt: number): void {
    if (this.swipeT < 0) return;
    this.swipeT += dt;
    const total = SWIPE_FX_SECONDS + 0.14;
    if (this.swipeT >= total) {
      this.swipeT = -1;
      this.swipe.visible = false;
      return;
    }
    const k = Math.min(1, this.swipeT / SWIPE_FX_SECONDS);
    const fade = this.swipeT <= SWIPE_FX_SECONDS ? 1 : 1 - (this.swipeT - SWIPE_FX_SECONDS) / 0.14;
    // Wedge sweeps from the left edge (-half about Y) to the right edge (+half).
    this.wedge.rotation.y = -SWIPE_HALF + 2 * SWIPE_HALF * k;
    this.wedgeMat.opacity = 0.9 * fade;
    this.sectorMat.opacity = 0.4 * fade * Math.min(1, k * 2);
    const s = 0.75 + 0.25 * k;
    this.swipe.scale.set(s, 1, s);
  }

  /** World position of the swipe arc's wedge right now (spray follows it), or null when idle. */
  wedgePoint(out: THREE.Vector3): THREE.Vector3 | null {
    if (this.swipeT < 0) return null;
    const a = this.swipe.rotation.y + this.wedge.rotation.y;
    _f.set(Math.sin(a), 0, Math.cos(a)).multiplyScalar(SWIPE_RANGE * 0.75 * this.swipe.scale.x);
    return out.copy(this.swipe.position).add(_f);
  }

  hide(): void {
    this.line.visible = this.end.visible = this.aura.visible = false;
    this.swipeT = -1;
    this.swipe.visible = false;
  }
}
