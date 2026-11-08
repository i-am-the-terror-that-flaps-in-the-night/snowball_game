import * as THREE from 'three';
import { mergeStatic } from '../../render/mergeStatic';
import { makeShadowProxy } from '../../render/shadowProxy';
import { addMesh, type VehicleBuild, type VehicleBuildIn } from './types';

/** What the Plow feeds the ARSENAL rig every frame (ArsenalVehicleParts.update). */
export interface ArsenalRigState {
  /** Ground speed along the nose (m/s, + forward). */
  speed: number;
  /** Pulse laser firing (spins the gyro rings and the emitter coils up). */
  firing: boolean;
  /** 0..1: the gyro rings fold flat into one spinning disc (Polarity Burst). */
  flat: number;
  /** 0..1 extra charge glow (Grav Lance, Singularity). */
  charge: number;
}

/** ARSENAL animatable parts (names match Plow's fields and mountWorld). */
export interface ArsenalVehicleParts {
  /** Yaws with Plow.turretHeading. */
  turret: THREE.Group;
  /** Emitter elevation pivot (follows gunPitch) and the coil rotor inside it (spins while firing). */
  gunMount: THREE.Group;
  minigun: THREE.Group;
  /** mountWorld('muzzle' | 'laser' | 'gyro', i) anchors: the pulse emitter tip, the Grav Lance nose lens, the gyro core. */
  muzzles: THREE.Object3D[];
  laser: THREE.Object3D;
  gyro: THREE.Object3D;
  /** Weapon glow material (pulsed by the Plow). */
  glowMat: THREE.MeshStandardMaterial;
  /** Wheels, gyro rings, hover bob and ground light rings: call once per frame. */
  update(dt: number, s: ArsenalRigState): void;
}

/** Front wheels: radius, width, axle position. */
const WHEEL_R = 0.74;
const WHEEL_W = 0.6;
const WHEEL_X = 1.24;
const WHEEL_Z = 1.2;
/** Gyro core: centre (model space) and the three ring radii (outer to inner). */
const GYRO_Y = 1.06;
const GYRO_Z = -2.35;
const RING_R = [0.92, 0.71, 0.5] as const;
/** Gyro ring spin (rad/s) idle, extra per m/s of speed, extra while the pulse laser fires. */
const RING_IDLE = 1.2;
const RING_SPEED = 0.35;
const RING_FIRE = 6;

const CYAN = 0x38e8ff;

/** Fold an angle toward `target` by `f` (0 = free angle, 1 = exactly target), along the short way round. */
function fold(a: number, target: number, f: number): number {
  const d = Math.atan2(Math.sin(a - target), Math.cos(a - target));
  return target + d * (1 - f);
}

/**
 * ARSENAL: a futuristic magnetic / laser vehicle (not a mech, not a tank). Two huge rugged off-road wheels at the
 * front (armoured hubs, glowing cyan rims) carry the nose; there are no wheels at the back: the rear hovers on a GYRO
 * CORE, three thin armoured rings nested like a gyroscope (each spinning on its own axis, cyan seams) round a small
 * white-hot crystal, held in an armoured cradle between two short struts, projecting faint light rings onto the snow.
 * A rugged sloped hull in dark gunmetal sits between; a low turret carries the sleek pulse-laser emitter and the nose
 * holds the Grav Lance lens. Rides on the shared chassis slot (the shared wheels are hidden for this kind).
 */
