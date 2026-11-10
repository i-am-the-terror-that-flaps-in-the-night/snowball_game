import * as THREE from 'three';
import type { ZoneDef } from '../../core/types';
import { ARENA } from '../../core/types';
import { StaticBatch } from '../../render/mergeStatic';
import { getBackdropTex, getBuntingTex, getCarpetTex, getUsFlagTex } from '../rallyTextures';
import type { Item } from './types';
import { BRAWL_SKIN, CONFETTI } from './styles';
import { WALL_IN, WALL_C, GATE_HALF, PILLAR_W, DOME_TOWER_OFF, DOME_TOWER_K, DOME_N0, DOME_ROWS, DOME_ROW_D, DOME_RISE, DOME_CROWD_CAP, SPONSORS, CORE_X, CORE_Z, STAGE_HALF, STAGE_Y, STAGE_Z0, STAGE_Z1, GOLD_TOWER_X, GOLD_TOWER_Z, SIDES, domeK, DOME_COVER, gapsFor, subtract, mulberry32, colored, merge } from './layout';
import { canvas, toTex, hexCss, wavyFlag } from './textures';
import { ThemeScenery } from './ThemeScenery';

/** The big venues: Golden Tower Plaza (rally stage, carpet), Omega Summit and THE SNOWDOME (Brawl). */
export class VenueScenery extends ThemeScenery {
  /* ---------- theme: Golden Tower Plaza (THE DONALD's rally) ---------- */

  protected buildRally(G: number): void {
    const rnd = this.rnd;
    const st = this.style;
    const navy = this.std(0x1f3b8c, { roughness: 0.6 });
    const gold = this.std(0xe8b423, { roughness: 0.35, metalness: 0.35, emissive: 0x4a3000, emissiveIntensity: 0.35 });
    const white = this.std(0xf6f3ea, { roughness: 0.6 });
    const M = new THREE.Matrix4();
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, cast = true) =>
      this.bake(new THREE.BoxGeometry(w, h, d), M.makeTranslation(x, y, z), mat, cast, cast);
    const W = STAGE_HALF * 2;
    const zMid = (STAGE_Z0 + STAGE_Z1) / 2;
    const depth = STAGE_Z0 - STAGE_Z1;

