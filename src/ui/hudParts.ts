/** In-game HUD pieces: element refs, the DOM build, boss bars, ability rings, round pips and the per-frame panels. */
import type { GameContext, HudBoss, HudState } from '../core/types';
import { MIN_BALL_RADIUS } from '../core/types';
import { ENEMIES, type EnemyDef } from '../config/enemies';
import { ENEMY_ICON, bossColor, clamp01, el, fmt, restart } from './uiKit';

/** Ultimate meter + F-button labels per F ability (meter icon, READY tag, F icon/name when full, normal F icon/name). */
const ULT_HUD: Record<HudState['fAbility'], { bar: string; tag: string; icon: string; name: string; baseIcon: string; baseName: string }> = {
  fire: { bar: '🔥', tag: 'FIRESTORM', icon: '🌋', name: 'STORM', baseIcon: '🔥', baseName: 'FIRE' },
  zap: { bar: '⚡', tag: 'SUPERCELL', icon: '🌩️', name: 'CELL', baseIcon: '⚡', baseName: 'CLAP' },
  pound: { bar: '🌍', tag: 'EARTHQUAKE', icon: '🌍', name: 'QUAKE', baseIcon: '💥', baseName: 'POUND' },
  meltdown: { bar: '☢', tag: 'NUKE', icon: '☢️', name: 'NUKE', baseIcon: '☢️', baseName: 'MELT' },
  missiles: { bar: '🌀', tag: 'SINGULARITY', icon: '🕳️', name: 'VOID', baseIcon: '🌀', baseName: 'BURST' },
};

function tierName(r: number): string {
  if (r < 0.6) return 'Snowball';
  if (r < 1.0) return 'Boulder';
  if (r < 1.6) return 'Avalanche';
  if (r < 2.4) return 'Glacier';
  return 'SNOWPOCALYPSE';
}
function tierIndex(r: number): number {
  return r < 0.6 ? 0 : r < 1.0 ? 1 : r < 1.6 ? 2 : r < 2.4 ? 3 : 4;
}

const DEF_BY_NAME = new Map<string, EnemyDef>(Object.values(ENEMIES).map((d) => [d.name, d] as [string, EnemyDef]));

export interface BossSlot {
  /** '' = free. */
  key: string;
  root: HTMLElement;
  inner: HTMLElement;
  badge: HTMLElement;
  name: HTMLElement;
  title: HTMLElement;
  phase: HTMLElement;
  hp: HTMLElement;
  fill: HTMLElement;
  chip: HTMLElement;
  frac: number;
  hpVal: number;
  /** performance.now() when destroyed (bar lingers), 0 otherwise. */
  down: number;
  mark: boolean;
}

const GAUGE_R = 46;
const GAUGE_C = 2 * Math.PI * GAUGE_R;
export const INTRO_MS = 2600;

/** HUD element refs (GameHud's `h`). */
export interface HudRefs {
  zone: HTMLElement; round: HTMLElement; best: HTMLElement; enemies: HTMLElement; pips: HTMLElement; arena: HTMLElement; waveTag: HTMLElement;
  bosses: HTMLElement;
  coins: HTMLElement; coinBox: HTMLElement;
  combo: HTMLElement; comboN: HTMLElement;
  hpBox: HTMLElement; hpNum: HTMLElement; hpFill: HTMLElement; hpChip: HTMLElement;
  batt: HTMLElement; battFill: HTMLElement; crit: HTMLElement; critFill: HTMLElement;
  gauge: HTMLElement; ring: SVGCircleElement; radius: HTMLElement; tier: HTMLElement;
  chunks: HTMLElement; chunkPips: HTMLElement[];
  streak: HTMLElement; streakLbl: HTMLElement; streakPipBox: HTMLElement; streakPips: HTMLElement[]; streakFill: HTMLElement;
  slam: HTMLElement; shield: HTMLElement; blocked: HTMLElement;
  dash: HTMLElement; whirl: HTMLElement; flame: HTMLElement; primary: HTMLElement;
  heat: HTMLElement; heatFill: HTMLElement; heatTxt: HTMLElement;
  snowFill: HTMLElement; snowTxt: HTMLElement;
  count: HTMLElement; hint: HTMLElement;
}

