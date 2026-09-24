/* engine/environment.js — terrain, scatter, embers, water glint, light rig (Phase 3).
 *
 * WHAT THIS IS
 *   buildEnvironment(rng, opts) constructs the world under moonlight:
 *   seeded fBm heightfield terrain (flat-shaded charcoal), instanced scatter
 *   (trees / rocks / lanterns, seeded placement), ember particles (seeded
 *   drift, moonlit), moon-glint water (streak aligned to the moon azimuth),
 *   and the moonlight rig (cold directional + hemisphere driven from Sky +
 *   amber point pools at lanterns). Fog is height-attenuated on the terrain
 *   and FogExp2-matched everywhere else; the fog COLOR is sky.horizonColor
 *   itself (single source of truth — the same THREE.Color instance).
 *
 * TECHNIQUE PROVENANCE (all fresh implementations, MIT — see ATTRIBUTION.md):
 *   - Seeded integer-lattice value noise + fBm (standard procedural technique).
 *   - Ridged fBm for the mountain ring (standard "1 - |2n-1|" ridging).
 *   - InstancedMesh scatter with rejection sampling (standard pattern).
 *
 * THE CONTRACT (FINAL-PLAN §1.2 — the NUMBERS are the contract):
 *   - Terrain: near-monochrome charcoal; no ordinary pixel above the sky
 *     ceiling logic — everything in the world stays ≤ 1.05 pre-tonemap so
 *     bloom selectivity holds (moon is the ONLY object with luminance > 1).
 *   - Lanterns: warm amber #D99A4E, ≤ 1.05 pre-tonemap (saturation-census
 *     exempt, luminance-capped).
 *   - FogExp2 color == sky.horizonColor BY CONSTRUCTION (same instance).
 *     Ridge samples at 3 distances converge toward the horizon color.
 *   - Depth haze: midground silhouette at 2× camera distance loses ≥ 40%
 *     contrast vs foreground.
 *   - Water glint streak aligns with the moon azimuth ± 2° under scripted
 *     change (setMoonDirection).
 *   - Light ratio: warm amber key vs cold #7FA3CC fill ≥ 2.2:1 on the
 *     reference card (see lightRatio()).
 *   - Hero chapter ≤ 40 draw calls (environment adds 8: terrain, water,
 *     trees, rocks, lantern posts, lantern glows, light pools, embers).
 *
 * DETERMINISM: every draw comes from seeded sfc32 streams (seed.js). The
 * bake is a pure function of (seed, tier, moonAzimuth, moonElevation).
 * No Math.random / Date.now / performance.now anywhere (grep gate).
 * Time enters only via setTime(t) from the engine frame-count clock.
 *
 * DEPENDENCY ORDER (FINAL-PLAN §3): Seed → Sky → {Moon, Stars} → Environment
 * → Post → Camera. This module reads sky.fogDensity and sky.horizonColor as
 * explicit inputs via opts.sky — never a back-channel.
 */
import * as THREE from 'three';
import { Rng } from './seed.js';

/** Environment acceptance contract (§1.2 / Phase 3 exit). */
export const ENVIRONMENT_CONTRACT = Object.freeze({
  terrain: 'seeded fBm heightfield, flat-shaded charcoal',
  scatter: 'instanced trees/rocks/lanterns, seeded placement',
  particles: 'ember particles, seeded drift, moonlit',
  waterGlint: 'streak aligns with moon azimuth ± 2° under scripted change',
  lightRig: 'cold directional + hemisphere (from Sky) + amber point pools',
  lightRatio: 'warm amber #D99A4E key vs cold #7FA3CC fill ≥ 2.2:1 on reference card',
  fog: 'FogExp2 color == sky.horizonColor (single source of truth); ridge samples at 3 distances converge to horizon color',
  depthHaze: 'midground silhouette at 2× camera distance loses ≥ 40% contrast vs foreground',
  drawCallBudget: 'hero chapter ≤ 40, engine-wide ≤ 80',
  determinism: 'same (seed, tier, moonAzimuth, moonElevation) → identical layout hash',
});

/** Palette + world constants. The hexes are the contract. */
export const ENV = Object.freeze({
  lanternAmber: '#D99A4E',   // warm key (≤ 1.05 pre-tonemap, always)
  moonFill: '#7FA3CC',       // cold fill
  terrainTint: [0.92, 1.0, 1.12], // charcoal with a cool cast (linear multipliers)
  waterDeep: '#070b11',
  groundBounce: '#0b0d10',
});

/** Terrain mesh: 4400² world units, 150² segments (flat-shaded). */
export const TERRAIN_SIZE = 4400;
export const TERRAIN_SEGMENTS = 150;
/** Water plane height; the basin floor is carved below this. */
export const WATER_Y = -1.5;
/** Lake basin: center (x,z), ellipse radii, carve depth. */
export const BASIN = Object.freeze({ x: 394, z: 144, rx: 430, rz: 260, depth: 16 });
/** Water plane footprint (covers the basin + foreground inlet). */
export const WATER = Object.freeze({ w: 934, d: 420, x: 307, z: 144 });
/** Height-attenuated fog shaping on the terrain (FogExp2 × (1 + boost·e^-y/scale)). */
export const FOG_HEIGHT_BOOST = 1.5;
export const FOG_HEIGHT_SCALE = 60;
/** Scatter counts at the cinematic tier; other tiers scale down. */
export const SCATTER_COUNTS = Object.freeze({ trees: 240, rocks: 150, lanterns: 26, embers: 420 });
/**
 * Phase 5 A/B — mobile ember perceptual floor (GPT Q6 "restrained + perceptible"
 * vs Grok Q6 "leave 0.006 as-is"). Applied ONLY when buildEnvironment is
 * constructed with { emberFloor: true } (host: ?emberfloor=1); default off.
 * Viewport-driven in production intent, flag-gated for the A/B. Ember
 * population count is NEVER changed by the floor.
 */
