import * as THREE from 'three';

/* Procedural canvas textures for Golden Tower Plaza (the 'rally' theme): US-style flags, red/white/blue
 * bunting, the crowd-sign / wall-banner atlas, the stage backdrop and the red carpet. Built once and cached at
 * module level (materials that use them may be disposed with the zone decor; the textures are kept). The sign
 * lines are made-up parody slogans for the cartoon boss. */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}
function tex(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export const RALLY_RED = '#c8102e';
export const RALLY_BLUE = '#1f3b8c';
export const RALLY_GOLD = '#f2c033';

let flagTex: THREE.Texture | null = null;
/** Red and white stripes with a blue canton of white dots (2:1 aspect). */
export function getUsFlagTex(): THREE.Texture {
  if (flagTex) return flagTex;
  const [c, g] = canvas(256, 128);
  const sh = 128 / 13;
  for (let i = 0; i < 13; i++) {
    g.fillStyle = i % 2 ? '#ffffff' : RALLY_RED;
    g.fillRect(0, i * sh, 256, sh + 0.5);
  }
  g.fillStyle = RALLY_BLUE;
  g.fillRect(0, 0, 108, sh * 7);
  g.fillStyle = '#ffffff';
  for (let r = 0; r < 7; r++) {
    for (let k = 0; k < 9; k++) {
      if ((r + k) % 2) continue;
      g.beginPath();
      g.arc(8 + k * 11.5, 6 + r * 9.6, 2.6, 0, Math.PI * 2);
      g.fill();
    }
  }
  flagTex = tex(c);
  return flagTex;
}

let buntingTex: THREE.Texture | null = null;
/** One draped swag (blue band with white dots over white over red), transparent below; repeats along U. */
export function getBuntingTex(): THREE.Texture {
  if (buntingTex) return buntingTex;
  const [c, g] = canvas(256, 128);
  g.clearRect(0, 0, 256, 128);
  const band = (r: number, color: string) => {
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(256, 0);
    g.ellipse(128, 0, 128, r, 0, 0, Math.PI, false);
    g.closePath();
    g.fillStyle = color;
    g.fill();
  };
  band(124, RALLY_RED);
  band(92, '#ffffff');
  band(62, RALLY_RED);
  band(40, RALLY_BLUE);
  g.fillStyle = '#ffffff';
  for (let k = 0; k < 7; k++) {
    g.beginPath();
    g.arc(56 + k * 24, 14 + (k % 2) * 8, 4, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = RALLY_GOLD;
  g.fillRect(0, 0, 256, 7);
  buntingTex = tex(c, true);
  buntingTex.wrapT = THREE.ClampToEdgeWrapping;
  return buntingTex;
}

/** Crowd-sign / banner slogans: [text, background, ink]. */
export const RALLY_SIGNS: [string, string, string][] = [
  ['MAKE SNOW\nGREAT AGAIN', RALLY_RED, '#ffffff'],
  ['PLOW THE\nSWAMP', '#ffffff', RALLY_BLUE],
  ['4 MORE\nROUNDS', RALLY_BLUE, '#ffffff'],
  ['TREMENDOUS!', '#ffffff', RALLY_RED],
  ['BUILD THE\nWALL', RALLY_RED, '#ffffff'],
  ['SNOW\nBIGLY', RALLY_BLUE, RALLY_GOLD],
  ['#1 PLOW', '#ffffff', RALLY_RED],
  ['FAKE SNOW!', RALLY_RED, '#ffffff'],
  ['BEST\nBLIZZARD EVER', '#ffffff', RALLY_BLUE],
  ['HUGE BLADE', RALLY_BLUE, '#ffffff'],
];
const ATLAS_COLS = 2;
const ATLAS_ROWS = 5;

let signTex: THREE.Texture | null = null;
/** All slogans in one 2x5 atlas (one material for every sign and banner). */
export function getSignAtlas(): THREE.Texture {
  if (signTex) return signTex;
  const W = 1024;
  const H = 1024;
  const [c, g] = canvas(W, H);
  const cw = W / ATLAS_COLS;
  const ch = H / ATLAS_ROWS;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  RALLY_SIGNS.forEach(([text, bg, ink], i) => {
    const x = (i % ATLAS_COLS) * cw;
    const y = Math.floor(i / ATLAS_COLS) * ch;
    g.fillStyle = bg;
    g.fillRect(x, y, cw, ch);
    g.lineWidth = 10;
    g.strokeStyle = bg === '#ffffff' ? RALLY_RED : '#ffffff';
    g.strokeRect(x + 9, y + 9, cw - 18, ch - 18);
    g.fillStyle = ink;
    const lines = text.split('\n');
    const size = lines.length > 1 ? 70 : 86;
    g.font = `900 ${size}px "Arial Black", Impact, sans-serif`;
    lines.forEach((l, k) => g.fillText(l, x + cw / 2, y + ch / 2 + (k - (lines.length - 1) / 2) * size * 1.02, cw - 44));
  });
  signTex = tex(c);
  signTex.anisotropy = 8;
  return signTex;
}

/** UV rect [u0, v0, u1, v1] of slogan i in the atlas. */
export function signUv(i: number): [number, number, number, number] {
  const k = ((i % RALLY_SIGNS.length) + RALLY_SIGNS.length) % RALLY_SIGNS.length;
  const col = k % ATLAS_COLS;
  const row = Math.floor(k / ATLAS_COLS);
  const u0 = col / ATLAS_COLS;
  const u1 = (col + 1) / ATLAS_COLS;
  const v1 = 1 - row / ATLAS_ROWS;
  const v0 = 1 - (row + 1) / ATLAS_ROWS;
  return [u0, v0, u1, v1];
}

/** A plane (w x h, centred, facing +Z) mapped to slogan i. */
export function signPlane(w: number, h: number, i: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const [u0, v0, u1, v1] = signUv(i);
  const uv = g.getAttribute('uv');
  for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0));
  return g;
}

let backdropTex: THREE.Texture | null = null;
/** The stage backdrop: navy with gold stars, a giant gold "THE DONALD" and red / white stripes at the foot. */
export function getBackdropTex(): THREE.Texture {
  if (backdropTex) return backdropTex;
  const W = 2048;
  const H = 820;
  const [c, g] = canvas(W, H);
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#16285e');
  bg.addColorStop(1, '#0d1a40');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // stripes at the foot
  for (let i = 0; i < 6; i++) {
    g.fillStyle = i % 2 ? '#ffffff' : RALLY_RED;
    g.fillRect(0, H - 150 + i * 25, W, 25);
  }
  // star field
  g.fillStyle = 'rgba(255,255,255,0.85)';
  const star = (x: number, y: number, r: number) => {
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const rr = k % 2 ? r * 0.42 : r;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
  };
  for (let i = 0; i < 26; i++) star(80 + i * 76, 70, 18);
  // gold frame
  g.lineWidth = 18;
  g.strokeStyle = RALLY_GOLD;
  g.strokeRect(12, 12, W - 24, H - 24);
  // THE DONALD in big gold block letters with a dark outline + highlight
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '900 330px "Arial Black", Impact, sans-serif';
  g.lineJoin = 'round';
  g.lineWidth = 26;
  g.strokeStyle = '#5a3a00';
  g.strokeText('THE DONALD', W / 2, 360, W - 140);
  const gold = g.createLinearGradient(0, 220, 0, 500);
  gold.addColorStop(0, '#fff2b0');
  gold.addColorStop(0.45, '#f2c033');
  gold.addColorStop(1, '#b07a10');
  g.fillStyle = gold;
  g.fillText('THE DONALD', W / 2, 360, W - 140);
  g.font = '900 64px "Arial Black", Impact, sans-serif';
  g.fillStyle = '#ffffff';
  g.fillText('★  MAKE SNOW GREAT AGAIN  ★', W / 2, 590, W - 200);
  backdropTex = tex(c);
  backdropTex.anisotropy = 8;
  return backdropTex;
}

let carpetTex: THREE.Texture | null = null;
/** Red carpet with gold edges (repeats along V). */
export function getCarpetTex(): THREE.Texture {
  if (carpetTex) return carpetTex;
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#b30d26';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 0; y < 64; y += 8) g.fillRect(8, y, 48, 3);
  g.fillStyle = RALLY_GOLD;
  g.fillRect(0, 0, 6, 64);
  g.fillRect(58, 0, 6, 64);
  carpetTex = tex(c, true);
  return carpetTex;
}
