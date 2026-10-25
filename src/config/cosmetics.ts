/* Paint Shop catalog: purely visual items for the player's plow (no stats, no balance impact). Three slots:
 * PAINT (body colour on every starter plow), DECAL (a pattern / emblem drawn on the bodywork) and TRAIL
 * (particles from the rear while driving, thicker while dashing). Each slot has a free default that everyone
 * owns. Ownership + equip logic lives in meta/cosmetics.ts; the plow applies the look in entities/Plow.ts. */

export type CosmeticSlot = 'paint' | 'decal' | 'trail';

export const COSMETIC_SLOTS: readonly CosmeticSlot[] = ['paint', 'decal', 'trail'];

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
  metalness?: number;
  roughness?: number;
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

export type CosmeticDef = PaintDef | DecalDef | TrailDef;

export const COSMETICS: readonly CosmeticDef[] = [
  // ---- Paint
  { id: 'paint_stock', slot: 'paint', name: 'Factory', blurb: "Each plow's own colours.", price: 0, body: null, trim: null },
  { id: 'paint_arctic', slot: 'paint', name: 'Arctic White', blurb: 'Clean as fresh powder.', price: 250, body: 0xeef4fa, trim: 0x9fb8cf },
  { id: 'paint_red', slot: 'paint', name: 'Fire Engine', blurb: 'Loud, proud and red.', price: 400, body: 0xd81f2e, trim: 0xf2f2f2 },
  { id: 'paint_lime', slot: 'paint', name: 'Toxic Lime', blurb: 'Visible from orbit.', price: 650, body: 0x7cd61c, trim: 0x3f7a12 },
  { id: 'paint_purple', slot: 'paint', name: 'Midnight Grape', blurb: 'Deep purple, deeper menace.', price: 900, body: 0x5b2ca0, trim: 0xffc531 },
  { id: 'paint_pink', slot: 'paint', name: 'Bubblegum', blurb: 'Pretty in pink. Brutal in practice.', price: 1300, body: 0xff5aa8, trim: 0xffe0ef },
  { id: 'paint_black', slot: 'paint', name: 'Stealth Black', blurb: 'Matte black. No reflections, no mercy.', price: 1900, body: 0x22252b, trim: 0x44484f, roughness: 0.9, metalness: 0.05 },
  { id: 'paint_chrome', slot: 'paint', name: 'Ice Chrome', blurb: 'Mirror-polished frost.', price: 3200, req: { stars: 6 }, body: 0xe8f6ff, trim: 0xa9cce4, metalness: 0.3, roughness: 0.14 },
  { id: 'paint_gold', slot: 'paint', name: 'Champion Gold', blurb: 'For plows that have seen it all.', price: 6000, req: { achievements: 15 }, body: 0xffc93c, trim: 0xd99a22, metalness: 0.32, roughness: 0.22 },
  // ---- Decal
  { id: 'decal_none', slot: 'decal', name: 'Clean', blurb: 'Nothing but paint.', price: 0, style: null },
  { id: 'decal_stripes', slot: 'decal', name: 'Racing Stripes', blurb: 'Twin stripes nose to tail.', price: 350, style: 'stripes' },
  { id: 'decal_flames', slot: 'decal', name: 'Hot Rod Flames', blurb: 'Flames down both flanks.', price: 900, style: 'flames' },
  { id: 'decal_snowflake', slot: 'decal', name: 'Snowflake', blurb: 'A crisp six-point crest.', price: 1400, style: 'snowflake' },
  { id: 'decal_checker', slot: 'decal', name: 'Checkered Flag', blurb: 'Finish-line bands all round.', price: 2200, req: { achievements: 5 }, style: 'checker' },
  { id: 'decal_skull', slot: 'decal', name: 'Jolly Roger', blurb: 'Skull and crossbones. Bots, beware.', price: 3500, req: { stars: 9 }, style: 'skull' },
  // ---- Trail
  { id: 'trail_none', slot: 'trail', name: 'No Trail', blurb: 'Just tyre tracks.', price: 0, style: null, colors: [] },
  { id: 'trail_ice', slot: 'trail', name: 'Ice Sparkle', blurb: 'Glittering frost in your wake.', price: 500, style: 'ice', colors: [0xcff4ff, 0xffffff, 0x8fdcff] },
  { id: 'trail_fire', slot: 'trail', name: 'Afterburner', blurb: 'Embers off the back. Dash to flare up.', price: 1200, style: 'fire', colors: [0xff4a12, 0xff8a1a, 0xffc23a] },
  { id: 'trail_spark', slot: 'trail', name: 'Static Sparks', blurb: 'Crackling blue sparks.', price: 2000, req: { achievements: 8 }, style: 'spark', colors: [0x9fe8ff, 0xffffff, 0x4aa8ff] },
  { id: 'trail_confetti', slot: 'trail', name: 'Party Mode', blurb: 'Every lap is a parade.', price: 2800, style: 'confetti', colors: [0xff4359, 0xffc531, 0x35c86b, 0x3fa7f0, 0xb05cf0, 0xff8a1f] },
  { id: 'trail_rainbow', slot: 'trail', name: 'Rainbow Road', blurb: 'Leave a rainbow everywhere you go.', price: 5000, req: { stars: 12 }, style: 'rainbow', colors: [0xff4359, 0xffc531, 0x35c86b, 0x3fa7f0, 0xb05cf0] },
];

/** Free default per slot (owned by everyone, equipped on fresh / damaged saves). */
export const DEFAULT_COSMETICS: Readonly<Record<CosmeticSlot, string>> = {
  paint: 'paint_stock',
  decal: 'decal_none',
  trail: 'trail_none',
};

export const COSMETIC_BY_ID: ReadonlyMap<string, CosmeticDef> = new Map(COSMETICS.map((c) => [c.id, c]));

/** Catalog items of one slot, in shop order. */
export function cosmeticsInSlot<S extends CosmeticSlot>(slot: S): Extract<CosmeticDef, { slot: S }>[] {
  return COSMETICS.filter((c): c is Extract<CosmeticDef, { slot: S }> => c.slot === slot);
}
