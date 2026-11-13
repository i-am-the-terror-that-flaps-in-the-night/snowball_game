import { PlowBase } from './PlowBase';
import * as THREE from 'three';
import { ballVolume, type PlayerStats } from '../../core/types';
import type { PlowKind } from '../../config/plows';
import {
  cleatZ, SAW_R, FACTORY_PAINT, buildDecals, emitTrail, TRAIL_REAR, PLOW_WHEEL_POS, bladeTexture,
} from '../plowModels';
import type { CosmeticSlot } from '../../config/cosmetics';
import { makeShadowProxy } from '../../render/shadowProxy';
import { getPaintEnvMap } from '../../render/reflections';
import { cosmeticsState, resolveLook } from '../../meta/cosmetics';
import { GearVisuals } from '../gearVisuals';
import { CLASSIC_EXHAUST } from '../vehicles/classic';
import {
  BLADE_Z, TIP_Z, WHEEL_R, BRUTE_BLADE_Y, BRUTE_BLADE_Z, SAW_SPIN_BASE, SAW_SPIN_FULL, SAW_FURY_SPIN, SAW_FURY_DRAIN,
  _haloCool, _haloHot, SLAM_LUNGE, WHIRL_SECONDS, MAX_STREAKS, STREAK_LIFE, TRAIL_EVERY, TRAIL_EVERY_DASH,
} from './constants';
import { _a, _b, _c, _dir, _q, _m, _s, _col, _e, _p, _one, _up, _ballSurf } from './scratch';
import type { Streak } from './assets';
import { floorTop } from '../combat/shared';

/** STREAK underglow: radius (m) at which the snow round the hull is sampled for the ring's height. */
const STREAK_GLOW_R = 3.4;

/* Layer 2 of the Plow class (see PlowBase.ts): kind swap, Paint Shop look, blade / wheels / cleats, and every
 * per-frame visual (model animation, saws, beacon, flame, held ball, trails, streaks, ghosts, tornado). */

/* Constant FX options for per-frame / per-hit paths (hoisted so they are not rebuilt per call; never mutated). */
const DASH_EXHAUST_BURST = { color: 0xff9a2a, count: 3, speed: 2, size: 0.22, gravity: -3, life: 0.35 };
const LOW_HP_SMOKE_BURST = { color: 0x2e2e34, count: 1, speed: 0.8, size: 0.4, gravity: -2.5, life: 1.1 };

export abstract class PlowVisuals extends PlowBase {
  /** Swap the paint job + parts for the selected starter plow. */
  private setKind(kind: PlowKind, snowKit = false): void {
    this.kind = kind;
    this.snowKit = snowKit;
    if (this.vehicle) this.heldVolume = 0;
    const volt = kind === 'volt';
    const brute = kind === 'brute';
    const iso = kind === 'isotope';
    const ars = kind === 'arsenal';
    // Body paint + decals follow the Paint Shop look (factory colours unless a paint is equipped).
    this.syncLook(true);
    // The Classic's blade face is polished steel (it catches the sky: env map in syncLook).
    this.steelMat.color.setHex(volt ? 0x9fe8ff : brute ? 0x7a828e : iso ? 0x9ad63a : kind === 'classic' ? 0xd4dce4 : 0xffd23a);
    this.steelMat.metalness = kind === 'classic' ? 0.85 : 0.55;
    this.steelMat.roughness = kind === 'classic' ? 0.18 : 0.35;
    this.steelMat.emissive.setHex(volt ? 0x1a8cff : iso ? 0x2f8a10 : 0x000000);
    this.steelMat.emissiveIntensity = volt ? 0.6 : iso ? 0.35 : 0;
    this.beaconMat.color.setHex(volt ? 0x7fdcff : iso ? 0x7dff4a : 0xffb000);
    this.beaconMat.emissive.setHex(volt ? 0x2fb8ff : iso ? 0x3dff1a : 0xff9a00);
    this.classicParts.visible = kind === 'classic';
    this.isoParts.visible = iso;
    this.arsenalParts.visible = ars;
    // Only the Classic has a blade (BRUTUS's buzzsaws are on its own mech body).
    this.bladeGroup.visible = kind === 'classic' || !this.vehicle;
    this.applyBladeVis();
    this.voltParts.visible = volt;
    this.bruteParts.visible = brute;
    this.bruteBlade.visible = brute;
    for (const m of this.wheelMeshes) m.visible = !brute && !ars; // BRUTUS runs on tracks, ARSENAL on its own front wheels + gyro
    for (const w of this.wheelDebris) w.visible = this.wheelsOff && !brute && !ars;
    // Dash flame: out of the stack (Classic), a rear thruster (VOLT-9) or the right-hand twin stack (BRUTUS).
    if (volt) {
      this.exhaustTip.set(0, 1.05, -2.05);
      this.flame.rotation.set(-Math.PI / 2, 0, 0);
    } else if (brute) {
      this.exhaustTip.set(0.55, 3.1, -1.45);
      this.flame.rotation.set(0, 0, 0);
    } else if (ars) {
      this.exhaustTip.set(0, 1.17, -3.65); // out of the back of the gyro core
      this.flame.rotation.set(-Math.PI / 2, 0, 0);
    } else if (iso) {
      this.exhaustTip.set(0.55, 2.38, 0.12);
      this.flame.rotation.set(0, 0, 0);
    } else {
      this.exhaustTip.copy(CLASSIC_EXHAUST);
      this.flame.rotation.set(0, 0, 0);
    }
    this.flame.position.copy(this.exhaustTip);
    this.engineTip.set(0, brute ? 2.0 : 1.6, brute ? -1.0 : 1.7);
    this.beaconLight.position.set(0, volt ? 0.4 : brute ? 2.6 : iso ? 2.1 : 2.8, volt ? 0 : brute ? 1.4 : iso ? -1.0 : kind === 'classic' ? -0.1 : 0.8);
    this.applyBladeScale();
  }

