#!/usr/bin/env node
/**
 * Phase 2 bloom bake-off: blind A/B on the locked canonical hero frame.
 *
 * Fixture: Ch4 vermilion moon + haze band crossing lower limb + 3 lanterns.
 * A = bloom on (real HDR BloomEffect). B = halo-only (bloom intensity 0).
 *
 * Pass criteria (Grok D1):
 * - Limb gradient reduction ≥ 20% (bloom softens the limb into haze).
 * - Adjacent-fog luma×chroma rise ≥ 10% (fog looks illuminated).
 * - Terminator width supporting evidence (measured).
 * - Timing: frame-delta proxy (timer query not available headless).
 *
 * If A fails to beat B on the metrics, bloom dies outside cinematic (per D1).
 * Both outcomes are successes; the decision is recorded in docs/build-log.md.
 *
 * Usage: node bakeoff.js [--viewport=1440x900] [--seed=7]
 */
'use strict';
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const pw = require('playwright');

function parseArgs() {
  const args = { viewport: '1440x900', seed: '7' };
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  const [w, h] = args.viewport.split('x').map(Number);
  return { ...args, w, h };
}

const EVAL_SETUP = `
(async () => {
  const cme = window.__cme;
  const mod = await import('./harness/fixture-bakeoff.js?cb=' + Date.now());
  const handle = mod.installBakeoffFixture(cme, 7);
  window.__bakeoff = handle;
  return 'fixture installed';
})()
`;

const EVAL_RENDER = `
((bloomOn) => {
  const cme = window.__cme;
  // Toggle bloom by finding the BloomEffect in the composer passes.
  // (setBloomExact may not be available if the browser cached an old post.js)
  const composer = cme.post.composer;
  for (const pass of composer.passes) {
    if (pass.effects) {
      for (const eff of pass.effects) {
        if (eff.constructor.name === 'BloomEffect' || 'intensity' in eff) {
          if ('intensity' in eff) eff.intensity = bloomOn ? 0.85 : 0.0;
        }
      }
    }
  }
  // Fallback: try setBloomExact if available.
  if (cme.post.setBloomExact) cme.post.setBloomExact(bloomOn ? 0.85 : 0.0);
  const px = cme.renderFrame(bloomOn ? 700 : 701);
  const f = cme.moonScreen();
  return {
    W: px.width, H: px.height,
    data: Array.from(px.data),
    disc: { x: Math.round(f.x), y: Math.round(f.y), r: Math.round(f.rPx) },
  };
})
`;

