import * as THREE from 'three';
import type { GameContext, Obstacle, ZoneDef } from '../../core/types';
import { ARENA } from '../../core/types';
import { Props } from '../Props';
import { StaticBatch } from '../../render/mergeStatic';
import { getSignAtlas, signPlane } from '../rallyTextures';
import type { BiomeKey } from '../../config/zones';
import { Weather } from '../biomes/Weather';
import { GroundDecals } from '../biomes/GroundDecals';
import { OmegaWorks } from '../omega/OmegaWorks';
import { OmegaSet } from '../omega/OmegaSet';
import type { Item, GateState, Puff, Pulse } from './types';
import type { Style } from './styles';
import { STYLES } from './styles';
import { TOWER_OFF, brawlMode, colored, crowdKeep, merge, mulberry32 } from './layout';
import { GLOW_FLASH, GLOW_PHONE, GlowPoints, type GlowUniforms, type NightLook } from './night';
import { currentPreset } from '../../core/settings';
import { getGlowTex } from './textures';

/** At night the crowd keeps at least this share of its figures on every quality (LOW's day share is 0.5). */
const NIGHT_CROWD_MIN = 0.75;

/** Fields, lights / sky setup and the shared build helpers of the arena builder (see world/Environment.ts). */
export class EnvironmentCore {
  protected ctx: GameContext;
  protected hemi: THREE.HemisphereLight;
  protected sun: THREE.DirectionalLight;
  protected spots: THREE.SpotLight[] = [];
  protected sky: THREE.Mesh;
  protected skyMat: THREE.ShaderMaterial;
  protected fog: THREE.Fog;
  protected decor: THREE.Group | null = null;
  /** The Omega Works' decks / pistons / conveyors and its set dressing (only while that arena is loaded). */
  protected omega: { works: OmegaWorks; set: OmegaSet } | null = null;
  protected zone: ZoneDef;
  protected style: Style = STYLES.meadow;
  /** Biome of the current zone (null = the classic theme look). */
  protected biome: BiomeKey | null = null;
  protected weather: Weather;
  /** Glacier: the hemisphere light shimmers between its base colour and aurora green / violet. */
  protected auroraBase: THREE.Color | null = null;
  protected auroraA = new THREE.Color(0x6dffc0);
  protected auroraB = new THREE.Color(0xb48cff);
  protected decals: GroundDecals | null = null;
  protected time = 0;
  protected rnd: () => number = Math.random;
  protected obstacleList: Obstacle[] = [];
  protected props: Props;
  /** Sun offset from its (player-following) target, and the light-space basis for texel snapping. */
  protected sunOffset = new THREE.Vector3(45, 80, 55);
  protected sunR = new THREE.Vector3();
  protected sunU = new THREE.Vector3();
  protected sunD = new THREE.Vector3();
  protected shadowTexel = 80 / 2048;

  // ambient animation
  protected pulses: Pulse[] = [];
  protected gates: GateState[] = [];
  protected doors: THREE.InstancedMesh | null = null;
  /** Static parts baked while a zone is built (flushed by finishDecor). */
  protected batch: StaticBatch | null = null;
  protected wallTires: { items: Item[]; mat: THREE.Material } | null = null;
  protected crowd: { items: Item[]; phases: Float32Array[]; fill: Item[]; fillPhases: number[]; bodyMat: THREE.Material; eyeMat: THREE.Material } | null = null;
  /* ---- NIGHT (Settings › Time of day; world/environment/night.ts, NightScenery.ts) */
  /** The zone being built is lit for night. */
  protected night = false;
  /** Its night look (null by day). */
  protected nightDef: NightLook | null = null;
  /** Night-only decoration rng (extra spectators, phone lights, light banks): never this.rnd, so the arena layout
   *  (cover, props, everything that must match between Duel peers) draws exactly the same numbers day or night. */
  protected nightRnd: () => number = mulberry32(1);
  /** Stadium lights collected while a night zone is built (phone lights, flashes, lamp halos): one Points draw. */
  protected glowPts: GlowPoints | null = null;
  protected glowU: GlowUniforms = {
    uTime: { value: 0 }, uScale: { value: 600 }, uBob: { value: 0.2 }, uFogNear: { value: 60 }, uFogFar: { value: 170 },
  };
  /** Floodlight heads (lamp centre, the ground point it lights, size scale) for the night cones / pools. */
  protected floodHeads: { x: number; y: number; z: number; tx: number; tz: number; k: number }[] = [];
  /** Night floodlight wash on the crowd bodies (emissive = albedo x lift; 0 by day). */
  protected crowdLift = { value: 0 };
  /** Gate light gain (NIGHT_BOOST at night). */
  protected lightGain = 1;
  /** Shadow-only copies of the baked casters (never in the scene; read once by finishDecor). */
  protected casters = new THREE.Group();
  protected tmpM = new THREE.Matrix4();
  protected zoneTex: THREE.Texture[] = [];
  protected ticker: THREE.Texture | null = null;
  protected spinners: { obj: THREE.Object3D; speed: number }[] = [];
  /** Rising smoke / steam columns: `rise` m tall (default 16), drifting `drift` m downwind (default 9). */
  protected puffs: { mesh: THREE.InstancedMesh; stacks: Puff[]; per: number } | null = null;
  protected bobTime = { value: 0 };
  /** Crowd bob height (the rally crowd cheers harder). */
  protected bobAmp = { value: 0.2 };
  /** Golden Tower Plaza's red carpet, re-draped over the snow every frame. */
  /** `nv` = vertex count. */
  protected carpet: { mesh: THREE.Mesh; pos: THREE.BufferAttribute; nv: number } | null = null;
  protected signMat: THREE.MeshStandardMaterial | null = null;
  protected dummy = new THREE.Object3D();
  protected tmpV = new THREE.Vector3();
  protected tmpV2 = new THREE.Vector3();


