# Art Board — Cinematic Moon Engine (signed Phase 0 art lock)

**Status:** LOCKED 2026-09-19 · blocks the Phase 2 shader contract.
**Lineage:** Grok G1 (vermilion beat map) + G3 (grain/vignette tuning), folded into
FINAL-PLAN §2/D7 and §1.3. Source of truth for every chapter keyframe: chapter
keyframes must reproduce this beat map within **ΔE ≤ 8 per keyframe** (§1.1).

> **Contract note:** palette hexes below are *starting grades* tuned against Kage
> reference frames in the Phase 6 art pass — the **NUMBERS are the contract**, not
> the swatches. If a hex and a number ever disagree, the number wins.

---

## 1. The vermilion arc — Grok-locked 5-chapter beat map (D7, verbatim)

The moon is **not** vermilion in every chapter. One `colorTemp` uniform lerps the
illuminated-disc ramp + halo tint + bloom tint per chapter keyframe; the **dark
limb stays neutral** (fixed low-value neutral / slight cool earthshine — a
stylized limb collapses the moon into a flat graphic disc). `moon.vermilionLock:
true` restores always-vermilion in one config line.

Lerp is continuous and scroll-driven (ease-in-out/cubic); steepest chroma climb
into Ch04, steepest fall into Ch05; no hard cuts. Global ceiling rule: **if the
moon ever feels louder than the lanterns in a non-hero chapter, saturation is
too high.**

| Ch | Role | Moon hue | Rule |
|---|---|---|---|
| 01 Sanmon / threshold | Rise, cold first contact | Bone-white → cool pearl, lowest saturation | Chroma near zero; never "cream" or "lavender" |
| 02 Still Gardens / approach | Ascent through mist | Soft warm amber (low) | Halo picks up a faint amber rim; disc stays mostly bone |
| 03 Sacred Craft / Lantern Light | Ember and craft beat | Warm amber → soft vermilion | Bloom tint carries the color before the disc screams |
| 04 The Vermilion Moon (hero) | Climactic reveal | **Full vermilion** | Only keyframe near Kage saturation; brightest disc area keeps value fall-off + a subtle cooler edge — never flat candy red; the moon must remain the *only* high-chroma element |
| 05 Afterlight / close | Ember-eclipse | Deep ember → muted vermilion-black | Desaturate aggressively — a dying coal, not a lingering logo |

---

## 2. Per-chapter LUT targets (post-grade hero SDR, §1.1)

| Target | Hex | Notes |
|---|---|---|
| Disc core | `#FF5A24` | hero chapter, brightest area keeps value fall-off |
| Disc mid | `#E83E12` | |
| Disc limb | `#A82E10` | limb keeps a subtle cooler edge — never flat candy red |
| Vermilion band | `#C8341A` – `#E0552B` | allowable hero ramp range |
| Sky zenith | `#04060C` | |
| Sky horizon | `#0D1524` | |
| Sky ceiling | `#16202F` | no non-moon/star sky pixel above this |
| Fog color | == `sky.horizonColor` | single source of truth (`FogExp2` matched) |
| Warm amber key | `#D99A4E` | key light |
| Cold fill | `#7FA3CC` | fill light |
| Key:fill ratio | **≥ 2.2:1** | measured on a reference card |

Moon geometry/contrast (§1.1): hero disc **28–30% of viewport height**
(ambient chapters ≤ 10%); disc-to-sky contrast **≥ 40:1**; disc mean saturation
**≥ 0.55**, frame mean **≤ 0.12** outside the moon bounding box; palette census
fails if **> 2%** of non-moon, non-lantern pixels exceed 0.55 saturation; halo
**≤ 6%** of disc-center luminance at 1.5 disc diameters.

---

## 3. Grade numbers (§1.3, Grok-tuned)

**Chain (ordering law, non-negotiable):** scene → bloom → ACES → **single** grade
pass (LUT + vignette + grain).

- **Bloom:** threshold **1.0**, smoothing **0.2**, intensity **≤ 0.9**; selectivity
  is by construction (moon > 1, threshold ≥ 1). Isolation: non-moon bloom-buffer
  energy **< 2%** of moon energy; bloom lifts sky **≤ +4 luma levels** at 5 disc
  radii. Bake-off pass/fail per D1 (Phase 2).
- **Grain:** luma-weighted (∝ 1/√luma). Midtone opacity **0.08–0.12** OLED /
  **0.10–0.14** LCD. **True zero in crushed blacks** (black-patch variance ≈ 0;
  any residual ≥ 0.02–0.03 on OLED reads as technical failure). **≤ 0.02 on the
  moon disc — non-negotiable** (> 0.03–0.04 makes the vermilion dirty).
  ≥ 0.15 midtones on OLED = digital noise. Absent line: < 0.06–0.07 (OLED) /
  < 0.08 (LCD) — kill the pass rather than leave a weak residue. Temporally
  seeded (same seed + frame = same grain); **frozen under
  `prefers-reduced-motion`**.
- **Vignette:** corners **40–48%** darkened, onset **0.60–0.64** half-diagonal;
  authored values biased to the lower end (40–45%) — match felt presence across
  displays, not absolute opacity. > 50% or onset < 0.58 = tunnel/Instagram
  filter; ≤ 30–35% or onset > 0.68 = absent (disable rather than muddy). No hard
  edge inside the central 60%.
- **Tone map:** ACES fit `x(2.51x+0.03)/(x(2.43x+0.59)+0.14)`, exposure
  **1.0 ± 0.15** per chapter; grain applied **after** tone mapping (r153+
  ordering law).

---

## 4. Sign-off

- [x] Beat map above == FINAL-PLAN §2/D7 table, verbatim (Grok G1).
- [x] LUT/grade numbers == FINAL-PLAN §1.1 / §1.2 / §1.3.
- [x] Numbers-over-swatches contract recorded.
- [ ] Phase 6 art pass: tune hexes against Kage reference frames; numbers stay fixed
      unless the art pass re-signs this board.

*Signed: Phase 0b build worker · 2026-09-19 · for the Phase 2 shader contract.*
