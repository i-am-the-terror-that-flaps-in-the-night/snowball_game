import type * as THREE from 'three';
import { compileBloomChain, withScenePass } from './post';

/* Shader / pipeline warm-up: compile every program a scene needs before it is first drawn, so the first Inferno,
 * the first ARSENAL ultimate, the first kill or a boss's props don't stall a frame on a synchronous shader compile.
 *
 * Warmup itself only knows a compiler with three's compileAsync(object, camera, targetScene) contract (WebGLRenderer
 * has it, and so does WebGPURenderer); a backend supplies the renderer-specific parts: the render state the frame's
 * scene pass runs under (the program key depends on tone mapping and the target's colour space) and compile jobs for
 * anything drawn outside the scene (post-processing). webglBackend() is the one the game uses.
 *
 * Rules a backend keeps (determinism of the headless probes and of gameplay RNG):
 *  - no objects / render targets are created and nothing is resized here: three's generateUUID draws Math.random,
 *    and a warm-up may run from an idle callback at any time;
 *  - any state change is made and restored synchronously, never across an await.
 * Off-scene objects (the "warm set": lazily used effects that are not in the scene yet) are passed as `extras` and
 * compiled against the scene's lights. compile() in WebGL builds the colour programs only, not shadow-depth ones. */

export interface ShaderCompiler {
  compileAsync(object: THREE.Object3D, camera: THREE.Camera, targetScene?: THREE.Object3D | null): Promise<unknown>;
}

export interface WarmBackend {
  readonly compiler: ShaderCompiler;
  /** Run `fn` (synchronous) under the render state of the frame's scene pass and restore it before returning. */
  scenePass<T>(fn: () => T): T;
  /** Compile jobs for programs drawn outside the scene (post-processing); [] when there are none. */
  passes(): Promise<unknown>[];
}

/** Longest the frame may hold its render back while a warm-up compiles (Game.frame; tick() never waits). */
export const WARM_GATE_MS = 400;
/** ... and at most this many frames (the clock may be frozen, e.g. in a probe). */
export const WARM_GATE_FRAMES = 30;

export class Warmup {
  /** Off (e.g. ?nowarm, for measuring): warm() does nothing. */
  enabled = true;
  private pending = 0;
  private since = -Infinity;
  private held = 0;

  constructor(private readonly backend: WarmBackend) {}

  /** Compile `scene` (plus `extras`, off-scene objects lit by the scene) under the frame's state, and the backend's
   *  extra passes. `lightStates`: scene states that change the visible light count during play (each applies its
   *  change and returns the undo); the scene is compiled once more under each, since the number of lights is part of
   *  every lit program. Resolves once every program is ready (or failed: a warm-up never rejects). */
  warm(scene: THREE.Scene, camera: THREE.Camera, extras: readonly THREE.Object3D[] = [], lightStates: readonly (() => () => void)[] = []): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    const { compiler } = this.backend;
    let jobs: Promise<unknown>[];
    try {
      jobs = this.backend.scenePass(() => {
        const j: Promise<unknown>[] = [];
        const all = (): void => {
          j.push(compiler.compileAsync(scene, camera));
          for (const o of extras) j.push(compiler.compileAsync(o, camera, scene));
        };
        all();
        for (const apply of lightStates) {
          const undo = apply();
          try {
            all();
          } finally {
            undo();
          }
        }
        return j;
      });
      jobs.push(...this.backend.passes());
    } catch (e) {
      console.warn('warmup: compile failed', e);
      return Promise.resolve();
    }
    this.pending++;
    this.since = performance.now();
    this.held = 0;
    const done = (): void => {
      this.pending--;
    };
    return Promise.all(jobs).then(done, (e) => {
      done();
      console.warn('warmup:', e);
    });
  }

  /** Programs still compiling. */
  get busy(): boolean {
    return this.pending > 0;
  }

  /** Per frame: true = skip this frame's render (a warm-up started under WARM_GATE_MS / WARM_GATE_FRAMES ago is
   *  still compiling, and drawing now would block on it). */
  holdRender(now: number): boolean {
    if (this.pending === 0 || now - this.since >= WARM_GATE_MS || this.held >= WARM_GATE_FRAMES) return false;
    this.held++;
    return true;
  }
}

/** The WebGL backend: the scene pass and the bloom chain as render/post.ts draws them. */
export function webglBackend(renderer: THREE.WebGLRenderer): WarmBackend {
  const compile = (o: THREE.Object3D, c: THREE.Camera): Promise<unknown> => renderer.compileAsync(o, c);
  return {
    compiler: renderer,
    scenePass: (fn) => withScenePass(renderer, fn),
    passes: () => compileBloomChain(renderer, compile),
  };
}
