#!/usr/bin/env node
/**
 * Phase 4 conformance checks for the cinematic moon engine.
 *
 * Covers the Phase 4 exit checks (scroll-driven chapter clock):
 *  1. boot, zero console errors
 *  2. ridge — viewport-normalized analytic haze (ch 4/7/10), ≥40% both viewports
 *  3. determinism — four render histories ending at t=12.5, all six pairs, max Δ≤1
 *  4. color — all 13 COLOR_SCRIPT targets, ΔE ≤10
 *  5. ch10 chroma > 2× every other chapter
 *  6. ch13 dimmest
 *  7. dark-limb rule (every chapter except ch10)
 *  8. ch10 ember hierarchy — brightest non-stellar outside-disc pixel < 0.85× center
 *
 * Usage: node checks-phase4.js [--viewport=1440x900] [--tier=cinematic] [--seed=7]
 */
'use strict';
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
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

// ---- color helpers (CIE76, same as phase2) ----
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function srgbToLab([r, g, b]) {
  const f = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [R, G, B] = [f(r), f(g), f(b)];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const g2 = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = g2(x), fy = g2(y), fz = g2(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function deltaE(a, b) {
  const A = srgbToLab(a), B = srgbToLab(b);
  return Math.sqrt((A[0] - B[0]) ** 2 + (A[1] - B[1]) ** 2 + (A[2] - B[2]) ** 2);
}
function chromaOf(rgb) {
  const [, a, b] = srgbToLab(rgb);
  return Math.sqrt(a * a + b * b);
}
function lumaOf([r, g, b]) {
  const lin = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Read the 13 live COLOR_SCRIPT targetCore values from the engine source.
function readTargets() {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'engine', 'moon.js'), 'utf8');
  const ms = [...src.matchAll(/targetCore: '(#[0-9A-Fa-f]{6})'/g)].map((m) => m[1]);
  if (ms.length !== 13) throw new Error(`expected 13 COLOR_SCRIPT targets, found ${ms.length}`);
  return ms;
}

async function main() {
  const { w, h, tier, seed } = parseArgs();
  const results = [];
  const check = (name, pass, detail) => {
    results.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  const targets = readTargets();
  const targetRgb = targets.map(hexToRgb);

  const url = pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href +
    `?seed=${seed}&tier=${tier}`;
  const browser = await pw.chromium.launch({
    headless: true,
    args: ['--allow-file-access-from-files', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e && e.message)));

  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__cmeBoot === true', null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(800);

  // ---- 1. boot ----
  const boot = await page.evaluate('({ boot: window.__cmeBoot, err: window.__cmeBootError })');
  check('1. boot, zero console errors', boot.boot === true && !boot.err && errors.length === 0,
    `boot=${boot.boot} err=${boot.err || 'none'} consoleErrors=${errors.length}` +
    (errors.length ? ` [${errors.join(' | ')}]` : ''));

  // ---- 2. ridge (viewport-normalized analytic) ----
  // Criterion (documented):
  //  - Chapters 4, 7, 10 (indices 3, 6, 9). renderFrame pins the chapter camera
  //    and chapter fog via the scroll-driven clock; we assert the live fog
  //    density equals the chapter spec (0.0012 / 0.0015 / 0.0017).
  //  - Eligible set defined in NORMALIZED screen space: for target depths
  //    [150..1800]m we scan azimuths across the horizontal frustum, project
  //    each terrain point, and keep |NDC.x|≤0.85 and |NDC.y|≤0.85 — the
  //    conservative 15% edge crop (drop only the 15% closest to the edges).
  //    (Phase-3's fixed world crests leave the frame on Phase-4's moving
  //    cameras — verified 0/3 eligible on mobile — so the crest concept is
  //    generalized to controlled-depth terrain samples in normalized space.)
  //  - Moon-disc exclusion in screen space (rPx+30px) so no sample hides
  //    behind the moon; raycast verifies the first solid hit is terrain.
  //  - Reprojection: the raycast hit is reprojected and required to lie
  //    ≥8px inside every viewport edge (the "small neighborhood" check).
  //  - Analytic haze (task-blessed alternative to pixel contrast): plain
  //    FogExp2 F(d)=1−exp(−(ρd)²) with the chapter's ρ; loss =
  //    (F(dmax)−F(dmin))/(1−F(dmin)). Gate ≥0.40 on BOTH viewports.
  //    Plain FogExp2 is conservative: the terrain shader adds height-boosted
  //    haze on top for low ground.
  const ridgeSpecs = [
    { idx: 3, rho: 0.0012 },
    { idx: 6, rho: 0.0015 },
    { idx: 9, rho: 0.0017 },
  ];
  let ridgeOk = true;
  const ridgeDetails = [];
  for (const { idx, rho: specRho } of ridgeSpecs) {
    const r = await page.evaluate(`(() => {
      const cme = window.__cme;
      const W = ${w}, H = ${h};
      cme.renderFrame(${idx} / 12 * 312);
      const rho = cme.env.getFogDensity();
      const v = new cme.THREE.Vector3();
      const fwd = new cme.THREE.Vector3();
      cme.camera.getWorldDirection(fwd);
      const A0 = Math.atan2(fwd.z, fwd.x);
      const halfH = Math.atan(Math.tan(cme.camera.fov * Math.PI / 360) * cme.camera.aspect);
      const moon = cme.moonScreen();
      const solids = [cme.env.terrain.mesh, cme.env.water.mesh,
                      cme.env.scatter.trees, cme.env.scatter.rocks];
      const rc = new cme.THREE.Raycaster();
      const acc = [];
      for (const rT of [150, 250, 400, 600, 900, 1200, 1500, 1800]) {
        let best = null;
        for (let az = A0 - halfH; az <= A0 + halfH; az += 0.005) {
          const x = Math.cos(az) * rT, z = Math.sin(az) * rT;
          const p = new cme.THREE.Vector3(x, cme.env.heightAt(x, z) + 2.5, z);
          v.copy(p).project(cme.camera);
          if (Math.abs(v.x) > 0.85 || Math.abs(v.y) > 0.85) continue;
          const sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
          if (Math.hypot(sx - moon.x, sy - moon.y) < moon.rPx + 30) continue;
          const score = Math.abs(v.x) + Math.abs(v.y) * 0.5;
          if (!best || score < best.score) best = { ndc: [v.x, v.y], score };
        }
        if (!best) continue;
        rc.setFromCamera(new cme.THREE.Vector2(best.ndc[0], best.ndc[1]), cme.camera);
        const first = rc.intersectObjects(solids, false)[0];
        if (!first || first.object !== cme.env.terrain.mesh) continue;
        v.copy(first.point).project(cme.camera);
        const sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
        if (sx < 8 || sx > W - 8 || sy < 8 || sy > H - 8) continue;
        if (Math.hypot(sx - moon.x, sy - moon.y) < moon.rPx + 30) continue;
        acc.push(first.distance);
      }
      acc.sort((a, b) => a - b);
      const F = (d) => 1 - Math.exp(-Math.pow(rho * d, 2));
      let loss = NaN;
      if (acc.length >= 2) {
        const Fn = F(acc[0]), Ff = F(acc[acc.length - 1]);
        loss = (Ff - Fn) / Math.max(1 - Fn, 1e-6);
      }
      return { rho, rhoOk: Math.abs(rho - ${specRho}) < 1e-9,
               n: acc.length,
               dMin: acc.length ? Math.round(acc[0]) : null,
               dMax: acc.length ? Math.round(acc[acc.length - 1]) : null,
               loss };
    })()`);
    const pass = r.rhoOk && r.n >= 2 && r.loss >= 0.40;
    ridgeOk = ridgeOk && pass;
    ridgeDetails.push(`ch${idx + 1}:loss=${r.loss.toFixed(3)} (n=${r.n}, ${r.dMin}-${r.dMax}m, ρ=${r.rho})`);
  }
  check('2. ridge analytic haze ≥40% (ch4/7/10)', ridgeOk, ridgeDetails.join(' | '));

  // ---- 3. determinism: four histories ending at t=12.5 ----
  const det = await page.evaluate(`(() => {
    const cme = window.__cme;
    const histories = [
      [0, 6, 12.5],
      [3, 9, 12.5],
      [12.5],
      [12, 12.4, 12.5],
    ];
    const bufs = histories.map((seq) => {
      let px = null;
      for (const t of seq) px = cme.renderFrame(t);
      return px.data;
    });
    const n = bufs[0].length;
    let maxDelta = 0, diffBytes = 0;
    for (let i = 0; i < n; i++) {
      let mn = 255, mx = 0;
      for (let b = 0; b < 4; b++) {
        const v = bufs[b][i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      const d = mx - mn;
      if (d > maxDelta) maxDelta = d;
      if (d > 0) diffBytes++;
    }
    return { maxDelta, diffBytes, bytes: n };
  })()`);
  check('3. determinism (4 histories → t=12.5, 6 pairs)', det.maxDelta <= 1,
    `maxDelta=${det.maxDelta} diffBytes=${det.diffBytes}/${det.bytes}`);

  // ---- 4-7. per-chapter moon samples ----
  const samples = await page.evaluate(`(() => {
    const cme = window.__cme;
    const res = [];
    for (let i = 0; i < 13; i++) {
      const px = cme.renderFrame(i / 12 * 312);
      const f = cme.moonScreen();
      const W = px.width, H = px.height, d = px.data;
      function avg(cx, cy, r) {
        let sr = 0, sg = 0, sb = 0, n = 0;
        cx = Math.round(cx); cy = Math.round(cy);
        for (let y = Math.max(0, cy - r); y < Math.min(H, cy + r); y++)
          for (let x = Math.max(0, cx - r); x < Math.min(W, cx + r); x++) {
            const dx = x - cx, dy = y - cy;
            if (dx * dx + dy * dy <= r * r) {
              const k = (y * W + x) * 4;
              sr += d[k]; sg += d[k + 1]; sb += d[k + 2]; n++;
            }
          }
        return n ? [sr / n, sg / n, sb / n] : [0, 0, 0];
      }
      const cx = f.x, cy = f.y, r = f.rPx;
      res.push({
        core: avg(cx, cy, Math.max(2, Math.round(r * 0.18))).map(Math.round),
        limb: avg(cx + r * 0.82, cy, 4).map(Math.round),
      });
    }
    cme.renderFrame(9 / 12 * 312); // restore hero
    return res;
  })()`);

  // ---- 4. color: 13 targets ΔE ≤10 ----
  let deMax = 0;
  const deList = samples.map((s, i) => {
    const de = deltaE(s.core, targetRgb[i]);
    deMax = Math.max(deMax, de);
    return `ch${i + 1}=${de.toFixed(1)}`;
  });
  check('4. color ΔE ≤10 (13 chapters)', deMax <= 10, deList.join(' '));

  // ---- 5. ch10 chroma > 2× every other ----
  const chromas = samples.map((s) => chromaOf(s.core));
  const c10 = chromas[9];
  const maxOther = Math.max(...chromas.filter((_, i) => i !== 9));
  check('5. ch10 chroma > 2× others', c10 > 2 * maxOther,
    `ch10=${c10.toFixed(1)} maxOther=${maxOther.toFixed(1)} ratio=${(c10 / maxOther).toFixed(2)}`);

  // ---- 6. ch13 dimmest ----
  const lumas = samples.map((s) => lumaOf(s.core));
  const minLuma = Math.min(...lumas);
  check('6. ch13 dimmest', lumas[12] === minLuma,
    `ch13=${lumas[12].toFixed(4)} min=${minLuma.toFixed(4)}`);

  // ---- 7. dark-limb (all except ch10) ----
  const limbViolations = [];
  samples.forEach((s, i) => {
    if (i === 9) return; // signed ch10 exempt
    if (!(lumaOf(s.limb) < lumaOf(s.core))) limbViolations.push(`ch${i + 1}`);
  });
  check('7. dark-limb (excl ch10)', limbViolations.length === 0,
    limbViolations.length ? `violations: ${limbViolations.join(',')}` : 'all 12 ok');

  // ---- 8. ch10 ember hierarchy ----
  // Brightest NON-STELLAR pixel outside the moon system (disc + halo, 3×rPx;
  // the halo is the moon's own glow, not an ember) must be <0.85× center luma.
  // Stars are isolated single-pixel point sources; embers are extended. A
  // pixel is treated as stellar (excluded) when it exceeds 2.5× the median
  // of its 7×7 neighborhood.
  const ember = await page.evaluate(`(() => {
    const cme = window.__cme;
    const px = cme.renderFrame(9 / 12 * 312);
    const f = cme.moonScreen();
    const W = px.width, H = px.height, d = px.data;
    const lin = (c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const lum = (x, y) => {
      const k = (y * W + x) * 4;
      return 0.2126 * lin(d[k]) + 0.7152 * lin(d[k + 1]) + 0.0722 * lin(d[k + 2]);
    };
    const cx = f.x, cy = f.y, rExcl = f.rPx * 3.0; // disc + halo
    // center luma (disc core)
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
    // brightest non-stellar outside-disc pixel (step 2 for speed)
    let maxL = 0, maxAt = null;
    for (let y = 3; y < H - 3; y += 2) {
      for (let x = 3; x < W - 3; x += 2) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= rExcl * rExcl) continue;
        const L = lum(x, y);
        if (L <= maxL) continue;
        // stellar test: compare against 7×7 neighborhood median
        const nb = [];
        for (let yy = y - 3; yy <= y + 3; yy += 2)
          for (let xx = x - 3; xx <= x + 3; xx += 2) nb.push(lum(xx, yy));
        nb.sort((a, b) => a - b);
        const med = nb[Math.floor(nb.length / 2)];
        if (L > 2.5 * Math.max(med, 1e-4)) continue; // isolated point source → star
        maxL = L; maxAt = [x, y];
      }
    }
    return { centerLuma: +centerLuma.toFixed(4), maxOutside: +maxL.toFixed(4),
             ratio: +(maxL / centerLuma).toFixed(3), maxAt };
  })()`);
  check('8. ch10 ember hierarchy (<0.85× center)', ember.ratio < 0.85,
    `center=${ember.centerLuma} brightest=${ember.maxOutside}@${ember.maxAt} ratio=${ember.ratio}`);

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed (${w}×${h})`);
  if (failed.length) {
    console.log('FAILED:', failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
}

main().catch((e) => { console.error('fatal:', e); process.exit(2); });
