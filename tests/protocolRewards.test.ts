import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Progression, sanitizeProtocol } from '../src/core/Progression';
import { ZONES } from '../src/config/zones';
import { COSMETICS, COSMETIC_BY_ID } from '../src/config/cosmetics';
import {
  PROTOCOL_CHALLENGES, PROTOCOL_STAR_CHAIRMAN_S, protocolChallengeText, PROTOCOL_STAR_HP, PROTOCOL_STAR_HP_WAVE, PROTOCOL_STAR_REWARD, PROTOCOL_STAR_SWEEP_S,
  type ProtocolRun,
} from '../src/config/challenges';
import { PROTOCOL_ID, PROTOCOL_WAVES, PROTOCOL_ZONE, waveBossCount } from '../src/config/protocol';
import {
  PROTOCOL_COSMETICS, buyCheck, buyCosmetic, cosmeticsState, equipCosmetic, grantProtocolCosmetics, isOwned, lockHint, lockLabel, sanitizeCosmetics,
} from '../src/meta/cosmetics';
import { protocolSave, protocolStory, recordProtocolClear } from '../src/meta/protocol';
import {
  CHAIRMAN_LAND_DELAY, ChallengeTracker, awardProtocolRun, evaluateProtocolRun, lastChallengeReport, lastProtocolReport, maxStars, protocolStars,
} from '../src/meta/challenges';
import { totalStars } from '../src/meta/progress';
import { EventBus, type GameEvents } from '../src/core/events';
import type { EnemyHandle, GameContext } from '../src/core/types';
import { ACHIEVEMENT_BY_ID, LIFE, life, lifeBoss } from '../src/config/achievements';
import { Achievements, isUnlocked, unlockNew } from '../src/meta/achievements';
import { BOSS_LORE, BOSS_ORDER, HARD_EPILOGUE, PROTOCOL_C_BROADCAST, PROTOCOL_C_CHAPTER, TRUE_EPILOGUE } from '../src/config/lore';
import { PINSTRIPE_HALF_W, PINSTRIPE_SPACING, pinstripeAxis, pinstripeDistance } from '../src/entities/plow/pinstripe';
import { AVA_GATHER, AVA_IMPLODE, EYE_LIFE, FrostFx, MAX_BALLS, MAX_FROST, avalancheRadius, eyeOpen, spiralOffset } from '../src/fx/frostFx';
import { settings } from '../src/core/settings';
import { emitKillFx } from '../src/fx/killFx';

/* PROTOCOL C build stage 5 (rewards): the exclusive cosmetics and their grant, the achievements, the five PROTOCOL C
 * stars, story gating and save validation; the pinstripe / frost FX helpers. */

const SAVE_KEY = 'snowplow-showdown-save-v2';
let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Every campaign arena cleared on normal and (the first `hard`) on Hard. */
function clearAll(p: Progression, hard = ZONES.length): void {
  ZONES.forEach((z, i) => {
    p.data.zones[z.id] = { cleared: true, bestRound: z.rounds.length };
    if (i < hard) (p.data.hardCleared ??= {})[z.id] = true;
  });
  p.data.unlockedZones = ZONES.length;
}

/** A finished PROTOCOL C run payload. */
function runFin(extra: Partial<GameEvents['runFinished']> = {}): GameEvents['runFinished'] {
  return {
    mode: 'campaign', plow: 'classic', won: true, kills: 40, killsBy: { slam: 0, ram: 0, whirl: 0, other: 40 },
    coins: 0, bestCombo: 0, biggestBall: 0, duration: 600, damageTaken: 900, protocol: true, partial: false, roundsCleared: 7, ...extra,
  };
}

/** A cleared PROTOCOL C run that meets no star unless overridden. */
function prun(over: Partial<ProtocolRun> = {}): ProtocolRun {
  return {
    ...runFin({ partial: true }),
    waveDamage: new Array(PROTOCOL_WAVES).fill(NaN), echoSweep: Infinity, chairmanTime: Infinity, avalancheFirstTry: false,
    ...over,
  };
}

