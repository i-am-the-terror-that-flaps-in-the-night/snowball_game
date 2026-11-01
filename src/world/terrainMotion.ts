/**
 * Shared vertical motion on the terrain for plows, bots and Brawl rivals (world/Terrain.ts via ctx.terrain).
 *
 * Model (compute-light: one surfaceAt per body per frame, no allocation):
 *   - GROUNDED: feet ride the surface (surface height + a small snow ride height). Vertical speed follows the surface
 *     (dy / dt), so a ramp gives you upward speed. Steps up (a deck change or a rise no slope gives in one frame: deck
 *     lips, curbs, a part-raised piston; also deck-change drops up to STEP_UP) snap the feet and keep the previous
 *     vertical speed, so they never launch. A deck hand-over (ramp top -> deck) caps the vertical speed at what the
 *     new surface gives along the motion, so cresting a ramp deck onto a flat deck never hops.
 *   - LAUNCH: each grounded frame we ask "where would a free ballistic body be next frame?". If that point is above the
 *     surface by more than AIR_GAP (a ramp lip or a crest taken faster than gravity can follow), the body is airborne.
 *     There is no jump button.
 *   - AIRBORNE: plain ballistic fall with the arena's gravity (ctx.terrain.gravity) until the feet meet the surface.
 *     Touchdown reports the downward speed as the impact.
 *   - Flights shorter than MIN_AIR are hops: silent (no launch / land events), so bumpy ground never spams.
 *
 * Flat arenas (Terrain.active false) take a fast path that never queries anything: feet = ride height, vy 0, exactly
 * what the game did before terrain existed. Launches (bot `launch`, air slam) still fly and land on flat ground.
 */
import { STEP_UP, type Surface, type Terrain } from './Terrain';

/** Seconds a flight must last before it counts as a jump (launch / land events, sounds, camera thump). */
export const MIN_AIR = 0.12;
/** Metres the ballistic path must clear the surface by to leave the ground (filters float noise and ride smoothing). */
export const AIR_GAP = 0.03;
/** Cap on the surface-following vertical speed (m/s). Steps (curbs, deck lips) snap instead of following (STEP_EPS). */
export const MAX_FOLLOW_VY = 9;
/** Rise (m) between two frames below which a deck change still counts as a smooth hand-over (ramp top -> deck). */
export const STEP_EPS = 0.02;
/** Slope pull: share of -g * gradient that acts along the slope (the rest is "rolling resistance" / tyre feel). */
export const SLOPE_PULL = 0.8;

/** Result codes of stepVertical. */
export const V_NONE = 0;
/** The body just left the ground (a flight starts; may still end as a hop). */
export const V_LEFT = 1;
/** The flight just passed MIN_AIR: it is a real jump (emit the launch event now). */
export const V_LAUNCHED = 2;
/** Touchdown after a real flight (impact / flight time in the state). */
export const V_LANDED = 3;
/** Touchdown after a hop (< MIN_AIR): silent. */
export const V_HOP = 4;

/** The per-body vertical state (Plow, Bot and Rival each carry these fields). */
export interface VertState {
  /** Feet height (m): surface + ride height while grounded. */
  y: number;
  vy: number;
  airborne: boolean;
  airTime: number;
  deck: number;
  surfaceY: number;
  /** Downward speed (m/s) at the last touchdown. */
  impact: number;
  /** Seconds of the last completed flight. */
  lastAir: number;
  /** (x, z) at the previous step (the motion over a frame gives a deck hand-over's surface speed). */
  px: number;
  pz: number;
}

export function makeVert(): VertState {
  return { y: 0, vy: 0, airborne: false, airTime: 0, deck: -1, surfaceY: 0, impact: 0, lastAir: 0, px: 0, pz: 0 };
}

/**
 * Advance one body's vertical motion by dt at (x, z). `ride` = snow ride height above the surface (m). `s` is the
 * caller's reusable Surface (filled with the surface under the body: material, gradient, deck). Returns a V_* code.
 */
