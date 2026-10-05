/* scenes/tidallock/audio-driver.js — host-side WebAudio driver for the tidal cues.
 *
 * NOT part of the determinism contract: this is presentation, driven by the
 * scroll clock. The cue PARAMETERS are pure (audio-cues.js); this module only
 * renders them. AudioContext is created lazily on the first user gesture
 * (browser autoplay policy) — before that, update() is a silent no-op.
 *
 * Voice design (cinematic, dark):
 *   rumble   — sine sub-bass, the Moon's spin made audible (pitch falls as it despins)
 *   shimmer  — triangle through a lowpass, airy grit on the fast early spin
 *   drone    — detuned saws through a lowpass, tension through the slowdown
 *   heartbeat— 55 Hz sine thump, post-lock orbital pulse
 *   chime    — struck FM-ish gong on the lock moment (edge-triggered)
 */

export function createAudioDriver() {
  let ctx = null;
  let master = null;
  let voices = null;
  let lastChime = 0;
  let armed = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
    } catch (e) { return false; }

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 8;
    comp.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = 0.0; // faded in on first update after gesture
    master.connect(comp);

    const mk = (type, freq) => {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = freq;
      const g = ctx.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(master); o.start();
      return { osc: o, gain: g };
    };
    const shimmerFilter = ctx.createBiquadFilter();
    shimmerFilter.type = 'lowpass'; shimmerFilter.frequency.value = 2400;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass'; droneFilter.frequency.value = 320; droneFilter.Q.value = 2;

    const shimmer = mk('triangle', 600);
    shimmer.gain.disconnect(); shimmer.gain.connect(shimmerFilter);
    shimmerFilter.connect(master);

    const droneA = mk('sawtooth', 110), droneB = mk('sawtooth', 111.7);
    for (const d of [droneA, droneB]) { d.gain.disconnect(); d.gain.connect(droneFilter); }
    droneFilter.connect(master);

    voices = {
      rumble: mk('sine', 60),
      shimmer,
      droneA, droneB,
      heartbeat: mk('sine', 55),
    };

    const arm = () => {
      armed = true;
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
    window.addEventListener('pointerdown', arm, { passive: true });
    window.addEventListener('keydown', arm);
    return true;
  }

  function strikeChime(strength) {
    // A small FM gong: carrier + modulator, exponential decay.
    const t0 = ctx.currentTime;
    const carrier = ctx.createOscillator();
    carrier.type = 'sine'; carrier.frequency.value = 196;
    const mod = ctx.createOscillator();
    mod.type = 'sine'; mod.frequency.value = 392;
    const modG = ctx.createGain(); modG.gain.value = 140;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5 * strength + 0.0001, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.2);
    mod.connect(modG); modG.connect(carrier.frequency);
    carrier.connect(g); g.connect(master);
    carrier.start(t0); mod.start(t0);
    carrier.stop(t0 + 3.4); mod.stop(t0 + 3.4);
  }

  function setParam(param, value, tc = 0.08) {
    param.setTargetAtTime(value, ctx.currentTime, tc);
  }

  return {
    /** Drive the voices from a pure cue object (audioCueAt(t)). No-op until armed. */
    update(cue) {
      if (!armed) { ensure(); return; }
      if (!ctx || !voices) return;
      setParam(master.gain, 0.5, 0.4);
      setParam(voices.rumble.osc.frequency, cue.rumbleHz);
      setParam(voices.rumble.gain.gain, cue.rumbleGain * 0.5);
      setParam(voices.shimmer.osc.frequency, cue.shimmerHz);
      setParam(voices.shimmer.gain.gain, cue.shimmerGain * 0.35);
      setParam(voices.droneA.osc.frequency, cue.droneHz);
      setParam(voices.droneB.osc.frequency, cue.droneHz * 1.015);
      const dg = cue.droneGain * 0.16;
      setParam(voices.droneA.gain.gain, dg);
      setParam(voices.droneB.gain.gain, dg);
      setParam(voices.heartbeat.gain.gain, cue.heartbeat * 0.65);
      // Edge-trigger the gong on the rising lock pulse.
      if (cue.chime > 0.55 && lastChime <= 0.55) strikeChime(Math.min(1, cue.chime));
      lastChime = cue.chime;
    },
    dispose() {
      if (ctx) ctx.close().catch(() => {});
      ctx = null; voices = null; armed = false;
    },
  };
}
