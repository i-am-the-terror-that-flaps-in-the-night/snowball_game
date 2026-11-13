import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Combat } from '../src/entities/Combat';
import { computeStatsFor } from '../src/core/Progression';
import type { DamageOpts, EnemyHandle, GameContext, ImpactKind } from '../src/core/types';
import type { PilotBinding } from '../src/entities/pilot';
import { Terrain } from '../src/world/Terrain';
import { PLOWS, type PlowKind } from '../src/config/plows';
import { CLASSIC_SLAM_POWER, RUSH_MIN_SLAM_R } from '../src/entities/combat/classicRush';
import {
  FINISHER_DAMAGE, FINISHER_MIN_BALL, FINISHER_MIN_R, FINISHER_RADIUS, STREAK_COLORS, STREAK_DAMAGE, STREAK_MAX, STREAK_REFUND,
  STREAK_SPEED, STREAK_WINDOW, StreakHit, StreakState, finisherBall, streakDamage, streakSpeed,
} from '../src/entities/combat/classicStreak';
import { StreakFx, hullSilhouette } from '../src/entities/plow/streakFx';
import { shadowProxyMaterial } from '../src/render/shadowProxy';
import { spreadDps } from '../scripts/balance/sim';

/* The Classic Plow's signature passive, STREAK: slams on new targets stack it (damage, speed, meter back), ON STREAK
 * the next slam is the SHOCKWAVE FINISHER, it drops after 3.5 s without a new target, and it is off in the Duel. */

const noop: unknown = new Proxy(() => noop, { get: () => noop, apply: () => noop });

let nextId = 1;
function bot(x: number, z: number, hp = 1e6): EnemyHandle {
  return { id: nextId++, position: new THREE.Vector3(x, 0, z), radius: 1, hp, maxHp: hp, alive: true, airborne: false, vy: 0, deck: -1 } as unknown as EnemyHandle;
}
const ids = (...n: number[]) => n.map((id) => ({ id }));

/** A Combat bound to a scripted plow at the origin facing +Z, recording every hit and impact. */
function rig(bots: EnemyHandle[], opts: { kind?: PlowKind; pvp?: boolean; snowTop?: (x: number, z: number) => number } = {}) {
  const stats = computeStatsFor({}, opts.kind ?? 'classic');
  const plow = {
    position: new THREE.Vector3(), heading: 0, hp: 100, maxHp: 100, dead: false, radius: 1.6, heldBallRadius: 0,
    airborne: false, vy: 0, airTime: 0, surfaceY: 0, deck: -1, hop: 0, dashing: false, rushing: false, speed: 0, dashCharge: 0.2,
    getForward: (o: THREE.Vector3) => o.set(0, 0, 1),
    getBladeTip: (o: THREE.Vector3) => o.set(0, 0, 2.5),
    feedSawFury: () => {},
    stealSnow: () => 0,
    push: () => {},
    damage() {},
  };
  const hits: { e: EnemyHandle; amount: number; knock: number }[] = [];
  const enemies = {
    query: (x: number, z: number, r: number, out: EnemyHandle[] = []) => {
      out.length = 0;
      for (const b of bots) if (b.alive && Math.hypot(b.position.x - x, b.position.z - z) <= r + b.radius) out.push(b);
      return out;
    },
    damage: (e: EnemyHandle, amount: number, o?: DamageOpts) => {
      hits.push({ e, amount, knock: o?.knockback ? Math.hypot(o.knockback.x, o.knockback.z) : 0 });
      return false;
    },
  };
  const impacts: ImpactKind[] = [];
  const texts: string[] = [];
  const fx = new Proxy({}, { get: (_t, k) => (k === 'floatText' ? (_p: unknown, s: string) => texts.push(s) : noop) });
  const ctx = { scene: new THREE.Scene(), time: 0, fx, ui: noop, terrain: new Terrain(), impact: { hit: (k: ImpactKind) => impacts.push(k) },
    snow: opts.snowTop ? { topAt: opts.snowTop } : null } as unknown as GameContext;
  const snow = new Proxy({}, { get: (_t, k) => (k === 'getDepth' ? () => 0 : noop) });
  const binding = {
    stats, plow, enemies, input: { throttle: 0, steer: 0, wasPressed: () => false }, audio: noop, snow, events: { emit: () => {} }, local: true, authoritative: true, pvp: !!opts.pvp,
  } as unknown as PilotBinding;
  const c = new Combat(ctx, binding);
  c.clear();
  const step = (s: number) => {
    for (let t = 0; t < s - 1e-9; t += 1 / 60) {
      (ctx as { time: number }).time += 1 / 60;
      c.update(1 / 60);
    }
  };
  return { c, hits, plow, stats, impacts, texts, step };
}

