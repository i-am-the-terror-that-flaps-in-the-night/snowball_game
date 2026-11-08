import * as THREE from 'three';
import {
  ARENA,
  MIN_BALL_RADIUS,
  type EnemyHandle,
  PLOW_SPAWN,
  ballRadius,
  ballVolume,
  type GameContext,
  type PlayerStats,
  type PlowAPI,
  type SoundName,
} from '../core/types';
import type { Combat } from './Combat';
import { ctxPilot, type PilotBinding } from './pilot';
import { NP } from '../net/protocol';
import { getSnowballGeometry, getSnowballMaterial } from './snowballMesh';
import { cooldown } from '../config/upgrades';
import { PLOWS, type PlowKind } from '../config/plows';
import {
  cleatZ, hazardTexture, type Cleat, buildBuzzsaw, type Buzzsaw, SAW_R,
  FACTORY_PAINT, buildDecals, emitTrail, TRAIL_REAR, PLOW_WHEEL_POS, bladeTexture,
} from './plowModels';
import type { CosmeticSlot } from '../config/cosmetics';
import { bakeGeometry, mergeBaked, mergeStatic } from '../render/mergeStatic';
import { makeShadowProxy } from '../render/shadowProxy';
import { getPaintEnvMap } from '../render/reflections';
import { cosmeticsState, resolveLook, type EquippedLook } from '../meta/cosmetics';
import { GearVisuals } from './gearVisuals';
import { STEP_UP, makeSurface, type Deck } from '../world/Terrain';
import { AIR_SLAM_MIN_HEIGHT } from './combat/air';
import type { VehicleBuildIn } from './vehicles/types';
import { buildVoltVehicle, type VoltVehicleParts } from './vehicles/volt';
import { buildBruteVehicle } from './vehicles/brute';
import { buildIsotopeVehicle } from './vehicles/isotope';
import { buildArsenalVehicle, type ArsenalVehicleParts } from './vehicles/arsenal';
import { buildClassicVehicle, CLASSIC_EXHAUST, type ClassicVehicleParts } from './vehicles/classic';
import {
  AIR_STEER, ICE_ACCEL, ICE_BRAKE, ICE_DRAG, ICE_GRIP, LAVA_DPS, V_LANDED, V_LAUNCHED, bonkCeiling, makeVert, slopeAccel, stepVertical,
} from '../world/terrainMotion';

/* Model layout (local, facing +Z): rear dump bed at -Z, cab mid-front, hood, blade at BLADE_Z. */
const BLADE_Z = 2.35;
const TIP_Z = BLADE_Z + 0.15;
/** Driving into a destructible prop faster than this (m/s), or dashing, smashes it. */
const PROP_SMASH_SPEED = 6;
const REAR_Z = 2.15;
const WHEEL_R = 0.48;
/** BRUTUS's taller, deeper blade (visual scale on Y / Z; width still follows bladeWidth). */
const BRUTE_BLADE_Y = 1.28;
const BRUTE_BLADE_Z = 1.15;
/** Buzzsaw spin (rad/s) at rest; the halo is fully grown at SAW_SPIN_BASE + SAW_SPIN_FULL. */
const SAW_SPIN_BASE = 16;
const SAW_SPIN_FULL = 75;
/** Full fury multiplies the spin by 1 + SAW_FURY_SPIN. */
const SAW_FURY_SPIN = 2;
/** Damage dealt / taken that fills the saw fury from empty; it drains SAW_FURY_DRAIN per second. */
const SAW_FURY_DEALT = 250;
const SAW_FURY_TAKEN = 60;
const SAW_FURY_DRAIN = 0.15;
const _haloCool = new THREE.Color(0xffc040);
const _haloHot = new THREE.Color(0xff3010);

const SLAM_WINDUP = 0.12;
const SLAM_LUNGE = 0.2;
const SLAM_IMPACT_AT = 0.05;
const SLAM_LUNGE_SPEED = 8;
const SLAM_COOLDOWN = 0.5;
/** Dash: full-power burst (ignores the speed cap), then eases back to the cap. */
const DASH_SECONDS = 0.5;
const DASH_EASE = 0.3;
const DASH_IFRAMES = 0.2;
const DASH_STEER = 0.4;
/** Dash speed after a dash strike (plows through the target). */
const DASH_STRIKE_KEEP = 0.8;
const WHIRL_SECONDS = 0.9;
const WHIRL_TICKS = [0.1, 0.35, 0.6, 0.85];
const WHIRL_TURNS = 2;
const WHIRL_SPEED = 0.75;
const WHIRL_STEER = 0.85;
const SPAWN_PROTECT = 2;
const INPUT_BUFFER = 0.2;
const MAX_GHOSTS = 8;
const MAX_STREAKS = 40;
const STREAK_LIFE = 0.24;
/** Cosmetic trail: seconds between puffs while cruising / dashing, and the speed it starts at. */
const TRAIL_EVERY = 0.07;
const TRAIL_EVERY_DASH = 0.025;
const TRAIL_MIN_SPEED = 2.5;
/** Share of camera shake a duel opponent's plow causes on this screen. */
const REMOTE_SHAKE = 0.35;
/** Terrain: plow height (m) for ceiling bonks / deck walls; slope speed bonus decay (m/s²) above the speed cap. */
const PLOW_HEIGHT = 2.4;
const SLOPE_BOOST_DECAY = 1.5;
/** Seconds of reduced grip that linger after leaving ice (blend back to full grip). */
const ICE_LINGER = 0.35;
/** Lava: seconds between 'lavaBurn' sounds, and between batched plowDamaged events. */
const LAVA_SFX_GAP = 0.45;
const LAVA_EVENT_GAP = 0.5;

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _col = new THREE.Color();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);
const _ballSurf = makeSurface();

/** The deck with this id (a short scan; no allocation), or null. */
function deckById(decks: readonly Deck[], id: number): Deck | null {
  for (let i = 0; i < decks.length; i++) if (decks[i].id === id) return decks[i];
  return null;
}

interface Streak {
  x: number;
  y: number;
  z: number;
  h: number;
  len: number;
  age: number;
  active: boolean;
}

let tornadoTex: THREE.CanvasTexture | null = null;
/** Streaky white-on-black noise (additive => black is transparent). Wraps horizontally. */
function getTornadoTexture(): THREE.CanvasTexture {
  if (tornadoTex) return tornadoTex;
  const W = 256;
  const H = 128;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const len = 30 + Math.random() * 110;
    const slope = (Math.random() - 0.3) * 0.25;
    g.strokeStyle = `rgba(255,255,255,${0.08 + Math.random() * 0.45})`;
    g.lineWidth = 1 + Math.random() * 4;
    for (const ox of [0, -W]) {
      g.beginPath();
      g.moveTo(x + ox, y);
      g.lineTo(x + ox + len, y + len * slope);
      g.stroke();
    }
  }
  // Soft puffs.
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const r = 6 + Math.random() * 16;
    for (const ox of [0, -W, W]) {
      const grd = g.createRadialGradient(x + ox, y, 0, x + ox, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.35)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(x + ox - r, y - r, r * 2, r * 2);
    }
  }
  tornadoTex = new THREE.CanvasTexture(cv);
  tornadoTex.wrapS = THREE.RepeatWrapping;
  tornadoTex.wrapT = THREE.RepeatWrapping;
  tornadoTex.colorSpace = THREE.SRGBColorSpace;
  return tornadoTex;
}

/** Open, flared tube (bottom r=0.55, top r=1, height 1, base at y=0) with twisted UVs and a vertical
 *  vertex-color fade so it dissolves at the top and bottom. */
function makeTornadoGeometry(twist: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 0.55, 1, 40, 8, true);
  g.translate(0, 0.5, 0);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    uv.setX(i, uv.getX(i) + y * twist);
    const f = Math.min(1, y * 5) * (1 - y * 0.8);
    colors[i * 3] = f * 0.85;
    colors[i * 3 + 1] = f * 0.95;
    colors[i * 3 + 2] = f;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

interface Ghost {
  group: THREE.Group;
  blade: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  active: boolean;
}

interface Debris {
  obj: THREE.Object3D;
  parent: THREE.Object3D;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  rest: number;
  popped: boolean;
}

export class Plow implements PlowAPI {
  readonly object = new THREE.Group();
  readonly position = this.object.position;
  heading: number = PLOW_SPAWN.heading;
  speed = 0;
  readonly radius = 1.6;
  hp = 120;
  maxHp = 120;

  private ctx: GameContext;
  /** Whose input / stats / combat drive this plow (ctxPilot = the single-player singletons). */
  private b: PilotBinding;
  private _dead = false;
  private heldVolume = 0;
  private pushVel = new THREE.Vector3();
  private bladeWidth = 2.6;

  // abilities
  private slamPhase: 0 | 1 | 2 = 0;
  private slamT = 0;
  private slamCd = 0;
  private slamHit = false;
  private slamBuffer = 0;
  private lungeVel = 0;
  private dashCharge = 1;
  private dashT = 0;
  private dashEase = 0;
  private dashSpeed = 0;
  private hitStopT = 0;
  private spawnProt = 0;
  private whirlCharge = 1;
  private whirlT = -1;
  private whirlTick = 0;
  private whirlHits = new Set<number>();
  private queryOut: EnemyHandle[] = [];
  private dashTargets: EnemyHandle[] = [];
  private spinAngle = 0;
  private wallCd = 0;

  // terrain (world/Terrain.ts via ctx.terrain; shared vertical model in world/terrainMotion.ts)
  private vert = makeVert();
  private surf = makeSurface();
  private conv = { x: 0, z: 0 };
  private wallOut = { x: 0, z: 0 };
  /** Snow ride height above the surface (smoothed); position.y = surface + ride while grounded. */
  private ride = 0;
  /** Over-the-cap speed earned rolling downhill (decays); the cap settle leaves it alone. */
  private slopeBoost = 0;
  /** Actual horizontal velocity (m/s). Equals forward * speed on normal ground; lags the heading on ice / in the air. */
  private velX = 0;
  private velZ = 0;
  /** 0..1 ice blend (1 on ice, fades out over ICE_LINGER after leaving it). */
  private ice = 0;
  /** 0..1 lava burn glow; lava damage batched for the event / sound throttles. */
  private burn = 0;
  private lavaAcc = 0;
  private lavaEventT = 0;
  private lavaSfxT = 0;
  /** Smoothed body tilt to the surface (rad) and the landing squash (0..1). */
  private tiltP = 0;
  private tiltR = 0;
  private squash = 0;
  /** Surface height when wrecked (debris rest heights sit on it). */
  private wreckGround = 0;
  /** Duel opponent puppet: the host's feet height / flight state this frame (null = not a puppet). */
  private puppetY: number | null = null;
  private puppetAir = false;
  private puppetVy = 0;

