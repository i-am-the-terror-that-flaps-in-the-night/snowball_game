import { describe, expect, it } from 'vitest';
import { BIOMES, BIOME_ZONE, BRAWL_BIOMES, BRAWL_ZONE, ZONES, brawlZone, pickBrawlZone, zoneLook } from '../src/config/zones';
import { ENEMY_GATES, PLOW_SPAWN } from '../src/core/types';
import { Terrain, makeSurface } from '../src/world/Terrain';
import type { TerrainDef } from '../src/world/Terrain';
import { V_LANDED, makeVert, stepVertical } from '../src/world/terrainMotion';
import { DUEL_VENUES, DUEL_ZONE, duelVenueFor, duelZone, duelZoneFor } from '../src/config/duel';
import { weatherLayers } from '../src/world/biomes/Weather';

/* Layout rules for the biome terrains (src/world/biomes/terrains.ts, docs/level-overhaul.md "Arenas"). */

const flatNear = (t: Terrain, x: number, z: number, r: number, tol: number) => {
  for (let a = 0; a < 16; a++)
    for (const f of [0, 0.5, 1]) {
      const px = x + Math.sin((a / 16) * Math.PI * 2) * r * f;
      const pz = z + Math.cos((a / 16) * Math.PI * 2) * r * f;
      if (Math.abs(t.ground(px, pz)) > tol) return { px, pz, y: t.ground(px, pz) };
    }
  return null;
};
const patchNear = (def: TerrainDef, x: number, z: number, r: number) =>
  (def.patches ?? []).find((p) => {
    const t = new Terrain({ patches: [p] });
    for (let a = 0; a < 16; a++)
      for (const f of [0, 0.5, 1]) {
        if (t.materialAt(x + Math.sin((a / 16) * Math.PI * 2) * r * f, z + Math.cos((a / 16) * Math.PI * 2) * r * f) !== 'snow') return true;
      }
    return false;
  });
/** Fraction of the floor (half-size `half`) covered by `material`. */
function coverage(t: Terrain, half: number, material: string): number {
  let n = 0;
  let hit = 0;
  for (let x = -half + 0.25; x < half; x += 0.5)
    for (let z = -half + 0.25; z < half; z += 0.5) {
      n++;
      if (t.materialAt(x, z) === material) hit++;
    }
  return hit / n;
}

const CAMPAIGN = ZONES.slice(0, 5);

describe('biome zones', () => {
  it('arenas 1-5 each have a distinct biome whose snow colour drives the snow tint', () => {
    const keys = CAMPAIGN.map((z) => z.biome?.key);
    expect(keys).toEqual(['glacier', 'quarry', 'mars', 'divide', 'plaza']);
    for (const z of CAMPAIGN) expect(z.snowTint).toBe(z.biome!.snowColor);
    expect(ZONES[5].biome).toBeUndefined(); // The Omega Works builds its own look
    expect(Object.keys(BIOMES).sort()).toEqual(['divide', 'glacier', 'mars', 'plaza', 'quarry']);
  });

  it('only Rust Basin changes gravity, only the Plaza is flat', () => {
    expect(ZONES[2].terrain?.gravityMult).toBe(0.6);
    for (const i of [0, 1, 3]) expect(ZONES[i].terrain?.gravityMult ?? 1).toBe(1);
    expect(ZONES[4].terrain).toBeUndefined();
    for (const z of CAMPAIGN) expect(z.terrain?.decks ?? []).toHaveLength(0);
  });
});

