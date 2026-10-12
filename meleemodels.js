import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/*
  Melee weapon meshes. Every weapon's frame: origin at the centre of the (right) hand's grip,
  +Y along the shaft toward the business end, +Z the striking side (the machete's edge).
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const mesh = (geo, mat, parent) => {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
};

export function buildBat() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0xc89a5e, roughness: 0.45 });
  const tape = new THREE.MeshStandardMaterial({ color: 0x1d1d20, roughness: 0.9 });
  // turned profile (radius, y): knob, thin handle, long taper into the barrel, rounded end
  const prof = [
    [0, -0.155], [0.026, -0.153], [0.031, -0.145], [0.03, -0.135], [0.016, -0.128], [0.0135, -0.1],
    [0.0135, 0.08], [0.016, 0.2], [0.024, 0.33], [0.031, 0.45], [0.034, 0.56], [0.034, 0.65],
    [0.031, 0.675], [0.022, 0.69], [0, 0.695],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  mesh(new THREE.LatheGeometry(prof, 20), wood, g);
  // grip tape over the handle
  const t = mesh(new THREE.CylinderGeometry(0.0148, 0.0148, 0.2, 16, 1, true), tape, g);
  t.position.y = -0.025;
  return g;
}

export function buildCrowbar() {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0x8e1f1a, roughness: 0.5, metalness: 0.4 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.85 });
  const R = 0.0115;
  // straight hex bar
  const bar = mesh(new THREE.CylinderGeometry(R, R, 0.5, 6), paint, g);
  bar.position.y = 0.11;
  // the gooseneck: a tight hook curling back over the striking side
  const hook = new THREE.CatmullRomCurve3([
    V(0, 0.36, 0), V(0, 0.43, 0.005), V(0, 0.475, -0.02), V(0, 0.49, -0.06), V(0, 0.475, -0.095), V(0, 0.445, -0.11),
  ]);
  mesh(new THREE.TubeGeometry(hook, 24, R, 6), paint, g);
  // the claw at the end of the hook: flattened, split steel
  const claw = mesh(new THREE.BoxGeometry(0.03, 0.035, 0.008), steel, g);
  claw.position.set(0, 0.432, -0.114);
  claw.rotation.x = 0.5;
  // the other end: a flat chisel with a slight bend
  const chisel = mesh(new THREE.BoxGeometry(0.026, 0.05, 0.007), steel, g);
  chisel.position.set(0, -0.155, 0.006);
  chisel.rotation.x = -0.25;
  return g;
}

export function buildMachete() {
  const g = new THREE.Group();
  const blade = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.28, metalness: 0.9 });
  const edgeM = new THREE.MeshStandardMaterial({ color: 0xe6e9ec, roughness: 0.15, metalness: 1 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.8 });
  // blade outline in the (z, y) plane: straight spine, belly swelling toward the tip
  const s = new THREE.Shape();
  s.moveTo(-0.012, 0.07);
  s.lineTo(-0.013, 0.47);
  s.quadraticCurveTo(-0.012, 0.535, 0.012, 0.55);
  s.quadraticCurveTo(0.04, 0.5, 0.042, 0.4);
  s.lineTo(0.034, 0.07);
  s.lineTo(-0.012, 0.07);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.0035, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.002, bevelSegments: 1, curveSegments: 10 });
  geo.rotateY(-Math.PI / 2); // shape x -> +z, extrusion -> -x
  geo.translate(0.00175, 0, 0);
  mesh(geo, blade, g);
  // bright honed strip along the edge
  const edge = mesh(new THREE.BoxGeometry(0.0012, 0.3, 0.006), edgeM, g);
  edge.position.set(0, 0.24, 0.037);
  edge.rotation.x = 0.02;
  // handle scales + guard
  const h = mesh(new THREE.CapsuleGeometry(0.015, 0.12, 4, 10), grip, g);
  h.scale.set(0.75, 1, 1.15);
  h.position.set(0, -0.01, 0.004);
  const guard = mesh(new THREE.BoxGeometry(0.02, 0.012, 0.056), grip, g);
  guard.position.set(0, 0.066, 0.01);
  return g;
}

/**
 * A two-handed longsword: a long hand-and-a-half grip, a straight cross guard, and a
 * double-edged blade tapering to the point (edges on +Z and -Z, a fuller down the middle).
 * The right hand sits just under the guard, the left below it toward the pommel.
 */
