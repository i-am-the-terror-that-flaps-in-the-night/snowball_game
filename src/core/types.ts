import type * as THREE from 'three';
import type { EventBus } from './events';
import type { Input } from './input';
import type { ZoneDef } from '../config/zones';
import type { EnemyType } from '../config/enemies';
import type { UpgradeId } from '../config/upgrades';
import type { Progression } from './Progression';

/* ------------------------------------------------------------------------------------------------
 * SNOWPLOW SHOWDOWN — PvE close-quarters arena brawler. The player's plow fights bot minions and
 * bot bosses inside a walled snow arena. ALL combat is melee: rams, shoves, snowball SLAMS, spins and
 * short-range shockwaves. There are NO projectiles / ranged attacks anywhere, and no base to defend.
 *
 * WORLD LAYOUT & CONVENTIONS (every module relies on these)
 *  - Y is up. Ground is flat at y = 0. Snow sits on top: surface height = snow.getDepth(x, z).
 *  - Heading: yaw in radians. forward = (sin(heading), 0, cos(heading)).
 *    Setting object.rotation.y = heading makes the object's local +Z axis point forward,
 *    so BUILD ALL VEHICLE / BOT MODELS FACING LOCAL +Z.
 *  - The arena is the square ARENA, enclosed by walls on all four sides with three enemy gates
 *    (ENEMY_GATES). Everything inside fights; nothing may leave (clamp to ARENA minus own radius).
 *  - The plow starts at PLOW_SPAWN facing north (-Z), i.e. heading = Math.PI.
 *  - Units are meters / seconds.
 * ---------------------------------------------------------------------------------------------- */

export const CAMPAIGN_ARENA_HALF = 30;
export const BRAWL_ARENA_HALF = 90;
/** Current playable area. MUTABLE: Game calls setArenaHalfSize() when switching between the campaign
 *  (±30) and Brawl mode (±90). Always read ARENA.* at use time — never cache the numbers. */
export const ARENA = { minX: -30, maxX: 30, minZ: -30, maxZ: 30 };
export function setArenaHalfSize(half: number): void {
  ARENA.minX = -half;
  ARENA.maxX = half;
  ARENA.minZ = -half;
  ARENA.maxZ = half;
}
/** Edge length of the square snow field for the current arena (ARENA + 4m margin per side). */
export const snowFieldSize = () => ARENA.maxX - ARENA.minX + 8;

/** Circle collider for arena obstacles (Brawl mode pillars, containers, rocks). */
export interface Obstacle {
  x: number;
  z: number;
  r: number;
}
export const PLOW_SPAWN = { x: 0, z: 18, heading: Math.PI } as const;
/** Enemy entry points just OUTSIDE the walls; bots spawn here facing in and drive through the gate
 *  (gate openings are 8m wide, centered on the gate). Bosses use gate 0 (north). */
export const ENEMY_GATES = [
  { x: 0, z: -34, heading: 0 },
  { x: -34, z: -8, heading: Math.PI / 2 },
  { x: 34, z: -8, heading: -Math.PI / 2 },
] as const;
export const GATE_WIDTH = 8;

/** Plow collision mass (enemies define their own in config/enemies.ts). */
export const PLOW_MASS = 1.5;

/** Volume (m^3) <-> radius (m) of a snowball. */
export const ballVolume = (r: number) => (4 / 3) * Math.PI * r * r * r;
export const ballRadius = (v: number) => Math.cbrt((3 * Math.max(0, v)) / (4 * Math.PI));
/** Smallest snowball that can be slammed. */
export const MIN_BALL_RADIUS = 0.35;
/** Slam damage before armor: SLAM_DAMAGE_K * r^2 * stats.damageMult. */
export const SLAM_DAMAGE_K = 40;

