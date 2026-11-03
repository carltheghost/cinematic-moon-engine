/* scenes/phases/phases.js — PURE phase-cycle physics for the "phases" scene.
 *
 * The story, as a deterministic function of act time t ∈ [0,1]:
 *   one full synodic month — the Moon circles Earth once while sunlight
 *   streams from a fixed direction, so an Earth-bound viewer watches the
 *   lit fraction wax and wane: new → crescent → quarter → gibbous →
 *   full → gibbous → quarter → crescent → new.
 *
 * The nine chapters put every named phase exactly on a keyframe
 * (phase k sits at t = k/8), so the captions never lie about the picture.
 * Near new moon, earthshine — sunlight bounced off Earth's day side —
 * ghosts the dark limb, as it really does.
 *
 * PURE: no imports, no Math.random / Date.now / performance.now.
 * All angles in radians, distances in scene units.
 */

export const PHASES = Object.freeze({
  EARTH_R: 60,      // Earth radius
  MOON_R: 16.4,     // Moon radius
  MOON_ORBIT: 430,  // Moon orbit radius
});

export const PHASE_NAMES = Object.freeze([
  'New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
  'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent',
]);

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Moon orbit angle — one full circuit across the act. */
export function moonAngleAt(t) {
  return Math.PI * 2 * clamp01(t);
}

/** Moon position (orbit in the XZ plane, Earth at the origin). */
export function moonPosAt(t) {
  const a = moonAngleAt(t);
  const R = PHASES.MOON_ORBIT;
  return { x: Math.cos(a) * R, y: 0, z: Math.sin(a) * R };
}

/** Lit fraction of the disc as seen from Earth: 0 at new, 1 at full. */
export function illuminationAt(t) {
  return (1 - Math.cos(Math.PI * 2 * clamp01(t))) / 2;
}

/** Earthshine on the dark limb — strongest near new moon. */
export function earthshineAt(t) {
  const dark = 1 - illuminationAt(t);
  return 0.6 * dark * dark;
}

/** Named phase nearest act time t. */
export function phaseNameAt(t) {
  const i = Math.round(clamp01(t) * 8) % 8;
  return PHASE_NAMES[i];
}

/**
 * Full phase state at act time t. Frozen plain object — safe to cache,
 * diff, and feed to the audio cues.
 */
export function phaseState(t) {
  t = clamp01(t);
  const moon = moonPosAt(t);
  return Object.freeze({
    t,
    moonAngle: moonAngleAt(t),
    moonX: moon.x,
    moonY: moon.y,
    moonZ: moon.z,
    illumination: illuminationAt(t),
    earthshine: earthshineAt(t),
    phaseName: phaseNameAt(t),
  });
}
