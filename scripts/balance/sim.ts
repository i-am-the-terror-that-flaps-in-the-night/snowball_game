/* Headless balance sim: drives the real Combat kits (no browser) against dummy bots and duel opponents.
 * Plow-driven attacks (slam, whirl, dash strike) are scheduled from a simple engagement model (see MELEE below);
 * everything Combat owns (F abilities, ultimates, auras, burns, guns, laser, missiles) runs for real. */
import * as THREE from 'three';
import { Combat } from '../../src/entities/Combat';
import { computeStatsFor } from '../../src/core/Progression';
import { GEAR_BY_ID, gearLevels, type GearState } from '../../src/config/gear';
import { UPGRADE_BY_ID, type UpgradeId } from '../../src/config/upgrades';
import { ballVolume, type EnemyHandle, type GameContext, type PlayerStats } from '../../src/core/types';
import { OpponentTarget, PlowHandle } from '../../src/duel/opponent';
import type { PilotBinding } from '../../src/entities/pilot';
import type { Plow } from '../../src/entities/Plow';
import type { PlowKind } from '../../src/config/plows';

export const KINDS: PlowKind[] = ['classic', 'volt', 'brute', 'isotope', 'arsenal'];
export type Tier = 'fresh' | 'mid' | 'high';
export const TIERS: Tier[] = ['fresh', 'mid', 'high'];

const LINE: Record<PlowKind, UpgradeId[]> = {
  classic: ['inferno', 'classicShatter', 'classicReserve', 'classicCombo'],
  volt: ['voltClap', 'voltChain', 'voltField', 'voltCell'],
  brute: ['brutePound', 'bruteSaws', 'bruteHide', 'bruteMomentum'],
  isotope: ['isoMeltdown', 'isoHalfLife', 'isoAura', 'isoChain'],
  arsenal: ['armCannon', 'armLaser', 'armMissiles', 'armBarrier'],
};

/** Garage levels (core four + the plow's own line) and equipped gear per tier. */
const TIER_DEF: Record<Tier, { core: number; line: number; gear: Record<string, number> }> = {
  fresh: { core: 0, line: 0, gear: {} },
  // Mid-game: a few levels everywhere, commons + a couple of rares at item level 3.
  mid: { core: 4, line: 3, gear: { steelWedge: 3, scrapRecycler: 3, turbineFan: 3, packCompactor: 3, adrenalineShot: 3 } },
  // Late-game: heavily upgraded, legendary / epic gear at item level 8.
  high: { core: 10, line: 8, gear: { avalancheBlade: 8, phoenixPlating: 8, jetTurbine: 8, overclockChip: 8, repairDrone: 8 } },
};

export function levelsFor(kind: PlowKind, tier: Tier): Partial<Record<UpgradeId, number>> {
  const t = TIER_DEF[tier];
  const out: Partial<Record<UpgradeId, number>> = {};
  for (const id of ['engine', 'armor', 'packedIce', 'hopper'] as UpgradeId[]) if (t.core) out[id] = t.core;
  for (const id of LINE[kind]) if (t.line) out[id] = t.line;
  const gear: GearState = { owned: { ...t.gear }, equipped: {} };
  for (const id of Object.keys(t.gear)) gear.equipped[GEAR_BY_ID[id].slot] = id;
  for (const [id, n] of Object.entries(gearLevels(gear)) as [UpgradeId, number][]) out[id] = Math.min(UPGRADE_BY_ID[id].maxLevel, (out[id] ?? 0) + n);
  return out;
}

/** Optional stat override (breakdowns: zero one weapon and see what is left). */
let statMod: ((s: PlayerStats) => void) | null = null;
export const setStatMod = (f: typeof statMod) => (statMod = f);
export function statsFor(kind: PlowKind, tier: Tier): PlayerStats {
  const s = computeStatsFor(levelsFor(kind, tier), kind);
  statMod?.(s);
  return s;
}