/** Fully computed player stats (from upgrades). See Progression.computeStats. */
export interface PlayerStats {
  maxSpeed: number;
  accel: number;
  turnRate: number;
  /** Blade width in meters (also the width of ram / slam hit zones). */
  bladeWidth: number;
  /** Fraction of plowed snow volume that ends up in the snowball. */
  collectRate: number;
  maxBallRadius: number;
  /** Slam damage multiplier. */
  damageMult: number;
  /** Ram damage at 10 m/s closing speed. */
  ramDamage: number;
  maxHp: number;
  /** Multiplier on all damage taken (1 = full, 0.75 = 25% less). */
  damageTaken: number;
  /** Iron Hide (BRUTUS): damage-taken multiplier at speed (1 = not owned); Combat eases it off when slow. */
  ironHide: number;
  /** Fraction of max HP repaired between rounds. */
  repairFraction: number;
  /** HP regenerated per second (0 if no Repair Kit). */
  hpRegen: number;
  /** Seconds for the SHIFT dash to recharge. */
  dashCooldown: number;
  /** Dash burst speed (m/s) ON TOP of normal top speed; the dash ignores the speed cap while active. */
  dashPower: number;
  /** Whirlwind (E) — always available. Spin radius (m) before adding bladeWidth/2. */
  whirlRadius: number;
  /** Damage per whirl tick (4 ticks per spin) before armor. */
  whirlDamage: number;
  /** Seconds for the E whirl to recharge. */
  whirlCooldown: number;
  /** Snow depth regenerated per second (m/s) before zone multiplier. */
  snowRegen: number;
  magnetRadius: number;
  /** Fraction of frontal damage the held snowball blocks (0.4, or 0.75 with Ice Shield). */
  shieldBlock: number;
  /** Pilot perks (player-only; Brawl rivals never get these). Fraction of dealt damage healed. */
  lifesteal: number;
  /** Seconds between Second Wind saves; Infinity when not owned. */
  secondWindCd: number;
  /** Extra Brawl hit cap on the player's hits. */
  hitCapBonus: number;
  /** Fraction of dash/whirl recharge refunded per kill. */
  killRecharge: number;
  /** Last Stand: bonus damage dealt (and half as much less taken) below LAST_STAND_HP; 0 = not owned. */
  lastStand: number;
  /** Classic Plow line (all 0 unless driving the Classic Plow with the upgrade). Shatter Slam: share of slam
   *  damage dealt to bots up to shardReach m beyond the slam zone. */
  shardFrac: number;
  shardReach: number;
  /** Snow Reserve: share of the ball kept after a slam. */
  reserveFrac: number;
  /** Slam Combo: extra slam damage per combo stack. */
  comboStep: number;
  /** Inferno flame attack (F, free on the Classic Plow): reach m, burn dps (0 = not the Classic Plow), recharge s. */
  flameRange: number;
  flameDps: number;
  flameCooldown: number;
  /** Which starter plow is being driven (config/plows.ts). */
  plowKind: 'classic' | 'volt' | 'brute' | 'isotope';
  /** ISOTOPE line (meltDamage 0 on other plows): Meltdown blast, its fallout pool, the Rad Aura and Chain Reaction. */
  meltRadius: number;
  meltDamage: number;
  meltCooldown: number;
  poolRadius: number;
  poolDps: number;
  poolSeconds: number;
  auraRadius: number;
  auraDps: number;
  chainBlast: number;
  /** VOLT-9 line (all 0 unless driving VOLT-9 with the upgrade): chain lightning arcs + share of the hit. */
  chainCount: number;
  chainFrac: number;
  /** Tesla Field passive aura. */
  fieldRadius: number;
  fieldDps: number;
  /** Thunderclap (F on VOLT-9). */
  clapRadius: number;
  clapDamage: number;
  clapStun: number;
  clapCooldown: number;
  /** Battery Shield capacity. */
  shieldMax: number;
  /** Ground Pound (F on BRUTUS; poundDamage 0 on other plows): ring radius, damage, stun s, outward
   *  knockback m/s, recharge s. */
  poundRadius: number;
  poundDamage: number;
  poundStun: number;
  poundKnock: number;
  poundCooldown: number;
  /** Momentum (BRUTUS): extra ram damage fraction per m/s of closing speed (0 = not owned). */
  momentum: number;
  /** Buzzsaws (BRUTUS): reach (m) and damage per second to bots in the front arc (0 = not owned). */
  sawRadius: number;
  sawDps: number;
  /** Overclock (pilot perk): multiplier on all ability cooldowns, 1 -> 0.4. Already folded into
   *  dashCooldown / whirlCooldown / flameCooldown / clapCooldown / poundCooldown; Plow applies it to the slam cooldown. Every
   *  cooldown is floored at MIN_COOLDOWN (config/upgrades.ts) after the multiplier. */
  cooldownMult: number;
  frostCore: boolean;
  avalancheCore: boolean;
}

/* ------------------------------------------------------------------ world */

