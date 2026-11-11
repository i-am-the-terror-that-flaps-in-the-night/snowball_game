import * as THREE from 'three';
import {
  ballRadius,
  type EnemyHandle,
  PLOW_SPAWN,
  type GameContext,
  type PlayerStats,
} from '../../core/types';
import { ctxPilot, type PilotBinding } from '../pilot';
import { getSnowballGeometry, getSnowballMaterial } from '../snowballMesh';
import { PLOWS, type PlowKind } from '../../config/plows';
import {
  hazardTexture, type Cleat, buildBuzzsaw, type Buzzsaw, PLOW_WHEEL_POS,
} from '../plowModels';
import type { CosmeticSlot } from '../../config/cosmetics';
import { bakeGeometry, mergeBaked, mergeStatic } from '../../render/mergeStatic';
import type { EquippedLook } from '../../meta/cosmetics';
import { GearVisuals } from '../gearVisuals';
import { makeSurface } from '../../world/Terrain';
import type { VehicleBuildIn } from '../vehicles/types';
import { buildVoltVehicle, type VoltVehicleParts } from '../vehicles/volt';
import { buildBruteVehicle } from '../vehicles/brute';
import { buildIsotopeVehicle } from '../vehicles/isotope';
import { buildArsenalVehicle, type ArsenalVehicleParts } from '../vehicles/arsenal';
import { buildClassicVehicle, type ClassicVehicleParts } from '../vehicles/classic';
import { makeVert } from '../../world/terrainMotion';
import {
  BLADE_Z, TIP_Z, WHEEL_R, MAX_GHOSTS, MAX_STREAKS, REMOTE_SHAKE, DASH_SECONDS, DASH_IFRAMES,
} from './constants';
import { _m, _col } from './scratch';
import { RushFx } from './rushFx';
import { type Streak, getTornadoTexture, makeTornadoGeometry, type Ghost, type Debris } from './assets';

/*
 * Layer 1 of the Plow class (entities/Plow.ts): every field (in their original declaration order, so the scene
 * objects / materials are created in the same order), the constructor (model + effects assembly), and the small
 * helpers every layer uses. Layers: PlowBase -> PlowVisuals (paint, blade, model animation, trails / streaks /
 * ghosts / tornado) -> PlowMotion (abilities, terrain, collisions, wreck) -> Plow (API, duel netcode, reset, update).
 * The layers hold no fields of their own.
 */

export abstract class PlowBase {
  readonly object = new THREE.Group();
  readonly position = this.object.position;
  heading: number = PLOW_SPAWN.heading;
  speed = 0;
  readonly radius = 1.6;
  hp = 120;
  maxHp = 120;

  protected ctx: GameContext;
  /** Whose input / stats / combat drive this plow (ctxPilot = the single-player singletons). */
  protected b: PilotBinding;
  protected _dead = false;
  protected heldVolume = 0;
  protected pushVel = new THREE.Vector3();
  protected bladeWidth = 2.6;

  // abilities
  protected slamPhase: 0 | 1 | 2 = 0;
  protected slamT = 0;
  protected slamCd = 0;
  protected slamHit = false;
  protected slamBuffer = 0;
  protected lungeVel = 0;
  protected dashCharge = 1;
  protected dashT = 0;
  protected dashEase = 0;
  protected dashSpeed = 0;
  protected hitStopT = 0;
  protected spawnProt = 0;
  protected whirlCharge = 1;
  protected whirlT = -1;
  protected whirlTick = 0;
  protected whirlHits = new Set<number>();
  protected queryOut: EnemyHandle[] = [];
  protected dashTargets: EnemyHandle[] = [];
  protected spinAngle = 0;
  protected wallCd = 0;
  // Classic Plow SPACE kit (combat/classicRush.ts): tap = the BALL SLAM, hold = charge a PLOW RUSH.
  /** Seconds SPACE has been held since the press (-1 = not held / consumed). */
  protected spaceT = -1;
  /** The hold passed the tap window with too little dash meter for a rush (buzzed once; the release slams). */
  protected rushNoMeter = false;
  /** Rush charge 0..1 while charging (-1 = not charging) and the telegraphed distance (m). */
  protected rushChargeK = -1;
  protected rushDist = 0;
  /** Rush in progress: metres left (0 = not rushing), seconds since launch, stalled time, a wall ended it. */
  protected rushLeft = 0;
  protected rushT = 0;
  protected rushStall = 0;
  protected rushStop = false;
  /** Puppet: the host's plow was rushing at the last snapshot (launch fx edge). */
  protected puppetRush = false;
  /** MOMENTUM: seconds of the landed-tap-slam speed boost left. */
  protected momentumT = 0;
  protected rushFx!: RushFx;

