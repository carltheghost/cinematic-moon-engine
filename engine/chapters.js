/* engine/chapters.js — the 13-chapter narrative treatment as frozen data (Phase 4).
 *
 * Narrative layer refreshed 2026-09-20: the Mimas treatment (2nd draft).
 * names/roles are narrative labels; EVERY numeric value remains Phase-4-frozen.
 *
 * Source of truth: ~/workspace/research_notes/epic-story-structure/moon-engine-chapters.md
 * (13-chapter treatment over the five-act skeleton: Act 1 → ch. 1–2 · Act 2 → ch. 3–5 ·
 * Act 3 → ch. 6–8 · Act 4 → ch. 9–11 · Act 5 → ch. 12–13).
 *
 * Rationale baked into the per-chapter numbers (DO NOT "improve" these values —
 * they encode review feedback and the treatment):
 *  - Embers are chapter-gated by curves: pale early chapters sparse + low opacity,
 *    peak at ch. 8; RESTRAINED at ch. 10 so the vermilion moon stays the brightest
 *    saturated element. Hierarchy: vermilion moon → warm lanterns → embers →
 *    everything else.
 *  - heroSlots 'vermilion' = the 4 lanterns closest in azimuth to the moon (inside
 *    the vermilion beat), for ch. 7–10 only. 'nearest' everywhere else.
 *  - ch. 7 heroIntensity/poolVisibility deliberately stepped DOWN vs ch. 8–10
 *    (0.8/0.85 vs 1.0/1.0): the grief beat stays moon-aligned but subdued, never
 *    triumphant (GPT+Grok Phase 4 reviews). Warm/cold ratio at k=0.8 ≈ 4.3:1 ≥
 *    2.2:1 — the 5.39:1 protection holds.
 *  - Fog floor 0.0010 keeps the ridge gate inside the verified band.
 *  - Vermilion peaks ONLY at ch. 10; the dark limb stays neutral/cool always.
 *  - ch. 10 camera: monumental (el 0.06, fov 48 — disc toward the upper end
 *    of the 20–38% band; fov 48 is the tightest the mobile ridge gate allows:
 *    fov 46 narrows the frustum until far terrain samples leave the eligible
 *    set and the analytic haze loss drops to 0.25 < 0.40). ch. 13 camera:
 *    decompressed (el 0.14, fov 64 — disc toward the lower end). Grok Phase 4
 *    Q3; interpolation model untouched.
 *
 * All exports are PURE: no Math.random, no Date.now, no performance.now.
 * The ONLY clock the engine may use is simTimeAt(p) — deterministic sim-seconds.
 */

export const CHAPTER_COUNT = 13;
/** Seconds of deterministic sim-time across the full scroll (13 chapters × 24s). */
export const SIM_DURATION = 312;

/**
 * The 13 chapters. Frozen — consumers interpolate via sampleChapter(); never
 * mutate these. Each `camera` field is a keyframe for the stateless scrub camera
 * (see engine/camera.js); framing keeps the disc between 20% and 38% of
 * viewport height at 1440×900 in every chapter.
 */
