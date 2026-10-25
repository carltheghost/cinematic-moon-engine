#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { buildPhase1ExitReport } = require('./phase1-report');
const { runViewportSequence } = require('./fallback');

let checks = 0;
function equal(actual, expected, message) { checks++; assert.equal(actual, expected, message); }
function ok(value, message) { checks++; assert.ok(value, message); }

async function testDeniedNoProbeReportEndToEnd() {
  const navigated = [];
  const viewports = [{ name: 'desktop' }, { name: 'mobile' }];
  const results = await runViewportSequence(viewports, async (viewport) => {
    navigated.push(viewport.name);
    return {
      viewport: viewport.name,
      boot: true,
      consoleErrors: 0,
      policyDenied: true,
      policyDenial: 'net::ERR_BLOCKED_BY_ADMINISTRATOR',
    };
  });
  const report = buildPhase1ExitReport(results, { pass: true, output: 'GREP GATE: PASS' });

  equal(navigated.length, 1, 'denied viewport sequence makes no later navigation');
  equal(results[1].skipped, true, 'later viewport is retained as an explicit skipped record');
  equal(report.rows.length, 13, 'report contains six checks per viewport and the independent grep gate');
  equal(report.rows[0].status, 'BLOCKED', 'contradictory boot flag does not pass a policy-denied boot row');
  equal(report.rows[1].status, 'BLOCKED', 'unrun bloom probe is reported as blocked');
  equal(report.rows[4].status, 'BLOCKED', 'unrun performance probe is reported as blocked');
  equal(report.rows[6].status, 'BLOCKED', 'skipped viewport boot row is reported as blocked');
  equal(report.rows[12].status, 'PASS', 'independent grep gate remains reported');
  equal(report.allPass, false, 'blocked rows cannot produce an all-passed report');
  ok(report.text.includes('BLOCKED  (a) boot'), 'rendered report clearly labels blocked checks');
  ok(report.text.includes('ERR_BLOCKED_BY_ADMINISTRATOR'), 'rendered report retains the denial evidence');
  ok(!/\b(?:NaN|undefined)\b/.test(report.text), 'blocked report contains no invalid metrics or placeholders');
}

function testFailedBootWithoutProbes() {
  const report = buildPhase1ExitReport([{
    viewport: 'desktop',
    urlKind: 'file://',
    boot: false,
    consoleErrors: 0,
    error: 'boot flag never set: timeout',
  }], { pass: true, output: 'GREP GATE: PASS' });

  equal(report.rows[0].status, 'FAIL', 'ordinary boot failure remains a failed check');
  equal(report.rows[1].status, 'BLOCKED', 'probe omitted after failed boot is reported as blocked');
  equal(report.rows[4].status, 'BLOCKED', 'missing performance metrics do not dereference undefined');
  equal(report.allPass, false, 'failed and blocked checks fail the report');
  ok(!/\b(?:NaN|undefined)\b/.test(report.text), 'failed no-probe report stays well-formed');
}

(async () => {
  await testDeniedNoProbeReportEndToEnd();
  testFailedBootWithoutProbes();
  console.log(`Phase 1 blocked/failed report offline tests: ${checks} passed`);
})().catch((error) => { console.error(error); process.exit(1); });
