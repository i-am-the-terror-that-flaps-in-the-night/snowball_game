import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mergeStatic } from '../../render/mergeStatic';
import { makeShadowProxy } from '../../render/shadowProxy';
import { addMesh, type VehicleBuild, type VehicleBuildIn } from './types';

/* REVENANT: a possessed, semi-modern armoured hearse. Long, low and wedge-nosed in matte graphite with gloss black
 * carbon panels, frosted violet glass with ghost faces drifting behind it, spectral strip lights along every body line
 * (flickering like flame), slit headlights, a scythe-curved alloy blade etched with sigils, THE RELIQUARY (a glass
 * capsule of souls floating over the tail in ghostfire), a roof toll beacon, black rims with spectral spokes and rune
 * rings, purple underglow. PHASED: the opaque hull fades out for a scanline ghost shell with the bone-white skeletal
 * frame showing through. */

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
  /** 0..1 Reap swing in progress (+1 right, -1 left sweep; 0 idle): the blade sigils flare. */
  reap: number;
  /** Wild Hunt running (spectral strips burn hot). */
  hunt: boolean;
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
}

/** The Reliquary capsule: centre (model space), radius, length. Souls swirl inside it. */
const RELIC_Y = 2.95;
const RELIC_Z = -1.45;
const RELIC_R = 0.34;
const RELIC_L = 0.7;
export const RELIC_POS = new THREE.Vector3(0, RELIC_Y, RELIC_Z);
/** Roof toll beacon (front of the roof). */
export const BEACON_POS = new THREE.Vector3(0, 2.28, 0.45);
const SOULS_MAX = 10;
const WHEELS = [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.25], [0.95, -1.25]] as const;
const WHEEL_R = 0.48;

/** Side profile (z, y) of the lower hull (extruded across the width): a long wedge, nose low, flat tail. */
const LOWER: readonly (readonly [number, number])[] = [[-2.52, 0.6], [2.5, 0.6], [2.78, 0.8], [2.7, 0.98], [1.5, 1.38], [-2.44, 1.42], [-2.58, 1.02]];
/** Greenhouse profile (z, y): raked windscreen, long flat roof over the rear compartment, chamfered tail. */
const UPPER: readonly (readonly [number, number])[] = [[-2.36, 1.4], [1.32, 1.4], [0.72, 2.04], [-1.96, 2.12], [-2.34, 1.86]];

