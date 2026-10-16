import * as THREE from 'three';

/* Pooled jagged lightning bolts (VOLT-9): each bolt is a thin additive ribbon that faces up-ish, re-jittered
 * every frame while it lives, plus a brighter core line. Cheap enough to fire dozens per second. */

const SEGMENTS = 10;
const POOL = 48;

interface Bolt {
  glow: THREE.Mesh;
  core: THREE.Line;
  a: THREE.Vector3;
  b: THREE.Vector3;
  life: number;
  max: number;
  width: number;
  jag: number;
}

const _d = new THREE.Vector3();
const _side = new THREE.Vector3();
const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Lightning {
  private bolts: Bolt[] = [];
  private glowMat = new THREE.MeshBasicMaterial({ color: 0x5fd0ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  private coreMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  private next = 0;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < POOL; i++) {
      const gGeo = new THREE.BufferGeometry();
      gGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEGMENTS + 1) * 2 * 3), 3));
      const idx: number[] = [];
      for (let s = 0; s < SEGMENTS; s++) {
        const a = s * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      gGeo.setIndex(idx);
      const glow = new THREE.Mesh(gGeo, this.glowMat.clone());
      glow.frustumCulled = false;
      glow.renderOrder = 8;
      const cGeo = new THREE.BufferGeometry();
      cGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEGMENTS + 1) * 3), 3));
      const core = new THREE.Line(cGeo, this.coreMat.clone());
      core.frustumCulled = false;
      core.renderOrder = 9;
      glow.visible = core.visible = false;
      scene.add(glow, core);
      this.bolts.push({ glow, core, a: new THREE.Vector3(), b: new THREE.Vector3(), life: 0, max: 1, width: 0.25, jag: 0.6 });
    }
  }

  /** Fire a bolt from a to b. `life` seconds, `width` of the glow ribbon, `jag` sideways jitter (m). */
  bolt(a: THREE.Vector3, b: THREE.Vector3, opts?: { life?: number; width?: number; jag?: number; color?: number }): void {
    const bolt = this.bolts[this.next];
    this.next = (this.next + 1) % POOL;
    bolt.a.copy(a);
    bolt.b.copy(b);
    bolt.max = bolt.life = opts?.life ?? 0.18;
    bolt.width = opts?.width ?? 0.28;
    bolt.jag = opts?.jag ?? Math.min(1.2, a.distanceTo(b) * 0.12 + 0.2);
    (bolt.glow.material as THREE.MeshBasicMaterial).color.setHex(opts?.color ?? 0x5fd0ff);
    bolt.glow.visible = bolt.core.visible = true;
    this.shape(bolt);
  }

  private shape(bolt: Bolt): void {
    _d.subVectors(bolt.b, bolt.a);
    _side.crossVectors(_d, UP);
    if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0);
    _side.normalize();
    const gp = bolt.glow.geometry.getAttribute('position') as THREE.BufferAttribute;
    const cp = bolt.core.geometry.getAttribute('position') as THREE.BufferAttribute;
    const k = bolt.life / bolt.max;
    const w = bolt.width * (0.5 + 0.5 * k);
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const ends = i === 0 || i === SEGMENTS;
      const j = ends ? 0 : (Math.random() - 0.5) * 2 * bolt.jag * Math.sin(t * Math.PI);
      const jy = ends ? 0 : (Math.random() - 0.5) * bolt.jag * 0.8;
      _p.copy(bolt.a).addScaledVector(_d, t).addScaledVector(_side, j);
      _p.y += jy;
      cp.setXYZ(i, _p.x, _p.y, _p.z);
      gp.setXYZ(i * 2, _p.x - _side.x * w, _p.y + w, _p.z - _side.z * w);
      gp.setXYZ(i * 2 + 1, _p.x + _side.x * w, _p.y - w, _p.z + _side.z * w);
    }
    gp.needsUpdate = true;
    cp.needsUpdate = true;
  }

  update(dt: number): void {
    for (const bolt of this.bolts) {
      if (bolt.life <= 0) continue;
      bolt.life -= dt;
      if (bolt.life <= 0) {
        bolt.glow.visible = bolt.core.visible = false;
        continue;
      }
      const k = bolt.life / bolt.max;
      (bolt.glow.material as THREE.MeshBasicMaterial).opacity = 0.85 * k;
      (bolt.core.material as THREE.LineBasicMaterial).opacity = Math.min(1, 1.4 * k);
      // Re-jitter every frame so bolts crackle.
      this.shape(bolt);
    }
  }

  clear(): void {
    for (const bolt of this.bolts) {
      bolt.life = 0;
      bolt.glow.visible = bolt.core.visible = false;
    }
  }
}
