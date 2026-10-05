/* harness/checks-phase9.js — verification for the "formation", "eclipses"
 * and "phases" scenes (the moon-trilogy branch).
 *
 * Node-runnable (no DOM, no WebGL): asserts each scene's pure contracts —
 * physics determinism and story behavior, audio cue purity, chapter config
 * shape AND keyframe framing (focus in frame at every chapter on portrait
 * + desktop), the color-script transforms, the scene-index registrations,
 * and the no-clocks/no-random source rule for the new scene dirs.
 *
 * Run: node harness/checks-phase9.js   (from the repo root)
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const F = await import('../scenes/formation/formation.js');
const FA = await import('../scenes/formation/audio-cues.js');
const FC = await import('../scenes/formation/formation-config.js');

const E = await import('../scenes/eclipses/eclipses.js');
const EA = await import('../scenes/eclipses/audio-cues.js');
const EC = await import('../scenes/eclipses/eclipses-config.js');

const P = await import('../scenes/phases/phases.js');
const PA = await import('../scenes/phases/audio-cues.js');
const PC = await import('../scenes/phases/phases-config.js');

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; results.push(`PASS ${name}`); }
  else { fail++; results.push(`FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}
const eq = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

/* ================= formation.js: the impact story ================= */
{
  const a = F.formationState(0.37), b = F.formationState(0.37);
  check('formation: same t → deep-equal state', JSON.stringify(a) === JSON.stringify(b));
  check('formation: state is frozen',
    Object.isFrozen(a) && (a.theia === null || Object.isFrozen(a.theia)));
  check('formation: t clamps',
    F.formationState(-2).t === 0 && F.formationState(9).t === 1);

  const { T_IMPACT, T_DISK, T_COALESCE, MOON_R, EARTH_R } = F.FORMATION;
  check('formation: impact lands on the ch3 keyframe', eq(T_IMPACT, 1 / 3), `${T_IMPACT}`);

  // Theia falls in, then is consumed.
  check('formation: theia exists before impact', F.theiaAt(0.1) !== null);
  check('formation: theia consumed at/after impact',
    F.theiaAt(T_IMPACT) === null && F.theiaAt(0.9) === null);
  const d0 = Math.hypot(F.theiaAt(0).x - EARTH_R * 0.82, F.theiaAt(0).z - EARTH_R * 0.18);
  const d1 = Math.hypot(F.theiaAt(0.25).x - EARTH_R * 0.82, F.theiaAt(0.25).z - EARTH_R * 0.18);
  check('formation: theia approaches (distance shrinks)', d1 < d0, `${d0.toFixed(0)} → ${d1.toFixed(0)}`);

  // The impact pulse.
  check('formation: impact pulse peaks at T_IMPACT',
    F.impactPulseAt(T_IMPACT) > 0.999 && F.impactPulseAt(0) < 1e-6 && F.impactPulseAt(1) < 1e-6);

  // The disk: nothing before, dense after, thinning as it accretes.
  check('formation: no disk before impact', F.diskDensityAt(0.2) === 0);
  check('formation: disk dense after forming', F.diskDensityAt(T_DISK) > 0.9);
  check('formation: disk thins as the Moon gathers',
    F.diskDensityAt(T_DISK) > F.diskDensityAt(0.95));
  check('formation: disk inner < outer once formed',
    F.diskInnerAt(0.6) < F.diskOuterAt(0.6));

  // The Moon gathers from nothing.
  check('formation: no moon before gathering', F.moonRadiusAt(0.4) === 0);
  check('formation: moon full size once coalesced',
    eq(F.moonRadiusAt(T_COALESCE), MOON_R) && eq(F.moonRadiusAt(1), MOON_R));
  let mono = true;
  for (let i = 1; i <= 100; i++)
    if (F.moonRadiusAt(i / 100) < F.moonRadiusAt((i - 1) / 100) - 1e-12) mono = false;
  check('formation: moon radius monotonically non-decreasing', mono);

  // Heat: warm worlds, white-hot impact, long cooling.
  check('formation: heat peaks at impact',
    F.heatAt(T_IMPACT) >= F.heatAt(0) && F.heatAt(T_IMPACT) > 0.99);
  check('formation: heat cools to gray by the end', F.heatAt(1) < 0.2, `${F.heatAt(1).toFixed(3)}`);
}

