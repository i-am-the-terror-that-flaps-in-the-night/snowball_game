import * as THREE from 'three';
import type { GameContext, ImpactAPI, ImpactKind, ImpactOpts } from '../core/types';
import { settings } from '../core/settings';

/* Impact feel: game-wide hit-stop + slow-mo (a sim time scale read by Game.tick), directional camera punches,
 * a fixed pool of impact lights and a DOM flash / damage-vignette overlay. */

/** Sim speed during a hit-stop (near 0, not 0, so inputs and timers never fully stall). */
const STOP_SCALE = 0.04;
/** No new hit-stop starts within this many real seconds of the last one ending (no chained stalls). */
const STOP_GAP = 0.15;
/** Final-kill / boss-kill slow-mo: real seconds, sim speed, and the tail (real seconds) spent ramping back to 1x. */
const SLOWMO_SECONDS = 0.6;
const SLOWMO_SCALE = 0.3;
const SLOWMO_RAMP = 0.25;
/** Impact lights: pool size and fade time (s). */
const LIGHT_POOL = 3;
const LIGHT_FADE = 0.25;
/** Heavy player hit: absolute damage or fraction of max HP that triggers the vignette. */
const HEAVY_HIT = 20;
const HEAVY_FRAC = 0.15;

interface KindDef {
  color: number;
  /** Peak light intensity (candela) at strength 1, and light range (m). */
  light: number;
  range: number;
  /** Hit-stop seconds at strength 1 (0 = none). */
  stop: number;
  /** Camera kick (m) and FOV punch (degrees, negative = zoom in) at strength 1. */
  kick: number;
  fov: number;
  /** Bypass the STOP_GAP cooldown. */
  force?: boolean;
}

const KINDS: Record<ImpactKind, KindDef> = {
  slam: { color: 0x8cbcff, light: 150, range: 22, stop: 0.06, kick: 0.45, fov: -3 },
  wreck: { color: 0xff8a2a, light: 80, range: 20, stop: 0, kick: 0.3, fov: 0 },
  kill: { color: 0xff8a2a, light: 0, range: 0, stop: 0.05, kick: 0, fov: 0 },
  bossHit: { color: 0xffffff, light: 0, range: 0, stop: 0.05, kick: 0.25, fov: 0 },
  bossKill: { color: 0xffd27a, light: 260, range: 40, stop: 0.09, kick: 0.9, fov: -6, force: true },
  pound: { color: 0xdff2ff, light: 110, range: 26, stop: 0.075, kick: 0.7, fov: -4 },
  clap: { color: 0x8fd8ff, light: 150, range: 28, stop: 0.07, kick: 0.6, fov: -4 },
  meltdown: { color: 0x6dff3a, light: 120, range: 26, stop: 0.065, kick: 0.55, fov: -3.5 },
  nuke: { color: 0x7dff4a, light: 600, range: 70, stop: 0.16, kick: 1.4, fov: -9, force: true },
  player: { color: 0xff5a4a, light: 0, range: 0, stop: 0.05, kick: 0.5, fov: 0 },
};

interface Flash {
  light: THREE.PointLight;
  peak: number;
  t: number;
}

const _v = new THREE.Vector3();