  /* ------------------------------------------------------------------ cosmetics */

  /** Re-read the equipped Paint Shop look (+ any shop preview) and repaint / re-decal if it changed. Player plow
   *  only: Brawl rivals and campaign bots build their own materials. */
  protected syncLook(force = false): void {
    this.syncGear();
    const look = resolveLook({ ...(this.b.look ?? cosmeticsState(this.ctx.progression).equipped), ...this.preview });
    const key = `${this.kind}|${look.paint.id}|${look.decal.id}|${look.trail.id}|${look.blade.id}|${look.horn.id}|${look.kill.id}`;
    if (!force && key === this.lookKey) return;
    this.lookKey = key;
    this.look = look;
    // Paint: body panels everywhere, the Classic's dump bed as trim, wheel hubs as accent. VOLT glow, BRUTUS
    // hazard stripes and the blade keep their own materials.
    const f = FACTORY_PAINT[this.kind];
    const p = look.paint;
    this.paintBase.setHex(p.body ?? f.body);
    this.bedBase.setHex(p.trim ?? f.trim);
    // ARSENAL's factory finish is gunmetal: semi-metallic panels that pick up the sky (env map) instead of going black.
    const gunmetal = this.kind === 'arsenal' && p.body == null && p.metalness == null;
    this.paintMat.metalness = p.metalness ?? (gunmetal ? 0.45 : 0.15);
    this.paintMat.roughness = p.roughness ?? (gunmetal ? 0.36 : this.kind === 'volt' ? 0.28 : 0.45); // VOLT: glossy ceramic
    this.bedMat.metalness = p.metalness ?? (gunmetal ? 0.4 : 0.1);
    this.bedMat.roughness = p.roughness ?? 0.5;
    // The Classic's factory yellow is a glossy clear coat (low roughness + a faint sky reflection).
    const gloss = this.kind === 'classic' && p.metalness == null && p.roughness == null;
    if (gloss) {
      this.paintMat.metalness = 0;
      this.paintMat.roughness = 0.3;
    }
    const env = p.mirror || gunmetal || gloss ? getPaintEnvMap(this.ctx.renderer) : null;
    if (this.paintMat.envMap !== env) {
      this.paintMat.envMap = this.bedMat.envMap = env;
      this.paintMat.needsUpdate = this.bedMat.needsUpdate = true;
    }
    this.paintMat.envMapIntensity = this.bedMat.envMapIntensity = gunmetal ? 0.8 : gloss ? 0.3 : 1;
    // Classic chrome / tinted glass / polished blade steel reflect the sky; the other kinds' blade steel doesn't.
    const steelEnv = this.kind === 'classic' ? getPaintEnvMap(this.ctx.renderer) : null;
    for (const m of this.kind === 'classic' ? [...this.classicRig.metalMats, this.steelMat] : [this.steelMat]) {
      if (m.envMap === steelEnv) continue;
      m.envMap = steelEnv;
      m.needsUpdate = true;
    }
    if (this.kind === 'arsenal') {
      const metalEnv = getPaintEnvMap(this.ctx.renderer);
      for (const m of this.arsRig.metalMats) {
        if (m.envMap === metalEnv) continue;
        m.envMap = metalEnv;
        m.needsUpdate = true;
      }
    }
    const fh = this.kind === 'volt' ? 0x2f9be0 : this.kind === 'brute' ? 0xd8611f : this.kind === 'isotope' ? 0x7dff4a : 0xffd23a;
    this.hubBase.setHex(p.accent ?? (this.kind === 'classic' ? 0xc9d2dc : fh)); // Classic: polished alloy hubs
    if (!this._dead) {
      this.hubMat.color.copy(this.hubBase);
      this.paintMat.color.copy(this.paintBase);
      this.bedMat.color.copy(this.bedBase);
    }
    // Blade skin: a textured material on the main blade sheet (factory steel otherwise).
    const b = look.blade;
    if (b.id !== this.bladeKey) {
      this.bladeKey = b.id;
      if (b.style) {
        const m = this.bladeSkinMat;
        const tex = bladeTexture(b.style);
        // The sheet's UVs run around the curve (u) and along the width (v): turn the canvas a quarter.
        tex.center.set(0.5, 0.5);
        tex.rotation = Math.PI / 2;
        m.map = tex;
        m.metalness = b.metalness ?? 0.3;
        m.roughness = b.roughness ?? 0.45;
        m.envMap = b.mirror ? getPaintEnvMap(this.ctx.renderer) : null;
        m.envMapIntensity = b.mirror ? 1.2 : 1;
        m.needsUpdate = true;
        this.bladeSheet.material = m;
      } else {
        this.bladeSheet.material = this.steelMat;
      }
    }
    // Decal: rebuilt only when the style or the plow body changes.
    const decalKey = `${this.kind}|${look.decal.style ?? ''}`;
    if (decalKey !== this.decalKey) {
      this.decalKey = decalKey;
      if (this.decals) {
        this.body.remove(this.decals);
        const geos = new Set<THREE.BufferGeometry>();
        this.decals.traverse((o) => o instanceof THREE.Mesh && geos.add(o.geometry));
        for (const g of geos) g.dispose();
        this.decals = null;
      }
      if (look.decal.style) {
        this.decals = buildDecals(this.kind, look.decal.style, this.decalMat);
        this.body.add(this.decals);
      }
    }
  }

