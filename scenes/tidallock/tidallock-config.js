/* scenes/tidallock/tidallock-config.js — the "tidal-lock" scene.
 *
 * "How the Moon Became Tidally Locked" — the cinematic the short tells, as a
 * scroll-driven act in the moon engine: the young Moon spinning fast on a
 * close orbit, Earth's gravity raising tidal bulges, friction dragging the
 * bulges into a lagging torque, the spin decaying, the orbit widening — and
 * the lock moment, when the same face turns to Earth forever.
 *
 * Follows the Phase 7 extension contract (docs/scene-extension.md):
 *   - pure data + pure transforms; imports NOTHING from engine/ except the
 *     leaf Rng util (engine/seed.js — no rendering deps, no cycles).
 *   - chapters → createCamera({ chapters }) + sampleChapterFrom (same model)
 *   - colorScript composed by the scene-index loader from the frozen script
 *   - chapterCount/simDuration → canonicalPresentation (7 chapters × 24)
 *   - decorate() — the single content hook; all tidal staging lives here.
 *
 * The valley environment is hidden for this scene (env.group.visible=false):
 * the act stages deep space — Earth, the Moon, and the tidal machinery.
 */

import { Rng } from '../../engine/seed.js';
import { TIDAL, tidalState } from './tidal.js';
import { makeNoiseTable, bakeEarthCanvas } from './earth.js';
import { audioCueAt } from './audio-cues.js';
import { createAudioDriver } from './audio-driver.js';

/* ------------------------------------------------------------------ */
/* Camera aim helpers (plain math — the engine's dirFromAzEl convention). */
/* ------------------------------------------------------------------ */

function dirFromAzEl(az, el) {
  const ce = Math.cos(el);
  return { x: Math.cos(az) * ce, y: Math.sin(el), z: Math.sin(az) * ce };
}

function azElOfDir(d) {
  const l = Math.hypot(d.x, d.y, d.z) || 1;
  return { az: Math.atan2(d.z / l, d.x / l), el: Math.asin(Math.max(-1, Math.min(1, d.y / l))) };
}

/** Look-target fields that aim the camera back at the origin. */
function lookAtOrigin(az, el) {
  return { lookAz: az + Math.PI, lookEl: -el };
}

/** Look-target fields that aim from (az, el, dist) at the Moon's mid-chapter pose. */
function lookAtMoon(az, el, dist, actT) {
  const st = tidalState(actT);
  const cp = dirFromAzEl(az, el);
  const cam = { x: cp.x * dist, y: cp.y * dist, z: cp.z * dist };
  const dir = { x: st.moonX - cam.x, y: 0 - cam.y, z: st.moonZ - cam.z };
  const { az: lookAz, el: lookEl } = azElOfDir(dir);
  return { lookAz, lookEl };
}

/* ------------------------------------------------------------------ */
/* The seven chapters.                                                 */
/* ------------------------------------------------------------------ */

const QUIET_ENV = Object.freeze({
  ember: Object.freeze({ density: 0.0, opacity: 0.0, drift: 0.0, warmth: 0.0 }),
  lantern: Object.freeze({ heroIntensity: 0.0, poolIntensity: 0.0, poolVisibility: 0.0, heroSlots: 'nearest' }),
});

function chapter(id, name, role, cam, exposure, extra = {}) {
  return Object.freeze({
    id, name, role,
    camera: Object.freeze(cam),
    fogDensity: 0.0001,
    ember: QUIET_ENV.ember,
    lantern: QUIET_ENV.lantern,
    glint: 0.0,
    exposure,
    ...extra,
  });
}

// Hero chapter (ch5) aims at the Moon where it sits mid-chapter (t = 4/6).
const HERO_AIM = lookAtMoon(2.60, 0.18, 250, 4 / 6);

