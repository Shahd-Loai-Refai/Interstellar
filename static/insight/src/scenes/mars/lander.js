import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

/**
 * Parts of NASA's model that show SEIS and its shield stowed on the deck. In this
 * scene they are deployed on the ground instead, so the deck copies are hidden.
 */
const DEPLOYED_PARTS = ['SEIS', 'WTS'];

/**
 * Loads NASA's InSight GLB (Draco-compressed), scales it so its widest horizontal
 * extent equals `span` metres, and rests it on the ground centred on the deck.
 * Resolves with { model, deck } where `deck` is the deck's world-space Box3.
 */
export function loadLander({ url, span }) {
  // No decoder path needed: three's DRACOLoader references its bundled, version-matched
  // decoder via import.meta.url, and Vite emits it with the build.
  const draco = new DRACOLoader();
  const loader = new GLTFLoader().setDRACOLoader(draco);

  return loader.loadAsync(url).then(
    (gltf) => {
      draco.dispose();
      const model = gltf.scene;
      model.name = 'InSight';

      for (const name of DEPLOYED_PARTS) {
        const part = model.getObjectByName(name);
        if (part) part.visible = false;
      }

      // In NASA's model the deck node is the parent of panels, legs and arm, so measure
      // only the deck body's own geometry when centring and attaching things to it.
      const deckNode = model.getObjectByName('deck');
      const deckBox = () =>
        deckNode ? ownBox(deckNode, gltf.parser.associations) : new THREE.Box3().setFromObject(model);
      fitToSpan(model, span, deckBox);

      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });

      return { model, deck: deckBox() };
    },
    (err) => {
      draco.dispose();
      throw err;
    }
  );
}

/** World-space box of a glTF node's own mesh primitives, excluding child nodes. */
function ownBox(node, associations) {
  node.updateWorldMatrix(true, false);
  // A multi-primitive glTF mesh becomes a Group whose Mesh children are the primitives;
  // those children are associated with a mesh primitive but not with a glTF node.
  const isOwnPrimitive = (c) => {
    const a = associations.get(c);
    return c.isMesh && a && a.primitives !== undefined && a.nodes === undefined;
  };
  const parts = node.isMesh ? [node] : node.children.filter(isOwnPrimitive);
  if (parts.length === 0) return new THREE.Box3().setFromObject(node);
  const box = new THREE.Box3();
  for (const mesh of parts) {
    mesh.updateWorldMatrix(true, false);
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
  }
  return box;
}

/**
 * Scale uniformly so the widest horizontal extent equals `span` metres, with the lowest
 * point resting on y = 0 and the box returned by `getCentreBox` centred over the origin.
 * Hidden parts are ignored when measuring.
 */
function fitToSpan(object, span, getCentreBox) {
  const visibleBox = () => {
    object.updateMatrixWorld(true);
    const b = new THREE.Box3();
    object.traverseVisible((o) => {
      if (o.isMesh) b.expandByObject(o);
    });
    return b;
  };

  let box = visibleBox();
  const size = box.getSize(new THREE.Vector3());
  const horizontal = Math.max(size.x, size.z);
  if (horizontal > 0) object.scale.multiplyScalar(span / horizontal);

  box = visibleBox();
  object.updateMatrixWorld(true);
  const center = getCentreBox().getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box.min.y;
  object.updateMatrixWorld(true);
}
