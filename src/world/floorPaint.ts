import type { ZoneDef } from '../core/types';
import { ARENA } from '../core/types';
import { OMEGA_HATCHES } from './omega/layout';

/**
 * Floor markings painted on the bare ground under the snow, baked into SnowField's vertex colours (no extra draw,
 * works on the LOW Lambert path): plowing a trench reveals them, and `ghost` lets a share show through full snow.
 *
 *   - Golden Tower Plaza: downtown paving (4 m flagstones, grout lines) with a gold star-and-ring medallion at centre.
 *   - The Snowdome (classic): a sports floor: centre circle round the fountain, quadrant lines in four sponsor colours,
 *     dashed spawn ring.
 *   - The Omega Works: glowing cyan circuit guide lines on the ground floor between the floor hatches.
 *
 * `sample(x, z, out)` writes linear RGB (may exceed 1 for a glow) and coverage a (0..1) into out; a = 0 = plain ground.
 */
export interface FloorPaint {
  ghost: number;
  sample(x: number, z: number, out: Float32Array, o: number): void;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
/** Coverage of a line of half-width w at distance d, antialiased over `soft` m. */
const line = (d: number, w: number, soft: number) => 1 - smooth(w, w + soft, d);

/** sRGB hex -> linear rgb */
function lin(hex: number): [number, number, number] {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [c((hex >> 16) & 255), c((hex >> 8) & 255), c(hex & 255)];
}

function put(out: Float32Array, o: number, c: readonly number[], a: number): void {
  out[o] = c[0];
  out[o + 1] = c[1];
  out[o + 2] = c[2];
  out[o + 3] = a;
}

/** Distance from p to segment ab. */
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz;
  const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2)) : 0;
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

/** Signed-ish distance to a 5-point star outline of outer radius R (inner radius 0.4 R): <= 0 inside. */
function starInside(x: number, z: number, R: number): number {
  const a = Math.atan2(x, -z);
  const r = Math.hypot(x, z);
  const k = (Math.PI * 2) / 5;
  let t = ((a % k) + k) % k;
  t = Math.abs(t - k / 2) / (k / 2); // 1 at a point, 0 between points
  const edge = R * (0.42 + 0.58 * t * t);
  return r - edge;
}

function plazaPaint(): FloorPaint {
  const tileA = lin(0xc2b298);
  const tileB = lin(0xa89880);
  const grout = lin(0x6e6252);
  const gold = lin(0xe0b030);
  const navy = lin(0x1e3a8a);
  const T = 4;
  const c = [0, 0, 0];
  return {
    ghost: 0,
    sample(x, z, out, o) {
      const r = Math.hypot(x, z);
      if (r < 7.5) {
        // medallion: navy disc, gold ring, gold star
        const ring = line(Math.abs(r - 6.4), 0.45, 0.35);
        const star = 1 - smooth(-0.2, 0.25, starInside(x, z, 5));
        const g = Math.max(ring, star);
        for (let k = 0; k < 3; k++) c[k] = navy[k] + (gold[k] * 1.25 - navy[k]) * g;
        put(out, o, c, 1 - smooth(7.0, 7.5, r));
        if (r > 7.0) {
          // blend into the paving at the rim
          const w = smooth(7.0, 7.5, r);
          for (let k = 0; k < 3; k++) out[o + k] = c[k] * (1 - w) + grout[k] * w;
          out[o + 3] = 1;
        }
        return;
      }
      const ix = Math.floor(x / T);
      const iz = Math.floor(z / T);
      // running bond: every other row shifted half a tile
      const sx = x / T + (iz & 1 ? 0.5 : 0);
      const fx = sx - Math.floor(sx);
      const fz = z / T - iz;
      const dEdge = Math.min(fx, 1 - fx, fz, 1 - fz) * T;
      const g = line(dEdge, 0.12, 0.3);
      const base = (Math.floor(sx) + iz + ix * 0) & 1 ? tileA : tileB;
      for (let k = 0; k < 3; k++) c[k] = base[k] + (grout[k] - base[k]) * g;
      put(out, o, c, 1);
    },
  };
}

