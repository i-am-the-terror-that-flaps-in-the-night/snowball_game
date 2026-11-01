import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Combat } from '../src/entities/Combat';
import { computeStatsFor } from '../src/core/Progression';
import { PLOWS, type PlowKind } from '../src/config/plows';
import { NP, NET_PLOW_LEN } from '../src/net/protocol';
import type { GameContext } from '../src/core/types';
import type { PilotBinding } from '../src/entities/pilot';
import type { VehicleKit } from '../src/entities/combat/shared';

/* The per-kind SPACE / E switch (combat/shared.ts VehicleKit): only the Classic plows / slams / whirls; every other
 * vehicle's SPACE / E reach its kit through Combat, for local input and for the duel guest's puppet. */

const noop: unknown = new Proxy(() => noop, { get: () => noop, apply: () => noop });

function rig(kind: PlowKind) {
  const press = new Set<string>();
  const held = new Set<string>();
  const sounds: string[] = [];
  const plow = {
    position: new THREE.Vector3(), heading: 0, hp: 100, maxHp: 100, dead: false, turretAim: 0, turretHeading: 0, whirlCharge: 1,
    get eCharge() {
      return plow.whirlCharge;
    },
    spendE() {
      plow.whirlCharge = 0;
    },
    mountWorld: (_k: string, _i: number, o: THREE.Vector3) => o.set(0, 1, 0),
    getForward: (o: THREE.Vector3) => o.set(0, 0, 1),
  };
  const enemies = { query: (_x: number, _z: number, _r: number, o: unknown[] = []) => ((o.length = 0), o), damage: () => false };
  const binding = {
    stats: computeStatsFor({}, kind), plow, enemies, snow: noop, events: noop, local: false, authoritative: true, look: null,
    input: { throttle: 0, steer: 0, wasPressed: (k: string) => press.has(k), isDown: (k: string) => held.has(k) },
    audio: { play: (n: string) => sounds.push(n), setPlowing: () => {} },
  } as unknown as PilotBinding;
  const ctx = { scene: new THREE.Scene(), time: 0, fx: noop, ui: noop, impact: noop, cameraRig: noop } as unknown as GameContext;
  const c = new Combat(ctx, binding);
  c.clear();
  return { c, plow, press, held, sounds };
}

/** Wrap a kit's hooks to record what Combat hands them. */
function spy(v: VehicleKit, fireE = true) {
  const log = { p: [] as [boolean, boolean][], s: [] as [boolean, boolean][] };
  v.primary = (_dt, h, p) => void log.p.push([h, p]);
  v.secondary = (_dt, h, p) => (log.s.push([h, p]), p && fireE);
  return log;
}

describe('vehicle kits (SPACE / E)', () => {
  it('only the Classic is a snowplow', () => {
    for (const k of Object.keys(PLOWS) as PlowKind[]) expect(!!PLOWS[k].noBall).toBe(k !== 'classic');
    expect(rig('classic').c.vehicle).toBeNull();
    expect(rig('classic').c.abilityHud).toBeNull();
  });

  it.each(['volt', 'brute', 'isotope', 'arsenal'] as const)('%s: a kit with HUD descriptors, hooks called every frame', (kind) => {
    const r = rig(kind);
    const v = r.c.vehicle!;
    expect(v).not.toBeNull();
    const hud = r.c.abilityHud!;
    expect(hud.primary.icon && hud.primary.label && hud.secondary.icon && hud.secondary.label).toBeTruthy();
    expect(r.c.secondaryCooldown).toBeGreaterThan(0);
    const log = spy(v);
    r.c.update(1 / 60);
    r.held.add('Space');
    r.press.add('Space');
    r.c.update(1 / 60);
    expect(log.p).toEqual([[false, false], [true, true]]);
  });

  it('E: pressed only with a full charge, which the kit spends by returning true; an empty charge buzzes', () => {
    const r = rig('volt');
    const log = spy(r.c.vehicle!);
    r.press.add('KeyE');
    r.c.update(1 / 60);
    expect(log.s.at(-1)).toEqual([false, true]);
    expect(r.plow.whirlCharge).toBe(0);
    r.c.update(1 / 60);
    expect(log.s.at(-1)).toEqual([false, false]);
    expect(r.sounds).toContain('error');
  });

  it('a dead plow gets no input', () => {
    const r = rig('brute');
    const log = spy(r.c.vehicle!);
    r.plow.dead = true;
    r.held.add('Space');
    r.press.add('KeyE');
    r.c.update(1 / 60);
    expect(log.p[0]).toEqual([false, false]);
    expect(log.s[0]).toEqual([false, false]);
  });

  it('duel: the host writes the default puppet bits, the guest puppet replays them as held + rising edges', () => {
    const host = rig('isotope');
    spy(host.c.vehicle!);
    host.held.add('Space');
    host.press.add('KeyE');
    host.c.update(1 / 60);
    const snap = new Float32Array(NET_PLOW_LEN);
    host.c.writeNet(snap, 0);
    expect(snap[NP.fire]).toBe(3);

    const guest = rig('isotope');
    const log = spy(guest.c.vehicle!);
    guest.c.readPuppet(snap, 0);
    guest.c.update(1 / 60);
    guest.c.update(1 / 60);
    expect(log.p).toEqual([[true, true], [true, false]]);
    expect(log.s).toEqual([[true, true], [true, false]]);
    // The puppet never spends a charge it does not track.
    expect(guest.plow.whirlCharge).toBe(1);
  });
});
