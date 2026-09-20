#!/usr/bin/env node
/**
 * Phase 5 harness runner: serial browser launches (VM has ~4GB limit —
 * NEVER run more than 2 Chromium instances at once; this runs 1 at a time).
 *
 * Runs:
 * 0. test-tiermanager.js — Node unit tests for engine/tiermanager.js (no browser).
 * 1. checks-phase4.js on desktop (1440×900), cinematic tier, seed 7 — regression
 *    gate: the ch10/ch13 keyframe edits and ch7 lantern edit must not regress
 *    any Phase 4 check (esp. check 8, the 0.836 desktop ember hierarchy).
 * 2. checks-phase4.js on mobile (390×844), cinematic tier, seed 7 — same.
 * 3. checks-phase5.js on desktop — RM1/RM2/RM3, DISCBAND, BLOOMXFADE, TIER.
 * 4. checks-phase5.js on mobile — same + EMBER-AB (?emberfloor=0 vs =1).
 * 5. harness/grep-gate.sh (static determinism gate).
 *
 * Usage: node run-phase5.js [--seed=7]
 */
'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');

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
  console.log('=== Cinematic Moon Engine — Phase 5 harness (serial) ===\n');

  let ok = true;
  ok = run('test-tiermanager.js', []) && ok;
  ok = run('checks-phase4.js', ['--viewport=1440x900', '--tier=cinematic', `--seed=${seed}`]) && ok;
  ok = run('checks-phase4.js', ['--viewport=390x844', '--tier=cinematic', `--seed=${seed}`]) && ok;
  ok = run('checks-phase5.js', ['--viewport=1440x900', '--tier=cinematic', `--seed=${seed}`]) && ok;
  ok = run('checks-phase5.js', ['--viewport=390x844', '--tier=cinematic', `--seed=${seed}`]) && ok;

  console.log('\n=== harness/grep-gate.sh ===');
  const gate = spawnSync('bash', [path.join(__dirname, 'grep-gate.sh')], {
    stdio: 'inherit',
    cwd: __dirname,
  });
  ok = ok && gate.status === 0;

  console.log(`\n=== Phase 5 ${ok ? 'PASS' : 'FAIL'} ===`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('fatal:', e); process.exit(2); });
