import * as THREE from 'three';

/** A quiet starfield with a distant Mars, shown behind the Start screen. */
export function createStartScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05030a);

  const count = 2000;
  const positions = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.randomDirection().multiplyScalar(200 + Math.random() * 100);
    positions.set([v.x, v.y, v.z], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const stars = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false })
  );
  scene.add(stars);

  const mars = new THREE.Mesh(
    new THREE.SphereGeometry(6, 48, 32),
    new THREE.MeshStandardMaterial({ color: 0xc1440e, roughness: 1 })
  );
  mars.position.set(0, 1.6, -40);
  scene.add(mars);

  const light = new THREE.DirectionalLight(0xffffff, 2.5);
  light.position.set(-30, 10, 10);
  scene.add(light, new THREE.AmbientLight(0xffffff, 0.08));

  return {
    scene,
    update(dt) {
      stars.rotation.y += dt * 0.005;
      mars.rotation.y += dt * 0.05;
    },
  };
}
