import * as THREE from 'three';
import type { EnemyHandle, PlowAPI } from '../../core/types';
import { Kit, _fwd, _p, _q, _tip, wrapAngle, type CombatHost } from './shared';
import { ultBlast, type UltScript } from './ultimates';
import { makeSurface } from '../../world/Terrain';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MissileTrail } from './missileTrail';

/** MISSILE STORM (ARSENAL's ultimate): ULT_MISSILES heavy missiles ripple out of the pods ULT_RIPPLE s apart and are
 *  spread over the top threats within ULT_RANGE (a normal salvo reaches MISSILE_RANGE), the same way planSalvo spreads
 *  a normal salvo. Each hits for ULT_MULT x missile damage in a ULT_BLAST m blast, flies a little faster (ULT_SPEED)
 *  and burns longer (ULT_FUSE) to cover the range. The ultimate lasts until the last one lands (ULT_MAX_T cap). */
const ULT_MISSILES = 20;
const ULT_RANGE = 75;
const ULT_RIPPLE = 0.05;
const ULT_MULT = 3;
const ULT_BLAST = 4.2;
const ULT_SPEED = 36;
const ULT_FUSE = 7;
const ULT_MAX_T = 9;
/** Storm missiles boost straight up for this long after leaving the pod (s), then pitch over onto their targets. */
const ULT_BOOST = 0.55;
/** Storm missiles turn this much harder than salvo missiles (they pitch over from vertical at speed). */
const ULT_TURN = 2;
/** Ult missiles are drawn a bit bigger than salvo missiles. */
const ULT_SCALE = 1.25;
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
const LASER_SLEW = 1.6;
/** Missiles: flight speed (m/s), turn rate (1/s), blast radius (m), splash share, fuse (s). */
/** Minigun elevation limits (rad) and how fast the barrels tilt. Targets outside the band are skipped (the gun can't
 *  reach a bot straight above it on a deck). Line of sight through terrain / decks is required when terrain exists. */
const GUN_PITCH_MIN = -35 * (Math.PI / 180);
const GUN_PITCH_MAX = 45 * (Math.PI / 180);
const GUN_PITCH_SLEW = 2.5;
/** Muzzle height above the plow's feet used for aim maths. */
const GUN_HEIGHT = 1.4;
/** Laser: may bend up to LASER_CONE off the nose in ANY direction (left / right / up), but not below LASER_PITCH_MIN. */
const LASER_CONE = 80 * (Math.PI / 180);
const LASER_PITCH_MIN = -15 * (Math.PI / 180);
/** Missiles re-check line of sight to their target this often (s); when a deck is in the way they fly round its edge. */
const MISSILE_LOS_EVERY = 0.2;

const MISSILES_MAX = 12;
/** Missile meshes: a full salvo plus a full MISSILE STORM can be in the air at once. */
const MISSILE_POOL = MISSILES_MAX + ULT_MISSILES;
/** Missile flight: ejected from the pod with no thrust for MISSILE_EJECT s, then the motor lights and it accelerates
 *  along its nose from MISSILE_V0 to MISSILE_SPEED (m/s). It turns at most MISSILE_TURN rad/s (more as it slows near
 *  the end), so it flies wide arcs and can overshoot a target that jinks. Guidance leads the target and lofts: it
 *  climbs to MISSILE_LOFT m above the line while far away, then dives in. Pods fire in a ripple, MISSILE_RIPPLE apart. */
const MISSILE_EJECT = 0.16;
const MISSILE_V0 = 9;
const MISSILE_SPEED = 30;
const MISSILE_ACCEL = 70;
const MISSILE_TURN = 3.6;
const MISSILE_TURN_LATE = 6;
/** Terminal homing: inside this range (m) the seeker turns up to MISSILE_TERMINAL x harder, so close targets get hit
 *  instead of orbited (turn radius at full speed is ~speed / turn rate). */
const MISSILE_TERMINAL_RANGE = 12;
const MISSILE_TERMINAL = 2.6;
const MISSILE_LOFT = 5;
const MISSILE_RIPPLE = 0.07;
/** Proximity fuse (m from the target's centre on top of its radius). */
const MISSILE_PROX = 1.3;
/** Smoke puffs per second along the trail while the motor burns. */
const MISSILE_SMOKE = 8;
/** Missile body: half-length (m) from the centre to the nozzle (the trail starts there). */
const MISSILE_TAIL = 0.78;
const MISSILE_BLAST = 3.2;
const MISSILE_SPLASH = 0.6;
const MISSILE_FUSE = 4.5;
const MISSILE_RANGE = 45;
/** A missile whose target dies looks for a new one within this many metres of itself. */
const MISSILE_RETARGET = 25;

