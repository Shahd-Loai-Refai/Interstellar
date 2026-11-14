import * as THREE from 'three';
import { ease } from './animator.js';
import { createCard, createPanel } from './ui.js';
import { MARSQUAKE } from '../data/insightFacts.js';

// --- Layout (world metres; SEIS dome at about (0, 3.1)) -----------------------------
const STAND = new THREE.Vector3(1.0, 0, 3.7); // ~0.8 m from the dome's surface
const WIDE_VIEW = new THREE.Vector3(1.6, 0, 6.5); // lander, dome and ground in one view
const WIDE_FOCUS = new THREE.Vector3(-0.1, 0.7, 1.8);
const GRAPH_POS = new THREE.Vector3(1.0, 1.25, 3.0); // beside the dome
const RESULT_POS = new THREE.Vector3(0.95, 1.55, 3.0);
const TAG_OFFSET = new THREE.Vector3(-0.52, 0.34, -1.1); // head-locked, top-left of view

// --- Illustrative quake timeline (seconds from the first ring) -----------------------
// Rings start ~200 m out, from a far-away point (no particular compass direction implied).
const EPICENTER = new THREE.Vector2(-90, -260);
const START_DIST = 200; // ring fronts first appear this far from the lander
const T_P = 4.0; // first, small wave arrives at the lander
const T_S = 7.0; // bigger wave arrives
const DURATION = 22; // includes the long, slow fade
const SHAKE_M = { p: 0.004, s: 0.03, tail: 0.015 }; // amplified so it can be seen
const VR_SHAKE_SCALE = 0.35; // gentler in a headset

const riseDecay = (x, rise, decay) => (x <= 0 ? 0 : (1 - Math.exp(-x / rise)) * Math.exp(-x / decay));

/** Envelope of each wave at time t (0..1-ish). */
function envelope(t) {
  return {
    p: riseDecay(t - T_P, 0.25, 2.2),
    s: riseDecay(t - T_S, 0.6, 3.0),
    tail: t < T_S ? 0 : (1 - Math.exp(-(t - T_S) / 1.0)) * Math.exp(-(t - T_S) / 6),
  };
}

/** Mission 2 — "Listening for marsquakes": SEIS, a replay of S1222a, and Mars' interior. */
export class MarsquakeMission {
  constructor(host) {
    this.host = host;
    this.labelId = 'seis';
    this.quakeTime = null; // seconds since the quake started, or null
    this.samples = new Float32Array(320);
    this.sampleClock = 0;
    this.redrawToggle = false;
  }

  setup({ model }) {
    const { scene } = this.host;
    // Things that shake: ground, rocks, lander, seismometer, tether.
    this.shakeTargets = [
      scene.getObjectByName('Terrain'),
      scene.getObjectByName('Rocks'),
      scene.getObjectByName('InSightLander'),
      this.host.seis,
      scene.getObjectByName('SEIS_tether'),
    ]
      .filter(Boolean)
      .map((object) => ({ object, base: object.position.clone() }));

    // Shockwave rings drawn on the terrain surface itself.
    const terrain = scene.getObjectByName('Terrain');
    this.ringMat = createRingMaterial();
    this.rings = new THREE.Mesh(terrain.geometry, this.ringMat);
    this.rings.renderOrder = 1;
    this.rings.visible = false;
    terrain.add(this.rings);

    // Dust lifting from the ground and the solar panels.
    const panels = ['panel_l_root', 'panel_r_root'].map((n) => model.getObjectByName(n)).filter(Boolean);
    this.dust = new QuakeDust(scene, panels);
  }

  reset() {
    this.quakeTime = null;
    for (const t of this.shakeTargets) t.object.position.copy(t.base);
    this.rings.visible = false;
    this.dust.clear();
    this._removeGraph();
    this._setTag(false);
    this.samples.fill(0);
  }