const metIds = (r: ReturnType<typeof evaluateProtocolRun>) => r.results.filter((x) => x.met).map((x) => x.def.id);

describe('PROTOCOL C exclusive cosmetics', () => {
  it('three exclusives: Hostile Takeover paint, Whiteout trail, Avalanche kill effect, all gated on the clear', () => {
    expect(PROTOCOL_COSMETICS.map((c) => c.id)).toEqual(['paint_takeover', 'trail_whiteout', 'kill_avalanche']);
    const paint = COSMETIC_BY_ID.get('paint_takeover')!;
    expect(paint.slot === 'paint' && paint.pattern).toBe('pinstripe');
    expect(paint.slot === 'paint' && paint.body! < 0x303030).toBe(true);
    const trail = COSMETIC_BY_ID.get('trail_whiteout')!;
    expect(trail.slot === 'trail' && trail.style).toBe('whiteout');
    const kill = COSMETIC_BY_ID.get('kill_avalanche')!;
    expect(kill.slot === 'kill' && kill.style).toBe('avalanche');
    for (const c of PROTOCOL_COSMETICS) expect(c.req).toEqual({ protocol: true });
    // nothing else is a PROTOCOL C exclusive
    expect(COSMETICS.filter((c) => c.req?.protocol)).toHaveLength(3);
  });

  it('never buyable before the clear, whatever the coins, stars and achievements', () => {
    const p = new Progression();
    p.data.coins = 1e7;
    clearAll(p);
    p.data.challenges = { z: Array.from({ length: 30 }, (_, i) => `c${i}`) };
    p.data.achievements = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`a${i}`, 1]));
    for (const c of PROTOCOL_COSMETICS) {
      expect(buyCheck(p, c.id)).toBe('locked');
      expect(buyCosmetic(p, c.id)).toBe(false);
      expect(lockLabel(p, c)).toBe('Beat PROTOCOL C');
      expect(lockHint(c)).toMatch(/PROTOCOL C/);
      expect(equipCosmetic(p, c.id)).toBe(false);
    }
    expect(p.coins).toBe(1e7);
    expect(grantProtocolCosmetics(p)).toEqual([]);
  });

  it('the first clear grants all three (free, saved); repeat clears grant nothing new', () => {
    const p = new Progression();
    clearAll(p);
    p.data.coins = 5;
    const first = recordProtocolClear(p, 500, 0);
    expect(first.firstClear).toBe(true);
    expect(first.granted.map((c) => c.id)).toEqual(PROTOCOL_COSMETICS.map((c) => c.id));
    for (const c of PROTOCOL_COSMETICS) {
      expect(isOwned(p, c.id)).toBe(true);
      expect(lockLabel(p, c)).toBeNull();
    }
    expect(p.coins).toBe(5);
    expect(equipCosmetic(p, 'paint_takeover')).toBe(true);
    expect(cosmeticsState(p).equipped.paint).toBe('paint_takeover');
    const again = recordProtocolClear(p, 480, 0);
    expect(again.granted).toEqual([]);
    // survives a reload and the save sanitizer
    const q = new Progression();
    expect(isOwned(q, 'trail_whiteout')).toBe(true);
    expect(sanitizeCosmetics(q.data.cosmetics).equipped.paint).toBe('paint_takeover');
  });

  it('an imported / hand-edited save that owns or wears an exclusive before the clear does not get it', () => {
    const p = new Progression();
    p.data.cosmetics = { owned: ['paint_takeover', 'trail_whiteout', 'kill_avalanche', 'paint_black'], equipped: { paint: 'paint_takeover', trail: 'trail_whiteout', kill: 'kill_avalanche' } };
    for (const c of PROTOCOL_COSMETICS) {
      expect(isOwned(p, c.id)).toBe(false);
      expect(equipCosmetic(p, c.id)).toBe(false);
    }
    expect(isOwned(p, 'paint_black')).toBe(true);
    const s = cosmeticsState(p);
    expect(s.equipped.paint).not.toBe('paint_takeover');
    expect(s.equipped.trail).not.toBe('trail_whiteout');
    expect(s.equipped.kill).not.toBe('kill_avalanche');
    // ...and once PROTOCOL C is cleared the same save wears them again
    clearAll(p);
    recordProtocolClear(p, 500, 0);
    expect(cosmeticsState(p).equipped.paint).toBe('paint_takeover');
  });

  it('a save that cleared PROTOCOL C before the exclusives existed gets them (grant on demand, or a free claim)', () => {
    const p = new Progression();
    clearAll(p);
    p.data.protocol = { cleared: true, clears: 1, bestTime: 400, bestWave: 7, cleanClear: false, checkpoint: null };
    p.data.coins = 0;
    expect(buyCheck(p, 'kill_avalanche')).toBe('ok');
    expect(buyCosmetic(p, 'kill_avalanche')).toBe(true);
    expect(p.coins).toBe(0);
    expect(grantProtocolCosmetics(p).map((c) => c.id)).toEqual(['paint_takeover', 'trail_whiteout']);
    expect(grantProtocolCosmetics(p)).toEqual([]);
  });
});

