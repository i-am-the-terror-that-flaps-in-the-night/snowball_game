import type { GameContext, SoundName, UIHandlers } from '../../core/types';
import { ZONES, type ZoneDef } from '../../config/zones';
import { ENEMIES, type EnemyDef } from '../../config/enemies';
import { HARD, earnedIds, hardCleared, hardPower, hardReward, hardScale, hardUnlocked, maxStars, protocolStarIds, starReward, zoneChallenges, zoneStars } from '../../meta/challenges';
import { PROTOCOL_CHALLENGES, PROTOCOL_STAR_REWARD, protocolChallengeText } from '../../config/challenges';
import { totalStars } from '../../meta/progress';
import { bossColor, bossCount, el, fmt, hex, restart, starsHtml, type BtnFn } from '../uiKit';
import { PROTOCOL_FINALE, PROTOCOL_WAVES, PROTOCOL_ZONE } from '../../config/protocol';
import { formatRunTime, protocolReward, protocolSave, protocolTeased, protocolUnlocked } from '../../meta/protocol';

/** What the arena select needs from the UI: its grid / star total and the shared button + sound helpers. */
export interface ZonesDeps {
  ctx: GameContext;
  handlers: UIHandlers;
  zoneGrid: HTMLElement;
  zoneStarTotal: HTMLElement;
  sfx: (name: SoundName) => void;
  btn: BtnFn;
}

function zoneBossDef(z: ZoneDef): EnemyDef | undefined {
  for (const r of z.rounds) if (r.boss) for (const g of r.groups) if (ENEMIES[g.type].isBoss) return ENEMIES[g.type];
  return undefined;
}

export function renderZones(ui: ZonesDeps): void {
  const p = ui.ctx.progression;
  ui.zoneGrid.textContent = '';
  ui.zoneStarTotal.innerHTML = `<span class="ss-star-ico">★</span> ${totalStars(p)}<small>/${maxStars()}</small>`;
  let firstPlayable: HTMLButtonElement | null = null;
  let lastUnlocked: HTMLButtonElement | null = null;
  ZONES.forEach((z, i) => {
    const unlocked = p.isZoneUnlocked(i);
    const rec = p.zoneRecord(z.id);
    const total = z.rounds.length;
    // Slot = arena card + its Hard-mode strip (a separate button: buttons can't nest).
    const slot = el('div', 'ss-zone-slot', undefined, ui.zoneGrid);
    const card = el('button', `ss-zone ${unlocked ? '' : 'locked'} ${rec.cleared ? 'cleared' : ''}`, undefined, slot);
    card.type = 'button';
    card.style.setProperty('--sky-top', hex(z.skyTop));
    card.style.setProperty('--sky-bottom', hex(z.skyBottom));
    const bdef = zoneBossDef(z);
    card.style.setProperty('--bc', bossColor(bdef));
    el('div', 'ss-zone-num', String(i + 1), card);
    const top = el('div', 'ss-zone-top', undefined, card);
    el('div', 'ss-zone-name', z.name, top);
    el('div', 'ss-zone-tag', z.tagline, top);

    const boss = el('div', 'ss-zone-boss', undefined, card);
    el('div', 'ss-zone-boss-badge', '💀', boss);
    const bt = el('div', 'ss-zone-boss-text', undefined, boss);
    el('small', '', bossCount(z) > 1 ? 'BOSSES' : 'BOSS', bt);
    el('b', '', z.bossName, bt);

    const bottom = el('div', 'ss-zone-bottom', undefined, card);
    if (rec.cleared) {
      const badges = el('div', 'ss-zone-badges', undefined, bottom);
      el('div', 'ss-zone-badge', '✓ CLEARED', badges);
      if (hardCleared(p, i)) el('div', 'ss-zone-skull', '💀 HARD', badges).title = 'Hard mode beaten';
    }
    zoneChallengeList(ui, i, bottom);
    const best = Math.min(rec.bestRound, total);
    el('div', 'ss-zone-stat', `⚔ ${total - 1} + boss  ·  🏁 ${best > 0 ? `best ${best}/${total}` : 'best —'}`, bottom);
    el('div', 'ss-zone-stat ss-zone-reward', `🪙 ${fmt(rec.cleared ? Math.round(z.clearReward * 0.4) : z.clearReward)} clear reward`, bottom);
    if (!unlocked) {
      const lock = el('div', 'ss-zone-lock', undefined, card);
      el('div', 'ss-lock-icon', '🔒', lock);
      const prev = ZONES[i - 1];
      el('div', 'ss-lock-text', prev ? `Defeat ${prev.bossName} in ${prev.name} to unlock` : 'Locked', lock);
    }
    card.addEventListener('click', () => {
      if (!unlocked) {
        ui.sfx('error');
        restart(card, 'shake');
        return;
      }
      ui.sfx('click');
      ui.handlers.onStartZone(i);
    });
    zoneHardStrip(ui, i, slot);
    if (unlocked && !rec.cleared && !firstPlayable) firstPlayable = card;
    if (unlocked) lastUnlocked = card;
  });
  protocolCard(ui);
  // First unlocked arena not yet beaten; once every open arena is cleared, the newest open one.
  const fp = (firstPlayable ?? lastUnlocked) as HTMLButtonElement | null;
  ui.zoneGrid.querySelectorAll('[data-primary]').forEach((n) => delete (n as HTMLElement).dataset.primary);
  if (fp) fp.dataset.primary = '1';
}

