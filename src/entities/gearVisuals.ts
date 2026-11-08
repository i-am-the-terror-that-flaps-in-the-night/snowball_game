import * as THREE from 'three';
import { GEAR_BY_ID, GEAR_SLOTS, RARITY_COLOR, type GearDef, type GearSlot } from '../config/gear';
import type { PlowKind } from '../config/plows';

/**
 * Equipped gear, visible on the plow. Each slot adds a small, cheap attachment: blade items dress the blade edge
 * (ARSENAL: the hull nose), chassis items the hull sides, boosters a rear pod (+ dash-flame tint), cores a glowing
 * gem on the deck, charms a little ornament. Data-driven: GEAR_LOOKS maps item id -> style; an unknown id falls back
 * to its slot's default in the item's rarity colour. Geometry + materials are shared module-wide and built lazily;
 * the attachments are rebuilt only when the equipped set or the plow body changes.
 */

type BladeStyle = 'edge' | 'steel' | 'spikes' | 'frost' | 'molten';
type ChassisStyle = 'stripe' | 'rivets' | 'ice' | 'ember' | 'patches';
type BoosterStyle = 'pod' | 'tank' | 'fan' | 'jet';
type CharmStyle = 'orb' | 'magnet' | 'globe' | 'drone';

export interface GearLook {
  blade?: BladeStyle;
  chassis?: ChassisStyle;
  booster?: BoosterStyle;
  /** Booster items: dash-flame colour. */
  flame?: number;
  /** Cores: gem colour (default: rarity colour). */
  core?: number;
  charm?: CharmStyle;
}

/** Item id -> look. Items not listed use their slot default (SLOT_DEFAULT) in their rarity colour. */
export const GEAR_LOOKS: Record<string, GearLook> = {
  steelWedge: { blade: 'steel' },
  spikedShare: { blade: 'spikes' },
  frostEdge: { blade: 'frost' },
  avalancheBlade: { blade: 'molten' },
  rivetedFrame: { chassis: 'rivets' },
  scrapRecycler: { chassis: 'patches' },
  glacierShell: { chassis: 'ice' },
  phoenixPlating: { chassis: 'ember' },
  nitroTank: { booster: 'tank', flame: 0x3fa7ff },
  turbineFan: { booster: 'fan' },
  jetTurbine: { booster: 'jet', flame: 0xfff0c0 },
  packCompactor: { core: 0x9fdcff },
  overclockChip: { core: 0xffb020 },
  luckyMagnet: { charm: 'magnet' },
  snowGlobe: { charm: 'globe' },
  repairDrone: { charm: 'drone' },
};

const SLOT_DEFAULT: Record<GearSlot, GearLook> = {
  blade: { blade: 'edge' },
  chassis: { chassis: 'stripe' },
  booster: { booster: 'pod' },
  core: {},
  charm: { charm: 'orb' },
};

/** The look for an item: its GEAR_LOOKS entry, else its slot default. Null for unknown ids. */
export function gearLook(id: string): { def: GearDef; look: GearLook } | null {
  const def = GEAR_BY_ID[id];
  if (!def) return null;
  const own = GEAR_LOOKS[id];
  // A recipe for the wrong slot (data slip) falls back to the slot default rather than drawing nothing.
  const fits = own && (def.slot === 'core' || own[def.slot as Exclude<GearSlot, 'core'>] !== undefined);
  return { def, look: fits ? own : SLOT_DEFAULT[def.slot] };
}

/* ------------------------------------------------------------------------------------------------ anchors */

interface Anchors {
  /** Hull sides: |x|, y, z centre, length. */
  side: [number, number, number, number];
  /** Rear pod: y, z. */
  rear: [number, number];
  /** Deck gem: x, y, z. */
  deck: [number, number, number];
  /** Charm mount: x, y, z. */
  charm: [number, number, number];
  /** ARSENAL-style nose (no blade): y, z, width. Null = the item goes on the blade. */
  nose: [number, number, number] | null;
}

