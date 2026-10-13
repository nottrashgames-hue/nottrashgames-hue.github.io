import { settings } from './settings.js';
import * as THREE from 'three';
import { INKS, inkOf, inkMat, shade } from './inks.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { groups, G_WORLD, G_CAR, G_DEBRIS, G_BODY } from './physics.js';
import { DIM } from './character.js';
import Delaunator from 'https://esm.sh/delaunator@5.0.1';

/*
  Dismemberment: a blade that meets a limb edge-first and fast enough goes through it, and
  the body is cut exactly where it met - along the plane the blade was travelling in (its
  flat), through the point of contact. Nothing is pre-cut: every mesh of that limb is split
  procedurally along that plane, triangle by triangle, and the cross-section is filled: one
  solid face over everything the cut went through (skin, sleeve, shoe - nothing to see through),
  fat at the edge into red meat, and bone only where a bone really runs (BONES). The stump stays on the body; the rest of the limb - everything
  past the cut, fingers and shoes and all - becomes its own physics body and flies off with
  the momentum it had plus a shove from the blade.

  The torso too: a heavy enough blow cuts a person in two, through the belly or across the
  chest under the arms. The torso is one skinned mesh blended over three bones, so it's cut
  where it is in the current pose: the half left on the body stays skinned to the same
  skeleton, and the half that comes away is frozen in the pose it had, with the head and arms.

  And again: a stump can be cut again closer in, and a piece that's come off can be cut again
  wherever a blade goes through it, lying on the floor or in the air - each half its own body
  (a hull round what it's made of), its mass shared out by size. Up to MAX_CUTS per thing: a
  body counts all its cuts together, a piece carries on its parent's count.

  Every vertex attribute survives the cut, including the blood-stain coordinates, so stains
  already on the limb stay put on both halves and keep soaking and drying.

  Physically, the cut part becomes a short stump collider (ragdoll.sever); what's past it
  stays jointed on as a weightless, limp, untouchable ghost, so all the balance / IK / grab
  code keeps working unchanged. Lose a leg and you can't get up; lose your head and you're
  dead. A respawn puts it all back.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const { THIGH, SHIN, UPPER_ARM, FOREARM } = DIM;

// where along each bone a cut can land (group-local Y; limbs run down -Y, the neck up +Y),
// and how far the severed piece reaches past it
const SPAN = {
  upper: { lo: -0.05, hi: -UPPER_ARM + 0.04, end: -UPPER_ARM, dir: -1 },
  fore: { lo: -0.04, hi: -FOREARM + 0.02, end: -FOREARM - 0.1, dir: -1 },
  thigh: { lo: -0.08, hi: -THIGH + 0.05, end: -THIGH, dir: -1 },
  shin: { lo: -0.05, hi: -SHIN + 0.04, end: -SHIN, dir: -1 },
  head: { lo: 0.0, hi: 0.1, end: 0.33, dir: 1 },
  // the torso, cut in two: through the belly (spine: the upper body comes away) or across the
  // chest under the arms (chest: head, shoulders and arms)
  spine: { lo: 0.03, hi: 0.18, end: 0.2, dir: 1, torso: true },
  chest: { lo: 0.04, hi: 0.16, end: 0.3, dir: 1, torso: true },
};
// edge speed (m/s) a blade needs to go right through (a longsword cleaves easier)
const NEED = { fore: 7, upper: 9.5, head: 9, shin: 9.5, thigh: 13, pelvis: 15.5, spine: 15.5, chest: 16.5 };
const TORSO = new Set(['pelvis', 'spine', 'chest']);
const MAX_CHUNKS = 40;
// how many times one thing can be cut: a body (all its limbs together), or a piece and
// everything that's been cut from it
const MAX_CUTS = 10;
// edge speed a blade needs through a loose piece (nothing holds it: it doesn't take much)
const NEED_LOOSE = 4.5;

const rnd = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------
/**
 * Split a geometry by a plane (its own local space). Returns { pos, neg } (either may be
 * null: nothing on that side) and the cut outline as closed loops of points.
 * `at`: the attribute that says where a vertex is (default 'position'; a skinned mesh passes
 * its posed copy). Skin indices/weights aren't blended across a cut: the nearer vertex's.
 */
const SKIN = new Set(['skinIndex', 'skinWeight']);

// ---- a torn edge: nothing is cut perfectly flat ----
function hash2(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296 * 2 - 1;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/**
 * How far off the plane (along its normal) the cut really runs at each point: broad waves, a
 * rougher ripple and a fine jaggedness, `amp` metres at most. A function of where on the plane a
 * point is, so both halves - their edges and their faces - tear along exactly the same line.
 */
export function makeTear(plane, amp, seed = (Math.random() * 1e6) | 0, blast = false) {
  const n = plane.normal, o = plane.coplanarPoint(V());
  const u = V().crossVectors(n, Math.abs(n.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).normalize();
  const w = V().crossVectors(n, u);
  const q = V();
  const off = (p) => {
    q.subVectors(p, o);
    const x = q.dot(u), y = q.dot(w);
    // blown off: an uneven, ragged line - broad dips and rises round the skull, lumpy in
    // between, a crumbly grit on top (rough, torn - no spikes, no clean line)
    if (blast) {
      const dip = 2 * vnoise(x / 0.06, y / 0.06, seed) - 1;
      const lump = 2 * vnoise(x / 0.022, y / 0.022, seed + 1) - 1;
      const grit = 2 * vnoise(x / 0.008, y / 0.008, seed + 2) - 1;
      return amp * (0.55 * dip + 0.3 * lump + 0.15 * grit);
    }
    return amp * (0.55 * vnoise(x / 0.045, y / 0.045, seed) + 0.3 * vnoise(x / 0.016, y / 0.016, seed + 1)
      + 0.2 * vnoise(x / 0.006, y / 0.006, seed + 2));
  };
  // (vertices this close to the plane are pulled along with it, less and less further out;
  // wider than the tear is deep, so nothing folds over)
  return { plane, n, off, band: amp * 2.6, amp };
}
// how deep (m) the tear runs either side of the plane
const TEAR = { limb: 0.0065, torso: 0.011, loose: 0.0055, blast: 0.016 };

export function sliceGeometry(geo, plane, at = 'position', tear = null, force = null) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const names = Object.keys(src.attributes);
  const attrs = names.map((n) => src.attributes[n]);
  const sizes = attrs.map((a) => a.itemSize);
  const ni = names.indexOf('normal'), ai = names.indexOf(at);
  const P = src.attributes[at];
  const out = { pos: names.map(() => []), neg: names.map(() => []) };
  const segs = [];
  const _p = V();
  const vert = (i) => attrs.map((a, k) => {
    const o = new Array(sizes[k]);
    for (let j = 0; j < sizes[k]; j++) o[j] = a.array[i * sizes[k] + j];
    return o;
  });
  const lerpV = (a, b, t) => a.map((arr, k) => {
    if (SKIN.has(names[k])) return (t < 0.5 ? arr : b[k]).slice();
    const o = arr.map((x, j) => x + (b[k][j] - x) * t);
    if (k === ni) { const l = Math.hypot(o[0], o[1], o[2]) || 1; o[0] /= l; o[1] /= l; o[2] /= l; }
    return o;
  });
  const push = (side, a, b, c) => {
    const S = out[side];
    for (let k = 0; k < names.length; k++) S[k].push(...a[k], ...b[k], ...c[k]);
  };
  const poly = (side, p) => { for (let i = 1; i < p.length - 1; i++) push(side, p[0], p[i], p[i + 1]); };
  const n = P.count;
  for (let i = 0; i < n; i += 3) {
    const v = [vert(i), vert(i + 1), vert(i + 2)];
    // (a triangle that belongs wholly to one side whatever the plane says: skin of a limb)
    const f = force?.(i);
    if (f) { push(f, ...v); continue; }
    const d = v.map((x) => plane.distanceToPoint(_p.set(x[ai][0], x[ai][1], x[ai][2])));
    const pc = (d[0] >= 0) + (d[1] >= 0) + (d[2] >= 0);
    if (pc === 3) { push('pos', ...v); continue; }
    if (pc === 0) { push('neg', ...v); continue; }
    const pp = [], np = [], cut = [];
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3], da = d[k], db = d[(k + 1) % 3];
      (da >= 0 ? pp : np).push(a);
      if ((da >= 0) !== (db >= 0)) {
        const I = lerpV(a, b, da / (da - db));
        pp.push(I); np.push(I);
        cut.push(V(I[ai][0], I[ai][1], I[ai][2]));
      }
    }
    poly('pos', pp); poly('neg', np);
    if (cut.length === 2) segs.push(cut);
  }
  const build = (S) => {
    if (!S[0].length) return null;
    const g = new THREE.BufferGeometry();
    names.forEach((nm, k) => g.setAttribute(nm, nm === 'skinIndex'
      ? new THREE.Uint16BufferAttribute(S[k], sizes[k]) : new THREE.Float32BufferAttribute(S[k], sizes[k])));
    if (tear) tearGeometry(g, at, tear);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  };
  const loops = chain(segs);
  if (tear) for (const L of loops) for (const p of L) p.addScaledVector(tear.n, tear.off(p));
  return { pos: build(out.pos), neg: build(out.neg), loops };
}

/**
 * Pull the vertices by the cut along its torn line. The amount each moved (along the plane's
 * normal, in `at`'s space) goes in '_tear', for a skinned mesh to carry into its bind pose.
 */
function tearGeometry(g, at, T) {
  const A = g.attributes[at], n = A.count;
  const moved = new Float32Array(n);
  const p = V();
  let any = false;
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(A, i);
    const d = Math.abs(T.plane.distanceToPoint(p));
    if (d >= T.band) continue;
    const k = T.off(p) * (1 - d / T.band);
    p.addScaledVector(T.n, k);
    A.setXYZ(i, p.x, p.y, p.z);
    moved[i] = k || 1e-9; // (non-zero: "near the cut")
    any = true;
  }
  if (any && at !== 'position') g.setAttribute('_tear', new THREE.BufferAttribute(moved, 1));
}

/**
 * Cut segments -> loops, matched end to end and grown from both ends. A mesh that isn't
 * watertight (an open sleeve end, a piece cut before) leaves open chains: those are joined up
 * with the nearest other chain end, and whatever's still open is closed straight across - so
 * every cross-section ends up a closed outline that can be filled.
 */
