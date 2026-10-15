import type * as THREE from 'three';
import type { EnemyHandle } from './types';

/** Cross-cutting game events. Modules call ctx.audio / ctx.fx directly for their own feedback;
 *  events exist so Game/UI can track stats and show toasts without modules knowing about each other. */
export interface GameEvents {
  enemyKilled: { enemy: EnemyHandle; coins: number };
  enemyHit: { enemy: EnemyHandle; damage: number };
  /** The player slammed their snowball. */
  slam: { hits: number; radius: number; position: THREE.Vector3 };
  /** One slam / whirl hit `count` (>= 3) bots. */
  strike: { count: number; position: THREE.Vector3 };
  plowDamaged: { amount: number; blocked: number };
  plowDestroyed: Record<string, never>;
  coinCollected: { amount: number };
  bossSpawned: { enemy: EnemyHandle; name: string; title: string };
  /** A boss entered a new phase / enraged (e.g. "ENRAGED!", "PHASE 2"). */
  bossPhase: { enemy: EnemyHandle; name: string; label: string };
  bossDefeated: { enemy: EnemyHandle; name: string };
  roundStarted: { round: number; total: number; boss: boolean };
  // ---- Brawl mode
  /** Kill feed entry. */
  brawlKill: {
    killer: string;
    killerColor: string;
    victim: string;
    victimColor: string;
    method: 'slam' | 'ram' | 'dash' | 'whirl' | 'wall' | 'other';
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
