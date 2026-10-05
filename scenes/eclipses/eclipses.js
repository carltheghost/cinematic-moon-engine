/* scenes/eclipses/eclipses.js — PURE eclipse geometry for the "eclipses" scene.
 *
 * The story, as a deterministic function of act time t ∈ [0,1]:
 *   1. The alignment: the Moon slides between Earth and Sun near its
 *      ascending node; the Moon's shadow reaches for Earth.
 *   2. Totality (T_SOLAR): the Moon covers the Sun — day becomes night,
 *      the corona blazes, the diamond ring flashes at the shadow's edge.
 *   3. The shadow races on; the Moon climbs above the ecliptic —
 *      the 5° tilt made visible.
 *   4. The tilt: most months the shadow passes above or below — eclipses
 *      are rare because the alignment is.
 *   5. Blood moon (T_LUNAR): at the descending node Earth slides between
 *      Sun and Moon; our shadow swallows it and sunset light paints it red.
 *   6. The shadow's edge leaves; the dance goes on.
 *
 * The Moon's orbit carries the true 5.14° inclination. The orbit phase is
 * chosen so the Moon stands exactly on its nodes at the two eclipse peaks:
 * moonAngle(t) = 2π(t − T_SOLAR), so the ascending node is at T_SOLAR
 * (solar eclipse) and the descending node at T_SOLAR + 1/2 = T_LUNAR
 * (lunar eclipse). Between the nodes the Moon rides up to ±34 units off
 * the Sun–Earth line — the honest reason most months have no eclipse.
 *
 * PURE: no imports, no Math.random / Date.now / performance.now.
 * All angles in radians, distances in scene units.
 */

export const ECLIPSE = Object.freeze({
  T_SOLAR: 0.16,     // total solar eclipse peak (≈ ch2 keyframe)
  T_LUNAR: 0.66,     // total lunar eclipse peak (= ch5 keyframe, 2/3)
  TILT: 0.0897,      // lunar orbit inclination, rad (5.14°)
  SUN_DIST: 4200,    // Sun distance (scene units)
  SUN_R: 230,        // Sun radius
  EARTH_R: 60,       // Earth radius
  MOON_R: 16.4,      // Moon radius
  MOON_ORBIT: 380,   // Moon orbit radius
});

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Moon orbit angle — 0 at the solar-eclipse node, π at the lunar one. */
export function moonAngleAt(t) {
  return Math.PI * 2 * (clamp01(t) - ECLIPSE.T_SOLAR);
}

/** Moon position: inclined orbit, nodes on the Sun–Earth line. */
export function moonPosAt(t) {
  const { MOON_ORBIT, TILT } = ECLIPSE;
  const a = moonAngleAt(t);
  return {
    x: Math.cos(a) * MOON_ORBIT,
    y: Math.sin(a) * Math.sin(TILT) * MOON_ORBIT,
    z: Math.sin(a) * MOON_ORBIT,
  };
}

/** Height off the Sun–Earth line — 0 exactly at both eclipse peaks. */
export function nodeOffsetAt(t) {
  const a = moonAngleAt(t);
  return Math.abs(Math.sin(a)) * Math.sin(ECLIPSE.TILT) * ECLIPSE.MOON_ORBIT;
}

/** Solar eclipse magnitude: 0 → 1 at totality. */
export function solarMagnitudeAt(t) {
  const d = (clamp01(t) - ECLIPSE.T_SOLAR) / 0.045;
  return Math.exp(-d * d);
}

/** Lunar eclipse magnitude (blood): 0 → 1 at totality. */
export function lunarMagnitudeAt(t) {
  const d = (clamp01(t) - ECLIPSE.T_LUNAR) / 0.060;
  return Math.exp(-d * d);
}

/** Penumbra: the broad partial phases around both eclipses. */
export function penumbraAt(t) {
  t = clamp01(t);
  const { T_SOLAR, T_LUNAR } = ECLIPSE;
  const s = Math.exp(-Math.pow((t - T_SOLAR) / 0.11, 2));
  const l = Math.exp(-Math.pow((t - T_LUNAR) / 0.13, 2));
  return Math.min(1, 0.65 * s + 0.65 * l);
}

/** Corona blaze — visible only while the Moon covers the Sun. */
export function coronaAt(t) {
  return solarMagnitudeAt(t);
}

/** Diamond-ring flashes at the shadow's ingress/egress edges. */
export function ringFlashAt(t) {
  t = clamp01(t);
  const { T_SOLAR } = ECLIPSE;
  const w = 0.010;
  const dIn = (t - (T_SOLAR - 0.048)) / w;
  const dOut = (t - (T_SOLAR + 0.048)) / w;
  return Math.exp(-dIn * dIn) + Math.exp(-dOut * dOut);
}

/** Blood-reddening of the Moon — Earth's shadow + sunset light. */
export function bloodAt(t) {
  return lunarMagnitudeAt(t);
}

/**
 * Full eclipse state at act time t. Frozen plain object — safe to cache,
 * diff, and feed to the audio cues.
 */
export function eclipseState(t) {
  t = clamp01(t);
  const moon = moonPosAt(t);
  return Object.freeze({
    t,
    moonAngle: moonAngleAt(t),
    moonX: moon.x,
    moonY: moon.y,
    moonZ: moon.z,
    nodeOffset: nodeOffsetAt(t),
    solar: solarMagnitudeAt(t),
    lunar: lunarMagnitudeAt(t),
    penumbra: penumbraAt(t),
    corona: coronaAt(t),
    ringFlash: Math.min(1.6, ringFlashAt(t)),
    blood: bloodAt(t),
  });
}
