import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

/**
 * Mouse-look (pointer lock) + WASD movement for desktop.
 * Rotation is applied to the camera; movement is applied to the player rig,
 * so the same rig works for VR (where the headset drives the camera).
 */
export class DesktopControls {
  constructor(camera, rig, domElement, { walkSpeed = 2.5, runSpeed = 6, bounds = 60 } = {}) {
    this.camera = camera;
    this.rig = rig;
    this.walkSpeed = walkSpeed;
    this.runSpeed = runSpeed;
    this.bounds = bounds;
    this.enabled = false;
    /** Return false to stop a click from capturing the mouse (e.g. it hit a button). */
    this.shouldLock = () => true;

    this.look = new PointerLockControls(camera, domElement);
    this.keys = new Set();

    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._move = new THREE.Vector3();

    domElement.addEventListener('click', () => {
      if (this.enabled && !this.look.isLocked && this.shouldLock()) this.look.lock();
    });

    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  lock() {
    this.look.lock();
  }

  update(dt) {
    if (!this.enabled) return;

    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    if (f === 0 && r === 0) return;

    // Forward direction flattened onto the ground plane.
    this.camera.getWorldDirection(this._forward);
    this._forward.y = 0;
    this._forward.normalize();
    this._right.crossVectors(this._forward, this.camera.up).normalize();

    const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? this.runSpeed : this.walkSpeed;
    this._move
      .set(0, 0, 0)
      .addScaledVector(this._forward, f)
      .addScaledVector(this._right, r)
      .normalize()
      .multiplyScalar(speed * dt);

    this.rig.position.add(this._move);
    this.rig.position.x = THREE.MathUtils.clamp(this.rig.position.x, -this.bounds, this.bounds);
    this.rig.position.z = THREE.MathUtils.clamp(this.rig.position.z, -this.bounds, this.bounds);
  }
}
