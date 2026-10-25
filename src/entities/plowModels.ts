import * as THREE from 'three';
import type { FxAPI } from '../core/types';
import type { PlowKind } from '../config/plows';
import type { DecalStyle, TrailDef } from '../config/cosmetics';
import { mergeStatic } from '../render/mergeStatic';

/* Starter-plow silhouettes shared by the player's Plow and Brawl rival rigs (src/brawl/models.ts).
 * Model layout (local, facing +Z, ground at y = 0) matches the player plow: chassis at y ~0.62, wheels at
 * x ±0.95 / z 1.45 & -1.25, blade mounted in front at z ~2.35. Each builder returns a Group holding only the
 * plow-specific bodywork (the chassis, wheels and blade are added by the caller) plus animation handles. */

/** Yellow/black diagonal hazard stripes, drawn once per call on a canvas (no asset files). */
export function hazardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffc21a';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#16181c';
  for (let i = -64; i < 128; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 16, 0);
    g.lineTo(i + 16 + 64, 64);
    g.lineTo(i + 64, 64);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Wheel radius / track layout of the shared chassis. */
export const PLOW_WHEEL_R = 0.48;
export const PLOW_WHEEL_POS: readonly (readonly [number, number])[] = [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.25], [0.95, -1.25]];

type Adder = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, shadow?: boolean) => THREE.Mesh;
const add: Adder = (geo, mat, x, y, z, parent, shadow = true) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  parent.add(m);
  return m;
};

/* ------------------------------------------------------------------ VOLT-9 */

export interface VoltPartsMats {
  /** Body paint. */
  paint: THREE.Material;
  /** Glowing coil / light-bar material (pulsed by the owner). */
  coil: THREE.Material;
}

export interface VoltParts {
  group: THREE.Group;
  /** The two Tesla coil top spheres (arc endpoints). */
  coilTops: THREE.Object3D[];
  underglowMat: THREE.MeshBasicMaterial;
}

