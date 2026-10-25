import './daily.css';
import type { Progression } from '../core/Progression';
import { dailyBest, dailyHistory, dailyModifier, dayLabel, DAILY_COIN_MULT, type DailySpec } from '../meta/daily';

/* Daily Survival bits of the results screen and the pit stop (UI.ts calls these for Daily runs only). */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

/** Results-screen card: date + modifier, wave reached vs today's best, and the last 7 days' bests. */
export function renderDailyResult(parent: HTMLElement, p: Progression, spec: DailySpec, wave: number, newBest: boolean): HTMLElement {
  const mod = dailyModifier(spec);
  const card = el('div', 'ss-daily-card', undefined, parent);
  const head = el('div', 'ss-daily-head', undefined, card);
  el('span', 'ss-daily-date', `📅 DAILY · ${dayLabel(spec.key)}`, head);
  const chip = el('span', 'ss-daily-mod', undefined, head);
  el('span', '', mod.icon, chip);
  el('b', '', mod.name, chip);
  el('div', 'ss-daily-desc', `${mod.desc} Coins x${DAILY_COIN_MULT}.`, card);

  const nums = el('div', 'ss-daily-nums', undefined, card);
  const num = (label: string, value: number, cls = '') => {
    const n = el('div', `ss-daily-num ${cls}`, undefined, nums);
    el('b', '', `${value}`, n);
    el('small', '', label, n);
    return n;
  };
  num('Wave reached', wave);
  const best = num("Today's best", Math.max(wave, dailyBest(p, spec.key)), newBest ? 'new' : '');
  if (newBest) el('span', 'ss-daily-newbest', '🌟 NEW BEST', best);

  // Last 7 days: one little bar per day, today on the right.
  const hist = dailyHistory(p, spec.key, 7);
  const top = Math.max(1, ...hist.map((h) => h.best));
  const week = el('div', 'ss-daily-week', undefined, card);
  for (const h of hist) {
    const today = h.key === spec.key;
    const d = el('div', `ss-daily-day${today ? ' today' : ''}${h.best ? '' : ' empty'}`, undefined, week);
    el('span', 'ss-daily-dv', h.best ? `${h.best}` : '·', d);
    const bar = el('span', 'ss-daily-bar', undefined, d);
    bar.style.height = `${h.best ? 6 + (h.best / top) * 30 : 3}px`;
    el('span', 'ss-daily-dl', today ? 'TODAY' : dayLabel(h.key).slice(0, 3), d);
  }
  return card;
}

/** Pit-stop banner reminding the player which Daily rules are on. */
export function renderDailyShopTag(parent: HTMLElement, spec: DailySpec): HTMLElement {
  const mod = dailyModifier(spec);
  const tag = el('div', 'ss-daily-tag', undefined, parent);
  el('b', '', `📅 DAILY · ${mod.icon} ${mod.name}`, tag);
  el('span', '', mod.desc, tag);
  return tag;
}
