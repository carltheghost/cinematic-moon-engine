/* scenes/eclipse/eclipse-config.js — the "eclipse act" second scene.
 *
 * CONFIG-ONLY scene data for the Phase 6 second-scene feasibility probe
 * (FINAL-PLAN Phase 6: "prove it's an engine"). This file is pure data:
 * it imports NOTHING from engine/ — the driver (index.html in this folder)
 * feeds it to the engine through the public module API:
 *   createCamera({ chapters })   — chapter injection (engine/camera.js)
 *   moon.setEclipse(amount)      — blood-moon shift (engine/moon.js, Phase 6 hook)
 *   env.setChapterEnv({...})    — explicit env values (engine/environment.js)
 *   post.setGrade(lut)          — ember grade LUT (engine/post.js)
 *
 * The act: a total lunar eclipse over the same valley. Thirteen chapters
 * (the presentation coordinate set bakes CHAPTER_COUNT=13 — see
 * docs/second-scene-probe.md §API gaps). The moon goes blood-red
 * (uEclipse=1 throughout), the ember grade runs hot (warmth 0.75–1.0), and
 * the lanterns burn vermilion against the dimmed disc.
 *
 * Field semantics mirror engine/chapters.js (same interpolation model:
 * smoothstep between adjacent keyframes, applied by the driver).
 */
export const ECLIPSE_META = Object.freeze({
  id: 'eclipse-act',
  title: 'Eclipse Act — a blood moon over the valley',
  chapters: 13,
  eclipseAmount: 1, // uEclipse: full blood-moon shift for the whole act
  seed: 7,
});