/** Engagement model for the Plow-driven attacks (the sim has no snow field or driving):
 *  - the blade moves SNOW_INTAKE m^3/s of snow while fighting (about half the open-field rate), x collectRate;
 *  - slams use a ball of SLAM_BALL x max radius once it has grown (slam cycle >= SLAM_CYCLE s);
 *  - whirls go off every recharge (+ the 0.9s spin) holding a ball of WHIRL_BALL x max radius;
 *  - dashes go off every recharge (+0.5s dash) and DASH_CONNECT of them land a dash strike. */
export const MELEE = { SNOW_INTAKE: 5, SLAM_BALL: 0.8, SLAM_CYCLE: 0.82, WHIRL_BALL: 0.5, DASH_CONNECT: 0.5 } as const;
const WHIRL_TICKS = [0.1, 0.35, 0.6, 0.85];

const noop: unknown = new Proxy(() => noop, { get: () => noop, apply: () => noop });
const snow: unknown = new Proxy({}, { get: (_t, k) => (k === 'getDepth' ? () => 0 : noop) });
let nextId = 1;
/** Debug hook: every HP loss of a fake plow. */
export let damageLog: ((n: number) => void) | null = null;
export const setDamageLog = (f: typeof damageLog) => (damageLog = f);

export type Dummy = EnemyHandle & { hp: number; dealt: number };
export const dummy = (x: number, z: number, hp = 1e7): Dummy =>
  ({ id: nextId++, position: new THREE.Vector3(x, 0, z), radius: 1, hp, maxHp: hp, alive: true, dealt: 0, type: 'grunt', mass: 1, isBoss: false }) as unknown as Dummy;

type FakePlow = ReturnType<typeof fakePlow>;
function fakePlow(stats: PlayerStats, x = 0, z = 0, heading = 0) {
  const p = {
    position: new THREE.Vector3(x, 0, z), heading, hp: stats.maxHp, maxHp: stats.maxHp, dead: false, radius: 1.6,
    turretAim: 0, turretHeading: heading, hop: 0, gunFiring: false, heldBallRadius: 0, sawHalo: 0, speed: 0,
    dashing: false, whirling: false, invulnerable: false, hornSound: undefined,
    getForward: (o: THREE.Vector3) => o.set(Math.sin(p.heading), 0, Math.cos(p.heading)),
    getBladeTip: (o: THREE.Vector3) => o.set(p.position.x + Math.sin(p.heading) * 2.5, 0, p.position.z + Math.cos(p.heading) * 2.5),
    mountWorld: (_k: string, _i: number, o: THREE.Vector3) => o.set(p.position.x, 1, p.position.z),
    feedSawFury: () => {}, push: () => {}, stealSnow: () => 0, hitStop: () => {},
    damage(n: number) {
      if (p.dead || n <= 0) return;
      damageLog?.(n);
      p.hp = Math.max(0, p.hp - n);
      if (p.hp <= 0) p.dead = true;
    },
  };
  return p;
}

/** Bots in a list as an enemy manager (no armour: raw damage). */
function botManager(bots: Dummy[]) {
  return {
    bosses: [],
    query: (x: number, z: number, r: number, out: EnemyHandle[] = []) => {
      out.length = 0;
      for (const b of bots) if (b.alive && Math.hypot(b.position.x - x, b.position.z - z) <= r + b.radius) out.push(b);
      return out;
    },
    damage: (e: EnemyHandle, amount: number) => {
      const d = e as Dummy;
      if (!d.alive) return false;
      d.dealt += Math.min(amount, d.hp);
      d.hp -= amount;
      if (d.hp > 0) return false;
      (d as { alive: boolean }).alive = false;
      return true;
    },
    spawn: () => bots[0], aliveCount: () => bots.length, clear: () => {}, update: () => {},
  };
}

interface Pilot {
  c: Combat;
  /** Times (s, ctx.time) the ultimate went off. */
  ults: number[];
  stats: PlayerStats;
  plow: FakePlow;
  press: Set<string>;
  held: Set<string>;
}

