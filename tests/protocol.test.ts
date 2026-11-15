import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { GameContext } from '../src/core/types';
import { ENEMY_GATES, PLOW_SPAWN } from '../src/core/types';
import { Progression, sanitizeProtocol } from '../src/core/Progression';
import { ZONES } from '../src/config/zones';
import { HARD } from '../src/config/challenges';
import {
  ECHO_HP, HEADLINE_HP, MAX_ACTIVE, PROTOCOL_CLEAR_REWARD, PROTOCOL_INDEX, PROTOCOL_WAVES, PROTOCOL_ZONE, homeZone, protocolRounds,
  protocolWaveZone, protocolZone, waveBossCount,
} from '../src/config/protocol';
import {
  formatRunTime, protocolReward, protocolSave, protocolTeased, protocolUnlocked, recordProtocolClear, recordProtocolWave, restoreCheckpoint,
  saveCheckpoint, takeCheckpoint,
} from '../src/meta/protocol';
import { maxStars } from '../src/meta/challenges';
import { BROKEN_RAMPS, FEATURES, RING_R, WAVE_FEATURES, protocolTerrain } from '../src/world/protocol/layout';
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
    // wave 7: the stand-in final boss (THE CHAIRMAN comes in stage 3) + every headline as an echo
    expect(bossesOf(7)).toEqual(['H:donald', 'E:frostbyte', 'E:bulldoza', 'E:grinder', 'E:slush', 'E:sleet', 'E:donald', 'E:omega']);
    expect(waveBossCount(7)).toEqual({ total: 8, echoes: 7 });
    expect(waveBossCount(1)).toEqual({ total: 1, echoes: 0 });
  });

  it('net boss HP: headline = home x HEADLINE_HP, echo = home x ECHO_HP (x the pilot-power scale)', () => {
    const z = protocolZone({ hp: 1.5, dmg: 1.2 });
    expect(z.enemyHpMult).toBeCloseTo(HARD.hpMult * 1.5);
    expect(z.enemyDmgMult).toBeCloseTo(HARD.dmgMult * 1.2);
    for (const r of rounds) {
      for (const g of r.groups) {
        const home = homeZone(g.type)!.enemyHpMult;
        expect(PROTOCOL_ZONE.enemyHpMult * g.hpMult!).toBeCloseTo(home * (g.echo ? ECHO_HP : HEADLINE_HP));
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
    expect(rec).toEqual({ firstClear: true, reward: PROTOCOL_CLEAR_REWARD, newBest: true, bestTime: 412.3 });
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
      cleared: false, clears: 0, bestTime: 0, bestWave: PROTOCOL_WAVES, cleanClear: false, checkpoint: null,
    });
    // a checkpoint without a usable wave / HP is dropped; numbers are clamped
    expect(sanitizeProtocol({ checkpoint: { wave: 0, hpFrac: 0.5 } })!.checkpoint).toBeNull();
    expect(sanitizeProtocol({ checkpoint: { wave: 3, hpFrac: 0 } })!.checkpoint).toBeNull();
    expect(sanitizeProtocol({ checkpoint: { wave: 12.7, hpFrac: 4, elapsed: -3, kills: 2.5, coins: 'a', uses: 1 } })!.checkpoint).toEqual({
      wave: PROTOCOL_WAVES, hpFrac: 1, elapsed: 0, kills: 2, coins: 0, uses: 1,
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
