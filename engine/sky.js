/* engine/sky.js — the night-sky dome and its matched fog. Phase 1 of FINAL-PLAN §2.
 *
 * Contract (FINAL-PLAN §1.2, docs/art-board.md §2; §1.1 "never below-black"):
 *  - Sky zenith #04060C, horizon #0D1524. NO ordinary sky pixel above #16202F.
 *  - Seeded gradient-dome scattering backend ('gradient'); the Bruneton spectral
 *    backend is a Phase 2 plugin (D2) and must remain optional.
 *  - scene.fog is FogExp2 whose color is the same THREE.Color instance as
 *    sky.horizonColor (single source of truth).
 *
 * This is a FRESH gradient shader (no vendored sky code): pow-shaped vertical
 * gradient + uniform-driven warm wash aimed at the moon so the horizon glows
 * around it and falls off elsewhere. The wash is linear-space additive light
 * whose strength is calibrated so the final graded frame stays under the
 * #16202F ceiling (see build log 2026-09-19).
 */
import * as THREE from 'three';
import { Rng } from './seed.js';

/** Sky palette — the numbers are the contract. */
export const SKY = Object.freeze({
  zenith: '#04060C',
  horizon: '#0D1524',
  maxSkyPixel: '#16202F',
  ceilingRGB: Object.freeze([0x16, 0x20, 0x2f]),
});

/** Reserved for the optional Bruneton backend (D2). Must stay the default. */
export const SCATTERING_BACKENDS = Object.freeze(['gradient', 'bruneton']);

export const DOME_RADIUS = 2200;

/**
 * Azimuth/elevation (radians) → unit direction, documented convention:
 * azimuth 0 = toward -Z, positive azimuth rotates toward -X (viewed from +Y);
 * elevation 0 = horizon, +PI/2 = zenith.
 */
export function azElToDir(azimuth, elevation, target = new THREE.Vector3()) {
  const ce = Math.cos(elevation);
  return target.set(-Math.sin(azimuth) * ce, Math.sin(elevation), -Math.cos(azimuth) * ce);
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uZenith;        // linear
uniform vec3 uHorizon;       // linear (same instance as fog.color)
uniform vec3 uMoonDir;       // unit world direction toward the moon
uniform vec3 uGlowTint;      // warm tint, linear (fixture-calibrated)
uniform float uGlowStrength; // scalar wash gain (fixture-calibrated)
void main() {
  vec3 d = normalize(vDir);
  // Vertical gradient: pow shapes the falloff so the bright band hugs the horizon.
  float t = pow(clamp(1.0 - d.y, 0.0, 1.0), 1.6);
  vec3 col = mix(uZenith, uHorizon, t);
  // Below the horizon the dome converges back to the horizon color (no void).
  col = mix(col, uHorizon, smoothstep(0.02, -0.2, d.y));
  // Warm moon wash: tight lobe around the moon direction, weighted by a
  // horizon band so the glow sits where atmosphere would actually scatter it.
  float band = exp(-abs(d.y) * 4.5);
  float lobe = pow(max(dot(d, uMoonDir), 0.0), 6.0);
  col += uGlowTint * (lobe * band * uGlowStrength);
  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * Build the sky dome + matched fog.
 * @param {Rng} rng — seeded RNG (reserved for future cloud/dither layers; the
 *                    Phase 1 gradient is analytic, so the seed is unused-but-held).
 * @param {object} opts — { scatteringBackend, fogDensity, glowStrength }
 */
export function buildSky(rng = new Rng(7), opts = {}) {
  const backend = opts.scatteringBackend ?? 'gradient';
  if (backend !== 'gradient') {
    throw new Error(
      `[sky] scattering backend '${backend}' is not available in Phase 1 ` +
      `(expected 'gradient'; 'bruneton' arrives as an optional plugin in Phase 2, D2)`
    );
  }

  const horizonColor = new THREE.Color(SKY.horizon); // THE single source of truth
  const zenithColor = new THREE.Color(SKY.zenith);
  const moonDir = new THREE.Vector3(0, 1, 0);

  const uniforms = {
    uZenith: { value: zenithColor },
    uHorizon: { value: horizonColor }, // shares the instance with fog.color
    uMoonDir: { value: moonDir },
    // Warm tint in linear space; strength fixture-calibrated so the graded
    // frame stays under the #16202F ceiling (build log 2026-09-19).
    uGlowTint: { value: new THREE.Color(1.0, 0.45, 0.20) },
    uGlowStrength: { value: opts.glowStrength ?? 0.006 },
  };

  const geo = new THREE.SphereGeometry(DOME_RADIUS, 48, 24);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10; // dome draws first, never occludes

  const fog = new THREE.FogExp2(0x000000, opts.fogDensity ?? 0.0011);
  fog.color = horizonColor; // SAME instance — fog can never drift from the sky

  return {
    kind: 'sky',
    scatteringBackend: 'gradient',
    mesh,
    fog,
    horizonColor,
    zenithColor,
    setMoonDirection(azimuth, elevation) {
      azElToDir(azimuth, elevation, moonDir);
      uniforms.uMoonDir.value.copy(moonDir);
    },
    get moonDirection() {
      return moonDir.clone();
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/** Back-compat alias for the Phase 0 stub name. */
export function createSky({ rng = new Rng(7), backend = 'gradient' } = {}) {
  return buildSky(rng, { scatteringBackend: backend });
}
