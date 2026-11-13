/** Every enemy is a BOT (robot vehicle). Combat is close-quarters (rams, shoves, slams, spins, short-range
 *  shockwaves) with ONE exception: the Flurry Gunner's slow, telegraphed snowball bolt (dodgeable, see GUNNER_*). */
export type EnemyType =
  | 'scrapper'
  | 'brute'
  | 'spinner'
  | 'thief'
  | 'bulldoza'
  | 'frostbyte'
  | 'grinder'
  | 'slush'
  | 'sleet'
  | 'omega'
  /** THE DONALD's red-cap rally minion (a re-skinned scrapper). */
  | 'rallybot'
  | 'donald'
  /** Brawl mode rival plow (stats are the baseline; BrawlManager scales by difficulty). */
  | 'rival'
  /** Ranged minion: keeps a standoff and lobs slow, telegraphed snowball bolts (enemies/ai.ts gunner). */
  | 'gunner'
  /** Shield minion: a frontal plow-shield blocks most direct hits; flank it or hit it with area damage. */
  | 'bulwark'
  /** Splitter minion: bursts into SPLIT_COUNT slushlings when wrecked. */
  | 'slushpile'
  /** A Slushpile's mini (a shrunken scrapper): never in a wave list, only spawned by a split. */
  | 'slushling';

export interface EnemyDef {
  type: EnemyType;
  name: string;
  /** Boss subtitle shown on the intro card. */
  title: string;
  hp: number;
  /** Cruise speed, m/s. */
  speed: number;
  /** Collision radius, m. */
  radius: number;
  /** Relative mass for collisions/knockback (player plow = 1.5). */
  mass: number;
  /** Damage dealt to the plow by a ram / basic melee hit. */
  ramDamage: number;
  /** Flat damage reduction per hit (min 1). Rewards big slams. */
  armor: number;
  coins: number;
  isBoss: boolean;
  /** Main paint color + accent color (hex). */
  color: number;
  accent: number;
  /** Behavior + move set for the implementer. Telegraph every big attack (>= 0.6s wind-up). */
  special: string;
}

