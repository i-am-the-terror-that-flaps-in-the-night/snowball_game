import type { GameContext, WaveDirectorAPI, ZoneDef } from '../core/types';
import { ENEMY_GATES, GATE_WIDTH } from '../core/types';
import { ENEMIES, type EnemyType } from '../config/enemies';

/* WaveDirector: turns an arena round (zone.rounds[i].groups) into a timed spawn queue. Minions rotate
 * through the three gates (shuffled order, so packs come from varying sides); bosses enter through gate 0
 * (north), twin bosses through gates 1 and 2. Summoned minions are spawned by the EnemyManager itself
 * and are covered by aliveCount(), so `done` = queue empty && nothing alive. */

interface QueuedSpawn {
  t: number;
  type: EnemyType;
  gate: number;
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
          this.queue.push({ t: g.delay + i * g.interval, type: g.type, gate });
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
    this.ctx.enemies.spawn(s.type, x, z, { hpMult: this.hpMult, heading: g.heading });
  }
}