/** Zone card: ★★☆☆☆ and the arena's challenge goals, earned ones ticked (full name + goal on hover). */
function zoneChallengeList(ui: ZonesDeps, zoneIndex: number, parent: HTMLElement): void {
  const p = ui.ctx.progression;
  const got = earnedIds(p, zoneIndex);
  const n = zoneStars(p, zoneIndex);
  const list = zoneChallenges(zoneIndex);
  const box = el('div', `ss-zone-chals ${n >= list.length ? 'all' : ''}`, undefined, parent);
  const head = el('div', 'ss-zone-chal-head', undefined, box);
  el('span', 'ss-zone-stars', undefined, head).innerHTML = starsHtml(n, 0, list.length);
  el('small', '', `+${fmt(starReward(zoneIndex))} 🪙 / star`, head);
  for (const c of list) {
    const done = got.has(c.id);
    const row = el('div', `ss-zone-chal ${done ? 'done' : ''}`, undefined, box);
    el('span', 'ss-zone-chal-mark', done ? '✓' : c.icon, row);
    el('span', 'ss-zone-chal-goal', c.goal, row);
    row.title = `${c.name}: ${c.goal}${done ? ' ✓' : ''}${c.tip ? `\n${c.tip}` : ''}`;
  }
}

/** PROTOCOL C card: its own five combat stars (save.protocol.stars; not part of the campaign star total). */
function protocolChallengeList(ui: ZonesDeps, parent: HTMLElement): void {
  const got = protocolStarIds(ui.ctx.progression);
  const n = PROTOCOL_CHALLENGES.filter((c) => got.has(c.id)).length;
  const box = el('div', `ss-zone-chals ss-protocol-chals ${n >= PROTOCOL_CHALLENGES.length ? 'all' : ''}`, undefined, parent);
  const head = el('div', 'ss-zone-chal-head', undefined, box);
  el('span', 'ss-zone-stars', undefined, head).innerHTML = starsHtml(n, 0, PROTOCOL_CHALLENGES.length);
  el('small', '', `+${fmt(PROTOCOL_STAR_REWARD)} 🪙 / star · not in the campaign total`, head);
  const cleared = ui.ctx.progression.data.protocol?.cleared === true;
  for (const def of PROTOCOL_CHALLENGES) {
    const done = got.has(def.id);
    const c = protocolChallengeText(def, cleared);
    const row = el('div', `ss-zone-chal ${done ? 'done' : ''}`, undefined, box);
    el('span', 'ss-zone-chal-mark', done ? '✓' : c.icon, row);
    el('span', 'ss-zone-chal-goal', c.goal, row);
    row.title = `${c.name}: ${c.goal}${done ? ' ✓' : ''}${c.tip ? `\n${c.tip}` : ''}`;
  }
}