export function stepVertical(t: Terrain, b: VertState, x: number, z: number, ride: number, dt: number, s: Surface): number {
  if (!t.active && !b.airborne) {
    // Flat arena: nothing to follow (ground at 0). Materials still come from patches (ice / lava without shapes).
    s.y = 0;
    s.gx = 0;
    s.gz = 0;
    s.nx = 0;
    s.ny = 1;
    s.nz = 0;
    s.deck = -1;
    s.material = t.patches.length ? t.materialAt(x, z) : t.baseMaterial;
    b.y = ride;
    b.vy = 0;
    b.deck = -1;
    b.surfaceY = 0;
    b.px = x;
    b.pz = z;
    return V_NONE;
  }
  if (dt <= 0) return V_NONE;
  const g = t.gravity;
  const prevSurf = b.surfaceY;
  const prevDeck = b.deck;
  const mx = x - b.px;
  const mz = z - b.pz;
  b.px = x;
  b.pz = z;
  if (t.active) t.surfaceAt(x, z, b.y, s);
  else flat(t, x, z, s);
  const target = s.y + ride;
  b.surfaceY = s.y;
  b.deck = s.deck;
  if (!b.airborne) {
    // A step (deck lip, curb, part-raised piston: a deck change of up to STEP_UP, or a rise no slope gives in one
    // frame) snaps the feet to it and keeps the vertical speed we had: following a step up as a slope would launch the
    // body off it, and falling down a curb would count as a jump. Bigger drops (deck edges) and ground lips still fly.
    const rise = s.y - prevSurf;
    if (s.deck !== prevDeck && rise >= -STEP_UP) {
      // Deck hand-over (a ramp's top onto a deck, a deck onto a ramp, a lip): never carry more upward speed onto the
      // new surface than it gives along this frame's motion. Climbing a ramp deck onto a flat deck would otherwise
      // keep the ramp's climb rate and hop off the crest. Real drops (deck edges) and ground kickers still launch.
      let sv = (s.gx * mx + s.gz * mz) / dt;
      if (sv > MAX_FOLLOW_VY) sv = MAX_FOLLOW_VY;
      else if (sv < -MAX_FOLLOW_VY) sv = -MAX_FOLLOW_VY;
      if (b.vy > sv) b.vy = sv;
    }
    if (s.deck !== prevDeck ? rise > STEP_EPS || (rise < -STEP_EPS && rise >= -STEP_UP) : rise > Math.max(STEP_EPS, MAX_FOLLOW_VY * dt)) {
      b.y = target;
      return V_NONE;
    }
    const ballistic = b.y + b.vy * dt - 0.5 * g * dt * dt;
    if (ballistic > target + AIR_GAP) {
      b.airborne = true;
      b.airTime = dt;
      b.vy -= g * dt;
      b.y = ballistic;
      return V_LEFT;
    }
    let vy = (target - b.y) / dt;
    if (vy > MAX_FOLLOW_VY) vy = MAX_FOLLOW_VY;
    else if (vy < -MAX_FOLLOW_VY) vy = -MAX_FOLLOW_VY;
    b.vy = vy;
    b.y = target;
    return V_NONE;
  }
  // Airborne: ballistic.
  const before = b.airTime;
  b.vy -= g * dt;
  b.y += b.vy * dt;
  b.airTime += dt;
  if (b.y <= target) {
    // Touch down moving with the surface (its vertical speed along this frame's motion), not at vy 0: landing on a
    // down-slope at vy 0 would leave the ground again next frame and bounce all the way down a ramp.
    let sv = (s.gx * mx + s.gz * mz) / dt;
    if (sv > MAX_FOLLOW_VY) sv = MAX_FOLLOW_VY;
    else if (sv < -MAX_FOLLOW_VY) sv = -MAX_FOLLOW_VY;
    b.impact = Math.max(0, sv - b.vy);
    b.lastAir = b.airTime;
    b.y = target;
    b.vy = sv;
    b.airborne = false;
    b.airTime = 0;
    return b.lastAir >= MIN_AIR ? V_LANDED : V_HOP;
  }
  return before < MIN_AIR && b.airTime >= MIN_AIR ? V_LAUNCHED : V_NONE;
}

/** Throw a body into the air with vertical speed vy (m/s). */
export function launchVert(b: VertState, vy: number): void {
  b.airborne = true;
  b.vy = vy;
  // A launch is always a real jump: skip the hop filter.
  b.airTime = Math.max(b.airTime, MIN_AIR);
}

/** Deck undersides: an airborne body moving up bonks its head (height h above the feet). Returns true on a bonk. */
export function bonkCeiling(t: Terrain, b: VertState, x: number, z: number, h: number): boolean {
  if (!b.airborne || b.vy <= 0 || t.decks.length === 0) return false;
  const c = t.ceilingAt(x, z, b.y + 0.05);
  if (b.y + h <= c) return false;
  b.y = Math.max(b.surfaceY, c - h);
  b.vy = 0;
  return true;
}

/**
 * Along-slope acceleration (m/s²) for a body heading along unit (fx, fz) on surface s: -g * (grad . f), scaled by
 * SLOPE_PULL and the slope's cosine. Positive = speeds you up (downhill).
 */