export interface SnowFieldAPI {
  /** Edge length of the square field (SNOW_FIELD_SIZE). */
  readonly size: number;
  /** Snow depth (m) at a world position; 0 outside the field. */
  getDepth(x: number, z: number): number;
  /** Remove snow under a line segment (a blade) of the given thickness. `fraction` (0..1) of the
   *  depth is removed in cells touched. Returns the removed volume in m^3. */
  plowLine(x1: number, z1: number, x2: number, z2: number, thickness: number, fraction: number): number;
  /** Remove snow in a disc. Returns removed volume in m^3. */
  collectDisc(x: number, z: number, radius: number, fraction: number): number;
  /** Deposit `volume` m^3 of snow spread over a disc (shattered balls, side-spill). */
  addSnow(x: number, z: number, radius: number, volume: number): void;
  /** Melt snow in a disc: removes up to `amount` m of depth at the center, falling off to 0 at the edge. */
  melt(x: number, z: number, radius: number, amount: number): void;
  /** Remaining snow volume as a fraction of the zone's initial volume (0..1+). */
  totalSnowFraction(): number;
  /** Refill to the zone's initial depth (with gentle natural variation) and apply zone tint. */
  reset(zone: ZoneDef): void;
  /** Regenerates snow and pushes changed heights to the GPU. */
  update(dt: number): void;
}

export interface WorldAPI {
  /** Apply sky, fog, lights, arena walls/gates and themed decoration for the zone. */
  setZone(zone: ZoneDef): void;
  /** Falling snow particles, subtle ambient animation, gate lights. */
  update(dt: number): void;
  /** Flash/open the gate with this index (0..2) — call when a bot drives in through it. No-op in Brawl. */
  openGate(index: number): void;
  /** Solid circle obstacles inside the ARENA (empty in the campaign; pillars/containers/rocks in Brawl).
   *  Every vehicle must collide with these. Rebuilt by setZone. */
  readonly obstacles: readonly Obstacle[];
}

/* ------------------------------------------------------------------ player */

export interface PlowAPI {
  readonly object: THREE.Object3D;
  readonly position: THREE.Vector3;
  heading: number;
  /** Signed forward speed, m/s. */
  speed: number;
  /** Collision radius, m. */
  readonly radius: number;
  hp: number;
  maxHp: number;
  /** True once hp reaches 0 (wreck animation plays; Game ends the run shortly after). */
  readonly dead: boolean;
  /** Radius of the snowball currently held on the blade (0 = none). */
  readonly heldBallRadius: number;
  /** 0..1 recharge of the SHIFT dash (1 = ready). */
  readonly dashReady: number;
  /** 0..1 recharge of the E whirl (1 = ready). */
  readonly whirlReady: number;
  readonly dashing: boolean;
  readonly whirling: boolean;
  /** Spawn protection / dash start i-frames: Combat.hitPlow ignores damage while true. */
  readonly invulnerable: boolean;
  /** 0..1 growth of the BRUTUS Buzzsaw halos (0 = idle or no saws). Grows with saw spin, which rises with plow
   *  speed and saw fury; Combat widens the saw reach with it. */
  readonly sawHalo: number;
  /** Build Buzzsaw fury from damage dealt and taken (spins the saws up). No-op without the saws. */
  feedSawFury(dealt: number, taken: number): void;
  /** World-space position of the front of the blade (where the held ball sits). */
  getBladeTip(out: THREE.Vector3): THREE.Vector3;
  getForward(out: THREE.Vector3): THREE.Vector3;
  /** Apply FINAL damage (reductions already applied by Combat.hitPlow). Red flash; sets dead at 0 hp
   *  and emits 'plowDestroyed'. Ignored once dead. */
  damage(amount: number): void;
  /** Remove `fraction` of the held ball's volume; returns the removed volume (m^3). */
  stealSnow(fraction: number): number;
  /** External impulse (m/s) on the plow, e.g. knockback. Decays quickly. */
  push(vx: number, vz: number): void;
  /** Full hp, alive, no ball, zero speed, at `at` (default PLOW_SPAWN). Brawl respawns pass a spawn point
   *  and get 2s of spawn protection (invulnerable + blink). */
  reset(at?: { x: number; z: number; heading: number }): void;
  /** Re-read stats (max hp, blade width visual, etc.). Keeps hp ratio. */
  applyStats(stats: PlayerStats): void;
  /** Reads ctx.input: drive, plow snow into the held ball, SPACE slam, SHIFT dash, E whirl.
   *  Collides with ARENA walls and ctx.world.obstacles. */
  update(dt: number): void;
}