  /** Equipped gear on the model (duel opponents wear what they brought). The flame tint follows the booster. */
  private syncGear(): void {
    const ids = this.b.gear ?? GearVisuals.idsFrom(this.ctx.progression.gear.equipped);
    this.gearVis.sync(this.kind, ids, this.bladeWidth);
    this.flameMat.color.setHex(this.gearVis.flame ?? (this.kind === 'isotope' ? 0x7dff4a : 0xff8a1a));
  }

  /** Paint Shop: try an item on (null = back to the equipped one for that slot). */
  previewCosmetic(slot: CosmeticSlot, id: string | null): void {
    if (id) this.preview[slot] = id;
    else delete this.preview[slot];
    this.syncLook();
  }

  clearPreview(): void {
    this.preview = {};
    this.syncLook();
  }

  /** Paint Shop backdrop: turn the parked plow on the spot to `yaw` (rad, relative to its heading); `trail` also
   *  runs its cosmetic trail as if cruising. */
  showcase(yaw: number, dt: number, trail: boolean): void {
    this.object.rotation.set(0, this.heading + yaw, 0);
    this.time += dt;
    if (trail) this.emitTrail(dt, false);
  }

  /** Back to the parked pose after the Paint Shop closes. */
  endShowcase(): void {
    this.object.rotation.set(0, this.heading, 0);
  }

  /** Cosmetic trail puffs from both rear corners (throttled; denser while dashing). */
  protected emitTrail(dt: number, dash: boolean): void {
    const trail = this.look.trail;
    if (!trail.style) return;
    this.trailT -= dt;
    if (this.trailT > 0) return;
    this.trailT = dash ? TRAIL_EVERY_DASH : TRAIL_EVERY;
    const r = TRAIL_REAR[this.kind];
    const yaw = this.object.rotation.y;
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    for (const sx of [-1, 1]) {
      const x = r.x * sx;
      _c.set(this.position.x + x * c + r.z * s, this.position.y + r.y, this.position.z - x * s + r.z * c);
      emitTrail(this.ctx.fx, trail, _c, dash, this.time + (sx > 0 ? 0.15 : 0));
    }
  }

  /** BRUTUS gets a taller, deeper blade (re-applied after a reset, since the wreck pops restore part scales). */
  protected applyBladeScale(): void {
    const brute = this.kind === 'brute';
    const volt = this.kind === 'volt';
    this.bladeGroup.scale.set(1, brute ? BRUTE_BLADE_Y : volt ? 0.82 : 1, brute ? BRUTE_BLADE_Z : volt ? 0.85 : 1);
    this.streakSilDirty = true;
    // Keep the saws round inside the stretched blade group.
    // (The left saw is mirrored on X so its mounting arm points back at the blade.)
    this.saws.forEach((saw, i) => saw.group.scale.set(i === 0 ? -1 : 1, 1 / this.bladeGroup.scale.y, 1 / this.bladeGroup.scale.z));
  }

  applyStats(stats: PlayerStats): void {
    if (stats.plowKind !== this.kind || !!stats.snowKit !== this.snowKit) this.setKind(stats.plowKind, !!stats.snowKit);
    const ratio = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    this.maxHp = stats.maxHp;
    this.hp = Math.max(0, Math.min(this.maxHp, ratio * this.maxHp));
    if (!this._dead && this.hp <= 0) this.hp = this.maxHp;
    this.setBladeWidth(stats.bladeWidth);
    const cap = ballVolume(stats.maxBallRadius);
    if (this.heldVolume > cap) this.heldVolume = cap;
  }

  protected setBladeWidth(w: number): void {
    this.bladeWidth = w;
    // The sheet spans between the hinged wings; the wings fill the outer CLASSIC_WING on each side.
    this.bladeSheet.scale.x = this.classicRig.setWidth(w);
    this.gearVis?.setWidth(w);
    if (w !== this.capsWidth) {
      this.capsWidth = w;
      // The frame + arms cast through one proxy (the sheet keeps its own: it is double-sided and scales).
      for (const m of this.bladeCasters) m.castShadow = true;
      if (this.bladeProxy) {
        this.bladeProxy.removeFromParent();
        this.bladeProxy.geometry.dispose();
      }
      // A bladeless vehicle has nothing here that casts: no proxy (makeShadowProxy returns none).
      this.bladeProxy = makeShadowProxy([this.bladeCaps, this.bladeArms], this.bladeGroup)[0] ?? null;
      if (this.bladeProxy) this.bladeGroup.add(this.bladeProxy);
      this.applyBladeVis();
      this.streakSilDirty = true;
    }
    // Mounted high (~1.3 m world) so the flat saws ride above the snow and the berms the blade pushes aside.
    this.saws[0].group.position.set(-w / 2 - 0.6, 1.0, 0.45);
    this.saws[1].group.position.set(w / 2 + 0.6, 1.0, 0.45);
    for (const g of this.ghosts) g.blade.scale.x = w;
  }

