import * as THREE from 'three';

/*
  The medical x-ray body (scanner.js): a stylised standard body in an A-pose, built out of the
  same part frames the characters use (pelvis, spine, chest, head = the neck, thigh/shin/foot,
  upper/fore with the hand on the end), so a wound recorded in a part's local frame lands on the
  same spot here. A faint glassy shell, a light-grey skeleton (every bone its own pickable
  group, named), colour-coded organs and red/blue vessels.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

const VERT = `
varying vec3 vN; varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform vec3 c; uniform float a, f, base, fa;
varying vec3 vN; varying vec3 vV;
void main() {
  float d = abs(dot(normalize(vN), normalize(vV)));
  float r = pow(1.0 - d, 2.0);
  gl_FragColor = vec4(c * (base + (1.0 - base) * d + f * r), clamp(a + fa * r, 0.0, 1.0));
}`;
/** Unlit view-facing shading with a glowing rim (no scene lights needed). */
export function xmat(hex, o = {}) {
  const a = o.a ?? 1;
  const see = a < 1 || o.fa;
  const m = new THREE.ShaderMaterial({
    uniforms: { c: { value: new THREE.Color(hex) }, a: { value: a }, f: { value: o.f ?? 0.4 }, base: { value: o.base ?? 0.5 }, fa: { value: o.fa ?? 0 } },
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: !!see, depthWrite: o.dw ?? !see, depthTest: o.dt ?? true,
    blending: o.add ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  m.userData.base = new THREE.Color(hex);
  return m;
}

const SPH = new THREE.SphereGeometry(1, 10, 8);
const SPH_LO = new THREE.SphereGeometry(1, 8, 6);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const _d = V();
function cap(m, a, b, r, seg = 6) {
  const len = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(1e-4, len), 2, seg), m);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(V(0, 1, 0), _d.subVectors(b, a).normalize());
  return mesh;
}
function sph(m, c, r, rot = null, geo = SPH) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.copy(c); mesh.scale.copy(r);
  if (rot) mesh.rotation.set(...rot);
  return mesh;
}
function box(m, c, s, rot = null) {
  const mesh = new THREE.Mesh(BOX, m);
  mesh.position.copy(c); mesh.scale.copy(s);
  if (rot) mesh.rotation.set(...rot);
  return mesh;
}
function tube(m, pts, r, seg = 5) {
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(6, pts.length * 4), r, seg, false), m);
}

const ORD = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth'];
const FINGER = ['thumb', 'index finger', 'middle finger', 'ring finger', 'little finger'];
const TOE = ['big toe', 'second toe', 'third toe', 'fourth toe', 'little toe'];

export const COL = {
  bone: 0xdfe3ea, spine: 0x46e6f0, shell: 0x9fe8ff,
  artery: 0xff3347, vein: 0x3d6dff,
};

