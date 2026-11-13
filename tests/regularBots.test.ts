import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { GameContext } from '../src/core/types';
import { Terrain } from '../src/world/Terrain';
import {
  BULWARK_BLOCK, BULWARK_REAR_MULT, ENEMIES, GUNNER_AIM, GUNNER_PANIC, GUNNER_RANGE_MAX, GUNNER_RANGE_MIN, SPLIT_COUNT,
} from '../src/config/enemies';
import { ZONES } from '../src/config/zones';
import type { Bot } from '../src/entities/enemies/Bot';

/* The three regular bots added after the original four: Flurry Gunner (ranged), Bulwark (plow-shield), Slushpile
 * (splitter). Runs a real EnemyManager (rigs, AI, contact, bolts) on a flat arena with a stand-in plow and Combat. */

const noop: unknown = new Proxy(() => noop, { get: () => noop, apply: () => noop });

beforeAll(() => {
  // the bot models paint two canvas textures (hazard stripes, the rally cap): any 2D context will do headless
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) });
});
afterAll(() => vi.unstubAllGlobals());

async function arena() {
  const { EnemyManager } = await import('../src/entities/Enemies');
  const hits: { dmg: number; fromX: number; fromZ: number }[] = [];
  const kills: { type: string; coins: number }[] = [];
  const plow = {
    position: new THREE.Vector3(0, 0, 0), radius: 1.6, heldBallRadius: 0, dead: false, heading: 0, speed: 0, dashing: false, deck: -1,
    stealSnow: () => 0,
  };
  const ctx = {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), fx: noop, audio: noop, impact: noop,
    events: { emit: (name: string, p: { enemy: Bot; coins: number }) => name === 'enemyKilled' && kills.push({ type: p.enemy.type, coins: p.coins }) },
    plow,
    combat: {
      hitPlow: (dmg: number, fromX: number, fromZ: number) => {
        hits.push({ dmg, fromX, fromZ });
        return dmg;
      },
      playerRam: () => {},
    },
    zone: { enemyHpMult: 1, coinMult: 1, enemyDmgMult: 1 },
    terrain: new Terrain(),
    pickups: { spawnCoins: () => {} },
  };
  const mgr = new EnemyManager(ctx as unknown as GameContext);
  const run = (sec: number, each?: () => void) => {
    for (let t = 0; t < sec; t += 1 / 60) {
      mgr.update(1 / 60);
      each?.();
    }
  };
  return { mgr, ctx, plow, hits, kills, run };
}

const dist = (b: Bot, p: { position: THREE.Vector3 }) => Math.hypot(b.position.x - p.position.x, b.position.z - p.position.z);

describe('Bulwark plow-shield', () => {
  /** A Bulwark at the origin facing +Z; deal 40 raw from (fromX, fromZ) and return what landed. */
  async function hit(fromX: number, fromZ: number, opts: Record<string, unknown> = {}) {
    const { mgr } = await arena();
    const b = mgr.spawn('bulwark', 0, 0, { heading: 0 }) as Bot;
    mgr.damage(b, 40, { source: 'ram', fromX, fromZ, ...opts });
    return { dealt: b.maxHp - b.hp, b };
  }
  const armor = ENEMIES.bulwark.armor;

  it('blocks most of a direct hit inside its front 90° cone, with a BLOCK flash', async () => {
    const { dealt, b } = await hit(0, 10);
    expect(dealt).toBeCloseTo(40 * (1 - BULWARK_BLOCK) - armor);
    expect(b.glow).toBe(1);
    // 40° off the nose is still the shield; 50° is not
    expect((await hit(Math.sin(0.7) * 10, Math.cos(0.7) * 10)).dealt).toBeCloseTo(40 * (1 - BULWARK_BLOCK) - armor);
    expect((await hit(Math.sin(0.88) * 10, Math.cos(0.88) * 10)).dealt).toBeCloseTo(40 - armor);
  });

  it('takes full damage from the side and extra into the rear vent', async () => {
    expect((await hit(10, 0)).dealt).toBeCloseTo(40 - armor);
    expect((await hit(0, -10)).dealt).toBeCloseTo(40 * BULWARK_REAR_MULT - armor);
  });

  it('lets area damage (slams, blasts, ultimates) through from the front', async () => {
    for (const opts of [{ source: 'slam' }, { area: true }, { ult: true }, { source: 'stomp' }, { source: 'airSlam' }]) {
      expect((await hit(0, 10, opts)).dealt, JSON.stringify(opts)).toBeCloseTo(40 - armor);
    }
    // magnetic hits mostly pierce it, like the Brute Dozer's plate
    expect((await hit(0, 10, { pierce: true })).dealt).toBeCloseTo(40 * 0.8 - armor);
  });

  it('uses the plow position when a hit names no source point', async () => {
    const { mgr, plow } = await arena();
    const b = mgr.spawn('bulwark', 0, 0, { heading: 0 }) as Bot;
    plow.position.set(0, 0, 6); // in front
    mgr.damage(b, 40, { source: 'ram' });
    expect(b.maxHp - b.hp).toBeCloseTo(40 * (1 - BULWARK_BLOCK) - armor);
    plow.position.set(0, 0, -6); // behind
    const hp = b.hp;
    mgr.damage(b, 40, { source: 'ram' });
    expect(hp - b.hp).toBeCloseTo(40 * BULWARK_REAR_MULT - armor);
  });
});