/** Last values written to the HUD, so updateHud only touches what changed (GameHud's `last`). */
export function hudLast() {
  return {
    zone: '', round: -1, total: -1, bossRound: false, enemies: -1,
    coins: -1, plowHp: -1, plowMax: -1, plowF: -1, low: false, mid: false,
    ballR: -1, ballFrac: -1, tier: -1, ready: false, full: false, held: false,
    dash: -1, whirl: -2, flame: -2, primary: -2, abKey: '', fKind: '', crit: -2, batt: -2, heat: -2, heatCost: -1, chunks: -2, streak: -2, streakLeft: -1, combo: 0, comboTier: -1, snow: -1, count: -1, bossCount: -1, brawl: -1, hideRound: false, arena: '', waveTag: '',
  };
}
export type HudLast = ReturnType<typeof hudLast>;

/** Build the HUD into `hud`, filling `H` and the boss bar slots; returns the top-left box and the bottom-centre column. */
export function buildHudDom(hud: HTMLElement, H: HudRefs, bossSlots: BossSlot[]): { tl: HTMLElement; bc: HTMLElement } {
  el('div', 'ss-lowvig', undefined, hud);

  // top-left: arena + round
  const tl = el('div', 'ss-hud-tl ss-glass-dark', undefined, hud);
  H.zone = el('div', 'ss-hud-zone', '', tl);
  const rr = el('div', 'ss-hud-roundrow', undefined, tl);
  H.round = el('div', 'ss-hud-round', '', rr);
  // Survival: the best wave as its own small item, so the row can wrap instead of widening the box
  H.best = el('div', 'ss-hud-best hidden', '', rr);
  H.enemies = el('div', 'ss-hud-enemies', '', rr);
  H.pips = el('div', 'ss-round-pips', undefined, tl);
  // Survival / Daily: the biome rotates every 5 waves; a tag counts down to the next arena.
  H.arena = el('div', 'ss-hud-arena hidden', '', tl);
  // Survival: the live wave's modifier (Blizzard, Gold Rush, ...) or milestone tag.
  H.waveTag = el('div', 'ss-hud-wavetag hidden', '', tl);

  // top-center: boss bars (1–2)
  H.bosses = el('div', 'ss-bosses', undefined, hud);
  for (let i = 0; i < 2; i++) bossSlots.push(buildBossSlot(H.bosses));

  // top-right: coins
  H.coinBox = el('div', 'ss-hud-tr ss-glass-dark', undefined, hud);
  el('span', 'ss-coin', undefined, H.coinBox);
  H.coins = el('span', 'ss-hud-coins', '0', H.coinBox);

  // right: combo
  H.combo = el('div', 'ss-combo', undefined, hud);
  H.comboN = el('div', 'ss-combo-n', '', H.combo);
  el('div', 'ss-combo-l', 'COMBO', H.combo);

  // bottom-left: plow hp
  const bl = (H.hpBox = el('div', 'ss-hud-bl ss-glass-dark', undefined, hud));
  const hh = el('div', 'ss-hp-head', undefined, bl);
  el('div', 'ss-hp-label', '🚜 PLOW', hh);
  H.hpNum = el('div', 'ss-hp-num', '', hh);
  const hb = el('div', 'ss-hp-bar', undefined, bl);
  H.hpChip = el('div', 'ss-hp-chip', undefined, hb);
  H.hpFill = el('div', 'ss-hp-fill', undefined, hb);
  el('div', 'ss-segs', undefined, hb);
  H.batt = el('div', 'ss-batt hidden', undefined, bl);
  el('span', 'ss-batt-label', '🔋', H.batt);
  const bb = el('div', 'ss-batt-bar', undefined, H.batt);
  H.battFill = el('div', 'ss-batt-fill', undefined, bb);
  H.crit = el('div', 'ss-batt ss-crit hidden', undefined, bl);
  el('span', 'ss-batt-label', '☢', H.crit);
  const cb = el('div', 'ss-batt-bar', undefined, H.crit);
  H.critFill = el('div', 'ss-batt-fill', undefined, cb);
  el('span', 'ss-crit-tag', 'NUKE READY · F', H.crit);

  // bottom-center: abilities + snowball gauge
  const bc = el('div', 'ss-hud-bc', undefined, hud);
  H.blocked = el('div', 'ss-blocked', 'BLOCKED!', bc);
  H.shield = el('div', 'ss-shield', '🛡 SHIELD UP', bc);
  // Classic Plow STREAK: 4 pips in the stack colours (white, cyan, gold, red-orange) over the ability row, a bar that
  // drains as the 3.5 s window runs out, flashing hot ON STREAK.
  H.streak = el('div', 'ss-streak hidden', undefined, bc);
  H.streak.title = 'STREAK: slam a bot your last slam did not hit for a stack (+18% damage, +8% speed, 15% dash back each); at 4 your next slam is a SHOCKWAVE';
  H.streakLbl = el('span', 'ss-streak-lbl', 'STREAK', H.streak);
  H.streakPipBox = el('span', 'ss-streak-pips', undefined, H.streak);
  H.streakPips = [];
  for (let i = 0; i < 4; i++) H.streakPips.push(el('i', '', undefined, H.streakPipBox));
  H.streakFill = el('span', 'ss-streak-fill', undefined, el('span', 'ss-streak-bar', undefined, H.streak));
  const row = el('div', 'ss-bc-row', undefined, bc);
  H.dash = buildAbility(row, '💨', 'DASH', 'SHIFT', 'dash');
  H.gauge = el('div', 'ss-gauge', undefined, row);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 110 110');
  svg.classList.add('ss-gauge-svg');
  const track = document.createElementNS(NS, 'circle');
  track.setAttribute('cx', '55');
  track.setAttribute('cy', '55');
  track.setAttribute('r', String(GAUGE_R));
  track.setAttribute('class', 'ss-gauge-track');
  const ring = document.createElementNS(NS, 'circle');
  ring.setAttribute('cx', '55');
  ring.setAttribute('cy', '55');
  ring.setAttribute('r', String(GAUGE_R));
  ring.setAttribute('class', 'ss-gauge-ring');
  ring.setAttribute('stroke-dasharray', `${GAUGE_C} ${GAUGE_C}`);
  ring.setAttribute('stroke-dashoffset', String(GAUGE_C));
  ring.setAttribute('transform', 'rotate(-90 55 55)');
  svg.appendChild(track);
  svg.appendChild(ring);
  H.gauge.appendChild(svg);
  H.ring = ring;
  const inner = el('div', 'ss-gauge-inner', undefined, H.gauge);
  H.radius = el('div', 'ss-gauge-r', '0.00m', inner);
  H.tier = el('div', 'ss-gauge-tier', 'Snowball', inner);
  // Classic Plow SNOW CHUNKS: ❄ and 10 pips inside the gauge, under the tier (tap slam hits fill them, a PLOW RUSH
  // slam cashes in).
  H.chunks = el('div', 'ss-chunks hidden', undefined, inner);
  H.chunks.title = 'Snow chunks: tap slam hits pack them; a plow rush slam spends them all (+5% radius, +4% damage each)';
  el('span', 'ss-chunks-ico', '❄', H.chunks);
  H.chunkPips = [];
  for (let i = 0; i < 10; i++) H.chunkPips.push(el('span', 'ss-chunk-pip', undefined, H.chunks));
  // Non-Classic vehicles: their SPACE ability takes the snowball gauge's place (icon / name from the kit).
  H.primary = buildAbility(row, '⚡', 'FIRE', 'SPACE', 'primary');
  H.primary.style.display = 'none';
  H.whirl = buildAbility(row, '🌀', 'WHIRL', 'E', 'whirl');
  H.flame = buildAbility(row, '🔥', 'FIRE', 'F', 'flame');
  H.flame.style.display = 'none';
  // Thunderclap Overload meter (VOLT-9 only): heat bar + the next clap's self-damage, perched on the F icon.
  H.heat = el('div', 'ss-heat hidden', undefined, H.flame);
  const heatBar = el('div', 'ss-heat-bar', undefined, H.heat);
  H.heatFill = el('div', 'ss-heat-fill', undefined, heatBar);
  H.heatTxt = el('div', 'ss-heat-txt', '', H.heat);
  H.slam =el('div', 'ss-slam-hint', undefined, bc);
  H.slam.innerHTML = '<kbd class="ss-kbd">SPACE</kbd> SLAM!';

  // bottom-right: snow remaining
  const br = el('div', 'ss-hud-br ss-glass-dark', undefined, hud);
  el('span', 'ss-snow-label', '❄ SNOW', br);
  const sb = el('div', 'ss-snow-bar', undefined, br);
  H.snowFill = el('div', 'ss-snow-fill', undefined, sb);
  H.snowTxt = el('span', 'ss-snow-txt', '', br);

  H.count = el('div', 'ss-count hidden', '', hud);
  H.hint = el('div', 'ss-hint hidden', 'W/S drive  ·  A/D steer  ·  plow snow to grow a ball  ·  SPACE slam  ·  SHIFT dash strike  ·  E whirlwind  ·  F fire / thunderclap  ·  ESC pause', hud);
  return { tl, bc };
}

