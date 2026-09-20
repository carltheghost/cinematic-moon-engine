#!/usr/bin/env node
/**
 * Phase 4 harness runner: serial browser launches (VM has ~4GB limit —
 * NEVER run more than 2 Chromium instances at once; this runs 1 at a time).
 *
 * Runs:
 * 1. checks-phase4.js on desktop (1440×900), cinematic tier, seed 7.
 * 2. checks-phase4.js on mobile (390×844), cinematic tier, seed 7.
 * 3. harness/grep-gate.sh (static determinism gate).
 * 4. On success: captures /tmp/phase4-ch10-desktop.png and
 *    /tmp/phase4-ch01-mobile.png review screenshots.
 *
 * Usage: node run-phase4.js [--seed=7]
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
  console.log('=== Cinematic Moon Engine — Phase 4 harness (serial) ===\n');

  let ok = true;
  ok = run('checks-phase4.js', ['--viewport=1440x900', '--tier=cinematic', `--seed=${seed}`]) && ok;
  ok = run('checks-phase4.js', ['--viewport=390x844', '--tier=cinematic', `--seed=${seed}`]) && ok;

  console.log('\n=== harness/grep-gate.sh ===');
  const gate = spawnSync('bash', [path.join(__dirname, 'grep-gate.sh')], {
    stdio: 'inherit',
    cwd: __dirname,
  });
  ok = ok && gate.status === 0;

  if (ok) {
    console.log('\n=== review screenshots ===');
    ok = run('shot-phase4.js', [`--seed=${seed}`]) && ok;
  }

  console.log(`\n=== Phase 4 ${ok ? 'PASS' : 'FAIL'} ===`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('fatal:', e); process.exit(2); });