/** VOLT-9: a low, sleek electric wedge — bubble canopy, glowing light bars, rear wing, Tesla coils, underglow. */
export function buildVoltParts(m: VoltPartsMats): VoltParts {
  const vp = new THREE.Group();
  const voltGlass = new THREE.MeshStandardMaterial({ color: 0x0d3a5c, roughness: 0.05, metalness: 0.8, emissive: 0x0a5c9a, emissiveIntensity: 0.6, transparent: true, opacity: 0.88 });
  const carbonMat = new THREE.MeshStandardMaterial({ color: 0x14171f, roughness: 0.35, metalness: 0.6 });
  // Low hull + sloped nose wedge.
  add(new THREE.BoxGeometry(1.95, 0.5, 3.0), m.paint, 0, 1.02, -0.45, vp);
  const nose = add(new THREE.BoxGeometry(1.9, 0.32, 1.5), m.paint, 0, 1.0, 1.5, vp);
  nose.rotation.x = 0.2;
  add(new THREE.BoxGeometry(1.7, 0.06, 0.08), m.coil, 0, 1.0, 2.24, vp, false); // headlight bar
  add(new THREE.BoxGeometry(1.95, 0.08, 0.06), m.coil, 0, 1.12, -1.97, vp, false); // tail light bar
  add(new THREE.BoxGeometry(2.0, 0.16, 0.25), carbonMat, 0, 0.7, -1.95, vp); // diffuser
  // Bubble canopy.
  const canopyGeo = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const canopy = add(canopyGeo, voltGlass, 0, 1.26, 0.25, vp, false);
  canopy.scale.set(0.78, 0.55, 1.25);
  // Side glow strips + wheel-arch spats.
  for (const x of [-0.99, 0.99]) {
    add(new THREE.BoxGeometry(0.04, 0.06, 3.1), m.coil, x, 0.92, -0.2, vp, false);
    for (const z of [1.45, -1.25]) add(new THREE.BoxGeometry(0.46, 0.08, 1.15), carbonMat, x * 0.96, PLOW_WHEEL_R * 2 + 0.06, z, vp);
  }
  // Rear wing on two struts.
  for (const x of [-0.6, 0.6]) add(new THREE.BoxGeometry(0.08, 0.5, 0.14), carbonMat, x, 1.48, -1.75, vp);
  add(new THREE.BoxGeometry(2.1, 0.06, 0.45), m.paint, 0, 1.75, -1.8, vp);
  add(new THREE.BoxGeometry(2.1, 0.03, 0.05), m.coil, 0, 1.79, -1.6, vp, false);
  // Twin Tesla coils on the rear deck, between canopy and wing.
  const coilBaseMat = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.4, metalness: 0.7 });
  const coilTops: THREE.Object3D[] = [];
  for (const x of [-0.55, 0.55]) {
    const coil = new THREE.Group();
    coil.position.set(x, 1.27, -1.0);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.3, 12), coilBaseMat);
    base.position.y = 0.15;
    coil.add(base);
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15 - i * 0.02, 0.04, 6, 16), m.coil);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.38 + i * 0.13;
      coil.add(ring);
    }
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), m.coil);
    top.position.y = 0.95;
    coil.add(top);
    coilTops.push(top);
    vp.add(coil);
  }
  // Underglow.
  const underGeo = new THREE.PlaneGeometry(2.6, 4.6);
  underGeo.rotateX(-Math.PI / 2);
  const underglowMat = new THREE.MeshBasicMaterial({ color: 0x2fb8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  add(underGeo, underglowMat, 0, 0.08, 0.05, vp, false);
  return { group: vp, coilTops, underglowMat };
}

/* ------------------------------------------------------------------ BRUTUS */

export interface BrutePartsMats {
  paint: THREE.Material;
  dark: THREE.Material;
  glass: THREE.Material;
  chrome: THREE.Material;
  /** Sprockets + piston sleeves (yellow on BRUTUS). */
  hub: THREE.Material;
  /** Roof light bar. */
  head: THREE.Material;
}

export interface Cleat {
  mesh: THREE.Mesh;
  top: boolean;
  i: number;
}

export interface BruteParts {
  group: THREE.Group;
  /** Track cleats (animate with cleatZ). */
  cleats: Cleat[];
  /** Length of a track run the cleats loop over. */
  cleatSpan: number;
}

/** Cleats per track run. */
export const CLEATS_PER_RUN = 9;

/** Local z of a track cleat at track phase `phase` (m travelled): the bottom run stays put on the ground while
 *  the top run moves forward, like a real crawler track. */
export function cleatZ(i: number, top: boolean, phase: number, span: number): number {
  const step = span / CLEATS_PER_RUN;
  const u = (((i * step + (top ? 1 : -1) * phase) % span) + span) % span;
  return 0.1 - span / 2 + u;
}

/** BRUTUS: a tracked bulldozer — tank treads with moving cleats, armored engine block, caged cab, twin stacks,
 *  ripper tooth. */
export function buildBruteParts(m: BrutePartsMats): BruteParts {
  const bp = new THREE.Group();
  const hazardTex = hazardTexture();
  hazardTex.repeat.set(3, 1);
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.55, metalness: 0.25 });
  const trackMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1f, roughness: 0.95, flatShading: true });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.6, metalness: 0.6 });
  // Tracks: a rounded rubber loop on each side with road wheels and moving cleats.
  const TRACK_LEN = 3.9;
  const TRACK_H = 0.95;
  for (const x of [-1.12, 1.12]) {
    add(new THREE.BoxGeometry(0.62, TRACK_H - 0.3, TRACK_LEN - 0.9), trackMat, x, TRACK_H / 2 + 0.02, 0.1, bp);
    for (const z of [0.1 + (TRACK_LEN - 0.9) / 2, 0.1 - (TRACK_LEN - 0.9) / 2]) {
      const end = add(new THREE.CylinderGeometry(TRACK_H / 2 - 0.02, TRACK_H / 2 - 0.02, 0.62, 16), trackMat, x, TRACK_H / 2 + 0.02, z, bp);
      end.rotation.z = Math.PI / 2;
      const sprocket = add(new THREE.CylinderGeometry(0.3, 0.3, 0.66, 8), m.hub, x, TRACK_H / 2 + 0.02, z, bp);
      sprocket.rotation.z = Math.PI / 2;
    }
    for (let i = 0; i < 4; i++) {
      const rw = add(new THREE.CylinderGeometry(0.2, 0.2, 0.66, 10), ironMat, x, 0.3, -1.05 + i * 0.75, bp, false);
      rw.rotation.z = Math.PI / 2;
    }
    add(new THREE.BoxGeometry(0.7, 0.08, TRACK_LEN + 0.1), ironMat, x, TRACK_H + 0.07, 0.1, bp); // track guard
  }
  const cleats: Cleat[] = [];
  const cleatGeo = new THREE.BoxGeometry(0.64, 0.07, 0.14);
  for (const x of [-1.12, 1.12]) {
    for (let i = 0; i < CLEATS_PER_RUN; i++) {
      for (const top of [true, false]) {
        const c = add(cleatGeo, ironMat, x, top ? TRACK_H + 0.0 : 0.04, 0, bp, false);
        cleats.push({ mesh: c, top, i });
      }
    }
  }
  const cleatSpan = TRACK_LEN - 0.9;
  for (const c of cleats) c.mesh.position.z = cleatZ(c.i, c.top, 0, cleatSpan);
  // Armored engine block at the rear with vent slats + hazard side plates + striped rear bumper.
  add(new THREE.BoxGeometry(1.75, 1.15, 1.9), m.paint, 0, 1.38, -1.0, bp);
  for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(1.5, 0.05, 0.12), m.dark, 0, 1.98, -1.75 + i * 0.32, bp, false);
  for (const x of [-0.9, 0.9]) add(new THREE.BoxGeometry(0.05, 0.62, 1.7), hazardMat, x, 1.3, -1.0, bp);
  const bumperTex = hazardTexture();
  bumperTex.repeat.set(6, 1);
  add(new THREE.BoxGeometry(2.4, 0.3, 0.2), new THREE.MeshStandardMaterial({ map: bumperTex, roughness: 0.55 }), 0, 0.75, -2.05, bp);
  // Ripper tooth hanging off the back.
  add(new THREE.BoxGeometry(0.22, 0.2, 0.7), ironMat, 0, 0.9, -2.4, bp);
  const tooth = add(new THREE.BoxGeometry(0.16, 0.9, 0.22), ironMat, 0, 0.55, -2.7, bp);
  tooth.rotation.x = -0.35;
  // Twin exhaust stacks.
  for (const x of [-0.55, 0.55]) {
    const st = add(new THREE.CylinderGeometry(0.11, 0.13, 1.3, 10), m.chrome, x, 2.4, -1.45, bp);
    add(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 10), m.dark, 0, 0.62, 0, st);
  }
  // Caged cab: a squat box with a roll cage around the glass and a roof light bar.
  add(new THREE.BoxGeometry(1.5, 0.35, 1.25), m.paint, 0, 1.13, 0.75, bp);
  add(new THREE.BoxGeometry(1.4, 0.85, 1.15), m.glass, 0, 1.72, 0.75, bp, false);
  add(new THREE.BoxGeometry(1.62, 0.12, 1.4), m.paint, 0, 2.2, 0.75, bp);
  for (const x of [-0.74, 0.74]) for (const z of [0.14, 1.36]) add(new THREE.BoxGeometry(0.1, 0.95, 0.1), m.dark, x, 1.7, z, bp);
  for (const y of [1.45, 1.95]) {
    add(new THREE.BoxGeometry(1.5, 0.06, 0.06), m.dark, 0, y, 1.36, bp, false);
    for (const x of [-0.74, 0.74]) add(new THREE.BoxGeometry(0.06, 0.06, 1.22), m.dark, x, y, 0.75, bp, false);
  }
  add(new THREE.BoxGeometry(1.4, 0.14, 0.16), m.dark, 0, 2.35, 1.3, bp);
  for (const x of [-0.45, 0, 0.45]) add(new THREE.BoxGeometry(0.3, 0.16, 0.06), m.head, x, 2.35, 1.39, bp, false);
  // Low front deck + chunky hydraulic pistons out to the blade.
  add(new THREE.BoxGeometry(1.75, 0.45, 0.8), m.paint, 0, 1.05, 1.75, bp);
  for (const x of [-0.65, 0.65]) {
    const pis = add(new THREE.CylinderGeometry(0.1, 0.1, 1.1, 10), m.chrome, x, 1.25, 2.0, bp);
    pis.rotation.x = Math.PI / 2 - 0.35;
    const sleeve = add(new THREE.CylinderGeometry(0.15, 0.15, 0.6, 10), m.hub, x, 1.45, 1.6, bp);
    sleeve.rotation.x = Math.PI / 2 - 0.35;
  }
  return { group: bp, cleats, cleatSpan };
}

