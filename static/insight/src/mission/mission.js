import * as THREE from 'three';
import { Animator, ease } from './animator.js';
import { Arm } from './arm.js';
import { Labels } from './labels.js';
import { createHand } from './hand.js';
import { createButton, createCard, createGlow } from './ui.js';
import { TemperatureMission } from './temperature.js';
import { MarsquakeMission } from './marsquake.js';
import { BUTTONS, INTRO, MENU, PART_LABELS } from '../data/insightFacts.js';
import { tell } from '../bridge.js';

// --- Layout (world metres; the lander's deck is centred on the origin, front facing +Z) ---
const START = new THREE.Vector3(0, 0, 4); // centred in front of the lander, ~4 m away
const START_FOCUS = new THREE.Vector3(0, 0.9, 0.3);
const MENU_OFFSET = new THREE.Vector3(0.9, 1.65, -1.6); // relative to the player
const CAPTION_OFFSET = new THREE.Vector3(0, -0.3, -1.1); // head-locked, bottom of view
const ARM_TAGS = {
  arm: new THREE.Vector3(-1.75, 2.0, 1.1),
  grapple: new THREE.Vector3(-1.75, 1.72, 1.1),
  camera: new THREE.Vector3(-1.75, 1.44, 1.1),
};
// First-person hand. Desktop: camera space; VR: right-controller space.
const HAND = {
  desktop: {
    hidden: new THREE.Vector3(0.24, -0.6, -0.3),
    ready: new THREE.Vector3(0.17, -0.24, -0.42),
    shoulder: new THREE.Vector3(0.3, -0.8, 0.1), // below and behind the view: the arm's origin
  },
  vr: {
    hidden: new THREE.Vector3(0, -0.04, 0.04),
    ready: new THREE.Vector3(0, 0, 0),
    shoulder: new THREE.Vector3(0.05, -0.15, 0.45),
  },
};

// --- Motion ------------------------------------------------------------------------
const INTRO_SECONDS = 10;
const INTRO_FADE = 0.5; // each intro line fades in and out over this time
const WALK_SPEED = 1.35; // m/s
const BOB = 0.02; // max head bob while walking (desktop only)
const DOME_CLEARANCE = 0.85; // walks curve around the SEIS dome

const UP = new THREE.Vector3(0, 1, 0);
const up = (v, h) => v.clone().addScaledVector(UP, h);

/**
 * Hosts the experience: intro → part labels → missions panel, plus everything the
 * missions share (walking, the first-person touch, captions, the result card, Repeat
 * and Back). Each mission provides setup(parts), reset(), play(), update(dt), busy.
 */
