import * as THREE from 'three';

/*
  MeshSlicer - a static utility that cuts a real triangle mesh in two along a plane.

  Nothing here is pre-cut or faked: every triangle of the input geometry is classified against
  the plane, the ones that cross it are clipped (Sutherland-Hodgman, one polygon per side) and
  fan-triangulated, and every new vertex the plane makes on a crossing edge gets every vertex
  attribute the mesh has - position, normal, uv(s), tangent, color, skinIndex/skinWeight, and any
  custom ones (the stain channels) - interpolated along that edge.

  The cross-section is then rebuilt and filled: the cut edges are chained into closed loops, the
  loops are flattened onto the plane, nested (outer outlines vs holes, any number of each - a
  concave outline and a hollow ring both work) and triangulated with ear clipping (three's
  ShapeUtils/Earcut, which takes holes). The fill is its own group (submesh) at materialIndex =
  capIndex so it renders with the "inside" material.

  Skinned meshes: each new vertex blends the two edge vertices' bone influences (merged per bone,
  the four strongest kept, renormalised), so both halves keep deforming with the right bones.
  Cap vertices copy the influences of the cut vertex they sit on.

  Performance: the per-call scratch (vertex remaps, growable output buffers, the edge cache) is
  module-level and reused, so a cut allocates little beyond the two result geometries.
*/

const EPS = 1e-6;

// ---- growable typed buffers, reused between calls ----
class FBuf {
  constructor(n = 4096) { this.a = new Float32Array(n); this.n = 0; }
  reset() { this.n = 0; }
  need(k) { if (this.n + k > this.a.length) { const b = new Float32Array(Math.max(this.a.length * 2, this.n + k)); b.set(this.a); this.a = b; } }
  out() { return this.a.slice(0, this.n); }
}
class IBuf {
  constructor(n = 4096) { this.a = new Uint32Array(n); this.n = 0; }
  reset() { this.n = 0; }
  need(k) { if (this.n + k > this.a.length) { const b = new Uint32Array(Math.max(this.a.length * 2, this.n + k)); b.set(this.a); this.a = b; } }
}

/** One side of the cut being built: per-attribute vertex buffers and per-group index buffers. */
class Side {
  constructor() { this.attrs = new Map(); this.buf = []; this.groups = []; this.count = 0; this.remap = new Int32Array(0); }
  reset(names, vertexCount, groupCount) {
    for (const n of names) { if (!this.attrs.has(n)) this.attrs.set(n, new FBuf()); this.attrs.get(n).reset(); }
    this.buf.length = 0;
    for (const n of names) this.buf.push(this.attrs.get(n));
    while (this.groups.length < groupCount + 1) this.groups.push(new IBuf());
    for (const g of this.groups) g.reset();
    if (this.remap.length < vertexCount) this.remap = new Int32Array(vertexCount);
    this.remap.fill(-1, 0, vertexCount);
    this.count = 0;
  }
}
const POS = new Side(), NEG = new Side();
const edgeCache = new Map();   // edge key -> posIndex * 2^21 + negIndex
const _e = [0, 0];
const segs = [];               // cut segments: pairs of positive-side vertex indices on the plane
const _tmpW = [];              // skin weight merge scratch
let dist = new Float32Array(0);
let SRC = null;                // attributes being read this call: [{ name, arr, size, norm }]
let SKI = null, SKW = null;

function copyVertex(S, i) {
  if (S.remap[i] >= 0) return S.remap[i];
  for (const A of SRC) {
    const b = S.buf[A.k];
    b.need(A.size);
    for (let k = 0; k < A.size; k++) b.a[b.n++] = A.arr[i * A.size + k];
  }
  return (S.remap[i] = S.count++);
}

