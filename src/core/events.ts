import type * as THREE from 'three';
import type { BrawlDifficulty, EnemyHandle } from './types';
import type { PlowKind } from '../config/plows';

/** How the player landed a killing blow (campaign / survival / tutorial; Brawl kills omit it).
 *  'stomp' = landing on a bot, 'airSlam' = the slam-while-airborne shockwave, 'lava' = a bot burned in lava. */
export type KillSource = 'slam' | 'ram' | 'whirl' | 'other' | 'stomp' | 'airSlam' | 'lava';
/** The weapon behind a hit, where trophies need more than its KillSource ('arcLance' = VOLT-9's ARC LANCE, any hop). */
export type KillWeapon = 'arcLance';

/** Cross-cutting game events. Modules call ctx.audio / ctx.fx directly for their own feedback;
 *  events exist so Game/UI can track stats and show toasts without modules knowing about each other. */
export interface GameEvents {
  /** inLava: the bot was standing in lava when it died, whatever finished it (lava kills, see LIFE.killsLava).
   *  weapon: the finishing blow's DamageOpts.weapon (campaign / survival bots only; Brawl and the Duel never set it). */
  enemyKilled: { enemy: EnemyHandle; coins: number; source?: KillSource; inLava?: boolean; weapon?: KillWeapon };
  enemyHit: { enemy: EnemyHandle; damage: number };
  /** The player slammed their snowball. */
  slam: { hits: number; radius: number; position: THREE.Vector3 };
  /** The player fired their F ability (Inferno, Thunderclap, Ground Pound, Meltdown; `nuke` = ISOTOPE's NUKE). */
  ability: { nuke: boolean };
  /** One slam / whirl hit `count` (>= 3) bots. */
  strike: { count: number; position: THREE.Vector3 };
  plowDamaged: { amount: number; blocked: number };
  plowDestroyed: Record<string, never>;
  /** The player's plow left the ground at speed (m/s) and has been in the air long enough to count as a jump. */
  plowLaunched: { x: number; z: number; speed: number };
  /** The player's plow touched down after a real flight: impact = downward speed (m/s), airTime = flight seconds. */
  plowLanded: { x: number; y: number; z: number; impact: number; airTime: number };
  /** A bot / Brawl rival touched down after a flight (impact = downward speed, m/s). */
  enemyLanded: { enemy: EnemyHandle; impact: number };
  coinCollected: { amount: number };
  bossSpawned: { enemy: EnemyHandle; name: string; title: string };
  /** A boss entered a new phase / enraged (e.g. "ENRAGED!", "PHASE 2"). */
  bossPhase: { enemy: EnemyHandle; name: string; label: string };
  bossDefeated: { enemy: EnemyHandle; name: string };
  roundStarted: { round: number; total: number; boss: boolean };
  /** A campaign run, Survival run or Brawl match ended. Game emits it AFTER recording the result in the save.
   *  Not emitted for the Tutorial. */
  runFinished: {
    mode: 'campaign' | 'survival' | 'brawl';
    plow: PlowKind;
    /** Campaign: arena cleared (boss beaten). Brawl: 1st place. Survival: always false. */
    won: boolean;
    kills: number;
    /** Player kills by finishing blow (campaign / survival only; Brawl kills count as 'other'). */
    killsBy: Record<KillSource, number>;
    coins: number;
    bestCombo: number;
    biggestBall: number;
    /** Longest single flight this run (s). */
    airtime?: number;
    /** Kills on bots standing in lava, by any finishing blow (killsBy.lava only counts the lava's own burn). */
    lavaKills?: number;
    /** Seconds from the first countdown to the end, excluding pauses and shops. */
    duration: number;
    /** HP lost this run (after armor / shields). */
    damageTaken: number;
    /** Campaign: arena index, rounds cleared, Hard mode. */
    zoneIndex?: number;
    roundsCleared?: number;
    hard?: boolean;
    /** Campaign: HP lost during the boss round (after armor / shields); undefined if the boss round never started. */
    bossDamage?: number;
    /** Survival: wave reached, and whether this was the Daily run. */
    wave?: number;
    daily?: boolean;
    /** Brawl: placement (1 = win), best streak, lobby. */
    placement?: number;
    bestStreak?: number;
    brawlDifficulty?: BrawlDifficulty;
  };
  // ---- Brawl mode
  /** Kill feed entry. */
  brawlKill: {
    killer: string;
    killerColor: string;
    victim: string;
    victimColor: string;
    /** 'zap' = VOLT-9 lightning (Thunderclap etc.), 'pound' = BRUTUS Ground Pound. */
    method: 'slam' | 'ram' | 'dash' | 'whirl' | 'wall' | 'zap' | 'pound' | 'other';
    killerIsPlayer: boolean;
    victimIsPlayer: boolean;
  };
  /** A fighter reached a streak tier (3, 5, 8, 12 ...). */
  brawlStreak: { name: string; color: string; count: number; label: string; mult: number; isPlayer: boolean };
  /** Someone ended a streak of >= 3. */
  brawlShutdown: { killer: string; victim: string; streak: number; bonus: number; killerIsPlayer: boolean };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<any>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) fn(payload);
  }
}