  // terrain (world/Terrain.ts via ctx.terrain; shared vertical model in world/terrainMotion.ts)
  protected vert = makeVert();
  protected surf = makeSurface();
  protected conv = { x: 0, z: 0 };
  protected wallOut = { x: 0, z: 0 };
  /** Snow ride height above the surface (smoothed); position.y = surface + ride while grounded. */
  protected ride = 0;
  /** Over-the-cap speed earned rolling downhill (decays); the cap settle leaves it alone. */
  protected slopeBoost = 0;
  /** Actual horizontal velocity (m/s). Equals forward * speed on normal ground; lags the heading on ice / in the air. */
  protected velX = 0;
  protected velZ = 0;
  /** 0..1 ice blend (1 on ice, fades out over ICE_LINGER after leaving it). */
  protected ice = 0;
  /** 0..1 lava burn glow; lava damage batched for the event / sound throttles. */
  protected burn = 0;
  protected lavaAcc = 0;
  protected lavaEventT = 0;
  protected lavaSfxT = 0;
  /** Smoothed body tilt to the surface (rad) and the landing squash (0..1). */
  protected tiltP = 0;
  protected tiltR = 0;
  protected squash = 0;
  /** Surface height when wrecked (debris rest heights sit on it). */
  protected wreckGround = 0;
  /** Duel opponent puppet: the host's feet height / flight state this frame (null = not a puppet). */
  protected puppetY: number | null = null;
  protected puppetAir = false;
  protected puppetVy = 0;

