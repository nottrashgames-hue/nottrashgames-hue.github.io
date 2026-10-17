import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/*
  Two drivable car models (a sedan and a hatchback; the taxi is a yellow sedan with a roof
  sign). The body is one lofted skin: a cross-section (crowned hood, rounded shoulder, side,
  tucked sill) swept along the car through dense stations, so the wheel arches are round, the
  plan view rounds off at the nose and tail, and nothing is a stack of overlapping boxes. The
  greenhouse is a second loft whose quads are sorted into windshield, rear glass, side glass,
  pillars and seals by where they fall - so glass, paint and trim meet edge to edge with no
  coplanar faces. Door shut lines are just thin bands of quads coloured black.

  Car frame: origin on the ground between the axles' midpoint, +Z forward, +Y up, +X is the
  car's left (the driver's side: traffic drives on the right).

  Every part lands in one of a few merged buckets per car (paint, plastic, chrome, glass,
  windshield, lamps, tail lamps) so a detailed car is ~11 draw calls; far away it swaps for a
  single merged vertex-coloured mesh built from the same lofts.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const SPECS = {
  sedan: {
    L: 4.72, W: 1.84, r: 0.33, arch: 0.4, axles: [1.42, -1.36], sill: 0.3, driveY: 0.33,
    // upper edge of the body's side profile, tail to nose (z, y)
    top: [[-2.36, 0.5], [-2.35, 0.72], [-2.28, 0.89], [-2.05, 0.95], [-1.55, 0.97], [-1.05, 0.94], [0.95, 0.92], [1.45, 0.87], [2.0, 0.8], [2.28, 0.72], [2.36, 0.52]],
    // greenhouse: windshield base, roof front, roof back, rear glass base
    ws: [0.95, 0.92], rf: [0.08, 1.43], rb: [-0.92, 1.43], rear: [-1.55, 0.97],
    cabin: [-1.05, 0.95],   // open cabin between these z (doors), solid blocks fore and aft
    doors: [0.95, -0.02, -1.05],
    front: { z: -0.3, y: 0.66 }, back: { z: -0.78, y: 0.64 },
    wheelZ: 0.27, dashZ: 0.52,
  },
  hatch: {
    L: 4.26, W: 1.8, r: 0.34, arch: 0.41, axles: [1.3, -1.28], sill: 0.34, driveY: 0.34,
    top: [[-2.14, 0.52], [-2.13, 0.82], [-2.09, 0.98], [-1.5, 1.0], [-1.35, 0.99], [0.85, 0.98], [1.3, 0.94], [1.8, 0.87], [2.06, 0.79], [2.14, 0.6]],
    ws: [0.85, 0.98], rf: [-0.02, 1.58], rb: [-1.78, 1.57], rear: [-2.07, 1.0],
    cabin: [-1.35, 0.85],
    doors: [0.85, -0.2, -1.3],
    front: { z: -0.38, y: 0.72 }, back: { z: -1.02, y: 0.7 },
    wheelZ: 0.17, dashZ: 0.42,
  },
  truck: {
    L: 5.5, W: 2.0, r: 0.38, arch: 0.45, axles: [1.65, -1.7], sill: 0.35, driveY: 0.36, mass: 2500, pickup: true,
    top: [[-2.75, 0.62], [-2.72, 1.05], [-2.58, 1.22], [-0.95, 1.22], [-0.7, 1.62], [-0.35, 1.95], [0.62, 1.95], [0.9, 1.5], [1.75, 1.2], [2.5, 1.05], [2.75, 0.7]],
    ws: [0.62, 1.5], rf: [0.25, 1.95], rb: [-0.42, 1.95], rear: [-0.9, 1.55], cabin: [-0.42, 0.62],
    doors: [0.62, 0.08, -0.4], front: { z: 0.27, y: 1.15 }, back: { z: -0.12, y: 1.08 }, wheelZ: 0.32, dashZ: 0.48,
  },
  semi: {
    L: 10, W: 2.55, r: 0.49, arch: 0.55, axles: [3.45, -3.0, -4.0], sill: 0.48, driveY: 0.5, mass: 10500, semi: true,
    top: [[-5, 0.9], [-4.9, 3.55], [-4.7, 3.75], [1.55, 3.75], [1.8, 2.85], [2.2, 2.6], [2.8, 2.25], [3.35, 2.05], [4.4, 1.65], [5, 1.1]],
    ws: [3.2, 2.65], rf: [2.95, 3.2], rb: [2.35, 3.2], rear: [1.8, 2.65], cabin: [2.35, 3.2],
    doors: [3.2, 2.75, 2.38], front: { z: 3.0, y: 2.05 }, back: { z: 2.5, y: 2.0 }, wheelZ: 2.85, dashZ: 3.1,
  },
  motorcycle: {
    L: 2.1, W: 0.82, r: 0.31, arch: 0.3, axles: [0.72, -0.7], sill: 0.42, driveY: 0.46, mass: 360, motorcycle: true,
    top: [[-1.05, 0.72], [-0.9, 0.9], [-0.45, 1.0], [0.25, 1.08], [0.78, 1.0], [1.05, 0.76]],
    ws: [0.45, 1.08], rf: [0.32, 1.35], rb: [-0.25, 1.35], rear: [-0.5, 1.0], cabin: [-0.25, 0.32],
    doors: [0.32, 0, -0.25], front: { z: 0.2, y: 0.8 }, back: { z: -0.15, y: 0.78 }, wheelZ: 0.45, dashZ: 0.48,
    wheelC: new THREE.Vector3(0, 1.28, 0.5), wheelN: new THREE.Vector3(0, 0.35, -0.94).normalize(),
    seats: [{ x: 0, z: -0.14, y: 1.0, driver: true, side: 1 }],
  },
};
SPECS.taxi = { ...SPECS.sedan, taxi: true };
SPECS.police = { ...SPECS.sedan, police: true };
for (const S of Object.values(SPECS)) {
  S.hl = S.L / 2;
  S.gx = S.W / 2 - 0.1;           // greenhouse half width (tumblehome)
  S.roof = S.rf[1];
  S.belt = S.ws[1];
  // seats: pelvis positions in the car frame (driver on +X)
  if (!S.motorcycle) S.seats = [
    { x: 0.38, z: S.front.z, y: S.front.y, driver: true, side: 1 },
    { x: -0.38, z: S.front.z, y: S.front.y, side: -1 },
    { x: 0.4, z: S.back.z, y: S.back.y, side: 1, rear: true },
    { x: -0.4, z: S.back.z, y: S.back.y, side: -1, rear: true },
  ];
  S.wheels = S.motorcycle
    ? [{ x: 0, z: S.axles[0], front: true }, { x: 0, z: S.axles[1], front: false }]
    : S.axles.flatMap((az) => [1, -1].map((s) => ({ x: s * (S.W / 2 - 0.17), z: az, front: az > 0 })));
  // steering wheel centre and its face normal (toward the driver)
  if (!S.motorcycle) {
    S.wheelC = V(0.38, S.belt + 0.02, S.wheelZ);
    S.wheelN = V(0, 0.42, -0.9).normalize();
  }
  S.tyreW = 0.22;
  S.rimR = S.r * 0.64;
}

// ---------------------------------------------------------------- the body's shape
const lerpPts = (pts, z) => {
  if (z <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (z <= pts[i][0]) { const [z0, y0] = pts[i - 1], [z1, y1] = pts[i]; return y0 + (y1 - y0) * (z - z0) / (z1 - z0); }
  }
  return pts[pts.length - 1][1];
};
export const topAt = (S, z) => lerpPts(S.top, z);
/** Underside of the body: the sill, tucking up at the ends, round arches over the wheels. */
export function bottomAt(S, z) {
  let y = S.sill;
  const e = Math.abs(z) - (S.hl - 0.2);
  if (e > 0) y += e * 0.25;
  for (const az of S.axles) {
    const d = z - az;
    if (Math.abs(d) < S.arch) y = Math.max(y, S.driveY + Math.sqrt(S.arch * S.arch - d * d));
  }
  return y;
}
/** Half width in plan: the corners round off over the last 0.6 m. */
export function halfW(S, z) {
  const e = Math.max(0, (Math.abs(z) - (S.hl - 0.6)) / 0.6);
  return S.W / 2 * (1 - 0.085 * e * e);
}
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0); return Math.min(a, b) - h * h / (4 * k); };
/** Greenhouse: where it sits on the body, and its top line (rear glass, roof, windshield). */
export const ghBase = (S, z) => topAt(S, z) - 0.012;
export function ghTop(S, z) {
  const zr = S.rear[0], zb = S.rb[0], zf = S.rf[0], zw = S.ws[0];
  z = clamp(z, zr, zw);
  const br = ghBase(S, zr), bw = ghBase(S, zw);
  const rearL = br + (S.roof - br) * (z - zr) / (zb - zr);
  const wsL = S.roof + (bw - S.roof) * (z - zf) / (zw - zf);
  return Math.max(ghBase(S, z), smin(smin(rearL, S.roof, 0.05), wsL, 0.05));
}
/** Greenhouse side at height y (the glass leans in toward the roof). */
export function ghX(S, z, y) {
  const b0 = ghBase(S, z);
  return S.gx + 0.015 - 0.1 * clamp((y - b0) / (S.roof - S.belt), 0, 1);
}
const CROWN = 0.022;

