import * as THREE from 'three';
import { bakeGeometry, mergeBaked, mergeStatic } from '../../render/mergeStatic';
import { makeShadowProxy } from '../../render/shadowProxy';
import { addMesh, type VehicleBuild, type VehicleBuildIn } from './types';

/* CLASSIC — the heavy-duty pro plow: a modern airport-runway / mountain-pass rig in glossy yellow with black and
 * chrome. Angular cab with tinted wraparound glass and a roof LED bar, plow lights over the hood, a big intake scoop,
 * twin chrome stacks, a high-tech spreader hopper at the back (glowing fill gauge, spinning spreader disc), and the
 * power blade: polished steel face in segments, hinged wings, carbide edge, LED markers, chrome hydraulic rams and,
 * with Inferno, twin burners + a glowing fuel cell built into the blade frame.
 *
 * The Plow still owns the blade sheet (unit width, scaled on X, Paint Shop blade skins) and the blade group; this
 * builder hands it the blade dressing: `sheetTrim` (rides on the sheet, stretches with it), `frame` (wings, seams,
 * LED markers: rebuilt per blade width), `arms` (push frame + ram rods) and `inferno` (burners + fuel cell). Model
 * space: facing +Z, ground y = 0; blade parts are in blade-group space (the group sits at z = 2.25). */

/** Blade sheet profile (matches Plow's curved sheet): radius, axis (y, z), arc start + length. */
const R = 0.78;
const CY = 0.72;
const CZ = R - 0.05;
const T0 = Math.PI - 0.95;
const TL = 1.9;
/** Each hinged wing covers this much of the blade width at its end (the sheet between them is w - 2 * WING). */
export const CLASSIC_WING = 0.4;
/** Wing sweep forward (rad) and length along its own face. */
const WING_A = 0.42;
const WING_L = CLASSIC_WING / Math.cos(WING_A);
/** Hydraulic rams: x, height, and where the barrels sit on the hood sides (body z). */
const RAM_X = 0.86;
const RAM_Y = 1.2;
/** Blade group z in body space (Plow BLADE_Z - 0.1). */
const BLADE_GZ = 2.25;
/** Left exhaust stack tip (the dash flame sits here; puffs alternate with the mirrored right stack). */
export const CLASSIC_EXHAUST = new THREE.Vector3(-0.82, 2.86, -0.36);

/** What the Plow feeds the Classic rig every frame. */
export interface ClassicRigState {
  /** Ground speed (m/s). */
  speed: number;
  /** 0..1 held snow (ball radius / max): the hopper gauge. */
  fill: number;
  /** Inferno charge 0..1, or < 0 when the pilot has no Inferno (burners hidden). */
  flame: number;
}

export interface ClassicVehicleParts {
  /** Pop-off wreck parts. */
  stacks: THREE.Group;
  mirrors: [THREE.Group, THREE.Group];
  /** The amber beacons (beacon material, one mesh, pops off). */
  beacon: THREE.Mesh;
  /** Child of the blade sheet: back skin, top rail, carbide edge, back beams (stretch with the sheet). */
  sheetTrim: THREE.Group;
  /** Blade wings, segment seams, LED markers, marker wands, hinges: rebuilt by setWidth. */
  frame: THREE.Group;
  /** Rebuild the frame for blade width w; returns the sheet's own width (between the wing hinges). */
  setWidth(w: number): number;
  /** Push frame + chrome ram rods (blade-group space, static, merged). */
  arms: THREE.Group;
  /** Inferno burners + fuel cell (blade-group space); shown while the pilot has Inferno. */
  inferno: THREE.Group;
  /** Metallic materials that want the Paint Shop env map (chrome, tinted glass). */
  metalMats: THREE.MeshStandardMaterial[];
  update(dt: number, s: ClassicRigState): void;
}

/* ------------------------------------------------------------------------------------------------ geometry */

/** Octagonal loft section at z (see arsenal's): heights keel / side foot / side top / roof, half-widths keel / side / roof. */
interface Sec {
  z: number;
  y: readonly [number, number, number, number];
  w: readonly [number, number, number];
}

