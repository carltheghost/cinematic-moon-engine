/* scenes/eclipses/eclipses-config.js — the "eclipses" scene.
 *
 * "Chasing Shadows" — eclipse geometry as a scroll-driven act in the moon
 * engine: the Moon's shadow reaching for Earth, the corona of totality, the
 * diamond ring, the honest 5° tilt that makes eclipses rare, and the blood
 * moon in Earth's shadow.
 *
 * (Distinct from the 'eclipse-act' scene, which is an artistic blood-moon
 * over the valley — this act is the geometry itself: Sun, Earth, Moon,
 * umbra cones, nodes.)
 *
 * Follows the Phase 7 extension contract (docs/scene-extension.md):
 *   - pure data + pure transforms; imports NOTHING from engine/ except the
 *     leaf Rng util (engine/seed.js) — plus the shared pure scene helpers
 *     and the tidal scene's pure Earth-bake / audio-driver modules.
 *   - chapters → createCamera({ chapters }) + sampleChapterFrom (same model)
 *   - colorScript composed by the scene-index loader from the frozen script
 *   - chapterCount/simDuration → canonicalPresentation (7 chapters × 24)
 *   - decorate() — the single content hook; all eclipse staging lives here.
 *
 * The valley environment is hidden (env.group.visible=false): the act
 * stages deep space. Shadow-cone sizes take cinematic license (the real
 * umbra is a hairline at these scales); the node geometry is honest.
 */

import { Rng } from '../../engine/seed.js';
import { ECLIPSE, eclipseState, moonPosAt } from './eclipses.js';
import { makeNoiseTable, bakeEarthCanvas } from '../tidallock/earth.js';
import { createAudioDriver } from '../tidallock/audio-driver.js';
import { audioCueAt } from './audio-cues.js';
import {
  dirFromAzEl, lookAtPoint, lookAtOrigin, resampleScript, makeChapter,
} from '../scene-helpers.js';

/* ------------------------------------------------------------------ */
/* Chapter cameras aim at the geometry's keyframe pose.                 */
/* ------------------------------------------------------------------ */

const SUN_POS = { x: ECLIPSE.SUN_DIST, y: 0, z: 0 };
const MOON_T0 = moonPosAt(0);
const ALIGN_FOCUS = { x: (MOON_T0.x) / 2, y: MOON_T0.y / 2, z: MOON_T0.z / 2 };
const TILT_FOCUS = moonPosAt(0.5);
const BLOOD_FOCUS = moonPosAt(2 / 3);
const RED_FOCUS = moonPosAt(5 / 6);

export const ECLIPSE_CHAPTERS = Object.freeze([
  makeChapter(1, 'The Alignment',
    'Three bodies, one line — the Moon slides between Earth and Sun, and its shadow reaches for the Earth.',
    { az: 0.50, el: 0.28, dist: 1250, ...lookAtPoint(0.50, 0.28, 1250, ALIGN_FOCUS), fov: 58 }, 1.00),
  makeChapter(2, 'Totality',
    'Day becomes night. The Moon covers the Sun — and the corona blazes, the Sun\'s atmosphere laid bare.',
    { az: 0.12, el: 0.14, dist: 175, ...lookAtPoint(0.12, 0.14, 175, SUN_POS), fov: 55 }, 0.92),
  makeChapter(3, 'The Shadow Races',
    'The shadow sweeps across the Earth faster than a jet — totality lasts minutes, then the shadow moves on.',
    { az: 1.10, el: 0.30, dist: 950, ...lookAtOrigin(1.10, 0.30), fov: 54 }, 1.00),
  makeChapter(4, 'The Tilt',
    'The Moon\'s orbit leans five degrees — most months the shadow passes above or below. That is why eclipses are rare.',
    { az: 2.20, el: 0.06, dist: 1050, ...lookAtPoint(2.20, 0.06, 1050, TILT_FOCUS), fov: 56 }, 1.00),
  makeChapter(5, 'Blood Moon',
    'Half a month later: Earth slides between Sun and Moon — our shadow swallows it, and sunset light paints it red.',
    { az: Math.PI + 0.15, el: 0.20, dist: 950, ...lookAtPoint(Math.PI + 0.15, 0.20, 950, BLOOD_FOCUS), fov: 52 }, 1.06),
  makeChapter(6, 'Why Red',
    'The red is every sunrise and sunset on Earth at once — bent through our air and thrown onto the Moon.',
    { az: 3.60, el: 0.22, dist: 130, ...lookAtPoint(3.60, 0.22, 130, RED_FOCUS), fov: 48 }, 1.04),
  makeChapter(7, 'The Next One',
    'The dance never stops — the shadows keep falling, and somewhere on Earth someone is already waiting.',
    { az: 0.60, el: 0.25, dist: 1350, ...lookAtOrigin(0.60, 0.25), fov: 58 }, 1.00),
]);