describe('Slushpile split', () => {
  it('bursts into slushlings on death that carry its hp scaling and pay few coins', async () => {
    const { mgr, kills } = await arena();
    const pile = mgr.spawn('slushpile', 0, 10, { hpMult: 2 }) as Bot;
    expect(mgr.aliveCount()).toBe(1);
    expect(mgr.damage(pile, 9999, { source: 'ram' })).toBe(true);
    expect(mgr.aliveCount()).toBe(SPLIT_COUNT);
    expect(kills).toEqual([{ type: 'slushpile', coins: ENEMIES.slushpile.coins }]);
    const minis = mgr.query(0, 10, 4) as Bot[];
    expect(minis).toHaveLength(SPLIT_COUNT);
    for (const m of minis) {
      expect(m.type).toBe('slushling');
      expect(m.maxHp).toBe(ENEMIES.slushling.hp * 2);
      expect(m.entering).toBe(false);
      // kicked outward, away from the wreck
      expect(Math.hypot(m.kvx, m.kvz)).toBeGreaterThan(5);
    }
    // a slushling dies for a coin and does not split again
    mgr.damage(minis[0], 9999);
    expect(mgr.aliveCount()).toBe(SPLIT_COUNT - 1);
    expect(kills[1]).toEqual({ type: 'slushling', coins: ENEMIES.slushling.coins });
    expect(ENEMIES.slushling.coins).toBeLessThanOrEqual(2);
  });

  it('an area hit that wrecks the pile catches its slushlings too; a direct hit does not', async () => {
    const { mgr, kills } = await arena();
    mgr.damage(mgr.spawn('slushpile', 0, 10), 200, { source: 'slam' });
    expect(mgr.aliveCount()).toBe(0);
    expect(kills.map((k) => k.type)).toEqual(['slushpile', ...Array(SPLIT_COUNT).fill('slushling')]);
    // a weak area tick (a burn) scratches them without wrecking them
    const b = await arena();
    const worn = b.mgr.spawn('slushpile', 0, 10) as Bot;
    worn.hp = 3;
    b.mgr.damage(worn, 6, { area: true });
    const minis = b.mgr.query(0, 10, 4) as Bot[];
    expect(minis).toHaveLength(SPLIT_COUNT);
    for (const m of minis) expect(m.hp).toBeCloseTo(m.maxHp - 6);
    // a ram does not reach them
    const c = await arena();
    c.mgr.damage(c.mgr.spawn('slushpile', 0, 10), 200, { source: 'ram' });
    expect(c.mgr.aliveCount()).toBe(SPLIT_COUNT);
    for (const m of c.mgr.query(0, 10, 4) as Bot[]) expect(m.hp).toBe(m.maxHp);
  });

  it('only slushpiles split', async () => {
    const { mgr } = await arena();
    for (const t of ['scrapper', 'brute', 'gunner', 'bulwark'] as const) mgr.damage(mgr.spawn(t, 5, 5), 9999);
    expect(mgr.aliveCount()).toBe(0);
  });
});

describe('Flurry Gunner', () => {
  it('backs off to its standoff ring and stays there', async () => {
    const { mgr, plow, run } = await arena();
    const g = mgr.spawn('gunner', 0, -4, { heading: Math.PI }) as Bot;
    run(4);
    expect(dist(g, plow)).toBeGreaterThan(GUNNER_PANIC);
    let lo = Infinity;
    let hi = 0;
    run(8, () => {
      const d = dist(g, plow);
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    });
    expect(lo).toBeGreaterThan(GUNNER_RANGE_MIN - 2.5);
    expect(hi).toBeLessThan(GUNNER_RANGE_MAX + 2.5);
  });

  it('telegraphs, then fires a bolt that hits a plow standing still', async () => {
    const { mgr, run, hits } = await arena();
    const g = mgr.spawn('gunner', 0, -12, { heading: 0 }) as Bot;
    let aimT = 0;
    let firedAfterAim = 0;
    run(6, () => {
      if (g.state === 'aim') aimT += 1 / 60;
      if (mgr.boltsInFlight > 0 && !firedAfterAim) firedAfterAim = aimT;
    });
    expect(firedAfterAim).toBeGreaterThanOrEqual(GUNNER_AIM - 0.03);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].dmg).toBeCloseTo(ENEMIES.gunner.ramDamage);
  });

  it('the bolt is slow enough to dodge: drive out of its line and it misses', async () => {
    const { mgr, plow, run, hits } = await arena();
    mgr.spawn('gunner', 0, -12, { heading: 0 });
    let dodged = false;
    let hitsWhenGone = -1;
    run(6, () => {
      if (!dodged && mgr.boltsInFlight > 0) {
        dodged = true;
        // 0.1 s after the shot, 4 m to the side (a plow covers that in well under half a second)
        run(0.1);
        plow.position.x += 4;
      } else if (dodged && hitsWhenGone < 0 && mgr.boltsInFlight === 0) hitsWhenGone = hits.length;
    });
    expect(dodged).toBe(true);
    expect(hitsWhenGone).toBe(0);
  });
});

describe('campaign waves', () => {
  it('bring the new bots in from arena 2 onward, never in arena 1, never as boss rounds', () => {
    const types = (i: number) => new Set(ZONES[i].rounds.filter((r) => !r.boss).flatMap((r) => r.groups.map((g) => g.type)));
    for (const t of ['gunner', 'bulwark', 'slushpile'] as const) expect(types(0).has(t)).toBe(false);
    expect(types(1).has('gunner')).toBe(true);
    expect(types(1).has('slushpile')).toBe(true);
    for (let i = 2; i < ZONES.length; i++) for (const t of ['gunner', 'bulwark', 'slushpile'] as const) expect(types(i).has(t), `${ZONES[i].name} ${t}`).toBe(true);
    for (const z of ZONES) for (const r of z.rounds) if (r.boss) for (const g of r.groups) expect(ENEMIES[g.type].isBoss || g.type === 'scrapper').toBe(true);
    // slushlings only ever come out of a pile
    for (const z of ZONES) for (const r of z.rounds) for (const g of r.groups) expect(g.type).not.toBe('slushling');
  });
});
