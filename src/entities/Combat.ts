import * as THREE from 'three';
import { Lightning } from '../fx/Lightning';
import { ballVolume, type CombatAPI, type EnemyHandle, type GameContext, type ImpactKind, type ImpactOpts } from '../core/types';
import { LAST_STAND_HP } from '../config/upgrades';
import { ctxPilot, type PilotBinding } from './pilot';
import { NP } from '../net/protocol';
import { Reach, Threat, _fwd, _p, _q, _tip, bodyBand, heightOk, waveHits, BLAST_BAND, type CastOrigin, type CombatHost } from './combat/shared';
import { Ultimates } from './combat/ultimates';
import { BURN_VULN, ClassicKit } from './combat/classic';
import { VoltKit } from './combat/volt';
import { BruteKit, ironHide } from './combat/brute';
import { IsotopeKit, RAD_VULN } from './combat/isotope';
import { ArsenalKit } from './combat/arsenal';
import { MeleeKit } from './combat/melee';
import { AirKit } from './combat/air';

/** Seconds of damage i-frames after the plow is hit (overlapping hits only add their excess). */
const IFRAME_SECONDS = 0.15;
const SECOND_WIND_GUARD = 1.5;
/** cos(60°): attacker must be within ±60° of the plow's front for the ball to shield. */
const SHIELD_COS = 0.5;
/** Smallest held ball that still works as a shield. */
const SHIELD_MIN_R = 0.2;
/** m^3 of ball snow lost per point of damage blocked. */
const BLOCK_SNOW_PER_DMG = 0.04;

/** Share of camera shake / kick a duel opponent's attacks cause on this screen (no hit-stop at all). */
const REMOTE_SHAKE = 0.35;
const REMOTE_IMPACT: ImpactOpts = { stop: false, falloff: 0.5 };

/**
 * All melee damage math for the player and the bots. Combat owns the bound pilot, the defensive pipeline (hitPlow),
 * the shared hit hooks (onPlayerHit, hitMult), the shared ultimate meter and duel net sync; each plow's abilities
 * live in a kit under ./combat/ that reaches back through a narrow CombatHost.
 */
export class Combat implements CombatAPI {
  private ctx: GameContext;
  /** Whose plow / stats / input / targets this Combat resolves (ctxPilot = the single-player singletons). */
  private b: PilotBinding;
  private iframe = 0;
  /** Second Wind: invulnerable window left, and when it can trigger again (ctx.time). */
  private guardT = 0;
  private secondWindReadyAt = 0;
  /** Largest final damage already applied during the current i-frame window. */
  private iframeDmg = 0;
  private lastBlockSound = -10;
  private queryOut: EnemyHandle[] = [];
  private targets: EnemyHandle[] = [];
  /** ISOTOPE Critical Mass / FIRESTORM / ultimate meter (one slot, one net field). */
  private critCharge = 0;
  /** Recent damage each bot dealt this pilot (decays; ARSENAL targeting reads it). */
  private threat = new Threat();

  /** Lightning bolts (VOLT-9 and the ultimates); the Plow also uses this for its coil arcs. */
  readonly lightning: Lightning;
  private readonly classic: ClassicKit;
  private readonly volt: VoltKit;
  private readonly brute: BruteKit;
  private readonly isotope: IsotopeKit;
  private readonly arsenal: ArsenalKit;
  private readonly melee: MeleeKit;
  /** Stomps, the air slam and BRUTUS's air pound (landing attacks). */
  private readonly air: AirKit;
  private readonly ult: Ultimates;

