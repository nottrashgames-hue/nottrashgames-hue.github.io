import * as THREE from 'three';
import { sliceGeometry, unskinTear, pathCurve } from './slice.js';
import { posePositions } from './skinpose.js';

/*
  A cut that hasn't gone through (chop.js): a real opening in the body's meshes. Every mesh of
  the part is split along the kerf's plane (slice.js sliceGeometry - every attribute kept, the
  stains too) into a copy that stands in for it, and the two sides are pulled apart: wide at
  the skin, narrowing to nothing at the bottom of the cut - a V-shaped wound as deep as the
  kerf. Its two walls are meat (fat at the rim, red, dark down in it), so it's solid inside.
  Each blow opens it wider and deeper (updateGash). When it goes through, the opening closes
  back up (closeGash) and slice.js cuts the limb off along the same plane; a respawn
  (healGashes) puts the original meshes back.
  The torso too: its skinned layers (body, shirt, shorts) are split where they are in the
  current pose, and opened in their bind pose - each vertex's push run back through its own
  skinning - so the wound rides along with every breath and twist. On the torso a gash is as
  wide as a blade bites, not right round the body: it tapers out to either side (LAT).
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const WALL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0, side: THREE.DoubleSide,
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const C_FAT = new THREE.Color(0xd8b088), C_MEAT = new THREE.Color(0xa01e24), C_DEEP = new THREE.Color(0x4a0508);
const OPEN = 0.32;
const TORSO = new Set(['pelvis', 'spine', 'chest']);
// the torso: how far either side of the blow the gash runs (m), from a nick to most of the way across
const LAT = (D) => Math.min(0.17, 0.07 + D * 1.3);    // the gap at the skin, as a share of the cut's depth (each side half of it)
const _m = new THREE.Matrix4(), _p = V(), _q = V();

const hash = (i) => { let x = (i * 374761393) ^ 0x5bd1e995; x = Math.imul(x ^ (x >>> 13), 1274126177); return ((x ^ (x >>> 16)) >>> 0) / 4294967295; };

/** The part's own rigid meshes (not the parts hanging off it, not a weapon stuck in it). */
function meshesOf(A, g) {
  const parts = new Set(Object.values(A.groups)), out = [];
  const walk = (o) => {
    for (const c of o.children) {
      if (parts.has(c) || c.userData.cap || c.userData.notBody || c.userData.gashWall) continue;
      if (c.isMesh && !c.isSkinnedMesh && !c.userData.cut && c.layers.mask !== 0 && c.geometry?.attributes.position) out.push(c);
      walk(c);
    }
  };
  walk(g);
  return out;
}

/** The torso's skinned layers (not decals). */
function skinnedOf(A) {
  return A.hero.root.children.filter((c) => c.isSkinnedMesh && !c.userData.decal && !c.userData.cut && c.layers.mask !== 0);
}

/** A skinned mesh's geometry with its current pose alongside, as '_posed' (mesh-local). */
function posed(m) {
  const geo = m.geometry.clone();
  geo.setAttribute('_posed', new THREE.BufferAttribute(posePositions(m).pp, 3));
  return geo;
}

/** Each vertex's skinning, linear part, inverted: a push in the pose -> the same push in bind space. */
const _sm = new THREE.Matrix4(), _bm = new THREE.Matrix4(), _l3 = new THREE.Matrix3();
function bindDir(m, geo, i, dir, out) {
  const SI = geo.attributes.skinIndex.array, SW = geo.attributes.skinWeight.array;
  const bones = m.skeleton.bones, inv = m.skeleton.boneInverses, e = _sm.elements;
  e.fill(0);
  for (let j = 0; j < 4; j++) {
    const w = SW[i * 4 + j];
    if (!w) continue;
    _bm.multiplyMatrices(bones[SI[i * 4 + j]].matrixWorld, inv[SI[i * 4 + j]]);
    for (let q = 0; q < 16; q++) e[q] += w * _bm.elements[q];
  }
  _sm.premultiply(m.bindMatrixInverse).multiply(m.bindMatrix);
  _l3.setFromMatrix4(_sm);
  if (Math.abs(_l3.determinant()) < 1e-12) return out.copy(dir);
  return out.copy(dir).applyMatrix3(_l3.invert());
}