export function buildLongsword() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xc3c8ce, roughness: 0.22, metalness: 0.95 });
  const edgeM = new THREE.MeshStandardMaterial({ color: 0xeef1f4, roughness: 0.1, metalness: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.4, metalness: 0.8 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x3b2417, roughness: 0.85 });
  // blade outline in the (z, y) plane: parallel edges most of the way, then a long point
  const W = 0.024, y0 = 0.075, y1 = 0.83, tip = 1.02;
  const s = new THREE.Shape();
  s.moveTo(-W, y0);
  s.lineTo(-W * 0.86, y1);
  s.quadraticCurveTo(-W * 0.55, 0.95, 0, tip);
  s.quadraticCurveTo(W * 0.55, 0.95, W * 0.86, y1);
  s.lineTo(W, y0);
  s.lineTo(-W, y0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.003, bevelEnabled: true, bevelThickness: 0.0016, bevelSize: 0.0035, bevelSegments: 1, curveSegments: 10 });
  geo.rotateY(-Math.PI / 2); // shape x -> +z, extrusion -> -x
  geo.translate(0.0015, 0, 0);
  mesh(geo, steel, g);
  // honed strips along both edges
  for (const z of [1, -1]) {
    const e = mesh(new THREE.BoxGeometry(0.0012, y1 - y0, 0.004), edgeM, g);
    e.position.set(0, (y0 + y1) / 2, z * (W - 0.0005));
  }
  // the fuller: a darker groove down the first two thirds, both faces
  for (const x of [1, -1]) {
    const f = mesh(new THREE.BoxGeometry(0.0008, 0.52, 0.009), dark, g);
    f.position.set(x * 0.0034, 0.37, 0);
  }
  // cross guard, with a little flare at the quillon ends
  const guard = mesh(new THREE.BoxGeometry(0.02, 0.018, 0.2), dark, g);
  guard.position.y = 0.06;
  for (const z of [1, -1]) {
    const k = mesh(new THREE.SphereGeometry(0.012, 10, 8), dark, g);
    k.position.set(0, 0.06, z * 0.1);
  }
  // long leather grip (room for both hands), then the pommel
  const grip = mesh(new THREE.CylinderGeometry(0.0145, 0.016, 0.25, 14), leather, g);
  grip.position.y = -0.07;
  const pom = mesh(new THREE.SphereGeometry(0.024, 14, 10), dark, g);
  pom.position.y = -0.21;
  pom.scale.set(0.8, 1, 1);
  return g;
}

// ---- tools and blades ----
const hickory = () => new THREE.MeshStandardMaterial({ color: 0xb58a55, roughness: 0.55 });
const iron = () => new THREE.MeshStandardMaterial({ color: 0x5b5f64, roughness: 0.45, metalness: 0.8 });
const bright = () => new THREE.MeshStandardMaterial({ color: 0xd9dde1, roughness: 0.15, metalness: 1 });
/** A turned wooden handle from y0 to y1, radius r (a touch fatter toward the swell at the butt). */
function handle(g, y0, y1, r, mat) {
  const h = mesh(new THREE.CylinderGeometry(r, r * 1.2, y1 - y0, 12), mat, g);
  h.scale.set(0.8, 1, 1);
  h.position.y = (y0 + y1) / 2;
  const k = mesh(new THREE.SphereGeometry(r * 1.25, 10, 8), mat, g);
  k.scale.set(0.8, 0.6, 1);
  k.position.y = y0;
  return h;
}
/** An axe bit in the (z, y) plane: from the eye out to a flared edge on +z, x-thick. */
function bit(g, mat, y, z0, z1, h0, h1, t) {
  const s = new THREE.Shape();
  s.moveTo(z0, y - h0 / 2);
  s.lineTo(z1, y - h1 / 2 - 0.012);
  s.quadraticCurveTo(z1 + 0.012, y, z1, y + h1 / 2);
  s.lineTo(z0, y + h0 / 2);
  s.lineTo(z0, y - h0 / 2);
  const geo = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: true, bevelThickness: t * 0.3, bevelSize: 0.002, bevelSegments: 1, curveSegments: 8 });
  geo.rotateY(-Math.PI / 2);
  geo.translate(t / 2, 0, 0);
  return mesh(geo, mat, g);
}

/** Two-handed sledgehammer: a long hickory handle, a heavy double-faced steel head. */
export function buildSledge() {
  const g = new THREE.Group();
  handle(g, -0.16, 0.66, 0.016, hickory());
  const head = mesh(new THREE.BoxGeometry(0.055, 0.065, 0.2), iron(), g);
  head.position.y = 0.66;
  for (const z of [1, -1]) {
    const f = mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.012, 14), bright(), g);
    f.rotation.x = Math.PI / 2;
    f.position.set(0, 0.66, z * 0.104);
  }
  const grip = mesh(new THREE.CylinderGeometry(0.0172, 0.0195, 0.16, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.85 }), g);
  grip.position.y = -0.06;
  return g;
}