export interface Buzzsaw {
  group: THREE.Group;
  /** Spin this around Y. */
  rotor: THREE.Group;
  /** Flat glow disc around the saw (unit radius: scale it to the halo radius). Its material is per saw. */
  halo: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
}

/** BRUTUS Buzzsaws upgrade: a big toothed circular saw lying flat (axis along Y) and jutting out past the blade
 *  end, with a hazard-striped face, glowing teeth, a spin-blur ring and a mounting arm. Shared materials and
 *  geometry are cached across calls. */
let sawKit: {
  disc: THREE.MeshStandardMaterial;
  face: THREE.MeshStandardMaterial;
  tooth: THREE.MeshStandardMaterial;
  hub: THREE.MeshStandardMaterial;
  blur: THREE.MeshBasicMaterial;
  toothGeo: THREE.BufferGeometry;
  haloTex: THREE.CanvasTexture;
  haloGeo: THREE.CircleGeometry;
} | null = null;
export const SAW_R = 0.95;

/** Radial glow for the saw halo: clear in the middle (the saw covers it), a hot band near the rim, fading out. */
function haloTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.15)');
  grad.addColorStop(0.72, 'rgba(255,255,255,1)');
  grad.addColorStop(0.82, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function buildBuzzsaw(): Buzzsaw {
  if (!sawKit) {
    const faceTex = hazardTexture();
    faceTex.repeat.set(3, 3);
    // Raked triangular tooth in the XZ plane, pointing along +X, extruded thin on Y.
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.13);
    shape.lineTo(0.26, 0.1);
    shape.lineTo(0, 0.13);
    shape.closePath();
    const toothGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: false });
    toothGeo.rotateX(Math.PI / 2);
    toothGeo.translate(0, 0.035, 0);
    sawKit = {
      disc: new THREE.MeshStandardMaterial({ color: 0xe8edf2, metalness: 0.7, roughness: 0.22 }),
      face: new THREE.MeshStandardMaterial({ map: faceTex, metalness: 0.3, roughness: 0.45 }),
      tooth: new THREE.MeshStandardMaterial({ color: 0xffb000, emissive: 0xff5a00, emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.3 }),
      hub: new THREE.MeshStandardMaterial({ color: 0x16181c, metalness: 0.5, roughness: 0.5 }),
      blur: new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }),
      toothGeo,
      haloTex: haloTexture(),
      haloGeo: new THREE.CircleGeometry(1, 48),
    };
  }
  const k = sawKit;
  const R = SAW_R;
  const group = new THREE.Group();
  const rotor = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.07, 40), k.disc);
  disc.castShadow = true;
  rotor.add(disc);
  // Hazard-striped inner faces (top and bottom) so the spin reads from the chase camera.
  for (const y of [0.037, -0.037]) {
    const face = new THREE.Mesh(new THREE.CircleGeometry(R * 0.72, 32), k.face);
    face.rotation.x = y > 0 ? -Math.PI / 2 : Math.PI / 2;
    face.position.y = y;
    rotor.add(face);
  }
  // Teeth: glowing raked wedges around the rim.
  const TEETH = 20;
  const teeth: THREE.Mesh[] = [];
  for (let i = 0; i < TEETH; i++) {
    const a = (i / TEETH) * Math.PI * 2;
    const t = new THREE.Mesh(k.toothGeo, k.tooth);
    t.position.set(Math.cos(a) * (R - 0.04), 0, Math.sin(a) * (R - 0.04));
    t.rotation.y = -a - 0.35;
    rotor.add(t);
    teeth.push(t);
  }
  // Spin blur: a faint glowing ring just past the teeth.
  const blur = new THREE.Mesh(new THREE.RingGeometry(R * 0.8, R + 0.24, 40), k.blur);
  blur.rotation.x = -Math.PI / 2;
  blur.position.y = 0.06;
  rotor.add(blur);
  group.add(rotor);
  // Halo: a glow disc around the teeth (alpha-blended so it still reads on white snow), grown and tinted by Plow as the saws spin up.
  const halo = new THREE.Mesh(
    k.haloGeo,
    new THREE.MeshBasicMaterial({ map: k.haloTex, color: 0xffb030, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.scale.setScalar(R * 1.3);
  halo.renderOrder = 2;
  group.add(halo);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.22, 14), k.hub);
  group.add(hub);
  // Mounting arm bolting the saw back to the blade end.
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.14, 0.22), k.hub);
  arm.position.set(-0.42, 0.12, -0.25);
  arm.rotation.y = 0.5;
  group.add(arm);
  // Static sub-parts share draws: the two faces inside the rotor, the hub + arm on the mount. (The teeth stay
  // separate: their flat sides are coplanar with the disc faces, and merging them would flip that depth tie.)
  mergeStatic(rotor, { keep: teeth });
  mergeStatic(group, { keep: [rotor] });
  return { group, rotor, halo };
}

