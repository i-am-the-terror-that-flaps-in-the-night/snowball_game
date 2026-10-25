import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { StaticBatch, bakeGeometry, flipWinding, mergeBaked, mergeStatic, relativeMatrix } from '../src/render/mergeStatic';
import { ShadowProxy, canProxy, installShadowProxies, makeShadowProxy, setShadowPass, shadowProxyMaterial } from '../src/render/shadowProxy';
import { Palette, paletteEligible } from '../src/render/palette';

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

/** World-space triangles (as sorted vertex triples + face normal from the winding) of a mesh or of a geometry
 *  under a matrix: equal sets mean the same surface with the same front faces. */
function worldTris(g: THREE.BufferGeometry, m: THREE.Matrix4): string[] {
  const p = g.getAttribute('position');
  const n = g.index ? g.index.count : p.count;
  const out: string[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3();
  const r = (v: number) => (Math.abs(v) < 5e-4 ? 0 : Math.round(v * 1000) / 1000);
  for (let i = 0; i < n; i += 3) {
    const ix = (k: number) => (g.index ? g.index.getX(i + k) : i + k);
    a.fromBufferAttribute(p, ix(0)).applyMatrix4(m);
    b.fromBufferAttribute(p, ix(1)).applyMatrix4(m);
    c.fromBufferAttribute(p, ix(2)).applyMatrix4(m);
    nrm.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
    const verts = [a, b, c].map((v) => `${r(v.x)},${r(v.y)},${r(v.z)}`).sort().join(' ');
    out.push(`${verts} n${r(nrm.x)},${r(nrm.y)},${r(nrm.z)}`);
  }
  return out;
}

function meshTris(mesh: THREE.Mesh): string[] {
  mesh.updateWorldMatrix(true, false);
  // three renders det < 0 objects with flipped front faces; fold that into the reference winding.
  const t = worldTris(mesh.geometry, mesh.matrixWorld);
  if (mesh.matrixWorld.determinant() >= 0) return t;
  return t.map((s) => s.replace(/n(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)$/, (_, x, y, z) => `n${-x || 0},${-y || 0},${-z || 0}`));
}

function buildRig() {
  const root = new THREE.Group();
  root.position.set(3, 1, -2);
  root.rotation.y = 0.7;
  const matA = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const matB = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
  const box = new THREE.BoxGeometry(1, 2, 1);
  const sphere = new THREE.SphereGeometry(0.5, 8, 6).toNonIndexed();
  const sub = new THREE.Group();
  sub.position.set(0, 2, 0);
  sub.scale.set(1, 1, 1.5);
  root.add(sub);
  const parts: THREE.Mesh[] = [];
  const add = (parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x: number, cast = true) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.x = x;
    mesh.rotation.z = x * 0.3;
    mesh.castShadow = cast;
    parent.add(mesh);
    parts.push(mesh);
    return mesh;
  };
  add(root, box, matA, 0);
  add(root, sphere, matA, 2); // non-indexed, shares matA with an indexed box
  add(sub, box, matA, -2).scale.x = -1; // mirrored
  add(sub, box, matB, 1);
  add(root, box, matB, 4, false); // different cast flag -> own bucket
  return { root, matA, matB, box, sphere, parts };
}

