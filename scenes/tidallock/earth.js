/* scenes/tidallock/earth.js — seeded procedural Earth for the tidal-lock scene.
 *
 * The engine bakes the Moon on the CPU from seeded streams; Earth gets the
 * same treatment so the whole scene is deterministic: same seed, same planet.
 * The noise field is PURE (no canvas, no THREE) and node-testable; only
 * bakeEarthCanvas touches the DOM.
 *
 * Layering (equirectangular, u ∈ [0,1) wraps seamlessly):
 *   deep ocean → shallow shelf → continents (fbm) → latitude biomes
 *   (ice caps, temperate green, arid belt) → streaky cloud wisps.
 */

import { Rng } from '../../engine/seed.js';

/** 512-entry permutation table from a seeded Rng — the single noise source. */
export function makeNoiseTable(rng) {
  const p = new Uint8Array(512);
  const tmp = new Uint8Array(256);
  for (let i = 0; i < 256; i++) tmp[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng.float() * (i + 1));
    const t = tmp[i]; tmp[i] = tmp[j]; tmp[j] = t;
  }
  for (let i = 0; i < 512; i++) p[i] = tmp[i & 255];
  return p;
}

function fade(t) { return t * t * (3 - 2 * t); }
function grad(h, x, y) {
  // 8 gradient directions from the hash
  switch (h & 7) {
    case 0: return x + y; case 1: return x - y;
    case 2: return -x + y; case 3: return -x - y;
    case 4: return x; case 5: return -x;
    case 6: return y; default: return -y;
  }
}

/** Seeded 2D gradient noise, output ≈ [-1, 1]. PURE. */
export function noise2(x, y, table) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x), yf = y - Math.floor(y);
  const u = fade(xf), v = fade(yf);
  const aa = table[(table[X] + Y) & 255], ab = table[(table[X] + Y + 1) & 255];
  const ba = table[(table[X + 1] + Y) & 255], bb = table[(table[X + 1] + Y + 1) & 255];
  const x1 = grad(aa, xf, yf) + (grad(ba, xf - 1, yf) - grad(aa, xf, yf)) * u;
  const x2 = grad(ab, xf, yf - 1) + (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1)) * u;
  return (x1 + (x2 - x1) * v) * 0.7071;
}

/** Fractal Brownian motion over noise2. PURE. */
export function fbm(x, y, octaves, table) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2(x * freq, y * freq, table);
    norm += amp;
    amp *= 0.5; freq *= 2.03;
  }
  return sum / norm; // ≈ [-1, 1]
}

function sstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function mix3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// Palette (linear-ish 0..1): picked for a cinematic "blue marble at night" read.
const DEEP_OCEAN = [0.023, 0.10, 0.30];
const SHALLOW = [0.05, 0.28, 0.52];
const LAND_LOW = [0.10, 0.30, 0.13];
const LAND_HIGH = [0.32, 0.30, 0.20];
const ARID = [0.55, 0.44, 0.26];
const ICE = [0.82, 0.87, 0.92];
const CLOUD = [0.95, 0.96, 0.98];

/**
 * Albedo at equirect (u, v) ∈ [0,1]². PURE in (u, v, table).
 * Longitude wraps seamlessly (noise sampled on a circle in u).
 */
export function earthAlbedoAt(u, v, table) {
  const ang = u * Math.PI * 2;
  const cu = Math.cos(ang), su = Math.sin(ang);
  const lat = Math.abs(v - 0.5) * 2; // 0 equator → 1 pole
  // Continent field: ridged fbm, seamless in u.
  const c = fbm(cu * 1.8 + 11.7, su * 1.8 + v * 3.6 - 3.1, 5, table);
  const landMask = sstep(0.02, 0.14, c);
  const coast = sstep(-0.06, 0.02, c);
  // Ocean with shallow shelves near coasts.
  let col = mix3(DEEP_OCEAN, SHALLOW, coast * 0.8);
  // Land relief shading from a second fbm.
  const relief = fbm(cu * 3.4 + 4.2, su * 3.4 + v * 6.8 + 9.4, 4, table);
  let land = mix3(LAND_LOW, LAND_HIGH, sstep(-0.4, 0.7, relief));
  // Arid belt around the subtropics, broken up by noise.
  const aridBand = sstep(0.55, 0.25, Math.abs(lat - 0.38)) * sstep(0.1, 0.5, relief + 0.35);
  land = mix3(land, ARID, Math.min(1, aridBand));
  col = mix3(col, land, landMask);
  // Ice caps.
  const ice = sstep(0.78, 0.88, lat + 0.08 * relief);
  col = mix3(col, ICE, ice);
  // Cloud wisps: stretched in u (zonal streaks), thin in v.
  const cl = fbm(cu * 2.6 + 31.7, su * 2.6 + v * 9.0 + 17.3, 4, table);
  const clouds = sstep(0.18, 0.55, cl) * 0.38;
  col = mix3(col, CLOUD, clouds);
  return col;
}

/**
 * Bake the Earth albedo to a canvas (DOM). Deterministic for a given table.
 * Default 768×384 keeps the boot bake comfortably inside budget.
 */
export function bakeEarthCanvas(table, w = 768, h = 384) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const [r, g, b] = earthAlbedoAt(u, v, table);
      const i = (y * w + x) * 4;
      d[i] = Math.round(r * 255);
      d[i + 1] = Math.round(g * 255);
      d[i + 2] = Math.round(b * 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
