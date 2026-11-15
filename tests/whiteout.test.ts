import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { EnemyHandle, GameContext } from '../src/core/types';
import { Terrain } from '../src/world/Terrain';
import type { Bot } from '../src/entities/enemies/Bot';
import {
  COPY_TYPES, EYE_DOWN, EYE_HIGH, HEART_SPOTS, WO, angerFrom, byAnger, copyCap, eyeDamageMult, heartsForCycle, pickAttack, pickHeartSpots, shardCount,
} from '../src/config/whiteout';
import { PROTOCOL_FINALE, PROTOCOL_WAVES, protocolWaveLabel } from '../src/config/protocol';
import { Progression, sanitizeProtocol } from '../src/core/Progression';
import { protocolSave, recordProtocolWave, restoreCheckpoint, takeCheckpoint } from '../src/meta/protocol';
import { RING_R } from '../src/world/protocol/layout';

/* PROTOCOL C build stage 4 (part A): THE WHITEOUT. The hook from THE CHAIRMAN's defeat (no victory until THE AVALANCHE),
 * the FINALE checkpoint, Storm Heart escalation, the STAGGER windows and the eye's immunity, the attack telegraphs. */

const noop: unknown = new Proxy(() => noop, { get: () => noop, apply: () => noop });
beforeAll(() => {
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) });
});
afterAll(() => vi.unstubAllGlobals());

async function arena() {
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) });
  const { EnemyManager } = await import('../src/entities/Enemies');
  const { WhiteoutDirector } = await import('../src/core/whiteoutDirector');
  const handlers = new Map<string, ((p: unknown) => void)[]>();
  const hits: number[] = [];
  const intros: string[] = [];
  const sky: number[] = [];
  const plow = {
    position: new THREE.Vector3(0, 0, 18), radius: 1.6, heldBallRadius: 0, dead: false, heading: Math.PI, speed: 0, dashing: false, whirling: false, deck: -1,
    hp: 100, maxHp: 100, dazeT: 0, towed: 0,
    stealSnow: () => 0, push: () => {},
    tow(this: { towed: number }) {
      this.towed++;
    },
    daze(this: { dazeT: number }, t: number) {
      this.dazeT = t;
    },
  };
  const events = {
    emit: (name: string, p: unknown) => {
      for (const f of handlers.get(name) ?? []) f(p);
    },
    on: (name: string, f: (p: unknown) => void) => {
      handlers.set(name, [...(handlers.get(name) ?? []), f]);
      return () => {};
    },
  };
  const ctx = {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), fx: noop, audio: noop, impact: noop, cameraRig: noop,
    events, plow, stats: { plowKind: 'classic' },
    combat: { hitPlow: (dmg: number) => (hits.push(dmg), dmg), playerRam: () => {} },
    zone: { enemyHpMult: 1, coinMult: 1, enemyDmgMult: 1, theme: 'protocol', maxActiveBosses: 4 },
    terrain: new Terrain(),
    snow: { getDepth: () => 0, collectDisc: () => 0 },
    pickups: { spawnCoins: () => {} },
    world: { obstacles: [] as unknown[], boardroom: () => {}, openGate: () => {}, whiteoutSky: (k: number) => sky.push(k) },
    ui: { bossIntro: (n: string) => intros.push(n), toast: () => {} },
    waves: { remaining: 0 },
  };
  const mgr = new EnemyManager(ctx as unknown as GameContext);
  (ctx as unknown as { enemies: unknown }).enemies = mgr;
  const wo = new WhiteoutDirector(ctx as unknown as GameContext);
  const run = (sec: number, each?: () => void) => {
    for (let t = 0; t < sec - 1e-9; t += 1 / 60) {
      mgr.update(1 / 60);
      wo.update(1 / 60);
      each?.();
    }
  };
  return { mgr, ctx, plow, wo, run, hits, intros, sky };
}

/** A director already past the takeover, Hearts up, its own attacks parked (tests trigger them by hand). */
async function hearts() {
  const a = await arena();
  a.wo.start([], true);
  a.run(WO.HEARTS_AT + 0.05);
  park(a.wo);
  return a;
}

function park(wo: unknown): void {
  const w = wo as { attackT: number; gustT: number; copyT: number; eyeT: number };
  w.attackT = w.gustT = w.copyT = 1e9;
  w.eyeT = 1e9;
}

