#!/usr/bin/env node
/**
 * Phase 6 conformance checks — determinism hardening + reduced-motion
 * boundary validation (merged ruling items B/C/D).
 *
 * BOUNDARY. Reduced-motion quantization-boundary stability: for each
 *   chapterT boundary 0.5/1.5/…/11.5, render at boundary ± epsilon where
 *   epsilon = one scroll-pixel and a few scroll-pixels, 3 repeats each.
 *   Asserts: (1) basin assignment deterministic — same scrollY always lands
 *   in the same basin, pixel-identical across repeats (no flicker);
 *   (2) the basin matches the analytic side for ±1px and ±3px offsets
 *   (below → lower chapter, above → upper chapter); the exact-boundary
 *   scrollY may land in either adjacent basin (float rounding) but must be
 *   stable. If genuine rapid basin switching were found, hysteresis would
 *   have to be introduced as a defined pure presentation transformation in
 *   engine/presentation.js (PRESENTATION_CONTRACT) — see report.
 *
 * ENVSCATTER. Env-scatter boot-tier invariant: stepping the tier ladder
 *   down via applyTier (the watchdog path) must NEVER mutate environment
 *   population (tree/rock/lantern/ember counts, layout hash). The watchdog
 *   sheds bloom/stars/moon-mesh only — env scatter stays at boot-tier scale
 *   by deliberate design (documented in index.html). Also verifies the
 *   check is not vacuous (star drawRange and moon mesh DO change) and that
 *   boot-tier scatter scaling holds per TIER_SCATTER_SCALE.
 *
 * Usage: node checks-phase6.js [--viewport=1440x900] [--seed=7]
 */
'use strict';
const { launchBrowser, bootPage } = require('./boot');

function parseArgs() {
  const args = { viewport: '1440x900', seed: '7' };
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  const [w, h] = args.viewport.split('x').map(Number);
  return { ...args, w, h };
}