/* ------------------------------------------------------------------ Paint Shop cosmetics (player plow only) */

/** Factory paint per starter plow: body panels + the Classic's dump bed (trim). The 'stock' paint keeps these. */
export const FACTORY_PAINT: Readonly<Record<PlowKind, { body: number; trim: number }>> = {
  classic: { body: 0xff7a1a, trim: 0xffb21f },
  volt: { body: 0x1f5fe0, trim: 0x18213a },
  brute: { body: 0x7d8794, trim: 0x4a525d },
};

const INK = '#16181c';

/** Canvas size per decal style (u = along the plow, v = across / up). */
const DECAL_CANVAS: Record<DecalStyle, [number, number]> = {
  stripes: [256, 128],
  flames: [256, 96],
  snowflake: [128, 128],
  checker: [64, 32],
  skull: [128, 128],
};

/** Draw a decal onto a 2D canvas of any size (also used for the Paint Shop swatches). Transparent background. */
export function drawDecal(g: CanvasRenderingContext2D, style: DecalStyle, w: number, h: number): void {
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  if (style === 'stripes') {
    // Twin white stripes with a dark keyline, running the full length.
    for (const v of [0.27, 0.58]) {
      g.fillStyle = INK;
      g.fillRect(0, h * v - 3, w, h * 0.15 + 6);
      g.fillStyle = '#f6f8fb';
      g.fillRect(0, h * v, w, h * 0.15);
    }
  } else if (style === 'checker') {
    const n = 4;
    const s = w / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 2; j++) {
        g.fillStyle = (i + j) % 2 ? '#f4f6f8' : INK;
        g.fillRect(i * s, j * (h / 2), s, h / 2);
      }
    }
  } else if (style === 'flames') {
    // Tongues licking back from the front edge (u = 0): dark outline pass, then a hot gradient, then a yellow core.
    const tongues: [number, number, number, number][] = [
      // centre v, half width, length, tip curl (fractions of h / w)
      [0.22, 0.16, 0.62, -0.1],
      [0.42, 0.2, 0.95, 0.05],
      [0.62, 0.18, 0.78, 0.08],
      [0.8, 0.14, 0.5, 0.1],
    ];
    const shape = (cv: number, hw: number, len: number, curl: number, k: number) => {
      const cy = cv * h;
      const half = hw * h * k;
      const L = len * w * (0.35 + 0.65 * k);
      const tip = cy + curl * h;
      g.beginPath();
      g.moveTo(-4, cy - half);
      g.bezierCurveTo(L * 0.35, cy - half, L * 0.65, tip - half * 0.5, L, tip);
      g.bezierCurveTo(L * 0.7, tip + half * 0.4, L * 0.4, cy + half, -4, cy + half);
      g.closePath();
    };
    g.strokeStyle = INK;
    g.lineWidth = Math.max(3, h * 0.07);
    for (const t of tongues) {
      shape(...t, 1);
      g.stroke();
    }
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#ffd23a');
    grad.addColorStop(0.45, '#ff7a1a');
    grad.addColorStop(1, '#e8283a');
    g.fillStyle = grad;
    for (const t of tongues) {
      shape(...t, 1);
      g.fill();
    }
    g.fillStyle = '#ffe680';
    for (const t of tongues) {
      shape(...t, 0.45);
      g.fill();
    }
  } else if (style === 'snowflake') {
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.44;
    const arms = () => {
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        g.moveTo(cx, cy);
        g.lineTo(cx + ca * r, cy + sa * r);
        for (const [f, l] of [[0.5, 0.3], [0.78, 0.2]]) {
          const bx = cx + ca * r * f;
          const by = cy + sa * r * f;
          for (const s of [-1, 1]) {
            const b = a + s * 0.8;
            g.moveTo(bx, by);
            g.lineTo(bx + Math.cos(b) * r * l, by + Math.sin(b) * r * l);
          }
        }
      }
    };
    arms();
    g.strokeStyle = '#1d4f82';
    g.lineWidth = r * 0.24;
    g.stroke();
    arms();
    g.strokeStyle = '#eaf7ff';
    g.lineWidth = r * 0.12;
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, r * 0.14, 0, Math.PI * 2);
    g.fillStyle = '#8fdcff';
    g.fill();
  } else if (style === 'skull') {
    const s = Math.min(w, h) / 128;
    g.translate((w - 128 * s) / 2, (h - 128 * s) / 2);
    g.scale(s, s);
    // Crossbones behind the skull.
    const bones = () => {
      g.beginPath();
      g.moveTo(22, 30);
      g.lineTo(106, 104);
      g.moveTo(106, 30);
      g.lineTo(22, 104);
    };
    const knobs = (r: number) => {
      g.beginPath();
      for (const [x, y] of [[22, 30], [106, 30], [22, 104], [106, 104]]) {
        // Two knuckles per bone end, offset across the bone.
        const ox = x < 64 ? -1 : 1;
        const oy = y < 64 ? 1 : -1;
        for (const o of [-1, 1]) {
          const kx = x + o * 6 * oy;
          const ky = y + o * 6 * ox;
          g.moveTo(kx + r, ky);
          g.arc(kx, ky, r, 0, Math.PI * 2);
        }
      }
    };
    g.strokeStyle = INK;
    g.lineWidth = 20;
    bones();
    g.stroke();
    g.fillStyle = INK;
    knobs(10);
    g.fill();
    g.strokeStyle = '#f4f1e8';
    g.lineWidth = 11;
    bones();
    g.stroke();
    g.fillStyle = '#f4f1e8';
    knobs(6);
    g.fill();
    // Skull: cranium + jaw, dark eyes, nose and teeth.
    const head = () => {
      g.beginPath();
      g.arc(64, 54, 32, Math.PI * 0.8, Math.PI * 2.2);
      g.lineTo(82, 88);
      g.lineTo(46, 88);
      g.closePath();
    };
    head();
    g.lineWidth = 7;
    g.strokeStyle = INK;
    g.stroke();
    g.fillStyle = '#f4f1e8';
    g.fill();
    g.fillStyle = INK;
    for (const x of [51, 77]) {
      g.beginPath();
      g.ellipse(x, 56, 9, 10, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.beginPath();
    g.moveTo(64, 66);
    g.lineTo(59, 75);
    g.lineTo(69, 75);
    g.closePath();
    g.fill();
    g.fillRect(50, 79, 28, 3);
    for (const x of [55, 62, 69, 76]) g.fillRect(x - 1, 79, 2, 9);
  }
  g.restore();
}

const decalTex = new Map<DecalStyle, THREE.CanvasTexture>();
/** Cached decal texture per style (repeat-wrapped so the checker bands can tile). */
function getDecalTexture(style: DecalStyle): THREE.CanvasTexture {
  let t = decalTex.get(style);
  if (t) return t;
  const [w, h] = DECAL_CANVAS[style];
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  drawDecal(c.getContext('2d')!, style, w, h);
  t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  decalTex.set(style, t);
  return t;
}

/** Where a decal style goes on a plow: stripes run along top surfaces, flames down the flanks, emblems sit on a few
 *  big panels, checker bands wrap the sides and rear. */
type DecalTag = 'stripe' | 'flame' | 'emblem' | 'band';
const DECAL_TAG: Record<DecalStyle, DecalTag> = { stripes: 'stripe', flames: 'flame', snowflake: 'emblem', checker: 'band', skull: 'emblem' };

interface DecalSpot {
  /** 'top' faces +Y (size = length along Z, width along X); 'side' faces +X and is mirrored to -X (length, height);
   *  'rear' faces -Z (width, height). */
  face: 'top' | 'side' | 'rear';
  at: readonly [number, number, number];
  size: readonly [number, number];
  tags: readonly DecalTag[];
  /** Emblem size (m) on this spot; default 90% of the shorter side. */
  emblem?: number;
  /** Also place a copy mirrored at -x (top spots off the centreline). */
  pair?: boolean;
  /** Surface pitch (rad about X), e.g. VOLT-9's sloped nose. */
  tilt?: number;
}

/** Decal spots on each starter plow's bodywork (model-local coordinates; see the builders above + Plow.ts). */
const DECAL_SPOTS: Record<PlowKind, readonly DecalSpot[]> = {
  classic: [
    { face: 'top', at: [0, 1.53, 1.78], size: [0.85, 1.85], tags: ['stripe', 'flame'] }, // hood
    { face: 'top', at: [0, 2.28, 0.72], size: [1.45, 2.08], tags: ['stripe', 'emblem'], emblem: 1.2 }, // cab roof
    { face: 'top', at: [0, 1.88, -0.95], size: [2.2, 2.2], tags: ['stripe', 'emblem', 'band'], emblem: 1.75 }, // bed lid
    { face: 'side', at: [1.05, 1.47, -0.95], size: [2.0, 0.58], tags: ['flame', 'emblem', 'stripe'], emblem: 0.56 }, // bed flank
    { face: 'side', at: [1.05, 1.64, -0.95], size: [2.06, 0.2], tags: ['band'] },
    { face: 'side', at: [0.925, 1.31, 1.78], size: [0.83, 0.4], tags: ['flame', 'band', 'stripe'] }, // hood flank
    { face: 'rear', at: [0, 1.45, -2.0], size: [2.1, 0.62], tags: ['emblem'], emblem: 0.56 },
    { face: 'rear', at: [0, 1.66, -2.0], size: [2.1, 0.2], tags: ['band'] },
  ],
  volt: [
    { face: 'top', at: [0, 1.157, 1.532], size: [1.5, 1.9], tags: ['stripe', 'flame', 'band'], tilt: 0.2 }, // sloped nose
    { face: 'top', at: [0, 1.087, 1.875], size: [0.72, 1.9], tags: ['emblem'], emblem: 0.66, tilt: 0.2 },
    { face: 'top', at: [0, 1.27, -1.5], size: [0.9, 1.95], tags: ['stripe', 'flame', 'emblem'], emblem: 0.85 }, // rear deck
    { face: 'top', at: [0, 1.78, -1.8], size: [0.45, 2.1], tags: ['stripe', 'emblem'], emblem: 0.42 }, // wing
    { face: 'side', at: [0.975, 1.165, -0.45], size: [2.9, 0.2], tags: ['flame', 'band', 'stripe'] },
    { face: 'rear', at: [0, 0.93, -1.95], size: [1.95, 0.26], tags: ['band'] },
  ],
  brute: [
    { face: 'top', at: [0, 2.26, 0.65], size: [1.1, 1.5], tags: ['stripe', 'emblem'], emblem: 1.05 }, // cab roof
    { face: 'top', at: [0, 1.275, 1.75], size: [0.8, 1.75], tags: ['stripe', 'flame'] }, // front deck
    { face: 'top', at: [0, 2.012, -1.0], size: [1.9, 1.75], tags: ['stripe', 'band', 'emblem'], emblem: 1.4 }, // over the engine vents
    { face: 'top', at: [1.12, 1.06, 0.1], size: [4.0, 0.7], tags: ['flame', 'stripe', 'band'], pair: true }, // track guards
    { face: 'side', at: [0.875, 1.78, -1.0], size: [1.85, 0.3], tags: ['band', 'stripe', 'flame'] }, // engine flank
    { face: 'rear', at: [0, 1.38, -1.95], size: [1.75, 0.95], tags: ['emblem'], emblem: 0.85 },
    { face: 'rear', at: [0, 1.84, -1.95], size: [1.75, 0.18], tags: ['band'] },
  ],
};

/** Gap between a decal and the panel under it (plus polygon offset) so it never z-fights. */
const DECAL_LIFT = 0.012;

/** Build `style`'s decal meshes for `kind`, all sharing `mat` (whose map is set here). Returns a Group to parent
 *  under the plow body (dispose its geometries when replacing it). */
export function buildDecals(kind: PlowKind, style: DecalStyle, mat: THREE.MeshStandardMaterial): THREE.Group {
  const group = new THREE.Group();
  group.name = 'decals';
  mat.map = getDecalTexture(style);
  mat.emissiveMap = mat.map;
  mat.needsUpdate = true;
  const tag = DECAL_TAG[style];
  const [cw, ch] = DECAL_CANVAS[style];
  for (const spot of DECAL_SPOTS[kind]) {
    if (!spot.tags.includes(tag)) continue;
    const emblem = tag === 'emblem';
    const [a, b] = spot.size;
    const w = emblem ? (spot.emblem ?? Math.min(a, b) * 0.9) : a;
    const h = emblem ? w : b;
    const geo = new THREE.PlaneGeometry(w, h);
    if (tag === 'band') {
      // Tile the checker along the length so the squares stay square.
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      const reps = Math.max(1, Math.round((w / h) * (ch / cw)));
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * reps);
    }
    const copies = spot.face === 'side' || spot.pair ? [1, -1] : [1];
    for (const sx of copies) {
      const holder = new THREE.Group();
      holder.position.set(spot.at[0] * sx, spot.at[1], spot.at[2]);
      holder.rotation.x = spot.tilt ?? 0;
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      if (spot.face === 'top') {
        // Long decals: u runs front -> back. Emblems: upright when seen from the chase camera behind the plow.
        m.rotation.set(-Math.PI / 2, 0, emblem ? Math.PI : Math.PI / 2);
        m.position.y = DECAL_LIFT;
      } else if (spot.face === 'side') {
        // u runs front -> back on both flanks (the -X copy is mirrored so flames still lick backwards).
        m.rotation.y = (Math.PI / 2) * sx;
        m.position.x = DECAL_LIFT * sx;
        if (sx < 0) m.scale.x = -1;
      } else {
        m.rotation.y = Math.PI;
        m.position.z = -DECAL_LIFT;
      }
      holder.add(m);
      group.add(holder);
    }
  }
  // All spots share `mat`: one draw (the emptied holders are dropped).
  if (mergeStatic(group).meshes.length) for (const h of group.children.filter((o) => !(o as THREE.Mesh).isMesh)) group.remove(h);
  return group;
}

