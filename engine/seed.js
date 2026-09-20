/* engine/seed.js — deterministic core of the Cinematic Moon Engine.
 *
 * Provides: sfc32 seeded PRNG, a frame-count-derived clock, the tier table,
 * watchdog constants, and a config validator. This is the ONLY module allowed
 * to create randomness or time; everything else consumes what it hands out.
 *
 * Discipline (FINAL-PLAN §1.4, enforced by harness/grep-gate.sh):
 *   - No unseeded randomness, no wall-clock reads anywhere in engine/.
 *   - Time enters exclusively through FrameClock.tick(tsMs), where tsMs is the
 *     timestamp handed in by the caller (the rAF callback argument in the
 *     browser). Engine code never queries a clock itself.
 *   - render(t) is therefore a pure function of (seed, config, tier, t).
 *
 * Phase 0: PRNG + clock + tier table + validator are real and working.
 * Later phases wire them into Sky / Moon / Stars / Environment / Post / Camera.
 */

export const ENGINE = Object.freeze({
  name: 'cinematic-moon-engine',
  phase: 0,
  plan: 'FINAL-PLAN.md v1.0 (2026-09-19)',
});

/* ------------------------------------------------------------------ */
/* sfc32 — small fast counter PRNG (seeded). Returns a function that   */
/* yields floats in [0, 1). State is fully determined by the 4 lanes.  */
/* ------------------------------------------------------------------ */
export function sfc32(a, b, c, d) {
  let _a = a >>> 0;
  let _b = b >>> 0;
  let _c = c >>> 0;
  let _d = d >>> 0;
  return function next() {
    _a >>>= 0; _b >>>= 0; _c >>>= 0; _d >>>= 0;
    let t = (_a + _b | 0) + _d | 0;
    _d = _d + 1 | 0;
    _a = _b ^ _b >>> 9;
    _b = _c + (_c << 21) | 0;
    _c = _c << 21 | _c >>> 11;
    _c = _c + t | 0;
    return (t >>> 0) / 4294967296;
  };
}

/* Spread one integer/string seed into the 4 sfc32 lanes (imul mix). */
export function seedToLanes(seed) {
  let h = typeof seed === 'string' ? stringHash32(seed) : (seed | 0);
  const mix = (x) => {
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    return (x ^ (x >>> 16)) >>> 0;
  };
  return [mix(h + 0x9e3779b9), mix(h + 0x3c6ef372), mix(h + 0xdaa66d2b), mix(h + 0x78dde6e4)];
}

function stringHash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