describe('bakeGeometry / flipWinding', () => {
  it('bakes the transform, indexes non-indexed input and keeps front faces under a mirror', () => {
    const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const m = new THREE.Matrix4().compose(new THREE.Vector3(1, 2, 3), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.4, 0)), new THREE.Vector3(-1, 2, 1));
    const baked = bakeGeometry(g, m);
    expect(baked.index).not.toBeNull();
    expect(tris(baked)).toBe(12);
    const ref = new THREE.Mesh(g);
    ref.applyMatrix4(m);
    expect(worldTris(baked, new THREE.Matrix4()).sort()).toEqual(meshTris(ref).sort());
    // the source is untouched
    expect(g.index).toBeNull();
    expect(g.getAttribute('position').getX(0)).toBe(new THREE.BoxGeometry(1, 1, 1).toNonIndexed().getAttribute('position').getX(0));
  });

  it('flipWinding reverses every triangle', () => {
    const g = new THREE.PlaneGeometry(1, 1);
    const before = Array.from(g.index!.array);
    flipWinding(g);
    const after = Array.from(g.index!.array);
    for (let i = 0; i < before.length; i += 3) expect(after.slice(i, i + 3)).toEqual([before[i], before[i + 2], before[i + 1]]);
  });

  it('relativeMatrix composes local matrices up to the root', () => {
    const { root, parts } = buildRig();
    const scene = new THREE.Scene();
    scene.add(root);
    scene.updateMatrixWorld(true);
    const rel = relativeMatrix(parts[2], root);
    const expected = root.matrixWorld.clone().invert().multiply(parts[2].matrixWorld);
    rel.elements.forEach((v, i) => expect(v).toBeCloseTo(expected.elements[i], 6));
    expect(() => relativeMatrix(parts[0], new THREE.Group())).toThrow();
  });
});

describe('mergeStatic', () => {
  it('merges per material + flags; merged triangles equal the sum of the parts, same world surface and bounds', () => {
    const { root, matA, matB, parts } = buildRig();
    const scene = new THREE.Scene();
    scene.add(root);
    const refTris = new Map<THREE.Material, string[]>();
    const box3 = new THREE.Box3().setFromObject(root, true);
    for (const p of parts.slice(0, 4)) refTris.set(p.material as THREE.Material, [...(refTris.get(p.material as THREE.Material) ?? []), ...meshTris(p)]);
    const res = mergeStatic(root);
    // matA: 3 casting parts -> one mesh; matB: one casting + one non-casting part -> two single-mesh buckets
    expect(res.meshes.length).toBe(1);
    expect(res.sources.length).toBe(3);
    const merged = res.meshes[0];
    expect(merged.material).toBe(matA);
    expect(merged.parent).toBe(root);
    expect(merged.castShadow).toBe(true);
    expect(tris(merged.geometry)).toBe(2 * tris(parts[0].geometry) + tris(parts[1].geometry));
    expect(meshTris(merged).sort()).toEqual(refTris.get(matA)!.sort());
    const after = new THREE.Box3().setFromObject(root, true);
    expect(after.min.distanceTo(box3.min)).toBeLessThan(1e-5);
    expect(after.max.distanceTo(box3.max)).toBeLessThan(1e-5);
    expect(merged.geometry.boundingSphere).not.toBeNull();
    // the matB meshes stay (different cast flags -> single-mesh buckets)
    expect(parts[3].parent).not.toBeNull();
    expect(parts[4].parent).toBe(root);
    expect(matB).toBeTruthy();
    // shared geometry is not disposed / modified
    expect(parts[0].geometry.getAttribute('position').count).toBe(24);
  });

  it('respects keep-sets, hidden meshes and transparency', () => {
    const { root, parts } = buildRig();
    parts[1].visible = false;
    const res = mergeStatic(root, { keep: [parts[2]] });
    expect(res.meshes.length).toBe(0); // matA: 0 + (1 hidden) + (2 kept) -> one mergeable mesh only
    const t = buildRig();
    (t.matA as THREE.Material).transparent = true;
    expect(mergeStatic(t.root).meshes.length).toBe(0);
    expect(mergeStatic(t.root, { transparent: true }).meshes.length).toBe(1);
  });

  it('drops attributes the material never reads and splits on ones it does', () => {
    const mat = new THREE.MeshStandardMaterial();
    const a = bakeGeometry(new THREE.BoxGeometry(), new THREE.Matrix4());
    const b = bakeGeometry(new THREE.BoxGeometry(), new THREE.Matrix4());
    b.deleteAttribute('uv');
    const out = mergeBaked([a, b], mat);
    expect(out.length).toBe(1);
    expect(out[0].getAttribute('uv')).toBeUndefined();
    const vc = new THREE.MeshStandardMaterial({ vertexColors: true });
    const c = bakeGeometry(new THREE.BoxGeometry(), new THREE.Matrix4());
    const d = bakeGeometry(new THREE.BoxGeometry(), new THREE.Matrix4());
    c.setAttribute('color', new THREE.Float32BufferAttribute(new Array(24 * 3).fill(1), 3));
    expect(mergeBaked([c, d], vc).length).toBe(2);
  });

  it('StaticBatch flushes one mesh per bucket with the given flags', () => {
    const mat = new THREE.MeshStandardMaterial();
    const batch = new StaticBatch();
    const geo = new THREE.BoxGeometry();
    for (let i = 0; i < 4; i++) batch.add(geo, new THREE.Matrix4().makeTranslation(i * 2, 0, 0), mat, { castShadow: true, receiveShadow: true });
    batch.add(geo, new THREE.Matrix4().makeScale(-1, 1, 1), mat, { renderOrder: 2 });
    expect(batch.size).toBe(5);
    const parent = new THREE.Group();
    const meshes = batch.flush(parent);
    expect(meshes.length).toBe(2);
    expect(parent.children.length).toBe(2);
    const big = meshes.find((m) => m.castShadow)!;
    expect(big.receiveShadow).toBe(true);
    expect(tris(big.geometry)).toBe(48);
    expect(big.geometry.boundingBox!.min.x).toBeCloseTo(-0.5);
    expect(big.geometry.boundingBox!.max.x).toBeCloseTo(6.5);
    const mirrored = meshes.find((m) => m.renderOrder === 2)!;
    const ref = new THREE.Mesh(geo);
    ref.scale.x = -1;
    expect(meshTris(mirrored).sort()).toEqual(meshTris(ref).sort());
    expect(batch.size).toBe(0);
    expect(geo.getAttribute('position').getX(0)).toBe(0.5); // source untouched
  });
});

