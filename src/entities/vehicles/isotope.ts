import * as THREE from 'three';
import { hazardTexture } from '../plowModels';
import { mergeStatic } from '../../render/mergeStatic';
import { makeShadowProxy } from '../../render/shadowProxy';
import { addMesh, boltRow, kitBox, type VehicleBuild, type VehicleBuildIn } from './types';
import { archFender, arcPts, rblock, roundEnd, roundLoft, roundProfile, sweep, turned, turnedZ } from './vehicleShapes';

/** ISOTOPE / REACTOR HAULER animatable parts. */
export interface IsotopeVehicleParts {
  /** Reactor core glow material (pulsed by the Plow). */
  coreMat: THREE.MeshStandardMaterial;
}

/** Radiation trefoil decal (canvas, cached; null without a DOM, e.g. headless tests). */
let trefoil: THREE.CanvasTexture | null | undefined;
function trefoilTex(): THREE.CanvasTexture | null {
  if (trefoil !== undefined) return trefoil;
  if (typeof document === 'undefined') return (trefoil = null);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2d21b';
  g.beginPath();
  g.arc(64, 64, 62, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#141414';
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
    g.beginPath();
    g.arc(64, 64, 54, a - 0.52, a + 0.52);
    g.arc(64, 64, 16, a + 0.52, a - 0.52, true);
    g.fill();
  }
  g.beginPath();
  g.arc(64, 64, 10, 0, Math.PI * 2);
  g.fill();
  trefoil = new THREE.CanvasTexture(c);
  trefoil.colorSpace = THREE.SRGBColorSpace;
  return trefoil;
}

/** Reactor tank: lies along Z on the flatbed (centre / radius / length). The RAD SPRAYER nozzle sits on a boom over
 *  the nose at about (0, 1.25, 2.3) (combat/isotope.ts NOZZLE_Y / NOZZLE_Z). */
const TANK_Z = -0.85;
const TANK_Y = 1.62;
const TANK_R = 0.66;
const TANK_L = 2.3;

/** REACTOR HAULER: a long, low nuclear flatbed — a stubby armoured cab up front, a big glowing reactor capsule lying
 *  on the bed in heavy hoop ribs with a window band of green glow, three control rods bobbing out of its top, twin
 *  cooling stacks at the tail, a rear trefoil vent fan, coolant hoses and a sprayer boom with a nozzle over the nose.
 *  No blade. Rides on the shared chassis + wheels. Moving parts animate themselves from the clock (onBeforeRender:
 *  no Plow hooks, no allocation, nothing while hidden).
 *
 *  Reshape (art pass): a round-nosed cab with a raked, round-roofed greenhouse and a peaked roof cap, round wheel
 *  arches, a moulded deck tray, one turned reactor capsule on curved saddles, turned cooling stacks and a tubular bull
 *  bar (vehicleShapes.ts); same per-material draws. */
