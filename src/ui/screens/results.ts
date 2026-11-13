/** Campaign / Survival results screen: stats, challenge report, daily card, loot, story outro and the next-step buttons. */
import type { GameContext, RunSummary, UIHandlers } from '../../core/types';
import { ZONES } from '../../config/zones';
import { CHAPTERS, EPILOGUE, HARD_CHAPTERS, HARD_EPILOGUE } from '../../config/lore';
import { activeDaily } from '../../meta/daily';
import { hardUnlocked, lastChallengeReport } from '../../meta/challenges';
import { renderDailyResult } from '../DailyResult';
import { renderLoot } from '../LootReveal';
import type { Story } from '../Story';
import { el, fmt, starsHtml, type BtnFn } from '../uiKit';

export interface ResultDeps {
  ctx: GameContext;
  handlers: UIHandlers;
  resultPanel: HTMLElement;
  btn: BtnFn;
  story: Story;
  openGarage: (back: 'menu' | 'quit') => void;
}

export function renderResult(ui: ResultDeps, sum: RunSummary, win: boolean): void {
  const p = ui.resultPanel;
  p.textContent = '';
  p.classList.toggle('win', win);
  p.classList.toggle('lose', !win);
  el('div', 'ss-result-emoji', win ? '🏆' : sum.survival?.endedEarly ? '🏁' : '💥', p);
  el('h2', 'ss-h2 ss-result-title', win ? `${sum.bossName} DESTROYED!` : sum.survival?.endedEarly ? 'RUN BANKED!' : 'WRECKED!', p);
  el(
    'div',
    'ss-sub',
    win
      ? `${sum.zoneName} cleared! The arena is yours.`
      : sum.survival && sum.daily
        ? `${sum.survival.endedEarly ? 'Banked' : 'Scrapped on'} wave ${sum.survival.wave}. Same lineup all day, so retry and push your best!`
        : sum.survival
        ? `${sum.survival.endedEarly ? 'Banked' : 'Scrapped on'} wave ${sum.survival.wave}. ${sum.survival.newBest ? '🌟 NEW BEST!' : `Best: wave ${sum.survival.best}.`} Coins are kept, so upgrade and go again!`
        : `Your plow got scrapped in ${sum.zoneName}. Coins are kept, so upgrade and get back in there!`,
    p,
  );

  const grid = el('div', 'ss-stats', undefined, p);
  const stat = (icon: string, label: string, value: string, delay: number) => {
    const s = el('div', 'ss-stat', undefined, grid);
    s.style.animationDelay = `${delay}ms`;
    el('div', 'ss-stat-icon', icon, s);
    el('div', 'ss-stat-val', value, s);
    el('div', 'ss-stat-label', label, s);
  };
  if (sum.survival) stat('🌊', 'Waves cleared', `${sum.roundsCleared}`, 100);
  else stat('🏁', win ? 'Rounds cleared' : 'Rounds survived', `${sum.roundsCleared}/${sum.totalRounds}`, 100);
  stat('🤖', 'Bots scrapped', fmt(sum.kills), 180);
  stat('🔥', 'Best combo', sum.bestCombo >= 2 ? `x${sum.bestCombo}` : '—', 260);
  stat('⚪', 'Biggest ball', `${sum.biggestBall.toFixed(2)} m`, 340);
  stat('🪙', 'Coins earned', `+${fmt(sum.coinsEarned)}`, 420);
  if (!sum.survival) renderCampaignChallenges(p, sum);
  // ---- Survival (normal runs): this plow's record, then every plow's best wave.
  const sv = sum.survival;
  if (sv?.plow) {
    el('div', 'ss-sub', `${sv.plow.icon} ${sv.plow.name}: ${sv.plow.newBest ? `🌟 new plow best, wave ${sv.plow.best}!` : `best wave ${sv.plow.best}.`}`, p);
    const row = el('div', 'ss-sv-plowbests', undefined, p);
    for (const b of sv.plowBests ?? []) {
      const c = el('div', `ss-sv-plowbest${b.current ? ' on' : ''}`, `${b.icon} ${b.name} `, row);
      el('b', '', b.best > 0 ? `${b.best}` : '—', c);
    }
  }

  // ---- Daily Survival: date, modifier, wave vs today's best, last 7 days (ui/DailyResult.ts).
  const daily = sum.survival && sum.daily ? activeDaily() : null;
  if (daily && sum.survival) renderDailyResult(p, ui.ctx.progression, daily, sum.survival.wave, sum.survival.newBest);
  // ---- end Daily

  if (win && sum.clearReward > 0) {
    const r = el('div', 'ss-reward', undefined, p);
    el('span', 'ss-coin', undefined, r);
    el('span', '', `+${fmt(sum.clearReward)} ${sum.firstClear ? 'first-clear reward!' : 'clear reward'}`, r);
  }
  if (sum.loot?.length) renderLoot(p, sum.loot);
  // ---- Story: the chapter's ending after a campaign clear (the final arena adds the epilogue). A Hard clear after
  // MEGAPLOW Ω is beaten shows that arena's PROTOCOL B ending instead (all six adds the Hard epilogue).
  const zoneId = ui.ctx.zone?.id;
  const prog = ui.ctx.progression;
  const lastId = ZONES[ZONES.length - 1].id;
  const hardStory = !!sum.hard && prog.zoneRecord(lastId).cleared;
  const chapter = win && !sum.survival && zoneId ? (hardStory ? HARD_CHAPTERS : CHAPTERS)[zoneId] : undefined;
  if (chapter) {
    const box = el('div', 'ss-result-story', undefined, p);
    el('div', 'ss-result-story-h', hardStory ? '☠️ STORY · PROTOCOL B' : '📜 STORY', box);
    el('p', '', chapter.outro, box);
    const end = hardStory ? (ZONES.every((z) => prog.data.hardCleared?.[z.id] === true) ? HARD_EPILOGUE : '') : zoneId === lastId ? EPILOGUE : '';
    if (end) el('p', '', end, box).style.marginTop = '8px';
  }
  if (win && sum.unlockedZoneName) {
    const u = el('div', 'ss-unlock', undefined, p);
    el('span', '', '🔓 New arena unlocked: ', u);
    el('b', '', sum.unlockedZoneName, u);
  }

  const btns = el('div', 'ss-result-btns', undefined, p);
  if (win) {
    const nextIdx = (ui.ctx.zone?.index ?? 0) + 1;
    if (nextIdx < ZONES.length && ui.ctx.progression.isZoneUnlocked(nextIdx)) {
      // A Hard win carries on in Hard if the next arena has Hard open (it needs a normal clear first).
      const hard = !!sum.hard && hardUnlocked(ui.ctx.progression, nextIdx);
      ui.btn(hard ? 'NEXT ARENA · 💀 HARD ▶' : 'NEXT ARENA ▶', 'ss-primary ss-big', () => ui.handlers.onStartZone(nextIdx, hard), btns).dataset.primary = '1';
    } else if (nextIdx >= ZONES.length) {
      btns.before(el('div', 'ss-unlock', '🌟 Every arena conquered. You are the Snowplow Champion!'));
    }
  } else {
    ui.btn('↻ RETRY', 'ss-primary ss-big', () => ui.handlers.onRetry(), btns).dataset.primary = '1';
  }
  if (chapter && zoneId) ui.btn('📜 STORY', 'ss-ice', () => ui.story.open(hardStory ? 'hard' : 'story', zoneId), btns);
  const g = ui.btn('🔧 GARAGE', 'ss-ice', () => ui.openGarage('quit'), btns);
  const m = ui.btn('🏠 MAIN MENU', 'ss-ice', () => ui.handlers.onQuitToMenu(), btns);
  if (!btns.querySelector('[data-primary]')) (win ? m : g).dataset.primary = '1';
}

