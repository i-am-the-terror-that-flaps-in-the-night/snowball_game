import * as THREE from 'three';
import { hazardTexture } from '../plowModels';
import { mergeStatic } from '../../render/mergeStatic';
import { makeShadowProxy } from '../../render/shadowProxy';
import { addMesh, type VehicleBuild, type VehicleBuildIn } from './types';

/* ISOTOPE — REACTOR HAULER: "a power plant on wheels". Nuclear-industrial, not military: a long low flatbed in
 * rad-suit yellow and lead grey carrying a rounded pressure vessel in bolted containment bands, with green-glowing
 * viewing ports, control rods (indicator caps) bobbing out of a drive housing on top, a manway hatch, coolant tanks
 * on the deck, a pipe manifold with valve handwheels and pressure gauges, twin hyperboloid cooling stacks breathing
 * vapour, a trefoil vent fan in the tail dome and twin coolant dump valves under the rear bumper (FALLOUT TRAIL).
 * Up front, a lead radiation bulkhead shields a stubby, lead-lined cab (armoured port windows, a filtered roof vent,
 * a hazard light bar, a rotating beacon) that carries the RAD SPRAYER: an articulated boom on a roof turret reaching
 * over the nose to a nozzle assembly whose tip is the spray origin (combat/isotope.ts NOZZLE_Y / NOZZLE_Z).
 *
 * Paint Shop: `paint` = cab, vessel shell + domes, boom, deck rails, front fenders (rad-suit yellow); `trim` = lead
 * shielding (bulkhead, containment bands, flanges, stacks, roof plate, kick plates, rear fenders). Static parts are
 * merged per material with a shadow proxy; moving parts animate themselves from the clock (onBeforeRender, nothing
 * while hidden, no allocation) and ease toward the spray / trail state the Plow feeds `update`. Model space: facing
 * +Z, ground y = 0. */

/** What the Plow feeds the hauler every frame (set by combat/isotope.ts). */
export interface IsotopeRigState {
  /** RAD SPRAYER held. */
  spray: boolean;
  /** FALLOUT TRAIL dumping coolant. */
  trail: boolean;
}

/** ISOTOPE / REACTOR HAULER animatable parts. */
export interface IsotopeVehicleParts {
  /** Reactor core glow material (pulsed by the Plow). */
  coreMat: THREE.MeshStandardMaterial;
  update(dt: number, s: IsotopeRigState): void;
}

/** RAD SPRAYER nozzle tip (model space): combat/isotope.ts sprays from here. */
export const ISOTOPE_NOZZLE = new THREE.Vector3(0, 1.95, 2.53);

/** Reactor vessel: lies along Z on the flatbed (centre / radius / cylinder length / dome depth). */
const TANK_Z = -0.85;
const TANK_Y = 1.68;
const TANK_R = 0.62;
const TANK_L = 1.8;
const DOME = 0.3;
/** Deck top. */
const DECK = 1.1;

/* ------------------------------------------------------------------------------------------------ textures */

/** Black trefoil on yellow in a black ring, centred at (cx, cy), radius r. */
function drawTrefoil(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.fillStyle = '#141414';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f2d21b';
  g.beginPath();
  g.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#141414';
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
    g.beginPath();
    g.arc(cx, cy, r * 0.78, a - 0.52, a + 0.52);
    g.arc(cx, cy, r * 0.24, a + 0.52, a - 0.52, true);
    g.fill();
  }
  g.beginPath();
  g.arc(cx, cy, r * 0.15, 0, Math.PI * 2);
  g.fill();
}

/** Stencil / sign atlas (256 x 256): four 256 x 32 text rows, a trefoil and a pressure-gauge dial. Pixel rects. */
const REG = {
  rad: [0, 0, 256, 32],
  hot: [0, 32, 256, 32],
  cool: [0, 64, 256, 32],
  name: [0, 96, 256, 32],
  tref: [0, 128, 128, 128],
  gauge: [128, 128, 128, 128],
} as const;
type Region = (typeof REG)[keyof typeof REG];

let atlas: THREE.CanvasTexture | null | undefined;
/** The sign atlas (canvas, cached; null without a DOM, e.g. headless tests). */
function atlasTex(): THREE.CanvasTexture | null {
  if (atlas !== undefined) return atlas;
  if (typeof document === 'undefined') return (atlas = null);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const row = (y: number, bg: string, fg: string, text: string, tref: boolean) => {
    g.fillStyle = bg;
    g.fillRect(0, y, 256, 32);
    g.strokeStyle = fg;
    g.lineWidth = 2;
    g.strokeRect(2, y + 2, 252, 28);
    g.fillStyle = fg;
    g.font = 'bold 19px Impact, "Arial Black", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, y + 17);
    if (tref) {
      drawTrefoil(g, 20, y + 16, 11);
      drawTrefoil(g, 236, y + 16, 11);
    }
  };
  row(0, '#f2d21b', '#141414', 'RADIOACTIVE', true);
  row(32, '#141414', '#f2d21b', 'DANGER  HOT CORE', true);
  row(64, '#dfe8ec', '#1d2a33', 'COOLANT  ·  H₂O', false);
  row(96, '#2f3532', '#f2d21b', 'ISO-7 HAULER', false);
  drawTrefoil(g, 64, 192, 62);
  // Pressure gauge: white dial, black rim, ticks over 270 degrees, red zone, needle.
  const gx = 192;
  const gy = 192;
  g.fillStyle = '#141414';
  g.beginPath();
  g.arc(gx, gy, 62, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f4f1e6';
  g.beginPath();
  g.arc(gx, gy, 54, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#d0281e';
  g.lineWidth = 8;
  g.beginPath();
  g.arc(gx, gy, 44, -Math.PI * 0.05, Math.PI * 0.25);
  g.stroke();
  g.strokeStyle = '#141414';
  g.lineWidth = 3;
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
    g.beginPath();
    g.moveTo(gx + Math.cos(a) * 50, gy + Math.sin(a) * 50);
    g.lineTo(gx + Math.cos(a) * (i % 5 ? 42 : 36), gy + Math.sin(a) * (i % 5 ? 42 : 36));
    g.stroke();
  }
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(gx, gy);
  g.lineTo(gx + Math.cos(-0.35) * 44, gy + Math.sin(-0.35) * 44);
  g.stroke();
  g.fillStyle = '#141414';
  g.beginPath();
  g.arc(gx, gy, 7, 0, Math.PI * 2);
  g.fill();
  atlas = new THREE.CanvasTexture(c);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  return atlas;
}

/* ------------------------------------------------------------------------------------------------ geometry */

/** Plane (w x h, facing +Z) showing one atlas region. */
function signGeo(w: number, h: number, [x, y, rw, rh]: Region): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + uv.getX(i) * rw) / 256, 1 - (y + rh - uv.getY(i) * rh) / 256);
  return g;
}

