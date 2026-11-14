import * as THREE from 'three';
import { mulberry32 } from './noise.js';

/**
 * Procedural, seamlessly tiling soil detail texture (grayscale, slightly warm).
 * Used as both the albedo detail map (multiplied with the terrain's vertex colours)
 * and the bump map, so the ground reads as fine grained regolith up close.
 */
export function createSoilTexture(size = 512) {
  const rand = mulberry32(20181126); // InSight landing date

  // Tileable value noise: each octave is a random lattice whose period divides the texture.
  const octaves = [
    { period: 4, amp: 1.0 },
    { period: 8, amp: 0.7 },
    { period: 16, amp: 0.5 },
    { period: 32, amp: 0.35 },
    { period: 64, amp: 0.25 },
    { period: 128, amp: 0.18 },
  ].map((o) => {
    const lattice = new Float32Array(o.period * o.period);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
    return { ...o, lattice };
  });
  const ampSum = octaves.reduce((s, o) => s + o.amp, 0);

  const sample = ({ period, lattice }, u, v) => {
    const x = u * period;
    const y = v * period;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let fx = x - ix;
    let fy = y - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const x0 = ix % period;
    const y0 = iy % period;
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;
    const a = lattice[y0 * period + x0];
    const b = lattice[y0 * period + x1];
    const c = lattice[y1 * period + x0];
    const d = lattice[y1 * period + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };

  const lum = new Float32Array(size * size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / size;
      const v = py / size;
      let n = 0;
      for (const o of octaves) n += o.amp * sample(o, u, v);
      n /= ampSum;
      const grain = rand() - 0.5;
      lum[py * size + px] = 0.78 + (n - 0.5) * 0.45 + grain * 0.1;
    }
  }

  // Small pebbles and clods: soft dark/light specks, wrapped at the edges.
  for (let i = 0; i < 900; i++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const r = 0.8 + rand() * 2.6;
    const delta = rand() < 0.7 ? -(0.15 + rand() * 0.2) : 0.1 + rand() * 0.1;
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d > 1) continue;
        const x = (Math.floor(cx + dx) + size) % size;
        const y = (Math.floor(cy + dy) + size) % size;
        lum[y * size + x] += delta * (1 - d * d);
      }
    }
  }

  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < lum.length; i++) {
    const l = Math.min(1, Math.max(0, lum[i]));
    data[i * 4] = l * 255;
    data[i * 4 + 1] = l * 0.97 * 255;
    data[i * 4 + 2] = l * 0.93 * 255;
    data[i * 4 + 3] = 255;
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