  // visuals
  protected spin = new THREE.Group();
  protected body = new THREE.Group();
  protected bladeGroup = new THREE.Group();
  protected bladeSheet!: THREE.Mesh;
  /** Both blade-side hazard caps in one mesh (rebuilt for the blade width in setBladeWidth). */
  /** Blade wings / seams / LED markers (vehicles/classic.ts frame, rebuilt for the blade width). */
  protected bladeCaps!: THREE.Group;
  protected capsWidth = -1;
  /** Frame + arms meshes that cast (through bladeProxy; re-enabled before each proxy rebuild). */
  protected bladeCasters: THREE.Object3D[] = [];
  protected bladeArms!: THREE.Object3D;
  /** Depth-only caster for the caps + arms (rebuilt with the caps). */
  protected bladeProxy: THREE.Mesh | null = null;
  /** Wheels as instances (tire / treads / hub, one shared matrix buffer). Each wheel keeps the spin (rotation.x)
   *  and, at the front, the steer (rotation.y, order YXZ) its own group used to have. */
  protected wheelMeshes: THREE.InstancedMesh[] = [];
  protected wheelSpin = [0, 0, 0, 0];
  protected wheelSteer = [0, 0];
  /** Stand-ins for wheels 0 and 3 while they fly off as wreck debris (their instances are hidden meanwhile). */
  protected wheelDebris: THREE.Group[] = [];
  protected wheelsOff = false;
  protected paintMat: THREE.MeshStandardMaterial;
  protected bedMat: THREE.MeshStandardMaterial;
  protected paintBase = new THREE.Color(0xffc814);
  protected bedBase = new THREE.Color(0x23272e);
  protected charColor = new THREE.Color(0x2a211c);
  /** The accent (hub) colour before any wreck char (BRUTUS's large accent plates char with the hull). */
  protected hubBase = new THREE.Color(0xffd23a);
  protected beaconMat: THREE.MeshStandardMaterial;
  protected beaconLight: THREE.PointLight;
  private beacon!: THREE.Mesh;
  protected beaconSpinner = new THREE.Group();
  // Starter-plow models: Classic dump truck, VOLT-9 low electric wedge, BRUTUS tracked bulldozer.
  protected kind: PlowKind = 'classic';
  protected classicParts!: THREE.Group;
  /** Classic heavy-duty plow: blade dressing (wings / burners / fuel cell), hopper gauge, spreader (vehicles/classic.ts). */
  protected classicRig!: ClassicVehicleParts;
  protected bruteParts!: THREE.Group;
  /** ISOTOPE: hazmat hull + reactor; the core's glow pulses (faster while Meltdown recharges). */
  protected isoParts!: THREE.Group;
  protected coreMat!: THREE.MeshStandardMaterial;
  protected cleats: Cleat[] = [];
  /** All BRUTUS track cleats as instances (matrices follow cleatZ). */
  protected cleatMesh!: THREE.InstancedMesh;
  /** BRUTUS WRECKING MECH pose (fists / saws), driven by its combat kit (combat/brute.ts). */
  bruteRig: { pose(dt: number, punchL: number, punchR: number, saw: number, twist: number): void } | null = null;
  protected cleatPhase = NaN;
  /** Buzzsaws upgrade (BRUTUS): one saw per blade end. */
  protected saws: Buzzsaw[] = [];
  /** 0..1 saw fury: built by damage dealt and taken, drains over time; spins the saws up. */
  protected sawFury = 0;
  protected _sawHalo = 0;
  protected cleatSpan = 3;
  protected trackPhase = 0;
  protected underglowMat!: THREE.MeshBasicMaterial;
  protected voltRig!: VoltVehicleParts;
  /** TESLA ROVER: ARC LANCE firing / STATIC FIELD active 0..1 (set by combat/volt.ts; drive the tower FX). */
  voltArc = false;
  voltField = 0;
  protected bruteBlade = new THREE.Group();
  /** Ground Pound hop height (m), driven by Combat while BRUTUS is airborne. */
  hop = 0;
  protected steelMat!: THREE.MeshStandardMaterial;
  protected hubMat!: THREE.MeshStandardMaterial;
  protected voltParts!: THREE.Group;
  /** ARSENAL: the wheel + gyro vehicle body, its yawing emitter turret and weapon mounts. */
  protected arsenalParts!: THREE.Group;
  /** Equipped gear attachments (entities/gearVisuals.ts). */
  protected gearVis!: GearVisuals;
  protected turret!: THREE.Group;
  protected minigun!: THREE.Group;
  /** Minigun elevation pivot; follows gunPitch. */
  protected gunMount!: THREE.Group;
  protected gunTilt = 0;
  /** Minigun barrel spin (rad/s), easing toward full speed while gunFiring. */
  protected minigunSpin = 0;
  /** Set by Combat each frame: the ARSENAL pulse laser is firing. */
  gunFiring = false;
  /** Minigun elevation (rad, + up) from ARSENAL's auto-aim; the barrels tilt to it. */
  gunPitch = 0;
  protected muzzles: THREE.Object3D[] = [];
  protected laserMount!: THREE.Object3D;
  protected gyroMount!: THREE.Object3D;
  protected armGlowMat!: THREE.MeshStandardMaterial;
  protected arsRig!: ArsenalVehicleParts;
  /** Set by Combat each frame (ARSENAL): 0..1 gyro rings folded flat into a disc (Polarity Burst), and 0..1 extra
   *  core charge glow (Grav Lance / Singularity). */
  gyroFlat = 0;
  gyroCharge = 0;
  protected gyroFlatEase = 0;
  /** Turret yaw relative to the hull (rad) and where Combat wants it. */
  protected turretYaw = 0;
  turretAim = 0;
  protected coilMat = new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x2fb8ff, emissiveIntensity: 1.5, roughness: 0.3, metalness: 0.4 });
  protected coilTops: THREE.Object3D[] = [];
  protected arcT = 0;
  protected headMat: THREE.MeshStandardMaterial;
  protected flame: THREE.Mesh;
  protected flameMat: THREE.MeshBasicMaterial;
  protected exhaustTip = new THREE.Vector3(-0.72, 2.55, 0.05);
  protected engineTip = new THREE.Vector3(0, 1.6, 1.7);
  protected ball: THREE.Mesh;
  protected ballR = 0;
  protected ballWasVisible = false;
  protected glow: THREE.Mesh;
  protected glowMat: THREE.MeshBasicMaterial;
  protected ghosts: Ghost[] = [];
  protected ghostT = 0;
  protected debris: Debris[] = [];
  protected streaks: Streak[] = [];
  protected streakMesh: THREE.InstancedMesh;
  protected streakT = 0;
  protected tornado = new THREE.Group();
  protected tornadoOuter: THREE.Mesh;
  protected tornadoInner: THREE.Mesh;
  protected tornadoMatO: THREE.MeshBasicMaterial;
  protected tornadoMatI: THREE.MeshBasicMaterial;
  protected tornadoA = 0;
  protected tornadoR = 5;
  protected whirlRing: THREE.Mesh;
  protected whirlRingMat: THREE.MeshBasicMaterial;
  protected ringPulse = 0;

  protected roll = 0;
  protected pitch = 0;
  protected kick = 0;
  protected slamPose = 0;
  protected flash = 0;
  protected jitter = 0;
  protected bobT = 0;
  protected puffT = 0;
  protected lastSpeed = 0;
  protected plowSmooth = 0;
  protected time = 0;
  protected wreckT = 0;
  // ---- Paint Shop cosmetics (meta/cosmetics.ts): equipped look, overridden per slot while the shop previews an item.
  protected look!: EquippedLook;
  protected lookKey = '';
  protected decalKey = '';
  protected preview: Partial<Record<CosmeticSlot, string>> = {};
  protected decals: THREE.Group | null = null;
  protected decalMat = new THREE.MeshStandardMaterial({
    roughness: 0.5, metalness: 0.1, emissive: 0xffffff, emissiveIntensity: 0.3, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
  });
  protected trailT = 0;
  /** Paint Shop blade skin (swapped onto bladeSheet instead of steelMat while a skin is equipped). */
  protected bladeSkinMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.4, metalness: 0.3, emissive: 0xff0000, emissiveIntensity: 0 });
  protected bladeKey = '';

  /** Vehicle switched to the snowball kit (stats.snowKit). */
  protected snowKit = false;

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

    this.rushFx = new RushFx(ctx.scene);

    ctx.scene.add(this.object);
    this.applyStats(this.b.stats);
    // Paint Shop look: applied now and re-checked on every save change (buy / equip / import / reset).
    this.syncLook(true);
    ctx.progression.onChange(() => this.syncLook());
    this.reset();
  }

  /* ------------------------------------------------------------------ shared helpers */

  get heldBallRadius(): number {
    return ballRadius(this.heldVolume);
  }
  get invulnerable(): boolean {
    return !this._dead && (this.spawnProt > 0 || this.dashT > DASH_SECONDS - DASH_IFRAMES);
  }

  /** Camera shake from this plow: full strength for the local pilot, a fraction for a duel opponent. */
  protected shake(intensity: number): void {
    this.ctx.fx.shake(this.b.local ? intensity : intensity * REMOTE_SHAKE);
  }

  /** Not the Classic: no blade, never plows or holds a ball; SPACE / E are the kit's (PLOWS[kind].noBall). */
  get vehicle(): boolean {
    return !!PLOWS[this.kind]?.noBall && !this.snowKit;
  }

  getForward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  getBladeTip(out: THREE.Vector3): THREE.Vector3 {
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    return out.set(this.position.x + s * TIP_Z, this.vert.surfaceY, this.position.z + c * TIP_Z);
  }

  /* ------------------------------------------------------------------ implemented by the later layers */

  abstract applyStats(stats: PlayerStats): void;
  abstract reset(at?: { x: number; z: number; heading: number }): void;
  protected abstract syncLook(force?: boolean): void;
  protected abstract writeWheels(): void;
  protected abstract setCleats(phase: number): void;
}
