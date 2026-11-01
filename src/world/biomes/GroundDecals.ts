import * as THREE from 'three';
import type { MaterialPatch, Terrain, TerrainShape } from '../Terrain';
import type { BiomeKey } from '../../config/zones';
import { lavaFringeFor, snowCellFor } from '../SnowField';

/**
 * What a biome draws ON the ground of the arena: glowing lava ribbons and glassy ice sheets that match the terrain's
 * material patches exactly (circle or capsule), and a deck on each ramp (glazed ice, a steel launch plate or a grate)
 * with a bright lip strip so a launch reads from a distance.
 *
 * Each decal is a strip mesh in the patch's own frame (rows along the axis, a few columns across, half-discs at the
 * ends), so its outline IS the patch's outline. The ground height is sampled once at build time (the ground layer never
 * moves; normals come from it too). Lava sits on the bare ground (SnowField never keeps snow on it). The other decals
 * also ride on the snow: its depth is re-added a few times a second (cheap, a few thousand lookups per second).
 *
 * Every lava patch also gets a basalt crust ring: an annulus from just under the lava's edge out past SnowField's melt
 * fringe (the hollow where the snow thins to nothing at the lava), draped on the snow, opaque near the lava and fading
 * out on the full-depth snow. It hides the hollow's slope so a vent reads as a clean glowing pool in a dark crust.
 * The Thermal Divide's scorch film uses the snow grid's own cells and diagonals so it hugs the snow mesh exactly.
 *
 * All decals of one material share one merged mesh: at most 6 draws (scorch, lava, crust, ice, ramp decks, lips).
 */

const SNOW_REFRESH = 0.25;
/** Height (m) of each layer above what it lies on: scorch film < crust ring < lava pool (and the other decals). */
const LIFT = 0.05;
const SCORCH_LIFT = 0.012;
/** The crust ring rises from under the pool (inner edge) to well above the snow (outer part): between its vertices
 *  the snow mesh's own triangles can bulge a few cm above a straight span (more on the 1 m grid of the big arenas). */
const CRUST_LIFT_IN = 0.02;
const CRUST_LIFT_OUT = 0.06;
/** The crust ring starts this far inside the lava edge (tucked under the pool, so no seam between the outlines). */
const CRUST_TUCK = 0.2;

interface Draped {
  mesh: THREE.Mesh;
  pos: THREE.BufferAttribute;
  /** Ground height + lift per vertex (precomputed). */
  base: Float32Array;
  /** False: the decal lies on the bare ground (lava), never re-seated on the snow. */
  onSnow: boolean;
}

interface Strip { xz: number[]; uv: number[]; index: number[] }

/** Strip mesh covering a capsule (A -> B, radius r; A = B for a circle). uv = (metres along the axis, -1..1 across). */
function capsuleStrip(p: MaterialPatch, step: number, across: number, grow = 0): { xz: number[]; uv: number[]; index: number[] } {
  const ax = p.x;
  const az = p.z;
  const bx = p.x2 ?? p.x;
  const bz = p.z2 ?? p.z;
  const r = p.r + grow;
  const L = Math.hypot(bx - ax, bz - az);
  const ux = L > 1e-6 ? (bx - ax) / L : 1;
  const uz = L > 1e-6 ? (bz - az) / L : 0;
  const vx = -uz;
  const vz = ux;
  const xz: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  // rows: denser near the caps so the round ends stay round
  const rows: number[] = [];
  const capN = Math.max(4, Math.ceil((r * Math.PI) / 2 / step));
  for (let i = 0; i <= capN; i++) rows.push(-r * Math.cos((i / capN) * (Math.PI / 2)));
  const midN = Math.max(1, Math.ceil(L / step));
  for (let i = 1; i <= midN; i++) rows.push((L * i) / midN);
  for (let i = 1; i <= capN; i++) rows.push(L + r * Math.sin((i / capN) * (Math.PI / 2)));
  for (let ri = 0; ri < rows.length; ri++) {
    const s = rows[ri];
    const w = s < 0 ? Math.sqrt(Math.max(0, r * r - s * s)) : s > L ? Math.sqrt(Math.max(0, r * r - (s - L) * (s - L))) : r;
    for (let ci = 0; ci <= across; ci++) {
      const t = (ci / across) * 2 - 1;
      xz.push(ax + ux * s + vx * t * w, az + uz * s + vz * t * w);
      uv.push(s, t);
    }
    if (ri > 0) {
      const a0 = (ri - 1) * (across + 1);
      const b0 = ri * (across + 1);
      for (let ci = 0; ci < across; ci++) index.push(a0 + ci, a0 + ci + 1, b0 + ci, a0 + ci + 1, b0 + ci + 1, b0 + ci);
    }
  }
  return { xz, uv, index };
}

