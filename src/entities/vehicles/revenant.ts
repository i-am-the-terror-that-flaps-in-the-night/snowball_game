import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mergeStatic } from '../../render/mergeStatic';
import { makeShadowProxy } from '../../render/shadowProxy';
import { addMesh, type VehicleBuild, type VehicleBuildIn } from './types';
import { rblock, roundProfile, sideUV, type ProfilePt } from './vehicleShapes';
import { buildWraithClaws, type ClawRigIn } from './revenantClaws';

/* REVENANT: a spectral reaper-car. A low, sleek void-black core (fixed colour, glowing seams) wears FLOATING armour
 * plates (the Paint Shop colour, so any paint reads as armour over the ghost), under a dark bubble canopy with ghost
 * faces drifting inside. Two wraith fins rise off the tail trailing tattered spectral ribbons; a halo hovers over the
 * roof (the toll beacon) and THE RELIQUARY, a soul cell between glowing emitter rings, floats behind it. It rolls on
 * HUBLESS spectral ring wheels. Two WRAITH CLAWS (vehicles/revenantClaws.ts) wait in glowing rifts on the hood: on
 * every Reap a long skeletal arm pours out and rakes the arc ahead with a taloned hand. Reshape (art pass): the core,
 * canopy, plates, ridge and fins are curved round-edged profiles (vehicleShapes.ts). PHASED: the opaque body fades
 * out for a scanline ghost shell with the bone-white skeletal frame inside. */

/** Spectral palette (solid colours with a dark edge read on bright snow AND at night; additive is only a top layer). */
export const REV_CORE = 0xb04dff;
export const REV_BRIGHT = 0xe0a8ff;
export const REV_DEEP = 0x4a1a7a;
export const REV_EDGE = 0x1a0630;
export const REV_BONE = 0xe8e0cc;

/** What the Plow feeds the REVENANT rig every frame (RevenantVehicleParts.update). */
export interface RevenantRigState {
  /** Ground speed along the nose (m/s, + forward). */
  speed: number;
  /** 0..1 Phase (body dissolved into the ghost shell). */
  phase: number;
  /** Souls in the Reliquary (0..10). */
  souls: number;
  /** Beacon tolls so far (each new one pulses a ring of light). */
  tolls: number;
  /** 0..1 Reap glow (signed by the sweep's side; decays): the seams flare. */
  reap: number;
  /** Wild Hunt running (spectral strips burn hot). */
  hunt: boolean;
  /** Reap reach (m, stats.reapReach): the claws' talons reach the end of the Reap arc. */
  reach?: number;
  /** Reap sweeps so far (a change starts a rake), the last one's side (+1 = the left / +x claw) and whether it was
   *  the big Reap (both claws). */
  reapN?: number;
  reapSide?: number;
  reapBig?: boolean;
  /** SPACE held (Reap running): the claws wait half out of their rifts between rakes. */
  reaping?: boolean;
  /** 0..1 through the wait before a big Reap (SPACE held): both claws rear back. */
  bigWind?: number;
  /** Garage / Paint Shop display: the claws raised. */
  display?: boolean;
}

export interface RevenantVehicleParts {
  /** Spectral strip-light glow (flickered by the rig). */
  stripMat: THREE.MeshStandardMaterial;
  /** Model-space anchors: the Reliquary capsule centre, the roof beacon, the two slit headlights. */
  reliquary: THREE.Object3D;
  beacon: THREE.Object3D;
  heads: THREE.Object3D[];
  /** Call once per frame while visible. */
  update(dt: number, s: RevenantRigState): void;
  /** Snap the claws to their parked display pose (the menu backdrop does not update the rig). */
  park(): void;
}

/** The Reliquary capsule: centre (model space), radius, length. Souls swirl inside it. */
const RELIC_Y = 2.55;
const RELIC_Z = -1.45;
const RELIC_R = 0.25;
const RELIC_L = 0.45;
export const RELIC_POS = new THREE.Vector3(0, RELIC_Y, RELIC_Z);
/** Roof toll beacon (front of the roof). */
export const BEACON_POS = new THREE.Vector3(0, 2.32, 0.15);
const SOULS_MAX = 10;
const WHEELS = [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.25], [0.95, -1.25]] as const;
const WHEEL_R = 0.48;
/** Hubless wheels sit a touch outboard of the plates. */
const WHEEL_X = 1.06;

/** Side profile (z, y) of the void core (extruded across the width): a long low wedge, nose down (reshape: a rolled
 *  bullet nose, a hood sweeping up in one convex curve, a rounded tail). */
