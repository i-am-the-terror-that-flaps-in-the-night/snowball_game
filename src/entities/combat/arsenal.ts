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
/** ARSENAL: the minigun turret tracks all the way round (360°); it holds fire until the barrels are within this
 *  many radians of the target, so rounds never leave sideways from a turret still swinging round. Then the burst a
 *  single press fires when the input source can't report held keys. */
const GUN_ON_TARGET = 0.35;
const GUN_BURST = 0.5;
const GUN_KNOCK = 1.5;
const TRACERS = 16;
/** Minigun rounds: tracer speed (m/s), streak length (m), random scatter at the target (m) so a burst isn't one line. */
const ROUND_SPEED = 120;
const TRACER_LEN = 3;
const ROUND_SCATTER = 0.35;
/** Muzzle flash: seconds on screen per shot. Muzzle smoke every Nth round (cheap wisps, not a puff per shot). */
const FLASH_SECONDS = 0.04;
const SMOKE_EVERY = 4;
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
  /** Rounds in flight: a short two-tone streak travelling from the muzzle to `dist` along `dir`. */
  private tracers: { mesh: THREE.Group; t: number; from: THREE.Vector3; dir: THREE.Vector3; dist: number }[] = [];
  /** Muzzle flash (flame cone + hot core) and the round counter for smoke wisps. */
  private flash!: THREE.Group;
  private flashT = 0;
  private rounds = 0;
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
    // Tracer: a thin white-hot core inside a wider orange glow, both tapering to a point at the tail (unit length
    // along +Z, head at z = 1), so a round reads as a hot streak, not a uniform beam.
    const streak = (r: number) => {
      const g = new THREE.ConeGeometry(r, 1, 6, 1, true);
      g.rotateX(Math.PI / 2); // tip -> -Z (tail), base -> +Z (head)
      g.translate(0, 0, 0.5);
      return g;
    };
    const coreGeo = streak(0.045);
    const glowGeo = streak(0.1);
    // Normal (not additive) blending: additive orange on sunlit snow washes out to white, which is what made the old
    // tracers read as pale laser pulses. Solid fire colours stay visible on any background.
    const add = (color: number, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false });
    const coreMat = add(0xffe680, 1);
    const glowMat = add(0xff6a00, 0.75);
    for (let i = 0; i < TRACERS; i++) {
      const mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(glowGeo, glowMat), new THREE.Mesh(coreGeo, coreMat));
      mesh.visible = false;
      scene.add(mesh);
      this.tracers.push({ mesh, t: 0, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0 });
    }
    // Muzzle flash: a ragged forward flame cone plus a hot core, flickered per shot (scale / roll / length).
    const flameGeo = new THREE.ConeGeometry(0.22, 0.75, 7, 1, true);
    flameGeo.rotateX(-Math.PI / 2); // tip -> +Z (out of the barrel)
    flameGeo.translate(0, 0, 0.42);
    const petalGeo = new THREE.PlaneGeometry(0.9, 0.22);
    this.flash = new THREE.Group();
    this.flash.add(new THREE.Mesh(flameGeo, add(0xff7a10, 0.9)));
    for (let i = 0; i < 2; i++) {
      const petal = new THREE.Mesh(petalGeo, add(0xffb020, 0.85));
      (petal.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
      petal.rotation.z = (i * Math.PI) / 2;
      petal.position.z = 0.08;
      this.flash.add(petal);
    }
    this.flash.add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), add(0xffe890, 1)));
    this.flash.visible = false;
    scene.add(this.flash);
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

  /** Minigun (SPACE, held): an auto-aiming turret that tracks bots all the way round (360°), alternating muzzles. A duel puppet fires when the host's snapshot says so. */
  updateGuns(dt: number): void {
    // Rounds in flight: the streak's head runs ahead at ROUND_SPEED, its tail TRACER_LEN behind, until the head lands.
    for (const tr of this.tracers) {
      if (tr.t <= 0) continue;
      tr.t += dt;
      const head = tr.t * ROUND_SPEED;
      if (head - TRACER_LEN >= tr.dist) {
        tr.t = 0;
        tr.mesh.visible = false;
        continue;
      }
      const h = Math.min(head, tr.dist);
      const tail = Math.max(0, head - TRACER_LEN);
      tr.mesh.position.copy(tr.from).addScaledVector(tr.dir, tail);
      tr.mesh.scale.z = Math.max(0.05, h - tail);
    }
    if (this.flashT > 0 && (this.flashT -= dt) <= 0) this.flash.visible = false;
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
    // 360° tracking: wait for the turret to come round before a round leaves the barrels.
    if (target && Math.abs(wrapAngle(plow.turretAim + plow.heading - plow.turretHeading)) > GUN_ON_TARGET) return;
    this.gunT += 1 / Math.max(0.5, st.gunRate);
    if (this.gunT < 0) this.gunT = 0;
    const side = (this.gunSide = 1 - this.gunSide);
    plow.mountWorld('muzzle', side, _p);
    let ex: number;
    let ez: number;
    let ey = _p.y;
    if (target) {
      ex = target.position.x + (Math.random() - 0.5) * ROUND_SCATTER;
      ez = target.position.z + (Math.random() - 0.5) * ROUND_SCATTER;
      ey = target.position.y + Math.min(1.2, target.radius * 0.6) + (Math.random() - 0.5) * ROUND_SCATTER;
      this.weaponHit(target, st.gunDamage, px, pz, GUN_KNOCK, 'round');
    } else {
      const h = plow.turretHeading;
      const hx = Math.sin(h);
      const hz = Math.cos(h);
      const t = this.b.authoritative ? (this.ctx.world?.blastPropRay(_p.x, _p.z, hx, hz, st.gunRange) ?? -1) : -1;
      const reach = t >= 0 ? t : st.gunRange;
      ex = _p.x + hx * reach;
      ez = _p.z + hz * reach;
    }
    this.fireRound(_p, _q.set(ex, ey, ez), !!target);
    this.b.audio.play('hit', { volume: 0.22, pitch: 1.7 + Math.random() * 0.2 });
    if (this.b.local) this.ctx.fx.shake(0.04);
  }

  /** One minigun round's visuals: muzzle flash, a travelling tracer, an ejected casing, the impact. */
  private fireRound(from: THREE.Vector3, to: THREE.Vector3, hit: boolean): void {
    const fx = this.ctx.fx;
    const tr = this.tracers.find((t) => t.t <= 0) ?? this.tracers.reduce((a, b) => (a.t > b.t ? a : b));
    tr.from.copy(from);
    tr.dir.subVectors(to, from);
    tr.dist = tr.dir.length();
    if (tr.dist < 1e-3) tr.dir.set(0, 0, 1);
    else tr.dir.multiplyScalar(1 / tr.dist);
    tr.t = 1e-4;
    tr.mesh.visible = true;
    tr.mesh.position.copy(from);
    tr.mesh.lookAt(_tip.copy(from).add(tr.dir));
    tr.mesh.scale.z = 0.05;
    // Muzzle flash, flickered so consecutive shots never look identical.
    const f = this.flash;
    f.visible = true;
    this.flashT = FLASH_SECONDS;
    f.position.copy(from);
    f.lookAt(_tip);
    f.rotateZ(Math.random() * Math.PI);
    const k = 0.75 + Math.random() * 0.55;
    f.scale.set(k, k, k * (0.8 + Math.random() * 0.7));
    // Brass casing kicked out of the side, and a thin smoke wisp every few rounds.
    fx.burst(from, { color: 0xd8a63a, count: 1, speed: 4, size: 0.07, gravity: 22, life: 0.45 });
    if (++this.rounds % SMOKE_EVERY === 0) fx.smoke(from, { count: 1, color: 0x9aa0a8, size: 0.18, grow: 3, life: 0.5, speed: 0.4, up: 0.8, rise: 0.6, drag: 2, opacity: 0.3 });
    // Impact: sparks kicked back toward the gun on a hit, a snow / dust puff where a miss lands.
    _fwd.copy(tr.dir).negate();
    if (hit) fx.sparks(to, _fwd, { count: 5, color: 0xffa030, speed: 9, spread: 0.6, size: 0.05, life: 0.18, gravity: 12 });
    else fx.smoke(to, { count: 1, color: 0xe6edf5, size: 0.25, grow: 2.5, life: 0.4, speed: 0.6, up: 0.6, drag: 3, opacity: 0.5 });
  }

  /** Minigun target: any bot in range (360°), favouring bots near the nose and close by, then threats. */
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
    for (const tr of this.tracers) {
      tr.t = 0;
      tr.mesh.visible = false;
    }
    this.flash.visible = false;
    this.flashT = 0;
    for (const m of this.missiles) {
      m.live = false;
      m.mesh.visible = false;
    }
  }
}
