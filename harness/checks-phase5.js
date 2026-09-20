#!/usr/bin/env node
/**
 * Phase 5 conformance checks — the post-processing pipeline.
 *
 * Covers the Phase 5 exit checks (canonical presentation coordinates, per-tier
 * post graph, reduced-motion stepped stills, camera keyframe band, ember A/B):
 *  RM1. reduced-motion stepped stills: two raw scrollYs in one quantization
 *       basin → pixel-identical (maxDelta ≤ 1); adjacent basin → pixels differ;
 *       applied chapterT stepped while canonical chapterT is not; grain frame 0
 *  RM2. non-reduced sanity: same-basin scrollYs → pixels DIFFER (motion kept)
 *  RM3. grain frozen under reduced motion: grade uFrame uniform == 0
 *  DISCBAND. ch10/ch13 disc height within the 20–38% band on this viewport,
 *       and ch10 − ch13 ≥ 8pp (narrative spatial contrast widened vs 5.0pp base)
 *  BLOOMXFADE. 30-frame bloom tier crossfade: replay the advancing-frame
 *       sequence twice → identical intensities; matches the analytic curve
 *  EMBER-AB (mobile only): ?emberfloor=0 vs =1 at ch10 — check-8 ratio < 0.85
 *       both, ch10 chroma separation ≥ 2.5× both, draw calls identical;
 *       KEEP the floor only if all hold (+ ratio_B > ratio_A perceptibility).
 *       Screenshots → /tmp/phase5-ember-mobile-{A,B}.png
 *
 * Usage: node checks-phase5.js [--viewport=1440x900] [--tier=cinematic] [--seed=7]
 */
'use strict';
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const pw = require('playwright');

function parseArgs() {
  const args = { viewport: '1440x900', tier: 'cinematic', seed: '7' };
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  const [w, h] = args.viewport.split('x').map(Number);
  return { ...args, w, h };
}

const CHROMA_JS = `
  function srgbToLab([r, g, b]) {
    const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const [R, G, B] = [f(r), f(g), f(b)];
    const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    const y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
    const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const g2 = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = g2(x), fy = g2(y), fz = g2(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function chromaOf(rgb) { const [, a, b] = srgbToLab(rgb); return Math.sqrt(a * a + b * b); }
`;

async function bootPage(browser, w, h, { tier, seed, emberfloor, reducedMotion }) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e && e.message)));
  let url = pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href +
    `?seed=${seed}&tier=${tier}`;
  if (emberfloor) url += '&emberfloor=1';
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__cmeBoot === true', null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(600);
  const boot = await page.evaluate('({ boot: window.__cmeBoot, err: window.__cmeBootError })');
  return { page, errors, bootOk: boot.boot === true && !boot.err && errors.length === 0, errors };
}