export const TIDAL_CHAPTERS = Object.freeze([
  chapter(1, 'First Spin',
    'Four billion years ago the Moon is young, close, and spinning — nine days in a single orbit.',
    { az: 0.60, el: 0.35, dist: 980, ...lookAtOrigin(0.60, 0.35), fov: 56 }, 0.95),
  chapter(2, 'The Pull',
    "Earth's gravity reaches across the gap and raises the oceans of rock — tidal bulges rise on the Moon.",
    { az: 1.10, el: 0.30, dist: 760, ...lookAtOrigin(1.10, 0.30), fov: 55 }, 1.00),
  chapter(3, 'The Drag',
    'The bulges lag behind the pull. Friction turns rock against rock — a brake the size of a world.',
    { az: 1.60, el: 0.26, dist: 560, ...lookAtOrigin(1.60, 0.26), fov: 54 }, 1.02),
  chapter(4, 'The Long Slowdown',
    'Every century the spin bleeds away. The stolen momentum lifts the Moon — its orbit widens.',
    { az: 2.10, el: 0.22, dist: 430, ...lookAtOrigin(2.10, 0.22), fov: 52 }, 1.04),
  chapter(5, 'The Lock',
    'Spin equals orbit. The brake releases — one face turns to Earth, and never turns away again.',
    { az: 2.60, el: 0.18, dist: 250, lookAz: HERO_AIM.lookAz, lookEl: HERO_AIM.lookEl, fov: 48 }, 1.12),
  chapter(6, 'One Face',
    'Locked — but not frozen. The Moon nods as it goes, a slow libration, like it is still dreaming.',
    { az: 3.10, el: 0.28, dist: 420, ...lookAtOrigin(3.10, 0.28), fov: 52 }, 1.02),
  chapter(7, 'Today',
    'The Moon we know: one face forever, drifting a little farther every year — still slowing, still bound.',
    { az: 3.60, el: 0.14, dist: 780, ...lookAtOrigin(3.60, 0.14), fov: 58 }, 1.00),
]);

export const TIDAL_META = Object.freeze({
  id: 'tidal-lock',
  title: 'Tidal Lock — how the Moon became tidally locked',
  chapters: TIDAL_CHAPTERS.length,
  seed: 7,
});

/* ------------------------------------------------------------------ */
/* Injected color script: the tidal Moon is bone-neutral, not vermilion. */
/* ------------------------------------------------------------------ */

/**
 * PURE transform: derive the tidal act's moon palette from the frozen
 * canonical COLOR_SCRIPT. The documentary Moon is sunlit rock — desaturate
 * the vermilion ramp toward bone, keep a cool earthshine limb, soften the
 * halo to neutral. Deterministic: pure function of the input script.
 */
export function makeTidalColorScript(baseScript) {
  if (!Array.isArray(baseScript) || baseScript.length < 2)
    throw new Error('makeTidalColorScript: baseScript must be an array of ≥2 keyframes');
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const toBone = (c, warmth) => {
    const l = lum(c);
    // bone: luminance with a whisper of warmth, cool edge preserved
    return [l + warmth * 0.030, l + warmth * 0.012, l - warmth * 0.018];
  };
  return baseScript.map((k, i) => {
    const warmth = 1 - i / (baseScript.length - 1); // warmer early, cooler late
    return {
      name: k.name,
      emissive: k.emissive.map((v) => v * 0.9),
      rampCore: toBone(k.rampCore, warmth),
      rampMid: toBone(k.rampMid, warmth),
      rampEdge: k.rampEdge.slice(), // the cool limb stays per contract
      fresnel: k.fresnel.slice(),
      haloTint: [0.72, 0.80, 0.94],
      haloGain: k.haloGain * 0.8,
      exposure: k.exposure,
    };
  });
}

/* ------------------------------------------------------------------ */
/* decorate: the scene content hook (runs once at host boot).          */
/* ------------------------------------------------------------------ */