function buildBossSlot(parent: HTMLElement): BossSlot {
  const root = el('div', 'ss-bossbar hidden', undefined, parent);
  const inner = el('div', 'ss-bb-inner', undefined, root);
  const head = el('div', 'ss-bb-head', undefined, inner);
  const badge = el('div', 'ss-bb-badge', '💀', head);
  const name = el('div', 'ss-bb-name', '', head);
  const title = el('div', 'ss-bb-title', '', head);
  const phase = el('div', 'ss-bb-phase hidden', '', head);
  const hp = el('div', 'ss-bb-hp', '', head);
  const track = el('div', 'ss-bb-track', undefined, inner);
  const chip = el('div', 'ss-bb-chip', undefined, track);
  const fill = el('div', 'ss-bb-fill', undefined, track);
  el('div', 'ss-bb-segs', undefined, track);
  return { key: '', root, inner, badge, name, title, phase, hp, fill, chip, frac: -1, hpVal: -1, down: 0, mark: false };
}

function buildAbility(parent: HTMLElement, icon: string, name: string, key: string, cls: string): HTMLElement {
  const a = el('div', `ss-ab ss-ab-${cls}`, undefined, parent);
  el('div', 'ss-ab-ring', undefined, a);
  const core = el('div', 'ss-ab-core', undefined, a);
  el('div', 'ss-ab-icon', icon, core);
  el('div', 'ss-ab-name', name, core);
  el('kbd', 'ss-kbd ss-ab-key', key, a);
  return a;
}