describe('rules (config/whiteout.ts)', () => {
  it('Hearts: 3, then 4, then 5 every cycle after; anger only grows with every Heart broken', () => {
    expect([0, 1, 2, 3, 7].map(heartsForCycle)).toEqual([3, 4, 5, 5, 5]);
    expect(angerFrom(0)).toBe(0);
    expect(angerFrom(WO.ANGER_FULL)).toBe(1);
    expect(angerFrom(99)).toBe(1);
    let last = -1;
    for (let b = 0; b <= WO.ANGER_FULL; b++) {
      const a = angerFrom(b);
      expect(a).toBeGreaterThan(last);
      last = a;
    }
    // ANGRIER: more shards, shorter gaps and telegraphs (never under 1 s), more copies, stronger gusts
    expect(shardCount(1)).toBeGreaterThan(shardCount(0));
    expect(byAnger(WO.GAP, 1)).toBeLessThan(byAnger(WO.GAP, 0));
    expect(byAnger(WO.SHARD_TELE, 1)).toBeLessThan(byAnger(WO.SHARD_TELE, 0));
    expect(byAnger(WO.SHARD_TELE, 1)).toBeGreaterThanOrEqual(1);
    expect(copyCap(1)).toBeGreaterThan(copyCap(0));
    expect(byAnger(WO.GUST_FRAC, 1)).toBeGreaterThan(byAnger(WO.GUST_FRAC, 0));
    expect(byAnger(WO.GUST_GAP, 1)).toBeLessThan(byAnger(WO.GUST_GAP, 0));
  });

  it('the eye: sealed takes nothing, chip when open, full + bonus in a STAGGER', () => {
    expect(eyeDamageMult('sealed')).toBe(0);
    expect(eyeDamageMult('open')).toBe(WO.EYE_CHIP);
    expect(eyeDamageMult('stagger')).toBe(WO.EYE_STAGGER);
    expect(WO.EYE_CHIP).toBeLessThan(1);
    expect(WO.EYE_STAGGER).toBeGreaterThan(1);
    // high it sits past the north wall (ranged reach only); staggered it is inside rammer reach
    expect(EYE_HIGH.z + 3.4).toBeLessThan(-30);
    expect(EYE_DOWN.z + 3.4).toBeGreaterThan(-30 + 1.5);
  });

  it('pickAttack never repeats the last attack; a glare only when allowed', () => {
    for (const last of ['shards', 'sweep', 'glare', null] as const) {
      for (let r = 0; r < 1; r += 0.05) expect(pickAttack(last, r)).not.toBe(last);
    }
    for (let r = 0; r < 1; r += 0.05) expect(pickAttack('shards', r, false)).toBe('sweep');
  });

  it('Heart spots: off the lava ring and the decks; picks spread out and keep clear of the plow', () => {
    for (const s of HEART_SPOTS) {
      const r = Math.hypot(s.x, s.z);
      expect(Math.abs(r - RING_R), `${s.x},${s.z}`).toBeGreaterThan(2);
      // the gold decks (x +-13 +- 2.5, z -2 +- 7.5 with the ramps)
      expect(Math.abs(Math.abs(s.x) - 13) < 3 && Math.abs(s.z + 2) < 8, `${s.x},${s.z}`).toBe(false);
      expect(Math.abs(s.x)).toBeLessThan(27);
      expect(Math.abs(s.z)).toBeLessThan(27);
    }
    for (const n of [3, 4, 5]) {
      for (const [px, pz] of [[0, 18], [0, 0], [-16, 8], [9, -16]]) {
        const out = pickHeartSpots(n, px, pz, 0.37);
        expect(out).toHaveLength(n);
        expect(new Set(out).size).toBe(n);
        for (const s of out) expect(Math.hypot(s.x - px, s.z - pz)).toBeGreaterThanOrEqual(WO.HEART_CLEAR);
        let minD = Infinity;
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) minD = Math.min(minD, Math.hypot(out[i].x - out[j].x, out[i].z - out[j].z));
        expect(minD).toBeGreaterThan(9);
      }
    }
    expect(COPY_TYPES.length).toBeGreaterThan(3);
  });
});

