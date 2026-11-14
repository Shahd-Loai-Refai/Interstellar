import * as THREE from 'three';
import { fbm2, smoothstep } from './noise.js';
import { createSoilTexture } from './soilTexture.js';

/** Level area under and around the lander (metres). */
export const PAD_RADIUS = 6;
const PAD_BLEND = 8;
/** Terrain extends to just inside the camera's far plane; fog hides the edge. */
export const TERRAIN_RADIUS = 480;
const SOIL_TILE_M = 3; // soil detail texture repeats every 3 m

/**
 * Ground height at (x, z). Elysium Planitia is a very flat plain: gentle swells
 * of about ±1 m, small undulations, and low ridges far out on the horizon.
 * The lander pad is level at y = 0.
 */
export function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  let h =
    fbm2(x * 0.018 + 3.1, z * 0.018 + 7.7, 4) * 2.4 + // broad swells
    fbm2(x * 0.12 + 11.3, z * 0.12 + 2.9, 3) * 0.22; // small undulations

  const far = smoothstep(90, 260, r);
  if (far > 0) h += far * (fbm2(x * 0.008 + 20.5, z * 0.008 + 4.2, 3) + 0.5) * 22;

  return h * smoothstep(PAD_RADIUS, PAD_RADIUS + PAD_BLEND, r);
}

/**
 * Builds a radial terrain mesh: vertex rings get sparser with distance, so detail is
 * concentrated where the player stands (~60k triangles in total, VR-friendly).
 */
export function createTerrain({ anisotropy = 8 } = {}) {
  const RINGS = 160;
  const SEGS = 192;

  const vertexCount = 1 + RINGS * SEGS;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Float32Array(vertexCount * 3);

  const rust = new THREE.Color(0x96492a);
  const ochre = new THREE.Color(0xbd7546);
  const dust = new THREE.Color(0xcf9a6c);
  const scoured = new THREE.Color(0x6a3f2c); // darker soil exposed by the landing thrusters
  const c = new THREE.Color();

  const writeVertex = (i, x, z) => {
    const y = terrainHeight(x, z);
    positions.set([x, y, z], i * 3);
    uvs.set([x / SOIL_TILE_M, z / SOIL_TILE_M], i * 2);

    // Large-scale soil colour variation.
    const t1 = THREE.MathUtils.clamp(fbm2(x * 0.03 + 50, z * 0.03 + 9, 3) + 0.5, 0, 1);
    c.lerpColors(rust, ochre, t1);
    // Bright patches of fine, wind-deposited dust.
    const t2 = smoothstep(0.05, 0.3, fbm2(x * 0.07 + 31, z * 0.07 - 12, 3));
    c.lerp(dust, t2 * 0.55);
    // Slightly darker in low spots, lighter on rises.
    c.multiplyScalar(1 + THREE.MathUtils.clamp(y * 0.08, -0.12, 0.08));
    // Retro-rocket scour marks around the lander.
    const r = Math.hypot(x, z);
    if (r < 5) {
      const scour = (1 - smoothstep(1.5, 5, r)) * smoothstep(-0.15, 0.2, fbm2(x * 0.9, z * 0.9, 2, 5));
      c.lerp(scoured, scour * 0.7);
    }
    colors.set([c.r, c.g, c.b], i * 3);
  };

  writeVertex(0, 0, 0);
  for (let ring = 1; ring <= RINGS; ring++) {
    const r = TERRAIN_RADIUS * (ring / RINGS) ** 2;
    for (let s = 0; s < SEGS; s++) {
      const a = (s / SEGS) * Math.PI * 2;
      writeVertex(1 + (ring - 1) * SEGS + s, Math.cos(a) * r, Math.sin(a) * r);
    }
  }

  // Triangles wound counter-clockwise when viewed from above (normals point up).
  const indices = [];
  const idx = (ring, s) => 1 + (ring - 1) * SEGS + (s % SEGS);
  for (let s = 0; s < SEGS; s++) indices.push(0, idx(1, s + 1), idx(1, s));
  for (let ring = 2; ring <= RINGS; ring++) {
    for (let s = 0; s < SEGS; s++) {
      const a = idx(ring - 1, s);
      const b = idx(ring - 1, s + 1);
      const cIdx = idx(ring, s);
      const d = idx(ring, s + 1);
      indices.push(a, b, cIdx, b, d, cIdx);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const soil = createSoilTexture();
  soil.anisotropy = anisotropy;

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: soil,
      bumpMap: soil,
      bumpScale: 1.2,
      roughness: 1,
      metalness: 0,
    })
  );
  mesh.name = 'Terrain';
  mesh.receiveShadow = true;
  return mesh;
}