export const ENEMIES: Record<EnemyType, EnemyDef> = {
  scrapper: {
    type: 'scrapper', name: 'Scrapper Bot', title: '', hp: 30, speed: 7.5, radius: 0.9, mass: 0.6, ramDamage: 7, armor: 0, coins: 6, isBoss: false, color: 0x8a96a8, accent: 0xff3b30,
    special: 'Small wedge-shaped rammer on treads with one red eye. Circles the plow at ~6m, then darts in for a ram (0.4s wind-up: eye flashes, backs up slightly), then retreats. Packs: scrappers pick different angles around the plow.',
  },
  brute: {
    type: 'brute', name: 'Brute Dozer', title: '', hp: 90, speed: 4.2, radius: 1.5, mass: 3, ramDamage: 16, armor: 3, coins: 14, isBoss: false, color: 0x5d6b4a, accent: 0xffc400,
    special: 'Heavy bulldozer with a big steel FRONT PLATE: hits arriving within 60° of its front take 70% less damage — the player must flank or slam big. Slowly turns to face the plow (turn rate 1.2 rad/s) and pushes in; when within 3.5m does a shove (0.7s wind-up, plate glows) for ramDamage + strong knockback.',
  },
  spinner: {
    type: 'spinner', name: 'Buzzsaw Bot', title: '', hp: 55, speed: 5, radius: 1.1, mass: 1.2, ramDamage: 10, armor: 1, coins: 12, isBoss: false, color: 0xb0b8c4, accent: 0xff8a00,
    special: 'Round dome bot with saw blades. Cycle: approach (3s) -> spin-up telegraph (0.6s, sparks) -> SPIN for 2.5s (moves toward plow at 6 m/s, contact deals ramDamage every 0.35s and bounces the plow away; player rams against it deal only 30%) -> OVERHEATED 2s (glowing red, stops, takes x1.6 damage). Punish window!',
  },
  thief: {
    type: 'thief', name: 'Snow Thief', title: '', hp: 35, speed: 9, radius: 0.8, mass: 0.5, ramDamage: 4, armor: 0, coins: 10, isBoss: false, color: 0x2e3a59, accent: 0x40e0ff,
    special: 'Sneaky fast hover-bot with a vacuum nozzle. Targets the player\'s HELD SNOWBALL: if the plow holds a ball it darts in, and on contact steals 50% (plow.stealSnow(0.5)) — glows bigger/bluer while carrying snow — then flees to the far side. Killing a loaded thief drops the snow (ctx.snow.addSnow). If the plow has no ball, it vacuums snow off the ground near the plow instead (ctx.snow.collectDisc) to deny ammo.',
  },
  bulldoza: {
    type: 'bulldoza', name: 'BULLDOZA', title: 'The Yard Boss', hp: 650, speed: 4, radius: 2.4, mass: 6, ramDamage: 28, armor: 4, coins: 120, isBoss: true, color: 0xffb400, accent: 0x111111,
    special: 'Giant yellow/black bulldozer with hazard stripes, horns on the blade, smokestacks. Moves: (1) CHARGE — 1.0s telegraph (revs, smoke, red headlights, a red ground stripe shows its path toward the plow), then barrels straight at 20 m/s for up to 2.5s; contact = ramDamage x1.5 + huge knockback. If the charge hits an ARENA wall it is STUNNED for 2.5s (dizzy stars, takes x1.5 damage). (2) SHOVE — when plow within 5m: 0.6s wind-up, short lunge, ramDamage. Below 50% HP: charges twice in a row.',
  },
  frostbyte: {
    type: 'frostbyte', name: 'FROSTBYTE', title: 'The Rogue Plow AI', hp: 800, speed: 6.5, radius: 2.0, mass: 3.5, ramDamage: 16, armor: 4, coins: 160, isBoss: true, color: 0x6a2bd9, accent: 0x40e0ff,
    special: 'An evil AI snowplow (purple, cyan visor-face, glowing blade). It PLOWS ITS OWN SNOWBALL by driving through deep snow (calls ctx.snow.plowLine like the player; its ball grows to max 2.2m radius, rendered in front of its blade). When its ball >= 1m and plow within 7m: SLAM — 0.7s telegraph (ball glows, it backs up), lunge 6m, cone hit: 18 * ballRadius^2 damage + knockback; ball consumed. While holding a ball its front blocks 50% of damage. If the player slams it while both hold balls -> CLASH: both balls shatter, bigger ball\'s owner takes no damage, the other takes the difference. Rams the player to steal snow (plow.stealSnow(0.4)) and adds it to its own ball. Below 40% HP: speed x1.3 and it summons 2 thieves once.',
  },
  grinder: {
    type: 'grinder', name: 'THE GRINDER', title: 'Auger of the Red Dust', hp: 1100, speed: 3.6, radius: 2.6, mass: 7, ramDamage: 22, armor: 6, coins: 200, isBoss: true, color: 0x9a4b2a, accent: 0xff6a00,
    special: 'Massive rust-red machine with a huge spinning front auger/drill. Moves: (1) AUGER SPIN — 1.2s telegraph (an expanding orange warning ring of radius 7 on the ground), then spins for 2.2s: everything within 7m takes 9 damage every 0.3s and is PULLED inward (plow.push toward it); afterwards DIZZY for 2.2s (sparks, takes x1.5 damage). (2) DRILL DASH — 0.8s telegraph, short 12m dash at 16 m/s, contact ramDamage x1.4. (3) While moving, its auger eats snow in front of it (ctx.snow.collectDisc). At 60% and 30% HP it summons 2 scrappers.',
  },
  slush: {
    type: 'slush', name: 'SLUSH', title: 'The Hot Twin', hp: 600, speed: 6.5, radius: 1.9, mass: 3.5, ramDamage: 20, armor: 4, coins: 130, isBoss: true, color: 0xd62839, accent: 0xffffff,
    special: 'Red twin of a boss pair (with SLEET). Aggressive CHARGER: 0.8s telegraph then a 18 m/s charge (stunned 1.5s on wall hits). Coordinates with SLEET: while SLEET pins/flanks, SLUSH lines up charges from the opposite side of the plow. If SLEET is destroyed: ENRAGE (red glow, speed x1.4, damage x1.3, charges back-to-back).',
  },
  sleet: {
    type: 'sleet', name: 'SLEET', title: 'The Cold Twin', hp: 600, speed: 6, radius: 1.9, mass: 4, ramDamage: 16, armor: 6, coins: 130, isBoss: true, color: 0x1f6fd6, accent: 0xffffff,
    special: 'Blue twin (with SLUSH). Defensive FLANKER/PINNER: keeps ~4m from the plow on the side opposite SLUSH, shoves (0.6s wind-up) and does a 0.9s-telegraphed SIDE-SWIPE spin (radius 4.5, ramDamage, big sideways knockback toward SLUSH\'s charge lane). If SLUSH is destroyed: ENRAGE (blue glow, speed x1.4, damage x1.3, swipes twice as often).',
  },
  rival: {
    type: 'rival', name: 'Rival Plow', title: '', hp: 140, speed: 10.5, radius: 1.6, mass: 1.5, ramDamage: 14, armor: 0, coins: 0, isBoss: false, color: 0x2a9df4, accent: 0xffffff,
    special: 'Brawl-mode AI snowplow with the SAME kit as the player: plows snow into a held ball, slams it (SLAM_DAMAGE_K * r^2), rams, dashes (long burst + dash strike), whirls (E). Hunts the player AND the other rivals.',
  },
  rallybot: {
    type: 'rallybot', name: 'Rally Bot', title: '', hp: 34, speed: 8, radius: 0.9, mass: 0.6, ramDamage: 8, armor: 0, coins: 6, isBoss: false, color: 0xf2f2f4, accent: 0xd8202c,
    special: 'A scrapper in THE DONALD\'s colors with a red cap. Summoned in a ring during RALLY (scrapper AI); while the rally lasts it is faster and hits harder.',
  },
  donald: {
    type: 'donald', name: 'THE DONALD', title: 'Tremendous Plow of the Tower', hp: 2600, speed: 5, radius: 3.0, mass: 9, ramDamage: 30, armor: 8, coins: 450, isBoss: true, color: 0xf4f1e8, accent: 0xe0a91c,
    special: 'Huge gold-and-white caricature plow (orange face, swoopy blond hair, red cap, long red tie). (1) BUILD THE WALL: snow-brick wall lines rise across the arena (1.0s ground-stripe telegraph), block movement for 9s, smashed by slams / dash strikes. (2) DEPORTATION: 1.2s tractor-beam ring near the plow; inside when it fires = flung to the far edge, held ball lost (bots too). (3) RALLY: parks at the podium, summons a ring of red-cap rally bots, takes 60% less damage, bots buffed; wrecking half of them or smashing the podium breaks it (boss stunned). SHOVE / STEAMROLL charge between. Phase 2 at 50%: GOLD PLATED (reflects 15% of damage), faster, more walls, taunts.',
  },
  gunner: {
    type: 'gunner', name: 'Flurry Gunner', title: '', hp: 26, speed: 6.5, radius: 0.95, mass: 0.7, ramDamage: 9, armor: 0, coins: 9, isBoss: false, color: 0x3d6f94, accent: 0x7fe6ff,
    special: 'Spindly snow-cannon on four wheels with a long barrel. Holds a 10-14 m standoff, strafing round the plow and backing off when it closes in. AIM (0.55s: barrel glows cyan, a ground stripe shows the line) then fires ONE slow snowball bolt (ramDamage, ~15 m/s, aimed where the plow was) that the player can drive out of. Paper-thin: close in and it pops.',
  },
  bulwark: {
    type: 'bulwark', name: 'Bulwark', title: '', hp: 110, speed: 3.4, radius: 1.45, mass: 3.2, ramDamage: 14, armor: 2, coins: 16, isBoss: false, color: 0x2f4a6b, accent: 0xdfe9f5,
    special: 'Slow tread-tank behind a huge curved PLOW-SHIELD. Direct hits arriving within 45° of its front (a 90° cone) lose 75% (BLOCK sparks); sides and back hit normally and its rear vent takes x1.3. Slams, blasts, shockwaves and ultimates go round the shield. Turns slowly (1.0 rad/s) to keep the shield on the plow: run rings round it. Close in: SHIELD BASH (0.75s wind-up, shield glows) for ramDamage + a big shove.',
  },
  slushpile: {
    type: 'slushpile', name: 'Slushpile', title: '', hp: 70, speed: 4.8, radius: 1.25, mass: 1.6, ramDamage: 10, armor: 1, coins: 8, isBoss: false, color: 0x9cb4c4, accent: 0x3fd1a8,
    special: 'A treaded hopper heaped with grey slush. Plods in and does a short belly-flop ram (0.5s wind-up). When wrecked it BURSTS into 3 slushlings (fast, flimsy, 1 coin each): finish the pile with a slam or blast to catch the minis in the same hit.',
  },
  slushling: {
    type: 'slushling', name: 'Slushling', title: '', hp: 12, speed: 9, radius: 0.6, mass: 0.35, ramDamage: 4, armor: 0, coins: 1, isBoss: false, color: 0xb6cad6, accent: 0x3fd1a8,
    special: 'A Slushpile\'s mini: a shrunken scrapper that circles and darts in. Only spawned by a split.',
  },
  omega: {
    type: 'omega', name: 'MEGAPLOW Ω', title: 'The Final Machine', hp: 2400, speed: 4.5, radius: 3.2, mass: 10, ramDamage: 30, armor: 8, coins: 400, isBoss: true, color: 0x22252b, accent: 0xff1744,
    special: 'Colossal black-and-chrome mega plow with a triple blade, glowing red core and hazard lights. Three phases (announce each with a roar + shake). P1 (100-66%): CHARGE (1.0s telegraph, 18 m/s, wall-hit = 2s stun) and SHOVE (0.6s, when within 6m). P2 (66-33%): adds GROUND POUND — 1.1s telegraph (it rears up, a red ring of radius 8 appears on the ground), slams down: ramDamage x1.2 to anything within 8m + knockback (get out of the ring!); summons 3 scrappers at the start of P2. P3 (<33%): ENRAGED (red core pulsing, speed x1.35), combos CHARGE -> GROUND POUND, summons 2 brutes once. Core vulnerability: after a ground pound it is exposed for 1.5s (takes x1.5).',
  },
};