type Missile = {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  target: EnemyHandle | null;
  t: number;
  live: boolean;
  /** Detour point round a deck between the missile and its target (null = fly straight at it). */
  via: THREE.Vector3 | null;
  losT: number;
  /** Nose direction (unit) and airspeed once the motor is lit; `lit` flips at the end of the eject phase. */
  fwd: THREE.Vector3;
  speed: number;
  lit: boolean;
  /** Seconds until this missile leaves its pod (ripple fire); the missile is hidden until then. */
  delay: number;
  /** Target position last frame (lead estimate) and a per-missile wobble phase. */
  last: THREE.Vector3;
  wob: number;
  smokeT: number;
  /** Which pod tube it fires from (mountWorld index). */
  pod: number;
  /** The exhaust flame (scaled / flickered while lit) and the exhaust + smoke trail. */
  flame: THREE.Object3D;
  trail: MissileTrail;
  /** A MISSILE STORM missile (ultimate): heavier hit, bigger blast, faster, longer fuse. */
  ult: boolean;
};

/** What launch() needs from the plow: where it is and its pod tubes. */
type PodHost = { position: THREE.Vector3; heading: number; mountWorld(kind: 'pod', i: number, out: THREE.Vector3): THREE.Vector3 };

const _a = new THREE.Vector3();
const _hit = { t: 0, x: 0, y: 0, z: 0, what: 'ground' as 'ground' | number };
const _surf = makeSurface();

