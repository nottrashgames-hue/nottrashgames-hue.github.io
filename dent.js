// Progressive mesh deformation: blunt blows and high-speed impacts crush the body in.
//
// A dent is an impactor pressed into the skin: a sphere (a hammer's face), a capsule (a bat's
// barrel, a bumper) or a plane (the ground after a long fall). Every vertex the impactor
// swallows is pushed back out onto its surface - a crater the shape of what did it - with a
// little per-vertex crumple so it reads as crushed bone, not clay, and a lip of flesh squeezed
// up around the rim. The change is baked into the geometry's rest positions (bind space for the
// skinned torso), so dents pile up hit after hit, ride along with every pose, and carry onto
// the pieces when a part is cut off (slice.js keeps every attribute). The stain coordinates are
// left alone: bruises and blood stay where they were painted.
//
// Deterministic for a given hit (the crumple is hashed from the vertex index), so every client
// replaying the same hit gets the same crater.
import * as THREE from 'three';
import { sfx } from './sfx.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const _w = V(), _w2 = V(), _p = V(), _q = V(), _d = V(), _c = V(), _o = V();
const _ex = V(), _ey = V(), _ez = V();
const _L = new THREE.Matrix3(), _inv = new THREE.Matrix4(), _sph = new THREE.Sphere();

// how far (m) a part can be crushed in, all told, and how much a blow bites into it
export const DENT_CAP = { head: 0.062, chest: 0.075, spine: 0.07, pelvis: 0.06, thigh: 0.045, shin: 0.032, foot: 0.02, upper: 0.034, fore: 0.028 };
const GIVE = { head: 1.15, chest: 0.85, spine: 0.8, pelvis: 0.7, thigh: 0.85, shin: 0.9, foot: 0.5, upper: 0.9, fore: 0.9 };

/** Where the listener is (main.js sets the camera): crunches fade with distance. */
export const dentEars = { cam: null };

const hash = (i) => { let x = (i * 374761393) ^ 0x5bd1e995; x = Math.imul(x ^ (x >>> 13), 1274126177); return ((x ^ (x >>> 16)) >>> 0) / 4294967295; };

/** Rest position p of vertex i of mesh m -> world (skinned: through its own bone weights). */
function toWorld(m, i, p, out) {
  out.copy(p);
  if (m.isSkinnedMesh) m.applyBoneTransform(i, out);
  return out.applyMatrix4(m.matrixWorld);
}

function state(m) {
  const g = m.geometry;
  let s = g.userData.dent;
  if (!s || s.geo !== g) {
    // (a copy of a geometry carries its userData along: if it came from a dented one with the
    // same vertices, the true original shape is that one's, not the crushed shape copied)
    const n = g.attributes.position.array.length, N = g.attributes.normal?.array.length;
    const inherit = s && s.orig.length === n;
    s = g.userData.dent = {
      geo: g,
      orig: inherit ? Float32Array.from(s.orig) : Float32Array.from(g.attributes.position.array),
      origN: inherit && s.origN && s.origN.length === N ? Float32Array.from(s.origN) : g.attributes.normal ? Float32Array.from(g.attributes.normal.array) : null,
      any: inherit,
    };
  }
  return s;
}

/**
 * Press an impactor into meshes. P = world point on the skin, n = unit direction into the body.
 * o = { depth, R, axis?, flat?, cap, crumple } (metres). Returns the deepest push (m).
 */
