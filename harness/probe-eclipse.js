#!/usr/bin/env node
/**
 * harness/probe-eclipse.js — conformance probes for the Phase 6 second scene
 * (scenes/eclipse/): the "eclipse act" (blood moon, ember grade, autoplay
 * driver) built through the public engine API with zero engine edits.
 *
 * ECL0. boot clean on the viewport (zero console errors)
 * ECL1. deterministic render: renderFrame(t) twice → pixel-identical
 *       (maxDelta=0) at t = 0 / 156 / 312
 * ECL2. blood-moon hook engaged: moon.eclipse (uEclipse) == 1
 * ECL3. blood-moon visual: disc-center 5×5 mean (R − B) > 20 (deep red disc)
 * ECL4. the scene is alive: renderFrame(0) vs renderFrame(312) differ
 * ECL5. config drives the frame: sampleAt(6).ember.warmth == 1.0
 *       (mid-totality ember peak, via the engine's sampleChapterFrom) and
 *       env ember population > 0
 * ECL6. driver consumes the registered scene config (scene.id).
 *
 * Usage: node probe-eclipse.js [--viewport=1440x900] [--seed=7] [--tier=cinematic]
 */
'use strict';
const { launchBrowser, bootPage } = require('./boot');

function parseArgs() {
  const args = { viewport: '1440x900', seed: '7', tier: 'cinematic' };
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  const [w, h] = args.viewport.split('x').map(Number);
  return { ...args, w, h };
}

async function main() {
  const { w, h, seed, tier } = parseArgs();
  const results = [];
  const check = (name, pass, detail) => {
    results.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  const browser = await launchBrowser();
  const { page, errors, bootOk } = await bootPage(browser, w, h, {
    tier, seed, pageFile: 'scenes/eclipse/index.html', bootFlag: '__eclipseBoot',
  });
  check('ECL0. eclipse act boots clean', bootOk,
    errors.length ? `[${errors.join(' | ')}]` : 'clean');

  if (bootOk) {
    const cmp = (a, b) => {
      let maxDelta = 0, diff = 0;
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        if (d > maxDelta) maxDelta = d;
        if (d > 0) diff++;
      }
      return { maxDelta, diff };
    };
    // ECL1: determinism at three t values (two renders each).
    const det = await page.evaluate(`(() => {
      const e = window.__eclipse;
      const out = {};
      for (const t of [0, 156, 312]) {
        const p1 = e.renderFrame(t).data, p2 = e.renderFrame(t).data;
        let maxDelta = 0;
        for (let i = 0; i < p1.length; i++) maxDelta = Math.max(maxDelta, Math.abs(p1[i] - p2[i]));
        out[t] = maxDelta;
      }
      return out;
    })()`);
    const detOk = Object.values(det).every((v) => v === 0);
    check('ECL1. renderFrame(t) twice → pixel-identical (maxDelta=0)',
      detOk, `t=0:${det[0]} t=156:${det[156]} t=312:${det[312]}`);

    // ECL2 + ECL3 + ECL5: hook state, blood visual, config drive.
    const st = await page.evaluate(`(() => {
      const e = window.__eclipse;
      const px = e.renderFrame(156); // ch7 heart of shadow
      const f = e.moonScreen();
      const W = px.width, H = px.height, d = px.data;
      const cx = Math.round(f.x), cy = Math.round(f.y);
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let y = cy - 2; y <= cy + 2; y++)
        for (let x = cx - 2; x <= cx + 2; x++) {
          const k = (y * W + x) * 4;
          sr += d[k]; sg += d[k + 1]; sb += d[k + 2]; n++;
        }
      return {
        eclipse: e.moon.eclipse,
        discR: +(sr / n).toFixed(1), discG: +(sg / n).toFixed(1), discB: +(sb / n).toFixed(1),
        warmth6: e.sampleAt(6).ember.warmth,
        embers: e.env.counts.embers,
        sceneId: e.scene.id,
        injectedScript: e.moon.colorScript !== undefined && e.scene.colorScript === null,
      };
    })()`);
    check('ECL2. blood-moon hook engaged (moon.eclipse == 1)', st.eclipse === 1,
      `moon.eclipse=${st.eclipse}`);
    const redDominance = st.discR - st.discB;
    check('ECL3. blood-moon visual: disc-center strongly red',
      redDominance > 20, `disc RGB=(${st.discR},${st.discG},${st.discB}) R−B=${redDominance.toFixed(1)}`);
    check('ECL5. config drives the frame (ember warmth peak + population)',
      st.warmth6 === 1.0 && st.embers > 0,
      `sampleAt(6).ember.warmth=${st.warmth6} embers=${st.embers}`);
    check('ECL6. driver consumes the registered scene config',
      st.sceneId === 'eclipse-act',
      `scene.id=${st.sceneId}`);

    // ECL4: the scene is alive (different chapters differ).
    const alive = await page.evaluate(`(() => {
      const e = window.__eclipse;
      const a = e.renderFrame(0).data, b = e.renderFrame(312).data;
      let diff = 0;
      for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i+1] !== b[i+1] || a[i+2] !== b[i+2]) diff++;
      return diff;
    })()`);
    check('ECL4. scene is alive: t=0 vs t=312 differ', alive > 1000, `diffPx=${alive}`);

    await page.screenshot({ path: `/tmp/eclipse-${w}x${h}.png` });
  }
  await page.close();
  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed (${w}×${h})`);
  if (failed.length) {
    console.log('FAILED:', failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
}

main().catch((e) => { console.error('fatal:', e); process.exit(2); });
