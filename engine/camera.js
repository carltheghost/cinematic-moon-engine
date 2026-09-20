/* engine/camera.js — stateless scrub camera driven by the 13-chapter data (Phase 4 implemented).
 *
 * The canonical camera is a PURE function of scrollY (via scrollP → chapterT):
 *   scrollY → normalized p → chapterT = p * 12 → smoothstep-interpolated camera keyframes
 * No damping, no velocity clamps, no wall-clock springs — ever. Deterministic
 * render(t) depends on this (the fling contract: a 3000 px/s fling is absorbed
 * by overscroll compression, not smoothing).
 *
 * Chapters are data — engine/chapters.js (D6). Each chapter carries a `camera`
 * keyframe { az, el, dist, lookAz, lookEl, fov }; adjacent keyframes interpolate
 * with per-segment smoothstep. Camera convention: az 0 = +X toward +Z, el 0 =
 * horizon (same as environment.js dirFromAzEl).
 *
 * Reduced motion: REDUCED_MOTION = 'stepped stills' — the host reduces raw
 * scroll state through engine/presentation.js, which quantizes chapterT;
 * the camera itself stays pure (evaluateAt consumes the motion coordinate).
 *
 * PURE throughout: no Math.random / Date.now / performance.now.
 */
import { CHAPTERS, chapterAt, simTimeAt, scrollP } from './chapters.js';

export const CAMERA_CONTRACT = Object.freeze({
  scrubCurve: 'monotonic, stateless, deterministic (smoothstep between chapter keyframes; chapterT = p * 12)',
  position: 'dirFromAzEl(camAz, camEl) * camDist',
  rotation: 'lookAt(dirFromAzEl(lookAz, lookEl) * 1000)',
  fov: 'smoothstep-interpolated chapter keyframes, 48–64°; disc stays 20–38% of viewport height',
  fling: '3000 px/s fling absorbed by overscroll compression, not smoothing',
  layers: 'canonical (pure, screenshots/regression/replay) vs presentation (additive FX only)',
  scrollDrivers: ['scrolltrigger', 'manual', 'autoplay'],
  reducedMotion: 'stepped stills',
});

/** Reduced-motion mode: the host quantizes chapterT; the camera itself stays pure. */
export const REDUCED_MOTION = 'stepped stills';

function smoothstep01(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/**
 * Azimuth/elevation (radians) → unit direction. Same convention as
 * environment.js dirFromAzEl (az 0 = +X toward +Z; el 0 = horizon), but returns
 * a plain {x, y, z} so the camera stays THREE-free and Node-testable.
 */
function dirFromAzEl(azimuth, elevation) {
  const ce = Math.cos(elevation);
  return { x: Math.cos(azimuth) * ce, y: Math.sin(elevation), z: Math.sin(azimuth) * ce };
}

/** Phase 4: chapter-keyframed stateless scrub camera. */
export function createCamera({ chapters = CHAPTERS } = {}) {
  const n = Math.max(2, chapters.length);

  /** Smoothstep-interpolated camera params at float chapterT ∈ [0, n-1]. PURE. */
  function cameraParamsAt(chapterT) {
    const t = Math.min(n - 1, Math.max(0, chapterT));
    const i = Math.min(n - 2, Math.floor(t));
    const f = smoothstep01(t - i);
    const a = chapters[i].camera;
    const b = chapters[i + 1].camera;
    const lerp = (x, y) => x + (y - x) * f;
    return {
      az: lerp(a.az, b.az),
      el: lerp(a.el, b.el),
      dist: lerp(a.dist, b.dist),
      lookAz: lerp(a.lookAz, b.lookAz),
      lookEl: lerp(a.lookEl, b.lookEl),
      fov: lerp(a.fov, b.fov),
    };
  }

  return {
    kind: 'camera',
    /**
     * PURE: (scrollY, maxScroll) → camera state. No damping, no velocity
     * clamps, no wall-clock springs — ever. Deterministic render(t) depends
     * on this. This is the CANONICAL entry: chapterT is never quantized here;
     * the presentation layer (engine/presentation.js) quantizes before calling
     * evaluateAt() under reduced motion.
     */
    evaluate(scrollY, maxScroll) {
      const p = scrollP(scrollY, maxScroll);
      const { chapterT } = chapterAt(p);
      return evaluateAt(chapterT);
    },
    /**
     * PURE: chapterT → camera state. Same interpolation model as evaluate()
     * (smoothstep between chapter keyframes — frozen); the entry the
     * presentation layer uses with the (possibly quantized) motionChapterT.
     */
    evaluateAt,
  };

  /** PURE: chapterT ∈ [0, n-1] → full camera state (the shared body). */
  function evaluateAt(chapterT) {
    const t = Math.min(n - 1, Math.max(0, chapterT));
    const p = t / (n - 1);
    const simTime = simTimeAt(p);
    const cam = cameraParamsAt(t);
    const pos = dirFromAzEl(cam.az, cam.el);
    const look = dirFromAzEl(cam.lookAz, cam.lookEl);
    return {
      p,
      chapterT: t,
      simTime,
      position: { x: pos.x * cam.dist, y: pos.y * cam.dist, z: pos.z * cam.dist },
      lookTarget: { x: look.x * 1000, y: look.y * 1000, z: look.z * 1000 },
      fov: cam.fov,
      chapterIndex: Math.min(n - 1, Math.max(0, Math.round(t))),
    };
  }
}
