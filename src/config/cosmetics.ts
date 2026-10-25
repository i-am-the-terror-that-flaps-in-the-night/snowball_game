/* Paint Shop catalog: purely visual items for the player's plow (no stats, no balance impact). Three slots:
 * PAINT (body colour on every starter plow), DECAL (a pattern / emblem drawn on the bodywork) and TRAIL
 * (particles from the rear while driving, thicker while dashing). Each slot has a free default that everyone
 * owns. BLADE (skin on the front blade), HORN (slam sound + a short honk on dash) and KILL (an extra burst when you
 * wreck a bot or rival) were added later; old saves simply fall back to their free defaults. Ownership + equip logic lives in meta/cosmetics.ts; the plow applies the look in entities/Plow.ts. */

export type CosmeticSlot = 'paint' | 'decal' | 'trail' | 'blade' | 'horn' | 'kill';

export const COSMETIC_SLOTS: readonly CosmeticSlot[] = ['paint', 'decal', 'trail', 'blade', 'horn', 'kill'];

/** Extra unlock gates on top of the coin price (campaign challenge stars / achievements unlocked). */
export interface CosmeticReq {
  stars?: number;
  achievements?: number;
}

interface CosmeticBase {
  id: string;
  name: string;
  blurb: string;
  /** Coins; 0 = free. */
  price: number;
  req?: CosmeticReq;
}

export interface PaintDef extends CosmeticBase {
  slot: 'paint';
  /** Main body colour; null = the plow's factory colour (stock). */
  body: number | null;
  /** Secondary panels (the Classic's dump bed); null = factory. */
  trim: number | null;
  /** Wheel hubs / BRUTUS hub parts; null = factory. */
  accent?: number;
  metalness?: number;
  roughness?: number;
  /** Mirror finish: the paint reflects a sky / snow environment map (needed for metals to look metallic). */
  mirror?: boolean;
}

/** How a decal is drawn and where it goes (entities/plowModels.ts maps it onto each plow's surfaces). */
export type DecalStyle = 'stripes' | 'flames' | 'snowflake' | 'checker' | 'skull';

export interface DecalDef extends CosmeticBase {
  slot: 'decal';
  /** null = no decal. */
  style: DecalStyle | null;
}

export type TrailStyle = 'ice' | 'fire' | 'spark' | 'confetti' | 'rainbow';

export interface TrailDef extends CosmeticBase {
  slot: 'trail';
  /** null = no trail. */
  style: TrailStyle | null;
  /** Particle colours (rainbow cycles hue instead). Also the shop swatch. */
  colors: number[];
}

export type BladeStyle = 'hazard' | 'chrome' | 'gold' | 'ice' | 'flame' | 'camo';

export interface BladeDef extends CosmeticBase {
  slot: 'blade';
  /** null = the plow's factory blade. */
  style: BladeStyle | null;
  /** Shop swatch colours (the texture itself is drawn in entities/plowModels.ts bladeTexture). */
  colors: number[];
  metalness?: number;
  roughness?: number;
  /** Reflects the paint environment map (render/reflections.ts). */
  mirror?: boolean;
}

/** Procedural slam sounds (audio/Audio.ts synth cases with the same names). */
export type HornSound = 'hornAir' | 'hornClown' | 'hornBoom' | 'hornBell' | 'hornPixel';

export interface HornDef extends CosmeticBase {
  slot: 'horn';
  /** null = the stock snow slam, no honk. */
  sound: HornSound | null;
  /** Shop icon. */
  icon: string;
}

export type KillStyle = 'confetti' | 'lightning' | 'coins' | 'snowflakes' | 'pixel';

export interface KillDef extends CosmeticBase {
  slot: 'kill';
  /** null = just the normal wreck. */
  style: KillStyle | null;
  colors: number[];
  icon: string;
}

export type CosmeticDef = PaintDef | DecalDef | TrailDef | BladeDef | HornDef | KillDef;

