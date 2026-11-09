import * as THREE from 'three';
import { mergeStatic } from '../../render/mergeStatic';
import { makeShadowProxy } from '../../render/shadowProxy';
import { addMesh, type VehicleBuild, type VehicleBuildIn } from './types';

/** What the Plow feeds the TESLA ROVER rig every frame (VoltVehicleParts.update). */
export interface VoltRigState {
  /** ARC LANCE (SPACE) is firing: the halo ring flares, its crawling arcs multiply, the emitter prongs chatter. */
  arc: boolean;
  /** STATIC FIELD (E) active, 0..1: the four field emitter rods telescope out round the tower and arc to it. */
  field: number;
}

/** VOLT-9 / TESLA ROVER animatable parts. */
export interface VoltVehicleParts {
  /** Two points on the halo ring rim (the Plow's idle lightning jumps between them; Plow.coilTops). */
  coilTops: THREE.Object3D[];
  /** Under-glow light-bar material (pulsed by the Plow). */
  underglowMat: THREE.MeshBasicMaterial;
  /** Halo arcs, emitter prongs, field rods, maglev rings, plasma column, holo meters: call once per frame while shown. */
  update(dt: number, s: VoltRigState): void;
}

/** Tower axis (model z) and the halo ring: centre height, major radius, tube radius. */
const TZ = -0.3;
const TOR_Y = 3.03;
const TOR_R = 0.42;
const TOR_r = 0.12;
/** Static Field emitter rods: sleeve-top radius on the pedestal, outward lean (rad), extended length. */
const ROD_R = 0.36;
const ROD_LEAN = 0.5;
const ROD_LEN = 0.95;
const DRUM_TOP = 1.47;
/** Emitter prong pairs on the deck corners: x, z, prong-tip height, half gap. */
const GAPS: readonly (readonly [number, number])[] = [[-0.74, 1.5], [0.74, 1.5], [-0.78, -1.62], [0.78, -1.62]];
const GAP_Y = 1.44;
const GAP_HALF = 0.06;
/** Containment tube: span (y) of the plasma column, and the travelling magnetic field rings. */
const TUBE_Y0 = 1.965;
const TUBE_Y1 = 2.74;
const FIELD_RINGS = 4;
/** Maglev rings hovering round the tower spine: rest heights. */
const LEV_Y = [1.58, 1.7, 1.82] as const;
/** Arc pool: halo crawlers (the first TOR_IDLE run all the time), one per prong pair, one per emitter rod. */
const TOR_ARCS = 6;
const TOR_IDLE = 3;
const N_ARCS = TOR_ARCS + GAPS.length + 4;
const SEG = 6;
const PTS = SEG + 1;

const GLOW = 0x2fb8ff;

/** Faceted normals (the game's flat-shaded look) without touching the shared materials' flatShading flag. */
function facet(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  n.computeVertexNormals();
  return n;
}

/** A slab (w x h x d, centred) whose plan corners are cut (seg 1 = a clean 45-degree chamfer, more = rounded) and
 *  whose top/bottom edges are bevelled: the rover's composite panel form. */