/** Trail emitters (model-local): the two rear corners, low down. */
export const TRAIL_REAR: Readonly<Record<PlowKind, { x: number; y: number; z: number }>> = {
  classic: { x: 0.8, y: 0.9, z: -2.15 },
  volt: { x: 0.75, y: 0.85, z: -2.1 },
  brute: { x: 1.1, y: 0.8, z: -2.3 },
};

const _trailCol = new THREE.Color();
const pick = (colors: readonly number[]) => colors[(Math.random() * colors.length) | 0] ?? 0xffffff;

/** One trail puff at `at` (world). Called a few dozen times a second while driving; `dash` makes it denser and
 *  livelier. `t` (seconds) drives the rainbow's hue cycle. */
export function emitTrail(fx: FxAPI, trail: TrailDef, at: THREE.Vector3, dash: boolean, t: number): void {
  const c = trail.colors;
  switch (trail.style) {
    case 'ice':
      fx.burst(at, { color: pick(c), count: dash ? 6 : 2, speed: dash ? 2.4 : 1.1, size: 0.16, gravity: 2, life: 1.2 });
      break;
    case 'fire':
      fx.burst(at, { color: pick(c), count: dash ? 6 : 2, speed: dash ? 2.2 : 1.3, size: dash ? 0.45 : 0.33, gravity: -6, life: dash ? 0.75 : 0.54 });
      break;
    case 'spark':
      fx.burst(at, { color: pick(c), count: dash ? 8 : 4, speed: dash ? 8 : 5, size: 0.09, gravity: 14, life: 0.32 });
      break;
    case 'confetti':
      fx.burst(at, { color: pick(c), count: dash ? 6 : 2, speed: dash ? 4.5 : 3, size: 0.18, gravity: 6, life: 1.5 });
      break;
    case 'rainbow':
      _trailCol.setHSL((t * 0.45) % 1, 0.9, 0.58);
      fx.burst(at, { color: _trailCol.getHex(), count: dash ? 8 : 4, speed: dash ? 1 : 0.4, size: dash ? 0.3 : 0.22, gravity: 0.3, life: 1.2 });
      break;
    default:
      break;
  }
}