export function slopeAccel(t: Terrain, s: Surface, fx: number, fz: number): number {
  const along = s.gx * fx + s.gz * fz;
  if (along === 0) return 0;
  return (-t.gravity * SLOPE_PULL * along) / Math.sqrt(1 + s.gx * s.gx + s.gz * s.gz);
}

function flat(t: Terrain, x: number, z: number, s: Surface): void {
  s.y = 0;
  s.gx = 0;
  s.gz = 0;
  s.nx = 0;
  s.ny = 1;
  s.nz = 0;
  s.deck = -1;
  s.material = t.patches.length ? t.materialAt(x, z) : t.baseMaterial;
}

/* ------------------------------------------------------------------ hazards */

/** Lava burn rate (HP/s) for anyone touching it (plows, bots, rivals). */
export const LAVA_DPS = 8;
/** Ice: grip (1/s, how fast velocity swings to the heading), throttle / brake / coast multipliers. */
export const ICE_GRIP = 1.4;
export const ICE_ACCEL = 0.55;
export const ICE_BRAKE = 0.3;
export const ICE_DRAG = 0.25;
/** Steering while airborne (share of the ground turn rate). */
export const AIR_STEER = 0.3;

/** Cached lava patches of a terrain (rebuilt when the terrain's patch list changes; no allocation otherwise). */
export class LavaCache {
  private src: unknown = null;
  readonly list: { x: number; z: number; r: number; x2?: number; z2?: number }[] = [];

  sync(t: Terrain): boolean {
    if (t.patches !== this.src) {
      this.src = t.patches;
      this.list.length = 0;
      for (const p of t.patches) if (p.material === 'lava') this.list.push(p);
    }
    return this.list.length > 0;
  }

  /** Is (x, z) inside lava, with an extra margin (m)? */
  hit(x: number, z: number, margin = 0): boolean {
    return this.dist(x, z) <= margin;
  }

  /** Signed distance (m) from (x, z) to the nearest lava edge: negative inside lava, Infinity with no lava. */
  dist(x: number, z: number): number {
    const L = this.list;
    let best = Infinity;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      const d = Math.sqrt(axisDist2(p, x, z)) - p.r;
      if (d < best) best = d;
    }
    return best;
  }

  /**
   * Shortest way out of lava from (x, z): the heading towards the nearest edge of the patch it is in (the one whose
   * edge is closest, preferring an edge that is not inside another patch). `heading` (the body's own) picks the side
   * when it sits exactly on a patch's axis. NaN when (x, z) is not in lava.
   */
  exit(x: number, z: number, heading: number): number {
    const L = this.list;
    let best = NaN;
    let bestDepth = Infinity;
    let bestClear = false;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      const d2 = axisDist2(p, x, z);
      if (d2 > p.r * p.r) continue;
      const d = Math.sqrt(d2);
      const depth = p.r - d;
      let ux = _ax.dx;
      let uz = _ax.dz;
      if (d > 1e-4) {
        ux /= d;
        uz /= d;
      } else if (p.x2 !== undefined && p.z2 !== undefined) {
        // on a capsule's axis: straight across, on the side the body already faces
        const vx = p.x2 - p.x;
        const vz = p.z2 - p.z;
        const l = Math.hypot(vx, vz) || 1;
        const side = -vz * Math.sin(heading) + vx * Math.cos(heading) >= 0 ? 1 : -1;
        ux = (-vz / l) * side;
        uz = (vx / l) * side;
      } else {
        ux = Math.sin(heading);
        uz = Math.cos(heading);
      }
      // is the edge point just past this patch's rim clear of every other patch?
      const step = depth + 0.3;
      const clear = this.dist(x + ux * step, z + uz * step) > 0;
      if ((clear && !bestClear) || (clear === bestClear && depth < bestDepth)) {
        best = Math.atan2(ux, uz);
        bestDepth = depth;
        bestClear = clear;
      }
    }
    if (bestClear || best !== best) return best;
    // Every nearest rim lies inside another patch (overlapping pools): march 16 headings outwards and take the one
    // that leaves the lava soonest (rare: only where patches overlap).
    let bestT = Infinity;
    for (let i = 0; i < 16; i++) {
      const h = (i / 16) * Math.PI * 2;
      const sx = Math.sin(h);
      const sz = Math.cos(h);
      for (let t = 0.25; t < bestT && t <= 12; t += 0.25) {
        if (this.dist(x + sx * t, z + sz * t) > 0) {
          bestT = t;
          best = h > Math.PI ? h - Math.PI * 2 : h;
          break;
        }
      }
    }
    return best;
  }
}

