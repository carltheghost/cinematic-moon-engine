/* scenes/formation/formation-config.js — the "formation" scene.
 *
 * "How the Moon Was Born" — the giant-impact story as a scroll-driven act in
 * the moon engine: two worlds, the collision, the glowing debris disk, the
 * gathering of a molten Moon, and its long cooling to the gray world we know.
 *
 * Follows the Phase 7 extension contract (docs/scene-extension.md):
 *   - pure data + pure transforms; imports NOTHING from engine/ except the
 *     leaf Rng util (engine/seed.js) — plus the shared pure scene helpers
 *     and the tidal scene's pure noise / audio-driver modules (no rendering
 *     deps, no cycles).
 *   - chapters → createCamera({ chapters }) + sampleChapterFrom (same model)
 *   - colorScript composed by the scene-index loader from the frozen script
 *   - chapterCount/simDuration → canonicalPresentation (7 chapters × 24)
 *   - decorate() — the single content hook; all formation staging lives here.
 *
 * The valley environment is hidden for this scene (env.group.visible=false):
 * the act stages deep space — Earth, Theia, the disk, and the young Moon.
 * The engine moon is hidden too: the molten young Moon is a bespoke mesh
 * whose emissive heat is the story.
 */

import { Rng } from '../../engine/seed.js';
import { FORMATION, formationState, theiaAt } from './formation.js';
import { makeNoiseTable, fbm } from '../tidallock/earth.js';
import { createAudioDriver } from '../tidallock/audio-driver.js';
import { audioCueAt } from './audio-cues.js';
import {
  dirFromAzEl, lookAtPoint, lookAtOrigin, resampleScript, makeChapter,
} from '../scene-helpers.js';

/* ------------------------------------------------------------------ */
/* Chapter cameras aim at the action's keyframe pose.                   */
/* ------------------------------------------------------------------ */

function lookAtFormation(az, el, dist, t) {
  const st = formationState(t);
  return lookAtPoint(az, el, dist, { x: st.moonX, y: 0, z: st.moonZ });
}

const THEIA_T0 = theiaAt(0);           // (-950, 210, -520)
const THEIA_MID = theiaAt(1 / 6);      // the approach, mid-chapter 2
const MIDPOINT_T0 = {
  x: THEIA_T0.x / 2, y: THEIA_T0.y / 2, z: THEIA_T0.z / 2,
};
const IMPACT_PT = {
  x: FORMATION.EARTH_R * 0.82,
  y: FORMATION.EARTH_R * 0.30,
  z: FORMATION.EARTH_R * 0.18,
};

export const FORMATION_CHAPTERS = Object.freeze([
  makeChapter(1, 'Two Worlds',
    'Four and a half billion years ago: the young Earth — and Theia, a Mars-sized world falling toward it.',
    { az: 0.75, el: 0.22, dist: 1350, ...lookAtPoint(0.75, 0.22, 1350, MIDPOINT_T0), fov: 58 }, 0.95),
  makeChapter(2, 'The Approach',
    'Theia rushes in — gravity\'s grip tightening with every mile, the two worlds heating as they near.',
    { az: 0.90, el: 0.18, dist: 760, ...lookAtPoint(0.90, 0.18, 760, THEIA_MID), fov: 55 }, 1.00),
  makeChapter(3, 'The Collision',
    'Impact. In an instant the energy melts both worlds — Theia is consumed, and the Earth is remade.',
    { az: 1.30, el: 0.24, dist: 430, ...lookAtPoint(1.30, 0.24, 430, IMPACT_PT), fov: 52 }, 1.15),
  makeChapter(4, 'The Debris Disk',
    'Vaporized rock settles into a glowing ring — the ruins of two worlds, orbiting as one.',
    { az: 1.80, el: 0.30, dist: 560, ...lookAtOrigin(1.80, 0.30), fov: 54 }, 1.08),
  makeChapter(5, 'Coalescence',
    'The ring gathers itself — moonlets merge and rain together, and a new world takes shape.',
    { az: 2.30, el: 0.26, dist: 460, ...lookAtFormation(2.30, 0.26, 460, 4 / 6), fov: 52 }, 1.05),
  makeChapter(6, 'The Molten Moon',
    'A magma-ocean Moon, glowing white-hot, hanging close enough to fill the young sky.',
    { az: 2.80, el: 0.20, dist: 150, ...lookAtFormation(2.80, 0.20, 150, 5 / 6), fov: 48 }, 1.12),
  makeChapter(7, 'The Moon We Know',
    'Cooled, cratered, gray — the Moon that will one day slow, lock, and turn one face to Earth forever.',
    { az: 3.30, el: 0.16, dist: 440, ...lookAtFormation(3.30, 0.16, 440, 6 / 6), fov: 56 }, 1.00),
]);