function pilot(ctx: GameContext, stats: PlayerStats, plow: FakePlow, enemies: unknown): Pilot {
  const press = new Set<string>();
  const held = new Set<string>();
  const input = { throttle: 0, steer: 0, wasPressed: (k: string) => press.has(k), isDown: (k: string) => held.has(k) };
  const ults: number[] = [];
  const events = { emit: (type: string, e?: { nuke?: boolean }) => type === 'ability' && e?.nuke && ults.push(ctx.time) };
  const binding = { stats, plow, enemies, input, audio: noop, snow, events, local: false, authoritative: true, look: null } as unknown as PilotBinding;
  const c = new Combat(ctx, binding);
  c.clear();
  return { c, stats, plow, press, held, ults };
}

const newCtx = () => ({ scene: new THREE.Scene(), time: 0, fx: noop, ui: noop, impact: noop, cameraRig: noop }) as unknown as GameContext;
const crit = (c: Combat) => c as unknown as { critCharge: number };

/** The full rotation: every ability on cooldown, melee per MELEE. `ult`: 'hold' never fires the ultimate (the meter
 *  is emptied and the fill time logged instead), 'use' fires it whenever it is full. */
class Rotation {
  private slamT = 0;
  private ball = 0;
  private whirlT = 0;
  private whirlAt = -1;
  private whirlN = 0;
  private hits = new Set<number>();
  private dashT = 0;
  private dashN = 0;
  private laserT = 0;
  t = 0;
  fills: number[] = [];
  private fillStart = 0;

  constructor(private p: Pilot, private target: () => EnemyHandle | null, private ult: 'hold' | 'use') {}

  step(dt: number, ctx: GameContext): void {
    const { p } = this;
    const st = p.stats;
    const arsenal = st.plowKind === 'arsenal';
    this.t += dt;
    (ctx as { time: number }).time += dt;
    p.press.clear();
    this.drain();
    // F whenever the plow's F ability is ready ('hold': not with a full meter, which would fire the ultimate).
    if (p.c.flameReady >= 1 && (this.ult === 'use' || crit(p.c).critCharge < 1)) p.press.add('KeyF');
    if (arsenal) p.held.add('Space');
    const tgt = this.target();
    // Melee (or the laser on ARSENAL's E).
    const plow = p.plow;
    if (arsenal) {
      this.laserT -= dt;
      if (this.laserT <= 0 && p.c.fireLaser()) this.laserT = st.whirlCooldown;
    } else {
      this.ball = Math.min(ballVolume(st.maxBallRadius), this.ball + MELEE.SNOW_INTAKE * st.collectRate * dt);
      const want = ballVolume(st.maxBallRadius * MELEE.SLAM_BALL);
      this.slamT -= dt;
      if (this.slamT <= 0 && this.ball >= want && tgt && this.whirlAt < 0) {
        const r = st.maxBallRadius * MELEE.SLAM_BALL;
        p.c.slamAt(tgt.position.x, tgt.position.z, r, want);
        this.ball -= want * (1 - st.reserveFrac);
        this.slamT = MELEE.SLAM_CYCLE;
      }
      this.whirlT -= dt;
      if (this.whirlAt < 0 && this.whirlT <= 0) {
        this.whirlAt = 0;
        this.whirlN = 0;
        this.hits.clear();
      }
      if (this.whirlAt >= 0) {
        this.whirlAt += dt;
        plow.whirling = true;
        while (this.whirlN < WHIRL_TICKS.length && this.whirlAt >= WHIRL_TICKS[this.whirlN]) {
          p.c.whirlTick(plow.position.x, plow.position.z, st.whirlRadius, st.maxBallRadius * MELEE.WHIRL_BALL, this.whirlN, this.whirlN === 3, this.hits);
          this.whirlN++;
        }
        if (this.whirlN >= WHIRL_TICKS.length) {
          this.whirlAt = -1;
          plow.whirling = false;
          this.whirlT = st.whirlCooldown;
        }
      }
    }
    this.dashT -= dt;
    if (this.dashT <= 0) {
      this.dashT = st.dashCooldown + 0.5;
      this.dashN++;
      if (tgt && this.dashN * MELEE.DASH_CONNECT >= 1) {
        this.dashN = 0;
        plow.dashing = true;
        p.c.playerRam(tgt, 15);
        plow.dashing = false;
      }
    }
  }
  /** 'hold': a full meter (or an ultimate that slipped out) counts as one fill, and the meter starts over. */
  drain(): void {
    if (this.ult !== 'hold') return;
    const c = crit(this.p.c);
    if (c.critCharge >= 1 || this.p.ults.length) {
      this.fills.push(this.t - this.fillStart);
      this.fillStart = this.t;
      c.critCharge = 0;
      this.p.ults.length = 0;
    }
  }
}

