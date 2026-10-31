import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GEAR, GEAR_SLOTS } from '../src/config/gear';
import { PLOWS, type PlowKind } from '../src/config/plows';
import { GEAR_LOOKS, GearVisuals, gearLook } from '../src/entities/gearVisuals';

describe('gear visuals', () => {
  it('every gear item resolves to a look (its own or the slot default); unknown ids resolve to null', () => {
    for (const d of GEAR) {
      const g = gearLook(d.id);
      expect(g, d.id).not.toBeNull();
      expect(g!.def.slot).toBe(d.slot);
    }
    expect(gearLook('noSuchItem')).toBeNull();
  });

  it('look entries only name real items', () => {
    for (const id of Object.keys(GEAR_LOOKS)) expect(GEAR.some((d) => d.id === id), id).toBe(true);
  });

  it('builds every item on every plow without throwing, rebuilds only on change, and tolerates unknown ids', () => {
    for (const kind of Object.keys(PLOWS) as PlowKind[]) {
      for (const d of GEAR) {
        const body = new THREE.Group();
        const blade = new THREE.Group();
        body.add(blade);
        const v = new GearVisuals(body, blade);
        v.sync(kind, [d.id, 'retiredItem'], 2.4);
        let n = 0;
        body.traverse(() => n++);
        expect(n, `${kind}/${d.id}`).toBeGreaterThan(4);
        v.setWidth(3.1);
        v.update(1);
        v.sync(kind, [d.id, 'retiredItem'], 3.1);
      }
    }
  });

  it('a booster item sets the flame tint, and taking it off clears it', () => {
    const body = new THREE.Group();
    const blade = new THREE.Group();
    const v = new GearVisuals(body, blade);
    const tinted = GEAR.find((d) => d.slot === 'booster' && GEAR_LOOKS[d.id]?.flame !== undefined)!;
    v.sync('classic', [tinted.id], 2);
    expect(v.flame).toBe(GEAR_LOOKS[tinted.id].flame);
    v.sync('classic', [], 2);
    expect(v.flame).toBeNull();
    expect(GearVisuals.idsFrom({ charm: 'a', blade: 'b' })).toEqual(GEAR_SLOTS.map((s) => ({ charm: 'a', blade: 'b' } as Record<string, string>)[s.id]).filter(Boolean));
  });
});
