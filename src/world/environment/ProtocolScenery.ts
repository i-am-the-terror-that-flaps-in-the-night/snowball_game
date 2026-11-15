import * as THREE from 'three';
import type { ZoneDef } from '../../core/types';
import { ARENA } from '../../core/types';
import { VenueScenery } from './VenueScenery';
import { GATE_HALF, STAND_N0, ROWS, ROW_D } from './layout';
import { canvas, toTex } from './textures';

/** PROTOCOL C's rally stage (waves 5+): behind the north wall, |x| < PROTOCOL_STAGE_HALF, deck at PROTOCOL_STAGE_Y. */
export const PROTOCOL_STAGE_HALF = 10;
const PROTOCOL_STAGE_Y = 2.6;
const STAGE_Z0 = -32.2;
const STAGE_Z1 = -38.5;
/** The glass boardroom box hanging over the north stand: centre, half sizes. */
export const BOARDROOM = { x: 0, y: 15.5, z: -40, hw: 10, hh: 2.8, hd: 3.6 } as const;

const GOLD = 0xe8b423;
const NAVY = 0x1b2236;

/**
 * PROTOCOL C venue dressing (docs/modes.md "Protocol C"), on top of the standard stadium (walls, gates, stands on four
 * sides, floodlight towers): the glass BOARDROOM BOX over the north stand where the Chairman watches (stage 3 brings
 * him), gold pylons holding it up, a PROTOCOL C fascia, gold rope lights on the inner walls, and from wave 5 a small
 * rally stage behind the north wall (THE DONALD's rally spot is (0, -21), in front of it).
 */
export class ProtocolScenery extends VenueScenery {
  protected buildProtocol(G: number, zone: ZoneDef): void {
    const M = new THREE.Matrix4();
    const gold = this.std(GOLD, { roughness: 0.3, metalness: 0.45, emissive: 0x4a3000, emissiveIntensity: 0.35 });
    const navy = this.std(NAVY, { roughness: 0.6 });
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, cast = true) =>
      this.bake(new THREE.BoxGeometry(w, h, d), M.makeTranslation(x, y, z), mat, cast, cast);
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

  /** The glass box: floor slab, gold frame, glass shell, a long table with empty chairs and one big gold one. */
  private buildBoardroom(box: (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, cast?: boolean) => void, gold: THREE.Material, navy: THREE.Material): void {
    const { x, y, z, hw, hh, hd } = BOARDROOM;
    const y0 = y - hh;
    const y1 = y + hh;
    // pylons from behind the north stand, a cross brace
    const backZ = ARENA.minZ - (STAND_N0 + ROWS * ROW_D) - 1.2;
    for (const sx of [-1, 1]) {
      box(1.0, y0, 1.0, sx * (hw - 2), y0 / 2, backZ, gold);
      box(0.5, 0.5, Math.abs(z - backZ) + hd, sx * (hw - 2), y0 - 0.5, (z + backZ) / 2, gold);
    }
    box(2 * hw - 4, 0.45, 0.45, 0, y0 * 0.55, backZ, gold);
    // floor / roof slabs
    box(2 * hw + 0.6, 0.55, 2 * hd + 0.6, x, y0 - 0.27, z, navy);
    box(2 * hw + 0.6, 0.4, 2 * hd + 0.6, x, y1 + 0.2, z, gold);
    // gold frame: vertical posts at the corners and along the front
    for (const px of [-hw, -hw / 2, 0, hw / 2, hw]) box(0.28, 2 * hh, 0.28, px, y, z + hd, gold, false);
    for (const px of [-hw, hw]) box(0.28, 2 * hh, 0.28, px, y, z - hd, gold, false);
    // warm back wall (lit from inside) and the boardroom furniture
    const warm = this.emissive(0xffd890, 0.55, { speed: 0.4 });
    box(2 * hw - 0.4, 2 * hh - 0.2, 0.2, x, y, z - hd + 0.15, warm, false);
    const wood = this.std(0x3a2416, { roughness: 0.5 });
    box(12, 0.25, 2.2, x, y0 + 1.0, z - 0.4, wood);
    box(11, 0.9, 1.4, x, y0 + 0.5, z - 0.4, wood, false);
    const chair = this.std(0x15161c, { roughness: 0.6 });
    for (let i = -2; i <= 2; i++) {
      if (i === 0) continue;
      for (const sz of [-1, 1]) box(0.9, 1.6, 0.9, x + i * 2.4, y0 + 0.8, z - 0.4 + sz * 1.7, chair, false);
    }
    // the empty chair at the head of the table: tall, gold
    box(1.4, 3.0, 1.2, x, y0 + 1.5, z - hd + 1.0, gold, false);
    // glass shell (one transparent draw; no depth write so the room shows through)
    const glass = new THREE.MeshStandardMaterial({ color: 0xa8dcff, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.28, depthWrite: false });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(2 * hw, 2 * hh, 2 * hd), glass);
    shell.position.set(x, y, z);
    shell.renderOrder = 4;
    this.add(shell);
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
    this.add(sign);
    // a gold light bar along the box's underside
    box(2 * hw, 0.14, 0.14, x, y0 - 0.6, z + hd + 0.3, this.emissive(0xffd257, 1.6, { speed: 2.2 }), false);
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
