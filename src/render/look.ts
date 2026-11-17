import { bakedAOUniforms } from './palette';

/* Art pass, stage 0 (docs/art-pass.md): the switches of the "polished realistic-lite" lighting sample.
 *
 *  - env:      arena reflections (render/arenaEnv.ts): one small PMREM per arena look set as scene.environment, the
 *              hemisphere light handing `envShare` of the ambient over to it, and the plows' paint reflections
 *              (render/reflections.ts) following the arena;
 *  - bakedAO:  per-vertex corner occlusion baked into the arena's static batch (render/bakedAO.ts), multiplied in by
 *              the batch materials (palette.ts applyBakedAO);
 *  - ssao:     the half-resolution screen-space pass in render/post.ts (HIGH quality + the Bloom path only);
 *  - contact:  a soft contact-shadow patch under the plows and bots (render/contactShadows.ts).
 *
 * Stage 0 is an approval gate: everything is OFF by default (the game renders exactly as before) until a look is
 * chosen. A look is picked from the URL (`?look=env|baked|ssao|all|off`, `&strength=subtle|strong`) or live from the
 * console (`(await import('/src/render/look.ts')).setLook(...)`: env needs the next arena build, AO strength, SSAO
 * and contact shadows apply at once). */

export type LookStrength = 'subtle' | 'strong';

export interface StrengthDef {
  /** Share of the hemisphere (ambient) light handed over to the arena environment map (0..1). */
  envShare: number;
  /** Contrast of the environment's detail on top of the plain sky / ground ambient: sky tint, the stands' colour band,
   *  sun / lamp highlights, light panels (0 = a flat hemisphere, 1 = full). */
  detail: number;
  /** Multiplier on the sun / moon (directional) light; the env map's sky carries the rest. */
  sun: number;
  /** Gain on the environment's specular (reflected) light only, diffuse untouched: the map is calibrated to the
   *  arena's ambient fill, which is darker than its visible sky, so reflections get this lift (arenaEnv.ts). */
  specular: number;
  /** Baked corner occlusion: darkening at full occlusion (0..1) and the share of it applied to direct light. */
  bakedAO: number;
  bakedAODirect: number;
  /** Screen-space AO: darkening at full occlusion (0..1). */
  ssao: number;
  /** Contact-shadow patch opacity under plows / bots. */
  contact: number;
}

export const LOOK_STRENGTHS: Readonly<Record<LookStrength, Readonly<StrengthDef>>> = {
  subtle: { envShare: 0.55, detail: 0.55, sun: 1, specular: 1.4, bakedAO: 0.45, bakedAODirect: 0.25, ssao: 0.5, contact: 0.4 },
  strong: { envShare: 1, detail: 1, sun: 0.92, specular: 2.2, bakedAO: 0.7, bakedAODirect: 0.4, ssao: 0.9, contact: 0.65 },
};

/** The strength a chosen look ships with (pick "subtle" or "strong" at the stage 0 gate). */
export const LOOK_STRENGTH: LookStrength = 'strong';

export interface Look {
  env: boolean;
  bakedAO: boolean;
  ssao: boolean;
  contact: boolean;
  strength: LookStrength;
}

/** The live look. OFF by default (stage 0 gate; see the header). */
export const look: Look = { env: false, bakedAO: false, ssao: false, contact: false, strength: LOOK_STRENGTH };

/** Named presets for the URL / console: 'env' = the new lighting alone; 'baked' / 'ssao' = it plus that corner-shadow
 *  candidate and the contact patches; 'all' = env + baked AO + SSAO (where available) + contact patches. */
export type LookName = 'off' | 'env' | 'baked' | 'ssao' | 'all';

export function lookPreset(name: LookName): Omit<Look, 'strength'> {
  switch (name) {
    case 'env':
      return { env: true, bakedAO: false, ssao: false, contact: false };
    case 'baked':
      return { env: true, bakedAO: true, ssao: false, contact: true };
    case 'ssao':
      return { env: true, bakedAO: false, ssao: true, contact: true };
    case 'all':
      return { env: true, bakedAO: true, ssao: true, contact: true };
    default:
      return { env: false, bakedAO: false, ssao: false, contact: false };
  }
}

/** Switch the look (env / baked AO need the next arena build to take effect; see the header). */
export function setLook(name: LookName, strength: LookStrength = look.strength): void {
  Object.assign(look, lookPreset(name), { strength });
  syncLook();
}

/** Push the live look into the shared uniforms (baked AO strength; 0 = off). */
export function syncLook(): void {
  const k = LOOK_STRENGTHS[look.strength];
  bakedAOUniforms.uBakedAO.value = look.bakedAO ? k.bakedAO : 0;
  bakedAOUniforms.uBakedAODirect.value = k.bakedAODirect;
}

/** The tuning numbers of the live strength. */
export function strength(): Readonly<StrengthDef> {
  return LOOK_STRENGTHS[look.strength];
}

// URL flags (read once at load; the game is unchanged without them).
if (typeof location !== 'undefined') {
  const q = new URLSearchParams(location.search);
  const n = q.get('look');
  const s = q.get('strength');
  if (n === 'off' || n === 'env' || n === 'baked' || n === 'ssao' || n === 'all') setLook(n);
  if (s === 'subtle' || s === 'strong') look.strength = s;
  syncLook();
}
