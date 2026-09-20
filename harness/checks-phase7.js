#!/usr/bin/env node
/**
 * Phase 7 conformance checks — second-scene generalization via the explicit
 * extension mechanism (merged-ruling Phase 6, Phase 7 launch).
 *
 * P71. CANONICAL REGRESSION THROUGH THE NEW SEAMS: index.html with no ?scene=
 *      and with ?scene=mimas render ch1/ch10/ch13 pixel-identical to each
 *      other AND to the pre-Phase-7 corpus baselines (embedded fixtures —
 *      captured from the cme-replay/1 corpus BEFORE any Phase 7 engine edit,
 *      so re-recording cannot mask a regression).
 * P72. COLOR-SCRIPT INJECTION (moon.js gap 2): setColorScript() produces a
 *      deterministic, config-driven frame (double-render identical, differs
 *      from default); null restores the frozen COLOR_SCRIPT; invalid scripts
 *      throw; the default moon carries COLOR_SCRIPT by identity.
 * P73. CLOCK PARAMETERIZATION (presentation.js gap 3): canonicalPresentation
 *      accepts { chapterCount, simDuration } — analytic asserts for a 10/240
 *      clock and float-identity of the 13/312 default.
 * P74. CAMERA LOCATOR INJECTION (camera.js gap 4): evaluate() routes through
 *      the injected chapterLocator — default path matches the frozen
 *      chapterAt mapping; a custom locator redefines the raw-scroll mapping.
 * P75. REPLAY IDENTITY INCLUDES DPR (GPT note 1): the re-recorded corpus is
 *      format cme-replay/3 with viewport.dpr + scene + clock + bakeRes fields.
 * P76. AUTO-TIER ADVISORY STAYS VISIBLE (GPT note 2): replay.js documents
 *      that auto-mode records can fail resolved-tier comparison elsewhere;
 *      docs/scene-extension.md carries the advisory section.
 * P77. ECLIPSE ACT THROUGH THE MAIN PAGE (?scene=eclipse-act): boots clean,
 *      scene id + injected color script + blood-moon hook engaged,
 *      renderFrame(156) deterministic, disc-center strongly red, frame
 *      differs from the canonical scene (config-driven).
 *
 * Usage: node checks-phase7.js [--viewport=1440x900] [--seed=7]
 */
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
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

/* Pre-Phase-7 canonical baselines (cme-replay/1 corpus, seed 7,
 * tier=cinematic, RM off) — captured BEFORE any Phase 7 engine edit.
 * Key: `${chapter}-${viewport}` → full pixel sha256. */
const FIXTURES = {
  '1-1440x900': 'b1d892ed88931e1d7336d22b90efef514c18820db738904a541686ead48bcac1',
  '1-390x844': 'ac6c4cb3386c99945ce15cb5dec736b42061d865cbf5081db8ebee92adfdc533',
  '10-1440x900': 'e7e936a9ff9c8a5e0d670282673fd12c26412951be552ca0a1c2a446417b4a73',
  '10-390x844': 'bf7b35e4983c434e3d9aa4693901e0af0f516b014dd9e30e40557fe994e04964',
  '13-1440x900': 'e7cb195cf26f833b12e3a89b80458ea9e4edb0eb3fcb4ea4393c044182a851ee',
  '13-390x844': '7d06197c6b730d71838976cdfb89e408659f888354edb81690988b28332f6658',
};
const CHAPTER_T = { 1: 0, 10: 234, 13: 312 }; // sim-seconds — byte-identical to
// pre-Phase-7 harness/replay.js chapterT(ch) = ((ch-1)/12)*312 (ch1→0, ch10→234,
// ch13→312). The fixtures below were captured with that mapping; it must stay.

const sha = (data) => crypto.createHash('sha256').update(Buffer.from(data)).digest('hex');
const maxDelta = (a, b) => {
  let m = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > m) m = d; }
  return m;
};