/* ================= eclipses.js: the node geometry ================= */
{
  const a = E.eclipseState(0.37), b = E.eclipseState(0.37);
  check('eclipses: same t → deep-equal state', JSON.stringify(a) === JSON.stringify(b));
  check('eclipses: state is frozen', Object.isFrozen(a));
  check('eclipses: t clamps', E.eclipseState(-2).t === 0 && E.eclipseState(9).t === 1);

  const { T_SOLAR, T_LUNAR, TILT, MOON_ORBIT } = E.ECLIPSE;
  check('eclipses: moon on the node at the solar peak',
    eq(E.moonAngleAt(T_SOLAR), 0), `${E.moonAngleAt(T_SOLAR)}`);
  check('eclipses: moon on the node at the lunar peak',
    eq(Math.abs(E.moonAngleAt(T_LUNAR)), Math.PI), `${E.moonAngleAt(T_LUNAR)}`);
  check('eclipses: node offset ≡ 0 at both peaks',
    E.nodeOffsetAt(T_SOLAR) < 1e-9 && E.nodeOffsetAt(T_LUNAR) < 1e-9);
  const offMax = Math.sin(TILT) * MOON_ORBIT;
  let peak = 0;
  for (let i = 0; i <= 200; i++) peak = Math.max(peak, E.nodeOffsetAt(i / 200));
  check('eclipses: the tilt lifts the Moon ~34 units off the line',
    peak > 30 && peak < 40 && Math.abs(peak - offMax) < 1e-9, `peak=${peak.toFixed(1)}`);

  check('eclipses: solar magnitude peaks at T_SOLAR',
    E.solarMagnitudeAt(T_SOLAR) > 0.999 &&
    E.solarMagnitudeAt(0.6) < 1e-6 && E.solarMagnitudeAt(1) < 1e-6);
  check('eclipses: lunar magnitude peaks at T_LUNAR',
    E.lunarMagnitudeAt(T_LUNAR) > 0.999 &&
    E.lunarMagnitudeAt(0.1) < 1e-6 && E.lunarMagnitudeAt(1) < 1e-3);
  check('eclipses: corona follows the solar eclipse',
    eq(E.coronaAt(0.4), E.solarMagnitudeAt(0.4)));
  check('eclipses: blood follows the lunar eclipse',
    eq(E.bloodAt(0.7), E.lunarMagnitudeAt(0.7)));
  check('eclipses: diamond ring flashes at the shadow edges, not mid-totality',
    E.ringFlashAt(T_SOLAR) < 1e-6 &&
    E.ringFlashAt(T_SOLAR - 0.048) > 0.9 && E.ringFlashAt(T_SOLAR + 0.048) > 0.9);
  let penOk = true;
  for (let i = 0; i <= 100; i++) {
    const p = E.penumbraAt(i / 100);
    if (!(p >= 0 && p <= 1)) penOk = false;
  }
  check('eclipses: penumbra bounded ∈ [0,1]', penOk);
}

