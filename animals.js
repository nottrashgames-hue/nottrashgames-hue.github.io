import * as THREE from 'three';

const MAT = {
  black: new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.75 }),
  cream: new THREE.MeshStandardMaterial({ color: 0xd8cbb4, roughness: 0.92 }),
  eye: new THREE.MeshStandardMaterial({ color: 0x090b0c, roughness: 0.25 }),
  nose: new THREE.MeshStandardMaterial({ color: 0x302322, roughness: 0.4 }),
  cat: new THREE.MeshStandardMaterial({ color: 0x8b8277, roughness: 0.9 }),
  dog: new THREE.MeshStandardMaterial({ color: 0xb07b4d, roughness: 0.92 }),
  pink: new THREE.MeshStandardMaterial({ color: 0x9b5b61, roughness: 0.85 }),
};
const sphere = new THREE.SphereGeometry(1, 12, 8);
const legGeo = new THREE.CylinderGeometry(0.045, 0.055, 0.24, 8);

export class Animal {
  constructor(scene, colliders, kind, position) {
    this.scene = scene;
    this.colliders = colliders;
    this.kind = kind;
    this.root = new THREE.Group();
    this.root.position.copy(position);
    this.parts = [];
    this.legs = [];
    this.t = Math.random() * 6;
    this.wait = Math.random() * 2;
    this.target = position.clone();
    this.yaw = Math.random() * Math.PI * 2;
    const fur = MAT[kind], scale = kind === 'cat' ? 0.78 : 1;
    const add = (geo, mat, p, s, parent = this.root) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(...p); m.scale.set(...s); m.castShadow = m.receiveShadow = true;
      parent.add(m); return m;
    };
    add(sphere, fur, [0, 0.31, -0.03], [0.27 * scale, 0.2 * scale, 0.38 * scale]);
    const head = new THREE.Group();
    head.position.set(0, 0.43 * scale, 0.31 * scale);
    this.root.add(head); this.head = head;
    add(sphere, fur, [0, 0, 0], [0.19 * scale, 0.17 * scale, 0.19 * scale], head);
    add(sphere, MAT.cream, [0, -0.07 * scale, 0.105 * scale], [0.125 * scale, 0.085 * scale, 0.12 * scale], head);
    add(sphere, MAT.nose, [0, -0.025 * scale, 0.218 * scale], [0.035 * scale, 0.027 * scale, 0.028 * scale], head);
    for (const side of [-1, 1]) {
      add(sphere, MAT.eye, [side * 0.087 * scale, 0.027 * scale, 0.153 * scale], [0.024 * scale, 0.03 * scale, 0.02 * scale], head);
      if (kind === 'cat') {
        const ear = add(new THREE.ConeGeometry(0.065 * scale, 0.16 * scale, 4), fur, [side * 0.115 * scale, 0.17 * scale, 0], [1, 1, 0.68], head);
        ear.rotation.z = -side * 0.16;
        add(new THREE.ConeGeometry(0.032 * scale, 0.1 * scale, 4), MAT.pink, [side * 0.115 * scale, 0.18 * scale, 0.026 * scale], [1, 1, 0.5], head);
      } else {
        const ear = add(sphere, new THREE.MeshStandardMaterial({ color: 0x68462f, roughness: 0.95 }), [side * 0.17 * scale, 0.025 * scale, -0.035 * scale], [0.085 * scale, 0.14 * scale, 0.085 * scale], head);
        ear.rotation.z = -side * 0.28;
      }
      const leg = add(legGeo, fur, [side * 0.17 * scale, 0.14 * scale, 0.19 * scale], [scale, scale, scale]);
      const hind = add(legGeo, fur, [side * 0.17 * scale, 0.14 * scale, -0.24 * scale], [scale, scale, scale]);
      this.legs.push(leg, hind);
    }
    const tail = new THREE.Group();
    tail.position.set(0, 0.36 * scale, -0.34 * scale); this.root.add(tail); this.tail = tail;
    if (kind === 'cat') {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.14, -0.11), new THREE.Vector3(0, 0.34, -0.16), new THREE.Vector3(0, 0.43, 0.02)]);
      add(new THREE.TubeGeometry(curve, 8, 0.035, 6, false), fur, [0, 0, 0], [1, 1, 1], tail);
    } else {
      add(sphere, fur, [0, 0.11, -0.1], [0.07, 0.16, 0.07], tail);
    }
    scene.add(this.root);
  }

  update(dt) {
    this.t += dt; this.wait -= dt;
    const p = this.root.position;
    if (this.wait <= 0 || p.distanceTo(this.target) < 0.45) {
      const a = Math.random() * Math.PI * 2, r = 1.2 + Math.random() * 3.5;
      this.target.set(p.x + Math.cos(a) * r, p.y, p.z + Math.sin(a) * r);
      this.target.y = this.colliders.groundAt(this.target.x, this.target.z, p.y + 0.8);
      if (this.colliders.blocked(this.target.x, this.target.z, this.target.y + 0.05, 0.25)) this.target.copy(p);
      this.wait = 2 + Math.random() * 3;
    }
    const dx = this.target.x - p.x, dz = this.target.z - p.z, d = Math.hypot(dx, dz);
    const walking = d > 0.18 && this.wait <= 0.35;
    if (walking) {
      const step = Math.min(d, dt * (this.kind === 'cat' ? 0.72 : 0.88));
      p.x += dx / d * step; p.z += dz / d * step;
      this.yaw += Math.atan2(dx, dz) - this.yaw > Math.PI ? -dt * 3 : Math.atan2(dx, dz) - this.yaw < -Math.PI ? dt * 3 : (Math.atan2(dx, dz) - this.yaw) * Math.min(1, dt * 5);
    }
    p.y = this.colliders.groundAt(p.x, p.z, p.y + 0.8);
    this.root.rotation.y = this.yaw;
    const gait = walking ? Math.sin(this.t * 12) * 0.35 : 0;
    this.legs.forEach((leg, i) => { leg.rotation.x = gait * (i % 2 ? -1 : 1); });
    this.tail.rotation.x = Math.sin(this.t * (this.kind === 'cat' ? 2.2 : 8)) * (this.kind === 'cat' ? 0.18 : 0.28);
    this.tail.rotation.z = Math.sin(this.t * 2.8) * 0.12;
    this.head.position.y = (this.kind === 'cat' ? 0.43 : 0.43) + (walking ? Math.abs(gait) * 0.025 : Math.sin(this.t * 2) * 0.008);
  }

  remove() { this.root.removeFromParent(); }
}
