import * as THREE from 'three';

const LENGTH = 0.4; // the mole is a 40 cm probe
const RADIUS = 0.014; // slim (visual choice)
const PUFF_PARTICLES = 28;

/**
 * HP3 "mole": a slim 40 cm metal penetrator with a tether back to the lander, plus
 * small dust puffs for each hammer stroke. The group origin is the mole's top.
 */
export class Mole {
  constructor(scene, cableAnchor) {
    this.scene = scene;
    this.cableAnchor = cableAnchor.clone();

    this.group = new THREE.Group();
    this.group.name = 'HP3_mole';
    const metal = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.85, roughness: 0.32 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS, RADIUS, LENGTH - 0.04, 20), metal);
    body.position.y = -(LENGTH - 0.04) / 2;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(RADIUS, 0.04, 20), metal);
    tip.rotation.x = Math.PI;
    tip.position.y = -LENGTH + 0.02;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS * 0.8, RADIUS, 0.012, 20), metal);
    cap.position.y = 0.006;
    for (const m of [body, tip, cap]) {
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }

    this.cable = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ color: 0x3a332d, roughness: 0.7, metalness: 0.2 })
    );
    this.cable.castShadow = true;

    // Dust puff particles (reused for every stroke).
    this.puffPos = new Float32Array(PUFF_PARTICLES * 3);
    this.puffVel = new Float32Array(PUFF_PARTICLES * 3);
    const puffGeo = new THREE.BufferGeometry();
    puffGeo.setAttribute('position', new THREE.BufferAttribute(this.puffPos, 3));
    this.puff = new THREE.Points(
      puffGeo,
      new THREE.PointsMaterial({ color: 0xc89b72, size: 0.035, transparent: true, opacity: 0, depthWrite: false })
    );
    this.puff.frustumCulled = false;
    this.puffAge = Infinity;

    scene.add(this.group, this.cable, this.puff);
    this.setVisible(false);
  }

  setVisible(v) {
    this.group.visible = v;
    this.cable.visible = v;
  }

  /** Place the mole's top at `top` (world); re-route the tether unless told not to. */
  setTop(top, rebuildCable = true) {
    this.group.position.copy(top);
    if (rebuildCable) this._rebuildCable();
  }

  get top() {
    return this.group.position;
  }

  /** Burst of dust at ground level around the mole. */
  emitPuff() {
    for (let i = 0; i < PUFF_PARTICLES; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.15 + Math.random() * 0.25;
      this.puffPos.set([this.top.x + Math.cos(a) * 0.03, 0.01, this.top.z + Math.sin(a) * 0.03], i * 3);
      this.puffVel.set([Math.cos(a) * s, 0.15 + Math.random() * 0.3, Math.sin(a) * s], i * 3);
    }
    this.puffAge = 0;
  }

  update(dt) {
    if (this.puffAge > 1.2) return;
    this.puffAge += dt;
    for (let i = 0; i < PUFF_PARTICLES; i++) {
      for (let k = 0; k < 3; k++) this.puffPos[i * 3 + k] += this.puffVel[i * 3 + k] * dt;
      this.puffVel[i * 3 + 1] -= 0.4 * dt; // light settling
      this.puffVel[i * 3] *= 0.96;
      this.puffVel[i * 3 + 2] *= 0.96;
    }
    this.puff.geometry.attributes.position.needsUpdate = true;
    this.puff.material.opacity = Math.max(0, 0.7 * (1 - this.puffAge / 1.2));
  }

  _rebuildCable() {
    const top = this.top;
    const end = this.cableAnchor;
    const ground = 0.012;
    const dir = new THREE.Vector3(end.x - top.x, 0, end.z - top.z).normalize();
    const pts = [
      top.clone().add(new THREE.Vector3(0, 0.012, 0)),
      new THREE.Vector3(top.x + dir.x * 0.06, Math.max(ground, top.y * 0.5), top.z + dir.z * 0.06),
      new THREE.Vector3(top.x + dir.x * 0.2, ground, top.z + dir.z * 0.2),
      new THREE.Vector3(THREE.MathUtils.lerp(top.x, end.x, 0.6), ground, THREE.MathUtils.lerp(top.z, end.z, 0.6) + 0.08),
      new THREE.Vector3(end.x, ground, end.z + 0.05),
      end.clone(),
    ];
    const guide = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const curve = new THREE.CatmullRomCurve3(guide.getSpacedPoints(80).map((p) => p.setY(Math.max(p.y, ground))));
    this.cable.geometry.dispose();
    this.cable.geometry = new THREE.TubeGeometry(curve, 80, 0.006, 5, false);
  }
}

export const MOLE_LENGTH = LENGTH;