  /** Blade sheet / caps / arms + ram (+ their shadow proxy): Classic only. */
  private applyBladeVis(): void {
    const on = !this.vehicle;
    for (const o of [this.bladeSheet, this.bladeCaps, this.bladeArms, this.bladeProxy]) if (o) o.visible = on;
  }

  /** Wheel instance matrices from spin / steer (the same Euler -> matrix path the wheel groups took). */
  protected writeWheels(): void {
    const im = this.wheelMeshes[0];
    for (let i = 0; i < 4; i++) {
      if (this.wheelsOff && (i === 0 || i === 3)) _m.makeScale(0, 0, 0);
      else {
        _e.set(this.wheelSpin[i], i < 2 ? this.wheelSteer[i] : 0, 0, 'YXZ');
        _m.compose(_p.set(PLOW_WHEEL_POS[i][0], WHEEL_R, PLOW_WHEEL_POS[i][1]), _q.setFromEuler(_e), _one);
      }
      im.setMatrixAt(i, _m);
    }
    im.instanceMatrix.needsUpdate = true;
  }

  /** BRUTUS cleat instances at track phase `phase` (no upload when the tracks haven't moved). */
  protected setCleats(phase: number): void {
    if (phase === this.cleatPhase) return;
    this.cleatPhase = phase;
    for (let i = 0; i < this.cleats.length; i++) {
      const c = this.cleats[i];
      const p = c.mesh.position;
      this.cleatMesh.setMatrixAt(i, _m.makeTranslation(p.x, p.y, cleatZ(c.i, c.top, phase, this.cleatSpan)));
    }
    this.cleatMesh.instanceMatrix.needsUpdate = true;
  }

  /* ------------------------------------------------------------------ visuals */

  protected exhaustWorld(out: THREE.Vector3): THREE.Vector3 {
    out.copy(this.exhaustTip);
    return this.body.localToWorld(out);
  }

  protected engineWorld(out: THREE.Vector3): THREE.Vector3 {
    out.copy(this.engineTip);
    return this.body.localToWorld(out);
  }

  /** Center of a ball of radius r sitting on the blade, with the truck facing `vh`, pushed `extra` m forward. */
  protected ballCenter(out: THREE.Vector3, r: number, vh: number, extra: number): THREE.Vector3 {
    const s = Math.sin(vh);
    const c = Math.cos(vh);
    const d = TIP_Z + this.body.position.z + r + extra;
    out.set(this.position.x + s * d, 0, this.position.z + c * d);
    const t = this.ctx.terrain;
    if (this.vert.airborne || (this.puppetY !== null && this.puppetAir)) out.y = this.position.y + r * 0.95;
    else if (!t.active) out.y = this.ctx.snow.getDepth(out.x, out.z) + r;
    else {
      t.surfaceAt(out.x, out.z, this.position.y, _ballSurf);
      out.y = _ballSurf.y + (_ballSurf.deck < 0 ? this.ctx.snow.getDepth(out.x, out.z) : 0) + r;
    }
    return out;
  }

  private spawnStreak(): void {
    let st: Streak | null = null;
    for (const x of this.streaks) {
      if (!x.active) {
        st = x;
        break;
      }
    }
    if (!st) return;
    const side = Math.random() < 0.5 ? -1 : 1;
    const lat = side * (1.3 + Math.random() * 2.2);
    const lon = -1 + Math.random() * 5;
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    st.active = true;
    st.age = 0;
    st.h = this.heading;
    st.len = 2.5 + Math.random() * 3.5;
    st.x = this.position.x + s * lon + c * lat;
    st.z = this.position.z + c * lon - s * lat;
    st.y = this.vert.surfaceY + 0.3 + Math.random() * 2.4;
  }