/**
 * Annulus around a capsule / circle patch, from radius r0 to r1 (offset curves of the patch outline), with a few rings
 * in between so it can follow the snow's melt hollow. uv = (0 at r0 .. 1 at r1, metres along the outline).
 */
export function crustRing(p: MaterialPatch, r0: number, r1: number, step: number, rings = 6): Strip {
  const ax = p.x;
  const az = p.z;
  const bx = p.x2 ?? p.x;
  const bz = p.z2 ?? p.z;
  const L = Math.hypot(bx - ax, bz - az);
  const ux = L > 1e-6 ? (bx - ax) / L : 1;
  const uz = L > 1e-6 ? (bz - az) / L : 0;
  const vx = -uz;
  const vz = ux;
  // outline samples: centre on the axis + outward unit normal (closed loop, last sample repeats the first)
  const cs: number[] = [];
  const capN = Math.max(8, Math.ceil((Math.PI * r1) / step));
  const push = (cx: number, cz: number, nx: number, nz: number) => cs.push(cx, cz, nx, nz);
  if (L <= 1e-6) {
    const n = capN * 2;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      push(ax, az, Math.cos(a), Math.sin(a));
    }
  } else {
    const sideN = Math.max(1, Math.ceil(L / step));
    for (let i = 0; i < sideN; i++) push(ax + ux * ((L * i) / sideN), az + uz * ((L * i) / sideN), vx, vz);
    for (let i = 0; i < capN; i++) {
      const f = (i / capN) * Math.PI;
      push(bx, bz, vx * Math.cos(f) + ux * Math.sin(f), vz * Math.cos(f) + uz * Math.sin(f));
    }
    for (let i = 0; i < sideN; i++) push(bx - ux * ((L * i) / sideN), bz - uz * ((L * i) / sideN), -vx, -vz);
    for (let i = 0; i <= capN; i++) {
      const f = (i / capN) * Math.PI;
      push(ax, az, -vx * Math.cos(f) - ux * Math.sin(f), -vz * Math.cos(f) - uz * Math.sin(f));
    }
  }
  const n = cs.length / 4;
  const xz: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  let len = 0;
  for (let i = 0; i < n; i++) {
    const cx = cs[i * 4];
    const cz = cs[i * 4 + 1];
    const nx = cs[i * 4 + 2];
    const nz = cs[i * 4 + 3];
    if (i > 0) len += Math.hypot(cx + nx * r1 - (cs[i * 4 - 4] + cs[i * 4 - 2] * r1), cz + nz * r1 - (cs[i * 4 - 3] + cs[i * 4 - 1] * r1));
    for (let k = 0; k <= rings; k++) {
      // denser rings near the lava, where the hollow is steepest
      const t = k / rings;
      const f = t * t * 0.35 + t * 0.65;
      const rr = r0 + (r1 - r0) * f;
      xz.push(cx + nx * rr, cz + nz * rr);
      uv.push(f, len);
    }
    if (i > 0) {
      const a0 = (i - 1) * (rings + 1);
      const b0 = i * (rings + 1);
      for (let k = 0; k < rings; k++) index.push(a0 + k, b0 + k, a0 + k + 1, a0 + k + 1, b0 + k, b0 + k + 1);
    }
  }
  return { xz, uv, index };
}

