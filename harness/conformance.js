/* harness/conformance.js — browser-side conformance probes.
 *
 * Classic script (no imports; loaded via addScriptTag by harness/run.js).
 * Attaches to window.CME. Implements the FINAL-PLAN §1 pixel probes:
 *   - engine.screenshot(): capture the #scene canvas
 *   - 5×5 px average sampling, disc-to-sky contrast ratio
 *   - palette census (saturation histogram: % of non-moon, non-lantern
 *     pixels > 0.55 saturation)
 *   - grain measurement (black-patch variance; moon-disc grain ≤ 0.02)
 *   - vignette measurement (corner darkening %, onset radius)
 *   - halo profile (luminance at 1.5 disc diameters vs disc center ≤ 6%)
 *
 * Phase 0: probes are defined and self-tested against synthetic fixtures;
 * later phases run them against real render(t) frames. The determinism
 * fixture uses the REAL engine seed.js (dynamic import, page-relative URL).
 */
(function () {
  'use strict';

  var CME = (window.CME = window.CME || {});

  /* ---------- engine access (real seed.js, page-relative) ---------- */

  var _seedMod = null;
  async function engineSeed() {
    if (!_seedMod) {
      var url = new URL('engine/seed.js', window.location.href).href;
      _seedMod = await import(url);
    }
    return _seedMod;
  }
  CME.engineSeed = engineSeed;

  /* ---------- screenshot ---------- */

  /**
   * Capture the #scene canvas. NOTE: without preserveDrawingBuffer the
   * buffer may read back blank if composited already — Phase 1+ sets the
   * flag or captures inside the frame. Returns { dataUrl, width, height,
   * imageData } (imageData null when unavailable).
   */
  CME.screenshot = function () {
    var canvas = document.getElementById('scene');
    if (!canvas) return { ok: false, reason: 'no #scene canvas' };
    var out = {
      ok: true,
      width: canvas.width,
      height: canvas.height,
      dataUrl: null,
      imageData: null,
    };
    try {
      out.dataUrl = canvas.toDataURL('image/png');
      var ctx = canvas.getContext('2d');
      if (ctx) out.imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch (e) {
      out.readbackError = String(e);
    }
    return out;
  };
  // Alias required by the task: engine.screenshot()
  (window.engine = window.engine || {}).screenshot = CME.screenshot;

  /* ---------- deterministic fixture (synthetic, seed 7) ---------- */

  /**
   * Draw a deterministic RGB fixture with the engine's own Rng.
   * Two runs with the same seed must be pixel-identical ±1 luma on the
   * same device (Phase 1 determinism smoke test, §1.4).
   * Returns a plain Array of bytes (structured-cloneable).
   */
  CME.fixturePixels = async function (seed, w, h) {
    seed = seed == null ? 7 : seed;
    w = w || 64; h = h || 64;
    var mod = await engineSeed();
    var rng = new mod.Rng(seed);
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    var img = ctx.createImageData(w, h);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      d[i] = Math.floor(rng.float() * 256);
      d[i + 1] = Math.floor(rng.float() * 256);
      d[i + 2] = Math.floor(rng.float() * 256);
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return Array.prototype.slice.call(d);
  };

  /* ---------- pixel math ---------- */

  function px(img, x, y) {
    x = Math.max(0, Math.min(img.width - 1, x | 0));
    y = Math.max(0, Math.min(img.height - 1, y | 0));
    var i = (y * img.width + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  }

  /** 5×5 px average around (x, y) → [r, g, b] (0–255). */
  CME.avg5x5 = function (img, x, y) {
    var r = 0, g = 0, b = 0, n = 0;
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        var c = px(img, x + dx, y + dy);
        r += c[0]; g += c[1]; b += c[2]; n++;
      }
    }
    return [r / n, g / n, b / n];
  };

  /** Rec.709 luma, 0–1. */
  CME.luma = function (rgb) {
    return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  };

  /** WCAG-style contrast ratio of two 0–1 lumas. */
  CME.contrastRatio = function (l1, l2) {
    var a = Math.max(l1, l2), b = Math.min(l1, l2);
    return (a + 0.05) / (b + 0.05);
  };

  /** HSV-style saturation 0–1 of an [r,g,b] 0–255 triplet. */
  CME.saturation = function (rgb) {
    var mx = Math.max(rgb[0], rgb[1], rgb[2]);
    var mn = Math.min(rgb[0], rgb[1], rgb[2]);
    return mx === 0 ? 0 : (mx - mn) / mx;
  };

  /**
   * Palette census: fraction of sampled pixels with saturation > threshold,
   * skipping masked regions. mask(x, y) → true means "skip this pixel"
   * (used for moon bounding box / lanterns). Spec §1.1: fail if > 2% of
   * non-moon, non-lantern pixels exceed 0.55 saturation.
   */
  CME.paletteCensus = function (img, opts) {
    opts = opts || {};
    var threshold = opts.saturationThreshold == null ? 0.55 : opts.saturationThreshold;
    var mask = opts.mask || null;
    var step = opts.step || 4;
    var total = 0, over = 0;
    for (var y = 0; y < img.height; y += step) {
      for (var x = 0; x < img.width; x += step) {
        if (mask && mask(x, y)) continue;
        total++;
        if (CME.saturation(px(img, x, y)) > threshold) over++;
      }
    }
    return { total: total, over: over, fraction: total ? over / total : 0, threshold: threshold };
  };

  /**
   * Grain measurement: variance of luma over a patch (0–1 scale).
   * Black-patch variance ≈ 0 is required (true zero in crushed blacks);
   * moon-disc grain ≤ 0.02 (non-negotiable, §1.3).
   */
  CME.patchVariance = function (img, x, y, w, h) {
    var vals = [];
    for (var j = y; j < y + h && j < img.height; j++) {
      for (var i = x; i < x + w && i < img.width; i++) {
        vals.push(CME.luma(px(img, i, j)));
      }
    }
    if (!vals.length) return { n: 0, mean: 0, variance: 0 };
    var mean = vals.reduce(function (s, v) { return s + v; }, 0) / vals.length;
    var v = vals.reduce(function (s, val) { return s + (val - mean) * (val - mean); }, 0) / vals.length;
    return { n: vals.length, mean: mean, variance: v };
  };

  /**
   * Vignette measurement: corner darkening % vs center, plus onset radius
   * estimate (fraction of half-diagonal where darkening first exceeds 5%).
   * Spec §1.3: corners 40–48% darkened, onset 0.60–0.64 half-diagonal.
   */
  CME.vignetteMeasure = function (img) {
    var cx = img.width / 2, cy = img.height / 2;
    var halfDiag = Math.hypot(cx, cy);
    var center = CME.luma(CME.avg5x5(img, cx | 0, cy | 0));
    var corners = [
      [8, 8], [img.width - 9, 8], [8, img.height - 9], [img.width - 9, img.height - 9],
    ].map(function (p) { return CME.luma(CME.avg5x5(img, p[0], p[1])); });
    var cornerMean = corners.reduce(function (s, v) { return s + v; }, 0) / corners.length;
    var darkening = center > 0 ? 1 - cornerMean / center : 0;
    // Onset: walk the diagonal from center, find first r with >5% darkening.
    var onset = 1;
    for (var k = 1; k <= 40; k++) {
      var r = (k / 40) * halfDiag;
      var ang = Math.atan2(cy, cx);
      var l = CME.luma(CME.avg5x5(img, (cx + r * Math.cos(ang)) | 0, (cy + r * Math.sin(ang)) | 0));
      if (center > 0 && 1 - l / center > 0.05) { onset = r / halfDiag; break; }
    }
    return { centerLuma: center, cornerLuma: cornerMean, cornerDarkening: darkening, onsetRadius: onset };
  };

  /**
   * Halo profile: luma at 1.5 disc diameters from center vs disc center.
   * Spec §1.1: ≤ 6%.
   */
  CME.haloProfile = function (img, cx, cy, discRadiusPx) {
    var center = CME.luma(CME.avg5x5(img, cx | 0, cy | 0));
    var at = CME.luma(CME.avg5x5(img, (cx + 1.5 * 2 * discRadiusPx) | 0, cy | 0));
    return { center: center, at1_5diameters: at, ratio: center > 0 ? at / center : 0 };
  };

  /* ---------- Phase 1: real-scene determinism ---------- */

  /**
   * Two ACTUAL scene render(t) runs via window.__cme.renderFrame(frame):
   * pixel-identical within ±1 luma on the same device (Phase 1 exit check f).
   * The frame clock is the only time source, so identical frames must match.
   */
  CME.sceneDeterminism = async function (frame) {
    frame = frame == null ? 120 : frame;
    var cme = window.__cme;
    if (!cme || !cme.renderFrame) return { pass: false, error: 'no __cme.renderFrame hook' };
    var a = cme.renderFrame(frame);
    var b = cme.renderFrame(frame);
    if (a.width !== b.width || a.height !== b.height) {
      return { pass: false, error: 'readback size mismatch between runs' };
    }
    var maxDelta = 0;
    var da = a.data, db = b.data;
    for (var i = 0; i < da.length; i += 4) {
      var la = 0.2126 * da[i] + 0.7152 * da[i + 1] + 0.0722 * da[i + 2];
      var lb = 0.2126 * db[i] + 0.7152 * db[i + 1] + 0.0722 * db[i + 2];
      var d = Math.abs(la - lb);
      if (d > maxDelta) maxDelta = d;
    }
    return { frame: frame, pixels: da.length / 4, maxLumaDelta: maxDelta, pass: maxDelta <= 1 };
  };

  /* ---------- self test (synthetic) ---------- */

  CME.selfTest = async function () {
    var details = {};
    var pass = true;
    function check(name, cond, extra) {
      details[name] = { pass: !!cond, extra: extra == null ? '' : extra };
      if (!cond) pass = false;
    }
    // avg5x5 on a known field
    var c = document.createElement('canvas'); c.width = 9; c.height = 9;
    var ctx = c.getContext('2d');
    var img = ctx.createImageData(9, 9);
    for (var i = 0; i < img.data.length; i += 4) {
      img.data[i] = 200; img.data[i + 1] = 100; img.data[i + 2] = 50; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    var got = ctx.getImageData(0, 0, 9, 9);
    var avg = CME.avg5x5(got, 4, 4);
    check('avg5x5', Math.abs(avg[0] - 200) < 1 && Math.abs(avg[1] - 100) < 1 && Math.abs(avg[2] - 50) < 1, avg);
    // contrast black vs white ≈ 21
    var cr = CME.contrastRatio(CME.luma([255, 255, 255]), CME.luma([0, 0, 0]));
    check('contrastRatio', Math.abs(cr - 21) < 0.01, cr);
    // saturation of pure red = 1, of gray = 0
    check('saturation', CME.saturation([255, 0, 0]) === 1 && CME.saturation([128, 128, 128]) === 0, '');
    // determinism: two fixture runs, seed 7, ±1 luma
    var a = await CME.fixturePixels(7);
    var b = await CME.fixturePixels(7);
    var maxDelta = 0;
    for (var k = 0; k < a.length; k += 4) {
      var la = 0.2126 * a[k] + 0.7152 * a[k + 1] + 0.0722 * a[k + 2];
      var lb = 0.2126 * b[k] + 0.7152 * b[k + 1] + 0.0722 * b[k + 2];
      var dl = Math.abs(la - lb);
      if (dl > maxDelta) maxDelta = dl;
    }
    check('determinism(seed7)', maxDelta <= 1, 'max luma delta=' + maxDelta.toFixed(3));
    // palette census on the fixture: mostly saturated random pixels
    var cen = CME.paletteCensus(got, { step: 1 });
    check('paletteCensus', cen.total === 81, cen);
    // patch variance of a flat patch ≈ 0
    var pv = CME.patchVariance(got, 0, 0, 9, 9);
    check('patchVariance(flat)', pv.variance < 1e-9, pv.variance);
    return { pass: pass, details: details };
  };
})();
