import { BRAWL_BOTS, BRAWL_KILL_TARGET, BRAWL_RESPAWN, BRAWL_TIME, STREAK_TIERS } from '../../config/brawl';
import { fmtMult } from '../BrawlHud';
import { el, fmtTime, type BtnFn } from '../uiKit';

export interface HowToDeps {
  controlsList: (parent: HTMLElement) => HTMLElement;
  btn: BtnFn;
  showMainMenu: () => void;
}

/** How to Play: controls cheat-sheet, the basics and the Brawl rules, built into the screen `s`. */
export function buildHowTo(ui: HowToDeps, s: HTMLElement): void {
  const panel = el('div', 'ss-panel ss-glass ss-howto ss-icicles', undefined, s);
  el('h2', 'ss-h2', 'HOW TO PLAY', panel);
  const cols = el('div', 'ss-howto-cols', undefined, panel);
  const left = el('div', 'ss-howto-col', undefined, cols);
  el('h3', 'ss-h3', 'Controls', left);
  ui.controlsList(left);
  const right = el('div', 'ss-howto-col', undefined, cols);
  el('h3', 'ss-h3', 'The Brawl', right);
  const steps: [string, string, string][] = [
    ['🚜', 'Plow it', 'Drive through deep snow. Your blade packs it into a snowball that grows on the front of your plow.'],
    ['🛡️', 'Pack it', 'A held ball is your shield too. It blocks part of every hit that comes at your front, so face the danger.'],
    ['💥', 'SLAM it', 'Get up close and press SPACE to smash the ball into bots. Bigger balls hit WAY harder. A Glacier flattens what a Snowball only tickles.'],
    ['⚡', 'DASH STRIKE', 'SHIFT launches a long, blistering burst that smashes straight through bots like a truck. Use it to finish, to escape, or to dodge boss charges.'],
    ['🌀', 'Whirlwind', 'E spins up a snow tornado (always available): it pulls nearby bots in, shreds them with repeated hits, blasts them out and sucks up snow into your ball.'],
    ['🏎️', 'Ram', 'Ramming bots at speed hurts them too. Faster closing speed = bigger hit.'],
    ['⚠️', 'Read the boss', 'Bosses telegraph big attacks with red stripes and rings. Dodge, then punish them while they are stunned or dizzy.'],
    ['🪙', 'Upgrade', 'Scrapped bots drop coins. Spend them between rounds and in the Garage. You keep your coins even if you get wrecked.'],
  ];
  const list = el('div', 'ss-steps', undefined, right);
  for (const [icon, t, d] of steps) {
    const row = el('div', 'ss-step', undefined, list);
    el('div', 'ss-step-icon', icon, row);
    const tx = el('div', 'ss-step-text', undefined, row);
    el('b', '', t, tx);
    el('span', '', d, tx);
  }
  el('h3', 'ss-h3 ss-howto-brawl-h', '🔥 Snowdome Brawl', right);
  const bl = el('div', 'ss-step ss-howto-brawl', undefined, right);
  el('div', 'ss-step-icon', '🏟️', bl);
  const bt = el('div', 'ss-step-text', undefined, bl);
  el('b', '', 'Free-for-all in a huge arena', bt);
  el(
    'span',
    '',
    `You + ${BRAWL_BOTS} rival plows, everyone hunting everyone. ${fmtTime(BRAWL_TIME)} or first to ${BRAWL_KILL_TARGET} kills. ` +
      `Wrecked plows respawn in ${BRAWL_RESPAWN}s. Kill streaks multiply your coins (up to ${fmtMult(STREAK_TIERS[STREAK_TIERS.length - 1].mult)}), ` +
      'ending a rival\'s streak pays a shutdown bounty, and top placements earn a bonus.',
    bt,
  );
  const foot = el('div', 'ss-panel-foot', undefined, panel);
  ui.btn('◀ BACK', 'ss-primary', () => ui.showMainMenu(), foot).dataset.primary = '1';
}