export const EMBER_FLOOR_SIZE_PX = 2.0;  // min point size, drawing-buffer px
export const EMBER_FLOOR_OPACITY = 0.35; // min fragment-alpha multiplier
const TIER_SCATTER_SCALE = Object.freeze({ cinematic: 1, balanced: 0.7, efficient: 0.45, still: 0.4 });
/** Lantern point lights: only the nearest hero lanterns get real lights. */
export const HERO_LANTERN_LIGHTS = 4;
export const LANTERN_LIGHT_INTENSITY = 18;
export const LANTERN_LIGHT_DISTANCE = 70;
/** Reference card for the warm/cold light-ratio measurement: 3 units from
 *  the hero lantern base, inside its warm pool (key-vs-fill spot check). */
export const REFERENCE_CARD = Object.freeze({ dx: 3, dy: 0.6, dz: 0 });
/** Ridge-test geometry: fixed distances, azimuth scan range, moon exclusion. */
export const RIDGE_DISTANCES = Object.freeze([380, 800, 1350]);
export const RIDGE_AZ_MIN = 0.06;
export const RIDGE_AZ_MAX = 0.98;

/* ------------------------------------------------------------------ */
/* Seeded value noise (integer lattice). Deterministic in (x, y, seed).*/
/* ------------------------------------------------------------------ */
function makeNoise(seed) {
  const s = seed | 0;
  function hash2(ix, iy) {
    let h = Math.imul(ix, 0x85ebca6b) ^ Math.imul(iy, 0xc2b2ae35) ^ Math.imul(s, 0x27d4eb2f);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }
  function noise2(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy), b = hash2(ix + 1, iy);
    const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  function fbm2(x, y, oct) {
    let v = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      v += amp * noise2(x * f, y * f);
      norm += amp; amp *= 0.5; f *= 2.03;
    }
    return v / norm;
  }
  /** Ridged fBm: sharp crests, [0,1]. */
  function ridged2(x, y, oct) {
    let v = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      const n = fbm2(x * f + 3.7, y * f + 9.1, 1);
      v += amp * (1 - Math.abs(2 * n - 1));
      norm += amp; amp *= 0.5; f *= 2.11;
    }
    return v / norm;
  }
  return { hash2, noise2, fbm2, ridged2 };
}

function sstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Azimuth/elevation (radians) → unit direction. Convention matches the hero
 * camera in index.html: azimuth 0 = +X, positive toward +Z; elevation 0 =
 * horizon. (Sky's azElToDir uses a different convention; the environment
 * keys off the camera/moon convention so the glint tracks the visible moon.)
 */
export function dirFromAzEl(azimuth, elevation) {
  const ce = Math.cos(elevation);
  return new THREE.Vector3(Math.cos(azimuth) * ce, Math.sin(elevation), Math.sin(azimuth) * ce);
}

/** Build the heightfield function h(x, z) for a seed + moon azimuth. */
function makeHeightField(noise, moonAzimuth) {
  return function heightAt(x, z) {
    const r = Math.hypot(x, z);
    // Rolling base: ±17 units of fBm + fine detail.
    let h = (noise.fbm2(x * 0.0038 + 11.3, z * 0.0038 + 7.7, 5) - 0.5) * 34;
    h += (noise.fbm2(x * 0.02 + 3.1, z * 0.02 + 9.4, 3) - 0.5) * 6;
    // Mountain ring: ridged fBm rising past r=1050.
    const mMask = sstep(1050, 1400, r);
    if (mMask > 0) {
      h += mMask * (30 + 200 * noise.ridged2(x * 0.0016 + 5.0, z * 0.0016 + 1.2, 4));
    }
    // Lake basin carve (floor ends up well below WATER_Y).
    const dx = (x - BASIN.x) / BASIN.rx, dz = (z - BASIN.z) / BASIN.rz;
    h -= BASIN.depth * Math.exp(-(dx * dx + dz * dz) * 2.0);
    // Moon corridor: keep the sightline to the disc clear so terrain can
    // never swallow the lower limb (Phase 2 disc geometry is locked).
    let dAz = Math.abs(Math.atan2(z, x) - moonAzimuth);
    dAz = Math.min(dAz, Math.PI * 2 - dAz);
    const cMask = (1 - sstep(0.09, 0.17, dAz)) * sstep(110, 170, r) * (1 - sstep(1150, 1300, r));
    if (cMask > 0) {
      const cap = r * 0.004 - 2.0;
      h = h * (1 - cMask) + Math.min(h, cap) * cMask;
    }
    // Water inlet: a narrow trench along the moon azimuth, cut BELOW the
    // water plane, so the sightline from the hero camera to the lake (and
    // the glint streak on it) always clears the terrain. Without this the
    // corridor cap itself would bury the lake view. The trench floor
    // wcap(r) = -1.5·r/420 - 1.6 stays under both the water plane (a) and
    // every sightline to a streak point (b).
    const wMask = (1 - sstep(0.09, 0.15, dAz)) * sstep(40, 90, r) * (1 - sstep(430, 540, r));
    if (wMask > 0) {
      const wcap = -1.5 * r / 420 - 1.6;
      h = h * (1 - wMask) + Math.min(h, wcap) * wMask;
    }
    // Near-camera pad: flat ground under the hero camera.
    const nMask = sstep(25, 95, r);
    h = -3 * (1 - nMask) + h * nMask;
    return h;
  };
}

