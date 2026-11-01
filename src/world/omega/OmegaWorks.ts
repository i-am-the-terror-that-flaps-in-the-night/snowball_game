/**
 * The Omega Works structures: meshes for every deck / ramp / pillar / piston / conveyor in a TerrainDef.
 *
 * Look: a neon mega-factory at night. Gunmetal decks with a glowing circuit grid on top and a cyan / magenta light
 * strip along their edges, chrome pillars with red warning bands, hazard-striped pistons, scrolling chevron conveyors.
 *
 * Draw-call budget: static pillars are merged into one mesh; decks stay separate meshes (about 20) because each can
 * fade to see-through while it hangs over the player (so you can always see your plow under a bridge or the tower).
 * Pistons move every frame; conveyors scroll their texture offset. Nothing else animates.
 *
 * Usage: `const works = new OmegaWorks(terrain); scene.add(works.group);` then `works.update(dt, focusX, focusY,
 * focusZ)` each frame (focus = the player), and `works.dispose()` when leaving the arena.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Conveyor, Deck, Terrain } from '../Terrain';

const NEON_CYAN = 0x18e8ff;
const NEON_MAGENTA = 0xff2bd6;
const WARN_RED = 0xff2b3d;
const HAZARD = 0xffd400;

/** A deck counts as "overhead" (and fades) when its underside is this far above the focus point's feet. */
const FADE_CLEAR = 1.5;
const FADE_OPACITY = 0.22;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function canvasTex(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

let deckTopTex: THREE.Texture | null = null;
let deckGlowTex: THREE.Texture | null = null;
/** Light brushed-steel plate with panel seams (colour) + a matching circuit-trace emissive map (glow). One tile = 4 m. */
function deckTextures(): [THREE.Texture, THREE.Texture] {
  if (deckTopTex && deckGlowTex) return [deckTopTex, deckGlowTex];
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#7d8596';
  g.fillRect(0, 0, S, S);
  // plates
  g.strokeStyle = '#555c6b';
  g.lineWidth = 4;
  g.strokeRect(2, 2, S - 4, S - 4);
  g.beginPath();
  g.moveTo(S / 2, 0);
  g.lineTo(S / 2, S);
  g.stroke();
  // rivets
  g.fillStyle = '#a9b0bf';
  for (const [x, y] of [[14, 14], [S - 14, 14], [14, S - 14], [S - 14, S - 14], [S / 2 - 12, S / 2], [S / 2 + 12, S / 2]]) {
    g.beginPath();
    g.arc(x, y, 4, 0, Math.PI * 2);
    g.fill();
  }
  deckTopTex = canvasTex(c);

  const [c2, g2] = canvas(S, S);
  g2.fillStyle = '#000';
  g2.fillRect(0, 0, S, S);
  g2.strokeStyle = '#18e8ff';
  g2.lineWidth = 3;
  g2.lineCap = 'square';
  // circuit traces: right-angle runs ending in pads
  const runs: number[][] = [
    [20, 60, 90, 60, 90, 120],
    [S - 30, 40, S - 30, 110, S - 90, 110],
    [40, S - 40, 120, S - 40, 120, S - 90, 170, S - 90],
    [S - 50, S - 30, S - 50, S - 70],
  ];
  for (const r of runs) {
    g2.beginPath();
    g2.moveTo(r[0], r[1]);
    for (let i = 2; i < r.length; i += 2) g2.lineTo(r[i], r[i + 1]);
    g2.stroke();
    g2.fillStyle = '#18e8ff';
    g2.fillRect(r[r.length - 2] - 5, r[r.length - 1] - 5, 10, 10);
  }
  // seam glow along the plate edge
  g2.strokeStyle = 'rgba(24,232,255,0.35)';
  g2.lineWidth = 2;
  g2.strokeRect(5, 5, S - 10, S - 10);
  deckGlowTex = canvasTex(c2);
  return [deckTopTex, deckGlowTex];
}

let chevronTex: THREE.Texture | null = null;
/** Yellow chevrons on black; scrolls along +v. */
function chevrons(): THREE.Texture {
  if (chevronTex) return chevronTex;
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#0a0a0b';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#ffd400';
  g.beginPath();
  g.moveTo(8, 44);
  g.lineTo(32, 20);
  g.lineTo(56, 44);
  g.lineTo(46, 44);
  g.lineTo(32, 30);
  g.lineTo(18, 44);
  g.closePath();
  g.fill();
  chevronTex = canvasTex(c);
  return chevronTex;
}

let hazardTex: THREE.Texture | null = null;
function hazardStripes(): THREE.Texture {
  if (hazardTex) return hazardTex;
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#0a0a0b';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#ffd400';
  for (let i = -64; i < 128; i += 32) {
    g.beginPath();
    g.moveTo(i, 64);
    g.lineTo(i + 16, 64);
    g.lineTo(i + 80, 0);
    g.lineTo(i + 64, 0);
    g.closePath();
    g.fill();
  }
  hazardTex = canvasTex(c);
  return hazardTex;
}

/**
 * Box geometry for a deck in its local frame (centre at origin, y = 0 at the top of the low end): top and underside
 * both slope by `rise` along local z, matching Terrain.deckTop. UVs: top face in metres / 4 (one texture tile = 4 m).
 */
function deckGeometry(d: Deck): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(d.hw * 2, d.thickness, d.hd * 2);
  g.translate(0, -d.thickness / 2, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const rise = d.rise ?? 0;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    pos.setY(i, pos.getY(i) + rise * ((z + d.hd) / (2 * d.hd)));
  }
  // World-scale UVs on every face (u from the larger in-plane axis), so the plate pattern keeps its size.
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (ny > 0.5) uv.setXY(i, x / 4, z / 4);
    else if (nx > 0.5) uv.setXY(i, z / 4, y / 4);
    else uv.setXY(i, x / 4, y / 4);
  }
  g.computeVertexNormals();
  return g;
}

