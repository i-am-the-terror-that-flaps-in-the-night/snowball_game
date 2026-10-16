import * as THREE from 'three';

/* Inferno (F) visuals: two nested additive flame cones with scrolling-noise shaders (hot white-yellow core,
 * orange-red outer), a flickering orange point light, and a heat-glow disc on the ground. Apex sits at the
 * plow's blade; the cone opens along the plow's forward. */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uAlpha;
uniform float uSpeed;
uniform vec3 uHot;
uniform vec3 uCool;
uniform float uGain;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float a = 1.0 - vUv.y;                       // 0 at the blade, 1 at the far end
  vec2 q = vec2(vUv.x * 7.0, a * 3.5 - uTime * uSpeed);
  float n = noise(q) * 0.6 + noise(q * 2.3 + 3.1) * 0.4;
  float body = smoothstep(1.0, 0.3, a + n * 0.5) * smoothstep(0.0, 0.06, a);
  vec3 col = mix(uHot, uCool, smoothstep(0.05, 0.85, a + n * 0.25));
  gl_FragColor = vec4(min(col * (uGain + n * 0.5), vec3(1.0)), body * uAlpha * (0.55 + 0.45 * n));
}`;

/** `additive` layers glow; the normal-blended layer keeps the flame's colour readable against white snow. */
function flameMaterial(hot: number, cool: number, speed: number, additive: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uAlpha: { value: 0 },
      uSpeed: { value: speed },
      uHot: { value: new THREE.Color(hot) },
      uCool: { value: new THREE.Color(cool) },
      uGain: { value: additive ? 1.3 : 1.0 },
    },
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
}

/** Unit cone: apex at the origin, opening toward +Z, length 1, end radius 1. */
function coneGeometry(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(1, 1, 28, 6, true);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, 0.5);
  return g;
}

export class FlameCone {
  readonly group = new THREE.Group();
  private outer: THREE.Mesh;
  private inner: THREE.Mesh;
  private outerMat = flameMaterial(0xff9a1a, 0xc81a06, 4.5, false);
  private innerMat = flameMaterial(0xffffff, 0xffb030, 6.5, true);
  private light = new THREE.PointLight(0xff7a2a, 0, 16, 1.6);
  private glow: THREE.Mesh;
  private glowMat = new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  private time = 0;
  private level = 0;

  constructor(scene: THREE.Scene) {
    const geo = coneGeometry();
    this.outer = new THREE.Mesh(geo, this.outerMat);
    this.inner = new THREE.Mesh(geo, this.innerMat);
    this.outer.renderOrder = 6;
    this.inner.renderOrder = 7;
    const glowGeo = new THREE.CircleGeometry(1, 32);
    glowGeo.rotateX(-Math.PI / 2);
    this.glow = new THREE.Mesh(glowGeo, this.glowMat);
    this.group.add(this.outer, this.inner, this.light);
    this.group.visible = false;
    scene.add(this.group);
    scene.add(this.glow);
    this.glow.visible = false;
  }

  /** Call every frame. `active` 0..1 (eases the blast in/out); range in meters; half = cone half-angle. */
  update(dt: number, active: boolean, tip: THREE.Vector3, heading: number, range: number, half: number): void {
    this.time += dt;
    this.level += ((active ? 1 : 0) - this.level) * Math.min(1, dt * (active ? 14 : 8));
    const on = this.level > 0.02;
    this.group.visible = on;
    this.glow.visible = on;
    if (!on) {
      this.light.intensity = 0;
      return;
    }
    const k = this.level;
    const flick = 0.85 + 0.15 * Math.sin(this.time * 37) * Math.sin(this.time * 23 + 1.3);
    const endR = Math.tan(half) * range;
    this.group.position.set(tip.x, tip.y + 0.9, tip.z);
    this.group.rotation.set(0, heading, 0);
    this.outer.scale.set(endR * (0.85 + 0.15 * k), endR * 0.7 * (0.85 + 0.15 * k), range * k);
    this.inner.scale.set(endR * 0.45, endR * 0.32, range * 0.75 * k);
    this.outerMat.uniforms.uTime.value = this.time;
    this.innerMat.uniforms.uTime.value = this.time;
    this.outerMat.uniforms.uAlpha.value = 0.85 * k * flick;
    this.innerMat.uniforms.uAlpha.value = 1.0 * k * flick;
    this.light.position.set(0, 0.6, range * 0.45);
    this.light.intensity = 60 * k * flick;
    this.light.distance = range * 2.4;
    // Heat glow on the ground under the cone.
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    this.glow.position.set(tip.x + fx * range * 0.55, 0.07, tip.z + fz * range * 0.55);
    this.glow.scale.setScalar(endR * 0.9 + 1);
    this.glowMat.opacity = 0.32 * k * flick;
  }

  hide(): void {
    this.level = 0;
    this.group.visible = false;
    this.glow.visible = false;
    this.light.intensity = 0;
  }
}
