import { describe, expect, it } from 'vitest';
import { Terrain, makeSurface } from '../src/world/Terrain';
import {
  LAVA_AVOID, LAVA_CLEAR, LAVA_DPS, LAVA_OUT, LavaCache, MIN_AIR, V_HOP, V_LANDED, V_LAUNCHED, V_LEFT, avoidLava, bonkCeiling, launchVert,
  makeVert, slopeAccel, stepVertical, steerLava,
} from '../src/world/terrainMotion';
import { DEV_FEATURES, DEV_TERRAIN } from '../src/world/devTerrain';
import { OMEGA_TERRAIN } from '../src/world/omega/layout';

const DT = 1 / 60;

/** Drive a point body in a straight line at constant speed and return what happened. */
function drive(t: Terrain, x: number, z: number, vx: number, vz: number, seconds: number) {
  const b = makeVert();
  const s = makeSurface();
  b.y = t.surfaceAt(x, z, Infinity, s).y;
  let launched = 0;
  let landed = 0;
  let longest = 0;
  let impact = 0;
  for (let i = 0; i < seconds / DT; i++) {
    x += vx * DT;
    z += vz * DT;
    const c = stepVertical(t, b, x, z, 0, DT, s);
    if (c === V_LAUNCHED) launched++;
    if (c === V_LANDED) {
      landed++;
      longest = Math.max(longest, b.lastAir);
      impact = b.impact;
    }
  }
  return { b, launched, landed, longest, impact, x, z };
}