describe('STREAK numbers', () => {
  it('+18% damage and +8% top speed per stack, 15% meter back, max 4, a 3.5 s window', () => {
    expect([STREAK_MAX, STREAK_WINDOW, STREAK_DAMAGE, STREAK_SPEED, STREAK_REFUND]).toEqual([4, 3.5, 0.18, 0.08, 0.15]);
    expect(streakDamage(0)).toBe(1);
    expect(streakDamage(2)).toBeCloseTo(1.36);
    expect(streakDamage(4)).toBeCloseTo(1.72);
    expect(streakDamage(9)).toBeCloseTo(1.72);
    expect(streakSpeed(-1)).toBe(1);
    expect(streakSpeed(4)).toBeCloseTo(1.32);
  });

  it('the SHOCKWAVE FINISHER: 2x zone, +60% on top of the 4 stacks, and a real ball even off a ball-less rush', () => {
    expect(FINISHER_RADIUS).toBe(2);
    expect(FINISHER_DAMAGE).toBe(1.6);
    expect(streakDamage(4, true)).toBeCloseTo(1.72 * 1.6);
    expect(finisherBall(0.6, 1.2, false)).toBe(0.6);
    expect(finisherBall(0.6, 1.2, true)).toBe(FINISHER_MIN_R);
    expect(finisherBall(0.6, 3.6, true)).toBeCloseTo(FINISHER_MIN_BALL * 3.6);
    expect(finisherBall(2.5, 3.6, true)).toBe(2.5);
  });

  it('stack colours run white, cyan, gold, hot red-orange', () => {
    expect(STREAK_COLORS).toEqual([0xffffff, 0x2ee6ff, 0xffc21a, 0xff4a12]);
  });
});

describe('StreakState', () => {
  it('a slam on a target the last one did not hit stacks; the same targets again only hold', () => {
    const s = new StreakState();
    expect(s.land(ids(1), 1, false)).toBe(StreakHit.Stack);
    expect(s.stacks).toBe(1);
    expect(s.land(ids(1), 1, false)).toBe(StreakHit.Hold);
    expect(s.stacks).toBe(1);
    // a group with one new bot in it counts; the same group again doesn't
    expect(s.land(ids(1, 2), 2, false)).toBe(StreakHit.Stack);
    expect(s.land(ids(2, 1), 2, false)).toBe(StreakHit.Hold);
    expect(s.land(ids(3), 1, false)).toBe(StreakHit.Stack);
    expect(s.land(ids(4), 1, false)).toBe(StreakHit.Stack);
    expect(s.stacks).toBe(STREAK_MAX);
    expect(s.onStreak).toBe(true);
    // ON STREAK, another new target only restarts the window
    expect(s.land(ids(5), 1, false)).toBe(StreakHit.Refresh);
    expect(s.stacks).toBe(STREAK_MAX);
    expect(s.land(ids(), 0, false)).toBe(StreakHit.None);
  });

  it('holding never restarts the window: 3.5 s after the last new target every stack drops at once', () => {
    const s = new StreakState();
    s.land(ids(1), 1, false);
    s.land(ids(2), 1, false);
    expect(s.update(2)).toBe(0);
    expect(s.left).toBeCloseTo(1 - 2 / 3.5);
    s.land(ids(2), 1, false); // hold
    expect(s.update(1.4)).toBe(0);
    expect(s.update(0.2)).toBe(2);
    expect(s.stacks).toBe(0);
    expect(s.left).toBe(0);
    // a new target restarts it
    s.land(ids(7), 1, false);
    s.update(3);
    s.land(ids(8), 1, false);
    expect(s.update(3)).toBe(0);
    expect(s.stacks).toBe(2);
  });

  it('the finisher resets the stacks; a finisher that hits nothing keeps them', () => {
    const s = new StreakState();
    for (let i = 1; i <= 4; i++) s.land(ids(i), 1, false);
    expect(s.land(ids(), 0, true)).toBe(StreakHit.None);
    expect(s.stacks).toBe(4);
    expect(s.land(ids(1), 1, true)).toBe(StreakHit.Finish);
    expect(s.stacks).toBe(0);
    // the finisher's targets count as the last hit: slamming them again holds at 0
    expect(s.land(ids(1), 1, false)).toBe(StreakHit.Hold);
    expect(s.land(ids(9), 1, false)).toBe(StreakHit.Stack);
  });
});

