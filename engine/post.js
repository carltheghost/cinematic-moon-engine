/* engine/post.js — the post backend: composer + the ordering law (Phase 1).
 *
 * The ordering law (non-negotiable, FINAL-PLAN §1.3) is ENFORCED IN CODE:
 * passes are constructed in fixed sequence — scene → bloom → ACES → grade —
 * and the passes array is never exposed for reordering.
 *
 *   RenderPass → BloomEffect (mipmap, threshold ≥ 1) → final EffectPass
 *   (exposure → ACES → 3D LUT → vignette → grain), all in HalfFloat.
 *
 * BLOOM SELECTIVITY — BY CONSTRUCTION (D1, "grade the night first"):
 *   The ONLY scene object above 1.0 pre-tonemap is the moon/fixture (emissive
 *   3.0); stars top out at 0.6, the sky at ~0.2. The bloom luminance threshold
 *   is 1.0 with smoothing 0.2, so the bright-pass can only ever contain the
 *   moon — bloom isolation is structural, not tuned.
 *
 *   scene ----[RenderPass]----> HDR buffer (HalfFloat, no MSAA)
 *     |--- threshold ≥ 1.0 ---> bloom mip chain (moon only, by construction)
 *     └--- full frame -------> final pass: exposure ×1.0 → ACES fit →
 *                              16³ 3D LUT → vignette → luma-weighted grain
 *                              → sRGB encode in-shader → screen
 *
 * Grain (FINAL-PLAN §1.2, D1):
 *   - RMS 0.10 at midtones; weighting is 1/√luma ABOVE midtone (melts out of
 *     highlights) and shadow-tapered BELOW midtone so the near-black sky stays
 *     under the #16202F ceiling (see build log 2026-09-19);
 *   - grain *= smoothstep(0.0, 0.02, luma): crushed blacks are grain-free;
 *   - hash engine = (seed, frame), NEVER wall time; frozen when reduced motion
 *     (uFrame pinned to 0) or when the tier is 'still'.
 *   - moon mask: grain ramps to 0 inside one disc radius (uMoonRadiusPx = 0
 *     disables the mask).
 *
 * PER-TIER POST GRAPH (Phase 5; Grok Q7 — reduced motion is a first-class input):
 *   { tier, frame, stillMode } → pixels, where
 *     frame     = the host's canonical deterministic frame from
 *                 engine/presentation.js (floor(motionSimTime*60); 0 under
 *                 reduced motion). The ONLY time input the graph may consume.
 *     stillMode = reducedMotion || tier === 'still'.
 *   Under stillMode the graph is a pure function of ONE still input:
 *     - grain uFrame pinned to 0 (frozen, not stepped),
 *     - bloom crossfade frozen (deterministic in `frame`; see render()),
 *     - bloom/glow purely spatial, vignette purely spatial (uv),
 *     - exposure chapter-keyed via the quantized motionChapterT.
 *   NO temporal post effects exist in this graph: no temporal AA, no temporal
 *   noise, no accumulation, no motion blur, no adaptive effects. Any future
 *   temporal effect must be designed as an explicit deterministic state machine
 *   covered by the determinism contract (GPT Q7) — it does not get to sneak in
 *   through a library default.
 *
 * Vignette: authored 42% corner darkening, onset at 0.60 of the half-diagonal,
 * smooth profile — no hard edge in the central 60%.
 *
 * pmndrs postprocessing is the primary chain (D4); the three-addons chain is
 * a documented swap path, built only if pmndrs breaks.
 */