export const FORMATION_META = Object.freeze({
  id: 'formation',
  title: 'Formation — how the Moon was born',
  chapters: FORMATION_CHAPTERS.length,
  seed: 11,
});

/* ------------------------------------------------------------------ */
/* Injected color script: white-hot early, cooling to gray.             */
/* ------------------------------------------------------------------ */

/**
 * PURE transform: derive the formation act's palette from the frozen
 * canonical COLOR_SCRIPT. Frame heat falls 1 → 0 across the seven chapters:
 * early frames push the ramp toward molten orange with a hot halo; late
 * frames settle to neutral gray bone.
 */
export function makeFormationColorScript(baseScript) {
  if (!Array.isArray(baseScript) || baseScript.length < 2)
    throw new Error('makeFormationColorScript: baseScript must be an array of ≥2 keyframes');
  const script = baseScript.length === FORMATION_CHAPTERS.length
    ? baseScript
    : resampleScript(baseScript, FORMATION_CHAPTERS.length);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const lerp = (a, b, f) => a + (b - a) * f;
  return script.map((k, i) => {
    const heat = 1 - i / (script.length - 1); // white-hot early, cool late
    const l = lum(k.rampCore);
    const bone = [l, l, l];
    const hot = [1.0, 0.42, 0.13];
    return {
      name: k.name,
      emissive: k.emissive.map((v) => v * (0.9 + 0.7 * heat)),
      rampCore: bone.map((b, j) => lerp(b, hot[j], heat * 0.85)),
      rampMid: k.rampMid.map((c, j) => lerp(c, hot[j] * 0.7, heat * 0.7)),
      rampEdge: k.rampEdge.slice(),
      fresnel: k.fresnel.slice(),
      haloTint: [lerp(0.72, 1.0, heat), lerp(0.80, 0.52, heat), lerp(0.94, 0.22, heat)],
      haloGain: k.haloGain * (0.8 + 0.7 * heat),
      exposure: k.exposure,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Seeded molten-earth bake (PURE pixels; only this fn touches canvas). */
/* ------------------------------------------------------------------ */

function bakeMoltenCanvases(table) {
  const w = 512, h = 256;
  const mapC = document.createElement('canvas'); mapC.width = w; mapC.height = h;
  const emiC = document.createElement('canvas'); emiC.width = w; emiC.height = h;
  const mapX = mapC.getContext('2d'), emiX = emiC.getContext('2d');
  const mapD = mapX.createImageData(w, h), emiD = emiX.createImageData(w, h);
  const sstep = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const n = (fbm(u * 7, v * 3.5, 4, table) + 1) / 2;
      const m = (fbm(u * 3 + 9.2, v * 2 + 4.7, 3, table) + 1) / 2;
      const crack = sstep(0.60, 0.80, n);
      const glow = sstep(0.55, 0.92, m) * 0.55;
      const heat = Math.min(1, crack + glow);
      const i = (y * w + x) * 4;
      // basalt map: near-black with faint variation
      const b = 14 + n * 22;
      mapD.data[i] = b; mapD.data[i + 1] = b * 0.82; mapD.data[i + 2] = b * 0.72; mapD.data[i + 3] = 255;
      // emissive cracks: deep red → orange → near-white at the hottest
      emiD.data[i] = Math.min(255, heat * 255);
      emiD.data[i + 1] = Math.min(255, heat * heat * 200);
      emiD.data[i + 2] = Math.min(255, heat * heat * heat * 120);
      emiD.data[i + 3] = 255;
    }
  }
  mapX.putImageData(mapD, 0, 0);
  emiX.putImageData(emiD, 0, 0);
  return { mapC, emiC };
}

function bakeMoonCanvas(table) {
  const w = 256, h = 128;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  const img = cx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const n = (fbm(u * 9, v * 4.5, 4, table) + 1) / 2;
      const maria = n < 0.42 ? 0.72 : 1.0; // dark blotches, the future maria
      const g = Math.round((118 + n * 60) * maria);
      const i = (y * w + x) * 4;
      img.data[i] = g; img.data[i + 1] = g; img.data[i + 2] = g + 4; img.data[i + 3] = 255;
    }
  }
  cx.putImageData(img, 0, 0);
  return cv;
}