describe('the FINALE checkpoint (meta/protocol.ts)', () => {
  it('is internal wave 8: kept by takeCheckpoint, the save sanitizer and the best-wave record; labelled FINALE', () => {
    expect(PROTOCOL_FINALE).toBe(PROTOCOL_WAVES + 1);
    const ck = takeCheckpoint({ wave: PROTOCOL_FINALE, hp: 60, maxHp: 120, time: 400, start: 100, kills: 30, coins: 900, uses: 1 });
    expect(ck).toEqual({ wave: 8, hpFrac: 0.5, elapsed: 300, kills: 30, coins: 900, uses: 1 });
    expect(takeCheckpoint({ wave: 99, hp: 1, maxHp: 1, time: 0, start: 0, kills: 0, coins: 0, uses: 0 }).wave).toBe(PROTOCOL_FINALE);
    const r = restoreCheckpoint(ck, 200, 1000);
    expect(r).toEqual({ wave: 8, hp: 100, kills: 30, coins: 900, start: 700, uses: 2 });
    expect(sanitizeProtocol({ checkpoint: ck })!.checkpoint).toEqual(ck);
    const p = new Progression();
    p.resetSave();
    recordProtocolWave(p, PROTOCOL_FINALE);
    expect(protocolSave(p).bestWave).toBe(PROTOCOL_FINALE);
    expect(protocolWaveLabel(5)).toBe('WAVE 5');
    expect(protocolWaveLabel(PROTOCOL_FINALE)).toBe('FINALE');
  });
});

describe('the hook (no victory until THE AVALANCHE)', () => {
  it("THE CHAIRMAN's wreck hands the standing echoes to THE WHITEOUT (snow statues) and powers the minions down", async () => {
    const { ChairmanDirector } = await import('../src/core/chairmanDirector');
    const handlers = new Map<string, ((p: unknown) => void)[]>();
    const events = {
      emit: (name: string, p: unknown) => {
        for (const f of handlers.get(name) ?? []) f(p);
      },
      on: (name: string, f: (p: unknown) => void) => handlers.set(name, [...(handlers.get(name) ?? []), f]),
    };
    const dismissed: unknown[] = [];
    let cancelled = 0;
    const bosses = [{ type: 'omega', echo: true, alive: true }, { type: 'grinder', echo: true, alive: true }];
    const minions = [{ type: 'rallybot', echo: false, alive: true }];
    const ctx = {
      events, ui: { toast: () => {} }, world: { boardroom: () => {} }, plow: { hp: 100, maxHp: 100, dead: false },
      waves: { cancel: () => cancelled++ },
      enemies: {
        bosses,
        dismiss: (b: { alive: boolean }) => {
          dismissed.push(b);
          b.alive = false;
        },
        query: (_x: number, _z: number, _r: number, out: unknown[]) => {
          out.length = 0;
          for (const b of [...bosses, ...minions]) if (b.alive) out.push(b);
          return out;
        },
      },
    };
    const d = new ChairmanDirector(ctx as unknown as GameContext);
    let got: readonly EnemyHandle[] | null = null;
    d.whiteout = (echoes) => (got = [...echoes]);
    d.begin(7);
    events.emit('bossDefeated', { enemy: { type: 'chairman', echo: false } });
    expect(cancelled).toBe(1);
    expect(got).toHaveLength(2);
    expect(bosses.every((b) => b.alive)).toBe(true);
    expect(dismissed).toEqual([minions[0]]);
  });

  it('the director holds the round open from the takeover until startAvalanche(); end() lets go', async () => {
    const { wo, run, mgr, intros, sky } = await arena();
    expect(wo.holding).toBe(false);
    wo.start([], true);
    expect(wo.phase).toBe('takeover');
    expect(wo.holding).toBe(true);
    run(WO.ROAR_AT + 0.05);
    // the roar: the boss card and the EYE (its boss bar)
    expect(intros).toContain('THE WHITEOUT');
    expect(wo.eye?.alive).toBe(true);
    expect(mgr.bosses).toContain(wo.eye);
    expect(sky.at(-1)).toBe(1);
    run(WO.HEARTS_AT - WO.ROAR_AT);
    expect(wo.phase).toBe('hearts');
    expect(wo.hearts).toHaveLength(3);
    expect(wo.holding).toBe(true);
    wo.startAvalanche();
    expect(wo.phase).toBe('avalanche');
    expect(wo.holding).toBe(false);
    // everything powers down: nothing left alive to hold the wave (Game: waves.done -> the victory)
    expect(mgr.aliveCount()).toBe(0);
    wo.end();
    expect(wo.active).toBe(false);
  });

  it('the FINALE checkpoint is taken as the eye opens', async () => {
    const { wo, run } = await arena();
    let ck = 0;
    wo.onCheckpoint = () => ck++;
    wo.start([], true);
    run(WO.ROAR_AT - 0.1);
    expect(ck).toBe(0);
    run(0.2);
    expect(ck).toBe(1);
    run(3);
    expect(ck).toBe(1);
  });

  it('echoes handed over freeze into snow statues (fixed, untouchable) and shatter during the takeover', async () => {
    const { wo, run, mgr } = await arena();
    const e = mgr.spawn('omega', 10, 0, { noGate: true, echo: true }) as Bot;
    e.entering = false;
    wo.start([e], false);
    expect(e.fixed).toBe(true);
    expect(e.freeze).toBeGreaterThan(10);
    const hp = e.hp;
    mgr.damage(e, 500, {});
    expect(e.hp).toBe(hp);
    run(WO.STATUE_T + 0.1);
    expect(e.alive).toBe(false);
  });
});