  constructor(ctx: GameContext, binding?: PilotBinding) {
    this.ctx = ctx;
    this.b = binding ?? ctxPilot(ctx);
    const host = this.makeHost();
    // Scene order kept: flame cone, lightning, fallout pools, ARSENAL fx, fire field.
    this.classic = new ClassicKit(host);
    this.lightning = new Lightning(ctx.scene);
    this.isotope = new IsotopeKit(host);
    this.arsenal = new ArsenalKit(host);
    this.classic.buildField();
    this.volt = new VoltKit(host);
    this.brute = new BruteKit(host);
    this.melee = new MeleeKit(host);
    this.air = new AirKit(host, this.brute);
    this.ult = new Ultimates(host, { volt: this.volt, brute: this.brute, arsenal: this.arsenal });
  }

  private makeHost(): CombatHost {
    const c = this;
    return {
      ctx: this.ctx,
      get b() {
        return c.b;
      },
      get lightning() {
        return c.lightning;
      },
      threat: this.threat,
      get crit() {
        return c.critCharge;
      },
      set crit(v: number) {
        c.critCharge = v;
      },
      get ultIdle() {
        return c.ult.idle;
      },
      startUlt: (kind, plow) => this.ult.start(kind, plow),
      shake: (i) => this.shake(i),
      impactHit: (kind, pos, strength, opts) => this.impactHit(kind, pos, strength, opts),
      smashProps: (x, z, r) => this.smashProps(x, z, r),
      collect: (x, z, r, reach, from) => this.collect(x, z, r, reach, from),
      reaches: (e, reach, from) => this.reaches(e, reach, from),
      clearTargets: () => {
        this.targets.length = 0;
      },
      hitMult: (e) => this.hitMult(e),
      lastStandMult: () => this.lastStandMult(),
      onPlayerHit: (dealt, killed, target, canChain, heal) => this.onPlayerHit(dealt, killed, target, canChain, heal),
    };
  }

  /** Re-bind to another pilot (the online Duel), or back to the single-player singletons (null). */
  bind(binding: PilotBinding | null): void {
    this.b = binding ?? ctxPilot(this.ctx);
    this.arsenal.resetNet();
    this.threat.clear();
  }

  /** Camera shake: full strength for the local pilot's own combat, a fraction for a duel opponent's. */
  private shake(intensity: number): void {
    this.ctx.fx.shake(this.b.local ? intensity : intensity * REMOTE_SHAKE);
  }

  /** Impact light / camera punch; a duel opponent's impacts never hit-stop this screen. */
  private impactHit(kind: ImpactKind, pos: THREE.Vector3, strength?: number, opts?: ImpactOpts): void {
    this.ctx.impact.hit(kind, pos, strength, this.b.local ? opts : REMOTE_IMPACT);
  }

  /* ------------------------------------------------------------------ duel netcode */

  /** Pack F-ability charge, Battery Shield, Critical Mass and Overload heat at `o` (NP layout, net/protocol.ts). */
  writeNet(out: Float32Array, o: number): void {
    const ar = this.arsenal;
    out[o + NP.fReady] = this.flameReady;
    out[o + NP.shield] = this.volt.shield;
    out[o + NP.crit] = this.critCharge;
    out[o + NP.heat] = this.volt.heatNow();
    out[o + NP.flameT] = this.classic.flameT;
    out[o + NP.poundT] = this.brute.poundT;
    out[o + NP.stormT] = this.volt.stormT;
    out[o + NP.fire] = (ar.gunsOn ? 1 : 0) | (ar.laserT > 0 ? 2 : 0);
    out[o + NP.turret] = this.b.plow ? this.b.plow.turretAim : 0;
    out[o + NP.laser] = ar.laserOff;
  }

  /** Duel guest, the opponent's puppet: follow the host's autocannon / laser / turret (visuals only). */
  readPuppet(s: Float32Array, o: number): void {
    const ar = this.arsenal;
    const bits = Math.round(s[o + NP.fire]);
    ar.netFire = bits;
    ar.netTurret = s[o + NP.turret];
    ar.netLaserOff = s[o + NP.laser];
    const laser = (bits & 2) !== 0;
    if (laser && !ar.netLaser && ar.laserT <= 0) this.fireLaser();
    ar.netLaser = laser;
  }

