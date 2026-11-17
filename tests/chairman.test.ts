import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { GameContext } from '../src/core/types';
import { Terrain } from '../src/world/Terrain';
import type { Bot } from '../src/entities/enemies/Bot';
import { ENEMIES } from '../src/config/enemies';
import { PROTOCOL_HP, CHAIRMAN_SPAWN, PROTOCOL_WAVES, headlineName, protocolBossHp, protocolRounds, protocolWaveZone, PROTOCOL_ZONE } from '../src/config/protocol';
import {
  BEAT_MAX_CHARS, CHAIRMAN_ACQUIRE, CHAIRMAN_INTRO, CHAIRMAN_KILL, CHAIRMAN_KILL_ANY, CHAIRMAN_KNOCKOFF, CHAIRMAN_LAST, CHAIRMAN_LOW_HP, CHAIRMAN_REVEAL,
  CHAIRMAN_TAUNTS,
} from '../src/config/lore';

/* PROTOCOL C build stage 3: THE CHAIRMAN (the model, the reveal, his moves and their telegraphs, HOSTILE TAKEOVER,
 * GOLDEN PARACHUTE, the defeat hook, ultimates hurt him) and his commentary from the box (rate limit, line lengths). */

const noop: unknown = new Proxy(() => noop, { get: () => noop, apply: () => noop });
beforeAll(() => {
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) });
});
afterAll(() => vi.unstubAllGlobals());

async function arena() {
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) });
  const { EnemyManager } = await import('../src/entities/Enemies');
  const phases: string[] = [];
  const defeated: string[] = [];
  const boardroom: string[] = [];
  const intros: string[] = [];
  const hits: number[] = [];
  const handlers = new Map<string, ((p: unknown) => void)[]>();
  const plow = {
    position: new THREE.Vector3(0, 0, 0), radius: 1.6, heldBallRadius: 0, dead: false, heading: 0, speed: 0, dashing: false, whirling: false, deck: -1,
    hp: 100, maxHp: 100, slowK: 1, slowT: 0, dazeT: 0,
    stealSnow: () => 0, tow: () => {}, push: () => {},
    slow(t: number, k: number) {
      this.slowT = t;
      this.slowK = k;
    },
    daze(t: number) {
      this.dazeT = t;
    },
  };
  const events = {
    emit: (name: string, p: { enemy: Bot; label?: string; name?: string }) => {
      if (name === 'bossPhase') phases.push(`${p.enemy.type}:${p.label}`);
      if (name === 'bossDefeated') defeated.push(p.enemy.type);
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
    pickups: { spawnCoins: () => {} },
    world: { obstacles: [] as unknown[], boardroom: (m: string) => boardroom.push(m), openGate: () => {} },
    ui: { bossIntro: (n: string) => intros.push(n), toast: () => {} },
  };
  const mgr = new EnemyManager(ctx as unknown as GameContext);
  (ctx as unknown as { enemies: unknown }).enemies = mgr;
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
  return { mgr, ctx, plow, phases, defeated, boardroom, intros, hits, run, boss };
}

/** A Chairman already on the floor (the reveal skipped: not a headline spawn), cooldowns parked. */
async function onFloor() {
  const a = await arena();
  const { chairmanState } = await import('../src/entities/enemies/chairman');
  const c = a.boss('chairman', 0, -12);
  a.run(1 / 60);
  const s = chairmanState(c);
  const park = () => {
    s.caseCd = s.reportCd = s.takeCd = s.wallCd = s.beamCd = s.rallyCd = 99;
  };
  park();
  return { ...a, c, s, park };
}

