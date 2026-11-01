import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Combat } from '../src/entities/Combat';
import { computeStatsFor } from '../src/core/Progression';
import type { DamageOpts, EnemyHandle, GameContext } from '../src/core/types';
import type { PilotBinding } from '../src/entities/pilot';
import type { PlowKind } from '../src/config/plows';
import { Terrain } from '../src/world/Terrain';
import { BLAST_BAND, HIT_BAND, WAVE_BAND, bodyBand, heightOk, waveFloor, waveHitPlow, waveHits } from '../src/entities/combat/shared';
import {
  AIR_SLAM_DIVE, STOMP_MAX, STOMP_MIN_IMPACT, airPoundMult, airSlamDamage, airSlamRadius, stompDamage,
} from '../src/entities/combat/air';
import { BOSS_WAVE_BAND, LEAP_FLIGHT, LEAP_WAVE_BAND, leapVy } from '../src/entities/enemies/bosses';
import { GroundDisc } from '../src/entities/combat/groundDisc';
import { OMEGA_TERRAIN } from '../src/world/omega/layout';

/** Any property, any call: a no-op (fx, audio, ui, impact, snow). */
const noop: unknown = new Proxy(() => noop, { get: () => noop, apply: () => noop });

let nextId = 1;
function bot(x: number, z: number, y = 0, hp = 1000): EnemyHandle {
  return { id: nextId++, position: new THREE.Vector3(x, y, z), radius: 1, hp, maxHp: hp, alive: true, airborne: false, vy: 0, deck: -1 } as unknown as EnemyHandle;
}

/** A Combat bound to a scripted plow (airborne / vy / dive are plain fields the test drives). */
function rig(bots: EnemyHandle[], kind: PlowKind = 'classic', terrain?: Terrain) {
  const stats = computeStatsFor({}, kind);
  const presses = new Set<string>();
  const plow = {
    position: new THREE.Vector3(), heading: 0, hp: 100, maxHp: 100, dead: false, radius: 1.6, heldBallRadius: 0,
    airborne: false, vy: 0, airTime: 0, surfaceY: 0, deck: -1, dives: [] as number[], hop: 0,
    // The plow's private ground-slam state (AirKit reads it through a duck-typed view).
    slamPhase: 0, slamT: 0, slamHit: false,
    getForward: (o: THREE.Vector3) => o.set(0, 0, 1),
    getBladeTip: (o: THREE.Vector3) => o.set(0, 0, 2.5),
    feedSawFury: () => {},
    stealSnow: () => 0,
    push: () => {},
    damage(n: number) {
      this.hp -= n;
    },
    dive(speed: number) {
      if (this.airborne) {
        this.vy = -speed;
        this.dives.push(speed);
      }
    },
  };
  const hits: { e: EnemyHandle; amount: number; source?: string }[] = [];
  const enemies = {
    query: (x: number, z: number, r: number, out: EnemyHandle[] = []) => {
      out.length = 0;
      for (const b of bots) if (b.alive && Math.hypot(b.position.x - x, b.position.z - z) <= r + b.radius) out.push(b);
      return out;
    },
    damage: (e: EnemyHandle, amount: number, o?: DamageOpts) => {
      (e as { hp: number }).hp -= amount;
      hits.push({ e, amount, source: o?.source });
      return false;
    },
  };
  const ctx = { scene: new THREE.Scene(), time: 0, fx: noop, ui: noop, impact: noop, terrain: terrain ?? new Terrain() } as unknown as GameContext;
  const input = { throttle: 0, steer: 0, wasPressed: (c: string) => presses.has(c) };
  const events = { emit: () => {} };
  const snow = new Proxy({}, { get: (_t, k) => (k === 'getDepth' || k === 'topAt' ? () => 0 : noop) });
  const binding = { stats, plow, enemies, input, audio: noop, snow, events, local: true, authoritative: true } as unknown as PilotBinding;
  const c = new Combat(ctx, binding);
  /** Fill the shared ultimate meter (FIRESTORM / NUKE / EARTHQUAKE ready). */
  const fillUlt = () => ((c as unknown as { critCharge: number }).critCharge = 1);
  /** One frame with `key` pressed. */
  const press = (key: string) => {
    presses.add(key);
    c.update(1 / 60);
    presses.delete(key);
  };
  /** One frame of flight: the plow is in the air at height y with vertical speed vy. */
  const fly = (y: number, vy: number) => {
    plow.airborne = true;
    plow.position.y = y;
    plow.vy = vy;
    plow.airTime += 1 / 60;
    c.update(1 / 60);
  };
  /** Touchdown frame. */
  const land = () => {
    plow.airborne = false;
    plow.position.y = 0;
    plow.vy = 0;
    plow.airTime = 0;
    c.update(1 / 60);
  };
  return { c, ctx, stats, plow, hits, presses, fly, land, fillUlt, press };
}

