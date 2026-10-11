import * as THREE from 'three';
import { clutchReach, clutchHand } from './ik.js';
import { DIM } from './character.js';
import { TOTAL_MASS } from './ragdoll.js';
import { Hands } from './grab.js';
import { Neuro } from './neuro.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { groups, G_QUERY, G_WORLD, G_PROXY, G_CAR } from './physics.js';

/*
  Active-ragdoll behaviour layer (in the spirit of NaturalMotion's euphoria): every frame it
  reads the physical state (COM, capture point, contacts, tilt) and sets muscle targets and
  strengths. Behaviours:
    balance  - stepping to the capture point, arms out for balance, torso kept upright
    fall     - brace with arms toward the predicted impact, protect the face/head
    airborne - windmill arms and pedal legs
    ground   - tuck into a protective ball while tumbling, then relax
  Layered on top of every state:
    grab     - reach for and hold ledges, walls, poles and people to stay up / stop a fall
    brace    - see something coming fast (a runner, a tumbling body): hands up, flinch away
    impact   - the chest's path is traced ahead: about to hit a wall, a car, a person (or the
               ground), the free hands go out to meet it first and give with it
    look     - the head tracks what matters: whoever hurt us, then where the fall is taking us
    jolt     - a sudden change in momentum (being hit) knocks balance out of you
  A hurt brain (neuro.js) takes over when down: seizures, posturing, twitches.
*/

const { THIGH, SHIN, UPPER_ARM, FOREARM, ANKLE_H } = DIM;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const G = 9.81;
const UP = V(0, 1, 0);
const LEG = THIGH + SHIN;
const ARM2 = FOREARM + 0.07; // forearm + palm to the grip point

const _m = new THREE.Matrix4();
const _a = V(), _b = V(), _c = V(), _x = V(), _y = V(), _z = V();
const _q = new THREE.Quaternion(), _qa = new THREE.Quaternion();
const IMPACT_Q = groups(G_QUERY, G_WORLD | G_PROXY | G_CAR);
const HEAD_ONLY = new Set(['head']);
const _e = new THREE.Euler(), _lq = new THREE.Quaternion();
let RAY = null;

// rotation whose -Y is `u` and whose X is as close as possible to `xHint`
function boneQuat(u, xHint, out) {
  _y.copy(u).negate().normalize();
  _x.copy(xHint).addScaledVector(_y, -xHint.dot(_y));
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0).addScaledVector(_y, -_y.x);
  _x.normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}
const yawQuat = (yaw, pitch = 0, out = new THREE.Quaternion()) =>
  out.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
const flat = (v) => { v.y = 0; return v; };

/**
 * Of the bodies `others` ({pos, vel}), the one that will hit a body at pos/vel soonest:
 * closest approach within ~0.75 m, closing fast, less than ~0.7 s away. Null if none.
 */
export function findThreat(pos, vel, others, horizon = 0.7) {
  let best = null;
  const rel = V(), vr = V(), m = V();
  for (const o of others) {
    rel.subVectors(o.pos, pos);
    vr.subVectors(o.vel, vel);
    const vv = vr.lengthSq();
    if (vv < 4) continue;
    const tca = -rel.dot(vr) / vv;
    if (tca < 0 || tca > horizon) continue;
    const miss = m.copy(rel).addScaledVector(vr, tca).length();
    if (miss > 0.75) continue;
    const closing = -rel.dot(vr) / Math.max(rel.length(), 1e-3);
    if (closing < 2.2) continue;
    if (!best || tca < best.t) best = { t: tca, pos: o.pos.clone(), vel: o.vel.clone(), closing, miss };
  }
  return best;
}

export class Brain {
  constructor(rd) {
    this.rd = rd;
    this.P = rd.parts;
    this.legs = ['L', 'R'].map((n, i) => ({ n, side: i ? -1 : 1, swing: false, t: 0, from: V(), to: V(), plant: V() }));
    this.grip = [0.3, 0.3];
    this.qTmp = {};
    this.hands = new Hands(rd);
    this.threats = [];   // [{ pos, vel }] of other bodies, fed in each frame
    this.threat = null;  // the most imminent incoming one
    this.clutch = null;  // a wound one hand is clamped onto (survives falls)
    this.dead = false;
    this.neuro = new Neuro(this); // seizures, posturing, twitches: a hurt brain (neuro.js)
  }

  /** Shot: a hand goes to the wound and stays there. `local`/`nLocal` are in the part's frame. */
  wounded(part, local, nLocal) {
    // (the other hand for an arm; otherwise the one that can reach it: see ik.js clutchHand)
    const i = clutchHand(part, local), n = i === 0 ? 'L' : 'R';
    this.clutch = { part, local: local.clone(), nLocal: nLocal.clone(), n, i, t: 0 };
  }

  /**
   * Hurt by someone (by = their Actor), or from a point (a shot: back along the bullet): that's
   * who we watch for a while, and a hit while down makes us curl up tight for a moment.
   */
  hitBy(by, from) {
    this.attn = { by: by || null, p: (from || V()).clone(), t: 0, dur: 5 + Math.random() * 2 };
    this.flinchT = 0.45;
  }
  /** Where the one who hurt us is (their head), or null. */
  attnPoint(out) {
    const A = this.attn;
    if (!A) return null;
    const by = A.by;
    if (by) {
      if (by.mode === 'ragdoll') by.rd.pos('head', A.p);
      else if (by.groups?.head) by.groups.head.getWorldPosition(A.p);
      else A.p.copy(by.hero.pos).setY(by.hero.pos.y + 1.6);
    }
    return out.copy(A.p);
  }

  // ---------- muscle helpers ----------
  rel(name, x, z = 0, y = 0, s = 0.5, damping = 1) {
    const p = this.P[name];
    p.world = null; p.targetQ = null;
    p.target.x = x; p.target.y = y; p.target.z = z;
    p.strength = s; p.damping = damping;
  }
  relQ(name, q, s, damping = 1) {
    const p = this.P[name];
    p.world = null;
    p.targetQ = (p._tq ||= new THREE.Quaternion()).copy(q);
    p.strength = s; p.damping = damping;
  }
  wld(name, q, s, damping = 1) {
    const p = this.P[name];
    p.targetQ = null;
    p.world = (p._tw ||= new THREE.Quaternion()).copy(q);
    p.strength = s; p.damping = damping;
  }
  // mirror a side-dependent value
  both(fn) { fn('L', 1); fn('R', -1); }

  /** Two-bone leg IK toward a world ankle position (hOff raises the hip target). */
  legIK(n, ankle, s, hOff = 0, frame = null) {
    const rd = this.rd;
    // solve in the desired pelvis frame (world-space hip targets, SIMBICON style) so the
    // stance hip also works to right the pelvis
    const pel = frame ? _qa.copy(frame) : rd.quat('pelvis', _qa);
    const hip = rd.point('pelvis', this.P['thigh' + n].def.anchor, _a);
    const d = _b.subVectors(ankle, hip);
    d.y -= hOff;
    d.applyQuaternion(_q.copy(pel).invert());
    // in this body's own proportions (height-scaled), measured in unit-size lengths
    d.divideScalar(rd.S || 1);
    const kl = rd.kL || 1, TH = THIGH * kl, SH = SHIN * kl;
    const L = clamp(d.length(), 0.3 * kl, LEG * kl - 0.004);
    d.normalize();
    const k = Math.PI - Math.acos(clamp((TH * TH + SH * SH - L * L) / (2 * TH * SH), -1, 1));
    const al = Math.acos(clamp((TH * TH + L * L - SH * SH) / (2 * TH * L), -1, 1));
    const ax = _c.crossVectors(d, _z.set(0, 0, 1));
    if (ax.lengthSq() < 1e-6) ax.set(-1, 0, 0);
    ax.normalize();
    const u = d.clone().applyAxisAngle(ax, al);
    boneQuat(u, ax.negate(), _q);
    if (frame) this.wld('thigh' + n, _q.premultiply(frame), s);
    else this.relQ('thigh' + n, _q, s);
    this.rel('shin' + n, k, 0, 0, s);
  }

