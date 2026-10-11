import * as THREE from 'three';
import { orient, solveTwoBone, kneePole } from './ik.js';
import { STEP } from './world.js';

/*
  Procedural traversal: mantling / climbing onto ledges and vaulting over low obstacles.
  Each action is a short keyframed path for the pelvis, feet and hands built from the ledge
  geometry and the body's current pose, solved every frame with two-bone IK.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// must match character.js
const THIGH = 0.44, SHIN = 0.43, ANKLE_H = 0.075, UPPER_ARM = 0.29, FOREARM = 0.26, HIP_Y = 0.97;

const _a = V(), _b = V(), _c = V(), _d = V(), _e = V();
const _x = V(), _y = V(), _z = V(), _ax = V();
const _m = new THREE.Matrix4(), _eu = new THREE.Euler(0, 0, 0, 'YXZ');
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion();

/** Hermite spline through keys[i][prop] (Vector3), tangents from neighbours. */
function spline(keys, prop, t, out, m0 = null, mN = null) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const k0 = keys[i], k1 = keys[i + 1];
  const h = k1.t - k0.t, s = clamp((t - k0.t) / h, 0, 1);
  const tan = (j, o) => {
    if (j === 0 && m0) return o.copy(m0);
    if (j === keys.length - 1) return mN ? o.copy(mN) : o.set(0, 0, 0);
    if (j === 0) return o.set(0, 0, 0);
    return o.subVectors(keys[j + 1][prop], keys[j - 1][prop]).divideScalar(keys[j + 1].t - keys[j - 1].t);
  };
  const ma = tan(i, _a), mb = tan(i + 1, _b);
  const s2 = s * s, s3 = s2 * s;
  return out.copy(k0[prop]).multiplyScalar(2 * s3 - 3 * s2 + 1)
    .addScaledVector(ma, (s3 - 2 * s2 + s) * h)
    .addScaledVector(k1[prop], -2 * s3 + 3 * s2)
    .addScaledVector(mb, (s3 - s2) * h);
}

const seg = (keys, t) => {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  return i;
};

/**
 * Limb path through keys: flows through keys where the limb keeps moving (Hermite with
 * neighbour tangents) and comes to rest only at keys where it's planted (same spot as a
 * neighbouring key). Distant moves get an arc so hands/feet clear edges.
 */
const _pts = [V(), V(), V(), V()];
function limb(keys, get, t, out, arc) {
  const i = seg(keys, t), n = keys.length;
  const k0 = keys[i], k1 = keys[i + 1], h = k1.t - k0.t;
  const s = clamp((t - k0.t) / h, 0, 1);
  const pm = i > 0 ? get(keys[i - 1], _pts[0]) : null;
  const p0 = get(k0, _pts[1]), p1 = get(k1, _pts[2]);
  const pn = i + 2 < n ? get(keys[i + 2], _pts[3]) : null;
  const tan = (prev, cur, next, tp, tn, o) => {
    if (!prev || !next || prev.distanceTo(cur) < 0.03 || next.distanceTo(cur) < 0.03) return o.set(0, 0, 0);
    return o.subVectors(next, prev).divideScalar(tn - tp);
  };
  const ma = tan(pm, p0, p1, i > 0 ? keys[i - 1].t : 0, k1.t, _a);
  const mb = tan(p0, p1, pn, k0.t, i + 2 < n ? keys[i + 2].t : 1, _b);
  const s2 = s * s, s3 = s2 * s;
  out.copy(p0).multiplyScalar(2 * s3 - 3 * s2 + 1)
    .addScaledVector(ma, (s3 - 2 * s2 + s) * h)
    .addScaledVector(p1, -2 * s3 + 3 * s2)
    .addScaledVector(mb, (s3 - s2) * h);
  const d = p0.distanceTo(p1);
  if (arc && d > 0.08) out.addScaledVector(arc, Math.sin(Math.PI * s) * Math.min(1, d / 0.35));
  return out;
}