describe('the model', () => {
  it('is the tallest boss, carries its named animated parts, the parachute hidden until phase 2', async () => {
    await arena();
    const { createRig, CHAIRMAN_PART } = await import('../src/entities/enemies/models');
    const rig = createRig('chairman');
    for (const t of ['bulldoza', 'frostbyte', 'grinder', 'slush', 'sleet', 'omega', 'donald'] as const) expect(rig.height).toBeGreaterThan(createRig(t).height * 1.5);
    for (const n of Object.values(CHAIRMAN_PART)) expect(rig.root.getObjectByName(n), n).toBeTruthy();
    expect(rig.root.getObjectByName(CHAIRMAN_PART.chute)!.visible).toBe(false);
    // merged static parts (a handful of meshes per group) and a shadow proxy
    let meshes = 0;
    let proxies = 0;
    rig.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
      if (o.name === 'shadowProxy') proxies++;
    });
    expect(meshes).toBeLessThan(60);
    expect(proxies).toBeGreaterThan(0);
    // cached template: a second rig shares the geometry
    const rig2 = createRig('chairman');
    const g1 = (rig.body.children.find((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh).geometry;
    const g2 = (rig2.body.children.find((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh).geometry;
    expect(g1).toBe(g2);
  });

  it('its materials are in the warm-up set (no mid-fight shader compiles)', async () => {
    const { mgr } = await arena();
    const { chairmanProps } = await import('../src/entities/enemies/chairmanProps');
    const scene = new THREE.Scene();
    chairmanProps.prewarm(scene);
    expect(chairmanProps.warmMeshes().length).toBe(5);
    // the warm set carries a spare Chairman rig: its window glass (map + emissive map) and skirt materials included
    const { createRig } = await import('../src/entities/enemies/models');
    const live = new Set<THREE.Material>();
    createRig('chairman').root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) live.add((o as THREE.Mesh).material as THREE.Material);
    });
    const warm = new Set(mgr.warmSet().map((o) => (o as THREE.Mesh).material as THREE.Material));
    const shared = [...live].filter((m) => !(m as THREE.MeshStandardMaterial).userData?.inst);
    expect(shared.length).toBeGreaterThan(10);
    for (const m of shared) expect(warm.has(m), m.type).toBe(true);
  });
});

describe('wave 7', () => {
  it('THE CHAIRMAN replaces the stand-in: the headline, landing under his box, the run\'s toughest boss', () => {
    const r = protocolRounds()[PROTOCOL_WAVES - 1];
    const head = r.groups.filter((g) => !g.echo);
    expect(head.map((g) => g.type)).toEqual(['chairman']);
    expect(head[0].headline).toBe(true);
    expect(head[0].at).toEqual(CHAIRMAN_SPAWN);
    expect(head[0].delay).toBe(0);
    expect(r.groups.filter((g) => g.echo)).toHaveLength(7);
    expect(headlineName(7)).toBe('THE CHAIRMAN');
    expect(protocolWaveZone(PROTOCOL_ZONE, 7).bossName).toBe('THE CHAIRMAN');
    const net = ENEMIES.chairman.hp * protocolBossHp('chairman', false);
    expect(net).toBeCloseTo(PROTOCOL_HP.chairman);
    for (const t of ['frostbyte', 'bulldoza', 'grinder', 'slush', 'donald', 'omega'] as const) expect(net).toBeGreaterThan(ENEMIES[t].hp * protocolBossHp(t, false));
  });

  it('the reveal: the box detaches, he descends untouchable, lands with a shockwave and his intro card', async () => {
    const { boss, run, boardroom, intros, mgr, hits, plow } = await arena();
    const { CH, CHAIRMAN_LAND } = await import('../src/entities/enemies/chairman');
    plow.position.set(CHAIRMAN_LAND.x, 0, CHAIRMAN_LAND.z + 4);
    const c = boss('chairman', CHAIRMAN_SPAWN.x, CHAIRMAN_SPAWN.z, { headline: true });
    run(0.1);
    expect(boardroom).toContain('gone');
    expect(c.state).toBe('reveal');
    expect(c.scripted).toBe(true);
    expect(c.hoverY).toBeGreaterThan(3);
    const hp = c.hp;
    mgr.damage(c, 500, {});
    expect(c.hp).toBe(hp);
    run(CH.REVEAL_T);
    expect(c.scripted).toBe(false);
    expect(c.hoverY).toBe(0);
    expect(intros).toContain('THE CHAIRMAN');
    expect(hits.length).toBeGreaterThan(0); // the plow stood in the landing ring
    mgr.damage(c, 500, {});
    expect(c.hp).toBeLessThan(hp);
  });
});

