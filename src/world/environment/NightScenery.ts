import * as THREE from 'three';
import type { ZoneDef } from '../../core/types';
import { ARENA } from '../../core/types';
import { currentPreset } from '../../core/settings';
import type { Item } from './types';
import { VenueScenery } from './VenueScenery';
import {
  WALL_C, GATE_HALF, PILLAR_W, STAND_N0, ROWS, ROW_D, ROW_RISE, STAGE_HALF, BRAWL_WALL_H, DOME_N0, DOME_ROWS,
  DOME_ROW_D, DOME_RISE, SIDES, SPONSORS, brawlMode, gapsFor, merge, subtract, type Side,
} from './layout';
import { getGlowTex } from './textures';
import { GLOW_HALO, NIGHT_BOOST, floodConeGeometry, floodConeMaterial, ledRibbonTexture } from './night';
import { OMEGA_GATES } from '../omega/layout';

/** A floodlight bank: the head centre (x, y, z), facing yaw `ry` (local +Z toward the arena), size `k`, and how far
 *  its post reaches down (m, before scaling). */
interface Bank {
  x: number;
  y: number;
  z: number;
  ry: number;
  k: number;
  post: number;
}

/** Light bank head tilt below the horizon (rad). */
const BANK_TILT = 0.62;

/**
 * NIGHT stadium dressing (only built when the arena is lit for night; see night.ts): floodlight banks on the stand
 * backs, soft additive light cones from every floodlight head with bright pools on the snow, a scrolling LED ribbon
 * board around the stand fronts, a packed spectator gallery over The Omega Works' walls, the stadium Points draw
 * (phone lights, flashes, lamp halos) and the boost of the arena's own emissives. Nothing here touches this.rnd,
 * colliders or anything the simulation reads: every random number comes from this.nightRnd.
 * Draw calls added: bank frames + bank lamps, cones (not on LOW), pools, LED ribbon, the Points (6 at most).
 */
export class NightScenery extends VenueScenery {
  /** Scrolling LED ribbon (offset advanced in update). */
  protected ledTex: THREE.Texture | null = null;

  /** Campaign / Plaza arenas (stands on all four sides). */
  protected buildNightStadium(zone: ZoneDef, G: number): void {
    const rally = this.isRally;
    const topH = G + 0.25 + ROWS * ROW_RISE;
    const backN = STAND_N0 + ROWS * ROW_D + 0.15;
    const banks: Bank[] = [];
    for (const side of SIDES) {
      const range = side.key === 'n' || side.key === 's' ? [ARENA.minX - 1, ARENA.maxX + 1] : [ARENA.minZ - 1, ARENA.maxZ + 1];
      const gaps = gapsFor(side.key, GATE_HALF + 2.2);
      if (side.key === 'n' && rally) gaps.push([-(STAGE_HALF + 0.6), STAGE_HALF + 0.6]);
      for (const [a, b] of subtract(range[0], range[1], gaps)) {
        for (let s = a + 4.5; s < b - 2; s += 12) {
          const [x, z] = side.map(s, backN - 0.3);
          banks.push({ x, y: topH + 1.3 + 2.4, z, ry: side.yaw, k: 1, post: 2.4 });
        }
      }
    }
    this.buildBanks(banks);
    this.buildLedRibbon(['SNOWPLOW', 'SHOWDOWN', zone.name.toUpperCase().slice(0, 14), 'LIVE ★ NIGHT'], WALL_C + 0.22, 0.46, 6, () => true, (side) => side.h, GATE_HALF + PILLAR_W);
    this.buildFloodCones();
  }

  /** THE SNOWDOME (Brawl + Duel): banks over the sponsor boards, a big LED ring above the walls. */
  protected buildNightDome(G: number): void {
    const topH = G + 0.25 + DOME_ROWS * DOME_RISE;
    const backN = DOME_N0 + DOME_ROWS * DOME_ROW_D + 0.3;
    const banks: Bank[] = [];
    const len = ARENA.maxX - ARENA.minX + 2;
    for (const side of SIDES) {
      for (let s = -len / 2 + 9; s < len / 2 - 6; s += 16) {
        if (Math.abs(s) < 22) continue;
        const [x, z] = side.map(s, backN - 0.6);
        banks.push({ x, y: topH + 2.2 + 5.6 + 2.2, z, ry: side.yaw, k: 1.6, post: 2.6 });
      }
    }
    this.buildBanks(banks);
    const words = SPONSORS.slice(0, 4).map((sp) => sp[0]);
    this.buildLedRibbon(words, WALL_C + 0.3, 0.95, 13, () => true, () => BRAWL_WALL_H, 0);
    this.buildFloodCones();
  }

