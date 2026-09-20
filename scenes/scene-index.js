/* scenes/scene-index.js — built-in scene registrations (Phase 7).
 *
 * Imported once by the host page (index.html). Registers the scene loaders
 * with engine/scene.js:
 *   'mimas'       → the canonical thirteen chapters (static import; the
 *                   default scene — zero load cost beyond the frozen data)
 *   'eclipse-act' → the blood-moon act (LAZY: dynamic import, so the
 *                   canonical page never pays for the second scene's config;
 *                   the loader composes the injected color script from the
 *                   frozen COLOR_SCRIPT via the config's pure transform)
 */
import { registerSceneLoader } from '../engine/scene.js';
import { MIMAS_SCENE } from './mimas/mimas-scene.js';

registerSceneLoader('mimas', () => MIMAS_SCENE);

registerSceneLoader('eclipse-act', async () => {
  const cfg = await import('./eclipse/eclipse-config.js');
  const moonm = await import('../engine/moon.js');
  return {
    ...cfg.ECLIPSE_SCENE,
    // Compose the injected color script here (loader scope): the config
    // module itself stays engine-import-free (pure data + pure transform);
    // the registry resolves it against the frozen canonical script.
    colorScript: cfg.makeEclipseColorScript(moonm.COLOR_SCRIPT),
  };
});
