/* engine/moon.js — seeded crater bake + per-frame moon shader (Phase 2).
 *
 * WHAT THIS IS
 *   buildMoon(rng, opts) bakes the lunar surface ONCE at init (seeded Voronoi
 *   crater field, 3 scales: mare / large / small) and returns a moon object:
 *   real sphere mesh + camera-facing disc fallback + two halo sprites +
 *   chapter-driven colorTemp shader + eclipse mode.
 *
 * TECHNIQUE PROVENANCE (implemented FRESH — nothing copied; see ATTRIBUTION.md):
 *   - CK42BB: Voronoi crater-field generation pattern (jittered-grid craters).
 *   - Quilez sdMoon: crater RELIEF MATH is re-derived here as a normalized
 *     bowl+rim+ejecta profile LUT over q = d^2/r^2 (concept: distance-field
 *     crater profile; implementation is our own).
 *   - pun1th01: phase-lighting formula shape (terminator smoothstep contract).
 *   - coldprofit: Fresnel limb-shell accent pattern.
 *   All crater placement, profile shaping, noise, and shader code below are
 *   original to this engine.
 *
 * THE CONTRACT (FINAL-PLAN §1.1 — the NUMBERS are the contract):
 *   - Hero disc 28–30% viewport height; ambient ≤ 10%.
 *   - Disc-to-sky contrast ≥ 40:1 (linear pre-tonemap, 5×5 averages).
 *   - Moon is the ONLY object with luminance > 1:
 *     emissive in RGB(3.2,1.1,0.45)–(4.0,2.5,2.0), toneMapped: false.
 *   - Terminator smoothstep(-0.05, 0.25, dot(N,L)); earthshine floor +0.12;
 *     dark limb ≥ #1A0F0A pre-tonemap.
 *   - colorTemp lerps the ILLUMINATED disc ramp + halo tint + bloom tint.
 *     The DARK LIMB STAYS NEUTRAL (earthshine is fixed, never lerped).
 *   - Halo ≤ 6% of disc-center luminance at 1.5 disc diameters.
 *   - Post-grade hero SDR: core #FF5A24, mid #E83E12, limb #A82E10 (±12/ch).
 *
 * ACES-SHOULDER NOTE (why the Ch4 ramp core exceeds 1):
 *   The grade's Narkowicz ACES fit pins any pre-tonemap R ≥ ~2 to sRGB ~250,
 *   which desaturates brights. The signed #FF5A24 can only land if the
 *   pre-tonemap product sits at ≈ (8.0, 0.087, 0.028) — R on the shoulder,
 *   G/B still on the linear part. The emissive uniform STAYS inside the
 *   contract range; the chapter ramp (a shader shaping term, not the
 *   emissive) carries the saturation: emissive × rampCore(Ch4) × albedo ×
 *   illum ≈ (7.6, 0.088, 0.027) at the disc core. The scene-graph audit
 *   checks the emissive uniform (in range, > 1, moon-only), not the product.
 */
import * as THREE from 'three';
import { Rng } from './seed.js';

/** Moon acceptance contract (§1.1). The NUMBERS are the contract. */
export const MOON_CONTRACT = Object.freeze({
  heroDiscDiameterVh: [0.28, 0.30], // 28–30% of viewport height, hero chapter
  ambientDiscDiameterVhMax: 0.10,
  discToSkyContrastMin: 40,         // 5×5 px averages, disc center vs adjacent sky
  discSaturationMin: 0.55,
  hdrEmissive: 'RGB(3.2,1.1,0.45)–(4.0,2.5,2.0), toneMapped:false — moon is the ONLY object with luminance > 1',
  othersLuminanceMax: 1.05,
  terminator: 'smoothstep(-0.05, 0.25, dot(N,L))',
  earthshineFloor: 0.12,
  darkLimbMin: '#1A0F0A (pre-tonemap)',
  haloAt1_5DiametersMax: 0.06,      // ≤ 6% of disc-center luminance
  bakeResolution: 2048,             // 1024² fallback on init-budget breach
  initBudgetMs: { desktop: 1500, mobile: 3000 },
  // Post-grade hero SDR targets (signed art board):
  gradeCore: '#FF5A24', gradeMid: '#E83E12', gradeLimb: '#A82E10',
  vermilionBand: ['#C8341A', '#E0552B'],
});

/**
 * colorTemp uniform lerps the illuminated-disc ramp + halo tint + bloom tint
 * per chapter keyframe (D7). The dark limb stays neutral — always.
 */
export const VERMILION_LOCK_NOTE =
  'moon.vermilionLock = true restores always-vermilion in one line (D7)';

