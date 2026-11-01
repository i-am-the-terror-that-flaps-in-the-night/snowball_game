/**
 * Terrain: the shape of the ground and anything you can stand on.
 *
 * Two layers, both analytic (no per-frame grids, so it stays compute-light):
 *   1. GROUND: one height per (x, z), built from a few shapes (ramps, bowls, craters, ridges, trenches). Arenas 1-5,
 *      Brawl, Duel, Survival and Daily only use this layer. Snow depth sits on top of it.
 *   2. DECKS (The Omega Works): steel slabs on pillars with a footprint, a top surface (flat or sloped) and a
 *      thickness. They give bridges you can drive under, overhangs, multi-level platforms and pistons. Snow never
 *      lies on decks.
 *
 * Every entity that sits on the world (plows, bots, balls, coins, props, effects) asks `surfaceAt(x, z, y)` for the
 * highest walkable surface at or just below its current height; that is the only call most code needs. Movement
 * code also asks `wallAt` (deck sides you cannot climb) and `ceilingAt` (deck undersides you bonk on). Weapons that
 * fly in 3D use `raycast`.
 *
 * The default terrain is flat and empty, so code that adopts this API behaves exactly as before until an arena
 * defines shapes.
 */

/** Max height (m) a plow or bot drives up onto without it counting as a wall (curbs, deck lips, ramp toes). */
export const STEP_UP = 0.45;
/** Default gravity (m/s²) for airborne plows / bots / balls. Rust Basin scales it down. */
export const GRAVITY = 24;

export type GroundMaterial = 'snow' | 'ice' | 'lava' | 'steel' | 'rock';

/** A ground-height shape. Heights add up; `h` is the peak (positive) or depth (negative) in metres. */
export type TerrainShape =
  /** Wedge ramp: rises from 0 at the toe to `h` at the lip over `len` along heading `rot` (rad, 0 = +z), `w` wide.
   *  Drops back to 0 just past the lip (that sharp drop is what launches you). `fall` = metres of drop-off (default 1). */
  | { kind: 'ramp'; x: number; z: number; rot: number; len: number; w: number; h: number; fall?: number }
  /** Smooth round mound (h > 0) or bowl / crater (h < 0) of radius r. `rim` adds a raised lip (crater look). */
  | { kind: 'dome'; x: number; z: number; r: number; h: number; rim?: number }
  /** Long smooth ridge (h > 0) or trench (h < 0) from (x1,z1) to (x2,z2), `w` = half-width of the slope band. */
  | { kind: 'ridge'; x1: number; z1: number; x2: number; z2: number; w: number; h: number }
  /** Flat-topped mesa / plateau with sloped sides: radius r (top), `slope` = width of the side band. */
  | { kind: 'mesa'; x: number; z: number; r: number; h: number; slope: number };

/** A ground area with a gameplay material (ice is slippery, lava burns). Circle or capsule (x2/z2 set). */
export interface MaterialPatch {
  material: GroundMaterial;
  x: number;
  z: number;
  r: number;
  x2?: number;
  z2?: number;
}

/** A conveyor strip: pushes anything standing on it along (dx, dz) at `speed` m/s. Axis-aligned box. */
export interface Conveyor {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  dx: number;
  dz: number;
  speed: number;
  /** Deck id the strip sits on, or undefined for ground level. */
  deck?: number;
}

/**
 * A deck: an oriented box. Footprint centre (x, z), half-extents hw (local x) and hd (local z), rotated by `rot`.
 * The top surface is at `top` and may slope along local z: top at local z = -hd is `top`, at +hd is `top + rise`.
 * Underside = top surface - thickness. A deck whose underside is above a plow's head is a bridge; one whose
 * underside is at ground level is a solid block / platform.
 * `piston` decks bob: top += amp * (0.5 - 0.5 cos(2π (t / period + phase))).
 */
export interface Deck {
  id: number;
  x: number;
  z: number;
  hw: number;
  hd: number;
  rot: number;
  top: number;
  rise?: number;
  thickness: number;
  material?: GroundMaterial;
  piston?: { amp: number; period: number; phase: number };
}

/** What `surfaceAt` returns. Reuse one object per caller (no allocation per frame). */
export interface Surface {
  /** Height of the surface (m). */
  y: number;
  /** Unit surface normal. */
  nx: number;
  ny: number;
  nz: number;
  /** Downhill gradient of the surface (dy/dx, dy/dz): slope forces use -g * grad. */
  gx: number;
  gz: number;
  material: GroundMaterial;
  /** Deck id when standing on a deck, -1 on the ground. */
  deck: number;
}

