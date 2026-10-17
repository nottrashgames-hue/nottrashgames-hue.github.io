import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const lerp = (a, b, t) => a + (b - a) * t;
const cr = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

/**
 * Smooth organic tube along Y. rings: [y, rx, rzFront, rzBack, (zOffset)] ordered top -> bottom.
 * Ring params are spline-interpolated; ends are closed with rounded caps.
 * opts.n = superellipse exponent (2 = ellipse, higher = boxier), opts.caps = [top, bottom] bool.
 */
export function tube(rings, opts = {}) {
  const { seg = 28, sub = 5, n = 2, caps = [true, true], capScale = 0.8 } = opts;
  const R = rings.map((r) => [r[0], r[1], r[2], r[3], r[4] || 0]);
  // spline-sample rings
  const S = [];
  for (let i = 0; i < R.length - 1; i++) {
    const p0 = R[Math.max(0, i - 1)], p1 = R[i], p2 = R[i + 1], p3 = R[Math.min(R.length - 1, i + 2)];
    for (let s = 0; s < sub; s++) {
      const t = s / sub;
      S.push(p1.map((_, k) => (k === 0 ? lerp(p1[0], p2[0], t) : Math.max(1e-4, cr(p0[k], p1[k], p2[k], p3[k], t)))));
    }
  }
  S.push(R[R.length - 1]);
  // rounded caps
  const capRings = (ring, dir) => {
    const out = [];
    const r = Math.max(ring[1], ring[2], ring[3]);
    for (let i = 1; i <= 4; i++) {
      const a = (i / 5) * Math.PI / 2;
      const k = Math.cos(a);
      out.push([ring[0] + dir * Math.sin(a) * r * capScale, ring[1] * k, ring[2] * k, ring[3] * k, ring[4]]);
    }
    return out;
  };
  let all = S;
  if (caps[0]) all = [...capRings(S[0], 1).reverse(), ...all];
  if (caps[1]) all = [...all, ...capRings(S[S.length - 1], -1)];

  const pos = [], idx = [];
  const e = 2 / n;
  for (const [y, rx, rf, rb, oz] of all) {
    for (let j = 0; j < seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const x = rx * Math.sign(c) * Math.abs(c) ** e;
      const z = (s > 0 ? rf : rb) * Math.sign(s) * Math.abs(s) ** e + oz;
      pos.push(x, y, z);
    }
  }
  const rowsN = all.length;
  for (let i = 0; i < rowsN - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + ((j + 1) % seg);
      const c = a + seg, d = b + seg;
      idx.push(a, b, c, b, d, c);
    }
  }
  // poles
  const top = all[0], bot = all[rowsN - 1];
  const ti = pos.length / 3;
  pos.push(0, caps[0] ? top[0] + 0.0005 : top[0], top[4]);
  const bi = ti + 1;
  pos.push(0, caps[1] ? bot[0] - 0.0005 : bot[0], bot[4]);
  for (let j = 0; j < seg; j++) {
    idx.push(ti, (j + 1) % seg, j);
    const base = (rowsN - 1) * seg;
    idx.push(bi, base + j, base + ((j + 1) % seg));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A single smooth head: a deformed sphere sculpted into a face - cranium, temples, jaw angle and
 * chin, brow ridge over deep sockets, the nose (bridge, tip, the wings and nostrils), philtrum,
 * lips and the line between them, cheekbones. Carries a per-vertex 'tint' (an rgb offset the skin
 * material multiplies in: see character.js) for the lips, nostrils, cheeks and eyelids.
 */
export function headGeo({ F = false } = {}) {
  const g = new THREE.SphereGeometry(1, 72, 54);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const bump = (x, y, z, cx, cy, cz, w) => Math.exp(-((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) / (w * w));
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const { x, y, z } = v;
    const front = Math.max(0, z);
    // base cranium proportions
    let sx = 0.079, sy = 0.108, sz = 0.098;
    // jaw: lower half narrows toward the chin, but holds its width back at the jaw's angle
    if (y < 0) {
      const t = -y;
      // (it keeps its width lower down, then rounds under: a jaw, not a point; squarer on men)
      sx *= lerp(1, lerp(F ? 0.62 : 0.69, 0.82, Math.max(0, -z) * 0.5 + 0.25 * (1 - front)), Math.pow(t, F ? 2.2 : 2.6));
      sz *= lerp(1, 0.9, t);
      if (z < 0) sz *= lerp(1, 0.7, t); // (the back of the skull tucks in to the neck)
    }
    // a fuller, rounder crown (not an egg) and back of the head
    if (y > 0) { sz *= 1 + 0.03 * Math.max(0, -z) * y; sx *= 1 + 0.04 * Math.sin(Math.PI * Math.min(1, y * 1.15)); }
    let px = x * sx, py = y * sy, pz = z * sz;
    // face plane pushed forward a little
    pz += 0.007 * front * front * (y < 0.4 ? 1 : lerp(1, 0, (y - 0.4) / 0.6));
    for (const s of [1, -1]) {
      // temples in, cheekbones out, a hollow under them, the jaw's angle
      px -= s * 0.0035 * bump(x, y, z, s * 0.88, 0.32, 0.3, 0.25);
      px += s * 0.0045 * bump(x, y, z, s * 0.78, -0.12, 0.55, 0.26);
      pz += 0.0045 * bump(x, y, z, s * 0.56, -0.16, 0.8, 0.2);
      pz -= 0.0025 * bump(x, y, z, s * 0.58, -0.45, 0.72, 0.16);
      px += s * 0.004 * bump(x, y, z, s * 0.8, -0.62, -0.05, 0.24);
      // eye sockets, under a brow ridge
      pz -= 0.012 * bump(x, y, z, s * 0.37, 0.07, 0.92, 0.16);
      pz += 0.0035 * bump(x, y, z, s * 0.4, 0.27, 0.92, 0.12);
      // the nose's wings and the nostrils tucked in under the tip
      const ala = bump(x, y, z, s * 0.16, -0.36, 0.96, 0.075);
      pz += 0.0065 * ala; px += s * 0.002 * ala;
      pz -= 0.004 * bump(x, y, z, s * 0.075, -0.42, 1, 0.045);
      // mouth corners in
      pz -= 0.0022 * bump(x, y, z, s * 0.29, -0.56, 0.86, 0.06);
      // the folds from nose to mouth
      pz += 0.0016 * bump(x, y, z, s * 0.27, -0.42, 0.88, 0.07);
    }
    // brow ridge and the bridge of the nose between the eyes
    pz += 0.006 * bump(x * 0.75, y, z, 0, 0.25, 0.95, 0.15);
    pz += 0.006 * bump(x * 2.4, y, z, 0, 0.06, 1, 0.16);
    // the nose: a narrow ridge growing out to a rounded tip
    pz += 0.019 * bump(x * 2.3, y, z, 0, -0.2, 1, 0.19);
    pz += 0.006 * bump(x * 1.5, y, z, 0, -0.31, 1, 0.1);
    py += 0.004 * bump(x * 1.5, y, z, 0, -0.37, 1, 0.08); // (the underside lifts)
    // philtrum, upper lip, the mouth line, lower lip, the groove under it
    pz -= 0.0016 * bump(x * 3.2, y, z, 0, -0.47, 0.97, 0.06);
    pz += 0.0055 * bump(x * 0.85, y, z, 0, -0.51, 0.9, 0.065);
    pz -= 0.0055 * bump(x * 0.7, y * 1.6, z, 0, -0.565 * 1.6, 0.88, 0.05);
    pz += 0.005 * bump(x * 0.9, y, z, 0, -0.625, 0.86, 0.06);
    pz -= 0.0025 * bump(x * 0.6, y, z, 0, -0.73, 0.82, 0.06);
    // the chin: forward and down, with a defined front and corners (a man's broader and squarer,
    // a woman's narrower and rounder); the underside flatter, running back to the neck
    pz += 0.0095 * bump(x * (F ? 1.25 : 1), y, z, 0, -0.84, 0.6, 0.2);
    if (!F) for (const s of [1, -1]) pz += 0.0028 * bump(x, y, z, s * 0.2, -0.86, 0.58, 0.11);
    // (a shorter lower face: the chin sits up under the mouth instead of hanging low)
    if (y < -0.55 && z > 0) py += 0.009 * Math.min(1, (-0.55 - y) / 0.3) * Math.min(1, z * 1.6);
    py += 0.007 * bump(x, y, z, 0, -1, 0.05, 0.38);   // (under the jaw, up and in toward the throat)
    pz -= 0.003 * bump(x, y, z, 0, -0.93, 0.2, 0.2);
    // the jawline: a crisp edge from the angle forward to the chin
    for (const s of [1, -1]) {
      const jl = bump(x, y, z, s * 0.62, -0.74, 0.4, 0.2);
      px += s * (F ? 0.0018 : 0.003) * jl;
    }
    p.setXYZ(i, px, py, pz);
  }
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const m = mergeVertices(g, 1e-6);
  m.computeVertexNormals();
  // the tint: reads off the sculpted surface (face-local metres -> back to the unit sphere)
  const q = m.attributes.position, tint = new Float32Array(q.count * 3);
  for (let i = 0; i < q.count; i++) {
    const x = q.getX(i) / 0.079, y = q.getY(i) / 0.108, z = q.getZ(i) / 0.098;
    if (z < 0.3) continue;
    let r = 0, gg = 0, b = 0;
    const add = (k, dr, dg, db) => { r += dr * k; gg += dg * k; b += db * k; };
    // lips: redder, a little darker
    const lips = Math.min(1, bump(x * 0.8, y * 1.3, z, 0, -0.515 * 1.3, z, 0.075) * 1.25 + bump(x * 0.85, y * 1.3, z, 0, -0.62 * 1.3, z, 0.08) * 1.25);
    add(lips, 0.03, -0.24, -0.2);
    // the line between them and the nostrils: shadowed
    add(bump(x * 0.75, y * 1.6, z, 0, -0.565 * 1.6, z, 0.035), -0.3, -0.38, -0.34);
    for (const s of [1, -1]) {
      add(bump(x, y, z, s * 0.075, -0.42, z, 0.04), -0.45, -0.5, -0.48);
      // a flush on the cheeks
      add(bump(x, y, z, s * 0.52, -0.25, z, 0.2), 0.02, -0.07, -0.06);
      // the lids and under the eyes: a touch darker and warmer
      add(bump(x, y, z, s * 0.37, 0.02, z, 0.13), -0.06, -0.1, -0.08);
    }
    // the tip of the nose, a little pink
    add(bump(x * 1.4, y, z, 0, -0.3, z, 0.09), 0.02, -0.05, -0.05);
    tint[i * 3] = r; tint[i * 3 + 1] = gg; tint[i * 3 + 2] = b;
  }
  m.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  return m;
}

let EAR = null;
/** An ear (shared): x out of the head, y up, z forward. A rim round a hollow, the lobe at the bottom. */
export function earGeo() {
  if (EAR) return EAR;
  const g = new THREE.SphereGeometry(1, 24, 18);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // narrower toward the lobe, the top leaning back
    const w = y > 0 ? 1 : lerp(1, 0.62, -y);
    z = z * w - 0.18 * Math.max(0, y) ** 2;
    // the outer face dished in, inside the rim
    const rr = Math.hypot(y * 0.95, z / Math.max(0.4, w));
    if (x > 0) x *= lerp(0.25, 1, Math.min(1, Math.max(0, (rr - 0.55) / 0.35)));
    // thicker at the lobe
    if (y < -0.6) x *= 1.25;
    p.setXYZ(i, x * 0.0075, y * 0.026, z * 0.016);
  }
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  EAR = mergeVertices(g, 1e-6);
  EAR.computeVertexNormals();
  return EAR;
}

let BROW = null;
/** An eyebrow (shared): along x from the nose (-) to the temple (+), arched, thinning outward. */
export function browGeo() {
  if (BROW) return BROW;
  const g = new THREE.SphereGeometry(1, 20, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = (x + 1) / 2;
    const th = lerp(1.25, 0.55, t);
    p.setXYZ(i, x * 0.017, y * 0.0034 * th + 0.0032 * (1 - (x - 0.15) ** 2) - 0.002 * t * t, z * 0.0045 - 0.006 * Math.max(0, x) ** 2);
  }
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  BROW = mergeVertices(g, 1e-6);
  BROW.computeVertexNormals();
  return BROW;
}

let LID = null;
/** An eyelid (shared): a shell over the top of a unit eyeball, its edge across the iris. */
export function lidGeo(upper = true) {
  const g = new THREE.SphereGeometry(1.1, 22, 8, 0, Math.PI * 2, 0, upper ? 1.2 : 0.95);
  if (!upper) g.rotateX(Math.PI);
  return g;
}
