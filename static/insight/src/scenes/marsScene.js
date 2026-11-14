import * as THREE from 'three';
import { createTerrain, terrainHeight } from './mars/terrain.js';
import { createRocks } from './mars/rocks.js';
import { createSky } from './mars/sky.js';
import { createDust } from './mars/dust.js';
import { createSeismometer, createTether, SEISMOMETER_FOOTPRINT } from './mars/seismometer.js';
import { loadLander } from './mars/lander.js';

// --- Look -----------------------------------------------------------------------
const SKY_ZENITH = 0xa8714a; // deeper butterscotch overhead
const SKY_HORIZON = 0xd9aa7a; // hazy, dust-laden horizon (also the fog colour)
const FOG_DENSITY = 0.0045; // ~5% haze at 50 m, ~84% at 300 m
// Afternoon sun, ~38° high, behind and to the left of the player's spawn view.
const SUN_DIRECTION = new THREE.Vector3(-0.55, 0.62, 0.56).normalize();

// --- Layout (metres) --------------------------------------------------------------
const LANDER_SPAN_M = 6; // InSight is ~6 m across with both solar arrays deployed
const DOME_GAP_M = 2; // seismometer sits ~2 m in front of the lander's deck
const EXPECTED_DOME_Z = 3.1; // deck front (~1.1 m) + gap; used to keep rocks clear before the model loads
const SPAWN = new THREE.Vector3(0, 0, 9); // facing the lander (-Z), which faces +Z
/** Where the arm sets the heat probe (HP3) down, front-left of the deck within the arm's reach. */
export const PROBE_SPOT = new THREE.Vector3(-1.05, 0, 1.75);
/** Where the arm later sets the probe's housing aside (inside the rock-free lander footprint). */
export const HOUSING_ASIDE_SPOT = new THREE.Vector3(-1.55, 0, 1.25);
const PROBE_CLEAR_RADIUS = 0.6;

// NASA/JPL-Caltech InSight model, "panels deployed" variant (Draco-compressed GLB).
const MODEL_URL = new URL('../../models/insight.glb', import.meta.url).href;

/**
 * Mars surface at Elysium Planitia: gently rolling terrain, scattered rocks, dusty sky
 * with distance haze, warm sun with soft shadows, NASA's InSight lander and the SEIS
 * seismometer deployed in front of it.
 *
 * @param {{ renderer?: THREE.WebGLRenderer, onNotice?: (msg: string) => void }} [opts]
 */
export function createMarsScene({ renderer, onNotice } = {}) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(SKY_HORIZON, FOG_DENSITY);

  // Shadows are static: re-render the shadow map only when the scene changes (VR performance).
  const requestShadowUpdate = () => {
    if (renderer) renderer.shadowMap.needsUpdate = true;
  };

  // --- Sky + image-based lighting ---------------------------------------------------
  const skyOptions = { sunDirection: SUN_DIRECTION, zenith: SKY_ZENITH, horizon: SKY_HORIZON };
  scene.add(createSky(skyOptions));

  if (renderer) {
    // Bake the sky (with a ground tone below the horizon) into an environment map so the
    // lander's metal and foil pick up believable reflections.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(createSky({ ...skyOptions, groundBlend: 1 }));
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    scene.environmentIntensity = 0.6;
    pmrem.dispose();
  }

  // --- Lights -------------------------------------------------------------------------
  scene.add(new THREE.HemisphereLight(0xe8bb8c, 0x6b3a22, 0.7));

  const sun = new THREE.DirectionalLight(0xffeedd, 2.4);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const extent = 18; // shadowed area around the lander and seismometer
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 5, far: 90 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // --- Ground, rocks, dust -----------------------------------------------------------
  const anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  scene.add(createTerrain({ anisotropy }));

  const isClear = (x, z, size) => {
    if (Math.abs(x) < 3.3 && Math.abs(z) < 1.7 && size > 0.06) return false; // under the lander
    if (Math.hypot(x, z - EXPECTED_DOME_Z) < SEISMOMETER_FOOTPRINT + 0.5 + size) return false; // seismometer
    if (Math.abs(x) < 0.4 && z > 0.8 && z < EXPECTED_DOME_Z) return false; // tether path
    if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 1.2) return false; // where the player starts
    if (Math.hypot(x - PROBE_SPOT.x, z - PROBE_SPOT.z) < PROBE_CLEAR_RADIUS) return false; // heat probe spot
    return true;
  };
  scene.add(createRocks(isClear));

  const dust = createDust();
  scene.add(dust);

  // --- InSight lander + seismometer --------------------------------------------------
  const landerSlot = new THREE.Group();
  landerSlot.name = 'InSightLander';
  scene.add(landerSlot);

  const ready = loadLander({ url: MODEL_URL, span: LANDER_SPAN_M })
    .then(({ model, deck }) => {
      landerSlot.add(model);

      // Seismometer on the ground in front of the deck, tethered back to the deck edge.
      const seis = createSeismometer();
      seis.position.set(0, 0, deck.max.z + DOME_GAP_M);
      const tetherStart = seis.position.clone().add(new THREE.Vector3(0, 0, -SEISMOMETER_FOOTPRINT * 0.85));
      const tetherEnd = new THREE.Vector3(0.1, THREE.MathUtils.lerp(deck.min.y, deck.max.y, 0.3), deck.max.z - 0.03);
      scene.add(seis, createTether(tetherStart, tetherEnd));

      requestShadowUpdate();
      return { model, deck, seismometer: seis };
    })
    .catch((err) => {
      console.error(`Could not load ${MODEL_URL}`, err);
      onNotice?.(
        'The InSight model could not be loaded. Check that public/models/insight.glb exists, and see the browser console for details.'
      );
      throw err;
    });
  ready.catch(() => {}); // handled above; avoid an unhandled-rejection warning

  requestShadowUpdate();

  return {
    scene,
    spawn: SPAWN.clone(),
    heightAt: terrainHeight,
    /** Resolves with { model, deck, seismometer } once the lander is in the scene. */
    ready,
    update(dt, playerPosition) {
      if (playerPosition) dust.userData.update(dt, playerPosition);
    },
  };
}