describe('height rule', () => {
  it('heightOk is a symmetric band', () => {
    expect(heightOk(0, 2.2)).toBe(true);
    expect(heightOk(0, 2.3)).toBe(false);
    expect(heightOk(3, 0.9)).toBe(true);
    expect(heightOk(3, 0.7)).toBe(false);
    expect(heightOk(0, 1.3, 1.2)).toBe(false);
    expect(HIT_BAND).toBeCloseTo(2.2);
    expect(bodyBand(1)).toBe(HIT_BAND);
    expect(bodyBand(3)).toBeGreaterThan(HIT_BAND); // huge bosses reach a bit higher
  });

  it('ground waves only hit targets standing on the floor of the attacker level', () => {
    // flat arena: floor 0, no terrain query
    expect(waveHits(undefined, 0, false, 5, 0, 0.3)).toBe(true);
    expect(waveHits(undefined, 0, false, 5, 0, WAVE_BAND + 0.1)).toBe(false); // jumping over it
    expect(waveHits(undefined, 0, false, 5, 0, 2.5, BLAST_BAND)).toBe(true); // big blasts reach higher
    // a mesa: a bot standing on its top is on the floor there (the wave climbs the hill)
    const t = new Terrain({ shapes: [{ kind: 'mesa', x: 10, z: 0, r: 4, h: 3, slope: 3 }] });
    expect(waveFloor(t, 0, 10, 0)).toBeCloseTo(3, 5);
    expect(waveHits(t, 0, false, 10, 0, 3.2)).toBe(true);
    // a deck 4 m up: a bot on it is not on the attacker's floor (surfaceAt ignores decks above the attacker)
    const d = new Terrain({ decks: [{ id: 1, x: 0, z: 10, hw: 4, hd: 4, rot: 0, top: 4, thickness: 0.5 }] });
    expect(waveHits(d, 0, false, 0, 10, 4)).toBe(false);
    expect(waveHits(d, 4, false, 0, 10, 4)).toBe(true); // ...but a slam on the deck hits it
    // an attacker in the air blasts feet-to-feet
    expect(waveHits(undefined, 5, true, 0, 0, 0)).toBe(false);
    expect(waveHits(undefined, 1.5, true, 0, 0, 0)).toBe(true);
  });

  it('the ground slam skips a bot on a deck above and a flying one', () => {
    const deckT = new Terrain({ decks: [{ id: 1, x: 3, z: 3, hw: 2, hd: 2, rot: 0, top: 4, thickness: 0.5 }] });
    const ground = bot(0, 3);
    const onDeck = bot(3, 3, 4);
    const flying = bot(-2, 3, 3);
    (flying as { airborne: boolean }).airborne = true;
    const { c, hits } = rig([ground, onDeck, flying], 'classic', deckT);
    c.slamAt(0, 3, 1.5, 1);
    expect(hits.map((h) => h.e)).toEqual([ground]);
  });

  it('rams and bot contact hits need the bodies near the same height', () => {
    const low = bot(0, 2);
    const { c, plow } = rig([low]);
    plow.position.y = 3; // flying over it
    expect(c.playerRam(low, 10)).toBe(0);
    plow.position.y = 0.3;
    expect(c.playerRam(low, 10)).toBeGreaterThan(0);
    // a bot's blade can't reach a plow flying 3 m over it
    plow.position.y = 3;
    expect(c.hitPlow(20, 0, 2, { attacker: low })).toBe(0);
    plow.position.y = 0;
    expect(c.hitPlow(20, 0, 2, { attacker: low })).toBeGreaterThan(0);
  });

  it('VOLT Thunderclap skips a flying bot', () => {
    const ground = bot(3, 0);
    const high = bot(-3, 0, 4);
    const { c, hits, presses } = rig([ground, high], 'volt');
    presses.add('KeyF');
    // Up to the clap itself (the storm that follows strikes from the sky and may hit anything).
    for (let i = 0; i < 90 && !hits.some((h) => h.e === ground); i++) c.update(1 / 60);
    expect(hits.some((h) => h.e === ground)).toBe(true);
    expect(hits.some((h) => h.e === high)).toBe(false);
  });
});

