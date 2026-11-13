/** Shared DOM / formatting helpers and lookup tables used by the UI screens. */
import type { SoundName } from '../core/types';
import type { ZoneDef } from '../config/zones';
import { ENEMIES, type EnemyDef, type EnemyType } from '../config/enemies';

export const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
export const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

/** A one-line story quote, “line” — SPEAKER (a boss's last words: results screen, Story chapter cards; story.css). */
export function storyQuote(parent: HTMLElement, line: string, speaker: string): HTMLElement {
  const q = el('p', 'ss-story-quote', undefined, parent);
  el('span', 'ss-story-quote-line', `“${line}”`, q);
  if (speaker) el('span', 'ss-story-quote-who', ` — ${speaker}`, q);
  return q;
}

/** Restart a one-shot CSS animation class. */
export function restart(e: HTMLElement, cls: string, ...others: string[]): void {
  e.classList.remove(cls, ...others);
  void e.offsetWidth;
  e.classList.add(cls);
}

/** The UI class's button factory (`UI.btn`), handed to the screen builders. */
export type BtnFn = (label: string, cls: string, onClick: () => void, parent?: HTMLElement, sound?: SoundName | null) => HTMLButtonElement;

export const ENEMY_ICON: Record<EnemyType, string> = {
  scrapper: '🤖', brute: '🚧', spinner: '🪚', thief: '🦝',
  bulldoza: '🚜', frostbyte: '👾', grinder: '🔩', slush: '🔴', sleet: '🔵', omega: '💀', rival: '🚜', rallybot: '🧢', donald: '🍊',
};

export function ordinal(n: number): string {
  const v = n % 100;
  const suf = v >= 11 && v <= 13 ? 'TH' : ['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH';
  return `${n}${suf}`;
}
export function fmtTime(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** True for saturated, mid-lightness colors that read well as a health bar. */
function vivid(n: number): boolean {
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (d === 0) return false;
  const l = (mx + mn) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  return s > 0.45 && l > 0.28 && l < 0.75;
}
export function bossColor(def?: EnemyDef): string {
  if (def) {
    if (vivid(def.color)) return hex(def.color);
    if (vivid(def.accent)) return hex(def.accent);
  }
  return '#ff2f4c';
}

/** Challenge stars as HTML: `got` gold (the last `fresh` of them pop in), the rest of `total` empty. */
export function starsHtml(got: number, fresh = 0, total = 3): string {
  let h = '';
  for (let i = 0; i < total; i++) h += `<i class="ss-star ${i < got ? (i >= got - fresh ? 'on fresh' : 'on') : 'off'}">★</i>`;
  return h;
}

export function bossCount(z: ZoneDef): number {
  let n = 0;
  for (const r of z.rounds) if (r.boss) for (const g of r.groups) if (ENEMIES[g.type].isBoss) n += g.count;
  return n;
}
