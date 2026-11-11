import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Combat } from '../src/entities/Combat';
import { computeStatsFor } from '../src/core/Progression';
import type { DamageOpts, EnemyHandle, GameContext } from '../src/core/types';
import type { PilotBinding } from '../src/entities/pilot';
import type { Plow } from '../src/entities/Plow';
import type { PlowKind } from '../src/config/plows';
import { PLOWS, knockScale } from '../src/config/plows';
import { ARC_CLOSE_MULT, ARC_CLOSE_MULT_BOT, arcCloseMult, arcRange } from '../src/entities/combat/volt';
import { TANK_BUSTER, TANK_BUSTER_BOT_HP, tankBusterTick, type IsotopeKit } from '../src/entities/combat/isotope';
import { REV_SPEED, VOLT_KITE_REV, reverseCap } from '../src/entities/plow/constants';
import { OpponentTarget, PlowHandle, type DuelHit } from '../src/duel/opponent';

/* Role rework: VOLT-9 true ranged (14 m Arc Lance, Duel close-range penalty, kiting reverse), ISOTOPE tank-buster burn,
 * per-plow heaviness (knockResist). */

const noop: unknown = new Proxy(() => noop, { get: () => noop, apply: () => noop });
type Bot = EnemyHandle & { hp: number; dealt: number };
let nextId = 1;
const bot = (x: number, z: number, maxHp = 1e6): Bot =>
  ({ id: nextId++, position: new THREE.Vector3(x, 0, z), radius: 1, hp: 1e9, maxHp, alive: true, dealt: 0, type: 'grunt', mass: 1, isBoss: false }) as unknown as Bot;

function rig(kind: PlowKind, bots: Bot[], o: { pvp?: boolean; authoritative?: boolean; visualFoe?: EnemyHandle } = {}) {
  const held = new Set<string>();
  const pushes: [number, number][] = [];
  const opts: (DamageOpts | undefined)[] = [];
  const plow = {
    position: new THREE.Vector3(), heading: 0, hp: 100, maxHp: 100, dead: false, radius: 1.6, speed: 0, turretAim: 0, turretHeading: 0, whirlCharge: 1, surfaceY: 0,
    heldBallRadius: 0, sawHalo: 0, hop: 0, dashing: false, whirling: false, invulnerable: false, airborne: false, voltArc: false,
    get eCharge() {
      return plow.whirlCharge;
    },
    spendE() {},
    damage(n: number) {
      plow.hp -= n;
    },
    feedSawFury() {},
    push(x: number, z: number) {
      pushes.push([x, z]);
    },
    stealSnow: () => 0,
    hitStop() {},
    mountWorld: (_k: string, _i: number, out: THREE.Vector3) => out.set(0, 1, 0),
    getForward: (out: THREE.Vector3) => out.set(0, 0, 1),
    getBladeTip: (out: THREE.Vector3) => out.set(0, 0, 2.5),
  };
  const enemies = {
    bosses: [],
    query: (x: number, z: number, r: number, out: EnemyHandle[] = []) => {
      out.length = 0;
      for (const b of bots) if (b.alive && Math.hypot(b.position.x - x, b.position.z - z) <= r + b.radius) out.push(b);
      return out;
    },
    damage: (e: EnemyHandle, n: number, d?: DamageOpts) => {
      const b = e as Bot;
      opts.push(d);
      b.dealt += n;
      b.hp -= n;
      return false;
    },
  };
  const binding = {
    stats: computeStatsFor({}, kind), plow, enemies, snow: noop, events: noop, local: false, authoritative: o.authoritative ?? true, look: null,
    pvp: o.pvp, visualFoe: o.visualFoe ?? null,
    input: { throttle: 0, steer: 0, wasPressed: () => false, isDown: (k: string) => held.has(k) },
    audio: noop,
  } as unknown as PilotBinding;
  const ctx = { scene: new THREE.Scene(), time: 0, fx: noop, ui: noop, impact: noop, cameraRig: noop, terrain: undefined } as unknown as GameContext;
  const c = new Combat(ctx, binding);
  c.clear();
  const run = (s: number) => {
    for (let i = 0; i < Math.round(s * 60); i++) {
      (ctx as { time: number }).time += 1 / 60;
      c.update(1 / 60);
    }
  };
  return { c, plow, held, run, pushes, opts, binding };
}