/* ================= phases.js: the month ================= */
{
  const a = P.phaseState(0.37), b = P.phaseState(0.37);
  check('phases: same t → deep-equal state', JSON.stringify(a) === JSON.stringify(b));
  check('phases: state is frozen', Object.isFrozen(a));
  check('phases: t clamps', P.phaseState(-2).t === 0 && P.phaseState(9).t === 1);

  check('phases: new → 0 lit', eq(P.illuminationAt(0), 0));
  check('phases: full → 1 lit', eq(P.illuminationAt(0.5), 1));
  check('phases: new again → 0 lit', eq(P.illuminationAt(1), 0));
  check('phases: quarters → half lit',
    eq(P.illuminationAt(0.25), 0.5) && eq(P.illuminationAt(0.75), 0.5));
  let up = true, down = true;
  for (let i = 1; i <= 50; i++) {
    if (P.illuminationAt(i / 100) < P.illuminationAt((i - 1) / 100) - 1e-12) up = false;
    if (P.illuminationAt(0.5 + i / 100) > P.illuminationAt(0.5 + (i - 1) / 100) + 1e-12) down = false;
  }
  check('phases: illumination waxes then wanes', up && down);
  check('phases: earthshine strongest at new, gone at full',
    eq(P.earthshineAt(0), 0.6) && eq(P.earthshineAt(0.5), 0));
  check('phases: phase names land on keyframes',
    P.phaseNameAt(0) === 'New Moon' && P.phaseNameAt(0.5) === 'Full Moon' &&
    P.phaseNameAt(0.25) === 'First Quarter' && P.phaseNameAt(0.75) === 'Last Quarter' &&
    P.phaseNameAt(1) === 'New Moon');
  check('phases: the Moon completes exactly one circuit',
    eq(P.moonAngleAt(1) - P.moonAngleAt(0), Math.PI * 2));
}

/* ================= audio cues: purity + story ================= */
{
  for (const [label, mod] of [['formation', FA], ['eclipses', EA], ['phases', PA]]) {
    const a = mod.audioCueAt(0.42), b = mod.audioCueAt(0.42);
    check(`audio/${label}: same t → deep-equal cue`, JSON.stringify(a) === JSON.stringify(b));
    check(`audio/${label}: cue is frozen`, Object.isFrozen(a));
    const gains = ['rumbleGain', 'shimmerGain', 'droneGain', 'heartbeat'];
    let bounded = true;
    for (let i = 0; i <= 50; i++) {
      const q = mod.audioCueAt(i / 50);
      for (const g of gains) if (!(q[g] >= 0 && q[g] <= 1)) bounded = false;
      if (!(q.chime >= 0 && q.chime <= 1.001)) bounded = false;
    }
    check(`audio/${label}: all gains bounded ∈ [0,1]`, bounded);
  }
  const { T_IMPACT } = F.FORMATION;
  check('audio/formation: gong strikes at the impact',
    FA.audioCueAt(T_IMPACT).chime > 0.99 && FA.audioCueAt(0.1).chime < 0.05);
  check('audio/formation: approach rumble rises toward impact',
    FA.audioCueAt(0.25).rumbleHz > FA.audioCueAt(0).rumbleHz + 15);
  const { T_SOLAR } = E.ECLIPSE;
  check('audio/eclipses: gong strikes on the diamond ring',
    EA.audioCueAt(T_SOLAR - 0.048).chime > 0.9 && EA.audioCueAt(T_SOLAR).chime < 0.05);
  check('audio/eclipses: corona shimmer only at totality',
    EA.audioCueAt(T_SOLAR).shimmerGain > 0.3 && EA.audioCueAt(0.9).shimmerGain < 0.01);
  check('audio/phases: soft gong at full moon, silence otherwise',
    PA.audioCueAt(0.5).chime > 0.7 && PA.audioCueAt(0.1).chime < 0.05);
  check('audio/phases: no heartbeat in the quiet act',
    PA.audioCueAt(0.5).heartbeat === 0 && PA.audioCueAt(0.9).heartbeat === 0);
}

