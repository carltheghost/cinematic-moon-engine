# Phase 5 Design Proposal — Post-Processing Pipeline (2026-09-20)

Builder: Phase 5 subagent. Governing reviews: GPT Phase 4 (hard req: canonical
presentation coordinates) + Grok Phase 4 (addendum: concrete keyframe edits,
ember-floor A/B, ch7 intensity, fog freeze, reduced-motion first-class).

## 1. Canonical presentation coordinates (GPT Q7 — build FIRST)

New pure module `engine/presentation.js`:

```
canonicalPresentation({ scrollY, maxScroll, reducedMotion }) → {
  p,                    // normalized scroll, pure
  canonicalChapterT,    // p * 12 — narrative coordinate, NEVER quantized
  motionChapterT,       // reducedMotion ? quantize(canonicalChapterT) : canonicalChapterT
  canonicalSimTime,     // simTimeAt(p) — the deterministic clock, raw
  motionSimTime,        // reducedMotion ? motionChapterT/12*312 : canonicalSimTime
  frame,                // reducedMotion ? 0 : floor(motionSimTime * 60) — the ONLY post time input
}
quantizeChapterT(t) = round(clamp(t, 0, 12))   // stepped stills: one still per chapter
```

Wiring (index.html `applyScrollState`): camera via new `cameraCtl.evaluateAt(motionChapterT)`
(pure entry, interpolation model untouched), `moon.setChapter(motionChapterT)`,
`sampleChapter(motionChapterT)`, `env.setTime(motionSimTime)`, `stars.setTime(motionSimTime)`,
`post.render(pres.frame)`. Post subsystems (grain uFrame, vignette, bloom, exposure,
tone map) therefore consume only canonical/quantized coords — under reduced motion the
image is stepped stills with zero continuous post animation. `Date.now` /
`performance.now` / `clock.getDelta` / `frameCount++` remain banned from visual state
(grep gate re-run; index.html `performance.now` stays bake-timing-only, host side).

The 30-frame bloom crossfade stays: it is a deterministic function of the host-fed
deterministic frame (`k = (frame - bloomStartFrame) / 30`); a harness check replays the
intensity sequence twice and requires identity.

## 2. Camera keyframes (Grok Q3 — concrete data edits, interpolation frozen)

- ch10 → monumental: `el 0.08→0.06, fov 50→48` (az/look/dist 50 unchanged).
  fov 48 (not 46): 46 narrows the mobile frustum until far terrain samples
  leave the ridge eligible set — analytic haze loss drops to 0.25 < 0.40,
  regressing Phase 4 check 2. 48 is the tightest fov that keeps the gate
  green (n=3, loss 0.62) while moving the disc to the upper end of the band.
- ch13 → decompressed: `el 0.12→0.14, fov 58→64` (az/look/dist 65 unchanged).
- Measured before/after via `moonScreen()` → disc height % = 2·rPx/H on BOTH viewports.
  Target: ch10 upper end of the 20–38% band, ch13 lower end; band itself never violated.

## 3. ch7 hero intensity (Grok Q5 — data edit)

ch7 lantern: `heroIntensity 0.9→0.8`, `poolVisibility 1.0→0.85`. Vermilion slots ch7–10
kept; 5.39:1 warm/cold invariant holds (0.8 × 5.39 ≈ 4.3:1 ≥ 2.2:1). No other chapters touched.

## 4. Mobile ember perceptual floor — A/B behind a flag (GPT Q6 vs Grok Q6)

`buildEnvironment` gains `opts.emberFloor` (default false = Grok variant). When true:
new uniforms `uFloorSize = 2.0` (min point size, drawing-buffer px) and
`uFloorOpacity = 0.35` (fragment alpha floor), applied in-shader so `setEmbers`
stays pure and chapter data is untouched; ember population count unchanged.
Host: `?emberfloor=1` forces on for the A/B; absent = off.