export const ECLIPSE_CHAPTERS = Object.freeze([
  Object.freeze({
    id: 1, name: 'First Shadow', role: 'The penumbra touches the limb; the valley holds its breath.',
    camera: Object.freeze({ az: 0.35, el: 0.10, dist: 60, lookAz: 0.35, lookEl: 0.30, fov: 60 }),
    fogDensity: 0.0011,
    ember: Object.freeze({ density: 0.30, opacity: 0.45, drift: 0.7, warmth: 0.75 }),
    lantern: Object.freeze({ heroIntensity: 0.9, poolIntensity: 0.8, poolVisibility: 1.0, heroSlots: 'nearest' }),
    glint: 0.90, exposure: 1.00, eclipse: 1,
  }),
  Object.freeze({
    id: 2, name: 'The Dimming', role: 'Light drains from the disc; embers rise to meet the dark.',
    camera: Object.freeze({ az: 0.36, el: 0.10, dist: 59, lookAz: 0.35, lookEl: 0.30, fov: 59 }),
    fogDensity: 0.0012,
    ember: Object.freeze({ density: 0.38, opacity: 0.52, drift: 0.8, warmth: 0.80 }),
    lantern: Object.freeze({ heroIntensity: 1.0, poolIntensity: 0.9, poolVisibility: 1.0, heroSlots: 'nearest' }),
    glint: 0.85, exposure: 0.99, eclipse: 1,
  }),
  Object.freeze({
    id: 3, name: 'Copper Hour', role: 'The disc goes copper; the first totality band crosses.',
    camera: Object.freeze({ az: 0.37, el: 0.09, dist: 58, lookAz: 0.36, lookEl: 0.29, fov: 58 }),
    fogDensity: 0.0013,
    ember: Object.freeze({ density: 0.48, opacity: 0.60, drift: 0.9, warmth: 0.85 }),
    lantern: Object.freeze({ heroIntensity: 1.0, poolIntensity: 1.0, poolVisibility: 1.0, heroSlots: 'vermilion' }),
    glint: 0.80, exposure: 0.98, eclipse: 1,
  }),
  Object.freeze({
    id: 4, name: 'Totality Gate', role: 'The last white sliver dies; the valley is ember-lit now.',
    camera: Object.freeze({ az: 0.38, el: 0.08, dist: 57, lookAz: 0.36, lookEl: 0.28, fov: 56 }),
    fogDensity: 0.0014,
    ember: Object.freeze({ density: 0.58, opacity: 0.66, drift: 1.0, warmth: 0.90 }),
    lantern: Object.freeze({ heroIntensity: 1.1, poolIntensity: 1.0, poolVisibility: 1.0, heroSlots: 'vermilion' }),
    glint: 0.70, exposure: 0.96, eclipse: 1,
  }),
  Object.freeze({
    id: 5, name: 'Blood Meridian', role: 'Deepest red; the moon hangs like a coal over the ridge.',
    camera: Object.freeze({ az: 0.39, el: 0.07, dist: 56, lookAz: 0.37, lookEl: 0.27, fov: 54 }),
    fogDensity: 0.0015,
    ember: Object.freeze({ density: 0.66, opacity: 0.70, drift: 1.0, warmth: 0.95 }),
    lantern: Object.freeze({ heroIntensity: 1.1, poolIntensity: 1.0, poolVisibility: 1.0, heroSlots: 'vermilion' }),
    glint: 0.60, exposure: 0.94, eclipse: 1,
  }),
  Object.freeze({
    id: 6, name: 'The Long Dark', role: 'Totality holds; only embers and lanterns give light.',
    camera: Object.freeze({ az: 0.40, el: 0.06, dist: 55, lookAz: 0.38, lookEl: 0.26, fov: 52 }),
    fogDensity: 0.0016,
    ember: Object.freeze({ density: 0.74, opacity: 0.74, drift: 0.9, warmth: 1.00 }),
    lantern: Object.freeze({ heroIntensity: 1.1, poolIntensity: 1.0, poolVisibility: 1.0, heroSlots: 'vermilion' }),
    glint: 0.55, exposure: 0.92, eclipse: 1,
  }),
  Object.freeze({
    id: 7, name: 'Heart of Shadow', role: 'Mid-totality: the blood moon at its largest and lowest.',
    camera: Object.freeze({ az: 0.41, el: 0.06, dist: 54, lookAz: 0.38, lookEl: 0.26, fov: 50 }),
    fogDensity: 0.0016,
    ember: Object.freeze({ density: 0.80, opacity: 0.76, drift: 0.9, warmth: 1.00 }),
    lantern: Object.freeze({ heroIntensity: 1.1, poolIntensity: 1.0, poolVisibility: 1.0, heroSlots: 'vermilion' }),
    glint: 0.55, exposure: 0.92, eclipse: 1,
  }),
  Object.freeze({
    id: 8, name: 'Ember Zenith', role: 'The ember storm peaks under the red disc.',
    camera: Object.freeze({ az: 0.42, el: 0.07, dist: 55, lookAz: 0.39, lookEl: 0.27, fov: 52 }),
    fogDensity: 0.0015,
    ember: Object.freeze({ density: 0.85, opacity: 0.78, drift: 1.0, warmth: 1.00 }),
    lantern: Object.freeze({ heroIntensity: 1.1, poolIntensity: 1.0, poolVisibility: 1.0, heroSlots: 'vermilion' }),
    glint: 0.60, exposure: 0.93, eclipse: 1,
  }),
  Object.freeze({
    id: 9, name: 'The Turning', role: 'A bright bead breaks the shadow; the red begins to thin.',
    camera: Object.freeze({ az: 0.43, el: 0.08, dist: 56, lookAz: 0.39, lookEl: 0.28, fov: 54 }),
    fogDensity: 0.0014,
    ember: Object.freeze({ density: 0.72, opacity: 0.70, drift: 0.9, warmth: 0.95 }),
    lantern: Object.freeze({ heroIntensity: 1.0, poolIntensity: 1.0, poolVisibility: 1.0, heroSlots: 'vermilion' }),
    glint: 0.68, exposure: 0.95, eclipse: 1,
  }),
  Object.freeze({
    id: 10, name: 'Diamond Ring', role: 'Sunlight returns in a flare; embers scatter in the glare.',
    camera: Object.freeze({ az: 0.44, el: 0.09, dist: 57, lookAz: 0.40, lookEl: 0.29, fov: 56 }),
    fogDensity: 0.0013,
    ember: Object.freeze({ density: 0.60, opacity: 0.62, drift: 0.8, warmth: 0.90 }),
    lantern: Object.freeze({ heroIntensity: 1.0, poolIntensity: 0.9, poolVisibility: 1.0, heroSlots: 'nearest' }),
    glint: 0.78, exposure: 0.97, eclipse: 1,
  }),
  Object.freeze({
    id: 11, name: 'Penumbral Wake', role: 'The shadow recedes; copper fades to amber.',
    camera: Object.freeze({ az: 0.45, el: 0.10, dist: 58, lookAz: 0.40, lookEl: 0.30, fov: 58 }),
    fogDensity: 0.0012,
    ember: Object.freeze({ density: 0.48, opacity: 0.55, drift: 0.7, warmth: 0.85 }),
    lantern: Object.freeze({ heroIntensity: 0.9, poolIntensity: 0.8, poolVisibility: 1.0, heroSlots: 'nearest' }),
    glint: 0.85, exposure: 0.99, eclipse: 1,
  }),
  Object.freeze({
    id: 12, name: 'Clearing', role: 'The disc cools; the valley exhales.',
    camera: Object.freeze({ az: 0.46, el: 0.11, dist: 59, lookAz: 0.41, lookEl: 0.30, fov: 59 }),
    fogDensity: 0.0011,
    ember: Object.freeze({ density: 0.36, opacity: 0.48, drift: 0.6, warmth: 0.80 }),
    lantern: Object.freeze({ heroIntensity: 0.9, poolIntensity: 0.8, poolVisibility: 1.0, heroSlots: 'nearest' }),
    glint: 0.90, exposure: 1.00, eclipse: 1,
  }),
  Object.freeze({
    id: 13, name: 'After the Shadow', role: 'Night restored — but the embers remember the red.',
    camera: Object.freeze({ az: 0.47, el: 0.12, dist: 60, lookAz: 0.41, lookEl: 0.31, fov: 60 }),
    fogDensity: 0.0010,
    ember: Object.freeze({ density: 0.28, opacity: 0.42, drift: 0.5, warmth: 0.75 }),
    lantern: Object.freeze({ heroIntensity: 0.8, poolIntensity: 0.7, poolVisibility: 1.0, heroSlots: 'nearest' }),
    glint: 0.95, exposure: 1.00, eclipse: 1,
  }),
]);

/**
 * Ember grade tint for the 3D LUT (applied by the driver to a neutral LUT):
 * warm push in the mids, slight red lift in the shadows, cool clamp in the
 * highlights so the blood disc keeps its edge. PURE in (r,g,b) ∈ [0,1].
 */
export function emberGradeTint(r, g, b) {
  const mids = Math.sin(Math.PI * Math.min(1, Math.max(0, (r + g + b) / 3)));
  return [
    Math.min(1, r * (1 + 0.10 * mids) + 0.020 * (1 - r)),
    Math.min(1, g * (1 + 0.02 * mids)),
    Math.min(1, Math.max(0, b * (1 - 0.08 * mids) - 0.012 * (1 - b))),
  ];
}