/* ------------------------------------------------------------------ */
/* Terrain: flat-shaded charcoal heightfield + height-attenuated fog.   */
/* ------------------------------------------------------------------ */
const TERRAIN_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vWp;
varying vec3 vCol;
varying float vFogDepth;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vCol = color;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWp = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const TERRAIN_FRAG = /* glsl */ `
varying vec3 vN;
varying vec3 vWp;
varying vec3 vCol;
varying float vFogDepth;
uniform vec3 uMoonDir;
uniform vec3 uDirColor;     // cold #7FA3CC × intensity
uniform vec3 uHemiSky;      // from Sky: horizonColor brightened
uniform vec3 uGroundBounce;
uniform vec3 uFogColor;     // == sky.horizonColor (same instance)
uniform float uFogDensity;  // == sky.fog.density
uniform float uFogHeightBoost;
uniform float uFogHeightScale;
uniform vec3 uLanternPos[${HERO_LANTERN_LIGHTS}];
uniform vec3 uLanternColor; // warm #D99A4E, linear
uniform float uLanternI;
void main() {
  vec3 N = normalize(vN);
  vec3 L = normalize(uMoonDir);
  float ndl = max(dot(N, L), 0.0);
  vec3 amb = mix(uGroundBounce, uHemiSky, N.y * 0.5 + 0.5);
  vec3 col = vCol * (uDirColor * ndl + amb);
  // Warm pools from the hero lanterns (analytic twin of the PointLights).
  for (int i = 0; i < ${HERO_LANTERN_LIGHTS}; i++) {
    vec3 ld = uLanternPos[i] - vWp;
    float d2 = dot(ld, ld);
    float att = uLanternI / max(d2, 4.0);
    float ndl2 = max(dot(N, ld * inversesqrt(d2)), 0.0);
    col += uLanternColor * (att * ndl2 * vCol * 5.0);
  }
  // Height-attenuated FogExp2: low ground holds more haze.
  float dens = uFogDensity * (1.0 + uFogHeightBoost * exp(-max(vWp.y, 0.0) / uFogHeightScale));
  float f2 = dens * dens * vFogDepth * vFogDepth;
  float fogF = 1.0 - exp(-f2);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

function buildTerrain(noise, heightAt, sky, moonDir, lanternTops) {
  let geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  }
  // Non-indexed → computeVertexNormals yields face normals (flat shading).
  const flat = geo.toNonIndexed();
  geo.dispose();
  flat.computeVertexNormals();

  // Per-face charcoal albedo: patchy fBm variation + slope lightening.
  const nrm = flat.attributes.normal;
  const p = flat.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const [tr, tg, tb] = ENV.terrainTint;
  for (let f = 0; f < p.count; f += 3) {
    const cx = (p.getX(f) + p.getX(f + 1) + p.getX(f + 2)) / 3;
    const cz = (p.getZ(f) + p.getZ(f + 1) + p.getZ(f + 2)) / 3;
    const patch = noise.fbm2(cx * 0.01 + 40.2, cz * 0.01 + 17.9, 3);
    const ny = (nrm.getY(f) + nrm.getY(f + 1) + nrm.getY(f + 2)) / 3;
    const slope = 1 - Math.min(1, Math.max(0, ny));
    const l = 0.055 + 0.05 * patch + slope * 0.06; // linear charcoal
    for (let k = 0; k < 3; k++) {
      colors[(f + k) * 3] = l * tr;
      colors[(f + k) * 3 + 1] = l * tg;
      colors[(f + k) * 3 + 2] = l * tb;
    }
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const lanternPos = [];
  for (let i = 0; i < HERO_LANTERN_LIGHTS; i++) {
    lanternPos.push(lanternTops[i] ? lanternTops[i].clone() : new THREE.Vector3());
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMoonDir: { value: moonDir.clone() },
      uDirColor: { value: new THREE.Color(ENV.moonFill).multiplyScalar(0.85) },
      uHemiSky: { value: new THREE.Color(sky.horizonColor).multiplyScalar(1.5) },
      uGroundBounce: { value: new THREE.Color(ENV.groundBounce) },
      uFogColor: { value: sky.horizonColor }, // SAME instance — cannot drift
      uFogDensity: { value: sky.fog.density },
      uFogHeightBoost: { value: FOG_HEIGHT_BOOST },
      uFogHeightScale: { value: FOG_HEIGHT_SCALE },
      uLanternPos: { value: lanternPos },
      uLanternColor: { value: new THREE.Color(ENV.lanternAmber) },
      uLanternI: { value: LANTERN_LIGHT_INTENSITY },
    },
    vertexShader: TERRAIN_VERT,
    fragmentShader: TERRAIN_FRAG,
    vertexColors: true,
    fog: false, // fog is manual (height-attenuated) in this shader
  });
  const mesh = new THREE.Mesh(flat, mat);
  mesh.frustumCulled = false;
  return { mesh, mat };
}

/* ------------------------------------------------------------------ */
/* Water: moon-glint streak aligned to the moon azimuth (world space). */
/* ------------------------------------------------------------------ */
const WATER_VERT = /* glsl */ `
varying vec3 vWp;
varying float vFogDepth;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWp = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const WATER_FRAG = /* glsl */ `
varying vec3 vWp;
varying float vFogDepth;
uniform float uMoonAz;      // scripted moon azimuth (camera convention)
uniform float uTime;        // engine frame-clock seconds
uniform float uFogDensity;  // == sky.fog.density
uniform vec3 uGlintColor;   // moonlit streak tint, linear (peak ≤ 1.0)
uniform float uGlintPeak;     // transmission-coupled peak (setGlint)
uniform float uGlintWidth;    // transmission-coupled width (setGlint)
uniform float uGlintContrast; // transmission-coupled sparkle contrast (setGlint)
uniform vec3 uDeep;
uniform vec3 uSheen;
uniform vec3 uFogColor;     // == sky.horizonColor (same instance)
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec2 xz = vWp.xz;
  // Streak geometry: a world-space band along the moon-azimuth ray from
  // the viewer. Width grows with distance (perspective-correct shimmer) and
  // softens with atmospheric transmission (uGlintWidth — never raw fogDensity).
  vec2 md = vec2(cos(uMoonAz), sin(uMoonAz));
  float along = dot(xz, md);
  vec2 rel = xz - md * along;
  float w = (3.5 + max(along, 0.0) * 0.022) * uGlintWidth;
  float streak = exp(-dot(rel, rel) / (w * w));
  float range = smoothstep(30.0, 80.0, along) * (1.0 - smoothstep(480.0, 850.0, along));
  // Animated sparkle: fine-grained seeded value noise — sparse bright
  // glints on a steady base, so the streak center stays on the true ray.
  float sp = vnoise(xz * 1.7 + vec2(uTime * 0.9, -uTime * 0.7));
  sp = smoothstep(0.55, 0.95, sp);
  float sp2 = vnoise(xz * 0.11 - vec2(uTime * 0.21, uTime * 0.13));
  vec3 col = uDeep + uSheen * (0.35 + 0.65 * sp2);
  // Glint participates in the same visibility logic as the scene: as density
  // rises the peak dims AND the streak widens/softens (via setGlint, driven
  // by the transmission formula below — NOT a raw fogDensity multiply).
  // Sparkle structure kept; only scaled by the chapter curves.
  col += uGlintColor * uGlintPeak * streak * range * (0.55 + 0.65 * sp * uGlintContrast);
  float f2 = uFogDensity * uFogDensity * vFogDepth * vFogDepth;
  col = mix(col, uFogColor, clamp(1.0 - exp(-f2), 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

function buildWater(sky, moonAzimuth) {
  const geo = new THREE.PlaneGeometry(WATER.w, WATER.d, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMoonAz: { value: moonAzimuth },
      uTime: { value: 0 },
      uFogDensity: { value: sky.fog.density },
      uGlintColor: { value: new THREE.Color(0.78, 0.64, 0.50) }, // linear, peak ≤ 1
      uGlintPeak: { value: 1 },     // chapter curve (setGlint / setChapterEnv)
      uGlintWidth: { value: 1 },
      uGlintContrast: { value: 1 },
      uDeep: { value: new THREE.Color(ENV.waterDeep) },
      uSheen: { value: new THREE.Color(ENV.moonFill).multiplyScalar(0.045) },
      uFogColor: { value: sky.horizonColor }, // SAME instance
    },
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(WATER.x, WATER_Y, WATER.z);
  mesh.frustumCulled = false;
  return { mesh, mat };
}

/* ------------------------------------------------------------------ */
/* Scatter: instanced trees / rocks / lanterns + warm light pools.     */
/* ------------------------------------------------------------------ */
const POOL_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFogDepth;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * wp;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const POOL_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vFogDepth;
uniform vec3 uAmber;       // warm #D99A4E, linear
uniform float uFogDensity; // == sky.fog.density
uniform float uPoolIntensity;  // chapter curve: pool brightness (setLanterns)
uniform float uPoolVisibility; // chapter curve: pool visibility gate (setLanterns)
void main() {
  vec2 q = vUv - 0.5;
  float d = length(q) * 2.0;
  float a = pow(max(1.0 - d, 0.0), 2.2) * 0.55 * uPoolIntensity * uPoolVisibility;
  // Additive fog: distant pools fade to nothing (never toward a color).
  float f2 = uFogDensity * uFogDensity * vFogDepth * vFogDepth;
  a *= exp(-f2);
  gl_FragColor = vec4(uAmber, a);
}
`;