/** Faceted body lofted through octagonal sections (z increasing), capped; flat normals. */
function loft(secs: readonly Sec[]): THREE.BufferGeometry {
  const rings = secs.map(({ z, y: [y0, y1, y2, y3], w: [wb, ws, wt] }) =>
    ([[wb, y0], [ws, y1], [ws, y2], [wt, y3], [-wt, y3], [-ws, y2], [-ws, y1], [-wb, y0]] as const).map(([x, y]) => new THREE.Vector3(x, y, z)),
  );
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i + 1 < rings.length; i++) {
    const r0 = rings[i];
    const r1 = rings[i + 1];
    for (let k = 0; k < 8; k++) {
      const k1 = (k + 1) % 8;
      tri(r0[k], r0[k1], r1[k1]);
      tri(r0[k], r1[k1], r1[k]);
    }
  }
  const cap = (r: THREE.Vector3[], front: boolean) => {
    const c = r.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / r.length);
    for (let k = 0; k < 8; k++) {
      const k1 = (k + 1) % 8;
      if (front) tri(c, r[k], r[k1]);
      else tri(c, r[k1], r[k]);
    }
  };
  cap(rings[0], false);
  cap(rings[rings.length - 1], true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Box (w x h x d, centred) with its four Z-running edges chamfered by c. */
function chamferBox(w: number, h: number, d: number, c: number): THREE.BufferGeometry {
  const y = [-h / 2, -h / 2 + c, h / 2 - c, h / 2] as const;
  const s = [w / 2 - c, w / 2, w / 2 - c] as const;
  return loft([{ z: -d / 2, y, w: s }, { z: d / 2, y, w: s }]);
}

/** A curved strip of the blade profile at radius r, `len` long on X (centred), open. */
function arcSheet(r: number, len: number, seg = 14, t0 = T0, tl = TL): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true, t0, tl);
  g.rotateZ(Math.PI / 2);
  g.translate(0, CY, CZ);
  return g;
}

/** A flat plate following the blade profile between radii ri..ro (a rib / end plate), `thick` on X (centred). */
function arcPlate(ri: number, ro: number, thick: number, t0 = T0, tl = TL, seg = 8): THREE.BufferGeometry {
  const P = (r: number, t: number) => new THREE.Vector2(-(CZ + r * Math.cos(t)), CY + r * Math.sin(t));
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= seg; i++) pts.push(P(ro, t0 + (tl * i) / seg));
  for (let i = seg; i >= 0; i--) pts.push(P(ri, t0 + (tl * i) / seg));
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: thick, bevelEnabled: false });
  g.rotateY(Math.PI / 2);
  g.translate(-thick / 2, 0, 0);
  return g;
}

/** Cylinder of radius r and length len lying along X / Z (centred). */
const cylX = (r: number, len: number, seg = 10) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2);
const cylZ = (r: number, len: number, seg = 10) => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);

/** Back of the sheet (radius r) at height y: its z. */
const backZ = (y: number, r = R) => CZ - Math.sqrt(Math.max(0, r * r - (y - CY) * (y - CY)));

/* ------------------------------------------------------------------------------------------------ builder */

