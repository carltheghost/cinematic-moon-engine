# Vendor pins — Cinematic Moon Engine

**Date:** 2026-09-19 · **Policy:** vendored, not CDN (FINAL-PLAN §4).
This file is the deterministic-artifact record: given these tarballs, the
vendored tree below is reproducible byte-for-byte. Tarball sha512 values were
verified against the npm registry's published `dist.integrity` (exact match).

| Vendored file | Size (bytes) | Source tarball | Version | Tarball SHA256 | Tarball integrity (sha512) |
|---|---|---|---|---|---|
| `vendor/three/three.module.js` | 1304820 | https://registry.npmjs.org/three/-/three-0.169.0.tgz | 0.169.0 | `c86d0937570fb425d981e156ddf919c43dbc45d4e91fd7c8dd0de56723b3ec71` | `sha512-Ed906MA3dR4TS5riErd4QBsRGPcx+HBDX2O5yYE5GqJeFQTPU+M56Va/f/Oph9X7uZo3W3o4l2ZhBZ6f6qUv0w==` |
| `vendor/three/three.module.min.js` | 687458 | https://registry.npmjs.org/three/-/three-0.169.0.tgz | 0.169.0 | (same tarball) | (same tarball) |
| `vendor/three/LICENSE` | 1081 | https://registry.npmjs.org/three/-/three-0.169.0.tgz | 0.169.0 | (same tarball) | (same tarball) |
| `vendor/three/package.json` | 4373 | https://registry.npmjs.org/three/-/three-0.169.0.tgz | 0.169.0 | (same tarball) | (same tarball) |
| `vendor/postprocessing/index.js` | 618785 | https://registry.npmjs.org/postprocessing/-/postprocessing-6.36.7.tgz | 6.36.7 | `5b83552883372a87766c08649e79f3728bd5df52974e47f56c6108d93001fa13` | `sha512-X6B3xt9dy4Osv19kqnVGqV01I2Tm7VwV6rLegRIZkZJPH3ozKLypHSBK1xKx7P/Ols++OkXe6L8dBGTaDUL5aw==` |
| `vendor/postprocessing/LICENSE.md` | 858 | https://registry.npmjs.org/postprocessing/-/postprocessing-6.36.7.tgz | 6.36.7 | (same tarball) | (same tarball) |
| `vendor/postprocessing/package.json` | 3442 | https://registry.npmjs.org/postprocessing/-/postprocessing-6.36.7.tgz | 6.36.7 | (same tarball) | (same tarball) |
| `vendor/lenis/lenis.mjs` | 24144 | https://registry.npmjs.org/lenis/-/lenis-1.1.14.tgz | 1.1.14 | `1a82556f1e74776709fe0f9d04997d9530e953929b730065d2af46aeafaefefc` | `sha512-dzIeiOCdBL/7Tjh6jU8iN5j1uu5R3PIQwRYipS4C8POPyTH1pHyux3HDyvcGuLqNNsEztZjkmwfPii2cPLXBbg==` |
| `vendor/lenis/LICENSE` | 1096 | https://registry.npmjs.org/lenis/-/lenis-1.1.14.tgz | 1.1.14 | (same tarball) | (same tarball) |
| `vendor/lenis/package.json` | 2694 | https://registry.npmjs.org/lenis/-/lenis-1.1.14.tgz | 1.1.14 | (same tarball) | (same tarball) |

**Module entry points** (for the Phase 0 import-map worker):
- `three` → `vendor/three/three.module.js`
- `postprocessing` → `vendor/postprocessing/index.js` (imports bare specifier
  `"three"` internally — 78 occurrences; mapped by the import map)
- `lenis` → `vendor/lenis/lenis.mjs` (self-contained, zero external imports;
  default-exports `Lenis`)

**Deliberately absent:** GSAP (proprietary GreenSock license — excluded per
permissive-only policy; see `docs/LICENSE-VERIFICATION.md` §2).

**Deliberately excluded from the packages** (kept lean): three `examples/`,
`src/`, webgpu builds, tests, docs; postprocessing `.cjs`, types, examples,
tests; lenis react/vue/snap variants, CSS, sourcemaps, types.
