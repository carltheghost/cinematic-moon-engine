#!/usr/bin/env node
/**
 * harness/boot.js — shared page-boot helper for the Phase 6 harness tools
 * (replay.js, checks-phase6.js, probe-eclipse.js). Phase 1–5 check files keep
 * their own local bootPage copies; this module exists so the new tools share
 * one mechanism (docs/regression-philosophy.md) instead of a third copy.
 *
 * Usage:
 *   const { launchBrowser, bootPage } = require('./boot');
 *   const browser = await launchBrowser();
 *   const { page, errors, bootOk } = await bootPage(browser, 1440, 900,
 *     { tier: 'cinematic', seed: 7, reducedMotion: false, pageFile: 'index.html', bootFlag: '__cmeBoot' });
 */
'use strict';
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const pw = require('playwright');

/** Serial-friendly Chromium launch (VM ~4GB commit limit — one instance at a time). */
async function launchBrowser() {
  return pw.chromium.launch({
    headless: true,
    args: ['--allow-file-access-from-files', '--no-sandbox', '--disable-dev-shm-usage'],
  });
}

/**
 * Boot a harness page.
 * opts: { tier, seed, emberfloor, reducedMotion, autoplay, extraQuery,
 *         pageFile (default 'index.html'), bootFlag (default '__cmeBoot') }
 * Returns { page, errors, bootOk } — bootOk requires zero console errors.
 */
async function bootPage(browser, w, h, opts = {}) {
  const {
    tier = 'cinematic', seed = '7', emberfloor = false, reducedMotion = false,
    autoplay = false, extraQuery = '', pageFile = 'index.html', bootFlag = '__cmeBoot',
  } = opts;
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e && e.message)));
  let url = pathToFileURL(path.resolve(__dirname, '..', pageFile)).href +
    `?seed=${seed}&tier=${tier}`;
  if (emberfloor) url += '&emberfloor=1';
  if (autoplay) url += '&autoplay=1';
  if (extraQuery) url += extraQuery;
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(`window.${bootFlag} === true`, null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(600);
  const boot = await page.evaluate(`({ boot: window.${bootFlag}, err: window.__cmeBootError })`)
    .catch(() => ({ boot: false, err: 'evaluate failed' }));
  return { page, errors, bootOk: boot.boot === true && !boot.err && errors.length === 0, errors };
}

module.exports = { launchBrowser, bootPage };