/* ------------------------------------------------------------------ regular-bot tuning (enemies/ai.ts, Enemies.ts) */

/** Flurry Gunner standoff band (m): it strafes at the middle, backs off inside the near edge, closes past the far. */
export const GUNNER_RANGE_MIN = 10;
export const GUNNER_RANGE_MAX = 14;
/** Below this distance (m) it gives up aiming and just backs away (close in and it can't shoot you). */
export const GUNNER_PANIC = 6.5;
/** Aim wind-up (s): barrel glow + ground stripe. Fired at the plow's position when the aim started finishing. */
export const GUNNER_AIM = 0.55;
/** Snowball bolt: speed (m/s), reach (m), hit radius (m), knockback on the plow. Slow enough to drive out of. */
export const GUNNER_BOLT_SPEED = 15;
export const GUNNER_BOLT_RANGE = 24;
export const GUNNER_BOLT_R = 0.45;
export const GUNNER_BOLT_KNOCK = 4;
/** Seconds between a gunner's shots (min + random extra). */
export const GUNNER_COOLDOWN = 2.4;
export const GUNNER_COOLDOWN_RAND = 1;
/** At most this many gunners aim at once (their own limit, separate from the melee attack tokens). */
export const GUNNER_MAX_AIMING = 2;

/** Bulwark plow-shield: cosine of the half-angle of its frontal block cone (45° each side = a 90° cone). */
export const BULWARK_SHIELD_COS = Math.SQRT1_2;
/** Share of a direct frontal hit the shield takes off (magnetic `pierce` hits: only down to PLATE_PIERCE). */
export const BULWARK_BLOCK = 0.75;
/** Damage multiplier on hits into its rear vent (arriving within 60° of straight behind). */
export const BULWARK_REAR_MULT = 1.3;

/** Slushlings a wrecked Slushpile bursts into, and their outward kick (m/s). */
export const SPLIT_COUNT = 3;
export const SPLIT_KICK = 8;