/** Scalar Catmull-Rom (flat only at the ends and at local extremes, so motion never stalls). */
function scalar(keys, prop, t) {
  const i = seg(keys, t), n = keys.length;
  const k0 = keys[i], k1 = keys[i + 1], h = k1.t - k0.t;
  const s = clamp((t - k0.t) / h, 0, 1);
  const v = (j) => keys[j][prop] ?? 0;
  const tan = (j) => {
    if (j <= 0 || j >= n - 1) return 0;
    const a = v(j - 1), b = v(j), c = v(j + 1);
    if ((b - a) * (c - b) <= 0) return 0;
    return (c - a) / (keys[j + 1].t - keys[j - 1].t);
  };
  const s2 = s * s, s3 = s2 * s;
  return v(i) * (2 * s3 - 3 * s2 + 1) + tan(i) * (s3 - 2 * s2 + s) * h + v(i + 1) * (-2 * s3 + 3 * s2) + tan(i + 1) * (s3 - s2) * h;
}

/** Key value may be a point or a function (evaluated against the live pose, e.g. hips-local). */
const val = (x, o) => (typeof x === 'function' ? x(o) : o.copy(x));

class Action {
  constructor(ch, fwd, dur) {
    this.ch = ch;
    this.t = 0;
    this.dur = dur;
    this.fwd = fwd.clone().setY(0).normalize();
    this.left = V(this.fwd.z, 0, -this.fwd.x);
    this.yaw0 = ch.yaw;
    this.yaw1 = Math.atan2(this.fwd.x, this.fwd.z);
    this.y0 = ch.pos.y;
    this.root0 = ch.pos.clone();
    this.startVel = V(ch.vel.x, ch.vy, ch.vel.z);
    this.speed = Math.hypot(ch.vel.x, ch.vel.z);
    this.fpKeys = [];
    // current pose -> first key, so the action starts exactly where the body is
    ch.root.updateMatrixWorld(true);
    this.k0 = {
      t: 0,
      hip: ch.hips.getWorldPosition(V()),
      pitch: ch.hips.rotation.x,
      feet: ch.legs.map((l) => l.ankle.clone()),
      fp: ch.legs.map((l) => l.pitch || 0),
      hands: ch.arms.map((a) => (a.handPos ? a.handPos.clone() : null)),
      grip: 0.3,
    };
  }

  /** Relaxed hand position hanging from the current shoulder. */
  restHand(i, out) {
    // relative to the chest, so it rides along with the body through rolls
    const a = this.ch.arms[i];
    return this.ch.chest.localToWorld(out.set(a.side * 0.25, -0.28, 0.1));
  }

  update(dt, ctrl) {
    this.t = Math.min(1, this.t + dt / this.dur);
    this.pose(this.t);
    if (this.t >= 1) { this.finish(ctrl); return false; }
    return true;
  }

