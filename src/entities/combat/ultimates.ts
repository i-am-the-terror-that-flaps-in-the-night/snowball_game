import * as THREE from 'three';
import type { PlayerStats, PlowAPI } from '../../core/types';
import { Reach, _p, _q, _tip, castOrigin, type CastOrigin, type CombatHost, type UltKind } from './shared';

/** Ultimates for VOLT-9 / BRUTUS / ARSENAL (ISOTOPE has the NUKE, the Classic the FIRESTORM): any damage you deal
 *  fills the meter (this much fills it on a fresh plow, see ultCharge). While an ultimate and its aftermath play out,
 *  nothing refills it. */
/** ARSENAL's meter needs this much more damage against bots (its hits there are PVE_MULT x; overkill on dying bots
 *  is not counted, so it's below PVE_MULT): tuned so MISSILE STORM fills about as fast as it did before the bonus. */
const PVE_ULT = 2.2;
const ULT_CHARGE = { volt: 2700, brute: 1800, arsenal: 1200 } as const;
const ULT_NAME = { volt: '⚡ SUPERCELL', brute: '🌍 EARTHQUAKE', arsenal: '🚀 MISSILE STORM' } as const;
/** Damage that fills an ultimate meter of base size `base` (its size on a fresh plow). Damage dealt grows with every
 *  upgrade, so the meter grows with the pilot's power and with Overclock (faster abilities, more damage): it takes
 *  about as long to fill at every stage of the game. */
export const ultCharge = (st: PlayerStats, base: number) => (base * Math.max(1, st.ultPower || 1)) / Math.min(1, st.cooldownMult || 1);

/** One plow's ultimate, driven by Ultimates. */
export interface UltScript {
  /** Opening fx from (x, z); returns how long the meter stays locked (s). */
  ultStart(x: number, z: number, plow: PlowAPI): number;
  /** Advance to `t` s in; true once the ultimate is over. `from`: the floor under the plow when it was cast (ground
   *  waves that roll out over several seconds judge height from it, not from the plow's live height). */
  ultTick(t: number, dt: number, x: number, z: number, from: CastOrigin): boolean;
}

/** The SUPERCELL / EARTHQUAKE / MISSILE STORM meter and timeline (the shared meter lives on the host). */
export class Ultimates {
  /** Elapsed time (-1 = none), centre, and how long the meter stays locked. */
  private t = -1;
  private kind: UltKind = 'volt';
  private x = 0;
  private z = 0;
  private readonly from: CastOrigin = { y: 0, deck: -1 };
  private lock = 0;

  constructor(
    private readonly h: CombatHost,
    private readonly scripts: Record<UltKind, UltScript>,
  ) {}

  get idle(): boolean {
    return this.t < 0;
  }

  /** Damage you deal fills the VOLT-9 / BRUTUS / ARSENAL ultimate meter. */
  feed(dealt: number): void {
    const h = this.h;
    const kind = h.b.stats.plowKind;
    if (kind !== 'volt' && kind !== 'brute' && kind !== 'arsenal') return;
    if (this.lock > 0 || this.t >= 0) return;
    const was = h.crit;
    // ARSENAL's PvE damage bonus doesn't speed its meter up: it charges as in the Duel.
    const pve = kind === 'arsenal' && !h.b.pvp ? PVE_ULT : 1;
    h.crit = Math.min(1, h.crit + dealt / pve / ultCharge(h.b.stats, ULT_CHARGE[kind]));
    if (was < 1 && h.crit >= 1 && h.b.local) {
      h.ctx.ui.toast(`${ULT_NAME[kind]} READY · F`, 'info');
      h.b.audio.play('charge', { pitch: 0.7, volume: 0.6 });
    }
  }

  start(kind: UltKind, plow: PlowAPI): void {
    const h = this.h;
    h.crit = 0;
    h.b.events.emit('ability', { nuke: true });
    this.kind = kind;
    this.t = 0;
    this.x = plow.position.x;
    this.z = plow.position.z;
    castOrigin(plow, this.from);
    h.ctx.ui.toast(h.b.local ? `${ULT_NAME[kind]}!` : `INCOMING ${ULT_NAME[kind]}!`, 'big');
    this.lock = this.scripts[kind].ultStart(this.x, this.z, plow);
  }

  update(dt: number): void {
    if (this.lock > 0) this.lock -= dt;
    if (this.t < 0) return;
    this.t += dt;
    if (this.scripts[this.kind].ultTick(this.t, dt, this.x, this.z, this.from)) this.t = -1;
  }

  clear(): void {
    this.t = -1;
    this.lock = 0;
  }
}

/** Ultimate blast: hit every bot whose centre is between `inner` and `R` of (x, z). Returns how many. */
export function ultBlast(
  h: CombatHost,
  x: number,
  z: number,
  inner: number,
  R: number,
  dmg: number,
  o: { knock: number; stun?: number; freeze?: number; text: string; color: string; bolt?: boolean; reach?: Reach; from?: CastOrigin },
): number {
  h.smashProps(x, z, R);
  // Height rule (combat/shared.ts): ground quakes pass reach Wave (judged from their cast floor `from`); sky bolts hit
  // anything (default).
  const hits = h.collect(x, z, R, o.reach ?? Reach.Any, o.from);
  let n = 0;
  for (let i = 0; i < hits.length; i++) {
    const e = hits[i];
    if (!e.alive) continue;
    const dx = e.position.x - x;
    const dz = e.position.z - z;
    const d = Math.hypot(dx, dz);
    if (d + e.radius < inner) continue;
    const nd = d || 1;
    if (o.bolt) {
      _p.set(e.position.x + (Math.random() - 0.5) * 3, 28, e.position.z + (Math.random() - 0.5) * 3);
      _q.set(e.position.x, e.position.y + e.radius, e.position.z);
      h.lightning.bolt(_p, _q, { life: 0.35, width: 0.6, jag: 2, color: 0xbff0ff });
    }
    const hp0 = e.hp;
    const killed = h.b.enemies.damage(e, dmg * h.b.stats.damageMult * h.hitMult(e), {
      source: 'other',
      knockback: new THREE.Vector3((dx / nd) * o.knock, 0, (dz / nd) * o.knock),
      stunSeconds: o.stun,
      freezeSeconds: o.freeze,
      fromX: x,
      fromZ: z,
    });
    const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
    h.onPlayerHit(dealt, killed, e, false, false);
    if (dealt > 0) {
      _tip.set(e.position.x, e.position.y + e.radius + 1.3, e.position.z);
      h.ctx.fx.floatText(_tip, `${o.text}${Math.round(dealt)}`, o.color, 1.2);
    }
    n++;
  }
  h.clearTargets();
  return n;
}
