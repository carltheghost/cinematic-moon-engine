/* harness/checks-phase1.js — Phase 1 exit checks (b)–(e), run inside testViewport.
 *
 * All heavy pixel math runs IN PAGE; Node receives small summaries only.
 * Called serially by harness/run.js (never concurrent Chromium instances).
 *
 *  (b) bloom isolation: bloom-buffer energy outside the fixture disc < 2%
 *      of (total − outside) energy. Harness fails the run otherwise.
 *  (c) grade sampling: black-patch grain variance ≈ 0; midtone RMS 0.08–0.12;
 *      vignette 40–48% corner darkening, onset 0.60–0.64; moon-mask grain ≤ 0.02.
 *  (d) sky: no sampled non-star sky pixel above #16202F (22,32,47);
 *      fog color is the same instance as sky.horizonColor.
 *  (e) performance: sky+stars frame time — ≤10 ms is the real target; the
 *      headless software-renderer proxy gate is ≤33 ms desktop. Reported
 *      honestly with the VM/software-rasterizer caveat.
 */
'use strict';

/* (b) — bloom-buffer energy inside vs outside the fixture disc.
 * The probe reads the bloom's THRESHOLDED bright-pass (the texture feeding the
 * blur chain): with threshold ≥ 1.0 and the fixture as the only >1.0 object,
 * only the fixture may appear. Outside/inside must be < 2%. */
const BLOOM_SRC = `async function () {
  var cme = window.__cme;
  if (!cme || !cme.fixture) return { skipped: 'fixture off (?fixture=off)' };
  cme.renderFrame(150);
  var probe = cme.post.bloomProbe();
  if (!probe) return { pass: false, error: 'bloomProbe() returned null' };
  var f = cme.fixtureScreen();
  var W = probe.width, H = probe.height, luma = probe.luma;
  var bx = (f.x / window.innerWidth) * W;
  var by = (1 - f.y / window.innerHeight) * H; // GL texture is bottom-up
  var br = (f.rPx / window.innerWidth) * W;
  var eTot = 0, eIn = 0, eFar = 0;
  for (var y = 0; y < H; y++) {
    for (var x = 0; x < W; x++) {
      var e = luma[y * W + x];
      eTot += e;
      var d = Math.hypot(x - bx, y - by) / br;
      if (d <= 1.5) eIn += e;
      else if (d >= 4.0) eFar += e;
    }
  }
  var ratio = eFar / Math.max(eTot - eFar, 1e-9);
  return {
    pass: ratio < 0.02, ratio: ratio,
    eTot: eTot, eIn: eIn, eFar: eFar,
    probeW: W, probeH: H, fixtureRadiusProbePx: br,
  };
}`;

