import type { GameContext, WaveDirectorAPI, ZoneDef } from '../core/types';
import { ENEMY_GATES, GATE_WIDTH } from '../core/types';
import { ENEMIES, type EnemyType } from '../config/enemies';
import { OMEGA_HATCHES, OMEGA_TERRAIN } from '../world/omega/layout';
import { pickHatches } from '../world/omega/zone';

/** Hatches on open ground (deck -1, not in the undercroft): where bosses rise in The Omega Works. */
const OPEN_HATCHES = OMEGA_HATCHES.filter((h) => h.deck < 0 && !(Math.abs(h.x) < 18 && Math.abs(h.z) < 18));
/** Hatch spawns this close together in time step to the next hatch so bots don't stack. */
const HATCH_REUSE = 1.2;

/* WaveDirector: turns an arena round (zone.rounds[i].groups) into a timed spawn queue. Minions rotate
 * through the three gates (shuffled order, so packs come from varying sides); bosses enter through gate 0
 * (north), twin bosses through gates 1 and 2. Summoned minions are spawned by the EnemyManager itself
 * and are covered by aliveCount(), so `done` = queue empty && nothing alive.
 * The Omega Works (160 m) has no usable gates near the fight: everything rises out of floor hatches 9-35 m from the
 * player (world/omega/zone.ts pickHatches), so a wave never starts a long drive away. */

interface QueuedSpawn {
  t: number;
  type: EnemyType;
  gate: number;
  /** SpawnGroup.hpMult (1 = just the zone's). */
  hp: number;
}

export class WaveDirector implements WaveDirectorAPI {
  private ctx: GameContext;
  private queue: QueuedSpawn[] = [];
  private next = 0;
  private time = 0;
  private started = false;
  private hpMult = 1;
  private lastGateT = [-99, -99, -99];
  private gateBacklog = [0, 0, 0];
  /** The Omega Works: rotates hatch picks between spawns; last spawn time per hatch. */
  private hatchTurn = 0;
  private hatchT = new Map<number, number>();

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  start(zone: ZoneDef, roundIndex: number): void {
    this.clear();
    this.hpMult = zone.enemyHpMult;
    const round = zone.rounds[Math.max(0, Math.min(roundIndex, zone.rounds.length - 1))];
    if (round) {
      let bossCount = 0;
      for (const g of round.groups) if (ENEMIES[g.type].isBoss) bossCount += g.count;
      const bossGates = bossCount > 1 ? [1, 2, 0] : [0];
      let bi = 0;
      let order = this.shuffled();
      let oi = 0;
      for (const g of round.groups) {
        const boss = ENEMIES[g.type].isBoss;
        for (let i = 0; i < g.count; i++) {
          let gate: number;
          if (boss) gate = bossGates[bi++ % bossGates.length];
          else {
            if (oi >= order.length) {
              order = this.shuffled(order[order.length - 1]);
              oi = 0;
            }
            gate = order[oi++];
          }
          this.queue.push({ t: g.delay + i * g.interval, type: g.type, gate, hp: g.hpMult ?? 1 });
        }
      }
    }
    this.queue.sort((a, b) => a.t - b.t);
    this.started = true;
  }

  get done(): boolean {
    return this.started && this.next >= this.queue.length && this.ctx.enemies.aliveCount() === 0;
  }

  get remaining(): number {
    return this.queue.length - this.next + this.ctx.enemies.aliveCount();
  }

  clear(): void {
    this.queue.length = 0;
    this.next = 0;
    this.time = 0;
    this.started = false;
    this.lastGateT.fill(-99);
    this.gateBacklog.fill(0);
    this.hatchTurn = 0;
    this.hatchT.clear();
  }

  update(dt: number): void {
    if (!this.started) return;
    this.time += dt;
    while (this.next < this.queue.length && this.queue[this.next].t <= this.time) {
      const s = this.queue[this.next++];
      this.spawn(s);
    }
  }

  /** Gate order 0..2 shuffled, avoiding repeating `avoidFirst` back-to-back. */
  private shuffled(avoidFirst = -1): number[] {
    const a = [0, 1, 2];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    if (a[0] === avoidFirst) {
      const t = a[0];
      a[0] = a[1];
      a[1] = t;
    }
    return a;
  }

  private spawn(s: QueuedSpawn): void {
    if (this.ctx.zone.theme === 'omega') return this.spawnHatch(s.type, s.hp);
    const def = ENEMIES[s.type];
    const g = ENEMY_GATES[s.gate];
    const fx = Math.sin(g.heading);
    const fz = Math.cos(g.heading);
    // stagger bots spawned at the same gate in quick succession further back so they don't stack
    if (this.time - this.lastGateT[s.gate] < 1.2) this.gateBacklog[s.gate] += 1;
    else this.gateBacklog[s.gate] = 0;
    this.lastGateT[s.gate] = this.time;
    const back = Math.min(7, this.gateBacklog[s.gate] * (def.radius * 2 + 0.6));
    const lat = def.isBoss ? 0 : (Math.random() - 0.5) * Math.max(0, GATE_WIDTH - 2 * def.radius - 0.8);
    const x = g.x + fz * lat - fx * back;
    const z = g.z - fx * lat - fz * back;
    this.ctx.enemies.spawn(s.type, x, z, { hpMult: this.hpMult * s.hp, heading: g.heading });
  }

  /** The Omega Works: rise out of a floor hatch near the player (bosses: an open-ground hatch), facing them. */
  private spawnHatch(type: EnemyType, hp: number): void {
    const ctx = this.ctx;
    const p = ctx.plow.position;
    const boss = ENEMIES[type].isBoss;
    const pool = boss ? OPEN_HATCHES : OMEGA_HATCHES;
    // Nearest-first candidates; skip ones used a moment ago so a pack fans out over several hatches.
    const picks = pickHatches(p.x, p.y, p.z, Math.min(pool.length, 6), this.hatchTurn++, pool);
    let i = picks[0] ?? 0;
    for (const k of picks) {
      if (this.time - (this.hatchT.get(k) ?? -99) >= HATCH_REUSE) {
        i = k;
        break;
      }
    }
    this.hatchT.set(i, this.time);
    const h = pool[i];
    const y = h.deck < 0 ? 0 : (OMEGA_TERRAIN.decks!.find((d) => d.id === h.deck)?.top ?? 0);
    const jx = boss ? 0 : (Math.random() - 0.5) * 1.2;
    const jz = boss ? 0 : (Math.random() - 0.5) * 1.2;
    ctx.enemies.spawn(type, h.x + jx, h.z + jz, { hpMult: this.hpMult * hp, heading: Math.atan2(p.x - h.x, p.z - h.z), y: y + 0.5 });
  }
}
