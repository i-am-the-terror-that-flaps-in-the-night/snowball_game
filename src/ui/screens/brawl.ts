/** Snowdome Brawl lobby (rules, streak tiers, placement bonus, difficulty cards, records) and the match results. */
import type { BrawlDifficulty, BrawlEntry, BrawlResult, GameContext, SoundName, UIHandlers } from '../../core/types';
import {
  BRAWL_BOTS, BRAWL_DIFFICULTIES, BRAWL_KILL_COINS, BRAWL_KILL_TARGET, BRAWL_PLACEMENT_BONUS, BRAWL_RESPAWN,
  BRAWL_SHUTDOWN_PER_STREAK, BRAWL_TIME, STREAK_TIERS,
} from '../../config/brawl';
import { fmtMult } from '../BrawlHud';
import { renderLoot } from '../LootReveal';
import { el, fmt, fmtTime, ordinal, type BtnFn } from '../uiKit';

export interface BrawlScreenDeps {
  ctx: GameContext;
  handlers: UIHandlers;
  lobbyPanel: HTMLElement;
  bresultScreen: HTMLElement;
  bresultPanel: HTMLElement;
  sfx: (name: SoundName) => void;
  btn: BtnFn;
  showMainMenu: () => void;
  openGarage: (back: 'menu' | 'quit') => void;
}

