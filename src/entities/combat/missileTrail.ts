/**
 * Missile trails: a short white-hot exhaust flare right behind the nozzle and a long smoke ribbon that widens and
 * lingers after the missile is gone. Both are camera-facing ribbons rebuilt from a ring buffer of recent positions
 * (one small dynamic buffer each, no per-frame allocation).
 */
import * as THREE from 'three';

/** Samples kept (one every SAMPLE_DT s), i.e. trail length in time. */
const SMOKE_SAMPLES = 72;
const FLARE_SAMPLES = 8;
const SAMPLE_DT = 0.022;
/** Smoke ribbon half-width at the nozzle and at the far end (m); how long it lingers after the missile dies (s). */
const SMOKE_W0 = 0.16;
const SMOKE_W1 = 0.85;
const SMOKE_LINGER = 1.6;
const FLARE_W = 0.3;

const _side = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _toCam = new THREE.Vector3();

class Ribbon {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly alpha: Float32Array;
  private readonly geo: THREE.BufferGeometry;
  constructor(private readonly n: number, mat: THREE.Material) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3);
    this.alpha = new Float32Array(n * 2);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    // 0 on one edge of the ribbon, 1 on the other: the shader fades both edges so it reads as soft smoke, not a sheet.
    const edge = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) edge[i * 2 + 1] = 1;
    this.geo.setAttribute('edge', new THREE.BufferAttribute(edge, 1));
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }
  /** Rebuild from points (newest first), half-widths and alphas per point. */
  build(pts: THREE.Vector3[], count: number, cam: THREE.Vector3, width: (k: number) => number, alpha: (k: number) => number): void {
    if (count < 2) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    for (let i = 0; i < this.n; i++) {
      const k = Math.min(i, count - 1);
      const p = pts[k];
      const q = pts[Math.min(k + 1, count - 1)];
      const r = pts[Math.max(k - 1, 0)];
      _dir.subVectors(r, q);
      if (_dir.lengthSq() < 1e-8) _dir.set(0, 0, 1);
      _toCam.subVectors(cam, p);
      _side.crossVectors(_dir, _toCam).normalize();
      const w = i < count ? width(i / (count - 1)) : 0;
      const a = i < count ? alpha(i / (count - 1)) : 0;
      const o = i * 6;
      this.pos[o] = p.x + _side.x * w;
      this.pos[o + 1] = p.y + _side.y * w;
      this.pos[o + 2] = p.z + _side.z * w;
      this.pos[o + 3] = p.x - _side.x * w;
      this.pos[o + 4] = p.y - _side.y * w;
      this.pos[o + 5] = p.z - _side.z * w;
      this.alpha[i * 2] = this.alpha[i * 2 + 1] = a;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose(): void {
    this.geo.dispose();
  }
}

/** Shared ribbon material: vertex alpha times a base colour/opacity. */
function ribbonMat(color: number, opacity: number, additive: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    vertexShader:
      'attribute float alpha; attribute float edge; varying float vA; varying float vE; void main(){ vA = alpha; vE = edge; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader:
      'uniform vec3 uColor; uniform float uOpacity; varying float vA; varying float vE; void main(){ float soft = sin(3.14159 * vE); gl_FragColor = vec4(uColor, vA * uOpacity * soft * soft); }',
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    toneMapped: false,
  });
}

let smokeMat: THREE.ShaderMaterial | null = null;
let flareMat: THREE.ShaderMaterial | null = null;

export class MissileTrail {
  private readonly pts: THREE.Vector3[] = [];
  private count = 0;
  private sampleT = 0;
  /** > 0 while the trail lingers after its missile is gone. */
  private linger = 0;
  private burning = false;
  private readonly smoke: Ribbon;
  private readonly flare: Ribbon;

  constructor(scene: THREE.Scene) {
    smokeMat ??= ribbonMat(0x6f747c, 0.85, false); // mid-grey: reads on white snow and against the sky
    flareMat ??= ribbonMat(0xffa030, 1, true);
    for (let i = 0; i < SMOKE_SAMPLES; i++) this.pts.push(new THREE.Vector3());
    this.smoke = new Ribbon(SMOKE_SAMPLES, smokeMat);
    this.flare = new Ribbon(FLARE_SAMPLES, flareMat);
    this.smoke.mesh.renderOrder = 2;
    this.flare.mesh.renderOrder = 3;
    scene.add(this.smoke.mesh, this.flare.mesh);
  }

  /** Motor lit at `p`: start a fresh trail. */
  start(p: THREE.Vector3): void {
    this.count = 1;
    this.pts[0].copy(p);
    this.sampleT = 0;
    this.linger = 0;
    this.burning = true;
  }

  /** Missile gone (exploded): the smoke lingers and fades, the flare goes out. */
  stop(): void {
    if (!this.burning) return;
    this.burning = false;
    this.linger = SMOKE_LINGER;
    this.flare.mesh.visible = false;
  }

  /** Hard reset (arena change). */
  clear(): void {
    this.burning = false;
    this.linger = 0;
    this.count = 0;
    this.smoke.mesh.visible = this.flare.mesh.visible = false;
  }

  /** Per frame. `nozzle` = the missile's tail position while burning; `cam` = the camera position. */
  update(dt: number, nozzle: THREE.Vector3 | null, cam: THREE.Vector3): void {
    if (!this.burning && this.linger <= 0) return;
    if (this.burning && nozzle) {
      this.sampleT -= dt;
      if (this.sampleT <= 0) {
        this.sampleT += SAMPLE_DT;
        // Shift: newest at index 0.
        const last = this.pts[SMOKE_SAMPLES - 1];
        for (let i = SMOKE_SAMPLES - 1; i > 0; i--) this.pts[i] = this.pts[i - 1];
        this.pts[0] = last;
        this.count = Math.min(SMOKE_SAMPLES, this.count + 1);
      }
      this.pts[0].copy(nozzle);
    } else {
      this.linger -= dt;
      // Lingering smoke drifts up a touch.
      for (let i = 0; i < this.count; i++) this.pts[i].y += dt * 0.4;
    }
    const fade = this.burning ? 1 : Math.max(0, this.linger / SMOKE_LINGER);
    this.smoke.build(this.pts, this.count, cam, (k) => SMOKE_W0 + (SMOKE_W1 - SMOKE_W0) * k + (this.burning ? 0 : 0.3 * (1 - fade)), (k) => Math.pow(1 - k, 0.8) * fade * Math.min(1, k * 10 + 0.2));
    if (this.burning) {
      const n = Math.min(FLARE_SAMPLES, this.count);
      this.flare.build(this.pts, n, cam, (k) => FLARE_W * (1 - k * 0.8) * (0.85 + Math.random() * 0.3), (k) => 1 - k);
    }
    if (!this.burning && this.linger <= 0) this.smoke.mesh.visible = false;
  }

  dispose(): void {
    this.smoke.mesh.removeFromParent();
    this.flare.mesh.removeFromParent();
    this.smoke.dispose();
    this.flare.dispose();
  }
}