/* Convenience PRNG object: one reseedable stream with helpers. */
export class Rng {
  constructor(seed = 7) {
    this.setSeed(seed);
  }
  setSeed(seed) {
    this.seed = seed;
    const [a, b, c, d] = seedToLanes(seed);
    this._next = sfc32(a, b, c, d);
    this.draws = 0;
    return this;
  }
  /** Float in [0, 1). */
  float() { this.draws++; return this._next(); }
  /** Integer in [min, max). */
  int(min, max) { return min + Math.floor(this.float() * (max - min)); }
  /** Float in [min, max). */
  range(min, max) { return min + this.float() * (max - min); }
  /** Random element of an array. */
  pick(arr) { return arr[this.int(0, arr.length)]; }
  /** In-place Fisher–Yates shuffle (seeded). */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/* ------------------------------------------------------------------ */
/* FrameClock — time is derived from the frame count, never a clock.   */
/* tick(tsMs) must be called once per presented frame with the rAF     */
/* timestamp handed in by the host. t = frame / fps, exact and stable. */
/* ------------------------------------------------------------------ */
export function createFrameClock({ fps = 60 } = {}) {
  let frame = 0;
  let lastTs = null;
  return {
    get frame() { return frame; },
    get fps() { return fps; },
    /** Canonical engine time for a frame index (seconds). Pure. */
    timeAt(frameIndex) { return frameIndex / fps; },
    /**
     * Advance one frame. tsMs: milliseconds handed in by the caller.
     * Returns { frame, dtMs, t }. The first tick yields dtMs = 0.
     */
    tick(tsMs) {
      let dtMs = 0;
      if (lastTs !== null) {
        dtMs = tsMs - lastTs;
        if (!(dtMs >= 0)) dtMs = 0; // guard against non-monotonic hosts
      }
      lastTs = tsMs;
      frame += 1;
      return { frame, dtMs, t: frame / fps };
    },
    reset() { frame = 0; lastTs = null; },
  };
}

/* ------------------------------------------------------------------ */
/* Tiers + watchdog (FINAL-PLAN D5, §1.4).                             */
/* ------------------------------------------------------------------ */
export const TIERS = Object.freeze(['cinematic', 'balanced', 'efficient', 'still']);

/** DPR cap is global: ≤ 1.5 everywhere (D5). */
export const DPR_CAP = 1.5;

/** Per-tier capability table. Values marked (Phase N) land in that phase. */
export const TIER_TABLE = Object.freeze({
  cinematic: Object.freeze({
    label: 'cinematic', fpsTarget: 60, dprMax: 1.5,
    bloom: 'full',          // pmndrs mip-chain bloom (Phase 2 bake-off decides)
    stars: 8000, twinkle: true,
    moonMesh: 'sphere', haloSprites: true,
  }),
  balanced: Object.freeze({
    label: 'balanced', fpsTarget: 45, dprMax: 1.5,
    bloom: 'probe',          // only if bloom probe sustains ≥ 40 fps (D5)
    stars: 4000, twinkle: true,
    moonMesh: 'sphere', haloSprites: true,
  }),
  efficient: Object.freeze({
    label: 'efficient', fpsTarget: 55, dprMax: 1.5,
    bloom: 'off',            // halo sprites only: 2 draw calls
    stars: 2000, twinkle: false,
    moonMesh: 'disc', haloSprites: true,
  }),
  still: Object.freeze({
    label: 'still', fpsTarget: 0, dprMax: 1.5,
    bloom: 'off', stars: 2000, twinkle: false,
    moonMesh: 'disc', haloSprites: true, frames: 1,
  }),
});

/**
 * Watchdog: rolling p95 frame time > WATCHDOG.p95Ms for
 * WATCHDOG.consecutiveFrames consecutive frames → step down ONE tier,
 * one-way per session, logged (D5). A visible step-up mid-scroll is worse
 * than staying down; step-up only via ?tier= override or reload.
 */
export const WATCHDOG = Object.freeze({
  p95Ms: 20,
  consecutiveFrames: 120,
  stepDownTiers: 1,
  oneWayPerSession: true,
});

/** Warmup auto-select thresholds (D5): ≥55 fps → cinematic, ≥35 → balanced. */
export const WARMUP = Object.freeze({
  frames: 60,
  cinematicFps: 55,   // p95 ≤ 18.18 ms
  balancedFps: 35,    // p95 ≤ 28.57 ms
});

/* ------------------------------------------------------------------ */
/* Config validator (stub surface; strict on the numbers that matter). */
/* ------------------------------------------------------------------ */
export const DEFAULT_CONFIG = Object.freeze({
  seed: 7,
  tier: 'cinematic',
  dprCap: DPR_CAP,
  fps: Object.freeze({ cinematic: 60, balanced: 45, efficient: 55 }),
  watchdog: WATCHDOG,
  warmup: WARMUP,
});

/**
 * Validate an engine config. Returns { ok, errors[] }.
 * Fails closed on: unknown tier, DPR cap breach, watchdog constant drift,
 * fps-target drift from §1.4.
 */
export function validateConfig(cfg) {
  const errors = [];
  const c = cfg || {};
  if (!TIERS.includes(c.tier)) errors.push(`tier: unknown '${c.tier}' (expected one of ${TIERS.join(', ')})`);
  if (!(typeof c.dprCap === 'number' && c.dprCap > 0 && c.dprCap <= DPR_CAP)) {
    errors.push(`dprCap: ${c.dprCap} violates global cap ≤ ${DPR_CAP}`);
  }
  const fps = c.fps || {};
  if (fps.cinematic !== 60) errors.push(`fps.cinematic: ${fps.cinematic} (spec §1.4: 60)`);
  if (fps.balanced !== 45) errors.push(`fps.balanced: ${fps.balanced} (spec §1.4: ≥45 floor)`);
  if (fps.efficient !== 55) errors.push(`fps.efficient: ${fps.efficient} (spec §1.4: ≥55 floor)`);
  const w = c.watchdog || {};
  if (w.p95Ms !== WATCHDOG.p95Ms) errors.push(`watchdog.p95Ms: ${w.p95Ms} (spec: ${WATCHDOG.p95Ms})`);
  if (w.consecutiveFrames !== WATCHDOG.consecutiveFrames) {
    errors.push(`watchdog.consecutiveFrames: ${w.consecutiveFrames} (spec: ${WATCHDOG.consecutiveFrames})`);
  }
  if (w.stepDownTiers !== WATCHDOG.stepDownTiers || w.oneWayPerSession !== WATCHDOG.oneWayPerSession) {
    errors.push('watchdog: step-down must be one tier, one-way per session (D5)');
  }
  if (!Number.isInteger(c.seed)) errors.push(`seed: ${c.seed} must be an integer`);
  return { ok: errors.length === 0, errors };
}