  /** Duel guest, own plow: adopt the host's meters. `keepF`: the pilot just pressed F locally (keep the prediction). */
  readNet(s: Float32Array, o: number, keepF: boolean): void {
    const f = s[o + NP.fReady];
    if (!keepF && f >= 0) {
      const kind = this.b.stats.plowKind;
      if (kind === 'volt') this.volt.clapCharge = f;
      else if (kind === 'brute') {
        if (this.brute.poundT < 0) this.brute.poundCharge = f;
      } else if (kind === 'isotope') this.isotope.meltCharge = f;
      else if (kind === 'arsenal') this.arsenal.missileCharge = f;
      else if (this.classic.flameT <= 0) this.classic.flameCharge = f;
    }
    this.volt.shield = s[o + NP.shield];
    this.critCharge = s[o + NP.crit];
    this.volt.clapHeat = s[o + NP.heat];
    this.volt.lastClapAt = this.ctx.time;
    // The guest hits nothing locally, so its turret follows the host's aim.
    this.arsenal.netTurret = s[o + NP.turret];
    this.arsenal.netLaserOff = s[o + NP.laser];
  }

  /** Duel guest, the opponent's puppet: re-arm the F ability so the replayed press fires it (visuals only — this
   *  Combat's targets are empty). `nuke`: ISOTOPE's Critical Mass was full, so it is the NUKE. */
  armForReplay(nuke: boolean): void {
    this.volt.clapCharge = this.brute.poundCharge = this.isotope.meltCharge = this.classic.flameCharge = this.arsenal.missileCharge = 1;
    this.classic.flameT = 0;
    if (this.brute.poundT >= 0) this.b.plow.hop = 0;
    this.brute.poundT = -1;
    this.critCharge = nuke ? 1 : 0;
    this.volt.clapHeat = 0;
  }

  /* ------------------------------------------------------------------ HUD meters */

  /** ISOTOPE Critical Mass, or the Classic Plow's FIRESTORM meter (same slot: both mean "the next F is the ultimate"). */
  get critMass(): number {
    const st = this.b.stats;
    if (st.meltDamage > 0) return this.critCharge;
    if (st.plowKind === 'classic') return st.flameDps > 0 ? this.critCharge : -1;
    if (st.plowKind === 'volt') return st.clapDamage > 0 ? this.critCharge : -1;
    if (st.plowKind === 'brute') return st.poundDamage > 0 ? this.critCharge : -1;
    if (st.plowKind === 'arsenal') return st.missileDamage > 0 ? this.critCharge : -1;
    return -1;
  }

  get shieldFrac(): number {
    const max = this.b.stats.shieldMax;
    return max > 0 ? this.volt.shield / max : -1;
  }

  get overloadHeat(): number {
    return this.volt.overloadHeat;
  }

  get overloadCost(): number {
    return this.volt.overloadCost;
  }

  get flameReady(): number {
    const st = this.b.stats;
    if (st.plowKind === 'volt') return st.clapDamage > 0 ? this.volt.clapCharge : -1;
    if (st.plowKind === 'brute') return st.poundDamage > 0 ? (this.brute.poundT >= 0 ? 0 : this.brute.poundCharge) : -1;
    if (st.plowKind === 'isotope') return st.meltDamage > 0 ? this.isotope.meltCharge : -1;
    if (st.plowKind === 'arsenal') return st.missileDamage > 0 ? this.arsenal.missileCharge : -1;
    return st.flameDps > 0 ? this.classic.flameCharge : -1;
  }

  /** Multiplier on the player's hits against `e`: burning bots take BURN_VULN x, and Last Stand adds its bonus. */
  private hitMult(e: EnemyHandle): number {
    return (this.classic.burns.has(e) ? BURN_VULN : 1) * (this.isotope.rads.has(e) ? RAD_VULN : 1) * this.lastStandMult();
  }