describe('Storm Hearts, escalation, STAGGER', () => {
  it('every Heart broken makes it angrier and knocks a share off the eye; the last one STAGGERS it', async () => {
    const { wo, run, mgr } = await hearts();
    const eye = wo.eye!;
    expect(wo.anger).toBe(0);
    const hs = [...wo.hearts];
    expect(hs.every((h) => h.fixed && h.alive)).toBe(true);
    mgr.damage(hs[0], 1e6, {});
    run(0.05);
    expect(wo.broken).toBe(1);
    expect(wo.anger).toBeCloseTo(angerFrom(1));
    expect(eye.hp).toBeCloseTo(eye.maxHp * (1 - WO.HEART_CHIP));
    expect(wo.phase).toBe('hearts');
    mgr.damage(hs[1], 1e6, {});
    mgr.damage(hs[2], 1e6, {});
    run(0.05);
    expect(wo.phase).toBe('lean');
    run(WO.LEAN_T);
    expect(wo.phase).toBe('stagger');
    expect(wo.eyeMode).toBe('stagger');
    // the eye lies on the stand front, inside the arena's reach
    expect(eye.position.z).toBeCloseTo(EYE_DOWN.z);
    run(WO.STAGGER_T);
    expect(wo.phase).toBe('recover');
    run(WO.RECOVER_T + 0.05);
    expect(wo.phase).toBe('hearts');
    expect(wo.cycle).toBe(1);
    expect(wo.hearts).toHaveLength(4);
    // it never eases: anger stays where the broken Hearts put it
    expect(wo.anger).toBeCloseTo(angerFrom(3));
  });

  it('the eye is sealed while closed (no damage, a SEALED label), chipped when open, full + bonus in a STAGGER', async () => {
    const { wo, run, mgr } = await hearts();
    const eye = wo.eye!;
    expect(wo.eyeMode).toBe('sealed');
    const hp0 = eye.hp;
    expect(mgr.damage(eye, 1000, { ult: true })).toBe(false);
    expect(mgr.damage(eye, 1000, {})).toBe(false);
    expect(eye.hp).toBe(hp0);
    // open (between staggers): chip
    (wo as unknown as { eyeOpen: boolean }).eyeOpen = true;
    run(1 / 60);
    expect(wo.eyeMode).toBe('open');
    mgr.damage(eye, 1000, {});
    const chip = hp0 - eye.hp;
    expect(chip).toBeCloseTo((1000 - eye.def.armor) * WO.EYE_CHIP, 3);
    // STAGGER: full + the bonus
    for (const h of wo.hearts) mgr.damage(h, 1e6, {});
    run(WO.LEAN_T + 0.1);
    expect(wo.eyeMode).toBe('stagger');
    const hp1 = eye.hp;
    mgr.damage(eye, 1000, {});
    expect(hp1 - eye.hp).toBeCloseTo((1000 - eye.def.armor) * WO.EYE_STAGGER, 3);
    // during the lean / recovery it is sealed again
    run(WO.STAGGER_T + 0.1);
    expect(wo.phase).toBe('recover');
    expect(wo.eyeMode).toBe('sealed');
  });

  it(`at ${WO.AVALANCHE_AT * 100}% of its HP the eye holds and THE AVALANCHE starts (the loop's end)`, async () => {
    const { wo, run, mgr } = await hearts();
    const eye = wo.eye!;
    for (const h of wo.hearts) mgr.damage(h, 1e6, {});
    run(WO.LEAN_T + 0.1);
    mgr.damage(eye, 1e9, {});
    expect(eye.hp).toBeCloseTo(eye.maxHp * WO.AVALANCHE_AT);
    expect(eye.alive).toBe(true);
    run(1 / 60);
    expect(wo.phase).toBe('avalanche');
    expect(wo.holding).toBe(false);
  });
});

