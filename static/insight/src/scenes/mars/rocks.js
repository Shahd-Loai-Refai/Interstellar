import * as THREE from 'three';
import { mulberry32, noise3 } from './noise.js';
import { terrainHeight } from './terrain.js';

/** Irregular rock: a noise-displaced icosahedron with a flattened base. Faceted (non-indexed) normals. */
function makeRockGeometry(detail, seed, flatten) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n1 = noise3(v.x * 1.2 + seed, v.y * 1.2 + seed * 1.7, v.z * 1.2 - seed);
    const n2 = noise3(v.x * 3.1 - seed, v.y * 3.1 + seed, v.z * 3.1 + seed * 0.3);
    v.multiplyScalar(1 + 0.5 * n1 + 0.18 * n2);
    v.y *= flatten;
    if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.25; // flattened underside sits in the soil
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Scatters rocks in three size classes using instancing (9 draw calls total).
 * @param {(x: number, z: number, size: number) => boolean} isClear  keep-out test (lander, seismometer)
 */
export function createRocks(isClear) {
  const group = new THREE.Group();
  group.name = 'Rocks';
  const rand = mulberry32(4242);

  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });

  const classes = [
    // Pebbles: many, small, close by; no shadow casting (too small to matter, saves fill-rate).
    { count: 2200, minR: 1.5, maxR: 40, min: 0.02, max: 0.08, pow: 2, detail: 0, castShadow: false },
    // Stones.
    { count: 600, minR: 2.5, maxR: 90, min: 0.08, max: 0.35, pow: 2.5, detail: 1, castShadow: true },
    // Occasional boulders, further out.
    { count: 28, minR: 18, maxR: 160, min: 0.5, max: 1.6, pow: 1.5, detail: 2, castShadow: true },
  ];

  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const col = new THREE.Color();

  classes.forEach((cls, ci) => {
    const variants = [0, 1, 2].map((k) =>
      makeRockGeometry(cls.detail, ci * 10 + k * 3.7 + 1.3, 0.55 + rand() * 0.3)
    );
    const perVariant = Math.ceil(cls.count / variants.length);

    for (const geo of variants) {
      const mesh = new THREE.InstancedMesh(geo, material, perVariant);
      mesh.castShadow = cls.castShadow;
      mesh.receiveShadow = true;

      let placed = 0;
      let attempts = 0;
      while (placed < perVariant && attempts < perVariant * 10) {
        attempts++;
        const r = Math.sqrt(rand() * (cls.maxR ** 2 - cls.minR ** 2) + cls.minR ** 2);
        const a = rand() * Math.PI * 2;
        p.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        const size = cls.min + (cls.max - cls.min) * rand() ** cls.pow;
        if (!isClear(p.x, p.z, size)) continue;

        s.set(size * (0.8 + rand() * 0.45), size * (0.6 + rand() * 0.35), size * (0.8 + rand() * 0.45));
        p.y = terrainHeight(p.x, p.z) - s.y * 0.15;
        e.set((rand() - 0.5) * 0.35, rand() * Math.PI * 2, (rand() - 0.5) * 0.35);
        q.setFromEuler(e);
        m.compose(p, q, s);
        mesh.setMatrixAt(placed, m);
        // Dark basaltic rock with a dusty reddish tint; a few lighter ones.
        const light = rand() < 0.12 ? 0.1 : 0;
        mesh.setColorAt(placed, col.setHSL(0.035 + rand() * 0.035, 0.22 + rand() * 0.22, 0.13 + rand() * 0.1 + light));
        placed++;
      }
      mesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  });

  return group;
}