function chain(segs) {
  const key = (p) => `${Math.round(p.x * 2e4)},${Math.round(p.y * 2e4)},${Math.round(p.z * 2e4)}`;
  const at = new Map();
  segs.forEach((s, i) => {
    for (const e of [0, 1]) {
      const k = key(s[e]);
      if (!at.has(k)) at.set(k, []);
      at.get(k).push(i);
    }
  });
  const used = new Uint8Array(segs.length);
  const next = (p) => {
    const k = key(p);
    const j = (at.get(k) || []).find((c) => !used[c]);
    if (j === undefined) return null;
    used[j] = 1;
    return key(segs[j][0]) === k ? segs[j][1] : segs[j][0];
  };
  const chains = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const L = [segs[i][0], segs[i][1]];
    let closed = false;
    for (let p = next(L[L.length - 1]); p; p = next(L[L.length - 1])) {
      if (key(p) === key(L[0])) { closed = true; break; }
      L.push(p);
    }
    if (!closed) for (let p = next(L[0]); p; p = next(L[0])) L.unshift(p);
    chains.push({ L, closed });
  }
  // open ends: join each to the nearest open end of another chain, if it's close
  const TOL2 = 0.008 * 0.008;
  for (let pass = 0; pass < 64; pass++) {
    const open = chains.filter((c) => !c.closed);
    let best = null;
    for (const a of open) for (const b of open) {
      if (a === b) continue;
      const d = a.L[a.L.length - 1].distanceToSquared(b.L[0]);
      if (d < TOL2 && (!best || d < best.d)) best = { a, b, d };
      const r = a.L[a.L.length - 1].distanceToSquared(b.L[b.L.length - 1]);
      if (r < TOL2 && (!best || r < best.d)) best = { a, b, d: r, rev: true };
    }
    if (!best) break;
    const bl = best.rev ? [...best.b.L].reverse() : best.b.L;
    best.a.L.push(...bl);
    chains.splice(chains.indexOf(best.b), 1);
    if (best.a.L[0].distanceToSquared(best.a.L[best.a.L.length - 1]) < TOL2) best.a.closed = true;
  }
  return chains.filter((c) => c.L.length >= 3).map((c) => c.L);
}

// ---------------------------------------------------------------------------------------
// The cross-section: one solid face for everything a cut went through
// ---------------------------------------------------------------------------------------
const SECTION = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0 });
const C_PLAIN = new THREE.Color(0x3a3a3e);
const C_FAT = new THREE.Color(0xd9b48a), C_MEAT = new THREE.Color(0xa8252b), C_DEEP = new THREE.Color(0x6b0b0f);
// (other bloods, inks.js: the same meat in their colour)
const inkColor = (c, ink) => (ink ? new THREE.Color().setRGB(...shade(ink, ...c.getRGB(new THREE.Color(), THREE.SRGBColorSpace).toArray()), THREE.SRGBColorSpace) : c);
const MEATS = INKS.map((_, i) => [inkColor(C_MEAT, i), inkColor(C_DEEP, i)]);

/**
 * Where the bones run in each part (its group's frame: limbs hang down -Y from the joint, the
 * neck and torso go up +Y; x is the body's left, z its front): [from, to, radius]. `s` is the
 * side (+1 left, -1 right), for bones off to one side. Hands and feet: just meat.
 */
const BONES = {
  upper: () => [[V(0, -0.01, 0), V(0, -UPPER_ARM, 0), 0.0105]],
  fore: (s) => [[V(s * 0.009, 0, 0.004), V(s * 0.013, -FOREARM, 0.006), 0.0068],     // radius
    [V(-s * 0.008, 0, -0.004), V(-s * 0.009, -FOREARM, -0.006), 0.0062]],            // ulna
  thigh: () => [[V(0, -0.02, 0.004), V(0, -THIGH, 0.008), 0.0135]],                  // femur
  shin: (s) => [[V(0, 0, 0.014), V(0, -SHIN, 0.01), 0.0115],                         // tibia
    [V(s * 0.021, 0, -0.006), V(s * 0.017, -SHIN, -0.004), 0.0055]],                 // fibula
  head: () => [[V(0, -0.03, -0.018), V(0, 0.085, -0.02), 0.0105]],                  // neck vertebrae
  pelvis: () => [[V(0, -0.06, -0.075), V(0, 0.1, -0.075), 0.0125]],
  spine: () => [[V(0, 0, -0.075), V(0, 0.2, -0.08), 0.0135]],
  chest: () => [[V(0, 0, -0.08), V(0, 0.26, -0.065), 0.0125], [V(0, 0.03, 0.095), V(0, 0.2, 0.1), 0.006]], // spine, sternum
};
/** Bones of a body part, in `M`'s frame (M: part group -> that frame). */
function bonesOf(P, M) {
  const f = BONES[P.kind];
  if (!f) return [];
  return f(P.side || 1).map(([a, b, r]) => ({ a: a.clone().applyMatrix4(M), b: b.clone().applyMatrix4(M), r }));
}

/** A tear made in one frame, seen from a mesh (rel: mesh -> that frame; pm: the plane in mesh space). */
function tearIn(T, rel, pm) {
  const q = V();
  return { plane: pm, n: pm.normal, band: T.band, amp: T.amp, off: (p) => T.off(q.copy(p).applyMatrix4(rel)) };
}

const inPoly = (x, y, P) => {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    if ((P[i].y > y) !== (P[j].y > y) && x < ((P[j].x - P[i].x) * (y - P[i].y)) / (P[j].y - P[i].y) + P[i].x) c = !c;
  }
  return c;
};
const area2 = (P) => { let a = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += (P[j].x - P[i].x) * (P[j].y + P[i].y); return a / 2; };
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1) : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

// ---- what's inside: organs and tubes, where a cut crosses them ----
// (organs: solid shapes, coloured straight into the face's own vertices - no extra meshes; tubes:
// bones, ribs, arteries, the gut's coils - little rings where their centre-lines cross the plane,
// all of them in one mesh)
const ORGANS = { skull: 0, liver: 1, stomach: 2, gut: 3, lung: 4, heart: 5, brain: 6 }; // (drawn in this order)
const PALS = new Map();
function palette(ink) {
  let p = PALS.get(ink);
  if (p) return p;
  const c = (hex, blood) => (blood ? inkColor(new THREE.Color(hex), ink) : new THREE.Color(hex));
  p = {
    bone: c(0xe9dfcc), marrow: c(0x8a2a22, 1), spongy: c(0xc9a47e),
    gutWall: c(0xdc9a8a), gutIn: c(0x6e4230), artWall: c(0xb8404a, 1), artIn: c(0x2a0306, 1),
    lungLo: c(0xb8666c), lungHi: c(0xf0b8b4), lungVes: c(0x8a2c34, 1),
    heart: c(0x8e1c24, 1), heartIn: c(0x330406, 1), liver: c(0x5e1a16, 1), liverVes: c(0x300707, 1),
    stomach: c(0xc98a7c), stomachFold: c(0xa05a50), stomachIn: c(0x5e3a24),
    mesentery: c(0xd8ac7c), brain: c(0xc9a09c), brainWhite: c(0xece0d6), sulcus: c(0x8a4a48, 1), skull: c(0xe6dcc4),
  };
  PALS.set(ink, p);
  return p;
}
const _t = new THREE.Color(), _sv = V();
/** An organ's colour at a point: s in its unit-sphere space (f = |s|), (x, y) on the face. */
function tissue(kind, s, f, x, y, P, fat) {
  const nz = (sc, sd) => vnoise(x / sc, y / sc, sd);
  switch (kind) {
    case 'skull': return _t.copy(P.skull).multiplyScalar(0.9 + 0.12 * nz(0.004, 5));
    case 'lung':
      // spongy: light and dark air sacs, the odd vessel, the pleura round it
      _t.copy(P.lungLo).lerp(P.lungHi, nz(0.0045, 7) * 0.5 + 0.5);
      if (nz(0.013, 8) > 0.5) _t.lerp(P.lungVes, 0.75);
      if (f > 0.93) _t.lerp(P.lungHi, 0.45);
      return _t;
    case 'heart': {
      // thick muscle round two chambers of blood, fat on the outside
      const lv = _sv.set(s.x - 0.22, s.y + 0.15, s.z - 0.05).length() < 0.42;
      const rv = _sv.set(s.x + 0.42, s.y - 0.05, s.z - 0.2).length() < 0.3;
      if (lv || rv) return _t.copy(P.heartIn);
      _t.copy(P.heart).multiplyScalar(0.88 + 0.16 * nz(0.005, 9));
      if (f > 0.9) _t.lerp(fat, 0.6);
      return _t;
    }
    case 'liver':
      _t.copy(P.liver).multiplyScalar(0.85 + 0.22 * nz(0.006, 10));
      if (nz(0.01, 11) > 0.55) _t.copy(P.liverVes);
      return _t;
    case 'stomach':
      if (f < 0.68) return _t.copy(P.stomachIn).multiplyScalar(0.8 + 0.3 * nz(0.006, 12));
      return _t.copy(P.stomach).lerp(P.stomachFold, nz(0.005, 13) * 0.5 + 0.5);
    case 'gut': return _t.copy(P.mesentery).multiplyScalar(0.85 + 0.2 * nz(0.006, 14));
    case 'brain':
      if (f < 0.58) return _t.copy(P.brainWhite).lerp(P.brain, smooth01((f - 0.5) / 0.08));
      if (Math.abs(nz(0.008, 3)) < 0.1) return _t.copy(P.sulcus);
      return _t.copy(P.brain).multiplyScalar(0.92 + 0.1 * nz(0.004, 4));
  }
  return null;
}
// the ring each kind of tube shows: outside, inside, how far in the inside starts, segments
const TUBE = (P) => ({
  bone: [P.bone, P.marrow, 0.55, 18], rib: [P.bone, P.spongy, 0.5, 10],
  gut: [P.gutWall, P.gutIn, 0.6, 14], artery: [P.artWall, P.artIn, 0.55, 12],
});

/**
 * The insides a cut of `actor` can show, in one frame (`inv`: world -> that frame): the organs
 * (ellipsoids) and tubes (arteries, ribs, the gut) of `parts`, plus `bones` (already in that
 * frame). Taken from the body's own hit shapes (organs.js), so a cut shows just what a bullet
 * would have gone through there.
 */