  // visuals
  private spin = new THREE.Group();
  private body = new THREE.Group();
  private bladeGroup = new THREE.Group();
  private bladeSheet!: THREE.Mesh;
  /** Both blade-side hazard caps in one mesh (rebuilt for the blade width in setBladeWidth). */
  /** Blade wings / seams / LED markers (vehicles/classic.ts frame, rebuilt for the blade width). */
  private bladeCaps!: THREE.Group;
  private capsWidth = -1;
  /** Frame + arms meshes that cast (through bladeProxy; re-enabled before each proxy rebuild). */
  private bladeCasters: THREE.Object3D[] = [];
  private bladeArms!: THREE.Object3D;
  /** Depth-only caster for the caps + arms (rebuilt with the caps). */
  private bladeProxy: THREE.Mesh | null = null;
  /** Wheels as instances (tire / treads / hub, one shared matrix buffer). Each wheel keeps the spin (rotation.x)
   *  and, at the front, the steer (rotation.y, order YXZ) its own group used to have. */
  private wheelMeshes: THREE.InstancedMesh[] = [];
  private wheelSpin = [0, 0, 0, 0];
  private wheelSteer = [0, 0];
  /** Stand-ins for wheels 0 and 3 while they fly off as wreck debris (their instances are hidden meanwhile). */
  private wheelDebris: THREE.Group[] = [];
  private wheelsOff = false;
  private paintMat: THREE.MeshStandardMaterial;
  private bedMat: THREE.MeshStandardMaterial;
  private paintBase = new THREE.Color(0xffc814);
  private bedBase = new THREE.Color(0x23272e);
  private charColor = new THREE.Color(0x2a211c);
  private beaconMat: THREE.MeshStandardMaterial;
  private beaconLight: THREE.PointLight;
  private beacon!: THREE.Mesh;
  private beaconSpinner = new THREE.Group();
  // Starter-plow models: Classic dump truck, VOLT-9 low electric wedge, BRUTUS tracked bulldozer.
  private kind: PlowKind = 'classic';
  private classicParts!: THREE.Group;
  /** Classic heavy-duty plow: blade dressing (wings / burners / fuel cell), hopper gauge, spreader (vehicles/classic.ts). */
  private classicRig!: ClassicVehicleParts;
  private bruteParts!: THREE.Group;
  /** ISOTOPE: hazmat hull + reactor; the core's glow pulses (faster while Meltdown recharges). */
  private isoParts!: THREE.Group;
  private coreMat!: THREE.MeshStandardMaterial;
  private cleats: Cleat[] = [];
  /** All BRUTUS track cleats as instances (matrices follow cleatZ). */
  private cleatMesh!: THREE.InstancedMesh;
  /** BRUTUS WRECKING MECH pose (fists / saws), driven by its combat kit (combat/brute.ts). */
  bruteRig: { pose(dt: number, punchL: number, punchR: number, saw: number, twist: number): void } | null = null;
  private cleatPhase = NaN;
  /** Buzzsaws upgrade (BRUTUS): one saw per blade end. */
  private saws: Buzzsaw[] = [];
  /** 0..1 saw fury: built by damage dealt and taken, drains over time; spins the saws up. */
  private sawFury = 0;
  private _sawHalo = 0;
  private cleatSpan = 3;
  private trackPhase = 0;
  private underglowMat!: THREE.MeshBasicMaterial;
  private voltRig!: VoltVehicleParts;
  /** TESLA ROVER: ARC LANCE firing / STATIC FIELD active 0..1 (set by combat/volt.ts; drive the tower FX). */
  voltArc = false;
  voltField = 0;
  private bruteBlade = new THREE.Group();
  /** Ground Pound hop height (m), driven by Combat while BRUTUS is airborne. */
  hop = 0;
  private steelMat!: THREE.MeshStandardMaterial;
  private hubMat!: THREE.MeshStandardMaterial;
  private voltParts!: THREE.Group;
  /** ARSENAL: the wheel + gyro vehicle body, its yawing emitter turret and weapon mounts. */
  private arsenalParts!: THREE.Group;
  /** Equipped gear attachments (entities/gearVisuals.ts). */
  private gearVis!: GearVisuals;
  private turret!: THREE.Group;
  private minigun!: THREE.Group;
  /** Minigun elevation pivot; follows gunPitch. */
  private gunMount!: THREE.Group;
  private gunTilt = 0;
  /** Minigun barrel spin (rad/s), easing toward full speed while gunFiring. */
  private minigunSpin = 0;
  /** Set by Combat each frame: the ARSENAL pulse laser is firing. */
  gunFiring = false;
  /** Minigun elevation (rad, + up) from ARSENAL's auto-aim; the barrels tilt to it. */
  gunPitch = 0;
  private muzzles: THREE.Object3D[] = [];
  private laserMount!: THREE.Object3D;
  private gyroMount!: THREE.Object3D;
  private armGlowMat!: THREE.MeshStandardMaterial;
  private arsRig!: ArsenalVehicleParts;
  /** Set by Combat each frame (ARSENAL): 0..1 gyro rings folded flat into a disc (Polarity Burst), and 0..1 extra
   *  core charge glow (Grav Lance / Singularity). */
  gyroFlat = 0;
  gyroCharge = 0;
  private gyroFlatEase = 0;
  /** Turret yaw relative to the hull (rad) and where Combat wants it. */
  private turretYaw = 0;
  turretAim = 0;
  private coilMat = new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x2fb8ff, emissiveIntensity: 1.5, roughness: 0.3, metalness: 0.4 });
  private coilTops: THREE.Object3D[] = [];
  private arcT = 0;
  private headMat: THREE.MeshStandardMaterial;
  private flame: THREE.Mesh;
  private flameMat: THREE.MeshBasicMaterial;
  private exhaustTip = new THREE.Vector3(-0.72, 2.55, 0.05);
  private engineTip = new THREE.Vector3(0, 1.6, 1.7);
  private ball: THREE.Mesh;
  private ballR = 0;
  private ballWasVisible = false;
  private glow: THREE.Mesh;
  private glowMat: THREE.MeshBasicMaterial;
  private ghosts: Ghost[] = [];
  private ghostT = 0;
  private debris: Debris[] = [];
  private streaks: Streak[] = [];
  private streakMesh: THREE.InstancedMesh;
  private streakT = 0;
  private tornado = new THREE.Group();
  private tornadoOuter: THREE.Mesh;
  private tornadoInner: THREE.Mesh;
  private tornadoMatO: THREE.MeshBasicMaterial;
  private tornadoMatI: THREE.MeshBasicMaterial;
  private tornadoA = 0;
  private tornadoR = 5;
  private whirlRing: THREE.Mesh;
  private whirlRingMat: THREE.MeshBasicMaterial;
  private ringPulse = 0;

  private roll = 0;
  private pitch = 0;
  private kick = 0;
  private slamPose = 0;
  private flash = 0;
  private jitter = 0;
  private bobT = 0;
  private puffT = 0;
  private lastSpeed = 0;
  private plowSmooth = 0;
  private time = 0;
  private wreckT = 0;
  // ---- Paint Shop cosmetics (meta/cosmetics.ts): equipped look, overridden per slot while the shop previews an item.
  private look!: EquippedLook;
  private lookKey = '';
  private decalKey = '';
  private preview: Partial<Record<CosmeticSlot, string>> = {};
  private decals: THREE.Group | null = null;
  private decalMat = new THREE.MeshStandardMaterial({
    roughness: 0.5, metalness: 0.1, emissive: 0xffffff, emissiveIntensity: 0.3, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
  });
  private trailT = 0;
  /** Paint Shop blade skin (swapped onto bladeSheet instead of steelMat while a skin is equipped). */
  private bladeSkinMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.4, metalness: 0.3, emissive: 0xff0000, emissiveIntensity: 0 });
  private bladeKey = '';

  constructor(ctx: GameContext, binding?: PilotBinding) {
    this.ctx = ctx;
    this.b = binding ?? ctxPilot(ctx);
    this.object.name = 'plow';

    this.paintMat = new THREE.MeshStandardMaterial({ color: this.paintBase, roughness: 0.45, metalness: 0.15, emissive: 0xff0000, emissiveIntensity: 0 });
    this.bedMat = new THREE.MeshStandardMaterial({ color: this.bedBase, roughness: 0.5, metalness: 0.1, emissive: 0xff0000, emissiveIntensity: 0 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.7, metalness: 0.3 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1b2a40, roughness: 0.12, metalness: 0.6, emissive: 0x0b1830, emissiveIntensity: 0.4 });
    // Starts as the Classic's polished blade steel (setKind re-tints it per plow).
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xd4dce4, roughness: 0.18, metalness: 0.85, side: THREE.DoubleSide, emissive: 0x000000 });
    this.steelMat = steelMat;
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xc9d2dc, roughness: 0.25, metalness: 0.85 });
    const rubberMat = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.9, flatShading: true });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.4, metalness: 0.4 });
    this.hubMat = hubMat;
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xfff6d0, emissive: 0xfff1b8, emissiveIntensity: 1.6 });
    this.beaconMat = new THREE.MeshStandardMaterial({ color: 0xffb000, emissive: 0xff9a00, emissiveIntensity: 1, transparent: true, opacity: 0.92, roughness: 0.2 });

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.body, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = shadow;
      m.receiveShadow = shadow;
      parent.add(m);
      return m;
    };

    // Shared chassis + front bumper. Everything above it is per-plow (classicParts / voltParts / bruteParts), so
    // the three starter plows have different silhouettes, not just different paint. Each kind group gets its own
    // copy of the chassis so it bakes into that group's merged dark bodywork.
    const chassisGeo = new THREE.BoxGeometry(1.7, 0.35, 4.0);
    const vin: VehicleBuildIn = {
      mats: { paint: this.paintMat, trim: this.bedMat, dark: darkMat, glass: glassMat, chrome: chromeMat, coil: this.coilMat, hub: this.hubMat, head: this.headMat },
      chassis: chassisGeo,
    };

    /* ---- Classic: the heavy-duty pro plow (vehicles/classic.ts); its blade dressing goes on the blade below. ---- */
    const classic = buildClassicVehicle(vin, { beacon: this.beaconMat, steel: steelMat });
    this.classicParts = classic.group;
    this.classicRig = classic.parts;
    const { stacks, mirrors: [mirrorL, mirrorR] } = classic.parts;
    this.beacon = classic.parts.beacon;
    this.beacon.add(this.beaconSpinner);
    this.body.add(this.classicParts);

    // Dash / wreck flame (out of the stack on the Classic; moved per plow in setKind).
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0xff8a1a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const flameGeo = new THREE.ConeGeometry(0.13, 0.7, 8);
    flameGeo.translate(0, 0.35, 0);
    this.flame = add(flameGeo, this.flameMat, -0.72, 2.55, 0.05, this.body, false);
    this.flame.visible = false;

    /* ---- Per-vehicle bodies (one builder per file under ./vehicles/): VOLT-9, BRUTUS, ISOTOPE, ARSENAL. ---- */
    const volt = buildVoltVehicle(vin);
    this.voltParts = volt.group;
    this.coilTops = volt.parts.coilTops;
    this.underglowMat = volt.parts.underglowMat;
    this.voltRig = volt.parts;

    const brute = buildBruteVehicle(vin);
    this.bruteParts = brute.group;
    this.cleats = brute.parts.cleats;
    this.cleatSpan = brute.parts.cleatSpan;
    this.cleatMesh = brute.parts.cleatMesh;
    this.bruteRig = brute.parts;
    this.setCleats(0);

    const iso = buildIsotopeVehicle(vin);
    this.isoParts = iso.group;
    this.coreMat = iso.parts.coreMat;

    const ars = buildArsenalVehicle(vin);
    this.arsenalParts = ars.group;
    this.turret = ars.parts.turret;
    this.minigun = ars.parts.minigun;
    this.gunMount = ars.parts.gunMount;
    this.muzzles = ars.parts.muzzles;
    this.laserMount = ars.parts.laser;
    this.gyroMount = ars.parts.gyro;
    this.armGlowMat = ars.parts.glowMat;
    this.arsRig = ars.parts;

    for (const g of [this.voltParts, this.bruteParts, this.isoParts, this.arsenalParts]) {
      g.visible = false;
      this.body.add(g);
    }

    // Beacon light (colour/intensity per plow in update).
    this.beaconLight = new THREE.PointLight(0xffa020, 0, 7, 2);
    this.beaconLight.position.set(0, 2.8, 0.8);
    this.body.add(this.beaconLight);

    // Wheels (Classic + VOLT-9; BRUTUS rides on tracks).
    const tireGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.42, 14);
    tireGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.44, 8);
    hubGeo.rotateZ(Math.PI / 2);
    const treadGeo = new THREE.BoxGeometry(0.44, 0.1, 0.16);
    const treads: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const tr = new THREE.Object3D();
      const a = (i / 6) * Math.PI * 2;
      tr.position.set(0, Math.sin(a) * WHEEL_R, Math.cos(a) * WHEEL_R);
      tr.rotation.x = -a;
      tr.updateMatrix();
      treads.push(bakeGeometry(treadGeo, tr.matrix));
    }
    const treadsGeo = mergeBaked(treads, rubberMat)[0];
    const matrices = new THREE.InstancedBufferAttribute(new Float32Array(4 * 16), 16);
    matrices.setUsage(THREE.DynamicDrawUsage);
    for (const [geo, mat, cast] of [[tireGeo, rubberMat, true], [treadsGeo, rubberMat, false], [hubGeo, hubMat, false]] as const) {
      const m = new THREE.InstancedMesh(geo, mat, 4);
      m.instanceMatrix = matrices;
      m.castShadow = cast;
      this.body.add(m);
      this.wheelMeshes.push(m);
    }
    for (const i of [0, 3]) {
      const w = new THREE.Group();
      w.position.set(PLOW_WHEEL_POS[i][0], WHEEL_R, PLOW_WHEEL_POS[i][1]);
      w.rotation.order = 'YXZ';
      const t = new THREE.Mesh(tireGeo, rubberMat);
      t.castShadow = true;
      w.add(t, new THREE.Mesh(hubGeo, hubMat), new THREE.Mesh(treadsGeo, rubberMat));
      w.visible = false;
      this.body.add(w);
      this.wheelDebris.push(w);
    }
    this.writeWheels();
    // Spin and steer turn each wheel about its centre, so these spheres never go stale.
    for (const m of this.wheelMeshes) m.computeBoundingSphere();

    // Blade: curved sheet (unit width, scaled on X) + mounting arms.
    const R = 0.78;
    const sheetGeo = new THREE.CylinderGeometry(R, R, 1, 14, 1, true, Math.PI - 0.95, 1.9);
    sheetGeo.rotateZ(Math.PI / 2);
    // After rotation: y' = R sin(theta), z' = R cos(theta) -> concave side faces +Z.
    sheetGeo.translate(0, 0.72, R - 0.05);
    this.bladeSheet = new THREE.Mesh(sheetGeo, steelMat);
    this.bladeSheet.castShadow = true;
    this.bladeSheet.receiveShadow = true;
    this.bladeGroup.add(this.bladeSheet);
    // Classic dressing on the sheet (back skin, top rail, carbide edge, back beams): stretches with the sheet.
    this.bladeSheet.add(classic.parts.sheetTrim);
    // BRUTUS hazard bands along the top and lower face of the blade (just in front of the concave sheet).
    const bandTex = hazardTexture();
    bandTex.repeat.set(1, 5);
    const bandMat = new THREE.MeshStandardMaterial({ map: bandTex, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide });
    for (const t0 of [Math.PI - 0.95, Math.PI + 0.25]) {
      const bandGeo = new THREE.CylinderGeometry(R - 0.025, R - 0.025, 1, 14, 1, true, t0, 0.32);
      bandGeo.rotateZ(Math.PI / 2);
      bandGeo.translate(0, 0.72, R - 0.05);
      this.bruteBlade.add(new THREE.Mesh(bandGeo, bandMat));
    }
    mergeStatic(this.bruteBlade);
    this.bruteBlade.visible = false;
    this.bladeSheet.add(this.bruteBlade);
    // Hinged wings, segment seams, LED markers, marker wands (rebuilt for the blade width in setBladeWidth).
    this.bladeCaps = classic.parts.frame;
    this.bladeGroup.add(this.bladeCaps);
    // BRUTUS Buzzsaws (shown only with the upgrade; repositioned in setBladeWidth).
    for (let i = 0; i < 2; i++) {
      const saw = buildBuzzsaw();
      saw.group.visible = false;
      this.bladeGroup.add(saw.group);
      this.saws.push(saw);
    }
    // Push frame + chrome ram rods (already merged), and the Classic's Inferno burners + fuel cell.
    this.bladeArms = classic.parts.arms;
    this.bladeGroup.add(this.bladeArms, classic.parts.inferno);
    for (const o of [this.bladeCaps, this.bladeArms]) o.traverse((m) => m.castShadow && this.bladeCasters.push(m));
    this.bladeGroup.position.set(0, 0, BLADE_Z - 0.1);
    this.body.add(this.bladeGroup);
    this.gearVis = new GearVisuals(this.body, this.bladeGroup);

    this.spin.add(this.body);
    this.object.add(this.spin);
    // Yaw first, then the terrain pitch / roll in the hull's own frame (identical to a plain yaw when the tilt is 0).
    this.object.rotation.order = 'YXZ';

    // Parts that pop off when wrecked.
    const pop = (obj: THREE.Object3D, rest: number) =>
      this.debris.push({ obj, parent: obj.parent!, pos: obj.position.clone(), quat: obj.quaternion.clone(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), rest, popped: false });
    pop(this.bladeGroup, 0.05);
    pop(this.wheelDebris[0], WHEEL_R);
    pop(this.wheelDebris[1], WHEEL_R);
    pop(this.beacon, 0.15);
    pop(stacks, 0.1);
    pop(mirrorL, 0.05);
    pop(mirrorR, 0.05);

    // Held snowball (world-space, not parented to the truck).
    this.ball = new THREE.Mesh(getSnowballGeometry(), getSnowballMaterial(false));
    this.ball.castShadow = true;
    this.ball.receiveShadow = true;
    this.ball.visible = false;
    ctx.scene.add(this.ball);

    this.glowMat = new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const glowGeo = new THREE.RingGeometry(1.05, 1.45, 40);
    glowGeo.rotateX(-Math.PI / 2);
    this.glow = new THREE.Mesh(glowGeo, this.glowMat);
    this.glow.visible = false;
    this.glow.renderOrder = 2;
    ctx.scene.add(this.glow);

    // Dash afterimages: translucent silhouettes left behind.
    const hullGeo = new THREE.BoxGeometry(2.1, 1.7, 4.2);
    hullGeo.translate(0, 1.25, 0);
    const ghostBladeGeo = new THREE.BoxGeometry(1, 0.95, 0.25);
    ghostBladeGeo.translate(0, 0.65, TIP_Z - 0.2);
    for (let i = 0; i < MAX_GHOSTS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const group = new THREE.Group();
      group.add(new THREE.Mesh(hullGeo, mat));
      const blade = new THREE.Mesh(ghostBladeGeo, mat);
      group.add(blade);
      group.visible = false;
      ctx.scene.add(group);
      this.ghosts.push({ group, blade, mat, age: 0, active: false });
    }

    // Dash speed lines: stretched additive streaks left in world space along the sides.
    const streakGeo = new THREE.BoxGeometry(0.07, 0.07, 1);
    streakGeo.translate(0, 0, -0.5);
    const streakMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.streakMesh = new THREE.InstancedMesh(streakGeo, streakMat, MAX_STREAKS);
    this.streakMesh.frustumCulled = false;
    this.streakMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_STREAKS; i++) {
      this.streakMesh.setMatrixAt(i, _m);
      this.streakMesh.setColorAt(i, _col.setRGB(0, 0, 0));
      this.streaks.push({ x: 0, y: 0, z: 0, h: 0, len: 1, age: 0, active: false });
    }
    this.streakMesh.count = MAX_STREAKS;
    ctx.scene.add(this.streakMesh);

    // Whirlwind snow tornado + ground radius ring.
    const tex = getTornadoTexture();
    const mkMat = (color: number) => {
      const t = tex.clone();
      t.needsUpdate = true;
      t.repeat.set(2, 1);
      return new THREE.MeshBasicMaterial({ map: t, color, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    };
    this.tornadoMatO = mkMat(0xd8f0ff);
    this.tornadoMatI = mkMat(0xffffff);
    this.tornadoOuter = new THREE.Mesh(makeTornadoGeometry(0.45), this.tornadoMatO);
    this.tornadoInner = new THREE.Mesh(makeTornadoGeometry(-0.6), this.tornadoMatI);
    this.tornadoOuter.renderOrder = 3;
    this.tornadoInner.renderOrder = 3;
    this.tornado.add(this.tornadoOuter, this.tornadoInner);
    this.tornado.visible = false;
    ctx.scene.add(this.tornado);
    this.whirlRingMat = new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ringGeo = new THREE.RingGeometry(0.93, 1, 64);
    ringGeo.rotateX(-Math.PI / 2);
    this.whirlRing = new THREE.Mesh(ringGeo, this.whirlRingMat);
    this.whirlRing.renderOrder = 2;
    this.whirlRing.visible = false;
    ctx.scene.add(this.whirlRing);

    ctx.scene.add(this.object);
    this.applyStats(this.b.stats);
    // Paint Shop look: applied now and re-checked on every save change (buy / equip / import / reset).
    this.syncLook(true);
    ctx.progression.onChange(() => this.syncLook());
    this.reset();
  }

  /* ------------------------------------------------------------------ API */

  get dead(): boolean {
    return this._dead;
  }
  get heldBallRadius(): number {
    return ballRadius(this.heldVolume);
  }
  get dashReady(): number {
    return this.dashCharge;
  }
  get whirlReady(): number {
    return this.whirlCharge;
  }
  get dashing(): boolean {
    return this.dashT > 0;
  }
  get whirling(): boolean {
    return this.whirlT >= 0;
  }
  get sawHalo(): number {
    return this._sawHalo;
  }
  feedSawFury(dealt: number, taken: number): void {
    if (this.kind !== 'brute' || this.b.stats.sawDps <= 0 || this._dead) return;
    this.sawFury = Math.min(1, this.sawFury + dealt / SAW_FURY_DEALT + taken / SAW_FURY_TAKEN);
  }
  get invulnerable(): boolean {
    return !this._dead && (this.spawnProt > 0 || this.dashT > DASH_SECONDS - DASH_IFRAMES);
  }
  get airborne(): boolean {
    return this.vert.airborne;
  }
  get vy(): number {
    return this.vert.vy;
  }
  get airTime(): number {
    return this.vert.airborne ? this.vert.airTime : 0;
  }
  get deck(): number {
    return this.vert.deck;
  }
  get surfaceY(): number {
    return this.vert.surfaceY;
  }
  /** 0..1 how much the plow is on ice right now (HUD / probes). */
  get onIce(): number {
    return this.ice;
  }
  /** Material under the plow (last terrain step). */
  get material(): string {
    return this.surf.material;
  }
  /** Air slam: dive at `speed` m/s (only while airborne). */
  dive(speed: number): void {
    if (!this.vert.airborne || this._dead) return;
    this.vert.vy = -Math.abs(speed);
  }

  /** Re-bind this plow to another pilot (the online Duel), or back to the single-player singletons (null). */
  bind(binding: PilotBinding | null): void {
    this.b = binding ?? ctxPilot(this.ctx);
    this.applyStats(this.b.stats);
    this.syncLook(true);
  }

  get pilot(): PilotBinding {
    return this.b;
  }

  /** Camera shake from this plow: full strength for the local pilot, a fraction for a duel opponent. */
  private shake(intensity: number): void {
    this.ctx.fx.shake(this.b.local ? intensity : intensity * REMOTE_SHAKE);
  }

  /** The Paint Shop horn on this plow (slam sound layer), if any. */
  get hornSound(): SoundName | null {
    return this.look.horn.sound;
  }

  /** Show / hide the whole plow and its world-space parts (the duel's second plow sits out single-player modes). */
  setInWorld(on: boolean): void {
    this.object.visible = on;
    if (!on) {
      this.ball.visible = false;
      this.glow.visible = false;
      this.tornado.visible = false;
      this.whirlRing.visible = false;
      this.ballWasVisible = false;
      for (const g of this.ghosts) {
        g.active = false;
        g.group.visible = false;
      }
      for (const st of this.streaks) st.active = false;
      this.updateStreaks(0);
      for (const d of this.debris) if (d.popped) d.obj.visible = false;
    } else {
      for (const d of this.debris) d.obj.visible = true;
    }
    this.streakMesh.visible = on;
  }

  /* ------------------------------------------------------------------ duel netcode */

  /** Pack the network-visible state into `out` at offset `o` (layout: NET_PLOW in net/protocol.ts). */
  writeNet(out: Float32Array, o: number): void {
    out[o + NP.x] = this.position.x;
    out[o + NP.z] = this.position.z;
    out[o + NP.heading] = this.heading;
    out[o + NP.speed] = this.speed;
    out[o + NP.hp] = this.hp;
    out[o + NP.maxHp] = this.maxHp;
    out[o + NP.ball] = this.heldVolume;
    out[o + NP.dashCharge] = this.dashCharge;
    out[o + NP.whirlCharge] = this.whirlCharge;
    out[o + NP.dashT] = this.dashT;
    out[o + NP.dashEase] = this.dashEase;
    out[o + NP.whirlT] = this.whirlT;
    out[o + NP.slamPhase] = this.slamPhase;
    out[o + NP.slamT] = this.slamT;
    out[o + NP.hop] = this.hop;
    out[o + NP.spawnProt] = this.spawnProt;
    out[o + NP.dead] = this._dead ? 1 : 0;
    out[o + NP.pushX] = this.pushVel.x;
    out[o + NP.pushZ] = this.pushVel.z;
    out[o + NP.throttle] = this._dead ? 0 : this.b.input.throttle;
    out[o + NP.steer] = this._dead ? 0 : this.b.input.steer;
    out[o + NP.sawFury] = this.sawFury;
    out[o + NP.y] = this.position.y;
    out[o + NP.vy] = this.vert.vy;
    out[o + NP.air] = this.vert.airborne ? 1 : 0;
  }

  /**
   * Duel guest, own plow: pull the locally predicted plow toward the host's view of it. `tx/tz/th` is the host pose
   * (already extrapolated by the caller), `k` the blend fraction this frame (1 = snap). Health, death and the ball
   * follow the host; charges follow it unless the pilot just used that ability locally (`keep*`), so a stale
   * snapshot never re-arms a dash the host has not seen yet.
   */
  netCorrect(s: Float32Array, o: number, tx: number, tz: number, th: number, k: number, keepBall: boolean, keepDash: boolean, keepWhirl: boolean): void {
    const dead = s[o + NP.dead] > 0.5;
    if (!this._dead) {
      this.position.x += (tx - this.position.x) * k;
      this.position.z += (tz - this.position.z) * k;
      let dh = th - this.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.heading += dh * k;
    }
    this.maxHp = s[o + NP.maxHp];
    const hp = s[o + NP.hp];
    if (dead && !this._dead) this.damage(this.hp + 1);
    else if (!this._dead) {
      if (hp < this.hp - 0.01) this.damage(this.hp - hp);
      else this.hp = hp;
    }
    if (this._dead) return;
    if (!keepBall) this.heldVolume = s[o + NP.ball];
    if (!keepDash) this.dashCharge = s[o + NP.dashCharge];
    if (!keepWhirl) this.whirlCharge = s[o + NP.whirlCharge];
    this.spawnProt = s[o + NP.spawnProt];
    this.sawFury = s[o + NP.sawFury];
  }

  /** Duel guest: shove the predicted plow right away when the host reports a knockback on it. */
  netPush(vx: number, vz: number): void {
    this.push(vx, vz);
  }

  /**
   * Duel guest, opponent plow: no simulation at all. Pose, health, ball and ability timers come from the
   * (interpolated) snapshot in `s` at `o`; this only animates them and replays the launch effects (dash blast,
   * whirl tornado + its ticks, wreck explosion) when they start.
   */
  updatePuppet(dt: number, s: Float32Array, o: number): void {
    const stats = this.b.stats;
    this.time += dt;
    if (stats.bladeWidth !== this.bladeWidth) this.setBladeWidth(stats.bladeWidth);
    if (stats.maxHp !== this.maxHp) this.applyStats(stats);
    this.gearVis.update(this.time);
    const dead = s[o + NP.dead] > 0.5;
    const prevHeading = this.heading;
    this.position.x = s[o + NP.x];
    this.position.z = s[o + NP.z];
    this.heading = s[o + NP.heading];
    // Height / flight from the host (updateVisuals places the hull with it). Launches and landings replay locally like
    // the host's own: jump sound; land sound, squash, snow puff and (hard landings) ring, at the touchdown speed (the
    // last airborne vy). No events (Combat's AirKit polls the puppet for stomps / air slams on the host's side only).
    const wasAir = this.puppetAir;
    const lastVy = this.puppetVy;
    this.puppetY = s[o + NP.y];
    this.puppetVy = s[o + NP.vy];
    this.puppetAir = s[o + NP.air] > 0.5;
    if (!dead && !this._dead) {
      if (!wasAir && this.puppetAir) this.b.audio.play('jump', { volume: 0.8 });
      else if (wasAir && !this.puppetAir) {
        const t = this.ctx.terrain;
        const ground = t.active ? t.heightAt(this.position.x, this.position.z, this.puppetY) : 0;
        this.landFx(Math.max(0, -lastVy), ground);
      }
    }
    this.speed = s[o + NP.speed];
    this.maxHp = s[o + NP.maxHp];
    if (dead && !this._dead) {
      this.hp = 0;
      this.die();
    } else if (!dead && this._dead) {
      this.reset({ x: this.position.x, z: this.position.z, heading: this.heading });
    }
    this.updateGhosts(dt);
    this.updateStreaks(dt);
    this.updateTornado(dt);
    if (this._dead) {
      this.updateWreck(dt);
      return;
    }
    const hp = s[o + NP.hp];
    if (hp < this.hp - 0.5) {
      this.flash = 1;
      this.jitter = Math.min(0.2, 0.08 + (this.hp - hp) * 0.004);
    }
    this.hp = hp;
    this.heldVolume = s[o + NP.ball];
    this.dashCharge = s[o + NP.dashCharge];
    this.whirlCharge = s[o + NP.whirlCharge];
    this.spawnProt = s[o + NP.spawnProt];
    if (this.spawnProt > 0) this.body.visible = Math.floor(this.spawnProt * 14) % 2 === 0;
    else this.body.visible = true;
    this.sawFury = s[o + NP.sawFury];
    this.hop = s[o + NP.hop];
    this.slamPhase = s[o + NP.slamPhase] as 0 | 1 | 2;
    this.slamT = s[o + NP.slamT];
    this.lungeVel = 0;
    // Dash: replay the launch once, then follow the host's timers (flame, ghosts and streaks key off them).
    const dT = s[o + NP.dashT];
    if (dT > 0 && this.dashT <= 0 && dT > DASH_SECONDS - 0.3) {
      this.ghostT = 0;
      this.streakT = 0;
      this.kick = Math.max(this.kick, 0.8);
      this.dashFx();
    }
    this.dashT = dT;
    this.dashEase = s[o + NP.dashEase];
    // Whirl: run the local tornado up to the host's whirl clock (ticks replay their sprays and sounds; the puppet's
    // Combat has nothing to hit).
    const wT = s[o + NP.whirlT];
    if (wT >= 0) {
      // Only a fresh whirl starts one (the local tornado can finish a frame before the host's clock does).
      if (this.whirlT < 0 && wT < 0.4) {
        this.whirlT = 0;
        this.whirlTick = 0;
        this.whirlHits.clear();
        this.whirlFx();
      }
      if (this.whirlT >= 0 && wT > this.whirlT) this.updateWhirl(wT - this.whirlT);
    } else if (this.whirlT >= 0) {
      this.whirlT = -1;
      this.spinAngle = 0;
    }
    let dh = this.heading - prevHeading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const turn = dt > 0 ? dh / dt : 0;
    const throttle = s[o + NP.throttle];
    this.updateVisuals(dt, turn, throttle);
    if (this.dashT > 0 || Math.abs(this.speed) > TRAIL_MIN_SPEED) this.emitTrail(dt, this.dashT > 0);
  }

  /** Freeze the plow for `seconds` (impact hit-stop). */
  hitStop(seconds: number): void {
    this.hitStopT = Math.max(this.hitStopT, seconds);
  }

  /** Called by Combat on a DASH STRIKE: hit-stop, then keep dashing at reduced speed. */
  dashImpact(stop: number): void {
    this.hitStop(stop);
    if (this.dashT > 0) {
      this.dashSpeed *= DASH_STRIKE_KEEP;
      this.speed = this.dashSpeed;
    }
    this.kick = 1;
    this.jitter = Math.max(this.jitter, 0.15);
  }

  getForward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  /** ARSENAL mounts in world space: the pulse emitter tip ('muzzle', i wraps), the Grav Lance nose lens ('laser') or
   *  the gyro core at the rear ('gyro'). */
  mountWorld(kind: 'muzzle' | 'laser' | 'gyro', i: number, out: THREE.Vector3): THREE.Vector3 {
    const o = kind === 'laser' ? this.laserMount : kind === 'muzzle' ? this.muzzles[i % this.muzzles.length] : this.gyroMount;
    this.body.updateWorldMatrix(true, true);
    return o.getWorldPosition(out);
  }

  /** World heading the ARSENAL turret is pointing (hull heading + turret yaw). */
  get turretHeading(): number {
    return this.heading + this.turretYaw;
  }

  getBladeTip(out: THREE.Vector3): THREE.Vector3 {
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    return out.set(this.position.x + s * TIP_Z, this.vert.surfaceY, this.position.z + c * TIP_Z);
  }

  damage(amount: number): void {
    if (this._dead || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.flash = 1;
    this.jitter = Math.min(0.2, 0.08 + amount * 0.004);
    if (this.hp <= 0) this.die();
  }

  stealSnow(fraction: number): number {
    const f = THREE.MathUtils.clamp(fraction, 0, 1);
    const v = this.heldVolume * f;
    this.heldVolume -= v;
    if (this.heldVolume < 1e-4) this.heldVolume = 0;
    return v;
  }

  push(vx: number, vz: number): void {
    if (this._dead) return;
    this.pushVel.x += vx;
    this.pushVel.z += vz;
  }

  reset(at?: { x: number; z: number; heading: number }): void {
    const sp = at ?? PLOW_SPAWN;
    this.position.set(sp.x, 0, sp.z);
    this.heading = sp.heading;
    // Terrain: start on the topmost surface at the spawn point (flat arenas: 0, as always).
    const t = this.ctx.terrain;
    const v = this.vert;
    v.surfaceY = t && t.active ? t.surfaceAt(sp.x, sp.z, Infinity, this.surf).y : 0;
    v.deck = t && t.active ? this.surf.deck : -1;
    v.y = v.surfaceY;
    v.vy = 0;
    v.airborne = false;
    v.airTime = 0;
    this.position.y = v.y;
    this.ride = 0;
    this.slopeBoost = 0;
    this.velX = this.velZ = 0;
    this.ice = 0;
    this.burn = 0;
    this.lavaAcc = 0;
    this.lavaEventT = 0;
    this.lavaSfxT = 0;
    this.tiltP = this.tiltR = 0;
    this.squash = 0;
    this.spawnProt = at ? SPAWN_PROTECT : 0;
    this.dashEase = 0;
    this.dashSpeed = 0;
    this.hitStopT = 0;
    this.whirlTick = 0;
    this.sawFury = 0;
    this._sawHalo = 0;
    this.tornadoA = 0;
    this.ringPulse = 0;
    this.tornado.visible = false;
    this.whirlRing.visible = false;
    for (const st of this.streaks) st.active = false;
    this.streakT = 0;
    this.object.rotation.set(0, this.heading, 0);
    this.speed = 0;
    this.lastSpeed = 0;
    this.pushVel.set(0, 0, 0);
    this.hp = this.maxHp;
    this._dead = false;
    this.heldVolume = 0;
    this.ballR = 0;
    this.slamPhase = 0;
    this.slamT = 0;
    this.slamCd = 0;
    this.slamHit = false;
    this.slamBuffer = 0;
    this.lungeVel = 0;
    this.dashCharge = 1;
    this.dashT = 0;
    this.whirlCharge = 1;
    this.whirlT = -1;
    this.whirlHits.clear();
    this.spinAngle = 0;
    this.wallCd = 0;
    this.flash = 0;
    this.jitter = 0;
    this.kick = 0;
    this.slamPose = 0;
    this.roll = 0;
    this.pitch = 0;
    this.wreckT = 0;
    this.ball.visible = false;
    this.ballWasVisible = false;
    this.glow.visible = false;
    this.flame.visible = false;
    this.spin.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.visible = true;
    this.paintMat.color.copy(this.paintBase);
    this.bedMat.color.copy(this.bedBase);
    this.decalMat.color.setRGB(1, 1, 1);
    this.bladeSkinMat.color.setRGB(1, 1, 1);
    this.bladeSkinMat.emissiveIntensity = 0;
    this.paintMat.emissiveIntensity = 0;
    this.bedMat.emissiveIntensity = 0;
    this.headMat.emissiveIntensity = 1.6;
    this.beaconMat.emissiveIntensity = 1;
    for (const d of this.debris) {
      if (d.popped) {
        d.parent.add(d.obj);
        d.popped = false;
      }
      d.obj.position.copy(d.pos);
      d.obj.quaternion.copy(d.quat);
      d.obj.scale.set(1, 1, 1);
    }
    // (Wheels 0 and 3 are debris parts: their pose resets with the rest.)
    this.wheelSpin[0] = this.wheelSpin[3] = 0;
    this.wheelSteer[0] = 0;
    this.wheelsOff = false;
    for (const w of this.wheelDebris) w.visible = false;
    this.writeWheels();
    this.applyBladeScale();
    this.hop = 0;
    this.spin.position.y = 0;
    for (const g of this.ghosts) {
      g.active = false;
      g.group.visible = false;
    }
    this.updateStreaks(0);
  }

  /** Vehicle switched to the snowball kit (stats.snowKit). */
  private snowKit = false;

  /** Not the Classic: no blade, never plows or holds a ball; SPACE / E are the kit's (PLOWS[kind].noBall). */
  get vehicle(): boolean {
    return !!PLOWS[this.kind]?.noBall && !this.snowKit;
  }

  /** E charge 0..1 (the whirl on the Classic, the kit's E ability on the other vehicles). */
  get eCharge(): number {
    return this.whirlCharge;
  }

  /** Combat spends the E charge when a vehicle kit's secondary ability goes off. */
  spendE(): void {
    this.whirlCharge = 0;
  }

  /** Swap the paint job + parts for the selected starter plow. */
  private setKind(kind: PlowKind, snowKit = false): void {
    this.kind = kind;
    this.snowKit = snowKit;
    if (this.vehicle) this.heldVolume = 0;
    const volt = kind === 'volt';
    const brute = kind === 'brute';
    const iso = kind === 'isotope';
    const ars = kind === 'arsenal';
    // Body paint + decals follow the Paint Shop look (factory colours unless a paint is equipped).
    this.syncLook(true);
    // The Classic's blade face is polished steel (it catches the sky: env map in syncLook).
    this.steelMat.color.setHex(volt ? 0x9fe8ff : brute ? 0x7a828e : iso ? 0x9ad63a : kind === 'classic' ? 0xd4dce4 : 0xffd23a);
    this.steelMat.metalness = kind === 'classic' ? 0.85 : 0.55;
    this.steelMat.roughness = kind === 'classic' ? 0.18 : 0.35;
    this.steelMat.emissive.setHex(volt ? 0x1a8cff : iso ? 0x2f8a10 : 0x000000);
    this.steelMat.emissiveIntensity = volt ? 0.6 : iso ? 0.35 : 0;
    this.beaconMat.color.setHex(volt ? 0x7fdcff : iso ? 0x7dff4a : 0xffb000);
    this.beaconMat.emissive.setHex(volt ? 0x2fb8ff : iso ? 0x3dff1a : 0xff9a00);
    this.classicParts.visible = kind === 'classic';
    this.isoParts.visible = iso;
    this.arsenalParts.visible = ars;
    // Only the Classic has a blade (BRUTUS's buzzsaws are on its own mech body).
    this.bladeGroup.visible = kind === 'classic' || !this.vehicle;
    this.applyBladeVis();
    this.voltParts.visible = volt;
    this.bruteParts.visible = brute;
    this.bruteBlade.visible = brute;
    for (const m of this.wheelMeshes) m.visible = !brute && !ars; // BRUTUS runs on tracks, ARSENAL on its own front wheels + gyro
    for (const w of this.wheelDebris) w.visible = this.wheelsOff && !brute && !ars;
    // Dash flame: out of the stack (Classic), a rear thruster (VOLT-9) or the right-hand twin stack (BRUTUS).
    if (volt) {
      this.exhaustTip.set(0, 1.05, -2.05);
      this.flame.rotation.set(-Math.PI / 2, 0, 0);
    } else if (brute) {
      this.exhaustTip.set(0.55, 3.1, -1.45);
      this.flame.rotation.set(0, 0, 0);
    } else if (ars) {
      this.exhaustTip.set(0, 1.17, -3.65); // out of the back of the gyro core
      this.flame.rotation.set(-Math.PI / 2, 0, 0);
    } else if (iso) {
      this.exhaustTip.set(0.55, 2.38, 0.12);
      this.flame.rotation.set(0, 0, 0);
    } else {
      this.exhaustTip.copy(CLASSIC_EXHAUST);
      this.flame.rotation.set(0, 0, 0);
    }
    this.flame.position.copy(this.exhaustTip);
    this.engineTip.set(0, brute ? 2.0 : 1.6, brute ? -1.0 : 1.7);
    this.beaconLight.position.set(0, volt ? 0.4 : brute ? 2.6 : iso ? 2.1 : 2.8, volt ? 0 : brute ? 1.4 : iso ? -1.0 : kind === 'classic' ? -0.1 : 0.8);
    this.applyBladeScale();
  }

  /* ------------------------------------------------------------------ cosmetics */

  /** Re-read the equipped Paint Shop look (+ any shop preview) and repaint / re-decal if it changed. Player plow
   *  only: Brawl rivals and campaign bots build their own materials. */
  private syncLook(force = false): void {
    this.syncGear();
    const look = resolveLook({ ...(this.b.look ?? cosmeticsState(this.ctx.progression).equipped), ...this.preview });
    const key = `${this.kind}|${look.paint.id}|${look.decal.id}|${look.trail.id}|${look.blade.id}|${look.horn.id}|${look.kill.id}`;
    if (!force && key === this.lookKey) return;
    this.lookKey = key;
    this.look = look;
    // Paint: body panels everywhere, the Classic's dump bed as trim, wheel hubs as accent. VOLT glow, BRUTUS
    // hazard stripes and the blade keep their own materials.
    const f = FACTORY_PAINT[this.kind];
    const p = look.paint;
    this.paintBase.setHex(p.body ?? f.body);
    this.bedBase.setHex(p.trim ?? f.trim);
    // ARSENAL's factory finish is gunmetal: semi-metallic panels that pick up the sky (env map) instead of going black.
    const gunmetal = this.kind === 'arsenal' && p.body == null && p.metalness == null;
    this.paintMat.metalness = p.metalness ?? (gunmetal ? 0.45 : 0.15);
    this.paintMat.roughness = p.roughness ?? (gunmetal ? 0.36 : this.kind === 'volt' ? 0.28 : 0.45); // VOLT: glossy ceramic
    this.bedMat.metalness = p.metalness ?? (gunmetal ? 0.4 : 0.1);
    this.bedMat.roughness = p.roughness ?? 0.5;
    // The Classic's factory yellow is a glossy clear coat (low roughness + a faint sky reflection).
    const gloss = this.kind === 'classic' && p.metalness == null && p.roughness == null;
    if (gloss) {
      this.paintMat.metalness = 0;
      this.paintMat.roughness = 0.3;
    }
    const env = p.mirror || gunmetal || gloss ? getPaintEnvMap(this.ctx.renderer) : null;
    if (this.paintMat.envMap !== env) {
      this.paintMat.envMap = this.bedMat.envMap = env;
      this.paintMat.needsUpdate = this.bedMat.needsUpdate = true;
    }
    this.paintMat.envMapIntensity = this.bedMat.envMapIntensity = gunmetal ? 0.8 : gloss ? 0.3 : 1;
    // Classic chrome / tinted glass / polished blade steel reflect the sky; the other kinds' blade steel doesn't.
    const steelEnv = this.kind === 'classic' ? getPaintEnvMap(this.ctx.renderer) : null;
    for (const m of this.kind === 'classic' ? [...this.classicRig.metalMats, this.steelMat] : [this.steelMat]) {
      if (m.envMap === steelEnv) continue;
      m.envMap = steelEnv;
      m.needsUpdate = true;
    }
    if (this.kind === 'arsenal') {
      const metalEnv = getPaintEnvMap(this.ctx.renderer);
      for (const m of this.arsRig.metalMats) {
        if (m.envMap === metalEnv) continue;
        m.envMap = metalEnv;
        m.needsUpdate = true;
      }
    }
    const fh = this.kind === 'volt' ? 0x2f9be0 : this.kind === 'brute' ? 0xffc21a : this.kind === 'isotope' ? 0x7dff4a : 0xffd23a;
    this.hubMat.color.setHex(p.accent ?? (this.kind === 'classic' ? 0xc9d2dc : fh)); // Classic: polished alloy hubs
    if (!this._dead) {
      this.paintMat.color.copy(this.paintBase);
      this.bedMat.color.copy(this.bedBase);
    }
    // Blade skin: a textured material on the main blade sheet (factory steel otherwise).
    const b = look.blade;
    if (b.id !== this.bladeKey) {
      this.bladeKey = b.id;
      if (b.style) {
        const m = this.bladeSkinMat;
        const tex = bladeTexture(b.style);
        // The sheet's UVs run around the curve (u) and along the width (v): turn the canvas a quarter.
        tex.center.set(0.5, 0.5);
        tex.rotation = Math.PI / 2;
        m.map = tex;
        m.metalness = b.metalness ?? 0.3;
        m.roughness = b.roughness ?? 0.45;
        m.envMap = b.mirror ? getPaintEnvMap(this.ctx.renderer) : null;
        m.envMapIntensity = b.mirror ? 1.2 : 1;
        m.needsUpdate = true;
        this.bladeSheet.material = m;
      } else {
        this.bladeSheet.material = this.steelMat;
      }
    }
    // Decal: rebuilt only when the style or the plow body changes.
    const decalKey = `${this.kind}|${look.decal.style ?? ''}`;
    if (decalKey !== this.decalKey) {
      this.decalKey = decalKey;
      if (this.decals) {
        this.body.remove(this.decals);
        const geos = new Set<THREE.BufferGeometry>();
        this.decals.traverse((o) => o instanceof THREE.Mesh && geos.add(o.geometry));
        for (const g of geos) g.dispose();
        this.decals = null;
      }
      if (look.decal.style) {
        this.decals = buildDecals(this.kind, look.decal.style, this.decalMat);
        this.body.add(this.decals);
      }
    }
  }

  /** Equipped gear on the model (duel opponents wear what they brought). The flame tint follows the booster. */
  private syncGear(): void {
    const ids = this.b.gear ?? GearVisuals.idsFrom(this.ctx.progression.gear.equipped);
    this.gearVis.sync(this.kind, ids, this.bladeWidth);
    this.flameMat.color.setHex(this.gearVis.flame ?? (this.kind === 'isotope' ? 0x7dff4a : 0xff8a1a));
  }

  /** Paint Shop: try an item on (null = back to the equipped one for that slot). */
  previewCosmetic(slot: CosmeticSlot, id: string | null): void {
    if (id) this.preview[slot] = id;
    else delete this.preview[slot];
    this.syncLook();
  }

  clearPreview(): void {
    this.preview = {};
    this.syncLook();
  }

  /** Paint Shop backdrop: turn the parked plow on the spot to `yaw` (rad, relative to its heading); `trail` also
   *  runs its cosmetic trail as if cruising. */
  showcase(yaw: number, dt: number, trail: boolean): void {
    this.object.rotation.set(0, this.heading + yaw, 0);
    this.time += dt;
    if (trail) this.emitTrail(dt, false);
  }

  /** Back to the parked pose after the Paint Shop closes. */
  endShowcase(): void {
    this.object.rotation.set(0, this.heading, 0);
  }

  /** Cosmetic trail puffs from both rear corners (throttled; denser while dashing). */
  private emitTrail(dt: number, dash: boolean): void {
    const trail = this.look.trail;
    if (!trail.style) return;
    this.trailT -= dt;
    if (this.trailT > 0) return;
    this.trailT = dash ? TRAIL_EVERY_DASH : TRAIL_EVERY;
    const r = TRAIL_REAR[this.kind];
    const yaw = this.object.rotation.y;
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    for (const sx of [-1, 1]) {
      const x = r.x * sx;
      _c.set(this.position.x + x * c + r.z * s, this.position.y + r.y, this.position.z - x * s + r.z * c);
      emitTrail(this.ctx.fx, trail, _c, dash, this.time + (sx > 0 ? 0.15 : 0));
    }
  }

  /** BRUTUS gets a taller, deeper blade (re-applied after a reset, since the wreck pops restore part scales). */
  private applyBladeScale(): void {
    const brute = this.kind === 'brute';
    const volt = this.kind === 'volt';
    this.bladeGroup.scale.set(1, brute ? BRUTE_BLADE_Y : volt ? 0.82 : 1, brute ? BRUTE_BLADE_Z : volt ? 0.85 : 1);
    // Keep the saws round inside the stretched blade group.
    // (The left saw is mirrored on X so its mounting arm points back at the blade.)
    this.saws.forEach((saw, i) => saw.group.scale.set(i === 0 ? -1 : 1, 1 / this.bladeGroup.scale.y, 1 / this.bladeGroup.scale.z));
  }

  applyStats(stats: PlayerStats): void {
    if (stats.plowKind !== this.kind || !!stats.snowKit !== this.snowKit) this.setKind(stats.plowKind, !!stats.snowKit);
    const ratio = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    this.maxHp = stats.maxHp;
    this.hp = Math.max(0, Math.min(this.maxHp, ratio * this.maxHp));
    if (!this._dead && this.hp <= 0) this.hp = this.maxHp;
    this.setBladeWidth(stats.bladeWidth);
    const cap = ballVolume(stats.maxBallRadius);
    if (this.heldVolume > cap) this.heldVolume = cap;
  }

  private setBladeWidth(w: number): void {
    this.bladeWidth = w;
    // The sheet spans between the hinged wings; the wings fill the outer CLASSIC_WING on each side.
    this.bladeSheet.scale.x = this.classicRig.setWidth(w);
    this.gearVis?.setWidth(w);
    if (w !== this.capsWidth) {
      this.capsWidth = w;
      // The frame + arms cast through one proxy (the sheet keeps its own: it is double-sided and scales).
      for (const m of this.bladeCasters) m.castShadow = true;
      if (this.bladeProxy) {
        this.bladeProxy.removeFromParent();
        this.bladeProxy.geometry.dispose();
      }
      // A bladeless vehicle has nothing here that casts: no proxy (makeShadowProxy returns none).
      this.bladeProxy = makeShadowProxy([this.bladeCaps, this.bladeArms], this.bladeGroup)[0] ?? null;
      if (this.bladeProxy) this.bladeGroup.add(this.bladeProxy);
      this.applyBladeVis();
    }
    // Mounted high (~1.3 m world) so the flat saws ride above the snow and the berms the blade pushes aside.
    this.saws[0].group.position.set(-w / 2 - 0.6, 1.0, 0.45);
    this.saws[1].group.position.set(w / 2 + 0.6, 1.0, 0.45);
    for (const g of this.ghosts) g.blade.scale.x = w;
  }

  /** Blade sheet / caps / arms + ram (+ their shadow proxy): Classic only. */
  private applyBladeVis(): void {
    const on = !this.vehicle;
    for (const o of [this.bladeSheet, this.bladeCaps, this.bladeArms, this.bladeProxy]) if (o) o.visible = on;
  }

  /** Wheel instance matrices from spin / steer (the same Euler -> matrix path the wheel groups took). */
  private writeWheels(): void {
    const im = this.wheelMeshes[0];
    for (let i = 0; i < 4; i++) {
      if (this.wheelsOff && (i === 0 || i === 3)) _m.makeScale(0, 0, 0);
      else {
        _e.set(this.wheelSpin[i], i < 2 ? this.wheelSteer[i] : 0, 0, 'YXZ');
        _m.compose(_p.set(PLOW_WHEEL_POS[i][0], WHEEL_R, PLOW_WHEEL_POS[i][1]), _q.setFromEuler(_e), _one);
      }
      im.setMatrixAt(i, _m);
    }
    im.instanceMatrix.needsUpdate = true;
  }

  /** BRUTUS cleat instances at track phase `phase` (no upload when the tracks haven't moved). */
  private setCleats(phase: number): void {
    if (phase === this.cleatPhase) return;
    this.cleatPhase = phase;
    for (let i = 0; i < this.cleats.length; i++) {
      const c = this.cleats[i];
      const p = c.mesh.position;
      this.cleatMesh.setMatrixAt(i, _m.makeTranslation(p.x, p.y, cleatZ(c.i, c.top, phase, this.cleatSpan)));
    }
    this.cleatMesh.instanceMatrix.needsUpdate = true;
  }

  /* ------------------------------------------------------------------ update */

  update(dt: number): void {
    const ctx = this.ctx;
    const b = this.b;
    const stats = b.stats;
    this.time += dt;
    this.puppetY = null;
    if (stats.bladeWidth !== this.bladeWidth) this.setBladeWidth(stats.bladeWidth);
    if (stats.maxHp !== this.maxHp) this.applyStats(stats);
    this.updateGhosts(dt);
    this.updateStreaks(dt);
    this.updateTornado(dt);

    if (this._dead) {
      this.updateWreck(dt);
      return;
    }

    // Spawn protection: blink.
    if (this.spawnProt > 0) {
      this.spawnProt = Math.max(0, this.spawnProt - dt);
      this.body.visible = this.spawnProt <= 0 || Math.floor(this.spawnProt * 14) % 2 === 0;
    }

    // Impact hit-stop: hold everything still for a few frames.
    if (this.hitStopT > 0) {
      this.hitStopT -= dt;
      if (b.input.wasPressed('Space')) this.slamBuffer = INPUT_BUFFER;
      this.jitter = Math.max(this.jitter, 0.1);
      return;
    }

    const input = b.input;
    const snow = b.snow;
    const maxBallR = stats.maxBallRadius;

    // ---- regen + timers
    if (stats.hpRegen > 0 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + stats.hpRegen * dt);
    if (this.slamCd > 0) this.slamCd -= dt;
    if (this.slamBuffer > 0 && this.whirlT < 0) this.slamBuffer -= dt;
    if (this.wallCd > 0) this.wallCd -= dt;
    if (this.dashT > 0) {
      this.dashT = Math.max(0, this.dashT - dt);
      if (this.dashT <= 0) this.dashEase = DASH_EASE;
    } else {
      if (this.dashEase > 0) this.dashEase = Math.max(0, this.dashEase - dt);
      if (this.dashCharge < 1) this.dashCharge = Math.min(1, this.dashCharge + (stats.dashCooldown > 0 ? dt / stats.dashCooldown : 1));
    }
    // E charge: the whirl's on the Classic; on the other vehicles the kit's E ability (Combat spends it, the kit's
    // ability descriptor sets the recharge).
    const eCd = this.vehicle ? b.combat.secondaryCooldown : stats.whirlCooldown;
    if (this.whirlT < 0 && this.whirlCharge < 1) this.whirlCharge = Math.min(1, this.whirlCharge + (eCd > 0 ? dt / eCd : 1));

    const throttle = input.throttle;
    const steer = input.steer;

    // ---- abilities
    if (input.wasPressed('Space')) this.slamBuffer = INPUT_BUFFER;
    // Only the Classic plows snow, holds a ball and slams / whirls: every other vehicle's SPACE / E belong to its
    // combat kit (Combat.updateVehicle routes them to VehicleKit.primary / secondary).
    const armed = this.vehicle;
    // Airborne and clear of the surface, SPACE is the air slam (Combat's AirKit dives, ball or not): no ground slam,
    // and no 'error' buzz for a missing ball.
    if (armed || (this.vert.airborne && this.vert.y - this.vert.surfaceY >= AIR_SLAM_MIN_HEIGHT)) this.slamBuffer = 0;
    if (this.slamBuffer > 0 && this.slamPhase === 0 && this.slamCd <= 0 && this.whirlT < 0) {
      this.slamBuffer = 0;
      if (this.heldBallRadius >= MIN_BALL_RADIUS) {
        this.slamPhase = 1;
        this.slamT = 0;
        this.slamHit = false;
      } else {
        b.audio.play('error');
      }
    }
    if (input.wasPressed('ShiftLeft') || input.wasPressed('ShiftRight')) this.tryDash();
    if (!armed && input.wasPressed('KeyE')) this.tryWhirl();

    // ---- slam state machine
    this.lungeVel = 0;
    if (this.slamPhase === 1) {
      this.slamT += dt;
      this.speed *= Math.exp(-4 * dt);
      if (this.slamT >= SLAM_WINDUP) {
        this.slamPhase = 2;
        this.slamT = 0;
      }
    } else if (this.slamPhase === 2) {
      this.slamT += dt;
      const tau = Math.min(1, this.slamT / SLAM_LUNGE);
      this.lungeVel = SLAM_LUNGE_SPEED * (1 - tau * tau);
      if (!this.slamHit && this.slamT >= SLAM_IMPACT_AT) this.slamImpact();
      if (this.slamT >= SLAM_LUNGE) this.slamPhase = 0;
    }

    // ---- longitudinal
    const heldR = this.heldBallRadius;
    const maxF = stats.maxSpeed * (1 - 0.2 * Math.min(1, heldR / maxBallR)) * (this.whirlT >= 0 ? WHIRL_SPEED : 1);
    const accel = stats.accel;
    const maxRev = stats.maxSpeed * 0.45;
    // Terrain: no traction in the air (speed carries), less on ice (spinning wheels, long braking, long coasting).
    const air = this.vert.airborne;
    const iceK = this.ice;
    const accK = 1 - (1 - ICE_ACCEL) * iceK;
    const brakeK = 1 - (1 - ICE_BRAKE) * iceK;
    const dragK = 1 - (1 - ICE_DRAG) * iceK;
    if (this.dashT > 0) {
      // Committed lunge: full burst speed, no cap.
      this.speed = this.dashSpeed;
    } else if (air) {
      this.speed *= Math.exp(-0.15 * dt);
    } else if (throttle > 0) {
      if (this.speed < 0) this.speed += accel * 2.2 * brakeK * dt;
      else if (this.speed < maxF) this.speed = Math.min(maxF, this.speed + accel * accK * dt * (1 - 0.35 * (this.speed / maxF)));
    } else if (throttle < 0) {
      if (this.speed > 0) this.speed -= accel * 2.2 * brakeK * dt;
      else if (this.speed > -maxRev) this.speed = Math.max(-maxRev, this.speed - accel * 0.7 * accK * dt);
    } else {
      const drag = (3 + Math.abs(this.speed) * 0.35) * dragK * dt;
      this.speed = Math.abs(this.speed) <= drag ? 0 : this.speed - Math.sign(this.speed) * drag;
    }
    // Slopes: gravity along the slope (faster into dips, slower climbing out). Speed gained downhill past the cap is
    // kept as slopeBoost (it bleeds off slowly) instead of being settled away like a dash.
    if (!air && this.ctx.terrain.active && this.dashT <= 0) {
      this.getForward(_fwd);
      const sa = slopeAccel(this.ctx.terrain, this.surf, _fwd.x, _fwd.z);
      if (sa !== 0) {
        this.speed += sa * dt;
        if (sa > 0 && this.speed > maxF) this.slopeBoost = Math.max(this.slopeBoost, this.speed - maxF);
      }
    }
    if (this.slopeBoost > 0) {
      this.slopeBoost = Math.max(0, Math.min(this.slopeBoost - SLOPE_BOOST_DECAY * dt, this.speed - maxF));
    }
    // Over cap (dash ended / ball got heavier / whirl): settle back — fast ease right after a dash.
    if (!this.dashing && this.speed > maxF + this.slopeBoost && !air) {
      const cap = maxF + this.slopeBoost;
      const rate = this.dashEase > 0 ? Math.max(14, (this.speed - cap) / Math.max(0.06, this.dashEase)) : 14;
      this.speed = Math.max(cap, this.speed - rate * dt);
    }

    // ---- steering
    const absS = Math.abs(this.speed);
    const f = 0.35 + 0.65 * Math.min(1, absS / 4);
    const reversing = this.speed < -0.2 || (absS <= 0.2 && throttle < 0);
    const turn = steer * stats.turnRate * f * (reversing ? -1 : 1) * (this.dashing ? DASH_STEER : this.whirlT >= 0 ? WHIRL_STEER : 1) * (air ? AIR_STEER : 1);
    this.heading += turn * dt;

    // ---- integrate
    this.getForward(_fwd);
    const vf = this.speed + this.lungeVel;
    // Grip: on normal ground the velocity IS forward * speed (as always); on ice it swings toward it slowly (drifts);
    // in the air it keeps its course while the hull turns.
    const wantX = _fwd.x * vf;
    const wantZ = _fwd.z * vf;
    if (air) {
      // keep velX / velZ
    } else if (iceK > 0) {
      const grip = ICE_GRIP + (1 - iceK) * 30;
      const k = 1 - Math.exp(-grip * dt);
      this.velX += (wantX - this.velX) * k;
      this.velZ += (wantZ - this.velZ) * k;
    } else {
      this.velX = wantX;
      this.velZ = wantZ;
    }
    this.position.x += this.velX * dt + this.pushVel.x * dt;
    this.position.z += this.velZ * dt + this.pushVel.z * dt;
    this.pushVel.multiplyScalar(Math.exp(-6.5 * dt));
    // Conveyor strips carry anything standing on them.
    const terr = this.ctx.terrain;
    if (!air && terr.conveyors.length) {
      terr.conveyorAt(this.position.x, this.position.z, this.vert.deck, this.conv);
      this.position.x += this.conv.x * dt;
      this.position.z += this.conv.z * dt;
    }
    this.clampToArena(vf, dt);
    this.collideObstacles(vf, dt);
    if (terr.decks.length) this.collideDecks(vf, dt);
    if (this.dashT > 0) this.dashHits();
    this.terrainStep(dt);

    // ---- plowing
    let plowIntensity = 0;
    _right.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
    // Snow lies on the ground layer only: no plowing (or spilling) on a deck, whatever snow is under it.
    if (this.whirlT < 0 && vf > 0.5 && !armed && !this.vert.airborne && this.vert.deck < 0) {
      const dashing = this.dashT > 0;
      const bx = this.position.x + _fwd.x * BLADE_Z;
      const bz = this.position.z + _fwd.z * BLADE_Z;
      // Dashing carves a wider, cleaner wake.
      const hw = (this.bladeWidth / 2) * (dashing ? 1.2 : 1);
      _a.set(bx - _right.x * hw, 0, bz - _right.z * hw);
      _b.set(bx + _right.x * hw, 0, bz + _right.z * hw);
      const removed = snow.plowLine(_a.x, _a.z, _b.x, _b.z, vf * dt + 0.35, dashing ? 1 : 0.9);
      // Duel guest: the blade still kicks up spray, but only the host's snapshot fills the ball.
      if (removed > 0 && b.authoritative) {
        const cap = ballVolume(maxBallR);
        const add = removed * stats.collectRate;
        const room = Math.max(0, cap - this.heldVolume);
        if (add > room) {
          this.heldVolume = cap;
          const excess = add - room;
          // Spill sideways off the blade ends.
          snow.addSnow(_a.x - _right.x * 0.7, _a.z - _right.z * 0.7, 0.9, excess * 0.5);
          snow.addSnow(_b.x + _right.x * 0.7, _b.z + _right.z * 0.7, 0.9, excess * 0.5);
        } else {
          this.heldVolume += add;
        }
        plowIntensity = Math.min(1, removed / dt / 8);
        if (dashing && removed > 0.005) {
          // Thick wake: snow blasted off both blade ends.
          _a.y = this.vert.surfaceY + 0.6;
          _b.y = this.vert.surfaceY + 0.6;
          ctx.fx.burst(_a, { color: 0xffffff, count: 3, speed: 6, size: 0.26, gravity: 14, life: 0.6 });
          ctx.fx.burst(_b, { color: 0xffffff, count: 3, speed: 6, size: 0.26, gravity: 14, life: 0.6 });
          if (Math.random() < dt * 30) {
            ctx.fx.smoke(_a, { count: 1, color: 0xe2ecf8, size: 0.45, grow: 3.4, life: 0.8, speed: 2.5, up: 1.5, rise: -1, drag: 2.4, spread: 0.3, opacity: 0.5 });
            ctx.fx.smoke(_b, { count: 1, color: 0xe2ecf8, size: 0.45, grow: 3.4, life: 0.8, speed: 2.5, up: 1.5, rise: -1, drag: 2.4, spread: 0.3, opacity: 0.5 });
          }
        }
        if (plowIntensity > 0.02) {
          _a.y = this.vert.surfaceY + snow.getDepth(_a.x, _a.z) + 0.3;
          _b.y = this.vert.surfaceY + snow.getDepth(_b.x, _b.z) + 0.3;
          _dir.set(-_right.x + _fwd.x * 0.5, 0.9, -_right.z + _fwd.z * 0.5).normalize();
          ctx.fx.spray(_a, _dir, plowIntensity);
          _dir.set(_right.x + _fwd.x * 0.5, 0.9, _right.z + _fwd.z * 0.5).normalize();
          ctx.fx.spray(_b, _dir, plowIntensity);
        }
      }
    }
    this.plowSmooth += (plowIntensity - this.plowSmooth) * Math.min(1, dt * 10);
    b.audio.setPlowing(this.plowSmooth < 0.02 ? 0 : this.plowSmooth);

    // ---- whirl
    if (this.whirlT >= 0) this.updateWhirl(dt);

    // ---- visuals
    this.updateVisuals(dt, turn, throttle);
    if (this.dashT > 0 || Math.abs(this.speed) > TRAIL_MIN_SPEED) this.emitTrail(dt, this.dashT > 0);
  }

  /* ------------------------------------------------------------------ abilities */

  private slamImpact(): void {
    const ctx = this.ctx;
    this.slamHit = true;
    this.slamCd = cooldown(SLAM_COOLDOWN, this.b.stats.cooldownMult);
    const r = this.heldBallRadius;
    if (r < 0.2) {
      // Ball got stolen / chipped away mid-windup.
      this.b.audio.play('error');
      return;
    }
    // Snow Reserve (Classic Plow) keeps part of the ball on the blade; the slam still hits with the full radius.
    const volume = this.heldVolume * (1 - this.b.stats.reserveFrac);
    this.heldVolume -= volume;
    if (this.heldBallRadius < 0.2) {
      this.heldVolume = 0;
      this.ballR = 0;
      this.ball.visible = false;
      this.glow.visible = false;
      this.ballWasVisible = false;
    }
    this.getBladeTip(_c);
    this.getForward(_fwd);
    const cx = _c.x + _fwd.x * (r + 0.5);
    const cz = _c.z + _fwd.z * (r + 0.5);
    this.kick = 1;
    this.b.combat.slamAt(cx, cz, r, volume);
  }

  private tryDash(): void {
    const ctx = this.ctx;
    if (this.dashCharge < 1 || this.dashT > 0) {
      if (this.dashT <= 0) this.b.audio.play('error', { volume: 0.4 });
      return;
    }
    const stats = this.b.stats;
    this.dashCharge = 0;
    this.dashT = DASH_SECONDS;
    this.dashEase = 0;
    // Works from a standstill: launch off at least half top speed + the dash burst.
    this.dashSpeed = Math.max(this.speed, stats.maxSpeed * 0.5) + stats.dashPower;
    this.speed = this.dashSpeed;
    this.pushVel.multiplyScalar(0.3);
    this.ghostT = 0;
    this.streakT = 0;
    this.kick = Math.max(this.kick, 0.8);
    this.dashFx();
  }

  /** Dash launch feedback: sound, rear blast, exhaust flare (also replayed for a duel opponent's puppet). */
  private dashFx(): void {
    const ctx = this.ctx;
    this.b.audio.play('dash');
    if (this.look.horn.sound) this.b.audio.play(this.look.horn.sound, { volume: 0.4, pitch: 1.25 });
    // Rear blast: snow kicked back + exhaust flare.
    this.getForward(_fwd);
    _c.set(this.position.x - _fwd.x * REAR_Z, this.vert.surfaceY + 0.5, this.position.z - _fwd.z * REAR_Z);
    ctx.fx.burst(_c, { color: 0xffffff, count: 30, speed: 8, size: 0.26, gravity: 14, life: 0.7 });
    _dir.set(-_fwd.x * 6, 0.6, -_fwd.z * 6);
    ctx.fx.smoke(_c, { count: 12, color: 0xe2ecf8, size: 0.5, grow: 3.4, life: 1.1, speed: 3, up: 1.2, rise: -0.8, drag: 2.2, spread: 0.8, opacity: 0.6, dir: _dir });
    _c.y = this.vert.surfaceY + 0.05;
    ctx.fx.ring(_c, 2.6, 0xffb060);
    this.exhaustWorld(_c);
    ctx.fx.burst(_c, { color: 0xff9a2a, count: 16, speed: 4, size: 0.24, gravity: -4, life: 0.4 });
    this.shake(0.22);
  }

  /** Dash safety net: anything the blade plows into while dashing gets a DASH STRIKE (Combat dedupes per bot). */
  private dashHits(): void {
    const ctx = this.ctx;
    const enemies = this.b.enemies;
    if (!enemies || this.speed < 3) return;
    const tx = this.position.x + _fwd.x * (TIP_Z - 0.4);
    const tz = this.position.z + _fwd.z * (TIP_Z - 0.4);
    const q = enemies.query(tx, tz, this.bladeWidth / 2 + 0.4, this.queryOut);
    const list = this.dashTargets;
    list.length = 0;
    for (let i = 0; i < q.length; i++) list.push(q[i]);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      this.b.combat.playerRam(e, this.speed);
      if (this.hitStopT > 0) break; // one strike per frame; the rest connect after the hit-stop
    }
    list.length = 0;
  }

  private tryWhirl(): void {
    const ctx = this.ctx;
    if (this.whirlT >= 0) return;
    if (this.whirlCharge < 1) {
      this.b.audio.play('error', { volume: 0.4 });
      return;
    }
    this.whirlCharge = 0;
    this.whirlT = 0;
    this.whirlTick = 0;
    this.whirlHits.clear();
    // Cancel a pending slam (the whirl takes over the blade).
    this.slamPhase = 0;
    this.whirlFx();
  }

  /** Whirl start feedback (also replayed for a duel opponent's puppet). */
  private whirlFx(): void {
    const ctx = this.ctx;
    this.b.audio.play('whirl');
    const R = this.whirlRadius();
    this.tornadoR = R;
    _c.set(this.position.x, this.vert.surfaceY + 0.05, this.position.z);
    ctx.fx.ring(_c, R, 0xbfeaff);
    this.shake(0.15);
  }

  private whirlRadius(): number {
    return this.b.stats.whirlRadius + this.bladeWidth / 2 + this.heldBallRadius;
  }

  private updateWhirl(dt: number): void {
    const ctx = this.ctx;
    const stats = this.b.stats;
    this.whirlT += dt;
    const tau = Math.min(1, this.whirlT / WHIRL_SECONDS);
    // Eased: whips up fast, slows at the end.
    const e = tau < 0.5 ? 2 * tau * tau : 1 - 2 * (1 - tau) * (1 - tau);
    this.spinAngle = e * Math.PI * 2 * WHIRL_TURNS;
    const R = this.whirlRadius();
    this.tornadoR += (R - this.tornadoR) * Math.min(1, dt * 8);
    const px = this.position.x;
    const pz = this.position.z;

    // Damage ticks.
    while (this.whirlTick < WHIRL_TICKS.length && this.whirlT >= WHIRL_TICKS[this.whirlTick]) {
      const tick = this.whirlTick++;
      const final = tick === WHIRL_TICKS.length - 1;
      this.b.combat.whirlTick(px, pz, R, this.heldBallRadius, tick, final, this.whirlHits);
      this.ringPulse = final ? 1.6 : 1;
      // Suck snow into the held ball.
      const vol = this.b.snow.collectDisc(px, pz, R * 0.7, 0.35) * stats.collectRate;
      if (vol > 0 && this.b.authoritative) {
        const cap = ballVolume(stats.maxBallRadius);
        this.heldVolume = Math.min(cap, this.heldVolume + vol);
      }
    }

    // Spiral snow flung outward around the funnel.
    const base = this.heading + this.spinAngle * 1.3;
    for (let k = 0; k < 3; k++) {
      const a = base + (k * Math.PI * 2) / 3;
      const s = Math.sin(a);
      const c = Math.cos(a);
      const rr = R * (0.45 + 0.4 * Math.random());
      _c.set(px + s * rr, this.vert.surfaceY + 0.3 + Math.random() * 1.6, pz + c * rr);
      _dir.set(c + s * 0.6, 0.5, -s + c * 0.6).normalize();
      ctx.fx.spray(_c, _dir, 0.9);
    }
    // Snow off the spinning blade tip.
    const vh = this.heading + this.spinAngle;
    const s = Math.sin(vh);
    const c = Math.cos(vh);
    _c.set(px + s * TIP_Z, this.vert.surfaceY + 0.3, pz + c * TIP_Z);
    _dir.set(c, 0.6, -s).normalize();
    ctx.fx.spray(_c, _dir, 1);

    if (tau >= 1) {
      this.whirlT = -1;
      this.spinAngle = 0;
      const count = this.whirlHits.size;
      this.whirlHits.clear();
      if (count >= 3) {
        this.b.events.emit('strike', { count, position: new THREE.Vector3(px, 0, pz) });
        this.b.audio.play('strike');
      }
    }
  }

  /* ------------------------------------------------------------------ terrain */

  /**
   * Vertical motion + surface hazards after the horizontal move (world/terrainMotion.ts). Flat arenas with no patches
   * reduce to "feet at the ride height", exactly the pre-terrain behaviour.
   */
  private terrainStep(dt: number): void {
    const ctx = this.ctx;
    const t = ctx.terrain;
    const v = this.vert;
    const p = this.position;
    const code = stepVertical(t, v, p.x, p.z, this.ride, dt, this.surf);
    if (bonkCeiling(t, v, p.x, p.z, PLOW_HEIGHT)) {
      this.kick = Math.max(this.kick, 0.5);
      this.jitter = Math.max(this.jitter, 0.12);
      this.b.audio.play('wallHit', { volume: 0.6, pitch: 0.8 });
    }
    p.y = v.y;
    if (code === V_LAUNCHED) {
      this.b.events.emit('plowLaunched', { x: p.x, z: p.z, speed: Math.hypot(this.velX, this.velZ) });
      this.b.audio.play('jump', { volume: 0.8 });
    } else if (code === V_LANDED) this.landed(v.impact, v.lastAir);

    // Ice: low grip (blends out over ICE_LINGER after leaving it). Air keeps whatever it had.
    const mat = this.surf.material;
    if (!v.airborne) {
      if (mat === 'ice') this.ice = 1;
      else if (this.ice > 0) this.ice = Math.max(0, this.ice - dt / ICE_LINGER);
    }
    // Lava: burn while touching it (host / single player applies the damage; the glow shows everywhere).
    const onLava = !v.airborne && mat === 'lava';
    this.burn = onLava ? Math.min(1, this.burn + dt * 4) : Math.max(0, this.burn - dt * 1.5);
    if (onLava) {
      if (this.b.authoritative && !this.invulnerable) {
        const dmg = Math.min(this.hp, LAVA_DPS * dt);
        this.hp -= dmg;
        this.lavaAcc += dmg;
        this.lavaEventT -= dt;
        if (this.lavaEventT <= 0 || this.hp <= 0) {
          this.lavaEventT = LAVA_EVENT_GAP;
          this.b.events.emit('plowDamaged', { amount: this.lavaAcc, blocked: 0 });
          this.lavaAcc = 0;
        }
        if (this.hp <= 0) this.damage(1);
      }
      this.lavaSfxT -= dt;
      if (this.lavaSfxT <= 0) {
        this.lavaSfxT = LAVA_SFX_GAP;
        this.b.audio.play('lavaBurn', { volume: 0.7 });
        _c.set(p.x + (Math.random() - 0.5) * 2, v.surfaceY + 0.4, p.z + (Math.random() - 0.5) * 2);
        ctx.fx.burst(_c, { color: 0xff6a1a, count: 6, speed: 3, size: 0.14, gravity: -4, life: 0.5 });
        ctx.fx.burst(_c, { color: 0x2a2a2e, count: 2, speed: 1, size: 0.45, gravity: -3, life: 0.9 });
      }
    } else {
      this.lavaSfxT = 0;
      if (this.lavaAcc > 0 && this.b.authoritative) {
        this.b.events.emit('plowDamaged', { amount: this.lavaAcc, blocked: 0 });
        this.lavaAcc = 0;
      }
      this.lavaEventT = 0;
    }
  }

  /** Touchdown after a real flight: puff, thump, sound, a little speed lost on a hard landing. */
  private landed(impact: number, airTime: number): void {
    const p = this.position;
    this.b.events.emit('plowLanded', { x: p.x, y: p.y, z: p.z, impact, airTime });
    this.speed *= 1 - 0.18 * Math.min(1, impact / 18);
    if (this.b.local) this.ctx.cameraRig.thump(impact);
    this.landFx(impact, this.vert.surfaceY);
  }

  /** What a landing at `impact` m/s looks and sounds like (own landings and the Duel puppet's replayed ones): land
   *  sound, hull squash, screen shake (a fraction for the opponent), snow puff and, on a hard landing, a ring, on the
   *  surface at height `ground`. */
  private landFx(impact: number, ground: number): void {
    const ctx = this.ctx;
    const p = this.position;
    const k = Math.min(1, impact / 18);
    this.b.audio.play('land', { volume: 0.4 + 0.6 * k, pitch: 1.1 - 0.3 * k });
    this.squash = Math.max(this.squash, 0.35 + 0.65 * k);
    this.shake(0.08 + 0.35 * k);
    _c.set(p.x, ground + 0.2, p.z);
    ctx.fx.burst(_c, { color: 0xffffff, count: 10 + Math.round(20 * k), speed: 3 + 5 * k, size: 0.28, gravity: 12, life: 0.7 });
    if (k > 0.3) {
      _c.y = ground + 0.06;
      ctx.fx.ring(_c, 2.5 + 3 * k, 0xe8f4ff);
    }
  }

  /** Deck sides (The Omega Works): body and blade circles are pushed out of any deck they cannot step onto. */
  private collideDecks(vf: number, dt: number): void {
    const t = this.ctx.terrain;
    const p = this.position;
    const bladeOff = TIP_Z - 0.55;
    const bladeR = Math.max(0.9, this.bladeWidth * 0.38);
    for (let k = 0; k < 2; k++) {
      const off = k === 0 ? 0 : bladeOff;
      const cr = k === 0 ? this.radius : bladeR;
      const cx = p.x + _fwd.x * off;
      const cz = p.z + _fwd.z * off;
      let d = t.wallAt(cx, cz, this.vert.y, PLOW_HEIGHT, cr);
      if (d && k === 1) {
        // The blade reaches ~2 m ahead, so going up a ramp it already sits higher than the body's feet: tested from
        // the feet, any grade steeper than STEP_UP / 2 m (and the deck at the top of the ramp) would be a wall.
        // Re-test the blade from its own height: the surface under the body continued uphill to the blade (and, on a
        // ramp deck, that ramp itself extended to the blade, whatever its rotation), or, for a ramp the body is lined
        // up with (driving onto it from its toe), that ramp's height at the blade, skipping that ramp. Sheer sides,
        // pillars and ramp flanks still block it; so does any other deck in the way.
        const v = this.vert;
        const ride = v.y - v.surfaceY;
        let yb = v.y;
        if (!v.airborne) {
          const up = (this.surf.gx * _fwd.x + this.surf.gz * _fwd.z) * off;
          if (up > 0) yb += up;
          const body = v.deck >= 0 ? deckById(t.decks, v.deck) : null;
          if (body && body.rise) yb = Math.max(yb, t.deckTop(body, cx, cz) + ride);
        }
        let skip: Deck | null = null;
        if (this.rampAhead(d)) {
          skip = d;
          yb = Math.max(yb, t.deckTop(d, cx, cz) + ride);
        }
        if (skip || yb > v.y) {
          d = t.wallAt(cx, cz, yb, PLOW_HEIGHT, cr, skip);
          if (d && !skip && this.rampAhead(d)) {
            // The first hit was something else; the ramp we are lined up with turned up behind it.
            skip = d;
            yb = Math.max(yb, t.deckTop(d, cx, cz) + ride);
            d = t.wallAt(cx, cz, yb, PLOW_HEIGHT, cr, skip);
          }
        }
      }
      if (!d) continue;
      t.pushOut(d, cx, cz, cr, this.wallOut);
      let nx = this.wallOut.x - cx;
      let nz = this.wallOut.z - cz;
      const pen = Math.hypot(nx, nz);
      if (pen < 1e-5) continue;
      nx /= pen;
      nz /= pen;
      this.contact(nx, nz, pen, vf, dt);
    }
  }

  /**
   * Is deck d a ramp the plow is driving onto or up (rather than a ramp side beside it)? True when d slopes, the body's
   * centre is inside the ramp's strip (across its width) and the ramp's surface extended back to the body is at most a
   * step above the feet.
   */
  private rampAhead(d: Deck): boolean {
    if (!d.rise) return false;
    const p = this.position;
    const lx = (p.x - d.x) * Math.cos(d.rot) - (p.z - d.z) * Math.sin(d.rot);
    if (Math.abs(lx) > d.hw) return false;
    return this.ctx.terrain.deckTop(d, p.x, p.z) <= this.vert.y + STEP_UP;
  }

  /* ------------------------------------------------------------------ arena */

  private clampToArena(vf: number, dt: number): void {
    const p = this.position;
    const r = this.radius;
    const tx = p.x + _fwd.x * TIP_Z;
    const tz = p.z + _fwd.z * TIP_Z;
    const rx = p.x - _fwd.x * REAR_Z;
    const rz = p.z - _fwd.z * REAR_Z;
    const m = 0.35;
    const loX = Math.max(ARENA.minX + r - p.x, ARENA.minX + m - tx, ARENA.minX + m - rx, 0);
    const hiX = Math.min(ARENA.maxX - r - p.x, ARENA.maxX - m - tx, ARENA.maxX - m - rx, 0);
    const loZ = Math.max(ARENA.minZ + r - p.z, ARENA.minZ + m - tz, ARENA.minZ + m - rz, 0);
    const hiZ = Math.min(ARENA.maxZ - r - p.z, ARENA.maxZ - m - tz, ARENA.maxZ - m - rz, 0);
    const cx = loX > 0 ? loX : hiX;
    const cz = loZ > 0 ? loZ : hiZ;
    if (cx !== 0) this.contact(Math.sign(cx), 0, Math.abs(cx), vf, dt);
    if (cz !== 0) this.contact(0, Math.sign(cz), Math.abs(cz), vf, dt);
  }

  /** Circle obstacles (Brawl pillars / containers / rocks) vs the body circle and the blade circle. */
  private collideObstacles(vf: number, dt: number): void {
    const world = this.ctx.world;
    const obs = world ? world.obstacles : null;
    if (!obs || obs.length === 0) return;
    const b = this.b;
    const bladeR = Math.max(0.9, this.bladeWidth * 0.38);
    const bladeOff = TIP_Z - 0.55;
    // Rams at speed and dashes smash straight through destructible props (they stop nothing).
    const smashes = b.authoritative && (this.dashT > 0 || Math.abs(vf) > PROP_SMASH_SPEED);
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      const p = this.position;
      // Cheap reject.
      const ddx = p.x - o.x;
      const ddz = p.z - o.z;
      const reach = o.r + 4.5;
      if (ddx * ddx + ddz * ddz > reach * reach) continue;
      if (o.breakable && smashes && ddx * ddx + ddz * ddz < (o.r + this.radius + 1.5) ** 2 && world!.breakObstacle(o)) {
        this.kick = Math.max(this.kick, 0.3);
        i--;
        continue;
      }
      for (let k = 0; k < 3; k++) {
        const off = k === 0 ? 0 : k === 1 ? bladeOff : -1.3;
        const cr = k === 0 ? this.radius : k === 1 ? bladeR : 1.1;
        const cx = p.x + _fwd.x * off;
        const cz = p.z + _fwd.z * off;
        let nx = cx - o.x;
        let nz = cz - o.z;
        const min = o.r + cr;
        const d2 = nx * nx + nz * nz;
        if (d2 >= min * min) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-4) {
          nx = -_fwd.x;
          nz = -_fwd.z;
          d = 1;
        } else {
          nx /= d;
          nz /= d;
        }
        this.contact(nx, nz, min - Math.sqrt(d2), vf, dt);
      }
    }
  }

  /** Resolve an overlap of `pen` m against a solid surface with outward unit normal (nx, nz). */
  private contact(nx: number, nz: number, pen: number, vf: number, dt: number): void {
    const ctx = this.ctx;
    this.position.x += nx * pen;
    this.position.z += nz * pen;
    // Ice / air velocity (normal ground recomputes it from the heading every frame anyway).
    const vIn = this.velX * nx + this.velZ * nz;
    if (vIn < 0) {
      this.velX -= vIn * nx * 1.3;
      this.velZ -= vIn * nz * 1.3;
    }
    const vx = _fwd.x * vf + this.pushVel.x;
    const vz = _fwd.z * vf + this.pushVel.z;
    const into = -(vx * nx + vz * nz);
    if (into <= 0) return;
    const fwdInto = -(_fwd.x * nx + _fwd.z * nz) * Math.sign(this.speed || 1);
    // Kill the push component into the surface and bounce off it.
    const pIn = this.pushVel.x * nx + this.pushVel.z * nz;
    if (pIn < 0) {
      this.pushVel.x -= pIn * nx;
      this.pushVel.z -= pIn * nz;
    }
    const dashing = this.dashT > 0;
    if (dashing && fwdInto > 0.45 && into > 4) {
      // Dash straight into a wall: heavy thud, dash over.
      this.dashT = 0;
      this.dashEase = 0;
      this.speed *= 0.2;
      const bounce = Math.min(10, into * 0.3 + 2);
      this.pushVel.x += nx * bounce;
      this.pushVel.z += nz * bounce;
      this.wallCd = 0.4;
      this.kick = 1;
      this.jitter = 0.2;
      this.b.audio.play('wallHit', { volume: 1, pitch: 0.75 });
      this.shake(0.6);
      _c.set(this.position.x - nx * (this.radius + 0.6), this.vert.surfaceY + 1, this.position.z - nz * (this.radius + 0.6));
      ctx.fx.burst(_c, { color: 0xffffff, count: 34, speed: 7, size: 0.26, gravity: 14, life: 0.8 });
      ctx.fx.burst(_c, { color: 0xffc04a, count: 18, speed: 10, size: 0.08, gravity: 22, life: 0.35 });
      ctx.fx.burst(_c, { color: 0x8c96a4, count: 8, speed: 5, size: 0.2, gravity: 18, life: 0.6 });
      return;
    }
    if (into > 2) {
      const bounce = into * 0.35 + 1;
      this.pushVel.x += nx * bounce;
      this.pushVel.z += nz * bounce;
      if (fwdInto > 0.2 && !dashing) this.speed *= 1 - 0.6 * Math.min(1, fwdInto);
    } else if (fwdInto > 0.2 && !dashing) {
      this.speed *= Math.exp(-6 * fwdInto * dt);
    }
    if (into > 5 && this.wallCd <= 0) {
      this.wallCd = 0.3;
      this.b.audio.play('wallHit', { volume: Math.min(1, 0.4 + into * 0.04) });
      this.shake(Math.min(0.45, 0.12 + (into - 5) * 0.03));
      _c.set(this.position.x - nx * (this.radius + 0.4), this.vert.surfaceY + 1, this.position.z - nz * (this.radius + 0.4));
      ctx.fx.burst(_c, { color: 0xffffff, count: 10 + Math.round(into), speed: 4, size: 0.2, gravity: 14, life: 0.6 });
      ctx.fx.burst(_c, { color: 0xffc04a, count: 6, speed: 6, size: 0.07, gravity: 22, life: 0.3 });
    }
  }

  /* ------------------------------------------------------------------ death */

  private die(): void {
    const ctx = this.ctx;
    this._dead = true;
    this.hp = 0;
    this.wreckT = 0;
    this.slamPhase = 0;
    this.dashT = 0;
    this.dashEase = 0;
    this.hitStopT = 0;
    this.spawnProt = 0;
    this.body.visible = true;
    this.whirlT = -1;
    this.whirlHits.clear();
    this.spinAngle = 0;
    this.spin.rotation.y = 0;
    this.b.audio.setPlowing(0);
    this.plowSmooth = 0;

    // Drop the held ball as loose snow.
    if (this.heldVolume > 0) {
      const r = this.heldBallRadius;
      this.ballCenter(_c, r, this.heading, 0);
      if (this.vert.deck < 0) this.b.snow.addSnow(_c.x, _c.z, Math.max(1, r * 1.5), this.heldVolume); // decks carry no snow
      ctx.fx.burst(_c, { color: 0xffffff, count: 16, speed: 3, size: 0.3, gravity: 10, life: 0.9 });
      this.heldVolume = 0;
    }
    this.ball.visible = false;
    this.glow.visible = false;
    this.ballR = 0;

    // Explosion.
    this.wreckGround = this.vert.surfaceY;
    _c.set(this.position.x, this.vert.surfaceY + 1.4, this.position.z);
    ctx.fx.burst(_c, { color: 0xff7a1a, count: 46, speed: 10, size: 0.3, gravity: 6, life: 0.7 });
    ctx.fx.burst(_c, { color: 0xffd23a, count: 24, speed: 13, size: 0.1, gravity: 22, life: 0.5 });
    ctx.fx.burst(_c, { color: 0x26262b, count: 30, speed: 4, size: 0.6, gravity: -3, life: 1.8 });
    ctx.fx.burst(_c, { color: 0x8c96a4, count: 14, speed: 8, size: 0.2, gravity: 22, life: 1.0 });
    ctx.fx.fireball(_c, 1.3);
    _c.y = this.vert.surfaceY;
    ctx.fx.ring(_c, 5, 0xff7a1a);
    ctx.fx.scorch(_c, 3);

    // Wheels 0 and 3 fly off: their stand-ins take over the pose and the instances go away.
    this.wheelDebris.forEach((w, k) => {
      const i = k ? 3 : 0;
      w.rotation.set(this.wheelSpin[i], i < 2 ? this.wheelSteer[i] : 0, 0);
      w.visible = this.kind !== 'brute' && this.kind !== 'arsenal';
    });
    this.wheelsOff = true;
    this.writeWheels();
    // Pop parts off as debris.
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    for (const d of this.debris) {
      if (d.popped) continue;
      d.popped = true;
      ctx.scene.attach(d.obj);
      // Fling outward from the truck center (blade goes forward).
      _a.copy(d.obj.position).sub(this.position);
      _a.y = 0;
      if (_a.lengthSq() < 0.01) _a.set(s, 0, c);
      _a.normalize();
      const out = d.obj === this.bladeGroup ? 4 : 3 + Math.random() * 4;
      d.vel.set(_a.x * out + (Math.random() - 0.5) * 2, 6 + Math.random() * 5, _a.z * out + (Math.random() - 0.5) * 2);
      d.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14);
    }
    this.beaconLight.intensity = 0;
    this.beaconMat.emissiveIntensity = 0;
    this.headMat.emissiveIntensity = 0;
    this.flame.visible = true;
    this.jitter = 0.2;

    this.b.events.emit('plowDestroyed', {});
  }

  private updateWreck(dt: number): void {
    const ctx = this.ctx;
    this.wreckT += dt;

    // Slide to a halt.
    this.speed *= Math.exp(-4 * dt);
    this.getForward(_fwd);
    this.position.x += _fwd.x * this.speed * dt + this.pushVel.x * dt;
    this.position.z += _fwd.z * this.speed * dt + this.pushVel.z * dt;
    this.pushVel.multiplyScalar(Math.exp(-5 * dt));
    this.position.x = THREE.MathUtils.clamp(this.position.x, ARENA.minX + this.radius, ARENA.maxX - this.radius);
    this.position.z = THREE.MathUtils.clamp(this.position.z, ARENA.minZ + this.radius, ARENA.maxZ - this.radius);
    // A wreck still falls / follows the ground (flat arenas: it stays put, as always).
    const tv = this.vert;
    if (tv.airborne || this.ctx.terrain.active) {
      stepVertical(this.ctx.terrain, tv, this.position.x, this.position.z, this.ride, dt, this.surf);
      this.position.y = tv.y;
    }
    this.object.rotation.set(this.tiltP, this.heading, this.tiltR);

    // Slump onto the missing wheels + jitter.
    const k = Math.min(1, dt * 6);
    this.roll += (0.14 - this.roll) * k;
    this.pitch += (0.09 - this.pitch) * k;
    this.jitter = Math.max(0, this.jitter - dt);
    const j = this.jitter;
    this.body.rotation.set(this.pitch, 0, this.roll + (Math.random() - 0.5) * j * 0.15);
    this.body.position.set((Math.random() - 0.5) * j * 0.3, -0.12 * Math.min(1, this.wreckT * 4), (Math.random() - 0.5) * j * 0.3);

    // Char the paint, dim emissive flash.
    const ch = Math.min(1, this.wreckT * 2.5) * 0.8;
    this.paintMat.color.lerpColors(this.paintBase, this.charColor, ch);
    this.bedMat.color.lerpColors(this.bedBase, this.charColor, ch * 0.85);
    this.decalMat.color.setScalar(1 - ch * 0.85);
    this.decalMat.emissiveIntensity = 0.3 * (1 - ch);
    this.bladeSkinMat.color.setScalar(1 - ch * 0.75);
    this.flash = Math.max(0, this.flash - dt * 3);
    this.paintMat.emissiveIntensity = this.flash * 1.4 + 0.25 * (0.5 + 0.5 * Math.sin(this.time * 23));
    this.bedMat.emissiveIntensity = this.flash * 1.4;
    this.bladeSkinMat.emissiveIntensity = this.flash * 1.4;

    // Fire from the stack and smoke from the engine.
    this.flame.scale.set(2.2, 1.6 + Math.random() * 1.6, 2.2);
    this.flameMat.color.setHSL(0.03 + Math.random() * 0.06, 1, 0.5);
    this.puffT -= dt;
    if (this.puffT <= 0) {
      this.puffT = 0.05;
      this.engineWorld(_c);
      ctx.fx.burst(_c, { color: 0x1d1d22, count: 3, speed: 1.4, size: 0.55, gravity: -3, life: 1.6 });
      ctx.fx.burst(_c, { color: 0xff6a1a, count: 2, speed: 1.6, size: 0.25, gravity: -5, life: 0.4 });
      _c.set(this.position.x + (Math.random() - 0.5) * 1.6, this.vert.surfaceY + 1.4, this.position.z + (Math.random() - 0.5) * 1.6);
      ctx.fx.burst(_c, { color: 0x3a3a40, count: 2, speed: 0.8, size: 0.7, gravity: -2, life: 1.8 });
    }

    // Debris physics.
    for (const d of this.debris) {
      if (!d.popped) continue;
      const o = d.obj;
      d.vel.y -= 22 * dt;
      o.position.addScaledVector(d.vel, dt);
      o.rotation.x += d.spin.x * dt;
      o.rotation.y += d.spin.y * dt;
      o.rotation.z += d.spin.z * dt;
      if (o.position.y < d.rest + this.wreckGround) {
        o.position.y = d.rest + this.wreckGround;
        if (d.vel.y < 0) d.vel.y *= -0.3;
        d.vel.x *= 0.6;
        d.vel.z *= 0.6;
        d.spin.multiplyScalar(0.6);
      }
    }
  }

  /* ------------------------------------------------------------------ visuals */

  private exhaustWorld(out: THREE.Vector3): THREE.Vector3 {
    out.copy(this.exhaustTip);
    return this.body.localToWorld(out);
  }

  private engineWorld(out: THREE.Vector3): THREE.Vector3 {
    out.copy(this.engineTip);
    return this.body.localToWorld(out);
  }

  /** Center of a ball of radius r sitting on the blade, with the truck facing `vh`, pushed `extra` m forward. */
  private ballCenter(out: THREE.Vector3, r: number, vh: number, extra: number): THREE.Vector3 {
    const s = Math.sin(vh);
    const c = Math.cos(vh);
    const d = TIP_Z + this.body.position.z + r + extra;
    out.set(this.position.x + s * d, 0, this.position.z + c * d);
    const t = this.ctx.terrain;
    if (this.vert.airborne || (this.puppetY !== null && this.puppetAir)) out.y = this.position.y + r * 0.95;
    else if (!t.active) out.y = this.ctx.snow.getDepth(out.x, out.z) + r;
    else {
      t.surfaceAt(out.x, out.z, this.position.y, _ballSurf);
      out.y = _ballSurf.y + (_ballSurf.deck < 0 ? this.ctx.snow.getDepth(out.x, out.z) : 0) + r;
    }
    return out;
  }

  private spawnStreak(): void {
    let st: Streak | null = null;
    for (const x of this.streaks) {
      if (!x.active) {
        st = x;
        break;
      }
    }
    if (!st) return;
    const side = Math.random() < 0.5 ? -1 : 1;
    const lat = side * (1.3 + Math.random() * 2.2);
    const lon = -1 + Math.random() * 5;
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    st.active = true;
    st.age = 0;
    st.h = this.heading;
    st.len = 2.5 + Math.random() * 3.5;
    st.x = this.position.x + s * lon + c * lat;
    st.z = this.position.z + c * lon - s * lat;
    st.y = this.vert.surfaceY + 0.3 + Math.random() * 2.4;
  }

  private updateStreaks(dt: number): void {
    const mesh = this.streakMesh;
    let any = false;
    for (let i = 0; i < MAX_STREAKS; i++) {
      const st = this.streaks[i];
      if (!st.active) {
        if (dt === 0) {
          _m.makeScale(0, 0, 0);
          mesh.setMatrixAt(i, _m);
          any = true;
        }
        continue;
      }
      st.age += dt;
      const t = st.age / STREAK_LIFE;
      any = true;
      if (t >= 1) {
        st.active = false;
        _m.makeScale(0, 0, 0);
        mesh.setMatrixAt(i, _m);
        continue;
      }
      _q.setFromAxisAngle(_up, st.h);
      _a.set(st.x, st.y, st.z);
      _s.set(1, 1, st.len * (1 + t * 0.6));
      _m.compose(_a, _q, _s);
      mesh.setMatrixAt(i, _m);
      const f = (1 - t) * 0.9;
      mesh.setColorAt(i, _col.setRGB(f * 0.85, f * 0.93, f));
    }
    if (any) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private updateTornado(dt: number): void {
    const whirling = this.whirlT >= 0 && !this._dead;
    const target = whirling ? (this.whirlT > WHIRL_SECONDS - 0.15 ? 0.6 : 1) : 0;
    this.tornadoA += (target - this.tornadoA) * Math.min(1, dt * (whirling ? 14 : 6));
    this.ringPulse = Math.max(0, this.ringPulse - dt * 5);
    if (this.tornadoA < 0.01 && this.ringPulse <= 0) {
      this.tornadoA = 0;
      this.tornado.visible = false;
      this.whirlRing.visible = false;
      return;
    }
    const R = this.tornadoR;
    const a = this.tornadoA;
    const p = this.position;
    this.tornado.visible = true;
    this.tornado.position.set(p.x, this.vert.surfaceY, p.z);
    const h = 3.2 + R * 0.25;
    const swell = 0.85 + 0.15 * a + 0.05 * this.ringPulse;
    this.tornadoOuter.scale.set(R * swell, h, R * swell);
    this.tornadoInner.scale.set(R * 0.62 * swell, h * 0.8, R * 0.62 * swell);
    this.tornadoOuter.rotation.y -= dt * 9;
    this.tornadoInner.rotation.y -= dt * 14;
    const mo = this.tornadoMatO.map!;
    const mi = this.tornadoMatI.map!;
    mo.offset.x = (mo.offset.x + dt * 0.9) % 1;
    mo.offset.y = (mo.offset.y - dt * 0.6) % 1;
    mi.offset.x = (mi.offset.x - dt * 1.3) % 1;
    mi.offset.y = (mi.offset.y - dt * 0.9) % 1;
    this.tornadoMatO.opacity = a * (0.75 + 0.25 * this.ringPulse);
    this.tornadoMatI.opacity = a * 0.55;
    this.whirlRing.visible = true;
    this.whirlRing.position.set(p.x, this.vert.surfaceY + (this.ctx.snow && this.vert.deck < 0 ? this.ctx.snow.getDepth(p.x, p.z) + 0.08 : 0.08), p.z);
    this.whirlRing.scale.setScalar(R * (1 + 0.06 * this.ringPulse));
    this.whirlRingMat.opacity = Math.min(1, a * 0.4 + this.ringPulse * 0.5);
  }

  private spawnGhost(): void {
    let g = this.ghosts.find((x) => !x.active);
    if (!g) {
      g = this.ghosts[0];
      for (const x of this.ghosts) if (x.age > g.age) g = x;
    }
    g.active = true;
    g.age = 0;
    g.group.visible = true;
    g.group.position.copy(this.position);
    g.group.rotation.set(0, this.heading + this.spinAngle, 0);
    g.blade.visible = !this.vehicle;
    if (this.kind === 'volt') g.mat.color.setHSL(0.54 + Math.random() * 0.03, 1, 0.6);
    else if (this.kind === 'brute') g.mat.color.setHSL(0.13 + Math.random() * 0.02, 1, 0.5);
    else if (this.kind === 'isotope') g.mat.color.setHSL(0.3 + Math.random() * 0.03, 1, 0.55);
    else g.mat.color.setHSL(0.07 + Math.random() * 0.03, 1, 0.55);
  }

  private updateGhosts(dt: number): void {
    for (const g of this.ghosts) {
      if (!g.active) continue;
      g.age += dt;
      const t = g.age / 0.28;
      if (t >= 1) {
        g.active = false;
        g.group.visible = false;
        continue;
      }
      g.mat.opacity = 0.32 * (1 - t);
      g.group.scale.set(1 + t * 0.08, 1 + t * 0.04, 1 + t * 0.12);
    }
  }

  private updateVisuals(dt: number, turn: number, throttle: number): void {
    const ctx = this.ctx;
    const stats = this.b.stats;
    const snow = this.b.snow;
    const absS = Math.abs(this.speed);
    this.spin.rotation.y = this.spinAngle;
    this.spin.position.y = this.hop;

    // Ride height: sink a little into the snow, bob more in deep snow (ground only: decks carry no snow).
    const depth = this.vert.deck < 0 ? snow.getDepth(this.position.x, this.position.z) : 0;
    this.bobT += dt * (3 + absS * 1.4);
    const bob = Math.sin(this.bobT) * (0.015 + Math.min(0.05, depth * 0.08)) * Math.min(1, absS / 3 + 0.25);
    const targetY = Math.min(0.25, depth * 0.3);
    this.ride += (targetY - this.ride) * Math.min(1, dt * 6);
    const v = this.vert;
    const terr = ctx.terrain;
    if (this.puppetY !== null) {
      // Duel opponent: the host's height when there is terrain or a flight to show, else the local ride (as always).
      if (terr.active || this.puppetAir) this.position.y = this.puppetY;
      else this.position.y = this.ride;
      if (terr.active) terr.surfaceAt(this.position.x, this.position.z, this.position.y, this.surf);
      v.surfaceY = terr.active ? this.surf.y : 0;
    } else if (!v.airborne) this.position.y = v.y = v.surfaceY + this.ride;

    // Terrain tilt: the hull pitches / rolls to the surface (smoothed); in the air it noses along the flight path.
    let wantP = 0;
    let wantR = 0;
    const flying = this.puppetY !== null ? this.puppetAir : v.airborne;
    if (flying) {
      const fvy = this.puppetY !== null ? this.puppetVy : v.vy;
      wantP = THREE.MathUtils.clamp(-Math.atan2(fvy, Math.max(4, absS)) * 0.6, -0.45, 0.45);
      wantR = this.tiltR * 0.5;
    } else if (terr.active) {
      const sh = Math.sin(this.heading);
      const ch = Math.cos(this.heading);
      const sf = this.surf;
      wantP = -Math.atan(sf.gx * sh + sf.gz * ch);
      wantR = Math.atan(sf.gx * ch - sf.gz * sh);
    }
    if (wantP !== 0 || wantR !== 0 || this.tiltP !== 0 || this.tiltR !== 0) {
      const tk = Math.min(1, dt * (flying ? 4 : 12));
      this.tiltP += (wantP - this.tiltP) * tk;
      this.tiltR += (wantR - this.tiltR) * tk;
      if (Math.abs(this.tiltP) < 1e-5 && wantP === 0) this.tiltP = 0;
      if (Math.abs(this.tiltR) < 1e-5 && wantR === 0) this.tiltR = 0;
    }
    this.object.rotation.set(this.tiltP, this.heading, this.tiltR);
    this.squash = Math.max(0, this.squash - dt * 5);

    // Lean into turns, pitch with acceleration, slam rear-back / lunge, recoil kick.
    const lean = THREE.MathUtils.clamp(turn * Math.min(1, absS / 6) * 0.07, -0.12, 0.12);
    this.roll += (-lean - this.roll) * Math.min(1, dt * 6);
    const acc = (this.speed - this.lastSpeed) / Math.max(dt, 1e-4);
    this.lastSpeed = this.speed;
    const targetPitch = THREE.MathUtils.clamp(-acc * 0.004, -0.06, 0.06);
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 5);
    const poseTarget = this.slamPhase === 1 ? -1 : this.slamPhase === 2 && this.slamT < SLAM_LUNGE * 0.7 ? 1 : 0;
    this.slamPose += (poseTarget - this.slamPose) * Math.min(1, dt * (poseTarget === 0 ? 12 : 35));
    const sp = this.slamPose;
    const poseP = sp < 0 ? 0.12 * sp : 0.07 * sp;
    const poseZ = sp < 0 ? 0.4 * sp : 0.35 * sp;
    this.kick = Math.max(0, this.kick - dt * 4);
    const kickP = Math.sin(this.kick * Math.PI) * 0.08 * this.kick;
    this.jitter = Math.max(0, this.jitter - dt);
    const j = this.jitter > 0 ? this.jitter / 0.2 : 0;
    const jx = j > 0 ? (Math.random() - 0.5) * 0.14 * j : 0;
    const jz = j > 0 ? (Math.random() - 0.5) * 0.14 * j : 0;
    this.body.rotation.set(this.pitch + poseP - kickP, 0, this.roll + jx * 0.4);
    this.body.position.set(jx, bob + (this.whirlT >= 0 ? 0.08 : 0) - this.squash * 0.18, poseZ - kickP * 1.5 + jz);
    // The blade rams punch out with the slam lunge (the held ball rides 0.15 m further out too; see ballCenter).
    this.bladeGroup.position.z = BLADE_Z - 0.1 + (sp > 0 ? 0.15 * sp : 0);

    // Buzzsaws: always spinning, screaming faster with speed and fury; the halos grow with the spin.
    const sawsOn = this.kind === 'brute' && stats.sawDps > 0;
    this.sawFury = sawsOn ? Math.max(0, this.sawFury - dt * SAW_FURY_DRAIN) : 0;
    const sawSpin = (SAW_SPIN_BASE + absS * 1.5) * (1 + SAW_FURY_SPIN * this.sawFury);
    const haloTarget = sawsOn && !this._dead ? THREE.MathUtils.clamp((sawSpin - SAW_SPIN_BASE) / SAW_SPIN_FULL, 0, 1) : 0;
    this._sawHalo += (haloTarget - this._sawHalo) * Math.min(1, dt * 6);
    const h = this._sawHalo;
    for (let i = 0; i < this.saws.length; i++) {
      const saw = this.saws[i];
      saw.group.visible = sawsOn;
      if (!sawsOn) continue;
      saw.rotor.rotation.y += dt * sawSpin;
      const flicker = 1 + Math.sin(this.bobT * 7 + i * 2) * 0.03 * h;
      saw.halo.scale.setScalar(SAW_R * (1.3 + 1.9 * h) * flicker);
      saw.halo.material.opacity = 0.55 + 0.45 * h;
      saw.halo.material.color.copy(_haloCool).lerp(_haloHot, this.sawFury);
    }

    // Wheels.
    const spin = ((this.speed + this.lungeVel) * dt) / WHEEL_R;
    const st = this.b.input.steer * 0.35;
    if (spin !== 0 || st !== this.wheelSteer[0] || st !== this.wheelSteer[1]) {
      for (let i = 0; i < 4; i++) this.wheelSpin[i] += spin;
      this.wheelSteer[0] = this.wheelSteer[1] = st;
      this.writeWheels();
    }
    // BRUTUS: cleats crawl round the track loops (bottom run stays put on the ground, top run moves forward).
    if (this.kind === 'brute') {
      this.trackPhase += (this.speed + this.lungeVel) * dt;
      this.setCleats(this.trackPhase);
    }

    // Beacon.
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 9);
    const lowHp = this.hp < this.maxHp * 0.3;
    const pf = lowHp ? 0.5 + 0.5 * Math.sin(this.time * 22) : pulse;
    this.beaconMat.emissiveIntensity = 0.6 + pf * 2.2;
    this.beaconLight.intensity = 2 + pf * 8;
    this.beaconLight.color.setHex(lowHp ? 0xff3020 : this.kind === 'volt' ? 0x4fc8ff : this.kind === 'isotope' ? 0x5dff3a : this.kind === 'arsenal' ? 0x38e8ff : 0xffa020);
    // ISOTOPE: the reactor core breathes; it flickers hot while Meltdown recharges.
    if (this.kind === 'arsenal') {
      // Turret swings toward Combat's target (relative yaw, wrapped), sensor glow breathes.
      let d = this.turretAim - this.turretYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.turretYaw += d * Math.min(1, dt * 12);
      this.turret.rotation.y = this.turretYaw;
      // Pulse laser: the coils and fins spin up while firing, wind down slowly after.
      const want = this.gunFiring ? 16 : 0;
      this.minigunSpin += (want - this.minigunSpin) * Math.min(1, dt * (this.gunFiring ? 8 : 1.6));
      this.minigun.rotation.z += this.minigunSpin * dt;
      // Barrels tilt to the aim (eased: the kit already slews it; this smooths snapshot steps in a duel).
      this.gunTilt += (this.gunPitch - this.gunTilt) * Math.min(1, dt * 14);
      this.gunMount.rotation.x = -this.gunTilt;
      this.armGlowMat.emissiveIntensity = 1.1 + 0.4 * Math.sin(this.ctx.time * 5) + this.gyroCharge * 1.5;
      // Gyro core, front wheels, hover bob. The rings snap flat fast and unfold a little slower.
      this.gyroFlatEase += (this.gyroFlat - this.gyroFlatEase) * Math.min(1, dt * (this.gyroFlat > this.gyroFlatEase ? 14 : 4));
      this.arsRig.update(dt, { speed: this.speed, firing: this.gunFiring, flat: this.gyroFlatEase, charge: this.gyroCharge });
    }
    if (this.kind === 'isotope') {
      const ready = this.b.combat?.flameReady ?? 1;
      const flick = ready < 1 ? 0.5 + 0.5 * Math.sin(this.time * 25) : 0.5 + 0.5 * Math.sin(this.time * 3);
      this.coreMat.emissiveIntensity = 1.1 + flick * (ready < 1 ? 0.3 : 0.9);
      this.beaconLight.intensity = 2.5 + flick * 3;
    }
    if (this.kind === 'volt') {
      this.beaconLight.intensity = 3 + pf * 3;
      this.underglowMat.opacity = 0.28 + 0.12 * Math.sin(this.time * 6) + (this.dashT > 0 ? 0.3 : 0);
      this.voltRig.update(dt, { arc: this.voltArc, field: this.voltField });
    }
    // VOLT-9: pulsing coils + arcs jumping between them.
    if (this.kind === 'volt') {
      this.coilMat.emissiveIntensity = 1.2 + 0.8 * Math.sin(this.time * 14) * Math.sin(this.time * 5.3);
      this.arcT -= dt;
      if (this.arcT <= 0 && this.coilTops.length === 2) {
        this.arcT = 0.15 + Math.random() * 0.35;
        const a = this.coilTops[0].getWorldPosition(_a);
        const b = this.coilTops[1].getWorldPosition(_b);
        this.b.combat?.lightning.bolt(a, b, { life: 0.12, width: 0.1, jag: 0.25 });
      }
    }
    this.beaconSpinner.rotation.y += dt * (lowHp ? 16 : 9);
    // Classic: spreader disc, hopper gauge (held snow), Inferno burners + fuel cell glow.
    if (this.kind === 'classic') {
      const maxR = this.b.stats.maxBallRadius;
      this.classicRig.update(dt, { speed: this.speed, fill: maxR > 0 ? this.ballR / maxR : 0, flame: this.b.combat?.flameReady ?? -1 });
    }

    // Damage flash.
    this.flash = Math.max(0, this.flash - dt * 4);
    const fl = this.flash * 1.4;
    // Lava burn: a hot red glow pulsing on the paint while it cooks.
    const burnGlow = this.burn > 0 ? this.burn * (0.45 + 0.25 * Math.sin(this.time * 18)) : 0;
    this.paintMat.emissiveIntensity = Math.max(fl, burnGlow);
    this.bedMat.emissiveIntensity = Math.max(fl, burnGlow);
    this.bladeSkinMat.emissiveIntensity = fl;

    // Dash flame + afterimages / exhaust puffs.
    const dashing = this.dashT > 0;
    this.flame.visible = dashing;
    if (dashing) {
      const s = 1.6 + Math.random() * 1.2;
      this.flame.scale.set(1.6, s, 1.6);
      // Flicker; a booster item's tint (gear) replaces the plow's own hue.
      const tint = this.gearVis.flame;
      if (tint !== null) this.flameMat.color.setHex(tint).multiplyScalar(0.85 + Math.random() * 0.3);
      else this.flameMat.color.setHSL(this.kind === 'volt' ? 0.53 + Math.random() * 0.04 : 0.06 + Math.random() * 0.05, 1, this.kind === 'volt' ? 0.65 : 0.55);
      this.ghostT -= dt;
      if (this.ghostT <= 0) {
        this.ghostT = 0.05;
        this.spawnGhost();
      }
    }
    if (dashing || this.dashEase > 0) {
      this.streakT -= dt;
      while (this.streakT <= 0) {
        this.streakT += dashing ? 0.012 : 0.04;
        this.spawnStreak();
      }
    }
    this.puffT -= dt;
    if (this.puffT <= 0) {
      this.puffT = dashing ? 0.035 : throttle !== 0 ? 0.18 : 0.45;
      if (this.kind === 'classic') this.exhaustTip.x = -this.exhaustTip.x; // twin stacks take turns
      this.exhaustWorld(_c);
      // VOLT-9 is electric: cyan sparks instead of diesel smoke. BRUTUS belches thick black smoke.
      if (this.kind === 'volt') {
        if (dashing || throttle !== 0) ctx.fx.burst(_c, { color: 0x7fdcff, count: dashing ? 3 : 1, speed: dashing ? 2.5 : 1, size: 0.1, gravity: 2, life: 0.3 });
      } else {
        const brute = this.kind === 'brute';
        ctx.fx.burst(_c, dashing
          ? { color: 0xff9a2a, count: 3, speed: 2, size: 0.22, gravity: -3, life: 0.35 }
          : { color: brute ? 0x3a3b40 : 0x9aa0aa, count: 1, speed: 0.6, size: (brute ? 0.4 : 0.25) + 0.1 * Math.abs(throttle), gravity: -2, life: brute ? 1.1 : 0.8 });
      }
      if (lowHp && !dashing) ctx.fx.burst(this.engineWorld(_c), { color: 0x2e2e34, count: 1, speed: 0.8, size: 0.4, gravity: -2.5, life: 1.1 });
    }

    // Held ball (weapon + shield).
    const target = this.heldBallRadius;
    this.ballR += (target - this.ballR) * Math.min(1, dt * 10);
    if (target === 0 && this.ballR < 0.15) this.ballR = 0;
    if (this.ballR >= 0.15) {
      this.ball.visible = true;
      const pr = this.ballR;
      const prevX = this.ball.position.x;
      const prevZ = this.ball.position.z;
      const extra = sp > 0 ? 0.15 * sp : 0;
      this.ballCenter(_c, pr, this.heading + this.spinAngle, extra);
      if (this.ballWasVisible) {
        const dx = _c.x - prevX;
        const dz = _c.z - prevZ;
        const dist = Math.hypot(dx, dz);
        if (dist > 1e-5 && dist < 3) {
          _dir.set(dz, 0, -dx).normalize(); // up x travelDir
          _q.setFromAxisAngle(_dir, dist / pr);
          this.ball.quaternion.premultiply(_q);
        }
      }
      this.ball.position.copy(_c);
      this.ballWasVisible = true;

      const full = target >= stats.maxBallRadius * 0.995;
      if (full) {
        const p = 0.5 + 0.5 * Math.sin(this.time * 7);
        this.ball.scale.setScalar(pr * (1 + 0.035 * p));
        this.glow.visible = true;
        this.glowMat.opacity = 0.3 + 0.45 * p;
        this.glow.position.set(_c.x, _c.y - pr + 0.06, _c.z);
        this.glow.scale.setScalar(pr * (1 + 0.08 * p));
      } else {
        this.ball.scale.setScalar(pr);
        this.glow.visible = false;
      }
    } else {
      this.ball.visible = false;
      this.glow.visible = false;
      this.ballWasVisible = false;
    }
  }
}