describe('campaign terrain layout (60 m)', () => {
  for (const zone of CAMPAIGN.filter((z) => z.terrain)) {
    const def = zone.terrain!;
    const t = new Terrain(def);
    describe(zone.name, () => {
      it('keeps the plow spawn and both Duel spawns flat and patch-free', () => {
        expect(flatNear(t, PLOW_SPAWN.x, PLOW_SPAWN.z, 5, 0.2)).toBeNull();
        expect(patchNear(def, PLOW_SPAWN.x, PLOW_SPAWN.z, 6)).toBeUndefined();
        for (const z of [15, -15]) {
          expect(flatNear(t, 0, z, 3, 0.35)).toBeNull();
          expect(patchNear(def, 0, z, 3)).toBeUndefined();
        }
      });

      it('keeps the first 10 m of every gate lane open (no bumps, no lava)', () => {
        for (const g of ENEMY_GATES) {
          const ex = Math.max(-30, Math.min(30, g.x));
          const ez = Math.max(-30, Math.min(30, g.z));
          const dx = -Math.sign(g.x) * (Math.abs(g.x) > 30 ? 1 : 0);
          const dz = -Math.sign(g.z) * (Math.abs(g.z) > 30 ? 1 : 0);
          for (let d = 0; d <= 10; d += 1)
            for (let w = -4; w <= 4; w += 1) {
              const x = ex + dx * d + dz * w;
              const z = ez + dz * d + dx * w;
              expect(Math.abs(t.ground(x, z)), `${zone.name} gate (${g.x},${g.z}) at ${x},${z}`).toBeLessThanOrEqual(0.35);
              expect(t.materialAt(x, z)).not.toBe('lava');
            }
        }
      });

      it('leaves the walls on flat ground and lava under 15% of the floor', () => {
        for (let s = -30; s <= 30; s += 1) {
          for (const [x, z] of [[s, -30], [s, 30], [-30, s], [30, s]]) expect(Math.abs(t.ground(x, z))).toBeLessThanOrEqual(0.3);
        }
        expect(coverage(t, 30, 'lava')).toBeLessThanOrEqual(0.15);
      });

      it('keeps the boss centre readable (at most a bowl, no raised feature)', () => {
        for (let x = -4; x <= 4; x += 1) for (let z = -4; z <= 4; z += 1) if (Math.hypot(x, z) <= 4) expect(t.ground(x, z)).toBeLessThanOrEqual(0.3);
        expect(t.ground(0, 0)).toBeGreaterThan(-3);
      });
    });
  }

  it('Inferno Quarry has real lava rivers and jump ramps aimed across them', () => {
    const def = ZONES[1].terrain!;
    const t = new Terrain(def);
    const lava = coverage(t, 30, 'lava');
    expect(lava).toBeGreaterThan(0.04);
    const ramps = def.shapes!.filter((s) => s.kind === 'ramp');
    expect(ramps.length).toBeGreaterThanOrEqual(2);
    for (const r of ramps) {
      if (r.kind !== 'ramp') continue;
      // a few metres past the lip, along the ramp's heading, is lava
      let over = false;
      for (let d = 0.5; d < 6; d += 0.25) {
        if (t.materialAt(r.x + Math.sin(r.rot) * (r.len + d), r.z + Math.cos(r.rot) * (r.len + d)) === 'lava') over = true;
      }
      expect(over).toBe(true);
      // the ramp itself is not lava
      expect(t.materialAt(r.x + Math.sin(r.rot) * r.len * 0.5, r.z + Math.cos(r.rot) * r.len * 0.5)).not.toBe('lava');
    }
  });

  it('The Thermal Divide keeps lava on the hot (west) half and ice on the cold (east) half', () => {
    for (const p of ZONES[3].terrain!.patches!) {
      if (p.material === 'lava') expect(Math.max(p.x, p.x2 ?? p.x) + p.r).toBeLessThan(0);
      if (p.material === 'ice') expect(Math.min(p.x, p.x2 ?? p.x) - p.r).toBeGreaterThan(0);
    }
  });
});

/* Nominal Snowdome cover (Environment.buildObstacles, before its +-2 m jitter), base quadrant, rotated by 90° steps. */
const COVER: [number, number, number][] = [
  [24, 16, 2], [27.8, 17.2, 2], [25.3, 19.7, 2], // ice pillar cluster
  [47, 10, 4.5], // container (3 colliders along its length)
  [38, 40, 6], // rock outcrop + satellite
  [12, 54, 2.3], // snowman
  [77, 36, 2], // tire pile
  [62, 64, 4.5], // corner container
];
const rot = (q: number, x: number, z: number): [number, number] => {
  const c = Math.round(Math.cos((q * Math.PI) / 2));
  const s = Math.round(Math.sin((q * Math.PI) / 2));
  return [x * c - z * s, x * s + z * c];
};
const BRAWL_SPAWNS: [number, number][] = [];
for (let i = 0; i < 12; i++) BRAWL_SPAWNS.push([Math.sin((i / 12) * Math.PI * 2) * 69.3, Math.cos((i / 12) * Math.PI * 2) * 69.3]);
for (let i = 0; i < 6; i++) BRAWL_SPAWNS.push([Math.sin(Math.PI / 6 + (i / 6) * Math.PI * 2) * 34.2, Math.cos(Math.PI / 6 + (i / 6) * Math.PI * 2) * 34.2]);