function domePaint(): FloorPaint {
  const half = ARENA.maxX;
  const k = half / 90;
  const white = lin(0xf4f6ff);
  // sponsor colours per quadrant (FROSTCOLA red, PLOWTECH blue, BRRR green, SLUSH BANK yellow)
  const quad = [lin(0xd7263d), lin(0x1b98e0), lin(0x5ac83a), lin(0xffc21a)];
  const rC = 16 * k;
  const rS = 70 * k;
  return {
    ghost: 0.45,
    sample(x, z, out, o) {
      const r = Math.hypot(x, z);
      // centre circle round the fountain plaza
      const circle = line(Math.abs(r - rC), 0.45, 0.8);
      if (circle > 0.01) return put(out, o, white, circle);
      // quadrant lines along the axes, from the centre circle out to the walls
      if (r > rC) {
        const dx = Math.abs(x);
        const dz = Math.abs(z);
        const ax = line(dz, 0.5, 0.8); // along x (z = 0)
        const az = line(dx, 0.5, 0.8); // along z (x = 0)
        if (ax > 0.01 || az > 0.01) {
          const q = az > ax ? (z < 0 ? 0 : 2) : (x < 0 ? 3 : 1);
          return put(out, o, quad[q], Math.max(ax, az));
        }
      }
      // dashed spawn ring
      const ring = line(Math.abs(r - rS), 0.45, 0.8);
      if (ring > 0.01) {
        const a = Math.atan2(z, x) * rS;
        const dash = (a / 4) - Math.floor(a / 4) < 0.55 ? 1 : 0;
        if (dash) {
          const q = (x < 0 ? 1 : 0) + (z < 0 ? 0 : 2);
          return put(out, o, quad[[0, 1, 3, 2][q]], ring);
        }
      }
      out[o + 3] = 0;
    },
  };
}

function omegaPaint(): FloorPaint {
  const ground = OMEGA_HATCHES.filter((h) => h.deck < 0);
  // circuit traces: a minimum spanning tree over the ground hatches, each edge routed as an L (x run, then z run)
  const segs: number[] = [];
  const inTree = [0];
  const left = ground.map((_, i) => i).slice(1);
  while (left.length) {
    let best = -1;
    let bi = 0;
    let bd = Infinity;
    for (const a of inTree) {
      for (let j = 0; j < left.length; j++) {
        const b = left[j];
        const d = Math.abs(ground[a].x - ground[b].x) + Math.abs(ground[a].z - ground[b].z);
        if (d < bd) {
          bd = d;
          best = a;
          bi = j;
        }
      }
    }
    const b = left.splice(bi, 1)[0];
    inTree.push(b);
    const A = ground[best];
    const B = ground[b];
    segs.push(A.x, A.z, B.x, A.z, B.x, A.z, B.x, B.z);
  }
  const cyan = [0.15 * 1.4, 0.85 * 1.4, 1.0 * 1.4];
  const mag = [1.0 * 1.3, 0.18 * 1.3, 0.8 * 1.3];
  return {
    ghost: 0.5,
    sample(x, z, out, o) {
      let d = Infinity;
      for (let i = 0; i < segs.length; i += 4) d = Math.min(d, segDist(x, z, segs[i], segs[i + 1], segs[i + 2], segs[i + 3]));
      let hd = Infinity;
      for (const h of ground) hd = Math.min(hd, Math.abs(Math.hypot(x - h.x, z - h.z) - 2.6));
      const ring = line(hd, 0.2, 0.7) * 0.8;
      if (ring > 0.01) return put(out, o, mag, ring);
      const a = line(d, 0.25, 0.65);
      if (a > 0.01) return put(out, o, cyan, a);
      out[o + 3] = 0;
    },
  };
}

/** Painted floor for this zone, or null. */
export function floorPaintFor(zone: ZoneDef): FloorPaint | null {
  if (zone.theme === 'rally') return plazaPaint();
  if (zone.theme === 'omega') return omegaPaint();
  if (zone.theme === 'brawl' && !zone.biome && zone.id !== 'duel') return domePaint();
  return null;
}