  async play() {
    const h = this.host;
    await h.walk({ to: STAND, focus: this._touchPoint(), bob: true });
    h.userControl(false);
    await h.touch(this._touchPoint());
    await h.walk({ to: WIDE_VIEW, focus: WIDE_FOCUS, duration: 1.5 });

    // d. Calm, live seismograph.
    this._showGraph();
    h.caption(MARSQUAKE.facts.sensitivity.text);
    await h.animator.wait(3.5);

    // e. Quake replay.
    h.caption(MARSQUAKE.facts.largest.text);
    this._setTag(true);
    this.rings.visible = true;
    let dustDone = false;
    let saturatedShown = false;
    await h.animator.tween(
      DURATION,
      (_k, raw) => {
        const t = raw * DURATION;
        this.quakeTime = t;
        this._applyShake(t);
        this._updateRings(t);
        if (!dustDone && t >= T_S) {
          dustDone = true;
          this.dust.emit();
        }
        if (!saturatedShown && t >= T_S + 2.5) {
          saturatedShown = true;
          h.caption(MARSQUAKE.facts.saturated.text);
        }
      },
      ease.linear
    );
    this.quakeTime = null;
    for (const s of this.shakeTargets) s.object.position.copy(s.base);
    this.rings.visible = false;
    this._setTag(false);
    h.caption(null);

    // f. Result: Inside Mars.
    this._removeGraph();
    h.showResult({ visual: createInsideMars(), text: MARSQUAKE.facts.total.text, position: RESULT_POS });
  }

  update(dt) {
    this.dust.update(dt);
    if (!this.graph) return;
    // Seismograph: push samples at 50 Hz, redraw at ~30 Hz.
    this.sampleClock += dt;
    while (this.sampleClock >= 0.02) {
      this.sampleClock -= 0.02;
      this.samples.copyWithin(0, 1);
      this.samples[this.samples.length - 1] = this._signal(this.quakeTime);
    }
    this.redrawToggle = !this.redrawToggle;
    if (this.redrawToggle) this.graph.redraw({ samples: this.samples });
  }

  get busy() {
    return this.quakeTime !== null || this.dust.active;
  }

  // --------------------------------------------------------------------------------

  _touchPoint() {
    // Upper side of the dome, facing the stand position.
    const c = this.host.seis.position;
    const dir = new THREE.Vector3(STAND.x - c.x, 0, STAND.z - c.z).normalize();
    return c.clone().addScaledVector(dir, 0.2).add(new THREE.Vector3(0, 0.27, 0));
  }

  /** Illustrative seismograph value at quake time t (null = calm). */
  _signal(t) {
    const noise = (Math.random() - 0.5) * 0.035;
    if (t === null) return noise;
    const e = envelope(t);
    const tau = Math.PI * 2;
    return (
      noise * (1 + 4 * (e.p + e.s)) +
      e.p * 0.2 * Math.sin(tau * 5.3 * t) +
      e.s * 0.95 * Math.sin(tau * 3.1 * t + 0.6 * Math.sin(tau * 0.7 * t)) +
      e.tail * 0.32 * Math.sin(tau * 2.2 * t + 1.1) * (0.6 + 0.4 * Math.sin(tau * 0.37 * t))
    );
  }

  /** Smooth, noise-like shake of the world (never the user's head). */
  _applyShake(t) {
    const e = envelope(t);
    let amp = SHAKE_M.p * e.p + SHAKE_M.s * e.s + SHAKE_M.tail * e.tail;
    if (this.host.renderer.xr.isPresenting) amp *= VR_SHAKE_SCALE;
    const tau = Math.PI * 2;
    const n = (f1, f2, ph) => 0.6 * Math.sin(tau * f1 * t + ph) + 0.4 * Math.sin(tau * f2 * t + ph * 1.7);
    const dx = amp * n(3.1, 5.3, 0.3);
    const dy = amp * 0.5 * n(4.1, 6.7, 1.9);
    const dz = amp * n(2.7, 4.9, 3.1);
    for (const s of this.shakeTargets) s.object.position.set(s.base.x + dx, s.base.y + dy, s.base.z + dz);
  }

