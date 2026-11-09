import * as THREE from 'three';
import type { ZoneDef } from '../../core/types';
import { ARENA } from '../../core/types';
import { getLavaMaterial, scorchMaterial } from '../biomes/GroundDecals';
import type { Item, Puff } from './types';
import { FOLIAGE } from './styles';
import { STAND_N0, ROWS, ROW_D, ROW_RISE, STAGE_HALF, SIDES, colored, merge } from './layout';
import { getDoorTex, latticeMast } from './textures';
import { ArenaShell } from './ArenaShell';

/** Per-theme / per-biome scenery of the campaign arenas (and the smoke / steam puffs they use). */
export class ThemeScenery extends ArenaShell {
  /* ---------- theme: Frostbite Yard (snowy scrapyard) ---------- */

  protected buildYard(G: number): void {
    const rnd = this.rnd;
    const junkCols = [0x8a4b2a, 0x5b6a7a, 0x9a3a2e, 0x3f5f8a, 0x7a7a72, 0xb08a3a, 0x4d5a3a];
    const junk: Item[] = [];
    const mounds: Item[] = [];
    const tires: Item[] = [];
    for (const p of this.scatter(18, 50, 115)) {
      const n = 8 + ((rnd() * 9) | 0);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2;
        const d = rnd() * 3.5;
        const s = 0.8 + rnd() * 1.6;
        junk.push({
          x: p.x + Math.cos(a) * d, y: G - 0.3 + rnd() * (3.6 - d) * 0.7, z: p.z + Math.sin(a) * d, ry: rnd() * 6, rx: (rnd() - 0.5) * 0.8,
          rz: (rnd() - 0.5) * 0.8, sx: s * (0.8 + rnd() * 0.8), sy: s * (0.5 + rnd() * 0.5), sz: s, color: junkCols[(rnd() * junkCols.length) | 0],
        });
      }
      mounds.push({ x: p.x, y: G - 0.4, z: p.z, ry: rnd() * 6, sx: 4.2 + rnd(), sy: 1.4 + rnd() * 0.8, sz: 4.2 + rnd() });
      for (let i = 0; i < 4; i++) tires.push({ x: p.x + (rnd() - 0.5) * 8, y: G + 0.05, z: p.z + (rnd() - 0.5) * 8, ry: 0, rx: Math.PI / 2 + (rnd() - 0.5) * 0.6, sx: 1, sy: 1, sz: 1 });
    }
    this.inst(new THREE.BoxGeometry(1, 1, 1), this.std(0xffffff, { roughness: 0.7, metalness: 0.3 }), junk);
    this.inst(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), this.std(this.zone.snowTint, { roughness: 0.85 }), mounds);
    this.inst(new THREE.TorusGeometry(0.42, 0.19, 7, 14), this.std(this.style.tire, { roughness: 0.95 }), tires);

    // shipping container stacks
    const cCols = [0xc0392b, 0x2f6fb0, 0xe0a030, 0x3c8d5a, 0x8e44ad];
    const cont: Item[] = [];
    const roofs: Item[] = [];
    const rows: [number, number, number][] = [[-74, -18, 0], [72, 8, 0], [-40, -84, Math.PI / 2], [46, -78, Math.PI / 2], [-80, 46, 0.3]];
    for (const [rx, rz, ry] of rows) {
      const n = 3 + ((rnd() * 3) | 0);
      for (let i = 0; i < n; i++) {
        const along = (i - n / 2) * 2.6;
        const hgt = 1 + ((rnd() * 3) | 0);
        for (let j = 0; j < hgt; j++) {
          const x = rx + Math.cos(ry) * along;
          const z = rz - Math.sin(ry) * along;
          cont.push({ x, y: j * 2.6, z, ry: ry + (rnd() - 0.5) * 0.06, sx: 1, sy: 1, sz: 1, color: cCols[(rnd() * cCols.length) | 0] });
          if (j === hgt - 1) roofs.push({ x, y: hgt * 2.6, z, ry, sx: 1, sy: 1, sz: 1 });
        }
      }
    }
    this.inst(new THREE.BoxGeometry(2.44, 2.6, 6.1).translate(0, 1.3, 0), this.std(0xffffff, { roughness: 0.6, metalness: 0.25 }), cont);
    this.inst(new THREE.BoxGeometry(2.5, 0.2, 6.2).translate(0, 0.1, 0), this.std(0xffffff, { roughness: 0.85 }), roofs);

    // a scrapyard crane, far north-west
    const yellow = this.std(0xf2b632, { metalness: 0.3, roughness: 0.5 });
    const crane = new THREE.Group();
    crane.position.set(-82, 0, -70);
    crane.rotation.y = 0.7;
    // tower + boom share `yellow`; cab, weight and cable differ only in colour -> one vertex-coloured draw
    const frame = new THREE.Mesh(merge([new THREE.BoxGeometry(1.6, 30, 1.6).translate(0, 15, 0), new THREE.BoxGeometry(28, 1.1, 1.1).translate(9, 30.5, 0)]), yellow);
    const dark = merge([
      colored(new THREE.BoxGeometry(2.6, 2.2, 2.4).translate(0, 28.6, 1.6), 0x30343c),
      colored(new THREE.BoxGeometry(3, 2.2, 2).translate(-5, 29.4, 0), 0x4a4f58),
      colored(new THREE.BoxGeometry(0.08, 14, 0.08).translate(19, 23.5, 0), 0x222222),
    ]);
    const parts = new THREE.Mesh(dark, this.std(0xffffff, { vertexColors: true }));
    const magnet = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.6, 14).translate(19, 16.3, 0), this.std(0x3a3f48, { metalness: 0.6 }));
    crane.add(frame, parts, magnet);
    this.add(crane);
  }

  /* ---------- theme: Pine Junkyard ---------- */

  protected buildJunkyard(G: number): void {
    const rnd = this.rnd;
    // pines
    const pts = this.scatter(360, 48, 130);
    if (pts.length) {
      const seg = 7;
      const tiers = [
        { r: 1.7, h: 2.2, y: 2.0 },
        { r: 1.3, h: 1.9, y: 3.4 },
        { r: 0.9, h: 1.6, y: 4.6 },
      ];
      const fol: THREE.BufferGeometry[] = [];
      const caps: THREE.BufferGeometry[] = [];
      for (const t of tiers) {
        fol.push(new THREE.ConeGeometry(t.r, t.h, seg).translate(0, t.y, 0));
        const ch = t.h * 0.42;
        caps.push(new THREE.ConeGeometry(t.r * 0.48, ch, seg).translate(0, t.y + t.h / 2 - ch / 2 + 0.02, 0));
        caps.push(new THREE.CylinderGeometry(t.r * 0.75, t.r * 0.98, 0.18, seg).translate(0, t.y - t.h / 2 + 0.25, 0));
      }
      const items: Item[] = pts.map((p) => {
        const s = 0.8 + rnd() * 0.9 + (Math.hypot(p.x, p.z) > 80 ? 0.5 : 0);
        return { x: p.x, y: G - 0.2, z: p.z, ry: rnd() * Math.PI * 2, sx: s, sy: s * (0.9 + rnd() * 0.35), sz: s, color: FOLIAGE[(rnd() * FOLIAGE.length) | 0] };
      });
      const plain = items.map((i) => ({ ...i, color: undefined }));
      this.inst(merge(fol), this.std(0xffffff), items);
      this.inst(merge(caps), this.std(this.zone.snowTint, { roughness: 0.85 }), plain);
      this.inst(new THREE.CylinderGeometry(0.22, 0.3, 1.6, 6).translate(0, 0.8, 0), this.std(0x6b4428, { roughness: 0.9 }), plain);
    }

    // wrecked cars (vertex-colored body/glass/wheels, tinted per instance)
    const car = merge([
      colored(new THREE.BoxGeometry(1.9, 0.8, 4.2).translate(0, 0.62, 0), 0xffffff),
      colored(new THREE.BoxGeometry(1.7, 0.66, 2.2).translate(0, 1.33, -0.3), 0xffffff),
      colored(new THREE.BoxGeometry(1.74, 0.4, 2.24).translate(0, 1.36, -0.3), 0x2a3440),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => colored(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10).rotateZ(Math.PI / 2).translate(sx * 0.95, 0.38, sz * 1.35), 0x1e1e22))),
    ]);
    const rust = [0x8a4b2a, 0x6f7a3f, 0x3f5f8a, 0x9a3a2e, 0x7a6a5a, 0xb07a3a];
    const cars: Item[] = [];
    const roofSnow: Item[] = [];
    for (const p of this.scatter(36, 48, 100)) {
      const flip = rnd() < 0.15;
      const ry = rnd() * 6.28;
      cars.push({ x: p.x, y: flip ? G + 1.65 : G - 0.15, z: p.z, ry, rx: (rnd() - 0.5) * 0.2, rz: flip ? Math.PI : (rnd() - 0.5) * 0.25, sx: 1, sy: 1, sz: 1, color: rust[(rnd() * rust.length) | 0] });
      if (!flip) roofSnow.push({ x: p.x, y: G + 1.6, z: p.z, ry, sx: 1, sy: 1, sz: 1 });
      // stacked wreck
      if (rnd() < 0.25) cars.push({ x: p.x + (rnd() - 0.5), y: G + 1.55, z: p.z + (rnd() - 0.5), ry: ry + (rnd() - 0.5) * 0.8, rz: (rnd() - 0.5) * 0.2, sx: 1, sy: 1, sz: 1, color: rust[(rnd() * rust.length) | 0] });
    }
    this.inst(car, this.std(0xffffff, { vertexColors: true, roughness: 0.7, metalness: 0.2 }), cars);
    this.inst(new THREE.BoxGeometry(1.6, 0.16, 2.0).translate(0, 0.08, -0.3), this.std(this.zone.snowTint, { roughness: 0.85 }), roofSnow);

    // stumps & logs
    const wood = this.std(0x6b4428, { roughness: 0.9 });
    this.inst(
      new THREE.CylinderGeometry(0.35, 0.4, 1, 8),
      wood,
      this.scatter(20, 48, 90).map((p) => ({ x: p.x, y: G + 0.25, z: p.z, ry: rnd() * 6.28, rz: Math.PI / 2, sx: 1, sy: 1.5 + rnd() * 2, sz: 1 })),
    );

    // the plow shed where the rogue AI lives
    const shed = new THREE.Group();
    shed.position.set(-70, 0, 34);
    shed.rotation.y = Math.atan2(70, -34);
    const body = new THREE.Mesh(new THREE.BoxGeometry(16, 7, 11).translate(0, 3.5, 0), this.std(0x7a3a28, { roughness: 0.85 }));
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.6, 16.4, 3, 1, false, Math.PI / 2).rotateZ(Math.PI / 2), this.std(this.zone.snowTint, { roughness: 0.85 }));
    roof.scale.set(1, 0.5, 1);
    roof.position.y = 7 + 1.5;
    const door = new THREE.Mesh(new THREE.BoxGeometry(7, 5, 0.2).translate(0, 2.5, 5.55), new THREE.MeshStandardMaterial({ map: getDoorTex(), color: 0x9aa0a8, roughness: 0.6 }));
    const eye = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.7, 0.1).translate(0, 6, 5.56), this.emissive(0xff2a1a, 2.2, { speed: 1.4 }));
    body.castShadow = true;
    shed.add(body, roof, door, eye);
    this.add(shed);
  }

  /* ---------- theme: Frozen Foundry ---------- */

  protected buildFoundry(G: number): void {
    const rnd = this.rnd;
    // ice-locked ground
    const ice = new THREE.Mesh(new THREE.RingGeometry(46, 118, 64, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9fd2ea, roughness: 0.12, metalness: 0.15 }));
    ice.position.y = G + 0.03;
    ice.receiveShadow = true;
    this.add(ice);

    // smokestacks
    const stacks: { x: number; y: number; z: number; r: number }[] = [];
    const sItems: Item[] = [];
    const bands: Item[] = [];
    const rims: Item[] = [];
    const spots: [number, number][] = [[-72, -62], [-30, -92], [34, -90], [80, -50], [-92, 6], [94, 22]];
    for (const [x, z] of spots) {
      const r = 2.2 + rnd() * 0.9;
      const h = 26 + rnd() * 12;
      sItems.push({ x, y: 0, z, ry: 0, sx: r, sy: h, sz: r });
      for (const f of [0.62, 0.8]) bands.push({ x, y: h * f, z, ry: 0, sx: r * 0.93, sy: 1.6, sz: r * 0.93 });
      rims.push({ x, y: h, z, ry: 0, rx: Math.PI / 2, sx: r * 0.86, sy: r * 0.86, sz: 1 });
      stacks.push({ x, y: h, z, r });
    }
    this.inst(new THREE.CylinderGeometry(0.85, 1, 1, 14).translate(0, 0.5, 0), this.std(0x5a4a44, { roughness: 0.9 }), sItems);
    this.inst(new THREE.CylinderGeometry(1, 1, 1, 14), this.std(0xe8f4fb, { roughness: 0.4 }), bands);
    this.inst(new THREE.TorusGeometry(1, 0.14, 6, 18), this.emissive(0xff7a2a, 2.2, { speed: 1.7 }), rims);
    // smoke / steam puffs (animated in update)
    const per = 7;
    const puffMat = new THREE.MeshLambertMaterial({ color: 0xe6edf2, transparent: true, opacity: 0.5, depthWrite: false });
    const puffMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), puffMat, stacks.length * per);
    puffMesh.frustumCulled = false;
    this.add(puffMesh);
    this.puffs = { mesh: puffMesh, stacks, per };

    // frozen furnaces: iron blocks with glowing mouths, sealed in ice
    const furn: [number, number][] = [[-60, 28], [62, -26], [-54, -60], [60, 48], [0, -78]];
    const iron = this.std(0x3a3436, { roughness: 0.7, metalness: 0.4 });
    const mouthMat = this.emissive(0xff6a1a, 2.4, { speed: 2.1 });
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xbfefff, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.38, depthWrite: false });
    const icicles: Item[] = [];
    for (const [x, z] of furn) {
      if (Math.abs(x) < 16 && z < -38 && z > -64) continue;
      const f = new THREE.Group();
      f.position.set(x, 0, z);
      f.rotation.y = Math.atan2(-x, -z);
      const w = 8 + rnd() * 3;
      const h = 7 + rnd() * 3;
      // body + chimney (iron) and mouth are baked into the zone batch (one draw each for all furnaces)
      f.updateMatrix();
      this.bake(new THREE.BoxGeometry(w, h, w).translate(0, h / 2, 0), f.matrix, iron);
      this.bake(new THREE.CylinderGeometry(1, 1.2, 6, 10).translate(w * 0.25, h + 3, -w * 0.2), f.matrix, iron);
      this.bake(new THREE.BoxGeometry(w * 0.45, h * 0.35, 0.1).translate(0, h * 0.3, w / 2 + 0.06), f.matrix, mouthMat);
      const shell = new THREE.Mesh(new THREE.BoxGeometry(w + 1.2, h + 1.0, w + 1.2).translate(0, (h + 1) / 2, 0), shellMat);
      shell.renderOrder = 3;
      f.add(shell);
      this.add(f);
      this.glowSprite(0xff7a2a, 0.5, w * 0.9, x + Math.sin(f.rotation.y) * (w / 2 + 1.2), h * 0.3, z + Math.cos(f.rotation.y) * (w / 2 + 1.2), 2.1);
      for (let k = 0; k < 10; k++) {
        const t = rnd() * 2 - 1;
        const side = (rnd() * 4) | 0;
        const half = (w + 1.2) / 2;
        const lx = side < 2 ? t * half : (side === 2 ? -half : half);
        const lz = side < 2 ? (side === 0 ? -half : half) : t * half;
        const ry = f.rotation.y;
        icicles.push({
          x: x + Math.cos(ry) * lx + Math.sin(ry) * lz, y: h + 1, z: z - Math.sin(ry) * lx + Math.cos(ry) * lz,
          ry: 0, rx: Math.PI, sx: 0.25 + rnd() * 0.2, sy: 1 + rnd() * 1.6, sz: 0.25 + rnd() * 0.2,
        });
      }
    }
    this.inst(new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xd8f6ff, roughness: 0.15, transparent: true, opacity: 0.85 }), icicles);

    // frosted pipes on supports
    const pipes: Item[] = [];
    const supports: Item[] = [];
    const runs: [number, number, number, number][] = [[-60, 28, -92, 6], [62, -26, 80, -50], [-54, -60, -72, -62], [60, 48, 94, 22]];
    for (const [ax, az, bx, bz] of runs) {
      const len = Math.hypot(bx - ax, bz - az);
      const ry = Math.atan2(bx - ax, bz - az);
      pipes.push({ x: (ax + bx) / 2, y: 4.2, z: (az + bz) / 2, ry, rx: Math.PI / 2, sx: 1, sy: len, sz: 1 });
      for (let t = 0.15; t < 0.9; t += 0.25) supports.push({ x: ax + (bx - ax) * t, y: 0, z: az + (bz - az) * t, ry, sx: 1, sy: 1, sz: 1 });
    }
    this.inst(new THREE.CylinderGeometry(0.6, 0.6, 1, 10), this.std(0x9fb8c8, { roughness: 0.5, metalness: 0.5 }), pipes);
    this.bakeItems(new THREE.BoxGeometry(0.4, 4.2, 0.4).translate(0, 2.1, 0), iron, supports);

    // ice crystals
    const crystals: Item[] = [];
    for (const p of this.scatter(16, 48, 95)) {
      const n = 2 + ((rnd() * 4) | 0);
      for (let k = 0; k < n; k++) {
        const s = 0.4 + rnd() * 0.7;
        crystals.push({ x: p.x + (rnd() - 0.5) * 2, y: G + s, z: p.z + (rnd() - 0.5) * 2, ry: rnd() * 6, rx: (rnd() - 0.5) * 0.7, rz: (rnd() - 0.5) * 0.7, sx: s, sy: s * (2 + rnd() * 1.5), sz: s });
      }
    }
    this.inst(new THREE.OctahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xbfefff, emissive: 0x6ff3ff, emissiveIntensity: 0.3, roughness: 0.1, flatShading: true, transparent: true, opacity: 0.85 }), crystals);
  }

  /* ---------- theme: Blizzard Bowl (whiteout stadium) ---------- */

  protected buildBowl(zone: ZoneDef): void {
    const rnd = this.rnd;
    const steps = 12;
    const R0 = 58;
    const pts: THREE.Vector2[] = [new THREE.Vector2(R0 - 1, -1), new THREE.Vector2(R0 - 1, 3.2)];
    for (let i = 0; i < steps; i++) {
      const r = R0 + i * 2;
      const y = 3.2 + i * 1.5;
      pts.push(new THREE.Vector2(r, y), new THREE.Vector2(r, y + 1.5));
    }
    const rTop = R0 + steps * 2;
    const yTop = 3.2 + steps * 1.5;
    pts.push(new THREE.Vector2(rTop, yTop), new THREE.Vector2(rTop, yTop + 2.5), new THREE.Vector2(rTop + 2, yTop + 2.5), new THREE.Vector2(rTop + 2, -1));
    const fogC = new THREE.Color(zone.fogColor);
    const bowl = new THREE.Mesh(
      new THREE.LatheGeometry(pts, 72),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(0x6f7b8a).lerp(fogC, 0.1), roughness: 0.9, flatShading: true, side: THREE.DoubleSide }),
    );
    this.add(bowl);
    // distant crowd on the bowl tiers
    const crowd: Item[] = [];
    for (let i = 0; i < 1000; i++) {
      const tier = (rnd() * steps) | 0;
      const a = rnd() * Math.PI * 2;
      const r = R0 + tier * 2 + 0.6 + rnd() * 0.8;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      const s = 1.1 + rnd() * 0.3;
      crowd.push({ x, y: 3.2 + (tier + 1) * 1.5, z, ry: Math.atan2(-x, -z), sx: s, sy: s, sz: s, color: this.crowdColor() });
    }
    this.addCrowd(crowd);
    // light masts on the rim
    const masts: Item[] = [];
    const heads: Item[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const x = Math.sin(a) * (rTop + 1);
      const z = Math.cos(a) * (rTop + 1);
      masts.push({ x, y: yTop + 2.5, z, ry: a, sx: 1, sy: 1, sz: 1 });
      heads.push({ x: x * 0.985, y: yTop + 12.5, z: z * 0.985, ry: Math.atan2(-x, -z), rx: 0.35, sx: 1, sy: 1, sz: 1 });
      this.glowSprite(0xffffff, 0.6, 12, x * 0.97, yTop + 12.5, z * 0.97);
    }
    this.inst(new THREE.BoxGeometry(0.6, 10, 0.6).translate(0, 5, 0), this.std(0x7a8490, { metalness: 0.5 }), masts);
    this.inst(new THREE.BoxGeometry(5, 2.4, 0.4), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), heads);
    // wind-swept snow fence posts
    const posts: Item[] = this.scatter(30, 48, 56).map((p) => ({ x: p.x, y: 0, z: p.z, ry: rnd() * 6, sx: 1, sy: 1, sz: 1 }));
    this.inst(new THREE.BoxGeometry(0.12, 1.8, 0.12).translate(0, 0.9, 0), this.emissive(0xff5a2a, 0.8, { speed: 4 }), posts);
  }

  /* ---------- biome: Coldboot Glacier (frozen relay station, aurora) ---------- */

  protected buildGlacier(G: number): void {
    const rnd = this.rnd;
    // ice cliffs and bergs: big faceted chunks ringing the arena
    const iceCols = [0xe2f4ff, 0xc4e6fb, 0xa9d8f6, 0xd4eeff];
    const bergs: Item[] = this.scatter(30, 52, 125).map((p) => {
      const far = Math.hypot(p.x, p.z) > 80;
      const s = (far ? 5 : 2.2) + rnd() * (far ? 8 : 3);
      return { x: p.x, y: G - s * 0.25, z: p.z, ry: rnd() * 6, rx: (rnd() - 0.5) * 0.5, rz: (rnd() - 0.5) * 0.5, sx: s * (1 + rnd() * 0.6), sy: s * (0.9 + rnd() * 1.1), sz: s, color: iceCols[(rnd() * iceCols.length) | 0] };
    });
    this.inst(new THREE.DodecahedronGeometry(1, 0), this.std(0xffffff, { roughness: 0.22, metalness: 0.05, emissive: 0x123a58, emissiveIntensity: 0.45 }), bergs, true);
    // glowing ice crystal clusters
    const crystals: Item[] = [];
    for (const p of this.scatter(22, 48, 100)) {
      const n = 2 + ((rnd() * 4) | 0);
      for (let k = 0; k < n; k++) {
        const s = 0.4 + rnd() * 0.8;
        crystals.push({ x: p.x + (rnd() - 0.5) * 2.2, y: G + s, z: p.z + (rnd() - 0.5) * 2.2, ry: rnd() * 6, rx: (rnd() - 0.5) * 0.7, rz: (rnd() - 0.5) * 0.7, sx: s, sy: s * (2 + rnd() * 1.6), sz: s });
      }
    }
    this.inst(new THREE.OctahedronGeometry(1, 0), this.emissive(0x8ff6ff, 0.9, { speed: 1.3 }), crystals);

    // the relay station (north-west): a squat white block with blue bands, a roof dish and an ice crust
    const M = new THREE.Matrix4();
    const st = new THREE.Object3D();
    st.position.set(-72, 0, -40);
    st.rotation.y = Math.atan2(72, 40);
    st.updateMatrix();
    const at = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true) =>
      this.bake(geo, M.makeTranslation(x, y, z).premultiply(st.matrix), mat, cast, cast);
    const white = this.std(0xe6edf3, { roughness: 0.6 });
    const steel = this.std(0x3a4a5c, { metalness: 0.5, roughness: 0.45 });
    at(new THREE.BoxGeometry(18, 8, 11).translate(0, 4, 0), white, 0, 0, 0);
    at(new THREE.BoxGeometry(18.2, 0.8, 11.2), this.std(0x2f6fb0, { roughness: 0.5 }), 0, 6.2, 0, false);
    at(new THREE.BoxGeometry(8, 4, 7).translate(0, 2, 0), white, -4, 8, 0);
    at(new THREE.BoxGeometry(6, 4.5, 0.2).translate(0, 2.25, 0), steel, 3, 0, 5.6, false);
    const winMat = this.emissive(0x7fe8ff, 1.2, { speed: 0.8 });
    for (let i = 0; i < 4; i++) at(new THREE.BoxGeometry(1.6, 0.9, 0.1), winMat, -7 + i * 2.4, 4.6, 5.56, false);
    // roof dish: a shallow bowl tilted at the sky, on a mast
    at(new THREE.CylinderGeometry(0.35, 0.45, 3, 8).translate(0, 1.5, 0), steel, 5, 8, -1);
    const dish = new THREE.SphereGeometry(3.4, 18, 8, 0, Math.PI * 2, 0, 0.9).rotateX(Math.PI).rotateX(-0.7);
    at(dish, this.std(0xf2f6fa, { roughness: 0.4, side: THREE.DoubleSide }), 5, 13.2, -1);
    // ice crust over the station + icicles along the eaves
    const crust = new THREE.Mesh(new THREE.BoxGeometry(19.2, 9, 12.2).translate(0, 4.5, 0), new THREE.MeshStandardMaterial({ color: 0xbfefff, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false }));
    crust.renderOrder = 3;
    crust.position.copy(st.position);
    crust.rotation.copy(st.rotation);
    this.add(crust);
    const icicles: Item[] = [];
    for (let i = 0; i < 26; i++) {
      const lx = -9 + rnd() * 18;
      const lz = rnd() < 0.5 ? 5.6 : -5.6;
      const v = new THREE.Vector3(lx, 8, lz).applyMatrix4(st.matrix);
      icicles.push({ x: v.x, y: 8, z: v.z, ry: 0, rx: Math.PI, sx: 0.22 + rnd() * 0.2, sy: 0.8 + rnd() * 1.8, sz: 0.22 + rnd() * 0.2 });
    }
    // antenna masts with blinking red beacons
    const masts: [number, number, number][] = [[-58, -66, 34], [84, -44, 28], [-88, 34, 24], [70, 70, 26]];
    const mastItems: Item[] = masts.map(([x, z, h]) => ({ x, y: 0, z, ry: rnd() * 6, sx: 1, sy: h / 30, sz: 1 }));
    this.inst(latticeMast(30, 1.6), this.std(0xd8dee6, { metalness: 0.5, roughness: 0.45 }), mastItems, true);
    const beacon = this.emissive(0xff2a2a, 2.4, { speed: 3.1 });
    this.inst(new THREE.SphereGeometry(0.5, 10, 8), beacon, masts.map(([x, z, h]) => ({ x, y: h + 0.4, z, ry: 0, sx: 1, sy: 1, sz: 1 })));
    for (const [x, z, h] of masts) this.glowSprite(0xff3a3a, 0.7, 5, x, h + 0.4, z, 3.1);

    // frozen server racks: rows of dark cabinets with LED panels, sealed in ice
    const racks: Item[] = [];
    const leds: Item[] = [];
    const shells: Item[] = [];
    const rows: [number, number, number][] = [[58, -66, 0.6], [-56, 66, 2.3], [88, 12, -1.4], [-90, -8, 1.6], [30, 86, 0.2]];
    for (const [cx, cz, ry] of rows) {
      const n = 4 + ((rnd() * 3) | 0);
      const c = Math.cos(ry);
      const s = Math.sin(ry);
      for (let i = 0; i < n; i++) {
        const along = (i - (n - 1) / 2) * 1.05;
        const x = cx + c * along;
        const z = cz - s * along;
        const tilt = (rnd() - 0.5) * 0.12;
        racks.push({ x, y: G - 0.3, z, ry, rz: tilt, sx: 1, sy: 1, sz: 1, color: rnd() < 0.2 ? 0x2a3a4a : 0x1a222c });
        for (let k = 0; k < 5; k++) leds.push({ x: x + s * 0.56, y: G + 0.15 + k * 0.42, z: z + c * 0.56, ry, sx: 1, sy: 1, sz: 1, color: rnd() < 0.7 ? 0x4dffb0 : 0x5fd8ff });
      }
      shells.push({ x: cx, y: G - 0.4, z: cz, ry, sx: n * 1.05 + 1.2, sy: 3.2, sz: 2.2 });
      for (let k = 0; k < 8; k++) icicles.push({ x: cx + c * (rnd() - 0.5) * n, y: G + 2.8, z: cz - s * (rnd() - 0.5) * n, ry: 0, rx: Math.PI, sx: 0.2, sy: 0.6 + rnd(), sz: 0.2 });
    }
    this.inst(new THREE.BoxGeometry(0.95, 2.4, 1.05).translate(0, 1.2, 0), this.std(0xffffff, { roughness: 0.5, metalness: 0.4 }), racks, true);
    this.inst(new THREE.BoxGeometry(0.7, 0.08, 0.04), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), leds);
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xc8f2ff, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false });
    const sh = this.inst(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), shellMat, shells);
    if (sh) sh.renderOrder = 3;
    this.inst(new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xd8f6ff, roughness: 0.15, transparent: true, opacity: 0.85 }), icicles);
    // two big ground dishes listening north
    for (const [x, z] of [[38, -84], [-34, -88]] as [number, number][]) {
      this.bake(new THREE.CylinderGeometry(0.8, 1.4, 6, 8).translate(0, 3, 0), M.makeTranslation(x, 0, z), steel, true);
      this.bake(new THREE.SphereGeometry(6, 20, 8, 0, Math.PI * 2, 0, 0.85).rotateX(Math.PI).rotateX(-0.9), M.makeTranslation(x, 8.5, z), this.std(0xf0f4f8, { roughness: 0.45, side: THREE.DoubleSide }), true);
    }
  }

  /* ---------- biome: Inferno Quarry (basalt terraces, lava falls, ash) ---------- */

  protected buildQuarry(G: number): void {
    const rnd = this.rnd;
    const M = new THREE.Matrix4();
    // stepped quarry terraces ringing the arena: you fight at the bottom of the pit
    const R0 = 56;
    const STEP_R = 6.5;
    const STEP_H = 2.6;
    const STEPS = 7;
    const pts: THREE.Vector2[] = [new THREE.Vector2(R0, -1)];
    for (let i = 0; i < STEPS; i++) {
      const r = R0 + i * STEP_R;
      pts.push(new THREE.Vector2(r, (i + 1) * STEP_H), new THREE.Vector2(r + STEP_R - 0.6, (i + 1) * STEP_H));
    }
    pts.push(new THREE.Vector2(R0 + STEPS * STEP_R + 4, STEPS * STEP_H + 1), new THREE.Vector2(R0 + STEPS * STEP_R + 8, -1));
    const rock = this.std(0x2c2422, { roughness: 0.95 });
    const terr = new THREE.Mesh(new THREE.LatheGeometry(pts, 64), rock);
    terr.receiveShadow = true;
    this.add(terr);
    // glowing seams along every step edge (one merged draw)
    const seams: THREE.BufferGeometry[] = [];
    for (let i = 0; i < STEPS; i++) seams.push(new THREE.TorusGeometry(R0 + i * STEP_R + 0.05, 0.14, 4, 96).rotateX(Math.PI / 2).translate(0, (i + 1) * STEP_H - 0.25, 0));
    this.bake(merge(seams), M.identity(), this.emissive(0xff5a14, 1.8, { speed: 1.2 }));
    const stepY = (r: number) => (r < R0 ? 0 : Math.min(STEPS, Math.floor((r - R0) / STEP_R) + 1) * STEP_H);

    // lava falls pouring down the terraces into pools at the bottom
    const lava = getLavaMaterial();
    const fallAngles = [0.55, 1.9, 2.6, 4.1, 5.3];
    for (const a of fallAngles) {
      const sx = Math.sin(a);
      const sz = Math.cos(a);
      const w = 3 + rnd() * 2;
      const top = (STEPS - 1) * STEP_R;
      const g = new THREE.PlaneGeometry(w, Math.hypot(top, STEPS * STEP_H), 1, 8);
      const tilt = Math.atan2(top, STEPS * STEP_H);
      g.rotateX(-tilt);
      g.translate(0, (STEPS * STEP_H) / 2 + 0.3, -(R0 + top / 2 - 0.3));
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * 12, uv.getX(i) * 2 - 1);
      g.rotateY(Math.atan2(-sx, -sz));
      this.bake(g, M.identity(), lava);
      const pool = new THREE.CircleGeometry(3.2 + rnd(), 18).rotateX(-Math.PI / 2);
      this.bake(pool, M.makeTranslation(sx * (R0 - 2.6), 0.08, sz * (R0 - 2.6)), lava);
      this.glowSprite(0xff6a1a, 0.55, 10, sx * (R0 - 2), 2, sz * (R0 - 2), 1.6);
    }

    // basalt column clusters on the ledges and around the pit floor
    const cols: Item[] = [];
    for (const p of this.scatter(26, 48, 100)) {
      const r = Math.hypot(p.x, p.z);
      const y0 = stepY(r);
      const n = 3 + ((rnd() * 5) | 0);
      for (let k = 0; k < n; k++) {
        const s = 0.6 + rnd() * 0.7;
        const h = 1.5 + rnd() * (r > 80 ? 9 : 5);
        cols.push({ x: p.x + (rnd() - 0.5) * 3, y: y0 - 0.3, z: p.z + (rnd() - 0.5) * 3, ry: rnd(), sx: s, sy: h, sz: s, color: rnd() < 0.5 ? 0x2a2523 : 0x37302d });
      }
    }
    this.inst(new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0), this.std(0xffffff, { roughness: 0.85 }), cols, true);
    // glowing cracks on the pit floor between the stands and the terraces
    const cracks: Item[] = this.scatter(26, 48, 55).map((p) => ({ x: p.x, y: 0.07, z: p.z, ry: rnd() * 6, sx: 0.25 + rnd() * 0.2, sy: 1, sz: 3 + rnd() * 5 }));
    this.inst(new THREE.BoxGeometry(1, 0.05, 1), this.emissive(0xff6a1a, 1.6, { speed: 2.2 }), cracks);

    // BULLDOZA's dig site: a rusty excavator + dump truck on a ledge (north-east)
    const yel = this.std(0xd18a1e, { roughness: 0.7, metalness: 0.3 });
    const dark = this.std(0x1e1a18, { roughness: 0.8 });
    const ex = new THREE.Object3D();
    ex.position.set(64, stepY(Math.hypot(64, -58)), -58);
    ex.rotation.y = 2.3;
    ex.updateMatrix();
    const xb = (geo: THREE.BufferGeometry, mat: THREE.Material) => this.bake(geo, ex.matrix, mat, true);
    xb(new THREE.BoxGeometry(5, 1.4, 7).translate(0, 0.7, 0), dark);
    xb(new THREE.BoxGeometry(4.2, 2.6, 4.6).translate(0, 2.7, -0.6), yel);
    xb(new THREE.BoxGeometry(2, 2, 2).translate(-1, 4.9, 0.6), yel);
    xb(new THREE.BoxGeometry(1, 1, 9).rotateX(-0.5).translate(1, 6, 5.2), yel);
    xb(new THREE.BoxGeometry(0.9, 0.9, 6).rotateX(0.7).translate(1, 6.4, 11), yel);
    xb(new THREE.BoxGeometry(2.4, 2, 1.6).translate(1, 3.4, 13), dark);
    const tr = new THREE.Object3D();
    tr.position.set(-70, stepY(Math.hypot(-70, -50)), -50);
    tr.rotation.y = -0.6;
    tr.updateMatrix();
    const tb = (geo: THREE.BufferGeometry, mat: THREE.Material) => this.bake(geo, tr.matrix, mat, true);
    tb(new THREE.BoxGeometry(5.5, 3.2, 8).translate(0, 3.6, -1), yel);
    tb(new THREE.BoxGeometry(4.6, 2.8, 3).translate(0, 3.2, 4.4), yel);
    for (const wx of [-2.6, 2.6]) for (const wz of [-3.5, 0, 4.4]) tb(new THREE.CylinderGeometry(1.1, 1.1, 0.9, 10).rotateZ(Math.PI / 2).translate(wx, 1.1, wz), dark);

    // smoke plumes off the rim and the lava pools
    const stacks: Puff[] = [];
    for (let i = 0; i < 6; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 62 + rnd() * 35;
      stacks.push({ x: Math.sin(a) * r, y: stepY(r), z: Math.cos(a) * r, r: 2.4 + rnd() * 1.5, rise: 22, drift: 12 });
    }
    for (const a of fallAngles.slice(0, 3)) stacks.push({ x: Math.sin(a) * (R0 - 2.6), y: 0, z: Math.cos(a) * (R0 - 2.6), r: 1.6, rise: 12, drift: 5 });
    this.addPuffs(stacks, 0x3a2e2c, 0.55);
  }

  /* ---------- biome: Rust Basin (mesas, dunes, the drill rig) ---------- */

  protected buildMars(G: number): void {
    const rnd = this.rnd;
    const M = new THREE.Matrix4();
    // banded buttes: a wide base and a narrower cap, two rust tones
    const tones = [0xa8532e, 0xc06a3e, 0x8e4428, 0xb85f34];
    const bases: Item[] = [];
    const caps: Item[] = [];
    for (const p of this.scatter(18, 58, 125, true)) {
      const r = 5 + rnd() * 9;
      const h = 8 + rnd() * 18;
      const ry = rnd() * 6;
      bases.push({ x: p.x, y: 0, z: p.z, ry, sx: r, sy: h * 0.62, sz: r * (0.8 + rnd() * 0.4), color: tones[(rnd() * tones.length) | 0] });
      caps.push({ x: p.x, y: h * 0.62 - 0.1, z: p.z, ry, sx: r * 0.82, sy: h * 0.38, sz: r * 0.7, color: tones[(rnd() * tones.length) | 0] });
    }
    for (const p of this.scatter(12, 48, 75)) {
      const r = 1.6 + rnd() * 2.2;
      const h = 2 + rnd() * 4;
      bases.push({ x: p.x, y: G - 0.3, z: p.z, ry: rnd() * 6, sx: r, sy: h, sz: r * 0.9, color: tones[(rnd() * tones.length) | 0] });
    }
    const buttes = this.inst(new THREE.CylinderGeometry(0.88, 1, 1, 7).translate(0, 0.5, 0), this.std(0xffffff, { roughness: 0.95 }), [...bases, ...caps], true);
    if (buttes) buttes.renderOrder = 0;
    // scattered boulders
    const rocks: Item[] = this.scatter(70, 48, 110).map((p) => {
      const s = 0.5 + rnd() * 1.8;
      return { x: p.x, y: G - s * 0.2, z: p.z, ry: rnd() * 6, rx: rnd(), sx: s * (1 + rnd() * 0.5), sy: s * 0.7, sz: s, color: tones[(rnd() * tones.length) | 0] };
    });
    this.inst(new THREE.DodecahedronGeometry(1, 0), this.std(0xffffff, { roughness: 0.9 }), rocks, true);
    // crater rims out on the plain
    const rims: Item[] = this.scatter(8, 52, 105).map((p) => {
      const s = 4 + rnd() * 6;
      return { x: p.x, y: G - 0.25, z: p.z, ry: 0, rx: Math.PI / 2, sx: s, sy: s, sz: 1.2 };
    });
    this.inst(new THREE.TorusGeometry(1, 0.22, 5, 18), this.std(0xb4643a, { roughness: 0.95 }), rims, false, true);

    // THE GRINDER's drill rig (north-east): lattice derrick, spinning bit, dust plume
    const rx = 66;
    const rz = -66;
    this.inst(latticeMast(28, 3), this.std(0xd8d2c8, { metalness: 0.4, roughness: 0.5 }), [{ x: rx, y: 0, z: rz, ry: 0.4, sx: 1, sy: 1, sz: 1 }], true);
    this.bake(new THREE.BoxGeometry(9, 2, 9).translate(0, 1, 0), M.makeTranslation(rx, 0, rz), this.std(0x4a4f58, { metalness: 0.5 }), true);
    const drill = new THREE.Group();
    drill.position.set(rx, 2, rz);
    drill.rotation.x = -Math.PI / 2;
    const bitMat = this.std(0xff8a3d, { metalness: 0.6, roughness: 0.35, emissive: 0x401800, emissiveIntensity: 0.6 });
    const bit = new THREE.Mesh(merge([
      new THREE.CylinderGeometry(0.7, 0.7, 20, 8).rotateX(Math.PI / 2).translate(0, 0, 10),
      new THREE.ConeGeometry(2.2, 4, 6).rotateX(-Math.PI / 2).translate(0, 0, -1.5),
      new THREE.TorusGeometry(1.8, 0.35, 5, 12).translate(0, 0, 3),
      new THREE.TorusGeometry(1.4, 0.3, 5, 12).translate(0, 0, 6),
    ]), bitMat);
    bit.castShadow = true;
    drill.add(bit);
    this.add(drill);
    this.spinners.push({ obj: bit, speed: 2.4 });
    this.glowSprite(0xffa040, 0.8, 4, rx, 29, rz, 2.5);
    // habitat: white domes, a tube and solar arrays (south-west)
    const hx = -70;
    const hz = 50;
    const hab = this.std(0xeee8dc, { roughness: 0.55 });
    for (const [dx, dz, r] of [[0, 0, 6], [10, 4, 4], [-6, 9, 3.5]] as [number, number, number][]) {
      this.bake(new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.makeTranslation(hx + dx, 0, hz + dz), hab, true);
      this.bake(new THREE.TorusGeometry(r * 0.98, 0.18, 4, 24).rotateX(Math.PI / 2), M.makeTranslation(hx + dx, r * 0.35, hz + dz), this.emissive(0x7fd8ff, 1.2, { speed: 0.7 }));
    }
    this.bake(new THREE.CylinderGeometry(1.1, 1.1, 10, 10).rotateZ(Math.PI / 2).rotateY(-0.38), M.makeTranslation(hx + 5, 1.1, hz + 2), hab, true);
    const panels: Item[] = [];
    for (let i = 0; i < 8; i++) panels.push({ x: hx + 16 + (i % 4) * 3.4, y: 1.6, z: hz - 8 + Math.floor(i / 4) * 4, ry: 0.3, rx: -0.6, sx: 1, sy: 1, sz: 1 });
    this.inst(new THREE.BoxGeometry(3, 0.12, 2.2), this.std(0x1f3d78, { metalness: 0.6, roughness: 0.3, emissive: 0x0a1838, emissiveIntensity: 0.5 }), panels);
    // dust plumes off the drill and the dunes
    const stacks: Puff[] = [{ x: rx, y: 0, z: rz, r: 2.2, rise: 10, drift: 18 }];
    for (let i = 0; i < 4; i++) {
      const a = rnd() * Math.PI * 2;
      stacks.push({ x: Math.sin(a) * 90, y: 0, z: Math.cos(a) * 90, r: 3.5, rise: 8, drift: 26 });
    }
    this.addPuffs(stacks, 0xd09068, 0.35);
  }

  /* ---------- biome: The Thermal Divide (hot west, frozen east) ---------- */

  protected buildDivide(G: number): void {
    const rnd = this.rnd;
    const M = new THREE.Matrix4();
    const lava = getLavaMaterial();
    // scorched basalt over the hot half of the world outside the field (the field's own half is GroundDecals'):
    // one U-shaped flat mesh around the west half of the arena, fading out toward the x = 0 divide line
    const h = (this.ctx.snow?.size ?? 2 * ARENA.maxX) / 2;
    const O = 240;
    const u = new THREE.Shape([
      new THREE.Vector2(-O, -O), new THREE.Vector2(0, -O), new THREE.Vector2(0, -h), new THREE.Vector2(-h, -h),
      new THREE.Vector2(-h, h), new THREE.Vector2(0, h), new THREE.Vector2(0, O), new THREE.Vector2(-O, O),
    ]);
    const skirt = new THREE.Mesh(new THREE.ShapeGeometry(u).rotateX(-Math.PI / 2).translate(0, G + 0.03, 0), scorchMaterial(-1, 0.62));
    skirt.matrixAutoUpdate = false;
    skirt.renderOrder = 1;
    this.decor!.add(skirt);
    // spires: red rock on the hot side, ice on the cold side
    const spires: Item[] = [];
    for (const p of this.scatter(60, 50, 125)) {
      const far = Math.hypot(p.x, p.z) > 78;
      const r = 1.4 + rnd() * (far ? 4.5 : 2);
      const h = (far ? 12 : 4) + rnd() * (far ? 22 : 8);
      const hot = p.x < 0;
      spires.push({ x: p.x, y: G - 0.6, z: p.z, ry: rnd() * 6, rx: (rnd() - 0.5) * 0.25, rz: (rnd() - 0.5) * 0.25, sx: r, sy: h, sz: r * (0.7 + rnd() * 0.5), color: hot ? (rnd() < 0.5 ? 0x6e2618 : 0x8a3420) : rnd() < 0.5 ? 0xcdeefc : 0xa6d6f2 });
    }
    this.inst(new THREE.ConeGeometry(1, 1, 5, 1).translate(0, 0.5, 0), this.std(0xffffff, { roughness: 0.6, metalness: 0.05 }), spires, true);
    // hot side: lava pools and geysers venting steam
    const stacks: Puff[] = [];
    for (const p of this.scatter(14, 50, 100).filter((q) => q.x < -8)) {
      const r = 1.5 + rnd() * 2.5;
      this.bake(new THREE.CircleGeometry(r, 16).rotateX(-Math.PI / 2), M.makeTranslation(p.x, G + 0.06, p.z), lava);
      this.glowSprite(0xff6a1a, 0.5, r * 3.5, p.x, G + 1, p.z, 1.8);
      stacks.push({ x: p.x, y: G, z: p.z, r: 1 + r * 0.4, rise: 10 + rnd() * 6, drift: 4 });
    }
    // the arena's own lava vents steam too
    for (const pt of this.ctx.terrain.patches) {
      if (pt.material !== 'lava') continue;
      stacks.push({ x: pt.x2 !== undefined ? (pt.x + pt.x2) / 2 : pt.x, y: this.ctx.terrain.ground(pt.x, pt.z) + G * 0.5, z: pt.z2 !== undefined ? (pt.z + pt.z2) / 2 : pt.z, r: 0.9, rise: 7, drift: 2.5 });
    }
    this.addPuffs(stacks, 0xf4ece8, 0.42);
    // cold side: frozen pines and crystal clusters
    const pines: Item[] = this.scatter(80, 50, 120).filter((p) => p.x > 8).map((p) => {
      const s = 0.9 + rnd() * 1.2;
      return { x: p.x, y: G - 0.2, z: p.z, ry: rnd() * 6, sx: s, sy: s * (1 + rnd() * 0.4), sz: s };
    });
    this.inst(merge([
      new THREE.ConeGeometry(1.7, 2.4, 7).translate(0, 2.1, 0),
      new THREE.ConeGeometry(1.3, 2.0, 7).translate(0, 3.5, 0),
      new THREE.ConeGeometry(0.9, 1.7, 7).translate(0, 4.7, 0),
      new THREE.CylinderGeometry(0.22, 0.3, 1.4, 6).translate(0, 0.7, 0),
    ]), this.std(0xe8f4fb, { roughness: 0.75 }), pines);
    const crystals: Item[] = [];
    for (const p of this.scatter(16, 48, 90).filter((q) => q.x > 8)) {
      for (let k = 0; k < 3; k++) {
        const s = 0.4 + rnd() * 0.7;
        crystals.push({ x: p.x + (rnd() - 0.5) * 2, y: G + s, z: p.z + (rnd() - 0.5) * 2, ry: rnd() * 6, rx: (rnd() - 0.5) * 0.7, rz: (rnd() - 0.5) * 0.7, sx: s, sy: s * 2.6, sz: s });
      }
    }
    this.inst(new THREE.OctahedronGeometry(1, 0), this.emissive(0x8ff0ff, 0.9, { speed: 1.4 }), crystals);
    // the Divide monolith far to the north: one half glowing magma, the other glowing ice
    const mz = -100;
    const hot = this.emissive(0xff4a10, 1.6, { speed: 0.9 });
    const cold = this.emissive(0x4fd8ff, 1.6, { speed: 0.9, phase: 3 });
    hot.fog = cold.fog = false;
    this.bake(new THREE.BoxGeometry(5, 46, 6).translate(-2.5, 23, 0), M.makeTranslation(0, 0, mz), hot);
    this.bake(new THREE.BoxGeometry(5, 46, 6).translate(2.5, 23, 0), M.makeTranslation(0, 0, mz), cold);
    const capMat = this.std(0x1a1620, { roughness: 0.6, fog: false });
    this.bake(new THREE.BoxGeometry(12, 3, 9).translate(0, 1.5, 0), M.makeTranslation(0, 0, mz), capMat);
    this.bake(new THREE.ConeGeometry(4.6, 8, 4).rotateY(Math.PI / 4).translate(0, 50, 0), M.makeTranslation(0, 0, mz), capMat);
    this.glowSprite(0xff6a2a, 0.55, 26, -6, 30, mz, 1.1).material.fog = false;
    this.glowSprite(0x5fd8ff, 0.55, 26, 6, 30, mz, 1.3).material.fog = false;
  }

  /* ---------- biome: Golden Tower Plaza summer dressing ---------- */

  protected buildSummer(): void {
    const rnd = this.rnd;
    // leafy trees around the plaza
    const trees: Item[] = this.scatter(70, 52, 120).filter((p) => !(p.z > 30 && Math.abs(p.x) < 60 && Math.hypot(p.x, p.z) > 80)).map((p) => {
      const s = 1 + rnd() * 1.1;
      return { x: p.x, y: 0, z: p.z, ry: rnd() * 6, sx: s, sy: s * (0.9 + rnd() * 0.3), sz: s, color: [0x3f8f3a, 0x4fa043, 0x357a32, 0x5aa84a][(rnd() * 4) | 0] };
    });
    this.inst(merge([
      colored(new THREE.CylinderGeometry(0.28, 0.38, 2.6, 6).translate(0, 1.3, 0).toNonIndexed(), 0x6b4428),
      colored(new THREE.IcosahedronGeometry(1.9, 0).translate(0, 3.9, 0), 0xffffff),
      colored(new THREE.IcosahedronGeometry(1.3, 0).translate(0.9, 4.9, 0.3), 0xffffff),
    ]), this.std(0xffffff, { vertexColors: true, roughness: 0.8 }), trees, true);
    // red / white / blue balloon bunches tied above the stands
    const balloons: Item[] = [];
    const strings: Item[] = [];
    for (const side of SIDES) {
      if (side.key === 's') continue;
      for (let k = 0; k < 6; k++) {
        const s = ARENA.minX + 4 + k * ((ARENA.maxX - ARENA.minX - 8) / 5);
        if (side.key === 'n' && Math.abs(s) < STAGE_HALF + 2) continue;
        const [x, z] = side.map(s, STAND_N0 + ROWS * ROW_D + 0.2);
        const top = this.zone.snowDepth + 0.25 + ROWS * ROW_RISE + 5.5;
        for (let b = 0; b < 5; b++) {
          const col = [0xc8102e, 0xffffff, 0x1f3b8c, 0xf2c033][(rnd() * 4) | 0];
          balloons.push({ x: x + (rnd() - 0.5) * 1.4, y: top + rnd() * 1.4, z: z + (rnd() - 0.5) * 1.4, ry: 0, sx: 0.55, sy: 0.68, sz: 0.55, color: col });
        }
        strings.push({ x, y: top - 3.6, z, ry: 0, sx: 1, sy: 1, sz: 1 });
      }
    }
    this.inst(new THREE.SphereGeometry(1, 10, 8), this.std(0xffffff, { roughness: 0.3, metalness: 0.1 }), balloons);
    this.inst(new THREE.CylinderGeometry(0.015, 0.015, 3.8, 3).translate(0, 1.9, 0), this.std(0xdddddd), strings);
  }

  /** Smoke / steam columns animated in update() (one instanced draw). */
  protected addPuffs(stacks: Puff[], color: number, opacity: number): void {
    const per = 7;
    // Self-lit a little, so a puff seen from its shaded side never reads as a dark blob.
    const puffMat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.45, transparent: true, opacity, depthWrite: false });
    const puffMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), puffMat, stacks.length * per);
    puffMesh.frustumCulled = false;
    this.add(puffMesh);
    this.puffs = { mesh: puffMesh, stacks, per };
  }
}