/** Ramp face strip: toe -> lip (+ along heading), `w` wide. uv = (0..1 along, -1..1 across). */
function rampStrip(s: Extract<TerrainShape, { kind: 'ramp' }>, inset: number, from = 0, to = 1): { xz: number[]; uv: number[]; index: number[] } {
  const fx = Math.sin(s.rot);
  const fz = Math.cos(s.rot);
  // right-hand side vector chosen so the strip's triangles face up (same winding as capsuleStrip)
  const rx = -Math.cos(s.rot);
  const rz = Math.sin(s.rot);
  const half = s.w / 2 - inset;
  const rowsN = Math.max(2, Math.ceil((s.len * (to - from)) / 0.6));
  const across = 4;
  const xz: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (let ri = 0; ri <= rowsN; ri++) {
    const k = from + ((to - from) * ri) / rowsN;
    const v = k * s.len;
    for (let ci = 0; ci <= across; ci++) {
      const t = (ci / across) * 2 - 1;
      xz.push(s.x + fx * v + rx * t * half, s.z + fz * v + rz * t * half);
      uv.push(k, t);
    }
    if (ri > 0) {
      const a0 = (ri - 1) * (across + 1);
      const b0 = ri * (across + 1);
      for (let ci = 0; ci < across; ci++) index.push(a0 + ci, a0 + ci + 1, b0 + ci, a0 + ci + 1, b0 + ci + 1, b0 + ci);
    }
  }
  return { xz, uv, index };
}

/* ------------------------------------------------------------------ materials */

let lavaMat: THREE.ShaderMaterial | null = null;
/** Shared lava clock (Environment advances it every frame: decals and lava falls / pools all use the material). */
export const lavaTime = { value: 0 };

/** Flowing lava: two scrolling value-noise octaves -> yellow-hot cracks in a dark red crust, darker banks. HDR so the
 *  bloom pass picks it up. */
export function getLavaMaterial(): THREE.ShaderMaterial {
  return (lavaMat ??= new THREE.ShaderMaterial({
    uniforms: { uTime: lavaTime },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec2 vW;
      void main() {
        vUv = uv;
        vW = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying vec2 vW;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y);
      }
      void main() {
        float s = vUv.x - uTime * 0.55;
        vec2 p = vec2(s * 0.9, vUv.y * 1.6 + vW.x * 0.07);
        float a = n(p * 1.3 + vec2(0.0, uTime * 0.15)) * 0.65 + n(p * 3.1 - vec2(uTime * 0.4, 0.0)) * 0.35;
        float crack = smoothstep(0.42, 0.62, a);
        float bank = smoothstep(0.55, 1.0, abs(vUv.y));
        vec3 crust = vec3(0.16, 0.03, 0.015);
        vec3 hot = mix(vec3(1.0, 0.28, 0.04), vec3(1.0, 0.82, 0.25), smoothstep(0.62, 0.85, a));
        vec3 c = mix(hot * 1.9, crust, (1.0 - crack) * 0.75 + bank * 0.65);
        c += vec3(0.25, 0.05, 0.0) * (0.6 + 0.4 * sin(uTime * 2.3 + vUv.x * 0.8));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    fog: false,
  }));
}

/** Scorched ground over a whole half of the world (The Thermal Divide's hot side): patchy red basalt ash with thin
 *  glowing veins, fading out toward the centre line x = 0. Transparent, drawn over the snow. `floor` = minimum
 *  coverage (0..1): the arena floor keeps snow showing through, the skirt outside the walls is nearly solid. */
export function scorchMaterial(side: number, floor = 0.3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsLib.fog, uTime: lavaTime, uSide: { value: side }, uFloor: { value: floor } },
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vW;
      void main() {
        vW = position.xz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform float uSide;
      uniform float uFloor;
      varying vec2 vW;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y);
      }
      void main() {
        float edge = smoothstep(0.0, 6.0, vW.x * uSide);
        float a = n(vW * 0.18) * 0.6 + n(vW * 0.5 + 7.0) * 0.4;
        float ash = smoothstep(0.3, 0.6, a) * 0.75 + uFloor;
        float r = abs(n(vW * 0.22 + 3.0) - 0.5);
        float vein = smoothstep(0.045, 0.0, r) * smoothstep(0.3, 0.55, n(vW * 0.09 + 11.0));
        vec3 c = mix(vec3(0.27, 0.075, 0.05), vec3(0.5, 0.16, 0.09), n(vW * 0.7));
        c = mix(c, vec3(1.0, 0.36, 0.06) * (1.6 + 0.4 * sin(uTime * 2.0 + vW.y * 0.3)), vein);
        float alpha = clamp(max(ash * 0.88, vein), 0.0, 1.0) * edge;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(c, alpha);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    fog: true,
  });
}

let crustMat: THREE.ShaderMaterial | null = null;
/** Basalt crust around lava: a thin glowing rim at the lava edge, dark cracked basalt, then a ragged fade onto the
 *  snow (uv.x = 0 at the lava .. 1 outside). Transparent, drawn over the snow / scorch, under the lava pool. */