describe('landing maths', () => {
  it('stomp damage grows with touchdown speed, from a threshold, capped', () => {
    expect(stompDamage(STOMP_MIN_IMPACT - 0.1)).toBe(0);
    const a = stompDamage(8);
    const b = stompDamage(12);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(stompDamage(1000)).toBe(STOMP_MAX);
    expect(stompDamage(12, 2)).toBeCloseTo(b * 2);
  });

  it('air slam radius / damage grow with impact, drop and the ball, and stay capped', () => {
    expect(airSlamRadius(30, 3)).toBeGreaterThan(airSlamRadius(10, 0));
    expect(airSlamDamage(30, 3)).toBeGreaterThan(airSlamDamage(10, 0));
    expect(airSlamDamage(30, 3, 1)).toBeCloseTo(airSlamDamage(30, 3) + 40); // + SLAM_DAMAGE_K * r^2
    expect(airSlamRadius(30, 3, 1)).toBeGreaterThan(airSlamRadius(30, 3));
    expect(airSlamRadius(1e4, 1e4)).toBe(airSlamRadius(400, 60));
    expect(airSlamDamage(1e4, 1e4)).toBe(airSlamDamage(400, 60));
    // a dive landing (AIR_SLAM_DIVE m/s) beats the biggest stomp without a ball
    expect(airSlamDamage(AIR_SLAM_DIVE, 1)).toBeGreaterThan(stompDamage(AIR_SLAM_DIVE) * 0.5);
    expect(airPoundMult(28)).toBeGreaterThan(airPoundMult(0));
    expect(airPoundMult(1e4)).toBeCloseTo(1.6);
  });

  it('BULLDOZA leap vy lands the flight in LEAP_FLIGHT seconds', () => {
    const g = 24;
    for (const dh of [0, 2, -1.5]) {
      const vy = leapVy(dh, g);
      const y = vy * LEAP_FLIGHT - 0.5 * g * LEAP_FLIGHT * LEAP_FLIGHT;
      expect(y).toBeCloseTo(dh, 5);
    }
  });
});

describe('stomp / air slam / air pound', () => {
  it('landing hard next to a bot stomps it (KillSource stomp)', () => {
    const under = bot(0, 2);
    const away = bot(12, 0);
    const { hits, fly, land } = rig([under, away]);
    for (let i = 0; i < 20; i++) fly(2 - i * 0.1, -12);
    land();
    expect(hits.length).toBe(1);
    expect(hits[0].e).toBe(under);
    expect(hits[0].source).toBe('stomp');
    expect(hits[0].amount).toBeCloseTo(stompDamage(12 + 24 / 60), 1);
  });

  it('a soft landing does not stomp', () => {
    const under = bot(0, 2);
    const { hits, fly, land } = rig([under]);
    for (let i = 0; i < 20; i++) fly(0.5, -2);
    land();
    expect(hits.length).toBe(0);
  });

  it('SPACE in the air dives and the landing shockwave hits every bot in reach (KillSource airSlam)', () => {
    const near = bot(3, 0, 0, 30);
    const far = bot(20, 0);
    const { plow, hits, presses, fly, land } = rig([near, far]); // no ball held: still works
    fly(3, 2);
    presses.add('Space');
    fly(3.2, 1);
    presses.delete('Space');
    expect(plow.dives).toEqual([AIR_SLAM_DIVE]);
    fly(1.5, -AIR_SLAM_DIVE);
    land();
    expect(hits.length).toBe(1);
    expect(hits[0].e).toBe(near);
    expect(hits[0].source).toBe('airSlam');
    expect(near.hp).toBeLessThanOrEqual(0); // a scrapper-sized bot dies on landing
  });

  it('SPACE just above the ground leaves the normal slam alone', () => {
    const { plow, presses, fly } = rig([]);
    fly(0.2, 1);
    presses.add('Space');
    fly(0.25, 0.5);
    expect(plow.dives).toEqual([]);
  });

  it('BRUTUS Ground Pound in the air dives and lands as a bigger crater', () => {
    const ring = bot(0, 9); // outside the ground pound's leap radius, inside the air pound's
    const { stats, plow, hits, presses, fly, land } = rig([ring], 'brute');
    if (stats.poundDamage <= 0) stats.poundDamage = 30;
    const groundR = stats.poundRadius * 1.2;
    ring.position.z = groundR + 0.5 + ring.radius;
    fly(3, 1);
    presses.add('KeyF');
    fly(3.1, 0.5);
    presses.delete('KeyF');
    expect(plow.dives.length).toBe(1);
    fly(1, -28);
    land();
    expect(hits.some((h) => h.e === ring && h.source === 'airSlam')).toBe(true);
  });
});

