import * as THREE from 'three';
import { mergeStatic } from '../../render/mergeStatic';
import { makeShadowProxy } from '../../render/shadowProxy';
import { addMesh, type VehicleBuild, type VehicleBuildIn } from './types';

/** ARSENAL / BATTLE TANK animatable parts (names match Plow's fields and mountWorld). */
export interface ArsenalVehicleParts {
  /** Yaws with Plow.turretHeading. */
  turret: THREE.Group;
  /** Gun elevation pivot (follows gunPitch) and the spinning barrel rotor inside it. */
  gunMount: THREE.Group;
  minigun: THREE.Group;
  /** mountWorld('muzzle' | 'laser' | 'pod', i) anchors. */
  muzzles: THREE.Object3D[];
  laser: THREE.Object3D;
  pods: THREE.Object3D[];
  /** Weapon glow material (pulsed by the Plow). */
  glowMat: THREE.MeshStandardMaterial;
}

/* Track geometry: one tread loop per side (a box run with drum ends), cleats every CLEAT_PITCH m. */
const TRACK_X = 1.12;
const TRACK_W = 0.62;
const TRACK_H = 0.8;
const TRACK_LEN = 3.0;
const DRUM_R = TRACK_H / 2;
const TRACK_Y = 0.05 + DRUM_R;
const CLEAT_PITCH = 0.25;

/** A dark tread texture: CLEAT_PITCH-wide rubber blocks with a groove between (u runs along the track). */
function treadTexture(): THREE.DataTexture {
  const w = 8;
  const data = new Uint8Array(w * 4);
  for (let i = 0; i < w; i++) {
    const v = i < 2 ? 16 : i < 3 ? 78 : 40;
    data.set([v, v, v + 3, 255], i * 4);
  }
  const t = new THREE.DataTexture(data, w, 1);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** The tread run: a box whose uv.x runs along z in metres / CLEAT_PITCH on every face, so scrolling the texture
 *  offset moves the cleats along the whole belt. */
function treadGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(TRACK_W, TRACK_H, TRACK_LEN);
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const across = Math.abs(nrm.getX(i)) > 0.5 ? pos.getY(i) : pos.getX(i);
    uv.setXY(i, pos.getZ(i) / CLEAT_PITCH, across);
  }
  uv.needsUpdate = true;
  return g;
}

/**
 * BATTLE TANK: not a plow. A low, wide hull on two crawler tracks under armoured skirts, a sloped glacis with the
 * laser projector set into it, a six-sided turret carrying the long pulse-laser cannon (focusing coils that spin while
 * it fires, muzzle brake), a commander's cupola and a whip antenna that rocks back when the tank surges, and box
 * launchers (2 x 3 tubes) on the rear fenders. The treads scroll and the drive sprockets turn with the ground speed
 * (differential when pivoting), worked out from the body's own world matrix in onBeforeRender, so the Plow needs no
 * extra hooks. Rides on the shared chassis; the shared wheels are hidden for this kind.
 */