export const CHAPTERS = Object.freeze([
  Object.freeze({
    id: 1, name: 'The Eye', act: 1,
    role: 'Arrival — the Meridian finds Mimas, the Death Star moon; a rotation residual moves.',
    beats: Object.freeze({ hard: 1, sad: 0, happy: 5, creative: 2 }),
    fogDensity: 0.0010,
    ember: Object.freeze({ density: 0.10, opacity: 0.22, drift: 0.5, warmth: 0.25 }),
    lantern: Object.freeze({ heroIntensity: 0.7, poolIntensity: 0.6, poolVisibility: 1.0, heroSlots: 'nearest' }),
    glint: 1.00,
    exposure: 1.00,
    camera: Object.freeze({ az: 0.35, el: 0.10, dist: 60, lookAz: 0.35, lookEl: 0.30, fov: 60 }),
  }),
  Object.freeze({
    id: 2, name: 'The Hidden Sea', act: 1,
    role: 'The hidden sea discovered; Ilse dies saving the buoy — the ember of grace is planted.',
    beats: Object.freeze({ hard: 2, sad: 1, happy: 3, creative: 2 }),
    fogDensity: 0.0011,
    ember: Object.freeze({ density: 0.14, opacity: 0.28, drift: 0.6, warmth: 0.30 }),
    lantern: Object.freeze({ heroIntensity: 0.8, poolIntensity: 0.7, poolVisibility: 1.0, heroSlots: 'nearest' }),
    glint: 1.00,
    exposure: 1.00,
    camera: Object.freeze({ az: 0.36, el: 0.11, dist: 58, lookAz: 0.35, lookEl: 0.30, fov: 58 }),
  }),
  Object.freeze({
    id: 3, name: 'Twenty-Two Hours', act: 2,
    role: 'The orbit decays; gravity becomes the engine; dread, not sorrow.',
    beats: Object.freeze({ hard: 2, sad: 0, happy: 2, creative: 1 }),
    fogDensity: 0.0012,
    ember: Object.freeze({ density: 0.25, opacity: 0.40, drift: 0.7, warmth: 0.40 }),
    lantern: Object.freeze({ heroIntensity: 0.9, poolIntensity: 0.8, poolVisibility: 1.0, heroSlots: 'nearest' }),
    glint: 0.95,
    exposure: 1.00,
    camera: Object.freeze({ az: 0.38, el: 0.12, dist: 56, lookAz: 0.36, lookEl: 0.29, fov: 57 }),
  }),
  Object.freeze({
    id: 4, name: 'The Resonance', act: 2,
    role: 'The Cassini Division resonance becomes the clock; the ember is remembered.',
    beats: Object.freeze({ hard: 3, sad: 1, happy: 1, creative: 1 }),
    fogDensity: 0.0012,
    ember: Object.freeze({ density: 0.35, opacity: 0.50, drift: 0.8, warmth: 0.50 }),
    lantern: Object.freeze({ heroIntensity: 1.0, poolIntensity: 0.9, poolVisibility: 1.0, heroSlots: 'nearest' }),
    glint: 0.90,
    exposure: 1.00,
    camera: Object.freeze({ az: 0.40, el: 0.12, dist: 54, lookAz: 0.37, lookEl: 0.28, fov: 55 }),
  }),
  Object.freeze({
    id: 5, name: 'The Crack', act: 2,
    role: 'The grief cluster begins; the ice shell fractures and the signal dies.',
    beats: Object.freeze({ hard: 3, sad: 2, happy: 1, creative: 0 }),
    fogDensity: 0.0013,
    ember: Object.freeze({ density: 0.45, opacity: 0.55, drift: 0.9, warmth: 0.55 }),
    lantern: Object.freeze({ heroIntensity: 1.0, poolIntensity: 1.0, poolVisibility: 1.0, heroSlots: 'nearest' }),
    glint: 0.85,
    exposure: 1.00,
    camera: Object.freeze({ az: 0.42, el: 0.11, dist: 52, lookAz: 0.38, lookEl: 0.27, fov: 54 }),
  }),
  Object.freeze({
    id: 6, name: 'Shatter', act: 3,
    role: 'Mimas unmakes itself; the reconnaissance craft lost with all hands.',
    beats: Object.freeze({ hard: 4, sad: 2, happy: 0, creative: 1 }),
    fogDensity: 0.0014,
    ember: Object.freeze({ density: 0.60, opacity: 0.65, drift: 1.0, warmth: 0.60 }),
    lantern: Object.freeze({ heroIntensity: 1.0, poolIntensity: 1.0, poolVisibility: 1.0, heroSlots: 'nearest' }),
    glint: 0.80,
    exposure: 1.00,
    camera: Object.freeze({ az: 0.44, el: 0.10, dist: 50, lookAz: 0.40, lookEl: 0.26, fov: 56 }),
  }),
  Object.freeze({
    id: 7, name: 'The Bill', act: 3,
    role: 'The accounting — collects the bill; introduces no new tragedy.',
    beats: Object.freeze({ hard: 3, sad: 3, happy: 0, creative: 0 }),
    fogDensity: 0.0015,
    ember: Object.freeze({ density: 0.70, opacity: 0.70, drift: 0.9, warmth: 0.65 }),
    lantern: Object.freeze({ heroIntensity: 0.8, poolIntensity: 0.9, poolVisibility: 0.85, heroSlots: 'vermilion' }),
    glint: 0.75,
    exposure: 0.98,
    camera: Object.freeze({ az: 0.42, el: 0.09, dist: 52, lookAz: 0.38, lookEl: 0.25, fov: 54 }),
  }),
  Object.freeze({
    id: 8, name: 'The Ember', act: 3,
    role: 'The ember pays off — the buoy’s preserved spin becomes the reassembly key.',
    beats: Object.freeze({ hard: 3, sad: 0, happy: 2, creative: 1 }),
    fogDensity: 0.0014,
    ember: Object.freeze({ density: 0.85, opacity: 0.80, drift: 1.0, warmth: 0.75 }),
    lantern: Object.freeze({ heroIntensity: 1.0, poolIntensity: 1.0, poolVisibility: 1.0, heroSlots: 'vermilion' }),
    glint: 0.80,
    exposure: 1.00,
    camera: Object.freeze({ az: 0.40, el: 0.10, dist: 54, lookAz: 0.37, lookEl: 0.26, fov: 53 }),
  }),
  Object.freeze({
    id: 9, name: 'The Wager', act: 4,
    role: 'The gambit begins; the crew votes unanimously to sling the swarm.',
    beats: Object.freeze({ hard: 2, sad: 0, happy: 1, creative: 2 }),
    fogDensity: 0.0016,
    ember: Object.freeze({ density: 0.75, opacity: 0.70, drift: 1.1, warmth: 0.80 }),
    lantern: Object.freeze({ heroIntensity: 1.1, poolIntensity: 1.0, poolVisibility: 1.0, heroSlots: 'vermilion' }),
    glint: 0.70,
    exposure: 1.00,
    camera: Object.freeze({ az: 0.38, el: 0.10, dist: 52, lookAz: 0.36, lookEl: 0.24, fov: 52 }),
  }),
  Object.freeze({
    id: 10, name: 'The Vermilion Moon', act: 4,
    role: 'The single vermilion keyframe — the burn, once, never again.',
    beats: Object.freeze({ hard: 3, sad: 1, happy: 2, creative: 1 }),
    fogDensity: 0.0017,
    ember: Object.freeze({ density: 0.65, opacity: 0.60, drift: 1.0, warmth: 0.85 }),
    lantern: Object.freeze({ heroIntensity: 1.15, poolIntensity: 1.0, poolVisibility: 1.0, heroSlots: 'vermilion' }),
    glint: 0.60,
    exposure: 1.00,
    camera: Object.freeze({ az: 0.36, el: 0.06, dist: 50, lookAz: 0.34, lookEl: 0.20, fov: 48 }),
  }),
  Object.freeze({
    id: 11, name: 'Ashes That Hold', act: 4,
    role: 'After the fire: the moon holds; rescue is a solvable math problem.',
    beats: Object.freeze({ hard: 2, sad: 0, happy: 2, creative: 0 }),
    fogDensity: 0.0014,
    ember: Object.freeze({ density: 0.45, opacity: 0.50, drift: 0.8, warmth: 0.60 }),
    lantern: Object.freeze({ heroIntensity: 1.0, poolIntensity: 0.9, poolVisibility: 1.0, heroSlots: 'nearest' }),
    glint: 0.75,
    exposure: 1.00,
    camera: Object.freeze({ az: 0.35, el: 0.09, dist: 52, lookAz: 0.34, lookEl: 0.22, fov: 52 }),
  }),
  Object.freeze({
    id: 12, name: 'Afterlight', act: 5,
    role: 'The vermilion deliberately gone; the crew waits for the tug under the cooling moon.',
    beats: Object.freeze({ hard: 1, sad: 0, happy: 1, creative: 0 }),
    fogDensity: 0.0011,
    ember: Object.freeze({ density: 0.25, opacity: 0.35, drift: 0.6, warmth: 0.40 }),
    lantern: Object.freeze({ heroIntensity: 0.8, poolIntensity: 0.7, poolVisibility: 1.0, heroSlots: 'nearest' }),
    glint: 0.85,
    exposure: 0.98,
    camera: Object.freeze({ az: 0.34, el: 0.10, dist: 56, lookAz: 0.33, lookEl: 0.24, fov: 55 }),
  }),
  Object.freeze({
    id: 13, name: 'Mimas Persists', act: 5,
    role: 'The tug takes them home; Mimas turns free — the exhale.',
    beats: Object.freeze({ hard: 1, sad: 0, happy: 2, creative: 0 }),
    fogDensity: 0.0010,
    ember: Object.freeze({ density: 0.12, opacity: 0.25, drift: 0.5, warmth: 0.30 }),
    lantern: Object.freeze({ heroIntensity: 0.7, poolIntensity: 0.6, poolVisibility: 1.0, heroSlots: 'nearest' }),
    glint: 0.90,
    exposure: 1.00,
    camera: Object.freeze({ az: 0.32, el: 0.14, dist: 65, lookAz: 0.32, lookEl: 0.26, fov: 64 }),
  }),
]);

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