  pose(t) {
    const ch = this.ch, K = this.keys;
    const yaw = this.yaw0 + wrapAngle(this.yaw1 - this.yaw0) * smooth(clamp(t / 0.25, 0, 1));
    const hip = spline(K, 'hip', t, V(), this.m0, this.mN);
    const pitch = scalar(K, 'pitch', t);

    // root follows the pelvis (keeps the camera and shadow-caster centred)
    const rootY = lerp(this.y0, this.y1, smooth(clamp((t - 0.15) / 0.8, 0, 1)));
    ch.pos.set(hip.x, rootY, hip.z);
    ch.yaw = yaw;
    ch.root.position.copy(ch.pos);
    ch.root.rotation.y = yaw;

    // pelvis orientation: lean, plus an optional whole-body spin about a (possibly diagonal)
    // axis - rolls go over one shoulder, not straight over the head
    const spin = this.spin ? this.spin(t) : 0;
    const qh = _q1.setFromEuler(_eu.set(pitch * 0.6 + 0.04, scalar(K, 'twist', t), scalar(K, 'bank', t), 'YXZ'));
    if (spin) qh.premultiply(_q2.setFromAxisAngle(_ax.copy(this.spinAxis), spin));
    ch.hips.quaternion.copy(qh);
    // keys give the body's pivot (belly for rolls); the pelvis hangs off it
    const local = hip.clone().sub(ch.pos).applyAxisAngle(UP, -yaw);
    if (this.pivot) local.sub(_e.copy(this.pivot).applyQuaternion(qh));
    ch.hips.position.copy(local);
    ch.hipY = local.y;
    const curl = scalar(K, 'curl', t); // rounding of the back / tucked chin
    ch.spine.rotation.set(pitch * 0.25 + curl * 0.45, -scalar(K, 'twist', t) * 0.4, 0);
    ch.chest.rotation.set(pitch * 0.2 - 0.03 + curl * 0.35, 0, 0);
    const look = scalar(K, 'look', t);
    ch.neck.rotation.set(-pitch * 0.5 + look * 0.5 + curl * 0.45, 0, 0);
    ch.head.rotation.set(-pitch * 0.3 + look * 0.5 + curl * 0.35, 0, 0);
    ch.root.updateMatrixWorld(true);

    // body frame axes (world): everything limb-related is expressed in these, never in world yaw
    const hq = ch.hips.getWorldQuaternion(new THREE.Quaternion());
    const cq = ch.chest.getWorldQuaternion(new THREE.Quaternion());
    const chestF = V(0, 0, 1).applyQuaternion(cq);
    const col = ch.colliders;

    // legs
    const hipJ = V(), ankle = V(), end = V(), pole = V();
    const liftArc = V(0, 0.14, 0).addScaledVector(this.fwd, -0.06);
    ch.legs.forEach((l, i) => {
      limb(K, (k, o) => val(k.feet[i], o), t, ankle, this.noArc ? null : liftArc);
      ch.hips.localToWorld(hipJ.set(l.side * 0.088, -0.055, 0));
      // knees bend ahead of the thigh whichever way the pelvis is turned (a roll goes all the way round: see kneePole)
      kneePole(hq, hipJ, ankle, l.side, pole);
      solveTwoBone(hipJ, ankle, ch.D.THIGH, ch.D.SHIN, pole, l.knee, end);
      orient(l.thigh, hipJ, l.knee, pole);
      orient(l.shin, l.knee, end, pole);
      l.ankle.copy(end);
      l.pitch = scalar(this.fpKeys[i] ||= K.map((k) => ({ t: k.t, p: k.fp[i] })), 'p', t);
      l.foot.position.copy(end);
      this.footQuat(l, end, yaw, col, l.foot.quaternion);
      l.toe.rotation.x = 0;
      l.footYaw = yaw;
    });

    // arms
    const sh = V(), hand = V(), rest = V();
    const handArc = V().addScaledVector(this.fwd, -0.1).addScaledVector(UP, 0.12);
    const grip = scalar(K, 'grip', t);
    ch.arms.forEach((a, i) => {
      ch.chest.localToWorld(sh.set(a.side * 0.185, 0.2, -0.015));
      this.restHand(i, rest);
      limb(K, (k, o) => (k.hands[i] ? val(k.hands[i], o) : o.copy(rest)), t, hand, this.noArc ? null : handArc);
      a.handPos = (a.handPos || V()).copy(hand);
      // elbows point out and back relative to the chest
      ch.chest.localToWorld(pole.set(a.side * 0.6, -0.2, -0.5)).sub(ch.chest.getWorldPosition(_e)).normalize();
      solveTwoBone(sh, hand, ch.D.UPPER_ARM, ch.D.FOREARM, pole, a.elbow, end);
      orient(a.upper, sh, a.elbow, chestF, true);
      orient(a.fore, a.elbow, end, chestF, true);
      const flat = this.handQuat(a, end, grip, col);
      // a hand pressed flat on a surface opens up; a hanging/gripping hand curls
      const c = lerp(0.22 + grip * 0.9, 0.05 + grip * 0.35, flat);
      a.fingers.forEach(([f1, f2], j) => {
        f1.rotation.z = -(c + j * 0.06);
        f2.rotation.z = -(c * 1.15 + j * 0.05);
      });
      a.thumb[1].rotation.z = -c * 0.6;
    });
  }

  /** How firmly a point at height y (offset above its contact surface) sits on a surface. */
  contactW(col, p, off) {
    if (!col) return 0;
    const gy = col.groundAt(p.x, p.z, p.y + 0.05, 0.03);
    return 1 - smooth(clamp((p.y - off - gy) / 0.1, 0, 1));
  }

