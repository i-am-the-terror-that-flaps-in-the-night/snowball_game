import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { GameContext } from '../src/core/types';
import { ENEMY_GATES, PLOW_SPAWN } from '../src/core/types';
import { Progression, sanitizeProtocol } from '../src/core/Progression';
import { ZONES } from '../src/config/zones';
import { HARD } from '../src/config/challenges';
import {
  ECHO_HP, HEADLINE_CD, HEADLINE_HARD, HEADLINE_HP, MAX_ACTIVE, PROTOCOL_CLEAR_REWARD, PROTOCOL_FINALE, PROTOCOL_INDEX, PROTOCOL_WAVES, PROTOCOL_ZONE, homeZone,
  protocolRounds, protocolWaveZone, protocolZone, waveBossCount,
} from '../src/config/protocol';
import {
  formatRunTime, protocolRecordsRun, protocolReward, protocolSave, protocolTeased, protocolUnlocked, recordProtocolClear, recordProtocolWave, restoreCheckpoint,
  saveCheckpoint, takeCheckpoint,
} from '../src/meta/protocol';
import { maxStars } from '../src/meta/challenges';
import { BROKEN_RAMPS, DECK_IDS, FEATURES, PROTOCOL_NAV, RING_R, WAVE_FEATURES, deckWave, protocolTerrain } from '../src/world/protocol/layout';
import { NavGraph } from '../src/world/omega/nav';
import { EventBus, type GameEvents } from '../src/core/events';
import { LIFE, life, lifeBoss } from '../src/config/achievements';
import { Achievements, recordRunLifetime } from '../src/meta/achievements';
import { LOOT_RULES } from '../src/config/loot';
import { Terrain } from '../src/world/Terrain';
import { BOSS_BAR_MAX, bossBarLayout } from '../src/ui/hudParts';
import type { Bot } from '../src/entities/enemies/Bot';

/* PROTOCOL C, build stage 1 (docs/modes.md "Protocol C"): unlock, wave composition, the restructuring floor, the
 * checkpoint, echo bosses (HP, move gating, pairing, the leash), the boss bar stack and save validation. */

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
afterEach(() => vi.unstubAllGlobals());

function clearAll(p: Progression, hard: number): void {
  ZONES.forEach((z, i) => {
    p.data.zones[z.id] = { cleared: true, bestRound: z.rounds.length };
    if (i < hard) (p.data.hardCleared ??= {})[z.id] = true;
  });
  p.data.unlockedZones = ZONES.length;
}

describe('unlock', () => {
  it('teases after the normal Omega clear, opens only once every arena is cleared on normal AND Hard', () => {
    const p = new Progression();
    expect(protocolTeased(p)).toBe(false);
    expect(protocolUnlocked(p)).toBe(false);
    clearAll(p, 0);
    expect(protocolTeased(p)).toBe(true);
    expect(protocolUnlocked(p)).toBe(false);
    clearAll(p, ZONES.length - 1);
    expect(protocolUnlocked(p)).toBe(false);
    clearAll(p, ZONES.length);
    expect(protocolUnlocked(p)).toBe(true);
    // a Hard clear without the normal clear does not count
    p.data.zones[ZONES[2].id] = { cleared: false, bestRound: 1 };
    expect(protocolUnlocked(p)).toBe(false);
  });

  it('is not a campaign arena: ZONES, the star total and the arena unlock prefix are untouched', () => {
    expect(ZONES).toHaveLength(6);
    expect(ZONES.some((z) => z.id === PROTOCOL_ZONE.id)).toBe(false);
    expect(maxStars()).toBe(30);
    expect(PROTOCOL_INDEX).toBe(ZONES.length);
    const p = new Progression();
    clearAll(p, ZONES.length);
    recordProtocolClear(p, 300, 0);
    expect(p.data.unlockedZones).toBe(ZONES.length);
    expect(p.isZoneUnlocked(PROTOCOL_INDEX)).toBe(false);
  });
});

