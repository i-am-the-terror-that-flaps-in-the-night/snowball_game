/** Standalone arena 6 scene for scripts/omega-preview.mjs: decks, set dressing and terrain-shaped snow, no game. */
import * as THREE from 'three';
import { Terrain } from '../../src/world/Terrain';
import { OMEGA_HALF, OMEGA_TERRAIN } from '../../src/world/omega/layout';
import { OmegaWorks } from '../../src/world/omega/OmegaWorks';
import { OmegaSet } from '../../src/world/omega/OmegaSet';
import { OMEGA_LOOK } from '../../src/world/omega/zone';

const W = innerWidth;
const H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(OMEGA_LOOK.skyBottom);
scene.fog = new THREE.Fog(OMEGA_LOOK.fogColor, OMEGA_LOOK.fogNear, OMEGA_LOOK.fogFar);
scene.add(new THREE.HemisphereLight(OMEGA_LOOK.skyTop, OMEGA_LOOK.ambientColor, OMEGA_LOOK.ambientIntensity * 1.4));
const sun = new THREE.DirectionalLight(OMEGA_LOOK.sunColor, OMEGA_LOOK.sunIntensity);
sun.position.set(-60, 90, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -100, right: 100, top: 100, bottom: -100, far: 300 });
scene.add(sun);

const terrain = new Terrain(OMEGA_TERRAIN);
const N = 160;
const g = new THREE.PlaneGeometry(OMEGA_HALF * 2, OMEGA_HALF * 2, N, N);
g.rotateX(-Math.PI / 2);
const p = g.attributes.position as THREE.BufferAttribute;
for (let i = 0; i < p.count; i++) p.setY(i, terrain.ground(p.getX(i), p.getZ(i)));
g.computeVertexNormals();
const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: OMEGA_LOOK.snowTint, roughness: 0.9 }));
ground.receiveShadow = true;
scene.add(ground);

const works = new OmegaWorks(terrain);
const set = new OmegaSet(terrain);
scene.add(works.group, set.group);
set.update(1);
const camera = new THREE.PerspectiveCamera(55, W / H, 0.5, 900);

type V3 = [number, number, number];
(window as unknown as { __shot: (pos: V3, look: V3, focus?: V3) => void }).__shot = (pos, look, focus) => {
  camera.position.set(...pos);
  camera.lookAt(...look);
  const f = focus ?? [pos[0], pos[1] - 2, pos[2]];
  for (let k = 0; k < 30; k++) works.update(1 / 30, f[0], f[1], f[2]);
  renderer.render(scene, camera);
};
(window as unknown as { __ready: boolean }).__ready = true;
