import * as THREE from 'three';

/* Paint Shop paint patterns (config/cosmetics.ts PaintDef.pattern): the 'pinstripe' look of "Hostile Takeover" (thin
 * gold lines on matte black, like an executive's suit). Drawn procedurally in the paint material's fragment shader
 * (no texture, no UVs: the plows are dozens of boxes / lathes / merged parts whose UVs don't share a scale), in the
 * plow BODY's own space, so the stripes keep one spacing on every panel of every plow and never slide as it drives:
 *  - side panels (normal mostly across the plow): vertical lines, repeating nose to tail;
 *  - roofs, bonnets and front / back faces: lines running nose to tail / upright, repeating across the plow.
 * A uniform toggles it, so switching paints never recompiles. `bodyInv` (world -> body) is refreshed once per rendered
 * frame from the material's onBeforeRender (after the scene's matrices are current; no allocation). */

/** Stripe spacing and half width (body metres). */
export const PINSTRIPE_SPACING = 0.17;
export const PINSTRIPE_HALF_W = 0.006;

/** Distance (m) from body-space coordinate `c` to the nearest stripe centre (pure; mirrors the shader; tests). */
export function pinstripeDistance(c: number, spacing = PINSTRIPE_SPACING): number {
  const f = c / spacing + 0.5;
  return Math.abs(f - Math.floor(f) - 0.5) * spacing;
}

/** Which body axis a face's stripes repeat along, from its body-space normal (0 = x across, 2 = z along; pure). */
export function pinstripeAxis(nx: number, ny: number, nz: number): 0 | 2 {
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  return ax > ay && ax > az ? 2 : 0;
}

export interface Pinstripe {
  /** 1 = pattern on. */
  readonly on: { value: number };
  readonly color: { value: THREE.Color };
  /** Set the pattern for the current paint (null = off). */
  set(color: number | null): void;
}

/** Patch a plow paint material for pinstripes; `body` is the object whose space the stripes live in. */
export function installPinstripe(mat: THREE.MeshStandardMaterial, body: THREE.Object3D): Pinstripe {
  const on = { value: 0 };
  const color = { value: new THREE.Color(0xd9ad3c) };
  const bodyInv = { value: new THREE.Matrix4() };
  let frame = -1;
  // Composes with a patch already on the material (the wear layer, render/kit/wear.ts): one onBeforeCompile runs
  // both, under a combined program key, and the earlier onBeforeRender keeps running.
  const prevCompile = mat.onBeforeCompile;
  const prevRender = mat.onBeforeRender;
  const prevKey = mat.userData.kitWear ? mat.customProgramCacheKey() : '';
  mat.onBeforeCompile = (sh, r) => {
    if (prevKey) prevCompile.call(mat, sh, r);
    sh.uniforms.uPinOn = on;
    sh.uniforms.uPinCol = color;
    sh.uniforms.uPinInv = bodyInv;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uPinInv;\nvarying vec3 vPinP;\nvarying vec3 vPinN;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  {
    mat4 pinM = uPinInv * modelMatrix;
    vPinP = (pinM * vec4(transformed, 1.0)).xyz;
    vPinN = mat3(pinM) * objectNormal;
  }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uPinOn;\nuniform vec3 uPinCol;\nvarying vec3 vPinP;\nvarying vec3 vPinN;\nfloat pinLine = 0.0;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  if (uPinOn > 0.5) {
    vec3 pn = abs(normalize(vPinN));
    float c = (pn.x > pn.y && pn.x > pn.z) ? vPinP.z : vPinP.x;
    float d = abs(fract(c / ${PINSTRIPE_SPACING.toFixed(4)} + 0.5) - 0.5) * ${PINSTRIPE_SPACING.toFixed(4)};
    float w = fwidth(c);
    // Thin and crisp up close; at a distance the line fades toward a faint gold sheen instead of shimmering.
    float hw = ${PINSTRIPE_HALF_W.toFixed(4)};
    pinLine = (1.0 - smoothstep(hw, hw + w, d)) * clamp(hw * 1.8 / max(w, 1e-5), 0.3, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, uPinCol, pinLine);
  }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.32, pinLine);',
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uPinCol * pinLine * 0.22;',
      );
  };
  const key = prevKey ? `${prevKey}|plow-pinstripe` : 'plow-pinstripe';
  mat.customProgramCacheKey = () => key;
  mat.onBeforeRender = (renderer, scene, camera, geometry, object, group) => {
    prevRender.call(mat, renderer, scene, camera, geometry, object, group);
    if (on.value < 0.5) return;
    const f = renderer.info.render.frame;
    if (f === frame) return;
    frame = f;
    bodyInv.value.copy(body.matrixWorld).invert();
  };
  mat.needsUpdate = true;
  return {
    on,
    color,
    set(c) {
      on.value = c == null ? 0 : 1;
      if (c != null) color.value.setHex(c);
      frame = -1;
    },
  };
}
