#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(root, 'engine', 'environment.js'), 'utf8');
const chapters = fs.readFileSync(path.join(root, 'engine', 'chapters.js'), 'utf8');
const host = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function assert(ok, message) {
  if (!ok) {
    console.error('FAIL', message);
    process.exit(1);
  }
  console.log('PASS', message);
}

assert(env.includes('uniform float uEmberSignalLift;'),
  'shader exposes uEmberSignalLift');
assert(env.includes('uEmberSignalLift: { value: 0 }'),
  'signal lift defaults to zero');
assert(env.includes('if (lift <= 0.0) {\n    gl_FragColor = vec4(col * a, a);\n    return;'),
  'zero lift preserves the exact legacy fragment expression');
assert(env.includes('function setEmbers({ opacity, density, drift, warmth, signalLift } = {})'),
  'setEmbers accepts signalLift');
assert(env.includes('Math.max(0, Math.min(1, Number(signalLift) || 0))'),
  'signal lift is clamped to [0,1]');
assert(chapters.includes('signalLift: lerp(a.ember.signalLift ?? 0, b.ember.signalLift ?? 0)'),
  'chapter sampler defaults legacy scenes to zero lift');
assert(host.includes("const emberLiftRaw = params.get('emberlift');"),
  'host exposes an explicit ?emberlift= preview seam');
assert(host.includes('emberSignalLiftOverride: EMBER_SIGNAL_LIFT'),
  'preview override is inspectable in the harness');

const lift = 0.15;
const opacities = [0.26, 0.39, 0.52];
for (const opacity of opacities) {
  const a = 0.55 * opacity; // peak smoothstep=1, vFade=1
  const legacy = a * a;
  const candidate = a * ((1 - lift) * a + lift);
  const ratio = candidate / legacy;
  assert(candidate > legacy, `lift raises peak contribution at opacity ${opacity.toFixed(2)}`);
  assert(ratio >= 1.37,
    `0.15 lift gives >=1.37x source contribution at opacity ${opacity.toFixed(2)} (got ${ratio.toFixed(3)}x)`);
  const zero = a * ((1 - 0) * a + 0);
  assert(Math.abs(zero - legacy) < 1e-15,
    `zero lift is numerically identical at opacity ${opacity.toFixed(2)}`);
}

console.log('TECHNICAL PASS — Phase 16 ember signal-lift static contract');