  /** Two-bone arm IK toward a world hand position. `pole` = elbow direction, chest space. */
  armIK(n, hand, pole, s, damping = 1) {
    const rd = this.rd;
    const ch = rd.quat('chest', _qa);
    const sh = rd.point('chest', this.P['upper' + n].def.anchor, _a);
    const d = _b.subVectors(hand, sh).applyQuaternion(_q.copy(ch).invert()).divideScalar(rd.S || 1);
    const ka = rd.kA || 1, UA = UPPER_ARM * ka, A2 = FOREARM * ka + 0.07;
    const L = clamp(d.length(), 0.12, UA + A2 - 0.004);
    d.normalize();
    const flex = Math.PI - Math.acos(clamp((UA ** 2 + A2 ** 2 - L * L) / (2 * UA * A2), -1, 1));
    const al = Math.acos(clamp((UA ** 2 + L * L - A2 ** 2) / (2 * UA * L), -1, 1));
    const ax = _c.crossVectors(d, pole);
    if (ax.lengthSq() < 1e-6) ax.set(1, 0, 0);
    ax.normalize();
    const u = d.clone().applyAxisAngle(ax, al);
    this.relQ('upper' + n, boneQuat(u, ax, _q), s, damping);
    this.rel('fore' + n, -flex, 0, 0, s, damping);
  }

  /** Arm pointing along chest-space direction u, elbow bent by flex. */
  armDir(n, u, flex, s, xHint = V(1, 0, 0), damping = 1) {
    this.relQ('upper' + n, boneQuat(u.clone().normalize(), xHint, _q), s, damping);
    this.rel('fore' + n, -flex, 0, 0, s, damping);
  }

  // ---------- state ----------
  heading() {
    let f = flat(this.rd.axis('pelvis', V(0, 0, 1)));
    if (f.lengthSq() < 0.04) f = flat(this.rd.axis('pelvis', V(0, -1, 0)));
    return Math.atan2(f.x, f.z);
  }

  start(kind, opts = {}) {
    this.t = 0;
    this.stateT = 0;
    this.yaw = this.heading();
    this.bal = opts.balance ?? 1;
    this.decay = opts.decay ?? 0.18;
    this.airT = 0;
    this.calmT = 0;
    this.protect = 0;
    this.relax = 0;
    this.okT = 0;
    this.impact = 0;
    this.collapse = kind === 'collapse';
    this.state = kind === 'collapse' ? 'fall' : 'balance';
    for (const l of this.legs) {
      l.swing = false;
      this.footPoint(l, l.plant);
    }
    this.lastStep = 0;
    this.recovered = false;
    this.seed = Math.random() * 100;
    this.daze = !!opts.daze;
    this.dazeAng = Math.random() * Math.PI * 2;
    this.dazeF = 0;
    this.panic = 0.7 + Math.random() * 0.3;
    this.writhe = 0;
    this.pain = 0;
    this.writheHold = 0;
    this.kickT = 0;
    this.catchLeg = null;
    this.handC = null;
    this.fallF = null;
    this.hands.reset();
    this.lastV = null;
    this.jolt = 0;
    this.braceW = 0;
    this.threat = null;
    this.holdEntry();
  }

  /**
   * The muscles pick up exactly the pose the body is in (seated, lying, mid-climb...), so
   * the first physics frames hold it instead of yanking toward stale targets; update() then
   * eases from it into whatever the behaviour wants.
   */
  holdEntry() {
    const rd = this.rd, E = (this.entry ||= {});
    for (const p of rd.list) {
      if (!p.parent) continue;
      const o = (E[p.name] ||= { q: new THREE.Quaternion(), x: 0, s: 0, d: 1 });
      const q = rd.quat(p.parent.name, _q).invert().multiply(rd.quat(p.name, _qa));
      if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      o.q.copy(q);
      o.x = 2 * Math.atan2(q.x, q.w);
      o.s = 0.45; o.d = 1;
      p.world = null;
      p.targetQ = (p._tq ||= new THREE.Quaternion()).copy(q);
      p.target.x = o.x;
      p.strength = o.s; p.damping = 1;
    }
    this.entryT = 0;
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.stateT = 0;
    if (s === 'fall') { this.catchLeg = null; this.handC = null; this.fallF = null; }
    if (s === 'ground') {
      // the harder the landing, the longer and harder he writhes
      const p = clamp((this.impact - 1.0) / 3.5, 0.3, 1);
      this.pain = Math.max(this.pain * 0.7, p);
      this.writheHold = Math.max(this.writheHold, 1.8 + 4.5 * p + Math.random() * 1.5);
    }
  }

  // smooth pseudo-noise in [-1, 1]
  wob(f, k = 0) {
    const t = this.t * f, s = this.seed + k * 7.31;
    return (Math.sin(t + s) + Math.sin(t * 1.73 + s * 2.1) * 0.6 + Math.sin(t * 0.61 + s * 0.7) * 0.4) / 2;
  }

  // ---------- pose blending ----------
  /** Snapshot every muscle's current target as a relative rotation (+ strength). */
  snapshot(out = {}, only = null) {
    const rd = this.rd;
    for (const p of rd.list) {
      if (!p.parent || (only && !only.has(p.name))) continue;
      const o = (out[p.name] ||= { q: new THREE.Quaternion(), x: 0, s: 0, d: 1 });
      o.s = p.strength; o.d = p.damping; o.x = p.target.x;
      if (p.hinge) continue;
      if (p.world) o.q.copy(rd.quat(p.parent.name, _q).invert()).multiply(p.world);
      else if (p.targetQ) o.q.copy(p.targetQ);
      else o.q.setFromEuler(new THREE.Euler(p.target.x, p.target.y, p.target.z, 'XZY'));
    }
    return out;
  }
  /** Blend current muscle targets back toward snapshot A: w = 1 keeps current, 0 gives A. */
  blendFrom(A, w, only = null) {
    if (w >= 0.999) return;
    const B = this.snapshot(this._snapB ||= {}, only);
    for (const p of this.rd.list) {
      if (!p.parent || (only && !only.has(p.name))) continue;
      const a = A[p.name], b = B[p.name];
      p.strength = lerp(a.s, b.s, w);
      p.damping = lerp(a.d, b.d, w);
      if (p.hinge) { p.target.x = lerp(a.x, b.x, w); continue; }
      p.world = null;
      p.targetQ = (p._tq ||= new THREE.Quaternion()).slerpQuaternions(a.q, b.q, w);
    }
  }

  footPoint(l, out) {
    // ankle position of a leg
    return this.rd.pos('foot' + l.n, out);
  }

  sense(dt) {
    const rd = this.rd;
    rd.updateContacts();
    this.com = rd.com(this.com || V());
    this.v = rd.comVel(this.v || V());
    this.gy = rd.groundY(this.com.x, this.com.z, this.com.y + 0.5);
    this.h = this.com.y - this.gy;
    const up = rd.axis('chest', V(0, 1, 0));
    this.chestUp = up;
    this.tilt = Math.acos(clamp(up.y, -1, 1));
    this.pelvisH = (rd.pos('pelvis').y - this.gy) / ((rd.S || 1) * (rd.hipK || 1));
    let any = false;
    for (const p of rd.list) if (p.touch) { any = true; break; }
    this.airT = any ? 0 : this.airT + dt;
    const P = this.P;
    this.torsoTouch = P.pelvis.touch || P.spine.touch || P.chest.touch || P.head.touch;
    this.spin = rd.angvel('chest').length();
    this.speed = this.v.length();

    // momentum awareness: an abrupt change in velocity (beyond gravity) means we got hit
    if (this.lastV) {
      const dv = _a.subVectors(this.v, this.lastV);
      dv.y += G * dt;
      this.jolt = dv.length();
    }
    (this.lastV ||= V()).copy(this.v);
    this.threat = this.senseThreat();
    this.imp = this.state === 'ground' ? null : this.predictImpact();
  }

