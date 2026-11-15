import * as THREE from 'three';

/**
 * Per-arena looks for the destructible props (Props.ts). Every arena keeps the same two prop kinds (the "crate" and
 * the "ice" block: same 2 m box, collider, layout and break rules); only their materials, canvas textures and debris
 * colours change, so each arena's props belong to it: frosted server crates in the glacier, banded ore crates and
 * obsidian in the quarry, rusted cargo pods and sandstone on Mars, gift boxes and gold-trim blocks at the rally,
 * neon-striped cargo and glowing cyan cubes in the Works, present boxes in the Snowdome.
 *
 * Materials are cached per skin (Props builds them all once, at startup; a skin's textures are drawn once per session).
 */

export const PROP_SKIN_KEYS = ['classic', 'glacier', 'quarry', 'mars', 'divide', 'plaza', 'omega', 'snowdome'] as const;
export type PropSkinKey = (typeof PROP_SKIN_KEYS)[number];

export interface PropSkin {
  crate: THREE.Material;
  ice: THREE.Material;
  /** Debris burst colours: [main, secondary] per kind. */
  crateDebris: [number, number];
  iceDebris: [number, number];
  /** The Thermal Divide: per-instance tint by side of the seam (x < 0 scorched, x > 0 frosted). */
  split?: { crateHot: number; crateCold: number; iceHot: number; iceCold: number };
}

const cache = new Map<PropSkinKey, PropSkin>();

/** Skin for an arena: its biome key, else its venue theme ('brawl' = the classic Snowdome, 'omega' = the Works). */
export function propSkinKey(biome: string | undefined, theme: string): PropSkinKey {
  switch (biome) {
    case 'glacier': case 'quarry': case 'mars': case 'divide': case 'plaza': return biome;
    default: break;
  }
  if (theme === 'omega') return 'omega';
  if (theme === 'brawl') return 'snowdome';
  if (theme === 'rally') return 'plaza';
  return 'classic';
}

export function getPropSkin(key: PropSkinKey): PropSkin {
  let s = cache.get(key);
  if (!s) {
    s = build(key);
    cache.set(key, s);
  }
  return s;
}

/* ------------------------------------------------------------------ canvas helpers */

const HAS_DOM = typeof document !== 'undefined';
const S = 128;

