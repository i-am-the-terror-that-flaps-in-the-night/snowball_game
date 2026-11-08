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

/** One lofted hull section at z: four heights (keel, foot of the side, top of the side, roof) and three half-widths
 *  (keel, side, roof), mirrored about x = 0: an octagon with chamfered corners. */
interface LoftSection {
  z: number;
  y: readonly [number, number, number, number];
  w: readonly [number, number, number];
}

/** A faceted armour body lofted through octagonal sections (front to back order does not matter, z must increase),
 *  capped at both ends. Non-indexed with one normal per face, so it reads flat-shaded with any material. */
function loft(secs: readonly LoftSection[]): THREE.BufferGeometry {
  const rings = secs.map(({ z, y: [y0, y1, y2, y3], w: [wb, ws, wt] }) =>
    ([[wb, y0], [ws, y1], [ws, y2], [wt, y3], [-wt, y3], [-ws, y2], [-ws, y1], [-wb, y0]] as const).map(([x, y]) => new THREE.Vector3(x, y, z)),
  );
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i + 1 < rings.length; i++) {
    const r0 = rings[i];
    const r1 = rings[i + 1];
    for (let k = 0; k < 8; k++) {
      const k1 = (k + 1) % 8;
      tri(r0[k], r0[k1], r1[k1]);
      tri(r0[k], r1[k1], r1[k]);
    }
  }
  const cap = (r: THREE.Vector3[], front: boolean) => {
    const c = r.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / r.length);
    for (let k = 0; k < 8; k++) {
      const k1 = (k + 1) % 8;
      if (front) tri(c, r[k], r[k1]);
      else tri(c, r[k1], r[k]);
    }
  };
  cap(rings[0], false);
  cap(rings[rings.length - 1], true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * ARSENAL: a futuristic magnetic / laser vehicle (not a mech, not a tank). Two huge rugged off-road wheels at the
 * front (armoured hubs, glowing cyan rims) carry the nose; there are no wheels at the back: the rear hovers on a GYRO
 * CORE, the signature: three big armoured rings nested like a gyroscope on three different axes (each spinning in its
 * own plane, cyan seams) round a white-hot crystal, held in an armoured cradle between two swept struts, projecting
 * light rings onto the snow (clamped bearings, hydraulic pistons, cable bundles). Between them a faceted gunmetal hull
 * (lofted octagonal sections, sloped two-facet glacis) dressed in layered bolted plates, armoured wheel arches, coil
 * pods on the rear quarters and nose greebles (ram bar, tow hooks, caged headlights, the Grav Lance lens); an angled
 * turret with armour cheeks, optics, hatch and antenna carries the finned pulse-laser emitter. Static parts merge into
 * one mesh per material. Rides on the shared chassis slot (the shared wheels are hidden for this kind).
 */
export function buildArsenalVehicle({ mats: m }: VehicleBuildIn): VehicleBuild<ArsenalVehicleParts> {
  const ap = new THREE.Group();
  const glowMat = new THREE.MeshStandardMaterial({ color: CYAN, emissive: CYAN, emissiveIntensity: 1.4, roughness: 0.25 });
  const armorMat = new THREE.MeshStandardMaterial({ color: 0x505b67, roughness: 0.38, metalness: 0.5, flatShading: true, envMapIntensity: 0.8 });
  // Darker gunmetal trim (bearing blocks, axle housings).
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x323a44, roughness: 0.45, metalness: 0.45, flatShading: true });
  const rubberMat = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.95, flatShading: true });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 1.6 });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const add = (color: number, opacity: number) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });

  /* ---- hull: a faceted armoured body (lofted octagonal sections: sloped two-facet glacis, chamfered roof edges, a
   * raked tail) raised on its suspension, dressed in layered bolted plates with panel gaps ---- */
  const _v = new THREE.Vector3();
  const _u = new THREE.Vector3();
  /** A box at (x, y, z) under `parent`, rotated (rx, ry, rz). */
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent: THREE.Object3D = ap, shadow = true) => {
    const b = addMesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent, shadow);
    b.rotation.set(rx, ry, rz);
    return b;
  };
  /** A box beam (w x h) from a to b, under ap. */
  const beam = (a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, mat: THREE.Material, shadow = true) => {
    const bm = addMesh(new THREE.BoxGeometry(w, h, a.distanceTo(b)), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, ap, shadow);
    bm.lookAt(b.x, b.y, b.z);
    return bm;
  };
  /** A beam from a to b sagging `sag` m at the middle (a cable): two straight runs. */
  const cable = (a: THREE.Vector3, b: THREE.Vector3, r: number, sag: number, mat: THREE.Material) => {
    const mid = new THREE.Vector3().lerpVectors(a, b, 0.5);
    mid.y -= sag;
    beam(a, mid, r, r, mat, false);
    beam(mid, b, r, r, mat, false);
  };
  /** A row of n bolt heads from (x0, y0, z0) to (x1, y1, z1), under `parent`. */
  const boltGeo = new THREE.BoxGeometry(0.036, 0.036, 0.036);
  const bolts = (n: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, parent: THREE.Object3D = ap, mat: THREE.Material = m.chrome) => {
    for (let i = 0; i < n; i++) {
      const k = n > 1 ? i / (n - 1) : 0.5;
      addMesh(boltGeo, mat, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, z0 + (z1 - z0) * k, parent, false);
    }
  };
  /** A plate lying on a slope from (y0, z0) to (y1, z1) (a pitched top surface), raised t/2 off it. */
  const slopePlate = (w: number, t: number, x: number, y0: number, z0: number, y1: number, z1: number, mat: THREE.Material, inset = 0) => {
    const a = Math.atan2(y0 - y1, z1 - z0);
    const len = Math.hypot(y1 - y0, z1 - z0) - inset * 2;
    const n = t / 2;
    return box(w, t, len, mat, x, (y0 + y1) / 2 + Math.cos(a) * n, (z0 + z1) / 2 + Math.sin(a) * n, a);
  };

  // Main hull: rear wall, roof run, upper glacis, lower glacis / nose.
  addMesh(
    loft([
      { z: -1.5, y: [0.64, 0.82, 1.62, 1.86], w: [0.55, 0.78, 0.6] },
      { z: -1.25, y: [0.55, 0.72, 1.72, 2.07], w: [0.62, 0.84, 0.66] },
      { z: 0.8, y: [0.55, 0.72, 1.72, 2.07], w: [0.62, 0.84, 0.66] },
      { z: 1.3, y: [0.55, 0.72, 1.62, 1.86], w: [0.62, 0.84, 0.66] },
      { z: 1.95, y: [0.7, 0.85, 1.2, 1.5], w: [0.5, 0.78, 0.6] },
    ]),
    m.paint,
    0, 0, 0, ap,
  );
  // Dark belly pan and a faceted skid plate under the nose.
  box(1.2, 0.1, 2.9, m.dark, 0, 0.53, 0.2);
  box(1.0, 0.08, 0.66, armorMat, 0, 0.72, 1.86, -0.38);

  // Glacis: one plate on the upper facet, a split pair on the lower facet (cyan seam in the gap), bolt rows on each.
  slopePlate(1.18, 0.05, 0, 2.07, 0.8, 1.86, 1.3, armorMat, 0.03);
  bolts(5, -0.5, 2.09, 0.86, 0.5, 2.09, 0.86);
  for (const sx of [-1, 1]) {
    slopePlate(0.5, 0.05, sx * 0.31, 1.86, 1.3, 1.5, 1.95, armorMat, 0.04);
    bolts(3, sx * 0.12, 1.86, 1.38, sx * 0.5, 1.86, 1.38);
  }
  slopePlate(0.035, 0.035, 0, 1.86, 1.3, 1.6, 1.78, glowMat);
  // Roof: a trim panel behind the turret (decal spot) and engine grille slats down the raked tail.
  box(1.2, 0.04, 0.7, m.trim, 0, 2.09, -0.86);
  bolts(2, -0.55, 2.115, -0.55, -0.55, 2.115, -1.17);
  bolts(2, 0.55, 2.115, -0.55, 0.55, 2.115, -1.17);
  for (let i = 0; i < 5; i++) {
    const k = (i + 0.5) / 5;
    box(0.96, 0.03, 0.04, m.dark, 0, 2.07 - 0.22 * k + 0.02, -1.25 - 0.25 * k, -0.72);
  }

  for (const sx of [-1, 1]) {
    // Side armour: a thick upper plate (decal face, chamfered top edge), a bevel plate on the roof edge, two
    // lower skirt plates tucked in at the foot with a gap between, bolt rows, a cyan seam and a step plate.
    box(0.12, 0.36, 2.0, armorMat, sx * 0.9, 1.56, -0.45);
    box(0.06, 0.1, 2.0, armorMat, sx * 0.9, 1.75, -0.45, 0, 0, sx * 0.75);
    bolts(6, sx * 0.965, 1.69, -1.35, sx * 0.965, 1.69, 0.45);
    bolts(6, sx * 0.965, 1.42, -1.35, sx * 0.965, 1.42, 0.45);
    box(0.05, 0.4, 1.1, armorMat, sx * 0.77, 1.91, 0.2, 0, 0, sx * 0.4636);
    bolts(4, sx * 0.8, 1.9, -0.25, sx * 0.8, 1.9, 0.65);
    for (const z of [-0.95, 0.0]) {
      box(0.07, 0.36, 0.9, armorMat, sx * 0.89, 1.17, z, 0, 0, -sx * 0.22);
      bolts(3, sx * 0.94, 1.27, z - 0.34, sx * 0.94, 1.27, z + 0.34);
    }
    box(0.04, 0.035, 1.9, glowMat, sx * 0.955, 1.36, -0.5, 0, 0, 0, ap, false);
    box(0.24, 0.03, 0.34, m.chrome, sx * 0.98, 0.88, 0.2);
    box(0.08, 0.14, 0.1, trimMat, sx * 0.88, 0.94, 0.2);
    for (const dz of [-0.1, 0, 0.1]) box(0.22, 0.015, 0.025, m.dark, sx * 0.98, 0.9, 0.2 + dz, 0, 0, 0, ap, false);

    // Armoured wheel arch: five overlapping flat plates round the wheel, an outer flange, bolts, a bracket to the
    // hull, a marker light at the front and a rubber mudguard behind.
    const fx = sx * (WHEEL_X + 0.02);
    const FW = WHEEL_W + 0.16;
    const RF = WHEEL_R + 0.18;
    const N = 5;
    const t0 = 0.5;
    const t1 = 2.7;
    const dT = (t1 - t0) / N;
    for (let i = 0; i < N; i++) {
      const th = t0 + (i + 0.5) * dT;
      const r = RF + (i % 2) * 0.02;
      const len = 2 * r * Math.sin(dT / 2) + 0.05;
      const y = WHEEL_R + Math.sin(th) * r;
      const z = WHEEL_Z + Math.cos(th) * r;
      box(FW, 0.06, len, armorMat, fx, y, z, Math.PI / 2 - th);
      box(0.05, 0.14, len, trimMat, fx + sx * (FW / 2 + 0.02), WHEEL_R + Math.sin(th) * (r - 0.02), WHEEL_Z + Math.cos(th) * (r - 0.02), Math.PI / 2 - th);
      const yb = WHEEL_R + Math.sin(th) * (r + 0.04);
      const zb = WHEEL_Z + Math.cos(th) * (r + 0.04);
      if (i % 2 === 0) bolts(2, fx + sx * (FW / 2 - 0.08), yb, zb, fx - sx * (FW / 2 - 0.08), yb, zb);
    }
    box(0.16, 0.14, 0.6, trimMat, sx * 0.86, 1.5, 1.2);
    box(0.1, 0.05, 0.05, glowMat, fx + sx * 0.26, WHEEL_R + Math.sin(t0) * RF + 0.02, WHEEL_Z + Math.cos(t0) * RF + 0.04, 0, 0, 0, ap, false);
    box(FW - 0.12, 0.5, 0.035, rubberMat, fx, 0.8, 0.38, 0.12);

    // Suspension: a V lower arm and an upper arm from the hull down to the hub, a hex axle stub and a coil-over
    // shock (dark body, cyan spring glow) from the hull shoulder to the hub.
    const hubX = sx * (WHEEL_X - WHEEL_W / 2 - 0.02);
    for (const dz of [-0.32, 0.32]) beam(_v.set(sx * 0.7, 0.968, WHEEL_Z + dz), _u.set(hubX, WHEEL_R - 0.06, WHEEL_Z), 0.1, 0.08, trimMat);
    beam(_v.set(sx * 0.74, 1.472, WHEEL_Z - 0.05), _u.set(hubX, WHEEL_R + 0.12, WHEEL_Z), 0.09, 0.09, armorMat);
    const axle = addMesh(new THREE.CylinderGeometry(0.15, 0.18, 0.36, 6), trimMat, sx * (WHEEL_X - WHEEL_W / 2 - 0.1), WHEEL_R, WHEEL_Z, ap);
    axle.rotation.z = Math.PI / 2;
    beam(_v.set(sx * 0.82, 1.808, WHEEL_Z - 0.42), _u.set(hubX, WHEEL_R + 0.05, WHEEL_Z - 0.08), 0.1, 0.1, m.dark);
    beam(_v.set(sx * 0.84, 1.668, WHEEL_Z - 0.36), _u.set(sx * (WHEEL_X - WHEEL_W / 2 - 0.04), WHEEL_R + 0.25, WHEEL_Z - 0.12), 0.06, 0.06, glowMat, false);

    // Capacitor coil pod on each rear quarter: an armoured box on a bracket with a chamfered nose, twin coil
    // emitters at the front (cyan rings), three glowing coil slots down the flank, heat-sink fins on top, a rear vent.
    const px = sx * 0.99;
    const PY = 2.0;
    const PZ = -0.98;
    box(0.36, 0.3, 0.86, armorMat, px, PY, PZ);
    box(0.3, 0.14, 0.6, trimMat, sx * 0.86, 1.83, PZ);
    box(0.36, 0.06, 0.24, armorMat, px, PY + 0.1, PZ + 0.48, 0.65);
    box(0.36, 0.2, 0.06, trimMat, px, PY - 0.04, PZ + 0.45);
    for (const dx of [-0.08, 0.08]) {
      const coil = addMesh(new THREE.CylinderGeometry(0.06, 0.07, 0.18, 6), trimMat, px + dx, PY - 0.04, PZ + 0.52, ap);
      coil.rotation.x = Math.PI / 2;
      const ring = addMesh(new THREE.TorusGeometry(0.065, 0.016, 4, 8), glowMat, px + dx, PY - 0.04, PZ + 0.6, ap, false);
      void ring;
    }
    for (const dz of [-0.24, 0, 0.24]) box(0.02, 0.18, 0.06, glowMat, px + sx * 0.185, PY, PZ + dz, 0, 0, 0, ap, false);
    for (let i = 0; i < 5; i++) box(0.3, 0.08, 0.025, trimMat, px, PY + 0.19, PZ - 0.32 + i * 0.13);
    box(0.28, 0.16, 0.03, m.dark, px, PY, PZ - 0.44);
    for (const dy of [-0.05, 0, 0.05]) box(0.26, 0.02, 0.03, armorMat, px, PY + dy, PZ - 0.46, 0, 0, 0, ap, false);
    bolts(3, px + sx * 0.185, PY + 0.12, PZ - 0.36, px + sx * 0.185, PY + 0.12, PZ + 0.3);
    box(0.04, 0.04, 0.04, glowMat, px - sx * 0.12, PY + 0.17, PZ + 0.36, 0, 0, 0, ap, false);
  }

  // Nose: a faceted ram bar on brackets, tow hooks, headlight clusters in cages, a cyan LED strip.
  box(1.56, 0.2, 0.2, armorMat, 0, 1.05, 2.03);
  box(1.4, 0.07, 0.16, trimMat, 0, 0.92, 2.0, -0.6);
  for (const sx of [-1, 1]) {
    box(0.12, 0.14, 0.18, trimMat, sx * 0.42, 1.05, 1.94);
    bolts(3, sx * 0.25, 1.05, 2.135, sx * 0.7, 1.05, 2.135);
    // Tow hook: two cheek plates and a pin.
    box(0.03, 0.12, 0.16, trimMat, sx * 0.6 - 0.05, 0.86, 2.08);
    box(0.03, 0.12, 0.16, trimMat, sx * 0.6 + 0.05, 0.86, 2.08);
    box(0.13, 0.04, 0.04, m.chrome, sx * 0.6, 0.84, 2.13, 0, 0, 0, ap, false);
    // Headlight cluster: a dark housing, three lamps, a cage of two bars and a cyan indicator under it.
    box(0.38, 0.17, 0.1, m.dark, sx * 0.48, 1.32, 1.99);
    for (const dx of [-0.11, 0, 0.11]) box(0.08, 0.08, 0.03, m.head, sx * 0.48 + dx, 1.33, 2.045, 0, 0, 0, ap, false);
    for (const dy of [-0.045, 0.045]) box(0.4, 0.022, 0.022, armorMat, sx * 0.48, 1.33 + dy, 2.08, 0, 0, 0, ap, false);
    box(0.06, 0.03, 0.03, glowMat, sx * 0.62, 1.22, 2.04, 0, 0, 0, ap, false);
  }
  box(0.42, 0.035, 0.035, glowMat, 0, 1.21, 1.98, 0, 0, 0, ap, false);
  // Grav Lance lens: a hex armoured housing set in the glacis lip, a chrome ring and a cyan crystal; the lance leaves
  // from `laser`.
  const lensBody = addMesh(new THREE.CylinderGeometry(0.19, 0.22, 0.36, 6), armorMat, 0, 1.47, 1.92, ap);
  lensBody.rotation.set(Math.PI / 2, 0, Math.PI / 6);
  addMesh(new THREE.TorusGeometry(0.13, 0.035, 6, 6), m.chrome, 0, 1.47, 2.1, ap).rotation.z = Math.PI / 6;
  const crystal = addMesh(new THREE.OctahedronGeometry(0.1, 0), glowMat, 0, 1.47, 2.12, ap, false);
  crystal.scale.set(1, 1, 1.8);
  const laser = new THREE.Object3D();
  laser.position.set(0, 1.47, 2.3);
  ap.add(laser);

  // Rear wall: a recessed vent grille, red tail lights, a tow hook, cable sockets.
  box(0.9, 0.36, 0.04, m.dark, 0, 1.33, -1.52);
  for (let i = 0; i < 5; i++) box(0.86, 0.03, 0.05, armorMat, 0, 1.19 + i * 0.07, -1.54, 0.5);
  for (const sx of [-1, 1]) {
    box(0.16, 0.06, 0.03, tailMat, sx * 0.56, 1.58, -1.51, 0, 0, 0, ap, false);
    box(0.06, 0.06, 0.03, glowMat, sx * 0.4, 1.58, -1.51, 0, 0, 0, ap, false);
    box(0.2, 0.12, 0.08, trimMat, sx * 0.48, 1.0, -1.52);
  }
  box(0.14, 0.1, 0.12, trimMat, 0, 0.84, -1.55);
  box(0.04, 0.12, 0.06, m.chrome, 0, 0.8, -1.63, 0, 0, 0, ap, false);

  // Gyro cradle: two armoured struts (ribbed, bolted, cyan seam) sweeping back from the hull to clamped bearing
  // caps either side of the gyro; hydraulic pistons from the hull's rear corners brace the caps from below and cable
  // bundles (one live cyan line each side) sag from the rear wall into the caps.
  {
    const x0 = 0.72;
    const z0 = -1.2;
    const dx = CRADLE_X - x0;
    const dz = GYRO_Z - z0;
    const len = Math.hypot(dx, dz);
    for (const sx of [-1, 1]) {
      const ry = sx * Math.atan2(dx, dz);
      const cx = sx * (x0 + dx / 2);
      const cz = z0 + dz / 2;
      box(0.2, 0.26, len, armorMat, cx, GYRO_Y - 0.02, cz, 0, ry);
      box(0.26, 0.05, len * 0.8, trimMat, cx, GYRO_Y + 0.12, cz, 0, ry);
      box(0.06, 0.04, len * 0.7, glowMat, cx, GYRO_Y + 0.16, cz, 0, ry, 0, ap, false);
      box(0.12, 0.08, len * 0.85, trimMat, cx, GYRO_Y - 0.18, cz, 0, ry);
      const ux = dx / len;
      const uz = dz / len;
      for (let i = 0; i < 4; i++) {
        const k = 0.22 + i * 0.18;
        const bx = sx * (x0 + dx * k);
        const bz = z0 + dz * k;
        addMesh(boltGeo, m.chrome, bx + sx * uz * 0.1, GYRO_Y + 0.16, bz - ux * 0.1, ap, false);
        addMesh(boltGeo, m.chrome, bx - sx * uz * 0.1, GYRO_Y + 0.16, bz + ux * 0.1, ap, false);
      }
      // Bearing cap (faceted), clamp blocks above and below it with bolts, a cyan pin.
      const cap = addMesh(new THREE.CylinderGeometry(0.23, 0.28, 0.26, 8), trimMat, sx * CRADLE_X, GYRO_Y, GYRO_Z, ap);
      cap.rotation.z = Math.PI / 2;
      for (const dy of [-0.3, 0.3]) {
        box(0.28, 0.1, 0.42, armorMat, sx * (CRADLE_X + 0.02), GYRO_Y + dy, GYRO_Z);
        bolts(2, sx * (CRADLE_X + 0.1), GYRO_Y + dy + Math.sign(dy) * 0.05, GYRO_Z - 0.14, sx * (CRADLE_X + 0.1), GYRO_Y + dy + Math.sign(dy) * 0.05, GYRO_Z + 0.14);
      }
      box(0.1, 0.62, 0.14, trimMat, sx * (CRADLE_X + 0.13), GYRO_Y, GYRO_Z);
      const pin = addMesh(new THREE.CylinderGeometry(0.09, 0.09, 0.16, 6), glowMat, sx * (CRADLE_X - 0.15), GYRO_Y, GYRO_Z, ap, false);
      pin.rotation.z = Math.PI / 2;
      // Piston: cylinder body from the hull corner, chrome rod into the lower clamp.
      const pa = new THREE.Vector3(sx * 0.7, 0.95, -1.42);
      const pb = new THREE.Vector3(sx * CRADLE_X, GYRO_Y - 0.34, GYRO_Z + 0.12);
      const pm = new THREE.Vector3().lerpVectors(pa, pb, 0.55);
      beam(pa, pm, 0.14, 0.14, trimMat);
      beam(pm.clone().lerp(pa, 0.1), pb, 0.06, 0.06, m.chrome);
      box(0.18, 0.14, 0.14, trimMat, pa.x, pa.y, pa.z);
      // Cables: two dark, one cyan, from sockets on the rear wall into the cap's underside.
      for (let k = 0; k < 3; k++) {
        cable(
          _v.set(sx * (0.42 + k * 0.06), 1.0, -1.55).clone(),
          _u.set(sx * (CRADLE_X - 0.06 + k * 0.05), GYRO_Y - 0.32, GYRO_Z + 0.2).clone(),
          k === 1 ? 0.035 : 0.05,
          0.16 + k * 0.03,
          k === 1 ? glowMat : m.dark,
        );
      }
    }
  }

  /* ---- turret: a faceted angled housing (raked front, side armour cheeks, rear bustle with fins and a vent) on a
   * ring, an optics block, commander's hatch and whip antenna; it carries the pulse emitter ---- */
  const turret = new THREE.Group();
  turret.position.set(0, 2.088, 0.05);
  ap.add(turret);
  addMesh(new THREE.CylinderGeometry(0.58, 0.64, 0.1, 8), trimMat, 0, 0.03, 0, turret).rotation.y = Math.PI / 8;
  addMesh(new THREE.TorusGeometry(0.6, 0.02, 4, 16), glowMat, 0, 0.085, 0, turret, false).rotation.x = Math.PI / 2;
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    addMesh(boltGeo, m.chrome, Math.sin(a) * 0.61, 0.07, Math.cos(a) * 0.61, turret, false);
  }
  addMesh(
    loft([
      { z: -0.64, y: [0.08, 0.12, 0.3, 0.36], w: [0.3, 0.36, 0.26] },
      { z: -0.36, y: [0.06, 0.1, 0.36, 0.46], w: [0.44, 0.54, 0.38] },
      { z: 0.18, y: [0.06, 0.1, 0.36, 0.46], w: [0.44, 0.54, 0.38] },
      { z: 0.5, y: [0.08, 0.14, 0.3, 0.36], w: [0.3, 0.4, 0.26] },
    ]),
    m.paint,
    0, 0, 0, turret,
  );
  box(0.62, 0.03, 0.4, m.trim, 0, 0.47, -0.1, 0, 0, 0, turret);
  for (const sx of [-1, 1]) {
    // Cheek armour angled in toward the gun, bolted; a cyan seam along the flank below it.
    box(0.08, 0.3, 0.52, armorMat, sx * 0.56, 0.23, 0.28, 0, -sx * 0.38, sx * 0.14, turret);
    bolts(3, sx * 0.62, 0.33, 0.06, sx * 0.5, 0.33, 0.44, turret);
    box(0.02, 0.03, 0.48, glowMat, sx * 0.55, 0.16, -0.12, 0, 0, 0, turret, false);
    // Capacitor canisters on the bustle flanks.
    const can = addMesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 6), trimMat, sx * 0.47, 0.2, -0.5, turret);
    can.rotation.x = Math.PI / 2;
    addMesh(new THREE.TorusGeometry(0.065, 0.015, 4, 6), glowMat, sx * 0.47, 0.2, -0.5, turret, false);
  }
  // Bustle: heat-sink fins on top and a vent grille on the back.
  for (let i = 0; i < 5; i++) box(0.025, 0.08, 0.3, trimMat, -0.2 + i * 0.1, 0.44, -0.5, 0, 0, 0, turret);
  box(0.4, 0.18, 0.03, m.dark, 0, 0.22, -0.645, 0, 0, 0, turret);
  for (const dy of [-0.05, 0, 0.05]) box(0.38, 0.02, 0.04, armorMat, 0, 0.22 + dy, -0.665, 0, 0, 0, turret, false);
  // Optics block (front right): an armoured box with a cyan lens and a little sensor mast behind it.
  box(0.2, 0.14, 0.2, armorMat, 0.24, 0.53, 0.1, 0, 0, 0, turret);
  box(0.13, 0.07, 0.02, glowMat, 0.24, 0.54, 0.205, 0, 0, 0, turret, false);
  box(0.05, 0.12, 0.05, trimMat, 0.24, 0.66, 0.02, 0, 0, 0, turret);
  // Commander's hatch (top left) with a handle.
  addMesh(new THREE.CylinderGeometry(0.15, 0.17, 0.05, 8), trimMat, -0.18, 0.49, -0.16, turret);
  box(0.16, 0.03, 0.03, m.chrome, -0.18, 0.53, -0.16, 0, 0, 0, turret, false);
  // Whip antenna (rear left) with a cyan tip.
  box(0.08, 0.1, 0.08, trimMat, -0.3, 0.42, -0.5, 0, 0, 0, turret);
  box(0.02, 0.75, 0.02, m.dark, -0.3, 0.84, -0.54, -0.1, 0, 0, turret, false);
  box(0.04, 0.04, 0.04, glowMat, -0.3, 1.21, -0.58, 0, 0, 0, turret, false);

  // Emitter: an angled mantlet, a heavy barrel with a thermal sleeve and square cooling fins, three cyan focusing
  // coils (they spin while firing), a hex muzzle shroud with vent slots and a crystal tip.
  const GY = 0.2;
  const GZ = 0.3;
  const gun = new THREE.Group();
  gun.position.set(0, GY, GZ);
  turret.add(gun);
  box(0.42, 0.28, 0.3, m.paint, 0, 0, 0.12, 0, 0, 0, gun);
  box(0.42, 0.05, 0.2, armorMat, 0, 0.16, 0.14, 0.35, 0, 0, gun);
  bolts(2, -0.15, 0.06, 0.275, 0.15, 0.06, 0.275, gun);
  bolts(2, -0.15, -0.07, 0.275, 0.15, -0.07, 0.275, gun);
  const barrel = addMesh(new THREE.CylinderGeometry(0.085, 0.11, 1.25, 8), m.dark, 0, 0, 0.85, gun);
  barrel.rotation.x = Math.PI / 2;
  const sleeve = addMesh(new THREE.CylinderGeometry(0.13, 0.13, 0.34, 8), trimMat, 0, 0, 0.45, gun);
  sleeve.rotation.x = Math.PI / 2;
  for (let i = 0; i < 4; i++) box(0.28, 0.28, 0.025, armorMat, 0, 0, 0.32 + i * 0.075, 0, 0, 0, gun);
  const shroud = addMesh(new THREE.CylinderGeometry(0.16, 0.19, 0.3, 6), armorMat, 0, 0, 1.33, gun);
  shroud.rotation.x = -Math.PI / 2;
  for (const sx of [-1, 1]) box(0.02, 0.05, 0.18, glowMat, sx * 0.17, 0, 1.33, 0, 0, 0, gun, false);
  addMesh(new THREE.TorusGeometry(0.15, 0.03, 4, 6), trimMat, 0, 0, 1.48, gun);
  const rotor = new THREE.Group();
  rotor.position.set(0, 0, 0.7);
  gun.add(rotor);
  for (let i = 0; i < 3; i++) {
    const r = addMesh(new THREE.TorusGeometry(0.15 - i * 0.01, 0.028, 4, 10), glowMat, 0, 0, i * 0.2, rotor, false);
    r.rotation.z = i * 0.7;
    addMesh(new THREE.BoxGeometry(0.06, 0.06, 0.07), m.chrome, 0, 0.15 - i * 0.01, i * 0.2, rotor, false);
    addMesh(new THREE.BoxGeometry(0.06, 0.06, 0.07), m.chrome, 0, -0.15 + i * 0.01, i * 0.2, rotor, false);
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
  const hubBoltGeo = new THREE.BoxGeometry(0.06, 0.08, 0.08);
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
      addMesh(hubBoltGeo, m.chrome, sx * (WHEEL_W / 2 + 0.04), Math.sin(a) * 0.26, Math.cos(a) * 0.26, w, false);
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

  return { group: ap, parts: { turret, gunMount: gun, minigun: rotor, muzzles: [mz, mz], laser, gyro, glowMat, metalMats: [armorMat, trimMat], update } };
}
