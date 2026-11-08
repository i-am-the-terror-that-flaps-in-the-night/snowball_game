import * as THREE from 'three';
import { mergeStatic } from '../../render/mergeStatic';
import { makeShadowProxy } from '../../render/shadowProxy';
import { addMesh, type VehicleBuild, type VehicleBuildIn } from './types';

/** What the Plow feeds the TESLA ROVER rig every frame (VoltVehicleParts.update). */
export interface VoltRigState {
  /** ARC LANCE (SPACE) is firing: the toroid flares, its crawling arcs multiply, the spark gaps chatter. */
  arc: boolean;
  /** STATIC FIELD (E) active, 0..1: the four field emitter rods telescope out round the tower and arc to it. */
  field: number;
}

/** VOLT-9 / TESLA ROVER animatable parts. */
export interface VoltVehicleParts {
  /** Two points on the toroid rim (the Plow's idle lightning jumps between them; Plow.coilTops). */
  coilTops: THREE.Object3D[];
  /** Under-glow light-bar material (pulsed by the Plow). */
  underglowMat: THREE.MeshBasicMaterial;
  /** Toroid arcs, spark gaps, emitter rods, gauge needles: call once per frame while the rover shows. */
  update(dt: number, s: VoltRigState): void;
}

/** Top of the tower toroid above the ground (combat/volt.ts TOWER_Y arcs from here, 0.3 m behind the centre). */
export const TESLA_TOWER_TOP = 3.15;
/** Tower axis (model z) and the toroid: centre height, major radius, tube radius. */
const TZ = -0.3;
const TOR_Y = 3.03;
const TOR_R = 0.42;
const TOR_r = 0.12;
/** Static Field emitter rods: sleeve-top radius on the base drum, outward lean (rad), extended length. */
const ROD_R = 0.36;
const ROD_LEAN = 0.5;
const ROD_LEN = 0.95;
const DRUM_TOP = 1.47;
/** Spark gaps on the deck corners: x, z, electrode height. */
const GAPS: readonly (readonly [number, number])[] = [[-0.74, 1.5], [0.74, 1.5], [-0.78, -1.62], [0.78, -1.62]];
const GAP_Y = 1.44;
const GAP_HALF = 0.06;
/** Arc pool: toroid crawlers (the first TOR_IDLE run all the time), one per spark gap, one per emitter rod. */
const TOR_ARCS = 6;
const TOR_IDLE = 3;
const N_ARCS = TOR_ARCS + GAPS.length + 4;
const SEG = 6;
const PTS = SEG + 1;

const COPPER = 0xc8743a;
const GLOW = 0x2fb8ff;

/** Faceted normals (the game's flat-shaded look) without touching the shared materials' flatShading flag. */
function facet(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  n.computeVertexNormals();
  return n;
}

/** A rounded-corner slab (w x h x d, centred) with chamfered top/bottom edges: the rover's ceramic panel form. */
function roundSlab(w: number, h: number, d: number, r: number, bevel = 0.03, seg = 3): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const hw = w / 2;
  const hd = d / 2;
  s.moveTo(-hw + r, -hd);
  s.lineTo(hw - r, -hd);
  s.absarc(hw - r, -hd + r, r, -Math.PI / 2, 0, false);
  s.lineTo(hw, hd - r);
  s.absarc(hw - r, hd - r, r, 0, Math.PI / 2, false);
  s.lineTo(-hw + r, hd);
  s.absarc(-hw + r, hd - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-hw, -hd + r);
  s.absarc(-hw + r, -hd + r, r, Math.PI, Math.PI * 1.5, false);
  const g = new THREE.ExtrudeGeometry(s, { depth: h - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 1, curveSegments: seg });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel - h / 2, 0);
  return g;
}

/** A helix (the secondary winding / a jar filament) as a thin tube. */
class Helix extends THREE.Curve<THREE.Vector3> {
  constructor(private r: number, private y0: number, private y1: number, private turns: number) {
    super();
  }
  override getPoint(t: number, out = new THREE.Vector3()): THREE.Vector3 {
    const a = t * this.turns * Math.PI * 2;
    return out.set(Math.cos(a) * this.r, this.y0 + (this.y1 - this.y0) * t, Math.sin(a) * this.r);
  }
}

/** Two strands wound round each other along `pts` (a braided cable). */
function braid(pts: THREE.Vector3[], strandR: number, wind: number, twists: number): THREE.BufferGeometry[] {
  const path = new THREE.CatmullRomCurve3(pts);
  const N = 48;
  const frames = path.computeFrenetFrames(N, false);
  const out: THREE.BufferGeometry[] = [];
  for (const phase of [0, Math.PI]) {
    const p: THREE.Vector3[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = phase + t * twists * Math.PI * 2;
      p.push(path.getPointAt(t).addScaledVector(frames.normals[i], Math.cos(a) * wind).addScaledVector(frames.binormals[i], Math.sin(a) * wind));
    }
    out.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(p), N * 2, strandR, 4, false));
  }
  return out;
}

