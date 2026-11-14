import * as THREE from 'three';

const Y = new THREE.Vector3(0, 1, 0);
// Wrist position in hand space (fingertip at the origin, fingers along +Z).
const WRIST = new THREE.Vector3(0.028, 0, -0.235);

/**
 * First-person spacesuit-style hand: a white glove (real size, ~19 cm wrist to fingertip)
 * with a metal wrist ring, plus a white sleeve that stretches from the wrist back to a
 * "shoulder" point so the hand reads as connected to the user's body.
 *
 * `group` is the hand (origin = index fingertip, fingers along +Z, back of hand +Y).
 * `sleeve` is a separate mesh; add both to the same parent and call updateSleeve().
 */
export function createHand() {
  const glove = new THREE.MeshStandardMaterial({ color: 0xf4f4f1, roughness: 0.7, metalness: 0, transparent: true });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xb9bcc2, roughness: 0.35, metalness: 0.8, transparent: true });
  const sleeveMat = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.85, metalness: 0, transparent: true });
  const inner = new THREE.Group();

  const capsule = (a, b, r) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, dir.length()), 4, 10), glove);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(Y, dir.normalize());
    inner.add(mesh);
  };
  const v = (x, y, z) => new THREE.Vector3(x, y, z);

  // Palm: a softly rounded slab (glove-thick). Wrist at z = -0.10, knuckles at z = 0.
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), glove);
  palm.scale.set(0.047, 0.019, 0.057);
  palm.position.set(0, 0, -0.05);
  inner.add(palm);

  // Index finger extended (≈ 8.5 cm); others curled under; thumb tucked.
  capsule(v(-0.028, 0, 0), v(-0.028, -0.002, 0.085), 0.0105);
  [
    [-0.008, 0.0105],
    [0.012, 0.01],
    [0.03, 0.009],
  ].forEach(([x, r]) => {
    capsule(v(x, 0, -0.005), v(x, -0.022, 0.022), r);
    capsule(v(x, -0.022, 0.022), v(x, -0.032, -0.008), r * 0.95);
  });
  capsule(v(-0.042, -0.004, -0.07), v(-0.052, -0.012, -0.025), 0.012);
  capsule(v(-0.052, -0.012, -0.025), v(-0.022, -0.026, -0.004), 0.011);

  // Glove gauntlet and the metal wrist-disconnect ring.
  const gauntlet = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.048, 0.06, 24), glove);
  gauntlet.rotation.x = Math.PI / 2;
  gauntlet.position.set(0, -0.002, -0.115);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.009, 10, 32), ringMat);
  ring.position.set(0, -0.002, -0.142);
  inner.add(gauntlet, ring);

  // Index fingertip at the origin.
  inner.position.set(0.028, 0.002, -0.0945);
  const group = new THREE.Group();
  group.name = 'Hand';
  group.add(inner);

  // Sleeve: unit-height cylinder along +Y from its base, stretched each frame.
  const sleeveGeo = new THREE.CylinderGeometry(0.052, 0.062, 1, 24, 1);
  sleeveGeo.translate(0, 0.5, 0);
  const sleeve = new THREE.Mesh(sleeveGeo, sleeveMat);
  sleeve.name = 'Sleeve';

  for (const o of [group, sleeve]) o.traverse((m) => m.isMesh && (m.castShadow = true));

  const m = new THREE.Matrix4();
  const wrist = new THREE.Vector3();
  const dir = new THREE.Vector3();
  return {
    group,
    sleeve,
    /** Point the index finger from `from` towards `to` (both in the parent's space). */
    aim(from, to) {
      if (from.distanceToSquared(to) < 1e-8) return;
      m.lookAt(to, from, Y); // object convention: +Z faces the target
      group.quaternion.setFromRotationMatrix(m);
    },
    /** Stretch the sleeve from the wrist to `shoulder` (parent space). */
    updateSleeve(shoulder) {
      wrist.copy(WRIST).applyQuaternion(group.quaternion).add(group.position);
      dir.subVectors(shoulder, wrist);
      sleeve.position.copy(wrist);
      sleeve.scale.set(1, Math.max(0.01, dir.length()), 1);
      sleeve.quaternion.setFromUnitVectors(Y, dir.normalize());
    },
    set opacity(o) {
      glove.opacity = ringMat.opacity = sleeveMat.opacity = o;
      group.visible = sleeve.visible = o > 0.001;
    },
  };
}