describe('PROTOCOL C achievements', () => {
  function fakeCtx(p = new Progression()) {
    vi.useFakeTimers();
    const toast = vi.fn();
    const ctx = {
      events: new EventBus(), progression: p, zone: { ...PROTOCOL_ZONE }, ui: { toast }, audio: { play: vi.fn() },
    } as unknown as GameContext;
    new Achievements(ctx);
    return { ctx, toast, p };
  }
  const bot = (type: string, extra: Record<string, unknown> = {}) => ({ id: 1, type, isBoss: true, ...extra }) as unknown as EnemyHandle;

  it('unlock, clear and a clean clear read the save', () => {
    const p = new Progression();
    expect(unlockNew(p).map((a) => a.id)).not.toContain('protocol_open');
    clearAll(p, ZONES.length - 1);
    expect(unlockNew(p).map((a) => a.id)).not.toContain('protocol_open');
    clearAll(p);
    expect(unlockNew(p).map((a) => a.id)).toContain('protocol_open');
    recordProtocolClear(p, 600, 2);
    let got = unlockNew(p).map((a) => a.id);
    expect(got).toContain('protocol_clear');
    expect(got).not.toContain('protocol_clean');
    recordProtocolClear(p, 600, 0);
    got = unlockNew(p).map((a) => a.id);
    expect(got).toEqual(expect.arrayContaining(['protocol_clean']));
  });

  it('PROTOCOL C opening also plays the radio broadcast', () => {
    const p = new Progression();
    clearAll(p);
    const { toast } = fakeCtx(p);
    vi.advanceTimersByTime(1500);
    expect(toast).toHaveBeenCalledWith(PROTOCOL_C_BROADCAST, 'radio');
    expect(isUnlocked(p, 'protocol_open')).toBe(true);
  });

  it('THE CHAIRMAN, a broken HOSTILE TAKEOVER and THE AVALANCHE', () => {
    const { ctx, p } = fakeCtx();
    // an echo of THE CHAIRMAN does not exist; the real one counts
    ctx.events.emit('bossDefeated', { enemy: bot('chairman'), name: 'THE CHAIRMAN' });
    expect(life(p, lifeBoss('chairman'))).toBe(1);
    expect(isUnlocked(p, 'boss_chairman')).toBe(true);
    // an echo wrecked after its takeover ran out does not count; one still ACQUIRED does
    ctx.events.emit('enemyKilled', { enemy: bot('bulldoza', { echo: true, acquired: 0 }), coins: 0 });
    ctx.events.emit('enemyKilled', { enemy: bot('bulldoza', { echo: false, acquired: 3 }), coins: 0 });
    expect(life(p, LIFE.takeoversBroken)).toBe(0);
    ctx.events.emit('enemyKilled', { enemy: bot('grinder', { echo: true, acquired: 2.5 }), coins: 0 });
    expect(life(p, LIFE.takeoversBroken)).toBe(1);
    expect(isUnlocked(p, 'takeover_broken')).toBe(true);
    ctx.events.emit('avalancheHit', { fullSize: false, attempt: 2 });
    expect(isUnlocked(p, 'avalanche')).toBe(true);
    for (const id of ['protocol_open', 'protocol_clear', 'protocol_clean', 'boss_chairman', 'takeover_broken', 'avalanche']) {
      const a = ACHIEVEMENT_BY_ID[id];
      expect(a, id).toBeTruthy();
      expect(a.reward).toBeLessThanOrEqual(500);
    }
  });
});

