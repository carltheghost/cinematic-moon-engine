/**
 * engine/tiermanager.js — Phase 5: pure tier-selection + watchdog decisions.
 *
 * FINAL-PLAN D5: "one tier ladder, probe-gated, one-way ratchet."
 *
 * PURE: no Math.random, no Date.now, no performance.now — all wall-clock
 * measurement lives in the host (index.html). This module only DECIDES from
 * numbers the host feeds it, so engine/ stays under the grep gate while the
 * host does the honest runtime benchmarking D5 demands ("not fill math").
 *
 * Tier precedence (first match wins):
 *   1. reducedMotion → 'still' (forced; the only honest tier for stepped
 *      stills — GPT Q7. Overrides even ?tier=.)
 *   2. ?tier= present and valid → that tier (manual; bypasses the warmup
 *      auto-select AND the watchdog — full manual control, deterministic).
 *   3. otherwise → warmup benchmark selects (auto; watchdog armed).
 *
 * Watchdog: rolling p95 frame time > 20 ms for 120 consecutive frames →
 * step down ONE tier, one-way per session, logged. A visible step-up
 * mid-scroll is worse than staying down; step-up only via ?tier= or reload.
 *
 * Bloom gating (two gates, BOTH required):
 *   - Phase 2 VISUAL bake-off (recorded 2026-09-19): balanced FAILED
 *     (3.8% limb reduction < 20% threshold) → bloom dies outside cinematic.
 *     This rule stays in force; the runtime probe can never re-enable
 *     balanced bloom while the visual gate is closed.
 *   - RUNTIME probe: balanced bloom only if a real benchmark with bloom on
 *     sustains ≥ 40 fps (D5). Never inferred from fill math.
 */
import { TIER_TABLE, WATCHDOG, WARMUP } from './seed.js';

/** Step-down ladder (one-way). */
export const TIER_ORDER = Object.freeze(['cinematic', 'balanced', 'efficient', 'still']);

/**
 * Phase 2 visual bloom bake-off record (harness/bakeoff.js, 2026-09-19).
 * CLOSED gates stay closed until the bake-off is re-run and passes.
 */
export const BLOOM_VISUAL_BAKEOFF = Object.freeze({
  cinematic: true,
  balanced: false,
  efficient: false,
  still: false,
  rationale:
    '2026-09-19 visual bake-off: balanced-tier bloom measured 3.8% limb ' +
    'reduction < 20% threshold — visually pointless for its cost. ' +
    'Bloom dies outside cinematic until the bake-off is re-run and passes.',
});

/** Minimum sustained fps for the balanced-tier bloom runtime probe (D5). */
export const BLOOM_PROBE_FPS = 40;

/**
 * PURE: resolve the boot tier.
 * @returns {{ tier, mode, reason }} — mode ∈ 'forced-still' | 'manual' | 'auto'.
 */
export function resolveTier({ tierParam, reducedMotion }) {
  if (reducedMotion) {
    return {
      tier: 'still',
      mode: 'forced-still',
      reason: 'prefers-reduced-motion: stepped stills are only honest at the still tier (GPT Q7)',
    };
  }
  if (tierParam && tierParam in TIER_TABLE) {
    return {
      tier: tierParam,
      mode: 'manual',
      reason: `?tier=${tierParam} override — bypasses warmup auto-select and watchdog`,
    };
  }
  return {
    tier: 'cinematic',
    mode: 'auto',
    reason: 'no override: boot at cinematic, 60-frame warmup benchmark selects the honest tier',
  };
}

/**
 * PURE: warmup auto-select from measured fps (WARMUP thresholds, D5).
 * ≥55 fps → cinematic, ≥35 → balanced, else efficient.
 */
export function selectTierFromWarmup(fps) {
  if (fps >= WARMUP.cinematicFps) return 'cinematic';
  if (fps >= WARMUP.balancedFps) return 'balanced';
  return 'efficient';
}

/** PURE: one step down the ladder (clamped at 'still'). */
export function stepDown(tier) {
  const i = TIER_ORDER.indexOf(tier);
  if (i < 0) return 'efficient';
  return TIER_ORDER[Math.min(i + 1, TIER_ORDER.length - 1)];
}

/**
 * PURE watchdog state machine. The host feeds per-frame dt (ms) from its own
 * clock; this decides. One-way latch: after tripping, observe() is inert.
 *
 * Semantics ("rolling p95 frame > 20 ms for 120 consecutive frames"): each
 * frame computes p95 over the last 120 frames; the trip counter increments
 * while p95 > 20 ms and resets when p95 recovers. The 120-frame window gives
 * the design its hysteresis — a brief recovery after sustained jank does NOT
 * cancel the trip (anti-oscillation: stepping down is the safe action, and
 * the latch is one-way anyway).
 */
export function createWatchdog() {
  const window = [];
  const WINDOW_MAX = 120;
  let overCount = 0;
  let tripped = false;
  return {
    /**
     * Feed one frame's dt (ms). Returns true on the exact frame the
     * watchdog trips (caller steps down one tier); false otherwise.
     */
    observe(dtMs) {
      if (tripped) return false;
      window.push(dtMs);
      if (window.length > WINDOW_MAX) window.shift();
      const sorted = [...window].sort((a, b) => a - b);
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
      if (p95 > WATCHDOG.p95Ms) overCount += 1;
      else overCount = 0;
      if (overCount >= WATCHDOG.consecutiveFrames) {
        tripped = true;
        return true;
      }
      return false;
    },
    get tripped() {
      return tripped;
    },
  };
}

/**
 * PURE: balanced-tier bloom runtime-probe decision. BOTH gates required:
 * the real measured probe fps ≥ 40 AND the Phase 2 visual bake-off open.
 * (The visual gate is currently closed → always false; the probe machinery
 * is implemented and ready for a bake-off re-run.)
 */
export function bloomProbeDecision({ probeFps, tier }) {
  if (tier !== 'balanced') return false;
  if (BLOOM_VISUAL_BAKEOFF.balanced !== true) return false;
  return probeFps >= BLOOM_PROBE_FPS;
}
