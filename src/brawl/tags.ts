import * as THREE from 'three';

/* Floating name tag (gamer tag + HP bar + streak flame / bounty crown) and taunt speech bubble.
 * Canvas sprites, redrawn only when what they show changes. Scaled by camera distance so they stay
 * readable across the huge arena. */

const TAG_W = 320;
const TAG_H = 112;

export class NameTag {
  readonly sprite: THREE.Sprite;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private key = '';
  private name: string;
  private color: string;

  constructor(name: string, color: string) {
    this.name = name;
    this.color = color;
    this.canvas = document.createElement('canvas');
    this.canvas.width = TAG_W;
    this.canvas.height = TAG_H;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    const mat = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false });
    this.sprite = new THREE.Sprite(mat);
    this.sprite.center.set(0.5, 0);
    this.sprite.renderOrder = 20;
  }

  /** Redraws if anything visible changed. hpFrac 0..1. */
  set(hpFrac: number, streak: number, protectedNow: boolean): void {
    const hpq = Math.max(0, Math.min(40, Math.ceil(hpFrac * 40)));
    const key = `${hpq}|${streak}|${protectedNow ? 1 : 0}`;
    if (key === this.key) return;
    this.key = key;
    const g = this.g;
    g.clearRect(0, 0, TAG_W, TAG_H);
    const bounty = streak >= 5;
    const flame = streak >= 3;

    // Crown / bounty glow row.
    if (bounty) {
      g.save();
      g.shadowColor = '#ffd23a';
      g.shadowBlur = 18;
      g.font = '28px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.fillText('👑', TAG_W / 2, 0);
      g.restore();
    }

    // Name.
    let size = 34;
    g.font = `900 ${size}px "Trebuchet MS", system-ui, sans-serif`;
    const prefix = flame ? `🔥${streak} ` : '';
    let w = g.measureText(prefix + this.name).width;
    while (w > TAG_W - 12 && size > 18) {
      size -= 2;
      g.font = `900 ${size}px "Trebuchet MS", system-ui, sans-serif`;
      w = g.measureText(prefix + this.name).width;
    }
    const y = 64;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    let x = (TAG_W - w) / 2;
    g.lineJoin = 'round';
    if (prefix) {
      g.lineWidth = 6;
      g.strokeStyle = 'rgba(0,0,0,0.85)';
      g.strokeText(prefix, x, y);
      g.fillStyle = bounty ? '#ffd23a' : '#ff8a2a';
      g.fillText(prefix, x, y);
      x += g.measureText(prefix).width;
    }
    if (bounty) {
      g.save();
      g.shadowColor = '#ffd23a';
      g.shadowBlur = 14;
    }
    g.lineWidth = 7;
    g.strokeStyle = 'rgba(0,0,0,0.9)';
    g.strokeText(this.name, x, y);
    g.fillStyle = protectedNow ? '#ffffff' : this.color;
    g.fillText(this.name, x, y);
    if (bounty) g.restore();

    // HP bar.
    const bw = 200;
    const bh = 14;
    const bx = (TAG_W - bw) / 2;
    const by = 76;
    g.fillStyle = 'rgba(0,0,0,0.75)';
    g.fillRect(bx - 3, by - 3, bw + 6, bh + 6);
    g.fillStyle = '#2b2f36';
    g.fillRect(bx, by, bw, bh);
    const f = hpq / 40;
    g.fillStyle = f > 0.6 ? '#4ade5a' : f > 0.3 ? '#ffd23a' : '#ff4a3a';
    g.fillRect(bx, by, bw * f, bh);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(bx, by, bw * f, 4);
    if (protectedNow) {
      g.strokeStyle = '#9fe6ff';
      g.lineWidth = 3;
      g.strokeRect(bx - 2, by - 2, bw + 4, bh + 4);
    }
    this.tex.needsUpdate = true;
  }

  /** Position above the vehicle; scale by distance to camera so it stays readable. */
  place(x: number, y: number, z: number, cam: THREE.Vector3): void {
    this.sprite.position.set(x, y, z);
    const d = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
    const h = Math.min(4.2, Math.max(0.95, 0.55 + d * 0.036));
    this.sprite.scale.set((h * TAG_W) / TAG_H, h, 1);
  }

  dispose(): void {
    this.tex.dispose();
    (this.sprite.material as THREE.SpriteMaterial).dispose();
  }
}

const B_W = 300;
const B_H = 84;

export class SpeechBubble {
  readonly sprite: THREE.Sprite;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  t = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = B_W;
    this.canvas.height = B_H;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    const mat = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false });
    this.sprite = new THREE.Sprite(mat);
    this.sprite.center.set(0.5, 0);
    this.sprite.renderOrder = 21;
    this.sprite.visible = false;
  }

  show(text: string, seconds = 2.6): void {
    const g = this.g;
    g.clearRect(0, 0, B_W, B_H);
    let size = 30;
    g.font = `800 ${size}px "Trebuchet MS", system-ui, sans-serif`;
    let w = g.measureText(text).width;
    while (w > B_W - 40 && size > 14) {
      size -= 2;
      g.font = `800 ${size}px "Trebuchet MS", system-ui, sans-serif`;
      w = g.measureText(text).width;
    }
    const bw = Math.min(B_W - 8, w + 32);
    const bx = (B_W - bw) / 2;
    const bh = 54;
    const r = 16;
    g.fillStyle = 'rgba(255,255,255,0.96)';
    g.strokeStyle = 'rgba(20,24,32,0.9)';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(bx + r, 4);
    g.lineTo(bx + bw - r, 4);
    g.quadraticCurveTo(bx + bw, 4, bx + bw, 4 + r);
    g.lineTo(bx + bw, 4 + bh - r);
    g.quadraticCurveTo(bx + bw, 4 + bh, bx + bw - r, 4 + bh);
    g.lineTo(B_W / 2 + 10, 4 + bh);
    g.lineTo(B_W / 2 - 4, B_H - 4);
    g.lineTo(B_W / 2 - 8, 4 + bh);
    g.lineTo(bx + r, 4 + bh);
    g.quadraticCurveTo(bx, 4 + bh, bx, 4 + bh - r);
    g.lineTo(bx, 4 + r);
    g.quadraticCurveTo(bx, 4, bx + r, 4);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#141820';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, B_W / 2, 4 + bh / 2 + 1);
    this.tex.needsUpdate = true;
    this.t = seconds;
    this.sprite.visible = true;
  }

  hide(): void {
    this.t = 0;
    this.sprite.visible = false;
  }

  place(x: number, y: number, z: number, cam: THREE.Vector3): void {
    this.sprite.position.set(x, y, z);
    const d = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
    const h = Math.min(4, Math.max(0.9, 0.5 + d * 0.034));
    this.sprite.scale.set((h * B_W) / B_H, h, 1);
  }

  dispose(): void {
    this.tex.dispose();
    (this.sprite.material as THREE.SpriteMaterial).dispose();
  }
}
