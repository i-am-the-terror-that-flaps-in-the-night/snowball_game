import * as THREE from 'three';
import { DAY_MOODS, NEUTRAL_GRADE, NIGHT_GRADE, moodKey, type Grade } from '../config/arenaLooks';
import { GRADE } from '../render/post';
import type { Obstacle, WorldAPI, ZoneDef } from '../core/types';
import { ARENA } from '../core/types';
import { StaticBatch } from '../render/mergeStatic';
import { makeShadowProxy } from '../render/shadowProxy';
import type { ShadowProxy } from '../render/shadowProxy';
import { GLINTS, scaleWeatherLayers, weatherLayers, type WeatherLayerDef } from './biomes/Weather';
import { currentPreset } from '../core/settings';
import { GroundDecals, lavaTime } from './biomes/GroundDecals';
import { OmegaWorks } from './omega/OmegaWorks';
import { OmegaSet } from './omega/OmegaSet';
import { PUFF_CAM_CLEAR, STYLES, BIOME_SKY } from './environment/styles';
import { TOWER_OFF, DOME_TOWER_OFF, DOME_TOWER_H, STAGE_HALF, brawlMode, domeK, setBrawlMode, mulberry32 } from './environment/layout';
import { PROTOCOL_STAGE_HALF } from './environment/ProtocolScenery';
import { chevronTex } from './environment/textures';
import { NightScenery } from './environment/NightScenery';
import { GlowPoints, NIGHT_BOOST, NIGHT_CROWD_LIFT, NIGHT_SPOT_BOOST, NIGHT_SPOT_BOOST_BIG, nightLook, nightZone } from './environment/night';
import { isNight } from '../core/timeOfDay';
import { propSkinKey } from './propSkins';
import { look as artLook, strength as lookStrength } from '../render/look';
import { buildArenaEnv, installSpecularGain, type EnvLamp } from '../render/arenaEnv';
import { ContactShadows } from '../render/contactShadows';

/** The old fixed sun (45, 80, 55): ~48 deg up, from +x +z; arenas without a mood keep it. */
const DEFAULT_SUN_ELEV = (Math.atan2(80, Math.hypot(45, 55)) * 180) / Math.PI;
const DEFAULT_SUN_AZIM = (Math.atan2(45, 55) * 180) / Math.PI;
const _up = new THREE.Vector3(0, 1, 0);

/** Survival's Blizzard wave (setStorm): fog pulled in to this (or the zone's own, if nearer), tinted toward white. */
const STORM_FOG_NEAR = 12;
const STORM_FOG_FAR = 58;
const STORM_WHITE = new THREE.Color(0xeef4f8);
/** The night gale's tint: a floodlit grey-blue whiteout, not a white sky in the dark. */
const STORM_NIGHT = new THREE.Color(0x5c6c80);
/** Share of the way the fog / horizon colour goes toward STORM_WHITE. */
const STORM_TINT = 0.6;
/** The gale laid over the zone's own weather: dense, fast, wind-driven flakes (the Blizzard Bowl's look, thicker). */
const STORM_GALE: WeatherLayerDef = { count: 7000, colors: [0xffffff], size: 0.17, fall: 5, wind: [17, 6], sway: 1.6, opacity: 0.95 };

/** PROTOCOL C finale (whiteoutSky): the sky goes black, the fog a dark storm blue pulled in to these (m), the
 *  ambient dimmed to this share; the Blizzard gale on top. */
const WO_SKY = new THREE.Color(0x020306);
const WO_HORIZON = new THREE.Color(0x0d1626);
const WO_FOG = new THREE.Color(0x121c2c);
const WO_FOG_NEAR = 26;
const WO_FOG_FAR = 125;
const WO_AMBIENT = 0.7;
/** ... and the floodlights to this share (a darker, moodier floor; telegraph decals are unlit and keep their colour). */
const WO_FLOODS = 0.62;
const _wc = new THREE.Color();

export class Environment extends NightScenery implements WorldAPI {
  /** Survival Blizzard gale on (setStorm); setZone clears it. */
  private storm = false;
  /** The zone's light / sky / fog fields as built (the night look at night). */
  private look: ZoneDef | null = null;
  /** Decks of a non-Omega arena (PROTOCOL C waves 6-7), drawn with the Omega Works' deck builder in gold. */
  private deckWorks: OmegaWorks | null = null;
  /** Share of the zone's ambient the hemisphere light keeps (the rest is in the arena environment map, see
   *  buildEnvMap); 1 without the arena reflections. */
  private ambientKeep = 1;
  /** Soft contact patches under plows and bots (render/look.ts contact; built at the first arena build that wants it). */
  private contact: ContactShadows | null = null;

