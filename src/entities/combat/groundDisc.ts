import * as THREE from 'three';
import type { Terrain } from '../../world/Terrain';
import { WAVE_BAND, heightOk } from './shared';

/** Polar grid of a GroundDisc: rings x segments (plus the centre vertex). ~1.25 m between rings on a 10 m disc, fine
 *  enough for the smooth ground shapes (pits, domes, ridges are several metres wide). */
const RINGS = 8;
const SEGS = 32;

/** Bisection steps that find where a spoke leaves the cast level (1.25 m ring gap / 2^5: within 4 cm of the edge). */
const EDGE_STEPS = 5;

/** What GroundDisc.place reads the leftover snow from (SnowField). */
export interface DiscSnow {
  getDepth(x: number, z: number): number;
}

/** Set by floorAt: the last sampled point is off the cast level (past a deck edge, down on the ground / a lower deck). */
let _off = false;

/** Snow depth at (x, z); 0 without a snow field (or a stub that returns no number). */
function depthAt(snow: DiscSnow | null | undefined, x: number, z: number): number {
  if (!snow) return 0;
  const d = snow.getDepth(x, z);
  return typeof d === 'number' && d > 0 ? d : 0;
}

/** Height of what the disc lies on at (x, z): the deck top on the cast deck, else the ground plus the snow left there
 *  (the melt falls off linearly, so without it the disc would hide under the rim snow). Sets _off. */
function floorAt(t: Terrain | undefined, on: boolean, snow: DiscSnow | null | undefined, x: number, z: number, fromY: number, fromDeck: number): number {
  _off = false;
  if (!on || !t) return depthAt(snow, x, z);
  const y = t.heightAt(x, z, fromY);
  if (fromDeck >= 0 && t.heightDeck !== fromDeck && !heightOk(fromY, y, WAVE_BAND)) _off = true;
  return t.heightDeck >= 0 ? y : y + depthAt(snow, x, z);
}

/**
 * A glowing disc laid on the floor where a persistent ground attack was cast (FIRESTORM burning ground, ISOTOPE
 * fallout pools). Its vertices are draped over the terrain (and the snow left on it) once, when it is placed, so it
 * neither floats over a pit nor sinks into a rise or under the snow. It stays on the floor of the cast level: each
 * spoke stops at the deck's edge (the outer vertices collapse onto the edge point, zero-area triangles) instead of
 * overhanging in mid-air or hanging a curtain down to the ground; the attack does not reach past there either (see
 * combat/shared.ts waveHits). On flat arenas it is the old flat disc `lift` m above the snow.
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

  /** Lay the disc (radius r) centred on (x, z) over the floor of the level at height `fromY` (the cast floor, deck
   *  `fromDeck`, -1 = the ground). Call it after the cast's melt so the disc sits on the snow that is left. */
  place(
    t: Terrain | undefined, x: number, z: number, r: number, fromY: number, fromDeck: number, lift: number, snow?: DiscSnow | null,
  ): void {
    const p = this.pos.array as Float32Array;
    const on = !!t && t.active;
    this.mesh.position.set(x, 0, z);
    const y0 = floorAt(t, on, snow, x, z, fromY, fromDeck);
    p[0] = 0;
    p[1] = y0 + lift;
    p[2] = 0;
    for (let s = 0; s < SEGS; s++) {
      const a = (s / SEGS) * Math.PI * 2;
      const sx = Math.sin(a);
      const sz = Math.cos(a);
      let prevR = 0;
      let prevY = y0;
      let clampR = -1;
      for (let ring = 1; ring <= RINGS; ring++) {
        let rr = (ring / RINGS) * r;
        let y = prevY;
        if (clampR < 0) {
          y = floorAt(t, on, snow, x + sx * rr, z + sz * rr, fromY, fromDeck);
          if (_off) {
            // Off the cast level between the previous ring and this one: bisect for the edge, then pin this vertex
            // and every outer one of the spoke there.
            let lo = prevR;
            let hi = rr;
            let loY = prevY;
            for (let k = 0; k < EDGE_STEPS; k++) {
              const mid = (lo + hi) * 0.5;
              const ym = floorAt(t, on, snow, x + sx * mid, z + sz * mid, fromY, fromDeck);
              if (_off) hi = mid;
              else {
                lo = mid;
                loY = ym;
              }
            }
            clampR = lo;
            prevY = loY;
          } else {
            prevR = rr;
            prevY = y;
          }
        }
        if (clampR >= 0) {
          rr = clampR;
          y = prevY;
        }
        const i = (1 + (ring - 1) * SEGS + s) * 3;
        p[i] = sx * rr;
        p[i + 1] = y + lift;
        p[i + 2] = sz * rr;
      }
    }
    this.pos.needsUpdate = true;
    this.geo.computeBoundingSphere();
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }
}