/* ================= config: chapter contracts ================= */
{
  const suites = [
    { label: 'formation', chapters: FC.FORMATION_CHAPTERS, meta: FC.FORMATION_META, scene: FC.FORMATION_SCENE, n: 7, fovLo: 40, fovHi: 70 },
    { label: 'eclipses', chapters: EC.ECLIPSE_CHAPTERS, meta: EC.ECLIPSE_META, scene: EC.ECLIPSE_SCENE, n: 7, fovLo: 40, fovHi: 70 },
    { label: 'phases', chapters: PC.PHASES_CHAPTERS, meta: PC.PHASES_META, scene: PC.PHASES_SCENE, n: 9, fovLo: 18, fovHi: 60 },
  ];
  for (const s of suites) {
    const { label, chapters, meta, scene, n } = s;
    check(`config/${label}: ${n} chapters`, chapters.length === n);
    check(`config/${label}: META id`, meta.id === scene.id);
    const camFields = ['az', 'el', 'dist', 'lookAz', 'lookEl', 'fov'];
    let shape = true, fovOk = true;
    const names = new Set();
    for (const ch of chapters) {
      if (typeof ch.id !== 'number' || typeof ch.name !== 'string' || !ch.name ||
          typeof ch.role !== 'string' || !ch.role) shape = false;
      names.add(ch.name);
      for (const f of camFields)
        if (typeof ch.camera?.[f] !== 'number' || !isFinite(ch.camera[f])) shape = false;
      if (!(ch.camera.fov >= s.fovLo && ch.camera.fov <= s.fovHi)) fovOk = false;
      for (const f of ['fogDensity', 'glint', 'exposure'])
        if (typeof ch[f] !== 'number' || !isFinite(ch[f])) shape = false;
      for (const g of ['ember', 'lantern'])
        if (!ch[g] || typeof ch[g] !== 'object') shape = false;
      if (ch.camera.dist <= 0) shape = false;
    }
    check(`config/${label}: every chapter has the engine field shape`, shape);
    check(`config/${label}: chapter names unique`, names.size === chapters.length);
    check(`config/${label}: fov within the scene's cinematic band`, fovOk);
    check(`config/${label}: ids are 1..${n} in order`,
      chapters.every((ch, i) => ch.id === i + 1));
    check(`config/${label}: chapterCount === ${n}`, scene.chapterCount === n);
    check(`config/${label}: simDuration === ${n * 24}`, scene.simDuration === n * 24);
    check(`config/${label}: scrollSpaceVh === ${n * 100}`, scene.scrollSpaceVh === n * 100);
    check(`config/${label}: decorate is a function`, typeof scene.decorate === 'function');
    check(`config/${label}: chapters array frozen`, Object.isFrozen(chapters));
  }
}