  protected updateStreaks(dt: number): void {
    const mesh = this.streakMesh;
    let any = false;
    for (let i = 0; i < MAX_STREAKS; i++) {
      const st = this.streaks[i];
      if (!st.active) {
        if (dt === 0) {
          _m.makeScale(0, 0, 0);
          mesh.setMatrixAt(i, _m);
          any = true;
        }
        continue;
      }
      st.age += dt;
      const t = st.age / STREAK_LIFE;
      any = true;
      if (t >= 1) {
        st.active = false;
        _m.makeScale(0, 0, 0);
        mesh.setMatrixAt(i, _m);
        continue;
      }
      _q.setFromAxisAngle(_up, st.h);
      _a.set(st.x, st.y, st.z);
      _s.set(1, 1, st.len * (1 + t * 0.6));
      _m.compose(_a, _q, _s);
      mesh.setMatrixAt(i, _m);
      const f = (1 - t) * 0.9;
      mesh.setColorAt(i, _col.setRGB(f * 0.85, f * 0.93, f));
    }
    if (any) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  protected updateTornado(dt: number): void {
    const whirling = this.whirlT >= 0 && !this._dead;
    const target = whirling ? (this.whirlT > WHIRL_SECONDS - 0.15 ? 0.6 : 1) : 0;
    this.tornadoA += (target - this.tornadoA) * Math.min(1, dt * (whirling ? 14 : 6));
    this.ringPulse = Math.max(0, this.ringPulse - dt * 5);
    if (this.tornadoA < 0.01 && this.ringPulse <= 0) {
      this.tornadoA = 0;
      this.tornado.visible = false;
      this.whirlRing.visible = false;
      return;
    }
    const R = this.tornadoR;
    const a = this.tornadoA;
    const p = this.position;
    this.tornado.visible = true;
    this.tornado.position.set(p.x, this.vert.surfaceY, p.z);
    const h = 3.2 + R * 0.25;
    const swell = 0.85 + 0.15 * a + 0.05 * this.ringPulse;
    this.tornadoOuter.scale.set(R * swell, h, R * swell);
    this.tornadoInner.scale.set(R * 0.62 * swell, h * 0.8, R * 0.62 * swell);
    this.tornadoOuter.rotation.y -= dt * 9;
    this.tornadoInner.rotation.y -= dt * 14;
    const mo = this.tornadoMatO.map!;
    const mi = this.tornadoMatI.map!;
    mo.offset.x = (mo.offset.x + dt * 0.9) % 1;
    mo.offset.y = (mo.offset.y - dt * 0.6) % 1;
    mi.offset.x = (mi.offset.x - dt * 1.3) % 1;
    mi.offset.y = (mi.offset.y - dt * 0.9) % 1;
    this.tornadoMatO.opacity = a * (0.75 + 0.25 * this.ringPulse);
    this.tornadoMatI.opacity = a * 0.55;
    this.whirlRing.visible = true;
    this.whirlRing.position.set(p.x, this.vert.surfaceY + (this.ctx.snow && this.vert.deck < 0 ? this.ctx.snow.getDepth(p.x, p.z) + 0.08 : 0.08), p.z);
    this.whirlRing.scale.setScalar(R * (1 + 0.06 * this.ringPulse));
    this.whirlRingMat.opacity = Math.min(1, a * 0.4 + this.ringPulse * 0.5);
  }

  private spawnGhost(): void {
    let g = this.ghosts.find((x) => !x.active);
    if (!g) {
      g = this.ghosts[0];
      for (const x of this.ghosts) if (x.age > g.age) g = x;
    }
    g.active = true;
    g.age = 0;
    g.group.visible = true;
    g.group.position.copy(this.position);
    g.group.rotation.set(0, this.heading + this.spinAngle, 0);
    g.blade.visible = !this.vehicle;
    if (this.kind === 'volt') g.mat.color.setHSL(0.54 + Math.random() * 0.03, 1, 0.6);
    else if (this.kind === 'brute') g.mat.color.setHSL(0.13 + Math.random() * 0.02, 1, 0.5);
    else if (this.kind === 'isotope') g.mat.color.setHSL(0.3 + Math.random() * 0.03, 1, 0.55);
    else g.mat.color.setHSL(0.07 + Math.random() * 0.03, 1, 0.55);
  }

  /** Classic STREAK on the hull (plow/streakFx.ts): afterimages, outline and underglow from Combat's stacks (-1 on
   *  the other plows and in the Duel). Runs dead or alive, so the ghosts already out fade on. */
  protected updateStreakVisuals(dt: number): void {
    const k = this.kind === 'classic' && !this._dead ? (this.b.combat?.streak ?? -1) : -1;
    if (k > 0 && this.streakSilDirty) {
      this.streakSilDirty = false;
      this.streakFx.setSilhouette(this.streakSilhouette());
    }
    const x = this.position.x;
    const z = this.position.z;
    // The underglow ring sits on the highest snow round it (the hull stands in its own plowed trough: at the hull's
    // height the snow banks around would bury the ring).
    let ground = 0;
    if (k > 0) {
      ground = floorTop(this.ctx.terrain, this.b.snow, this.vert.y, x, z);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ground = Math.max(ground, floorTop(this.ctx.terrain, this.b.snow, this.vert.y, x + Math.sin(a) * STREAK_GLOW_R, z + Math.cos(a) * STREAK_GLOW_R));
      }
    }
    this.streakFx.update(dt, k, this.b.combat?.streakLeft ?? 0, this.speed, x, ground, z);
  }

  protected updateGhosts(dt: number): void {
    for (const g of this.ghosts) {
      if (!g.active) continue;
      g.age += dt;
      const t = g.age / 0.28;
      if (t >= 1) {
        g.active = false;
        g.group.visible = false;
        continue;
      }
      g.mat.opacity = 0.32 * (1 - t);
      g.group.scale.set(1 + t * 0.08, 1 + t * 0.04, 1 + t * 0.12);
    }
  }

