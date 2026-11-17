import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { currentPreset } from '../../core/settings';

/* PHANTOM's WRAITH CLAWS (the REAP's visual; vehicles/revenant.ts owns them). Two monstrous skeletal claws live in
 * glowing rifts on the hood's front corners. THE HAND IS THE STAR: a broad bony palm with spurs on its back and a
 * spiked wrist, three long two-boned fingers and a thumb, each ending in a scythe-curved, hooked, glowing TALON longer
 * than the finger bones (hand + talons are about half the reach). Behind it one thick ridged forearm bone with spurs
 * and an elbow spike, and no upper arm at all: torn ectoplasm tatters stream from the elbow back into the rift, like a
 * wraith's cloak sleeve, so it reads as a claw reaching out of mist. Bones are near-black violet with a bright fresnel
 * rim and glowing cracks (a matcap plus a crack map added as light), the talons hot lilac with a dark edge, so the
 * claw reads on sunlit snow AND at night; everything flickers with ghostfire.
 *
 * Animation (procedural, per arm, on the arm's own side): a sweep of that side makes the claw surge out of its rift
 * and cock back with the talons raised (anticipation), RAKE across the front arc low and fast with the talons fanned
 * wide and dragging (the wrist leads, the fingers trail, then whip through), SNAP SHUT into a grab at the end of the
 * stroke (outer fingers first), then pull back in. The talon tips reach the end of the Reap arc (REAP_ORIGIN +
 * reach), so the claw scales with the reach. The big Reap comes after a longer wait (combat/revenant.ts BIG_WIND):
 * through it both claws rear back high and wide, trembling (`bigWind`), then crash across together, crossing in front
 * of the nose (one over the other), with a flash. Held SPACE keeps them half out, hooked and twitching, between rakes;
 * idle, only the rifts glow. Hand poses are analytic (tip target + hand orientation + finger curl / spread), so the
 * talon trails are sampled exactly along the tips' past path (no per-frame history); a two-bone IK (low, outward
 * elbow) places the forearm.
 *
 * Geometry: per arm a few InstancedMeshes (forearm, hand, phalanges, talons, talon glow) plus two dynamic strips
 * (ectoplasm tatters, talon trails), all built once, under a root mirrored on X for the right arm (one canonical
 * left arm is solved). They stay `visible` (count 0 / an empty draw range when hidden) so the shader warm-up compiles
 * them with the plow. Nothing is allocated per frame. */

/** Spectral palette (vehicles/revenant.ts REV_*; repeated here to keep this module free of an import cycle). */
const C_CORE = 0xb04dff;
const C_BRIGHT = 0xe0a8ff;

/** The Reap's origin ahead of the plow's centre (combat/revenant.ts REAP_FWD) and the arc's height above the floor. */
export const REAP_ORIGIN = 1.2;
const ARC_Y = 1.0;
/** Big Reap: reach (and arc) multiplier (combat/revenant.ts). */
export const REAP_BIG_WIDTH = 1.2;
/** Reach (m) the claw is modelled at (scale 1). */
const BASE_REACH = 7;
/** Rift (shoulder socket) of the canonical (+x, left) arm, model space; and where the shoulder lunges to mid-rake. */
export const CLAW_SOCKET = new THREE.Vector3(0.78, 1.24, 1.5);
const SURGE_TO = new THREE.Vector3(0.62, 1.5, 2.55);
/** Lengths at scale 1 (m): the upper arm (ectoplasm: the IK's first bone, never drawn as bone) and the forearm. */
const UPPER_L = 1.75;
const FORE_L = 1.9;
/** Elbow pole (canonical): out, a little up and back. A low elbow: no tall mantis arch. */
const POLE = new THREE.Vector3(0.92, 0.22, -0.32).normalize();
/** Longest IK stretch (spectral arms give a little) before the wrist falls short. */
const MAX_STRETCH = 1.22;

/** Rake timeline (share of the rake): wind-up ends, strike ends, grab ends; then the pull back in. */
const UA = 0.13;
const UB = 0.5;
const UC = 0.66;
/** Rake length (s) and its share of the gap between sweeps when they come faster (Overclock). */
const RAKE_TIME = 0.36;
const RAKE_SHARE = 0.92;
/** Strike: start / end angle (rad from the nose, + = the arm's own side), grab pull-in. */
const PHI_COCK = 1.62;
const PHI_END = -0.86;
const PHI_GRAB = -1.05;
/** Big Reap wind-up: where the reared claws wait (angle, share of the reach, height). */
const PHI_REAR = 1.85;

/* ---- the hand (hand-local: +z along the fingers, +y the back of the hand, palm down; canonical LEFT hand, so the
 * thumb is on -x). Units: m at scale 1. */
interface Digit {
  /** Root (knuckle) position, hand-local. */
  root: THREE.Vector3;
  /** Base orientation (splay for fingers; the thumb's own yaw / pitch / roll). */
  yaw: number;
  pitch: number;
  roll: number;
  /** Splay added at full spread. */
  splay: number;
  /** Phalanx lengths, talon length. */
  len: number[];
  talon: number;
  /** Joint angles (rad, + = toward the palm): rest + per unit curl (one per phalanx and the talon). */
  rest: number[];
  curl: number[];
  /** Grab ripple: this digit closes this much (share of the grab) later than the first. */
  lag: number;
}
const FINGERS: Digit[] = [
  // inner (thumb side), middle, outer
  { root: new THREE.Vector3(-0.29, 0.0, 0.8), yaw: -0.16, pitch: 0, roll: 0.12, splay: -0.46, len: [0.56, 0.44], talon: 1.05, rest: [0.04, 0.16, 0.12], curl: [0.95, 1.15, 0.55], lag: 0.25 },
  { root: new THREE.Vector3(0.0, 0.03, 0.9), yaw: 0, pitch: 0, roll: 0, splay: 0, len: [0.62, 0.5], talon: 1.18, rest: [0.04, 0.16, 0.12], curl: [0.95, 1.15, 0.55], lag: 0.12 },
  { root: new THREE.Vector3(0.29, 0.0, 0.8), yaw: 0.16, pitch: 0, roll: -0.12, splay: 0.46, len: [0.56, 0.44], talon: 1.05, rest: [0.04, 0.16, 0.12], curl: [0.95, 1.15, 0.55], lag: 0 },
];
const THUMB: Digit = { root: new THREE.Vector3(-0.34, -0.05, 0.22), yaw: -1.0, pitch: 0.2, roll: -0.55, splay: -0.32, len: [0.46, 0.36], talon: 0.92, rest: [0.1, 0.18, 0.15], curl: [0.65, 0.95, 0.5], lag: 0.35 };
const DIGITS = [...FINGERS, THUMB];
const N_DIG = DIGITS.length;
const N_PHAL = DIGITS.reduce((n, d) => n + d.len.length, 0);
/** Talon hook (rad of bend over its length): the tip sits at (0, TIP_Y, TIP_Z) x its length in talon space. */
const HOOK = 1.35;
const TIP_Y = (Math.cos(HOOK) - 1) / HOOK;
const TIP_Z = Math.sin(HOOK) / HOOK;
/** Nominal phalanx length its geometry is built at (instances stretch along it). */
const PHAL_NOM = 0.55;
/** The finger pose the hand is placed by (its middle talon tip rides the target): mid-strike curl and spread. */
const REF_CURL = 0.12;
const REF_SPREAD = 1;

