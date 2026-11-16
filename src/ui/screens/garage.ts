/** Garage / upgrade shop pieces: tab table, upgrade and gear cards, the tab bar's badges and the round preview. */
import type { GameContext, SoundName } from '../../core/types';
import { UPGRADE_BY_ID, type UpgradeCategory, type UpgradeDef, type UpgradeId } from '../../config/upgrades';
import { GEAR, GEAR_MAX_LEVEL, GEAR_SLOTS, RARITY_COLOR, grantLabel, type GearDef, type GearSlot } from '../../config/gear';
import { PLOWS } from '../../config/plows';
import { ENEMIES, type EnemyDef, type EnemyType } from '../../config/enemies';
import type { DuelWallet, ShopWallet } from '../../duel/DuelWallet';
import { ENEMY_ICON, bossColor, bossCount, el, fmt, hex, restart } from '../uiKit';

export type ShopTabId = 'core' | 'gear' | 'line';

/** Garage tabs, each listing one or more upgrade categories. 'line' only shows the driven plow's own line
 *  (category id === PlowKind), and takes that plow's name and icon. */
export const SHOP_TABS: { id: ShopTabId; label: string; icon: string; blurb: string; groups: { cat: UpgradeCategory; title?: string }[] }[] = [
  { id: 'core', label: 'Core', icon: '⚙️', blurb: 'The four core upgrades (speed, slam power, ball size, HP) and a Focus pick: abilities or your main attack. They never max out.', groups: [{ cat: 'plow' }, { cat: 'ball' }, { cat: 'defense' }, { cat: 'focus', title: '🔮🎯 Focus · pick one' }] },
  { id: 'gear', label: 'Gear', icon: '🎒', blurb: 'Buy items, level them up to 10 and equip as many as you like. Gear works on every plow.', groups: [] },
  { id: 'line', label: 'Plow', icon: '🚜', blurb: '', groups: [{ cat: 'classic' }, { cat: 'volt' }, { cat: 'brute' }, { cat: 'isotope' }, { cat: 'arsenal' }, { cat: 'revenant' }] },
];

const ENEMY_TIP: Partial<Record<EnemyType, string>> = {
  scrapper: 'FAST', brute: 'FRONT ARMOR', spinner: 'OVERHEATS', thief: 'STEALS SNOW', rallybot: 'RALLY BUFF',
  gunner: 'RANGED', bulwark: 'FLANK IT', slushpile: 'SPLITS',
  mirror: 'COPIES YOU', magnet: 'PULLS + FENCES', twinlink: 'KILL BOTH',
};

export interface CardRefs {
  def: UpgradeDef;
  tab: ShopTabId;
  root: HTMLElement;
  pips: HTMLElement[];
  /** "LV n" badge for endless upgrades past their pips. */
  lvl: HTMLElement;
  cur: HTMLElement;
  next: HTMLElement;
  arrow: HTMLElement;
  buy: HTMLButtonElement;
  /** FOCUS cards only: the RESPEC button (Garage outside a run, while owned) and the "other focus chosen" note. */
  respec?: HTMLButtonElement;
  lock?: HTMLElement;
}

export interface GearCardRefs {
  def: GearDef;
  root: HTMLElement;
  lvl: HTMLElement;
  grants: HTMLElement;
  buy: HTMLButtonElement;
  equip: HTMLButtonElement;
}

/** One Garage tab button's parts. */
export interface ShopTabRefs { btn: HTMLButtonElement; icon: HTMLElement; label: HTMLElement; badge: HTMLElement }

