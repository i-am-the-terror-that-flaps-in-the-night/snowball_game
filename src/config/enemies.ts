/** Every enemy is a BOT (robot vehicle). Combat is close-quarters (rams, shoves, slams, spins, short-range
 *  shockwaves) with two ranged exceptions: the Flurry Gunner's slow, telegraphed snowball bolt (dodgeable, see
 *  GUNNER_*) and the Mirror Plow's copied beam (telegraphed by a ground stripe, see MIRROR_*). */
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
  /** PROTOCOL C's final boss (wave 7): THE DONALD in his walking golden tower (enemies/chairman.ts). */
  | 'chairman'
  /** PROTOCOL C finale (THE WHITEOUT, core/whiteoutDirector.ts): an ice crystal beamed to the storm giant; it never
   *  moves, every plow can break it (3, then 4, then 5 per cycle). */
  | 'stormheart'
  /** PROTOCOL C finale: THE WHITEOUT's EYE (the giant itself is a visual: world/protocol/WhiteoutGiant.ts). Its HP is the
   *  Whiteout's; a fixed hit spot the director moves (sealed while closed, chipped while open, wide open in a STAGGER). */
  | 'whiteout'
  /** Brawl mode rival plow (stats are the baseline; BrawlManager scales by difficulty). */
  | 'rival'
  /** Ranged minion: keeps a standoff and lobs slow, telegraphed snowball bolts (enemies/ai.ts gunner). */
  | 'gunner'
  /** Shield minion: a frontal plow-shield blocks most direct hits; flank it or hit it with area damage. */
  | 'bulwark'
  /** Splitter minion: bursts into SPLIT_COUNT slushlings when wrecked. */
  | 'slushpile'
  /** A Slushpile's mini (a shrunken scrapper): never in a wave list, only spawned by a split. */
  | 'slushling'
  /** Elite copycat: watches the plow's abilities and copies them back (MIRROR_*), then stalls, exposed. */
  | 'mirror'
  /** Elite area denial: anchors in place, drags the plow in, zaps it up close; two anchored towers chain a fence. */
  | 'magnet'
  /** Elite pair: two bots on an energy tether; a wrecked twin is revived by its partner unless both go down. */
  | 'twinlink';

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
  mirror: {
    type: 'mirror', name: 'Mirror Plow', title: '', hp: 260, speed: 9, radius: 1.5, mass: 1.6, ramDamage: 16, armor: 2, coins: 40, isBoss: false, color: 0xc9d4e2, accent: 0xff3bd0,
    special: 'A chrome rival plow with a magenta "recording" halo. It shadows the plow at mid range and WATCHES: every dash, slam, whirl or F ability the player uses is recorded (the halo turns the move\'s colour, "COPYING ...!") and played back 1.5 s later at copy strength: DASH (a telegraphed charge), RING (a ground ring that slams down), BEAM (a ground stripe, then a beam along it) or CONE (a wedge blast ahead). After every copy it STALLS for 1.5 s, EXPOSED (x1.5 damage taken). Bait a copy, dodge it, punish the stall. Never copies ultimates.',
  },
  magnet: {
    type: 'magnet', name: 'Magnet Tower', title: '', hp: 160, speed: 4.5, radius: 1.3, mass: 4, ramDamage: 8, armor: 4, coins: 22, isBoss: false, color: 0xb8262c, accent: 0xdde4ec,
    special: 'A tracked horseshoe-magnet tower. Drives to a spot 10-16 m from the plow and ANCHORS (three legs stamp down, 1.5 s, vulnerable), then drags the plow toward it (within 14 m, ~35% of the plow\'s top speed, heavy plows resist) and ZAPS it inside 4 m. Every 6 s its coil OVERHEATS for 2 s (no pull, x1.5 damage taken). Two anchored towers within 18 m chain an ELECTRIC FENCE: crossing it zaps and throws the plow back. Outrange it, hit it overheated, or come in from outside the fence.',
  },
  twinlink: {
    type: 'twinlink', name: 'Tether Twin', title: '', hp: 90, speed: 7.5, radius: 1.1, mass: 1.1, ramDamage: 10, armor: 1, coins: 12, isBoss: false, color: 0x3a3f9a, accent: 0xffd23a,
    special: 'Always spawned as a PAIR joined by a gold energy tether (driving through it zaps you and throws you off). Wreck one and it drops as a smoking HUSK: its partner ENRAGES (faster) and rushes over to REVIVE it (2.5 s channel, a gold beam; a big hit or knockback interrupts it), back at 50% HP. Wreck the partner while the other is a husk and both go down: within 4 s of each other = SEVERED! bonus coins.',
  },
  omega: {
    type: 'omega', name: 'MEGAPLOW Ω', title: 'The Final Machine', hp: 2400, speed: 4.5, radius: 3.2, mass: 10, ramDamage: 30, armor: 8, coins: 400, isBoss: true, color: 0x22252b, accent: 0xff1744,
    special: 'Colossal black-and-chrome mega plow with a triple blade, glowing red core and hazard lights. Three phases (announce each with a roar + shake). P1 (100-66%): CHARGE (1.0s telegraph, 18 m/s, wall-hit = 2s stun) and SHOVE (0.6s, when within 6m). P2 (66-33%): adds GROUND POUND — 1.1s telegraph (it rears up, a red ring of radius 8 appears on the ground), slams down: ramDamage x1.2 to anything within 8m + knockback (get out of the ring!); summons 3 scrappers at the start of P2. P3 (<33%): ENRAGED (red core pulsing, speed x1.35), combos CHARGE -> GROUND POUND, summons 2 brutes once. Core vulnerability: after a ground pound it is exposed for 1.5s (takes x1.5).',
  },
  chairman: {
    type: 'chairman', name: 'THE CHAIRMAN', title: 'Chairman of the Board', hp: 3000, speed: 4.6, radius: 3.3, mass: 14, ramDamage: 32, armor: 9, coins: 900, isBoss: true, color: 0xf0b928, accent: 0x15161c,
    special: 'PROTOCOL C wave 7: THE DONALD revealed, driving a walking golden skyscraper (tank-tread pods, mirrored gold glass, the boardroom on top with him at the table, a BRIEFCASE CANNON crane arm and a golden POINTING FINGER). BRIEFCASE CANNON: lobbed briefcases onto telegraphed rings (paper burst + short stun). QUARTERLY REPORTS: a paper storm (scrambles the minimap, slows the plow inside). HOSTILE TAKEOVER: a gold beam ACQUIRES an echo (gold armour + speed until a damage threshold or a timeout). RESTRUCTURING: rows of gold partition walls (smashable). Upgraded DEPORTATION and RALLY (podium + rally bots). Phase 2 at 50%: GOLDEN PARACHUTE (reflects damage, faster, briefcase volleys of three). Ultimates have no effect on him. At 0 HP he slams the PROTOCOL C button.',
  },
  stormheart: {
    type: 'stormheart', name: 'STORM HEART', title: '', hp: 260, speed: 0, radius: 1.35, mass: 999, ramDamage: 0, armor: 2, coins: 12, isBoss: false, color: 0x8fd8ff, accent: 0x2a5a9a,
    special: 'PROTOCOL C finale: a jagged ice crystal on a cracked pedestal, beamed to THE WHITEOUT. Never moves or attacks. Every Heart broken makes the storm ANGRIER; the last one of a cycle STAGGERS the giant (its eye crashes onto the north stand front).',
  },
  whiteout: {
    type: 'whiteout', name: 'THE WHITEOUT', title: 'The Valley\'s Hoarded Snow', hp: 3000, speed: 0, radius: 3.4, mass: 999, ramDamage: 0, armor: 6, coins: 0, isBoss: true, color: 0xdff4ff, accent: 0x3aa8ff,
    special: 'PROTOCOL C finale: a storm giant outside the north stand with ONE cold ice-blue eye. Sealed while the eye is closed; chip it while it is open; break the Storm Hearts to STAGGER it, its eye on the stand front, and hit everything into it. Attacks: ICE SHARD RAIN, VORTEX ARM sweeps, GUSTS (push), GLARE (daze), snow copies of the bosses.',
  },
};

