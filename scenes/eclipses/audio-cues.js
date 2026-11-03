/* scenes/eclipses/audio-cues.js — PURE sound-cue functions for the eclipses scene.
 *
 * The score is a pure function of act time t ∈ [0,1]: scrubbing the scroll
 * scrubs the sound exactly like the picture. Shared driver voice layout
 * (../tidallock/audio-driver.js): rumble / shimmer / drone / heartbeat /
 * chime. PURE: no hardware, no clocks, no randomness.
 */

import {
  ECLIPSE, solarMagnitudeAt, lunarMagnitudeAt, penumbraAt,
  coronaAt, ringFlashAt,
} from './eclipses.js';

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function sstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Cue parameters at act time t. All gains ∈ [0,1], frequencies in Hz. Frozen. */
export function audioCueAt(t) {
  t = clamp01(t);
  const { T_SOLAR, T_LUNAR } = ECLIPSE;
  const solar = solarMagnitudeAt(t);
  const lunar = lunarMagnitudeAt(t);
  const penumbra = penumbraAt(t);
  const corona = coronaAt(t);

  // Deep alignment rumble — the shadow's approach made audible.
  const rumbleHz = 24 + 14 * penumbra;
  const rumbleGain = 0.14 + 0.30 * penumbra;

  // Corona shimmer: high, airy, only while the Sun is covered.
  const shimmerHz = 2400 + 1800 * corona;
  const shimmerGain = 0.45 * corona;

  // Eclipse tension: swells into each totality, releases after.
  const droneGain = 0.08
    + 0.42 * sstep(T_SOLAR - 0.14, T_SOLAR, t) * (1 - sstep(T_SOLAR, T_SOLAR + 0.10, t))
    + 0.42 * sstep(T_LUNAR - 0.16, T_LUNAR, t) * (1 - sstep(T_LUNAR, T_LUNAR + 0.12, t));
  const droneHz = 82 + 26 * penumbra;

  // Diamond ring: the driver's edge-triggered gong, struck on the flash.
  const chime = Math.min(1, ringFlashAt(t));

  // Totality pulse — slow, solemn, one thump per few seconds of screen time.
  const heartbeat = Math.max(solar, lunar) *
    Math.pow(0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 2.5), 6);

  return Object.freeze({
    t,
    rumbleHz,
    rumbleGain,
    shimmerHz,
    shimmerGain,
    droneHz,
    droneGain: Math.min(1, droneGain),
    chime,
    heartbeat,
  });
}