  /**
   * Foot orientation: planted feet lie flat on the floor (or sole-against-the-wall when
   * kicking up one), free feet follow the shin with the toes softly pointed.
   */
  footQuat(l, ankle, yaw, col, out) {
    const free = _q1.copy(l.shin.quaternion).multiply(_q2.setFromEuler(_eu.set(0.35 + Math.max(0, l.pitch) * 0.5, 0, 0)));
    const floorW = this.contactW(col, ankle, ANKLE_H);
    const planted = _q3.setFromEuler(_eu.set(l.pitch, yaw + l.side * 0.08, 0, 'YXZ'));
    out.copy(free).slerp(planted, floorW);
    // against a wall ahead: sole on the wall, toes up
    if (col && this.wallFeet && floorW < 0.5) {
      const p = _e.copy(ankle).addScaledVector(this.fwd, 0.14);
      if (col.blocked(p.x, p.z, ankle.y, 0.04)) {
        _x.copy(this.left);                             // foot X = body left
        _y.copy(this.fwd).negate();                     // sole (-Y) presses into the wall
        _z.crossVectors(_x, _y);                        // toes (+Z) point up
        _m.makeBasis(_x, _y, _z);
        out.slerp(_q4.setFromRotationMatrix(_m), 0.85 * (1 - floorW));
      }
    }
    return out;
  }

  /**
   * Hand orientation: on a surface the palm lies flat with the fingers along the direction of
   * travel; in the air it follows the forearm. Returns the flatness weight.
   */
  handQuat(a, wrist, grip, col) {
    const w = this.contactW(col, wrist, 0.035);
    const fq = a.fore.getWorldQuaternion(_q1);
    const free = _q2.setFromEuler(_eu.set(0.1 + grip * 0.4, 0, -0.08, 'XYZ'));
    if (w < 0.01) { a.hand.quaternion.copy(free); return 0; }
    // desired world frame: fingers (-Y) forward and slightly outward, palm down.
    // palm normal is -side * X in the hand's (mirrored) frame.
    _y.copy(this.fwd).addScaledVector(this.left, a.side * 0.25).normalize().negate();
    _x.set(0, a.side, 0);
    _z.crossVectors(_x, _y).normalize();
    _x.crossVectors(_y, _z);
    _m.makeBasis(_x, _y, _z);
    const planted = _q3.setFromRotationMatrix(_m).premultiply(_q4.copy(fq).invert());
    a.hand.quaternion.copy(free).slerp(planted, w);
    return w;
  }

  /** Hand control back to locomotion from the final key. */
  finish() {
    const ch = this.ch, last = this.keys[this.keys.length - 1];
    ch.pos.copy(this.root1);
    ch.yaw = this.yaw1;
    ch.grounded = true;
    ch.vy = 0;
    ch.vel.copy(this.endVel);
    ch.hipY = ch.hips.position.y; // last pose() ran with root at root1
    ch.hipYV = 0;
    ch.turnRate = 0;
    ch.settling = false;
    // carry momentum straight into the gait: running exits hit the ground already running
    const sp = this.endVel.length();
    ch.runF = clamp((sp - 1.7) / 3.1, 0, 1);
    if (sp > 0.5) ch.freq = sp / lerp(1.25, 2.75, ch.runF);
    ch.legs.forEach((l, i) => {
      l.swinging = false;
      val(last.feet[i], l.contact).addScaledVector(UP, -ANKLE_H);
      l.contact.y = ch.gAt(l.contact.x, l.contact.z);
      l.footYaw = this.yaw1;
    });
  }
}

