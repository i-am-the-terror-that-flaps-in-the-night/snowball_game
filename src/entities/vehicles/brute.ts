import * as THREE from 'three';
import { CLEATS_PER_RUN, SAW_R, buildBuzzsaw, cleatZ, hazardTexture, type Buzzsaw, type Cleat } from '../plowModels';
import { mergeStatic } from '../../render/mergeStatic';
import { makeShadowProxy } from '../../render/shadowProxy';
import { addMesh, type VehicleBuild, type VehicleBuildIn } from './types';

/** One BRUTUS arm: shoulder pivot (swings), forearm (slides out on a punch) and the fist at its end. */
interface MechArm {
  shoulder: THREE.Group;
  forearm: THREE.Group;
  /** Rest position of the forearm (punch offsets are added along +Z). */
  restZ: number;
}

/** BRUTUS / WRECKING MECH animatable parts. */
export interface BruteVehicleParts {
  /** Track cleats (positions only; the meshes were folded into `cleatMesh`). */
  cleats: Cleat[];
  cleatSpan: number;
  /** All cleats as one InstancedMesh (matrices follow cleatZ; written by Plow.setCleats). */
  cleatMesh: THREE.InstancedMesh;
  /** Pose the mech for this frame (no allocation): `punchL` / `punchR` arm extension 0..1, `saw` 0..1 saw-charge
   *  heat (spin + halo), `twist` torso yaw (rad, leans into the punching side). Called by the BRUTUS kit. */
  pose(dt: number, punchL: number, punchR: number, saw: number, twist: number): void;
}

const TRACK_X = 1.18;
const TRACK_LEN = 3.9;
const TRACK_H = 0.95;
/** Track belt: width, loop radius (outer / inner) and the end-wheel centres (z). */
const BELT_W = 0.62;
const LOOP_R = TRACK_H / 2 - 0.02;
const LOOP_IN = LOOP_R - 0.095;
const LOOP_Y = TRACK_H / 2 + 0.02;
const IDLER_Z = 0.1 + (TRACK_LEN - 0.9) / 2;
const SPROCKET_Z = 0.1 - (TRACK_LEN - 0.9) / 2;
/** Shoulder pivots (body space, x mirrored) and the elbow drop to the forearm line. */
const SHOULDER: readonly [number, number, number] = [1.2, 2.42, 0.05];
const ELBOW_Y = -0.85;
/** Forearm slide (m) at full punch extension. */
const PUNCH_REACH = 1.25;
/** Saw centre (x mirrored) and spin (rad/s) idling / at full charge. */
const SAW_POS: readonly [number, number, number] = [1.45, 1.05, 1.45];
const SAW_IDLE = 6;
const SAW_FULL = 46;

type V3 = readonly [number, number, number];
/** Face normals for surface details (rivets, streaks, chips). */
type Face = 'px' | 'nx' | 'py' | 'pz' | 'nz';
const FACE_ROT: Record<Face, V3> = { px: [0, Math.PI / 2, 0], nx: [0, -Math.PI / 2, 0], py: [-Math.PI / 2, 0, 0], pz: [0, 0, 0], nz: [0, Math.PI, 0] };
const RIVET_ROT: Record<Face, V3> = { px: [0, 0, -Math.PI / 2], nx: [0, 0, Math.PI / 2], py: [0, 0, 0], pz: [Math.PI / 2, 0, 0], nz: [-Math.PI / 2, 0, 0] };
const _up = new THREE.Vector3(0, 1, 0);

/** Small deterministic PRNG so the junk detailing is identical on every build. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box with chamfered edges (w x h x d, centred): the heavy cut-plate look. */
function chamfer(w: number, h: number, d: number, c: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const x = w / 2 - c;
  const y = h / 2 - c;
  s.moveTo(-x, -y);
  s.lineTo(x, -y);
  s.lineTo(x, y);
  s.lineTo(-x, y);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * c, bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -(d - 2 * c) / 2);
  return g;
}

/** Flat annular sector in the XZ plane (outward = +x, forward = +z) from angle a0 to a1 (direction (cos, sin) in
 *  (x, z)), extruded `depth` up from y = 0. */
function sector(ri: number, ro: number, a0: number, a1: number, depth: number, seg = 16): THREE.BufferGeometry {
  const s = new THREE.Shape();
  // Shape angle = -a (rotateX(-PI/2) maps shape y to -z).
  s.absarc(0, 0, ro, -a0, -a1, true);
  s.absarc(0, 0, ri, -a1, -a0, false);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: seg });
  g.rotateX(-Math.PI / 2);
  return g;
}

/** A drippy rust streak hanging down from y = 0 (plane facing +Z). */
function streakGeo(w: number, h: number, r: () => number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  const n = 4;
  for (let k = 1; k <= n; k++) s.lineTo((w / 2) * (1 - (k / n) * 0.75) + (r() - 0.5) * w * 0.25, -h * (k / n) * (0.85 + r() * 0.15));
  s.lineTo(0, -h);
  for (let k = n; k >= 1; k--) s.lineTo(-(w / 2) * (1 - (k / n) * 0.75) + (r() - 0.5) * w * 0.25, -h * (k / n) * (0.7 + r() * 0.2));
  s.closePath();
  return new THREE.ShapeGeometry(s, 1);
}

/** An irregular chipped-paint flake (plane facing +Z). */
function chipGeo(rad: number, r: () => number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const n = 7;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const rr = rad * (0.55 + r() * 0.45);
    if (k === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.75);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.75);
  }
  s.closePath();
  return new THREE.ShapeGeometry(s, 1);
}

/** BRUTUS: the WRECKING MECH, junkyard-built. A hunched tracked brawler bolted together from mismatched scrap:
 *  riveted plates in different tones with weld seams, rust streaks and chipped paint, open track units (road
 *  wheels, sprocket, idler, skirts), a scrap cowcatcher, a counterweight with dangling chains, mismatched exhausts,
 *  a caged work light over a cracked viewport slit, two piston fists whose hydraulic rams slide out with the punch,
 *  and a guarded, motor-driven buzzsaw bolted to each front corner. No blade. */
