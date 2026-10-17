import * as THREE from 'three';

/*
  "You can get in": a glowing ring on the car's door handle (pulsing, brighter once your hand is
  close enough to grab it in VR) and, in VR, a small "Grip to get in" tag over it.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export function label(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(16,16,20,0.78)';
  g.beginPath(); g.roundRect(8, 16, 496, 96, 48); g.fill();
  g.fillStyle = '#ffd65a'; g.font = 'bold 54px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, fog: false, toneMapped: false }));
  s.scale.set(0.44, 0.11, 1);
  s.renderOrder = 999;
  return s;
}

export class DoorHint {
  constructor(scene) {
    this.g = new THREE.Group();
    this.g.visible = false;
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd65a, transparent: true, opacity: 0.85, depthTest: false, fog: false, toneMapped: false });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 8, 32), mat);
    this.ring.renderOrder = 998;
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), mat.clone());
    this.dot.renderOrder = 998;
    this.tag = label('Grip to get in');
    this.tag.position.y = 0.24;
    this.g.add(this.ring, this.dot, this.tag);
    scene.add(this.g);
  }

  /** hint: null, or { car, seat, ready, vr } */
  update(hint) {
    if (!hint) { this.g.visible = false; return; }
    const { car, seat } = hint, S = car.S;
    car.toWorld(seat.side * (S.W / 2 + 0.03), S.motorcycle ? 0.8 : 0.92, seat.z + 0.1, this.g.position);
    // the ring flat against the door: facing out of that side of the car
    const out = V(seat.side, 0, 0).applyQuaternion(car.q);
    this.g.quaternion.setFromUnitVectors(V(0, 0, 1), out);
    const t = performance.now() / 1000, k = hint.ready ? 1.25 + Math.sin(t * 9) * 0.1 : 1 + Math.sin(t * 4) * 0.12;
    this.ring.scale.setScalar(k);
    this.ring.material.color.set(hint.ready ? 0x8dff7a : 0xffd65a);
    this.dot.material.color.set(hint.ready ? 0x8dff7a : 0xffd65a);
    this.tag.visible = !!hint.vr;
    this.g.visible = true;
  }
}
