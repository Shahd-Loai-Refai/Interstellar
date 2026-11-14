import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    // Rotation-only view transform: the sky sits at infinity, so it is correct per eye in VR
    // and never shifts as the player walks.
    vec4 p = viewMatrix * vec4(mat3(modelMatrix) * position, 0.0);
    gl_Position = projectionMatrix * vec4(p.xyz, 1.0);
    gl_Position.z = gl_Position.w * 0.9999; // at the far plane
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunColor;
  uniform vec3 uHaloColor;
  uniform float uGroundBlend;
  varying vec3 vDir;

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, 0.0, 1.0);

    // Dusty Martian sky: brighter and hazier towards the horizon.
    vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));

    // Forward scattering by dust: a pale, slightly cool halo around the sun.
    float s = max(dot(d, uSunDir), 0.0);
    col = mix(col, uHaloColor, pow(s, 24.0) * 0.55);
    col += uSunColor * pow(s, 6.0) * 0.12;
    // Sun disc (smaller than from Earth).
    col += uSunColor * smoothstep(0.99990, 0.99996, s) * 4.0;

    // Ground tone below the horizon (only used when baking the environment map).
    col = mix(col, uGround, uGroundBlend * smoothstep(0.0, -0.15, d.y));

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Gradient sky dome with sun and halo. The horizon colour should equal the fog colour
 * so distant terrain melts seamlessly into the sky.
 */
export function createSky({ sunDirection, zenith, horizon, ground = 0x6e4630, groundBlend = 0 }) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: sunDirection.clone().normalize() },
      uZenith: { value: new THREE.Color(zenith) },
      uHorizon: { value: new THREE.Color(horizon) },
      uGround: { value: new THREE.Color(ground) },
      uSunColor: { value: new THREE.Color(0xfff2dc) },
      uHaloColor: { value: new THREE.Color(0xe4e1d8) },
      uGroundBlend: { value: groundBlend },
    },
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });

  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
  sky.name = 'Sky';
  sky.renderOrder = -1000; // drawn first; everything else draws over it
  sky.frustumCulled = false;
  return sky;
}