  /**
   * Where the chest is about to hit something: its path traced ~0.55 s ahead under gravity
   * (reaching a little past the chest's centre: the shoulders and head get there first), cast
   * against the level, cars and people still on their feet. { point, normal, t, dir, ground } or null.
   */
  predictImpact() {
    const rd = this.rd, w = rd.world;
    if (!w || !this.hands) return null;
    const p0 = rd.pos('chest', this._ip0 ||= V()), v = rd.vel('chest', this._iv ||= V());
    if (v.lengthSq() < 0.8) return null;
    const own = this.hands.own;
    RAY ||= new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    const a = _a.copy(p0), b = _b;
    const lead = 0.18;
    let tPrev = 0;
    for (let i = 1; i <= 6; i++) {
      const t = i * 0.09;
      b.copy(p0).addScaledVector(v, t);
      b.y -= 0.5 * G * t * t;
      const d = _c.subVectors(b, a), len = d.length();
      if (len < 1e-4) { a.copy(b); tPrev = t; continue; }
      d.divideScalar(len);
      RAY.origin = { x: a.x, y: a.y, z: a.z };
      RAY.dir = { x: d.x, y: d.y, z: d.z };
      const h = w.castRayAndGetNormal(RAY, len + lead, true, undefined, IMPACT_Q, undefined, undefined, (c) => !own.has(c.handle) && c.parent()?.isEnabled() !== false);
      if (h) {
        const k = Math.min(1, h.timeOfImpact / len);
        const n = V(h.normal.x, h.normal.y, h.normal.z);
        if (n.dot(d) > -0.1) return null; // only grazing along it
        const toi = h.timeOfImpact;
        return { point: V(a.x + d.x * toi, a.y + d.y * toi, a.z + d.z * toi), normal: n, t: lerp(tPrev, t, k), dir: d.clone(), ground: n.y > 0.7 };
      }
      a.copy(b);
      tPrev = t;
    }
    return null;
  }

  /**
   * Of everything moving around us, the one that will hit us soonest: closest approach
   * within ~0.7 m, closing fast, less than ~0.7 s away.
   */
  senseThreat() { return findThreat(this.com, this.v, this.threats); }

  update(dt) {
    this.t += dt;
    this.stateT += dt;
    this.sense(dt);
    this.entryT = (this.entryT || 0) + dt;
    if (this.dead || this.inj?.out) {
      // out cold or dying: limp - unless the brain's misfiring (a fit, posturing, twitches)
      const N = this.neuro, w = this.inj?.weak || 0;
      if (!N.drive(dt, w)) {
        this.doDead(dt);
        if (!this.dead) N.twitch(dt, this.inj?.brain || 0);
      }
      this.fromEntry(0.3);
      return false;
    }
    this.deadT = 0;
    this.neuro.awake();
    this.hands.update(dt);
    // a hit knocks the balance out of us, in proportion to how hard it changed our momentum
    if (this.state === 'balance' && this.jolt > 0.9) this.bal = Math.max(0, this.bal - (this.jolt - 0.9) * 0.22);
    if (this.state === 'balance') this.doBalance(dt);
    if (this.state === 'fall' || this.state === 'air') this.doFall(dt);
    if (this.state === 'ground') this.doGround(dt);
    this.reactLayer(dt);
    this.lookLayer(dt);
    this.fromEntry(this.state === 'balance' ? 0.12 : 0.25);
    this.injuryLayer(dt);
    // lying there with a hurt brain: the odd jerk of a limb
    if (this.state === 'ground') this.neuro.twitch(dt, this.inj?.brain || 0);
    return this.recovered;
  }

  /** Ease the muscles from the pose we entered physics in to the behaviour's, over `dur`. */
  fromEntry(dur) {
    if (!this.entry || this.entryT >= dur) return;
    this.blendFrom(this.entry, smooth(clamp(this.entryT / dur, 0, 1)));
  }

  /**
   * What the organs say (organs.js): paralysed or broken parts have no muscle, blood loss and
   * holed lungs weaken everything, and anything that can't carry you keeps you on the floor.
   */
  injuryLayer(dt) {
    const I = this.inj;
    if (!I) return;
    if (I.noRise) {
      this.recovered = false;
      if (this.state === 'balance') this.bal = Math.max(0, this.bal - dt * 2.5);
    }
    // gut shots and broken bones: the pain keeps you curled up and writhing
    if (this.state === 'ground' && I.pain > 0.3) {
      this.pain = Math.max(this.pain, I.pain);
      this.writheHold = Math.max(this.writheHold, 0.5);
    }
    const k = 1 - I.weak * 0.85;
    for (const p of this.rd.list) {
      if (!p.parent) continue;
      if (I.limp.has(p.name)) p.strength = Math.min(p.strength, 0.012);
      else p.strength *= k;
    }
    if (I.limp.has('foreL')) this.grip[0] = 0.2;
    if (I.limp.has('foreR')) this.grip[1] = 0.2;
  }