function angDiff(a, b) {
  let d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

function makeRockGeo() {
  const g = new THREE.IcosahedronGeometry(1.6, 1);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // Deterministic position-hash jitter (pure function of the vertex).
    const s = v.x * 12.9898 + v.y * 78.233 + v.z * 37.719;
    const hsh = Math.abs(Math.sin(s) * 43758.5453) % 1;
    const k = 0.65 + hsh * 0.7;
    p.setXYZ(i, v.x * k, v.y * k * 0.72, v.z * k);
  }
  g.computeVertexNormals();
  return g;
}

function makeInstanced(geo, mat, items) {
  const m = new THREE.InstancedMesh(geo, mat, items.length);
  const d = new THREE.Object3D();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    d.position.set(it.x, it.y, it.z);
    d.rotation.set(0, it.rot, 0);
    d.scale.set(it.s, it.sy === undefined ? it.s : it.sy, it.s);
    d.updateMatrix();
    m.setMatrixAt(i, d.matrix);
  }
  m.instanceMatrix.needsUpdate = true;
  return m;
}

/* ------------------------------------------------------------------ */
/* Embers: seeded drift, moonlit. Time only via setTime(t).            */
/* ------------------------------------------------------------------ */
const EMBER_VERT = /* glsl */ `
attribute vec4 aSeed; // x: phase01, y: speed, z: drift/warm factor, w: size
uniform float uTime;  // engine frame-clock seconds (the ONLY time input)
uniform float uPixelRatio;
uniform float uEmberDrift; // chapter curve: x/z motion amplitude scale
uniform float uFloorSize;   // Phase 5 A/B perceptual floor: min point size, drawing-buffer px (0 = off)
varying float vFade;
varying float vWarm;
varying float vSeed;
void main() {
  vec3 p = position;
  float ph = aSeed.x * 6.2831;
  float t = uTime * aSeed.y;
  p.x += sin(t * 0.8 + ph) * (2.0 + aSeed.z * 7.0) * uEmberDrift;
  p.z += cos(t * 0.62 + ph * 1.3) * (2.0 + aSeed.z * 7.0) * uEmberDrift;
  float cyc = fract(aSeed.x + uTime * 0.016 * aSeed.y);
  p.y += cyc * 30.0;
  vFade = sin(3.14159 * cyc);
  vWarm = aSeed.z;
  vSeed = aSeed.x;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = max(aSeed.w * uPixelRatio * (240.0 / max(-mv.z, 1.0)), uFloorSize);
  gl_Position = projectionMatrix * mv;
}
`;

