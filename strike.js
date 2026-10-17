import * as THREE from 'three';

/*
  Melee contact: a swinging segment (fist, bat, blade) swept between two frames and tested
  against every body part's capsule, whatever the target is doing (walking, sitting, ragdolled).
  The capsules come straight from the ragdoll's collision shapes, and the part frames match the
  animated bone groups one to one, so the same test works in every mode.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Per part: an axis segment a-b (part-local) and a radius, from the ragdoll shapes. */
let CAPS = null;
function capsules(rd) {
  if (CAPS) return CAPS;
  CAPS = {};
  for (const name of rd.names) {
    const s = rd.defs[name].shapes[0];
    let a, b, r;
    if (s[0] === 'capY') { a = V(s[3], s[4] - s[1], s[5]); b = V(s[3], s[4] + s[1], s[5]); r = s[2]; }
    else if (s[0] === 'capX') { a = V(s[3] - s[1], s[4], s[5]); b = V(s[3] + s[1], s[4], s[5]); r = s[2]; }
    else {
      // rounded box: along its longest axis, as thick as the next one
      const [hx, hy, hz, rr, x, y, z] = s.slice(1);
      const ext = [hx, hy, hz], i = ext.indexOf(Math.max(...ext));
      const e = ext.slice().sort((p, q) => q - p);
      const d = V(); d.setComponent(i, ext[i] - e[1]);
      a = V(x, y, z).sub(d); b = V(x, y, z).add(d); r = e[1] + rr;
    }
    // the head gets a little extra for the ears / nose, torso for clothes
    if (name === 'head') r += 0.01;
    CAPS[name] = { a, b, r };
  }
  return CAPS;
}

/** Part `name`'s capsule in its own frame: { a, b, r } (a stump's, if it's been cut). */
export function capsuleOf(A, name) {
  const P = A.rd.parts[name];
  return P?.cap || capsules(A.rd)[name];
}

/** Closest points between segments p1-q1 and p2-q2. Returns squared distance; s, t, c1, c2 filled. */
const _d1 = V(), _d2 = V(), _r = V();
function segSeg(p1, q1, p2, q2, out) {
  _d1.subVectors(q1, p1); _d2.subVectors(q2, p2); _r.subVectors(p1, p2);
  const a = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_r);
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) { s = t = 0; }
  else if (a <= 1e-9) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = _d1.dot(_r);
    if (e <= 1e-9) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = _d1.dot(_d2), den = a * e - b * b;
      s = den !== 0 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  out.s = s; out.t = t;
  out.c1.copy(p1).addScaledVector(_d1, s);
  out.c2.copy(p2).addScaledVector(_d2, t);
  return out.c1.distanceToSquared(out.c2);
}

const _pa = V(), _pb = V(), _q = new THREE.Quaternion(), _p = V();
const _A = V(), _B = V();
const res = { s: 0, t: 0, c1: V(), c2: V() };

/**
 * Part `name` of A against world point p: the capsule's centre, the closest point on its
 * surface, the normal into the body there, and how far p is outside it (negative: inside).
 */
export function partNear(A, name, p) {
  const P = A.rd.parts[name];
  if (!P || P.gone) return null;
  const cap = P.cap || capsules(A.rd)[name];
  const at = V(), q = new THREE.Quaternion();
  // (someone else's ragdoll is simulated on their client: here, only its rendered bones are where it is)
  if (A.mode === 'ragdoll' && !A.remote) { A.rd.pos(name, at); A.rd.quat(name, q); }
  else { const g = A.groups[name]; g.updateWorldMatrix(true, false); g.getWorldPosition(at); g.getWorldQuaternion(q); }
  const a = cap.a.clone().applyQuaternion(q).add(at), b = cap.b.clone().applyQuaternion(q).add(at);
  const ab = b.clone().sub(a), len2 = ab.lengthSq();
  const t = len2 > 1e-9 ? clamp(p.clone().sub(a).dot(ab) / len2, 0, 1) : 0;
  const axis = a.clone().addScaledVector(ab, t);
  const n = axis.clone().sub(p);
  const d = n.length();
  if (d < 1e-6) n.set(0, 0, 1); else n.divideScalar(d);
  return { center: a.clone().lerp(b, 0.5), point: axis.clone().addScaledVector(n, -cap.r), normal: n, dist: d - cap.r, r: cap.r };
}

/**
 * Sweep segment (a0,b0) -> (a1,b1) of radius `wr` over `actors` (skipping `self` and anyone in
 * `skip`). Returns the first contact: { actor, part, point, normal (into the body), s (0..1 along
 * the swinging segment), k (0..1 through the sweep) } or null.
 */
/** selfParts: a Set of part names - `self` can be hit too, everywhere but those (VR: your own weapon on you). */
export function sweep(a0, b0, a1, b1, wr, actors, self, skip, selfParts = null) {
  let best = null;
  const N = 5;
  for (const A of actors) {
    if ((A === self && !selfParts) || skip?.has(A) || A.hero.shown === false) continue; // (not drawn: not there)
    // cheap reject: nowhere near this person
    const c = A.mode === 'ragdoll' ? A.rd.pos('pelvis', _p) : _p.copy(A.hero.pos).setY(A.hero.pos.y + 0.9);
    if (c.distanceToSquared(a1) > 4 && c.distanceToSquared(b1) > 4) continue;
    const C = capsules(A.rd);
    if (A.mode !== 'ragdoll') A.hero.root.updateMatrixWorld(true);
    for (const name of A.rd.names) {
      const P = A.rd.parts[name];
      if (P.gone) continue;                   // (cut off: it's flying about on its own)
      if (A === self && selfParts.has(name)) continue;
      const cap = P.cap || C[name];
      if (A.mode === 'ragdoll') { A.rd.pos(name, _p); A.rd.quat(name, _q); }
      else { const g = A.groups[name]; g.getWorldPosition(_p); g.getWorldQuaternion(_q); }
      _pa.copy(cap.a).applyQuaternion(_q).add(_p);
      _pb.copy(cap.b).applyQuaternion(_q).add(_p);
      const R = cap.r + wr;
      for (let i = 0; i <= N; i++) {
        const k = i / N;
        if (best && k > best.k) break;
        _A.lerpVectors(a0, a1, k); _B.lerpVectors(b0, b1, k);
        const d2 = segSeg(_A, _B, _pa, _pb, res);
        if (d2 >= R * R) continue;
        const d = Math.sqrt(d2);
        if (best && k === best.k && d >= best.d) break;
        const n = V().subVectors(res.c2, res.c1);
        if (n.lengthSq() < 1e-10) n.subVectors(_pb, _pa).cross(_B.clone().sub(_A)).normalize();
        else n.normalize();
        best = {
          actor: A, part: name, k, d, s: res.s,
          point: res.c2.clone().addScaledVector(n, -cap.r),
          normal: n,
        };
        break;
      }
    }
  }
  return best;
}