/** Claw hammer: face on the striking side (+Z), the split claw curling back behind. */
export function buildClawHammer() {
  const g = new THREE.Group();
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1e1f22, roughness: 0.9 });
  handle(g, -0.1, 0.24, 0.013, new THREE.MeshStandardMaterial({ color: 0x2f5fa8, roughness: 0.5 }));
  const grip = mesh(new THREE.CylinderGeometry(0.0145, 0.0165, 0.13, 12), rubber, g);
  grip.scale.set(0.85, 1, 1);
  grip.position.y = -0.03;
  const steel = iron();
  const neck = mesh(new THREE.BoxGeometry(0.026, 0.036, 0.06), steel, g);
  neck.position.set(0, 0.245, 0.012);
  const face = mesh(new THREE.CylinderGeometry(0.016, 0.014, 0.04, 14), bright(), g);
  face.rotation.x = Math.PI / 2;
  face.position.set(0, 0.245, 0.058);
  const claw = new THREE.CatmullRomCurve3([V(0, 0.245, -0.015), V(0, 0.25, -0.05), V(0, 0.238, -0.085), V(0, 0.215, -0.105)]);
  for (const x of [0.006, -0.006]) {
    const c = mesh(new THREE.TubeGeometry(claw, 12, 0.007, 6), steel, g);
    c.position.x = x;
  }
  return g;
}

/** Hunting knife: a clip-point blade (edge +Z), brass guard, stacked-leather handle. */
export function buildHuntingKnife() {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(-0.01, 0.055);
  s.lineTo(-0.011, 0.19);
  s.lineTo(-0.002, 0.215);       // the clip
  s.lineTo(0.004, 0.25);         // point
  s.quadraticCurveTo(0.02, 0.2, 0.018, 0.12);
  s.lineTo(0.016, 0.055);
  s.lineTo(-0.01, 0.055);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.003, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0015, bevelSegments: 1, curveSegments: 8 });
  geo.rotateY(-Math.PI / 2);
  geo.translate(0.0015, 0, 0);
  mesh(geo, new THREE.MeshStandardMaterial({ color: 0xc0c5ca, roughness: 0.22, metalness: 0.95 }), g);
  const edge = mesh(new THREE.BoxGeometry(0.001, 0.11, 0.004), bright(), g);
  edge.position.set(0, 0.13, 0.0175);
  const guard = mesh(new THREE.BoxGeometry(0.016, 0.01, 0.05), new THREE.MeshStandardMaterial({ color: 0xb08d3c, roughness: 0.3, metalness: 0.9 }), g);
  guard.position.set(0, 0.05, 0.003);
  const leather = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.75 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c1c10, roughness: 0.8 });
  for (let i = 0; i < 8; i++) {
    const r = mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.0125, 12), i % 3 === 2 ? dark : leather, g);
    r.scale.set(0.75, 1, 1.05);
    r.position.set(0, 0.04 - i * 0.0125, 0.003);
  }
  const pom = mesh(new THREE.SphereGeometry(0.013, 10, 8), new THREE.MeshStandardMaterial({ color: 0xb08d3c, roughness: 0.3, metalness: 0.9 }), g);
  pom.scale.set(0.75, 0.6, 1);
  pom.position.set(0, -0.062, 0.003);
  return g;
}

/** Hatchet: a short handle, a wedge head with the bit on +Z and a flat poll behind. */
export function buildHatchet() {
  const g = new THREE.Group();
  handle(g, -0.1, 0.3, 0.0135, hickory());
  const steel = iron();
  const eye = mesh(new THREE.BoxGeometry(0.026, 0.05, 0.035), steel, g);
  eye.position.set(0, 0.28, 0);
  const poll = mesh(new THREE.BoxGeometry(0.026, 0.036, 0.02), steel, g);
  poll.position.set(0, 0.28, -0.026);
  bit(g, steel, 0.28, 0.016, 0.085, 0.045, 0.085, 0.01);
  const edge = mesh(new THREE.BoxGeometry(0.002, 0.08, 0.005), bright(), g);
  edge.position.set(0, 0.28, 0.089);
  return g;
}

