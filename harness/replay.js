#!/usr/bin/env node
/**
 * harness/replay.js — the resolved-tier replay contract (Phase 6, merged
 * ruling item B: "A replay/regression record must contain: seed, viewport,
 * canonical scroll/state, resolved tier, reduced-motion state, engine
 * version. Never treat auto as part of the pixel-deterministic replay
 * identity.")
 *
 * Record identity (the pixel-deterministic tuple):
 *   (seed, viewport, tierParam→resolvedTier, reducedMotion, canonicalScrollT)
 * Auto mode is NEVER part of the identity: records always carry the RESOLVED
 * tier (page.evaluate(cme.tier)), never the request. engineVersion is
 * provenance metadata (warning on mismatch, not a failure — otherwise no
 * record could survive any commit).
 *
 * Usage:
 *   node replay.js record   --chapter=10 --viewport=1440x900 [--seed=7]
 *                           [--tier=cinematic] [--reduced-motion] [--name=...]
 *   node replay.js compare  --record=<name>            # name or path under replay-records/
 *   node replay.js record-corpus [--seed=7]            # 12-record canonical corpus
 *   node replay.js compare-corpus [--seed=7]
 *
 * record: boots the page at (seed, viewport, canonical scroll t, ?tier=,
 *   reduced-motion state), renders via window.__cme.renderAtScrollY, writes
 *   JSON + PNG into harness/replay-records/.
 * compare: replays a record and asserts pixel-identical (sha256 equality ⇒
 *   maxDelta=0), resolved tier match, canonical chapterT match.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser, bootPage } = require('./boot');

const RECORDS_DIR = path.join(__dirname, 'replay-records');

function parseArgs() {
  const args = { viewport: '1440x900', tier: 'cinematic', seed: '7', chapter: '10' };
  for (const a of process.argv.slice(2)) {
    if (a === '--reduced-motion') { args.reducedMotion = true; continue; }
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  const [w, h] = args.viewport.split('x').map(Number);
  return { ...args, w, h, reducedMotion: !!args.reducedMotion };
}

/** Minimal pure-Node RGBA→PNG writer (filter 0 per scanline). */
function writePNG(width, height, rgba, outPath) {
  const rowLen = width * 4;
  const src = Buffer.from(rgba);
  const raw = Buffer.alloc((rowLen + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (rowLen + 1)] = 0;
    src.copy(raw, y * (rowLen + 1) + 1, y * rowLen, (y + 1) * rowLen);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(outPath, png);
}

function engineVersion() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}

/** Chapter label → canonical scroll t (sim-seconds ∈ [0,312]). */
function chapterT(chapter) {
  const idx = Number(chapter) - 1; // ch1 → 0 … ch13 → 12
  if (!Number.isInteger(idx) || idx < 0 || idx > 12) throw new Error(`chapter must be 1–13, got ${chapter}`);
  return (idx / 12) * 312;
}

async function recordOne(browser, { seed, w, h, tier, reducedMotion, chapter, name }) {
  const t = chapterT(chapter);
  const { page, errors, bootOk } = await bootPage(browser, w, h, { tier, seed, reducedMotion });
  if (!bootOk) {
    await page.close();
    throw new Error(`boot not clean: ${errors.join(' | ')}`);
  }
  const r = await page.evaluate(`(() => {
    const cme = window.__cme;
    const maxY = document.documentElement.scrollHeight - innerHeight;
    const out = cme.renderAtScrollY(${(t / 312)} * maxY);
    return {
      pixels: out.pixels,
      canonicalChapterT: out.state.presentation.canonicalChapterT,
      motionChapterT: out.state.presentation.motionChapterT,
      tier: cme.tier, mode: cme.tierMode,
      reducedMotion: out.state.presentation.reducedMotion,
    };
  })()`);
  await page.close();

  const sha = crypto.createHash('sha256').update(Buffer.from(r.pixels.data)).digest('hex');
  const recName = name ||
    `replay-seed${seed}-ch${chapter}-${w}x${h}-${tier}-rm${reducedMotion ? 'on' : 'off'}`;
  fs.mkdirSync(RECORDS_DIR, { recursive: true });
  const record = {
    format: 'cme-replay/1',
    name: recName,
    seed: Number(seed),
    viewport: { w, h },
    tierParam: tier,
    resolvedTier: r.tier,
    tierMode: r.mode,
    reducedMotion: r.reducedMotion,
    canonicalScrollT: t,
    chapter: Number(chapter),
    canonicalChapterT: r.canonicalChapterT,
    motionChapterT: r.motionChapterT,
    engineVersion: engineVersion(),
    pixelSha256: sha,
    pixels: { width: r.pixels.width, height: r.pixels.height },
  };
  const jsonPath = path.join(RECORDS_DIR, `${recName}.json`);
  const pngPath = path.join(RECORDS_DIR, `${recName}.png`);
  fs.writeFileSync(jsonPath, JSON.stringify(record, null, 2) + '\n');
  writePNG(r.pixels.width, r.pixels.height, r.pixels.data, pngPath);
  console.log(`recorded ${recName}: tier=${r.tier} mode=${r.mode} ` +
    `canonT=${r.canonicalChapterT.toFixed(2)} sha256=${sha.slice(0, 16)}…`);
  return record;
}