function analyze(render, label) {
  const { W, H, data, disc } = render;
  const { x: cx, y: cy, r } = disc;

  function get(x, y) {
    x = Math.max(0, Math.min(W - 1, Math.round(x)));
    y = Math.max(0, Math.min(H - 1, Math.round(y)));
    const i = (y * W + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  }

  // Limb gradient: sample radially outward across the limb (east side).
  // Gradient = max drop per pixel in luma across the edge.
  const luma = ([rr, gg, bb]) => 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
  let maxGrad = 0;
  let prev = luma(get(cx + r * 0.7, cy));
  for (let rr = r * 0.7; rr < r * 1.4; rr += 2) {
    const cur = luma(get(cx + rr, cy));
    maxGrad = Math.max(maxGrad, Math.abs(cur - prev) / 2);
    prev = cur;
  }

  // Adjacent fog: sample the haze band region (below center, at 1.2 radii).
  // Luma×chroma: luma * saturation.
  function fogMetric(dx, dy) {
    const [rr, gg, bb] = get(cx + dx, cy + dy);
    const l = luma([rr, gg, bb]) / 255;
    const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    return l * (0.5 + sat); // luma weighted by chroma
  }
  const fogA = fogMetric(0, r * 1.2);
  const fogB = fogMetric(r * 0.8, r * 1.0);
  const fog = (fogA + fogB) / 2;

  // Terminator width: for Ch4 (full moon) this is N/A, but we measure the
  // limb softness as a proxy (10-90% rise distance).
  let lo = -1, hi = -1;
  const samples = [];
  for (let rr = r * 0.5; rr < r * 1.5; rr += 1) {
    samples.push({ r: rr, l: luma(get(cx + rr, cy)) });
  }
  const maxL = Math.max(...samples.map((s) => s.l));
  const minL = Math.min(...samples.map((s) => s.l));
  const t10 = minL + (maxL - minL) * 0.1;
  const t90 = minL + (maxL - minL) * 0.9;
  for (const s of samples) {
    if (lo < 0 && s.l >= t10) lo = s.r;
    if (s.l >= t90) { hi = s.r; break; }
  }
  const termWidth = hi > lo ? hi - lo : 0;

  return { label, maxGrad, fog, termWidth };
}

async function main() {
  const { w, h, seed } = parseArgs();
  console.log(`Bloom bake-off: ${w}x${h}, seed=${seed}`);

  const url = pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href +
    `?seed=${seed}&tier=cinematic`;
  const browser = await pw.chromium.launch({
    headless: true,
    args: ['--allow-file-access-from-files', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__cmeBoot === true', null, { timeout: 90000 });
  await page.waitForTimeout(800);

  const setup = await page.evaluate(EVAL_SETUP);
  console.log(setup);

  // Warm up.
  await page.evaluate(`window.__cme.renderFrame(699)`);

  // Time A (bloom on).
  const t0a = Date.now();
  const renderA = await page.evaluate(EVAL_RENDER + '(true)');
  const t1a = Date.now();
  // Time B (bloom off).
  const t0b = Date.now();
  const renderB = await page.evaluate(EVAL_RENDER + '(false)');
  const t1b = Date.now();

  const A = analyze(renderA, 'A(bloom)');
  const B = analyze(renderB, 'B(halo-only)');

  console.log(`\nA (bloom on):  limbGrad=${A.maxGrad.toFixed(2)} fog=${A.fog.toFixed(4)} termW=${A.termWidth.toFixed(1)}px time=${t1a - t0a}ms`);
  console.log(`B (halo only): limbGrad=${B.maxGrad.toFixed(2)} fog=${B.fog.toFixed(4)} termW=${B.termWidth.toFixed(1)}px time=${t1b - t0b}ms`);

  // Metrics.
  const gradReduction = (B.maxGrad - A.maxGrad) / B.maxGrad;
  const fogRise = (A.fog - B.fog) / B.fog;
  console.log(`\nLimb gradient reduction: ${(gradReduction * 100).toFixed(1)}% (need ≥20%)`);
  console.log(`Fog luma×chroma rise:    ${(fogRise * 100).toFixed(1)}% (need ≥10%)`);
  console.log(`Terminator width: A=${A.termWidth.toFixed(1)}px B=${B.termWidth.toFixed(1)}px`);

  const passGrad = gradReduction >= 0.20;
  const passFog = fogRise >= 0.10;
  const pass = passGrad && passFog;

  console.log(`\n${pass ? 'PASS' : 'FAIL'} — bloom ${pass ? 'ships' : 'dies outside cinematic'}`);
  console.log(`  (frame-delta proxy timing; timer query unavailable headless)`);

  // Cleanup.
  await page.evaluate(`window.__bakeoff.dispose()`);
  await browser.close();

  // Output machine-readable.
  console.log(JSON.stringify({
    pass,
    gradReduction: +(gradReduction * 100).toFixed(1),
    fogRise: +(fogRise * 100).toFixed(1),
    termWidthA: +A.termWidth.toFixed(1),
    termWidthB: +B.termWidth.toFixed(1),
    timeA: t1a - t0a,
    timeB: t1b - t0b,
  }));
}

main().catch((e) => { console.error('fatal:', e); process.exit(2); });