    // ---- THE STAGE (behind the north wall, over the boss gate's tunnel)
    const open = GATE_HALF + 0.9;
    for (const sx of [-1, 1]) box(STAGE_HALF - open, STAGE_Y, 0.4, sx * (open + (STAGE_HALF - open) / 2), STAGE_Y / 2, STAGE_Z0, navy);
    box(open * 2, 0.55, 0.4, 0, STAGE_Y - 0.28, STAGE_Z0, navy);
    box(W, 0.35, depth, 0, STAGE_Y - 0.175, zMid, white);
    box(W + 0.2, 0.2, 0.3, 0, STAGE_Y, STAGE_Z0 + 0.05, gold, false);
    // bunting along the stage front
    const bunting = this.std(0xffffff, { map: getBuntingTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75, flatShading: false });
    const swag = (len: number, h: number, per: number) => {
      const g = new THREE.PlaneGeometry(len, h).translate(0, -h / 2, 0);
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * Math.max(1, Math.round(len / per)));
      return g;
    };
    this.bake(swag(W, 1.3, 2.9), M.makeTranslation(0, STAGE_Y - 0.12, STAGE_Z0 + 0.24), bunting);
    // red carpet up the stage to the podium
    const carpetMat = this.std(0xffffff, { map: getCarpetTex(), roughness: 0.9, flatShading: false });
    const deckCarpet = new THREE.PlaneGeometry(3, depth - 0.6).rotateX(-Math.PI / 2);
    const duv = deckCarpet.getAttribute('uv');
    for (let i = 0; i < duv.count; i++) duv.setY(i, duv.getY(i) * 3);
    this.bake(deckCarpet, M.makeTranslation(0, STAGE_Y + 0.012, zMid), carpetMat, false, true);
    // the podium: navy lectern, gold top + seal, red / white band, two microphones
    const pz = STAGE_Z0 - 2.2;
    box(1.7, 1.6, 0.9, 0, STAGE_Y + 0.8, pz, navy);
    box(1.95, 0.14, 1.1, 0, STAGE_Y + 1.66, pz - 0.03, gold);
    box(1.72, 0.2, 0.04, 0, STAGE_Y + 0.42, pz + 0.46, this.std(0xc8102e, { roughness: 0.6 }), false);
    box(1.72, 0.1, 0.045, 0, STAGE_Y + 0.58, pz + 0.46, white, false);
    this.bake(new THREE.CylinderGeometry(0.4, 0.4, 0.06, 24).rotateX(Math.PI / 2), M.makeTranslation(0, STAGE_Y + 1.08, pz + 0.47), gold);
    for (const sx of [-1, 1]) {
      this.bake(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6).rotateX(0.5), M.makeTranslation(sx * 0.22, STAGE_Y + 1.98, pz + 0.18), this.std(0x15161a));
      this.bake(new THREE.SphereGeometry(0.08, 8, 6), M.makeTranslation(sx * 0.22, STAGE_Y + 2.3, pz + 0.34), this.std(0x15161a));
    }
    // backdrop: navy wall + the giant gold "THE DONALD" banner, gold posts at both ends
    const bw = W + 5;
    const bh = (bw * 820) / 2048;
    const by = STAGE_Y + 0.6 + bh / 2;
    box(bw + 1, bh + 1.2, 0.5, 0, by, STAGE_Z1 - 0.35, navy);
    const bdTex = getBackdropTex();
    const bdMat = new THREE.MeshStandardMaterial({ map: bdTex, emissive: 0xffffff, emissiveMap: bdTex, emissiveIntensity: 0.32, roughness: 0.6 });
    this.bake(new THREE.PlaneGeometry(bw, bh), M.makeTranslation(0, by, STAGE_Z1 - 0.08), bdMat);
    const postH = by + bh / 2 + 1.6;
    for (const sx of [-1, 1]) {
      box(1.1, postH, 1.1, sx * (bw / 2 + 1.0), postH / 2, STAGE_Z1 - 0.35, gold);
      this.bake(new THREE.SphereGeometry(0.75, 12, 8), M.makeTranslation(sx * (bw / 2 + 1.0), postH + 0.6, STAGE_Z1 - 0.35), gold);
    }

    // ---- flags: a row along the back of the stage, giant ones on the backdrop posts
    const flagMat = this.std(0xffffff, { map: getUsFlagTex(), side: THREE.DoubleSide, roughness: 0.75, flatShading: false });
    const flagItems: Item[] = [];
    const poleItems: Item[] = [];
    for (let i = 0; i < 9; i++) {
      const x = -STAGE_HALF + 1.2 + (i * (W - 2.4)) / 8;
      if (Math.abs(x) < 2.6) continue; // keep the podium sightline clear
      const z = STAGE_Z1 + 1.0;
      poleItems.push({ x, y: STAGE_Y, z, ry: 0, sx: 1, sy: 1.9, sz: 1 });
      flagItems.push({ x, y: STAGE_Y + 5.1, z, ry: (rnd() - 0.5) * 0.5, sx: 1.25, sy: 1.25, sz: 1.25 });
    }
    for (const sx of [-1, 1]) flagItems.push({ x: sx * (bw / 2 + 1.0), y: postH - 2.2, z: STAGE_Z1 + 0.4, ry: sx < 0 ? 0.1 : Math.PI - 0.1, sx: 3.2, sy: 3.2, sz: 3.2 });
    // flags lining the south (camera-side) dressing too
    for (let i = 0; i < 9; i++) {
      const x = ARENA.minX + 3 + i * ((ARENA.maxX - ARENA.minX - 6) / 8);
      const z = ARENA.maxZ + WALL_C + 0.8;
      poleItems.push({ x, y: G - 0.2, z, ry: 0, sx: 1, sy: 1.5, sz: 1 });
      flagItems.push({ x, y: G - 0.2 + 3.9, z, ry: Math.PI + (rnd() - 0.5) * 0.5, sx: 1.1, sy: 1.1, sz: 1.1 });
    }
    this.inst(wavyFlag(1.6, 0.85), flagMat, flagItems);
    this.inst(new THREE.CylinderGeometry(0.05, 0.05, 3, 6).translate(0, 1.5, 0), gold, poleItems);

    // ---- warm stage lights: gold truss towers with lamp heads, glows and soft light cones onto the podium
    const lamp = new THREE.MeshBasicMaterial({ color: st.lamp, toneMapped: false });
    const coneMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (const sx of [-1, 1]) {
      const tx = sx * (STAGE_HALF - 0.6);
      const tz = STAGE_Z0 - 0.7;
      const th = 8.5;
      for (const ox of [-0.3, 0.3]) for (const oz of [-0.3, 0.3]) box(0.12, th, 0.12, tx + ox, STAGE_Y + th / 2, tz + oz, gold, false);
      for (let y = 1; y < th; y += 1.4) box(0.7, 0.08, 0.7, tx, STAGE_Y + y, tz, gold, false);
      const hy = STAGE_Y + th + 0.3;
      box(1.0, 0.6, 0.6, tx, hy, tz, this.std(0x2a2a30, { metalness: 0.5 }));
      this.bake(new THREE.PlaneGeometry(0.8, 0.45), M.makeTranslation(tx, hy, tz + 0.31), lamp);
      this.glowSprite(st.lamp, 0.85, 4.5, tx, hy, tz + 0.6, 2.2);
      // light cone from the lamp to the podium
      const dx = 0 - tx;
      const dy = STAGE_Y + 1 - hy;
      const dz = pz - tz;
      const len = Math.hypot(dx, dy, dz);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(2.0, len, 20, 1, true).translate(0, -len / 2, 0), coneMat);
      cone.position.set(tx, hy, tz);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(dx, dy, dz).normalize());
      cone.renderOrder = 6;
      this.add(cone);
    }
    this.pulses.push({ mat: coneMat, base: 0.1, speed: 1.7, phase: 0 });

    // ---- red / white / blue bunting along every wall, slogan banners on the inner faces
    for (const side of SIDES) {
      const runs = subtract(side.s0, side.s1, gapsFor(side.key, GATE_HALF + PILLAR_W));
      const h = side.key === 's' ? 0.45 : 0.6;
      for (const [a, b] of runs) {
        const len = b - a;
        if (len < 1.5) continue;
        const [x, z] = side.map((a + b) / 2, WALL_IN - 0.14);
        this.bake(swag(len, h, 2.6), this.itemMatrix({ x, y: side.h - 0.02, z, ry: side.yaw, sx: 1, sy: 1, sz: 1 }), bunting);
      }
    }
    const banners: { x: number; y: number; z: number; ry: number; i: number }[] = [];
    let bi = 0;
    for (const side of SIDES) {
      if (side.key === 's') continue;
      const spots = side.key === 'n' ? [-20, 20] : [-23, 6, 20];
      for (const sc of spots) {
        const [x, z] = side.map(sc, WALL_IN - 0.12);
        banners.push({ x, y: 1.32, z, ry: side.yaw, i: bi++ });
      }
    }
    this.bakeSigns(banners, 4.6, 1.15, false);

    // ---- the red carpet up the middle of the arena (draped over the snow every frame)
    this.buildCarpet();

    // ---- THE GOLD TOWER, far to the north-east, plus a cream skyline (fog-free so it looms on the horizon)
    const towerGold = this.std(new THREE.Color(0xd9a520).lerp(new THREE.Color(this.zone.fogColor), 0.15).getHex(), { roughness: 0.4, metalness: 0.2, emissive: 0x3a2400, emissiveIntensity: 0.6, fog: false });
    const tM = (x: number, y: number, z: number) => M.makeTranslation(GOLD_TOWER_X + x, y, GOLD_TOWER_Z + z);
    this.bake(new THREE.BoxGeometry(30, 12, 30).translate(0, 6, 0), tM(0, 0, 0), towerGold);
    this.bake(new THREE.BoxGeometry(18, 80, 18).translate(0, 40, 0), tM(0, 12, 0), towerGold);
    this.bake(new THREE.BoxGeometry(13, 18, 13).translate(0, 9, 0), tM(0, 92, 0), towerGold);
    this.bake(new THREE.BoxGeometry(8, 10, 8).translate(0, 5, 0), tM(0, 110, 0), towerGold);
    this.bake(new THREE.ConeGeometry(2.5, 16, 8).translate(0, 8, 0), tM(0, 120, 0), towerGold);
    const winMat = this.emissive(0xffe4a0, 1.3, { speed: 0.7 });
    winMat.fog = false;
    const bands: Item[] = [];
    for (let y = 16; y < 90; y += 4.2) bands.push({ x: GOLD_TOWER_X, y, z: GOLD_TOWER_Z, ry: 0, sx: 18.2, sy: 0.9, sz: 18.2 });
    for (let y = 95; y < 108; y += 4) bands.push({ x: GOLD_TOWER_X, y, z: GOLD_TOWER_Z, ry: 0, sx: 13.2, sy: 0.8, sz: 13.2 });
    this.inst(new THREE.BoxGeometry(1, 1, 1), winMat, bands);
    this.glowSprite(0xffd257, 0.9, 30, GOLD_TOWER_X, 128, GOLD_TOWER_Z, 1.2).material.fog = false;
    const cream = this.std(new THREE.Color(0xf1e6cf).lerp(new THREE.Color(this.zone.fogColor), 0.35).getHex(), { roughness: 0.7, fog: false });
    const blocks: Item[] = [];
    const goldBands: Item[] = [];
    for (const p of this.scatter(14, 80, 125, true)) {
      if (p.z > 30 && Math.abs(p.x) < 60) continue;
      if (Math.hypot(p.x - GOLD_TOWER_X, p.z - GOLD_TOWER_Z) < 30) continue;
      const w = 10 + rnd() * 12;
      const d = 10 + rnd() * 12;
      const h = 14 + rnd() * 30;
      const ry = Math.atan2(-p.x, -p.z);
      blocks.push({ x: p.x, y: 0, z: p.z, ry, sx: w, sy: h, sz: d });
      goldBands.push({ x: p.x, y: h - 1.2, z: p.z, ry, sx: w + 0.2, sy: 0.8, sz: d + 0.2 });
    }
    this.inst(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), cream, blocks);
    this.inst(new THREE.BoxGeometry(1, 1, 1), this.emissive(0xf2c033, 0.8), goldBands);
  }

  /** The arena's red carpet: a 3 m strip from the south wall to the boss gate, re-draped over the snow. */
  protected buildCarpet(): void {
    // 3 columns x 121 rows (~0.5 m, the snow grid's scale) so plowed bumps don't poke through
    const nv = 121;
    const nu = 3;
    const pos = new THREE.BufferAttribute(new Float32Array(nv * nu * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    const uv = new Float32Array(nv * nu * 2);
    const nrm = new Float32Array(nv * nu * 3);
    const idx: number[] = [];
    const z0 = ARENA.maxZ - 0.3;
    const z1 = ARENA.minZ + 0.3;
    for (let v = 0; v < nv; v++) {
      const z = z0 + ((z1 - z0) * v) / (nv - 1);
      for (let u = 0; u < nu; u++) {
        const i = v * nu + u;
        pos.setXYZ(i, -1.5 + (3 * u) / (nu - 1), 0, z);
        uv[i * 2] = u / (nu - 1);
        uv[i * 2 + 1] = (z0 - z) / 3;
        nrm[i * 3 + 1] = 1;
      }
      if (v < nv - 1)
        for (let u = 0; u < nu - 1; u++) {
          const a = v * nu + u;
          idx.push(a, a + 1, a + nu, a + 1, a + nu + 1, a + nu);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', pos);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial({ map: getCarpetTex(), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    this.add(mesh);
    this.carpet = { mesh, pos, nv: nv * nu };
    this.drapeCarpet();
  }

  protected drapeCarpet(): void {
    const c = this.carpet!;
    const snow = this.ctx.snow;
    const a = c.pos.array as Float32Array;
    for (let i = 0; i < c.nv; i++) {
      const x = a[i * 3];
      const z = a[i * 3 + 2];
      a[i * 3 + 1] = (snow ? snow.getDepth(x, z) : 0) + 0.06;
    }
    c.pos.needsUpdate = true;
  }

  /* ---------- theme: Omega Summit (factory at the top of the world) ---------- */

  protected buildSummit(G: number, snowMat: THREE.Material): void {
    const rnd = this.rnd;
    const st = this.style;
    // jagged spires
    const spireGeo = new THREE.ConeGeometry(1, 1, 5, 1).translate(0, 0.5, 0);
    const spires: Item[] = this.scatter(55, 50, 125).map((p) => {
      const far = Math.hypot(p.x, p.z) > 76;
      const r = 1.5 + rnd() * (far ? 5 : 2.5);
      const h = (far ? 14 : 5) + rnd() * (far ? 26 : 9);
      return { x: p.x, y: G - 0.5, z: p.z, ry: rnd() * 6, rx: (rnd() - 0.5) * 0.2, rz: (rnd() - 0.5) * 0.2, sx: r, sy: h, sz: r * (0.7 + rnd() * 0.5) };
    });
    this.inst(spireGeo, this.std(st.rock, { roughness: 0.9 }), spires);
    this.inst(spireGeo.clone(), snowMat, spires.map((s) => ({ ...s, y: s.y + s.sy * 0.7 - 0.05, sx: s.sx * 0.31, sy: s.sy * 0.305, sz: s.sz * 0.31 })));

    // factory blocks with glowing window bands
    const blocks: Item[] = [];
    const bands: Item[] = [];
    for (const p of this.scatter(12, 72, 115, true)) {
      if (p.z > 40 && Math.abs(p.x) < 50) continue;
      if (Math.hypot(p.x - CORE_X, p.z - CORE_Z) < 26) continue; // core tower
      const w = 10 + rnd() * 14;
      const d = 10 + rnd() * 12;
      const h = 10 + rnd() * 18;
      const ry = Math.atan2(-p.x, -p.z);
      blocks.push({ x: p.x, y: 0, z: p.z, ry, sx: w, sy: h, sz: d });
      for (let y = 4; y < h - 1; y += 4.5) bands.push({ x: p.x, y, z: p.z, ry, sx: w + 0.12, sy: 0.4, sz: d + 0.12 });
    }
    this.inst(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), this.std(0x2a2638, { metalness: 0.5, roughness: 0.6 }), blocks);
    this.inst(new THREE.BoxGeometry(1, 1, 1), this.emissive(st.accents[0], 1.4, { speed: 0.9 }), bands);

    // the ominous core tower, due north
    // (fog-free like the mountain ring, so it always looms as a hazy silhouette on the horizon)
    const core = new THREE.Group();
    core.position.set(CORE_X, 0, CORE_Z);
    const dark = this.std(new THREE.Color(0x1e1a2a).lerp(new THREE.Color(this.zone.fogColor), 0.3).getHex(), { metalness: 0.5, roughness: 0.6, fog: false });
    // base, shaft and crown share `dark`: one baked draw
    const coreM = new THREE.Matrix4().makeTranslation(CORE_X, 0, CORE_Z);
    this.bake(new THREE.BoxGeometry(22, 8, 22).translate(0, 4, 0), coreM, dark);
    this.bake(new THREE.CylinderGeometry(4, 7, 20, 8).translate(0, 18, 0), coreM, dark);
    const glowMat = this.emissive(st.accents[0], 2.6, { speed: 1.1 });
    glowMat.fog = false;
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 11, 16).translate(0, 33.5, 0), glowMat);
    this.bake(new THREE.ConeGeometry(5, 16, 8).translate(0, 47, 0), coreM, dark);
    core.add(glow);
    const ringMat = this.emissive(st.accents[1], 2.0, { speed: 1.6, phase: 1 });
    ringMat.fog = false;
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(6 + i * 2, 0.32, 6, 40), ringMat);
      ring.position.y = 33.5;
      ring.rotation.set(Math.PI / 2 + (i - 1) * 0.5, i * 0.7, 0);
      core.add(ring);
      this.spinners.push({ obj: ring, speed: (i % 2 ? -1 : 1) * (0.35 + i * 0.15) });
    }
    this.add(core);
    this.glowSprite(st.accents[0], 0.8, 28, CORE_X, 33.5, CORE_Z, 1.1).material.fog = false;
    this.glowSprite(st.accents[1], 0.9, 7, CORE_X, 55.5, CORE_Z, 3).material.fog = false;

    // glowing crystals
    for (let c = 0; c < st.accents.length; c++) {
      const items: Item[] = [];
      for (const p of this.scatter(10, 48, 90)) {
        const n = 2 + ((rnd() * 4) | 0);
        for (let k = 0; k < n; k++) {
          const s = 0.3 + rnd() * 0.5;
          items.push({ x: p.x + (rnd() - 0.5) * 1.6, y: G + s, z: p.z + (rnd() - 0.5) * 1.6, ry: rnd() * 6, rx: (rnd() - 0.5) * 0.7, rz: (rnd() - 0.5) * 0.7, sx: s, sy: s * (2.2 + rnd() * 1.5), sz: s });
        }
      }
      this.inst(new THREE.OctahedronGeometry(1, 0), this.emissive(st.accents[c], 1.2, { speed: 1.3 + c * 0.4, phase: c * 2 }), items);
    }
  }

  /* ------------------------------------------------------------------ THE SNOWDOME (Brawl) */

  protected buildSnowdome(zone: ZoneDef, G: number): void {
    const st = this.style;
    const rnd = this.rnd;
    const tiers: Item[] = [];
    const seats: Item[] = [];
    const backs: Item[] = [];
    const poles: Item[] = [];
    const flags: Item[] = [];
    const crowd: Item[] = [];
    const corners: Item[] = [];
    const sponsorItems: Item[][] = SPONSORS.map(() => []);
    const backN = DOME_N0 + DOME_ROWS * DOME_ROW_D + 0.3;
    const topH = G + 0.25 + DOME_ROWS * DOME_RISE;

    // crowd density so the total stays under the instance cap
    const sideLen = ARENA.maxX - ARENA.minX + 2;
    const crowdStep = 1.5;
    const slots = 4 * DOME_ROWS * Math.floor(sideLen / crowdStep);
    const keep = Math.min(0.9, (DOME_CROWD_CAP * 0.97) / slots);
    let sponsorIdx = 0;
    for (let si = 0; si < SIDES.length; si++) {
      const side = SIDES[si];
      const len = sideLen;
      const accent = st.accents[si % st.accents.length];
      for (let k = 0; k < DOME_ROWS; k++) {
        const top = G + 0.25 + (k + 1) * DOME_RISE;
        const depth = (DOME_ROWS - k) * DOME_ROW_D;
        const [x, z] = side.map(0, DOME_N0 + k * DOME_ROW_D + depth / 2);
        tiers.push({ x, y: 0, z, ry: side.yaw, sx: len, sy: top, sz: depth, color: k % 2 ? st.stand : st.standAlt });
        const [sx, sz] = side.map(0, DOME_N0 + k * DOME_ROW_D + 0.35);
        seats.push({ x: sx, y: top, z: sz, ry: side.yaw, sx: len, sy: 1, sz: 1, color: k % 3 === 0 ? accent : st.trim });
        for (let s = -len / 2 + 0.8; s < len / 2 - 0.6; s += crowdStep) {
          if (rnd() > keep || crowd.length >= DOME_CROWD_CAP) continue;
          const [cx, cz] = side.map(s + (rnd() - 0.5) * 0.3, DOME_N0 + k * DOME_ROW_D + 0.95);
          const sc2 = 1.45 + rnd() * 0.35;
          const col = rnd() < 0.45 ? CONFETTI[(rnd() * CONFETTI.length) | 0] : this.crowdColor();
          crowd.push({ x: cx, y: top, z: cz, ry: side.yaw + (rnd() - 0.5) * 0.4, sx: sc2, sy: sc2, sz: sc2, color: col });
        }
      }
      const [bx, bz] = side.map(0, backN);
      backs.push({ x: bx, y: 0, z: bz, ry: side.yaw, sx: len + 2, sy: topH + 2.2, sz: 0.6 });
      // sponsor boards ribbon on top of the back wall (facing in), and flag poles between them
      for (let s = -len / 2 + 9; s < len / 2 - 6; s += 16) {
        if (Math.abs(s) < 22) continue; // jumbotron
        const [qx, qz] = side.map(s, backN - 0.35);
        sponsorItems[sponsorIdx++ % SPONSORS.length].push({ x: qx, y: topH + 2.2 + 1.6, z: qz, ry: side.yaw, sx: 1, sy: 1, sz: 1 });
        const [px, pz] = side.map(s + 8, backN);
        poles.push({ x: px, y: topH + 2.2, z: pz, ry: side.yaw, sx: 1.8, sy: 1.8, sz: 1.8 });
        flags.push({ x: px, y: topH + 2.2 + 5.2, z: pz, ry: side.yaw + Math.PI / 2 + (rnd() - 0.5) * 0.5, sx: 2, sy: 2, sz: 2, color: CONFETTI[(rnd() * CONFETTI.length) | 0] });
      }
    }
    // corner concourse blocks (floodlight towers rise through them)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const w = backN - WALL_C + 0.4;
      corners.push({ x: sx * (ARENA.maxX + WALL_C + w / 2), y: 0, z: sz * (ARENA.maxZ + WALL_C + w / 2), ry: 0, sx: w, sy: topH * 0.55, sz: w, color: st.trim });
    }

    const unitBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.inst(unitBox(), this.std(0xffffff, { roughness: 0.85 }), tiers, true, true);
    this.inst(new THREE.BoxGeometry(1, 0.16, 0.5).translate(0, 0.08, 0), this.std(0xffffff, { roughness: 0.6 }), seats);
    this.inst(unitBox(), this.std(st.trim, { metalness: 0.4, roughness: 0.55 }), backs, true);
    this.inst(unitBox(), this.std(0xffffff, { metalness: 0.3, roughness: 0.6 }), corners, true, true);
    this.inst(new THREE.CylinderGeometry(0.05, 0.05, 3, 6).translate(0, 1.5, 0), this.std(0xcfd5dc, { metalness: 0.6, roughness: 0.4 }), poles);
    const flagShape = new THREE.Shape();
    flagShape.moveTo(0, 0);
    flagShape.lineTo(1.3, -0.3);
    flagShape.lineTo(0, -0.7);
    flagShape.closePath();
    this.inst(new THREE.ShapeGeometry(flagShape).translate(0.05, 0.4, 0), this.std(0xffffff, { side: THREE.DoubleSide, roughness: 0.7 }), flags);
    this.addCrowd(crowd);

    // sponsor boards: one atlas texture, per-sponsor UV-remapped geometry, all baked into one mesh
    const atlas = this.sponsorAtlas();
    const boardMat = new THREE.MeshBasicMaterial({ map: atlas, toneMapped: false });
    for (let i = 0; i < SPONSORS.length; i++) {
      const geo = new THREE.PlaneGeometry(14, 3.2);
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      const col = i % 2;
      const row = (i / 2) | 0;
      for (let j = 0; j < uv.count; j++) {
        uv.setXY(j, (col + uv.getX(j)) * 0.5, 1 - (row + 1 - uv.getY(j)) * 0.25);
      }
      this.bakeItems(geo, boardMat, sponsorItems[i]);
    }
    // board frames
    const frames: Item[] = [];
    for (const list of sponsorItems) for (const it of list) frames.push({ ...it, z: it.z, sx: 14.6, sy: 3.8, sz: 0.3 });
    this.inst(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.2), this.std(0x15182a, { metalness: 0.5 }), frames);

    this.buildTowers(DOME_TOWER_OFF, DOME_TOWER_K);
    this.buildDomeScreens(zone, topH, backN);
    this.buildDomeTunnels(G);
    this.buildDomeRig();
  }

  protected sponsorAtlas(): THREE.Texture {
    const [c, g] = canvas(1024, 512);
    for (let i = 0; i < SPONSORS.length; i++) {
      const [name, bg, fg] = SPONSORS[i];
      const x = (i % 2) * 512;
      const y = ((i / 2) | 0) * 128;
      g.fillStyle = bg;
      g.fillRect(x, y, 512, 128);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      for (let k = 0; k < 6; k++) g.fillRect(x + k * 96 - 20, y, 40, 128);
      g.strokeStyle = fg;
      g.lineWidth = 6;
      g.strokeRect(x + 8, y + 8, 496, 112);
      g.fillStyle = fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = 'italic 900 70px "Arial Black", Impact, sans-serif';
      g.fillText(name, x + 256, y + 66, 470);
    }
    const t = toTex(c);
    this.zoneTex.push(t);
    return t;
  }

  /** Four giant jumbotrons above the stands (one per side), sharing one screen + one ticker texture. */
  protected buildDomeScreens(zone: ZoneDef, topH: number, backN: number): void {
    const st = this.style;
    const [c, g] = canvas(1024, 400);
    const bg = g.createLinearGradient(0, 0, 0, 400);
    bg.addColorStop(0, '#0b1230');
    bg.addColorStop(1, '#2a0c3a');
    g.fillStyle = bg;
    g.fillRect(0, 0, 1024, 400);
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 2;
    for (let x = 0; x < 1024; x += 32) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 400);
      g.stroke();
    }
    g.strokeStyle = hexCss(st.accents[0]);
    g.lineWidth = 12;
    g.strokeRect(12, 12, 1000, 376);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 128px "Arial Black", Impact, sans-serif';
    g.fillStyle = '#ffffff';
    g.fillText('SNOWDOME', 512, 120, 960);
    g.fillStyle = hexCss(st.accents[0]);
    const duel = zone.id === 'duel';
    g.fillText(duel ? 'DUEL' : 'BRAWL', 512, 245, 960);
    g.font = 'bold 40px Arial, sans-serif';
    g.fillStyle = hexCss(st.accents[1]);
    g.fillText(duel ? `${zone.name.replace(/^DUEL · /, '').toUpperCase()}  ·  ONE ON ONE  ·  BEST OF 3` : `${zone.name.toUpperCase()}  ·  FREE-FOR-ALL  ·  9 PLOWS`, 512, 338, 960);
    const screenTex = toTex(c);
    this.zoneTex.push(screenTex);
    const screenMat = new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false });
    this.pulses.push({ mat: screenMat, base: 1, speed: 0, phase: 0 });

    const [tc, tg] = canvas(2048, 64);
    tg.fillStyle = '#05070f';
    tg.fillRect(0, 0, 2048, 64);
    tg.font = 'bold 38px Arial, sans-serif';
    tg.textBaseline = 'middle';
    const parts = duel
      ? ['★ SNOWDOME DUEL', '★ ONE ON ONE', '★ BEST OF 3 ROUNDS', '★ ULTIMATES CARRY OVER', '★ OWN GARAGE · CATCH-UP COINS', '★ DASH · SLAM · WHIRL  ']
      : ['★ SNOWDOME BRAWL', '★ EVERYONE HUNTS EVERYONE', '★ STREAKS PAY MORE', '★ SHUTDOWNS PAY BOUNTIES', '★ FIRST TO 20 WRECKS', '★ DASH · SLAM · WHIRL  '];
    let x = 10;
    for (let i = 0; i < parts.length; i++) {
      tg.fillStyle = hexCss(st.accents[i % st.accents.length]);
      tg.fillText(parts[i], x, 34);
      x += tg.measureText(parts[i]).width + 40;
    }
    const tickTex = toTex(tc, true);
    tickTex.wrapT = THREE.ClampToEdgeWrapping;
    this.zoneTex.push(tickTex);
    this.ticker = tickTex;
    const tickMat = new THREE.MeshBasicMaterial({ map: tickTex, toneMapped: false });

    const trim = this.std(st.trim, { metalness: 0.55, roughness: 0.45 });
    const glowFrame = this.emissive(st.accents[0], 1.4, { speed: 3 });
    const K = 1.6;
    const legGeo = new THREE.BoxGeometry(1.2, 14, 1.2).translate(0, 7, 0);
    const frameGeo = new THREE.BoxGeometry(23, 11, 1.4);
    const glowGeo = new THREE.BoxGeometry(23.8, 11.8, 0.6);
    const screenGeo = new THREE.PlaneGeometry(21.4, 8.4);
    const tickGeo = new THREE.PlaneGeometry(21.4, 1.5);
    // static and sharing four materials: baked into the zone batch (4 draws for all four screens)
    const grp = new THREE.Object3D();
    const part = new THREE.Matrix4();
    const bake = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) =>
      this.bake(geo, part.makeTranslation(x, y, z).premultiply(grp.matrix), mat);
    for (const side of SIDES) {
      const [px, pz] = side.map(0, backN + 1.5);
      grp.position.set(px, topH - 2, pz);
      grp.rotation.y = side.yaw;
      grp.scale.setScalar(K);
      grp.updateMatrix();
      for (const lx of [-8, 8]) bake(legGeo, trim, lx, 0, 0);
      bake(glowGeo, glowFrame, 0, 19, -0.3);
      bake(frameGeo, trim, 0, 19, 0);
      bake(screenGeo, screenMat, 0, 19.9, 0.71);
      bake(tickGeo, tickMat, 0, 14.6, 0.71);
    }
    for (const geo of [legGeo, frameGeo, glowGeo, screenGeo, tickGeo]) geo.dispose();
  }

  /** Decorative tunnel mouths in the stand fronts (no gameplay; Brawl has no gates). */
  protected buildDomeTunnels(G: number): void {
    const st = this.style;
    const frames: Item[] = [];
    const holes: Item[] = [];
    const lights: Item[] = [];
    for (let i = 0; i < SIDES.length; i++) {
      const side = SIDES[i];
      const s = (i % 2 ? -46 : 46) * domeK;
      const [x, z] = side.map(s, DOME_N0 - 0.6);
      frames.push({ x, y: 0, z, ry: side.yaw, sx: 1, sy: 1, sz: 1 });
      const [hx, hz] = side.map(s, DOME_N0 - 1.82);
      holes.push({ x: hx, y: G, z: hz, ry: side.yaw, sx: 1, sy: 1, sz: 1 });
      const [lx, lz] = side.map(s, DOME_N0 - 1.86);
      lights.push({ x: lx, y: G + 5.6, z: lz, ry: side.yaw, sx: 1, sy: 1, sz: 1 });
    }
    const frameGeo = merge([
      new THREE.BoxGeometry(1.4, 7, 2.6).translate(-5.2, 3.5, 0),
      new THREE.BoxGeometry(1.4, 7, 2.6).translate(5.2, 3.5, 0),
      new THREE.BoxGeometry(11.8, 1.6, 2.6).translate(0, 7.3, 0),
    ]);
    this.inst(frameGeo, this.std(st.trim, { metalness: 0.5, roughness: 0.5 }), frames, true);
    this.inst(new THREE.PlaneGeometry(9, 6.4).translate(0, 3.2, 0), new THREE.MeshBasicMaterial({ color: 0x05070f }), holes);
    this.inst(new THREE.BoxGeometry(9.4, 0.3, 0.1), this.emissive(st.accents[1], 1.8, { speed: 2.4 }), lights);
    for (const h of holes) {
      const fx = Math.sin(h.ry) * 0.6;
      const fz = Math.cos(h.ry) * 0.6;
      this.glowSprite(st.accents[1], 0.35, 9, h.x + fx, G + 3, h.z + fz, 1.8);
    }
  }

  /** A light lighting rig ring + cables high above the arena. */
  protected buildDomeRig(): void {
    const st = this.style;
    // the ring hangs just outside the stands (128 m in the 180 m dome)
    const R = ARENA.maxX + 38;
    const Y = 58;
    const hubY = 70;
    const trussMat = this.std(0x3a3f55, { metalness: 0.6, roughness: 0.5 });
    // ring, hub and cables share trussMat: one baked draw
    this.bake(new THREE.TorusGeometry(R, 0.9, 5, 96).rotateX(Math.PI / 2), this.tmpM.makeTranslation(0, Y, 0), trussMat);
    this.bake(new THREE.CylinderGeometry(4, 5, 4, 12), this.tmpM.makeTranslation(0, hubY, 0), trussMat);
    const hubGlow = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.35, 6, 32).rotateX(Math.PI / 2), this.emissive(st.accents[0], 2, { speed: 1.2 }));
    hubGlow.position.y = hubY - 2;
    this.add(hubGlow);
    const cables: Item[] = [];
    const lamps: Item[] = [];
    const nC = 12;
    for (let i = 0; i < nC; i++) {
      const a = (i / nC) * Math.PI * 2 + Math.PI / nC;
      const ex = Math.cos(a) * R;
      const ez = Math.sin(a) * R;
      const dx = ex;
      const dy = Y - hubY;
      const dz = ez;
      const len = Math.hypot(dx, dy, dz);
      cables.push({ x: 0, y: hubY, z: 0, rx: Math.acos(dy / len), ry: Math.atan2(dx, dz), sx: 1, sy: len, sz: 1 });
    }
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      lamps.push({ x: Math.cos(a) * R, y: Y - 1.3, z: Math.sin(a) * R, ry: -a, sx: 1, sy: 1, sz: 1, color: CONFETTI[i % CONFETTI.length] });
    }
    this.bakeItems(new THREE.CylinderGeometry(0.25, 0.25, 1, 5).translate(0, 0.5, 0), trussMat, cables);
    this.inst(new THREE.BoxGeometry(1.6, 0.9, 1.6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), lamps);
  }

  /* ------------------------------------------------------------------ Brawl cover obstacles */

  protected buildObstacles(G: number, snowMat: THREE.Material): void {
    const rnd = mulberry32(90210);
    const obs = this.obstacleList;
    const pillars: Item[] = [];
    const pillarCaps: Item[] = [];
    const crystals: Item[] = [];
    const containers: Item[] = [];
    const roofs: Item[] = [];
    const rocks: Item[] = [];
    const rockCaps: Item[] = [];
    const snowmen: Item[] = [];
    const tirePiles: Item[] = [];
    const contCols = [0xc0392b, 0x2f6fb0, 0xe0a030, 0x3c8d5a, 0x8e44ad, 0xd35400];
    const lim = ARENA.maxX - 8;
    const K = domeK;
    const C = DOME_COVER;
    const clampP = (v: number, r: number) => Math.max(-lim + r, Math.min(lim - r, v));
    const j = (amt: number) => (rnd() - 0.5) * 2 * amt;

    // centerpiece: frozen fountain
    obs.push({ x: 0, z: 0, r: 4 });

    const addContainer = (cx: number, cz: number, ang: number) => {
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      // local +Z of the box = (sin ang, cos ang) ... long axis along local Z
      const ax = s;
      const az = c;
      for (const o of [-2.2, 0, 2.2]) obs.push({ x: cx + ax * o, z: cz + az * o, r: 1.35 });
      const col = contCols[(rnd() * contCols.length) | 0];
      containers.push({ x: cx, y: 0, z: cz, ry: ang, sx: 1, sy: 1, sz: 1, color: col });
      if (rnd() < 0.55) {
        const ang2 = ang + j(0.12);
        containers.push({ x: cx + j(0.3), y: 2.8, z: cz + j(0.3), ry: ang2, sx: 1, sy: 1, sz: 1, color: contCols[(rnd() * contCols.length) | 0] });
        roofs.push({ x: cx, y: 5.6, z: cz, ry: ang2, sx: 1, sy: 1, sz: 1 });
      } else {
        roofs.push({ x: cx, y: 2.8, z: cz, ry: ang, sx: 1, sy: 1, sz: 1 });
      }
    };

    for (let q = 0; q < 4; q++) {
      const ca = Math.cos((q * Math.PI) / 2);
      const sa = Math.sin((q * Math.PI) / 2);
      // rotate a base-quadrant point by q * 90deg
      const P = (x: number, z: number): [number, number] => [x * ca - z * sa, x * sa + z * ca];
      const yaw0 = (q * Math.PI) / 2;

      // A) ice pillar cluster
      {
        const [cx, cz] = P(C.pillars[0] * K + j(2), C.pillars[1] * K + j(2));
        const offs: [number, number][] = [[0, 0], [3.8, 1.2], [1.3, 3.7]];
        for (const [ox, oz] of offs) {
          const [rx, rz] = P(ox, oz);
          const r = 1.2 + rnd() * 0.8;
          const x = cx + rx;
          const z = cz + rz;
          const h = 4.5 + rnd() * 3;
          obs.push({ x, z, r });
          pillars.push({ x, y: 0, z, ry: rnd() * 6, sx: r, sy: h, sz: r });
          pillarCaps.push({ x, y: h - 0.05, z, ry: rnd() * 6, sx: r * 1.08, sy: 0.45, sz: r * 1.08 });
          crystals.push({ x, y: h + 0.6, z, ry: rnd() * 6, rx: j(0.2), rz: j(0.2), sx: r * 0.45, sy: r * 1.2, sz: r * 0.45 });
        }
      }
      // B) shipping container
      {
        const [cx, cz] = P(C.container[0] * K + j(2), C.container[1] * K + j(2));
        addContainer(cx, cz, yaw0 + 0.35 + j(0.25));
      }
      // C) rock outcrop (main + satellite)
      {
        const [cx, cz] = P(C.rock[0] * K + j(2), C.rock[1] * K + j(2));
        const r = 3 + rnd();
        obs.push({ x: cx, z: cz, r });
        rocks.push({ x: cx, y: r * 0.15, z: cz, ry: rnd() * 6, rx: j(0.3), sx: r * 1.05, sy: r * 0.95, sz: r * 1.05 });
        rockCaps.push({ x: cx, y: r * 0.15 + r * 0.6, z: cz, ry: rnd() * 6, sx: r * 0.75, sy: r * 0.35, sz: r * 0.75 });
        const a = rnd() * Math.PI * 2;
        const r2 = 1.6 + rnd() * 0.6;
        const sx = cx + Math.cos(a) * (r + r2 * 0.6);
        const sz = cz + Math.sin(a) * (r + r2 * 0.6);
        obs.push({ x: sx, z: sz, r: r2 });
        rocks.push({ x: sx, y: r2 * 0.1, z: sz, ry: rnd() * 6, rz: j(0.3), sx: r2 * 1.05, sy: r2 * 0.9, sz: r2 * 1.05 });
        rockCaps.push({ x: sx, y: r2 * 0.1 + r2 * 0.55, z: sz, ry: rnd() * 6, sx: r2 * 0.72, sy: r2 * 0.3, sz: r2 * 0.72 });
      }
      // D) giant snowman statue (faces the center)
      {
        const [x, z] = P(C.snowman[0] * K + j(2), C.snowman[1] * K + j(2));
        obs.push({ x, z, r: 2.3 });
        snowmen.push({ x, y: 0, z, ry: Math.atan2(-x, -z) + j(0.3), sx: 1, sy: 1, sz: 1 });
      }
      // E) stacked tire pile
      {
        const [x, z] = P(clampP(C.tires[0] * K + j(1.5), 2), C.tires[1] * K + j(2));
        obs.push({ x, z, r: 2 });
        tirePiles.push({ x, y: 0, z, ry: rnd() * 6, sx: 1, sy: 1, sz: 1 });
      }
      // F) corner container
      {
        const [cx, cz] = P(C.corner[0] * K + j(2), C.corner[1] * K + j(2));
        addContainer(cx, cz, yaw0 + Math.PI / 4 + j(0.3));
      }
    }

    // --- meshes (the pillar cluster and crystals are reskinned per biome venue)
    const skin = BRAWL_SKIN[this.biome ?? 'snowdome'] ?? BRAWL_SKIN.snowdome!;
    if (this.biome === 'divide') for (const p of pillars) p.color = p.x < 0 ? 0x7a2c1e : 0xa8e4ff;
    const iceMat = this.std(this.biome === 'divide' ? 0xffffff : skin.pillar, { roughness: skin.rough, metalness: 0.1, emissive: skin.glow, emissiveIntensity: 0.6 });
    this.inst(new THREE.CylinderGeometry(0.9, 1, 1, 6).translate(0, 0.5, 0), iceMat, pillars, true, true);
    // pillar caps, container roofs and rock caps share snowMat + receive: baked into one draw
    this.bakeItems(new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), snowMat, pillarCaps, false, true);
    this.inst(new THREE.OctahedronGeometry(1, 0), this.emissive(skin.crystal, 1.4, { speed: 1.6 }), crystals);

    // containers: corrugated box + snow roof
    const ribs = this.ribTexture();
    const contGeo = new THREE.BoxGeometry(2.6, 2.8, 6.6).translate(0, 1.4, 0);
    this.inst(contGeo, this.std(0xffffff, { map: ribs, roughness: 0.6, metalness: 0.3, flatShading: false }), containers, true, true);
    this.bakeItems(new THREE.BoxGeometry(2.7, 0.32, 6.7).translate(0, 0.16, 0), snowMat, roofs, true, true);

    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    this.inst(rockGeo, this.std(this.style.rock, { roughness: 0.95 }), rocks, true, true);
    this.bakeItems(rockGeo.clone(), snowMat, rockCaps, false, true);

    // snowman statue (merged, vertex colored)
    const snowmanGeo = merge([
      colored(new THREE.SphereGeometry(2.3, 14, 10).translate(0, 1.9, 0), 0xf4f8ff),
      colored(new THREE.SphereGeometry(1.7, 14, 10).translate(0, 4.6, 0), 0xf4f8ff),
      colored(new THREE.SphereGeometry(1.2, 12, 9).translate(0, 6.75, 0), 0xf4f8ff),
      colored(new THREE.CylinderGeometry(1.5, 1.5, 0.18, 14).translate(0, 7.75, 0), 0x16161c),
      colored(new THREE.CylinderGeometry(0.95, 1.0, 1.5, 14).translate(0, 8.55, 0), 0x16161c),
      colored(new THREE.CylinderGeometry(1.02, 1.02, 0.3, 14).translate(0, 8.0, 0), 0xe63946),
      colored(new THREE.ConeGeometry(0.22, 1.4, 8).rotateX(Math.PI / 2).translate(0, 6.75, 1.75), 0xff7a1a),
      colored(new THREE.SphereGeometry(0.16, 6, 5).translate(0.42, 7.05, 1.05), 0x111111),
      colored(new THREE.SphereGeometry(0.16, 6, 5).translate(-0.42, 7.05, 1.05), 0x111111),
      colored(new THREE.SphereGeometry(0.18, 6, 5).translate(0, 5.0, 1.62), 0x111111),
      colored(new THREE.SphereGeometry(0.18, 6, 5).translate(0, 4.3, 1.66), 0x111111),
      colored(new THREE.TorusGeometry(1.25, 0.3, 6, 16).rotateX(Math.PI / 2).translate(0, 5.95, 0), 0x2a9df4),
      colored(new THREE.CylinderGeometry(0.12, 0.12, 3.2, 5).rotateZ(1.0).translate(2.6, 5.4, 0), 0x5a3a22),
      colored(new THREE.CylinderGeometry(0.12, 0.12, 3.2, 5).rotateZ(-1.0).translate(-2.6, 5.4, 0), 0x5a3a22),
    ]);
    this.inst(snowmanGeo, this.std(skin.statue, { vertexColors: true, roughness: skin.statue === 0xf2c94a ? 0.35 : 0.75, metalness: skin.statue === 0xf2c94a ? 0.5 : 0 }), snowmen, true, true);

    // tire pile: stacks of lying tires + one leaning
    const tireParts: THREE.BufferGeometry[] = [];
    const tire = (x: number, y: number, z: number, rx: number, rz: number) =>
      tireParts.push(colored(new THREE.TorusGeometry(0.6, 0.27, 7, 14).rotateX(rx).rotateZ(rz).translate(x, y, z), 0x1d1e23));
    for (const [sx, sz, n] of [[-0.75, -0.5, 4], [0.85, -0.45, 3], [0, 0.85, 5]] as [number, number, number][]) {
      for (let k = 0; k < n; k++) tire(sx, 0.27 + k * 0.52, sz, Math.PI / 2, 0);
    }
    tire(0.1, 2.45, 0.2, Math.PI / 2 - 0.3, 0.2);
    tire(1.6, 0.7, 0.9, 0.2, 0);
    tireParts.push(colored(new THREE.SphereGeometry(1.2, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.4, 1).translate(0, 2.7, 0.7), 0xf4f8ff));
    this.inst(merge(tireParts), this.std(0xffffff, { vertexColors: true, roughness: 0.9 }), tirePiles, true, true);

    this.buildFountain(G);
  }

  protected ribTexture(): THREE.Texture {
    const [c, g] = canvas(64, 64);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 64, 64);
    for (let x = 0; x < 64; x += 8) {
      g.fillStyle = '#b9bec7';
      g.fillRect(x, 0, 3, 64);
      g.fillStyle = '#e4e7ec';
      g.fillRect(x + 3, 0, 2, 64);
    }
    g.fillStyle = '#8a8f99';
    g.fillRect(0, 0, 64, 3);
    g.fillRect(0, 61, 64, 3);
    const t = toTex(c, true);
    t.repeat.set(3, 1);
    this.zoneTex.push(t);
    return t;
  }

  /** Frozen fountain / ice sculpture centerpiece (obstacle r = 4 at the origin). */
  protected buildFountain(G: number): void {
    const st = this.style;
    const skin = BRAWL_SKIN[this.biome ?? 'snowdome'] ?? BRAWL_SKIN.snowdome!;
    const stone = skin.stone;
    const ice = skin.water;
    const parts: THREE.BufferGeometry[] = [
      colored(new THREE.CylinderGeometry(4, 4.15, 1.0, 24).translate(0, 0.5, 0), stone),
      colored(new THREE.TorusGeometry(3.75, 0.32, 6, 28).rotateX(Math.PI / 2).translate(0, 1.0, 0), 0xa8b1c4),
      colored(new THREE.CylinderGeometry(3.45, 3.45, 0.2, 24).translate(0, 0.95, 0), ice),
      colored(new THREE.CylinderGeometry(0.8, 1.1, 3.2, 10).translate(0, 2.5, 0), stone),
      colored(new THREE.CylinderGeometry(2.1, 1.0, 0.6, 16).translate(0, 4.2, 0), stone),
      colored(new THREE.CylinderGeometry(0.5, 0.7, 1.6, 8).translate(0, 5.2, 0), stone),
    ];
    // frozen water curtains dripping off the upper bowl
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const r = 1.85;
      parts.push(colored(new THREE.ConeGeometry(0.28, 2.6, 5).rotateX(Math.PI).translate(Math.cos(a) * r, 2.75, Math.sin(a) * r), ice));
    }
    const base = new THREE.Mesh(merge(parts), this.std(0xffffff, { vertexColors: true, roughness: 0.35, metalness: 0.15 }));
    base.position.y = G * 0.3;
    base.castShadow = true;
    base.receiveShadow = true;
    this.add(base);
    // spinning ice sculpture on top (crystal elongated along local Z; the holder turns Z up so rotation.z spins about world Y)
    const holder = new THREE.Group();
    holder.position.set(0, G * 0.3 + 8.2, 0);
    holder.rotation.x = -Math.PI / 2;
    const crystalMat = this.emissive(skin.crystal, 1.1, { speed: 1.4 });
    crystalMat.roughness = 0.1;
    crystalMat.metalness = 0.2;
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.2, 0).scale(1, 1, 2.2), crystalMat);
    crystal.castShadow = true;
    holder.add(crystal);
    // the three (non-casting) satellites: one merged child, so they spin with the crystal
    const sats = new StaticBatch();
    const satGeo = new THREE.OctahedronGeometry(0.45, 0).scale(1, 1, 1.8);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      sats.add(satGeo, this.tmpM.makeTranslation(Math.cos(a) * 1.9, Math.sin(a) * 1.9, -1.2), crystalMat);
    }
    sats.flush(crystal);
    satGeo.dispose();
    this.add(holder);
    this.spinners.push({ obj: crystal, speed: 0.6 });
    this.glowSprite(skin.crystal, 0.55, 12, 0, G * 0.3 + 8.2, 0, 1.4);
    // accent ring on the ground
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(5.2, 5.6, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: st.accents[1], transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    ring.position.y = G + 0.05;
    ring.renderOrder = 2;
    this.add(ring);
  }

}