describe('wave composition', () => {
  const rounds = protocolRounds();
  const bossesOf = (w: number) => rounds[w - 1].groups.map((g) => `${g.echo ? 'E:' : 'H:'}${g.type}`);

  it('seven boss rounds: wave n = campaign boss n upgraded, the earlier ones as echoes', () => {
    expect(rounds).toHaveLength(PROTOCOL_WAVES);
    for (const r of rounds) expect(r.boss).toBe(true);
    expect(bossesOf(1)).toEqual(['H:frostbyte']);
    expect(bossesOf(2)).toEqual(['H:bulldoza', 'E:frostbyte']);
    expect(bossesOf(3)).toEqual(['H:grinder', 'E:frostbyte', 'E:bulldoza']);
    expect(bossesOf(4)).toEqual(['H:slush', 'H:sleet', 'E:frostbyte', 'E:bulldoza', 'E:grinder']);
    expect(bossesOf(5)).toEqual(['H:donald', 'E:frostbyte', 'E:bulldoza', 'E:grinder', 'E:slush', 'E:sleet']);
    expect(bossesOf(6)).toEqual(['H:omega', 'E:frostbyte', 'E:bulldoza', 'E:grinder', 'E:slush', 'E:sleet', 'E:donald']);
    // wave 7: THE CHAIRMAN (stage 3) + every headline as an echo
    expect(bossesOf(7)).toEqual(['H:chairman', 'E:frostbyte', 'E:bulldoza', 'E:grinder', 'E:slush', 'E:sleet', 'E:donald', 'E:omega']);
    expect(waveBossCount(7)).toEqual({ total: 8, echoes: 7 });
    expect(waveBossCount(1)).toEqual({ total: 1, echoes: 0 });
  });

  it('net boss HP: headline = home x max(HEADLINE_HP, Hard x HEADLINE_HARD), echo = home x ECHO_HP (x the pilot-power scale)', () => {
    const z = protocolZone({ hp: 1.5, dmg: 1.2 });
    expect(z.enemyHpMult).toBeCloseTo(HARD.hpMult * 1.5);
    expect(z.enemyDmgMult).toBeCloseTo(HARD.dmgMult * 1.2);
    for (const r of rounds) {
      for (const g of r.groups) {
        if (g.type === 'chairman') continue; // no home arena (tests/chairman.test.ts)
        const home = homeZone(g.type)!.enemyHpMult;
        const net = PROTOCOL_ZONE.enemyHpMult * g.hpMult!;
        expect(net).toBeCloseTo(home * (g.echo ? ECHO_HP : Math.max(HEADLINE_HP, HARD.hpMult * HEADLINE_HARD)));
        // a headline is at least its Hard-campaign self (+15%) and at least x1.6 its home HP
        if (!g.echo) expect(net).toBeGreaterThanOrEqual(Math.max(home * HARD.hpMult * HEADLINE_HARD, home * HEADLINE_HP) - 1e-9);
        expect(g.headline).toBe(!g.echo);
      }
    }
  });

  it('echoes walk in one after another (twins as a pair), never all at once', () => {
    for (const r of rounds) {
      const echoes = r.groups.filter((g) => g.echo);
      const head = r.groups.filter((g) => !g.echo);
      for (const e of echoes) for (const h of head) expect(e.delay).toBeGreaterThan(h.delay + 3);
      const ds = [...new Set(echoes.map((g) => g.delay))].sort((a, b) => a - b);
      for (let i = 1; i < ds.length; i++) expect(ds[i] - ds[i - 1]).toBeGreaterThanOrEqual(0.6);
      // only a twin pair arrives within a second of each other
      for (let i = 0; i < echoes.length; i++) {
        for (let j = i + 1; j < echoes.length; j++) {
          if (Math.abs(echoes[i].delay - echoes[j].delay) < 1) expect([echoes[i].type, echoes[j].type].sort()).toEqual(['sleet', 'slush']);
        }
      }
    }
    // wave 7: two groups, well apart
    const d7 = rounds[6].groups.filter((g) => g.echo).map((g) => g.delay);
    expect(Math.max(...d7) - Math.min(...d7)).toBeGreaterThan(20);
  });

  it('each wave zone has its floor, stage and headline name; a first clear pays more than Omega', () => {
    expect(protocolWaveZone(PROTOCOL_ZONE, 1).bossName).toBe('FROSTBYTE');
    expect(protocolWaveZone(PROTOCOL_ZONE, 4).bossName).toBe('SLUSH & SLEET');
    expect(protocolWaveZone(PROTOCOL_ZONE, 4).stage).toBe(false);
    expect(protocolWaveZone(PROTOCOL_ZONE, 5).stage).toBe(true);
    expect(protocolWaveZone(PROTOCOL_ZONE, 4).split).toBe(true);
    expect(protocolWaveZone(PROTOCOL_ZONE, 3).split).toBe(false);
    expect(protocolWaveZone(PROTOCOL_ZONE, 99).terrain).toBe(protocolTerrain(7));
    expect(PROTOCOL_ZONE.maxActiveBosses).toBe(MAX_ACTIVE);
    expect(PROTOCOL_CLEAR_REWARD).toBeGreaterThan(ZONES[5].clearReward * HARD.firstClearMult);
  });
});

