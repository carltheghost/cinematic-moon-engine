#!/usr/bin/env node
/**
 * Phase 4 review screenshots (serial, one browser at a time).
 *  - /tmp/phase4-ch10-desktop.png : desktop 1440×900, chapter 10 (vermilion)
 *  - /tmp/phase4-ch01-mobile.png  : mobile 390×844, chapter 1 (bone-white)
 *
 * Usage: node shot-phase4.js [--seed=7]
 */
'use strict';
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const pw = require('playwright');

async function shot(w, h, chapterIdx, out, seed) {
  const url = pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href +
    `?seed=${seed}&tier=cinematic`;
  const browser = await pw.chromium.launch({
    headless: true,
    args: ['--allow-file-access-from-files', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__cmeBoot === true', null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.evaluate(`window.__cme.renderFrame(${chapterIdx} / 12 * 312)`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: out });
  console.log(`saved ${out} (${w}×${h} ch${chapterIdx + 1})`);
  await browser.close();
}

async function main() {
  const seed = (process.argv.find((a) => a.startsWith('--seed=')) || '--seed=7').slice(7);
  await shot(1440, 900, 9, '/tmp/phase4-ch10-desktop.png', seed);
  await shot(390, 844, 0, '/tmp/phase4-ch01-mobile.png', seed);
}

main().catch((e) => { console.error('fatal:', e); process.exit(2); });