/** The Garage state these helpers read, handed over by the UI class (a snapshot: the maps / arrays are shared). */
export interface GarageDeps {
  ctx: GameContext;
  /** Who the Garage buys through: the save, or the duel garage's wallet (read when called). */
  shop: () => ShopWallet;
  duelWallet: DuelWallet | null;
  sfx: (name: SoundName) => void;
  cards: CardRefs[];
  gearCards: GearCardRefs[];
  gearSlotLabels: Map<GearSlot, HTMLElement>;
  tabBtns: Map<ShopTabId, ShopTabRefs>;
  lineSections: Map<UpgradeCategory, HTMLElement>;
  shopTab: ShopTabId;
  tabBlurb: HTMLElement;
  tabTraits: HTMLElement;
  plowPick: HTMLElement;
  shopPreview: HTMLElement;
  /** RESPEC a FOCUS upgrade (refund + reset). False when not allowed here (in a run's shop, the duel garage). */
  respec: (id: UpgradeId) => boolean;
}

/** Tab labels, affordable-upgrade badges and the info line under the tabs. */
export function refreshTabs(ui: Pick<GarageDeps, 'shop' | 'tabBtns' | 'lineSections' | 'cards' | 'gearCards' | 'shopTab' | 'tabBlurb' | 'tabTraits'>): void {
  const p = ui.shop();
  const plow = PLOWS[p.plow];
  const line = ui.tabBtns.get('line');
  if (line) {
    line.icon.textContent = plow.icon;
    line.label.textContent = plow.name;
    line.btn.title = `${plow.name} upgrades`;
    line.btn.dataset.plow = plow.id;
  }
  for (const [cat, sec] of ui.lineSections) sec.classList.toggle('hidden', cat !== plow.id);
  const affordable = new Map<ShopTabId, number>();
  for (const c of ui.cards) {
    if (c.tab === 'line' && c.def.category !== plow.id) continue;
    if (!p.isMaxed(c.def.id) && p.canBuy(c.def.id)) affordable.set(c.tab, (affordable.get(c.tab) ?? 0) + 1);
  }
  for (const g of ui.gearCards) if (p.itemCost(g.def.id) < Infinity && p.canBuyItem(g.def.id)) affordable.set('gear', (affordable.get('gear') ?? 0) + 1);
  for (const [tid, t] of ui.tabBtns) {
    const n = affordable.get(tid) ?? 0;
    t.badge.textContent = n ? String(n) : '';
  }
  const tab = SHOP_TABS.find((t) => t.id === ui.shopTab)!;
  ui.tabTraits.textContent = '';
  if (tab.id === 'line') {
    ui.tabBlurb.textContent = `${plow.name} only: these upgrades work while you drive it.`;
    for (const t of plow.traits) el('li', '', t, ui.tabTraits);
  } else {
    ui.tabBlurb.textContent = tab.blurb;
  }
}

export function buildCard(ui: Pick<GarageDeps, 'shop' | 'sfx' | 'respec'>, def: UpgradeDef, tab: ShopTabId, parent: HTMLElement): CardRefs {
  const root = el('div', 'ss-card', undefined, parent);
  root.dataset.id = def.id;
  if (def.details) root.title = def.details;
  el('div', 'ss-card-icon', def.icon, root);
  const info = el('div', 'ss-card-info', undefined, root);
  el('div', 'ss-card-name', def.name, info);
  el('div', 'ss-card-desc', def.description, info);
  const pipsEl = el('div', 'ss-pips', undefined, info);
  const pips: HTMLElement[] = [];
  for (let i = 0; i < def.pips; i++) pips.push(el('span', 'ss-pip', undefined, pipsEl));
  // Endless upgrades: a "LV n" badge past the pips.
  const lvl = el('span', 'ss-lvl', '', pipsEl);
  const val = el('div', 'ss-card-val', undefined, info);
  const cur = el('span', 'ss-val-cur', '', val);
  const arrow = el('span', 'ss-val-arrow', '→', val);
  const next = el('span', 'ss-val-next', '', val);
  if (def.exclusiveWith) return buildFocusParts(ui, def, root, info, { def, tab, root, pips, lvl, cur, next, arrow, buy: null as unknown as HTMLButtonElement });
  const buy = el('button', 'ss-btn ss-buy', '', root);
  buy.type = 'button';
  buy.addEventListener('click', () => onBuy(ui, def, root));
  return { def, tab, root, pips, lvl, cur, next, arrow, buy };
}