  // ---------- grab + brace: overrides the arms of whatever state is running ----------
  reactLayer(dt) {
    const rd = this.rd, st = this.state, H = this.hands;
    const chestP = rd.pos('chest', V());
    const chestH = chestP.y - this.gy;
    if (st === 'ground') {
      for (const h of H.hands) if (h.state !== 'free' && h.kind !== 'ledge') H.free(h, 1);
    }
    // which way are we going
    const dir = flat(st === 'balance' ? (this.errDir || V(0, 0, 1)).clone() : (this.fallDir || V(0, 0, 1)).clone());
    if (dir.lengthSq() < 1e-4) dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    dir.normalize();
    const left = flat(rd.axis('chest', V(1, 0, 0)));
    if (left.lengthSq() < 1e-4) left.set(dir.z, 0, -dir.x);
    left.normalize();
    const want = st === 'balance' ? this.errLen > 0.1 || this.bal < 0.55
      : (st === 'fall' || st === 'air') && chestH > 0.45;

    // incoming: hands come up toward the impact, face turns away
    const th = this.threat;
    this.braceW = th && st !== 'ground' ? Math.min(1, this.braceW + dt * 10) : Math.max(0, this.braceW - dt * 3);
    if (th) this.bracePt = (this.bracePt ||= V()).copy(th.pos).addScaledVector(th.vel, th.t * 0.5).lerp(chestP, 0.35);

    // about to hit something: the free hands go out to meet it. Walls, cars, people in any state;
    // the ground only from the air (the fall behaviour braces for the floor itself)
    const I = this.imp;
    let impW = 0;
    if (I && st !== 'ground' && (!I.ground || st === 'air')) impW = 1 - clamp((I.t - 0.06) / 0.4, 0, 1);
    this.impW = lerp(this.impW || 0, impW, Math.min(1, dt * 14));
    const BC = (this.braceC ||= [{ t: -1, p: V(), n: V() }, { t: -1, p: V(), n: V() }]);

    const C = this.clutch;
    H.hands.forEach((h, i) => {
      const n = h.n, s = h.side;
      if (C && C.i === i) return;
      const bc = BC[i];
      // a braced palm that met the surface gives with the blow: pushed in hard, then yielding
      if (bc.t >= 0) {
        bc.t += dt;
        if (bc.t > 0.6 || st === 'ground' || h.state !== 'free') bc.t = -1;
        else {
          const k = bc.t / 0.6;
          const tp = _b.copy(bc.p).addScaledVector(bc.n, -0.08 * (1 - k));
          this.armIK(n, tp, V(s * 0.6, -0.2, -0.75).normalize(), lerp(1.8, 0.4, k * k), 2.2);
          this.grip[i] = 0.1;
          return;
        }
      }
      if (h.state === 'free' && this.impW > 0.15 && I) {
        const sh = H.shoulder(h, _a);
        const D = I.dir, N = I.normal;
        // meet it where this shoulder is heading, out to the side a little, just off the surface
        const den = N.dot(D);
        let dist = den < -0.1 ? N.dot(_x.subVectors(I.point, sh)) / den : sh.distanceTo(I.point);
        dist = clamp(dist, 0.28, 0.62);
        const tp = _b.copy(sh).addScaledVector(D, dist).addScaledVector(left, s * 0.12).addScaledVector(N, 0.02);
        this.armIK(n, tp, V(s * 0.6, -0.3, -0.7).normalize(), 0.8 + 0.8 * this.impW, 1.8);
        this.grip[i] = 0;
        if (h.part.touch && this.impW > 0.3) { bc.t = 0; H.palm(h, bc.p); bc.n.copy(N); }
        return;
      }
      if (h.state === 'free' && want && !h.cool) {
        const sh = H.shoulder(h, _a);
        let best = null, bs = Infinity;
        const probes = [
          sh.clone().addScaledVector(dir, 0.1).addScaledVector(UP, -0.1), // whatever is right next to us
          sh.clone().addScaledVector(dir, 0.45).addScaledVector(UP, -0.15),
          sh.clone().addScaledVector(left, s * 0.4).addScaledVector(UP, -0.1),
          sh.clone().addScaledVector(dir, 0.3).addScaledVector(left, s * 0.25).addScaledVector(UP, 0.2),
          sh.clone().addScaledVector(left, s * 0.22).addScaledVector(UP, -0.45).addScaledVector(dir, -0.1),
        ];
        for (const p of probes) {
          const c = H.find(h, p);
          if (!c) continue;
          const other = H.hands[1 - i];
          if (other.state !== 'free' && other.body === c.body && H.targetPoint(other, _b).distanceTo(c.point) < 0.15) continue;
          const sc = c.point.distanceTo(sh) - (c.kind === 'ledge' ? 0.25 : c.kind === 'person' ? 0.1 : 0);
          if (sc < bs) { bs = sc; best = c; }
        }
        if (best) H.reach(h, best);
      }
      const pole = V(s * 0.5, -0.4, -0.75).normalize();
      if (h.state !== 'free') {
        const tp = H.targetPoint(h, _b);
        // reaching aims a touch past the target so the palm arrives with some push
        if (h.state === 'reach') tp.addScaledVector(_c.subVectors(tp, H.shoulder(h, _x)).normalize(), 0.06);
        this.armIK(n, tp, pole, h.state === 'hold' ? 0.75 : 1, 1);
        this.grip[i] = h.state === 'hold' ? 1 : 0.1;
      } else if (this.braceW > 0.15 && this.bracePt) {
        const sh = H.shoulder(h, _a);
        const to = _c.subVectors(this.bracePt, sh);
        to.y = clamp(to.y, -0.25, 0.25);
        const hand = sh.clone().addScaledVector(to.normalize(), 0.5).addScaledVector(left, s * 0.1);
        this.armIK(n, hand, V(s * 0.6, -0.5, -0.6).normalize(), 0.6 + 0.6 * this.braceW, 1.5);
        this.grip[i] = 0;
      }
    });
    if (this.braceW > 0.3 && this.bracePt && st !== 'ground') {
      // flinch: chin down, face turned away from it
      const to = flat(_c.subVectors(this.bracePt, chestP)).normalize();
      this.rel('head', 0.35 * this.braceW, 0, -Math.sign(to.dot(left) || 1) * 0.7 * this.braceW, 0.8);
    }
    if (C) this.clutchLayer(dt, C);
  }

  /**
   * Attention: the head turns to what matters, over whatever the behaviour wanted it doing -
   * whoever hurt us (on our feet, and peeking out from a curl on the floor), else where the
   * fall is taking us. At the last instant before an impact the protective head wins.
   */
  lookLayer(dt) {
    const rd = this.rd, st = this.state;
    const A = this.attn;
    if (A) { A.t += dt; if (A.t > A.dur) this.attn = null; }
    const tgt = this._lt ||= V();
    let w = 0;
    const I = this.imp;
    const ap = this.attn && this.attnPoint(this._ap ||= V());
    const tumbling = this.speed > 1.9 || this.spin > 5.5;
    if (st === 'fall' || st === 'air') {
      if (I && I.t < 0.16) w = 0;
      else if (ap && this.attn.t < 1.0 && !tumbling) { tgt.copy(ap); w = 0.65; }
      else if (I) { tgt.copy(I.point); w = 0.6; }
      else {
        // where the fall is carrying us: a little ahead along the path, down toward the floor
        const c = rd.pos('chest', _x);
        tgt.copy(c).addScaledVector(this.v, 0.35);
        tgt.y = lerp(tgt.y, this.gy, 0.6);
        w = 0.45;
      }
    } else if (st === 'balance') {
      if (ap) { tgt.copy(ap); w = 0.85; }
      else if (this.threat) { tgt.copy(this.threat.pos); w = 0.7; }
      else if (this.errLen > 0.08) {
        // stumbling: eyes on where the feet have to go
        tgt.copy(this.com).addScaledVector(this.errDir, 1.2);
        tgt.y = this.gy;
        w = 0.3 * clamp(this.errLen / 0.3, 0, 1);
      }
    } else if (st === 'ground' && ap && !tumbling) {
      // curled up, still watching them through the arms
      tgt.copy(ap);
      w = 0.8 * (1 - 0.45 * this.protect) * (1 - 0.6 * smooth(this.relax || 0));
    }
    if (this.clutch) w *= 0.5;
    if (this.braceW > 0.3) w *= 0.3; // flinching away from something coming
    this.lookW = lerp(this.lookW || 0, w, Math.min(1, dt * 8));
    if (this.lookW < 0.02 || !(tgt.lengthSq() > 0)) return;
    // the target in the chest's frame (x left, y up, z forward): neck yaw + pitch, within reason
    const head = rd.pos('head', _x);
    const d = _c.subVectors(tgt, head).applyQuaternion(rd.quat('chest', _qa).invert());
    if (d.lengthSq() < 1e-4) return;
    const yaw = clamp(Math.atan2(d.x, d.z), -1.15, 1.15);
    const pitch = clamp(Math.atan2(-d.y, Math.hypot(d.x, d.z)), -0.6, 0.9);
    _lq.setFromEuler(_e.set(pitch, yaw, 0, 'XZY'));
    // eased toward it, not snapped: it tracks
    const L = (this.lookQ ||= new THREE.Quaternion().copy(_lq));
    L.slerp(_lq, Math.min(1, dt * 12));
    const S = this.snapshot(this._snapH ||= {}, HEAD_ONLY).head;
    const q = _q.copy(S.q).slerp(L, this.lookW);
    this.relQ('head', q, Math.max(S.s, 0.55 + 0.4 * this.lookW), 1.2);
  }