export function getCrustMaterial(): THREE.ShaderMaterial {
  return (crustMat ??= new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsLib.fog, uTime: lavaTime },
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vUv;
      varying vec2 vW;
      void main() {
        vUv = uv;
        vW = position.xz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float uTime;
      varying vec2 vUv;
      varying vec2 vW;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y);
      }
      void main() {
        float k = vUv.x;
        float n1 = n(vW * 1.9);
        float n2 = n(vW * 0.7 + 5.0);
        vec3 c = mix(vec3(0.075, 0.04, 0.035), vec3(0.2, 0.1, 0.075), n1);
        // hairline cracks glowing faintly
        float crack = smoothstep(0.06, 0.0, abs(n(vW * 1.1 + 9.0) - 0.5)) * (1.0 - smoothstep(0.2, 0.6, k));
        float rim = 1.0 - smoothstep(0.0, 0.2, k + 0.06 * n1);
        float pulse = 0.75 + 0.25 * sin(uTime * 2.3 + vUv.y * 0.8);
        c = mix(c, vec3(1.0, 0.33, 0.06) * 1.6 * pulse, max(rim, crack * 0.7));
        float edge = 0.5 + 0.22 * n2;
        float alpha = (1.0 - smoothstep(edge, edge + 0.3, k)) * (1.0 - smoothstep(0.88, 1.0, k));
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(c, alpha);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // less offset than the lava pool (-2) so the pool always wins where the two overlap
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    fog: true,
  }));
}

/** Grid over x in [x0, x1], z in [z0, z1] at `step` m. Diagonals alternate like the snow mesh's (by (ix + iz) parity),
 *  so a grid on the snow grid's own vertices follows the snow surface exactly. */
function gridStrip(x0: number, x1: number, z0: number, z1: number, step: number): { xz: number[]; uv: number[]; index: number[] } {
  const nx = Math.max(1, Math.round((x1 - x0) / step));
  const nz = Math.max(1, Math.round((z1 - z0) / step));
  const xz: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (let iz = 0; iz <= nz; iz++) {
    for (let ix = 0; ix <= nx; ix++) {
      xz.push(x0 + ((x1 - x0) * ix) / nx, z0 + ((z1 - z0) * iz) / nz);
      uv.push(ix / nx, iz / nz);
    }
    if (iz > 0) {
      const a0 = (iz - 1) * (nx + 1);
      const b0 = iz * (nx + 1);
      // winding: +x columns, +z rows -> (a, c, b) faces up; a = (ix, iz - 1), b = a + 1, c / d = next row
      for (let ix = 0; ix < nx; ix++) {
        const a = a0 + ix;
        const b = a + 1;
        const c = b0 + ix;
        const d = c + 1;
        if ((ix + iz - 1) & 1) index.push(a, c, b, b, c, d);
        else index.push(a, c, d, a, d, b);
      }
    }
  }
  return { xz, uv, index };
}

let iceTex: THREE.Texture | null = null;
/** Glassy ice with white fracture lines (tiles every 6 m in world space). Seamless: the soft light / dark blotches and
 *  the cracks are each drawn at all nine wrapped offsets, so no tile edge shows (a plain gradient made a hard seam
 *  every 6 m, which read as wedge-shaped shading across the ice sheets). */
function getIceTex(): THREE.Texture {
  if (iceTex) return iceTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b8e3f8';
  g.fillRect(0, 0, S, S);
  let s = 11;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const wrapped = (draw: (ox: number, oy: number) => void) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) draw(ox, oy);
  };
  for (let k = 0; k < 10; k++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 40 + r() * 70;
    const light = k % 2 === 0;
    wrapped((ox, oy) => {
      const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      grd.addColorStop(0, light ? 'rgba(214,242,253,0.55)' : 'rgba(150,206,238,0.45)');
      grd.addColorStop(1, light ? 'rgba(214,242,253,0)' : 'rgba(150,206,238,0)');
      g.fillStyle = grd;
      g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    });
  }
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineCap = 'round';
  for (let k = 0; k < 9; k++) {
    const pts: number[] = [];
    let x = r() * S;
    let y = r() * S;
    let a = r() * Math.PI * 2;
    pts.push(x, y);
    for (let i = 0; i < 7; i++) {
      a += (r() - 0.5) * 1.2;
      x += Math.cos(a) * 22;
      y += Math.sin(a) * 22;
      pts.push(x, y);
    }
    g.lineWidth = 1 + r() * 2;
    wrapped((ox, oy) => {
      g.beginPath();
      g.moveTo(pts[0] + ox, pts[1] + oy);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i] + ox, pts[i + 1] + oy);
      g.stroke();
    });
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  iceTex = t;
  return t;
}