describe('restructuring floor', () => {
  const flatAndClear = (t: Terrain, x: number, z: number, r: number) => {
    for (let a = 0; a < 16; a++) {
      for (const f of [0, 0.5, 1]) {
        const px = x + Math.sin((a / 16) * Math.PI * 2) * r * f;
        const pz = z + Math.cos((a / 16) * Math.PI * 2) * r * f;
        if (Math.abs(t.ground(px, pz)) > 0.05 || t.materialAt(px, pz) === 'lava') return false;
        if (t.decks.some((d) => t.inDeck(d, px, pz, 0))) return false;
      }
    }
    return true;
  };
  const lavaShare = (t: Terrain) => {
    let n = 0;
    let hit = 0;
    for (let x = -29.75; x < 30; x += 0.5) {
      for (let z = -29.75; z < 30; z += 0.5) {
        n++;
        if (t.materialAt(x, z) === 'lava') hit++;
      }
    }
    return hit / n;
  };

  it('every wave: spawn and gate lanes clear, lava < 15%, the rally spot never lava, decks clear of lava', () => {
    for (let w = 1; w <= PROTOCOL_WAVES; w++) {
      const t = new Terrain(protocolTerrain(w));
      expect(flatAndClear(t, PLOW_SPAWN.x, PLOW_SPAWN.z, 3), `wave ${w} spawn`).toBe(true);
      for (const g of ENEMY_GATES) {
        const fx = Math.sin(g.heading);
        const fz = Math.cos(g.heading);
        // the first 8 m in from the wall (gates sit 4 m outside it)
        for (let d = 4; d <= 12; d += 2) expect(flatAndClear(t, g.x + fx * d, g.z + fz * d, 2.5), `wave ${w} gate lane ${g.x},${g.z} at ${d}`).toBe(true);
      }
      expect(lavaShare(t)).toBeLessThan(0.15);
      expect(t.materialAt(0, -21)).not.toBe('lava');
      for (const d of t.decks) {
        for (const p of t.patches.filter((q) => q.material === 'lava')) {
          const near = Math.hypot(p.x - d.x, p.z - d.z) - p.r - Math.hypot(d.hw, d.hd);
          expect(near, `wave ${w} deck ${d.id}`).toBeGreaterThan(0.5);
        }
      }
    }
  });

  it('the launch ramps have a lava-free run-up and landing, and wave 7 has every feature', () => {
    const t = new Terrain(protocolTerrain(7));
    for (const r of BROKEN_RAMPS) {
      for (let z = r.z - 4; z <= r.z + 14; z += 1) {
        for (const dx of [-2, 0, 2]) expect(t.materialAt(r.x + dx, z), `ramp lane ${r.x + dx},${z}`).not.toBe('lava');
      }
    }
    expect(WAVE_FEATURES[6]).toEqual(expect.arrayContaining(Object.keys(FEATURES)));
    expect(protocolTerrain(1).decks).toHaveLength(0);
    expect(protocolTerrain(6).decks!.length).toBeGreaterThan(0);
    expect(t.materialAt(Math.sin(1) * RING_R, Math.cos(1) * RING_R)).toBe('lava');
    // ice under the rink every wave
    for (let w = 1; w <= PROTOCOL_WAVES; w++) expect(new Terrain(protocolTerrain(w)).materialAt(0, -2)).toBe('ice');
  });
});

describe('checkpoint', () => {
  it('snapshots a run at a wave start and restores it (HP fraction, tallies, run clock, +1 use)', () => {
    const ck = takeCheckpoint({ wave: 4, hp: 60, maxHp: 150, time: 500, start: 120, kills: 9, coins: 840, uses: 1 });
    expect(ck).toEqual({ wave: 4, hpFrac: 0.4, elapsed: 380, kills: 9, coins: 840, uses: 1 });
    const r = restoreCheckpoint(ck, 200, 1000);
    expect(r).toEqual({ wave: 4, hp: 80, kills: 9, coins: 840, start: 620, uses: 2 });
    // never restores a dead plow
    expect(takeCheckpoint({ wave: 2, hp: 0, maxHp: 100, time: 1, start: 0, kills: 0, coins: 0, uses: 0 }).hpFrac).toBeGreaterThan(0);
  });

  it('is saved, survives a reload and an export / import, and a clear drops it', () => {
    const p = new Progression();
    clearAll(p, ZONES.length);
    saveCheckpoint(p, takeCheckpoint({ wave: 5, hp: 70, maxHp: 100, time: 300, start: 0, kills: 4, coins: 100, uses: 0 }));
    recordProtocolWave(p, 5);
    const q = new Progression();
    expect(protocolSave(q).checkpoint).toEqual({ wave: 5, hpFrac: 0.7, elapsed: 300, kills: 4, coins: 100, uses: 0 });
    expect(protocolSave(q).bestWave).toBe(5);
    const r = new Progression();
    r.resetSave();
    expect(r.importSave(p.exportSave())).toEqual({ ok: true });
    expect(protocolSave(r).checkpoint?.wave).toBe(5);
    const rec = recordProtocolClear(r, 412.34, 1);
    expect(rec).toMatchObject({ firstClear: true, reward: PROTOCOL_CLEAR_REWARD, newBest: true, bestTime: 412.3 });
    expect(rec.granted.length).toBe(3);
    expect(protocolSave(r).checkpoint).toBeNull();
    expect(protocolSave(r).cleanClear).toBe(false);
    expect(protocolReward(r)).toBeLessThan(PROTOCOL_CLEAR_REWARD);
    const again = recordProtocolClear(r, 500, 0);
    expect(again.firstClear).toBe(false);
    expect(again.newBest).toBe(false);
    expect(protocolSave(r).bestTime).toBe(412.3);
    expect(protocolSave(r).cleanClear).toBe(true);
    expect(formatRunTime(412.3)).toBe('6:52.3');
    expect(formatRunTime(0)).toBe('—');
  });
});