export class Impact implements ImpactAPI {
  /** Master switch for the time scale (headless probes can set `__game.impact.enabled = false`). */
  enabled = true;
  private ctx: GameContext;
  /** Real seconds the sim has been active (advanced by step()). */
  private now = 0;
  private stopStart = -1;
  private stopEnd = -1;
  private slowT = 0;
  private flashes: Flash[] = [];
  private overlay: HTMLDivElement;
  private flashEl: HTMLDivElement;
  private vigEl: HTMLDivElement;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    for (let i = 0; i < LIGHT_POOL; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 20, 2);
      light.castShadow = false;
      light.position.set(0, -50, 0);
      ctx.scene.add(light);
      this.flashes.push({ light, peak: 0, t: 0 });
    }
    this.overlay = document.createElement('div');
    this.overlay.className = 'impact-overlay';
    this.vigEl = document.createElement('div');
    this.vigEl.className = 'impact-vig';
    this.flashEl = document.createElement('div');
    this.flashEl.className = 'impact-flash';
    this.overlay.append(this.vigEl, this.flashEl);
    document.body.appendChild(this.overlay);

    ctx.events.on('enemyKilled', ({ enemy }) => this.stop(enemy.isBoss ? KINDS.bossKill.stop : KINDS.kill.stop + 0.01 * Math.min(2, enemy.radius), enemy.isBoss));
    ctx.events.on('enemyHit', ({ enemy, damage }) => {
      if (enemy.isBoss && enemy.alive && damage >= 10) this.stop(KINDS.bossHit.stop);
    });
    ctx.events.on('bossDefeated', () => this.screenFlash(0.75, 0.45));
  }

  /** True while a hit-stop or slow-mo is playing (Game holds the round-clear until it ends). */
  get holding(): boolean {
    return this.enabled && (this.now < this.stopEnd || this.slowT > 0);
  }

  /** Big impact at `pos`. `strength` ~1 = normal (slam: ball radius). */
  hit(kind: ImpactKind, pos: THREE.Vector3, strength = 1, opts?: ImpactOpts): void {
    const def = KINDS[kind];
    const s = Math.max(0, strength);
    if (def.light > 0) this.light(def.color, pos, def.light * (0.5 + 0.5 * s), def.range * (0.8 + 0.2 * Math.min(2, s)));
    if (def.stop > 0 && opts?.stop !== false) {
      // Slams scale with ball size: 40 ms (tiny) .. 90 ms (huge).
      const sec = kind === 'slam' ? THREE.MathUtils.clamp(0.03 + 0.025 * s, 0.04, 0.09) : def.stop;
      this.stop(sec, def.force);
    }
    if (def.kick > 0) this.kick(pos, def.kick * Math.min(1.6, s) * (opts?.falloff ?? 1), def.fov * Math.min(1.5, s));
    if (kind === 'nuke') this.screenFlash(0.9, 0.6);
  }

  /** The player took `damage` from an attacker at (fromX, fromZ): camera punch, plus vignette + hit-stop when heavy. */
  playerHit(damage: number, fromX: number, fromZ: number): void {
    const plow = this.ctx.plow;
    if (!plow || damage <= 0) return;
    const heavy = damage >= HEAVY_HIT || damage >= HEAVY_FRAC * plow.maxHp;
    _v.set(fromX, plow.position.y, fromZ);
    this.kick(_v, KINDS.player.kick * Math.min(1.5, 0.25 + damage / 30), heavy ? -2 : 0);
    if (!heavy) return;
    this.stop(KINDS.player.stop);
    this.vignette(Math.min(1, 0.6 + damage / 80));
  }

  /** Final-kill slow-mo (~0.3x, ramping back to 1x). */
  slowMo(seconds = SLOWMO_SECONDS): void {
    this.slowT = Math.max(this.slowT, seconds);
  }

  /** Sim time scale for this tick; advances the hit-stop / slow-mo timers by `realDt`. */
  step(realDt: number): number {
    let scale = 1;
    if (this.enabled) {
      if (this.now < this.stopEnd) scale = STOP_SCALE;
      if (this.slowT > 0) {
        const ramp = this.slowT < SLOWMO_RAMP ? this.slowT / SLOWMO_RAMP : 1; // 1 -> 0 at the tail
        const k = ramp * ramp * (3 - 2 * ramp);
        scale = Math.min(scale, 1 - (1 - SLOWMO_SCALE) * k);
      }
    }
    this.now += realDt;
    this.slowT = Math.max(0, this.slowT - realDt);
    return scale;
  }

  /** Light fades (real time). */
  update(dt: number): void {
    for (const f of this.flashes) {
      if (f.t <= 0) continue;
      f.t = Math.max(0, f.t - dt);
      const u = f.t / LIGHT_FADE;
      f.light.intensity = f.peak * u * u;
    }
  }

  clear(): void {
    this.stopStart = this.stopEnd = -1;
    this.slowT = 0;
    for (const f of this.flashes) {
      f.t = 0;
      f.light.intensity = 0;
    }
  }

  private stop(seconds: number, force = false): void {
    if (!this.enabled || seconds <= 0) return;
    if (this.now < this.stopEnd) {
      // Merge into the running stop, measured from its start, so overlapping hits never chain.
      this.stopEnd = Math.max(this.stopEnd, this.stopStart + seconds);
      return;
    }
    if (!force && this.now < this.stopEnd + STOP_GAP) return;
    this.stopStart = this.now;
    this.stopEnd = this.now + seconds;
  }

  private light(color: number, pos: THREE.Vector3, intensity: number, range: number): void {
    if (settings.reduceFlash) intensity *= 0.5;
    // Reuse the dimmest light in the pool.
    let f = this.flashes[0];
    for (const x of this.flashes) if (x.light.intensity < f.light.intensity) f = x;
    f.light.color.setHex(color);
    f.light.position.set(pos.x, pos.y + 2, pos.z);
    f.light.distance = range;
    f.peak = intensity;
    f.light.intensity = intensity;
    f.t = LIGHT_FADE;
  }

  /** Directional camera kick away from `pos`, attenuated by distance from the plow. */
  private kick(pos: THREE.Vector3, amount: number, fov: number): void {
    const cam = this.ctx.camera;
    const plow = this.ctx.plow;
    const ref = plow ? plow.position : cam.position;
    const d = Math.hypot(pos.x - ref.x, pos.z - ref.z);
    const fall = THREE.MathUtils.clamp(1 - (d - 6) / 34, 0, 1);
    if (fall <= 0) return;
    const rig = this.ctx.cameraRig;
    let dx = cam.position.x - pos.x;
    let dz = cam.position.z - pos.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) {
      dx = 0;
      dz = 0;
    } else {
      dx /= len;
      dz /= len;
    }
    rig.kick(dx, dz, amount * fall);
    if (fov) rig.punchFov(fov * fall);
  }

  private screenFlash(opacity: number, seconds: number): void {
    const reduce = settings.reduceFlash;
    const peak = reduce ? Math.min(0.2, opacity * 0.25) : opacity;
    this.flashEl.getAnimations().forEach((a) => a.cancel());
    this.flashEl.animate(
      [{ opacity: peak }, { opacity: peak * 0.6, offset: 0.15 }, { opacity: 0 }],
      { duration: (reduce ? seconds * 1.5 : seconds) * 1000, easing: 'ease-out' },
    );
  }

  private vignette(strength: number): void {
    const reduce = settings.reduceFlash;
    this.vigEl.classList.toggle('impact-vig-calm', reduce);
    this.vigEl.getAnimations().forEach((a) => a.cancel());
    const peak = (reduce ? 0.45 : 1) * strength;
    this.vigEl.animate([{ opacity: peak }, { opacity: peak * 0.7, offset: 0.3 }, { opacity: 0 }], { duration: 420, easing: 'ease-out' });
  }
}