  protected updateVisuals(dt: number, turn: number, throttle: number): void {
    const ctx = this.ctx;
    const stats = this.b.stats;
    const snow = this.b.snow;
    const absS = Math.abs(this.speed);
    this.spin.rotation.y = this.spinAngle;
    this.spin.position.y = this.hop;

    // Ride height: sink a little into the snow, bob more in deep snow (ground only: decks carry no snow).
    const depth = this.vert.deck < 0 ? snow.getDepth(this.position.x, this.position.z) : 0;
    this.bobT += dt * (3 + absS * 1.4);
    const bob = Math.sin(this.bobT) * (0.015 + Math.min(0.05, depth * 0.08)) * Math.min(1, absS / 3 + 0.25);
    const targetY = Math.min(0.25, depth * 0.3);
    this.ride += (targetY - this.ride) * Math.min(1, dt * 6);
    const v = this.vert;
    const terr = ctx.terrain;
    if (this.puppetY !== null) {
      // Duel opponent: the host's height when there is terrain or a flight to show, else the local ride (as always).
      if (terr.active || this.puppetAir) this.position.y = this.puppetY;
      else this.position.y = this.ride;
      if (terr.active) terr.surfaceAt(this.position.x, this.position.z, this.position.y, this.surf);
      v.surfaceY = terr.active ? this.surf.y : 0;
    } else if (!v.airborne) this.position.y = v.y = v.surfaceY + this.ride;

    // Terrain tilt: the hull pitches / rolls to the surface (smoothed); in the air it noses along the flight path.
    let wantP = 0;
    let wantR = 0;
    const flying = this.puppetY !== null ? this.puppetAir : v.airborne;
    if (flying) {
      const fvy = this.puppetY !== null ? this.puppetVy : v.vy;
      wantP = THREE.MathUtils.clamp(-Math.atan2(fvy, Math.max(4, absS)) * 0.6, -0.45, 0.45);
      wantR = this.tiltR * 0.5;
    } else if (terr.active) {
      const sh = Math.sin(this.heading);
      const ch = Math.cos(this.heading);
      const sf = this.surf;
      wantP = -Math.atan(sf.gx * sh + sf.gz * ch);
      wantR = Math.atan(sf.gx * ch - sf.gz * sh);
    }
    if (wantP !== 0 || wantR !== 0 || this.tiltP !== 0 || this.tiltR !== 0) {
      const tk = Math.min(1, dt * (flying ? 4 : 12));
      this.tiltP += (wantP - this.tiltP) * tk;
      this.tiltR += (wantR - this.tiltR) * tk;
      if (Math.abs(this.tiltP) < 1e-5 && wantP === 0) this.tiltP = 0;
      if (Math.abs(this.tiltR) < 1e-5 && wantR === 0) this.tiltR = 0;
    }
    this.object.rotation.set(this.tiltP, this.heading, this.tiltR);
    this.squash = Math.max(0, this.squash - dt * 5);

    // Lean into turns, pitch with acceleration, slam rear-back / lunge, recoil kick.
    const lean = THREE.MathUtils.clamp(turn * Math.min(1, absS / 6) * 0.07, -0.12, 0.12);
    this.roll += (-lean - this.roll) * Math.min(1, dt * 6);
    const acc = (this.speed - this.lastSpeed) / Math.max(dt, 1e-4);
    this.lastSpeed = this.speed;
    const targetPitch = THREE.MathUtils.clamp(-acc * 0.004, -0.06, 0.06);
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 5);
    const poseTarget = this.slamPhase === 1 ? -1 : this.slamPhase === 2 && this.slamT < SLAM_LUNGE * 0.7 ? 1 : 0;
    this.slamPose += (poseTarget - this.slamPose) * Math.min(1, dt * (poseTarget === 0 ? 12 : 35));
    const sp = this.slamPose;
    const poseP = sp < 0 ? 0.12 * sp : 0.07 * sp;
    const poseZ = sp < 0 ? 0.4 * sp : 0.35 * sp;
    this.kick = Math.max(0, this.kick - dt * 4);
    const kickP = Math.sin(this.kick * Math.PI) * 0.08 * this.kick;
    this.jitter = Math.max(0, this.jitter - dt);
    const j = this.jitter > 0 ? this.jitter / 0.2 : 0;
    const jx = j > 0 ? (Math.random() - 0.5) * 0.14 * j : 0;
    const jz = j > 0 ? (Math.random() - 0.5) * 0.14 * j : 0;
    this.body.rotation.set(this.pitch + poseP - kickP, 0, this.roll + jx * 0.4);
    this.body.position.set(jx, bob + (this.whirlT >= 0 ? 0.08 : 0) - this.squash * 0.18, poseZ - kickP * 1.5 + jz);
    // The blade rams punch out with the slam lunge (the held ball rides 0.15 m further out too; see ballCenter).
    this.bladeGroup.position.z = BLADE_Z - 0.1 + (sp > 0 ? 0.15 * sp : 0);