/** Under each card: the HARD button once the arena is cleared (💀 ✓ once beaten), a locked hint before that. */
function zoneHardStrip(ui: ZonesDeps, zoneIndex: number, slot: HTMLElement): void {
  const p = ui.ctx.progression;
  const k = hardScale(hardPower((id) => p.statLevel(id), p.data.plow));
  const f = (n: number) => String(Math.round(n * 100) / 100);
  const tip =
    `Hard mode: bots ×${f(HARD.hpMult * k.hp)} HP, ×${f(HARD.dmgMult * k.dmg)} damage, +${Math.round((HARD.minionMult - 1) * 100)}% minions. ` +
    `×${HARD.coinMult} coins. Stars count here too.` +
    (k.hp > 1 ? ' Scaled up for your upgrades.' : ' Bots get tougher as your plow gets stronger.');
  // A locked arena gets no HARD button even when an old save has it cleared (startRun would refuse it anyway).
  const arenaOpen = p.isZoneUnlocked(zoneIndex);
  if (!arenaOpen || !hardUnlocked(p, zoneIndex)) {
    const s = el('div', 'ss-zone-hard locked', undefined, slot);
    s.innerHTML = `🔒 <b>HARD</b> <small>${arenaOpen ? 'clear to unlock' : 'arena locked'}</small>`;
    s.title = tip;
    return;
  }
  const beaten = hardCleared(p, zoneIndex);
  const b = ui.btn(
    `💀 <b>HARD</b> <small>${beaten ? '✓ · ' : ''}🪙 ${fmt(hardReward(p, zoneIndex))}</small>`,
    `ss-zone-hard ${beaten ? 'beaten' : ''}`,
    () => ui.handlers.onStartZone(zoneIndex, true),
    slot,
  );
  b.title = tip;
}

/** PROTOCOL C (config/protocol.ts): nothing before the normal Omega clear; then a glitched, locked seventh card (a full
 *  row) until every arena is beaten on normal and Hard; then the playable card with its best time and, while a run's
 *  checkpoint is saved, a RESUME strip. */
function protocolCard(ui: ZonesDeps): void {
  const p = ui.ctx.progression;
  if (!protocolTeased(p)) return;
  const open = protocolUnlocked(p);
  const rec = protocolSave(p);
  const slot = el('div', 'ss-zone-slot ss-protocol-slot', undefined, ui.zoneGrid);
  const card = el('button', `ss-zone ss-protocol ${open ? '' : 'locked glitch'} ${rec.cleared ? 'cleared' : ''}`, undefined, slot);
  card.type = 'button';
  card.style.setProperty('--sky-top', hex(PROTOCOL_ZONE.skyTop));
  card.style.setProperty('--sky-bottom', hex(PROTOCOL_ZONE.skyBottom));
  card.style.setProperty('--bc', '#e8b423');
  el('div', 'ss-zone-num', open ? '7' : '?', card);
  const top = el('div', 'ss-zone-top', undefined, card);
  const name = el('div', 'ss-zone-name', 'PROTOCOL C', top);
  name.dataset.text = 'PROTOCOL C';
  el('div', 'ss-zone-tag', open ? 'Seven waves. Every boss you beat, back for more. Someone is watching from the boardroom.' : 'TODO', top);
  const bottom = el('div', 'ss-zone-bottom', undefined, card);
  if (open) {
    if (rec.cleared) el('div', 'ss-zone-badge', '✓ CLEARED', el('div', 'ss-zone-badges', undefined, bottom));
    protocolChallengeList(ui, bottom);
    el('div', 'ss-zone-stat', `☠ ${PROTOCOL_WAVES} boss waves  ·  ⏱ best ${formatRunTime(rec.bestTime)}  ·  🏁 ${rec.bestWave >= PROTOCOL_FINALE ? 'the finale' : rec.bestWave > 0 ? `wave ${rec.bestWave}/${PROTOCOL_WAVES}` : 'wave —'}`, bottom);
    el('div', 'ss-zone-stat ss-zone-reward', `🪙 ${fmt(protocolReward(p))} clear reward`, bottom);
  } else {
    const hard = ZONES.filter((z) => p.data.hardCleared?.[z.id] === true).length;
    const lock = el('div', 'ss-zone-lock', undefined, card);
    el('div', 'ss-lock-icon', '🔒', lock);
    el('div', 'ss-lock-text', `PROTOCOL C: TODO — clear every arena on Hard (${hard}/${ZONES.length})`, lock);
  }
  card.addEventListener('click', () => {
    if (!open) {
      ui.sfx('error');
      restart(card, 'shake');
      return;
    }
    ui.sfx('click');
    ui.handlers.onStartProtocol?.(false);
  });
  const ck = rec.checkpoint;
  if (open && ck && ck.wave > 1) {
    const b = ui.btn(`▶ <b>RESUME</b> <small>${ck.wave >= PROTOCOL_FINALE ? 'the finale' : `wave ${ck.wave}/${PROTOCOL_WAVES}`} · checkpoint</small>`, 'ss-zone-hard ss-protocol-resume', () => ui.handlers.onStartProtocol?.(true), slot);
    b.title = 'Restart the saved run at the start of its last wave (counts as a checkpoint retry).';
  }
}