/** How long a first RESPEC tap stays armed, waiting for the confirming second tap (ms). */
const RESPEC_CONFIRM_MS = 3000;

/** FOCUS card extras: a "the other focus is chosen" note, and BUY + RESPEC stacked (RESPEC asks for a second tap). */
function buildFocusParts(ui: Pick<GarageDeps, 'shop' | 'sfx' | 'respec'>, def: UpgradeDef, root: HTMLElement, info: HTMLElement, refs: CardRefs): CardRefs {
  root.classList.add('ss-focus-card');
  refs.lock = el('div', 'ss-focus-lock hidden', '', info);
  const btns = el('div', 'ss-gear-btns', undefined, root);
  const buy = el('button', 'ss-btn ss-buy', '', btns) as HTMLButtonElement;
  buy.type = 'button';
  buy.addEventListener('click', () => onBuy(ui, def, root));
  const respec = el('button', 'ss-btn ss-ice ss-respec hidden', '', btns) as HTMLButtonElement;
  respec.type = 'button';
  let armedAt = 0;
  respec.addEventListener('click', () => {
    const now = performance.now();
    if (now - armedAt > RESPEC_CONFIRM_MS) {
      armedAt = now;
      respec.classList.add('armed');
      respec.dataset.label = respec.textContent ?? '';
      respec.textContent = 'TAP AGAIN TO RESPEC';
      ui.sfx('click');
      setTimeout(() => {
        if (armedAt !== now) return;
        armedAt = 0;
        respec.classList.remove('armed');
        if (respec.dataset.label) respec.textContent = respec.dataset.label;
      }, RESPEC_CONFIRM_MS);
      return;
    }
    armedAt = 0;
    respec.classList.remove('armed');
    if (ui.respec(def.id)) {
      ui.sfx('buy');
      restart(root, 'bought');
    } else {
      ui.sfx('error');
      restart(root, 'shake');
    }
  });
  refs.buy = buy;
  refs.respec = respec;
  return refs;
}

/** FOCUS card state: locked by the other focus (note + LOCKED button), RESPEC shown while owned and `canRespec`. */
export function refreshFocusCard(c: CardRefs, lvl: number, lockedBy: UpgradeId | null, refund: number, canRespec: boolean): void {
  if (!c.lock || !c.respec) return;
  const by = lockedBy ? UPGRADE_BY_ID[lockedBy] : null;
  c.root.classList.toggle('locked', !!by);
  c.lock.classList.toggle('hidden', !by);
  c.lock.textContent = by ? `🔒 ${by.name} chosen · respec it in the Garage to switch` : '';
  if (by) {
    c.buy.textContent = '🔒 LOCKED';
    c.buy.title = `${by.name} chosen: respec it in the Garage to switch.`;
  }
  const show = canRespec && lvl > 0;
  c.respec.classList.toggle('hidden', !show);
  if (show && !c.respec.classList.contains('armed')) {
    c.respec.innerHTML = `↺ RESPEC +<span class="ss-coin sm"></span>${fmt(refund)}`;
    c.respec.title = `Refund all ${fmt(refund)} coins spent on ${c.def.name} and unlock the other focus.`;
  }
}

/** Gear tab: one section per slot (a browsing category: any number of items can be equipped), each with its items. */
export function buildGear(ui: Pick<GarageDeps, 'shop' | 'sfx' | 'gearSlotLabels' | 'gearCards'>, pane: HTMLElement): void {
  for (const slot of GEAR_SLOTS) {
    const sec = el('section', `ss-cat ss-gear-slot ss-gear-${slot.id}`, undefined, pane);
    const h = el('h3', 'ss-cat-title', `${slot.icon} ${slot.name}`, sec);
    ui.gearSlotLabels.set(slot.id, el('span', 'ss-gear-eq', '', h));
    const grid = el('div', 'ss-card-grid', undefined, sec);
    for (const def of GEAR.filter((d) => d.slot === slot.id)) ui.gearCards.push(buildGearCard(ui, def, grid));
  }
}

