// Served without a build step: style.css is linked from index.html, and the import map in
// index.html points 'three' to vendor/three (see README).
import { tell } from './bridge.js';
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { DesktopControls } from './controls/desktopControls.js';
import { createStartScene } from './scenes/startScene.js';
import { createMarsScene } from './scenes/marsScene.js';
import { Interaction } from './mission/interaction.js';
import { Mission } from './mission/mission.js';

const EYE_HEIGHT = 1.6;

// --- Renderer ---------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // scene is static; scenes request updates when they change
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

// --- Camera + player rig ----------------------------------------------------
// The rig moves through the world; the camera sits inside it.
// Desktop: camera held at eye height. VR: the headset pose drives the camera.
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 500);
camera.position.set(0, EYE_HEIGHT, 0);
const rig = new THREE.Group();
rig.add(camera);

const controls = new DesktopControls(camera, rig, renderer.domElement);
const interaction = new Interaction({ renderer, camera, rig, canvas: renderer.domElement, controls });
let mission = null;

// --- UI ---------------------------------------------------------------------
const startScreen = document.getElementById('start-screen');
const beginBtn = document.getElementById('begin-btn');
const hud = document.getElementById('hud');
const notice = document.getElementById('notice');
const crosshair = document.getElementById('crosshair');

function updateCrosshair() {
  crosshair.hidden = !(marsStarted && controls.look.isLocked && !renderer.xr.isPresenting);
}

function showNotice(msg) {
  notice.textContent = msg;
  notice.hidden = false;
}

// --- Scenes -----------------------------------------------------------------
let current = createStartScene();
current.scene.add(rig);
let marsStarted = false;

function beginMars() {
  if (marsStarted) return;
  marsStarted = true;

  const mars = createMarsScene({ renderer, onNotice: showNotice });
  mars.scene.add(rig); // moves the rig out of the start scene
  rig.position.copy(mars.spawn);
  camera.rotation.set(0, 0, 0); // face -Z, toward the lander
  current = mars;

  startScreen.hidden = true;
  controls.enabled = true;
  if (!renderer.xr.isPresenting) {
    hud.hidden = false;
    controls.lock();
  }

  // Started last: the intro glide takes control of the view until it finishes.
  mission = new Mission({ renderer, camera, rig, controls, mars, interaction });
  mission.start();
  tell('begin');
}

beginBtn.addEventListener('click', beginMars);

controls.look.addEventListener('lock', () => {
  hud.hidden = true;
  updateCrosshair();
});
controls.look.addEventListener('unlock', () => {
  if (marsStarted && !renderer.xr.isPresenting) hud.hidden = false;
  updateCrosshair();
});

// Entering VR from the Start screen goes straight to Mars (HTML UI isn't visible in a headset).
renderer.xr.addEventListener('sessionstart', () => {
  beginMars();
  controls.enabled = false;
  hud.hidden = true;
  updateCrosshair();
  camera.position.set(0, 0, 0); // local-floor reference space supplies real head height
});
renderer.xr.addEventListener('sessionend', () => {
  camera.position.set(0, EYE_HEIGHT, 0);
  controls.enabled = marsStarted;
  if (marsStarted) hud.hidden = false;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Loop -------------------------------------------------------------------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  controls.update(dt);
  // Keep the player standing on the ground (the rig is at foot level).
  if (current.heightAt) rig.position.y = current.heightAt(rig.position.x, rig.position.z);
  current.update(dt, rig.position);
  mission?.update(dt);
  renderer.render(current.scene, camera);
});