function setAbility(a: HTMLElement, v: number, prev: number): void {
  a.style.setProperty('--p', String(v));
  const ready = v >= 0.999;
  const was = prev >= 0.999;
  if (ready !== was || prev < 0) {
    a.classList.toggle('ready', ready);
    a.classList.toggle('cooling', !ready);
    if (ready && prev >= 0) restart(a, 'pop');
  }
}

export function renderPips(ui: { h: HudRefs; ctx: GameContext }, round: number, total: number): void {
  const box = ui.h.pips;
  if (box.childElementCount !== total) {
    box.textContent = '';
    for (let i = 0; i < total; i++) {
      const boss = !!ui.ctx.zone?.rounds[i]?.boss;
      el('span', `ss-rpip${boss ? ' boss' : ''}`, boss ? '☠' : '', box);
    }
  }
  const kids = box.children;
  for (let i = 0; i < kids.length; i++) {
    kids[i].classList.toggle('done', i < round - 1);
    kids[i].classList.toggle('cur', i === round - 1);
  }
}

export function assignSlot(slot: BossSlot, key: string, b: HudBoss): void {
  slot.key = key;
  slot.down = 0;
  slot.frac = -1;
  slot.hpVal = -1;
  const def = DEF_BY_NAME.get(b.name);
  slot.root.style.setProperty('--bc', bossColor(def));
  slot.badge.textContent = def ? ENEMY_ICON[def.type] ?? '💀' : '💀';
  slot.name.textContent = b.name;
  slot.title.textContent = b.title;
  slot.phase.classList.add('hidden');
  slot.root.classList.remove('hidden', 'down', 'low');
}

export function freeSlot(s: BossSlot): void {
  s.key = '';
  s.down = 0;
  s.frac = -1;
  s.hpVal = -1;
  s.root.classList.add('hidden');
  s.root.classList.remove('down', 'low');
}

export function setSlotHp(slot: BossSlot, hp: number, maxHp: number): void {
  const q = Math.round(clamp01(hp / Math.max(1, maxHp)) * 500) / 500;
  if (q !== slot.frac) {
    const prev = slot.frac;
    slot.frac = q;
    const tf = `scaleX(${q})`;
    slot.fill.style.transform = tf;
    slot.chip.style.transform = tf;
    if (prev >= 0) {
      const drop = prev - q;
      if (drop >= 0.06) restart(slot.inner, 'bighit', 'hit');
      else if (drop >= 0.02) restart(slot.inner, 'hit', 'bighit');
    }
    slot.root.classList.toggle('low', q < 0.25);
  }
  const v = Math.ceil(Math.max(0, hp));
  if (v !== slot.hpVal) {
    slot.hpVal = v;
    slot.hp.textContent = fmt(v);
  }
}

