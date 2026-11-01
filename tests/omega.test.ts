import { describe, expect, it } from 'vitest';
import { STEP_UP, Terrain, makeSurface } from '../src/world/Terrain';
import { D, FLOOR_Y, OMEGA_HALF, OMEGA_HATCHES, OMEGA_NAV, OMEGA_SPAWN, OMEGA_TERRAIN, TOWER_Y } from '../src/world/omega/layout';
import { NavGraph, detour } from '../src/world/omega/nav';

const terrain = new Terrain(OMEGA_TERRAIN);
const nav = new NavGraph(OMEGA_NAV);
const PLOW_R = 1.2;
const PLOW_H = 2.2;

/** A point "bot": steps toward a goal, climbs within STEP_UP, falls off edges, slides out of walls. */
function drive(from: { x: number; z: number; y: number }, to: { x: number; z: number; deck: number }, maxSteps = 4000) {
  const s = makeSurface();
  const p = { ...from };
  let deck = terrain.surfaceAt(p.x, p.z, p.y, s).deck;
  const wp = { x: 0, z: 0 };
  const push = { x: 0, z: 0 };
  for (let i = 0; i < maxSteps; i++) {
    const routed = nav.next(p.x, p.z, deck, to.x, to.z, to.deck, wp);
    let gx = routed ? wp.x : to.x;
    let gz = routed ? wp.z : to.z;
    const aim = { x: 0, z: 0 };
    if (detour(terrain, p.x, p.z, p.y, PLOW_H, PLOW_R, gx, gz, aim)) {
      gx = aim.x;
      gz = aim.z;
    }
    const dx = gx - p.x;
    const dz = gz - p.z;
    const d = Math.hypot(dx, dz);
    if (!routed && Math.hypot(to.x - p.x, to.z - p.z) < 1.5 && deck === to.deck) return { ok: true, steps: i, p, deck };
    const step = Math.min(0.25, d);
    let nx = p.x + (dx / (d || 1)) * step;
    let nz = p.z + (dz / (d || 1)) * step;
    const wall = terrain.wallAt(nx, nz, p.y, PLOW_H, PLOW_R);
    if (wall) {
      terrain.pushOut(wall, nx, nz, PLOW_R, push);
      nx = push.x;
      nz = push.z;
    }
    p.x = nx;
    p.z = nz;
    p.y = terrain.surfaceAt(p.x, p.z, p.y, s).y;
    deck = s.deck;
  }
  return { ok: false, steps: maxSteps, p, deck };
}