export function dentMeshes(meshes, P, n, o) {
  const { depth, R, cap } = o;
  const flat = !!o.flat;
  const axis = o.axis && o.axis.lengthSq() > 1e-6 ? o.axis.clone().addScaledVector(n, -o.axis.dot(n)).normalize() : null;
  const half = axis ? R * (o.len || 1.3) : 0;
  const crumple = o.crumple ?? 0.35;
  // the impactor's centre: outside the skin, so its face reaches `depth` in
  const C = V().copy(P).addScaledVector(n, depth - R);
  const reach = R + half + depth + 0.02; // (nothing past this is touched)
  let deepest = 0;
  for (const m of meshes) {
    const g = m.geometry, pos = g.attributes.position;
    if (!pos) continue;
    m.updateWorldMatrix(true, false);
    if (!m.isSkinnedMesh) {
      if (!g.boundingSphere) g.computeBoundingSphere();
      _sph.copy(g.boundingSphere).applyMatrix4(m.matrixWorld);
      if (_sph.center.distanceTo(P) > _sph.radius + reach) continue;
    }
    const s = state(m);
    const arr = pos.array, orig = s.orig;
    const touched = [];
    let moved = false;
    for (let i = 0; i < pos.count; i++) {
      _p.fromArray(arr, i * 3);
      toWorld(m, i, _p, _w);
      _d.subVectors(_w, P);
      if (_d.lengthSq() > reach * reach) continue;
      touched.push(i);
      // how far in to put it (world)
      let push = null;
      const lateral = Math.sqrt(Math.max(0, _d.lengthSq() - _d.dot(n) ** 2));
      if (flat) {
        // the ground: flatten everything proud of the plane, fading out past R
        if (lateral > R) continue;
        const inb = _d.dot(n);
        if (inb >= depth) continue;
        const fall = 1 - (lateral / R) ** 2;
        push = _o.copy(n).multiplyScalar((depth - inb) * fall);
      } else {
        // sphere / capsule: out of the impactor along its radius
        _c.copy(C);
        if (axis) _c.addScaledVector(axis, clamp(_q.subVectors(_w, C).dot(axis), -half, half));
        _q.subVectors(_w, _c);
        const r = _q.length();
        if (r < R && r > 1e-6) push = _o.copy(_q).multiplyScalar((R - r) / r);
        else if (r >= R && r < R * 1.45 && _d.dot(n) < depth * 0.5) {
          // the lip: flesh squeezed out around the crater
          const k = 1 - (r - R) / (R * 0.45);
          push = _o.copy(n).multiplyScalar(-depth * 0.14 * k * k);
        } else continue;
      }
      push.multiplyScalar(1 + crumple * (hash(i) * 2 - 1));
      // never deeper than the part can take (measured against the untouched body)
      _w2.addVectors(_w, push);
      _p.fromArray(orig, i * 3);
      toWorld(m, i, _p, _q);
      _d.subVectors(_w2, _q);
      const tot = _d.length();
      if (tot > cap) _w2.copy(_q).addScaledVector(_d, cap / tot);
      const dW = _d.subVectors(_w2, _w);
      const dl = dW.length();
      if (dl < 1e-5) continue;
      deepest = Math.max(deepest, dl);
      // world push -> the geometry's own rest frame (an affine map: its linear part, inverted)
      _p.fromArray(arr, i * 3);
      toWorld(m, i, _p, _q);
      toWorld(m, i, _c.copy(_p).setX(_p.x + 1), _ex).sub(_q);
      toWorld(m, i, _c.copy(_p).setY(_p.y + 1), _ey).sub(_q);
      toWorld(m, i, _c.copy(_p).setZ(_p.z + 1), _ez).sub(_q);
      _L.set(_ex.x, _ey.x, _ez.x, _ex.y, _ey.y, _ez.y, _ex.z, _ey.z, _ez.z);
      if (Math.abs(_L.determinant()) < 1e-12) continue;
      _L.invert();
      dW.applyMatrix3(_L);
      arr[i * 3] += dW.x; arr[i * 3 + 1] += dW.y; arr[i * 3 + 2] += dW.z;
      moved = true;
    }
    if (!moved) continue;
    s.any = true;
    pos.needsUpdate = true;
    relight(g, touched);
    g.computeBoundingSphere();
    g.boundingBox = null;
    // (a toon outline child still wears the old geometry: give it the crushed one)
    for (const c of m.children) if (c.isMesh && c.userData.decal && c.material?.customProgramCacheKey?.() === 'toon-outline') c.geometry = g;
  }
  return deepest;
}

