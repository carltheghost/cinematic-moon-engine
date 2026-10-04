/* scenes/tidallock/audio-cues.js — PURE sound-cue functions for the tidal-lock scene.
 *
 * The short Tumbo held as the bar syncs every sound to the picture: rumbles
 * under the spin, a falling pitch as the Moon despins, a resonant hit at the
 * lock moment. These functions map act time t ∈ [0,1] → cue parameters, so
 * the sound is a pure function of scroll position: scrubbing back and forth
 * scrubs the score, exactly like the picture. The WebAudio driver lives in
 * audio-driver.js (host-side); this module never touches audio hardware.
 *
 * PURE: no imports, no clocks, no randomness.
 */

import { TIDAL, spinRateAt, lockPulseAt } from './tidal.js';

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function sstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/**
 * Cue parameters at act time t. All gains ∈ [0,1], all frequencies in Hz.
 * Frozen plain object.
 */
export function audioCueAt(t) {
  t = clamp01(t);
  const { R0, T_LOCK, ORBITS } = TIDAL;
  const spinF = (spinRateAt(t) - 1) / (R0 - 1); // 1 → 0 across the despin
  // Deep sub-bass rumble: pitch FALLS as the spin decays (the money sound).
  const rumbleHz = 26 + 62 * spinF;
  const rumbleGain = 0.22 + 0.30 * spinF;
  // Airy shimmer riding the fast early spin; gone once locked.
  const shimmerHz = 380 + 900 * spinF;
  const shimmerGain = 0.30 * spinF;
  // Tension drone: swells through the slowdown, releases after the lock.
  const droneGain = 0.10 + 0.45 * sstep(0.22, 0.62, t) * (1 - sstep(0.74, 0.92, t));
  const droneHz = 110 - 40 * sstep(0.22, T_LOCK, t);
  // The lock hit: a resonant gong exactly on the lock pulse.
  const chime = lockPulseAt(t);
  // Post-lock heartbeat at the orbital period — one face, one pulse.
  let heartbeat = 0;
  if (t > T_LOCK) {
    const ph = ((t - T_LOCK) * ORBITS * 2 * Math.PI) / (1 - T_LOCK);
    heartbeat = Math.pow(0.5 + 0.5 * Math.sin(ph), 6) * Math.min(1, (t - T_LOCK) / 0.06);
  }
  return Object.freeze({
    t,
    rumbleHz,
    rumbleGain,
    shimmerHz,
    shimmerGain,
    droneHz,
    droneGain,
    chime,
    heartbeat,
  });
}
