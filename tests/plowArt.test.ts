import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyWear } from '../src/render/kit/wear';
import { installPinstripe } from '../src/entities/plow/pinstripe';
import { installPlowWear, plowWearFor, PLOW_MIRROR_WEAR, PLOW_PAINT_WEAR } from '../src/entities/plow/plowWear';
import { buildClassicVehicle } from '../src/entities/vehicles/classic';
import { buildIsotopeVehicle } from '../src/entities/vehicles/isotope';
import { kitBox } from '../src/entities/vehicles/types';
import type { VehicleBuildIn } from '../src/entities/vehicles/types';

/* Art pass on the plows (docs/art-pass.md): the wear layer composes with the Paint Shop's pinstripe patch, the
 * classification keeps lit-up / see-through parts clean, mirror paints drop the scuffs, and the bevelled bodies keep
 * their draw counts (one mesh per material + draw state, as before the pass). */

const shader = () => ({
  uniforms: {} as Record<string, { value: unknown }>,
  vertexShader: '#include <common>\n#include <begin_vertex>\n#include <project_vertex>',
  fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <emissivemap_fragment>',
});
const renderer = {} as THREE.WebGLRenderer;

describe('plow wear layer', () => {
  it('composes with the pinstripe patch: one onBeforeCompile, both patches, a combined program key', () => {
    const m = new THREE.MeshStandardMaterial();
    const frame = { value: new THREE.Matrix4() };
    applyWear(m, PLOW_PAINT_WEAR, frame);
    expect(m.customProgramCacheKey()).toBe('kitWear1f');
    installPinstripe(m, new THREE.Object3D());
    expect(m.customProgramCacheKey()).toBe('kitWear1f|plow-pinstripe');
    const sh = shader();
    m.onBeforeCompile(sh as unknown as THREE.WebGLProgramParametersWithUniforms, renderer);
    expect(sh.uniforms.kwWear).toBeDefined();
    expect(sh.uniforms.kwFrame).toBe(frame);
    expect(sh.uniforms.uPinOn).toBeDefined();
    expect(sh.fragmentShader).toContain('kwNoise');
    expect(sh.fragmentShader).toContain('uPinOn');
    expect(sh.vertexShader).toContain('vKwY');
    expect(sh.vertexShader).toContain('vPinP');
  });

  it('a plain pinstripe material keeps its own key and only its own patch', () => {
    const m = new THREE.MeshStandardMaterial();
    installPinstripe(m, new THREE.Object3D());
    expect(m.customProgramCacheKey()).toBe('plow-pinstripe');
    const sh = shader();
    m.onBeforeCompile(sh as unknown as THREE.WebGLProgramParametersWithUniforms, renderer);
    expect(sh.fragmentShader).not.toContain('kwNoise');
  });

  it('bots keep the object-space wear program', () => {
    const m = applyWear(new THREE.MeshStandardMaterial(), { grime: 0.5, mottle: 0.1, scuff: 0.4 });
    expect(m.customProgramCacheKey()).toBe('kitWear1');
    const sh = shader();
    m.onBeforeCompile(sh as unknown as THREE.WebGLProgramParametersWithUniforms, renderer);
    expect(sh.uniforms.kwFrame).toBeUndefined();
    expect(sh.fragmentShader).toContain('#define vKwY vKwPos.y');
  });

  it('classification: glowing, see-through and cut-out parts stay clean; chrome and rubber never scuff', () => {
    expect(plowWearFor(new THREE.MeshStandardMaterial({ emissive: 0xffaa00, emissiveIntensity: 2 }))).toBeNull();
    expect(plowWearFor(new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5 }))).toBeNull();
    expect(plowWearFor(new THREE.MeshStandardMaterial({ alphaTest: 0.5 }))).toBeNull();
    expect(plowWearFor(new THREE.MeshBasicMaterial())).toBeNull();
    const off = new THREE.MeshStandardMaterial();
    off.userData.noWear = true;
    expect(plowWearFor(off)).toBeNull();
    expect(plowWearFor(new THREE.MeshStandardMaterial({ metalness: 0.9, roughness: 0.15 }))!.scuff).toBe(0);
    expect(plowWearFor(new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.9 }))!.scuff).toBe(0);
    expect(plowWearFor(new THREE.MeshStandardMaterial({ color: 0xffc814, roughness: 0.45 }))).not.toBeNull();
  });

  it('install: painted materials follow the paint (mirror = no scuffs), the rest by kind; skipped subtrees, instanced and double-sided parts untouched', () => {
    const body = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ emissive: 0xff0000, emissiveIntensity: 0 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.5 });
    const lamp = new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 1.5 });
    const ghost = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.5 });
    const geo = new THREE.BoxGeometry();
    const skipped = new THREE.Group();
    skipped.add(new THREE.Mesh(geo, ghost));
    // Instanced and double-sided users would each add a program variant: those materials stay unworn.
    const tyre = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.9 });
    const sheet = new THREE.MeshStandardMaterial({ color: 0xd4dce4, side: THREE.DoubleSide });
    body.add(new THREE.Mesh(geo, paint), new THREE.Mesh(geo, steel), new THREE.Mesh(geo, lamp), skipped);
    body.add(new THREE.Mesh(geo, tyre), new THREE.InstancedMesh(geo, tyre, 4), new THREE.Mesh(geo, sheet));
    const w = installPlowWear({ body, roots: [body], painted: [paint], skip: [skipped] });
    expect(w.materials).toEqual([paint, steel]);
    expect(tyre.userData.kitWear).toBeUndefined();
    expect(sheet.userData.kitWear).toBeUndefined();
    expect(lamp.userData.kitWear).toBeUndefined();
    expect(ghost.userData.kitWear).toBeUndefined();
    const v = paint.userData.kitWear.kwWear.value as THREE.Vector4;
    w.setPaint(true);
    expect(v.z).toBe(PLOW_MIRROR_WEAR.scuff);
    expect(v.z).toBe(0);
    w.setPaint(false);
    expect(v.z).toBe(PLOW_PAINT_WEAR.scuff);
  });
});