/** Two-handed fire axe: long red-and-yellow handle, a broad bit (+Z) and a spike behind. */
export function buildFireAxe() {
  const g = new THREE.Group();
  handle(g, -0.2, 0.74, 0.016, new THREE.MeshStandardMaterial({ color: 0xd3a93a, roughness: 0.45 }));
  const red = new THREE.MeshStandardMaterial({ color: 0xb3201b, roughness: 0.4, metalness: 0.45 });
  const eye = mesh(new THREE.BoxGeometry(0.032, 0.07, 0.045), red, g);
  eye.position.set(0, 0.7, 0);
  bit(g, red, 0.7, 0.02, 0.13, 0.06, 0.13, 0.011);
  const edge = mesh(new THREE.BoxGeometry(0.002, 0.125, 0.012), bright(), g);
  edge.position.set(0, 0.7, 0.13);
  // the pick
  const spike = mesh(new THREE.ConeGeometry(0.016, 0.11, 4), red, g);
  spike.rotation.x = -Math.PI / 2;
  spike.scale.set(0.7, 1, 1);
  spike.position.set(0, 0.7, -0.075);
  return g;
}

/** Two-handed spear: a long ash shaft, a leaf blade (edges +Z and -Z) and a butt cap. */
export function buildSpear() {
  const g = new THREE.Group();
  const ash = new THREE.MeshStandardMaterial({ color: 0x9c7a50, roughness: 0.6 });
  const shaft = mesh(new THREE.CylinderGeometry(0.014, 0.016, 1.55, 10), ash, g);
  shaft.position.y = 0.42;
  const steel = new THREE.MeshStandardMaterial({ color: 0xbfc4c9, roughness: 0.25, metalness: 0.95 });
  // the socket, then the leaf
  const sock = mesh(new THREE.CylinderGeometry(0.013, 0.018, 0.09, 10), steel, g);
  sock.position.y = 1.24;
  const s = new THREE.Shape();
  s.moveTo(-0.01, 1.28);
  s.quadraticCurveTo(-0.034, 1.36, -0.014, 1.46);
  s.lineTo(0, 1.52);
  s.lineTo(0.014, 1.46);
  s.quadraticCurveTo(0.034, 1.36, 0.01, 1.28);
  s.lineTo(-0.01, 1.28);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 8 });
  geo.rotateY(-Math.PI / 2);
  geo.translate(0.002, 0, 0);
  mesh(geo, steel, g);
  const wrap = mesh(new THREE.CylinderGeometry(0.0175, 0.0175, 0.34, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.9 }), g);
  wrap.position.y = -0.02;
  const cap = mesh(new THREE.CylinderGeometry(0.017, 0.012, 0.04, 10), steel, g);
  cap.position.y = -0.35;
  return g;
}

/** A wooden ruler (half a metre): flat, printed with inch and centimetre marks, held at the 0 end. */
export function buildRuler() {
  const g = new THREE.Group();
  const L = 0.5, W = 0.036, T = 0.005, y0 = -0.05;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 1024;
  const x = c.getContext('2d');
  x.fillStyle = '#e2c27f'; x.fillRect(0, 0, 64, 1024);
  x.fillStyle = 'rgba(120,80,30,0.12)';
  for (let i = 0; i < 40; i++) x.fillRect(0, Math.random() * 1024, 64, 1 + Math.random() * 3);
  x.fillStyle = '#2a1c10'; x.font = 'bold 10px sans-serif'; x.textAlign = 'center';
  // centimetres down one edge, millimetre ticks between
  for (let mm = 0; mm <= 500; mm++) {
    const py = 1024 - (mm / 500) * 1024;
    const len = mm % 10 === 0 ? 16 : mm % 5 === 0 ? 11 : 6;
    if (mm % 2 === 0 || mm % 10 === 0) x.fillRect(0, py - 0.5, len, 1);
    if (mm % 10 === 0 && mm > 0 && mm < 500) { x.save(); x.translate(24, py); x.rotate(-Math.PI / 2); x.fillText(String(mm / 10), 0, 4); x.restore(); }
  }
  // inches on the other
  for (let q = 0; q <= 19.6 * 4; q++) {
    const py = 1024 - (q * 6.35 / 500) * 1024;
    x.fillRect(64 - (q % 4 === 0 ? 14 : q % 2 === 0 ? 9 : 5), py - 0.5, 14, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const wood = new THREE.MeshStandardMaterial({ color: 0xd8b878, roughness: 0.6 });
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 });
  // (box faces: +x, -x, +y, -y, +z, -z; the flats face +-x so a swing comes down edge-on along +Z)
  const m = mesh(new THREE.BoxGeometry(T, L, W), [face, face, wood, wood, wood, wood], g);
  m.position.y = y0 + L / 2;
  // a hole at the far end, for the hook
  const hole = mesh(new THREE.CylinderGeometry(0.0035, 0.0035, T + 0.0004, 10), new THREE.MeshStandardMaterial({ color: 0x241810, roughness: 1 }), g);
  hole.rotation.z = Math.PI / 2;
  hole.position.y = y0 + L - 0.015;
  return g;
}