function anatomyOf(actor, parts, inv, bones = []) {
  const tubes = bones.map((b) => ({ kind: 'bone', pts: [b.a, b.b], r: b.r }));
  const ells = [];
  const O = actor.organs;
  if (!O) return { tubes, ells };
  const byObj = new Map(Object.entries(actor.groups).map(([n, g]) => [g, n]));
  const owner = new Map();
  const partOf = (obj) => {
    if (!owner.has(obj)) {
      let n = null;
      for (let o = obj; o; o = o.parent) if (byObj.has(o)) { n = byObj.get(o); break; }
      owner.set(obj, n);
    }
    return owner.get(obj);
  };
  const M = new THREE.Matrix4(), D = new THREE.Matrix3();
  const to = (obj) => { obj.updateWorldMatrix(true, false); return M.multiplyMatrices(inv, obj.matrixWorld); };
  const sc = () => Math.cbrt(Math.abs(M.determinant())) || 1;
  for (const o of O.list) {
    if (!parts.has(partOf(o.obj))) continue;
    if (o.type === 'ell' && o.kind in ORGANS) {
      to(o.obj);
      const A = new THREE.Matrix3().setFromMatrix4(M).multiply(D.set(o.r.x, 0, 0, 0, o.r.y, 0, 0, 0, o.r.z));
      const e = A.elements;
      const reach = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[3], e[4], e[5]), Math.hypot(e[6], e[7], e[8]));
      ells.push({ kind: o.kind, c: o.c.clone().applyMatrix4(M), Q: A.invert(), reach });
    } else if (o.type === 'cap' && o.kind === 'artery') {
      to(o.obj);
      tubes.push({ kind: 'artery', pts: [o.a.clone().applyMatrix4(M), o.b.clone().applyMatrix4(M)], r: o.r * sc() });
    }
  }
  for (const t of O.tubes || []) {
    if (!parts.has(partOf(t.obj))) continue;
    to(t.obj);
    tubes.push({ kind: t.kind, pts: t.pts.map((p) => p.clone().applyMatrix4(M)), r: t.r * sc() });
  }
  ells.sort((a, b) => ORGANS[a.kind] - ORGANS[b.kind]);
  return { tubes, ells };
}

/**
 * Distance to the nearest outline edge, from a bucket grid (only what's within R matters: the
 * colour's gone fully deep by then) - so filling a big face stays cheap.
 */
function edgeField(segs, R) {
  const C = R, cells = new Map();
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  for (let s = 0; s < segs.length; s += 2) {
    const a = segs[s], b = segs[s + 1];
    const i0 = Math.floor((Math.min(a.x, b.x) - R) / C), i1 = Math.floor((Math.max(a.x, b.x) + R) / C);
    const j0 = Math.floor((Math.min(a.y, b.y) - R) / C), j1 = Math.floor((Math.max(a.y, b.y) + R) / C);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = key(i, j);
      let L = cells.get(k);
      if (!L) cells.set(k, (L = []));
      L.push(s);
    }
  }
  return (x, y) => {
    const L = cells.get(key(Math.floor(x / C), Math.floor(y / C)));
    let d = R;
    if (L) for (const s of L) d = Math.min(d, segDist(x, y, segs[s].x, segs[s].y, segs[s + 1].x, segs[s + 1].y));
    return d;
  };
}

/**
 * Fill the outlines evenly: points along every edge and a lattice inside, `h` apart, joined up
 * (Delaunay) - triangles the same size all over, so the tear shows across it and organs have
 * crisp enough edges in their colours. Null if the joining missed too much of an outline (a
 * very ragged one): the ear-clipped fill does then.
 */
function latticeFace(rings, h, from2, onFace, edgeDist) {
  const fin = [], xy = [], isB = [];
  const ringEdges = [];
  let per = 0;
  for (const r of rings) {
    const n = r.pts.length, first = fin.length;
    for (let i = 0; i < n; i++) {
      const a = r.pts[i], b = r.pts[(i + 1) % n], A = r.P2[i], B = r.P2[(i + 1) % n];
      const len = A.distanceTo(B), k = Math.max(1, Math.ceil(len / h));
      per += len;
      // (along an edge: exactly on the straight edge the mesh itself has there)
      for (let j = 0; j < k; j++) { fin.push(a.clone().lerp(b, j / k)); xy.push(A.clone().lerp(B, j / k)); isB.push(1); }
    }
    ringEdges.push([first, fin.length, r]);
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of xy) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  // (row by row: where each outline crosses it, and the lattice points between)
  const dy = h * 0.866, spans = [];
  for (let row = 0, y = y0 + dy * 0.5; y < y1; y += dy, row++) {
    spans.length = 0;
    for (const r of rings) {
      const P = r.P2, xs = [];
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        if ((P[i].y > y) !== (P[j].y > y)) xs.push(P[i].x + ((y - P[i].y) / (P[j].y - P[i].y)) * (P[j].x - P[i].x));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) spans.push(xs[k], xs[k + 1]);
    }
    const sx = x0 + (row & 1 ? h * 0.5 : 0) + h * 0.25;
    for (let k = 0; k < spans.length; k += 2) {
      for (let x = sx + Math.ceil((spans[k] + h * 0.5 - sx) / h) * h; x < spans[k + 1] - h * 0.5; x += h) {
        // (overlapping outlines: a point in two spans only once)
        let dup = false;
        for (let q = 0; q < k; q += 2) if (x > spans[q] && x < spans[q + 1]) { dup = true; break; }
        if (dup || edgeDist(x, y) < h * 0.5) continue;
        fin.push(onFace(from2(x, y))); xy.push(new THREE.Vector2(x, y)); isB.push(0);
      }
    }
  }
  if (xy.length < 3) return null;
  const co = new Float64Array(xy.length * 2);
  xy.forEach((p, i) => { co[i * 2] = p.x; co[i * 2 + 1] = p.y; });
  let D;
  try { D = new Delaunator(co); } catch { return null; }
  const T = D.triangles, tris = [], edges = new Set();
  const ek = (a, b) => (a < b ? a * 1e6 + b : b * 1e6 + a);
  const far2 = (h * 1.6) ** 2;
  for (let i = 0; i < T.length; i += 3) {
    const a = T[i], b = T[i + 1], c = T[i + 2];
    // (only a triangle touching the outline, or a long one, can reach outside it)
    if (isB[a] || isB[b] || isB[c] || xy[a].distanceToSquared(xy[b]) > far2 || xy[b].distanceToSquared(xy[c]) > far2 || xy[c].distanceToSquared(xy[a]) > far2) {
      const cx = (xy[a].x + xy[b].x + xy[c].x) / 3, cy = (xy[a].y + xy[b].y + xy[c].y) / 3;
      if (!rings.some((r) => inPoly(cx, cy, r.P2))) continue;
    }
    tris.push([a, b, c]);
    edges.add(ek(a, b)); edges.add(ek(b, c)); edges.add(ek(c, a));
  }
  // an outline edge the fill didn't reach (and not tucked inside another outline): a gap
  let miss = 0;
  for (const [s, e, r] of ringEdges) {
    for (let i = s; i < e; i++) {
      const j = i + 1 < e ? i + 1 : s;
      if (edges.has(ek(i, j))) continue;
      const mx = (xy[i].x + xy[j].x) / 2, my = (xy[i].y + xy[j].y) / 2;
      if (rings.some((o) => o !== r && inPoly(mx, my, o.P2))) continue;
      miss += xy[i].distanceTo(xy[j]);
    }
  }
  if (miss > per * 0.02) return null;
  return { fin, xy, isB: Uint8Array.from(isB), tris };
}

/** The fallback fill: each outline ear-clipped, then subdivided evenly (no cracks). */
function earFace(rings, T, onFace) {
  const fin = [], base = [], xy = [], tris = [];
  const bEdge = new Set();
  const ek = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
  for (const r of rings) {
    const off = fin.length;
    r.pts.forEach((p, i) => { fin.push(p.clone()); base.push(T.plane.projectPoint(p, V())); xy.push(r.P2[i].clone()); });
    for (let i = 0; i < r.pts.length; i++) bEdge.add(ek(off + i, off + (i + 1) % r.pts.length));
    for (const f of THREE.ShapeUtils.triangulateShape(r.P2, [])) tris.push([f[0] + off, f[1] + off, f[2] + off]);
  }
  if (!tris.length) return null;
  let longest = 0;
  for (const t of tris) for (let k = 0; k < 3; k++) longest = Math.max(longest, xy[t[k]].distanceTo(xy[t[(k + 1) % 3]]));
  let level = clamp(Math.ceil(Math.log2(longest / 0.01)), 0, 4);
  while (level > 0 && tris.length * 4 ** level > 9000) level--;
  let cur = tris;
  for (let l = 0; l < level; l++) {
    const mids = new Map(), nxt = [];
    const mid = (a, b) => {
      const k = ek(a, b);
      let m = mids.get(k);
      if (m !== undefined) return m;
      m = fin.length;
      xy.push(xy[a].clone().add(xy[b]).multiplyScalar(0.5));
      base.push(base[a].clone().add(base[b]).multiplyScalar(0.5));
      if (bEdge.has(k)) {
        fin.push(fin[a].clone().add(fin[b]).multiplyScalar(0.5));
        bEdge.add(ek(a, m)); bEdge.add(ek(m, b));
      } else fin.push(onFace(base[m].clone()));
      mids.set(k, m);
      return m;
    };
    for (const [a, b, c] of cur) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      nxt.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    cur = nxt;
  }
  const isB = new Uint8Array(fin.length);
  for (const k of bEdge) { const [a, b] = k.split('_'); isB[+a] = 1; isB[+b] = 1; }
  return { fin, xy, isB, tris: cur };
}

/**
 * The face of a cut: every outline the cut left (skin, sleeve, shoe - one frame, torn along
 * T), the outermost ones filled solid so there's nothing to see through, filled evenly so the
 * tear shows across it, coloured fat at the edge into red meat and deep flesh - and inside it
 * whatever the cut went through (`anat`, anatomyOf): lung, heart, liver, gut, brain in the
 * face's own colours, and a ring for every bone, rib, artery and loop of gut crossing it.
 * Returns meshes(facing): the face for one side (+1: looking along the plane normal, the side
 * that was cut away; -1: the other).
 */