/** Normalized scroll p∈[0,1] → { chapterT }, float chapter index ∈[0,12] = p*12. PURE. */
export function chapterAt(p) {
  return { chapterT: clamp01(p) * (CHAPTER_COUNT - 1) };
}

/**
 * chapterT (clamped) → interpolated chapter params over ANY chapter array
 * with the canonical field shape (camera + fogDensity + ember + lantern +
 * glint + exposure). Phase 7 extension seam: this is the SAME interpolation
 * model as the frozen sampleChapter() — parameterized over the chapter data
 * ("one mechanism": sampleChapter(chapterT) === sampleChapterFrom(CHAPTERS,
 * chapterT), float-identical). Second scenes sample their own config through
 * this; the canonical CHAPTERS values are never touched.
 * LERPs all numeric fields between adjacent chapters (fogDensity, ember.*,
 * lantern hero/pool intensity+visibility, glint, exposure, camera.*).
 * heroSlots, beats, name, act, role are taken from the NEAREST chapter
 * (no lerp). Narrative metadata (beats/act) is OPTIONAL per chapter — a
 * scene that ships no beats gets `beats: undefined` instead of a throw;
 * when present, the canonical output shape and values are byte-identical
 * to the pre-Phase-7 sampleChapter(). Returns a fresh UNFROZEN object. PURE.
 */