/** A hand / arm pose (canonical model space): middle talon-tip target, hand yaw (rad from +z toward +x), pitch (+ =
 *  fingers down), roll, finger curl 0..1, spread 0..1, grab ripple 0..1 (the outer fingers close first), how far the
 *  arm is out of its rift (scales it), opacity, shoulder surge 0..1. */
interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  curl: number;
  spread: number;
  ripple: number;
  emerge: number;
  alpha: number;
  surge: number;
}
const pose = (): Pose => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, curl: 0, spread: 0, ripple: 0, emerge: 0, alpha: 0, surge: 0 });
function setPose(p: Pose, x: number, y: number, z: number, yaw: number, pitch: number, roll: number, curl: number, spread: number, emerge: number, alpha: number, surge: number, ripple = 0): Pose {
  p.x = x;
  p.y = y;
  p.z = z;
  p.yaw = yaw;
  p.pitch = pitch;
  p.roll = roll;
  p.curl = curl;
  p.spread = spread;
  p.emerge = emerge;
  p.alpha = alpha;
  p.surge = surge;
  p.ripple = ripple;
  return p;
}
function mixPose(out: Pose, a: Pose, b: Pose, w: number): Pose {
  const l = (p: number, q: number) => p + (q - p) * w;
  return setPose(out, l(a.x, b.x), l(a.y, b.y), l(a.z, b.z), l(a.yaw, b.yaw), l(a.pitch, b.pitch), l(a.roll, b.roll), l(a.curl, b.curl), l(a.spread, b.spread), l(a.emerge, b.emerge), l(a.alpha, b.alpha), l(a.surge, b.surge), l(a.ripple, b.ripple));
}
function copyPose(out: Pose, a: Pose): Pose {
  return mixPose(out, a, a, 0);
}

/** Rest poses (scale 1, canonical): tucked in the rift (hidden), half out over the front corner (SPACE held), and
 *  the garage's display pose (raised, splayed). */
const RETRACT = setPose(pose(), CLAW_SOCKET.x + 0.25, CLAW_SOCKET.y + 0.2, CLAW_SOCKET.z + 0.6, 0.5, 0.6, 0, 0.85, 0.2, 0.15, 0, 0);
const HOLD = setPose(pose(), 2.05, 1.75, 3.85, 0.42, 0.18, -0.2, 0.42, 0.7, 0.56, 0.95, 0.2);
const DISPLAY = setPose(pose(), 2.25, 2.05, 4.25, 0.5, 0.02, -0.25, 0.28, 0.95, 0.62, 1, 0.3);

/* ---- scratch (no per-frame allocation) */
const _q = new THREE.Quaternion();
const _qh = new THREE.Quaternion();
const _qd = new THREE.Quaternion();
const _qj = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _mb = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _sc = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n1 = new THREE.Vector3();
const _n2 = new THREE.Vector3();
const _S = new THREE.Vector3();
const _W = new THREE.Vector3();
const _E = new THREE.Vector3();
const _T = new THREE.Vector3();
const _F = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const _p0 = pose();
const _p1 = pose();
const _p2 = pose();
const _pb = pose();
const _pt = pose();
const _pw = pose();
/** Per digit: joint points (root .. talon base) and the talon tip, hand-local (filled by digitFK). */
const JOINTS: THREE.Vector3[][] = DIGITS.map((d) => Array.from({ length: d.len.length + 2 }, () => new THREE.Vector3()));
/** Per digit: the cumulative joint angle at each phalanx and at the talon (filled by digitFK). */
const ANGLES: number[][] = DIGITS.map((d) => new Array<number>(d.len.length + 1).fill(0));

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number) => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};

/** Hand orientation of a pose. */
function handQuat(p: Pose, out: THREE.Quaternion): THREE.Quaternion {
  _e.set(p.pitch, p.yaw, p.roll, 'YXZ');
  return out.setFromEuler(_e);
}

/** A digit's base orientation at `spread`. */
function digitQuat(d: Digit, spread: number, out: THREE.Quaternion): THREE.Quaternion {
  _e.set(d.pitch, d.yaw + d.splay * spread, d.roll, 'YXZ');
  return out.setFromEuler(_e);
}

/** A digit's curl in a pose: the grab ripple closes the outer fingers first. */
function digitCurl(i: number, p: Pose, twitch: number): number {
  const c = p.curl - DIGITS[i].lag * p.ripple + twitch;
  return c < 0 ? 0 : c > 1.05 ? 1.05 : c;
}

/** Forward kinematics of digit `i` at `curl` / `spread` (hand-local, scale 1) into JOINTS[i] (root, each phalanx's
 *  end, the last being the talon base, then the talon tip) and ANGLES[i]. */
function digitFK(i: number, curl: number, spread: number): void {
  const d = DIGITS[i];
  const J = JOINTS[i];
  const A = ANGLES[i];
  digitQuat(d, spread, _qd);
  J[0].copy(d.root);
  let a = 0;
  const n = d.len.length;
  for (let k = 0; k < n; k++) {
    a += d.rest[k] + d.curl[k] * curl;
    A[k] = a;
    _a.set(0, -Math.sin(a), Math.cos(a)).multiplyScalar(d.len[k]).applyQuaternion(_qd);
    J[k + 1].copy(J[k]).add(_a);
  }
  a += d.rest[n] + d.curl[n] * curl;
  A[n] = a;
  const c = Math.cos(a);
  const s = Math.sin(a);
  _a.set(0, TIP_Y * c - TIP_Z * s, TIP_Y * s + TIP_Z * c).multiplyScalar(d.talon).applyQuaternion(_qd);
  J[n + 1].copy(J[n]).add(_a);
}

/** The middle talon tip, hand-local, at the reference curl / spread (the hand is placed so it rides the target). */
digitFK(1, REF_CURL, REF_SPREAD);
const REF_TIP = JOINTS[1][JOINTS[1].length - 1].clone();

/* ---- geometry (built once) */

/** Orient-and-place helper for building merged parts: +y of `g` along `dir` at `at`. Returns non-indexed. */
function place(g: THREE.BufferGeometry, at: THREE.Vector3, dir: THREE.Vector3): THREE.BufferGeometry {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  g.applyQuaternion(q);
  g.translate(at.x, at.y, at.z);
  const out = g.index ? g.toNonIndexed() : g;
  return out;
}
/** A jagged spike (base at the origin, pointing +y): a 5-sided cone, a touch bent. */
function spike(h: number, r: number): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, 5, 2);
  g.translate(0, h / 2, 0);
  // bend the upper half a little (a hooked spur, not a cone)
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / h;
    p.setZ(i, p.getZ(i) - 0.22 * h * t * t);
  }
  g.computeVertexNormals();
  return g;
}
/** A lathe bone along +y 0..1 from a (radius, y) profile. */
function lathe(prof: number[][], radial: number): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    prof.map(([r, y]) => new THREE.Vector2(r, y)),
    radial,
  );
}
/** Lathe bone from `a` to `b` (radius scale `r`). */
function boneBetween(prof: number[][], a: THREE.Vector3, b: THREE.Vector3, r: number, radial = 6): THREE.BufferGeometry {
  const d = b.clone().sub(a);
  const g = lathe(prof, radial);
  g.scale(r, d.length(), r);
  return place(g, a, d);
}
const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  for (const g of parts) for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  const m = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  return m;
};

