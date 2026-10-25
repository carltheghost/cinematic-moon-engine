'use strict';

const PASS = 'PASS';
const FAIL = 'FAIL';
const BLOCKED = 'BLOCKED';

function number(value, digits = 2, scale = 1) {
  return Number.isFinite(value) ? (value * scale).toFixed(digits) : 'n/a';
}

function list(value) {
  return Array.isArray(value) ? value.join(',') : 'n/a';
}

function resultIsBlocked(result) {
  return !!(result && (result.policyDenied || result.skipped));
}

function add(rows, check, status, detail) {
  rows.push({ check, status, pass: status === PASS, detail: String(detail || '') });
}

function probeAvailable(result, probe) {
  return !(resultIsBlocked(result) || !probe || probe.skipped);
}

function buildPhase1ExitReport(results, gate) {
  const rows = [];
  for (const result of results || []) {
    const label = result.viewport || 'unknown viewport';
    const blocked = resultIsBlocked(result);
    const blockReason = result.policyDenial || result.error || 'probe not run';
    if (blocked) {
      add(rows, `(a) boot, zero console errors — ${label}`, BLOCKED, blockReason);
    } else {
      const passed = result.boot === true && result.consoleErrors === 0;
      const firstError = result.consoleErrorText && result.consoleErrorText[0];
      add(rows, `(a) boot, zero console errors — ${label}`, passed ? PASS : FAIL,
        `boot=${result.boot === true} errors=${Number.isFinite(result.consoleErrors) ? result.consoleErrors : 'n/a'} ` +
        `via=${result.urlKind || 'unknown'}${result.httpFallback ? ' [HTTP FALLBACK]' : ''}` +
        (firstError ? ` first: ${firstError}` : ''));
    }

    const phase1 = result.phase1 || {};
    const bloom = phase1.bloom;
    const bloomAvailable = probeAvailable(result, bloom);
    const bloomDetail = bloom && bloom.error ? bloom.error : bloom && bloom.skipped ? bloom.skipped
      : `outside/moon=${number(bloom && bloom.ratio, 3, 100)}% ` +
        `(E_in=${number(bloom && bloom.eIn, 1)} E_far=${number(bloom && bloom.eFar, 3)})`;
    add(rows, `(b) bloom isolation <2% — ${label}`,
      !bloomAvailable ? BLOCKED : bloom.pass === true ? PASS : FAIL, blocked ? blockReason : bloomDetail);

    const grade = phase1.grade;
    const gradeAvailable = probeAvailable(result, grade);
    const gradeSamples = ['black', 'midtoneGrain', 'vignette', 'moonGrain'].map((key) => {
      const sample = grade && grade[key];
      if (!sample) return `${key}: n/a`;
      const metric = key === 'vignette'
        ? `dark=${number(sample.cornerDarkening, 1, 100)}% onset=${number(sample.onset, 3)}`
        : `rms=${number(sample.rms, key === 'midtoneGrain' ? 3 : 4)}`;
      return `${key}: ${sample.pass === true ? 'PASS' : 'FAIL'}(${metric})`;
    }).join(' ');
    add(rows, `(c) grade sampling — ${label}`,
      !gradeAvailable ? BLOCKED : grade.pass === true ? PASS : FAIL,
      blocked ? blockReason : grade && grade.error ? grade.error : gradeSamples);

    const sky = phase1.sky;
    const skyAvailable = probeAvailable(result, sky);
    const skyDetail = sky && sky.error ? sky.error
      : `max=${sky ? [sky.maxR, sky.maxG, sky.maxB].map((v) => Number.isFinite(v) ? v : 'n/a').join(',') : 'n/a'} ` +
        `(ceiling 22,32,47) halo[4-8r]=${list(sky && sky.haloMax4812)} ` +
        `fogIdentity=${sky && sky.fogIdentity != null ? sky.fogIdentity : 'n/a'}`;
    add(rows, `(d) sky ≤ #16202F beyond halo, fog identity — ${label}`,
      !skyAvailable ? BLOCKED : sky.pass === true ? PASS : FAIL, blocked ? blockReason : skyDetail);

    const perf = phase1.perf;
    const perfAvailable = probeAvailable(result, perf);
    const perfDetail = perf && perf.error ? perf.error
      : `${number(perf && perf.msPerFrame, 2)} ms/frame (tier=${perf && perf.tier != null ? perf.tier : 'n/a'}, ` +
        `stars=${perf && perf.stars != null ? perf.stars : 'n/a'}) — ${perf && perf.note ? perf.note : 'n/a'}`;
    add(rows, `(e) perf proxy ≤33 ms — ${label}`,
      !perfAvailable ? BLOCKED : perf.passProxy === true ? PASS : FAIL,
      blocked ? blockReason : perfDetail);

    const determinism = result.sceneDeterminism;
    const determinismAvailable = probeAvailable(result, determinism);
    const determinismDetail = determinism && determinism.error ? determinism.error
      : `frame=${determinism && determinism.frame != null ? determinism.frame : 'n/a'} ` +
        `max luma Δ=${number(determinism && determinism.maxLumaDelta, 3)}`;
    add(rows, `(f) scene determinism (seed 7) — ${label}`,
      !determinismAvailable ? BLOCKED : determinism.pass === true ? PASS : FAIL,
      blocked ? blockReason : determinismDetail);
  }

  const gateStatus = gate && gate.pass === true ? PASS : FAIL;
  add(rows, '(g) grep gate', gateStatus,
    gate && gate.output ? gate.output.split('\n')[0] : 'grep gate produced no result');
  const allPass = rows.every((row) => row.status === PASS);
  const text = rows.map((row) => `${row.status}  ${row.check}\n      ${row.detail}`).join('\n') +
    (allPass ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED OR BLOCKED');
  return { rows, allPass, text };
}

module.exports = { buildPhase1ExitReport };
