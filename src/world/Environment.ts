import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameContext, Obstacle, WorldAPI, ZoneDef } from '../core/types';
import { StaticBatch } from '../render/mergeStatic';
import { makeShadowProxy } from '../render/shadowProxy';
import type { ShadowProxy } from '../render/shadowProxy';
import { ARENA, ENEMY_GATES, GATE_WIDTH } from '../core/types';

type Theme = ZoneDef['theme'];

interface Item {
  x: number;
  y: number;
  z: number;
  ry: number;
  sx: number;
  sy: number;
  sz: number;
  rx?: number;
  rz?: number;
  color?: number;
}

/** Per-arena look: wall blocks, metal trim, banner/crowd accents, gate lights, stands, floodlights. */
interface Style {
  block: number;
  blockAlt: number;
  trim: number;
  accents: number[];
  gate: number;
  stand: number;
  standAlt: number;
  tire: number;
  lamp: number;
  /** Spot light intensity (candela) of the two floodlight spots. */
  spot: number;
  glow: number;
  rock: number;
  mountain: number;
}

const STYLES: Record<Theme, Style> = {
  // Frostbite Yard — snowy scrapyard
  meadow: {
    block: 0xa9c8e6, blockAlt: 0x8db3d8, trim: 0x59636f, accents: [0xffc21a, 0x2f7de1, 0xe8423a], gate: 0xffa21a,
    stand: 0x707b87, standAlt: 0x56606c, tire: 0x222429, lamp: 0xfff2d6, spot: 700, glow: 0.45, rock: 0x8a8f99, mountain: 0x7d93b8,
  },
  // Pine Junkyard — rusty, warm
  pines: {
    block: 0xd8c8b2, blockAlt: 0xc2ae94, trim: 0x7a4a2c, accents: [0xff7a2e, 0x2e9b5f, 0xffd23a], gate: 0xff6a1e,
    stand: 0x6b4e38, standAlt: 0x523b2b, tire: 0x25211e, lamp: 0xffdcaa, spot: 900, glow: 0.5, rock: 0x6e6a66, mountain: 0x4f6378,
  },
  // Frozen Foundry — ice-locked ironworks
  lake: {
    block: 0x8fd3f5, blockAlt: 0x6cbde8, trim: 0x3b4a58, accents: [0x6ff3ff, 0xff8a3d, 0xffffff], gate: 0x5fe8ff,
    stand: 0x52616f, standAlt: 0x3c4854, tire: 0x1f2328, lamp: 0xe8f7ff, spot: 700, glow: 0.45, rock: 0x7f93a3, mountain: 0x87a5bf,
  },
  // Blizzard Bowl — whiteout stadium
  blizzard: {
    block: 0xbccada, blockAlt: 0xa5b6c8, trim: 0x8a94a2, accents: [0xe8263a, 0x6f8cff, 0xffffff], gate: 0xff3a2a,
    stand: 0xbac3cd, standAlt: 0x9ca6b2, tire: 0x2a2d33, lamp: 0xffffff, spot: 1100, glow: 0.7, rock: 0x4a4f58, mountain: 0xb7c1cc,
  },
  // Omega Summit — the factory at the top of the world
  peak: {
    block: 0xab9cdc, blockAlt: 0x9282cc, trim: 0x2b2440, accents: [0xd24dff, 0x6ff3ff, 0xff7ad9], gate: 0xd24dff,
    stand: 0x3c3453, standAlt: 0x2b2541, tire: 0x1c1a22, lamp: 0xf2dcff, spot: 2000, glow: 0.8, rock: 0x4b4058, mountain: 0x3d3150,
  },
  // THE SNOWDOME — colossal free-for-all stadium
  brawl: {
    block: 0x3a4a78, blockAlt: 0x2f3d68, trim: 0x1d2236, accents: [0xff3d7f, 0x22d3ff, 0xffd23a, 0x7cff5a], gate: 0xff3d7f,
    stand: 0x39405a, standAlt: 0x2c3249, tire: 0x1c1d22, lamp: 0xfff3e0, spot: 14000, glow: 0.85, rock: 0x6c7280, mountain: 0x5b5f8a,
  },
};

/** Confetti palette for Snowdome flags / crowd. */
const CONFETTI = [0xff3d7f, 0x22d3ff, 0xffd23a, 0x7cff5a, 0xb45cff, 0xff8c00, 0xffffff];

const FOLIAGE = [0x1f5a3c, 0x245f3a, 0x2d6b45, 0x1a4d35];

/* ---------------------------------------------------------------- arena layout */

/** Gap between the ARENA edge and the inner face of the wall blocks (trim / banners live here). */
const WALL_IN = 0.12;
const WALL_T = 1.6;
/** Outer extent of the wall measured from the arena edge. */
const WALL_C = WALL_IN + WALL_T;
const WALL_H = 2.5;
/** The south wall is a bit lower: the follow camera lives behind it. */
const SOUTH_H = 1.9;
const GATE_HALF = GATE_WIDTH / 2;
const PILLAR_W = 1.2;
const STAND_N0 = WALL_C + 1.9;
const ROWS = 6;
const ROW_D = 1.25;
const ROW_RISE = 0.62;
const TOWER_OFF = 5.6;
const TUNNEL_LEN = 10.5;
/* Snowdome (Brawl) stadium */
const DOME_TOWER_OFF = 14;
const DOME_TOWER_K = 2.3;
const DOME_TOWER_H = 16.5 * DOME_TOWER_K;
const DOME_N0 = WALL_C + 3.5;
const DOME_ROWS = 12;
const DOME_ROW_D = 1.8;
const DOME_RISE = 1.15;
const DOME_CROWD_CAP = 3000;
const SPONSORS: [string, string, string][] = [
  ['FROSTCOLA', '#d7263d', '#ffffff'], ['PLOWTECH', '#1b98e0', '#ffffff'], ['BRRR ENERGY', '#111111', '#7cff5a'],
  ['SLUSH BANK', '#ffd23a', '#1a1a2e'], ['YETI TIRES', '#2b2d42', '#ff8c00'], ['ICEBOX+', '#22d3ff', '#0b1230'],
  ['CHILL.GG', '#b45cff', '#ffffff'], ['SNOWDOME', '#ff3d7f', '#ffffff'],
];
/** Omega Summit's core tower (north-west, clear of the jumbotron sightline). */
const CORE_X = -34;
const CORE_Z = -92;

type SideKey = 'n' | 's' | 'w' | 'e';
interface Side {
  key: SideKey;
  /** Yaw that turns local +Z toward the arena interior. */
  yaw: number;
  /** (s along the wall, n outward distance from the arena edge) -> world [x, z]. */
  map: (s: number, n: number) => [number, number];
  s0: number;
  s1: number;
  h: number;
}

/** Snowdome mode: no gates, uniform wall height. Set by buildDecor. */
let brawlMode = false;
const BRAWL_WALL_H = 3.0;

// s0/s1/h are getters: ARENA is mutable (campaign ±30 / Brawl ±90).
const SIDES: Side[] = [
  { key: 'n', yaw: 0, map: (s, n) => [s, ARENA.minZ - n], get s0() { return ARENA.minX - WALL_C; }, get s1() { return ARENA.maxX + WALL_C; }, get h() { return brawlMode ? BRAWL_WALL_H : WALL_H; } },
  { key: 's', yaw: Math.PI, map: (s, n) => [s, ARENA.maxZ + n], get s0() { return ARENA.minX - WALL_C; }, get s1() { return ARENA.maxX + WALL_C; }, get h() { return brawlMode ? BRAWL_WALL_H : SOUTH_H; } },
  { key: 'w', yaw: Math.PI / 2, map: (s, n) => [ARENA.minX - n, s], get s0() { return ARENA.minZ - WALL_IN; }, get s1() { return ARENA.maxZ + WALL_IN; }, get h() { return brawlMode ? BRAWL_WALL_H : WALL_H; } },
  { key: 'e', yaw: -Math.PI / 2, map: (s, n) => [ARENA.maxX + n, s], get s0() { return ARENA.minZ - WALL_IN; }, get s1() { return ARENA.maxZ + WALL_IN; }, get h() { return brawlMode ? BRAWL_WALL_H : WALL_H; } },
];

/** Which wall each gate sits in, and its coordinate along that wall (campaign arena only). */
const GATE_SIDES = ENEMY_GATES.map((g) => {
  const key: SideKey = g.z < -30 ? 'n' : g.z > 30 ? 's' : g.x < -30 ? 'w' : 'e';
  return { key, s: key === 'n' || key === 's' ? g.x : g.z };
});

function gapsFor(key: SideKey, half: number): [number, number][] {
  if (brawlMode) return [];
  return GATE_SIDES.filter((g) => g.key === key).map((g) => [g.s - half, g.s + half] as [number, number]);
}