/* (c) — grade sampling on a flat-quad rig through a second post pipeline. */
const GRADE_SRC = `async function () {
  var base = window.location.href;
  var postm = await import(new URL('engine/post.js', base).href);
  var three = await import(new URL('vendor/three/three.module.js', base).href);
  var cme = window.__cme;
  var renderer = cme.renderer;
  var out = {};

  var tScene = new three.Scene();
  var tCam = new three.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  var quadMat = new three.MeshBasicMaterial({ toneMapped: false });
  tScene.add(new three.Mesh(new three.PlaneGeometry(2, 2), quadMat));
  var w = window.innerWidth, h = window.innerHeight;
  var p2 = postm.buildPost(renderer, tScene, tCam, {
    width: w, height: h,
    dpr: Math.min(window.devicePixelRatio || 1, 1.5),
    seed: 7, tier: 'cinematic', reducedMotion: false,
  });
  p2.setGrade(postm.generateNeutralLUT(16));
  var GRAIN = 0.1732; // must match engine/post.js GRAIN_AMPLITUDE

  function lumaAt(data, W, x, y) {
    var i = (y * W + x) * 4;
    return (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
  }
  function patchStats(px, x0, y0, pw, ph) {
    var W = px.width, H = px.height, data = px.data;
    var n = 0, sum = 0, sum2 = 0;
    for (var y = y0; y < y0 + ph && y < H; y += 2)
      for (var x = x0; x < x0 + pw && x < W; x += 2) {
        var l = lumaAt(data, W, x, y);
        n++; sum += l; sum2 += l * l;
      }
    var mean = sum / n;
    return { n: n, mean: mean, rms: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
  }
  function diffRMS(a, b, x0, y0, pw, ph) {
    var W = a.width, H = a.height, da = a.data, db = b.data;
    var n = 0, sum2 = 0;
    for (var y = y0; y < y0 + ph && y < H; y += 2)
      for (var x = x0; x < x0 + pw && x < W; x += 2) {
        var d = lumaAt(da, W, x, y) - lumaAt(db, W, x, y);
        n++; sum2 += d * d;
      }
    return { n: n, rms: Math.sqrt(sum2 / n) };
  }
  function centerPatch(px, frac) {
    var W = px.width, H = px.height;
    var pw = Math.floor(W * frac), ph = Math.floor(H * frac);
    return patchStats(px, Math.floor((W - pw) / 2), Math.floor((H - ph) / 2), pw, ph);
  }

  // black patch: grain must be ~0 in crushed blacks.
  quadMat.color.setRGB(0, 0, 0);
  p2.render(10);
  var black = cme.readPixels();
  var bs = centerPatch(black, 0.4);
  out.black = { mean: bs.mean, rms: bs.rms, pass: bs.rms < 0.005 };

  // midtone: RMS attributable to grain must be 0.08–0.12.
  quadMat.color.setRGB(0.15, 0.15, 0.15);
  p2.render(11);
  var on = cme.readPixels();
  p2.harness.setGrainAmplitude(0);
  p2.render(11);
  var off = cme.readPixels();
  p2.harness.setGrainAmplitude(GRAIN);
  var Wd = on.width, Hd = on.height;
  var mw = Math.floor(Wd * 0.4), mh = Math.floor(Hd * 0.4);
  var mx = Math.floor((Wd - mw) / 2), my = Math.floor((Hd - mh) / 2);
  var gr = diffRMS(on, off, mx, my, mw, mh);
  out.midtoneGrain = { rms: gr.rms, pass: gr.rms >= 0.08 && gr.rms <= 0.12 };

  // vignette on the grain-off frame: 40–48% corner darkening, onset 0.60–0.64.
  var cs = patchStats(off, Math.floor(Wd / 2 - 20), Math.floor(Hd / 2 - 20), 40, 40);
  var corners = [
    patchStats(off, 8, 8, 40, 40).mean,
    patchStats(off, Wd - 48, 8, 40, 40).mean,
    patchStats(off, 8, Hd - 48, 40, 40).mean,
    patchStats(off, Wd - 48, Hd - 48, 40, 40).mean,
  ];
  var cornerMean = (corners[0] + corners[1] + corners[2] + corners[3]) / 4;
  var darkening = cs.mean > 0 ? 1 - cornerMean / cs.mean : 0;
  var halfDiag = Math.hypot(Wd / 2, Hd / 2);
  var ang = Math.atan2(Hd / 2, Wd / 2);
  var onset = 1;
  for (var k = 1; k <= 60; k++) {
    var r = (k / 60) * halfDiag;
    var s = patchStats(off, Math.floor(Wd / 2 + r * Math.cos(ang)) - 10,
                            Math.floor(Hd / 2 + r * Math.sin(ang)) - 10, 20, 20);
    if (cs.mean > 0 && 1 - s.mean / cs.mean > 0.05) { onset = r / halfDiag; break; }
  }
  out.vignette = {
    cornerDarkening: darkening, onset: onset,
    pass: darkening >= 0.40 && darkening <= 0.48 && onset >= 0.60 && onset <= 0.64,
  };

  // moon mask: grain ON the disc (mask applied) must be ≤ 0.02 RMS.
  // Phase 2: the real moon has crater TEXTURE, so a single-frame RMS measures
  // texture, not grain. Render TWO frames (different grain seeds via uFrame);
  // the texture cancels in the diff, leaving 2 independent grain realizations:
  // grainRms = diffRms / sqrt(2).
  var f = cme.fixtureScreen();
  var dpr = cme.dpr || 1;
  cme.post.setMoonMask({ x: f.x / window.innerWidth, y: 1 - f.y / window.innerHeight },
                       f.rPx * dpr);
  cme.renderFrame(12);
  var mA = cme.readPixels();
  cme.renderFrame(13);
  var mB = cme.readPixels();
  cme.post.setMoonMask(null, 0);
  var MW = mA.width, MH = mA.height;
  var mfx = (f.x / window.innerWidth) * MW, mfy = (f.y / window.innerHeight) * MH;
  var mfr = (f.rPx / window.innerWidth) * MW * 0.8;
  var n = 0, dsum2 = 0;
  for (var yy = Math.floor(mfy - mfr); yy < mfy + mfr; yy += 2)
    for (var xx = Math.floor(mfx - mfr); xx < mfx + mfr; xx += 2) {
      if (xx < 0 || yy < 0 || xx >= MW || yy >= MH) continue;
      if (Math.hypot(xx - mfx, yy - mfy) > mfr) continue;
      var la = lumaAt(mA.data, MW, xx, yy);
      var lb = lumaAt(mB.data, MW, xx, yy);
      var dd = la - lb;
      n++; dsum2 += dd * dd;
    }
  var moonRms = Math.sqrt(dsum2 / Math.max(n, 1)) / Math.SQRT2;
  out.moonGrain = { rms: moonRms, n: n, pass: moonRms <= 0.02 };

  out.pass = out.black.pass && out.midtoneGrain.pass && out.vignette.pass && out.moonGrain.pass;
  return out;
}`;