export interface TerrainDef {
  shapes?: TerrainShape[];
  patches?: MaterialPatch[];
  decks?: Deck[];
  conveyors?: Conveyor[];
  /** Gravity multiplier (Rust Basin = 0.6). */
  gravityMult?: number;
  /** Ground material outside patches (default 'snow'). */
  baseMaterial?: GroundMaterial;
}

export interface RayHit {
  /** Distance along the ray (m). */
  t: number;
  x: number;
  y: number;
  z: number;
  /** 'ground' or the deck id. */
  what: 'ground' | number;
}

export function makeSurface(): Surface {
  return { y: 0, nx: 0, ny: 1, nz: 0, gx: 0, gz: 0, material: 'snow', deck: -1 };
}

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class Terrain {
  shapes: TerrainShape[] = [];
  patches: MaterialPatch[] = [];
  decks: Deck[] = [];
  conveyors: Conveyor[] = [];
  gravity = GRAVITY;
  baseMaterial: GroundMaterial = 'snow';
  /** Seconds since the arena loaded (drives pistons). Game advances it via update(dt). */
  time = 0;
  /** True when the arena has any shape or deck (lets hot paths skip all work on flat arenas). */
  active = false;

  constructor(def?: TerrainDef) {
    if (def) this.load(def);
  }

  load(def: TerrainDef): void {
    this.shapes = def.shapes ?? [];
    this.patches = def.patches ?? [];
    this.decks = def.decks ?? [];
    this.conveyors = def.conveyors ?? [];
    this.gravity = GRAVITY * (def.gravityMult ?? 1);
    this.baseMaterial = def.baseMaterial ?? 'snow';
    this.time = 0;
    this.active = this.shapes.length > 0 || this.decks.length > 0;
  }

  clear(): void {
    this.load({});
  }

  update(dt: number): void {
    this.time += dt;
  }

  /* ------------------------------------------------------------------ ground layer */

  /** Ground height (m) at (x, z), ignoring decks. */
  ground(x: number, z: number): number {
    let y = 0;
    for (let i = 0; i < this.shapes.length; i++) y += shapeHeight(this.shapes[i], x, z);
    return y;
  }

  /** Ground gradient by central differences (cheap enough: a handful of shapes). */
  groundGrad(x: number, z: number, out: { gx: number; gz: number }): void {
    if (!this.shapes.length) {
      out.gx = 0;
      out.gz = 0;
      return;
    }
    const e = 0.15;
    out.gx = (this.ground(x + e, z) - this.ground(x - e, z)) / (2 * e);
    out.gz = (this.ground(x, z + e) - this.ground(x, z - e)) / (2 * e);
  }

  /** Gameplay material of the ground at (x, z). */
  materialAt(x: number, z: number): GroundMaterial {
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const p = this.patches[i];
      if (patchDist(p, x, z) <= p.r) return p.material;
    }
    return this.baseMaterial;
  }

  /* ------------------------------------------------------------------ decks */

  /** Current top height of a deck at world (x, z) (assumed inside its footprint). */
  deckTop(d: Deck, x: number, z: number): number {
    let top = d.top;
    if (d.piston) top += d.piston.amp * (0.5 - 0.5 * Math.cos(2 * Math.PI * (this.time / d.piston.period + d.piston.phase)));
    if (d.rise) {
      const lz = localZ(d, x, z);
      top += d.rise * ((lz + d.hd) / (2 * d.hd));
    }
    return top;
  }

  /** Is (x, z) inside a deck's footprint, with an optional margin (m)? */
  inDeck(d: Deck, x: number, z: number, margin = 0): boolean {
    const dx = x - d.x;
    const dz = z - d.z;
    const c = Math.cos(d.rot);
    const s = Math.sin(d.rot);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    return Math.abs(lx) <= d.hw + margin && Math.abs(lz) <= d.hd + margin;
  }

  /* ------------------------------------------------------------------ queries */

  /**
   * The highest walkable surface at (x, z) whose height is at most `y + STEP_UP` (so you stay on a bridge when on it
   * and drive under it when below). `y` defaults to +Infinity (= topmost surface, for spawning / props / effects).
   */
  surfaceAt(x: number, z: number, y = Infinity, out: Surface = makeSurface()): Surface {
    const g = this.ground(x, z);
    let best = g;
    let deck = -1;
    let deckRef: Deck | null = null;
    for (let i = 0; i < this.decks.length; i++) {
      const d = this.decks[i];
      if (!this.inDeck(d, x, z)) continue;
      const top = this.deckTop(d, x, z);
      if (top <= y + STEP_UP && top > best) {
        best = top;
        deck = d.id;
        deckRef = d;
      }
    }
    out.y = best;
    out.deck = deck;
    if (deckRef) {
      out.material = deckRef.material ?? 'steel';
      if (deckRef.rise) {
        // Slope along the deck's local z axis, rotated back to world.
        const k = deckRef.rise / (2 * deckRef.hd);
        const c = Math.cos(deckRef.rot);
        const s = Math.sin(deckRef.rot);
        out.gx = k * -s;
        out.gz = k * c;
      } else {
        out.gx = 0;
        out.gz = 0;
      }
    } else {
      out.material = this.materialAt(x, z);
      this.groundGrad(x, z, out);
    }
    const inv = 1 / Math.sqrt(out.gx * out.gx + out.gz * out.gz + 1);
    out.nx = -out.gx * inv;
    out.ny = inv;
    out.nz = -out.gz * inv;
    return out;
  }

  /** Lowest deck underside above height `y` at (x, z), or +Infinity (jumping plows bonk on it). */
  ceilingAt(x: number, z: number, y: number): number {
    let c = Infinity;
    for (let i = 0; i < this.decks.length; i++) {
      const d = this.decks[i];
      if (!this.inDeck(d, x, z)) continue;
      const under = this.deckTop(d, x, z) - d.thickness;
      if (under > y && under < c) c = under;
    }
    return c;
  }

  /**
   * Deck sides an entity at height `y` (feet) and `height` tall cannot pass at (x, z) with radius r: the deck's top is
   * more than STEP_UP above its feet AND its underside is below its head. Returns the deck to push out of, or null.
   */
  wallAt(x: number, z: number, y: number, height: number, r: number): Deck | null {
    for (let i = 0; i < this.decks.length; i++) {
      const d = this.decks[i];
      if (!this.inDeck(d, x, z, r)) continue;
      const top = this.deckTop(d, x, z);
      const under = top - d.thickness;
      if (top > y + STEP_UP && under < y + height) return d;
    }
    return null;
  }

  /** Push (x, z) radius r out of a deck's footprint along the shortest axis. Writes into `out`. */
  pushOut(d: Deck, x: number, z: number, r: number, out: { x: number; z: number }): void {
    const c = Math.cos(d.rot);
    const s = Math.sin(d.rot);
    const dx = x - d.x;
    const dz = z - d.z;
    let lx = dx * c - dz * s;
    let lz = dx * s + dz * c;
    const px = d.hw + r - Math.abs(lx);
    const pz = d.hd + r - Math.abs(lz);
    if (px < pz) lx = Math.sign(lx || 1) * (d.hw + r);
    else lz = Math.sign(lz || 1) * (d.hd + r);
    out.x = d.x + lx * c + lz * s;
    out.z = d.z - lx * s + lz * c;
  }

  /** Conveyor push (m/s) at a point on the given deck (-1 = ground). Writes into `out`; zero when off-strip. */
  conveyorAt(x: number, z: number, deck: number, out: { x: number; z: number }): void {
    out.x = 0;
    out.z = 0;
    for (let i = 0; i < this.conveyors.length; i++) {
      const cv = this.conveyors[i];
      if ((cv.deck ?? -1) !== deck) continue;
      if (x < cv.minX || x > cv.maxX || z < cv.minZ || z > cv.maxZ) continue;
      out.x += cv.dx * cv.speed;
      out.z += cv.dz * cv.speed;
    }
  }

  /**
   * First hit of a ray (origin o, unit direction d, length maxT) against the ground and deck boxes. Ground is
   * marched in 0.5 m steps (shapes are smooth); decks use a slab test. Returns null on no hit.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, out?: RayHit): RayHit | null {
    let bestT = maxT;
    let what: 'ground' | number = 'ground';
    let hit = false;
    for (let i = 0; i < this.decks.length; i++) {
      const t = this.rayDeck(this.decks[i], ox, oy, oz, dx, dy, dz);
      if (t >= 0 && t < bestT) {
        bestT = t;
        what = this.decks[i].id;
        hit = true;
      }
    }
    // Ground march (only up to the nearest deck hit).
    const step = 0.5;
    let prevT = 0;
    let prevAbove = oy - this.ground(ox, oz);
    for (let t = step; t <= bestT; t += step) {
      const x = ox + dx * t;
      const y = oy + dy * t;
      const z = oz + dz * t;
      const above = y - this.ground(x, z);
      if (above < 0) {
        // Linear refine between the last two samples.
        const f = prevAbove / (prevAbove - above);
        bestT = prevT + (t - prevT) * f;
        what = 'ground';
        hit = true;
        break;
      }
      prevT = t;
      prevAbove = above;
    }
    if (!hit) return null;
    const r = out ?? { t: 0, x: 0, y: 0, z: 0, what: 'ground' as const };
    r.t = bestT;
    r.x = ox + dx * bestT;
    r.y = oy + dy * bestT;
    r.z = oz + dz * bestT;
    r.what = what;
    return r;
  }

  /** Clear line of sight between two points (true = nothing in between)? */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-3) return true;
    return this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 0.05) === null;
  }

  /** Ray vs an (oriented, possibly sloped -> treated as its bounding box) deck. Returns t or -1. */
  private rayDeck(d: Deck, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    const c = Math.cos(d.rot);
    const s = Math.sin(d.rot);
    const rx = ox - d.x;
    const rz = oz - d.z;
    const lox = rx * c - rz * s;
    const loz = rx * s + rz * c;
    const ldx = dx * c - dz * s;
    const ldz = dx * s + dz * c;
    const topMax = this.deckTop(d, d.x, d.z) + Math.abs(d.rise ?? 0) / 2;
    const yMin = topMax - (d.rise ? Math.abs(d.rise) : 0) - d.thickness;
    let t0 = -Infinity;
    let t1 = Infinity;
    const slab = (o: number, dir: number, lo: number, hi: number): boolean => {
      if (Math.abs(dir) < 1e-9) return o >= lo && o <= hi;
      let a = (lo - o) / dir;
      let b = (hi - o) / dir;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      return t0 <= t1;
    };
    if (!slab(lox, ldx, -d.hw, d.hw)) return -1;
    if (!slab(loz, ldz, -d.hd, d.hd)) return -1;
    if (!slab(oy, dy, yMin, topMax)) return -1;
    if (t1 < 0) return -1;
    return t0 >= 0 ? t0 : -1; // starting inside a deck: ignore it
  }
}

