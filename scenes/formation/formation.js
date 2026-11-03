/* scenes/formation/formation.js — PURE giant-impact physics for the "formation" scene.
 *
 * The story, as a deterministic function of act time t ∈ [0,1]:
 *   1. Two worlds: proto-Earth and Theia (a Mars-sized wanderer) share the
 *      young solar system; Theia falls inward along a curved approach.
 *   2. The collision (T_IMPACT): Theia strikes at an angle — the energy melts
 *      both worlds. Theia is consumed (its state goes null past the impact).
 *   3. The debris disk: vaporized rock settles into a glowing ring; the disk
 *      is densest just after the impact, then thins as it accretes.
 *   4. Coalescence: moonlets merge — a moon gathers at the disk's outer edge
 *      and grows from nothing to full size.
 *   5. The molten Moon: a magma-ocean world, white-hot, on a close orbit.
 *   6. Cooling: the heat bleeds away, the crust skins over.
 *
 * PURE: no imports, no Math.random / Date.now / performance.now — the engine
 * grep gate stays clean and identical t gives identical state.
 * All angles in radians, all distances in scene units.
 */

export const FORMATION = Object.freeze({
  T_IMPACT: 1 / 3,    // act time of the collision — lands on the ch3 keyframe
  T_DISK: 0.55,      // disk fully formed
  T_COALESCE: 0.80,  // the Moon fully gathered
  EARTH_R: 60,       // proto-Earth radius
  THEIA_R: 30,       // Theia radius (~Mars-sized next to the young Earth)
  MOON_R: 16.4,      // final Moon radius (matches the tidal-lock scene)
  DISK_IN: 100,      // debris disk inner edge
  DISK_OUT: 230,     // debris disk outer edge
  MOON_ORBIT: 195,   // where the Moon gathers (just inside the disk edge)
  ORBITS: 1.6,       // Moon orbits traversed across the act
});

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoothstep01(x) {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

/** Theia's position at act time t — null once consumed by the impact. */
export function theiaAt(t) {
  t = clamp01(t);
  const { T_IMPACT, EARTH_R } = FORMATION;
  if (t >= T_IMPACT) return null;
  const u = t / T_IMPACT; // 0 → 1 along the approach
  const e = u * u * (3 - 2 * u); // smoothstep: slow far, rushing in late
  // Approach from deep -X/+Z, arcing down to strike the +X limb at an angle.
  const sx = -950, sy = 210, sz = -520;
  const ix = EARTH_R * 0.82, iy = EARTH_R * 0.30, iz = EARTH_R * 0.18;
  return {
    x: sx + (ix - sx) * e,
    // a slight downward arc on top of the lerp, so the path curves
    y: sy + (iy - sy) * e - Math.sin(u * Math.PI) * 60,
    z: sz + (iz - sz) * e,
  };
}

/** Impact flash pulse — a tight gaussian on the collision moment. */
export function impactPulseAt(t) {
  const d = (clamp01(t) - FORMATION.T_IMPACT) / 0.030;
  return Math.exp(-d * d);
}

/** Debris-disk density: 0 before the impact, peaks as the disk forms,
 *  then thins as the material accretes into the Moon. */
export function diskDensityAt(t) {
  t = clamp01(t);
  const { T_IMPACT, T_DISK, T_COALESCE } = FORMATION;
  if (t <= T_IMPACT) return 0;
  const rise = smoothstep01((t - T_IMPACT) / (T_DISK - T_IMPACT));
  const accrete = smoothstep01((t - T_DISK) / (T_COALESCE - T_DISK));
  return rise * (1 - 0.78 * accrete);
}

/** Disk inner edge: creeps outward as the hottest material rains back. */
export function diskInnerAt(t) {
  return FORMATION.DISK_IN + 34 * smoothstep01((clamp01(t) - FORMATION.T_IMPACT) / 0.5);
}

/** Disk outer edge: spreads after the impact, then contracts as the Moon gathers. */
export function diskOuterAt(t) {
  const { DISK_OUT, T_IMPACT, T_COALESCE } = FORMATION;
  t = clamp01(t);
  if (t <= T_IMPACT) return DISK_OUT;
  const spread = smoothstep01((t - T_IMPACT) / 0.15);
  const gather = smoothstep01((t - 0.45) / (T_COALESCE - 0.45));
  return DISK_OUT * (1 + 0.18 * spread) - 46 * gather;
}

/** Moon radius: nothing until the disk starts gathering, then 0 → MOON_R. */
export function moonRadiusAt(t) {
  t = clamp01(t);
  const { MOON_R, T_COALESCE } = FORMATION;
  return MOON_R * smoothstep01((t - 0.44) / (T_COALESCE - 0.44));
}

/** Moon orbit angle — the gathering Moon already circles Earth. */
export function moonAngleAt(t) {
  return Math.PI * 2 * FORMATION.ORBITS * clamp01(t) + 0.6;
}

/** Moon orbit radius — gathers just inside the disk's outer edge. */
export function moonOrbitAt(t) {
  return FORMATION.MOON_ORBIT - 26 * (1 - smoothstep01((clamp01(t) - 0.44) / 0.34));
}

/** Heat: warm young worlds, white-hot at the impact, then a long cooling. */
export function heatAt(t) {
  t = clamp01(t);
  const { T_IMPACT } = FORMATION;
  if (t <= T_IMPACT) return 0.30 + 0.70 * smoothstep01(t / T_IMPACT);
  return Math.exp(-(t - T_IMPACT) / 0.34);
}

/**
 * Full formation state at act time t. Frozen plain object — safe to cache,
 * diff, and feed to the audio cues.
 */
export function formationState(t) {
  t = clamp01(t);
  const theia = theiaAt(t);
  const moonR = moonRadiusAt(t);
  const orbitR = moonOrbitAt(t);
  const ang = moonAngleAt(t);
  return Object.freeze({
    t,
    theia: theia ? Object.freeze(theia) : null,
    impactPulse: impactPulseAt(t),
    diskDensity: diskDensityAt(t),
    diskInner: diskInnerAt(t),
    diskOuter: diskOuterAt(t),
    moonRadius: moonR,
    moonX: Math.cos(ang) * orbitR,
    moonZ: Math.sin(ang) * orbitR,
    moonOrbitR: orbitR,
    heat: heatAt(t),
  });
}
