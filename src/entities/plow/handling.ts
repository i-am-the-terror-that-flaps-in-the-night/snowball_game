/** High-speed handling (Plow.ts steering / grip, CameraRig speed framing). Tuned so a maxed plow at ~24 m/s holds a
 *  line instead of skating and zig-zagging, while a fresh plow at 10 m/s drives exactly as before. */
export const HANDLING = {
  /** Steering eases off from this speed (m/s) over the next `easeSpan` m/s, down to (1 - highSpeedEase) of the turn
   *  rate for a tap; holding a full turn for `holdFull` s hands back the full rate. */
  easeFrom: 10,
  easeSpan: 14,
  highSpeedEase: 0.4,
  holdFull: 0.45,
  /** Steering input smoothing (1/s): build-up toward a held turn, and the faster release / reversal. */
  steerBuild: 12,
  steerRelease: 22,
  /** Low-grip ground (ice): grip multiplier gained at speed (x(1 + speedGrip) by gripFullAt m/s). */
  speedGrip: 2,
  gripFullAt: 24,
  /** Steering assist: bots within assistRange m and assistCone rad of the nose, above assistMinSpeed m/s; the nudge
   *  is assistGain x the angle off the nose, capped at assistMax (of full steer). */
  assistRange: 16,
  assistCone: 0.6,
  assistMinSpeed: 4,
  assistGain: 0.5,
  assistMax: 0.18,
  /** Camera at speed: from camFrom m/s over camSpan m/s, extra pull-back, height, look-ahead (m) and FOV (deg). */
  camFrom: 9,
  camSpan: 15,
  camBack: 2.2,
  camUp: 0.9,
  camAhead: 4.5,
  camFov: 5,
} as const;

/** Speed-limiter choices (Settings): share of top speed. */
export const SPEED_LIMITS = [1, 0.9, 0.8] as const;