/** Climb onto a ledge: reach, grab, pull, knee up, stand. */
class Mantle extends Action {
  constructor(ch, edge, n, L, keepGoing) {
    const rise = L.top - ch.pos.y;
    const air = !ch.grounded;
    const speed = Math.hypot(ch.vel.x, ch.vel.z);
    const flow = clamp((speed - 1.5) / 3, 0, 1);      // how much momentum we bring in
    const wallRun = !air && rise > 1.55;               // too high to reach: kick up the wall first
    const dur = ((air ? 0.6 : 0.7) + rise * 0.33) * lerp(1, 0.72, flow) + (wallRun ? 0.22 : 0);
    super(ch, n.clone().negate(), dur);
    this.wallFeet = true;
    const Y = L.top, y0 = this.y0, f = this.fwd, l = this.left;
    const at = (d, s, y) => edge.clone().addScaledVector(f, d).addScaledVector(l, s).setY(y);
    // with momentum and input held, pop over the top and run on instead of stopping to stand
    const out = keepGoing ? flow : 0;
    const endD = 0.46 + out * 0.2;
    this.y1 = Y;
    this.root1 = at(endD, 0, Y);
    this.endVel = f.clone().multiplyScalar(keepGoing ? Math.max(1.2, speed * 0.55) : 0);
    this.m0 = this.startVel.clone().multiplyScalar(this.dur * 0.5);
    this.mN = this.endVel.clone().multiplyScalar(this.dur * 0.3);
    const low = rise < 0.8; // a quick step/hop up rather than a hanging climb
    const feetY = (hy) => Math.max(y0, hy - 0.9) + ANKLE_H;
    // timeline: wall-run kicks squeeze the climb into the back of the action
    const T0 = wallRun ? 0.34 : 0;
    const tt = (x) => T0 + (1 - T0) * x;
    const keys = [this.k0];
    let grabHip = Math.max(Y - 0.95, y0 + (low ? 0.82 : 0.86));
    if (wallRun) {
      // two running steps up the wall, each driving the hips higher
      const h1 = y0 + 0.45, h2 = Math.min(y0 + 1.15, Y - 0.6);
      keys.push({
        t: 0.13, hip: at(-0.4, 0, y0 + 1.05), pitch: 0.1, look: -0.3, grip: 0.4, fp: [-0.6, 0.4],
        feet: [at(-0.06, 0.1, h1), at(-0.5, -0.1, y0 + 0.15)],
        hands: [at(-0.25, 0.25, y0 + 1.5), at(-0.45, -0.25, y0 + 0.9)],
      }, {
        t: 0.26, hip: at(-0.34, 0, Math.min(y0 + 1.6, Y - 0.85)), pitch: 0.05, look: -0.35, grip: 0.6, fp: [0.3, -0.6],
        feet: [at(-0.3, 0.1, h1 + 0.25), at(-0.06, -0.1, h2)],
        hands: [at(-0.08, 0.2, Y + 0.12), at(-0.08, -0.2, Y + 0.12)],
      });
      grabHip = Y - 0.95;
    }
    const k1 = {
      t: wallRun ? 0.36 : air ? 0.12 : lerp(0.22, 0.16, flow), hip: at(-0.3, 0, grabHip), pitch: 0.2, look: 0.25, grip: 1, fp: [0, 0],
      feet: wallRun
        ? [at(-0.14, 0.1, Y - 0.85), at(-0.12, -0.1, Y - 0.6)]
        : [at(-0.28, 0.1, feetY(grabHip)), at(-0.34, -0.1, feetY(grabHip))],
      hands: [at(-0.03, 0.2, Y - 0.01), at(-0.03, -0.2, Y - 0.01)],
    };
    const pullHip = Math.max(Y - 0.55, y0 + 0.8);
    const k2 = {
      t: tt(0.5), hip: at(-0.26, 0, pullHip), pitch: 0.4, look: 0.35, grip: 1, fp: [-0.5, 0.2],
      feet: [
        at(-0.1, 0.1, Math.max(y0, Y - 0.5) + ANKLE_H),
        at(-0.2, -0.1, Math.max(y0, pullHip - 0.85) + ANKLE_H),
      ],
      hands: [at(0.02, 0.2, Y + 0.03), at(0.02, -0.2, Y + 0.03)],
    };
    const k3 = {
      t: tt(lerp(0.76, 0.72, out)), hip: at(0.02 + out * 0.06, 0, Y + 0.52 + out * 0.08), pitch: 0.6, look: 0.2, grip: 0.6, fp: [0.1, -0.3],
      feet: [at(0.22, 0.1, Y + ANKLE_H), at(-0.08, -0.1, Math.max(y0, Y - 0.25) + ANKLE_H)],
      hands: [at(0.14, 0.21, Y + 0.045), at(0.14, -0.21, Y + 0.045)],
    };
    // exit: stand tall, or (with momentum) stay low and already striding forward
    const k4 = {
      t: 1, hip: at(endD, 0, Y + HIP_Y - 0.06 - out * 0.06), pitch: 0.08 + out * 0.25, look: 0, grip: 0.3, fp: [0, out * 0.4],
      feet: [at(endD + out * 0.18, 0.1, Y + ANKLE_H), at(endD - 0.02 - out * 0.2, -0.1, Y + ANKLE_H + out * 0.04)],
      hands: [null, null],
    };
    this.k0.look = 0;
    this.keys = [...keys, k1, k2, k3, k4];
  }
}