/** Arc Lance damage on one target `z` m ahead over 1.5 s of held SPACE. */
function arcOn(z: number, pvp: boolean): number {
  const t = bot(0, z);
  const r = rig('volt', [t], { pvp });
  r.held.add('Space');
  r.run(1.5);
  return t.dealt;
}

describe('VOLT-9: true ranged', () => {
  it('Arc Lance reaches 14 m (about 20 m late), and locks a bot 13 m ahead', () => {
    expect(arcRange(1.2)).toBe(14);
    expect(arcRange(3.6)).toBeCloseTo(20, 5);
    expect(arcOn(13, false)).toBeGreaterThan(0);
    expect(arcOn(16.5, false)).toBe(0);
  });

  it('close-range penalty: x0.6 within a 3 m gap, ramping to x1 at 5 m', () => {
    expect(arcCloseMult(0)).toBe(ARC_CLOSE_MULT);
    expect(arcCloseMult(3)).toBe(ARC_CLOSE_MULT);
    expect(arcCloseMult(4)).toBeCloseTo(0.8, 6);
    expect(arcCloseMult(5)).toBe(1);
    expect(arcCloseMult(12)).toBe(1);
  });

  it('close-range penalty: bumper to bumper a Duel target takes 0.6x of one at range, a bot 0.7x (VOLT has to keep moving)', () => {
    // Gap = centre distance - rover hull (1.6) - target radius (1): z 4 -> 1.4 m gap (x0.6), z 9 -> 6.4 m (x1).
    const near = arcOn(4, true);
    const far = arcOn(9, true);
    expect(near / far).toBeCloseTo(ARC_CLOSE_MULT, 2);
    expect(arcOn(4, false) / arcOn(9, false)).toBeCloseTo(ARC_CLOSE_MULT_BOT, 2);
  });

  it('kiting: reverse top speed is 0.8 x max while VOLT-9 holds the lance, 0.45 x otherwise and for every other plow', () => {
    expect(reverseCap(20, 'volt', true)).toBeCloseTo(20 * VOLT_KITE_REV, 6);
    expect(reverseCap(20, 'volt', false)).toBeCloseTo(20 * REV_SPEED, 6);
    expect(reverseCap(20, 'brute', true)).toBeCloseTo(20 * REV_SPEED, 6);
    // The kit flags the plow while the lance fires (Plow reads voltArc for the cap), and clears it on release.
    const r = rig('volt', []);
    r.held.add('Space');
    r.run(0.1);
    expect(r.plow.voltArc).toBe(true);
    r.held.clear();
    r.run(0.1);
    expect(r.plow.voltArc).toBe(false);
  });

  it('Duel guest: the bolt lands on the opponent (visual only) but deals no damage', () => {
    const foe = bot(0, 10);
    const r = rig('volt', [], { pvp: true, authoritative: false, visualFoe: foe });
    r.held.add('Space');
    r.run(0.5);
    expect(foe.dealt).toBe(0);
  });
});