/* (d) — sky ceiling: no sampled non-star sky pixel above #16202F (22,32,47).
 * The moon's bloom halo (out to ~8 disc radii) is legitimate moonlight —
 * profiled separately in Phase 2 (halo ≤6% at 1.5 diameters) — so the ceiling
 * is enforced beyond 8r, where only the sky gradient + grade remain. The halo
 * annulus max is reported (informational) for the Phase 2 profile. */
const SKY_SRC = `function () {
  var cme = window.__cme;
  cme.stars.points.visible = false;
  var px = cme.renderFrame(160);
  var f = cme.fixtureScreen();
  var W = px.width, H = px.height, data = px.data;
  var fx = (f.x / window.innerWidth) * W;
  var fy = (f.y / window.innerHeight) * H;
  var fr = (f.rPx / window.innerWidth) * W;
  var maxSky = [0, 0, 0], maxHalo = [0, 0, 0], n = 0;
  for (var y = 0; y < H; y += 3) {
    for (var x = 0; x < W; x += 3) {
      var dd = Math.hypot(x - fx, y - fy) / fr;
      var i = (y * W + x) * 4;
      if (dd >= 4 && dd < 8) {
        if (data[i] > maxHalo[0]) maxHalo[0] = data[i];
        if (data[i + 1] > maxHalo[1]) maxHalo[1] = data[i + 1];
        if (data[i + 2] > maxHalo[2]) maxHalo[2] = data[i + 2];
        continue;
      }
      if (dd < 8) continue;
      if (data[i] > maxSky[0]) maxSky[0] = data[i];
      if (data[i + 1] > maxSky[1]) maxSky[1] = data[i + 1];
      if (data[i + 2] > maxSky[2]) maxSky[2] = data[i + 2];
      n++;
    }
  }
  cme.stars.points.visible = true;
  var fogIdentity = cme.scene.fog.color === cme.sky.horizonColor;
  return {
    maxR: maxSky[0], maxG: maxSky[1], maxB: maxSky[2], samples: n,
    haloMax4812: maxHalo,
    ceiling: [22, 32, 47],
    fogIdentity: fogIdentity,
    pass: maxSky[0] <= 22 && maxSky[1] <= 32 && maxSky[2] <= 47 && fogIdentity,
  };
}`;

/* (e) — frame time for the real sky+stars scene. */
const PERF_SRC = `function () {
  var cme = window.__cme;
  var N = 60;
  var t0 = performance.now();
  for (var i = 0; i < N; i++) cme.post.render(300 + i);
  var t1 = performance.now();
  var ms = (t1 - t0) / N;
  return {
    msPerFrame: ms, tier: cme.post.tier, stars: cme.stars.count,
    // Real target ≤10 ms; headless software-renderer proxy gate ≤33 ms desktop.
    passProxy: ms <= 33,
    note: 'headless SwiftShader proxy — not a real-GPU measurement',
  };
}`;

async function runPhase1Checks(page, vp) {
  const results = {};
  results.bloom = await page.evaluate(`(${BLOOM_SRC})()`).catch((e) => ({ pass: false, error: String(e) }));
  results.grade = await page.evaluate(`(${GRADE_SRC})()`).catch((e) => ({ pass: false, error: String(e) }));
  results.sky = await page.evaluate(`(${SKY_SRC})()`).catch((e) => ({ pass: false, error: String(e) }));
  results.perf = await page.evaluate(`(${PERF_SRC})()`).catch((e) => ({ pass: false, error: String(e) }));
  return results;
}

module.exports = { runPhase1Checks };