export function renderLobby(ui: Pick<BrawlScreenDeps, 'ctx' | 'handlers' | 'lobbyPanel' | 'sfx' | 'btn' | 'showMainMenu'>): void {
  const p = ui.lobbyPanel;
  const d = ui.ctx.progression.data;
  p.textContent = '';
  const head = el('div', 'ss-lobby-head', undefined, p);
  el('div', 'ss-lobby-kicker', '🔥 NEW MODE 🔥', head);
  el('h2', 'ss-h2 ss-lobby-title', 'SNOWDOME BRAWL', head);
  el('div', 'ss-sub ss-lobby-sub', `Free-for-all · ${BRAWL_BOTS + 1} plows · everyone hunts everyone`, head);

  const body = el('div', 'ss-lobby-body', undefined, p);
  const left = el('div', 'ss-lobby-col', undefined, body);

  // rules
  const rules = el('div', 'ss-lobby-box', undefined, left);
  el('h3', 'ss-h3', '📜 Rules', rules);
  const ul = el('ul', 'ss-rules', undefined, rules);
  const li = (icon: string, html: string) => {
    const r = el('li', '', undefined, ul);
    el('span', 'ss-rule-i', icon, r);
    el('span', 'ss-rule-t', undefined, r).innerHTML = html;
  };
  li('⏱', `<b>${fmtTime(BRAWL_TIME)}</b> match, or first to <b>${BRAWL_KILL_TARGET} kills</b> wins`);
  li('♻️', `Wrecked? Respawn in <b>${BRAWL_RESPAWN}s</b> — no lives, just keep brawling`);
  li('🪙', `Every kill pays <b>${BRAWL_KILL_COINS} coins</b> × streak × lobby bonus`);
  li('🎯', `<b>Shutdown bounty:</b> end a 3+ streak for <b>${BRAWL_SHUTDOWN_PER_STREAK}</b> coins per kill in it (gold ring on the minimap)`);

  // streak tiers
  const tiers = el('div', 'ss-lobby-box ss-tiers-box', undefined, left);
  el('h3', 'ss-h3', '🔥 Kill streaks', tiers);
  const tbl = el('div', 'ss-tiers', undefined, tiers);
  STREAK_TIERS.forEach((t, i) => {
    const row = el('div', `ss-tier t${i + 1}`, undefined, tbl);
    el('span', 'ss-tier-fl', '🔥'.repeat(i + 1), row);
    el('span', 'ss-tier-l', t.label, row);
    el('span', 'ss-tier-at', `${t.at} kills`, row);
    el('span', 'ss-tier-m', `${fmtMult(t.mult)} coins`, row);
  });
  el('div', 'ss-tier-note', 'Streaks reset when you get wrecked.', tiers);

  // placement
  const pl = el('div', 'ss-lobby-box', undefined, left);
  el('h3', 'ss-h3', '🏅 Placement bonus', pl);
  const pr = el('div', 'ss-place-row', undefined, pl);
  const medals = ['🥇', '🥈', '🥉', '🎖️'];
  BRAWL_PLACEMENT_BONUS.forEach((v, i) => {
    const c = el('div', `ss-place p${i + 1}`, undefined, pr);
    el('span', 'ss-place-m', medals[i] ?? '🎖️', c);
    el('b', '', ordinal(i + 1), c);
    el('span', 'ss-place-v', `+${fmt(v)}`, c);
  });

  // right: difficulty + records
  const right = el('div', 'ss-lobby-col', undefined, body);
  el('h3', 'ss-h3', '🎮 Choose your lobby', right);
  const cards = el('div', 'ss-diffs', undefined, right);
  const prefer: BrawlDifficulty = (d.brawlMatches ?? 0) === 0 ? 'rookie' : 'pro';
  for (const def of BRAWL_DIFFICULTIES) {
    const c = el('button', `ss-diff ss-diff-${def.id}`, undefined, cards);
    c.type = 'button';
    const top = el('div', 'ss-diff-top', undefined, c);
    el('span', 'ss-diff-name', def.name, top);
    el('span', 'ss-diff-mult', `${fmtMult(def.coinMult)} COINS`, top);
    el('div', 'ss-diff-blurb', def.blurb, c);
    const st = el('div', 'ss-diff-stats', undefined, c);
    el('span', '', `❤ ${Math.round(def.hpMult * 100)}% hp`, st);
    el('span', '', `💥 ${Math.round(def.dmgMult * 100)}% dmg`, st);
    el('span', '', `🎯 ${Math.round(def.skill * 100)}% skill`, st);
    el('div', 'ss-diff-go', 'BRAWL ▶', c);
    if (def.id === prefer) c.dataset.primary = '1';
    c.addEventListener('click', () => {
      ui.sfx('click');
      ui.handlers.onStartBrawl(def.id);
    });
  }

  const rec = el('div', 'ss-lobby-box ss-records', undefined, right);
  el('h3', 'ss-h3', '📈 Your records', rec);
  const grid = el('div', 'ss-rec-grid', undefined, rec);
  const r = (icon: string, label: string, v: string) => {
    const c = el('div', 'ss-rec', undefined, grid);
    el('div', 'ss-rec-i', icon, c);
    el('div', 'ss-rec-v', v, c);
    el('div', 'ss-rec-l', label, c);
  };
  r('🥇', 'Wins', fmt(d.brawlWins ?? 0));
  r('🏟️', 'Matches', fmt(d.brawlMatches ?? 0));
  r('🔥', 'Best streak', fmt(d.brawlBestStreak ?? 0));
  r('💀', 'Most kills', fmt(d.brawlBestKills ?? 0));

  const foot = el('div', 'ss-panel-foot', undefined, p);
  ui.btn('◀ BACK', 'ss-ice', () => ui.showMainMenu(), foot);
  el('div', 'ss-foot-hint', 'Tip: upgrades from the Garage carry into the Brawl', foot);
}

