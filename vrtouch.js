import * as THREE from 'three';
import { sweep, capsuleOf } from './strike.js';

/*
  Your hands (and a melee weapon) against other people in VR: they're solid. A hand or blade
  pushed into someone shoves them out of the way (a standing body steps aside, a ragdoll's limb
  is pushed for real); a quick shove knocks them stumbling; and a fist - grip and trigger both
  squeezed - swung into them lands a punch, as hard as you threw it.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const HANDS = ['left', 'right'];
const PALM_R = 0.045;
const PUNCH_V = 2.2;   // m/s a fist has to be going to land a blow
const SHOVE_V = 4.2;   // m/s an open hand has to be going to knock someone off balance (slower: a push they stay on their feet for)
const _n = V(), _p = V(), _i = V(), _at = V(), _ca = V(), _cb = V(), _aq = new THREE.Quaternion();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const SS = { s: 0, t: 0, c1: V(), c2: V() };
const _d1 = V(), _d2 = V(), _r = V();
/** Closest points between segments p1-q1 and p2-q2 (Ericson): squared distance; out.s / t / c1 / c2. */
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

export class VRTouch {
  constructor(vr) {
    this.vr = vr;
    this.prev = { left: null, right: null };
    this.cool = new Map();
    this.toolPrev = {};    // a held weapon's segment last frame (to tell how fast it's pushing) // actor -> when it was last shoved / punched by a hand
  }

  others(at, r = 2.5) {
    const out = [];
    for (const A of this.vr.actors) {
      if (A === this.vr.hero || !A.rd || !A.groups || A.hero.shown === false || A.seat) continue;
      const c = A.mode === 'ragdoll' ? A.rd.pos('pelvis', _p) : _p.copy(A.hero.pos).setY(A.hero.pos.y + 0.9);
      if (c.distanceTo(at) < r) out.push(A);
    }
    return out;
  }

  /** Every frame, after the arms are posed (vr.js frame). */
  update() {
    const vr = this.vr, me = vr.hero;
    const t = performance.now(), dt = Math.min(0.05, (t - (this.t || t)) / 1000);
    this.t = t;
    this.dt = dt;
    if (!vr.on || me.seat || me.brain?.dead || me.mode === 'ragdoll' || dt <= 0) { this.prev.left = this.prev.right = null; this.toolPrev = {}; return; }
    const now = performance.now();
    for (const [A, t] of this.cool) if (now - t > 450) this.cool.delete(A);
    for (const hand of HANDS) {
      const palm = vr.palm[hand], pv = vr.palmVel[hand], was = this.prev[hand];
      this.prev[hand] = palm.clone();
      if (!vr.freeNow[hand] || vr.held[hand] || !was) continue;
      const fist = vr.btnVal(hand, 1) > 0.5 && vr.btnVal(hand, 0) > 0.5;
      const speed = pv.length();
      const near = this.others(palm);
      if (!near.length) continue;
      // a punch: the fist swept from last frame to this one
      if (fist && speed > PUNCH_V) {
        const skip = new Set([...this.cool.keys(), ...vr.hitSkip.keys()]);
        const hit = sweep(was, was, palm, palm, PALM_R, near, me, skip);
        if (hit) { this.punch(hand, hit, pv, speed); continue; }
      }
      // touching: pushed out of the way
      for (const A of near) this.press(A, palm, palm, PALM_R, pv, pv, hand, !fist && speed > SHOVE_V);
    }
    // what's in the hand is solid too - a bat, a blade, a gun's barrel: pushed into someone, it
    // pushes them just like a hand does (the blows themselves are vr.js holdMelee's / the gun's)
    const tools = [];
    const S = vr.prevSeg, m = me.meleeHeld;
    // (not a cutting edge: the machete goes INTO them - slicing/BladeCutter.js - it doesn't push them away)
    if (S && m && S.m === m && m.state === 'held' && !m.stuckIn && !m.cutter) tools.push({ key: 'melee', a: S.a, b: S.b, r: Math.max(0.03, m.def?.r || 0.03) });
    const g = me.gunHeld;
    if (g && g.state === 'held' && g.mesh && g.M?.muzzle) {
      g.mesh.updateWorldMatrix(true, false);
      tools.push({ key: 'gun', a: V().setFromMatrixPosition(g.mesh.matrixWorld), b: g.M.muzzle.clone().applyMatrix4(g.mesh.matrixWorld), r: 0.04 });
    }
    const keep = {};
    for (const T of tools) {
      const was = this.toolPrev[T.key];
      keep[T.key] = { a: T.a.clone(), b: T.b.clone() };
      if (!was) continue;
      const near = this.others(_i.copy(T.a).lerp(T.b, 0.5), 3);
      if (!near.length) continue;
      const va = T.a.clone().sub(was.a).divideScalar(dt).clampLength(0, 10), vb = T.b.clone().sub(was.b).divideScalar(dt).clampLength(0, 10);
      for (const A of near) this.press(A, T.a, T.b, T.r, va, vb, 'right', false, 1);
    }
    this.toolPrev = keep;
  }