/** Melee damage resolution shared by the player and the bots. */
export interface CombatAPI {
  /** A bot's melee attack hits the plow. Applies, in order: shield (if the attacker is within ±60° of the
   *  plow's front and a ball is held, stats.shieldBlock of the damage is blocked and the ball loses snow
   *  in proportion), 50% reduction while dashing, stats.damageTaken. Then plow.damage(final), knockback
   *  via plow.push away from (fromX, fromZ) scaled by opts.knockback (m/s, default 6), fx + audio + shake,
   *  emits 'plowDamaged'. `unblockable` skips the shield (shockwaves, spins). Returns 0 and does nothing while
   *  plow.invulnerable. Returns final damage. */
  hitPlow(amount: number, fromX: number, fromZ: number, opts?: { knockback?: number; unblockable?: boolean }): number;
  /** The plow's front rammed `enemy` at `closingSpeed` m/s (called by the enemy manager on contact).
   *  Normal ram: stats.ramDamage * clamp(closingSpeed / 10, 0.3, 1.8) + ball bonus (6 * r^2 * damageMult).
   *  DASH STRIKE (plow.dashing): 25 + stats.ramDamage * 1.8 + ball bonus, huge knockback, big hit-stop/shake —
   *  dashes must feel devastating. The held ball loses 10% volume. Applied via ctx.enemies.damage(...,
   *  {source: 'ram'}). Returns the raw damage. Contact handlers must NOT kill the plow's speed while it is
   *  dashing (the dash plows through). */
  playerRam(enemy: EnemyHandle, closingSpeed: number): number;
  /** F-ability recharge 0..1 (Inferno on Classic, Thunderclap on VOLT-9, Ground Pound on BRUTUS), or -1 when
   *  not owned. */
  readonly flameReady: number;
  /** Battery Shield fraction 0..1, or -1 when not owned. */
  readonly shieldFrac: number;
  /** ISOTOPE Critical Mass 0..1 (1 = the next F is a NUKE), or -1 on other plows. */
  readonly critMass: number;
  /** Thunderclap Overload heat right now (+1 per clap, bleeds off over time; 0 = cool), or -1 when not on VOLT-9. */
  readonly overloadHeat: number;
  /** Self-damage the NEXT Thunderclap would deal at the current heat (capped so it leaves 1 HP); 0 off VOLT-9. */
  readonly overloadCost: number;
  /** Reset combat state. `betweenRounds` (round / wave cleared mid-run) keeps run-long meters like ISOTOPE's
   *  Critical Mass; a new run clears everything. */
  clear(betweenRounds?: boolean): void;
  update(dt: number): void;
}

/* ------------------------------------------------------------------ enemies */

export interface EnemyHandle {
  readonly id: number;
  readonly type: EnemyType;
  readonly position: THREE.Vector3;
  readonly radius: number;
  readonly mass: number;
  hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  readonly isBoss: boolean;
}

export interface DamageOpts {
  /** Knockback velocity (m/s, horizontal); the manager divides by the enemy's mass. */
  knockback?: THREE.Vector3;
  freezeSeconds?: number;
  /** Hard stun (bot stops and can't attack), e.g. BRUTUS Ground Pound. Bosses take half. */
  stunSeconds?: number;
  source?: 'slam' | 'ram' | 'whirl' | 'other';
  /** Attacker position — used for directional armor (Brute front plate, Frostbyte ball block). */
  fromX?: number;
  fromZ?: number;
  /** Radius of the player's slammed ball (for Frostbyte's ball CLASH). */
  ballRadius?: number;
}

export interface EnemyManagerAPI {
  spawn(type: EnemyType, x: number, z: number, opts?: { hpMult?: number; heading?: number }): EnemyHandle;
  /** Living enemies whose collision circle overlaps the given circle. Reuses `out` if provided. */
  query(x: number, z: number, radius: number, out?: EnemyHandle[]): EnemyHandle[];
  /** Callers pass RAW damage. The manager applies armor (min 1), directional armor, and vulnerability
   *  multipliers (stunned / overheated / dizzy / exposed). Returns true if this killed the enemy.
   *  On hit: emits 'enemyHit'. On kill: emits 'enemyKilled' (+ 'bossDefeated' for bosses), spawns coins
   *  via ctx.pickups.spawnCoins, plays fx/audio. */
  damage(enemy: EnemyHandle, amount: number, opts?: DamageOpts): boolean;
  aliveCount(): number;
  /** Living bosses (for the HUD boss bars). */
  readonly bosses: readonly EnemyHandle[];
  clear(): void;
  /** AI, movement, wall clamping, bot-bot separation, plow contact resolution (see Enemies.ts). */
  update(dt: number): void;
}