/* ================= color scripts: pure transforms ================= */
{
  const mkFrame = (i) => ({
    name: `k${i}`, emissive: [1, 1, 1],
    rampCore: [0.9 - 0.01 * i, 0.2 + 0.01 * i, 0.1],
    rampMid: [0.8 - 0.01 * i, 0.22 + 0.01 * i, 0.1],
    rampEdge: [0.5, 0.5, 0.55], fresnel: [0.1, 0.1, 0.1],
    haloTint: [1, 0.5, 0.3], haloGain: 1.0 - 0.02 * i, exposure: 1.0,
  });
  const base13 = [];
  for (let i = 0; i < 13; i++) base13.push(mkFrame(i));
  Object.freeze(base13); base13.forEach(Object.freeze);

  const f13 = FC.makeFormationColorScript(base13);
  const f13b = FC.makeFormationColorScript(base13);
  check('colorscript/formation: deterministic', JSON.stringify(f13) === JSON.stringify(f13b));
  check('colorscript/formation: resampled to the 7-chapter clock', f13.length === 7);
  check('colorscript/formation: input never mutated', base13[0].haloTint[0] === 1);
  check('colorscript/formation: white-hot early (halo leans orange)',
    f13[0].haloTint[0] > 0.9 && f13[0].haloTint[2] < 0.4,
    f13[0].haloTint.map((v) => v.toFixed(2)).join(','));
  check('colorscript/formation: cool gray late (halo neutral)',
    f13[6].haloTint[0] < 0.8 && f13[6].haloTint[2] > 0.85);
  let threw = false;
  try { FC.makeFormationColorScript([{ name: 'x' }]); } catch (e) { threw = true; }
  check('colorscript/formation: rejects short scripts loudly', threw);

  const e13 = EC.makeEclipseColorScript(base13);
  check('colorscript/eclipses: resampled to the 7-chapter clock', e13.length === 7);
  check('colorscript/eclipses: blood-moon frame reddened (r≫g)',
    e13[4].rampCore[0] > e13[4].rampCore[1] * 2,
    e13[4].rampCore.map((v) => v.toFixed(2)).join(','));
  check('colorscript/eclipses: totality frame dimmed cool', e13[1].exposure < 1.0);
  threw = false;
  try { EC.makeEclipseColorScript([{ name: 'x' }]); } catch (e) { threw = true; }
  check('colorscript/eclipses: rejects short scripts loudly', threw);

  const p13 = PC.makePhasesColorScript(base13);
  const p13b = PC.makePhasesColorScript(base13);
  check('colorscript/phases: deterministic', JSON.stringify(p13) === JSON.stringify(p13b));
  check('colorscript/phases: resampled to the 9-chapter clock', p13.length === 9);
  check('colorscript/phases: full-moon frame brighter',
    p13[4].exposure > p13[0].exposure, `${p13[4].exposure} vs ${p13[0].exposure}`);
  check('colorscript/phases: neutral bone (r≈g≈b)',
    Math.abs(p13[4].rampCore[0] - p13[4].rampCore[1]) < 0.02 &&
    Math.abs(p13[4].rampCore[1] - p13[4].rampCore[2]) < 0.02);
  threw = false;
  try { PC.makePhasesColorScript([{ name: 'x' }]); } catch (e) { threw = true; }
  check('colorscript/phases: rejects short scripts loudly', threw);
}

