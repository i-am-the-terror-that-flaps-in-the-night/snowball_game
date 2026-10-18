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
} from '../core/types';
import type { Combat } from './Combat';
import { getSnowballGeometry, getSnowballMaterial } from './snowballMesh';
import { cooldown } from '../config/upgrades';
import type { PlowKind } from '../config/plows';
import { buildBruteParts, buildVoltParts, cleatZ, hazardTexture, type Cleat, buildBuzzsaw, type Buzzsaw } from './plowModels';

/* Model layout (local, facing +Z): rear dump bed at -Z, cab mid-front, hood, blade at BLADE_Z. */
const BLADE_Z = 2.35;
const TIP_Z = BLADE_Z + 0.15;
const REAR_Z = 2.15;
const WHEEL_R = 0.48;
/** BRUTUS's taller, deeper blade (visual scale on Y / Z; width still follows bladeWidth). */
const BRUTE_BLADE_Y = 1.28;
const BRUTE_BLADE_Z = 1.15;

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
const _up = new THREE.Vector3(0, 1, 0);

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

  // visuals
  private spin = new THREE.Group();
  private body = new THREE.Group();
  private bladeGroup = new THREE.Group();
  private bladeSheet!: THREE.Mesh;
  private bladeCaps: THREE.Mesh[] = [];
  private wheels: THREE.Object3D[] = [];
  private paintMat: THREE.MeshStandardMaterial;
  private bedMat: THREE.MeshStandardMaterial;
  private paintBase = new THREE.Color(0xff7a1a);
  private bedBase = new THREE.Color(0xffb21f);
  private charColor = new THREE.Color(0x2a211c);
  private beaconMat: THREE.MeshStandardMaterial;
  private beaconLight: THREE.PointLight;
  private beacon!: THREE.Mesh;
  private beaconSpinner = new THREE.Group();
  // Starter-plow models: Classic dump truck, VOLT-9 low electric wedge, BRUTUS tracked bulldozer.
  private kind: PlowKind = 'classic';
  private classicParts = new THREE.Group();
  private bruteParts!: THREE.Group;
  private cleats: Cleat[] = [];
  /** Buzzsaws upgrade (BRUTUS): one saw per blade end. */
  private saws: Buzzsaw[] = [];
  private cleatSpan = 3;
  private trackPhase = 0;
  private underglowMat!: THREE.MeshBasicMaterial;
  private bruteBlade = new THREE.Group();
  /** Ground Pound hop height (m), driven by Combat while BRUTUS is airborne. */
  hop = 0;
  private steelMat!: THREE.MeshStandardMaterial;
  private hubMat!: THREE.MeshStandardMaterial;
  private voltParts!: THREE.Group;
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

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.object.name = 'plow';

    this.paintMat = new THREE.MeshStandardMaterial({ color: this.paintBase, roughness: 0.45, metalness: 0.15, emissive: 0xff0000, emissiveIntensity: 0 });
    this.bedMat = new THREE.MeshStandardMaterial({ color: this.bedBase, roughness: 0.5, metalness: 0.1, emissive: 0xff0000, emissiveIntensity: 0 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.7, metalness: 0.3 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1b2a40, roughness: 0.12, metalness: 0.6, emissive: 0x0b1830, emissiveIntensity: 0.4 });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.35, metalness: 0.55, side: THREE.DoubleSide, emissive: 0x000000 });
    this.steelMat = steelMat;
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xc9d2dc, roughness: 0.25, metalness: 0.85 });
    const rubberMat = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.9, flatShading: true });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.4, metalness: 0.4 });
    this.hubMat = hubMat;
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const redMat = new THREE.MeshStandardMaterial({ color: 0xe8283a, roughness: 0.4, emissive: 0x550000, emissiveIntensity: 0.4 });
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
    // the three starter plows have different silhouettes, not just different paint.
    add(new THREE.BoxGeometry(1.7, 0.35, 4.0), darkMat, 0, 0.62, 0.05);
    const cp = this.classicParts;

    /* ---- Classic: the orange municipal dump truck (tall cab, dump bed, exhaust stack, beacon). ---- */
    add(new THREE.BoxGeometry(2.05, 0.22, 0.25), darkMat, 0, 0.62, -2.0, cp);
    add(new THREE.BoxGeometry(2.1, 0.95, 2.1), this.bedMat, 0, 1.3, -0.95, cp);
    add(new THREE.BoxGeometry(2.2, 0.12, 2.2), darkMat, 0, 1.82, -0.95, cp);
    add(new THREE.BoxGeometry(2.12, 0.14, 0.9), stripeMat, 0, 1.1, -0.95, cp).scale.set(1, 1, 2.3);
    add(new THREE.BoxGeometry(0.28, 0.18, 0.06), redMat, -0.78, 1.05, -2.02, cp, false);
    add(new THREE.BoxGeometry(0.28, 0.18, 0.06), redMat, 0.78, 1.05, -2.02, cp, false);
    add(new THREE.BoxGeometry(2.0, 1.25, 1.35), this.paintMat, 0, 1.55, 0.72, cp);
    add(new THREE.BoxGeometry(2.08, 0.12, 1.45), this.paintMat, 0, 2.22, 0.72, cp);
    const ws = add(new THREE.BoxGeometry(1.7, 0.6, 0.06), glassMat, 0, 1.85, 1.41, cp, false);
    ws.rotation.x = -0.12;
    add(new THREE.BoxGeometry(0.06, 0.55, 0.95), glassMat, -1.01, 1.85, 0.75, cp, false);
    add(new THREE.BoxGeometry(0.06, 0.55, 0.95), glassMat, 1.01, 1.85, 0.75, cp, false);
    add(new THREE.BoxGeometry(1.5, 0.45, 0.06), glassMat, 0, 1.88, 0.04, cp, false);
    add(new THREE.BoxGeometry(1.85, 0.7, 0.85), this.paintMat, 0, 1.18, 1.78, cp);
    add(new THREE.BoxGeometry(1.3, 0.42, 0.06), chromeMat, 0, 1.15, 2.22, cp);
    add(new THREE.BoxGeometry(0.3, 0.2, 0.08), this.headMat, -0.72, 1.3, 2.22, cp, false);
    add(new THREE.BoxGeometry(0.3, 0.2, 0.08), this.headMat, 0.72, 1.3, 2.22, cp, false);
    add(new THREE.BoxGeometry(2.04, 0.1, 1.38), stripeMat, 0, 1.25, 0.72, cp, false);
    const mirrorL = add(new THREE.BoxGeometry(0.08, 0.3, 0.18), darkMat, -1.18, 1.85, 1.2, cp, false);
    const mirrorR = add(new THREE.BoxGeometry(0.08, 0.3, 0.18), darkMat, 1.18, 1.85, 1.2, cp, false);
    const stack = add(new THREE.CylinderGeometry(0.09, 0.09, 1.4, 10), chromeMat, -0.72, 1.85, 0.05, cp);
    add(new THREE.CylinderGeometry(0.12, 0.12, 0.12, 10), darkMat, 0, 0.65, 0, stack);
    for (const [x, z] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.25], [0.95, -1.25]] as const) {
      add(new THREE.BoxGeometry(0.5, 0.1, 1.1), darkMat, x, WHEEL_R * 2 + 0.08, z, cp);
    }
    add(new THREE.BoxGeometry(0.9, 0.08, 0.3), darkMat, 0, 2.32, 0.8, cp);
    this.beacon = add(new THREE.CylinderGeometry(0.16, 0.18, 0.24, 12), this.beaconMat, 0, 2.48, 0.8, cp, false);
    this.beacon.add(this.beaconSpinner);
    const reflector = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.04), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
    this.beaconSpinner.add(reflector);
    this.body.add(cp);

    // Dash / wreck flame (out of the stack on the Classic; moved per plow in setKind).
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0xff8a1a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const flameGeo = new THREE.ConeGeometry(0.13, 0.7, 8);
    flameGeo.translate(0, 0.35, 0);
    this.flame = add(flameGeo, this.flameMat, -0.72, 2.55, 0.05, this.body, false);
    this.flame.visible = false;

    /* ---- VOLT-9: a low, sleek electric wedge — bubble canopy, glowing light bars, rear wing, Tesla coils. ---- */
    const volt = buildVoltParts({ paint: this.paintMat, coil: this.coilMat });
    this.voltParts = volt.group;
    this.coilTops = volt.coilTops;
    this.underglowMat = volt.underglowMat;
    this.voltParts.visible = false;
    this.body.add(this.voltParts);

    /* ---- BRUTUS: a tracked bulldozer — tank treads, armored engine block, caged cab, twin stacks, ripper. ---- */
    const brute = buildBruteParts({ paint: this.paintMat, dark: darkMat, glass: glassMat, chrome: chromeMat, hub: this.hubMat, head: this.headMat });
    this.bruteParts = brute.group;
    this.cleats = brute.cleats;
    this.cleatSpan = brute.cleatSpan;
    this.bruteParts.visible = false;
    this.body.add(this.bruteParts);

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
    for (const [x, z] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.25], [0.95, -1.25]] as const) {
      const w = new THREE.Group();
      w.position.set(x, WHEEL_R, z);
      w.rotation.order = 'YXZ';
      const t = new THREE.Mesh(tireGeo, rubberMat);
      t.castShadow = true;
      w.add(t);
      w.add(new THREE.Mesh(hubGeo, hubMat));
      for (let i = 0; i < 6; i++) {
        const tr = new THREE.Mesh(treadGeo, rubberMat);
        const a = (i / 6) * Math.PI * 2;
        tr.position.set(0, Math.sin(a) * WHEEL_R, Math.cos(a) * WHEEL_R);
        tr.rotation.x = -a;
        w.add(tr);
      }
      this.body.add(w);
      this.wheels.push(w);
    }

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
    const edge = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 0.12), darkMat);
    edge.position.set(0, 0.08, 0.22);
    this.bladeSheet.add(edge);
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
    this.bruteBlade.visible = false;
    this.bladeSheet.add(this.bruteBlade);
    // Blade-side hazard caps (repositioned in setBladeWidth).
    const capGeo = new THREE.BoxGeometry(0.08, 1.2, 0.5);
    for (let i = 0; i < 2; i++) {
      const cap = new THREE.Mesh(capGeo, redMat);
      cap.position.set(0, 0.7, 0.1);
      cap.castShadow = true;
      this.bladeGroup.add(cap);
      this.bladeCaps.push(cap);
    }
    // BRUTUS Buzzsaws (shown only with the upgrade; repositioned in setBladeWidth).
    for (let i = 0; i < 2; i++) {
      const saw = buildBuzzsaw();
      saw.group.visible = false;
      this.bladeGroup.add(saw.group);
      this.saws.push(saw);
    }
    const armGeo = new THREE.BoxGeometry(0.14, 0.14, 0.9);
    for (const x of [-0.55, 0.55]) {
      const arm = new THREE.Mesh(armGeo, darkMat);
      arm.position.set(x, 0.75, -0.3);
      arm.castShadow = true;
      this.bladeGroup.add(arm);
    }
    const ram = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 8), chromeMat);
    ram.rotation.x = Math.PI / 2 - 0.5;
    ram.position.set(0, 1.0, -0.3);
    this.bladeGroup.add(ram);
    this.bladeGroup.position.set(0, 0, BLADE_Z - 0.1);
    this.body.add(this.bladeGroup);

    this.spin.add(this.body);
    this.object.add(this.spin);

    // Parts that pop off when wrecked.
    const pop = (obj: THREE.Object3D, rest: number) =>
      this.debris.push({ obj, parent: obj.parent!, pos: obj.position.clone(), quat: obj.quaternion.clone(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), rest, popped: false });
    pop(this.bladeGroup, 0.05);
    pop(this.wheels[0], WHEEL_R);
    pop(this.wheels[3], WHEEL_R);
    pop(this.beacon, 0.15);
    pop(stack, 0.1);
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
    this.applyStats(ctx.stats);
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
  get invulnerable(): boolean {
    return !this._dead && (this.spawnProt > 0 || this.dashT > DASH_SECONDS - DASH_IFRAMES);
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

  getBladeTip(out: THREE.Vector3): THREE.Vector3 {
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    return out.set(this.position.x + s * TIP_Z, 0, this.position.z + c * TIP_Z);
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
    this.spawnProt = at ? SPAWN_PROTECT : 0;
    this.dashEase = 0;
    this.dashSpeed = 0;
    this.hitStopT = 0;
    this.whirlTick = 0;
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
    this.applyBladeScale();
    this.hop = 0;
    this.spin.position.y = 0;
    for (const g of this.ghosts) {
      g.active = false;
      g.group.visible = false;
    }
    this.updateStreaks(0);
  }

  /** Swap the paint job + parts for the selected starter plow. */
  private setKind(kind: PlowKind): void {
    this.kind = kind;
    const volt = kind === 'volt';
    const brute = kind === 'brute';
    this.paintBase.setHex(volt ? 0x1f5fe0 : brute ? 0x7d8794 : 0xff7a1a);
    this.bedBase.setHex(volt ? 0x18213a : brute ? 0x4a525d : 0xffb21f);
    this.paintMat.color.copy(this.paintBase);
    this.bedMat.color.copy(this.bedBase);
    this.steelMat.color.setHex(volt ? 0x9fe8ff : brute ? 0x7a828e : 0xffd23a);
    this.steelMat.emissive.setHex(volt ? 0x1a8cff : 0x000000);
    this.steelMat.emissiveIntensity = volt ? 0.6 : 0;
    this.hubMat.color.setHex(volt ? 0x7fdcff : brute ? 0xffc21a : 0xffd23a);
    this.beaconMat.color.setHex(volt ? 0x7fdcff : 0xffb000);
    this.beaconMat.emissive.setHex(volt ? 0x2fb8ff : 0xff9a00);
    this.classicParts.visible = !volt && !brute;
    this.voltParts.visible = volt;
    this.bruteParts.visible = brute;
    this.bruteBlade.visible = brute;
    for (const w of this.wheels) w.visible = !brute;
    // Dash flame: out of the stack (Classic), a rear thruster (VOLT-9) or the right-hand twin stack (BRUTUS).
    if (volt) {
      this.exhaustTip.set(0, 1.05, -2.05);
      this.flame.rotation.set(-Math.PI / 2, 0, 0);
    } else if (brute) {
      this.exhaustTip.set(0.55, 3.1, -1.45);
      this.flame.rotation.set(0, 0, 0);
    } else {
      this.exhaustTip.set(-0.72, 2.55, 0.05);
      this.flame.rotation.set(0, 0, 0);
    }
    this.flame.position.copy(this.exhaustTip);
    this.engineTip.set(0, brute ? 2.0 : 1.6, brute ? -1.0 : 1.7);
    this.beaconLight.position.set(0, volt ? 0.4 : brute ? 2.6 : 2.8, volt ? 0 : brute ? 1.4 : 0.8);
    this.applyBladeScale();
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
    if (stats.plowKind !== this.kind) this.setKind(stats.plowKind);
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
    this.bladeSheet.scale.x = w;
    this.bladeCaps[0].position.x = -w / 2;
    this.bladeCaps[1].position.x = w / 2;
    this.saws[0].group.position.set(-w / 2 - 0.6, 0.5, 0.45);
    this.saws[1].group.position.set(w / 2 + 0.6, 0.5, 0.45);
    for (const g of this.ghosts) g.blade.scale.x = w;
  }

  /* ------------------------------------------------------------------ update */

  update(dt: number): void {
    const ctx = this.ctx;
    const stats = ctx.stats;
    this.time += dt;
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
      if (ctx.input.wasPressed('Space')) this.slamBuffer = INPUT_BUFFER;
      this.jitter = Math.max(this.jitter, 0.1);
      return;
    }

    const input = ctx.input;
    const snow = ctx.snow;
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
    if (this.whirlT < 0 && this.whirlCharge < 1) this.whirlCharge = Math.min(1, this.whirlCharge + (stats.whirlCooldown > 0 ? dt / stats.whirlCooldown : 1));

    const throttle = input.throttle;
    const steer = input.steer;

    // ---- abilities
    if (input.wasPressed('Space')) this.slamBuffer = INPUT_BUFFER;
    if (this.slamBuffer > 0 && this.slamPhase === 0 && this.slamCd <= 0 && this.whirlT < 0) {
      this.slamBuffer = 0;
      if (this.heldBallRadius >= MIN_BALL_RADIUS) {
        this.slamPhase = 1;
        this.slamT = 0;
        this.slamHit = false;
      } else {
        ctx.audio.play('error');
      }
    }
    if (input.wasPressed('ShiftLeft') || input.wasPressed('ShiftRight')) this.tryDash();
    if (input.wasPressed('KeyE')) this.tryWhirl();

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
    if (this.dashT > 0) {
      // Committed lunge: full burst speed, no cap.
      this.speed = this.dashSpeed;
    } else if (throttle > 0) {
      if (this.speed < 0) this.speed += accel * 2.2 * dt;
      else if (this.speed < maxF) this.speed = Math.min(maxF, this.speed + accel * dt * (1 - 0.35 * (this.speed / maxF)));
    } else if (throttle < 0) {
      if (this.speed > 0) this.speed -= accel * 2.2 * dt;
      else if (this.speed > -maxRev) this.speed = Math.max(-maxRev, this.speed - accel * 0.7 * dt);
    } else {
      const drag = (3 + Math.abs(this.speed) * 0.35) * dt;
      this.speed = Math.abs(this.speed) <= drag ? 0 : this.speed - Math.sign(this.speed) * drag;
    }
    // Over cap (dash ended / ball got heavier / whirl): settle back — fast ease right after a dash.
    if (!this.dashing && this.speed > maxF) {
      const rate = this.dashEase > 0 ? Math.max(14, (this.speed - maxF) / Math.max(0.06, this.dashEase)) : 14;
      this.speed = Math.max(maxF, this.speed - rate * dt);
    }

    // ---- steering
    const absS = Math.abs(this.speed);
    const f = 0.35 + 0.65 * Math.min(1, absS / 4);
    const reversing = this.speed < -0.2 || (absS <= 0.2 && throttle < 0);
    const turn = steer * stats.turnRate * f * (reversing ? -1 : 1) * (this.dashing ? DASH_STEER : this.whirlT >= 0 ? WHIRL_STEER : 1);
    this.heading += turn * dt;

    // ---- integrate
    this.getForward(_fwd);
    const vf = this.speed + this.lungeVel;
    this.position.x += _fwd.x * vf * dt + this.pushVel.x * dt;
    this.position.z += _fwd.z * vf * dt + this.pushVel.z * dt;
    this.pushVel.multiplyScalar(Math.exp(-6.5 * dt));
    this.clampToArena(vf, dt);
    this.collideObstacles(vf, dt);
    if (this.dashT > 0) this.dashHits();

    // ---- plowing
    let plowIntensity = 0;
    _right.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
    if (this.whirlT < 0 && vf > 0.5) {
      const dashing = this.dashT > 0;
      const bx = this.position.x + _fwd.x * BLADE_Z;
      const bz = this.position.z + _fwd.z * BLADE_Z;
      // Dashing carves a wider, cleaner wake.
      const hw = (this.bladeWidth / 2) * (dashing ? 1.2 : 1);
      _a.set(bx - _right.x * hw, 0, bz - _right.z * hw);
      _b.set(bx + _right.x * hw, 0, bz + _right.z * hw);
      const removed = snow.plowLine(_a.x, _a.z, _b.x, _b.z, vf * dt + 0.35, dashing ? 1 : 0.9);
      if (removed > 0) {
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
          _a.y = 0.6;
          _b.y = 0.6;
          ctx.fx.burst(_a, { color: 0xffffff, count: 3, speed: 6, size: 0.26, gravity: 14, life: 0.6 });
          ctx.fx.burst(_b, { color: 0xffffff, count: 3, speed: 6, size: 0.26, gravity: 14, life: 0.6 });
        }
        if (plowIntensity > 0.02) {
          _a.y = snow.getDepth(_a.x, _a.z) + 0.3;
          _b.y = snow.getDepth(_b.x, _b.z) + 0.3;
          _dir.set(-_right.x + _fwd.x * 0.5, 0.9, -_right.z + _fwd.z * 0.5).normalize();
          ctx.fx.spray(_a, _dir, plowIntensity);
          _dir.set(_right.x + _fwd.x * 0.5, 0.9, _right.z + _fwd.z * 0.5).normalize();
          ctx.fx.spray(_b, _dir, plowIntensity);
        }
      }
    }
    this.plowSmooth += (plowIntensity - this.plowSmooth) * Math.min(1, dt * 10);
    ctx.audio.setPlowing(this.plowSmooth < 0.02 ? 0 : this.plowSmooth);

    // ---- whirl
    if (this.whirlT >= 0) this.updateWhirl(dt);

    // ---- visuals
    this.updateVisuals(dt, turn, throttle);
  }

  /* ------------------------------------------------------------------ abilities */

  private slamImpact(): void {
    const ctx = this.ctx;
    this.slamHit = true;
    this.slamCd = cooldown(SLAM_COOLDOWN, this.ctx.stats.cooldownMult);
    const r = this.heldBallRadius;
    if (r < 0.2) {
      // Ball got stolen / chipped away mid-windup.
      ctx.audio.play('error');
      return;
    }
    const volume = this.heldVolume;
    this.heldVolume = 0;
    this.ballR = 0;
    this.ball.visible = false;
    this.glow.visible = false;
    this.ballWasVisible = false;
    this.getBladeTip(_c);
    this.getForward(_fwd);
    const cx = _c.x + _fwd.x * (r + 0.5);
    const cz = _c.z + _fwd.z * (r + 0.5);
    this.kick = 1;
    (ctx.combat as Combat).slamAt(cx, cz, r, volume);
  }

  private tryDash(): void {
    const ctx = this.ctx;
    if (this.dashCharge < 1 || this.dashT > 0) {
      if (this.dashT <= 0) ctx.audio.play('error', { volume: 0.4 });
      return;
    }
    const stats = ctx.stats;
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
    ctx.audio.play('dash');
    // Rear blast: snow kicked back + exhaust flare.
    this.getForward(_fwd);
    _c.set(this.position.x - _fwd.x * REAR_Z, 0.5, this.position.z - _fwd.z * REAR_Z);
    ctx.fx.burst(_c, { color: 0xffffff, count: 30, speed: 8, size: 0.26, gravity: 14, life: 0.7 });
    _c.y = 0.05;
    ctx.fx.ring(_c, 2.6, 0xffb060);
    this.exhaustWorld(_c);
    ctx.fx.burst(_c, { color: 0xff9a2a, count: 16, speed: 4, size: 0.24, gravity: -4, life: 0.4 });
    ctx.fx.shake(0.22);
  }

  /** Dash safety net: anything the blade plows into while dashing gets a DASH STRIKE (Combat dedupes per bot). */
  private dashHits(): void {
    const ctx = this.ctx;
    const enemies = ctx.enemies;
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
      ctx.combat.playerRam(e, this.speed);
      if (this.hitStopT > 0) break; // one strike per frame; the rest connect after the hit-stop
    }
    list.length = 0;
  }

  private tryWhirl(): void {
    const ctx = this.ctx;
    if (this.whirlT >= 0) return;
    if (this.whirlCharge < 1) {
      ctx.audio.play('error', { volume: 0.4 });
      return;
    }
    this.whirlCharge = 0;
    this.whirlT = 0;
    this.whirlTick = 0;
    this.whirlHits.clear();
    // Cancel a pending slam (the whirl takes over the blade).
    this.slamPhase = 0;
    ctx.audio.play('whirl');
    const R = this.whirlRadius();
    this.tornadoR = R;
    _c.set(this.position.x, 0.05, this.position.z);
    ctx.fx.ring(_c, R, 0xbfeaff);
    ctx.fx.shake(0.15);
  }

  private whirlRadius(): number {
    return this.ctx.stats.whirlRadius + this.bladeWidth / 2 + this.heldBallRadius;
  }

  private updateWhirl(dt: number): void {
    const ctx = this.ctx;
    const stats = ctx.stats;
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
      (ctx.combat as Combat).whirlTick(px, pz, R, this.heldBallRadius, tick, final, this.whirlHits);
      this.ringPulse = final ? 1.6 : 1;
      // Suck snow into the held ball.
      const vol = ctx.snow.collectDisc(px, pz, R * 0.7, 0.35) * stats.collectRate;
      if (vol > 0) {
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
      _c.set(px + s * rr, 0.3 + Math.random() * 1.6, pz + c * rr);
      _dir.set(c + s * 0.6, 0.5, -s + c * 0.6).normalize();
      ctx.fx.spray(_c, _dir, 0.9);
    }
    // Snow off the spinning blade tip.
    const vh = this.heading + this.spinAngle;
    const s = Math.sin(vh);
    const c = Math.cos(vh);
    _c.set(px + s * TIP_Z, 0.3, pz + c * TIP_Z);
    _dir.set(c, 0.6, -s).normalize();
    ctx.fx.spray(_c, _dir, 1);

    if (tau >= 1) {
      this.whirlT = -1;
      this.spinAngle = 0;
      const count = this.whirlHits.size;
      this.whirlHits.clear();
      if (count >= 3) {
        ctx.events.emit('strike', { count, position: new THREE.Vector3(px, 0, pz) });
        ctx.audio.play('strike');
      }
    }
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
    const bladeR = Math.max(0.9, this.bladeWidth * 0.38);
    const bladeOff = TIP_Z - 0.55;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      const p = this.position;
      // Cheap reject.
      const ddx = p.x - o.x;
      const ddz = p.z - o.z;
      const reach = o.r + 4.5;
      if (ddx * ddx + ddz * ddz > reach * reach) continue;
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
      ctx.audio.play('wallHit', { volume: 1, pitch: 0.75 });
      ctx.fx.shake(0.6);
      _c.set(this.position.x - nx * (this.radius + 0.6), 1, this.position.z - nz * (this.radius + 0.6));
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
      ctx.audio.play('wallHit', { volume: Math.min(1, 0.4 + into * 0.04) });
      ctx.fx.shake(Math.min(0.45, 0.12 + (into - 5) * 0.03));
      _c.set(this.position.x - nx * (this.radius + 0.4), 1, this.position.z - nz * (this.radius + 0.4));
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
    ctx.audio.setPlowing(0);
    this.plowSmooth = 0;

    // Drop the held ball as loose snow.
    if (this.heldVolume > 0) {
      const r = this.heldBallRadius;
      this.ballCenter(_c, r, this.heading, 0);
      ctx.snow.addSnow(_c.x, _c.z, Math.max(1, r * 1.5), this.heldVolume);
      ctx.fx.burst(_c, { color: 0xffffff, count: 16, speed: 3, size: 0.3, gravity: 10, life: 0.9 });
      this.heldVolume = 0;
    }
    this.ball.visible = false;
    this.glow.visible = false;
    this.ballR = 0;

    // Explosion.
    _c.set(this.position.x, 1.4, this.position.z);
    ctx.fx.burst(_c, { color: 0xff7a1a, count: 46, speed: 10, size: 0.3, gravity: 6, life: 0.7 });
    ctx.fx.burst(_c, { color: 0xffd23a, count: 24, speed: 13, size: 0.1, gravity: 22, life: 0.5 });
    ctx.fx.burst(_c, { color: 0x26262b, count: 30, speed: 4, size: 0.6, gravity: -3, life: 1.8 });
    ctx.fx.burst(_c, { color: 0x8c96a4, count: 14, speed: 8, size: 0.2, gravity: 22, life: 1.0 });
    _c.y = 0;
    ctx.fx.ring(_c, 5, 0xff7a1a);

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

    ctx.events.emit('plowDestroyed', {});
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
    this.object.rotation.set(0, this.heading, 0);

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
    this.flash = Math.max(0, this.flash - dt * 3);
    this.paintMat.emissiveIntensity = this.flash * 1.4 + 0.25 * (0.5 + 0.5 * Math.sin(this.time * 23));
    this.bedMat.emissiveIntensity = this.flash * 1.4;

    // Fire from the stack and smoke from the engine.
    this.flame.scale.set(2.2, 1.6 + Math.random() * 1.6, 2.2);
    this.flameMat.color.setHSL(0.03 + Math.random() * 0.06, 1, 0.5);
    this.puffT -= dt;
    if (this.puffT <= 0) {
      this.puffT = 0.05;
      this.engineWorld(_c);
      ctx.fx.burst(_c, { color: 0x1d1d22, count: 3, speed: 1.4, size: 0.55, gravity: -3, life: 1.6 });
      ctx.fx.burst(_c, { color: 0xff6a1a, count: 2, speed: 1.6, size: 0.25, gravity: -5, life: 0.4 });
      _c.set(this.position.x + (Math.random() - 0.5) * 1.6, 1.4, this.position.z + (Math.random() - 0.5) * 1.6);
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
      if (o.position.y < d.rest) {
        o.position.y = d.rest;
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
    out.y = this.ctx.snow.getDepth(out.x, out.z) + r;
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
    st.y = 0.3 + Math.random() * 2.4;
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
    this.tornado.position.set(p.x, 0, p.z);
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
    this.whirlRing.position.set(p.x, this.ctx.snow ? this.ctx.snow.getDepth(p.x, p.z) + 0.08 : 0.08, p.z);
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
    if (this.kind === 'volt') g.mat.color.setHSL(0.54 + Math.random() * 0.03, 1, 0.6);
    else if (this.kind === 'brute') g.mat.color.setHSL(0.13 + Math.random() * 0.02, 1, 0.5);
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
    const stats = ctx.stats;
    const snow = ctx.snow;
    const absS = Math.abs(this.speed);
    this.object.rotation.set(0, this.heading, 0);
    this.spin.rotation.y = this.spinAngle;
    this.spin.position.y = this.hop;

    // Ride height: sink a little into the snow, bob more in deep snow.
    const depth = snow.getDepth(this.position.x, this.position.z);
    this.bobT += dt * (3 + absS * 1.4);
    const bob = Math.sin(this.bobT) * (0.015 + Math.min(0.05, depth * 0.08)) * Math.min(1, absS / 3 + 0.25);
    const targetY = Math.min(0.25, depth * 0.3);
    this.position.y += (targetY - this.position.y) * Math.min(1, dt * 6);

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
    this.body.position.set(jx, bob + (this.whirlT >= 0 ? 0.08 : 0), poseZ - kickP * 1.5 + jz);

    // Buzzsaws: always spinning, screaming faster with speed.
    const sawsOn = this.kind === 'brute' && stats.sawDps > 0;
    for (let i = 0; i < this.saws.length; i++) {
      const saw = this.saws[i];
      saw.group.visible = sawsOn;
      if (sawsOn) saw.rotor.rotation.y += dt * (16 + absS * 1.5);
    }

    // Wheels.
    const spin = ((this.speed + this.lungeVel) * dt) / WHEEL_R;
    for (const w of this.wheels) w.rotation.x += spin;
    const st = this.ctx.input.steer * 0.35;
    this.wheels[0].rotation.y = this.wheels[1].rotation.y = st;
    // BRUTUS: cleats crawl round the track loops (bottom run stays put on the ground, top run moves forward).
    if (this.kind === 'brute') {
      this.trackPhase += (this.speed + this.lungeVel) * dt;
      for (const c of this.cleats) c.mesh.position.z = cleatZ(c.i, c.top, this.trackPhase, this.cleatSpan);
    }

    // Beacon.
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 9);
    const lowHp = this.hp < this.maxHp * 0.3;
    const pf = lowHp ? 0.5 + 0.5 * Math.sin(this.time * 22) : pulse;
    this.beaconMat.emissiveIntensity = 0.6 + pf * 2.2;
    this.beaconLight.intensity = 2 + pf * 8;
    this.beaconLight.color.setHex(lowHp ? 0xff3020 : this.kind === 'volt' ? 0x4fc8ff : 0xffa020);
    if (this.kind === 'volt') {
      this.beaconLight.intensity = 3 + pf * 3;
      this.underglowMat.opacity = 0.28 + 0.12 * Math.sin(this.time * 6) + (this.dashT > 0 ? 0.3 : 0);
    }
    // VOLT-9: pulsing coils + arcs jumping between them.
    if (this.kind === 'volt') {
      this.coilMat.emissiveIntensity = 1.2 + 0.8 * Math.sin(this.time * 14) * Math.sin(this.time * 5.3);
      this.arcT -= dt;
      if (this.arcT <= 0 && this.coilTops.length === 2) {
        this.arcT = 0.15 + Math.random() * 0.35;
        const a = this.coilTops[0].getWorldPosition(_a);
        const b = this.coilTops[1].getWorldPosition(_b);
        (this.ctx.combat as Combat | undefined)?.lightning.bolt(a, b, { life: 0.12, width: 0.1, jag: 0.25 });
      }
    }
    this.beaconSpinner.rotation.y += dt * (lowHp ? 16 : 9);

    // Damage flash.
    this.flash = Math.max(0, this.flash - dt * 4);
    const fl = this.flash * 1.4;
    this.paintMat.emissiveIntensity = fl;
    this.bedMat.emissiveIntensity = fl;

    // Dash flame + afterimages / exhaust puffs.
    const dashing = this.dashT > 0;
    this.flame.visible = dashing;
    if (dashing) {
      const s = 1.6 + Math.random() * 1.2;
      this.flame.scale.set(1.6, s, 1.6);
      this.flameMat.color.setHSL(this.kind === 'volt' ? 0.53 + Math.random() * 0.04 : 0.06 + Math.random() * 0.05, 1, this.kind === 'volt' ? 0.65 : 0.55);
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