describe('terrain motion (vertical model)', () => {
  it('flat terrain: feet at the ride height, never airborne, nothing queried', () => {
    const t = new Terrain();
    const b = makeVert();
    const s = makeSurface();
    for (let i = 0; i < 120; i++) expect(stepVertical(t, b, i * 0.2, 0, 0.17, DT, s)).toBe(0);
    expect(b.y).toBe(0.17);
    expect(b.vy).toBe(0);
    expect(b.airborne).toBe(false);
  });

  it('a ramp lip at speed launches you for a real flight and lands you with an impact', () => {
    const t = new Terrain(DEV_TERRAIN);
    const r = DEV_FEATURES.ramp;
    const res = drive(t, r.x, r.toeZ + 4, 0, -12, 2.5);
    expect(res.launched).toBe(1);
    expect(res.landed).toBe(1);
    expect(res.longest).toBeGreaterThan(0.4);
    expect(res.impact).toBeGreaterThan(5);
    expect(res.b.airborne).toBe(false);
  });

  it('a slow roll over the lip is a short hop at most (no launch event)', () => {
    const t = new Terrain({ shapes: [{ kind: 'ramp', x: 0, z: 0, rot: 0, len: 8, w: 6, h: 0.6, fall: 3 }] });
    const res = drive(t, 0, -2, 0, 2, 8);
    expect(res.launched).toBe(0);
    expect(res.landed).toBe(0);
  });

  it('a sharp crest throws you at speed but not at a crawl', () => {
    const t = new Terrain(DEV_TERRAIN);
    const c = DEV_FEATURES.crest;
    expect(drive(t, 0, c.z + 8, 0, -14, 1.5).landed).toBeGreaterThanOrEqual(1);
    expect(drive(t, 0, c.z + 8, 0, -2, 8).landed).toBe(0);
  });

  it('launchVert flies on flat ground too and lands at the ride height', () => {
    const t = new Terrain();
    const b = makeVert();
    const s = makeSurface();
    launchVert(b, 10);
    let code = 0;
    let n = 0;
    while (code !== V_LANDED && n++ < 300) code = stepVertical(t, b, 0, 0, 0.1, DT, s);
    expect(code).toBe(V_LANDED);
    expect(n * DT).toBeCloseTo((2 * 10) / t.gravity, 1);
    expect(b.y).toBe(0.1);
    expect(b.airborne).toBe(false);
  });

  it('low gravity flies longer', () => {
    const lo = new Terrain({ gravityMult: 0.6 });
    const b = makeVert();
    const s = makeSurface();
    launchVert(b, 10);
    let n = 0;
    while (stepVertical(lo, b, 0, 0, 0, DT, s) !== V_LANDED && n < 400) n++;
    expect(n * DT).toBeGreaterThan(((2 * 10) / 24) * 1.5);
  });

  it('short flights are silent hops, and the launch event fires once the flight passes MIN_AIR', () => {
    const t = new Terrain({ shapes: [{ kind: 'dome', x: 0, z: 0, r: 30, h: 0.001 }] }); // active, ~flat
    const b = makeVert();
    const s = makeSurface();
    b.y = 0.06; // a few cm above the ground: falls off in ~0.07 s
    expect(stepVertical(t, b, 0, 0, 0, DT, s)).toBe(V_LEFT);
    let code = 0;
    for (let i = 0; i < 60 && code !== V_HOP && code !== V_LANDED; i++) code = stepVertical(t, b, 0, 0, 0, DT, s);
    expect(code).toBe(V_HOP);
    // a longer pop reports V_LAUNCHED once
    b.vy = 6;
    let launches = 0;
    for (let i = 0; i < 120; i++) if (stepVertical(t, b, 0, 0, 0, DT, s) === V_LAUNCHED) launches++;
    expect(launches).toBe(1);
    expect(MIN_AIR).toBeGreaterThan(0.05);
  });

  it('bonks on a deck underside when flying up into it', () => {
    const t = new Terrain({ decks: [{ id: 1, x: 0, z: 0, hw: 5, hd: 5, rot: 0, top: 4, thickness: 0.5 }] });
    const b = makeVert();
    launchVert(b, 12);
    b.y = 0.5;
    b.surfaceY = 0;
    expect(bonkCeiling(t, b, 0, 0, 3.4)).toBe(true);
    expect(b.vy).toBe(0);
    expect(b.y + 3.4).toBeLessThanOrEqual(3.5 + 1e-6);
  });

  it('a 0.3 m deck lip crossed at 6 m/s is a step, not a launch', () => {
    const t = new Terrain({ decks: [{ id: 1, x: 10, z: 0, hw: 4, hd: 4, rot: 0, top: 0.3, thickness: 0.3 }] });
    const b = makeVert();
    const s = makeSurface();
    let x = 0;
    let peak = 0;
    const codes = new Set<number>();
    for (let i = 0; i < 3 / DT; i++) {
      x += 6 * DT;
      codes.add(stepVertical(t, b, x, 0, 0, DT, s));
      peak = Math.max(peak, b.y);
      if (x > 6.5 && x < 13.5) expect(b.deck).toBe(1);
    }
    expect(x).toBeGreaterThan(15); // crossed: on and off again
    expect(codes.has(V_LAUNCHED)).toBe(false);
    expect(codes.has(V_LEFT)).toBe(false);
    expect(b.y).toBe(0);
    expect(peak).toBeLessThanOrEqual(0.35);
    expect(peak).toBeGreaterThanOrEqual(0.3);
  });

  it('every small lip (0.1-0.44 m) steps up without leaving the ground', () => {
    for (const h of [0.1, 0.2, 0.3, 0.44]) {
      const t = new Terrain({ decks: [{ id: 1, x: 10, z: 0, hw: 4, hd: 4, rot: 0, top: h, thickness: h }] });
      const b = makeVert();
      const s = makeSurface();
      for (let i = 0; i < 1.6 / DT; i++) {
        const c = stepVertical(t, b, (i + 1) * 8 * DT, 0, 0, DT, s);
        expect(c === V_LEFT || c === V_LAUNCHED || c === V_LANDED || c === V_HOP).toBe(false);
        expect(b.y).toBeLessThanOrEqual(h + 1e-9);
      }
    }
  });

  it('riding a rising piston follows it (upward speed) and stepping onto it mid-rise does not launch', () => {
    const t = new Terrain({ decks: [{ id: 2, x: 0, z: 0, hw: 3, hd: 3, rot: 0, top: 0, thickness: 6, piston: { amp: 5, period: 7, phase: 0 } }] });
    const b = makeVert();
    const s = makeSurface();
    let maxVy = 0;
    // Standing on it from the bottom of its stroke to the top.
    for (let i = 0; i < 3.5 / DT; i++) {
      t.update(DT);
      expect(stepVertical(t, b, 0, 0, 0, DT, s)).toBe(0);
      maxVy = Math.max(maxVy, b.vy);
    }
    expect(b.y).toBeCloseTo(5, 1);
    expect(maxVy).toBeGreaterThan(2);
    // Step onto it while it is part-raised (0.3 m) and still rising.
    t.time = 0.45; // top ~0.2 m, rising (~0.28 m when the body reaches it)
    const top = t.deckTop(t.decks[0], 0, 0);
    expect(top).toBeGreaterThan(0.15);
    expect(top).toBeLessThan(0.45);
    const c = makeVert();
    let x = -3.5;
    let launched = false;
    for (let i = 0; i < 0.6 / DT; i++) {
      t.update(DT);
      x += 6 * DT;
      const code = stepVertical(t, c, x, 0, 0, DT, s);
      if (code === V_LEFT || code === V_LAUNCHED) launched = true;
    }
    expect(c.deck).toBe(2);
    expect(launched).toBe(false);
  });

  it('slopes pull downhill and hold you back uphill', () => {
    const t = new Terrain(DEV_TERRAIN);
    const bw = DEV_FEATURES.bowl;
    const s = t.surfaceAt(bw.x + bw.r * 0.5, bw.z, Infinity, makeSurface());
    // heading -x (into the bowl centre) speeds up, +x (out) slows down
    expect(slopeAccel(t, s, -1, 0)).toBeGreaterThan(2);
    expect(slopeAccel(t, s, 1, 0)).toBeLessThan(-2);
    expect(slopeAccel(t, s, 0, 1)).toBeCloseTo(0, 0);
  });

  it('cresting a ramp deck onto a flat deck is a hand-over, not a hop (every Omega ramp, any lane, any speed)', () => {
    const t = new Terrain(OMEGA_TERRAIN);
    // [x, z, vx, vz, metres, deck to end on]: S / N / E / W ramps onto the Floor, the platform ramps, the tower ramp.
    const runs: [number, number, number, number, number, number][] = [
      [0, 46, 0, -1, 34, 1], [3.5, 46, 0, -1, 34, 1], [0, -46, 0, 1, 34, 1], [-3.5, -46, 0, 1, 34, 1],
      [46, 0, -1, 0, 34, 1], [46, 3, -1, 0, 34, 1], [-46, 0, 1, 0, 34, 1], [-46, -3, 1, 0, 34, 1],
      [52, -12, 0, -1, 34, 5], [-52, 12, 0, 1, 34, 6], [9, 16, 0, -1, 22, 3], [11, 16, 0, -1, 22, 3],
    ];
    for (const [x0, z0, dx, dz, len, deck] of runs) {
      for (const v of [5, 8.5, 12]) {
        const res = drive(t, x0, z0, dx * v, dz * v, len / v);
        expect({ x0, z0, v, launched: res.launched, landed: res.landed, deck: res.b.deck }).toEqual({ x0, z0, v, launched: 0, landed: 0, deck });
      }
    }
  });

  it('driving DOWN a ramp at speed lands with the slope, so it is at most one flight, not a bounce chain', () => {
    const t = new Terrain(OMEGA_TERRAIN);
    // From the Floor down ramps S / N / E / W to the ground; from the Tower down its ramp to the Floor.
    const runs: [number, number, number, number, number][] = [
      [0, 10, 0, 1, 40], [0, -10, 0, -1, 40], [10, 0, 1, 0, 40], [-10, 0, -1, 0, 40], [10, -4, 0, 1, 22],
    ];
    for (const [x0, z0, dx, dz, len] of runs) {
      for (const v of [6, 10, 13]) {
        const res = drive(t, x0, z0, dx * v, dz * v, len / v);
        expect({ x0, z0, v, launched: Math.min(res.launched, 1) }).toEqual({ x0, z0, v, launched: res.launched });
      }
    }
  });

  it('ground kickers and real deck edges still launch', () => {
    // The Omega kicker (ground shape: x -56, z -30 toe, heading +z, 1.8 m over 7 m) at speed.
    const t = new Terrain(OMEGA_TERRAIN);
    const k = drive(t, -56, -36, 0, 12, 2.2);
    expect(k.launched).toBe(1);
    expect(k.landed).toBe(1);
    expect(k.longest).toBeGreaterThan(0.3);
    // Off the Assembly Floor's west edge (7 m drop).
    const e = drive(t, -10, -8, -9, 0, 2.5);
    expect(e.launched).toBe(1);
    expect(e.landed).toBe(1);
    expect(e.impact).toBeGreaterThan(10);
    // A ramp deck that ends in the air (a deck kicker): the climb carries you off its top.
    const air = new Terrain({ decks: [{ id: 7, x: 0, z: 0, hw: 3, hd: 5, rot: 0, top: 0, rise: 2.5, thickness: 2.5 }] });
    const a = drive(air, 0, -8, 0, 12, 2);
    expect(a.launched).toBe(1);
    expect(a.landed).toBe(1);
    expect(a.longest).toBeGreaterThan(0.3);
  });
});

