import * as THREE from 'three';

const JOINT_NAMES = ['arm_01', 'arm_02', 'arm_03', 'grapple']; // shoulder yaw, shoulder pitch, elbow, wrist
const CLAW_NAMES = ['claw_01', 'claw_02', 'claw_03', 'claw_04', 'claw_05'];
const Y = new THREE.Vector3(0, 1, 0);
const DEG = Math.PI / 180;

/**
 * NASA's "arm deployed" InSight model is the same rig as ours with these joint angles
 * (rotation about each joint's local +Y, relative to the stowed pose in insight.glb).
 */
export const READY_POSE = [-70 * DEG, -110 * DEG, 90 * DEG, -113 * DEG];
export const STOWED_POSE = [0, 0, 0, 0];

/**
 * Drives the robotic arm of NASA's InSight model. Every joint is a hinge about its
 * local Y axis; poses are solved with cyclic-coordinate-descent IK.
 */
export class Arm {
  constructor(model) {
    this.joints = JOINT_NAMES.map((name) => {
      const node = model.getObjectByName(name);
      if (!node) throw new Error(`InSight model has no "${name}" node`);
      return { node, rest: node.quaternion.clone() };
    });
    this.angles = [0, 0, 0, 0];
    this.grapple = this.joints[3].node;
    this.shovel = model.getObjectByName('shovel');

    // Grip point: centre of the grapple's claws, in grapple space.
    const claws = CLAW_NAMES.map((n) => model.getObjectByName(n)).filter(Boolean);
    const grip = new THREE.Vector3();
    claws.forEach((c) => grip.add(c.position));
    if (claws.length) grip.divideScalar(claws.length);
    this.grip = { node: this.grapple, local: grip };

    // Scoop point: centre of the shovel blade, in shovel space.
    const shovelBox = localBox(this.shovel);
    this.scoop = { node: this.shovel, local: shovelBox.getCenter(new THREE.Vector3()) };

    this._q = new THREE.Quaternion();
    this.apply(this.angles);
  }

  apply(angles) {
    this.joints.forEach((j, i) => {
      j.node.quaternion.copy(j.rest).multiply(this._q.setFromAxisAngle(Y, angles[i]));
    });
    this.angles = angles.slice();
    this.joints[0].node.updateWorldMatrix(true, true);
  }

  /** World position of an effector ({ node, local }). */
  effectorWorld(effector, out = new THREE.Vector3()) {
    return effector.node.localToWorld(out.copy(effector.local));
  }

  /**
   * Joint angles that bring `effector` to `target` (world), starting from `seed`.
   * Uses the first `jointCount` joints. Leaves the arm's current pose unchanged.
   */
  solve(target, effector, { seed = this.angles, jointCount = 3, iterations = 80 } = {}) {
    const saved = this.angles;
    const a = seed.slice();
    this.apply(a);

    const P = new THREE.Vector3();
    const E = new THREE.Vector3();
    const axis = new THREE.Vector3();
    const e = new THREE.Vector3();
    const t = new THREE.Vector3();
    const Q = new THREE.Quaternion();
    const cross = new THREE.Vector3();

    let error = Infinity;
    for (let it = 0; it < iterations; it++) {
      for (let i = jointCount - 1; i >= 0; i--) {
        const node = this.joints[i].node;
        node.getWorldPosition(P);
        axis.copy(Y).applyQuaternion(node.getWorldQuaternion(Q)).normalize();
        this.effectorWorld(effector, E);
        e.subVectors(E, P);
        t.subVectors(target, P);
        e.addScaledVector(axis, -e.dot(axis));
        t.addScaledVector(axis, -t.dot(axis));
        if (e.lengthSq() < 1e-10 || t.lengthSq() < 1e-10) continue;
        const delta = Math.atan2(axis.dot(cross.crossVectors(e, t)), e.dot(t));
        a[i] += delta;
        this.apply(a);
      }
      error = this.effectorWorld(effector, E).distanceTo(target);
      if (error < 0.002) break;
    }

    const result = a.slice();
    this.apply(saved);
    return { angles: result, error };
  }

  /**
   * Pose with the grapple's grip at `target` and the grapple hanging above it,
   * as when picking up or setting down an instrument.
   */
  solveGrip(target, { seed = this.angles } = {}) {
    const saved = this.angles;
    this.apply(seed);
    const wrist = this.grapple.getWorldPosition(new THREE.Vector3());
    const reach = this.effectorWorld(this.grip).distanceTo(wrist);

    // 1) Put the wrist directly above the target.
    const wristTarget = target.clone().add(new THREE.Vector3(0, reach, 0));
    const { angles } = this.solve(wristTarget, { node: this.grapple, local: new THREE.Vector3() }, { seed });

    // 2) Swing the wrist so the grip reaches down to the target.
    const tmp = new THREE.Vector3();
    const errorAt = (theta) => {
      angles[3] = theta;
      this.apply(angles);
      return this.effectorWorld(this.grip, tmp).distanceTo(target);
    };
    let best = seed[3];
    let bestErr = Infinity;
    for (let d = -180; d < 180; d += 2) {
      const th = d * DEG;
      const err = errorAt(th);
      if (err < bestErr) [best, bestErr] = [th, err];
    }
    for (let d = -2; d <= 2; d += 0.1) {
      const th = best + d * DEG;
      const err = errorAt(th);
      if (err < bestErr) [best, bestErr] = [th, err];
    }
    // Keep the wrist angle close to the seed (avoid needless full turns).
    angles[3] = seed[3] + Math.atan2(Math.sin(best - seed[3]), Math.cos(best - seed[3]));

    // 3) Fine-tune with all four joints (small corrections only).
    const refined = this.solve(target, this.grip, { seed: angles, jointCount: 4, iterations: 40 });

    this.apply(saved);
    return refined;
  }

  /**
   * Pose with the scoop at `target`. The wrist is turned so the grapple stays as high
   * as possible, clear of the ground.
   */
  solveScoop(target, { seed = this.angles } = {}) {
    const saved = this.angles;
    const { angles, error } = this.solve(target, this.scoop, { seed });
    const box = new THREE.Box3();
    let best = angles[3];
    let bestLow = -Infinity;
    for (let d = -180; d < 180; d += 3) {
      angles[3] = d * DEG;
      this.apply(angles);
      const low = box.setFromObject(this.grapple).min.y;
      if (low > bestLow + 1e-4) [best, bestLow] = [angles[3], low];
    }
    angles[3] = seed[3] + Math.atan2(Math.sin(best - seed[3]), Math.cos(best - seed[3]));
    this.apply(saved);
    return { angles, error };
  }

  /** Tween joint angles to `target` over `duration` seconds. */
  moveTo(animator, target, duration) {
    const from = this.angles.slice();
    const to = Array.isArray(target) ? target : target.angles;
    const a = from.slice();
    return animator.tween(duration, (k) => {
      for (let i = 0; i < a.length; i++) a[i] = from[i] + (to[i] - from[i]) * k;
      this.apply(a);
    });
  }
}

/** Bounding box of an object's own geometry (its mesh, or its direct mesh children) in its local space. */
function localBox(node) {
  const box = new THREE.Box3();
  const meshes = node.isMesh ? [node] : node.children.filter((c) => c.isMesh);
  for (const m of meshes) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox.clone();
    if (m !== node) b.applyMatrix4(m.matrix);
    box.union(b);
  }
  return box;
}