describe('STREAK in Combat (tap and rush slams)', () => {
  // A 1.5 m ball slammed at a bot: zone 1.5 x 1.3 + 2.6 x 0.35 = 2.86 m. Bots 10 m apart: one per slam.
  const row = () => [0, 10, 20, 30, 40, 50].map((x) => bot(x, 5));

  it('each slam on a new bot stacks (damage grows +18% a stack) and refunds 15% of the dash meter', () => {
    const bots = row();
    const r = rig(bots);
    expect(r.c.streak).toBe(0);
    const first = () => r.hits[r.hits.length - 1].amount;
    r.c.tapSlam(0, 5, 1.5, 0);
    const base = first();
    expect(r.c.streak).toBe(1);
    expect(r.plow.dashCharge).toBeCloseTo(0.2 + STREAK_REFUND);
    r.c.tapSlam(10, 5, 1.5, 0);
    expect(first() / base).toBeCloseTo(streakDamage(1));
    expect(r.c.streak).toBe(2);
    // the same bot again: holds, no refund
    r.c.tapSlam(10, 5, 1.5, 0);
    expect(first() / base).toBeCloseTo(streakDamage(2));
    expect(r.c.streak).toBe(2);
    expect(r.plow.dashCharge).toBeCloseTo(0.2 + 2 * STREAK_REFUND);
    r.c.rushSlam(20, 5, 1.5, 0);
    r.c.tapSlam(30, 5, 1.5, 0);
    expect(r.c.streak).toBe(4);
    expect(r.texts).toContain('STREAK x2');
    expect(r.texts.some((t) => t.includes('ON STREAK'))).toBe(true);
  });

  it('ON STREAK the next slam is the SHOCKWAVE: 2x zone, +60% on top of 4 stacks, harder knockback, finisher impact', () => {
    const bots = row();
    const near = bot(43, 5); // 3 m off the slam: outside a 2.86 m zone, inside the doubled one
    const r = rig([...bots, near]);
    r.c.tapSlam(0, 5, 1.5, 0);
    const base = r.hits[0].amount;
    const knock0 = r.hits[0].knock;
    for (const x of [10, 20, 30]) r.c.tapSlam(x, 5, 1.5, 0);
    expect(r.c.streak).toBe(4);
    r.hits.length = 0;
    r.c.tapSlam(40, 5, 1.5, 0);
    expect(r.hits.map((h) => h.e)).toContain(near);
    const centre = r.hits.find((h) => h.e === bots[4])!;
    expect(centre.amount / base).toBeCloseTo(streakDamage(4, true));
    expect(centre.knock).toBeGreaterThan(knock0 * 1.5);
    expect(r.impacts).toContain('finisher');
    expect(r.texts).toContain('SHOCKWAVE!');
    expect(r.c.streak).toBe(0);
  });

  it('the finisher\'s ground waves sit on the snow banked round the slam (at most 1.2 m up), not buried in its trough', () => {
    const waveY = (bank: number) => {
      const r = rig(row(), { snowTop: (x, z) => (Math.hypot(x - 40, z - 5) > 1 ? bank : 0) });
      for (const x of [0, 10, 20, 30, 40]) r.c.tapSlam(x, 5, 1.5, 0);
      const waves = (r.c as unknown as { classic: { shock: { waves: { root: THREE.Group }[] } } }).classic.shock.waves;
      return Math.max(...waves.filter((w) => w.root.visible).map((w) => w.root.position.y));
    };
    expect(waveY(0.7)).toBeCloseTo(0.8);
    // a wall or deck next to it never lifts the wave into the air
    expect(waveY(6)).toBeCloseTo(1.3);
  });

  it('a ball-less rush finisher hits with a real ball (FINISHER_MIN_R)', () => {
    const r = rig(row());
    for (const x of [0, 10, 20, 30]) r.c.rushSlam(x, 5, RUSH_MIN_SLAM_R, 0);
    const small = r.hits[0].amount;
    r.c.rushSlam(40, 5, RUSH_MIN_SLAM_R, 0);
    const fin = r.hits[r.hits.length - 1].amount;
    const ball = (FINISHER_MIN_R / RUSH_MIN_SLAM_R) ** 2;
    expect(fin / small).toBeCloseTo(ball * streakDamage(4, true), 1);
  });

  it('3.5 s without a new target drops the streak with a fizzle', () => {
    const r = rig(row());
    r.c.tapSlam(0, 5, 1.5, 0);
    r.c.tapSlam(10, 5, 1.5, 0);
    r.step(2);
    expect(r.c.streak).toBe(2);
    expect(r.c.streakLeft).toBeCloseTo(1 - 2 / 3.5, 1);
    r.step(1.6);
    expect(r.c.streak).toBe(0);
    expect(r.texts).toContain('streak lost');
  });

  it('is off in the online Duel: no stacks, the plain Classic slam, Duel balance unchanged', () => {
    const duel = rig(row(), { pvp: true });
    const solo = rig(row());
    for (const x of [0, 10, 20, 30, 40]) {
      duel.c.tapSlam(x, 5, 1.5, 0);
      solo.c.tapSlam(x, 5, 1.5, 0);
    }
    expect(duel.c.streak).toBe(-1);
    expect(duel.c.streakLeft).toBe(0);
    expect(duel.plow.dashCharge).toBe(0.2);
    expect(duel.impacts).not.toContain('finisher');
    const plain = duel.hits[0].amount;
    for (const h of duel.hits) expect(h.amount).toBeCloseTo(plain);
    expect(solo.hits[4].amount).toBeGreaterThan(plain * 2);
    expect(plain).toBeCloseTo(solo.hits[0].amount);
    expect(CLASSIC_SLAM_POWER).toBe(1.25);
  });

  it('other plows (and vehicles on the snowball kit) have no streak', () => {
    const r = rig(row(), { kind: 'brute' });
    r.c.tapSlam(0, 5, 1.5, 0);
    r.c.tapSlam(10, 5, 1.5, 0);
    expect(r.c.streak).toBe(-1);
  });

  it('is named in the Classic plow description', () => {
    expect(PLOWS.classic.traits.some((t) => t.includes('STREAK') && t.includes('SHOCKWAVE'))).toBe(true);
  });
});