export function buildArsenalVehicle({ mats: m }: VehicleBuildIn): VehicleBuild<ArsenalVehicleParts> {
  const ap = new THREE.Group();
  const glowMat = new THREE.MeshStandardMaterial({ color: CYAN, emissive: CYAN, emissiveIntensity: 1.4, roughness: 0.25 });
  const armorMat = new THREE.MeshStandardMaterial({ color: 0x4a525c, roughness: 0.45, metalness: 0.6, flatShading: true });
  const archMat = new THREE.MeshStandardMaterial({ color: 0x4a525c, roughness: 0.45, metalness: 0.6, flatShading: true, side: THREE.DoubleSide });
  const rubberMat = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.95, flatShading: true });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const add = (color: number, opacity: number) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });

  /* ---- hull: belly, armoured upper hull, sloped glacis and side plates (rugged facets, flat shaded) ---- */
  addMesh(new THREE.BoxGeometry(1.5, 0.42, 3.0), m.dark, 0, 0.72, 0.05, ap);
  addMesh(new THREE.BoxGeometry(1.66, 0.42, 2.1), m.paint, 0, 1.12, -0.2, ap);
  const glacis = addMesh(new THREE.BoxGeometry(1.62, 0.12, 1.25), m.paint, 0, 1.13, 1.32, ap);
  glacis.rotation.x = 0.42;
  const roof = addMesh(new THREE.BoxGeometry(1.4, 0.1, 1.7), m.trim, 0, 1.37, -0.25, ap);
  roof.rotation.x = -0.04;
  // Rear deck sloping down to the cradle.
  const tail = addMesh(new THREE.BoxGeometry(1.3, 0.12, 0.5), m.paint, 0, 1.16, -1.22, ap);
  tail.rotation.x = -0.32;
  // Chamfered side armour (angled plates) and a skid plate under the nose.
  for (const sx of [-1, 1]) {
    const side = addMesh(new THREE.BoxGeometry(0.1, 0.46, 2.3), armorMat, sx * 0.86, 1.0, -0.45, ap);
    side.rotation.z = sx * 0.22;
    addMesh(new THREE.BoxGeometry(0.06, 0.05, 2.0), glowMat, sx * 0.93, 0.82, -0.5, ap, false); // cyan side seam
    // Armoured wheel arch over the front wheel.
    const arch = addMesh(new THREE.CylinderGeometry(WHEEL_R + 0.16, WHEEL_R + 0.16, WHEEL_W + 0.14, 14, 1, true, 0.25, 2.55), archMat, sx * WHEEL_X, WHEEL_R, WHEEL_Z, ap);
    arch.rotation.z = Math.PI / 2;
    // Axle housing from the hull to the hub.
    const axle = addMesh(new THREE.CylinderGeometry(0.14, 0.17, 0.5, 8), armorMat, sx * 0.92, WHEEL_R, WHEEL_Z, ap);
    axle.rotation.z = Math.PI / 2;
  }
  const skid = addMesh(new THREE.BoxGeometry(1.3, 0.1, 0.7), armorMat, 0, 0.5, 1.75, ap);
  skid.rotation.x = -0.5;
  addMesh(new THREE.BoxGeometry(1.5, 0.22, 0.22), armorMat, 0, 0.72, 2.02, ap); // ram bar
  // Cyan LED strip under the glacis lip and a pair of slit headlights.
  addMesh(new THREE.BoxGeometry(1.1, 0.04, 0.04), glowMat, 0, 0.9, 2.02, ap, false);
  for (const sx of [-1, 1]) addMesh(new THREE.BoxGeometry(0.26, 0.05, 0.05), m.head, sx * 0.5, 1.02, 1.86, ap, false);
  // Grav Lance lens: an armoured housing under the glacis with a cyan crystal; the lance leaves from `laser`.
  addMesh(new THREE.BoxGeometry(0.46, 0.26, 0.34), armorMat, 0, 0.98, 1.9, ap);
  const lensRing = addMesh(new THREE.TorusGeometry(0.13, 0.035, 6, 14), m.chrome, 0, 0.98, 2.08, ap);
  void lensRing;
  const crystal = addMesh(new THREE.OctahedronGeometry(0.1, 0), glowMat, 0, 0.98, 2.1, ap, false);
  crystal.scale.set(1, 1, 1.8);
  const laser = new THREE.Object3D();
  laser.position.set(0, 0.98, 2.3);
  ap.add(laser);
  // Rear cradle: two short armoured struts reaching back past the hull, bearing caps holding the gyro's outer ring.
  for (const sx of [-1, 1]) {
    const strut = addMesh(new THREE.BoxGeometry(0.16, 0.24, 1.45), armorMat, sx * 1.12, GYRO_Y + 0.05, -1.68, ap);
    strut.rotation.y = -sx * 0.1;
    addMesh(new THREE.BoxGeometry(0.06, 0.04, 1.3), glowMat, sx * 1.12, GYRO_Y + 0.19, -1.68, ap, false);
    const cap = addMesh(new THREE.CylinderGeometry(0.2, 0.24, 0.2, 10), armorMat, sx * 1.12, GYRO_Y, GYRO_Z, ap);
    cap.rotation.z = Math.PI / 2;
    const pin = addMesh(new THREE.CylinderGeometry(0.07, 0.07, 0.14, 8), glowMat, sx * 0.99, GYRO_Y, GYRO_Z, ap, false);
    pin.rotation.z = Math.PI / 2;
  }

  /* ---- turret: a low armoured disc carrying the sleek pulse emitter ---- */
  const turret = new THREE.Group();
  turret.position.set(0, 1.42, 0.05);
  ap.add(turret);
  addMesh(new THREE.CylinderGeometry(0.5, 0.58, 0.14, 8), armorMat, 0, 0.04, 0, turret);
  const dome = addMesh(new THREE.CylinderGeometry(0.34, 0.5, 0.22, 8), m.paint, 0, 0.21, -0.05, turret);
  dome.rotation.y = Math.PI / 8;
  addMesh(new THREE.TorusGeometry(0.52, 0.02, 4, 24), glowMat, 0, 0.11, 0, turret, false).rotation.x = Math.PI / 2;
  const GY = 0.2;
  const GZ = 0.3;
  const gun = new THREE.Group();
  gun.position.set(0, GY, GZ);
  turret.add(gun);
  // Emitter: a slim tapered spine with cooling vanes, three cyan focusing rings (they spin while firing) and a crystal tip.
  addMesh(new THREE.BoxGeometry(0.3, 0.22, 0.36), armorMat, 0, 0, 0.05, gun);
  const spine = addMesh(new THREE.CylinderGeometry(0.06, 0.12, 1.25, 8), m.dark, 0, 0, 0.8, gun);
  spine.rotation.x = Math.PI / 2;
  for (const sx of [-1, 1]) {
    const vane = addMesh(new THREE.BoxGeometry(0.03, 0.14, 0.7), m.chrome, sx * 0.1, 0, 0.6, gun);
    vane.rotation.z = sx * 0.5;
  }
  const rotor = new THREE.Group();
  rotor.position.set(0, 0, 0.7);
  gun.add(rotor);
  for (let i = 0; i < 3; i++) {
    const r = addMesh(new THREE.TorusGeometry(0.13 - i * 0.015, 0.022, 4, 12), glowMat, 0, 0, i * 0.22, rotor, false);
    r.rotation.z = i * 0.7;
    addMesh(new THREE.BoxGeometry(0.05, 0.05, 0.06), m.chrome, 0, 0.13 - i * 0.015, i * 0.22, rotor, false);
  }
  const tip = addMesh(new THREE.OctahedronGeometry(0.07, 0), glowMat, 0, 0, 1.47, gun, false);
  tip.scale.set(1, 1, 2);
  const mz = new THREE.Object3D();
  mz.position.set(0, 0, 1.6);
  gun.add(mz);

  /* ---- front wheels: huge rugged tyres with chunky lugs, armoured hubs, glowing cyan rims ---- */
  const tyreGeo = new THREE.CylinderGeometry(WHEEL_R - 0.04, WHEEL_R - 0.04, WHEEL_W, 22);
  tyreGeo.rotateZ(Math.PI / 2);
  const lugGeo = new THREE.BoxGeometry(WHEEL_W + 0.02, 0.1, 0.2);
  const hubGeo = new THREE.CylinderGeometry(0.37, 0.4, WHEEL_W + 0.06, 8);
  hubGeo.rotateZ(Math.PI / 2);
  const capGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.1, 6);
  capGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.TorusGeometry(0.46, 0.028, 4, 28);
  rimGeo.rotateY(Math.PI / 2);
  const boltGeo = new THREE.BoxGeometry(0.06, 0.08, 0.08);
  const wheels: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(sx * WHEEL_X, WHEEL_R, WHEEL_Z);
    ap.add(w);
    addMesh(tyreGeo, rubberMat, 0, 0, 0, w);
    for (let i = 0; i < 15; i++) {
      const a = (i / 15) * Math.PI * 2;
      const lug = addMesh(lugGeo, rubberMat, 0, Math.sin(a) * (WHEEL_R - 0.03), Math.cos(a) * (WHEEL_R - 0.03), w);
      lug.rotation.x = -a + (i % 2 ? 0.12 : -0.12); // staggered tread
      lug.scale.x = i % 2 ? 1 : 0.8;
    }
    addMesh(hubGeo, armorMat, 0, 0, 0, w);
    addMesh(capGeo, m.trim, sx * (WHEEL_W / 2 + 0.06), 0, 0, w);
    addMesh(rimGeo, glowMat, sx * (WHEEL_W / 2 + 0.03), 0, 0, w, false);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      addMesh(boltGeo, m.chrome, sx * (WHEEL_W / 2 + 0.04), Math.sin(a) * 0.28, Math.cos(a) * 0.28, w, false);
    }
    wheels.push(w);
  }

  /* ---- gyro core: three nested armoured rings (outer pivots on the cradle's x axis, middle on its y, inner on its
   * z), each with two cyan seam lines and four armour blocks, round a white-hot crystal ---- */
  const gyroRoot = new THREE.Group();
  gyroRoot.position.set(0, GYRO_Y, GYRO_Z);
  ap.add(gyroRoot);
  const rings: THREE.Group[] = [];
  let parent: THREE.Object3D = gyroRoot;
  for (let i = 0; i < 3; i++) {
    const R = RING_R[i];
    const g = new THREE.Group();
    parent.add(g);
    addMesh(new THREE.TorusGeometry(R, 0.055, 5, 40), armorMat, 0, 0, 0, g, false);
    for (const dz of [-0.05, 0.05]) addMesh(new THREE.TorusGeometry(R, 0.016, 3, 40), glowMat, 0, 0, dz, g, false);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + i * 0.4;
      const blk = addMesh(new THREE.BoxGeometry(0.12, 0.1, 0.13), m.trim, Math.cos(a) * R, Math.sin(a) * R, 0, g, false);
      blk.rotation.z = a;
    }
    mergeStatic(g, { keep: (o) => o instanceof THREE.Group && o !== g });
    rings.push(g);
    parent = g;
  }
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), coreMat);
  core.scale.set(1, 1.5, 1);
  gyroRoot.add(core);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10), add(CYAN, 0.4));
  halo.renderOrder = 3;
  gyroRoot.add(halo);
  // Polarity Burst disc: a flat cyan glow filling the folded rings.
  const discMat = add(CYAN, 0);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(RING_R[0] + 0.06, 32), discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.renderOrder = 3;
  disc.visible = false;
  gyroRoot.add(disc);
  // Faint light rings projected on the snow under the gyro.
  const groundMat = new THREE.MeshBasicMaterial({ color: 0x18b8e0, transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false });
  const ground: THREE.Mesh[] = [];
  for (const [r0, r1] of [[0.7, 0.86], [1.15, 1.24]] as const) {
    const gr = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 40), groundMat);
    gr.rotation.x = -Math.PI / 2;
    gr.position.set(0, 0.05, GYRO_Z);
    gr.renderOrder = 2;
    ap.add(gr);
    ground.push(gr);
  }
  const gyro = new THREE.Object3D();
  gyroRoot.add(gyro);

  turret.removeFromParent();
  gyroRoot.removeFromParent();
  for (const w of wheels) w.removeFromParent();
  mergeStatic(ap);
  mergeStatic(turret, { keep: [gun] });
  mergeStatic(gun, { keep: [rotor] });
  mergeStatic(rotor);
  for (const w of wheels) mergeStatic(w);
  ap.add(turret, gyroRoot, ...wheels);
  // Shadow: hull, turret and wheels (cylinders: their spin doesn't change the shadow); the gyro rings cast none.
  ap.add(...makeShadowProxy(ap, ap, { keep: [gyroRoot, ...ground] }));

  // Animation state.
  const ang = [0.3, 1.1, 2.0];
  const spin = [0, 0, 0];
  let wheelA = 0;
  let t = 0;
  let ringW = RING_IDLE;
  const update = (dt: number, s: ArsenalRigState) => {
    t += dt;
    wheelA += (s.speed * dt) / WHEEL_R;
    for (const w of wheels) w.rotation.x = wheelA;
    // Rings: faster with speed and while firing; folded flat (Polarity Burst) they all spin about the vertical.
    const want = RING_IDLE + RING_SPEED * Math.abs(s.speed) + (s.firing ? RING_FIRE : 0) + s.charge * 5 + s.flat * 9;
    ringW += (want - ringW) * Math.min(1, dt * 3);
    const f = THREE.MathUtils.clamp(s.flat, 0, 1);
    for (let i = 0; i < 3; i++) {
      ang[i] += dt * ringW * (1 + i * 0.45) * (1 - f * 0.9);
      spin[i] += dt * ringW * f * (i % 2 ? -1.6 : 1.9);
    }
    rings[0].rotation.set(fold(ang[0], Math.PI / 2, f), 0, spin[0]);
    rings[1].rotation.set(0, fold(ang[1], 0, f), spin[1]);
    rings[2].rotation.set(0, 0, ang[2] + spin[2]);
    core.rotation.y += dt * (2 + ringW);
    const hot = 1 + 0.12 * Math.sin(t * 13) + s.charge * 0.6 + f * 0.5;
    core.scale.set(hot, 1.5 * hot, hot);
    halo.scale.setScalar(1 + 0.15 * Math.sin(t * 7) + s.charge * 0.8 + f * 0.6);
    disc.visible = f > 0.02;
    discMat.opacity = 0.55 * f;
    // Hover bob: the rear floats on the gyro, pitching gently about the front axle; the light rings breathe with it.
    const bob = Math.sin(t * 2.3) * 0.5 + Math.sin(t * 3.7) * 0.2;
    ap.rotation.x = 0.012 * bob;
    gyroRoot.position.y = GYRO_Y + 0.04 * bob;
    groundMat.opacity = 0.34 + 0.1 * Math.sin(t * 4) + s.charge * 0.25 + f * 0.3;
    ground[0].scale.setScalar(1 + 0.06 * bob);
    ground[1].scale.setScalar(1 + 0.1 * Math.sin(t * 1.7) + f * 0.6);
  };

  return { group: ap, parts: { turret, gunMount: gun, minigun: rotor, muzzles: [mz, mz], laser, gyro, glowMat, update } };
}