/** Vault over a low obstacle at speed: plant both hands, tuck the legs through, land running. */
class Vault extends Action {
  constructor(ch, edge, dir, L, landY) {
    const speed = Math.max(2.4, Math.hypot(ch.vel.x, ch.vel.z));
    const S = ch.pos;
    const dist = Math.hypot(edge.x - S.x, edge.z - S.z) + L.depth + 0.7;
    super(ch, dir, clamp(dist / speed + 0.12 + L.rise * 0.12, 0.5, 1.0));
    const Y = L.top, y0 = this.y0, f = this.fwd, l = this.left, D = L.depth;
    const at = (d, s, y) => edge.clone().addScaledVector(f, d).addScaledVector(l, s).setY(y);
    this.y1 = landY;
    this.root1 = at(D + 0.7, 0, landY);
    this.endVel = f.clone().multiplyScalar(Math.max(speed * 0.95, 2.2));
    this.m0 = V(ch.vel.x, 0, ch.vel.z).multiplyScalar(this.dur);
    this.mN = this.endVel.clone().multiplyScalar(this.dur * 0.8);
    // sprinting turns the step-through vault into a diving kong: hands reach further, hips
    // fly high and flat, legs tuck behind and swing through late
    const kong = clamp((speed - 3.6) / 1.2, 0, 1);
    const tp = clamp(Math.hypot(edge.x - S.x, edge.z - S.z) / dist, 0.18, 0.35);
    const plantHip = Math.max(y0 + 0.84, Y - 0.12) + kong * 0.12;
    const handD = lerp(0.12, Math.min(0.45, D * 0.4), kong);
    const k1 = {
      t: tp, hip: at(-0.32 - kong * 0.1, 0, plantHip), pitch: lerp(0.5, 0.9, kong), look: 0.3, grip: 0.5, fp: [0.3, 0.6],
      feet: [at(-0.3 - kong * 0.25, 0.1, y0 + ANKLE_H + kong * 0.1), at(-0.62 - kong * 0.2, -0.1, y0 + 0.25 + kong * 0.15)],
      hands: [at(handD, 0.19, Y + 0.045), at(handD, -0.19, Y + 0.045)],
    };
    const k2 = {
      t: lerp(tp, 1, 0.42), hip: at(D * 0.5, 0, Y + 0.42 + kong * 0.08), pitch: lerp(0.4, 0.75, kong), look: 0.15, grip: 0.5, fp: [0.2, 0.2],
      feet: [
        at(D * 0.5 + lerp(0.3, -0.05, kong), 0.13, Y + 0.2 + kong * 0.1),
        at(D * 0.5 + lerp(0.22, -0.12, kong), -0.13, Y + 0.24 + kong * 0.1),
      ],
      hands: [at(handD, 0.19, Y + 0.045), at(handD, -0.19, Y + 0.045)],
    };
    const k3 = {
      t: lerp(tp, 1, 0.74), hip: at(D + 0.3, 0, Math.max(landY + 0.9, Y + 0.1)), pitch: 0.2, look: 0, grip: 0.3, fp: [0, 0.1],
      feet: [at(D + 0.62, 0.1, Math.max(landY, Y - 0.55) + ANKLE_H), at(D + 0.4, -0.1, Math.max(landY, Y - 0.35) + ANKLE_H)],
      hands: [null, null],
    };
    const k4 = {
      t: 1, hip: at(D + 0.72, 0, landY + HIP_Y - 0.13), pitch: 0.25, look: 0, grip: 0.3, fp: [0, 0.2],
      feet: [at(D + 0.82, 0.1, landY + ANKLE_H), at(D + 0.55, -0.1, landY + ANKLE_H + 0.03)],
      hands: [null, null],
    };
    this.k0.look = 0;
    this.keys = [this.k0, k1, k2, k3, k4];
  }
}

