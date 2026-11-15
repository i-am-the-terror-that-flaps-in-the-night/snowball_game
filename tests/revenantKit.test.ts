import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Combat } from '../src/entities/Combat';
import { computeStatsFor } from '../src/core/Progression';
import { PLOWS } from '../src/config/plows';
import { PHASE_MIN_COOLDOWN } from '../src/config/upgrades';
import type { EnemyHandle, GameContext } from '../src/core/types';
import type { PilotBinding } from '../src/entities/pilot';
import { BIG_EVERY, BIG_MULT, GRASP_COST, PHASE_SECONDS, PHASE_SOULS, REAP_RATE, SOULS_MAX, type RevenantKit } from '../src/entities/combat/revenant';

/* REVENANT: REAP (SPACE, hold), PHASE (E) + MANIFEST, HAUNT, SOUL GRASP (F) and the soul economy, through Combat's
 * vehicle routing. */

const noop: unknown = new Proxy(() => noop, { get: () => noop, apply: () => noop });
type Bot = EnemyHandle & { hp: number; dealt: number; hits: number; stun: number; hold: number };
let nextId = 1;
const bot = (x: number, z: number, hp = 1e6): Bot =>
  ({ id: nextId++, position: new THREE.Vector3(x, 0, z), radius: 1, hp, maxHp: hp, alive: true, dealt: 0, hits: 0, stun: 0, hold: 0, type: 'grunt', mass: 1, isBoss: false }) as unknown as Bot;

function rig(bots: Bot[], opts: { pvp?: boolean; levels?: Record<string, number> } = {}) {
  const press = new Set<string>();
  const held = new Set<string>();
  const plow = {
    position: new THREE.Vector3(), heading: 0, hp: 100, maxHp: 100, dead: false, turretAim: 0, turretHeading: 0, whirlCharge: 1, surfaceY: 0, radius: 1.6,
    phased: false,
    get eCharge() {
      return plow.whirlCharge;
    },
    spendE() {
      plow.whirlCharge = 0;
    },
    damage() {},
    feedSawFury() {},
    push() {},
    stealSnow: () => 0,
    hitStop() {},
    mountWorld: (_k: string, _i: number, o: THREE.Vector3) => o.set(0, 1, 0),
    getForward: (o: THREE.Vector3) => o.set(Math.sin(plow.heading), 0, Math.cos(plow.heading)),
  };
  const enemies = {
    bosses: [],
    duelFoeMaxHp: opts.pvp ? 400 : undefined,
    query: (x: number, z: number, r: number, o: EnemyHandle[] = []) => {
      o.length = 0;
      for (const b of bots) if (b.alive && Math.hypot(b.position.x - x, b.position.z - z) <= r + b.radius) o.push(b);
      return o;
    },
    damage: (e: EnemyHandle, n: number, o?: { stunSeconds?: number; hold?: number }) => {
      const b = e as Bot;
      b.dealt += n;
      b.hits++;
      b.hp -= n;
      b.stun = Math.max(b.stun, o?.stunSeconds ?? 0);
      b.hold = Math.max(b.hold, o?.hold ?? 0);
      if (b.hp <= 0 && b.alive) {
        (b as { alive: boolean }).alive = false;
        return true;
      }
      return false;
    },
    pull() {},
    tow() {},
  };
  const binding = {
    stats: computeStatsFor(opts.levels ?? {}, 'revenant'), plow, enemies, snow: noop, events: noop, local: false, authoritative: true, look: null, pvp: !!opts.pvp,
    input: { throttle: 0, steer: 0, wasPressed: (k: string) => press.has(k), isDown: (k: string) => held.has(k) },
    audio: noop,
  } as unknown as PilotBinding;
  const ctx = { scene: new THREE.Scene(), time: 0, fx: noop, ui: noop, impact: noop, cameraRig: noop, terrain: undefined } as unknown as GameContext;
  const c = new Combat(ctx, binding);
  c.clear();
  const step = () => {
    (ctx as { time: number }).time += 1 / 60;
    c.update(1 / 60);
    press.clear();
  };
  const run = (s: number) => {
    for (let i = 0; i < Math.round(s * 60); i++) step();
  };
  return { c, plow, press, held, run, step, binding };
}

const rev = (c: Combat) => (c as unknown as { revenant: RevenantKit }).revenant;

