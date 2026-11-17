import * as THREE from 'three';

/* Detail kit: WEAR (art pass, docs/art-pass.md). A small shader patch for MeshStandardMaterials that gives flat-coloured
 * models a finished, used look without textures, UVs or extra draws:
 *   - GRIME: darker and rougher toward the bottom of the model (object space y 0 .. GRIME_H m), a soft two-tone;
 *   - MOTTLE: large, faint colour / roughness variation (3D value noise in object space, so it sticks to the model);
 *   - SCUFFS: small bare-metal scratches (thresholded fine noise) that lighten and smooth the surface.
 * Everything is computed from the object-space vertex position (the template's merged geometry), so it never swims
 * as the model moves. Strengths are per material (a uniform); the program is shared (one cache key), so wearing
 * materials add at most one program per base material kind. Clone-safe through copyWear(). */

export interface WearProfile {
  /** 0..1: how much darker the bottom gets. */
  grime: number;
  /** 0..0.3: colour variation amplitude. */
  mottle: number;
  /** 0..1: scuff coverage. */
  scuff: number;
  /** Object-space height (m) the grime fades out at. */
  grimeH?: number;
}

const KEY = 'kitWear1';
const KEY_FRAME = 'kitWear1f';

const NOISE = /* glsl */ `
float kwHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float kwNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(kwHash(i), kwHash(i + vec3(1,0,0)), f.x), mix(kwHash(i + vec3(0,1,0)), kwHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(kwHash(i + vec3(0,0,1)), kwHash(i + vec3(1,0,1)), f.x), mix(kwHash(i + vec3(0,1,1)), kwHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`;

/** Grime measured in a parent's space instead of the part's own: `value` = the inverse of that parent's world matrix,
 *  kept current by the caller (vehicles: the plow body, so a turret or an arm high up is not grimed like a wheel
 *  arch). The noise stays in object space (it sticks to the part). */
export interface WearFrame {
  value: THREE.Matrix4;
}

/** Install the wear patch on `m` (idempotent). With `frame`, the grime height is read in that frame (see WearFrame). */
export function applyWear(m: THREE.MeshStandardMaterial, p: WearProfile, frame?: WearFrame): THREE.MeshStandardMaterial {
  const u = { kwWear: { value: new THREE.Vector4(p.grime, p.mottle, p.scuff, p.grimeH ?? 0.75) } };
  m.userData.kitWear = u;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.kwWear = u.kwWear;
    if (frame) sh.uniforms.kwFrame = frame;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vKwPos;${frame ? '\nvarying float vKwY;\nuniform mat4 kwFrame;' : ''}`)
      .replace(
        '#include <begin_vertex>',
        frame
          ? `#include <begin_vertex>
        vKwPos = position;
        {
          vec4 kwP = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
          kwP = instanceMatrix * kwP;
          #endif
          vKwY = (kwFrame * modelMatrix * kwP).y;
        }`
          : '#include <begin_vertex>\nvKwPos = position;',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vKwPos;${frame ? '\nvarying float vKwY;' : '\n#define vKwY vKwPos.y'}\nuniform vec4 kwWear;\n${NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float kwN = kwNoise(vKwPos * 2.3);
        float kwF = kwNoise(vKwPos * 6.5 + 7.3);
        float kwG = (1.0 - smoothstep(0.0, kwWear.w, vKwY)) * kwWear.x;
        float kwS = smoothstep(0.8, 0.9, kwF) * kwWear.z * smoothstep(0.45, 0.7, kwN);
        diffuseColor.rgb *= (1.0 - kwG * 0.62) * (1.0 + (kwN - 0.5) * 2.0 * kwWear.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.52, 0.55), kwS * 0.35);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + kwG * 0.25 + (kwN - 0.5) * kwWear.y * 1.5 - kwS * 0.3, 0.04, 1.0);`,
      );
  };
  m.customProgramCacheKey = frame ? () => KEY_FRAME : () => KEY;
  return m;
}

/** After `material.clone()`: carry the patch over (clone() does not copy onBeforeCompile). */
export function copyWear(from: THREE.Material, to: THREE.Material): void {
  if (from.userData.kitWear) {
    to.onBeforeCompile = from.onBeforeCompile;
    to.customProgramCacheKey = from.customProgramCacheKey;
    to.userData.kitWear = from.userData.kitWear;
  }
}
