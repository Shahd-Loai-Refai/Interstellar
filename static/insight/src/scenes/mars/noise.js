import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

const perlin = new ImprovedNoise(); // fixed permutation, so the world is identical on every load

/** Raw 3D Perlin noise, roughly in [-1, 1]. */
export function noise3(x, y, z) {
  return perlin.noise(x, y, z);
}

/** Fractal Brownian motion over 2D Perlin noise. Returns roughly [-0.5, 0.5]. */
export function fbm2(x, z, octaves = 4, seed = 0) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlin.noise(x * freq, z * freq, seed + i * 17.13);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** Small seeded PRNG (mulberry32) returning floats in [0, 1). */
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
