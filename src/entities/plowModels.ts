import * as THREE from 'three';

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
  for (let i = 0; i < TEETH; i++) {
    const a = (i / TEETH) * Math.PI * 2;
    const t = new THREE.Mesh(k.toothGeo, k.tooth);
    t.position.set(Math.cos(a) * (R - 0.04), 0, Math.sin(a) * (R - 0.04));
    t.rotation.y = -a - 0.35;
    rotor.add(t);
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
  return { group, rotor, halo };
}