describe('moves', () => {
  it('scheduling (ties): rally > takeover > restructuring > reports > deportation > briefcases > shove', async () => {
    const { pickMove, chairmanState, CH } = await import('../src/entities/enemies/chairman');
    const s = chairmanState({} as Bot);
    const o = { hpFrac: 1, dist: 20, reach: 6, echo: true, wallsUp: false, storm: false, beam: false };
    const all = () => {
      s.caseCd = s.reportCd = s.takeCd = s.wallCd = s.beamCd = s.rallyCd = 0;
    };
    all();
    // the first rally waits until he is hurt
    expect(pickMove(s, o)).toBe('takeover');
    expect(pickMove(s, { ...o, hpFrac: CH.RALLY_AT - 0.01 })).toBe('rally');
    s.rallyCd = 5;
    expect(pickMove(s, { ...o, echo: false })).toBe('restructure');
    expect(pickMove(s, { ...o, echo: false, wallsUp: true })).toBe('reports');
    expect(pickMove(s, { ...o, echo: false, wallsUp: true, storm: true })).toBe('beam');
    expect(pickMove(s, { ...o, echo: false, wallsUp: true, storm: true, beam: true })).toBe('cases');
    s.caseCd = 1;
    expect(pickMove(s, { ...o, echo: false, wallsUp: true, storm: true, beam: true })).toBe(null);
    expect(pickMove(s, { ...o, echo: false, wallsUp: true, storm: true, beam: true, dist: 3 })).toBe('shove');
  });

  it('scheduling: a ready BRIEFCASE CANNON goes right after a big move (the big cooldowns never starve it)', async () => {
    const { pickMove, chairmanState } = await import('../src/entities/enemies/chairman');
    const s = chairmanState({} as Bot);
    const o = { hpFrac: 1, dist: 20, reach: 6, echo: true, wallsUp: false, storm: false, beam: false };
    s.caseCd = s.reportCd = s.takeCd = s.wallCd = s.beamCd = 0;
    s.rallyCd = 99;
    s.last = 'takeover';
    expect(pickMove(s, o)).toBe('cases');
    s.last = 'cases';
    expect(pickMove(s, o)).toBe('takeover');
    s.last = 'restructure';
    s.caseCd = 2;
    expect(pickMove(s, o)).toBe('takeover');
    // the big move ready the longest goes first (no fixed order starving DEPORTATION)
    s.beamCd = -6;
    s.reportCd = -2;
    expect(pickMove(s, o)).toBe('beam');
    s.beamCd = 4;
    expect(pickMove(s, o)).toBe('reports');
  });

  it('BRIEFCASE CANNON: rings show at once, the cases land after wind-up + flight and daze a plow inside', async () => {
    const { c, s, run, plow, hits } = await onFloor();
    const { CH } = await import('../src/entities/enemies/chairman');
    const { chairmanProps } = await import('../src/entities/enemies/chairmanProps');
    plow.position.set(0, 0, 6);
    c.cd = 0;
    s.caseCd = 0;
    run(2 / 60);
    expect(c.state).toBe('caseWind');
    expect(c.stateDur).toBeCloseTo(CH.CASE_WIND, 5);
    expect(chairmanProps.casesLive).toBe(2);
    hits.length = 0;
    run(CH.CASE_WIND + CH.CASE_FLIGHT - 0.15);
    expect(hits.length).toBe(0); // nothing lands before its ring has filled
    run(0.3);
    expect(hits.length).toBeGreaterThan(0);
    expect(plow.dazeT).toBeGreaterThan(0);
    // the second shot follows
    expect(chairmanProps.casesLive).toBeGreaterThan(0);
    run(CH.CASE_GAP + CH.CASE_FLIGHT + 0.2);
    expect(chairmanProps.casesLive).toBe(0);
  });

  it('QUARTERLY REPORTS: a telegraphed storm that scrambles the map and slows the plow inside it', async () => {
    const { c, s, run, plow } = await onFloor();
    const { CH } = await import('../src/entities/enemies/chairman');
    const { chairmanProps } = await import('../src/entities/enemies/chairmanProps');
    plow.position.set(4, 0, 8);
    c.cd = 0;
    s.reportCd = 0;
    run(2 / 60);
    expect(c.state).toBe('reportWind');
    expect(chairmanProps.stormActive).toBe(true);
    run(CH.REPORT_WIND - 0.1);
    expect(chairmanProps.scramble).toBe(0);
    expect(plow.slowT).toBe(0);
    run(0.6);
    expect(chairmanProps.scramble).toBeGreaterThan(0.5);
    expect(plow.slowK).toBeCloseTo(CH.REPORT_SLOW);
    run(CH.REPORT_T + 1);
    expect(chairmanProps.stormActive).toBe(false);
  });

  it('HOSTILE TAKEOVER: the finger beams an echo; gold armour + speed until broken by damage or timed out', async () => {
    const { c, s, run, boss, mgr, park } = await onFloor();
    const { CH } = await import('../src/entities/enemies/chairman');
    const echo = boss('grinder', 10, 4, { echo: true });
    c.cd = 0;
    s.takeCd = 0;
    run(2 / 60);
    expect(c.state).toBe('takeWind');
    expect(c.stateDur).toBeCloseTo(CH.TAKE_WIND, 5);
    expect(echo.acquired).toBe(0);
    run(CH.TAKE_WIND);
    park();
    expect(echo.acquired).toBeGreaterThan(0);
    expect(echo.guardMult).toBe(CH.TAKE_ARMOR);
    expect(echo.spdMult).toBe(CH.TAKE_SPEED);
    // armour: half damage
    const hp0 = echo.hp;
    mgr.damage(echo, 40 + ENEMIES.grinder.armor, {});
    expect(hp0 - echo.hp).toBeCloseTo(40 * CH.TAKE_ARMOR, 5);
    // break it: TAKE_BREAK of its max HP off
    mgr.damage(echo, (echo.maxHp * CH.TAKE_BREAK) / CH.TAKE_ARMOR + 20, {});
    run(2 / 60);
    expect(echo.acquired).toBe(0);
    expect(echo.guardMult).toBe(1);
    expect(echo.spdMult).toBe(1);
    expect(echo.stun).toBeGreaterThan(0);
    // and the timeout
    const e2 = boss('frostbyte', -10, 4, { echo: true });
    mgr.dismiss(echo);
    c.cd = 0;
    s.takeCd = 0;
    c.set('approach', 0);
    run(CH.TAKE_WIND + 0.1);
    park();
    expect(e2.acquired).toBeGreaterThan(0);
    run(CH.TAKE_T + 0.2, () => {
      e2.hp = e2.maxHp;
    });
    expect(e2.acquired).toBe(0);
    expect(e2.guardMult).toBe(1);
  });

  it('RESTRUCTURING: rows of gold partitions across the arena (DonaldProps walls, owned by him)', async () => {
    const { c, s, run, ctx } = await onFloor();
    const { CH } = await import('../src/entities/enemies/chairman');
    const { donaldProps } = await import('../src/entities/enemies/donaldProps');
    c.cd = 0;
    s.wallCd = 0;
    run(2 / 60);
    expect(c.state).toBe('wallWind');
    const segs = (donaldProps as unknown as { segs: { gold: boolean; k: number }[] }).segs;
    expect(segs.length).toBeGreaterThan(30);
    expect(segs.every((g) => g.gold)).toBe(true);
    run(CH.WALL_TELE + 0.6);
    expect(segs.some((g) => g.k > 0.9)).toBe(true);
    donaldProps.clear(ctx as unknown as GameContext);
  });
});