function section(loops, T, anat = null, ink = 0) {
  // (settings: no flesh - a plain flat face, nothing inside)
  const plain = !settings.flesh;
  const [MEAT, DEEP] = plain ? [C_PLAIN, C_PLAIN] : MEATS[ink] || MEATS[0];
  const PAL = palette(ink || 0);
  let tubes = plain ? [] : anat?.tubes || [];
  let ells = plain ? [] : anat?.ells || [];
  if (!settings.bones) tubes = tubes.filter((t) => t.kind !== 'bone' && t.kind !== 'rib');
  const n = T.plane.normal, o = T.plane.coplanarPoint(V());
  const u = V().crossVectors(n, Math.abs(n.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).normalize();
  const w = V().crossVectors(n, u);
  const to2 = (p) => new THREE.Vector2(_s.subVectors(p, o).dot(u), _s.dot(w));
  const from2 = (x, y) => o.clone().addScaledVector(u, x).addScaledVector(w, y);
  const onFace = (p) => p.addScaledVector(n, T.off(p));
  // outlines in 2D (without repeated points), the tiny and the inner ones left out
  let rings = loops.map((L) => {
    const pts = [], P2 = [];
    for (const p of L) {
      if (pts.length && pts[pts.length - 1].distanceToSquared(p) < 1e-10) continue;
      pts.push(p); P2.push(to2(p));
    }
    if (pts.length > 2 && pts[0].distanceToSquared(pts[pts.length - 1]) < 1e-10) { pts.pop(); P2.pop(); }
    return { pts, P2, a: Math.abs(area2(P2)) };
  }).filter((r) => r.pts.length >= 3 && r.a > 2e-6);
  rings.sort((a, b) => b.a - a.a);
  rings = rings.filter((r, i) => !rings.slice(0, i).some((big) => inPoly(r.P2[0].x, r.P2[0].y, big.P2)));
  if (!rings.length) return null;
  const segs = [];
  for (const r of rings) for (let i = 0; i < r.P2.length; i++) segs.push(r.P2[i], r.P2[(i + 1) % r.P2.length]);
  const edgeDist = edgeField(segs, 0.03);

  // the fill: an even lattice (~1800 points on a torso, finer on a limb), else ear-clipped
  const area = rings.reduce((s, r) => s + r.a, 0);
  const h = clamp(Math.sqrt(area / 1800), 0.0035, 0.01);
  const F = latticeFace(rings, h, from2, onFace, edgeDist) || earFace(rings, T, onFace);
  if (!F || !F.tris.length) return null;
  const { fin, xy, isB } = F;

  // colour: how far in from the edge, then any organ the vertex is inside
  // (each organ's patch of the face lies within its reach of where its centre falls on it)
  ells = ells.filter((E) => Math.abs(T.plane.distanceToPoint(E.c)) < E.reach)
    .map((E) => { const q = to2(E.c); return { ...E, x0: q.x - E.reach, x1: q.x + E.reach, y0: q.y - E.reach, y1: q.y + E.reach }; });
  const pos = new Float32Array(fin.length * 3), col = new Float32Array(fin.length * 3);
  const c = new THREE.Color(), s = V();
  for (let i = 0; i < fin.length; i++) {
    fin[i].toArray(pos, i * 3);
    const x = xy[i].x, y = xy[i].y;
    const d = isB[i] ? 0 : edgeDist(x, y);
    const wob = vnoise(x / 0.007, y / 0.007, 91) * 0.0012;
    const dd = Math.max(0, d + wob);
    if (dd < 0.0025) c.copy(plain ? C_PLAIN : C_FAT).lerp(MEAT, smooth01(dd / 0.0025));
    else c.copy(MEAT).lerp(DEEP, smooth01((dd - 0.0025) / 0.025));
    c.multiplyScalar(0.88 + 0.2 * (vnoise(x / 0.012, y / 0.012, 17) * 0.5 + 0.5));
    // (organs sit in from the skin: a little meat round them always)
    const inset = smooth01((dd - 0.003) / 0.004);
    if (inset > 0) for (const E of ells) {
      if (x < E.x0 || x > E.x1 || y < E.y0 || y > E.y1) continue;
      s.subVectors(fin[i], E.c).applyMatrix3(E.Q);
      const f = s.length();
      if (f >= 1) continue;
      const t = tissue(E.kind, s, f, x, y, PAL, C_FAT);
      if (t) c.lerp(t, inset * smooth01((1 - f) / 0.06));
    }
    c.toArray(col, i * 3);
  }
  // triangles all winding one way (+n facing)
  const idx = [];
  for (const [a, b, cc] of F.tris) {
    const A = xy[a], B = xy[b], C = xy[cc];
    const cr = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
    if (Math.abs(cr) < 1e-14) continue;
    if (cr > 0) idx.push(a, b, cc); else idx.push(a, cc, b);
  }
  const P = new THREE.BufferAttribute(pos, 3), CA = new THREE.BufferAttribute(col, 3);

  // tubes crossing the face: where each centre-line goes through the plane
  const xs = [];
  for (const B of tubes) {
    const pts = B.pts, two = pts.length === 2;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const da = T.plane.distanceToPoint(a), db = T.plane.distanceToPoint(b);
      let t;
      if (two) {
        // (a straight bone: a hair past its ends still counts - it runs on into the joint)
        if (Math.abs(db - da) < 1e-6) continue;
        t = da / (da - db);
        if (t < -0.02 || t > 1.02) continue;
      } else {
        if ((da >= 0) === (db >= 0)) continue;
        t = da / (da - db);
      }
      const dir = V().subVectors(b, a);
      const den = n.dot(dir);
      if (Math.abs(den) < 1e-7) continue;
      const at = a.clone().addScaledVector(dir, t);
      const q = to2(at);
      if (!rings.some((r) => inPoly(q.x, q.y, r.P2)) || edgeDist(q.x, q.y) < B.r * 1.15) continue;
      // cut on a slant, a round tube shows as an oval
      const along = dir.clone().addScaledVector(n, -den);
      const major = along.lengthSq() > 1e-10 ? along.normalize() : u.clone();
      const minor = V().crossVectors(n, major);
      const stretch = Math.min(2.2, dir.length() / Math.abs(den));
      xs.push({ at, major, minor, r: B.r, stretch, kind: B.kind });
    }
  }
  const STY = TUBE(PAL);
  return (facing) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', P);
    g.setAttribute('color', CA);
    g.setIndex(facing > 0 ? idx : idx.map((v, i) => idx[i - (i % 3) + [0, 2, 1][i % 3]]));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const out = [new THREE.Mesh(g, SECTION)];
    if (xs.length) {
      // every ring in one mesh: an outer wall round an inside, a hair proud of the meat
      const tp = [], tc = [];
      const tri = (a, b, cc, col) => {
        const e = V().subVectors(b, a).cross(V().subVectors(cc, a));
        if (e.dot(n) * facing < 0) [b, cc] = [cc, b];
        tp.push(a.x, a.y, a.z, b.x, b.y, b.z, cc.x, cc.y, cc.z);
        for (let k = 0; k < 3; k++) tc.push(col.r, col.g, col.b);
      };
      xs.forEach((X, xi) => {
        const [outer, inner, k0, N] = STY[X.kind] || STY.bone;
        const lift = n.clone().multiplyScalar((0.0007 + (xi % 4) * 0.00012) * facing);
        const ring = (k, rr) => onFace(X.at.clone().addScaledVector(X.major, Math.cos(k / N * Math.PI * 2) * rr * X.stretch)
          .addScaledVector(X.minor, Math.sin(k / N * Math.PI * 2) * rr)).add(lift);
        const mid = onFace(X.at.clone()).add(lift);
        for (let k = 0; k < N; k++) {
          const o0 = ring(k, X.r), o1 = ring(k + 1, X.r), i0 = ring(k, X.r * k0), i1 = ring(k + 1, X.r * k0);
          tri(i0, o0, o1, outer); tri(i0, o1, i1, outer);
          tri(mid, i0, i1, inner);
        }
      });
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
      bg.setAttribute('color', new THREE.Float32BufferAttribute(tc, 3));
      bg.computeVertexNormals();
      out.push(new THREE.Mesh(bg, SECTION));
    }
    for (const m of out) { m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; m.userData.cap = true; }
    return out;
  };
}
const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------------------
// The system
// ---------------------------------------------------------------------------------------
// a new piece touches only the world and cars for its first moment (it starts out overlapping
// the stump, or the other half), then everything
const GRACE = groups(G_DEBRIS, G_WORLD | G_CAR), SOLID = groups(G_DEBRIS, G_WORLD | G_CAR | G_DEBRIS | G_BODY);
const _m = new THREE.Matrix4(), _mi = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = V(), _p = V();

/**
 * Every mesh of a body where it is right now. The limbs aren't under the root (each bone group
 * sits in the scene on its own), so updating the root alone leaves their meshes' world matrices
 * at the last render - a puppet posed since then (multiplayer) would be cut a frame off: the
 * plane missing the meshes it should split, the face not on the stump's edge.
 */
export function freshMatrices(actor) {
  const h = actor.hero;
  for (const G of h.visualGroups || [h.root]) G.updateMatrixWorld(true);
}

/** Part of a weapon stuck in the body (melee.js notBody): not flesh, never cut. */
function inWeapon(o, top) {
  for (let x = o; x && x !== top; x = x.parent) if (x.userData.notBody) return true;
  return false;
}

/** Hide something for good (until a respawn): out of every render / shadow / ray layer. */
function hide(o, rec) {
  o.traverse((x) => {
    if (x.userData.cut) return;
    x.userData.cut = true;
    x.userData._mask = x.layers.mask;
    x.layers.mask = 0;
    rec.hidden.push(x);
  });
}

/** Put `now` where `was` is in a list of meshes (and remember, to put it back). */
function swap(arr, was, now, rec) {
  const i = arr ? arr.indexOf(was) : -1;
  if (i >= 0) { arr[i] = now; rec.swaps.push([arr, was, now]); }
}

/**
 * A skinned mesh's geometry with its current pose alongside (mesh-local): `_posed` positions
 * and `_posedN` normals, so it can be cut where it is and the piece baked as it was.
 */
