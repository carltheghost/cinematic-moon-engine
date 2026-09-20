/**
 * Phase 2 bloom bake-off fixture (harness-only).
 *
 * Locked canonical hero frame for the blind bloom A/B:
 * - Ch4 vermilion moon, low in frame, 28–30% viewport height (the real hero).
 * - Haze band crossing the lower limb (a real translucent plane, not a sprite).
 * - Three lantern proxies mid-ground, each ≤1.05 pre-tonemap (so they stay
 *   under the bloom threshold of 1.0 + smoothing — they must NOT bloom).
 *
 * The fixture is injected by the harness via page.evaluate; it is NOT part of
 * the shipped page. All geometry is deterministic (seeded).
 *
 * Usage (in-page):
 *   const fixture = await import('./fixture-bakeoff.js');
 *   const handle = fixture.installBakeoffFixture(window.__cme, 7);
 *   // ... render A (bloom on) and B (bloom off) ...
 *   handle.dispose();
 */
import * as THREE from 'three';

function makeHazeTexture() {
  const W = 256, H = 64;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // Vertical gradient: dense at bottom, fading to transparent at top.
      // Horizontal: slight variation for texture (deterministic sine).
      const v = y / (H - 1); // 0 at top, 1 at bottom
      const density = Math.pow(v, 1.5) * (0.85 + 0.15 * Math.sin(x * 0.11) * Math.sin(x * 0.031 + 1.7));
      // Warm gray haze color (slightly warm to catch the moon's vermilion).
      data[i] = 148;
      data[i + 1] = 118;
      data[i + 2] = 102;
      data[i + 3] = Math.max(0, Math.min(255, Math.round(density * 255)));
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

function makeLanternTexture() {
  // Small warm disc with soft falloff, for the lantern proxies.
  const S = 64;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const dx = (x + 0.5) / S - 0.5;
      const dy = (y + 0.5) / S - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const a = Math.max(0, 1 - r);
      const falloff = a * a;
      // Warm amber lantern color.
      data[i] = 255;
      data[i + 1] = 190;
      data[i + 2] = 120;
      data[i + 3] = Math.round(falloff * 255);
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Install the bake-off fixture into a booted __cme instance.
 * @param {object} cme — window.__cme
 * @param {number} seed — deterministic seed (currently unused; geometry is fixed)
 * @returns {{ dispose(): void, lanterns: THREE.Sprite[], haze: THREE.Mesh }}
 */
export function installBakeoffFixture(cme, seed = 7) {
  const { scene, camera, moon } = cme;
  const group = new THREE.Group();
  group.userData.bakeoffFixture = true;

  // --- Haze band crossing the lower limb ---
  // Positioned between camera and moon, spanning the lower third of the disc.
  const moonPos = new THREE.Vector3();
  moon.sphere.getWorldPosition(moonPos);
  const moonDir = moonPos.clone().normalize();
  const dist = camera.position.distanceTo(moonPos);

  // Haze plane: perpendicular to view direction, at 60% of moon distance.
  const hazeDist = dist * 0.6;
  const hazePos = moonDir.clone().multiplyScalar(hazeDist);
  // Lower limb: offset downward in world Y by ~0.35 moon radii.
  const moonR = 151; // matches hero
  hazePos.y -= moonR * 0.55;

  const hazeTex = makeHazeTexture();
  const hazeMat = new THREE.MeshBasicMaterial({
    map: hazeTex,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    opacity: 0.55,
  });
  // Plane sized to cover ~3 moon diameters wide, 0.8 diameters tall.
  const hazeGeo = new THREE.PlaneGeometry(moonR * 6, moonR * 1.6);
  const haze = new THREE.Mesh(hazeGeo, hazeMat);
  haze.position.copy(hazePos);
  // Face the camera.
  haze.lookAt(camera.position);
  haze.renderOrder = 5;
  group.add(haze);

  // --- Three lantern proxies (mid-ground, ≤1.05 pre-tonemap) ---
  const lanternTex = makeLanternTexture();
  const lanterns = [];
  // Positions: mid-ground, below the moon, spread horizontally.
  // At 35% of moon distance, so they're clearly in front of the haze.
  const lantDist = dist * 0.35;
  const offsets = [
    { x: -moonR * 1.8, y: -moonR * 1.2 },
    { x: 0, y: -moonR * 1.5 },
    { x: moonR * 1.8, y: -moonR * 1.1 },
  ];
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.SpriteMaterial({
      map: lanternTex,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      // Pre-tonemap luminance ≤1.05: color values are ≤1.0, opacity modulates.
      // SpriteMaterial color multiplies the texture. Keep at 1.0 max.
      color: new THREE.Color(1.0, 1.0, 1.0),
      opacity: 0.95,
    });
    const spr = new THREE.Sprite(mat);
    // Scale: small (about 0.15 moon radii).
    const s = moonR * 0.3;
    spr.scale.set(s, s, 1);
    // Position: along moon direction, offset in camera-right and camera-up.
    const right = new THREE.Vector3().crossVectors(moonDir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, moonDir).normalize();
    const pos = moonDir.clone().multiplyScalar(lantDist)
      .addScaledVector(right, offsets[i].x)
      .addScaledVector(up, offsets[i].y);
    spr.position.copy(pos);
    spr.renderOrder = 6;
    group.add(spr);
    lanterns.push(spr);
  }

  scene.add(group);

  return {
    haze,
    lanterns,
    dispose() {
      scene.remove(group);
      hazeGeo.dispose();
      hazeMat.dispose();
      hazeTex.dispose();
      lanternTex.dispose();
      for (const l of lanterns) {
        l.material.dispose();
      }
    },
  };
}