describe('phase 2 and the end', () => {
  it('GOLDEN PARACHUTE at half HP: the canopy pops, he reflects damage and moves faster', async () => {
    const { c, run, phases } = await onFloor();
    const { CH } = await import('../src/entities/enemies/chairman');
    const { CHAIRMAN_PART } = await import('../src/entities/enemies/models');
    expect(c.reflect).toBe(0);
    c.hp = c.maxHp * (CH.PHASE2 + 0.01);
    run(0.2);
    expect(phases).toEqual([]);
    c.hp = c.maxHp * (CH.PHASE2 - 0.01);
    run(0.6);
    expect(phases).toEqual(['chairman:GOLDEN PARACHUTE!']);
    // reflection only in GOLD PLATED windows: open at first, then a warning, then plated, then open again
    expect(c.reflect).toBe(0);
    run(3 + CH.PLATE_WARN + 0.1);
    expect(c.reflect).toBe(CH.CHUTE_REFLECT);
    run(CH.PLATE_ON);
    expect(c.reflect).toBe(0);
    expect(c.enraged).toBe(true);
    expect(c.rig.root.getObjectByName(CHAIRMAN_PART.chute)!.visible).toBe(true);
  });

  it('GOLD PLATED reflection is capped at REFLECT_CAP of max HP per batch, whatever the burst and damage scaling', async () => {
    const { c, s, mgr, run, hits, ctx, park } = await onFloor();
    const { REFLECT_CAP, REFLECT_EVERY } = await import('../src/entities/enemies/donaldProps');
    (ctx.zone as { enemyDmgMult: number }).enemyDmgMult = 3;
    c.hp = c.maxHp * 0.49;
    run(0.2);
    park();
    s.plate = 1;
    s.plateT = 0;
    run(0.1);
    expect(c.reflect).toBeGreaterThan(0);
    hits.length = 0;
    mgr.damage(c, c.maxHp * 0.3);
    run(REFLECT_EVERY * 2 + 0.05, () => park());
    const total = hits.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(REFLECT_CAP * 100 * 3 * 1.0001);
    for (const h of hits) expect(h).toBeLessThanOrEqual(REFLECT_CAP * 100 * 1.0001);
  });

  it('no reflection after the killing blow (the defeat scene)', async () => {
    const { c, s, mgr, run, hits, park } = await onFloor();
    c.hp = c.maxHp * 0.49;
    run(0.2);
    park();
    s.plate = 1;
    s.plateT = 0;
    run(0.1);
    expect(c.reflect).toBeGreaterThan(0);
    hits.length = 0;
    mgr.damage(c, c.maxHp);
    run(1.5, () => park());
    expect(c.state).toBe('defeat');
    expect(hits).toEqual([]);
  });

  it('ultimates hurt him like any boss (and his echoes)', async () => {
    const { c, mgr, boss } = await onFloor();
    const hp = c.hp;
    mgr.damage(c, 500, { ult: true });
    expect(c.hp).toBeLessThan(hp);
    const e = boss('bulldoza', 10, 10, { echo: true });
    const eh = e.hp;
    mgr.damage(e, 100, { ult: true });
    expect(e.hp).toBeLessThan(eh);
  });

  it('defeat: at 0 HP he sags and slams PROTOCOL C (the echoes freeze), then wrecks: the stage-4 hook', async () => {
    const { c, mgr, run, defeated, boss } = await onFloor();
    const { CH, chairmanState } = await import('../src/entities/enemies/chairman');
    const e = boss('omega', 12, 12, { echo: true });
    expect(mgr.damage(c, 1e9, {})).toBe(false);
    expect(c.alive).toBe(true);
    expect(c.state).toBe('defeat');
    expect(c.scripted).toBe(true);
    expect(e.stun).toBeGreaterThan(CH.DEFEAT_T);
    run(CH.DEFEAT_PRESS + 0.1);
    expect(chairmanState(c).pressed).toBe(true);
    expect(c.alive).toBe(true);
    expect(defeated).toEqual([]);
    run(CH.DEFEAT_T - CH.DEFEAT_PRESS + 0.1);
    expect(c.alive).toBe(false);
    expect(defeated).toEqual(['chairman']);
  });
});