/** updateHud past the top boxes: coins, plow HP, snowball gauge, abilities, ultimate / battery / heat meters, combo,
 *  snow left and the countdown. */
export function updateHudPanels(ui: { h: HudRefs; last: HudLast; hud: HTMLElement; refreshKeys: () => void }, s: HudState): void {
  const H = ui.h;
  const L = ui.last;
  // coins
  const coins = Math.floor(s.coins);
  if (coins !== L.coins) {
    if (L.coins >= 0 && coins > L.coins) restart(H.coinBox, 'bump');
    L.coins = coins;
    H.coins.textContent = fmt(coins);
  }

  // plow hp
  const php = Math.ceil(Math.max(0, s.plowHp));
  if (php !== L.plowHp || s.plowMaxHp !== L.plowMax) {
    L.plowHp = php;
    L.plowMax = s.plowMaxHp;
    const f = Math.round(clamp01(s.plowHp / Math.max(1, s.plowMaxHp)) * 400) / 400;
    if (f !== L.plowF) {
      L.plowF = f;
      const tf = `scaleX(${f})`;
      H.hpFill.style.transform = tf;
      H.hpChip.style.transform = tf;
    }
    H.hpNum.innerHTML = `${php}<small> / ${Math.round(s.plowMaxHp)}</small>`;
    const low = f < 0.3;
    const mid = !low && f < 0.6;
    if (low !== L.low) {
      L.low = low;
      H.hpBox.classList.toggle('low', low);
      ui.hud.classList.toggle('lowhp', low);
    }
    if (mid !== L.mid) {
      L.mid = mid;
      H.hpBox.classList.toggle('mid', mid);
    }
  }

  // snowball gauge
  const r = Math.round(s.ballRadius * 100) / 100;
  if (r !== L.ballR) {
    L.ballR = r;
    H.radius.textContent = `${r.toFixed(2)}m`;
    const t = tierIndex(r);
    if (t !== L.tier) {
      if (L.tier >= 0 && t > L.tier) restart(H.gauge, 'tierup');
      L.tier = t;
      H.tier.textContent = tierName(r);
      H.gauge.dataset.tier = String(t);
    }
    const ready = s.ballRadius >= MIN_BALL_RADIUS;
    if (ready !== L.ready) {
      L.ready = ready;
      H.gauge.classList.toggle('ready', ready);
      H.slam.classList.toggle('show', ready);
    }
    const held = s.ballRadius > 0.02;
    if (held !== L.held) {
      L.held = held;
      H.shield.classList.toggle('on', held);
    }
  }
  const frac = Math.round(clamp01(s.ballRadius / Math.max(0.01, s.ballMaxRadius)) * 200) / 200;
  if (frac !== L.ballFrac) {
    L.ballFrac = frac;
    H.ring.setAttribute('stroke-dashoffset', String(GAUGE_C * (1 - frac)));
    const full = frac >= 0.99;
    if (full !== L.full) {
      L.full = full;
      H.gauge.classList.toggle('full', full);
    }
  }

  // Classic Plow SNOW CHUNKS (hidden on the other plows and the snowball kit).
  const ck = s.chunks === undefined || s.chunks < 0 || s.abilities ? -1 : Math.round(s.chunks);
  if (ck !== L.chunks) {
    // The Classic's slam is the PLOW RUSH's end (hold SPACE); a vehicle on the snowball kit still taps to slam.
    if ((ck < 0) !== (L.chunks < 0) || L.chunks === -2) H.slam.innerHTML = ck >= 0 ? '<kbd class="ss-kbd">HOLD SPACE</kbd> RUSH SLAM!' : '<kbd class="ss-kbd">SPACE</kbd> SLAM!';
    H.chunks.classList.toggle('hidden', ck < 0);
    for (let i = 0; i < H.chunkPips.length; i++) H.chunkPips[i].classList.toggle('on', i < ck);
    H.chunks.classList.toggle('full', ck >= 10);
    H.chunks.classList.toggle('big', ck >= 5);
    if (ck > L.chunks && L.chunks >= 0) restart(H.chunks, 'bump');
    L.chunks = ck;
  }

  // Classic Plow STREAK meter (hidden on the other plows, the snowball kit and in the Duel).
  const sk = s.streak === undefined || s.streak < 0 || s.abilities ? -1 : Math.round(s.streak);
  if (sk !== L.streak) {
    H.streak.classList.toggle('hidden', sk < 0);
    H.streak.dataset.k = String(Math.max(0, sk));
    for (let i = 0; i < H.streakPips.length; i++) H.streakPips[i].classList.toggle('on', i < sk);
    const hot = sk >= 4;
    H.streak.classList.toggle('hot', hot);
    H.streakLbl.textContent = hot ? 'ON STREAK!' : 'STREAK';
    if (sk > L.streak && L.streak >= 0) restart(H.streakPipBox, 'bump');
    // Back to 0: the finisher went off (white burst: only ever from ON STREAK with window left), else the window ran
    // out or the plow went down (grey drop).
    else if (sk === 0 && L.streak > 0) restart(H.streak, L.streak >= 4 && L.streakLeft > 0.05 ? 'boom' : 'drop', 'boom', 'drop');
    L.streak = sk;
  }
  const sl = sk > 0 ? Math.round(clamp01(s.streakLeft ?? 0) * 100) / 100 : 0;
  if (sl !== L.streakLeft) {
    H.streakFill.style.transform = `scaleX(${sl})`;
    H.streak.classList.toggle('low', sk > 0 && sl < 0.3);
    L.streakLeft = sl;
  }

  // abilities
  const d = Math.round(clamp01(s.dashReady) * 50) / 50;
  if (d !== L.dash) {
    setAbility(H.dash, d, L.dash);
    L.dash = d;
  }
  // Whirlwind is always available now; a negative value (legacy "not owned") reads as ready.
  const w = s.whirlReady < 0 ? 1 : Math.round(clamp01(s.whirlReady) * 50) / 50;
  if (w !== L.whirl) {
    setAbility(H.whirl, w, L.whirl);
    L.whirl = w;
  }
  // SPACE / E slots: the vehicle kit's descriptors (no ball to slam), or the Classic's gauge + WHIRL.
  const ab = s.abilities ?? null;
  const abKey = ab ? `${ab.primary.icon}${ab.primary.label}|${ab.secondary.icon}${ab.secondary.label}` : '';
  if (abKey !== L.abKey) {
    L.abKey = abKey;
    L.primary = -2;
    H.whirl.querySelector('.ss-ab-icon')!.textContent = ab ? ab.secondary.icon : '🌀';
    H.whirl.querySelector('.ss-ab-name')!.textContent = ab ? ab.secondary.label : 'WHIRL';
    if (ab) {
      H.primary.querySelector('.ss-ab-icon')!.textContent = ab.primary.icon;
      H.primary.querySelector('.ss-ab-name')!.textContent = ab.primary.label;
    }
    H.primary.style.display = ab ? '' : 'none';
    H.gauge.classList.toggle('hidden', !!ab);
    if (ab) H.slam.classList.remove('show');
    ui.refreshKeys();
  }
  if (ab) {
    const p = Math.round(clamp01(ab.primaryReady) * 50) / 50;
    if (p !== L.primary) {
      setAbility(H.primary, p, L.primary);
      L.primary = p;
    }
  }
  // F icon follows the plow: Inferno fire (Classic), Thunderclap (VOLT-9) or Ground Pound (BRUTUS).
  if (s.fAbility !== L.fKind) {
    L.fKind = s.fAbility;
    L.crit = -2; // re-apply the NUKE label below
    const zap = s.fAbility === 'zap';
    const pound = s.fAbility === 'pound';
    const melt = s.fAbility === 'meltdown';
    const rockets = s.fAbility === 'missiles';
    H.flame.querySelector('.ss-ab-icon')!.textContent = zap ? '⚡' : pound ? '💥' : melt ? '☢️' : rockets ? '🌀' : '🔥';
    H.flame.querySelector('.ss-ab-name')!.textContent = zap ? 'CLAP' : pound ? 'POUND' : melt ? 'MELT' : rockets ? 'BURST' : 'FIRE';
    // The ultimate meter under the HP bar, one per plow.
    const ult = ULT_HUD[s.fAbility];
    H.crit.dataset.ult = s.fAbility;
    H.crit.querySelector('.ss-batt-label')!.textContent = ult.bar;
    H.crit.querySelector('.ss-crit-tag')!.textContent = `${ult.tag} READY · F`;
    ui.refreshKeys();
    H.flame.classList.toggle('ss-ab-melt', melt);
    H.flame.classList.toggle('ss-ab-zap', zap);
    H.flame.classList.toggle('ss-ab-pound', pound);
  }
  // ISOTOPE Critical Mass: full = the next F is a NUKE (the F icon says so too).
  const cm = s.critMass === undefined || s.critMass < 0 ? -1 : Math.round(clamp01(s.critMass) * 100) / 100;
  if (cm !== L.crit) {
    H.crit.classList.toggle('hidden', cm < 0);
    if (cm >= 0) H.critFill.style.transform = `scaleX(${cm})`;
    const full = cm >= 1;
    H.crit.classList.toggle('full', full);
    if (s.fAbility === 'meltdown') {
      H.flame.querySelector('.ss-ab-icon')!.textContent = '☢️';
      H.flame.querySelector('.ss-ab-name')!.textContent = full ? 'NUKE' : 'MELT';
      H.flame.classList.toggle('ss-ab-nuke', full);
    } else {
      const ult = ULT_HUD[s.fAbility];
      H.flame.querySelector('.ss-ab-icon')!.textContent = full ? ult.icon : ult.baseIcon;
      H.flame.querySelector('.ss-ab-name')!.textContent = full ? ult.name : ult.baseName;
      H.flame.classList.toggle('ss-ab-nuke', full);
    }
    L.crit = cm;
  }
  // Battery Shield (VOLT-9).
  const bt = s.shield < 0 ? -1 : Math.round(clamp01(s.shield) * 100) / 100;
  if (bt !== L.batt) {
    H.batt.classList.toggle('hidden', bt < 0);
    if (bt >= 0) H.battFill.style.transform = `scaleX(${bt})`;
    H.batt.classList.toggle('empty', bt === 0);
    L.batt = bt;
  }
  // F ability: hidden while it does nothing (e.g. Thunderclap before it is bought); Inferno and Pound are free.
  const f = s.flameReady < 0 ? -1 : Math.round(clamp01(s.flameReady) * 50) / 50;
  if (f !== L.flame) {
    H.flame.style.display = f < 0 ? 'none' : '';
    if (f >= 0) setAbility(H.flame, f, L.flame);
    L.flame = f;
  }
  // Thunderclap Overload: heat meter (full at 3 heat ~ a clap per second) + predicted self-damage.
  const ht = s.overload === undefined || s.overload < 0 ? -1 : Math.round(Math.min(1, s.overload / 3) * 50) / 50;
  const hc = ht < 0 ? -1 : Math.round(s.overloadCost ?? 0);
  if (ht !== L.heat || hc !== L.heatCost) {
    H.heat.classList.toggle('hidden', ht < 0);
    if (ht >= 0) {
      H.heatFill.style.transform = `scaleX(${ht})`;
      H.heatTxt.textContent = `-${hc} HP`;
      H.heat.dataset.t = ht >= 0.6 ? '2' : ht >= 0.25 ? '1' : '0';
    }
    L.heat = ht;
    L.heatCost = hc;
  }

  // combo
  const c = s.combo >= 2 ? Math.floor(s.combo) : 0;
  if (c !== L.combo) {
    if (c >= 2) {
      H.comboN.textContent = `x${c}`;
      const tier = c >= 20 ? 3 : c >= 10 ? 2 : c >= 5 ? 1 : 0;
      if (tier !== L.comboTier) {
        L.comboTier = tier;
        H.combo.dataset.t = String(tier);
      }
      H.combo.classList.add('on');
      if (c > L.combo) restart(H.comboN, 'pop');
    } else {
      H.combo.classList.remove('on');
    }
    L.combo = c;
  }

  // snow remaining
  const sf = Math.round(clamp01(s.snowFraction) * 100);
  if (sf !== L.snow) {
    L.snow = sf;
    H.snowFill.style.transform = `scaleX(${sf / 100})`;
    H.snowTxt.textContent = `${sf}%`;
    H.snowFill.classList.toggle('low', sf < 25);
  }

  // countdown
  const cn = s.countdown > 0 ? Math.ceil(s.countdown) : 0;
  if (cn !== L.count) {
    if ((cn > 0) !== (L.count > 0)) H.count.classList.toggle('hidden', cn <= 0);
    L.count = cn;
    if (cn > 0) {
      H.count.textContent = String(cn);
      restart(H.count, 'pop');
    }
  }
}
