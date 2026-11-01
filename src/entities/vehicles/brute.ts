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
/** Forearm slide (m) at full punch extension. */
const PUNCH_REACH = 1.25;
/** Saw spin (rad/s) idling / at full charge. */
const SAW_IDLE = 6;
const SAW_FULL = 46;

/** BRUTUS: the WRECKING MECH — a hunched, tracked brawler. Wide treads, a squat armoured torso with a slit visor and
 *  a back-mounted engine pack (twin stacks), two huge piston fists on swinging shoulders and a flat buzzsaw bolted
 *  to each front corner of the hull. No blade. */
export function buildBruteVehicle({ mats, chassis }: VehicleBuildIn): VehicleBuild<BruteVehicleParts> {
  const bp = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = bp, shadow = true) =>
    addMesh(geo, mat, x, y, z, parent, shadow);
  const hazardTex = hazardTexture();
  hazardTex.repeat.set(3, 1);
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.55, metalness: 0.25 });
  const trackMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1f, roughness: 0.95, flatShading: true });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.6, metalness: 0.6 });
  const fistMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.28, metalness: 0.85 });

  /* ---- Tracks: a rubber loop each side, sprockets, road wheels, guards and moving cleats. ---- */
  add(chassis, mats.dark, 0, 0.62, 0.05);
  for (const x of [-TRACK_X, TRACK_X]) {
    add(new THREE.BoxGeometry(0.66, TRACK_H - 0.3, TRACK_LEN - 0.9), trackMat, x, TRACK_H / 2 + 0.02, 0.1);
    for (const z of [0.1 + (TRACK_LEN - 0.9) / 2, 0.1 - (TRACK_LEN - 0.9) / 2]) {
      add(new THREE.CylinderGeometry(TRACK_H / 2 - 0.02, TRACK_H / 2 - 0.02, 0.66, 16), trackMat, x, TRACK_H / 2 + 0.02, z).rotation.z = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.3, 0.3, 0.7, 8), mats.hub, x, TRACK_H / 2 + 0.02, z).rotation.z = Math.PI / 2;
    }
    for (let i = 0; i < 4; i++) add(new THREE.CylinderGeometry(0.2, 0.2, 0.7, 10), ironMat, x, 0.3, -1.05 + i * 0.75, bp, false).rotation.z = Math.PI / 2;
    add(new THREE.BoxGeometry(0.74, 0.08, TRACK_LEN + 0.1), ironMat, x, TRACK_H + 0.07, 0.1);
    // Hazard skirt along the outside of each tread.
    add(new THREE.BoxGeometry(0.05, 0.3, TRACK_LEN - 0.6), hazardMat, x + Math.sign(x) * 0.39, TRACK_H - 0.12, 0.1);
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

  /* ---- Lower hull: a low wedge between the treads with a ram plate and a turret ring. ---- */
  add(new THREE.BoxGeometry(1.7, 0.5, 3.1), mats.trim, 0, 1.03, -0.05);
  const ramPlate = add(new THREE.BoxGeometry(1.75, 0.55, 0.3), ironMat, 0, 0.95, 1.6);
  ramPlate.rotation.x = 0.45;
  add(new THREE.BoxGeometry(1.8, 0.14, 0.2), hazardMat, 0, 0.82, 1.78);
  add(new THREE.CylinderGeometry(0.85, 0.95, 0.25, 18), mats.dark, 0, 1.38, -0.1);

  /* ---- Torso: squat and hunched forward, chest hazard band, slit visor, engine pack + twin stacks on the back. ---- */
  add(new THREE.BoxGeometry(1.95, 1.05, 1.5), mats.paint, 0, 2.0, -0.15);
  const chest = add(new THREE.BoxGeometry(1.7, 0.75, 0.25), mats.paint, 0, 2.05, 0.65);
  chest.rotation.x = -0.3;
  add(new THREE.BoxGeometry(1.72, 0.16, 0.06), hazardMat, 0, 1.8, 0.78, bp, false).rotation.x = -0.3;
  // Armoured head: a low brow box with a glowing visor slit and a roof light.
  add(new THREE.BoxGeometry(0.95, 0.5, 0.75), mats.trim, 0, 2.68, 0.35);
  add(new THREE.BoxGeometry(1.05, 0.1, 0.85), mats.dark, 0, 2.95, 0.38);
  add(new THREE.BoxGeometry(0.7, 0.1, 0.05), mats.head, 0, 2.7, 0.74, bp, false);
  for (const x of [-0.25, 0.25]) add(new THREE.BoxGeometry(0.1, 0.07, 0.06), mats.head, x, 3.04, 0.62, bp, false);
  // Engine pack with vent slats, stacks at the old exhaust tip (Plow.exhaustTip: 0.55, 3.1, -1.45).
  add(new THREE.BoxGeometry(1.6, 0.9, 0.7), mats.trim, 0, 2.05, -1.2);
  for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(1.4, 0.05, 0.1), mats.dark, 0, 2.52, -0.95 - i * 0.17, bp, false);
  for (const x of [-0.55, 0.55]) {
    add(new THREE.CylinderGeometry(0.11, 0.13, 1.2, 10), mats.chrome, x, 2.5, -1.45);
    add(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 10), mats.dark, x, 3.12, -1.45);
  }
  // Rear bumper + ripper tooth (the old dozer's soul).
  const bumperTex = hazardTexture();
  bumperTex.repeat.set(6, 1);
  add(new THREE.BoxGeometry(2.4, 0.3, 0.2), new THREE.MeshStandardMaterial({ map: bumperTex, roughness: 0.55 }), 0, 0.75, -2.05);
  add(new THREE.BoxGeometry(0.16, 0.8, 0.22), ironMat, 0, 0.6, -2.35).rotation.x = -0.35;

  /* ---- Arms: shoulder pad, upper arm, and a forearm piston that slides out with a huge fist. ---- */
  const arms: MechArm[] = [];
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 1.2, 2.3, 0.05);
    bp.add(shoulder);
    const pad = add(new THREE.BoxGeometry(0.75, 0.42, 0.95), mats.paint, sx * 0.12, 0.2, 0, shoulder);
    pad.rotation.z = sx * -0.25;
    add(new THREE.BoxGeometry(0.06, 0.16, 0.97), hazardMat, sx * 0.48, 0.12, 0, shoulder, false).rotation.z = sx * -0.25;
    add(new THREE.SphereGeometry(0.3, 12, 8), ironMat, 0, -0.05, 0, shoulder);
    add(new THREE.BoxGeometry(0.38, 0.75, 0.42), mats.dark, sx * 0.05, -0.45, 0.08, shoulder);
    // Hydraulic ram from the elbow up to the shoulder.
    add(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 8), mats.chrome, sx * 0.24, -0.4, -0.12, shoulder, false);
    const forearm = new THREE.Group();
    const restZ = 0.25;
    forearm.position.set(sx * 0.05, -0.85, restZ);
    shoulder.add(forearm);
    add(new THREE.BoxGeometry(0.48, 0.46, 0.95), mats.trim, 0, 0, 0.2, forearm);
    add(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 8), mats.chrome, 0, 0.27, 0.05, forearm, false).rotation.x = Math.PI / 2;
    // The fist: a chrome block, four knuckle studs and a dark cuff.
    add(new THREE.BoxGeometry(0.62, 0.36, 0.2), mats.dark, 0, 0, 0.72, forearm);
    add(new THREE.BoxGeometry(0.72, 0.66, 0.6), fistMat, 0, 0, 1.08, forearm);
    for (let k = 0; k < 4; k++) add(new THREE.BoxGeometry(0.14, 0.14, 0.1), ironMat, -0.24 + k * 0.16, 0.14, 1.42, forearm);
    add(new THREE.BoxGeometry(0.6, 0.12, 0.08), hazardMat, 0, -0.18, 1.39, forearm, false);
    mergeStatic(forearm);
    mergeStatic(shoulder, { keep: [forearm] });
    arms.push({ shoulder, forearm, restZ });
  }

  /* ---- Buzzsaws bolted flat to the front corners of the hull (left one mirrored so its arm points inward). ---- */
  const saws: Buzzsaw[] = [];
  for (const sx of [-1, 1]) {
    const saw = buildBuzzsaw();
    saw.group.position.set(sx * 1.45, 1.05, 1.45);
    saw.group.scale.set(sx < 0 ? -1 : 1, 1, 1);
    saw.halo.visible = false;
    bp.add(saw.group);
    saws.push(saw);
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