  /** The clutching hand presses onto the wound (following it as the body moves), head bowed to it. */
  clutchLayer(dt, C) {
    const rd = this.rd, H = this.hands;
    C.t += dt;
    const h = H.hands[C.i];
    if (h.state !== 'free') H.free(h, 1);
    const p = rd.point(C.part, C.local, V());
    const nW = C.nLocal.clone().applyQuaternion(rd.quat(C.part, _qa));
    // a quick grab, then held there, pressing in
    const press = C.t < 0.18 ? 0.09 : 0.02 + 0.01 * Math.sin(this.t * 7);
    const s = h.side;
    // (on the back: round the hand's own side, low, the elbow out behind - ik.js clutchReach)
    const back = clutchReach(C.part, p, nW, rd.pos('chest', _x), rd.quat('chest', _qa), s);
    p.addScaledVector(nW, press);
    this.armIK(C.n, p, V(s * lerp(0.7, 0.9, back), lerp(-0.45, -0.2, back), lerp(-0.4, -0.9, back)).normalize(), C.t < 0.18 ? 1 : 0.8, 1);
    this.grip[C.i] = 0.85;
    // look down at it
    if (this.state !== 'ground' || this.stateT < 3) {
      const toW = _c.subVectors(p, rd.pos('head', _x)).applyQuaternion(rd.quat('chest', _qa).invert());
      const pitch = clamp(Math.atan2(-toW.y, Math.max(0.05, toW.z)) * 0.5, 0, 0.6);
      const yaw = clamp(Math.atan2(toW.x, Math.max(0.05, toW.z)) * 0.5, -0.6, 0.6);
      this.rel('head', pitch, 0, yaw, 0.55);
    }
  }

  /** Dead: a moment of stiffness, then nothing holding the body up at all. */
  doDead(dt) {
    this.deadT = (this.deadT || 0) + dt;
    const s = this.deadT < 0.15 ? 0.35 : 0.035 * Math.max(0, 1 - this.deadT / 2) + 0.004;
    for (const p of this.rd.list) {
      if (!p.parent) continue;
      p.strength = s;
      p.damping = 1;
    }
    this.grip[0] = this.grip[1] = 0.25;
  }

  // ---------- balance / stumble ----------
  doBalance(dt) {
    const rd = this.rd, P = this.P;
    this.bal = Math.max(0, this.bal - this.decay * dt);
    // holding on to something steadies us
    if (this.hands.anyHold()) this.bal = Math.min(1, this.bal + dt * (this.decay + 0.25 + this.hands.support() * 0.8));
    // heading follows the pelvis slowly
    const hy = this.heading();
    this.yaw += Math.atan2(Math.sin(hy - this.yaw), Math.cos(hy - this.yaw)) * Math.min(1, dt * 2);
    const fwd = V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const left = V(fwd.z, 0, -fwd.x);

    const T = Math.sqrt(Math.max(this.h, 0.3) / G);
    const cp = V(this.com.x + this.v.x * T, 0, this.com.z + this.v.z * T);

    // support region: the segment between planted feet (or the single planted foot)
    const planted = [];
    for (const l of this.legs) {
      l.pos = this.footPoint(l, l.pos || V());
      l.touch = P['foot' + l.n].touch || P['shin' + l.n].touch;
      l.landT = (l.landT ?? 1) + dt;
      if (!l.swing && l.touch) planted.push(l);
    }
    const nPlanted = planted.length;
    const sup = V(this.com.x, 0, this.com.z);
    if (nPlanted === 1) sup.copy(planted[0].pos).addScaledVector(fwd, 0.04);
    if (nPlanted === 2) {
      const A = planted[0].pos.clone().addScaledVector(fwd, 0.04), B = planted[1].pos.clone().addScaledVector(fwd, 0.04);
      const AB = flat(B.clone().sub(A)), AP = flat(cp.clone().sub(A));
      const t = clamp(AP.dot(AB) / Math.max(AB.lengthSq(), 1e-6), 0, 1);
      sup.copy(A).addScaledVector(AB, t);
    }
    sup.y = 0;
    const err = V(cp.x - sup.x, 0, cp.z - sup.z);
    const errLen = Math.max(0, err.length() - 0.05); // foot size margin
    this.errLen = errLen;
    this.errDir = err.lengthSq() > 1e-6 ? err.clone().normalize() : fwd.clone();
    const urgency = clamp(errLen / 0.3, 0, 1);

    // choose a step. Real recovery steps are few and decisive: small errors are soaked up by
    // the ankles and hips (the lean below), a step is only taken once the capture point has
    // clearly left the feet, it's sized to cover it with margin, and there's a moment of
    // weight on both feet between steps - no pattering on the spot.
    const swinging = this.legs.find((l) => l.swing);
    this.lastStep += dt;
    this.dblT = nPlanted === 2 && !swinging ? (this.dblT || 0) + dt : 0;
    const need = 0.1 - 0.04 * urgency;                       // how far out before stepping
    const settle = lerp(0.14, 0.03, urgency);                // double support between steps
    if (!swinging && isFinite(cp.x) && (nPlanted === 0 || (errLen > need && (this.dblT > settle || nPlanted < 2 && this.lastStep > 0.12)))) {
      // step with the foot on the side the body is going (a push to the left is caught with
      // the left foot, not by crossing over) or else the one left furthest behind; a foot
      // that just landed must carry weight for a moment first
      const errS = err.dot(left);
      let best = null, bestD = -Infinity;
      for (const l of this.legs) {
        let d = flat(cp.clone().sub(l.pos)).length() + errS * l.side * 1.5;
        if (!l.touch) d += 0.4;
        if (l.landT < 0.25) d -= 0.5;
        if (l === this.lastLeg) d -= 0.08; // people alternate feet
        if (d > bestD) { bestD = d; best = l; }
      }
      const to = this.stepTarget(best, cp, err, left, urgency);
      const dist = flat(to.clone().sub(best.pos)).length();
      // not worth a step (the foot's already about there): shift weight instead
      if (dist > 0.1 || nPlanted === 0 || urgency > 0.8) {
        best.swing = true;
        best.t = 0;
        best.to.copy(to);
        best.from.copy(best.pos);
        // bigger steps take longer; urgency hurries them
        best.dur = clamp((0.24 + dist * 0.3) * (1 - 0.25 * urgency), 0.22, 0.42);
        // a low shuffle for short steps, just clearing the ground; higher only for long ones
        best.lift = clamp(0.025 + dist * 0.09, 0.03, 0.085);
        this.lastStep = 0;
        this.lastLeg = best;
      }
    }

    const pelvisY = rd.pos('pelvis').y;
    const legS = 0.35 + 0.65 * this.bal;
    const pelDes = yawQuat(this.yaw, 0.03);
    for (const l of this.legs) {
      const footQ = yawQuat(this.yaw);
      if (l.swing) {
        l.t += dt / l.dur;
        // re-aim only early in the swing, and gently - late corrections look like fidgeting
        if (l.t < 0.5) l.to.lerp(this.stepTarget(l, cp, err, left, urgency), Math.min(1, dt * 6));
        const u = clamp(l.t, 0, 1);
        const e = smooth(u);
        const a = V().lerpVectors(l.from, l.to, e);
        // swing around the stance foot rather than through it
        const o = this.legs.find((k) => k !== l);
        const lat = (a.x - o.pos.x) * left.x + (a.z - o.pos.z) * left.z;
        if (lat * l.side < 0.16) a.addScaledVector(left, (0.16 - lat * l.side) * l.side * Math.sin(Math.PI * u));
        const gy = rd.groundY(l.to.x, l.to.z, pelvisY);
        // lift early, then reach and set the foot down heel-first and flat
        const arc = Math.sin(Math.PI * Math.pow(u, 0.8));
        a.y = lerp(l.from.y, gy + ANKLE_H + 0.005, e) + arc * l.lift;
        this.legIK(l.n, a, Math.max(0.6, legS * 0.95), 0, pelDes);
        // foot stays level (toes a touch up towards landing) - never pointed
        this.wld('foot' + l.n, yawQuat(this.yaw, -0.08 * Math.sin(Math.PI * u) - 0.1 * smooth(clamp((u - 0.6) / 0.3, 0, 1))), 0.75);
        // only a real landing ends the step: a toe scuffing mid-swing doesn't plant it short
        if (l.t >= 1 || (l.t > 0.75 && l.touch)) {
          l.swing = false;
          l.landT = 0;
          l.plant.copy(l.pos);
        }
      } else {
        // stance: hold the ankle where it is, extend to push the hips toward standing height
        const hOff = clamp(this.gy + 0.95 * (this.rd.S || 1) * (this.rd.hipK || 1) - pelvisY, -0.1, 0.12);
        if (!l.touch || flat(_x.subVectors(l.pos, l.plant)).lengthSq() > 0.12 * 0.12) l.plant.copy(l.pos);
        this.legIK(l.n, _y.copy(l.plant).setY(l.pos.y), legS, hOff, pelDes);
        this.wld('foot' + l.n, footQ, 0.7 * legS);
      }
    }

    // torso upright, leaning slightly into the direction of travel
    const lean = clamp(err.dot(fwd) * 0.6, -0.2, 0.35);
    this.wld('spine', yawQuat(this.yaw, lean * 0.5), 0.5 + 0.5 * this.bal);
    this.wld('chest', yawQuat(this.yaw, lean), 0.5 + 0.5 * this.bal);
    this.wld('head', yawQuat(this.yaw, -0.05), 0.8);
    if (this.daze) {
      // woozy: the drift direction wanders, the head lolls, knees go soft
      this.dazeAng += this.wob(1.3, 1) * dt * 2.5;
      this.dazeF = Math.min(1, this.dazeF + dt * 1.5) * (0.75 + 0.25 * this.wob(2.1, 2));
      this.rel('head', 0.15 + 0.3 * this.wob(1.1, 3), 0.35 * this.wob(0.9, 4), 0.4 * this.wob(0.7, 5), 0.35);
    }

    // arms out for balance: raised with urgency, thrown opposite the error
    const errF = err.dot(fwd), errS = err.dot(left);
    this.both((n, s) => {
      const sh = rd.point('chest', P['upper' + n].def.anchor, V());
      const out = 0.28 + 0.2 * urgency;
      const hand = sh.clone()
        .addScaledVector(left, s * out)
        .addScaledVector(fwd, 0.08 + clamp(errF, -0.4, 0.4) * 0.5 * (errF > 0 ? 1 : -0.5))
        .addScaledVector(UP, -0.45 + 0.45 * urgency + clamp(-errS * s, -0.3, 0.3) * 0.6);
      this.armIK(n, hand, V(s * 0.3, -0.4, -0.85).normalize(), 0.45 + 0.3 * urgency, 1.4);
    });
    this.grip = [0.2, 0.2];

    // outcome
    const fail = this.tilt > (this.hands.anyHold() ? 1.05 : 0.85) || this.pelvisH < 0.55 || this.bal < 0.08 || this.torsoTouch;
    if (fail) { this.setState('fall'); return; }
    const calm = errLen < 0.04 && Math.hypot(this.v.x, this.v.z) < 0.25 && this.tilt < 0.2 && nPlanted === 2 && !this.legs.some((l) => l.swing);
    this.okT = calm ? this.okT + dt : 0;
    if (this.okT > 0.35 && this.t > 0.5 && !this.threat) this.recovered = true;
  }

