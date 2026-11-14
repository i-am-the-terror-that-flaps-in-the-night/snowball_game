import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { GameContext } from '../src/core/types';
import { Terrain } from '../src/world/Terrain';
import {
  ENEMIES, FENCE_DMG, MAGNET_ANCHOR, MAGNET_HOT, MAGNET_ON, MAGNET_PULL, MAGNET_ZAP_DMG, MIRROR_DELAY, MIRROR_DMG, MIRROR_EXPOSED,
  MIRROR_STALL, TWIN_REVIVE, TWIN_REVIVE_HP, TWIN_SEVER_BONUS, TWIN_TETHER_DMG,
} from '../src/config/enemies';
import { ZONES } from '../src/config/zones';
import { SURVIVAL_MINIONS } from '../src/survival/SurvivalManager';
import { MirrorMove, Vuln, type Bot } from '../src/entities/enemies/Bot';

/* The three elites: Mirror Plow (copies the player's moves, then stalls exposed), Magnet Tower (anchors, pulls, zaps,
 * fences with a second tower) and Tether Twins (husk / revive / SEVERED, the tether zap). A real EnemyManager on a
 * flat arena with a stand-in plow, Combat and event bus. */

const noop: unknown = new Proxy(() => noop, { get: () => noop, apply: () => noop });

beforeAll(() => {
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) });
});
afterAll(() => vi.unstubAllGlobals());

async function arena(kind = 'classic') {
  const { EnemyManager } = await import('../src/entities/Enemies');
  const hits: { dmg: number; fromX: number; fromZ: number; knock?: number }[] = [];
  const kills: { type: string; coins: number }[] = [];
  const tows: { dx: number; dz: number; frac: number }[] = [];
  const coins: number[] = [];
  const handlers = new Map<string, ((p: unknown) => void)[]>();
  const plow = {
    position: new THREE.Vector3(0, 0, 0), radius: 1.6, heldBallRadius: 0, dead: false, heading: 0, speed: 0, dashing: false, whirling: false, deck: -1,
    stealSnow: () => 0,
    tow: (dx: number, dz: number, frac: number) => tows.push({ dx, dz, frac }),
  };
  const events = {
    emit: (name: string, p: { enemy: Bot; coins: number }) => {
      if (name === 'enemyKilled') kills.push({ type: p.enemy.type, coins: p.coins });
      for (const f of handlers.get(name) ?? []) f(p);
    },
    on: (name: string, f: (p: unknown) => void) => {
      handlers.set(name, [...(handlers.get(name) ?? []), f]);
      return () => {};
    },
  };
  const ctx = {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), fx: noop, audio: noop, impact: noop,
    events, plow, stats: { plowKind: kind },
    combat: {
      hitPlow: (dmg: number, fromX: number, fromZ: number, o?: { knockback?: number }) => {
        hits.push({ dmg, fromX, fromZ, knock: o?.knockback });
        return dmg;
      },
      playerRam: () => {},
    },
    zone: { enemyHpMult: 1, coinMult: 1, enemyDmgMult: 1 },
    terrain: new Terrain(),
    pickups: { spawnCoins: (_p: unknown, n: number) => coins.push(n) },
  };
  const mgr = new EnemyManager(ctx as unknown as GameContext);
  const run = (sec: number, each?: () => void) => {
    for (let t = 0; t < sec; t += 1 / 60) {
      mgr.update(1 / 60);
      each?.();
    }
  };
  return { mgr, ctx, plow, hits, kills, tows, coins, run, events };
}

const spawnIn = (mgr: { spawn(t: string, x: number, z: number, o?: object): unknown }, t: string, x: number, z: number, heading = 0) =>
  mgr.spawn(t as never, x, z, { heading, noGate: true }) as Bot;