function subtract(a: number, b: number, gaps: [number, number][]): [number, number][] {
  let out: [number, number][] = [[a, b]];
  for (const [g0, g1] of gaps) {
    const next: [number, number][] = [];
    for (const [x0, x1] of out) {
      if (g1 <= x0 || g0 >= x1) next.push([x0, x1]);
      else {
        if (g0 > x0) next.push([x0, g0]);
        if (g1 < x1) next.push([g1, x1]);
      }
    }
    out = next;
  }
  return out.filter(([x0, x1]) => x1 - x0 > 0.5);
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Adds a constant vertex-color attribute (for merged multi-colored instanced models). */
function colored(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return g;
}

/* ---------------------------------------------------------------- canvas textures */

let snowflakeTex: THREE.Texture | null = null;
let glowTex: THREE.Texture | null = null;
let hazardTex: THREE.Texture | null = null;
let doorTex: THREE.Texture | null = null;
let bannerTex: THREE.Texture | null = null;
let chevronTex: THREE.Texture | null = null;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTex(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function radial(size: number, stops: [number, string][]): HTMLCanvasElement {
  const [c, g] = canvas(size, size);
  const h = size / 2;
  const grd = g.createRadialGradient(h, h, 0, h, h, h);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

function getSnowflakeTex(): THREE.Texture {
  return (snowflakeTex ??= toTex(radial(64, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.85)'], [1, 'rgba(255,255,255,0)']])));
}

function getGlowTex(): THREE.Texture {
  return (glowTex ??= toTex(radial(128, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']])));
}

function drawHazard(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, period: number): void {
  g.save();
  g.beginPath();
  g.rect(x0, y0, w, h);
  g.clip();
  g.fillStyle = '#f2c230';
  g.fillRect(x0, y0, w, h);
  g.fillStyle = '#1b1b1f';
  for (let x = x0 - h - period; x < x0 + w + period; x += period) {
    g.beginPath();
    g.moveTo(x, y0 + h);
    g.lineTo(x + period / 2, y0 + h);
    g.lineTo(x + period / 2 + h, y0);
    g.lineTo(x + h, y0);
    g.closePath();
    g.fill();
  }
  g.restore();
}

function getHazardTex(): THREE.Texture {
  if (hazardTex) return hazardTex;
  const [c, g] = canvas(128, 32);
  drawHazard(g, 0, 0, 128, 32, 32);
  hazardTex = toTex(c, true);
  hazardTex.repeat.set(5, 1);
  return hazardTex;
}

function getDoorTex(): THREE.Texture {
  if (doorTex) return doorTex;
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#ccd1d8';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 220; y += 27) {
    g.fillStyle = '#8b929c';
    g.fillRect(0, y, 256, 4);
    g.fillStyle = '#eceff3';
    g.fillRect(0, y + 4, 256, 2);
  }
  g.fillStyle = '#20252e';
  for (let i = 0; i < 4; i++) g.fillRect(18 + i * 60, 38, 44, 13);
  drawHazard(g, 0, 222, 256, 34, 34);
  doorTex = toTex(c);
  return doorTex;
}

function getBannerTex(): THREE.Texture {
  if (bannerTex) return bannerTex;
  const [c, g] = canvas(128, 192);
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(128, 0);
  g.lineTo(128, 192);
  g.lineTo(64, 150);
  g.lineTo(0, 192);
  g.closePath();
  g.fillStyle = '#ffffff';
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#a6abb3';
  g.stroke();
  g.fillStyle = '#3a3f48';
  g.fillRect(0, 0, 128, 16);
  // snowflake emblem
  g.save();
  g.translate(64, 80);
  g.strokeStyle = '#3a3f48';
  g.lineCap = 'round';
  g.lineWidth = 9;
  for (let k = 0; k < 6; k++) {
    g.rotate(Math.PI / 3);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -34);
    g.moveTo(0, -20);
    g.lineTo(-10, -30);
    g.moveTo(0, -20);
    g.lineTo(10, -30);
    g.stroke();
  }
  g.restore();
  bannerTex = toTex(c);
  return bannerTex;
}

function getChevronTex(): THREE.Texture {
  if (chevronTex) return chevronTex;
  const [c, g] = canvas(64, 64);
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 10;
  g.lineJoin = 'miter';
  g.beginPath();
  g.moveTo(8, 16);
  g.lineTo(32, 42);
  g.lineTo(56, 16);
  g.stroke();
  chevronTex = toTex(c, true);
  chevronTex.repeat.set(1, 3.5);
  return chevronTex;
}

const hexCss = (hex: number) => '#' + hex.toString(16).padStart(6, '0');

/* ---------------------------------------------------------------- environment */

interface GateState {
  group: THREE.Group;
  /** Door instance matrix when fully closed; the roll-up scale.y is applied on top. */
  doorBase: THREE.Matrix4;
  doorScale: number;
  lightMat: THREE.MeshStandardMaterial;
  glowMat: THREE.SpriteMaterial;
  floorMat: THREE.MeshBasicMaterial;
  mouth: THREE.Vector3;
  open: number;
  openT: number;
  flashT: number;
  lastBurst: number;
  phase: number;
}

/** Materials shared by the three gates (created by the first one). */
interface GateMats {
  trim?: THREE.MeshStandardMaterial;
  hazard?: THREE.MeshStandardMaterial;
  door?: THREE.MeshStandardMaterial;
  tunnel?: THREE.MeshStandardMaterial;
  back?: THREE.MeshBasicMaterial;
}

interface Pulse {
  mat: THREE.Material;
  base: number;
  speed: number;
  phase: number;
}

const SNOW_BOX = 70;
const SNOW_H = 36;

export class Environment implements WorldAPI {
  private ctx: GameContext;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private spots: THREE.SpotLight[] = [];
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private fog: THREE.Fog;
  private decor: THREE.Group | null = null;
  private zone: ZoneDef;
  private style: Style = STYLES.meadow;
  private time = 0;
  private rnd: () => number = Math.random;
  private obstacleList: Obstacle[] = [];
  /** Sun offset from its (player-following) target, and the light-space basis for texel snapping. */
  private sunOffset = new THREE.Vector3(45, 80, 55);
  private sunR = new THREE.Vector3();
  private sunU = new THREE.Vector3();
  private sunD = new THREE.Vector3();
  private shadowTexel = 80 / 2048;

  // ambient animation
  private pulses: Pulse[] = [];
  private gates: GateState[] = [];
  private doors: THREE.InstancedMesh | null = null;
  /** Static parts baked while a zone is built (flushed by finishDecor). */
  private batch: StaticBatch | null = null;
  private wallTires: { items: Item[]; mat: THREE.Material } | null = null;
  private crowd: { items: Item[]; phases: Float32Array[]; bodyMat: THREE.Material; eyeMat: THREE.Material } | null = null;
  /** Shadow-only copies of the baked casters (never in the scene; read once by finishDecor). */
  private casters = new THREE.Group();
  private tmpM = new THREE.Matrix4();
  private zoneTex: THREE.Texture[] = [];
  private ticker: THREE.Texture | null = null;
  private spinners: { obj: THREE.Object3D; speed: number }[] = [];
  private puffs: { mesh: THREE.InstancedMesh; stacks: { x: number; y: number; z: number; r: number }[]; per: number } | null = null;
  private bobTime = { value: 0 };
  private dummy = new THREE.Object3D();
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();

  // falling snow
  private flakes: THREE.Points | null = null;
  private flakePos: Float32Array = new Float32Array(0);
  private flakePhase: Float32Array = new Float32Array(0);
  private windX = 1;
  private windZ = 0.4;
  private fallSpeed = 1.5;
  private sway = 0.6;

  get obstacles(): readonly Obstacle[] {
    return this.obstacleList;
  }

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.zone = ctx.zone;
    const scene = ctx.scene;

    this.fog = new THREE.Fog(0xffffff, 60, 170);
    scene.fog = this.fog;
    scene.background = new THREE.Color(0xffffff);

    this.hemi = new THREE.HemisphereLight(0xbcd7ff, 0xe8eef5, 0.9);
    scene.add(this.hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(45, 80, 55);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -40;
    sc.right = 40;
    sc.top = 40;
    sc.bottom = -40;
    sc.near = 20;
    sc.far = 200;
    sc.updateProjectionMatrix();
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    this.sunD.copy(this.sunOffset).normalize();
    this.sunR.crossVectors(new THREE.Vector3(0, 1, 0), this.sunD).normalize();
    this.sunU.crossVectors(this.sunD, this.sunR).normalize();
    this.shadowTexel = (sc.right - sc.left) / sun.shadow.mapSize.x;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;

    // Two shadow-free floodlight spots from the north corner towers (fixed light count -> no recompiles).
    for (const sx of [-1, 1]) {
      const c = ARENA.maxX + TOWER_OFF;
      const spot = new THREE.SpotLight(0xffffff, 0, 0, Math.PI / 4.2, 0.65, 2);
      spot.position.set(sx * c, 16.5, ARENA.minZ - TOWER_OFF);
      spot.target.position.set(-sx * 6, 0, 6);
      spot.castShadow = false;
      scene.add(spot);
      scene.add(spot.target);
      this.spots.push(spot);
    }

    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color() },
        bottom: { value: new THREE.Color() },
        horizon: { value: new THREE.Color() },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 bottom; uniform vec3 horizon;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 c = mix(horizon, bottom, smoothstep(-0.02, 0.12, h));
          c = mix(c, top, smoothstep(0.08, 0.75, h));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);
  }

  /* ------------------------------------------------------------------ zone */

  setZone(zone: ZoneDef): void {
    this.zone = zone;
    this.style = STYLES[zone.theme] ?? STYLES.meadow;
    const scene = this.ctx.scene;
    this.fog.color.setHex(zone.fogColor);
    this.fog.near = zone.fogNear;
    this.fog.far = zone.fogFar;
    (scene.background as THREE.Color).setHex(zone.fogColor);

    this.skyMat.uniforms.top.value.setHex(zone.skyTop);
    this.skyMat.uniforms.bottom.value.setHex(zone.skyBottom);
    this.skyMat.uniforms.horizon.value.setHex(zone.fogColor);

    this.hemi.color.setHex(zone.ambientColor);
    this.hemi.groundColor.setHex(zone.snowTint).lerp(new THREE.Color(zone.ambientColor), 0.3);
    this.hemi.intensity = zone.ambientIntensity;
    this.sun.color.setHex(zone.sunColor);
    this.sun.intensity = zone.sunIntensity;
    const brawl = zone.theme === 'brawl';
    // Brawl trades shadow sharpness for frame rate: half-resolution shadow map.
    const mapSize = brawl ? 1024 : 2048;
    if (this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      const sc = this.sun.shadow.camera;
      this.shadowTexel = (sc.right - sc.left) / mapSize;
    }
    for (let i = 0; i < this.spots.length; i++) {
      const s = this.spots[i];
      const sx = i === 0 ? -1 : 1;
      s.color.setHex(this.style.lamp);
      s.intensity = this.style.spot;
      if (brawl) {
        const c = ARENA.maxX + DOME_TOWER_OFF;
        s.position.set(sx * c, DOME_TOWER_H, ARENA.minZ - DOME_TOWER_OFF);
        s.target.position.set(-sx * 20, 0, 20);
        s.angle = Math.PI / 4.5;
      } else {
        const c = ARENA.maxX + TOWER_OFF;
        s.position.set(sx * c, 16.5, ARENA.minZ - TOWER_OFF);
        s.target.position.set(-sx * 6, 0, 6);
        s.angle = Math.PI / 4.2;
      }
    }

    this.buildDecor(zone);
    this.buildSnowfall(zone);
  }

  openGate(index: number): void {
    const g = this.gates[index];
    if (!g) return;
    const wasClosed = g.open < 0.35;
    g.openT = 2.0;
    g.flashT = 1.3;
    if (wasClosed || this.time - g.lastBurst > 0.8) {
      g.lastBurst = this.time;
      const fx = this.ctx.fx;
      if (fx) {
        fx.burst(this.tmpV.copy(g.mouth), { color: 0xffffff, count: 30, speed: 6, size: 0.35, gravity: 9, life: 0.9 });
        this.tmpV2.copy(g.mouth);
        this.tmpV2.y += 3;
        fx.burst(this.tmpV2, { color: this.style.gate, count: 12, speed: 4, size: 0.16, gravity: 4, life: 0.6 });
      }
    }
  }

  private disposeDecor(): void {
    if (!this.decor) return;
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    this.decor.traverse((o) => {
      const m = o as THREE.Mesh;
      // Sprites share one module-level geometry inside three.js: never dispose it.
      if (m.geometry && !(o as THREE.Sprite).isSprite) geos.add(m.geometry);
      // Shadow proxies share global stand-in materials (render/shadowProxy.ts): only their geometry is ours.
      if ((o as ShadowProxy).isShadowProxy) return;
      if (m.material) {
        if (Array.isArray(m.material)) m.material.forEach((x) => mats.add(x));
        else mats.add(m.material);
      }
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
    this.zoneTex.forEach((t) => t.dispose());
    this.zoneTex.length = 0;
    this.ctx.scene.remove(this.decor);
    this.decor = null;
    this.pulses.length = 0;
    this.gates.length = 0;
    this.doors = null;
    this.spinners.length = 0;
    this.puffs = null;
    this.ticker = null;
  }

  /* ------------------------------------------------------------------ helpers */

  private add<T extends THREE.Object3D>(o: T): T {
    this.decor!.add(o);
    return o;
  }

  /** Placement matrix of an Item (shared by inst() and baked items). */
  private itemMatrix(it: Item): THREE.Matrix4 {
    const d = this.dummy;
    d.position.set(it.x, it.y, it.z);
    // 'YXZ': roll/pitch first, yaw last (so lying tires / pipes keep their tilt under any yaw)
    d.rotation.set(it.rx ?? 0, it.ry, it.rz ?? 0, 'YXZ');
    d.scale.set(it.sx, it.sy, it.sz);
    d.updateMatrix();
    return d.matrix;
  }

  /** Bake a static part (world-space matrix) into the zone batch. Casting parts go into the zone shadow proxy
   *  instead (finishDecor), so the batch only splits on material + receiveShadow. */
  private bake(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, mat: THREE.Material, cast = false, receive = false): void {
    this.batch!.add(geo, matrix, mat, { receiveShadow: receive });
    if (cast) {
      const m = new THREE.Mesh(geo, mat);
      m.matrixAutoUpdate = false;
      m.matrix.copy(matrix);
      m.castShadow = true;
      this.casters.add(m);
    }
  }

  /** Bake one copy of `geo` per item into the zone batch (static, few items, no per-item colour). */
  private bakeItems(geo: THREE.BufferGeometry, mat: THREE.Material, items: Item[], cast = false, receive = false): void {
    for (const it of items) this.bake(geo, this.itemMatrix(it), mat, cast, receive);
    geo.dispose();
  }

  private inst(geo: THREE.BufferGeometry, mat: THREE.Material, items: Item[], cast = false, receive = false): THREE.InstancedMesh | null {
    if (items.length === 0) {
      geo.dispose();
      return null;
    }
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    const col = new THREE.Color();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      im.setMatrixAt(i, this.itemMatrix(it));
      if (it.color !== undefined) im.setColorAt(i, col.setHex(it.color));
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = cast;
    im.receiveShadow = receive;
    im.computeBoundingSphere();
    this.add(im);
    return im;
  }

  private std(color: number, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...opts });
  }

  private emissive(color: number, intensity: number, pulse?: { speed: number; phase?: number }): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
    if (pulse) this.pulses.push({ mat: m, base: intensity, speed: pulse.speed, phase: pulse.phase ?? 0 });
    return m;
  }

  private glowSprite(color: number, opacity: number, scale: number, x: number, y: number, z: number, pulse?: number): THREE.Sprite {
    const mat = new THREE.SpriteMaterial({
      map: getGlowTex(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    s.scale.setScalar(scale);
    s.position.set(x, y, z);
    if (pulse) this.pulses.push({ mat, base: opacity, speed: pulse, phase: this.rnd() * 6 });
    return this.add(s);
  }

  /** Makes a material bob its vertices up and down per instance (crowds), driven by the shared bobTime uniform. */
  private bobify<T extends THREE.Material>(mat: T): T {
    const u = this.bobTime;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uBobTime = u;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uBobTime;\nattribute float aPhase;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\ntransformed.y += abs(sin(uBobTime * (3.2 + fract(aPhase) * 2.6) + aPhase)) * 0.2;',
        );
    };
    mat.customProgramCacheKey = () => 'crowd-bob';
    return mat;
  }

  /** Tiny blocky bot spectators that bob in their seats. Items face local +Z. Every call of a zone build adds to
   *  one crowd (body + eyes draw), emitted by flushCrowd; the bob phases are drawn here, in build order. */
  private addCrowd(items: Item[]): void {
    if (items.length === 0) return;
    const phase = new Float32Array(items.length);
    for (let i = 0; i < phase.length; i++) phase[i] = this.rnd() * 40;
    if (!this.crowd) {
      const bodyMat = this.bobify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true }));
      const eyeMat = this.bobify(new THREE.MeshBasicMaterial({ color: this.style.accents[1], toneMapped: false }));
      this.crowd = { items: [], phases: [], bodyMat, eyeMat };
    }
    this.crowd.items.push(...items);
    this.crowd.phases.push(phase);
  }

  private flushCrowd(): void {
    const crowd = this.crowd;
    this.crowd = null;
    if (!crowd) return;
    const { items, bodyMat, eyeMat } = crowd;
    const white = 0xffffff;
    const body = merge([
      colored(new THREE.BoxGeometry(0.46, 0.4, 0.36).translate(0, 0.22, 0), white),
      colored(new THREE.BoxGeometry(0.4, 0.32, 0.34).translate(0, 0.6, 0), white),
      colored(new THREE.BoxGeometry(0.34, 0.13, 0.02).translate(0, 0.62, 0.175), 0x1a1f2b),
      colored(new THREE.BoxGeometry(0.04, 0.16, 0.04).translate(0, 0.84, 0), 0x50555e),
      colored(new THREE.BoxGeometry(0.1, 0.1, 0.1).translate(0, 0.95, 0), white),
      colored(new THREE.BoxGeometry(0.09, 0.32, 0.09).rotateZ(0.4).translate(0.31, 0.56, 0), white),
      colored(new THREE.BoxGeometry(0.09, 0.32, 0.09).rotateZ(-0.4).translate(-0.31, 0.56, 0), white),
    ]);
    const eyes = merge([
      new THREE.BoxGeometry(0.08, 0.06, 0.02).translate(0.08, 0.625, 0.19),
      new THREE.BoxGeometry(0.08, 0.06, 0.02).translate(-0.08, 0.625, 0.19),
    ]);
    const phase = new Float32Array(items.length);
    let o = 0;
    for (const p of crowd.phases) {
      phase.set(p, o);
      o += p.length;
    }
    const attr = new THREE.InstancedBufferAttribute(phase, 1);
    body.setAttribute('aPhase', attr);
    eyes.setAttribute('aPhase', attr);
    this.inst(body, bodyMat, items);
    this.inst(eyes, eyeMat, items.map((i) => ({ ...i, color: undefined })));
  }

  private crowdColor(): number {
    const pal = this.style.accents;
    const r = this.rnd();
    if (r < 0.55) return pal[(this.rnd() * pal.length) | 0];
    const greys = [0x9aa4b0, 0x6a7380, 0xd8dde3, 0x3a4250];
    return greys[(this.rnd() * greys.length) | 0];
  }

  /* ------------------------------------------------------------------ build */

  private buildDecor(zone: ZoneDef): void {
    this.disposeDecor();
    const group = new THREE.Group();
    group.name = 'ArenaDecor';
    this.decor = group;
    this.ctx.scene.add(group);
    this.rnd = mulberry32(1234 + zone.index * 101);
    this.batch = new StaticBatch();
    const G = zone.snowDepth;
    const snowMat = this.std(zone.snowTint, { roughness: 0.85 });
    brawlMode = zone.theme === 'brawl';
    this.obstacleList = [];

    if (brawlMode) {
      this.buildWalls(G, snowMat);
      this.buildSnowdome(zone, G);
      this.buildObstacles(G, snowMat);
      this.buildMountains(zone);
      this.finishDecor();
      return;
    }

    this.buildWalls(G, snowMat);
    this.buildGates(G, snowMat);
    this.buildStands(G);
    this.buildTowers();
    this.buildJumbotron(zone);
    this.buildSouthDressing(G);
    this.buildMountains(zone);
    this.buildDrifts(G, snowMat);

    const theme = zone.theme;
    if (theme === 'meadow') this.buildYard(G);
    else if (theme === 'pines') this.buildJunkyard(G);
    else if (theme === 'lake') this.buildFoundry(G);
    else if (theme === 'blizzard') this.buildBowl(zone);
    else this.buildSummit(G, snowMat);
    this.finishDecor();
  }

  /** Emits the batched parts, then one depth-only shadow proxy for every static caster of the zone (the visible
   *  meshes stop casting but keep receiving), so the shadow pass draws the whole static scenery in one call. Gate
   *  doors (roll up) and spinners keep casting themselves. Finally freezes the local matrices of everything that
   *  never moves (only spinners rotate; doors and puffs animate instance matrices). */
  private finishDecor(): void {
    const decor = this.decor!;
    this.flushCrowd();
    this.batch!.flush(decor);
    this.batch = null;
    const keep: THREE.Object3D[] = this.spinners.map((s) => s.obj);
    if (this.doors) keep.push(this.doors);
    for (const p of makeShadowProxy([decor, this.casters], null, { keep })) decor.add(p);
    this.casters.clear();
    const moving = new Set(this.spinners.map((sp) => sp.obj));
    decor.traverse((o) => {
      if (moving.has(o)) return;
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    });
  }

  /** Scatter points outside the arena + stands. `huge` items (>18 m) stay clear of the menu orbit (r=50, y=24). */
  private scatter(count: number, minR: number, maxR: number, huge = false): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    const rnd = this.rnd;
    let tries = 0;
    while (out.length < count && tries < count * 40) {
      tries++;
      const x = (rnd() * 2 - 1) * maxR;
      const z = (rnd() * 2 - 1) * maxR;
      const r = Math.hypot(x, z);
      if (r > maxR || r < minR) continue;
      if (Math.abs(x) < 47 && Math.abs(z) < 47) continue;
      if (Math.abs(x) < 16 && z < -38 && z > -64) continue; // jumbotron
      if (huge && r < 66) continue;
      out.push({ x, z });
    }
    return out;
  }

  /* ---------- walls ---------- */

  private buildWalls(G: number, snowMat: THREE.Material): void {
    const st = this.style;
    const rnd = this.rnd;
    const blocks: Item[] = [];
    const caps: Item[] = [];
    const bands: Item[] = [];
    const posts: Item[] = [];
    const lamps: Item[] = [];
    const banners: Item[] = [];
    const tires: Item[] = [];
    const blockCol = new THREE.Color();
    const cA = new THREE.Color(st.block);
    const cB = new THREE.Color(st.blockAlt);

    for (const side of SIDES) {
      const runs = subtract(side.s0, side.s1, gapsFor(side.key, GATE_HALF + PILLAR_W));
      const h = side.h;
      let bi = 0;
      for (const [a, b] of runs) {
        const len = b - a;
        const n = Math.max(1, Math.round(len / 2.9));
        const L = len / n;
        for (let k = 0; k < n; k++, bi++) {
          const sc = a + (k + 0.5) * L;
          const [x, z] = side.map(sc, WALL_IN + WALL_T / 2);
          const bh = h * (0.97 + rnd() * 0.06);
          blockCol.copy(cA).lerp(cB, rnd());
          blocks.push({ x, y: 0, z, ry: side.yaw + (rnd() - 0.5) * 0.025, sx: L - 0.14, sy: bh, sz: WALL_T * (0.96 + rnd() * 0.05), color: blockCol.getHex() });
          caps.push({ x, y: bh - 0.06, z, ry: side.yaw, sx: (L - 0.14) * 0.5, sy: 0.2 + rnd() * 0.1, sz: WALL_T * 0.52 });
          const [bx, bz] = side.map(sc, WALL_IN - 0.035);
          bands.push({ x: bx, y: h - 0.62, z: bz, ry: side.yaw, sx: L - 0.1, sy: 1, sz: 1 });
          if (side.key !== 's' && bi % 2 === 1) {
            const [fx, fz] = side.map(sc, WALL_IN - 0.09);
            banners.push({ x: fx, y: h - 1.22, z: fz, ry: side.yaw, sx: 1, sy: 1, sz: 1, color: st.accents[(bi >> 1) % st.accents.length] });
          }
          if (rnd() < 0.3) {
            const [tx, tz] = side.map(sc + (rnd() - 0.5) * 1.2, WALL_C + 0.8);
            const nT = 2 + ((rnd() * 3) | 0);
            for (let j = 0; j < nT; j++) {
              tires.push({ x: tx + (rnd() - 0.5) * 0.08, y: G - 0.15 + j * 0.36, z: tz, ry: rnd() * 6, rx: Math.PI / 2, sx: 1, sy: 1, sz: 1 });
            }
          }
          if (k > 0) {
            const [px, pz] = side.map(a + k * L, WALL_IN + 0.22);
            posts.push({ x: px, y: 0, z: pz, ry: side.yaw, sx: 1, sy: h + 0.3, sz: 1 });
            lamps.push({ x: px, y: h + 0.3, z: pz, ry: side.yaw, sx: 1, sy: 1, sz: 1 });
          }
        }
      }
    }
    // corner pillars
    const corners: [number, number][] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) corners.push([sx * (ARENA.maxX + WALL_C / 2), sz * (ARENA.maxZ + WALL_C / 2)]);
    const cornerItems: Item[] = corners.map(([x, z]) => ({ x, y: 0, z, ry: 0, sx: WALL_C, sy: (brawlMode ? BRAWL_WALL_H : z > 0 ? SOUTH_H : WALL_H) + 0.7, sz: WALL_C }));

    const unitBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.inst(unitBox(), this.std(0xffffff, { roughness: 0.55, metalness: 0.02 }), blocks, true, true);
    // block caps + corner caps: same hemisphere, material and flags -> one draw
    const cornerCaps = cornerItems.map((c) => ({ ...c, y: c.sy - 0.05, sx: WALL_C * 0.55, sy: 0.4, sz: WALL_C * 0.55 }));
    this.inst(new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), snowMat, [...caps, ...cornerCaps]);
    const hazardMat = this.std(0xffffff, { map: getHazardTex(), roughness: 0.6, flatShading: false });
    this.inst(new THREE.BoxGeometry(1, 0.38, 0.07).translate(0, 0.19, 0), hazardMat, bands);
    const trimMat = this.std(st.trim, { metalness: 0.55, roughness: 0.45 });
    this.inst(new THREE.BoxGeometry(0.36, 1, 0.4).translate(0, 0.5, 0), trimMat, posts, true);
    this.inst(unitBox(), this.std(st.trim, { metalness: 0.4, roughness: 0.5 }), cornerItems, true, true);
    this.inst(new THREE.BoxGeometry(0.26, 0.16, 0.26).translate(0, 0.08, 0), this.emissive(st.gate, 1.2, { speed: 2.6 }), lamps);
    const bannerMat = new THREE.MeshStandardMaterial({ map: getBannerTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75 });
    this.inst(new THREE.PlaneGeometry(1.0, 1.3), bannerMat, banners);
    // Campaign: the tire stacks behind the south wall share this draw (buildSouthDressing emits it).
    this.wallTires = { items: tires, mat: this.std(st.tire, { roughness: 0.95 }) };
    if (brawlMode) this.emitTires([]);
  }

  private emitTires(more: Item[]): void {
    const t = this.wallTires!;
    this.wallTires = null;
    this.inst(new THREE.TorusGeometry(0.42, 0.19, 7, 14), t.mat, [...t.items, ...more], true);
  }

  /* ---------- gates ---------- */

  /** The three enemy gates. Static parts are baked into the zone batch (one draw per material + flags for all
   *  gates; the materials are shared by the gates and created in the same order as before, so draw order stays the
   *  same), each gate keeps its own animated light / portal / ramp / glow materials, and the roll-up doors are one
   *  InstancedMesh. */
  private buildGates(G: number, snowMat: THREE.Material): void {
    const shared: GateMats = {};
    for (let i = 0; i < ENEMY_GATES.length; i++) this.buildGate(i, G, snowMat, shared);
    const doorGeo = new THREE.BoxGeometry(GATE_WIDTH - 0.05, 3.5, 0.18).translate(0, -1.75, 0);
    const doors = new THREE.InstancedMesh(doorGeo, shared.door!, this.gates.length);
    for (let i = 0; i < this.gates.length; i++) doors.setMatrixAt(i, this.gates[i].doorBase);
    doors.castShadow = true;
    doors.receiveShadow = true;
    // Bounds at full size (closed doors); opening only shrinks them.
    doors.computeBoundingSphere();
    this.doors = doors;
    this.add(doors);
  }

  private buildGate(index: number, G: number, snowMat: THREE.Material, shared: GateMats): void {
    const st = this.style;
    const gp = ENEMY_GATES[index];
    const ex = Math.min(ARENA.maxX, Math.max(ARENA.minX, gp.x));
    const ez = Math.min(ARENA.maxZ, Math.max(ARENA.minZ, gp.z));
    const grp = new THREE.Group();
    grp.position.set(ex, 0, ez);
    grp.rotation.y = gp.heading;
    this.add(grp);
    grp.updateMatrix();

    const zc = -(WALL_IN + WALL_T / 2);
    const px = GATE_HALF + PILLAR_W / 2;
    const trim = (shared.trim ??= this.std(st.trim, { metalness: 0.55, roughness: 0.45 }));
    const lightMat = new THREE.MeshStandardMaterial({ color: st.gate, emissive: st.gate, emissiveIntensity: 1, roughness: 0.3 });
    const hazard = (shared.hazard ??= this.std(0xffffff, { map: getHazardTex(), roughness: 0.6, flatShading: false }));
    const lights = new StaticBatch();
    const part = new THREE.Object3D();
    // A static part at (x, y, z) in gate space: lightMat parts go into this gate's light batch, everything else into
    // the zone batch (in world space; casting parts also receive).
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true, scale?: THREE.Vector3) => {
      part.position.set(x, y, z);
      if (scale) part.scale.copy(scale);
      else part.scale.set(1, 1, 1);
      part.updateMatrix();
      if (mat === lightMat) lights.add(geo, part.matrix, mat);
      else this.bake(geo, part.matrix.premultiply(grp.matrix), mat, cast, cast);
    };
    // Pillars and header share coplanar faces (z-fight): they stay real meshes so their depth is computed exactly
    // as before.
    const solid = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      grp.add(m);
    };

    // frame
    const pillarGeo = new THREE.BoxGeometry(PILLAR_W, 4.6, WALL_T);
    const plateGeo = new THREE.BoxGeometry(PILLAR_W * 0.8, 3.0, 0.06);
    for (const s of [-1, 1]) {
      solid(pillarGeo, trim, s * px, 2.3, zc);
      mesh(plateGeo, hazard, s * px, 2.0, -WALL_IN + 0.03, false);
      mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.3, 10), trim, s * px, 4.75, zc, false);
      mesh(new THREE.SphereGeometry(0.28, 12, 8), lightMat, s * px, 5.1, zc, false);
    }
    solid(new THREE.BoxGeometry(GATE_WIDTH + PILLAR_W * 2, 1.0, WALL_T), hazard, 0, 4.1, zc);
    mesh(new THREE.BoxGeometry(GATE_WIDTH - 0.4, 0.16, 0.08), lightMat, 0, 3.48, -WALL_IN + 0.04, false);

    // roll-up garage door (pivot at its top edge so scale.y rolls it up into the header): one instance per gate
    shared.door ??= new THREE.MeshStandardMaterial({ map: getDoorTex(), color: new THREE.Color(st.trim).lerp(new THREE.Color(0xffffff), 0.65), roughness: 0.5, metalness: 0.35 });
    part.position.set(0, 3.6, zc);
    part.scale.set(1, 1, 1);
    part.updateMatrix();
    const doorBase = part.matrix.clone().premultiply(grp.matrix);

    // spawn tunnel outside the wall
    const tunnelMat = (shared.tunnel ??= this.std(st.blockAlt, { roughness: 0.6 }));
    const tz = -(WALL_C + TUNNEL_LEN / 2);
    const capScale = new THREE.Vector3(0.6, 0.35, TUNNEL_LEN * 0.5);
    for (const s of [-1, 1]) {
      mesh(new THREE.BoxGeometry(0.9, 3.9, TUNNEL_LEN), tunnelMat, s * (GATE_HALF + 0.45), 1.95, tz);
      mesh(new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), snowMat, s * (GATE_HALF + 0.45), 3.85, tz, false, capScale);
      for (const y of [0.95, 3.3]) mesh(new THREE.BoxGeometry(0.06, 0.12, TUNNEL_LEN - 0.4), lightMat, s * (GATE_HALF - 0.02), y, tz, false);
    }
    mesh(new THREE.BoxGeometry(GATE_WIDTH + 1.8, 0.45, TUNNEL_LEN - 1.2), trim, 0, 4.12, tz - 0.6);
    mesh(new THREE.BoxGeometry(GATE_WIDTH + 1.4, 0.22, TUNNEL_LEN - 1.6), snowMat, 0, 4.42, tz - 0.6, false);
    const backZ = -(WALL_C + TUNNEL_LEN - 0.25);
    mesh(new THREE.PlaneGeometry(GATE_WIDTH, 3.9), (shared.back ??= new THREE.MeshBasicMaterial({ color: 0x05070f })), 0, 1.95, backZ, false);
    lights.flush(grp);
    const portalMat = new THREE.MeshBasicMaterial({
      map: getGlowTex(), color: st.gate, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.pulses.push({ mat: portalMat, base: 0.7, speed: 1.8, phase: index });
    const portal = new THREE.Mesh(new THREE.PlaneGeometry(GATE_WIDTH * 1.2, 4.6), portalMat);
    portal.position.set(0, 1.8, backZ + 0.08);
    grp.add(portal);
    // glowing chevron ramp pointing into the arena
    const floorMat = new THREE.MeshBasicMaterial({
      map: getChevronTex(), color: st.gate, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ramp = new THREE.Mesh(new THREE.PlaneGeometry(GATE_WIDTH - 1.4, TUNNEL_LEN - 1).rotateX(-Math.PI / 2), floorMat);
    ramp.position.set(0, G + 0.1, -(WALL_C + (TUNNEL_LEN - 1) / 2 - 0.2));
    ramp.renderOrder = 2;
    grp.add(ramp);

    // beacon glows (sprites live in the gate group)
    const glowMat = new THREE.SpriteMaterial({
      map: getGlowTex(), color: st.gate, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (const s of [-1, 1]) {
      const sp = new THREE.Sprite(glowMat);
      sp.scale.setScalar(2.6);
      sp.position.set(s * px, 5.1, zc);
      grp.add(sp);
    }

    grp.updateMatrixWorld(true);
    const mouth = grp.localToWorld(new THREE.Vector3(0, G + 0.3, 0.8));
    this.gates.push({ group: grp, doorBase, doorScale: 1, lightMat, glowMat, floorMat, mouth, open: 0, openT: 0, flashT: 0, lastBurst: -10, phase: index * 1.7 });
  }

  /* ---------- spectator stands ---------- */

  private buildStands(G: number): void {
    const st = this.style;
    const rnd = this.rnd;
    const tiers: Item[] = [];
    const seats: Item[] = [];
    const backs: Item[] = [];
    const boards: Item[] = [];
    const poles: Item[] = [];
    const flags: Item[] = [];
    const crowd: Item[] = [];
    let section = 0;
    for (const side of SIDES) {
      if (side.key === 's') continue;
      const range = side.key === 'n' ? [ARENA.minX - 1, ARENA.maxX + 1] : [ARENA.minZ - 1, ARENA.maxZ + 1];
      const runs = subtract(range[0], range[1], gapsFor(side.key, GATE_HALF + 2.2));
      for (const [a, b] of runs) {
        const len = b - a;
        const sc = (a + b) / 2;
        const accent = st.accents[section++ % st.accents.length];
        for (let k = 0; k < ROWS; k++) {
          const top = G + 0.25 + (k + 1) * ROW_RISE;
          const depth = (ROWS - k) * ROW_D;
          const [x, z] = side.map(sc, STAND_N0 + k * ROW_D + depth / 2);
          tiers.push({ x, y: 0, z, ry: side.yaw, sx: len, sy: top, sz: depth, color: k % 2 ? st.stand : st.standAlt });
          const [sx, sz] = side.map(sc, STAND_N0 + k * ROW_D + 0.3);
          seats.push({ x: sx, y: top, z: sz, ry: side.yaw, sx: len, sy: 1, sz: 1, color: accent });
          for (let s = a + 0.5; s < b - 0.4; s += 0.85) {
            if (rnd() > 0.74) continue;
            const [cx, cz] = side.map(s + (rnd() - 0.5) * 0.2, STAND_N0 + k * ROW_D + 0.72);
            const sc2 = 0.85 + rnd() * 0.25;
            crowd.push({ x: cx, y: top, z: cz, ry: side.yaw + (rnd() - 0.5) * 0.5, sx: sc2, sy: sc2, sz: sc2, color: this.crowdColor() });
          }
        }
        const topH = G + 0.25 + ROWS * ROW_RISE;
        const [bx, bz] = side.map(sc, STAND_N0 + ROWS * ROW_D + 0.15);
        backs.push({ x: bx, y: 0, z: bz, ry: side.yaw, sx: len, sy: topH + 1.3, sz: 0.3 });
        const [fx, fz] = side.map(sc, STAND_N0 - 0.1);
        boards.push({ x: fx, y: 0, z: fz, ry: side.yaw, sx: len, sy: G + 0.25 + ROW_RISE + 0.4, sz: 0.2, color: accent });
        for (let s = a + 1.5; s < b - 1; s += 6) {
          const [qx, qz] = side.map(s, STAND_N0 + ROWS * ROW_D + 0.15);
          poles.push({ x: qx, y: topH + 1.3, z: qz, ry: side.yaw, sx: 1, sy: 1, sz: 1 });
          flags.push({ x: qx, y: topH + 1.3 + 2.55, z: qz, ry: side.yaw + Math.PI / 2 + (rnd() - 0.5) * 0.4, sx: 1, sy: 1, sz: 1, color: st.accents[(rnd() * st.accents.length) | 0] });
        }
      }
    }
    const unitBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.inst(unitBox(), this.std(0xffffff, { roughness: 0.85 }), tiers, true, true);
    this.inst(new THREE.BoxGeometry(1, 0.1, 0.42).translate(0, 0.05, 0), this.std(0xffffff, { roughness: 0.6 }), seats);
    this.inst(unitBox(), this.std(st.trim, { metalness: 0.4, roughness: 0.55 }), backs, true);
    this.inst(unitBox(), this.std(0xffffff, { roughness: 0.5, emissive: 0x222222 }), boards, false, true);
    this.inst(new THREE.CylinderGeometry(0.05, 0.05, 3, 6).translate(0, 1.5, 0), this.std(0xcfd5dc, { metalness: 0.6, roughness: 0.4 }), poles);
    const flagShape = new THREE.Shape();
    flagShape.moveTo(0, 0);
    flagShape.lineTo(1.3, -0.3);
    flagShape.lineTo(0, -0.7);
    flagShape.closePath();
    this.inst(new THREE.ShapeGeometry(flagShape).translate(0.05, 0.4, 0), this.std(0xffffff, { side: THREE.DoubleSide, roughness: 0.7 }), flags);
    this.addCrowd(crowd);
  }

  /* ---------- floodlight towers ---------- */

  private buildTowers(off = TOWER_OFF, k = 1): void {
    const st = this.style;
    const c = ARENA.maxX + off;
    const items: Item[] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * c;
      const z = sz * (ARENA.maxZ + off);
      items.push({ x, y: 0, z, ry: Math.atan2(-x, -z), sx: k, sy: k, sz: k });
    }
    const H = 16;
    const parts: THREE.BufferGeometry[] = [];
    for (const lx of [-0.6, 0.6]) for (const lz of [-0.6, 0.6]) parts.push(new THREE.BoxGeometry(0.2, H, 0.2).translate(lx, H / 2, lz));
    for (let y = 2; y < H; y += 2.6) {
      parts.push(new THREE.BoxGeometry(1.4, 0.1, 0.1).translate(0, y, 0.6));
      parts.push(new THREE.BoxGeometry(1.4, 0.1, 0.1).translate(0, y, -0.6));
      parts.push(new THREE.BoxGeometry(0.1, 0.1, 1.4).translate(0.6, y, 0));
      parts.push(new THREE.BoxGeometry(0.1, 0.1, 1.4).translate(-0.6, y, 0));
    }
    const tilt = 0.5;
    parts.push(new THREE.BoxGeometry(5, 2.6, 0.5).rotateX(tilt).translate(0, H + 0.6, 0.5));
    parts.push(new THREE.BoxGeometry(5.4, 0.25, 1.2).translate(0, H - 0.9, 0.3));
    this.inst(merge(parts), this.std(st.trim, { metalness: 0.6, roughness: 0.4 }), items, true);
    const lamps: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      lamps.push(new THREE.BoxGeometry(0.95, 0.85, 0.12).translate(-1.65 + i * 1.1, -0.5 + j * 1.0, 0.27).rotateX(tilt).translate(0, H + 0.6, 0.5));
    }
    this.inst(merge(lamps), new THREE.MeshBasicMaterial({ color: st.lamp, toneMapped: false }), items);
    // big lens glows in front of the lamp heads
    for (const it of items) {
      const fx = Math.sin(it.ry) * 1.2 * k;
      const fz = Math.cos(it.ry) * 1.2 * k;
      this.glowSprite(st.lamp, st.glow, 10 * k, it.x + fx, (H + 0.4) * k, it.z + fz);
    }
  }

  /* ---------- jumbotron ---------- */

  private buildJumbotron(zone: ZoneDef): void {
    const st = this.style;
    const grp = new THREE.Group();
    grp.position.set(0, 0, -54);
    this.add(grp);
    const trim = this.std(st.trim, { metalness: 0.55, roughness: 0.45 });
    // legs (casting) + frame baked into one draw
    const legGeo = new THREE.BoxGeometry(1, 10.4, 1).translate(0, 5.2, 0);
    for (const x of [-8, 8]) this.bake(legGeo, this.tmpM.makeTranslation(x, 0, -54), trim, true);
    this.bake(new THREE.BoxGeometry(21, 9.6, 1.2), this.tmpM.makeTranslation(0, 15, -54), trim);

    // main screen
    const [c, g] = canvas(1024, 340);
    const bg = g.createLinearGradient(0, 0, 0, 340);
    bg.addColorStop(0, '#0b1230');
    bg.addColorStop(1, '#1b0f36');
    g.fillStyle = bg;
    g.fillRect(0, 0, 1024, 340);
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 2;
    for (let x = 0; x < 1024; x += 32) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 340);
      g.stroke();
    }
    g.strokeStyle = hexCss(st.accents[0]);
    g.lineWidth = 10;
    g.strokeRect(10, 10, 1004, 320);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 104px "Arial Black", Impact, sans-serif';
    g.fillStyle = '#ffffff';
    g.fillText('SNOWPLOW', 512, 92);
    g.fillStyle = hexCss(st.accents[0]);
    g.fillText('SHOWDOWN', 512, 192);
    g.font = 'bold 44px Arial, sans-serif';
    g.fillStyle = hexCss(st.accents[1]);
    g.fillText(zone.name.toUpperCase(), 512, 280);
    const screenTex = toTex(c);
    this.zoneTex.push(screenTex);
    const screenMat = new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false });
    this.pulses.push({ mat: screenMat, base: 1, speed: 0, phase: 0 });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(19.6, 6.5), screenMat);
    screen.position.set(0, 15.9, 0.61);
    grp.add(screen);

    // scrolling ticker
    const [tc, tg] = canvas(1024, 64);
    tg.fillStyle = '#05070f';
    tg.fillRect(0, 0, 1024, 64);
    tg.font = 'bold 38px Arial, sans-serif';
    tg.textBaseline = 'middle';
    tg.fillStyle = hexCss(st.accents[0]);
    const msg = `  ★ ${zone.name.toUpperCase()}  ★  BOSS: ${zone.bossName}  ★  RAM · SLAM · SURVIVE  `;
    tg.fillText(msg, 0, 34);
    const tickTex = toTex(tc, true);
    tickTex.wrapT = THREE.ClampToEdgeWrapping;
    this.zoneTex.push(tickTex);
    this.ticker = tickTex;
    const tick = new THREE.Mesh(new THREE.PlaneGeometry(19.6, 1.4), new THREE.MeshBasicMaterial({ map: tickTex, toneMapped: false }));
    tick.position.set(0, 11.5, 0.61);
    grp.add(tick);

    // marquee bulbs
    const bulbs: Item[] = [];
    for (let i = 0; i <= 20; i++) {
      bulbs.push({ x: -10 + i, y: 19.6, z: -54 + 0.62, ry: 0, sx: 1, sy: 1, sz: 1 });
      bulbs.push({ x: -10 + i, y: 10.4, z: -54 + 0.62, ry: 0, sx: 1, sy: 1, sz: 1 });
    }
    this.inst(new THREE.SphereGeometry(0.16, 8, 6), this.emissive(st.accents[0], 1.6, { speed: 5 }), bulbs);
  }

  /* ---------- low dressing behind the south wall (camera side) ---------- */

  private buildSouthDressing(G: number): void {
    const rnd = this.rnd;
    const st = this.style;
    const tires: Item[] = [];
    const barrels: Item[] = [];
    for (let i = 0; i < 9; i++) {
      const x = ARENA.minX - 4 + rnd() * (ARENA.maxX - ARENA.minX + 8);
      const z = ARENA.maxZ + WALL_C + 1.2 + rnd() * 6;
      const n = 1 + ((rnd() * 3) | 0);
      for (let j = 0; j < n; j++) tires.push({ x, y: G - 0.15 + j * 0.36, z, ry: rnd() * 6, rx: Math.PI / 2, sx: 1, sy: 1, sz: 1 });
    }
    for (let i = 0; i < 7; i++) {
      barrels.push({
        x: ARENA.minX + rnd() * (ARENA.maxX - ARENA.minX), y: G - 0.2, z: ARENA.maxZ + WALL_C + 1.5 + rnd() * 8, ry: rnd() * 6,
        sx: 1, sy: 1, sz: 1, color: st.accents[(rnd() * st.accents.length) | 0],
      });
    }
    this.emitTires(tires);
    this.inst(new THREE.CylinderGeometry(0.4, 0.4, 1.1, 12).translate(0, 0.55, 0), this.std(0xffffff, { roughness: 0.6, metalness: 0.3 }), barrels, true);
  }

  /* ---------- distant mountains & drifts ---------- */

  private buildMountains(zone: ZoneDef): void {
    const rnd = this.rnd;
    const theme = zone.theme;
    const fogC = new THREE.Color(zone.fogColor);
    const skyB = new THREE.Color(zone.skyBottom);
    const haze = theme === 'blizzard' ? 0.82 : 0.5;
    const mCol = new THREE.Color(this.style.mountain).lerp(fogC, haze);
    const cCol = new THREE.Color(zone.snowTint).lerp(skyB, haze * 0.6);
    // one draw: white material, rock / snow-cap colour per instance
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, fog: false });
    const mGeo = new THREE.ConeGeometry(1, 1, 6, 1).translate(0, 0.5, 0);
    const mItems: Item[] = [];
    const cItems: Item[] = [];
    const n = 34;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.12;
      const R = 230 + rnd() * 70;
      const h = (theme === 'peak' ? 80 : 45) + rnd() * (theme === 'peak' ? 90 : 60);
      const r = 35 + rnd() * 40;
      const ry = rnd() * 6.28;
      const x = Math.sin(a) * R;
      const z = Math.cos(a) * R;
      const sz = r * (0.7 + rnd() * 0.5);
      mItems.push({ x, y: -2, z, ry, sx: r, sy: h, sz });
      const k = 0.36;
      cItems.push({ x, y: -2 + h * (1 - k) - 0.3, z, ry, sx: r * k * 1.04, sy: h * k * 1.01, sz: sz * k * 1.04 });
    }
    const mm = this.inst(mGeo, mat, [...mItems, ...cItems]);
    if (mm) {
      for (let i = 0; i < mm.count; i++) mm.setColorAt(i, i < mItems.length ? mCol : cCol);
      mm.instanceColor!.needsUpdate = true;
      mm.renderOrder = -5;
    }
  }

  private buildDrifts(G: number, snowMat: THREE.Material): void {
    const rnd = this.rnd;
    const items: Item[] = this.scatter(this.zone.theme === 'blizzard' ? 60 : 36, 48, 115).map((p) => {
      const s = 1.5 + rnd() * 3;
      return { x: p.x, y: G - 0.1, z: p.z, ry: rnd() * 6.28, sx: s * 1.6, sy: s * 0.28, sz: s };
    });
    this.inst(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), snowMat, items, false, true);
  }

  /* ---------- theme: Frostbite Yard (snowy scrapyard) ---------- */

  private buildYard(G: number): void {
    const rnd = this.rnd;
    const junkCols = [0x8a4b2a, 0x5b6a7a, 0x9a3a2e, 0x3f5f8a, 0x7a7a72, 0xb08a3a, 0x4d5a3a];
    const junk: Item[] = [];
    const mounds: Item[] = [];
    const tires: Item[] = [];
    for (const p of this.scatter(18, 50, 115)) {
      const n = 8 + ((rnd() * 9) | 0);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2;
        const d = rnd() * 3.5;
        const s = 0.8 + rnd() * 1.6;
        junk.push({
          x: p.x + Math.cos(a) * d, y: G - 0.3 + rnd() * (3.6 - d) * 0.7, z: p.z + Math.sin(a) * d, ry: rnd() * 6, rx: (rnd() - 0.5) * 0.8,
          rz: (rnd() - 0.5) * 0.8, sx: s * (0.8 + rnd() * 0.8), sy: s * (0.5 + rnd() * 0.5), sz: s, color: junkCols[(rnd() * junkCols.length) | 0],
        });
      }
      mounds.push({ x: p.x, y: G - 0.4, z: p.z, ry: rnd() * 6, sx: 4.2 + rnd(), sy: 1.4 + rnd() * 0.8, sz: 4.2 + rnd() });
      for (let i = 0; i < 4; i++) tires.push({ x: p.x + (rnd() - 0.5) * 8, y: G + 0.05, z: p.z + (rnd() - 0.5) * 8, ry: 0, rx: Math.PI / 2 + (rnd() - 0.5) * 0.6, sx: 1, sy: 1, sz: 1 });
    }
    this.inst(new THREE.BoxGeometry(1, 1, 1), this.std(0xffffff, { roughness: 0.7, metalness: 0.3 }), junk);
    this.inst(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), this.std(this.zone.snowTint, { roughness: 0.85 }), mounds);
    this.inst(new THREE.TorusGeometry(0.42, 0.19, 7, 14), this.std(this.style.tire, { roughness: 0.95 }), tires);

    // shipping container stacks
    const cCols = [0xc0392b, 0x2f6fb0, 0xe0a030, 0x3c8d5a, 0x8e44ad];
    const cont: Item[] = [];
    const roofs: Item[] = [];
    const rows: [number, number, number][] = [[-74, -18, 0], [72, 8, 0], [-40, -84, Math.PI / 2], [46, -78, Math.PI / 2], [-80, 46, 0.3]];
    for (const [rx, rz, ry] of rows) {
      const n = 3 + ((rnd() * 3) | 0);
      for (let i = 0; i < n; i++) {
        const along = (i - n / 2) * 2.6;
        const hgt = 1 + ((rnd() * 3) | 0);
        for (let j = 0; j < hgt; j++) {
          const x = rx + Math.cos(ry) * along;
          const z = rz - Math.sin(ry) * along;
          cont.push({ x, y: j * 2.6, z, ry: ry + (rnd() - 0.5) * 0.06, sx: 1, sy: 1, sz: 1, color: cCols[(rnd() * cCols.length) | 0] });
          if (j === hgt - 1) roofs.push({ x, y: hgt * 2.6, z, ry, sx: 1, sy: 1, sz: 1 });
        }
      }
    }
    this.inst(new THREE.BoxGeometry(2.44, 2.6, 6.1).translate(0, 1.3, 0), this.std(0xffffff, { roughness: 0.6, metalness: 0.25 }), cont);
    this.inst(new THREE.BoxGeometry(2.5, 0.2, 6.2).translate(0, 0.1, 0), this.std(0xffffff, { roughness: 0.85 }), roofs);

    // a scrapyard crane, far north-west
    const yellow = this.std(0xf2b632, { metalness: 0.3, roughness: 0.5 });
    const crane = new THREE.Group();
    crane.position.set(-82, 0, -70);
    crane.rotation.y = 0.7;
    // tower + boom share `yellow`; cab, weight and cable differ only in colour -> one vertex-coloured draw
    const frame = new THREE.Mesh(merge([new THREE.BoxGeometry(1.6, 30, 1.6).translate(0, 15, 0), new THREE.BoxGeometry(28, 1.1, 1.1).translate(9, 30.5, 0)]), yellow);
    const dark = merge([
      colored(new THREE.BoxGeometry(2.6, 2.2, 2.4).translate(0, 28.6, 1.6), 0x30343c),
      colored(new THREE.BoxGeometry(3, 2.2, 2).translate(-5, 29.4, 0), 0x4a4f58),
      colored(new THREE.BoxGeometry(0.08, 14, 0.08).translate(19, 23.5, 0), 0x222222),
    ]);
    const parts = new THREE.Mesh(dark, this.std(0xffffff, { vertexColors: true }));
    const magnet = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.6, 14).translate(19, 16.3, 0), this.std(0x3a3f48, { metalness: 0.6 }));
    crane.add(frame, parts, magnet);
    this.add(crane);
  }

  /* ---------- theme: Pine Junkyard ---------- */

  private buildJunkyard(G: number): void {
    const rnd = this.rnd;
    // pines
    const pts = this.scatter(360, 48, 130);
    if (pts.length) {
      const seg = 7;
      const tiers = [
        { r: 1.7, h: 2.2, y: 2.0 },
        { r: 1.3, h: 1.9, y: 3.4 },
        { r: 0.9, h: 1.6, y: 4.6 },
      ];
      const fol: THREE.BufferGeometry[] = [];
      const caps: THREE.BufferGeometry[] = [];
      for (const t of tiers) {
        fol.push(new THREE.ConeGeometry(t.r, t.h, seg).translate(0, t.y, 0));
        const ch = t.h * 0.42;
        caps.push(new THREE.ConeGeometry(t.r * 0.48, ch, seg).translate(0, t.y + t.h / 2 - ch / 2 + 0.02, 0));
        caps.push(new THREE.CylinderGeometry(t.r * 0.75, t.r * 0.98, 0.18, seg).translate(0, t.y - t.h / 2 + 0.25, 0));
      }
      const items: Item[] = pts.map((p) => {
        const s = 0.8 + rnd() * 0.9 + (Math.hypot(p.x, p.z) > 80 ? 0.5 : 0);
        return { x: p.x, y: G - 0.2, z: p.z, ry: rnd() * Math.PI * 2, sx: s, sy: s * (0.9 + rnd() * 0.35), sz: s, color: FOLIAGE[(rnd() * FOLIAGE.length) | 0] };
      });
      const plain = items.map((i) => ({ ...i, color: undefined }));
      this.inst(merge(fol), this.std(0xffffff), items);
      this.inst(merge(caps), this.std(this.zone.snowTint, { roughness: 0.85 }), plain);
      this.inst(new THREE.CylinderGeometry(0.22, 0.3, 1.6, 6).translate(0, 0.8, 0), this.std(0x6b4428, { roughness: 0.9 }), plain);
    }

    // wrecked cars (vertex-colored body/glass/wheels, tinted per instance)
    const car = merge([
      colored(new THREE.BoxGeometry(1.9, 0.8, 4.2).translate(0, 0.62, 0), 0xffffff),
      colored(new THREE.BoxGeometry(1.7, 0.66, 2.2).translate(0, 1.33, -0.3), 0xffffff),
      colored(new THREE.BoxGeometry(1.74, 0.4, 2.24).translate(0, 1.36, -0.3), 0x2a3440),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => colored(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10).rotateZ(Math.PI / 2).translate(sx * 0.95, 0.38, sz * 1.35), 0x1e1e22))),
    ]);
    const rust = [0x8a4b2a, 0x6f7a3f, 0x3f5f8a, 0x9a3a2e, 0x7a6a5a, 0xb07a3a];
    const cars: Item[] = [];
    const roofSnow: Item[] = [];
    for (const p of this.scatter(36, 48, 100)) {
      const flip = rnd() < 0.15;
      const ry = rnd() * 6.28;
      cars.push({ x: p.x, y: flip ? G + 1.65 : G - 0.15, z: p.z, ry, rx: (rnd() - 0.5) * 0.2, rz: flip ? Math.PI : (rnd() - 0.5) * 0.25, sx: 1, sy: 1, sz: 1, color: rust[(rnd() * rust.length) | 0] });
      if (!flip) roofSnow.push({ x: p.x, y: G + 1.6, z: p.z, ry, sx: 1, sy: 1, sz: 1 });
      // stacked wreck
      if (rnd() < 0.25) cars.push({ x: p.x + (rnd() - 0.5), y: G + 1.55, z: p.z + (rnd() - 0.5), ry: ry + (rnd() - 0.5) * 0.8, rz: (rnd() - 0.5) * 0.2, sx: 1, sy: 1, sz: 1, color: rust[(rnd() * rust.length) | 0] });
    }
    this.inst(car, this.std(0xffffff, { vertexColors: true, roughness: 0.7, metalness: 0.2 }), cars);
    this.inst(new THREE.BoxGeometry(1.6, 0.16, 2.0).translate(0, 0.08, -0.3), this.std(this.zone.snowTint, { roughness: 0.85 }), roofSnow);

    // stumps & logs
    const wood = this.std(0x6b4428, { roughness: 0.9 });
    this.inst(
      new THREE.CylinderGeometry(0.35, 0.4, 1, 8),
      wood,
      this.scatter(20, 48, 90).map((p) => ({ x: p.x, y: G + 0.25, z: p.z, ry: rnd() * 6.28, rz: Math.PI / 2, sx: 1, sy: 1.5 + rnd() * 2, sz: 1 })),
    );

    // the plow shed where the rogue AI lives
    const shed = new THREE.Group();
    shed.position.set(-70, 0, 34);
    shed.rotation.y = Math.atan2(70, -34);
    const body = new THREE.Mesh(new THREE.BoxGeometry(16, 7, 11).translate(0, 3.5, 0), this.std(0x7a3a28, { roughness: 0.85 }));
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.6, 16.4, 3, 1, false, Math.PI / 2).rotateZ(Math.PI / 2), this.std(this.zone.snowTint, { roughness: 0.85 }));
    roof.scale.set(1, 0.5, 1);
    roof.position.y = 7 + 1.5;
    const door = new THREE.Mesh(new THREE.BoxGeometry(7, 5, 0.2).translate(0, 2.5, 5.55), new THREE.MeshStandardMaterial({ map: getDoorTex(), color: 0x9aa0a8, roughness: 0.6 }));
    const eye = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.7, 0.1).translate(0, 6, 5.56), this.emissive(0xff2a1a, 2.2, { speed: 1.4 }));
    body.castShadow = true;
    shed.add(body, roof, door, eye);
    this.add(shed);
  }

  /* ---------- theme: Frozen Foundry ---------- */

  private buildFoundry(G: number): void {
    const rnd = this.rnd;
    // ice-locked ground
    const ice = new THREE.Mesh(new THREE.RingGeometry(46, 118, 64, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9fd2ea, roughness: 0.12, metalness: 0.15 }));
    ice.position.y = G + 0.03;
    ice.receiveShadow = true;
    this.add(ice);

    // smokestacks
    const stacks: { x: number; y: number; z: number; r: number }[] = [];
    const sItems: Item[] = [];
    const bands: Item[] = [];
    const rims: Item[] = [];
    const spots: [number, number][] = [[-72, -62], [-30, -92], [34, -90], [80, -50], [-92, 6], [94, 22]];
    for (const [x, z] of spots) {
      const r = 2.2 + rnd() * 0.9;
      const h = 26 + rnd() * 12;
      sItems.push({ x, y: 0, z, ry: 0, sx: r, sy: h, sz: r });
      for (const f of [0.62, 0.8]) bands.push({ x, y: h * f, z, ry: 0, sx: r * 0.93, sy: 1.6, sz: r * 0.93 });
      rims.push({ x, y: h, z, ry: 0, rx: Math.PI / 2, sx: r * 0.86, sy: r * 0.86, sz: 1 });
      stacks.push({ x, y: h, z, r });
    }
    this.inst(new THREE.CylinderGeometry(0.85, 1, 1, 14).translate(0, 0.5, 0), this.std(0x5a4a44, { roughness: 0.9 }), sItems);
    this.inst(new THREE.CylinderGeometry(1, 1, 1, 14), this.std(0xe8f4fb, { roughness: 0.4 }), bands);
    this.inst(new THREE.TorusGeometry(1, 0.14, 6, 18), this.emissive(0xff7a2a, 2.2, { speed: 1.7 }), rims);
    // smoke / steam puffs (animated in update)
    const per = 7;
    const puffMat = new THREE.MeshLambertMaterial({ color: 0xe6edf2, transparent: true, opacity: 0.5, depthWrite: false });
    const puffMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), puffMat, stacks.length * per);
    puffMesh.frustumCulled = false;
    this.add(puffMesh);
    this.puffs = { mesh: puffMesh, stacks, per };

    // frozen furnaces: iron blocks with glowing mouths, sealed in ice
    const furn: [number, number][] = [[-60, 28], [62, -26], [-54, -60], [60, 48], [0, -78]];
    const iron = this.std(0x3a3436, { roughness: 0.7, metalness: 0.4 });
    const mouthMat = this.emissive(0xff6a1a, 2.4, { speed: 2.1 });
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xbfefff, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.38, depthWrite: false });
    const icicles: Item[] = [];
    for (const [x, z] of furn) {
      if (Math.abs(x) < 16 && z < -38 && z > -64) continue;
      const f = new THREE.Group();
      f.position.set(x, 0, z);
      f.rotation.y = Math.atan2(-x, -z);
      const w = 8 + rnd() * 3;
      const h = 7 + rnd() * 3;
      // body + chimney (iron) and mouth are baked into the zone batch (one draw each for all furnaces)
      f.updateMatrix();
      this.bake(new THREE.BoxGeometry(w, h, w).translate(0, h / 2, 0), f.matrix, iron);
      this.bake(new THREE.CylinderGeometry(1, 1.2, 6, 10).translate(w * 0.25, h + 3, -w * 0.2), f.matrix, iron);
      this.bake(new THREE.BoxGeometry(w * 0.45, h * 0.35, 0.1).translate(0, h * 0.3, w / 2 + 0.06), f.matrix, mouthMat);
      const shell = new THREE.Mesh(new THREE.BoxGeometry(w + 1.2, h + 1.0, w + 1.2).translate(0, (h + 1) / 2, 0), shellMat);
      shell.renderOrder = 3;
      f.add(shell);
      this.add(f);
      this.glowSprite(0xff7a2a, 0.5, w * 0.9, x + Math.sin(f.rotation.y) * (w / 2 + 1.2), h * 0.3, z + Math.cos(f.rotation.y) * (w / 2 + 1.2), 2.1);
      for (let k = 0; k < 10; k++) {
        const t = rnd() * 2 - 1;
        const side = (rnd() * 4) | 0;
        const half = (w + 1.2) / 2;
        const lx = side < 2 ? t * half : (side === 2 ? -half : half);
        const lz = side < 2 ? (side === 0 ? -half : half) : t * half;
        const ry = f.rotation.y;
        icicles.push({
          x: x + Math.cos(ry) * lx + Math.sin(ry) * lz, y: h + 1, z: z - Math.sin(ry) * lx + Math.cos(ry) * lz,
          ry: 0, rx: Math.PI, sx: 0.25 + rnd() * 0.2, sy: 1 + rnd() * 1.6, sz: 0.25 + rnd() * 0.2,
        });
      }
    }
    this.inst(new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xd8f6ff, roughness: 0.15, transparent: true, opacity: 0.85 }), icicles);

    // frosted pipes on supports
    const pipes: Item[] = [];
    const supports: Item[] = [];
    const runs: [number, number, number, number][] = [[-60, 28, -92, 6], [62, -26, 80, -50], [-54, -60, -72, -62], [60, 48, 94, 22]];
    for (const [ax, az, bx, bz] of runs) {
      const len = Math.hypot(bx - ax, bz - az);
      const ry = Math.atan2(bx - ax, bz - az);
      pipes.push({ x: (ax + bx) / 2, y: 4.2, z: (az + bz) / 2, ry, rx: Math.PI / 2, sx: 1, sy: len, sz: 1 });
      for (let t = 0.15; t < 0.9; t += 0.25) supports.push({ x: ax + (bx - ax) * t, y: 0, z: az + (bz - az) * t, ry, sx: 1, sy: 1, sz: 1 });
    }
    this.inst(new THREE.CylinderGeometry(0.6, 0.6, 1, 10), this.std(0x9fb8c8, { roughness: 0.5, metalness: 0.5 }), pipes);
    this.bakeItems(new THREE.BoxGeometry(0.4, 4.2, 0.4).translate(0, 2.1, 0), iron, supports);

    // ice crystals
    const crystals: Item[] = [];
    for (const p of this.scatter(16, 48, 95)) {
      const n = 2 + ((rnd() * 4) | 0);
      for (let k = 0; k < n; k++) {
        const s = 0.4 + rnd() * 0.7;
        crystals.push({ x: p.x + (rnd() - 0.5) * 2, y: G + s, z: p.z + (rnd() - 0.5) * 2, ry: rnd() * 6, rx: (rnd() - 0.5) * 0.7, rz: (rnd() - 0.5) * 0.7, sx: s, sy: s * (2 + rnd() * 1.5), sz: s });
      }
    }
    this.inst(new THREE.OctahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xbfefff, emissive: 0x6ff3ff, emissiveIntensity: 0.3, roughness: 0.1, flatShading: true, transparent: true, opacity: 0.85 }), crystals);
  }

  /* ---------- theme: Blizzard Bowl (whiteout stadium) ---------- */

  private buildBowl(zone: ZoneDef): void {
    const rnd = this.rnd;
    const steps = 12;
    const R0 = 58;
    const pts: THREE.Vector2[] = [new THREE.Vector2(R0 - 1, -1), new THREE.Vector2(R0 - 1, 3.2)];
    for (let i = 0; i < steps; i++) {
      const r = R0 + i * 2;
      const y = 3.2 + i * 1.5;
      pts.push(new THREE.Vector2(r, y), new THREE.Vector2(r, y + 1.5));
    }
    const rTop = R0 + steps * 2;
    const yTop = 3.2 + steps * 1.5;
    pts.push(new THREE.Vector2(rTop, yTop), new THREE.Vector2(rTop, yTop + 2.5), new THREE.Vector2(rTop + 2, yTop + 2.5), new THREE.Vector2(rTop + 2, -1));
    const fogC = new THREE.Color(zone.fogColor);
    const bowl = new THREE.Mesh(
      new THREE.LatheGeometry(pts, 72),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(0x6f7b8a).lerp(fogC, 0.1), roughness: 0.9, flatShading: true, side: THREE.DoubleSide }),
    );
    this.add(bowl);
    // distant crowd on the bowl tiers
    const crowd: Item[] = [];
    for (let i = 0; i < 1000; i++) {
      const tier = (rnd() * steps) | 0;
      const a = rnd() * Math.PI * 2;
      const r = R0 + tier * 2 + 0.6 + rnd() * 0.8;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      const s = 1.1 + rnd() * 0.3;
      crowd.push({ x, y: 3.2 + (tier + 1) * 1.5, z, ry: Math.atan2(-x, -z), sx: s, sy: s, sz: s, color: this.crowdColor() });
    }
    this.addCrowd(crowd);
    // light masts on the rim
    const masts: Item[] = [];
    const heads: Item[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const x = Math.sin(a) * (rTop + 1);
      const z = Math.cos(a) * (rTop + 1);
      masts.push({ x, y: yTop + 2.5, z, ry: a, sx: 1, sy: 1, sz: 1 });
      heads.push({ x: x * 0.985, y: yTop + 12.5, z: z * 0.985, ry: Math.atan2(-x, -z), rx: 0.35, sx: 1, sy: 1, sz: 1 });
      this.glowSprite(0xffffff, 0.6, 12, x * 0.97, yTop + 12.5, z * 0.97);
    }
    this.inst(new THREE.BoxGeometry(0.6, 10, 0.6).translate(0, 5, 0), this.std(0x7a8490, { metalness: 0.5 }), masts);
    this.inst(new THREE.BoxGeometry(5, 2.4, 0.4), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), heads);
    // wind-swept snow fence posts
    const posts: Item[] = this.scatter(30, 48, 56).map((p) => ({ x: p.x, y: 0, z: p.z, ry: rnd() * 6, sx: 1, sy: 1, sz: 1 }));
    this.inst(new THREE.BoxGeometry(0.12, 1.8, 0.12).translate(0, 0.9, 0), this.emissive(0xff5a2a, 0.8, { speed: 4 }), posts);
  }

  /* ---------- theme: Omega Summit (factory at the top of the world) ---------- */

  private buildSummit(G: number, snowMat: THREE.Material): void {
    const rnd = this.rnd;
    const st = this.style;
    // jagged spires
    const spireGeo = new THREE.ConeGeometry(1, 1, 5, 1).translate(0, 0.5, 0);
    const spires: Item[] = this.scatter(55, 50, 125).map((p) => {
      const far = Math.hypot(p.x, p.z) > 76;
      const r = 1.5 + rnd() * (far ? 5 : 2.5);
      const h = (far ? 14 : 5) + rnd() * (far ? 26 : 9);
      return { x: p.x, y: G - 0.5, z: p.z, ry: rnd() * 6, rx: (rnd() - 0.5) * 0.2, rz: (rnd() - 0.5) * 0.2, sx: r, sy: h, sz: r * (0.7 + rnd() * 0.5) };
    });
    this.inst(spireGeo, this.std(st.rock, { roughness: 0.9 }), spires);
    this.inst(spireGeo.clone(), snowMat, spires.map((s) => ({ ...s, y: s.y + s.sy * 0.7 - 0.05, sx: s.sx * 0.31, sy: s.sy * 0.305, sz: s.sz * 0.31 })));

    // factory blocks with glowing window bands
    const blocks: Item[] = [];
    const bands: Item[] = [];
    for (const p of this.scatter(12, 72, 115, true)) {
      if (p.z > 40 && Math.abs(p.x) < 50) continue;
      if (Math.hypot(p.x - CORE_X, p.z - CORE_Z) < 26) continue; // core tower
      const w = 10 + rnd() * 14;
      const d = 10 + rnd() * 12;
      const h = 10 + rnd() * 18;
      const ry = Math.atan2(-p.x, -p.z);
      blocks.push({ x: p.x, y: 0, z: p.z, ry, sx: w, sy: h, sz: d });
      for (let y = 4; y < h - 1; y += 4.5) bands.push({ x: p.x, y, z: p.z, ry, sx: w + 0.12, sy: 0.4, sz: d + 0.12 });
    }
    this.inst(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), this.std(0x2a2638, { metalness: 0.5, roughness: 0.6 }), blocks);
    this.inst(new THREE.BoxGeometry(1, 1, 1), this.emissive(st.accents[0], 1.4, { speed: 0.9 }), bands);

    // the ominous core tower, due north
    // (fog-free like the mountain ring, so it always looms as a hazy silhouette on the horizon)
    const core = new THREE.Group();
    core.position.set(CORE_X, 0, CORE_Z);
    const dark = this.std(new THREE.Color(0x1e1a2a).lerp(new THREE.Color(this.zone.fogColor), 0.3).getHex(), { metalness: 0.5, roughness: 0.6, fog: false });
    // base, shaft and crown share `dark`: one baked draw
    const coreM = new THREE.Matrix4().makeTranslation(CORE_X, 0, CORE_Z);
    this.bake(new THREE.BoxGeometry(22, 8, 22).translate(0, 4, 0), coreM, dark);
    this.bake(new THREE.CylinderGeometry(4, 7, 20, 8).translate(0, 18, 0), coreM, dark);
    const glowMat = this.emissive(st.accents[0], 2.6, { speed: 1.1 });
    glowMat.fog = false;
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 11, 16).translate(0, 33.5, 0), glowMat);
    this.bake(new THREE.ConeGeometry(5, 16, 8).translate(0, 47, 0), coreM, dark);
    core.add(glow);
    const ringMat = this.emissive(st.accents[1], 2.0, { speed: 1.6, phase: 1 });
    ringMat.fog = false;
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(6 + i * 2, 0.32, 6, 40), ringMat);
      ring.position.y = 33.5;
      ring.rotation.set(Math.PI / 2 + (i - 1) * 0.5, i * 0.7, 0);
      core.add(ring);
      this.spinners.push({ obj: ring, speed: (i % 2 ? -1 : 1) * (0.35 + i * 0.15) });
    }
    this.add(core);
    this.glowSprite(st.accents[0], 0.8, 28, CORE_X, 33.5, CORE_Z, 1.1).material.fog = false;
    this.glowSprite(st.accents[1], 0.9, 7, CORE_X, 55.5, CORE_Z, 3).material.fog = false;

    // glowing crystals
    for (let c = 0; c < st.accents.length; c++) {
      const items: Item[] = [];
      for (const p of this.scatter(10, 48, 90)) {
        const n = 2 + ((rnd() * 4) | 0);
        for (let k = 0; k < n; k++) {
          const s = 0.3 + rnd() * 0.5;
          items.push({ x: p.x + (rnd() - 0.5) * 1.6, y: G + s, z: p.z + (rnd() - 0.5) * 1.6, ry: rnd() * 6, rx: (rnd() - 0.5) * 0.7, rz: (rnd() - 0.5) * 0.7, sx: s, sy: s * (2.2 + rnd() * 1.5), sz: s });
        }
      }
      this.inst(new THREE.OctahedronGeometry(1, 0), this.emissive(st.accents[c], 1.2, { speed: 1.3 + c * 0.4, phase: c * 2 }), items);
    }
  }

  /* ------------------------------------------------------------------ THE SNOWDOME (Brawl) */

  private buildSnowdome(zone: ZoneDef, G: number): void {
    const st = this.style;
    const rnd = this.rnd;
    const tiers: Item[] = [];
    const seats: Item[] = [];
    const backs: Item[] = [];
    const poles: Item[] = [];
    const flags: Item[] = [];
    const crowd: Item[] = [];
    const corners: Item[] = [];
    const sponsorItems: Item[][] = SPONSORS.map(() => []);
    const backN = DOME_N0 + DOME_ROWS * DOME_ROW_D + 0.3;
    const topH = G + 0.25 + DOME_ROWS * DOME_RISE;

    // crowd density so the total stays under the instance cap
    const sideLen = ARENA.maxX - ARENA.minX + 2;
    const crowdStep = 1.5;
    const slots = 4 * DOME_ROWS * Math.floor(sideLen / crowdStep);
    const keep = Math.min(0.9, (DOME_CROWD_CAP * 0.97) / slots);
    let sponsorIdx = 0;
    for (let si = 0; si < SIDES.length; si++) {
      const side = SIDES[si];
      const len = sideLen;
      const accent = st.accents[si % st.accents.length];
      for (let k = 0; k < DOME_ROWS; k++) {
        const top = G + 0.25 + (k + 1) * DOME_RISE;
        const depth = (DOME_ROWS - k) * DOME_ROW_D;
        const [x, z] = side.map(0, DOME_N0 + k * DOME_ROW_D + depth / 2);
        tiers.push({ x, y: 0, z, ry: side.yaw, sx: len, sy: top, sz: depth, color: k % 2 ? st.stand : st.standAlt });
        const [sx, sz] = side.map(0, DOME_N0 + k * DOME_ROW_D + 0.35);
        seats.push({ x: sx, y: top, z: sz, ry: side.yaw, sx: len, sy: 1, sz: 1, color: k % 3 === 0 ? accent : st.trim });
        for (let s = -len / 2 + 0.8; s < len / 2 - 0.6; s += crowdStep) {
          if (rnd() > keep || crowd.length >= DOME_CROWD_CAP) continue;
          const [cx, cz] = side.map(s + (rnd() - 0.5) * 0.3, DOME_N0 + k * DOME_ROW_D + 0.95);
          const sc2 = 1.45 + rnd() * 0.35;
          const col = rnd() < 0.45 ? CONFETTI[(rnd() * CONFETTI.length) | 0] : this.crowdColor();
          crowd.push({ x: cx, y: top, z: cz, ry: side.yaw + (rnd() - 0.5) * 0.4, sx: sc2, sy: sc2, sz: sc2, color: col });
        }
      }
      const [bx, bz] = side.map(0, backN);
      backs.push({ x: bx, y: 0, z: bz, ry: side.yaw, sx: len + 2, sy: topH + 2.2, sz: 0.6 });
      // sponsor boards ribbon on top of the back wall (facing in), and flag poles between them
      for (let s = -len / 2 + 9; s < len / 2 - 6; s += 16) {
        if (Math.abs(s) < 22) continue; // jumbotron
        const [qx, qz] = side.map(s, backN - 0.35);
        sponsorItems[sponsorIdx++ % SPONSORS.length].push({ x: qx, y: topH + 2.2 + 1.6, z: qz, ry: side.yaw, sx: 1, sy: 1, sz: 1 });
        const [px, pz] = side.map(s + 8, backN);
        poles.push({ x: px, y: topH + 2.2, z: pz, ry: side.yaw, sx: 1.8, sy: 1.8, sz: 1.8 });
        flags.push({ x: px, y: topH + 2.2 + 5.2, z: pz, ry: side.yaw + Math.PI / 2 + (rnd() - 0.5) * 0.5, sx: 2, sy: 2, sz: 2, color: CONFETTI[(rnd() * CONFETTI.length) | 0] });
      }
    }
    // corner concourse blocks (floodlight towers rise through them)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const w = backN - WALL_C + 0.4;
      corners.push({ x: sx * (ARENA.maxX + WALL_C + w / 2), y: 0, z: sz * (ARENA.maxZ + WALL_C + w / 2), ry: 0, sx: w, sy: topH * 0.55, sz: w, color: st.trim });
    }

    const unitBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.inst(unitBox(), this.std(0xffffff, { roughness: 0.85 }), tiers, true, true);
    this.inst(new THREE.BoxGeometry(1, 0.16, 0.5).translate(0, 0.08, 0), this.std(0xffffff, { roughness: 0.6 }), seats);
    this.inst(unitBox(), this.std(st.trim, { metalness: 0.4, roughness: 0.55 }), backs, true);
    this.inst(unitBox(), this.std(0xffffff, { metalness: 0.3, roughness: 0.6 }), corners, true, true);
    this.inst(new THREE.CylinderGeometry(0.05, 0.05, 3, 6).translate(0, 1.5, 0), this.std(0xcfd5dc, { metalness: 0.6, roughness: 0.4 }), poles);
    const flagShape = new THREE.Shape();
    flagShape.moveTo(0, 0);
    flagShape.lineTo(1.3, -0.3);
    flagShape.lineTo(0, -0.7);
    flagShape.closePath();
    this.inst(new THREE.ShapeGeometry(flagShape).translate(0.05, 0.4, 0), this.std(0xffffff, { side: THREE.DoubleSide, roughness: 0.7 }), flags);
    this.addCrowd(crowd);

    // sponsor boards: one atlas texture, per-sponsor UV-remapped geometry, all baked into one mesh
    const atlas = this.sponsorAtlas();
    const boardMat = new THREE.MeshBasicMaterial({ map: atlas, toneMapped: false });
    for (let i = 0; i < SPONSORS.length; i++) {
      const geo = new THREE.PlaneGeometry(14, 3.2);
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      const col = i % 2;
      const row = (i / 2) | 0;
      for (let j = 0; j < uv.count; j++) {
        uv.setXY(j, (col + uv.getX(j)) * 0.5, 1 - (row + 1 - uv.getY(j)) * 0.25);
      }
      this.bakeItems(geo, boardMat, sponsorItems[i]);
    }
    // board frames
    const frames: Item[] = [];
    for (const list of sponsorItems) for (const it of list) frames.push({ ...it, z: it.z, sx: 14.6, sy: 3.8, sz: 0.3 });
    this.inst(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.2), this.std(0x15182a, { metalness: 0.5 }), frames);

    this.buildTowers(DOME_TOWER_OFF, DOME_TOWER_K);
    this.buildDomeScreens(zone, topH, backN);
    this.buildDomeTunnels(G);
    this.buildDomeRig();
  }

  private sponsorAtlas(): THREE.Texture {
    const [c, g] = canvas(1024, 512);
    for (let i = 0; i < SPONSORS.length; i++) {
      const [name, bg, fg] = SPONSORS[i];
      const x = (i % 2) * 512;
      const y = ((i / 2) | 0) * 128;
      g.fillStyle = bg;
      g.fillRect(x, y, 512, 128);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      for (let k = 0; k < 6; k++) g.fillRect(x + k * 96 - 20, y, 40, 128);
      g.strokeStyle = fg;
      g.lineWidth = 6;
      g.strokeRect(x + 8, y + 8, 496, 112);
      g.fillStyle = fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = 'italic 900 70px "Arial Black", Impact, sans-serif';
      g.fillText(name, x + 256, y + 66, 470);
    }
    const t = toTex(c);
    this.zoneTex.push(t);
    return t;
  }

  /** Four giant jumbotrons above the stands (one per side), sharing one screen + one ticker texture. */
  private buildDomeScreens(zone: ZoneDef, topH: number, backN: number): void {
    const st = this.style;
    const [c, g] = canvas(1024, 400);
    const bg = g.createLinearGradient(0, 0, 0, 400);
    bg.addColorStop(0, '#0b1230');
    bg.addColorStop(1, '#2a0c3a');
    g.fillStyle = bg;
    g.fillRect(0, 0, 1024, 400);
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 2;
    for (let x = 0; x < 1024; x += 32) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 400);
      g.stroke();
    }
    g.strokeStyle = hexCss(st.accents[0]);
    g.lineWidth = 12;
    g.strokeRect(12, 12, 1000, 376);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 128px "Arial Black", Impact, sans-serif';
    g.fillStyle = '#ffffff';
    g.fillText('SNOWDOME', 512, 120, 960);
    g.fillStyle = hexCss(st.accents[0]);
    g.fillText('BRAWL', 512, 245, 960);
    g.font = 'bold 40px Arial, sans-serif';
    g.fillStyle = hexCss(st.accents[1]);
    g.fillText(`${zone.name.toUpperCase()}  ·  FREE-FOR-ALL  ·  9 PLOWS`, 512, 338, 960);
    const screenTex = toTex(c);
    this.zoneTex.push(screenTex);
    const screenMat = new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false });
    this.pulses.push({ mat: screenMat, base: 1, speed: 0, phase: 0 });

    const [tc, tg] = canvas(2048, 64);
    tg.fillStyle = '#05070f';
    tg.fillRect(0, 0, 2048, 64);
    tg.font = 'bold 38px Arial, sans-serif';
    tg.textBaseline = 'middle';
    const parts = ['★ SNOWDOME BRAWL', '★ EVERYONE HUNTS EVERYONE', '★ STREAKS PAY MORE', '★ SHUTDOWNS PAY BOUNTIES', '★ FIRST TO 20 WRECKS', '★ DASH · SLAM · WHIRL  '];
    let x = 10;
    for (let i = 0; i < parts.length; i++) {
      tg.fillStyle = hexCss(st.accents[i % st.accents.length]);
      tg.fillText(parts[i], x, 34);
      x += tg.measureText(parts[i]).width + 40;
    }
    const tickTex = toTex(tc, true);
    tickTex.wrapT = THREE.ClampToEdgeWrapping;
    this.zoneTex.push(tickTex);
    this.ticker = tickTex;
    const tickMat = new THREE.MeshBasicMaterial({ map: tickTex, toneMapped: false });

    const trim = this.std(st.trim, { metalness: 0.55, roughness: 0.45 });
    const glowFrame = this.emissive(st.accents[0], 1.4, { speed: 3 });
    const K = 1.6;
    const legGeo = new THREE.BoxGeometry(1.2, 14, 1.2).translate(0, 7, 0);
    const frameGeo = new THREE.BoxGeometry(23, 11, 1.4);
    const glowGeo = new THREE.BoxGeometry(23.8, 11.8, 0.6);
    const screenGeo = new THREE.PlaneGeometry(21.4, 8.4);
    const tickGeo = new THREE.PlaneGeometry(21.4, 1.5);
    // static and sharing four materials: baked into the zone batch (4 draws for all four screens)
    const grp = new THREE.Object3D();
    const part = new THREE.Matrix4();
    const bake = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) =>
      this.bake(geo, part.makeTranslation(x, y, z).premultiply(grp.matrix), mat);
    for (const side of SIDES) {
      const [px, pz] = side.map(0, backN + 1.5);
      grp.position.set(px, topH - 2, pz);
      grp.rotation.y = side.yaw;
      grp.scale.setScalar(K);
      grp.updateMatrix();
      for (const lx of [-8, 8]) bake(legGeo, trim, lx, 0, 0);
      bake(glowGeo, glowFrame, 0, 19, -0.3);
      bake(frameGeo, trim, 0, 19, 0);
      bake(screenGeo, screenMat, 0, 19.9, 0.71);
      bake(tickGeo, tickMat, 0, 14.6, 0.71);
    }
    for (const geo of [legGeo, frameGeo, glowGeo, screenGeo, tickGeo]) geo.dispose();
  }

  /** Decorative tunnel mouths in the stand fronts (no gameplay; Brawl has no gates). */
  private buildDomeTunnels(G: number): void {
    const st = this.style;
    const frames: Item[] = [];
    const holes: Item[] = [];
    const lights: Item[] = [];
    for (let i = 0; i < SIDES.length; i++) {
      const side = SIDES[i];
      const s = i % 2 ? -46 : 46;
      const [x, z] = side.map(s, DOME_N0 - 0.6);
      frames.push({ x, y: 0, z, ry: side.yaw, sx: 1, sy: 1, sz: 1 });
      const [hx, hz] = side.map(s, DOME_N0 - 1.82);
      holes.push({ x: hx, y: G, z: hz, ry: side.yaw, sx: 1, sy: 1, sz: 1 });
      const [lx, lz] = side.map(s, DOME_N0 - 1.86);
      lights.push({ x: lx, y: G + 5.6, z: lz, ry: side.yaw, sx: 1, sy: 1, sz: 1 });
    }
    const frameGeo = merge([
      new THREE.BoxGeometry(1.4, 7, 2.6).translate(-5.2, 3.5, 0),
      new THREE.BoxGeometry(1.4, 7, 2.6).translate(5.2, 3.5, 0),
      new THREE.BoxGeometry(11.8, 1.6, 2.6).translate(0, 7.3, 0),
    ]);
    this.inst(frameGeo, this.std(st.trim, { metalness: 0.5, roughness: 0.5 }), frames, true);
    this.inst(new THREE.PlaneGeometry(9, 6.4).translate(0, 3.2, 0), new THREE.MeshBasicMaterial({ color: 0x05070f }), holes);
    this.inst(new THREE.BoxGeometry(9.4, 0.3, 0.1), this.emissive(st.accents[1], 1.8, { speed: 2.4 }), lights);
    for (const h of holes) {
      const fx = Math.sin(h.ry) * 0.6;
      const fz = Math.cos(h.ry) * 0.6;
      this.glowSprite(st.accents[1], 0.35, 9, h.x + fx, G + 3, h.z + fz, 1.8);
    }
  }

  /** A light lighting rig ring + cables high above the arena. */
  private buildDomeRig(): void {
    const st = this.style;
    const R = 128;
    const Y = 58;
    const hubY = 70;
    const trussMat = this.std(0x3a3f55, { metalness: 0.6, roughness: 0.5 });
    // ring, hub and cables share trussMat: one baked draw
    this.bake(new THREE.TorusGeometry(R, 0.9, 5, 96).rotateX(Math.PI / 2), this.tmpM.makeTranslation(0, Y, 0), trussMat);
    this.bake(new THREE.CylinderGeometry(4, 5, 4, 12), this.tmpM.makeTranslation(0, hubY, 0), trussMat);
    const hubGlow = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.35, 6, 32).rotateX(Math.PI / 2), this.emissive(st.accents[0], 2, { speed: 1.2 }));
    hubGlow.position.y = hubY - 2;
    this.add(hubGlow);
    const cables: Item[] = [];
    const lamps: Item[] = [];
    const nC = 12;
    for (let i = 0; i < nC; i++) {
      const a = (i / nC) * Math.PI * 2 + Math.PI / nC;
      const ex = Math.cos(a) * R;
      const ez = Math.sin(a) * R;
      const dx = ex;
      const dy = Y - hubY;
      const dz = ez;
      const len = Math.hypot(dx, dy, dz);
      cables.push({ x: 0, y: hubY, z: 0, rx: Math.acos(dy / len), ry: Math.atan2(dx, dz), sx: 1, sy: len, sz: 1 });
    }
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      lamps.push({ x: Math.cos(a) * R, y: Y - 1.3, z: Math.sin(a) * R, ry: -a, sx: 1, sy: 1, sz: 1, color: CONFETTI[i % CONFETTI.length] });
    }
    this.bakeItems(new THREE.CylinderGeometry(0.25, 0.25, 1, 5).translate(0, 0.5, 0), trussMat, cables);
    this.inst(new THREE.BoxGeometry(1.6, 0.9, 1.6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), lamps);
  }

  /* ------------------------------------------------------------------ Brawl cover obstacles */

  private buildObstacles(G: number, snowMat: THREE.Material): void {
    const rnd = mulberry32(90210);
    const obs = this.obstacleList;
    const pillars: Item[] = [];
    const pillarCaps: Item[] = [];
    const crystals: Item[] = [];
    const containers: Item[] = [];
    const roofs: Item[] = [];
    const rocks: Item[] = [];
    const rockCaps: Item[] = [];
    const snowmen: Item[] = [];
    const tirePiles: Item[] = [];
    const contCols = [0xc0392b, 0x2f6fb0, 0xe0a030, 0x3c8d5a, 0x8e44ad, 0xd35400];
    const lim = ARENA.maxX - 8;
    const clampP = (v: number, r: number) => Math.max(-lim + r, Math.min(lim - r, v));
    const j = (amt: number) => (rnd() - 0.5) * 2 * amt;

    // centerpiece: frozen fountain
    obs.push({ x: 0, z: 0, r: 4 });

    const addContainer = (cx: number, cz: number, ang: number) => {
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      // local +Z of the box = (sin ang, cos ang) ... long axis along local Z
      const ax = s;
      const az = c;
      for (const o of [-2.2, 0, 2.2]) obs.push({ x: cx + ax * o, z: cz + az * o, r: 1.35 });
      const col = contCols[(rnd() * contCols.length) | 0];
      containers.push({ x: cx, y: 0, z: cz, ry: ang, sx: 1, sy: 1, sz: 1, color: col });
      if (rnd() < 0.55) {
        const ang2 = ang + j(0.12);
        containers.push({ x: cx + j(0.3), y: 2.8, z: cz + j(0.3), ry: ang2, sx: 1, sy: 1, sz: 1, color: contCols[(rnd() * contCols.length) | 0] });
        roofs.push({ x: cx, y: 5.6, z: cz, ry: ang2, sx: 1, sy: 1, sz: 1 });
      } else {
        roofs.push({ x: cx, y: 2.8, z: cz, ry: ang, sx: 1, sy: 1, sz: 1 });
      }
    };

    for (let q = 0; q < 4; q++) {
      const ca = Math.cos((q * Math.PI) / 2);
      const sa = Math.sin((q * Math.PI) / 2);
      // rotate a base-quadrant point by q * 90deg
      const P = (x: number, z: number): [number, number] => [x * ca - z * sa, x * sa + z * ca];
      const yaw0 = (q * Math.PI) / 2;

      // A) ice pillar cluster
      {
        const [cx, cz] = P(24 + j(2), 16 + j(2));
        const offs: [number, number][] = [[0, 0], [3.8, 1.2], [1.3, 3.7]];
        for (const [ox, oz] of offs) {
          const [rx, rz] = P(ox, oz);
          const r = 1.2 + rnd() * 0.8;
          const x = cx + rx;
          const z = cz + rz;
          const h = 4.5 + rnd() * 3;
          obs.push({ x, z, r });
          pillars.push({ x, y: 0, z, ry: rnd() * 6, sx: r, sy: h, sz: r });
          pillarCaps.push({ x, y: h - 0.05, z, ry: rnd() * 6, sx: r * 1.08, sy: 0.45, sz: r * 1.08 });
          crystals.push({ x, y: h + 0.6, z, ry: rnd() * 6, rx: j(0.2), rz: j(0.2), sx: r * 0.45, sy: r * 1.2, sz: r * 0.45 });
        }
      }
      // B) shipping container
      {
        const [cx, cz] = P(47 + j(2), 10 + j(2));
        addContainer(cx, cz, yaw0 + 0.35 + j(0.25));
      }
      // C) rock outcrop (main + satellite)
      {
        const [cx, cz] = P(38 + j(2), 40 + j(2));
        const r = 3 + rnd();
        obs.push({ x: cx, z: cz, r });
        rocks.push({ x: cx, y: r * 0.15, z: cz, ry: rnd() * 6, rx: j(0.3), sx: r * 1.05, sy: r * 0.95, sz: r * 1.05 });
        rockCaps.push({ x: cx, y: r * 0.15 + r * 0.6, z: cz, ry: rnd() * 6, sx: r * 0.75, sy: r * 0.35, sz: r * 0.75 });
        const a = rnd() * Math.PI * 2;
        const r2 = 1.6 + rnd() * 0.6;
        const sx = cx + Math.cos(a) * (r + r2 * 0.6);
        const sz = cz + Math.sin(a) * (r + r2 * 0.6);
        obs.push({ x: sx, z: sz, r: r2 });
        rocks.push({ x: sx, y: r2 * 0.1, z: sz, ry: rnd() * 6, rz: j(0.3), sx: r2 * 1.05, sy: r2 * 0.9, sz: r2 * 1.05 });
        rockCaps.push({ x: sx, y: r2 * 0.1 + r2 * 0.55, z: sz, ry: rnd() * 6, sx: r2 * 0.72, sy: r2 * 0.3, sz: r2 * 0.72 });
      }
      // D) giant snowman statue (faces the center)
      {
        const [x, z] = P(12 + j(2), 54 + j(2));
        obs.push({ x, z, r: 2.3 });
        snowmen.push({ x, y: 0, z, ry: Math.atan2(-x, -z) + j(0.3), sx: 1, sy: 1, sz: 1 });
      }
      // E) stacked tire pile
      {
        const [x, z] = P(clampP(77 + j(1.5), 2), 36 + j(2));
        obs.push({ x, z, r: 2 });
        tirePiles.push({ x, y: 0, z, ry: rnd() * 6, sx: 1, sy: 1, sz: 1 });
      }
      // F) corner container
      {
        const [cx, cz] = P(62 + j(2), 64 + j(2));
        addContainer(cx, cz, yaw0 + Math.PI / 4 + j(0.3));
      }
    }

    // --- meshes
    const iceMat = this.std(0xa8e4ff, { roughness: 0.15, metalness: 0.1, emissive: 0x15405a, emissiveIntensity: 0.6 });
    this.inst(new THREE.CylinderGeometry(0.9, 1, 1, 6).translate(0, 0.5, 0), iceMat, pillars, true, true);
    // pillar caps, container roofs and rock caps share snowMat + receive: baked into one draw
    this.bakeItems(new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), snowMat, pillarCaps, false, true);
    this.inst(new THREE.OctahedronGeometry(1, 0), this.emissive(0x6ff3ff, 1.4, { speed: 1.6 }), crystals);

    // containers: corrugated box + snow roof
    const ribs = this.ribTexture();
    const contGeo = new THREE.BoxGeometry(2.6, 2.8, 6.6).translate(0, 1.4, 0);
    this.inst(contGeo, this.std(0xffffff, { map: ribs, roughness: 0.6, metalness: 0.3, flatShading: false }), containers, true, true);
    this.bakeItems(new THREE.BoxGeometry(2.7, 0.32, 6.7).translate(0, 0.16, 0), snowMat, roofs, true, true);

    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    this.inst(rockGeo, this.std(this.style.rock, { roughness: 0.95 }), rocks, true, true);
    this.bakeItems(rockGeo.clone(), snowMat, rockCaps, false, true);

    // snowman statue (merged, vertex colored)
    const snowmanGeo = merge([
      colored(new THREE.SphereGeometry(2.3, 14, 10).translate(0, 1.9, 0), 0xf4f8ff),
      colored(new THREE.SphereGeometry(1.7, 14, 10).translate(0, 4.6, 0), 0xf4f8ff),
      colored(new THREE.SphereGeometry(1.2, 12, 9).translate(0, 6.75, 0), 0xf4f8ff),
      colored(new THREE.CylinderGeometry(1.5, 1.5, 0.18, 14).translate(0, 7.75, 0), 0x16161c),
      colored(new THREE.CylinderGeometry(0.95, 1.0, 1.5, 14).translate(0, 8.55, 0), 0x16161c),
      colored(new THREE.CylinderGeometry(1.02, 1.02, 0.3, 14).translate(0, 8.0, 0), 0xe63946),
      colored(new THREE.ConeGeometry(0.22, 1.4, 8).rotateX(Math.PI / 2).translate(0, 6.75, 1.75), 0xff7a1a),
      colored(new THREE.SphereGeometry(0.16, 6, 5).translate(0.42, 7.05, 1.05), 0x111111),
      colored(new THREE.SphereGeometry(0.16, 6, 5).translate(-0.42, 7.05, 1.05), 0x111111),
      colored(new THREE.SphereGeometry(0.18, 6, 5).translate(0, 5.0, 1.62), 0x111111),
      colored(new THREE.SphereGeometry(0.18, 6, 5).translate(0, 4.3, 1.66), 0x111111),
      colored(new THREE.TorusGeometry(1.25, 0.3, 6, 16).rotateX(Math.PI / 2).translate(0, 5.95, 0), 0x2a9df4),
      colored(new THREE.CylinderGeometry(0.12, 0.12, 3.2, 5).rotateZ(1.0).translate(2.6, 5.4, 0), 0x5a3a22),
      colored(new THREE.CylinderGeometry(0.12, 0.12, 3.2, 5).rotateZ(-1.0).translate(-2.6, 5.4, 0), 0x5a3a22),
    ]);
    this.inst(snowmanGeo, this.std(0xffffff, { vertexColors: true, roughness: 0.75 }), snowmen, true, true);

    // tire pile: stacks of lying tires + one leaning
    const tireParts: THREE.BufferGeometry[] = [];
    const tire = (x: number, y: number, z: number, rx: number, rz: number) =>
      tireParts.push(colored(new THREE.TorusGeometry(0.6, 0.27, 7, 14).rotateX(rx).rotateZ(rz).translate(x, y, z), 0x1d1e23));
    for (const [sx, sz, n] of [[-0.75, -0.5, 4], [0.85, -0.45, 3], [0, 0.85, 5]] as [number, number, number][]) {
      for (let k = 0; k < n; k++) tire(sx, 0.27 + k * 0.52, sz, Math.PI / 2, 0);
    }
    tire(0.1, 2.45, 0.2, Math.PI / 2 - 0.3, 0.2);
    tire(1.6, 0.7, 0.9, 0.2, 0);
    tireParts.push(colored(new THREE.SphereGeometry(1.2, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.4, 1).translate(0, 2.7, 0.7), 0xf4f8ff));
    this.inst(merge(tireParts), this.std(0xffffff, { vertexColors: true, roughness: 0.9 }), tirePiles, true, true);

    this.buildFountain(G);
  }

  private ribTexture(): THREE.Texture {
    const [c, g] = canvas(64, 64);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 64, 64);
    for (let x = 0; x < 64; x += 8) {
      g.fillStyle = '#b9bec7';
      g.fillRect(x, 0, 3, 64);
      g.fillStyle = '#e4e7ec';
      g.fillRect(x + 3, 0, 2, 64);
    }
    g.fillStyle = '#8a8f99';
    g.fillRect(0, 0, 64, 3);
    g.fillRect(0, 61, 64, 3);
    const t = toTex(c, true);
    t.repeat.set(3, 1);
    this.zoneTex.push(t);
    return t;
  }

  /** Frozen fountain / ice sculpture centerpiece (obstacle r = 4 at the origin). */
  private buildFountain(G: number): void {
    const st = this.style;
    const stone = 0x8a93a6;
    const ice = 0xbfeaff;
    const parts: THREE.BufferGeometry[] = [
      colored(new THREE.CylinderGeometry(4, 4.15, 1.0, 24).translate(0, 0.5, 0), stone),
      colored(new THREE.TorusGeometry(3.75, 0.32, 6, 28).rotateX(Math.PI / 2).translate(0, 1.0, 0), 0xa8b1c4),
      colored(new THREE.CylinderGeometry(3.45, 3.45, 0.2, 24).translate(0, 0.95, 0), ice),
      colored(new THREE.CylinderGeometry(0.8, 1.1, 3.2, 10).translate(0, 2.5, 0), stone),
      colored(new THREE.CylinderGeometry(2.1, 1.0, 0.6, 16).translate(0, 4.2, 0), stone),
      colored(new THREE.CylinderGeometry(0.5, 0.7, 1.6, 8).translate(0, 5.2, 0), stone),
    ];
    // frozen water curtains dripping off the upper bowl
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const r = 1.85;
      parts.push(colored(new THREE.ConeGeometry(0.28, 2.6, 5).rotateX(Math.PI).translate(Math.cos(a) * r, 2.75, Math.sin(a) * r), ice));
    }
    const base = new THREE.Mesh(merge(parts), this.std(0xffffff, { vertexColors: true, roughness: 0.35, metalness: 0.15 }));
    base.position.y = G * 0.3;
    base.castShadow = true;
    base.receiveShadow = true;
    this.add(base);
    // spinning ice sculpture on top (crystal elongated along local Z; the holder turns Z up so rotation.z spins about world Y)
    const holder = new THREE.Group();
    holder.position.set(0, G * 0.3 + 8.2, 0);
    holder.rotation.x = -Math.PI / 2;
    const crystalMat = this.emissive(0x7ff6ff, 1.1, { speed: 1.4 });
    crystalMat.roughness = 0.1;
    crystalMat.metalness = 0.2;
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.2, 0).scale(1, 1, 2.2), crystalMat);
    crystal.castShadow = true;
    holder.add(crystal);
    // the three (non-casting) satellites: one merged child, so they spin with the crystal
    const sats = new StaticBatch();
    const satGeo = new THREE.OctahedronGeometry(0.45, 0).scale(1, 1, 1.8);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      sats.add(satGeo, this.tmpM.makeTranslation(Math.cos(a) * 1.9, Math.sin(a) * 1.9, -1.2), crystalMat);
    }
    sats.flush(crystal);
    satGeo.dispose();
    this.add(holder);
    this.spinners.push({ obj: crystal, speed: 0.6 });
    this.glowSprite(0x7ff6ff, 0.55, 12, 0, G * 0.3 + 8.2, 0, 1.4);
    // accent ring on the ground
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(5.2, 5.6, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: st.accents[1], transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    ring.position.y = G + 0.05;
    ring.renderOrder = 2;
    this.add(ring);
  }

  /* ------------------------------------------------------------------ falling snow */

  private buildSnowfall(zone: ZoneDef): void {
    if (this.flakes) {
      this.ctx.scene.remove(this.flakes);
      this.flakes.geometry.dispose();
      (this.flakes.material as THREE.Material).dispose();
      this.flakes = null;
    }
    const blizzard = zone.theme === 'blizzard';
    const count = Math.round(1500 + Math.min(1, Math.max(0, zone.snowfall)) * 6500);
    this.windX = blizzard ? 16 : 0.8 + zone.snowfall * 2;
    this.windZ = blizzard ? 5 : 0.4;
    this.fallSpeed = blizzard ? 5 : 1.4;
    this.sway = blizzard ? 1.5 : 0.6;
    const pos = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const cam = this.ctx.camera.position;
    for (let i = 0; i < count; i++) {
      pos[i * 3] = cam.x + (Math.random() - 0.5) * SNOW_BOX;
      pos[i * 3 + 1] = cam.y - 12 + Math.random() * SNOW_H;
      pos[i * 3 + 2] = cam.z + (Math.random() - 0.5) * SNOW_BOX;
      phase[i] = Math.random() * 100;
    }
    this.flakePos = pos;
    this.flakePhase = phase;
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(pos, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    const mat = new THREE.PointsMaterial({
      size: blizzard ? 0.32 : 0.24,
      map: getSnowflakeTex(),
      transparent: true,
      opacity: blizzard ? 0.95 : 0.9,
      depthWrite: false,
      sizeAttenuation: true,
      color: 0xffffff,
    });
    this.flakes = new THREE.Points(geo, mat);
    this.flakes.frustumCulled = false;
    this.flakes.renderOrder = 5;
    this.ctx.scene.add(this.flakes);
  }

  /* ------------------------------------------------------------------ update */

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    const cam = this.ctx.camera.position;
    this.sky.position.copy(cam);
    this.bobTime.value = t;

    // sun shadow camera follows the player (snapped to shadow-map texels to avoid shimmering)
    const plow = this.ctx.plow;
    if (plow) {
      const p = plow.position;
      const tx = this.sunR.x * p.x + this.sunR.z * p.z;
      const ty = this.sunU.x * p.x + this.sunU.z * p.z;
      const tw = this.sunD.x * p.x + this.sunD.z * p.z;
      const k = this.shadowTexel;
      const u = Math.round(tx / k) * k;
      const v = Math.round(ty / k) * k;
      const R = this.sunR;
      const U = this.sunU;
      const D = this.sunD;
      const target = this.sun.target.position;
      target.set(R.x * u + U.x * v + D.x * tw, R.y * u + U.y * v + D.y * tw, R.z * u + U.z * v + D.z * tw);
      this.sun.position.set(target.x + D.x * 100, target.y + D.y * 100, target.z + D.z * 100);
      this.sun.target.updateMatrixWorld();
    }

    for (let i = 0; i < this.pulses.length; i++) {
      const p = this.pulses[i];
      const k = p.speed === 0 ? 0.94 + 0.06 * Math.sin(t * 7.3) * Math.sin(t * 1.1) : 0.75 + 0.25 * Math.sin(t * p.speed + p.phase);
      const m = p.mat as THREE.MeshStandardMaterial;
      if (m.isMeshStandardMaterial) m.emissiveIntensity = p.base * k;
      else if (p.speed === 0) (p.mat as THREE.MeshBasicMaterial).color.setScalar(k);
      else p.mat.opacity = p.base * k;
    }

    // gates: roll the doors, flash the hazard lights
    for (let i = 0; i < this.gates.length; i++) {
      const g = this.gates[i];
      if (g.openT > 0) g.openT -= dt;
      if (g.flashT > 0) g.flashT -= dt;
      const target = g.openT > 0 ? 1 : 0;
      const rate = target > g.open ? 2.6 : 1.3;
      const diff = target - g.open;
      g.open += Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
      const e = g.open * g.open * (3 - 2 * g.open);
      const doorScale = 1 - 0.94 * e;
      if (doorScale !== g.doorScale && this.doors) {
        g.doorScale = doorScale;
        this.doors.setMatrixAt(i, this.tmpM.makeScale(1, doorScale, 1).premultiply(g.doorBase));
        this.doors.instanceMatrix.needsUpdate = true;
      }
      const flashing = g.flashT > 0;
      const k = flashing ? (Math.sin(t * 26) > 0 ? 4.5 : 0.5) : 0.8 + 0.25 * Math.sin(t * 2.2 + g.phase);
      g.lightMat.emissiveIntensity = k;
      g.glowMat.opacity = Math.min(1, 0.18 + k * 0.17);
      g.floorMat.opacity = 0.35 + 0.35 * e + (flashing ? 0.15 : 0);
    }
    if (chevronTex) chevronTex.offset.y = (chevronTex.offset.y + dt * 0.9) % 1;
    if (this.ticker) this.ticker.offset.x = (this.ticker.offset.x + dt * 0.05) % 1;

    for (let i = 0; i < this.spinners.length; i++) this.spinners[i].obj.rotation.z += dt * this.spinners[i].speed;

    if (this.puffs) {
      const { mesh, stacks, per } = this.puffs;
      const d = this.dummy;
      d.rotation.set(0, 0, 0);
      let n = 0;
      for (let s = 0; s < stacks.length; s++) {
        const st = stacks[s];
        for (let j = 0; j < per; j++) {
          const f = (t * 0.12 + j / per + s * 0.37) % 1;
          d.position.set(st.x + f * 9 + Math.sin(t * 0.5 + j) * 0.8, st.y + 1 + f * 16, st.z + f * 3);
          d.scale.setScalar(st.r * (0.8 + f * 2.2) * (1 - f * f * 0.6));
          d.updateMatrix();
          mesh.setMatrixAt(n++, d.matrix);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    if (this.flakes) {
      const pos = this.flakePos;
      const ph = this.flakePhase;
      const n = ph.length;
      const halfB = SNOW_BOX / 2;
      const yMin = cam.y - 12;
      const gust = 1 + 0.35 * Math.sin(t * 0.7) + 0.15 * Math.sin(t * 2.3);
      const wx = this.windX * gust * dt;
      const wz = this.windZ * gust * dt;
      const fall = this.fallSpeed * dt;
      const sw = this.sway * dt;
      const cx = cam.x;
      const cz = cam.z;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        const p = ph[i];
        let x = pos[i3] + wx + Math.sin(t * 1.3 + p) * sw;
        let y = pos[i3 + 1] - fall * (0.7 + (p % 1) * 0.6);
        let z = pos[i3 + 2] + wz + Math.cos(t * 1.1 + p * 1.7) * sw;
        let dx = x - cx;
        if (dx > halfB) x -= SNOW_BOX;
        else if (dx < -halfB) x += SNOW_BOX;
        dx = z - cz;
        if (dx > halfB) z -= SNOW_BOX;
        else if (dx < -halfB) z += SNOW_BOX;
        if (y < yMin || y < -0.2) y += SNOW_H;
        else if (y > yMin + SNOW_H) y -= SNOW_H;
        pos[i3] = x;
        pos[i3 + 1] = y;
        pos[i3 + 2] = z;
      }
      (this.flakes.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}
