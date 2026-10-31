import * as THREE from 'three';
import type { EnemyHandle, PlowAPI } from '../../core/types';
import { Kit, _fwd, _p, _q, _tip, wrapAngle, type CombatHost } from './shared';
import { ultBlast, type UltScript } from './ultimates';

/** ORBITAL STRIKE (ARSENAL): marks up to ORBITAL_TARGETS top-priority bots within ORBITAL_RANGE, then after
 *  ORBITAL_DELAY a sky laser hits each — ORBITAL_MULT x missile damage in ORBITAL_RADIUS. */
const ORBITAL_TARGETS = 6;
const ORBITAL_RANGE = 50;
const ORBITAL_DELAY = 1;
const ORBITAL_MULT = 10;
const ORBITAL_RADIUS = 4.5;
/** ARSENAL: autocannon lock-on half-angle (80° either side of the nose, as a cos) and the burst a single press fires
 *  when the input source can't report held keys. */
const GUN_LOCK_HALF = 1.4;
const GUN_LOCK_COS = Math.cos(GUN_LOCK_HALF);
const GUN_BURST = 0.5;
const GUN_KNOCK = 1.5;
const TRACERS = 12;
/** Laser beam: seconds it burns, hit width (m), damage tick. */
const LASER_SECONDS = 1.5;
const LASER_WIDTH = 0.9;
const LASER_TICK = 0.1;
/** Laser tracking: the beam bends up to LASER_TRACK rad off the nose toward the top target, at LASER_SLEW rad/s. */
const LASER_TRACK = 0.4;
const LASER_SLEW = 1.6;
/** Missiles: flight speed (m/s), turn rate (1/s), blast radius (m), splash share, fuse (s). */
const MISSILES_MAX = 12;
const MISSILE_SPEED = 26;
const MISSILE_TURN = 5;
const MISSILE_BLAST = 3.2;
const MISSILE_SPLASH = 0.6;
const MISSILE_FUSE = 3.5;
const MISSILE_RANGE = 45;
/** A missile whose target dies looks for a new one within this many metres of itself. */
const MISSILE_RETARGET = 25;

type Missile = { mesh: THREE.Group; pos: THREE.Vector3; vel: THREE.Vector3; target: EnemyHandle | null; t: number; live: boolean };

/** ARSENAL: autocannon, laser, swarm missiles and the ORBITAL STRIKE (plus the duel guest's view of them). */
export class ArsenalKit extends Kit implements UltScript {
  /** Autocannon timer + burst window, alternating muzzle, tracer pool. */
  private gunT = 0;
  private gunBurstT = 0;
  private gunSide = 0;
  private tracers: { mesh: THREE.Mesh; t: number }[] = [];
  /** Laser beam time left and damage tick. */
  laserT = 0;
  private laserTickT = 0;
  private laserCore!: THREE.Mesh;
  private laserGlow!: THREE.Mesh;
  /** Swarm Missiles recharge 0..1. */
  missileCharge = 1;
  /** Is the autocannon firing this frame (snapshot bit). Laser beam yaw off the nose. */
  gunsOn = false;
  laserOff = 0;
  /** Duel guest: weapon state from host snapshots. netFire < 0 = not a puppet (own input drives the guns);
   *  netTurret NaN = aim locally. */
  netFire = -1;
  netLaser = false;
  netTurret = NaN;
  /** Duel guest: the host's laser bend (NaN = aim locally). */
  netLaserOff = NaN;
  private missiles: Missile[] = [];
  /** ORBITAL STRIKE reticles: where each lands and the bot it follows. */
  private marks: { x: number; z: number; e: EnemyHandle | null }[] = [];

  constructor(h: CombatHost) {
    super(h);
    this.buildArsenalFx(h.ctx.scene);
  }

  /** Back to driving its own guns (a re-bind). */
  resetNet(): void {
    this.netFire = -1;
    this.netLaser = false;
    this.netTurret = NaN;
    this.netLaserOff = NaN;
  }

  ultStart(x: number, z: number, plow: PlowAPI): number {
    // Paint the targets: the top threats in range by Threat.score, one mark each.
    this.marks.length = 0;
    const ranked = this.collect(x, z, ORBITAL_RANGE)
      .filter((e) => e.alive)
      .map((e) => ({ e, score: this.h.threat.score(e, x, z) }))
      .sort((p, q) => q.score - p.score);
    this.clearTargets();
    for (const { e } of ranked.slice(0, ORBITAL_TARGETS)) this.marks.push({ x: e.position.x, z: e.position.z, e });
    // Nothing to hit: strike straight ahead.
    if (!this.marks.length) {
      plow.getForward(_fwd);
      this.marks.push({ x: x + _fwd.x * 12, z: z + _fwd.z * 12, e: null });
    }
    this.b.audio.play('charge', { pitch: 1.3, volume: 0.8 });
    return ORBITAL_DELAY + 1;
  }