/** Write the vertex at t along edge i->j (all attributes interpolated) into side S; returns its index. */
function lerpVertex(S, i, j, t) {
  for (const A of SRC) {
    if (A === SKI || A === SKW) continue; // (bone influences: blended together below)
    const b = S.buf[A.k], s = A.size;
    b.need(s);
    for (let k = 0; k < s; k++) b.a[b.n + k] = A.arr[i * s + k] + (A.arr[j * s + k] - A.arr[i * s + k]) * t;
    if (A.name === 'normal' || A.name === 'tangent') {
      const x = b.a[b.n], y = b.a[b.n + 1], z = b.a[b.n + 2], l = Math.hypot(x, y, z) || 1;
      b.a[b.n] = x / l; b.a[b.n + 1] = y / l; b.a[b.n + 2] = z / l;
    }
    b.n += s;
  }
  if (SKI && SKW) {
    // merge both ends' influences per bone, weighted by where along the edge, keep the top 4
    _tmpW.length = 0;
    for (let e = 0; e < 2; e++) {
      const v = e ? j : i, f = e ? t : 1 - t;
      for (let k = 0; k < 4; k++) {
        const bone = SKI.arr[v * 4 + k], w = SKW.arr[v * 4 + k] * f;
        if (w <= 0) continue;
        const x = _tmpW.find((q) => q[0] === bone);
        if (x) x[1] += w; else _tmpW.push([bone, w]);
      }
    }
    _tmpW.sort((a, b) => b[1] - a[1]);
    let sum = 0;
    for (let k = 0; k < 4 && k < _tmpW.length; k++) sum += _tmpW[k][1];
    const bi = S.buf[SKI.k], bw = S.buf[SKW.k];
    bi.need(4); bw.need(4);
    for (let k = 0; k < 4; k++) {
      const e = _tmpW[k];
      bi.a[bi.n++] = e ? e[0] : 0;
      bw.a[bw.n++] = e ? e[1] / (sum || 1) : 0;
    }
  } else for (const A of [SKI, SKW]) {
    if (!A) continue;
    const b = S.buf[A.k];
    b.need(A.size);
    for (let k = 0; k < A.size; k++) b.a[b.n++] = A.arr[(t < 0.5 ? i : j) * A.size + k];
  }
  return S.count++;
}

/** The plane point on edge i-j (cached so both triangles sharing the edge use the same vertex). */
function edgePoint(i, j, di, dj) {
  const key = i < j ? i * 0x200000 + j : j * 0x200000 + i;
  const hit = edgeCache.get(key);
  if (hit !== undefined) { _e[0] = Math.floor(hit / 0x200000); _e[1] = hit % 0x200000; return _e; }
  const t = di / (di - dj);
  _e[0] = lerpVertex(POS, i, j, t); _e[1] = lerpVertex(NEG, i, j, t);
  edgeCache.set(key, _e[0] * 0x200000 + _e[1]); // (packed: no per-edge allocation)
  return _e;
}

const polyP = [], polyN = [], onP = [], tv = [0, 0, 0], td = [0, 0, 0];

function emit(S, gi, poly) {
  const g = S.groups[gi];
  for (let k = 1; k + 1 < poly.length; k++) {
    if (poly[0] === poly[k] || poly[k] === poly[k + 1] || poly[0] === poly[k + 1]) continue;
    g.need(3); g.a[g.n++] = poly[0]; g.a[g.n++] = poly[k]; g.a[g.n++] = poly[k + 1];
  }
}

function triangle(gi, ia, ib, ic) {
  tv[0] = ia; tv[1] = ib; tv[2] = ic;
  td[0] = dist[ia]; td[1] = dist[ib]; td[2] = dist[ic];
  const pos = td[0] >= -EPS && td[1] >= -EPS && td[2] >= -EPS;
  const neg = td[0] <= EPS && td[1] <= EPS && td[2] <= EPS;
  if (pos && neg) return; // lies in the plane: the cap covers it
  if (pos) {
    polyP.length = 0; polyP.push(copyVertex(POS, ia), copyVertex(POS, ib), copyVertex(POS, ic)); emit(POS, gi, polyP);
    // an edge lying exactly in the plane is part of the outline too (taken from this side only,
    // so a shared edge isn't counted twice)
    for (let k = 0; k < 3; k++) if (Math.abs(td[k]) <= EPS && Math.abs(td[(k + 1) % 3]) <= EPS) segs.push(polyP[k], polyP[(k + 1) % 3]);
    return;
  }
  if (neg) { polyN.length = 0; polyN.push(copyVertex(NEG, ia), copyVertex(NEG, ib), copyVertex(NEG, ic)); emit(NEG, gi, polyN); return; }
  // Sutherland-Hodgman: walk the triangle's edges collecting each side's polygon, and the two
  // points where the plane crosses it (one segment of the cross-section's outline)
  polyP.length = polyN.length = onP.length = 0;
  for (let k = 0; k < 3; k++) {
    const a = tv[k], b = tv[(k + 1) % 3], da = td[k], db = td[(k + 1) % 3];
    if (da >= -EPS) polyP.push(copyVertex(POS, a));
    if (da <= EPS) polyN.push(copyVertex(NEG, a));
    if (Math.abs(da) <= EPS) onP.push(POS.remap[a]);
    if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)) {
      const e = edgePoint(a, b, da, db);
      polyP.push(e[0]); polyN.push(e[1]); onP.push(e[0]);
    }
  }
  emit(POS, gi, polyP);
  emit(NEG, gi, polyN);
  if (onP.length === 2 && onP[0] !== onP[1]) segs.push(onP[0], onP[1]);
}

// ---- the cap: chain the cut segments into loops, nest them, triangulate ----
const _u = new THREE.Vector3(), _v = new THREE.Vector3();