/** Is car-frame point p inside the car's outer skin? */
export function inHull(S, p) {
  const z = p.z;
  if (Math.abs(z) > S.hl + 0.03) return false;
  const ax = Math.abs(p.x);
  if (ax > halfW(S, z) + 0.01) return false;
  if (p.y < bottomAt(S, z) - 0.01) return false;
  const t = topAt(S, z);
  if (p.y < t + CROWN * (1 - (ax / S.W) ** 2)) return true;
  if (z < S.rear[0] || z > S.ws[0]) return false;
  const h = ghTop(S, z);
  return p.y < h + 0.03 && ax < ghX(S, z, p.y) + 0.005;
}
/** Is p in the open cabin (under the roof, between the doors)? */
export function inCabin(S, p) {
  return p.z > S.cabin[0] && p.z < S.cabin[1] && Math.abs(p.x) < S.W / 2 - 0.1 && p.y > S.sill + 0.05 && p.y < S.roof;
}
/** What blood dripping inside the cabin lands on: a seat cushion or the carpet. */
export function cabinFloor(S, x, z) {
  const ax = Math.abs(x);
  if (z > S.front.z - 0.15 && z < S.front.z + 0.37 && ax > 0.12 && ax < 0.64) return S.front.y - 0.085;
  if (z > S.back.z - 0.15 && z < S.back.z + 0.37 && ax < S.gx - 0.06) return S.back.y - 0.085;
  return S.sill + 0.085;
}

// ---------------------------------------------------------------- materials (shared)
const MAT = {};
export function carMats() { return MAT; }
function mats(env) {
  if (MAT.paint && MAT.ready === env) return MAT;
  MAT.ready = env;
  const e = env ? { envMap: env } : {};
  MAT.plastic = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide });
  MAT.chrome = new THREE.MeshStandardMaterial({ color: 0xd6d9dd, roughness: 0.18, metalness: 1, ...e, envMapIntensity: 1.2 });
  MAT.glass = new THREE.MeshStandardMaterial({
    color: 0x0d1418, roughness: 0.05, metalness: 0.3, ...e, envMapIntensity: 1.4,
    transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide,
  });
  MAT.lamp = new THREE.MeshStandardMaterial({ color: 0xfff8e8, emissive: 0xfff2d0, emissiveIntensity: 0.5, roughness: 0.15, metalness: 0.2, ...e });
  MAT.tail = new THREE.MeshStandardMaterial({ color: 0x9a0d0d, emissive: 0x6a0000, emissiveIntensity: 0.6, roughness: 0.2 });
  MAT.brake = new THREE.MeshStandardMaterial({ color: 0xff2a1a, emissive: 0xff1a0a, emissiveIntensity: 2.2, roughness: 0.2 });
  MAT.wheel = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35, ...e, envMapIntensity: 0.6 });
  MAT.lo = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.35, ...e, envMapIntensity: 0.8 });
  MAT.paint = new Map();
  MAT.env = env;
  return MAT;
}
function paintMat(M, color) {
  let m = M.paint.get(color);
  if (!m) {
    // double-sided: the lofted skin is a single sheet, seen from inside the cabin too
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.55, ...(M.env ? { envMap: M.env } : {}), envMapIntensity: 1, side: THREE.DoubleSide });
    M.paint.set(color, m);
  }
  return m;
}