  /** Last Stand (pilot perk): 1 + bonus while the plow is under LAST_STAND_HP, else 1. */
  private lastStandMult(): number {
    const plow = this.b.plow;
    const bonus = this.b.stats.lastStand;
    return bonus > 0 && plow.hp < plow.maxHp * LAST_STAND_HP ? 1 + bonus : 1;
  }

  /* ------------------------------------------------------------------ bots -> plow */

  hitPlow(
    amount: number, fromX: number, fromZ: number,
    opts?: { knockback?: number; unblockable?: boolean; direct?: 'round' | 'beam'; attacker?: EnemyHandle; anyHeight?: boolean },
  ): number {
    const ctx = this.ctx;
    const plow = this.b.plow;
    const stats = this.b.stats;
    // Mid Ground Pound leap: out of reach until the slam lands.
    if (!plow || plow.dead || amount <= 0 || plow.invulnerable || this.guardT > 0 || this.brute.poundT >= 0) return 0;
    // Height rule: a bot's body / blade only reaches a plow near its own height (a plow flying over it, or on a deck
    // above, is out of reach). Non-contact hits (boss ground shockwaves, which check the wave rule themselves in
    // enemies/bosses.ts, and THE DONALD's reflected / thrown hits) come through combat/shared.ts waveHitPlow with
    // `anyHeight` (still naming the attacker for threat), so this body band never applies to them.
    const a = opts?.attacker;
    if (a && !opts?.anyHeight && !heightOk(a.position.y, plow.position.y, bodyBand(a.radius))) return 0;

    // Ground rings sit on the surface under the plow (0 on flat arenas; on a deck, the deck top); sparks and float
    // texts follow the plow's body, which is above that surface while it is airborne.
    const base = plow.surfaceY || 0;
    const body = plow.airborne ? plow.position.y : base;

    // Direction plow -> attacker.
    let dx = fromX - plow.position.x;
    let dz = fromZ - plow.position.z;
    let d = Math.hypot(dx, dz);
    plow.getForward(_fwd);
    if (d < 1e-4) {
      dx = _fwd.x;
      dz = _fwd.z;
      d = 1;
    }
    dx /= d;
    dz /= d;

    // 1) Ball shield on frontal hits.
    let dmg = amount;
    let blocked = 0;
    const r = plow.heldBallRadius;
    if (!opts?.unblockable && r >= SHIELD_MIN_R && dx * _fwd.x + dz * _fwd.z >= SHIELD_COS) {
      blocked = dmg * stats.shieldBlock;
      dmg -= blocked;
      const vol = ballVolume(r);
      if (vol > 0) plow.stealSnow(Math.min(1, (blocked * BLOCK_SNOW_PER_DMG) / vol));
    }
    // 2) Dash halves damage, whirling takes 30% less. 3) Plating, Iron Hide (scaled by speed), Last Stand.
    if (plow.dashing) dmg *= 0.5;
    if (plow.whirling) dmg *= 0.7;
    dmg *= stats.damageTaken;
    dmg = ironHide(dmg, stats, plow.speed);
    const lastStandBefore = this.lastStandMult() > 1;
    if (lastStandBefore) dmg *= 1 - stats.lastStand * 0.5;
    // Battery Shield (VOLT-9) soaks damage before HP.
    dmg = this.volt.soak(dmg);

    // i-frames: overlapping hits only deal what exceeds the biggest hit of the window. Direct weapon fire (ARSENAL
    // rounds / laser ticks) neither opens a window nor is eaten by one.
    let final = dmg;
    if (opts?.direct) {
      /* full damage */
    } else if (this.iframe > 0) {
      final = Math.max(0, dmg - this.iframeDmg);
      this.iframeDmg = Math.max(this.iframeDmg, dmg);
    } else {
      this.iframe = IFRAME_SECONDS;
      this.iframeDmg = dmg;
    }

    // Second Wind (pilot perk): a lethal hit leaves 1 HP and a short invulnerable window instead.
    if (final >= plow.hp && plow.hp > 1 && Number.isFinite(stats.secondWindCd) && ctx.time >= this.secondWindReadyAt) {
      final = Math.max(0, plow.hp - 1);
      this.secondWindReadyAt = ctx.time + stats.secondWindCd;
      this.guardT = SECOND_WIND_GUARD;
      _q.set(plow.position.x, body + 3.4, plow.position.z);
      ctx.fx.floatText(_q, 'SECOND WIND!', '#9fe6ff', 1.3);
      _q.set(plow.position.x, base + 0.1, plow.position.z);
      ctx.fx.ring(_q, 6, 0x9fe6ff);
      this.shake(0.5);
      this.b.audio.play('respawn');
    }
    if (final > 0) {
      plow.damage(final);
      plow.feedSawFury(0, final);
      if (!lastStandBefore && !plow.dead && this.lastStandMult() > 1) {
        _q.set(plow.position.x, body + 3.8, plow.position.z);
        ctx.fx.floatText(_q, 'LAST STAND!', '#ff6a3a', 1.2);
        _q.set(plow.position.x, base + 0.1, plow.position.z);
        ctx.fx.ring(_q, 5, 0xff6a3a);
      }
    }

    // Knockback away from the attacker (shield absorbs some of it).
    const kb = (opts?.knockback ?? 6) * (blocked > 0 ? 0.75 : 1);
    plow.push(-dx * kb, -dz * kb);

    // Feedback.
    const fx = ctx.fx;
    const audio = this.b.audio;
    _p.set(plow.position.x + dx * 1.5, body + 1.1, plow.position.z + dz * 1.5);
    if (blocked > 0) {
      plow.getBladeTip(_tip);
      const br = Math.max(r, 0.3);
      _q.set(_tip.x + _fwd.x * br, _tip.y + br + (this.b.snow ? this.b.snow.getDepth(_tip.x, _tip.z) : 0), _tip.z + _fwd.z * br);
      fx.burst(_q, { color: 0xffffff, count: 10 + Math.round(blocked * 0.6), speed: 5, size: 0.22, gravity: 16, life: 0.6 });
      fx.burst(_q, { color: 0xbfe6ff, count: 6, speed: 3, size: 0.14, gravity: 8, life: 0.5 });
      if (ctx.time - this.lastBlockSound > 0.08) {
        this.lastBlockSound = ctx.time;
        audio.play('block', { volume: Math.min(1, 0.5 + blocked * 0.03) });
      }
      _q.y += 1.2;
      fx.floatText(_q, 'BLOCK', '#9fe6ff', 0.75);
    }
    if (final > 0) {
      if (blocked <= 0) {
        fx.burst(_p, { color: 0xffa23a, count: 10 + Math.round(Math.min(20, final)), speed: 8, size: 0.09, gravity: 22, life: 0.4 });
        fx.burst(_p, { color: 0x8c96a4, count: 5 + Math.round(Math.min(8, final * 0.3)), speed: 4.5, size: 0.17, gravity: 20, life: 0.7 });
      }
      this.shake(THREE.MathUtils.clamp(0.15 + final * 0.016, 0.15, 0.6));
      if (this.b.local) ctx.impact.playerHit(final, fromX, fromZ);
      audio.play('plowHit', { volume: Math.min(1, (blocked > 0 ? 0.35 : 0.55) + final * 0.02), pitch: THREE.MathUtils.clamp(1.15 - final * 0.01, 0.75, 1.15) });
      _q.set(plow.position.x, body + 2.8, plow.position.z);
      fx.floatText(_q, `-${Math.round(final)}`, '#ff5a4a', 0.8 + Math.min(0.6, final * 0.015));
    } else if (blocked > 0) {
      this.shake(0.12);
    }

    if (final > 0) {
      if (a) this.threat.add(a, final);
      else this.noteThreat(fromX, fromZ, final);
    }
    this.b.events.emit('plowDamaged', { amount: final, blocked });
    return final;
  }