export function buildIsotopeVehicle({ mats, chassis }: VehicleBuildIn): VehicleBuild<IsotopeVehicleParts> {
  const group = new THREE.Group();
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x2fd60a, emissive: 0x2cff00, emissiveIntensity: 0.9, roughness: 0.3 });
  const lead = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.55, metalness: 0.55 });
  const hazardTex = typeof document !== 'undefined' ? hazardTexture() : null;
  if (hazardTex) hazardTex.repeat.set(5, 1);
  const hazardMat = new THREE.MeshStandardMaterial({ color: hazardTex ? 0xffffff : 0xffc21a, map: hazardTex, roughness: 0.55, metalness: 0.2 });
  const tref = trefoilTex();
  const signMat = new THREE.MeshStandardMaterial({ color: tref ? 0xffffff : 0xf2d21b, map: tref, roughness: 0.5, alphaTest: 0.5 });

  addMesh(chassis, mats.dark, 0, 0.62, 0.05, group);
  // Flatbed: a long low deck with a hazard-striped skirt and lead side plates.
  // (Reshape: the deck is a moulded tray with round ends; the cab, arches, tank, cradles and stacks are curved.)
  addMesh(roundLoft('isoDeck', sweep(-2.1, 1.0, 10, (z) => {
    const e = roundEnd(z + 2.1, 0.22, 0.8);
    return { hw: 1.025 * e, yb: 0.79, yt: 1.05, rb: 0.07, rt: 0.05 };
  })), mats.dark, 0, 0, 0, group);
  for (const sx of [-1, 1]) {
    addMesh(new THREE.BoxGeometry(0.08, 0.26, 3.0), hazardMat, sx * 1.04, 0.92, -0.55, group, false);
    addMesh(rblock(0.12, 0.34, 2.2, 0.05), lead, sx * 1.02, 1.2, -0.8, group);
    // Shield plate lapped over the lead flank, bolted down its middle.
    addMesh(rblock(0.05, 0.2, 1.5, 0.02), lead, sx * 1.095, 1.24, -0.85, group);
    boltRow(group, lead, [sx * 1.122, 1.24, -1.5], [sx * 1.122, 1.24, -0.2], 6, [0, 0, -sx * Math.PI / 2], 0.03, true);
  }
  // Wheel arches, and mud flaps behind the rear wheels.
  for (const [x, z] of [[-0.97, 1.45], [0.97, 1.45], [-0.97, -1.25], [0.97, -1.25]] as const) addMesh(archFender('isoArch', 0.48, 0.55, 0.63, 8, 172, 0.5, 0.045), mats.dark, x, 0, z, group);
  for (const sx of [-1, 1]) addMesh(kitBox(0.44, 0.4, 0.035, 0.012), mats.dark, sx * 0.95, 0.52, -1.86, group);
  // Cab: stubby and armoured: a wide lower shell with a rolled nose, a narrower greenhouse on it (raked visor, round
  // roof and back corners), a yellow roof cap peaking over the visor.
  addMesh(roundProfile('isoCabLo', [
    [0.62, 0.99], [1.7, 0.99], { p: [1.78, 1.07], q: [1.78, 0.99] }, [1.78, 1.5], { p: [1.66, 1.62], q: [1.78, 1.62] }, [0.66, 1.62],
    { p: [0.62, 1.58], q: [0.62, 1.62] },
  ], 1.9, 0.13, 4, 6), mats.paint, 0, 0, 0, group);
  addMesh(roundProfile('isoCabHi', [
    [0.58, 1.58], [1.63, 1.58], [1.5, 2.08], { p: [1.36, 2.19], q: [1.47, 2.19] }, [0.74, 2.19], { p: [0.58, 2.03], q: [0.58, 2.19] },
  ], 1.66, 0.12, 4, 6), mats.paint, 0, 0, 0, group);
  addMesh(roundProfile('isoRoofCap', [
    [0.64, 2.17], [1.42, 2.17], { p: [1.6, 2.2], q: [1.53, 2.17] }, { p: [1.46, 2.275], q: [1.6, 2.275] }, [0.74, 2.275],
    { p: [0.64, 2.21], q: [0.64, 2.275] },
  ], 1.74, 0.045, 3, 6), mats.trim, 0, 0, 0, group);
  // Cab armour: a lead kick plate along each lower flank and across the nose, bolted; roof work lights.
  for (const sx of [-1, 1]) {
    addMesh(rblock(0.05, 0.12, 1.1, 0.02), lead, sx * 0.965, 1.05, 1.2, group);
    boltRow(group, lead, [sx * 0.992, 1.05, 0.75], [sx * 0.992, 1.05, 1.65], 4, [0, 0, -sx * Math.PI / 2], 0.026, true);
    addMesh(rblock(0.22, 0.12, 0.12, 0.035), mats.dark, sx * 0.62, 2.33, 1.36, group);
    addMesh(new THREE.BoxGeometry(0.17, 0.07, 0.02), mats.head, sx * 0.62, 2.33, 1.425, group, false);
  }
  addMesh(rblock(1.84, 0.12, 0.05, 0.02), lead, 0, 1.05, 1.79, group);
  // Visor glass set into the raked front (a thin panel proud of it, painted pillars either side) and side windows
  // (one slab through the greenhouse, its faces just proud of both flanks).
  {
    const A = [1.625, 1.6];
    const B = [1.505, 2.06];
    const l = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const u = [(B[0] - A[0]) / l, (B[1] - A[1]) / l];
    const nn = [u[1], -u[0]];
    const p = (t: number, o: number): [number, number] => [A[0] + u[0] * t + nn[0] * o, A[1] + u[1] * t + nn[1] * o];
    addMesh(roundProfile('isoVisor', [p(0.1, -0.01), p(l - 0.04, -0.01), p(l - 0.04, 0.015), p(0.1, 0.015)], 1.44, 0.012, 2), mats.glass, 0, 0, 0, group, false);
  }
  addMesh(roundProfile('isoSideGlass', [
    [0.74, 1.76], [1.5, 1.76], [1.43, 2.04], { p: [1.36, 2.09], q: [1.42, 2.09] }, [0.8, 2.09], { p: [0.74, 2.03], q: [0.74, 2.09] },
  ], 1.68, 0.006, 1, 4), mats.glass, 0, 0, 0, group, false);
  // Nose: a tubular chrome bull bar + headlights.
  for (const y of [1.0, 1.3]) addMesh(turnedZ(`isoBar${y}`, [[0, -0.95], [0.04, -0.948], [0.06, -0.93], [0.06, 0.93], [0.04, 0.948], [0, 0.95]], 12).clone().rotateY(Math.PI / 2), mats.chrome, 0, y, 1.86, group);
  for (const sx of [-1, 1]) addMesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 10), mats.chrome, sx * 0.72, 1.14, 1.86, group);
  for (const sx of [-1, 1]) {
    addMesh(new THREE.BoxGeometry(0.3, 0.16, 0.06), mats.head, sx * 0.62, 1.4, 1.79, group, false);
    addMesh(rblock(0.4, 0.24, 0.07, 0.035), mats.dark, sx * 0.62, 1.4, 1.765, group); // light housing
  }
  // Radiator grille between the lights: a dark recess with chrome slats.
  addMesh(rblock(0.6, 0.3, 0.04, 0.02), mats.dark, 0, 1.38, 1.79, group);
  for (let i = 0; i < 4; i++) addMesh(new THREE.BoxGeometry(0.54, 0.03, 0.03), mats.chrome, 0, 1.28 + i * 0.065, 1.81, group);
  // Sprayer boom: a pipe from the reactor over the cab roof down to the nozzle mount over the nose.
  const pipeGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 8);
  const pipe = (x: number, y: number, z: number, len: number, rx: number) => {
    const m = addMesh(pipeGeo, lead, x, y, z, group);
    m.scale.y = len;
    m.rotation.x = rx;
  };
  pipe(0.62, 2.0, 0.0, 1.3, Math.PI / 2 - 0.25);
  pipe(0.62, 2.35, 1.0, 1.1, Math.PI / 2);
  pipe(0.62, 1.95, 1.75, 0.9, 0.55);
  addMesh(rblock(0.34, 0.22, 0.3, 0.06), mats.dark, 0.3, 1.5, 2.05, group);
  // Reactor capsule on the bed: lead shell, end domes, a glowing window band, heavy hoop ribs, cradle.
  // (One turned capsule: the shell and its two elliptical end domes, smooth.)
  {
    const pts: [number, number][] = [];
    const D = TANK_R * 0.45;
    for (let i = 0; i <= 7; i++) {
      const a = (i / 7) * (Math.PI / 2);
      pts.push([TANK_R * Math.sin(a), -TANK_L / 2 - D * Math.cos(a)]);
    }
    for (let i = 7; i >= 0; i--) {
      const a = (i / 7) * (Math.PI / 2);
      pts.push([TANK_R * Math.sin(a), TANK_L / 2 + D * Math.cos(a)]);
    }
    addMesh(turnedZ('isoTank', pts, 20), lead, 0, TANK_Y, TANK_Z, group);
  }
  for (const z of [-0.55, 0.15]) {
    const band = addMesh(new THREE.CylinderGeometry(TANK_R + 0.015, TANK_R + 0.015, 0.34, 20), coreMat, 0, TANK_Y, TANK_Z + z, group, false);
    band.rotation.x = Math.PI / 2;
  }
  const ribGeo = new THREE.TorusGeometry(TANK_R + 0.04, 0.07, 6, 20);
  for (const z of [-1.0, -0.2, 0.5]) {
    const rib = addMesh(ribGeo, mats.trim, 0, TANK_Y, TANK_Z + z * 0.95, group);
    rib.rotation.y = 0;
  }
  for (const z of [-0.6, 0.3]) {
    // Saddle: a cradle with round shoulders, its top cut to the tank's curve.
    addMesh(roundProfile('isoSaddle', [
      [-0.76, 1.04], [0.76, 1.04], [0.76, 1.28], { p: [0.66, 1.355], q: [0.76, 1.355] }, ...arcPts(0, TANK_Y, TANK_R + 0.03, -22, -48, 4),
      [-0.46, 1.1], ...arcPts(0, TANK_Y, TANK_R + 0.03, -132, -158, 4), { p: [-0.76, 1.28], q: [-0.76, 1.355] },
    ], 0.22, 0.04, 2, 4).clone().rotateY(Math.PI / 2), mats.dark, 0, 0, TANK_Z + z, group);
    // Clamp feet bolted to the deck either side of each cradle.
    for (const sx of [-1, 1]) {
      addMesh(kitBox(0.2, 0.06, 0.32, 0.015), lead, sx * 0.66, 1.06, TANK_Z + z, group);
      boltRow(group, lead, [sx * 0.66, 1.1, TANK_Z + z - 0.11], [sx * 0.66, 1.1, TANK_Z + z + 0.11], 2, [0, 0, 0], 0.026, true);
    }
  }
  // Trefoils on the tank flanks and the cab doors.
  const sign = new THREE.PlaneGeometry(0.55, 0.55);
  for (const sx of [-1, 1]) {
    const d = addMesh(sign, signMat, sx * (TANK_R + 0.02), TANK_Y, TANK_Z - 0.2, group, false);
    d.rotation.y = (sx * Math.PI) / 2;
    const door = addMesh(new THREE.PlaneGeometry(0.4, 0.4), signMat, sx * 0.96, 1.3, 1.2, group, false);
    door.rotation.y = (sx * Math.PI) / 2;
  }
  // Coolant hoses down the flanks of the tank to the deck.
  for (const sx of [-1, 1]) {
    const h = addMesh(new THREE.TorusGeometry(0.45, 0.05, 6, 12, Math.PI), mats.dark, sx * 0.74, 1.4, TANK_Z + 0.65, group);
    h.rotation.y = Math.PI / 2;
  }
  // Twin cooling stacks at the tail (waisted), a vent stack behind the cab (dash flame, Plow.exhaustTip).
  // (Turned: a flared foot, a waisted barrel and a rolled lip.)
  const stackGeo = turned('isoStack', [[0, 1.1], [0.3, 1.1], [0.29, 1.16], [0.25, 1.4], [0.205, 1.72], [0.2, 1.96], [0.215, 1.99], [0.2, 2.0], [0.17, 1.98], [0, 1.98]], 16);
  for (const sx of [-1, 1]) {
    addMesh(stackGeo, mats.trim, sx * 0.72, 0, -2.0, group);
    addMesh(turned('isoStackCap', [[0.17, 1.96], [0.225, 1.97], [0.235, 2.0], [0.225, 2.035], [0.16, 2.045], [0.12, 2.0]], 16), mats.dark, sx * 0.72, 0, -2.0, group);
  }
  addMesh(new THREE.CylinderGeometry(0.11, 0.13, 0.6, 10), mats.dark, 0.55, 2.05, 0.12, group);
  addMesh(new THREE.BoxGeometry(2.0, 0.2, 0.06), hazardMat, 0, 1.1, -2.12, group, false);
  // Rear bumper under the hazard bar, green reactor markers in dark housings either side.
  addMesh(rblock(2.0, 0.14, 0.16, 0.05), mats.dark, 0, 0.86, -2.06, group);
  for (const sx of [-1, 1]) {
    addMesh(rblock(0.22, 0.12, 0.06, 0.025), mats.dark, sx * 0.78, 0.86, -2.15, group);
    addMesh(new THREE.BoxGeometry(0.16, 0.06, 0.02), coreMat, sx * 0.78, 0.86, -2.185, group, false);
  }

  mergeStatic(group);
  group.add(...makeShadowProxy(group, group));

  // ---- Animated (after the merge so they stay separate; no shadows, the static proxy covers the body).
  // Control rods: three glowing rods bobbing out of the tank top, out of phase.
  const rods: THREE.Mesh[] = [];
  const rodGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.7, 8);
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(rodGeo, coreMat);
    r.position.set((i - 1) * 0.3, TANK_Y + TANK_R, TANK_Z - 0.35);
    group.add(r);
    rods.push(r);
  }
  // Rear vent fan: a trefoil-bladed rotor in a ring on the tank's tail dome.
  const fan = new THREE.Group();
  fan.position.set(0, TANK_Y, TANK_Z - TANK_L / 2 - TANK_R * 0.45 - 0.05);
  const bladeGeo = new THREE.BoxGeometry(0.14, 0.42, 0.04);
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(bladeGeo, mats.trim);
    const a = (i / 3) * Math.PI * 2;
    b.position.set(Math.sin(a) * 0.22, Math.cos(a) * 0.22, 0);
    b.rotation.z = -a;
    fan.add(b);
  }
  fan.add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), coreMat));
  const fanRing = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.04, 6, 20), mats.dark);
  fanRing.position.copy(fan.position);
  group.add(fan, fanRing);
  // Nozzle: a swivelling sprayer head over the nose (glowing tip), plus a hazard beacon spinning on the cab roof.
  const nozzle = new THREE.Group();
  nozzle.position.set(0.3, 1.62, 2.05);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 0.5, 10), mats.chrome);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.22;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), coreMat);
  tip.position.z = 0.5;
  nozzle.add(barrel, tip);
  group.add(nozzle);
  const beacon = new THREE.Group();
  beacon.position.set(-0.45, 2.36, 1.05);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.1), coreMat);
  beacon.add(lamp, new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.14, 8), mats.dark));
  group.add(beacon);
  for (const m of [...rods, fanRing, lamp, barrel, tip]) m.frustumCulled = false;
  const shellUp = TANK_Y + TANK_R;
  lamp.onBeforeRender = () => {
    const t = performance.now() * 0.001;
    for (let i = 0; i < 3; i++) rods[i].position.y = shellUp + 0.05 + 0.18 * Math.max(0, Math.sin(t * 2.2 + i * 2.1));
    fan.rotation.z = t * 7;
    beacon.rotation.y = t * 5;
    nozzle.rotation.y = Math.sin(t * 1.3) * 0.12;
  };
  return { group, parts: { coreMat } };
}