/** Parkour roll out of a big drop: absorb through the legs, roll over the shoulder, run on. */
class Roll extends Action {
  constructor(ch, dir, g, d) {
    super(ch, dir, 0.78);
    const f = this.fwd, l = this.left, speed = Math.max(this.speed, 2.2);
    const base = V(ch.pos.x, g, ch.pos.z);
    const at = (a, s, y) => base.clone().addScaledVector(f, a).addScaledVector(l, s).setY(g + y);
    const hl = (x, y, z) => (o) => ch.hips.localToWorld(o.set(x, y, z));
    this.y0 = this.y1 = g;
    this.root1 = at(d, 0, 0);
    this.endVel = f.clone().multiplyScalar(speed * 0.9);
    this.m0 = V(ch.vel.x, ch.vy * 0.25, ch.vel.z).multiplyScalar(this.dur * 0.6);
    this.mN = this.endVel.clone().multiplyScalar(this.dur * 0.7);
    this.noArc = true;
    const cl = (x, y, z) => (o) => ch.chest.localToWorld(o.set(x, y, z));

    // Diagonal shoulder roll: the body pivots around the belly, and the spin axis is turned
    // so it goes from the lead shoulder across the back to the opposite hip.
    const s = Math.random() < 0.5 ? 1 : -1;             // lead shoulder side
    this.pivot = V(0, 0.22, 0.04);                       // belly, in pelvis space
    this.spinAxis = V(Math.cos(0.6), 0, -s * Math.sin(0.6)).normalize();
    this.spin = (t) => Math.PI * 2 * smooth(clamp((t - 0.17) / 0.62, 0, 1));
    // the first key must describe the belly too
    this.k0.hip.add(this.pivot.clone().applyQuaternion(ch.hips.getWorldQuaternion(new THREE.Quaternion())));
    const by = (ls, lead, trail) => (ls === s ? lead : trail); // per-side pick
    const sides = [1, -1];

    const keys = [
      // absorb: sink into the legs, reach both hands to the floor, lead hand turned in
      { t: 0.17, hip: at(d * 0.12, 0, 0.66), pitch: 1.05, curl: 0.45, twist: s * 0.3, bank: 0, look: 0.6, grip: 0.1,
        fp: [0, 0],
        feet: sides.map((ls) => at(d * 0.02 + by(ls, 0.06, -0.04), ls * 0.13, ANKLE_H)),
        hands: sides.map((ls) => at(d * 0.12 + by(ls, 0.5, 0.42), ls * 0.08 + s * by(ls, -0.02, 0.12), 0.04)) },
      // lead shoulder meets the floor, chin tucked, heels leave the ground
      { t: 0.36, hip: at(d * 0.36, 0, 0.4), pitch: 0.9, curl: 1, twist: s * 0.35, bank: s * 0.2, look: 0.8, grip: 0.3,
        fp: [0.5, 0.5],
        feet: sides.map((ls) => at(d * 0.14 + by(ls, 0.05, -0.05), ls * 0.14, ANKLE_H + 0.12)),
        hands: sides.map((ls) => by(ls, cl(ls * 0.15, -0.05, 0.25), at(d * 0.3 + 0.2, -s * 0.28, 0.04))) },
      // rolling diagonally across the back, tight tuck, knees to chest
      { t: 0.56, hip: at(d * 0.58, 0, 0.32), pitch: 0.9, curl: 1, twist: s * 0.2, bank: s * 0.15, look: 0.8, grip: 0.6,
        fp: [0.6, 0.6],
        feet: sides.map((ls) => hl(ls * 0.11, -0.08, 0.34)),
        hands: sides.map((ls) => hl(ls * 0.16, 0.12, 0.4)) },
      // feet come back down: trail leg folded underneath, lead foot planted in front
      { t: 0.78, hip: at(d * 0.8, 0, 0.62), pitch: 0.95, curl: 0.5, twist: s * 0.1, bank: 0, look: 0.3, grip: 0.3,
        fp: sides.map((ls) => by(ls, 0.2, 0.6)),
        feet: sides.map((ls) => by(ls, at(d * 0.8 + 0.22, ls * 0.12, ANKLE_H), at(d * 0.8 - 0.12, ls * 0.1, ANKLE_H + 0.05))),
        hands: sides.map((ls) => by(ls, null, at(d * 0.78, ls * 0.3, 0.04))) },
      // drive up and out, straight into the run
      { t: 1, hip: at(d + 0.04, 0, HIP_Y - 0.1 + 0.22), pitch: 0.3, curl: 0, twist: 0, bank: 0, look: 0, grip: 0.3,
        fp: sides.map((ls) => by(ls, 0, 0.35)),
        feet: sides.map((ls) => by(ls, at(d + 0.2, ls * 0.1, ANKLE_H), at(d - 0.14, ls * 0.1, ANKLE_H + 0.04))),
        hands: [null, null] },
    ];
    Object.assign(this.k0, { look: 0, curl: 0, twist: 0, bank: 0 });
    this.keys = [this.k0, ...keys];
  }
}