  /**
   * Segment a-b (radius r: a palm is a = b, a gun's barrel or a bat its length; va / vb how fast
   * each end is going) against every part of A's body: the deepest overlap is resolved, all of it -
   * the body is moved out of the way, never the hand or weapon through it.
   */
  press(A, a, b, r, va, vb, hand, shove, k = 1) {
    let best = null;
    if (A.mode !== 'ragdoll') A.hero.root.updateMatrixWorld(true);
    for (const name of A.rd.names) {
      const Pt = A.rd.parts[name];
      if (!Pt || Pt.gone) continue;
      const cap = capsuleOf(A, name);
      if (A.mode === 'ragdoll') { A.rd.pos(name, _at); A.rd.quat(name, _aq); }
      else { const g = A.groups[name]; if (!g) continue; g.getWorldPosition(_at); g.getWorldQuaternion(_aq); }
      _ca.copy(cap.a).applyQuaternion(_aq).add(_at);
      _cb.copy(cap.b).applyQuaternion(_aq).add(_at);
      const d2 = segSeg(a, b, _ca, _cb, SS);
      const R = r + cap.r;
      if (d2 >= R * R) continue;
      const d = Math.sqrt(d2), pen = R - d;
      if (best && pen <= best.pen) continue;
      const n = V().subVectors(SS.c2, SS.c1);
      if (d > 1e-6) n.divideScalar(d); else n.set(0, 0, 0);
      best = { name, pen, n, s: SS.s, c1: SS.c1.clone(), point: SS.c2.clone().addScaledVector(n, -cap.r), r: cap.r };
    }
    if (!best) return;
    const vel = V().lerpVectors(va, vb, best.s);
    const n = best.n;
    // (gone in past the middle of the limb - or dead centre: out the way it was going, not back through)
    if (n.lengthSq() < 0.5 || (best.pen > r + best.r * 0.6 && vel.dot(n) < 0)) {
      if (vel.lengthSq() < 1e-4) return;
      n.copy(vel).normalize();
    }
    const pen = best.pen;
    const dt = Math.max(1 / 120, this.dt || 1 / 72);
    if (A.remote) {
      if (shove && !this.cool.has(A)) { this.cool.set(A, performance.now()); A.shove?.(_n.copy(n)); }
      return;
    }
    if (A.mode === 'ragdoll') {
      const P = A.rd.parts[best.name];
      if (!P?.body) return;
      // the part's own speed at the contact, along the push
      const lv = P.body.linvel();
      const into = vel.dot(n) - (lv.x * n.x + lv.y * n.y + lv.z * n.z);
      // enough to move with the hand / weapon, and out of it by next frame
      const dv = Math.max(0, into) + pen / dt * 0.7;
      const j = _i.copy(n).multiplyScalar(P.mass * Math.min(dv, 12) * k);
      const at = best.point;
      const jx = j.x, jy = j.y, jz = j.z, ax = at.x, ay = at.y, az = at.z;
      A.rd.phys(() => P.body.applyImpulseAtPoint({ x: jx, y: jy, z: jz }, { x: ax, y: ay, z: az }, true));
      if (Math.random() < 0.2) this.vr.buzz(hand, 0.15, 15);
      return;
    }
    if (shove && !this.cool.has(A)) {
      this.cool.set(A, performance.now());
      A.shove?.(_n.copy(n));
      this.vr.buzz(hand, 0.45, 40);
      this.vr.sfx?.('whoosh', 0.4);
      return;
    }
    // standing: a body with weight. The push goes into them (actor.js pushed): the trunk leans
    // away first, then they step back under it, keeping their momentum a moment after
    const h = A.hero;
    _n.set(n.x, 0, n.z);
    if (_n.lengthSq() < 1e-6) return;
    _n.normalize();
    const P = A.pushV || (A.pushV = V());
    const into = Math.max(0, vel.x * _n.x + vel.z * _n.z);
    const along = P.x * _n.x + P.z * _n.z;
    const want = Math.min(3.2, into * 0.9 + pen * 8);
    const gain = Math.max(0, want - along) * Math.min(1, dt * 14) + pen * 30 * dt;
    P.addScaledVector(_n, gain * k);
    A.pushPress = Math.min(1, (A.pushPress || 0) + pen * 40 + into * 0.3);
    // and nothing goes through them: the overlap taken out in full, the body moved clear
    // (flat: the push along the ground - pressing down on someone doesn't sink them)
    const flat = Math.hypot(n.x, n.z);
    h.pos.addScaledVector(_n, Math.min(0.25, pen * flat));
    if (Math.random() < 0.3) this.vr.buzz(hand, Math.min(0.5, 0.1 + into * 0.15), 15);
  }

  punch(hand, hit, pv, speed) {
    const vr = this.vr, A = hit.actor, me = vr.hero;
    const c = Math.min(1, (speed - PUNCH_V) / 5); // (how hard: 0 a jab .. 1 everything behind it)
    const head = hit.part === 'head' || hit.part === 'neck';
    const vel = pv.clone().clampLength(0, 16);
    A.struck(hit.part, hit.point, vel, hit.normal,
      { kind: 'fist', mass: 5 + 5 * c, sev: 0.45 * (1 + 1.2 * c), ref: 7, maxImp: (head ? 55 : 75) * (1 + 0.8 * c) }, me);
    this.cool.set(A, performance.now());
    vr.hitSkip.set(A, performance.now());
    vr.sfx?.('punch', 0.8 + 0.2 * c, { rate: 0.9 + Math.random() * 0.2 });
    vr.sfx?.('impact', (head ? 0.3 : 0.45) + 0.35 * c, { rate: 0.55 });
    vr.buzz(hand, Math.min(1, 0.45 + c * 0.5), 60);
  }
}