  stepTarget(l, cp, err, left, urgency = 0) {
    // land beyond the capture point - more so the harder we're going - so one step settles it
    // instead of three short ones, keeping the foot on its own side
    const dir = err.clone().normalize();
    const t = cp.clone().addScaledVector(dir, 0.07 + 0.08 * urgency).addScaledVector(left, l.side * 0.1);
    // never cross in front of the other foot's line
    const other = this.legs.find((o) => o !== l);
    if (other.pos) {
      const lat = (t.x - other.pos.x) * left.x + (t.z - other.pos.z) * left.z;
      if (lat * l.side < 0.17) t.addScaledVector(left, (0.17 - lat * l.side) * l.side);
    }
    // within reach of the hip
    const hip = this.rd.point('pelvis', this.P['thigh' + l.n].def.anchor, V());
    const off = flat(t.clone().sub(hip));
    const m = 0.62;
    if (off.length() > m) off.setLength(m);
    return t.set(hip.x + off.x, 0, hip.z + off.z);
  }

  // ---------- falling: brace + protect ----------
  doFall(dt) {
    const rd = this.rd, P = this.P;
    const pelvisQ = rd.quat('pelvis');
    const bodyF = flat(V(0, 0, 1).applyQuaternion(pelvisQ)).normalize();
    const bodyL = flat(V(1, 0, 0).applyQuaternion(pelvisQ)).normalize();
    // which way are we going down?
    const dir = flat(this.v.clone()).multiplyScalar(0.6).add(flat(this.chestUp.clone()).multiplyScalar(2));
    if (dir.lengthSq() < 1e-4) dir.copy(bodyF);
    dir.normalize();
    this.fallDir = dir;
    const chestH = rd.pos('chest').y - this.gy;
    // which way we're going down is decided while still upright: once the trunk nears the
    // horizontal its facing stops meaning anything and would flip the brace at the last moment
    if (this.fallF == null || chestH > 0.75) { this.fallF = dir.dot(bodyF); this.fallSd = dir.dot(bodyL); }
    const f = this.fallF, sd = this.fallSd;

    // airborne long enough: flail and kick until impact is imminent, then brace
    const vy = this.v.y, hh = Math.max(0, this.h - 0.55);
    const tImpact = (vy + Math.sqrt(vy * vy + 2 * G * hh)) / G;
    const air = this.airT > 0.3 && (this.h > 1.25 || vy < -3.5) && tImpact > 0.28;
    if (air) {
      this.state = 'air';
      this.flailPose(1.25, this.panic * 0.65);
      return;
    }
    this.state = 'fall';

    const back = f < -0.35;
    const sideways = Math.abs(sd) > 0.65;
    const legS = this.collapse ? lerp(0.1, 0.3, clamp(this.stateT * 2, 0, 1)) : 0.4;

    // arms: reach for the ground where we're going to land, then push into it as struts
    const reach = 0.3 + 0.35 * clamp(chestH, 0, 1.4);
    const HC = (this.handC ||= [{ t: -1, p: V() }, { t: -1, p: V() }]);
    this.both((n, s) => {
      const lead = s * sd > 0.3;
      const hand = V();
      let st = 1, damp = 1.3;
      const fore = P['fore' + n];
      const hc = HC[s > 0 ? 0 : 1];
      if (fore.touch && hc.t < 0) { hc.t = this.stateT; rd.point('fore' + n, V(0, -ARM2, 0), hc.p); }
      if (hc.t >= 0) {
        // planted: push the hand into the ground (a target past it) so the arm carries weight,
        // yielding slowly and heavily damped - an absorbed landing, not a spring
        const k = clamp((this.stateT - hc.t) / 0.55, 0, 1);
        const sh = rd.point('chest', P['upper' + n].def.anchor, _a);
        const tp = _b.copy(hc.p).addScaledVector(_c.subVectors(hc.p, sh).normalize(), 0.14 * (1 - k));
        this.armIK(n, tp, V(s * 0.55, 0.1, -0.8).normalize(), lerp(2.2, 0.5, k * k), 2.4);
        return;
      }
      if (sideways && !lead) {
        // trailing arm covers the head
        this.armDir(n, V(s * 0.1, 0.5, 0.85), 2.3, 1.1, undefined, 1.5);
        return;
      }
      if (back) {
        const pel = rd.pos('pelvis');
        hand.copy(pel).addScaledVector(bodyF, -0.2).addScaledVector(bodyL, s * 0.32);
        st *= 0.8;
      } else {
        // under and just ahead of the shoulder: the arm is near vertical when it lands, so it
        // meets the ground early and can take the weight straight down its length
        const sh = rd.point('chest', P['upper' + n].def.anchor, _a);
        hand.copy(sh).addScaledVector(dir, lerp(0.2, reach * 0.6, clamp(this.speed / 5, 0, 1))).addScaledVector(bodyL, s * (lead ? 0.02 : 0.1));
      }
      hand.y = rd.groundY(hand.x, hand.z, this.com.y + 0.3) + 0.03;
      this.armIK(n, hand, V(s * 0.55, 0.1, -0.8).normalize(), st, damp);
    });
    this.grip = [0, 0];

    // head: tuck the chin when going backward, lift and turn the face away going forward
    if (back) this.rel('head', 0.8, 0, 0, 1.6, 1.6);
    else if (sideways) this.rel('head', 0.2, sd * 0.55, 0, 1.6, 1.6);
    else this.rel('head', -0.55, 0, (this.faceSide ||= Math.random() < 0.5 ? 1 : -1) * 0.9, 1.6, 1.6);

    // trunk + legs
    if (back) {
      this.rel('spine', 0.55, 0, 0, 0.5);
      this.rel('chest', 0.45, 0, 0, 0.5);
    } else {
      this.rel('spine', 0.1, 0, 0, 0.45);
      this.rel('chest', -0.05, 0, 0, 0.45);
    }
    this.both((n, s) => {
      if (back) { this.rel('thigh' + n, -1.1, s * 0.15, 0, legS); this.rel('shin' + n, 1.4, 0, 0, legS); }
      else { this.rel('thigh' + n, -0.35, s * 0.1, 0, legS); this.rel('shin' + n, this.collapse ? 1.5 : 0.8, 0, 0, legS); }
      this.rel('foot' + n, 0.1, 0, 0, 0.3);
    });

    // panic: early in the fall, while there's still height, the brace dissolves into flailing
    // arms and kicking legs; it resolves back into the brace as the ground comes up
    // a fast fall leaves no time to panic: the hands go straight out
    const cvy = Math.min(-0.3, rd.vel('chest', _a).y);
    const tHit = (chestH - 0.45) / -cvy;
    // (something solid coming up fast: no panic, the hands are already going out to it)
    const soon = this.imp && this.imp.t < 0.5 ? 0 : 1;
    const fl = this.panic * (this.collapse ? 0.3 : 0.55) * soon *
      clamp((chestH - 0.55) / 0.5, 0, 1) * clamp(this.stateT * 5, 0, 1) * clamp((tHit - 0.35) / 0.4, 0, 1);
    if (fl > 0.01) {
      const A = this.snapshot(this._snapA ||= {});
      this.flailPose(1, 0.6);
      this.blendFrom(A, fl);
    }

    // self-preservation: throw a leg out toward the fall to try and catch it
    if (!back && !this.collapse && chestH > 0.7 && this.stateT < 0.8) {
      if (!this.catchLeg) {
        let best = null, bd = Infinity;
        for (const l of this.legs) {
          const d = sideways ? -l.side * sd : this.footPoint(l, _a).dot(dir);
          if (d < bd) { bd = d; best = l; }
        }
        this.catchLeg = best;
      }
      const l = this.catchLeg, n = l.n;
      const a = this.com.clone().addScaledVector(dir, 0.5).addScaledVector(bodyL, l.side * 0.12);
      a.y = rd.groundY(a.x, a.z, this.com.y) + ANKLE_H + (P['foot' + n].touch ? 0 : 0.04);
      this.legIK(n, a, 0.65);
      this.rel('foot' + n, -0.1, 0, 0, 0.4);
    }

    // arms planted and still taking the weight: ride the brace down instead of giving up on it
    const braced = HC.some((c) => c.t >= 0 && this.stateT - c.t < 0.55);
    if (this.torsoTouch || chestH < (braced ? 0.16 : 0.3)) {
      this.impact = this.speed;
      this.setState('ground');
    }
  }