function merge(a, b) {
  const geos = [a, b].filter(Boolean);
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(geos[0].attributes)) {
    if (!geos.every((x) => x.attributes[name])) continue;
    const src = geos.map((x) => x.attributes[name]);
    const arr = new (src[0].array.constructor)(src.reduce((n, s) => n + s.array.length, 0));
    let o = 0;
    for (const s of src) { arr.set(s.array, o); o += s.array.length; }
    g.setAttribute(name, new THREE.BufferAttribute(arr, src[0].itemSize, src[0].normalized));
  }
  const side = new Int8Array(g.attributes.position.count);
  if (a && b) side.fill(-1, a.attributes.position.count);
  else if (b) side.fill(-1);
  for (let i = 0; i < side.length; i++) if (!side[i]) side[i] = 1;
  return { g, side };
}

/** Wall profile: how far each side stands off the plane at depth d of a cut D deep (gap/2 at d=0). */
const prof = (d, D, half) => (d >= D ? 0 : half * Math.pow(1 - Math.max(0, d) / D, 1.4));
/** A blade's kerf (S.kerf): the same width all the way down, closing only right at the bottom. */
const kprof = (d, D, half) => (d >= D ? 0 : half * Math.min(1, (D - d) / Math.min(0.012, D * 0.3)));
const profOf = (S) => (S.kerf ? kprof : prof);

/**
 * Open a gash for kerf S (chop.js: pL/nL/inL in the part's frame, r). Called once, on the first bite;
 * then updateGash as it deepens. False: nothing here to open (the torso, or no meshes).
 */