describe('terrain hazards', () => {
  it('lava cache finds capsules and circles', () => {
    const t = new Terrain(DEV_TERRAIN);
    const lava = new LavaCache();
    expect(lava.sync(t)).toBe(true);
    const l = DEV_FEATURES.lava;
    expect(lava.hit((l.x1 + l.x2) / 2, l.z)).toBe(true);
    expect(lava.hit(l.x1 - l.r - 0.1, l.z)).toBe(false);
    expect(lava.hit(l.x1 - l.r - 0.1, l.z, 0.5)).toBe(true);
    expect(LAVA_DPS).toBe(8);
    expect(new LavaCache().sync(new Terrain())).toBe(false);
  });

  it('bots steer around lava ahead', () => {
    const t = new Terrain(DEV_TERRAIN);
    const lava = new LavaCache();
    lava.sync(t);
    const l = DEV_FEATURES.lava;
    const mx = (l.x1 + l.x2) / 2;
    // standing 4 m south of the river, heading north (-z = heading PI) straight at it
    const h = avoidLava(lava, mx, l.z + 4, Math.PI, 4.5, 0.8, 1);
    expect(h).not.toBe(Math.PI);
    // the chosen heading's probes are clear
    const sx = Math.sin(h);
    const cz = Math.cos(h);
    expect(lava.hit(mx + sx * 4.5, l.z + 4 + cz * 4.5, 0.8)).toBe(false);
    expect(lava.hit(mx + sx * 2.25, l.z + 4 + cz * 2.25, 0.8)).toBe(false);
    // clear way: unchanged
    expect(avoidLava(lava, mx, l.z + 4, 0, 4.5, 0.8, 1)).toBe(0);
  });

  it('lava distance and the shortest way out', () => {
    const t = new Terrain(DEV_TERRAIN);
    const lava = new LavaCache();
    lava.sync(t);
    const l = DEV_FEATURES.lava;
    const mx = (l.x1 + l.x2) / 2;
    expect(lava.dist(mx, l.z)).toBeCloseTo(-l.r, 6);
    expect(lava.dist(mx, l.z + l.r + 1)).toBeCloseTo(1, 6);
    expect(lava.dist(l.x2 + l.r + 2, l.z)).toBeCloseTo(2, 6); // end cap
    expect(new LavaCache().dist(0, 0)).toBe(Infinity);
    // not in lava: NaN
    expect(lava.exit(mx, l.z + l.r + 0.1, 0)).toBeNaN();
    // just inside the south (+z) edge: out to the south (heading 0), whatever way it faces
    for (const face of [0, Math.PI, Math.PI / 2, -2]) expect(lava.exit(mx, l.z + l.r - 0.3, face)).toBeCloseTo(0, 6);
    // just inside the north edge: heading PI
    expect(Math.abs(lava.exit(mx + 2, l.z - l.r + 0.4, 0))).toBeCloseTo(Math.PI, 6);
    // in the east end cap: radially out of the cap (east-north-east here)
    const ex = lava.exit(l.x2 + 0.6, l.z - 0.6, 0);
    expect(ex).toBeCloseTo(Math.atan2(0.6, -0.6), 6);
    // dead on the axis: straight across, on the side it faces
    expect(lava.exit(mx, l.z, 0.3)).toBeCloseTo(0, 6);
    expect(Math.abs(lava.exit(mx, l.z, 2.8))).toBeCloseTo(Math.PI, 6);
    // avoidLava inside lava returns the way out too
    expect(avoidLava(lava, mx, l.z + l.r - 0.3, Math.PI, 4.5, 0.8, 1)).toBeCloseTo(0, 6);
  });

  it('two overlapping pools: the exit picks an edge that is not inside the other pool', () => {
    const t = new Terrain({ patches: [{ material: 'lava', x: 0, z: 0, r: 3 }, { material: 'lava', x: 0, z: 4, r: 3 }] });
    const lava = new LavaCache();
    lava.sync(t);
    // at (0, 1.5): pool A's nearest rim (+z, 1.5 m) lies inside pool B; B's nearest rim (-z) lies inside A. Both
    // blocked -> the shortest exit sideways out of either (distance ~2.6 m) must not be +z / -z straight through.
    const h = lava.exit(0.5, 1.2, 0);
    const px = 0.5 + Math.sin(h) * 4;
    const pz = 1.2 + Math.cos(h) * 4;
    expect(lava.hit(px, pz)).toBe(false);
  });

  /** Minimal bot integrator (the Enemies.ts model: turn at a rate, speed eases at accel / 1.5 accel when slowing). */
  function runBot(lava: LavaCache, o: { x: number; z: number; h: number; v: number; desH: (x: number, z: number) => number; desV: number; turn: number; accel: number; cruise: number; r: number; ticks: number; bound?: number }) {
    let { x, z, h, v } = o;
    const out = { h: 0, v: 0 };
    let onLava = 0;
    let firstOut = -1;
    let outZ = 0;
    const codes = new Set<number>();
    for (let i = 0; i < o.ticks; i++) {
      const look = o.r + 1.5 + Math.abs(v) * 0.35;
      const k = steerLava(lava, x, z, h, v, o.desH(x, z), o.desV, look, o.r * 0.8, 1, o.cruise, o.accel * 1.5, o.bound ?? Infinity, out);
      codes.add(k);
      let dh = (out.h - h) % (Math.PI * 2);
      if (dh > Math.PI) dh -= Math.PI * 2;
      else if (dh < -Math.PI) dh += Math.PI * 2;
      const mt = (k === LAVA_OUT ? Math.max(o.turn, 4) : o.turn) * DT;
      h += Math.max(-mt, Math.min(mt, dh));
      const a = o.accel * DT * (Math.abs(out.v) < Math.abs(v) ? 1.5 : 1);
      v += Math.max(-a, Math.min(a, out.v - v));
      x += Math.sin(h) * v * DT;
      z += Math.cos(h) * v * DT;
      if (o.bound !== undefined) {
        x = Math.max(-o.bound, Math.min(o.bound, x));
        z = Math.max(-o.bound, Math.min(o.bound, z));
      }
      if (lava.hit(x, z)) onLava++;
      else if (firstOut < 0) {
        firstOut = i;
        outZ = z;
      }
    }
    return { x, z, onLava, firstOut, outZ, codes };
  }

  it('a bot just inside the edge leaves on the near side, quickly (facing in, along or out)', () => {
    const t = new Terrain(DEV_TERRAIN);
    const lava = new LavaCache();
    lava.sync(t);
    const l = DEV_FEATURES.lava;
    const mx = (l.x1 + l.x2) / 2;
    // its AI wants to go on north across the river (heading PI) at 6 m/s
    for (const [h, v] of [[Math.PI, 4], [Math.PI, 0], [Math.PI / 2, 3], [0, 0], [Math.PI * 0.75, 6]]) {
      const res = runBot(lava, { x: mx, z: l.z + l.r - 0.4, h, v, desH: () => Math.PI, desV: 6, turn: 4.5, accel: 16, cruise: 3.4, r: 0.8, ticks: 60 });
      expect(res.firstOut).toBeGreaterThanOrEqual(0);
      // standing: out in ~0.2 s; already driving in at speed (brake, then back out): under 0.8 s
      expect(res.firstOut).toBeLessThan(v === 0 ? 15 : 48);
      expect(res.outZ).toBeGreaterThan(l.z + l.r - 0.01); // the near (south) edge, not across the river
      expect(res.codes.has(LAVA_OUT)).toBe(true);
    }
    // steerLava itself: facing in -> backs out; facing out -> drives out at least at cruise, keeping a faster wish
    const out = { h: 0, v: 0 };
    expect(steerLava(lava, mx, l.z + l.r - 0.4, Math.PI, 2, Math.PI, 6, 3, 0.6, 1, 3.4, 24, Infinity, out)).toBe(LAVA_OUT);
    expect(Math.abs(out.h)).toBeCloseTo(Math.PI, 6);
    expect(out.v).toBe(-3.4);
    expect(steerLava(lava, mx, l.z + l.r - 0.4, 0.1, 2, Math.PI, 9, 3, 0.6, 1, 3.4, 24, Infinity, out)).toBe(LAVA_OUT);
    expect(out.h).toBeCloseTo(0, 6);
    expect(out.v).toBe(9);
  });

  it('bots skirting lava never clip in, and stop rather than drive or turn into it', () => {
    const t = new Terrain(DEV_TERRAIN);
    const lava = new LavaCache();
    lava.sync(t);
    const l = DEV_FEATURES.lava;
    const mx = (l.x1 + l.x2) / 2;
    // (1) driving east along the south edge, 0.5 m clear of it, while the AI pulls it 40° into the river
    const a = runBot(lava, { x: l.x1 - 4, z: l.z + l.r + 0.5, h: Math.PI / 2, v: 5, desH: () => Math.PI / 2 + 0.7, desV: 6, turn: 4.5, accel: 16, cruise: 3.4, r: 0.8, ticks: 240 });
    expect(a.onLava).toBe(0);
    // (2) the probe flake: a ram at 14 m/s at a target just past the river's west end cap (turn rate 1.6)
    for (const dz of [-1.5, -0.5, 0.5]) {
      const b = runBot(lava, { x: l.x1 - 1, z: l.z + 5, h: Math.PI + 0.25, v: 14, desH: (x, z) => Math.atan2(l.x1 - 1.5 - x, l.z + dz - 4 - z), desV: 14, turn: 1.6, accel: 45, cruise: 3.4, r: 0.8, ticks: 60 });
      expect(b.onLava).toBe(0);
    }
    // (3) retreat after a ram (Inferno Quarry): 14 m/s heading away along the river 2 m off it, then the AI swings
    // round to the far side; the turn sweeps through the river at speed (it must brake first, then turn)
    for (const gap of [1.5, 2, 2.5]) {
      const c = runBot(lava, { x: mx + 4, z: l.z + l.r + gap, h: -1.2, v: 14, desH: () => 1.95, desV: 8, turn: 4.5, accel: 16, cruise: 3.4, r: 0.8, ticks: 120 });
      expect(c.onLava).toBe(0);
    }
    // (4) a target straight across: it stops short and does not creep in
    const d = runBot(lava, { x: mx, z: l.z + 4, h: Math.PI, v: 6, desH: () => Math.PI, desV: 6, turn: 4.5, accel: 16, cruise: 3.4, r: 0.8, ticks: 180 });
    expect(d.onLava).toBe(0);
    expect(d.codes.has(LAVA_AVOID)).toBe(true);
    // (5) a river that runs up to the arena wall: sliding along the wall into it counts as lava ahead
    const w = new Terrain({ patches: [{ material: 'lava', x: 20, z: 0, x2: 28, z2: 0, r: 1.7 }] });
    const wl = new LavaCache();
    wl.sync(w);
    const e = runBot(wl, { x: 29.2, z: 6, h: 2.4, v: 5, desH: () => 2.4, desV: 5, turn: 6.5, accel: 24, cruise: 4, r: 0.7, ticks: 180, bound: 29.3 });
    expect(e.onLava).toBe(0);
    // far from lava: untouched
    const out = { h: 0, v: 0 };
    expect(steerLava(lava, 0, 20, 1, 5, 1.2, 5, 3, 0.6, 1, 3, 24, Infinity, out)).toBe(LAVA_CLEAR);
    expect(out).toEqual({ h: 1.2, v: 5 });
  });

  it('the dev terrain keeps the plow spawn flat and has every feature', () => {
    const t = new Terrain(DEV_TERRAIN);
    expect(t.active).toBe(true);
    expect(t.ground(0, 18)).toBe(0);
    expect(t.materialAt(DEV_FEATURES.ice.x, DEV_FEATURES.ice.z)).toBe('ice');
    expect(t.ground(DEV_FEATURES.bowl.x, DEV_FEATURES.bowl.z)).toBeCloseTo(DEV_FEATURES.bowl.h, 5);
    const out = { x: 0, z: 0 };
    t.conveyorAt(24, -20, -1, out);
    expect(out.z).toBe(DEV_FEATURES.conveyor.speed);
  });
});