const ANCHORS: Record<PlowKind, Anchors> = {
  classic: { side: [1.07, 1.0, -0.95, 1.9], rear: [1.15, -2.12], deck: [0, 2.06, -1.27], charm: [0.78, 2.3, 0.45], nose: null },
  volt: { side: [0.95, 1.11, -0.05, 2.7], rear: [1.05, -2.0], deck: [0, 1.28, -1.15], charm: [-0.42, 1.55, 1.12], nose: null },
  brute: { side: [1.12, 1.25, -0.4, 2.2], rear: [1.6, -2.0], deck: [-0.45, 2.15, -0.6], charm: [0.75, 2.75, 0.45], nose: null },
  isotope: { side: [1.11, 1.16, -0.45, 2.4], rear: [1.1, -1.9], deck: [0, 2.45, -0.9], charm: [-0.7, 2.38, 1.0], nose: null },
  arsenal: { side: [1.0, 1.6, -0.6, 1.5], rear: [1.95, -1.15], deck: [-0.45, 2.14, -0.95], charm: [0.6, 2.12, -1.1], nose: [1.43, 2.14, 1.5] },
};

/** Blade sheet top edge / front face, in blade-group space (see Plow's curved sheet). */
const BLADE_TOP_Y = 1.36;
const BLADE_TOP_Z = 0.27;
const SPIKE_Y = 0.45;
const SPIKE_Z = 0.02;
const MAX_INST = 16;

/* ------------------------------------------------------------------------------------------------ shared assets */

let A: ReturnType<typeof buildAssets> | null = null;
function assets() {
  return (A ??= buildAssets());
}

function buildAssets() {
  const std = (color: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.3, ...o });
  const glow = (color: number, k = 0.9) => std(color, { emissive: color, emissiveIntensity: k, roughness: 0.35 });
  const spike = new THREE.ConeGeometry(0.075, 0.34, 6);
  spike.rotateX(Math.PI / 2);
  spike.translate(0, 0, 0.17);
  const crystal = new THREE.ConeGeometry(0.06, 0.24, 5);
  crystal.translate(0, 0.12, 0);
  const tank = new THREE.CylinderGeometry(0.15, 0.15, 0.8, 10);
  tank.rotateZ(Math.PI / 2);
  const nozzle = new THREE.CylinderGeometry(0.17, 0.26, 0.45, 12, 1, true);
  nozzle.rotateX(Math.PI / 2);
  const fanRing = new THREE.TorusGeometry(0.3, 0.05, 6, 16);
  const fanBlade = new THREE.BoxGeometry(0.5, 0.08, 0.02);
  const pod = new THREE.CapsuleGeometry(0.12, 0.35, 3, 8);
  pod.rotateX(Math.PI / 2);
  const magnet = new THREE.TorusGeometry(0.1, 0.035, 6, 10, Math.PI);
  return {
    mats: {
      steel: std(0xe4ebf2, { metalness: 0.95, roughness: 0.18 }),
      dark: std(0x2a2f36, { metalness: 0.4, roughness: 0.6 }),
      frost: std(0xbfeeff, { emissive: 0x4ab8ff, emissiveIntensity: 0.7, roughness: 0.15, metalness: 0.1 }),
      molten: glow(0xff7a1a, 1.3),
      ice: std(0x9fdcff, { transparent: true, opacity: 0.55, emissive: 0x1a6aa8, emissiveIntensity: 0.35, roughness: 0.1, metalness: 0.05, depthWrite: false }),
      ember: glow(0xff6a1a, 1.1),
      rust: std(0x8a5a3a, { roughness: 0.85, metalness: 0.5 }),
      plate: std(0x7a8494, { roughness: 0.7, metalness: 0.6 }),
      tank: std(0x2f7fe0, { metalness: 0.6, roughness: 0.3 }),
      red: std(0xe02a2a, { roughness: 0.4 }),
      globe: std(0xdff4ff, { transparent: true, opacity: 0.45, roughness: 0.05, metalness: 0, depthWrite: false }),
      jetCore: new THREE.MeshBasicMaterial({ color: 0xfff0c0 }),
    },
    rarity: new Map<string, THREE.MeshStandardMaterial>(),
    glowFor: (color: number) => glow(color, 0.9),
    geo: {
      bar: new THREE.BoxGeometry(1, 0.08, 0.1),
      spike,
      crystal,
      stud: new THREE.SphereGeometry(0.05, 6, 4),
      panel: new THREE.BoxGeometry(0.05, 0.5, 1),
      patch: new THREE.BoxGeometry(0.04, 0.32, 0.42),
      stripe: new THREE.BoxGeometry(0.03, 0.09, 1),
      tank,
      nozzle,
      disc: new THREE.CircleGeometry(0.16, 12),
      fanRing,
      fanBlade,
      pod,
      gem: new THREE.OctahedronGeometry(0.17),
      base: new THREE.CylinderGeometry(0.15, 0.18, 0.1, 10),
      antenna: new THREE.CylinderGeometry(0.018, 0.018, 0.55, 5),
      orb: new THREE.SphereGeometry(0.09, 10, 8),
      globe: new THREE.SphereGeometry(0.12, 12, 8),
      magnet,
      drone: new THREE.BoxGeometry(0.2, 0.08, 0.2),
      rotor: new THREE.CylinderGeometry(0.09, 0.09, 0.01, 10),
    },
  };
}

