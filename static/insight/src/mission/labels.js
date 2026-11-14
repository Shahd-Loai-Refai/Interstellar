import * as THREE from 'three';
import { createTag } from './ui.js';

const DIM = 0.4;

/**
 * Floating name tags with thin leader lines to parts of the lander.
 * Each part: { id, text, anchor(): Vector3, tag(): Vector3 } — tag() is evaluated
 * every frame, so tags can follow moving parts.
 */
export class Labels {
  constructor(scene, parts) {
    this.hidden = false;
    this.items = parts.map((p) => {
      const tag = createTag(p.text);
      tag.opacity = 0;
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color: 0xffe6cc, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false })
      );
      line.renderOrder = 21;
      line.frustumCulled = false;
      line.visible = false;
      scene.add(tag.mesh, line);
      return { ...p, tagPanel: tag, line, level: 0 }; // level: 0 hidden, 1 bright, DIM dimmed
    });
  }

  get(id) {
    return this.items.find((i) => i.id === id);
  }

  /** Reveal tags one by one. */
  async showSequential(animator, interval = 1) {
    for (const item of this.items) {
      if (item.level === 0) animator.tween(0.4, (k) => this._setLevel(item, k));
      await animator.wait(interval);
    }
  }

  /** Dim every tag except `id`, which stays bright and highlighted. */
  emphasize(animator, id) {
    const tasks = this.items.map((item) => {
      const from = item.level;
      const to = item.id === id ? 1 : DIM;
      item.tagPanel.redraw({ emphasis: item.id === id });
      return animator.tween(0.6, (k) => this._setLevel(item, from + (to - from) * k));
    });
    return Promise.all(tasks);
  }

  setHidden(hidden) {
    this.hidden = hidden;
    for (const item of this.items) this._setLevel(item, item.level);
  }

  _setLevel(item, level) {
    item.level = level;
    const o = this.hidden ? 0 : level;
    item.tagPanel.opacity = o;
    item.line.material.opacity = o * 0.85;
    item.line.visible = o > 0.001;
  }

  update(cameraPosition) {
    for (const item of this.items) {
      if (item.level === 0) continue;
      const tagPos = item.tag();
      item.tagPanel.mesh.position.copy(tagPos);
      item.tagPanel.mesh.lookAt(cameraPosition);
      const pos = item.line.geometry.attributes.position;
      const a = item.anchor();
      // Start the line at the tag's lower edge.
      pos.setXYZ(0, tagPos.x, tagPos.y - item.tagPanel.height / 2, tagPos.z);
      pos.setXYZ(1, a.x, a.y, a.z);
      pos.needsUpdate = true;
    }
  }
}
