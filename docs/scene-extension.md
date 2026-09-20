# Scene Extension Mechanism (Phase 7)

**The rule (merged-ruling Phase 6, GPT):** second-scene configurability gets an
**explicit extension mechanism — injection points / registration — not a
second implementation path.** The Phase-4-frozen camera/color contracts are NOT
reopened: defaults and canonical values stay byte-identical; every new seam
routes through the SAME implementation parameterized over the injected
config. Phase 6 deferred 4 API gaps here; all four are closed below.

## The four seams

| # | Gap (Phase 6) | Seam | Default (canonical) |
|---|---|---|---|
| 1 | chapter-config loading in index.html | **Scene registry** `engine/scene.js`: `registerSceneLoader(id, loader)` / `loadScene(id)`; `?scene=<id>` param on index.html (default `mimas`). Built-ins registered in `scenes/scene-index.js`. | `scenes/mimas/mimas-scene.js` — injects the frozen CHAPTERS / COLOR_SCRIPT / 13 / 312 / default locator |
| 2 | `moon.COLOR_SCRIPT` not injectable | `buildMoon(rng, { colorScript })` opt + `moon.setColorScript(script)` / `moon.colorScript` getter. `applyChapter()` is the same code path parameterized over `state.colorScript` (validated by `validateColorScript`; `null` restores the frozen default). | `COLOR_SCRIPT` (Phase-4-frozen, by identity) |

Note (Phase 7 known limitation): `moon.setColorTemp(v)` still maps `[0,1]→[0,12]`,
assuming the canonical 13-keyframe script. An injected non-13-keyframe color
script would need a scaled mapping (`v * (n-1)`); nothing in the tree calls
`setColorTemp`, so canonical behavior is unaffected — documented here rather
than changed.
| 3 | `canonicalPresentation` bakes 13/312 | `canonicalPresentation({ scrollY, maxScroll, reducedMotion, chapterCount = 13, simDuration = 312 })`; `quantizeChapterT(t, chapterCount = 13)`. Same arithmetic — the 13/312 default is float-identical to pre-Phase-7 (scrollP already clamps p∈[0,1], so `p * simDuration === simTimeAt(p)`). | 13 / 312 |
| 4 | `camera.evaluate(scrollY)` uses frozen `chapterAt` | `createCamera({ chapters, chapterLocator = defaultChapterLocator })`. `defaultChapterLocator(p, n)` is float-identical to `chapterAt(p)` for the canonical 13 chapters; `evaluate()` routes through the injected locator. | frozen chapterAt semantics |

Plus two supporting seams on the same philosophy:

- **`sampleChapterFrom(chapters, chapterT)`** (`engine/chapters.js`): the frozen
  `sampleChapter()` is now this same implementation parameterized over the
  chapter data (`sampleChapter(t) === sampleChapterFrom(CHAPTERS, t)`).
  Scenes sample their own chapter arrays; the host-side `sampleEclipse`
  workaround is gone (one mechanism).
- **Scene `decorate(api)` content hook** (part of the scene config): runs once
  at host boot after the engine modules are built —
  `({ moon, env, post, postm, camera, scene, renderer, THREE, seed, config })`.
  Scene-specific *content* (blood-moon `setEclipse`, grade LUTs) lives here,
  not in the host page. `null` for the canonical scene.

### Scene config shape

```js
{
  id: 'eclipse-act', title: '…',
  chapters: [...],            // canonical field shape (camera/fogDensity/ember/lantern/glint/exposure)
  colorScript: null | [...],  // null → frozen COLOR_SCRIPT default
  chapterCount: 13, simDuration: 312,
  chapterLocator: null | ((p, n) => ({ chapterT })),
  scrollSpaceVh: 1300,
  decorate: null | ((api) => void),
}
```

Registration fails loudly: duplicate ids throw; `loadScene` throws on unknown
ids and the host page surfaces it in the loader (a typo'd `?scene=` never
silently masquerades as Mimas). Lazy: the eclipse loader is a dynamic import,
so the canonical page never pays for the second scene's config. This is a
loader seam, NOT multi-scene content management — no scene browser, no runtime
switching, no asset management (FINAL-PLAN §8 stays out of scope).

## What's frozen (unchanged by Phase 7)

- The Phase-4-frozen camera/color contracts: COLOR_SCRIPT values, CHAPTERS
  values, chapter keyframe interpolation (smoothstep for camera, linear for
  chapter fields), FOV 48, vermilion law, dark-limb-neutral law.
- Canonical/motion split, ember floor OFF, bloom dual-gate, host-only wall
  clock, 4-real-light cap, reduced-motion pure-function (no hysteresis/state),
  env scatter at boot-tier scale, "one mechanism" philosophy.
- `?scene=` unset ≡ `?scene=mimas` ≡ pre-Phase-7 pixels (regression: identical
  RGBA for ch1/ch10/ch13 on both viewports — harness/checks-phase7.js P71,
  fixtures captured pre-Phase-7 so re-recording can't mask a regression).

## Viewport identity (GPT contract note 1 — the explicit decision)

**Replay "viewport" = CSS pixel dims (w × h) + `window.devicePixelRatio`
captured at boot.** The engine pins the WebGL render buffer to CSS dims
(`renderer.setPixelRatio(1)`), so the physical render-target size is w×h; the
page-level DPR is recorded to distinguish environments where identical CSS
dims map to different physical screens. Compare FAILS on a DPR mismatch by
design — a different physical render target is a different replay
environment, even though the engine's own buffer is DPR-blind. Record format
`cme-replay/3` carries `viewport: { w, h, dpr }` (+ `scene`, `chapterCount`,
`simDuration`, `bakeRes`). Documented in `harness/replay.js`.

## Auto-tier advisory (GPT contract note 2 — stays visible)

An **auto-mode record can honestly fail the resolved-tier comparison on
another machine** (or another run): warmup re-resolves the tier from live
frame timings, so the resolved tier is not a deterministic function of the
record. The canonical corpus uses **explicit tiers only**. Do NOT try to make
auto mode artificially deterministic — record with `?tier=<explicit>` when
you need replay identity. `replay.js` prints this advisory when recording
with `--tier=auto`, and the header documents it; `compare()` still asserts
the resolved tier (a mismatch reports as a tier failure, not a pixel
failure).

## Physical-device QA

Unchanged: VM/SwiftShader numbers are never device evidence; the absolute
60 FPS desktop / ≥45 FPS mobile targets still require physical-device runs
(protocol: `docs/device-qa.md`). This gate remains unpassed.