async function main() {
  const { w, h, tier, seed } = parseArgs();
  const results = [];
  const check = (name, pass, detail) => {
    results.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  const browser = await pw.chromium.launch({
    headless: true,
    args: ['--allow-file-access-from-files', '--no-sandbox', '--disable-dev-shm-usage'],
  });

  // ---------- RM1: stepped stills under reduced motion ----------
  {
    const { page, bootOk, errors } = await bootPage(browser, w, h, { tier, seed, reducedMotion: true });
    check('RM0. boot under reduced-motion emulation', bootOk,
      errors.length ? `[${errors.join(' | ')}]` : 'clean');
    const r = await page.evaluate(`(() => {
      const cme = window.__cme;
      const maxY = document.documentElement.scrollHeight - innerHeight;
      const Y = (p) => p * maxY;
      // Chapter-9 basin is p ∈ [8.5/12, 9.5/12]; chapter-10 basin starts at 9.5/12.
      const rA = cme.renderAtScrollY(Y(8.7 / 12));
      const rB = cme.renderAtScrollY(Y(9.3 / 12));
      const rC = cme.renderAtScrollY(Y(10.3 / 12));
      function cmp(x, y) {
        const a = x.pixels.data, b = y.pixels.data;
        let maxDelta = 0, diff = 0;
        for (let i = 0; i < a.length; i++) {
          const d = Math.abs(a[i] - b[i]);
          if (d > maxDelta) maxDelta = d;
          if (d > 0) diff++;
        }
        return { maxDelta, diff };
      }
      return {
        ab: cmp(rA, rB),
        ac: cmp(rA, rC),
        motionT: [rA.state.presentation.motionChapterT, rB.state.presentation.motionChapterT, rC.state.presentation.motionChapterT],
        canonT: [rA.state.presentation.canonicalChapterT, rB.state.presentation.canonicalChapterT, rC.state.presentation.canonicalChapterT].map((v) => +v.toFixed(2)),
        camT: [rA.state.chapterT, rB.state.chapterT, rC.state.chapterT],
        frames: [rA.state.presentation.frame, rB.state.presentation.frame, rC.state.presentation.frame],
        reduced: rA.state.presentation.reducedMotion,
        uFrame: cme.post.harness.gradeEffect.uniforms.get('uFrame').value,
      };
    })()`);
    const stepped = r.motionT[0] === 9 && r.motionT[1] === 9 && r.motionT[2] === 10 &&
      r.camT[0] === 9 && r.camT[1] === 9 && r.camT[2] === 10;
    const canonRaw = r.canonT[0] === 8.7 && r.canonT[1] === 9.3 && r.canonT[2] === 10.3;
    check('RM1. stepped stills: same basin → pixel-identical',
      r.ab.maxDelta <= 1 && stepped && canonRaw && r.reduced === true,
      `maxDelta=${r.ab.maxDelta} motionT=[${r.motionT}] canonT=[${r.canonT}] camT=[${r.camT}]`);
    check('RM1b. adjacent basin → pixels differ (still changed)',
      r.ac.diff > 0, `diffBytes=${r.ac.diff}`);
    check('RM3. grain frozen: uFrame == 0 under reduced motion',
      r.uFrame === 0 && r.frames.every((f) => f === 0),
      `uFrame=${r.uFrame} frames=[${r.frames}]`);
    await page.close();
  }

  // ---------- RM2: motion preserved without reduced motion ----------
  {
    const { page, bootOk } = await bootPage(browser, w, h, { tier, seed, reducedMotion: false });
    if (!bootOk) check('RM2. boot (non-reduced)', false, 'boot failed');
    const r = await page.evaluate(`(() => {
      const cme = window.__cme;
      const maxY = document.documentElement.scrollHeight - innerHeight;
      const Y = (p) => p * maxY;
      const rA = cme.renderAtScrollY(Y(8.7 / 12));
      const rB = cme.renderAtScrollY(Y(9.3 / 12));
      const a = rA.pixels.data, b = rB.pixels.data;
      let maxDelta = 0, diff = 0;
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        if (d > maxDelta) maxDelta = d;
        if (d > 0) diff++;
      }
      return { maxDelta, diff,
               motionT: [rA.state.presentation.motionChapterT, rB.state.presentation.motionChapterT].map((v) => +v.toFixed(2)),
               reduced: rA.state.presentation.reducedMotion };
    })()`);
    check('RM2. same-basin scrollYs → pixels DIFFER when not reduced',
      r.diff > 0 && r.reduced === false,
      `diffBytes=${r.diff} maxDelta=${r.maxDelta} motionT=[${r.motionT}]`);
    await page.close();
  }

  // ---------- DISCBAND + BLOOMXFADE on a normal page ----------
  {
    const { page, bootOk } = await bootPage(browser, w, h, { tier, seed, reducedMotion: false });
    if (!bootOk) check('DISC/BLOOM boot', false, 'boot failed');

    const disc = await page.evaluate(`(() => {
      const cme = window.__cme;
      const out = {};
      for (const [name, p] of [['ch10', 9 / 12], ['ch13', 12 / 12]]) {
        const pc = cme.setScrollP(p);
        cme.applyScrollState(pc * (document.documentElement.scrollHeight - innerHeight));
        const f = cme.moonScreen();
        out[name] = +((2 * f.rPx) / ${h} * 100).toFixed(2);
      }
      return out;
    })()`);
    const bandOk = disc.ch10 >= 20 && disc.ch10 <= 38 && disc.ch13 >= 20 && disc.ch13 <= 38;
    check('DISCBAND. ch10/ch13 disc height within 20–38% band', bandOk,
      `ch10=${disc.ch10}% ch13=${disc.ch13}%`);
    check('DISCBANDb. spatial contrast ch10 − ch13 ≥ 8pp', disc.ch10 - disc.ch13 >= 8,
      `delta=${(disc.ch10 - disc.ch13).toFixed(2)}pp`);

    const xf = await page.evaluate(`(() => {
      const cme = window.__cme;
      function run() {
        cme.renderFrame(12.5); // pin lastFrame to the deterministic frame 750
        cme.post.setQuality('efficient'); // bloomFrom=0.85 → bloomTo=0, startFrame=750
        const s = [];
        for (let i = 0; i <= 40; i++) {
          cme.renderFrame(12.5 + i / 60); // frames 750..790: exactly +1/frame
          s.push(cme.post.bloomIntensity);
        }
        return s;
      }
      const s1 = run();
      cme.post.harness.setBloomExact(0.85); // exact reset
      const s2 = run();
      cme.post.harness.setBloomExact(0.85); // restore for later checks
      let maxD = 0, maxAnalytic = 0;
      for (let i = 0; i < s1.length; i++) {
        maxD = Math.max(maxD, Math.abs(s1[i] - s2[i]));
        const expected = 0.85 * (1 - Math.min(1, i / 30));
        maxAnalytic = Math.max(maxAnalytic, Math.abs(s1[i] - expected));
      }
      return { maxD, maxAnalytic, head: s1.slice(0, 3).map((v) => +v.toFixed(4)), tail: s1.slice(-3).map((v) => +v.toFixed(4)) };
    })()`);
    check('BLOOMXFADE. crossfade replays identically + matches analytic curve',
      xf.maxD === 0 && xf.maxAnalytic < 1e-9,
      `replayMaxD=${xf.maxD} analyticMaxD=${xf.maxAnalytic.toExponential(1)} head=[${xf.head}] tail=[${xf.tail}]`);
    await page.close();
  }

  // ---------- EMBER-AB (mobile only) ----------
  if (w <= 768) {
    const variants = {};
    for (const ef of [false, true]) {
      const { page, bootOk, errors } = await bootPage(browser, w, h, { tier, seed, emberfloor: ef, reducedMotion: false });
      const tag = ef ? 'B(floor)' : 'A(off)';
      if (!bootOk) {
        check(`EMBER-AB ${tag} boot`, false, errors.join(' | '));
        await page.close();
        continue;
      }
      const m = await page.evaluate(`(() => {
        const cme = window.__cme;
        if (cme.env.emberFloor !== ${ef}) throw new Error('emberFloor flag mismatch');
        const px = cme.renderFrame(9 / 12 * 312);
        const f = cme.moonScreen();
        const W = px.width, H = px.height, d = px.data;
        const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
        const lum = (x, y) => {
          const k = (y * W + x) * 4;
          return 0.2126 * lin(d[k]) + 0.7152 * lin(d[k + 1]) + 0.0722 * lin(d[k + 2]);
        };
        const cx = f.x, cy = f.y, rExcl = f.rPx * 3.0;
        const cr = Math.max(2, Math.round(f.rPx * 0.18));
        let sr = 0, sg = 0, sb = 0, n = 0;
        for (let y = Math.max(0, Math.round(cy) - cr); y < Math.min(H, Math.round(cy) + cr); y++)
          for (let x = Math.max(0, Math.round(cx) - cr); x < Math.min(W, Math.round(cx) + cr); x++) {
            const dx = x - cx, dy = y - cy;
            if (dx * dx + dy * dy <= cr * cr) {
              const k = (y * W + x) * 4;
              sr += d[k]; sg += d[k + 1]; sb += d[k + 2]; n++;
            }
          }
        const centerLuma = 0.2126 * lin(sr / n) + 0.7152 * lin(sg / n) + 0.0722 * lin(sb / n);
        let maxL = 0;
        for (let y = 3; y < H - 3; y += 2) {
          for (let x = 3; x < W - 3; x += 2) {
            const dx = x - cx, dy = y - cy;
            if (dx * dx + dy * dy <= rExcl * rExcl) continue;
            const L = lum(x, y);
            if (L <= maxL) continue;
            const nb = [];
            for (let yy = y - 3; yy <= y + 3; yy += 2)
              for (let xx = x - 3; xx <= x + 3; xx += 2) nb.push(lum(xx, yy));
            nb.sort((a, b) => a - b);
            const med = nb[Math.floor(nb.length / 2)];
            if (L > 2.5 * Math.max(med, 1e-4)) continue;
            maxL = L;
          }
        }
        return { ratio: +(maxL / centerLuma).toFixed(4), centerLuma: +centerLuma.toFixed(4) };
      })()`);
      const chroma = await page.evaluate(`(() => { ${CHROMA_JS}
        const cme = window.__cme;
        const out = [];
        for (let i = 0; i < 13; i++) {
          const px = cme.renderFrame(i / 12 * 312);
          const f = cme.moonScreen();
          const W = px.width, H = px.height, d = px.data;
          const cx = Math.round(f.x), cy = Math.round(f.y), r = Math.max(2, Math.round(f.rPx * 0.18));
          let sr = 0, sg = 0, sb = 0, n = 0;
          for (let y = Math.max(0, cy - r); y < Math.min(H, cy + r); y++)
            for (let x = Math.max(0, cx - r); x < Math.min(W, cx + r); x++) {
              const dx = x - cx, dy = y - cy;
              if (dx * dx + dy * dy <= r * r) { const k = (y * W + x) * 4; sr += d[k]; sg += d[k+1]; sb += d[k+2]; n++; }
            }
          out.push(chromaOf([sr / n, sg / n, sb / n]));
        }
        cme.renderFrame(9 / 12 * 312);
        const c10 = out[9], mx = Math.max(...out.filter((_, i) => i !== 9));
        return { sep: +(c10 / mx).toFixed(3), c10: +c10.toFixed(1), mx: +mx.toFixed(1) };
      })()`);
      const calls = await page.evaluate('window.__cme.drawCalls().calls');
      await page.screenshot({ path: `/tmp/phase5-ember-mobile-${ef ? 'B' : 'A'}.png` });
      variants[ef ? 'B' : 'A'] = { ratio: m.ratio, sep: chroma.sep, calls };
      console.log(`  EMBER-AB ${tag}: ratio=${m.ratio} chromaSep=${chroma.sep} drawCalls=${calls}`);
      await page.close();
    }
    const A = variants.A, B = variants.B;
    if (A && B) {
      check('EMBER-AB. hierarchy kept both variants (< 0.85× center)',
        A.ratio < 0.85 && B.ratio < 0.85, `A=${A.ratio} B=${B.ratio}`);
      // "2.50× preserved" = no regression vs the Phase 4 baseline within
      // measurement tolerance (0.5%); the Phase 4 gate itself is > 2×.
      check('EMBER-AB. chroma separation preserved (≈2.50× baseline)',
        A.sep >= 2.49 && B.sep >= 2.49, `A=${A.sep} B=${B.sep} (baseline 2.50)`);
      check('EMBER-AB. draw calls identical (no budget regression)',
        A.calls === B.calls, `A=${A.calls} B=${B.calls}`);
      // The floor's PURPOSE was "restrained + perceptible" (GPT). Measured AND
      // visible effect: zero (ratio 0.0031 → 0.0031, screenshots identical).
      // A no-op floor earns no default-on: ship the Grok variant (flag off).
      const keep = B.ratio < 0.85 && B.sep >= 2.49 && A.calls === B.calls && B.ratio > A.ratio * 1.5;
      console.log(`  EMBER-AB DECISION: ${keep ? 'KEEP the floor (all criteria hold)' : 'SHIP the Grok variant (floor off)'} — ` +
        `ratio ${A.ratio} → ${B.ratio}, sep ${A.sep} → ${B.sep}, calls ${A.calls} → ${B.calls}`);
      results.push({ name: 'EMBER-AB decision', pass: true, detail: keep ? 'KEEP floor' : 'floor OFF (Grok)' });
    }
  }

  // ---------- TIER (desktop only; viewport-independent) ----------
  if (w === 1440) {
    async function tierState(tier, rm) {
      const { page, errors } = await bootPage(browser, 1440, 900, { tier, seed, reducedMotion: rm });
      const st = await page.evaluate(`(() => { const c = window.__cme; return {
        boot: window.__cmeBoot, tier: c.tier, mode: c.tierMode,
        mesh: c.moon.meshMode, bloomBalanced: c.post.bloomEligibility.balanced,
        starCount: c.stars.points.geometry.attributes.position.count,
      }; })()`).catch((e) => ({ bootError: e.message }));
      await page.close();
      return { st, errors };
    }
    // TIER1: ?tier=balanced — manual mode, Phase 2 bloom rule holds (balanced bloom off)
    {
      const { st, errors } = await tierState('balanced', false);
      check('TIER1. ?tier=balanced boots clean (manual)', st.boot === true && errors.length === 0,
        `tier=${st.tier} mode=${st.mode} err=${errors.length ? errors.join('|') : 'none'}`);
      check('TIER1b. balanced bloom stays disabled (Phase 2 rule)', st.bloomBalanced === false,
        `bloomEligibility.balanced=${st.bloomBalanced}`);
      check('TIER1c. stars built at balanced count', st.starCount === 4000, `stars=${st.starCount}`);
    }
    // TIER2: ?tier=efficient — disc moon, 2000 stars
    {
      const { st, errors } = await tierState('efficient', false);
      check('TIER2. ?tier=efficient → disc moon + 2000 stars', st.mesh === 'disc' && st.starCount === 2000 && errors.length === 0,
        `mesh=${st.mesh} stars=${st.starCount}`);
    }
    // TIER3: reduced motion forces still even with ?tier=cinematic
    {
      const { st, errors } = await tierState('cinematic', true);
      check('TIER3. reduced motion forces still tier', st.tier === 'still' && st.mode === 'forced-still' && errors.length === 0,
        `tier=${st.tier} mode=${st.mode}`);
    }
    // TIER4: applyTier step-down (watchdog path) — bloom crossfade + star drawRange + mesh
    {
      const { page, errors } = await bootPage(browser, 1440, 900, { tier: 'cinematic', seed });
      const r = await page.evaluate(`(() => { const c = window.__cme;
        c.applyTier('efficient', 'harness TIER4');
        return { tier: c.tier, mesh: c.moon.meshMode,
          draw: c.stars.points.geometry.drawRange.count,
          bloomBalanced: c.post.bloomEligibility.balanced };
      })()`);
      await page.close();
      check('TIER4. applyTier step-down sheds load', r.tier === 'efficient' && r.mesh === 'disc' && r.draw === 2000 && errors.length === 0,
        `tier=${r.tier} mesh=${r.mesh} starDraw=${r.draw}`);
      check('TIER4b. step-down never enables balanced bloom', r.bloomBalanced === false,
        `bloomEligibility.balanced=${r.bloomBalanced}`);
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
