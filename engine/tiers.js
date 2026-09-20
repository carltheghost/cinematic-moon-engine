/* engine/tiers.js — tier manager + watchdog (FINAL-PLAN D5).
 *
 * Phase 0: warmup auto-select + watchdog ratchet mechanics are real; the frame
 * times they consume come from the host-fed clock (rAF timestamps), never from
 * a wall-clock read inside engine/. Later phases feed real render costs and
 * the bloom probe; the mechanics do not change.
 *
 * Auto-select (boot, WARMUP.frames samples):
 *   p95 ≤ 1000/55 ms  → 'cinematic'
 *   p95 ≤ 1000/35 ms  → 'balanced'
 *   else              → 'efficient'
 * The decision is always logged via onLog (Phase 0 exit check).
 *
 * Watchdog (post-warmup): rolling p95 over the last WATCHDOG.consecutiveFrames
 * samples > WATCHDOG.p95Ms for that many consecutive frames → step down one
 * tier, once per session, logged. Step-up only via setTier('…', '?tier= override').
 */

import { TIERS, TIER_TABLE, WATCHDOG, WARMUP } from './seed.js';

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  const i = Math.min(sortedAsc.length - 1, Math.ceil((p / 100) * sortedAsc.length) - 1);
  return sortedAsc[Math.max(0, i)];
}

export class TierManager {
  /**
   * @param {object} opts
   * @param {string} opts.initial   tier before warmup completes
   * @param {function(string)} opts.onLog  sink for tier decisions
   * @param {function(string)} opts.onDecision sink for the auto-select decision
   */
  constructor({ initial = 'cinematic', onLog = () => {}, onDecision = () => {} } = {}) {
    if (!TIERS.includes(initial)) throw new Error(`TierManager: unknown tier '${initial}'`);
    this._tier = initial;
    this._onLog = onLog;
    this._onDecision = onDecision;
    this._warmupSamples = [];
    this._warmupDone = false;
    this._window = [];            // rolling post-warmup frame times (ms)
    this._badStreak = 0;          // consecutive frames with rolling p95 > threshold
    this._steppedDown = false;    // one-way ratchet per session
    this._framesSeen = 0;
  }

  get tier() { return this._tier; }
  get spec() { return TIER_TABLE[this._tier]; }
  get warmupDone() { return this._warmupDone; }

  /** Feed one frame's dt (ms, host-measured). Zero/negative dts are ignored. */
  noteFrame(dtMs) {
    if (!(dtMs > 0)) return;
    this._framesSeen++;
    if (!this._warmupDone) {
      this._warmupSamples.push(dtMs);
      if (this._warmupSamples.length >= WARMUP.frames) this._autoSelect();
      return;
    }
    this._window.push(dtMs);
    if (this._window.length > WATCHDOG.consecutiveFrames) this._window.shift();
    if (this._window.length < WATCHDOG.consecutiveFrames) return;
    const p95 = percentile([...this._window].sort((a, b) => a - b), 95);
    if (p95 > WATCHDOG.p95Ms) {
      this._badStreak++;
      if (this._badStreak >= WATCHDOG.consecutiveFrames) this._watchdogTrip(p95);
    } else {
      this._badStreak = 0;
    }
  }

  _autoSelect() {
    this._warmupDone = true;
    const sorted = [...this._warmupSamples].sort((a, b) => a - b);
    const p95 = percentile(sorted, 95);
    const fps = 1000 / p95;
    let tier;
    if (fps >= WARMUP.cinematicFps) tier = 'cinematic';
    else if (fps >= WARMUP.balancedFps) tier = 'balanced';
    else tier = 'efficient';
    const prev = this._tier;
    this._tier = tier;
    const msg = `tier auto-select: warmup ${WARMUP.frames} frames, ` +
      `p95=${p95.toFixed(2)}ms (~${fps.toFixed(1)}fps) → '${tier}'` +
      (prev !== tier ? ` (from initial '${prev}')` : ' (unchanged)');
    this._onLog(msg);
    this._onDecision({ tier, p95Ms: p95, fps, message: msg });
  }

  _watchdogTrip(p95) {
    if (this._steppedDown) return; // one-way per session
    const idx = TIERS.indexOf(this._tier);
    if (idx >= TIERS.length - 1) {
      this._onLog(`watchdog: rolling p95=${p95.toFixed(2)}ms > ${WATCHDOG.p95Ms}ms ` +
        `for ${WATCHDOG.consecutiveFrames} frames — already at lowest tier '${this._tier}', holding`);
      this._steppedDown = true;
      return;
    }
    const from = this._tier;
    this._tier = TIERS[idx + WATCHDOG.stepDownTiers];
    this._steppedDown = true;
    this._badStreak = 0;
    this._window = [];
    this._onLog(`watchdog: rolling p95=${p95.toFixed(2)}ms > ${WATCHDOG.p95Ms}ms ` +
      `for ${WATCHDOG.consecutiveFrames} consecutive frames → step down '${from}' → '${this._tier}' (one-way, session-locked)`);
  }

  /** Manual override (e.g. ?tier=still, prefers-reduced-motion). Logged. */
  setTier(name, reason = 'manual override') {
    if (!TIERS.includes(name)) throw new Error(`TierManager.setTier: unknown tier '${name}'`);
    if (name === this._tier) return;
    const from = this._tier;
    this._tier = name;
    this._onLog(`tier change: '${from}' → '${name}' (${reason})`);
  }

  /** Rolling stats over the live window (post-warmup) or warmup samples. */
  stats() {
    const samples = this._warmupDone ? this._window : this._warmupSamples;
    const sorted = [...samples].sort((a, b) => a - b);
    const mean = samples.length ? samples.reduce((s, v) => s + v, 0) / samples.length : 0;
    return {
      frames: this._framesSeen,
      fps: mean > 0 ? 1000 / mean : 0,
      p95Ms: percentile(sorted, 95),
      samples: samples.length,
      steppedDown: this._steppedDown,
    };
  }
}