describe('shadow proxies', () => {
  it('proxy materials are visible only while the wrapped shadow pass runs', () => {
    const seen: boolean[] = [];
    const mat = shadowProxyMaterial();
    const fake = { shadowMap: { render: () => void seen.push(mat.visible, shadowProxyMaterial(THREE.DoubleSide).visible) } };
    expect(mat.visible).toBe(false);
    installShadowProxies(fake);
    installShadowProxies(fake); // idempotent
    fake.shadowMap.render();
    expect(seen).toEqual([true, true]);
    expect(mat.visible).toBe(false);
    expect(shadowProxyMaterial(THREE.DoubleSide).visible).toBe(false);
    // a throwing pass still restores the main-pass state
    const bad = { shadowMap: { render: () => { throw new Error('x'); } } };
    installShadowProxies(bad);
    expect(() => bad.shadowMap.render()).toThrow();
    expect(mat.visible).toBe(false);
    setShadowPass(true);
    expect(mat.visible).toBe(true);
    setShadowPass(false);
  });

  it('merges casters (incl. instances) per depth side, disables the sources, skips non-proxyable ones', () => {
    const { root, parts } = buildRig();
    const ds = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
    const blade = new THREE.Mesh(new THREE.PlaneGeometry(2, 1), ds);
    blade.castShadow = true;
    root.add(blade);
    const cut = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: new THREE.Texture(), alphaTest: 0.5 }));
    cut.castShadow = true;
    root.add(cut);
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(), parts[0].material as THREE.Material, 3);
    for (let i = 0; i < 3; i++) inst.setMatrixAt(i, new THREE.Matrix4().makeTranslation(0, 0, i * 3));
    inst.castShadow = true;
    root.add(inst);
    expect(canProxy(cut)).toBe(false);
    const refFront = [...parts.slice(0, 4).flatMap(meshTris)];
    const proxies = makeShadowProxy(root, root);
    expect(proxies.length).toBe(2);
    const front = proxies.find((p) => p.material.side === THREE.FrontSide)!;
    const double = proxies.find((p) => p.material.side === THREE.DoubleSide)!;
    expect(front.material).toBe(shadowProxyMaterial());
    expect(Object.keys(front.geometry.attributes)).toEqual(['position']);
    expect(tris(front.geometry)).toBe(6 * tris(parts[0].geometry) + tris(parts[1].geometry));
    expect(tris(double.geometry)).toBe(2);
    for (const p of proxies) root.add(p);
    // front-side proxy covers the same world triangles as the casting parts (+ instances)
    const got = meshTris(front);
    for (const t of refFront) expect(got).toContain(t);
    expect(parts.slice(0, 4).every((p) => !p.castShadow)).toBe(true);
    expect(parts[4].castShadow).toBe(false); // was never a caster
    expect(cut.castShadow).toBe(true);
    expect(inst.castShadow).toBe(false);
    expect(front.castShadow && !front.receiveShadow).toBe(true);
    // never raycast; clone shares geometry + stand-in
    const hits: THREE.Intersection[] = [];
    front.raycast(new THREE.Raycaster(), hits);
    expect(hits.length).toBe(0);
    const c = front.clone();
    expect(c).toBeInstanceOf(ShadowProxy);
    expect(c.geometry).toBe(front.geometry);
    expect(c.material).toBe(front.material);
  });

  it('builds a proxy straight from a geometry', () => {
    const [p] = makeShadowProxy(new THREE.BoxGeometry(2, 2, 2).toNonIndexed());
    expect(tris(p.geometry)).toBe(12);
    expect(p.geometry.boundingSphere!.radius).toBeCloseTo(Math.sqrt(3));
  });
});