const EMBER_FRAG = /* glsl */ `
varying float vFade;
varying float vWarm;
varying float vSeed;
uniform float uEmberOpacity; // chapter curve: fragment-alpha gate (applied FIRST)
uniform float uEmberDensity; // chapter curve: deterministic population gate
uniform float uEmberWarmth;  // chapter curve: warm-color mix factor scale
uniform float uEmberSignalLift; // Phase 16: 0=legacy a^2 signal, 1=linear additive signal
uniform float uFloorOpacity; // Phase 5 A/B perceptual floor: min alpha multiplier (0 = off)
void main() {
  // Density: deterministic discard — a pure function of the seed, no randomness.
  if (fract(sin(vSeed * 127.1) * 43758.5453) > uEmberDensity) discard;
  vec2 q = gl_PointCoord - 0.5;
  float d = length(q) * 2.0;
  // The floor is applied in-shader (max) so setEmbers() stays a pure function
  // of its arguments and chapter data is never rewritten for a viewport.
  float a = smoothstep(1.0, 0.2, d) * vFade * 0.55 * max(uEmberOpacity, uFloorOpacity);
  // Warmth scales the warm mix factor (mixes toward the cool base when low).
  vec3 col = mix(vec3(0.42, 0.38, 0.44), vec3(0.55, 0.38, 0.22), vWarm * uEmberWarmth);

  // Phase 16: the legacy shader outputs premultiplied color (col*a) while
  // AdditiveBlending applies source alpha again, so the visible contribution
  // is effectively col*a^2. Keep the exact legacy expression on the zero path
  // so existing scenes do not acquire a new floating-point route.
  float lift = clamp(uEmberSignalLift, 0.0, 1.0);
  if (lift <= 0.0) {
    gl_FragColor = vec4(col * a, a);
    return;
  }
  // lift=1 outputs straight color and lets blending apply alpha once
  // (effective col*a). Intermediate values provide a continuous, bounded lift.
  vec3 src = mix(col * a, col, lift);
  gl_FragColor = vec4(src, a);
}
`;

function buildEmbers(rngE, count, avoidEmber, uPixelRatio) {
  const posArr = new Float32Array(count * 3);
  const seedArr = new Float32Array(count * 4);
  let placed = 0, guard = 0;
  while (placed < count && guard++ < count * 80) {
    const a = rngE.float() * Math.PI * 2;
    const r = 30 + Math.sqrt(rngE.float()) * 670;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (avoidEmber(x, z, r, a)) continue;
    posArr[placed * 3] = x;
    posArr[placed * 3 + 1] = 1 + rngE.float() * 25;
    posArr[placed * 3 + 2] = z;
    seedArr[placed * 4] = rngE.float();
    seedArr[placed * 4 + 1] = 0.6 + rngE.float() * 0.8;
    seedArr[placed * 4 + 2] = rngE.float();
    seedArr[placed * 4 + 3] = 1.4 + rngE.float() * 2.2;
    placed++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seedArr, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: uPixelRatio },
      uEmberOpacity: { value: 1 }, // chapter curve (setEmbers / setChapterEnv)
      uEmberDensity: { value: 1 },
      uEmberDrift: { value: 1 },
      uEmberWarmth: { value: 1 },
      uEmberSignalLift: { value: 0 }, // Phase 16 opt-in; 0 preserves legacy pixels
      uFloorSize: { value: 0 },    // Phase 5 A/B perceptual floor (0 = off)
      uFloorOpacity: { value: 0 }, // Phase 5 A/B perceptual floor (0 = off)
    },
    vertexShader: EMBER_VERT,
    fragmentShader: EMBER_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 3;
  return { points, mat, placed, posArr, seedArr };
}