export function openGash(S) {
  const A = S.A, g = A.groups[S.part];
  if (!g) return false;
  // an older kerf on this part: its opening is left as it is (it's baked into the copies)
  const rec = (A._gash ||= { swaps: [], hidden: [], added: [], by: {} });
  A.healGash ||= () => healGashes(A);
  // (the torso's three parts share their meshes: a new gash on any of them freezes the others)
  for (const p of S.torso ? TORSO : [S.part]) {
    const old = rec.by[p];
    if (old) { old.frozen = true; rec.added.push(...old.walls); old.walls = []; delete rec.by[p]; }
  }
  g.updateWorldMatrix(true, true);
  const items = [];
  const gInv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  // (S.path: the blade's way through so far, in the part's frame - the opening bends along it,
  // one smooth cut however the blade's turned, the same surface the cut through will follow)
  const curveL = pathCurve(new THREE.Plane().setFromNormalAndCoplanarPoint(S.nL, S.pL), S.path);
  const own = { added: [], hidden: [], swaps: [] };
  for (const m of S.torso ? skinnedOf(A) : meshesOf(A, g)) {
    const skin = m.isSkinnedMesh;
    if (skin) m.skeleton.update?.();
    // the kerf in this mesh's own frame
    _m.copy(m.matrixWorld).invert().multiply(g.matrixWorld);
    const P = S.pL.clone().applyMatrix4(_m);
    const lin = new THREE.Matrix3().setFromMatrix4(_m);
    const nRaw = S.nL.clone().applyMatrix3(lin);
    const sc = 1 / Math.max(1e-6, nRaw.length()); // (mesh units -> part units)
    const n = nRaw.normalize();
    const inD = S.inL.clone().applyMatrix3(lin);
    inD.addScaledVector(n, -inD.dot(n)).normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, P);
    // (the bend, in this mesh's units: how far off its plane the cut runs at a mesh-space point)
    const relG = new THREE.Matrix4().multiplyMatrices(gInv, m.matrixWorld);
    const _c = V();
    const curve = curveL ? (p) => curveL(_c.copy(p).applyMatrix4(relG)) / sc : null;
    const off = (p) => plane.distanceToPoint(p) - (curve ? curve(p) : 0);
    const tear = curve ? { plane, n, curve, noise: () => 0, off: curve, band: 0 } : null;
    const geo = m.geometry;
    if (Array.isArray(m.material)) continue;
    // (no triangle across the plane: this mesh isn't in the way of the cut)
    if (!skin) {
      const box = geo.boundingSphere || (geo.computeBoundingSphere(), geo.boundingSphere);
      if (Math.abs(plane.distanceToPoint(box.center)) > box.radius + (curveL ? 0.14 / sc : 0)) continue;
    }
    let r;
    try { r = sliceGeometry(skin ? posed(m) : geo, plane, skin ? '_posed' : 'position', tear); } catch (e) { continue; }
    if (!r.pos || !r.neg || !r.loops.length) continue;
    const { g: cg, side } = merge(r.pos, r.neg);
    let where = cg.attributes.position.array, nb = null;
    if (skin) {
      // the new vertices along the cut: bind positions that skin exactly onto where they were cut
      const PP = cg.attributes._posed, cnt = PP.count, near = new Float32Array(cnt), w = V();
      for (let i = 0; i < cnt; i++) if (Math.abs(off(w.fromBufferAttribute(PP, i))) < 1e-5) near[i] = 1;
      cg.setAttribute('_tear', new THREE.BufferAttribute(near, 1));
      unskinTear(m, cg);
      where = Float32Array.from(PP.array);
      // and for each vertex near the plane, which way "along n" is in its bind space
      nb = new Float32Array(cnt * 3);
      const lim = 0.06 / sc;
      for (let i = 0; i < cnt; i++) {
        w.fromBufferAttribute(PP, i);
        if (Math.abs(off(w)) > lim) continue;
        bindDir(m, cg, i, n, w).toArray(nb, i * 3);
      }
      cg.deleteAttribute('_posed'); cg.deleteAttribute('_tear');
      cg.computeBoundingSphere();
    }
    const copy = skin ? new THREE.SkinnedMesh(cg, m.material) : new THREE.Mesh(cg, m.material);
    copy.position.copy(m.position); copy.quaternion.copy(m.quaternion); copy.scale.copy(m.scale);
    copy.castShadow = m.castShadow; copy.receiveShadow = m.receiveShadow;
    copy.renderOrder = m.renderOrder; copy.frustumCulled = m.frustumCulled;
    copy.layers.mask = m.layers.mask;
    copy.name = m.name;
    copy.userData = { ...m.userData, cut: false, gashOf: m };
    m.parent.add(copy);
    if (skin) { copy.frustumCulled = false; copy.bind(m.skeleton, m.bindMatrix); }
    rec.added.push(copy); own.added.push(copy);
    // the original out of sight (and out of every later cut: slice.js skips .cut)
    rec.hidden.push([m, m.layers.mask]); own.hidden.push([m, m.layers.mask]);
    m.layers.mask = 0; m.userData.cut = true;
    // (wounds / stains paint the copy now)
    const W = A.wounds?.parts;
    const lists = W ? Object.values(W).map((p) => p.meshes) : [];
    if (A.wounds?.skinned) lists.push(A.wounds.skinned);
    for (const L of lists) {
      const i = L?.indexOf(m) ?? -1;
      if (i >= 0) { L[i] = copy; rec.swaps.push([L, m, copy]); own.swaps.push([L, m, copy]); }
    }
    if (A.wounds?._posed) for (const c of A.wounds._posed.values()) c.frame = -1;
    // (walls hang off the part: the mesh's frame -> the part's, as it is now)
    // (cv: each vertex's bend off the plane, worked out once - it doesn't change as it deepens)
    let cv = null;
    if (curve) { const w = V(); cv = new Float32Array(cg.attributes.position.count); for (let i = 0; i < cv.length; i++) cv[i] = curve(w.set(where[i * 3], where[i * 3 + 1], where[i * 3 + 2])); }
    items.push({ copy, side, base: Float32Array.from(cg.attributes.position.array), where, nb, P, n, inD, ey: V().crossVectors(n, inD), sc, loops: r.loops, relG, curve, cv });
  }
  if (!items.length) return false;
  S.gash = rec.by[S.part] = { S, items, walls: [], g, own };
  return true;
}

/** Taper across the torso: 1 in the middle of the blow, 0 at LAT to either side. */
const across = (y, Lw) => (Lw ? Math.max(0, 1 - (y / Lw) ** 2) : 1);

/**
 * The vertices of item `it` that a cut D deep with a flare of `band` can reach, with each one's
 * depth (d), distance off the cut (dist) and place across it (y) - all fixed, they're measured
 * on where the vertex was built. Kept with room to spare, and only redone when the cut outgrows it.
 */
function candidates(it, D, band) {
  if (it.cand && D <= it.cD && band <= it.cB) return it.cand;
  const cD = Math.max(D * 1.6, D + 0.03), cB = Math.max(band * 1.6, band + 0.01);
  const w = it.where, { P, n, inD, ey, sc, cv } = it, cnt = w.length / 3;
  const idx = [], ds = [], dists = [], ys = [];
  for (let i = 0; i < cnt; i++) {
    _p.set(w[i * 3], w[i * 3 + 1], w[i * 3 + 2]);
    _q.subVectors(_p, P);
    const dist = Math.abs(_q.dot(n) - (cv ? cv[i] : 0)) * sc, d = _q.dot(inD) * sc;
    if (d < cD && dist < cB) { idx.push(i); ds.push(d); dists.push(dist); ys.push(_q.dot(ey) * sc); }
  }
  it.cand = Int32Array.from(idx); it.cd = Float64Array.from(ds); it.cdist = Float64Array.from(dists); it.cy = Float64Array.from(ys);
  it.cD = cD; it.cB = cB;
  return it.cand;
}

