import * as THREE from 'three';
import type { GameContext } from '../core/types';
import type { KillDef } from '../config/cosmetics';
import type { Lightning } from './Lightning';

/* Paint Shop kill effects: an extra burst on top of the normal wreck when the player wrecks a bot or rival.
 * Built only from the pooled Fx particles / rings / float text and the Combat lightning pool, so a kill never
 * creates meshes. */

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const pick = (c: number[]) => c[(Math.random() * c.length) | 0];

/** `preview` (Paint Shop): the Combat lightning pool only animates in a run, so bolts become particle columns. */
export function emitKillFx(ctx: GameContext, kill: KillDef, at: THREE.Vector3, preview = false): void {
  const fx = ctx.fx;
  const c = kill.colors;
  _p.set(at.x, at.y + 1.4, at.z);
  switch (kill.style) {
    case 'confetti':
      for (const col of c) fx.burst(_p, { color: col, count: 9, speed: 9, size: 0.15, gravity: 7, life: 1.8 });
      fx.floatText(_p, 'WRECKED!', '#ffc531', 1);
      break;
    case 'snowflakes':
      for (const col of c) fx.burst(_p, { color: col, count: 12, speed: 5, size: 0.22, gravity: 1.2, life: 2.2 });
      _q.set(at.x, 0.05, at.z);
      fx.ring(_q, 4, 0xcff4ff);
      break;
    case 'coins':
      for (let i = 0; i < 3; i++) fx.burst(_p, { color: pick(c), count: 12, speed: 10, size: 0.2, gravity: 20, life: 1.3 });
      fx.burst(_p, { color: 0xffffff, count: 8, speed: 4, size: 0.12, gravity: 0, life: 0.5 });
      fx.floatText(_p, '$$$', '#ffd23a', 1.1);
      ctx.audio.play('coin', { pitch: 1.3 });
      break;
    case 'pixel':
      for (const col of c) fx.burst(_p, { color: col, count: 8, speed: 7, size: 0.2, gravity: 0, life: 0.7 });
      fx.floatText(_p, 'K.O.', '#35ff6b', 1.2);
      break;
    case 'lightning': {
      const lightning = (ctx.combat as { lightning?: Lightning } | undefined)?.lightning;
      _q.set(at.x, at.y + 0.5, at.z);
      if (lightning && !preview) {
        for (let i = 0; i < 3; i++) {
          _p.set(at.x + (Math.random() - 0.5) * 3, at.y + 14, at.z + (Math.random() - 0.5) * 3);
          lightning.bolt(_p, _q, { life: 0.25, width: 0.16, jag: 0.6, color: pick(c) });
        }
      } else {
        for (let y = 0; y < 9; y += 0.6) {
          _p.set(at.x + (Math.random() - 0.5) * 0.5, at.y + y, at.z + (Math.random() - 0.5) * 0.5);
          fx.burst(_p, { color: pick(c), count: 2, speed: 0.6, size: 0.12, gravity: 0, life: 0.35 });
        }
      }
      _p.set(at.x, at.y + 1, at.z);
      fx.burst(_p, { color: 0x9fe8ff, count: 26, speed: 10, size: 0.14, gravity: 10, life: 0.5 });
      _q.y = 0.05;
      fx.ring(_q, 5, 0x9fe8ff);
      ctx.audio.play('zap', { volume: 0.8 });
      break;
    }
    default:
      break;
  }
}