  /** THE OMEGA WORKS: a packed spectator gallery rising behind the 9 m factory walls (all four sides, the three gates
   *  left clear), day and night; at night, light banks on its back wall and on the four corner towers. */
  protected buildNightOmega(): void {
    const B = ARENA.maxX;
    const terrain = this.ctx.terrain;
    const nr = this.nightRnd;
    const st = this.style;
    const tiers: Item[] = [];
    const backs: Item[] = [];
    const fronts: Item[] = [];
    const fill: Item[] = [];
    const banks: Bank[] = [];
    const ROWS_G = 6;
    const RD = 1.7;
    const RISE = 1.25;
    const N0 = 2.2;
    const backN = N0 + ROWS_G * RD + 0.3;
    for (const side of SIDES) {
      const gates = OMEGA_GATES.filter((g) =>
        side.key === 'n' ? g.z < -B : side.key === 'w' ? g.x < -B : side.key === 'e' ? g.x > B : false,
      ).map((g) => (side.key === 'n' ? g.x : g.z));
      const runs = subtract(-B - 1, B + 1, gates.map((c) => [c - 7, c + 7] as [number, number]));
      for (const [a, b] of runs) {
        const nChunk = Math.max(1, Math.round((b - a) / 16));
        const L = (b - a) / nChunk;
        for (let c = 0; c < nChunk; c++) {
          const s0 = a + c * L;
          const sc = s0 + L / 2;
          // the wall stands on the half-pipe bank: sample the ground just inside it
          let base = 0;
          for (const f of [0.1, 0.5, 0.9]) {
            const [gx, gz] = side.map(s0 + f * L, -2.4);
            base = Math.max(base, terrain.ground(gx, gz));
          }
          const wallTop = base + 9;
          const foot = wallTop - 4;
          for (let k = 0; k < ROWS_G; k++) {
            const top = wallTop + 0.5 + k * RISE;
            const [x, z] = side.map(sc, N0 + k * RD + RD / 2);
            tiers.push({ x, y: foot, z, ry: side.yaw, sx: L, sy: top - foot, sz: RD, color: k % 2 ? 0x2a2c38 : 0x3a3d4c });
            for (let s = s0 + 0.6; s < s0 + L - 0.5; s += 1.25) {
              if (nr() < 0.06) continue;
              fill.push(this.nightSpectator(side, s, N0 + k * RD + 0.85, top, 1.35, 0.3, 0.3));
            }
          }
          const [bx, bz] = side.map(sc, backN);
          const backTop = wallTop + 0.5 + ROWS_G * RISE + 2.4;
          backs.push({ x: bx, y: foot, z: bz, ry: side.yaw, sx: L, sy: backTop - foot, sz: 0.5 });
          // neon fascia along the gallery front (over the wall top)
          const [fx, fz] = side.map(sc, N0 - 0.1);
          fronts.push({ x: fx, y: wallTop + 0.2, z: fz, ry: side.yaw, sx: L, sy: 0.32, sz: 0.12, color: (c + (side.key === 'n' ? 0 : 1)) % 2 ? 0xff2bd6 : 0x18e8ff });
          for (let s = s0 + L / 2; s < s0 + L; s += 32) {
            const [qx, qz] = side.map(s, backN - 0.3);
            banks.push({ x: qx, y: backTop + 2.6, z: qz, ry: side.yaw, k: 1.5, post: 2.6 });
          }
        }
      }
    }
    const unitBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.inst(unitBox(), this.std(0xffffff, { roughness: 0.85 }), tiers, false, true);
    this.inst(unitBox(), this.std(st.trim === 0x18e8ff ? 0x2b2e3a : st.trim, { metalness: 0.4, roughness: 0.55 }), backs);
    this.inst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), fronts);
    // the gallery crowd bobs (the Works' own bob amplitude is 0 otherwise)
    this.bobAmp.value = 0.2;
    this.addCrowd([], fill);
    if (!this.night) return;
    // Night: the four corner light towers (OmegaSet, 26 m) get a lamp bank each, aimed at the middle.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * (B + 6);
      const z = sz * (B + 6);
      const ry = Math.atan2(-x, -z);
      banks.push({ x: x + Math.sin(ry) * 1.6, y: 24.2, z: z + Math.cos(ry) * 1.6, ry, k: 2.2, post: 0 });
    }
    this.buildBanks(banks);
    this.buildFloodCones();
  }

  /* ---------------------------------------------------------------- parts */

  /** Floodlight banks: a post + tilted frame with 4 x 2 lamp faces (2 instanced draws), a halo per bank in the
   *  stadium Points, and a flood head each for the cones / pools. */
  protected buildBanks(banks: Bank[]): void {
    if (!banks.length) return;
    const lampHex = this.nightDef!.flood;
    const tilt = BANK_TILT;
    const frame = merge([
      new THREE.BoxGeometry(3.1, 1.35, 0.32).rotateX(tilt),
      new THREE.BoxGeometry(3.3, 0.14, 0.6).translate(0, -0.85, 0.05),
    ]);
    const post = new THREE.BoxGeometry(0.22, 1, 0.22).translate(0, -0.5, -0.1);
    const lamps: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      lamps.push(new THREE.BoxGeometry(0.62, 0.5, 0.06).translate(-1.1 + i * 0.73, -0.29 + j * 0.58, 0.17).rotateX(tilt));
    }
    const frameItems: Item[] = [];
    const postItems: Item[] = [];
    for (const b of banks) {
      frameItems.push({ x: b.x, y: b.y, z: b.z, ry: b.ry, sx: b.k, sy: b.k, sz: b.k });
      if (b.post > 0) postItems.push({ x: b.x, y: b.y - 0.85 * b.k, z: b.z, ry: b.ry, sx: b.k, sy: b.post * b.k, sz: b.k });
    }
    const trim = this.std(0x2a2d36, { metalness: 0.6, roughness: 0.4 });
    this.inst(frame, trim, frameItems);
    if (postItems.length) this.inst(post, trim, postItems);
    else post.dispose();
    const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(lampHex).multiplyScalar(1.5), toneMapped: false });
    this.inst(merge(lamps), lampMat, frameItems);
    const g = this.glowPts!;
    for (const b of banks) {
      const fx = Math.sin(b.ry);
      const fz = Math.cos(b.ry);
      const hx = b.x + fx * 0.45 * b.k;
      const hz = b.z + fz * 0.45 * b.k;
      g.add(hx, b.y + 0.05 * b.k, hz, lampHex, 5.5 * b.k, GLOW_HALO, 0, 0.85);
      const reach = Math.min(b.y / Math.tan(tilt), Math.hypot(hx, hz) * 0.85);
      this.floodHeads.push({ x: hx, y: b.y, z: hz, tx: hx + fx * reach, tz: hz + fz * reach, k: b.k * 0.62 });
    }
  }

  /** Additive light cones (one merged draw; not on LOW) and soft pools of light on the snow (one draw). */
  protected buildFloodCones(): void {
    const heads = this.floodHeads;
    if (!heads.length) return;
    const nd = this.nightDef!;
    const cones: THREE.BufferGeometry[] = [];
    const pools: THREE.BufferGeometry[] = [];
    const lowQ = currentPreset().crowdFraction < 1;
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    const col = new THREE.Color();
    const G = this.zone.snowDepth;
    const split = nd.sky.splitSpots && nd.sky.spots;
    for (const h of heads) {
      col.setHex(split ? (h.tx < 0 ? split[0] : split[1]) : nd.flood);
      from.set(h.x, h.y, h.z);
      // aim a little short of the ground point: the cone fades out before it meets the snow
      to.set(h.tx, Math.max(0, G), h.tz);
      if (!lowQ) cones.push(floodConeGeometry(from, to, 1.1 * h.k, 7.5 * h.k, col));
      const r = 7.5 * h.k;
      const pool = new THREE.PlaneGeometry(r * 2, r * 2).rotateX(-Math.PI / 2).translate(h.tx, G + 0.07, h.tz);
      const n = pool.attributes.position.count;
      const c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.toArray(c, i * 3);
      pool.setAttribute('color', new THREE.BufferAttribute(c, 3));
      pools.push(pool);
    }
    if (cones.length) {
      const m = new THREE.Mesh(merge(cones), floodConeMaterial(brawlMode ? 0.4 : 0.5));
      m.renderOrder = 4;
      m.frustumCulled = false;
      this.add(m);
    }
    const pm = new THREE.Mesh(
      merge(pools),
      new THREE.MeshBasicMaterial({
        map: getGlowTex(), vertexColors: true, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }),
    );
    pm.renderOrder = 1;
    this.add(pm);
  }

  /** Scrolling LED board strip just above the wall tops, facing the arena (baked: one draw). `tile` = metres per
   *  texture repeat, `gap` = the gate gap half-width (0: no gates). */
  protected buildLedRibbon(words: string[], n: number, h: number, tile: number, use: (s: Side) => boolean, wallH: (s: Side) => number, gap: number): void {
    const tex = ledRibbonTexture(this.nightDef!.glow.concat(this.style.accents), words);
    this.zoneTex.push(tex);
    this.ledTex = tex;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: new THREE.Color(1.25, 1.25, 1.25) });
    const m = new THREE.Matrix4();
    for (const side of SIDES) {
      if (!use(side)) continue;
      const runs = gap > 0 ? subtract(side.s0, side.s1, gapsFor(side.key, gap)) : [[side.s0, side.s1] as [number, number]];
      for (const [a, b] of runs) {
        const len = b - a;
        const geo = new THREE.PlaneGeometry(len, h);
        const uv = geo.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setX(i, (a + uv.getX(i) * len) / tile);
        geo.rotateX(-0.18);
        const [x, z] = side.map((a + b) / 2, n);
        m.makeRotationY(side.yaw).setPosition(x, wallH(side) + h / 2 + 0.04, z);
        this.bake(geo, m, mat);
        geo.dispose();
      }
    }
  }

  /** Emits the stadium Points draw (phone lights, flashes, halos), after the crowd. */
  protected emitGlow(): void {
    const g = this.glowPts;
    this.glowPts = null;
    if (!g) return;
    this.glowU.uBob = this.bobAmp;
    this.glowU.uTime = this.bobTime;
    const pts = g.build(this.glowU);
    if (pts) this.add(pts);
  }

  /** NIGHT: turn the arena's own lights up (emissive intensities, glow sprites, unlit neon), once per material. */
  protected boostLights(): void {
    const mats = new Set<THREE.Material>();
    const roots: THREE.Object3D[] = [];
    if (this.decor) roots.push(this.decor);
    if (this.omega) roots.push(this.omega.works.group, this.omega.set.group);
    for (const r of roots) {
      r.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (Array.isArray(m)) m.forEach((x) => mats.add(x));
        else if (m) mats.add(m as THREE.Material);
      });
    }
    for (const m of mats) {
      const sm = m as THREE.MeshStandardMaterial;
      if (sm.isMeshStandardMaterial) {
        if (sm.emissiveIntensity > 0 && (sm.emissive.r + sm.emissive.g + sm.emissive.b) > 0.02) sm.emissiveIntensity *= NIGHT_BOOST;
        continue;
      }
      const sp = m as THREE.SpriteMaterial;
      if (sp.isSpriteMaterial && sp.blending === THREE.AdditiveBlending) {
        sp.opacity = Math.min(1, sp.opacity * 1.35);
        continue;
      }
      const bm = m as THREE.MeshBasicMaterial;
      if (bm.isMeshBasicMaterial && bm.toneMapped === false && !bm.map) bm.color.multiplyScalar(1.3);
    }
    for (const p of this.pulses) {
      const m = p.mat as THREE.MeshStandardMaterial;
      if (m.isMeshStandardMaterial) p.base *= NIGHT_BOOST;
      else if ((p.mat as THREE.SpriteMaterial).isSpriteMaterial) p.base = Math.min(1, p.base * 1.35);
    }
  }
}