/** The opening as deep as the kerf now is (S.k of the way through). */
export function updateGash(S) {
  const G = S.gash;
  if (!G || G.frozen) return;
  const D = Math.max(0.004, S.k * S.r * 2);           // part units (metres on a body of scale 1)
  // (S.kerf: just the blade's own width - the mesh cut where the edge went, not pulled open)
  const half = S.kerf ? S.kerf * 0.5 : D * (S.open ?? OPEN) * 0.5 + 0.0015;
  const band = S.kerf ? half * 2 : half * 1.2;         // the skin either side flares out a little too
  const pf = profOf(S);
  const Lw = S.torso ? LAT(D) : 0;
  for (const it of G.items) {
    const pos = it.copy.geometry.attributes.position, a = pos.array, b = it.base;
    const { n, side, nb } = it;
    // only the vertices near enough the cut to ever move (worked out once, with room to grow -
    // and again if the cut outgrows it): everything else stays exactly where it was built
    const C = candidates(it, D, band);
    for (let q = 0; q < C.length; q++) {
      const i = C[q], d = it.cd[q], dist = it.cdist[q];
      let o = 0;
      if (d < D && dist < band) {
        const t = across(it.cy[q], Lw);
        if (t > 0) o = pf(d, D, half) * Math.sqrt(t) * (S.kerf ? 1 - dist / band : (1 - dist / band * 0.6) * (0.85 + 0.3 * hash(i)));
      }
      const k = side[i] * o / it.sc;
      if (nb) { a[i * 3] = b[i * 3] + nb[i * 3] * k; a[i * 3 + 1] = b[i * 3 + 1] + nb[i * 3 + 1] * k; a[i * 3 + 2] = b[i * 3 + 2] + nb[i * 3 + 2] * k; }
      else { a[i * 3] = b[i * 3] + n.x * k; a[i * 3 + 1] = b[i * 3 + 1] + n.y * k; a[i * 3 + 2] = b[i * 3 + 2] + n.z * k; }
    }
    pos.needsUpdate = true;
    if (!nb) it.copy.geometry.computeBoundingSphere();
  }
  walls(G, D, half, Lw);
}