A/B at 390×844 ch10, both variants screenshotted. KEEP the floor only if ALL hold:
(a) brightest non-stellar outside-disc pixel < 0.85× center (check-8 metric) and the
vermilion core remains the max-chroma element; (b) ch10 chroma separation ≥ 2.50×
preserved; (c) draw calls identical, grain uniforms untouched. Else ship Grok (off).

**A/B RESULT (2026-09-20, measured): SHIP the Grok variant (floor off, default).**
Floor-on vs floor-off at 390×844 ch10: outside-disc/center ratio 0.0031 → 0.0031
(no measurable change — the 0.35 opacity floor sits below ch10's 0.60 chapter
opacity so it no-ops, and the 2.0px size floor only touches distant subpixel
embers below the frame's brightest non-ember pixel), chroma separation
2.498 → 2.498 (baseline 2.50, Δ 0.08%), draw calls 29 → 29, screenshots
pixel-comparable. The floor fails its purpose ("restrained + perceptible"):
zero measured and zero visible effect. The flag + `?emberfloor=1` remain for
future experiments; default off.

## 5. Reduced motion as first-class post input (Grok Q7 + GPT Q7)

Documented in `post.js` header as the per-tier post graph:
`{ tier, canonical frame, stillMode } → pixels`, where stillMode (reduced-motion or
`tier==='still'`) pins grain uFrame to 0 and the whole graph is a pure function of
one still input — no temporal accumulation, grain/dither keyed only to simTime,
bloom purely spatial. Small fix: grain freeze condition becomes
`(reducedMotion || tier === 'still')` (was documented, not implemented).

## 6. Frozen (not touched)

Fog model (dual FogExp2 + height-boost), ridge geometry, camera interpolation model,
ember population count, chapter color targets, chapters.js except the three data
edits above, glint/moon azimuth lock, 4-light cap, hero-slot architecture,
deterministic simTimeAt(p).

## 7. Harness extensions (new `harness/checks-phase5.js` + `run-phase5.js`, both viewports)

- RM1 stepped stills (reduced-motion emulated): two raw scrollYs in one quantization
  basin → pixel-identical (maxDelta ≤ 1); scrollY in adjacent basin → pixels differ;
  applied chapterT is stepped while canonical chapterT is not.
- RM2 non-reduced sanity: same-basin scrollYs → pixels DIFFER (motion preserved).
- RM3 grain frozen: grade `uFrame` uniform == 0 under reduced motion.
- DISCBAND ch10/ch13 disc-height % on both viewports (20–38% band).
- EMBER-AB mobile ch10: both variants — check-8 ratio, chroma separation, draw calls,
  plus `?emberfloor` screenshots.
- BLOOMXFADE: setQuality crossfade intensity sequence replayed twice → identical.
- Grep gate re-run.

Built (Phase 5, FINAL-PLAN D5 — not deferred):
- `engine/tiermanager.js` (PURE, no clocks): tier precedence
  (reducedMotion → forced 'still'; `?tier=` → manual, bypasses warmup+watchdog;
  else auto), `selectTierFromWarmup` (≥55 cinematic / ≥35 balanced / else
  efficient), one-way watchdog state machine (rolling p95 > 20 ms for 120
  consecutive frames → step down one tier), two-gate bloom probe decision.
- Host (`index.html`): `applyTier()` (post.setQuality 30-frame crossfade +
  star drawRange + moon mesh swap; env scatter stays at boot scale —
  documented), 60-frame warmup benchmark behind the loader (auto mode only;
  real `performance.now` measurement, never feeds pixels), watchdog armed in
  auto mode only, tab-hidden render pause, context-loss → forced still.
- Balanced bloom: DISABLED — Phase 2 visual bake-off stays closed
  (3.8% < 20%); the runtime probe (`bloomProbeDecision`) is implemented and
  unit-tested but gated on a bake-off re-run. Never inferred from fill math.
- Physical-device load validation of the watchdog (balanced ≥ 45 fps,
  efficient ≥ 55 fps, step-down under artificial load without oscillation)
  remains a delegated gate.
