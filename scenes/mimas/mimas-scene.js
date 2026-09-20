/* scenes/mimas/mimas-scene.js — the canonical scene config (Phase 7).
 *
 * The Mimas thirteen chapters AS THEY ARE: this config injects the frozen
 * canonical data (CHAPTERS, COLOR_SCRIPT default, 13/312 clock, default
 * chapter locator) through the Phase 7 extension seams. Every injectable
 * field is left at its null default, which routes to the frozen canonical
 * value — so `?scene=mimas` (and the no-param default) is pixel-identical
 * to the pre-Phase-7 page by construction. decorate is null: the canonical
 * scene needs no content hooks.
 */
import { CHAPTERS, CHAPTER_COUNT, SIM_DURATION } from '../../engine/chapters.js';

export const MIMAS_SCENE = Object.freeze({
  id: 'mimas',
  title: 'Mimas — the canonical thirteen chapters',
  chapters: CHAPTERS,
  colorScript: null,      // → engine default: the Phase-4-frozen COLOR_SCRIPT
  chapterCount: CHAPTER_COUNT, // 13 (frozen)
  simDuration: SIM_DURATION,    // 312 (frozen)
  chapterLocator: null,   // → engine default: defaultChapterLocator (frozen chapterAt semantics)
  scrollSpaceVh: 1300,    // 13 chapters × 100vh
  decorate: null,         // no content hooks for the canonical scene
});
