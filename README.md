# cinematic-moon-engine

A static cinematic moon engine in vanilla JavaScript: a seeded procedural moon
with analytic atmosphere and tiered bloom, played through scroll-driven chapters.

- **Seeded procedural moon** — deterministic sfc32 seed streams bake the moon on
  the CPU (seeded crater field, albedo + normal maps) instead of loading
  textures. Same seed, same moon.
- **Atmosphere** — analytic scattering sky dome with exponential fog, HDR
  emissive moon material, and halo sprites.
- **Tiered bloom** — per-tier bloom eligibility with a deterministic conformance
  harness: seeded determinism fixtures, screenshot probes, replay records, and a
  grep gate that fails the build if non-deterministic calls appear in `engine/`.
- **Scroll chapters** — chapter keyframes drive the moon, sky, fog, post-grade,
  and camera through explicit inputs only (`engine/chapters.js`); scroll scrubs
  a pure camera curve.
- **Static, no backend** — pinned three.js vendored under `vendor/`; open
  `index.html` behind any local static server. No build step, no server, no
  network calls at runtime.

Two scenes ship (`scenes/eclipse`, `scenes/mimas`). Implementation phases 1–7
are done with the harness checks in `harness/`; adding scenes and chapters is
the open extension surface (see `docs/scene-extension.md`).

This engine is one of several moon experiments — [steal-the-moon](https://github.com/carltheghost/steal-the-moon)
(the Mimas heist story) and [kage](https://github.com/carltheghost/kage) (the
vermilion-moon Kyoto night walk) explore the same moon from other angles.
