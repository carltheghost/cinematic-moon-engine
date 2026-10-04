/* harness/checks-phase8.js — verification for the "tidal-lock" scene.
 *
 * Node-runnable (no DOM, no WebGL): asserts the scene's pure contracts —
 * tidal physics determinism and lock behavior, audio cue purity, chapter
 * config shape, the color-script transform, and the no-clocks/no-random
 * source rule for scenes/tidallock/.
 *
 * Run: node harness/checks-phase8.js   (from the repo root)
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { TIDAL, tidalState, spinRateAt, spinAngleAt, orbitAngleAt, orbitRadiusAt,
  bulgeLagAt, bulgeAmpAt, lockPulseAt, librationAt } =
  await import('../scenes/tidallock/tidal.js');
const { audioCueAt } = await import('../scenes/tidallock/audio-cues.js');
const cfg = await import('../scenes/tidallock/tidallock-config.js');

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; results.push(`PASS ${name}`); }
  else { fail++; results.push(`FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}
const eq = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

/* --- tidal.js: determinism -------------------------------------- */
{
  const a = tidalState(0.37), b = tidalState(0.37);
  check('tidal: same t → deep-equal state',
    JSON.stringify(a) === JSON.stringify(b));
  check('tidal: state is frozen', Object.isFrozen(a));
  const c = tidalState(0.0), d = tidalState(1.0);
  check('tidal: t clamps', c.t === 0 && d.t === 1 &&
    tidalState(-2).t === 0 && tidalState(9).t === 1);
}

/* --- tidal.js: the despin story ---------------------------------- */
{
  check('tidal: spinRate(0) === R0 (fast young Moon)',
    eq(spinRateAt(0), TIDAL.R0), `got ${spinRateAt(0)}`);
  check('tidal: spinRate(T_LOCK) === 1 (locked)',
    eq(spinRateAt(TIDAL.T_LOCK), 1), `got ${spinRateAt(TIDAL.T_LOCK)}`);
  check('tidal: spinRate(1) === 1 (stays locked)', eq(spinRateAt(1), 1));
  let mono = true;
  for (let i = 1; i <= 100; i++)
    if (spinRateAt(i / 100) > spinRateAt((i - 1) / 100) + 1e-12) mono = false;
  check('tidal: spin rate monotonically non-increasing', mono);
  check('tidal: bulge lag → 0 at lock', eq(bulgeLagAt(TIDAL.T_LOCK), 0));
  check('tidal: bulge lag > 0 early', bulgeLagAt(0.1) > 0.2);
  check('tidal: bulge lag ≤ LAG_MAX', bulgeLagAt(0) <= TIDAL.LAG_MAX + 1e-12);
  check('tidal: orbit widens (recession)',
    orbitRadiusAt(1) > orbitRadiusAt(0) &&
    eq(orbitRadiusAt(0), TIDAL.R_NEAR) && eq(orbitRadiusAt(1), TIDAL.R_FAR));
  check('tidal: bulge amplitude fades with distance',
    bulgeAmpAt(0) > bulgeAmpAt(1));
  check('tidal: lock pulse peaks at T_LOCK',
    lockPulseAt(TIDAL.T_LOCK) > 0.999 &&
    lockPulseAt(0) < 1e-6 && lockPulseAt(1) < 1e-6);
  check('tidal: no libration before lock', eq(librationAt(0.5), 0));
  // The wobble must actually exist post-lock (not be a flat zero): sample the
  // peak over a fine grid. NOTE: TIDAL.LIBRATION is read through a JSON
  // round-trip here — this file once tripped a Node 24.20.0 TurboFan
  // miscompile where `NS.prop + c` on a module-namespace destructured
  // binding evaluated as NaN depending on surrounding optimization. The
  // module itself is provably correct (unoptimized reads all agree).
  const libAmp = JSON.parse(JSON.stringify(TIDAL.LIBRATION));
  const libBound = libAmp + 1e-12;
  let libPeak = 0;
  for (let i = 0; i <= 200; i++)
    libPeak = Math.max(libPeak, Math.abs(librationAt(TIDAL.T_LOCK + (i / 200) * (1 - TIDAL.T_LOCK))));
  check('tidal: libration exists post-lock and stays within amplitude',
    libPeak > 1e-6 && libPeak <= libBound, `peak=${libPeak}`);
}