/** Knobbly bone profile (radius 1 at the ends, a slim shaft). */
const BONE_PROF = [
  [0.01, 0],
  [0.85, 0.03],
  [1, 0.1],
  [0.6, 0.24],
  [0.5, 0.55],
  [0.62, 0.84],
  [0.92, 0.95],
  [0.01, 1],
];

/** A phalanx: a knuckled bone along +z (0..1 after the instance's length scale; m across at scale 1) with a jagged
 *  spur on the knuckle (back of the finger, +y). */
function phalanxGeometry(): THREE.BufferGeometry {
  const L = PHAL_NOM;
  const parts = [boneBetween(BONE_PROF, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, L), 0.12, 7)];
  parts.push(place(spike(0.26, 0.055), new THREE.Vector3(0, 0.07, 0.07), new THREE.Vector3(0, 1, -0.75)));
  parts.push(place(spike(0.12, 0.03), new THREE.Vector3(0.05, 0.05, L * 0.55), new THREE.Vector3(0.5, 1, -0.6)));
  const g = merge(parts);
  g.scale(1, 1, 1 / L);
  return g;
}

/** The hand: a broad bony palm (wrist at the origin, knuckles toward +z, the back +y) with metacarpal ridges, jagged
 *  spurs on the knuckles and the back, and a crown of spikes round the wrist. m at scale 1. */
function handGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // The palm slab: a tapered, arched box, wrist (0.44 wide) to knuckles (0.84).
  const box = new THREE.BoxGeometry(1, 1, 1, 4, 1, 4);
  const p = box.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i) + 0.5; // 0..1
    const w = 0.44 + 0.4 * z;
    const x = p.getX(i) * w;
    const arch = 0.07 * (1 - (2 * x / w) ** 2);
    const y = p.getY(i) * (0.2 - 0.06 * z) + arch;
    p.setXYZ(i, x, y, z * 0.86);
  }
  box.computeVertexNormals();
  parts.push(box.toNonIndexed());
  // Metacarpal ridges, wrist to each knuckle; knuckle knobs and spurs.
  for (const f of FINGERS) {
    const a = new THREE.Vector3(f.root.x * 0.35, 0.1, 0.02);
    const b = new THREE.Vector3(f.root.x, 0.08, f.root.z - 0.02);
    parts.push(boneBetween(BONE_PROF, a, b, 0.075));
    const kn = new THREE.IcosahedronGeometry(0.11, 0);
    kn.translate(f.root.x, 0.04, f.root.z - 0.02);
    parts.push(kn);
    parts.push(place(spike(0.34, 0.065), new THREE.Vector3(f.root.x, 0.12, f.root.z - 0.06), new THREE.Vector3(f.root.x * 0.6, 1, -0.7)));
  }
  // Jagged spikes on the back of the hand.
  const backs: [number, number, number, number, number][] = [
    [-0.16, 0.42, 0.46, -0.35, 0.08],
    [0.13, 0.52, 0.56, 0.3, 0.085],
    [0.0, 0.2, 0.4, 0.0, 0.075],
    [0.28, 0.24, 0.3, 0.8, 0.06],
  ];
  for (const [x, z, h, cant, r] of backs) parts.push(place(spike(h, r), new THREE.Vector3(x, 0.1, z), new THREE.Vector3(cant, 1, -0.85)));
  // The spiked wrist: a knob and a crown of spikes raking back.
  const knob = new THREE.IcosahedronGeometry(0.2, 1);
  knob.scale(1.2, 0.85, 1);
  parts.push(knob);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.2;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    const up = cy > 0 ? 1 : 0.6;
    parts.push(place(spike(0.36 * up, 0.06), new THREE.Vector3(cx * 0.2, cy * 0.15, -0.04), new THREE.Vector3(cx, cy, -1.1)));
  }
  return merge(parts);
}

/** The forearm: one thick, ridged, hexagonal bone along +z (0 = elbow .. 1 = wrist after the instance's length scale;
 *  m across at scale 1) with spurs on its outside (+y, the bend's outside) and a big elbow spike raking back. */
function forearmGeometry(): THREE.BufferGeometry {
  const L = FORE_L;
  const prof: number[][] = [
    [0.01, 0],
    [0.2, 0.01],
    [0.27, 0.06],
    [0.22, 0.14],
    [0.165, 0.24],
    [0.19, 0.33],
    [0.15, 0.44],
    [0.175, 0.55],
    [0.14, 0.66],
    [0.165, 0.77],
    [0.15, 0.87],
    [0.21, 0.96],
    [0.01, 1],
  ].map(([r, y]) => [r, y]);
  const shaft = lathe(prof, 6);
  shaft.scale(1, L, 0.82);
  const parts = [place(shaft, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1))];
  // The elbow spike, and a smaller one under it.
  parts.push(place(spike(0.85, 0.13), new THREE.Vector3(0, 0.08, 0.06), new THREE.Vector3(0, 0.55, -1)));
  parts.push(place(spike(0.42, 0.08), new THREE.Vector3(0.1, -0.06, 0.1), new THREE.Vector3(0.6, -0.4, -1)));
  // Spurs along the outside, raking back toward the elbow.
  const spurs: [number, number, number, number][] = [
    [0.36, 0.42, 0.08, 0],
    [0.78, 0.36, 0.07, 0.35],
    [1.18, 0.3, 0.06, -0.3],
    [1.5, 0.24, 0.05, 0.2],
  ];
  for (const [z, h, r, side] of spurs) parts.push(place(spike(h, r), new THREE.Vector3(side * 0.1, 0.13, z), new THREE.Vector3(side, 1, -0.75)));
  // A ridge of small teeth along the inside.
  for (const z of [0.55, 0.95, 1.35]) parts.push(place(spike(0.16, 0.04), new THREE.Vector3(0, -0.13, z), new THREE.Vector3(0, -1, -0.6)));
  const g = merge(parts);
  g.scale(1, 1, 1 / L);
  return g;
}

/** Hooked talon: length 1 along +z bending down (-y) by HOOK, base radius `r`, tapering to a needle point; a
 *  blade-like section (narrow side to side, a keel along the inner, cutting edge). */