function slab(w: number, h: number, d: number, r: number, bevel = 0.03, seg = 1): THREE.BufferGeometry {
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

/** Label atlas (512 x 128): HV CORE strip, CELL BAY, VOLT-9, HV-9 tag. Pixel rects. */
const LBL = { core: [0, 0, 256, 64], cell: [256, 0, 256, 64], name: [0, 64, 256, 64], hv: [256, 64, 128, 64] } as const;
let atlasTex: THREE.CanvasTexture | null = null;
function labelAtlas(): THREE.CanvasTexture {
  if (atlasTex) return atlasTex;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1d222a';
  g.fillRect(0, 0, 512, 128);
  /** A graphite plate with a thin blue edge line, a short accent bar and clean lettering. */
  const plate = (r: readonly number[], bg: string, fg: string, text: string, size: number, accent: string) => {
    g.fillStyle = bg;
    g.fillRect(r[0] + 2, r[1] + 2, r[2] - 4, r[3] - 4);
    g.fillStyle = accent;
    g.fillRect(r[0] + 8, r[1] + r[3] - 12, r[2] - 16, 3);
    g.fillRect(r[0] + 8, r[1] + 12, 6, r[3] - 28);
    g.fillStyle = fg;
    g.font = `bold ${size}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, r[0] + r[2] / 2 + 6, r[1] + r[3] / 2 - 2);
  };
  plate(LBL.core, '#232a33', '#7fd8ff', '⚡ HV CORE', 30, '#2fb8ff');
  plate(LBL.cell, '#e6eaee', '#2a313c', 'CELL BAY', 30, '#2fb8ff');
  plate(LBL.name, '#232a33', '#eaf6ff', 'VOLT-9', 40, '#2fb8ff');
  plate(LBL.hv, '#2fb8ff', '#0e1a26', 'HV-9', 30, '#eaf6ff');
  atlasTex = new THREE.CanvasTexture(c);
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.anisotropy = 4;
  return atlasTex;
}

/** Point `geo`'s 0..1 UVs at an atlas rect. */
function atlasUV(geo: THREE.BufferGeometry, r: readonly number[]): THREE.BufferGeometry {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (r[0] + uv.getX(i) * r[2]) / 512, 1 - (r[1] + (1 - uv.getY(i)) * r[3]) / 128);
  return geo;
}

/** A smooth conduit along `pts` with a thin light line riding on top of it. */
function conduit(pts: THREE.Vector3[], r: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const body = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, r, 6, false);
  const line = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => p.clone().setY(p.y + r * 0.85))), 24, r * 0.32, 4, false);
  return [body, line];
}

const _v = new THREE.Vector3();

/* TESLA ROVER: a low, wide sci-fi lab platform carrying a tall energy-coil tower. Pale composite deck panels (Paint
 * Shop body) with chamfered corners over a graphite tub (trim), electric-blue light lines, a sloped sensor nose with
 * LED strips, a visor-eyed sensor head with a floating holo meter, four hex power cells a side set into the deck on a
 * lit rail, a rear HV core module feeding the tower through clean lit conduits, and metallic emitter prongs on the
 * deck corners. The tower: a composite pedestal (four telescoping Static Field emitter rods in its rim), maglev rings
 * hovering round a graphite spine, a glass containment tube holding a plasma column with magnetic field rings
 * travelling up it, and a segmented energy halo ring hovering on top round a plasma orb. Static parts merge per
 * material; the arcs are one pooled additive ribbon mesh rewritten in place. */
export function buildVoltVehicle({ mats, chassis }: VehicleBuildIn): VehicleBuild<VoltVehicleParts> {
  const group = new THREE.Group();
  const graphite = new THREE.MeshStandardMaterial({ color: 0x252a32, roughness: 0.38, metalness: 0.55 });
  const satin = new THREE.MeshStandardMaterial({ color: 0xc6ced8, roughness: 0.26, metalness: 0.75 });
  const ceramic = new THREE.MeshStandardMaterial({ color: 0xf2f5f8, roughness: 0.22, metalness: 0.1 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x0b1420, roughness: 0.08, metalness: 0.7, emissive: 0x06263e, emissiveIntensity: 0.6 });
  const tubeGlass = new THREE.MeshStandardMaterial({ color: 0xbfeaff, roughness: 0.04, metalness: 0.2, emissive: 0x0a4a70, emissiveIntensity: 0.35, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
  // The halo ring: white composite with a blue glow of its own (pulsed / flared in update) so its facets still read.
  const toroidMat = new THREE.MeshStandardMaterial({ color: 0xe6f4fc, roughness: 0.25, metalness: 0.3, emissive: GLOW, emissiveIntensity: 0.5 });
  const labelMat = new THREE.MeshStandardMaterial({ map: labelAtlas(), roughness: 0.4, metalness: 0.1 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true) => addMesh(geo, mat, x, y, z, group, shadow);

  /* ---- Platform: graphite tub over the chassis, the pale composite deck on top (overhanging the wheels). */
  add(chassis, mats.dark, 0, 0.62, 0.05);
  add(slab(1.5, 0.34, 3.85, 0.26), mats.trim, 0, 0.84, -0.05);
  add(slab(1.9, 0.22, 3.6, 0.36), mats.paint, 0, 1.11, -0.07);
  // Graphite inlay down the deck spine (front half) with a light line in it.
  add(slab(0.5, 0.02, 0.5, 0.12, 0.006), graphite, 0, 1.226, 1.55);
  add(new THREE.BoxGeometry(0.03, 0.012, 0.42), mats.coil, 0, 1.24, 1.55, false);
  // Sloped sensor nose (graphite) under the deck lip: LED headlight strips + a centre light bar.
  const nose = new THREE.Group();
  nose.position.set(0, 0.9, 1.9);
  nose.rotation.x = 0.5;
  group.add(nose);
  addMesh(slab(1.56, 0.26, 0.42, 0.1, 0.03), graphite, 0, 0, 0, nose);
  for (const x of [-0.48, 0.48]) {
    addMesh(new THREE.BoxGeometry(0.34, 0.035, 0.02), mats.head, x, 0.02, 0.215, nose, false);
    addMesh(new THREE.BoxGeometry(0.22, 0.02, 0.02), mats.head, x * 1.08, -0.045, 0.215, nose, false);
  }
  addMesh(new THREE.BoxGeometry(0.4, 0.025, 0.02), mats.coil, 0, -0.01, 0.215, nose, false);
  // Electric-blue light line along the deck's lower edge, a second along the tub; rear light strips.
  for (const x of [-0.955, 0.955]) {
    add(new THREE.BoxGeometry(0.025, 0.03, 2.9), mats.coil, x, 1.03, -0.07, false);
    add(new THREE.BoxGeometry(0.02, 0.02, 2.4), mats.coil, x * 0.79, 0.78, -0.05, false);
  }
  for (const x of [-0.6, 0.6]) add(new THREE.BoxGeometry(0.42, 0.035, 0.02), mats.coil, x, 1.1, -1.88, false);
  // Rear ion thruster (Plow dash flame mount): satin ring, dark throat, blue core.
  add(facet(new THREE.TorusGeometry(0.15, 0.035, 5, 12)), satin, 0, 1.05, -1.99);
  add(new THREE.CircleGeometry(0.13, 12), mats.dark, 0, 1.05, -1.985, false).rotation.y = Math.PI;
  add(new THREE.CircleGeometry(0.07, 10), mats.coil, 0, 1.05, -1.995, false).rotation.y = Math.PI;
  // Clean panel seams on the deck top + side faces.
  for (const z of [1.3, -0.98]) add(new THREE.BoxGeometry(1.74, 0.008, 0.018), graphite, 0, 1.223, z, false);
  for (const x of [-1, 1]) {
    for (const z of [1.02, -1.05]) add(new THREE.BoxGeometry(0.01, 0.13, 0.018), graphite, x * 0.951, 1.12, z, false);
  }

  /* ---- Sensor head (the rover's face): a chamfered pod with a dark visor band and a scanner light. */
  add(slab(0.84, 0.3, 0.55, 0.14), mats.paint, 0, 1.35, 1.0);
  add(slab(0.74, 0.11, 0.06, 0.03, 0.012), visorMat, 0, 1.37, 1.262);
  add(new THREE.BoxGeometry(0.5, 0.018, 0.02), mats.coil, 0, 1.37, 1.296, false);
  for (const x of [-0.27, 0.27]) add(new THREE.BoxGeometry(0.08, 0.04, 0.02), mats.head, x, 1.37, 1.296, false);
  for (const x of [-1, 1]) {
    const nm = add(atlasUV(new THREE.PlaneGeometry(0.42, 0.105), LBL.name), labelMat, x * 0.423, 1.35, 1.0, false);
    nm.rotation.y = (x * Math.PI) / 2;
  }
  // Holo meter: an emitter bar on the head's back edge, a translucent pane hovering above it (tilted at the chase cam).
  const holoTilt = -Math.PI / 2 - 0.62;
  const holo = new THREE.Group();
  holo.position.set(0, 1.53, 0.72);
  holo.rotation.set(holoTilt, 0, Math.PI);
  group.add(holo);
  addMesh(slab(0.74, 0.05, 0.08, 0.03, 0.012), graphite, 0, -0.1, -0.02, holo).rotation.x = Math.PI / 2;
  addMesh(new THREE.BoxGeometry(0.62, 0.012, 0.012), mats.coil, 0, -0.1, 0.01, holo, false);
  const HOLO_Y = [-0.035, 0.015, 0.065];

  /* ---- Power cells: four hex modules a side set into the deck in graphite sockets, a lit rail along their caps. */
  const JAR_X = 0.74;
  const JAR_Z = [0.78, 0.3, -0.18, -0.66];
  for (const sx of [-1, 1]) {
    const x = sx * JAR_X;
    add(slab(0.36, 0.03, 1.92, 0.1, 0.01), graphite, x, 1.235, 0.06);
    for (const z of JAR_Z) {
      add(facet(new THREE.CylinderGeometry(0.12, 0.13, 0.26, 6)), ceramic, x, 1.37, z);
      add(facet(new THREE.CylinderGeometry(0.124, 0.124, 0.07, 6)), mats.coil, x, 1.38, z, false);
      add(facet(new THREE.CylinderGeometry(0.1, 0.118, 0.04, 6)), graphite, x, 1.52, z);
    }
    // Lit rail along the cell caps, then a conduit down to the tower pedestal.
    add(new THREE.BoxGeometry(0.06, 0.025, 1.56), graphite, x, 1.55, 0.06);
    add(new THREE.BoxGeometry(0.018, 0.012, 1.5), mats.coil, x, 1.567, 0.06, false);
    const [cb, cl] = conduit([new THREE.Vector3(x, 1.55, TZ - 0.1), new THREE.Vector3(sx * 0.62, 1.48, TZ - 0.05), new THREE.Vector3(sx * 0.53, 1.36, TZ)], 0.03);
    add(cb, graphite, 0, 0, 0);
    add(cl, mats.coil, 0, 0, 0, false);
    // Small HV tag on each deck flank, ahead of the front wheels' arch line.
    const hv = add(atlasUV(new THREE.PlaneGeometry(0.2, 0.1), LBL.hv), labelMat, sx * 0.953, 1.11, 1.36, false);
    hv.rotation.y = (sx * Math.PI) / 2;
  }

  /* ---- Rear: the HV core module (light-slatted top, side pods), feeding the tower through two lit conduits. */
  add(slab(1.2, 0.3, 0.38, 0.1), mats.trim, 0, 1.37, -1.64);
  for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.035, 0.012, 0.26), mats.coil, -0.32 + i * 0.16, 1.526, -1.64, false);
  add(atlasUV(new THREE.PlaneGeometry(0.44, 0.11), LBL.core), labelMat, 0, 1.37, -1.833, false).rotation.y = Math.PI;
  for (const sx of [-1, 1]) {
    add(slab(0.12, 0.24, 0.32, 0.04, 0.02), graphite, sx * 0.64, 1.37, -1.64);
    add(new THREE.BoxGeometry(0.01, 0.16, 0.025), mats.coil, sx * 0.703, 1.37, -1.64, false);
  }
  for (const sx of [-1, 1]) {
    const x = sx * 0.17;
    add(facet(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 8)), satin, x, 1.56, -1.56);
    const [cb, cl] = conduit([new THREE.Vector3(x, 1.58, -1.56), new THREE.Vector3(x * 0.9, 1.8, -1.34), new THREE.Vector3(x * 0.8, 1.94, -0.94), new THREE.Vector3(x * 0.75, 1.88, -0.6)], 0.035);
    add(cb, graphite, 0, 0, 0);
    add(cl, mats.coil, 0, 0, 0, false);
  }
  // Rear deck: a flush cell-bay panel each side (status light + CELL BAY plate).
  for (const sx of [-1, 1]) {
    add(slab(0.3, 0.02, 0.3, 0.06, 0.006), graphite, sx * 0.6, 1.23, -1.2);
    add(atlasUV(new THREE.PlaneGeometry(0.24, 0.06), LBL.cell), labelMat, sx * 0.6, 1.242, -1.25, false).rotation.set(-Math.PI / 2, 0, Math.PI);
    add(new THREE.BoxGeometry(0.14, 0.012, 0.02), mats.coil, sx * 0.6, 1.243, -1.11, false);
  }

  /* ---- Emitter prongs on the deck corners: a graphite pad, two satin posts with tapered prongs facing each other. */
  for (const [x, z] of GAPS) {
    add(slab(0.18, 0.03, 0.32, 0.05, 0.01), graphite, x, 1.235, z);
    add(new THREE.BoxGeometry(0.1, 0.008, 0.02), mats.coil, x, 1.252, z, false);
    for (const s of [-1, 1]) {
      add(facet(new THREE.CylinderGeometry(0.025, 0.04, 0.2, 6)), satin, x, 1.34, z + s * 0.12);
      const prong = add(facet(new THREE.ConeGeometry(0.03, 0.09, 6)), satin, x, GAP_Y, z + s * (GAP_HALF + 0.045));
      prong.rotation.x = (s * -Math.PI) / 2;
    }
  }

  /* ---- The tower. */
  // Pedestal with a lit rim, a graphite spine for the maglev rings.
  add(facet(new THREE.CylinderGeometry(0.48, 0.56, 0.25, 12)), mats.paint, 0, 1.345, TZ);
  add(facet(new THREE.TorusGeometry(0.47, 0.022, 4, 24)).rotateX(Math.PI / 2), mats.coil, 0, DRUM_TOP, TZ, false);
  add(facet(new THREE.CylinderGeometry(0.34, 0.4, 0.06, 12)), graphite, 0, 1.5, TZ);
  add(facet(new THREE.CylinderGeometry(0.08, 0.1, 0.46, 8)), graphite, 0, 1.73, TZ);
  // Containment section: lower + upper collars, three slim struts, the glass tube (the plasma column animates inside).
  add(facet(new THREE.CylinderGeometry(0.3, 0.28, 0.07, 12)), mats.paint, 0, 1.93, TZ);
  add(facet(new THREE.TorusGeometry(0.3, 0.012, 3, 24)).rotateX(Math.PI / 2), mats.coil, 0, 1.965, TZ, false);
  add(facet(new THREE.CylinderGeometry(0.27, 0.29, 0.06, 12)), mats.paint, 0, 2.77, TZ);
  add(facet(new THREE.TorusGeometry(0.28, 0.012, 3, 24)).rotateX(Math.PI / 2), mats.coil, 0, 2.738, TZ, false);
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3 + Math.PI / 6;
    add(new THREE.BoxGeometry(0.03, 0.8, 0.03), satin, Math.sin(a) * 0.255, 2.35, TZ + Math.cos(a) * 0.255);
  }
  add(new THREE.CylinderGeometry(0.2, 0.2, TUBE_Y1 - TUBE_Y0, 14, 1, true), tubeGlass, 0, (TUBE_Y0 + TUBE_Y1) / 2, TZ, false);
  // Neck: a satin emitter cone under the hovering halo.
  add(facet(new THREE.CylinderGeometry(0.06, 0.11, 0.12, 8)), graphite, 0, 2.86, TZ);
  add(facet(new THREE.ConeGeometry(0.07, 0.14, 8)), satin, 0, 2.98, TZ);
  // Halo ring: segmented (graphite bands) with a lit inner edge.
  add(facet(new THREE.TorusGeometry(TOR_R, TOR_r, 8, 24)).rotateX(Math.PI / 2), toroidMat, 0, TOR_Y, TZ, false);
  add(facet(new THREE.TorusGeometry(TOR_R - TOR_r - 0.005, 0.018, 3, 24)).rotateX(Math.PI / 2), mats.coil, 0, TOR_Y, TZ, false);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const band = add(new THREE.BoxGeometry(0.028, TOR_r * 2 + 0.008, TOR_r * 2 + 0.008), graphite, Math.cos(a) * TOR_R, TOR_Y, TZ + Math.sin(a) * TOR_R);
    band.rotation.y = -a;
  }
  // Emitter rod sleeves round the pedestal rim (the rods telescope out of them).
  const rodDirs: THREE.Vector3[] = [];
  const rodBase: THREE.Vector3[] = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const ox = Math.sin(a);
    const oz = Math.cos(a);
    const dir = new THREE.Vector3(ox * Math.sin(ROD_LEAN), Math.cos(ROD_LEAN), oz * Math.sin(ROD_LEAN));
    const base = new THREE.Vector3(ox * ROD_R, DRUM_TOP, TZ + oz * ROD_R);
    const sleeve = add(facet(new THREE.CylinderGeometry(0.045, 0.06, 0.22, 6)), graphite, base.x + dir.x * 0.08, base.y + dir.y * 0.08, base.z + dir.z * 0.08);
    sleeve.quaternion.setFromUnitVectors(_v.set(0, 1, 0), dir);
    const ring = add(facet(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 6)), mats.coil, base.x + dir.x * 0.18, base.y + dir.y * 0.18, base.z + dir.z * 0.18, false);
    ring.quaternion.copy(sleeve.quaternion);
    rodBase.push(base.addScaledVector(dir, 0.19));
    rodDirs.push(dir);
  }

  // Coil tops: the Plow's idle bolt jumps across the halo between these.
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
  const additive = (color: number, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  // Holo meter pane + three light-strip bars (same frame as the emitter bar): charge, field, core load.
  const holoRoot = new THREE.Group();
  holoRoot.position.copy(holo.position);
  holoRoot.rotation.copy(holo.rotation);
  const paneMat = additive(GLOW, 0.16);
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.17), paneMat);
  pane.position.set(0, 0.015, 0.02);
  pane.renderOrder = 6;
  holoRoot.add(pane);
  const frameMat = additive(0x7fd8ff, 0.55);
  for (const y of [-0.072, 0.102]) {
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.006), frameMat);
    edge.position.set(0, y, 0.021);
    edge.renderOrder = 6;
    holoRoot.add(edge);
  }
  const barGeo = new THREE.PlaneGeometry(1, 0.026).translate(0.5, 0, 0);
  const barMat = additive(0x9fe8ff, 0.9);
  const bars: THREE.Mesh[] = [];
  for (const y of HOLO_Y) {
    const b = new THREE.Mesh(barGeo, barMat);
    b.position.set(-0.27, y, 0.023);
    b.renderOrder = 7;
    holoRoot.add(b);
    bars.push(b);
  }
  group.add(holoRoot);

  // Maglev rings hovering round the spine: a white composite ring with a lit outer edge, bobbing out of phase.
  const levGeo = facet(new THREE.CylinderGeometry(0.27, 0.29, 0.035, 12, 1, true));
  const levInner = facet(new THREE.CylinderGeometry(0.15, 0.15, 0.035, 12, 1, true));
  const levTop = new THREE.RingGeometry(0.15, 0.27, 12, 1).rotateX(-Math.PI / 2).translate(0, 0.0175, 0);
  const levBot = new THREE.RingGeometry(0.15, 0.29, 12, 1).rotateX(Math.PI / 2).translate(0, -0.0175, 0);
  const levEdge = facet(new THREE.TorusGeometry(0.285, 0.012, 3, 24)).rotateX(Math.PI / 2);
  const levRings: THREE.Group[] = [];
  for (let i = 0; i < LEV_Y.length; i++) {
    const r = new THREE.Group();
    r.position.set(0, LEV_Y[i], TZ);
    const sc = 1 - i * 0.12;
    r.scale.set(sc, 1, sc);
    for (const g of [levGeo, levInner, levTop, levBot]) r.add(new THREE.Mesh(g, ceramic));
    r.add(new THREE.Mesh(levEdge, mats.coil));
    group.add(r);
    levRings.push(r);
  }

  // Plasma column inside the containment tube: a bright core and a soft sheath.
  const plasmaMat = additive(0xbfefff, 0.85);
  const plasmaGlowMat = additive(GLOW, 0.22);
  const plasma = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, TUBE_Y1 - TUBE_Y0 - 0.02, 8, 1, true), plasmaMat);
  const plasmaGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, TUBE_Y1 - TUBE_Y0 - 0.02, 10, 1, true), plasmaGlowMat);
  for (const m of [plasma, plasmaGlow]) {
    m.position.set(0, (TUBE_Y0 + TUBE_Y1) / 2, TZ);
    m.renderOrder = 6;
    group.add(m);
  }
  // Magnetic field rings travelling up the tube (outside the glass).
  const fieldGeo = facet(new THREE.TorusGeometry(0.215, 0.014, 3, 20)).rotateX(Math.PI / 2);
  const fieldRings: THREE.Mesh[] = [];
  for (let i = 0; i < FIELD_RINGS; i++) {
    const m = new THREE.Mesh(fieldGeo, mats.coil);
    m.position.set(0, TUBE_Y0, TZ);
    group.add(m);
    fieldRings.push(m);
  }
  // Plasma orb hovering at the centre of the halo.
  const orbMat = additive(0xd8f6ff, 0.9);
  const orb = new THREE.Mesh(facet(new THREE.IcosahedronGeometry(0.1, 1)), orbMat);
  orb.position.set(0, TOR_Y + 0.07, TZ);
  orb.renderOrder = 7;
  group.add(orb);
  const orbGlowMat = additive(GLOW, 0.25);
  const orbGlow = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 1), orbGlowMat);
  orbGlow.position.copy(orb.position);
  orbGlow.renderOrder = 6;
  group.add(orbGlow);

  // Static Field emitter rods: a satin rod (scaled along its axis) with a glowing tip node.
  const rodGeo = new THREE.CylinderGeometry(0.018, 0.026, 1, 6).translate(0, 0.5, 0);
  const tipGeo = facet(new THREE.OctahedronGeometry(0.06, 0));
  const rods: THREE.Mesh[] = [];
  const tips: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();
    pivot.position.copy(rodBase[i]);
    pivot.quaternion.setFromUnitVectors(_v.set(0, 1, 0), rodDirs[i]);
    const rod = new THREE.Mesh(rodGeo, satin);
    const tip = new THREE.Mesh(tipGeo, mats.coil);
    pivot.add(rod, tip);
    group.add(pivot);
    rods.push(rod);
    tips.push(tip);
  }

  // Halo corona: a faint additive sheath that flares while the lance fires.
  const haloMat = new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0.04, blending: THREE.AdditiveBlending, depthWrite: false });
  const halo = new THREE.Mesh(new THREE.TorusGeometry(TOR_R, TOR_r + 0.07, 6, 24).rotateX(Math.PI / 2), haloMat);
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

  // Per-arc state: life left / max (s), next re-trigger timer, halo crawl angle / speed / span, straight endpoints.
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
    ends.set([x, GAP_Y, z - GAP_HALF, x, GAP_Y, z + GAP_HALF], (TOR_ARCS + g) * 6);
  }

  let time = 0;
  let fieldT = 0;
  let arcK = 0;
  let ringT = 0;

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
      tips[i].rotation.y = time * 3;
    }
    // Holo meters: charge (lance), field, and a lazy core-load wobble that jitters when hot.
    bars[0].scale.x = 0.54 * (0.25 + 0.7 * arcK + 0.04 * Math.sin(time * 9));
    bars[1].scale.x = 0.54 * (0.15 + 0.8 * fieldT + 0.03 * Math.sin(time * 13));
    bars[2].scale.x = 0.54 * (0.5 + 0.2 * Math.sin(time * 0.7) + hot * 0.15 * Math.sin(time * 31));
    paneMat.opacity = 0.13 + 0.03 * Math.sin(time * 5) + 0.1 * hot;
    // Maglev rings bob out of phase, tighter and faster when hot.
    for (let i = 0; i < levRings.length; i++) {
      levRings[i].position.y = LEV_Y[i] + Math.sin(time * (2.2 + 3 * hot) + i * 2.1) * 0.012;
      levRings[i].rotation.y = time * (0.4 + i * 0.25) * (i % 2 ? -1 : 1) * (1 + 3 * hot);
    }
    // Field rings climb the tube (faster when hot); each fades in at the bottom and out at the top via its scale.
    ringT = (ringT + dt * (0.35 + 1.4 * hot)) % 1;
    for (let i = 0; i < FIELD_RINGS; i++) {
      const u = (ringT + i / FIELD_RINGS) % 1;
      fieldRings[i].position.y = TUBE_Y0 + 0.04 + (TUBE_Y1 - TUBE_Y0 - 0.08) * u;
      const k = 0.85 + 0.15 * Math.sin(Math.PI * u);
      fieldRings[i].scale.set(k, 1, k);
    }
    // Plasma column + orb shimmer, flaring with the lance / field.
    const flick = Math.sin(time * 23) * Math.sin(time * 7.7);
    plasma.scale.set(1 + 0.15 * flick + 0.4 * hot, 1, 1 + 0.15 * flick + 0.4 * hot);
    plasmaGlowMat.opacity = 0.18 + 0.06 * flick + 0.25 * hot;
    plasmaMat.opacity = 0.75 + 0.15 * flick;
    orb.scale.setScalar(1 + 0.08 * flick + 0.35 * arcK + 0.15 * fieldT);
    orb.rotation.y = time * 1.7;
    orbGlow.scale.setScalar(1 + 0.12 * Math.sin(time * 5) + 0.8 * arcK + 0.3 * fieldT);
    orbGlowMat.opacity = 0.2 + 0.05 * flick + 0.25 * hot;
    haloMat.opacity = 0.03 + 0.02 * Math.sin(time * 11) + 0.3 * arcK + 0.12 * fieldT;
    toroidMat.emissiveIntensity = 0.45 + 0.12 * Math.sin(time * 7.3) * Math.sin(time * 3.1) + 1.1 * arcK + 0.5 * fieldT;

    // Halo crawlers: hug the outer-top of the tube, drift round it, blink.
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
    // Emitter prongs: a snap every 1-4 s idle, every 0.15-0.5 s while hot.
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
    // Field rods: tip-to-halo arcs while extended.
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
        // To the halo's underside on the same bearing.
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