describe('save validation', () => {
  it('sanitizeProtocol keeps well-formed fields and drops junk', () => {
    expect(sanitizeProtocol(undefined)).toBeUndefined();
    expect(sanitizeProtocol([1, 2])).toBeUndefined();
    expect(sanitizeProtocol({ cleared: 'yes', clears: -4, bestTime: NaN, bestWave: 99, cleanClear: 1, checkpoint: 'x' })).toEqual({
      cleared: false, clears: 0, bestTime: 0, bestWave: PROTOCOL_FINALE, cleanClear: false, checkpoint: null,
    });
    // a checkpoint without a usable wave / HP is dropped; numbers are clamped
    expect(sanitizeProtocol({ checkpoint: { wave: 0, hpFrac: 0.5 } })!.checkpoint).toBeNull();
    expect(sanitizeProtocol({ checkpoint: { wave: 3, hpFrac: 0 } })!.checkpoint).toBeNull();
    expect(sanitizeProtocol({ checkpoint: { wave: 12.7, hpFrac: 4, elapsed: -3, kills: 2.5, coins: 'a', uses: 1 } })!.checkpoint).toEqual({
      wave: PROTOCOL_FINALE, hpFrac: 1, elapsed: 0, kills: 2, coins: 0, uses: 1,
    });
    expect(sanitizeProtocol({ cleared: true, clears: 3, bestTime: 301.5, bestWave: 7, cleanClear: true, checkpoint: null })).toEqual({
      cleared: true, clears: 3, bestTime: 301.5, bestWave: 7, cleanClear: true, checkpoint: null,
    });
  });

  it('a stored save with a broken protocol record loads sanitized', () => {
    const p = new Progression();
    p.data.protocol = { cleared: true, clears: 1, bestTime: 200, bestWave: 7, cleanClear: false, checkpoint: { wave: -1 } } as never;
    p.save();
    const raw = JSON.parse(store.get(SAVE_KEY)!);
    raw.protocol.bestTime = 'fast';
    store.set(SAVE_KEY, JSON.stringify(raw));
    const q = new Progression();
    expect(q.data.protocol).toEqual({ cleared: true, clears: 1, bestTime: 0, bestWave: 7, cleanClear: false, checkpoint: null });
    // importing a code with an invalid record still works (the record is cleaned)
    const r = new Progression();
    expect(r.importSave(JSON.stringify({ ...raw, protocol: 'nope' })).ok).toBe(true);
    expect(r.data.protocol).toBeUndefined();
  });
});

describe('boss bar stack', () => {
  it('one big bar, an equal pair for the campaign twins, a compact stack with echoes or 3+', () => {
    expect(bossBarLayout(0)).toBe('solo');
    expect(bossBarLayout(1)).toBe('solo');
    expect(bossBarLayout(2)).toBe('twin');
    expect(bossBarLayout(2, 1)).toBe('many');
    expect(bossBarLayout(3)).toBe('many');
    expect(bossBarLayout(8, 7)).toBe('many');
    let most = 0;
    for (let w = 1; w <= PROTOCOL_WAVES; w++) most = Math.max(most, waveBossCount(w).total);
    expect(BOSS_BAR_MAX).toBeGreaterThanOrEqual(most);
  });
});

/* ------------------------------------------------------------------ echoes on a real EnemyManager */

const noop: unknown = new Proxy(() => noop, { get: () => noop, apply: () => noop });
beforeAll(() => {
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) });
});
afterAll(() => vi.unstubAllGlobals());

async function arena(maxActiveBosses?: number) {
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) });
  const { EnemyManager } = await import('../src/entities/Enemies');
  const phases: string[] = [];
  const spawns: string[] = [];
  const handlers = new Map<string, ((p: unknown) => void)[]>();
  const plow = {
    position: new THREE.Vector3(0, 0, 0), radius: 1.6, heldBallRadius: 0, dead: false, heading: 0, speed: 0, dashing: false, whirling: false, deck: -1,
    stealSnow: () => 0, tow: () => {}, push: () => {},
  };
  const events = {
    emit: (name: string, p: { enemy: Bot; label?: string }) => {
      if (name === 'bossPhase') phases.push(`${p.enemy.type}:${p.label}`);
      for (const f of handlers.get(name) ?? []) f(p);
    },
    on: (name: string, f: (p: unknown) => void) => {
      handlers.set(name, [...(handlers.get(name) ?? []), f]);
      return () => {};
    },
  };
  const ctx = {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), fx: noop, audio: noop, impact: noop,
    events, plow, stats: { plowKind: 'classic' },
    combat: { hitPlow: (dmg: number) => dmg, playerRam: () => {} },
    zone: { enemyHpMult: 1, coinMult: 1, enemyDmgMult: 1, theme: 'protocol', maxActiveBosses },
    terrain: new Terrain(),
    pickups: { spawnCoins: () => {} },
  };
  const mgr = new EnemyManager(ctx as unknown as GameContext);
  (ctx as unknown as { enemies: unknown }).enemies = mgr;
  const origSpawn = mgr.spawn.bind(mgr);
  mgr.spawn = ((t: string, x: number, z: number, o?: object) => {
    spawns.push(t);
    return origSpawn(t as never, x, z, o);
  }) as typeof mgr.spawn;
  const run = (sec: number, each?: () => void) => {
    for (let t = 0; t < sec; t += 1 / 60) {
      mgr.update(1 / 60);
      each?.();
    }
  };
  const boss = (t: string, x: number, z: number, opts: { echo?: boolean; headline?: boolean; hpMult?: number } = {}) => {
    const b = mgr.spawn(t as never, x, z, { noGate: true, hpMult: opts.hpMult ?? 1, echo: opts.echo, headline: opts.headline } as never) as Bot;
    b.entering = false;
    return b;
  };
  return { mgr, ctx, plow, phases, spawns, run, boss };
}