export function sampleChapterFrom(chapters, chapterT) {
  if (!Array.isArray(chapters) || chapters.length < 2)
    throw new Error('sampleChapterFrom: chapters must be an array of ≥2 keyframes');
  const lastT = chapters.length - 1;
  const t = Math.min(lastT, Math.max(0, chapterT));
  const i = Math.min(chapters.length - 2, Math.floor(t));
  const f = t - i;
  const a = chapters[i];
  const b = chapters[i + 1];
  const lerp = (x, y) => x + (y - x) * f;
  const nearest = f < 0.5 ? a : b;
  return {
    id: nearest.id,
    name: nearest.name,
    act: nearest.act,
    role: nearest.role,
    beats: nearest.beats
      ? { hard: nearest.beats.hard, sad: nearest.beats.sad, happy: nearest.beats.happy, creative: nearest.beats.creative }
      : undefined,
    fogDensity: lerp(a.fogDensity, b.fogDensity),
    ember: {
      density: lerp(a.ember.density, b.ember.density),
      opacity: lerp(a.ember.opacity, b.ember.opacity),
      drift: lerp(a.ember.drift, b.ember.drift),
      warmth: lerp(a.ember.warmth, b.ember.warmth),
    },
    lantern: {
      heroIntensity: lerp(a.lantern.heroIntensity, b.lantern.heroIntensity),
      poolIntensity: lerp(a.lantern.poolIntensity, b.lantern.poolIntensity),
      poolVisibility: lerp(a.lantern.poolVisibility, b.lantern.poolVisibility),
      heroSlots: nearest.lantern.heroSlots,
    },
    glint: lerp(a.glint, b.glint),
    exposure: lerp(a.exposure, b.exposure),
    camera: {
      az: lerp(a.camera.az, b.camera.az),
      el: lerp(a.camera.el, b.camera.el),
      dist: lerp(a.camera.dist, b.camera.dist),
      lookAz: lerp(a.camera.lookAz, b.camera.lookAz),
      lookEl: lerp(a.camera.lookEl, b.camera.lookEl),
      fov: lerp(a.camera.fov, b.camera.fov),
    },
  };
}

/**
 * chapterT∈[0,12] (clamped) → interpolated chapter params. Frozen canonical
 * sampler: delegates to the parameterized sampleChapterFrom over the frozen
 * CHAPTERS (float-identical — same code path, same data).
 */
export function sampleChapter(chapterT) {
  return sampleChapterFrom(CHAPTERS, chapterT);
}

/** p∈[0,1] → p * SIM_DURATION. Deterministic sim-seconds — the ONLY clock the engine may use. PURE. */
export function simTimeAt(p) {
  return clamp01(p) * SIM_DURATION;
}

/** PURE: raw scroll metrics → normalized progress p∈[0,1]. */
export function scrollP(scrollY, maxScroll) {
  return clamp01(scrollY / Math.max(maxScroll, 1));
}