function radialGlowCanvas() {
  const s = 128;
  const cv = document.createElement('canvas'); cv.width = s; cv.height = s;
  const cx = cv.getContext('2d');
  const g = cx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,240,1)');
  g.addColorStop(0.25, 'rgba(255,190,110,0.85)');
  g.addColorStop(0.6, 'rgba(255,110,40,0.28)');
  g.addColorStop(1, 'rgba(255,80,20,0)');
  cx.fillStyle = g;
  cx.fillRect(0, 0, s, s);
  return cv;
}

/* ------------------------------------------------------------------ */
/* clamp01 (decorate-side; the physics module has its own).             */
/* ------------------------------------------------------------------ */
const clamp01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;

/* ------------------------------------------------------------------ */
/* decorate: the scene content hook (runs once at host boot).          */
/* ------------------------------------------------------------------ */

export function decorateFormation({ moon, env, post, postm, camera, scene, renderer, THREE, seed, config }) {
  // Deep space: the valley stays home for this act; the engine moon is
  // hidden — the molten young Moon is a bespoke heat-driven mesh.
  env.group.visible = false;
  moon.group.visible = false;

  const F = FORMATION;
  const N = FORMATION_CHAPTERS.length;
  const table = makeNoiseTable(new Rng((seed ^ 0xF07A) >>> 0));

  /* --- Proto-Earth: molten, cracked, glowing. --- */
  const { mapC, emiC } = bakeMoltenCanvases(table);
  const earthMap = new THREE.CanvasTexture(mapC);
  earthMap.colorSpace = THREE.SRGBColorSpace;
  const earthEmi = new THREE.CanvasTexture(emiC);
  earthEmi.colorSpace = THREE.SRGBColorSpace;
  const earthMat = new THREE.MeshStandardMaterial({
    map: earthMap, emissiveMap: earthEmi,
    emissive: new THREE.Color(0xff6a22), emissiveIntensity: 1.6,
    roughness: 0.95, metalness: 0.0,
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(F.EARTH_R, 96, 64), earthMat);
  const earthGroup = new THREE.Group();
  earthGroup.add(earth);
  scene.add(earthGroup);

  /* --- Theia: a Mars-sized rocky wanderer. --- */
  const theiaMat = new THREE.MeshStandardMaterial({
    color: 0x8a6f5c, roughness: 1.0, metalness: 0.0,
    emissive: new THREE.Color(0xff5a1a), emissiveIntensity: 0.15,
  });
  const theia = new THREE.Mesh(new THREE.SphereGeometry(F.THEIA_R, 64, 48), theiaMat);
  scene.add(theia);

  /* --- Impact flash: sprite + light at the strike point. --- */
  const flashTex = new THREE.CanvasTexture(radialGlowCanvas());
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flashTex, color: 0xffffff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  flash.position.set(IMPACT_PT.x, IMPACT_PT.y, IMPACT_PT.z);
  flash.scale.setScalar(60);
  scene.add(flash);
  const flashLight = new THREE.PointLight(0xffa040, 0, 1600, 2);
  flashLight.position.copy(flash.position);
  scene.add(flashLight);

  /* --- Debris disk: seeded particle ring, radii driven per frame. --- */
  const DISK_N = 1600;
  const dAng = new Float32Array(DISK_N);
  const dRad = new Float32Array(DISK_N); // unit radius 0..1
  const dY = new Float32Array(DISK_N);
  const drng = new Rng((seed ^ 0xd15c) >>> 0);
  for (let i = 0; i < DISK_N; i++) {
    dAng[i] = drng.float() * Math.PI * 2;
    dRad[i] = Math.pow(drng.float(), 0.7); // denser inward
    dY[i] = (drng.float() - 0.5) * 26;
  }
  const diskPos = new Float32Array(DISK_N * 3);
  const diskGeo = new THREE.BufferGeometry();
  diskGeo.setAttribute('position', new THREE.BufferAttribute(diskPos, 3));
  const diskMat = new THREE.PointsMaterial({
    color: 0xff8c33, size: 2.4, sizeAttenuation: true,
    transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const disk = new THREE.Points(diskGeo, diskMat);
  disk.frustumCulled = false;
  scene.add(disk);
  const diskHot = new THREE.Color(1.0, 0.55, 0.20);
  const diskCool = new THREE.Color(0.42, 0.40, 0.38);

  /* --- The young Moon: a cooling world. --- */
  const moonTex = new THREE.CanvasTexture(bakeMoonCanvas(table));
  moonTex.colorSpace = THREE.SRGBColorSpace;
  const youngMoonMat = new THREE.MeshStandardMaterial({
    map: moonTex, roughness: 0.95, metalness: 0.0,
    emissive: new THREE.Color(0xff5a1a), emissiveIntensity: 2.0,
  });
  const youngMoon = new THREE.Mesh(new THREE.SphereGeometry(F.MOON_R, 96, 64), youngMoonMat);
  scene.add(youngMoon);

  /* --- Lights: a young, harsh sun. --- */
  const sun = new THREE.DirectionalLight(0xfff1dd, 2.4);
  sun.position.set(700, 350, 500);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x1c2636, 0.6));
  if (typeof moon.setSunDirection === 'function') {
    const sd = dirFromAzEl(0.7, 0.35);
    moon.setSunDirection(new THREE.Vector3(sd.x, sd.y, sd.z).normalize());
  }

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

  /* --- Per-frame formation staging, driven by the chapter clock. --- */
  const origSetChapter = moon.setChapter.bind(moon);
  moon.setChapter = (chapterT) => {
    origSetChapter(chapterT);
    const actT = clamp01(chapterT / (N - 1));
    const st = formationState(actT);

    // Theia falls in, heating as it nears — then it is gone.
    if (st.theia) {
      theia.visible = true;
      theia.position.set(st.theia.x, st.theia.y, st.theia.z);
      const u = clamp01(actT / F.T_IMPACT);
      theiaMat.emissiveIntensity = 0.15 + 1.3 * u * u;
      theia.rotation.y = actT * 6;
    } else {
      theia.visible = false;
    }

    // Earth turns beneath it all, glowing with the impact heat.
    earthGroup.rotation.y = actT * Math.PI * 0.8;
    earthMat.emissiveIntensity = 0.5 + 1.8 * st.heat;

    // Impact flash.
    flash.material.opacity = Math.min(1, st.impactPulse * 1.2);
    flash.scale.setScalar(60 + st.impactPulse * 300);
    flashLight.intensity = st.impactPulse * 30000;

    // Debris disk: radii breathe per frame; the ring swirls.
    const showDisk = st.diskDensity > 0.01;
    disk.visible = showDisk;
    if (showDisk) {
      const rot = actT * Math.PI * 2.5;
      const span = st.diskOuter - st.diskInner;
      for (let i = 0; i < DISK_N; i++) {
        const a = dAng[i] + rot * (1.15 - 0.5 * dRad[i]); // inner laps the outer
        const r = st.diskInner + dRad[i] * span;
        diskPos[i * 3] = Math.cos(a) * r;
        diskPos[i * 3 + 1] = dY[i] * (0.5 + 0.5 * st.diskDensity);
        diskPos[i * 3 + 2] = Math.sin(a) * r;
      }
      diskGeo.attributes.position.needsUpdate = true;
      diskMat.opacity = st.diskDensity * 0.85;
      diskMat.color.copy(diskCool).lerp(diskHot, clamp01(st.heat * 1.4));
    }

    // The young Moon gathers and cools.
    const mr = st.moonRadius;
    youngMoon.visible = mr > 0.05;
    if (youngMoon.visible) {
      youngMoon.position.set(st.moonX, 0, st.moonZ);
      youngMoon.scale.setScalar(Math.max(mr / F.MOON_R, 0.001));
      youngMoonMat.emissiveIntensity = st.heat * 2.4;
      youngMoon.rotation.y = actT * 20;
    }

    // Captions follow the chapter index.
    const idx = Math.min(N - 1, Math.max(0, Math.round(chapterT)));
    if (idx !== capIdx) {
      capIdx = idx;
      const ch = FORMATION_CHAPTERS[idx];
      capName.textContent = `${ch.id} · ${ch.name}`;
      capRole.textContent = ch.role;
      caption.style.opacity = '1';
    }

    // The score follows the same clock.
    audio.update(audioCueAt(actT));
  };
}

/** The registered scene config (engine/scene.js shape). */
export const FORMATION_SCENE = Object.freeze({
  id: 'formation',
  title: 'Formation — how the Moon was born',
  chapters: FORMATION_CHAPTERS,
  colorScript: null, // composed by the scene-index loader via makeFormationColorScript
  chapterCount: FORMATION_CHAPTERS.length, // 7
  simDuration: 168,                        // 7 chapters × 24
  chapterLocator: null, // → engine default: defaultChapterLocator
  scrollSpaceVh: 700,   // 7 chapters × 100vh
  decorate: decorateFormation,
});