export interface WaveDirectorAPI {
  /** Begin spawning zone.rounds[roundIndex] through ENEMY_GATES. Enemy hp is scaled by zone.enemyHpMult. */
  start(zone: ZoneDef, roundIndex: number): void;
  /** True once every enemy of the round has spawned and none are alive. */
  readonly done: boolean;
  /** Enemies still to spawn + alive. */
  readonly remaining: number;
  clear(): void;
  update(dt: number): void;
}

/* ------------------------------------------------------------------ fx / audio / pickups / camera */

export interface PickupsAPI {
  /** Spawn coin pickups worth `amount` total near pos (split into a few coins). Collected coins call
   *  ctx.progression.addCoins and emit 'coinCollected'. Coins within stats.magnetRadius fly to the plow. */
  spawnCoins(pos: THREE.Vector3, amount: number): void;
  /** Instantly collect all remaining coins (end of round). Returns the amount collected. */
  collectAll(): number;
  clear(): void;
  update(dt: number): void;
}

export interface SparkOpts {
  count?: number;
  /** Base colour (default hot orange). Sparks start white-hot and cool to it. */
  color?: number;
  speed?: number;
  /** 0 = tight jet along `dir`, 1 = full sphere. Default 0.55 with a dir, 1 without. */
  spread?: number;
  /** Streak width in metres (default 0.08). */
  size?: number;
  /** Streak length as seconds of velocity (default 0.035; clamped to 1.6 m). */
  length?: number;
  gravity?: number;
  life?: number;
}

export interface SmokeOpts {
  count?: number;
  color?: number;
  /** Start radius in metres; the puff grows to size * grow over its life. */
  size?: number;
  grow?: number;
  life?: number;
  /** Random velocity magnitude (radial: outward speed in XZ). */
  speed?: number;
  /** Upward velocity bias. */
  up?: number;
  /** Buoyancy (m/s^2 up; negative settles). */
  rise?: number;
  drag?: number;
  /** Spawn jitter radius. */
  spread?: number;
  opacity?: number;
  /** 0 = normal alpha (smoke, dust, powder), 1 = additive glow (fire, flash). */
  additive?: number;
  /** Velocities fan out flat in XZ (ground shock clouds). */
  radial?: boolean;
  /** Added velocity bias. */
  dir?: THREE.Vector3;
}

export interface PowderOpts {
  /** Overall scale (1 = a plain slam). */
  size?: number;
  color?: number;
}

export interface SmolderOpts {
  /** Emission time (default 2.5 s); the smoke itself lingers ~2 s longer. */
  seconds?: number;
  /** Size of the wreck (1 = a plow-sized bot). */
  scale?: number;
}

export interface FxAPI {
  /** Tumbling chunks. Routing: rising bursts (gravity < 0) render as soft puffs (saturated colours glow);
   *  small (size <= 0.12), short (life <= 0.6), coloured bursts render as streak sparks. */
  burst(pos: THREE.Vector3, opts?: { color?: number; count?: number; speed?: number; size?: number; gravity?: number; life?: number }): void;
  /** Thin additive streaks stretched along their velocity. `dir` biases them into a cone (null = upward sphere). */
  sparks(pos: THREE.Vector3, dir: THREE.Vector3 | null, opts?: SparkOpts): void;
  /** Soft camera-facing puffs that grow and fade (smoke, dust, steam, fire glow). */
  smoke(pos: THREE.Vector3, opts?: SmokeOpts): void;
  /** Snow powder cloud for impacts: an outward ground surge, a lazy column and fine flakes. */
  powder(pos: THREE.Vector3, opts?: PowderOpts): void;
  /** Fireball flash + a kick of dark smoke (explosions, wrecks). */
  fireball(pos: THREE.Vector3, scale?: number): void;
  /** Dark soot decal on the snow; fades over ~8 s. */
  scorch(pos: THREE.Vector3, radius: number, strength?: number): void;
  /** A wreck that keeps smoking: dark rising smoke column, flames and embers for `seconds`. */
  smolder(pos: THREE.Vector3, opts?: SmolderOpts): void;
  /** Snow kicked up by a blade. `intensity` 0..1. Call every frame while plowing. */
  spray(pos: THREE.Vector3, dir: THREE.Vector3, intensity: number): void;
  /** Floating damage numbers / labels projected to screen. */
  floatText(pos: THREE.Vector3, text: string, color?: string, size?: number): void;
  /** Ring shockwave on the ground (slams, stomps). */
  ring(pos: THREE.Vector3, radius: number, color?: number): void;
  /** Camera shake, intensity ~0.1 (tiny) .. 1.5 (huge). Delegates to ctx.cameraRig. */
  shake(intensity: number): void;
  clear(): void;
  update(dt: number): void;
}