export const COSMETICS: readonly CosmeticDef[] = [
  // ---- Paint
  { id: 'paint_stock', slot: 'paint', name: 'Factory', blurb: "Each plow's own colours.", price: 0, body: null, trim: null },
  { id: 'paint_arctic', slot: 'paint', name: 'Arctic White', blurb: 'Clean as fresh powder.', price: 150, body: 0xeef4fa, trim: 0x9fb8cf, accent: 0x3fa7f0 },
  { id: 'paint_red', slot: 'paint', name: 'Fire Engine', blurb: 'Loud, proud and red.', price: 200, body: 0xd81f2e, trim: 0xf2f2f2, accent: 0xffd23a },
  { id: 'paint_lime', slot: 'paint', name: 'Toxic Lime', blurb: 'Visible from orbit.', price: 300, body: 0x7cd61c, trim: 0x3f7a12, accent: 0x1d1f24 },
  { id: 'paint_purple', slot: 'paint', name: 'Midnight Grape', blurb: 'Deep purple, deeper menace.', price: 400, body: 0x5b2ca0, trim: 0xffc531, accent: 0xffc531 },
  { id: 'paint_pink', slot: 'paint', name: 'Bubblegum', blurb: 'Pretty in pink. Brutal in practice.', price: 550, body: 0xff5aa8, trim: 0xffe0ef, accent: 0xffffff },
  { id: 'paint_black', slot: 'paint', name: 'Stealth Black', blurb: 'Matte black. No reflections, no mercy.', price: 750, body: 0x22252b, trim: 0x44484f, accent: 0xff3b2f, roughness: 0.9, metalness: 0.05 },
  { id: 'paint_chrome', slot: 'paint', name: 'Ice Chrome', blurb: 'Mirror-polished frost.', price: 1200, req: { stars: 6 }, body: 0xf2f8ff, trim: 0xc6dcee, accent: 0x7fdcff, metalness: 1, roughness: 0.04, mirror: true },
  { id: 'paint_gold', slot: 'paint', name: 'Champion Gold', blurb: 'For plows that have seen it all.', price: 2000, req: { achievements: 15 }, body: 0xffbf2e, trim: 0xd9901a, accent: 0xfff3c4, metalness: 1, roughness: 0.12, mirror: true },
  // ---- Decal
  { id: 'decal_none', slot: 'decal', name: 'Clean', blurb: 'Nothing but paint.', price: 0, style: null },
  { id: 'decal_stripes', slot: 'decal', name: 'Racing Stripes', blurb: 'Twin stripes nose to tail.', price: 150, style: 'stripes' },
  { id: 'decal_flames', slot: 'decal', name: 'Hot Rod Flames', blurb: 'Flames down both flanks.', price: 350, style: 'flames' },
  { id: 'decal_snowflake', slot: 'decal', name: 'Snowflake', blurb: 'A crisp six-point crest.', price: 500, style: 'snowflake' },
  { id: 'decal_checker', slot: 'decal', name: 'Checkered Flag', blurb: 'Finish-line bands all round.', price: 800, req: { achievements: 5 }, style: 'checker' },
  { id: 'decal_skull', slot: 'decal', name: 'Jolly Roger', blurb: 'Skull and crossbones. Bots, beware.', price: 1200, req: { stars: 9 }, style: 'skull' },
  // ---- Trail
  { id: 'trail_none', slot: 'trail', name: 'No Trail', blurb: 'Just tyre tracks.', price: 0, style: null, colors: [] },
  { id: 'trail_ice', slot: 'trail', name: 'Ice Sparkle', blurb: 'Glittering frost in your wake.', price: 200, style: 'ice', colors: [0xcff4ff, 0xffffff, 0x8fdcff] },
  { id: 'trail_fire', slot: 'trail', name: 'Afterburner', blurb: 'Embers off the back. Dash to flare up.', price: 450, style: 'fire', colors: [0xff4a12, 0xff8a1a, 0xffc23a] },
  { id: 'trail_spark', slot: 'trail', name: 'Static Sparks', blurb: 'Crackling blue sparks.', price: 700, req: { achievements: 8 }, style: 'spark', colors: [0x9fe8ff, 0xffffff, 0x4aa8ff] },
  { id: 'trail_confetti', slot: 'trail', name: 'Party Mode', blurb: 'Every lap is a parade.', price: 900, style: 'confetti', colors: [0xff4359, 0xffc531, 0x35c86b, 0x3fa7f0, 0xb05cf0, 0xff8a1f] },
  { id: 'trail_rainbow', slot: 'trail', name: 'Rainbow Road', blurb: 'Leave a rainbow everywhere you go.', price: 1500, req: { stars: 12 }, style: 'rainbow', colors: [0xff4359, 0xffc531, 0x35c86b, 0x3fa7f0, 0xb05cf0] },
  // ---- Blade skin
  { id: 'blade_stock', slot: 'blade', name: 'Factory Blade', blurb: "Each plow's own steel.", price: 0, style: null, colors: [0xffd23a, 0x8a8f99] },
  { id: 'blade_hazard', slot: 'blade', name: 'Hazard Stripes', blurb: 'Caution: may contain bots.', price: 200, style: 'hazard', colors: [0xffc21a, 0x16181c] },
  { id: 'blade_camo', slot: 'blade', name: 'Snow Camo', blurb: 'Winter warfare pattern.', price: 400, style: 'camo', colors: [0xe8eef4, 0x8a98a8, 0x3c4654] },
  { id: 'blade_flame', slot: 'blade', name: 'Inferno Edge', blurb: 'Flames licking up the steel.', price: 650, style: 'flame', colors: [0xff3a12, 0xffc23a, 0x2a0a06] },
  { id: 'blade_ice', slot: 'blade', name: 'Glacier', blurb: 'Carved from blue ice.', price: 900, style: 'ice', colors: [0x9fe8ff, 0xffffff, 0x3a8fd8], metalness: 0.2, roughness: 0.15 },
  { id: 'blade_chrome', slot: 'blade', name: 'Mirror Chrome', blurb: 'See your victims in it.', price: 1300, req: { stars: 6 }, style: 'chrome', colors: [0xf4f8ff, 0x9aa8b8], metalness: 1, roughness: 0.04, mirror: true },
  { id: 'blade_gold', slot: 'blade', name: 'Solid Gold', blurb: 'The most expensive shovel ever made.', price: 2000, req: { achievements: 12 }, style: 'gold', colors: [0xffc72e, 0xd9901a], metalness: 1, roughness: 0.1, mirror: true },
  // ---- Horn / slam sound
  { id: 'horn_stock', slot: 'horn', name: 'Snow Crunch', blurb: 'The classic whumpf.', price: 0, sound: null, icon: '❄️' },
  { id: 'horn_air', slot: 'horn', name: 'Air Horn', blurb: 'BWAAAP! Also honks on dash.', price: 250, sound: 'hornAir', icon: '📯' },
  { id: 'horn_clown', slot: 'horn', name: 'Clown Honk', blurb: 'Honk honk. Deeply humiliating.', price: 400, sound: 'hornClown', icon: '🤡' },
  { id: 'horn_bell', slot: 'horn', name: 'Bell Clang', blurb: 'Ding! Round over.', price: 600, sound: 'hornBell', icon: '🔔' },
  { id: 'horn_pixel', slot: 'horn', name: '8-Bit', blurb: 'Bleep-bloop arcade slams.', price: 800, req: { achievements: 6 }, sound: 'hornPixel', icon: '👾' },
  { id: 'horn_boom', slot: 'horn', name: 'Thunder Boom', blurb: 'Every slam is a storm.', price: 1200, req: { stars: 9 }, sound: 'hornBoom', icon: '⛈️' },
  // ---- Kill effect
  { id: 'kill_none', slot: 'kill', name: 'Plain Wreck', blurb: 'Just the usual scrap.', price: 0, style: null, colors: [], icon: '💥' },
  { id: 'kill_snow', slot: 'kill', name: 'Snow Globe', blurb: 'A flurry of big flakes.', price: 150, style: 'snowflakes', colors: [0xffffff, 0xcff4ff, 0x9fdcff], icon: '❄️' },
  { id: 'kill_confetti', slot: 'kill', name: 'Confetti Pop', blurb: 'Celebrate every wreck.', price: 350, style: 'confetti', colors: [0xff4359, 0xffc531, 0x35c86b, 0x3fa7f0, 0xb05cf0, 0xff8a1f], icon: '🎉' },
  { id: 'kill_pixel', slot: 'kill', name: 'Pixel Pop', blurb: 'Game over, man.', price: 600, style: 'pixel', colors: [0x35ff6b, 0xff3bd0, 0x3fd8ff, 0xfff23a], icon: '👾' },
  { id: 'kill_coins', slot: 'kill', name: 'Jackpot', blurb: 'A fountain of gold coins (just for show).', price: 1000, req: { achievements: 10 }, style: 'coins', colors: [0xffd23a, 0xffb000, 0xfff3c4], icon: '🪙' },
  { id: 'kill_lightning', slot: 'kill', name: 'Smite', blurb: 'Lightning strikes the wreck.', price: 1600, req: { stars: 12 }, style: 'lightning', colors: [0x9fe8ff, 0xffffff, 0x4aa8ff], icon: '⚡' },
];

/** Free default per slot (owned by everyone, equipped on fresh / damaged saves). */
export const DEFAULT_COSMETICS: Readonly<Record<CosmeticSlot, string>> = {
  paint: 'paint_stock',
  decal: 'decal_none',
  trail: 'trail_none',
  blade: 'blade_stock',
  horn: 'horn_stock',
  kill: 'kill_none',
};

export const COSMETIC_BY_ID: ReadonlyMap<string, CosmeticDef> = new Map(COSMETICS.map((c) => [c.id, c]));

/** Catalog items of one slot, in shop order. */
export function cosmeticsInSlot<S extends CosmeticSlot>(slot: S): Extract<CosmeticDef, { slot: S }>[] {
  return COSMETICS.filter((c): c is Extract<CosmeticDef, { slot: S }> => c.slot === slot);
}