let plateTex: THREE.Texture | null = null;
/** Steel launch plate: tread pattern with a yellow / black hazard band at the lip (v = 1). */
function getPlateTex(): THREE.Texture {
  if (plateTex) return plateTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5b5f66';
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = '#7b8089';
  for (let y = 8; y < 216; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < 128; x += 16) g.fillRect(x, y, 9, 3);
  g.fillStyle = '#f2c230';
  g.fillRect(0, 0, 128, 40);
  g.fillStyle = '#1b1b1f';
  for (let x = -40; x < 168; x += 26) {
    g.beginPath();
    g.moveTo(x, 40);
    g.lineTo(x + 13, 40);
    g.lineTo(x + 53, 0);
    g.lineTo(x + 40, 0);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  plateTex = t;
  return t;
}

/* ------------------------------------------------------------------ decals */

export class GroundDecals {
  readonly group = new THREE.Group();
  private draped: Draped[] = [];
  private snowT = 0;
  private mats: THREE.Material[] = [];

  /** `depth(x, z)` = snow depth there (SnowField.getDepth), read a few times a second. `half` = arena half-size
   *  (the Divide's scorched half covers it). */
  constructor(terrain: Terrain, biome: BiomeKey | null, private depth: (x: number, z: number) => number, half = 30) {
    this.group.name = 'GroundDecals';
    // the snow grid this arena gets (SnowField: field = arena + 8 m, cell by size), for the scorch film and the crust
    const cell = snowCellFor(2 * half + 8);
    if (biome === 'divide') {
      const m = scorchMaterial(-1);
      this.mats.push(m);
      // on the snow grid's own vertices (-half is a whole, even number of cells from the field's edge)
      this.add(terrain, [gridStrip(-half, 0, -half, half, cell)], m, false, 1, { lift: SCORCH_LIFT });
    }
    const lava: Strip[] = [];
    const crust: Strip[] = [];
    const ice: Strip[] = [];
    const grow = lavaFringeFor(cell) + 0.4;
    for (const p of terrain.patches) {
      if (p.material === 'lava') {
        lava.push(capsuleStrip(p, 0.6, 6));
        crust.push(crustRing(p, p.r - CRUST_TUCK, p.r + grow, 0.5));
      } else if (p.material === 'ice') ice.push(capsuleStrip(p, 0.9, 6));
    }
    const ramps = terrain.shapes.filter((s): s is Extract<TerrainShape, { kind: 'ramp' }> => s.kind === 'ramp');
    // ramps on ice patches are already glazed by the ice decal; the others get a deck by biome
    const decks: ReturnType<typeof rampStrip>[] = [];
    const lips: ReturnType<typeof rampStrip>[] = [];
    for (const s of ramps) {
      const glazed = terrain.materialAt(s.x + Math.sin(s.rot) * s.len * 0.5, s.z + Math.cos(s.rot) * s.len * 0.5) === 'ice';
      if (!glazed && biome !== 'mars') decks.push(rampStrip(s, 0.5));
      lips.push(rampStrip(s, 0.35, 0.93, 1));
    }
    if (lava.length) {
      this.add(terrain, lava, getLavaMaterial(), false, 3, { onSnow: false });
      const out = CRUST_LIFT_OUT * (cell / 0.5) ** 0.5;
      const k0 = CRUST_TUCK / (grow + CRUST_TUCK);
      this.add(terrain, crust, getCrustMaterial(), false, 1.5, {
        lift: (k) => CRUST_LIFT_IN + (out - CRUST_LIFT_IN) * Math.min(1, Math.max(0, (k - k0) / k0)),
        hull: 0.3,
      });
    }
    if (ice.length) {
      const m = new THREE.MeshStandardMaterial({
        color: 0xffffff, map: getIceTex(), roughness: 0.06, metalness: 0.15, transparent: true, opacity: 0.86,
        emissive: 0x174a6a, emissiveIntensity: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      this.mats.push(m);
      this.add(terrain, ice, m, true, 2, { worldUv: true });
    }
    if (decks.length) {
      const m = new THREE.MeshStandardMaterial({
        color: biome === 'divide' ? 0x9aa0aa : 0xffffff, map: getPlateTex(), roughness: 0.45, metalness: 0.55,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      });
      this.mats.push(m);
      this.add(terrain, decks, m, true, 3, { rampUv: true });
    }
    if (lips.length) {
      const glow = biome === 'quarry' ? 0xffb340 : biome === 'mars' ? 0xffe0b0 : biome === 'divide' ? 0xff9a6a : 0x9ff3ff;
      const m = new THREE.MeshBasicMaterial({ color: glow, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      this.mats.push(m);
      this.add(terrain, lips, m, false, 4);
    }
    this.refresh();
  }

  private add(
    terrain: Terrain, parts: Strip[], mat: THREE.Material, receive: boolean, order: number,
    /** lift: height above the ground + snow, or a function of the strip's uv.x (crust ring: 0 at the lava .. 1). */
    /** hull: sample the ground as the highest of the vertex and four points this far around it, so a ring crossing a
     *  crease (a ramp's lip or fall) between its vertices still clears the ground there. */
    opts: { worldUv?: boolean; rampUv?: boolean; lift?: number | ((u: number) => number); onSnow?: boolean; hull?: number } = {},
  ): void {
    const { worldUv = false, rampUv = false, lift = LIFT, onSnow = true, hull = 0 } = opts;
    const groundAt = (x: number, z: number) => {
      let y = terrain.ground(x, z);
      if (hull > 0 && terrain.active) {
        y = Math.max(y, terrain.ground(x + hull, z), terrain.ground(x - hull, z), terrain.ground(x, z + hull), terrain.ground(x, z - hull));
      }
      return y;
    };
    let nv = 0;
    for (const p of parts) nv += p.xz.length / 2;
    const pos = new Float32Array(nv * 3);
    const uv = new Float32Array(nv * 2);
    const base = new Float32Array(nv);
    const index: number[] = [];
    let o = 0;
    for (const p of parts) {
      const n = p.xz.length / 2;
      for (let i = 0; i < n; i++) {
        const x = p.xz[i * 2];
        const z = p.xz[i * 2 + 1];
        pos[(o + i) * 3] = x;
        pos[(o + i) * 3 + 2] = z;
        base[o + i] = groundAt(x, z) + (typeof lift === 'number' ? lift : lift(p.uv[i * 2]));
        pos[(o + i) * 3 + 1] = base[o + i];
        if (worldUv) {
          uv[(o + i) * 2] = x / 6;
          uv[(o + i) * 2 + 1] = z / 6;
        } else if (rampUv) {
          // plate texture: u across (0..1), v = 1 at the lip
          uv[(o + i) * 2] = (p.uv[i * 2 + 1] + 1) / 2;
          uv[(o + i) * 2 + 1] = p.uv[i * 2];
        } else {
          uv[(o + i) * 2] = p.uv[i * 2];
          uv[(o + i) * 2 + 1] = p.uv[i * 2 + 1];
        }
      }
      for (const k of p.index) index.push(k + o);
      o += n;
    }
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(pos, 3);
    if (onSnow) attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    // Normals from the ground alone, once: the ground never moves, and the snow under the lit decals (ice: thin snow,
    // ramp decks) only adds a near-uniform offset. (Snow can't be used here: the world is dressed before the snow
    // field is reset for the new arena, so it would still be the previous arena's.)
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = receive;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    this.draped.push({ mesh, pos: attr, base, onSnow });
  }

  /** Re-seat every snow-riding vertex on ground + snow. */
  private refresh(): void {
    for (const d of this.draped) {
      if (!d.onSnow) continue;
      const a = d.pos.array as Float32Array;
      const n = d.base.length;
      for (let i = 0; i < n; i++) a[i * 3 + 1] = d.base[i] + this.depth(a[i * 3], a[i * 3 + 2]);
      d.pos.needsUpdate = true;
    }
  }

  update(dt: number): void {
    this.snowT -= dt;
    if (this.snowT <= 0) {
      this.snowT = SNOW_REFRESH;
      this.refresh();
    }
  }

  dispose(): void {
    for (const d of this.draped) d.mesh.geometry.dispose();
    for (const m of this.mats) m.dispose();
    this.draped.length = 0;
    this.group.removeFromParent();
  }
}