/** Scratch for axisDist2 (offset from the patch's closest axis point). */
const _ax = { dx: 0, dz: 0 };

/** Squared distance from (x, z) to a circle's centre / a capsule's axis segment (offset left in _ax). */
function axisDist2(p: { x: number; z: number; x2?: number; z2?: number }, x: number, z: number): number {
  let dx: number;
  let dz: number;
  if (p.x2 === undefined || p.z2 === undefined) {
    dx = x - p.x;
    dz = z - p.z;
  } else {
    const vx = p.x2 - p.x;
    const vz = p.z2 - p.z;
    const l2 = vx * vx + vz * vz || 1;
    let u = ((x - p.x) * vx + (z - p.z) * vz) / l2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    dx = x - (p.x + vx * u);
    dz = z - (p.z + vz * u);
  }
  _ax.dx = dx;
  _ax.dz = dz;
  return dx * dx + dz * dz;
}

/** Metres between the sample points of a lava look-ahead (a body never skips a patch edge or cuts a corner). */
export const LAVA_PROBE_STEP = 0.75;

/**
 * Bot / rival lava avoidance: if heading `h` from (x, z) would come within `margin` of lava inside `look` metres,
 * return the nearest heading (±0.45 rad steps, up to ±1.8) that stays clear, preferring side `pref` (+1 / -1); h
 * unchanged when the way is clear or nothing is. A body already inside the margin may keep any heading that does not
 * take it closer (so it can skirt an edge it hugs). Inside lava: the shortest way out (LavaCache.exit).
 */
export function avoidLava(lava: LavaCache, x: number, z: number, h: number, look: number, margin: number, pref: number, bound = Infinity): number {
  const d0 = lava.dist(x, z);
  if (d0 <= 0) return lava.exit(x, z, h);
  if (d0 > look + margin) return h;
  if (!probe(lava, x, z, h, look, margin, d0, bound)) return h;
  for (let k = 1; k <= 4; k++) {
    const d = 0.45 * k;
    if (!probe(lava, x, z, h + d * pref, look, margin, d0, bound)) return h + d * pref;
    if (!probe(lava, x, z, h - d * pref, look, margin, d0, bound)) return h - d * pref;
  }
  return h;
}

/**
 * Is the current course about to run into lava? (Turning onto the avoidance heading takes time: callers ease off
 * while this is true.) Checks backwards when `speed` is negative. False when already in lava.
 */
export function lavaAhead(lava: LavaCache, x: number, z: number, heading: number, speed: number, look: number, margin: number, bound = Infinity): boolean {
  const d0 = lava.dist(x, z);
  if (d0 <= 0 || d0 > look + margin) return false;
  return probe(lava, x, z, speed < 0 ? heading + Math.PI : heading, speed < 0 ? look * 0.6 : look, margin, d0, bound);
}

/** steerLava results. */
export const LAVA_CLEAR = 0;
/** Lava ahead: heading swung clear and / or the speed eased off (to 0) while the body turns. */
export const LAVA_AVOID = 1;
/** In lava: heading / speed set to drive out the shortest way (forwards or backing out). */
export const LAVA_OUT = 2;

/** steerLava output: desired heading and speed. */
export interface LavaSteer {
  h: number;
  v: number;
}

/**
 * One tick of bot / rival lava steering (call when grounded and not knocked flying). From the body's position,
 * heading, speed and its AI's wish (desH, desV):
 *   - in lava: drive out by the shortest way (nearest edge), forwards when the edge is in front, backing out when it
 *     is behind (hysteresis on the current direction of travel), at least `cruise` m/s -> LAVA_OUT
 *   - lava ahead within `look`: swing desH clear (avoidLava, preferring the side the body is already turning to, else
 *     `pref`), and stop driving into it while the turn happens (speed eased to 0, never reversed into it) -> LAVA_AVOID
 *   - otherwise out = (desH, desV) -> LAVA_CLEAR.
 * `margin` = clearance kept from the edge by the chosen heading (the stop check uses 3/4 of it). `brake` = the
 * deceleration (m/s²) the caller applies when the speed is eased to 0: the stop check looks out to the stopping
 * distance, so a body going faster than its look-ahead (a Brawl rival gliding after a dash) still stops in time.
 * `bound` = how far from the arena centre (|x|, |z|) the body's centre can go (walls: ARENA half-size - radius).
 */