describe('Mirror Plow', () => {
  it('records a player slam, telegraphs a RING copy, slams the plow inside it, then stalls EXPOSED', async () => {
    const { mgr, hits, run, events } = await arena();
    const m = spawnIn(mgr, 'mirror', 0, 7, Math.PI);
    m.entering = false;
    m.cd = 0;
    run(0.2);
    events.emit('slam', { hits: 0, radius: 2, position: new THREE.Vector3() } as never);
    run(0.1);
    expect(m.state).toBe('record');
    expect(m.mimic).toBe(MirrorMove.Ring);
    // nothing lands while it records
    run(MIRROR_DELAY - 0.2);
    expect(hits.length).toBe(0);
    // it rushed in to slam range while recording, then rings where it stands
    expect(Math.hypot(m.position.x, m.position.z)).toBeLessThan(5.5);
    let stalled = false;
    run(1.2, () => {
      if (m.state === 'stall') stalled = true;
    });
    expect(stalled).toBe(true);
    const ringHit = hits.find((h) => Math.abs(h.dmg - ENEMIES.mirror.ramDamage * MIRROR_DMG.ring) < 1e-6);
    expect(ringHit).toBeTruthy();
    expect(m.vuln).toBe(Vuln.Exposed);
    expect(m.vulnMult).toBe(MIRROR_EXPOSED);
    // exposed: a hit lands x1.5
    const hp0 = m.hp;
    mgr.damage(m, 40, { source: 'ram', fromX: 0, fromZ: 0 });
    expect(hp0 - m.hp).toBeCloseTo((40 - ENEMIES.mirror.armor) * MIRROR_EXPOSED, 3);
    run(MIRROR_STALL);
    expect(m.state).toBe('shadow');
  });

  it('copies each plow kind\'s F ability as its own move (VOLT-9 beam, ISOTOPE blast) and a dash as a dash', async () => {
    for (const [kind, want] of [['volt', MirrorMove.Beam], ['isotope', MirrorMove.Cone]] as const) {
      const { mgr, run, events } = await arena(kind);
      const m = spawnIn(mgr, 'mirror', 0, 8, Math.PI);
      m.entering = false;
      m.cd = 0;
      run(0.1);
      events.emit('ability', { nuke: false } as never);
      run(0.05);
      expect(m.mimic).toBe(want);
    }
    const { mgr, plow, run } = await arena();
    const m = spawnIn(mgr, 'mirror', 0, 8, Math.PI);
    m.entering = false;
    m.cd = 0;
    run(0.1);
    plow.dashing = true;
    run(0.05);
    expect(m.mimic).toBe(MirrorMove.Dash);
  });

  it('a BEAM copy is aimed where the plow was: drive out of the stripe and it misses', async () => {
    const { mgr, plow, hits, run, events } = await arena('volt');
    const m = spawnIn(mgr, 'mirror', 0, 9, Math.PI);
    m.entering = false;
    m.cd = 0;
    run(0.1);
    events.emit('ability', { nuke: false } as never);
    run(MIRROR_DELAY + 0.05);
    expect(m.state).toBe('cBeamWind');
    plow.position.x = 5; // sidestep out of the line
    run(0.6);
    expect(hits.some((h) => Math.abs(h.dmg - ENEMIES.mirror.ramDamage * MIRROR_DMG.beam) < 1e-6)).toBe(false);
  });

  it('never copies an ultimate', async () => {
    const { mgr, run, events } = await arena('volt');
    const m = spawnIn(mgr, 'mirror', 0, 8, Math.PI);
    m.entering = false;
    m.cd = 0;
    run(0.1);
    events.emit('ability', { nuke: true } as never);
    run(0.1);
    expect(m.state).toBe('shadow');
  });
});

describe('Magnet Tower', () => {
  it('anchors (pinned), pulls the plow in at MAGNET_PULL of its top speed, then overheats exposed', async () => {
    const { mgr, tows, run } = await arena();
    const t = spawnIn(mgr, 'magnet', 0, 11);
    t.entering = false;
    t.set('anchor', MAGNET_ANCHOR);
    run(MAGNET_ANCHOR + 0.1);
    expect(t.anchored).toBe(true);
    expect(t.state).toBe('pull');
    const x0 = t.position.x;
    const z0 = t.position.z;
    run(1);
    expect(tows.length).toBeGreaterThan(30);
    // toward the tower, at most MAGNET_PULL
    const last = tows[tows.length - 1];
    expect(last.dz).toBeGreaterThan(0.9);
    expect(Math.max(...tows.map((w) => w.frac))).toBeLessThanOrEqual(MAGNET_PULL + 1e-9);
    // knock it: it doesn't budge
    mgr.damage(t, 10, { source: 'ram', fromX: 0, fromZ: 0, knockback: new THREE.Vector3(0, 0, 30) });
    run(0.3);
    expect(Math.hypot(t.position.x - x0, t.position.z - z0)).toBeLessThan(0.3);
    for (let i = 0; i < 600 && t.state !== 'hot'; i++) run(1 / 60);
    expect(t.state).toBe('hot');
    expect(t.vuln).toBe(Vuln.Overheat);
    const n = tows.length;
    run(MAGNET_HOT * 0.5);
    expect(tows.length).toBe(n); // no pull while overheated
  });

  it('zaps the plow inside its zap reach', async () => {
    const { mgr, hits, run } = await arena();
    const t = spawnIn(mgr, 'magnet', 0, 4);
    t.entering = false;
    t.set('anchor', 0.05);
    run(1.2);
    expect(hits.filter((h) => h.dmg === MAGNET_ZAP_DMG).length).toBeGreaterThanOrEqual(2);
  });

  it('two anchored towers chain a fence that zaps a plow touching the line', async () => {
    const { mgr, plow, hits, run } = await arena();
    plow.position.set(0, 0, 10);
    const a = spawnIn(mgr, 'magnet', -7, 0);
    const b = spawnIn(mgr, 'magnet', 7, 0);
    for (const t of [a, b]) {
      t.entering = false;
      t.set('anchor', 0.05);
    }
    run(0.3, () => plow.position.set(0, 0, 10));
    expect(mgr.linkCount).toBeGreaterThanOrEqual(2);
    expect(hits.length).toBe(0);
    run(0.1, () => plow.position.set(0, 0, 0.3)); // on the line
    expect(hits.some((h) => h.dmg === FENCE_DMG)).toBe(true);
  });
});

