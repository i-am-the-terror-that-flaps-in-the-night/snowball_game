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
/** Gyro core: centre (model space), tucked under the rear deck with its top just below the deck's underside. */
const GYRO_Y = 1.14;
const GYRO_Z = -2.6;
/** Gimbal rings, outer to inner: mid radius, radial half-thickness, axial half-width, facet count. Each ring (clamps
 *  and pin bosses included) stays inside the inner face of its parent, so however the three pivots turn, nothing
 *  touches: outer sweep r <= 0.97, middle <= 0.73 (outer housings start at 0.735), inner <= 0.52 (middle housings 0.54). */
const RING_R = [0.86, 0.64, 0.44] as const;
const RING_H = [0.075, 0.06, 0.05] as const;
const RING_W = [0.09, 0.075, 0.06] as const;
const RING_N = [16, 14, 12] as const;
/** Cradle bearing caps: x of their centres (the outer ring's trunnions run into them). */
const CRADLE_X = 1.12;
/** Gyro ring spin (rad/s) idle, extra per m/s of speed, extra while the pulse laser fires; per-ring rate factors
 *  (outer about x in the cradle, middle about the outer ring's y, inner about the middle ring's z). */
const RING_IDLE = 1.2;
const RING_SPEED = 0.35;
const RING_FIRE = 6;
const RING_RATE = [0.55, -1.0, 1.7] as const;
/** The outer ring rocks in its trunnions (rad about x: centre and swing) rather than spinning round to face back. */
const OUTER_TILT = 0.9;
const OUTER_SWING = 0.45;
/** Energy arcs from the core to the inner ring's emitter nodes: count, segments each. */
const ARCS = 4;
const ARC_SEG = 6;

const CYAN = 0x38e8ff;

/** Rear deck (engine cover over the gyro bay), tail to front, as loft sections: a low, raked hood with broad
 *  chamfers, its crest just behind the hull roof and its tail dropping toward the back so the chase camera sees over
 *  it. Its underside arches over the gimbal's sweep: the outer ring only rocks (OUTER_TILT +- OUTER_SWING), so its
 *  upper half reaches up and FORWARD (highest, about 0.92 above the core, some 0.3 ahead of it); behind the core
 *  only the middle ring's 0.73 sphere rises. The keel clears that envelope (plus the hover bob) by 0.04 or more. */
const DECK: readonly LoftSection[] = [
  { z: -3.3, y: [1.82, 1.8, 1.9, 1.97], w: [0.6, 1.12, 0.66] },
  { z: -3.05, y: [1.95, 1.88, 1.99, 2.07], w: [0.76, 1.28, 0.8] },
  { z: -2.45, y: [2.13, 1.97, 2.12, 2.25], w: [0.8, 1.28, 0.82] },
  { z: -1.95, y: [2.13, 1.99, 2.14, 2.27], w: [0.8, 1.28, 0.82] },
  { z: -1.45, y: [2.0, 1.98, 2.12, 2.22], w: [0.6, 0.86, 0.68] },
  { z: -0.85, y: [1.95, 1.95, 2.03, 2.085], w: [0.6, 0.84, 0.66] },
];

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

/** A faceted armour band in the XY plane (axis Z): an n-gon annulus from rIn to rOut (vertex radii), spanning
 *  z0..z1, first vertex at angle a0. Non-indexed, one normal per face (flat-shaded with any material). */