export function buildClassicVehicle(
  { mats, chassis }: VehicleBuildIn,
  extra: { beacon: THREE.MeshStandardMaterial; steel: THREE.MeshStandardMaterial },
): VehicleBuild<ClassicVehicleParts> {
  const group = new THREE.Group();
  const P = mats.paint;
  const T = mats.trim;
  const D = mats.dark;
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe4eaf0, roughness: 0.16, metalness: 0.95 });
  const black = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.32, metalness: 0.35 });
  const carbide = new THREE.MeshStandardMaterial({ color: 0x3d434b, roughness: 0.3, metalness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x24425e, roughness: 0.05, metalness: 0.8, emissive: 0x0c2238, emissiveIntensity: 0.8 });
  const led = new THREE.MeshStandardMaterial({ color: 0xffc04a, emissive: 0xffa21a, emissiveIntensity: 2.4, roughness: 0.3 });
  const ledRed = new THREE.MeshStandardMaterial({ color: 0xff3030, emissive: 0xff1818, emissiveIntensity: 2.2, roughness: 0.3 });
  const gaugeMat = new THREE.MeshStandardMaterial({ color: 0x9ff0ff, emissive: 0x2fd2ff, emissiveIntensity: 2.4, roughness: 0.3 });
  const fuelMat = new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff5a0a, emissiveIntensity: 1.2, roughness: 0.25 });
  const nozzleMat = new THREE.MeshStandardMaterial({ color: 0xffc070, emissive: 0xff6a10, emissiveIntensity: 0.6, roughness: 0.3 });
  const head = mats.head;
  const A = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = group, shadow = true) => addMesh(geo, mat, x, y, z, parent, shadow);
  const both = (fn: (sx: number) => void) => {
    fn(-1);
    fn(1);
  };

  /* ---- chassis, fenders, steps, tanks */
  A(chassis, D, 0, 0.62, 0.05);
  A(new THREE.BoxGeometry(1.95, 0.42, 0.1), D, 0, 0.62, 2.0); // blade mount plate
  for (const z of [1.45, -1.25]) {
    both((sx) => {
      A(new THREE.BoxGeometry(0.46, 0.06, 0.6), T, sx * 0.97, 1.1, z);
      A(new THREE.BoxGeometry(0.46, 0.06, 0.4), T, sx * 0.97, 0.95, z + 0.44).rotation.x = 0.85;
      A(new THREE.BoxGeometry(0.46, 0.06, 0.4), T, sx * 0.97, 0.95, z - 0.44).rotation.x = -0.85;
    });
  }
  both((sx) => {
    A(new THREE.BoxGeometry(0.22, 0.05, 0.5), black, sx * 0.99, 0.74, 0.45);
    A(new THREE.BoxGeometry(0.2, 0.05, 0.46), black, sx * 0.96, 0.52, 0.45, group, false);
    A(cylZ(0.18, 0.72, 12), chrome, sx * 0.9, 0.62, -0.32);
    for (const z of [-0.55, -0.1]) A(cylZ(0.19, 0.045, 12), black, sx * 0.9, 0.62, z, group, false);
    A(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 6), chrome, sx * 1.0, 1.2, -0.13, group, false);
  });

  /* ---- hood: chamfered, flat-topped, with an intake scoop, a grille and plow lights on stalks */
  A(loft([
    { z: 1.24, y: [0.8, 0.86, 1.4, 1.5], w: [0.7, 0.78, 0.66] },
    { z: 1.98, y: [0.8, 0.86, 1.4, 1.5], w: [0.7, 0.78, 0.66] },
    { z: 2.12, y: [0.82, 0.88, 1.32, 1.42], w: [0.66, 0.74, 0.6] },
  ]), P, 0, 0, 0);
  A(new THREE.BoxGeometry(1.0, 0.36, 0.03), black, 0, 1.08, 2.125, group, false);
  for (let i = 0; i < 4; i++) A(new THREE.BoxGeometry(0.92, 0.03, 0.03), chrome, 0, 0.96 + i * 0.08, 2.145, group, false);
  A(chamferBox(0.66, 0.13, 0.3, 0.03), black, 0, 1.56, 1.97);
  for (let i = 0; i < 3; i++) A(new THREE.BoxGeometry(0.56, 0.02, 0.02), chrome, 0, 1.53 + i * 0.035, 2.125, group, false);
  A(new THREE.BoxGeometry(0.06, 0.02, 0.62), T, 0, 1.505, 1.6, group, false); // hood centre crease
  both((sx) => {
    A(new THREE.BoxGeometry(0.26, 0.08, 0.03), head, sx * 0.48, 1.22, 2.125, group, false); // DRL strip
    A(new THREE.BoxGeometry(0.04, 0.24, 0.04), black, sx * 0.62, 1.62, 1.95, group, false); // plow-light stalk
    A(chamferBox(0.26, 0.15, 0.12, 0.03), black, sx * 0.62, 1.78, 1.95);
    A(new THREE.BoxGeometry(0.2, 0.09, 0.02), head, sx * 0.62, 1.78, 2.015, group, false);
    // Ram barrels on the hood flanks (the chrome rods ride on the blade and slide out of them).
    A(cylZ(0.072, 0.5, 10), black, sx * RAM_X, RAM_Y, 1.36);
    A(cylZ(0.085, 0.05, 10), chrome, sx * RAM_X, RAM_Y, 1.6, group, false);
  });

  /* ---- cab: chamfered lower body, tinted wraparound greenhouse with a raked screen, visor roof, LED bar, beacons */
  A(chamferBox(1.96, 0.82, 1.45, 0.08), P, 0, 1.21, 0.52);
  A(new THREE.BoxGeometry(1.99, 0.06, 1.47), T, 0, 1.6, 0.52); // black belt line under the glass
  A(loft([
    { z: -0.18, y: [1.6, 1.61, 1.63, 2.17], w: [0.95, 0.955, 0.86] },
    { z: 0.88, y: [1.6, 1.61, 1.63, 2.17], w: [0.95, 0.955, 0.86] },
    { z: 1.24, y: [1.6, 1.61, 1.62, 1.64], w: [0.95, 0.955, 0.93] },
  ]), glass, 0, 0, 0, group, false);
  A(chamferBox(1.98, 0.13, 1.32, 0.04), P, 0, 2.235, 0.4);
  both((sx) => {
    const a = A(new THREE.BoxGeometry(0.07, 0.66, 0.07), black, sx * 0.905, 1.895, 1.07, group, false); // A pillar
    a.rotation.x = -0.555;
    a.rotation.z = sx * 0.08;
    A(new THREE.BoxGeometry(0.07, 0.56, 0.09), black, sx * 0.91, 1.89, -0.15, group, false); // B pillar
    A(new THREE.BoxGeometry(0.012, 0.66, 0.02), black, sx * 0.985, 1.2, 1.12, group, false); // door seams
    A(new THREE.BoxGeometry(0.012, 0.66, 0.02), black, sx * 0.985, 1.2, -0.1, group, false);
    A(new THREE.BoxGeometry(0.03, 0.04, 0.16), chrome, sx * 0.99, 1.45, 0.92, group, false); // handle
    A(new THREE.BoxGeometry(0.36, 0.03, 0.22), black, sx * 0.66, 2.315, -0.1, group, false); // beacon plinths
  });
  A(new THREE.BoxGeometry(1.62, 0.09, 0.14), black, 0, 2.345, 0.92);
  A(new THREE.BoxGeometry(1.5, 0.05, 0.02), head, 0, 2.345, 0.995, group, false);
  A(new THREE.SphereGeometry(0.08, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), chrome, 0, 2.3, -0.05, group, false); // GPS dome

  /* ---- rear: equipment deck + spreader hopper (gauge, ladder, LEDs) + spreader chute and disc */
  A(chamferBox(1.85, 0.22, 1.6, 0.03), D, 0, 0.9, -1.25);
  A(loft([
    { z: -2.05, y: [1.0, 1.3, 1.98, 2.02], w: [0.58, 0.97, 0.95] },
    { z: -0.5, y: [1.0, 1.3, 1.98, 2.02], w: [0.58, 0.97, 0.95] },
  ]), P, 0, 0, 0);
  A(new THREE.BoxGeometry(1.78, 0.03, 1.44), black, 0, 2.03, -1.275, group, false);
  both((sx) => {
    A(new THREE.BoxGeometry(0.06, 0.07, 1.56), T, sx * 0.93, 2.05, -1.275);
    for (const z of [-1.97, -0.58]) A(new THREE.BoxGeometry(0.04, 0.7, 0.07), T, sx * 0.975, 1.64, z, group, false);
    A(new THREE.BoxGeometry(0.07, 0.38, 0.025), ledRed, sx * 0.86, 1.6, -2.065, group, false);
    A(new THREE.BoxGeometry(0.1, 0.05, 0.025), led, sx * 0.76, 1.34, -2.065, group, false);
    A(new THREE.BoxGeometry(0.14, 0.1, 0.08), black, sx * 0.75, 2.1, -1.98, group, false); // work lights
    A(new THREE.BoxGeometry(0.11, 0.06, 0.02), head, sx * 0.75, 2.1, -2.025, group, false);
    A(new THREE.BoxGeometry(0.3, 0.06, 0.02), ledRed, sx * 0.7, 0.64, -2.185, group, false);
  });
  for (const z of [-0.53, -2.02]) A(new THREE.BoxGeometry(1.92, 0.07, 0.06), T, 0, 2.05, z);
  for (const z of [-0.85, -1.15, -1.45, -1.75]) A(new THREE.BoxGeometry(1.8, 0.035, 0.05), T, 0, 2.06, z, group, false);
  A(new THREE.BoxGeometry(2.0, 0.18, 0.16), D, 0, 0.64, -2.1); // rear bumper
  A(new THREE.BoxGeometry(0.36, 0.34, 0.22), D, 0, 0.82, -2.2); // spreader chute
  A(new THREE.BoxGeometry(0.06, 0.24, 0.06), D, 0, 0.6, -2.36, group, false);
  // Hopper gauge (rear face): housing, ticks; the glowing bar is animated (fill).
  A(new THREE.BoxGeometry(0.22, 0.62, 0.035), black, 0.5, 1.6, -2.065, group, false);
  for (let i = 0; i < 4; i++) A(new THREE.BoxGeometry(0.035, 0.012, 0.012), chrome, 0.585, 1.4 + i * 0.13, -2.088, group, false);
  A(new THREE.BoxGeometry(0.1, 0.035, 0.02), led, 0.5, 1.93, -2.075, group, false);
  // Ladder.
  for (const x of [-0.62, -0.38]) A(new THREE.CylinderGeometry(0.018, 0.018, 0.78, 6), chrome, x, 1.58, -2.09, group, false);
  for (let i = 0; i < 5; i++) A(new THREE.BoxGeometry(0.24, 0.022, 0.022), chrome, -0.5, 1.28 + i * 0.14, -2.09, group, false);

  // Animated parts.
  const gaugeGeo = new THREE.BoxGeometry(0.13, 1, 0.02);
  gaugeGeo.translate(0, 0.5, 0);
  const gauge = A(gaugeGeo, gaugeMat, 0.5, 1.33, -2.088, group, false);
  const spinner = new THREE.Group();
  spinner.position.set(0, 0.5, -2.36);
  A(new THREE.CylinderGeometry(0.27, 0.27, 0.035, 12), D, 0, 0, 0, spinner);
  A(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8), chrome, 0, 0.04, 0, spinner, false);
  for (let i = 0; i < 4; i++) {
    const f = A(new THREE.BoxGeometry(0.24, 0.05, 0.025), chrome, 0, 0.04, 0, spinner, false);
    const a = (i / 4) * Math.PI * 2;
    f.position.set(Math.cos(a) * 0.13, 0.04, Math.sin(a) * 0.13);
    f.rotation.y = -a;
  }
  group.add(spinner);

  /* ---- twin exhaust stacks (pop off together) */
  const stacks = new THREE.Group();
  both((sx) => {
    const x = sx * -CLASSIC_EXHAUST.x;
    const z = CLASSIC_EXHAUST.z;
    A(new THREE.CylinderGeometry(0.065, 0.065, 1.75, 10), chrome, x, 1.88, z, stacks);
    A(new THREE.CylinderGeometry(0.09, 0.09, 0.7, 10), black, x, 1.95, z, stacks);
    for (const y of [1.62, 2.28]) A(new THREE.CylinderGeometry(0.097, 0.097, 0.035, 10), chrome, x, y, z, stacks, false);
    A(new THREE.CylinderGeometry(0.075, 0.07, 0.16, 10), chrome, x, 2.8, z, stacks).rotation.x = -0.35;
    for (const y of [1.5, 2.15]) A(new THREE.BoxGeometry(0.05, 0.05, 0.16), black, x, y, -0.28, stacks, false);
  });
  mergeStatic(stacks);
  stacks.add(...makeShadowProxy(stacks, stacks));
  group.add(stacks);

  /* ---- aero mirrors */
  const mirrors = [-1, 1].map((sx) => {
    const m = new THREE.Group();
    A(new THREE.BoxGeometry(0.32, 0.035, 0.04), black, sx * 1.08, 1.7, 1.12, m, false).rotation.z = sx * 0.4;
    const h = A(chamferBox(0.09, 0.3, 0.17, 0.025), P, sx * 1.25, 1.84, 1.12, m);
    h.rotation.y = sx * 0.12;
    A(new THREE.BoxGeometry(0.07, 0.26, 0.01), glass, sx * 1.25, 1.84, 1.03, m, false);
    mergeStatic(m);
    group.add(m);
    return m;
  }) as [THREE.Group, THREE.Group];

  /* ---- sleek amber beacons: one mesh (two low pods), origin at the left pod; reflectors spin inside */
  const podGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.12, 8);
  podGeo.scale(1.5, 1, 1);
  const beaconGeo = mergeBaked([bakeGeometry(podGeo, new THREE.Matrix4(), ['position', 'normal']), bakeGeometry(podGeo, new THREE.Matrix4().makeTranslation(1.32, 0, 0), ['position', 'normal'])], extra.beacon)[0];
  const beacon = A(beaconGeo, extra.beacon, -0.66, 2.39, -0.1, group, false);
  const reflMat = new THREE.MeshBasicMaterial({ color: 0xffe08a });
  const spinners = [0, 1.32].map((x) => {
    const s = new THREE.Group();
    s.position.x = x;
    s.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.03), reflMat));
    beacon.add(s);
    return s;
  });

  const keep = [stacks, ...mirrors, beacon, gauge, spinner];
  mergeStatic(group, { keep });
  group.add(...makeShadowProxy(group, group, { keep }));

  /* ------------------------------------------------------------------ blade dressing (blade-group space) */

  // Sheet trim: unit width, child of the sheet (scaled on X with it). The sheet casts the shadow.
  const sheetTrim = new THREE.Group();
  A(arcSheet(R + 0.03, 1), P, 0, 0, 0, sheetTrim, false); // painted back skin
  A(new THREE.BoxGeometry(1, 0.09, 0.16), P, 0, 1.4, 0.24, sheetTrim, false); // top rail
  A(new THREE.BoxGeometry(1, 0.1, 0.08), carbide, 0, 0.07, 0.27, sheetTrim, false); // carbide cutting edge
  A(new THREE.BoxGeometry(1, 0.24, 0.1), T, 0, CY, backZ(CY, R + 0.03) - 0.05, sheetTrim, false); // strongback
  A(new THREE.BoxGeometry(1, 0.1, 0.1), D, 0, 1.2, backZ(1.2, R + 0.03) - 0.05, sheetTrim, false);
  A(new THREE.BoxGeometry(1, 0.1, 0.1), D, 0, 0.3, backZ(0.3, R + 0.03) - 0.05, sheetTrim, false);
  for (const o of sheetTrim.children) o.receiveShadow = true;
  mergeStatic(sheetTrim);

  // Width-dependent frame: one mesh per material, geometry rebuilt in setWidth.
  const frame = new THREE.Group();
  const frameMats = [extra.steel, P, T, D, chrome, carbide, led] as const;
  const frameMesh = new Map<THREE.Material, THREE.Mesh>();
  for (const m of frameMats) {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), m);
    mesh.castShadow = m !== led && m !== chrome;
    mesh.receiveShadow = true;
    frame.add(mesh);
    frameMesh.set(m, mesh);
  }
  const G = {
    seam: arcSheet(R - 0.012, 0.035),
    rib: arcPlate(R + 0.03, R + 0.15, 0.05),
    divider: arcPlate(R - 0.04, R + 0.17, 0.06),
    endPlate: arcPlate(0.5, R + 0.15, 0.06),
    wingFace: arcSheet(R, WING_L, 14).translate(WING_L / 2, 0, 0),
    wingBack: arcSheet(R + 0.03, WING_L, 14).translate(WING_L / 2, 0, 0),
    wingRail: new THREE.BoxGeometry(WING_L, 0.09, 0.16).translate(WING_L / 2, 1.4, 0.24),
    wingEdge: new THREE.BoxGeometry(WING_L, 0.1, 0.08).translate(WING_L / 2, 0.07, 0.27),
    knuckle: new THREE.CylinderGeometry(0.05, 0.05, 0.22, 8),
    led: new THREE.BoxGeometry(0.1, 0.035, 0.05),
    wand: new THREE.CylinderGeometry(0.022, 0.022, 0.72, 6),
    wandBand: new THREE.CylinderGeometry(0.03, 0.03, 0.08, 6),
    wandTip: new THREE.SphereGeometry(0.045, 6, 4),
  };
  const _M = new THREE.Matrix4();
  const _W = new THREE.Matrix4();
  const _S = new THREE.Matrix4().makeScale(-1, 1, 1);
  let width = -1;
  let sheetW = 1;
  const setWidth = (w: number): number => {
    if (w === width) return sheetW;
    width = w;
    sheetW = Math.max(0.8, w - 2 * CLASSIC_WING);
    const h = sheetW / 2;
    const parts = new Map<THREE.Material, THREE.BufferGeometry[]>(frameMats.map((m) => [m, []]));
    const put = (geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4) => parts.get(mat)!.push(bakeGeometry(geo, m, ['position', 'normal']));
    const at = (x: number, y: number, z: number) => _M.makeTranslation(x, y, z);
    // Segments: seams on the face, ribs on the back.
    const n = Math.max(2, Math.round(sheetW / 0.62));
    for (let i = 1; i < n; i++) {
      const x = -h + (i * sheetW) / n;
      put(G.seam, D, at(x, 0, 0));
      put(G.rib, T, at(x, 0, 0));
    }
    // LED markers along the top rail.
    const leds = Math.max(3, Math.round(sheetW / 0.42));
    for (let j = 0; j < leds; j++) put(G.led, led, at(-h + ((j + 0.5) * sheetW) / leds, 1.46, 0.29));
    // Hinges + wings (built for the right side, mirrored for the left).
    for (const sx of [-1, 1]) {
      put(G.divider, D, at(sx * h, 0, 0));
      for (const y of [0.42, 1.05]) put(G.knuckle, chrome, at(sx * (h + 0.02), y, backZ(y) - 0.07));
      // Hinge frame: rotate about a vertical axis at (h, z = 0); mirror for the left wing.
      _W.makeRotationY(-WING_A).premultiply(new THREE.Matrix4().makeTranslation(h, 0, 0));
      if (sx < 0) _W.premultiply(_S);
      const w2 = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => put(geo, mat, _M.makeTranslation(x, y, z).premultiply(_W));
      w2(G.wingFace, extra.steel);
      w2(G.wingBack, P);
      w2(G.wingRail, P);
      w2(G.wingEdge, carbide);
      w2(G.rib, T, WING_L * 0.5);
      w2(G.endPlate, P, WING_L);
      w2(G.led, led, WING_L * 0.5, 1.46, 0.29);
      // Marker wand at the wing tip: black pole, amber reflector band, LED tip.
      w2(G.wand, D, WING_L - 0.06, 1.78, 0.12);
      w2(G.wandBand, led, WING_L - 0.06, 1.9, 0.12);
      w2(G.wandTip, led, WING_L - 0.06, 2.16, 0.12);
    }
    for (const [mat, list] of parts) {
      const mesh = frameMesh.get(mat)!;
      mesh.geometry.dispose();
      mesh.geometry = list.length ? mergeBaked(list, mat)[0] : new THREE.BufferGeometry();
    }
    return sheetW;
  };

  // Push frame + ram rods (static, blade-group space; ride with the blade).
  const arms = new THREE.Group();
  both((sx) => {
    A(new THREE.BoxGeometry(0.14, 0.16, 0.75), D, sx * 0.5, 0.45, -0.45, arms);
    A(new THREE.BoxGeometry(0.14, 0.16, 0.14), D, sx * RAM_X, RAM_Y, backZ(RAM_Y) - 0.1, arms);
    const rodLen = backZ(RAM_Y) - 0.1 - (1.35 - BLADE_GZ);
    A(cylZ(0.036, rodLen, 8), chrome, sx * RAM_X, RAM_Y, backZ(RAM_Y) - 0.1 - rodLen / 2, arms);
  });
  A(new THREE.BoxGeometry(1.2, 0.42, 0.08), D, 0, 0.62, -0.24, arms);
  mergeStatic(arms);

  // Inferno: twin burners through the blade face (heat shields, glowing cores; housings + fins on the back) and a
  // fuel cell on top of the blade frame, piped to them. The flame cone itself starts between the nozzles.
  const inferno = new THREE.Group();
  both((sx) => {
    const x = sx * 0.34;
    A(new THREE.BoxGeometry(0.3, 0.34, 0.03), carbide, x, 0.92, 0.0, inferno).rotation.x = 0.26;
    A(new THREE.BoxGeometry(0.28, 0.03, 0.18), carbide, x, 1.1, 0.07, inferno, false);
    A(cylZ(0.09, 0.16, 10), black, x, 0.92, 0.08, inferno);
    A(cylZ(0.1, 0.03, 10), chrome, x, 0.92, 0.155, inferno, false);
    A(cylZ(0.056, 0.03, 10), nozzleMat, x, 0.92, 0.17, inferno, false);
    A(new THREE.BoxGeometry(0.28, 0.3, 0.26), D, x, 0.92, backZ(0.92) - 0.15, inferno);
    for (let i = 0; i < 3; i++) A(new THREE.BoxGeometry(0.32, 0.025, 0.22), chrome, x, 0.84 + i * 0.08, backZ(0.92) - 0.16, inferno, false);
    A(new THREE.BoxGeometry(0.06, 0.25, 0.1), D, sx * 0.22, 1.33, 0.02, inferno, false);
    const line = A(new THREE.CylinderGeometry(0.022, 0.022, 0.5, 6), D, sx * 0.33, 1.285, -0.125, inferno, false);
    line.rotation.x = 0.53;
    A(new THREE.SphereGeometry(0.12, 8, 6), chrome, sx * 0.32, 1.55, 0.0, inferno).scale.x = 0.55;
    A(cylX(0.135, 0.03, 12), chrome, sx * 0.2, 1.55, 0.0, inferno, false);
  });
  A(cylX(0.12, 0.64, 12), black, 0, 1.55, 0.0, inferno);
  A(cylX(0.126, 0.34, 12), fuelMat, 0, 1.55, 0.0, inferno, false);
  inferno.visible = false;
  mergeStatic(inferno);

  /* ------------------------------------------------------------------ animation */
  let heat = 0;
  let lastFlame = -1;
  let t = 0;
  const update = (dt: number, s: ClassicRigState) => {
    t += dt;
    spinner.rotation.y += dt * (2.5 + Math.abs(s.speed) * 1.3);
    gauge.scale.y = 0.54 * Math.max(0.03, Math.min(1, s.fill));
    gaugeMat.emissiveIntensity = 2 + 0.6 * Math.sin(t * 3);
    for (const sp of spinners) sp.rotation.y += dt * 9;
    const on = s.flame >= 0;
    inferno.visible = on;
    if (!on) {
      lastFlame = -1;
      heat = 0;
      return;
    }
    // A full charge dropping to empty = Inferno just fired: the burners run hot for the flame's 1.4 s.
    if (lastFlame >= 0.999 && s.flame < 0.05) heat = 1;
    lastFlame = s.flame;
    heat = Math.max(0, heat - dt / 1.6);
    const ready = s.flame >= 1 ? 0.25 + 0.25 * Math.sin(t * 4) : 0;
    fuelMat.emissiveIntensity = 0.5 + 1.3 * s.flame + ready + heat * 2.5;
    nozzleMat.emissiveIntensity = 0.4 + ready * 2 + heat * 4;
  };

  return {
    group,
    parts: { stacks, mirrors, beacon, sheetTrim, frame, setWidth, arms, inferno, metalMats: [chrome, glass, carbide], update },
  };
}