function draw(fn: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture | null {
  if (!HAS_DOM) return null;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  if (!g) return null;
  fn(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function rng(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function frame(g: CanvasRenderingContext2D, col: string, w: number): void {
  g.strokeStyle = col;
  g.lineWidth = w;
  g.strokeRect(w / 2, w / 2, S - w, S - w);
}

/** Classic wooden crate (the pre-skin look). */
function woodCrate(g: CanvasRenderingContext2D): void {
  g.fillStyle = '#a8743f';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#8a5a2c';
  for (let y = 0; y < S; y += 32) g.fillRect(0, y, S, 4);
  g.strokeStyle = '#5a3a1a';
  g.lineWidth = 12;
  g.strokeRect(6, 6, S - 12, S - 12);
  g.beginPath();
  g.moveTo(12, 12);
  g.lineTo(S - 12, S - 12);
  g.stroke();
}

/* ------------------------------------------------------------------ skins */

function std(p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial(p);
}

/** Opaque ice block: no back faces showing through; a fresnel rim (onBeforeCompile) keeps it glassy. */
function iceBlock(color: number, emissive: number, rim: [number, number, number]): THREE.MeshStandardMaterial {
  const m = std({ color, roughness: 0.12, metalness: 0.08, emissive, emissiveIntensity: 0.35, map: draw(iceFace) });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        float fr = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.5);
        totalEmissiveRadiance += vec3(${rim.map((v) => v.toFixed(3)).join(', ')}) * fr;
      }`,
    );
  };
  m.customProgramCacheKey = () => `propIce${rim.join(',')}`;
  return m;
}

function iceFace(g: CanvasRenderingContext2D): void {
  const grd = g.createLinearGradient(0, 0, S, S);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.5, '#d8f0fb');
  grd.addColorStop(1, '#b4dcf2');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const r = rng(7);
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineCap = 'round';
  for (let k = 0; k < 5; k++) {
    let x = r() * S;
    let y = r() * S;
    let a = r() * Math.PI * 2;
    g.lineWidth = 1 + r() * 1.5;
    g.beginPath();
    g.moveTo(x, y);
    for (let i = 0; i < 5; i++) {
      a += (r() - 0.5) * 1.4;
      x += Math.cos(a) * 14;
      y += Math.sin(a) * 14;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  frame(g, 'rgba(255,255,255,0.7)', 6);
}

function build(key: PropSkinKey): PropSkin {
  switch (key) {
    case 'glacier': {
      // frozen server crate: dark steel rack face, cyan status LEDs, frost caked on the top edge
      const map = draw((g) => {
        g.fillStyle = '#3a4a5c';
        g.fillRect(0, 0, S, S);
        g.fillStyle = '#2a3646';
        for (let y = 18; y < 110; y += 18) g.fillRect(14, y, 100, 11);
        g.fillStyle = '#7ff3ff';
        for (let y = 18; y < 110; y += 18) { g.fillRect(100, y + 3, 5, 5); g.fillRect(90, y + 3, 5, 5); }
        frame(g, '#5f7488', 8);
        const grd = g.createLinearGradient(0, 0, 0, 34);
        grd.addColorStop(0, 'rgba(240,250,255,0.95)');
        grd.addColorStop(1, 'rgba(240,250,255,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, S, 34);
      });
      const emissiveMap = draw((g) => {
        g.fillStyle = '#000';
        g.fillRect(0, 0, S, S);
        g.fillStyle = '#5fe8ff';
        for (let y = 18; y < 110; y += 18) { g.fillRect(100, y + 3, 5, 5); g.fillRect(90, y + 3, 5, 5); }
      });
      return {
        crate: std({ map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.55, metalness: 0.35, color: HAS_DOM ? 0xffffff : 0x3a4a5c }),
        ice: iceBlock(0xbfe8ff, 0x1a5a8a, [0.35, 0.75, 1.0]),
        crateDebris: [0x3a4a5c, 0xe8f6ff],
        iceDebris: [0xbfe8ff, 0xffffff],
      };
    }
    case 'quarry': {
      // ore crate: iron-banded timber with glowing ore showing between the slats
      const map = draw((g) => {
        g.fillStyle = '#5a3a2a';
        g.fillRect(0, 0, S, S);
        g.fillStyle = '#46291c';
        for (let y = 0; y < S; y += 21) g.fillRect(0, y, S, 3);
        g.fillStyle = '#2a2624';
        g.fillRect(0, 20, S, 14);
        g.fillRect(0, 94, S, 14);
        g.fillStyle = '#6a625e';
        for (let x = 10; x < S; x += 26) { g.fillRect(x, 25, 4, 4); g.fillRect(x, 99, 4, 4); }
        frame(g, '#2a2624', 8);
      });
      const crate = std({ map, roughness: 0.85, metalness: 0.15, color: HAS_DOM ? 0xffffff : 0x5a3a2a });
      // obsidian chunk: glassy black with glowing orange cracks
      const cracks = (g: CanvasRenderingContext2D, glow: boolean) => {
        g.fillStyle = glow ? '#000' : '#16100f';
        g.fillRect(0, 0, S, S);
        if (!glow) {
          const grd = g.createLinearGradient(0, 0, S, S);
          grd.addColorStop(0, 'rgba(90,70,80,0.5)');
          grd.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grd;
          g.fillRect(0, 0, S, S);
        }
        const r = rng(31);
        g.strokeStyle = glow ? '#ff8a2a' : '#b8400c';
        g.lineCap = 'round';
        for (let k = 0; k < 6; k++) {
          let x = r() * S;
          let y = r() * S;
          let a = r() * Math.PI * 2;
          g.lineWidth = 3.5 + r() * 3;
          g.beginPath();
          g.moveTo(x, y);
          for (let i = 0; i < 6; i++) {
            a += (r() - 0.5) * 1.3;
            x += Math.cos(a) * 15;
            y += Math.sin(a) * 15;
            g.lineTo(x, y);
          }
          g.stroke();
        }
      };
      const ice = std({
        map: draw((g) => cracks(g, false)), emissiveMap: draw((g) => cracks(g, true)), emissive: 0xffffff, emissiveIntensity: 2.2,
        roughness: 0.18, metalness: 0.3, color: HAS_DOM ? 0xffffff : 0x16100f,
      });
      return { crate, ice, crateDebris: [0x5a3a2a, 0x2a2624], iceDebris: [0x16100f, 0xff7a1a] };
    }
    case 'mars': {
      // rusted cargo pod with a stencilled mission code and a hazard band
      const map = draw((g) => {
        g.fillStyle = '#9a5634';
        g.fillRect(0, 0, S, S);
        const r = rng(5);
        for (let k = 0; k < 40; k++) {
          g.fillStyle = `rgba(${90 + r() * 40 | 0},${40 + r() * 20 | 0},${20 + r() * 10 | 0},${0.25 + r() * 0.35})`;
          g.beginPath();
          g.arc(r() * S, r() * S, 3 + r() * 9, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = '#d8d2c4';
        g.fillRect(0, 12, S, 6);
        g.fillRect(0, 110, S, 6);
        g.fillStyle = '#efe6d4';
        g.font = 'bold 26px monospace';
        g.textAlign = 'center';
        g.fillText('MRS-07', S / 2, 74);
        frame(g, '#5e2e18', 8);
      });
      const crate = std({ map, roughness: 0.75, metalness: 0.4, color: HAS_DOM ? 0xffffff : 0x9a5634 });
      // red sandstone block: horizontal strata
      const stone = draw((g) => {
        g.fillStyle = '#b4583a';
        g.fillRect(0, 0, S, S);
        const r = rng(13);
        let y = 0;
        while (y < S) {
          const h = 6 + r() * 16;
          g.fillStyle = r() < 0.5 ? 'rgba(220,130,90,0.45)' : 'rgba(120,48,28,0.4)';
          g.fillRect(0, y, S, h);
          y += h;
        }
        frame(g, 'rgba(90,36,20,0.6)', 5);
      });
      return {
        crate, ice: std({ map: stone, roughness: 0.95, metalness: 0, color: HAS_DOM ? 0xffffff : 0xb4583a }),
        crateDebris: [0x9a5634, 0xd8d2c4], iceDebris: [0xb4583a, 0xdc9670],
      };
    }
    case 'divide': {
      // steel crates and ice blocks, tinted per side of the seam (scorched west, frosted east)
      const map = draw((g) => {
        g.fillStyle = '#b8bcc4';
        g.fillRect(0, 0, S, S);
        g.fillStyle = '#9a9ea8';
        for (let x = 12; x < S; x += 20) g.fillRect(x, 10, 6, S - 20);
        frame(g, '#6a6e78', 10);
      });
      return {
        crate: std({ map, roughness: 0.6, metalness: 0.4, color: HAS_DOM ? 0xffffff : 0xb8bcc4 }),
        ice: iceBlock(0xffffff, 0x1a4a6a, [0.4, 0.6, 0.8]),
        crateDebris: [0x9a9ea8, 0x4a3a34],
        iceDebris: [0xbfe8ff, 0xffffff],
        split: { crateHot: 0x8a5a48, crateCold: 0xe6f2ff, iceHot: 0xff9a6a, iceCold: 0xb4e2ff },
      };
    }
    case 'plaza': {
      // rally gift box: navy wrap, red ribbon cross, gold slogan
      const map = draw((g) => {
        g.fillStyle = '#1e3a8a';
        g.fillRect(0, 0, S, S);
        g.fillStyle = 'rgba(255,255,255,0.18)';
        for (let x = 0; x < S; x += 16) for (let y = (x / 16) % 2 ? 8 : 0; y < S; y += 16) g.fillRect(x + 6, y + 6, 4, 4);
        g.fillStyle = '#d42a2a';
        g.fillRect(S / 2 - 9, 0, 18, S);
        g.fillRect(0, S / 2 - 9, S, 18);
        g.fillStyle = '#ffd23a';
        g.font = 'bold 15px sans-serif';
        g.textAlign = 'center';
        g.fillText('MAKE SNOW', S / 2, 34);
        g.fillText('GREAT', S / 2, 106);
        frame(g, '#ffd23a', 4);
      });
      // white marble block, gold trim
      const marble = draw((g) => {
        g.fillStyle = '#f2ece2';
        g.fillRect(0, 0, S, S);
        const r = rng(19);
        g.strokeStyle = 'rgba(160,150,140,0.35)';
        for (let k = 0; k < 6; k++) {
          g.lineWidth = 1 + r() * 2;
          g.beginPath();
          g.moveTo(r() * S, 0);
          g.bezierCurveTo(r() * S, S * 0.3, r() * S, S * 0.7, r() * S, S);
          g.stroke();
        }
        frame(g, '#d4a72c', 12);
      });
      return {
        crate: std({ map, roughness: 0.55, metalness: 0.05, color: HAS_DOM ? 0xffffff : 0x1e3a8a }),
        ice: std({ map: marble, roughness: 0.35, metalness: 0.2, color: HAS_DOM ? 0xffffff : 0xf2ece2 }),
        crateDebris: [0xd42a2a, 0xffd23a], iceDebris: [0xf2ece2, 0xd4a72c],
      };
    }
    case 'omega': {
      // steel cargo with a neon stripe; glowing cyan data cubes
      const stripe = (g: CanvasRenderingContext2D, glow: boolean) => {
        g.fillStyle = glow ? '#000' : '#4a4f5c';
        g.fillRect(0, 0, S, S);
        if (!glow) {
          g.fillStyle = '#3a3e4a';
          for (let y = 8; y < S; y += 16) g.fillRect(0, y, S, 3);
          frame(g, '#2a2d36', 8);
        }
        g.fillStyle = glow ? '#ff2bd6' : '#ff6ae0';
        g.fillRect(0, 56, S, 12);
      };
      const cube = (g: CanvasRenderingContext2D, glow: boolean) => {
        g.fillStyle = glow ? '#000' : '#14303a';
        g.fillRect(0, 0, S, S);
        g.strokeStyle = glow ? '#18e8ff' : '#2a8aa0';
        g.lineWidth = 8;
        g.strokeRect(8, 8, S - 16, S - 16);
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(8, S / 2); g.lineTo(40, S / 2); g.lineTo(52, 40); g.lineTo(S - 8, 40);
        g.moveTo(S / 2, S - 8); g.lineTo(S / 2, 86); g.lineTo(88, 74);
        g.stroke();
      };
      return {
        crate: std({ map: draw((g) => stripe(g, false)), emissiveMap: draw((g) => stripe(g, true)), emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.45, metalness: 0.55, color: HAS_DOM ? 0xffffff : 0x4a4f5c }),
        ice: std({ map: draw((g) => cube(g, false)), emissiveMap: draw((g) => cube(g, true)), emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.2, metalness: 0.3, color: HAS_DOM ? 0xffffff : 0x14303a }),
        crateDebris: [0x4a4f5c, 0xff2bd6], iceDebris: [0x18e8ff, 0x14303a],
      };
    }
    case 'snowdome': {
      // present boxes (green, red ribbon) + the classic ice blocks
      const map = draw((g) => {
        g.fillStyle = '#1f8a4a';
        g.fillRect(0, 0, S, S);
        g.fillStyle = 'rgba(255,255,255,0.22)';
        for (let x = -S; x < S; x += 22) { g.beginPath(); g.moveTo(x, S); g.lineTo(x + 8, S); g.lineTo(x + S + 8, 0); g.lineTo(x + S, 0); g.fill(); }
        g.fillStyle = '#e02a3a';
        g.fillRect(S / 2 - 10, 0, 20, S);
        g.fillRect(0, S / 2 - 10, S, 20);
        g.fillStyle = '#ffd23a';
        g.fillRect(S / 2 - 10, 0, 3, S);
        g.fillRect(0, S / 2 - 10, S, 3);
      });
      return {
        crate: std({ map, roughness: 0.6, metalness: 0.05, color: HAS_DOM ? 0xffffff : 0x1f8a4a }),
        ice: iceBlock(0x9fdcff, 0x1a5a8a, [0.3, 0.6, 0.9]),
        crateDebris: [0x1f8a4a, 0xe02a3a], iceDebris: [0xbfe8ff, 0xffffff],
      };
    }
    default:
      return {
        crate: std({ map: draw(woodCrate), color: HAS_DOM ? 0xffffff : 0xa8743f, roughness: 0.8 }),
        ice: iceBlock(0x9fdcff, 0x1a5a8a, [0.3, 0.6, 0.9]),
        crateDebris: [0xa8743f, 0x5a3a1a], iceDebris: [0xbfe8ff, 0xffffff],
      };
  }
}
