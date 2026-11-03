/* scenes/formation/audio-cues.js — PURE sound-cue functions for the formation scene.
 *
 * The score is a pure function of act time t ∈ [0,1], so scrubbing the
 * scroll scrubs the sound exactly like the picture. The WebAudio driver is
 * shared with the tidal-lock scene (../tidallock/audio-driver.js) — this
 * module only computes the cue parameters in that driver's voice layout:
 * rumble / shimmer / drone / heartbeat / chime.
 *
 * PURE: no imports of hardware, no clocks, no randomness.
 */

import { FORMATION, impactPulseAt, diskDensityAt, heatAt, moonRadiusAt } from './formation.js';

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
  const { T_IMPACT, T_DISK, T_COALESCE, MOON_R } = FORMATION;
  const impact = impactPulseAt(t);
  const disk = diskDensityAt(t);
  const heat = heatAt(t);
  const grown = moonRadiusAt(t) / MOON_R; // 0 → 1 as the Moon gathers

  // The approach: a deep rumble that RISES in pitch as Theia falls in —
  // gravity's own doppler — then detonates at the impact.
  const approach = t < T_IMPACT ? sstep(0, T_IMPACT, t) : 0;
  const rumbleHz = 28 + 44 * approach + 30 * impact;
  const rumbleGain = 0.16 + 0.34 * approach + 0.5 * impact;

  // Molten shimmer: the glowing disk and the magma Moon, cooling with heat.
  const shimmerHz = 300 + 1100 * heat;
  const shimmerGain = 0.42 * disk * heat + 0.30 * grown * heat;

  // Coalescence drone: swells while the disk gathers into a world, releases after.
  const droneGain = 0.10 + 0.50 * sstep(T_DISK, T_COALESCE, t) * (1 - sstep(0.84, 0.97, t));
  const droneHz = 96 + 30 * sstep(T_IMPACT, T_DISK, t);

  // The impact hit: the driver's edge-triggered gong, struck on the pulse.
  const chime = impact;

  // A slow gathering pulse while the Moon accretes — one thump per orbit.
  const accreting = sstep(0.44, 0.52, t) * (1 - sstep(T_COALESCE, 0.9, t));
  const heartbeat = accreting * Math.pow(0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 3), 6);

  return Object.freeze({
    t,
    rumbleHz,
    rumbleGain: Math.min(1, rumbleGain),
    shimmerHz,
    shimmerGain: Math.min(1, shimmerGain),
    droneHz,
    droneGain,
    chime,
    heartbeat,
  });
}
