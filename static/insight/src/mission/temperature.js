import * as THREE from 'three';
import { ease } from './animator.js';
import { READY_POSE, STOWED_POSE } from './arm.js';
import { Mole, MOLE_LENGTH } from './mole.js';
import { createPanel } from './ui.js';
import { MISSION } from '../data/insightFacts.js';
import { HOUSING_ASIDE_SPOT, PROBE_SPOT } from '../scenes/marsScene.js';

// Closest clear spot to the heat probe: just in front of the deck, right of the stowed arm
// (~1.2 m from the probe; nearer would be inside the deck or under a solar panel).
const PROBE_STAND = new THREE.Vector3(0.05, 0, 1.3);
const OPERATION_VIEW = new THREE.Vector3(-0.75, 0, 2.75); // stepped back, to the left
const OPERATION_FOCUS = new THREE.Vector3(-1.0, 0.55, 1.4);
const GAUGE_POS = new THREE.Vector3(-0.35, 1.6, 1.85); // right next to the probe spot
const GAUGE_SCALE = 0.8;

const HOVER = 0.3; // arm clearance above the housing while carrying
const SINK_PULSES = 10;
const STUCK_PULSES = 3;
const UP = new THREE.Vector3(0, 1, 0);
const up = (v, h) => v.clone().addScaledVector(UP, h);

/** Mission 1 — "Taking Mars' temperature": HP3 placement, the mole, and the scoop. */
export class TemperatureMission {
  constructor(host) {
    this.host = host;
    this.labelId = 'hp3';
    this.carry = null;
    this.resetting = Promise.resolve();
  }

  setup({ deck }) {
    const cableAnchor = new THREE.Vector3(deck.min.x + 0.2, deck.min.y + 0.12, deck.max.z - 0.05);
    this.mole = new Mole(this.host.scene, cableAnchor);
  }

  /** Probe back on the deck, mole hidden, arm returning to stowed. */
  reset() {
    const { arm, housing, housingRest, animator } = this.host;
    this.carry = null;
    housing.position.copy(housingRest);
    this.mole.setVisible(false);
    this.mole.setTop(new THREE.Vector3(PROBE_SPOT.x, MOLE_LENGTH, PROBE_SPOT.z));
    if (arm.angles.some((a) => Math.abs(a) > 1e-3)) this.resetting = arm.moveTo(animator, STOWED_POSE, 0.8);
  }

  async play() {
    const h = this.host;
    await h.walk({ to: PROBE_STAND, focus: this._touchPoint(), bob: true });
    await this.resetting;
    h.userControl(false);
    await h.touch(this._touchPoint());
    await h.walk({ to: OPERATION_VIEW, focus: OPERATION_FOCUS, duration: 1.5 });

    const { arm, animator } = h;
    // a. Arm places the heat probe on the ground.
    h.caption(MISSION.facts[0].text);
    await this._moveHousing(PROBE_SPOT, 0.5);
    this.mole.setTop(new THREE.Vector3(PROBE_SPOT.x, MOLE_LENGTH, PROBE_SPOT.z));
    this.mole.setVisible(true);

    // b. Mole hammers down about 30 cm, then stops moving.
    h.caption(MISSION.facts[1].text);
    await this._hammer(SINK_PULSES, MISSION.gauge.reachedM / SINK_PULSES);
    await this._hammer(STUCK_PULSES, 0);

    // c. Housing lifted aside; scoop presses on the mole; one more round, no progress.
    h.caption(MISSION.facts[2].text);
    await this._moveHousing(HOUSING_ASIDE_SPOT, 0.35);
    const top = this.mole.top.clone();
    await arm.moveTo(animator, arm.solveScoop(up(top, 0.2)), 0.9);
    await arm.moveTo(animator, arm.solveScoop(up(top, 0.012)), 0.45);
    await this._hammer(STUCK_PULSES, 0);
    await arm.moveTo(animator, arm.solveScoop(up(top, 0.2)), 0.4);

    h.caption(null);
    arm.moveTo(animator, READY_POSE, 1.0);
    const gauge = createGauge();
    h.showResult({ visual: gauge, text: MISSION.end.text, position: GAUGE_POS, scale: GAUGE_SCALE });
    animator.tween(0.9, (k) => gauge.redraw({ fill: k }), ease.outCubic);
  }

  update(dt) {
    if (this.carry) {
      const { arm, housing } = this.host;
      const world = arm.effectorWorld(arm.grip).add(this.carry);
      housing.position.copy(housing.parent.worldToLocal(world));
    }
    this.mole?.update(dt);
  }

