import type { GameEvents } from '../core/events';
import type { EnemyManagerAPI, GameContext, PlayerStats, SnowFieldAPI, SoundName } from '../core/types';
import type { CosmeticSlot } from '../config/cosmetics';
import type { Plow } from './Plow';
import type { Combat } from './Combat';

/** What a plow reads to drive: the keyboard / gamepad (core/input.ts), a remote player's network input, or a
 *  scripted / neutral source. `wasPressed` takes the default key codes ('Space', 'ShiftLeft', 'KeyE', 'KeyF'). */
export interface InputSource {
  readonly throttle: number;
  readonly steer: number;
  wasPressed(code: string): boolean;
  /** Held right now (optional: network inputs only know presses; ARSENAL's autocannon then fires in bursts). */
  isDown?(code: string): boolean;
}

/** Sound output a pilot's plow + combat use (the real AudioSystem, or a quieter proxy for the opponent). */
export interface PilotAudio {
  play(name: SoundName, opts?: { volume?: number; pitch?: number }): void;
  setPlowing(intensity: number): void;
}

export interface EventSink {
  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void;
}

/**
 * Everything one pilot's Plow and Combat read besides the shared world (scene, fx, time). Single-player modes use
 * ctxPilot(ctx), which reads the GameContext singletons (ctx.plow / ctx.stats / ctx.input / ctx.combat /
 * ctx.enemies), so they behave exactly as before. The online Duel binds each plow to its own pilot: its own input
 * source, stats and Combat, with `enemies` being an adapter over the opponent's plow.
 */
export interface PilotBinding {
  readonly input: InputSource;
  readonly stats: PlayerStats;
  readonly plow: Plow;
  readonly combat: Combat;
  /** What this pilot's attacks hit. */
  readonly enemies: EnemyManagerAPI;
  readonly snow: SnowFieldAPI;
  readonly audio: PilotAudio;
  readonly events: EventSink;
  /** The human at this screen: camera shake, hit-stop, damage vignette and UI toasts are for them only. */
  readonly local: boolean;
  /** True where this pilot is simulated for real (single-player, the duel host). False on a duel guest, whose
   *  plows only predict / replay visuals: plowed snow never fills the ball there (the host's snapshot does). */
  readonly authoritative: boolean;
  /** Paint Shop look to wear instead of the save's equipped one (a duel opponent's cosmetics), or null. */
  readonly look: Partial<Record<CosmeticSlot, string>> | null;
}

/** The single-player pilot: everything comes from the GameContext (read lazily, so systems built later work). */
export function ctxPilot(ctx: GameContext): PilotBinding {
  return {
    get input() {
      return ctx.input;
    },
    get stats() {
      return ctx.stats;
    },
    get plow() {
      return ctx.plow as Plow;
    },
    get combat() {
      return ctx.combat as Combat;
    },
    get enemies() {
      return ctx.enemies;
    },
    get snow() {
      return ctx.snow;
    },
    get audio() {
      return ctx.audio;
    },
    get events() {
      return ctx.events;
    },
    local: true,
    authoritative: true,
    look: null,
  };
}

/** No input at all (parked plows, an open pause menu in an online duel). */
export const NO_INPUT: InputSource = { throttle: 0, steer: 0, wasPressed: () => false };