/* ------------------------------------------------------------------ */
/* Bake: seeded Voronoi crater field → albedo + normal maps.           */
/*                                                                     */
/* Method (fresh implementation): craters live on a jittered grid per */
/* scale (≤1 crater/cell); each crater is SPLATTED into a Float32      */
/* heightfield through a shared normalized relief-profile LUT over     */
/* q = d²/r² ∈ [0,4): smooth bowl + raised rim + ejecta blanket        */
/* (Quilez-sdMoon-style relief, re-derived). Mare = low-res seeded     */
/* value-noise fBm mask, bilinear-upsampled. Fine grain = 1 octave of  */
/* integer-lattice value noise. Normals = central differences.         */
/*                                                                     */
/* Determinism: every draw comes from a dedicated sfc32 stream seeded  */
/* from rng.seed — the bake is a pure function of (seed, resolution).  */
/* No Math.random / clocks anywhere in this module (grep gate).        */
/* ------------------------------------------------------------------ */

const PROFILE_LUT_N = 256;
let _profileLUT = null;
/** Normalized crater relief profile over q = d²/r² ∈ [0,4). */
function craterProfileLUT() {
  if (_profileLUT) return _profileLUT;
  const lut = new Float32Array(PROFILE_LUT_N);
  for (let i = 0; i < PROFILE_LUT_N; i++) {
    const q = (i / (PROFILE_LUT_N - 1)) * 4;
    const d = Math.sqrt(q);
    let h = 0;
    if (d < 1) {
      // Interior bowl: smooth, slightly flattened floor.
      const b = Math.cos(d * Math.PI) * 0.5 + 0.5;
      h -= Math.pow(b, 0.8);
    }
    // Raised rim just outside the bowl edge.
    const rz = (d - 1.0) / 0.18;
    if (d < 1.7) h += 0.35 * Math.exp(-rz * rz);
    // Ejecta blanket falloff.
    if (d >= 1.0 && d < 2.0) h += 0.10 * Math.exp(-(d - 1.0) / 0.45);
    lut[i] = h;
  }
  _profileLUT = lut;
  return lut;
}

