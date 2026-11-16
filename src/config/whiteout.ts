/**
 * THE WHITEOUT (PROTOCOL C finale; docs/modes.md "Protocol C", plan stage 4): tuning + the pure rules the director
 * (core/whiteoutDirector.ts) runs on. Agreed with the user:
 *  - STORM HEARTS make it ANGRIER as they break (3, then 4, then 5 a cycle): every broken Heart raises the escalation
 *    for the rest of the fight (stronger gusts, faster shard rain, more snow copies, shorter gaps). It never eases.
 *  - The last Heart of a cycle STAGGERS it: the giant leans over the north stand and its eye crashes onto the stand
 *    front at arena level for STAGGER_T s: full damage + a bonus from everything.
 *  - The plow is only hurt by telegraphed attacks: ICE SHARD RAIN (rings fill, the shards stay a moment as obstacles),
 *    VORTEX ARM sweeps (a lane telegraph, then the column runs it), GUSTS (push, no damage), GLARE (a slow spot chases
 *    the plow: caught = a short daze with frost), and snow copies of the bosses (weak echoes, white hologram).
 *  - The eye opens now and then between staggers: ranged chip at EYE_CHIP x (a bonus, never required). Closed it is
 *    sealed. At AVALANCHE_AT of its HP the fight hands over to THE AVALANCHE (the giant snowball; then THE IMPLOSION).
 */

export const WO = {
  /* ---- the takeover (after THE CHAIRMAN's wreck), seconds from its start */
  /** The echoes freeze into snow statues, then shatter one after another (STATUE_GAP apart). */
  STATUE_T: 1.4,
  STATUE_GAP: 0.22,
  /** The sky goes black over SKY_T. */
  SKY_T: 1.6,
  /** The giant rises behind the north stand (RISE_AT .. RISE_AT + RISE_T; the camera looks up at it from ~RISE_AT). */
  RISE_AT: 2.6,
  RISE_T: 4.8,
  /** Its eye opens, the boss card, the EYE bot (its boss bar) and the FINALE checkpoint. */
  ROAR_AT: 7.2,
  /** The first STORM HEARTS form. */
  HEARTS_AT: 8.8,

  /* ---- hearts and staggers */
  /** Hearts per cycle (the last entry repeats). */
  HEARTS: [3, 4, 5] as readonly number[],
  /** Each broken Heart knocks this share of the eye's max HP off (the giant reels; keeps every pilot moving). */
  HEART_CHIP: 0.03,
  /** The eye crashing onto the stand front (a STAGGER's start) knocks this share of its max HP off. */
  CRASH_CHIP: 0.05,
  /** Storm Heart HP x the zone's enemy HP multiplier (config/enemies.ts stormheart base HP). */
  HEART_HP: 4,
  /** Hearts spawn at least this far from the plow (m) when a spot allows it. */
  HEART_CLEAR: 8,
  /** STAGGER: the lean-in (s, the eye travels to the stand front), the window (s), the recovery (s). */
  LEAN_T: 1.7,
  STAGGER_T: 7,
  RECOVER_T: 2.2,
  /** Damage multipliers on the eye: open between staggers (chip), in the STAGGER window (bonus). */
  EYE_CHIP: 0.3,
  EYE_STAGGER: 1.3,
  /** Between staggers the eye opens for EYE_OPEN_T s after every EYE_CLOSED_T s closed (and during a glare). */
  EYE_CLOSED_T: 7,
  EYE_OPEN_T: 3.6,
  /** The EYE's HP x THE CHAIRMAN's (same scaling: config/protocol.ts protocolBossHp). */
  EYE_HP_K: 1.3,
  /** At this share of its max HP: THE AVALANCHE. The eye never goes lower: only the giant snowball finishes it. */
  AVALANCHE_AT: 0.25,

  /* ---- escalation: anger 0..1 = broken Hearts / ANGER_FULL (cumulative, never resets) */
  ANGER_FULL: 12,
  /** Gap between the main attacks (shards / sweep / glare), s: calm .. furious. */
  GAP: [3.0, 1.5] as readonly [number, number],
  /** First attack after a cycle's Hearts form (s). */
  FIRST_ATTACK: 2.2,

  /** ICE SHARD RAIN: telegraph (ring fills; the shard falls in the last SHARD_FALL s), shards per volley, radius,
   *  damage (x the eye's outgoing scaling), how long a landed shard stands as an obstacle, landing stagger. */
  SHARD_TELE: [1.6, 1.15] as readonly [number, number],
  SHARD_FALL: 0.42,
  SHARDS: [4, 10] as readonly [number, number],
  SHARD_R: 2.2,
  SHARD_DMG: 24,
  SHARD_STAY: 3,
  SHARD_STEP: 0.12,
  /** Scatter radius around the plow (m) and the minimum spacing of the rings. */
  SHARD_SPREAD: 13,
  SHARD_SPACING: 3.6,

  /** VORTEX ARM: lane telegraph (s), the column's run along it (s), lane half-width (m), damage, knockback (m/s);
   *  from DOUBLE_AT anger the other arm follows with a second lane SWEEP_SECOND s later. */
  SWEEP_TELE: 1.7,
  SWEEP_T: 1.05,
  SWEEP_HW: 2.6,
  SWEEP_DMG: 34,
  SWEEP_KNOCK: 16,
  DOUBLE_AT: 0.5,
  SWEEP_SECOND: 1.3,

  /** GUSTS (a separate timer: they ride under the other attacks): streak telegraph (s), the gust (s), its pull (x the
   *  plow's top speed, calm .. furious), the gap between gusts (s, calm .. furious). No damage. */
  GUST_TELE: 1.3,
  GUST_T: 2.6,
  GUST_FRAC: [0.3, 0.62] as readonly [number, number],
  GUST_GAP: [13, 7] as readonly [number, number],
  FIRST_GUST: 6,

  /** GLARE: the eye charges (s), then a spot chases the plow (s) at GLARE_SPEED m/s (calm .. furious); caught (inside
   *  GLARE_R) = a daze of DAZE s (once per glare), frost on the plow. */
  GLARE_CHARGE: 1.3,
  GLARE_T: 3.4,
  GLARE_SPEED: [4.6, 6.6] as readonly [number, number],
  GLARE_R: 2.1,
  DAZE: 1.0,

  /** Snow copies: gap between copies (s, calm .. furious), how many may stand at once (calm .. furious), their HP
   *  (x the boss's home-arena HP x the zone's), outgoing damage x. */
  COPY_GAP: [15, 7.5] as readonly [number, number],
  COPY_MAX: [1, 3] as readonly [number, number],
  COPY_HP: 0.14,
  COPY_DMG: 0.6,
  FIRST_COPY: 9,
} as const;

