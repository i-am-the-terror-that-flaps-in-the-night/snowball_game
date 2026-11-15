import * as THREE from 'three';

/* PROTOCOL C echoes are HOLOGRAMS (docs/modes.md "Protocol C"): every painted / dark / accent part of the rig is drawn
 * with one translucent gold ShaderMaterial (scanlines in world height, a sweeping glitch band, a fresnel rim, a
 * flicker), while the eyes / glow strips / FROSTBYTE's snowball keep their own materials (they read through the
 * hologram).
 *
 * No mid-fight shader compiles: every rig's hologram material is a clone of one template (same source = one GL
 * program per variant), and the two variants a rig can need (plain mesh, instanced wheel sets) are compiled by every
 * arena build's warm-up through holoWarmSet() (EnemyManager.warmSet -> Game.warmExtras, render/warmup.ts). The
 * material is unlit (lights: false) but three keys every program on the scene's light counts, so the warm-up's
 * light states cover it like any other extra. */

/** Shared clock (EnemyManager advances it every frame). */
export const holoTime = { value: 0 };

/** Hologram gold. */
export const HOLO_GOLD = new THREE.Color(0xffb526);

const VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vW;
  void main() {
    vec3 transformed = position;
    vec3 objectNormal = normal;
    #ifdef USE_INSTANCING
      objectNormal = mat3(instanceMatrix) * objectNormal;
      transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
    #endif
    vec4 wp = modelMatrix * vec4(transformed, 1.0);
    vW = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    vN = normalize(normalMatrix * objectNormal);
    vV = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const FRAG = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform vec3 uColor;
  /** 0..1 hit flash, glow boost (flicker / held on the leash / wind-up), overall opacity, per-bot phase. */
  uniform float uFlash;
  uniform float uBoost;
  uniform float uAlpha;
  uniform float uSeed;
  uniform float uBase;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vW;
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(vV);
    float facing = abs(dot(n, v));
    float fres = pow(1.0 - facing, 2.2);
    float y = vW.y - uBase;
    // fine scanlines crawling upward + a bright line every few
    float sl = fract(y * 11.0 - uTime * 1.3);
    float scan = 0.62 + 0.38 * smoothstep(0.15, 0.5, abs(sl - 0.5));
    float line = smoothstep(0.92, 1.0, fract(y * 2.2 - uTime * 0.7 + uSeed));
    // a glitch band sweeping up the body every ~2.5 s
    float sweep = mod(uTime * 1.25 + uSeed * 3.0, 3.2) - 0.4;
    float band = 1.0 - smoothstep(0.0, 0.22, abs(y - sweep));
    // shape still reads: lit from above in view space
    float shade = 0.55 + 0.45 * clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 c = uColor * (0.42 * shade * scan + line * 0.5 + band * 0.6);
    c += mix(uColor, vec3(1.0, 0.93, 0.7), 0.3) * fres * 1.6;
    c *= 1.0 + uBoost;
    c += vec3(uFlash);
    float a = clamp(0.32 + fres * 0.6 + line * 0.25 + band * 0.3 + uFlash * 0.5, 0.0, 0.9) * uAlpha;
    gl_FragColor = vec4(max(c, vec3(0.0)), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

let template: THREE.ShaderMaterial | null = null;
function base(): THREE.ShaderMaterial {
  return (template ??= new THREE.ShaderMaterial({
    name: 'hologram',
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: holoTime,
      uColor: { value: HOLO_GOLD.clone() },
      uFlash: { value: 0 },
      uBoost: { value: 0 },
      uAlpha: { value: 1 },
      uSeed: { value: 0 },
      uBase: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    fog: true,
  }));
}

/** A rig's own hologram material (same program as every other: a clone of the template, the clock shared). */
export function hologramMaterial(seed = 0): THREE.ShaderMaterial {
  const m = base().clone();
  m.uniforms.uTime = holoTime;
  m.uniforms.uSeed.value = seed;
  return m;
}

/** Materials that stay as they are on a hologram: lit-up parts (eyes, glow strips) and the snowball. */
const KEEP_ROLES = new Set(['eye', 'glow', 'ball']);

/** Turn a freshly built rig root into a hologram: every visible part (not shadow proxies, not the eyes / glow / ball,
 *  not the ice crust or the dizzy stars: `skip`) is drawn with `mat`. Returns the number of meshes swapped. */
export function applyHologram(root: THREE.Object3D, mat: THREE.ShaderMaterial, skip: readonly THREE.Object3D[] = []): number {
  let n = 0;
  const skipSet = new Set(skip);
  const visit = (o: THREE.Object3D): void => {
    if (skipSet.has(o)) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !(o as { isShadowProxy?: boolean }).isShadowProxy && !Array.isArray(mesh.material)) {
      const m = mesh.material as THREE.Material;
      const role = m.userData?.inst as string | undefined;
      if (m.name !== 'shadowProxy' && m.colorWrite !== false && !(role && KEEP_ROLES.has(role))) {
        mesh.material = mat;
        n++;
      }
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  return n;
}

let warm: THREE.Object3D[] | null = null;
/** Warm-up stand-ins (render/warmup.ts): one plain and one instanced mesh with the hologram material, off-scene. */
export function holoWarmSet(): THREE.Object3D[] {
  if (!warm) {
    const g = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const m = hologramMaterial();
    const im = new THREE.InstancedMesh(g, m, 1);
    im.count = 0;
    warm = [new THREE.Mesh(g, m), im];
  }
  return warm;
}