/** The cut's two faces: the cross-section down to the bottom of the cut, each side on its V. */
function walls(G, D, half, Lw) {
  for (const w of G.walls) { w.removeFromParent(); w.geometry.dispose(); }
  G.walls = [];
  // the outermost outline (skin, or the sleeve over it) of the biggest mesh it went through
  // (the torso: the loop round the blow - not an arm the plane happens to run through too)
  let best = null, bestA = 0;
  for (const it of G.items) for (const L of it.loops) {
    if (L.length < 3) continue;
    const pts = L.map((p) => { _q.subVectors(p, it.P); return [_q.dot(it.inD) * it.sc, _q.dot(it.ey) * it.sc]; });
    let ar = 0, near = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
      ar += x0 * y1 - x1 * y0;
      near = Math.min(near, Math.hypot(x0, y0));
    }
    if (near > 0.06) continue;
    if (Math.abs(ar) > bestA) { bestA = Math.abs(ar); best = { it, pts }; }
  }
  // (no outline near the cut's start - a blow that met it from an odd angle: the part's own
  // round cross-section stands in, so the opening is never left hollow, see-through)
  if (!best && G.items.length) {
    const r = Math.max(0.03, G.S.r || 0.05), pts = [];
    for (let i = 0; i < 20; i++) { const t = (i / 20) * Math.PI * 2; pts.push([r + r * Math.cos(t + Math.PI), r * Math.sin(t + Math.PI)]); }
    best = { it: G.items[0], pts };
  }
  if (!best) return;
  // clip it to the cut so far (d < D), and on the torso to the blow's width (|y| < Lw)
  const clip = (src, f) => {
    const out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length], fa = f(a), fb = f(b);
      if (fa < 0) out.push(a);
      if ((fa < 0) !== (fb < 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    return out;
  };
  let poly = clip(best.pts, (p) => p[0] - D);
  if (Lw) { poly = clip(poly, (p) => p[1] - Lw); poly = clip(poly, (p) => -Lw - p[1]); }
  if (poly.length < 3) return;
  const it = best.it;
  let cx = 0, cy = 0;
  for (const [x, y] of poly) { cx += x; cy += y; }
  cx /= poly.length; cy /= poly.length;
  const N = poly.length;
  const ring = (k) => poly.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
  const rings = [poly, ring(0.72), ring(0.3)];
  const cols = [C_FAT, C_MEAT, C_DEEP];
  for (const s of [1, -1]) {
    const pos = [], col = [];
    const put = ([x, y], c) => {
      const off = s * profOf(G.S)(x, D, half) * Math.sqrt(across(y, Lw)) * 0.97 / it.sc;
      _p.copy(it.P).addScaledVector(it.inD, x / it.sc).addScaledVector(it.ey, y / it.sc);
      if (it.curve) _p.addScaledVector(it.n, it.curve(_p));
      _p.addScaledVector(it.n, off).applyMatrix4(it.relG);
      pos.push(_p.x, _p.y, _p.z); col.push(c.r, c.g, c.b);
    };
    for (let r = 0; r < 2; r++) for (let i = 0; i < N; i++) {
      const j = (i + 1) % N, A0 = rings[r][i], A1 = rings[r][j], B0 = rings[r + 1][i], B1 = rings[r + 1][j];
      put(A0, cols[r]); put(A1, cols[r]); put(B1, cols[r + 1]);
      put(A0, cols[r]); put(B1, cols[r + 1]); put(B0, cols[r + 1]);
    }
    for (let i = 0; i < N; i++) { put(rings[2][i], C_DEEP); put(rings[2][(i + 1) % N], C_DEEP); put([cx, cy], C_DEEP); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const w = new THREE.Mesh(geo, WALL);
    w.userData.gashWall = true; w.userData.cap = true;
    w.castShadow = false;
    G.g.add(w);
    G.walls.push(w);
  }
}

/** Going through: shut the opening, so the limb is cut off along the plane like any other. */
export function closeGash(S) {
  const G = S.gash;
  if (!G) return;
  for (const w of G.walls) { w.removeFromParent(); w.geometry.dispose(); }
  G.walls = [];
  if (!G.frozen) for (const it of G.items) {
    const pos = it.copy.geometry.attributes.position;
    pos.array.set(it.base);
    pos.needsUpdate = true;
    it.copy.geometry.computeBoundingSphere();
  }
  G.frozen = true;
  const rec = S.A._gash;
  if (rec?.by[S.part] === G) delete rec.by[S.part];
}

/**
 * Undo one opening completely - its copies gone, the meshes it was cut from back - so it can be
 * opened again along the blade's path as it now is (the blade turned in the cut: one smooth
 * bent opening, not a new slit at every turn).
 */
export function dropGash(S) {
  const G = S.gash, rec = S.A._gash;
  if (!G || !rec || !G.own) return false;
  for (const w of G.walls) { w.removeFromParent(); w.geometry.dispose(); }
  G.walls = [];
  const drop = (list, items) => { for (const x of items) { const i = list.indexOf(x); if (i >= 0) list.splice(i, 1); } };
  for (const [arr, was, now] of [...G.own.swaps].reverse()) { const i = arr.indexOf(now); if (i >= 0) arr[i] = was; }
  for (const [m, mask] of G.own.hidden) { m.layers.mask = mask; m.userData.cut = false; }
  for (const o of G.own.added) { o.removeFromParent(); o.geometry.dispose(); }
  drop(rec.swaps, G.own.swaps); drop(rec.hidden, G.own.hidden); drop(rec.added, G.own.added);
  if (S.A.wounds?._posed) for (const c of S.A.wounds._posed.values()) c.frame = -1;
  if (rec.by[S.part] === G) delete rec.by[S.part];
  G.frozen = true;
  S.gash = undefined;
  return true;
}

/** A new life for the body (a respawn, a reset): every gash gone, the original meshes back. */
export function healGashes(A) {
  const rec = A._gash;
  if (!rec) return;
  for (const [arr, was, now] of rec.swaps.reverse()) { const i = arr.indexOf(now); if (i >= 0) arr[i] = was; }
  for (const [m, mask] of rec.hidden) { m.layers.mask = mask; m.userData.cut = false; }
  for (const o of rec.added) { o.removeFromParent(); o.geometry.dispose(); }
  for (const G of Object.values(rec.by)) for (const w of G.walls) { w.removeFromParent(); w.geometry.dispose(); }
  A._gash = null;
}