/* ------------------------------------------------------------------ regular-bot tuning (enemies/ai.ts, Enemies.ts) */

/** Flurry Gunner standoff band (m): it strafes at the middle, backs off inside the near edge, closes past the far. */
export const GUNNER_RANGE_MIN = 10;
export const GUNNER_RANGE_MAX = 14;
/** Below this distance (m) it gives up aiming and just backs away (close in and it can't shoot you). */
export const GUNNER_PANIC = 6.5;
/** Aim wind-up (s): barrel glow + ground stripe. The bolt flies at where the plow is when the aim ends (no lead). */
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

/** Mirror Plow: seconds between seeing a move and playing it back; the stall (EXPOSED) after each copy and its damage
 *  multiplier; the cooldown before it records again; the move ranges / sizes. */
export const MIRROR_DELAY = 1.5;
export const MIRROR_STALL = 1.5;
export const MIRROR_EXPOSED = 1.5;
export const MIRROR_COOLDOWN = 2.5;
export const MIRROR_RING_R = 5.5;
export const MIRROR_BEAM_LEN = 16;
export const MIRROR_BEAM_W = 1.4;
export const MIRROR_CONE_LEN = 8;
export const MIRROR_CONE_W = 4.5;
/** Damage of each copied move, as a multiple of the Mirror's ramDamage (the "copy strength"). */
export const MIRROR_DMG = { dash: 1, ring: 1.2, beam: 0.9, cone: 1.1 } as const;

/** Magnet Tower: anchoring time (vulnerable), pull reach (m) and strength (share of the plow's own top speed, Plow.tow),
 *  zap reach / damage / interval, the overheat cycle (pull seconds, then overheated seconds, x damage taken), and the
 *  fence (max link length, damage, throw speed, per-hit cooldown). */
export const MAGNET_ANCHOR = 1.5;
export const MAGNET_PULL_R = 14;
export const MAGNET_PULL = 0.35;
export const MAGNET_ZAP_R = 4;
export const MAGNET_ZAP_DMG = 8;
export const MAGNET_ZAP_GAP = 0.5;
export const MAGNET_ON = 6;
export const MAGNET_HOT = 2;
export const MAGNET_HOT_MULT = 1.5;
export const FENCE_MAX = 18;
export const FENCE_DMG = 15;
export const FENCE_THROW = 12;
export const FENCE_CD = 0.8;

/** Tether Twins: max tether length (the pair regroups past it), revive channel (s) and HP share, enrage speed, the
 *  SEVERED window (s) and bonus coins (x a twin's coins), the tether zap (damage, throw, cooldown). */
export const TWIN_TETHER_MAX = 12;
export const TWIN_REVIVE = 2.5;
export const TWIN_REVIVE_HP = 0.5;
export const TWIN_ENRAGE_SPEED = 1.3;
export const TWIN_SEVER_WINDOW = 4;
export const TWIN_SEVER_BONUS = 3;
export const TWIN_TETHER_DMG = 10;
export const TWIN_TETHER_THROW = 9;
export const TWIN_TETHER_CD = 0.8;
