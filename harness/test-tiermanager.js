#!/usr/bin/env node
/**
 * harness/test-tiermanager.js — Node unit tests for engine/tiermanager.js
 * (pure tier-selection + watchdog logic). No browser needed.
 * Exits 0 iff all pass.
 */
'use strict';
const path = require('node:path');

async function main() {
  const tm = await import(path.join(__dirname, '..', 'engine', 'tiermanager.js'));
  const { resolveTier, selectTierFromWarmup, stepDown, createWatchdog, bloomProbeDecision } = tm;
  let pass = 0, fail = 0;
  const eq = (a, b, name) => {
    const ok = JSON.stringify(a) === JSON.stringify(b);
    if (ok) pass++; else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
  };

  // resolveTier precedence
  eq(resolveTier({ tierParam: 'cinematic', reducedMotion: true }).tier, 'still', 'rm forces still tier');
  eq(resolveTier({ tierParam: 'cinematic', reducedMotion: true }).mode, 'forced-still', 'rm forced-still mode');
  eq(resolveTier({ tierParam: 'balanced', reducedMotion: false }).mode, 'manual', '?tier= → manual');
  eq(resolveTier({ tierParam: 'balanced', reducedMotion: false }).tier, 'balanced', '?tier=balanced honored');
  eq(resolveTier({ tierParam: 'still', reducedMotion: false }).tier, 'still', '?tier=still honored (bypasses auto-select)');
  eq(resolveTier({ tierParam: null, reducedMotion: false }).mode, 'auto', 'no override → auto');
  eq(resolveTier({ tierParam: 'bogus', reducedMotion: false }).mode, 'auto', 'bogus tier → auto fallback');

  // warmup thresholds (WARMUP: ≥55 cinematic, ≥35 balanced, else efficient)
  eq([selectTierFromWarmup(60), selectTierFromWarmup(55), selectTierFromWarmup(54.9),
      selectTierFromWarmup(35), selectTierFromWarmup(34.9), selectTierFromWarmup(0)],
     ['cinematic', 'cinematic', 'balanced', 'balanced', 'efficient', 'efficient'],
     'warmup fps thresholds');

  // step-down ladder
  eq([stepDown('cinematic'), stepDown('balanced'), stepDown('efficient'), stepDown('still')],
     ['balanced', 'efficient', 'still', 'still'], 'one-way step-down ladder');

  // watchdog: trips at 120th consecutive slow evaluation
  {
    const w = createWatchdog();
    let tripAt = -1;
    for (let i = 0; i < 300; i++) { if (w.observe(25)) { tripAt = i; break; } }
    eq(tripAt, 119, 'watchdog trips at 120th slow evaluation');
    eq(w.observe(25), false, 'watchdog one-way latch (inert after trip)');
    eq(w.tripped, true, 'watchdog tripped flag');
  }
  // watchdog: sustained smooth never trips
  {
    const w = createWatchdog();
    for (let i = 0; i < 300; i++) w.observe(10);
    eq(w.tripped, false, 'sustained smooth never trips');
  }
  // watchdog: outlier-robust (a few slow frames among good ones don't trip)
  {
    const w = createWatchdog();
    for (let i = 0; i < 300; i++) w.observe(i % 30 === 0 ? 25 : 10);
    eq(w.tripped, false, 'scattered slow frames do not trip');
  }

  // bloom probe: two gates; visual gate closed → always false
  eq(bloomProbeDecision({ probeFps: 60, tier: 'balanced' }), false, 'bloom probe: visual gate closed → false');
  eq(bloomProbeDecision({ probeFps: 20, tier: 'balanced' }), false, 'bloom probe: low fps → false');
  eq(bloomProbeDecision({ probeFps: 60, tier: 'cinematic' }), false, 'bloom probe: balanced-only');

  console.log(`tiermanager unit tests: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('fatal:', e); process.exit(2); });