describe('palette', () => {
  it('dedupes entries and stores the exact uniform values', () => {
    const pal = new Palette({ size: 4 });
    const a = new THREE.MeshStandardMaterial({ color: 0x336699, roughness: 0.4, metalness: 0.2, emissive: 0x110000, emissiveIntensity: 2 });
    const b = a.clone();
    const c = new THREE.MeshStandardMaterial({ color: 0x123456 });
    expect(pal.entry(a)).toBe(0);
    expect(pal.entry(b)).toBe(0);
    expect(pal.entry(c)).toBe(1);
    const data = pal.material.map!.image.data as Float32Array;
    expect(Array.from(data.slice(0, 3))).toEqual([Math.fround(a.color.r), Math.fround(a.color.g), Math.fround(a.color.b)]);
    const e = (pal.material.emissiveMap!.image.data as Float32Array).slice(0, 3);
    expect(e[0]).toBe(Math.fround(a.emissive.r * 2));
    const rm = (pal.material.roughnessMap!.image.data as Float32Array).slice(0, 3);
    expect([rm[1], rm[2]]).toEqual([Math.fround(0.4), Math.fround(0.2)]);
    expect(pal.material.metalnessMap).toBe(pal.material.roughnessMap);
    expect(pal.uv(1).toArray()).toEqual([1.5 / 4, 0.5 / 4]);
    const g = pal.apply(new THREE.BoxGeometry(), c);
    expect(g.getAttribute('uv').getX(7)).toBe(1.5 / 4);
    for (let i = 2; i < 16; i++) pal.entry(new THREE.MeshStandardMaterial({ roughness: i / 100 }));
    expect(() => pal.entry(new THREE.MeshStandardMaterial({ roughness: 0.99 }))).toThrow();
  });

  it('only accepts static-looking opaque untextured standard materials', () => {
    const p = { side: THREE.FrontSide as THREE.Side, flatShading: false };
    expect(paletteEligible(new THREE.MeshStandardMaterial(), p)).toBe(true);
    expect(paletteEligible(new THREE.MeshStandardMaterial({ flatShading: true }), p)).toBe(false);
    expect(paletteEligible(new THREE.MeshStandardMaterial({ map: new THREE.Texture() }), p)).toBe(false);
    expect(paletteEligible(new THREE.MeshStandardMaterial({ transparent: true }), p)).toBe(false);
    expect(paletteEligible(new THREE.MeshPhysicalMaterial(), p)).toBe(false);
    expect(paletteEligible(new THREE.MeshBasicMaterial(), p)).toBe(false);
  });
});
