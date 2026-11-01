import { makeSurface } from '../Terrain';
/**
 * Bot routing between levels (The Omega Works). Compute-light: a few dozen hand-placed nodes, all-pairs shortest
 * paths solved once at load (Floyd-Warshall), then each query is a table lookup.
 *
 * Model:
 *   - A REGION is a walkable area you can steer across in a straight line: the ground (-1), a deck, a bridge. Decks map
 *     to regions through `regionOfDeck`; unknown decks (pistons, pillar tops) count as ground.
 *   - Nodes in the same region are implicitly connected (cost = straight distance).
 *   - Explicit directed edges link regions: bridge ends, one-way drops off edges.
 *   - RAMPS are transit regions: their bottom and top nodes are joined both ways; a bot standing on a ramp heads for
 *     whichever end is cheaper toward its goal.
 *
 * `next(...)` answers: "I'm here (on this deck), my target is there (on that deck): where do I steer?" It returns
 * false when both are in the same region (steer straight at the target, as bots always have).
 */

export interface NavNodeDef {
  x: number;
  z: number;
  region: number;
}

export interface NavDef {
  regionOfDeck: Record<number, number>;
  nodes: Record<string, NavNodeDef>;
  ramps: { deck: number; bottom: string; top: string }[];
  /** Extra directed edges [from, to] (bridges both ways = two entries; drops one way). */
  edges: [string, string][];
}

/** How close (m) to a node counts as "reached" (then steer for the next one). */
export const NODE_REACHED = 3;

export class NavGraph {
  readonly names: string[];
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly region: Int32Array;
  /** dist[i * n + j] = shortest path cost i -> j (Infinity if unreachable). */
  private readonly dist: Float32Array;
  /** nextHop[i * n + j] = the node after i on the shortest path to j (-1 if none). */
  private readonly nextHop: Int32Array;
  private readonly rampOfDeck = new Map<number, { bottom: number; top: number }>();
  private readonly regionOfDeck: Record<number, number>;
  /** Ramp links (a * n + b): a bot must really reach a ramp end before heading for the other end. */
  private readonly strict = new Set<number>();
  readonly n: number;

  constructor(def: NavDef) {
    this.names = Object.keys(def.nodes);
    const n = (this.n = this.names.length);
    const idx = new Map(this.names.map((k, i) => [k, i]));
    this.x = new Float32Array(n);
    this.z = new Float32Array(n);
    this.region = new Int32Array(n);
    this.names.forEach((k, i) => {
      const d = def.nodes[k];
      this.x[i] = d.x;
      this.z[i] = d.z;
      this.region[i] = d.region;
    });
    this.regionOfDeck = def.regionOfDeck;

    const dist = (this.dist = new Float32Array(n * n).fill(Infinity));
    const hop = (this.nextHop = new Int32Array(n * n).fill(-1));
    const link = (a: number, b: number): void => {
      const c = Math.hypot(this.x[a] - this.x[b], this.z[a] - this.z[b]);
      if (c < dist[a * n + b]) {
        dist[a * n + b] = c;
        hop[a * n + b] = b;
      }
    };
    for (let i = 0; i < n; i++) {
      dist[i * n + i] = 0;
      hop[i * n + i] = i;
      for (let j = 0; j < n; j++) if (i !== j && this.region[i] === this.region[j]) link(i, j);
    }
    const id = (k: string): number => {
      const i = idx.get(k);
      if (i === undefined) throw new Error(`nav: unknown node ${k}`);
      return i;
    };
    for (const r of def.ramps) {
      const b = id(r.bottom);
      const t = id(r.top);
      link(b, t);
      link(t, b);
      this.strict.add(b * n + t);
      this.strict.add(t * n + b);
      this.rampOfDeck.set(r.deck, { bottom: b, top: t });
    }
    for (const [a, b] of def.edges) link(id(a), id(b));

    // Floyd-Warshall
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n; i++) {
        const ik = dist[i * n + k];
        if (ik === Infinity) continue;
        for (let j = 0; j < n; j++) {
          const c = ik + dist[k * n + j];
          if (c < dist[i * n + j]) {
            dist[i * n + j] = c;
            hop[i * n + j] = hop[i * n + k];
          }
        }
      }
    }
  }

  /** Region of a deck id (-1 = ground; unknown decks = ground; ramps return NaN = transit). */
  regionOf(deck: number): number {
    if (deck < 0) return -1;
    if (this.rampOfDeck.has(deck)) return NaN;
    return this.regionOfDeck[deck] ?? -1;
  }

  /** Shortest path cost between two nodes. */
  cost(a: number, b: number): number {
    return this.dist[a * this.n + b];
  }

  /**
   * Where should a bot at (x, z) standing on `deck` steer to reach a target at (tx, tz) on `tdeck`? Writes the waypoint
   * into `out` and returns true, or returns false = same region, steer straight at the target.
   */
  next(x: number, z: number, deck: number, tx: number, tz: number, tdeck: number, out: { x: number; z: number }): boolean {
    const goalRegion = this.regionOf(tdeck);
    const ramp = this.rampOfDeck.get(deck);
    const myRegion = this.regionOf(deck);
    if (!ramp && myRegion === goalRegion) return false;
    // Target on a ramp: aim for whichever end of it is closer to reach.
    const goals = Number.isNaN(goalRegion) ? this.rampEnds(tdeck) : this.nodesIn(goalRegion);
    if (!goals.length) return false;

    let best = -1;
    let bestCost = Infinity;
    const consider = (start: number, lead: number): void => {
      for (const g of goals) {
        const c = lead + this.cost(start, g) + Math.hypot(this.x[g] - tx, this.z[g] - tz);
        if (c < bestCost) {
          bestCost = c;
          best = start;
        }
      }
    };
    if (ramp) {
      // On a ramp: pick the end that leads to the goal more cheaply, steer to it.
      consider(ramp.bottom, Math.hypot(this.x[ramp.bottom] - x, this.z[ramp.bottom] - z));
      consider(ramp.top, Math.hypot(this.x[ramp.top] - x, this.z[ramp.top] - z));
      if (best < 0) return false;
      // Already at that end and the goal is in the region it opens onto: steer straight.
      if (this.region[best] === goalRegion && Math.hypot(this.x[best] - x, this.z[best] - z) < NODE_REACHED) return false;
      out.x = this.x[best];
      out.z = this.z[best];
      return true;
    }

    // In a region: route from each node of my region; steer to the first node along the best route that is not yet
    // reached (so bots walk node -> node across region borders).
    const starts = this.nodesIn(myRegion);
    let bestGoal = -1;
    for (const s of starts) {
      const lead = Math.hypot(this.x[s] - x, this.z[s] - z);
      for (const g of goals) {
        const c = lead + this.cost(s, g) + Math.hypot(this.x[g] - tx, this.z[g] - tz);
        if (c < bestCost) {
          bestCost = c;
          best = s;
          bestGoal = g;
        }
      }
    }
    if (best < 0 || bestCost === Infinity) return false;
    let node = best;
    // Skip nodes we're standing on (reached) and nodes still inside my region past the first (straight line works).
    for (let guard = 0; guard < this.n; guard++) {
      const nxt = node === bestGoal ? -1 : this.nextHop[node * this.n + bestGoal];
      // Reached it, or already past it (closer to the following node than it is): move on. The "past" test stops
      // bots dithering on the NODE_REACHED boundary.
      const reached =
        Math.hypot(this.x[node] - x, this.z[node] - z) < NODE_REACHED ||
        (nxt >= 0 &&
          !this.strict.has(node * this.n + nxt) && // a ramp end must really be reached (it is a level change)
          Math.hypot(this.x[nxt] - x, this.z[nxt] - z) < Math.hypot(this.x[nxt] - this.x[node], this.z[nxt] - this.z[node]));
      if (!reached) break;
      if (nxt < 0) return false;
      node = nxt;
    }
    out.x = this.x[node];
    out.z = this.z[node];
    return true;
  }

  private nodesIn(region: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.n; i++) if (this.region[i] === region) out.push(i);
    return out;
  }

  private rampEnds(deck: number): number[] {
    const r = this.rampOfDeck.get(deck);
    return r ? [r.bottom, r.top] : [];
  }
}