  /** Uncoordinated panic: windmilling arms, bicycling / kicking legs, squirming trunk. */
  flailPose(speed, s) {
    const t = this.t * speed;
    this.both((n, sd) => {
      const k = sd > 0 ? 0 : 1;
      const ph = t * 9 + k * 2.4 + this.wob(1.7, 10 + k) * 1.2;
      this.armDir(n, V(sd * (0.7 + 0.2 * this.wob(2, 12 + k)), 0.15 + 0.85 * Math.sin(ph), 0.85 * Math.cos(ph)),
        0.55 + 0.45 * this.wob(2.3, 14 + k), s);
      // kicks: hip swings, the knee snaps straight as the thigh comes forward
      const lp = t * 7.5 + k * Math.PI + this.wob(1.3, 16 + k) * 0.8;
      this.rel('thigh' + n, -0.75 + 0.7 * Math.sin(lp), sd * (0.2 + 0.15 * this.wob(1.1, 18 + k)), 0, s);
      this.rel('shin' + n, 0.2 + 1.3 * (0.5 + 0.5 * Math.sin(lp - 1.3)), 0, 0, s);
      this.rel('foot' + n, 0.15 + 0.3 * this.wob(3, 20 + k), 0, 0, s * 0.5);
    });
    this.rel('spine', 0.1 + 0.25 * this.wob(2.2, 22), 0.2 * this.wob(1.6, 23), 0.2 * this.wob(1.4, 24), s);
    this.rel('chest', -0.05 + 0.2 * this.wob(2.6, 25), 0.15 * this.wob(1.9, 26), 0.2 * this.wob(1.2, 27), s);
    this.rel('head', -0.15 + 0.3 * this.wob(2.4, 28), 0.3 * this.wob(1.8, 29), 0.5 * this.wob(1.1, 30), 0.6);
    this.grip = [0.1, 0.1];
  }

  /** Pain: slow squirming, knees drawn up in turn, hands clutching the body/head, bouts of kicking. */
  writhePose(dt, s) {
    const rd = this.rd;
    const kick = this.kickT > 0 ? smooth(clamp(this.kickT * 3, 0, 1)) : 0;
    this.rel('spine', 0.3 + 0.3 * this.wob(1.6, 40), 0.3 * this.wob(1.1, 41), 0.35 * this.wob(0.8, 42), s);
    this.rel('chest', 0.25 + 0.25 * this.wob(1.7, 43), 0.25 * this.wob(1.2, 44), 0.3 * this.wob(0.9, 45), s);
    this.rel('head', 0.35 + 0.35 * this.wob(1.3, 46), 0.3 * this.wob(0.9, 47), 0.8 * this.wob(0.7, 48), s + 0.1);
    this.both((n, sd) => {
      const k = sd > 0 ? 0 : 1;
      // slow alternating draw-up of the knees, sharpening into fast kicks during a bout
      const slow = 0.5 + 0.5 * Math.sin(this.t * 1.5 + k * 2.6 + this.seed + this.wob(0.8, 50 + k));
      const fast = 0.5 + 0.5 * Math.sin(this.t * 10 + k * Math.PI);
      const draw = lerp(slow, fast, kick);
      this.rel('thigh' + n, -0.35 - 1.25 * draw, sd * (0.1 + 0.2 * this.wob(0.9, 52 + k)), 0.2 * sd * this.wob(1, 54 + k), s + 0.15 * kick);
      this.rel('shin' + n, lerp(0.35 + 1.8 * draw, 0.15 + 1.6 * (1 - fast), kick), 0, 0, s + 0.15 * kick);
      this.rel('foot' + n, 0.2 + 0.3 * this.wob(1.5, 56 + k), 0, 0, s * 0.6);
      // hands wander between clutching the belly and holding the head
      const c = 0.5 + 0.5 * this.wob(0.5, 58 + k);
      const local = V(sd * lerp(0.05, 0.1, c), lerp(-0.08, 0.36, c), lerp(0.16, 0.13, c));
      this.armIK(n, rd.point('chest', local, V()), V(sd * 0.8, -0.3, 0.2).normalize(), s);
    });
    this.grip = [0.8, 0.8];
  }