describe('ISOTOPE: tank-buster burn', () => {
  it('a burn tick takes 0.5% of max HP per second, bots counted up to the cap, Duel plows in full', () => {
    expect(tankBusterTick(1000, false)).toBeCloseTo(TANK_BUSTER * 0.5 * 1000, 6);
    expect(tankBusterTick(1e6, false)).toBeCloseTo(TANK_BUSTER * 0.5 * TANK_BUSTER_BOT_HP, 6);
    expect(tankBusterTick(540, true)).toBeCloseTo(TANK_BUSTER * 0.5 * 540, 6);
    expect(tankBusterTick(540, true)).toBeGreaterThan(tankBusterTick(360, true)); // BRUTUS hurts most
  });

  it('bigger bots burn harder (up to the cap); the burn adds it on top in one hit', () => {
    const burn = (maxHp: number) => {
      const b = bot(0, 3, maxHp);
      const r = rig('isotope', [b]);
      (r.c as unknown as { isotope: IsotopeKit }).isotope.rads.set(b, 3);
      r.run(2);
      return b.dealt;
    };
    const small = burn(50);
    const big = burn(1500);
    const huge = burn(1e7);
    // 4 burn ticks in 2 s: the difference is the tank-buster on 1450 more HP.
    expect(big - small).toBeCloseTo(4 * TANK_BUSTER * 0.5 * 1450, 1);
    expect(huge).toBeCloseTo(big, 6);
  });

  it('in the Duel the tank-buster lands as its own hpShare hit', () => {
    const b = bot(0, 3, 540);
    const r = rig('isotope', [b], { pvp: true });
    (r.c as unknown as { isotope: IsotopeKit }).isotope.rads.set(b, 3);
    r.run(0.6);
    // One hpShare hit beside every burn tick.
    const shares = r.opts.filter((o) => o?.hpShare).length;
    expect(shares).toBeGreaterThan(0);
    expect(shares).toBe(r.opts.length - shares);
  });

  it('the Duel adapter lands an hpShare hit unscaled (a plain one is scaled down)', () => {
    const hit = (hpShare: boolean) => {
      let got = 0;
      const victim = { position: new THREE.Vector3(0, 0, 3), radius: 1.6, hp: 540, maxHp: 540, dead: false, hitStop() {} } as unknown as Plow;
      const attacker = { position: new THREE.Vector3() } as unknown as Plow;
      const combat = { hitPlow: (n: number) => ((got = n), n) } as unknown as Combat;
      const t = new OpponentTarget(new PlowHandle(2, victim), () => combat, () => computeStatsFor({}, 'isotope'), () => attacker, () => computeStatsFor({}, 'volt'));
      t.enabled = true;
      t.damage(t.handle, 2, { source: 'other', direct: 'beam', hpShare });
      return got;
    };
    expect(hit(true)).toBeCloseTo(2, 1); // only the Brawl hit soft-cap's tiny bend
    expect(hit(false)).toBeLessThan(1.5);
  });
});

describe('heaviness: knockResist', () => {
  it('BRUTUS takes half, Classic 0.8, ISOTOPE 0.85, VOLT-9 / ARSENAL full', () => {
    expect(knockScale('brute')).toBe(0.5);
    expect(knockScale('classic')).toBe(0.8);
    expect(knockScale('isotope')).toBe(0.85);
    expect(knockScale('volt')).toBe(1);
    expect(knockScale('arsenal')).toBe(1);
    expect(knockScale(undefined)).toBe(1);
    for (const p of Object.values(PLOWS)) expect(p.knockResist).toBeGreaterThan(0);
  });

  it('Combat.hitPlow knocks a heavy plow back less (every source: bots, rivals, the Duel opponent)', () => {
    const kick = (kind: PlowKind) => {
      const r = rig(kind, []);
      r.c.hitPlow(5, 0, 3, { knockback: 8 });
      const [x, z] = r.pushes[0];
      return Math.hypot(x, z);
    };
    expect(kick('volt')).toBeCloseTo(8, 6);
    expect(kick('brute')).toBeCloseTo(4, 6);
    expect(kick('classic')).toBeCloseTo(6.4, 6);
  });

  it('the Duel replays the scaled push on the guest (DuelHit kx / kz)', () => {
    const kx = (kind: PlowKind, o: DamageOpts = { source: 'ram' }) => {
      let h: DuelHit | null = null;
      const victim = { position: new THREE.Vector3(0, 0, 3), radius: 1.6, hp: 540, maxHp: 540, dead: false, hitStop() {} } as unknown as Plow;
      const attacker = { position: new THREE.Vector3() } as unknown as Plow;
      const combat = { hitPlow: (n: number) => n } as unknown as Combat;
      const t = new OpponentTarget(new PlowHandle(2, victim), () => combat, () => computeStatsFor({}, 'classic'), () => attacker, () => computeStatsFor({}, kind));
      t.enabled = true;
      t.onHit = (d) => (h = { ...d });
      t.damage(t.handle, 10, { ...o, knockback: new THREE.Vector3(0, 0, 10) });
      return Math.hypot(h!.kx, h!.kz);
    };
    expect(kx('brute') / kx('volt')).toBeCloseTo(0.5, 6);
    // Every move goes through the one rule: the Classic's tap and rush slams ('slam'), rams / dash strikes ('ram'), ARSENAL's laser tug.
    const moves: DamageOpts[] = [{ source: 'slam' }, { source: 'ram', direct: 'round' }];
    for (const o of moves) for (const k of ['brute', 'classic', 'isotope'] as const) expect(kx(k, o) / kx('volt', o)).toBeCloseTo(knockScale(k), 6);
  });
});