describe('PROTOCOL C stars', () => {
  it('five stars of its own, never part of the campaign total', () => {
    expect(PROTOCOL_CHALLENGES).toHaveLength(5);
    expect(new Set(PROTOCOL_CHALLENGES.map((c) => c.id)).size).toBe(5);
    expect(maxStars()).toBe(ZONES.length * 5);
    const p = new Progression();
    clearAll(p);
    awardProtocolRun(p, prun({ partial: false, avalancheFirstTry: true }));
    expect(protocolStars(p)).toBe(2);
    expect(totalStars(p)).toBe(0);
  });

  it('each goal is judged on its own measurement, and only on a clear', () => {
    const p = new Progression();
    expect(metIds(evaluateProtocolRun(p, prun()))).toEqual([]);
    expect(metIds(evaluateProtocolRun(p, prun({ partial: false })))).toEqual(['clean']);
    const wd = new Array(PROTOCOL_WAVES).fill(NaN);
    wd[PROTOCOL_STAR_HP_WAVE - 1] = PROTOCOL_STAR_HP - 1;
    expect(metIds(evaluateProtocolRun(p, prun({ waveDamage: wd })))).toEqual(['hp']);
    wd[PROTOCOL_STAR_HP_WAVE - 1] = PROTOCOL_STAR_HP;
    expect(metIds(evaluateProtocolRun(p, prun({ waveDamage: wd })))).toEqual([]);
    // the wave not played whole this run (NaN) never counts
    expect(metIds(evaluateProtocolRun(p, prun({ waveDamage: new Array(PROTOCOL_WAVES).fill(NaN) })))).toEqual([]);
    expect(metIds(evaluateProtocolRun(p, prun({ echoSweep: PROTOCOL_STAR_SWEEP_S })))).toEqual(['sweep']);
    expect(metIds(evaluateProtocolRun(p, prun({ echoSweep: PROTOCOL_STAR_SWEEP_S + 0.1 })))).toEqual([]);
    expect(metIds(evaluateProtocolRun(p, prun({ chairmanTime: PROTOCOL_STAR_CHAIRMAN_S - 1 })))).toEqual(['chairman']);
    expect(metIds(evaluateProtocolRun(p, prun({ avalancheFirstTry: true })))).toEqual(['avalanche']);
    // a loss earns nothing
    expect(metIds(evaluateProtocolRun(p, prun({ won: false, partial: false, avalancheFirstTry: true })))).toEqual([]);
  });

  it('the finale star stays ??? until the first clear (no spoiler on the zone card / a lost run)', () => {
    const ava = PROTOCOL_CHALLENGES.find((c) => c.id === 'avalanche')!;
    expect(ava.secret).toBe(true);
    const hidden = protocolChallengeText(ava, false);
    expect(`${hidden.name} ${hidden.goal} ${hidden.tip}`).not.toMatch(/AVALANCHE|WHITEOUT|snowball/i);
    expect(protocolChallengeText(ava, true).goal).toBe(ava.goal);
    for (const c of PROTOCOL_CHALLENGES.filter((d) => !d.secret)) expect(protocolChallengeText(c, false).goal).toBe(c.goal);
  });

  it('banks new stars once and pays PROTOCOL_STAR_REWARD each', () => {
    const p = new Progression();
    p.data.coins = 0;
    const rep = awardProtocolRun(p, prun({ partial: false, chairmanTime: 10 }));
    expect(rep.newStars).toBe(2);
    expect(p.coins).toBe(2 * PROTOCOL_STAR_REWARD);
    const again = awardProtocolRun(p, prun({ partial: false, chairmanTime: 10 }));
    expect(again.newStars).toBe(0);
    expect(again.stars).toBe(2);
    expect(p.coins).toBe(2 * PROTOCOL_STAR_REWARD);
    expect(new Progression().data.protocol?.stars).toEqual(['clean', 'chairman']);
  });

  describe('tracker (events from a real run)', () => {
    function rig() {
      vi.useFakeTimers();
      const p = new Progression();
      clearAll(p);
      const ctx = {
        events: new EventBus(), progression: p, zone: { ...PROTOCOL_ZONE, id: PROTOCOL_ID }, ui: { toast: vi.fn() }, time: 0,
      } as unknown as GameContext & { time: number };
      new ChallengeTracker(ctx);
      return { ctx, p, ev: ctx.events };
    }
    const boss = (type: string, echo = false) => ({ id: 1, type, isBoss: true, echo }) as unknown as EnemyHandle;
    const wave = (ev: EventBus, round: number) => ev.emit('roundStarted', { round, total: PROTOCOL_WAVES, boss: true });

    it('measures every star over a whole run: wave damage, the wave 6 sweep, THE CHAIRMAN, the first AVALANCHE', () => {
      const { ctx, ev, p } = rig();
      for (let w = 1; w <= PROTOCOL_WAVES; w++) {
        wave(ev, w);
        ev.emit('plowDamaged', { amount: w === PROTOCOL_STAR_HP_WAVE ? 20 : 120, blocked: 0 });
        if (w === PROTOCOL_STAR_HP_WAVE) ev.emit('plowDamaged', { amount: 25, blocked: 0 });
        if (w === 6) {
          ctx.time = 100;
          ev.emit('bossSpawned', { enemy: boss('omega'), name: 'Ω', title: '' });
          ctx.time = 106;
          for (let k = 0; k < waveBossCount(6).echoes; k++) ev.emit('bossSpawned', { enemy: boss('frostbyte', true), name: 'x', title: '' });
          ctx.time = 130;
          for (let k = 0; k < waveBossCount(6).echoes; k++) ev.emit('bossDefeated', { enemy: boss('frostbyte', true), name: 'x' });
        }
        if (w === 7) {
          ctx.time = 200;
          ev.emit('bossSpawned', { enemy: boss('chairman'), name: 'THE CHAIRMAN', title: '' });
          ctx.time = 200 + CHAIRMAN_LAND_DELAY + 80;
          ev.emit('bossDefeated', { enemy: boss('chairman'), name: 'THE CHAIRMAN' });
          ev.emit('avalancheHit', { fullSize: true, attempt: 1 });
          ev.emit('avalancheHit', { fullSize: false, attempt: 2 });
        }
      }
      // Game records the clear in the save before it emits runFinished.
      recordProtocolClear(p, 900, 0);
      ev.emit('runFinished', runFin());
      const rep = lastProtocolReport()!;
      expect(rep.results.filter((r) => r.met).map((r) => r.def.id).sort()).toEqual(['avalanche', 'chairman', 'clean', 'hp', 'sweep']);
      expect(protocolStars(p)).toBe(5);
      // the campaign judge saw nothing to judge (no arena index)
      expect(lastChallengeReport()).toBeNull();
    });

    it('a resume from a checkpoint starts a fresh measurement; a slow sweep / Chairman and a missed first AVALANCHE fail', () => {
      const { ctx, ev } = rig();
      wave(ev, 1);
      wave(ev, 2);
      ev.emit('plowDamaged', { amount: 5, blocked: 0 });
      // quit; RESUME at wave 4 (no runFinished for the abandoned run)
      wave(ev, PROTOCOL_STAR_HP_WAVE);
      ev.emit('plowDamaged', { amount: PROTOCOL_STAR_HP + 5, blocked: 0 });
      wave(ev, 5);
      wave(ev, 6);
      ctx.time = 10;
      ev.emit('bossSpawned', { enemy: boss('frostbyte', true), name: 'x', title: '' });
      ctx.time = 50;
      for (let k = 0; k < waveBossCount(6).echoes; k++) ev.emit('bossDefeated', { enemy: boss('frostbyte', true), name: 'x' });
      wave(ev, 7);
      ctx.time = 100;
      ev.emit('bossSpawned', { enemy: boss('chairman'), name: 'THE CHAIRMAN', title: '' });
      ctx.time = 100 + CHAIRMAN_LAND_DELAY + PROTOCOL_STAR_CHAIRMAN_S + 1;
      ev.emit('bossDefeated', { enemy: boss('chairman'), name: 'THE CHAIRMAN' });
      ev.emit('avalancheHit', { fullSize: false, attempt: 1 });
      ev.emit('avalancheHit', { fullSize: true, attempt: 2 });
      ev.emit('runFinished', runFin({ partial: true }));
      expect(lastProtocolReport()!.results.filter((r) => r.met)).toEqual([]);
    });

    it('a dev start past wave 1 (records nothing) banks no stars and pays nothing, though it shows what it met', () => {
      const { ctx, ev, p } = rig();
      const coins = p.coins;
      wave(ev, 6);
      ctx.time = 10;
      for (let k = 0; k < waveBossCount(6).echoes; k++) ev.emit('bossSpawned', { enemy: boss('frostbyte', true), name: 'x', title: '' });
      for (let k = 0; k < waveBossCount(6).echoes; k++) ev.emit('bossDefeated', { enemy: boss('frostbyte', true), name: 'x' });
      wave(ev, 7);
      ctx.time = 20;
      ev.emit('bossSpawned', { enemy: boss('chairman'), name: 'THE CHAIRMAN', title: '' });
      ctx.time = 40;
      ev.emit('bossDefeated', { enemy: boss('chairman'), name: 'THE CHAIRMAN' });
      // no recordProtocolClear: Game's dev start records nothing
      ev.emit('runFinished', runFin({ partial: true }));
      const rep = lastProtocolReport()!;
      expect(rep.results.filter((r) => r.met).map((r) => r.def.id).sort()).toEqual(['chairman', 'sweep']);
      expect(rep.newStars).toBe(0);
      expect(rep.bonus).toBe(0);
      expect(protocolStars(p)).toBe(0);
      expect(p.coins).toBe(coins);
    });

    it('the finale may set runFinished.avalancheFirstTry directly; campaign runs are not judged here', () => {
      const { ev, ctx, p } = rig();
      wave(ev, 1);
      recordProtocolClear(p, 900, 1);
      ev.emit('runFinished', runFin({ partial: true, avalancheFirstTry: true }));
      expect(lastProtocolReport()!.results.find((r) => r.def.id === 'avalanche')!.met).toBe(true);
      (ctx as { zone: unknown }).zone = { ...ZONES[0] };
      ev.emit('roundStarted', { round: 1, total: 4, boss: false });
      ev.emit('runFinished', runFin({ protocol: undefined, zoneIndex: 0, won: false }));
      expect(lastProtocolReport()).toBeNull();
      expect(lastChallengeReport()?.zoneIndex).toBe(0);
    });
  });
});