/** Thin glowing strip running along the deck's top edges (local frame, follows the slope). */
function edgeStripGeometry(d: Deck): THREE.BufferGeometry {
  const rise = d.rise ?? 0;
  const parts: THREE.BufferGeometry[] = [];
  const t = 0.12;
  const yAt = (z: number) => rise * ((z + d.hd) / (2 * d.hd));
  // long sides (along z): sloped strips
  for (const sx of [-1, 1]) {
    const b = new THREE.BoxGeometry(t, t, d.hd * 2);
    const p = b.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + yAt(p.getZ(i)) - 0.18);
    b.translate(sx * (d.hw + t / 2), 0, 0);
    parts.push(b);
  }
  // short ends (along x) at each end's height
  for (const sz of [-1, 1]) {
    const b = new THREE.BoxGeometry(d.hw * 2 + t * 2, t, t);
    b.translate(0, yAt(sz * d.hd) - 0.18, sz * (d.hd + t / 2));
    parts.push(b);
  }
  const m = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return m;
}

interface DeckView {
  deck: Deck;
  mesh: THREE.Mesh;
  mats: THREE.Material[];
  fade: number;
  /** Pistons rebuild their y each frame. */
  baseY: number;
}

export class OmegaWorks {
  readonly group = new THREE.Group();
  private readonly views: DeckView[] = [];
  private readonly conveyorTex: THREE.Texture[] = [];
  private readonly owned: { dispose(): void }[] = [];
  private readonly terrain: Terrain;
  private readonly lights: THREE.PointLight[] = [];

