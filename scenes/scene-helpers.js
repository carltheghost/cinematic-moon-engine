/* scenes/scene-helpers.js — shared PURE helpers for scene configs.
 *
 * The tidal-lock scene defined these locally; the formation / eclipses /
 * phases scenes share them from here so the three configs stay small and
 * the camera math stays identical. PURE: no imports, no DOM, no THREE.
 */

/** Direction vector for the engine's (az, el) camera convention. */
export function dirFromAzEl(az, el) {
  const ce = Math.cos(el);
  return { x: Math.cos(az) * ce, y: Math.sin(el), z: Math.sin(az) * ce };
}

/** (az, el) of a direction vector. */
export function azElOfDir(d) {
  const l = Math.hypot(d.x, d.y, d.z) || 1;
  return { az: Math.atan2(d.z / l, d.x / l), el: Math.asin(Math.max(-1, Math.min(1, d.y / l))) };
}

/** Look-target fields aiming a camera at (az, el, dist) toward point p. */
export function lookAtPoint(az, el, dist, p) {
  const cp = dirFromAzEl(az, el);
  const cam = { x: cp.x * dist, y: cp.y * dist, z: cp.z * dist };
  const dir = { x: p.x - cam.x, y: (p.y || 0) - cam.y, z: p.z - cam.z };
  const { az: lookAz, el: lookEl } = azElOfDir(dir);
  return { lookAz, lookEl };
}

/** Look-target fields aiming back at the origin. */
export function lookAtOrigin(az, el) {
  return { lookAz: az + Math.PI, lookEl: -el };
}

/* PURE: linear resample of a keyframe color script to n frames (n ≥ 2). */
export function resampleScript(baseScript, n) {
  const m = baseScript.length;
  const lerp = (a, b, f) => a + (b - a) * f;
  const lerpArr = (A, B, f) => A.map((a, i) => lerp(a, B[i], f));
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * (m - 1);
    const j = Math.min(m - 2, Math.floor(x));
    const f = x - j;
    const A = baseScript[j], B = baseScript[j + 1];
    out.push({
      name: f < 0.5 ? A.name : B.name,
      emissive: lerpArr(A.emissive, B.emissive, f),
      rampCore: lerpArr(A.rampCore, B.rampCore, f),
      rampMid: lerpArr(A.rampMid, B.rampMid, f),
      rampEdge: lerpArr(A.rampEdge, B.rampEdge, f),
      fresnel: lerpArr(A.fresnel, B.fresnel, f),
      haloTint: lerpArr(A.haloTint, B.haloTint, f),
      haloGain: lerp(A.haloGain, B.haloGain, f),
      exposure: lerp(A.exposure, B.exposure, f),
    });
  }
  return out;
}

const QUIET_ENV = Object.freeze({
  ember: Object.freeze({ density: 0.0, opacity: 0.0, drift: 0.0, warmth: 0.0 }),
  lantern: Object.freeze({ heroIntensity: 0.0, poolIntensity: 0.0, poolVisibility: 0.0, heroSlots: 'nearest' }),
});

/** Chapter keyframe in the engine's canonical field shape (deep-space quiet). */
export function makeChapter(id, name, role, cam, exposure, extra = {}) {
  return Object.freeze({
    id, name, role,
    camera: Object.freeze(cam),
    fogDensity: 0.0001,
    ember: QUIET_ENV.ember,
    lantern: QUIET_ENV.lantern,
    glint: 0.0,
    exposure,
    ...extra,
  });
}