/** Bosses a snow copy can be. */
export const COPY_TYPES = ['frostbyte', 'bulldoza', 'grinder', 'donald', 'omega'] as const;

/** Main attacks (one at a time; gusts and copies run on their own timers). */
export type WhiteoutAttack = 'shards' | 'sweep' | 'glare';

/** Escalation 0..1 from the Hearts broken so far. */
export function angerFrom(broken: number): number {
  return Math.max(0, Math.min(1, broken / WO.ANGER_FULL));
}

/** Linear calm .. furious. */
export function byAnger(range: readonly [number, number], anger: number): number {
  return range[0] + (range[1] - range[0]) * Math.max(0, Math.min(1, anger));
}

/** Hearts formed in cycle `c` (0-based): 3, 4, then 5 every cycle after. */
export function heartsForCycle(c: number): number {
  const H = WO.HEARTS;
  return H[Math.max(0, Math.min(H.length - 1, Math.floor(c)))];
}

/** Shards per volley at `anger`. */
export function shardCount(anger: number): number {
  return Math.round(byAnger(WO.SHARDS, anger));
}

/** Snow copies allowed on the floor at once at `anger`. */
export function copyCap(anger: number): number {
  return Math.round(byAnger(WO.COPY_MAX, anger));
}

/** Eye states (EYE bot damage rules): 'sealed' (closed / moving: untouchable), 'open' (high, between staggers: chip),
 *  'stagger' (on the stand front: full + bonus). */
export type EyeState = 'sealed' | 'open' | 'stagger';

/** Damage-taken multiplier of the EYE in each state (sealed: no damage at all: the bot is scripted). */
export function eyeDamageMult(s: EyeState): number {
  return s === 'stagger' ? WO.EYE_STAGGER : s === 'open' ? WO.EYE_CHIP : 0;
}

/** The next main attack: never the same twice in a row; a glare only once the eye can be seen (`glareOk`). `r` in
 *  [0, 1) picks among the rest (shards weigh double: the bread and butter). Pure (tests). */