  /** Credit `dmg` to the bot nearest to where a hit came from, for callers that don't name the attacker (ARSENAL
   *  picks its targets by this). */
  private noteThreat(fromX: number, fromZ: number, dmg: number): void {
    this.threat.note(this.b.enemies, fromX, fromZ, dmg);
  }

  /** Recent damage `e` dealt this pilot. */
  threatOf(e: EnemyHandle): number {
    return this.threat.of(e);
  }

  /* ------------------------------------------------------------------ plow -> bots */

  playerRam(enemy: EnemyHandle, closingSpeed: number): number {
    // Rams and dash strikes are body hits: nothing when flying over the bot or it sits on a deck above / below.
    if (!this.reaches(enemy, Reach.Body)) return 0;
    return this.melee.playerRam(enemy, closingSpeed);
  }

  /** SPACE slam impact centered at (x, z) with a ball of radius `r` (volume `volume` m^3, already consumed
   *  by the plow). Damages every bot in the zone, shatters the ball. Returns the number of bots hit. */
  slamAt(x: number, z: number, r: number, volume: number): number {
    return this.melee.slamAt(x, z, r, volume);
  }

  /** One damage tick of the E whirl (see MeleeKit.whirlTick). Returns the number of bots hit this tick. */
  whirlTick(x: number, z: number, radius: number, ballR: number, tick: number, final: boolean, hitIds: Set<number>): number {
    return this.melee.whirlTick(x, z, radius, ballR, tick, final, hitIds);
  }

