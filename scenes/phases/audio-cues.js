/* scenes/phases/audio-cues.js — PURE sound-cue functions for the phases scene.
 *
 * The score is a pure function of act time t ∈ [0,1]: scrubbing the scroll
 * scrubs the sound exactly like the picture. Shared driver voice layout
 * (../tidallock/audio-driver.js): rumble / shimmer / drone / heartbeat /
 * chime. Gentle by design — moonlight, not melodrama.
 * PURE: no hardware, no clocks, no randomness.
 */

import { illuminationAt, earthshineAt } from './phases.js';

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Cue parameters at act time t. All gains ∈ [0,1], frequencies in Hz. Frozen. */
export function audioCueAt(t) {
  t = clamp01(t);
  const illum = illuminationAt(t);
  const shine = earthshineAt(t);

  // Low moonlit pad — breathes with the lit fraction.
  const rumbleHz = 30 + 10 * illum;
  const rumbleGain = 0.10 + 0.14 * illum;

  // Moonlight shimmer on the bright limb; a ghost of it in earthshine.
  const shimmerHz = 1500 + 900 * illum;
  const shimmerGain = 0.28 * illum + 0.20 * shine;

  // The slow turning of the month.
  const droneHz = 72;
  const droneGain = 0.12 + 0.10 * Math.sin(t * Math.PI) ** 2;

  // Full moon: one soft gong as the face comes fully alight.
  const d = (t - 0.5) / 0.022;
  const chime = Math.exp(-d * d) * 0.8;

  // No heartbeat in this quiet act.
  const heartbeat = 0;

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
