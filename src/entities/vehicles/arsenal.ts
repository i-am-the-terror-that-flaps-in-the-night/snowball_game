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
  /** Gunmetal armour materials (the Plow gives them the paint env map so their panels catch the sky). */
  metalMats: THREE.MeshStandardMaterial[];
  /** Wheels, gyro rings, hover bob and ground light rings: call once per frame. */
  update(dt: number, s: ArsenalRigState): void;
}

/** Front wheels: radius, width, axle position. */
const WHEEL_R = 0.68;
const WHEEL_W = 0.6;
const WHEEL_X = 1.24;
const WHEEL_Z = 1.2;
/** Hull: raised LIFT m off the ground on its suspension and stretched HULL_SY x taller (the hull below was laid out
 *  low; hullY maps those heights onto the raised hull), so it reads as a chunky armoured vehicle, not a low racer. */
const LIFT = 0.3;
const HULL_SY = 1.4;
const hullY = (y: number): number => LIFT + 0.5 + (y - 0.5) * HULL_SY;
/** Gyro core: centre (model space) and the three ring radii (outer to inner). The rings sit on nested spheres, so
 *  however they turn they never touch. */
const GYRO_Y = 1.65;
const GYRO_Z = -2.75;
const RING_R = [1.12, 0.86, 0.6] as const;
/** Cradle struts: x of their bearing caps (just outside the outer ring). */
const CRADLE_X = RING_R[0] + 0.2;
/** Gyro ring spin (rad/s) idle, extra per m/s of speed, extra while the pulse laser fires. */
const RING_IDLE = 1.2;
const RING_SPEED = 0.35;
const RING_FIRE = 6;

const CYAN = 0x38e8ff;

/**
 * ARSENAL: a futuristic magnetic / laser vehicle (not a mech, not a tank). Two huge rugged off-road wheels at the
 * front (armoured hubs, glowing cyan rims) carry the nose; there are no wheels at the back: the rear hovers on a GYRO
 * CORE, the signature: three big armoured rings nested like a gyroscope on three different axes (each spinning in its
 * own plane, cyan seams) round a white-hot crystal, held in an armoured cradle between two swept struts, projecting
 * light rings onto the snow. A rugged sloped hull in gunmetal sits between; a low turret carries the sleek pulse-laser emitter and the nose
 * holds the Grav Lance lens. Rides on the shared chassis slot (the shared wheels are hidden for this kind).
 */
