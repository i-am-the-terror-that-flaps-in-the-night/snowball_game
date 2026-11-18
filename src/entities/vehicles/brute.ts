import * as THREE from 'three';
import { CLEATS_PER_RUN, SAW_R, buildBuzzsaw, cleatZ, hazardTexture, type Buzzsaw, type Cleat } from '../plowModels';
import { mergeStatic } from '../../render/mergeStatic';
import { makeShadowProxy } from '../../render/shadowProxy';
import { addMesh, boltRow, kitBox, type VehicleBuild, type VehicleBuildIn } from './types';
import { arcPts, beltLoop, rblock, roundEnd, roundLoft, roundProfile, sweep, turned, turnedX } from './vehicleShapes';

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

/** Art-pass kit bevel on a plain box part: plain-coloured (untextured, unlit) parts big enough to show it. */
function bevelled(w: number, h: number, d: number, mat: THREE.Material): boolean {
  const m = mat as THREE.MeshStandardMaterial;
  if (m.map || (m.emissiveIntensity > 0 && m.emissive.getHex() !== 0)) return false;
  return Math.max(w, h, d) >= 0.25 && Math.min(w, h, d) >= 0.04;
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
 *  light gunmetal frame, bare steel on the counterweight / cowcatcher, one accent colour (Paint Shop accent) on the
 *  brow, pauldron edge bands, saw guards and hubs, plain steel saw blades, hazard stripes only on the bumper and
 *  the fist cuffs. No blade.
 *
 *  Reshape (art pass): the primary forms are curved solids (vehicleShapes.ts): open belt loops, fenders curling over
 *  the sprockets, a barrel-chested core with a curved breastplate, a moulded head under a peaked helm, domed shoulder
 *  blocks, round elbow sleeves and fists, a moulded engine pack; they merge into the same per-material draws. */
export function buildBruteVehicle({ mats, chassis }: VehicleBuildIn): VehicleBuild<BruteVehicleParts> {
  const bp = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = bp, shadow = true) =>
    addMesh(geo, mat, x, y, z, parent, shadow);

  /* ---- Materials: Paint Shop body / trim on the big plates; frame / steel are the model's own. Kept fairly
   *  light so the mech still reads as shapes (not a dark block) from the chase camera. ---- */
  const hazardTex = hazardTexture();
  hazardTex.repeat.set(3, 1);
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.6, metalness: 0.25 });
  const trackMat = new THREE.MeshStandardMaterial({ color: 0x34363c, roughness: 0.95 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x7b838d, roughness: 0.7, metalness: 0.2 });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x8a919a, roughness: 0.6, metalness: 0.25 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.5, metalness: 0.25 });
  const fistMat = new THREE.MeshStandardMaterial({ color: 0xc8cdd2, roughness: 0.35, metalness: 0.55 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0xffc46a, emissive: 0xff8a1e, emissiveIntensity: 1.5, roughness: 0.3 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff3a24, emissive: 0xff1a0a, emissiveIntensity: 1.8, roughness: 0.3 });
  const { paint, trim, dark, chrome, hub, head } = mats;
  /** The one accent colour (Paint Shop accent, factory industrial orange): the shared hub material, so the brow,
   *  pauldron edge bands, saw guards and saw / sprocket / shoulder hubs all follow the equipped paint. */
  const accent = hub;

  /* ---- Helpers (all static; merged per material at the end). ---- */
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent: THREE.Object3D = bp, shadow = true) => {
    const m = add(bevelled(w, h, d, mat) ? kitBox(w, h, d) : new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent, shadow);
    m.rotation.set(rx, ry, rz);
    return m;
  };
  const plate = (w: number, h: number, d: number, c: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent: THREE.Object3D = bp, shadow = true) => {
    const m = add(kitBox(w, h, d, c), mat, x, y, z, parent, shadow);
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
  /** A carrier group posed like a plate (position + Euler), for bolts laid out in the plate's own frame. */
  const frameAt = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent: THREE.Object3D = bp) => {
    const f = new THREE.Group();
    f.position.set(x, y, z);
    f.rotation.set(rx, ry, rz);
    parent.add(f);
    return f;
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
  // (Reshape: one open belt loop with round side edges; round-edged fenders that curl down over the sprocket.)
  const beltGeo = beltLoop('bruteBelt', SPROCKET_Z, IDLER_Z, LOOP_Y, LOOP_R, LOOP_R - LOOP_IN, BELT_W, 0.035, 10);
  for (const sx of [-1, 1]) {
    const x = sx * TRACK_X;
    const ox = x + sx * 0.33; // outer face
    // Belt: one loop round the drive sprocket and the idler.
    add(beltGeo, trackMat, x, 0, 0);
    // Drive sprocket (rear) with an accent hub; plain front idler.
    add(turnedX('bruteSprocket', [[0, -0.28], [0.22, -0.28], [0.3, -0.27], [0.33, -0.24], [0.33, 0.24], [0.3, 0.27], [0.22, 0.28], [0, 0.28]], 16), ironMat, x, LOOP_Y, SPROCKET_Z);
    cyl(0.15, 0.15, 0.06, 10, hub, ox - sx * 0.02, LOOP_Y, SPROCKET_Z, 'x', bp, false);
    add(turnedX('bruteIdler', [[0, -0.27], [0.22, -0.27], [0.29, -0.26], [0.31, -0.23], [0.31, 0.23], [0.29, 0.26], [0.22, 0.27], [0, 0.27]], 16), ironMat, x, LOOP_Y, IDLER_Z);
    cyl(0.14, 0.14, BELT_W + 0.02, 10, steelMat, x, LOOP_Y, IDLER_Z, 'x', bp, false);
    // Road wheels: five twin-disc bogie wheels on a frame beam (mostly hidden by the skirt).
    box(0.12, 0.2, IDLER_Z - SPROCKET_Z - 0.4, frameMat, x, 0.42, 0.1, 0, 0, 0, bp, false);
    for (let i = 0; i < 5; i++) {
      const z = -0.9 + i * 0.5;
      for (const dx of [-0.17, 0.17]) cyl(0.2, 0.2, 0.13, 12, ironMat, x + dx, 0.335, z, 'x');
    }
    // Track guard (fender): one long body-paint plate over the rear / middle of the track (top 1.06), bent iron
    // lip at the front. The front third of the track runs open under the buzzsaw.
    add(roundProfile('bruteFender', [
      [0.42, 0.98], [0.42, 1.06], [-1.38, 1.06], ...arcPts(SPROCKET_Z, LOOP_Y, 0.6, 92, 150, 6), ...arcPts(SPROCKET_Z, LOOP_Y, 0.52, 150, 92, 6), [-1.38, 0.98],
    ], 0.74, 0.03, 3, 6), paint, x, 0, 0);
    box(0.74, 0.06, 0.2, ironMat, x, 0.98, 0.52, 0.5, 0, 0);
    // Side skirt: one plain body-paint plate hanging over the top run (its rear corner rounded off over the
    // sprocket), a trim wear plate lapped over its rear end, and bolt rows along the fender's outer edge and the wear
    // plate.
    add(roundProfile('bruteSkirt', [
      [0.4, 0.65], [0.4, 0.99], [-1.6, 0.99], { p: [-1.8, 0.82], q: [-1.8, 0.99] }, [-1.8, 0.78], { p: [-1.62, 0.65], q: [-1.8, 0.65] },
    ], 0.05, 0.02, 2, 6), paint, x + sx * 0.38, 0, 0);
    add(rblock(0.05, 0.28, 0.85, 0.02), trim, x + sx * 0.415, 0.8, -1.38);
    boltRow(bp, ironMat, [x + sx * 0.335, 1.065, -1.75], [x + sx * 0.335, 1.065, 0.3], 8, [0, 0, 0], 0.03);
    boltRow(bp, ironMat, [x + sx * 0.442, 0.89, -1.7], [x + sx * 0.442, 0.89, -1.06], 4, [0, 0, -sx * Math.PI / 2], 0.026);
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
  add(roundProfile('bruteDeck', [[0.5, 1.12], [1.42, 1.12], { p: [1.52, 1.21], q: [1.52, 1.12] }, { p: [1.42, 1.28], q: [1.52, 1.28] }, [0.5, 1.28]], 1.72, 0.06, 3, 5), paint, 0, 0, 0); // front deck (top at 1.28)
  add(rblock(1.65, 0.22, 0.12, 0.05), ironMat, 0, 0.86, 1.56); // lower nose plate
  // Cowcatcher: a V of three bare-steel slats between iron rails.
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(0, 0, 2.28);
    arm.rotation.y = sx * 0.6;
    bp.add(arm);
    // Local x * sx runs from the tip back to the hull corner; local +z faces out of the V.
    box(0.98, 0.12, 0.14, ironMat, 0.49 * sx, 0.93, -0.01, 0, 0, 0, arm);
    box(0.98, 0.08, 0.12, ironMat, 0.49 * sx, 0.14, 0.18, 0, 0, 0, arm);
    for (let i = 0; i < 3; i++) box(0.12, 0.84, 0.06, steelMat, (0.18 + i * 0.3) * sx, 0.52, 0.09, -0.22, 0, 0, arm);
  }
  box(0.14, 0.86, 0.14, ironMat, 0, 0.52, 2.32, -0.22, Math.PI / 4, 0);

  /* ================================================================ TORSO ======================================= */
  add(turned('bruteWaist', [[0, 1.255], [0.95, 1.255], [0.95, 1.29], [0.92, 1.36], [0.88, 1.47], [0.84, 1.505], [0, 1.505]], 24), frameMat, 0, 0, -0.15); // waist turret ring
  // Core block (top at 2.62): a barrel-chested shell (round front and back shoulders, flat flanks for the side
  // armour), and the roof cap the decals sit on (top 2.66), rolled at its edges.
  add(roundProfile('bruteCore', [
    [-0.85, 1.5], [0.3, 1.5], { p: [0.45, 1.68], q: [0.45, 1.5] }, [0.45, 2.3], { p: [0.13, 2.62], q: [0.45, 2.62] }, [-0.6, 2.62],
    { p: [-0.85, 2.38], q: [-0.85, 2.62] },
  ], 1.8, 0.1, 2, 8), frameMat, 0, 0, 0);
  add(roundProfile('bruteRoof', [
    [-0.82, 2.6], [0.2, 2.6], { p: [0.38, 2.62], q: [0.32, 2.6] }, { p: [0.2, 2.66], q: [0.36, 2.66] }, [-0.72, 2.66], { p: [-0.86, 2.62], q: [-0.86, 2.66] },
  ], 1.86, 0.03, 2, 6), paint, 0, 0, 0);
  // Side armour: upper plate in body paint over a trim lower plate, one clean seam between them.
  for (const sx of [-1, 1]) {
    const x = sx * 0.93;
    add(roundProfile('bruteSideHi', [
      [-0.87, 1.97], [0.36, 1.97], [0.36, 2.34], { p: [0.12, 2.59], q: [0.36, 2.59] }, [-0.66, 2.59], { p: [-0.87, 2.4], q: [-0.87, 2.59] },
    ], 0.06, 0.025, 2, 6), paint, x, 0, 0).rotation.z = sx * 0.04;
    add(rblock(0.05, 0.5, 1.2, 0.05), trim, x - sx * 0.005, 1.78, -0.18);
  }
  // Chest: a curved breastplate in body paint, bulging forward between the waist and the head, bolted.
  {
    const A = [0.4, 1.48] as const;
    const Q = [0.74, 1.74] as const;
    const B = [0.42, 2.12] as const;
    add(roundProfile('bruteChest', [A, { p: B, q: Q }, [B[0] - 0.1, B[1] - 0.02], { p: [A[0] - 0.08, A[1] + 0.06], q: [Q[0] - 0.12, Q[1]] }], 1.6, 0.04, 3, 10), paint, 0, 0, 0);
    for (const t of [0.28, 0.72]) {
      const z = (1 - t) * (1 - t) * A[0] + 2 * t * (1 - t) * Q[0] + t * t * B[0];
      const y = (1 - t) * (1 - t) * A[1] + 2 * t * (1 - t) * Q[1] + t * t * B[1];
      const dz = 2 * (1 - t) * (Q[0] - A[0]) + 2 * t * (B[0] - Q[0]);
      const dy = 2 * (1 - t) * (Q[1] - A[1]) + 2 * t * (B[1] - Q[1]);
      // bolt heads along the outward normal (dy, -dz) in (z, y): a turn about x from +y
      const a = Math.atan2(dy, -dz);
      boltRow(bp, ironMat, [-0.66, y, z], [0.66, y, z], 6, [a, 0, 0], 0.03);
    }
  }

  /* ---- Head: low and forward between the shoulders, brow plate over the viewport slit, work light on the roof. ---- */
  add(roundProfile('bruteHead', [
    [0.34, 2.02], [0.92, 2.02], { p: [1.02, 2.12], q: [1.02, 2.02] }, [1.02, 2.4], { p: [0.88, 2.52], q: [1.02, 2.52] }, [0.34, 2.52],
  ], 0.9, 0.1, 2, 6), frameMat, 0, 0, 0);
  add(roundProfile('bruteHelm', [
    [0.32, 2.52], [0.92, 2.52], { p: [1.08, 2.5], q: [1.02, 2.52] }, { p: [0.94, 2.585], q: [1.08, 2.585] }, [0.42, 2.585], { p: [0.32, 2.55], q: [0.32, 2.585] },
  ], 0.98, 0.03, 2, 6), paint, 0, 0, 0); // head roof (top 2.585), peaked over the brow
  add(roundProfile('bruteBrow', [[0.98, 2.33], [1.1, 2.38], { p: [1.07, 2.53], q: [1.12, 2.5] }, [0.98, 2.52]], 1.0, 0.04, 3, 6), accent, 0, 0, 0); // brow
  add(roundProfile('bruteJaw', [[0.97, 2.0], [1.06, 2.0], { p: [1.1, 2.2], q: [1.12, 2.06] }, [1.0, 2.24]], 0.96, 0.04, 3, 6), trim, 0, 0, 0); // jaw
  box(0.74, 0.12, 0.04, visorMat, 0, 2.29, 1.012, 0, 0, 0, bp, false); // viewport glow
  for (const sx of [-1, 1]) add(rblock(0.06, 0.42, 0.5, 0.03), paint, sx * 0.47, 2.29, 0.82); // cheek plates
  // Work light on the head roof (left), its glow from Plow's beacon light.
  box(0.16, 0.08, 0.14, ironMat, -0.34, 2.62, 0.82, 0, 0, 0, bp, false);
  cyl(0.11, 0.12, 0.16, 12, ironMat, -0.34, 2.74, 0.88, 'z');
  cyl(0.095, 0.095, 0.02, 12, head, -0.34, 2.74, 0.965, 'z', bp, false);

  /* ---- Engine pack behind the torso: plain lid, radiator plate, one stack. ---- */
  // (Reshape: a moulded pack with round top shoulders and rear corners under a domed lid.)
  add(roundLoft('bruteEngine', sweep(-1.61, -0.87, 6, (z) => ({ hw: 0.8 * roundEnd(z + 1.61, 0.16, 0.82), yb: 1.55, yt: 2.46, rb: 0.04, rt: 0.14 }))), paint, 0, 0, 0);
  add(roundLoft('bruteLid', sweep(-1.65, -0.85, 6, (z) => {
    const e = roundEnd(z + 1.65, 0.16, 0.82);
    return { hw: 0.82 * e, yb: 2.42, yt: 2.53, rb: 0.02, rt: 0.07 };
  })), trim, 0, 0, 0); // engine lid
  // Radiator face on the back (above the counterweight).
  box(1.3, 0.42, 0.04, ironMat, 0, 2.2, -1.62);
  for (let i = 0; i < 5; i++) box(1.2, 0.035, 0.03, frameMat, 0, 2.04 + i * 0.08, -1.645, 0, 0, 0, bp, false);
  for (const sx of [-1, 1]) boltRow(bp, ironMat, [sx * 0.74, 2.535, -1.56], [sx * 0.74, 2.535, -0.92], 4, [0, 0, 0], 0.028);
  // Stack: chrome pipe in an iron heat shield, tip at Plow.exhaustTip (0.55, 3.1, -1.45).
  cyl(0.1, 0.11, 0.62, 10, chrome, 0.55, 2.76, -1.45);
  cyl(0.135, 0.135, 0.36, 10, ironMat, 0.55, 2.66, -1.45);
  cyl(0.12, 0.12, 0.04, 10, frameMat, 0.55, 3.06, -1.45, 'y', bp, false);

  /* ---- Counterweight (decal face at z = -1.95), tail lights, bumper. ---- */
  // Stacked slabs: iron base, a bare-steel middle (decal face), an iron top slab.
  add(rblock(1.84, 0.18, 0.33, 0.08), ironMat, 0, 1.04, -1.785);
  add(rblock(1.84, 0.66, 0.33, 0.12), steelMat, 0, 1.46, -1.785);
  add(rblock(1.84, 0.16, 0.33, 0.07), ironMat, 0, 1.87, -1.785);
  for (const y of [1.04, 1.87]) boltRow(bp, ironMat, [-0.8, y, -1.955], [0.8, y, -1.955], 7, [-Math.PI / 2, 0, 0], 0.032);
  for (const sx of [-1, 1]) box(0.18, 0.1, 0.05, tailMat, sx * 0.72, 1.2, -1.97, 0, 0, 0, bp, false);
  const bumperTex = hazardTexture();
  bumperTex.repeat.set(6, 1);
  box(2.4, 0.3, 0.2, new THREE.MeshStandardMaterial({ map: bumperTex, roughness: 0.6 }), 0, 0.75, -2.05);
  box(2.44, 0.06, 0.24, ironMat, 0, 0.92, -2.05);

  /* ================================================================ ARMS ======================================== */
  const arms: MechArm[] = [];
  const restZ = 0.25;
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * SHOULDER[0], SHOULDER[1], SHOULDER[2]);
    bp.add(shoulder);
    // Shoulder hub: a fat iron drum with an accent cap.
    add(turnedX('bruteShoulderHub', [[0, -0.21], [0.24, -0.21], [0.29, -0.19], [0.3, -0.15], [0.3, 0.15], [0.29, 0.19], [0.24, 0.21], [0, 0.21]], 16), ironMat, 0, 0, 0, shoulder);
    cyl(0.13, 0.13, 0.46, 10, hub, 0, 0, 0, 'x', shoulder, false);
    // Pauldron: one heavy bent plate in body paint with an accent edge band.
    // (Reshape: one heavy moulded shoulder block domed over the hub (round in plan at its ends, a big roll on its
    // outer top edge), an accent band along its lower outer edge, a bolt row along its crown; built for the right
    // arm and mirrored.)
    const pad = frameAt(0, 0, 0, 0, 0, 0, shoulder);
    pad.scale.x = sx;
    add(roundLoft('brutePauldron', sweep(-0.52, 0.52, 8, (z) => {
      const e = roundEnd(0.52 - Math.abs(z), 0.18, 0.78);
      return { hw: 0.47 * e, yb: -0.08, yt: 0.46 - (1 - e) * 0.12, rb: 0.04, rt: 0.3 * e };
    })), paint, 0.14, 0, 0, pad);
    add(rblock(0.05, 0.12, 0.9, 0.02), accent, 0.6, -0.06, 0, pad, false);
    boltRow(pad, ironMat, [0.02, 0.465, -0.34], [0.02, 0.465, 0.34], 4, [0, 0, 0], 0.03);
    // Upper arm: twin iron straps around a core.
    box(0.3, 0.6, 0.26, frameMat, sx * 0.04, -0.45, 0, 0, 0, 0, shoulder);
    for (const dx of [-0.17, 0.17]) plate(0.07, 0.8, 0.34, 0.015, ironMat, sx * 0.04 + dx, -0.45, 0, 0, 0, 0, shoulder);
    // Elbow sleeve: the long housing the forearm piston slides out of (z -1.0 .. 0.35), collar, rear cap.
    const ey = ELBOW_Y;
    const ex = sx * 0.05;
    add(roundLoft('bruteSleeve', sweep(-1.0, 0.35, 6, (z) => {
      const e = roundEnd(z + 1.0, 0.18, 0.86);
      return { hw: 0.29 * e, yb: -0.28 * e, yt: 0.28 * e, rb: 0.16, rt: 0.16 };
    })), trim, ex, ey, 0, shoulder);
    add(roundLoft('bruteCollar', sweep(0.23, 0.37, 2, () => ({ hw: 0.33, yb: -0.32, yt: 0.32, rb: 0.17, rt: 0.17 }))), ironMat, ex, ey, 0, shoulder);
    add(rblock(0.5, 0.48, 0.08, 0.12), ironMat, ex, ey, -1.02, shoulder);
    // Punch-ram barrel on top (fixed here; its rod rides on the forearm).
    const topRam: V3 = [ex - sx * 0.08, ey + 0.38, 0];
    for (const [rx, ry] of [topRam]) {
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
    add(rblock(0.6, 0.58, 0.18, 0.08), ironMat, 0, 0, 0.62, forearm);
    // Rod (fixed to the wrist; long enough to stay in its barrel at full reach).
    for (const [rx, ry] of [topRam]) {
      const lx = rx - ex;
      const ly = ry - ey;
      cyl(0.045, 0.045, 1.9, 8, chrome, lx, ly, -0.43, 'z', forearm, false);
      box(0.1, 0.1, 0.12, ironMat, lx, ly, 0.52, 0, 0, 0, forearm, false);
      rod([lx, ly, 0.56], [lx * 0.4, ly * 0.4, 0.56], 0.04, ironMat, forearm);
    }
    // Fist: hazard cuff band, a heavy steel block, trim knuckle plate, four knuckles, thumb.
    box(0.68, 0.62, 0.08, hazardMat, 0, 0, 0.75, 0, 0, 0, forearm, false);
    // (Reshape: a domed fist block rounding off toward the knuckles; rounded knuckles, guard plate and thumb.)
    add(roundLoft('bruteFist', sweep(0.78, 1.34, 6, (z) => {
      const e = roundEnd(1.34 - z, 0.16, 0.8);
      return { hw: 0.39 * e, yb: -0.32 * e, yt: 0.32 * e, rb: 0.13, rt: 0.16 };
    })), fistMat, 0, 0, 0, forearm);
    add(roundProfile('bruteKnuckleGuard', [[0.82, 0.3], [1.28, 0.3], { p: [1.36, 0.24], q: [1.36, 0.3] }, { p: [1.26, 0.42], q: [1.36, 0.42] }, [0.84, 0.42]], 0.84, 0.04, 2, 5), trim, 0, 0, 0, forearm);
    for (let k = 0; k < 4; k++) {
      const kx = -0.28 + k * 0.187;
      add(rblock(0.17, 0.22, 0.16, 0.06), ironMat, kx, 0.13, 1.37, forearm);
    }
    add(rblock(0.13, 0.2, 0.34, 0.055), ironMat, -sx * 0.42, -0.06, 1.12, forearm); // thumb
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
    const saw = buildBuzzsaw({ finish: 'steel', hub: accent });
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
    add(guardGeo, accent, 0, 0.08, 0, k);
    add(lipGeo, trim, 0, -0.06, 0, k);
    // Drive: motor lying fore-aft on the guard, belt case running in to the saw hub.
    cyl(0.16, 0.16, 0.6, 12, trim, 0.72, 0.3, -0.7, 'z', k);
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