export interface CameraRigAPI {
  /** 'follow' chases the plow (behind & above, looking ahead). 'menu' slowly orbits the arena. */
  setMode(mode: 'follow' | 'menu'): void;
  /** Jump to the target pose immediately (after reset/respawn). */
  snap(): void;
  addShake(intensity: number): void;
  /** Directional impact kick: shove the camera `amount` m along the horizontal unit (dx, dz) and let it spring back.
   *  Scaled by the settings shake slider. */
  kick(dx: number, dz: number, amount: number): void;
  /** Short impact FOV punch in degrees (negative = zoom in), separate from the dash kick. Scaled by the shake slider. */
  punchFov(degrees: number): void;
  update(dt: number): void;
}

/** Impact feel kinds (see fx/impact.ts for the per-kind light colour, hit-stop and camera numbers). */
export type ImpactKind = 'slam' | 'wreck' | 'kill' | 'bossHit' | 'bossKill' | 'pound' | 'clap' | 'meltdown' | 'nuke' | 'player';

export interface ImpactOpts {
  /** false = light + camera only, no hit-stop (rival-vs-rival effects, slams that hit nothing). */
  stop?: boolean;
  /** 0..1 extra camera-kick attenuation (e.g. Brawl hearing falloff). */
  falloff?: number;
}

/** Hit-stop / slow-mo time scale, impact lights, camera punches and the flash / damage-vignette overlay. */
export interface ImpactAPI {
  /** false disables the hit-stop / slow-mo time scale (visuals still play). */
  enabled: boolean;
  /** True while a hit-stop or slow-mo plays (the round-clear waits for it). */
  readonly holding: boolean;
  hit(kind: ImpactKind, pos: THREE.Vector3, strength?: number, opts?: ImpactOpts): void;
  /** The player lost `damage` HP to an attacker at (fromX, fromZ). */
  playerHit(damage: number, fromX: number, fromZ: number): void;
  slowMo(seconds?: number): void;
  /** Returns this tick's sim time scale and advances the timers by real seconds. */
  step(realDt: number): number;
  update(dt: number): void;
  clear(): void;
}

export type SoundName =
  | 'slam' | 'hit' | 'kill' | 'strike' | 'coin' | 'plowHit' | 'block' | 'ram' | 'dash' | 'whirl' | 'clash'
  | 'burst' | 'explosion' | 'roundStart' | 'roundClear' | 'buy' | 'click' | 'error' | 'boss' | 'roar'
  | 'charge' | 'stun' | 'shockwave' | 'wallHit' | 'steal' | 'bossDefeated' | 'gameOver' | 'victory'
  | 'freeze' | 'countdown'
  // Brawl mode
  | 'streak' | 'shutdown' | 'respawn' | 'heal' | 'dashStrike' | 'whirlTick'
  // VOLT-9
  | 'zap' | 'thunder'
  // BRUTUS
  | 'thud'
  // Paint Shop horns (slam sound cosmetics)
  | 'hornAir' | 'hornClown' | 'hornBoom' | 'hornBell' | 'hornPixel';

export interface AudioAPI {
  /** Resume/create the AudioContext; call from a user gesture. Safe to call repeatedly. */
  unlock(): void;
  play(name: SoundName, opts?: { volume?: number; pitch?: number }): void;
  /** Continuous engine hum: throttle -1..1, speedFrac 0..1. */
  setEngine(throttle: number, speedFrac: number): void;
  /** Continuous crunch/whoosh while plowing snow, intensity 0..1 (0 = silent). */
  setPlowing(intensity: number): void;
  /** Gentle procedural background music / wind. */
  setMusic(on: boolean): void;
  /** Settings-menu volume sliders, each 0..1. */
  setVolumes(master: number, music: number, sfx: number): void;
  muted: boolean;
}

/* ------------------------------------------------------------------ UI */

export interface HudBoss {
  name: string;
  title: string;
  hp: number;
  maxHp: number;
}

