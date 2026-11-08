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
const _up = new THREE.Vector3(0, 1, 0);

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

/** BRUTUS: the WRECKING MECH. A hunched tracked brawler built from a few big welded plates: open track units under
 *  long fenders, a slatted cowcatcher, a low head with a viewport slit and work light under the brow, an engine pack
 *  with one stack, a stacked counterweight, two piston fists whose hydraulic rams slide out with the punch, and a
 *  guarded, motor-driven buzzsaw bolted to each front corner. Palette: Paint Shop body / trim on the big plates, a
 *  light gunmetal frame, bare steel + rust on the counterweight / cowcatcher, hazard stripes only on the bumper,
 *  the deck lip and the fist cuffs. No blade. */
export function buildBruteVehicle({ mats, chassis }: VehicleBuildIn): VehicleBuild<BruteVehicleParts> {
  const bp = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = bp, shadow = true) =>
    addMesh(geo, mat, x, y, z, parent, shadow);

  /* ---- Materials: Paint Shop body / trim on the big plates; frame / steel / rust are the model's own. Kept fairly
   *  light so the mech still reads as shapes (not a dark block) from the chase camera. ---- */
  const hazardTex = hazardTexture();
  hazardTex.repeat.set(3, 1);
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.6, metalness: 0.25 });
  const trackMat = new THREE.MeshStandardMaterial({ color: 0x34363c, roughness: 0.95, flatShading: true });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x7b838d, roughness: 0.7, metalness: 0.2 });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x8a919a, roughness: 0.6, metalness: 0.25 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.5, metalness: 0.25, flatShading: true });
  const fistMat = new THREE.MeshStandardMaterial({ color: 0xc8cdd2, roughness: 0.35, metalness: 0.55, flatShading: true });
  const rustMat = new THREE.MeshStandardMaterial({ color: 0xa65c32, roughness: 0.85, metalness: 0.15, flatShading: true });
  const grooveMat = new THREE.MeshStandardMaterial({ color: 0x3b4048, roughness: 0.8, metalness: 0.2 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0xffc46a, emissive: 0xff8a1e, emissiveIntensity: 1.5, roughness: 0.3 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff3a24, emissive: 0xff1a0a, emissiveIntensity: 1.8, roughness: 0.3 });
  const { paint, trim, dark, chrome, hub, head } = mats;

  /* ---- Helpers (all static; merged per material at the end). ---- */
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
    // Drive sprocket (rear) with a yellow hub; plain front idler.
    cyl(0.33, 0.33, BELT_W - 0.06, 14, ironMat, x, LOOP_Y, SPROCKET_Z, 'x');
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      box(BELT_W - 0.1, 0.1, 0.09, ironMat, x, LOOP_Y + Math.sin(a) * 0.35, SPROCKET_Z + Math.cos(a) * 0.35, Math.PI / 2 - a, 0, 0, bp, false);
    }
    cyl(0.15, 0.15, 0.06, 10, hub, ox - sx * 0.02, LOOP_Y, SPROCKET_Z, 'x', bp, false);
    cyl(0.31, 0.31, BELT_W - 0.08, 14, ironMat, x, LOOP_Y, IDLER_Z, 'x');
    cyl(0.14, 0.14, BELT_W + 0.02, 10, steelMat, x, LOOP_Y, IDLER_Z, 'x', bp, false);
    // Road wheels: five twin-disc bogie wheels on a frame beam.
    box(0.12, 0.2, IDLER_Z - SPROCKET_Z - 0.4, frameMat, x, 0.42, 0.1, 0, 0, 0, bp, false);
    for (let i = 0; i < 5; i++) {
      const z = -0.9 + i * 0.5;
      for (const dx of [-0.17, 0.17]) cyl(0.2, 0.2, 0.13, 12, ironMat, x + dx, 0.335, z, 'x');
      cyl(0.09, 0.09, 0.05, 8, steelMat, ox - sx * 0.08, 0.335, z, 'x', bp, false);
    }
    // Track guard (fender): one long body-paint plate over the rear / middle of the track (top 1.06), bent iron
    // lip at the front. The front third of the track runs open under the buzzsaw.
    box(0.74, 0.08, 2.36, paint, x, 1.02, -0.73);
    box(0.74, 0.06, 0.2, ironMat, x, 0.98, 0.52, 0.5, 0, 0);
    // Side skirt: one body-paint plate hanging over the top run, split into three panels by grooves.
    const skx = x + sx * 0.38;
    box(0.05, 0.34, 2.2, paint, skx, 0.82, -0.7);
    for (const z of [-1.08, -0.32]) box(0.012, 0.34, 0.03, grooveMat, skx + sx * 0.026, 0.82, z, 0, 0, 0, bp, false);
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

  /* ================================================================ HULL + COWCATCHER =========================== */
  // Lower hull between the tracks; at the front the saws run through a dark slot under the deck plate.
  box(1.7, 0.2, 3.05, trim, 0, 0.88, -0.03);
  box(1.6, 0.16, 1.0, dark, 0, 1.05, 1.0);
  box(1.7, 0.3, 2.05, trim, 0, 1.13, -0.53);
  plate(1.72, 0.16, 1.0, 0.025, paint, 0, 1.2, 1.0); // front deck (top at 1.28)
  box(1.5, 0.1, 0.05, hazardMat, 0, 1.2, 1.515, 0, 0, 0, bp, false);
  plate(1.65, 0.22, 0.12, 0.03, ironMat, 0, 0.86, 1.56); // lower nose plate
  // Cowcatcher: a V of evenly spaced bare-steel slats between iron rails.
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(0, 0, 2.28);
    arm.rotation.y = sx * 0.6;
    bp.add(arm);
    // Local x * sx runs from the tip back to the hull corner; local +z faces out of the V.
    box(0.98, 0.12, 0.14, ironMat, 0.49 * sx, 0.93, -0.01, 0, 0, 0, arm);
    box(0.98, 0.08, 0.12, ironMat, 0.49 * sx, 0.14, 0.18, 0, 0, 0, arm);
    for (let i = 0; i < 5; i++) box(0.1, 0.84, 0.06, steelMat, (0.12 + i * 0.19) * sx, 0.52, 0.09, -0.22, 0, 0, arm);
  }
  box(0.14, 0.86, 0.14, ironMat, 0, 0.52, 2.32, -0.22, Math.PI / 4, 0);

  /* ================================================================ TORSO ======================================= */
  cyl(0.85, 0.95, 0.25, 18, frameMat, 0, 1.38, -0.15); // waist turret ring
  // Core block (top at 2.62) and the roof plate the decals sit on (top 2.66).
  box(1.8, 1.12, 1.3, frameMat, 0, 2.06, -0.2);
  plate(1.86, 0.06, 1.36, 0.02, paint, 0, 2.63, -0.2);
  // Side armour: upper plate in body paint over a trim lower plate, one clean seam between them.
  for (const sx of [-1, 1]) {
    const x = sx * 0.93;
    plate(0.06, 0.62, 1.3, 0.02, paint, x, 2.28, -0.22, 0, 0, sx * 0.04);
    plate(0.05, 0.5, 1.2, 0.015, trim, x - sx * 0.005, 1.78, -0.18);
  }
  // Chest: a sloped glacis plate in body paint.
  plate(1.6, 0.6, 0.12, 0.03, paint, 0, 1.8, 0.5, -0.32);

  /* ---- Head: low and forward between the shoulders, brow plate over the viewport slit, work light on the roof. ---- */
  box(0.9, 0.5, 0.68, frameMat, 0, 2.27, 0.68);
  plate(0.98, 0.065, 0.74, 0.015, paint, 0, 2.5525, 0.69); // head roof (top 2.585)
  plate(1.0, 0.22, 0.1, 0.025, paint, 0, 2.44, 1.04, 0.22); // brow
  plate(0.96, 0.24, 0.1, 0.025, trim, 0, 2.12, 1.03, -0.28); // jaw
  box(0.74, 0.12, 0.04, visorMat, 0, 2.29, 1.012, 0, 0, 0, bp, false); // viewport glow
  for (const x of [-0.19, 0.19]) box(0.04, 0.17, 0.03, frameMat, x, 2.29, 1.045, 0, 0, 0, bp, false); // slit bars
  for (const sx of [-1, 1]) plate(0.06, 0.42, 0.5, 0.015, paint, sx * 0.47, 2.29, 0.82); // cheek plates
  // Work light on the head roof (left), its glow from Plow's beacon light.
  box(0.16, 0.08, 0.14, ironMat, -0.34, 2.62, 0.82, 0, 0, 0, bp, false);
  cyl(0.11, 0.12, 0.16, 12, ironMat, -0.34, 2.74, 0.88, 'z');
  cyl(0.095, 0.095, 0.02, 12, head, -0.34, 2.74, 0.965, 'z', bp, false);

  /* ---- Engine pack behind the torso: lid slats, side louvres, radiator, one stack. ---- */
  box(1.6, 0.9, 0.74, paint, 0, 2.0, -1.24);
  box(1.64, 0.08, 0.78, trim, 0, 2.49, -1.24); // engine lid
  for (let i = 0; i < 3; i++) box(1.2, 0.03, 0.1, grooveMat, 0, 2.54, -1.04 - i * 0.2, 0, 0, 0, bp, false);
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) box(0.04, 0.05, 0.56, grooveMat, sx * 0.81, 1.7 + i * 0.1, -1.24, 0, 0, 0, bp, false);
  // Radiator face on the back (above the counterweight).
  box(1.3, 0.42, 0.04, ironMat, 0, 2.2, -1.62);
  for (let i = 0; i < 5; i++) box(0.05, 0.34, 0.03, grooveMat, -0.48 + i * 0.24, 2.2, -1.645, 0, 0, 0, bp, false);
  // Stack: chrome pipe in an iron heat shield, tip at Plow.exhaustTip (0.55, 3.1, -1.45).
  cyl(0.1, 0.11, 0.62, 10, chrome, 0.55, 2.76, -1.45);
  cyl(0.135, 0.135, 0.36, 10, ironMat, 0.55, 2.66, -1.45);
  cyl(0.12, 0.12, 0.04, 10, frameMat, 0.55, 3.06, -1.45, 'y', bp, false);

  /* ---- Counterweight (decal face at z = -1.95), tail lights, bumper + ripper. ---- */
  // Stacked slabs: iron base, a bare-steel middle (decal face), a rusted top slab.
  box(1.84, 0.18, 0.33, ironMat, 0, 1.04, -1.785);
  box(1.84, 0.66, 0.33, steelMat, 0, 1.46, -1.785);
  box(1.84, 0.16, 0.33, rustMat, 0, 1.87, -1.785);
  for (const sx of [-1, 1]) box(0.18, 0.1, 0.05, tailMat, sx * 0.72, 1.2, -1.97, 0, 0, 0, bp, false);
  const bumperTex = hazardTexture();
  bumperTex.repeat.set(6, 1);
  box(2.4, 0.3, 0.2, new THREE.MeshStandardMaterial({ map: bumperTex, roughness: 0.6 }), 0, 0.75, -2.05);
  box(2.44, 0.06, 0.24, ironMat, 0, 0.92, -2.05);
  box(0.16, 0.8, 0.22, ironMat, 0, 0.6, -2.35).rotation.x = -0.35;
  box(0.2, 0.18, 0.26, rustMat, 0, 0.24, -2.48, -0.35, 0, 0, bp, false); // worn tooth tip

  /* ================================================================ ARMS ======================================== */
  const arms: MechArm[] = [];
  const restZ = 0.25;
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * SHOULDER[0], SHOULDER[1], SHOULDER[2]);
    bp.add(shoulder);
    // Shoulder hub: a fat iron drum with a yellow cap.
    cyl(0.3, 0.3, 0.42, 14, ironMat, 0, 0, 0, 'x', shoulder);
    cyl(0.13, 0.13, 0.46, 10, hub, 0, 0, 0, 'x', shoulder, false);
    // Pauldron: one heavy bent plate in body paint with a trim edge band.
    plate(0.86, 0.16, 1.04, 0.035, paint, sx * 0.1, 0.36, 0, 0, 0, sx * -0.22, shoulder);
    plate(0.14, 0.52, 1.0, 0.03, paint, sx * 0.5, 0.12, 0, 0, 0, sx * -0.08, shoulder);
    box(0.05, 0.12, 1.02, trim, sx * 0.575, -0.08, 0, 0, 0, sx * -0.08, shoulder, false);
    // Upper arm: twin iron straps around a core, with a hydraulic lift ram up the front.
    box(0.3, 0.6, 0.26, frameMat, sx * 0.04, -0.45, 0, 0, 0, 0, shoulder);
    for (const dx of [-0.17, 0.17]) plate(0.07, 0.8, 0.34, 0.015, ironMat, sx * 0.04 + dx, -0.45, 0, 0, 0, 0, shoulder);
    cyl(0.075, 0.075, 0.42, 10, frameMat, sx * 0.04, -0.3, 0.26, 'y', shoulder);
    cyl(0.04, 0.04, 0.34, 8, chrome, sx * 0.04, -0.62, 0.26, 'y', shoulder, false);
    // Elbow sleeve: the long housing the forearm piston slides out of (z -1.0 .. 0.35), collar, rear cap.
    const ey = ELBOW_Y;
    const ex = sx * 0.05;
    plate(0.58, 0.56, 1.35, 0.05, trim, ex, ey, -0.325, 0, 0, 0, shoulder);
    plate(0.66, 0.64, 0.14, 0.03, ironMat, ex, ey, 0.3, 0, 0, 0, shoulder);
    plate(0.5, 0.48, 0.08, 0.02, ironMat, ex, ey, -1.02, 0, 0, 0, shoulder);
    // Punch-ram barrels (fixed here; their rods ride on the forearm): one on top, one on the outside.
    const topRam: V3 = [ex - sx * 0.08, ey + 0.38, 0];
    const sideRam: V3 = [ex + sx * 0.4, ey + 0.05, 0];
    for (const [rx, ry] of [topRam, sideRam]) {
      cyl(0.085, 0.085, 1.3, 10, frameMat, rx, ry, -0.5, 'z', shoulder);
      cyl(0.1, 0.1, 0.06, 10, ironMat, rx, ry, 0.14, 'z', shoulder, false);
      cyl(0.1, 0.1, 0.06, 10, ironMat, rx, ry, -1.12, 'z', shoulder, false);
    }

    // Forearm: the chrome piston tube, wear ring, wrist plate, ram rods, and the fist.
    const forearm = new THREE.Group();
    forearm.position.set(ex, ey, restZ);
    shoulder.add(forearm);
    cyl(0.19, 0.19, 1.75, 8, chrome, 0, 0, -0.325, 'z', forearm);
    cyl(0.205, 0.205, 0.05, 8, frameMat, 0, 0, 0.2, 'z', forearm, false);
    plate(0.6, 0.58, 0.18, 0.04, ironMat, 0, 0, 0.62, 0, 0, 0, forearm);
    // Rods (fixed to the wrist; long enough to stay in their barrels at full reach).
    for (const [rx, ry] of [topRam, sideRam]) {
      const lx = rx - ex;
      const ly = ry - ey;
      cyl(0.045, 0.045, 1.9, 8, chrome, lx, ly, -0.43, 'z', forearm, false);
      box(0.1, 0.1, 0.12, ironMat, lx, ly, 0.52, 0, 0, 0, forearm, false);
      rod([lx, ly, 0.56], [lx * 0.4, ly * 0.4, 0.56], 0.04, ironMat, forearm);
    }
    // Fist: hazard cuff band, a heavy steel block, trim knuckle plate, four knuckles, folded fingers, thumb.
    box(0.68, 0.62, 0.08, hazardMat, 0, 0, 0.75, 0, 0, 0, forearm, false);
    plate(0.78, 0.64, 0.56, 0.06, fistMat, 0, 0, 1.06, 0, 0, 0, forearm);
    plate(0.84, 0.13, 0.52, 0.03, trim, 0, 0.32, 1.08, -0.06, 0, 0, forearm);
    for (let k = 0; k < 4; k++) {
      const kx = -0.28 + k * 0.187;
      plate(0.17, 0.22, 0.16, 0.03, ironMat, kx, 0.13, 1.37, 0, 0, 0, forearm);
      plate(0.16, 0.18, 0.12, 0.025, fistMat, kx, -0.1, 1.36, 0.2, 0, 0, forearm);
    }
    plate(0.13, 0.2, 0.34, 0.03, ironMat, -sx * 0.42, -0.06, 1.12, 0, 0, 0, forearm); // thumb
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
    // Drive: motor lying fore-aft on the guard, gearbox, belt case running in to the saw hub.
    cyl(0.16, 0.16, 0.5, 12, trim, 0.72, 0.3, -0.8, 'z', k);
    for (let i = 0; i < 2; i++) cyl(0.185, 0.185, 0.04, 12, ironMat, 0.72, 0.3, -0.95 + i * 0.3, 'z', k, false);
    box(0.24, 0.1, 0.44, ironMat, 0.72, 0.17, -0.8, 0, 0, 0, k, false); // motor saddle on the guard
    plate(0.32, 0.3, 0.26, 0.03, ironMat, 0.72, 0.28, -0.44, 0, 0, 0, k);
    const belt = box(0.18, 0.08, 0.84, frameMat, 0.36, 0.13, -0.22, 0, Math.atan2(0.72, -0.44), 0, k);
    belt.castShadow = false;
    box(0.4, 0.12, 0.28, ironMat, -0.6, 0.1, -0.94, 0, 0.3, 0, k); // bracket back to the hull side
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