  /** ARSENAL laser (E; the Plow pays the whirl charge). False if the laser can't fire. */
  fireLaser(): boolean {
    return this.arsenal.fireLaser();
  }

  /** ARSENAL salvo plan for `n` missiles fired from (x, z) (see ArsenalKit.planSalvo). */
  planSalvo(n: number, x: number, z: number): (EnemyHandle | null)[] {
    return this.arsenal.planSalvo(n, x, z);
  }

  /** Break destructible props in a circle (player attacks; a duel guest's predicted attacks never do). */
  private smashProps(x: number, z: number, r: number): void {
    if (this.b.authoritative) this.ctx.world?.blastProps(x, z, r);
  }

  /** Snapshot of living enemies overlapping a circle (copied: damage() may mutate manager lists), filtered by the
   *  height rule `reach` (combat/shared.ts), judged from the plow or from a fixed cast origin `from`. */
  private collect(x: number, z: number, radius: number, reach: Reach = Reach.Any, from?: CastOrigin): EnemyHandle[] {
    const enemies = this.b.enemies;
    const out = this.targets;
    out.length = 0;
    if (!enemies) return out;
    const q = enemies.query(x, z, radius, this.queryOut);
    for (let i = 0; i < q.length; i++) if (reach === Reach.Any || this.reaches(q[i], reach, from)) out.push(q[i]);
    return out;
  }

  /** Height rule for one target vs the bound plow: Body = feet-to-feet within bodyBand; Wave / Blast = the target
   *  stands on the floor of the plow's level (within WAVE_BAND / BLAST_BAND of it; a wave started on a deck stays on
   *  it), or feet-to-feet while the plow is in the air. With `from` (persistent ground attacks: fire field, pools,
   *  quake rings) the floor where the attack was cast stands in for the plow, grounded, whatever the plow does since.
   *  Targets without a height (duel adapters, tests) sit at 0 like a flat arena. */
  private reaches(e: EnemyHandle, reach: Reach, from?: CastOrigin): boolean {
    if (reach === Reach.Any) return true;
    const ey = e.position.y;
    const band = reach === Reach.Blast ? BLAST_BAND : undefined;
    if (from) {
      if (reach === Reach.Body) return heightOk(from.y, ey, bodyBand(e.radius));
      return waveHits(this.ctx.terrain, from.y, false, e.position.x, e.position.z, ey, band, from.deck);
    }
    const plow = this.b.plow;
    if (!plow) return true;
    const py = plow.position.y;
    if (reach === Reach.Body) return heightOk(py, ey, bodyBand(e.radius));
    const deck = typeof plow.deck === 'number' ? plow.deck : -1;
    return waveHits(this.ctx.terrain, py, plow.airborne === true, e.position.x, e.position.z, ey, band, deck);
  }

