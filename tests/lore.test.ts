import { describe, expect, it } from 'vitest';
import { ZONES } from '../src/config/zones';
import { PLOWS, type PlowKind } from '../src/config/plows';
import { ENEMIES } from '../src/config/enemies';
import { BOSS_LORE, BOSS_ORDER, CHAPTERS, EPILOGUE, HARD_CHAPTERS, HARD_EPILOGUE, HARD_PROLOGUE, PLOW_LORE, PROLOGUE } from '../src/config/lore';

describe('lore', () => {
  it('every campaign arena has a chapter (opening + ending)', () => {
    for (const z of ZONES) {
      expect(CHAPTERS[z.id]?.intro, z.id).toBeTruthy();
      expect(CHAPTERS[z.id]?.outro, z.id).toBeTruthy();
    }
    expect(Object.keys(CHAPTERS).sort()).toEqual(ZONES.map((z) => z.id).sort());
    expect(PROLOGUE.length).toBeGreaterThan(100);
    expect(EPILOGUE.length).toBeGreaterThan(100);
  });

  it('every campaign boss has a profile and a happy-ending fate, listed under its own arena', () => {
    const bosses = new Set<string>();
    for (const z of ZONES) for (const r of z.rounds) if (r.boss) for (const g of r.groups) bosses.add(g.type);
    for (const b of bosses) {
      expect(BOSS_LORE[b]?.bio, b).toBeTruthy();
      expect(BOSS_LORE[b]?.fate, b).toBeTruthy();
      const entry = BOSS_ORDER.find((o) => o.type === b);
      expect(entry, b).toBeTruthy();
      const zone = ZONES.find((z) => z.id === entry!.zone)!;
      expect(zone.rounds.some((r) => r.boss && r.groups.some((g) => g.type === b)), `${b} in ${entry!.zone}`).toBe(true);
      expect(ENEMIES[b as keyof typeof ENEMIES]).toBeTruthy();
    }
    expect(BOSS_ORDER.map((o) => o.type).sort()).toEqual([...bosses].sort());
  });

  it('every arena has a Hard-mode (PROTOCOL B) chapter', () => {
    for (const z of ZONES) {
      expect(HARD_CHAPTERS[z.id]?.intro, z.id).toBeTruthy();
      expect(HARD_CHAPTERS[z.id]?.outro, z.id).toBeTruthy();
    }
    expect(Object.keys(HARD_CHAPTERS).sort()).toEqual(ZONES.map((z) => z.id).sort());
    expect(HARD_PROLOGUE.length).toBeGreaterThan(100);
    expect(HARD_EPILOGUE.length).toBeGreaterThan(100);
  });

  it('every plow has a bio', () => {
    for (const k of Object.keys(PLOWS) as PlowKind[]) expect(PLOW_LORE[k], k).toBeTruthy();
  });
});