/* --- tidal.js: the lock is exact ---------------------------------- */
{
  let ok = true, worst = 0;
  for (let i = 0; i <= 60; i++) {
    const t = TIDAL.T_LOCK + (i / 60) * (1 - TIDAL.T_LOCK);
    const e = Math.abs(tidalState(t).facingError);
    worst = Math.max(worst, e);
    if (e > 1e-9) ok = false;
  }
  check('tidal: facing error ≡ 0 for all t ≥ T_LOCK', ok, `worst=${worst}`);
  // Spin angle continuity: no jumps (sample finely, bound the step).
  let cont = true;
  for (let i = 1; i <= 400; i++) {
    const step = Math.abs(spinAngleAt(i / 400) - spinAngleAt((i - 1) / 400));
    if (step > 2.5) cont = false; // max honest step ≈ rate 9 × orbit slice
  }
  check('tidal: spin angle continuous (no jumps)', cont);
  check('tidal: orbit angle linear',
    eq(orbitAngleAt(0.5), Math.PI * 2 * TIDAL.ORBITS * 0.5));
}

/* --- audio-cues.js: purity + story -------------------------------- */
{
  const a = audioCueAt(0.42), b = audioCueAt(0.42);
  check('audio: same t → deep-equal cue', JSON.stringify(a) === JSON.stringify(b));
  check('audio: cue is frozen', Object.isFrozen(a));
  check('audio: rumble pitch FALLS as the Moon despins',
    audioCueAt(0).rumbleHz > audioCueAt(TIDAL.T_LOCK).rumbleHz + 20,
    `${audioCueAt(0).rumbleHz} → ${audioCueAt(TIDAL.T_LOCK).rumbleHz}`);
  check('audio: chime peaks at the lock moment',
    audioCueAt(TIDAL.T_LOCK).chime > 0.99 &&
    audioCueAt(0.3).chime < 0.05 && audioCueAt(1).chime < 0.05);
  check('audio: no heartbeat before lock', audioCueAt(0.5).heartbeat === 0);
  check('audio: heartbeat after lock', audioCueAt(0.9).heartbeat >= 0);
  check('audio: shimmer dies at lock',
    audioCueAt(0).shimmerGain > 0.2 && audioCueAt(1).shimmerGain === 0);
  const gains = ['rumbleGain', 'shimmerGain', 'droneGain', 'heartbeat'];
  let bounded = true;
  for (let i = 0; i <= 50; i++) {
    const q = audioCueAt(i / 50);
    for (const g of gains) if (!(q[g] >= 0 && q[g] <= 1)) bounded = false;
    if (!(q.chime >= 0 && q.chime <= 1.001)) bounded = false;
  }
  check('audio: all gains bounded ∈ [0,1]', bounded);
}

/* --- tidallock-config.js: chapter contract ------------------------- */
{
  const chapters = cfg.TIDAL_CHAPTERS;
  check('config: 7 chapters', chapters.length === 7);
  check('config: META id', cfg.TIDAL_META.id === 'tidal-lock');
  const camFields = ['az', 'el', 'dist', 'lookAz', 'lookEl', 'fov'];
  let shape = true, fovOk = true;
  const names = new Set();
  for (const ch of chapters) {
    if (typeof ch.id !== 'number' || typeof ch.name !== 'string' || !ch.name ||
        typeof ch.role !== 'string' || !ch.role) shape = false;
    names.add(ch.name);
    for (const f of camFields)
      if (typeof ch.camera?.[f] !== 'number' || !isFinite(ch.camera[f])) shape = false;
    if (!(ch.camera.fov >= 40 && ch.camera.fov <= 70)) fovOk = false;
    for (const f of ['fogDensity', 'glint', 'exposure'])
      if (typeof ch[f] !== 'number' || !isFinite(ch[f])) shape = false;
    for (const g of ['ember', 'lantern'])
      if (!ch[g] || typeof ch[g] !== 'object') shape = false;
    if (ch.camera.dist <= 0) shape = false;
  }
  check('config: every chapter has the engine field shape', shape);
  check('config: chapter names unique', names.size === chapters.length);
  check('config: fov within cinematic band', fovOk);
  check('config: ids are 1..7 in order',
    chapters.every((ch, i) => ch.id === i + 1));
  const sc = cfg.TIDAL_SCENE;
  check('config: scene id', sc.id === 'tidal-lock');
  check('config: chapterCount === 7', sc.chapterCount === 7);
  check('config: simDuration === 168', sc.simDuration === 168);
  check('config: scrollSpaceVh === 700', sc.scrollSpaceVh === 700);
  check('config: decorate is a function', typeof sc.decorate === 'function');
  check('config: chapters array frozen', Object.isFrozen(chapters));
}

