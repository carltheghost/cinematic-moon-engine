#!/usr/bin/env bash
# harness/grep-gate.sh — static determinism gate (FINAL-PLAN §1.4).
#
# FAILS (exit 1) if any engine/ render-path file calls:
#   Math.random() / Date.now() / performance.now()
# Engine time must come from the frame-count-derived clock (seed.js) fed by
# the host; unseeded randomness and wall-clock reads break deterministic
# render(t) and are never allowed in engine/.
#
# The HUD/harness may MEASURE with host clocks; engine/ may not.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/engine"

pattern='(Math\.random|Date\.now|performance\.now)[[:space:]]*\('

violations="$(grep -rEn --include='*.js' "$pattern" "$ENGINE" || true)"

if [ -n "$violations" ]; then
  echo "GREP GATE: FAIL — forbidden wall-clock/unseeded-random call in engine/:"
  echo "$violations"
  exit 1
fi

echo "GREP GATE: PASS — no Math.random()/Date.now()/performance.now() calls in engine/"
exit 0