async function compareOne(browser, recPath) {
  const record = JSON.parse(fs.readFileSync(recPath, 'utf8'));
  if (record.format !== 'cme-replay/1') throw new Error(`unknown record format in ${recPath}`);
  const { w, h } = record.viewport;
  const { page, errors, bootOk } = await bootPage(browser, w, h, {
    tier: record.tierParam, seed: String(record.seed), reducedMotion: record.reducedMotion,
  });
  if (!bootOk) {
    await page.close();
    return { name: record.name, pass: false, detail: `boot not clean: ${errors.join(' | ')}` };
  }
  const r = await page.evaluate(`(() => {
    const cme = window.__cme;
    const maxY = document.documentElement.scrollHeight - innerHeight;
    const out = cme.renderAtScrollY(${(record.canonicalScrollT / 312)} * maxY);
    return {
      pixels: out.pixels,
      canonicalChapterT: out.state.presentation.canonicalChapterT,
      tier: cme.tier, mode: cme.tierMode,
      reducedMotion: out.state.presentation.reducedMotion,
    };
  })()`);
  await page.close();

  const sha = crypto.createHash('sha256').update(Buffer.from(r.pixels.data)).digest('hex');
  const fails = [];
  if (sha !== record.pixelSha256) fails.push(`pixel sha256 mismatch (maxDelta>0)`);
  if (r.tier !== record.resolvedTier) fails.push(`resolved tier ${r.tier} != recorded ${record.resolvedTier}`);
  if (Math.abs(r.canonicalChapterT - record.canonicalChapterT) > 1e-9)
    fails.push(`canonicalChapterT drift`);
  if (r.reducedMotion !== record.reducedMotion) fails.push('reducedMotion flag drift');
  const ver = engineVersion();
  const verNote = ver === record.engineVersion ? '' : ` [engineVersion ${record.engineVersion.slice(0, 7)} → ${ver.slice(0, 7)} — provenance only]`;
  const pass = fails.length === 0;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${record.name} — ` +
    `${pass ? 'pixel-identical (maxDelta=0)' : fails.join('; ')}${verNote}`);
  return { name: record.name, pass, detail: pass ? 'maxDelta=0' : fails.join('; ') };
}

const CORPUS = [];
for (const chapter of [1, 10, 13]) {
  for (const viewport of ['1440x900', '390x844']) {
    for (const rm of [false, true]) CORPUS.push({ chapter, viewport, rm });
  }
}

async function main() {
  const cmd = process.argv[2];
  const args = parseArgs();
  const browser = await launchBrowser();
  let ok = true;
  try {
    if (cmd === 'record') {
      await recordOne(browser, args);
    } else if (cmd === 'compare') {
      const recArg = args.record;
      if (!recArg) throw new Error('--record=<name> required');
      const p = recArg.endsWith('.json') ? recArg : path.join(RECORDS_DIR, `${recArg}.json`);
      const r = await compareOne(browser, p);
      ok = r.pass;
    } else if (cmd === 'record-corpus' || cmd === 'compare-corpus') {
      const isRecord = cmd === 'record-corpus';
      const files = [];
      for (const c of CORPUS) {
        const name = `replay-seed${args.seed}-ch${c.chapter}-${c.viewport}-cinematic-rm${c.rm ? 'on' : 'off'}`;
        if (isRecord) {
          const [w, h] = c.viewport.split('x').map(Number);
          await recordOne(browser, { ...args, w, h, chapter: String(c.chapter), reducedMotion: c.rm, name });
        }
        files.push(path.join(RECORDS_DIR, `${name}.json`));
      }
      if (!isRecord) {
        for (const f of files) {
          if (!fs.existsSync(f)) { console.log(`FAIL  ${path.basename(f)} — record missing (run record-corpus first)`); ok = false; continue; }
          const r = await compareOne(browser, f);
          ok = r.pass && ok;
        }
      }
      console.log(`\n=== ${cmd} ${ok ? 'PASS' : 'FAIL'} ===`);
    } else {
      throw new Error('usage: replay.js <record|compare|record-corpus|compare-corpus> [options]');
    }
  } finally {
    await browser.close();
  }
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('fatal:', e.message); process.exit(2); });