async function main() {
  const { w, h, seed } = parseArgs();
  const results = [];
  const check = (name, pass, detail) => {
    results.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  const browser = await launchBrowser();

  // ---------- BOUNDARY: quantization-boundary stability (reduced motion) ----------
  {
    const { page, bootOk, errors } = await bootPage(browser, w, h,
      { tier: 'cinematic', seed, reducedMotion: true });
    check('BOUNDARY0. boot under reduced-motion emulation', bootOk,
      errors.length ? `[${errors.join(' | ')}]` : 'clean');
    if (bootOk) {
      // 12 boundaries × 5 offsets (±1px, ±3px, exact) × 3 repeats, all in-page.
      const r = await page.evaluate(`(() => {
        const cme = window.__cme;
        const maxY = document.documentElement.scrollHeight - innerHeight;
        const chapterT = (y) => 12 * Math.min(1, Math.max(0, y / maxY));
        const bounds = [];
        for (let b = 0.5; b < 12; b += 1) bounds.push(b);
        const offsets = [-3, -1, 0, 1, 3];
        const out = [];
        for (const b of bounds) {
          const yB = (b / 12) * maxY;
          for (const off of offsets) {
            const y = yB + off;
            const basins = [], pix = [];
            for (let rep = 0; rep < 3; rep++) {
              const st = cme.renderAtScrollY(y);
              basins.push(st.state.presentation.motionChapterT);
              pix.push(st.pixels.data);
            }
            let maxDelta = 0;
            for (let rep = 1; rep < 3; rep++) {
              const a = pix[0], c = pix[rep];
              for (let i = 0; i < a.length; i++) {
                const d = Math.abs(a[i] - c[i]);
                if (d > maxDelta) maxDelta = d;
              }
            }
            out.push({ b, off, basins, maxDelta,
                       canonT: +chapterT(y).toFixed(6) });
          }
        }
        return out;
      })()`);
      let stable = 0, flicker = 0, sideErr = 0;
      const sideProblems = [];
      for (const s of r) {
        const { b, off, basins, maxDelta } = s;
        const allSame = basins[0] === basins[1] && basins[1] === basins[2];
        if (!allSame || maxDelta > 0) {
          flicker++;
          sideProblems.push(`b=${b} off=${off}: basins=[${basins}] maxDelta=${maxDelta}`);
          continue;
        }
        stable++;
        // Analytic side: below the boundary → chapter b-0.5; above → b+0.5.
        const lo = b - 0.5, hi = b + 0.5;
        if (off <= -1 && basins[0] !== lo) { sideErr++; sideProblems.push(`b=${b} off=${off}: expected ${lo}, got ${basins[0]}`); }
        if (off >= 1 && basins[0] !== hi) { sideErr++; sideProblems.push(`b=${b} off=${off}: expected ${hi}, got ${basins[0]}`); }
        if (off === 0 && basins[0] !== lo && basins[0] !== hi) { sideErr++; sideProblems.push(`b=${b} off=0: basin ${basins[0]} outside {${lo},${hi}}`); }
      }
      check('BOUNDARY1. same scrollY → same basin, pixel-identical (no flicker)',
        flicker === 0, `${stable}/${r.length} stable, ${flicker} flickered` +
        (sideProblems.length && flicker ? ` — e.g. ${sideProblems[0]}` : ''));
      check('BOUNDARY2. ±1px/±3px land on the analytic basin side',
        sideErr === 0, sideErr === 0 ? 'all 48 side assertions hold' : sideProblems.slice(0, 3).join(' | '));
      const exact = r.filter((s) => s.off === 0);
      const exactBasins = exact.map((s) => `${s.b}→${s.basins[0]}`).join(' ');
      check('BOUNDARY3. exact-boundary scrollY deterministic (float side recorded, stable)',
        flicker === 0, `basins: ${exactBasins}`);
    }
    await page.close();
  }

  // ---------- ENVSCATTER: tier step-down never mutates env population ----------
  {
    const { page, bootOk, errors } = await bootPage(browser, w, h,
      { tier: 'cinematic', seed, reducedMotion: false });
    check('ENV0. boot clean (cinematic)', bootOk,
      errors.length ? `[${errors.join(' | ')}]` : 'clean');
    if (bootOk) {
      const snap = () => page.evaluate(`(() => { const c = window.__cme; return {
        counts: { ...c.env.counts },
        layoutHash: c.env.layoutHash(),
        envTier: c.env.tier,
        starDraw: c.stars.points.geometry.drawRange.count,
        mesh: c.moon.meshMode,
      }; })()`);
      const before = await snap();
      const steps = [];
      for (const t of ['balanced', 'efficient', 'still']) {
        await page.evaluate(`window.__cme.applyTier('${t}', 'harness ENVSCATTER')`);
        steps.push({ tier: t, ...(await snap()) });
      }
      const countsUnchanged = steps.every((s) =>
        JSON.stringify(s.counts) === JSON.stringify(before.counts));
      const hashUnchanged = steps.every((s) => s.layoutHash === before.layoutHash);
      const envTierPinned = steps.every((s) => s.envTier === 'cinematic');
      check('ENV1. applyTier step-down never mutates env counts', countsUnchanged,
        `cinematic=${JSON.stringify(before.counts)} ` +
        steps.map((s) => `${s.tier}=${JSON.stringify(s.counts)}`).join(' '));
      check('ENV2. env layoutHash unchanged across step-downs', hashUnchanged,
        `hash=${String(before.layoutHash).slice(0, 12)}…`);
      check('ENV3. env keeps its boot tier (watchdog never rebuilds env)', envTierPinned,
        `env.tier stayed 'cinematic' through ${steps.map((s) => s.tier).join(' → ')}`);
      // Not vacuous: the step-down DID shed load elsewhere.
      const shed = steps[1].starDraw === 2000 && steps[1].mesh === 'disc' &&
        steps[0].starDraw === 4000;
      check('ENV4. check not vacuous — stars/mesh shed while env held',
        shed, `balanced: draw=${steps[0].starDraw}; efficient: draw=${steps[1].starDraw} mesh=${steps[1].mesh}`);
      console.log(`  env counts (cinematic boot): ${JSON.stringify(before.counts)}`);
    }
    await page.close();
  }

  // ---------- ENVSCATTERb: boot-tier scatter scaling is deliberate ----------
  {
    const expectations = { efficient: 0.45, still: 0.4 };
    for (const [tier, scale] of Object.entries(expectations)) {
      const { page, bootOk, errors } = await bootPage(browser, w, h,
        { tier, seed, reducedMotion: false });
      if (!bootOk) { check(`ENVB. boot ?tier=${tier}`, false, errors.join(' | ')); await page.close(); continue; }
      const r = await page.evaluate(`(() => { const c = window.__cme; return {
        envTier: c.env.tier, trees: c.env.counts.trees, rocks: c.env.counts.rocks,
        embers: c.env.counts.embers }; })()`);
      await page.close();
      const exp = {
        trees: Math.round(240 * scale), rocks: Math.round(150 * scale),
        embers: Math.round(420 * scale),
      };
      const pass = r.envTier === tier && r.trees === exp.trees && r.rocks === exp.rocks && r.embers === exp.embers;
      check(`ENVB. ?tier=${tier} boots at tier-scaled scatter (deliberate)`, pass,
        `tier=${r.envTier} trees=${r.trees}/${exp.trees} rocks=${r.rocks}/${exp.rocks} embers=${r.embers}/${exp.embers}`);
    }
  }

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed (${w}×${h})`);
  if (failed.length) {
    console.log('FAILED:', failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
}

main().catch((e) => { console.error('fatal:', e); process.exit(2); });
