import * as THREE from 'three';
import type { ZoneDef } from '../../core/types';
import { ARENA, ENEMY_GATES, GATE_WIDTH } from '../../core/types';
import { StaticBatch } from '../../render/mergeStatic';
import { getUsFlagTex, RALLY_SIGNS } from '../rallyTextures';
import type { Item, GateMats } from './types';
import { DIVIDE_HOT, DIVIDE_COLD } from './styles';
import { WALL_IN, WALL_T, WALL_C, WALL_H, SOUTH_H, GATE_HALF, PILLAR_W, STAND_N0, ROWS, ROW_D, ROW_RISE, TOWER_OFF, TUNNEL_LEN, brawlMode, BRAWL_WALL_H, SIDES, gapsFor, subtract, merge } from './layout';
import { canvas, toTex, getGlowTex, getHazardTex, getDoorTex, getBannerTex, getChevronTex, hexCss, wavyFlag } from './textures';
import { EnvironmentCore } from './EnvironmentCore';

/** Arena shell: walls, gates, stands, towers, jumbotron, south dressing, mountains and drifts. */
export class ArenaShell extends EnvironmentCore {
  /** Scatter points outside the arena + stands. `huge` items (>18 m) stay clear of the menu orbit (r=50, y=24). */
  protected scatter(count: number, minR: number, maxR: number, huge = false): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    const rnd = this.rnd;
    let tries = 0;
    while (out.length < count && tries < count * 40) {
      tries++;
      const x = (rnd() * 2 - 1) * maxR;
      const z = (rnd() * 2 - 1) * maxR;
      const r = Math.hypot(x, z);
      if (r > maxR || r < minR) continue;
      if (Math.abs(x) < 47 && Math.abs(z) < 47) continue;
      if (Math.abs(x) < 16 && z < -38 && z > -64) continue; // jumbotron
      if (huge && r < 66) continue;
      out.push({ x, z });
    }
    return out;
  }

  /* ---------- walls ---------- */

  protected buildWalls(G: number, snowMat: THREE.Material): void {
    const st = this.style;
    const rnd = this.rnd;
    const blocks: Item[] = [];
    const caps: Item[] = [];
    const bands: Item[] = [];
    const posts: Item[] = [];
    const lamps: Item[] = [];
    const banners: Item[] = [];
    const tires: Item[] = [];
    const blockCol = new THREE.Color();
    const cA = new THREE.Color(st.block);
    const cB = new THREE.Color(st.blockAlt);

    for (const side of SIDES) {
      const runs = subtract(side.s0, side.s1, gapsFor(side.key, GATE_HALF + PILLAR_W));
      const h = side.h;
      let bi = 0;
      for (const [a, b] of runs) {
        const len = b - a;
        const n = Math.max(1, Math.round(len / 2.9));
        const L = len / n;
        for (let k = 0; k < n; k++, bi++) {
          const sc = a + (k + 0.5) * L;
          const [x, z] = side.map(sc, WALL_IN + WALL_T / 2);
          const bh = h * (0.97 + rnd() * 0.06);
          if (this.biome === 'divide') {
            const pal = x < 0 || (Math.abs(x) < 1 && z < 0) ? DIVIDE_HOT : DIVIDE_COLD;
            cA.setHex(pal[0]);
            cB.setHex(pal[1]);
          }
          blockCol.copy(cA).lerp(cB, rnd());
          blocks.push({ x, y: 0, z, ry: side.yaw + (rnd() - 0.5) * 0.025, sx: L - 0.14, sy: bh, sz: WALL_T * (0.96 + rnd() * 0.05), color: blockCol.getHex() });
          caps.push({ x, y: bh - 0.06, z, ry: side.yaw, sx: (L - 0.14) * 0.5, sy: 0.2 + rnd() * 0.1, sz: WALL_T * 0.52 });
          const [bx, bz] = side.map(sc, WALL_IN - 0.035);
          bands.push({ x: bx, y: h - 0.62, z: bz, ry: side.yaw, sx: L - 0.1, sy: 1, sz: 1 });
          if (side.key !== 's' && bi % 2 === 1 && !this.isRally) {
            const [fx, fz] = side.map(sc, WALL_IN - 0.09);
            banners.push({ x: fx, y: h - 1.22, z: fz, ry: side.yaw, sx: 1, sy: 1, sz: 1, color: st.accents[(bi >> 1) % st.accents.length] });
          }
          if (rnd() < 0.3) {
            const [tx, tz] = side.map(sc + (rnd() - 0.5) * 1.2, WALL_C + 0.8);
            const nT = 2 + ((rnd() * 3) | 0);
            for (let j = 0; j < nT; j++) {
              tires.push({ x: tx + (rnd() - 0.5) * 0.08, y: G - 0.15 + j * 0.36, z: tz, ry: rnd() * 6, rx: Math.PI / 2, sx: 1, sy: 1, sz: 1 });
            }
          }
          if (k > 0) {
            const [px, pz] = side.map(a + k * L, WALL_IN + 0.22);
            posts.push({ x: px, y: 0, z: pz, ry: side.yaw, sx: 1, sy: h + 0.3, sz: 1 });
            lamps.push({ x: px, y: h + 0.3, z: pz, ry: side.yaw, sx: 1, sy: 1, sz: 1 });
          }
        }
      }
    }
    // corner pillars
    const corners: [number, number][] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) corners.push([sx * (ARENA.maxX + WALL_C / 2), sz * (ARENA.maxZ + WALL_C / 2)]);
    const cornerItems: Item[] = corners.map(([x, z]) => ({ x, y: 0, z, ry: 0, sx: WALL_C, sy: (brawlMode ? BRAWL_WALL_H : z > 0 ? SOUTH_H : WALL_H) + 0.7, sz: WALL_C }));

    const unitBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.inst(unitBox(), this.std(0xffffff, { roughness: 0.55, metalness: 0.02 }), blocks, true, true);
    // block caps + corner caps: same hemisphere, material and flags -> one draw
    const cornerCaps = cornerItems.map((c) => ({ ...c, y: c.sy - 0.05, sx: WALL_C * 0.55, sy: 0.4, sz: WALL_C * 0.55 }));
    this.inst(new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), snowMat, [...caps, ...cornerCaps]);
    const hazardMat = this.isRally ? this.std(0xe8b423, { roughness: 0.35, metalness: 0.35, emissive: 0x4a3000, emissiveIntensity: 0.35 }) : this.std(0xffffff, { map: getHazardTex(), roughness: 0.6, flatShading: false });
    this.inst(new THREE.BoxGeometry(1, 0.38, 0.07).translate(0, 0.19, 0), hazardMat, bands);
    const trimMat = this.std(st.trim, { metalness: 0.55, roughness: 0.45 });
    this.inst(new THREE.BoxGeometry(0.36, 1, 0.4).translate(0, 0.5, 0), trimMat, posts, true);
    this.inst(unitBox(), this.std(st.trim, { metalness: 0.4, roughness: 0.5 }), cornerItems, true, true);
    this.inst(new THREE.BoxGeometry(0.26, 0.16, 0.26).translate(0, 0.08, 0), this.emissive(st.gate, 1.2, { speed: 2.6 }), lamps);
    const bannerMat = new THREE.MeshStandardMaterial({ map: getBannerTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75 });
    this.inst(new THREE.PlaneGeometry(1.0, 1.3), bannerMat, banners);
    // Campaign: the tire stacks behind the south wall share this draw (buildSouthDressing emits it).
    this.wallTires = { items: tires, mat: this.std(st.tire, { roughness: 0.95 }) };
    if (brawlMode) this.emitTires([]);
  }

  protected emitTires(more: Item[]): void {
    const t = this.wallTires!;
    this.wallTires = null;
    this.inst(new THREE.TorusGeometry(0.42, 0.19, 7, 14), t.mat, [...t.items, ...more], true);
  }

  /* ---------- gates ---------- */

  /** The three enemy gates. Static parts are baked into the zone batch (one draw per material + flags for all
   *  gates; the materials are shared by the gates and created in the same order as before, so draw order stays the
   *  same), each gate keeps its own animated light / portal / ramp / glow materials, and the roll-up doors are one
   *  InstancedMesh. */
  protected buildGates(G: number, snowMat: THREE.Material): void {
    const shared: GateMats = {};
    for (let i = 0; i < ENEMY_GATES.length; i++) this.buildGate(i, G, snowMat, shared);
    const doorGeo = new THREE.BoxGeometry(GATE_WIDTH - 0.05, 3.5, 0.18).translate(0, -1.75, 0);
    const doors = new THREE.InstancedMesh(doorGeo, shared.door!, this.gates.length);
    for (let i = 0; i < this.gates.length; i++) doors.setMatrixAt(i, this.gates[i].doorBase);
    doors.castShadow = true;
    doors.receiveShadow = true;
    // Bounds at full size (closed doors); opening only shrinks them.
    doors.computeBoundingSphere();
    this.doors = doors;
    this.add(doors);
  }

  protected buildGate(index: number, G: number, snowMat: THREE.Material, shared: GateMats): void {
    const st = this.style;
    const gp = ENEMY_GATES[index];
    const ex = Math.min(ARENA.maxX, Math.max(ARENA.minX, gp.x));
    const ez = Math.min(ARENA.maxZ, Math.max(ARENA.minZ, gp.z));
    const grp = new THREE.Group();
    grp.position.set(ex, 0, ez);
    grp.rotation.y = gp.heading;
    this.add(grp);
    grp.updateMatrix();

    const zc = -(WALL_IN + WALL_T / 2);
    const px = GATE_HALF + PILLAR_W / 2;
    const trim = (shared.trim ??= this.std(st.trim, { metalness: 0.55, roughness: 0.45 }));
    const lightMat = new THREE.MeshStandardMaterial({ color: st.gate, emissive: st.gate, emissiveIntensity: 1, roughness: 0.3 });
    const hazard = (shared.hazard ??= this.std(0xffffff, { map: getHazardTex(), roughness: 0.6, flatShading: false }));
    const lights = new StaticBatch();
    const part = new THREE.Object3D();
    // A static part at (x, y, z) in gate space: lightMat parts go into this gate's light batch, everything else into
    // the zone batch (in world space; casting parts also receive).
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true, scale?: THREE.Vector3) => {
      part.position.set(x, y, z);
      if (scale) part.scale.copy(scale);
      else part.scale.set(1, 1, 1);
      part.updateMatrix();
      if (mat === lightMat) lights.add(geo, part.matrix, mat);
      else this.bake(geo, part.matrix.premultiply(grp.matrix), mat, cast, cast);
    };
    // Pillars and header share coplanar faces (z-fight): they stay real meshes so their depth is computed exactly
    // as before.
    const solid = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      grp.add(m);
    };

    // frame
    const pillarGeo = new THREE.BoxGeometry(PILLAR_W, 4.6, WALL_T);
    const plateGeo = new THREE.BoxGeometry(PILLAR_W * 0.8, 3.0, 0.06);
    for (const s of [-1, 1]) {
      solid(pillarGeo, trim, s * px, 2.3, zc);
      mesh(plateGeo, hazard, s * px, 2.0, -WALL_IN + 0.03, false);
      mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.3, 10), trim, s * px, 4.75, zc, false);
      mesh(new THREE.SphereGeometry(0.28, 12, 8), lightMat, s * px, 5.1, zc, false);
    }
    solid(new THREE.BoxGeometry(GATE_WIDTH + PILLAR_W * 2, 1.0, WALL_T), hazard, 0, 4.1, zc);
    mesh(new THREE.BoxGeometry(GATE_WIDTH - 0.4, 0.16, 0.08), lightMat, 0, 3.48, -WALL_IN + 0.04, false);

    // roll-up garage door (pivot at its top edge so scale.y rolls it up into the header): one instance per gate
    shared.door ??= new THREE.MeshStandardMaterial({ map: getDoorTex(), color: new THREE.Color(st.trim).lerp(new THREE.Color(0xffffff), 0.65), roughness: 0.5, metalness: 0.35 });
    part.position.set(0, 3.6, zc);
    part.scale.set(1, 1, 1);
    part.updateMatrix();
    const doorBase = part.matrix.clone().premultiply(grp.matrix);

    // spawn tunnel outside the wall
    const tunnelMat = (shared.tunnel ??= this.std(st.blockAlt, { roughness: 0.6 }));
    const tz = -(WALL_C + TUNNEL_LEN / 2);
    const capScale = new THREE.Vector3(0.6, 0.35, TUNNEL_LEN * 0.5);
    for (const s of [-1, 1]) {
      mesh(new THREE.BoxGeometry(0.9, 3.9, TUNNEL_LEN), tunnelMat, s * (GATE_HALF + 0.45), 1.95, tz);
      mesh(new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), snowMat, s * (GATE_HALF + 0.45), 3.85, tz, false, capScale);
      for (const y of [0.95, 3.3]) mesh(new THREE.BoxGeometry(0.06, 0.12, TUNNEL_LEN - 0.4), lightMat, s * (GATE_HALF - 0.02), y, tz, false);
    }
    mesh(new THREE.BoxGeometry(GATE_WIDTH + 1.8, 0.45, TUNNEL_LEN - 1.2), trim, 0, 4.12, tz - 0.6);
    mesh(new THREE.BoxGeometry(GATE_WIDTH + 1.4, 0.22, TUNNEL_LEN - 1.6), snowMat, 0, 4.42, tz - 0.6, false);
    const backZ = -(WALL_C + TUNNEL_LEN - 0.25);
    mesh(new THREE.PlaneGeometry(GATE_WIDTH, 3.9), (shared.back ??= new THREE.MeshBasicMaterial({ color: 0x05070f })), 0, 1.95, backZ, false);
    lights.flush(grp);
    const portalMat = new THREE.MeshBasicMaterial({
      map: getGlowTex(), color: st.gate, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.pulses.push({ mat: portalMat, base: 0.7, speed: 1.8, phase: index });
    const portal = new THREE.Mesh(new THREE.PlaneGeometry(GATE_WIDTH * 1.2, 4.6), portalMat);
    portal.position.set(0, 1.8, backZ + 0.08);
    grp.add(portal);
    // glowing chevron ramp pointing into the arena
    const floorMat = new THREE.MeshBasicMaterial({
      map: getChevronTex(), color: st.gate, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ramp = new THREE.Mesh(new THREE.PlaneGeometry(GATE_WIDTH - 1.4, TUNNEL_LEN - 1).rotateX(-Math.PI / 2), floorMat);
    ramp.position.set(0, G + 0.1, -(WALL_C + (TUNNEL_LEN - 1) / 2 - 0.2));
    ramp.renderOrder = 2;
    grp.add(ramp);

    // beacon glows (sprites live in the gate group)
    const glowMat = new THREE.SpriteMaterial({
      map: getGlowTex(), color: st.gate, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (const s of [-1, 1]) {
      const sp = new THREE.Sprite(glowMat);
      sp.scale.setScalar(2.6);
      sp.position.set(s * px, 5.1, zc);
      grp.add(sp);
    }

    grp.updateMatrixWorld(true);
    const mouth = grp.localToWorld(new THREE.Vector3(0, G + 0.3, 0.8));
    this.gates.push({ group: grp, doorBase, doorScale: 1, lightMat, glowMat, floorMat, mouth, open: 0, openT: 0, flashT: 0, lastBurst: -10, phase: index * 1.7 });
  }

  /* ---------- spectator stands ---------- */

  /** `skipN` > 0 leaves |x| < skipN of the north side free (Golden Tower Plaza's stage). */
  protected buildStands(G: number, skipN = 0): void {
    const rally = this.isRally;
    const signs: { x: number; y: number; z: number; ry: number; i: number }[] = [];
    const st = this.style;
    const rnd = this.rnd;
    const tiers: Item[] = [];
    const seats: Item[] = [];
    const backs: Item[] = [];
    const boards: Item[] = [];
    const poles: Item[] = [];
    const flags: Item[] = [];
    const crowd: Item[] = [];
    let section = 0;
    for (const side of SIDES) {
      if (side.key === 's') continue;
      const range = side.key === 'n' ? [ARENA.minX - 1, ARENA.maxX + 1] : [ARENA.minZ - 1, ARENA.maxZ + 1];
      const gaps = gapsFor(side.key, GATE_HALF + 2.2);
      if (side.key === 'n' && skipN > 0) gaps.push([-skipN, skipN]);
      const runs = subtract(range[0], range[1], gaps);
      for (const [a, b] of runs) {
        const len = b - a;
        const sc = (a + b) / 2;
        const accent = st.accents[section++ % st.accents.length];
        for (let k = 0; k < ROWS; k++) {
          const top = G + 0.25 + (k + 1) * ROW_RISE;
          const depth = (ROWS - k) * ROW_D;
          const [x, z] = side.map(sc, STAND_N0 + k * ROW_D + depth / 2);
          tiers.push({ x, y: 0, z, ry: side.yaw, sx: len, sy: top, sz: depth, color: k % 2 ? st.stand : st.standAlt });
          const [sx, sz] = side.map(sc, STAND_N0 + k * ROW_D + 0.3);
          seats.push({ x: sx, y: top, z: sz, ry: side.yaw, sx: len, sy: 1, sz: 1, color: accent });
          for (let s = a + 0.5; s < b - 0.4; s += 0.85) {
            if (rnd() > (rally ? 0.93 : 0.74)) continue;
            const [cx, cz] = side.map(s + (rnd() - 0.5) * 0.2, STAND_N0 + k * ROW_D + 0.72);
            const sc2 = 0.85 + rnd() * 0.25;
            crowd.push({ x: cx, y: top, z: cz, ry: side.yaw + (rnd() - 0.5) * 0.5, sx: sc2, sy: sc2, sz: sc2, color: this.crowdColor() });
            if (rally && k % 2 === 1 && rnd() < 0.2) signs.push({ x: cx, y: top + 1.25, z: cz, ry: side.yaw + (rnd() - 0.5) * 0.25, i: (rnd() * RALLY_SIGNS.length) | 0 });
          }
        }
        const topH = G + 0.25 + ROWS * ROW_RISE;
        const [bx, bz] = side.map(sc, STAND_N0 + ROWS * ROW_D + 0.15);
        backs.push({ x: bx, y: 0, z: bz, ry: side.yaw, sx: len, sy: topH + 1.3, sz: 0.3 });
        const [fx, fz] = side.map(sc, STAND_N0 - 0.1);
        boards.push({ x: fx, y: 0, z: fz, ry: side.yaw, sx: len, sy: G + 0.25 + ROW_RISE + 0.4, sz: 0.2, color: accent });
        for (let s = a + 1.5; s < b - 1; s += 6) {
          const [qx, qz] = side.map(s, STAND_N0 + ROWS * ROW_D + 0.15);
          poles.push({ x: qx, y: topH + 1.3, z: qz, ry: side.yaw, sx: 1, sy: 1, sz: 1 });
          flags.push({ x: qx, y: topH + 1.3 + 2.55, z: qz, ry: side.yaw + Math.PI / 2 + (rnd() - 0.5) * 0.4, sx: 1, sy: 1, sz: 1, color: st.accents[(rnd() * st.accents.length) | 0] });
        }
      }
    }
    const unitBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.inst(unitBox(), this.std(0xffffff, { roughness: 0.85 }), tiers, true, true);
    this.inst(new THREE.BoxGeometry(1, 0.1, 0.42).translate(0, 0.05, 0), this.std(0xffffff, { roughness: 0.6 }), seats);
    this.inst(unitBox(), this.std(st.trim, { metalness: 0.4, roughness: 0.55 }), backs, true);
    this.inst(unitBox(), this.std(0xffffff, { roughness: 0.5, emissive: 0x222222 }), boards, false, true);
    this.inst(new THREE.CylinderGeometry(0.05, 0.05, 3, 6).translate(0, 1.5, 0), this.std(0xcfd5dc, { metalness: 0.6, roughness: 0.4 }), poles);
    if (rally) {
      // US-style flags on every pole
      this.inst(wavyFlag(1.6, 0.85).translate(0.05, 0.0, 0), this.std(0xffffff, { map: getUsFlagTex(), side: THREE.DoubleSide, roughness: 0.75, flatShading: false }), flags.map((f) => ({ ...f, color: undefined })));
      this.bakeSigns(signs, 1.25, 0.5, true);
    } else {
      const flagShape = new THREE.Shape();
      flagShape.moveTo(0, 0);
      flagShape.lineTo(1.3, -0.3);
      flagShape.lineTo(0, -0.7);
      flagShape.closePath();
      this.inst(new THREE.ShapeGeometry(flagShape).translate(0.05, 0.4, 0), this.std(0xffffff, { side: THREE.DoubleSide, roughness: 0.7 }), flags);
    }
    this.addCrowd(crowd);
  }

  /* ---------- floodlight towers ---------- */

  protected buildTowers(off = TOWER_OFF, k = 1): void {
    const st = this.style;
    const c = ARENA.maxX + off;
    const items: Item[] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * c;
      const z = sz * (ARENA.maxZ + off);
      items.push({ x, y: 0, z, ry: Math.atan2(-x, -z), sx: k, sy: k, sz: k });
    }
    const H = 16;
    const parts: THREE.BufferGeometry[] = [];
    for (const lx of [-0.6, 0.6]) for (const lz of [-0.6, 0.6]) parts.push(new THREE.BoxGeometry(0.2, H, 0.2).translate(lx, H / 2, lz));
    for (let y = 2; y < H; y += 2.6) {
      parts.push(new THREE.BoxGeometry(1.4, 0.1, 0.1).translate(0, y, 0.6));
      parts.push(new THREE.BoxGeometry(1.4, 0.1, 0.1).translate(0, y, -0.6));
      parts.push(new THREE.BoxGeometry(0.1, 0.1, 1.4).translate(0.6, y, 0));
      parts.push(new THREE.BoxGeometry(0.1, 0.1, 1.4).translate(-0.6, y, 0));
    }
    const tilt = 0.5;
    parts.push(new THREE.BoxGeometry(5, 2.6, 0.5).rotateX(tilt).translate(0, H + 0.6, 0.5));
    parts.push(new THREE.BoxGeometry(5.4, 0.25, 1.2).translate(0, H - 0.9, 0.3));
    this.inst(merge(parts), this.std(st.trim, { metalness: 0.6, roughness: 0.4 }), items, true);
    const lamps: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      lamps.push(new THREE.BoxGeometry(0.95, 0.85, 0.12).translate(-1.65 + i * 1.1, -0.5 + j * 1.0, 0.27).rotateX(tilt).translate(0, H + 0.6, 0.5));
    }
    this.inst(merge(lamps), new THREE.MeshBasicMaterial({ color: st.lamp, toneMapped: false }), items);
    // big lens glows in front of the lamp heads
    for (const it of items) {
      const fx = Math.sin(it.ry) * 1.2 * k;
      const fz = Math.cos(it.ry) * 1.2 * k;
      this.glowSprite(st.lamp, st.glow, 10 * k, it.x + fx, (H + 0.4) * k, it.z + fz);
    }
  }

  /* ---------- jumbotron ---------- */

  protected buildJumbotron(zone: ZoneDef): void {
    const st = this.style;
    const grp = new THREE.Group();
    grp.position.set(0, 0, -54);
    this.add(grp);
    const trim = this.std(st.trim, { metalness: 0.55, roughness: 0.45 });
    // legs (casting) + frame baked into one draw
    const legGeo = new THREE.BoxGeometry(1, 10.4, 1).translate(0, 5.2, 0);
    for (const x of [-8, 8]) this.bake(legGeo, this.tmpM.makeTranslation(x, 0, -54), trim, true);
    this.bake(new THREE.BoxGeometry(21, 9.6, 1.2), this.tmpM.makeTranslation(0, 15, -54), trim);

    // main screen
    const [c, g] = canvas(1024, 340);
    const bg = g.createLinearGradient(0, 0, 0, 340);
    bg.addColorStop(0, '#0b1230');
    bg.addColorStop(1, '#1b0f36');
    g.fillStyle = bg;
    g.fillRect(0, 0, 1024, 340);
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 2;
    for (let x = 0; x < 1024; x += 32) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 340);
      g.stroke();
    }
    g.strokeStyle = hexCss(st.accents[0]);
    g.lineWidth = 10;
    g.strokeRect(10, 10, 1004, 320);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 104px "Arial Black", Impact, sans-serif';
    g.fillStyle = '#ffffff';
    g.fillText('SNOWPLOW', 512, 92);
    g.fillStyle = hexCss(st.accents[0]);
    g.fillText('SHOWDOWN', 512, 192);
    g.font = 'bold 44px Arial, sans-serif';
    g.fillStyle = hexCss(st.accents[1]);
    g.fillText(zone.name.toUpperCase(), 512, 280);
    const screenTex = toTex(c);
    this.zoneTex.push(screenTex);
    const screenMat = new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false });
    this.pulses.push({ mat: screenMat, base: 1, speed: 0, phase: 0 });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(19.6, 6.5), screenMat);
    screen.position.set(0, 15.9, 0.61);
    grp.add(screen);

    // scrolling ticker
    const [tc, tg] = canvas(1024, 64);
    tg.fillStyle = '#05070f';
    tg.fillRect(0, 0, 1024, 64);
    tg.font = 'bold 38px Arial, sans-serif';
    tg.textBaseline = 'middle';
    tg.fillStyle = hexCss(st.accents[0]);
    const msg = `  ★ ${zone.name.toUpperCase()}  ★  BOSS: ${zone.bossName}  ★  RAM · SLAM · SURVIVE  `;
    tg.fillText(msg, 0, 34);
    const tickTex = toTex(tc, true);
    tickTex.wrapT = THREE.ClampToEdgeWrapping;
    this.zoneTex.push(tickTex);
    this.ticker = tickTex;
    const tick = new THREE.Mesh(new THREE.PlaneGeometry(19.6, 1.4), new THREE.MeshBasicMaterial({ map: tickTex, toneMapped: false }));
    tick.position.set(0, 11.5, 0.61);
    grp.add(tick);

    // marquee bulbs
    const bulbs: Item[] = [];
    for (let i = 0; i <= 20; i++) {
      bulbs.push({ x: -10 + i, y: 19.6, z: -54 + 0.62, ry: 0, sx: 1, sy: 1, sz: 1 });
      bulbs.push({ x: -10 + i, y: 10.4, z: -54 + 0.62, ry: 0, sx: 1, sy: 1, sz: 1 });
    }
    this.inst(new THREE.SphereGeometry(0.16, 8, 6), this.emissive(st.accents[0], 1.6, { speed: 5 }), bulbs);
  }

  /* ---------- low dressing behind the south wall (camera side) ---------- */

  protected buildSouthDressing(G: number): void {
    const rnd = this.rnd;
    const st = this.style;
    const tires: Item[] = [];
    const barrels: Item[] = [];
    for (let i = 0; i < 9; i++) {
      const x = ARENA.minX - 4 + rnd() * (ARENA.maxX - ARENA.minX + 8);
      const z = ARENA.maxZ + WALL_C + 1.2 + rnd() * 6;
      const n = 1 + ((rnd() * 3) | 0);
      for (let j = 0; j < n; j++) tires.push({ x, y: G - 0.15 + j * 0.36, z, ry: rnd() * 6, rx: Math.PI / 2, sx: 1, sy: 1, sz: 1 });
    }
    for (let i = 0; i < 7; i++) {
      barrels.push({
        x: ARENA.minX + rnd() * (ARENA.maxX - ARENA.minX), y: G - 0.2, z: ARENA.maxZ + WALL_C + 1.5 + rnd() * 8, ry: rnd() * 6,
        sx: 1, sy: 1, sz: 1, color: st.accents[(rnd() * st.accents.length) | 0],
      });
    }
    this.emitTires(tires);
    this.inst(new THREE.CylinderGeometry(0.4, 0.4, 1.1, 12).translate(0, 0.55, 0), this.std(0xffffff, { roughness: 0.6, metalness: 0.3 }), barrels, true);
  }

  /* ---------- distant mountains & drifts ---------- */

  protected buildMountains(zone: ZoneDef): void {
    const rnd = this.rnd;
    const theme = zone.theme;
    const biome = this.biome;
    const fogC = new THREE.Color(zone.fogColor);
    const skyB = new THREE.Color(zone.skyBottom);
    const haze = theme === 'blizzard' && !biome ? 0.82 : biome === 'quarry' ? 0.3 : 0.5;
    const mCol = new THREE.Color(this.style.mountain).lerp(fogC, haze);
    // snow caps; volcano craters glow in the quarry, the Divide caps by side, mesas get a lighter band
    const capHex = biome === 'quarry' ? 0xff5a14 : biome === 'mars' ? 0xd88a5a : biome === 'plaza' ? 0x86a86a : zone.snowTint;
    const cCol = new THREE.Color(capHex).lerp(skyB, biome === 'quarry' ? 0 : haze * 0.6);
    const hotM = new THREE.Color(0x6a2418).lerp(fogC, haze);
    const hotC = new THREE.Color(0xff5a14);
    const coldM = new THREE.Color(0x8fb8dc).lerp(fogC, haze);
    // one draw: white material, rock / snow-cap colour per instance
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, fog: false });
    const mesas = biome === 'mars';
    const mGeo = mesas ? new THREE.CylinderGeometry(0.7, 1, 1, 7, 1).translate(0, 0.5, 0) : new THREE.ConeGeometry(1, 1, 6, 1).translate(0, 0.5, 0);
    const mItems: Item[] = [];
    let cItems: Item[] = [];
    const n = 34;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.12;
      const R = 230 + rnd() * 70;
      const tall = theme === 'peak' && !biome;
      const h = (tall ? 80 : mesas ? 22 : 45) + rnd() * (tall ? 90 : mesas ? 30 : 60);
      const r = (mesas ? 40 : 35) + rnd() * 40;
      const ry = rnd() * 6.28;
      const x = Math.sin(a) * R;
      const z = Math.cos(a) * R;
      const sz = r * (0.7 + rnd() * 0.5);
      mItems.push({ x, y: -2, z, ry, sx: r, sy: h, sz });
      const k = mesas ? 0.22 : biome === 'quarry' ? 0.16 : 0.36;
      if (mesas) cItems.push({ x, y: -2 + h * 0.62, z, ry, sx: r * 0.83, sy: h * 0.08, sz: sz * 0.83 });
      else cItems.push({ x, y: -2 + h * (1 - k) - 0.3, z, ry, sx: r * k * 1.04, sy: h * k * 1.01, sz: sz * k * 1.04 });
    }
    // lava-capped volcano tops (quarry, the Divide's hot half) glow: unlit, fog-free
    const glowing = (it: Item) => biome === 'quarry' || (biome === 'divide' && it.x < 0);
    const lavaCaps = cItems.filter(glowing);
    if (lavaCaps.length) {
      const lc = this.inst(mGeo.clone(), new THREE.MeshBasicMaterial({ color: 0xff5a14, fog: false, toneMapped: false }), lavaCaps);
      if (lc) lc.renderOrder = -5;
      cItems = cItems.filter((it) => !glowing(it));
    }
    const mm = this.inst(mGeo, mat, [...mItems, ...cItems]);
    if (mm) {
      for (let i = 0; i < mm.count; i++) {
        const cap = i >= mItems.length;
        const it = cap ? cItems[i - mItems.length] : mItems[i];
        if (biome === 'divide') mm.setColorAt(i, it.x < 0 ? (cap ? hotC : hotM) : cap ? cCol : coldM);
        else mm.setColorAt(i, cap ? cCol : mCol);
      }
      mm.instanceColor!.needsUpdate = true;
      mm.renderOrder = -5;
    }
  }

  /** Low mounds outside the walls: snow drifts, ash heaps (quarry), rust dunes (Rust Basin), hedges (Plaza); the
   *  Divide gets ash on its hot half and snow on its cold half. */
  protected buildDrifts(G: number, snowMat: THREE.Material): void {
    const rnd = this.rnd;
    const biome = this.biome;
    const items: Item[] = this.scatter(this.zone.theme === 'blizzard' && !biome ? 60 : 36, 48, 115).map((p) => {
      const s = 1.5 + rnd() * 3;
      const dune = biome === 'mars';
      return { x: p.x, y: G - 0.1, z: p.z, ry: rnd() * 6.28, sx: s * (dune ? 2.6 : 1.6), sy: s * (dune ? 0.4 : 0.28), sz: s };
    });
    const geo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    if (biome === 'plaza') {
      this.inst(geo, this.std(0x4f9a43, { roughness: 0.85 }), items.map((i) => ({ ...i, sy: i.sy * 2.2 })), true, true);
    } else if (biome === 'mars') {
      this.inst(geo, this.std(0xc4744a, { roughness: 0.95 }), items, false, true);
    } else if (biome === 'divide') {
      for (const it of items) it.color = it.x < 0 ? 0x5e4a48 : 0xf3f6fa;
      this.inst(geo, this.std(0xffffff, { roughness: 0.85 }), items, false, true);
    } else this.inst(geo, snowMat, items, false, true);
  }

}