/** ARSENAL: autocannon, laser, swarm missiles and the MISSILE STORM (plus the duel guest's view of them). */
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
  /** Laser beam pitch (rad, + up) and the minigun barrels' elevation (rad, + up; the Plow tilts the barrels with it). */
  laserPitch = 0;
  gunPitch = 0;
  /** Duel guest: weapon state from host snapshots. netFire < 0 = not a puppet (own input drives the guns);
   *  netTurret NaN = aim locally. */
  netFire = -1;
  netLaser = false;
  netTurret = NaN;
  /** Duel guest: the host's laser bend (NaN = aim locally). */
  netLaserOff = NaN;
  private missiles: Missile[] = [];

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

  /** MISSILE STORM: every pod empties, ULT_MISSILES heavy missiles spread over the top threats within ULT_RANGE. */
  ultStart(x: number, z: number): number {
    const pods = this.b.plow;
    if (pods) this.launch(this.planSalvo(ULT_MISSILES, x, z, ULT_RANGE, ULT_MULT), pods, true);
    this.b.audio.play('burst', { pitch: 1.1, volume: 1 });
    this.b.audio.play('charge', { pitch: 1.5, volume: 0.7 });
    this.shake(0.25);
    // The meter can't refill while the storm is still flying anyway (Ultimates.feed), so only a short lock after.
    return 1;
  }

  /** Over once every storm missile has landed (or ULT_MAX_T passed). */
  ultTick(t: number): boolean {
    if (t > ULT_MAX_T) return true;
    for (const m of this.missiles) if (m.live && m.ult) return false;
    return true;
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
    // A proper missile: ~1.6 m long, slim body, pointed nose, red band, four tail fins, nozzle flame.
    const bodyGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.3, 10);
    bodyGeo.rotateX(Math.PI / 2);
    const noseGeo = new THREE.ConeGeometry(0.12, 0.42, 10);
    noseGeo.rotateX(Math.PI / 2);
    noseGeo.translate(0, 0, 0.86);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.4, metalness: 0.3 });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0xd8262a, roughness: 0.4 });
    const fireMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const fireGeo = new THREE.ConeGeometry(0.13, 1.0, 10);
    fireGeo.rotateX(-Math.PI / 2);
    fireGeo.translate(0, 0, -1.15);
    // Four tail fins (two crossed plates).
    const finA = new THREE.BoxGeometry(0.62, 0.025, 0.34);
    const finB = new THREE.BoxGeometry(0.025, 0.62, 0.34);
    finA.translate(0, 0, -0.5);
    finB.translate(0, 0, -0.5);
    const finGeo = mergeGeometries([finA, finB]);
    finA.dispose();
    finB.dispose();
    for (let i = 0; i < MISSILE_POOL; i++) {
      const g = new THREE.Group();
      const flame = new THREE.Mesh(fireGeo, fireMat);
      g.add(new THREE.Mesh(bodyGeo, bodyMat), new THREE.Mesh(noseGeo, noseMat), new THREE.Mesh(finGeo, bodyMat), flame);
      g.visible = false;
      scene.add(g);
      this.missiles.push({
        mesh: g, pos: new THREE.Vector3(), vel: new THREE.Vector3(), target: null, t: 0, live: false, via: null, losT: 0,
        fwd: new THREE.Vector3(0, 0, 1), speed: 0, lit: false, delay: 0, last: new THREE.Vector3(), wob: i * 1.7, smokeT: 0, pod: 0, flame,
        trail: new MissileTrail(scene), ult: false,
      });
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
    const py = plow.position.y + GUN_HEIGHT;
    const target = this.gunTarget(px, py, pz, plow.heading, st.gunRange);
    // Turret tracks the target (or settles forward); a duel guest copies the host's aim.
    if (!Number.isNaN(this.netTurret)) plow.turretAim = this.netTurret;
    else if (target) plow.turretAim = wrapAngle(Math.atan2(target.position.x - px, target.position.z - pz) - plow.heading);
    else plow.turretAim = 0;
    // Barrels tilt toward the target's chest (limited band, limited speed).
    const wantPitch = target ? this.pitchTo(px, py, pz, target) || 0 : 0;
    const pstep = GUN_PITCH_SLEW * dt;
    this.gunPitch += THREE.MathUtils.clamp(wantPitch - this.gunPitch, -pstep, pstep);
    if (!firing || this.gunT > 0) return;
    // 360° tracking: wait for the turret to come round (and the barrels to lift) before a round leaves the barrels.
    if (target && Math.abs(wrapAngle(plow.turretAim + plow.heading - plow.turretHeading)) > GUN_ON_TARGET) return;
    if (target && Math.abs(wantPitch - this.gunPitch) > GUN_ON_TARGET) return;
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
      const cp = Math.cos(this.gunPitch);
      const hx = Math.sin(h);
      const hz = Math.cos(h);
      const t = this.b.authoritative ? (this.ctx.world?.blastPropRay(_p.x, _p.z, hx, hz, st.gunRange) ?? -1) : -1;
      let reach = t >= 0 ? t : st.gunRange;
      // Rounds stop at the first ramp, deck or hill in the way.
      const ter = this.ctx.terrain;
      if (ter?.active) {
        const hit = ter.raycast(_p.x, _p.y, _p.z, hx * cp, Math.sin(this.gunPitch), hz * cp, reach, _hit);
        if (hit) reach = hit.t;
      }
      ex = _p.x + hx * cp * reach;
      ez = _p.z + hz * cp * reach;
      ey = _p.y + Math.sin(this.gunPitch) * reach;
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

  /**
   * Elevation (rad) from a muzzle at (x, y, z) to the best point on a bot's body within [min, max]: its chest when
   * that is in the band, else the nearest reachable part of it (a bot hugging the plow sits below the muzzle but its
   * top is still in reach). NaN when no part of the bot is inside the band.
   */
  private pitchTo(x: number, y: number, z: number, e: EnemyHandle, min = GUN_PITCH_MIN, max = GUN_PITCH_MAX): number {
    const d = Math.max(0.5, Math.hypot(e.position.x - x, e.position.z - z) - e.radius * 0.5);
    const lo = Math.atan2(e.position.y - y, d);
    const hi = Math.atan2(e.position.y + Math.min(2.4, e.radius * 1.2) - y, d);
    if (hi < min || lo > max) return NaN;
    const chest = Math.atan2(e.position.y + Math.min(1.2, e.radius * 0.6) - y, d);
    return Math.min(Math.min(hi, max), Math.max(Math.max(lo, min), chest));
  }

  /** Can a weapon at (x, y, z) see the bot (terrain / decks in the way)? Always true on flat arenas. */
  private canSee(x: number, y: number, z: number, e: EnemyHandle): boolean {
    const ter = this.ctx.terrain;
    if (!ter?.active) return true;
    return ter.lineOfSight(x, y, z, e.position.x, e.position.y + Math.min(1.2, e.radius * 0.6), e.position.z);
  }

  /** Minigun target: any bot in range (360°) within the barrels' elevation band and in sight, favouring bots near the
   *  nose and close by, then threats. */
  private gunTarget(x: number, y: number, z: number, heading: number, range: number): EnemyHandle | null {
    const hits = this.collect(x, z, range);
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    let best: EnemyHandle | null = null;
    let bestCost = Infinity;
    for (let pass = 0; pass < 3; pass++) {
      best = null;
      bestCost = Infinity;
      for (let i = 0; i < hits.length; i++) {
        const e = hits[i];
        if (!e.alive) continue;
        const dx = e.position.x - x;
        const dz = e.position.z - z;
        const d = Math.hypot(dx, dz);
        if (d > range + e.radius) continue;
        if (Number.isNaN(this.pitchTo(x, y, z, e))) continue;
        const cos = d > e.radius ? (dx * fx + dz * fz) / d : 1;
        // Off-nose bots cost up to 2x their distance; a bot that has been hurting you gets pulled forward.
        const cost = d * (1.5 - 0.5 * cos) - 0.1 * this.h.threat.of(e);
        if (cost < bestCost) {
          bestCost = cost;
          best = e;
        }
      }
      // Line of sight only for the winner (one raycast); a hidden winner drops out and the next best gets a look.
      if (!best || this.canSee(x, y, z, best)) break;
      const k = hits.indexOf(best);
      hits.splice(k, 1);
      best = null;
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
    this.laserPitch = 0;
    this.b.audio.play('zap', { pitch: 0.45, volume: 0.9 });
    this.b.audio.play('charge', { pitch: 1.6, volume: 0.5 });
    return true;
  }

  /** Where the laser wants to point: the top-priority visible bot within reach and within LASER_CONE of the nose in any
   *  direction (3D: up onto decks, across at jumping bots, not below LASER_PITCH_MIN), as a yaw off the nose and a
   *  pitch. Writes into this.aimYaw / this.aimPitch; straight ahead when nothing qualifies. */
  private aimYaw = 0;
  private aimPitch = 0;
  private laserAim(x: number, y: number, z: number, heading: number, range: number): void {
    const hits = this.collect(x, z, range);
    this.aimYaw = 0;
    this.aimPitch = 0;
    let bestScore = -Infinity;
    const cosCone = Math.cos(LASER_CONE);
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      const dx = e.position.x - x;
      const dz = e.position.z - z;
      const d = Math.hypot(dx, dz);
      if (d > range + e.radius || d < 0.5) continue;
      const pitch = this.pitchTo(x, y, z, e, LASER_PITCH_MIN, LASER_CONE);
      if (Number.isNaN(pitch)) continue;
      // Inside the 80° cone: the 3D angle between the nose and the aim direction.
      if (((dx * fx + dz * fz) / d) * Math.cos(pitch) < cosCone) continue;
      const score = this.h.threat.score(e, x, z);
      if (score <= bestScore || !this.canSee(x, y, z, e)) continue;
      bestScore = score;
      this.aimYaw = wrapAngle(Math.atan2(dx, dz) - heading);
      this.aimPitch = pitch;
    }
    this.clearTargets();
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
    let want = this.netLaserOff;
    let wantPitch = 0;
    if (Number.isNaN(want)) {
      this.laserAim(_p.x, _p.y, _p.z, plow.heading, R);
      want = this.aimYaw;
      wantPitch = this.aimPitch;
    }
    const step = LASER_SLEW * dt;
    this.laserOff += THREE.MathUtils.clamp(want - this.laserOff, -step, step);
    this.laserPitch += THREE.MathUtils.clamp(wantPitch - this.laserPitch, -step, step);
    const h = plow.heading + this.laserOff;
    const cp = Math.cos(this.laserPitch);
    const sp = Math.sin(this.laserPitch);
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    // The beam stops at the first deck, ramp or hill it meets.
    let L = R;
    const ter = this.ctx.terrain;
    if (ter?.active) {
      const hit = ter.raycast(_p.x, _p.y, _p.z, fx * cp, sp, fz * cp, R, _hit);
      if (hit) L = Math.max(0.5, hit.t);
    }
    _q.set(_p.x + fx * cp * L, _p.y + sp * L, _p.z + fz * cp * L);
    const flick = 0.85 + Math.random() * 0.3;
    const fade = Math.min(1, this.laserT / 0.2, (LASER_SECONDS - this.laserT) / 0.08 + 0.2);
    for (const [m, w] of [[this.laserCore, 0.09], [this.laserGlow, 0.32]] as const) {
      m.visible = true;
      m.position.copy(_p);
      m.lookAt(_q);
      m.scale.set(w * flick * fade, w * flick * fade, L);
    }
    // Sparks along the beam + where it lands; scorched snow only while it runs along the ground.
    const k = Math.random();
    _tip.set(_p.x + fx * cp * L * k, _p.y + sp * L * k, _p.z + fz * cp * L * k);
    this.ctx.fx.burst(_tip, { color: Math.random() < 0.5 ? 0xff4030 : 0xffd0c0, count: 2, speed: 4, size: 0.16, gravity: -3, life: 0.3 });
    if (L < R) this.ctx.fx.burst(_q, { color: 0xffd0c0, count: 2, speed: 6, size: 0.12, gravity: 4, life: 0.25 });
    const grounded = Math.abs(this.laserPitch) < 0.2;
    if (grounded) {
      this.b.snow.melt(_p.x + fx * L * 0.5, _p.z + fz * L * 0.5, 1.2, 0.6 * dt);
      this.b.snow.melt(_p.x + fx * L * k, _p.z + fz * L * k, 1.2, 1.2 * dt);
    }
    if (this.b.local) this.ctx.fx.shake(0.05);
    this.laserTickT -= dt;
    if (this.laserTickT > 0) return;
    this.laserTickT = LASER_TICK;
    if (this.b.authoritative && grounded) this.ctx.world?.blastPropRay(_p.x, _p.z, fx, fz, L);
    // Hits: bots whose chest is within LASER_WIDTH of the 3D beam segment.
    const dirX = fx * cp;
    const dirY = sp;
    const dirZ = fz * cp;
    const hits = this.collect(_p.x + dirX * L * 0.5, _p.z + dirZ * L * 0.5, L * 0.5 + 2);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      const dx = e.position.x - _p.x;
      const dy = e.position.y + Math.min(1.2, e.radius * 0.6) - _p.y;
      const dz = e.position.z - _p.z;
      const along = dx * dirX + dy * dirY + dz * dirZ;
      if (along < -e.radius || along > L + e.radius) continue;
      const ox = dx - dirX * along;
      const oy = dy - dirY * along;
      const oz = dz - dirZ * along;
      if (Math.hypot(ox, oy, oz) > LASER_WIDTH + e.radius) continue;
      const dealt = this.weaponHit(e, st.laserDps * LASER_TICK, _p.x, _p.z, 2, 'beam');
      if (dealt > 0 && Math.random() < 0.35) {
        _tip.set(e.position.x, e.position.y + e.radius + 1, e.position.z);
        this.ctx.fx.floatText(_tip, `${Math.round(dealt)}`, '#ff6a5a', 0.7);
      }
    }
    this.clearTargets();
  }

  /** Damage one salvo missile does to `e` (direct hit), for working out how many it takes. */
  private missileHitOn(e: EnemyHandle): number {
    return Math.max(1, this.b.stats.missileDamage * this.b.stats.damageMult * this.hitMult(e));
  }

  /** Live missiles already flying at `e`, in salvo-missile hits (a storm missile counts ULT_MULT). */
  private inFlight(e: EnemyHandle): number {
    let n = 0;
    for (const m of this.missiles) if (m.live && m.target === e) n += m.ult ? ULT_MULT : 1;
    return n;
  }

  /**
   * Target list for a salvo of `n` missiles. Bots are ranked by Threat.score (damage they've dealt you first), and
   * each gets as many missiles as its HP needs, minus the ones already flying at it; leftovers go round the ranked
   * list again (overkill on the biggest threats). Several missiles can share a target. `range`: how far out bots are
   * picked; `mult`: each missile's hit in salvo-missile hits (MISSILE STORM missiles hit harder, and spread first).
   */
  planSalvo(n: number, x: number, z: number, range = MISSILE_RANGE, mult = 1): (EnemyHandle | null)[] {
    const hits = this.collect(x, z, range);
    const ranked: { e: EnemyHandle; score: number; need: number }[] = [];
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive || Math.hypot(e.position.x - x, e.position.z - z) > range + e.radius) continue;
      const per = this.missileHitOn(e);
      const need = Math.max(0, Math.ceil((Math.max(0, e.hp) / per - this.inFlight(e)) / mult));
      ranked.push({ e, score: this.h.threat.score(e, x, z), need });
    }
    this.clearTargets();
    ranked.sort((a, b) => b.score - a.score);
    const out: (EnemyHandle | null)[] = [];
    // A storm (mult > 1) first spreads evenly (no target gets more than its share until every target has had one),
    // so one tanky bot can't soak the whole ultimate; then what's left goes by need as usual.
    const share = mult > 1 ? Math.max(1, Math.ceil(n / Math.max(1, ranked.length))) : Infinity;
    for (const r of ranked) {
      const k = Math.min(r.need, share, n - out.length);
      for (let j = 0; j < k; j++) out.push(r.e);
      r.need -= k;
      if (out.length >= n) break;
    }
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
    this.launch(this.planSalvo(Math.min(MISSILES_MAX, st.missileCount), plow.position.x, plow.position.z), plow, false);
  }

  /** Load one missile per plan entry into the pods and ripple them out (storm missiles faster, bigger, heavier). */
  private launch(plan: (EnemyHandle | null)[], plow: PodHost, ult: boolean): void {
    const px = plow.position.x;
    const pz = plow.position.z;
    for (let i = 0; i < plan.length; i++) {
      const m = this.missiles.find((x) => !x.live);
      if (!m) break;
      m.pod = i * 5 + (i >> 1);
      plow.mountWorld('pod', m.pod, m.pos);
      // Ejected up and out of the pod (no thrust yet), nose tipped up and outward; the motor lights after the eject.
      const side = m.pos.x - px;
      const sideZ = m.pos.z - pz;
      const sl = Math.hypot(side, sideZ) || 1;
      const fx = Math.sin(plow.heading);
      const fz = Math.cos(plow.heading);
      if (ult) {
        // Storm missiles leave near-vertical (a cold launch straight up, splayed slightly outward), then tip over toward
        // targets in any direction and rain down: from vertical no target is more than a quarter turn away.
        m.vel.set((side / sl) * 1.5, 10 + Math.random() * 2, (sideZ / sl) * 1.5);
        m.fwd.set((side / sl) * 0.18, 1, (sideZ / sl) * 0.18).normalize();
      } else {
        m.vel.set((side / sl) * 3 + fx * 4, 6 + Math.random() * 1.5, (sideZ / sl) * 3 + fz * 4);
        m.fwd.set((side / sl) * 0.35 + fx * 0.55, 0.75, (sideZ / sl) * 0.35 + fz * 0.55).normalize();
      }
      m.speed = 0;
      m.lit = false;
      m.ult = ult;
      m.delay = i * (ult ? ULT_RIPPLE : MISSILE_RIPPLE);
      m.target = plan[i];
      if (m.target) m.last.copy(m.target.position);
      m.t = 0;
      m.smokeT = 0;
      m.live = true;
      m.via = null;
      m.losT = 0;
      m.mesh.scale.setScalar(ult ? ULT_SCALE : 1);
      m.mesh.visible = false; // shown when its turn in the ripple comes
      m.flame.visible = false;
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
    const ter = this.ctx.terrain;
    const fx = this.ctx.fx;
    // Trails face the camera; headless sims (balance harness) have none, so trails are skipped there.
    const cam = this.ctx.camera?.position;
    for (const m of this.missiles) {
      if (!m.live) {
        if (cam) m.trail.update(dt, null, cam); // lingering smoke after the blast
        continue;
      }
      // Ripple fire: wait in the pod for this missile's turn, riding along with the plow.
      if (m.delay > 0) {
        m.delay -= dt;
        const plow = this.b.plow;
        if (plow) plow.mountWorld('pod', m.pod, m.pos);
        if (m.delay > 0) continue;
        m.mesh.visible = true;
        fx.burst(m.pos, { color: 0xd8dde2, count: 4, speed: 3, size: 0.4, gravity: -1, life: 0.6 });
      }
      m.t += dt;
      if (m.target && !m.target.alive) {
        m.target = this.retarget(m);
        m.via = null;
        if (m.target) m.last.copy(m.target.position);
      }
      const tgt = m.target;
      _a.copy(m.pos);
      if (!m.lit) {
        // Eject: tumbling up out of the pod under gravity, no thrust.
        m.vel.y -= 14 * dt;
        m.pos.addScaledVector(m.vel, dt);
        if (m.t >= MISSILE_EJECT) {
          // Ignition: flash + puff, the motor takes over along the nose.
          m.lit = true;
          m.speed = Math.max(MISSILE_V0, m.vel.length());
          m.flame.visible = true;
          m.trail.start(_tip.copy(m.pos).addScaledVector(m.fwd, -MISSILE_TAIL));
          fx.burst(m.pos, { color: 0xffc060, count: 6, speed: 5, size: 0.25, gravity: 0, life: 0.18 });
          fx.smoke(m.pos, { count: 2, color: 0xd6dade, size: 0.5, grow: 2.5, life: 0.9, speed: 1, up: 0.2, drag: 3, opacity: 0.55 });
        }
      } else {
        // Guidance: aim point = detour round a deck, else the target's predicted position (lead) lofted while far.
        // Storm missiles first finish their vertical boost (climbing, leaning a little toward the target).
        if (m.ult && m.t < ULT_BOOST) {
          const dx = tgt ? tgt.position.x - m.pos.x : m.fwd.x;
          const dz = tgt ? tgt.position.z - m.pos.z : m.fwd.z;
          const dl = Math.hypot(dx, dz) || 1;
          _q.set(m.pos.x + (dx / dl) * 3, m.pos.y + 12, m.pos.z + (dz / dl) * 3);
          if (tgt) m.last.copy(tgt.position);
        } else if (tgt) {
          if (ter?.active && ter.decks.length && (m.losT -= dt) <= 0) {
            m.losT = MISSILE_LOS_EVERY;
            m.via = this.missileDetour(m, tgt);
          }
          if (m.via && m.pos.distanceTo(m.via) < 2.5) m.via = null;
          if (m.via) _q.copy(m.via);
          else {
            const ty = tgt.position.y + Math.min(1, tgt.radius * 0.5);
            const dist = Math.hypot(tgt.position.x - m.pos.x, ty - m.pos.y, tgt.position.z - m.pos.z);
            const tgo = dist / Math.max(1, m.speed);
            // Target velocity from its motion since last frame (no velocity on EnemyHandle), capped.
            const vx = THREE.MathUtils.clamp((tgt.position.x - m.last.x) / Math.max(dt, 1e-3), -20, 20);
            const vz = THREE.MathUtils.clamp((tgt.position.z - m.last.z) / Math.max(dt, 1e-3), -20, 20);
            const loft = MISSILE_LOFT * THREE.MathUtils.smoothstep(dist, 10, 30);
            _q.set(tgt.position.x + vx * tgo * 0.8, ty + loft, tgt.position.z + vz * tgo * 0.8);
          }
          m.last.copy(tgt.position);
        } else {
          // Nothing to chase: fly on, nose slowly dropping.
          _q.copy(m.pos).addScaledVector(m.fwd, 10);
          _q.y -= 4;
        }
        // Turn the nose toward the aim point at a limited rate (wide arcs, can overshoot), plus a slight wobble.
        _tip.subVectors(_q, m.pos).normalize();
        const late = THREE.MathUtils.clamp((m.t - 1.2) / 1.5, 0, 1);
        const toAim = m.pos.distanceTo(_q);
        const terminal = 1 + (MISSILE_TERMINAL - 1) * (1 - THREE.MathUtils.smoothstep(toAim, 3, MISSILE_TERMINAL_RANGE));
        const maxTurn = (MISSILE_TURN + (MISSILE_TURN_LATE - MISSILE_TURN) * late) * terminal * (m.ult ? ULT_TURN : 1) * dt;
        const ang = m.fwd.angleTo(_tip);
        if (ang > 1e-4) m.fwd.lerp(_tip, Math.min(1, maxTurn / ang)).normalize();
        m.wob += dt * 9;
        _fwd.set(Math.cos(m.wob), Math.sin(m.wob * 1.3), Math.sin(m.wob)).multiplyScalar(0.02);
        m.fwd.add(_fwd).normalize();
        // Thrust: speed builds along the nose; the missile flies where it points.
        m.speed = Math.min(m.ult ? ULT_SPEED : MISSILE_SPEED, m.speed + MISSILE_ACCEL * dt);
        m.vel.copy(m.fwd).multiplyScalar(m.speed);
        m.pos.addScaledVector(m.vel, dt);
        // Exhaust flicker and a lingering smoke trail.
        const f = 0.8 + Math.random() * 0.6;
        m.flame.scale.set(f, f, 0.8 + Math.random() * 0.9);
        m.smokeT -= dt;
        if (m.smokeT <= 0) {
          m.smokeT += 1 / MISSILE_SMOKE;
          fx.smoke(m.pos, { count: 1, color: 0xcfd3d8, size: 0.32, grow: 3, life: 1.1, speed: 0.25, up: 0.15, drag: 2.5, opacity: 0.42 });
          if (Math.random() < 0.35) fx.burst(m.pos, { color: 0xffa040, count: 1, speed: 0.6, size: 0.22, gravity: 0, life: 0.12 });
        }
      }
      _p.copy(m.pos).add(m.lit ? m.fwd : m.vel);
      m.mesh.position.copy(m.pos);
      m.mesh.lookAt(_p);
      if (m.lit && cam) m.trail.update(dt, _tip.copy(m.pos).addScaledVector(m.fwd, -MISSILE_TAIL), cam);
      // Proximity fuse on the target; otherwise ground / deck impact or fuse timeout.
      const hitTarget =
        !!tgt &&
        m.lit &&
        Math.hypot(tgt.position.x - m.pos.x, tgt.position.y + Math.min(1, tgt.radius * 0.5) - m.pos.y, tgt.position.z - m.pos.z) < tgt.radius + MISSILE_PROX;
      let struck = false;
      if (ter?.active) {
        const step = _a.distanceTo(m.pos);
        if (step > 1e-4) {
          _fwd.subVectors(m.pos, _a).multiplyScalar(1 / step);
          const hit = ter.raycast(_a.x, _a.y, _a.z, _fwd.x, _fwd.y, _fwd.z, step, _hit);
          if (hit) {
            m.pos.set(hit.x, hit.y, hit.z);
            struck = true;
          }
        }
      }
      const floor = ter?.active ? ter.surfaceAt(m.pos.x, m.pos.z, m.pos.y, _surf).y : 0;
      if (hitTarget || struck || m.pos.y <= floor + 0.15 || m.t > (m.ult ? ULT_FUSE : MISSILE_FUSE)) this.explodeMissile(m, tgt);
    }
  }

  /** A detour point round the deck between a missile and its target, or null when the way is clear. */
  private missileDetour(m: Missile, tgt: EnemyHandle): THREE.Vector3 | null {
    const ter = this.ctx.terrain;
    const ty = tgt.position.y + Math.min(1, tgt.radius * 0.5);
    const dx = tgt.position.x - m.pos.x;
    const dy = ty - m.pos.y;
    const dz = tgt.position.z - m.pos.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1) return null;
    const hit = ter.raycast(m.pos.x, m.pos.y, m.pos.z, dx / len, dy / len, dz / len, len - 0.5, _hit);
    if (!hit || hit.what === 'ground') return null;
    const deck = ter.decks.find((d) => d.id === hit.what);
    if (!deck) return null;
    // Nearest point on the deck's footprint edge to the target, pushed 3 m outward, at the target's height.
    const c = Math.cos(deck.rot);
    const s = Math.sin(deck.rot);
    const rx = tgt.position.x - deck.x;
    const rz = tgt.position.z - deck.z;
    let lx = rx * c - rz * s;
    let lz = rx * s + rz * c;
    const px = deck.hw - Math.abs(lx);
    const pz = deck.hd - Math.abs(lz);
    if (px < pz) lx = Math.sign(lx || 1) * (deck.hw + 3);
    else lz = Math.sign(lz || 1) * (deck.hd + 3);
    const out = m.via ?? new THREE.Vector3();
    out.set(deck.x + lx * c + lz * s, ty + 1, deck.z - lx * s + lz * c);
    return out;
  }

  private explodeMissile(m: Missile, direct: EnemyHandle | null): void {
    m.live = false;
    m.mesh.visible = false;
    m.trail.stop();
    const st = this.b.stats;
    const x = m.pos.x;
    const z = m.pos.z;
    const ter = this.ctx.terrain;
    const floorY = ter?.active ? ter.surfaceAt(x, z, m.pos.y + 0.5, _surf).y : 0;
    const blast = m.ult ? ULT_BLAST : MISSILE_BLAST;
    const mult = m.ult ? ULT_MULT : 1;
    _q.set(x, Math.max(floorY + 0.5, m.pos.y), z);
    this.ctx.fx.burst(_q, { color: 0xff8a20, count: m.ult ? 26 : 18, speed: m.ult ? 12 : 9, size: m.ult ? 0.45 : 0.35, gravity: -2, life: 0.5 });
    this.ctx.fx.burst(_q, { color: 0x3a3634, count: m.ult ? 9 : 6, speed: 2, size: m.ult ? 1.1 : 0.8, gravity: -2, life: 1 });
    this.ctx.fx.ring(_q.set(x, floorY + 0.15, z), blast, m.ult ? 0xff5a20 : 0xffb040);
    this.b.audio.play('explosion', { volume: m.ult ? 0.6 : 0.45, pitch: (m.ult ? 0.95 : 1.2) + Math.random() * 0.2 });
    this.shake(m.ult ? 0.26 : 0.18);
    this.b.snow.melt(x, z, blast * 0.6, 0.6);
    this.smashProps(x, z, blast);
    const hits = this.collect(x, z, blast);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      // A blast on one level doesn't reach bots on a deck above or below it.
      if (e !== direct && Math.abs(e.position.y - floorY) > blast) continue;
      const full = e === direct;
      const dealt = this.weaponHit(e, st.missileDamage * mult * (full ? 1 : MISSILE_SPLASH), x, z, (full ? 9 : 6) * (m.ult ? 1.4 : 1));
      if (dealt > 0) {
        _tip.set(e.position.x, e.position.y + e.radius + 1.2, e.position.z);
        this.ctx.fx.floatText(_tip, `🚀${Math.round(dealt)}`, m.ult ? '#ff7a50' : '#ffb060', m.ult ? 1.1 : 0.9);
      }
    }
    this.clearTargets();
  }

  clear(): void {
    this.missileCharge = 1;
    this.gunT = this.gunBurstT = 0;
    this.gunsOn = false;
    this.laserT = 0;
    this.laserOff = 0;
    this.laserPitch = 0;
    this.gunPitch = 0;
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
      m.delay = 0;
      m.mesh.visible = false;
      m.trail.clear();
    }
  }
}