/** Repeat a geometry's UVs (hazard stripes keep their pitch on long panels). */
function tile<G extends THREE.BufferGeometry>(g: G, su: number, sv = 1): G {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}

const cylX = (r: number, len: number, seg = 10) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2);
const cylZ = (r: number, len: number, seg = 10, r2 = r) => new THREE.CylinderGeometry(r2, r, len, seg).rotateX(Math.PI / 2);

/** Side profile (z, y points) extruded across X, `width` wide in total, edges rounded by `bevel`. */
function extrudeX(pts: readonly (readonly [number, number])[], width: number, bevel: number): THREE.BufferGeometry {
  const d = width - 2 * bevel;
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y))), {
    depth: d, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4,
  });
  g.rotateY(-Math.PI / 2);
  g.translate(d / 2, 0, 0);
  return g;
}

/** Rounded-corner block x0..x1, y0..y1, z0..z1 (plan corners radius rad, edges bevelled by b). */
function roundBlock(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, rad: number, b: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const ax = x0 + b;
  const bx = x1 - b;
  const az = -(z1 - b);
  const bz = -(z0 + b);
  s.moveTo(ax + rad, az);
  s.lineTo(bx - rad, az);
  s.quadraticCurveTo(bx, az, bx, az + rad);
  s.lineTo(bx, bz - rad);
  s.quadraticCurveTo(bx, bz, bx - rad, bz);
  s.lineTo(ax + rad, bz);
  s.quadraticCurveTo(ax, bz, ax, bz - rad);
  s.lineTo(ax, az + rad);
  s.quadraticCurveTo(ax, az, ax + rad, az);
  const g = new THREE.ExtrudeGeometry(s, { depth: y1 - y0 - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 3 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0 + b, 0);
  return g;
}

/** Waisted cooling-tower shell (lathe, open), base radius r0 at y 0, waist rw at 0.72 h, lip rt at h. */
function coolingTower(r0: number, rw: number, rt: number, h: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const yw = 0.72 * h;
  for (let i = 0; i <= 10; i++) {
    const y = (i / 10) * h;
    const k = y < yw ? (yw - y) / yw : (y - yw) / (h - yw);
    const r = rw + (y < yw ? r0 - rw : rt - rw) * k * k;
    pts.push(new THREE.Vector2(r, y));
  }
  return new THREE.LatheGeometry(pts, 18);
}

/* ------------------------------------------------------------------------------------------------ builder */

/** REACTOR HAULER. No blade. Rides on the shared chassis + wheels. */
export function buildIsotopeVehicle({ mats, chassis }: VehicleBuildIn): VehicleBuild<IsotopeVehicleParts> {
  const group = new THREE.Group();
  const P = mats.paint;
  const T = mats.trim;
  const D = mats.dark;
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x3dff1a, emissive: 0x3dff1a, emissiveIntensity: 0.9, roughness: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xa9b1b8, roughness: 0.36, metalness: 0.55 });
  const bolt = new THREE.MeshStandardMaterial({ color: 0xb8bfc5, roughness: 0.3, metalness: 0.85 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.8, metalness: 0.05 });
  const red = new THREE.MeshStandardMaterial({ color: 0xc8261e, roughness: 0.45, metalness: 0.25 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xffb02a, emissive: 0xff8a00, emissiveIntensity: 1.6, roughness: 0.3 });
  const tail = new THREE.MeshStandardMaterial({ color: 0xff3a2a, emissive: 0xff1a10, emissiveIntensity: 1.6, roughness: 0.3 });
  /** Cab glass: thick lead glass with a faint green cast. */
  const port = new THREE.MeshStandardMaterial({ color: 0x2a4a3a, roughness: 0.06, metalness: 0.7, emissive: 0x0f3a14, emissiveIntensity: 0.45 });
  /** Spray nozzle tip + dump valve glow (eased by the spray / trail state). */
  const jetMat = new THREE.MeshStandardMaterial({ color: 0x7dff4a, emissive: 0x3dff1a, emissiveIntensity: 0.8, roughness: 0.3 });
  const dumpMat = new THREE.MeshStandardMaterial({ color: 0x7dff4a, emissive: 0x3dff1a, emissiveIntensity: 0.4, roughness: 0.3 });
  const hazTex = typeof document !== 'undefined' ? hazardTexture() : null;
  const hazard = new THREE.MeshStandardMaterial({ color: hazTex ? 0xffffff : 0xffc21a, map: hazTex, roughness: 0.55, metalness: 0.2 });
  const atl = atlasTex();
  const sign = new THREE.MeshStandardMaterial({ color: atl ? 0xffffff : 0xf2d21b, map: atl, roughness: 0.55, alphaTest: 0.5 });

  const A = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = group, shadow = true) => addMesh(geo, mat, x, y, z, parent, shadow);
  const both = (fn: (sx: number) => void) => {
    fn(-1);
    fn(1);
  };
  /** A transform frame for sub-assemblies (flattened by the merge). */
  const frame = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent: THREE.Object3D = group) => {
    const f = new THREE.Group();
    f.position.set(x, y, z);
    f.rotation.set(rx, ry, rz, 'YXZ');
    parent.add(f);
    return f;
  };
  /** Box of section w x h stretched from a to b (body space, top-level only). */
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const beam = (a: readonly number[], b: readonly number[], w: number, h: number, mat: THREE.Material, round = false) => {
    _a.fromArray(a);
    _b.fromArray(b);
    const len = _a.distanceTo(_b);
    const geo = round ? cylZ(w, len, 10) : new THREE.BoxGeometry(w, h, len);
    const m = A(geo, mat, (_a.x + _b.x) / 2, (_a.y + _b.y) / 2, (_a.z + _b.z) / 2);
    m.lookAt(_b);
    return m;
  };
  const hose = (pts: readonly (readonly number[])[], r: number, mat: THREE.Material = rubber) =>
    A(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3().fromArray(p))), 28, r, 6), mat, 0, 0, 0);
  const boltGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.035, 6);
  /** Bolt heads standing radially on a ring of radius r around the Z axis through (0, cy, z). */
  const ringBoltsZ = (n: number, r: number, cy: number, z: number, from = 0) => {
    for (let i = 0; i < n; i++) {
      const a = from + (i / n) * Math.PI * 2;
      A(boltGeo, bolt, Math.sin(a) * r, cy + Math.cos(a) * r, z, group, false).rotation.z = -a;
    }
  };
  /** Bolt heads on a face (frame space, axis +Z) around a circle of radius r. */
  const faceBolts = (f: THREE.Object3D, n: number, r: number, z: number) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      A(boltGeo, bolt, Math.cos(a) * r, Math.sin(a) * r, z, f, false).rotation.x = Math.PI / 2;
    }
  };
  /** A row of bolt heads on a +X / -X facing plate (axis X) from z0 to z1. */
  const rowBoltsX = (x: number, y: number, z0: number, z1: number, n: number) => {
    for (let i = 0; i < n; i++) A(boltGeo, bolt, x, y, z0 + ((z1 - z0) * i) / Math.max(1, n - 1), group, false).rotation.z = Math.PI / 2;
  };
  /** Valve handwheel (red rim + spokes) in frame space, axis +Y. */
  const handwheel = (f: THREE.Object3D, r: number) => {
    A(new THREE.TorusGeometry(r, r * 0.16, 6, 14).rotateX(Math.PI / 2), red, 0, 0, 0, f, false);
    for (const ry of [0, Math.PI / 2]) A(new THREE.BoxGeometry(r * 2, r * 0.14, r * 0.14), red, 0, 0, 0, f, false).rotation.y = ry;
    A(new THREE.CylinderGeometry(r * 0.25, r * 0.25, r * 0.4, 8), steel, 0, 0, 0, f, false);
  };
  /** Pressure gauge (steel can + dial) in frame space, facing +Z. */
  const gauge = (f: THREE.Object3D, r: number) => {
    A(cylZ(r, r * 0.6, 14), steel, 0, 0, -r * 0.3, f);
    A(cylZ(r * 1.05, r * 0.12, 14), bolt, 0, 0, 0.0, f, false);
    A(signGeo(r * 1.8, r * 1.8, REG.gauge), sign, 0, 0, r * 0.07, f, false);
  };

  /* ---- chassis, deck, skirts, fenders */
  A(chassis, D, 0, 0.62, 0.05);
  A(new THREE.BoxGeometry(2.0, 0.12, 2.8), D, 0, DECK - 0.06, -0.75);
  A(new THREE.BoxGeometry(1.4, 0.18, 2.8), D, 0, DECK - 0.21, -0.75);
  both((sx) => {
    A(new THREE.BoxGeometry(0.06, 0.06, 2.8), P, sx * 0.98, DECK + 0.03, -0.75); // yellow deck rail
    // Hazard-striped skirts between the wheels.
    for (const [z0, z1] of [[-2.15, -1.8], [-0.68, 0.66]] as const) A(tile(new THREE.BoxGeometry(0.05, 0.13, z1 - z0), (z1 - z0) / 0.26), hazard, sx * 0.985, DECK - 0.17, (z0 + z1) / 2, group, false);
    // Tie-down rings.
    for (const z of [-2.0, -0.5]) A(new THREE.TorusGeometry(0.05, 0.014, 4, 8).rotateY(Math.PI / 2), bolt, sx * 1.02, DECK - 0.05, z, group, false);
    // Rear fenders: bolted lead guards over the deck wheels; front fenders in paint under the cab.
    const fender = (r: number, w: number) => new THREE.CylinderGeometry(r, r, w, 14, 1, true, 0.15, Math.PI - 0.3).rotateZ(Math.PI / 2);
    A(fender(0.6, 0.5), T, sx * 0.95, 0.48, -1.25);
    A(fender(0.58, 0.48), P, sx * 0.95, 0.48, 1.45);
  });

  /* ---- reactor vessel: yellow shell + domes, lead containment bands and end flanges, all bolted */
  A(new THREE.CylinderGeometry(TANK_R, TANK_R, TANK_L, 32, 1, true).rotateX(Math.PI / 2), P, 0, TANK_Y, TANK_Z);
  for (const s of [-1, 1]) {
    const dome = new THREE.SphereGeometry(TANK_R, 32, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, DOME / TANK_R, 1).rotateX((s * Math.PI) / 2);
    A(dome, P, 0, TANK_Y, TANK_Z + (s * TANK_L) / 2);
    // End flange: a lead ring at the dome seam, bolted all round.
    A(new THREE.TorusGeometry(TANK_R + 0.02, 0.04, 6, 32), T, 0, TANK_Y, TANK_Z + (s * TANK_L) / 2);
    ringBoltsZ(16, TANK_R + 0.06, TANK_Y, TANK_Z + (s * TANK_L) / 2, Math.PI / 16);
    // Containment band: a wide lead hoop with two rows of bolts and a clamp lug on each side.
    const bz = TANK_Z + s * 0.6;
    A(cylZ(TANK_R + 0.04, 0.18, 32), T, 0, TANK_Y, bz);
    for (const dz of [-0.05, 0.05]) ringBoltsZ(14, TANK_R + 0.045, TANK_Y, bz + dz, dz > 0 ? Math.PI / 14 : 0);
    both((sx) => {
      A(new THREE.BoxGeometry(0.1, 0.12, 0.24), T, sx * (TANK_R + 0.08), TANK_Y + 0.06, bz);
      A(cylZ(0.025, 0.3, 6), bolt, sx * (TANK_R + 0.13), TANK_Y + 0.06, bz, group, false);
    });
    // Saddle cradle under the band.
    A(new THREE.BoxGeometry(1.24, 0.24, 0.22), D, 0, DECK + 0.1, bz);
  }
  // Viewing ports: thick green glass in bolted steel bezels on the upper flanks (seen from the chase cam).
  both((sx) => {
    for (const dz of [-0.33, 0.3]) {
      const a = 0.88;
      const f = frame(sx * Math.sin(a) * TANK_R, TANK_Y + Math.cos(a) * TANK_R, TANK_Z + dz, 0, 0, -sx * a);
      A(new THREE.CylinderGeometry(0.15, 0.16, 0.07, 16), steel, 0, 0.0, 0, f);
      A(new THREE.CylinderGeometry(0.105, 0.105, 0.08, 16), coreMat, 0, 0.01, 0, f, false);
      for (const ry of [0, Math.PI / 2]) A(new THREE.BoxGeometry(0.22, 0.03, 0.025), D, 0, 0.055, 0, f, false).rotation.y = ry;
      for (let i = 0; i < 6; i++) {
        const b = (i / 6) * Math.PI * 2;
        A(boltGeo, bolt, Math.cos(b) * 0.13, 0.045, Math.sin(b) * 0.13, f, false);
      }
    }
    // Radiation trefoil on each flank.
    A(signGeo(0.46, 0.46, REG.tref), sign, sx * (TANK_R + 0.012), TANK_Y - 0.02, TANK_Z - 0.02, group, false).rotation.y = (sx * Math.PI) / 2;
  });
  // Control-rod drive housing on top (the rods themselves animate, below).
  const top = TANK_Y + TANK_R;
  const rodZ = TANK_Z - 0.15;
  A(roundBlock(-0.42, 0.42, top - 0.2, top + 0.1, rodZ - 0.2, rodZ + 0.2, 0.06, 0.025), T, 0, 0, 0);
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 0.26;
    A(new THREE.CylinderGeometry(0.085, 0.095, 0.12, 12), D, x, top + 0.16, rodZ);
    A(new THREE.TorusGeometry(0.075, 0.018, 4, 12).rotateX(Math.PI / 2), amber, x, top + 0.22, rodZ, group, false);
  }
  for (const sx of [-1, 1]) for (const dz of [-0.14, 0.14]) A(boltGeo, bolt, sx * 0.36, top + 0.115, rodZ + dz, group, false);
  // Manway hatch (deck-gem mount) forward on top: bolted flange + lid + lifting lug.
  const hz = TANK_Z + 0.3;
  A(new THREE.CylinderGeometry(0.22, 0.24, 0.08, 18), T, 0, top + 0.0, hz);
  A(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 18), steel, 0, top + 0.055, hz);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    A(boltGeo, bolt, Math.cos(a) * 0.2, top + 0.05, hz + Math.sin(a) * 0.2, group, false);
  }
  // Rear dome: vent fan shroud (the rotor animates) on a bolted flange.
  const fanZ = TANK_Z - TANK_L / 2 - DOME * 0.86;
  const fanF = frame(0, TANK_Y, fanZ);
  A(cylZ(0.34, 0.06, 24), T, 0, 0, 0, fanF);
  A(cylZ(0.29, 0.03, 24), P, 0, 0, -0.04, fanF, false);
  A(new THREE.TorusGeometry(0.31, 0.035, 6, 24), D, 0, 0, -0.06, fanF);
  faceBolts(fanF, 10, 0.32, -0.035);
  for (const rz of [0, Math.PI / 2]) A(new THREE.BoxGeometry(0.62, 0.02, 0.02), bolt, 0, 0, -0.12, fanF, false).rotation.z = rz + Math.PI / 4;
  // Front dome: feed nozzle into the manifold.
  A(cylZ(0.08, 0.26, 10), steel, 0, TANK_Y, TANK_Z + TANK_L / 2 + DOME - 0.02);
  A(cylZ(0.12, 0.04, 12), T, 0, TANK_Y, TANK_Z + TANK_L / 2 + DOME + 0.04);

  /* ---- coolant tanks on the deck flanks: steel drums with yellow caps, straps, stencils, gauges, hoses */
  both((sx) => {
    const x = sx * 0.81;
    const y = DECK + 0.17;
    const z0 = -1.55;
    const z1 = -0.3;
    A(cylZ(0.16, z1 - z0, 14), steel, x, y, (z0 + z1) / 2);
    for (const [z, s] of [[z0, -1], [z1, 1]] as const) A(new THREE.SphereGeometry(0.16, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1).rotateX((s * Math.PI) / 2), P, x, y, z);
    for (const z of [-1.3, -0.55]) A(cylZ(0.168, 0.05, 14), D, x, y, z, group, false);
    A(signGeo(0.56, 0.07, REG.cool), sign, x + sx * 0.163, y + 0.01, (z0 + z1) / 2, group, false).rotation.y = (sx * Math.PI) / 2;
    const gf = frame(x, y + 0.22, -0.92, -0.9, sx > 0 ? 0.5 : -0.5, 0);
    gauge(gf, 0.07);
    A(cylZ(0.02, 0.08, 6).rotateX(Math.PI / 2), steel, x, y + 0.15, -0.92, group, false);
    // Coolant line from the tank's front cap up into the vessel's lower flank.
    hose([[x, y, z1 + 0.06], [x, y + 0.05, z1 + 0.2], [sx * 0.62, TANK_Y - 0.35, TANK_Z + 0.75], [sx * 0.5, TANK_Y - 0.33, TANK_Z + 0.75]], 0.04);
    A(new THREE.TorusGeometry(0.06, 0.02, 4, 10).rotateY(Math.PI / 2), bolt, sx * 0.53, TANK_Y - 0.33, TANK_Z + 0.75, group, false);
  });

  /* ---- manifold between the vessel and the bulkhead: header, risers with handwheels, gauge, feed */
  const mz = 0.47;
  A(cylX(0.06, 1.7, 10), steel, 0, 1.3, mz);
  both((sx) => {
    A(cylX(0.09, 0.05, 12), T, sx * 0.86, 1.3, mz);
    A(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 8), steel, sx * 0.6, 1.55, mz);
    A(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 10), D, sx * 0.6, 1.5, mz);
    handwheel(frame(sx * 0.6, 1.84, mz), 0.1);
  });
  A(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8), steel, 0, TANK_Y - 0.18, mz + 0.03);
  A(new THREE.SphereGeometry(0.075, 10, 6), steel, 0, TANK_Y, mz + 0.03);
  A(new THREE.BoxGeometry(0.16, 0.14, 0.14), red, 0, 1.38, mz, group); // main valve body
  gauge(frame(0, 2.0, mz + 0.02, -0.5, Math.PI, 0), 0.09);
  A(new THREE.CylinderGeometry(0.02, 0.02, 0.26, 6), steel, 0, 1.86, mz, group, false);

  /* ---- lead radiation bulkhead between the reactor and the cab */
  const bulk = new THREE.Shape([
    new THREE.Vector2(-0.95, DECK), new THREE.Vector2(0.95, DECK), new THREE.Vector2(0.95, 1.98),
    new THREE.Vector2(0.72, 2.2), new THREE.Vector2(-0.72, 2.2), new THREE.Vector2(-0.95, 1.98),
  ]);
  A(new THREE.ExtrudeGeometry(bulk, { depth: 0.08, bevelEnabled: false }), T, 0, 0, 0.56);
  for (const x of [-0.62, 0, 0.62]) A(new THREE.BoxGeometry(0.07, 0.8, 0.05), D, x, 1.5, 0.535);
  A(new THREE.BoxGeometry(1.5, 0.05, 0.1), D, 0, 2.2, 0.6);
  for (const y of [1.2, 1.9]) for (let i = 0; i < 7; i++) A(boltGeo, bolt, -0.84 + i * 0.28, y, 0.55, group, false).rotation.x = Math.PI / 2;
  A(signGeo(1.0, 0.125, REG.hot), sign, 0, 2.06, 0.552, group, false).rotation.y = Math.PI;

  /* ---- cab: stubby, rounded, lead-lined: kick plates, port windows, porthole, light bar, filter, vent stack */
  A(roundBlock(-0.96, 0.96, 1.0, 1.62, 0.72, 2.02, 0.12, 0.03), P, 0, 0, 0);
  A(extrudeX([[0.78, 1.6], [1.6, 1.6], [1.42, 2.18], [0.78, 2.18]], 1.76, 0.04), P, 0, 0, 0);
  A(roundBlock(-0.84, 0.84, 2.2, 2.28, 0.74, 1.42, 0.06, 0.02), T, 0, 0, 0); // lead roof plate
  // Belt line (sides + nose; the hood ledge stays paint for the Paint Shop decal).
  both((sx) => A(new THREE.BoxGeometry(0.03, 0.05, 1.2), D, sx * 0.965, 1.585, 1.37, group, false));
  A(new THREE.BoxGeometry(1.8, 0.05, 0.03), D, 0, 1.585, 2.025, group, false);
  both((sx) => {
    // Lead kick plates + door seams, handle, porthole, trefoil + stencil.
    A(new THREE.BoxGeometry(0.03, 0.16, 1.2), T, sx * 0.965, 1.1, 1.37);
    rowBoltsX(sx * 0.98, 1.1, 0.86, 1.88, 6);
    for (const z of [0.82, 1.5]) A(new THREE.BoxGeometry(0.012, 0.44, 0.02), D, sx * 0.962, 1.4, z, group, false);
    A(new THREE.BoxGeometry(0.03, 0.035, 0.16), bolt, sx * 0.975, 1.46, 1.38, group, false);
    A(signGeo(0.24, 0.24, REG.tref), sign, sx * 0.962, 1.38, 1.76, group, false).rotation.y = (sx * Math.PI) / 2;
    const ph = frame(sx * 0.88, 1.92, 1.1, 0, 0, (-sx * Math.PI) / 2);
    A(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 16), T, 0, 0.0, 0, ph);
    A(new THREE.CylinderGeometry(0.115, 0.115, 0.06, 16), port, 0, 0.004, 0, ph, false);
    for (let i = 0; i < 6; i++) {
      const b = (i / 6) * Math.PI * 2;
      A(boltGeo, bolt, Math.cos(b) * 0.145, 0.03, Math.sin(b) * 0.145, ph, false);
    }
    // Armoured port windows in the raked front (thick green-tinted glass, bolted lead frames, louvre bars).
    const wf = frame(sx * 0.4, 1.93, 1.555, -0.33, 0, 0);
    A(new THREE.BoxGeometry(0.56, 0.36, 0.05), T, 0, 0, -0.01, wf);
    A(new THREE.BoxGeometry(0.44, 0.24, 0.03), port, 0, 0, 0.02, wf, false);
    A(new THREE.BoxGeometry(0.44, 0.03, 0.03), D, 0, 0.0, 0.035, wf, false);
    for (const [x, y] of [[-0.25, 0.15], [0.25, 0.15], [-0.25, -0.15], [0.25, -0.15]] as const) A(boltGeo, bolt, x, y, 0.02, wf, false).rotation.x = Math.PI / 2;
    // Headlights in armoured cages, tow hooks.
    A(new THREE.BoxGeometry(0.32, 0.22, 0.08), D, sx * 0.62, 1.4, 2.04);
    A(new THREE.BoxGeometry(0.24, 0.14, 0.02), mats.head, sx * 0.62, 1.4, 2.085, group, false);
    for (const dx of [-0.08, 0, 0.08]) A(new THREE.BoxGeometry(0.02, 0.24, 0.02), bolt, sx * 0.62 + dx, 1.4, 2.1, group, false);
    A(new THREE.TorusGeometry(0.06, 0.02, 5, 10).rotateY(Math.PI / 2), red, sx * 0.48, 0.84, 2.2, group, false);
    // Light-bar halves (amber + green lamps) on the roof's front edge.
    A(new THREE.BoxGeometry(0.5, 0.08, 0.12), D, sx * 0.55, 2.32, 1.32);
    for (let i = 0; i < 3; i++) A(new THREE.BoxGeometry(0.13, 0.055, 0.02), i === 1 ? coreMat : amber, sx * (0.39 + i * 0.16), 2.32, 1.385, group, false);
  });
  // Nose: filtered intake grille, heavy bumper with hazard face, hood plate.
  A(new THREE.BoxGeometry(0.72, 0.3, 0.04), D, 0, 1.3, 2.03);
  for (let i = 0; i < 4; i++) A(new THREE.BoxGeometry(0.66, 0.03, 0.03), bolt, 0, 1.19 + i * 0.075, 2.055, group, false);
  A(new THREE.BoxGeometry(2.0, 0.26, 0.16), D, 0, 0.9, 2.08);
  A(tile(new THREE.PlaneGeometry(1.96, 0.18), 1.96 / 0.36), hazard, 0, 0.9, 2.162, group, false);
  A(signGeo(0.7, 0.088, REG.name), sign, 0, 1.69, 1.616, group, false).rotation.x = -0.33;
  // Filtered roof vent (HEPA canister + duct) and the vent stack (dash flame: Plow exhaustTip).
  A(cylX(0.14, 0.52, 16), steel, -0.48, 2.43, 0.86);
  for (const x of [-0.68, -0.48, -0.28]) A(cylX(0.152, 0.04, 16), T, x, 2.43, 0.86, group, false);
  A(cylX(0.12, 0.02, 14), D, -0.75, 2.43, 0.86, group, false);
  A(new THREE.BoxGeometry(0.2, 0.12, 0.18), D, -0.48, 2.32, 0.86);
  A(new THREE.CylinderGeometry(0.065, 0.075, 0.42, 10), steel, 0.55, 2.48, 0.86);
  A(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 10), D, 0.55, 2.7, 0.86, group, false);
  A(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 10), T, 0.55, 2.32, 0.86);
  A(new THREE.CylinderGeometry(0.07, 0.09, 0.06, 10), D, 0, 2.31, 0.84); // beacon plinth

  /* ---- RAD SPRAYER boom: roof turret, two arms, elbow actuator, rams, feed hose */
  const P0 = [0, 2.55, 1.2] as const;
  const P1 = [0, 2.68, 1.78] as const;
  const P2 = [0, 2.1, 2.12] as const;
  A(new THREE.CylinderGeometry(0.19, 0.2, 0.07, 18), D, 0, 2.31, 1.2);
  A(new THREE.CylinderGeometry(0.15, 0.17, 0.09, 18), P, 0, 2.38, 1.2);
  both((sx) => {
    A(new THREE.BoxGeometry(0.04, 0.24, 0.24), T, sx * 0.1, 2.5, 1.2);
    beam([sx * 0.1, 2.42, 1.38], [sx * 0.1, 2.6, 1.58], 0.035, 0, D, true);
    beam([sx * 0.1, 2.6, 1.58], [sx * 0.1, 2.64, 1.62], 0.022, 0, bolt, true);
  });
  A(cylX(0.045, 0.28, 10), bolt, P0[0], P0[1], P0[2]);
  beam(P0, P1, 0.12, 0.12, P);
  beam(P1, P2, 0.1, 0.1, P);
  A(cylX(0.085, 0.2, 14), D, P1[0], P1[1], P1[2]);
  A(cylX(0.05, 0.26, 10), bolt, P1[0], P1[1], P1[2]);
  A(tile(new THREE.BoxGeometry(0.125, 0.02, 0.4), 3), hazard, 0, 2.68, 1.49, group, false).rotation.x = -Math.atan2(0.13, 0.58);
  A(new THREE.SphereGeometry(0.07, 10, 8), bolt, P2[0], P2[1], P2[2]);
  hose([[0.16, 1.32, 0.52], [0.16, 2.2, 0.52], [0.15, 2.37, 0.72], [0.14, 2.38, 1.0], [0.12, 2.6, 1.28], [0.11, 2.77, 1.74], [0.09, 2.42, 1.98], [0.05, 2.14, 2.15]], 0.032);
  for (const z of [0.86, 1.06]) A(new THREE.BoxGeometry(0.08, 0.03, 0.05), D, 0.14, 2.31, z, group, false);

  /* ---- rear: bumper with hazard face, stencil plate, tail lights, coolant dump valves */
  A(new THREE.BoxGeometry(2.0, 0.26, 0.12), D, 0, 0.92, -2.21);
  both((sx) => {
    A(tile(new THREE.PlaneGeometry(0.56, 0.2), 0.56 / 0.4), hazard, sx * 0.7, 0.92, -2.272, group, false).rotation.y = Math.PI;
    A(new THREE.BoxGeometry(0.12, 0.16, 0.03), tail, sx * 0.94, 0.92, -2.28, group, false);
    // Dump valve: drop pipe, red handwheel, flared outlet with a glowing throat.
    const x = sx * 0.42;
    A(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), steel, x, 0.72, -2.06);
    handwheel(frame(x + sx * 0.1, 0.72, -2.06, 0, 0, Math.PI / 2), 0.065);
    A(new THREE.CylinderGeometry(0.06, 0.1, 0.1, 10, 1, true), T, x, 0.52, -2.06);
    A(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 10), dumpMat, x, 0.5, -2.06, group, false);
  });
  A(signGeo(0.78, 0.098, REG.rad), sign, 0, 0.92, -2.272, group, false).rotation.y = Math.PI;

  /* ---- twin cooling stacks at the tail: waisted lead towers, yellow lips, bolted bases, glowing throats */
  const stackH = 1.05;
  const shell = coolingTower(0.25, 0.165, 0.2, stackH);
  both((sx) => {
    const x = sx * 0.78;
    const z = -1.88;
    A(shell, T, x, DECK, z);
    A(new THREE.TorusGeometry(0.2, 0.03, 6, 18).rotateX(Math.PI / 2), P, x, DECK + stackH, z);
    A(new THREE.TorusGeometry(0.171, 0.02, 6, 18).rotateX(Math.PI / 2), P, x, DECK + stackH * 0.72, z, group, false);
    A(new THREE.CylinderGeometry(0.28, 0.3, 0.06, 18), D, x, DECK + 0.03, z);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      A(boltGeo, bolt, x + Math.cos(a) * 0.27, DECK + 0.07, z + Math.sin(a) * 0.27, group, false);
    }
    A(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 16), D, x, DECK + stackH - 0.12, z, group, false);
    A(new THREE.CylinderGeometry(0.1, 0.1, 0.025, 12), coreMat, x, DECK + stackH - 0.105, z, group, false);
  });

  mergeStatic(group);
  group.add(...makeShadowProxy(group, group));

  /* ------------------------------------------------------------------ animated (after the merge; no shadows) */

  // Control rods: steel shafts with glowing indicator caps, bobbing out of the drive housing, out of phase.
  const rods: THREE.Group[] = [];
  const shaftGeo = new THREE.CylinderGeometry(0.042, 0.042, 0.56, 8).translate(0, -0.12, 0);
  const capGeo = new THREE.CylinderGeometry(0.07, 0.06, 0.09, 10).translate(0, 0.19, 0);
  const bandGeo = new THREE.CylinderGeometry(0.048, 0.048, 0.04, 8).translate(0, 0.06, 0);
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Group();
    r.position.set((i - 1) * 0.26, top + 0.22, rodZ);
    r.add(new THREE.Mesh(shaftGeo, bolt), new THREE.Mesh(capGeo, coreMat), new THREE.Mesh(bandGeo, D));
    group.add(r);
    rods.push(r);
  }
  // Rear vent fan: a trefoil rotor (black blades over the yellow backing read as a spinning radiation sign).
  const fan = new THREE.Group();
  fan.position.set(0, TANK_Y, fanZ - 0.08);
  const bladeShape = new THREE.Shape();
  bladeShape.absarc(0, 0, 0.26, Math.PI / 2 - 0.5, Math.PI / 2 + 0.5, false);
  bladeShape.absarc(0, 0, 0.07, Math.PI / 2 + 0.5, Math.PI / 2 - 0.5, true);
  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.025, bevelEnabled: false, curveSegments: 6 });
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(bladeGeo, D);
    b.rotation.z = (i * Math.PI * 2) / 3;
    fan.add(b);
  }
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 6), coreMat);
  hub.position.z = -0.02;
  fan.add(hub);
  group.add(fan);
  // Sprayer nozzle assembly on the boom's wrist: valve body, handwheel, barrel, diffuser and glowing tip.
  const nozzle = new THREE.Group();
  nozzle.position.fromArray(P2);
  nozzle.rotation.order = 'YXZ';
  const nozzleTilt = 0.35;
  nozzle.rotation.x = nozzleTilt;
  addMesh(new THREE.BoxGeometry(0.15, 0.15, 0.14), D, 0, 0, 0.06, nozzle, false);
  const nhw = new THREE.Group();
  nhw.position.set(0.1, 0, 0.06);
  nhw.rotation.z = Math.PI / 2;
  nozzle.add(nhw);
  handwheel(nhw, 0.06);
  addMesh(cylZ(0.06, 0.24, 10, 0.04), bolt, 0, 0, 0.24, nozzle, false);
  addMesh(cylZ(0.065, 0.04, 12), T, 0, 0, 0.17, nozzle, false);
  addMesh(new THREE.CylinderGeometry(0.11, 0.055, 0.1, 14, 1, true).rotateX(Math.PI / 2), T, 0, 0, 0.39, nozzle, false);
  const tip = addMesh(cylZ(0.075, 0.03, 12), jetMat, 0, 0, 0.41, nozzle, false);
  for (let i = 0; i < 4; i++) {
    const fin = addMesh(new THREE.BoxGeometry(0.012, 0.07, 0.12), D, 0, 0, 0.3, nozzle, false);
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    fin.position.set(Math.cos(a) * 0.06, Math.sin(a) * 0.06, 0.3);
    fin.rotation.z = a + Math.PI / 2;
  }
  group.add(nozzle);
  // Rotating amber beacon on the roof.
  const beacon = new THREE.Group();
  beacon.position.set(0, 2.38, 0.84);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.07), amber);
  beacon.add(lamp, new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), D));
  group.add(beacon);
  // Cooling-stack vapour: three puffs per stack, rising, swelling and fading on a loop.
  const puffGeo = new THREE.IcosahedronGeometry(0.5, 1);
  const puffs: { m: THREE.Mesh; mat: THREE.MeshBasicMaterial; x: number; k: number }[] = [];
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xe6f6ea, transparent: true, opacity: 0, depthWrite: false });
      const m = new THREE.Mesh(puffGeo, mat);
      m.renderOrder = 2;
      group.add(m);
      puffs.push({ m, mat, x: sx * 0.78, k: (k + (sx > 0 ? 0.5 : 0)) / 3 });
    }
  }
  for (const m of [...rods.flatMap((r) => r.children), ...fan.children, ...nozzle.children, lamp, ...puffs.map((p) => p.m)]) m.frustumCulled = false;
  nhw.traverse((o) => (o.frustumCulled = false));

  let spray = 0;
  let trail = 0;
  let phase = 0;
  let last = -1;
  const rodUp = top + 0.22;
  const stackTop = DECK + stackH;
  lamp.onBeforeRender = () => {
    const t = performance.now() * 0.001;
    const dt = last < 0 ? 0 : Math.min(0.1, t - last);
    last = t;
    for (let i = 0; i < 3; i++) rods[i].position.y = rodUp + 0.2 * Math.max(0, Math.sin(t * 2.2 + i * 2.1));
    fan.rotation.z = -t * (7 + trail * 9);
    beacon.rotation.y = t * 5;
    // Idle: the nozzle sweeps lazily. Spraying: it locks forward and shudders, the tip burns bright.
    nozzle.rotation.y = Math.sin(t * 1.3) * 0.1 * (1 - spray) + Math.sin(t * 47) * 0.025 * spray;
    nozzle.rotation.x = nozzleTilt + Math.sin(t * 61) * 0.02 * spray;
    tip.scale.setScalar(1 + spray * (0.25 + 0.15 * Math.sin(t * 40)));
    jetMat.emissiveIntensity = 0.8 + spray * (2.6 + Math.sin(t * 33));
    dumpMat.emissiveIntensity = 0.4 + trail * (2.2 + 0.8 * Math.sin(t * 12));
    phase += dt * (0.42 + trail * 0.6 + spray * 0.25);
    for (const p of puffs) {
      const f = (phase + p.k) % 1;
      p.m.position.set(p.x * (1 + f * 0.15), stackTop + 0.05 + f * 1.0, -1.88 - f * 0.35);
      p.m.scale.setScalar(0.12 + f * (0.42 + trail * 0.2));
      p.mat.opacity = (0.6 + trail * 0.2) * Math.min(1, f * 6) * (1 - f) ** 1.5;
    }
  };
  const update = (dt: number, s: IsotopeRigState) => {
    spray += ((s.spray ? 1 : 0) - spray) * Math.min(1, dt * 12);
    trail += ((s.trail ? 1 : 0) - trail) * Math.min(1, dt * 5);
  };
  return { group, parts: { coreMat, update } };
}