  /** Golden Tower Plaza dressing (the rally venue, or the Plaza biome anywhere: Survival, Duel, Brawl). */
  protected get isRally(): boolean {
    return this.zone.theme === 'rally' || this.biome === 'plaza';
  }

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.props = new Props(ctx);
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

    this.weather = new Weather(scene);
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color() },
        bottom: { value: new THREE.Color() },
        horizon: { value: new THREE.Color() },
        topB: { value: new THREE.Color() },
        bottomB: { value: new THREE.Color() },
        horizonB: { value: new THREE.Color() },
        uSplit: { value: 0 },
        uAurora: { value: 0 },
        uStars: { value: 0 },
        uSmoke: { value: 0 },
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color() },
        uSunSize: { value: 0 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      // Gradient sky + per-biome extras: split halves (The Thermal Divide), aurora curtains and stars (glacier),
      // drifting smoke bands (quarry) and a small sun disc (Rust Basin, Plaza). Every extra is gated by a uniform.
      fragmentShader: `
        uniform vec3 top; uniform vec3 bottom; uniform vec3 horizon;
        uniform vec3 topB; uniform vec3 bottomB; uniform vec3 horizonB;
        uniform float uSplit; uniform float uAurora; uniform float uStars; uniform float uSmoke; uniform float uTime;
        uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunSize;
        varying vec3 vDir;
        float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hsh(i), hsh(i + vec2(1, 0)), u.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), u.x), u.y);
        }
        vec3 grad(vec3 hz, vec3 bt, vec3 tp, float h) {
          vec3 c = mix(hz, bt, smoothstep(-0.02, 0.12, h));
          return mix(c, tp, smoothstep(0.08, 0.75, h));
        }
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 c = grad(horizon, bottom, top, h);
          if (uSplit > 0.0) c = mix(c, grad(horizonB, bottomB, topB, h), smoothstep(-0.22, 0.22, d.x) * uSplit);
          float az = atan(d.x, d.z);
          if (uStars > 0.0 && h > 0.12) {
            vec2 g = floor(vec2(az * 90.0, h * 140.0));
            float s = hsh(g);
            c += vec3(step(0.993, s) * uStars * smoothstep(0.12, 0.45, h) * (0.55 + 0.45 * sin(uTime * 2.0 + s * 60.0)));
          }
          if (uAurora > 0.0) {
            float band = smoothstep(0.1, 0.26, h) * (1.0 - smoothstep(0.42, 0.8, h));
            float wv = sin(az * 3.0 + sin(az * 7.0 + uTime * 0.21) * 0.9 + uTime * 0.07);
            float curtain = pow(0.5 + 0.5 * wv, 3.0);
            float rays = 0.55 + 0.45 * sin(az * 70.0 + uTime * 0.5 + sin(az * 11.0 + uTime * 0.1) * 4.0);
            vec3 ac = mix(vec3(0.1, 1.0, 0.5), vec3(0.55, 0.3, 1.0), smoothstep(0.22, 0.6, h));
            c += ac * band * curtain * rays * uAurora * 0.9;
          }
          if (uSmoke > 0.0) {
            vec2 sp = d.xz * (2.2 / (0.3 + max(h, 0.0))) + vec2(uTime * 0.03, 0.0);
            float n = vn(sp * 2.0) * 0.6 + vn(sp * 5.0 + 3.1) * 0.4;
            float k = smoothstep(0.35, 0.8, n) * smoothstep(-0.02, 0.15, h) * (1.0 - smoothstep(0.5, 0.95, h));
            c = mix(c, vec3(0.05, 0.015, 0.01), k * 0.55 * uSmoke);
            c += vec3(0.5, 0.12, 0.02) * (1.0 - smoothstep(0.0, 0.12, h)) * (1.0 - k) * 0.35 * uSmoke;
          }
          if (uSunSize > 0.0) {
            float a = dot(d, uSunDir);
            c += uSunColor * (smoothstep(cos(uSunSize), cos(uSunSize * 0.8), a) + pow(max(a, 0.0), 90.0) * 0.4);
          }
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

  /* ------------------------------------------------------------------ helpers */

  protected add<T extends THREE.Object3D>(o: T): T {
    this.decor!.add(o);
    return o;
  }

  /** Placement matrix of an Item (shared by inst() and baked items). */
  protected itemMatrix(it: Item): THREE.Matrix4 {
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
  protected bake(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, mat: THREE.Material, cast = false, receive = false): void {
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
  protected bakeItems(geo: THREE.BufferGeometry, mat: THREE.Material, items: Item[], cast = false, receive = false): void {
    for (const it of items) this.bake(geo, this.itemMatrix(it), mat, cast, receive);
    geo.dispose();
  }

  protected inst(geo: THREE.BufferGeometry, mat: THREE.Material, items: Item[], cast = false, receive = false): THREE.InstancedMesh | null {
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

  protected std(color: number, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...opts });
  }

  protected emissive(color: number, intensity: number, pulse?: { speed: number; phase?: number }): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
    if (pulse) this.pulses.push({ mat: m, base: intensity, speed: pulse.speed, phase: pulse.phase ?? 0 });
    return m;
  }

  protected glowSprite(color: number, opacity: number, scale: number, x: number, y: number, z: number, pulse?: number): THREE.Sprite {
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
  protected bobify<T extends THREE.Material>(mat: T): T {
    const u = this.bobTime;
    const amp = this.bobAmp;
    const lift = this.crowdLift;
    // art pass: per-spectator build (width / height from the bob phase) and, outside the rally (whose arms are already
    // up), about half the house waving its arms. Same draws: the arms are tagged per vertex (aPart: 1 left, 2 right;
    // 0 / absent = rigid), so eyes and caps follow the head through the same scale.
    const wave = { value: this.isRally && !brawlMode ? 0 : 1 };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uBobTime = u;
      shader.uniforms.uBobAmp = amp;
      shader.uniforms.uCrowdLift = lift;
      shader.uniforms.uArmWave = wave;
      // Night floodlight wash (lit materials only; adds 0 by day): the spectators keep their colours in the dark.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uCrowdLift;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uCrowdLift;');
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uBobTime;\nuniform float uBobAmp;\nuniform float uArmWave;\nattribute float aPhase;\nattribute float aPart;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float cH1 = fract(sin(aPhase * 12.9898) * 43758.5453);
          float cH2 = fract(sin(aPhase * 78.233) * 43758.5453);
          if (aPart > 0.5) {
            float cSide = aPart < 1.5 ? 1.0 : -1.0;
            vec2 cPiv = vec2(cSide * 0.24, 0.7);
            float cUp = uArmWave * step(0.5, cH2) * (0.55 + 0.45 * sin(uBobTime * (2.2 + cH1 * 3.0) + aPhase));
            float cA = cSide * cUp * 2.1;
            vec2 cD = transformed.xy - cPiv;
            transformed.xy = cPiv + vec2(cD.x * cos(cA) - cD.y * sin(cA), cD.x * sin(cA) + cD.y * cos(cA));
          }
          transformed.x *= 0.86 + 0.28 * cH1;
          transformed.z *= 0.9 + 0.2 * cH1;
          transformed.y *= 0.9 + 0.2 * cH2;
          transformed.y += abs(sin(uBobTime * (3.2 + fract(aPhase) * 2.6) + aPhase)) * uBobAmp;`,
        );
    };
    mat.customProgramCacheKey = () => 'crowd-bob2';
    return mat;
  }

  /** Tiny blocky bot spectators that bob in their seats. Items face local +Z. Every call of a zone build adds to
   *  one crowd (body + eyes draw), emitted by flushCrowd; the bob phases are drawn here, in build order. */
  protected addCrowd(items: Item[], fill: Item[] = []): void {
    if (items.length === 0 && fill.length === 0) return;
    const phase = new Float32Array(items.length);
    for (let i = 0; i < phase.length; i++) phase[i] = this.rnd() * 40;
    if (!this.crowd) {
      const bodyMat = this.bobify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true }));
      const eyeMat = this.bobify(new THREE.MeshBasicMaterial({ color: this.style.accents[1], toneMapped: false }));
      this.crowd = { items: [], phases: [], fill: [], fillPhases: [], bodyMat, eyeMat };
    }
    this.crowd.items.push(...items);
    this.crowd.phases.push(phase);
    // Night fill-in spectators (the empty seats of the day layout): phases from the night rng.
    for (const f of fill) {
      this.crowd.fill.push(f);
      this.crowd.fillPhases.push(this.nightRnd() * 40);
    }
  }

  /** A night fill-in spectator's shirt colour (crowdColor's mix, drawn from the night rng). */
  protected nightCrowdColor(): number {
    const r = this.nightRnd;
    const pal = this.style.accents;
    if (this.isRally) {
      const k = r();
      return k < 0.38 ? 0xc8102e : k < 0.7 ? 0xf4f4f0 : k < 0.92 ? 0x1f3b8c : 0xf2c033;
    }
    if (r() < 0.6) return pal[(r() * pal.length) | 0];
    const greys = [0x9aa4b0, 0x6a7380, 0xd8dde3, 0x3a4250];
    return greys[(r() * greys.length) | 0];
  }

  protected flushCrowd(): void {
    /** Tag a crowd body piece for the arm wave (bobify): 0 rigid, 1 left arm, 2 right arm. */
    const part = (g: THREE.BufferGeometry, v: number): THREE.BufferGeometry => {
      g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(v), 1));
      return g;
    };
    const crowd = this.crowd;
    this.crowd = null;
    if (!crowd) return;
    const { items, bodyMat, eyeMat } = crowd;
    const white = 0xffffff;
    // rally caps / cheering arms: campaign venues only (the Snowdome's 3000-strong crowd stays cheap)
    const rally = this.isRally && !brawlMode;
    const body = merge([
      colored(new THREE.BoxGeometry(0.46, 0.4, 0.36).translate(0, 0.22, 0), white),
      colored(new THREE.BoxGeometry(0.4, 0.32, 0.34).translate(0, 0.6, 0), white),
      colored(new THREE.BoxGeometry(0.34, 0.13, 0.02).translate(0, 0.62, 0.175), 0x1a1f2b),
      ...(rally
        ? []
        : [colored(new THREE.BoxGeometry(0.04, 0.16, 0.04).translate(0, 0.84, 0), 0x50555e), colored(new THREE.BoxGeometry(0.1, 0.1, 0.1).translate(0, 0.95, 0), white)]),
      // rally crowd: both arms up, cheering
      part(colored(new THREE.BoxGeometry(0.09, 0.32, 0.09).rotateZ(rally ? 2.6 : 0.4).translate(0.31, rally ? 0.86 : 0.56, 0), white), 1),
      part(colored(new THREE.BoxGeometry(0.09, 0.32, 0.09).rotateZ(rally ? -2.6 : -0.4).translate(-0.31, rally ? 0.86 : 0.56, 0), white), 2),
    ].map((g) => (g.getAttribute('aPart') ? g : part(g, 0))));
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
    // Quality preset (LOW): keep a deterministic share of the crowd. The full list, its bob phases and the rally cap
    // colours are all drawn first, exactly as on HIGH, so this.rnd's stream (and everything built after) is unchanged.
    // NIGHT: a packed house. Never fewer than by day on the same quality (LOW keeps a larger share), plus the
    // fill-in spectators in the seats the day layout leaves empty (crowd.fill, appended after the day list).
    const frac = this.night ? Math.max(currentPreset().crowdFraction, NIGHT_CROWD_MIN) : currentPreset().crowdFraction;
    const keep = crowdKeep(items.length, frac);
    const pick = <T,>(list: T[]): T[] => (keep ? keep.map((i) => list[i]) : list);
    const fillKeep = crowdKeep(crowd.fill.length, frac);
    const fill = fillKeep ? fillKeep.map((i) => crowd.fill[i]) : crowd.fill;
    const fillPhase = fillKeep ? fillKeep.map((i) => crowd.fillPhases[i]) : crowd.fillPhases;
    const shown = [...pick(items), ...fill];
    const dayPhase = keep ? Float32Array.from(keep, (i) => phase[i]) : phase;
    const allPhase = new Float32Array(shown.length);
    allPhase.set(dayPhase);
    allPhase.set(fillPhase, dayPhase.length);
    const attr = new THREE.InstancedBufferAttribute(allPhase, 1);
    body.setAttribute('aPhase', attr);
    eyes.setAttribute('aPhase', attr);
    this.inst(body, bodyMat, shown);
    this.inst(eyes, eyeMat, shown.map((i) => ({ ...i, color: undefined })));
    if (rally) {
      // red rally caps (crown + brim) on most heads, a few white / navy
      const cap = merge([
        new THREE.CylinderGeometry(0.17, 0.215, 0.15, 10).translate(0, 0.83, -0.01),
        new THREE.BoxGeometry(0.36, 0.035, 0.2).translate(0, 0.77, 0.24),
      ]);
      cap.setAttribute('aPhase', attr);
      const capMat = this.bobify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65, flatShading: true }));
      const rnd = this.rnd;
      const capColor = (r: number) => (r < 0.86 ? 0xc8102e : r < 0.95 ? 0xffffff : 0x1f3b8c);
      const caps = pick(items.map((i) => ({ ...i, color: capColor(rnd()) })));
      for (const f of fill) caps.push({ ...f, color: capColor(this.nightRnd()) });
      this.inst(cap, capMat, caps);
    }
    if (this.glowPts) this.crowdLights(shown, allPhase);
  }

  /** NIGHT: phone torches / glow sticks held up in the crowd (most of the house) and camera flashes, each riding on
   *  its spectator's bob (same phase). All drawn from the night rng. */
  protected crowdLights(shown: Item[], phase: Float32Array): void {
    const g = this.glowPts!;
    const r = this.nightRnd;
    const glow = this.nightDef?.glow ?? this.style.accents;
    for (let i = 0; i < shown.length; i++) {
      const it = shown[i];
      const k = r();
      if (k > 0.72) continue;
      const s = it.sy;
      const side = r() < 0.5 ? -1 : 1;
      const fx = Math.sin(it.ry);
      const fz = Math.cos(it.ry);
      // held up beside the head, a little in front
      const x = it.x + fx * 0.25 * s + fz * side * 0.3 * s;
      const z = it.z + fz * 0.25 * s - fx * side * 0.3 * s;
      if (k < 0.08) g.add(x, it.y + 1.05 * s, z, 0xffffff, 3.2 * s, GLOW_FLASH, phase[i], 2.2);
      else if (k < 0.45) g.add(x, it.y + 1.12 * s, z, 0xfff6e8, 0.95 * s, GLOW_PHONE, phase[i], 2.0);
      else g.add(x, it.y + 1.12 * s, z, glow[(r() * glow.length) | 0], 1.15 * s, GLOW_PHONE, phase[i], 2.2);
    }
  }

  protected crowdColor(): number {
    const pal = this.style.accents;
    const r = this.rnd();
    if (this.isRally) return r < 0.38 ? 0xc8102e : r < 0.7 ? 0xf4f4f0 : r < 0.92 ? 0x1f3b8c : 0xf2c033;
    if (r < 0.55) return pal[(this.rnd() * pal.length) | 0];
    const greys = [0x9aa4b0, 0x6a7380, 0xd8dde3, 0x3a4250];
    return greys[(this.rnd() * greys.length) | 0];
  }

  /** One shared material for every crowd sign and wall banner (the slogan atlas). */
  protected signMaterial(): THREE.MeshStandardMaterial {
    return (this.signMat ??= this.std(0xffffff, { map: getSignAtlas(), roughness: 0.7, side: THREE.DoubleSide, flatShading: false, emissive: 0xffffff, emissiveMap: getSignAtlas(), emissiveIntensity: 0.18 }));
  }

  /** Bake slogan planes (w x h) into the zone batch; `sticks` adds a handle under each (crowd signs). */
  protected bakeSigns(signs: { x: number; y: number; z: number; ry: number; i: number }[], w: number, h: number, sticks: boolean): void {
    if (signs.length === 0) return;
    const mat = this.signMaterial();
    const geos = new Map<number, THREE.BufferGeometry>();
    const stick = new THREE.BoxGeometry(0.05, 0.75, 0.05).translate(0, -h / 2 - 0.3, -0.02);
    const stickMat = this.std(0xd8c9a8, { roughness: 0.8 });
    for (const sg of signs) {
      let g = geos.get(sg.i);
      if (!g) geos.set(sg.i, (g = signPlane(w, h, sg.i)));
      const m = this.itemMatrix({ x: sg.x, y: sg.y, z: sg.z, ry: sg.ry, rx: -0.12, sx: 1, sy: 1, sz: 1 });
      this.bake(g, m, mat);
      if (sticks) this.bake(stick, m, stickMat);
    }
    for (const g of geos.values()) g.dispose();
    stick.dispose();
  }

}
