# Attribution — Cinematic Moon Engine

**Date:** 2026-09-19 · **Status:** Phase 0 skeleton; provenance sections will be
completed with implementation details in Phase 6.

## 1. Vendored dependencies

| Package | Version | License | Source |
|---|---|---|---|
| three | 0.169.0 | MIT | https://registry.npmjs.org/three/-/three-0.169.0.tgz |
| postprocessing (pmndrs) | 6.36.7 | Zlib | https://registry.npmjs.org/postprocessing/-/postprocessing-6.36.7.tgz |
| lenis (darkroom.engineering) | 1.1.14 | MIT | https://registry.npmjs.org/lenis/-/lenis-1.1.14.tgz |

All three are permissive-licensed and vendored verbatim (unmodified) in
`vendor/`; per-package license evidence lives in
`docs/LICENSE-VERIFICATION.md`. Vendored files and integrity hashes are recorded
in `vendor/VENDOR.md`. No other third-party code ships with this engine.

## 2. Technique provenance (permissive-only techniques the engine may later adapt)

The following sources were studied during the plan phase for *technique only*.
Any use in later phases is **implemented fresh from scratch** — concepts and math
re-derived, never copy-pasted:
- **CK42BB** — Voronoi crater field generation; phase + earthshine lighting
  treatment; blackbody star color ramps.
  - *Phase 2 implemented:* Seeded Voronoi-style crater field (3 scales, fresh
    bowl/rim/ejecta relief LUT, CPU-baked 2048² albedo + normal maps). Concept
    only — no CK42BB code was copied.
- **coldprofit** — Fresnel limb shell on the moon; starfield layering pattern.
- **fouryam** — texture-bake pattern for the moon surface; fog-color matching
  discipline; restrained-bloom tuning approach.
- **pun1th01** — phase lighting formula; sky-gradient dome pattern; seeded star
  twinkle.
- **Quilez** — `sdMoon` crater-relief math (distance-field crater profile used in
  the Moon module's seeded bake).
  - *Phase 2 implemented:* Crater relief profile re-derived from the sdMoon
    distance-field concept (bowl depression, rim uplift, ejecta blanket falloff).
    Fresh implementation — no Quilez code was copied.
- **Lenis** (vendored, see §1) — smooth scroll driver (used via its own RAF
  loop; no GSAP dependency).

Phase 6 will extend this section with the exact techniques that were actually
adapted, mapped to modules.

## 3. Reference-only (NO code reuse — inspiration and comparison only)

The following were studied as visual/technical references only. **No code from
these sources appears in, or is adapted into, this engine.**
- **Kage** — visual reference for the cinematic vermilion-moon look. Kage is
  reference-only: nothing was or will be copied from it. No Kage code, shaders,
  assets, or configuration are present in this repo.
- **Nugget8/Three.js-Ocean-Scene** — reference only; no code reuse.
- **Shadertoy** — browsed for technique discussion; no code reuse.
- **CeeJay FilmGrain** — concept reference only for the grain discussion; no
  code reuse.

## 4. Deliberately excluded
- **GSAP 3.12.5** — excluded from `vendor/` because its GreenSock "Standard no
  charge" license is proprietary, not permissive (see
  `docs/LICENSE-VERIFICATION.md` §2). Scroll uses Lenis standalone + a manual
  driver instead.