describe('echo bosses', () => {
  it('carry ECHO HP and names, and the headline / echo damage multipliers', async () => {
    const { boss } = await arena();
    const e = boss('grinder', 0, 10, { echo: true, hpMult: ECHO_HP });
    const h = boss('grinder', 0, -10, { headline: true, hpMult: HEADLINE_HP });
    expect(e.holo).not.toBeNull();
    expect(h.holo).toBeNull();
    expect(e.maxHp).toBe(Math.round(1100 * ECHO_HP));
    expect(h.maxHp).toBe(Math.round(1100 * HEADLINE_HP));
    expect(e.displayName).toBe('ECHO THE GRINDER');
    expect(h.displayName).toBe('THE GRINDER');
    expect(e.dmgOutMult).toBeLessThan(1);
    expect(h.dmgOutMult).toBeGreaterThan(1);
  });

  it('never reach phase 2 or summon adds, whatever their HP', async () => {
    const { boss, run, phases, spawns } = await arena();
    const types = ['frostbyte', 'bulldoza', 'grinder', 'omega', 'donald'];
    const bots = types.map((t, i) => boss(t, -20 + i * 10, -12, { echo: true }));
    spawns.length = 0;
    for (const b of bots) b.hp = b.maxHp * 0.1;
    run(3);
    expect(phases).toEqual([]);
    expect(spawns).toEqual([]);
    for (const b of bots) expect(b.enraged).toBe(false);
    // a headline does
    const h = boss('grinder', 0, 15, { headline: true });
    h.hp = h.maxHp * 0.2;
    run(0.2);
    expect(phases.some((p) => p.startsWith('grinder:'))).toBe(true);
  });

  it('keep only their signature moves', async () => {
    const { boss, run, plow } = await arena();
    const seen = new Map<string, Set<string>>();
    const fb = boss('frostbyte', 0, 6, { echo: true });
    const gr = boss('grinder', 14, 0, { echo: true });
    const om = boss('omega', -14, 0, { echo: true });
    const sl = boss('sleet', 0, -5, { echo: true });
    const dn = boss('donald', 0, -22, { echo: true });
    plow.heldBallRadius = 1.2; // FROSTBYTE's ram bait
    const bots = [fb, gr, om, sl, dn];
    run(40, () => {
      for (const b of bots) {
        if (!seen.has(b.type)) seen.set(b.type, new Set());
        seen.get(b.type)!.add(b.state);
        b.hp = b.maxHp; // keep them alive
      }
    });
    expect(seen.get('frostbyte')!.has('ramWind')).toBe(false);
    expect(seen.get('grinder')!.has('dashWind')).toBe(false);
    expect(seen.get('grinder')!.has('spinWind')).toBe(true);
    for (const s of ['chargeWind', 'shoveWind', 'deckLeapWind']) expect(seen.get('omega')!.has(s)).toBe(false);
    expect(seen.get('omega')!.has('poundWind')).toBe(true);
    expect(seen.get('sleet')!.has('swipeWind')).toBe(false);
    for (const s of ['rallyGo', 'rally', 'beamWind']) expect(seen.get('donald')!.has(s)).toBe(false);
    expect(seen.get('donald')!.has('wallWind')).toBe(true);
  });

  it('twins pair with their own partner when two pairs share a fight', async () => {
    const { boss } = await arena();
    const s1 = boss('slush', -10, 0, { headline: true });
    const t1 = boss('sleet', -8, 0, { headline: true });
    const s2 = boss('slush', 10, 0, { echo: true });
    const t2 = boss('sleet', 8, 0, { echo: true });
    expect(s1.partner).toBe(t1);
    expect(t1.partner).toBe(s1);
    expect(s2.partner).toBe(t2);
    expect(t2.partner).toBe(s2);
  });

  it('the leash keeps at most maxActiveBosses fighting, headlines always, and rotates the echoes', async () => {
    const { boss, run } = await arena(4);
    const h = boss('omega', 0, -12, { headline: true });
    const echoes = ['frostbyte', 'bulldoza', 'grinder', 'slush', 'sleet', 'donald'].map((t, i) => boss(t, -20 + i * 8, 14, { echo: true }));
    const everActive = new Set<Bot>();
    run(60, () => {
      const active = [h, ...echoes].filter((b) => b.alive && !b.held);
      expect(active.length).toBeLessThanOrEqual(4 + 2); // a held-back echo may finish the move it was in
      expect(h.held).toBe(false);
      for (const b of active) everActive.add(b);
      for (const b of [h, ...echoes]) b.hp = b.maxHp;
    });
    // settled: exactly the cap
    expect([h, ...echoes].filter((b) => !b.held)).toHaveLength(4);
    // rotation gave every echo a turn
    for (const e of echoes) expect(everActive.has(e)).toBe(true);
  });
});