export function steerLava(
  lava: LavaCache, x: number, z: number, heading: number, speed: number, desH: number, desV: number,
  look: number, margin: number, pref: number, cruise: number, brake: number, bound: number, out: LavaSteer,
): number {
  out.h = desH;
  out.v = desV;
  const d0 = lava.dist(x, z);
  // the stop check looks at least as far as the body needs to stop (+1 m), however fast it is going
  const stopLook = Math.max(look, (speed * speed) / (2 * Math.max(brake, 1)) + 1);
  if (d0 <= 0) {
    const ex = lava.exit(x, z, heading);
    let off = (ex - heading) % (Math.PI * 2);
    if (off > Math.PI) off -= Math.PI * 2;
    else if (off < -Math.PI) off += Math.PI * 2;
    off = Math.abs(off);
    const lim = speed > 0.5 ? Math.PI / 2 + 0.3 : speed < -0.5 ? Math.PI / 2 - 0.3 : Math.PI / 2;
    if (off > lim) {
      out.h = ex + Math.PI;
      out.v = -cruise;
    } else {
      out.h = ex;
      out.v = off < 0.5 ? Math.max(cruise, desV) : cruise;
    }
    return LAVA_OUT;
  }
  if (d0 > stopLook + margin) return LAVA_CLEAR;
  let k = LAVA_CLEAR;
  // Prefer swinging to the side the body is already turned towards (no flip-flopping between sides tick to tick).
  let side = (heading - desH) % (Math.PI * 2);
  if (side > Math.PI) side -= Math.PI * 2;
  else if (side < -Math.PI) side += Math.PI * 2;
  const h = avoidLava(lava, x, z, desH, look, margin, Math.abs(side) > 0.05 ? (side > 0 ? 1 : -1) : pref, bound);
  if (h !== desH) {
    out.h = h;
    k = LAVA_AVOID;
  }
  // Stop check: the current course, and the course a fraction of a second into the turn towards out.h (a turn that
  // sweeps across the lava at speed would cut into it before the straight-ahead probe sees it).
  const m = margin * 0.75;
  let dh = (out.h - heading) % (Math.PI * 2);
  if (dh > Math.PI) dh -= Math.PI * 2;
  else if (dh < -Math.PI) dh += Math.PI * 2;
  const soon = heading + (dh > LAVA_TURN_AHEAD ? LAVA_TURN_AHEAD : dh < -LAVA_TURN_AHEAD ? -LAVA_TURN_AHEAD : dh);
  const back = speed < 0;
  const fast = Math.abs(speed) > LAVA_HOLD_SPEED;
  if (back ? desV < 0 || fast : desV > 0 || fast) {
    const rev = back ? Math.PI : 0;
    const L = back ? stopLook * 0.6 : stopLook;
    const ahead = probe(lava, x, z, heading + rev, L, m, d0, bound);
    const turning = !ahead && soon !== heading && probe(lava, x, z, soon + rev, L, m, d0, bound);
    if (ahead || turning) {
      if (back ? desV < 0 : desV > 0) out.v = 0;
      k = LAVA_AVOID;
      // A turn taken at speed across the lava carves into it before the brakes bite: hold the current (clear) course
      // while braking, and turn once slow.
      if (turning && fast) out.h = heading;
    }
  }
  return k;
}

/** Above this speed (m/s) a body whose coming turn would cut into lava holds its course while it brakes. */
const LAVA_HOLD_SPEED = 3;

/** Radians of the coming turn the stop check also looks along. */
const LAVA_TURN_AHEAD = 0.6;

/**
 * Does heading h from (x, z) come closer than min(margin, d0) to lava within `look` m? (d0 = lava.dist(x, z)) Sample
 * points are held inside ±bound (the arena walls the body's centre is clamped to), so sliding along a wall into a
 * river that runs up to it counts.
 */
function probe(lava: LavaCache, x: number, z: number, h: number, look: number, margin: number, d0: number, bound: number): boolean {
  const lim = Math.min(margin, d0) - 1e-3;
  const n = Math.max(2, Math.ceil(look / LAVA_PROBE_STEP));
  const sx = (Math.sin(h) * look) / n;
  const sz = (Math.cos(h) * look) / n;
  for (let i = 1; i <= n; i++) {
    let px = x + sx * i;
    let pz = z + sz * i;
    if (px > bound) px = bound;
    else if (px < -bound) px = -bound;
    if (pz > bound) pz = bound;
    else if (pz < -bound) pz = -bound;
    if (lava.dist(px, pz) < lim) return true;
  }
  return false;
}