import * as THREE from 'three';
import { Effect, EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing';
import { Rng } from './seed.js';
import { DPR_CAP } from './seed.js';

export const POST_CONTRACT = Object.freeze({
  chain: ['scene', 'bloom', 'aces', 'grade(lut+vignette+grain)'],
  bloom: Object.freeze({ threshold: 1.0, smoothing: 0.2, intensityMax: 0.9, mipChain: 'half-res' }),
  bloomIsolation: 'non-moon bloom-buffer energy < 2% of moon energy',
  bloomSkyLift: '≤ +4 luma levels at 5 disc radii',
  grain: 'luma-weighted ∝ 1/√luma above midtone, shadow-tapered below; temporally seeded; frozen under prefers-reduced-motion',
  toneMap: 'ACES fit x(2.51x+0.03)/(x(2.43x+0.59)+0.14), exposure 1.0 ± 0.15 per chapter',
  composerRules: 'set renderer size/DPR BEFORE composer construction; composer.setSize() on every resize; no MSAA under the composer',
});

export const GRADE_CHAIN = POST_CONTRACT.chain;
export const BLOOM_INTENSITY = 0.85; // ≤ 0.9 per contract
export const BLOOM_BY_TIER = Object.freeze({
  cinematic: 0.85,
  balanced: 0.85,
  efficient: 0.0,
  still: 0.0,
});
export const BLOOM_FADE_FRAMES = 30;
export const VIGNETTE_STRENGTH = 0.42; // authored 40%+ corner darkening
export const VIGNETTE_ONSET = 0.60;    // of the half-diagonal
/** Grain amplitude calibrated so midtone RMS ≈ 0.10 (build log 2026-09-19). */
export const GRAIN_AMPLITUDE = 0.1732;

/**
 * Generate a neutral (identity) 3D LUT as a Data3DTexture. Chapters swap in
 * graded LUTs via setGrade(); the neutral one keeps Phase 1 honest.
 */
export function generateNeutralLUT(size = 16) {
  const n = size * size * size;
  const data = new Uint8Array(n * 4);
  let i = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        // three.js Data3DTexture: x fastest, then y, then z.
        data[i++] = Math.round((r / (size - 1)) * 255);
        data[i++] = Math.round((g / (size - 1)) * 255);
        data[i++] = Math.round((b / (size - 1)) * 255);
        data[i++] = 255;
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.userData.lutSize = size; // the grade shader needs the size for its scale/bias
  tex.needsUpdate = true;
  return tex;
}

const GRADE_FRAG = /* glsl */ `
uniform float uExposure;      // chapter keyframes drive ±0.15 (Phase 4)
uniform highp sampler3D uLut; // 16³ chapter LUT (linear in/out)
uniform float uLutSize;       // LUT edge size (16) — drives the scale/bias below
uniform float uVignette;      // authored corner darkening (0.42)
uniform vec2 uResolution;     // drawing-buffer px (for moon-mask radius)
uniform float uGrain;         // calibrated amplitude (0.1732 → 0.10 RMS)
uniform float uSeed;          // engine hash seed — never wall time
uniform float uFrame;         // deterministic sim-time frame (floor(simTime*60)), 0 when frozen
uniform vec2 uMoonCenter;     // moon disc center, UV
uniform float uMoonRadiusPx;  // moon disc radius, drawing-buffer px (0 = off)

vec3 acesFit(vec3 x) {
  // Stephen Hill / Krzysztof Narkowicz ACES approximation.
  return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 linToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - vec3(0.055);
  return mix(lo, hi, step(vec3(0.0031308), c));
}

// Deterministic 2→1 hash keyed on (seed, frame, pixel). No wall clocks.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // 1. Exposure.
  vec3 col = inputColor.rgb * uExposure;

  // 2. ACES fit (filmic shoulder — the moon rolls off instead of clipping).
  vec3 disp = acesFit(col);

  // 3. 16³ chapter LUT (linear in/out). The scale/bias maps the [0,1] signal
  // onto texel centers so an identity-encoded LUT is a TRUE identity under
  // linear filtering (without it, near-black collapses to the edge texel).
  vec3 lutUV = clamp(disp, 0.0, 1.0) * ((uLutSize - 1.0) / uLutSize) + (0.5 / uLutSize);
  disp = texture(uLut, lutUV).rgb;

  // 4. sRGB encode — the grade is authored in display space from here on.
  disp = linToSrgb(disp);

  // 5. Vignette: authored 42% corner darkening, onset at 0.60 half-diagonal.
  // vdd is normalized so 0 = frame center, 1 = corner (aspect-corrected).
  vec2 asp = vec2(1.0, uResolution.y / max(uResolution.x, 1.0));
  float vdd = length((uv - 0.5) * 2.0 * asp) / length(asp);
  disp *= 1.0 - uVignette * smoothstep(0.60, 0.74, vdd);

  // 6. Luma-weighted grain.
  float l = dot(disp, vec3(0.2126, 0.7152, 0.0722));
  // 1/sqrt(luma) above midtone (melts out of highlights); shadow-tapered below
  // so the near-black sky stays under its ceiling (build log 2026-09-19).
  float wHi = inversesqrt(max(l, 1e-4) * 2.0);
  float wLo = sqrt(l / 0.5) * smoothstep(0.02, 0.20, l);
  float w = min(wHi, wLo);
  float cut = smoothstep(0.0, 0.02, l); // crushed blacks stay grain-free
  float h = hash12(uv * uResolution + vec2(uSeed * 17.0, uFrame * 131.0));
  float g = (h - 0.5) * 2.0 * uGrain * w * cut;
  // Moon mask: grain ramps to zero inside one disc radius (default off).
  float moonCut = 1.0;
  if (uMoonRadiusPx > 0.5) {
    float md = length((uv - uMoonCenter) * uResolution) / uMoonRadiusPx;
    moonCut = smoothstep(0.8, 1.0, md);
  }
  disp += g * moonCut;

  outputColor = vec4(clamp(disp, 0.0, 1.0), 1.0);
}
`;

class GradeEffect extends Effect {
  constructor(lut) {
    super('GradeEffect', GRADE_FRAG, {
      uniforms: new Map([
        ['uExposure', new THREE.Uniform(1.0)],
        ['uLut', new THREE.Uniform(lut)],
        ['uLutSize', new THREE.Uniform(lut && lut.userData ? lut.userData.lutSize || 16 : 16)],
        ['uVignette', new THREE.Uniform(VIGNETTE_STRENGTH)],
        ['uResolution', new THREE.Uniform(new THREE.Vector2(1, 1))],
        ['uGrain', new THREE.Uniform(GRAIN_AMPLITUDE)],
        ['uSeed', new THREE.Uniform(7)],
        ['uFrame', new THREE.Uniform(0)],
        ['uMoonCenter', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
        ['uMoonRadiusPx', new THREE.Uniform(0)],
      ]),
    });
  }
}

/** float16 bits → float32 (for the bloom probe readback). */
function halfToFloat(bits) {
  const s = (bits & 0x8000) >> 15;
  const e = (bits & 0x7c00) >> 10;
  const f = bits & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -24) * f;
  if (e === 31) return f === 0 ? (s ? -Infinity : Infinity) : NaN;
  return (s ? -1 : 1) * Math.pow(2, e - 25) * (1024 + f);
}

/**
 * Build the post pipeline.
 * ORDERING LAW (D4): renderer size + DPR are set BEFORE the composer is
 * constructed, and the composer is resized on every resize.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {object} opts — { width, height, dpr, seed, tier, reducedMotion }
 */
export function buildPost(renderer, scene, camera, opts = {}) {
  const {
    width = 1280,
    height = 720,
    dpr = 1,
    seed = 7,
    tier = 'cinematic',
    reducedMotion = false,
  } = opts;

  // --- Ordering law, step 1: renderer is fully sized BEFORE the composer. ---
  const clampedDpr = Math.min(dpr, DPR_CAP);
  renderer.setPixelRatio(clampedDpr);
  renderer.setSize(width, height);
  renderer.toneMapping = THREE.NoToneMapping; // the grade pass owns tone mapping

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: 0, // no MSAA under the composer (perf + resolve cost)
  });

  // --- Ordering law, step 2: fixed pass order, constructed in sequence. ---
  const renderPass = new RenderPass(scene, camera);
  const bloom = new BloomEffect({
    mipmapBlur: true, // half-res mip chain
    luminanceThreshold: 1.0, // selectivity BY CONSTRUCTION (see header)
    luminanceSmoothing: 0.2,
    intensity: BLOOM_BY_TIER[tier] ?? BLOOM_INTENSITY, // ≤ 0.9 per contract
    radius: 0.8,
    levels: 7,
  });
  const bloomPass = new EffectPass(camera, bloom);
  const grade = new GradeEffect(generateNeutralLUT(16));
  const gradePass = new EffectPass(camera, grade);
  // sRGB is encoded in-shader (the grade is authored in display space, and the
  // grain must live after the encode). Disable the library's output encode.
  gradePass.encodeOutput = false;

  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(gradePass);
  if (
    composer.passes[0] !== renderPass ||
    composer.passes[1] !== bloomPass ||
    composer.passes[2] !== gradePass
  ) {
    throw new Error('[post] ordering-law violation: pass order is not scene→bloom→grade');
  }

  const gu = (name) => grade.uniforms.get(name);
  gu('uSeed').value = seed;
  const dbSize = renderer.getDrawingBufferSize(new THREE.Vector2());
  gu('uResolution').value.copy(dbSize);

  const state = {
    tier,
    bloomFrom: BLOOM_BY_TIER[tier] ?? BLOOM_INTENSITY,
    bloomTo: BLOOM_BY_TIER[tier] ?? BLOOM_INTENSITY,
    bloomStartFrame: 0,
    bloomCurrent: BLOOM_BY_TIER[tier] ?? BLOOM_INTENSITY,
    lastFrame: 0,
    neutralLUT: gu('uLut').value,
    // D1 bloom bake-off decisions (Phase 2): eligibility[tier] === false kills
    // mip bloom for that tier (halo-only). null = not yet decided → allowed.
    // 2026-09-19 bake-off: FAIL (3.8% limb reduction < 20%) → bloom dies outside
    // cinematic. Cinematic ships (halo+bloom); others are halo-only.
    bloomEligibility: { cinematic: true, balanced: false, efficient: false, still: false },
  };

  /** Effective bloom target for a tier (bake-off kill forces halo-only). */
  function bloomTargetFor(t) {
    if (state.bloomEligibility[t] === false) return 0;
    return BLOOM_BY_TIER[t] ?? BLOOM_INTENSITY;
  }

  function setSize(w, h) {
    // --- Ordering law, step 3: composer resized on EVERY resize. ---
    renderer.setSize(w, h);
    composer.setSize(w, h);
    renderer.getDrawingBufferSize(dbSize);
    gu('uResolution').value.copy(dbSize);
  }

  function render(frame) {
    // Deterministic 30-frame bloom crossfade between tiers: k is a pure
    // function of the host-fed deterministic `frame` (engine/presentation.js)
    // — no wall clock, no accumulated state beyond the (frame, from, to)
    // triple set by setQuality(). Replaying the same frame sequence after
    // the same setQuality() call reproduces the intensity curve exactly
    // (harness check BLOOMXFADE). Under a frozen frame (reduced motion /
    // still) the crossfade is frozen too — tier changes are not expected
    // mid-session there (watchdog is host-driven; ?tier= sets the initial
    // values before the first frame).
    const k = Math.min(1, Math.max(0, (frame - state.bloomStartFrame) / BLOOM_FADE_FRAMES));
    const intensity = state.bloomFrom + (state.bloomTo - state.bloomFrom) * k;
    bloom.intensity = intensity;
    state.bloomCurrent = intensity;
    // Grain freeze: reduced motion OR the 'still' tier pins uFrame to 0.
    // `frame` itself is already 0 under reduced motion (presentation.js);
    // the explicit stillMode pin is defense-in-depth and covers tier='still'
    // with a non-reduced-motion host.
    const stillMode = reducedMotion || state.tier === 'still';
    gu('uFrame').value = stillMode ? 0 : frame;
    state.lastFrame = frame;
    composer.render();
  }

  return {
    composer,
    /** Swap the chapter LUT (chapters drive this — no back-channels). */
    setGrade(lut) {
      const next = lut ?? state.neutralLUT;
      gu('uLut').value = next;
      gu('uLutSize').value = next && next.userData ? next.userData.lutSize || 16 : 16;
    },
    /** Swap quality tier: cinematic/balanced bloom on, efficient/still fade to 0. */
    setQuality(nextTier) {
      if (!(nextTier in BLOOM_BY_TIER)) {
        throw new Error(`[post] unknown tier '${nextTier}'`);
      }
      state.bloomFrom = state.bloomCurrent;
      state.bloomTo = bloomTargetFor(nextTier);
      state.bloomStartFrame = state.lastFrame;
      state.tier = nextTier;
    },
    /**
     * Record the D1 bloom bake-off decision (Phase 2): eligible=false kills
     * mip bloom for that tier — setQuality() then forces halo-only (0).
     */
    setBloomEligibility(t, eligible) {
      if (!(t in state.bloomEligibility)) {
        throw new Error(`[post] unknown tier '${t}'`);
      }
      state.bloomEligibility[t] = !!eligible;
      if (!eligible && state.tier === t) {
        state.bloomFrom = state.bloomCurrent;
        state.bloomTo = 0;
        state.bloomStartFrame = state.lastFrame;
      }
    },
    get bloomEligibility() {
      return { ...state.bloomEligibility };
    },
    /** Moon-disc grain mask: center in UV, radius in drawing-buffer px. 0 disables. */
    setMoonMask(centerUv, radiusPx) {
      if (centerUv) gu('uMoonCenter').value.set(centerUv.x, centerUv.y);
      gu('uMoonRadiusPx').value = radiusPx || 0;
    },
    /** Exposure, default 1.0; chapters may keyframe ±0.15 (Phase 4). */
    setExposure(e) {
      gu('uExposure').value = Math.min(1.15, Math.max(0.85, e));
    },
    setSize,
    render,
    /**
     * Read back the bloom's THRESHOLDED bright-pass as luma — the falsifiable
     * probe for bloom isolation (§1.2: non-moon energy < 2% of moon energy).
     * This is the texture that feeds the blur chain: with threshold ≥ 1.0 and
     * the moon as the only >1.0 object, only the moon can appear here —
     * selectivity by construction (see header). (The blurred mip output is
     * intentionally NOT probed: the halo legitimately spreads moonlight.)
     */
    bloomProbe() {
      const lumPass = bloom.luminancePass;
      const mipPass = bloom.mipmapBlurPass;
      const rt = (lumPass && lumPass.renderTarget) || (mipPass && mipPass.renderTarget);
      if (!rt) return null;
      const w = rt.width;
      const h = rt.height;
      if (w < 1 || h < 1) return null;
      const isHalf = rt.texture.type === THREE.HalfFloatType;
      const buf = isHalf ? new Uint16Array(w * h * 4) : new Uint8Array(w * h * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
      const luma = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const r = isHalf ? halfToFloat(buf[i * 4]) : buf[i * 4] / 255;
        const g = isHalf ? halfToFloat(buf[i * 4 + 1]) : buf[i * 4 + 1] / 255;
        const b = isHalf ? halfToFloat(buf[i * 4 + 2]) : buf[i * 4 + 2] / 255;
        luma[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
      return { width: w, height: h, luma };
    },
    get tier() {
      return state.tier;
    },
    get bloomIntensity() {
      return state.bloomCurrent;
    },
    /** Test hooks for the Phase 1 harness. */
    harness: {
      gradeEffect: grade,
      bloomEffect: bloom,
      passOrder: ['RenderPass', 'BloomEffect', 'GradeEffect'],
      setGrainAmplitude(v) {
        gu('uGrain').value = v;
      },
      setVignette(v) {
        gu('uVignette').value = v;
      },
      /**
       * Pin the bloom intensity EXACTLY (bypasses the 30-frame crossfade).
       * Bake-off uses this to compare intensity 0.85 vs 0.0 on the same frame.
       */
      setBloomExact(v) {
        state.bloomFrom = state.bloomTo = v;
        state.bloomCurrent = v;
        bloom.intensity = v;
      },
      /**
       * Linear pre-grade HDR probe (Phase 2, harness-only): disables the
       * grade pass, renders scene+bloom into the composer's HalfFloat
       * buffers, and returns the luma field of the buffer that holds
       * scene+bloom (picked empirically as the higher-total-luma buffer —
       * bloom can only ADD energy). The grade pass is re-enabled before
       * returning, so the next render() is unaffected.
       */
      linearProbe() {
        gradePass.enabled = false;
        composer.render();
        gradePass.enabled = true;
        let best = null;
        for (const rt of [composer.inputBuffer, composer.outputBuffer]) {
          const w = rt.width, h = rt.height;
          if (w < 1 || h < 1) continue;
          const raw = new Uint16Array(w * h * 4);
          renderer.readRenderTargetPixels(rt, 0, 0, w, h, raw);
          const luma = new Float32Array(w * h);
          let total = 0;
          for (let i = 0; i < w * h; i++) {
            const l =
              0.2126 * halfToFloat(raw[i * 4]) +
              0.7152 * halfToFloat(raw[i * 4 + 1]) +
              0.0722 * halfToFloat(raw[i * 4 + 2]);
            luma[i] = l;
            total += l;
          }
          if (!best || total > best.total) best = { width: w, height: h, luma, total };
        }
        return best;
      },
    },
  };
}

/** Back-compat alias for the Phase 0 stub. */
export function createPost(opts) {
  return new Post(opts);
}

export class Post {
  constructor({ rng = new Rng(7) } = {}) {
    void rng;
    this._pipeline = null;
    this._tier = 'cinematic';
  }
  setGrade(lut) {
    if (this._pipeline) this._pipeline.setGrade(lut);
    return this;
  }
  setQuality(tier) {
    if (this._pipeline) this._pipeline.setQuality(tier);
    this._tier = tier;
    return this;
  }
  get quality() {
    return this._tier;
  }
}