describe('review fixes', () => {
  it('destructible props never stand in or against the low decks (waves 6-7)', async () => {
    const { Props } = await import('../src/world/Props');
    for (const w of [6, 7]) {
      const t = new Terrain(protocolTerrain(w));
      expect(t.decks.length).toBeGreaterThan(0);
      for (let seed = 0; seed < 25; seed++) {
        const ctx = { scene: new THREE.Scene(), fx: noop, audio: noop, pickups: { spawnCoins: () => {} }, terrain: t } as unknown as GameContext;
        const obs: { x: number; z: number; r: number; breakable?: boolean }[] = [];
        new Props(ctx).reset(obs, true, 777 + PROTOCOL_INDEX * 131 + seed, false, true);
        const mine = obs.filter((o) => o.breakable);
        expect(mine.length).toBeGreaterThan(4);
        for (const o of mine) for (const d of t.decks) expect(t.inDeck(d, o.x, o.z, o.r)).toBe(false);
      }
    }
  });

  it("THE DONALD's props outlive a fallen owner while another Donald fights, and collapse with the last one", async () => {
    const { boss, run, mgr, ctx } = await arena();
    const { donaldProps } = await import('../src/entities/enemies/donaldProps');
    const h = boss('donald', -12, -14, { headline: true });
    const e = boss('donald', 12, -14, { echo: true });
    const calm = () => {
      for (const b of [h, e]) if (b.alive) b.cd = 99;
    };
    run(0.2, calm);
    donaldProps.claim(e);
    donaldProps.buildWalls(mgr, [{ x: -6, z: 12, dx: 1, dz: 0, len: 12 }], 0.1, 60);
    run(1, calm);
    const segs = (donaldProps as unknown as { segs: { die: number }[] }).segs;
    expect(segs.length).toBeGreaterThan(0);
    expect(segs.every((s) => s.die < 0)).toBe(true);
    mgr.damage(e, 1e9, {});
    run(0.5, calm);
    expect(e.alive).toBe(false);
    expect(segs.length).toBeGreaterThan(0);
    expect(segs.every((s) => s.die < 0)).toBe(true);
    mgr.damage(h, 1e9, {});
    run(0.2);
    expect(segs.length === 0 || segs.every((s) => s.die >= 0)).toBe(true);
    donaldProps.clear(ctx as unknown as GameContext);
  });
});

/* ------------------------------------------------------------------ build stage 2 */

describe('stage 2: echo holograms', () => {
  it('an echo is drawn with one hologram program (shared with the warm-up set); eyes / glow keep their materials', async () => {
    const { mgr, boss } = await arena();
    const warm = mgr.warmSet().filter((o) => ((o as THREE.Mesh).material as THREE.Material).name === 'hologram');
    expect(warm.length).toBe(2);
    expect(warm.some((o) => (o as THREE.InstancedMesh).isInstancedMesh)).toBe(true);
    const ref = (warm[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    for (const t of ['frostbyte', 'bulldoza', 'grinder', 'slush', 'donald', 'omega']) {
      const e = boss(t, 0, 0, { echo: true });
      const h = boss(t, 10, 0, { headline: true });
      let holo = 0;
      let kept = 0;
      e.rig.root.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (!(o as THREE.Mesh).isMesh || !m) return;
        if (m === e.holo) holo++;
        else if (['eye', 'glow', 'ball'].includes(m.userData?.inst as string)) kept++;
      });
      expect(holo, t).toBeGreaterThan(5);
      expect(e.holo!.vertexShader).toBe(ref.vertexShader);
      expect(e.holo!.fragmentShader).toBe(ref.fragmentShader);
      expect(e.rig.owned).toContain(e.holo);
      if (e.rig.eye) expect(kept, t).toBeGreaterThan(0);
      // the headline keeps its paint
      h.rig.root.traverse((o) => expect(((o as THREE.Mesh).material as THREE.Material | undefined)?.name).not.toBe('hologram'));
    }
  });

  it('LOW draws front faces only (one pass); the warm-up set always compiles both passes', async () => {
    const { settings } = await import('../src/core/settings');
    const { mgr, boss } = await arena();
    const q = settings.quality;
    try {
      settings.quality = 'high';
      expect(boss('grinder', 0, 0, { echo: true }).holo!.side).toBe(THREE.DoubleSide);
      settings.quality = 'low';
      expect(boss('grinder', 5, 0, { echo: true }).holo!.side).toBe(THREE.FrontSide);
      for (const o of mgr.warmSet()) {
        const m = (o as THREE.Mesh).material as THREE.Material;
        if (m.name === 'hologram') expect(m.side).toBe(THREE.DoubleSide);
      }
    } finally {
      settings.quality = q;
    }
  });

  it('an echo shatters into gold debris (no new shader program: the paint one)', async () => {
    const { debrisMaterials } = await import('../src/entities/enemies/models');
    const gold = debrisMaterials('frostbyte', true) as THREE.MeshStandardMaterial[];
    const paint = debrisMaterials('frostbyte') as THREE.MeshStandardMaterial[];
    expect(gold[0].color.getHex()).not.toBe(paint[0].color.getHex());
    expect(gold[0].type).toBe(paint[0].type);
    expect(gold[0].flatShading).toBe(paint[0].flatShading);
    expect(gold[0].map).toBeNull();
  });

  it('flashes on a hit and dims while held on the leash', async () => {
    const { mgr, boss, run } = await arena();
    const e = boss('bulldoza', 0, 10, { echo: true });
    e.stun = 10;
    run(0.1);
    const a0 = e.holo!.uniforms.uAlpha.value as number;
    mgr.damage(e, 1, {});
    run(1 / 60);
    expect(e.holo!.uniforms.uFlash.value).toBeGreaterThan(0.3);
    e.held = true;
    run(1 / 60);
    expect(e.holo!.uniforms.uAlpha.value).toBeLessThan(a0);
  });
});