export function buildArsenalVehicle({ mats: m }: VehicleBuildIn): VehicleBuild<ArsenalVehicleParts> {
  const ap = new THREE.Group();
  const glowMat = new THREE.MeshStandardMaterial({ color: CYAN, emissive: CYAN, emissiveIntensity: 1.4, roughness: 0.25 });
  const armorMat = new THREE.MeshStandardMaterial({ color: 0x505b67, roughness: 0.38, metalness: 0.5, flatShading: true, envMapIntensity: 0.8 });
  const archMat = armorMat.clone();
  archMat.side = THREE.DoubleSide;
  // Darker gunmetal trim (bearing blocks, axle housings).
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x323a44, roughness: 0.45, metalness: 0.45, flatShading: true });
  const rubberMat = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.95, flatShading: true });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const add = (color: number, opacity: number) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });

  /* ---- hull: belly, armoured upper hull, sloped glacis and side plates (rugged facets, flat shaded), raised on its
   * suspension (see LIFT / hullY) ---- */
  const hull = new THREE.Group();
  hull.position.y = LIFT + 0.5 * (1 - HULL_SY);
  hull.scale.y = HULL_SY;
  ap.add(hull);
  const _v = new THREE.Vector3();
  const _u = new THREE.Vector3();
  /** A box beam (w x h) from a to b, under ap. */
  const beam = (a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, mat: THREE.Material, shadow = true) => {
    const bm = addMesh(new THREE.BoxGeometry(w, h, a.distanceTo(b)), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, ap, shadow);
    bm.lookAt(b.x, b.y, b.z);
    return bm;
  };
  addMesh(new THREE.BoxGeometry(1.5, 0.42, 3.0), m.dark, 0, 0.72, 0.05, hull);
  addMesh(new THREE.BoxGeometry(1.66, 0.42, 2.1), m.paint, 0, 1.12, -0.2, hull);
  const glacis = addMesh(new THREE.BoxGeometry(1.62, 0.12, 1.25), m.paint, 0, 1.13, 1.32, hull);
  glacis.rotation.x = 0.42;
  const roof = addMesh(new THREE.BoxGeometry(1.4, 0.1, 1.7), m.trim, 0, 1.37, -0.25, hull);
  roof.rotation.x = -0.04;
  // Rear deck sloping down to the cradle.
  const tail = addMesh(new THREE.BoxGeometry(1.3, 0.12, 0.5), m.paint, 0, 1.16, -1.22, hull);
  tail.rotation.x = -0.32;
  // Chamfered side armour (angled plates) and a skid plate under the nose.
  for (const sx of [-1, 1]) {
    const side = addMesh(new THREE.BoxGeometry(0.17, 0.5, 2.5), armorMat, sx * 0.87, 1.0, -0.4, hull);
    side.rotation.z = sx * 0.22;
    addMesh(new THREE.BoxGeometry(0.06, 0.05, 2.0), glowMat, sx * 0.97, 0.8, -0.5, hull, false); // cyan side seam
    // Armoured wheel arch over the front wheel.
    const arch = addMesh(new THREE.CylinderGeometry(WHEEL_R + 0.16, WHEEL_R + 0.16, WHEEL_W + 0.14, 14, 1, true, 0.25, 2.55), archMat, sx * WHEEL_X, WHEEL_R, WHEEL_Z, ap);
    arch.rotation.z = Math.PI / 2;
    // Suspension: a V lower arm and an upper arm from the raised hull down to the hub, an axle stub and a coil-over
    // shock (dark body, cyan spring glow) from the hull shoulder to the hub.
    const hubX = sx * (WHEEL_X - WHEEL_W / 2 - 0.02);
    for (const dz of [-0.32, 0.32]) beam(_v.set(sx * 0.7, hullY(0.62), WHEEL_Z + dz), _u.set(hubX, WHEEL_R - 0.06, WHEEL_Z), 0.1, 0.08, trimMat);
    beam(_v.set(sx * 0.74, hullY(0.98), WHEEL_Z - 0.05), _u.set(hubX, WHEEL_R + 0.12, WHEEL_Z), 0.09, 0.09, armorMat);
    const axle = addMesh(new THREE.CylinderGeometry(0.15, 0.18, 0.36, 8), trimMat, sx * (WHEEL_X - WHEEL_W / 2 - 0.1), WHEEL_R, WHEEL_Z, ap);
    axle.rotation.z = Math.PI / 2;
    beam(_v.set(sx * 0.82, hullY(1.22), WHEEL_Z - 0.42), _u.set(hubX, WHEEL_R + 0.05, WHEEL_Z - 0.08), 0.1, 0.1, m.dark);
    beam(_v.set(sx * 0.84, hullY(1.12), WHEEL_Z - 0.36), _u.set(sx * (WHEEL_X - WHEEL_W / 2 - 0.04), WHEEL_R + 0.25, WHEEL_Z - 0.12), 0.06, 0.06, glowMat, false);
  }
  const skid = addMesh(new THREE.BoxGeometry(1.3, 0.1, 0.7), armorMat, 0, 0.5, 1.75, hull);
  skid.rotation.x = -0.5;
  addMesh(new THREE.BoxGeometry(1.5, 0.22, 0.22), armorMat, 0, 0.72, 2.02, hull); // ram bar
  // Cyan LED strip under the glacis lip and a pair of slit headlights.
  addMesh(new THREE.BoxGeometry(1.1, 0.04, 0.04), glowMat, 0, 0.9, 2.02, hull, false);
  for (const sx of [-1, 1]) addMesh(new THREE.BoxGeometry(0.26, 0.05, 0.05), m.head, sx * 0.5, 1.02, 1.86, hull, false);
  // Grav Lance lens: an armoured housing under the glacis with a cyan crystal; the lance leaves from `laser`.
  addMesh(new THREE.BoxGeometry(0.46, 0.26, 0.34), armorMat, 0, 0.98, 1.9, hull);
  const lensRing = addMesh(new THREE.TorusGeometry(0.13, 0.035, 6, 14), m.chrome, 0, 0.98, 2.08, hull);
  void lensRing;
  const crystal = addMesh(new THREE.OctahedronGeometry(0.1, 0), glowMat, 0, 0.98, 2.1, hull, false);
  crystal.scale.set(1, 1, 1.8);
  const laser = new THREE.Object3D();
  laser.position.set(0, hullY(0.98), 2.3);
  ap.add(laser);
  // Rear cradle: two armoured struts sweeping back and out from the hull to bearing caps either side of the gyro.
  {
    const x0 = 0.72;
    const z0 = -1.2;
    const dx = CRADLE_X - x0;
    const dz = GYRO_Z - z0;
    const len = Math.hypot(dx, dz);
    for (const sx of [-1, 1]) {
      const strut = addMesh(new THREE.BoxGeometry(0.2, 0.26, len), armorMat, sx * (x0 + dx / 2), GYRO_Y - 0.02, z0 + dz / 2, ap);
      strut.rotation.y = sx * Math.atan2(dx, dz);
      const seam = addMesh(new THREE.BoxGeometry(0.06, 0.04, len * 0.9), glowMat, sx * (x0 + dx / 2), GYRO_Y + 0.13, z0 + dz / 2, ap, false);
      seam.rotation.y = strut.rotation.y;
      const cap = addMesh(new THREE.CylinderGeometry(0.22, 0.27, 0.24, 10), trimMat, sx * CRADLE_X, GYRO_Y, GYRO_Z, ap);
      cap.rotation.z = Math.PI / 2;
      const pin = addMesh(new THREE.CylinderGeometry(0.09, 0.09, 0.16, 8), glowMat, sx * (CRADLE_X - 0.15), GYRO_Y, GYRO_Z, ap, false);
      pin.rotation.z = Math.PI / 2;
    }
  }

  /* ---- turret: a low armoured disc carrying the sleek pulse emitter ---- */
  const turret = new THREE.Group();
  turret.position.set(0, hullY(1.42), 0.05);
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
  const hubGeo = new THREE.CylinderGeometry(0.34, 0.37, WHEEL_W + 0.06, 8);
  hubGeo.rotateZ(Math.PI / 2);
  const capGeo = new THREE.CylinderGeometry(0.14, 0.18, 0.1, 6);
  capGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.TorusGeometry(0.43, 0.032, 4, 28);
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
    addMesh(capGeo, trimMat, sx * (WHEEL_W / 2 + 0.06), 0, 0, w);
    addMesh(rimGeo, glowMat, sx * (WHEEL_W / 2 + 0.03), 0, 0, w, false);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      addMesh(boltGeo, m.chrome, sx * (WHEEL_W / 2 + 0.04), Math.sin(a) * 0.26, Math.cos(a) * 0.26, w, false);
    }
    wheels.push(w);
  }

  /* ---- gyro core: three nested armoured rings on three different axes (outer: an upright hoop facing back, riding
   * in the cradle's bearings; middle: upright, fore-aft; inner: level), each spinning in its own plane with two cyan
   * seam lines and armour blocks, round a white-hot crystal ---- */
  const gyroRoot = new THREE.Group();
  gyroRoot.position.set(0, GYRO_Y, GYRO_Z);
  ap.add(gyroRoot);
  // Base orientation of each ring (a torus lies in its XY plane: normal +Z).
  const baseQ = [
    new THREE.Quaternion(),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
  ];
  const flatQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const rings: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const R = RING_R[i];
    const g = new THREE.Group();
    gyroRoot.add(g);
    const tube = 0.075 - i * 0.01;
    addMesh(new THREE.TorusGeometry(R, tube, 6, 48), armorMat, 0, 0, 0, g, false);
    for (const dz of [-tube, tube]) addMesh(new THREE.TorusGeometry(R, 0.02, 3, 48), glowMat, 0, 0, dz, g, false);
    // Outer edge glow line, so the ring reads edge-on too.
    addMesh(new THREE.TorusGeometry(R + tube * 0.9, 0.016, 3, 48), glowMat, 0, 0, 0, g, false);
    const nb = 6 - i;
    for (let k = 0; k < nb; k++) {
      const a = (k / nb) * Math.PI * 2 + i * 0.4;
      const blk = addMesh(new THREE.BoxGeometry(0.16, 0.13, 0.2 - i * 0.02), trimMat, Math.cos(a) * R, Math.sin(a) * R, 0, g, false);
      blk.rotation.z = a;
    }
    mergeStatic(g);
    rings.push(g);
  }
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), coreMat);
  core.scale.set(1, 1.5, 1);
  gyroRoot.add(core);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), add(CYAN, 0.5));
  halo.renderOrder = 3;
  gyroRoot.add(halo);
  const haloOut = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 10), add(0x1a7cff, 0.22));
  haloOut.renderOrder = 3;
  gyroRoot.add(haloOut);
  // Polarity Burst disc: a flat cyan glow filling the folded rings.
  const discMat = add(CYAN, 0);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(RING_R[0] + 0.08, 40), discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.renderOrder = 3;
  disc.visible = false;
  gyroRoot.add(disc);
  // Light rings projected on the snow under the gyro: a saturated painted band (reads on white snow) with a bright
  // additive line on top.
  const groundMat = new THREE.MeshBasicMaterial({ color: 0x0fa8d8, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false });
  const groundHot = add(0x9ff6ff, 0.8);
  const ground: THREE.Mesh[] = [];
  for (const [r0, r1, mat] of [[0.62, 0.8, groundMat], [0.68, 0.74, groundHot], [1.2, 1.32, groundMat], [1.24, 1.28, groundHot], [1.7, 1.76, groundMat]] as const) {
    const gr = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 48), mat);
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
  for (const gr of ground) gr.removeFromParent();
  mergeStatic(ap);
  mergeStatic(turret, { keep: [gun] });
  mergeStatic(gun, { keep: [rotor] });
  mergeStatic(rotor);
  for (const w of wheels) mergeStatic(w);
  ap.add(turret, gyroRoot, ...wheels, ...ground);
  // Shadow: hull, turret and wheels (cylinders: their spin doesn't change the shadow); the gyro rings cast none.
  ap.add(...makeShadowProxy(ap, ap, { keep: [gyroRoot, ...ground] }));

  // Animation state.
  const spin = [0.3, 1.1, 2.0];
  const _q = new THREE.Quaternion();
  const _w = new THREE.Quaternion();
  const _e = new THREE.Euler();
  let wheelA = 0;
  let t = 0;
  let ringW = RING_IDLE;
  const update = (dt: number, s: ArsenalRigState) => {
    t += dt;
    wheelA += (s.speed * dt) / WHEEL_R;
    for (const w of wheels) w.rotation.x = wheelA;
    // Rings: each spins in its own plane (faster with speed, while firing, charging); each base axis wobbles a little
    // so the gyro feels alive, never enough to bring two rings into line. Folded flat (Polarity Burst) all three lie
    // level as one concentric spinning disc.
    const want = RING_IDLE + RING_SPEED * Math.abs(s.speed) + (s.firing ? RING_FIRE : 0) + s.charge * 5 + s.flat * 9;
    ringW += (want - ringW) * Math.min(1, dt * 3);
    const f = THREE.MathUtils.clamp(s.flat, 0, 1);
    const fe = f * f * (3 - 2 * f);
    for (let i = 0; i < 3; i++) {
      spin[i] += dt * ringW * (1 + i * 0.45) * (i % 2 ? -1 : 1);
      const wob = 0.22 * (1 - fe);
      _e.set(wob * Math.sin(t * (0.9 + i * 0.37) + i), wob * Math.sin(t * (0.7 + i * 0.29) + i * 2), 0);
      _w.setFromEuler(_e);
      _q.copy(baseQ[i]).premultiply(_w).slerp(flatQ, fe);
      rings[i].quaternion.copy(_q);
      rings[i].rotateZ(spin[i]);
    }
    core.rotation.y += dt * (2 + ringW);
    const hot = 1 + 0.12 * Math.sin(t * 13) + s.charge * 0.6 + f * 0.5;
    core.scale.set(hot, 1.5 * hot, hot);
    halo.scale.setScalar(1 + 0.15 * Math.sin(t * 7) + s.charge * 0.8 + f * 0.6);
    haloOut.scale.setScalar(1 + 0.1 * Math.sin(t * 5) + s.charge * 0.6 + f * 0.8);
    disc.visible = f > 0.02;
    discMat.opacity = 0.55 * f;
    // Hover bob: the rear floats on the gyro, pitching gently about the front axle; the light rings breathe with it.
    const bob = Math.sin(t * 2.3) * 0.5 + Math.sin(t * 3.7) * 0.2;
    ap.rotation.x = 0.012 * bob;
    gyroRoot.position.y = GYRO_Y + 0.05 * bob;
    groundMat.opacity = 0.5 + 0.12 * Math.sin(t * 4) + s.charge * 0.2 + f * 0.25;
    for (let i = 0; i < ground.length; i++) {
      const k = i < 2 ? 1 + 0.06 * bob : i < 4 ? 1 + 0.08 * Math.sin(t * 1.7) + f * 0.6 : 1 + 0.25 * ((t * 0.6) % 1) + f * 1.2;
      ground[i].scale.setScalar(k);
    }
  };

  return { group: ap, parts: { turret, gunMount: gun, minigun: rotor, muzzles: [mz, mz], laser, gyro, glowMat, metalMats: [armorMat, archMat, trimMat], update } };
}
