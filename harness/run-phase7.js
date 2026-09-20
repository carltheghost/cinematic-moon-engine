#!/usr/bin/env node
/**
 * Phase 7 harness runner: serial browser launches (VM has ~4GB limit —
 * NEVER run more than 2 Chromium instances at once; this runs 1 at a time).
 *
 * Runs:
 * 1. replay.js compare-corpus — 12-record canonical corpus (ch1/ch10/ch13 ×
 *    desktop/mobile × RM off/on), format cme-replay/3 with viewport.dpr,
 *    scene, clock, and bakeRes=2048 (bake pin — the wall-clock budget
 *    fallback is disabled at record AND compare time, so desktop is no
 *    longer a coin flip):
 *    pixel-identical replay (maxDelta=0), resolved-tier match, DPR match,
 *    bake-resolution match.
 *    (Seed the corpus once with `node harness/replay.js record-corpus`;
 *    compare never re-records — re-recording inside the runner would make
 *    the gate vacuous. The Phase 7 corpus was re-recorded because the
 *    record schema changed (DPR identity); the pixels are asserted against
 *    the pre-Phase-7 fixtures inside checks-phase7 P71, not just against
 *    the re-record.)
 * 2. checks-phase7.js on desktop (1440×900) — canonical regression through
 *    the new seams, color-script/clock/locator injection, DPR identity,
 *    auto-tier advisory, ?scene=eclipse-act.
 * 3. checks-phase7.js on mobile (390×844) — same.
 * 4. checks-phase6.js on desktop + mobile (boundary + env-scatter).
 * 5. checks-phase5.js on desktop + mobile (regression).
 * 6. probe-eclipse.js on desktop + mobile (ported second-scene driver).
 * 7. harness/grep-gate.sh (static determinism gate).
 *
 * Usage: node run-phase7.js [--seed=7]
 */
'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

function parseArgs() {
  const args = { seed: '7' };
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

function run(script, args) {
  console.log(`\n=== ${script} ${args.join(' ')} ===`);
  const r = spawnSync('node', [path.join(__dirname, script), ...args], {
    stdio: 'inherit',
    cwd: __dirname,
  });
  return r.status === 0;
}

async function main() {
  const { seed } = parseArgs();
  console.log('=== Cinematic Moon Engine — Phase 7 harness (serial) ===\n');

  const recordsDir = path.join(__dirname, 'replay-records');
  const records = fs.existsSync(recordsDir)
    ? fs.readdirSync(recordsDir).filter((f) => f.endsWith('.json')) : [];
  if (records.length === 0) {
    console.error('FAIL: no replay records found. Seed the corpus once with:');
    console.error('  node harness/replay.js record-corpus --seed=7');
    process.exit(1);
  }

  let ok = true;
  ok = run('replay.js', ['compare-corpus', `--seed=${seed}`]) && ok;
  ok = run('checks-phase7.js', ['--viewport=1440x900', `--seed=${seed}`]) && ok;
  ok = run('checks-phase7.js', ['--viewport=390x844', `--seed=${seed}`]) && ok;
  ok = run('checks-phase6.js', ['--viewport=1440x900', `--seed=${seed}`]) && ok;
  ok = run('checks-phase6.js', ['--viewport=390x844', `--seed=${seed}`]) && ok;
  ok = run('checks-phase5.js', ['--viewport=1440x900', '--tier=cinematic', `--seed=${seed}`]) && ok;
  ok = run('checks-phase5.js', ['--viewport=390x844', '--tier=cinematic', `--seed=${seed}`]) && ok;
  ok = run('probe-eclipse.js', ['--viewport=1440x900', `--seed=${seed}`]) && ok;
  ok = run('probe-eclipse.js', ['--viewport=390x844', `--seed=${seed}`]) && ok;

  console.log('\n=== harness/grep-gate.sh ===');
  const gate = spawnSync('bash', [path.join(__dirname, 'grep-gate.sh')], {
    stdio: 'inherit',
    cwd: __dirname,
  });
  ok = ok && gate.status === 0;

  console.log(`\n=== Phase 7 ${ok ? 'PASS' : 'FAIL'} ===`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('fatal:', e); process.exit(2); });
