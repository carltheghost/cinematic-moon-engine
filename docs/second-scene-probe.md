# Second-Scene Feasibility Probe — "prove it's an engine" (Phase 6)

**Verdict: EXPRESSIBLE.** The eclipse act (`scenes/eclipse/`) renders through
the engine's public module API with **zero engine edits** — no file under
`engine/` was touched. Conformance probes: `harness/probe-eclipse.js`
(results below).

## 1. Public API surface map (what a second scene can use)

| Need | Public seam | Status |
|---|---|---|
| Query params | `?seed=`, `?tier=`, `?emberfloor=`, `?autoplay=` (index.html) | Scene-local: the eclipse driver re-implements the same params on its own page |
| Chapter data | `createCamera({ chapters })` — camera accepts injected chapter keyframes | ✅ used |
| Blood moon | `moon.setEclipse(amount)` — deep-red ramp + dimmed disc (moon.js, pre-built in Phase 2 for this probe; persists across `setChapter()`); `moon.vermilionLock`, `moon.setColorTemp(v)` | ✅ used (`setEclipse(1)`) |
| Ember grade (env) | `env.setChapterEnv({ fogDensity, ember, lantern, glint })` — takes **explicit values**, not chapter indices | ✅ used |
| Ember grade (LUT) | `post.setGrade(lut)`; `postm.generateNeutralLUT(16)` exported | ✅ used (config's `emberGradeTint` applied to a neutral LUT) |
| Exposure | `post.setExposure(e)` | ✅ used |
| Clock | `canonicalPresentation({ scrollY, maxScroll, reducedMotion })` — the frozen 13-chapter coordinate set | ✅ used as-is |
| Tiers | `resolveTier()`, `TIER_TABLE` (seed.js) | ✅ used (manual mode; the driver skips warmup/watchdog) |
| Determinism hooks | page-local `renderFrame(t)` / `readPixels()` pattern (host code, copied from index.html) | ✅ used (`window.__eclipse`) |
| Autoplay driver | `?autoplay=1` pattern (frame-counted 2px/tick) | ✅ used |

**Scene content is pure data:** `scenes/eclipse/eclipse-config.js` imports
nothing from `engine/` — 13 eclipse chapters (camera keyframes + env values +
exposure + eclipse amount) plus the pure `emberGradeTint(r,g,b)` LUT function.
The driver (`scenes/eclipse/index.html`) is host wiring, like index.html.

## 2. What the probe verified

`node harness/probe-eclipse.js --viewport=1440x900` and `--viewport=390x844`:

- ECL0 boot clean (zero console errors) on both viewports
- ECL1 `renderFrame(t)` twice → pixel-identical (maxDelta=0) at t=0/156/312
- ECL2 `moon.eclipse == 1` (the hook is engaged, not just called)
- ECL3 disc-center strongly red (R−B > 20) — the blood moon reads visually
- ECL4 t=0 vs t=312 differ (the scene is alive, not a static frame)
- ECL5 config drives the frame (`sampleEclipse(6).ember.warmth == 1.0`, ember population > 0)

*(Exact numbers — probe-eclipse.js, seed 7, 2026-09-20: desktop 1440×900
6/6, disc-center RGB (241.7, 66.3, 30.0), R−B = 211.7, t=0-vs-312 diffPx =
958037; mobile 390×844 6/6, disc-center RGB (241.5, 66.3, 30.1), R−B = 211.4,
diffPx = 256110; determinism maxDelta=0 at t=0/156/312 on both; zero console
errors both.)*

## 3. API gaps → Phase 7 work

The scene is expressible, but four seams are missing for *config-only* scenes
(no new host page). None required an engine edit for this probe; all four are
documented here as Phase 7 work:

1. **No chapter-config loading in index.html.** The main page hard-imports the
   frozen `CHAPTERS`; a second scene needs its own driver page. Multi-scene
   content management is FINAL-PLAN §8 out-of-scope for v1 — this probe
   confirms that scoping decision was load-bearing: scenes are currently
   one-host-page-each.
2. **`moon.setChapter` reads the frozen `COLOR_SCRIPT`** (no `{ colorScript }`
   injection). The eclipse act works around it with `setEclipse(1)` +
   `vermilionLock` + `setColorTemp`, which cover a blood-moon arc — but a
   fully custom per-chapter color arc needs an engine-level injection point
   (mirror the `createCamera({ chapters })` seam).
3. **`canonicalPresentation` bakes `CHAPTER_COUNT=13` / `SIM_DURATION=312`.**
   A scene with a different chapter count cannot reuse the canonical clock;
   the eclipse act accepts 13 slots. Parameterizing the clock is Phase 7.
4. **`camera.evaluate(scrollY)` (the raw-scroll path) uses chapters.js
   `chapterAt` internally** — only `evaluateAt(chapterT)` is injectable. The
   driver uses `evaluateAt` exclusively; the raw path stays main-scene-only.

## 4. What was NOT attempted

Full conformance (the Phase 4/5 check suites) against the eclipse act — those
suites assert main-scene canon (ch10 vermilion hexes, ridge gates, ember
hierarchy), which a blood-moon act intentionally does not share. The probe
asserts the engine-level contracts instead: clean boot, determinism, hook
engagement, visual read, liveness, config drive. Porting the statistical
gates (palette census, contrast ratios) to a second scene is Phase 7.