export class Mission {
  constructor({ renderer, camera, rig, controls, mars, interaction }) {
    this.renderer = renderer;
    this.camera = camera;
    this.rig = rig;
    this.controls = controls;
    this.scene = mars.scene;
    this.interaction = interaction;
    this.animator = new Animator();
    this.time = 0;
    this.step = 'intro';
    this.billboards = new Set();

    this.missions = {
      temperature: new TemperatureMission(this),
      marsquakes: new MarsquakeMission(this),
    };

    this.hand = createHand();
    this.hand.opacity = 0;
    this.touchRing = createTouchRing();
    this.touchPulse = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd2a0, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending })
    );
    this.touchPulse.visible = false;
    this.scene.add(this.touchRing, this.touchPulse);

    this._camPos = new THREE.Vector3();
    this._tmp = new THREE.Vector3();

    this.ready = mars.ready.then((parts) => this._setupLander(parts)).catch(() => false);
  }

  start() {
    this._runIntro();
  }

  // ------------------------------------------------------------------------------
  // Setup
  // ------------------------------------------------------------------------------

  _setupLander(parts) {
    const { model, seismometer } = parts;
    this.arm = new Arm(model);
    this.housing = model.getObjectByName('HP3_v3d_baked');
    this.housingRest = this.housing.position.clone();
    this.idc = model.getObjectByName('IDC');
    this.seis = seismometer;

    const anchors = {
      arm: () => {
        const a = this.arm.joints[1].node.getWorldPosition(new THREE.Vector3());
        return a.lerp(this.arm.joints[2].node.getWorldPosition(this._tmp), 0.5);
      },
      grapple: () => this.arm.effectorWorld(this.arm.grip),
      camera: () => new THREE.Box3().setFromObject(this.idc).getCenter(new THREE.Vector3()),
      seis: () => up(this.seis.position, 0.36),
      hp3: () => this._housingTop(),
    };
    const tags = {
      ...Object.fromEntries(Object.entries(ARM_TAGS).map(([id, v]) => [id, () => v])),
      seis: () => up(this.seis.position, 0.36).add(new THREE.Vector3(0.75, 0.45, 0.2)),
      hp3: () => this._housingTop().add(new THREE.Vector3(0.7, 0.3, 0.3)),
    };
    this.labels = new Labels(
      this.scene,
      PART_LABELS.map((p) => ({ id: p.id, text: p.text, anchor: anchors[p.id], tag: tags[p.id] }))
    );

    for (const m of Object.values(this.missions)) m.setup(parts);
    return true;
  }

  // ------------------------------------------------------------------------------
  // Flow
  // ------------------------------------------------------------------------------

  async _runIntro() {
    this.step = 'intro';
    // Lines play back to back, each fading in and out within its time slot.
    const text = (async () => {
      for (const line of INTRO.lines) {
        const panel = createCard(line.text, { width: 1.6, fontSize: 0.09, weight: 700 });
        panel.opacity = 0;
        panel.mesh.position.set(0, 1.75, -2.4);
        this.rig.add(panel.mesh); // moves with the player during the glide
        await this.animator.tween(INTRO_FADE, (k) => (panel.opacity = k));
        await this.animator.wait(line.to - line.from - 2 * INTRO_FADE);
        await this.animator.tween(INTRO_FADE, (k) => (panel.opacity = 1 - k));
        panel.dispose();
      }
    })();
    await this.walk({ to: START, focus: START_FOCUS, duration: INTRO_SECONDS });
    await text;

    if (!(await this.ready)) return; // the model failed to load; a notice is already shown

    this.setLabelLevels(1, null, 0.5);
    await this.animator.wait(1);
    this._showMenu();
  }

  _showMenu() {
    this.step = 'menu';
    const width = 1.0;
    const height = 0.2;
    const gap = 0.04;
    const group = new THREE.Group();
    const title = createCard(MENU.title, { width, fontSize: 0.075, weight: 700 });
    group.add(title.mesh);
    const panels = [title];
    const glows = [];
    const items = [];
    let y = -title.height / 2 - gap;

    for (const m of MENU.missions) {
      // Every card looks the same; only missions that exist are clickable.
      const button = createButton(m.title, { width, height, fontSize: 0.062, variant: 'primary' });
      y -= height / 2;
      button.mesh.position.y = y;
      const glow = createGlow(width, height);
      glow.mesh.position.set(0, y, -0.004);
      group.add(glow.mesh, button.mesh);
      panels.push(glow, button);
      glows.push(glow);
      if (this.missions[m.id]) {
        items.push(
          this.interaction.add({
            object: button.mesh,
            enabled: () => this.step === 'menu',
            setHover: (h) => button.setHover(h),
            onSelect: () => this._play(m.id),
          })
        );
      }
      y -= height / 2 + gap;
    }

    group.position.copy(this.rig.position).add(MENU_OFFSET);
    this.scene.add(group);
    this.billboards.add(group);
    this.menu = { group, panels, items, glows };
    this._fade(panels, 0, 1, 0.35);
  }

  async _hideMenu() {
    if (!this.menu) return;
    const { group, panels, items } = this.menu;
    this.menu = null;
    items.forEach((i) => this.interaction.remove(i));
    await this._fade(panels, 1, 0, 0.3);
    panels.forEach((p) => p.dispose());
    this.billboards.delete(group);
    group.removeFromParent();
  }

  async _play(id) {
    this.current = id;
    this.step = 'operation';
    this._hideMenu();
    this._resetAll();
    this.setLabelLevels(0.4, this.missions[id].labelId, 0.5);
    tell('mission-start', { id });
    await this.missions[id].play();
    tell('mission-end', { id });
  }

  _resetAll() {
    this.caption(null);
    for (const m of Object.values(this.missions)) m.reset();
  }

  async _goHome() {
    this.step = 'busy';
    this._resetAll();
    this.setLabelLevels(1, null, 0.4);
    await this.walk({ to: START, focus: START_FOCUS, bob: true });
    this._showMenu();
  }

  // ------------------------------------------------------------------------------
  // Shared mission helpers
  // ------------------------------------------------------------------------------

  /**
   * Walk the player rig to `to` with ease-in/ease-out, curving around the SEIS dome.
   * Desktop only: the view turns gently towards `focus` and a head bob (≤ 2 cm) plays.
   * In VR only the rig moves; the head is never moved or rotated for the user.
   */
  async walk({ to, focus = null, duration = null, bob = false }) {
    const vr = this.renderer.xr.isPresenting;
    const from = this.rig.position.clone();
    const ctrl = this._controlAround(from, to) ?? from.clone().lerp(to, 0.5);
    const pathLength = from.distanceTo(ctrl) + ctrl.distanceTo(to);
    const time = duration ?? THREE.MathUtils.clamp(pathLength / WALK_SPEED, 1.5, 3);
    const qFrom = this.camera.quaternion.clone();
    let qTo = null;
    if (focus && !vr) {
      const eye = new THREE.Vector3(to.x, this.camera.position.y, to.z);
      qTo = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, focus, UP));
    }
    const eyeY = this.camera.position.y;
    const steps = Math.max(1, Math.round(pathLength / 0.7));

    this.userControl(false);
    await this.animator.tween(
      time,
      (k, raw) => {
        const a = (1 - k) * (1 - k);
        const b = 2 * (1 - k) * k;
        const c = k * k;
        this.rig.position.x = a * from.x + b * ctrl.x + c * to.x;
        this.rig.position.z = a * from.z + b * ctrl.z + c * to.z;
        if (qTo) this.camera.quaternion.slerpQuaternions(qFrom, qTo, ease.inOutSine(raw));
        if (bob && !vr) {
          this.camera.position.y = eyeY - 0.5 * BOB * (1 - Math.cos(2 * Math.PI * steps * k)) * Math.sin(Math.PI * raw);
        }
      },
      ease.inOutSine
    );
    this.camera.position.y = eyeY;
    this.userControl(true);
  }

  /**
   * First-person touch: a white-gloved hand with its sleeve rises from the bottom-right
   * of the view (attached to the camera; in VR to the right controller), the index
   * fingertip touches `point`, a soft glow ring and pulse appear, then it drops away.
   */
  async touch(point) {
    const vr = this.renderer.xr.isPresenting;
    const parent = vr ? this._rightController() : this.camera;
    const { hidden, ready, shoulder } = vr ? HAND.vr : HAND.desktop;
    const hand = this.hand;
    const p = new THREE.Vector3();
    const local = () => parent.worldToLocal(point.clone());

    parent.add(hand.group, hand.sleeve);
    hand.opacity = 1;
    await this.animator.tween(0.35, (k) => {
      hand.group.position.lerpVectors(hidden, ready, k);
      hand.aim(ready, local());
      hand.updateSleeve(shoulder);
    }, ease.outCubic);
    await this.animator.tween(1.0, (k) => {
      const target = local();
      hand.group.position.copy(p.lerpVectors(ready, target, k));
      hand.aim(ready, target);
      hand.updateSleeve(shoulder);
    }, ease.inOutCubic);

    this.touchRing.position.copy(point);
    this.touchPulse.position.copy(point);
    this.touchRing.visible = this.touchPulse.visible = true;
    this.animator.tween(0.7, (k) => {
      this.touchRing.scale.setScalar(0.4 + 0.8 * k);
      this.touchRing.material.opacity = 1 - k;
      this.touchPulse.scale.setScalar(0.02 + 0.07 * k);
      this.touchPulse.material.opacity = 0.9 * (1 - k);
      if (k >= 1) this.touchRing.visible = this.touchPulse.visible = false;
    }, ease.outCubic);
    await this.animator.wait(0.2);

    const from = local();
    await this.animator.tween(0.5, (k) => {
      hand.group.position.lerpVectors(from, hidden, k);
      hand.updateSleeve(shoulder);
    }, (t) => t * t);
    hand.opacity = 0;
    hand.group.removeFromParent();
    hand.sleeve.removeFromParent();
  }

  /** One-line caption at the bottom of the view (follows the head/camera). */
  caption(text) {
    if (this.captionPanel) {
      this.captionPanel.dispose();
      this.captionPanel = null;
    }
    if (!text) return;
    const panel = createCard(text, { width: 1.6, fontSize: 0.042, padding: 0.03 });
    panel.mesh.material.depthTest = false;
    panel.mesh.renderOrder = 40;
    panel.mesh.position.copy(CAPTION_OFFSET);
    panel.opacity = 0;
    this.camera.add(panel.mesh);
    this.captionPanel = panel;
    this.animator.tween(0.25, (k) => {
      if (this.captionPanel === panel) panel.opacity = k;
    });
  }

  /** Result card: a mission's visual, one line of text, and Repeat / Back. */
  showResult({ visual, text, position, scale = 1 }) {
    this.step = 'result';
    const group = new THREE.Group();
    const line = createCard(text, { width: Math.max(0.95, visual.width), fontSize: 0.045 });
    const repeat = createButton(BUTTONS.repeat, { width: 0.45, height: 0.14, fontSize: 0.058, variant: 'primary' });
    const back = createButton(BUTTONS.back, { width: 0.45, height: 0.14, fontSize: 0.058 });
    let y = -visual.height / 2 - 0.03 - line.height / 2;
    line.mesh.position.y = y;
    y -= line.height / 2 + 0.03 + repeat.height / 2;
    repeat.mesh.position.set(-0.24, y, 0);
    back.mesh.position.set(0.24, y, 0);
    group.add(visual.mesh, line.mesh, repeat.mesh, back.mesh);
    group.position.copy(position);
    group.scale.setScalar(scale);
    this.scene.add(group);
    this.billboards.add(group);

    const panels = [visual, line, repeat, back];
    this._fade(panels, 0, 1, 0.35);
    const id = this.current;
    const items = [
      this.interaction.add({
        object: repeat.mesh,
        enabled: () => this.step === 'result',
        setHover: (h) => repeat.setHover(h),
        onSelect: () => this._leaveResult(() => this._play(id)),
      }),
      this.interaction.add({
        object: back.mesh,
        enabled: () => this.step === 'result',
        setHover: (h) => back.setHover(h),
        onSelect: () => this._leaveResult(() => this._goHome()),
      }),
    ];
    this.result = { group, panels, items };
  }

  async _leaveResult(next) {
    this.step = 'busy';
    const { group, panels, items } = this.result;
    this.result = null;
    items.forEach((i) => this.interaction.remove(i));
    await this._fade(panels, 1, 0, 0.25);
    panels.forEach((p) => p.dispose());
    this.billboards.delete(group);
    group.removeFromParent();
    next();
  }

  userControl(on) {
    this.controls.enabled = on && !this.renderer.xr.isPresenting;
    this.controls.look.enabled = on;
  }

  /** Fade all labels to `level`; `brightId` stays fully bright and highlighted. */
  setLabelLevels(level, brightId, duration) {
    for (const item of this.labels.items) {
      const to = item.id === brightId ? 1 : level;
      const from = item.level;
      item.tagPanel.redraw({ emphasis: item.id === brightId });
      this.animator.tween(duration, (k) => this.labels._setLevel(item, from + (to - from) * k));
    }
  }

  housingBox() {
    return new THREE.Box3().setFromObject(this.housing);
  }

  // ------------------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------------------

  _housingTop() {
    const b = this.housingBox();
    return new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2);
  }

  /** Bézier control point that bends a walk around the SEIS dome, or null if the line is clear. */
  _controlAround(from, to) {
    if (!this.seis) return null;
    const c = new THREE.Vector3(this.seis.position.x, 0, this.seis.position.z);
    const ab = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
    const len2 = ab.lengthSq();
    if (len2 < 1e-6) return null;
    const t = THREE.MathUtils.clamp(new THREE.Vector3(c.x - from.x, 0, c.z - from.z).dot(ab) / len2, 0, 1);
    const closest = new THREE.Vector3(from.x, 0, from.z).addScaledVector(ab, t);
    const d = closest.distanceTo(c);
    if (d >= DOME_CLEARANCE) return null;
    const away = closest.clone().sub(c);
    if (away.lengthSq() < 1e-6) away.set(ab.z, 0, -ab.x); // straight through the centre: go to one side
    away.normalize();
    // The curve's midpoint lands halfway between the line and the control point.
    return c.clone().addScaledVector(away, 2 * (DOME_CLEARANCE + 0.15)).sub(closest).add(c);
  }

  _rightController() {
    const sources = this.renderer.xr.getSession()?.inputSources ?? [];
    const i = Array.from(sources).findIndex((s) => s.handedness === 'right');
    return this.renderer.xr.getController(Math.max(0, i));
  }

  _fade(panels, from, to, duration) {
    return this.animator.tween(duration, (k) => {
      for (const p of panels) p.opacity = from + (to - from) * k;
    });
  }

  // ------------------------------------------------------------------------------
  // Frame update
  // ------------------------------------------------------------------------------

  update(dt) {
    this.time += dt;
    this.animator.update(dt);
    this.camera.getWorldPosition(this._camPos);

    let missionBusy = false;
    if (this.arm) {
      for (const m of Object.values(this.missions)) {
        m.update(dt);
        missionBusy ||= m.busy;
      }
      this.labels.update(this._camPos);
    }

    if (this.menu) {
      const glow = 0.55 + 0.45 * Math.sin(this.time * 3);
      for (const g of this.menu.glows) g.opacity = glow;
    }
    for (const obj of this.billboards) obj.lookAt(this._camPos);

    // Shadows are rendered on demand; refresh them while anything moves.
    if (this.animator.busy || missionBusy) this.renderer.shadowMap.needsUpdate = true;

    this.interaction.update();
  }
}

function createTouchRing() {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.1, 0.13, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffc27a,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  return ring;
}
