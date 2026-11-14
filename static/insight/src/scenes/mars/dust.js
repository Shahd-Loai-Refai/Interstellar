import * as THREE from 'three';
import { mulberry32 } from './noise.js';

/** Soft round sprite for the particles (generated, no image file). */
function makeSpriteTexture(size = 32) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const a = Math.max(0, 1 - d) ** 2 * 255;
      data.set([a, a, a, 255], (y * size + x) * 4);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/**
 * A light drift of airborne dust around the player. Particles wrap around a box that
 * follows the player, so a small fixed count is enough (cheap for VR).
 */
export function createDust({ count = 350, extent = 24, height = 4, wind = new THREE.Vector3(0.55, 0, 0.2) } = {}) {
  const rand = mulberry32(77);
  const positions = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions.set([(rand() - 0.5) * extent, rand() * height, (rand() - 0.5) * extent], i * 3);
    phase[i] = rand() * Math.PI * 2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: 0xe6c29a,
      size: 0.025,
      sizeAttenuation: true,
      alphaMap: makeSpriteTexture(),
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    })
  );
  points.name = 'Dust';
  points.frustumCulled = false;

  const half = extent / 2;
  let time = 0;

  points.userData.update = (dt, center) => {
    time += dt;
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      let x = positions[k] + wind.x * dt;
      let y = positions[k + 1] + Math.sin(time * 0.7 + phase[i]) * 0.05 * dt;
      let z = positions[k + 2] + wind.z * dt;
      // Wrap inside a box centred on the player.
      if (x - center.x > half) x -= extent;
      else if (x - center.x < -half) x += extent;
      if (z - center.z > half) z -= extent;
      else if (z - center.z < -half) z += extent;
      if (y > height) y -= height;
      else if (y < 0) y += height;
      positions[k] = x;
      positions[k + 1] = y;
      positions[k + 2] = z;
    }
    geo.attributes.position.needsUpdate = true;
  };

  return points;
}