/** Campaign results: HARD badge under the emoji, then the arena's three challenges (✓ met this run,
 *  NEW for first-time stars, ★ already owned) and the star coin bonus. */
function renderCampaignChallenges(p: HTMLElement, sum: RunSummary): void {
  if (sum.hard) p.querySelector('.ss-result-emoji')?.after(el('div', 'ss-hard-badge', '💀 HARD MODE'));
  const rep = lastChallengeReport();
  if (!rep) return;
  const box = el('div', `ss-chal-result ${rep.newStars ? 'has-new' : ''}`, undefined, p);
  const head = el('div', 'ss-chal-result-head', undefined, box);
  el('span', 'ss-chal-result-stars', undefined, head).innerHTML = starsHtml(rep.stars, rep.results.filter((r) => r.isNew).length);
  el('span', 'ss-chal-result-title', 'CHALLENGES', head);
  if (rep.bonus > 0) el('span', 'ss-chal-result-bonus', `+${fmt(rep.bonus)} 🪙 star bonus`, head);
  else if (!rep.won) el('span', 'ss-chal-result-hint', 'Clear the arena to earn stars', head);
  rep.results.forEach((r, i) => {
    const row = el('div', `ss-chal-row ${r.met ? 'met' : ''} ${r.isNew ? 'new' : ''} ${r.owned ? 'owned' : ''}`, undefined, box);
    row.style.animationDelay = `${520 + i * 110}ms`;
    el('span', 'ss-chal-row-mark', r.met ? '✓' : r.owned ? '★' : r.def.icon, row);
    const tx = el('span', 'ss-chal-row-text', undefined, row);
    el('b', '', r.def.name, tx);
    el('small', '', r.def.goal, tx);
    if (!r.met && !r.owned && r.def.tip) el('small', 'ss-chal-row-tip', `💡 ${r.def.tip}`, tx);
    if (r.isNew) el('span', 'ss-chal-row-new', 'NEW ★', row);
    else if (r.owned) el('span', 'ss-chal-row-owned', '★', row);
  });
}