describe('height rules on terrain (wave 2 fixes)', () => {
  /** Inferno Quarry's pit: 2.4 m deep with a 0.6 m rim. */
  const pit = () => new Terrain({ shapes: [{ kind: 'dome', x: 0, z: -1, r: 8.5, h: -2.4, rim: 0.6 }] });

  it('a boss shockwave on a ring spanning > 3 m of slope still hits a grounded plow (no body band on waves)', () => {
    const t = pit();
    const { c, ctx, plow } = rig([], 'classic', t);
    // BULLDOZA lands on the top of the pit rim, the plow sits at the bottom (3 m lower).
    let rimZ = 0;
    for (let z = 0; z < 12; z += 0.05) if (t.ground(0, z) > t.ground(0, rimZ)) rimZ = z;
    const boss = Object.assign(bot(0, rimZ, t.ground(0, rimZ)), { radius: 2.6, dmgOutMult: 1 });
    plow.position.set(0, t.ground(0, -1), -1);
    plow.surfaceY = plow.position.y;
    expect(boss.position.y - plow.position.y).toBeGreaterThan(bodyBand(boss.radius)); // more than the body band apart
    expect(waveHits(t, boss.position.y, false, plow.position.x, plow.position.z, plow.position.y, LEAP_WAVE_BAND)).toBe(true);
    expect(waveHits(t, boss.position.y, false, plow.position.x, plow.position.z, plow.position.y, BOSS_WAVE_BAND)).toBe(true);
    // A body hit from that height misses (blade / contact rule)...
    expect(c.hitPlow(20, boss.position.x, boss.position.z, { attacker: boss, unblockable: true })).toBe(0);
    // ...but the shockwave comes through waveHitPlow (no attacker) and lands.
    (ctx as unknown as { combat: Combat; plow: unknown; zone: object }).combat = c;
    (ctx as unknown as { plow: unknown }).plow = plow;
    (ctx as unknown as { zone: object }).zone = { enemyDmgMult: 1 };
    expect(waveHitPlow(ctx, boss, 20, { knockback: 1, unblockable: true })).toBeGreaterThan(0);
  });

  it('waveHitPlow (DONALD reflect / snow-globe hits) reaches a plow 4 m above the boss', () => {
    const { c, ctx, plow } = rig([]);
    const boss = Object.assign(bot(0, 4, 0), { radius: 3, dmgOutMult: 1 });
    plow.position.y = 4;
    plow.surfaceY = 4;
    Object.assign(ctx, { combat: c, plow, zone: {} });
    expect(c.hitPlow(10, 0, 4, { attacker: boss })).toBe(0);
    expect(waveHitPlow(ctx, boss, 10, { unblockable: true })).toBeGreaterThan(0);
  });

  it('waveHitPlow credits the boss itself for threat, not a minion near the knockback origin', () => {
    const minion = bot(0, 3, 0);
    const { c, ctx, plow } = rig([minion]);
    const boss = Object.assign(bot(0, 9, 0), { radius: 3, dmgOutMult: 1 });
    plow.position.y = 4; // in the air / on a mesa: out of the boss's body band
    plow.surfaceY = 4;
    Object.assign(ctx, { combat: c, plow, zone: {} });
    // SLEET-style swipe: knockback origin 1 m from the plow, right next to the minion
    expect(waveHitPlow(ctx, boss, 10, { unblockable: true, fromX: 0, fromZ: 1 })).toBeGreaterThan(0);
    expect(c.threatOf(boss)).toBeGreaterThan(0);
    expect(c.threatOf(minion)).toBe(0);
  });

  it('hit sparks and the damage number follow an airborne plow; ground rings stay on the floor', () => {
    const { c, ctx, plow } = rig([]);
    const texts: number[] = [];
    const bursts: number[] = [];
    (ctx as unknown as { fx: unknown }).fx = new Proxy(
      {},
      {
        get: (_t, k) =>
          k === 'floatText'
            ? (v: THREE.Vector3) => texts.push(v.y)
            : k === 'burst'
              ? (v: THREE.Vector3) => bursts.push(v.y)
              : noop,
      },
    );
    plow.airborne = true;
    plow.position.y = 5;
    plow.surfaceY = 0;
    expect(c.hitPlow(10, 0, 3, { unblockable: true })).toBeGreaterThan(0);
    expect(texts[0]).toBeCloseTo(5 + 2.8, 5);
    expect(bursts[0]).toBeCloseTo(5 + 1.1, 5);
    // grounded on a deck: unchanged (surface-relative)
    texts.length = bursts.length = 0;
    (c as unknown as { iframe: number }).iframe = 0;
    plow.airborne = false;
    plow.position.y = 3;
    plow.surfaceY = 3;
    expect(c.hitPlow(10, 0, 3, { unblockable: true })).toBeGreaterThan(0);
    expect(texts[0]).toBeCloseTo(3 + 2.8, 5);
  });

  it('a GroundDisc cast near a deck edge stops at the edge (Omega Works deck 1) instead of floating past it', () => {
    const t = new Terrain(OMEGA_TERRAIN);
    const top = t.heightAt(16, 10, 7); // the Assembly Floor, east edge x = 18 (rampE leaves it at z -5..5)
    expect(t.heightDeck).toBe(1);
    const disc = new GroundDisc(new THREE.Scene(), new THREE.MeshBasicMaterial());
    const lift = 0.07;
    disc.place(t, 16, 10, 10, top, 1, lift); // FIRESTORM 2 m inside the x = 18 edge
    const pos = disc.mesh.geometry.getAttribute('position');
    const on = (x: number, z: number) => {
      const y = t.heightAt(x, z, top);
      return { y, ok: t.heightDeck === 1 || heightOk(top, y, WAVE_BAND) };
    };
    let pinned = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = 16 + pos.getX(i);
      const z = 10 + pos.getZ(i);
      const f = on(x, z);
      expect(f.ok).toBe(true); // every vertex lies on the cast level...
      expect(pos.getY(i)).toBeCloseTo(f.y + lift, 3); // ...draped on it
      if (i > 32 * 7 && Math.hypot(pos.getX(i), pos.getZ(i)) < 9.99) pinned++; // outer ring short of r
    }
    expect(pinned).toBeGreaterThan(10); // the overhanging spokes were pinned at the edge
    // ...and so do the triangles: the only centroids past the level are slivers in the concave corner where rampE
    // meets the Floor's edge (x 18, z 5): triangles spanning a ramp vertex and a Floor vertex.
    const idx = disc.mesh.geometry.getIndex()!;
    let off = 0;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i), b = idx.getX(i + 1), d = idx.getX(i + 2);
      const cx = 16 + (pos.getX(a) + pos.getX(b) + pos.getX(d)) / 3;
      const cz = 10 + (pos.getZ(a) + pos.getZ(b) + pos.getZ(d)) / 3;
      if (!on(cx, cz).ok) {
        off++;
        expect(Math.hypot(cx - 18, cz - 5)).toBeLessThan(1.5);
      }
    }
    expect(off).toBeLessThanOrEqual(6); // of 512 triangles
  });

  it('a GroundDisc on the ground lies on the snow left after the melt', () => {
    const disc = new GroundDisc(new THREE.Scene(), new THREE.MeshBasicMaterial());
    const snow = { getDepth: (x: number) => (x > 0 ? 0.3 : 0) };
    disc.place(undefined, 0, 0, 5, 0, -1, 0.06, snow);
    const pos = disc.mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeCloseTo((pos.getX(i) > 0 ? 0.3 : 0) + 0.06, 5);
    // a deck floor carries no snow
    const t = new Terrain({ decks: [{ id: 1, x: 0, z: 0, hw: 20, hd: 20, rot: 0, top: 3, thickness: 1 }] });
    disc.place(t, 0, 0, 5, 3, 1, 0.06, snow);
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeCloseTo(3.06, 5);
  });

  it('a slam on a deck does not spill over its edge onto the ground below', () => {
    const t = new Terrain({ decks: [{ id: 1, x: 0, z: 0, hw: 4, hd: 4, rot: 0, top: 3, thickness: 3 }] });
    const onDeck = bot(3, 0, 3);
    const below = bot(5.5, 0, 0); // on the ground just past the deck edge (x = 4)
    const { c, plow, hits } = rig([onDeck, below], 'classic', t);
    plow.position.set(2, 3, 0);
    plow.surfaceY = 3;
    plow.deck = 1;
    c.slamAt(2.5, 0, 1.6, 1);
    expect(hits.map((h) => h.e)).toEqual([onDeck]);
    // the rule itself: fromDeck given, the ground past the edge is off the attacker's level
    expect(waveHits(t, 3, false, 5.5, 0, 0, WAVE_BAND, 1)).toBe(false);
    expect(waveHits(t, 3, false, 3, 0, 3, WAVE_BAND, 1)).toBe(true);
    // a plow on the ground still misses a bot up on the deck
    expect(waveHits(t, 0, false, 3, 0, 3, WAVE_BAND, -1)).toBe(false);
  });

  it('the FIRESTORM burning ground keeps burning ground bots while the plow is in the air', () => {
    const bots: EnemyHandle[] = [];
    const { stats, plow, hits, fillUlt, press, fly } = rig(bots, 'classic');
    if (stats.flameDps <= 0) stats.flameDps = 10;
    fillUlt();
    press('KeyF'); // FIRESTORM: nova + burning ground (radius 10) around (0, 0)
    const walker = bot(7, 0, 0); // walks into the field after the cast
    bots.push(walker);
    hits.length = 0;
    plow.position.x = 30; // drove away and off a ramp: 3 m up
    for (let i = 0; i < 60; i++) fly(3, 0);
    expect(hits.some((h) => h.e === walker)).toBe(true);
  });

  it('EARTHQUAKE rings keep hitting ground bots after the plow takes off', () => {
    const bots: EnemyHandle[] = [];
    const { stats, hits, fillUlt, press, fly } = rig(bots, 'brute');
    if (stats.poundDamage <= 0) stats.poundDamage = 30;
    fillUlt();
    press('KeyF'); // EARTHQUAKE from (0, 0): rings at 0, 0.35, 0.7 s
    const far = bot(16, 0, 0); // swept by the last ring (13..19 m)
    bots.push(far);
    for (let i = 0; i < 70; i++) fly(3, 0);
    expect(hits.some((h) => h.e === far)).toBe(true);
  });

  it('fallout pools dose bots on the floor they were cast on, not one on a deck above', () => {
    const t = new Terrain({ decks: [{ id: 1, x: 2, z: 0, hw: 1.5, hd: 1.5, rot: 0, top: 4, thickness: 0.5 }] });
    const bots: EnemyHandle[] = [];
    const { stats, hits, press, fly } = rig(bots, 'isotope', t);
    if (stats.meltDamage <= 0) stats.meltDamage = 20;
    if (stats.poolDps <= 0) stats.poolDps = 10;
    stats.poolRadius = Math.max(stats.poolRadius, 4);
    stats.poolSeconds = Math.max(stats.poolSeconds, 3);
    press('KeyF'); // Meltdown + pool at (0, 0) on the ground
    const ground = bot(-2, 0, 0);
    const up = bot(2, 0, 4); // on the deck 4 m above the pool
    bots.push(ground, up);
    hits.length = 0;
    for (let i = 0; i < 60; i++) fly(3, 0); // the plow flies off meanwhile
    expect(hits.some((h) => h.e === ground)).toBe(true);
    expect(hits.some((h) => h.e === up)).toBe(false);
  });
});

describe('air slam vs the ground slam state', () => {
  it('a ground slam begun before lift-off plays out; one started on the dive press is replaced', () => {
    const { plow, presses, fly } = rig([]);
    fly(3, 2);
    plow.slamPhase = 2; // mid-lunge from before the plow left the ground
    plow.slamT = 0.1;
    presses.add('Space');
    fly(3.2, 1);
    presses.delete('Space');
    expect(plow.dives).toEqual([AIR_SLAM_DIVE]);
    expect(plow.slamPhase).toBe(2);

    const b = rig([]);
    b.fly(3, 2);
    b.plow.slamPhase = 1; // the plow read SPACE a hair under AIR_SLAM_MIN_HEIGHT this frame
    b.plow.slamT = 1 / 60;
    b.presses.add('Space');
    b.fly(3.2, 1);
    expect(b.plow.slamPhase).toBe(0);
  });
});
