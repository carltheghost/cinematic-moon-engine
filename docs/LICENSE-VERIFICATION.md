# License Verification Log — Cinematic Moon Engine, Phase 0

**Date:** 2026-09-19 · **Verifier:** Phase 0a worker (Muse Spark)
**Policy:** permissive-licensed code only (MIT / BSD / Zlib). Anything proprietary or
copyleft is rejected from `vendor/`.

All three packages were fetched with `npm pack <name>@<version>` from the npm
registry, then extracted and reduced to the lean file set in `vendor/`. The sha512 of
each downloaded tarball was computed locally and compared against the registry's
published `dist.integrity`; all three match exactly (see §1 per package).

## 1. Vendored packages — verdicts

### three@0.169.0 — PASS (MIT)
- **Version:** 0.169.0 (the spec's "r169")
- **Registry tarball:** https://registry.npmjs.org/three/-/three-0.169.0.tgz
- **License in package:** `package.json` `"license": "MIT"`; bundled license file
  `LICENSE` (first line: "The MIT License", © 2010-2024 three.js authors) —
  vendored at `vendor/three/LICENSE`.
- **Tarball SHA256:** `c86d0937570fb425d981e156ddf919c43dbc45d4e91fd7c8dd0de56723b3ec71`
- **Registry integrity (sha512, verified match):**
  `sha512-Ed906MA3dR4TS5riErd4QBsRGPcx+HBDX2O5yYE5GqJeFQTPU+M56Va/f/Oph9X7uZo3W3o4l2ZhBZ6f6qUv0w==`
- **Vendored files:** `build/three.module.js`, `build/three.module.min.js`,
  `LICENSE`, `package.json`. No `examples/`, no `src/`, no tests, no docs.
- **Sanity check:** `node --check` passes on both module files; `WebGLRenderer`
  present in `three.module.js`. ESM entry `three.module.js` is the import target.

### postprocessing@6.36.7 — PASS (Zlib, MIT-compatible permissive)
- **Version:** 6.36.7 (the spec's "pmndrs/postprocessing v6.36.x")
- **Registry tarball:** https://registry.npmjs.org/postprocessing/-/postprocessing-6.36.7.tgz
- **License in package:** `package.json` `"license": "Zlib"`; bundled license file
  `LICENSE.md` (standard Zlib/libpng text — "Permission is granted to anyone to
  use this software for any purpose, including commercial applications, and to
  alter it and redistribute it freely..."; © 2015 Raoul van Rüschen) —
  vendored at `vendor/postprocessing/LICENSE.md`. The bundle header itself also
  carries `@license Zlib`.
- **Tarball SHA256:** `5b83552883372a87766c08649e79f3728bd5df52974e47f56c6108d93001fa13`
- **Registry integrity (sha512, verified match):**
  `sha512-X6B3xt9dy4Osv19kqnVGqV01I2Tm7VwV6rLegRIZkZJPH3ozKLypHSBK1xKx7P/Ols++OkXe6L8dBGTaDUL5aw==`
- **Vendored files:** `build/index.js` (single-file ESM bundle, `export { ... }`
  block at line 15548), `LICENSE.md`, `package.json`. No `.cjs`, no types, no
  examples, no tests.
- **Sanity check:** `node --check` passes; `BloomEffect` and `SelectiveBloomEffect`
  both present in the export list (line 15553/15657). The bundle imports `three`
  via bare specifier — mapped by the import map (Phase 0 import-map worker's
  scope), no other external dependency.

### lenis@1.1.14 — PASS (MIT)
- **Version:** 1.1.14
- **Registry tarball:** https://registry.npmjs.org/lenis/-/lenis-1.1.14.tgz
- **License in package:** `package.json` `"license": "MIT"`; bundled license file
  `LICENSE` (first line: "The MIT License", © 2024 darkroom.engineering) —
  vendored at `vendor/lenis/LICENSE`.
- **Tarball SHA256:** `1a82556f1e74776709fe0f9d04997d9530e953929b730065d2af46aeafaefefc`
- **Registry integrity (sha512, verified match):**
  `sha512-dzIeiOCdBL/7Tjh6jU8iN5j1uu5R3PIQwRYipS4C8POPyTH1pHyux3HDyvcGuLqNNsEztZjkmwfPii2cPLXBbg==`
- **Vendored files:** `dist/lenis.mjs` (single-file ESM bundle, `export { Lenis
  as default }`), `LICENSE`, `package.json`. No `lenis-react`, no `lenis-vue`,
  no snap variants, no CSS, no maps, no types.
- **Sanity check:** `node --check` passes; `Lenis` default-exported. Zero external
  imports — fully self-contained.

## 2. GSAP — deliberately NOT vendored
- **Decision:** GSAP 3.12.5 is distributed under GreenSock's proprietary "Standard
  no charge" license (not MIT/BSD/Zlib), so it fails the permissive-only policy
  and was intentionally excluded from `vendor/`.
- **Plan compliance:** FINAL-PLAN §6 Phase 0 exit check explicitly permits this
  alternative — "(or GSAP dropped to manual-driver)". Scroll will use Lenis
  standalone with its own RAF loop plus a manual driver (Phase 4 `manual` driver
  for deterministic `render(t)`); there is no `gsap.ticker` dependency anywhere
  in the engine.
- **Consequence:** no GSAP code, files, or references exist in this repo.

## 3. Deferred license verifications (later phases, per FINAL-PLAN §3 / §6)
- **jeantimex/precomputed_atmospheric_scattering** (Bruneton source): verify license
  BEFORE any Phase 6 stretch work; Bruneton stays a plugin regardless of outcome.
- **galaxy-explorer ≤ v2.2.0 only** (MIT): never touch current PolyForm
  (Noncommercial) code — enforce by version pin if it is ever referenced.
- **Kage:** reference-only. Nothing copied, ever (see ATTRIBUTION.md §3).
- Any new dependency introduced in a later phase must be added to this log with
  the same four fields (version, license evidence, SHA256, registry URL) before
  it is used.