function talonGeometry(r: number): THREE.BufferGeometry {
  const seg = 9;
  const rad = 7;
  const pts: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= seg; j++) {
    const t = j / seg;
    const a = HOOK * t;
    // centre line (bent arc) and its normal in the yz plane
    const cy = (Math.cos(a) - 1) / HOOK;
    const cz = Math.sin(a) / HOOK;
    const ny = Math.cos(a);
    const nz = Math.sin(a);
    const rr = r * (1 - t) ** 0.8 * (t < 0.1 ? 0.8 + 2 * t : 1);
    for (let k = 0; k < rad; k++) {
      const th = (k / rad) * Math.PI * 2;
      const sn = Math.sin(th);
      // blade: narrow side to side, the inner (-y) side drawn to a keel
      const ox = Math.cos(th) * rr * 0.5 * (sn < 0 ? 1 + sn * 0.6 : 1);
      const oy = sn * rr * (sn < 0 ? 1.25 : 1);
      pts.push(ox, cy + oy * ny, cz + oy * nz);
    }
  }
  for (let j = 0; j < seg; j++)
    for (let k = 0; k < rad; k++) {
      const a = j * rad + k;
      const b = j * rad + ((k + 1) % rad);
      idx.push(a, a + rad, b, b, a + rad, b + rad);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Radial-gradient matcap from colour stops (centre .. rim) over a rim colour. */
function matcapFrom(stops: [number, string][], rim: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = rim;
  g.fillRect(0, 0, 128, 128);
  const grd = g.createRadialGradient(64, 60, 4, 64, 64, 64);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.beginPath();
  g.arc(64, 64, 64, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let texCache: { bone: THREE.CanvasTexture | null; talon: THREE.CanvasTexture | null; crack: THREE.CanvasTexture | null; haze: THREE.CanvasTexture | null } | undefined;
/** Bone matcap (near-black violet facing you, a bright lilac fresnel rim), talon matcap (white-hot lilac core, a
 *  dark violet edge so it reads on snow), the glowing crack map. */
function textures() {
  if (texCache) return texCache;
  const bone = matcapFrom(
    [
      [0, '#1a0830'],
      [0.5, '#22093e'],
      [0.7, '#3e1470'],
      [0.83, '#8a3ee8'],
      [0.93, '#e2b4ff'],
      [0.99, '#fbeaff'],
    ],
    '#fbeaff',
  );
  const talon = matcapFrom(
    [
      [0, '#fff6ff'],
      [0.45, '#f0c8ff'],
      [0.7, '#c47cff'],
      [0.88, '#7a26d8'],
      [0.98, '#3a0c70'],
    ],
    '#3a0c70',
  );
  let crack: THREE.CanvasTexture | null = null;
  let haze: THREE.CanvasTexture | null = null;
  if (typeof document !== 'undefined') {
    // Cracks: jagged branching lines (deterministic), white on black; tiles round the lathe bones.
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, 256, 256);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let k = 0; k < 15; k++) {
      let x = rnd() * 256;
      let y = rnd() * 256;
      let a = rnd() * Math.PI * 2;
      g.strokeStyle = k % 3 ? '#b0b0b0' : '#ffffff';
      g.lineWidth = 1.2 + rnd() * 2;
      g.beginPath();
      g.moveTo(x, y);
      const steps = 6 + ((rnd() * 8) | 0);
      for (let s = 0; s < steps; s++) {
        a += (rnd() - 0.5) * 1.3;
        x += Math.cos(a) * 12;
        y += Math.sin(a) * 12;
        g.lineTo(x, y);
        if (rnd() < 0.2) {
          // a short branch
          g.moveTo(x, y);
          g.lineTo(x + Math.cos(a + 1.1) * 10, y + Math.sin(a + 1.1) * 10);
          g.moveTo(x, y);
        }
      }
      g.stroke();
    }
    crack = new THREE.CanvasTexture(c);
    crack.wrapS = crack.wrapT = THREE.RepeatWrapping;
    // Ectoplasm tatter: soft across, ragged and streaky along.
    const h = document.createElement('canvas');
    h.width = 64;
    h.height = 128;
    const hg = h.getContext('2d')!;
    hg.clearRect(0, 0, 64, 128);
    for (let k = 0; k < 26; k++) {
      const x = rnd() * 64;
      const w = 3 + rnd() * 9;
      const y0 = rnd() * 40;
      const y1 = 70 + rnd() * 58;
      const grd = hg.createLinearGradient(x - w, 0, x + w, 0);
      grd.addColorStop(0, 'rgba(255,255,255,0)');
      grd.addColorStop(0.5, `rgba(255,255,255,${0.25 + rnd() * 0.5})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      hg.fillStyle = grd;
      hg.fillRect(x - w, y0, w * 2, y1 - y0);
    }
    haze = new THREE.CanvasTexture(h);
    haze.wrapS = THREE.RepeatWrapping;
  }
  return (texCache = { bone, talon, crack, haze });
}

/** The bone material: the dark matcap, and the crack map ADDED as glowing light (`crackGlow`, flickered per frame). */
function boneMaterial(): { mat: THREE.MeshMatcapMaterial; glow: { value: THREE.Color } } {
  const tx = textures();
  const glow = { value: new THREE.Color(0.8, 0.35, 1.2) };
  const mat = new THREE.MeshMatcapMaterial({ matcap: tx.bone, map: tx.crack, color: tx.bone ? 0xffffff : 0x2a0c4a, transparent: true, opacity: 1, toneMapped: false });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.crackGlow = glow;
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform vec3 crackGlow;\nvoid main() {')
      .replace('#include <map_fragment>', '')
      .replace(
        'vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;',
        'vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;\n#ifdef USE_MAP\n\toutgoingLight += crackGlow * texture2D( map, vMapUv ).r;\n#endif',
      );
  };
  mat.customProgramCacheKey = () => 'wraithBone';
  return { mat, glow };
}

/** One arm's draw parts. */
interface ArmMeshes {
  root: THREE.Group;
  fore: THREE.InstancedMesh;
  hand: THREE.InstancedMesh;
  phal: THREE.InstancedMesh;
  talons: THREE.InstancedMesh;
  glow: THREE.InstancedMesh;
  tatters: THREE.Mesh;
  trail: THREE.Mesh;
  mats: { bone: THREE.MeshMatcapMaterial; crack: { value: THREE.Color }; talon: THREE.MeshMatcapMaterial; glow: THREE.MeshBasicMaterial; tatter: THREE.MeshBasicMaterial; trail: THREE.MeshBasicMaterial };
}

/** Per-arm animation state. */
interface ArmState {
  /** Rake: seconds since it began (-1 = none), length (s), big (both arms), this arm's flash fired. */
  t: number;
  dur: number;
  big: boolean;
  flashed: boolean;
}

/** Trail samples per talon (LOW: fewer) and the time they span (s). */
const TRAIL_N = 12;
const TRAIL_N_LOW = 6;
const TRAIL_SPAN = 0.12;
const TRAIL_SPAN_LOW = 0.08;
/** Ectoplasm tatters per arm (LOW: fewer) and points along each. */
const TAT_N = 7;
const TAT_N_LOW = 4;
const TAT_SEG = 10;

export interface ClawRigIn {
  /** Reap reach (m). */
  reach: number;
  /** Sweep counter (a change = a new sweep), the last sweep's side (+1 = the +x / left arm) and whether it was big. */
  reapN: number;
  reapSide: number;
  reapBig: boolean;
  /** SPACE held (Reap running): the arms wait half out between rakes. */
  held: boolean;
  /** 0..1 through the wait before a big Reap: both claws rear back. */
  bigWind: number;
  /** 0..1 PHASED. */
  phase: number;
  /** Garage / Paint Shop display: claws raised. */
  display: boolean;
}

export interface WraithClaws {
  /** Model-space root (add to the vehicle group). */
  group: THREE.Group;
  /** The two hood rifts (hidden with the hull when PHASED). */
  rifts: THREE.Group;
  update(dt: number, t: number, s: ClawRigIn): void;
  /** Snap to the parked display pose (menu backdrop: the rig is not updated there). */
  park(): void;
}

export function buildWraithClaws(): WraithClaws {
  const group = new THREE.Group();
  const tx = textures();
  const foreGeo = forearmGeometry();
  const handGeo = handGeometry();
  const phalGeo = phalanxGeometry();
  const talonGeo = talonGeometry(0.13);
  const glowGeo = talonGeometry(0.2);
  const low = () => currentPreset().fxScale < 1;

  const arms: ArmMeshes[] = [];
  const state: ArmState[] = [];
  for (const side of [1, -1]) {
    const root = new THREE.Group();
    root.scale.x = side;
    const { mat: bone, glow: crack } = boneMaterial();
    const talon = new THREE.MeshMatcapMaterial({ matcap: tx.talon, color: tx.talon ? 0xffffff : C_BRIGHT, transparent: true, opacity: 1, toneMapped: false });
    const glow = new THREE.MeshBasicMaterial({ color: C_CORE, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
    const tatter = new THREE.MeshBasicMaterial({ color: 0xffffff, map: tx.haze, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const trailMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const im = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, order: number) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.renderOrder = order;
      root.add(m);
      return m;
    };
    // Draw order: bones, talons, then the translucent tatters over the elbow, the talon glow and the trails.
    const fore = im(foreGeo, bone, 1, 3);
    const hand = im(handGeo, bone, 1, 3);
    const phal = im(phalGeo, bone, N_PHAL, 3);
    const talons = im(talonGeo, talon, N_DIG, 4);
    const glowM = im(glowGeo, glow, N_DIG, 6);
    // Tatters: TAT_N strips x TAT_SEG points x 2 edges.
    const sg = new THREE.BufferGeometry();
    const sv = TAT_N * TAT_SEG * 2;
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(sv * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const suv = new Float32Array(sv * 2);
    const sidx: number[] = [];
    for (let f = 0; f < TAT_N; f++)
      for (let j = 0; j < TAT_SEG; j++) {
        const q = (f * TAT_SEG + j) * 2;
        const u = (f * 0.37) % 1;
        suv.set([u, j / (TAT_SEG - 1), u + 0.3, j / (TAT_SEG - 1)], q * 2);
        if (j < TAT_SEG - 1) sidx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
      }
    sg.setAttribute('uv', new THREE.BufferAttribute(suv, 2));
    sg.setIndex(sidx);
    sg.setDrawRange(0, 0);
    const tatters = new THREE.Mesh(sg, tatter);
    tatters.frustumCulled = false;
    tatters.renderOrder = 5;
    root.add(tatters);
    // Talon trails: one strip per talon, TRAIL_N samples x 2 edges (tip, talon base).
    const tg = new THREE.BufferGeometry();
    const nv = N_DIG * TRAIL_N * 2;
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let f = 0; f < N_DIG; f++)
      for (let j = 0; j < TRAIL_N - 1; j++) {
        const q = (f * TRAIL_N + j) * 2;
        idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
      }
    tg.setIndex(idx);
    tg.setDrawRange(0, 0);
    const trail = new THREE.Mesh(tg, trailMat);
    trail.frustumCulled = false;
    trail.renderOrder = 7;
    root.add(trail);
    group.add(root);
    arms.push({ root, fore, hand, phal, talons, glow: glowM, tatters, trail, mats: { bone, crack, talon, glow, tatter, trail: trailMat } });
    state.push({ t: -1, dur: RAKE_TIME, big: false, flashed: false });
  }

  // ---- The rifts: a dark slit in the hood ringed in glow, with ghostfire wisps licking out of it.
  const rifts = new THREE.Group();
  const riftMat = new THREE.MeshBasicMaterial({ color: C_BRIGHT, toneMapped: false });
  const riftDark = new THREE.MeshBasicMaterial({ color: 0x07020e });
  const wispMat = new THREE.MeshBasicMaterial({ color: C_CORE, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const ringGeo = new THREE.TorusGeometry(1, 0.11, 4, 20);
  const slitGeo = new THREE.CircleGeometry(1, 20);
  const wispGeo = new THREE.ConeGeometry(0.07, 0.4, 6, 1, true).translate(0, 0.2, 0);
  const wisps: THREE.Mesh[] = [];
  for (const sx of [1, -1]) {
    const r = new THREE.Group();
    r.position.set(sx * CLAW_SOCKET.x, CLAW_SOCKET.y - 0.02, CLAW_SOCKET.z);
    // lie on the hood (it slopes down to the nose), the long axis fore-aft, canted out a little
    r.rotation.set(-Math.PI / 2 + 0.2, 0, sx * -0.12, 'XYZ');
    const ring = new THREE.Mesh(ringGeo, riftMat);
    ring.scale.set(0.16, 0.34, 0.16);
    const slit = new THREE.Mesh(slitGeo, riftDark);
    slit.scale.set(0.15, 0.32, 1);
    slit.position.z = 0.005;
    r.add(ring, slit);
    for (let k = 0; k < 3; k++) {
      const w = new THREE.Mesh(wispGeo, wispMat);
      // (the rift group is laid flat: its +z is the hood's up)
      w.rotation.x = Math.PI / 2;
      w.position.set((k - 1) * 0.06, (k - 1) * 0.14, 0.01);
      w.renderOrder = 2;
      r.add(w);
      wisps.push(w);
    }
    rifts.add(r);
  }
  group.add(rifts);

  // ---- Big Reap flash where the claws cross (a soft violet star, camera-facing).
  let flashTex: THREE.CanvasTexture | null = null;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,240,255,1)');
    grd.addColorStop(0.25, 'rgba(220,150,255,0.8)');
    grd.addColorStop(0.6, 'rgba(150,60,255,0.25)');
    grd.addColorStop(1, 'rgba(120,40,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    flashTex = new THREE.CanvasTexture(c);
    flashTex.colorSpace = THREE.SRGBColorSpace;
  }
  const flashMat = new THREE.SpriteMaterial({ map: flashTex, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
  const flash = new THREE.Sprite(flashMat);
  flash.frustumCulled = false;
  flash.renderOrder = 8;
  flash.scale.setScalar(0.001);
  group.add(flash);
  let flashT = -1;

  let lastN = -1;
  let lastSweepT = -10;
  let gap = 1;
  let hold = 0;
  let disp = 1;
  let wind = 0;
  let clock = 0;

  /** The rest pose for the current hold / display levels (scale 1). */
  const basePose = (out: Pose, t: number, arm: number): Pose => {
    mixPose(out, RETRACT, HOLD, hold);
    if (disp > 0) mixPose(out, out, DISPLAY, disp);
    // breathing hover and twitching claws while out
    const live = Math.max(hold, disp);
    out.y += 0.08 * Math.sin(t * 2.1 + arm * 2.4) * live;
    out.x += 0.06 * Math.sin(t * 1.3 + arm) * live;
    out.curl += 0.08 * Math.sin(t * 3.7 + arm * 1.7) * live;
    out.yaw += 0.1 * Math.sin(t * 1.7 + arm * 0.9) * live;
    return out;
  };

  /** The big Reap's reared wind-up pose (scale 1 at `R` m): high, wide and back, talons raised and splayed, trembling. */
  const rearPose = (out: Pose, R: number, t: number, arm: number, lift: number): Pose => {
    const r = R * 0.62;
    const tr = Math.sin(t * 31 + arm * 2) * 0.5 + Math.sin(t * 47 + arm) * 0.5;
    return setPose(out, Math.sin(PHI_REAR) * r, 3.0 + lift * 0.5 + 0.05 * tr, REAP_ORIGIN + Math.cos(PHI_REAR) * r, PHI_REAR - 0.25 + 0.04 * tr, -0.55, 0.55, 0.02 + 0.05 * tr, 1, 1, 1, 0.1);
  };

  /** Rake key pose at share `u` (canonical; positions at `R` m reach), from `from` (the rest or the reared pose).
   *  `lift`: extra height mid-strike (the big Reap's crossing). */
  const rakePose = (out: Pose, u: number, R: number, lift: number, from: Pose, big: boolean): Pose => {
    const ua = big ? UA * 0.6 : UA;
    if (u < ua) {
      // Wind-up: surge out of the rift and cock back and out, talons raised and splayed.
      const w = smooth(u / ua);
      const r = R * 0.72;
      setPose(_p0, Math.sin(PHI_COCK) * r, 2.5 + lift * 0.4, REAP_ORIGIN + Math.cos(PHI_COCK) * r, PHI_COCK - 0.15, -0.4, 0.45, 0.05, 1, 1, 1, 0.1);
      return mixPose(out, from, _p0, w);
    }
    if (u < UB) {
      // Strike: whip across the arc (fast out of the wind-up, easing at the end), slamming down to the arc's height.
      // The wrist leads with the talons dragging behind, then the hand whips through.
      const x = (u - ua) / (UB - ua);
      const g = 1 - (1 - x) ** 2.2;
      const phi = PHI_COCK + (PHI_END - PHI_COCK) * g;
      const r = R * (0.72 + 0.28 * Math.min(1, x * 2.5));
      const drop = Math.min(1, x * 2.6);
      const y = 2.5 + lift * 0.4 + (ARC_Y - 0.2 - 2.5 - lift * 0.4) * drop + lift * Math.sin(Math.PI * g);
      const lag = 0.55 - 0.85 * g;
      return setPose(out, Math.sin(phi) * r, y, REAP_ORIGIN + Math.cos(phi) * r, phi + lag, -0.4 + 0.6 * drop, 0.45 - 0.6 * g, REF_CURL * drop, REF_SPREAD, 1, 1, 0.1 + 0.9 * g);
    }
    // Grab: the talons snap shut on what they caught (outer fingers first) and the claw pulls in and up.
    const gx = Math.min(1, (u - UB) / (UC - UB));
    const ge = 1 - (1 - gx) ** 3;
    const phi = PHI_END + (PHI_GRAB - PHI_END) * ge;
    const r = R * (1 - 0.28 * ge);
    setPose(_p1, Math.sin(phi) * r, ARC_Y - 0.2 + 0.7 * ge, REAP_ORIGIN + Math.cos(phi) * r, phi - 0.3 + 0.9 * ge, 0.2 + 0.25 * ge, -0.15 - 0.5 * ge, REF_CURL + (1 - REF_CURL) * ge, 1 - 0.85 * ge, 1, 1, 1, 1 - ge);
    if (u < UC) return copyPose(out, _p1);
    // Pull back in: straight back toward the rest pose (never back across the arc), shrinking and fading.
    const w = smooth((u - UC) / (1 - UC));
    return mixPose(out, _p1, from === _pw ? _pb : from, w);
  };

  /** Place a hand-local point in canonical model space: p = T + Qh * (k * (local - REF)). */
  const toModel = (out: THREE.Vector3, local: THREE.Vector3, T: THREE.Vector3, qh: THREE.Quaternion, k: number) =>
    out.copy(local).sub(REF_TIP).multiplyScalar(k).applyQuaternion(qh).add(T);

  /** Instance at `a`, rotation `q`, scale (sx, sy, sz). */
  const put = (m: THREE.InstancedMesh, i: number, a: THREE.Vector3, q: THREE.Quaternion, sx: number, sy: number, sz: number) => {
    _sc.set(sx, sy, sz);
    _m.compose(a, q, _sc);
    m.setMatrixAt(i, _m);
  };

  /** Pose arm `i` (canonical) and write its instances and tatters; returns false when it is fully hidden. */
  const poseArm = (i: number, p: Pose, k0: number, lowQ: boolean): boolean => {
    const A = arms[i];
    const alpha = clamp01(p.alpha);
    if (alpha < 0.015 || p.emerge < 0.02) {
      A.fore.count = A.hand.count = A.phal.count = A.talons.count = A.glow.count = 0;
      A.tatters.geometry.setDrawRange(0, 0);
      return false;
    }
    const k = k0 * p.emerge;
    // Hand: orientation, target, wrist = T - Qh * (k * REF_TIP).
    handQuat(p, _qh);
    _T.set(p.x, p.y, p.z);
    _W.copy(REF_TIP).multiplyScalar(-k).applyQuaternion(_qh).add(_T);
    // Shoulder: from the rift toward the lunge point.
    _S.lerpVectors(CLAW_SOCKET, SURGE_TO, clamp01(p.surge));
    // Two-bone IK (elbow out and low, toward POLE).
    let a = UPPER_L * k;
    let b = FORE_L * k;
    _d.subVectors(_W, _S);
    let dist = _d.length();
    const reach = a + b;
    if (dist > reach * 0.97) {
      const st = Math.min(MAX_STRETCH, (dist / reach) * 1.03);
      a *= st;
      b *= st;
      if (dist > (a + b) * 0.999) {
        // out of reach even stretched: the wrist falls short (the hand follows it)
        _d.multiplyScalar(((a + b) * 0.999) / dist);
        _c.copy(_S).add(_d).sub(_W);
        _W.add(_c);
        _T.add(_c);
        dist = (a + b) * 0.999;
      }
    }
    dist = Math.max(dist, Math.abs(a - b) + 1e-3);
    _a.copy(_d).divideScalar(dist); // shoulder -> wrist unit
    const along = (a * a - b * b + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, a * a - along * along));
    _b.copy(POLE).addScaledVector(_a, -POLE.dot(_a));
    if (_b.lengthSq() < 1e-6) _b.copy(Y);
    _b.normalize();
    _E.copy(_S).addScaledVector(_a, along).addScaledVector(_b, h);

    // ---- forearm: elbow -> wrist, its spurs on the bend's outside (+y = _b)
    _c.subVectors(_W, _E);
    const fl = _c.length();
    _c.divideScalar(fl || 1);
    _n1.crossVectors(_b, _c).normalize(); // x
    _n2.crossVectors(_c, _n1); // y (toward _b)
    _mb.makeBasis(_n1, _n2, _c);
    _q.setFromRotationMatrix(_mb);
    put(A.fore, 0, _E, _q, k, k, fl);
    // ---- hand (wrist at its origin)
    put(A.hand, 0, _W, _qh, k, k, k);
    // ---- digits
    let np = 0;
    let nt = 0;
    for (let d = 0; d < N_DIG; d++) {
      const D = DIGITS[d];
      const J = JOINTS[d];
      const AN = ANGLES[d];
      const twitch = 0.07 * Math.sin(clock * 5.3 + d * 1.9 + i * 3.1) * (1 - Math.abs(p.curl - 0.5));
      digitFK(d, digitCurl(d, p, twitch), p.spread);
      const n = D.len.length;
      digitQuat(D, p.spread, _qd);
      for (let s = 0; s < n; s++) {
        toModel(_a, J[s], _T, _qh, k);
        _q.copy(_qh).multiply(_qd).multiply(_qj.setFromAxisAngle(X, AN[s]));
        put(A.phal, np++, _a, _q, k, k, D.len[s] * k * 1.04);
      }
      // the talon (its own bend continues the finger's)
      toModel(_a, J[n], _T, _qh, k);
      _q.copy(_qh).multiply(_qd).multiply(_qj.setFromAxisAngle(X, AN[n]));
      const tl = D.talon * k;
      put(A.talons, nt, _a, _q, tl, tl, tl);
      put(A.glow, nt, _a, _q, tl, tl, tl * 1.04);
      nt++;
    }
    A.fore.count = A.hand.count = 1;
    A.phal.count = np;
    A.talons.count = A.glow.count = nt;
    for (const m of [A.fore, A.hand, A.phal, A.talons, A.glow]) m.instanceMatrix.needsUpdate = true;

    // ---- ectoplasm tatters: torn strips from round the elbow / upper forearm back into the rift, billowing out
    // like a cloak sleeve, waving.
    const g = A.tatters.geometry;
    const P = (g.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const C = (g.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
    const nStr = lowQ ? TAT_N_LOW : TAT_N;
    // the socket end: just inside the rift
    _F.copy(CLAW_SOCKET);
    _F.y -= 0.05;
    for (let f = 0; f < nStr; f++) {
      const th = (f / nStr) * Math.PI * 2 + 0.4;
      const ct = Math.cos(th);
      const sn = Math.sin(th);
      // start ring round the forearm, 10-35% down it from the elbow
      const f0 = 0.1 + 0.25 * ((f * 0.618) % 1);
      _s.copy(_E).addScaledVector(_c, fl * f0).addScaledVector(_n1, ct * 0.24 * k).addScaledVector(_n2, sn * 0.24 * k);
      // control: the elbow, billowed out round the axis and toward the bend's outside, a little up
      _d.copy(_E).addScaledVector(_n1, ct * 0.55 * k).addScaledVector(_n2, sn * 0.45 * k + 0.35 * k);
      _d.y += 0.15 * k;
      const ph = clock * (5 + f * 0.7) + f * 1.9 + i * 2.3;
      for (let j = 0; j < TAT_SEG; j++) {
        const s = j / (TAT_SEG - 1);
        const u0 = 1 - s;
        // quadratic Bezier start -> control -> socket
        _a.copy(_s).multiplyScalar(u0 * u0).addScaledVector(_d, 2 * u0 * s).addScaledVector(_F, s * s);
        // wave across the strip's own direction, strongest mid-way
        const env = Math.sin(Math.PI * Math.min(1, s * 1.2));
        const wv = Math.sin(ph - s * 7) * 0.16 * k * env;
        _a.addScaledVector(_n1, wv * -sn).addScaledVector(_n2, wv * ct);
        _a.y += Math.sin(ph * 0.7 - s * 5) * 0.08 * k * env;
        // width: ragged, widest mid-way, a thin thread into the rift
        const w = k * (0.1 + 0.3 * Math.sin(Math.PI * Math.min(1, 0.15 + s)) * (0.75 + 0.25 * Math.sin(f * 3.1 + s * 11 + clock * 3)));
        _b.copy(_n1).multiplyScalar(-sn).addScaledVector(_n2, ct); // tangent round the axis
        const v = (f * TAT_SEG + j) * 2;
        P[v * 3] = _a.x + _b.x * w;
        P[v * 3 + 1] = _a.y + _b.y * w;
        P[v * 3 + 2] = _a.z + _b.z * w;
        P[v * 3 + 3] = _a.x - _b.x * w * 0.4;
        P[v * 3 + 4] = _a.y - _b.y * w * 0.4;
        P[v * 3 + 5] = _a.z - _b.z * w * 0.4;
        // colour: pale where it leaves the bone, deep violet in the middle, bright again where it pours into the rift
        const hot = Math.max(0, 1 - s * 3) * 0.6 + Math.max(0, s - 0.75) * 2.4;
        const al = alpha * Math.min(1, s * 6 + 0.25) * (0.7 + 0.3 * Math.sin(ph * 0.5 + s * 4)) * (s > 0.92 ? (1 - s) / 0.08 : 1);
        const c4 = v * 4;
        C[c4] = 0.42 + 0.55 * hot;
        C[c4 + 1] = 0.14 + 0.5 * hot;
        C[c4 + 2] = 0.78 + 0.3 * hot;
        C[c4 + 3] = al * 0.85;
        C[c4 + 4] = 0.25 + 0.4 * hot;
        C[c4 + 5] = 0.06 + 0.3 * hot;
        C[c4 + 6] = 0.5 + 0.3 * hot;
        C[c4 + 7] = al * 0.35;
      }
    }
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, nStr * (TAT_SEG - 1) * 6);
    return true;
  };

  /** Talon trails of arm `i`: the tips' path over the last TRAIL_SPAN s of its rake, sampled from the pose curve. */
  const trailArm = (i: number, st: ArmState, R: number, lift: number, k0: number, from: Pose, fade: number): void => {
    const A = arms[i];
    const g = A.trail.geometry;
    if (st.t < 0 || fade <= 0.01) {
      g.setDrawRange(0, 0);
      return;
    }
    const lowQ = low();
    const N = lowQ ? TRAIL_N_LOW : TRAIL_N;
    const span = (lowQ ? TRAIL_SPAN_LOW : TRAIL_SPAN) * (st.big ? 1.35 : 1);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const col = g.getAttribute('color') as THREE.BufferAttribute;
    const P = pos.array as Float32Array;
    const Cl = col.array as Float32Array;
    const width = st.big ? 1.25 : 1;
    const ua = st.big ? UA * 0.6 : UA;
    let any = false;
    for (let j = 0; j < TRAIL_N; j++) {
      const jj = Math.min(j, N - 1);
      const back = (jj / (N - 1)) * span;
      const u = (st.t - back) / st.dur;
      // only the strike and the grab draw a trail
      const env = u < ua ? 0 : u < UB ? 1 : u < UC + 0.06 ? 1 - (u - UB) / (UC + 0.06 - UB) : 0;
      const uu = u >= ua - 0.02 ? u : ua - 0.02;
      rakePose(_pt, uu, R, lift, from, st.big);
      handQuat(_pt, _qh);
      _T.set(_pt.x, _pt.y, _pt.z);
      const k = k0 * _pt.emerge;
      const head = 1 - jj / (N - 1);
      const a = env * head ** 1.3 * fade * (j < N ? 1 : 0);
      if (a > 0.01) any = true;
      for (let d = 0; d < N_DIG; d++) {
        digitFK(d, digitCurl(d, _pt, 0), _pt.spread);
        const J = JOINTS[d];
        const n = DIGITS[d].len.length;
        toModel(_a, J[n + 1], _T, _qh, k); // tip
        toModel(_b, J[n], _T, _qh, k); // talon base
        // narrow toward the tail; wider on a big Reap
        _b.lerp(_a, 1 - (0.2 + 0.6 * head) * width * 0.75);
        const v = ((d * TRAIL_N + j) * 2) | 0;
        P[v * 3] = _a.x;
        P[v * 3 + 1] = _a.y;
        P[v * 3 + 2] = _a.z;
        P[v * 3 + 3] = _b.x;
        P[v * 3 + 4] = _b.y;
        P[v * 3 + 5] = _b.z;
        // hot lilac at the head cooling to violet; the tip edge brighter than the inner edge
        const hot = head * head;
        const r = 0.6 + 1.1 * hot;
        const gg = 0.22 + 0.95 * hot;
        const bb = 0.95 + 0.9 * hot;
        const c4 = v * 4;
        Cl[c4] = r;
        Cl[c4 + 1] = gg;
        Cl[c4 + 2] = bb;
        Cl[c4 + 3] = a;
        Cl[c4 + 4] = r * 0.6;
        Cl[c4 + 5] = gg * 0.5;
        Cl[c4 + 6] = bb * 0.8;
        Cl[c4 + 7] = a * 0.5;
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    g.setDrawRange(0, any ? N_DIG * (N - 1) * 6 : 0);
  };

  const update = (dt: number, t: number, s: ClawRigIn): void => {
    clock = t;
    const reach = s.reach || BASE_REACH;
    // New sweeps start rakes: its side's arm, or both on a big Reap. Rakes shorten when sweeps come faster.
    const n = s.reapN | 0;
    if (lastN < 0 || n < lastN) lastN = n;
    else if (n !== lastN) {
      lastN = n;
      const since = t - lastSweepT;
      lastSweepT = t;
      gap = since;
      const dur = Math.max(0.16, Math.min(RAKE_TIME, gap * RAKE_SHARE)) * (s.reapBig ? 1.12 : 1);
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? 1 : -1;
        if (!s.reapBig && side !== (s.reapSide < 0 ? -1 : 1)) continue;
        const st = state[i];
        st.t = 0;
        st.dur = dur;
        st.big = s.reapBig;
        st.flashed = false;
      }
    }
    hold += ((s.held ? 1 : 0) - hold) * Math.min(1, dt * (s.held ? 10 : 5));
    disp += ((s.display ? 1 : 0) - disp) * Math.min(1, dt * 6);
    // The big wind-up: both claws start rearing back once the last normal rake has had its time.
    const wantWind = s.held ? smooth((s.bigWind - 0.4) / 0.5) : 0;
    wind += (wantWind - wind) * Math.min(1, dt * 14);
    // (the big sweep itself resets it at once: its rake starts from the reared pose)
    if (!s.held || s.bigWind <= 0) wind = Math.min(wind, wantWind);
    const lowQ = low();
    const phaseMul = 1 - 0.3 * s.phase;
    let riftHot = 0;
    for (let i = 0; i < 2; i++) {
      const st = state[i];
      const side = i === 0 ? 1 : -1;
      if (st.t >= 0) {
        st.t += dt;
        if (st.t >= st.dur) st.t = -1;
      }
      const big = st.t >= 0 && st.big;
      const R = reach * (big ? REAP_BIG_WIDTH : 1);
      const k0 = (R / BASE_REACH) * (big ? 1.06 : 1);
      // The big Reap's crossing: the left (+x) claw passes over, the right one under.
      const lift = big ? (side > 0 ? 0.85 : -0.1) : 0;
      basePose(_pb, t, i);
      // The reared pose (the big Reap starts from it).
      rearPose(_pw, reach * REAP_BIG_WIDTH, t, i, side > 0 ? 0.85 : -0.1);
      if (st.t >= 0) rakePose(_p2, st.t / st.dur, R, lift, big ? _pw : _pb, big);
      else copyPose(_p2, _pb);
      if (wind > 0.001 && !big) mixPose(_p2, _p2, _pw, wind);
      const out = poseArm(i, _p2, wind > 0.001 && !big ? k0 * (1 + (REAP_BIG_WIDTH * 1.06 - 1) * wind) : k0, lowQ);
      const A = arms[i];
      // Materials: fade, ghostfire flicker in the cracks, the talons flare mid-rake.
      const u = st.t >= 0 ? st.t / st.dur : 1;
      const strike = st.t >= 0 && u > UA * 0.6 && u < UC ? 1 : 0;
      const al = clamp01(_p2.alpha) * phaseMul;
      const fl = 0.5 + 0.22 * Math.sin(t * 13.1 + i * 2) + 0.17 * Math.sin(t * 29.3 + i * 4.6) + 0.11 * Math.sin(t * 47.9 + i * 10);
      const m = A.mats;
      m.bone.opacity = al;
      const rim = 1 + 0.12 * fl + 0.15 * strike;
      m.bone.color.setRGB(rim, rim, rim);
      const cg = 0.55 + 0.6 * fl + 0.9 * strike + 0.5 * wind;
      m.crack.value.setRGB(0.75 * cg, 0.3 * cg, 1.15 * cg);
      const tb = 1.05 + 0.25 * fl + 0.45 * strike + 0.3 * wind;
      m.talon.color.setRGB(tb, tb, tb);
      m.talon.opacity = al;
      m.glow.opacity = (0.3 + 0.35 * strike + 0.25 * wind) * al * (lowQ ? 0.7 : 1);
      m.tatter.opacity = 0.9 * phaseMul;
      if (out) riftHot = Math.max(riftHot, al);
      trailArm(i, st, R, lift, k0, big ? _pw : _pb, phaseMul * (out ? 1 : 0));
      // Big Reap flash: when the claws cross over the nose.
      if (big && side > 0 && !st.flashed && u >= UA * 0.6 + (UB - UA * 0.6) * 0.35) {
        st.flashed = true;
        flashT = 0;
        flash.position.set(0, 1.6, REAP_ORIGIN + R * 0.85);
      }
    }
    if (flashT >= 0) {
      flashT += dt;
      const k = flashT / 0.24;
      if (k >= 1) {
        flashT = -1;
        flashMat.opacity = 0;
        flash.scale.setScalar(0.001);
      } else {
        flashMat.opacity = (1 - k) ** 1.5 * (lowQ ? 0.7 : 1);
        flash.scale.setScalar((2.6 + 5 * Math.sqrt(k)) * (reach / BASE_REACH));
      }
    }
    // Rifts glow hotter while an arm is out; wisps flicker.
    const rf = 0.5 + 0.3 * Math.sin(t * 9.1) + 0.2 * Math.sin(t * 23.7);
    const rb = 1.2 + 0.5 * rf + 1.4 * riftHot;
    riftMat.color.setRGB(0.88 * rb, 0.66 * rb, 1.0 * rb);
    wispMat.opacity = 0.35 + 0.25 * rf + 0.3 * riftHot;
    for (let w = 0; w < wisps.length; w++) {
      const f = 0.5 + 0.5 * Math.sin(t * (7 + w * 1.3) + w * 2.1);
      wisps[w].scale.set(0.8 + 0.4 * f, 0.7 + 0.8 * f + 1.4 * riftHot, 0.8 + 0.4 * f);
    }
  };

  const park = (): void => {
    lastN = -1;
    hold = 0;
    disp = 1;
    wind = 0;
    for (const st of state) st.t = -1;
    flashT = -1;
    flashMat.opacity = 0;
    flash.scale.setScalar(0.001);
    update(0, clock, { reach: BASE_REACH, reapN: 0, reapSide: 1, reapBig: false, held: false, bigWind: 0, phase: 0, display: true });
  };
  park();
  return { group, rifts, update, park };
}