/** Draws a built body adds: meshes that render (not hidden, not the depth-only shadow proxies). */
function draws(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.visible && !(o as { isShadowProxy?: boolean }).isShadowProxy) n++;
  });
  return n;
}

function vin(): VehicleBuildIn {
  const std = (c: number) => new THREE.MeshStandardMaterial({ color: c });
  return {
    mats: { paint: std(0xffc814), trim: std(0x23272e), dark: std(0x2b2f38), glass: std(0x1b2a40), chrome: std(0xc9d2dc), coil: std(0x9fe8ff), hub: std(0xffd23a), head: std(0xfff6d0) },
    chassis: kitBox(1.7, 0.35, 4.0),
  };
}

describe('bevelled vehicle bodies keep their draws', () => {
  // Counts from before the art pass (art/stage0): the kit parts merge into the existing per-material meshes.
  it('Classic body', () => {
    const c = buildClassicVehicle(vin(), { beacon: new THREE.MeshStandardMaterial({ transparent: true }), steel: new THREE.MeshStandardMaterial() });
    expect(draws(c.group)).toBe(CLASSIC_DRAWS);
    c.parts.setWidth(3.2);
    expect(draws(c.parts.frame)).toBe(7);
    expect(draws(c.parts.sheetTrim)).toBe(SHEET_DRAWS);
    expect(draws(c.parts.arms)).toBe(ARMS_DRAWS);
  });

  it('ISOTOPE body', () => {
    expect(draws(buildIsotopeVehicle(vin()).group)).toBe(ISO_DRAWS);
  });

  it('kit shapes are shared and never transformed in place', () => {
    const a = kitBox(1, 0.5, 2).getAttribute('position').array.slice();
    buildClassicVehicle(vin(), { beacon: new THREE.MeshStandardMaterial({ transparent: true }), steel: new THREE.MeshStandardMaterial() });
    expect(kitBox(1, 0.5, 2).getAttribute('position').array).toEqual(a);
  });
});

const CLASSIC_DRAWS = 33;
const SHEET_DRAWS = 4;
const ARMS_DRAWS = 2;
const ISO_DRAWS = 22;
