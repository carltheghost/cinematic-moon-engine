/* engine/presentation.js — canonical presentation coordinates (Phase 5).
 *
 * GPT Phase-4 review Q7 (hard architectural requirement) + Grok Q7: define ONE
 * canonical presentation coordinate set, and a reduced-motion transformation of
 * it. EVERY motion-producing subsystem — camera, moon, environment, AND all
 * post effects (grain, vignette, bloom, exposure, tone mapping) — consumes the
 * canonical/quantized coordinates. Under reduced motion the image must be
 * stepped stills: no continuous post animation while the camera is stepped.
 *
 * Coordinate set (all PURE — no Math.random / Date.now / performance.now):
 *   p                 normalized scroll ∈ [0,1]
 *   canonicalChapterT p * 12 — the narrative coordinate; NEVER quantized.
 *                       Screenshots / regression / replay compare canonical state.
 *   motionChapterT    reducedMotion ? quantize(canonicalChapterT)
 *                                     : canonicalChapterT
 *                       What is actually rendered (presentation layer).
 *   canonicalSimTime  simTimeAt(p) — the deterministic engine clock, raw.
 *   motionSimTime     reducedMotion ? (motionChapterT / 12) * SIM_DURATION
 *                                     : canonicalSimTime
 *                       The ONLY time input any subsystem may consume.
 *   frame             reducedMotion ? 0 : floor(motionSimTime * 60)
 *                       The ONLY time input the post pipeline may consume
 *                       (grain uFrame). Pinned to 0 under reduced motion:
 *                       grain is frozen, not stepped.
 *
 * quantizeChapterT(t) = round(clamp(t, 0, 12)): stepped stills land exactly on
 * chapter keyframes (the camera keyframes ARE the stills). Deterministic:
 * the same scrollY always lands in the same basin.
 *
 * Reduced motion is a FIRST-CLASS input to the per-tier post graph (Grok Q7):
 * a quantized still is a valid, deterministic input — no temporal accumulation
 * may assume continuous motion; grain/dither are keyed only to simTime (via
 * `frame`); bloom/glow are purely spatial. See engine/post.js POST_GRAPH.
 *
 * PROHIBITED from influencing visual state anywhere (enforced by
 * harness/grep-gate.sh for engine/, by review for the host):
 * wall-clock reads (Date.now, performance.now), frame-delta clocks
 * (clock.getDelta), and frame counters (frameCount++).
 * The 30-frame bloom tier crossfade is allowed ONLY because it is a
 * deterministic function of the host-fed deterministic `frame`
 * (see post.js render()).
 */
import { simTimeAt, scrollP, CHAPTER_COUNT, SIM_DURATION } from './chapters.js';

export const PRESENTATION_CONTRACT = Object.freeze({
  canonical: 'canonicalChapterT = p * 12, never quantized (screenshots/regression/replay)',
  motion: 'motionChapterT = reducedMotion ? quantize(canonicalChapterT) : canonicalChapterT',
  time: 'motionSimTime is the ONLY time input subsystems may consume',
  postTime: 'frame = reducedMotion ? 0 : floor(motionSimTime * 60) is the ONLY post time input',
  reducedMotion: 'stepped stills — no continuous post animation while the camera is stepped',
  prohibited: 'wall-clock reads (Date.now, performance.now), frame-delta clocks (clock.getDelta), and frame counters (frameCount++)',
});

/** Stepped stills: quantize to the nearest whole chapter (lands on keyframes). PURE. */
export function quantizeChapterT(chapterT) {
  const t = Math.min(CHAPTER_COUNT - 1, Math.max(0, chapterT));
  return Math.round(t);
}

/**
 * Reduce raw scroll state to the canonical presentation coordinate set.
 * PURE in ({ scrollY, maxScroll, reducedMotion }).
 */
export function canonicalPresentation({ scrollY, maxScroll, reducedMotion = false }) {
  const p = scrollP(scrollY, maxScroll);
  const canonicalChapterT = Math.min(CHAPTER_COUNT - 1, Math.max(0, p * (CHAPTER_COUNT - 1)));
  const motionChapterT = reducedMotion ? quantizeChapterT(canonicalChapterT) : canonicalChapterT;
  const canonicalSimTime = simTimeAt(p);
  const motionSimTime = reducedMotion
    ? (motionChapterT / (CHAPTER_COUNT - 1)) * SIM_DURATION
    : canonicalSimTime;
  const frame = reducedMotion ? 0 : Math.floor(motionSimTime * 60);
  return {
    p,
    canonicalChapterT,
    motionChapterT,
    canonicalSimTime,
    motionSimTime,
    frame,
    reducedMotion: !!reducedMotion,
  };
}