export function renderBrawlResult(ui: Pick<BrawlScreenDeps, 'handlers' | 'bresultScreen' | 'bresultPanel' | 'btn' | 'openGarage'>, r: BrawlResult): void {
  const scr = ui.bresultScreen;
  scr.querySelector('.ss-confetti')?.remove();
  const p = ui.bresultPanel;
  p.textContent = '';
  const place = Math.max(1, r.placement);
  const tier = place <= 3 ? place : 0;
  p.dataset.place = String(tier);
  if (place === 1) {
    const conf = el('div', 'ss-confetti', undefined);
    scr.insertBefore(conf, p);
    const cols = ['#ffc531', '#ff8a1f', '#fff3b0', '#ff5d14', '#7fe0ff', '#ffffff'];
    for (let i = 0; i < 70; i++) {
      const c = el('i', '', undefined, conf);
      c.style.left = `${Math.random() * 100}%`;
      c.style.background = cols[i % cols.length];
      c.style.animationDelay = `${(Math.random() * 1.6).toFixed(2)}s`;
      c.style.animationDuration = `${(2.4 + Math.random() * 1.8).toFixed(2)}s`;
      c.style.setProperty('--rx', `${Math.round(Math.random() * 720 - 360)}deg`);
      c.style.setProperty('--dx', `${Math.round(Math.random() * 160 - 80)}px`);
    }
  }
  const diff = BRAWL_DIFFICULTIES.find((x) => x.id === r.difficulty);
  el('div', 'ss-bres-kicker', `SNOWDOME BRAWL · ${diff?.name ?? r.difficulty}`, p);
  const big = el('div', 'ss-bres-place', undefined, p);
  if (place === 1) big.textContent = '1ST!';
  else {
    big.append(ordinal(place));
    el('small', '', ` of ${r.total}`, big);
  }
  el(
    'div',
    'ss-sub',
    place === 1 ? 'Champion of the Snowdome. Nobody plows like you.' : place <= 3 ? 'On the podium! So close to the crown.' : 'Shake off the snow and run it back.',
    p,
  );

  const grid = el('div', 'ss-stats ss-bres-stats', undefined, p);
  const stat = (icon: string, label: string, value: string, delay: number) => {
    const s = el('div', 'ss-stat', undefined, grid);
    s.style.animationDelay = `${delay}ms`;
    el('div', 'ss-stat-icon', icon, s);
    el('div', 'ss-stat-val', value, s);
    el('div', 'ss-stat-label', label, s);
  };
  stat('💀', 'Kills', fmt(r.kills), 120);
  stat('🪦', 'Deaths', fmt(r.deaths), 200);
  stat('🔥', 'Best streak', r.bestStreak > 0 ? String(r.bestStreak) : '—', 280);
  stat('🪙', 'Coins earned', `+${fmt(r.coinsEarned)}`, 360);

  const coins = el('div', 'ss-bres-coins', undefined, p);
  const line = (label: string, v: number, cls = '') => {
    const row = el('div', `ss-bres-line ${cls}`, undefined, coins);
    el('span', '', label, row);
    const b = el('b', '', undefined, row);
    el('span', 'ss-coin sm', undefined, b);
    b.append(`+${fmt(v)}`);
  };
  line('Match earnings (kills · streaks · shutdowns)', Math.max(0, r.coinsEarned - r.placementBonus));
  if (r.placementBonus > 0) line(`${ordinal(place)} place bonus`, r.placementBonus, 'bonus');
  line('Total', r.coinsEarned, 'total');

  // final leaderboard
  if (r.loot) renderLoot(p, [r.loot]);
  const tbl = el('div', 'ss-bres-board', undefined, p);
  const head = el('div', 'ss-bres-row head', undefined, tbl);
  for (const t of ['#', '', 'PLOWER', 'KILLS', 'DEATHS', 'BEST 🔥']) el('span', '', t, head);
  r.leaderboard.forEach((e: BrawlEntry, i) => {
    const row = el('div', `ss-bres-row${e.isPlayer ? ' me' : ''}${i === 0 ? ' first' : ''}`, undefined, tbl);
    row.style.animationDelay = `${300 + i * 50}ms`;
    el('span', 'ss-bres-r', i === 0 ? '👑' : String(i + 1), row);
    el('span', 'ss-bh-dot', undefined, row).style.background = e.color;
    const n = el('span', 'ss-bres-n', e.name, row);
    // Rival paint darkened toward ink so yellow/pink names stay readable on the light results panel.
    if (!e.isPlayer) n.style.color = `color-mix(in srgb, ${e.color} 62%, #fff)`;
    el('span', 'ss-bres-k', String(e.kills), row);
    el('span', '', String(e.deaths), row);
    el('span', '', e.bestStreak > 0 ? String(e.bestStreak) : '—', row);
  });

  const btns = el('div', 'ss-result-btns', undefined, p);
  ui.btn('↻ REMATCH', 'ss-primary ss-big', () => ui.handlers.onStartBrawl(r.difficulty), btns).dataset.primary = '1';
  ui.btn('🔧 GARAGE', 'ss-ice', () => ui.openGarage('quit'), btns);
  ui.btn('🏠 MENU', 'ss-ice', () => ui.handlers.onQuitToMenu(), btns);
}
