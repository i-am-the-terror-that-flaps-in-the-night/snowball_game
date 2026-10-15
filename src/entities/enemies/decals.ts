import * as THREE from 'three';

/* Ground telegraph decals owned by the EnemyManager: red chevron path stripes for charges/dashes and
 * warning rings (outline + filling disc) for AOE spins / pounds / swipes. Each decal is a small grid
 * mesh whose vertices are re-draped over the snow surface every frame so it never sinks into snow. */

export type DepthFn = (x: number, z: number) => number;

const LIFT = 0.08;
let _chevron: THREE.Texture | null = null;
function chevronTexture(): THREE.Texture {
  if (_chevron) return _chevron;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 6, 64);
  g.fillRect(58, 0, 6, 64);
  g.beginPath();
  g.moveTo(8, 18);
  g.lineTo(32, 46);
  g.lineTo(56, 18);
  g.lineTo(56, 30);
  g.lineTo(32, 58);
  g.lineTo(8, 30);
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  _chevron = t;
  return t;
}

export class Decal {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.MeshBasicMaterial;
  private geo: THREE.BufferGeometry;
  private pos: THREE.BufferAttribute;
  private uv: THREE.BufferAttribute;
  active = false;
  // stripe params
  x = 0;
  z = 0;
  dx = 0;
  dz = 1;
  len = 1;
  w = 1;
  // ring params
  r0 = 0;
  r1 = 1;

  constructor(
    readonly kind: 'stripe' | 'ring',
    readonly nu: number,
    readonly nv: number,
  ) {
    const count = nu * nv;
    this.geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    this.uv = new THREE.BufferAttribute(new Float32Array(count * 2), 2);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.pos);
    this.geo.setAttribute('uv', this.uv);
    const idx: number[] = [];
    for (let v = 0; v < nv - 1; v++)
      for (let u = 0; u < nu - 1; u++) {
        const a = v * nu + u;
        const b = a + 1;
        const c = a + nu;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    this.geo.setIndex(idx);
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xff2a1a,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      map: kind === 'stripe' ? chevronTexture() : null,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
  }

  /** Re-drape the decal over the snow. */
  rebuild(depth: DepthFn): void {
    const p = this.pos.array as Float32Array;
    const t = this.uv.array as Float32Array;
    const { nu, nv } = this;
    let i = 0;
    let j = 0;
    if (this.kind === 'stripe') {
      const rx = this.dz;
      const rz = -this.dx;
      for (let v = 0; v < nv; v++) {
        const along = (v / (nv - 1)) * this.len;
        for (let u = 0; u < nu; u++) {
          const across = (u / (nu - 1) - 0.5) * this.w;
          const x = this.x + this.dx * along + rx * across;
          const z = this.z + this.dz * along + rz * across;
          p[i++] = x;
          p[i++] = depth(x, z) + LIFT;
          p[i++] = z;
          t[j++] = u / (nu - 1);
          t[j++] = -along / Math.max(1.2, this.w * 0.9);
        }
      }
    } else {
      for (let v = 0; v < nv; v++) {
        const r = this.r0 + ((this.r1 - this.r0) * v) / (nv - 1);
        for (let u = 0; u < nu; u++) {
          const a = (u / (nu - 1)) * Math.PI * 2;
          const x = this.x + Math.sin(a) * r;
          const z = this.z + Math.cos(a) * r;
          p[i++] = x;
          p[i++] = depth(x, z) + LIFT;
          p[i++] = z;
          t[j++] = u / (nu - 1);
          t[j++] = v / (nv - 1);
        }
      }
    }
    this.pos.needsUpdate = true;
    this.uv.needsUpdate = true;
  }
}

export class DecalPool {
  private all: Decal[] = [];
  private scroll = 0;

  constructor(private scene: THREE.Scene) {}

  private acquire(kind: 'stripe' | 'ring', nu: number, nv: number): Decal {
    for (const d of this.all) if (!d.active && d.kind === kind && d.nv === nv) return this.activate(d);
    const d = new Decal(kind, nu, nv);
    this.scene.add(d.mesh);
    this.all.push(d);
    return this.activate(d);
  }

  private activate(d: Decal): Decal {
    d.active = true;
    d.mesh.visible = true;
    d.mat.opacity = 0;
    return d;
  }

  stripe(): Decal {
    return this.acquire('stripe', 3, 18);
  }
  /** `fill` rings use more radial rows (a filled disc); outlines use 2. */
  ring(fill: boolean): Decal {
    return this.acquire('ring', 49, fill ? 4 : 2);
  }

  release(d: Decal | null): null {
    if (d) {
      d.active = false;
      d.mesh.visible = false;
    }
    return null;
  }

  update(dt: number, depth: DepthFn): void {
    this.scroll = (this.scroll + dt * 1.6) % 1;
    const tex = _chevron;
    if (tex) tex.offset.y = this.scroll;
    for (const d of this.all) if (d.active) d.rebuild(depth);
  }

  clear(): void {
    for (const d of this.all) this.release(d);
  }
}
