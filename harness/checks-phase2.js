#!/usr/bin/env node
/**
 * Phase 2 conformance checks for the cinematic moon engine.
 *
 * 13 checks covering §1.1 (the moon), determinism, and the grep gate.
 * The bloom bake-off A/B is separate (see bakeoff.js).
 *
 * Usage: node checks-phase2.js [--viewport=1440x900] [--tier=cinematic] [--seed=7]
 */
'use strict';
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const pw = require('playwright');

// Signed Ch4 targets (sRGB).
const TARGETS = {
  core: [255, 90, 36],   // #FF5A24
  mid: [232, 62, 18],    // #E83E12
  limb: [168, 46, 16],   // #A82E10
};

// Thirteen-chapter fixtures (signed beat map, ΔE ≤ 8). From COLOR_SCRIPT targetCore,
// read live from the engine source so the fixture list can never go stale.
const CHAPTER_FIXTURES = (() => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'engine', 'moon.js'), 'utf8');
  const names = [...src.matchAll(/name: '([^']+)', ch: (\d+),/g)].map((m) => ({
    name: `Ch${m[2]} ${m[1]}`,
  }));
  const cores = [...src.matchAll(/targetCore: '(#[0-9A-Fa-f]{6})'/g)].map((m) => m[1]);
  if (names.length !== 13 || cores.length !== 13) {
    throw new Error(`expected 13 COLOR_SCRIPT entries, found ${names.length}/${cores.length}`);
  }
  return names.map((n, i) => {
    const h = cores[i].replace('#', '');
    return {
      name: n.name,
      core: [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)],
    };
  });
})();

function parseArgs() {
  const args = { viewport: '1440x900', tier: 'cinematic', seed: '7' };
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  const [w, h] = args.viewport.split('x').map(Number);
  return { ...args, w, h };
}