export function buildArsenalVehicle({ mats: m, chassis }: VehicleBuildIn): VehicleBuild<ArsenalVehicleParts> {
  const ap = new THREE.Group();
  const glowMat = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff1010, emissiveIntensity: 1.2, roughness: 0.2 });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.6, metalness: 0.6 });
  addMesh(chassis, m.dark, 0, 0.62, 0.05, ap);

  // Lower hull between the tracks, fender deck over them, upper hull and a sloped glacis with a lip.
  addMesh(new THREE.BoxGeometry(1.62, 0.5, 3.5), m.dark, 0, 0.78, 0, ap);
  addMesh(new THREE.BoxGeometry(2.96, 0.1, 3.7), m.trim, 0, 1.06, -0.05, ap);
  addMesh(new THREE.BoxGeometry(2.1, 0.32, 2.7), m.paint, 0, 1.25, -0.45, ap);
  const glacis = addMesh(new THREE.BoxGeometry(2.1, 0.12, 1.25), m.paint, 0, 1.18, 1.38, ap);
  glacis.rotation.x = 0.28;
  addMesh(new THREE.BoxGeometry(2.2, 0.16, 0.18), m.trim, 0, 0.98, 1.98, ap);
  // Headlights in armoured cages on the glacis corners.
  for (const sx of [-1, 1]) {
    const hl = addMesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 10), m.head, sx * 0.82, 1.16, 1.92, ap, false);
    hl.rotation.x = Math.PI / 2;
    addMesh(new THREE.BoxGeometry(0.3, 0.04, 0.16), m.dark, sx * 0.82, 1.29, 1.9, ap);
  }
  // Laser projector set into the glacis: armoured housing, collar, glowing lens; the beam leaves from `laser`.
  addMesh(new THREE.BoxGeometry(0.5, 0.34, 0.4), m.dark, 0, 1.05, 1.86, ap);
  const lb = addMesh(new THREE.CylinderGeometry(0.15, 0.19, 0.36, 12), m.chrome, 0, 1.05, 2.12, ap);
  lb.rotation.x = Math.PI / 2;
  const lens = addMesh(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 12), glowMat, 0, 1.05, 2.31, ap, false);
  lens.rotation.x = Math.PI / 2;
  const laser = new THREE.Object3D();
  laser.position.set(0, 1.05, 2.38);
  ap.add(laser);
  // Engine deck at the back: grille slats, twin exhausts, a hazard-red tail strip.
  for (let i = 0; i < 5; i++) addMesh(new THREE.BoxGeometry(1.5, 0.05, 0.1), m.dark, 0, 1.43, -0.95 - i * 0.2, ap, false);
  for (const sx of [-1, 1]) {
    const ex = addMesh(new THREE.CylinderGeometry(0.09, 0.11, 0.3, 8), ironMat, sx * 0.55, 1.18, -1.86, ap);
    ex.rotation.x = Math.PI / 2;
  }
  addMesh(new THREE.BoxGeometry(1.4, 0.07, 0.04), glowMat, 0, 1.3, -1.81, ap, false);

  // Armoured side skirts over the upper half of each track, with bolt strips; tow hooks front and back.
  for (const sx of [-1, 1]) {
    addMesh(new THREE.BoxGeometry(0.08, 0.42, 3.5), m.paint, sx * 1.47, 0.83, 0, ap);
    addMesh(new THREE.BoxGeometry(0.1, 0.06, 3.5), m.trim, sx * 1.48, 0.62, 0, ap);
    for (const z of [1.86, -1.86]) addMesh(new THREE.BoxGeometry(0.12, 0.12, 0.18), ironMat, sx * 0.6, 0.72, z, ap);
  }

  // Missile launchers on the rear fenders: armoured boxes, 2 x 3 tubes facing forward each.
  const pods: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const x0 = sx * 1.25;
    addMesh(new THREE.BoxGeometry(0.62, 0.46, 1.0), m.trim, x0, 1.36, -0.95, ap);
    addMesh(new THREE.BoxGeometry(0.66, 0.06, 1.04), m.dark, x0, 1.61, -0.95, ap);
    addMesh(new THREE.BoxGeometry(0.66, 0.5, 0.05), m.dark, x0, 1.36, -0.43, ap);
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        const x = x0 + (c - 1) * 0.18;
        const y = 1.27 + r * 0.2;
        addMesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 8), glowMat, x, y, -0.4, ap, false).rotation.x = Math.PI / 2;
        const o = new THREE.Object3D();
        o.position.set(x, y, -0.38);
        ap.add(o);
        pods.push(o);
      }
    }
  }

  // Turret: a six-sided armoured housing (flat face forward, stretched front-to-back), turret ring, rear bustle,
  // red sensor visor, commander's cupola with a hatch and the whip antenna. Yaws as a whole.
  const turret = new THREE.Group();
  turret.position.set(0, 1.41, -0.15);
  ap.add(turret);
  addMesh(new THREE.CylinderGeometry(0.82, 0.86, 0.12, 18), ironMat, 0, 0.04, 0, turret);
  const hex = addMesh(new THREE.CylinderGeometry(0.72, 0.88, 0.46, 6), m.paint, 0, 0.32, 0, turret);
  hex.rotation.y = Math.PI / 6;
  hex.scale.set(1, 1, 1.22);
  const roof = addMesh(new THREE.CylinderGeometry(0.62, 0.72, 0.06, 6), m.trim, 0, 0.58, 0, turret);
  roof.rotation.y = Math.PI / 6;
  roof.scale.set(1, 1, 1.22);
  addMesh(new THREE.BoxGeometry(1.0, 0.34, 0.5), m.paint, 0, 0.3, -1.0, turret); // bustle
  addMesh(new THREE.BoxGeometry(1.04, 0.05, 0.52), m.dark, 0, 0.49, -1.0, turret);
  for (const sx of [-1, 1]) addMesh(new THREE.BoxGeometry(0.06, 0.3, 0.86), m.dark, sx * 0.8, 0.3, -0.05, turret); // side plates
  addMesh(new THREE.BoxGeometry(0.7, 0.07, 0.04), glowMat, 0, 0.46, 0.84, turret, false);
  addMesh(new THREE.CylinderGeometry(0.2, 0.22, 0.2, 12), m.dark, -0.32, 0.7, -0.3, turret);
  addMesh(new THREE.CylinderGeometry(0.21, 0.21, 0.04, 12), m.trim, -0.32, 0.82, -0.3, turret);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    addMesh(new THREE.BoxGeometry(0.06, 0.06, 0.03), m.glass, -0.32 + Math.sin(a) * 0.2, 0.72, -0.3 + Math.cos(a) * 0.2, turret, false).rotation.y = a;
  }
  addMesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), m.dark, 0.38, 0.68, -0.6, turret); // antenna base
  const antenna = new THREE.Group();
  antenna.position.set(0.38, 0.76, -0.6);
  turret.add(antenna);
  addMesh(new THREE.CylinderGeometry(0.012, 0.022, 1.5, 5), m.chrome, 0, 0.75, 0, antenna, false);
  addMesh(new THREE.SphereGeometry(0.04, 6, 4), glowMat, 0, 1.52, 0, antenna, false);

  // Gun: the mantlet pivots at the turret front (Plow sets gun.rotation.x from the auto-aim); the rotor is the long
  // pulse-laser cannon: heavy barrel, thermal sleeve, three glowing focusing coils and four cooling fins (they spin
  // about z while it fires), a muzzle brake and a glowing tip.
  const GY = 0.3;
  const GZ = 0.92;
  const gun = new THREE.Group();
  gun.position.set(0, GY, GZ);
  turret.add(gun);
  addMesh(new THREE.BoxGeometry(0.66, 0.42, 0.42), m.dark, 0, 0, 0.05, gun); // mantlet
  const collar = addMesh(new THREE.CylinderGeometry(0.24, 0.28, 0.24, 14), m.chrome, 0, 0, 0.36, gun);
  collar.rotation.x = Math.PI / 2;
  const rotor = new THREE.Group();
  rotor.position.set(0, 0, 0.45);
  gun.add(rotor);
  const BL = 2.15;
  const barrel = addMesh(new THREE.CylinderGeometry(0.1, 0.13, BL, 14), m.dark, 0, 0, BL / 2, rotor);
  barrel.rotation.x = Math.PI / 2;
  const sleeve = addMesh(new THREE.CylinderGeometry(0.17, 0.17, 0.7, 14), m.chrome, 0, 0, 0.45, rotor);
  sleeve.rotation.x = Math.PI / 2;
  for (const z of [0.95, 1.25, 1.55]) {
    const coil = addMesh(new THREE.TorusGeometry(0.16, 0.04, 8, 18), glowMat, 0, 0, z, rotor, false);
    coil.rotation.z = z; // irregular start angles so the spin reads
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const fin = addMesh(new THREE.BoxGeometry(0.04, 0.14, 0.6), m.chrome, Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0.45, rotor);
    fin.rotation.z = a;
  }
  addMesh(new THREE.BoxGeometry(0.36, 0.16, 0.26), ironMat, 0, 0, BL - 0.05, rotor); // muzzle brake
  const tip = addMesh(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 12), glowMat, 0, 0, BL + 0.1, rotor, false);
  tip.rotation.x = Math.PI / 2;
  const mz = new THREE.Object3D();
  mz.position.set(0, 0, 0.45 + BL + 0.15);
  gun.add(mz);

  turret.removeFromParent();
  mergeStatic(ap);
  mergeStatic(turret, { keep: [gun, antenna] });
  mergeStatic(gun, { keep: [rotor] });
  mergeStatic(rotor);
  mergeStatic(antenna);
  ap.add(turret);

  // Tracks (kept out of the merge: the treads scroll and the drive sprockets turn).
  const treadGeo = treadGeometry();
  const drumGeo = new THREE.CylinderGeometry(DRUM_R, DRUM_R, TRACK_W, 16);
  drumGeo.rotateZ(Math.PI / 2);
  const sprocketGeo = new THREE.CylinderGeometry(DRUM_R * 0.62, DRUM_R * 0.62, TRACK_W + 0.04, 7);
  sprocketGeo.rotateZ(Math.PI / 2);
  const wheelGeo = new THREE.CylinderGeometry(0.17, 0.17, TRACK_W + 0.02, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const tracks: { tex: THREE.Texture; side: number; sprockets: THREE.Mesh[] }[] = [];
  let driver!: THREE.Mesh;
  for (const sx of [-1, 1]) {
    const tex = treadTexture();
    const treadMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, flatShading: true });
    driver = addMesh(treadGeo, treadMat, sx * TRACK_X, TRACK_Y, 0, ap);
    const sprockets: THREE.Mesh[] = [];
    for (const z of [TRACK_LEN / 2, -TRACK_LEN / 2]) {
      addMesh(drumGeo, treadMat, sx * TRACK_X, TRACK_Y, z, ap);
      sprockets.push(addMesh(sprocketGeo, m.hub, sx * TRACK_X, TRACK_Y, z, ap, false));
    }
    for (let i = 0; i < 4; i++) sprockets.push(addMesh(wheelGeo, ironMat, sx * TRACK_X, 0.2, -1.05 + i * 0.7, ap, false));
    tracks.push({ tex, side: sx, sprockets });
  }

  // Track + antenna animation from the body's world motion, once per frame (the first render pass of a frame moves
  // things; shadow / extra passes see zero motion). Teleports (respawn, garage swap) are ignored.
  let lastX = NaN;
  let lastZ = 0;
  let lastYaw = 0;
  let lastT = 0;
  let speedEase = 0;
  let lean = 0;
  driver.onBeforeRender = () => {
    const e = ap.matrixWorld.elements;
    const x = e[12];
    const z = e[14];
    const yaw = Math.atan2(e[8], e[10]);
    const now = performance.now() / 1000;
    const dt = now - lastT;
    if (dt < 1e-3) return;
    lastT = now;
    const dx = x - lastX;
    const dz = z - lastZ;
    let dyaw = yaw - lastYaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const valid = !Number.isNaN(lastX) && dt < 0.25 && dx * dx + dz * dz < 9;
    lastX = x;
    lastZ = z;
    lastYaw = yaw;
    if (!valid) return;
    const len = Math.hypot(e[8], e[10]) || 1;
    const fwd = (dx * e[8] + dz * e[10]) / len;
    for (const t of tracks) {
      const ds = fwd - dyaw * TRACK_X * t.side;
      t.tex.offset.x -= ds / CLEAT_PITCH;
      for (let i = 0; i < t.sprockets.length; i++) t.sprockets[i].rotation.x += ds / (i < 2 ? DRUM_R * 0.62 : 0.17);
    }
    // The whip antenna rocks back as the tank surges and springs forward when it brakes.
    const v = fwd / dt;
    const acc = (v - speedEase) / dt;
    speedEase += (v - speedEase) * Math.min(1, dt * 8);
    lean += (THREE.MathUtils.clamp(-acc * 0.012, -0.5, 0.5) - lean) * Math.min(1, dt * 6);
    antenna.rotation.x = lean + Math.sin(now * 9) * Math.abs(lean) * 0.25;
  };

  ap.add(...makeShadowProxy(ap, ap));
  return { group: ap, parts: { turret, gunMount: gun, minigun: rotor, muzzles: [mz, mz], laser, pods, glowMat } };
}
