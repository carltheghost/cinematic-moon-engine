/* scenes/phases/phases-config.js — the "phases" scene.
 *
 * "The Faces of the Moon" — one full synodic month as a scroll-driven act
 * in the moon engine, shot as Earth sees it: the camera rides with the
 * viewer, tracking the Moon while fixed sunlight sculpts the phases.
 * Nine chapters put every named phase exactly on a keyframe.
 *
 * Cinematic license, stated plainly: the lens is a telephoto (fov ~22),
 * the way every real phases timelapse is shot — the geometry underneath
 * (one orbit, fixed sun, true illumination curve) is honest.
 *
 * Follows the Phase 7 extension contract (docs/scene-extension.md):
 *   - pure data + pure transforms; imports NOTHING from engine/ except the
 *     leaf Rng util (engine/seed.js) — plus the shared pure scene helpers
 *     and the tidal scene's audio-driver module.
 *   - chapters → createCamera({ chapters }) + sampleChapterFrom (same model)
 *   - colorScript composed by the scene-index loader from the frozen script
 *   - chapterCount/simDuration → canonicalPresentation (9 chapters × 24)
 *   - decorate() — the single content hook; all phases staging lives here.
 *
 * The valley environment is hidden (env.group.visible=false): the act
 * stages near-Earth space.
 */

import { PHASES, phaseState, moonPosAt } from './phases.js';
import { createAudioDriver } from '../tidallock/audio-driver.js';
import { audioCueAt } from './audio-cues.js';
import {
  dirFromAzEl, lookAtPoint, resampleScript, makeChapter,
} from '../scene-helpers.js';

/* ------------------------------------------------------------------ */
/* Chapter cameras: the Earth-viewer tracking the Moon.                 */
/* ------------------------------------------------------------------ */

function phaseChapter(i, name, role, exposure) {
  const t = i / 8;
  const mp = moonPosAt(t);
  const moonAngle = Math.PI * 2 * t;
  const az = moonAngle + Math.PI; // camera on Earth's far side from the Moon
  const el = 0.12, dist = 150;
  return makeChapter(i + 1, name, role,
    { az, el, dist, ...lookAtPoint(az, el, dist, mp), fov: 22 }, exposure);
}

export const PHASES_CHAPTERS = Object.freeze([
  phaseChapter(0, 'New Moon',
    'Between Earth and Sun — the night side faces us, and the Moon vanishes into the glare.', 1.00),
  phaseChapter(1, 'Waxing Crescent',
    'A sliver of light returns — and earthshine ghosts the dark side.', 1.00),
  phaseChapter(2, 'First Quarter',
    'Half lit, half dark — the terminator straight as a blade.', 1.02),
  phaseChapter(3, 'Waxing Gibbous',
    'Growing toward full — sunlight creeps across the craters.', 1.04),
  phaseChapter(4, 'Full Moon',
    'The whole face blazes — sunlight straight on, every shadow erased.', 1.08),
  phaseChapter(5, 'Waning Gibbous',
    'The light begins its long retreat.', 1.04),
  phaseChapter(6, 'Last Quarter',
    'The other half now — a mirror of the first.', 1.02),
  phaseChapter(7, 'Waning Crescent',
    'The last sliver — earthshine\'s final ghost.', 1.00),
  phaseChapter(8, 'New Moon Again',
    'Darkness — and the cycle renews, as it has for four billion years.', 1.00),
]);

export const PHASES_META = Object.freeze({
  id: 'phases',
  title: 'Phases — the faces of the Moon',
  chapters: PHASES_CHAPTERS.length,
  seed: 37,
});

/* ------------------------------------------------------------------ */
/* Injected color script: neutral bone, a touch brighter at full.       */
/* ------------------------------------------------------------------ */

/**
 * PURE transform: derive the phases act's palette from the frozen canonical
 * COLOR_SCRIPT. Nine frames, neutral bone throughout; the full-moon frame
 * (ch5) gets a breath more exposure.
 */
export function makePhasesColorScript(baseScript) {
  if (!Array.isArray(baseScript) || baseScript.length < 2)
    throw new Error('makePhasesColorScript: baseScript must be an array of ≥2 keyframes');
  const script = baseScript.length === PHASES_CHAPTERS.length
    ? baseScript
    : resampleScript(baseScript, PHASES_CHAPTERS.length);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return script.map((k, i) => {
    const l = lum(k.rampCore);
    const m = lum(k.rampMid);
    return {
      name: k.name,
      emissive: k.emissive.map((v) => v * 0.9),
      rampCore: [l, l, l],
      rampMid: [m, m, m],
    rampEdge: k.rampEdge.slice(),
    fresnel: k.fresnel.slice(),
    haloTint: [0.72, 0.80, 0.94],
    haloGain: k.haloGain * 0.8,
    exposure: i === 4 ? k.exposure * 1.06 : k.exposure,
    };
  });
}

/* ------------------------------------------------------------------ */
const clamp01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;

/* ------------------------------------------------------------------ */
/* decorate: the scene content hook (runs once at host boot).          */
/* ------------------------------------------------------------------ */