// CIE76 ΔE in Lab (approximate, sRGB D65).
function srgbToLab([r, g, b]) {
  const f = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  let [R, G, B] = [f(r), f(g), f(b)];
  // sRGB to XYZ D65
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / 1.0;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const g2 = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = g2(x), fy = g2(y), fz = g2(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE(a, b) {
  const [l1, a1, b1] = srgbToLab(a);
  const [l2, a2, b2] = srgbToLab(b);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

function saturation([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}

async function main() {
  const { w, h, tier, seed } = parseArgs();
  const results = [];
  const check = (name, pass, detail) => {
    results.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

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

  const boot = await page.evaluate('({ boot: window.__cmeBoot, err: window.__cmeBootError })');

  // 1. Boot
  check('1. boot', boot.boot === true && !boot.err,
    `boot=${boot.boot} err=${boot.err || 'none'} consoleErrors=${errors.length}`);

  // 2. Bake budget (from HUD log)
  const bakeMs = await page.evaluate(`(() => {
    const log = window.__cmeHudLog || [];
    const m = log.join('\\n').match(/bake: (\\d+)² in (\\d+) ms/);
    return m ? { res: +m[1], ms: +m[2] } : null;
  })()`);
  const budget = w >= 1280 ? 1500 : 3000;
  check('2. bake budget', !!bakeMs && bakeMs.ms <= budget,
    bakeMs ? `${bakeMs.res}² in ${bakeMs.ms}ms (budget ${budget}ms)` : 'no bake log');

  // Helper: sample disc regions
  const sample = await page.evaluate(`(() => {
    const cme = window.__cme;
    const px = cme.renderFrame(600);
    const f = cme.moonScreen();
    const W = px.width, H = px.height, d = px.data;
    function avg(cx, cy, r) {
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let y = Math.max(0, cy - r); y < Math.min(H, cy + r); y++)
        for (let x = Math.max(0, cx - r); x < Math.min(W, cx + r); x++) {
          const dx = x - cx, dy = y - cy;
          if (dx * dx + dy * dy <= r * r) {
            const i = (y * W + x) * 4;
            sr += d[i]; sg += d[i+1]; sb += d[i+2]; n++;
          }
        }
      return n ? [sr/n, sg/n, sb/n] : [0,0,0];
    }
    const cx = Math.round(f.x), cy = Math.round(f.y), r = f.rPx;
    // Sky sample: far from moon/halo (top of frame) for clean contrast.
    const sky = avg(Math.round(W * 0.5), Math.round(H * 0.12), 8);
    // Halo sample: 1.5 diameters = 3 radii from center.
    const halo = avg(Math.round(cx + r * 3.0), cy, 8);
    return {
      core: avg(cx, cy, Math.round(r * 0.2)),
      mid: avg(Math.round(cx + r * 0.55), cy, 6),
      limb: avg(Math.round(cx + r * 0.85), cy, 4),
      sky, halo,
      disc: { x: cx, y: cy, r: Math.round(r) },
      vw: W, vh: H,
    };
  })()`);
  const [cr, cg, cb] = sample.core.map(Math.round);

  // 3. Bake determinism — reload same seed, compare hashes
  const hash1 = await page.evaluate(`(() => {
    const log = (window.__cmeHudLog || []).join('\\n');
    const m = log.match(/hashAlbedo=(\\w+) hashNormal=(\\w+)/);
    return m ? m[1] + '/' + m[2] : null;
  })()`);
  // (Same-page re-bake would be expensive; we verify the hash is present and
  //  well-formed. Cross-run determinism is verified by run.js comparing two launches.)
  check('3. bake hash present', !!hash1, `hash=${hash1}`);

  // 4. Relief is real — two sun angles must differ
  const sunDiff = await page.evaluate(`(() => {
    const cme = window.__cme;
    const moon = cme.moon;
    function frameSig() {
      const px = cme.renderFrame(601);
      const f = cme.moonScreen();
      const W = px.width, H = px.height, d = px.data;
      let s = 0;
      const cx = Math.round(f.x), cy = Math.round(f.y), r = Math.round(f.rPx * 0.7);
      for (let y = cy - r; y < cy + r; y += 4)
        for (let x = cx - r; x < cx + r; x += 4) {
          const dx = x - cx, dy = y - cy;
          if (dx*dx + dy*dy < r*r) s += d[(y*W+x)*4];
        }
      return s;
    }
    const sun0 = moon.sphere.material.uniforms.uSunDir.value.clone();
    const s1 = frameSig();
    // Rotate sun 25° around Y.
    const v = sun0.clone().applyAxisAngle(new cme.THREE.Vector3(0,1,0), 0.44);
    moon.setSunDirection(v);
    const s2 = frameSig();
    moon.setSunDirection(sun0);
    return { s1: Math.round(s1), s2: Math.round(s2) };
  })()`);
  check('4. relief responds to sun', sunDiff.s1 !== sunDiff.s2,
    `sig ${sunDiff.s1} → ${sunDiff.s2}`);

  // 5. Chapter ΔE (Ch4 hero; others via setChapter)
  const chapters = await page.evaluate(`(() => {
    const cme = window.__cme;
    const out = [];
    for (let ch = 0; ch < 13; ch++) {
      cme.moon.setChapter(ch);
      const px = cme.renderFrame(610 + ch);
      const f = cme.moonScreen();
      const W = px.width, H = px.height, d = px.data;
      const cx = Math.round(f.x), cy = Math.round(f.y), r = Math.round(f.rPx * 0.2);
      let sr=0, sg=0, sb=0, n=0;
      for (let y = cy - r; y < cy + r; y++)
        for (let x = cx - r; x < cx + r; x++) {
          const dx=x-cx, dy=y-cy;
          if (dx*dx+dy*dy <= r*r) { const i=(y*W+x)*4; sr+=d[i]; sg+=d[i+1]; sb+=d[i+2]; n++; }
        }
      out.push([Math.round(sr/n), Math.round(sg/n), Math.round(sb/n)]);
    }
    cme.moon.setChapter(9); // restore hero (Ch10 vermilion)
    return out;
  })()`);
  let deMax = 0;
  const deList = chapters.map((c, i) => {
    const de = deltaE(c, CHAPTER_FIXTURES[i].core);
    deMax = Math.max(deMax, de);
    return `${CHAPTER_FIXTURES[i].name}=${de.toFixed(1)}`;
  });
  check('5. chapter ΔE ≤ 8', deMax <= 8, deList.join(' '));

  // 6. Disc diameter 28–30% viewport height
  const diamPct = (sample.disc.r * 2 / sample.vh) * 100;
  check('6. disc diameter 28–30%', diamPct >= 28 && diamPct <= 30,
    `${diamPct.toFixed(2)}% (r=${sample.disc.r}px, vh=${sample.vh})`);

  // 7. Contrast ≥ 40:1 (disc center vs adjacent sky, simple luminance ratio)
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const luma = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const skyLuma = Math.max(luma(sample.sky), 1e-4); // avoid div-by-zero
  const contrast = luma(sample.core) / skyLuma;
  check('7. contrast ≥ 40:1', contrast >= 40,
    `${contrast.toFixed(1)}:1 (core #${sample.core.map(Math.round).map(v=>v.toString(16).padStart(2,'0')).join('')} vs sky #${sample.sky.map(Math.round).map(v=>v.toString(16).padStart(2,'0')).join('')})`);

  // 8. Halo ≤ 6% at 1.5 diameters
  const haloRatio = luma(sample.halo) / luma(sample.core);
  check('8. halo ≤ 6% @1.5D', haloRatio <= 0.06,
    `${(haloRatio * 100).toFixed(2)}%`);

  // 9. Saturation discipline
  const moonSat = saturation(sample.core);
  check('9. moon saturation ≥ 0.55', moonSat >= 0.55, moonSat.toFixed(3));

  // 10. HDR audit — moon is the only object with emissive > 1
  const hdr = await page.evaluate(`(() => {
    const cme = window.__cme;
    let maxNonMoon = 0;
    cme.scene.traverse((o) => {
      if (o.userData && o.userData.moonSystem) return;
      const m = o.material;
      if (m && m.color) {
        const c = m.color;
        maxNonMoon = Math.max(maxNonMoon, c.r, c.g, c.b);
      }
      if (m && m.emissive) {
        maxNonMoon = Math.max(maxNonMoon, m.emissive.r, m.emissive.g, m.emissive.b);
      }
    });
    return { moonEmissiveMax: cme.moon.emissiveMax(), maxNonMoon };
  })()`);
  check('10. HDR discipline', hdr.moonEmissiveMax > 1 && hdr.maxNonMoon <= 1.05,
    `moon=${hdr.moonEmissiveMax.toFixed(2)} others≤${hdr.maxNonMoon.toFixed(2)}`);

  // 11. Terminator exact string in shader
  const shaderSrc = fs.readFileSync(path.resolve(__dirname, '..', 'engine', 'moon.js'), 'utf8');
  check('11. terminator exact', shaderSrc.includes('smoothstep(-0.05, 0.25, dot(N,L))'),
    'smoothstep(-0.05, 0.25, dot(N,L))');

  // 12. Moon grain ≤ 0.02 (two-frame difference cancels static texture)
  const grain = await page.evaluate(`(() => {
    const cme = window.__cme;
    function discPixels(frame) {
      const px = cme.renderFrame(frame);
      const f = cme.moonScreen();
      const W = px.width, H = px.height, d = px.data;
      const cx = Math.round(f.x), cy = Math.round(f.y), r = Math.round(f.rPx * 0.5);
      const vals = [];
      for (let y = cy - r; y < cy + r; y += 3)
        for (let x = cx - r; x < cx + r; x += 3) {
          const dx=x-cx, dy=y-cy;
          if (dx*dx+dy*dy <= r*r) {
            const i=(y*W+x)*4;
            vals.push((d[i]+d[i+1]+d[i+2])/3/255);
          }
        }
      return vals;
    }
    const a = discPixels(620), b = discPixels(621);
    let s = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) s += (a[i]-b[i])**2;
    const rms = Math.sqrt(s / Math.min(a.length, b.length)) / Math.SQRT2;
    return rms;
  })()`);
  check('12. moon grain ≤ 0.02', grain <= 0.02, `rms=${grain.toFixed(4)}`);

  // 13. Grep gate — no clocks/random in engine/
  const engineDir = path.resolve(__dirname, '..', 'engine');
  const bad = [];
  for (const f of fs.readdirSync(engineDir)) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(engineDir, f), 'utf8');
    // Strip comments to avoid false positives.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const pat of ['Math.random', 'Date.now', 'performance.now']) {
      if (code.includes(pat)) bad.push(`${f}:${pat}`);
    }
  }
  check('13. grep gate', bad.length === 0, bad.join(', ') || 'clean');

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('FAILED:', failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
}

main().catch((e) => { console.error('fatal:', e); process.exit(2); });