export interface HudState {
  zoneName: string;
  round: number; // 1-based
  totalRounds: number;
  bossRound: boolean;
  enemiesRemaining: number;
  plowHp: number;
  plowMaxHp: number;
  ballRadius: number;
  ballMaxRadius: number;
  coins: number;
  /** 0..1 (1 = ready). */
  dashReady: number;
  /** 0..1, or -1 when Whirlwind is not owned. */
  whirlReady: number;
  /** 0..1 F-ability recharge (Inferno or Thunderclap), or -1 when not owned. */
  flameReady: number;
  /** What F does right now (icon). */
  fAbility: 'fire' | 'zap' | 'pound' | 'meltdown';
  /** Battery Shield 0..1, or -1 when not owned. */
  shield: number;
  /** ISOTOPE Critical Mass 0..1 (1 = NUKE ready), or -1 on other plows. */
  critMass?: number;
  /** Thunderclap Overload heat (CombatAPI.overloadHeat; -1 = hidden) and the next clap's predicted self-damage. */
  overload?: number;
  overloadCost?: number;
  snowFraction: number;
  bosses: HudBoss[];
  /** Consecutive hits without a 2.5s gap (0/1 = no combo). */
  combo: number;
  /** Seconds left in the pre-round countdown, or 0. */
  countdown: number;
  /** Brawl mode HUD data, or null in the campaign. */
  brawl: BrawlHud | null;
  /** Survival mode wave line (current wave + best), or null/absent outside Survival. */
  survival?: { wave: number; best: number } | null;
  /** Hide the round / wave counter + pips (Tutorial). */
  hideRound?: boolean;
}

/* ------------------------------------------------------------------ Brawl (free-for-all) mode */

export type BrawlDifficulty = 'rookie' | 'pro' | 'legend';

export interface BrawlEntry {
  name: string;
  /** CSS color of this fighter (name tag, kill feed, minimap blip). */
  color: string;
  kills: number;
  deaths: number;
  streak: number;
  bestStreak: number;
  isPlayer: boolean;
  alive: boolean;
}

export interface BrawlHud {
  timeLeft: number;
  killTarget: number;
  /** Sorted by kills desc, then deaths asc. */
  leaderboard: BrawlEntry[];
  /** 1-based rank of the player in the leaderboard. */
  playerRank: number;
  playerStreak: number;
  /** Current coin multiplier from the player's streak (1, 1.5, 2, 3, 4). */
  streakMult: number;
  /** Seconds until the player respawns (0 while alive). */
  respawnIn: number;
  /** Who wrecked the player last (shown on the respawn overlay), or ''. */
  killedBy: string;
  /** Minimap data (world coords). */
  arenaHalf: number;
  me: { x: number; z: number; heading: number };
  blips: { x: number; z: number; color: string; bounty: boolean }[];
  pickups: { x: number; z: number }[];
  obstacles: readonly Obstacle[];
}

export interface BrawlResult {
  difficulty: BrawlDifficulty;
  /** 1-based final placement of the player. */
  placement: number;
  total: number;
  kills: number;
  deaths: number;
  bestStreak: number;
  /** Coins earned during the match (kills, streak multipliers, shutdowns) + placement bonus. */
  coinsEarned: number;
  placementBonus: number;
  leaderboard: BrawlEntry[];
}

/** Brawl mode: the player + N named rival bot plows in a huge arena, everyone hunting everyone.
 *  Implements EnemyManagerAPI so the player's slam/ram/whirl code (which uses ctx.enemies.query/damage)
 *  works unchanged — Game swaps ctx.enemies to this manager during a brawl. Any ctx.enemies.damage() call
 *  comes from the PLAYER (kill credit). Rivals damage the player only via ctx.combat.hitPlow. */
export interface BrawlAPI extends EnemyManagerAPI {
  /** Reset scores, spawn the player via ctx.plow.reset(spawnPoint) and the rivals at spread-out spawn points,
   *  start the match timer. Rivals stay idle until activate() (pre-match countdown). */
  start(difficulty: BrawlDifficulty): void;
  /** Countdown finished: rivals start fighting. */
  activate(): void;
  /** True once the timer hits 0 or someone reaches the kill target. */
  readonly over: boolean;
  readonly result: BrawlResult | null;
  /** Run the match clock by `seconds` of real time the sim skipped (hit-stop / slow-mo keep the timer real-time). */
  tickClock(seconds: number): void;
  /** Live HUD data. May reuse objects between calls — consume immediately. */
  hud(): BrawlHud;
}

