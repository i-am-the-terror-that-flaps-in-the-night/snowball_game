/* Build-time work that creates three.js objects (every new Object3D / material / geometry / texture / render target
 * draws Math.random for its UUID) but must not move the gameplay RNG stream: run it under withPrivateRandom, which
 * swaps in a private generator for the duration of a synchronous call. Used by render-only builds that happen in the
 * middle of an arena build (the arena environment map), so the simulation, the Duel and the render probe's gameplay
 * fingerprint (Math.random call count) see exactly the same sequence with or without them. */

let state = 0x5f3759df;

/** mulberry32 on its own state (never reseeded, so its UUIDs never repeat within a session). */
function next(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function withPrivateRandom<T>(fn: () => T): T {
  const r = Math.random;
  Math.random = next;
  try {
    return fn();
  } finally {
    Math.random = r;
  }
}
