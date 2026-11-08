/** Controls cheat-sheet rows (How to Play, pause menu), filled from the player's current key bindings. */
import type { GameContext } from '../core/types';
import { ACTIONS, keyLabel, type Action } from '../core/input';
import { el } from './uiKit';

/** Controls cheat-sheet. Action rows show the player's current (rebindable) keys; other rows are literal labels. */
const CONTROLS: [string[], string][] = [
  [['forward'], 'Accelerate'],
  [['back'], 'Brake / reverse'],
  [['left', 'right'], 'Steer'],
  [['slam'], 'SLAM snowball'],
  [['dash'], 'DASH STRIKE (long burst)'],
  [['whirl'], 'Whirlwind tornado'],
  [['ability'], 'Inferno (Classic) / Thunderclap (VOLT-9) / Ground Pound (BRUTUS)'],
  [['pause'], 'Pause'],
  [['M'], 'Mute sound'],
];
const ACTION_IDS = new Set<string>(ACTIONS.map((a) => a.id));
const PAD_LINE = '🎮 Gamepad: left stick drive · A slam · B/RB dash · X whirl · Y F-ability · START pause';

/** Labels for a controls row: an action's bound keys (primary + fixed alternates), or the literal labels. */
export function rowKeys(input: GameContext['input'], keys: string[]): string[] {
  if (!keys.every((k) => ACTION_IDS.has(k))) return keys;
  if (keys.length > 1) return keys.map((a) => keyLabel(input.keysFor(a as Action)[0] ?? '?'));
  return input.keysFor(keys[0] as Action).map(keyLabel);
}

export function fillControls(input: GameContext['input'], list: HTMLElement): void {
  list.replaceChildren();
  for (const [keys, label] of CONTROLS) {
    const row = el('div', 'ss-ctrl-row', undefined, list);
    const k = el('div', 'ss-keys', undefined, row);
    rowKeys(input, keys).forEach((key, i) => {
      if (i) el('span', 'ss-key-sep', '/', k);
      // The display face draws arrows as hairlines; arrow keycaps use the body font instead.
      el('kbd', /^[←↑→↓]$/.test(key) ? 'ss-kbd arrow' : 'ss-kbd', key, k);
    });
    el('span', 'ss-ctrl-label', label, row);
  }
  el('div', 'ss-ctrl-pad', PAD_LINE, list);
}
