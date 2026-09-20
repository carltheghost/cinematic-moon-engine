# Regression Philosophy — "one mechanism" (standing rule, Phase 6)

Frozen by the Phase 5 merged ruling (item E). This is a standing law, not a
suggestion.

## The rule

**Fix production geometry when production geometry is wrong; never make the
harness compensate.** Each check asserts the original mechanism. When a check
fails, the first suspect is the engine; the harness is the last thing we
change, and only when the check itself was mis-specified against the signed
contract.

Concretely:

1. A check that needs a special case, fallback path, tolerance widening, or
   fixture-specific branch to pass is a **failed check wearing a pass
   costume**. Revert the compensation and fix the engine, or get the contract
   amended by review (GPT/Grok) — never by the builder alone.
2. One mechanism, not two: if a fix introduces a second code path that does
   what the first path should have done (a fallback, a variant, an override
   flag), delete one of them. Two mechanisms drift apart; the harness will
   happily green both while production rots.
3. Non-canonical experiment hooks (`?emberfloor=1`, `?tier=`, `?autoplay=1`)
   are allowed **only** when they are explicit, documented, default-off, and
   excluded from the canonical conformance identity. A hook that silently
   changes canonical pixels is a second mechanism.
4. The replay contract is the enforcement arm: a record's identity is
   (seed, viewport, resolvedTier, reducedMotion, canonicalScrollT). Any engine
   change that moves a pixel moves a replay hash — that is the intended
   tripwire, not noise to be absorbed by re-recording.

## Precedents (why this is frozen)

- **fov 48 over 46 (Phase 5):** the builder's verified state used ch10 fov 46
  plus a moon-occlusion fallback *in the harness* (checks-phase4.js check 2)
  because at fov 46 the far ridge targets fell inside the moon disc — a
  geometry artifact, not a fog defect. The fallback made the check pass while
  hiding the artifact. Resolution: ship fov 48 (the geometry that passes the
  ridge gate in its original form), revert the fallback. Exactly one
  mechanism; the diagnostic scripts were left untracked and their backups
  deleted.
- **Ember floor A/B (Phase 5):** the `?emberfloor=1` floor was a measured
  no-op (ratio 0.006→0.006, chromaSep 2.503→2.503, draw calls 29→29 — no
  metric and no pixel that matters moved). Conditions (a)(b)(c) technically
  held, but the floor's *purpose* (GPT Q6 "restrained + perceptible") failed.
  Resolution: ship the Grok variant (floor OFF), keep the flag only as a
  documented experiment hook. The check asserted the original mechanism; the
  no-op was not promoted to canonical.

## For future builders

If you are about to add a tolerance, a fallback, or a special case to a
harness check: stop. Write down which production value is wrong and fix that
instead. If you believe the check (not the engine) is wrong, bring the
numbers to review — the ruling that amends a check is a review verdict, not
a builder edit.
