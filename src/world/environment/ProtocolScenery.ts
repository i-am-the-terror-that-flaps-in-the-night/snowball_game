import * as THREE from 'three';
import { kitBox } from '../../render/kit/shapes';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ZoneDef } from '../../core/types';
import { ARENA } from '../../core/types';
import { VenueScenery } from './VenueScenery';
import { GATE_HALF, STAND_N0, ROWS, ROW_D } from './layout';
import { canvas, getGlowTex, toTex } from './textures';

/** PROTOCOL C's rally stage (waves 5+): behind the north wall, |x| < PROTOCOL_STAGE_HALF, deck at PROTOCOL_STAGE_Y. */
export const PROTOCOL_STAGE_HALF = 10;
const PROTOCOL_STAGE_Y = 2.6;
const STAGE_Z0 = -32.2;
const STAGE_Z1 = -38.5;
/** The glass boardroom box hanging over the north stand: centre, half sizes. */
export const BOARDROOM = { x: 0, y: 15.5, z: -40, hw: 10, hh: 2.8, hd: 3.6 } as const;

const GOLD = 0xe8b423;
const NAVY = 0x1b2236;

/** The live parts of the boardroom box (its own group, not baked: THE CHAIRMAN's reveal lights it and takes it away). */
interface BoardroomRig {
  group: THREE.Group;
  /** THE CHAIRMAN as an unseen backlit silhouette (waves 1-6) / revealed and lit (THE DONALD, ankle monitor on). */
  shadow: THREE.Object3D;
  lit: THREE.Object3D;
  warm: THREE.MeshStandardMaterial;
  glow: THREE.Sprite;
  /** The pylons, arms, fascia and light bar holding the box (torn away by THE WHITEOUT's storm). */
  sign: THREE.Object3D | null;
}

/**
 * PROTOCOL C venue dressing (docs/modes.md "Protocol C"), on top of the standard stadium (walls, gates, stands on four
 * sides, floodlight towers): the glass BOARDROOM BOX over the north stand where the Chairman watches (stage 3 brings
 * him), gold pylons holding it up, a PROTOCOL C fascia, gold rope lights on the inner walls, and from wave 5 a small
 * rally stage behind the north wall (THE DONALD's rally spot is (0, -21), in front of it).
 */
export class ProtocolScenery extends VenueScenery {
  /** The current PROTOCOL C build's boardroom (null before the first one; stale off PROTOCOL C: boardroom() checks). */
  private boardroomRig: BoardroomRig | null = null;

  /** THE WHITEOUT's storm tears the PROTOCOL C fascia away (on) / it is back (off: a new build has it anyway). */
  protected tearFascia(on: boolean): void {
    const r = this.boardroomRig;
    if (r?.sign && this.zone.theme === 'protocol') r.sign.visible = !on;
  }

  /** WorldAPI.boardroom: the box's state (see core/types.ts). */
  boardroom(mode: 'shadow' | 'lit' | 'gone', k = 1): void {
    const r = this.boardroomRig;
    if (!r || this.zone.theme !== 'protocol') return;
    r.group.visible = mode !== 'gone';
    const lit = mode === 'lit' ? Math.max(0, Math.min(1, k)) : 0;
    r.lit.visible = lit > 0.35;
    r.shadow.visible = !r.lit.visible;
    r.warm.emissiveIntensity = 0.6 + 0.5 * lit;
    r.glow.material.opacity = 0.9 * lit;
  }

  protected buildProtocol(G: number, zone: ZoneDef): void {
    const M = new THREE.Matrix4();
    const gold = this.std(GOLD, { roughness: 0.3, metalness: 0.45, emissive: 0x4a3000, emissiveIntensity: 0.35 });
    const navy = this.std(NAVY, { roughness: 0.6 });
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, cast = true) =>
      this.bake(kitBox(w, h, d), M.makeTranslation(x, y, z), mat, cast, cast);
    this.buildBoardroom(box, gold, navy);
    if (zone.stage) this.buildProtocolStage(G, box, gold, navy);