/* ------------------------------------------------------------------ */
/* FNV-1a for the layout hash (determinism proof).                     */
/* ------------------------------------------------------------------ */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/* ------------------------------------------------------------------ */
/* buildEnvironment — the Phase 3 module entry point.                  */
/* ------------------------------------------------------------------ */
export function buildEnvironment(rng = new Rng(7), opts = {}) {
  const sky = opts.sky;
  if (!sky || !sky.horizonColor || !sky.fog) {
    throw new Error('[environment] opts.sky (with horizonColor + fog) is required — explicit module input (FINAL-PLAN §3)');
  }
  const seed = Number.isInteger(opts.seed) ? opts.seed : (rng.seed | 0);
  const tier = opts.tier || 'cinematic';
  const moonAzimuth = opts.moonAzimuth ?? 0.35;
  const moonElevation = opts.moonElevation ?? 0.16;
  const scatterScale = TIER_SCATTER_SCALE[tier] ?? 1;

  // Dedicated seeded streams per component (order-independent determinism).
  const salt = (n) => new Rng(((seed ^ n) >>> 0));
  const noise = makeNoise(seed);
  const heightAt = makeHeightField(noise, moonAzimuth);
  const moonDir = dirFromAzEl(moonAzimuth, moonElevation);

  const group = new THREE.Group();
  group.name = 'environment';

  /* Ridge crests FIRST: fixed distances, azimuth scan for max elevation.
   * Scatter is then kept clear of these rays so the ridge test samples
   * terrain, never a tree. */
  function ridgeCrests(azMin = RIDGE_AZ_MIN, azMax = RIDGE_AZ_MAX, moonClear = 0.20) {
    const out = [];
    for (const rT of RIDGE_DISTANCES) {
      let best = null;
      for (let az = azMin; az <= azMax; az += 0.008) {
        if (angDiff(az, moonAzimuth) < moonClear) continue; // keep the moon clear
        const x = Math.cos(az) * rT, z = Math.sin(az) * rT;
        const h = heightAt(x, z);
        const e = Math.atan2(h + 2.5, rT);
        if (!best || e > best.e) best = { e, x, h: h + 2.5, z, az, r: rT };
      }
      out.push(best);
    }
    return out;
  }
  const crests = ridgeCrests();

  function inBasin(x, z, margin) {
    const dx = (x - BASIN.x) / BASIN.rx, dz = (z - BASIN.z) / BASIN.rz;
    return dx * dx + dz * dz < margin;
  }
  function avoid(x, z, r, a) {
    if (inBasin(x, z, 1.25)) return true;
    if (angDiff(a, moonAzimuth) < 0.13 && r > 150) return true; // moon corridor
    for (const c of crests) {
      if (angDiff(a, c.az) < 0.02 && r < c.r + 60) return true; // ridge rays
    }
    return false;
  }
  function scatterSpots(rngS, count, rMin, rMax) {
    const pts = [];
    let guard = 0;
    while (pts.length < count && guard++ < count * 80) {
      const a = rngS.float() * Math.PI * 2;
      const r = rMin + Math.sqrt(rngS.float()) * (rMax - rMin);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (avoid(x, z, r, a)) continue;
      pts.push({
        x, z, r, a,
        y: heightAt(x, z) - 0.3,
        s: 0.7 + rngS.float() * 0.9,
        sy: 0.85 + rngS.float() * 0.5, // vertical stretch variety (pines)
        rot: rngS.float() * Math.PI * 2,
      });
    }
    return pts;
  }

  /* Lanterns: a ring around the basin shore + dry-land scatter.
   * (Rejected below the waterline; the inlet stays clear for the glint.) */
  const rngL = salt(0x1a4e71);
  const lanterns = [];
  function pushLantern(x, z) {
    const r = Math.hypot(x, z), a = Math.atan2(z, x);
    if (angDiff(a, moonAzimuth) < 0.13 && r > 150) return false; // moon corridor
    for (const c of crests) {
      if (angDiff(a, c.az) < 0.02 && r < c.r + 60) return false; // ridge rays
    }
    const y = heightAt(x, z);
    if (y < 0.3) return false; // below the waterline — dry land only
    lanterns.push({ x, z, r, a, y: y - 0.1, s: 0.85 + rngL.float() * 0.4, rot: rngL.float() * Math.PI * 2 });
    return true;
  }
  {
    let guard = 0;
    while (lanterns.length < 16 && guard++ < 12000) {
      // Shore ring: just outside the basin ellipse.
      const phi = rngL.float() * Math.PI * 2;
      const rr = 1.15 + rngL.float() * 0.4;
      pushLantern(BASIN.x + Math.cos(phi) * BASIN.rx * rr, BASIN.z + Math.sin(phi) * BASIN.rz * rr);
    }
    guard = 0;
    while (lanterns.length < SCATTER_COUNTS.lanterns && guard++ < 20000) {
      const a = rngL.float() * Math.PI * 2;
      const r = 60 + Math.sqrt(rngL.float()) * 640;
      pushLantern(Math.cos(a) * r, Math.sin(a) * r);
    }
  }
  // Hero lanterns: nearest to camera get real PointLights (reassignable via
  // setLanterns heroSlots: 'nearest' (below) or 'vermilion' (moon azimuth)).
  let heroIdx = lanterns
    .map((l, i) => i)
    .sort((p, q) => lanterns[p].r - lanterns[q].r)
    .slice(0, HERO_LANTERN_LIGHTS);
  const lanternTops = heroIdx.map((i) => new THREE.Vector3(lanterns[i].x, lanterns[i].y + 3.4, lanterns[i].z));

  /* Terrain (needs the hero lantern tops for its analytic warm pools). */
  const terrain = buildTerrain(noise, heightAt, sky, moonDir, lanternTops);
  group.add(terrain.mesh);

  /* Water. */
  const water = buildWater(sky, moonAzimuth);
  group.add(water.mesh);

  /* Scatter. */
  const nTrees = Math.round(SCATTER_COUNTS.trees * scatterScale);
  const nRocks = Math.round(SCATTER_COUNTS.rocks * scatterScale);
  const trees = makeInstanced(
    (() => { const g = new THREE.ConeGeometry(3.4, 14, 7); g.translate(0, 7, 0); return g; })(),
    new THREE.MeshLambertMaterial({ color: '#0e1319' }),
    scatterSpots(salt(0x7ee5), nTrees, 70, 950)
  );
  const rocks = makeInstanced(
    makeRockGeo(),
    new THREE.MeshLambertMaterial({ color: '#1b2027', flatShading: true }),
    scatterSpots(salt(0x20cc), nRocks, 50, 1100)
  );
  const postGeo = new THREE.BoxGeometry(0.55, 2.8, 0.55); postGeo.translate(0, 1.4, 0);
  const posts = makeInstanced(postGeo, new THREE.MeshLambertMaterial({ color: '#22262e' }), lanterns);
  const glowGeo = new THREE.BoxGeometry(1.15, 1.5, 1.15); glowGeo.translate(0, 3.1, 0);
  const amberGlow = new THREE.Color(ENV.lanternAmber).multiplyScalar(0.95); // ≤ 1.05, always
  // Brightest channel of the base glow — setLanterns clamps poolIntensity so
  // the scaled glow material color NEVER exceeds 1.05 pre-tonemap.
  const glowBaseMax = Math.max(amberGlow.r, amberGlow.g, amberGlow.b);
  const glows = makeInstanced(glowGeo, new THREE.MeshBasicMaterial({ color: amberGlow }), lanterns);
  const poolGeo = new THREE.CircleGeometry(13, 24); poolGeo.rotateX(-Math.PI / 2);
  const pools = makeInstanced(poolGeo, new THREE.ShaderMaterial({
    uniforms: {
      uAmber: { value: new THREE.Color(ENV.lanternAmber) },
      uFogDensity: { value: sky.fog.density },
      uPoolIntensity: { value: 1 },  // chapter curve (setLanterns / setChapterEnv)
      uPoolVisibility: { value: 1 },
    },
    vertexShader: POOL_VERT,
    fragmentShader: POOL_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  }), lanterns.map((l) => ({ ...l, y: l.y + 0.15, s: l.s })));
  pools.renderOrder = 2;
  group.add(trees, rocks, posts, glows, pools);

  /* Embers. */
  const nEmbers = Math.round(SCATTER_COUNTS.embers * scatterScale);
  const embers = buildEmbers(salt(0xe8be25), nEmbers,
    (x, z, r, a) => angDiff(a, moonAzimuth) < 0.13 && r > 150, 1);
  group.add(embers.points);
  /* Phase 5 A/B perceptual floor: in-shader max() floors, so chapter curves
   * and the 420 population are untouched. Deterministic: the flag is a build
   * input like tier, hence part of the rendering config. */
  const emberFloor = opts.emberFloor === true;
  if (emberFloor) {
    embers.mat.uniforms.uFloorSize.value = EMBER_FLOOR_SIZE_PX;
    embers.mat.uniforms.uFloorOpacity.value = EMBER_FLOOR_OPACITY;
  }

  /* Moonlight rig: cold directional + hemisphere (from Sky) + amber points. */
  const dirLight = new THREE.DirectionalLight(new THREE.Color(ENV.moonFill), 0.85);
  dirLight.position.copy(moonDir).multiplyScalar(900);
  group.add(dirLight, dirLight.target);
  const hemi = new THREE.HemisphereLight(
    new THREE.Color(sky.horizonColor).multiplyScalar(1.5),
    new THREE.Color(ENV.groundBounce),
    0.55
  );
  group.add(hemi);
  const pointLights = lanternTops.map((p) => {
    const pl = new THREE.PointLight(new THREE.Color(ENV.lanternAmber), LANTERN_LIGHT_INTENSITY, LANTERN_LIGHT_DISTANCE, 2);
    pl.position.copy(p);
    group.add(pl);
    return pl;
  });

  /* ---- public API ---- */
  let azNow = moonAzimuth, elNow = moonElevation;
  const upVec = new THREE.Vector3(0, 1, 0);

  function setMoonDirection(az, el) {
    azNow = az; elNow = el;
    moonDir.copy(dirFromAzEl(az, el));
    dirLight.position.copy(moonDir).multiplyScalar(900);
    terrain.mat.uniforms.uMoonDir.value.copy(moonDir);
    water.mat.uniforms.uMoonAz.value = az;
  }

  function setTime(t) {
    water.mat.uniforms.uTime.value = t;
    embers.mat.uniforms.uTime.value = t;
  }

  /* ---------------------------------------------------------------- */
  /* Chapter-curve API (Phase 3 reviews Q1/Q3/Q4/Q5). Every setter is a */
  /* pure function of its arguments — no accumulated state — so        */
  /* render(seed, tier, chapterParams, t) stays deterministic.          */
  /* ---------------------------------------------------------------- */

  /** Chapter fog control: ONE density parameter drives sky.fog AND the three
   * shader uniforms that snapshotted it at build time (terrain, water, pool).
   * The FogExp2 + height-boost model itself is untouched (verified — Q1). */
  function setFogDensity(d) {
    sky.fog.density = d;
    terrain.mat.uniforms.uFogDensity.value = d;
    water.mat.uniforms.uFogDensity.value = d;
    pools.material.uniforms.uFogDensity.value = d;
  }
  function getFogDensity() {
    return sky.fog.density;
  }

  /** Ember chapter gating — curves, not binary on/off (Q4: gate opacity
   * first, keep the 420 deterministic population, keep the grain rule). */
  function setEmbers({ opacity, density, drift, warmth, signalLift } = {}) {
    const u = embers.mat.uniforms;
    if (opacity !== undefined) u.uEmberOpacity.value = opacity;
    if (density !== undefined) u.uEmberDensity.value = density;
    if (drift !== undefined) u.uEmberDrift.value = drift;
    if (warmth !== undefined) u.uEmberWarmth.value = warmth;
    if (signalLift !== undefined) {
      u.uEmberSignalLift.value = Math.max(0, Math.min(1, Number(signalLift) || 0));
    }
  }

  /* Hero-light reassignment (Q3: hard cap of 4 real lights stays; reassign
   * the slots, never the count). Scratch vector preallocated — no
   * allocations in the per-frame hot path. */
  const _tmpV = new THREE.Vector3();
  let heroSlotsMode = 'nearest'; // matches the build-time selection (above)
  let heroAzCached = NaN;        // azNow at the last 'vermilion' selection

  function selectHeroIndices(mode) {
    const idx = new Array(lanterns.length);
    for (let i = 0; i < lanterns.length; i++) idx[i] = i;
    if (mode === 'vermilion') {
      // The 4 lanterns whose azimuth is closest to the moon azimuth; the
      // moon corridor exclusion is already handled by placement.
      const az = azNow;
      idx.sort((p, q) => angDiff(lanterns[p].a, az) - angDiff(lanterns[q].a, az));
    } else {
      idx.sort((p, q) => lanterns[p].r - lanterns[q].r); // nearest to camera/origin
    }
    return idx.slice(0, HERO_LANTERN_LIGHTS);
  }

  function applyHeroIndices(indices) {
    heroIdx = indices;
    const lp = terrain.mat.uniforms.uLanternPos.value; // analytic twin
    for (let k = 0; k < HERO_LANTERN_LIGHTS; k++) {
      const l = lanterns[indices[k]];
      _tmpV.set(l.x, l.y + 3.4, l.z); // lantern-top world position
      pointLights[k].position.copy(_tmpV);
      lp[k].copy(_tmpV); // keep the analytic twin in sync — correctness
    }
  }

  /** Lantern chapter curves (Q3). heroIntensity scales PointLight.intensity
   * (base 18) and the terrain uLanternI twin (base LANTERN_LIGHT_INTENSITY)
   * together; chapter data uses 0.7–1.15. poolIntensity scales the pool
   * shader alpha AND the glow material color (hard-capped ≤ 1.05/channel
   * pre-tonemap, always). poolVisibility is the chapter visibility gate. */
  function setLanterns({ heroIntensity, poolIntensity, poolVisibility, heroSlots } = {}) {
    if (heroSlots === 'nearest' || heroSlots === 'vermilion') {
      // Reassign only on mode/azimuth change: the selection allocates, so it
      // never runs in the per-frame steady state (hot path = uniform writes).
      if (heroSlots !== heroSlotsMode || (heroSlots === 'vermilion' && azNow !== heroAzCached)) {
        applyHeroIndices(selectHeroIndices(heroSlots));
        heroSlotsMode = heroSlots;
        heroAzCached = azNow;
      }
    }
    if (heroIntensity !== undefined) {
      for (const pl of pointLights) pl.intensity = LANTERN_LIGHT_INTENSITY * heroIntensity;
      terrain.mat.uniforms.uLanternI.value = LANTERN_LIGHT_INTENSITY * heroIntensity;
    }
    if (poolIntensity !== undefined) {
      pools.material.uniforms.uPoolIntensity.value = poolIntensity;
      const s = Math.max(0, Math.min(poolIntensity, 1.05 / glowBaseMax));
      glows.material.color.copy(amberGlow).multiplyScalar(s); // ≤ 1.05 ALWAYS
    }
    if (poolVisibility !== undefined) {
      pools.material.uniforms.uPoolVisibility.value = poolVisibility;
    }
  }

  /* GLINT ↔ ATMOSPHERIC TRANSMISSION (Phase 3 review Q5).
   * The glint is NOT multiplied by raw fogDensity. The chapter system derives
   * a visibility factor V from the SAME FogExp2 model the scene uses —
   * transmittance at the reference distance dRef:
   *     V = exp(-(dRef * dens)^2),   dRef = 400
   * and calls setGlint() with:
   *     peak     = V * chapterGlint
   *     width    = 1 + 2.5 * (1 - V)    (dims AND widens/softens as dens rises)
   *     contrast = 0.4 + 0.6 * V
   * so the streak shares the scene's visibility logic. uMoonAz lock untouched.
   */
  function setGlint({ peak, width, contrast } = {}) {
    const u = water.mat.uniforms;
    if (peak !== undefined) u.uGlintPeak.value = peak;
    if (width !== undefined) u.uGlintWidth.value = width;
    if (contrast !== undefined) u.uGlintContrast.value = contrast;
  }

  /** Unified chapter entry point — what the scroll-driven chapter clock calls
   * every frame. Each group optional; missing group = leave current. Cheap:
   * uniform writes + ≤ 4 light position copies on reassign; no allocations
   * in the hot path (preallocated _tmpV; hero selection only on mode/az change). */
  function setChapterEnv({ fogDensity, ember, lantern, glint } = {}) {
    if (fogDensity !== undefined) setFogDensity(fogDensity);
    if (ember !== undefined) setEmbers(ember);
    if (lantern !== undefined) setLanterns(lantern);
    if (glint !== undefined) setGlint(glint);
  }

  /** Warm/cold light ratio on the reference card (FINAL-PLAN §1.2 ≥ 2.2:1).
   *
   * Chapter-curve invariant: this reads pl.intensity directly, so a
   * heroIntensity scale k scales the warm term (and the ratio) LINEARLY:
   * ratio(k) = k × ratio(1.0). Measured 5.39:1 at k=1.0 →
   * at the chapter floor k=0.7: 0.7 × 5.39 ≈ 3.77:1 ≥ 2.2:1. ✓
   * (Verified numerically in Node — see the chapter-curve test numbers.) */
  function lightRatio() {
    const hero = lanterns[heroIdx[0]];
    const card = new THREE.Vector3(hero.x + REFERENCE_CARD.dx, hero.y + REFERENCE_CARD.dy, hero.z + REFERENCE_CARD.dz);
    const cold = dirLight.intensity * Math.max(upVec.dot(moonDir), 0);
    let warm = 0;
    for (const pl of pointLights) {
      const ld = pl.position.clone().sub(card);
      const d2 = Math.max(ld.lengthSq(), 1);
      warm += pl.intensity / d2 * Math.max(upVec.dot(ld.normalize()), 0);
    }
    return { ratio: warm / Math.max(cold, 1e-6), warm, cold };
  }

  /** Determinism proof: hash of the full scatter layout. */
  function layoutHash() {
    const parts = [`seed=${seed}`, `tier=${tier}`, `az=${azNow.toFixed(4)}`, `el=${elNow.toFixed(4)}`];
    for (const m of [trees, rocks, posts, glows, pools]) {
      parts.push(`n=${m.count}`);
      const arr = m.instanceMatrix.array;
      for (let i = 0; i < arr.length; i++) parts.push(arr[i].toFixed(3));
    }
    for (let i = 0; i < embers.posArr.length; i++) parts.push(embers.posArr[i].toFixed(2));
    for (let i = 0; i < embers.seedArr.length; i++) parts.push(embers.seedArr[i].toFixed(3));
    for (const p of lanternTops) parts.push(p.x.toFixed(2), p.y.toFixed(2), p.z.toFixed(2));
    for (let i = 0; i < 16; i++) {
      const x = -800 + i * 107.3, z = 300 - i * 61.7;
      parts.push(heightAt(x, z).toFixed(2));
    }
    return fnv1a(parts.join(','));
  }

  function dispose() {
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else if (m) m.dispose();
    });
  }

  return {
    kind: 'environment',
    phase: 3,
    seed, tier,
    emberFloor, // Phase 5 A/B flag (build input; false = Grok variant)
    group,
    terrain, water, embers,
    scatter: { trees, rocks, posts, glows, pools, lanterns: lanterns.map((l) => ({ ...l })) },
    lights: { dir: dirLight, hemi, points: pointLights },
    counts: {
      trees: trees.count, rocks: rocks.count,
      lanterns: lanterns.length, embers: embers.placed,
      pointLights: pointLights.length,
    },
    heightAt,
    setMoonDirection,
    setTime,
    setFogDensity,
    getFogDensity,
    setEmbers,
    setLanterns,
    setGlint,
    setChapterEnv,
    /** Ridge crests for the 3-distance convergence test (world Vector3s). */
    ridgeCrests: () => crests.map((c) => new THREE.Vector3(c.x, c.h, c.z)),
    /** Crests rescanned inside a visible azimuth range (narrow viewports). */
    ridgeCrestsIn: (azMin, azMax) =>
      ridgeCrests(azMin, azMax, 0.08)
        .filter(Boolean)
        .map((c) => new THREE.Vector3(c.x, c.h, c.z)),
    lightRatio,
    layoutHash,
    dispose,
  };
}

/** Back-compat alias for the Phase 0 stub name. */
export function createEnvironment({ rng = new Rng(7), ...opts } = {}) {
  return buildEnvironment(rng, opts);
}
