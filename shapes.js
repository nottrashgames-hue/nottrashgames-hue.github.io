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

/** A single smooth head: deformed sphere with jaw, chin, nose, brow and eye sockets. */
export function headGeo() {
  const g = new THREE.SphereGeometry(1, 64, 48);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const bump = (x, y, z, cx, cy, cz, w) => Math.exp(-((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) / (w * w));
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let { x, y, z } = v;
    const front = Math.max(0, z);
    // base cranium proportions
    let sx = 0.079, sy = 0.108, sz = 0.098;
    // jaw: lower half narrows and tapers toward the chin
    if (y < 0) {
      const t = -y;
      sx *= lerp(1, 0.62, t * t);
      sz *= lerp(1, 0.9, t);
      // back of lower skull tucks in toward neck
      if (z < 0) sz *= lerp(1, 0.72, t);
    }
    // slightly flatter sides of face
    let px = x * sx, py = y * sy, pz = z * sz;
    // face plane pushes forward a little
    pz += 0.007 * front * front * (y < 0.4 ? 1 : lerp(1, 0, (y - 0.4) / 0.6));
    // chin
    pz += 0.012 * bump(x, y, z, 0, -0.82, 0.55, 0.3);
    py -= 0.008 * bump(x, y, z, 0, -0.9, 0.4, 0.35);
    // nose
    const nose = bump(x * 1.7, y, z, 0, -0.08, 1, 0.26);
    pz += 0.017 * nose;
    const noseTip = bump(x * 1.4, y, z, 0, -0.25, 1, 0.14);
    pz += 0.006 * noseTip;
    // brow ridge
    pz += 0.007 * bump(x * 0.8, y, z, 0, 0.22, 0.95, 0.22);
    // eye sockets
    for (const s of [1, -1]) {
      pz -= 0.011 * bump(x, y, z, s * 0.36, 0.08, 0.93, 0.17);
      // cheekbones
      px += s * 0.004 * bump(x, y, z, s * 0.75, -0.15, 0.6, 0.3);
      pz += 0.004 * bump(x, y, z, s * 0.55, -0.2, 0.8, 0.25);
    }
    // mouth: slight groove + lips
    pz -= 0.003 * bump(x * 0.7, y, z, 0, -0.52, 0.85, 0.1);
    pz += 0.004 * bump(x * 0.9, y, z, 0, -0.45, 0.88, 0.12);
    pz += 0.0035 * bump(x * 0.9, y, z, 0, -0.6, 0.82, 0.12);
    p.setXYZ(i, px, py, pz);
  }
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const m = mergeVertices(g, 1e-6);
  m.computeVertexNormals();
  return m;
}
