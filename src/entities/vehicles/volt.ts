import * as THREE from 'three';
import { PLOW_WHEEL_R } from '../plowModels';
import { mergeStatic } from '../../render/mergeStatic';
import { makeShadowProxy } from '../../render/shadowProxy';
import { addMesh, type VehicleBuild, type VehicleBuildIn } from './types';

/** VOLT-9 / TESLA ROVER animatable parts. */
export interface VoltVehicleParts {
  /** Empty markers at the outrigger coil tops (lightning arc endpoints; Plow.coilTops). */
  coilTops: THREE.Object3D[];
  /** Under-glow light-bar material (pulsed by the Plow). */
  underglowMat: THREE.MeshBasicMaterial;
}

/** Top of the tower orb above the ground (combat/volt.ts TOWER_Y arcs from here). */
export const TESLA_TOWER_TOP = 3.15;

/* TESLA ROVER: a low, wide electric rover with no blade. A tall Tesla coil tower stands mid-deck (stacked glowing
 * rings on a tapered column, a big orb on top, a spinning corona ring + an orbiting spark collar), two short
 * outrigger coils over the rear wheels (the Plow arcs between them), battery cells along the flanks, a small
 * forward cockpit pod and a sensor dish on the nose. The moving parts animate themselves from the clock in
 * onBeforeRender (no Plow hooks, no allocation), so they cost nothing while the vehicle is hidden. */