export interface RunSummary {
  zoneName: string;
  bossName: string;
  roundsCleared: number;
  totalRounds: number;
  bossDefeated: boolean;
  coinsEarned: number;
  kills: number;
  bestCombo: number;
  biggestBall: number;
  firstClear: boolean;
  clearReward: number;
  unlockedZoneName: string | null;
  /** Campaign run on the arena's Hard mode / Survival run was the Daily. */
  hard?: boolean;
  daily?: boolean;
  /** Survival run result (wave reached, best, new record); absent for campaign runs. */
  survival?: { wave: number; best: number; newBest: boolean; endedEarly?: boolean };
}

export interface SurvivalShopOpts {
  /** Wave just cleared (1-based). */
  cleared: number;
  /** Boss lineup name if the next wave is a boss wave. */
  nextBoss: string | null;
  /** Special wave coming next (Swarm, Blitz, ...), if any. */
  nextSpecial: { name: string; icon: string; blurb: string } | null;
  /** Coins for a Full Repair. */
  repairCost: number;
  /** True while the plow is below max HP (repair offered). */
  canRepair(): boolean;
  /** Attempt the repair; returns true if it went through. */
  onRepair(): boolean;
  onContinue(): void;
  /** Bank the run here (records the wave cleared as the result) and go to the results screen. */
  onEndRun(): void;
}

export interface UIHandlers {
  /** `hard`: the arena's Hard mode (meta/challenges.ts). */
  onStartZone(zoneIndex: number, hard?: boolean): void;
  onStartBrawl(difficulty: BrawlDifficulty): void;
  /** Endless Survival mode (unlocked after arena 1). */
  onStartSurvival?(): void;
  /** Today's seeded Daily Survival run (meta/daily.ts). */
  onStartDaily?(): void;
  /** Guided tutorial in arena 1 (auto-runs on a fresh save; replayable from the menu). */
  onStartTutorial?(): void;
  onResume(): void;
  onQuitToMenu(): void;
  onRetry(): void;
  onResetSave(): void;
  onToggleMute(): void;
}

export interface UIAPI {
  showMainMenu(): void;
  showZoneSelect(): void;
  /** Upgrade garage reachable from the main menu. */
  showGarage(): void;
  /** Between-round upgrade shop. `nextRound` is 1-based. Calls onContinue when the player is ready. */
  showShop(nextRound: number, totalRounds: number, onContinue: () => void): void;
  /** Survival between-wave shop: Garage upgrades + an optional one-off Full Repair. Calls onContinue on NEXT WAVE. */
  showSurvivalShop(opts: SurvivalShopOpts): void;
  showPause(): void;
  showGameOver(summary: RunSummary): void;
  showVictory(summary: RunSummary): void;
  hideOverlays(): void;
  setHudVisible(visible: boolean): void;
  updateHud(state: HudState): void;
  toast(text: string, kind?: 'info' | 'good' | 'bad' | 'big'): void;
  /** Non-blocking cinematic boss intro card (name + title), ~2.5s, e.g. "BOSS ROUND  BULLDOZA — The Yard Boss". */
  bossIntro(name: string, title: string): void;
  /** Brawl mode lobby: rules + difficulty pick -> handlers.onStartBrawl(difficulty). */
  showBrawlLobby(): void;
  /** Brawl match results: placement, final leaderboard, coins. Buttons: Rematch (same difficulty), Garage, Menu. */
  showBrawlResults(result: BrawlResult): void;
  /** True if any blocking overlay (menu/shop/pause/...) is open. */
  readonly overlayOpen: boolean;
}

/* ------------------------------------------------------------------ context */

/** Shared context handed to every system's constructor.
 *  IMPORTANT: in constructors only touch renderer/scene/camera/events/input/progression/stats/zone —
 *  other systems may not be constructed yet. Access them lazily (inside methods / update). */
export interface GameContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  events: EventBus;
  input: Input;
  progression: Progression;
  /** Current computed stats; replaced (new object) when upgrades change. */
  stats: PlayerStats;
  zone: ZoneDef;
  world: WorldAPI;
  snow: SnowFieldAPI;
  plow: PlowAPI;
  combat: CombatAPI;
  /** The active enemy manager: the campaign EnemyManager, or the BrawlManager during a brawl. */
  enemies: EnemyManagerAPI;
  /** The Brawl mode manager (always constructed; idle outside brawls). */
  brawl: BrawlAPI;
  waves: WaveDirectorAPI;
  pickups: PickupsAPI;
  fx: FxAPI;
  cameraRig: CameraRigAPI;
  impact: ImpactAPI;
  audio: AudioAPI;
  ui: UIAPI;
  /** Seconds of game time elapsed (pauses with the game). */
  time: number;
}

export type { UpgradeId, EnemyType, ZoneDef };
