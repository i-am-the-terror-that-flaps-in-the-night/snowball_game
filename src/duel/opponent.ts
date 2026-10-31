import { PLOW_MASS, type DamageOpts, type EnemyHandle, type EnemyManagerAPI, type EnemyType, type PlayerStats } from '../core/types';
import { BRAWL_HIT_CAP, brawlHit } from '../config/brawl';
import { DUEL_DAMAGE_SCALE } from '../config/duel';
import type { Plow } from '../entities/Plow';
import type { Combat } from '../entities/Combat';

/** A human plow seen through the bot interface, so every player attack in Combat (slam, ram, dash strike, whirl,
 *  Inferno, Thunderclap, Ground Pound, Meltdown, NUKE, auras, chains) can target it unchanged. */
export class PlowHandle implements EnemyHandle {
  readonly type: EnemyType = 'rival';
  readonly mass = PLOW_MASS;
  readonly isBoss = false;

  constructor(
    readonly id: number,
    readonly plow: Plow,
  ) {}

  get position() {
    return this.plow.position;
  }
  get radius(): number {
    return this.plow.radius;
  }
  get hp(): number {
    return this.plow.hp;
  }
  set hp(_v: number) {
    /* damage only goes through OpponentTarget.damage -> the victim's Combat.hitPlow */
  }
  get maxHp(): number {
    return this.plow.maxHp;
  }
  get alive(): boolean {
    return !this.plow.dead;
  }
}

/** One landed hit, for the host's event stream (float text / sound / knockback on the guest). */
export interface DuelHit {
  /** Final HP lost (after shield, armour, Battery Shield, i-frames). */
  final: number;
  source: NonNullable<DamageOpts['source']>;
  fromX: number;
  fromZ: number;
  /** Knockback applied (m/s, horizontal). */
  kx: number;
  kz: number;
  /** Hit-stop applied to the victim (s). */
  stop: number;
}

/** Ability damage diminishing returns: once this share of the victim's max HP landed recently, further ability hits
 *  do half; the memory decays with this time constant (s). */
const ABILITY_BURST_FRAC = 0.2;
const ABILITY_BURST_SECONDS = 1.5;
/** Scale from a bot-style knockback impulse to the plow push Combat.hitPlow applies. */
const KNOCK_SCALE = 0.7;

/**
 * The "enemy manager" a duel pilot's Combat attacks: just the opponent's plow. Damage is scaled by DUEL_DAMAGE_SCALE,
 * then takes the Brawl hit cap
 * (BRAWL_HIT_CAP + the attacker's Wrecking Ball, as in Brawl) so nothing one-shots, then goes through the VICTIM's
 * Combat.hitPlow, which applies their ball shield, dash / whirl reductions, armour, Iron Hide, Last Stand,
 * Battery Shield, Second Wind and i-frames — the same path bots use against the player.
 */
export class OpponentTarget implements EnemyManagerAPI {
  readonly bosses: readonly EnemyHandle[] = [];
  /** Off during countdowns / between rounds. */
  enabled = false;
  onHit: ((h: DuelHit) => void) | null = null;
  private out: EnemyHandle[] = [];
  /** Recent F-ability / passive ('other') damage on this victim, decaying (see ABILITY_BURST_*). */
  private burst = 0;
  private hit: DuelHit = { final: 0, source: 'other', fromX: 0, fromZ: 0, kx: 0, kz: 0, stop: 0 };

  constructor(
    readonly handle: PlowHandle,
    private victimCombat: () => Combat,
    private attackerStats: () => PlayerStats,
    private attackerPlow: () => Plow,
  ) {}

  spawn(): EnemyHandle {
    return this.handle;
  }

  query(x: number, z: number, radius: number, out?: EnemyHandle[]): EnemyHandle[] {
    const res = out ?? this.out;
    res.length = 0;
    const h = this.handle;
    if (!this.enabled || !h.alive) return res;
    const p = h.position;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < radius + h.radius) res.push(h);
    return res;
  }

  damage(enemy: EnemyHandle, amount: number, opts?: DamageOpts): boolean {
    const victim = this.handle.plow;
    if (!this.enabled || enemy !== this.handle || victim.dead || !(amount > 0)) return false;
    let scaled = amount * DUEL_DAMAGE_SCALE;
    // Area kits tuned for crowds (Thunderclap's storm strikes, burns, fallout pools, auras) all land on the one
    // human target: repeated ability damage in a short window has diminishing returns.
    const other = (!opts?.source || opts.source === 'other') && opts?.direct !== 'round';
    if (other) scaled /= 1 + this.burst / (ABILITY_BURST_FRAC * victim.maxHp);
    const raw = brawlHit(scaled, victim.maxHp, BRAWL_HIT_CAP + this.attackerStats().hitCapBonus);
    // Direction: along the knockback if there is one, else away from the attacker.
    const k = opts?.knockback;
    const kmag = k ? Math.hypot(k.x, k.z) : 0;
    let fromX: number;
    let fromZ: number;
    if (k && kmag > 0.1) {
      fromX = victim.position.x - (k.x / kmag) * 2;
      fromZ = victim.position.z - (k.z / kmag) * 2;
    } else {
      const a = this.attackerPlow().position;
      fromX = opts?.fromX ?? a.x;
      fromZ = opts?.fromZ ?? a.z;
      if (Math.hypot(fromX - victim.position.x, fromZ - victim.position.z) < 0.5) {
        fromX = a.x;
        fromZ = a.z;
      }
    }
    const kb = kmag > 0.1 ? kmag * KNOCK_SCALE : 2;
    const hp0 = victim.hp;
    const final = this.victimCombat().hitPlow(raw, fromX, fromZ, { knockback: kb, unblockable: opts?.source === 'whirl', direct: opts?.direct });
    if (other) this.burst += final;
    let stop = 0;
    if (final > 0 && !victim.dead) {
      // Ground Pound stuns and Thunderclap / Frost Core shocks freeze a plow briefly (bots get the full stun).
      if (opts?.stunSeconds) stop = Math.min(0.5, opts.stunSeconds * 0.35);
      else if (opts?.freezeSeconds && opts.freezeSeconds >= 1) stop = 0.15;
      if (stop > 0) victim.hitStop(stop);
    }
    if (final > 0 || hp0 !== victim.hp) {
      const h = this.hit;
      h.final = final;
      h.source = opts?.source ?? 'other';
      h.fromX = fromX;
      h.fromZ = fromZ;
      let dx = victim.position.x - fromX;
      let dz = victim.position.z - fromZ;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d;
      dz /= d;
      h.kx = dx * kb;
      h.kz = dz * kb;
      h.stop = stop;
      this.onHit?.(h);
    }
    return victim.dead;
  }

  aliveCount(): number {
    return this.handle.alive ? 1 : 0;
  }

  clear(): void {
    /* nothing to despawn */
  }

  /** Decay the ability-burst meter (call every sim frame). */
  update(dt = 0): void {
    if (this.burst > 0) this.burst *= Math.exp(-dt / ABILITY_BURST_SECONDS);
  }

  /** New round: forget recent damage. */
  reset(): void {
    this.burst = 0;
  }
}

/** Nothing to hit (a duel guest's predicting / replaying Combats): attacks play their effects and deal nothing. */
export const NO_TARGETS: EnemyManagerAPI = {
  bosses: [],
  spawn: () => {
    throw new Error('no spawning in a duel');
  },
  query: (_x, _z, _r, out) => {
    const res = out ?? [];
    res.length = 0;
    return res;
  },
  damage: () => false,
  aliveCount: () => 0,
  clear: () => {},
  update: () => {},
};