export function buildVoltVehicle({ mats, chassis }: VehicleBuildIn): VehicleBuild<VoltVehicleParts> {
  const group = new THREE.Group();
  const carbon = new THREE.MeshStandardMaterial({ color: 0x14171f, roughness: 0.35, metalness: 0.6 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.4, metalness: 0.75 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0d3a5c, roughness: 0.05, metalness: 0.8, emissive: 0x0a5c9a, emissiveIntensity: 0.6 });

  addMesh(chassis, mats.dark, 0, 0.62, 0.05, group);
  // Low, wide deck: a flat slab with chamfered side skirts and a sloped nose.
  addMesh(new THREE.BoxGeometry(2.05, 0.32, 3.1), mats.paint, 0, 0.95, -0.35, group);
  const nose = addMesh(new THREE.BoxGeometry(1.9, 0.26, 1.2), mats.paint, 0, 0.9, 1.65, group);
  nose.rotation.x = 0.28;
  for (const x of [-1, 1]) {
    const skirt = addMesh(new THREE.BoxGeometry(0.18, 0.24, 3.6), mats.trim, x * 1.08, 0.86, 0.0, group);
    skirt.rotation.z = x * 0.35;
    // Wheel-arch fenders.
    for (const z of [1.35, -1.25]) addMesh(new THREE.BoxGeometry(0.52, 0.07, 1.1), carbon, x * 1.0, PLOW_WHEEL_R * 2 + 0.1, z, group);
    // Battery cells along the flanks with glowing bands.
    for (let i = 0; i < 3; i++) {
      const z = 0.55 - i * 0.62;
      const cell = addMesh(new THREE.CylinderGeometry(0.17, 0.17, 0.55, 12), mats.trim, x * 0.82, 1.27, z, group);
      cell.rotation.x = Math.PI / 2;
      const band = addMesh(new THREE.CylinderGeometry(0.18, 0.18, 0.07, 12), mats.coil, x * 0.82, 1.27, z, group, false);
      band.rotation.x = Math.PI / 2;
    }
  }
  // Headlight bar, front bumper, tail bar, diffuser.
  addMesh(new THREE.BoxGeometry(1.95, 0.18, 0.2), carbon, 0, 0.66, 2.15, group);
  addMesh(new THREE.BoxGeometry(1.6, 0.06, 0.06), mats.coil, 0, 0.8, 2.26, group, false);
  addMesh(new THREE.BoxGeometry(0.22, 0.12, 0.05), mats.head, -0.72, 0.68, 2.27, group, false);
  addMesh(new THREE.BoxGeometry(0.22, 0.12, 0.05), mats.head, 0.72, 0.68, 2.27, group, false);
  addMesh(new THREE.BoxGeometry(2.0, 0.07, 0.06), mats.coil, 0, 1.0, -1.93, group, false);
  addMesh(new THREE.BoxGeometry(2.0, 0.16, 0.25), carbon, 0, 0.7, -1.95, group);
  // Forward cockpit pod (offset left) with a glass bubble.
  addMesh(new THREE.BoxGeometry(0.8, 0.3, 0.9), mats.paint, -0.42, 1.26, 1.05, group);
  const bubble = addMesh(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass, -0.42, 1.4, 1.08, group, false);
  bubble.scale.set(0.36, 0.34, 0.46);
  // Sensor dish on the nose (right): mast + tilted dish + feed.
  addMesh(new THREE.CylinderGeometry(0.04, 0.05, 0.4, 8), steel, 0.5, 1.3, 1.25, group);

  // The Tesla tower, mid-deck: turntable, tapered column, five stacked rings (smaller going up), top orb.
  const towerZ = -0.35;
  addMesh(new THREE.CylinderGeometry(0.6, 0.7, 0.18, 20), steel, 0, 1.2, towerZ, group);
  addMesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 20), mats.coil, 0, 1.31, towerZ, group, false);
  addMesh(new THREE.CylinderGeometry(0.12, 0.28, 1.6, 12), carbon, 0, 2.05, towerZ, group);
  for (let i = 0; i < 5; i++) {
    const ring = addMesh(new THREE.TorusGeometry(0.42 - i * 0.055, 0.055, 8, 22), mats.coil, 0, 1.45 + i * 0.28, towerZ, group, false);
    ring.rotation.x = Math.PI / 2;
  }
  addMesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), steel, 0, 2.8, towerZ, group);
  addMesh(new THREE.SphereGeometry(0.34, 18, 12), mats.coil, 0, TESLA_TOWER_TOP, towerZ, group, false);
  // Four struts bracing the tower to the deck.
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const strut = addMesh(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 6), steel, Math.sin(a) * 0.38, 1.6, towerZ + Math.cos(a) * 0.38, group);
    strut.rotation.set(Math.cos(a) * -0.32, 0, Math.sin(a) * 0.32);
  }

  // Outrigger mini-coils over the rear wheels: the Plow arcs between their tops.
  const coilTops: THREE.Object3D[] = [];
  for (const x of [-0.82, 0.82]) {
    addMesh(new THREE.CylinderGeometry(0.13, 0.17, 0.26, 10), steel, x, 1.25, -1.45, group);
    for (let i = 0; i < 3; i++) {
      const ring = addMesh(new THREE.TorusGeometry(0.12 - i * 0.02, 0.035, 6, 14), mats.coil, x, 1.45 + i * 0.12, -1.45, group, false);
      ring.rotation.x = Math.PI / 2;
    }
    addMesh(new THREE.SphereGeometry(0.12, 12, 8), mats.coil, x, 1.86, -1.45, group, false);
    const top = new THREE.Object3D();
    top.position.set(x, 1.86, -1.45);
    group.add(top);
    coilTops.push(top);
    // Whip antenna behind each coil.
    addMesh(new THREE.CylinderGeometry(0.012, 0.02, 1.3, 5), carbon, x * 1.12, 1.75, -1.8, group, false);
  }

  // Underglow.
  const underGeo = new THREE.PlaneGeometry(2.6, 4.6);
  underGeo.rotateX(-Math.PI / 2);
  const underglowMat = new THREE.MeshBasicMaterial({ color: 0x2fb8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  addMesh(underGeo, underglowMat, 0, 0.08, 0.05, group, false);

  mergeStatic(group);
  group.add(...makeShadowProxy(group, group));

  // ---- Animated (added after the merge so they stay separate; no shadows so the static proxy covers the body).
  // Corona: a tilted halo ring that spins round the column, a wobbling spark collar of 6 beads near the orb, and the
  // dish sweeping side to side.
  const corona = new THREE.Group();
  corona.position.set(0, 2.35, towerZ);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.025, 6, 32), mats.coil);
  halo.rotation.x = Math.PI / 2 + 0.25;
  corona.add(halo);
  group.add(corona);
  const collar = new THREE.Group();
  collar.position.set(0, TESLA_TOWER_TOP - 0.05, towerZ);
  const beadGeo = new THREE.SphereGeometry(0.06, 8, 6);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const bead = new THREE.Mesh(beadGeo, mats.coil);
    bead.position.set(Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5);
    collar.add(bead);
  }
  group.add(collar);
  const sweep = new THREE.Group();
  sweep.position.set(0.5, 1.5, 1.32);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2.6), steel);
  dish.rotation.x = Math.PI / 2 + 0.5;
  sweep.add(dish);
  const feed = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mats.coil);
  feed.position.set(0, 0.12, 0.23);
  sweep.add(feed);
  group.add(sweep);
  // One clock drives all three from the halo's render callback (the halo is always in view when the rover is).
  halo.onBeforeRender = () => {
    const t = performance.now() * 0.001;
    corona.rotation.y = t * 2.6;
    corona.position.y = 2.35 + Math.sin(t * 1.7) * 0.25;
    collar.rotation.y = -t * 4.2;
    collar.rotation.z = Math.sin(t * 3.1) * 0.18;
    sweep.rotation.y = Math.sin(t * 0.9) * 0.7;
  };
  halo.frustumCulled = false;
  return { group, parts: { coilTops, underglowMat } };
}