function buildLoops(P) {
  // weld by quantised position (vertices of different triangles / across UV seams meet here)
  const key = (i) => Math.round(P[i * 3] * 1e5) + ',' + Math.round(P[i * 3 + 1] * 1e5) + ',' + Math.round(P[i * 3 + 2] * 1e5);
  const id = new Map(), rep = [], adj = [];
  const node = (i) => { const k = key(i); let n = id.get(k); if (n === undefined) { n = rep.length; id.set(k, n); rep.push(i); adj.push([]); } return n; };
  for (let s = 0; s < segs.length; s += 2) {
    const a = node(segs[s]), b = node(segs[s + 1]);
    if (a === b) continue;
    adj[a].push(b); adj[b].push(a);
  }
  const used = new Uint8Array(rep.length), loops = [];
  for (let s = 0; s < rep.length; s++) {
    if (used[s] || !adj[s].length) continue;
    const loop = [s]; used[s] = 1;
    let prev = -1, cur = s;
    for (;;) {
      const nx = adj[cur].find((x) => x !== prev && !used[x]);
      if (nx === undefined) break; // closed (or an open edge on a non-watertight mesh: closed anyway)
      used[nx] = 1; loop.push(nx); prev = cur; cur = nx;
    }
    if (loop.length >= 3) loops.push(loop.map((n) => rep[n]));
  }
  return loops;
}