  /** Pilot perks that trigger on the player's own hits: Salvage Rig lifesteal and Adrenaline refunds.
   *  `heal` = false for VOLT-9 area damage (Thunderclap blast + storm, Tesla field ticks) so the storm can't
   *  out-heal its own Overload backlash. */
  private onPlayerHit(dealt: number, killed: boolean, target?: EnemyHandle, canChain = true, heal = true): void {
    const plow = this.b.plow;
    const st = this.b.stats;
    if (plow.dead) return;
    if (dealt > 0) plow.feedSawFury(dealt, 0);
    if (dealt > 0) this.ult.feed(dealt);
    if (canChain && target && dealt > 0 && st.chainCount > 0) this.volt.chainLightning(target, dealt, heal);
    if (heal && st.lifesteal > 0 && dealt > 0) plow.hp = Math.min(plow.maxHp, plow.hp + dealt * st.lifesteal);
    if (killed && target && st.chainBlast > 0 && this.isotope.rads.has(target)) this.isotope.chainQueue.push({ x: target.position.x, y: target.position.y, z: target.position.z });
    if (killed && st.killRecharge > 0) {
      // Plow keeps its cooldown charges private; refund them through a narrow duck-typed view.
      const p = plow as unknown as { dashCharge: number; whirlCharge: number };
      p.dashCharge = Math.min(1, p.dashCharge + st.killRecharge);
      p.whirlCharge = Math.min(1, p.whirlCharge + st.killRecharge);
    }
  }

  clear(betweenRounds = false): void {
    this.lightning.clear();
    this.classic.clear();
    this.volt.clear();
    this.brute.clear();
    this.ult.clear();
    this.isotope.clear();
    this.arsenal.clear();
    this.melee.clear();
    this.air.clear();
    this.threat.clear();
    if (!betweenRounds) this.critCharge = 0;
    this.guardT = 0;
    this.secondWindReadyAt = 0;
    this.iframe = 0;
    this.iframeDmg = 0;
    this.targets.length = 0;
  }

  update(dt: number): void {
    if (this.guardT > 0) this.guardT = Math.max(0, this.guardT - dt);
    // Landings first (stomp / air slam / air pound), then a new air-slam press (the plow already moved this frame).
    this.air.update(dt);
    // Order kept from the single-file Combat: kits interleave where they always did.
    this.classic.updateFlame(dt);
    this.classic.updateBurns(dt);
    this.classic.updateFireField(dt);
    this.ult.update(dt);
    this.volt.updateClap(dt);
    this.brute.updatePound(dt);
    this.volt.updateStorm(dt);
    this.volt.updateField(dt);
    this.brute.updateSaws(dt);
    this.isotope.updateMeltdown(dt);
    this.threat.update(dt);
    this.arsenal.updateGuns(dt);
    this.arsenal.updateLaser(dt);
    this.arsenal.updateMissiles(dt);
    this.isotope.updatePools(dt);
    this.isotope.updateAura(dt);
    this.isotope.updateRads(dt);
    this.volt.updateShield(dt);
    this.lightning.update(dt);
    if (this.iframe > 0) {
      this.iframe -= dt;
      if (this.iframe <= 0) {
        this.iframe = 0;
        this.iframeDmg = 0;
      }
    }
    this.melee.prune(dt);
  }
}