const DT = 1 / 60;
/** Ahead of the plow: inside every melee / F-ability reach (whirl 4 m + bot radius). */
const NEAR = 4.5;

function botRig(kind: PlowKind, tier: Tier, bots: Dummy[], ult: 'hold' | 'use' = 'hold') {
  const ctx = newCtx();
  const stats = statsFor(kind, tier);
  const plow = fakePlow(stats);
  const p = pilot(ctx, stats, plow, botManager(bots));
  const rot = new Rotation(p, () => bots.find((b) => b.alive) ?? null, ult);
  const dead = new Map<Dummy, number>();
  const run = (s: number) => {
    for (let i = 0, n = Math.round(s / DT); i < n; i++) {
      // Wrecked bots are replaced at their spot after RESPAWN s (the next one walking in).
      for (const b of bots) {
        if (b.alive) continue;
        const t = (dead.get(b) ?? 0) + DT;
        dead.set(b, t);
        if (t >= RESPAWN) {
          dead.delete(b);
          b.hp = b.maxHp;
          (b as { alive: boolean }).alive = true;
        }
      }
      rot.step(DT, ctx);
      p.c.update(DT);
      p.press.clear();
      rot.drain();
    }
  };
  return { ctx, p, rot, run, stats };
}

const total = (bots: Dummy[]) => bots.reduce((s, b) => s + b.dealt, 0);

/** Sustained single-target DPS vs a stationary dummy (ultimate held back), over `seconds` after a warm-up. */
export function singleDps(kind: PlowKind, tier: Tier, seconds = 60): number {
  const bots = [dummy(0, NEAR)];
  const r = botRig(kind, tier, bots);
  r.run(seconds);
  return total(bots) / seconds;
}

/** Cluster of 6 bots ahead of the plow: total DPS across all of them (ultimate held back). */
export function clusterDps(kind: PlowKind, tier: Tier, seconds = 60): number {
  const bots = [dummy(0, NEAR), dummy(2.5, 6), dummy(-2.5, 6), dummy(0, 8), dummy(3, 3), dummy(-3, 3)];
  const r = botRig(kind, tier, bots);
  r.run(seconds);
  return total(bots) / seconds;
}

/** Representative fight: bot HP per tier (zone 1 brutes and spinners / mid zones and rivals / late hard zones), and
 *  the seconds before a wrecked bot's replacement is in reach. */
export const FIGHT_HP: Record<Tier, number> = { fresh: 80, mid: 200, high: 500 };
const RESPAWN = 1;

/** Seconds of the full rotation to fill the ultimate meter in a representative fight: five finite-HP bots in reach
 *  (wrecked ones replaced after RESPAWN s), so overkill counts for nothing, as in the game. */
export function ultFill(kind: PlowKind, tier: Tier, seconds = 300): number {
  const hp = FIGHT_HP[tier];
  const bots = [dummy(0, NEAR, hp), dummy(2.5, 6.5, hp), dummy(-2.5, 6.5, hp), dummy(3, 3, hp), dummy(-3, 3, hp)];
  const r = botRig(kind, tier, bots);
  r.run(seconds);
  const f = r.rot.fills;
  return f.length ? f.reduce((a, b) => a + b, 0) / f.length : Infinity;
}

/** Seconds to fill the ultimate meter on one huge-HP target (a boss): nothing is overkill, so this is the
 *  damage-limited end of the range. */
export function ultFillBoss(kind: PlowKind, tier: Tier, seconds = 120): number {
  const r = botRig(kind, tier, [dummy(0, NEAR)]);
  r.run(seconds);
  const f = r.rot.fills;
  return f.length ? f.reduce((a, b) => a + b, 0) / f.length : Infinity;
}

