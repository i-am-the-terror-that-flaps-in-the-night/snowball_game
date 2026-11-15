import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { GameContext } from '../src/core/types';
import { Terrain } from '../src/world/Terrain';
import { AV, END, END_AT, EYE_DOWN, WO, ballFrac, ballFull, ballGrow } from '../src/config/whiteout';
import { protocolZone } from '../src/config/protocol';

/* PROTOCOL C build stage 4 (part B): THE AVALANCHE and THE IMPLOSION. SnowField.dump, the giant snowball's rules and
 * physics (push, growth, the size threshold, burst and retry, debris), and the ending's sequencing into the victory. */

const noop: unknown = new Proxy(() => noop, { get: () => noop, apply: () => noop });
beforeAll(() => {
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) });
});
afterAll(() => vi.unstubAllGlobals());

/* ------------------------------------------------------------------ SnowField.dump */

describe('SnowField.dump (the storm buries the arena)', () => {
  async function field() {
    const { SnowField } = await import('../src/world/SnowField');
    const zone = protocolZone();
    const terrain = new Terrain(zone.terrain);
    const ctx = { scene: new THREE.Scene(), zone, terrain, stats: { snowRegen: 0.05 } } as unknown as GameContext;
    const snow = new SnowField(ctx);
    snow.reset(zone);
    return { snow, terrain, zone };
  }

  it('adds the depth everywhere snow lies (with a gentle drift), never on lava; ice is buried whole', async () => {
    const { snow, terrain } = await field();
    // a plain spot, a lava spot and an ice spot of the PROTOCOL floor
    let lava: { x: number; z: number } | null = null;
    let ice: { x: number; z: number } | null = null;
    for (const p of terrain.patches) {
      if (p.material === 'lava' && !lava) lava = { x: p.x, z: p.z };
      if (p.material === 'ice' && !ice) ice = { x: p.x, z: p.z };
    }
    const plain = { x: 2, z: 14 };
    expect(terrain.materialAt(plain.x, plain.z)).toBe('snow');
    const d0 = snow.getDepth(plain.x, plain.z);
    const ice0 = ice ? snow.getDepth(ice.x, ice.z) : 0;
    const added = snow.dump(0.6);
    expect(added).toBeGreaterThan(0);
    const d1 = snow.getDepth(plain.x, plain.z);
    expect(d1 - d0).toBeGreaterThan(0.6 * 0.85);
    expect(d1 - d0).toBeLessThan(0.6 * 1.15);
    if (lava) expect(snow.getDepth(lava.x, lava.z)).toBe(0);
    if (ice) expect(snow.getDepth(ice.x, ice.z) - ice0).toBeGreaterThan(0.5);
    // the snow meter rebases: 100% = buried
    expect(snow.totalSnowFraction()).toBeCloseTo(1, 5);
  });

  it('the new depth is the level regen refills to (and never above); steps add up', async () => {
    const { snow } = await field();
    const d0 = snow.getDepth(-3, 18);
    snow.dump(0.3);
    snow.dump(0.3);
    const full = snow.getDepth(-3, 18);
    expect(full - d0).toBeGreaterThan(0.5);
    snow.collectDisc(-3, 18, 2, 1);
    expect(snow.getDepth(-3, 18)).toBeLessThan(0.05);
    for (let i = 0; i < 400; i++) snow.update(0.25);
    expect(snow.getDepth(-3, 18)).toBeCloseTo(full, 3);
  });
});

/* ------------------------------------------------------------------ the rules */

describe('the giant snowball rules (config/whiteout.ts)', () => {
  it('grows rolling through snow (more on deeper snow, nothing on bare ground), slower as it grows, capped', () => {
    expect(ballGrow(2, 1, 0)).toBe(2);
    expect(ballGrow(2, 0, 1)).toBe(2);
    expect(ballGrow(2, 1, 1)).toBeGreaterThan(ballGrow(2, 1, 0.3));
    expect(ballGrow(2, 1, 0.3)).toBeGreaterThan(2);
    // a bigger ball needs more snow per cm
    expect(ballGrow(3, 1, 1) - 3).toBeLessThan(ballGrow(AV.START_R, 1, 1) - AV.START_R);
    expect(ballGrow(AV.MAX_R, 5, 1)).toBe(AV.MAX_R);
    // START_R -> FULL_R takes a real roll on buried snow (a lap or two of the arena), not a few metres
    let r = AV.START_R;
    let m = 0;
    while (!ballFull(r) && m < 1000) {
      r = ballGrow(r, 0.5, 1.1);
      m += 0.5;
    }
    expect(m).toBeGreaterThan(40);
    expect(m).toBeLessThan(110);
  });

  it('the HUD meter runs 0..1 from START_R to FULL_R; full only at FULL_R', () => {
    expect(ballFrac(AV.START_R)).toBe(0);
    expect(ballFrac(AV.FULL_R)).toBe(1);
    expect(ballFrac(AV.MAX_R)).toBe(1);
    expect(ballFull(AV.FULL_R - 0.01)).toBe(false);
    expect(ballFull(AV.FULL_R)).toBe(true);
    expect(AV.MIN_R).toBeLessThan(AV.START_R);
  });

  it('the ending beats run in order and end at END_AT.done', () => {
    expect(END_AT.suck).toBe(END.CRACK_T);
    expect(END_AT.implode).toBeGreaterThan(END_AT.suck);
    expect(END_AT.silence).toBeGreaterThan(END_AT.implode);
    expect(END_AT.lights).toBeGreaterThan(END_AT.silence);
    expect(END_AT.done).toBeGreaterThan(END_AT.lights + END.LIGHTS_T);
  });
});