  _updateRings(t) {
    const d = EPICENTER.length();
    const r0 = d - START_DIST;
    const speedP = START_DIST / T_P;
    const speedS = START_DIST / T_S;
    const fronts = [r0 + speedP * t, r0 + speedS * t, r0 + speedS * Math.max(0, t - 1.5)];
    const strength = [0.5, 1.0, 0.6];
    const u = this.ringMat.uniforms;
    for (let i = 0; i < 3; i++) {
      u.uFront.value.setComponent(i, fronts[i]);
      // Fade in at the horizon; fade out once ~80 m past the lander.
      const past = fronts[i] - d;
      const fadeIn = Math.min(1, (fronts[i] - r0) / 15);
      const fadeOut = 1 - THREE.MathUtils.smoothstep(past, 20, 80);
      u.uAmp.value.setComponent(i, strength[i] * fadeIn * fadeOut * (i === 2 && t < 1.5 ? 0 : 1));
    }
  }

  _showGraph() {
    if (this.graph) return;
    const graph = createSeismograph();
    graph.mesh.position.copy(GRAPH_POS);
    graph.opacity = 0;
    this.host.scene.add(graph.mesh);
    this.host.billboards.add(graph.mesh);
    this.host.animator.tween(0.4, (k) => this.graph === graph && (graph.opacity = k));
    this.graph = graph;
  }

  _removeGraph() {
    if (!this.graph) return;
    this.host.billboards.delete(this.graph.mesh);
    this.graph.dispose();
    this.graph = null;
  }

  _setTag(on) {
    if (this.tag) {
      this.tag.dispose();
      this.tag = null;
    }
    if (!on) return;
    const tag = createCard(MARSQUAKE.ui.amplified, { width: 0.62, fontSize: 0.03, padding: 0.02 });
    tag.mesh.material.depthTest = false;
    tag.mesh.renderOrder = 40;
    tag.mesh.position.copy(TAG_OFFSET);
    this.host.camera.add(tag.mesh);
    this.tag = tag;
  }
}

// --------------------------------------------------------------------------------
// Visual pieces
// --------------------------------------------------------------------------------

function createRingMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uEpicenter: { value: EPICENTER.clone() },
      uFront: { value: new THREE.Vector3() },
      uAmp: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color(0xc77a45) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec2 uEpicenter;
      uniform vec3 uFront;
      uniform vec3 uAmp;
      uniform vec3 uColor;
      varying vec3 vWorld;
      float band(float d, float front, float width) {
        float x = (d - front) / width;
        return exp(-x * x);
      }
      void main() {
        float d = distance(vWorld.xz, uEpicenter);
        float a = uAmp.x * band(d, uFront.x, 3.0) + uAmp.y * band(d, uFront.y, 4.5) + uAmp.z * band(d, uFront.z, 4.0);
        // Match the scene's distance haze.
        float fogD = 0.0045 * distance(vWorld, cameraPosition);
        a *= exp(-fogD * fogD);
        gl_FragColor = vec4(uColor, clamp(a * 0.38, 0.0, 0.6));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    fog: false,
  });
}