/* ================= framing: the focus stays in frame =================
 * Pure NDC check using each scene's camera convention
 * (camPos = dirFromAzEl(az,el)·dist, viewDir = dirFromAzEl(lookAz,lookEl)),
 * same model as the tidal-lock framing check.
 */
{
  function dirFromAzEl(az, el) {
    const ce = Math.cos(el);
    return [Math.cos(az) * ce, Math.sin(el), Math.sin(az) * ce];
  }
  function ndcFocus(ch, fx, fy, fz, w, h) {
    const cam = ch.camera;
    const cp = dirFromAzEl(cam.az, cam.el);
    const C = [cp[0] * cam.dist, cp[1] * cam.dist, cp[2] * cam.dist];
    const f0 = dirFromAzEl(cam.lookAz, cam.lookEl);
    const fl = Math.hypot(f0[0], f0[1], f0[2]);
    const f = [f0[0] / fl, f0[1] / fl, f0[2] / fl];
    let rx = f[2], ry = 0, rz = -f[0];
    const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
    const ux = ry * f[2] - rz * f[1], uy = rz * f[0] - rx * f[2], uz = rx * f[1] - ry * f[0];
    const d = [fx - C[0], fy - C[1], fz - C[2]];
    const zc = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
    const tanV = Math.tan((cam.fov * Math.PI / 180) / 2);
    const tanH = tanV * (w / h);
    return {
      nx: (d[0] * rx + d[1] * ry + d[2] * rz) / (zc * tanH),
      ny: (d[0] * ux + d[1] * uy + d[2] * uz) / (zc * tanV),
      zc,
    };
  }

  // Focus point per chapter, from each scene's own pure state.
  const { EARTH_R } = F.FORMATION;
  const theia0 = F.theiaAt(0);
  const formationFocus = [
    [theia0.x / 2, theia0.y / 2, theia0.z / 2],
    [F.theiaAt(1 / 6).x, F.theiaAt(1 / 6).y, F.theiaAt(1 / 6).z],
    [EARTH_R * 0.82, EARTH_R * 0.30, EARTH_R * 0.18],
    [0, 0, 0],
    [F.formationState(4 / 6).moonX, 0, F.formationState(4 / 6).moonZ],
    [F.formationState(5 / 6).moonX, 0, F.formationState(5 / 6).moonZ],
    [F.formationState(1).moonX, 0, F.formationState(1).moonZ],
  ];
  const m0 = E.moonPosAt(0);
  const eclipseFocus = [
    [m0.x / 2, m0.y / 2, m0.z / 2],
    [E.ECLIPSE.SUN_DIST, 0, 0],
    [0, 0, 0],
    [E.moonPosAt(0.5).x, E.moonPosAt(0.5).y, E.moonPosAt(0.5).z],
    [E.moonPosAt(2 / 3).x, E.moonPosAt(2 / 3).y, E.moonPosAt(2 / 3).z],
    [E.moonPosAt(5 / 6).x, E.moonPosAt(5 / 6).y, E.moonPosAt(5 / 6).z],
    [0, 0, 0],
  ];
  const phasesFocus = [];
  for (let i = 0; i < 9; i++) {
    const mp = P.moonPosAt(i / 8);
    phasesFocus.push([mp.x, mp.y, mp.z]);
  }

  const suites = [
    ['formation', FC.FORMATION_CHAPTERS, formationFocus],
    ['eclipses', EC.ECLIPSE_CHAPTERS, eclipseFocus],
    ['phases', PC.PHASES_CHAPTERS, phasesFocus],
  ];
  for (const [label, chapters, foci] of suites) {
    for (const vp of [[390, 844, '390×844 portrait'], [1440, 900, '1440×900 desktop']]) {
      const w = vp[0], h = vp[1], vlabel = vp[2];
      let worst = 0, okAll = true, detail = '';
      for (let i = 0; i < chapters.length; i++) {
        const r = ndcFocus(chapters[i], foci[i][0], foci[i][1], foci[i][2], w, h);
        const m = Math.max(Math.abs(r.nx), Math.abs(r.ny));
        if (m > worst) { worst = m; detail = `ch${i + 1} (${r.nx.toFixed(2)},${r.ny.toFixed(2)})`; }
        if (!(m <= 0.9 && r.zc > 0)) okAll = false;
      }
      check(`framing/${label}: focus in frame at all chapter keyframes (${vlabel})`,
        okAll, `worst |ndc|=${worst.toFixed(2)} at ${detail}`);
    }
  }
}

/* ================= scene-index: the three registrations ================= */
{
  const src = readFileSync(join(root, 'scenes', 'scene-index.js'), 'utf8');
  for (const [id, path] of [
    ['formation', './formation/formation-config.js'],
    ['eclipses', './eclipses/eclipses-config.js'],
    ['phases', './phases/phases-config.js'],
  ]) {
    check(`registry: '${id}' loader registered`,
      src.includes(`registerSceneLoader('${id}'`));
    check(`registry: '${id}' imports ${path}`, src.includes(path));
  }
  check('registry: tidal-lock registration intact',
    src.includes(`registerSceneLoader('tidal-lock'`));
}

/* ================= hygiene: no clocks / randomness ================= */
{
  const dirs = ['scenes/formation', 'scenes/eclipses', 'scenes/phases'];
  const files = ['scenes/scene-helpers.js'];
  for (const d of dirs)
    for (const f of readdirSync(join(root, d)).filter((f) => f.endsWith('.js')))
      files.push(`${d}/${f}`);
  const banned = [/Math\.random\s*\(/, /Date\.now\s*\(/, /performance\.now\s*\(/, /new Date\(/];
  let clean = true, offender = '';
  for (const f of files) {
    const src = readFileSync(join(root, f), 'utf8');
    for (const rx of banned) {
      if (rx.test(src)) { clean = false; offender = `${f}: ${rx}`; }
    }
  }
  check('hygiene: no Math.random()/Date.now()/performance.now()/new Date() calls in new scenes', clean, offender);
}

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