describe('stage 2: headline tuning', () => {
  it("a headline's cooldowns between moves run HEADLINE_CD x as fast", async () => {
    const { boss, run } = await arena();
    const h = boss('bulldoza', -10, 0, { headline: true });
    const e = boss('bulldoza', 10, 0, { echo: true });
    for (const b of [h, e]) {
      b.stun = 10; // AI off: only the timers run
      b.cd = b.cd2 = 5;
    }
    run(1);
    expect(HEADLINE_CD).toBeGreaterThan(1);
    expect(h.cd).toBeCloseTo(5 - HEADLINE_CD, 1);
    expect(h.cd2).toBeCloseTo(5 - HEADLINE_CD, 1);
    expect(e.cd).toBeCloseTo(4, 1);
  });
});

describe('stage 2: deck routing', () => {
  it('a nav graph for the wave 6-7 decks: ramps are transit, a bot on the ground is sent to a ramp foot', () => {
    expect([1, 2, 3, 4, 5].map(deckWave)).toEqual([false, false, false, false, false]);
    expect(deckWave(6) && deckWave(7)).toBe(true);
    const nav = new NavGraph(PROTOCOL_NAV);
    const t = new Terrain(protocolTerrain(7));
    const ids = t.decks.map((d) => d.id).sort();
    expect(ids).toEqual(Object.values(DECK_IDS).flatMap((s) => [s.slab, s.rampN, s.rampS]).sort());
    expect(nav.regionOf(DECK_IDS.east.slab)).toBe(DECK_IDS.east.slab);
    expect(nav.regionOf(DECK_IDS.east.rampN)).toBeNaN();
    const out = { x: 0, z: 0 };
    expect(nav.next(0, 20, -1, 13, -2, DECK_IDS.east.slab, out)).toBe(true);
    expect(t.surfaceAt(out.x, out.z, 0).y).toBeLessThan(0.3); // a ramp foot on the ground
    expect(Math.abs(out.x - 13)).toBeLessThan(1);
    // same level: steer straight
    expect(nav.next(0, 20, -1, 5, 5, -1, out)).toBe(false);
    // every node stands where it says, and no ramp foot is near lava (big bosses steer round lava and would stall)
    for (const [k, n] of Object.entries(PROTOCOL_NAV.nodes)) {
      const s = t.surfaceAt(n.x, n.z, n.region < 0 ? 0 : 1.2);
      expect(s.deck, k).toBe(n.region < 0 ? -1 : n.region);
      const r = n.region < 0 ? 2.5 : 0;
      for (let a = 0; a < 16; a++) expect(t.materialAt(n.x + Math.cos(a) * r, n.z + Math.sin(a) * r), k).not.toBe('lava');
    }
  });

  it('bosses walk up a ramp to a plow parked on a deck (no deck camping)', async () => {
    const { mgr, ctx, plow, boss, run } = await arena();
    ctx.terrain = new Terrain(protocolTerrain(6));
    mgr.nav = new NavGraph(PROTOCOL_NAV);
    plow.position.set(13, 1.2, -2);
    plow.deck = DECK_IDS.east.slab;
    const bots = [boss('bulldoza', -24, 18, { echo: true }), boss('grinder', -20, -20, { echo: true }), boss('omega', 24, 20, { headline: true })];
    const reached = new Set<string>();
    run(45, () => {
      for (const b of bots) if (b.alive && b.deck === DECK_IDS.east.slab) reached.add(b.type);
      plow.position.set(13, 1.2, -2);
    });
    expect([...reached].sort()).toEqual(['bulldoza', 'grinder', 'omega']);
  });

  it('wave 7: a big boss in at a side gate gets round the near deck to the far one (the ring gap leaves room)', async () => {
    // (one at a time: the 5 m deck holds the plow and about one big boss)
    for (const [gx, px, slab] of [[-21, 13, DECK_IDS.east.slab], [21, -13, DECK_IDS.west.slab]] as const) {
      for (const type of ['omega', 'bulldoza']) {
        const { mgr, ctx, plow, boss, run } = await arena();
        ctx.terrain = new Terrain(protocolTerrain(7));
        mgr.nav = new NavGraph(PROTOCOL_NAV);
        plow.position.set(px, 1.2, -2);
        plow.deck = slab;
        const b = boss(type, gx, -8, { echo: true });
        let at = -1;
        let t = 0;
        run(25, () => {
          t += 1 / 60;
          // on the deck, or up its ramp and in reach of the plow (a big boss's centre can stay on the ramp's top end)
          const reach = Math.hypot(b.position.x - px, b.position.z + 2) < b.radius + plow.radius + 0.5 && b.position.y > 0.7;
          if (at < 0 && b.alive && (b.deck === slab || reach)) at = t;
          plow.position.set(px, 1.2, -2);
        });
        expect(at, `${type} from gate x ${gx}`).toBeGreaterThan(0);
        expect(at, `${type} from gate x ${gx}`).toBeLessThan(15);
      }
    }
  });
});