/** Emissive material in an item colour (cached per colour). */
function colorMat(color: number): THREE.MeshStandardMaterial {
  const a = assets();
  const k = color.toString(16);
  let m = a.rarity.get(k);
  if (!m) a.rarity.set(k, (m = a.glowFor(color)));
  return m;
}

const hex = (css: string) => parseInt(css.replace('#', ''), 16);

/* ------------------------------------------------------------------------------------------------ the attachment set */

export class GearVisuals {
  /** Blade items (child of the blade group, or of `nose` on a bladeless plow). */
  private bladeLayer = new THREE.Group();
  /** Everything else (child of the plow body). */
  private bodyLayer = new THREE.Group();
  private nose = new THREE.Group();
  private key = '';
  private width = 1;
  /** Bladeless plow: the blade item sits on the nose at a fixed width. */
  private fixed = false;
  private bladeStyle: BladeStyle | null = null;
  private inst: THREE.InstancedMesh | null = null;
  private bar: THREE.Mesh | null = null;
  private fan: THREE.Object3D | null = null;
  private drone: THREE.Object3D | null = null;
  /** Dash-flame colour from the booster, or null for the plow's own. */
  flame: number | null = null;

  constructor(
    private body: THREE.Object3D,
    private blade: THREE.Object3D,
  ) {
    body.add(this.bodyLayer, this.nose);
    blade.add(this.bladeLayer);
  }

  /** Rebuild for `kind` wearing `ids` (one item id per slot; unknown ids use the slot default). Cheap no-op when
   *  nothing changed. */
  sync(kind: PlowKind, ids: readonly string[], bladeWidth: number): void {
    const key = `${kind}|${[...ids].sort().join(',')}`;
    if (key === this.key) return this.setWidth(bladeWidth);
    this.key = key;
    this.clear();
    const an = ANCHORS[kind];
    // Bladeless plows wear the blade item across the nose.
    if (an.nose) {
      this.nose.add(this.bladeLayer);
      this.nose.position.set(0, an.nose[0] - BLADE_TOP_Y, an.nose[1] - BLADE_TOP_Z);
    } else this.blade.add(this.bladeLayer);
    for (const id of ids) {
      const g = gearLook(id);
      if (!g) continue;
      const color = hex(RARITY_COLOR[g.def.rarity]);
      const L = g.look;
      if (g.def.slot === 'blade' && L.blade) this.buildBlade(L.blade, color);
      else if (g.def.slot === 'chassis' && L.chassis) this.buildChassis(L.chassis, color, an);
      else if (g.def.slot === 'booster' && L.booster) {
        this.buildBooster(L.booster, color, an);
        this.flame = L.flame ?? null;
      } else if (g.def.slot === 'core') this.buildCore(L.core ?? color, an, g.def.rarity === 'legendary');
      else if (g.def.slot === 'charm' && L.charm) this.buildCharm(L.charm, color, an);
    }
    this.fixed = !!an.nose;
    this.width = -1;
    this.layout(an.nose ? an.nose[2] : bladeWidth);
  }