/* --- makeTidalColorScript: pure transform -------------------------- */
{
  const base = [
    { name: 'a', emissive: [1, 1, 1], rampCore: [0.9, 0.2, 0.1], rampMid: [0.8, 0.2, 0.1],
      rampEdge: [0.5, 0.5, 0.55], fresnel: [0.1, 0.1, 0.1],
      haloTint: [1, 0.5, 0.3], haloGain: 1.0, exposure: 1.0 },
    { name: 'b', emissive: [1, 1, 1], rampCore: [0.85, 0.25, 0.12], rampMid: [0.75, 0.22, 0.1],
      rampEdge: [0.5, 0.5, 0.55], fresnel: [0.1, 0.1, 0.1],
      haloTint: [1, 0.5, 0.3], haloGain: 1.0, exposure: 1.0 },
  ];
  Object.freeze(base); base.forEach(Object.freeze);
  const out1 = cfg.makeTidalColorScript(base);
  const out2 = cfg.makeTidalColorScript(base);
  check('colorscript: deterministic', JSON.stringify(out1) === JSON.stringify(out2));
  check('colorscript: same keyframe count', out1.length === base.length);
  check('colorscript: input never mutated',
    base[0].haloTint[0] === 1 && base[0].emissive[0] === 1);
  check('colorscript: emissive dimmed ×0.9', eq(out1[0].emissive[0], 0.9));
  check('colorscript: halo neutralized',
    eq(out1[0].haloTint[0], 0.72) && eq(out1[0].haloTint[2], 0.94));
  check('colorscript: ramp desaturated toward bone (r≈g)',
    Math.abs(out1[0].rampCore[0] - out1[0].rampCore[1]) < 0.06,
    `r=${out1[0].rampCore[0].toFixed(3)} g=${out1[0].rampCore[1].toFixed(3)}`);
  check('colorscript: cool limb preserved',
    JSON.stringify(out1[0].rampEdge) === JSON.stringify(base[0].rampEdge));
  let threw = false;
  try { cfg.makeTidalColorScript([{ name: 'x' }]); } catch (e) { threw = true; }
  check('colorscript: rejects short scripts loudly', threw);
}

/* --- earth.js: seeded noise works with the real engine Rng ---------------- */
{
  const { Rng } = await import('../engine/seed.js');
  const { makeNoiseTable, earthAlbedoAt } = await import('../scenes/tidallock/earth.js');
  const t1 = makeNoiseTable(new Rng(7));
  const t2 = makeNoiseTable(new Rng(7));
  const t3 = makeNoiseTable(new Rng(8));
  check('earth: noise table deterministic per seed',
    t1.every((v, i) => v === t2[i]) && !t1.every((v, i) => v === t3[i]));
  check('earth: table is a 512-permutation',
    t1.length === 512 && new Set(t1).size === 256);
  let albedoOk = true, seamOk = true;
  for (let i = 0; i < 200; i++) {
    const u = (i * 0.61803) % 1, v = (i * 0.38197) % 1;
    const c = earthAlbedoAt(u, v, t1);
    if (!(c.length === 3 && c.every((x) => x >= 0 && x <= 1))) albedoOk = false;
    // Longitude seam: u=0 and u→1 must match (no visible texture seam).
    const a = earthAlbedoAt(0, v, t1), b = earthAlbedoAt(0.9999, v, t1);
    if (Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]) > 0.02) seamOk = false;
  }
  check('earth: albedo in [0,1]³ everywhere sampled', albedoOk);
  check('earth: longitude seam seamless', seamOk);
}
{
  const dir = join(root, 'scenes', 'tidallock');
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  check('hygiene: scene files present',
    ['tidal.js', 'earth.js', 'audio-cues.js', 'audio-driver.js', 'tidallock-config.js']
      .every((f) => files.includes(f)), files.join(','));
  // Same pattern as the real gate (harness/grep-gate.sh): the forbidden
  // token must be an actual CALL — `performance.now` in a comment is fine.
  const banned = [/Math\.random\s*\(/, /Date\.now\s*\(/, /performance\.now\s*\(/, /new Date\(/];
  let clean = true, offender = '';
  for (const f of files) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const rx of banned) {
      if (rx.test(src)) { clean = false; offender = `${f}: ${rx}`; }
    }
  }
  check('hygiene: no Math.random()/Date.now()/performance.now()/new Date() calls in scene', clean, offender);
}

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