describe('PROTOCOL C story', () => {
  it('chapter, true epilogue and THE CHAIRMAN unlock in order (no spoilers before the clear)', () => {
    const p = new Progression();
    expect(protocolStory(p)).toEqual({ chapter: 'hidden', epilogue: false, chairman: 'hidden' });
    clearAll(p, ZONES.length - 1);
    expect(protocolStory(p)).toEqual({ chapter: 'hidden', epilogue: false, chairman: 'hidden' });
    clearAll(p);
    expect(protocolStory(p)).toEqual({ chapter: 'open', epilogue: false, chairman: 'locked' });
    recordProtocolClear(p, 500, 1);
    expect(protocolStory(p)).toEqual({ chapter: 'done', epilogue: true, chairman: 'revealed' });
  });

  it('the text: the Hard epilogue points at PROTOCOL C; the chapter, true epilogue and THE CHAIRMAN are written', () => {
    expect(HARD_EPILOGUE).toMatch(/PROTOCOL C/);
    expect(HARD_EPILOGUE.trim().endsWith('"PROTOCOL C: IN PROGRESS."')).toBe(true);
    expect(PROTOCOL_C_CHAPTER.intro.length).toBeGreaterThan(200);
    expect(PROTOCOL_C_CHAPTER.outro).toMatch(/AVALANCHE/);
    for (const want of [/plow/i, /probation/i, /forever/i, /booth/i, /Snowdome/, /jingle/i, /FROSTBYTE/]) expect(TRUE_EPILOGUE).toMatch(want);
    expect(BOSS_LORE.chairman?.bio).toMatch(/DONALD/);
    expect(BOSS_LORE.chairman?.fate).toMatch(/booth/);
    // THE CHAIRMAN has no campaign arena: he is not in the campaign boss order
    expect(BOSS_ORDER.some((b) => b.type === 'chairman')).toBe(false);
  });
});