  /** The plow's blade width changed (ignored on a bladeless plow). */
  setWidth(w: number): void {
    if (!this.fixed) this.layout(w);
  }

  /** Stretch the edge bar and re-lay spikes / crystals along it. */
  private layout(w: number): void {
    if (w === this.width) return;
    this.width = w;
    if (this.bar) this.bar.scale.x = w;
    const inst = this.inst;
    if (!inst) return;
    const spikes = this.bladeStyle === 'spikes';
    const n = Math.min(MAX_INST, Math.max(3, Math.round(w / (spikes ? 0.42 : 0.5))));
    inst.count = n;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1) - 0.5) * (w - 0.25);
      // On a bladeless nose the spikes sit just under the edge bar.
      if (spikes) _m.makeTranslation(x, this.fixed ? BLADE_TOP_Y - 0.22 : SPIKE_Y, this.fixed ? BLADE_TOP_Z - 0.05 : SPIKE_Z);
      else _m.compose(_v.set(x, BLADE_TOP_Y + 0.03, BLADE_TOP_Z), _q.setFromAxisAngle(_z, (i % 3 - 1) * 0.35), _s.setScalar(0.7 + ((i * 7) % 5) * 0.12));
      inst.setMatrixAt(i, _m);
    }
    inst.instanceMatrix.needsUpdate = true;
  }

  /** Spin the fan / bob the drone (cheap; only when those are worn). */
  update(t: number): void {
    if (this.fan) this.fan.rotation.z = t * 9;
    if (this.drone) this.drone.position.y = this.droneY + Math.sin(t * 3) * 0.06;
  }
  private droneY = 0;

  private clear(): void {
    for (const layer of [this.bladeLayer, this.bodyLayer]) {
      for (const c of [...layer.children]) {
        layer.remove(c);
        // Shared geometry / materials stay; only per-instance InstancedMesh buffers need freeing.
        if (c instanceof THREE.InstancedMesh) c.dispose();
      }
    }
    this.inst = this.bar = this.fan = this.drone = null;
    this.bladeStyle = null;
    this.flame = null;
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  private buildBlade(style: BladeStyle, color: number): void {
    const { geo, mats } = assets();
    this.bladeStyle = style;
    const barMat = style === 'steel' ? mats.steel : style === 'frost' ? mats.frost : style === 'molten' ? mats.molten : style === 'spikes' ? mats.dark : colorMat(color);
    this.bar = this.mesh(geo.bar, barMat, this.bladeLayer, 0, BLADE_TOP_Y, BLADE_TOP_Z);
    if (style === 'spikes' || style === 'frost') {
      const inst = new THREE.InstancedMesh(style === 'spikes' ? geo.spike : geo.crystal, style === 'spikes' ? mats.steel : mats.frost, MAX_INST);
      inst.count = 0;
      inst.frustumCulled = false;
      this.inst = inst;
      this.bladeLayer.add(inst);
    }
  }

  private buildChassis(style: ChassisStyle, color: number, an: Anchors): void {
    const { geo, mats } = assets();
    const [sx, sy, sz, len] = an.side;
    for (const s of [-1, 1]) {
      const x = s * sx;
      if (style === 'stripe') this.mesh(geo.stripe, colorMat(color), this.bodyLayer, x, sy, sz).scale.z = len;
      else if (style === 'ice' || style === 'ember') {
        const p = this.mesh(geo.panel, style === 'ice' ? mats.ice : mats.ember, this.bodyLayer, x + s * 0.02, sy + 0.05, sz);
        p.scale.set(1, style === 'ember' ? 0.35 : 1, len * 0.85);
      } else if (style === 'patches') {
        for (let i = 0; i < 3; i++) {
          const p = this.mesh(geo.patch, i === 1 ? mats.rust : mats.plate, this.bodyLayer, x + s * 0.02, sy + (i - 1) * 0.08, sz + (i - 1) * len * 0.3);
          p.rotation.x = (i - 1) * 0.3;
        }
      }
    }
    if (style === 'rivets') {
      const per = 6;
      const inst = new THREE.InstancedMesh(geo.stud, mats.steel, per * 4);
      let k = 0;
      for (const s of [-1, 1]) {
        for (const dy of [-0.18, 0.18]) {
          for (let i = 0; i < per; i++) {
            _m.makeTranslation(s * (sx + 0.01), sy + dy, sz + (i / (per - 1) - 0.5) * len * 0.9);
            inst.setMatrixAt(k++, _m);
          }
        }
      }
      inst.frustumCulled = false;
      this.bodyLayer.add(inst);
    }
  }

  private buildBooster(style: BoosterStyle, color: number, an: Anchors): void {
    const { geo, mats } = assets();
    const [y, z] = an.rear;
    if (style === 'tank') {
      this.mesh(geo.tank, mats.tank, this.bodyLayer, 0, y, z - 0.12);
      this.mesh(geo.tank, mats.tank, this.bodyLayer, 0, y + 0.3, z - 0.12);
    } else if (style === 'jet') {
      this.mesh(geo.nozzle, mats.steel, this.bodyLayer, 0, y, z - 0.2);
      const core = this.mesh(geo.disc, mats.jetCore, this.bodyLayer, 0, y, z - 0.08);
      core.rotation.y = Math.PI;
    } else if (style === 'fan') {
      const g = new THREE.Group();
      g.position.set(0, y + 0.05, z - 0.12);
      this.mesh(geo.fanRing, mats.dark, g);
      const blades = new THREE.Group();
      for (let i = 0; i < 3; i++) this.mesh(geo.fanBlade, mats.steel, blades).rotation.z = (i * Math.PI) / 3;
      g.add(blades);
      this.fan = blades;
      this.bodyLayer.add(g);
    } else {
      for (const s of [-1, 1]) this.mesh(geo.pod, colorMat(color), this.bodyLayer, s * 0.45, y, z - 0.15);
    }
  }

  private buildCore(color: number, an: Anchors, big: boolean): void {
    const { geo, mats } = assets();
    const [x, y, z] = an.deck;
    this.mesh(geo.base, mats.dark, this.bodyLayer, x, y, z);
    const gem = this.mesh(geo.gem, colorMat(color), this.bodyLayer, x, y + 0.24, z);
    gem.scale.set(big ? 1.3 : 1, big ? 1.6 : 1.35, big ? 1.3 : 1);
  }

  private buildCharm(style: CharmStyle, color: number, an: Anchors): void {
    const { geo, mats } = assets();
    const [x, y, z] = an.charm;
    if (style === 'drone') {
      const d = new THREE.Group();
      this.mesh(geo.drone, mats.plate, d);
      for (const [dx, dz] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]] as const) this.mesh(geo.rotor, mats.dark, d, dx, 0.05, dz);
      this.droneY = y + 0.55;
      d.position.set(x + Math.sign(x || 1) * 0.35, this.droneY, z - 0.4);
      this.drone = d;
      this.bodyLayer.add(d);
      return;
    }
    this.mesh(geo.antenna, mats.dark, this.bodyLayer, x, y + 0.27, z);
    const top = y + 0.58;
    if (style === 'magnet') {
      const m = this.mesh(geo.magnet, mats.red, this.bodyLayer, x, top + 0.02, z);
      m.rotation.z = Math.PI;
    } else if (style === 'globe') {
      this.mesh(geo.base, mats.dark, this.bodyLayer, x, top - 0.02, z).scale.setScalar(0.6);
      this.mesh(geo.globe, mats.globe, this.bodyLayer, x, top + 0.1, z);
      this.mesh(geo.orb, mats.steel, this.bodyLayer, x, top + 0.06, z).scale.setScalar(0.35);
    } else {
      this.mesh(geo.orb, colorMat(color), this.bodyLayer, x, top, z);
    }
  }

  /** Slots in display order with the item id for each (helper for callers holding a GearState). */
  static idsFrom(equipped: Partial<Record<GearSlot, string>>): string[] {
    return GEAR_SLOTS.map((s) => equipped[s.id]).filter((id): id is string => !!id);
  }
}

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