export function buildXray() {
  const root = new THREE.Group();
  const inner = new THREE.Group();          // model space: metres, feet on y = 0, +x = the body's left, +z = front
  root.add(inner);
  const P = {};
  const g = (name, parent, pos, rz = 0) => {
    const o = new THREE.Group();
    o.position.set(...pos); o.rotation.z = rz;
    parent.add(o);
    if (name) P[name] = o;
    return o;
  };
  g('pelvis', inner, [0, 0.97, 0]);
  g('spine', P.pelvis, [0, 0.1, 0]);
  g('chest', P.spine, [0, 0.2, 0]);
  g('head', P.chest, [0, 0.255, -0.005]);   // (the character's "head" part is its neck group)
  const skull = g(null, P.head, [0, 0.09, 0.005]);
  const sides = [[1, 'L'], [-1, 'R']];
  for (const [s, n] of sides) {
    g('thigh' + n, P.pelvis, [s * 0.088, -0.055, 0], s * 0.07);
    g('shin' + n, P['thigh' + n], [0, -0.44, 0]);
    g('foot' + n, P['shin' + n], [0, -0.43, 0], -s * 0.07);
    g('upper' + n, P.chest, [s * 0.185, 0.2, -0.015], s * 0.42);
    g('fore' + n, P['upper' + n], [0, -0.29, 0], -s * 0.05);
  }

  const bones = [], organs = {}, vessels = {};
  /** One named bone: build(m) returns its meshes. cls 'multi': one of a run (ribs, vertebrae). */
  const B = (name, sub, parent, ids, build, o = {}) => {
    const m = xmat(o.col ?? COL.bone, { a: o.a ?? 1, f: o.f ?? 0.35, base: 0.55, fa: o.a < 1 ? 0.4 : 0 });
    const grp = new THREE.Group();
    for (const mesh of [].concat(build(m))) grp.add(mesh);
    parent.add(grp);
    grp.userData = { bone: true, name, sub, ids, cls: o.cls || 'one', mat: m, r: o.r ?? 0.012, f0: o.f ?? 0.35 };
    bones.push(grp);
    return grp;
  };
  const O = (key, parent, mesh) => { parent.add(mesh); organs[key] = mesh; mesh.renderOrder = 2; return mesh; };
  const orgMat = (hex) => xmat(hex, { a: 0.42, fa: 0.4, f: 0.5, base: 0.6 });
  const vesMat = (art) => xmat(art ? COL.artery : COL.vein, { a: 0.85, f: 0.6, base: 0.7, dw: false });
  const Ves = (key, parent, art, pts, r = 0.0045) => {
    const mesh = tube(vesMat(art), pts, r, 4);
    mesh.renderOrder = 1;
    parent.add(mesh);
    (vessels[key] ||= []).push(mesh);
    return mesh;
  };
  const LR = (s) => (s > 0 ? 'left' : 'right');

  // ---------------- head ----------------
  const eye = xmat(0x05070a, { base: 1, f: 0 });
  B('Cranium', 'Skull', skull, ['skull'], (m) => [
    sph(m, V(0, 0.1, 0.004), V(0.068, 0.082, 0.082)),
    sph(eye, V(0.027, 0.098, 0.07), V(0.016, 0.014, 0.012)),
    sph(eye, V(-0.027, 0.098, 0.07), V(0.016, 0.014, 0.012)),
    sph(m, V(0, 0.07, 0.078), V(0.01, 0.016, 0.008)),
  ], { a: 0.55, r: 0.06 });
  B('Mandible', 'Jawbone', skull, ['skull'], (m) => tube(m, [
    V(0.054, 0.075, -0.005), V(0.05, 0.035, 0.03), V(0.028, 0.014, 0.068), V(0, 0.008, 0.082),
    V(-0.028, 0.014, 0.068), V(-0.05, 0.035, 0.03), V(-0.054, 0.075, -0.005)], 0.008), { r: 0.01 });
  O('brain', skull, sph(orgMat(0xd9b48a), V(0, 0.132, -0.006), V(0.056, 0.046, 0.066)));

  // ---------------- neck ----------------
  for (let i = 0; i < 7; i++) {
    const y = 0.1 - i * 0.017;
    const extra = i === 0 ? ' (atlas)' : i === 1 ? ' (axis)' : '';
    B('C' + (i + 1) + ' vertebra' + extra, 'Cervical spine - neck', P.head, ['cervical'], (m) => [
      box(m, V(0, y, -0.014), V(0.03, 0.011, 0.024)),
      box(m, V(0, y, -0.03), V(0.008, 0.008, 0.016)),
    ], { col: COL.spine, f: 0.9, cls: 'multi', r: 0.012 });
  }
  O('thyroid', P.head, sph(orgMat(0xff9a3c), V(0, 0.025, 0.03), V(0.022, 0.016, 0.011)));
  O('trachea', P.head, cap(orgMat(0xff9a3c), V(0, -0.02, 0.022), V(0, 0.075, 0.024), 0.008));
  for (const [s, n] of sides) {
    Ves('carotid' + n, P.head, true, [V(s * 0.024, -0.03, 0.02), V(s * 0.028, 0.04, 0.02), V(s * 0.03, 0.1, 0.018)]);
    Ves('jugular' + n, P.head, false, [V(s * 0.038, -0.03, 0.01), V(s * 0.04, 0.04, 0.01), V(s * 0.042, 0.1, 0.006)]);
  }

  // ---------------- chest ----------------
  for (let i = 0; i < 12; i++) {
    const y = 0.245 - i * 0.0225;
    B('T' + (i + 1) + ' vertebra', 'Thoracic spine - upper back', P.chest, ['thoracic'], (m) => [
      box(m, V(0, y, -0.066), V(0.032, 0.015, 0.028)),
      box(m, V(0, y - 0.003, -0.086), V(0.008, 0.01, 0.018), [0.4, 0, 0]),
    ], { col: COL.spine, f: 0.9, cls: 'multi' });
  }
  for (const [s] of sides) {
    for (let i = 0; i < 12; i++) {
      const yb = 0.232 - i * 0.021, yf = yb - 0.035 - i * 0.004;
      const sx = 0.07 + 0.065 * Math.sin(Math.min(1, (i + 1) / 8) * Math.PI / 2);
      const rz = 0.08 + 0.01 * Math.min(1, i / 6);
      const end = i < 7 ? Math.PI - 0.28 : i < 10 ? Math.PI - 0.5 : Math.PI * 0.55;
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const a = 0.28 + (end - 0.28) * (k / 8);
        pts.push(V(s * sx * Math.sin(a), yb + (yf - yb) * (a / Math.PI), 0.012 - rz * Math.cos(a)));
      }
      const kind = i < 7 ? 'True rib' : i < 10 ? 'False rib' : 'Floating rib';
      B(ORD[i] + ' rib (' + LR(s) + ')', kind, P.chest, ['ribs'], (m) => tube(m, pts, 0.0055, 4), { cls: 'multi', r: 0.008 });
    }
    B('Clavicle (' + LR(s) + ')', 'Collarbone', P.chest, [], (m) => tube(m, [V(s * 0.02, 0.236, 0.086), V(s * 0.09, 0.246, 0.072), V(s * 0.175, 0.252, 0.0)], 0.0065), { r: 0.009 });
    B('Scapula (' + LR(s) + ')', 'Shoulder blade', P.chest, [], (m) => [
      sph(m, V(s * 0.1, 0.165, -0.088), V(0.045, 0.06, 0.008), [0.15, 0, s * 0.18]),
      cap(m, V(s * 0.07, 0.2, -0.094), V(s * 0.17, 0.215, -0.04), 0.006),
    ], { r: 0.02 });
  }
  B('Sternum', 'Breastbone', P.chest, ['ribs'], (m) => [
    box(m, V(0, 0.2, 0.094), V(0.04, 0.05, 0.01), [-0.12, 0, 0]),
    box(m, V(0, 0.125, 0.098), V(0.028, 0.11, 0.01), [-0.12, 0, 0]),
    box(m, V(0, 0.06, 0.104), V(0.012, 0.025, 0.008), [-0.12, 0, 0]),
  ], { cls: 'multi', r: 0.015 });
  O('lungL', P.chest, sph(orgMat(0x9a6cff), V(0.072, 0.1, -0.008), V(0.058, 0.11, 0.068)));
  O('lungR', P.chest, sph(orgMat(0x4f8dff), V(-0.075, 0.1, -0.008), V(0.062, 0.11, 0.068)));
  O('heart', P.chest, sph(orgMat(0xff5c8a), V(0.022, 0.045, 0.035), V(0.042, 0.052, 0.038), [0, 0, -0.4]));
  O('liver', P.chest, sph(orgMat(0xc8682a), V(-0.06, -0.045, 0.02), V(0.085, 0.045, 0.06), [0, 0, 0.15]));
  O('stomach', P.chest, sph(orgMat(0x5fcf6a), V(0.055, -0.055, 0.035), V(0.05, 0.04, 0.035), [0, 0, -0.3]));
  O('spleen', P.chest, sph(orgMat(0xff8fb0), V(0.1, -0.03, -0.03), V(0.02, 0.035, 0.018)));
  Ves('aorta', P.chest, true, [V(0.012, 0.06, 0.03), V(0.01, 0.13, 0.015), V(0.0, 0.12, -0.03), V(0.0, 0.0, -0.045), V(0.0, -0.2, -0.045), V(0.0, -0.28, -0.04)], 0.007);
  Ves('cava', P.chest, false, [V(-0.022, 0.16, 0.02), V(-0.025, 0.06, 0.01), V(-0.025, -0.1, -0.03), V(-0.022, -0.28, -0.035)], 0.0065);
  for (const [s, n] of sides) {
    Ves('subclavian' + n, P.chest, true, [V(s * 0.012, 0.13, 0.015), V(s * 0.06, 0.2, 0.01), V(s * 0.15, 0.205, -0.01), V(s * 0.185, 0.19, -0.015)]);
    Ves('subvein' + n, P.chest, false, [V(-0.02, 0.165, 0.025), V(s * 0.07, 0.215, 0.02), V(s * 0.15, 0.22, 0.0), V(s * 0.185, 0.205, -0.005)]);
    Ves('pulm' + n, P.chest, false, [V(0.02, 0.06, 0.03), V(s * 0.04, 0.09, 0.02), V(s * 0.07, 0.1, 0.0)], 0.004);
  }

  // ---------------- abdomen (spine part) ----------------
  for (let i = 0; i < 5; i++) {
    const y = 0.17 - i * 0.038;
    B('L' + (i + 1) + ' vertebra', 'Lumbar spine - lower back', P.spine, ['spineMid', 'lumbar'], (m) => [
      box(m, V(0, y, -0.064), V(0.04, 0.026, 0.032)),
      box(m, V(0, y, -0.088), V(0.009, 0.014, 0.02)),
    ], { col: COL.spine, f: 0.9, cls: 'multi', r: 0.016 });
  }
  for (const [s, n] of sides) O('kidney' + n, P.spine, sph(orgMat(0xff8fb0), V(s * 0.055, 0.12, -0.04), V(0.022, 0.034, 0.016), [0, 0, s * 0.2]));

  // ---------------- pelvis ----------------
  B('Sacrum', 'Base of the spine', P.pelvis, ['pelvis', 'lumbar'], (m) => box(m, V(0, -0.005, -0.064), V(0.07, 0.075, 0.022), [0.35, 0, 0]), { col: COL.spine, f: 0.7, cls: 'multi', r: 0.025 });
  B('Coccyx', 'Tailbone', P.pelvis, [], (m) => cap(m, V(0, -0.045, -0.072), V(0, -0.07, -0.055), 0.006), { col: COL.spine, f: 0.7, r: 0.008 });
  for (const [s] of sides) {
    B('Hip bone (' + LR(s) + ')', 'Ilium, ischium and pubis', P.pelvis, ['pelvis'], (m) => [
      sph(m, V(s * 0.085, 0.03, -0.012), V(0.052, 0.06, 0.016), [0.1, s * 0.55, s * -0.2]),
      tube(m, [V(s * 0.1, -0.015, 0.0), V(s * 0.085, -0.06, 0.02), V(s * 0.045, -0.075, 0.045), V(s * 0.01, -0.065, 0.055)], 0.011),
      tube(m, [V(s * 0.085, -0.06, 0.02), V(s * 0.06, -0.09, -0.01), V(s * 0.04, -0.075, 0.035)], 0.008),
    ], { r: 0.02 });
  }
  {
    // small intestine: coiled loops through the belly
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60, a = t * Math.PI * 10;
      pts.push(V(Math.cos(a) * 0.08 * (0.45 + 0.55 * Math.abs(Math.sin(t * 7))), 0.17 - t * 0.17, 0.04 + Math.sin(a) * 0.022));
    }
    O('guts', P.pelvis, tube(orgMat(0x7ff0cf), pts, 0.011, 5));
    // large intestine framing it
    O('colon', P.pelvis, tube(orgMat(0x5fd9b8), [V(-0.1, 0.0, 0.03), V(-0.11, 0.2, 0.04), V(0, 0.22, 0.05), V(0.11, 0.2, 0.04), V(0.1, 0.0, 0.03), V(0.03, -0.03, 0.0)], 0.016, 5));
  }
  O('bladder', P.pelvis, sph(orgMat(0xd9b38a), V(0, -0.05, 0.05), V(0.03, 0.025, 0.025)));
  for (const [s, n] of sides) {
    Ves('iliac' + n, P.pelvis, true, [V(0, 0.1, -0.04), V(s * 0.04, 0.02, -0.01), V(s * 0.075, -0.05, 0.02)]);
    Ves('iliacv' + n, P.pelvis, false, [V(-0.015, 0.1, -0.03), V(s * 0.03, 0.02, 0.0), V(s * 0.065, -0.05, 0.03)]);
  }

  // ---------------- legs ----------------
  for (const [s, n] of sides) {
    const T = P['thigh' + n], S = P['shin' + n], F = P['foot' + n];
    B('Femur (' + LR(s) + ')', 'Thigh bone', T, ['femur' + n], (m) => [
      sph(m, V(-s * 0.012, 0.0, 0), V(0.02, 0.02, 0.02)),
      cap(m, V(-s * 0.01, -0.002, 0), V(s * 0.012, -0.05, 0), 0.011),
      cap(m, V(s * 0.01, -0.05, 0), V(0, -0.41, 0.004), 0.013),
      sph(m, V(0, -0.42, 0), V(0.028, 0.02, 0.024)),
    ], { r: 0.018 });
    B('Patella (' + LR(s) + ')', 'Kneecap', T, [], (m) => sph(m, V(0, -0.43, 0.035), V(0.02, 0.022, 0.009)), { r: 0.02 });
    B('Tibia (' + LR(s) + ')', 'Shinbone', S, ['tibia' + n], (m) => [
      sph(m, V(0, -0.012, 0.004), V(0.03, 0.014, 0.026)),
      cap(m, V(0, -0.02, 0.008), V(0, -0.405, 0.004), 0.013),
      sph(m, V(-s * 0.016, -0.415, 0.002), V(0.012, 0.014, 0.012)),
    ], { r: 0.016 });
    B('Fibula (' + LR(s) + ')', 'Calf bone', S, ['tibia' + n], (m) => [
      cap(m, V(s * 0.026, -0.03, -0.006), V(s * 0.022, -0.41, -0.006), 0.0065),
      sph(m, V(s * 0.024, -0.42, -0.006), V(0.009, 0.013, 0.009)),
    ], { r: 0.01 });
    Ves('femoral' + n, T, true, [V(-s * 0.02, -0.02, 0.024), V(-s * 0.02, -0.15, 0.02), V(-s * 0.008, -0.32, 0.0), V(0, -0.43, -0.022)], 0.0055);
    Ves('femvein' + n, T, false, [V(-s * 0.034, -0.02, 0.02), V(-s * 0.032, -0.15, 0.014), V(-s * 0.018, -0.32, -0.006), V(-s * 0.008, -0.43, -0.026)], 0.0055);
    Ves('popliteal' + n, S, true, [V(0, 0.0, -0.022), V(0.002, -0.2, -0.02), V(0, -0.41, -0.012)], 0.0045);
    Ves('tibvein' + n, S, false, [V(-s * 0.01, 0.0, -0.026), V(-s * 0.01, -0.2, -0.024), V(-s * 0.012, -0.41, -0.014)], 0.0045);
    // foot: ankle at the origin, the sole 0.075 down, toes toward +z
    B('Talus (' + LR(s) + ')', 'Ankle bone', F, ['tibia' + n], (m) => sph(m, V(0, -0.02, 0.005), V(0.017, 0.013, 0.022)), { r: 0.015 });
    B('Calcaneus (' + LR(s) + ')', 'Heel bone', F, [], (m) => sph(m, V(0, -0.048, -0.028), V(0.018, 0.02, 0.032), [0.3, 0, 0]), { r: 0.018 });
    B('Navicular (' + LR(s) + ')', 'Tarsal bone, instep', F, [], (m) => sph(m, V(-s * 0.012, -0.03, 0.033), V(0.013, 0.011, 0.01)), { r: 0.011 });
    B('Cuboid (' + LR(s) + ')', 'Tarsal bone, outer foot', F, [], (m) => box(m, V(s * 0.018, -0.05, 0.035), V(0.018, 0.016, 0.022)), { r: 0.011 });
    B('Cuneiform bones (' + LR(s) + ')', 'Tarsal bones, mid-foot', F, [], (m) => [-0.02, -0.008, 0.004].map((x) => box(m, V(s * x, -0.04, 0.05), V(0.01, 0.016, 0.018))), { r: 0.01 });
    for (let t = 0; t < 5; t++) {
      const x = s * (-0.022 + t * 0.012), big = t === 0;
      const y0 = -0.042 - t * 0.003, z0 = 0.06 - t * 0.004, z1 = 0.125 - t * 0.008;
      B(ORD[t] + ' metatarsal (' + LR(s) + ')', 'Foot bone, ' + TOE[t], F, [], (m) => cap(m, V(x, y0, z0), V(x * 1.15, -0.064, z1), big ? 0.0075 : 0.0048), { r: 0.008 });
      const lens = big ? [0.026, 0.02] : [0.018, 0.011, 0.009];
      const names = big ? ['Proximal', 'Distal'] : ['Proximal', 'Middle', 'Distal'];
      let z = z1 + 0.004;
      lens.forEach((L, k) => {
        const a = V(x * 1.15, -0.066, z), b = V(x * 1.15, -0.068, z + L);
        B(names[k] + ' phalanx (' + LR(s) + ')', 'Toe bone, ' + TOE[t], F, [], (m) => cap(m, a, b, big ? 0.0065 : 0.0042), { r: 0.006 });
        z += L + 0.003;
      });
    }
  }

  // ---------------- arms ----------------
  for (const [s, n] of sides) {
    const U = P['upper' + n], Fo = P['fore' + n];
    B('Humerus (' + LR(s) + ')', 'Upper arm bone', U, ['humerus' + n], (m) => [
      sph(m, V(0, -0.006, 0), V(0.02, 0.02, 0.02)),
      cap(m, V(0, -0.02, 0), V(0, -0.27, 0), 0.0115),
      sph(m, V(0, -0.28, 0), V(0.022, 0.012, 0.014)),
    ], { r: 0.016 });
    B('Radius (' + LR(s) + ')', 'Forearm bone, thumb side', Fo, ['forearm' + n], (m) => cap(m, V(0, -0.015, 0.01), V(0, -0.25, 0.013), 0.0085), { r: 0.011 });
    B('Ulna (' + LR(s) + ')', 'Forearm bone, little-finger side', Fo, ['forearm' + n], (m) => [
      cap(m, V(0, 0.012, -0.01), V(0, -0.25, -0.012), 0.0078),
      sph(m, V(0, 0.012, -0.012), V(0.01, 0.012, 0.01)),
    ], { r: 0.011 });
    Ves('brachial' + n, U, true, [V(-s * 0.016, -0.0, 0.008), V(-s * 0.016, -0.14, 0.01), V(-s * 0.01, -0.28, 0.012)], 0.004);
    Ves('basilic' + n, U, false, [V(-s * 0.026, -0.0, -0.002), V(-s * 0.026, -0.14, 0.0), V(-s * 0.02, -0.28, 0.004)], 0.004);
    Ves('radial' + n, Fo, true, [V(0, -0.01, 0.014), V(0.004, -0.13, 0.022), V(0.002, -0.25, 0.022)], 0.0035);
    Ves('ulnar' + n, Fo, true, [V(0, -0.01, 0.0), V(0.004, -0.13, -0.018), V(0.002, -0.25, -0.02)], 0.0035);
    Ves('cephalic' + n, Fo, false, [V(0.012, -0.01, 0.01), V(0.014, -0.13, 0.016), V(0.012, -0.25, 0.016)], 0.0035);
    // hand: the wrist at y -0.26, the palm's width along z (thumb toward +z)
    const CARP = [['Scaphoid', 0.016, -0.268], ['Lunate', 0.005, -0.268], ['Triquetrum', -0.006, -0.268], ['Pisiform', -0.016, -0.266],
      ['Trapezium', 0.019, -0.282], ['Trapezoid', 0.009, -0.283], ['Capitate', -0.001, -0.284], ['Hamate', -0.012, -0.283]];
    for (const [nm, z, y] of CARP) B(nm + ' (' + LR(s) + ')', 'Carpal bone, wrist', Fo, [], (m) => sph(m, V(0, y, z), V(0.006, 0.006, 0.0055)), { r: 0.006 });
    for (let f = 0; f < 5; f++) {
      const thumb = f === 0;
      const z = thumb ? 0.02 : 0.014 - (f - 1) * 0.0095;
      const a = thumb ? V(0, -0.288, 0.02) : V(0, -0.292, z);
      const dir = thumb ? V(0, -0.62, 0.78).normalize() : V(0, -1, -(f - 2.5) * 0.04).normalize();
      const mlen = thumb ? 0.034 : 0.058 - Math.abs(f - 2) * 0.004;
      const b = a.clone().addScaledVector(dir, mlen);
      B(ORD[f] + ' metacarpal (' + LR(s) + ')', 'Hand bone, ' + FINGER[f], Fo, [], (m) => cap(m, a, b, 0.0045), { r: 0.006 });
      const lens = thumb ? [0.024, 0.02] : [0.03 - Math.abs(f - 2) * 0.002, 0.02 - Math.abs(f - 2) * 0.0015, 0.016];
      const names = thumb ? ['Proximal', 'Distal'] : ['Proximal', 'Middle', 'Distal'];
      let p = b.clone().addScaledVector(dir, 0.003);
      lens.forEach((L, k) => {
        const p0 = p.clone(), p1 = p.clone().addScaledVector(dir, L);
        B(names[k] + ' phalanx (' + LR(s) + ')', 'Finger bone, ' + FINGER[f], Fo, [], (m) => cap(m, p0, p1, 0.0038 - k * 0.0003), { r: 0.005 });
        p = p1.addScaledVector(dir, 0.003);
      });
    }
  }

  // ---------------- the glassy outer body ----------------
  const shell = xmat(COL.shell, { a: 0.025, fa: 0.55, f: 1.2, base: 0.3, add: true, dw: false });
  const shells = [
    sph(shell, V(0, 0.095, 0.012), V(0.088, 0.112, 0.102), null, SPH_LO), // (skull)
  ];
  skull.add(shells[0]);
  const add = (parent, mesh) => { parent.add(mesh); shells.push(mesh); };
  add(P.head, cap(shell, V(0, -0.02, 0), V(0, 0.1, 0.005), 0.05, 6));
  add(P.chest, sph(shell, V(0, 0.12, 0.0), V(0.175, 0.17, 0.115), null, SPH_LO));
  add(P.spine, sph(shell, V(0, 0.08, 0.008), V(0.145, 0.15, 0.105), null, SPH_LO));
  add(P.pelvis, sph(shell, V(0, -0.005, 0), V(0.165, 0.115, 0.115), null, SPH_LO));
  for (const [s, n] of sides) {
    add(P['upper' + n], cap(shell, V(0, 0.01, 0), V(0, -0.29, 0), 0.046, 6));
    add(P['fore' + n], cap(shell, V(0, 0, 0), V(0, -0.255, 0), 0.036, 6));
    add(P['fore' + n], sph(shell, V(0, -0.32, 0.004), V(0.016, 0.065, 0.036), null, SPH_LO));
    add(P['thigh' + n], cap(shell, V(0, 0.0, 0), V(0, -0.44, 0), 0.074, 6));
    add(P['shin' + n], cap(shell, V(0, 0, 0), V(0, -0.43, 0), 0.05, 6));
    add(P['foot' + n], sph(shell, V(0, -0.045, 0.055), V(0.042, 0.032, 0.12), null, SPH_LO));
  }
  for (const m of shells) m.renderOrder = 3;

  // sample points on every bone (model space), for picking and for what a wound path passes near
  inner.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(inner.matrixWorld).invert();
  const _p = V(), _m = new THREE.Matrix4();
  for (const b of bones) {
    const pts = [];
    b.traverse((o) => {
      if (!o.isMesh || o.material !== b.userData.mat) return;
      _m.multiplyMatrices(inv, o.matrixWorld);
      const pos = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 24));
      for (let i = 0; i < pos.count; i += step) pts.push(_p.fromBufferAttribute(pos, i).applyMatrix4(_m).clone());
    });
    b.userData.pts = pts;
    const c = V();
    for (const p of pts) c.add(p);
    b.userData.center = c.multiplyScalar(1 / Math.max(1, pts.length));
  }
  return { root, inner, parts: P, bones, organs, vessels, shells };
}