function posedCopy(m) {
  const geo = m.geometry.clone();
  const P = geo.attributes.position, N = geo.attributes.normal, n = P.count;
  const pp = new Float32Array(n * 3), pn = new Float32Array(n * 3);
  const a = V(), b = V();
  for (let i = 0; i < n; i++) {
    a.fromBufferAttribute(P, i);
    if (N) b.fromBufferAttribute(N, i).multiplyScalar(0.01).add(a);
    m.applyBoneTransform(i, a);
    a.toArray(pp, i * 3);
    if (N) { m.applyBoneTransform(i, b); b.sub(a).normalize().toArray(pn, i * 3); }
  }
  geo.setAttribute('_posed', new THREE.BufferAttribute(pp, 3));
  if (N) geo.setAttribute('_posedN', new THREE.BufferAttribute(pn, 3));
  return geo;
}
/**
 * A skinned stump was cut and torn in its posed copy ('_posed'): near the cut ('_tear' set),
 * put its bind-pose positions exactly where they skin back onto those posed ones - each vertex
 * through the inverse of its own skinning. (Interpolating bind positions across the cut
 * wouldn't: blended skinning isn't linear, so the seam would open by millimetres.)
 */
const _L = new THREE.Matrix4(), _bm = new THREE.Matrix4();
export function unskinTear(m, geo) {
  const near = geo.attributes._tear, PP = geo.attributes._posed;
  if (!near || !PP) return;
  const P = geo.attributes.position, SI = geo.attributes.skinIndex.array, SW = geo.attributes.skinWeight.array;
  const bones = m.skeleton.bones, inv = m.skeleton.boneInverses;
  const d = V(), e = _L.elements;
  for (let i = 0; i < P.count; i++) {
    if (!near.array[i]) continue;
    e.fill(0);
    for (let j = 0; j < 4; j++) {
      const w = SW[i * 4 + j];
      if (!w) continue;
      _bm.multiplyMatrices(bones[SI[i * 4 + j]].matrixWorld, inv[SI[i * 4 + j]]);
      for (let q = 0; q < 16; q++) e[q] += w * _bm.elements[q];
    }
    _L.premultiply(m.bindMatrixInverse).multiply(m.bindMatrix).invert();
    d.fromBufferAttribute(PP, i).applyMatrix4(_L);
    P.setXYZ(i, d.x, d.y, d.z);
  }
}

/**
 * For slicing a skinned mesh (non-indexed copy `geo`): per triangle (first vertex index i),
 * 'pos' / 'neg' when all three vertices are skinned mostly to limb or head bones that come
 * away with the piece / stay on the body; null (cut by the plane) for torso skin.
 */
function limbSide(m, geo, actor, goneNames) {
  const byObj = new Map(Object.entries(actor.groups).map(([n, g]) => [g, n]));
  const partOf = m.skeleton.bones.map((b) => {
    for (let o = b; o; o = o.parent) if (byObj.has(o)) return byObj.get(o);
    return null;
  });
  const src = geo.index ? geo.toNonIndexed() : geo;
  const SI = src.attributes.skinIndex?.array, SW = src.attributes.skinWeight?.array;
  if (!SI || !SW) return null;
  const side = (v) => {
    let best = 0, bw = -1;
    for (let j = 0; j < 4; j++) if (SW[v * 4 + j] > bw) { bw = SW[v * 4 + j]; best = SI[v * 4 + j]; }
    const n = partOf[best];
    if (!n || TORSO.has(n)) return null;
    return goneNames.has(n) ? 'pos' : 'neg';
  };
  return (i) => {
    const a = side(i);
    return a && side(i + 1) === a && side(i + 2) === a ? a : null;
  };
}

