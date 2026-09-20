# Fog Unification — Migration Plan (documented follow-up, NOT yet implemented)

Status: PLAN ONLY. The Phase 3 two-term model (FogExp2 + height boost) stays
live and verified. This document records the agreed migration path per the
Phase 3 external reviews (both consultants converged: unify eventually, only
behind a visual-equivalence test).

## Current model (stable, verified Phase 3)

- `scene.fog = FogExp2`, color IS `sky.horizonColor` (same instance), density
  driven per-chapter (Phase 4: 0.0010 – 0.0017).
- Terrain shader: `dens = uFogDensity * (1 + 1.5 * exp(-max(y,0)/60))`,
  `fogF = 1 - exp(-dens² * depth²)` — height-attenuated FogExp2.
- Water + lantern pools: plain FogExp2 with the same density.
- Measured ridge behavior (viewport-normalized suite, Phase 4):
  desktop + mobile both ≥ 40% haze loss (see docs/build-log.md Phase 4).

The two terms do not compose into a single optical-depth integral, so the
chapter system reasons about "density" while the renderer applies
density-plus-boost. Workable, but less controllable than one field.

## Target model (single height-aware exponential)

Conceptual density field: `ρ(h) = ρ₀ · exp(-h / H)`, visibility along the
camera ray `T = exp(-∫₀ᵈ ρ(h(s)) ds)`, with a controlled approximation
exposing: base density ρ₀ (the ONE chapter-driven parameter), height falloff
H (fixed artistic constant, ~60), height offset, distance response, max clamp.

Requirements carried over:
1. The unified fog MUST still sample `sky.horizonColor` (single source of
   truth — the horizon-color guarantee survives the migration).
2. Water glint coupling stays derived from the same model (transmission V
   recomputed from the unified integral, not raw density).
3. Ember depth fade (if added) uses the same transmission.

## Migration steps

1. **Branch shader variant**: implement the unified fog in the terrain/water/
   pool shaders behind a `USE_UNIFIED_FOG` define; keep the old path as the
   default. No visual change at this step.
2. **Visual-equivalence test** (the gate for the swap): render the ridge
   suite (chapters 4, 7, 10 × desktop 1440×900 + mobile 390×844,
   viewport-normalized eligible crest sets) under BOTH models at matched
   chapter densities. Equivalence = haze-loss numbers within ±5pp of the
   current baselines AND ≥ 40% on all viewports, OR a deliberately improved
   result signed off with new baselines recorded in docs/build-log.md.
   Also compare: horizon separation, terrain contrast at the three ridge
   distances, warm/cold light ratio (must stay ≥ 2.2:1).
3. **Retune pass** (expected): ridge convergence, horizon separation, and
   the 1.5× boost / 60-unit scale get re-expressed as ρ₀/H; chapter
   fogDensity values re-mapped so the artistic curve is preserved.
4. **Swap**: flip the define, delete the old uniforms (`uFogHeightBoost`,
   `uFogHeightScale`), re-run the full Phase 4 harness. Determinism gate
   must still pass (the new model is equally a pure function of
   (seed, t, chapter)).

## Non-goals

- No change to the fog COLOR contract (sky.horizonColor forever).
- No new draw calls; the integral approximation stays per-pixel cheap
  (a few exp() calls — inside the existing shader ALU budget).
- Physical-device fog timing is out of scope (same as all perf work).

## Acceptance for the migration (when it happens)

- [ ] Equivalence test numbers recorded in docs/build-log.md
- [ ] Ridge ≥ 40% normalized on both viewports under the unified model
- [ ] Warm/cold ratio ≥ 2.2:1, draw calls ≤ 40, determinism pixel-diff passes
- [ ] Chapter fog curve artistically re-approved (ch10 peak preserved)