  constructor(terrain: Terrain) {
    this.terrain = terrain;
    this.group.name = 'omega-works';
    const [plate, glow] = deckTextures();

    const deckMat = (accent: number): THREE.MeshStandardMaterial => {
      const m = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: plate,
        emissive: accent,
        emissiveMap: glow,
        emissiveIntensity: 0.8,
        metalness: 0.35,
        roughness: 0.5,
        transparent: true, // so it can fade while overhead; opaque look at opacity 1
        opacity: 1,
      });
      this.owned.push(m);
      return m;
    };
    const edgeMat = (accent: number): THREE.MeshBasicMaterial => {
      const m = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 1, toneMapped: false });
      this.owned.push(m);
      return m;
    };
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xb4bac6, metalness: 0.5, roughness: 0.3 });
    const bandMat = new THREE.MeshBasicMaterial({ color: WARN_RED, toneMapped: false });
    const pistonTopMat = new THREE.MeshStandardMaterial({ map: hazardStripes(), metalness: 0.3, roughness: 0.6 });
    const pistonSideMat = new THREE.MeshStandardMaterial({ color: 0x6a7080, metalness: 0.45, roughness: 0.4, emissive: HAZARD, emissiveIntensity: 0.06 });
    this.owned.push(chromeMat, bandMat, pistonTopMat, pistonSideMat);

    const pillarParts: THREE.BufferGeometry[] = [];
    const bandParts: THREE.BufferGeometry[] = [];

    for (const d of terrain.decks) {
      const isPillar = d.hw <= 1 && d.hd <= 1 && !d.rise && !d.piston;
      if (isPillar) {
        // Chrome column from its base to the deck it holds up, with red bands near the top and bottom.
        const h = d.thickness;
        const col = new THREE.BoxGeometry(d.hw * 2, h, d.hd * 2);
        col.translate(0, d.top - h / 2, 0);
        col.rotateY(d.rot);
        col.translate(d.x, 0, d.z);
        pillarParts.push(col);
        for (const by of [d.top - h + 0.6, d.top - 0.5]) {
          const b = new THREE.BoxGeometry(d.hw * 2 + 0.08, 0.25, d.hd * 2 + 0.08);
          b.translate(0, by, 0);
          b.rotateY(d.rot);
          b.translate(d.x, 0, d.z);
          bandParts.push(b);
        }
        continue;
      }
      if (d.piston) {
        // Hazard-striped head on a dark ram; the whole thing moves (rebuilt y in update()).
        const head = new THREE.BoxGeometry(d.hw * 2, 0.4, d.hd * 2);
        head.translate(0, -0.2, 0);
        const ram = new THREE.BoxGeometry(d.hw * 2 - 0.3, d.thickness, d.hd * 2 - 0.3);
        ram.translate(0, -0.4 - d.thickness / 2, 0);
        const geo = mergeGeometries([head, ram], true);
        head.dispose();
        ram.dispose();
        this.owned.push(geo);
        const mesh = new THREE.Mesh(geo, [pistonTopMat, pistonSideMat]);
        mesh.position.set(d.x, d.top, d.z);
        mesh.rotation.y = d.rot;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);
        this.views.push({ deck: d, mesh, mats: [pistonTopMat, pistonSideMat], fade: 1, baseY: d.top });
        continue;
      }
      const accent = d.rise ? NEON_MAGENTA : NEON_CYAN;
      const geo = deckGeometry(d);
      const strip = edgeStripGeometry(d);
      this.owned.push(geo, strip);
      const mat = deckMat(accent);
      const em = edgeMat(accent);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(d.x, d.top, d.z);
      mesh.rotation.y = d.rot;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const edge = new THREE.Mesh(strip, em);
      mesh.add(edge);
      this.group.add(mesh);
      this.views.push({ deck: d, mesh, mats: [mat, em], fade: 1, baseY: d.top });
    }

    if (pillarParts.length) {
      const pg = mergeGeometries(pillarParts);
      const bg = mergeGeometries(bandParts);
      pillarParts.forEach((p) => p.dispose());
      bandParts.forEach((p) => p.dispose());
      this.owned.push(pg, bg);
      const pillars = new THREE.Mesh(pg, chromeMat);
      pillars.castShadow = true;
      pillars.receiveShadow = true;
      this.group.add(pillars, new THREE.Mesh(bg, bandMat));
    }

    for (const cv of terrain.conveyors) this.addConveyor(cv);

    // A few coloured work lights under the big decks so the undercroft reads (point lights, no shadows).
    for (const [x, y, z, c] of [
      [0, 4.5, 0, NEON_CYAN],
      [52, 4.5, -52, NEON_MAGENTA],
      [-52, 4.5, 52, NEON_MAGENTA],
    ] as const) {
      const l = new THREE.PointLight(c, 30, 26, 1.6);
      l.position.set(x, y, z);
      this.lights.push(l);
      this.group.add(l);
    }
  }

  private addConveyor(cv: Conveyor): void {
    const w = cv.maxX - cv.minX;
    const d = cv.maxZ - cv.minZ;
    const tex = chevrons().clone();
    tex.needsUpdate = true;
    // Chevrons point along +v; orient v along the push direction.
    const alongX = Math.abs(cv.dx) > Math.abs(cv.dz);
    const len = alongX ? w : d;
    const across = alongX ? d : w;
    tex.repeat.set(Math.max(1, Math.round(across / 2)), Math.max(1, Math.round(len / 2)));
    this.conveyorTex.push(tex);
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const geo = new THREE.PlaneGeometry(across, len);
    geo.rotateX(-Math.PI / 2); // plane in xz, v along -z
    this.owned.push(tex, mat, geo);
    const mesh = new THREE.Mesh(geo, mat);
    const cx = (cv.minX + cv.maxX) / 2;
    const cz = (cv.minZ + cv.maxZ) / 2;
    const y = this.terrain.surfaceAt(cx, cz, cv.deck === undefined ? 0 : Infinity).y + 0.06;
    mesh.position.set(cx, y, cz);
    // v runs toward -z by default; rotate so +v points along (dx, dz).
    mesh.rotation.y = Math.atan2(-cv.dx, -cv.dz);
    mesh.userData.speed = cv.speed;
    this.group.add(mesh);
  }

  /** Per frame: piston motion, conveyor scroll, fade decks that hang over the focus point (the player). */
  update(dt: number, fx: number, fy: number, fz: number): void {
    for (const t of this.conveyorTex) t.offset.y -= dt * 0.5 * 2; // ~ speed / tile length
    for (const v of this.views) {
      const d = v.deck;
      if (d.piston) {
        v.mesh.position.y = this.terrain.deckTop(d, d.x, d.z);
        continue;
      }
      const over =
        this.terrain.inDeck(d, fx, fz, 1.5) && this.terrain.deckTop(d, fx, fz) - d.thickness > fy + FADE_CLEAR;
      const target = over ? FADE_OPACITY : 1;
      v.fade += (target - v.fade) * Math.min(1, dt * 8);
      const o = v.fade;
      for (const m of v.mats) {
        m.opacity = o;
        // Fully opaque decks write depth normally; faded ones stop hiding the plow.
        m.depthWrite = o > 0.98;
      }
      v.mesh.castShadow = o > 0.5;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
    this.views.length = 0;
    this.conveyorTex.length = 0;
  }
}
