#!/usr/bin/env node
/**
 * Phase 7 asset capture: eclipse-act screenshots for the review packet.
 * Serial single-browser run (VM ~4GB limit).
 *
 * Captures (all seed 7, tier=cinematic, t=156 mid-totality):
 *   1. scenes/eclipse/index.html (ported standalone driver) — 1440×900, 390×844
 *   2. index.html?scene=eclipse-act (main page, new registry seam) — 1440×900, 390×844
 *
 * Output: ~/workspace/research_notes/moon-engine-plan/review-packets/phase7-assets/
 *
 * Usage: node shot-phase7.js [--seed=7]
 */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchBrowser, bootPage } = require('./boot');

const ASSETS = path.join(os.homedir(), 'workspace', 'research_notes',
  'moon-engine-plan', 'review-packets', 'phase7-assets');

function parseArgs() {
  const args = { seed: '7' };
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

async function shot(browser, { pageFile, bootFlag, extraQuery, w, h, seed, out, renderExpr }) {
  // Bake pin: asset captures must be deterministic across runs (the
  // wall-clock budget fallback would flip moon-bake pixels under VM load).
  const { page, errors, bootOk } = await bootPage(browser, w, h,
    { tier: 'cinematic', seed, pageFile, bootFlag, extraQuery, bakeRes: 2048 });
  if (!bootOk) {
    console.log(`FAIL  ${out} — boot not clean: ${errors.join(' | ')}`);
    await page.close();
    return false;
  }
  await page.evaluate(renderExpr);
  await page.waitForTimeout(400);
  fs.mkdirSync(ASSETS, { recursive: true });
  await page.screenshot({ path: path.join(ASSETS, out) });
  // The bootPage console/pageerror listeners stay live: errors[] covers the
  // render + screenshot window too.
  const clean = errors.length === 0;
  await page.close();
  console.log(`${clean ? 'OK  ' : 'FAIL'}  ${out}${clean ? '' : ` — console errors: ${errors.join(' | ')}`}`);
  return clean;
}

async function main() {
  const { seed } = parseArgs();
  const browser = await launchBrowser();
  let ok = true;
  const viewports = [[1440, 900], [390, 844]];
  for (const [w, h] of viewports) {
    ok = await shot(browser, {
      pageFile: 'scenes/eclipse/index.html', bootFlag: '__eclipseBoot', extraQuery: '',
      w, h, seed, out: `eclipse-driver-${w}x${h}.png`,
      renderExpr: 'window.__eclipse.renderFrame(156)',
    }) && ok;
    ok = await shot(browser, {
      pageFile: 'index.html', bootFlag: '__cmeBoot', extraQuery: '&scene=eclipse-act',
      w, h, seed, out: `eclipse-scene-param-${w}x${h}.png`,
      renderExpr: 'window.__cme.renderFrame(156)',
    }) && ok;
  }
  await browser.close();
  console.log(ok ? '=== shot-phase7 PASS ===' : '=== shot-phase7 FAIL ===');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('fatal:', e); process.exit(2); });