export const Traverse = {
  /** Landing from a big drop with speed: roll if there's room. */
  roll(ch, col, g) {
    const speed = Math.hypot(ch.vel.x, ch.vel.z);
    if (speed < 1.3) return null;
    const dir = V(ch.vel.x, 0, ch.vel.z).normalize();
    const d = clamp(speed * 0.55, 1.3, 2.8);
    for (const k of [0.5, 1]) {
      const x = ch.pos.x + dir.x * d * k, z = ch.pos.z + dir.z * d * k;
      if (col.blocked(x, z, g + 0.1, 0.3) || Math.abs(col.groundAt(x, z, g + 0.05, 0.1) - g) > 0.05) return null;
    }
    return new Roll(ch, dir, g, d);
  },

  /** Look for a climbable / vaultable ledge in the direction of travel. */
  try(ch, ctrl, col, auto = false) {
    const m = ctrl.move;
    const hasIn = m.lengthSq() > 0.04;
    if (!ch.grounded && (!hasIn || ch.vy > 2.5)) return null;
    const dir = hasIn ? V(m.x, 0, m.z).normalize() : ch.forward();
    const speed = Math.hypot(ch.vel.x, ch.vel.z);
    const feet = ch.pos.y;
    // momentum buys reach: a running approach can wall-run up to much taller ledges
    const maxRise = speed > 2.8 ? 3.3 : 2.3;
    const L = ch.grounded
      ? col.ledge(ch.pos, dir, feet, auto ? 0.55 + speed * 0.1 : 0.8 + speed * 0.12, 0.42, auto ? 1.25 : maxRise)
      : col.ledge(ch.pos, dir, feet, 0.6 + speed * 0.05, 0.3, speed > 2.8 ? 2.3 : 1.9);
    if (!L) return null;
    const n = V(L.nx, 0, L.nz);
    if (-n.dot(dir) < 0.55) return null;
    const edge = ch.pos.clone().addScaledVector(dir, L.t).setY(L.top);

    // vault: running at something low with clear ground on the other side
    if (ch.grounded && speed > 1.3 && L.rise <= 1.25 && L.depth <= 1.3) {
      const F = edge.clone().addScaledVector(dir, L.depth + 0.7);
      const gF = col.groundAt(F.x, F.z, feet + STEP, 0.15);
      const mid = edge.clone().addScaledVector(dir, L.depth * 0.5);
      if (gF > feet - 1.2 && !col.blocked(F.x, F.z, gF + 0.05, 0.3) && !col.blocked(mid.x, mid.z, L.top + 0.02, 0.15))
        return new Vault(ch, edge, dir, L, gF);
    }
    // free running: sprinting into something low climbs it on the fly
    if (auto && (speed < 3 || L.rise > 1.1)) return null;

    // mantle: needs room to stand on top
    const T = edge.clone().addScaledVector(n, -0.45);
    const gT = col.groundAt(T.x, T.z, L.top + 0.01, 0.05);
    if (Math.abs(gT - L.top) > 0.02 || col.blocked(T.x, T.z, L.top + 0.02, 0.22)) return null;
    return new Mantle(ch, edge, n, L, hasIn);
  },
};