async function main() {
  const { w, h, seed } = parseArgs();
  const vp = `${w}x${h}`;
  const results = [];
  const check = (name, pass, detail) => {
    results.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  const browser = await launchBrowser();

  // ---------- P71: canonical regression through the new seams ----------
  let canon156 = null;
  {
    // Serial: boot → hash → close. Never hold two pages open at once —
    // each page carries a 2048² moon bake and the VM's memory commit limit
    // punishes concurrent heavy pages with renderer kills.
    const shas = {};
    for (const [label, extraQuery] of [['default (?scene= unset)', ''], ['?scene=mimas', '&scene=mimas']]) {
      // Phase 7 bake pin: pixel-identity assertions need a deterministic
      // bake resolution — the wall-clock budget fallback would flip pixels.
      const { page, errors, bootOk } = await bootPage(browser, w, h,
        { tier: 'cinematic', seed, extraQuery, bakeRes: 2048 });
      check(`P71a. canonical page boots clean — ${label}`, bootOk,
        errors.length ? `[${errors.join(' | ')}]` : 'clean');
      if (!bootOk) { shas[label] = null; await page.close(); continue; }
      shas[label] = {};
      for (const ch of [1, 10, 13]) {
        const t = CHAPTER_T[ch];
        const px = await page.evaluate(`(() => {
          const cme = window.__cme;
          const maxY = document.documentElement.scrollHeight - innerHeight;
          return cme.renderAtScrollY((${t} / 312) * maxY).pixels.data;
        })()`);
        shas[label][ch] = sha(px);
      }
      // Extra t=156 frame for the P77 config-driven-difference check.
      const px156 = await page.evaluate(`(() => {
        const cme = window.__cme;
        const maxY = document.documentElement.scrollHeight - innerHeight;
        return cme.renderAtScrollY((156 / 312) * maxY).pixels.data;
      })()`);
      if (label.startsWith('default')) canon156 = sha(px156);
      await page.close();
    }
    const A = shas['default (?scene= unset)'], B = shas['?scene=mimas'];
    for (const ch of [1, 10, 13]) {
      const fix = FIXTURES[`${ch}-${vp}`];
      check(`P71b. ch${ch}: ?scene=mimas ≡ default page`, !!A && !!B && A[ch] === B[ch],
        A && B ? `sha ${String(A[ch]).slice(0, 12)}…` : 'boot failed');
      check(`P71c. ch${ch}: identical RGBA to pre-Phase-7 baseline`, !!A && A[ch] === fix,
        A ? (A[ch] === fix ? `sha ${A[ch].slice(0, 12)}… matches` : `MISMATCH ${A[ch].slice(0, 16)}… vs ${fix.slice(0, 16)}…`) : 'boot failed');
    }
  }

  // ---------- P72: color-script injection ----------
  {
    const { page, errors, bootOk } = await bootPage(browser, w, h, { tier: 'cinematic', seed });
    check('P72a. canonical page boots clean (color-script checks)', bootOk,
      errors.length ? `[${errors.join(' | ')}]` : 'clean');
    if (bootOk) {
      const r = await page.evaluate(`(() => {
        const cme = window.__cme;
        const out = {};
        out.defaultIsFrozen = cme.moon.colorScript === cme.moonm.COLOR_SCRIPT;
        const maxY = document.documentElement.scrollHeight - innerHeight;
        const renderCh10 = () => cme.renderAtScrollY((234 / 312) * maxY).pixels.data;

        // Derive an injected script from the frozen one (pure transform).
        const derived = cme.moonm.COLOR_SCRIPT.map((k) => ({
          ...k,
          emissive: k.emissive.map((v) => v * 0.5),
          rampCore: k.rampCore.slice(), rampMid: k.rampMid.slice(),
          rampEdge: k.rampEdge.slice(), fresnel: k.fresnel.slice(),
          haloTint: k.haloTint.slice(),
        }));
        const px1 = renderCh10();
        cme.moon.setColorScript(derived);
        out.injectedActive = cme.moon.colorScript !== cme.moonm.COLOR_SCRIPT;
        const px2 = renderCh10();
        const px3 = renderCh10();
        let d23 = 0, d12 = 0;
        for (let i = 0; i < px2.length; i++) {
          d23 = Math.max(d23, Math.abs(px2[i] - px3[i]));
          d12 = Math.max(d12, Math.abs(px1[i] - px2[i]));
        }
        out.detMaxDelta = d23;
        out.drivenMaxDelta = d12;
        // Round-trip: null restores the frozen default.
        cme.moon.setColorScript(null);
        const px4 = renderCh10();
        let d14 = 0;
        for (let i = 0; i < px1.length; i++) d14 = Math.max(d14, Math.abs(px1[i] - px4[i]));
        out.restoreMaxDelta = d14;
        out.restoredIsFrozen = cme.moon.colorScript === cme.moonm.COLOR_SCRIPT;
        // Invalid scripts throw.
        let threw = 0;
        try { cme.moon.setColorScript([{ emissive: [1, 1, 1] }]); } catch (e) { threw++; }
        try { cme.moon.setColorScript([]); } catch (e) { threw++; }
        out.invalidThrew = threw;
        return out;
      })()`);
      // sha values computed in Node (pixels stay in-page for the deltas).
      check('P72b. default moon carries the frozen COLOR_SCRIPT (identity)', r.defaultIsFrozen === true, `identity=${r.defaultIsFrozen}`);
      check('P72c. injected script engaged', r.injectedActive === true, `injected=${r.injectedActive}`);
      check('P72d. injected frame deterministic (double-render maxDelta=0)', r.detMaxDelta === 0, `maxDelta=${r.detMaxDelta}`);
      check('P72e. injected frame is config-driven (differs from default)', r.drivenMaxDelta > 0, `maxDelta=${r.drivenMaxDelta}`);
      check('P72f. null restores the frozen default (round-trip pixel-identical)', r.restoreMaxDelta === 0 && r.restoredIsFrozen === true, `maxDelta=${r.restoreMaxDelta} identity=${r.restoredIsFrozen}`);
      check('P72g. invalid color scripts throw', r.invalidThrew === 2, `threw=${r.invalidThrew}/2`);
      await page.close();
    }
  }

  // ---------- P73: clock parameterization ----------
  {
    const { page, errors, bootOk } = await bootPage(browser, w, h, { tier: 'cinematic', seed });
    check('P73a. canonical page boots clean (clock checks)', bootOk,
      errors.length ? `[${errors.join(' | ')}]` : 'clean');
    if (bootOk) {
      const r = await page.evaluate(`(() => {
        const cme = window.__cme;
        const maxY = document.documentElement.scrollHeight - innerHeight;
        const out = {};
        // Custom clock: 10 chapters, 240 sim-seconds, p=0.6, reduced motion.
        const c = cme.presentation({ scrollY: 0.6 * maxY, maxScroll: maxY, reducedMotion: true, chapterCount: 10, simDuration: 240 });
        out.custom = {
          canonT: +c.canonicalChapterT.toFixed(6),
          motionT: c.motionChapterT,
          canonSim: +c.canonicalSimTime.toFixed(6),
          motionSim: +c.motionSimTime.toFixed(6),
          frame: c.frame,
        };
        // Default clock: 13/312, p=0.5 — the frozen canonical values.
        const d = cme.presentation({ scrollY: 0.5 * maxY, maxScroll: maxY });
        out.def = {
          canonT: +d.canonicalChapterT.toFixed(6),
          canonSim: +d.canonicalSimTime.toFixed(6),
          frame: d.frame,
        };
        return out;
      })()`);
      const cOk = r.custom.canonT === 5.4 && r.custom.motionT === 5 &&
        r.custom.canonSim === 144 && Math.abs(r.custom.motionSim - 133.333333) < 1e-4 &&
        // Frozen reduced-motion rule (Phase 5/6): frame is pinned to 0 under
        // reduced motion — the custom clock is tested with reducedMotion:true
        // (that's what gives motionT=5), so frame===0 is the correct analytic.
        r.custom.frame === 0;
      check('P73b. custom clock (10ch/240s) analytic', cOk, JSON.stringify(r.custom));
      const dOk = r.custom && r.def.canonT === 6 && r.def.canonSim === 156 && r.def.frame === 9360;
      check('P73c. default clock unchanged (13/312 float-identity)', dOk, JSON.stringify(r.def));
      await page.close();
    }
  }

  // ---------- P74: camera locator injection ----------
  {
    const { page, errors, bootOk } = await bootPage(browser, w, h, { tier: 'cinematic', seed });
    check('P74a. canonical page boots clean (locator checks)', bootOk,
      errors.length ? `[${errors.join(' | ')}]` : 'clean');
    if (bootOk) {
      const r = await page.evaluate(`(() => {
        const cme = window.__cme;
        const maxY = document.documentElement.scrollHeight - innerHeight;
        const out = { defErr: 0, defN: 0 };
        for (const y of [0, maxY * 0.25, maxY * 0.5, maxY * 0.75, maxY]) {
          const e = cme.cameraCtl.evaluate(y, maxY);
          const want = (Math.min(1, Math.max(0, y / maxY))) * 12;
          out.defErr = Math.max(out.defErr, Math.abs(e.chapterT - want));
          out.defN++;
        }
        // Custom locator: quadratic scrub — proves the injection point.
        const cam2 = cme.createCamera({
          chapters: cme.chapters.CHAPTERS,
          chapterLocator: (p, n) => ({ chapterT: Math.min(1, Math.max(0, p)) ** 2 * (n - 1) }),
        });
        out.customFull = +cam2.evaluate(maxY, maxY).chapterT.toFixed(6);
        out.customHalf = +cam2.evaluate(maxY / 2, maxY).chapterT.toFixed(6);
        out.customAt = +cam2.evaluateAt(6).chapterT.toFixed(6);
        return out;
      })()`);
      check('P74b. default locator ≡ frozen chapterAt mapping (5 samples)', r.defErr < 1e-9, `maxErr=${r.defErr}`);
      check('P74c. custom locator redefines raw-scroll mapping', r.customFull === 12 && r.customHalf === 3 && r.customAt === 6,
        `full=${r.customFull} half=${r.customHalf} at=${r.customAt}`);
      await page.close();
    }
  }

  // ---------- P75: replay identity includes DPR + bake pin ----------
  {
    const dir = path.join(__dirname, 'replay-records');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
    let fmtOk = true, dprOk = true, sceneOk = true, clockOk = true, bakeOk = true;
    for (const f of files) {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (rec.format !== 'cme-replay/3') fmtOk = false;
      if (typeof (rec.viewport && rec.viewport.dpr) !== 'number') dprOk = false;
      if (rec.scene !== 'mimas') sceneOk = false;
      if (rec.chapterCount !== 13 || rec.simDuration !== 312) clockOk = false;
      if (rec.bakeRes !== 2048) bakeOk = false;
    }
    check('P75a. corpus is format cme-replay/3', files.length === 12 && fmtOk, `${files.length} records`);
    check('P75b. every record carries viewport.dpr (number)', dprOk, 'identity = CSS dims + DPR');
    check('P75c. every record carries scene + clock fields', sceneOk && clockOk, 'scene=mimas, 13/312');
    check('P75d. every record carries bakeRes=2048 (bake pin)', bakeOk, 'wall-clock fallback disabled at record time');
    const { page, errors, bootOk } = await bootPage(browser, w, h, { tier: 'cinematic', seed });
    if (bootOk) {
      const dpr = await page.evaluate('window.devicePixelRatio');
      check('P75d. page captures devicePixelRatio at boot', dpr === 1, `dpr=${dpr} (headless)`);
      await page.close();
    } else {
      check('P75d. page captures devicePixelRatio at boot', false, errors.join(' | '));
    }
  }

  // ---------- P76: auto-tier advisory stays visible ----------
  {
    const replaySrc = fs.readFileSync(path.join(__dirname, 'replay.js'), 'utf8');
    const docPath = path.join(__dirname, '..', 'docs', 'scene-extension.md');
    check('P76a. replay.js documents the auto-tier advisory', replaySrc.includes('can honestly FAIL the resolved-tier comparison'),
      'GPT note 2 in replay.js header');
    check('P76b. docs/scene-extension.md carries the advisory', fs.existsSync(docPath) &&
      fs.readFileSync(docPath, 'utf8').toLowerCase().includes('auto-tier advisory'),
      'advisory section present');
  }

  // ---------- P77: eclipse act through the main page ----------
  {
    const { page, errors, bootOk } = await bootPage(browser, w, h,
      { tier: 'cinematic', seed, extraQuery: '&scene=eclipse-act', bakeRes: 2048 });
    check('P77a. ?scene=eclipse-act boots clean', bootOk,
      errors.length ? `[${errors.join(' | ')}]` : 'clean');
    if (bootOk) {
      const r = await page.evaluate(`(() => {
        const cme = window.__cme;
        const e = cme;
        const out = {
          scene: e.scene,
          eclipse: e.moon.eclipse,
          injectedScript: e.moon.colorScript !== e.moonm.COLOR_SCRIPT,
          chapters: e.sceneConfig.chapters.length,
        };
        const p1 = e.renderFrame(156).data, p2 = e.renderFrame(156).data;
        let det = 0;
        for (let i = 0; i < p1.length; i++) det = Math.max(det, Math.abs(p1[i] - p2[i]));
        out.detMaxDelta = det;

        // Blood-moon visual: disc-center 5×5 R−B.
        const f = e.moonScreen();
        const shot = e.readPixels();
        const W = shot.width, d = shot.data;
        const cx = Math.round(f.x), cy = Math.round(f.y);
        let sr = 0, sb = 0, n = 0;
        for (let y = cy - 2; y <= cy + 2; y++)
          for (let x = cx - 2; x <= cx + 2; x++) {
            const k = (y * W + x) * 4;
            sr += d[k]; sb += d[k + 2]; n++;
          }
        out.discR = +(sr / n).toFixed(1); out.discB = +(sb / n).toFixed(1);
        return { ...out, px: p1 };
      })()`);
      const eclipseSha = sha(r.px);
      check('P77b. scene id + injected color script + blood-moon hook',
        r.scene === 'eclipse-act' && r.eclipse === 1 && r.injectedScript === true && r.chapters === 13,
        `scene=${r.scene} eclipse=${r.eclipse} injected=${r.injectedScript} chapters=${r.chapters}`);
      check('P77c. renderFrame(156) deterministic (maxDelta=0)', r.detMaxDelta === 0, `maxDelta=${r.detMaxDelta}`);
      const rb = r.discR - r.discB;
      check('P77d. blood-moon visual: disc-center strongly red', rb > 20,
        `disc R=${r.discR} B=${r.discB} R−B=${rb.toFixed(1)}`);
      check('P77e. frame is config-driven (differs from canonical t=156)',
        canon156 !== null && eclipseSha !== canon156,
        `sha ${eclipseSha.slice(0, 12)}… vs canonical ${canon156 ? canon156.slice(0, 12) : 'MISSING'}…`);
      await page.close();
    }
  }

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed (${vp})`);
  if (failed.length) {
    console.log('FAILED:', failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
  console.log('=== checks-phase7 PASS ===');
}

main().catch((e) => { console.error('fatal:', e); process.exit(2); });