describe('Brawl biome venues (180 m)', () => {
  it('draws from the Snowdome plus the five campaign biomes', () => {
    expect([...BRAWL_BIOMES].sort()).toEqual(['divide', 'glacier', 'mars', 'plaza', 'quarry', 'snowdome']);
    expect(brawlZone('snowdome')).toBe(BRAWL_ZONE);
    expect(brawlZone('quarry')).toBe(brawlZone('quarry'));
    const seen = new Set<string>();
    for (let r = 0; r < 1; r += 0.01) seen.add(pickBrawlZone(r).biome?.key ?? 'snowdome');
    expect(seen.size).toBe(6);
    for (const key of BRAWL_BIOMES) {
      const z = brawlZone(key);
      expect(z.theme).toBe('brawl');
      expect(z.rounds).toHaveLength(0);
      expect(z.terrain?.decks ?? []).toHaveLength(0);
      if (key !== 'snowdome') {
        expect(z.biome).toBe(BIOME_ZONE[key].biome);
        expect(z.skyTop).toBe(zoneLook(BIOME_ZONE[key]).skyTop);
        expect(z.fogFar).toBeGreaterThanOrEqual(210);
      }
    }
    expect(brawlZone('plaza').terrain).toBeUndefined();
    expect(brawlZone('mars').terrain?.gravityMult).toBe(0.6);
  });

  for (const key of BRAWL_BIOMES) {
    const def = brawlZone(key).terrain;
    if (!def) continue;
    const t = new Terrain(def);
    it(`${key}: spawn rings, cover and walls stay on flat ground; lava < 15%`, () => {
      for (const [x, z] of BRAWL_SPAWNS) {
        expect(flatNear(t, x, z, 4, 0.25), `spawn ${x.toFixed(1)},${z.toFixed(1)}`).toBeNull();
        expect(patchNear(def, x, z, 5)).toBeUndefined();
      }
      for (let q = 0; q < 4; q++)
        for (const [cx, cz, r] of COVER) {
          const [x, z] = rot(q, cx, cz);
          expect(flatNear(t, x, z, r + 2.5, 0.3), `cover ${x},${z}`).toBeNull();
          expect(patchNear(def, x, z, r + 2.5)).toBeUndefined();
        }
      expect(flatNear(t, 0, 0, 6.5, 0.3)).toBeNull(); // the fountain
      for (let s = -90; s <= 90; s += 2) {
        for (const [x, z] of [[s, -90], [s, 90], [-90, s], [90, s]]) expect(Math.abs(t.ground(x, z))).toBeLessThanOrEqual(0.3);
      }
      expect(coverage(t, 90, 'lava')).toBeLessThanOrEqual(0.15);
      // The Quarry is the lava venue: keep enough of it to read from the match camera.
      if (key === 'quarry') expect(coverage(t, 90, 'lava')).toBeGreaterThan(0.004);
      expect(t.active).toBe(true);
    });
  }
});

const RUN_OUT = 6;