describe('The Omega Works layout', () => {
  it('fits the 160 m arena', () => {
    for (const d of OMEGA_TERRAIN.decks!) {
      const reach = Math.hypot(d.hw, d.hd);
      expect(Math.abs(d.x) + reach).toBeLessThan(OMEGA_HALF);
      expect(Math.abs(d.z) + reach).toBeLessThan(OMEGA_HALF);
    }
  });

  it('spawns the player on open ground', () => {
    const s = terrain.surfaceAt(OMEGA_SPAWN.x, OMEGA_SPAWN.z, 0);
    // Not on a conveyor (the ring loops run at z 60..64 / -64..-60): you'd drift during the countdown.
    const belt = { x: 0, z: 0 };
    terrain.conveyorAt(OMEGA_SPAWN.x, OMEGA_SPAWN.z, s.deck, belt);
    expect(Math.hypot(belt.x, belt.z)).toBe(0);
    expect(s.deck).toBe(-1);
    expect(terrain.wallAt(OMEGA_SPAWN.x, OMEGA_SPAWN.z, s.y, PLOW_H, PLOW_R)).toBeNull();
  });

  it('lets you drive under the Assembly Floor and the bridges', () => {
    for (const [x, z] of [[6, 6], [-6, -6], [29 + 4, -29 + 4], [-29 - 4, 29 + 4]]) {
      expect(terrain.surfaceAt(x, z, 0).deck).toBe(-1);
      expect(terrain.wallAt(x, z, 0, PLOW_H, PLOW_R)).toBeNull();
      expect(terrain.ceilingAt(x, z, 0)).toBeGreaterThan(PLOW_H + 2);
    }
  });

  it('has a tower overhang above the ring', () => {
    expect(terrain.surfaceAt(20, -8, 0).deck).toBe(-1);
    expect(terrain.ceilingAt(20, -8, 0)).toBeCloseTo(TOWER_Y - 1, 5);
  });

  it('puts every hatch and nav node on its declared surface, clear of walls', () => {
    const levelY = (region: number) => (region === -1 ? 0 : region === D.tower ? TOWER_Y : FLOOR_Y);
    for (const h of OMEGA_HATCHES) {
      const s = terrain.surfaceAt(h.x, h.z, h.deck === -1 ? 0 : h.deck === D.tower ? TOWER_Y : FLOOR_Y);
      expect(s.deck, `hatch ${h.x},${h.z}`).toBe(h.deck);
      expect(terrain.wallAt(h.x, h.z, s.y, PLOW_H, PLOW_R), `hatch ${h.x},${h.z} wall`).toBeNull();
    }
    for (const [name, n] of Object.entries(OMEGA_NAV.nodes)) {
      const s = terrain.surfaceAt(n.x, n.z, levelY(n.region) + 0.5);
      expect(nav.regionOf(s.deck), `node ${name}`).toBe(n.region);
    }
  });

  it('every ramp climbs smoothly from bottom to top', () => {
    for (const r of OMEGA_NAV.ramps) {
      const b = OMEGA_NAV.nodes[r.bottom];
      const t = OMEGA_NAV.nodes[r.top];
      const start = terrain.surfaceAt(b.x, b.z, b.region === -1 ? 0 : FLOOR_Y);
      const ty = t.region === -1 ? 0 : t.region === D.tower ? TOWER_Y : FLOOR_Y;
      const res = drive({ x: b.x, z: b.z, y: start.y }, { x: t.x, z: t.z, deck: terrain.surfaceAt(t.x, t.z, ty + 0.5).deck });
      expect(res.ok, `ramp ${r.deck}`).toBe(true);
    }
  });

  it('routes a bot from the spawn to every level and back down', () => {
    const targets = [
      { x: -10, z: -4, deck: D.floor },
      { x: 14, z: -10, deck: D.tower },
      { x: 52, z: -52, deck: D.platNE },
      { x: -52, z: 52, deck: D.platSW },
      { x: 29, z: -29, deck: D.bridgeNE },
    ];
    for (const t of targets) {
      const up = drive({ x: OMEGA_SPAWN.x, z: OMEGA_SPAWN.z, y: 0 }, t);
      expect(up.ok, `up to deck ${t.deck}`).toBe(true);
      const ty = terrain.surfaceAt(t.x, t.z, Infinity).y;
      const down = drive({ x: t.x, z: t.z, y: ty }, { x: 40, z: 60, deck: -1 });
      expect(down.ok, `down from deck ${t.deck}`).toBe(true);
    }
    // platform to platform, across the Floor and both bridges
    const cross = drive({ x: 52, z: -52, y: FLOOR_Y }, { x: -52, z: 52, deck: D.platSW });
    expect(cross.ok).toBe(true);
  });

  it('steers straight when bot and target share a region', () => {
    const wp = { x: 0, z: 0 };
    expect(nav.next(30, 60, -1, -30, 60, -1, wp)).toBe(false);
    expect(nav.next(-10, -4, D.floor, 10, 10, D.floor, wp)).toBe(false);
  });

  it('per-step ramp climbs stay inside STEP_UP at plow speeds', () => {
    // steepest ramp: tower ramp, 6 m over 14 m; a 16 m/s plow at 60 fps moves 0.27 m per frame
    expect((6 / 14) * (16 / 60)).toBeLessThan(STEP_UP);
  });
});