// ---------------------------------------------------------------- geometry helpers
const _c = new THREE.Color();
function colorize(g, color) {
  _c.set(color);
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
/** Non-indexed, position + normal (+ colour) only, so everything merges. */
function prep(g, color) {
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (color !== undefined) colorize(g, color);
  g.clearGroups();
  return g;
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = V(1, 1, 1), _p = V();
function place(g, x, y, z, rx = 0, ry = 0, rz = 0) {
  _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
  return g.applyMatrix4(_m.compose(_p.set(x, y, z), _q, _s));
}
const boxG = (sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz);
const rboxG = (sx, sy, sz, r = 0.03, seg = 2) => new RoundedBoxGeometry(sx, sy, sz, seg, Math.min(r, sx / 2, sy / 2, sz / 2) * 0.999);

/**
 * Stations along the car for a loft between z0 and z1: dense over the arches and at the
 * rounded ends, sparse along the flanks; `must` z's are always included (bucket edges).
 */
function stations(S, z0, z1, must = [], coarse = 1) {
  const step = (z) => {
    for (const az of S.axles) if (Math.abs(z - az) < S.arch + 0.03) return 0.045 * coarse;
    const e = S.hl - Math.abs(z);
    return (e < 0.12 ? 0.03 : e < 0.6 ? 0.08 : 0.16) * coarse;
  };
  const pts = [];
  for (let z = z0; z < z1 - 1e-4; z += step(z)) pts.push([z, false]);
  pts.push([z1, true]); pts[0][1] = true;
  for (const az of S.axles) must = must.concat([az - S.arch, az + S.arch]);
  for (const m of must) if (m > z0 + 1e-4 && m < z1 - 1e-4) pts.push([m, true]);
  pts.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [z, keep] of pts) {
    const last = out[out.length - 1];
    if (last && z - last[0] < 0.006 * coarse) { if (keep && !last[1]) out[out.length - 1] = [z, keep]; continue; }
    out.push([z, keep]);
  }
  return out.map((p) => p[0]);
}

/** Collects loft triangles per bucket + colour. */
class Emit {
  constructor() { this.m = new Map(); }
  get(bucket, color) {
    const k = bucket + '|' + (color ?? '');
    let e = this.m.get(k);
    if (!e) this.m.set(k, (e = { bucket, color, p: [], n: [] }));
    return e;
  }
  flush(add) {
    for (const e of this.m.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(e.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(e.n, 3));
      add(e.bucket, g, e.color);
    }
    this.m.clear();
  }
}

/**
 * Sweep a cross-section along z. row(z) gives the same number of [x, y] points at every
 * station; with `mirror` it is the left half starting on the centre line (x = 0) and gets
 * mirrored into a full section. pick({x, y, z, hj}) sorts each quad into [bucket, colour]
 * (hj: the quad's index counted out from the centre line). Normals are smooth across the whole
 * sheet and follow the winding (outward for rows running over the top, right to left).
 * inner: { from: Set of buckets, d, bucket, color } also lays an inward-facing copy of those
 * quads d inside (headliner, pillar trim).
 */
function loft(E, zs, row, pick, { mirror = true, flip = false, inner = null } = {}) {
  const R = zs.map((z) => {
    const h = row(z);
    return mirror ? [...h.slice(1).reverse().map(([x, y]) => [-x, y]), ...h] : h;
  });
  const nr = R[0].length, ns = zs.length, c = mirror ? (R[0].length - 1) / 2 : 0;
  const P = new Float32Array(ns * nr * 3), N = new Float32Array(ns * nr * 3);
  for (let i = 0; i < ns; i++) for (let k = 0; k < nr; k++) { const o = (i * nr + k) * 3; P[o] = R[i][k][0]; P[o + 1] = R[i][k][1]; P[o + 2] = zs[i]; }
  const A = V(), B = V(), C = V(), D = V(), e1 = V(), e2 = V(), f = V();
  const ld = (v, i, k) => v.fromArray(P, (i * nr + k) * 3);
  const acc = (i, k, n) => { const o = (i * nr + k) * 3; N[o] += n.x; N[o + 1] += n.y; N[o + 2] += n.z; };
  for (let i = 0; i < ns - 1; i++) for (let k = 0; k < nr - 1; k++) {
    ld(A, i, k); ld(B, i, k + 1); ld(C, i + 1, k + 1); ld(D, i + 1, k);
    // quad normal from its diagonals (a,c,b / a,d,c winding)
    f.crossVectors(e1.subVectors(C, A), e2.subVectors(B, D));
    if (flip) f.negate();
    acc(i, k, f); acc(i, k + 1, f); acc(i + 1, k + 1, f); acc(i + 1, k, f);
  }
  for (let o = 0; o < N.length; o += 3) {
    const l = Math.hypot(N[o], N[o + 1], N[o + 2]);
    if (l > 1e-9) { N[o] /= l; N[o + 1] /= l; N[o + 2] /= l; } else N[o + 1] = 1;
  }
  const q = { x: 0, y: 0, z: 0, hj: 0 };
  const push = (e, idx, sgn, d) => {
    for (const [i, k] of idx) {
      const o = (i * nr + k) * 3;
      e.p.push(P[o] - N[o] * d, P[o + 1] - N[o + 1] * d, P[o + 2] - N[o + 2] * d);
      e.n.push(N[o] * sgn, N[o + 1] * sgn, N[o + 2] * sgn);
    }
  };
  for (let i = 0; i < ns - 1; i++) for (let k = 0; k < nr - 1; k++) {
    q.x = (R[i][k][0] + R[i][k + 1][0] + R[i + 1][k][0] + R[i + 1][k + 1][0]) / 4;
    q.y = (R[i][k][1] + R[i][k + 1][1] + R[i + 1][k][1] + R[i + 1][k + 1][1]) / 4;
    q.z = (zs[i] + zs[i + 1]) / 2;
    q.hj = mirror ? (k < c ? c - 1 - k : k - c) : k;
    const r = pick(q);
    if (!r) continue;
    const [bucket, color] = r;
    const a = [i, k], b = [i, k + 1], cc = [i + 1, k + 1], d = [i + 1, k];
    const tri = flip ? [a, b, cc, a, cc, d] : [a, cc, b, a, d, cc];
    push(E.get(bucket, color), tri, 1, 0);
    if (inner && inner.from.has(bucket)) {
      const t2 = flip ? [a, cc, b, a, d, cc] : [a, b, cc, a, cc, d];
      push(E.get(inner.bucket, inner.color), t2, -1, inner.d);
    }
  }
}

// cross-sections (left half, from the centre line outward and down)
function sideRow(S, z) {
  const t = topAt(S, z), b = bottomAt(S, z), w = halfW(S, z), h = t - b;
  const y2 = t - 0.055, y3 = Math.min(y2 - 0.01, t - Math.min(0.12, 0.4 * h));
  return [
    [w - 0.055, t - 0.017], [w - 0.017, y2], [w - 0.005, y3],
    [w, b + 0.45 * h], [w - 0.004, b + Math.min(0.06, 0.2 * h)], [w - 0.022, b + Math.min(0.018, 0.07 * h)], [w - 0.05, b],
  ];
}
function hoodRow(S, z) {
  const t = topAt(S, z), w = halfW(S, z);
  return [[0, t + CROWN], [w * 0.4, t + CROWN * 0.84], [w * 0.7, t + CROWN * 0.5], [w - 0.12, t + 0.002], ...sideRow(S, z)];
}
function doorRow(S, z) {
  const t = topAt(S, z), w = halfW(S, z);
  return [[w - 0.09, t - 0.075], [w - 0.09, t - 0.004], [w - 0.062, t - 0.006], ...sideRow(S, z)];
}
function ghRow(S, z) {
  const b0 = ghBase(S, z), h = ghTop(S, z), f = clamp((h - b0) / (S.roof - S.belt), 0, 1), gx = S.gx;
  const xt = ghX(S, z, h);
  return [
    [0, h + 0.03 * f], [gx * 0.45, h + 0.026 * f], [gx * 0.8, h + 0.014 * f],
    [xt - 0.05, h + 0.004 * f], [xt - 0.012, h - 0.02 * f], [xt, h - 0.055 * f],
    [ghX(S, z, h - 0.09 * f), h - 0.09 * f], [ghX(S, z, b0 + 0.028 * f), b0 + 0.028 * f], [ghX(S, z, b0), b0],
  ];
}
const mirrorRow = (row) => (S, z) => row(S, z).map(([x, y]) => [-x, y]);

/** Where the nose (dir 1) or tail (dir -1) face is at height y, and its lean (dz/dy). */
function faceAt(S, y, dir) {
  const zAt = (yy) => {
    let z = dir * S.hl;
    if (yy <= topAt(S, z)) return z;
    for (let k = 0; k < 200 && topAt(S, z) < yy; k++) z -= dir * 0.004;
    return z;
  };
  return { z: zAt(y), lean: (zAt(y + 0.02) - zAt(y - 0.02)) / 0.04 };
}

/** The painted skin, undertray and greenhouse into E. */
function shell(S, E, { lod = false, trim, color } = {}) {
  const { hl, gx } = S, [c0, c1] = S.cabin;
  const K = lod ? 3.5 : 1;
  const BLACK = 0x0e0f10;
  const paint = lod ? ['lo', color] : ['paint'];
  const blk = lod ? ['lo', 0x151617] : ['plastic', BLACK];
  const trimB = lod ? ['lo', 0x1a2228] : ['plastic', trim];
  // door shut lines: 8 mm bands of black quads
  const bands = lod ? [] : S.doors.map((z, i) => (i === 0 ? [z - 0.008, z] : i === S.doors.length - 1 ? [z, z + 0.008] : [z - 0.004, z + 0.004]));
  const mustB = bands.flat();
  const inBand = (z) => bands.some(([a, b]) => z > a && z < b);
  const rr = S.rear[0];
  const body = (q) => (inBand(q.z) ? blk : q.z > rr && q.z < c0 && Math.abs(q.x) < gx - 0.06 ? trimB : paint);
  loft(E, stations(S, c1, hl, mustB, K), (z) => hoodRow(S, z), body);
  loft(E, stations(S, -hl, c0, mustB.concat([rr]), K), (z) => hoodRow(S, z), body);
  const zc = stations(S, c0, c1, mustB, K);
  loft(E, zc, (z) => doorRow(S, z), body, { mirror: false });
  loft(E, zc, (z) => mirrorRow(doorRow)(S, z), body, { mirror: false, flip: true });
  // nose and tail faces close the ends
  for (const dir of [1, -1]) {
    const h = hoodRow(S, dir * hl);
    const pts = [...h.slice(1).reverse().map(([x, y]) => new THREE.Vector2(-x, y)), ...h.map(([x, y]) => new THREE.Vector2(x, y))];
    const g = new THREE.ShapeGeometry(new THREE.Shape(pts));
    if (dir < 0) g.rotateY(Math.PI);
    g.translate(0, 0, dir * hl);
    const e = E.get(...paint), p = g.toNonIndexed();
    e.p.push(...p.attributes.position.array); e.n.push(...p.attributes.normal.array);
  }
  // undertray: follows the sill and rises through the arches (the wheel wells)
  const zu = stations(S, -hl, hl, [], K * 1.5);
  loft(E, zu, (z) => { const w = halfW(S, z) - 0.05, b = bottomAt(S, z); return [[-w, b], [0, b - 0.004], [w, b]]; }, () => blk, { mirror: false, flip: true });

  // greenhouse
  const ws = S.ws[0], rf = S.rf[0], rb = S.rb[0], bP = S.doors[1];
  const quarter = rf + (ws - rf) * 0.55;
  const mustG = [rb - 0.1, rb - 0.05, rb, rb + 0.05, rb + 0.1, rf - 0.1, rf - 0.05, rf, rf + 0.05, rf + 0.1, bP - 0.045, bP + 0.045, quarter];
  const zg = stations(S, rr, ws, mustG, K).filter((z, i, a) => i === 0 || i === a.length - 1 || !lod || i % 2 === 0);
  const glassB = lod ? ['lo', 0x1a2228] : ['glass'];
  loft(E, zg, (z) => ghRow(S, z), (q) => {
    const { z, hj } = q;
    if (hj <= 2) return z > rf ? (lod ? glassB : ['shield']) : z < rb ? glassB : paint;
    if (hj <= 5) return paint;                               // pillars, roof rails, window frames
    if (hj === 7) return blk;                                // belt seal
    if (Math.abs(z - bP) < 0.045) return blk;                // B pillar
    if (z > rf) return z < quarter ? glassB : paint;         // front quarter glass up to the A pillar
    return z < rb ? paint : glassB;                          // C pillar
  }, { inner: lod ? null : { from: new Set(['paint']), d: 0.018, bucket: 'plastic', color: trim } });
}

// wheel: lathed tyre + rim barrel + spoked faces, merged with vertex colours (axle along X)
const wheelGeoCache = {};
function wheelGeo(r) {
  if (wheelGeoCache[r]) return wheelGeoCache[r];
  const w = 0.22, parts = [];
  const prof = [];
  const rr = 0.045;
  const ri = r * 0.64;
  prof.push(new THREE.Vector2(ri, -w / 2));
  for (let i = 0; i <= 4; i++) { const a = -Math.PI / 2 + (i / 4) * Math.PI / 2; prof.push(new THREE.Vector2(r - rr + Math.cos(a) * rr, -w / 2 + rr + Math.sin(a) * rr)); }
  for (let i = 0; i <= 4; i++) { const a = (i / 4) * Math.PI / 2; prof.push(new THREE.Vector2(r - rr + Math.cos(a) * rr, w / 2 - rr + Math.sin(a) * rr)); }
  prof.push(new THREE.Vector2(ri, w / 2));
  const tyre = new THREE.LatheGeometry(prof, 24);
  tyre.rotateZ(Math.PI / 2);
  parts.push(prep(tyre, 0x161618));
  const rim = new THREE.CylinderGeometry(ri, ri, w - 0.03, 18, 1, true);
  rim.rotateZ(Math.PI / 2);
  parts.push(prep(rim, 0x6c7075));
  for (const s of [1, -1]) {
    // dished face, five spokes and a hub, all facing out of their own side
    const face = new THREE.CircleGeometry(ri * 0.99, 18).rotateY(s * Math.PI / 2);
    parts.push(prep(face.translate(s * (w / 2 - 0.06), 0, 0), 0x3a3d41));
    for (let k = 0; k < 5; k++) {
      const sp = boxG(0.025, ri * 0.86, 0.055);
      sp.translate(0, ri * 0.5, 0);
      sp.rotateX((k / 5) * Math.PI * 2);
      parts.push(prep(sp.translate(s * (w / 2 - 0.045), 0, 0), 0xb8bcc2));
    }
    const hub = new THREE.CylinderGeometry(0.06, 0.07, 0.035, 12);
    hub.rotateZ(Math.PI / 2);
    parts.push(prep(hub.translate(s * (w / 2 - 0.04), 0, 0), 0xc9ccd0));
  }
  return (wheelGeoCache[r] = mergeGeometries(parts));
}

// ---------------------------------------------------------------- the car
const INTERIORS = [
  { seat: 0x26272b, bolster: 0x1b1c1f, dash: 0x1c1d20, carpet: 0x232325, trim: 0x2e2f33 },
  { seat: 0x8a7c67, bolster: 0x6e624f, dash: 0x2a2825, carpet: 0x3a342c, trim: 0x9a8f7d },
  { seat: 0x4a2a24, bolster: 0x35201b, dash: 0x1c1d20, carpet: 0x242222, trim: 0x33302e },
];
const DARK = 0x111214, BLACK = 0x0b0b0c;

/**
 * Build one car. Returns { root, body, hi, lo, wheels[4] (spin: .spin child), steer (turns
 * about its local Z), windshield, brake, stainable (meshes in the body frame), spec }.
 */
function buildMotorcycle(S, color, M) {
  const root = new THREE.Group(), body = new THREE.Group(), hi = new THREE.Group();
  const loParts = [], stainable = [];
  const paint = paintMat(M, color);
  const black = new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.7, metalness: 0.08 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.82 });
  const add = (geo, mat, parent, pos, rot = null, stain = false) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...pos);
    if (rot) mesh.rotation.set(...rot);
    mesh.castShadow = false; mesh.receiveShadow = true;
    parent.add(mesh);
    if (stain) stainable.push(mesh);
    return mesh;
  };
  const box = (w, h, d, r = 0.02) => rboxG(w, h, d, r, 2);
  const tube = (a, b, r, mat, parent = hi) => {
    const A = V(...a), B = V(...b), d = B.clone().sub(A);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), mat);
    mesh.position.copy(A.add(B).multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
    mesh.castShadow = false; mesh.receiveShadow = true; parent.add(mesh);
    return mesh;
  };
  const lowBox = (w, h, d, col, p, rot = [0, 0, 0]) => loParts.push(prep(place(boxG(w, h, d), ...p, ...rot), col));

  // Slim steel frame and exposed engine.
  const frame = new THREE.MeshStandardMaterial({ color: 0x858b91, roughness: 0.34, metalness: 0.8 });
  for (const s of [-1, 1]) {
    tube([s * 0.1, 0.83, 0.37], [s * 0.13, 0.43, -0.57], 0.035, frame);
    tube([s * 0.13, 0.43, -0.57], [s * 0.16, 0.56, -0.06], 0.035, frame);
    tube([s * 0.1, 0.83, 0.37], [s * 0.16, 0.56, -0.06], 0.035, frame);
  }
  const engine = add(box(0.42, 0.4, 0.42, 0.05), black, hi, [0, 0.57, -0.06]);
  add(box(0.46, 0.26, 0.52, 0.09), paint, hi, [0, 0.96, 0.12], [0.12, 0, 0], true); // fuel tank
  add(box(0.38, 0.13, 0.63, 0.06), black, hi, [0, 1.02, -0.4]); // seat
  add(box(0.42, 0.22, 0.28, 0.05), paint, hi, [0, 0.84, 0.43], [0.08, 0, 0], true); // front fairing
  add(box(0.35, 0.16, 0.3, 0.04), paint, hi, [0, 0.87, -0.76], [-0.1, 0, 0], true); // rear cowl
  for (const s of [-1, 1]) {
    tube([s * 0.19, 0.38, -0.4], [s * 0.31, 0.38, -0.4], 0.025, frame); // foot pegs
    tube([s * 0.13, 0.68, -0.1], [s * 0.28, 0.51, -0.1], 0.025, frame); // engine guards
    tube([s * 0.2, 0.52, 0.0], [s * 0.27, 0.49, -0.48], 0.045, frame); // exhaust
    add(box(0.09, 0.1, 0.43, 0.035), frame, hi, [s * 0.27, 0.49, -0.29], [0.1, 0, 0]);
  }
  tube([0, 0.56, -0.05], [0, 0.96, 0.4], 0.045, frame);

  // Front fork, handlebar and lamp steer together with the front wheel.
  const steerMount = new THREE.Group();
  steerMount.position.set(0, 1.0, 0.42);
  const steer = new THREE.Group();
  steerMount.add(steer); hi.add(steerMount);
  for (const s of [-1, 1]) {
    tube([s * 0.11, 0.02, 0.02], [s * 0.11, -0.69, 0.25], 0.032, frame, steer);
    tube([s * 0.11, 0.2, -0.02], [s * 0.34, 0.2, -0.02], 0.024, frame, steer);
    add(box(0.14, 0.045, 0.055, 0.02), rubber, steer, [s * 0.29, 0.2, -0.02]);
  }
  add(new THREE.SphereGeometry(0.12, 16, 12), M.lamp, steer, [0, -0.18, 0.16]);
  const windshield = add(box(0.37, 0.27, 0.018, 0.008), M.glass, steer, [0, 0.17, 0.1], [-0.18, 0, 0]);
  windshield.renderOrder = 2;
  add(box(0.16, 0.055, 0.025, 0.01), M.tail, hi, [0, 0.91, -0.94]);

  // The two wheels use the same suspension and rotation pivots as the cars.
  const wheels = S.wheels.map((wd) => {
    const pivot = new THREE.Group();
    pivot.position.set(wd.x, S.r, wd.z);
    const spin = new THREE.Mesh(wheelGeo(S.r), M.wheel);
    spin.castShadow = false; pivot.add(spin); pivot.spin = spin;
    hi.add(pivot);
    return pivot;
  });

  lowBox(0.42, 0.4, 0.42, 0x24272a, [0, 0.57, -0.06]);
  lowBox(0.46, 0.26, 0.52, color, [0, 0.96, 0.12], [0.12, 0, 0]);
  lowBox(0.42, 0.22, 0.28, color, [0, 0.84, 0.43]);
  lowBox(0.38, 0.13, 0.63, 0x17191c, [0, 1.02, -0.4]);
  lowBox(0.35, 0.16, 0.3, color, [0, 0.87, -0.76]);
  for (const wd of S.wheels) loParts.push(prep(new THREE.CylinderGeometry(S.r, S.r, 0.12, 16).rotateZ(Math.PI / 2).translate(wd.x, S.r, wd.z), 0x111214));
  const lo = new THREE.Mesh(mergeGeometries(loParts), M.lo);
  lo.castShadow = false; lo.receiveShadow = true; stainable.push(lo);
  body.add(hi, lo); root.add(body);
  for (const child of hi.children) {
    if (child === steerMount || wheels.includes(child)) continue;
    child.matrixAutoUpdate = false; child.updateMatrix();
  }
  hi.matrixAutoUpdate = false; hi.updateMatrix();
  lo.matrixAutoUpdate = false; lo.updateMatrix();
  return { root, body, hi, lo, wheels, steer, windshield, brake: hi.children.find((o) => o.material === M.tail), stainable, spec: S, color, lights: null };
}