  get busy() {
    return !!this.carry;
  }

  // --------------------------------------------------------------------------------

  /** Touch point: front edge of the probe housing's top, the side facing the user. */
  _touchPoint() {
    const b = this.host.housingBox();
    return new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, b.max.z - 0.03);
  }

  /** Grapple picks up the HP3 housing and sets it down centred on `spot`. `s` scales the timing. */
  async _moveHousing(spot, s = 1) {
    const { arm, animator, housing } = this.host;
    const box = this.host.housingBox();
    const top = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
    const height = box.max.y - box.min.y;
    const gripToOrigin = housing.getWorldPosition(new THREE.Vector3()).sub(top);
    const targetTop = new THREE.Vector3(spot.x, height, spot.z);

    await arm.moveTo(animator, arm.solveGrip(up(top, HOVER)), 2 * s);
    await arm.moveTo(animator, arm.solveGrip(top), 0.9 * s);
    this.carry = gripToOrigin; // housing now follows the grapple
    await arm.moveTo(animator, arm.solveGrip(up(top, HOVER)), 0.9 * s);
    await arm.moveTo(animator, arm.solveGrip(up(targetTop, HOVER + 0.1)), 2.4 * s);
    await arm.moveTo(animator, arm.solveGrip(targetTop), 1.1 * s);
    this.carry = null;
    this._snapHousing(spot);
    await arm.moveTo(animator, arm.solveGrip(up(targetTop, HOVER)), 0.9 * s);
  }

  _snapHousing(spot) {
    const { housing } = this.host;
    const b = this.host.housingBox();
    const world = housing.getWorldPosition(new THREE.Vector3());
    world.x += spot.x - (b.min.x + b.max.x) / 2;
    world.y -= b.min.y;
    world.z += spot.z - (b.min.z + b.max.z) / 2;
    housing.position.copy(housing.parent.worldToLocal(world));
  }

  async _hammer(pulses, step, gap = 0.22) {
    const { animator } = this.host;
    for (let i = 0; i < pulses; i++) {
      const start = this.mole.top.clone();
      if (step > 0) {
        await animator.tween(0.08, (k) => this.mole.setTop(up(start, -step * k), false), ease.outCubic);
      } else {
        // Stuck: a small recoil, no progress.
        await animator.tween(0.1, (k) => this.mole.setTop(up(start, -0.004 * Math.sin(Math.PI * k)), false), ease.linear);
      }
      this.mole.setTop(this.mole.top.clone());
      this.mole.emitPuff();
      await animator.wait(gap);
    }
  }
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Depth gauge: ground depth 0–3 m, goal line at 3 m, orange fill to ~30 cm (animated by state.fill). */
function createGauge() {
  const G = MISSION.gauge;
  return createPanel(0.95, 0.95, (ctx, w, h, state) => {
    const fill = state.fill ?? 0;
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, 36);
    ctx.fillStyle = 'rgba(16, 12, 10, 0.82)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255, 222, 185, 0.35)';
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 64px ${FONT}`;
    ctx.fillText(G.title, w / 2, 75);

    // Bar: top = ground (0 m), bottom = 3 m.
    const barX = 150;
    const barW = 90;
    const barTop = 150;
    const barBottom = h - 90;
    const depthY = (m) => barTop + ((barBottom - barTop) * m) / G.goalM;
    ctx.fillStyle = 'rgba(120, 70, 40, 0.55)';
    ctx.fillRect(barX, barTop, barW, barBottom - barTop);
    ctx.fillStyle = '#f2a65a';
    ctx.fillRect(barX, barTop, barW, depthY(G.reachedM * fill) - barTop);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 4;
    ctx.strokeRect(barX, barTop, barW, barBottom - barTop);

    ctx.textAlign = 'left';
    ctx.font = `500 40px ${FONT}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText(G.top, barX + barW + 30, barTop);

    ctx.font = `700 50px ${FONT}`;
    ctx.fillStyle = '#f2a65a';
    ctx.globalAlpha = fill;
    ctx.fillText(G.reached, barX + barW + 30, depthY(G.reachedM) + 30);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = '#ffffff';
    ctx.setLineDash([18, 12]);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(barX - 40, barBottom);
    ctx.lineTo(barX + barW + 20, barBottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fff';
    ctx.fillText(G.goal, barX + barW + 30, barBottom);
  });
}