describe('commentary', () => {
  function director() {
    const toasts: string[] = [];
    const handlers = new Map<string, ((p: unknown) => void)[]>();
    const events = {
      emit: (name: string, p: unknown) => {
        for (const f of handlers.get(name) ?? []) f(p);
      },
      on: (name: string, f: (p: unknown) => void) => {
        handlers.set(name, [...(handlers.get(name) ?? []), f]);
        return () => {};
      },
    };
    const dismissed: unknown[] = [];
    let cancelled = 0;
    const bosses: { type: string; echo: boolean; alive: boolean }[] = [];
    const minions: { type: string; echo: boolean; alive: boolean }[] = [];
    const ctx = {
      events,
      ui: { toast: (t: string, k: string) => k === 'chairman' && toasts.push(t) },
      world: { boardroom: () => {} },
      cameraRig: { cinematic: () => {} },
      plow: { hp: 100, maxHp: 100, dead: false },
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
    return { ctx, events, toasts, dismissed, bosses, minions, cancelled: () => cancelled };
  }

  it('every line fits the toast (BEAT_MAX_CHARS); every wave has an intro, every boss an acquire + a kill line', () => {
    const lines = [
      ...Object.values(CHAIRMAN_INTRO), CHAIRMAN_KNOCKOFF, ...Object.values(CHAIRMAN_ACQUIRE), ...Object.values(CHAIRMAN_KILL), ...CHAIRMAN_KILL_ANY,
      ...CHAIRMAN_LOW_HP, CHAIRMAN_REVEAL, ...CHAIRMAN_TAUNTS, CHAIRMAN_LAST,
    ];
    for (const l of lines) expect(l.length, l).toBeLessThanOrEqual(BEAT_MAX_CHARS);
    for (let w = 1; w <= PROTOCOL_WAVES; w++) expect(CHAIRMAN_INTRO[w]).toBeTruthy();
    for (const t of ['frostbyte', 'bulldoza', 'grinder', 'slush', 'sleet', 'donald', 'omega']) {
      expect(CHAIRMAN_ACQUIRE[t]).toBeTruthy();
      expect(CHAIRMAN_KILL[t]).toBeTruthy();
    }
    expect(CHAIRMAN_KNOCKOFF).toContain('very low-energy copy, honestly sad');
    expect(CHAIRMAN_ACQUIRE.frostbyte).toBe('Welcome to the team, FROSTBYTE.');
  });

  it('is rate-limited: the intro goes out, then at most one line per COMMENT_GAP (one waiting, newest wins)', async () => {
    const { ChairmanDirector, COMMENT_GAP, CHAIRMAN_PREFIX } = await import('../src/core/chairmanDirector');
    const { ctx, events, toasts } = director();
    const d = new ChairmanDirector(ctx as unknown as GameContext);
    d.begin(4);
    expect(toasts).toEqual([CHAIRMAN_PREFIX + CHAIRMAN_INTRO[4]]);
    // three echoes walk in within the gap: nothing more is said now
    for (const type of ['frostbyte', 'bulldoza', 'grinder']) events.emit('bossSpawned', { enemy: { type, echo: true } });
    expect(toasts).toHaveLength(1);
    for (let t = 0; t < COMMENT_GAP - 0.5; t += 0.1) d.update(0.1);
    expect(toasts).toHaveLength(1);
    d.update(0.6);
    expect(toasts).toHaveLength(2);
    expect(toasts[1]).toBe(CHAIRMAN_PREFIX + CHAIRMAN_ACQUIRE.grinder);
    // over a long wave with a stream of events: never two lines closer than the gap
    const at: number[] = [];
    let time = 0;
    let n = toasts.length;
    for (let i = 0; i < 600; i++) {
      if (i % 7 === 0) events.emit('bossDefeated', { enemy: { type: 'omega', echo: true } });
      d.update(0.1);
      time += 0.1;
      if (toasts.length > n) {
        n = toasts.length;
        at.push(time);
      }
    }
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(COMMENT_GAP - 1e-6);
  });

  it('wave 5 calls out the knock-off; low HP gets one line a wave', async () => {
    const { ChairmanDirector, COMMENT_GAP, CHAIRMAN_PREFIX } = await import('../src/core/chairmanDirector');
    const { ctx, events, toasts } = director();
    const d = new ChairmanDirector(ctx as unknown as GameContext);
    d.begin(5);
    events.emit('bossSpawned', { enemy: { type: 'donald', headline: true } });
    for (let t = 0; t < COMMENT_GAP + 0.2; t += 0.1) d.update(0.1);
    expect(toasts[1]).toBe(CHAIRMAN_PREFIX + CHAIRMAN_KNOCKOFF);
    ctx.plow.hp = 20;
    events.emit('plowDamaged', { amount: 5 });
    events.emit('plowDamaged', { amount: 5 });
    for (let t = 0; t < COMMENT_GAP * 3; t += 0.1) d.update(0.1);
    expect(toasts.filter((t) => CHAIRMAN_LOW_HP.some((l) => t.endsWith(l)))).toHaveLength(1);
  });

  it('the reveal plays on wave 7; THE CHAIRMAN\'s wreck powers the echoes down and ends the wave (the stage-4 hook)', async () => {
    const { ChairmanDirector, REVEAL_LINE, CHAIRMAN_PREFIX } = await import('../src/core/chairmanDirector');
    const { ctx, events, toasts, dismissed, bosses, minions, cancelled } = director();
    const d = new ChairmanDirector(ctx as unknown as GameContext);
    d.begin(7);
    expect(d.revealing).toBe(true);
    for (let t = 0; t < REVEAL_LINE + 0.2; t += 0.1) d.update(0.1);
    expect(toasts).toEqual([CHAIRMAN_PREFIX + CHAIRMAN_INTRO[7], CHAIRMAN_PREFIX + CHAIRMAN_REVEAL]);
    d.fight();
    expect(d.revealing).toBe(false);
    // in the fight he talks through his own labels: echoes arriving say nothing on the radio
    events.emit('bossSpawned', { enemy: { type: 'frostbyte', echo: true } });
    for (let t = 0; t < 10; t += 0.1) d.update(0.1);
    expect(toasts).toHaveLength(2);
    bosses.push({ type: 'omega', echo: true, alive: true }, { type: 'grinder', echo: true, alive: true });
    // a leftover rally bot must not hold the wave (and the victory) open
    minions.push({ type: 'rallybot', echo: false, alive: true });
    events.emit('bossDefeated', { enemy: { type: 'chairman', echo: false } });
    expect(d.chairmanDown).toBe(true);
    expect(dismissed).toHaveLength(3);
    expect(minions[0].alive).toBe(false);
    expect(cancelled()).toBe(1);
  });
});
