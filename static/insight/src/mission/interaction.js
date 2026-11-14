import * as THREE from 'three';

/**
 * Pointing input for desktop and VR.
 * - Desktop: while the mouse is captured, a centre crosshair aims; otherwise the cursor.
 * - VR: a ray from each tracked controller; the trigger presses.
 *
 * Interactable items: { object, enabled(): bool, onSelect?(), onHoldStart?(ray),
 *   onHoldMove?(ray), onHoldEnd?(ray), setHover?(bool) }
 * Items with onHoldStart are "hold" items (press, then release); others select on press.
 */
export class Interaction {
  constructor({ renderer, camera, rig, canvas, controls }) {
    this.renderer = renderer;
    this.camera = camera;
    this.controls = controls;
    this.items = [];
    this.raycaster = new THREE.Raycaster();
    this.hovered = new Set();

    // --- Desktop pointer ---------------------------------------------------
    this.mouse = new THREE.Vector2();
    this.mouseInside = false;
    this.desktop = { ray: new THREE.Ray(), hit: null, holding: null, desktop: true };
    this.consumedClick = false;

    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.mouseInside = true;
    });
    canvas.addEventListener('pointerleave', () => (this.mouseInside = false));
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || renderer.xr.isPresenting) return;
      this.consumedClick = this._press(this.desktop);
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || renderer.xr.isPresenting) return;
      this._release(this.desktop);
    });
    // Clicking an interactive object must not also capture the mouse.
    controls.shouldLock = () => !this.consumedClick;

    // --- VR controllers ----------------------------------------------------
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    this.xr = [0, 1].map((i) => {
      const controller = renderer.xr.getController(i);
      const line = new THREE.Line(
        lineGeo,
        new THREE.LineBasicMaterial({ color: 0xffe2c0, transparent: true, opacity: 0.8, fog: false, toneMapped: false })
      );
      line.scale.z = 4;
      line.visible = false;
      controller.add(line);
      rig.add(controller); // controllers move with the player rig

      const pointer = { controller, line, ray: new THREE.Ray(), hit: null, holding: null, active: false };
      controller.addEventListener('connected', (e) => {
        pointer.active = e.data.targetRayMode === 'tracked-pointer';
        line.visible = pointer.active;
      });
      controller.addEventListener('disconnected', () => {
        pointer.active = false;
        line.visible = false;
        this._release(pointer);
      });
      controller.addEventListener('selectstart', () => pointer.active && this._press(pointer));
      controller.addEventListener('selectend', () => this._release(pointer));
      return pointer;
    });

    this._m = new THREE.Matrix4();
    this._ndc = new THREE.Vector2();
  }

  add(item) {
    this.items.push(item);
    return item;
  }

  remove(item) {
    this.items = this.items.filter((i) => i !== item);
    if (this.hovered.has(item)) {
      item.setHover?.(false);
      this.hovered.delete(item);
    }
  }

  _pointers() {
    if (this.renderer.xr.isPresenting) return this.xr.filter((p) => p.active);
    const locked = this.controls.look.isLocked;
    return locked || this.mouseInside ? [this.desktop] : [];
  }

  _updateRay(p) {
    if (p.desktop) {
      if (this.controls.look.isLocked) this._ndc.set(0, 0);
      else this._ndc.copy(this.mouse);
      this.raycaster.setFromCamera(this._ndc, this.camera);
      p.ray.copy(this.raycaster.ray);
    } else {
      p.controller.updateWorldMatrix(true, false);
      this._m.extractRotation(p.controller.matrixWorld);
      p.ray.origin.setFromMatrixPosition(p.controller.matrixWorld);
      p.ray.direction.set(0, 0, -1).applyMatrix4(this._m).normalize();
    }
  }

  _pick(p) {
    this.raycaster.ray.copy(p.ray);
    this.raycaster.far = 30;
    let best = null;
    for (const item of this.items) {
      if (!item.enabled()) continue;
      const hits = this.raycaster.intersectObject(item.object, true);
      if (hits.length && (!best || hits[0].distance < best.distance)) best = { item, distance: hits[0].distance };
    }
    return best;
  }

  _press(p) {
    this._updateRay(p);
    const hit = this._pick(p);
    if (!hit) return false;
    if (hit.item.onHoldStart) {
      p.holding = hit.item;
      hit.item.onHoldStart(p.ray);
    } else {
      hit.item.onSelect?.();
    }
    return true;
  }

  _release(p) {
    if (!p.holding) return;
    const item = p.holding;
    p.holding = null;
    this._updateRay(p);
    item.onHoldEnd?.(p.ray);
  }

  /** True while any pointer holds an item. */
  get holding() {
    return this.desktop.holding || this.xr.some((p) => p.holding);
  }

  update() {
    const nowHovered = new Set();
    for (const p of this._pointers()) {
      this._updateRay(p);
      const hit = this._pick(p);
      if (hit) nowHovered.add(hit.item);
      if (p.line) p.line.scale.z = hit ? hit.distance : 4;
      if (p.holding) p.holding.onHoldMove?.(p.ray);
    }
    for (const item of this.hovered) if (!nowHovered.has(item)) item.setHover?.(false);
    for (const item of nowHovered) if (!this.hovered.has(item)) item.setHover?.(true);
    this.hovered = nowHovered;
  }
}
