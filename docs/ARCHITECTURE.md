# Architecture — module map (one page)

Full spec: `~/workspace/research_notes/moon-engine-plan/FINAL-PLAN.md` (§2, §3).
Signed art lock: `docs/art-board.md`. Vendored pins: `vendor/VENDOR.md`.

## Dependency order (acyclic — no back-channels)

```
Seed → Sky → { Moon, Stars } → Environment → Post → Camera
```

Each module consumes only what the previous layer hands it. Chapters (Camera)
drive downstream modules through **explicit inputs only**:

| Driver (chapter keyframe) | Target module input |
|---|---|
| `moonScale`, `colorTemp`, palette | `moon.*` |
| `fogDensity` | `sky.fogDensity` |
| `lut` | `post.setGrade(lut)` |
| scroll `p` → `t = scrubCurve(p)` | `camera.evaluate(scrollY)` (pure) |

## Module inputs at a glance

- **Seed** (`engine/seed.js`) — in: `{ seed, tier, dprCap, fps, watchdog, warmup }`.
  Out: sfc32 `Rng` streams, `FrameClock` (frame-count-derived `t`), `TIERS` /
  `TIER_TABLE`, `WATCHDOG`, `validateConfig()`. Owns no rendering.
- **Sky** (`engine/sky.js`) — in: `Rng`, `scatteringBackend`. Out: gradient dome,
  `horizonColor` (single source of truth for `FogExp2`).
- **Moon** (`engine/moon.js`) — in: `Rng`, `colorTemp`, `moonScale`. Out: sphere
  mesh (+ disc fallback), HDR emissive material, 2 halo sprites.
- **Stars** (`engine/stars.js`) — in: `Rng`, tier star count. Out: `THREE.Points`
  catalog (8k/4k/2k), seeded twinkle phases.
- **Environment** (`engine/environment.js`) — in: `Rng`, `sky.horizonColor`,
  moon azimuth. Out: terrain, instanced scatter, embers, glint water, light rig.
- **Post** (`engine/post.js`) — in: tier quality, chapter LUT. Out: composer
  chain **scene → bloom → ACES → grade(LUT+vignette+grain)**; `setGrade`,
  `setQuality`. Pass-order invariant enforced in code (Phase 1).
- **Camera** (`engine/camera.js`) — in: chapter schema, scroll `p`. Out: pure
  `evaluate(scrollY)` → canonical camera state; presentation FX additive-only.

## Standing laws

- Determinism: identical (seed, config, tier, `t`) → pixel-identical ±1 luma,
  same device. No `Math.random` / `Date.now` / `performance.now` in `engine/`
  (static gate: `bash harness/grep-gate.sh`).
- Time is frame-count-derived; the rAF timestamp is fed in by the host.
- DPR ≤ 1.5 everywhere. Watchdog: rolling p95 > 20 ms × 120 frames → one tier
  down, one-way per session, logged.
- Vanilla ES modules, import-mapped to `vendor/`, zero build step,
  `file://`-capable, permissive licenses only.
- Regression philosophy: **one mechanism** — fix production geometry, never
  harness compensation; each check asserts the original mechanism
  (`docs/regression-philosophy.md`, frozen Phase 6).
- Replay contract: a record's identity is
  (seed, viewport, resolvedTier, reducedMotion, canonicalScrollT); auto mode
  is never part of the identity; "viewport" = CSS dims + devicePixelRatio at
  boot; the seeded moon bake is pinned to 2048² at record AND compare time
  (`?bakeRes=`, format `cme-replay/3`) because the production wall-clock
  bake-budget fallback (2048²→1024²) is load-dependent and would otherwise
  make desktop replay a coin flip (`harness/replay.js`).
- Scene extension (Phase 7): second scenes are explicit config through
  injection points / registration (`engine/scene.js`, `?scene=`), never a
  second implementation path; canonical defaults stay byte-identical
  (`docs/scene-extension.md`).
