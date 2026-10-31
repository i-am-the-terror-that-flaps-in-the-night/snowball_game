import { GEAR_BY_ID, GEAR_SLOTS, RARITY_COLOR } from '../config/gear';
import { LOOT_RULES, type LootDrop } from '../config/loot';

/** Gear loot reveal cards (results / victory / Brawl results / Survival pit stop). */
export function renderLoot(parent: HTMLElement, drops: (LootDrop | null | undefined)[]): HTMLElement | null {
  const list = drops.filter((d): d is LootDrop => !!d && !!GEAR_BY_ID[d.item]);
  if (!list.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'ss-loot';
  const head = document.createElement('div');
  head.className = 'ss-loot-head';
  head.textContent = list.length > 1 ? `🎁 ${list.length} GEAR DROPS` : '🎁 GEAR DROP';
  wrap.appendChild(head);
  list.forEach((d, i) => {
    const def = GEAR_BY_ID[d.item];
    const card = document.createElement('div');
    card.className = `ss-loot-card ss-rarity-${def.rarity}`;
    card.style.setProperty('--acc', RARITY_COLOR[def.rarity]);
    card.style.animationDelay = `${500 + i * 180}ms`;
    const icon = document.createElement('div');
    icon.className = 'ss-loot-icon';
    icon.textContent = def.icon;
    const info = document.createElement('div');
    info.className = 'ss-loot-info';
    const name = document.createElement('div');
    name.className = 'ss-loot-name';
    name.textContent = def.name;
    const sub = document.createElement('div');
    sub.className = 'ss-loot-sub';
    const slot = GEAR_SLOTS.find((s) => s.id === def.slot);
    sub.textContent = `${def.rarity.toUpperCase()} · ${slot?.name ?? def.slot} · ${LOOT_RULES[d.source].label}`;
    info.append(name, sub);
    const tag = document.createElement('div');
    tag.className = `ss-loot-tag ss-loot-${d.outcome}`;
    tag.textContent = d.outcome === 'new' ? 'NEW!' : d.outcome === 'level' ? `LV ${d.level - 1} → ${d.level}` : `★ MAX · +${d.coins} 🪙`;
    card.append(icon, info, tag);
    wrap.appendChild(card);
  });
  parent.appendChild(wrap);
  return wrap;
}