describe('save validation (PROTOCOL C stars)', () => {
  it('keeps unique, well-formed ids; old records keep their shape', () => {
    expect(sanitizeProtocol({ cleared: true, stars: ['clean', 'clean', 7, 'BAD ID', 'x'.repeat(40), 'hp'] })!.stars).toEqual(['clean', 'hp']);
    expect(sanitizeProtocol({ cleared: true, stars: Array.from({ length: 30 }, (_, i) => `s${i}`) })!.stars).toHaveLength(10);
    expect(sanitizeProtocol({ cleared: true })).not.toHaveProperty('stars');
    expect(sanitizeProtocol({ cleared: true, stars: 'clean' })).not.toHaveProperty('stars');
  });

  it('stars survive a reload and an export / import; junk is dropped on load; unknown ids never count', () => {
    const p = new Progression();
    p.data.protocol = { ...protocolSave(p), stars: ['clean', 'sweep'] };
    p.save();
    const q = new Progression();
    expect(protocolStars(q)).toBe(2);
    const code = q.exportSave();
    const r = new Progression();
    expect(r.importSave(code).ok).toBe(true);
    expect(r.data.protocol?.stars).toEqual(['clean', 'sweep']);
    const raw = JSON.parse(store.get(SAVE_KEY)!);
    raw.protocol.stars = ['clean', { evil: 1 }, 'retired_star'];
    store.set(SAVE_KEY, JSON.stringify(raw));
    const s = new Progression();
    expect(s.data.protocol?.stars).toEqual(['clean', 'retired_star']);
    expect(protocolStars(s)).toBe(1);
  });
});