/** Label / dial atlas (512 x 256): hazard plate, CAP BAY, VOLT-9, HV-3, and a dial face. Pixel rects. */
const LBL = { hazard: [0, 0, 256, 64], cap: [256, 0, 256, 64], name: [0, 64, 256, 64], hv: [256, 64, 128, 64], dial: [384, 64, 128, 128] } as const;
let atlasTex: THREE.CanvasTexture | null = null;
function labelAtlas(): THREE.CanvasTexture {
  if (atlasTex) return atlasTex;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d9dee4';
  g.fillRect(0, 0, 512, 256);
  const plate = (r: readonly number[], bg: string, fg: string, text: string, size: number) => {
    g.fillStyle = bg;
    g.fillRect(r[0] + 2, r[1] + 2, r[2] - 4, r[3] - 4);
    g.strokeStyle = fg;
    g.lineWidth = 3;
    g.strokeRect(r[0] + 6, r[1] + 6, r[2] - 12, r[3] - 12);
    g.fillStyle = fg;
    g.font = `bold ${size}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, r[0] + r[2] / 2, r[1] + r[3] / 2 + 2);
  };
  // Hazard plate: yellow with black chevrons at the ends.
  const h = LBL.hazard;
  g.fillStyle = '#f2c81b';
  g.fillRect(h[0], h[1], h[2], h[3]);
  g.fillStyle = '#16181c';
  for (let i = 0; i < 3; i++) {
    for (const x0 of [h[0] + 4 + i * 14, h[0] + h[2] - 46 + i * 14]) {
      g.beginPath();
      g.moveTo(x0, h[1] + 4);
      g.lineTo(x0 + 8, h[1] + 4);
      g.lineTo(x0 + 18, h[1] + 60);
      g.lineTo(x0 + 10, h[1] + 60);
      g.fill();
    }
  }
  g.font = 'bold 30px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('⚡ HIGH VOLT', h[0] + h[2] / 2, h[1] + 34);
  plate(LBL.cap, '#e8ecef', '#2a313c', 'CAP BAY', 34);
  plate(LBL.name, '#e8ecef', '#1f6fd0', 'VOLT-9', 40);
  plate(LBL.hv, '#16181c', '#f2c81b', 'HV-3', 30);
  // Dial: white face, tick ring, a red zone at the top end, blue hub.
  const [dx, dy, dw] = LBL.dial;
  const cx = dx + dw / 2;
  const cy = dy + dw / 2;
  g.fillStyle = '#f4f6f8';
  g.beginPath();
  g.arc(cx, cy, dw / 2 - 2, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#d23a2a';
  g.lineWidth = 9;
  g.beginPath();
  g.arc(cx, cy, dw / 2 - 16, -Math.PI * 0.25, Math.PI * 0.05);
  g.stroke();
  g.strokeStyle = '#1b2026';
  g.lineWidth = 3;
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * 0.8 + (i / 10) * Math.PI * 1.4;
    const r0 = dw / 2 - (i % 5 === 0 ? 26 : 18);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a) * (dw / 2 - 8), cy + Math.sin(a) * (dw / 2 - 8));
    g.stroke();
  }
  atlasTex = new THREE.CanvasTexture(c);
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.anisotropy = 4;
  return atlasTex;
}

/** Point `geo`'s 0..1 UVs at an atlas rect. */
function atlasUV(geo: THREE.BufferGeometry, r: readonly number[]): THREE.BufferGeometry {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (r[0] + uv.getX(i) * r[2]) / 512, 1 - (r[1] + (1 - uv.getY(i)) * r[3]) / 256);
  return geo;
}

const _v = new THREE.Vector3();

/* TESLA ROVER: a low, wide ceramic lab platform carrying a tall Tesla coil tower. White glossy deck panels (Paint
 * Shop body) over a slate tub (trim), a round-eyed instrument head with a gauge cluster up front, four exposed
 * capacitor jars per side on a copper bus, a transformer box at the back feeding the tower through braided cables,
 * and spark gaps on the deck corners. The tower: a porcelain base drum (four telescoping Static Field emitter rods in
 * its rim), stacked glass insulator skirts, a copper secondary winding between porcelain flanges, a glowing toroid on
 * top. All static parts merge per material; the arcs are one pooled additive ribbon mesh rewritten in place. */
export function buildVoltVehicle({ mats, chassis }: VehicleBuildIn): VehicleBuild<VoltVehicleParts> {
  const group = new THREE.Group();
  const copper = new THREE.MeshStandardMaterial({ color: COPPER, roughness: 0.32, metalness: 0.55, emissive: 0x3a1608, emissiveIntensity: 0.35 });
  const copperDark = new THREE.MeshStandardMaterial({ color: 0x8a4422, roughness: 0.45, metalness: 0.5, emissive: 0x200a02, emissiveIntensity: 0.3 });
  const porcelain = new THREE.MeshStandardMaterial({ color: 0xf3f1ea, roughness: 0.25, metalness: 0.05 });
  const hatchMat = new THREE.MeshStandardMaterial({ color: 0xd3d9e0, roughness: 0.35, metalness: 0.1 });
  const insul = new THREE.MeshStandardMaterial({ color: 0x86d6ea, roughness: 0.1, metalness: 0.2, emissive: 0x0e5878, emissiveIntensity: 0.45 });
  const jarGlass = new THREE.MeshStandardMaterial({ color: 0xa8e6ff, roughness: 0.05, metalness: 0.1, emissive: 0x0a4a70, emissiveIntensity: 0.5, transparent: true, opacity: 0.42, depthWrite: false });
  // The toroid: polished aluminium with a blue glow of its own (pulsed / flared in update) so its facets still read.
  const toroidMat = new THREE.MeshStandardMaterial({ color: 0xcfe6f2, roughness: 0.28, metalness: 0.35, emissive: GLOW, emissiveIntensity: 0.5 });
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.7 });
  const labelMat = new THREE.MeshStandardMaterial({ map: labelAtlas(), roughness: 0.45, metalness: 0.05 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true) => addMesh(geo, mat, x, y, z, group, shadow);

  /* ---- Platform: slate tub over the chassis, the white ceramic deck on top (overhanging the wheels), nose roll. */
  add(chassis, mats.dark, 0, 0.62, 0.05);
  add(roundSlab(1.5, 0.34, 3.85, 0.22), mats.trim, 0, 0.84, -0.05);
  add(roundSlab(1.9, 0.22, 3.6, 0.32), mats.paint, 0, 1.11, -0.07);
  const roll = add(facet(new THREE.CylinderGeometry(0.18, 0.18, 1.6, 8)), mats.trim, 0, 0.9, 1.88);
  roll.rotation.z = Math.PI / 2;
  for (const x of [-0.84, 0.84]) {
    const cap = add(facet(new THREE.CylinderGeometry(0.19, 0.19, 0.08, 8)), copper, x, 0.9, 1.88);
    cap.rotation.z = Math.PI / 2;
    // Round headlamps in white bezels on the nose roll.
    const bez = add(facet(new THREE.CylinderGeometry(0.11, 0.12, 0.08, 10)), porcelain, x * 0.72, 0.98, 2.03);
    bez.rotation.x = Math.PI / 2;
    add(new THREE.CircleGeometry(0.075, 10), mats.head, x * 0.72, 0.98, 2.075, false);
  }
  // Electric-blue light line along the deck's lower edge, tail lamps, rear ion thruster (Plow dash flame mount).
  for (const x of [-0.955, 0.955]) add(new THREE.BoxGeometry(0.025, 0.03, 2.9), mats.coil, x, 1.03, -0.07, false);
  for (const x of [-0.58, 0.58]) {
    const tl = add(facet(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 8)), mats.coil, x, 1.06, -1.99, false);
    tl.rotation.x = Math.PI / 2;
  }
  add(facet(new THREE.TorusGeometry(0.15, 0.035, 5, 12)), copper, 0, 1.05, -1.99);
  add(new THREE.CircleGeometry(0.13, 12), mats.dark, 0, 1.05, -1.985, false).rotation.y = Math.PI;
  add(new THREE.CircleGeometry(0.07, 10), mats.coil, 0, 1.05, -1.995, false).rotation.y = Math.PI;
  // Panel seams on the deck top + side faces.
  for (const z of [1.3, -0.98]) add(new THREE.BoxGeometry(1.74, 0.012, 0.025), mats.dark, 0, 1.224, z, false);
  for (const x of [-1, 1]) {
    for (const z of [1.02, -1.05]) add(new THREE.BoxGeometry(0.012, 0.14, 0.025), mats.dark, x * 0.951, 1.12, z, false);
  }

  /* ---- Instrument head (the rover's face): round lens eyes, a vent, a back-tilted gauge cluster. */
  add(roundSlab(0.84, 0.3, 0.55, 0.12), mats.paint, 0, 1.35, 1.0);
  for (const x of [-0.22, 0.22]) {
    const bz = add(facet(new THREE.CylinderGeometry(0.095, 0.095, 0.05, 10)), copper, x, 1.36, 1.28);
    bz.rotation.x = Math.PI / 2;
    add(new THREE.CircleGeometry(0.07, 10), mats.head, x, 1.36, 1.306, false);
  }
  for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.16, 0.022, 0.02), mats.dark, 0, 1.3 + i * 0.045, 1.276, false);
  for (const x of [-1, 1]) {
    const nm = add(atlasUV(new THREE.PlaneGeometry(0.42, 0.105), LBL.name), labelMat, x * 0.423, 1.36, 1.0, false);
    nm.rotation.y = (x * Math.PI) / 2;
  }
  const gaugeTilt = -Math.PI / 2 - 0.62;
  const gauges = new THREE.Group();
  gauges.position.set(0, 1.53, 0.72);
  gauges.rotation.set(gaugeTilt, 0, Math.PI); // dials upright for the chase camera behind
  group.add(gauges);
  addMesh(roundSlab(0.74, 0.06, 0.26, 0.06), mats.trim, 0, 0, -0.02, gauges).rotation.x = Math.PI / 2;
  const GAUGE_X = [-0.23, 0, 0.23];
  for (const x of GAUGE_X) {
    addMesh(atlasUV(new THREE.CircleGeometry(0.085, 14), LBL.dial), labelMat, x, 0, 0.015, gauges, false);
    addMesh(facet(new THREE.TorusGeometry(0.09, 0.014, 4, 14)), copper, x, 0, 0.015, gauges, false);
  }

  /* ---- Capacitor jars: four a side on the deck edges, copper base + cap, glowing filament, a copper bus on top. */
  const jarGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.4, 10, 1, true);
  const filGeo = new THREE.TubeGeometry(new Helix(0.035, -0.15, 0.15, 5), 40, 0.01, 3, false);
  const JAR_X = 0.74;
  const JAR_Z = [0.78, 0.3, -0.18, -0.66];
  for (const sx of [-1, 1]) {
    const x = sx * JAR_X;
    for (const z of JAR_Z) {
      add(facet(new THREE.CylinderGeometry(0.14, 0.15, 0.05, 10)), copper, x, 1.245, z);
      add(jarGeo, jarGlass, x, 1.47, z, false);
      add(filGeo, mats.coil, x, 1.47, z, false);
      add(facet(new THREE.CylinderGeometry(0.03, 0.03, 0.36, 5)), copperDark, x, 1.47, z, false);
      add(facet(new THREE.CylinderGeometry(0.13, 0.125, 0.05, 10)), porcelain, x, 1.695, z);
      add(facet(new THREE.CylinderGeometry(0.022, 0.022, 0.06, 5)), copper, x, 1.745, z);
    }
    // Bus bar along the jar terminals, then a strap down to the tower's base ring.
    add(new THREE.BoxGeometry(0.055, 0.025, 1.6), copper, x, 1.785, 0.06);
    add(new THREE.BoxGeometry(0.4, 0.02, 0.05), copper, sx * 0.6, 1.63, TZ).rotation.z = sx * 0.7;
    // Small labelled HV plate on each deck flank, ahead of the front wheels' arch line.
    const hv = add(atlasUV(new THREE.PlaneGeometry(0.2, 0.1), LBL.hv), labelMat, sx * 0.953, 1.11, 1.36, false);
    hv.rotation.y = (sx * Math.PI) / 2;
  }

  /* ---- Rear: transformer box with cooling fins, a hazard plate and two terminal posts feeding braided cables. */
  add(roundSlab(1.2, 0.3, 0.38, 0.08), mats.trim, 0, 1.37, -1.64);
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.06, 0.22, 0.03), mats.dark, sx * 0.62, 1.37, -1.52 - i * 0.08);
  }
  add(atlasUV(new THREE.PlaneGeometry(0.5, 0.125), LBL.hazard), labelMat, 0, 1.522, -1.74, false).rotation.set(-Math.PI / 2, 0, Math.PI);
  const cables: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    const x = sx * 0.17;
    add(facet(new THREE.CylinderGeometry(0.045, 0.055, 0.1, 6)), porcelain, x, 1.57, -1.56);
    add(facet(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 6)), copper, x, 1.64, -1.56);
    cables.push(...braid([new THREE.Vector3(x, 1.65, -1.56), new THREE.Vector3(x * 0.9, 1.84, -1.32), new THREE.Vector3(x * 0.8, 1.98, -0.92), new THREE.Vector3(x * 0.75, 1.9, -0.6)], 0.02, 0.022, 5));
  }
  cables.forEach((g, i) => add(g, i % 2 ? cableMat : copper, 0, 0, 0));
  // Rear deck: a labelled access hatch each side (handle + CAP BAY plate).
  for (const sx of [-1, 1]) {
    add(roundSlab(0.3, 0.025, 0.3, 0.05, 0.008, 2), hatchMat, sx * 0.6, 1.232, -1.2);
    add(atlasUV(new THREE.PlaneGeometry(0.24, 0.06), LBL.cap), labelMat, sx * 0.6, 1.246, -1.25, false).rotation.set(-Math.PI / 2, 0, Math.PI);
    add(new THREE.BoxGeometry(0.12, 0.02, 0.025), mats.dark, sx * 0.6, 1.252, -1.1, false);
  }

  /* ---- Spark gaps on the deck corners: two porcelain posts, copper electrodes facing each other. */
  for (const [x, z] of GAPS) {
    add(roundSlab(0.16, 0.03, 0.3, 0.04, 0.01, 2), mats.dark, x, 1.235, z);
    for (const s of [-1, 1]) {
      add(facet(new THREE.CylinderGeometry(0.03, 0.045, 0.18, 6)), porcelain, x, 1.33, z + s * 0.11);
      const arm = add(facet(new THREE.CylinderGeometry(0.014, 0.014, 0.06, 4)), copper, x, GAP_Y, z + s * 0.09);
      arm.rotation.x = Math.PI / 2;
      add(facet(new THREE.SphereGeometry(0.035, 6, 4)), copper, x, GAP_Y, z + s * GAP_HALF);
    }
  }

  /* ---- The coil tower. */
  add(facet(new THREE.CylinderGeometry(0.5, 0.56, 0.25, 12)), mats.paint, 0, 1.345, TZ);
  add(facet(new THREE.TorusGeometry(0.47, 0.03, 4, 16)).rotateX(Math.PI / 2), copper, 0, DRUM_TOP, TZ);
  add(facet(new THREE.CylinderGeometry(0.12, 0.15, 0.46, 8)), porcelain, 0, 1.7, TZ);
  for (let i = 0; i < 5; i++) add(facet(new THREE.CylinderGeometry(0.19, 0.3, 0.045, 12)), insul, 0, 1.53 + i * 0.085, TZ);
  add(facet(new THREE.CylinderGeometry(0.31, 0.31, 0.05, 14)), porcelain, 0, 1.935, TZ);
  add(facet(new THREE.CylinderGeometry(0.215, 0.215, 0.79, 14)), copperDark, 0, 2.35, TZ);
  add(new THREE.TubeGeometry(new Helix(0.232, 1.98, 2.72, 22), 22 * 12, 0.0145, 4, false), copper, 0, 0, TZ);
  add(facet(new THREE.CylinderGeometry(0.27, 0.27, 0.05, 14)), porcelain, 0, 2.765, TZ);
  add(facet(new THREE.CylinderGeometry(0.06, 0.08, 0.24, 6)), porcelain, 0, 2.9, TZ);
  for (const y of [2.84, 2.935]) add(facet(new THREE.CylinderGeometry(0.12, 0.165, 0.035, 10)), insul, 0, y, TZ);
  add(facet(new THREE.TorusGeometry(TOR_R, TOR_r, 8, 20)).rotateX(Math.PI / 2), toroidMat, 0, TOR_Y, TZ, false);
  add(facet(new THREE.SphereGeometry(0.1, 8, 5)), copper, 0, TOR_Y + 0.02, TZ);
  for (let i = 0; i < 4; i++) {
    const spoke = add(new THREE.BoxGeometry(0.03, 0.025, 0.24), copper, Math.sin((i * Math.PI) / 2) * 0.2, TOR_Y, TZ + Math.cos((i * Math.PI) / 2) * 0.2);
    spoke.rotation.y = (i * Math.PI) / 2;
  }
  // Emitter rod sleeves round the drum rim (the rods telescope out of them).
  const rodDirs: THREE.Vector3[] = [];
  const rodBase: THREE.Vector3[] = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const ox = Math.sin(a);
    const oz = Math.cos(a);
    const dir = new THREE.Vector3(ox * Math.sin(ROD_LEAN), Math.cos(ROD_LEAN), oz * Math.sin(ROD_LEAN));
    const base = new THREE.Vector3(ox * ROD_R, DRUM_TOP, TZ + oz * ROD_R);
    const sleeve = add(facet(new THREE.CylinderGeometry(0.05, 0.065, 0.22, 6)), porcelain, base.x + dir.x * 0.08, base.y + dir.y * 0.08, base.z + dir.z * 0.08);
    sleeve.quaternion.setFromUnitVectors(_v.set(0, 1, 0), dir);
    rodBase.push(base.addScaledVector(dir, 0.19));
    rodDirs.push(dir);
  }

  // Coil tops: the Plow's idle bolt jumps across the toroid between these.
  const coilTops: THREE.Object3D[] = [];
  for (const x of [-TOR_R, TOR_R]) {
    const top = new THREE.Object3D();
    top.position.set(x, TOR_Y + TOR_r - 0.01, TZ);
    group.add(top);
    coilTops.push(top);
  }

  // Underglow.
  const underGeo = new THREE.PlaneGeometry(2.6, 4.6);
  underGeo.rotateX(-Math.PI / 2);
  const underglowMat = new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  add(underGeo, underglowMat, 0, 0.08, 0.05, false);

  mergeStatic(group, { transparent: true });
  group.add(...makeShadowProxy(group, group));

  /* ---- Animated parts (after the merge, no shadows: the static proxy covers the body). ---- */
  // Gauge needles (same frame as the cluster).
  const needleRoot = new THREE.Group();
  needleRoot.position.copy(gauges.position);
  needleRoot.rotation.copy(gauges.rotation);
  const needleGeo = new THREE.BoxGeometry(0.012, 0.075, 0.006).translate(0, 0.03, 0);
  const needleMat = new THREE.MeshBasicMaterial({ color: 0xd23a2a });
  const needles: THREE.Mesh[] = [];
  for (const x of GAUGE_X) {
    const n = new THREE.Mesh(needleGeo, needleMat);
    n.position.set(x, 0, 0.022);
    needleRoot.add(n);
    needles.push(n);
  }
  group.add(needleRoot);

  // Static Field emitter rods: a steel rod (scaled along its axis) with a glowing tip ball.
  const rodGeo = new THREE.CylinderGeometry(0.02, 0.028, 1, 6).translate(0, 0.5, 0);
  const rodMat = new THREE.MeshStandardMaterial({ color: 0xc9d2dc, roughness: 0.3, metalness: 0.6 });
  const tipGeo = facet(new THREE.SphereGeometry(0.05, 6, 4));
  const rods: THREE.Mesh[] = [];
  const tips: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();
    pivot.position.copy(rodBase[i]);
    pivot.quaternion.setFromUnitVectors(_v.set(0, 1, 0), rodDirs[i]);
    const rod = new THREE.Mesh(rodGeo, rodMat);
    const tip = new THREE.Mesh(tipGeo, mats.coil);
    pivot.add(rod, tip);
    group.add(pivot);
    rods.push(rod);
    tips.push(tip);
  }

  // Toroid corona: a faint additive sheath that flares while the lance fires.
  const haloMat = new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0.04, blending: THREE.AdditiveBlending, depthWrite: false });
  const halo = new THREE.Mesh(new THREE.TorusGeometry(TOR_R, TOR_r + 0.07, 6, 20).rotateX(Math.PI / 2), haloMat);
  halo.position.set(0, TOR_Y, TZ);
  halo.renderOrder = 7;
  group.add(halo);

  /* Arc pool: one additive ribbon mesh, two layers per arc (wide blue glow, narrow white core), rewritten in place
   * each frame; an idle arc collapses to a point. */
  const VPA = PTS * 2 * 2;
  const pos = new Float32Array(N_ARCS * VPA * 3);
  const col = new Float32Array(N_ARCS * VPA * 3);
  const idx: number[] = [];
  for (let a = 0; a < N_ARCS; a++) {
    for (let l = 0; l < 2; l++) {
      const b = a * VPA + l * PTS * 2;
      const [r, g, bl] = l === 0 ? [0.12, 0.5, 1.0] : [0.85, 0.97, 1.0];
      for (let i = 0; i < PTS * 2; i++) col.set([r, g, bl], (b + i) * 3);
      for (let s = 0; s < SEG; s++) {
        const v = b + s * 2;
        idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
  }
  const arcGeo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  arcGeo.setAttribute('position', posAttr);
  arcGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  arcGeo.setIndex(idx);
  const arcMesh = new THREE.Mesh(arcGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  arcMesh.frustumCulled = false;
  arcMesh.renderOrder = 8;
  group.add(arcMesh);

  // Per-arc state: life left / max (s), next re-trigger timer, toroid crawl angle / speed / span, straight endpoints.
  const life = new Float32Array(N_ARCS);
  const maxLife = new Float32Array(N_ARCS).fill(1);
  const wait = new Float32Array(N_ARCS);
  const ang = new Float32Array(TOR_ARCS);
  const spin = new Float32Array(TOR_ARCS);
  const span = new Float32Array(TOR_ARCS);
  for (let i = 0; i < TOR_ARCS; i++) {
    ang[i] = Math.random() * Math.PI * 2;
    spin[i] = (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 1.6);
    span[i] = 0.5 + Math.random() * 0.6;
  }
  for (let i = 0; i < N_ARCS; i++) wait[i] = Math.random() * 2;
  const ends = new Float32Array(N_ARCS * 6);
  for (let g = 0; g < GAPS.length; g++) {
    const [x, z] = GAPS[g];
    ends.set([x, GAP_Y, z - GAP_HALF + 0.03, x, GAP_Y, z + GAP_HALF - 0.03], (TOR_ARCS + g) * 6);
  }

  let time = 0;
  let fieldT = 0;
  let arcK = 0;

  /** Write one ribbon layer of arc `a` from a point function into the buffer (w = half width). */
  const pts = new Float32Array(PTS * 3);
  const writeRibbon = (a: number, layer: number, w: number, sx: number, sy: number, sz: number) => {
    const b = (a * VPA + layer * PTS * 2) * 3;
    for (let i = 0; i < PTS; i++) {
      const t = i / SEG;
      const k = w * (0.35 + 0.65 * Math.sin(Math.PI * t));
      const o = b + i * 6;
      const px = pts[i * 3];
      const py = pts[i * 3 + 1];
      const pz = pts[i * 3 + 2];
      pos[o] = px + sx * k;
      pos[o + 1] = py + sy * k;
      pos[o + 2] = pz + sz * k;
      pos[o + 3] = px - sx * k;
      pos[o + 4] = py - sy * k;
      pos[o + 5] = pz - sz * k;
    }
  };
  const hide = (a: number) => pos.fill(0, a * VPA * 3, (a + 1) * VPA * 3);
  /** A jagged straight arc between the stored endpoints of `a`. */
  const straight = (a: number, jag: number, w: number) => {
    const e = a * 6;
    const dx = ends[e + 3] - ends[e];
    const dy = ends[e + 4] - ends[e + 1];
    const dz = ends[e + 5] - ends[e + 2];
    // Side = d x up (or d x z for near-vertical arcs), normalised; up2 = side x d.
    let sx = -dz;
    let sy = 0;
    let sz = dx;
    let l = Math.hypot(sx, sz);
    if (l < 1e-3) {
      sx = dy;
      sy = -dx;
      sz = 0;
      l = Math.hypot(sx, sy) || 1;
    }
    sx /= l;
    sy /= l;
    sz /= l;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const ux = (sy * dz - sz * dy) / dl;
    const uy = (sz * dx - sx * dz) / dl;
    const uz = (sx * dy - sy * dx) / dl;
    for (let i = 0; i < PTS; i++) {
      const t = i / SEG;
      const env = i === 0 || i === SEG ? 0 : jag * Math.sin(Math.PI * t);
      const j1 = (Math.random() - 0.5) * env;
      const j2 = (Math.random() - 0.5) * env;
      pts[i * 3] = ends[e] + dx * t + sx * j1 + ux * j2;
      pts[i * 3 + 1] = ends[e + 1] + dy * t + sy * j1 + uy * j2;
      pts[i * 3 + 2] = ends[e + 2] + dz * t + sz * j1 + uz * j2;
    }
    writeRibbon(a, 0, w, sx, sy, sz);
    writeRibbon(a, 1, w * 0.3, sx, sy, sz);
  };

  const update = (dt: number, s: VoltRigState) => {
    time += dt;
    fieldT += (Math.min(1, Math.max(0, s.field)) - fieldT) * Math.min(1, dt * (s.field > fieldT ? 9 : 4));
    arcK += ((s.arc ? 1 : 0) - arcK) * Math.min(1, dt * 10);
    const hot = Math.max(arcK, fieldT);

    // Emitter rods telescope out; tips ride the rod ends.
    const L = 0.04 + (ROD_LEN - 0.04) * fieldT;
    for (let i = 0; i < 4; i++) {
      rods[i].scale.y = L;
      tips[i].position.y = L;
      tips[i].scale.setScalar(1 + 0.6 * fieldT);
    }
    // Gauges: charge (lance), field, and a lazy idle wobble that jitters when hot.
    needles[0].rotation.z = 1.1 - 2.2 * (0.25 + 0.6 * arcK + 0.04 * Math.sin(time * 9));
    needles[1].rotation.z = 1.1 - 2.2 * (0.15 + 0.75 * fieldT + 0.03 * Math.sin(time * 13));
    needles[2].rotation.z = 1.1 - 2.2 * (0.5 + 0.2 * Math.sin(time * 0.7) + hot * 0.1 * Math.sin(time * 31));
    haloMat.opacity = 0.03 + 0.02 * Math.sin(time * 11) + 0.3 * arcK + 0.12 * fieldT;
    toroidMat.emissiveIntensity = 0.45 + 0.12 * Math.sin(time * 7.3) * Math.sin(time * 3.1) + 1.1 * arcK + 0.5 * fieldT;

    // Toroid crawlers: hug the outer-top of the tube, drift round it, blink.
    const active = TOR_IDLE + Math.round((TOR_ARCS - TOR_IDLE) * hot);
    for (let a = 0; a < TOR_ARCS; a++) {
      wait[a] -= dt;
      if (wait[a] <= 0) {
        // Toggle on/off: on for 0.1-0.35 s, off for 0.05-0.3 s (shorter gaps when hot).
        if (life[a] > 0) {
          life[a] = 0;
          wait[a] = (0.05 + Math.random() * 0.25) * (1 - 0.7 * hot);
        } else {
          life[a] = 1;
          wait[a] = 0.1 + Math.random() * 0.25;
          ang[a] = Math.random() * Math.PI * 2;
          span[a] = 0.45 + Math.random() * 0.7 + hot * 0.5;
        }
      }
      if (a >= active || life[a] <= 0) {
        hide(a);
        continue;
      }
      ang[a] += spin[a] * dt * (1 + 2 * hot);
      const sp = span[a];
      const lift = 0.05 + 0.07 * hot;
      for (let i = 0; i < PTS; i++) {
        const t = i / SEG;
        const th = ang[a] + sp * (t - 0.5);
        const end = i === 0 || i === SEG;
        const phi = 0.55 + (Math.random() - 0.5) * 0.7;
        const rr = TOR_r + 0.005 + (end ? 0 : Math.random() * lift * Math.sin(Math.PI * t));
        const rho = TOR_R + rr * Math.cos(phi);
        pts[i * 3] = Math.cos(th) * rho;
        pts[i * 3 + 1] = TOR_Y + rr * Math.sin(phi);
        pts[i * 3 + 2] = TZ + Math.sin(th) * rho;
      }
      const tm = ang[a];
      // Ribbon width across the tube (radial + up), so it reads from the chase camera above.
      writeRibbon(a, 0, 0.035 + 0.025 * hot, Math.cos(tm) * 0.45, 0.89, Math.sin(tm) * 0.45);
      writeRibbon(a, 1, 0.01 + 0.006 * hot, Math.cos(tm) * 0.45, 0.89, Math.sin(tm) * 0.45);
    }
    // Spark gaps: a snap every 1-4 s idle, every 0.15-0.5 s while hot.
    for (let g = 0; g < GAPS.length; g++) {
      const a = TOR_ARCS + g;
      life[a] -= dt;
      wait[a] -= dt;
      if (wait[a] <= 0) {
        wait[a] = hot > 0.3 ? 0.15 + Math.random() * 0.35 : 1 + Math.random() * 3;
        life[a] = maxLife[a] = 0.06 + Math.random() * 0.05;
      }
      if (life[a] > 0) straight(a, 0.06, 0.03 * (0.5 + life[a] / maxLife[a]));
      else hide(a);
    }
    // Field rods: tip-to-toroid arcs while extended.
    for (let r = 0; r < 4; r++) {
      const a = TOR_ARCS + GAPS.length + r;
      life[a] -= dt;
      wait[a] -= dt;
      if (fieldT > 0.6 && wait[a] <= 0) {
        wait[a] = 0.06 + Math.random() * 0.18;
        life[a] = maxLife[a] = 0.07 + Math.random() * 0.06;
        const d = rodDirs[r];
        const b = rodBase[r];
        const e = a * 6;
        ends[e] = b.x + d.x * L;
        ends[e + 1] = b.y + d.y * L;
        ends[e + 2] = b.z + d.z * L;
        // To the toroid's underside on the same bearing.
        const h = Math.hypot(d.x, d.z) || 1;
        ends[e + 3] = (d.x / h) * TOR_R;
        ends[e + 4] = TOR_Y - TOR_r * 0.8;
        ends[e + 5] = TZ + (d.z / h) * TOR_R;
      }
      if (life[a] > 0 && fieldT > 0.5) straight(a, 0.22, 0.05 * (0.5 + life[a] / maxLife[a]));
      else hide(a);
    }
    posAttr.needsUpdate = true;
  };

  return { group, parts: { coilTops, underglowMat, update } };
}