describe('Tether Twins', () => {
  async function pair() {
    const r = await arena();
    const a = spawnIn(r.mgr, 'twinlink', -3, 10);
    const b = spawnIn(r.mgr, 'twinlink', 3, 10);
    a.entering = b.entering = false;
    return { ...r, a, b };
  }

  it('spawn as a linked pair; the first one wrecked drops as an untargetable husk and its twin enrages', async () => {
    const { mgr, a, b, kills, run } = await pair();
    expect(a.partner).toBe(b);
    expect(b.partner).toBe(a);
    mgr.damage(a, 999, { source: 'ram' });
    expect(a.alive).toBe(true);
    expect(a.husk).toBe(true);
    expect(kills.length).toBe(0);
    expect(mgr.aliveCount()).toBe(2); // the wave is not over
    expect(mgr.query(a.position.x, a.position.z, 1)).not.toContain(a);
    expect(mgr.damage(a, 50, { source: 'ram' })).toBe(false);
    run(0.1);
    expect(b.enraged).toBe(true);
    expect(b.state).toBe('revive');
  });

  it('the twin revives the husk after a TWIN_REVIVE s channel, at TWIN_REVIVE_HP', async () => {
    const { mgr, a, b, run } = await pair();
    mgr.damage(a, 999, { source: 'ram' });
    run(TWIN_REVIVE + 3);
    expect(a.husk).toBe(false);
    expect(a.hp).toBe(Math.round(a.maxHp * TWIN_REVIVE_HP));
    expect(b.enraged).toBe(false);
  });

  it('wreck both within the window: both die, SEVERED bonus coins', async () => {
    const { mgr, a, b, kills, coins, run } = await pair();
    mgr.damage(a, 999, { source: 'ram' });
    run(0.5);
    mgr.damage(b, 999, { source: 'ram' });
    expect(a.alive).toBe(false);
    expect(b.alive).toBe(false);
    expect(kills.map((k) => k.type)).toEqual(['twinlink', 'twinlink']);
    expect(coins).toContain(ENEMIES.twinlink.coins * TWIN_SEVER_BONUS);
    expect(mgr.aliveCount()).toBe(0);
  });

  it('the tether zaps a plow driving through it', async () => {
    const { plow, hits, run } = await pair();
    run(0.05, () => plow.position.set(0, 0, 10)); // between the twins, on the line
    expect(hits.some((h) => h.dmg === TWIN_TETHER_DMG)).toBe(true);
  });
});

describe('elite waves', () => {
  it('campaign: a Magnet closes arena 3; twins (always in pairs) and the Mirror from arena 4; none in arenas 1-2', () => {
    const types = (i: number) => ZONES[i].rounds.flatMap((r) => r.groups.map((g) => g.type));
    for (const i of [0, 1]) for (const t of ['mirror', 'magnet', 'twinlink']) expect(types(i)).not.toContain(t);
    expect(types(2)).toContain('magnet');
    for (const t of ['mirror', 'magnet', 'twinlink']) expect(types(3)).toContain(t);
    for (const z of ZONES) for (const r of z.rounds) for (const g of r.groups) if (g.type === 'twinlink') expect(g.count % 2).toBe(0);
  });

  it('Survival draws them late (towers 9, twins 10, mirror 12)', () => {
    const from = (t: string) => SURVIVAL_MINIONS.find((m) => m.type === t)?.from;
    expect(from('magnet')).toBe(9);
    expect(from('twinlink')).toBe(10);
    expect(from('mirror')).toBe(12);
  });
});