export function pickAttack(last: WhiteoutAttack | null, r: number, glareOk = true): WhiteoutAttack {
  const opts: WhiteoutAttack[] = [];
  const push = (a: WhiteoutAttack, w: number) => {
    if (a === last || (a === 'glare' && !glareOk)) return;
    for (let i = 0; i < w; i++) opts.push(a);
  };
  push('shards', 2);
  push('sweep', 1);
  push('glare', 1);
  if (!opts.length) return 'shards';
  return opts[Math.min(opts.length - 1, Math.floor(Math.max(0, r) * opts.length))];
}

/** Ground spots Storm Hearts may stand on (the wave-7 floor: off the lava ring / vents, the decks, the ramps, the
 *  craters and the gate lanes), spread round the arena. */
export const HEART_SPOTS: readonly { x: number; z: number }[] = [
  { x: 0, z: 5 },
  { x: -7, z: -6 },
  { x: 7, z: -6 },
  { x: -16, z: 8 },
  { x: 16, z: 8 },
  { x: -9, z: -16 },
  { x: 9, z: -16 },
  { x: 0, z: 16 },
  { x: -24, z: 3 },
  { x: 24, z: 3 },
  { x: -15, z: 21 },
  { x: 15, z: 21 },
];

/** Pick `n` Heart spots: spread out (greedy farthest-point from the first pick), each at least `clear` m from the plow
 *  at (px, pz) when enough spots allow it. `r` in [0, 1) varies the first pick. Pure (tests). */
export function pickHeartSpots(n: number, px: number, pz: number, r: number, clear: number = WO.HEART_CLEAR, out: { x: number; z: number }[] = []): { x: number; z: number }[] {
  out.length = 0;
  const far = HEART_SPOTS.filter((s) => Math.hypot(s.x - px, s.z - pz) >= clear);
  const pool = far.length >= n ? far : HEART_SPOTS.slice();
  if (!pool.length || n <= 0) return out;
  out.push(pool[Math.min(pool.length - 1, Math.floor(Math.max(0, r) * pool.length))]);
  while (out.length < Math.min(n, pool.length)) {
    let best = pool[0];
    let bd = -1;
    for (const s of pool) {
      if (out.includes(s)) continue;
      let d = Infinity;
      for (const o of out) d = Math.min(d, Math.hypot(s.x - o.x, s.z - o.z));
      if (d > bd) {
        bd = d;
        best = s;
      }
    }
    out.push(best);
  }
  return out;
}

/** Where the EYE (bot) stands: high, between staggers (a hit spot past the north wall: ranged attacks reach it, rams
 *  and the wall don't), and on the stand front in a STAGGER (in front of the north gate, its 3.4 m radius well inside
 *  rammer reach; the giant draws the eye there: world/protocol/WhiteoutGiant.ts EYE_DOWN_POS). */
export const EYE_HIGH = { x: 0, z: -35 } as const;
export const EYE_DOWN = { x: 0, z: -29.6 } as const;

/* ------------------------------------------------------------------ THE AVALANCHE + the ending */

/**
 * THE AVALANCHE (at WO.AVALANCHE_AT of the eye's HP): the storm dumps deep snow on the arena, the eye comes down onto
 * the north stand front and stays there, and a GIANT SNOWBALL forms (entities/GiantSnowball.ts). Any plow pushes it
 * (contact: the plow's velocity), it rolls with drag, grows as it rolls through snow, picks up whatever lies on the
 * floor; gusts shove it, shards chip it, lava melts it. Rolled into the eye at FULL_R or more = the IMPLOSION ending;
 * smaller = it bursts into powder against the eye and a new ball forms from the snow left.
 */
