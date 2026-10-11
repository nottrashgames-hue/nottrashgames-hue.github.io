/*
  Models for the newer throwables (throwables.js): a dodgeball, a banana peel, a time bomb and
  the airstrike's smoke flare. Same conventions as the others: built standing up along +Y from
  the origin, userData.len the length (for lying one down).
*/
import * as THREE from 'three';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
let M = null;
const mats = () => (M ||= {
  ball: std(0xd8261c, { roughness: 0.75 }),
  seam: std(0x7a120c, { roughness: 0.8 }),
  peel: std(0xf2d22e, { roughness: 0.55 }),
  peelIn: std(0xf7efc8, { roughness: 0.9, side: THREE.DoubleSide }),
  tip: std(0x3a2a14, { roughness: 0.9 }),
  pipe: std(0x6a5a3c, { roughness: 0.7 }),
  tape: std(0x222326, { roughness: 0.9 }),
  clock: std(0xd8d8d0, { roughness: 0.4 }),
  wire: std(0xc81e1e, { roughness: 0.5 }),
  wire2: std(0x1e6ec8, { roughness: 0.5 }),
  led: new THREE.MeshBasicMaterial({ color: 0xff2010 }),
  flare: std(0xb01818, { roughness: 0.5 }),
  cap: std(0x1c1c1e, { roughness: 0.5, metalness: 0.3 }),
});
const shade = (g) => { g.traverse((c) => { if (c.isMesh) c.castShadow = true; }); return g; };

export function buildDodgeball() {
  const m = mats(), g = new THREE.Group();
  const r = 0.11;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), m.ball);
  ball.position.y = r;
  const seam = new THREE.Mesh(new THREE.TorusGeometry(r * 1.005, 0.004, 5, 32), m.seam);
  seam.position.y = r;
  const seam2 = seam.clone();
  seam2.rotation.y = Math.PI / 2;
  g.add(ball, seam, seam2);
  g.userData.len = r * 2;
  g.userData.r = r;
  return shade(g);
}

/** A banana peel: three floppy yellow flaps round a stalk (lies flat: meant to be seen from above). */
export function buildBanana() {
  const m = mats(), g = new THREE.Group();
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.05, 6), m.tip);
  stalk.position.y = 0.035;
  g.add(stalk);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const flap = new THREE.Group();
    // a long, narrow, curved-over strip: yellow outside, cream inside
    const geo = new THREE.SphereGeometry(0.1, 10, 6, -0.32, 0.64, 0, Math.PI / 2);
    const out = new THREE.Mesh(geo, m.peel);
    const inn = new THREE.Mesh(geo, m.peelIn);
    inn.scale.setScalar(0.97);
    out.scale.set(1, 0.35, 0.55);
    inn.scale.set(0.97, 0.33, 0.53);
    flap.add(out, inn);
    flap.rotation.set(0, a, 0);
    flap.position.y = 0.012;
    g.add(flap);
  }
  // (thrown it tumbles; at rest it lies stalk up)
  g.userData.len = 0.05;
  g.userData.flat = true;
  return shade(g);
}

/** A time bomb: three taped pipes, a clock face, wires, a blinking light (userData.led). */
export function buildTimeBomb() {
  const m = mats(), g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.2, 10), m.pipe);
    p.rotation.z = Math.PI / 2;
    p.position.set(0, 0.03, (i - 1) * 0.058);
    g.add(p);
  }
  for (const x of [-0.06, 0.06]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.066, 0.18), m.tape);
    t.position.set(x, 0.03, 0);
    g.add(t);
  }
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 16), m.clock);
  face.position.set(0, 0.068, 0);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, 0.028), m.tape);
  hand.position.set(0, 0.076, -0.01);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), m.led);
  led.position.set(0.055, 0.07, 0.05);
  const w1 = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.003, 4, 10, Math.PI), m.wire);
  w1.position.set(-0.03, 0.065, 0.05);
  const w2 = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.003, 4, 10, Math.PI), m.wire2);
  w2.position.set(0.02, 0.065, -0.05);
  g.add(face, hand, led, w1, w2);
  g.userData.led = led;
  g.userData.hand = hand;
  g.userData.len = 0.07;
  g.userData.flat = true;
  return shade(g);
}

/** The airstrike marker: a red smoke flare with a black cap (userData.nozzle: where the smoke comes out). */
export function buildFlare() {
  const m = mats(), g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 12), m.flare);
  body.position.y = 0.1;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.03, 12), m.cap);
  cap.position.y = 0.215;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0225, 0.0225, 0.02, 12), std(0xf0f0f0));
  band.position.y = 0.06;
  g.add(body, cap, band);
  g.userData.nozzle = new THREE.Vector3(0, 0.23, 0);
  g.userData.len = 0.23;
  return shade(g);
}
