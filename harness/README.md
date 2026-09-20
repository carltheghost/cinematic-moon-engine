# Harness — Cinematic Moon Engine (Phase 0)

Conformance tooling for FINAL-PLAN §1 acceptance criteria. Vanilla, zero build step.

## Contents

| File | What it is |
|---|---|
| `grep-gate.sh` | Static determinism gate. FAILS (exit 1) if `Math.random()` / `Date.now()` / `performance.now()` appear as calls anywhere in `engine/`. |
| `conformance.js` | Browser-side probes (loaded into the page by `run.js`): `engine.screenshot()`, 5×5 px averaging, disc-to-sky contrast, palette census, grain (patch variance), vignette (corner darkening + onset), halo profile, seeded determinism fixture, and a synthetic `selfTest()`. |
| `run.js` | Node + Playwright orchestrator: boots `index.html` on desktop 1440×900 and mobile 390×844, counts console errors, waits for the tier auto-select log, runs the grep gate, the determinism smoke test (seed 7, two runs, ±1 luma), and prints a pass/fail report. |
| `out/` | Screenshots from the last run (created on demand). |

## Setup

```sh
cd harness
npm i playwright
npx playwright install chromium   # run.js auto-installs if the browser is missing
```

## Run

```sh
# from the repo root or harness/:
node harness/run.js
# exit 0 = all Phase 0 checks passed, exit 1 = a check failed, exit 2 = harness error
```

Just the static gate:

```sh
bash harness/grep-gate.sh
```

## How boot works (and why file:// needs a flag)

`index.html` is an ES-module page. Chromium treats `file://` origins as opaque,
so module imports from a `file://` page are blocked **unless** Chromium is
launched with `--allow-file-access-from-files` — `run.js` does this, so the
Phase 0 exit check "boots offline from `file://`" is exercised for real, with
no network involved.

If `file://` boot ever fails (e.g. a future Chromium change), `run.js` falls
back to a loopback static server (`python3 -m http.server` on 127.0.0.1:8931)
and marks the result `httpFallback: true` in the report. The import map uses
relative URLs, so the page is identical under both schemes.

For a human double-clicking `index.html`: most Chromium builds need
`--allow-file-access-from-files` too; any static server (`python3 -m
http.server`, `npx serve`) works without flags.

## What each check does

- **Boot + zero console errors** — waits for `window.__cmeBoot === true`
  (25 s timeout); every `console.error` and `pageerror` is counted, fail if > 0.
- **Tier auto-select** — after a 2.5 s settle (60-frame warmup), reads
  `window.__cmeTierDecision`, the exact string the TierManager logged into the HUD.
- **Grep gate** — `bash grep-gate.sh`; see above.
- **Determinism smoke** — `window.CME.fixturePixels(7)` twice in-page (built on
  the real `engine/seed.js` sfc32 stream); fails if any pixel differs by more
  than 1 luma. Phase 1+ swaps the fixture for real `render(t)` frames.
- **Conformance selfTest** — synthetic checks that the probes themselves are
  correct (avg5x5, contrast ≈ 21 for black/white, saturation extremes, census
  counting, flat-patch variance ≈ 0).

## Constraints

- Browser launches are **serialized** (desktop, then mobile, never concurrent):
  the VM has a ~4GB memory commit limit.
- `performance.now` may be used in `harness/` for measurement — never in `engine/`.