/* ------------------------------------------------------------------ shape math */

function localZ(d: Deck, x: number, z: number): number {
  const dx = x - d.x;
  const dz = z - d.z;
  return dx * Math.sin(d.rot) + dz * Math.cos(d.rot);
}

function patchDist(p: MaterialPatch, x: number, z: number): number {
  if (p.x2 === undefined || p.z2 === undefined) return Math.hypot(x - p.x, z - p.z);
  return segDist(x, z, p.x, p.z, p.x2, p.z2);
}

function segDist(x: number, z: number, x1: number, z1: number, x2: number, z2: number): number {
  const vx = x2 - x1;
  const vz = z2 - z1;
  const l2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((x - x1) * vx + (z - z1) * vz) / l2));
  return Math.hypot(x - (x1 + vx * t), z - (z1 + vz * t));
}

export function shapeHeight(s: TerrainShape, x: number, z: number): number {
  switch (s.kind) {
    case 'ramp': {
      const dx = x - s.x;
      const dz = z - s.z;
      // local frame: v along the ramp (0 at toe -> len at lip), u across
      const v = dx * Math.sin(s.rot) + dz * Math.cos(s.rot);
      const u = dx * Math.cos(s.rot) - dz * Math.sin(s.rot);
      const edge = 0.6; // soft side edges so wheels don't catch
      const across = 1 - smooth((Math.abs(u) - (s.w / 2 - edge)) / edge);
      if (across <= 0) return 0;
      const fall = s.fall ?? 1;
      let k: number;
      if (v < 0) k = 0;
      else if (v <= s.len) k = v / s.len;
      else if (v <= s.len + fall) k = 1 - (v - s.len) / fall;
      else k = 0;
      return s.h * k * across;
    }
    case 'dome': {
      const d = Math.hypot(x - s.x, z - s.z) / s.r;
      let y = d >= 1 ? 0 : s.h * (1 - smooth(d));
      if (s.rim) {
        const rd = (d - 1) / 0.35; // rim band just outside r
        y += s.rim * Math.max(0, 1 - rd * rd);
      }
      return y;
    }
    case 'ridge': {
      const d = segDist(x, z, s.x1, s.z1, s.x2, s.z2) / s.w;
      return d >= 1 ? 0 : s.h * (1 - smooth(d));
    }
    case 'mesa': {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d <= s.r) return s.h;
      return s.h * (1 - smooth((d - s.r) / s.slope));
    }
  }
}