/** Fresh normals for the touched vertices only; seam twins (same rest spot) share one. */
function relight(g, touched) {
  const N = g.attributes.normal;
  if (!N) return;
  const keep = Float32Array.from(N.array);
  g.computeVertexNormals();
  const na = N.array, s = g.userData.dent, orig = s.orig;
  const set = new Uint8Array(N.count);
  for (const i of touched) set[i] = 1;
  const weld = new Map();
  for (const i of touched) {
    const k = `${Math.round(orig[i * 3] * 1e4)},${Math.round(orig[i * 3 + 1] * 1e4)},${Math.round(orig[i * 3 + 2] * 1e4)}`;
    let e = weld.get(k);
    if (!e) weld.set(k, (e = { x: 0, y: 0, z: 0, ids: [] }));
    e.x += na[i * 3]; e.y += na[i * 3 + 1]; e.z += na[i * 3 + 2]; e.ids.push(i);
  }
  for (const e of weld.values()) {
    if (e.ids.length < 2) continue;
    const l = Math.hypot(e.x, e.y, e.z) || 1;
    for (const i of e.ids) { na[i * 3] = e.x / l; na[i * 3 + 1] = e.y / l; na[i * 3 + 2] = e.z / l; }
  }
  for (let i = 0; i < N.count; i++) if (!set[i]) { na[i * 3] = keep[i * 3]; na[i * 3 + 1] = keep[i * 3 + 1]; na[i * 3 + 2] = keep[i * 3 + 2]; }
  N.needsUpdate = true;
}

/** Back to the shape it was built with (respawn). */
export function undent(meshes) {
  for (const m of meshes) {
    const g = m.geometry, s = g?.userData.dent;
    if (!s || !g.attributes.position) continue;
    // (a copy made of a dented geometry: same vertices, so back to the one true original too)
    if (s.geo !== g && s.orig.length !== g.attributes.position.array.length) continue;
    if (s.geo === g && !s.any) continue;
    g.attributes.position.array.set(s.orig);
    g.attributes.position.needsUpdate = true;
    if (s.origN && g.attributes.normal && s.origN.length === g.attributes.normal.array.length) { g.attributes.normal.array.set(s.origN); g.attributes.normal.needsUpdate = true; }
    g.computeBoundingSphere();
    g.boundingBox = null;
    if (s.geo === g) s.any = false;
    else g.userData.dent = { geo: g, orig: s.orig, origN: s.origN, any: false };
  }
}
/** Every mesh under root back to its built shape (a world reset: whatever dented it). */
export function undentTree(root) {
  const list = [];
  root.traverse((o) => { if (o.isMesh && o.geometry?.userData.dent) list.push(o); });
  undent(list);
}

/**
 * How a blow of weapon w at `speed` dents part `kind` (null: it doesn't). Blunt things only;
 * it takes real energy (a full swing, a thrown brick, a car) - a slap leaves no mark in bone.
 */
export function blowDent(kind, speed, w, n) {
  if (w.kind !== 'blunt') return null;
  const E = 0.5 * (w.mass || 1) * speed * speed * (w.dent ?? 1);
  if (E < 150) return null;
  const give = GIVE[kind] ?? 0.8, cap = DENT_CAP[kind] ?? 0.04;
  const depth = Math.min(cap * 0.8, 0.0024 * Math.sqrt(E - 150) * give);
  if (depth < 0.004) return null;
  const R = clamp(0.042 + (w.mass || 1) * 0.0045, 0.045, 0.14);
  // (a bat or a bar lands along its length: a trough; a hammer's head: a round crater)
  let axis = w.shaft && w.axis?.isVector3 ? w.axis : null;
  // (a bumper: a wide bar across the body)
  if (!axis && w.mass >= 15) axis = V(0, 1, 0).cross(n);
  return { depth, R, axis, len: w.mass >= 15 ? 2.2 : 1.3, cap, E };
}

/** How a hard landing (dv m/s in one frame) dents part `kind`: flattened against the ground. */
export function fallDent(kind, dv) {
  const need = 8.5;
  if (dv < need) return null;
  const give = GIVE[kind] ?? 0.8, cap = DENT_CAP[kind] ?? 0.04;
  const depth = Math.min(cap * 0.85, (dv - need) * 0.0042 * give);
  if (depth < 0.004) return null;
  return { depth, R: kind === 'head' ? 0.075 : 0.1, flat: true, cap, E: dv * dv * 4 };
}

/** The sound of it: bone giving way, louder the deeper, fading with distance. */
export function crunch(point, depth) {
  const cam = dentEars.cam;
  const d = cam ? cam.position.distanceTo(point) : 5;
  const vol = clamp(depth * 22, 0.25, 1.3) / (1 + d * d / 60);
  sfx('crunch', vol, { rate: 1.15 - clamp(depth * 6, 0, 0.35), vary: 0.08, voices: 3, gap: 0.04 });
}
