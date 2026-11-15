import * as THREE from 'three';

/**
 * Visible stand-ins for objects kept hidden in the scene until they are needed (a finale's giant, pooled props): a
 * warm-up (render/warmup.ts) compiles only what is visible (three's compile walks traverseVisible), so each hidden
 * Mesh / InstancedMesh / Points / Sprite gets one off-scene twin per material sharing its geometry and material. Build
 * them once (at Game construction, with the rest of the warm set): creating objects draws three's UUIDs.
 */
export function standIns(roots: readonly (THREE.Object3D | null | undefined)[]): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    root?.traverse((o) => {
      const mats = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!mats) return;
      for (const m of Array.isArray(mats) ? mats : [mats]) {
        const kind = (o as THREE.Points).isPoints ? 'p' : (o as THREE.Sprite).isSprite ? 's' : (o as THREE.InstancedMesh).isInstancedMesh ? 'i' : (o as THREE.Mesh).isMesh ? 'm' : '';
        if (!kind) continue;
        const key = `${kind}:${m.uuid}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const geo = (o as THREE.Mesh).geometry;
        if (kind === 'p') out.push(new THREE.Points(geo, m));
        else if (kind === 's') out.push(new THREE.Sprite(m as THREE.SpriteMaterial));
        else if (kind === 'i') {
          const im = new THREE.InstancedMesh(geo, m, 1);
          im.count = 1;
          out.push(im);
        } else out.push(new THREE.Mesh(geo, m));
      }
    });
  }
  return out;
}
