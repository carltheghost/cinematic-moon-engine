/* engine/scene.js — the scene registry (Phase 7): the explicit extension
 * mechanism for second scenes (merged-ruling Phase 6, gap 1).
 *
 * This is a LOADER/EXTENSION seam, not multi-scene content management
 * (FINAL-PLAN §8 stays out of scope): there is no scene browser, no runtime
 * scene switching, no asset management — just an explicit registry mapping a
 * scene id → an async loader that resolves a scene config, plus the `?scene=`
 * query param on the host page (default: the canonical Mimas scene).
 *
 * A scene config (plain object, frozen by convention) carries everything a
 * scene needs to drive the engine's PUBLIC seams — no engine edits per scene:
 *
 *   {
 *     id: 'mimas',                    // registry id (?scene=<id>)
 *     title: '…',                     // human label (logs only)
 *     chapters: [...],                // chapter keyframes, the canonical
 *                                     // field shape (camera/fogDensity/ember/
 *                                     // lantern/glint/exposure) — fed to
 *                                     // createCamera({ chapters }) and to
 *                                     // sampleChapterFrom(chapters, t)
 *     colorScript: null | [...],      // null → the Phase-4-frozen
 *                                     // COLOR_SCRIPT default (moon.js);
 *                                     // array → injected via the buildMoon
 *                                     // { colorScript } opt / setColorScript()
 *     chapterCount: 13,               // clock config for
 *     simDuration: 312,               // canonicalPresentation() — defaults
 *                                     // are the frozen canonical values
 *     chapterLocator: null | fn,      // null → defaultChapterLocator
 *                                     // (frozen chapterAt semantics);
 *                                     // fn(p, chapterCount) → { chapterT }
 *                                     // for createCamera({ chapterLocator })
 *     scrollSpaceVh: 1300,            // host scroll-space height (vh)
 *     decorate: null | fn,            // optional CONTENT hook:
 *                                     // ({ moon, env, post, postm, camera,
 *                                     //    scene, renderer, THREE, seed,
 *                                     //    config }) → void, run once at
 *                                     // boot AFTER the modules are built.
 *                                     // Scene-specific wiring (blood-moon
 *                                     // hooks, grade LUTs) lives here, not
 *                                     // in the host page.
 *   }
 *
 * Registration is explicit and fails loudly: registerSceneLoader throws on a
 * duplicate id; loadScene throws on an unknown id (the host must NOT silently
 * fall back to the canonical scene — a typo'd ?scene= must never masquerade
 * as Mimas). Built-in registrations live in scenes/scene-index.js.
 *
 * PURE (no Math.random / Date.now / performance.now) — grep-gate clean.
 */

const _loaders = new Map(); // id → () => sceneConfig | Promise<sceneConfig>

/**
 * Register a scene loader. Throws on duplicate id — scenes are explicit,
 * never silently overwritten.
 */
export function registerSceneLoader(id, loader) {
  if (typeof id !== 'string' || !id)
    throw new Error('registerSceneLoader: id must be a non-empty string');
  if (typeof loader !== 'function')
    throw new Error(`registerSceneLoader(${id}): loader must be a function`);
  if (_loaders.has(id))
    throw new Error(`registerSceneLoader: scene already registered: "${id}"`);
  _loaders.set(id, loader);
  return id;
}

/**
 * Resolve a scene id to its config. Throws on unknown id — callers must
 * surface this (no silent canonical fallback).
 */
export async function loadScene(id) {
  const loader = _loaders.get(id);
  if (!loader)
    throw new Error(
      `unknown scene "${id}" — registered scenes: ${registeredScenes().join(', ') || '(none)'}`);
  const config = await loader();
  if (!config || typeof config !== 'object' || !Array.isArray(config.chapters))
    throw new Error(`scene "${id}" resolved to an invalid config (missing chapters array)`);
  return config;
}

/** Registered scene ids (in registration order). */
export function registeredScenes() {
  return [..._loaders.keys()];
}
