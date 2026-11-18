/* Arena moods (visual identity pass): per arena, the sun's angle and colour, the ambient sky / bounce, the haze and a
 * colour grade. Day looks replace the zone's flat midday light with a LOW sun (long shadows, a warm key against a cool
 * fill) and some atmosphere; night looks only grade (night.ts already relights the arena). Applied by
 * Environment.setZone (lights, fog, sun direction) and render/post.ts (the grade, on the Bloom path).
 *
 * Grade (display space, after tone mapping): c = (c - 0.5) * contrast + 0.5; luma-preserving saturation; a warm/cool
 * split: shadows pulled toward `shadow`, highlights toward `highlight` (both small RGB offsets); a soft vignette. */

export interface Grade {
  contrast: number;
  saturation: number;
  /** Added in the shadows / the highlights (RGB, about +-0.05). */
  shadow: readonly [number, number, number];
  highlight: readonly [number, number, number];
  /** Corner darkening 0..1. */
  vignette: number;
}

export interface ArenaMood {
  /** Sun elevation and azimuth (degrees; azimuth 0 = from +z, 90 = from +x). */
  sunElev: number;
  sunAzim: number;
  sunColor: number;
  sunIntensity: number;
  /** Hemisphere sky colour / ground bounce colour and intensity. */
  sky: number;
  bounce: number;
  ambient: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  grade: Grade;
}

export const NEUTRAL_GRADE: Grade = { contrast: 1, saturation: 1, shadow: [0, 0, 0], highlight: [0, 0, 0], vignette: 0 };

/** Day moods by arena key (biome key, else theme). Missing = the zone's own light, neutral grade. */
export const DAY_MOODS: Record<string, ArenaMood> = {
  // Coldboot Glacier: a crisp polar morning, pale gold sun skimming the ice, deep blue shade
  glacier: {
    sunElev: 21, sunAzim: 145, sunColor: 0xffe1b8, sunIntensity: 2.7, sky: 0x8db6ff, bounce: 0xb8d8ff, ambient: 0.85,
    fogColor: 0xbcd6ee, fogNear: 38, fogFar: 150,
    grade: { contrast: 1.1, saturation: 1.12, shadow: [-0.01, 0.0, 0.035], highlight: [0.025, 0.012, -0.01], vignette: 0.28 },
  },
  // Inferno Quarry: a smoky volcanic dusk, low ember sun, violet shade
  quarry: {
    sunElev: 16, sunAzim: 210, sunColor: 0xffa868, sunIntensity: 2.6, sky: 0xa06a8a, bounce: 0xe8784a, ambient: 0.95,
    fogColor: 0xb8603c, fogNear: 30, fogFar: 135,
    grade: { contrast: 1.08, saturation: 1.02, shadow: [0.0, -0.005, 0.03], highlight: [0.03, 0.012, -0.01], vignette: 0.3 },
  },
  // Rust Basin: a dusty Martian afternoon, a small white sun, rust haze
  mars: {
    sunElev: 26, sunAzim: 120, sunColor: 0xfff0dc, sunIntensity: 2.6, sky: 0xc08a7a, bounce: 0xd07850, ambient: 0.7,
    fogColor: 0xd89c72, fogNear: 30, fogFar: 135,
    grade: { contrast: 1.08, saturation: 1.02, shadow: [0.015, -0.005, 0.02], highlight: [0.03, 0.012, -0.015], vignette: 0.3 },
  },
  // The Thermal Divide: late afternoon, a neutral sun splitting hot and cold
  divide: {
    sunElev: 24, sunAzim: 180, sunColor: 0xfff0e0, sunIntensity: 2.6, sky: 0xa8a8e0, bounce: 0xc8a0c0, ambient: 0.85,
    fogColor: 0xcfc4dc, fogNear: 40, fogFar: 150,
    grade: { contrast: 1.1, saturation: 1.12, shadow: [0.0, 0.0, 0.03], highlight: [0.025, 0.01, -0.01], vignette: 0.28 },
  },
  // Golden Tower Plaza: golden hour at the rally, warm key, blue sky fill
  plaza: {
    sunElev: 17, sunAzim: 215, sunColor: 0xffc888, sunIntensity: 3.0, sky: 0x8fb2ea, bounce: 0xffe2b8, ambient: 0.8,
    fogColor: 0xf0dcc0, fogNear: 42, fogFar: 160,
    grade: { contrast: 1.1, saturation: 1.12, shadow: [-0.005, 0.0, 0.035], highlight: [0.045, 0.02, -0.02], vignette: 0.28 },
  },
  // The Omega Works: neon factory at dusk, a magenta-orange sun low over the stacks
  omega: {
    sunElev: 16, sunAzim: 230, sunColor: 0xffb090, sunIntensity: 2.6, sky: 0xa4a6dc, bounce: 0xc8c0dc, ambient: 0.95,
    fogColor: 0xb8b2d4, fogNear: 42, fogFar: 170,
    grade: { contrast: 1.1, saturation: 1.08, shadow: [0.005, -0.005, 0.03], highlight: [0.03, 0.008, 0.0], vignette: 0.28 },
  },
};

/** Night grades (night.ts already relights the arena): a touch more contrast, cool shade, a deeper vignette. */
export const NIGHT_GRADE: Grade = { contrast: 1.1, saturation: 1.1, shadow: [-0.01, 0.0, 0.03], highlight: [0.02, 0.01, 0.0], vignette: 0.35 };

/** The mood key of an arena: its biome, else its theme. */
export function moodKey(biome: string | undefined | null, theme: string): string {
  return biome ?? theme;
}