const LOWER: readonly ProfilePt[] = [
  [-2.42, 0.6], [2.36, 0.6], { p: [2.78, 0.8], q: [2.76, 0.6] }, { p: [2.56, 1.0], q: [2.8, 0.99] }, { p: [1.15, 1.3], q: [1.75, 1.2] },
  { p: [-2.25, 1.36], q: [-0.6, 1.4] }, { p: [-2.62, 1.06], q: [-2.6, 1.36] }, { p: [-2.42, 0.6], q: [-2.66, 0.68] },
];
/** Bubble canopy profile (z, y): fast curved rake, a long low crown, the tail sweeping down to the deck. */
const UPPER: readonly ProfilePt[] = [
  [-2.15, 1.3], [1.15, 1.3], { p: [0.3, 1.93], q: [0.66, 1.86] }, { p: [-0.95, 1.99], q: [-0.3, 2.0] }, { p: [-2.15, 1.3], q: [-1.95, 1.9] },
];

/** The hull profiles as smooth, round-edged solids, uvs planar from the side (u = z, v = y: the PHASED shell's
 *  scanlines run level). */
function profileGeo(key: string, pts: readonly ProfilePt[], width: number, bevel: number): THREE.BufferGeometry {
  return sideUV(roundProfile(key, pts, width, bevel, 3, 10).clone());
}

const CORE_W = 1.6;
const CANOPY_W = 1.22;

/** Floating plates in side view (z, y): the front fender (top seam at 1.22 over the claw rifts, sweeping down to a
 *  point at the nose), the rear quarter (top rising toward the tail), each with its glowing top seam. */
const FENDER: readonly ProfilePt[] = [
  [0.95, 0.8], [1.75, 0.8], { p: [2.3, 0.92], q: [2.1, 0.8] }, { p: [1.6, 1.2], q: [2.0, 1.2] }, [1.02, 1.2], { p: [0.88, 1.05], q: [0.88, 1.2] },
];
const FENDER_SEAM: readonly ProfilePt[] = [[0.98, 1.2], [1.6, 1.2], { p: [2.3, 0.94], q: [2.02, 1.2] }, { p: [1.6, 1.235], q: [2.04, 1.235] }, [0.98, 1.235]];
const QUARTER: readonly ProfilePt[] = [
  [-2.25, 0.84], [-0.2, 0.84], { p: [-0.12, 0.98], q: [-0.12, 0.84] }, [-0.12, 1.14], { p: [-0.3, 1.25], q: [-0.12, 1.25] },
  { p: [-2.32, 1.3], q: [-1.6, 1.24] }, { p: [-2.25, 0.84], q: [-2.42, 0.9] },
];
const QUARTER_SEAM: readonly ProfilePt[] = [[-0.3, 1.25], { p: [-2.3, 1.3], q: [-1.6, 1.24] }, [-2.3, 1.335], { p: [-0.3, 1.285], q: [-1.6, 1.275] }];
/** Hood plate: a thin shell along the hood's convex line, from the canopy foot down to the visor. */
const HOOD_PLATE: readonly ProfilePt[] = [[1.32, 1.3], { p: [2.56, 1.03], q: [1.94, 1.175] }, [2.56, 1.055], { p: [1.32, 1.36], q: [1.94, 1.23] }];
const HOOD_SPINE: readonly ProfilePt[] = [[1.32, 1.33], { p: [2.56, 1.06], q: [1.94, 1.205] }, [2.56, 1.1], { p: [1.32, 1.37], q: [1.94, 1.245] }];
/** Dorsal ridge along the canopy crown and its seam. */
const RIDGE: readonly ProfilePt[] = [[0.5, 1.88], { p: [-0.95, 2.0], q: [-0.3, 2.01] }, { p: [-1.65, 1.82], q: [-1.45, 1.98] }, [-1.62, 1.92], { p: [-0.95, 2.08], q: [-1.4, 2.08] }, { p: [0.45, 1.95], q: [-0.3, 2.09] }];
const RIDGE_SEAM: readonly ProfilePt[] = [[0.42, 1.955], { p: [-0.95, 2.085], q: [-0.3, 2.095] }, { p: [-1.6, 1.93], q: [-1.4, 2.08] }, [-1.6, 1.955], { p: [-0.95, 2.105], q: [-1.4, 2.105] }, { p: [0.42, 1.98], q: [-0.3, 2.115] }];

let hullGeo: THREE.BufferGeometry | null = null;
/** The hearse's hull silhouette (lower wedge + greenhouse) as one geometry, cached: THE WILD HUNT's phantom riders
 *  (combat/revenantFx.ts) ride in it. */
export function revenantHullGeometry(): THREE.BufferGeometry {
  if (hullGeo) return hullGeo;
  const a = profileGeo('revLower', LOWER, CORE_W, 0.12);
  const b = profileGeo('revUpper', UPPER, CANOPY_W, 0.16);
  for (const g of [a, b]) g.deleteAttribute('uv');
  hullGeo = mergeGeometries([a, b]) ?? a;
  return hullGeo;
}