describe('STREAK in the balance sim', () => {
  it('ring play (each slam on a new bot) clearly out-damages the same play without it, at every tier', () => {
    for (const tier of ['fresh', 'high'] as const) {
      const on = spreadDps(tier, true, 30);
      const off = spreadDps(tier, false, 30);
      expect(on / off, tier).toBeGreaterThan(1.1);
      expect(on / off, tier).toBeLessThan(1.8);
    }
  });
});

describe('STREAK hull visuals (plow/streakFx.ts)', () => {
  /** A hull of two shadow-proxy boxes (+ one ordinary mesh the silhouette must skip) under a body frame. */
  function hull() {
    const body = new THREE.Group();
    const parts = new THREE.Group();
    body.add(parts);
    const a = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4), shadowProxyMaterial());
    const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shadowProxyMaterial());
    b.position.set(0, 2, 0);
    parts.add(a, b, new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial()));
    return { body, parts };
  }

  it('the silhouette merges the shadow proxies (position only) in the body frame', () => {
    const { body, parts } = hull();
    const g = hullSilhouette([parts], body, [{ geometry: new THREE.BoxGeometry(1, 1, 1), matrix: new THREE.Matrix4().makeTranslation(0, 0, 3) }]);
    expect(Object.keys(g.attributes)).toEqual(['position']);
    expect(g.getAttribute('position').count).toBe(24 * 3);
    expect(g.index!.count).toBe(36 * 3);
    expect(g.boundingBox!.max.y).toBeCloseTo(2.5);
    expect(g.boundingBox!.max.z).toBeCloseTo(3.5);
  });

  it('afterimages spawn while moving with stacks, tinted by the stack, and fade; the hull glow follows the stacks', () => {
    const { body, parts } = hull();
    const scene = new THREE.Scene();
    scene.add(body);
    const fx = new StreakFx(scene, body, hullSilhouette([parts], body));
    const ghosts = () => scene.children.filter((o) => o instanceof THREE.Group && o !== body && o.visible);
    fx.update(1 / 60, 0, 0, 20, 0, 0, 0);
    expect(ghosts().length).toBe(0);
    // parked with stacks: glow, no ghosts
    fx.update(1 / 60, 2, 1, 0, 0, 0, 0);
    expect(ghosts().length).toBe(0);
    const edge = body.children.find((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh;
    expect(edge.visible).toBe(true);
    expect((edge.material as THREE.MeshBasicMaterial).color.getHex()).toBe(STREAK_COLORS[1]);
    expect((edge.material as THREE.MeshBasicMaterial).blending).toBe(THREE.NormalBlending);
    // moving at 20 m/s: one ghost every couple of metres, more (closer together, longer lived) at 4 stacks than at 1
    const count = (k: number) => {
      fx.hide();
      let n = 0;
      for (let i = 0; i < 30; i++) {
        fx.update(1 / 60, k, 1, 20, 0, 0, (i * 20) / 60);
        n = Math.max(n, ghosts().length);
      }
      return n;
    };
    const one = count(1);
    expect(one).toBeGreaterThan(0);
    expect(count(4)).toBeGreaterThan(one);
    const g = ghosts()[0] as THREE.Group;
    const [mask, rim, fill] = g.children as THREE.Mesh[];
    expect([STREAK_COLORS[2], STREAK_COLORS[3]]).toContain((fill.material as THREE.MeshBasicMaterial).color.getHex());
    // Each ghost lays a depth-only mask of its silhouette first, then its outline shell, then the fill, all after every
    // other transparent FX: the shell shows as a rim (not a solid deep-coloured hull) and a rush's string of ghosts
    // never stacks into an opaque slab over the slam, while shockwaves / flashes behind them still show through.
    const mm = mask.material as THREE.MeshBasicMaterial;
    expect([mm.colorWrite, mm.depthWrite]).toEqual([false, true]);
    expect((rim.material as THREE.MeshBasicMaterial).side).toBe(THREE.BackSide);
    expect(mask.renderOrder).toBeLessThan(rim.renderOrder);
    expect(rim.renderOrder).toBeLessThan(fill.renderOrder);
    expect(mask.renderOrder).toBeGreaterThan(9);
    // stacks gone: the glow goes at once, the ghosts already out fade away
    fx.update(1 / 60, 0, 0, 20, 0, 0, 0);
    expect(edge.visible).toBe(false);
    for (let i = 0; i < 60; i++) fx.update(1 / 60, 0, 0, 20, 0, 0, 0);
    expect(ghosts().length).toBe(0);
  });
});