/* ------------------------------------------------------------------ the ball */

async function ballArena(depth = 1.1) {
  const { GiantSnowball } = await import('../src/entities/GiantSnowball');
  const collected: number[] = [];
  const added: number[] = [];
  const plow = { position: new THREE.Vector3(0, 0, 10), radius: 1.6, heading: Math.PI, speed: 0, dead: false };
  const ctx = {
    scene: new THREE.Scene(), fx: noop, audio: noop, plow, stats: { maxSpeed: 12 },
    terrain: new Terrain(),
    snow: {
      getDepth: () => depth,
      topAt: () => depth,
      collectDisc: (_x: number, _z: number, _r: number, f: number) => (collected.push(f), f),
      addSnow: (_x: number, _z: number, _r: number, v: number) => added.push(v),
    },
    world: { obstacles: [] as { x: number; z: number; r: number; breakable?: boolean }[], breakObstacle: () => true },
  };
  const ball = new GiantSnowball(ctx as unknown as GameContext);
  ball.prewarm(ctx.scene);
  const spawned: { x: number; z: number }[] = [];
  const spawnAt = (o: { x: number; z: number }) => {
    o.x = 0;
    o.z = 0;
    spawned.push({ ...o });
  };
  const run = (sec: number, each?: () => void) => {
    for (let t = 0; t < sec - 1e-9; t += 1 / 60) {
      each?.();
      ball.update(1 / 60, spawnAt);
    }
  };
  return { ball, ctx, plow, run, collected, added, spawned };
}