function band(n: number, rIn: number, rOut: number, z0: number, z1: number, a0 = 0): THREE.BufferGeometry {
  const pos: number[] = [];
  const P = (r: number, a: number, z: number) => [r * Math.cos(a), r * Math.sin(a), z];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let k = 0; k < n; k++) {
    const a = a0 + (k / n) * Math.PI * 2;
    const b = a0 + ((k + 1) / n) * Math.PI * 2;
    quad(P(rOut, a, z0), P(rOut, b, z0), P(rOut, b, z1), P(rOut, a, z1)); // outer face
    quad(P(rIn, a, z0), P(rIn, a, z1), P(rIn, b, z1), P(rIn, b, z0)); // inner face
    quad(P(rIn, a, z1), P(rOut, a, z1), P(rOut, b, z1), P(rIn, b, z1)); // +z side
    quad(P(rIn, a, z0), P(rIn, b, z0), P(rOut, b, z0), P(rOut, a, z0)); // -z side
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Soft fresnel halo shell: bright at the silhouette, clear face-on (additive), so the core glows in 3D. */
function fresnelMat(color: number, power: number, strength: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uK: { value: strength } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uK; varying vec3 vN; varying vec3 vV;
      void main() { float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); gl_FragColor = vec4(uColor * pow(f, ${power.toFixed(2)}) * uK, 1.0); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/**
 * ARSENAL: a futuristic magnetic / laser vehicle (not a mech, not a tank). Two huge rugged off-road wheels at the
 * front (armoured hubs, glowing cyan rims) carry the nose; there are no wheels at the back: the rear hovers on a GYRO
 * CORE, the signature: a three-axis gimbal of faceted armour rings (each pinned in its parent and turning about its
 * own pivot) round a crystal reactor core with energy arcs, tucked into a bay under an armoured rear deck (cheek
 * skirts, bearing caps, swept struts, pistons, cables), projecting light rings onto the snow. Between them a faceted gunmetal hull
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

  // Main hull: rear wall (the front of the gyro bay), roof run, upper glacis, lower glacis / nose.
  addMesh(
    loft([
      { z: -1.5, y: [0.64, 0.82, 1.72, 2.07], w: [0.55, 0.78, 0.6] },
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
  // Roof: a trim panel behind the turret (decal spot).
  box(1.2, 0.04, 0.34, m.trim, 0, 2.09, -0.66);
  bolts(2, -0.55, 2.115, -0.55, 0.55, 2.115, -0.55);

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

  /* ---- rear section: an armoured rear deck (a raised engine-bay hood continuing the hull's faceted lines) that
   * overhangs the GYRO BAY. The gyro sits under it in a cradle: the hull's rear wall is the bay's back frame (an
   * octagonal socket facing the core), the deck is its roof, armour skirts hang from the deck edges as cheek plates
   * and carry the bearing caps the outer ring pivots in; swept struts, pistons and cables tie the caps to the hull ---- */
  addMesh(loft(DECK), m.paint, 0, 0, 0, ap);
  /** Vertex k (loft order) of deck section i. */
  const dv = (i: number, k: number) => {
    const { z, y, w } = DECK[i];
    const j = k < 4 ? k : 7 - k;
    return new THREE.Vector3((k < 4 ? 1 : -1) * [w[0], w[1], w[1], w[2]][j], y[j], z);
  };
  /** Roof height and pitch (rad about x, as slopePlate) of the deck at z. */
  const roofAt = (z: number) => {
    let i = 0;
    while (i < DECK.length - 2 && z > DECK[i + 1].z) i++;
    const s0 = DECK[i];
    const s1 = DECK[i + 1];
    const k = (z - s0.z) / (s1.z - s0.z);
    return { y: s0.y[3] + (s1.y[3] - s0.y[3]) * k, a: Math.atan2(s0.y[3] - s1.y[3], s1.z - s0.z) };
  };
  /** A box lying on the deck roof at (x, z), lifted `lift` off it, pitched with the roof (plus `rx`). */
  const onRoof = (w: number, h: number, d: number, mat: THREE.Material, x: number, z: number, lift = 0, rx = 0, shadow = true) => {
    const { y, a } = roofAt(z);
    const n = lift + h / 2;
    return box(w, h, d, mat, x, y + Math.cos(a) * n, z + Math.sin(a) * n, a + rx, 0, 0, ap, shadow);
  };
  /** A plate t thick on the deck facet between sections i and i + 1 and loft vertices ka..kb, covering the
   *  fraction u0..u1 across it and v0..v1 along it (bilinear), raised off the facet along its outward normal. */
  const facetPlate = (i: number, ka: number, kb: number, u0: number, u1: number, v0: number, v1: number, t: number, mat: THREE.Material, shadow = true) => {
    const A = dv(i, ka), B = dv(i, kb), C = dv(i + 1, ka), D = dv(i + 1, kb);
    const P = (u: number, v: number) => new THREE.Vector3().lerpVectors(A, B, u).lerp(new THREE.Vector3().lerpVectors(C, D, u), v);
    const base = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
    const n = new THREE.Vector3().subVectors(base[1], base[0]).cross(new THREE.Vector3().subVectors(base[3], base[0])).normalize();
    const mid = base.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(0.25);
    if (n.dot(_v.set(mid.x, mid.y - 1.9, 0)) < 0) n.negate();
    for (const p of base) p.addScaledVector(n, 0.004);
    const top = base.map((p) => p.clone().addScaledVector(n, t));
    const c = mid.clone().addScaledVector(n, 0.004 + t / 2);
    const pos: number[] = [];
    const tri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3) => {
      const f = _u.subVectors(q, p).cross(_v.subVectors(r, p)).dot(new THREE.Vector3().subVectors(p, c)) < 0;
      for (const o of f ? [p, r, q] : [p, q, r]) pos.push(o.x, o.y, o.z);
    };
    const quad = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3, s: THREE.Vector3) => (tri(p, q, r), tri(p, r, s));
    quad(base[0], base[1], base[2], base[3]);
    quad(top[0], top[1], top[2], top[3]);
    for (let k = 0; k < 4; k++) quad(base[k], base[(k + 1) % 4], top[(k + 1) % 4], top[k]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return addMesh(g, mat, 0, 0, 0, ap, shadow);
  };
  // Deck top: an armour plate on the crest and one on the ramp up from the hull, bolted; twin louvred engine vents on
  // the raked rear facet, a cyan spine seam down the middle, heat-sink fins on the tail; armour plates on the
  // chamfers, a cyan line down each flank.
  const crest = [roofAt(-2.45).y, roofAt(-1.95).y];
  slopePlate(1.5, 0.035, 0, crest[0], -2.45, crest[1], -1.95, armorMat, 0.03);
  slopePlate(1.2, 0.03, 0, roofAt(-1.95).y, -1.95, roofAt(-1.45).y, -1.45, armorMat, 0.05);
  for (const sx of [-1, 1]) {
    for (let j = 0; j < 3; j++) onRoof(0.036, 0.036, 0.036, m.chrome, sx * 0.68, -2.02 - j * 0.18, 0.035, 0, false);
    // Engine vent: a dark recessed grille with five louvre slats, a trim frame bar fore and aft.
    // The grille is a thin dark backing; the slats sit inside the trim frame (tops flush with the 0.035 m frame bars).
    slopePlate(0.52, 0.01, sx * 0.4, roofAt(-3.05).y, -3.05, roofAt(-2.45).y, -2.45, m.dark, 0.06);
    for (let j = 0; j < 5; j++) onRoof(0.48, 0.02, 0.06, armorMat, sx * 0.4, -2.56 - j * 0.11, 0.006, -0.3, false);
    for (const z of [-2.5, -3.0]) onRoof(0.56, 0.035, 0.035, trimMat, sx * 0.4, z, 0.0);
    // Chamfer plates (crest and rear facet) and the flank line.
    const [ka, kb] = sx > 0 ? [2, 3] : [5, 4];
    const [fa, fb] = sx > 0 ? [1, 2] : [6, 5];
    for (const i of [1, 2]) {
      facetPlate(i, ka, kb, 0.08, 0.9, 0.04, 0.96, 0.03, armorMat);
      facetPlate(i, fa, fb, 0.45, 0.6, 0.02, i === 1 ? 0.98 : 1, 0.012, glowMat, false);
    }
    // Tail light cluster and a cyan marker on the deck's rear face.
    box(0.26, 0.05, 0.03, tailMat, sx * 0.62, 1.89, -3.31, 0, 0, 0, ap, false);
    box(0.06, 0.05, 0.03, glowMat, sx * 0.4, 1.89, -3.31, 0, 0, 0, ap, false);
  }
  onRoof(0.035, 0.02, 0.46, glowMat, 0, -2.2, 0.035, 0, false);
  onRoof(0.035, 0.02, 0.58, glowMat, 0, -2.75, 0, 0, false);
  for (let i = 0; i < 5; i++) onRoof(0.025, 0.07, 0.2, trimMat, -0.3 + i * 0.15, -3.17);
  // Rear bumper under the deck's tail with a tow hook.
  box(1.7, 0.08, 0.1, trimMat, 0, 1.77, -3.27);
  bolts(4, -0.65, 1.77, -3.325, 0.65, 1.77, -3.325);
  for (const dx of [-0.05, 0.05]) box(0.03, 0.12, 0.14, trimMat, dx, 1.68, -3.3);
  box(0.13, 0.04, 0.04, m.chrome, 0, 1.66, -3.34, 0, 0, 0, ap, false);
  // Hood projector under the deck: a cyan octagon ring over the gyro.
  const hoodRing = addMesh(band(8, 0.3, 0.34, -0.008, 0.008, Math.PI / 8), glowMat, 0, 2.11, -2.2, ap, false);
  hoodRing.rotation.x = Math.PI / 2;

  // Bay back frame on the hull's rear wall: an octagonal socket facing the core (armoured frame, dark well, cyan
  // conduit ring, a hex emitter), clamps and bolts; cable sockets either side.
  const SY = GYRO_Y + 0.03;
  addMesh(band(8, 0.4, 0.52, -0.08, 0.0, Math.PI / 8), trimMat, 0, SY, -1.5, ap);
  addMesh(new THREE.CircleGeometry(0.42, 8), m.dark, 0, SY, -1.515, ap, false).rotation.set(0, Math.PI, Math.PI / 8);
  addMesh(band(8, 0.29, 0.33, -0.035, 0, Math.PI / 8), glowMat, 0, SY, -1.5, ap, false);
  addMesh(new THREE.CylinderGeometry(0.1, 0.13, 0.08, 6), glowMat, 0, SY, -1.53, ap, false).rotation.x = Math.PI / 2;
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    box(0.13, 0.18, 0.1, trimMat, Math.cos(a) * 0.47, SY + Math.sin(a) * 0.47, -1.57, 0, 0, a + Math.PI / 2);
  }
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    addMesh(boltGeo, m.chrome, Math.cos(a) * 0.46, SY + Math.sin(a) * 0.46, -1.585, ap, false);
  }
  for (const sx of [-1, 1]) box(0.24, 0.14, 0.08, trimMat, sx * 0.64, 0.9, -1.52);

  {
    const x0 = 0.72;
    const z0 = -1.2;
    const dx = CRADLE_X - x0;
    const dz = GYRO_Z - z0;
    const len = Math.hypot(dx, dz);
    const skirtGeo = (() => {
      const sh = new THREE.Shape();
      // Top edge tucked into the deck's side foot (it falls with the raked tail).
      sh.moveTo(-3.12, 1.88);
      sh.lineTo(-3.05, 1.9);
      sh.lineTo(-2.45, 2.0);
      sh.lineTo(-1.9, 2.02);
      sh.lineTo(-1.9, 1.86);
      sh.lineTo(-2.08, 1.68);
      sh.lineTo(-2.98, 1.68);
      sh.lineTo(-3.12, 1.78);
      sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: false });
      g.translate(0, 0, -0.035);
      g.rotateY(-Math.PI / 2);
      return g;
    })();
    for (const sx of [-1, 1]) {
      // Cheek skirt: an armour plate hanging from the deck edge, a trim strip on its lower edge, three cyan slots,
      // bolts; a hanger block carries the bearing cap under it.
      addMesh(skirtGeo, armorMat, sx * 1.3, 0, 0, ap);
      box(0.09, 0.06, 0.9, trimMat, sx * 1.31, 1.7, -2.53);
      for (const z of [-2.1, -2.25, -2.75, -2.9]) box(0.02, 0.1, 0.05, glowMat, sx * 1.34, 1.81, z, 0, 0, 0, ap, false);
      bolts(4, sx * 1.34, 1.93, -2.0, sx * 1.34, 1.93, -2.6);
      bolts(3, sx * 1.34, 1.74, -2.2, sx * 1.34, 1.74, -2.9);
      // Hanger post down to the cap's upper clamp.
      box(0.16, 0.28, 0.26, trimMat, sx * 1.2, GYRO_Y + 0.43, GYRO_Z);
      box(0.2, 0.06, 0.34, armorMat, sx * 1.2, GYRO_Y + 0.58, GYRO_Z);

      // Swept strut from the hull flank to the cap (ribbed, bolted, cyan seam).
      const ry = sx * Math.atan2(dx, dz);
      const cx = sx * (x0 + dx / 2);
      const cz = z0 + dz / 2;
      box(0.2, 0.24, len, armorMat, cx, GYRO_Y - 0.02, cz, 0, ry);
      box(0.24, 0.05, len * 0.8, trimMat, cx, GYRO_Y + 0.11, cz, 0, ry);
      box(0.06, 0.04, len * 0.7, glowMat, cx, GYRO_Y + 0.15, cz, 0, ry, 0, ap, false);
      box(0.12, 0.08, len * 0.85, trimMat, cx, GYRO_Y - 0.17, cz, 0, ry);
      // Bearing cap (faceted) with clamp blocks above and below, a back plate, the trunnion pin (cyan) the outer
      // ring's boss turns on.
      addMesh(new THREE.CylinderGeometry(0.19, 0.23, 0.24, 8), trimMat, sx * CRADLE_X, GYRO_Y, GYRO_Z, ap).rotation.z = Math.PI / 2;
      for (const dy of [-0.26, 0.26]) {
        box(0.24, 0.08, 0.38, armorMat, sx * (CRADLE_X + 0.02), GYRO_Y + dy, GYRO_Z);
        bolts(2, sx * (CRADLE_X + 0.08), GYRO_Y + dy + Math.sign(dy) * 0.045, GYRO_Z - 0.13, sx * (CRADLE_X + 0.08), GYRO_Y + dy + Math.sign(dy) * 0.045, GYRO_Z + 0.13);
      }
      box(0.08, 0.6, 0.14, trimMat, sx * (CRADLE_X + 0.13), GYRO_Y, GYRO_Z);
      addMesh(new THREE.CylinderGeometry(0.045, 0.045, 0.12, 6), glowMat, sx * 0.97, GYRO_Y, GYRO_Z, ap, false).rotation.z = Math.PI / 2;
      // Piston: cylinder body from the hull's rear corner, chrome rod into the lower clamp.
      const pa = new THREE.Vector3(sx * 0.62, 0.8, -1.45);
      const pb = new THREE.Vector3(sx * CRADLE_X, GYRO_Y - 0.3, GYRO_Z + 0.12);
      const pm = new THREE.Vector3().lerpVectors(pa, pb, 0.55);
      beam(pa, pm, 0.13, 0.13, trimMat);
      beam(pm.clone().lerp(pa, 0.1), pb, 0.055, 0.055, m.chrome);
      // Cables: two dark, one cyan, from the rear wall's sockets into the cap's underside.
      for (let k = 0; k < 3; k++) {
        cable(
          _v.set(sx * (0.58 + k * 0.06), 0.86, -1.55).clone(),
          _u.set(sx * (CRADLE_X - 0.06 + k * 0.05), GYRO_Y - 0.28, GYRO_Z + 0.2).clone(),
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

  /* ---- gyro core: a three-axis GIMBAL. The outer ring turns about x on trunnions in the cradle's bearing caps;
   * the middle ring turns inside it about the outer ring's y, on pins in housings on the outer ring's inner face;
   * the inner ring turns inside the middle about the middle ring's z, on pins the same way. Each ring is a faceted
   * armour band (raised panels, clamp blocks, a cyan groove between two lips on its inner face, cyan seams on its
   * sides). In the middle floats the core: a faceted crystal round a white plasma heart in a fresnel halo, with
   * energy arcs licking out to the inner ring's emitter nodes ---- */
  const gyroRoot = new THREE.Group();
  gyroRoot.position.set(0, GYRO_Y, GYRO_Z);
  ap.add(gyroRoot);
  const pivots = [new THREE.Group(), new THREE.Group(), new THREE.Group()];
  gyroRoot.add(pivots[0]);
  pivots[0].add(pivots[1]);
  pivots[1].add(pivots[2]);
  const clampGeo = new THREE.BoxGeometry(1, 1, 1);
  /** Ring i in a holder (plane XY, pins on the holder's y axis unless pinA = 0: x axis) under its pivot; `orient`
   *  turns the holder into the pivot's frame. Returns the inner face's apothem. */
  const buildRing = (i: number, pinA: number, orient: THREE.Euler) => {
    const R = RING_R[i];
    const h = RING_H[i];
    const w = RING_W[i];
    const n = RING_N[i];
    const rIn = R - h;
    const rOut = R + h;
    const c = Math.cos(Math.PI / n);
    const a0 = pinA - Math.PI / n; // a face centred on each pin
    const g = new THREE.Group();
    g.rotation.copy(orient);
    pivots[i].add(g);
    // Structural band, the two inner lips either side of the glowing groove, the groove, side seams.
    addMesh(band(n, rIn + 0.025, rOut, -w, w, a0), armorMat, 0, 0, 0, g, false);
    for (const sz of [-1, 1]) {
      addMesh(band(n, rIn, rIn + 0.03, sz > 0 ? w - 0.028 : -w, sz > 0 ? w : -w + 0.028, a0), armorMat, 0, 0, 0, g, false);
      addMesh(band(n, R - 0.012, R + 0.012, sz > 0 ? w : -w - 0.006, sz > 0 ? w + 0.006 : -w, a0), glowMat, 0, 0, 0, g, false);
    }
    addMesh(band(n, rIn + 0.008, rIn + 0.026, -w + 0.028, w - 0.028, a0), glowMat, 0, 0, 0, g, false);
    const chord = 2 * rOut * c * Math.tan(Math.PI / n);
    const near = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.01;
    for (let k = 0; k < n; k++) {
      const mA = a0 + ((k + 0.5) / n) * Math.PI * 2;
      const cs = Math.cos(mA);
      const sn = Math.sin(mA);
      if (near(mA, pinA) || near(mA, pinA + Math.PI)) {
        // Pin boss on the outer face (the pivot runs through it) with a cyan cap.
        const boss = addMesh(new THREE.CylinderGeometry(0.075 - i * 0.012, 0.09 - i * 0.012, 0.07, 8), trimMat, cs * (rOut * c + 0.02), sn * (rOut * c + 0.02), 0, g, false);
        boss.rotation.z = mA - Math.PI / 2;
        continue;
      }
      // Raised panel (gaps between them read as segments); every quarter a clamp block wrapping the band, bolted.
      const pl = addMesh(clampGeo, armorMat, cs * (rOut * c + 0.012), sn * (rOut * c + 0.012), 0, g, false);
      pl.scale.set(chord * 0.84, 0.024, w * 1.7);
      pl.rotation.z = mA - Math.PI / 2;
      if ((k + 2) % (n / 4) === 0) {
        const cl = addMesh(clampGeo, trimMat, cs * R * c, sn * R * c, 0, g, false);
        cl.scale.set(chord * 0.45, 2 * h + 0.045, 2 * w + 0.04);
        cl.rotation.z = mA - Math.PI / 2;
        for (const sz of [-1, 1]) addMesh(boltGeo, m.chrome, cs * (rOut * c + 0.03), sn * (rOut * c + 0.03), sz * w * 0.55, g, false);
      } else if (k % 2 === 1) {
        // Small cyan emitter stud on alternate panels.
        addMesh(boltGeo, glowMat, cs * (rOut * c + 0.03), sn * (rOut * c + 0.03), 0, g, false);
      }
    }
    return rIn * c;
  };
  const inOuter = buildRing(0, 0, new THREE.Euler());
  const inMiddle = buildRing(1, Math.PI / 2, new THREE.Euler(0, Math.PI / 2, 0));
  const inInner = buildRing(2, Math.PI / 2, new THREE.Euler(Math.PI / 2, 0, 0));
  /** Bearing housings on a parent ring's inner face (pivot `p`, along `axis`) and the cyan pins through them into
   *  the child ring's bosses. */
  const housings = (p: THREE.Object3D, axis: 'y' | 'z', rFace: number, rChild: number, size: number) => {
    for (const sg of [-1, 1]) {
      const at = (d: number) => (axis === 'y' ? [0, sg * d, 0] : [0, 0, sg * d]) as [number, number, number];
      const hb = addMesh(clampGeo, trimMat, ...at(rFace - 0.012), p, false);
      hb.scale.set(size, size, size);
      hb.scale[axis] = 0.05;
      const pin = addMesh(new THREE.CylinderGeometry(0.03, 0.03, rFace - rChild + 0.02, 6), glowMat, ...at((rFace + rChild) / 2), p, false);
      if (axis === 'z') pin.rotation.x = Math.PI / 2;
      const col = addMesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 8), m.chrome, ...at(rFace - 0.045), p, false);
      if (axis === 'z') col.rotation.x = Math.PI / 2;
    }
  };
  housings(pivots[0], 'y', inOuter, RING_R[1], 0.17);
  housings(pivots[1], 'z', inMiddle, RING_R[2], 0.14);
  // Emitter nodes on the inner ring's groove (the arcs land on them), in the inner pivot's frame (ring plane XZ).
  const nodes: THREE.Vector3[] = [];
  for (let k = 0; k < ARCS; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const v = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(inInner - 0.02);
    nodes.push(v);
    const nd = addMesh(new THREE.OctahedronGeometry(0.04, 0), glowMat, v.x, v.y, v.z, pivots[2], false);
    nd.scale.set(1, 1.6, 1);
  }
  mergeStatic(pivots[0], { keep: [pivots[1]] });
  mergeStatic(pivots[1], { keep: [pivots[2]] });
  mergeStatic(pivots[2]);

  // Core: a faceted crystal (flat-shaded, emissive white-cyan, see-through) round a white plasma heart, with edge
  // lines on the facets and two fresnel halo shells.
  const crystalGeo = new THREE.IcosahedronGeometry(0.17, 0);
  const crystalMat = new THREE.MeshStandardMaterial({
    color: 0xd8fbff, emissive: 0x52dcff, emissiveIntensity: 0.9, roughness: 0.15, metalness: 0.1,
    flatShading: true, transparent: true, opacity: 0.72, depthWrite: false,
  });
  const core = new THREE.Group();
  gyroRoot.add(core);
  const plasma = new THREE.Mesh(new THREE.IcosahedronGeometry(0.095, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  core.add(plasma);
  const shell = new THREE.Mesh(crystalGeo, crystalMat);
  shell.renderOrder = 3;
  core.add(shell);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xe8fdff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(crystalGeo), edgeMat);
  edges.renderOrder = 4;
  core.add(edges);
  core.scale.set(1, 1.3, 1);
  const haloMat = fresnelMat(CYAN, 2.2, 1.1);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.26, 18, 12), haloMat);
  halo.renderOrder = 5;
  gyroRoot.add(halo);
  const haloOutMat = fresnelMat(0x1a7cff, 1.6, 0.45);
  const haloOut = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 12), haloOutMat);
  haloOut.renderOrder = 5;
  gyroRoot.add(haloOut);

  // Energy arcs: ARCS jagged filaments from the core to the emitter nodes, each a crossed pair of thin ribbons per
  // segment, rewritten in place every few frames (one preallocated buffer).
  const arcPos = new Float32Array(ARCS * ARC_SEG * 12 * 3);
  const arcGeo = new THREE.BufferGeometry();
  const arcAttr = new THREE.BufferAttribute(arcPos, 3).setUsage(THREE.DynamicDrawUsage);
  arcGeo.setAttribute('position', arcAttr);
  arcGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0.6);
  const arcMat = add(0xbff8ff, 0.9);
  arcMat.side = THREE.DoubleSide;
  const arcs = new THREE.Mesh(arcGeo, arcMat);
  arcs.renderOrder = 4;
  pivots[2].add(arcs);
  const arcPts = new Float32Array((ARC_SEG + 1) * 3);
  const zapArcs = () => {
    let o = 0;
    const put = (x: number, y: number, z: number) => {
      arcPos[o++] = x;
      arcPos[o++] = y;
      arcPos[o++] = z;
    };
    for (let j = 0; j < ARCS; j++) {
      const e = nodes[j];
      const live = Math.random() < 0.75;
      // Unit direction (in the XZ plane) and its two perpendiculars: y and the in-plane normal.
      const len = Math.hypot(e.x, e.z);
      const dx = e.x / len;
      const dz = e.z / len;
      for (let s = 0; s <= ARC_SEG; s++) {
        const k = s / ARC_SEG;
        const r = 0.13 + (len - 0.13) * k;
        const amp = live ? 0.07 * Math.sin(Math.PI * k) : 0;
        const jy = (Math.random() * 2 - 1) * amp;
        const jn = (Math.random() * 2 - 1) * amp;
        arcPts[s * 3] = dx * r - dz * jn;
        arcPts[s * 3 + 1] = jy;
        arcPts[s * 3 + 2] = dz * r + dx * jn;
      }
      const wd = live ? 0.012 : 0;
      for (let s = 0; s < ARC_SEG; s++) {
        const ax = arcPts[s * 3], ay = arcPts[s * 3 + 1], az = arcPts[s * 3 + 2];
        const bx = arcPts[s * 3 + 3], by = arcPts[s * 3 + 4], bz = arcPts[s * 3 + 5];
        // Ribbon 1: offset along y.
        put(ax, ay - wd, az); put(bx, by - wd, bz); put(bx, by + wd, bz);
        put(ax, ay - wd, az); put(bx, by + wd, bz); put(ax, ay + wd, az);
        // Ribbon 2: offset along the in-plane normal (-dz, 0, dx).
        put(ax + dz * wd, ay, az - dx * wd); put(bx + dz * wd, by, bz - dx * wd); put(bx - dz * wd, by, bz + dx * wd);
        put(ax + dz * wd, ay, az - dx * wd); put(bx - dz * wd, by, bz + dx * wd); put(ax - dz * wd, ay, az + dx * wd);
      }
    }
    arcAttr.needsUpdate = true;
  };
  zapArcs();

  // Polarity Burst disc: when the gimbal folds flat, a spiral-vaned cyan glow fills it and spins (vertex colours,
  // additive: dark bands are clear).
  const discGeo = (() => {
    const segs = 48;
    const radii = [0.1, 0.4, 0.7, RING_R[0] + RING_H[0]];
    const pos: number[] = [];
    const col: number[] = [];
    const pt = (r: number, a: number) => {
      pos.push(r * Math.cos(a), r * Math.sin(a), 0);
      const b = 0.25 + 0.75 * Math.max(0, Math.cos(6 * a - r * 7));
      const fade = r < 0.15 ? 0.3 : 1;
      col.push(b * fade, b * fade, b * fade);
    };
    for (let ri = 0; ri + 1 < radii.length; ri++) {
      for (let k = 0; k < segs; k++) {
        const a = (k / segs) * Math.PI * 2;
        const b = ((k + 1) / segs) * Math.PI * 2;
        const r0 = radii[ri];
        const r1 = radii[ri + 1];
        pt(r0, a); pt(r1, a); pt(r1, b);
        pt(r0, a); pt(r1, b); pt(r0, b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  })();
  const discMat = add(CYAN, 0);
  discMat.vertexColors = true;
  discMat.side = THREE.DoubleSide;
  const disc = new THREE.Mesh(discGeo, discMat);
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
  // Shadow: hull, rear deck, cradle, turret and wheels (cylinders: their spin doesn't change the shadow); the gyro
  // rings cast none (they spin).
  ap.add(...makeShadowProxy(ap, ap, { keep: [gyroRoot, ...ground] }));

  // Animation state.
  const ang = [0.4, 1.2, 2.1];
  const foldTo = [0, 0, 0];
  let folding = false;
  let zapT = 0;
  let wheelA = 0;
  let t = 0;
  let ringW = RING_IDLE;
  /** Ring i's angle about its pivot: the outer ring rocks, the middle and inner spin. */
  const pose = (i: number) => (i === 0 ? OUTER_TILT + OUTER_SWING * Math.sin(ang[0]) : ang[i]);
  const update = (dt: number, s: ArsenalRigState) => {
    t += dt;
    wheelA += (s.speed * dt) / WHEEL_R;
    for (const w of wheels) w.rotation.x = wheelA;
    // Gimbal: each ring turns about its own pivot axis relative to its parent (faster with speed, while firing,
    // charging). Polarity Burst folds all three flat: each eases to the nearest quarter turn that lays it level
    // (latched when the fold starts), which puts the three rings in one plane as a disc.
    const want = RING_IDLE + RING_SPEED * Math.abs(s.speed) + (s.firing ? RING_FIRE : 0) + s.charge * 5 + s.flat * 9;
    ringW += (want - ringW) * Math.min(1, dt * 3);
    const f = THREE.MathUtils.clamp(s.flat, 0, 1);
    const fe = f * f * (3 - 2 * f);
    if (fe > 0.001 && !folding) {
      folding = true;
      for (let i = 0; i < 3; i++) foldTo[i] = Math.round((pose(i) - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
    } else if (fe <= 0.001 && folding) folding = false;
    for (let i = 0; i < 3; i++) {
      ang[i] += dt * ringW * RING_RATE[i] * (1 - fe);
      if (!folding) ang[i] = ((ang[i] % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const a = folding ? pose(i) + (foldTo[i] - pose(i)) * fe : pose(i);
      if (i === 0) pivots[0].rotation.x = a;
      else if (i === 1) pivots[1].rotation.y = a;
      else pivots[2].rotation.z = a;
    }
    // Core: slow tumble, pulse; halos breathe; arcs re-jitter every few frames (faster when hot).
    core.rotation.x += dt * 0.6;
    core.rotation.y += dt * (0.9 + 0.25 * ringW);
    const hot = 1 + 0.1 * Math.sin(t * 9) + s.charge * 0.5 + f * 0.4;
    core.scale.set(hot, 1.3 * hot, hot);
    plasma.scale.setScalar(1 + 0.18 * Math.sin(t * 13));
    halo.scale.setScalar(Math.min(1.6, 1 + 0.12 * Math.sin(t * 7) + s.charge * 0.5 + f * 0.4));
    haloOut.scale.setScalar(Math.min(1.4, 1 + 0.08 * Math.sin(t * 5) + s.charge * 0.35 + f * 0.3));
    haloMat.uniforms.uK.value = 1.1 + s.charge * 0.8 + f * 0.6;
    zapT -= dt;
    if (zapT <= 0) {
      zapT = s.firing || s.charge > 0.1 ? 0.035 : 0.07;
      zapArcs();
    }
    arcMat.opacity = (0.65 + 0.35 * Math.random()) * (1 - 0.7 * fe);
    disc.visible = f > 0.02;
    discMat.opacity = 0.6 * f;
    disc.rotation.z -= dt * ringW * 0.8;
    // Hover bob: the rear floats on the gyro, pitching gently about the front axle; the light rings breathe with it.
    const bob = Math.sin(t * 2.3) * 0.5 + Math.sin(t * 3.7) * 0.2;
    ap.rotation.x = 0.012 * bob;
    gyroRoot.position.y = GYRO_Y + 0.035 * bob;
    groundMat.opacity = 0.5 + 0.12 * Math.sin(t * 4) + s.charge * 0.2 + f * 0.25;
    for (let i = 0; i < ground.length; i++) {
      const k = i < 2 ? 1 + 0.06 * bob : i < 4 ? 1 + 0.08 * Math.sin(t * 1.7) + f * 0.6 : 1 + 0.25 * ((t * 0.6) % 1) + f * 1.2;
      ground[i].scale.setScalar(k);
    }
  };

  return { group: ap, parts: { turret, gunMount: gun, minigun: rotor, muzzles: [mz, mz], laser, gyro, glowMat, metalMats: [armorMat, trimMat], update } };
}