  ultTick(t: number, dt: number): boolean {
    // Reticles follow their targets and tighten until the strike lands.
    const k = Math.min(1, t / ORBITAL_DELAY);
    for (const m of this.marks) {
      if (m.e?.alive) {
        m.x = m.e.position.x;
        m.z = m.e.position.z;
      }
      if (Math.random() < dt * 14) {
        _q.set(m.x, 0.12, m.z);
        this.ctx.fx.ring(_q, ORBITAL_RADIUS * (1.6 - k), 0xff3030);
      }
    }
    if (t < ORBITAL_DELAY) return false;
    for (const m of this.marks) this.orbitalStrike(m.x, m.z);
    this.marks.length = 0;
    return true;
  }

  /** ORBITAL STRIKE: a sky laser column onto (x, z). */
  private orbitalStrike(x: number, z: number): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    for (let k = 0; k < 3; k++) {
      _p.set(x + (Math.random() - 0.5) * 0.6, 40, z + (Math.random() - 0.5) * 0.6);
      _q.set(x, 0.1, z);
      this.lightning.bolt(_p, _q, { life: 0.45, width: 1.4 - k * 0.4, jag: 0.15, color: k === 0 ? 0xff2020 : 0xffe0e0 });
    }
    _q.set(x, 0.12, z);
    ctx.fx.ring(_q, ORBITAL_RADIUS, 0xff3030);
    ctx.fx.ring(_q, ORBITAL_RADIUS * 1.3, 0xffb0a0);
    _q.set(x, 1, z);
    ctx.fx.burst(_q, { color: 0xff4020, count: 30, speed: 12, size: 0.35, gravity: -2, life: 0.6 });
    ctx.fx.burst(_q, { color: 0x2c2628, count: 10, speed: 3, size: 1, gravity: -2.5, life: 1.2 });
    this.b.snow?.melt(x, z, ORBITAL_RADIUS * 0.8, 1);
    this.shake(0.6);
    this.impactHit('nuke', _q, 0.6);
    this.b.audio.play('explosion', { volume: 0.8, pitch: 1.1 });
    ultBlast(this.h, x, z, 0, ORBITAL_RADIUS, st.missileDamage * ORBITAL_MULT, { knock: 14, text: '🛰', color: '#ff8a7a' });
  }

  private buildArsenalFx(scene: THREE.Scene): void {
    const trGeo = new THREE.BoxGeometry(0.07, 0.07, 1);
    trGeo.translate(0, 0, 0.5);
    const trMat = new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < TRACERS; i++) {
      const mesh = new THREE.Mesh(trGeo, trMat);
      mesh.visible = false;
      scene.add(mesh);
      this.tracers.push({ mesh, t: 0 });
    }
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    beamGeo.rotateX(Math.PI / 2);
    beamGeo.translate(0, 0, 0.5);
    this.laserCore = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xfff0f0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.laserGlow = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    for (const m of [this.laserCore, this.laserGlow]) {
      m.visible = false;
      m.renderOrder = 3;
      scene.add(m);
    }
    const bodyGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.7, 8);
    bodyGeo.rotateX(Math.PI / 2);
    const noseGeo = new THREE.ConeGeometry(0.09, 0.22, 8);
    noseGeo.rotateX(Math.PI / 2);
    noseGeo.translate(0, 0, 0.46);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.4, metalness: 0.3 });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0xd8262a, roughness: 0.4 });
    const fireMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const fireGeo = new THREE.ConeGeometry(0.08, 0.5, 8);
    fireGeo.rotateX(-Math.PI / 2);
    fireGeo.translate(0, 0, -0.6);
    for (let i = 0; i < MISSILES_MAX; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(bodyGeo, bodyMat), new THREE.Mesh(noseGeo, noseMat), new THREE.Mesh(fireGeo, fireMat));
      g.visible = false;
      scene.add(g);
      this.missiles.push({ mesh: g, pos: new THREE.Vector3(), vel: new THREE.Vector3(), target: null, t: 0, live: false });
    }
  }

  /** One weapon hit from ARSENAL (player credit). `direct`: rapid single-target fire (rounds, laser ticks), see
   *  DamageOpts.direct. Returns damage dealt. */
  private weaponHit(e: EnemyHandle, amount: number, fromX: number, fromZ: number, knock: number, direct?: 'round' | 'beam'): number {
    if (!e.alive) return 0;
    const dx = e.position.x - fromX;
    const dz = e.position.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    const hp0 = e.hp;
    const killed = this.b.enemies.damage(e, amount * this.b.stats.damageMult * this.hitMult(e), {
      source: 'other',
      knockback: new THREE.Vector3((dx / d) * knock, 0, (dz / d) * knock),
      fromX,
      fromZ,
      direct,
    });
    const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
    this.onPlayerHit(dealt, killed, e);
    return dealt;
  }

  /** Autocannon (SPACE, held): twin auto-aiming cannons on a turret that locks up to 80° either side of the nose,
   *  alternating muzzles. A duel puppet fires when the host's snapshot says so. */
  updateGuns(dt: number): void {
    for (const tr of this.tracers) {
      if (tr.t <= 0) continue;
      tr.t -= dt;
      if (tr.t <= 0) tr.mesh.visible = false;
    }
    const st = this.b.stats;
    const plow = this.b.plow;
    this.gunsOn = false;
    if (plow) plow.gunFiring = false;
    if (st.gunDamage <= 0 || !plow) return;
    if (this.gunT > 0) this.gunT -= dt;
    if (plow.dead) return;
    const input = this.b.input;
    let firing: boolean;
    if (this.netFire >= 0) firing = (this.netFire & 1) !== 0;
    else {
      if (input.wasPressed('Space')) this.gunBurstT = GUN_BURST;
      else if (this.gunBurstT > 0) this.gunBurstT -= dt;
      firing = this.gunBurstT > 0 || !!input.isDown?.('Space');
    }
    this.gunsOn = firing;
    plow.gunFiring = firing;
    const px = plow.position.x;
    const pz = plow.position.z;
    const target = this.gunTarget(px, pz, plow.heading, st.gunRange);
    // Turret tracks the target (or settles forward); a duel guest copies the host's aim.
    if (!Number.isNaN(this.netTurret)) plow.turretAim = this.netTurret;
    else if (target) plow.turretAim = wrapAngle(Math.atan2(target.position.x - px, target.position.z - pz) - plow.heading);
    else plow.turretAim = 0;
    if (!firing || this.gunT > 0) return;
    this.gunT += 1 / Math.max(0.5, st.gunRate);
    if (this.gunT < 0) this.gunT = 0;
    const side = (this.gunSide = 1 - this.gunSide);
    plow.mountWorld('muzzle', side, _p);
    let ex: number;
    let ez: number;
    let ey = _p.y;
    if (target) {
      ex = target.position.x;
      ez = target.position.z;
      ey = target.position.y + Math.min(1.2, target.radius * 0.6);
      this.weaponHit(target, st.gunDamage, px, pz, GUN_KNOCK, 'round');
      _q.set(ex, ey, ez);
      this.ctx.fx.burst(_q, { color: 0xffd060, count: 4, speed: 6, size: 0.12, gravity: 10, life: 0.25 });
    } else {
      const h = plow.turretHeading;
      const hx = Math.sin(h);
      const hz = Math.cos(h);
      const t = this.b.authoritative ? (this.ctx.world?.blastPropRay(_p.x, _p.z, hx, hz, st.gunRange) ?? -1) : -1;
      const reach = t >= 0 ? t : st.gunRange;
      ex = _p.x + hx * reach;
      ez = _p.z + hz * reach;
    }
    const tr = this.tracers.find((t) => t.t <= 0) ?? this.tracers[0];
    tr.t = 0.06;
    tr.mesh.visible = true;
    tr.mesh.position.copy(_p);
    _q.set(ex, ey, ez);
    tr.mesh.lookAt(_q);
    tr.mesh.scale.set(1, 1, Math.max(0.5, _p.distanceTo(_q)));
    this.ctx.fx.burst(_p, { color: 0xffe08a, count: 3, speed: 4, size: 0.18, gravity: 0, life: 0.08 });
    this.b.audio.play('hit', { volume: 0.22, pitch: 1.7 + Math.random() * 0.2 });
    if (this.b.local) this.ctx.fx.shake(0.04);
  }

  /** Autocannon target: inside the lock cone and range, favouring bots near the nose and close by, then threats. */
  private gunTarget(x: number, z: number, heading: number, range: number): EnemyHandle | null {
    const hits = this.collect(x, z, range);
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    let best: EnemyHandle | null = null;
    let bestCost = Infinity;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      const dx = e.position.x - x;
      const dz = e.position.z - z;
      const d = Math.hypot(dx, dz);
      if (d > range + e.radius) continue;
      const cos = d > e.radius ? (dx * fx + dz * fz) / d : 1;
      if (cos < GUN_LOCK_COS) continue;
      // Off-nose bots cost up to 2x their distance; a bot that has been hurting you gets pulled forward.
      const cost = d * (1.5 - 0.5 * cos) - 0.1 * this.h.threat.of(e);
      if (cost < bestCost) {
        bestCost = cost;
        best = e;
      }
    }
    this.clearTargets();
    return best;
  }

  /** ARSENAL laser (E; the Plow pays the whirl charge). False if the laser can't fire. */
  fireLaser(): boolean {
    const st = this.b.stats;
    if (st.laserDps <= 0 || this.laserT > 0) return false;
    this.laserT = LASER_SECONDS;
    this.laserTickT = 0;
    this.laserOff = 0;
    this.b.audio.play('zap', { pitch: 0.45, volume: 0.9 });
    this.b.audio.play('charge', { pitch: 1.6, volume: 0.5 });
    return true;
  }

  /** Where the laser wants to point, as a yaw off the nose: the top-priority bot within reach and LASER_TRACK (plus a
   *  little slack so a bot just outside still pulls the beam to the edge), or straight ahead. */
  private laserAim(x: number, z: number, heading: number, range: number): number {
    const hits = this.collect(x, z, range);
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      const dx = e.position.x - x;
      const dz = e.position.z - z;
      const d = Math.hypot(dx, dz);
      if (d > range + e.radius || d < 0.5) continue;
      const off = wrapAngle(Math.atan2(dx, dz) - heading);
      if (Math.abs(off) > LASER_TRACK + 0.25) continue;
      const score = this.h.threat.score(e, x, z);
      if (score > bestScore) {
        bestScore = score;
        best = THREE.MathUtils.clamp(off, -LASER_TRACK, LASER_TRACK);
      }
    }
    this.clearTargets();
    return best;
  }

  updateLaser(dt: number): void {
    const plow = this.b.plow;
    if (this.laserT <= 0) return;
    this.laserT -= dt;
    if (this.laserT <= 0 || !plow || plow.dead) {
      this.laserT = 0;
      this.laserCore.visible = this.laserGlow.visible = false;
      return;
    }
    const st = this.b.stats;
    const R = st.laserRange;
    plow.mountWorld('laser', 0, _p);
    // The beam bends toward its target, but only so far and so fast: steering still does most of the aiming.
    // A duel guest hits nothing locally: it follows the host's bend instead of aiming.
    const want = Number.isNaN(this.netLaserOff) ? this.laserAim(_p.x, _p.z, plow.heading, R) : this.netLaserOff;
    const step = LASER_SLEW * dt;
    this.laserOff += THREE.MathUtils.clamp(want - this.laserOff, -step, step);
    const h = plow.heading + this.laserOff;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    _q.set(_p.x + fx * R, _p.y, _p.z + fz * R);
    const flick = 0.85 + Math.random() * 0.3;
    const fade = Math.min(1, this.laserT / 0.2, (LASER_SECONDS - this.laserT) / 0.08 + 0.2);
    for (const [m, w] of [[this.laserCore, 0.09], [this.laserGlow, 0.32]] as const) {
      m.visible = true;
      m.position.copy(_p);
      m.lookAt(_q);
      m.scale.set(w * flick * fade, w * flick * fade, R);
    }
    // Sparks + scorched snow along the beam.
    const k = Math.random();
    _tip.set(_p.x + fx * R * k, 0.5, _p.z + fz * R * k);
    this.ctx.fx.burst(_tip, { color: Math.random() < 0.5 ? 0xff4030 : 0xffd0c0, count: 2, speed: 4, size: 0.16, gravity: -3, life: 0.3 });
    this.b.snow.melt(_p.x + fx * R * 0.5, _p.z + fz * R * 0.5, 1.2, 0.6 * dt);
    this.b.snow.melt(_p.x + fx * R * k, _p.z + fz * R * k, 1.2, 1.2 * dt);
    if (this.b.local) this.ctx.fx.shake(0.05);
    this.laserTickT -= dt;
    if (this.laserTickT > 0) return;
    this.laserTickT = LASER_TICK;
    if (this.b.authoritative) this.ctx.world?.blastPropRay(_p.x, _p.z, fx, fz, R);
    const hits = this.collect(_p.x + fx * R * 0.5, _p.z + fz * R * 0.5, R * 0.5 + 2);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      const dx = e.position.x - _p.x;
      const dz = e.position.z - _p.z;
      const along = dx * fx + dz * fz;
      if (along < -e.radius || along > R + e.radius) continue;
      if (Math.abs(dx * fz - dz * fx) > LASER_WIDTH + e.radius) continue;
      const dealt = this.weaponHit(e, st.laserDps * LASER_TICK, _p.x, _p.z, 2, 'beam');
      if (dealt > 0 && Math.random() < 0.35) {
        _tip.set(e.position.x, e.position.y + e.radius + 1, e.position.z);
        this.ctx.fx.floatText(_tip, `${Math.round(dealt)}`, '#ff6a5a', 0.7);
      }
    }
    this.clearTargets();
  }

  /** Damage one missile does to `e` (direct hit), for working out how many it takes. */
  private missileHitOn(e: EnemyHandle): number {
    return Math.max(1, this.b.stats.missileDamage * this.b.stats.damageMult * this.hitMult(e));
  }

  /** Live missiles already flying at `e`. */
  private inFlight(e: EnemyHandle): number {
    let n = 0;
    for (const m of this.missiles) if (m.live && m.target === e) n++;
    return n;
  }

  /**
   * Target list for a salvo of `n` missiles. Bots are ranked by Threat.score (damage they've dealt you first), and
   * each gets as many missiles as its HP needs, minus the ones already flying at it; leftovers go round the ranked
   * list again (overkill on the biggest threats). Several missiles can share a target.
   */
  planSalvo(n: number, x: number, z: number): (EnemyHandle | null)[] {
    const hits = this.collect(x, z, MISSILE_RANGE);
    const ranked: { e: EnemyHandle; score: number; need: number }[] = [];
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive || Math.hypot(e.position.x - x, e.position.z - z) > MISSILE_RANGE + e.radius) continue;
      const per = this.missileHitOn(e);
      const need = Math.max(0, Math.ceil(Math.max(0, e.hp) / per) - this.inFlight(e));
      ranked.push({ e, score: this.h.threat.score(e, x, z), need });
    }
    this.clearTargets();
    ranked.sort((a, b) => b.score - a.score);
    const out: (EnemyHandle | null)[] = [];
    for (const r of ranked) {
      for (let k = 0; k < r.need && out.length < n; k++) out.push(r.e);
      if (out.length >= n) break;
    }
    for (let i = 0; out.length < n && ranked.length; i++) out.push(ranked[i % ranked.length].e);
    while (out.length < n) out.push(null);
    return out;
  }

  /** Swarm Missiles (F on ARSENAL): a salvo from the pods, spread over targets by planSalvo. */
  updateMissiles(dt: number): void {
    const st = this.b.stats;
    const plow = this.b.plow;
    this.flyMissiles(dt);
    if (st.missileDamage <= 0 || !plow || plow.dead) return;
    if (this.missileCharge < 1) this.missileCharge = Math.min(1, this.missileCharge + (st.missileCooldown > 0 ? dt / st.missileCooldown : 1));
    if (!this.b.input.wasPressed('KeyF')) return;
    if (this.h.crit >= 1 && this.h.ultIdle) return this.h.startUlt('arsenal', plow);
    if (this.missileCharge < 1) {
      this.b.audio.play('error');
      return;
    }
    this.missileCharge = 0;
    this.b.events.emit('ability', { nuke: false });
    this.b.audio.play('burst', { pitch: 1.4, volume: 0.8 });
    this.b.audio.play('dash', { pitch: 1.6, volume: 0.6 });
    const px = plow.position.x;
    const pz = plow.position.z;
    const plan = this.planSalvo(Math.min(MISSILES_MAX, st.missileCount), px, pz);
    for (let i = 0; i < plan.length; i++) {
      const m = this.missiles.find((x) => !x.live);
      if (!m) break;
      plow.mountWorld('pod', i * 5 + (i >> 1), m.pos);
      const side = m.pos.x - px;
      const sideZ = m.pos.z - pz;
      const sl = Math.hypot(side, sideZ) || 1;
      m.vel.set((side / sl) * 6 + Math.sin(plow.heading) * 6, 11 + Math.random() * 3, (sideZ / sl) * 6 + Math.cos(plow.heading) * 6);
      m.target = plan[i];
      m.t = 0;
      m.live = true;
      m.mesh.visible = true;
      m.mesh.position.copy(m.pos);
      this.ctx.fx.burst(m.pos, { color: 0xd8dde2, count: 4, speed: 3, size: 0.4, gravity: -1, life: 0.6 });
    }
  }

  /** A missile lost its target: the best-scoring bot near it that still needs missiles, else the best near it. */
  private retarget(m: Missile): EnemyHandle | null {
    const hits = this.collect(m.pos.x, m.pos.z, MISSILE_RETARGET);
    let best: EnemyHandle | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      const covered = this.inFlight(e) * this.missileHitOn(e) >= e.hp;
      const score = this.h.threat.score(e, m.pos.x, m.pos.z) - (covered ? 1000 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    this.clearTargets();
    return best;
  }

  private flyMissiles(dt: number): void {
    for (const m of this.missiles) {
      if (!m.live) continue;
      m.t += dt;
      if (m.target && !m.target.alive) m.target = this.retarget(m);
      const tgt = m.target;
      if (m.t > 0.25) {
        if (tgt) {
          _q.set(tgt.position.x, tgt.position.y + Math.min(1, tgt.radius * 0.5), tgt.position.z).sub(m.pos).normalize().multiplyScalar(MISSILE_SPEED);
        } else {
          // Nothing to chase: keep going and nose down.
          _q.copy(m.vel).setY(0).normalize().multiplyScalar(MISSILE_SPEED);
          _q.y = -8;
        }
        m.vel.lerp(_q, Math.min(1, MISSILE_TURN * dt * (0.4 + m.t)));
      } else m.vel.y -= 10 * dt;
      m.pos.addScaledVector(m.vel, dt);
      _p.copy(m.pos).add(m.vel);
      m.mesh.position.copy(m.pos);
      m.mesh.lookAt(_p);
      if (Math.random() < dt * 40) this.ctx.fx.burst(m.pos, { color: Math.random() < 0.3 ? 0xffa040 : 0xc8ccd2, count: 1, speed: 0.6, size: 0.35, gravity: -1.5, life: 0.5 });
      const hitTarget = tgt && Math.hypot(tgt.position.x - m.pos.x, tgt.position.z - m.pos.z) < tgt.radius + 0.4 && m.pos.y < tgt.position.y + tgt.radius * 2 + 1;
      if (hitTarget || m.pos.y <= 0.15 || m.t > MISSILE_FUSE) this.explodeMissile(m, tgt);
    }
  }

  private explodeMissile(m: Missile, direct: EnemyHandle | null): void {
    m.live = false;
    m.mesh.visible = false;
    const st = this.b.stats;
    const x = m.pos.x;
    const z = m.pos.z;
    _q.set(x, Math.max(0.5, m.pos.y), z);
    this.ctx.fx.burst(_q, { color: 0xff8a20, count: 18, speed: 9, size: 0.35, gravity: -2, life: 0.5 });
    this.ctx.fx.burst(_q, { color: 0x3a3634, count: 6, speed: 2, size: 0.8, gravity: -2, life: 1 });
    this.ctx.fx.ring(_q.set(x, 0.15, z), MISSILE_BLAST, 0xffb040);
    this.b.audio.play('explosion', { volume: 0.45, pitch: 1.2 + Math.random() * 0.2 });
    this.shake(0.18);
    this.b.snow.melt(x, z, MISSILE_BLAST * 0.6, 0.6);
    this.smashProps(x, z, MISSILE_BLAST);
    const hits = this.collect(x, z, MISSILE_BLAST);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      const full = e === direct;
      const dealt = this.weaponHit(e, st.missileDamage * (full ? 1 : MISSILE_SPLASH), x, z, full ? 9 : 6);
      if (dealt > 0) {
        _tip.set(e.position.x, e.position.y + e.radius + 1.2, e.position.z);
        this.ctx.fx.floatText(_tip, `🚀${Math.round(dealt)}`, '#ffb060', 0.9);
      }
    }
    this.clearTargets();
  }

  clear(): void {
    this.marks.length = 0;
    this.missileCharge = 1;
    this.gunT = this.gunBurstT = 0;
    this.gunsOn = false;
    this.laserT = 0;
    this.laserOff = 0;
    this.netLaser = false;
    this.laserCore.visible = this.laserGlow.visible = false;
    for (const tr of this.tracers) tr.mesh.visible = false;
    for (const m of this.missiles) {
      m.live = false;
      m.mesh.visible = false;
    }
  }
}