    // Buzzsaws: always spinning, screaming faster with speed and fury; the halos grow with the spin.
    const sawsOn = this.kind === 'brute' && stats.sawDps > 0;
    this.sawFury = sawsOn ? Math.max(0, this.sawFury - dt * SAW_FURY_DRAIN) : 0;
    const sawSpin = (SAW_SPIN_BASE + absS * 1.5) * (1 + SAW_FURY_SPIN * this.sawFury);
    const haloTarget = sawsOn && !this._dead ? THREE.MathUtils.clamp((sawSpin - SAW_SPIN_BASE) / SAW_SPIN_FULL, 0, 1) : 0;
    this._sawHalo += (haloTarget - this._sawHalo) * Math.min(1, dt * 6);
    const h = this._sawHalo;
    for (let i = 0; i < this.saws.length; i++) {
      const saw = this.saws[i];
      saw.group.visible = sawsOn;
      if (!sawsOn) continue;
      saw.rotor.rotation.y += dt * sawSpin;
      const flicker = 1 + Math.sin(this.bobT * 7 + i * 2) * 0.03 * h;
      saw.halo.scale.setScalar(SAW_R * (1.3 + 1.9 * h) * flicker);
      saw.halo.material.opacity = 0.55 + 0.45 * h;
      saw.halo.material.color.copy(_haloCool).lerp(_haloHot, this.sawFury);
    }

    // Wheels.
    const spin = ((this.speed + this.lungeVel) * dt) / WHEEL_R;
    const st = this.b.input.steer * 0.35;
    if (spin !== 0 || st !== this.wheelSteer[0] || st !== this.wheelSteer[1]) {
      for (let i = 0; i < 4; i++) this.wheelSpin[i] += spin;
      this.wheelSteer[0] = this.wheelSteer[1] = st;
      this.writeWheels();
    }
    // BRUTUS: cleats crawl round the track loops (bottom run stays put on the ground, top run moves forward).
    if (this.kind === 'brute') {
      this.trackPhase += (this.speed + this.lungeVel) * dt;
      this.setCleats(this.trackPhase);
    }

