# Physical-Device QA Protocol — Cinematic Moon Engine

**Status:** hardware validation gate (merged ruling Phase 5, item 6). Phase 6
prepares everything; the actual runs happen on the user's real devices.
**VM SwiftShader numbers are not device evidence** — never quote them as FPS
results. SwiftShader is a software rasterizer; it cannot establish the 60 FPS
desktop / ≥45 FPS mobile targets, warmup representativeness, or watchdog p95
behavior under real mobile scheduling and GPU contention.

## 1. Devices required

| Slot | Device | Why |
|---|---|---|
| A | One real desktop GPU (any discrete or recent integrated GPU, real browser) | Establishes the 60 FPS `cinematic` target and the 60-frame warmup's honesty on desktop silicon |
| B | One real mid-range phone (e.g. 3–5 year-old Android or iPhone) | Establishes the ≥45 FPS `balanced` target, watchdog behavior under real mobile scheduling/GPU contention |

Emulators, VMs, and SwiftShader/llvmpipe runs do not fill either slot.

## 2. What to open

Serve the repo root over loopback (or any static host) and open, per device:

- `index.html?seed=7&tier=cinematic&benchmark=1` — explicit tier, benchmark on
- `index.html?seed=7&tier=balanced&benchmark=1` — phone slot: the balanced tier
- `index.html?seed=7` — auto mode: the warmup benchmark selects the tier itself

`?benchmark=1` is host-side only: it counts 240 post-warmup frames with
`performance.now()` and logs FPS + mean/p95 frame time to the console. It does
not alter a single rendered pixel. For clean numbers use an explicit `?tier=`
so the watchdog cannot step down mid-run.

## 3. Warmup benchmark — how to read it

On boot (auto mode) the host renders 60 real frames behind the loader, then
selects the tier:

- ≥55 fps → `cinematic` · ≥35 fps → `balanced` · else `efficient`

Console lines to capture (every `[cme]` line, in order):

```
[cme] tier: cinematic (mode=auto) — no override: boot at cinematic, 60-frame warmup benchmark selects the honest tier
[cme] bake: 2048² in 812 ms (budget 1500 ms) hashAlbedo=… hashNormal=… craters=…
[cme] env: terrain+water+scatter built (seed=7 tier=cinematic trees=240 rocks=150 lanterns=26 embers=420 layout=… lightRatio=…)
[cme] warmup: 58.3 fps over 60 frames → cinematic (thresholds ≥55 cinematic / ≥35 balanced)
```

**Interpretation:** the warmup is representative iff the device was thermally
idle and no other tab/app was contending. If the warmup lands a tier that the
`?benchmark=1` sustained run cannot hold (e.g. warmup picks `cinematic` but
sustained is 42 fps), record both numbers — that gap is exactly what the
watchdog exists to close.

## 4. Watchdog p95 behavior under real contention

The watchdog (engine/tiermanager.js, pure; wall-clock fed by the host) trips
when the **rolling p95 frame time exceeds 20 ms for 120 consecutive frames**,
then steps down **one tier, one-way per session** (never oscillates; step-up
only via `?tier=` or reload). It is armed in auto mode only.

On the phone (auto mode, no `?tier=`):

1. Load the page, let it settle 10 s at the top of the scroll.
2. Fling-scroll through all 13 chapters twice at speed.
3. Background/foreground two other apps once (real mobile scheduling noise).
4. Watch the console for `tier: X → Y (watchdog: rolling p95 frame > 20ms for 120 consecutive frames)`.

**Healthy behavior:** zero or one step-down per session; the step-down line
appears in the log; no oscillation (it cannot oscillate — the latch is
one-way; if you see repeated step-downs, file it as a defect).
**Unhealthy:** a step-down during gentle use on a flagship-class phone, or the
page staying on `cinematic` while frames visibly stutter for minutes.

## 5. Absolute targets

| Tier | Target | Where it must hold |
|---|---|---|
| `cinematic` (desktop GPU) | **60 fps sustained**, p95 frame ≤ 16.7 ms | Slot A, `?tier=cinematic&benchmark=1` |
| `balanced` (mid phone) | **≥45 fps sustained** | Slot B, `?tier=balanced&benchmark=1` |
| `efficient` (low-end) | **≥55 fps sustained** | Whichever device the warmup selects it on |
| scroll | no long tasks > 50 ms during scroll | Phone slot, fling test |

These are FINAL-PLAN §1.4. A miss is a hardware-validation finding, not a code
defect — file it with the numbers (see §7).

## 6. What to capture per run

1. **Console log** — the full `[cme]` sequence (copy from DevTools / `chrome://inspect` / Safari Web Inspector).
2. **Benchmark line** — `[cme] benchmark: 58.3 fps mean=17.15ms p95=18.02ms over 240 frames (tier=cinematic)`, plus `window.__cmeBenchmark` if you want the object.
3. **Tier decision** — the `warmup:` line and any `tier: X → Y` lines.
4. **Screenshots** — ch10 (hero) and ch13, one per tier under test.
5. **Console errors** — must be zero; any `console.error` or page error is a hard FAIL regardless of FPS.
6. **Visual sanity** — moon disc crisp, grain invisible unless you look for it, no bloom smearing on the phone (balanced is halo-only by the Phase 2 rule).

## 7. How to file results back

Paste into the chat (or a note) per device:

```
Device: <model> · OS: <version> · Browser: <name version>
Mode: ?seed=7&tier=<tier>&benchmark=1   (or auto)
Warmup: <the warmup: line, or n/a (manual tier)>
Benchmark: <fps> fps, mean <x>ms, p95 <y>ms over 240 frames
Watchdog: <tripped X→Y / never tripped> under <gentle use / fling / app-switch>
Console errors: <0 / list>
Screenshots: <attached: ch10, ch13>
Verdict: <PASS ≥target / MISS by N fps>
```

## 8. Explicit non-goals

- Do not "fix" a miss by changing tier thresholds on the device run — thresholds
  are frozen engine constants; a miss is data for the Phase 7 tuning pass.
- Do not compare SwiftShader numbers against the targets above; they are not
  commensurable (software rasterizer vs tile GPU).
- The `?benchmark=1` loop is not a stress test — it measures the honest steady
  state. Contention behavior is measured separately (§4).
