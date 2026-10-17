import * as THREE from 'three';
import { Sliceable } from './Sliceable.js';

/*
  Sliceable things to place in the sandbox (Place objects): one of each tissue the slicer knows,
  each a single real mesh on a real rigid body - cut them as often as their settings allow.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const mat = (color, rough = 0.8, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

export const TARGETS = {
  log:   { label: 'Log', geo: () => new THREE.CylinderGeometry(0.13, 0.14, 0.9, 18, 3).rotateZ(Math.PI / 2), mat: () => mat(0x6b4a2b, 0.95),
    mass: 14, s: { tissue: 'wood', maxCuts: 6 }, h: 0.14 },
  meat:  { label: 'Meat', geo: () => new THREE.CapsuleGeometry(0.11, 0.42, 6, 14).rotateZ(Math.PI / 2), mat: () => mat(0xc0605a, 0.55),
    mass: 8, s: { tissue: 'flesh', maxCuts: 8 }, h: 0.11 },
  sack:  { label: 'Sack', geo: () => new THREE.SphereGeometry(0.22, 18, 12).scale(1, 1.3, 0.8), mat: () => mat(0xb59b6a, 1),
    mass: 5, s: { tissue: 'cloth', maxCuts: 5 }, h: 0.29 },
  plate: { label: 'Steel plate', geo: () => new THREE.BoxGeometry(0.5, 0.012, 0.4, 4, 1, 4), mat: () => mat(0x8c9399, 0.35, 0.85),
    mass: 9, s: { tissue: 'armor', maxCuts: 2, minCutVelocity: 18 }, h: 0.006 },
};

/** Put a target of kind at world point (on the ground), facing yaw. Returns its mesh. */
export function placeTarget(pieces, kind, point, yaw = 0) {
  const T = TARGETS[kind];
  if (!T) return null;
  const geo = T.geo();
  geo.clearGroups(); // (one material: the primitives' own end-cap groups would point past it)
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  const p = point.clone().add(V(0, T.h + 0.02, 0));
  const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw);
  const piece = pieces.spawn(geo, [T.mat()], p, q, V(1, 1, 1), T.mass);
  piece.keep = true; // (placed, not cut off anything: no lifetime, not counted in the cap)
  Sliceable.attach(piece.mesh, T.s, piece.body);
  return piece.mesh;
}
