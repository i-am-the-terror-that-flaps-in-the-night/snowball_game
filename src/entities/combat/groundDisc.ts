import * as THREE from 'three';
import type { Terrain } from '../../world/Terrain';
import { WAVE_BAND, heightOk } from './shared';

/** Polar grid of a GroundDisc: rings x segments (plus the centre vertex). ~1.25 m between rings on a 10 m disc, fine
 *  enough for the smooth ground shapes (pits, domes, ridges are several metres wide). */
const RINGS = 8;
const SEGS = 32;

/**
 * A glowing disc laid on the floor where a persistent ground attack was cast (FIRESTORM burning ground, ISOTOPE
 * fallout pools). Its vertices are draped over the terrain once, when it is placed, so it neither floats over a pit
 * nor sinks into a rise. It stays on the floor of the cast level: past a deck's edge it overhangs flat at the deck's
 * height instead of hanging a curtain down to the ground (the attack does not reach down there either; see
 * combat/shared.ts waveHits). On flat arenas it is the old flat disc `lift` m above y = 0.
 */
export class GroundDisc {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.BufferGeometry;
  private readonly pos: THREE.BufferAttribute;

  constructor(scene: THREE.Scene, mat: THREE.Material) {
    const n = 1 + RINGS * SEGS;
    this.geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.pos);
    const idx: number[] = [];
    // Wound counter-clockwise seen from above (faces up, like the old rotated CircleGeometry).
    for (let s = 0; s < SEGS; s++) idx.push(0, 1 + s, 1 + ((s + 1) % SEGS));
    for (let r = 0; r < RINGS - 1; r++)
      for (let s = 0; s < SEGS; s++) {
        const a = 1 + r * SEGS + s;
        const b = 1 + r * SEGS + ((s + 1) % SEGS);
        const c = a + SEGS;
        const d = b + SEGS;
        idx.push(a, c, b, b, c, d);
      }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  /** Lay the disc (radius r) centred on (x, z) over the floor of the level at height `fromY` (the cast floor). */
  place(t: Terrain | undefined, x: number, z: number, r: number, fromY: number, fromDeck: number, lift: number): void {
    const p = this.pos.array as Float32Array;
    const on = !!t && t.active;
    this.mesh.position.set(x, 0, z);
    let i = 0;
    for (let v = 0; v <= RINGS * SEGS; v++) {
      const ring = v === 0 ? 0 : Math.floor((v - 1) / SEGS) + 1;
      const a = v === 0 ? 0 : (((v - 1) % SEGS) / SEGS) * Math.PI * 2;
      const rr = (ring / RINGS) * r;
      const lx = Math.sin(a) * rr;
      const lz = Math.cos(a) * rr;
      let y = 0;
      if (on) {
        y = t.heightAt(x + lx, z + lz, fromY);
        // Off the cast level (past a deck edge, down to the ground or a lower deck): stay flat at the cast floor.
        if (fromDeck >= 0 && t.heightDeck !== fromDeck && !heightOk(fromY, y, WAVE_BAND)) y = fromY;
      }
      p[i++] = lx;
      p[i++] = y + lift;
      p[i++] = lz;
    }
    this.pos.needsUpdate = true;
    this.geo.computeBoundingSphere();
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }
}
