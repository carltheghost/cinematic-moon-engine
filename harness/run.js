#!/usr/bin/env node
/* harness/run.js — Phase 1 conformance runner (Node + Playwright).
 *
 * Exit checks (FINAL-PLAN Phase 1):
 *   (a) boots offline from file:// on desktop 1440×900 AND 390×844,
 *       zero console errors on both;
 *   (b) bloom isolation: bloom-buffer energy outside the fixture disc < 2%
 *       of moon energy (harness exits non-zero otherwise);
 *   (c) grade sampling: black-patch grain variance ≈ 0, midtone RMS 0.08–0.12,
 *       vignette 40–48% / onset 0.60–0.64, moon-mask grain ≤ 0.02;
 *   (d) sky: no sampled non-star sky pixel above #16202F; fog color is the
 *       same instance as sky.horizonColor;
 *   (e) performance: sky+stars frame time (real target ≤10 ms; headless
 *       software-renderer proxy gate ≤33 ms desktop);
 *   (f) determinism: seed 7, two ACTUAL scene render(t) runs, ±1 luma;
 *   (g) grep gate passes (no wall-clock/unseeded-random calls in engine/).
 *
 * Browser launches are SERIALIZED (one at a time — the VM has a ~4GB commit
 * limit; never run concurrent Chromium instances from this harness).
 *
 * file:// first: Chromium blocks ESM over file:// unless
 * --allow-file-access-from-files is passed, so we launch with that flag.
 * Only recognized unsupported-file-transport errors may use the owned
 * loopback fallback. Explicit administrator/security denials stop the run.
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const { runFileViewportWithFallback, runViewportSequence, startHttpServer, stopHttpServer } = require('./fallback');
const { buildPhase1ExitReport } = require('./phase1-report');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const OUT = path.join(__dirname, 'out');
const GREP_GATE = path.join(__dirname, 'grep-gate.sh');
const CONFORMANCE = path.join(__dirname, 'conformance.js');

const VIEWPORTS = [
  { name: 'desktop-1440x900', width: 1440, height: 900, isMobile: false, hasTouch: false },
  { name: 'mobile-390x844', width: 390, height: 844, isMobile: true, hasTouch: true },
];

const BOOT_TIMEOUT_MS = 25000;

function playwright() {
  try {
    return require('playwright');
  } catch (e) {
    console.error('harness: playwright npm package not found in harness/. Run:');
    console.error('  cd harness && npm i playwright && npx playwright install chromium');
    process.exit(2);
  }
}

function runGrepGate() {
  const r = spawnSync('bash', [GREP_GATE], { encoding: 'utf8' });
  const pass = r.status === 0;
  return { pass, output: (r.stdout + r.stderr).trim() };
}

function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }

async function ensureChromium(pw) {
  try {
    const b = await pw.chromium.launch({ headless: true });
    await b.close();
    return;
  } catch (e) {
    if (!/Executable doesn't exist/i.test(String(e && e.message))) throw e;
    console.log('harness: installing Playwright Chromium…');
    await new Promise((resolve, reject) => {
      const p = spawn('npx', ['playwright', 'install', 'chromium'], { cwd: __dirname, stdio: 'inherit' });
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('playwright install failed'))));
    });
  }
}

async function testViewport(pw, vp, url, viaFile) {
  const result = {
    viewport: vp.name, urlKind: viaFile ? 'file://' : 'http://127.0.0.1 (fallback)',
    boot: false, consoleErrors: -1, tierDecision: null, hudLines: 0,
    determinism: null, selfTest: null, screenshot: null, error: null,
    navigationError: null, requestFailures: [],
  };
  const browser = await pw.chromium.launch({
    headless: true,
    args: ['--allow-file-access-from-files', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile, hasTouch: vp.hasTouch,
    });
    const consoleErrors = [];
    const requestFailures = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + (e && e.message)));
    page.on('requestfailed', (request) => {
      const failure = request.failure();
      requestFailures.push(`${request.url()}: ${(failure && failure.errorText) || 'request failed'}`);
    });

    try {
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    } catch (e) {
      result.navigationError = String((e && e.message) || e).slice(0, 500);
      result.error = 'navigation failed: ' + result.navigationError.slice(0, 180);
      result.consoleErrors = consoleErrors.length;
      result.consoleErrorText = consoleErrors.slice(0, 10);
      result.requestFailures = requestFailures.slice(0, 10);
      return result;
    }
    try {
      await page.waitForFunction('window.__cmeBoot === true', null, { timeout: BOOT_TIMEOUT_MS });
      result.boot = true;
    } catch (e) {
      result.error = 'boot flag never set: ' + (await page.evaluate('window.__cmeBootError || "timeout"').catch(() => 'evaluate failed'));
    }

    // Let the 60-frame warmup finish so the tier decision is logged.
    await sleep(2500);

    result.consoleErrors = consoleErrors.length;
    result.consoleErrorText = consoleErrors.slice(0, 10);
    result.requestFailures = requestFailures.slice(0, 10);
    result.tierDecision = await page.evaluate('window.__cmeTierDecision').catch(() => null);
    result.hudLines = await page.evaluate('(window.__cmeHudLog||[]).length').catch(() => 0);
    result.hudLog = await page.evaluate('(window.__cmeHudLog||[]).slice(-8)').catch(() => []);

    // Conformance probes + self test.
    await page.addScriptTag({ path: CONFORMANCE });
    result.selfTest = await page.evaluate('window.CME.selfTest()').catch((e) => ({ pass: false, error: String(e) }));

    // Determinism smoke: seed 7, two fixture runs, ±1 luma.
    const det = await page.evaluate(`(async () => {
      const a = await window.CME.fixturePixels(7);
      const b = await window.CME.fixturePixels(7);
      let maxDelta = 0;
      for (let i = 0; i < a.length; i += 4) {
        const la = 0.2126*a[i] + 0.7152*a[i+1] + 0.0722*a[i+2];
        const lb = 0.2126*b[i] + 0.7152*b[i+1] + 0.0722*b[i+2];
        const d = Math.abs(la - lb);
        if (d > maxDelta) maxDelta = d;
      }
      return { pixels: a.length / 4, maxLumaDelta: maxDelta, pass: maxDelta <= 1 };
    })()`).catch((e) => ({ pass: false, error: String(e) }));
    result.determinism = det;

    // (f) Phase 1: determinism on the ACTUAL scene — two renderFrame(120).
    result.sceneDeterminism = await page.evaluate('window.CME.sceneDeterminism(120)')
      .catch((e) => ({ pass: false, error: String(e) }));

    // (b)–(e) Phase 1 falsifiable checks (in-page pixel math, small summaries).
    const phase1 = require('./checks-phase1.js');
    result.phase1 = await phase1.runPhase1Checks(page, vp);

    fs.mkdirSync(OUT, { recursive: true });
    const shot = path.join(OUT, `boot-${vp.name}.png`);
    try {
      await page.screenshot({ path: shot, timeout: 15000 });
      result.screenshot = shot;
    } catch (e) {
      result.screenshot = null;
      result.screenshotError = String((e && e.message) || e).slice(0, 120);
    }

    await page.close();
  } finally {
    await browser.close();
  }
  return result;
}

async function main() {
  console.log('=== Cinematic Moon Engine — Phase 1 harness ===\n');

  // (g) grep gate first — cheap, static.
  const gate = runGrepGate();
  console.log(gate.output);

  const pw = playwright();
  await ensureChromium(pw);

  const fileUrl = pathToFileURL(INDEX).href + '?seed=7';
  let httpServer = null;
  const getHttpServer = async () => {
    if (!httpServer) httpServer = await startHttpServer();
    return httpServer;
  };

  let results;
  try {
    results = await runViewportSequence(VIEWPORTS, async (vp) => {
      console.log(`\n--- ${vp.name} (${vp.width}×${vp.height}) ---`);
      return runFileViewportWithFallback({
        pw, viewport: vp, fileUrl, testViewport, getHttpServer,
      });
    }, (r) => {
      if (r.policyDenied) {
        console.error(`STOP: explicit policy/security denial; no later navigation will be attempted: ${r.policyDenial}`);
      } else if (r.httpFallback) {
        console.log(`ordinary unsupported file loading (${r.fallbackReason}); used verified loopback fallback`);
      } else if (!r.boot && r.fallbackAttempted === false) {
        console.log(`no loopback fallback: ${r.fallbackSkippedReason || r.error || 'failure was not an approved file-transport limitation'}`);
      }
      console.log(`boot: ${r.boot ? 'PASS' : 'FAIL'}  console errors: ${r.consoleErrors}`);
      console.log(`tier decision: ${r.tierDecision ? 'LOGGED — ' + r.tierDecision : 'MISSING'}`);
      console.log(`determinism(seed 7): ${r.determinism && r.determinism.pass ? 'PASS' : 'FAIL'} ` +
        `(max luma Δ=${r.determinism && r.determinism.maxLumaDelta != null ? r.determinism.maxLumaDelta.toFixed(3) : 'n/a'})`);
      console.log(`scene determinism: ${r.sceneDeterminism && r.sceneDeterminism.pass ? 'PASS' : 'FAIL'} ` +
        `(max luma Δ=${r.sceneDeterminism && r.sceneDeterminism.maxLumaDelta != null ? r.sceneDeterminism.maxLumaDelta.toFixed(3) : 'n/a'})`);
      if (r.phase1) {
        const p = r.phase1;
        console.log(`bloom isolation: ${p.bloom && p.bloom.pass ? 'PASS' : 'FAIL'} ` +
          `(outside/moon=${p.bloom && p.bloom.ratio != null ? (p.bloom.ratio * 100).toFixed(3) + '%' : 'n/a'})`);
        console.log(`grade sampling: ${p.grade && p.grade.pass ? 'PASS' : 'FAIL'}`);
        console.log(`sky ceiling: ${p.sky && p.sky.pass ? 'PASS' : 'FAIL'} ` +
          `(max=${p.sky ? p.sky.maxR + ',' + p.sky.maxG + ',' + p.sky.maxB : 'n/a'} fogIdentity=${p.sky && p.sky.fogIdentity})`);
        console.log(`perf: ${p.perf && Number.isFinite(p.perf.msPerFrame) ? p.perf.msPerFrame.toFixed(2) + ' ms/frame' : 'n/a'} (proxy gate ≤33 ms)`);
      }
      console.log(`conformance selfTest: ${r.selfTest && r.selfTest.pass ? 'PASS' : 'FAIL'}`);
    });
  } finally {
    await stopHttpServer(httpServer);
  }

  // ---- report ----
  console.log('\n=== PHASE 1 EXIT REPORT ===');
  const exitReport = buildPhase1ExitReport(results, gate);
  console.log(exitReport.text);
  process.exit(exitReport.allPass ? 0 : 1);
}

main().catch((e) => { console.error('harness fatal:', e); process.exit(2); });