describe('attacks: every hit is telegraphed', () => {
  it('ICE SHARD RAIN: rings first, the shard lands after the telegraph (damage there), then stands as an obstacle', async () => {
    const { wo, run, plow, hits } = await hearts();
    const { whiteoutProps } = await import('../src/entities/enemies/whiteoutProps');
    plow.position.set(4, 0, 4);
    const tele = byAnger(WO.SHARD_TELE, wo.anger);
    (wo as unknown as { shards(a: number): number }).shards(wo.anger);
    expect(whiteoutProps.shardsLive).toBeGreaterThanOrEqual(shardCount(0) - 1);
    // the first ring is on the plow: nothing lands before the telegraph runs out
    run(tele - 0.1);
    expect(hits).toHaveLength(0);
    expect(whiteoutProps.shardsStanding).toBe(0);
    run(0.15);
    expect(hits.length).toBe(1);
    expect(whiteoutProps.shardsStanding).toBeGreaterThan(0);
    // standing shards burst after SHARD_STAY
    run(WO.SHARD_STAY + shardCount(1) * WO.SHARD_STEP + 0.2);
    expect(whiteoutProps.shardsLive).toBe(0);
    expect(tele).toBeGreaterThanOrEqual(1);
  });

  it('a standing shard is an obstacle: the plow is pushed out of it', async () => {
    const { wo, run, plow } = await hearts();
    plow.position.set(-4, 0, 6);
    (wo as unknown as { shards(a: number): number }).shards(0);
    run(byAnger(WO.SHARD_TELE, 0) + 0.05);
    // drive into the shard's centre: next frame the plow is outside its body
    plow.position.set(-4, 0, 6);
    run(1 / 60);
    expect(Math.hypot(plow.position.x + 4, plow.position.z - 6)).toBeGreaterThan(0.9);
  });

  it('VORTEX ARM: the lane telegraph runs SWEEP_TELE s with no hit, then the column runs it and hits once', async () => {
    const { wo, run, plow, hits } = await hearts();
    plow.position.set(0, 0, 6);
    (wo as unknown as { sweep(a: number, w: number): number }).sweep(0, 0);
    run(WO.SWEEP_TELE - 0.05);
    expect(hits).toHaveLength(0);
    run(0.05 + WO.SWEEP_T + 0.1);
    expect(hits).toHaveLength(1);
  });

  it('GLARE: the eye charges first (no daze), then the spot chases the plow: caught = a short daze, once', async () => {
    const { wo, run, plow } = await hearts();
    plow.position.set(0, 0, 0);
    (wo as unknown as { glare(a: number): number }).glare(0);
    // the eye is open (and can be hit) while it glares
    run(1 / 60);
    expect(wo.eyeMode).toBe('open');
    run(WO.GLARE_CHARGE - 0.1);
    expect(plow.dazeT).toBe(0);
    run(WO.GLARE_T * 0.8);
    expect(plow.dazeT).toBe(WO.DAZE);
  });

  it('GUSTS: streaks build for GUST_TELE s before the push; no damage', async () => {
    const { wo, run, plow, hits } = await hearts();
    (wo as unknown as { gust(a: number): void }).gust(0.5);
    run(WO.GUST_TELE - 0.05);
    expect(plow.towed).toBe(0);
    run(0.6);
    expect(plow.towed).toBeGreaterThan(0);
    expect(hits).toHaveLength(0);
  });

  it('snow copies: weak white echoes that burst into powder (no boss toast), capped by anger', async () => {
    const { wo, mgr, ctx } = await hearts();
    const defeated: unknown[] = [];
    ctx.events.on('bossDefeated', (p) => defeated.push(p));
    (wo as unknown as { spawnCopy(): void }).spawnCopy();
    const c = mgr.bosses.find((b) => (b as Bot).snow) as Bot;
    expect(c).toBeTruthy();
    expect(c.echo).toBe(true);
    expect(c.maxHp).toBeLessThan(c.def.hp * 0.5);
    expect(c.dmgOutMult).toBe(WO.COPY_DMG);
    mgr.damage(c, 1e6, {});
    expect(c.alive).toBe(false);
    expect(defeated).toHaveLength(0);
  });

  it('a STAGGER calms the storm: telegraphs in flight vanish, the copies collapse', async () => {
    const { wo, run, mgr } = await hearts();
    const { whiteoutProps } = await import('../src/entities/enemies/whiteoutProps');
    (wo as unknown as { spawnCopy(): void }).spawnCopy();
    (wo as unknown as { shards(a: number): number }).shards(0);
    (wo as unknown as { sweep(a: number, w: number): number }).sweep(0, 0);
    for (const h of wo.hearts) mgr.damage(h, 1e6, {});
    run(0.05);
    expect(wo.phase).toBe('lean');
    expect(whiteoutProps.shardsLive).toBe(0);
    expect(whiteoutProps.lanesLive).toBe(0);
    expect(mgr.bosses.filter((b) => (b as Bot).snow)).toHaveLength(0);
  });
});
