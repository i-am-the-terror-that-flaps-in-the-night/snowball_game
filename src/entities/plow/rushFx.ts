import * as THREE from 'three';
import type { SnowFieldAPI } from '../../core/types';
import type { Terrain } from '../../world/Terrain';
import { floorTop } from '../combat/shared';

/* The Classic Plow's SPACE kit visuals (world space, owned by the Plow): the PLOW RUSH telegraph (a ground line from the
 * blade to the landing point, a landing ring and a charge aura under the hull). It is
 * driven from plain numbers, so a Duel puppet replays them from its snapshot fields exactly like the host's plow. */

/** Telegraph strip segments (the line is draped over the floor / snow, one height sample per vertex pair). */
const SEG = 24;
const LINE_W = 0.55;
const LIFT = 0.12;

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

  hide(): void {
    this.line.visible = this.end.visible = this.aura.visible = false;
  }
}