    // Beacon.
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 9);
    const lowHp = this.hp < this.maxHp * 0.3;
    const pf = lowHp ? 0.5 + 0.5 * Math.sin(this.time * 22) : pulse;
    this.beaconMat.emissiveIntensity = 0.6 + pf * 2.2;
    this.beaconLight.intensity = 2 + pf * 8;
    this.beaconLight.color.setHex(lowHp ? 0xff3020 : this.kind === 'volt' ? 0x4fc8ff : this.kind === 'isotope' ? 0x5dff3a : this.kind === 'arsenal' ? 0x38e8ff : 0xffa020);
    // ISOTOPE: the reactor core breathes; it flickers hot while Meltdown recharges.
    if (this.kind === 'arsenal') {
      // Turret swings toward Combat's target (relative yaw, wrapped), sensor glow breathes.
      let d = this.turretAim - this.turretYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.turretYaw += d * Math.min(1, dt * 12);
      this.turret.rotation.y = this.turretYaw;
      // Pulse laser: the coils and fins spin up while firing, wind down slowly after.
      const want = this.gunFiring ? 16 : 0;
      this.minigunSpin += (want - this.minigunSpin) * Math.min(1, dt * (this.gunFiring ? 8 : 1.6));
      this.minigun.rotation.z += this.minigunSpin * dt;
      // Barrels tilt to the aim (eased: the kit already slews it; this smooths snapshot steps in a duel).
      this.gunTilt += (this.gunPitch - this.gunTilt) * Math.min(1, dt * 14);
      this.gunMount.rotation.x = -this.gunTilt;
      this.armGlowMat.emissiveIntensity = 1.1 + 0.4 * Math.sin(this.ctx.time * 5) + this.gyroCharge * 1.5;
      // Gyro core, front wheels, hover bob. The rings snap flat fast and unfold a little slower.
      this.gyroFlatEase += (this.gyroFlat - this.gyroFlatEase) * Math.min(1, dt * (this.gyroFlat > this.gyroFlatEase ? 14 : 4));
      this.arsRig.update(dt, { speed: this.speed, firing: this.gunFiring, flat: this.gyroFlatEase, charge: this.gyroCharge });
    }
    if (this.kind === 'isotope') {
      const ready = this.b.combat?.flameReady ?? 1;
      const flick = ready < 1 ? 0.5 + 0.5 * Math.sin(this.time * 25) : 0.5 + 0.5 * Math.sin(this.time * 3);
      this.coreMat.emissiveIntensity = 1.1 + flick * (ready < 1 ? 0.3 : 0.9);
      this.beaconLight.intensity = 2.5 + flick * 3;
    }
    if (this.kind === 'volt') {
      this.beaconLight.intensity = 3 + pf * 3;
      this.underglowMat.opacity = 0.28 + 0.12 * Math.sin(this.time * 6) + (this.dashT > 0 ? 0.3 : 0);
      this.voltRig.update(dt, { arc: this.voltArc, field: this.voltField });
    }
    // VOLT-9: pulsing coils + arcs jumping between them.
    if (this.kind === 'volt') {
      this.coilMat.emissiveIntensity = 1.2 + 0.8 * Math.sin(this.time * 14) * Math.sin(this.time * 5.3);
      this.arcT -= dt;
      if (this.arcT <= 0 && this.coilTops.length === 2) {
        this.arcT = 0.15 + Math.random() * 0.35;
        const a = this.coilTops[0].getWorldPosition(_a);
        const b = this.coilTops[1].getWorldPosition(_b);
        this.b.combat?.lightning.bolt(a, b, { life: 0.12, width: 0.1, jag: 0.25 });
      }
    }
    this.beaconSpinner.rotation.y += dt * (lowHp ? 16 : 9);
    // Classic: spreader disc, hopper gauge (held snow), Inferno burners + fuel cell glow.
    if (this.kind === 'classic') {
      const maxR = this.b.stats.maxBallRadius;
      this.classicRig.update(dt, { speed: this.speed, fill: maxR > 0 ? this.ballR / maxR : 0, flame: this.b.combat?.flameReady ?? -1 });
    }

    // Damage flash.
    this.flash = Math.max(0, this.flash - dt * 4);
    const fl = this.flash * 1.4;
    // Lava burn: a hot red glow pulsing on the paint while it cooks.
    const burnGlow = this.burn > 0 ? this.burn * (0.45 + 0.25 * Math.sin(this.time * 18)) : 0;
    this.paintMat.emissiveIntensity = Math.max(fl, burnGlow);
    this.bedMat.emissiveIntensity = Math.max(fl, burnGlow);
    this.bladeSkinMat.emissiveIntensity = fl;

    // Dash flame + afterimages / exhaust puffs.
    const dashing = this.dashT > 0;
    this.flame.visible = dashing;
    if (dashing) {
      const s = 1.6 + Math.random() * 1.2;
      this.flame.scale.set(1.6, s, 1.6);
      // Flicker; a booster item's tint (gear) replaces the plow's own hue.
      const tint = this.gearVis.flame;
      if (tint !== null) this.flameMat.color.setHex(tint).multiplyScalar(0.85 + Math.random() * 0.3);
      else this.flameMat.color.setHSL(this.kind === 'volt' ? 0.53 + Math.random() * 0.04 : 0.06 + Math.random() * 0.05, 1, this.kind === 'volt' ? 0.65 : 0.55);
      this.ghostT -= dt;
      if (this.ghostT <= 0) {
        this.ghostT = 0.05;
        this.spawnGhost();
      }
    }
    if (dashing || this.dashEase > 0) {
      this.streakT -= dt;
      while (this.streakT <= 0) {
        this.streakT += dashing ? 0.012 : 0.04;
        this.spawnStreak();
      }
    }
    this.puffT -= dt;
    if (this.puffT <= 0) {
      this.puffT = dashing ? 0.035 : throttle !== 0 ? 0.18 : 0.45;
      if (this.kind === 'classic') this.exhaustTip.x = -this.exhaustTip.x; // twin stacks take turns
      this.exhaustWorld(_c);
      // VOLT-9 is electric: cyan sparks instead of diesel smoke. BRUTUS belches thick black smoke.
      if (this.kind === 'volt') {
        if (dashing || throttle !== 0) ctx.fx.burst(_c, { color: 0x7fdcff, count: dashing ? 3 : 1, speed: dashing ? 2.5 : 1, size: 0.1, gravity: 2, life: 0.3 });
      } else {
        const brute = this.kind === 'brute';
        ctx.fx.burst(_c, dashing
          ? DASH_EXHAUST_BURST
          : { color: brute ? 0x3a3b40 : 0x9aa0aa, count: 1, speed: 0.6, size: (brute ? 0.4 : 0.25) + 0.1 * Math.abs(throttle), gravity: -2, life: brute ? 1.1 : 0.8 });
      }
      if (lowHp && !dashing) ctx.fx.burst(this.engineWorld(_c), LOW_HP_SMOKE_BURST);
    }

    // Held ball (weapon + shield).
    const target = this.heldBallRadius;
    this.ballR += (target - this.ballR) * Math.min(1, dt * 10);
    if (target === 0 && this.ballR < 0.15) this.ballR = 0;
    if (this.ballR >= 0.15) {
      this.ball.visible = true;
      const pr = this.ballR;
      const prevX = this.ball.position.x;
      const prevZ = this.ball.position.z;
      const extra = sp > 0 ? 0.15 * sp : 0;
      this.ballCenter(_c, pr, this.heading + this.spinAngle, extra);
      if (this.ballWasVisible) {
        const dx = _c.x - prevX;
        const dz = _c.z - prevZ;
        const dist = Math.hypot(dx, dz);
        if (dist > 1e-5 && dist < 3) {
          _dir.set(dz, 0, -dx).normalize(); // up x travelDir
          _q.setFromAxisAngle(_dir, dist / pr);
          this.ball.quaternion.premultiply(_q);
        }
      }
      this.ball.position.copy(_c);
      this.ballWasVisible = true;

      const full = target >= stats.maxBallRadius * 0.995;
      if (full) {
        const p = 0.5 + 0.5 * Math.sin(this.time * 7);
        this.ball.scale.setScalar(pr * (1 + 0.035 * p));
        this.glow.visible = true;
        this.glowMat.opacity = 0.3 + 0.45 * p;
        this.glow.position.set(_c.x, _c.y - pr + 0.06, _c.z);
        this.glow.scale.setScalar(pr * (1 + 0.08 * p));
      } else {
        this.ball.scale.setScalar(pr);
        this.glow.visible = false;
      }
    } else {
      this.ball.visible = false;
      this.glow.visible = false;
      this.ballWasVisible = false;
    }
  }
}