export function buildCar(kind, color, env, interior = 0) {
  const S = SPECS[kind], M = mats(env);
  if (S.motorcycle) return buildMotorcycle(S, color, M);
  const I = INTERIORS[interior % INTERIORS.length];
  const { hl, W, belt, roof, gx } = S;
  const B = { paint: [], plastic: [], chrome: [], glass: [], shield: [], lamp: [], brake: [] };
  const add = (k, g, c) => B[k].push(prep(g, k === 'plastic' ? (c ?? DARK) : undefined));

  // ---- the skin ----
  const E = new Emit();
  shell(S, E, { trim: I.trim });
  E.flush(add);

  const [c0, c1] = S.cabin;
  const ws0 = S.ws, rf = S.rf, rb = S.rb;
  const tC1 = topAt(S, c1), tC0 = topAt(S, c0);
  // bulkheads closing the engine bay and the boot off from the cabin
  add('plastic', place(boxG(W - 0.2, tC1 - 0.03 - S.sill - 0.06, 0.012), 0, (tC1 - 0.03 + S.sill + 0.06) / 2, c1 + 0.008), I.carpet);
  add('plastic', place(boxG(W - 0.2, tC0 - 0.02 - S.sill - 0.06, 0.012), 0, (tC0 - 0.02 + S.sill + 0.06) / 2, c0 - 0.008), I.carpet);

  // ---- outside details ----
  const front = S.axles[0] - S.arch, rear = S.axles[1] + S.arch;
  for (const s of [1, -1]) {
    // door cards inside: trim panel, armrests
    add('plastic', place(boxG(0.02, belt - 0.03 - 0.42, c1 - c0 - 0.04), s * (W / 2 - 0.105), (belt - 0.03 + 0.42) / 2, (c0 + c1) / 2), I.trim);
    add('plastic', place(boxG(0.06, 0.05, 0.5), s * (W / 2 - 0.135), 0.66, S.front.z + 0.2), I.bolster);
    add('plastic', place(boxG(0.06, 0.05, 0.4), s * (W / 2 - 0.135), 0.64, S.back.z + 0.1), I.bolster);
    // side skirt between the arches
    add('plastic', place(rboxG(0.035, 0.06, front - rear - 0.06, 0.012, 1), s * (W / 2 - 0.03), S.sill + 0.012, (front + rear) / 2), BLACK);
    // door handles
    for (let i = 0; i < S.doors.length - 1; i++) add('chrome', place(rboxG(0.03, 0.03, 0.15, 0.012, 1), s * (W / 2 + 0.004), topAt(S, S.doors[i + 1]) - 0.15, S.doors[i + 1] + 0.2));
    // mirrors: housing on a stalk, glass facing back
    const mz = ws0[0] - 0.14, mt = topAt(S, mz), my = mt + 0.08;
    add('paint', place(rboxG(0.19, 0.11, 0.09, 0.035), s * (W / 2 + 0.09), my, mz));
    add('plastic', place(boxG(0.1, 0.05, 0.05), s * (W / 2 - 0.02), mt + 0.01, mz), BLACK);
    add('chrome', place(boxG(0.13, 0.065, 0.004), s * (W / 2 + 0.09), my, mz - 0.046));
  }

  // ---- nose and tail: bumpers, grille, lights, plates ----
  const onFace = (g, x, y, dir, proud, depth) => {
    const f = faceAt(S, y, dir);
    g.rotateX(dir * Math.atan(f.lean));
    if (dir < 0) g.rotateY(Math.PI);
    return place(g, x, y, f.z + dir * (proud - depth / 2));
  };
  const lampY = topAt(S, hl - 0.1) - 0.1;
  for (const dir of [1, -1]) {
    const bz = dir * (hl - 0.07);
    add('paint', place(rboxG(W - 0.14, 0.22, 0.22, 0.08), 0, 0.41, bz));                            // bumper
    add('plastic', place(boxG(0.5, 0.11, 0.01), 0, 0.41, dir * (hl + 0.048)), 0xe6e2d2);             // plate
    add('plastic', place(boxG(0.4, 0.035, 0.006), 0, 0.41, dir * (hl + 0.052)), 0x3a4150);            // plate lettering
  }
  add('plastic', onFace(rboxG(0.7, 0.14, 0.06, 0.02, 1), 0, lampY - 0.02, 1, 0.022, 0.06), DARK);   // grille
  for (let k = 0; k < 3; k++) add('chrome', onFace(boxG(0.64, 0.012, 0.012), 0, lampY - 0.065 + k * 0.045, 1, 0.03, 0.012));
  for (const s of [1, -1]) {
    add('lamp', onFace(rboxG(0.34, 0.12, 0.08, 0.03), s * (W / 2 - 0.3), lampY, 1, 0.018, 0.08));
    add('brake', onFace(rboxG(0.3, 0.13, 0.08, 0.03), s * (W / 2 - 0.24), lampY + 0.02, -1, 0.018, 0.08));
    add('lamp', onFace(boxG(0.1, 0.05, 0.03), s * (W / 2 - 0.45), lampY + 0.02, -1, 0.01, 0.03));   // reversing lamps
  }
  add('chrome', place(new THREE.CylinderGeometry(0.035, 0.04, 0.2, 10).rotateX(Math.PI / 2), -W / 2 + 0.4, 0.265, -hl + 0.02));

  // ---- cabin ----
  const cf = c1 - 0.04, dz = S.dashZ, dTop = ghBase(S, c1) - 0.01;
  add('plastic', place(boxG(W - 0.2, 0.05, c1 - c0 - 0.02), 0, S.sill + 0.06, (c0 + c1) / 2), I.carpet);   // floor
  add('plastic', place(boxG(0.3, 0.12, c1 - c0 - 0.4), 0, S.sill + 0.12, (c0 + c1) / 2 + 0.1), I.carpet); // tunnel
  // dashboard: a slab under the windshield base, lower face slanting down into the footwells
  {
    const lo = 0.5;
    const pts = [new THREE.Vector2(cf, dTop), new THREE.Vector2(dz + 0.05, dTop), new THREE.Vector2(dz, dTop - 0.05),
      new THREE.Vector2(dz, dTop - 0.2), new THREE.Vector2(dz + 0.22, lo), new THREE.Vector2(cf, lo)];
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: W - 0.24, bevelEnabled: false });
    const p = g.attributes.position, nn = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i), v = p.getY(i), w = p.getZ(i);
      p.setXYZ(i, W / 2 - 0.12 - w, v, u);
      const a = nn.getX(i), b = nn.getY(i), c = nn.getZ(i);
      nn.setXYZ(i, -c, b, a);
    }
    add('plastic', g, I.dash);
  }
  const wc = S.wheelC;
  add('plastic', place(rboxG(0.44, 0.08, 0.18, 0.03), wc.x, dTop + 0.03, dz + 0.1), I.dash);              // gauge hood
  // (no dials: the digital display sits on top of the hood - dash.js)
  add('plastic', place(boxG(0.36, 0.28, 0.06), 0, dTop - 0.2, dz + 0.03, -0.3), I.dash);                  // centre stack
  add('lamp', place(boxG(0.2, 0.12, 0.01).translate(0, 0.06, -0.034), 0, dTop - 0.2, dz + 0.03, -0.3));  // screen
  for (const s of [1, -1]) add('plastic', place(boxG(0.1, 0.05, 0.01), s * 0.62, dTop - 0.07, dz - 0.004), BLACK); // vents
  add('plastic', place(rboxG(0.22, 0.2, 0.7, 0.04), 0, S.sill + 0.24, S.front.z + 0.25), I.dash);          // console
  add('plastic', place(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 8), 0, S.sill + 0.4, S.front.z + 0.42, -0.2), BLACK);
  add('plastic', place(new THREE.SphereGeometry(0.03, 10, 8), 0, S.sill + 0.47, S.front.z + 0.43), BLACK);
  add('plastic', place(boxG(0.2, 0.06, 0.02), 0, roof - 0.09, rf[0] - 0.12, 0.3), BLACK);                  // rear-view mirror
  add('plastic', place(boxG(0.02, 0.06, 0.02), 0, roof - 0.035, rf[0] - 0.11), BLACK);
  for (const s of [1, -1]) add('plastic', place(boxG(0.4, 0.015, 0.2), s * 0.38, roof - 0.035, rf[0] - 0.16, -0.1), I.trim); // visors
  // pedals
  for (const dx of [0.1, -0.05, -0.18]) add('plastic', place(boxG(0.07, 0.1, 0.02), wc.x + dx, S.sill + 0.2, cf - 0.35, -0.5), BLACK);
  // seats
  const seat = (x, z, w, y, rear) => {
    const cy = y - 0.13;
    add('plastic', place(rboxG(w, 0.13, 0.5, 0.05), x, cy - 0.02, z + 0.12), I.seat);                   // cushion
    add('plastic', place(boxG(w * 0.8, cy - S.sill - 0.15, 0.4), x, (cy + S.sill + 0.01) / 2, z + 0.1), BLACK);
    const bz = z - 0.2, bh = rear ? 0.58 : 0.64;
    add('plastic', place(rboxG(w, bh, 0.13, 0.05), x, cy + bh / 2, bz - 0.04, -0.2), I.seat);              // back
    if (!rear) {
      for (const s of [1, -1]) add('plastic', place(rboxG(0.06, bh * 0.8, 0.16, 0.03), x + s * (w / 2 - 0.02), cy + bh * 0.42, bz - 0.02, -0.2), I.bolster);
      add('plastic', place(rboxG(0.26, 0.17, 0.1, 0.04), x, cy + bh + 0.12, bz - 0.15, -0.12), I.seat);   // headrest
      for (const dx of [-0.07, 0.07]) add('chrome', place(boxG(0.012, 0.08, 0.012), x + dx, cy + bh + 0.02, bz - 0.13));
    }
  };
  seat(S.seats[0].x, S.front.z, 0.5, S.front.y, false);
  seat(S.seats[1].x, S.front.z, 0.5, S.front.y, false);
  seat(0, S.back.z, 2 * gx - 0.12, S.back.y, true);
  for (const x of [-0.42, 0, 0.42]) add('plastic', place(rboxG(0.22, 0.14, 0.1, 0.04), x, S.back.y + 0.6, S.back.z - 0.34, -0.2), I.seat);

  if (S.taxi) {
    const sz = (rf[0] + rb[0]) / 2;
    add('plastic', place(rboxG(0.9, 0.2, 0.32, 0.05), 0, roof + 0.13, sz), 0xf6efd2);
    add('lamp', place(boxG(0.8, 0.1, 0.325), 0, roof + 0.13, sz));
    // checker band along the doors: two rows of squares on a flush strip
    for (const s of [1, -1]) for (let r = 0; r < 2; r++) for (let k = 0; k < 26; k++) {
      const z = -0.9 + k * 0.05 + 0.025;
      const y = topAt(S, z) - 0.2 + r * 0.05;
      add('plastic', place(boxG(0.004, 0.05, 0.05), s * (W / 2 + 0.001), y, z), (k + r) % 2 ? 0x111111 : 0xf2f2f2);
    }
  }

  if (S.police) {
    // black-and-white: dark doors and a push bar, the lightbar's housing (its lamps are below)
    for (const s of [1, -1]) for (let k = 0; k < 20; k++) {
      const z = -1.0 + k * 0.1 + 0.05;
      add('plastic', place(boxG(0.006, 0.26, 0.1), s * (W / 2 + 0.003), topAt(S, z) - 0.24, z), 0x121316);
    }
    add('plastic', place(boxG(1.0, 0.07, 0.12), 0, 0.5, hl + 0.06), 0x111111);
    add('plastic', place(rboxG(1.1, 0.08, 0.3, 0.03), 0, roof + 0.04, (rf[0] + rb[0]) / 2 + 0.2), 0x1a1a1a);
  }

  // ---- assemble ----
  const hi = new THREE.Group();
  const stainable = [];
  const mesh = (list, mat, cast = true, stain = true) => {
    if (!list.length) return null;
    const m = new THREE.Mesh(mergeGeometries(list), mat);
    m.castShadow = false; m.receiveShadow = !mat.transparent; // (cars cast no shadows)
    hi.add(m);
    if (stain) stainable.push(m);
    return m;
  };
  mesh(B.paint, paintMat(M, color));
  mesh(B.plastic, M.plastic);
  mesh(B.chrome, M.chrome, false);
  mesh(B.lamp, M.lamp, false);
  const brake = mesh(B.brake, M.tail, false, false);
  const glass = mesh(B.glass, M.glass, false);
  const windshield = mesh(B.shield, M.glass, false);
  glass.renderOrder = windshield.renderOrder = 2;
  // Pickup bed or semi-trailer details sit over the shared vehicle shell.
  const addExtra = (geo, mat, pos, stain = false) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos); m.castShadow = false; m.receiveShadow = true; hi.add(m);
    if (stain) stainable.push(m);
    return m;
  };
  if (S.pickup) {
    const bed = new THREE.MeshStandardMaterial({ color: 0x25292c, roughness: 0.82 });
    addExtra(boxG(S.W - 0.42, 0.045, 1.65), bed, [0, 1.18, -1.62]);
    for (const s of [-1, 1]) addExtra(rboxG(0.09, 0.31, 1.8, 0.035), paintMat(M, color), [s * (S.W / 2 - 0.13), 1.34, -1.65], true);
    addExtra(rboxG(S.W - 0.28, 0.31, 0.09, 0.035), paintMat(M, color), [0, 1.34, -2.53], true);
    addExtra(boxG(S.W - 0.4, 0.055, 0.11), bed, [0, 1.18, -0.77]);
  }
  if (S.semi) {
    const cargo = paintMat(M, 0xe7e5de), trim = new THREE.MeshStandardMaterial({ color: 0x34383b, roughness: 0.7 });
    addExtra(rboxG(S.W - 0.12, 3.0, 6.75, 0.06, 3), cargo, [0, 2.12, -1.55], true);
    addExtra(boxG(S.W - 0.25, 0.24, 6.7), trim, [0, 0.62, -1.55]);
    addExtra(boxG(S.W - 0.2, 0.06, 0.045), trim, [0, 0.58, 4.82]);
    for (const s of [-1, 1]) {
      addExtra(boxG(0.025, 0.1, 6.3), new THREE.MeshStandardMaterial({ color: 0xd4a538, emissive: 0x68440c, emissiveIntensity: 0.25 }), [s * (S.W / 2 - 0.015), 0.95, -1.55]);
      for (let z = -4.25; z < 1.3; z += 0.72) addExtra(boxG(0.035, 2.82, 0.035), trim, [s * (S.W / 2 - 0.02), 2.1, z]);
    }
    const rearDoor = new THREE.MeshStandardMaterial({ color: 0xd8d5ce, roughness: 0.7 });
    addExtra(boxG(S.W - 0.2, 2.8, 0.025), rearDoor, [0, 2.1, -4.94]);
    addExtra(boxG(0.035, 2.35, 0.035), trim, [0, 2.1, -4.96]);
  }

  // steering wheel on its column
  const steerMount = new THREE.Group();
  steerMount.position.copy(wc);
  steerMount.quaternion.setFromUnitVectors(V(0, 0, 1), S.wheelN.clone().negate());
  const steer = new THREE.Group();
  steerMount.add(steer);
  {
    const parts = [];
    parts.push(prep(new THREE.TorusGeometry(0.18, 0.02, 8, 28), 0x17181a));
    // (a red stripe at the top of the rim: you can see how far round it's turned)
    parts.push(prep(boxG(0.03, 0.05, 0.05).translate(0, 0.18, 0), 0xc8202a));
    parts.push(prep(new THREE.CylinderGeometry(0.055, 0.06, 0.05, 14).rotateX(Math.PI / 2).translate(0, 0, -0.015), 0x202124));
    for (const a of [-Math.PI / 6 - 0.2, Math.PI + Math.PI / 6 + 0.2, -Math.PI / 2]) {
      const sp = boxG(0.13, 0.03, 0.015).translate(0.1, 0, -0.005);
      parts.push(prep(sp.rotateZ(a), 0x1c1d20));
    }
    parts.push(prep(new THREE.CylinderGeometry(0.03, 0.035, 0.3, 10).rotateX(Math.PI / 2).translate(0, 0, 0.17), 0x1c1d20));
    const sm = new THREE.Mesh(mergeGeometries(parts), M.plastic);
    sm.castShadow = false;
    steer.add(sm);
  }
  hi.add(steerMount);

  // wheels: pivot (steering, suspension travel) > spin
  const wgeo = wheelGeo(S.r);
  const wheels = S.wheels.map((wd) => {
    const pivot = new THREE.Group();
    pivot.position.set(wd.x, S.r, wd.z);
    const spin = new THREE.Mesh(wgeo, M.wheel);
    spin.castShadow = false;
    pivot.add(spin);
    pivot.spin = spin;
    return pivot;
  });

  // ---- far LOD: one mesh, colours baked, the same lofts at a coarse step ----
  const lp = [];
  const EL = new Emit();
  shell(S, EL, { lod: true, color });
  EL.flush((k, g, c) => lp.push(prep(g, c)));
  for (const wd of S.wheels) lp.push(prep(new THREE.CylinderGeometry(S.r, S.r, 0.22, 12).rotateZ(Math.PI / 2).translate(wd.x, S.r, wd.z), 0x1a1a1c));
  for (const s of [1, -1]) {
    lp.push(prep(onFace(boxG(0.34, 0.12, 0.06), s * (W / 2 - 0.3), lampY, 1, 0.012, 0.06), 0xfff4dc));
    lp.push(prep(onFace(boxG(0.3, 0.13, 0.06), s * (W / 2 - 0.24), lampY + 0.02, -1, 0.012, 0.06), 0x8a1010));
  }
  for (const dir of [1, -1]) lp.push(prep(place(boxG(W - 0.14, 0.22, 0.22), 0, 0.41, dir * (hl - 0.07)), color));
  if (S.taxi) lp.push(prep(place(boxG(0.9, 0.2, 0.32), 0, roof + 0.13, (rf[0] + rb[0]) / 2), 0xf6efd2));
  if (S.police) {
    lp.push(prep(place(boxG(0.5, 0.1, 0.26), 0.27, roof + 0.12, (rf[0] + rb[0]) / 2 + 0.2), 0xc01818));
    lp.push(prep(place(boxG(0.5, 0.1, 0.26), -0.27, roof + 0.12, (rf[0] + rb[0]) / 2 + 0.2), 0x1838c0));
  }
  if (S.pickup) {
    lp.push(prep(place(boxG(S.W - 0.42, 0.045, 1.65), 0, 1.18, -1.62), 0x25292c));
    for (const s of [-1, 1]) lp.push(prep(place(boxG(0.09, 0.31, 1.8), s * (S.W / 2 - 0.13), 1.34, -1.65), color));
  }
  if (S.semi) {
    lp.push(prep(place(boxG(S.W - 0.12, 3.0, 6.75), 0, 2.12, -1.55), 0xe7e5de));
    lp.push(prep(place(boxG(S.W - 0.25, 0.24, 6.7), 0, 0.62, -1.55), 0x34383b));
  }
  const lo = new THREE.Mesh(mergeGeometries(lp), M.lo);
  lo.castShadow = false; lo.receiveShadow = true;
  stainable.push(lo);

  const root = new THREE.Group();
  const body = new THREE.Group();   // the sprung body (the physics chassis)
  body.add(hi, lo);
  root.add(body);
  for (const w of wheels) hi.add(w);
  // the police car's lamps: their own materials, so they can flash (vehicle.js)
  let lights = null;
  if (S.police) {
    const lamp = (col) => new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.2, roughness: 0.3, transparent: true, opacity: 0.9 });
    const zc = (rf[0] + rb[0]) / 2 + 0.2;
    const red = new THREE.Mesh(boxG(0.5, 0.1, 0.26), lamp(0xe01a1a)), blue = new THREE.Mesh(boxG(0.5, 0.1, 0.26), lamp(0x1a44ff));
    red.position.set(0.27, roof + 0.13, zc); blue.position.set(-0.27, roof + 0.13, zc);
    hi.add(red, blue);
    lights = { red, blue };
  }
  for (const o of [hi, lo, ...hi.children]) { o.matrixAutoUpdate = false; o.updateMatrix(); }
  steerMount.matrixAutoUpdate = true; steer.matrixAutoUpdate = true;
  for (const w of wheels) { w.matrixAutoUpdate = true; }
  return { root, body, hi, lo, wheels, steer, windshield, brake, stainable, spec: S, color, lights };
}