/** Minimal terrain surface the detour needs (world/Terrain.ts satisfies it). */
export interface DetourTerrain {
  surfaceAt(x: number, z: number, y?: number, out?: import('../Terrain').Surface): import('../Terrain').Surface;
  wallAt(x: number, z: number, y: number, height: number, r: number): import('../Terrain').Deck | null;
}

const DETOUR_LOOK = 16;
/** 1 m probes that track height like a driving plow (so a ramp ahead is not mistaken for a wall). */
const DETOUR_STEP = 1;
const _probe = makeSurface();

/**
 * Steer around a deck that walls off the straight line to (tx, tz): if one blocks the next DETOUR_LOOK metres, aim
 * for the corner of its footprint (inflated by r + 1) that gives the shortest way round, preferring a corner you can
 * see. Writes the aim point into `out` and returns true, or returns false (the way is clear). Cheap: a dozen wall
 * probes, only while something is in the way.
 */
export function detour(t: DetourTerrain, x: number, z: number, y: number, height: number, r: number, tx: number, tz: number, out: { x: number; z: number }): boolean {
  const dx = tx - x;
  const dz = tz - z;
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return false;
  const ux = dx / len;
  const uz = dz / len;
  const look = Math.min(len, DETOUR_LOOK);
  let wall = null;
  let py = y;
  for (let s = DETOUR_STEP; s <= look; s += DETOUR_STEP) {
    const px = x + ux * s;
    const pz = z + uz * s;
    wall = t.wallAt(px, pz, py, height, r);
    if (wall) break;
    py = t.surfaceAt(px, pz, py, _probe).y;
  }
  if (!wall) return false;
  const c = Math.cos(wall.rot);
  const sn = Math.sin(wall.rot);
  const m = r + 1;
  // Only corners that bring us closer to the goal (otherwise two corners on one side swap places as we move and the
  // bot dithers); fall back to the cheapest corner if none does.
  const here = Math.hypot(tx - x, tz - z);
  let best = Infinity;
  let fallback = Infinity;
  let fx = 0;
  let fz = 0;
  for (const [ax, az] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const lx = ax * (wall.hw + m);
    const lz = az * (wall.hd + m);
    const cx = wall.x + lx * c + lz * sn;
    const cz = wall.z - lx * sn + lz * c;
    const toCorner = Math.hypot(cx - x, cz - z);
    if (toCorner < 1) continue; // standing on it: let the next corner take over
    // Corner hidden behind the same deck? (probe the midpoint of the leg)
    const hidden = t.wallAt((x + cx) / 2, (z + cz) / 2, y, height, r) === wall;
    const left = Math.hypot(tx - cx, tz - cz);
    const cost = toCorner + left + (hidden ? 1000 : 0);
    if (cost < fallback) {
      fallback = cost;
      fx = cx;
      fz = cz;
    }
    if (left < here && cost < best) {
      best = cost;
      out.x = cx;
      out.z = cz;
    }
  }
  if (best === Infinity && fallback < Infinity) {
    out.x = fx;
    out.z = fz;
    return true;
  }
  return best < Infinity;
}