export function buildBruteVehicle({ mats, chassis }: VehicleBuildIn): VehicleBuild<BruteVehicleParts> {
  const bp = new THREE.Group();
  const rnd = prng(0xb2a7);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = bp, shadow = true) =>
    addMesh(geo, mat, x, y, z, parent, shadow);

  /* ---- Materials: Paint Shop body / trim on the big plates; the junk tones are their own (non-paint) materials. ---- */
  const hazardTex = hazardTexture();
  hazardTex.repeat.set(3, 1);
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.6, metalness: 0.25 });
  const trackMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1f, roughness: 0.95, flatShading: true });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.6, metalness: 0.6 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, metalness: 0.45, flatShading: true });
  const fistMat = new THREE.MeshStandardMaterial({ color: 0xb4bac1, roughness: 0.3, metalness: 0.85, flatShading: true });
  const rustMat = new THREE.MeshStandardMaterial({ color: 0x7a3d1e, roughness: 0.9, metalness: 0.3, flatShading: true });
  const streakMat = new THREE.MeshStandardMaterial({ color: 0x8e4a22, roughness: 0.95, metalness: 0.15, polygonOffset: true, polygonOffsetFactor: -2 });
  const grimeMat = new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 1, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2 });
  const chipMat = new THREE.MeshStandardMaterial({ color: 0xa3a9ae, roughness: 0.4, metalness: 0.75, polygonOffset: true, polygonOffsetFactor: -2 });
  const primerMat = new THREE.MeshStandardMaterial({ color: 0x5d6648, roughness: 0.8, metalness: 0.25, flatShading: true });
  const weldMat = new THREE.MeshStandardMaterial({ color: 0x4a3f36, roughness: 0.55, metalness: 0.6, flatShading: true });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xb98d3c, roughness: 0.35, metalness: 0.85 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0xffc46a, emissive: 0xff8a1e, emissiveIntensity: 1.5, roughness: 0.3 });
  const crackMat = new THREE.MeshStandardMaterial({ color: 0xfff1d8, emissive: 0xffe2b0, emissiveIntensity: 0.6, roughness: 0.3 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff3a24, emissive: 0xff1a0a, emissiveIntensity: 1.8, roughness: 0.3 });
  const { paint, trim, dark, chrome, hub, head } = mats;

  /* ---- Detail helpers (all static; merged per material at the end). ---- */
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent: THREE.Object3D = bp, shadow = true) => {
    const m = add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent, shadow);
    m.rotation.set(rx, ry, rz);
    return m;
  };
  const plate = (w: number, h: number, d: number, c: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent: THREE.Object3D = bp, shadow = true) => {
    const m = add(chamfer(w, h, d, c), mat, x, y, z, parent, shadow);
    m.rotation.set(rx, ry, rz);
    return m;
  };
  /** Cylinder along `axis`. */
  const cyl = (rt: number, rb: number, h: number, seg: number, mat: THREE.Material, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'y', parent: THREE.Object3D = bp, shadow = true) => {
    const m = add(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, parent, shadow);
    if (axis === 'x') m.rotation.z = Math.PI / 2;
    else if (axis === 'z') m.rotation.x = Math.PI / 2;
    return m;
  };
  /** A rod of radius r from a to b. */
  const rod = (a: V3, b: V3, r: number, mat: THREE.Material, parent: THREE.Object3D = bp, seg = 6, shadow = false) => {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = d.length();
    const m = add(new THREE.CylinderGeometry(r, r, len, seg), mat, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, parent, shadow);
    m.quaternion.setFromUnitVectors(_up, d.normalize());
    return m;
  };
  const weld = (a: V3, b: V3, parent: THREE.Object3D = bp) => rod(a, b, 0.022, weldMat, parent, 5);
  const rivetGeo = new THREE.CylinderGeometry(0.024, 0.03, 0.03, 6);
  const rivet = (x: number, y: number, z: number, f: Face, parent: THREE.Object3D = bp) => {
    const m = add(rivetGeo, steelMat, x, y, z, parent, false);
    m.rotation.set(...RIVET_ROT[f]);
    return m;
  };
  const rivets = (a: V3, b: V3, n: number, f: Face, parent: THREE.Object3D = bp) => {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      rivet(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, f, parent);
    }
  };
  /** Flat surface detail (streak / chip / grime) on face `f` at (x, y, z), rolled by `roll`. */
  const decal = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, f: Face, roll = 0, parent: THREE.Object3D = bp) => {
    const m = add(geo, mat, x, y, z, parent, false);
    const r = FACE_ROT[f];
    m.rotation.set(r[0], r[1], r[2] + roll);
    return m;
  };
  const streak = (x: number, y: number, z: number, f: Face, w = 0.08, h = 0.3, parent: THREE.Object3D = bp) =>
    decal(streakGeo(w, h * (0.7 + rnd() * 0.5), rnd), rnd() < 0.3 ? grimeMat : streakMat, x, y, z, f, 0, parent);
  const chip = (x: number, y: number, z: number, f: Face, s = 0.07, parent: THREE.Object3D = bp) =>
    decal(chipGeo(s, rnd), chipMat, x, y, z, f, rnd() * 6, parent);
  const hexGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.05, 6);
  const fitting = (x: number, y: number, z: number, axis: 'x' | 'y' | 'z', parent: THREE.Object3D = bp) => {
    const m = add(hexGeo, brassMat, x, y, z, parent, false);
    if (axis === 'x') m.rotation.z = Math.PI / 2;
    else if (axis === 'z') m.rotation.x = Math.PI / 2;
    return m;
  };
  const hose = (pts: V3[], r: number, parent: THREE.Object3D = bp) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    return add(new THREE.TubeGeometry(curve, 14, r, 6), trackMat, 0, 0, 0, parent, false);
  };
  const linkGeo = new THREE.TorusGeometry(0.05, 0.016, 4, 8);
  linkGeo.scale(1, 1.45, 1);
  /** A chain of links along the polyline `pts` (alternate links turned 90 degrees). */
  const chain = (pts: V3[], parent: THREE.Object3D = bp) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const n = Math.max(2, Math.round(curve.getLength() / 0.1));
    const t = new THREE.Vector3();
    const q = new THREE.Quaternion();
    for (let i = 0; i <= n; i++) {
      const p = curve.getPointAt(i / n);
      curve.getTangentAt(i / n, t);
      const m = add(linkGeo, ironMat, p.x, p.y, p.z, parent, false);
      m.quaternion.setFromUnitVectors(_up, t);
      if (i % 2) m.quaternion.multiply(q.setFromAxisAngle(_up, Math.PI / 2));
    }
  };

  /* ================================================================ TRACK UNITS ================================= */
  add(chassis, dark, 0, 0.62, 0.05);
  const loopGeo = sector(LOOP_IN, LOOP_R, -Math.PI / 2, Math.PI / 2, BELT_W, 12);
  // sector() bulges along +x in XZ, extruded on y; remap (x, y, z) -> (y - w/2, z, x): a half ring in the YZ plane
  // bulging along +Z, extruded across the belt on X (a cyclic permutation, so the winding is kept).
  loopGeo.applyMatrix4(new THREE.Matrix4().set(0, 1, 0, -BELT_W / 2, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  const runGeo = new THREE.BoxGeometry(BELT_W, LOOP_R - LOOP_IN, IDLER_Z - SPROCKET_Z);
  for (const sx of [-1, 1]) {
    const x = sx * TRACK_X;
    const ox = x + sx * 0.33; // outer face
    // Belt: top and bottom runs plus the two rounded end wraps.
    add(runGeo, trackMat, x, TRACK_H - (LOOP_R - LOOP_IN) / 2, 0.1);
    add(runGeo, trackMat, x, 0.04 + (LOOP_R - LOOP_IN) / 2, 0.1);
    add(loopGeo, trackMat, x, LOOP_Y, IDLER_Z);
    add(loopGeo, trackMat, x, LOOP_Y, SPROCKET_Z).rotation.y = Math.PI;
    // Drive sprocket (rear): toothed iron wheel with a yellow hub and bolt ring.
    cyl(0.33, 0.33, BELT_W - 0.06, 14, ironMat, x, LOOP_Y, SPROCKET_Z, 'x');
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      box(BELT_W - 0.1, 0.1, 0.08, ironMat, x, LOOP_Y + Math.sin(a) * 0.35, SPROCKET_Z + Math.cos(a) * 0.35, Math.PI / 2 - a, 0, 0, bp, false);
    }
    cyl(0.15, 0.15, 0.06, 10, hub, ox - sx * 0.02, LOOP_Y, SPROCKET_Z, 'x', bp, false);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      rivet(ox - sx * 0.04, LOOP_Y + Math.sin(a) * 0.23, SPROCKET_Z + Math.cos(a) * 0.23, sx > 0 ? 'px' : 'nx');
    }
    // Front idler: plain wheel, rust-scabbed rim.
    cyl(0.31, 0.31, BELT_W - 0.08, 14, rustMat, x, LOOP_Y, IDLER_Z, 'x');
    cyl(0.18, 0.2, BELT_W - 0.02, 10, ironMat, x, LOOP_Y, IDLER_Z, 'x', bp, false);
    cyl(0.08, 0.08, BELT_W + 0.02, 8, hub, x, LOOP_Y, IDLER_Z, 'x', bp, false);
    // Road wheels: five twin-disc bogie wheels on a frame beam (one is a rusty replacement).
    box(0.12, 0.2, IDLER_Z - SPROCKET_Z - 0.4, dark, x, 0.42, 0.1, 0, 0, 0, bp, false);
    for (let i = 0; i < 5; i++) {
      const z = -0.9 + i * 0.5;
      const wm = i === 3 ? rustMat : ironMat;
      for (const dx of [-0.17, 0.17]) cyl(0.2, 0.2, 0.13, 12, wm, x + dx, 0.335, z, 'x');
      cyl(0.09, 0.09, 0.05, 8, i === 1 ? brassMat : steelMat, ox - sx * 0.08, 0.335, z, 'x', bp, false);
    }
    // Track guard (fender) over the rear / middle of the track: two welded plates in different tones. The front
    // third of the track runs open under the buzzsaw.
    box(0.74, 0.08, 1.32, trim, x, 1.02, -1.25);
    box(0.74, 0.08, 1.1, sx < 0 ? primerMat : paint, x, 1.02, -0.1);
    weld([x - 0.36, 1.065, -0.62], [x + 0.36, 1.065, -0.62]);
    box(0.74, 0.06, 0.2, ironMat, x, 0.98, 0.52, 0.5, 0, 0); // bent front lip
    rivets([x - 0.33, 1.065, -1.85], [x - 0.33, 1.065, 0.38], 9, 'py');
    rivets([x + 0.33, 1.065, -1.85], [x + 0.33, 1.065, 0.38], 9, 'py');
    // Side skirt: hangs over the top run; hazard nose, scrap tones further back, rivets, rust bleeding from them.
    const skx = x + sx * 0.38;
    const sf: Face = sx > 0 ? 'px' : 'nx';
    box(0.05, 0.34, 0.75, hazardMat, skx, 0.82, 0.05);
    box(0.05, 0.34, 0.95, sx < 0 ? rustMat : trim, skx, 0.82, -0.8, 0, 0, sx * 0.0);
    box(0.05, 0.3, 0.55, sx < 0 ? trim : primerMat, skx + sx * 0.01, 0.84, -1.55, 0.04 * sx);
    rivets([skx + sx * 0.03, 0.96, -1.8], [skx + sx * 0.03, 0.96, 0.36], 10, sf);
    rivets([skx + sx * 0.03, 0.68, -1.8], [skx + sx * 0.03, 0.68, 0.36], 10, sf);
    weld([skx + sx * 0.03, 0.66, -0.32], [skx + sx * 0.03, 0.99, -0.32]);
    for (const z of [-1.62, -1.05, -0.5, 0.2]) streak(skx + sx * 0.03, 0.94, z + rnd() * 0.1, sf, 0.06, 0.22);
    for (let k = 0; k < 3; k++) chip(skx + sx * 0.03, 0.75 + rnd() * 0.15, -0.3 + rnd() * 0.6, sf, 0.05);
    // Junk riding on the rear fender: a jerry can (left), a toolbox (right).
    if (sx < 0) {
      plate(0.3, 0.42, 0.18, 0.03, primerMat, x, 1.27, -1.62, 0, Math.PI / 2, 0);
      box(0.08, 0.06, 0.14, ironMat, x, 1.51, -1.62, 0, 0, 0, bp, false);
      cyl(0.035, 0.035, 0.06, 8, brassMat, x + 0.06, 1.51, -1.52, 'y', bp, false);
    } else {
      plate(0.5, 0.24, 0.32, 0.025, hub, x, 1.18, -1.55, 0, 0.1, 0);
      box(0.32, 0.03, 0.04, ironMat, x, 1.32, -1.55, 0, 0.1, 0, bp, false);
      streak(x + 0.165, 1.25, -1.55, 'px', 0.06, 0.12);
    }
  }
  const cleats: Cleat[] = [];
  const cleatGeo = new THREE.BoxGeometry(0.68, 0.07, 0.14);
  const cleatSpan = TRACK_LEN - 0.9;
  for (const x of [-TRACK_X, TRACK_X]) {
    for (let i = 0; i < CLEATS_PER_RUN; i++) {
      for (const top of [true, false]) {
        const c = add(cleatGeo, ironMat, x, top ? TRACK_H : 0.04, 0, bp, false);
        c.position.z = cleatZ(i, top, 0, cleatSpan);
        cleats.push({ mesh: c, top, i });
      }
    }
  }

  /* ================================================================ HULL + SCRAP COWCATCHER ===================== */
  // Lower hull between the tracks; at the front the saws run through a dark slot under the deck plate.
  box(1.7, 0.2, 3.05, trim, 0, 0.88, -0.03);
  box(1.6, 0.16, 1.0, dark, 0, 1.05, 1.0);
  box(1.7, 0.3, 2.05, trim, 0, 1.13, -0.53);
  plate(1.72, 0.16, 1.0, 0.025, paint, 0, 1.2, 1.0); // front deck (top at 1.28)
  weld([-0.85, 1.285, 0.5], [0.85, 1.285, 0.5]);
  rivets([-0.8, 1.285, 0.58], [-0.8, 1.285, 1.44], 5, 'py');
  rivets([0.8, 1.285, 0.58], [0.8, 1.285, 1.44], 5, 'py');
  box(1.5, 0.1, 0.05, hazardMat, 0, 1.2, 1.515, 0, 0, 0, bp, false);
  chip(0.55, 1.165, 1.506, 'pz', 0.05);
  // Lower nose plate and the hazard ram beam.
  plate(1.65, 0.22, 0.12, 0.03, ironMat, 0, 0.86, 1.56);
  // Cowcatcher: a V of scrap slats (mismatched bar stock) under an I-beam top rail.
  const slatMats = [rustMat, steelMat, ironMat, primerMat, rustMat, ironMat];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(0, 0, 2.28);
    arm.rotation.y = sx * 0.6;
    bp.add(arm);
    // Local x * sx runs from the tip back to the hull corner; local +z faces out of the V.
    box(0.98, 0.1, 0.07, hazardMat, 0.49 * sx, 0.9, 0, 0, 0, 0, arm);
    box(0.98, 0.04, 0.16, ironMat, 0.49 * sx, 0.97, -0.04, 0, 0, 0, arm);
    box(0.98, 0.06, 0.1, ironMat, 0.49 * sx, 0.14, 0.18, 0, 0, 0, arm);
    for (let i = 0; i < 6; i++) {
      const lx = (0.08 + i * 0.165) * sx;
      box(0.07, 0.86, 0.06, slatMats[(i + (sx > 0 ? 2 : 0)) % slatMats.length], lx, 0.52, 0.09, -0.22, 0, (rnd() - 0.5) * 0.08, arm);
    }
    // A welded patch plate on one side.
    if (sx > 0) {
      plate(0.32, 0.28, 0.04, 0.01, steelMat, 0.5, 0.55, 0.15, -0.22, 0, 0.12, arm);
      weld([0.34, 0.42, 0.15], [0.66, 0.45, 0.17], arm);
    }
  }
  box(0.14, 0.86, 0.14, ironMat, 0, 0.52, 2.32, -0.22, Math.PI / 4, 0);
  // Tow hooks either side of the nose.
  for (const sx of [-1, 1]) {
    const hk = add(new THREE.TorusGeometry(0.07, 0.025, 5, 10, Math.PI * 1.4), ironMat, sx * 0.55, 0.7, 1.64, bp, false);
    hk.rotation.y = Math.PI / 2;
  }

  /* ================================================================ TORSO ======================================= */
  // Waist turret ring with a bolt circle.
  cyl(0.85, 0.95, 0.25, 18, dark, 0, 1.38, -0.15);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    cyl(0.035, 0.035, 0.04, 6, steelMat, Math.cos(a) * 0.86, 1.52, -0.15 + Math.sin(a) * 0.86, 'y', bp, false);
  }
  // Core block (top at 2.62) and the roof plate the decals sit on (top 2.66).
  box(1.8, 1.12, 1.3, dark, 0, 2.06, -0.2);
  plate(1.86, 0.06, 1.36, 0.02, paint, 0, 2.63, -0.2);
  rivets([-0.86, 2.665, -0.82], [-0.86, 2.665, 0.42], 6, 'py');
  rivets([0.86, 2.665, -0.82], [0.86, 2.665, 0.42], 6, 'py');
  // Grab rail along the back edge of the roof.
  rod([-0.6, 2.66, -0.86], [-0.6, 2.8, -0.86], 0.025, ironMat);
  rod([0.3, 2.66, -0.86], [0.3, 2.8, -0.86], 0.025, ironMat);
  rod([-0.6, 2.8, -0.86], [0.3, 2.8, -0.86], 0.025, ironMat);
  // Side armour: an upper plate in body paint, a lower plate that doesn't match (trim / olive primer), welded.
  for (const sx of [-1, 1]) {
    const x = sx * 0.93;
    const sf: Face = sx > 0 ? 'px' : 'nx';
    plate(0.06, 0.62, 1.3, 0.02, paint, x, 2.28, -0.22, 0, 0, sx * 0.04);
    plate(0.05, 0.5, 1.2, 0.015, sx < 0 ? primerMat : trim, x - sx * 0.005, 1.78, -0.18, 0.02, 0, -sx * 0.02);
    weld([x + sx * 0.03, 2.0, -0.85], [x + sx * 0.03, 1.99, 0.42]);
    rivets([x + sx * 0.04, 2.5, -0.8], [x + sx * 0.04, 2.5, 0.36], 6, sf);
    for (const z of [-0.6, -0.1, 0.25]) streak(x + sx * 0.035, 2.48, z + rnd() * 0.08, sf, 0.07, 0.3);
    chip(x + sx * 0.035, 2.2, -0.45, sf, 0.08);
  }
  // Chest: a sloped glacis plate in body paint, hazard band and a welded-on scrap patch below the head.
  // (Details are parented to the plate, in its own frame: front face at local z = 0.06.)
  const chest = plate(1.6, 0.6, 0.12, 0.03, paint, 0, 1.8, 0.5, -0.32);
  box(1.5, 0.12, 0.03, hazardMat, 0, -0.2, 0.07, 0, 0, 0, chest, false);
  plate(0.42, 0.3, 0.04, 0.01, rustMat, 0.42, 0.04, 0.08, 0, 0, 0.1, chest);
  weld([0.2, -0.12, 0.09], [0.62, -0.08, 0.09], chest);
  rivets([-0.7, 0.24, 0.07], [0.7, 0.24, 0.07], 8, 'pz', chest);
  streak(-0.35, 0.2, 0.062, 'pz', 0.07, 0.28, chest);
  chip(-0.55, 0.0, 0.062, 'pz', 0.06, chest);

  /* ---- Head: low and forward between the shoulders, brow plate over a cracked viewport slit, caged work light. ---- */
  box(0.9, 0.5, 0.68, dark, 0, 2.27, 0.68);
  plate(0.98, 0.065, 0.74, 0.015, paint, 0, 2.5525, 0.69); // head roof (top 2.585)
  plate(1.0, 0.22, 0.1, 0.025, paint, 0, 2.44, 1.04, 0.22); // brow
  plate(0.96, 0.24, 0.1, 0.025, trim, 0, 2.12, 1.03, -0.28); // jaw
  box(0.74, 0.12, 0.04, visorMat, 0, 2.29, 1.012, 0, 0, 0, bp, false); // viewport glow
  // Cracks spidering out of an impact point on the right of the slit.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    const l = 0.05 + rnd() * 0.08;
    box(l, 0.008, 0.01, crackMat, 0.2 + Math.cos(a) * l * 0.5, 2.29 + Math.sin(a) * l * 0.25, 1.036, 0, 0, a, bp, false);
  }
  for (const x of [-0.24, 0, 0.24]) box(0.03, 0.17, 0.03, ironMat, x, 2.29, 1.045, 0, 0, 0, bp, false); // slit bars
  for (const sx of [-1, 1]) {
    rivet(sx * 0.44, 2.44, 1.1, 'pz');
    rivet(sx * 0.42, 2.13, 1.08, 'pz');
    // Cheek plates.
    plate(0.06, 0.42, 0.5, 0.015, sx < 0 ? trim : paint, sx * 0.47, 2.29, 0.82, 0, 0, 0);
  }
  streak(-0.3, 2.06, 1.06, 'pz', 0.05, 0.16);
  // Caged work light on the head roof (left), its glow from Plow's beacon light.
  box(0.16, 0.08, 0.14, ironMat, -0.34, 2.62, 0.82, 0, 0, 0, bp, false);
  cyl(0.11, 0.12, 0.16, 12, ironMat, -0.34, 2.74, 0.88, 'z');
  cyl(0.095, 0.095, 0.02, 12, head, -0.34, 2.74, 0.965, 'z', bp, false);
  add(new THREE.TorusGeometry(0.115, 0.012, 4, 14), ironMat, -0.34, 2.74, 1.0, bp, false);
  for (const [dx, dy] of [[0, 0.115], [0.115, 0], [-0.115, 0], [0, -0.115]] as const) rod([-0.34 + dx, 2.74 + dy, 0.9], [-0.34 + dx, 2.74 + dy, 1.0], 0.01, ironMat);
  rod([-0.42, 2.74, 1.0], [-0.26, 2.74, 1.0], 0.01, ironMat);
  rod([-0.34, 2.66, 1.0], [-0.34, 2.82, 1.0], 0.01, ironMat);

  /* ---- Engine pack behind the torso: louvres, radiator, filler cap, mismatched exhausts. ---- */
  box(1.6, 0.9, 0.74, paint, 0, 2.0, -1.24);
  box(1.64, 0.08, 0.78, hazardMat, 0, 2.43, -1.24); // hazard-striped engine lid lip
  for (let i = 0; i < 5; i++) box(1.3, 0.04, 0.08, dark, 0, 2.48, -0.96 - i * 0.12, 0, 0, 0, bp, false); // top slats
  cyl(0.06, 0.06, 0.06, 8, brassMat, -0.55, 2.5, -1.5, 'y', bp, false); // filler cap
  for (const sx of [-1, 1]) {
    const sf: Face = sx > 0 ? 'px' : 'nx';
    for (let i = 0; i < 4; i++) box(0.04, 0.05, 0.6, dark, sx * 0.81, 1.68 + i * 0.09, -1.24, 0, 0, 0, bp, false);
    rivets([sx * 0.805, 2.4, -1.55], [sx * 0.805, 2.4, -0.93], 4, sf);
  }
  // Radiator face on the back (above the counterweight).
  box(1.3, 0.42, 0.04, ironMat, 0, 2.2, -1.62);
  for (let i = 0; i < 9; i++) box(0.04, 0.36, 0.03, dark, -0.56 + i * 0.14, 2.2, -1.645, 0, 0, 0, bp, false);
  // Right stack: straight chrome pipe in a slotted heat shield, tip at Plow.exhaustTip (0.55, 3.1, -1.45).
  cyl(0.1, 0.11, 0.62, 10, chrome, 0.55, 2.76, -1.45);
  cyl(0.135, 0.135, 0.36, 10, ironMat, 0.55, 2.66, -1.45);
  for (let i = 0; i < 3; i++) box(0.02, 0.06, 0.02, dark, 0.55, 2.56 + i * 0.1, -1.587, 0, 0, 0, bp, false);
  cyl(0.12, 0.12, 0.04, 10, dark, 0.55, 3.06, -1.45, 'y', bp, false);
  // Left stack: a rusty pipe bent out of the engine side, clamped, with a slash-cut tip.
  rod([-0.78, 2.1, -1.36], [-0.95, 2.1, -1.36], 0.08, rustMat, bp, 8, true);
  add(new THREE.SphereGeometry(0.085, 8, 6), rustMat, -0.98, 2.1, -1.36, bp, false);
  rod([-0.98, 2.1, -1.36], [-0.98, 2.92, -1.36], 0.08, rustMat, bp, 8, true);
  const cut = cyl(0.083, 0.083, 0.14, 8, rustMat, -0.98, 2.98, -1.36, 'y', bp, false);
  cut.rotation.x = 0.35;
  for (const y of [2.35, 2.7]) cyl(0.095, 0.095, 0.04, 8, ironMat, -0.98, y, -1.36, 'y', bp, false);
  rod([-0.98, 2.35, -1.36], [-0.8, 2.35, -1.36], 0.02, ironMat);
  streak(-0.9, 2.08, -1.3, 'pz', 0.05, 0.12);

  /* ---- Counterweight (decal face at z = -1.95), tail lights, lifting eyes with chains, bumper + ripper. ---- */
  // Stacked scrap slabs: iron base, a bare-steel middle, a rusted top slab.
  box(1.84, 0.18, 0.33, ironMat, 0, 1.04, -1.785);
  box(1.84, 0.66, 0.33, steelMat, 0, 1.46, -1.785);
  box(1.84, 0.16, 0.33, rustMat, 0, 1.87, -1.785);
  for (const y of [1.13, 1.79]) box(1.88, 0.04, 0.28, dark, 0, y, -1.785, 0, 0, 0, bp, false); // slab grooves
  box(1.84, 0.14, 0.04, hazardMat, 0, 1.03, -1.965);
  rivets([-0.88, 1.2, -1.955], [-0.88, 1.92, -1.955], 4, 'nz');
  rivets([0.88, 1.2, -1.955], [0.88, 1.92, -1.955], 4, 'nz');
  for (const x of [-0.6, 0.15, 0.62]) streak(x, 1.93, -1.953, 'nz', 0.07, 0.3);
  for (const sx of [-1, 1]) {
    box(0.16, 0.1, 0.05, tailMat, sx * 0.72, 1.2, -1.97, 0, 0, 0, bp, false);
    box(0.2, 0.14, 0.03, ironMat, sx * 0.72, 1.2, -1.955, 0, 0, 0, bp, false);
    const eye = add(new THREE.TorusGeometry(0.07, 0.022, 5, 10), ironMat, sx * 0.78, 2.02, -1.78, bp, false);
    eye.rotation.y = Math.PI / 2;
    chain([[sx * 0.78, 1.98, -1.85], [sx * 0.9, 1.9, -1.97], [sx * 0.96, 1.55, -1.99], [sx * 0.97, 1.25, -1.98]]);
  }
  const bumperTex = hazardTexture();
  bumperTex.repeat.set(6, 1);
  box(2.4, 0.3, 0.2, new THREE.MeshStandardMaterial({ map: bumperTex, roughness: 0.6 }), 0, 0.75, -2.05);
  box(2.44, 0.06, 0.24, ironMat, 0, 0.92, -2.05);
  box(0.16, 0.8, 0.22, ironMat, 0, 0.6, -2.35).rotation.x = -0.35;
  box(0.2, 0.18, 0.26, steelMat, 0, 0.24, -2.48, -0.35, 0, 0, bp, false); // worn tooth tip

  /* ================================================================ ARMS ======================================== */
  const arms: MechArm[] = [];
  const restZ = 0.25;
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * SHOULDER[0], SHOULDER[1], SHOULDER[2]);
    bp.add(shoulder);
    const of: Face = sx > 0 ? 'px' : 'nx';
    // Shoulder hub: a fat iron drum with a bolt circle and a yellow cap.
    cyl(0.3, 0.3, 0.42, 14, ironMat, 0, 0, 0, 'x', shoulder);
    cyl(0.13, 0.13, 0.46, 10, hub, 0, 0, 0, 'x', shoulder, false);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      rivet(sx * 0.215, Math.sin(a) * 0.22, Math.cos(a) * 0.22, of, shoulder);
    }
    // Pauldron: a heavy bent plate in body paint over a mismatched under-plate, hazard edge, rivets, rust.
    plate(0.86, 0.16, 1.04, 0.035, paint, sx * 0.1, 0.36, 0, 0, 0, sx * -0.22, shoulder);
    plate(0.14, 0.52, 1.0, 0.03, paint, sx * 0.5, 0.12, 0, 0, 0, sx * -0.08, shoulder);
    plate(0.6, 0.1, 0.7, 0.02, sx < 0 ? primerMat : steelMat, sx * 0.08, 0.47, -0.06, 0.05, 0, sx * -0.18, shoulder);
    box(0.05, 0.14, 1.02, hazardMat, sx * 0.575, -0.06, 0, 0, 0, sx * -0.08, shoulder, false);
    rivets([sx * 0.59, 0.3, -0.42], [sx * 0.59, 0.3, 0.42], 5, of, shoulder);
    rivets([sx * 0.1, 0.46, 0.52], [sx * 0.42, 0.39, 0.52], 3, 'pz', shoulder);
    weld([sx * -0.18, 0.5, -0.4], [sx * -0.18, 0.5, 0.35], shoulder);
    streak(sx * 0.588, 0.27, -0.25, of, 0.06, 0.24, shoulder);
    streak(sx * 0.588, 0.27, 0.18, of, 0.05, 0.2, shoulder);
    chip(sx * 0.573, 0.12, 0.05, of, 0.07, shoulder);
    // Upper arm: twin iron straps around a core, with a hydraulic lift ram up the front.
    box(0.3, 0.6, 0.26, dark, sx * 0.04, -0.45, 0, 0, 0, 0, shoulder);
    for (const dx of [-0.17, 0.17]) plate(0.07, 0.8, 0.34, 0.015, ironMat, sx * 0.04 + dx, -0.45, 0, 0, 0, 0, shoulder);
    cyl(0.075, 0.075, 0.42, 10, dark, sx * 0.04, -0.3, 0.26, 'y', shoulder);
    cyl(0.04, 0.04, 0.34, 8, chrome, sx * 0.04, -0.62, 0.26, 'y', shoulder, false);
    box(0.12, 0.08, 0.12, ironMat, sx * 0.04, -0.06, 0.24, 0, 0, 0, shoulder, false);
    // Elbow sleeve: the long housing the forearm piston slides out of (z -1.0 .. 0.35), collar, rear cap.
    const ey = ELBOW_Y;
    const ex = sx * 0.05;
    plate(0.58, 0.56, 1.35, 0.05, trim, ex, ey, -0.325, 0, 0, 0, shoulder);
    plate(0.66, 0.64, 0.14, 0.03, ironMat, ex, ey, 0.3, 0, 0, 0, shoulder);
    plate(0.5, 0.48, 0.08, 0.02, ironMat, ex, ey, -1.02, 0, 0, 0, shoulder);
    box(0.62, 0.6, 0.12, hazardMat, ex, ey, 0.17, 0, 0, 0, shoulder, false);
    plate(0.04, 0.34, 0.5, 0.01, sx < 0 ? rustMat : primerMat, ex + sx * 0.3, ey - 0.02, -0.55, 0, 0, 0, shoulder);
    weld([ex + sx * 0.32, ey + 0.15, -0.8], [ex + sx * 0.32, ey + 0.15, -0.3], shoulder);
    rivets([ex + sx * 0.295, ey - 0.22, -0.95], [ex + sx * 0.295, ey - 0.22, 0.2], 6, of, shoulder);
    rivets([ex - sx * 0.2, ey + 0.285, -0.95], [ex - sx * 0.2, ey + 0.285, -0.1], 4, 'py', shoulder);
    streak(ex + sx * 0.296, ey + 0.25, 0.0, of, 0.06, 0.3, shoulder);
    // Punch-ram barrels (fixed here; their rods ride on the forearm): one on top, one on the outside.
    const topRam: V3 = [ex - sx * 0.08, ey + 0.38, 0];
    const sideRam: V3 = [ex + sx * 0.4, ey + 0.05, 0];
    for (const [rx, ry] of [topRam, sideRam]) {
      cyl(0.085, 0.085, 1.3, 10, dark, rx, ry, -0.5, 'z', shoulder);
      cyl(0.1, 0.1, 0.06, 10, ironMat, rx, ry, 0.14, 'z', shoulder, false);
      cyl(0.1, 0.1, 0.06, 10, ironMat, rx, ry, -1.12, 'z', shoulder, false);
      fitting(rx, ry + 0.09, -1.0, 'y', shoulder);
    }
    box(0.08, 0.32, 0.08, ironMat, ex - sx * 0.08, ey + 0.32, -0.75, 0, 0, 0, shoulder, false); // barrel saddle
    box(0.08, 0.32, 0.08, ironMat, ex - sx * 0.08, ey + 0.32, 0.05, 0, 0, 0, shoulder, false);
    // Hoses from the shoulder hub down to the barrels and to the lift ram.
    hose([[sx * -0.1, -0.1, -0.28], [sx * -0.1, -0.35, -0.6], [topRam[0], topRam[1] + 0.12, -0.85], [topRam[0], topRam[1] + 0.09, -1.0]], 0.035, shoulder);
    hose([[sx * 0.2, -0.15, -0.26], [sx * 0.36, -0.45, -0.55], [sideRam[0], sideRam[1] + 0.12, -0.95], [sideRam[0], sideRam[1] + 0.09, -1.0]], 0.035, shoulder);
    fitting(sideRam[0], sideRam[1] + 0.09, -1.0, 'y', shoulder);
    fitting(sx * -0.1, -0.1, -0.26, 'z', shoulder);
    fitting(sx * 0.2, -0.15, -0.24, 'z', shoulder);

    // Forearm: the chrome piston tube, wrist collar, ram rods, and the fist.
    const forearm = new THREE.Group();
    forearm.position.set(ex, ey, restZ);
    shoulder.add(forearm);
    cyl(0.19, 0.19, 1.75, 8, chrome, 0, 0, -0.325, 'z', forearm);
    for (const z of [0.1, 0.32]) cyl(0.205, 0.205, 0.04, 8, dark, 0, 0, z, 'z', forearm, false); // wear rings
    plate(0.6, 0.58, 0.18, 0.04, ironMat, 0, 0, 0.62, 0, 0, 0, forearm);
    // Rods (fixed to the wrist; long enough to stay in their barrels at full reach).
    for (const [rx, ry] of [topRam, sideRam]) {
      const lx = rx - ex;
      const ly = ry - ey;
      cyl(0.045, 0.045, 1.9, 8, chrome, lx, ly, -0.43, 'z', forearm, false);
      box(0.1, 0.1, 0.12, ironMat, lx, ly, 0.52, 0, 0, 0, forearm, false);
      rod([lx, ly, 0.56], [lx * 0.4, ly * 0.4, 0.56], 0.04, ironMat, forearm);
    }
    // Fist: cuff band, a heavy scuffed block, armour knuckle plate, four knuckles with studs, folded fingers, thumb.
    box(0.68, 0.62, 0.08, hazardMat, 0, 0, 0.75, 0, 0, 0, forearm, false);
    plate(0.78, 0.64, 0.56, 0.06, fistMat, 0, 0, 1.06, 0, 0, 0, forearm);
    plate(0.84, 0.13, 0.52, 0.03, trim, 0, 0.32, 1.08, -0.06, 0, 0, forearm);
    rivets([-0.34, 0.39, 0.9], [0.34, 0.39, 0.9], 4, 'py', forearm);
    for (let k = 0; k < 4; k++) {
      const kx = -0.28 + k * 0.187;
      plate(0.17, 0.22, 0.16, 0.03, ironMat, kx, 0.13, 1.37, 0, 0, 0, forearm);
      cyl(0.045, 0.06, 0.07, 6, steelMat, kx, 0.13, 1.47, 'z', forearm, false);
      plate(0.16, 0.18, 0.12, 0.025, fistMat, kx, -0.1, 1.36, 0.2, 0, 0, forearm);
    }
    plate(0.13, 0.2, 0.34, 0.03, ironMat, -sx * 0.42, -0.06, 1.12, 0, 0, 0, forearm); // thumb
    plate(0.04, 0.4, 0.34, 0.01, sx < 0 ? rustMat : steelMat, sx * 0.4, -0.02, 1.0, 0, 0, 0, forearm); // welded side patch
    weld([sx * 0.42, 0.18, 0.84], [sx * 0.42, 0.18, 1.16], forearm);
    weld([-0.34, -0.3, 0.79], [0.34, -0.3, 0.79], forearm);
    chip(0.1, 0.33, 0.8, 'pz', 0.05, forearm);
    mergeStatic(forearm);
    mergeStatic(shoulder, { keep: [forearm] });
    arms.push({ shoulder, forearm, restZ });
  }

  /* ================================================================ BUZZSAWS ==================================== */
  // Bolted flat to the front corners of the hull (left one mirrored so its arm points inward). Each gets a guard
  // over its rear / outer rim, an outboard drive motor + belt case to the hub, and a bracket back to the hull.
  const saws: Buzzsaw[] = [];
  const guardGeo = sector(0.98, 1.24, -1.85, 0.15, 0.04);
  const lipGeo = sector(1.2, 1.25, -1.5, 0.15, 0.16);
  for (const sx of [-1, 1]) {
    const saw = buildBuzzsaw();
    saw.group.position.set(sx * SAW_POS[0], SAW_POS[1], SAW_POS[2]);
    saw.group.scale.set(sx < 0 ? -1 : 1, 1, 1);
    saw.halo.visible = false;
    bp.add(saw.group);
    saws.push(saw);
    // Static corner kit, built for the right side and mirrored (mergeStatic bakes the mirror + fixes winding).
    const k = new THREE.Group();
    k.position.set(sx * SAW_POS[0], SAW_POS[1], SAW_POS[2]);
    k.scale.x = sx;
    bp.add(k);
    add(guardGeo, paint, 0, 0.08, 0, k);
    add(lipGeo, trim, 0, -0.06, 0, k);
    for (let i = 0; i < 6; i++) {
      const a = -1.75 + i * 0.36;
      rivet(Math.cos(a) * 1.11, 0.125, Math.sin(a) * 1.11, 'py', k);
    }
    box(0.3, 0.05, 0.2, hazardMat, Math.cos(0.05) * 1.11, 0.125, Math.sin(0.05) * 1.11, 0, -0.05, 0, k, false);
    streak(Math.cos(-0.6) * 1.255, 0.09, Math.sin(-0.6) * 1.255, 'px', 0.06, 0.16, k).rotation.y = Math.PI / 2 + 0.6;
    // Drive: finned motor lying fore-aft on the guard, gearbox, belt case running in to the saw hub.
    cyl(0.16, 0.16, 0.5, 12, trim, 0.72, 0.3, -0.8, 'z', k);
    for (let i = 0; i < 4; i++) cyl(0.185, 0.185, 0.025, 12, ironMat, 0.72, 0.3, -0.98 + i * 0.1, 'z', k, false);
    cyl(0.09, 0.09, 0.04, 10, hub, 0.72, 0.3, -1.07, 'z', k, false);
    box(0.24, 0.1, 0.44, ironMat, 0.72, 0.17, -0.8, 0, 0, 0, k, false); // motor saddle on the guard
    plate(0.32, 0.3, 0.26, 0.03, ironMat, 0.72, 0.28, -0.44, 0, 0, 0, k);
    const belt = box(0.18, 0.08, 0.84, dark, 0.36, 0.13, -0.22, 0, Math.atan2(0.72, -0.44), 0, k);
    belt.castShadow = false;
    hose([[0.56, 0.38, -0.85], [0.35, 0.45, -1.05], [-0.1, 0.3, -1.25], [-0.45, 0.25, -1.3]], 0.03, k);
    // Bracket back to the hull side.
    box(0.4, 0.12, 0.28, ironMat, -0.6, 0.1, -0.94, 0, 0.3, 0, k);
    weld([-0.8, 0.17, -1.05], [-0.42, 0.17, -0.8], k);
  }

  // Cleats -> one InstancedMesh (own copy of the iron material, so the merged iron parts never switch to the instanced
  // program and back every frame).
  const c0 = cleats[0].mesh;
  const cleatMesh = new THREE.InstancedMesh(c0.geometry, (c0.material as THREE.Material).clone(), cleats.length);
  cleatMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cleatMesh.frustumCulled = false;
  for (const c of cleats) c.mesh.removeFromParent();
  const moving = [...arms.map((a) => a.shoulder), ...saws.map((s) => s.group)];
  mergeStatic(bp, { keep: moving });
  bp.add(...makeShadowProxy(bp, bp, { keep: moving }));
  bp.add(cleatMesh);

  let sawAngle = 0;
  const pose = (dt: number, punchL: number, punchR: number, saw: number, twist: number) => {
    for (let i = 0; i < 2; i++) {
      const a = arms[i];
      const p = i === 0 ? punchL : punchR;
      a.forearm.position.z = a.restZ + p * PUNCH_REACH;
      // Wind back slightly, then the whole arm swings level with the punch.
      a.shoulder.rotation.x = -0.55 * p;
      a.forearm.rotation.x = 0.55 * p;
    }
    arms[0].shoulder.rotation.y = arms[1].shoulder.rotation.y = twist;
    sawAngle += dt * (SAW_IDLE + (SAW_FULL - SAW_IDLE) * saw);
    if (sawAngle > Math.PI * 2) sawAngle -= Math.PI * 2;
    for (let i = 0; i < 2; i++) {
      const s = saws[i];
      s.rotor.rotation.y = i === 0 ? -sawAngle : sawAngle;
      s.halo.visible = saw > 0.02;
      if (saw > 0.02) {
        s.halo.scale.setScalar(SAW_R * (1.3 + 1.6 * saw));
        s.halo.material.opacity = 0.4 + 0.6 * saw;
      }
    }
  };

  return { group: bp, parts: { cleats, cleatSpan, cleatMesh, pose } };
}
