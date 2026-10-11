import * as THREE from 'three';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _d = new THREE.Vector3(), _p = new THREE.Vector3();

const _k = new THREE.Vector3();
/**
 * Place obj at `from`, its +Y pointing back from `to` toward `from`, +Z toward `hint`.
 * keep: the bone remembers its roll, and when the hint runs (nearly) along the bone - an arm
 * pointing straight ahead with a forward hint - the roll carries on from last frame instead of
 * flipping about (a twitch). With a clear hint it's exactly as without.
 */
export function orient(obj, from, to, hint, keep = false) {
  _y.subVectors(from, to).normalize();
  const hl = hint.length() || 1;
  _z.copy(hint).addScaledVector(_y, -hint.dot(_y));
  if (keep) {
    const w = _z.length() / hl;                   // how much of the hint is across the bone (0..1)
    const mem = obj.userData.rollZ;
    if (mem && w < 0.6) {
      _k.copy(mem).addScaledVector(_y, -mem.dot(_y));
      _z.multiplyScalar(1 / hl).addScaledVector(_k, (0.6 - w) / 0.6 * 2);
    }
  }
  if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1);
  _z.normalize();
  if (keep) (obj.userData.rollZ ||= new THREE.Vector3()).copy(_z);
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  obj.position.copy(from);
  obj.quaternion.setFromRotationMatrix(_m);
}

/** Two-bone IK: mid joint -> outMid, reachable end -> outEnd. */
export function solveTwoBone(a, target, L1, L2, pole, outMid, outEnd) {
  _d.subVectors(target, a);
  let dist = _d.length();
  const dir = _d.divideScalar(dist || 1);
  dist = clamp(dist, 0.02, L1 + L2 - 0.001);
  const x = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, L1 * L1 - x * x));
  _p.copy(pole).addScaledVector(dir, -pole.dot(dir));
  // (a pole straight along the limb says nothing about the bend: any side rather than NaN)
  if (_p.lengthSq() < 1e-10) {
    _p.set(dir.y, -dir.x, 0);
    if (_p.lengthSq() < 1e-6) _p.set(0, dir.z, -dir.y);
  }
  _p.normalize();
  outMid.copy(a).addScaledVector(dir, x).addScaledVector(_p, h);
  outEnd.copy(a).addScaledVector(dir, dist);
}

const _q = new THREE.Quaternion(), _l = new THREE.Vector3();
/**
 * Which way a knee bends, for a leg from hip joint `hip` to `ankle` under a pelvis at world
 * rotation `hipsQ`: forward of the thigh within the body's own front-back plane - forward for
 * a leg hanging down, up for a thigh raised in front (sitting, tucked), down for a leg stretched
 * out behind (prone, kneeling) - turned out a little on the leg's side (+1 left). Never along the
 * leg, so the knee can't flip over whatever the pelvis is doing (rolls, getting up).
 */
export function kneePole(hipsQ, hip, ankle, side, out, splay = 0.1) {
  _q.copy(hipsQ).invert();
  _l.subVectors(ankle, hip).applyQuaternion(_q);           // the leg in the pelvis frame
  const k = Math.hypot(_l.y, _l.z);
  if (k < 1e-4) out.set(0, 0, 1);                          // (straight out to the side: forward)
  else out.set(0, _l.z / k, -_l.y / k);                    // the leg's direction turned -90 deg about pelvis X
  out.x += side * splay;
  return out.normalize().applyQuaternion(hipsQ);
}

const _cq = new THREE.Quaternion(), _cl = new THREE.Vector3(), _cn = new THREE.Vector3();
const TRUNK = new Set(['pelvis', 'spine', 'chest']);
/**
 * Where a hand can really hold a wound. `p` / `n` (world point and outward normal, changed in
 * place) on body part `part`; the chest at world `chestPos` / `chestQ`; the hand on `side` (+1
 * left). A wound on the back of the trunk can't be reached where it is - between the shoulder
 * blades, or across the spine - so the hand goes round its own side onto the back, low, as near
 * as it gets. Returns how far round the back that is (0 in front .. 1 behind), for the elbow and
 * the hand's turn.
 */
export function clutchReach(part, p, n, chestPos, chestQ, side) {
  if (!TRUNK.has(part)) return 0;
  _cq.copy(chestQ).invert();
  _cl.subVectors(p, chestPos).applyQuaternion(_cq);          // chest frame: x left, y up, z forward
  const back = clamp((0.02 - _cl.z) / 0.08, 0, 1);
  if (back <= 0) return 0;
  const k = back * back * (3 - 2 * back);
  const x = side > 0 ? Math.max(_cl.x, 0.07) : Math.min(_cl.x, -0.07);
  _cl.x += (x - _cl.x) * k;
  _cl.y += (Math.min(_cl.y, -0.03) - _cl.y) * k;
  p.copy(_cl).applyQuaternion(chestQ).add(chestPos);
  _cn.copy(n).applyQuaternion(_cq).lerp(_l.set(side * 0.3, 0, -1).normalize(), k).normalize();
  n.copy(_cn).applyQuaternion(chestQ);
  return k;
}
/** Which hand holds a wound on `part` at part-frame point `local` (0 left, 1 right). */
export function clutchHand(part, local) {
  const side = /L$/.test(part) ? 1 : /R$/.test(part) ? -1 : 0;
  // an arm: the other hand; a leg, the head: the one on its side
  if (/^(upper|fore)/.test(part)) return side > 0 ? 1 : 0;
  if (side) return side > 0 ? 0 : 1;
  const s = local.x > 0.01 ? 1 : local.x < -0.01 ? -1 : (Math.random() < 0.5 ? 1 : -1);
  // high on the flank, under the arm, in front of the spine: that arm can't fold onto it - the
  // other hand comes across the chest
  if (part === 'chest' && Math.abs(local.x) > 0.12 && local.y > -0.06 && local.z > -0.07) return s > 0 ? 1 : 0;
  return s > 0 ? 0 : 1;
}
