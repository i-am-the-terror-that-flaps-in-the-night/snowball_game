import * as THREE from 'three';
import { hazardTexture } from '../plowModels';
import { mergeStatic } from '../../render/mergeStatic';
import { makeShadowProxy } from '../../render/shadowProxy';
import { addMesh, type VehicleBuild, type VehicleBuildIn } from './types';

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
 *  no Plow hooks, no allocation, nothing while hidden). */
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
  addMesh(new THREE.BoxGeometry(2.05, 0.26, 3.1), mats.dark, 0, 0.92, -0.55, group);
  for (const sx of [-1, 1]) {
    addMesh(new THREE.BoxGeometry(0.08, 0.26, 3.0), hazardMat, sx * 1.04, 0.92, -0.55, group, false);
    addMesh(new THREE.BoxGeometry(0.12, 0.34, 2.2), lead, sx * 1.02, 1.2, -0.8, group);
  }
  // Wheel arches.
  for (const [x, z] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.25], [0.95, -1.25]] as const) addMesh(new THREE.BoxGeometry(0.5, 0.1, 1.1), mats.dark, x, 1.04, z, group);
  // Cab: stubby, armoured, sloped visor, yellow roof bar.
  addMesh(new THREE.BoxGeometry(1.9, 0.62, 1.15), mats.paint, 0, 1.3, 1.2, group);
  addMesh(new THREE.BoxGeometry(1.66, 0.62, 0.95), mats.paint, 0, 1.88, 1.05, group);
  addMesh(new THREE.BoxGeometry(1.74, 0.1, 1.02), mats.trim, 0, 2.23, 1.05, group);
  const visor = addMesh(new THREE.BoxGeometry(1.46, 0.36, 0.06), mats.glass, 0, 1.95, 1.54, group, false);
  visor.rotation.x = -0.35;
  for (const sx of [-1, 1]) addMesh(new THREE.BoxGeometry(0.06, 0.32, 0.6), mats.glass, sx * 0.84, 1.92, 1.05, group, false);
  // Nose: bull bar + headlights.
  addMesh(new THREE.BoxGeometry(1.9, 0.12, 0.12), mats.chrome, 0, 1.0, 1.84, group);
  addMesh(new THREE.BoxGeometry(1.9, 0.12, 0.12), mats.chrome, 0, 1.3, 1.84, group);
  for (const sx of [-1, 1]) addMesh(new THREE.BoxGeometry(0.3, 0.16, 0.06), mats.head, sx * 0.66, 1.42, 1.79, group, false);
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
  addMesh(new THREE.BoxGeometry(0.34, 0.22, 0.3), mats.dark, 0.3, 1.5, 2.05, group);
  // Reactor capsule on the bed: lead shell, end domes, a glowing window band, heavy hoop ribs, cradle.
  const shell = addMesh(new THREE.CylinderGeometry(TANK_R, TANK_R, TANK_L, 20), lead, 0, TANK_Y, TANK_Z, group);
  shell.rotation.x = Math.PI / 2;
  for (const s of [-1, 1]) {
    const dome = addMesh(new THREE.SphereGeometry(TANK_R, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), lead, 0, TANK_Y, TANK_Z + (s * TANK_L) / 2, group);
    dome.rotation.x = (s * Math.PI) / 2;
    dome.scale.y = 0.45;
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
  for (const z of [-0.6, 0.3]) addMesh(new THREE.BoxGeometry(1.5, 0.3, 0.22), mats.dark, 0, 1.15, TANK_Z + z, group);
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
  const stackGeo = new THREE.CylinderGeometry(0.2, 0.28, 0.9, 12, 1, true);
  for (const sx of [-1, 1]) {
    addMesh(stackGeo, mats.trim, sx * 0.72, 1.55, -2.0, group);
    addMesh(new THREE.CylinderGeometry(0.22, 0.2, 0.08, 12), mats.dark, sx * 0.72, 2.0, -2.0, group);
  }
  addMesh(new THREE.CylinderGeometry(0.11, 0.13, 0.6, 10), mats.dark, 0.55, 2.05, 0.12, group);
  addMesh(new THREE.BoxGeometry(2.0, 0.2, 0.06), hazardMat, 0, 1.1, -2.12, group, false);

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