/** Ultimate damage vs 8 bots spread 3..17 m around the plow: the ultimate (and its aftermath) minus the same window
 *  without it (auras etc). Returns total damage and how many bots it touched. */
export function ultDamage(kind: PlowKind, tier: Tier, window = 8): { total: number; hit: number } {
  const spread = () => [3, 5, 7, 9, 11, 13, 15, 17].map((d, i) => dummy(Math.sin(i * 2.4) * d, Math.cos(i * 2.4) * d));
  const once = (fire: boolean) => {
    const ctx = newCtx();
    const bots = spread();
    const stats = statsFor(kind, tier);
    const p = pilot(ctx, stats, fakePlow(stats), botManager(bots));
    for (let i = 0, n = Math.round(window / DT); i < n; i++) {
      (ctx as { time: number }).time += DT;
      p.press.clear();
      if (fire && i === 0) {
        crit(p.c).critCharge = 1;
        p.press.add('KeyF');
      }
      p.c.update(DT);
    }
    return bots;
  };
  const a = once(true);
  const b = once(false);
  return { total: total(a) - total(b), hit: a.filter((x, i) => x.dealt > b[i].dealt + 1).length };
}

/** Duel: `atk` (full rotation, ultimate used when full) vs a parked, same-tier `def` plow facing it, through the
 *  real Duel damage path (OpponentTarget -> victim Combat.hitPlow). Returns seconds to kill (Infinity past `cap`). */
export function duelTtk(atk: PlowKind, def: PlowKind, tier: Tier, cap = 60, only?: 'gun'): number {
  const ctx = newCtx();
  const sa = statsFor(atk, tier);
  const sd = statsFor(def, tier);
  const pa = fakePlow(sa, 0, 0, 0);
  const pd = fakePlow(sd, 0, NEAR + 0.6, Math.PI);
  let cd: Pilot | null = null;
  const target = new OpponentTarget(new PlowHandle(2, pd as unknown as Plow), () => cd!.c, () => sa, () => pa as unknown as Plow);
  target.enabled = true;
  const A = pilot(ctx, sa, pa, target);
  cd = pilot(ctx, sd, pd, { query: (_x: number, _z: number, _r: number, o: EnemyHandle[] = []) => ((o.length = 0), o), damage: () => false });
  const rot = only ? null : new Rotation(A, () => target.handle, 'use');
  for (let i = 0, n = Math.round(cap / DT); i < n; i++) {
    if (rot) rot.step(DT, ctx);
    else {
      (ctx as { time: number }).time += DT;
      A.held.add('Space');
    }
    A.c.update(DT);
    A.press.clear();
    cd.c.update(DT);
    target.update(DT);
    if (pd.dead) return (i + 1) * DT;
  }
  return Infinity;
}

/** Duel: HP the ARSENAL minigun alone takes off a same-tier `def` plow in `seconds` of held fire (the default Classic
 *  has no shield to soak the first rounds). */
export function duelGunDamage(tier: Tier, seconds = 2, def: PlowKind = 'classic'): number {
  const ctx = newCtx();
  const sa = statsFor('arsenal', tier);
  const sd = statsFor(def, tier);
  const pa = fakePlow(sa, 0, 0, 0);
  const pd = fakePlow(sd, 0, NEAR + 0.6, Math.PI);
  pd.hp = 1e6;
  let cd: Pilot | null = null;
  const target = new OpponentTarget(new PlowHandle(2, pd as unknown as Plow), () => cd!.c, () => sa, () => pa as unknown as Plow);
  target.enabled = true;
  const A = pilot(ctx, sa, pa, target);
  cd = pilot(ctx, sd, pd, { query: (_x: number, _z: number, _r: number, o: EnemyHandle[] = []) => ((o.length = 0), o), damage: () => false });
  A.held.add('Space');
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    (ctx as { time: number }).time += DT;
    A.c.update(DT);
    cd.c.update(DT);
    target.update(DT);
  }
  return 1e6 - pd.hp;
}