  // ---------- on the ground: ball up while tumbling, then relax ----------
  doGround(dt) {
    // tumbling (not merely the ball rocking on the ground) keeps the protective tuck going
    const tumbling = this.speed > 1.9 || this.spin > 5.5;
    if (tumbling) this.tuckT = clamp(0.4 + this.speed * 0.25, 0.5, 1.5);
    else if (this.stateT < 0.05 && this.impact > 2) this.tuckT = clamp(this.impact * 0.3, 0.5, 1.5);
    // hit while down (a kick, a blow): flinch into a tight curl for a moment
    if (this.jolt > 2.2 && this.stateT > 0.1) this.flinchT = Math.max(this.flinchT || 0, 0.35);
    this.flinchT = Math.max(0, (this.flinchT || 0) - dt);
    if (this.flinchT > 0) this.tuckT = Math.max(this.tuckT || 0, 0.6);
    this.tuckT = Math.max(0, (this.tuckT || 0) - dt);
    // someone who's been hurting us is still close: stay half guarded rather than lying open
    let guard = 0;
    const ap = this.attn && this.attnPoint(this._ap ||= V());
    if (ap && this.attn.t < 4 && ap.distanceTo(this.com) < 3) guard = 0.55;
    const want = this.tuckT > 0 ? 1 : guard;
    this.protect = want > this.protect ? Math.min(want, this.protect + dt * (this.flinchT > 0 ? 12 : 6)) : Math.max(want, this.protect - dt * 1.4);
    const calm = this.speed < 0.35 && this.spin < 1.2;
    // writhing: once the tumbling stops the pain sets in, holds for a while, then fades out
    if (!tumbling) this.writheHold = Math.max(0, this.writheHold - dt);
    const wTarget = this.writheHold > 0 && !tumbling ? this.pain * (0.8 + 0.2 * this.wob(0.4, 60)) : 0;
    this.writhe = wTarget > this.writhe ? Math.min(wTarget, this.writhe + dt * 1.2) : Math.max(wTarget, this.writhe - dt * 0.3);
    if (this.kickT > 0) this.kickT = Math.max(0, this.kickT - dt);
    else if (this.writhe > 0.35 && Math.random() < dt * 0.35 * this.pain) this.kickT = 0.5 + Math.random() * 0.8;
    const writhing = this.writhe > 0.12;
    this.relax = calm && !writhing ? Math.min(1, this.relax + dt * 0.5) : Math.max(0, this.relax - dt * 0.8);
    // airborne again (bounced off a ledge): go back to falling behaviours
    if (this.airT > 0.35 && this.h > 1.2) { this.setState('fall'); return; }

    const pr = this.protect;
    const tone = lerp(0.35, 0.05, smooth(this.relax));
    // a curl held by a person, not a clamp: firm while a blow lands, looser between, and it
    // breathes and shifts, one knee drawn up further than the other
    const fl = smooth(clamp((this.flinchT || 0) / 0.35, 0, 1));
    const s = lerp(tone, 0.5 + 0.3 * fl, pr);
    const mix = (a, b) => lerp(a, b, pr);
    const br = Math.sin(this.t * 2.2 + this.seed) * 0.04 * pr;
    this.rel('spine', mix(0.1, 0.5 + 0.12 * fl) + br + 0.08 * pr * this.wob(0.6, 70), 0.1 * pr * this.wob(0.5, 71), 0.12 * pr * this.wob(0.4, 72), s);
    this.rel('chest', mix(0.1, 0.42 + 0.1 * fl) + br, 0.08 * pr * this.wob(0.55, 73), 0.1 * pr * this.wob(0.45, 74), s);
    // face down: lift the face off the ground and turn it aside rather than tucking into it
    const prone = this.rd.axis('chest', _a.set(0, 0, 1)).y < -0.45;
    if (prone) this.rel('head', mix(-0.3, -0.45), 0, (this.faceSide ||= Math.random() < 0.5 ? 1 : -1) * 1.0, lerp(tone + 0.25, 1.2, pr), 1.5);
    else this.rel('head', mix(0.15, 0.85), 0, 0, lerp(tone + 0.1, 1.2, pr), 1.4);
    // where they are, in the chest's frame: the guard turns toward it
    let at = null;
    if (ap && pr > 0.05) {
      at = (this._at ||= V()).subVectors(ap, this.rd.pos('chest', _x)).applyQuaternion(this.rd.quat('chest', _qa).invert());
      at.lengthSq() > 1e-4 ? at.normalize() : (at = null);
    }
    this.both((n, sd) => {
      const k = sd > 0 ? 0 : 1;
      const lead = (this.seed * 13 % 2 < 1 ? 1 : -1) * sd; // one knee higher than the other
      const draw = 1 + 0.12 * lead + 0.1 * this.wob(0.35, 76 + k);
      this.rel('thigh' + n, mix(-0.35, -1.75 * draw - 0.2 * fl), sd * mix(0.15, 0.08 + 0.06 * this.wob(0.4, 78 + k)), 0, s);
      this.rel('shin' + n, mix(0.5, 2.1 + 0.15 * fl + 0.1 * this.wob(0.5, 80 + k)), 0, 0, s * 0.9);
      this.rel('foot' + n, mix(0.1, 0.4), 0, 0, s * 0.5);
      if (pr > 0.05) {
        // forearms up in front of the face, hands at the head - the guard leaning toward
        // whoever it's up against, and never quite still
        const u = V(sd * 0.12 + 0.06 * this.wob(0.7, 82 + k), lerp(-0.9, 0.5, pr), lerp(0.25, 0.85, pr));
        if (at) u.lerp(_z.copy(at).multiplyScalar(0.9).setY(Math.max(at.y, 0.2)), 0.3 * pr);
        this.armDir(n, u, lerp(0.6, 2.2 + 0.15 * fl + 0.12 * this.wob(0.8, 84 + k), pr), lerp(s, 0.75 + 0.35 * fl, pr), undefined, lerp(1, 1.4, pr));
      } else {
        this.rel('upper' + n, -0.35, sd * 0.25, 0, s);
        this.rel('fore' + n, -0.6, 0, 0, s);
      }
    });
    this.grip = [lerp(0.35, 1, pr), lerp(0.35, 1, pr)];

    // layer the writhe over the tuck/relax pose; the protective tuck always wins while tumbling
    const w = smooth(clamp(this.writhe, 0, 1)) * (1 - pr);
    if (w > 0.01) {
      const A = this.snapshot(this._snapA ||= {});
      const g = this.grip[0];
      this.writhePose(dt, 0.3 + 0.25 * this.pain);
      this.blendFrom(A, w);
      this.grip = [lerp(g, this.grip[0], w), lerp(g, this.grip[1], w)];
    }
  }

  // ---------- per physics step ----------
  assist(h) {
    this.hands.step(h);
    if (this.state !== 'balance' || this.dead) return;
    const rd = this.rd;
    const b = this.bal;
    // "hand of god" keeps the pelvis roughly upright while the legs find footing
    rd.assistRotation('pelvis', yawQuat(this.yaw, 0.03, _qa), 7 * Math.sqrt(b), h, 450 * b, true);
    // partial weight support, fading with balance
    const py = rd.pos('pelvis', _a).y - this.gy;
    const vy = rd.vel('pelvis', _b).y;
    const f = clamp((0.95 * (rd.S || 1) * (rd.hipK || 1) - py) * 900 - vy * 120 + TOTAL_MASS * G * 0.25, 0, TOTAL_MASS * G * 0.6) * b;
    rd.force('pelvis', _c.set(0, f, 0), h);
    if (this.daze) {
      // a wandering sideways pull on the upper body keeps him staggering
      const m = 70 * this.dazeF * (0.4 + 0.6 * (1 - b));
      rd.force('chest', _c.set(Math.sin(this.dazeAng) * m, 0, Math.cos(this.dazeAng) * m), h);
    }
  }
}