export const ECLIPSE_META = Object.freeze({
  id: 'eclipses',
  title: 'Eclipses — chasing shadows',
  chapters: ECLIPSE_CHAPTERS.length,
  seed: 23,
});

/* ------------------------------------------------------------------ */
/* Injected color script: dimmed totality, blood-reddened frame.        */
/* ------------------------------------------------------------------ */

/**
 * PURE transform: derive the eclipse act's palette from the frozen canonical
 * COLOR_SCRIPT. Mostly neutral bone; the totality frame (ch2) dims cool and
 * the blood-moon frame (ch5) reddens.
 */
export function makeEclipseColorScript(baseScript) {
  if (!Array.isArray(baseScript) || baseScript.length < 2)
    throw new Error('makeEclipseColorScript: baseScript must be an array of ≥2 keyframes');
  const script = baseScript.length === ECLIPSE_CHAPTERS.length
    ? baseScript
    : resampleScript(baseScript, ECLIPSE_CHAPTERS.length);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const lerp = (a, b, f) => a + (b - a) * f;
  return script.map((k, i) => {
    const l = lum(k.rampCore);
    const bone = [l, l, l];
    let rampCore = bone.slice();
    let haloTint = [0.72, 0.80, 0.94];
    let exposure = k.exposure;
    if (i === 1) { // totality: cooler, dimmer
      exposure = k.exposure * 0.9;
      haloTint = [0.62, 0.74, 0.98];
    }
    if (i === 4) { // blood moon: sunset red
      const blood = [0.52, 0.13, 0.10];
      rampCore = bone.map((b, j) => lerp(b, blood[j], 0.75));
      haloTint = [0.90, 0.25, 0.15];
    }
    return {
      name: k.name,
      emissive: k.emissive.map((v) => v * 0.9),
      rampCore,
      rampMid: k.rampMid.map((c, j) => i === 4 ? lerp(c, 0.35 * [0.52, 0.13, 0.10][j], 0.5) : c),
      rampEdge: k.rampEdge.slice(),
      fresnel: k.fresnel.slice(),
      haloTint,
      haloGain: k.haloGain * 0.8,
      exposure,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Canvas sprites (PURE pixels; only these fns touch the DOM).          */
/* ------------------------------------------------------------------ */

function radialSprite(stops, size = 256) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const cx = cv.getContext('2d');
  const g = cx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, col] of stops) g.addColorStop(at, col);
  cx.fillStyle = g;
  cx.fillRect(0, 0, size, size);
  return cv;
}

const clamp01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;

/* ------------------------------------------------------------------ */
/* decorate: the scene content hook (runs once at host boot).          */
/* ------------------------------------------------------------------ */

export function decorateEclipses({ moon, env, post, postm, camera, scene, renderer, THREE, seed, config }) {
  // Deep space: the valley stays home for this act.
  env.group.visible = false;

  const E = ECLIPSE;
  const N = ECLIPSE_CHAPTERS.length;

  /* --- The Sun: a blazing disc far down +X, with a broad glow. --- */
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(E.SUN_R, 64, 48),
    new THREE.MeshBasicMaterial({ color: 0xfff3d0 })
  );
  sun.position.set(E.SUN_DIST, 0, 0);
  scene.add(sun);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(radialSprite([
      [0, 'rgba(255,250,230,1)'], [0.3, 'rgba(255,230,170,0.55)'],
      [0.7, 'rgba(255,200,120,0.16)'], [1, 'rgba(255,180,100,0)'],
    ])),
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  sunGlow.position.copy(sun.position);
  sunGlow.scale.setScalar(1150);
  scene.add(sunGlow);

  /* --- Earth: the seeded blue marble. --- */
  const table = makeNoiseTable(new Rng((seed ^ 0xE1C1) >>> 0));
  const earthTex = new THREE.CanvasTexture(bakeEarthCanvas(table));
  earthTex.colorSpace = THREE.SRGBColorSpace;
  earthTex.anisotropy = 4;
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(E.EARTH_R, 96, 64),
    new THREE.MeshStandardMaterial({ map: earthTex, roughness: 0.92, metalness: 0.0 })
  );
  scene.add(earth);

  /* --- The Moon, re-staged on its inclined orbit (engine moon, like tidal). --- */
  const orbitPivot = new THREE.Group();
  orbitPivot.add(moon.group);
  scene.add(orbitPivot);
  moon.group.position.set(0, 0, 0);
  moon.group.rotation.set(0, 0, 0);
  if (typeof moon.setMoonScale === 'function') moon.setMoonScale(E.MOON_R / 151);
  moon.group.scale.setScalar(E.MOON_R / 151);
  {
    const sd = dirFromAzEl(0, 0.02); // sunlight streams down +X
    if (typeof moon.setSunDirection === 'function')
      moon.setSunDirection(new THREE.Vector3(sd.x, sd.y, sd.z).normalize());
  }

  /* --- Shadow cones (cinematic license on width; node geometry honest). --- */
  // Moon's umbra: apex at the Moon, base (r=10) at Earth; swung per frame.
  const umbraGeo = new THREE.ConeGeometry(10, E.MOON_ORBIT, 32, 1, true);
  umbraGeo.translate(0, -E.MOON_ORBIT / 2, 0); // apex at origin, base at -Y
  umbraGeo.rotateZ(-Math.PI / 2);             // extends along -X
  const umbraMat = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.1,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const umbra = new THREE.Mesh(umbraGeo, umbraMat);
  umbra.frustumCulled = false;
  scene.add(umbra);
  // Earth's umbra: wide (r=60) at Earth, tapering far past the Moon. Static.
  const earthUmbraGeo = new THREE.ConeGeometry(E.EARTH_R, 1482, 48, 1, true);
  earthUmbraGeo.rotateZ(Math.PI / 2); // apex → -X, base → +X
  const earthUmbraMat = new THREE.MeshBasicMaterial({
    color: 0x1a0505, transparent: true, opacity: 0.06,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const earthUmbra = new THREE.Mesh(earthUmbraGeo, earthUmbraMat);
  earthUmbra.position.set(-741, 0, 0); // base at Earth, apex far down -X
  earthUmbra.frustumCulled = false;
  scene.add(earthUmbra);

  /* --- Corona: the blaze around the covered Sun. --- */
  const corona = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(radialSprite([
      [0, 'rgba(255,255,255,0)'], [0.18, 'rgba(255,252,244,0.95)'],
      [0.32, 'rgba(255,244,214,0.5)'], [0.6, 'rgba(255,230,180,0.14)'],
      [1, 'rgba(255,220,160,0)'],
    ], 512)),
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  corona.position.copy(sun.position);
  corona.scale.setScalar(760);
  corona.material.opacity = 0;
  scene.add(corona);

  /* --- Diamond ring: the last bead of sunlight. --- */
  const ring = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(radialSprite([
      [0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,250,235,0.7)'], [1, 'rgba(255,240,210,0)'],
    ])),
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  ring.scale.setScalar(46);
  ring.material.opacity = 0;
  scene.add(ring);

  /* --- Lights: sunlight down +X. --- */
  const sunLight = new THREE.DirectionalLight(0xfff2e0, 2.6);
  sunLight.position.set(3000, 120, 60);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0x223349, 0.5));

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

  /* --- Per-frame eclipse staging, driven by the chapter clock. --- */
  const origSetChapter = moon.setChapter.bind(moon);
  moon.setChapter = (chapterT) => {
    origSetChapter(chapterT);
    const actT = clamp01(chapterT / (N - 1));
    const st = eclipseState(actT);

    // The Moon on its inclined orbit, tidally locked (one face to Earth).
    orbitPivot.position.set(st.moonX, st.moonY, st.moonZ);
    moon.group.rotation.y = -st.moonAngle;

    // The Moon's umbra swings with it, always reaching for Earth.
    umbra.position.set(st.moonX, st.moonY, st.moonZ);
    umbra.rotation.y = -st.moonAngle;
    umbraMat.opacity = 0.08 + 0.22 * st.solar + 0.12 * st.penumbra;

    // Earth's umbra deepens as the blood moon comes.
    earthUmbraMat.opacity = 0.06 + 0.30 * st.lunar;

    // Corona blaze + diamond ring at the Sun.
    corona.material.opacity = Math.min(1, st.corona * 1.15);
    const rs = Math.min(1, st.ringFlash);
    ring.material.opacity = rs;
    ring.position.set(st.moonX + E.MOON_R * 1.1, st.moonY, st.moonZ);
    ring.scale.setScalar(30 + 40 * rs);

    // Blood: the engine's own eclipse hook reddens the Moon.
    if (typeof moon.setEclipse === 'function') moon.setEclipse(st.blood);

    // Earth turns slowly beneath it all.
    earth.rotation.y = actT * Math.PI * 0.9;

    // Captions follow the chapter index.
    const idx = Math.min(N - 1, Math.max(0, Math.round(chapterT)));
    if (idx !== capIdx) {
      capIdx = idx;
      const ch = ECLIPSE_CHAPTERS[idx];
      capName.textContent = `${ch.id} · ${ch.name}`;
      capRole.textContent = ch.role;
      caption.style.opacity = '1';
    }

    // The score follows the same clock.
    audio.update(audioCueAt(actT));
  };
}

/** The registered scene config (engine/scene.js shape). */
export const ECLIPSE_SCENE = Object.freeze({
  id: 'eclipses',
  title: 'Eclipses — chasing shadows',
  chapters: ECLIPSE_CHAPTERS,
  colorScript: null, // composed by the scene-index loader via makeEclipseColorScript
  chapterCount: ECLIPSE_CHAPTERS.length, // 7
  simDuration: 168,                      // 7 chapters × 24
  chapterLocator: null, // → engine default: defaultChapterLocator
  scrollSpaceVh: 700,   // 7 chapters × 100vh
  decorate: decorateEclipses,
});