describe('stage 2: review cleanups', () => {
  it("echo kills count as bosses scrapped, not toward that boss's own trophy", () => {
    const p = new Progression();
    const events = new EventBus();
    const ctx = { events, progression: p, zone: { ...PROTOCOL_ZONE }, ui: { toast: () => {} }, audio: { play: () => {} } } as unknown as GameContext;
    new Achievements(ctx);
    const handle = (echo: boolean) => ({ type: 'grinder', isBoss: true, echo }) as never;
    events.emit('bossDefeated', { enemy: handle(true), name: 'ECHO THE GRINDER' });
    expect(life(p, LIFE.bossKills)).toBe(1);
    expect(life(p, lifeBoss('grinder'))).toBe(0);
    events.emit('bossDefeated', { enemy: handle(false), name: 'THE GRINDER' });
    expect(life(p, LIFE.bossKills)).toBe(2);
    expect(life(p, lifeBoss('grinder'))).toBe(1);
  });

  it('a clean clear needs the whole rush in one go (no checkpoint retry, no dev start)', () => {
    const p = new Progression();
    const r = (partial: boolean): GameEvents['runFinished'] => ({
      mode: 'campaign', plow: 'classic', won: true, kills: 0, killsBy: { slam: 0, ram: 0, whirl: 0, other: 0 } as never,
      coins: 0, bestCombo: 0, biggestBall: 0, duration: 60, damageTaken: 0, protocol: true, partial,
    });
    recordRunLifetime(p, r(true));
    expect(life(p, LIFE.cleanClears)).toBe(0);
    recordRunLifetime(p, r(false));
    expect(life(p, LIFE.cleanClears)).toBe(1);
  });

  it('a dev start records nothing: only an unlocked run from wave 1 or a checkpoint does', () => {
    expect(protocolRecordsRun(false, 1, false)).toBe(false);
    expect(protocolRecordsRun(false, 5, true)).toBe(false);
    expect(protocolRecordsRun(true, 1, false)).toBe(true);
    expect(protocolRecordsRun(true, 5, false)).toBe(false);
    expect(protocolRecordsRun(true, 5, true)).toBe(true);
  });

  it('clear loot is labelled as a PROTOCOL C clear, at Hard-clear odds', () => {
    expect(LOOT_RULES.protocol.label).toBe('PROTOCOL C clear');
    expect(LOOT_RULES.protocolRepeat.label).toBe('PROTOCOL C clear');
    expect(LOOT_RULES.protocol.weights).toEqual(LOOT_RULES.hard.weights);
    expect(LOOT_RULES.protocol.chance).toBe(1);
  });

  it("props keep the deck ramps' run-ups clear (the bots' way up)", async () => {
    const { Props } = await import('../src/world/Props');
    for (const w of [6, 7]) {
      const t = new Terrain(protocolTerrain(w));
      for (let seed = 0; seed < 25; seed++) {
        const ctx = { scene: new THREE.Scene(), fx: noop, audio: noop, pickups: { spawnCoins: () => {} }, terrain: t } as unknown as GameContext;
        const obs: { x: number; z: number; r: number; breakable?: boolean }[] = [];
        new Props(ctx).reset(obs, true, 777 + PROTOCOL_INDEX * 131 + seed, false, true);
        for (const o of obs.filter((q) => q.breakable)) for (const d of t.decks) if (d.rise) expect(t.inDeck(d, o.x, o.z, o.r + 3.9)).toBe(false);
      }
    }
  });
});

describe('PROTOCOL C scales with coins spent', () => {
  it('is 1x at the reference spend, floored below, uncapped above', async () => {
    const { spendScale, SPEND_REF, SPEND_HP_RANGE, SPEND_DMG_RANGE } = await import('../src/config/protocol');
    expect(spendScale(SPEND_REF)).toEqual({ hp: 1, dmg: 1 });
    const hi = spendScale(SPEND_REF * 4);
    expect(hi.hp).toBeCloseTo(2, 5);
    expect(hi.dmg).toBeGreaterThan(1);
    expect(hi.dmg).toBeLessThan(hi.hp);
    expect(spendScale(0)).toEqual({ hp: SPEND_HP_RANGE[0], dmg: SPEND_DMG_RANGE[0] });
    // No cap: it keeps growing.
    expect(SPEND_HP_RANGE[1]).toBe(Infinity);
    expect(spendScale(SPEND_REF * 100).hp).toBeCloseTo(10, 5);
    expect(spendScale(SPEND_REF * 100).dmg).toBeCloseTo(100 ** 0.3, 5);
  });
});