describe('pinstripe paint', () => {
  it('thin lines at an even spacing in body space', () => {
    expect(pinstripeDistance(0)).toBeCloseTo(0);
    expect(pinstripeDistance(PINSTRIPE_SPACING * 3)).toBeCloseTo(0);
    expect(pinstripeDistance(PINSTRIPE_SPACING * 0.5)).toBeCloseTo(PINSTRIPE_SPACING * 0.5);
    expect(pinstripeDistance(-PINSTRIPE_SPACING * 2.25)).toBeCloseTo(PINSTRIPE_SPACING * 0.25);
    // a line covers only a few percent of the panel: it reads as pinstripes, not stripes
    expect((2 * PINSTRIPE_HALF_W) / PINSTRIPE_SPACING).toBeLessThan(0.15);
  });

  it('side panels repeat nose to tail (vertical lines); roofs and ends repeat across the plow', () => {
    expect(pinstripeAxis(1, 0.1, 0.2)).toBe(2);
    expect(pinstripeAxis(-0.9, 0.3, 0)).toBe(2);
    expect(pinstripeAxis(0.1, 1, 0.1)).toBe(0);
    expect(pinstripeAxis(0, 0.2, -1)).toBe(0);
  });
});

describe('Whiteout / Avalanche FX', () => {
  it('pure shapes: the swirl widens, the eye blinks open and shut, the ball swells then implodes', () => {
    const o = { s: 0, u: 0, r: 0 };
    expect(spiralOffset(0, 0, o).r).toBeLessThan(spiralOffset(0.8, 0, { s: 0, u: 0, r: 0 }).r);
    expect(eyeOpen(0.1)).toBe(0);
    expect(eyeOpen(0.5)).toBe(1);
    expect(eyeOpen(0.99)).toBe(0);
    const small = avalancheRadius(0.1, 0, 10);
    const big = avalancheRadius(AVA_GATHER - 0.01, 10, 10);
    expect(big).toBeGreaterThan(small * 2.5);
    expect(avalancheRadius(AVA_GATHER - 0.01, 2, 10)).toBeLessThan(big);
    expect(avalancheRadius(AVA_GATHER + AVA_IMPLODE * 0.95, 10, 10)).toBeLessThan(big * 0.1);
    expect(avalancheRadius(AVA_GATHER + AVA_IMPLODE, 10, 10)).toBe(0);
  });

  it('pooled: capped sprites, the trail eye appears now and then, the avalanche gathers its scrap and ends in a flash', () => {
    const fx = { ring: vi.fn(), powder: vi.fn() } as never;
    const f = new FrostFx(fx, null, vi.fn());
    for (let i = 0; i < 4000; i++) {
      f.trail(Math.sin(i * 0.01) * 10, 1, i * 0.05, 0.2, 0.3, 0.4, i % 7 === 0);
      if (i % 30 === 0) f.update(1 / 30);
    }
    expect(f.stats.sprites).toBeLessThanOrEqual(MAX_FROST);
    f.clear();
    expect(f.stats.sprites).toBe(0);
    for (let i = 0; i < MAX_BALLS + 2; i++) f.avalanche(new THREE.Vector3(i * 4, 0, 0), 0, 1);
    expect(f.stats.balls).toBe(MAX_BALLS);
    const before = f.stats.sprites;
    for (let t = 0; t < AVA_GATHER + AVA_IMPLODE + 0.1; t += 1 / 60) f.update(1 / 60);
    expect(f.stats.balls).toBe(0);
    expect(before).toBeGreaterThan(0);
    expect((fx as { ring: ReturnType<typeof vi.fn> }).ring).toHaveBeenCalled();
    for (let t = 0; t < EYE_LIFE + 1; t += 1 / 30) f.update(1 / 30);
    expect(f.stats.sprites).toBe(0);
  });

  it('LOW quality halves the particles', () => {
    const count = () => {
      const f = new FrostFx(null);
      for (let i = 0; i < 90; i++) f.trail(0, 1, i * 0.1, 0, 0, 0, false);
      return f.stats.sprites;
    };
    const q = settings.quality;
    try {
      settings.quality = 'high';
      const hi = count();
      settings.quality = 'low';
      const lo = count();
      expect(lo).toBeLessThan(hi * 0.65);
      expect(lo).toBeGreaterThan(hi * 0.35);
    } finally {
      settings.quality = q;
    }
  });

  it('the Avalanche kill effect rolls away from the player (and falls back to bursts on stub FX)', () => {
    const avalanche = vi.fn();
    const burst = vi.fn();
    const ctx = { fx: { frost: { avalanche }, burst }, plow: { position: new THREE.Vector3(0, 0, 0) }, audio: { play: vi.fn() } } as unknown as GameContext;
    const kill = COSMETIC_BY_ID.get('kill_avalanche')!;
    if (kill.slot !== 'kill') throw new Error('kill');
    emitKillFx(ctx, kill, new THREE.Vector3(3, 0, 4));
    expect(avalanche).toHaveBeenCalledTimes(1);
    const [, dx, dz] = avalanche.mock.calls[0];
    expect(dx).toBeCloseTo(3);
    expect(dz).toBeCloseTo(4);
    const stub = { fx: { burst }, plow: null, audio: { play: vi.fn() } } as unknown as GameContext;
    emitKillFx(stub, kill, new THREE.Vector3());
    expect(burst).toHaveBeenCalled();
  });
});
