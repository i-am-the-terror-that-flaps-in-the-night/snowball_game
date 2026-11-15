import * as THREE from 'three';

/* Pooled jagged lightning bolts (VOLT-9): each bolt is a coloured additive glow ribbon that faces up-ish, a narrow
 * white-hot core ribbon inside it and a 1 px core line (so it never vanishes at range), re-jittered every frame while
 * it lives and flickering as it fades. Cheap enough to fire dozens per second. */

const SEGMENTS = 10;
/** Sized for the SUPERCELL (a wave of strikes on every bot + its constant storm strikes) on top of ARC LANCE chains,
 *  so a new wave never overwrites bolts still on screen. */
const POOL = 96;
/** Core ribbon width as a share of the glow ribbon's. */
const CORE_SHARE = 0.28;

interface Bolt {
  glow: THREE.Mesh;
  hot: THREE.Mesh;
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

function ribbonGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEGMENTS + 1) * 2 * 3), 3));
  const idx: number[] = [];
  for (let s = 0; s < SEGMENTS; s++) {
    const a = s * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  g.setIndex(idx);
  return g;
}

export class Lightning {
  private bolts: Bolt[] = [];
  private glowMat = new THREE.MeshBasicMaterial({ color: 0x5fd0ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  private hotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  private coreMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  private next = 0;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < POOL; i++) {
      const glow = new THREE.Mesh(ribbonGeometry(), this.glowMat.clone());
      glow.frustumCulled = false;
      glow.renderOrder = 8;
      const hot = new THREE.Mesh(ribbonGeometry(), this.hotMat.clone());
      hot.frustumCulled = false;
      hot.renderOrder = 9;
      const cGeo = new THREE.BufferGeometry();
      cGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEGMENTS + 1) * 3), 3));
      const core = new THREE.Line(cGeo, this.coreMat.clone());
      core.frustumCulled = false;
      core.renderOrder = 9;
      glow.visible = hot.visible = core.visible = false;
      scene.add(glow, hot, core);
      this.bolts.push({ glow, hot, core, a: new THREE.Vector3(), b: new THREE.Vector3(), life: 0, max: 1, width: 0.25, jag: 0.6 });
    }
  }

  /** Fire a bolt from a to b. `life` seconds, `width` of the glow ribbon, `jag` sideways jitter (m). */
  bolt(a: THREE.Vector3, b: THREE.Vector3, opts?: { life?: number; width?: number; jag?: number; color?: number }): void {
    // Take the next free bolt; when all are busy, the one closest to done (never one that just fired).
    let bolt = this.bolts[this.next];
    if (bolt.life > 0) {
      for (let k = 1; k < POOL; k++) {
        const c = this.bolts[(this.next + k) % POOL];
        if (c.life <= 0) {
          bolt = c;
          this.next = (this.next + k) % POOL;
          break;
        }
      }
    }
    this.next = (this.next + 1) % POOL;
    bolt.a.copy(a);
    bolt.b.copy(b);
    bolt.max = bolt.life = opts?.life ?? 0.18;
    bolt.width = opts?.width ?? 0.28;
    bolt.jag = opts?.jag ?? Math.min(1.2, a.distanceTo(b) * 0.12 + 0.2);
    (bolt.glow.material as THREE.MeshBasicMaterial).color.setHex(opts?.color ?? 0x5fd0ff);
    bolt.glow.visible = bolt.hot.visible = bolt.core.visible = true;
    this.paint(bolt, 1);
    this.shape(bolt);
  }

  private shape(bolt: Bolt): void {
    _d.subVectors(bolt.b, bolt.a);
    _side.crossVectors(_d, UP);
    if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0);
    _side.normalize();
    const gp = bolt.glow.geometry.getAttribute('position') as THREE.BufferAttribute;
    const hp = bolt.hot.geometry.getAttribute('position') as THREE.BufferAttribute;
    const cp = bolt.core.geometry.getAttribute('position') as THREE.BufferAttribute;
    const k = bolt.life / bolt.max;
    const w = bolt.width * (0.55 + 0.45 * k);
    const wc = w * CORE_SHARE;
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
      hp.setXYZ(i * 2, _p.x - _side.x * wc, _p.y + wc, _p.z - _side.z * wc);
      hp.setXYZ(i * 2 + 1, _p.x + _side.x * wc, _p.y - wc, _p.z + _side.z * wc);
    }
    gp.needsUpdate = true;
    hp.needsUpdate = true;
    cp.needsUpdate = true;
  }

  /** Opacity at life share `k` (1 = just fired): stays bright for most of its life, flickering, then drops. */
  private paint(bolt: Bolt, k: number): void {
    const flick = 0.7 + 0.3 * Math.random();
    const e = Math.sqrt(k);
    (bolt.glow.material as THREE.MeshBasicMaterial).opacity = 0.9 * e * flick;
    (bolt.hot.material as THREE.MeshBasicMaterial).opacity = Math.min(1, 1.3 * e) * flick;
    (bolt.core.material as THREE.LineBasicMaterial).opacity = Math.min(1, 1.4 * k);
  }

  update(dt: number): void {
    for (const bolt of this.bolts) {
      if (bolt.life <= 0) continue;
      bolt.life -= dt;
      if (bolt.life <= 0) {
        bolt.glow.visible = bolt.hot.visible = bolt.core.visible = false;
        continue;
      }
      this.paint(bolt, bolt.life / bolt.max);
      // Re-jitter every frame so bolts crackle.
      this.shape(bolt);
    }
  }

  clear(): void {
    for (const bolt of this.bolts) {
      bolt.life = 0;
      bolt.glow.visible = bolt.hot.visible = bolt.core.visible = false;
    }
  }
}
