# Harness — Cinematic Moon Engine (Phase 0)

Conformance tooling for FINAL-PLAN §1 acceptance criteria. Vanilla, zero build step.

## Contents

| File | What it is |
|---|---|
| `grep-gate.sh` | Static determinism gate. FAILS (exit 1) if `Math.random()` / `Date.now()` / `performance.now()` appear as calls anywhere in `engine/`. |
| `conformance.js` | Browser-side probes (loaded into the page by `run.js`): `engine.screenshot()`, 5×5 px averaging, disc-to-sky contrast, palette census, grain (patch variance), vignette (corner darkening + onset), halo profile, seeded determinism fixture, and a synthetic `selfTest()`. |
| `run.js` | Node + Playwright orchestrator: boots `index.html` on desktop 1440×900 and mobile 390×844, counts console errors, waits for the tier auto-select log, runs the grep gate, the determinism smoke test (seed 7, two runs, ±1 luma), and prints a pass/fail report. |
| `fallback.js` + `test-fallback.js` | Fail-closed file-navigation classification and offline/mocked checks for policy denials on both routes, viewport-stop behavior, eligible ordinary fallback, owned-server readiness, content identity, and bounded cleanup. |
| `phase1-report.js` + `test-phase1-report.js` | Structured Phase 1 `PASS`/`FAIL`/`BLOCKED` report rows and no-probe reporting regressions. |
| `replay-contract.js` + `test-replay-identity.js` | Offline checks that preserve the `cme-replay/3` `scene` string while `window.__cme.scene` remains the live `THREE.Scene`. |
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

Only a recognized ordinary unsupported-file-transport error (such as
`ERR_UNKNOWN_URL_SCHEME` or `ERR_NOT_IMPLEMENTED`) may use the loopback
fallback. Explicit administrator, security, certificate, CORS, and content
policy denials stop the run with the original error; the runner does not
switch protocols or continue to another viewport after such a denial.

The fallback is an owned Node loopback server bound directly to an OS-assigned
port. Before returning that URL to Playwright it checks the expected
`index.html` status, MIME type, and exact bytes with a bounded readiness
probe. It serves only checkout files, denies hidden paths, and has bounded
startup, probe, and shutdown lifetimes. The import map uses relative URLs, so
the page content is the same under both schemes. A fallback result is clearly
labelled as HTTP and is not evidence that file navigation was allowed.

Offline policy, server, and replay-identity regressions:

```sh
node harness/test-fallback.js
node harness/test-phase1-report.js
node harness/test-replay-identity.js
```

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