export function decoratePhases({ moon, env, post, postm, camera, scene, renderer, THREE, seed, config }) {
  // Near-Earth space: the valley stays home for this act.
  env.group.visible = false;

  const P = PHASES;
  const N = PHASES_CHAPTERS.length;

  /* --- The Moon, re-staged: one orbit, fixed sunlight, honest phases. --- */
  const orbitPivot = new THREE.Group();
  orbitPivot.add(moon.group);
  scene.add(orbitPivot);
  moon.group.position.set(0, 0, 0);
  moon.group.rotation.set(0, 0, 0);
  if (typeof moon.setMoonScale === 'function') moon.setMoonScale(P.MOON_R / 151);
  moon.group.scale.setScalar(P.MOON_R / 151);
  {
    const sd = dirFromAzEl(0, 0.02); // sunlight streams down +X, all month
    if (typeof moon.setSunDirection === 'function')
      moon.setSunDirection(new THREE.Vector3(sd.x, sd.y, sd.z).normalize());
  }

  /* --- Earthshine: the real ghost light, Earth → Moon. --- */
  const shineTarget = new THREE.Object3D();
  scene.add(shineTarget);
  const earthshine = new THREE.DirectionalLight(0x8fb4ff, 0);
  earthshine.position.set(0, 0, 0);
  earthshine.target = shineTarget;
  scene.add(earthshine);
  scene.add(new THREE.AmbientLight(0x11151d, 0.35));

  /* --- The Sun's glare behind the new moon (fades as the disc lights). --- */
  const glareCv = document.createElement('canvas');
  glareCv.width = 256; glareCv.height = 256;
  {
    const cx = glareCv.getContext('2d');
    const g = cx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,252,240,1)');
    g.addColorStop(0.35, 'rgba(255,240,200,0.5)');
    g.addColorStop(1, 'rgba(255,230,170,0)');
    cx.fillStyle = g;
    cx.fillRect(0, 0, 256, 256);
  }
  const glare = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(glareCv),
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    opacity: 0.5,
  }));
  glare.position.set(3000, 0, 0);
  glare.scale.setScalar(420);
  scene.add(glare);

  /* --- Cinematic lower-third captions, synced to the chapter clock. --- */
  const caption = document.createElement('div');
  caption.style.cssText = [
    'position:fixed', 'left:0', 'right:0', 'bottom:7vh', 'z-index:5',
    'text-align:center', 'pointer-events:none',
    'transition:opacity 0.6s ease', 'opacity:0',
  ].join(';');
  caption.innerHTML =
    '<div style="font:600 15px/1.4 system-ui,sans-serif;letter-spacing:0.42em;' +
    'color:#d9a44e;text-transform:uppercase" class="cap-name"></div>' +
    '<div style="font:400 14px/1.6 system-ui,sans-serif;color:rgba(230,236,245,0.82);' +
    'max-width:620px;margin:10px auto 0;padding:0 24px" class="cap-role"></div>';
  document.body.appendChild(caption);
  const capName = caption.querySelector('.cap-name');
  const capRole = caption.querySelector('.cap-role');
  let capIdx = -1;

  /* --- Sound: the scroll-synced score. --- */
  const audio = createAudioDriver();

  /* --- Per-frame phases staging, driven by the chapter clock. --- */
  const origSetChapter = moon.setChapter.bind(moon);
  moon.setChapter = (chapterT) => {
    origSetChapter(chapterT);
    const actT = clamp01(chapterT / (N - 1));
    const st = phaseState(actT);

    // The Moon circles Earth, tidally locked — one face for the whole month.
    orbitPivot.position.set(st.moonX, st.moonY, st.moonZ);
    moon.group.rotation.y = -st.moonAngle;

    // Earthshine ghosts the dark limb near new moon.
    shineTarget.position.set(st.moonX, st.moonY, st.moonZ);
    earthshine.intensity = st.earthshine * 1.6;

    // The Sun's glare burns behind the new moon, gone by first quarter.
    glare.material.opacity = (1 - st.illumination) * 0.55;

    // Captions follow the chapter index.
    const idx = Math.min(N - 1, Math.max(0, Math.round(chapterT)));
    if (idx !== capIdx) {
      capIdx = idx;
      const ch = PHASES_CHAPTERS[idx];
      capName.textContent = `${ch.id} · ${ch.name}`;
      capRole.textContent = ch.role;
      caption.style.opacity = '1';
    }

    // The score follows the same clock.
    audio.update(audioCueAt(actT));
  };
}

/** The registered scene config (engine/scene.js shape). */
export const PHASES_SCENE = Object.freeze({
  id: 'phases',
  title: 'Phases — the faces of the Moon',
  chapters: PHASES_CHAPTERS,
  colorScript: null, // composed by the scene-index loader via makePhasesColorScript
  chapterCount: PHASES_CHAPTERS.length, // 9
  simDuration: 216,                     // 9 chapters × 24
  chapterLocator: null, // → engine default: defaultChapterLocator
  scrollSpaceVh: 900,   // 9 chapters × 100vh
  decorate: decoratePhases,
});
