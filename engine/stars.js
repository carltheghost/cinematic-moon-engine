/* engine/stars.js — tier-scaled seeded star catalog (Phase 1).
 *
 * Contract (FINAL-PLAN §1.2):
 *  - Counts: cinematic 8000, balanced 4000, efficient 2000, still 2000.
 *  - Seeded upper-hemisphere positions + magnitudes (identical per seed).
 *  - Spectral tints: blackbody O–M approximation, ~3000–30000 K.
 *  - No star above 60% of moon-disc luminance (hard shader cap at 0.6).
 *  - Horizon fade; moon-glare suppression via setMoonPosition.
 *  - Twinkle lives in the vertex shader with seeded phase and
 *    magnitude-dependent amplitude; amplitude is exactly 0 on efficient/still.
 *
 * No wall clocks anywhere: twinkle time is set explicitly via setTime(t)
 * from the engine's frame-count clock (grep gate §7.3).
 */
import * as THREE from 'three';
import { Rng } from './seed.js';
import { azElToDir } from './sky.js';

export const STAR_CONTRACT = Object.freeze({
  counts: Object.freeze({ cinematic: 8000, balanced: 4000, efficient: 2000, still: 2000 }),
  tints: 'blackbody O–M',
  catalogSeeded: true,              // identical per seed
  maxLuminanceVsMoon: 0.6,          // no star above 60% of moon-disc luminance
  horizonFade: true,
  moonGlareSuppression: true,
  twinkle: 'seeded vertex-shader phase; off below balanced',
});

export const STAR_SHELL_RADIUS = 1500;
/** Hard cap on star brightness in the shader (linear). */
export const STAR_BRIGHTNESS_CAP = 0.6;
/** Twinkle tiers: only cinematic + balanced animate (perf budget §4). */
const TWINKLE_TIERS = new Set(['cinematic', 'balanced']);

/**
 * Tanner Helland blackbody approximation, returns sRGB 0–1 triplets.
 * Standard published math (not vendored code).
 */
function blackbodySRGB(kelvin) {
  const t = kelvin / 100;
  let r, g, b;
  if (t <= 66) r = 255;
  else r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
  if (t <= 66) g = 99.4708025861 * Math.log(t) - 161.1195681661;
  else g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const cl = (v) => Math.min(1, Math.max(0, v / 255));
  return [cl(r), cl(g), cl(b)];
}

const STARS_VERT = /* glsl */ `
attribute float aPhase;    // seeded twinkle phase
attribute float aTwinkle;   // seeded amplitude (0 below balanced)
attribute float aSize;      // px @ dpr 1
attribute float aBright;    // linear catalog brightness
uniform float uTime;        // engine frame clock (seconds) — never wall time
uniform vec3 uMoonDir;      // unit world direction toward the moon
uniform float uPixelRatio;
varying vec3 vColor;
varying float vFade;
void main() {
  vec3 dir = normalize(position);
  // Seeded twinkle: phase + magnitude-dependent amplitude, time from the
  // engine frame clock only.
  float tw = 1.0 + aTwinkle * sin(uTime * 2.2 + aPhase) * sin(uTime * 0.7 + aPhase * 1.7);
  // Horizon fade: stars melt into the sky glow near the horizon.
  vFade = smoothstep(0.0, 0.18, dir.y);
  // Moon-glare suppression: dim stars near the moon's disc.
  float glare = pow(max(dot(dir, uMoonDir), 0.0), 350.0);
  float bright = min(aBright * tw, ${STAR_BRIGHTNESS_CAP.toFixed(1)}) * (1.0 - glare * 0.85);
  vColor = color * bright;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelRatio;
  gl_Position = projectionMatrix * mv;
}
`;

const STARS_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vFade;
void main() {
  // Soft round sprite.
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p) * 2.0;
  float disc = smoothstep(1.0, 0.25, d);
  gl_FragColor = vec4(vColor * disc * vFade, 1.0);
}
`;

/**
 * Build the seeded star catalog.
 * @param {Rng} rng — seeded RNG; the SAME seed + tier ⇒ identical catalog.
 * @param {string} tier — cinematic | balanced | efficient | still.
 */
export function buildStars(rng = new Rng(7), tier = 'cinematic') {
  const count = STAR_CONTRACT.counts[tier] ?? STAR_CONTRACT.counts.cinematic;
  const twinkleOn = TWINKLE_TIERS.has(tier);

  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const aPhase = new Float32Array(count);
  const aTwinkle = new Float32Array(count);
  const aSize = new Float32Array(count);
  const aBright = new Float32Array(count);
  const c = new THREE.Color();
  const R = STAR_SHELL_RADIUS;

  for (let i = 0; i < count; i++) {
    // Uniform-on-hemisphere: y uniform in [0,1], azimuth uniform in [0,2π).
    const y = rng.float();
    const az = rng.float() * Math.PI * 2;
    const rxz = Math.sqrt(Math.max(0, 1 - y * y));
    pos[i * 3] = -Math.sin(az) * rxz * R;
    pos[i * 3 + 1] = y * R;
    pos[i * 3 + 2] = -Math.cos(az) * rxz * R;

    // Magnitude draw: steep distribution, most stars faint. Peak brightness
    // tops out at 0.56, safely under the 0.6 hard cap (≤60% of moon-disc).
    const m = rng.float();
    const lum = Math.pow(1 - m, 2.4);
    const bright = 0.06 + 0.50 * lum;
    aBright[i] = bright;

    // Spectral temperature O(30000K)–M(3000K); hotter stars are rarer.
    const temp = 3000 + 27000 * Math.pow(rng.float(), 2.0);
    const [sr, sg, sb] = blackbodySRGB(temp);
    c.setRGB(sr, sg, sb, THREE.SRGBColorSpace); // sRGB → linear working space
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;

    // Seeded twinkle phase; amplitude scales with brightness and is EXACTLY
    // zero below balanced (spec: "off below balanced").
    aPhase[i] = rng.float() * Math.PI * 2;
    aTwinkle[i] = twinkleOn ? 0.35 * (bright / 0.56) : 0.0;

    // Sprite size: brighter stars read slightly larger (px at dpr 1).
    aSize[i] = 1.2 + 2.6 * lum;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
  geo.setAttribute('aTwinkle', new THREE.BufferAttribute(aTwinkle, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
  geo.setAttribute('aBright', new THREE.BufferAttribute(aBright, 1));

  const moonDir = new THREE.Vector3(0, 1, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMoonDir: { value: moonDir },
      uPixelRatio: { value: 1 },
    },
    vertexShader: STARS_VERT,
    fragmentShader: STARS_FRAG,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = -5;

  return {
    kind: 'stars',
    count,
    tier,
    twinkle: twinkleOn,
    points,
    /** Moon position for glare suppression: {azimuth, elevation} or a Vector3. */
    setMoonPosition(azEl) {
      if (azEl && azEl.isVector3) moonDir.copy(azEl).normalize();
      else azElToDir(azEl.azimuth, azEl.elevation, moonDir);
    },
    /** Engine frame-clock seconds. Never wall time. */
    setTime(t) {
      mat.uniforms.uTime.value = t;
    },
    setPixelRatio(dpr) {
      mat.uniforms.uPixelRatio.value = dpr;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/** Back-compat alias for the Phase 0 stub name. */
export function createStars({ rng = new Rng(7), tier = 'cinematic' } = {}) {
  return buildStars(rng, tier);
}