export function decorateTidal({ moon, env, post, postm, camera, scene, renderer, THREE, seed, config }) {
  // Deep space: the valley stays home for this act.
  env.group.visible = false;

  const T = TIDAL;
  const N = TIDAL_CHAPTERS.length;

  /* --- Earth: seeded procedural blue marble + fresnel atmosphere. --- */
  const table = makeNoiseTable(new Rng((seed ^ 0x71d1) >>> 0));
  const earthCanvas = bakeEarthCanvas(table);
  const earthTex = new THREE.CanvasTexture(earthCanvas);
  earthTex.colorSpace = THREE.SRGBColorSpace;
  earthTex.anisotropy = 4;
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(T.EARTH_R, 96, 64),
    new THREE.MeshStandardMaterial({ map: earthTex, roughness: 0.92, metalness: 0.0 })
  );
  const earthGroup = new THREE.Group();
  earthGroup.add(earth);
  // Analytic atmosphere shell: fresnel rim, additive, back-side.
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(T.EARTH_R * 1.035, 96, 64),
    new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        glowColor: { value: new THREE.Color(0.30, 0.55, 1.0) },
      },
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vNormal;
        uniform vec3 glowColor;
        void main() {
          float rim = pow(1.0 - abs(vNormal.z), 3.0);
          gl_FragColor = vec4(glowColor * rim * 1.6, rim);
        }`,
    })
  );
  earthGroup.add(atmo);
  scene.add(earthGroup);

  /* --- The Moon, re-staged: orbit pivot → spin pivot → engine moon. --- */
  const orbitPivot = new THREE.Group();   // positioned on the orbit each frame
  const spinPivot = new THREE.Group();    // rotated by the spin angle
  spinPivot.add(moon.group);
  orbitPivot.add(spinPivot);
  scene.add(orbitPivot);
  moon.group.position.set(0, 0, 0);
  moon.group.rotation.set(0, 0, 0);
  moon.group.scale.setScalar(T.MOON_R / 151); // baked at r=151 → cinematic 16.4
  // Dramatic side-light for the documentary Moon (overrides the host's full-moon rig).
  {
    const sunDir = new THREE.Vector3(0.75, 0.38, 0.55).normalize();
    moon.setSunDirection(sunDir);
  }

  // Gold spin marker: a small beacon on the Moon's marked face so the spin
  // — and the lock — is visible at a glance.
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xd9a44e })
  );
  marker.position.set(T.MOON_R * 1.04, T.MOON_R * 0.18, 0);
  spinPivot.add(marker);
  const markerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    color: 0xd9a44e, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  markerGlow.scale.setScalar(9);
  markerGlow.position.copy(marker.position);
  spinPivot.add(markerGlow);

  /* --- Tidal bulges: twin gold ellipsoids on the Earth line, with lag. --- */
  const bulgeMat = new THREE.MeshBasicMaterial({
    color: 0xd9a44e, transparent: true, opacity: 0.30,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const bulgeGroup = new THREE.Group(); // aligned to Earth dir + lag each frame
  const bulgeGeo = new THREE.SphereGeometry(1, 32, 24);
  const bulgeNear = new THREE.Mesh(bulgeGeo, bulgeMat);
  const bulgeFar = new THREE.Mesh(bulgeGeo, bulgeMat.clone());
  bulgeNear.scale.set(T.MOON_R * 0.42, T.MOON_R * 0.30, T.MOON_R * 0.30);
  bulgeFar.scale.copy(bulgeNear.scale);
  bulgeNear.position.set(-T.MOON_R * 1.02, 0, 0);
  bulgeFar.position.set(T.MOON_R * 1.02, 0, 0);
  bulgeGroup.add(bulgeNear, bulgeFar);
  orbitPivot.add(bulgeGroup);

  /* --- Drag arcs: the friction torque made visible (fade as spin locks). --- */
  const dragMat = new THREE.LineBasicMaterial({
    color: 0xd9a44e, transparent: true, opacity: 0.5,
  });
  const dragArcs = new THREE.Group();
  for (const [tilt, dir] of [[0.5, 1], [-0.5, -1]]) {
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 1.2 * dir;
      pts.push(new THREE.Vector3(
        Math.cos(a) * T.MOON_R * 1.7,
        Math.sin(a) * T.MOON_R * 1.7 * 0.45 + tilt * T.MOON_R * 0.9,
        Math.sin(a * 0.7) * T.MOON_R * 0.5
      ));
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts), dragMat);
    dragArcs.add(line);
  }
  orbitPivot.add(dragArcs);

  /* --- Orbit ring: faint circle the Moon travels (radius follows recession). --- */
  const ringPts = [];
  for (let i = 0; i <= 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    ringPts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
  }
  const orbitRing = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(ringPts),
    new THREE.LineBasicMaterial({ color: 0x8fa3c8, transparent: true, opacity: 0.22 })
  );
  scene.add(orbitRing);

  /* --- Lights for the standard-material Earth (the moon lights itself). --- */
  const sun = new THREE.DirectionalLight(0xfff2e0, 2.6);
  sun.position.set(750, 380, 550);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x223349, 0.55));

  /* --- Cinematic lower-third captions, synced to the chapter clock. --- */
  const caption = document.createElement('div');
  caption.id = 'tidal-caption';
  caption.style.cssText = [
    'position:fixed', 'left:0', 'right:0', 'bottom:7vh', 'z-index:5',
    'text-align:center', 'pointer-events:none',
    'transition:opacity 0.6s ease', 'opacity:0',
  ].join(';');
  caption.innerHTML =
    '<div id="tidal-cap-name" style="font:600 15px/1.4 system-ui,sans-serif;' +
    'letter-spacing:0.42em;color:#d9a44e;text-transform:uppercase"></div>' +
    '<div id="tidal-cap-role" style="font:400 14px/1.6 system-ui,sans-serif;' +
    'color:rgba(230,236,245,0.82);max-width:620px;margin:10px auto 0;padding:0 24px"></div>';
  document.body.appendChild(caption);
  const capName = caption.querySelector('#tidal-cap-name');
  const capRole = caption.querySelector('#tidal-cap-role');
  let capIdx = -1;
  // Fade captions out during fast scrub (they strobe otherwise).
  let capTimer = 0;

  /* --- Sound: the scroll-synced score. --- */
  const audio = createAudioDriver();

  /* --- Per-frame tidal staging, driven by the chapter clock. --- */
  const origSetChapter = moon.setChapter.bind(moon);
  moon.setChapter = (chapterT) => {
    origSetChapter(chapterT);
    const actT = Math.min(1, Math.max(0, chapterT / (N - 1)));
    const st = tidalState(actT);

    // Moon on its (widening) orbit.
    orbitPivot.position.set(st.moonX, 0, st.moonZ);
    // The spin — plus post-lock libration.
    spinPivot.rotation.y = -(st.spinAngle + st.libration);
    // Tidal bulges ride the Earth line with the friction lag.
    // (+X toward Earth at rotation.y = π − orbitAngle; lag added on top.)
    bulgeGroup.rotation.y = Math.PI - st.orbitAngle + st.bulgeLag;
    const pulse = 1 + st.lockPulse * 0.55;
    const bAmp = st.bulgeAmp * pulse;
    bulgeNear.scale.set(T.MOON_R * 0.42 * bAmp, T.MOON_R * 0.30 * bAmp, T.MOON_R * 0.30 * bAmp);
    bulgeFar.scale.copy(bulgeNear.scale);
    bulgeMat.opacity = 0.16 + 0.22 * st.bulgeAmp + 0.25 * st.lockPulse;
    bulgeFar.material.opacity = bulgeMat.opacity;
    // Drag arcs breathe with the remaining spin excess.
    const spinF = (st.spinRate - 1) / (T.R0 - 1);
    dragMat.opacity = 0.08 + 0.5 * spinF;
    dragArcs.rotation.y = -st.spinAngle * 0.15;
    // The orbit ring follows the recession.
    orbitRing.scale.setScalar(st.orbitRadius);
    // Earth turns slowly beneath it all.
    earthGroup.rotation.y = actT * Math.PI * 1.2;
    // Marker glow swells at the lock moment.
    markerGlow.material.opacity = 0.4 + 0.5 * st.lockPulse;
    markerGlow.scale.setScalar(9 * (1 + st.lockPulse * 0.8));

    // Captions follow the chapter index.
    const idx = Math.min(N - 1, Math.max(0, Math.round(chapterT)));
    if (idx !== capIdx) {
      capIdx = idx;
      const ch = TIDAL_CHAPTERS[idx];
      capName.textContent = `${ch.id} · ${ch.name}`;
      capRole.textContent = ch.role;
      caption.style.opacity = '1';
      clearTimeout(capTimer);
      capTimer = setTimeout(() => { caption.style.opacity = '0.92'; }, 50);
    }

    // The score follows the same clock.
    audio.update(audioCueAt(actT));
  };
}

/** The registered scene config (engine/scene.js shape). */
export const TIDAL_SCENE = Object.freeze({
  id: 'tidal-lock',
  title: 'Tidal Lock — how the Moon became tidally locked',
  chapters: TIDAL_CHAPTERS,
  colorScript: null, // composed by the scene-index loader via makeTidalColorScript
  chapterCount: TIDAL_CHAPTERS.length, // 7
  simDuration: 168,                    // 7 chapters × 24
  chapterLocator: null, // → engine default: defaultChapterLocator
  scrollSpaceVh: 700,   // 7 chapters × 100vh
  decorate: decorateTidal,
});
