/* scenes/tidallock/tidal.js — PURE tidal-locking physics for the "tidal-lock" scene.
 *
 * The story the short tells, as a deterministic function of act time t ∈ [0,1]:
 *   1. The young Moon spins fast (R0 rotations per orbit) on a close orbit.
 *   2. Earth's gravity raises tidal bulges on the Moon; friction drags the
 *      bulges ahead of the Earth–Moon line (bulge lag).
 *   3. The lagging bulges pull back on the spin — tidal friction — so the
 *      spin rate decays while the orbit widens (angular momentum is conserved:
 *      the Moon recedes as it despun, like the real 3.8 cm/yr).
 *   4. At T_LOCK the spin period equals the orbital period: the same face
 *      points at Earth forever after (plus a small libration wobble).
 *
 * PURE: no imports, no Math.random / Date.now / performance.now — the
 * engine grep gate stays clean and identical t gives identical state.
 * All angles in radians.
 */

export const TIDAL = Object.freeze({
  R0: 9,            // initial spin: rotations per orbit (young Moon)
  ORBITS: 3.25,     // total orbits traversed across the act
  T_LOCK: 0.70,     // act time of the lock moment (the hero beat)
  R_NEAR: 300,      // orbit radius at t=0 (scene units)
  R_FAR: 430,       // orbit radius at t=1 (the Moon recedes)
  EARTH_R: 60,      // Earth radius (scene units)
  MOON_R: 16.4,     // Moon radius (scene units; ≈ Earth/3.67, the real ratio)
  LAG_MAX: 0.42,    // max tidal-bulge lag angle, rad (~24°, early act)
  LIBRATION: 0.10,  // post-lock wobble amplitude, rad
});

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoothstep01(x) {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

function wrapPi(a) {
  const TAU = Math.PI * 2;
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
}

/** Spin rate in rotations-per-orbit at act time t. 9 → 1, locked after T_LOCK. */
export function spinRateAt(t) {
  const { R0, T_LOCK } = TIDAL;
  t = clamp01(t);
  if (t >= T_LOCK) return 1;
  const u = 1 - t / T_LOCK;
  return 1 + (R0 - 1) * u * u;
}

/**
 * Moon spin angle (rad) at act time t — the analytic integral of spinRate
 * over the orbit, plus a phase constant C so the marked face points exactly
 * at Earth at the lock moment (and therefore for all t ≥ T_LOCK, since both
 * angles then advance together). PURE and exact — no numeric drift.
 */
export function spinAngleAt(t) {
  const { R0, ORBITS, T_LOCK } = TIDAL;
  const TAU = Math.PI * 2;
  t = clamp01(t);
  // ∫₀ˢ spinRate(v) dv, with spinRate = 1 + (R0-1)(1-v/T_LOCK)² on [0,T_LOCK]
  let integral;
  if (t <= T_LOCK) {
    const u = 1 - t / T_LOCK;
    integral = t + ((R0 - 1) * T_LOCK * (1 - u * u * u)) / 3;
  } else {
    integral = T_LOCK + ((R0 - 1) * T_LOCK) / 3 + (t - T_LOCK);
  }
  const raw = TAU * ORBITS * integral;
  // Phase constant: exact face-to-Earth alignment at the lock moment.
  const rawLock = TAU * ORBITS * (T_LOCK + ((R0 - 1) * T_LOCK) / 3);
  const C = TAU * ORBITS * T_LOCK + Math.PI - rawLock;
  return raw + C;
}

/** Orbit angle (rad) at act time t — uniform circular motion. */
export function orbitAngleAt(t) {
  return Math.PI * 2 * TIDAL.ORBITS * clamp01(t);
}

/** Orbit radius at act time t — the Moon recedes as it despins. */
export function orbitRadiusAt(t) {
  const { R_NEAR, R_FAR } = TIDAL;
  return R_NEAR + (R_FAR - R_NEAR) * smoothstep01(t);
}

/** Tidal-bulge lag angle (rad): big early, zero once locked. */
export function bulgeLagAt(t) {
  const { R0, LAG_MAX } = TIDAL;
  const f = clamp01((spinRateAt(t) - 1) / (R0 - 1));
  return LAG_MAX * f;
}

/** Tidal-bulge amplitude: strongest on the close early orbit. */
export function bulgeAmpAt(t) {
  return 1 - 0.55 * smoothstep01(t);
}

/** Resonant swell centered on the lock moment — drives the gong + bloom pulse. */
export function lockPulseAt(t) {
  const d = (clamp01(t) - TIDAL.T_LOCK) / 0.045;
  return Math.exp(-d * d);
}

/** Post-lock libration wobble (rad): the real Moon nods ±~8° as seen from Earth. */
export function librationAt(t) {
  const { T_LOCK, LIBRATION } = TIDAL;
  t = clamp01(t);
  if (t <= T_LOCK) return 0;
  const fade = Math.min(1, (t - T_LOCK) / 0.08);
  return LIBRATION * fade * Math.sin(((t - T_LOCK) * Math.PI * 2 * 1.5) / (1 - T_LOCK));
}

/**
 * Full tidal state at act time t. Frozen plain object — safe to cache, diff,
 * and feed to the audio cues. moonX/moonZ is the Moon's position (Earth sits
 * at the origin, orbit in the XZ plane).
 */
export function tidalState(t) {
  t = clamp01(t);
  const orbitAngle = orbitAngleAt(t);
  const orbitRadius = orbitRadiusAt(t);
  const spinAngle = spinAngleAt(t);
  const moonX = Math.cos(orbitAngle) * orbitRadius;
  const moonZ = Math.sin(orbitAngle) * orbitRadius;
  // Facing error: angle between the marked face and the Earth direction.
  // Zero for all t ≥ T_LOCK by construction (plus libration, applied visually).
  const facingError = wrapPi(spinAngle - (orbitAngle + Math.PI));
  return Object.freeze({
    t,
    orbitAngle,
    orbitRadius,
    spinAngle,
    spinRate: spinRateAt(t),
    bulgeLag: bulgeLagAt(t),
    bulgeAmp: bulgeAmpAt(t),
    lockPulse: lockPulseAt(t),
    libration: librationAt(t),
    moonX,
    moonZ,
    facingError,
  });
}