/** Hand saw: a wooden pistol-grip handle, a tapered steel blade along +Y, the teeth on +Z. */
export const SAW_TEETH = { y0: 0.075, y1: 0.56, z0: 0.105, z1: 0.06 }; // the toothed edge (heel -> toe)
export function buildHandSaw() {
  const g = new THREE.Group();
  const T = SAW_TEETH;
  // the plate: spine straight along -Z of the grip, toothed edge tapering toward the toe
  const s = new THREE.Shape();
  s.moveTo(-0.012, 0.06);
  s.lineTo(-0.008, T.y1);
  s.lineTo(T.z1, T.y1);
  s.lineTo(T.z0, T.y0);
  s.lineTo(T.z0, 0.06);
  s.lineTo(-0.012, 0.06);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.0012, bevelEnabled: false });
  geo.rotateY(-Math.PI / 2);
  geo.translate(0.0006, 0, 0);
  mesh(geo, new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.3, metalness: 0.92, side: THREE.DoubleSide }), g);
  // the teeth: a row of little alternately-set points along the edge
  const tooth = new THREE.ConeGeometry(0.0035, 0.008, 3);
  tooth.rotateX(Math.PI / 2);
  const toothMat = new THREE.MeshStandardMaterial({ color: 0x8d9297, roughness: 0.45, metalness: 0.9 });
  const n = 54;
  const inst = new THREE.InstancedMesh(tooth, toothMat, n);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, y = T.y0 + (T.y1 - T.y0) * t, z = T.z0 + (T.z1 - T.z0) * t;
    M.compose(new THREE.Vector3(i % 2 ? 0.0009 : -0.0009, y, z + 0.003), q, sc);
    inst.setMatrixAt(i, M);
  }
  inst.castShadow = true;
  g.add(inst);
  // handle: an open D of wood - the fist closes round the back bar (the origin), the fingers
  // inside the loop, so the hand stays in sight rather than buried in a slab
  const wood = new THREE.MeshStandardMaterial({ color: 0x9c5a2c, roughness: 0.55 });
  const bar = (len, r) => new THREE.CylinderGeometry(r, r, len, 10);
  const grip = mesh(bar(0.15, 0.014), wood, g);
  grip.scale.set(0.85, 1, 1.1);
  grip.position.set(0, -0.003, 0);
  const top = mesh(bar(0.11, 0.011), wood, g);
  top.rotation.x = Math.PI / 2; top.position.set(0, 0.07, 0.05);
  const bot = mesh(bar(0.1, 0.011), wood, g);
  bot.rotation.x = Math.PI / 2 + 0.25; bot.position.set(0, -0.067, 0.045);
  const front = mesh(bar(0.14, 0.01), wood, g);
  front.rotation.x = 0.12; front.position.set(0, 0.0, 0.1);
  const cap = mesh(new THREE.SphereGeometry(0.016, 10, 8), wood, g);
  cap.scale.set(0.85, 0.8, 1.1); cap.position.set(0, -0.078, 0);
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a14a, roughness: 0.3, metalness: 0.9 });
  for (const [y, z] of [[0.08, 0.1], [0.07, 0.07], [0.09, 0.04]]) {
    const b = mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.008, 10), brass, g);
    b.rotation.z = Math.PI / 2;
    b.position.set(0, y, z);
  }
  return g;
}

/*
  Pencil (PENCIL.glb): loaded once up front, every pencil a copy with its own materials (each
  weapon's blood is drawn into its own). The model is ~1.9 units long, eraser down, point up
  (+Y): scaled to a real pencil (~19 cm), the grip a third of the way up from the eraser.
*/
let PENCIL_SRC = null;
try { PENCIL_SRC = (await new GLTFLoader().loadAsync('PENCIL.glb')).scene; } catch (e) { console.warn('PENCIL.glb failed to load', e); }
export function buildPencil() {
  const g = new THREE.Group();
  if (PENCIL_SRC) {
    const m = PENCIL_SRC.clone(true);
    m.scale.setScalar(0.1);
    m.position.y = -0.036;
    m.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.castShadow = o.receiveShadow = true;
    });
    g.add(m);
  } else {
    // (no model: a plain yellow stick with a dark point)
    const b = mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.17, 6), new THREE.MeshStandardMaterial({ color: 0xe0a020, roughness: 0.5 }), g);
    b.position.y = 0.025;
    const t = mesh(new THREE.ConeGeometry(0.0045, 0.022, 6), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 }), g);
    t.position.y = 0.121;
  }
  return g;
}