    // gold rope lights along the top of the inner walls (pulsing slowly), skipping the gate mouths
    const strip = this.emissive(0xffcf5a, 1.2, { speed: 1.1 });
    const L = ARENA.maxX;
    for (const [x, z, w, d] of [
      [-(L + GATE_HALF) / 2 - 0.5, ARENA.minZ - 0.06, L - GATE_HALF - 1, 0.12],
      [(L + GATE_HALF) / 2 + 0.5, ARENA.minZ - 0.06, L - GATE_HALF - 1, 0.12],
    ] as const) box(w, 0.12, d, x, 2.35, z, strip, false);
  }

  /** The glass box over the north stand: pylons, the box itself (buildBoardroomBox), the PROTOCOL C fascia. */
  private buildBoardroom(box: (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, cast?: boolean) => void, gold: THREE.Material, navy: THREE.Material): void {
    const { x, y, z, hw, hh, hd } = BOARDROOM;
    const y0 = y - hh;
    // pylons from behind the north stand, a cross brace
    const backZ = ARENA.minZ - (STAND_N0 + ROWS * ROW_D) - 1.2;
    // (its own group, not baked: THE WHITEOUT's storm tears the whole rig away: tearFascia)
    const frame = new THREE.Group();
    frame.name = 'BoardroomFrame';
    // (no shadow casting: a static shadow proxy would outlive the torn frame)
    const part = (w: number, h: number, d: number, px: number, py: number, pz: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(kitBox(w, h, d), mat);
      m.position.set(px, py, pz);
      frame.add(m);
    };
    for (const sx of [-1, 1]) {
      part(1.0, y0, 1.0, sx * (hw - 2), y0 / 2, backZ, gold);
      part(0.5, 0.5, Math.abs(z - backZ) + hd, sx * (hw - 2), y0 - 0.5, (z + backZ) / 2, gold);
    }
    part(2 * hw - 4, 0.45, 0.45, 0, y0 * 0.55, backZ, gold);
    this.buildBoardroomBox(gold, navy);
    // fascia under the front edge: PROTOCOL C in gold on navy
    const [c, g] = canvas(1024, 128);
    g.fillStyle = '#141a2c';
    g.fillRect(0, 0, 1024, 128);
    g.strokeStyle = '#e8b423';
    g.lineWidth = 6;
    g.strokeRect(6, 6, 1012, 116);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 78px "Arial Black", Impact, sans-serif';
    g.fillStyle = '#f2c94c';
    g.fillText('PROTOCOL  C', 512, 68);
    const tex = toTex(c);
    this.zoneTex.push(tex);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2 * hw, 2 * hw * 0.125), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    sign.position.set(x, y0 - 0.55 - hw * 0.125, z + hd + 0.32);
    frame.add(sign);
    // a gold light bar along the box's underside
    part(2 * hw, 0.14, 0.14, x, y0 - 0.6, z + hd + 0.3, this.emissive(0xffd257, 1.6, { speed: 2.2 }));
    this.add(frame);
    if (this.boardroomRig) this.boardroomRig.sign = frame;
  }

  /** The box itself, in its own group (merged per material): slabs, gold frame, the lit back wall, the long table and
   *  chairs, the big gold chair with THE CHAIRMAN in it (a silhouette, and his lit self for the reveal), the glass. */
  private buildBoardroomBox(gold: THREE.Material, navy: THREE.Material): void {
    const { x, y, z, hw, hh, hd } = BOARDROOM;
    const y0 = y - hh;
    const y1 = y + hh;
    const group = new THREE.Group();
    group.name = 'Boardroom';
    const M = new THREE.Matrix4();
    const E = new THREE.Euler();
    const Q = new THREE.Quaternion();
    const P = new THREE.Vector3();
    const S = new THREE.Vector3(1, 1, 1);
    type Parts = Map<THREE.Material, THREE.BufferGeometry[]>;
    const add = (parts: Parts, geo: THREE.BufferGeometry, m: THREE.Material, px: number, py: number, pz: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => {
      M.compose(P.set(px, py, pz), Q.setFromEuler(E.set(rx, ry, rz)), S.set(sx, sy, sz));
      const g = geo.clone().applyMatrix4(M);
      let l = parts.get(m);
      if (!l) parts.set(m, (l = []));
      l.push(g);
    };
    const flush = (parts: Parts, into: THREE.Object3D) => {
      for (const [m, l] of parts) {
        const g = l.length === 1 ? l[0] : mergeGeometries(l.map((x) => (x.index ? x.toNonIndexed() : x)), false);
        if (!g) continue;
        into.add(new THREE.Mesh(g, m));
      }
    };
    const B = kitBox(1, 1, 1);
    const SPH = new THREE.SphereGeometry(1, 12, 8);
    const box: Parts = new Map();
    // floor / roof slabs, gold frame posts
    add(box, B, navy, x, y0 - 0.27, z, 2 * hw + 0.6, 0.55, 2 * hd + 0.6);
    add(box, B, gold, x, y1 + 0.2, z, 2 * hw + 0.6, 0.4, 2 * hd + 0.6);
    for (const px of [-hw, -hw / 2, 0, hw / 2, hw]) add(box, B, gold, px, y, z + hd, 0.28, 2 * hh, 0.28);
    for (const px of [-hw, hw]) add(box, B, gold, px, y, z - hd, 0.28, 2 * hh, 0.28);
    // warm back wall (lit from inside; brighter when he is revealed)
    const warm = new THREE.MeshStandardMaterial({ color: 0xffd890, emissive: 0xffd890, emissiveIntensity: 0.6, roughness: 0.4 });
    add(box, B, warm, x, y, z - hd + 0.15, 2 * hw - 0.4, 2 * hh - 0.2, 0.2);
    // the long table and the empty chairs down both sides
    const wood = this.std(0x3a2416, { roughness: 0.5 });
    add(box, B, wood, x, y0 + 1.0, z - 0.4, 12, 0.25, 2.2);
    add(box, B, wood, x, y0 + 0.5, z - 0.4, 11, 0.9, 1.4);
    const chair = this.std(0x15161c, { roughness: 0.6 });
    for (let i = -2; i <= 2; i++) {
      if (i === 0) continue;
      for (const sz of [-1, 1]) add(box, B, chair, x + i * 2.4, y0 + 0.8, z - 0.4 + sz * 1.7, 0.9, 1.6, 0.9);
    }
    // the big gold chair at the head of the table
    add(box, B, gold, x, y0 + 1.5, z - hd + 1.0, 1.4, 3.0, 1.2);
    flush(box, group);

    // THE CHAIRMAN, seated in front of the gold chair: a dark backlit silhouette ...
    const cz = z - hd + 2.0;
    const sil: Parts = new Map();
    const dark = this.std(0x07070b, { roughness: 0.9 });
    add(sil, B, dark, x, y0 + 2.0, cz, 2.4, 1.8, 1.1);
    add(sil, B, dark, x, y0 + 3.4, cz, 1.25, 1.2, 1.1);
    // the unmistakable hair: a high swoop off to one side, a flick past the brow
    add(sil, SPH, dark, x + 0.15, y0 + 4.12, cz + 0.1, 0.85, 0.3, 0.6, 0, 0, -0.18);
    add(sil, SPH, dark, x - 0.75, y0 + 4.02, cz + 0.2, 0.65, 0.24, 0.45, 0, 0, -0.42);
    add(sil, SPH, dark, x - 1.25, y0 + 3.78, cz + 0.2, 0.32, 0.14, 0.3, 0, 0, -0.9);
    for (const sx of [-1, 1]) add(sil, SPH, dark, x + sx * 0.7, y0 + 3.6, cz - 0.1, 0.2, 0.42, 0.5);
    const shadow = new THREE.Group();
    flush(sil, shadow);
    group.add(shadow);
    // ... and THE DONALD, lit (orange face, swoopy blond hair, the long red tie, one foot up on the table: the ankle
    // monitor's red light blinks)
    const lit: Parts = new Map();
    // (lit from inside the room: a little emissive so he reads at night)
    const skin = this.std(0xf08a2a, { roughness: 0.6, emissive: 0x7a3000, emissiveIntensity: 0.8 });
    const hair = this.std(0xf6d55c, { roughness: 0.45, metalness: 0.15, emissive: 0x8a6a10, emissiveIntensity: 0.8 });
    const suit = this.std(0x1b2236, { roughness: 0.6, emissive: 0x0c1020, emissiveIntensity: 1 });
    const white = this.std(0xf3f5f8, { roughness: 0.45, emissive: 0x505050, emissiveIntensity: 1 });
    const tie = this.std(0xd0102a, { roughness: 0.5, emissive: 0x500008, emissiveIntensity: 1 });
    const black = this.std(0x131418, { roughness: 0.5 });
    add(lit, B, suit, x, y0 + 2.0, cz, 2.0, 1.8, 1.1);
    add(lit, B, white, x, y0 + 2.45, cz + 0.56, 0.7, 0.9, 0.05);
    add(lit, B, tie, x, y0 + 2.15, cz + 0.6, 0.28, 1.35, 0.06);
    add(lit, B, tie, x, y0 + 1.42, cz + 0.6, 0.42, 0.3, 0.06, 0, 0, Math.PI / 4);
    add(lit, B, skin, x, y0 + 3.4, cz, 1.25, 1.2, 1.1);
    add(lit, SPH, skin, x, y0 + 2.88, cz + 0.5, 0.5, 0.2, 0.22);
    for (const sx of [-1, 1]) {
      add(lit, B, white, x + sx * 0.3, y0 + 3.55, cz + 0.56, 0.28, 0.1, 0.04);
      add(lit, B, black, x + sx * 0.28, y0 + 3.55, cz + 0.59, 0.1, 0.09, 0.03);
      add(lit, B, hair, x + sx * 0.3, y0 + 3.74, cz + 0.57, 0.36, 0.08, 0.06, 0, 0, sx * 0.14);
      add(lit, B, suit, x + sx * 1.15, y0 + 1.75, cz + 0.8, 0.45, 0.4, 1.4);
      add(lit, SPH, skin, x + sx * 1.15, y0 + 1.75, cz + 1.55, 0.22, 0.2, 0.22);
    }
    add(lit, SPH, hair, x, y0 + 4.08, cz - 0.3, 0.75, 0.3, 0.65);
    add(lit, SPH, hair, x + 0.1, y0 + 4.15, cz + 0.25, 0.9, 0.22, 0.38, 0, 0.12, -0.14);
    add(lit, SPH, hair, x - 0.62, y0 + 4.05, cz + 0.35, 0.36, 0.16, 0.25, 0.2, 0.4, -0.35);
    for (const sx of [-1, 1]) add(lit, SPH, hair, x + sx * 0.72, y0 + 3.7, cz - 0.1, 0.18, 0.4, 0.6);
    // the leg on the table: shin, black shoe, the monitor band
    add(lit, B, suit, x + 1.0, y0 + 1.55, cz + 1.4, 0.45, 0.42, 2.0, -0.12);
    add(lit, B, black, x + 1.0, y0 + 1.45, cz + 2.6, 0.5, 0.45, 0.75);
    add(lit, B, black, x + 1.0, y0 + 1.42, cz + 2.1, 0.55, 0.5, 0.3);
    const litGroup = new THREE.Group();
    flush(lit, litGroup);
    const monitor = this.emissive(0xff2020, 3, { speed: 7 });
    const led = new THREE.Mesh(kitBox(0.16, 0.12, 0.05), monitor);
    led.position.set(x + 1.0, y0 + 1.5, cz + 2.27);
    litGroup.add(led);
    litGroup.visible = false;
    group.add(litGroup);
    // a warm glow over the box once he is revealed
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTex(), color: 0xffd080, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(16);
    glow.position.set(x, y + 0.5, z - 1.0);
    group.add(glow);
    // glass shell (one transparent draw; no depth write so the room shows through)
    const glass = new THREE.MeshStandardMaterial({ color: 0xa8dcff, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.28, depthWrite: false });
    const shell = new THREE.Mesh(kitBox(2 * hw, 2 * hh, 2 * hd), glass);
    shell.position.set(x, y, z);
    shell.renderOrder = 4;
    group.add(shell);
    B.dispose();
    SPH.dispose();
    this.add(group);
    this.boardroomRig = { group, shadow, lit: litGroup, warm, glow, sign: null };
  }

  /** Waves 5+: a low stage behind the north wall, a podium, two gold light posts (no collider: decor only). */
  private buildProtocolStage(G: number, box: (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, cast?: boolean) => void, gold: THREE.Material, navy: THREE.Material): void {
    const W = PROTOCOL_STAGE_HALF * 2;
    const zMid = (STAGE_Z0 + STAGE_Z1) / 2;
    const depth = STAGE_Z0 - STAGE_Z1;
    const Y = Math.max(PROTOCOL_STAGE_Y, G + 1.5);
    const open = GATE_HALF + 0.9;
    // front skirt either side of the boss gate's mouth, the deck over it
    for (const sx of [-1, 1]) box(PROTOCOL_STAGE_HALF - open, Y, 0.4, sx * (open + (PROTOCOL_STAGE_HALF - open) / 2), Y / 2, STAGE_Z0, navy);
    box(W, 0.35, depth, 0, Y - 0.175, zMid, this.std(0xf3efe6, { roughness: 0.6 }));
    box(W + 0.2, 0.18, 0.3, 0, Y, STAGE_Z0 + 0.05, gold, false);
    const pz = STAGE_Z0 - 2.4;
    box(1.6, 1.5, 0.9, 0, Y + 0.75, pz, navy);
    box(1.85, 0.14, 1.1, 0, Y + 1.56, pz, gold);
    for (const sx of [-1, 1]) {
      const tx = sx * (PROTOCOL_STAGE_HALF - 0.8);
      box(0.4, 6, 0.4, tx, Y + 3, STAGE_Z0 - 1, gold, false);
      box(1.0, 0.6, 0.6, tx, Y + 6.2, STAGE_Z0 - 1, this.std(0x2a2a30, { metalness: 0.5 }));
      this.glowSprite(0xffe0a0, 0.85, 4, tx, Y + 6.2, STAGE_Z0 - 0.5, 2.2);
    }
    // back wall: navy with a gold rule (the boardroom box hangs above it)
    box(W + 1, 3.2, 0.4, 0, Y + 1.6, STAGE_Z1 - 0.2, navy);
    box(W + 1, 0.16, 0.42, 0, Y + 2.9, STAGE_Z1 - 0.2, gold, false);
  }
}