describe('ramp lanes', () => {
  // every campaign arena and Brawl venue: no lava on a ramp's run-up (8 m behind the toe) or face, across its width
  const venues: [string, TerrainDef][] = [
    ...CAMPAIGN.filter((z) => z.terrain).map((z): [string, TerrainDef] => [z.name, z.terrain!]),
    ...BRAWL_BIOMES.filter((k) => brawlZone(k).terrain).map((k): [string, TerrainDef] => [`Brawl ${k}`, brawlZone(k).terrain!]),
  ];
  for (const [name, def] of venues) {
    const ramps = (def.shapes ?? []).filter((s) => s.kind === 'ramp');
    if (!ramps.length) continue;
    it(`${name}: run-up lanes and ramp faces are lava-free`, () => {
      const t = new Terrain(def);
      for (const r of ramps) {
        if (r.kind !== 'ramp') continue;
        const fx = Math.sin(r.rot);
        const fz = Math.cos(r.rot);
        for (let v = -8; v <= r.len; v += 0.25)
          for (let u = -r.w / 2; u <= r.w / 2 + 1e-9; u += r.w / 8) {
            const x = r.x + fx * v + fz * u;
            const z = r.z + fz * v - fx * u;
            expect(t.materialAt(x, z), `${name} ramp at ${r.x.toFixed(1)},${r.z.toFixed(1)}: lava at ${x.toFixed(1)},${z.toFixed(1)}`).not.toBe('lava');
          }
      }
    });
    if (!(def.patches ?? []).some((p) => p.material === 'lava')) continue;
    // Every landing off a ramp leaves RUN_OUT m of lava-free ground ahead: enough for a rival braking on rock (~18 m/s²)
    // from 14 m/s. Drives at top speeds of 14-24 m/s (engine levels; no dash), up to 30° off the ramp's heading, entering
    // anywhere over its full-height deck, through the real vertical motion (stepVertical): straight jumps over the lava,
    // angled ones leaving over a lip corner, and drops off a side edge. Horizontal speed is held constant, so V is the
    // speed at the lip (in game the climb costs a little of it).
    it(`${name}: every ramp landing has ${RUN_OUT} m of lava-free run-out`, () => {
      const t = new Terrain(def);
      const s = makeSurface();
      const b = makeVert();
      let landings = 0;
      for (const r of ramps) {
        if (r.kind !== 'ramp') continue;
        const deck = r.w / 2 - 0.6; // the soft side edges are 0.6 m (Terrain shapeHeight)
        for (let V = 14; V <= 24; V += 2)
          for (let th = -30; th <= 30; th += 5)
            for (let u0 = -deck; u0 <= deck + 1e-9; u0 += deck / 2) {
              const h = r.rot + (th * Math.PI) / 180;
              const hx = Math.sin(h);
              const hz = Math.cos(h);
              // the path crosses the toe line at u0, starting 10 m before it
              let x = r.x + Math.cos(r.rot) * u0 - hx * 10;
              let z = r.z - Math.sin(r.rot) * u0 - hz * 10;
              Object.assign(b, makeVert(), { px: x, pz: z, y: t.ground(x, z), surfaceY: t.ground(x, z) });
              let flew = false;
              for (let k = 0; k < 150; k++) {
                x += (hx * V) / 60;
                z += (hz * V) / 60;
                const code = stepVertical(t, b, x, z, 0, 1 / 60, s);
                if (b.airborne) flew = true;
                else if (!flew && t.materialAt(x, z) === 'lava') break; // drove into it without a jump: not a landing
                if (code === V_LANDED) {
                  landings++;
                  for (let d = 0; d <= RUN_OUT; d += 0.25) {
                    const lx = x + hx * d;
                    const lz = z + hz * d;
                    expect(t.materialAt(lx, lz), `${name} ramp at ${r.x.toFixed(1)},${r.z.toFixed(1)}, ${V} m/s, ${th}°, u ${u0.toFixed(1)}: landed at ${x.toFixed(1)},${z.toFixed(1)}, lava ${d} m on`).not.toBe('lava');
                  }
                  break;
                }
                if (flew && !b.airborne) flew = false; // a hop
              }
            }
      }
      expect(landings).toBeGreaterThan(0);
    });
  }
});

describe('Duel venues', () => {
  it('both peers derive the same venue from the room code, and every venue occurs', () => {
    expect(duelVenueFor('abcd')).toBe(duelVenueFor('ABCD '));
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(duelVenueFor(`R${i.toString(36).toUpperCase()}X`));
    expect([...seen].sort()).toEqual([...DUEL_VENUES].sort());
  });

  it('classic is DUEL_ZONE; biome venues add only the look, biome and ground terrain', () => {
    expect(duelZone('classic')).toBe(DUEL_ZONE);
    for (const v of DUEL_VENUES) {
      if (v === 'classic') continue;
      const z = duelZone(v);
      expect(z).toBe(duelZone(v));
      expect(Object.keys(z).sort()).toEqual([...Object.keys(DUEL_ZONE), 'biome'].sort());
      expect(z.biome).toBe(BIOME_ZONE[v].biome);
      expect(z.terrain).toBe(BIOME_ZONE[v].terrain);
      expect(z.terrain?.decks ?? []).toHaveLength(0);
      expect(z.coinMult).toBe(0);
      expect(z.rounds.every((r) => r.groups.length === 0)).toBe(true);
      expect(duelZoneFor('ZZZZ').id).toBe('duel');
    }
  });
});

describe('weather presets', () => {
  it('every particle kind has layers within a sane budget; the Divide splits steam and snow by side', () => {
    for (const k of ['snow', 'ash', 'dust', 'steam', 'confetti'] as const) {
      const layers = weatherLayers(k, 1);
      expect(layers.length).toBeGreaterThan(0);
      expect(layers.reduce((n, l) => n + l.count, 0)).toBeLessThanOrEqual(9000);
    }
    const steam = weatherLayers('steam', 0.5);
    expect(steam.some((l) => l.side === -1 && l.fall < 0)).toBe(true); // rising steam over the hot half
    expect(steam.some((l) => l.side === 1 && l.fall > 0)).toBe(true); // snow over the cold half
    expect(weatherLayers('ash', 0.5).some((l) => l.fall < 0 && l.additive)).toBe(true); // embers rise
    expect(weatherLayers('confetti', 0.5)[0].shape).toBe('confetti');
    for (const z of CAMPAIGN) expect(['snow', 'ash', 'dust', 'steam', 'confetti']).toContain(z.biome!.particles);
  });
});