describe('GiantSnowball (entities/GiantSnowball.ts)', () => {
  it('ANY plow pushes it: contact gives it the closing speed along the contact line, and it rolls clear', async () => {
    const { ball, plow, run } = await ballArena();
    ball.spawn(0, 0);
    run(AV.FORM_T + 0.05);
    // a plow driving north (heading PI = -z) into it from the south
    plow.position.set(0, 0, ball.r + plow.radius * 0.8);
    plow.speed = 10;
    run(1 / 60);
    expect(ball.pushed).toBe(true);
    expect(ball.vz).toBeLessThan(-8);
    expect(Math.abs(ball.vx)).toBeLessThan(0.5);
    const z0 = ball.z;
    plow.speed = 0;
    plow.position.set(0, 0, 20);
    run(0.5);
    expect(ball.z).toBeLessThan(z0 - 2);
    // ... and slows down by itself (drag)
    const v = Math.hypot(ball.vx, ball.vz);
    run(2);
    expect(Math.hypot(ball.vx, ball.vz)).toBeLessThan(v * 0.5);
  });

  it('a plow pushing from the side sends it sideways (the contact normal), leaning toward the heading', async () => {
    const { ball, plow, run } = await ballArena();
    ball.spawn(0, 0);
    run(AV.FORM_T + 0.05);
    // from the west, driving east (heading PI/2 = +x)
    plow.heading = Math.PI / 2;
    plow.position.set(-(ball.r + plow.radius * 0.8), 0, 0);
    plow.speed = 8;
    run(1 / 60);
    expect(ball.vx).toBeGreaterThan(6);
  });

  it('grows as it rolls through snow (scooping a trench), not on bare ground', async () => {
    const deep = await ballArena(1.1);
    deep.ball.spawn(0, 0);
    deep.run(AV.FORM_T + 0.05);
    deep.ball.vz = -8;
    deep.run(1.5);
    expect(deep.ball.r).toBeGreaterThan(AV.START_R + 0.1);
    expect(deep.ball.rolled).toBeGreaterThan(5);
    expect(deep.collected.length).toBeGreaterThan(10);
    const bare = await ballArena(0);
    bare.ball.spawn(0, 0);
    bare.run(AV.FORM_T + 0.05);
    bare.ball.vz = -8;
    bare.run(1.5);
    expect(bare.ball.r).toBe(AV.START_R);
  });

  it('gusts push it', async () => {
    const { ball, run } = await ballArena();
    ball.spawn(0, 0);
    run(AV.FORM_T + 0.05);
    ball.wind.x = 4;
    run(1);
    expect(ball.vx).toBeGreaterThan(1);
    expect(ball.x).toBeGreaterThan(0.5);
  });

  it('shards chip it (inside the ring only); too small, it bursts into powder and a new ball forms', async () => {
    const { ball, run, added, spawned } = await ballArena();
    ball.spawn(0, 0);
    run(AV.FORM_T + 0.05);
    const r0 = ball.r;
    ball.chip(30, 30);
    expect(ball.r).toBe(r0);
    ball.chip(1, 0);
    expect(ball.r).toBeCloseTo(r0 - AV.CHIP, 6);
    let n = 0;
    while (ball.active && n++ < 20) ball.chip(ball.x, ball.z);
    expect(ball.active).toBe(false);
    expect(ball.bursts).toBe(1);
    expect(added.length).toBe(1); // its snow back on the floor
    run(AV.RESPAWN_T - 0.2);
    expect(ball.active).toBe(false);
    run(0.4);
    expect(spawned.length).toBe(1);
    expect(ball.active).toBe(true);
    expect(ball.r).toBe(AV.START_R);
  });

  it('into the eye: too small = it bursts (onHit(false)); full size = onHit(true) and it stays', async () => {
    const a = await ballArena();
    const hits: boolean[] = [];
    a.ball.onHit = (f) => hits.push(f);
    a.ball.target = { x: 0, z: -20, r: 3.4 };
    a.ball.spawn(0, -14);
    a.run(AV.FORM_T + 0.05);
    a.ball.vz = -6;
    a.run(1);
    expect(hits).toEqual([false]);
    expect(a.ball.active).toBe(false);
    expect(a.ball.bursts).toBe(1);
    const b = await ballArena();
    const hits2: boolean[] = [];
    b.ball.onHit = (f) => hits2.push(f);
    b.ball.target = { x: 0, z: -20, r: 3.4 };
    b.ball.spawn(0, -8);
    b.run(AV.FORM_T + 0.05);
    b.ball.r = AV.FULL_R;
    b.ball.vz = -6;
    b.run(1.5);
    expect(hits2[0]).toBe(true);
    expect(b.ball.bursts).toBe(0);
  });

  it('picks up the wreckage it rolls over (THE CHAIRMAN\'s cap among it); it drops it all when it bursts', async () => {
    const { ball, run } = await ballArena();
    ball.begin();
    // the cap lies at (2.5, -22): roll the ball over it
    ball.spawn(2.5, -16);
    run(AV.FORM_T + 0.05);
    ball.vz = -6;
    run(1.5);
    expect(ball.stuck).toBeGreaterThanOrEqual(1);
    ball.burst('test');
    expect(ball.stuck).toBe(0);
  });

  it('walls stop it (it stays inside the arena)', async () => {
    const { ball, run } = await ballArena();
    ball.spawn(20, 0);
    run(AV.FORM_T + 0.05);
    ball.vx = 30;
    run(1);
    expect(ball.x + ball.r * 0.9).toBeLessThanOrEqual(30 + 1e-6);
  });
});

/* ------------------------------------------------------------------ the director */

async function director() {
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) });
  const { EnemyManager } = await import('../src/entities/Enemies');
  const { WhiteoutDirector } = await import('../src/core/whiteoutDirector');
  const dumps: number[] = [];
  const sky: [number, boolean | undefined][] = [];
  const toasts: string[] = [];
  const hud: boolean[] = [];
  const plow = {
    position: new THREE.Vector3(0, 0, 18), radius: 1.6, dead: false, heading: Math.PI, speed: 0, dashing: false, whirling: false, deck: -1,
    hp: 100, maxHp: 100, heldBallRadius: 0, cinematic: false, stealSnow: () => 0, push: () => {}, tow: () => {}, daze: () => {},
  };
  const ctx = {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), fx: noop, audio: noop, impact: noop, cameraRig: noop,
    events: { emit: () => {}, on: () => () => {} }, plow, stats: { plowKind: 'classic', maxSpeed: 12 },
    combat: { hitPlow: () => 0, playerRam: () => {} },
    zone: { enemyHpMult: 1, coinMult: 1, enemyDmgMult: 1, theme: 'protocol', maxActiveBosses: 4 },
    terrain: new Terrain(),
    snow: {
      getDepth: () => 1.1, topAt: () => 1.1, collectDisc: () => 0, addSnow: () => {},
      dump: (d: number) => (dumps.push(d), d),
    },
    pickups: { spawnCoins: () => {} },
    world: {
      obstacles: [] as unknown[], boardroom: () => {}, openGate: () => {}, breakObstacle: () => false,
      whiteoutSky: (k: number, g?: boolean) => sky.push([k, g]), whiteoutBury: () => {},
    },
    ui: { bossIntro: () => {}, toast: (t: string) => toasts.push(t), setHudVisible: (v: boolean) => hud.push(v) },
    waves: { remaining: 0 },
  };
  const mgr = new EnemyManager(ctx as unknown as GameContext);
  (ctx as unknown as { enemies: unknown }).enemies = mgr;
  const wo = new WhiteoutDirector(ctx as unknown as GameContext);
  const run = (sec: number) => {
    for (let t = 0; t < sec - 1e-9; t += 1 / 60) {
      mgr.update(1 / 60);
      wo.update(1 / 60);
    }
  };
  // past the takeover, its own attacks parked; then THE AVALANCHE
  wo.start([], true);
  run(WO.HEARTS_AT + 0.05);
  const w = wo as unknown as { attackT: number; gustT: number; copyT: number; eyeT: number };
  w.attackT = w.gustT = w.copyT = w.eyeT = 1e9;
  return { wo, mgr, ctx, plow, run, dumps, sky, toasts, hud };
}