/* ---- canvas textures (cached; null without a DOM, e.g. headless tests) */
let ghostTex: THREE.CanvasTexture | null | undefined;
/** A faint wailing face for the windows (soft white-violet on transparent). */
function ghostFace(): THREE.CanvasTexture | null {
  if (ghostTex !== undefined) return ghostTex;
  if (typeof document === 'undefined') return (ghostTex = null);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 26, 2, 32, 30, 30);
  grd.addColorStop(0, 'rgba(240,220,255,0.95)');
  grd.addColorStop(0.55, 'rgba(200,150,255,0.55)');
  grd.addColorStop(1, 'rgba(160,90,255,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.ellipse(32, 30, 18, 26, 0, 0, Math.PI * 2);
  g.fill();
  // hollow eyes and an open mouth
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = 'rgba(0,0,0,0.9)';
  for (const ex of [24, 40]) {
    g.beginPath();
    g.ellipse(ex, 24, 4, 6, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  g.ellipse(32, 41, 4, 7, 0, 0, Math.PI * 2);
  g.fill();
  ghostTex = new THREE.CanvasTexture(c);
  ghostTex.colorSpace = THREE.SRGBColorSpace;
  return ghostTex;
}

let scanTex: THREE.CanvasTexture | null | undefined;
/** Horizontal scanlines (alpha) for the PHASED ghost shell; the rig scrolls it. */
function scanlines(): THREE.CanvasTexture | null {
  if (scanTex !== undefined) return scanTex;
  if (typeof document === 'undefined') return (scanTex = null);
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 64; y++) {
    const a = y % 4 < 2 ? 0.95 : 0.25 + 0.2 * Math.abs(Math.sin(y * 1.7));
    g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    g.fillRect(0, y, 4, 1);
  }
  scanTex = new THREE.CanvasTexture(c);
  scanTex.wrapS = scanTex.wrapT = THREE.RepeatWrapping;
  scanTex.repeat.set(1, 6);
  return scanTex;
}

/** Cheap deterministic flicker (sum of sines): 0..1, flame-like. */
const flick = (t: number, k: number) => 0.5 + 0.22 * Math.sin(t * 13.1 + k) + 0.17 * Math.sin(t * 29.3 + k * 2.3) + 0.11 * Math.sin(t * 47.9 + k * 5.1);

export function buildRevenantVehicle({ mats }: VehicleBuildIn): VehicleBuild<RevenantVehicleParts> {
  const group = new THREE.Group();
  const hull = new THREE.Group();
  group.add(hull);
  const stripMat = new THREE.MeshStandardMaterial({ color: REV_CORE, emissive: REV_CORE, emissiveIntensity: 1.6, roughness: 0.4 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: REV_EDGE, roughness: 0.6, metalness: 0.3 });
  const bone = new THREE.MeshStandardMaterial({ color: REV_BONE, roughness: 0.55, metalness: 0.15 });
  // The void core: a fixed near-black violet (never repainted) with a faint inner glow, so every Paint Shop colour on
  // the floating plates reads as armour over the ghost.
  const voidMat = new THREE.MeshStandardMaterial({ color: 0x140a22, roughness: 0.35, metalness: 0.55, emissive: 0x2a0c4a, emissiveIntensity: 0.35 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x15141d, roughness: 0.08, metalness: 0.75, emissive: 0x24103e, emissiveIntensity: 0.3 });
  const slitMat = new THREE.MeshStandardMaterial({ color: REV_BRIGHT, emissive: REV_CORE, emissiveIntensity: 2.4 });
  const edgeGlow = new THREE.MeshBasicMaterial({ color: REV_BRIGHT, toneMapped: false });

  // ---- Void core + bubble canopy.
  const lowerGeo = profileGeo('revLower', LOWER, CORE_W, 0.12);
  const upperGeo = profileGeo('revUpper', UPPER, CANOPY_W, 0.16);
  addMesh(lowerGeo, voidMat, 0, 0, 0, hull);
  addMesh(upperGeo, glass, 0, 0, 0, hull);
  /** A pivot group under the hull at (x, y), rolled rz about z (a plate's own frame). */
  const cant = (x: number, y: number, rz: number) => {
    const g = new THREE.Group();
    g.position.set(x, y, 0);
    g.rotation.z = rz;
    hull.add(g);
    return g;
  };
  // ---- Floating armour plates (Paint Shop body colour), each standing a hand off the core with a glowing seam
  // showing in the gap.
  for (const sx of [-1, 1]) {
    // Front fender plate and the long rear quarter plate, canted out a little, with a gap between them. (Reshape:
    // curved blades in side view, the fender sweeping down to a point at the nose, the quarter rising to a kick over
    // the tail; their glowing top seams follow the same curves.)
    // (Each canted about its own middle height, like the old flat plates.)
    const fr = cant(sx * 0.9, 1.0, sx * 0.14);
    addMesh(roundProfile('revFender', FENDER, 0.07, 0.03, 3, 8), mats.paint, 0, -1.0, 0, fr);
    const rq = cant(sx * 0.9, 1.04, sx * 0.14);
    addMesh(roundProfile('revQuarter', QUARTER, 0.07, 0.03, 3, 8), mats.paint, 0, -1.04, 0, rq);
    // Shoulder plates over the quarters (trim colour), angled up toward the canopy.
    const sh = addMesh(rblock(0.34, 0.06, 2.0, 0.03), mats.trim, sx * 0.72, 1.4, -1.15, hull);
    sh.rotation.z = sx * -0.32;
    // Glowing seams: along the plates' top edges and down the gap between them.
    addMesh(roundProfile('revFenderSeam', FENDER_SEAM, 0.035, 0, 1, 8), stripMat, 0, -1.0, 0, fr, false);
    addMesh(roundProfile('revQuarterSeam', QUARTER_SEAM, 0.035, 0, 1, 8), stripMat, 0, -1.04, 0, rq, false);
    addMesh(new THREE.BoxGeometry(0.035, 0.5, 0.035), stripMat, sx * 0.84, 1.02, 0.6, hull, false);
    // Underbody seam (the core's beltline).
    addMesh(new THREE.BoxGeometry(0.03, 0.03, 4.6), stripMat, sx * 0.81, 0.7, 0.05, hull, false);
    // Canopy base seam.
    addMesh(new THREE.BoxGeometry(0.03, 0.03, 3.1), stripMat, sx * (CANOPY_W / 2 + 0.01), 1.33, -0.5, hull, false);
  }
  // Nose plate (paint) sweeping down over the hood to the visor (curved to the hood's line), split down the middle
  // by a glowing spine.
  for (const sx of [-1, 1]) {
    addMesh(roundProfile('revHoodPlate', HOOD_PLATE, 0.66, 0.03, 3, 8), mats.paint, 0, -1.17, 0, cant(sx * 0.38, 1.17, sx * -0.08));
  }
  addMesh(roundProfile('revSpine', HOOD_SPINE, 0.04, 0, 1, 8), stripMat, 0, 0, 0, hull, false);
  // Visor: a black slot across the nose with the two slit headlights and a fanged lower grille.
  addMesh(new THREE.BoxGeometry(1.5, 0.14, 0.06), voidMat, 0, 0.92, 2.68, hull, false);
  for (const sx of [-1, 1]) {
    const head = addMesh(new THREE.BoxGeometry(0.46, 0.045, 0.05), slitMat, sx * 0.48, 0.94, 2.72, hull, false);
    head.rotation.z = sx * 0.12;
  }
  for (let k = -2; k <= 2; k++) {
    const fang = addMesh(new THREE.ConeGeometry(0.035, 0.16, 4), edgeGlow, k * 0.16, 0.74, 2.74, hull, false);
    fang.rotation.x = Math.PI;
  }
  // Dorsal ridge along the canopy crown (trim) with a seam.
  addMesh(roundProfile('revRidge', RIDGE, 0.06, 0.02, 2, 8), mats.trim, 0, 0, 0, hull);
  addMesh(roundProfile('revRidgeSeam', RIDGE_SEAM, 0.025, 0, 1, 8), stripMat, 0, 0, 0, hull, false);
  // Wraith fins rising off the tail (trim), canted out, edged in glow.
  // (Reshape: round-edged, so the blade catches a highlight along its rim.)
  const finGeo = roundProfile('revFin', [
    [-1.55, 1.3], [-2.45, 1.3], { p: [-3.05, 2.5], q: [-2.8, 1.8] }, { p: [-1.55, 1.3], q: [-2.45, 2.05] },
  ], 0.06, 0.022, 3, 8);
  const finEdge = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 1.3, -1.55), new THREE.Vector3(0, 2.05, -2.45), new THREE.Vector3(0, 2.5, -3.05));
  const finEdgeGeo = new THREE.TubeGeometry(finEdge, 12, 0.03, 4, false);
  const finTips: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) {
    const fin = new THREE.Group();
    fin.position.x = sx * 0.62;
    fin.rotation.z = sx * -0.28;
    hull.add(fin);
    addMesh(finGeo, mats.trim, 0, 0, 0, fin);
    addMesh(finEdgeGeo, edgeGlow, 0, 0, 0, fin, false);
    fin.updateMatrix();
    finTips.push(new THREE.Vector3(0, 2.45, -3.0).applyMatrix4(fin.matrix));
  }
  // Tail light bar.
  addMesh(new THREE.BoxGeometry(1.3, 0.05, 0.035), stripMat, 0, 1.12, -2.64, hull, false);
  // Reliquary cradle: two slim void arms reaching up from the canopy.
  for (const sx of [-1, 1]) {
    const arm = addMesh(new THREE.BoxGeometry(0.06, 0.62, 0.1), voidMat, sx * 0.3, 2.05, RELIC_Z, hull);
    arm.rotation.z = sx * -0.45;
  }

  // ---- Skeletal chassis (inside the core; shows through the PHASED ghost shell), bone white.
  const skel = new THREE.Group();
  for (const sx of [-1, 1]) {
    addMesh(new THREE.BoxGeometry(0.08, 0.08, 4.6), bone, sx * 0.55, 0.86, 0.05, skel, false);
    addMesh(new THREE.BoxGeometry(0.07, 0.07, 3.0), bone, sx * 0.5, 1.85, -0.55, skel, false);
  }
  addMesh(new THREE.BoxGeometry(0.1, 0.1, 4.0), bone, 0, 1.3, -0.2, skel, false);
  for (const z of [-1.9, -1.2, -0.5, 0.2, 0.9]) {
    const rib = addMesh(new THREE.TorusGeometry(0.55, 0.04, 4, 12, Math.PI), bone, 0, 1.3, z, skel, false);
    rib.scale.set(1, 0.95, 1);
  }
  addMesh(new THREE.SphereGeometry(0.26, 10, 8), bone, 0, 1.12, 1.8, skel, false);
  for (const sx of [-1, 1]) addMesh(new THREE.SphereGeometry(0.07, 6, 4), edgeMat, sx * 0.1, 1.15, 2.03, skel, false);
  group.add(skel);

  mergeStatic(hull);
  mergeStatic(skel);
  group.add(...makeShadowProxy(hull, group));

  // ---- PHASED ghost shell: the core + canopy silhouette as translucent scanlined spectral glass.
  const scan = scanlines();
  const shellMat = new THREE.MeshBasicMaterial({ color: REV_CORE, map: scan, alphaMap: scan, transparent: true, opacity: 0.0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const rimMat = new THREE.MeshBasicMaterial({ color: REV_EDGE, transparent: true, opacity: 0, depthWrite: false, side: THREE.BackSide });
  const shell = new THREE.Group();
  for (const geo of [lowerGeo, upperGeo]) {
    shell.add(new THREE.Mesh(geo, shellMat));
    const rim = new THREE.Mesh(geo, rimMat);
    rim.scale.setScalar(1.05);
    rim.position.y = -0.03;
    shell.add(rim);
  }
  shell.visible = false;
  group.add(shell);

  // ---- Hubless spectral wheels: a black tyre ring round a glowing inner rim with three bright teeth (so the spin
  // reads), and a rune ring drifting outboard.
  const tyreGeo = new THREE.TorusGeometry(WHEEL_R - 0.09, 0.1, 8, 28).rotateY(Math.PI / 2);
  const rimGeo = new THREE.TorusGeometry(WHEEL_R - 0.21, 0.03, 4, 28).rotateY(Math.PI / 2);
  const toothGeo = new THREE.BoxGeometry(0.05, 0.16, 0.05);
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x120d18, roughness: 0.8, metalness: 0.2 });
  const runeGeo = new THREE.TorusGeometry(WHEEL_R + 0.06, 0.02, 4, 28);
  const runeMat = new THREE.MeshBasicMaterial({ color: REV_BRIGHT, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });
  const spokes: THREE.Group[] = [];
  const runes: THREE.Mesh[] = [];
  for (const [x, z] of WHEELS) {
    const sx = Math.sign(x);
    const w = new THREE.Group();
    w.position.set(sx * WHEEL_X, WHEEL_R, z);
    const tyre = new THREE.Mesh(tyreGeo, tyreMat);
    tyre.castShadow = true;
    w.add(tyre, new THREE.Mesh(rimGeo, stripMat));
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const t = new THREE.Mesh(toothGeo, edgeGlow);
      t.position.set(0, Math.cos(a) * (WHEEL_R - 0.21), Math.sin(a) * (WHEEL_R - 0.21));
      t.rotation.x = -a;
      w.add(t);
    }
    group.add(w);
    spokes.push(w);
    const r = new THREE.Mesh(runeGeo, runeMat);
    r.position.set(sx * (WHEEL_X + 0.14), WHEEL_R, z);
    r.rotation.y = Math.PI / 2;
    group.add(r);
    runes.push(r);
  }

  // ---- WRAITH CLAWS: the Reap's two spectral arms in their hood rifts.
  const claws = buildWraithClaws();
  group.add(claws.group);

  // Slit headlight anchors (the Plow spills ghostfire from them).
  const heads = [-1, 1].map((sx) => {
    const o = new THREE.Object3D();
    o.position.set(sx * 0.48, 0.94, 2.78);
    group.add(o);
    return o;
  });
  // Toll beacon: a halo hovering over the canopy crown round a violet lamp, and the ring of light each toll throws.
  const beacon = new THREE.Group();
  beacon.position.copy(BEACON_POS);
  const lampMat = new THREE.MeshStandardMaterial({ color: REV_BRIGHT, emissive: REV_CORE, emissiveIntensity: 1.5, roughness: 0.3 });
  const lamp = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), lampMat);
  lamp.position.y = 0.08;
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 6, 32), lampMat);
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.12;
  const haloRim = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.06, 4, 32), edgeMat);
  haloRim.rotation.x = Math.PI / 2;
  haloRim.position.y = 0.1;
  beacon.add(lamp, halo, haloRim);
  group.add(beacon);
  const tollMat = new THREE.MeshBasicMaterial({ color: REV_BRIGHT, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const tollEdge = new THREE.MeshBasicMaterial({ color: REV_DEEP, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const tollGeo = new THREE.RingGeometry(0.86, 1, 48);
  tollGeo.rotateX(-Math.PI / 2);
  const tollRing = new THREE.Mesh(tollGeo, tollMat);
  const tollRim = new THREE.Mesh(new THREE.RingGeometry(0.78, 0.87, 48).rotateX(-Math.PI / 2), tollEdge);
  tollRing.add(tollRim);
  tollRing.position.copy(BEACON_POS);
  tollRing.visible = false;
  group.add(tollRing);
  // THE RELIQUARY: a soul cell between two glowing emitter rings, floating over the tail; souls swirl inside it.
  const reliquary = new THREE.Group();
  reliquary.position.copy(RELIC_POS);
  const capsuleMat = new THREE.MeshStandardMaterial({ color: 0x6a3cb0, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.42, depthWrite: false, emissive: REV_DEEP, emissiveIntensity: 0.6 });
  const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(RELIC_R, RELIC_L, 6, 14), capsuleMat);
  capsule.renderOrder = 2;
  const capGeo = new THREE.CylinderGeometry(RELIC_R * 0.75, RELIC_R * 1.1, 0.1, 14);
  const capTop = new THREE.Mesh(capGeo, voidMat);
  capTop.position.y = RELIC_L / 2 + RELIC_R * 0.6;
  capTop.rotation.x = Math.PI;
  const capBot = new THREE.Mesh(capGeo, voidMat);
  capBot.position.y = -RELIC_L / 2 - RELIC_R * 0.6;
  const ringGeo = new THREE.TorusGeometry(RELIC_R + 0.06, 0.03, 4, 20);
  const ringTop = new THREE.Mesh(ringGeo, stripMat);
  ringTop.rotation.x = Math.PI / 2;
  ringTop.position.y = capTop.position.y;
  const ringBot = new THREE.Mesh(ringGeo, stripMat);
  ringBot.rotation.x = Math.PI / 2;
  ringBot.position.y = capBot.position.y;
  reliquary.add(capsule, capTop, capBot, ringTop, ringBot);
  const soulGeo = new THREE.SphereGeometry(0.075, 8, 6);
  soulGeo.scale(1, 1.9, 1);
  const soulCore = new THREE.MeshBasicMaterial({ color: 0xc89cff, toneMapped: false });
  const soulShell = new THREE.MeshBasicMaterial({ color: REV_CORE, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
  const souls: THREE.Mesh[] = [];
  for (let i = 0; i < SOULS_MAX; i++) {
    const m = new THREE.Mesh(soulGeo, soulCore);
    const h = new THREE.Mesh(soulGeo, soulShell);
    h.scale.setScalar(1.9);
    m.add(h);
    m.visible = false;
    reliquary.add(m);
    souls.push(m);
  }
  // Ghostfire wisp under the cell.
  const fireGeo = new THREE.ConeGeometry(0.22, 0.45, 10, 1, true);
  fireGeo.rotateX(Math.PI);
  const fireDeep = new THREE.MeshBasicMaterial({ color: REV_CORE, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const fireHot = new THREE.MeshBasicMaterial({ color: REV_CORE, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const fire = new THREE.Group();
  const f2 = new THREE.Mesh(fireGeo, fireHot);
  f2.scale.set(0.55, 0.8, 0.55);
  fire.add(new THREE.Mesh(fireGeo, fireDeep), f2);
  fire.position.set(0, -RELIC_L / 2 - RELIC_R - 0.12, 0);
  reliquary.add(fire);
  group.add(reliquary);
  // Canopy ghosts: faint faces drifting along inside the bubble.
  const gtex = ghostFace();
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0xf0e0ff, map: gtex, transparent: true, opacity: gtex ? 0.55 : 0, depthWrite: false, toneMapped: false });
  const ghosts: THREE.Mesh[] = [];
  const ghostGeo = new THREE.PlaneGeometry(0.3, 0.38);
  for (let i = 0; i < 4; i++) {
    const sx = i < 2 ? 1 : -1;
    const g = new THREE.Mesh(ghostGeo, ghostMat);
    g.position.set(sx * (CANOPY_W / 2 + 0.01), 1.6, -0.5);
    g.rotation.y = (sx * Math.PI) / 2;
    group.add(g);
    ghosts.push(g);
  }
  // Spectral ribbons: tattered streamers trailing off the fin tips and the tail (vertex-animated each frame), solid
  // violet fading to nothing, so they read on snow and at night.
  const RIB_SEG = 10;
  const RIB_LEN = 1.9;
  const ribMat = new THREE.MeshBasicMaterial({ color: REV_CORE, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const ribRoots = [finTips[0], finTips[1], new THREE.Vector3(-0.35, 1.25, -2.62), new THREE.Vector3(0.35, 1.25, -2.62)];
  const ribWidth = [0.42, 0.42, 0.32, 0.32];
  const ribbons: THREE.Mesh[] = [];
  for (let r = 0; r < ribRoots.length; r++) {
    const g = new THREE.BufferGeometry();
    const n = (RIB_SEG + 1) * 2;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const col = new Float32Array(n * 4);
    for (let j = 0; j <= RIB_SEG; j++) {
      const a = 0.95 * (1 - j / RIB_SEG) ** 0.8;
      const v = 1 - 0.55 * (j / RIB_SEG);
      col.set([v, v, v, a, v, v, v, a], j * 8);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    const idx: number[] = [];
    for (let j = 0; j < RIB_SEG; j++) {
      const q = j * 2;
      idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
    }
    g.setIndex(idx);
    const m = new THREE.Mesh(g, ribMat);
    m.renderOrder = 2;
    group.add(m);
    ribbons.push(m);
  }
  // Purple mist underglow.
  const mistMat = new THREE.MeshBasicMaterial({ color: REV_CORE, transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false });
  const mistGeo = new THREE.CircleGeometry(1, 24);
  mistGeo.rotateX(-Math.PI / 2);
  const mist = new THREE.Mesh(mistGeo, mistMat);
  mist.scale.set(1.35, 1, 2.9);
  mist.position.y = 0.06;
  mist.renderOrder = 1;
  group.add(mist);
  for (const o of [...spokes, ...runes, ...ribbons, beacon, tollRing, reliquary, ...ghosts, mist, shell]) o.traverse((m) => (m.frustumCulled = false));

  let t = 0;
  let spin = 0;
  let tolls = 0;
  let tollT = -1;
  let glitchT = 0;
  const clawIn: ClawRigIn = { reach: 7, reapN: 0, reapSide: 1, reapBig: false, held: false, bigWind: 0, phase: 0, display: false };
  const update = (dt: number, s: RevenantRigState): void => {
    t += dt;
    const spd = Math.min(1, Math.abs(s.speed) / 14);
    clawIn.reach = s.reach || 7;
    clawIn.reapN = s.reapN ?? 0;
    clawIn.reapSide = s.reapSide ?? 1;
    clawIn.reapBig = !!s.reapBig;
    clawIn.held = !!s.reaping;
    clawIn.bigWind = s.bigWind ?? 0;
    clawIn.phase = s.phase;
    clawIn.display = !!s.display;
    claws.update(dt, t, clawIn);
    spin += (s.speed * dt) / WHEEL_R;
    // Seams flicker like flame (hotter in the Hunt); wheels turn; rune rings drift.
    const fl = flick(t, 0);
    stripMat.emissiveIntensity = (s.hunt ? 2.4 : 1.25) + fl * (s.hunt ? 1.4 : 0.9) + Math.abs(s.reap) * 0.8;
    slitMat.emissiveIntensity = 2 + flick(t, 3.1) * 1.2;
    voidMat.emissiveIntensity = 0.3 + 0.15 * fl + (s.hunt ? 0.4 : 0);
    for (let i = 0; i < spokes.length; i++) spokes[i].rotation.x = spin;
    for (let i = 0; i < runes.length; i++) {
      runes[i].rotation.z = t * (0.6 + i * 0.13) * (i % 2 ? -1 : 1);
      runes[i].position.y = WHEEL_R + 0.04 * Math.sin(t * 2 + i);
    }
    runeMat.opacity = 0.55 + 0.3 * flick(t, 4.4);
    // Ribbons: stream back from their roots, rippling (harder at speed), drooping when parked.
    for (let r = 0; r < ribbons.length; r++) {
      const root = ribRoots[r];
      const pos = ribbons[r].geometry.getAttribute('position') as THREE.BufferAttribute;
      const hw = ribWidth[r] / 2;
      const len = RIB_LEN * (0.75 + 0.35 * spd);
      for (let j = 0; j <= RIB_SEG; j++) {
        const u = j / RIB_SEG;
        const wave = Math.sin(t * (5 + 4 * spd) - u * 5 + r * 1.3) * u * (0.12 + 0.12 * spd);
        const z = root.z - u * len;
        const y = root.y - u * u * (0.9 - 0.65 * spd) + wave * 0.6;
        const x = root.x + wave + Math.sign(root.x) * u * 0.15;
        const w = hw * (1 - 0.55 * u);
        // Banked: mostly flat (reads from the chase camera above) with some lift.
        pos.setXYZ(j * 2, x + w * 0.85, y + w * 0.5, z);
        pos.setXYZ(j * 2 + 1, x - w * 0.85, y - w * 0.5, z);
      }
      pos.needsUpdate = true;
    }
    ribMat.opacity = 0.8 + 0.2 * fl;
    // Reliquary: bobs; souls orbit inside (count = souls), faster when full.
    reliquary.position.y = RELIC_Y + 0.07 * Math.sin(t * 1.8);
    reliquary.rotation.y = t * 0.4;
    const n = Math.max(0, Math.min(SOULS_MAX, Math.round(s.souls)));
    for (let i = 0; i < SOULS_MAX; i++) {
      const m = souls[i];
      m.visible = i < n;
      if (!m.visible) continue;
      const a = t * (1.6 + (i % 3) * 0.5 + n * 0.08) + (i * Math.PI * 2) / Math.max(1, n);
      const rr = RELIC_R * (0.45 + 0.2 * Math.sin(t * 2.3 + i));
      m.position.set(Math.sin(a) * rr, Math.sin(t * 1.3 + i * 1.7) * RELIC_L * 0.55, Math.cos(a) * rr);
      m.rotation.z = Math.sin(a) * 0.6;
    }
    capsuleMat.emissiveIntensity = 0.3 + n * 0.08 + 0.15 * flick(t, 2.2);
    const ff = flick(t, 5.5);
    fire.scale.set(0.9 + 0.2 * ff, 0.75 + 0.5 * ff, 0.9 + 0.2 * ff);
    fireDeep.opacity = 0.55 + 0.25 * ff;
    // Canopy ghosts drift fore and aft, fading in and out.
    for (let i = 0; i < ghosts.length; i++) {
      const g = ghosts[i];
      const ph = t * (0.35 + i * 0.07) + i * 1.9;
      g.position.z = -0.55 + Math.sin(ph) * 1.0;
      g.position.y = 1.58 + 0.05 * Math.sin(ph * 2.3);
      g.scale.setScalar(0.85 + 0.25 * Math.sin(ph * 1.7));
    }
    ghostMat.opacity = gtex ? 0.25 + 0.3 * Math.max(0, Math.sin(t * 0.9)) : 0;
    // Halo: hovers and turns; each toll throws a ring of light out from it.
    beacon.position.y = BEACON_POS.y + 0.05 * Math.sin(t * 2.1);
    halo.rotation.z = haloRim.rotation.z = t * 0.8;
    lamp.rotation.y = t * 1.6;
    lampMat.emissiveIntensity = 1.2 + fl * 1.2 + (tollT >= 0 ? 3 * Math.max(0, 1 - tollT * 2) : 0);
    if (s.tolls !== tolls) {
      if (s.tolls > tolls) tollT = 0;
      tolls = s.tolls;
    }
    if (tollT >= 0) {
      tollT += dt;
      const k = tollT / 0.9;
      if (k >= 1) {
        tollT = -1;
        tollRing.visible = false;
      } else {
        tollRing.visible = true;
        tollRing.scale.setScalar(0.4 + k * 9);
        tollMat.opacity = 0.9 * (1 - k);
        tollEdge.opacity = 0.8 * (1 - k);
      }
    }
    mistMat.opacity = 0.22 + 0.12 * flick(t, 6.6) + s.phase * 0.2;
    // PHASED: the body fades into the scanline ghost shell; the bone skeleton shows through, with a little glitch.
    const ph = s.phase;
    hull.visible = ph < 0.5;
    shell.visible = ph > 0.01;
    if (shell.visible) {
      shellMat.opacity = 0.62 * ph;
      rimMat.opacity = 0.55 * ph;
      if (scan) scan.offset.y = (scan.offset.y - dt * 1.6) % 1;
      glitchT -= dt;
      if (glitchT <= 0) {
        glitchT = 0.06 + Math.random() * 0.18;
        shell.position.x = Math.random() < 0.35 ? (Math.random() - 0.5) * 0.16 : 0;
        shell.scale.y = Math.random() < 0.25 ? 1.04 : 1;
      }
    }
    skel.visible = ph > 0.01 || hull.visible;
    claws.rifts.visible = hull.visible;
  };
  return { group, parts: { stripMat, reliquary, beacon, heads, update, park: claws.park } };
}
