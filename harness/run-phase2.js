#!/usr/bin/env node
/**
 * Phase 2 harness runner: serial browser launches (VM has ~4GB limit).
 *
 * Runs:
 * 1. checks-phase2.js on desktop (1440×900) and mobile (390×844), cinematic tier.
 * 2. bakeoff.js (bloom A/B) on desktop.
 *
 * Usage: node run-phase2.js [--seed=7]
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
  console.log('=== Cinematic Moon Engine — Phase 2 harness (serial) ===\n');

  let ok = true;

  // Phase 2 checks on both viewports (serial — one browser at a time).
  ok = run('checks-phase2.js', [`--viewport=1440x900`, `--tier=cinematic`, `--seed=${seed}`]) && ok;
  ok = run('checks-phase2.js', [`--viewport=390x844`, `--tier=cinematic`, `--seed=${seed}`]) && ok;

  // Bloom bake-off (desktop only; mobile uses halo-only per D1).
  console.log('\n=== bakeoff.js (bloom A/B, desktop) ===');
  const bakeoff = spawnSync('node', [path.join(__dirname, 'bakeoff.js'),
    '--viewport=1440x900', `--seed=${seed}`], {
    stdio: 'inherit',
    cwd: __dirname,
  });
  // Bake-off FAIL is a valid outcome (bloom dies outside cinematic); don't fail the run.
  console.log(`\nbake-off exit: ${bakeoff.status} (0=pass, non-zero=fail — both are valid per D1)`);

  console.log(`\n=== Phase 2 ${ok ? 'PASS' : 'FAIL'} ===`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('fatal:', e); process.exit(2); });