function profileGeo(pts: readonly (readonly [number, number])[], width: number, bevel = 0.04): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  sh.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: width - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 1 });
  // Shape x -> model z, shape y -> model y, extrusion -> model x (centred).
  g.rotateY(-Math.PI / 2);
  g.translate((width - 2 * bevel) / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

let hullGeo: THREE.BufferGeometry | null = null;
/** The hearse's hull silhouette (lower wedge + greenhouse) as one geometry, cached: THE WILD HUNT's phantom riders
 *  (combat/revenantFx.ts) ride in it. */
export function revenantHullGeometry(): THREE.BufferGeometry {
  if (hullGeo) return hullGeo;
  const a = profileGeo(LOWER, 2.0).toNonIndexed();
  const b = profileGeo(UPPER, 1.74, 0.05).toNonIndexed();
  for (const g of [a, b]) g.deleteAttribute('uv');
  hullGeo = mergeGeometries([a, b]) ?? a;
  return hullGeo;
}

/* ---- canvas textures (cached; null without a DOM, e.g. headless tests) */
let sigilTex: THREE.CanvasTexture | null | undefined;
/** Sigils etched along the blade: half circuit trace, half occult rune, glowing violet on black. */
function sigils(): THREE.CanvasTexture | null {
  if (sigilTex !== undefined) return sigilTex;
  if (typeof document === 'undefined') return (sigilTex = null);
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#100418';
  g.fillRect(0, 0, 512, 64);
  g.strokeStyle = '#e0a8ff';
  g.fillStyle = '#e0a8ff';
  g.lineWidth = 3;
  g.lineCap = 'round';
  // Circuit bus along the middle with rune glyphs hanging off it.
  g.beginPath();
  g.moveTo(6, 32);
  g.lineTo(506, 32);
  g.stroke();
  let x = 18;
  let i = 0;
  while (x < 500) {
    const k = i++ % 4;
    g.beginPath();
    if (k === 0) {
      // ring rune with a cross
      g.arc(x + 10, 32, 11, 0, Math.PI * 2);
      g.moveTo(x + 10, 17);
      g.lineTo(x + 10, 47);
    } else if (k === 1) {
      // circuit trace: right-angle leads to pads
      g.moveTo(x, 32);
      g.lineTo(x, 14);
      g.lineTo(x + 18, 14);
      g.moveTo(x + 8, 32);
      g.lineTo(x + 8, 50);
      g.lineTo(x + 22, 50);
    } else if (k === 2) {
      // tri rune
      g.moveTo(x, 48);
      g.lineTo(x + 11, 14);
      g.lineTo(x + 22, 48);
      g.moveTo(x + 4, 36);
      g.lineTo(x + 18, 36);
    } else {
      // crescent + eye
      g.arc(x + 11, 32, 12, Math.PI * 0.2, Math.PI * 1.8);
      g.moveTo(x + 15, 32);
      g.arc(x + 11, 32, 4, 0, Math.PI * 2);
    }
    g.stroke();
    if (k === 1) {
      g.fillRect(x + 16, 11, 6, 6);
      g.fillRect(x + 20, 47, 6, 6);
    }
    x += 38;
  }
  sigilTex = new THREE.CanvasTexture(c);
  sigilTex.colorSpace = THREE.SRGBColorSpace;
  return sigilTex;
}

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

export function buildRevenantVehicle({ mats, chassis }: VehicleBuildIn): VehicleBuild<RevenantVehicleParts> {
  const group = new THREE.Group();
  const hull = new THREE.Group();
  group.add(hull);
  const stripMat = new THREE.MeshStandardMaterial({ color: REV_CORE, emissive: REV_CORE, emissiveIntensity: 1.6, roughness: 0.4 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: REV_EDGE, roughness: 0.6, metalness: 0.3 });
  const bone = new THREE.MeshStandardMaterial({ color: REV_BONE, roughness: 0.55, metalness: 0.15 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x2a1c3c, roughness: 0.35, metalness: 0.4, emissive: 0x2a0c4a, emissiveIntensity: 0.55 });
  const alloy = new THREE.MeshStandardMaterial({ color: 0xc4c9d6, roughness: 0.22, metalness: 0.6 });
  const slitMat = new THREE.MeshStandardMaterial({ color: REV_BRIGHT, emissive: REV_CORE, emissiveIntensity: 2.4 });
  const tex = sigils();
  const sigilMat = new THREE.MeshStandardMaterial({ color: tex ? 0xffffff : REV_BRIGHT, map: tex, emissive: tex ? 0xffffff : REV_CORE, emissiveMap: tex, emissiveIntensity: 1.2, roughness: 0.4 });

  addMesh(chassis, mats.dark, 0, 0.62, 0.05, hull);
  // Hull: matte graphite lower wedge + a narrower gloss-black greenhouse (tumblehome), on carbon skirts.
  const lowerGeo = profileGeo(LOWER, 2.0);
  const upperGeo = profileGeo(UPPER, 1.74, 0.05);
  addMesh(lowerGeo, mats.paint, 0, 0, 0, hull);
  addMesh(upperGeo, mats.trim, 0, 0, 0, hull);
  for (const sx of [-1, 1]) {
    // Carbon side skirt + flared arches over the shared wheels.
    addMesh(new THREE.BoxGeometry(0.1, 0.24, 2.0), mats.trim, sx * 1.02, 0.72, 0.1, hull);
    for (const [, z] of WHEELS.filter(([x]) => x > 0)) addMesh(new THREE.BoxGeometry(0.3, 0.12, 1.25), mats.trim, sx * 1.04, 1.22, z, hull);
    // Frosted violet side glass along the rear compartment, framed by thin bone pillars.
    const win = addMesh(new THREE.BoxGeometry(0.04, 0.5, 3.1), glass, sx * 0.88, 1.74, -0.55, hull, false);
    win.rotation.z = sx * 0.04;
    for (const z of [-2.0, -1.05, -0.1, 0.85]) addMesh(new THREE.BoxGeometry(0.06, 0.56, 0.07), bone, sx * 0.9, 1.74, z, hull, false);
    // Bone-white door handles and a carbon vent behind the front wheel.
    addMesh(new THREE.BoxGeometry(0.04, 0.05, 0.22), bone, sx * 1.02, 1.28, 0.55, hull, false);
    for (let k = 0; k < 3; k++) addMesh(new THREE.BoxGeometry(0.04, 0.04, 0.34), mats.dark, sx * 1.02, 0.98 + k * 0.08, 0.72, hull, false);
  }
  // Raked windscreen + rear glass (the Plow's tinted glass), a carbon hood blister and roof spoiler.
  const ws = addMesh(new THREE.BoxGeometry(1.5, 0.05, 0.86), glass, 0, 1.74, 1.03, hull, false);
  ws.rotation.x = -0.86;
  const rw = addMesh(new THREE.BoxGeometry(1.4, 0.05, 0.42), glass, 0, 2.0, -2.18, hull, false);
  rw.rotation.x = 0.98;
  const blister = addMesh(new THREE.BoxGeometry(0.7, 0.08, 1.1), mats.trim, 0, 1.36, 2.0, hull);
  blister.rotation.x = 0.31;
  addMesh(new THREE.BoxGeometry(1.7, 0.06, 0.34), mats.trim, 0, 2.17, -2.12, hull);
  // Spectral strip lights: beltline, roof rails, hood chevrons, tail bar.
  for (const sx of [-1, 1]) {
    addMesh(new THREE.BoxGeometry(0.035, 0.035, 3.95), stripMat, sx * 1.0, 1.42, -0.5, hull, false);
    addMesh(new THREE.BoxGeometry(0.03, 0.03, 2.66), stripMat, sx * 0.86, 2.12, -0.62, hull, false);
    const chev = addMesh(new THREE.BoxGeometry(0.035, 0.035, 1.3), stripMat, sx * 0.62, 1.2, 2.08, hull, false);
    chev.rotation.set(0.31, sx * -0.36, 0);
    addMesh(new THREE.BoxGeometry(0.035, 0.035, 2.5), stripMat, sx * 1.01, 0.66, 0.1, hull, false);
  }
  addMesh(new THREE.BoxGeometry(1.8, 0.05, 0.035), stripMat, 0, 1.18, -2.6, hull, false);
  // Slit headlights in a carbon visor, and the tail's coffin-lid hatch outline.
  for (const sx of [-1, 1]) {
    const head = addMesh(new THREE.BoxGeometry(0.48, 0.05, 0.05), slitMat, sx * 0.55, 0.98, 2.67, hull, false);
    head.rotation.y = sx * -0.28;
  }
  addMesh(new THREE.BoxGeometry(1.5, 0.05, 0.05), edgeMat, 0, 1.02, 2.66, hull, false);
  addMesh(new THREE.BoxGeometry(1.2, 0.04, 0.04), bone, 0, 1.38, -2.6, hull, false);
  // SCYTHE BLADE: a crescent alloy plate low across the nose, swept back into hooked tips, a sigil band on its face.
  const cres = new THREE.Shape();
  const OUT = 1.62;
  cres.moveTo(-OUT - 0.42, -0.95);
  cres.quadraticCurveTo(-OUT, 0.05, 0, 0.38);
  cres.quadraticCurveTo(OUT, 0.05, OUT + 0.42, -0.95);
  cres.quadraticCurveTo(OUT - 0.05, -0.3, 0, 0.1);
  cres.quadraticCurveTo(-OUT + 0.05, -0.3, -OUT - 0.42, -0.95);
  const bladeGeo = new THREE.ExtrudeGeometry(cres, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 10 });
  bladeGeo.rotateX(Math.PI / 2);
  bladeGeo.computeVertexNormals();
  addMesh(bladeGeo, alloy, 0, 0.78, 2.55, hull);
  // Glowing cutting edge along the blade's outer arc and a honed bevel on its inner (rear-facing) arc, so the hooked
  // tips read as blades from the chase camera behind, not as dark wings.
  const edgeGlow = new THREE.MeshBasicMaterial({ color: REV_BRIGHT, toneMapped: false });
  const bevel = new THREE.MeshStandardMaterial({ color: 0xeef0f6, roughness: 0.12, metalness: 0.5, emissive: 0x3a2a55, emissiveIntensity: 0.5 });
  const BY = 0.79;
  const BZ = 2.55;
  for (const sx of [-1, 1]) {
    const outer = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(sx * (OUT + 0.42), BY, BZ - 0.95), new THREE.Vector3(sx * OUT, BY, BZ + 0.05), new THREE.Vector3(0, BY, BZ + 0.38));
    addMesh(new THREE.TubeGeometry(outer, 16, 0.045, 5, false), edgeGlow, 0, 0, 0, hull, false);
    const inner = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(sx * (OUT + 0.42), BY, BZ - 0.95), new THREE.Vector3(sx * (OUT - 0.05), BY, BZ - 0.3), new THREE.Vector3(sx * 0.4, BY, BZ + 0.06));
    addMesh(new THREE.TubeGeometry(inner, 16, 0.06, 4, false), bevel, 0, 0, 0, hull, false);
    // A needle point hooking back off each tip.
    const tip = addMesh(new THREE.ConeGeometry(0.09, 0.55, 6), edgeGlow, sx * (OUT + 0.55), BY - 0.12, BZ - 1.18, hull, false);
    tip.rotation.set(-Math.PI / 2, 0, 0);
    tip.rotation.y = sx * 0.55;
  }
  // Sigil band: a thin strip following the front arc (segments).
  const SEG = 9;
  for (let i = 0; i < SEG; i++) {
    const t0 = i / SEG;
    const t1 = (i + 1) / SEG;
    const at = (t: number) => {
      // Quadratic Bezier of the front edge, a hair inside it.
      const u = t * 2;
      const [p0, p1, p2] = u < 1 ? [[-OUT - 0.4, -0.92], [-OUT, 0.05], [0, 0.36]] : [[0, 0.36], [OUT, 0.05], [OUT + 0.4, -0.92]];
      const v = u < 1 ? u : u - 1;
      const x = (1 - v) ** 2 * p0[0] + 2 * (1 - v) * v * p1[0] + v * v * p2[0];
      const y = (1 - v) ** 2 * p0[1] + 2 * (1 - v) * v * p1[1] + v * v * p2[1];
      return [x, y] as const;
    };
    const [x0, y0] = at(t0);
    const [x1, y1] = at(t1);
    const len = Math.hypot(x1 - x0, y1 - y0);
    const seg = new THREE.PlaneGeometry(len, 0.13);
    const uv = seg.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setX(k, t0 + uv.getX(k) * (t1 - t0));
    const m = addMesh(seg, sigilMat, (x0 + x1) / 2, 0.64, 2.55 + (y0 + y1) / 2 + 0.03, hull, false);
    m.rotation.y = -Math.atan2(y1 - y0, x1 - x0);
  }
  // Blade mounts.
  for (const sx of [-1, 1]) addMesh(new THREE.BoxGeometry(0.14, 0.14, 0.5), mats.dark, sx * 0.55, 0.72, 2.6, hull);
  // Roof toll beacon base (the lamp animates).
  addMesh(new THREE.CylinderGeometry(0.2, 0.26, 0.12, 10), mats.trim, BEACON_POS.x, BEACON_POS.y - 0.12, BEACON_POS.z, hull);
  // Reliquary cradle on the roof: four bone claws reaching up toward the floating capsule.
  addMesh(new THREE.CylinderGeometry(0.42, 0.5, 0.1, 12), mats.trim, 0, 2.17, RELIC_Z, hull);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const claw = addMesh(new THREE.ConeGeometry(0.06, 0.42, 5), bone, Math.sin(a) * 0.4, 2.36, RELIC_Z + Math.cos(a) * 0.4, hull);
    claw.rotation.set(Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5);
  }
  // Spectral spokes on every wheel (outboard of the shared black rims).
  const spokeGeo = new THREE.BoxGeometry(0.03, 0.7, 0.07);
  const spokes: THREE.Group[] = [];
  const runes: THREE.Mesh[] = [];
  const runeGeo = new THREE.TorusGeometry(0.64, 0.025, 4, 28);
  const runeMat = new THREE.MeshBasicMaterial({ color: REV_BRIGHT, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });

  // ---- Skeletal chassis (inside the hull; shows through the PHASED ghost shell): ladder rails, ribs, a spine and
  // a roll-cage arch, all bone white.
  const skel = new THREE.Group();
  for (const sx of [-1, 1]) {
    addMesh(new THREE.BoxGeometry(0.08, 0.08, 4.6), bone, sx * 0.62, 0.86, 0.05, skel, false);
    addMesh(new THREE.BoxGeometry(0.07, 0.07, 3.2), bone, sx * 0.66, 1.98, -0.6, skel, false);
  }
  addMesh(new THREE.BoxGeometry(0.1, 0.1, 4.0), bone, 0, 1.36, -0.2, skel, false);
  for (const z of [-2.0, -1.3, -0.6, 0.1, 0.8]) {
    const rib = addMesh(new THREE.TorusGeometry(0.64, 0.04, 4, 12, Math.PI), bone, 0, 1.36, z, skel, false);
    rib.scale.set(1, 0.95, 1);
  }
  for (const z of [1.0, -2.2]) {
    for (const sx of [-1, 1]) {
      const post = addMesh(new THREE.BoxGeometry(0.06, 1.2, 0.06), bone, sx * 0.66, 1.4, z, skel, false);
      post.rotation.z = sx * 0.04;
    }
  }
  // Skull up front where the engine would be.
  addMesh(new THREE.SphereGeometry(0.26, 10, 8), bone, 0, 1.15, 1.8, skel, false);
  for (const sx of [-1, 1]) addMesh(new THREE.SphereGeometry(0.07, 6, 4), edgeMat, sx * 0.1, 1.18, 2.03, skel, false);
  group.add(skel);

  mergeStatic(hull);
  mergeStatic(skel);
  group.add(...makeShadowProxy(hull, group));

  // ---- PHASED ghost shell: the hull silhouette as translucent scanlined spectral glass, with a dark back-face rim.
  const scan = scanlines();
  const shellMat = new THREE.MeshBasicMaterial({ color: REV_CORE, map: scan, alphaMap: scan, transparent: true, opacity: 0.0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const rimMat = new THREE.MeshBasicMaterial({ color: REV_EDGE, transparent: true, opacity: 0, depthWrite: false, side: THREE.BackSide });
  const shell = new THREE.Group();
  for (const geo of [lowerGeo, upperGeo]) {
    shell.add(new THREE.Mesh(geo, shellMat));
    const rim = new THREE.Mesh(geo, rimMat);
    rim.scale.setScalar(1.035);
    rim.position.y = -0.03;
    shell.add(rim);
  }
  shell.visible = false;
  group.add(shell);

  // ---- Animated parts (no shadows; the static proxy covers the body).
  for (const [x, z] of WHEELS) {
    const sx = Math.sign(x);
    const sp = new THREE.Group();
    sp.position.set(sx * 1.19, WHEEL_R, z);
    for (let k = 0; k < 3; k++) {
      const s = new THREE.Mesh(spokeGeo, stripMat);
      s.rotation.x = (k / 3) * Math.PI;
      sp.add(s);
    }
    group.add(sp);
    spokes.push(sp);
    const r = new THREE.Mesh(runeGeo, runeMat);
    r.position.set(sx * 1.28, WHEEL_R, z);
    r.rotation.y = Math.PI / 2;
    group.add(r);
    runes.push(r);
  }
  // Slit headlight anchors (the Plow spills ghostfire from them).
  const heads = [-1, 1].map((sx) => {
    const o = new THREE.Object3D();
    o.position.set(sx * 0.55, 0.98, 2.75);
    group.add(o);
    return o;
  });
  // Roof beacon: a bone bell with a violet lamp, and the toll ring it throws.
  const beacon = new THREE.Group();
  beacon.position.copy(BEACON_POS);
  const lampMat = new THREE.MeshStandardMaterial({ color: REV_BRIGHT, emissive: REV_CORE, emissiveIntensity: 1.5, roughness: 0.3 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), lampMat);
  lamp.position.y = 0.06;
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, 0.26, 10, 1, true), bone);
  bell.position.y = 0.14;
  beacon.add(lamp, bell);
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
  // THE RELIQUARY: a floating glass capsule with bone end caps over a ghostfire cushion; souls swirl inside it.
  const reliquary = new THREE.Group();
  reliquary.position.copy(RELIC_POS);
  const capsuleMat = new THREE.MeshStandardMaterial({ color: 0x6a3cb0, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.4, depthWrite: false, emissive: REV_DEEP, emissiveIntensity: 0.6 });
  const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(RELIC_R, RELIC_L, 6, 14), capsuleMat);
  capsule.renderOrder = 2;
  const capGeo = new THREE.CylinderGeometry(RELIC_R * 0.9, RELIC_R * 1.05, 0.12, 14);
  const capTop = new THREE.Mesh(capGeo, bone);
  capTop.position.y = RELIC_L / 2 + RELIC_R * 0.55;
  const capBot = new THREE.Mesh(capGeo, bone);
  capBot.position.y = -RELIC_L / 2 - RELIC_R * 0.55;
  const capRing = new THREE.Mesh(new THREE.TorusGeometry(RELIC_R + 0.02, 0.025, 4, 18), stripMat);
  capRing.rotation.x = Math.PI / 2;
  reliquary.add(capsule, capTop, capBot, capRing);
  // Souls: violet wisps (bright core + deep shell) on orbits inside the glass.
  const soulGeo = new THREE.SphereGeometry(0.075, 8, 6);
  soulGeo.scale(1, 1.9, 1);
  const soulCore = new THREE.MeshBasicMaterial({ color: 0xc89cff, toneMapped: false });
  const soulShell = new THREE.MeshBasicMaterial({ color: REV_CORE, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
  const souls: THREE.Mesh[] = [];
  for (let i = 0; i < SOULS_MAX; i++) {
    const m = new THREE.Mesh(soulGeo, soulCore);
    const halo = new THREE.Mesh(soulGeo, soulShell);
    halo.scale.setScalar(1.9);
    m.add(halo);
    m.visible = false;
    reliquary.add(m);
    souls.push(m);
  }
  // Ghostfire cushion under the capsule: stacked cones (deep painted shell + bright core), flickered.
  const fireGeo = new THREE.ConeGeometry(0.28, 0.6, 10, 1, true);
  fireGeo.rotateX(Math.PI);
  const fireDeep = new THREE.MeshBasicMaterial({ color: REV_CORE, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const fireHot = new THREE.MeshBasicMaterial({ color: REV_CORE, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const fire = new THREE.Group();
  const f1 = new THREE.Mesh(fireGeo, fireDeep);
  const f2 = new THREE.Mesh(fireGeo, fireHot);
  f2.scale.set(0.55, 0.8, 0.55);
  fire.add(f1, f2);
  fire.position.set(0, -RELIC_L / 2 - RELIC_R - 0.12, 0);
  reliquary.add(fire);
  group.add(reliquary);
  // Window ghosts: faint faces drifting along the frosted side glass.
  const gtex = ghostFace();
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0xf0e0ff, map: gtex, transparent: true, opacity: gtex ? 0.55 : 0, depthWrite: false, toneMapped: false });
  const ghosts: THREE.Mesh[] = [];
  const ghostGeo = new THREE.PlaneGeometry(0.34, 0.44);
  for (let i = 0; i < 4; i++) {
    const sx = i < 2 ? 1 : -1;
    const g = new THREE.Mesh(ghostGeo, ghostMat);
    g.position.set(sx * 0.915, 1.74, -0.5);
    g.rotation.y = (sx * Math.PI) / 2;
    group.add(g);
    ghosts.push(g);
  }
  // Purple mist underglow (painted, so it shows on snow; the Plow's flicker drives the opacity).
  const mistMat = new THREE.MeshBasicMaterial({ color: REV_CORE, transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false });
  const mistGeo = new THREE.CircleGeometry(1, 24);
  mistGeo.rotateX(-Math.PI / 2);
  const mist = new THREE.Mesh(mistGeo, mistMat);
  mist.scale.set(1.35, 1, 2.9);
  mist.position.y = 0.06;
  mist.renderOrder = 1;
  group.add(mist);
  for (const o of [...spokes, ...runes, beacon, tollRing, reliquary, ...ghosts, mist, shell]) o.traverse((m) => (m.frustumCulled = false));

  let t = 0;
  let spin = 0;
  let tolls = 0;
  let tollT = -1;
  let glitchT = 0;
  const update = (dt: number, s: RevenantRigState): void => {
    t += dt;
    spin += (s.speed * dt) / WHEEL_R;
    // Strips flicker like flame (hotter in the Hunt); spokes turn with the wheels; rune rings drift.
    const fl = flick(t, 0);
    stripMat.emissiveIntensity = (s.hunt ? 2.4 : 1.25) + fl * (s.hunt ? 1.4 : 0.9) + Math.abs(s.reap) * 0.8;
    sigilMat.emissiveIntensity = 0.9 + 0.5 * flick(t, 1.7) + Math.abs(s.reap) * 1.8;
    slitMat.emissiveIntensity = 2 + flick(t, 3.1) * 1.2;
    for (let i = 0; i < spokes.length; i++) spokes[i].rotation.x = spin;
    for (let i = 0; i < runes.length; i++) {
      runes[i].rotation.z = t * (0.6 + i * 0.13) * (i % 2 ? -1 : 1);
      runes[i].position.y = WHEEL_R + 0.04 * Math.sin(t * 2 + i);
    }
    runeMat.opacity = 0.55 + 0.3 * flick(t, 4.4);
    // Reliquary: bobs on its ghostfire; souls orbit inside (count = souls), faster when full.
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
    // Window ghosts drift fore and aft behind the glass, fading in and out.
    for (let i = 0; i < ghosts.length; i++) {
      const g = ghosts[i];
      const ph = t * (0.35 + i * 0.07) + i * 1.9;
      g.position.z = -0.6 + Math.sin(ph) * 1.25;
      g.position.y = 1.72 + 0.06 * Math.sin(ph * 2.3);
      g.scale.setScalar(0.85 + 0.25 * Math.sin(ph * 1.7));
    }
    ghostMat.opacity = gtex ? 0.25 + 0.3 * Math.max(0, Math.sin(t * 0.9)) : 0;
    // Beacon: pulses; each toll throws a ring of light out from it.
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
    // PHASED: the hull fades into the scanline ghost shell; the bone skeleton shows through, with a little glitch.
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
  };
  return { group, parts: { stripMat, reliquary, beacon, heads, update } };
}