function buildGearCard(ui: Pick<GarageDeps, 'shop' | 'sfx'>, def: GearDef, parent: HTMLElement): GearCardRefs {
  const root = el('div', `ss-card ss-gear-card ss-rarity-${def.rarity}`, undefined, parent);
  root.style.setProperty('--acc', RARITY_COLOR[def.rarity]);
  root.dataset.id = def.id;
  el('div', 'ss-card-icon', def.icon, root);
  const info = el('div', 'ss-card-info', undefined, root);
  const name = el('div', 'ss-card-name', def.name, info);
  el('span', 'ss-gear-rarity', def.rarity.toUpperCase(), name);
  el('div', 'ss-card-desc', def.description, info);
  const lvl = el('div', 'ss-gear-lvl', '', info);
  const grants = el('div', 'ss-card-val', '', info);
  const btns = el('div', 'ss-gear-btns', undefined, root);
  const buy = el('button', 'ss-btn ss-buy', '', btns) as HTMLButtonElement;
  buy.type = 'button';
  buy.addEventListener('click', () => {
    const p = ui.shop();
    if (!p.buyItem(def.id)) {
      ui.sfx('error');
      restart(root, 'shake');
      return;
    }
    ui.sfx('buy');
    restart(root, 'bought');
  });
  const equip = el('button', 'ss-btn ss-ice ss-gear-equip', '', btns) as HTMLButtonElement;
  equip.type = 'button';
  equip.addEventListener('click', () => {
    if (ui.shop().toggleEquip(def.id)) ui.sfx('click');
  });
  return { def, root, lvl, grants, buy, equip };
}

export function refreshGear(ui: Pick<GarageDeps, 'shop' | 'duelWallet' | 'gearSlotLabels' | 'gearCards'>): void {
  const p = ui.shop();
  const dw = ui.duelWallet;
  for (const slot of GEAR_SLOTS) {
    const on = GEAR.filter((d) => d.slot === slot.id && p.isEquipped(d.id));
    ui.gearSlotLabels.get(slot.id)!.textContent = !on.length
      ? ' · none equipped'
      : on.length === 1
        ? ` · equipped: ${on[0].icon} ${on[0].name}`
        : ` · ${on.length} equipped: ${on.map((d) => d.icon).join(' ')}`;
  }
  for (const c of ui.gearCards) {
    const lvl = p.itemLevel(c.def.id);
    const cost = p.itemCost(c.def.id);
    const maxed = cost === Infinity;
    const afford = !maxed && p.canBuyItem(c.def.id);
    const on = p.isEquipped(c.def.id);
    c.lvl.innerHTML = lvl ? `${'★'.repeat(lvl)}<span class="ss-gear-off">${'★'.repeat(GEAR_MAX_LEVEL - lvl)}</span> LV ${lvl}` : 'Not owned';
    const now = grantLabel(c.def, lvl || 1);
    const next = lvl && !maxed ? grantLabel(c.def, lvl + 1) : '';
    c.grants.textContent = next && next !== now ? `${now}  →  ${next}` : now;
    c.root.classList.toggle('owned', lvl > 0);
    c.root.classList.toggle('equipped', on);
    c.root.classList.toggle('maxed', maxed);
    c.root.classList.toggle('poor', !maxed && !afford);
    c.root.classList.toggle('afford', afford);
    const bonus = !!dw && !maxed && dw.paysItemWithBonus(c.def.id);
    c.buy.classList.toggle('ss-bonus-buy', bonus);
    c.buy.innerHTML = maxed ? '★ MAXED' : `${lvl ? '⬆ ' : ''}${bonus ? '🎁' : '<span class="ss-coin sm"></span>'}${fmt(cost)}`;
    c.buy.title = bonus ? 'Paid with catch-up coins: yours to keep once the duel starts.' : lvl ? 'Level up' : 'Buy';
    c.buy.setAttribute('aria-disabled', afford ? 'false' : 'true');
    c.equip.classList.toggle('hidden', !lvl);
    c.equip.textContent = on ? '✓ EQUIPPED' : 'EQUIP';
  }
}