  get obstacles(): readonly Obstacle[] {
    return this.obstacleList;
  }

  resetProps(on: boolean, coins: boolean): void {
    this.props.reset(this.obstacleList, on, 777 + this.zone.index * 131, this.zone.theme === 'brawl', coins, propSkinKey(this.zone.biome?.key, this.zone.theme));
  }

  blastProps(x: number, z: number, r: number): number {
    return this.props.blast(x, z, r);
  }

  blastPropRay(x: number, z: number, dx: number, dz: number, range: number): number {
    return this.props.blastRay(x, z, dx, dz, range);
  }

  breakObstacle(o: Obstacle, coins = true): boolean {
    return this.props.breakObstacle(o, coins);
  }

  /* ------------------------------------------------------------------ zone */

  /** Point the sun (and its shadow camera frame) from elevation / azimuth in degrees (arenaLooks.ts). */
  private setSunDir(elevDeg: number, azimDeg: number): void {
    const e = (elevDeg * Math.PI) / 180;
    const a = (azimDeg * Math.PI) / 180;
    this.sunOffset.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).multiplyScalar(100);
    this.sunD.copy(this.sunOffset).normalize();
    this.sunR.crossVectors(_up, this.sunD).normalize();
    this.sunU.crossVectors(this.sunD, this.sunR).normalize();
  }

  /** Push an arena grade to the output pass (render/post.ts GRADE). */
  private applyGrade(g: Grade): void {
    GRADE.uContrast.value = g.contrast;
    GRADE.uSaturation.value = g.saturation;
    GRADE.uShadowTint.value.set(...g.shadow);
    GRADE.uHighTint.value.set(...g.highlight);
    GRADE.uVignette.value = g.vignette;
  }

  setZone(zone: ZoneDef): void {
    this.zone = zone;
    this.storm = false;
    // Snowdome mode + scale first: the floodlight aims below read them (buildDecor sets them again).
    setBrawlMode(zone.theme === 'brawl');
    this.ctx.terrain.load(zone.terrain ?? {});
    this.biome = zone.biome?.key ?? null;
    const base = (this.biome && STYLES[this.biome]) || STYLES[zone.theme] || STYLES.meadow;
    // Brawl biome venues keep the dome's huge floodlights
    this.style = zone.theme === 'brawl' ? { ...base, spot: STYLES.brawl.spot, glow: STYLES.brawl.glow } : base;
    // Time of day (core/timeOfDay.ts): at night the same zone is relit (night.ts) and dressed with the stadium extras.
    this.night = isNight();
    this.nightDef = this.night ? nightLook(zone) : null;
    const look0 = this.night ? nightZone(zone) : zone;
    // Visual identity (config/arenaLooks.ts): by day each arena gets its mood: a low sun with long shadows, a warm key
    // against a cool sky fill, haze and a colour grade. At night only the grade (night.ts relights the arena).
    const mood = this.night ? null : (DAY_MOODS[moodKey(this.biome, zone.theme)] ?? null);
    const look = mood
      ? { ...look0, sunColor: mood.sunColor, sunIntensity: mood.sunIntensity, ambientColor: mood.sky, ambientIntensity: mood.ambient, fogColor: mood.fogColor }
      : look0;
    this.look = look;
    this.applyGrade(this.night ? NIGHT_GRADE : (mood?.grade ?? NEUTRAL_GRADE));
    this.setSunDir(mood ? mood.sunElev : DEFAULT_SUN_ELEV, mood ? mood.sunAzim : DEFAULT_SUN_AZIM);
    this.crowdLift.value = this.night ? NIGHT_CROWD_LIFT : 0;
    this.lightGain = this.night ? NIGHT_BOOST : 1;
    const bs = this.nightDef?.sky ?? ((this.biome && BIOME_SKY[this.biome]) || {});
    const scene = this.ctx.scene;
    this.fog.color.setHex(look.fogColor);
    this.fog.near = mood ? mood.fogNear : zone.fogNear;
    this.fog.far = mood ? mood.fogFar : zone.fogFar;
    (scene.background as THREE.Color).setHex(look.fogColor);

    this.skyMat.uniforms.top.value.setHex(look.skyTop);
    this.skyMat.uniforms.bottom.value.setHex(look.skyBottom);
    this.skyMat.uniforms.horizon.value.setHex(look.fogColor);
    const su = this.skyMat.uniforms;
    su.uSplit.value = bs.split ? 1 : 0;
    if (bs.split) {
      su.topB.value.setHex(bs.split.top);
      su.bottomB.value.setHex(bs.split.bottom);
      su.horizonB.value.setHex(bs.split.horizon);
    }
    su.uAurora.value = bs.aurora ?? 0;
    su.uStars.value = bs.stars ?? 0;
    su.uSmoke.value = bs.smoke ?? 0;
    su.uSunSize.value = bs.sun?.size ?? 0;
    if (bs.sun) {
      (su.uSunDir.value as THREE.Vector3).set(...bs.sun.dir).normalize();
      su.uSunColor.value.setHex(bs.sun.color);
    }
    if (mood) {
      // the sky's sun disc sits where the light comes from
      (su.uSunDir.value as THREE.Vector3).copy(this.sunD);
      su.uSunColor.value.setHex(mood.sunColor);
      su.uSunSize.value = Math.max(su.uSunSize.value, 0.04);
    }

    this.hemi.color.setHex(look.ambientColor);
    this.hemi.groundColor.setHex(look.snowTint).lerp(new THREE.Color(look.ambientColor), this.night ? 0.75 : 0.3);
    if (bs.bounce !== undefined) this.hemi.groundColor.setHex(bs.bounce);
    if (mood) this.hemi.groundColor.setHex(mood.bounce);
    this.auroraBase = bs.aurora ? new THREE.Color(look.ambientColor) : null;
    this.hemi.intensity = look.ambientIntensity;
    this.sun.color.setHex(look.sunColor);
    this.sun.intensity = look.sunIntensity;
    const brawl = zone.theme === 'brawl';
    this.syncShadowMapSize();
    for (let i = 0; i < this.spots.length; i++) {
      const s = this.spots[i];
      const sx = i === 0 ? -1 : 1;
      s.color.setHex(bs.spots ? bs.spots[i] : (this.nightDef?.flood ?? this.style.lamp));
      s.intensity = this.style.spot * (this.night ? (this.style.spot > 2000 ? NIGHT_SPOT_BOOST_BIG : NIGHT_SPOT_BOOST) : 1);
      if (brawl) {
        const c = ARENA.maxX + DOME_TOWER_OFF;
        s.position.set(sx * c, DOME_TOWER_H, ARENA.minZ - DOME_TOWER_OFF);
        s.target.position.set(-sx * 20 * domeK, 0, 20 * domeK);
        s.angle = Math.PI / 4.5;
      } else {
        const c = ARENA.maxX + TOWER_OFF;
        s.position.set(sx * c, 16.5, ARENA.minZ - TOWER_OFF);
        s.target.position.set(-sx * 6, 0, 6);
        s.angle = Math.PI / 4.2;
      }
      // The Thermal Divide: each tower floods its own half (hot west, cold east)
      if (bs.splitSpots) s.target.position.set(sx * (brawl ? 40 * domeK : 14), 0, brawl ? 10 * domeK : 4);
    }

    this.buildDecor(zone);
    this.buildWeather(zone);
    this.buildEnvMap(look);
    if (artLook.contact && !this.contact) this.contact = new ContactShadows(this.ctx);
    this.ctx.audio?.setAmbience(zone.biome?.ambience ?? (brawl || zone.theme === 'blizzard' ? 'wind' : zone.theme === 'protocol' ? 'crowd' : 'none'));
  }

  /** Art pass (render/look.ts env): the arena's environment map (render/arenaEnv.ts) from this look's lights, sky and
   *  palette, set as scene.environment; the hemisphere light hands its share of the ambient over to it and the sun
   *  takes the strength's trim. Built after the decor (the night lamp banks are known then) and before the arena's
   *  shader warm-up (Game runs it after setZone). Off: no environment, the lights exactly as set above. */
  private buildEnvMap(look: ZoneDef): void {
    const scene = this.ctx.scene;
    if (!artLook.env) {
      scene.environment = null;
      this.ambientKeep = 1;
      return;
    }
    const k = lookStrength();
    installSpecularGain(k.specular);
    const C = (hex: number) => new THREE.Color(hex);
    const lamps: EnvLamp[] = [];
    const centre = new THREE.Vector3(0, 3, 0);
    const lampColor = (i: number) => this.spots[i].color.clone();
    for (let i = 0; i < this.spots.length; i++) {
      lamps.push({ dir: this.spots[i].position.clone().sub(centre), color: lampColor(i), size: 0.07, power: this.night ? 1 : 0.4 });
    }
    if (this.night && this.floodHeads.length) {
      // a spread of the lamp banks (every n-th head)
      const n = Math.min(6, this.floodHeads.length);
      const step = this.floodHeads.length / n;
      const flood = C(this.nightDef?.flood ?? this.style.lamp);
      for (let i = 0; i < n; i++) {
        const h = this.floodHeads[Math.floor(i * step)];
        lamps.push({ dir: new THREE.Vector3(h.x, h.y, h.z).sub(centre), color: flood, size: 0.045, power: 0.75 });
      }
    }
    const sun = this.sun.color.clone().multiplyScalar(look.sunIntensity);
    const band = this.night ? 0.3 : (look.sunIntensity * 0.45 + look.ambientIntensity) / Math.PI;
    const tex = buildArenaEnv(this.ctx.renderer, {
      hemiSky: this.hemi.color, hemiGround: this.hemi.groundColor, hemiIntensity: look.ambientIntensity,
      share: k.envShare, detail: k.detail,
      skyTop: C(look.skyTop), skyBottom: C(look.skyBottom), horizon: C(look.fogColor),
      accents: this.style.accents.map(C), band,
      sunDir: this.sunD, sun, lamps,
    });
    scene.environment = tex;
    scene.environmentIntensity = 1;
    this.ambientKeep = 1 - k.envShare;
    this.hemi.intensity = look.ambientIntensity * this.ambientKeep;
    this.sun.intensity = look.sunIntensity * k.sun;
  }

  syncTimeOfDay(): void {
    if (this.look && isNight() !== this.night) this.setZone(this.zone);
  }

  /** Survival's Blizzard wave modifier: a whiteout gale over the current zone (fog pulled in and whitened, a dense
   *  wind-driven snow layer on top of the zone's own weather), or back to the zone's own look. No re-dress: only the
   *  fog, the sky horizon and the weather particles change. */
  setStorm(on: boolean): void {
    if (!this.zone || on === this.storm) return;
    this.storm = on;
    const z = this.zone;
    this.fog.near = on ? Math.min(z.fogNear, STORM_FOG_NEAR) : z.fogNear;
    this.fog.far = on ? Math.min(z.fogFar, STORM_FOG_FAR) : z.fogFar;
    this.fog.color.setHex((this.look ?? z).fogColor);
    if (on) this.fog.color.lerp(this.night ? STORM_NIGHT : STORM_WHITE, STORM_TINT);
    (this.ctx.scene.background as THREE.Color).copy(this.fog.color);
    this.skyMat.uniforms.horizon.value.copy(this.fog.color);
    this.buildWeather(z);
  }

  /** PROTOCOL C finale: THE WHITEOUT's storm over the arena, `k` 0 (the zone's own night) .. 1 (black sky, dark storm
   *  fog, the Blizzard gale on). Colours / fog only (plus the gale's weather layer when it turns on or off); `gale`
   *  (default: k > 0) = the gale's snow layer (off: the ending's calm, the zone's own gentle snowfall); setZone turns it
   *  all off. No-op off PROTOCOL C. */
  whiteoutSky(k: number, gale = k > 0): void {
    if (!this.zone || this.zone.theme !== 'protocol') return;
    const z = this.zone;
    const look = this.look ?? z;
    const u = Math.max(0, Math.min(1, k));
    if (gale !== this.storm) {
      this.storm = gale;
      this.buildWeather(z);
    }
    this.fog.color.setHex(look.fogColor).lerp(WO_FOG, u);
    this.fog.near = z.fogNear + (WO_FOG_NEAR - z.fogNear) * u;
    this.fog.far = z.fogFar + (WO_FOG_FAR - z.fogFar) * u;
    (this.ctx.scene.background as THREE.Color).copy(this.fog.color);
    const su = this.skyMat.uniforms;
    su.top.value.setHex(look.skyTop).lerp(WO_SKY, u);
    su.bottom.value.setHex(look.skyBottom).lerp(WO_SKY, u);
    su.horizon.value.copy(_wc.setHex(look.fogColor).lerp(WO_HORIZON, u));
    su.uStars.value = (this.nightDef?.sky?.stars ?? 0) * (1 - u);
    su.uSunSize.value = (this.nightDef?.sky?.sun?.size ?? 0) * Math.max(0, 1 - u * 2);
    this.hemi.intensity = look.ambientIntensity * this.ambientKeep * (1 - (1 - WO_AMBIENT) * u);
    const flood = this.style.spot * (this.night ? (this.style.spot > 2000 ? NIGHT_SPOT_BOOST_BIG : NIGHT_SPOT_BOOST) : 1) * (1 - (1 - WO_FLOODS) * u);
    for (const sp of this.spots) sp.intensity = flood;
    // the mountains vanish into the storm; the fascia under the boardroom is torn away with its roof
    if (this.mountains) this.mountains.visible = u < 0.5;
    this.tearFascia(u > 0);
  }

  /** PROTOCOL C finale (THE AVALANCHE): the floor's ice sheets go under the dumped snow (k 0..1); setZone restores. */
  whiteoutBury(k: number): void {
    this.decals?.bury(k);
  }

  /** Shadow map size from the quality preset. Brawl trades shadow sharpness for frame rate (HIGH: 1024 there,
   *  2048 elsewhere). */
  syncShadowMapSize(): void {
    if (!this.zone) return;
    const p = currentPreset();
    const mapSize = this.zone.theme === 'brawl' ? p.brawlShadowMapSize : p.shadowMapSize;
    if (this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      const sc = this.sun.shadow.camera;
      this.shadowTexel = (sc.right - sc.left) / mapSize;
    }
  }

  openGate(index: number): void {
    const g = this.gates[index];
    if (!g) return;
    const wasClosed = g.open < 0.35;
    g.openT = 2.0;
    g.flashT = 1.3;
    if (wasClosed || this.time - g.lastBurst > 0.8) {
      g.lastBurst = this.time;
      const fx = this.ctx.fx;
      if (fx) {
        fx.burst(this.tmpV.copy(g.mouth), { color: 0xffffff, count: 30, speed: 6, size: 0.35, gravity: 9, life: 0.9 });
        this.tmpV2.copy(g.mouth);
        this.tmpV2.y += 3;
        fx.burst(this.tmpV2, { color: this.style.gate, count: 12, speed: 4, size: 0.16, gravity: 4, life: 0.6 });
      }
    }
  }

  private disposeDecor(): void {
    this.deckWorks?.dispose();
    this.deckWorks = null;
    if (this.omega) {
      this.omega.works.dispose();
      this.omega.set.dispose();
      this.omega = null;
    }
    if (!this.decor) return;
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    this.decor.traverse((o) => {
      const m = o as THREE.Mesh;
      // Sprites share one module-level geometry inside three.js: never dispose it.
      if (m.geometry && !(o as THREE.Sprite).isSprite) geos.add(m.geometry);
      // Shadow proxies share global stand-in materials (render/shadowProxy.ts): only their geometry is ours.
      if ((o as ShadowProxy).isShadowProxy) return;
      if (m.material) {
        if (Array.isArray(m.material)) m.material.forEach((x) => mats.add(x));
        else mats.add(m.material);
      }
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
    this.zoneTex.forEach((t) => t.dispose());
    this.zoneTex.length = 0;
    this.ctx.scene.remove(this.decor);
    this.decor = null;
    this.pulses.length = 0;
    this.gates.length = 0;
    this.doors = null;
    this.spinners.length = 0;
    this.puffs = null;
    this.ticker = null;
    this.carpet = null;
    this.signMat = null;
    this.decals?.dispose();
    this.decals = null;
    this.ledTex = null;
  }

  /* ------------------------------------------------------------------ build */

  private buildDecor(zone: ZoneDef): void {
    this.disposeDecor();
    const group = new THREE.Group();
    group.name = 'ArenaDecor';
    this.decor = group;
    this.ctx.scene.add(group);
    this.rnd = mulberry32(1234 + zone.index * 101);
    // night-only decoration draws from its own stream (this.rnd stays identical day or night)
    this.nightRnd = mulberry32(9001 + zone.index * 37);
    this.floodHeads.length = 0;
    this.glowPts = this.night ? new GlowPoints() : null;
    this.batch = new StaticBatch();
    const G = zone.snowDepth;
    const snowMat = this.std(zone.snowTint, { roughness: 0.85 });
    // distant mountains are tinted toward the (night) fog / sky
    const mountainLook = this.look ?? zone;
    setBrawlMode(zone.theme === 'brawl');
    this.obstacleList = [];
    this.props.clear();

    if (zone.theme === 'omega') {
      // The Omega Works: its own walls, decks, hatches and skyline (no stands, gates or props).
      const works = new OmegaWorks(this.ctx.terrain);
      const set = new OmegaSet(this.ctx.terrain);
      this.omega = { works, set };
      this.ctx.scene.add(works.group, set.group);
      this.bobAmp.value = 0;
      this.buildMountains(mountainLook);
      // The spectator gallery over the walls stands day and night (floodlight banks and cones only at night).
      this.buildNightOmega();
      this.finishDecor();
      return;
    }

    if (brawlMode) {
      this.buildWalls(G, snowMat);
      this.buildSnowdome(zone, G);
      this.buildObstacles(G, snowMat);
      this.buildMountains(mountainLook);
      this.buildGroundDecals();
      if (this.night) this.buildNightDome(G);
      this.finishDecor();
      return;
    }

    const rally = this.isRally;
    const protocol = zone.theme === 'protocol';
    this.bobAmp.value = rally ? 0.42 : 0.2;
    this.buildWalls(G, snowMat);
    this.buildGates(G, snowMat);
    this.buildStands(G, rally ? STAGE_HALF + 0.6 : zone.stage ? PROTOCOL_STAGE_HALF + 0.6 : 0);
    this.buildTowers();
    // PROTOCOL C: the boardroom box hangs where the jumbotron would be
    if (!rally && !protocol) this.buildJumbotron(zone);
    this.buildSouthDressing(G);
    this.buildMountains(mountainLook);
    this.buildDrifts(G, snowMat);

    const theme = zone.theme;
    const biome = this.biome;
    if (biome === 'glacier') this.buildGlacier(G);
    else if (biome === 'quarry') this.buildQuarry(G);
    else if (biome === 'mars') this.buildMars(G);
    else if (biome === 'divide') this.buildDivide(G);
    else if (biome === 'plaza') {
      this.buildRally(G);
      this.buildSummer();
    } else if (theme === 'meadow') this.buildYard(G);
    else if (theme === 'pines') this.buildJunkyard(G);
    else if (theme === 'lake') this.buildFoundry(G);
    else if (theme === 'blizzard') this.buildBowl(zone);
    else if (theme === 'rally') this.buildRally(G);
    else if (protocol) this.buildProtocol(G, zone);
    else this.buildSummit(G, snowMat);
    if (this.ctx.terrain.decks.length) {
      // low decks outside The Omega Works (PROTOCOL C): its deck builder, gold, no work lights
      this.deckWorks = new OmegaWorks(this.ctx.terrain, { accent: [0xffc233, 0xffe08a], lights: false, plate: 0xf0d890 });
      this.ctx.scene.add(this.deckWorks.group);
    }
    this.buildGroundDecals();
    if (this.night) this.buildNightStadium(zone, G);
    this.finishDecor();
  }

  /** Lava ribbons, ice sheets and ramp decks for the zone's ground terrain (none on flat arenas or deck arenas: The
   *  Omega Works draws its own structures). */
  private buildGroundDecals(): void {
    const t = this.ctx.terrain;
    // PROTOCOL C's hot / cold waves borrow the Thermal Divide's scorched west half
    const biome = this.biome ?? (this.zone.split ? 'divide' : null);
    if (this.zone.theme === 'omega' || (!t.patches.length && !t.shapes.some((s) => s.kind === 'ramp') && biome !== 'divide')) return;
    const snow = this.ctx.snow;
    this.decals = new GroundDecals(t, biome, (x, z) => (snow ? snow.getDepth(x, z) : this.zone.snowDepth), ARENA.maxX);
    this.add(this.decals.group);
  }

  /** Emits the batched parts, then one depth-only shadow proxy for every static caster of the zone (the visible
   *  meshes stop casting but keep receiving), so the shadow pass draws the whole static scenery in one call. Gate
   *  doors (roll up) and spinners keep casting themselves. Finally freezes the local matrices of everything that
   *  never moves (only spinners rotate; doors and puffs animate instance matrices). */
  private finishDecor(): void {
    const decor = this.decor!;
    this.flushCrowd();
    this.emitGlow();
    const G = this.zone.snowDepth;
    const terrain = this.ctx.terrain;
    // Art pass (render/look.ts bakedAO): corner occlusion baked into the static batch; rays stop at the resting snow
    // inside the arena and at the bare ground outside.
    // Static instanced dressing bakes too (everything but what moves: gate doors, spinners, smoke puffs).
    let ao: Parameters<StaticBatch['flush']>[1];
    if (artLook.bakedAO) {
      const moving = new Set<THREE.Object3D>([...this.spinners.map((sp) => sp.obj), ...(this.doors ? [this.doors] : []), ...(this.puffs ? [this.puffs.mesh] : [])]);
      const instanced: THREE.InstancedMesh[] = [];
      for (const o of decor.children) if ((o as THREE.InstancedMesh).isInstancedMesh && !moving.has(o)) instanced.push(o as THREE.InstancedMesh);
      ao = {
        ground: (x: number, z: number) => terrain.ground(x, z) + (x > ARENA.minX && x < ARENA.maxX && z > ARENA.minZ && z < ARENA.maxZ ? G : 0),
        instanced,
      };
    }
    this.batch!.flush(decor, ao);
    this.batch = null;
    const keep: THREE.Object3D[] = this.spinners.map((s) => s.obj);
    if (this.doors) keep.push(this.doors);
    for (const p of makeShadowProxy([decor, this.casters], null, { keep })) decor.add(p);
    this.casters.clear();
    const moving = new Set(this.spinners.map((sp) => sp.obj));
    decor.traverse((o) => {
      if (moving.has(o)) return;
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    });
    if (this.night) this.boostLights();
  }

  /* ------------------------------------------------------------------ weather */

  /** Biome weather (GPU particles, see biomes/Weather.ts); the classic looks get snow (a gale in the Blizzard Bowl). */
  private buildWeather(zone: ZoneDef): void {
    const b = zone.biome;
    // Quality preset (LOW: half the particles, no haze layers); read at build time, so it applies from the next arena.
    const p = currentPreset();
    let layers: WeatherLayerDef[];
    if (b) {
      layers = weatherLayers(b.particles, zone.snowfall);
      if (b.key === 'glacier') layers.push(GLINTS);
    } else {
      const snow = weatherLayers('snow', zone.snowfall)[0];
      if (zone.theme === 'blizzard') Object.assign(snow, { wind: [16, 5], fall: 5, sway: 1.5, size: 0.18, opacity: 0.95 });
      layers = [snow];
    }
    if (this.storm) layers.push(STORM_GALE);
    this.weather.set(scaleWeatherLayers(layers, p.weatherScale, p.dropHaze));
  }

  /* ------------------------------------------------------------------ update */

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    const cam = this.ctx.camera.position;
    this.sky.position.copy(cam);
    this.skyMat.uniforms.uTime.value = t;
    if (this.auroraBase) {
      const k = 0.5 + 0.5 * Math.sin(t * 0.23);
      this.hemi.color.copy(this.auroraA).lerp(this.auroraB, k).lerp(this.auroraBase, 0.8 + 0.08 * Math.sin(t * 0.61));
    }
    this.bobTime.value = t;
    if (this.carpet) this.drapeCarpet();
    this.props.update(dt);
    if (this.omega) {
      const p = this.ctx.plow?.position;
      this.omega.works.update(dt, p?.x ?? 0, p?.y ?? 0, p?.z ?? 0);
      this.omega.set.update(t);
    }
    if (this.deckWorks) {
      const p = this.ctx.plow?.position;
      this.deckWorks.update(dt, p?.x ?? 0, p?.y ?? 0, p?.z ?? 0);
    }

    // sun shadow camera follows the player (snapped to shadow-map texels to avoid shimmering)
    const plow = this.ctx.plow;
    if (plow) {
      const p = plow.position;
      const tx = this.sunR.x * p.x + this.sunR.z * p.z;
      const ty = this.sunU.x * p.x + this.sunU.z * p.z;
      const tw = this.sunD.x * p.x + this.sunD.z * p.z;
      const k = this.shadowTexel;
      const u = Math.round(tx / k) * k;
      const v = Math.round(ty / k) * k;
      const R = this.sunR;
      const U = this.sunU;
      const D = this.sunD;
      const target = this.sun.target.position;
      target.set(R.x * u + U.x * v + D.x * tw, R.y * u + U.y * v + D.y * tw, R.z * u + U.z * v + D.z * tw);
      this.sun.position.set(target.x + D.x * 100, target.y + D.y * 100, target.z + D.z * 100);
      this.sun.target.updateMatrixWorld();
    }

    for (let i = 0; i < this.pulses.length; i++) {
      const p = this.pulses[i];
      const k = p.speed === 0 ? 0.94 + 0.06 * Math.sin(t * 7.3) * Math.sin(t * 1.1) : 0.75 + 0.25 * Math.sin(t * p.speed + p.phase);
      const m = p.mat as THREE.MeshStandardMaterial;
      if (m.isMeshStandardMaterial) m.emissiveIntensity = p.base * k;
      else if (p.speed === 0) (p.mat as THREE.MeshBasicMaterial).color.setScalar(k);
      else p.mat.opacity = p.base * k;
    }

    // gates: roll the doors, flash the hazard lights
    for (let i = 0; i < this.gates.length; i++) {
      const g = this.gates[i];
      if (g.openT > 0) g.openT -= dt;
      if (g.flashT > 0) g.flashT -= dt;
      const target = g.openT > 0 ? 1 : 0;
      const rate = target > g.open ? 2.6 : 1.3;
      const diff = target - g.open;
      g.open += Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
      const e = g.open * g.open * (3 - 2 * g.open);
      const doorScale = 1 - 0.94 * e;
      if (doorScale !== g.doorScale && this.doors) {
        g.doorScale = doorScale;
        this.doors.setMatrixAt(i, this.tmpM.makeScale(1, doorScale, 1).premultiply(g.doorBase));
        this.doors.instanceMatrix.needsUpdate = true;
      }
      const flashing = g.flashT > 0;
      const k = flashing ? (Math.sin(t * 26) > 0 ? 4.5 : 0.5) : 0.8 + 0.25 * Math.sin(t * 2.2 + g.phase);
      g.lightMat.emissiveIntensity = k * this.lightGain;
      g.glowMat.opacity = Math.min(1, (0.18 + k * 0.17) * this.lightGain);
      g.floorMat.opacity = 0.35 + 0.35 * e + (flashing ? 0.15 : 0);
    }
    if (chevronTex) chevronTex.offset.y = (chevronTex.offset.y + dt * 0.9) % 1;
    if (this.ticker) this.ticker.offset.x = (this.ticker.offset.x + dt * 0.05) % 1;
    if (this.ledTex) this.ledTex.offset.x = (this.ledTex.offset.x + dt * 0.12) % 1;
    if (this.night) {
      // stadium Points: pixels per metre at 1 m, and the haze range
      const c = this.ctx.camera as THREE.PerspectiveCamera;
      const h = this.ctx.renderer.domElement.height;
      this.glowU.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(c.fov ?? 60) / 2));
      this.glowU.uFogNear.value = this.fog.near;
      this.glowU.uFogFar.value = this.fog.far;
    }

    for (let i = 0; i < this.spinners.length; i++) this.spinners[i].obj.rotation.z += dt * this.spinners[i].speed;

    if (this.puffs) {
      const { mesh, stacks, per } = this.puffs;
      const d = this.dummy;
      d.rotation.set(0, 0, 0);
      let n = 0;
      for (let s = 0; s < stacks.length; s++) {
        const st = stacks[s];
        for (let j = 0; j < per; j++) {
          const f = (t * 0.12 + j / per + s * 0.37) % 1;
          const dr = st.drift ?? 9;
          d.position.set(st.x + f * dr + Math.sin(t * 0.5 + j) * 0.8, st.y + 1 + f * (st.rise ?? 16), st.z + f * dr * 0.33);
          let sc = st.r * (0.8 + f * 2.2) * (1 - f * f * 0.6);
          // Shrink away near the camera: a puff drifting through the follow camera (the Thermal Divide's in-arena
          // vents) would otherwise fill the screen.
          const cd = d.position.distanceTo(cam) - sc;
          if (cd < PUFF_CAM_CLEAR) sc *= Math.max(0, cd / PUFF_CAM_CLEAR);
          d.scale.setScalar(Math.max(1e-3, sc));
          d.updateMatrix();
          mesh.setMatrixAt(n++, d.matrix);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    this.weather.update(t, this.ctx.camera, this.ctx.renderer);
    this.contact?.update();
    lavaTime.value = t;
    this.decals?.update(dt);
  }
}