describe('REVENANT', () => {
  it('sits below the Classic on HP; PHASE never recharges under its floor however much gear speeds it up', () => {
    expect(PLOWS.revenant.hpMult).toBeLessThan(PLOWS.classic.hpMult);
    const fresh = computeStatsFor({}, 'revenant');
    expect(fresh.phaseCooldown).toBeGreaterThan(5.5);
    expect(fresh.phaseCooldown).toBeLessThanOrEqual(6.01);
    const geared = computeStatsFor({ revPhase: 30, nitro: 30, overclock: 30 }, 'revenant');
    expect(geared.phaseCooldown).toBe(PHASE_MIN_COOLDOWN);
    // Wide Blade lengthens the scythe; the kit stats stay off other plows' damage.
    expect(computeStatsFor({ blade: 5 }, 'revenant').reapReach).toBeGreaterThan(fresh.reapReach);
    expect(computeStatsFor({}, 'volt').reapDamage).toBe(0);
  });

  it('REAP sweeps the arc ahead about 2.5 times a second; every third is a big Reap for double damage; nothing behind', () => {
    const front = bot(0, 4);
    const side = bot(4, 3);
    const behind = bot(0, -4);
    const far = bot(0, 14);
    const r = rig([front, side, behind, far]);
    r.held.add('Space');
    r.run(2);
    const k = rev(r.c);
    expect(k.reapN).toBeGreaterThanOrEqual(Math.floor(REAP_RATE * 2));
    expect(k.reapN).toBeLessThanOrEqual(Math.ceil(REAP_RATE * 2) + 1);
    expect(front.hits).toBe(k.reapN);
    expect(side.hits).toBe(k.reapN);
    expect(behind.dealt).toBe(0);
    expect(far.dealt).toBe(0);
    // The damage split: n small sweeps + big ones at BIG_MULT.
    const big = Math.floor(k.reapN / BIG_EVERY);
    const per = r.binding.stats.reapDamage * r.binding.stats.damageMult;
    expect(front.dealt).toBeCloseTo(per * (k.reapN - big + big * BIG_MULT), 3);
  });

  it('PHASE: spectral for 1.2 s, Haunts and takes a soul from each bot passed (3 at most), then MANIFESTs', () => {
    const bots = [0, 1, 2, 3, 4].map((i) => bot(0, 0.5 + i * 0.01));
    const r = rig(bots);
    const k = rev(r.c);
    r.press.add('KeyE');
    r.step();
    expect(k.phaseT).toBeGreaterThan(0);
    expect(r.plow.phased).toBe(true);
    expect(k.haunts.size).toBe(5);
    expect(k.souls).toBe(PHASE_SOULS);
    r.run(PHASE_SECONDS + 0.1);
    expect(r.plow.phased).toBe(false);
    // MANIFEST hit every bot round the hearse, harder for the souls taken.
    const base = r.binding.stats.manifestDamage * r.binding.stats.damageMult * (1 + r.binding.stats.hauntVuln);
    for (const b of bots) expect(b.dealt).toBeGreaterThan(base * 1.5);
  });

  it('HAUNT: a Haunted bot takes +25% from the hearse; wrecked while Haunted it gives an extra soul and rises as a phantom', () => {
    const a = bot(0, 4);
    const b = bot(0.3, 4);
    const r = rig([a, b]);
    const k = rev(r.c);
    k.haunt(a);
    r.held.add('Space');
    r.run(0.1);
    expect(a.dealt / b.dealt).toBeCloseTo(1 + r.binding.stats.hauntVuln, 3);
    // A Haunted grunt wreck: 1 + 1 souls, and the phantom's burst lands on its neighbour.
    r.held.clear();
    const victim = bot(0, 4, 1);
    const near = bot(2, 4);
    const r2 = rig([victim, near]);
    const k2 = rev(r2.c);
    k2.haunt(victim);
    r2.held.add('Space');
    r2.run(0.05);
    r2.held.clear();
    expect(victim.alive).toBe(false);
    expect(k2.souls).toBe(2);
    const before = near.dealt;
    r2.run(2);
    expect(near.dealt - before).toBeGreaterThan(r2.binding.stats.phantomDamage * 0.9);
  });

  it('SOUL GRASP costs 3 souls (nothing under 3), stuns every Haunted bot in reach and leaves the rest alone', () => {
    const h1 = bot(0, 12);
    const h2 = bot(-8, 6);
    const free = bot(6, 6);
    const r = rig([h1, h2, free]);
    const k = rev(r.c);
    k.haunt(h1);
    k.haunt(h2);
    k.souls = GRASP_COST - 1;
    r.press.add('KeyF');
    r.step();
    expect(h1.dealt).toBe(0);
    expect(r.c.flameReady).toBeLessThan(1);
    k.souls = GRASP_COST + 1;
    expect(r.c.flameReady).toBe(1);
    r.press.add('KeyF');
    r.step();
    expect(k.souls).toBe(1);
    expect(h1.stun).toBeGreaterThanOrEqual(1);
    expect(h2.stun).toBeGreaterThanOrEqual(1);
    expect(free.dealt).toBe(0);
  });

  it('souls cap at 10; in the Duel they come from damage dealt (1 per 10% of the foe), and Grasp holds the pilot 0.6 s', () => {
    const r = rig([]);
    const k = rev(r.c);
    k.addSouls(25);
    expect(k.souls).toBe(SOULS_MAX);
    expect(r.c.souls).toBe(SOULS_MAX);

    const foe = bot(0, 4, 400);
    const d = rig([foe], { pvp: true });
    const kd = rev(d.c);
    kd.onHit(39, false, foe);
    expect(kd.souls).toBe(0);
    kd.onHit(1, false, foe);
    expect(kd.souls).toBe(1);
    kd.onHit(85, false, foe);
    expect(kd.souls).toBe(3);
    kd.haunt(foe);
    d.press.add('KeyF');
    d.step();
    expect(foe.hold).toBeCloseTo(0.6);
  });

  it('a PHASED hearse takes no damage', () => {
    const r = rig([bot(0, 0.5)]);
    r.press.add('KeyE');
    r.step();
    expect(r.c.hitPlow(50, 0, 3)).toBe(0);
  });
});
