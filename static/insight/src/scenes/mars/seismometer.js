import * as THREE from 'three';

// Approximate dimensions of SEIS's Wind and Thermal Shield (WTS) as deployed on Mars.
const DOME_RADIUS = 0.36; // ~0.72 m across the dome
const DOME_HEIGHT = 0.34;
const SKIRT_RADIUS = 0.48; // chain-mail skirt flares out to ~0.96 m on the ground
const BAND_HEIGHT = 0.07;

/**
 * SEIS seismometer under its Wind and Thermal Shield: a white dome on a short band,
 * a bronze chain-mail / thermal-blanket skirt draped onto the ground, and the
 * grapple fixture on top that the robotic arm used to place it.
 * Origin is at ground level, centred under the dome.
 */
export function createSeismometer() {
  const group = new THREE.Group();
  group.name = 'SEIS';

  // --- Dome ---------------------------------------------------------------
  // Lathe profile from the rim up to the apex (ordered bottom → top for outward normals).
  const profile = [new THREE.Vector2(DOME_RADIUS, BAND_HEIGHT - 0.01)];
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const a = (Math.PI / 2) * (1 - i / steps); // π/2 at the rim → 0 at the apex
    profile.push(
      new THREE.Vector2(
        Math.max(DOME_RADIUS * Math.sin(a), 0.0001),
        BAND_HEIGHT + (DOME_HEIGHT - BAND_HEIGHT) * Math.cos(a) ** 0.9
      )
    );
  }
  const dome = new THREE.Mesh(
    new THREE.LatheGeometry(profile, 64),
    new THREE.MeshStandardMaterial({ color: 0xefebe4, roughness: 0.45, metalness: 0.12 })
  );
  dome.name = 'WTS_dome';

  // Thin reinforcing ring where the dome meets the band.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(DOME_RADIUS + 0.004, 0.008, 8, 64),
    new THREE.MeshStandardMaterial({ color: 0xd9d4cc, roughness: 0.5, metalness: 0.3 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = BAND_HEIGHT;

  // --- Skirt (chain mail + thermal blanket) -------------------------------
  const skirtGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(SKIRT_RADIUS, 0.004),
      new THREE.Vector2(SKIRT_RADIUS * 0.93, 0.02),
      new THREE.Vector2(DOME_RADIUS * 1.04, BAND_HEIGHT * 0.75),
      new THREE.Vector2(DOME_RADIUS * 1.0, BAND_HEIGHT),
    ],
    72
  );
  // Irregular, draped hem: wobble the radius by angle, strongest at the ground.
  const pos = skirtGeo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const theta = Math.atan2(v.z, v.x);
    const t = 1 - v.y / BAND_HEIGHT; // 1 at the hem, 0 at the top
    const wobble = 1 + t * (0.05 * Math.sin(theta * 7) + 0.025 * Math.sin(theta * 13 + 1.3));
    pos.setXYZ(i, v.x * wobble, Math.max(0.002, v.y + t * 0.006 * Math.sin(theta * 11)), v.z * wobble);
  }
  skirtGeo.computeVertexNormals();
  const skirt = new THREE.Mesh(
    skirtGeo,
    new THREE.MeshStandardMaterial({
      color: 0x8f6b43,
      roughness: 0.6,
      metalness: 0.6,
      side: THREE.DoubleSide,
    })
  );
  skirt.name = 'WTS_skirt';

  // --- Grapple fixture on top ---------------------------------------------
  const fixtureMat = new THREE.MeshStandardMaterial({ color: 0xb8b4ad, roughness: 0.4, metalness: 0.7 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.05, 16), fixtureMat);
  post.position.y = DOME_HEIGHT + 0.02;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.032, 16, 12), fixtureMat);
  knob.position.y = DOME_HEIGHT + 0.06;

  for (const mesh of [dome, ring, skirt, post, knob]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** Radius of the seismometer's footprint on the ground, for keep-out tests. */
export const SEISMOMETER_FOOTPRINT = SKIRT_RADIUS * 1.1;

/**
 * Tether from the seismometer to the lander: lies on the ground, passes the
 * load-shunt box, then rises to the deck edge.
 */
export function createTether(start, end) {
  const group = new THREE.Group();
  group.name = 'SEIS_tether';

  const groundY = 0.014; // tube radius 0.01 → just resting on the soil
  const toLander = new THREE.Vector3().subVectors(end, start).setY(0);
  const len = toLander.length();
  const dir = toLander.clone().normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  const at = (t, offset) =>
    new THREE.Vector3().copy(start).addScaledVector(dir, len * t).addScaledVector(side, offset).setY(groundY);

  const guide = new THREE.CatmullRomCurve3([
    at(0, 0),
    at(0.25, 0.12),
    at(0.5, -0.08),
    at(0.75, 0.06),
    at(0.9, 0),
    new THREE.Vector3().copy(end).setY(THREE.MathUtils.lerp(groundY, end.y, 0.45)),
    end.clone(),
  ], false, 'centripetal');
  // Densely resample and clamp to the ground so the bend up to the deck never dips into the soil.
  const curve = new THREE.CatmullRomCurve3(
    guide.getSpacedPoints(120).map((p) => p.setY(Math.max(p.y, groundY)))
  );
  const tether = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 96, 0.01, 6, false),
    new THREE.MeshStandardMaterial({ color: 0x3a332d, roughness: 0.7, metalness: 0.2 })
  );
  tether.castShadow = true;
  tether.receiveShadow = true;

  // Load shunt assembly: small box partway along the tether.
  const lsa = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.05, 0.09),
    new THREE.MeshStandardMaterial({ color: 0xa8a39b, roughness: 0.5, metalness: 0.5 })
  );
  const lsaPos = curve.getPoint(0.4);
  lsa.position.set(lsaPos.x, 0.025, lsaPos.z);
  lsa.lookAt(curve.getPoint(0.42).setY(0.025));
  lsa.castShadow = true;
  lsa.receiveShadow = true;

  group.add(tether, lsa);
  return group;
}
