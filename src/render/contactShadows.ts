import * as THREE from 'three';
import type { GameContext, EnemyHandle } from '../core/types';
import { look, strength } from './look';
import { withPrivateRandom } from './privateRandom';

/* Contact shadows (art pass, docs/art-pass.md: "Dynamic models also get a soft contact-shadow patch underneath"): a
 * soft dark disc on the snow under the player's plow and every bot / Brawl rival, so they sit on the ground even where
 * the sun's shadow map is soft, off to the side or (LOW) off. One InstancedMesh, one draw, all tiers; it does not
 * cast or receive shadows. Each frame the patches follow their owners (position, size from the collision radius,
 * fading and shrinking with height above the snow). Built at the arena build only while render/look.ts contact is on
 * (so the warm-up compiles it); nothing is allocated per frame.
 * Not covered: the online Duel's opponent (ctx.enemies has no targets there). */

export const CONTACT = {
  /** Patch diameter per metre of collision radius. */
  scale: 3.4,
  /** Height (m) over the snow at which a patch has faded out. */
  fadeHeight: 3.5,
  /** Lift over the snow top (m), against z-fighting with the snow's bumps. */
  lift: 0.14,
  max: 64,
};

let blobTex: THREE.DataTexture | null = null;

/** Soft radial falloff (alpha), white. */
function blobTexture(): THREE.DataTexture {
  if (blobTex) return blobTex;
  const n = 64;
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = ((x + 0.5) / n) * 2 - 1;
      const v = ((y + 0.5) / n) * 2 - 1;
      const r = Math.min(1, Math.hypot(u, v));
      const q = 1 - r * r;
      const a = q * q;
      const i = (y * n + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(a * 255);
    }
  }
  blobTex = new THREE.DataTexture(d, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  blobTex.magFilter = blobTex.minFilter = THREE.LinearFilter;
  blobTex.generateMipmaps = false;
  blobTex.needsUpdate = true;
  return blobTex;
}

export class ContactShadows {
  readonly mesh: THREE.InstancedMesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly list: EnemyHandle[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(private readonly ctx: GameContext) {
    const { mesh, mat } = withPrivateRandom(() => {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, map: blobTexture(), transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      mat.name = 'contactShadow';
      // multiply the snow by (1 - alpha * k): dark, never coloured, never brighter
      mat.blending = THREE.CustomBlending;
      mat.blendEquation = THREE.AddEquation;
      mat.blendSrc = THREE.ZeroFactor;
      mat.blendDst = THREE.OneMinusSrcAlphaFactor;
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, CONTACT.max);
      mesh.name = 'contactShadows';
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = false;
      mesh.renderOrder = 1;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      return { mesh, mat };
    });
    this.mesh = mesh;
    this.mat = mat;
    ctx.scene.add(mesh);
  }

  private put(i: number, x: number, z: number, y: number, r: number): number {
    if (i >= CONTACT.max) return i;
    // on the snow top under it: plows and bots ride IN the snow (their feet are below its top), so that is the
    // surface seen around them; airborne, the patch shrinks with height
    const base = this.ctx.snow?.topAt(x, z) ?? 0;
    const h = Math.max(0, y - base);
    const f = Math.max(0, 1 - h / CONTACT.fadeHeight);
    if (f <= 0.01) return i;
    const size = r * CONTACT.scale * (0.35 + 0.65 * f);
    this.p.set(x, base + CONTACT.lift, z);
    this.s.set(size, size, 1);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    return i + 1;
  }

  update(): void {
    const on = look.contact;
    this.mesh.visible = on;
    if (!on) return;
    const k = strength().contact;
    // the blend multiplies the snow by (1 - alpha), alpha = blob x opacity
    this.mat.opacity = k;
    const ctx = this.ctx;
    let i = 0;
    const plow = ctx.plow;
    if (plow && !plow.dead) i = this.put(i, plow.position.x, plow.position.z, plow.position.y, plow.radius);
    const e = ctx.enemies;
    if (e && plow) {
      const list = e.query(plow.position.x, plow.position.z, 1e4, this.list);
      for (let n = 0; n < list.length; n++) {
        const b = list[n];
        if (b.alive) i = this.put(i, b.position.x, b.position.z, b.position.y, b.radius);
      }
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