function inside(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

function addCap(plane, capGroup, capColor, uvScale) {
  const P = POS.attrs.get('position').a;
  const loops = buildLoops(P);
  if (!loops.length) return 0;
  const n = plane.normal;
  // a basis on the plane: 2D outlines, and the cap's planar UVs
  _u.set(Math.abs(n.x) < 0.9 ? 1 : 0, Math.abs(n.x) < 0.9 ? 0 : 1, 0).cross(n).normalize();
  _v.crossVectors(n, _u);
  const flat = loops.map((L) => L.map((i) => new THREE.Vector2(
    P[i * 3] * _u.x + P[i * 3 + 1] * _u.y + P[i * 3 + 2] * _u.z,
    P[i * 3] * _v.x + P[i * 3 + 1] * _v.y + P[i * 3 + 2] * _v.z)));
  // nesting: a loop inside an odd number of others is a hole in the one directly around it
  const depth = flat.map((F, i) => flat.reduce((d, G, j) => d + (i !== j && inside(F[0], G) ? 1 : 0), 0));
  const area = flat.map((F) => Math.abs(THREE.ShapeUtils.area(F)));
  let total = 0;
  for (let o = 0; o < flat.length; o++) {
    if (depth[o] % 2) continue;
    const holes = [];
    for (let h = 0; h < flat.length; h++) if (depth[h] === depth[o] + 1 && inside(flat[h][0], flat[o])) holes.push(h);
    const contour = flat[o], hv = holes.map((h) => flat[h]);
    const tris = THREE.ShapeUtils.triangulateShape(contour.slice(), hv.map((x) => x.slice()));
    const ids = [loops[o], ...holes.map((h) => loops[h])].flat();
    const pts = [contour, ...hv].flat();
    total += area[o] - holes.reduce((s, h) => s + area[h], 0);
    // on each piece: a copy of each outline vertex (its skinning, its stains) with the cap's own
    // normal facing out of that piece, planar UVs and the inside colour
    for (let side = 0; side < 2; side++) {
      const S = side ? NEG : POS, sign = side ? 1 : -1;
      const base = S.count;
      for (let k = 0; k < ids.length; k++) {
        const src = ids[k];
        for (const A of SRC) {
          const b = S.buf[A.k], s = A.size;
          b.need(s);
          if (A.name === 'normal') { b.a[b.n++] = n.x * sign; b.a[b.n++] = n.y * sign; b.a[b.n++] = n.z * sign; continue; }
          if (A.name.startsWith('uv')) { b.a[b.n++] = pts[k].x * uvScale; b.a[b.n++] = pts[k].y * uvScale; for (let q = 2; q < s; q++) b.a[b.n++] = 0; continue; }
          if (A.name === 'color') { b.a[b.n++] = capColor.r; b.a[b.n++] = capColor.g; b.a[b.n++] = capColor.b; if (s === 4) b.a[b.n++] = 1; continue; }
          if (A.name === 'tangent') { b.a[b.n++] = _u.x; b.a[b.n++] = _u.y; b.a[b.n++] = _u.z; if (s === 4) b.a[b.n++] = 1; continue; }
          const pa = POS.buf[A.k].a; // (position, skinning, custom channels: the cut vertex's)
          for (let q = 0; q < s; q++) b.a[b.n++] = pa[src * s + q];
        }
      }
      S.count += ids.length;
      // winding: Earcut's output is CCW in (u, v) and u x v = n, so as-is it faces +n: the
      // negative piece's cap; flipped for the positive piece
      const g = S.groups[capGroup];
      for (const t of tris) {
        g.need(3);
        g.a[g.n++] = base + t[0];
        if (sign > 0) { g.a[g.n++] = base + t[1]; g.a[g.n++] = base + t[2]; }
        else { g.a[g.n++] = base + t[2]; g.a[g.n++] = base + t[1]; }
      }
    }
  }
  return total;
}

function finish(S, mats) {
  let total = 0;
  for (let gi = 0; gi < mats.length; gi++) total += S.groups[gi].n;
  if (!total) return null;
  const geo = new THREE.BufferGeometry();
  for (const A of SRC) geo.setAttribute(A.name, new THREE.BufferAttribute(S.buf[A.k].out(), A.size, false));
  const idx = S.count > 65535 ? new Uint32Array(total) : new Uint16Array(total);
  let start = 0;
  for (let gi = 0; gi < mats.length; gi++) {
    const g = S.groups[gi];
    if (!g.n) continue;
    idx.set(g.a.subarray(0, g.n), start);
    geo.addGroup(start, g.n, mats[gi]);
    start += g.n;
  }
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** Volume of a closed mesh (signed tetrahedra to the origin), in its own units cubed. */
export function meshVolume(geo) {
  const p = geo.attributes.position.array, ix = geo.index ? geo.index.array : null;
  const n = ix ? ix.length : p.length / 3;
  let v = 0;
  for (let k = 0; k < n; k += 3) {
    const a = (ix ? ix[k] : k) * 3, b = (ix ? ix[k + 1] : k + 1) * 3, c = (ix ? ix[k + 2] : k + 2) * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return Math.abs(v / 6);
}

export const MeshSlicer = {
  /** Run one throwaway cut so the first real one doesn't pay for compiling the code (call at load). */
  warmup() {
    const g = new THREE.SphereGeometry(1, 16, 12);
    for (let i = 0; i < 4; i++) this.slice(g, new THREE.Plane(new THREE.Vector3(0.3, 1, 0.1).normalize(), -0.2 * i));
    g.dispose();
  },

  /**
   * Cut geometry along plane (a THREE.Plane in the geometry's own space).
   * opts.capIndex: material index for the fill (default: one past the highest in use).
   * opts.capColor: the fill's vertex colour (when the mesh has colours). opts.uvScale: cap UV tiling.
   * Returns { pos, neg, capArea, crossed } - pos is the side the normal points to; either is
   * null when the plane misses the mesh.
   */
  slice(geometry, plane, { capIndex = null, capColor = new THREE.Color(1, 1, 1), uvScale = 4 } = {}) {
    const vc = geometry.attributes.position.count;
    SRC = [];
    for (const [name, A] of Object.entries(geometry.attributes)) {
      let arr = A.array;
      // (interleaved / integer / normalised attributes: read as plain floats)
      if (A.isInterleavedBufferAttribute || !(arr instanceof Float32Array) || A.normalized) {
        arr = new Float32Array(A.count * A.itemSize);
        for (let i = 0; i < A.count; i++) for (let k = 0; k < A.itemSize; k++) arr[i * A.itemSize + k] = A.getComponent(i, k);
      }
      SRC.push({ name, arr, size: A.itemSize, k: SRC.length });
    }
    SKI = SRC.find((A) => A.name === 'skinIndex') || null;
    SKW = SRC.find((A) => A.name === 'skinWeight') || null;
    const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: geometry.index ? geometry.index.count : vc, materialIndex: 0 }];
    const mats = groups.map((g) => g.materialIndex || 0);
    const cap = capIndex ?? Math.max(...mats) + 1;
    const names = SRC.map((A) => A.name);
    POS.reset(names, vc, groups.length); NEG.reset(names, vc, groups.length);
    edgeCache.clear(); segs.length = 0;

    // signed distance of every vertex to the plane
    if (dist.length < vc) dist = new Float32Array(vc);
    const p = SRC.find((A) => A.name === 'position').arr, nn = plane.normal;
    for (let i = 0; i < vc; i++) dist[i] = nn.x * p[i * 3] + nn.y * p[i * 3 + 1] + nn.z * p[i * 3 + 2] + plane.constant;

    const ix = geometry.index ? geometry.index.array : null;
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi], end = Math.min(g.start + g.count, ix ? ix.length : vc);
      for (let k = g.start; k + 2 < end + 0.5; k += 3) {
        if (ix) triangle(gi, ix[k], ix[k + 1], ix[k + 2]);
        else triangle(gi, k, k + 1, k + 2);
      }
    }
    const crossed = segs.length > 0;
    const capArea = crossed ? addCap(plane, groups.length, capColor, uvScale) : 0;
    const matsOut = [...mats, cap];
    const pos = finish(POS, matsOut), neg = finish(NEG, matsOut);
    SRC = SKI = SKW = null;
    return { pos, neg, capArea, crossed };
  },
};