function onBuy(ui: Pick<GarageDeps, 'shop' | 'sfx'>, def: UpgradeDef, card: HTMLElement): void {
  const p = ui.shop();
  if (p.isMaxed(def.id) || !p.canBuy(def.id)) {
    ui.sfx('error');
    restart(card, 'shake');
    return;
  }
  if (p.buy(def.id)) {
    ui.sfx('buy');
    restart(card, 'bought');
  }
}

export function scrollPlowIntoView(ui: Pick<GarageDeps, 'plowPick'>): void {
  const row = ui.plowPick;
  const on = row.querySelector<HTMLElement>('.ss-plow-card.on');
  if (!on || row.scrollWidth <= row.clientWidth) return;
  const r = row.getBoundingClientRect();
  const c = on.getBoundingClientRect();
  if (c.left < r.left) row.scrollLeft -= r.left - c.left + 4;
  else if (c.right > r.right) row.scrollLeft += c.right - r.right + 4;
}

export function renderRoundPreview(ui: Pick<GarageDeps, 'shopPreview' | 'ctx'>, nextRound: number, totalRounds: number): void {
  const w = ui.shopPreview;
  const zone = ui.ctx.zone;
  const round = zone?.rounds[nextRound - 1];
  const isBoss = !!round?.boss;
  w.textContent = '';
  w.classList.remove('hidden');
  w.classList.toggle('boss', isBoss);
  const t = el('div', 'ss-rp-title', undefined, w);
  t.innerHTML = `${zone?.theme === 'protocol' ? 'Wave' : 'Round'} <b>${nextRound}</b> of ${totalRounds} next`;

  // by type, PROTOCOL C's echoes as their own chips
  const counts = new Map<string, { type: EnemyType; echo: boolean; n: number }>();
  if (round) {
    for (const g of round.groups) {
      const key = `${g.type}${g.echo ? ':echo' : ''}`;
      const c = counts.get(key) ?? { type: g.type, echo: !!g.echo, n: 0 };
      c.n += g.count;
      counts.set(key, c);
    }
  }

  if (isBoss) {
    let first: EnemyDef | undefined;
    for (const c of counts.values()) if (ENEMIES[c.type].isBoss && !c.echo) { first = ENEMIES[c.type]; break; }
    const bp = el('div', 'ss-boss-preview', undefined, w);
    bp.style.setProperty('--bc', bossColor(first));
    el('div', 'ss-bp-badge', '💀', bp);
    const tx = el('div', 'ss-bp-text', undefined, bp);
    el('small', '', 'BOSS', tx);
    el('b', '', zone.bossName, tx);
    if (first?.title) el('span', 'ss-bp-title', first.title, tx);
  }

  const chips = el('div', 'ss-chips', undefined, w);
  for (const { type, echo, n } of counts.values()) {
    const def = ENEMIES[type];
    if (isBoss && def.isBoss && bossCount(zone) <= 1) continue;
    const chip = el('div', `ss-chip ${def.isBoss ? 'boss' : ''}`, undefined, chips);
    chip.style.setProperty('--chip', hex(echo ? 0xe8b423 : def.isBoss ? def.accent : def.color));
    el('span', 'ss-chip-icon', ENEMY_ICON[type] ?? '🤖', chip);
    el('span', 'ss-chip-name', echo ? `ECHO ${def.name}` : def.name, chip);
    el('span', 'ss-chip-count', `×${n}`, chip);
    if (def.isBoss) el('span', 'ss-chip-tag', echo ? 'ECHO' : 'BOSS', chip);
    else if (ENEMY_TIP[type]) el('span', 'ss-chip-tag tip', ENEMY_TIP[type]!, chip);
  }
  if (!chips.childElementCount) chips.remove();
}