/** Physics shapes in the car frame: [hx, hy, hz, x, y, z] cuboids. A hollow cabin. */
export function carShapes(S) {
  if (S.motorcycle) return [
    [0.24, 0.22, 0.3, 0, 0.56, -0.02],
    [0.18, 0.14, 0.28, 0, 0.88, 0.12],
    [0.16, 0.11, 0.28, 0, 0.86, -0.42],
  ];
  if (S.semi) return [
    [S.W / 2, 1.5, 3.4, 0, 2.05, -1.55],
    [S.W / 2, 1.35, 1.7, 0, 2.0, 3.3],
  ];
  const { hl, W, belt, roof, gx } = S;
  const [c0, c1] = S.cabin;
  const b = (x0, x1, y0, y1, z0, z1) => [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const noseTop = lerpPts(S.top, (c1 + hl) / 2), tailTop = lerpPts(S.top, (c0 - hl) / 2);
  const out = [
    b(-W / 2, W / 2, 0.24, S.sill + 0.09, -hl + 0.05, hl - 0.05),          // floor pan
    b(-W / 2, W / 2, S.sill, noseTop, c1, hl),                              // nose
    b(-W / 2, W / 2, S.sill, tailTop, -hl, c0),                             // tail
    b(-gx, gx, roof - 0.07, roof, S.rb[0], S.rf[0]),                        // roof
    b(-W / 2 + 0.11, W / 2 - 0.11, belt - 0.3, belt, S.dashZ, c1),          // dashboard
  ];
  for (const s of [1, -1]) {
    out.push(b(s > 0 ? W / 2 - 0.1 : -W / 2, s > 0 ? W / 2 : -W / 2 + 0.1, S.sill, belt, c0, c1));   // doors
    const sx = S.seats[s > 0 ? 0 : 1].x;
    out.push(b(sx - 0.25, sx + 0.25, S.sill + 0.09, S.front.y - 0.13, S.front.z - 0.15, S.front.z + 0.37)); // front cushions
    out.push(b(sx - 0.25, sx + 0.25, S.front.y - 0.13, S.front.y + 0.5, S.front.z - 0.33, S.front.z - 0.2)); // front backs
  }
  out.push(b(-gx + 0.06, gx - 0.06, S.sill + 0.09, S.back.y - 0.13, S.back.z - 0.15, S.back.z + 0.37));
  out.push(b(-gx + 0.06, gx - 0.06, S.back.y - 0.13, S.back.y + 0.45, S.back.z - 0.34, S.back.z - 0.22));
  return out;
}