describe('THE AVALANCHE (core/whiteoutDirector.ts)', () => {
  it('the storm dumps its snow over DUMP_T s, the eye comes down onto the stand front sealed (only the ball), a ball forms', async () => {
    const { wo, run, dumps, mgr } = await director();
    const eye = wo.eye!;
    wo.startAvalanche();
    expect(wo.phase).toBe('avalanche');
    expect(wo.holding).toBe(true);
    expect(wo.ballHud).toBeNull();
    run(AV.DUMP_T + 0.1);
    expect(dumps.reduce((a, b) => a + b, 0)).toBeCloseTo(AV.DUMP, 6);
    run(AV.DESCEND_T - AV.DUMP_T + 0.2);
    expect(eye.position.x).toBeCloseTo(EYE_DOWN.x, 3);
    expect(eye.position.z).toBeCloseTo(EYE_DOWN.z, 3);
    expect(eye.scripted).toBe(true);
    expect(eye.immuneLabel).toBeTruthy();
    const hp = eye.hp;
    mgr.damage(eye, 1e6, {});
    expect(eye.hp).toBe(hp);
    expect(wo.ball.active).toBe(true);
    expect(wo.ballHud).not.toBeNull();
    expect(wo.ballHud!.frac).toBe(0);
  });

  it('too small at the eye: it bursts and a new ball forms; the fight goes on', async () => {
    const { wo, run } = await director();
    wo.startAvalanche();
    run(AV.DESCEND_T + 0.3);
    const b = wo.ball;
    b.x = EYE_DOWN.x;
    b.z = EYE_DOWN.z + 6;
    b.vz = -5;
    run(0.5);
    expect(b.bursts).toBe(1);
    expect(wo.phase).toBe('avalanche');
    expect(wo.log).toContain('ball:small');
    run(AV.RESPAWN_T + 0.2);
    expect(b.active).toBe(true);
  });

  it('full size at the eye: THE IMPLOSION plays out (crack, suck, implode, silence, lights) and only then the round lets go', async () => {
    const { wo, run, plow, sky, hud, toasts } = await director();
    wo.startAvalanche();
    run(AV.DESCEND_T + 0.3);
    const b = wo.ball;
    b.r = AV.FULL_R;
    b.x = EYE_DOWN.x;
    b.z = EYE_DOWN.z + 8;
    b.vz = -6;
    run(0.6);
    expect(wo.phase).toBe('ending');
    expect(wo.eye).toBeNull();
    expect(plow.cinematic).toBe(true);
    expect(hud).toContain(false);
    expect(wo.holding).toBe(true);
    expect(wo.ballHud).toBeNull();
    run(END_AT.suck + 0.05);
    expect(wo.log).toContain('suck');
    // the gale is gone (the storm pours into the eye), the sky still dark
    expect(sky.some(([k, g]) => k === 1 && g === false)).toBe(true);
    run(END_AT.implode - END_AT.suck);
    expect(wo.log).toContain('implode');
    run(END_AT.lights - END_AT.implode);
    expect(wo.log).toContain('lights');
    expect(toasts).toContain('THE STORM IS BROKEN');
    // stays night: the storm sky has eased back to the zone's own (night) look, no gale
    expect(sky.at(-1)).toEqual([0, false]);
    expect(wo.holding).toBe(true);
    run(END_AT.done - END_AT.lights + 0.1);
    expect(wo.phase).toBe('over');
    expect(wo.holding).toBe(false);
    expect(plow.cinematic).toBe(false);
    const order = ['ending', 'suck', 'implode', 'lights', 'over'].map((k) => wo.log.indexOf(k));
    expect(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]))).toBe(true);
    wo.end();
    expect(wo.active).toBe(false);
  });
});
