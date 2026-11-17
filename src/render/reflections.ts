import * as THREE from 'three';
import { look } from './look';

/* Reflection map for the mirror paints (Ice Chrome, Champion Gold). Metals have almost no diffuse colour, so
 * without something to reflect they render flat and dark. This is a tiny procedural "snow world": deep blue sky
 * overhead, a bright snow horizon over dark mountains and ground, a hot sun spot and two light strips for
 * highlights. It is pre-filtered once with PMREM and only the player's plow paint uses it.
 *
 * With the arena reflections on (render/look.ts env; render/arenaEnv.ts) the paints reflect the ARENA instead: this
 * returns null, so they take scene.environment (the arena map) like every other standard material. Not the arena
 * texture itself: a material's own envMap carries its envMapIntensity into the ambient light too (gloss paints use
 * 0.3), and with the arena map the env IS the ambient, so a paint holding it would go dark. */

let envTex: THREE.Texture | null = null;

export function getPaintEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture | null {
  if (look.env) return null;
  if (envTex) return envTex;
  const scene = new THREE.Scene();
  const sky = new THREE.SphereGeometry(10, 32, 16);
  const pos = sky.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0x14305e);
  const horizon = new THREE.Color(0xdbe7f6);
  const ground = new THREE.Color(0x7d8a9c);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 10;
    if (y >= 0) c.lerpColors(horizon, top, Math.pow(y, 0.6));
    else c.lerpColors(horizon, ground, Math.min(1, -y * 4));
    c.toArray(col, i * 3);
  }
  sky.setAttribute('color', new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Mesh(sky, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  // Sun hotspot + a darker band of distant mountains, so the mirror has contrast to show off.
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(30, 27, 22) }));
  sun.position.set(4.5, 7.5, 5.5);
  scene.add(sun);
  const ridge = new THREE.Mesh(
    new THREE.CylinderGeometry(9.5, 9.5, 1.6, 48, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x1e2633, side: THREE.BackSide }),
  );
  ridge.position.y = 0.6;
  scene.add(ridge);
  // Two bright light strips (like a studio softbox) so flat panels pick up sharp highlights from most angles.
  const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 6), side: THREE.DoubleSide });
  for (const [x, y, z, ry] of [[-7, 4, 2, 1.2], [6, 2.5, -6, -0.7]]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 7), stripMat);
    strip.position.set(x, y, z);
    strip.rotation.set(0, ry, 0.35);
    scene.add(strip);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  envTex = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  return envTex;
}