/** Dust lifting gently from the ground around the lander and from the solar panels. */
class QuakeDust {
  constructor(scene, panels) {
    this.count = 260;
    this.panels = panels;
    this.pos = new Float32Array(this.count * 3);
    this.vel = new Float32Array(this.count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xcfa27a, size: 0.035, transparent: true, opacity: 0, depthWrite: false })
    );
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.age = Infinity;
    this.life = 5;
    scene.add(this.points);
  }

  get active() {
    return this.age < this.life;
  }

  emit() {
    const boxes = this.panels.map((p) => new THREE.Box3().setFromObject(p));
    for (let i = 0; i < this.count; i++) {
      let x, y, z;
      if (boxes.length && i % 3 === 0) {
        const b = boxes[i % boxes.length];
        x = THREE.MathUtils.lerp(b.min.x, b.max.x, Math.random());
        z = THREE.MathUtils.lerp(b.min.z, b.max.z, Math.random());
        y = b.max.y + 0.01;
      } else {
        const r = 1 + Math.random() * 8;
        const a = Math.random() * Math.PI * 2;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        y = 0.02;
      }
      this.pos.set([x, y, z], i * 3);
      this.vel.set([(Math.random() - 0.5) * 0.15, 0.08 + Math.random() * 0.25, (Math.random() - 0.5) * 0.15], i * 3);
    }
    this.age = 0;
    this.points.visible = true;
  }

  clear() {
    this.age = Infinity;
    this.points.visible = false;
  }

  update(dt) {
    if (!this.active) {
      this.points.visible = false;
      return;
    }
    this.age += dt;
    for (let i = 0; i < this.count * 3; i++) this.pos[i] += this.vel[i] * dt;
    for (let i = 1; i < this.count * 3; i += 3) this.vel[i] *= 0.985; // slows as it drifts up
    this.points.geometry.attributes.position.needsUpdate = true;
    const k = this.age / this.life;
    this.points.material.opacity = 0.6 * Math.min(1, k * 5) * (1 - k);
  }
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Live seismograph panel (state.samples: Float32Array of recent values, ~±1). */
function createSeismograph() {
  return createPanel(1.0, 0.56, (ctx, w, h, state) => {
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, 32);
    ctx.fillStyle = 'rgba(16, 12, 10, 0.85)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255, 222, 185, 0.35)';
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = `700 52px ${FONT}`;
    ctx.fillText(MARSQUAKE.ui.seismograph, 40, 60);
    ctx.textAlign = 'right';
    ctx.font = `500 34px ${FONT}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText(MARSQUAKE.ui.illustrative, w - 40, 62);

    const left = 40;
    const right = w - 40;
    const mid = 320;
    const half = 190;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, mid);
    ctx.lineTo(right, mid);
    ctx.stroke();

    const s = state.samples;
    if (!s) return;
    ctx.strokeStyle = '#f2a65a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i < s.length; i++) {
      const x = left + ((right - left) * i) / (s.length - 1);
      const y = mid - Math.max(-1, Math.min(1, s[i])) * half;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });
}

/** Half-circle cutaway of Mars with crust, mantle and liquid core. */
function createInsideMars() {
  const L = MARSQUAKE.layers;
  return createPanel(1.2, 0.72, (ctx, w, h) => {
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, 36);
    ctx.fillStyle = 'rgba(16, 12, 10, 0.85)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255, 222, 185, 0.35)';
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `700 60px ${FONT}`;
    ctx.fillText(MARSQUAKE.ui.insideMars, 44, 70);

    // Drawing proportions only (core radius ≈ 54% of the planet's); crust thickened to be visible.
    const cx = 300;
    const cy = h - 60;
    const R = 260;
    const crust = 12;
    const coreR = R * 0.54;
    const half = (r, color) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };
    half(R, '#b8693d'); // crust
    half(R - crust, '#cf4f26'); // mantle
    half(coreR, '#f0b247'); // liquid core

    // Labels with leader lines.
    const lx = 610;
    const label = (text, y, px, py, color) => {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(lx - 16, y);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `600 40px ${FONT}`;
      ctx.fillText(text, lx, y);
    };
    const at = (r, deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy - r * Math.sin((deg * Math.PI) / 180)];
    label(L.crust.text, 200, ...at(R - crust / 2, 55), '#b8693d');
    label(L.mantle.text, 320, ...at(R * 0.78, 35), '#cf4f26');
    label(L.core.text, 440, ...at(coreR * 0.5, 20), '#f0b247');
  });
}