/** A sliced posed copy -> a plain static geometry in that pose. */
function baked(geo) {
  geo.setAttribute('position', geo.attributes._posed);
  if (geo.attributes._posedN) geo.setAttribute('normal', geo.attributes._posedN);
  for (const a of ['_posed', '_posedN', '_tear', 'skinIndex', 'skinWeight']) if (geo.attributes[a]) geo.deleteAttribute(a);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

/**
 * A copy of a body part's meshes for the severed piece, sharing geometry and materials. (Not
 * Object3D.clone: that deep-copies userData, which carries the stain volume's textures.)
 */
function copyTree(o) {
  const c = o.isMesh ? new THREE.Mesh(o.geometry, o.material) : o.isSprite ? new THREE.Sprite(o.material) : new THREE.Group();
  c.position.copy(o.position); c.quaternion.copy(o.quaternion); c.scale.copy(o.scale);
  c.matrixAutoUpdate = o.matrixAutoUpdate;
  c.matrix.copy(o.matrix);
  c.visible = o.visible;
  c.castShadow = true;
  c.layers.mask = o.userData.cut ? 0 : o.layers.mask;
  if (o.userData.cap) c.userData.cap = true;
  for (const ch of o.children) if (!ch.isSkinnedMesh) c.add(copyTree(ch));
  return c;
}

// gore bits (a burst head): one shared blob, a few materials per blood colour
const GIB_GEO = new THREE.IcosahedronGeometry(1, 0);
const GIB_MATS = new Map();
function gibMats(ink) {
  const k = ink ?? 'red';
  if (!GIB_MATS.has(k)) GIB_MATS.set(k, {
    meat: inkMat(0x7a1414, ink, { roughness: 0.45 }),
    dark: inkMat(0x3a0507, ink, { roughness: 0.35 }),
    bone: new THREE.MeshStandardMaterial({ color: 0xe9dfcc, roughness: 0.6 }),
  });
  return GIB_MATS.get(k);
}

export class Dismember {
  /** ctx: { scene, world, blood, sfx } */
  constructor(ctx) {
    this.ctx = ctx;
    this.chunks = [];
    this.spurts = [];
  }

  /**
   * A blade hit `part` of `actor` at `point`, moving at `vel`, its shaft along `axis`, its
   * edge facing `edge` (world). Cut through if the edge led and it was fast enough. `power`:
   * the blow's weight (a chop comes down harder), `cleave`: the weapon's (a longsword > a machete).
   */
  tryCut(actor, part, point, vel, axis, edge, { edges = 1, power = 1, cleave = 1 } = {}) {
    const kind = part.replace(/[LR]$/, '');
    if (!NEED[kind]) return false;
    // a torso comes apart at the belly or across the chest, whichever the blade met
    if (TORSO.has(kind)) {
      freshMatrices(actor);
      part = actor.groups.spine.worldToLocal(point.clone()).y > 0.235 ? 'chest' : 'spine';
    }
    const sp = vel.length();
    if (sp < 1) return false;
    const vd = vel.clone().divideScalar(sp);
    const lead = edges === 2 ? Math.abs(vd.dot(edge)) : vd.dot(edge);
    if (lead < 0.5) return false;                                  // the flat, or the back
    if (sp * power * cleave * (0.6 + 0.4 * lead) < NEED[kind]) return false;
    // the cut plane: the plane the blade was moving in
    const n = V().crossVectors(axis, vd);
    if (n.lengthSq() < 1e-4) return false;
    return this.sever(actor, part, point, n.normalize(), vel);
  }

  /**
   * Cut `part` of `actor` through world `point`, across `normalW`. Multiplayer: someone else's
   * body (a puppet, actor.remote) is cut for the look of it - its owner does the real thing when
   * the cut reaches them; every cut made here goes out through onCut (seed: the tear's, so
   * everyone's edge is the same). `net`: this cut came in over the network (don't send it back).
   */
  /**
   * gib: the piece doesn't come off whole - it bursts (a shotgun to the head): the stump's
   * made just the same, but what's past the cut is blown apart into gore and gone.
   */
  sever(actor, part, point, normalW, vel, { seed = (Math.random() * 1e6) | 0, net = false, gib = false, hiY = null } = {}) {
    if (actor.god) return false; // (admin.js: god mode)
    if (!settings.dismember) return false;
    const rd = actor.rd, P = rd.parts[part];
    if (!P || P.gone) return false;
    const kind = P.kind, S = SPAN[kind];
    if (!S || (actor._cut?.count || 0) >= MAX_CUTS) return false;
    const puppet = !!actor.remote;
    if (!puppet) {
      if (actor.mode !== 'ragdoll') actor.goRagdoll('collapse');
      if (actor.mode !== 'ragdoll') return false;
    }
    const h = actor.hero, g = actor.groups[part];
    freshMatrices(actor);
    const gp = V(), gq = new THREE.Quaternion(), gs = V();
    g.matrixWorld.decompose(gp, gq, gs);
    const scale = Math.abs(gs.x);

    // ---- the plane, in the part's own frame; "+" is the side that comes off ----
    const pL = g.worldToLocal(point.clone());
    const nL = normalW.clone().applyQuaternion(gq.clone().invert()).normalize();
    if (nL.y * S.dir < 0) nL.negate();
    // steep enough across the bone to actually part it (a glancing, lengthwise cut still
    // goes through at the angle it came in, just not along the whole limb)
    // (a torso even more so: a steep plane would run on out through the hips or the neck)
    const minY = S.torso ? 0.82 : 0.5;
    if (nL.y * S.dir < minY) {
      const xz = Math.hypot(nL.x, nL.z) || 1;
      const k = Math.sqrt(1 - minY * minY) / xz;
      nL.set(nL.x * k, minY * S.dir, nL.z * k);
    }
    // where it crosses the bone, kept to the part's length
    let y0 = nL.dot(pL) / nL.y;
    // (hiY: a cut allowed further along than a blade's could be - a blast through the skull)
    const hi = hiY ?? (gib && kind === 'head' ? 0.2 : S.hi);
    y0 = S.dir < 0 ? clamp(y0, hi, S.lo) : clamp(y0, S.lo, hi);
    // a stump again: only closer in than it was cut before (what was past that is long gone)
    const oldCut = P.cutY;
    if (oldCut !== undefined) {
      const was = oldCut / scale;
      if (S.dir < 0 ? y0 < was + 0.03 : y0 > was - 0.03) return false;
    }
    const plane = new THREE.Plane(nL.clone(), -nL.y * y0);

    // ---- physics: the stump, and the ghosts past it ----
    // (a severed arm lets go of what it held)
    if (!puppet && (kind === 'upper' || kind === 'fore' || S.torso)) {
      // (the left hand's weapon, if it has one of its own, goes only with the left arm)
      const left = part.endsWith('L') && actor.meleeHeldL;
      if (left) actor.meleeHeldL.drop(true);
      else {
        actor.gunHeld?.drop(); actor.meleeHeld?.drop(true);
        if (S.torso) actor.meleeHeldL?.drop(true);
      }
      actor.brain.hands?.reset?.();
    }
    // (a puppet's physics body isn't moving: its pose comes over the network)
    const lv = puppet ? V() : rd.vel(part), av = puppet ? V() : rd.angvel(part);
    const m0 = P.mass;
    const gone = rd.sever(part, y0 * scale);
    if (!gone) return false;
    rd.phys(() => { for (const c of P.cols) actor.brain.hands?.own?.add(c.handle); });

    const rec = (actor._cut ||= { hidden: [], added: [], swaps: [], count: 0 });
    rec.count++;
    if (!actor.unsever) actor.unsever = () => this.restore(actor);

    // ---- the severed piece: its own body, in the part's frame ----
    const chunk = new THREE.Group();
    chunk.position.copy(gp); chunk.quaternion.copy(gq); chunk.scale.copy(gs);
    this.ctx.scene.add(chunk);
    chunk.updateMatrixWorld(true);
    _mi.copy(chunk.matrixWorld).invert();
    const place = (o, world) => {
      o.matrixAutoUpdate = false;
      o.matrix.multiplyMatrices(_mi, world);
      o.matrix.decompose(o.position, o.quaternion, o.scale);
      chunk.add(o);
    };

    // meshes of this part (not of the parts hanging off it)
    const partGroups = new Set(Object.values(actor.groups));
    const own = [];
    const walk = (o) => {
      for (const c of o.children) {
        if (partGroups.has(c) || c.userData.cap || c.userData.notBody) continue;
        // (into cut-away meshes too: an outline's stump hangs off the hidden mesh it outlined)
        if (c.isMesh && !c.isSkinnedMesh && !c.userData.cut) own.push(c);
        walk(c);
      }
    };
    walk(g);
    const W = actor.wounds?.parts[part];
    const gInv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    // one tear for everything this cut goes through, in the part's frame; every layer's
    // outline gathered there, for the one solid face at the end
    // (a gib - a head blown open - is ragged all round, not cut)
    const Tc = gib ? makeTear(plane, TEAR.blast, seed, true) : makeTear(plane, S.torso ? TEAR.torso : TEAR.limb, seed);
    const outlines = [];
    const gather = (loops, rel) => { for (const L of loops) outlines.push(L.map((p) => p.clone().applyMatrix4(rel))); };
    // (a stump cut again: its old face is past this cut, and goes with the piece)
    for (const ch of [...g.children]) if (ch.userData.cap && !ch.userData.cut) { place(copyTree(ch), ch.matrixWorld); hide(ch, rec); }
    for (const m of own) {
      if (m.userData.wardrobe && !m.visible) { hide(m, rec); continue; } // (an outfit not being worn)
      // the plane in this mesh's space
      const rel = new THREE.Matrix4().multiplyMatrices(gInv, m.matrixWorld);
      const pm = plane.clone().applyMatrix4(_m.copy(rel).invert());
      const cut = sliceGeometry(m.geometry, pm, 'position', tearIn(Tc, rel, pm));
      if (!cut.pos) continue;                                 // all on the body side: untouched
      if (!cut.neg) {
        // all of it comes away
        place(copyTree(m), m.matrixWorld);
        hide(m, rec);
        continue;
      }
      // straddles the cut: split in two
      const stump = new THREE.Mesh(cut.neg, m.material);
      stump.userData = { ...m.userData, cut: false, piece: true };
      stump.castShadow = m.castShadow; stump.receiveShadow = m.receiveShadow;
      stump.matrixAutoUpdate = false;
      stump.matrix.copy(m.matrix);
      m.parent.add(stump);
      rec.added.push(stump);
      const off = new THREE.Mesh(cut.pos, m.material);
      off.userData = { ...m.userData, cut: false, piece: true };
      off.castShadow = m.castShadow;
      place(off, m.matrixWorld);
      for (const ch of m.children) if (ch.userData.cap && !ch.userData.cut) place(copyTree(ch), ch.matrixWorld);
      gather(cut.loops, rel);
      if (W) swap(W.meshes, m, stump, rec);
      hide(m, rec);
    }
    // the torso's skinned layers (body, shirt, shorts): split by where they are right now
    // (the skin of arms / head / legs goes with its limb, wherever the plane runs: an arm
    // hanging below a chest cut is on the piece, not left floating off the stump)
    const goneNames = new Set(gone.map((q) => q.name));
    if (S.torso) {
      for (const m of [...h.root.children]) {
        if (!m.isSkinnedMesh || m.userData.cut) continue;
        const geo = posedCopy(m);
        const rel = new THREE.Matrix4().multiplyMatrices(gInv, m.matrixWorld);
        const pm = plane.clone().applyMatrix4(_m.copy(rel).invert());
        const cut = sliceGeometry(geo, pm, '_posed', tearIn(Tc, rel, pm), limbSide(m, geo, actor, goneNames));
        if (!cut.pos) continue;
        if (cut.neg) {
          // what stays: still skinned, on the same skeleton (torn in its bind pose to match)
          unskinTear(m, cut.neg);
          for (const a of ['_posed', '_posedN', '_tear']) if (cut.neg.attributes[a]) cut.neg.deleteAttribute(a);
          const stump = new THREE.SkinnedMesh(cut.neg, m.material);
          stump.position.copy(m.position); stump.quaternion.copy(m.quaternion); stump.scale.copy(m.scale);
          stump.matrixAutoUpdate = m.matrixAutoUpdate; stump.matrix.copy(m.matrix);
          stump.frustumCulled = false;
          stump.castShadow = m.castShadow; stump.receiveShadow = m.receiveShadow;
          stump.userData = { ...m.userData, cut: false, piece: true };
          m.parent.add(stump);
          stump.bind(m.skeleton, m.bindMatrix);
          rec.added.push(stump);
          const W_ = actor.wounds;
          if (W_) {
            for (const n of TORSO) swap(W_.parts[n]?.meshes, m, stump, rec);
            swap(W_.skinned, m, stump, rec);
          }
        }
        // what comes away: frozen in the pose it had
        const off = new THREE.Mesh(baked(cut.pos), m.material);
        off.userData = { ...m.userData, cut: false, piece: true };
        off.castShadow = true;
        place(off, m.matrixWorld);
        hide(m, rec);
        gather(cut.loops, rel);
      }
    }
    // the face: solid meat over every layer, bone where there is bone; the body's looks out
    // along +n, the piece's back the other way
    // (a torso cut goes through the whole trunk's insides; a limb, only its own)
    const faceParts = S.torso ? new Set(TORSO) : new Set([part]);
    const sec = section(outlines, Tc, anatomyOf(actor, faceParts, gInv, bonesOf(P, new THREE.Matrix4())), inkOf(actor));
    const capped = !!sec;
    if (!capped) console.warn('[gore] no cut face built for', part, '- outlines:', outlines.length);
    if (sec) {
      for (const c of sec(1)) { g.add(c); rec.added.push(c); }
      for (const c of sec(-1)) place(c, g.matrixWorld);
    }
    // whole parts that hang past it: copied onto the piece as they are
    const goneG = gone.map((q) => actor.groups[q.name]).filter(Boolean);
    for (const G of goneG) {
      // (nested in another gone part's group: that copy already brings it)
      let par = G.parent, nested = false;
      while (par) { if (goneG.includes(par)) { nested = true; break; } par = par.parent; }
      if (nested) continue;
      const cl = copyTree(G);
      place(cl, G.matrixWorld);
      hide(G, rec);
    }
    chunk.traverse((o) => { if (o !== chunk && o.isMesh) o.castShadow = true; });
    // the bones the piece has in it (its frame), for when it's cut again
    const pieceBones = [...bonesOf(P, new THREE.Matrix4()),
      ...gone.flatMap((q) => (actor.groups[q.name] ? bonesOf(q, new THREE.Matrix4().multiplyMatrices(_mi, actor.groups[q.name].matrixWorld)) : []))];
    // and everything else inside it, as it lay when it came off (for the same reason)
    const pieceAnat = anatomyOf(actor, new Set([part, ...goneNames, ...(S.torso ? TORSO : [])]), _mi, pieceBones);

    // ---- the piece's body: the rest of this part, plus copies of the parts' shapes ----
    const def = P.def, sh = def.shapes[0];
    const box = sh[0] === 'rbox';
    const r = sh[0] === 'capY' || sh[0] === 'capX' ? sh[2] : box ? Math.max(sh[1], sh[3]) : 0.05;
    const sx = box ? sh[5] : sh[3], sz = box ? sh[7] : sh[5];
    const bd = RAPIER.RigidBodyDesc.dynamic().setTranslation(gp.x, gp.y, gp.z).setRotation(gq)
      .setLinearDamping(0.05).setAngularDamping(0.35).setCcdEnabled(true);
    const body = this.ctx.world.createRigidBody(bd);
    const cols = [];
    const col = (desc, m) => cols.push(this.ctx.world.createCollider(desc.setMass(Math.max(0.05, m)).setFriction(0.85).setRestitution(0.04).setCollisionGroups(GRACE), body));
    const lost = m0 - P.mass;
    if (kind === 'head' && oldCut === undefined) {
      for (const s of def.shapes) col(RAPIER.ColliderDesc.capsule(s[1], s[2]).setTranslation(s[3], s[4], s[5]), lost / def.shapes.length);
    } else {
      const a = y0 * scale, b = oldCut !== undefined ? oldCut : S.end * scale;
      const half = Math.max(0.004, Math.abs(b - a) / 2 - r * 0.6);
      col(RAPIER.ColliderDesc.capsule(half, r).setTranslation(sx, (a + b) / 2, sz), lost);
    }
    // (a puppet: where its parts are drawn, not its idle physics bodies)
    const gPos = (n) => (puppet ? actor.groups[n].getWorldPosition(V()) : rd.pos(n));
    const gQuat = (n) => (puppet ? actor.groups[n].getWorldQuaternion(new THREE.Quaternion()) : rd.quat(n));
    const pq = gQuat(part), pp = gPos(part), piq = pq.clone().invert();
    for (const q of gone) {
      if (puppet && !actor.groups[q.name]) continue;
      const qp = gPos(q.name).sub(pp).applyQuaternion(piq);
      const qq = piq.clone().multiply(gQuat(q.name));
      const each = q.def.m / q.def.shapes.length;
      for (const s of q.def.shapes) {
        let d, t, rq = new THREE.Quaternion();
        if (s[0] === 'capY') { d = RAPIER.ColliderDesc.capsule(s[1], s[2]); t = V(s[3], s[4], s[5]); }
        else if (s[0] === 'capX') { d = RAPIER.ColliderDesc.capsule(s[1], s[2]); t = V(s[3], s[4], s[5]); rq.set(0, 0, Math.SQRT1_2, Math.SQRT1_2); }
        else { d = RAPIER.ColliderDesc.roundCuboid(s[1], s[2], s[3], s[4]); t = V(s[5], s[6], s[7]); }
        t.applyQuaternion(qq).add(qp);
        rq.premultiply(qq);
        d.setTranslation(t.x, t.y, t.z).setRotation(rq);
        col(d, each);
      }
    }
    // off it goes: the limb's own motion, and the blade carrying through
    const push = vel.clone().multiplyScalar(0.22).addScaledVector(normalW.clone().multiplyScalar(Math.sign(normalW.dot(V(0, S.dir, 0).applyQuaternion(gq))) || 1), 0.6);
    body.setLinvel({ x: lv.x + push.x, y: lv.y + push.y + 0.4, z: lv.z + push.z }, true);
    body.setAngvel({ x: av.x + (Math.random() - 0.5) * 6, y: av.y + (Math.random() - 0.5) * 6, z: av.z + (Math.random() - 0.5) * 6 }, true);
    // its cut face (piece frame): where it bleeds from
    const face = { p: V(0, y0, 0).multiplyScalar(scale), n: nL.clone().negate() };
    // (whose, and what: for the people who see it lying there)
    const what = kind === 'fore' ? 'hand' : kind === 'upper' ? 'arm' : kind === 'thigh' || kind === 'shin' ? 'leg' : kind === 'head' ? 'head' : 'body';
    // (gen: which life of that body it came off - see restore)
    const ch0 = { group: chunk, body, cols, face, t: 0, solid: false, cuts: 1, anat: pieceAnat, actor, gen: actor.cutGen || 0, part, what };
    this.chunks.push(ch0);
    while (this.chunks.length > MAX_CHUNKS) this.drop(this.chunks[0]);

    // ---- what it does to them ----
    // the severed artery pumps out of the stump, with every beat the heart has left
    const JET = { head: 1.5, thigh: 1.45, upper: 1.1, shin: 0.85, fore: 0.7, foot: 0.4, hand: 0.4 };
    this.ctx.blood?.arteries?.add(actor, g, V(0, y0, 0), nL, S.torso ? 1.5 : JET[kind] ?? 1, kind === 'fore' || kind === 'shin' ? 40 : 80);
    actor.wounds?.chop(part, point, normalW.clone(), vel, V(0, 1, 0).applyQuaternion(gq), 1.6);
    // (a puppet's own client decides what it does to them)
    if (!puppet) {
      if (kind === 'head' && actor.organs) actor.organs.brainDeath = true;
      if (kind === 'head' || S.torso) actor.organs?.die();
      else if (!actor.brain.dead) actor.onPain?.(part, 'lost', 3);
      if (kind === 'thigh' || kind === 'shin' || S.torso) actor.crippled = true;
    }
    if (gib) this.burst(ch0, vel);
    else this.onSever?.(actor, part, ch0);
    // everyone else makes the same cut: through the same point of the part, the same way
    if (!net) this.onCut?.(actor, part, pL, nL, vel, seed, gib);
    this.ctx.sfx?.('flesh', 1);
    if (capped) this.ctx.sfx?.('chop', 0.8);
    return true;
  }

  /**
   * A blade swept from segment a0-b0 to a1-b1 over dt: any loose piece it passes through,
   * edge first and fast enough, is cut again along the blade's plane (not past MAX_CUTS); a
   * flat or slow blow just knocks it. `skip`: pieces this blow is done with (it adds to it).
   */
  slashChunks(a0, b0, a1, b1, dt, { edge, edges = 1, cleave = 1, power = 1, skip = null } = {}) {
    if (!this.chunks.length) return false;
    const axis = V().subVectors(b1, a1);
    if (axis.lengthSq() < 1e-8) return false;
    axis.normalize();
    const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    const p0 = V(), p1 = V(), d = V();
    let any = false;
    for (const c of [...this.chunks]) {
      if (skip?.has(c) || !this.chunks.includes(c)) continue;
      const t = c.body.translation();
      _p.set(t.x, t.y, t.z);
      if (_p.distanceToSquared(a1) > 1.5 && _p.distanceToSquared(b1) > 1.5) continue;
      // where the blade met it: rays along the blade at moments through the blow (the swept
      // area, densely), then along the path of points on the blade
      const cast = (from, to) => {
        d.subVectors(to, from);
        const len = d.length();
        if (len < 1e-4) return null;
        d.divideScalar(len);
        ray.origin = { x: from.x, y: from.y, z: from.z }; ray.dir = { x: d.x, y: d.y, z: d.z };
        for (const k of c.cols) {
          const toi = k.castRay(ray, len, true);
          if (toi >= 0) return { toi, point: from.clone().addScaledVector(d, toi) };
        }
        return null;
      };
      let hit = null;
      for (let i = 0; i <= 8 && !hit; i++) {
        p0.lerpVectors(a0, a1, i / 8); p1.lerpVectors(b0, b1, i / 8);
        const h = cast(p0, p1);
        if (h) {
          // the blade's velocity there: that point's way from last place to this
          const s_ = h.toi / Math.max(1e-4, p0.distanceTo(p1));
          const from = V().lerpVectors(a0, b0, s_), to = V().lerpVectors(a1, b1, s_);
          hit = { point: h.point, vel: to.sub(from).divideScalar(Math.max(dt, 1e-3)) };
        }
      }
      for (let i = 0; i <= 8 && !hit; i++) {
        p0.lerpVectors(a0, b0, i / 8); p1.lerpVectors(a1, b1, i / 8);
        const h = cast(p0, p1);
        if (h) hit = { point: h.point, vel: p1.clone().sub(p0).divideScalar(Math.max(dt, 1e-3)) };
      }
      if (!hit) continue;
      skip?.add(c);
      any = true;
      // how fast the blade met it (its own motion taken off)
      const cv = c.body.linvel();
      const vel = hit.vel.clone().sub(_s.set(cv.x, cv.y, cv.z));
      const sp = vel.length();
      const vd = vel.clone().divideScalar(Math.max(sp, 1e-4));
      const lead = edge ? (edges === 2 ? Math.abs(vd.dot(edge)) : vd.dot(edge)) : 0;
      const n = V().crossVectors(axis, vd);
      const cuts = lead >= 0.4 && sp * power * cleave * (0.6 + 0.4 * lead) >= NEED_LOOSE && n.lengthSq() > 1e-4;
      if (!cuts || !this.split(c, hit.point, n.normalize(), vel, skip)) {
        // knocked about instead
        const k = Math.min(1.5, c.body.mass()) * 0.12;
        c.body.applyImpulseAtPoint({ x: vel.x * k, y: vel.y * k + 0.3, z: vel.z * k }, { x: hit.point.x, y: hit.point.y, z: hit.point.z }, true);
        this.ctx.sfx?.('flesh', 0.35);
      }
    }
    return any;
  }

  /** Cut loose piece `c` in two along a world plane (normal nW through pointW). */
  split(c, pointW, nW, vel, skip) {
    if (!settings.dismember) return false;
    if (c.cuts >= MAX_CUTS) return false;
    const G = c.group;
    G.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(G.matrixWorld).invert();
    const planeC = new THREE.Plane().setFromNormalAndCoplanarPoint(nW, pointW).applyMatrix4(inv);
    const side = { neg: [], pos: [] };
    const outlines = [];
    const meshes = [];
    G.traverse((o) => { if (o.isMesh && o.layers.mask !== 0 && o.visible && !inWeapon(o, G)) meshes.push(o); });
    const Tc = makeTear(planeC, TEAR.loose);
    for (const o of meshes) {
      const M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);   // mesh -> piece frame
      const pm = planeC.clone().applyMatrix4(_m.copy(M).invert());
      const cut = sliceGeometry(o.geometry, pm, 'position', tearIn(Tc, M, pm));
      for (const k of ['neg', 'pos']) {
        if (!cut[k]) continue;
        const m = new THREE.Mesh(cut[k], o.material);
        m.userData = { ...o.userData };
        m.castShadow = true;
        m.matrixAutoUpdate = false;
        m.matrix.copy(M);
        side[k].push(m);
      }
      // (an old cut face gets split too, but its outline is just a line across: the layers
      // round it say where the new face goes)
      if (cut.neg && cut.pos && !o.userData.cap) for (const L of cut.loops) outlines.push(L.map((p) => p.clone().applyMatrix4(M)));
    }
    if (!side.neg.length || !side.pos.length) return false;
    // the new face, solid across everything it went through, both halves
    const sec = section(outlines, Tc, c.anat, inkOf(c.actor));
    if (sec) { side.neg.push(...sec(1)); side.pos.push(...sec(-1)); }
    // two pieces where there was one, each its own body (a hull round what it's made of)
    const t = c.body.translation(), r = c.body.rotation();
    const lv = c.body.linvel(), av = c.body.angvel();
    const mass = c.body.mass();
    const halves = [];
    for (const k of ['neg', 'pos']) {
      const pts = [];
      for (const m of side[k]) {
        if (m.userData.cap) continue;
        const P = m.geometry.attributes.position;
        const step = Math.max(1, Math.floor(P.count / 120));
        for (let i = 0; i < P.count; i += step) { _s.fromBufferAttribute(P, i).applyMatrix4(m.matrix); pts.push(_s.x, _s.y, _s.z); }
      }
      if (pts.length < 12) return false;
      const box = new THREE.Box3().setFromArray(pts);
      halves.push({ k, pts: new Float32Array(pts), box, vol: Math.max(1e-6, box.getSize(_p).x * _p.y * _p.z) });
    }
    const total = halves[0].vol + halves[1].vol;
    const chunkScale = G.scale;
    this.drop(c);
    const nC = nW.clone();
    for (const H of halves) {
      const grp = new THREE.Group();
      grp.position.copy(G.position); grp.quaternion.copy(G.quaternion); grp.scale.copy(chunkScale);
      for (const m of side[H.k]) { m.matrix.decompose(m.position, m.quaternion, m.scale); grp.add(m); }
      this.ctx.scene.add(grp);
      const body = this.ctx.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(t.x, t.y, t.z)
        .setRotation(r).setLinearDamping(0.05).setAngularDamping(0.35).setCcdEnabled(true));
      // (the hull is in the piece's frame; that frame may be scaled/mirrored like the limb was)
      const sp = H.pts.slice();
      for (let i = 0; i < sp.length; i += 3) { sp[i] *= chunkScale.x; sp[i + 1] *= chunkScale.y; sp[i + 2] *= chunkScale.z; }
      const m = Math.max(0.05, mass * H.vol / total);
      const make = (desc) => this.ctx.world.createCollider(desc.setMass(m).setFriction(0.85).setRestitution(0.04).setCollisionGroups(GRACE), body);
      const sz = H.box.getSize(V()).multiply(chunkScale);
      const ball = () => {
        const cc = H.box.getCenter(V()).multiply(chunkScale);
        return make(RAPIER.ColliderDesc.ball(clamp(Math.min(Math.abs(sz.x), Math.abs(sz.y), Math.abs(sz.z)) / 2, 0.015, 0.08)).setTranslation(cc.x, cc.y, cc.z));
      };
      // (a sliver too thin for a hull, or one rapier won't build: a small ball instead)
      let col = null;
      if (Math.min(Math.abs(sz.x), Math.abs(sz.y), Math.abs(sz.z)) > 0.006) {
        try { col = make(RAPIER.ColliderDesc.convexHull(sp)); } catch { col = null; }
      }
      const cols = [col || ball()];
      // apart along the cut, with a bit of the blade's push
      const sgn = H.k === 'pos' ? 1 : -1;
      const push = nC.clone().multiplyScalar(sgn * 0.7).addScaledVector(vel, 0.08);
      body.setLinvel({ x: lv.x + push.x, y: lv.y + push.y, z: lv.z + push.z }, true);
      body.setAngvel({ x: av.x + (Math.random() - 0.5) * 3, y: av.y + (Math.random() - 0.5) * 3, z: av.z + (Math.random() - 0.5) * 3 }, true);
      // bleeds (briefly) from its new face
      _q.set(r.x, r.y, r.z, r.w).invert();
      const face = {
        p: pointW.clone().sub(_p.set(t.x, t.y, t.z)).applyQuaternion(_q),
        n: nC.clone().multiplyScalar(-sgn).applyQuaternion(_q),
      };
      const ch = { group: grp, body, cols, face, t: 0, solid: false, cuts: c.cuts + 1, anat: c.anat, actor: c.actor, gen: c.gen, part: c.part, what: c.what };
      this.chunks.push(ch);
      skip?.add(ch);
    }
    while (this.chunks.length > MAX_CHUNKS) this.drop(this.chunks[0]);
    this.ctx.sfx?.('flesh', 0.8);
    this.ctx.sfx?.('chop', 0.5);
    this.ctx.blood?.inked(c.actor).spray(pointW, nC, 1.5, 6, 0.8, 0.9);
    this.ctx.blood?.inked(c.actor).spray(pointW, nC.clone().negate(), 1.5, 6, 0.8, 0.9);
    return true;
  }

  /**
   * A piece blown apart where it is: a spray of blood and bits (skin, hair, bone, meat) going
   * on the way the shot was, and nothing of it left whole. The bits are small debris bodies
   * that land, roll and are cleared like the rest of the junk.
   */
  burst(c, vel) {
    const A = c.actor, B = this.ctx.blood, D = this.ctx.debris;
    const t = c.body.translation(), at = V(t.x, t.y, t.z);
    const lv = c.body.linvel();
    const dir = vel.lengthSq() > 1e-6 ? vel.clone().normalize() : V(0, 1, 0);
    this.drop(c);
    if (B) {
      // (inked() colours only the next spray: each one asks again)
      B.inked(A).spray(at, dir, 8, 70, 0.55, 1.2);
      B.inked(A).spray(at, V(0, 1, 0), 4, 30, 0.9, 1);
      B.inked(A).spray(at, dir.clone().negate().setY(0.3).normalize(), 3, 14, 0.8, 0.8);
      for (let i = 0; i < 4; i++) B.inked(A).drip(at.clone().add(V(rnd(-0.05, 0.05), 0, rnd(-0.05, 0.05))), dir.clone().multiplyScalar(rnd(1.5, 4)), 0.012);
    }
    if (D) {
      const M = A.hero.mat, ink = inkOf(A);
      const mats = gibMats(ink);
      const kinds = [
        [M.skin, 5, 0.018, 0.03], [M.hair, 3, 0.016, 0.026], [mats.meat, 7, 0.012, 0.026],
        [mats.bone, 4, 0.01, 0.02], [mats.dark, 3, 0.008, 0.014],
      ];
      for (const [mat, n, r0, r1] of kinds) for (let i = 0; i < n; i++) {
        const r = rnd(r0, r1);
        const m = new THREE.Mesh(GIB_GEO, mat);
        m.scale.set(r * rnd(0.8, 1.6), r * rnd(0.4, 0.9), r * rnd(0.8, 1.4));
        m.castShadow = true;
        this.ctx.scene.add(m);
        const out = V(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)).normalize();
        const v = dir.clone().multiplyScalar(rnd(3, 8)).addScaledVector(out, rnd(1.5, 4)).add(V(lv.x, lv.y + 1, lv.z));
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(0, 6), rnd(0, 6), rnd(0, 6)));
        D.add(m, { ball: r * 0.8 }, {
          pos: at.clone().addScaledVector(out, 0.04), quat: q, vel: v, angVel: V(rnd(-20, 20), rnd(-20, 20), rnd(-20, 20)),
          mass: 0.02, restitution: 0.1, friction: 0.9, kind: 'gore', cap: 90, damping: 0.1, angDamping: 1.2,
        });
      }
    }
    this.ctx.sfx?.('gib', 1);
    this.ctx.sfx?.('splat', 0.8);
  }

  drop(c) {
    const i = this.chunks.indexOf(c);
    if (i >= 0) this.chunks.splice(i, 1);
    this.ctx.world.removeRigidBody(c.body);
    c.group.removeFromParent();
  }

  /** Is chunk c a piece of actor's current body (not one from before a respawn)? */
  ownedBy(c, actor) { return c.actor === actor && c.gen === (actor.cutGen || 0); }

  /**
   * Everything that came off actor, gone: they've left for good (a disconnect). Their pooled
   * body goes to someone else next, so nothing of theirs may be left lying about claiming it.
   */
  dropActor(actor) {
    for (const c of this.chunks.filter((c) => c.actor === actor)) this.drop(c);
    this.spurts = this.spurts.filter((s) => s.actor !== actor);
    this.ctx.blood?.arteries?.clearActor(actor);
  }

  /**
   * Whole again (a respawn, a recycled body, a cut resync). What was cut off before stays in
   * the world as it lies - gore that's there, the same on every client - but it's no longer
   * part of this body: the generation moves on, so nothing (a grab carrying on with a piece,
   * a cut on the new body) mistakes those pieces for its own. Disconnects clear them outright
   * (dropActor).
   */
  restore(actor) {
    const rec = actor._cut;
    if (!rec) return;
    for (const o of rec.hidden) { o.layers.mask = o.userData._mask ?? 1; o.userData.cut = false; }
    for (const o of rec.added) o.removeFromParent();
    for (const [arr, orig, stump] of rec.swaps.reverse()) { const i = arr.indexOf(stump); if (i >= 0) arr[i] = orig; }
    actor.healGash?.(); // (gash.js: and the half-cut ones)
    actor._cut = null;
    // (a new generation of this body: cuts from before it no longer apply)
    actor.cutGen = (actor.cutGen || 0) + 1;
    actor.rd.restore((h) => actor.brain.hands?.own?.add(h));
    this.spurts = this.spurts.filter((s) => s.actor !== actor);
    this.ctx.blood?.arteries?.clearActor(actor);
  }

  /** Once a frame, after physics: pieces follow their bodies; both ends bleed. */
  update(dt) {
    const B = this.ctx.blood;
    for (const c of this.chunks) {
      c.t += dt;
      if (!c.solid && c.t > 0.25) {
        c.solid = true;
        for (const k of c.cols) k.setCollisionGroups(SOLID);
      }
      const t = c.body.translation(), r = c.body.rotation();
      c.group.position.set(t.x, t.y, t.z);
      c.group.quaternion.set(r.x, r.y, r.z, r.w);
      c.group.updateMatrixWorld(true);
      if (B && c.t < 2.2 && Math.random() < 0.6) {
        _q.set(r.x, r.y, r.z, r.w);
        const p = c.face.p.clone().applyQuaternion(_q).add(_p.set(t.x, t.y, t.z));
        const d = c.face.n.clone().applyQuaternion(_q);
        B.inked(c.actor).spray(p, d, 1.6 * (1 - c.t / 2.2) + 0.3, 1, 0.5, 0.8);
      }
    }
    for (let i = this.spurts.length - 1; i >= 0; i--) {
      const s = this.spurts[i];
      s.t += dt;
      if (s.t > s.dur) { this.spurts.splice(i, 1); continue; }
      if (!B) continue;
      // the heart pumping it out of the stump, weaker and weaker
      const beat = Math.max(0, Math.sin(s.t * 8.5));
      if (beat < 0.35 || Math.random() > 0.7) continue;
      const k = 1 - s.t / s.dur;
      s.g.updateWorldMatrix(true, false);
      const p = s.g.localToWorld(V(0, s.y, 0));
      s.g.getWorldQuaternion(_q);
      const d = s.n.clone().applyQuaternion(_q);
      B.inked(s.actor).spray(p, d, 3.2 * k * beat + 0.4, 2, 0.28, 1);
    }
  }

  clear() {
    for (const c of [...this.chunks]) this.drop(c);
    this.spurts = [];
  }
}