export const AV = {
  /** The dump: extra snow depth (m, over the zone's 0.5) laid over DUMP_T s from the start. */
  DUMP: 0.6,
  DUMP_T: 2.2,
  /** The eye's descent onto the stand front (s) and when the first ball forms (s from the start). */
  DESCEND_T: 2.6,
  BALL_AT: 2.4,
  /** The ball: radius when it forms, the size that wins, below this it bursts; forming time (s). */
  START_R: 1.5,
  FULL_R: 3.3,
  /** It stops growing here (a bigger ball would hide the arena). */
  MAX_R: 4.2,
  MIN_R: 1.0,
  FORM_T: 0.8,
  /** Growth: m of radius per m rolled on snow as deep as REF_DEPTH (less on thinner snow, nothing on bare ground or a
   *  deck). Shrinks as it grows (a bigger ball needs more snow per cm): x 1 / (1 + GROW_FALLOFF x (r - START_R)). */
  GROW: 0.03,
  GROW_FALLOFF: 0.18,
  REF_DEPTH: 0.8,
  /** Its rolling drag (1/s) and the extra drag of a big ball (x r / FULL_R); slope pull (m/s^2 per unit gradient). */
  DRAG: 0.55,
  DRAG_BIG: 0.25,
  SLOPE: 9,
  /** Plow contact: the ball takes the plow's closing speed x PUSH (a touch more: it rolls clear), leaning toward the
   *  plow's heading by STEER; a plow pushing a full ball is held to HEAVY x its top speed. */
  PUSH: 1.08,
  STEER: 0.35,
  HEAVY: 0.82,
  /** A gust shoves it at GUST x the gust's pull (m/s^2 per unit frac x top speed). */
  GUST: 0.55,
  /** Shards: one landing on the ball (inside SHARD_R + r) knocks CHIP m off its radius. Lava melts LAVA m/s (a fresh
   *  ball survives ~1.4 s on it, a full one rolled across the ring loses a little: a hazard to steer round, not an
   *  instant burst when a gust or a bad bounce puts it there). */
  CHIP: 0.2,
  LAVA: 0.35,
  /** The arena edge is banked: within BANK_W m of the wall clamp the ball is pushed back in at BANK m/s^2 (it never
   *  sits pinned in a corner or along a wall where no plow can get behind it). */
  BANK: 5,
  BANK_W: 1.4,
  /** Shard volleys / gusts in THE AVALANCHE: the gap (s) and shards per volley (fewer than the fight: it's a push);
   *  every other volley drops one ring on the ball's path. */
  SHARD_GAP: 5.5,
  SHARDS: 3,
  GUST_GAP: 9,
  /** A burst ball forms again after RESPAWN_T s. */
  RESPAWN_T: 1.6,
  /** How close the ball's edge must come to the eye's (m: the eye bot's 3.4 m radius + this). */
  HIT_PAD: 0.4,
} as const;

/** THE IMPLOSION (the ending), seconds from the full-size ball reaching the eye. Stays night throughout. */
export const END = {
  /** The eye cracks (white light through the cracks, the giant convulses). */
  CRACK_T: 1.7,
  /** The whole storm is sucked into the eye (the giant collapses inward, wind reversing, the gale pulled in). */
  SUCK_T: 2.6,
  /** A held breath at the point, then it IMPLODES (a flash) and the shockwave of snow blasts out over WAVE_T s. */
  HOLD_T: 0.35,
  WAVE_T: 1.6,
  /** The beat of silence, then the phone lights pop on one by one over LIGHTS_T s with cheering, then the victory. */
  SILENCE_T: 1.9,
  LIGHTS_T: 4.2,
  OUTRO_T: 1.2,
  /** Snow the shockwave lays on the arena on top (m). */
  WAVE_SNOW: 0.35,
} as const;

/** Ending beats (s from its start). */
export const END_AT = {
  suck: END.CRACK_T,
  implode: END.CRACK_T + END.SUCK_T + END.HOLD_T,
  silence: END.CRACK_T + END.SUCK_T + END.HOLD_T + END.WAVE_T,
  lights: END.CRACK_T + END.SUCK_T + END.HOLD_T + END.WAVE_T + END.SILENCE_T,
  done: END.CRACK_T + END.SUCK_T + END.HOLD_T + END.WAVE_T + END.SILENCE_T + END.LIGHTS_T + END.OUTRO_T,
} as const;

/** The ball's new radius after rolling `ds` m over snow `depth` m deep (0 on bare ground / decks). Pure (tests). */
export function ballGrow(r: number, ds: number, depth: number): number {
  if (ds <= 0 || depth <= 0.02 || r >= AV.MAX_R) return r;
  const k = Math.min(1, depth / AV.REF_DEPTH);
  return Math.min(AV.MAX_R, r + (AV.GROW * ds * k) / (1 + AV.GROW_FALLOFF * Math.max(0, r - AV.START_R)));
}

/** 0..1 of the way from START_R to FULL_R (the HUD meter). */
export function ballFrac(r: number): number {
  return Math.max(0, Math.min(1, (r - AV.START_R) / (AV.FULL_R - AV.START_R)));
}

/** Big enough to finish the eye. */
export function ballFull(r: number): boolean {
  return r >= AV.FULL_R - 1e-6;
}