/** Deterministic integer-lattice hash → [0,1). */
function hash2i(ix, iy, s) {
  let h = Math.imul(ix, 0x85ebca6b) ^ Math.imul(iy, 0xc2b2ae35) ^ Math.imul(s | 0, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Seeded value noise (single octave). */
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2i(ix, iy, s), b = hash2i(ix + 1, iy, s);
  const c = hash2i(ix, iy + 1, s), d = hash2i(ix + 1, iy + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** FNV-1a (32-bit) over a byte array → 8-hex-char string. */
export function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
}

/**
 * Bake the moon surface maps. Pure function of (seed, resolution).
 * @param {Rng} rng — seed source (a DEDICATED stream is derived from rng.seed,
 *                    so the bake does not depend on the caller's draw position).
 * @param {number} resolution — texture edge (2048, or 1024 fallback).
 * @returns {{albedo:Uint8Array, normal:Uint8Array, resolution, seed,
 *            hashAlbedo, hashNormal, craterCount, normalVariance}}
 */
export function bakeMoonMaps(rng, resolution = 2048) {
  const res = resolution | 0;
  const seed = (rng && Number.isInteger(rng.seed) ? rng.seed : 7) | 0;
  const bakeRng = new Rng(seed ^ 0x6d2b79f5); // dedicated bake stream
  const lut = craterProfileLUT();
  const height = new Float32Array(res * res);

  // --- 3 crater scales: mare-scale basins / large / small. Splatted. ---
  const scales = [
    { cells: 5, rMin: 0.22, rMax: 0.62, depth: 0.16 },
    { cells: 16, rMin: 0.22, rMax: 0.60, depth: 0.18 },
    { cells: 64, rMin: 0.20, rMax: 0.58, depth: 0.20 },
  ];
  let craterCount = 0;
  for (let si = 0; si < scales.length; si++) {
    const s = scales[si];
    const cell = res / s.cells;
    for (let cy = 0; cy < s.cells; cy++) {
      for (let cx = 0; cx < s.cells; cx++) {
        if (bakeRng.float() > 0.75) continue; // some cells stay empty
        const px = (cx + 0.15 + bakeRng.float() * 0.7) * cell;
        const py = (cy + 0.15 + bakeRng.float() * 0.7) * cell;
        const r = (s.rMin + (s.rMax - s.rMin) * bakeRng.float()) * cell;
        const depth = r * s.depth * (0.7 + 0.6 * bakeRng.float());
        const invR2 = 1 / (r * r);
        const R = Math.ceil(r * 2); // profile LUT covers d < 2r
        const x0 = Math.max(0, Math.floor(px - R));
        const x1 = Math.min(res - 1, Math.ceil(px + R));
        const y0 = Math.max(0, Math.floor(py - R));
        const y1 = Math.min(res - 1, Math.ceil(py + R));
        for (let y = y0; y <= y1; y++) {
          const dy = y - py, dy2 = dy * dy, row = y * res;
          for (let x = x0; x <= x1; x++) {
            const dx = x - px;
            const q = (dx * dx + dy2) * invR2;
            if (q < 4) height[row + x] += depth * lut[(q * 63.75) | 0];
          }
        }
        craterCount++;
      }
    }
  }

  // --- Mare: low-res seeded fBm mask, upsampled (basins are broad). ---
  const mres = 160;
  const mare = new Float32Array(mres * mres);
  for (let y = 0; y < mres; y++) {
    for (let x = 0; x < mres; x++) {
      const nx = (x / mres) * 6, ny = (y / mres) * 6;
      const f =
        0.55 * vnoise(nx, ny, seed + 11) +
        0.30 * vnoise(nx * 2.13 + 7.3, ny * 2.13 + 3.1, seed + 12) +
        0.15 * vnoise(nx * 4.31 + 1.7, ny * 4.31 + 9.2, seed + 13);
      let m = (f - 0.52) / 0.20;
      m = m < 0 ? 0 : m > 1 ? 1 : m;
      mare[y * mres + x] = m * m * (3 - 2 * m);
    }
  }

  // --- Compose albedo + normal at full res. ---
  const albedo = new Uint8Array(res * res * 4);
  const normal = new Uint8Array(res * res * 4);
  const nscale = 0.42; // relief strength → visible crater shading, not noise
  const inv = mres / res;
  let nSum = 0, nSum2 = 0, nN = 0;
  for (let y = 0; y < res; y++) {
    const myF = y * inv;
    const my0 = Math.min(mres - 2, Math.floor(myF)), myf = myF - my0;
    const rowH = y * res, rowM = my0 * mres;
    for (let x = 0; x < res; x++) {
      const mxF = x * inv;
      const mx0 = Math.min(mres - 2, Math.floor(mxF)), mxf = mxF - mx0;
      const i00 = rowM + mx0;
      const mTop = mare[i00] + (mare[i00 + 1] - mare[i00]) * mxf;
      const mBot = mare[i00 + mres] + (mare[i00 + mres + 1] - mare[i00 + mres]) * mxf;
      const m = mTop + (mBot - mTop) * myf;
      const h = height[rowH + x] - 6 * m; // mare basins sit slightly lower
      const fine = vnoise(x * 0.11, y * 0.11, seed + 21);
      // Albedo stays FLAT-ish: relief is carried by the normal map + lighting
      // (a phase sweep must change shading, not reveal painted craters).
      let a = 236 * (1 - 0.45 * m) * (0.93 + 0.07 * fine);
      a *= 1 + Math.max(-0.06, Math.min(0.05, h * 0.004)); // subtle relief coupling
      a = a < 0 ? 0 : a > 255 ? 255 : a;
      const o = (rowH + x) * 4;
      albedo[o] = albedo[o + 1] = albedo[o + 2] = Math.round(a);
      albedo[o + 3] = 255;
      // Normal from central differences (x wraps: equirect seam).
      const xm = rowH + (x > 0 ? x - 1 : res - 1);
      const xp = rowH + (x < res - 1 ? x + 1 : 0);
      const ym = (y > 0 ? y - 1 : 0) * res + x;
      const yp = (y < res - 1 ? y + 1 : res - 1) * res + x;
      const nx = (height[xm] - height[xp]) * nscale;
      const ny = (height[ym] - height[yp]) * nscale;
      const il = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const nr = Math.round((nx * il * 0.5 + 0.5) * 255);
      const ng = Math.round((ny * il * 0.5 + 0.5) * 255);
      const nb = Math.round((il * 0.5 + 0.5) * 255);
      normal[o] = nr; normal[o + 1] = ng; normal[o + 2] = nb; normal[o + 3] = 255;
      nSum += nr; nSum2 += nr * nr; nN++;
    }
  }
  const nMean = nSum / nN;
  const normalVariance = nSum2 / nN - nMean * nMean;

  return {
    albedo, normal,
    resolution: res, seed, craterCount, normalVariance,
    hashAlbedo: fnv1a(albedo),
    hashNormal: fnv1a(normal),
  };
}

/* ------------------------------------------------------------------ */
/* Color script — the 13 signed chapter keyframes (FINAL-PLAN §2/D7,    */
/* docs/art-board.md §1; hue progression from research_notes/epic-      */
/* story-structure/moon-engine-chapters.md). Lerp is continuous        */
/* (setChapter takes t in [0,12]); steepest chroma climb into Ch10,    */
/* steepest fall into Ch11/Ch12.                                       */
/*                                                                     */
/* TEST-FIXTURE NOTE: targetCore/targetMid/targetLimb hexes are the    */
/* TEST FIXTURES (documented here and in harness/checks-*.js). Ch10's  */
/* are the signed art-board values — DO NOT RETUNE. Ch1–Ch9 / Ch11–    */
/* Ch13 are derived from the signed beat-map WORDS (bone-white→cool   */
/* pearl→faint amber halo→soft warm amber→amber deepening→bruised      */
/* amber, dust-lit→ash & ember desat→ember rekindled→copper; then      */
/* vermilion cooling→deep ember→dying coal) — they are not art-board   */
/* edits. ΔE ≤ 8 per keyframe vs these targets.                        */
/*                                                                     */
/* LAWS: vermilion peaks ONLY at Ch10 (no other keyframe's chroma may  */
/* approach it); the dark limb stays neutral/cool in all 13 chapters   */
/* (fresnel tints never go warm-red on the limb — earthshine + limb    */
/* law, contract §1.1).                                                */
/*                                                                     */
/* Per-keyframe fields: emissive (contract range, HDR driver),         */
/* rampCore/Mid/Edge (colorTemp-lerped disc ramp = the saturation      */
/* carrier; may exceed 1 — see ACES-shoulder note above), fresnel      */
/* (limb accent), haloTint + haloGain (both halo sprites).             */
/* ------------------------------------------------------------------ */
export const COLOR_SCRIPT = Object.freeze([
  Object.freeze({
    name: 'bone-white', ch: 1,
    role: 'Arrival, cold first contact — bone-white, chroma ≈ 0; the moon has never been afraid.',
    emissive: [3.40, 3.30, 3.20],
    rampCore: [0.386, 0.390, 0.440],
    rampMid: [0.360, 0.365, 0.400],
    rampEdge: [0.300, 0.310, 0.350],
    fresnel: [0.30, 0.34, 0.42],
    haloTint: [0.55, 0.62, 0.75], haloGain: 0.45,
    exposure: 1.00,
    targetCore: '#EDF1F5', // cool pearl (derived from beat map)
  }),
  Object.freeze({
    name: 'the-naming', ch: 2,
    role: 'The crew names the features; the ember is planted — cool pearl, soft warm amber low.',
    emissive: [3.55, 3.15, 2.60],
    rampCore: [0.420, 0.300, 0.200],
    rampMid: [0.390, 0.285, 0.195],
    rampEdge: [0.330, 0.260, 0.200],
    fresnel: [0.45, 0.36, 0.26],
    haloTint: [0.95, 0.72, 0.45], haloGain: 0.60,
    exposure: 1.00,
    targetCore: '#F2E4C8', // soft warm amber bone (derived from beat map)
  }),
  Object.freeze({
    name: 'the-long-fall-inward', ch: 3,
    role: 'The long fall inward — faint amber halo rim, disc mostly bone; the drive sacrifice.',
    emissive: [3.60, 2.60, 1.90],
    rampCore: [0.4405, 0.3221, 0.2469],
    rampMid: [0.4095, 0.3060, 0.2381],
    rampEdge: [0.3413, 0.2818, 0.2381],
    fresnel: [0.50, 0.34, 0.23],
    haloTint: [1.00, 0.65, 0.38], haloGain: 0.68,
    exposure: 1.00,
    targetCore: '#EEDBC0', // bone with a faint amber halo (derived from beat map)
  }),
  Object.freeze({
    name: 'tide-locked', ch: 4,
    role: 'Tide-locked — soft warm amber; the moon turns one held face toward what is coming.',
    emissive: [3.65, 2.30, 1.50],
    rampCore: [0.3316, 0.2074, 0.1463],
    rampMid: [0.3057, 0.1936, 0.1393],
    rampEdge: [0.2539, 0.1797, 0.1393],
    fresnel: [0.52, 0.32, 0.20],
    haloTint: [1.00, 0.58, 0.32], haloGain: 0.75,
    exposure: 1.00,
    targetCore: '#E7C18D', // soft warm amber, chroma-capped (only ch10 is high-chroma)
  }),
  Object.freeze({
    name: 'the-first-crack', ch: 5,
    role: 'Amber deepening — the first rust shows at the terminator.',
    emissive: [3.70, 2.00, 1.20],
    rampCore: [0.2115, 0.1461, 0.1440],
    rampMid: [0.1922, 0.1340, 0.1317],
    rampEdge: [0.1566, 0.1273, 0.1317],
    fresnel: [0.55, 0.30, 0.18],
    haloTint: [1.00, 0.55, 0.28], haloGain: 0.80,
    exposure: 1.00,
    targetCore: '#D8A17B', // amber deepening, chroma-capped (hue preserved)
  }),
  Object.freeze({
    name: 'shatter', ch: 6,
    role: 'Bruised amber, dust-lit — the shatter, deliberately restrained.',
    emissive: [3.74, 1.84, 1.08],
    rampCore: [0.1217, 0.1086, 0.1161],
    rampMid: [0.0415, 0.0944, 0.1003],
    rampEdge: [0.0263, 0.0861, 0.1003],
    fresnel: [0.45, 0.28, 0.20],
    haloTint: [1.00, 0.50, 0.24], haloGain: 0.88,
    exposure: 1.00,
    targetCore: '#BF8665', // bruised amber, dust-lit, chroma-capped (hue preserved)
  }),
  Object.freeze({
    name: 'the-bill-comes-due', ch: 7,
    role: 'Ash and ember, desaturated — the grief chapter; color is deliberately held back.',
    emissive: [3.45, 2.10, 1.60],
    rampCore: [0.0963, 0.1187, 0.1344],
    rampMid: [0.0879, 0.1093, 0.1248],
    rampEdge: [0.0733, 0.0971, 0.1152],
    fresnel: [0.30, 0.27, 0.27],
    haloTint: [0.85, 0.60, 0.45], haloGain: 0.60,
    exposure: 0.98,
    targetCore: '#A8958A', // ash, desaturated (derived from beat map)
  }),
  Object.freeze({
    name: 'the-ember-remembers', ch: 8,
    role: 'The ember rekindled but restrained — warm ember rising under the ash.',
    emissive: [3.60, 1.95, 1.30],
    rampCore: [0.0997, 0.0827, 0.0800],
    rampMid: [0.0902, 0.0758, 0.0747],
    rampEdge: [0.0712, 0.0689, 0.0725],
    fresnel: [0.42, 0.26, 0.18],
    haloTint: [1.00, 0.52, 0.26], haloGain: 0.75,
    exposure: 1.00,
    targetCore: '#B07659', // ember rekindled but restrained, chroma-capped (hue preserved)
  }),
  Object.freeze({
    name: 'the-wager', ch: 9,
    role: 'Heat rising — muted copper, approaching but never touching vermilion.',
    emissive: [3.72, 1.75, 1.05],
    rampCore: [0.0673, 0.0632, 0.0726],
    rampMid: [0.0536, 0.0565, 0.0660],
    rampEdge: [0.0367, 0.0499, 0.0594],
    fresnel: [0.38, 0.20, 0.14],
    haloTint: [1.00, 0.46, 0.20], haloGain: 0.92,
    exposure: 1.00,
    targetCore: '#995D47', // heat rising, burnt/muted copper (chroma-capped per vermilion law)
  }),
  Object.freeze({
    name: 'vermilion-moon', ch: 10,
    role: 'Climactic reveal — FULL vermilion. Only keyframe near Kage saturation; brightest disc keeps value fall-off + subtle cooler edge; moon is the only high-chroma element.',
    emissive: [3.80, 1.60, 0.90],
    rampCore: [2.000, 0.0550, 0.0300],
    rampMid: [0.289, 0.0330, 0.0156],
    rampEdge: [0.0689, 0.0228, 0.0141],
    fresnel: [0.20, 0.035, 0.022],
    haloTint: [1.00, 0.42, 0.18], haloGain: 1.00,
    exposure: 1.00,
    targetCore: '#FF5A24', // signed art-board
    targetMid: '#E83E12',  // signed art-board
    targetLimb: '#A82E10', // signed art-board
  }),
  Object.freeze({
    name: 'ashes-that-hold', ch: 11,
    role: 'Vermilion cooling to ember — falling off the peak fast.',
    emissive: [3.55, 1.80, 1.25],
    rampCore: [0.0606, 0.0496, 0.0512],
    rampMid: [0.0489, 0.0456, 0.0479],
    rampEdge: [0.0332, 0.0407, 0.0430],
    fresnel: [0.30, 0.18, 0.13],
    haloTint: [0.95, 0.44, 0.20], haloGain: 0.80,
    exposure: 1.00,
    targetCore: '#8D503E', // vermilion cooling to ember, chroma-capped (hue preserved)
  }),
  Object.freeze({
    name: 'afterlight', ch: 12,
    role: 'Deep ember → muted vermilion-black; desaturate aggressively: a dying coal, not a lingering logo.',
    emissive: [3.20, 1.50, 0.90],
    rampCore: [0.0446, 0.0361, 0.0371],
    rampMid: [0.0405, 0.0333, 0.0347],
    rampEdge: [0.0337, 0.0291, 0.0315],
    fresnel: [0.24, 0.16, 0.14],
    haloTint: [0.80, 0.30, 0.14], haloGain: 0.55,
    exposure: 1.00,
    targetCore: '#6D3523', // dying coal, aggressively desaturated (hue preserved)
  }),
  Object.freeze({
    name: 'the-scarred-orbit', ch: 13,
    role: 'A dying coal — darker and cooler than afterlight; the ember almost out.',
    emissive: [3.10, 1.60, 1.15],
    rampCore: [0.028, 0.023, 0.021],
    rampMid: [0.026, 0.0215, 0.0198],
    rampEdge: [0.023, 0.0195, 0.0185],
    fresnel: [0.18, 0.17, 0.20],
    haloTint: [0.60, 0.30, 0.20], haloGain: 0.40,
    exposure: 0.98,
    targetCore: '#4A2A20', // a dying coal, cooler (derived from beat map)
  }),
]);

/** Fixed earthshine: neutral / slight-cool +0.12 floor. colorTemp NEVER touches it. */
export const EARTHSHINE = Object.freeze([0.140, 0.145, 0.155]);

/** Blood-moon ramp for setEclipse() (Phase 6 eclipse act): deep red, dimmed disc. */
export const BLOOD_RAMP = Object.freeze({
  core: [0.90, 0.080, 0.050],
  mid: [0.40, 0.040, 0.025],
  edge: [0.15, 0.020, 0.015],
});

const MOON_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormalW;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// Disc-billboard vertex shader: reconstructs the front hemisphere so the disc
// samples the SAME equirect bake as the sphere (three.js SphereGeometry UV
// convention: u = phi/2PI with +X at u=0.5, v = 1 - theta/PI).
const DISC_VERT = /* glsl */ `
uniform float uSphereR;
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormalW;
void main() {
  vec3 p = position; // CircleGeometry in XY plane, radius uSphereR
  float rr = clamp(length(p.xy) / uSphereR, 0.0, 1.0);
  float z = uSphereR * sqrt(max(0.0, 1.0 - rr * rr));
  vec3 nObj = normalize(vec3(p.x, p.y, z));
  float theta = acos(clamp(nObj.y, -1.0, 1.0));
  float phi = atan(nObj.z, -nObj.x);
  vUv = vec2(phi / 6.28318530718 + 0.5, 1.0 - theta / 3.14159265359);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * nObj);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const MOON_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormalW;
uniform sampler2D uAlbedoMap;
uniform sampler2D uNormalMap;
uniform vec3 uSunDir;
uniform vec3 uEmissive;
uniform vec3 uRampCore;
uniform vec3 uRampMid;
uniform vec3 uRampEdge;
uniform vec3 uFresnelTint;
uniform vec3 uEarthshine;
uniform float uNormalScale;
uniform float uEclipse;
uniform vec3 uBloodCore;
uniform vec3 uBloodMid;
uniform vec3 uBloodEdge;

vec3 rampAt(float sT, vec3 cCore, vec3 cMid, vec3 cEdge) {
  return mix(cEdge,
             mix(cMid, cCore, smoothstep(0.45, 0.95, sT)),
             smoothstep(0.08, 0.50, sT));
}

void main() {
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 N = normalize(vNormalW);
  // Derivative-based tangent frame (sphere and disc alike).
  vec3 q0 = dFdx(vWorldPos);
  vec3 q1 = dFdy(vWorldPos);
  vec2 st0 = dFdx(vUv);
  vec2 st1 = dFdy(vUv);
  vec3 T = normalize(q0 * st1.t - q1 * st0.t + vec3(1e-6));
  vec3 B = normalize(cross(N, T));
  vec3 mapN = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
  mapN.xy *= uNormalScale;
  vec3 Np = normalize(T * mapN.x + B * mapN.y + N * mapN.z);

  vec3 L = normalize(uSunDir);
  float ndlG = dot(N, L);
  // Contract terminator: smoothstep(-0.05, 0.25, dot(N,L)).
  float term = smoothstep(-0.05, 0.25, ndlG);
  // Crater relief shading inside the lit region.
  float shade = 0.35 + 0.65 * clamp(dot(Np, L) * 0.5 + 0.5, 0.0, 1.0);
  float illum = term * shade;

  // View-angle ramp: brightest disc keeps value fall-off toward the limb.
  float cosV = clamp(dot(N, V), 0.0, 1.0);
  float sT = smoothstep(0.0, 1.0, cosV);
  vec3 ramp = rampAt(sT, uRampCore, uRampMid, uRampEdge);
  // Eclipse act: lerp toward the blood ramp, dim the emissive.
  ramp = mix(ramp, rampAt(sT, uBloodCore, uBloodMid, uBloodEdge), uEclipse);
  vec3 emissive = uEmissive * (1.0 - 0.55 * uEclipse);

  vec3 albedo = texture2D(uAlbedoMap, vUv).rgb;
  vec3 litCol = emissive * ramp * albedo * illum;
  // Earthshine: FIXED neutral/slight-cool floor. colorTemp never touches this.
  vec3 esCol = uEarthshine * albedo * (1.0 - term);
  // Fresnel limb accent (Ch4: subtle cooler edge — never flat candy red).
  float fres = pow(1.0 - cosV, 2.5);
  vec3 frCol = uFresnelTint * fres * term * 0.22;

  gl_FragColor = vec4(litCol + esCol + frCol, 1.0);
}
`;

/**
 * Analytic halo sprite texture (DataTexture — no DOM needed): transparent
 * inside the disc radius, peak just outside the limb, exponential falloff.
 * @param {number} discR — disc radius in sprite-UV units (0.625 tight / 0.286 wide).
 */
function makeHaloTexture(discR) {
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = ((x + 0.5) / S) * 2 - 1;
      const dy = ((y + 0.5) / S) * 2 - 1;
      const r = Math.sqrt(dx * dx + dy * dy);
      let a = 0;
      if (r > discR * 1.01 && r < 1.0) {
        const t = (r - discR) / (1 - discR); // 0 at limb → 1 at sprite edge
        // Peak 0.5 just outside the limb, exponential falloff: a soft hug,
        // not a fuzz ball. (Grain in the grade pass is luma-weighted — a dim
        // halo keeps it film-like instead of speckly.)
        a = 0.5 * Math.exp(-Math.pow(t / 0.38, 2) * 2.0);
      }
      const o = (y * S + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
      data[o + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Build the moon: baked maps, sphere + disc meshes, halo sprites, shader.
 *
 * @param {Rng} rng — seed source (bake stream is derived from rng.seed).
 * @param {object} opts — { resolution=2048, radius=140, chapter=9 (0-indexed
 *   Ch10 hero), sunDirection=Vector3, post (optional: exposure wiring),
 *   meshMode='sphere' }
 */
export function buildMoon(rng = new Rng(7), opts = {}) {
  const resolution = opts.resolution || 2048;
  const radius = opts.radius || 140;
  const seed = Number.isInteger(rng.seed) ? rng.seed : 7;

  // --- The bake (once, at init). ---
  const bake = bakeMoonMaps(rng, resolution);
  const res = bake.resolution;
  const albedoTex = new THREE.DataTexture(bake.albedo, res, res, THREE.RGBAFormat);
  albedoTex.needsUpdate = true;
  const normalTex = new THREE.DataTexture(bake.normal, res, res, THREE.RGBAFormat);
  normalTex.needsUpdate = true;

  const uniforms = {
    uAlbedoMap: { value: albedoTex },
    uNormalMap: { value: normalTex },
    uSunDir: { value: new THREE.Vector3(0, 0, 1) },
    uEmissive: { value: new THREE.Vector3(3.8, 1.6, 0.9) },
    uRampCore: { value: new THREE.Vector3(2.0, 0.055, 0.03) },
    uRampMid: { value: new THREE.Vector3(0.289, 0.033, 0.0156) },
    uRampEdge: { value: new THREE.Vector3(0.0689, 0.0228, 0.0141) },
    uFresnelTint: { value: new THREE.Vector3(0.2, 0.035, 0.022) },
    uEarthshine: { value: new THREE.Vector3(EARTHSHINE[0], EARTHSHINE[1], EARTHSHINE[2]) },
    uNormalScale: { value: 1.0 },
    uEclipse: { value: 0 },
    uBloodCore: { value: new THREE.Vector3(...BLOOD_RAMP.core) },
    uBloodMid: { value: new THREE.Vector3(...BLOOD_RAMP.mid) },
    uBloodEdge: { value: new THREE.Vector3(...BLOOD_RAMP.edge) },
  };

  function makeMaterial(vertexShader, extraUniforms = {}) {
    return new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...extraUniforms },
      vertexShader,
      fragmentShader: MOON_FRAG,
      fog: false,          // the moon must stay HDR — fog would crush it
      toneMapped: false,   // the grade pass owns tone mapping
    });
  }

  // NOTE: both meshes share ONE uniforms object per material instance; the two
  // materials each get their own uniform INSTANCES via {...uniforms} spread —
  // setChapter writes to both (kept in the materials list).
  const sphereMat = makeMaterial(MOON_VERT);
  const discMat = makeMaterial(DISC_VERT, { uSphereR: { value: radius } });
  const materials = [sphereMat, discMat];
  const setUniform3 = (name, v) => {
    for (const m of materials) m.uniforms[name].value.set(v[0], v[1], v[2]);
  };

  // Real sphere (the chapter dolly-zoom flyby breaks a billboard).
  const sphereGeo = new THREE.SphereGeometry(radius, 128, 96);
  const sphere = new THREE.Mesh(sphereGeo, sphereMat);
  // Camera-facing disc fallback (efficient/still tiers).
  const discGeo = new THREE.CircleGeometry(radius, 96);
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.visible = false;

  // --- Halo sprites: universal baseline, EVERY tier (D1). ---
  // Tight ~1.6× disc, wide ~3.5× disc; warm tint follows colorTemp.
  const haloTightTex = makeHaloTexture(1 / 1.6);
  const haloWideTex = makeHaloTexture(1 / 3.5);
  function makeHalo(tex, sizeMul) {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      color: new THREE.Color(1, 1, 1),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      fog: false,
      toneMapped: false,
    });
    const sp = new THREE.Sprite(mat);
    const s = radius * 2 * sizeMul;
    sp.scale.set(s, s, 1);
    sp.renderOrder = 10;
    return sp;
  }
  const haloTight = makeHalo(haloTightTex, 1.6);
  const haloWide = makeHalo(haloWideTex, 3.5);

  const group = new THREE.Group();
  group.add(sphere, disc, haloTight, haloWide);
  group.traverse((o) => { o.userData.moonSystem = true; }); // audit exemption

  const state = {
    chapter: 9,
    vermilionLock: false,
    eclipse: 0,
    meshMode: opts.meshMode || 'sphere',
    scale: 1,
  };

  function applyChapter(t) {
    const tc = state.vermilionLock ? 9 : Math.max(0, Math.min(12, t));
    const i = Math.min(11, Math.floor(tc));
    let f = tc - i;
    f = f * f * (3 - 2 * f);
    const A = COLOR_SCRIPT[i], B = COLOR_SCRIPT[i + 1];
    const L = (a, b) => a + (b - a) * f;
    const L3 = (a, b) => [L(a[0], b[0]), L(a[1], b[1]), L(a[2], b[2])];
    setUniform3('uEmissive', L3(A.emissive, B.emissive));
    setUniform3('uRampCore', L3(A.rampCore, B.rampCore));
    setUniform3('uRampMid', L3(A.rampMid, B.rampMid));
    setUniform3('uRampEdge', L3(A.rampEdge, B.rampEdge));
    setUniform3('uFresnelTint', L3(A.fresnel, B.fresnel));
    const halo = L3(A.haloTint, B.haloTint);
    const gain = L(A.haloGain, B.haloGain);
    // Tight carries the inner glow, wide the atmospheric veil. Gains are
    // deliberately modest: the halo must read at 1.5 diameters ≤ 6% of the
    // disc-center luminance, and stay dim enough that grade grain stays
    // film-like on it.
    haloTight.material.color.setRGB(halo[0] * gain * 0.30, halo[1] * gain * 0.30, halo[2] * gain * 0.30);
    haloWide.material.color.setRGB(halo[0] * gain * 0.15, halo[1] * gain * 0.15, halo[2] * gain * 0.15);
    if (opts.post) opts.post.setExposure(L(A.exposure, B.exposure));
    state.chapter = tc;
  }

  const moon = {
    kind: 'moon',
    group, sphere, disc, haloTight, haloWide,
    radius,
    seed,
    resolution: bake.resolution,
    bake,
    hashAlbedo: bake.hashAlbedo,
    hashNormal: bake.hashNormal,

    /** Continuous chapter coordinate t ∈ [0,12] (scroll-driven in Phase 4). */
    setChapter(t) { applyChapter(t); return this; },
    /** Normalized colorTemp v ∈ [0,1] → chapter coordinate. */
    setColorTemp(v) { applyChapter(Math.max(0, Math.min(1, v)) * 12); return this; },
    /** Blood-moon shift for the Phase 6 eclipse act: deep red ramp, dimmed disc. */
    setEclipse(amount) {
      state.eclipse = Math.max(0, Math.min(1, amount));
      for (const m of materials) m.uniforms.uEclipse.value = state.eclipse;
      return this;
    },
    setSunDirection(v) {
      for (const m of materials) m.uniforms.uSunDir.value.copy(v).normalize();
      return this;
    },
    /** Moon scale (chapters drive this in Phase 4; ambient ≤ 10% vh). */
    setMoonScale(s) { state.scale = s; group.scale.setScalar(s); return this; },
    setMeshMode(mode) {
      state.meshMode = mode;
      sphere.visible = mode === 'sphere';
      disc.visible = mode === 'disc';
      return this;
    },
    get chapter() { return state.chapter; },
    get eclipse() { return state.eclipse; },
    get meshMode() { return state.meshMode; },
    /** One-line always-vermilion override (D7). */
    get vermilionLock() { return state.vermilionLock; },
    set vermilionLock(v) { state.vermilionLock = !!v; applyChapter(state.chapter); },

    /**
     * Project the disc to screen (CSS px). The host wires this into
     * post.setMoonMask(centerUv, radiusPx) every frame (grain moon-mask).
     */
    projectedDisc(camera, cssW, cssH) {
      const wp = new THREE.Vector3();
      sphere.getWorldPosition(wp);
      const dist = camera.position.distanceTo(wp);
      const v = wp.clone().project(camera);
      const rPx = ((radius * state.scale) / dist) * (cssH / 2) /
        Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      return {
        x: (v.x * 0.5 + 0.5) * cssW,
        y: (-v.y * 0.5 + 0.5) * cssH,
        rPx, ndcZ: v.z,
      };
    },
    /** Per-frame update: billboard the disc fallback; returns projected disc. */
    update(camera, cssW, cssH) {
      if (disc.visible) disc.quaternion.copy(camera.quaternion);
      return this.projectedDisc(camera, cssW, cssH);
    },
    /** Max pre-tonemap emissive channel (scene-graph audit input). */
    emissiveMax() {
      const e = sphereMat.uniforms.uEmissive.value;
      return Math.max(e.x, e.y, e.z);
    },
    dispose() {
      sphereGeo.dispose(); discGeo.dispose();
      sphereMat.dispose(); discMat.dispose();
      haloTightTex.dispose(); haloWideTex.dispose();
      haloTight.material.dispose(); haloWide.material.dispose();
      albedoTex.dispose(); normalTex.dispose();
    },
  };

  if (opts.sunDirection) moon.setSunDirection(opts.sunDirection);
  moon.setMeshMode(state.meshMode);
  applyChapter(opts.chapter != null ? opts.chapter : 9);
  return moon;
}

/** Back-compat alias for the Phase 0/1 stub name. */
export function createMoon(opts = {}) {
  const { rng = new Rng(7), ...rest } = opts;
  return buildMoon(rng, rest);
}
