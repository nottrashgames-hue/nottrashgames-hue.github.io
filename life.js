import * as THREE from 'three';
import { orient, solveTwoBone, kneePole } from './ik.js';

/*
  Everyday body language, all procedural:
    Posture  - a Character action that takes over the whole body: sit on a seat, sit on the
               ground, lie down on your back; holds with breathing and glances; stands back up
    Gestures - an overlay on top of walking/standing (and sitting): talking hands, listening
               stances, nods, laughs, shrugs, waves, and looking at someone
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (r, dt) => 1 - Math.exp(-r * dt);
const rnd = (a, b) => a + Math.random() * (b - a);

const THIGH = 0.44, SHIN = 0.43, ANKLE_H = 0.075, UPPER_ARM = 0.29, FOREARM = 0.26;
const _a = V(), _b = V(), _c = V(), _e = V(), _p = V();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _eu = new THREE.Euler(0, 0, 0, 'YXZ');
const _h = V(), _pw = V(), _y = V(), _pr = V();
// palm directions for gestures (chest frame: x = the body's left, y = up, z = forward)
const _pUp = V(0, 1, 0.25).normalize(), _pFwd = V(0, 0, 1), _pDown = V(0, -1, 0), _pBack = V(0, 0, -1);
const _pLeft = V(1, 0, 0), _pRight = V(-1, 0, 0);
const _pSalute = V(0, -0.8, 0.35).normalize(), _pFive = V(0, 0.25, 1).normalize();

// ---------------------------------------------------------------------------------------
// Poses. Everything in the spot's frame: origin on the floor, +z = the way the body faces,
// +x = the body's left. hip = the hips group, feet = ankles, hands = wrists.
// ---------------------------------------------------------------------------------------
const P = (o) => ({ rx: 0, roll: 0, spine: 0, chest: 0, neck: 0, head: 0, fp: [0, 0], grip: 0.3, ...o });
const sym = (x, y, z) => [V(x, y, z), V(-x, y, z)];

function standPose(z = 0) {
  return P({ hip: V(0, 0.95, z), feet: sym(0.1, ANKLE_H, z + 0.02), hands: sym(0.22, 0.86, z + 0.03), rx: 0.04 });
}
const POSES = {
  // on a seat of height h: pelvis on the seat just behind its front edge, feet on the floor
  sitLower: (h) => P({ hip: V(0, lerp(h + 0.12, 0.95, 0.45), 0.02), rx: 0.35, spine: 0.25, chest: 0.12, neck: -0.25, head: -0.1,
    feet: sym(0.13, ANKLE_H, 0.34), hands: sym(0.2, h + 0.3, 0.3) }),
  sit: (h) => P({ hip: V(0, h + 0.1, -0.13), rx: 0.02, spine: 0.08, chest: 0.05, neck: -0.04, head: 0.02,
    feet: sym(0.14, ANKLE_H, 0.36), hands: sym(0.16, h + 0.2, 0.2), grip: 0.35 }),
  // on the floor, knees up, leaning back on the hands
  squat: () => P({ hip: V(0, 0.45, 0.02), rx: 0.55, spine: 0.3, chest: 0.15, neck: -0.35, head: -0.15,
    feet: sym(0.15, ANKLE_H, 0.3), hands: sym(0.22, 0.3, 0.2) }),
  ground: () => P({ hip: V(0, 0.13, -0.08), rx: -0.32, spine: 0.14, chest: 0.12, neck: 0.12, head: 0.08,
    feet: sym(0.15, ANKLE_H, 0.42), fp: [-0.2, -0.2], hands: sym(0.21, 0.06, -0.36), grip: 0.05 }),
  // flat on the back, legs out, hands resting on the belly
  lie: () => P({ hip: V(0, 0.1, -0.02), rx: -1.52, spine: -0.03, chest: -0.02, neck: 0.32, head: 0.12,
    feet: sym(0.13, 0.09, 0.9), fp: [-1.25, -1.25], hands: sym(0.1, 0.24, -0.3), grip: 0.25 }),
};

function lerpPose(A, B, t, out) {
  out.hip = (out.hip || V()).lerpVectors(A.hip, B.hip, t);
  for (const k of ['rx', 'roll', 'spine', 'chest', 'neck', 'head', 'grip']) out[k] = lerp(A[k], B[k], t);
  out.feet ||= [V(), V()]; out.hands ||= [V(), V()]; out.fp ||= [0, 0];
  for (let i = 0; i < 2; i++) {
    out.feet[i].lerpVectors(A.feet[i], B.feet[i], t);
    out.hands[i].lerpVectors(A.hands[i], B.hands[i], t);
    out.fp[i] = lerp(A.fp[i], B.fp[i], t);
    // limbs moving any distance lift on the way (feet step, hands swing) instead of sliding
    const df = A.feet[i].distanceTo(B.feet[i]);
    if (df > 0.05) out.feet[i].y += Math.sin(Math.PI * t) * Math.min(0.1, df * 0.5);
    const dh = A.hands[i].distanceTo(B.hands[i]);
    if (dh > 0.08) out.hands[i].y += Math.sin(Math.PI * t) * Math.min(0.08, dh * 0.3);
  }
  return out;
}

/**
 * A held posture. kind: 'sit' (spot = seat), 'ground' (sit on the floor) or 'lie'.
 * spot = { o: floor point (seat front edge for seats), yaw, h }.
 */
export class Posture {
  constructor(ch, kind, spot) {
    this.ch = ch;
    this.kind = kind;
    this.spot = spot;
    this.isPosture = true;
    this.o = spot.o.clone();
    this.yaw = spot.yaw;
    this.cur = {};
    this.t = 0;
    this.phase = 'enter';
    this.glance = { yaw: 0, pitch: 0, t: rnd(1, 3), y: 0, p: 0 };
    this.lookAt = null; // world point to look at (set by the owner)
    // where the body is right now becomes the first key, so it starts exactly from there
    const start = this.capture();
    const h = spot.h || 0;
    const seq = kind === 'sit' ? [[POSES.sitLower(h), 0.65], [POSES.sit(h), 0.6]]
      : kind === 'ground' ? [[POSES.squat(), 0.7], [POSES.ground(), 0.75]]
      : [[POSES.squat(), 0.7], [POSES.ground(), 0.75], [POSES.lie(), 0.9]];
    this.keys = [start, ...seq.map((s) => s[0])];
    this.durs = seq.map((s) => s[1]);
    this.root0 = ch.pos.clone();
    this.yaw0 = ch.yaw;
    // standing back up: the same keys in reverse, ending on your feet in front of the spot
    this.exitZ = kind === 'sit' ? 0.4 : kind === 'lie' ? 0.1 : 0.05;
  }

  toLocal(v, out = V()) { return out.copy(v).sub(this.o).applyAxisAngle(UP, -this.yaw); }
  toWorld(v, out = V()) { return out.copy(v).applyAxisAngle(UP, this.yaw).add(this.o); }

  capture() {
    const ch = this.ch;
    ch.root.updateMatrixWorld(true);
    return P({
      hip: this.toLocal(ch.hips.getWorldPosition(V())),
      rx: ch.hips.rotation.x, spine: ch.spine.rotation.x, chest: ch.chest.rotation.x,
      neck: ch.neck.rotation.x, head: ch.head.rotation.x,
      feet: ch.legs.map((l) => this.toLocal(l.ankle)),
      fp: ch.legs.map((l) => l.pitch || 0),
      hands: ch.arms.map((a, i) => this.toLocal(a.handPos || ch.chest.localToWorld(V(a.side * 0.22, -0.33, 0.05)))),
    });
  }

  /** Ask to get up. fast: in a hurry (startled). */
  stand(fast = false) {
    if (this.phase === 'exit') return;
    const last = this.capture();
    const up = standPose(this.exitZ);
    this.keys = [last, ...this.keys.slice(1, -1).reverse(), up];
    this.durs = this.durs.slice().reverse().map((d) => d * (fast ? 0.55 : 0.9));
    this.phase = 'exit';
    this.t = 0;
  }

  get settled() { return this.phase === 'hold'; }

  update(dt, ctrl) {
    const ch = this.ch;
    // the player gets up by moving
    if (ctrl?.wantsUp && this.phase !== 'exit') this.stand();
    let pose;
    if (this.phase === 'hold') pose = this.keys[this.keys.length - 1];
    else {
      this.t += dt;
      let t = this.t, i = 0;
      while (i < this.durs.length - 1 && t > this.durs[i]) { t -= this.durs[i]; i++; }
      const k = clamp(t / this.durs[i], 0, 1);
      pose = lerpPose(this.keys[i], this.keys[i + 1], smooth(k), this.cur);
      const total = this.durs.reduce((s, d) => s + d, 0);
      const T = clamp(this.t / total, 0, 1);
      if (this.phase === 'enter') {
        ch.pos.lerpVectors(this.root0, this.o, smooth(clamp(T * 1.6, 0, 1)));
        ch.yaw = this.yaw0 + wrap(this.yaw - this.yaw0) * smooth(clamp(T * 2, 0, 1));
      } else {
        this.toWorld(_a.set(0, 0, this.exitZ), ch.pos);
        ch.yaw = this.yaw;
      }
      if (this.t >= total) {
        if (this.phase === 'enter') this.phase = 'hold';
        else { this.apply(pose, dt); this.finish(); return false; }
      }
    }
    if (this.phase === 'hold') { ch.pos.copy(this.o); ch.yaw = this.yaw; }
    this.apply(pose, dt);
    return true;
  }

  /** Pose the whole body. */
  apply(pose, dt) {
    const ch = this.ch, yaw = ch.yaw;
    ch.time += dt;
    const hold = this.phase === 'hold' ? 1 : 0;
    const breathe = Math.sin(ch.time * (this.kind === 'lie' ? 1.4 : 1.8));
    ch.root.position.copy(ch.pos);
    ch.root.rotation.y = yaw;
    // the spot's frame drives the body; the root may be mid-way while getting there
    const hipW = this.toWorld(pose.hip, _a);
    const local = hipW.sub(ch.pos).applyAxisAngle(UP, -yaw);
    ch.hips.position.copy(local);
    ch.hipY = local.y;
    const dyaw = wrap(this.yaw - yaw);
    ch.hips.rotation.set(pose.rx, dyaw, pose.roll, 'XYZ');

    // idle life: breathing, and the head glancing about (or at whoever we're with)
    const g = this.glance;
    g.t -= dt;
    if (g.t <= 0) {
      g.t = rnd(1.5, 4.5);
      const big = Math.random() < 0.3;
      g.yaw = big ? rnd(-1, 1) : rnd(-0.35, 0.35);
      g.pitch = this.kind === 'lie' ? rnd(-0.1, 0.1) : rnd(-0.15, 0.2);
    }
    let gy = g.yaw, gp = g.pitch;
    if (this.lookAt) {
      ch.root.updateMatrixWorld(true);
      const hp = ch.head.getWorldPosition(_b);
      const d = _c.subVectors(this.lookAt, hp);
      gy = clamp(wrap(Math.atan2(d.x, d.z) - yaw), -1.2, 1.2);
      gp = clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.5, 0.5);
      if (this.kind === 'lie') { gy *= 0.4; gp = 0; }
    }
    g.y = lerp(g.y, gy * hold, damp(3, dt));
    g.p = lerp(g.p, gp * hold, damp(3, dt));
    ch.spine.rotation.set(pose.spine + 0.012 * breathe, g.y * 0.12, 0);
    ch.chest.rotation.set(pose.chest - 0.01 * breathe, g.y * 0.15, 0);
    ch.neck.rotation.set(pose.neck + g.p * 0.4, g.y * 0.35, 0);
    ch.head.rotation.set(pose.head + g.p * 0.6, g.y * 0.45, 0);
    ch.root.updateMatrixWorld(true);

    const hq = ch.hips.getWorldQuaternion(_q);
    const chestF = V(0, 0, 1).applyQuaternion(ch.chest.getWorldQuaternion(_q2));
    const hipJ = V(), ankle = V(), end = V(), pole = V();
    ch.legs.forEach((l, i) => {
      this.toWorld(pose.feet[i], ankle);
      ch.hips.localToWorld(hipJ.set(l.side * 0.088, -0.055, 0));
      // (the knee bends ahead of the thigh whichever way the pelvis is tipped: see kneePole)
      kneePole(hq, hipJ, ankle, l.side, pole);
      solveTwoBone(hipJ, ankle, ch.D.THIGH, ch.D.SHIN, pole, l.knee, end);
      orient(l.thigh, hipJ, l.knee, pole);
      orient(l.shin, l.knee, end, pole);
      l.ankle.copy(end);
      l.pitch = pose.fp[i];
      l.foot.position.copy(end);
      l.foot.quaternion.setFromEuler(_eu.set(pose.fp[i], this.yaw + l.side * 0.08, 0, 'YXZ'));
      l.toe.rotation.x = 0;
      l.footYaw = this.yaw;
      l.contact.copy(end).setY(end.y - ANKLE_H);
    });
    const sh = V(), hand = V();
    ch.arms.forEach((a, i) => {
      ch.chest.localToWorld(sh.set(a.side * 0.185, 0.2, -0.015));
      this.toWorld(pose.hands[i], hand);
      a.handPos = (a.handPos || V()).copy(hand);
      ch.chest.localToWorld(pole.set(a.side * 0.6, -0.3, -0.45)).sub(ch.chest.getWorldPosition(_e)).normalize();
      solveTwoBone(sh, hand, ch.D.UPPER_ARM, ch.D.FOREARM, pole, a.elbow, end);
      orient(a.upper, sh, a.elbow, chestF, true);
      orient(a.fore, a.elbow, end, chestF, true);
      a.hand.rotation.set(0.15, 0, -0.1);
      const c = 0.2 + pose.grip * 0.8;
      a.fingers.forEach(([f1, f2], j) => { f1.rotation.z = -(c + j * 0.06); f2.rotation.z = -(c * 1.15 + j * 0.05); });
      a.thumb[1].rotation.z = -c * 0.6;
    });
    // conversation gestures ride on top while settled
    if (hold) ch.lifeHook?.(ch, dt, this);
  }

  /** Back to walking, feet planted where the pose left them. */
  finish() {
    const ch = this.ch;
    this.spot.by = null;
    ch.grounded = true;
    ch.vy = 0;
    ch.vel.set(0, 0, 0);
    ch.hipY = ch.hips.position.y;
    ch.hipYV = 0;
    ch.turnRate = 0;
    ch.settling = true;
    ch.freq = 0;
    for (const l of ch.legs) {
      l.swinging = false;
      l.contact.copy(l.ankle).setY(ch.gAt(l.ankle.x, l.ankle.z));
      l.footYaw = this.yaw;
    }
  }
}

// ---------------------------------------------------------------------------------------
// Getting up off the floor. The spot's frame: origin under the pelvis, +z = the way you'll
// face once up. Each start key is a canonical floor pose the ragdoll's own pose eases into
// (Actor blends the physical pose over the first hold), then the body works its way up.
// ---------------------------------------------------------------------------------------
const RISE = {
  // face down: push up, knees under, one foot forward, stand
  prone: [
    [P({ hip: V(0, 0.13, 0), rx: 1.5, neck: -0.25, head: -0.1,
      feet: sym(0.13, 0.07, -0.86), fp: [1.3, 1.3], hands: sym(0.26, 0.05, 0.36), grip: 0.05 }), 0.45],
    [P({ hip: V(0, 0.2, -0.02), rx: 1.05, spine: -0.15, chest: -0.1, neck: -0.35, head: -0.1,
      feet: sym(0.13, 0.07, -0.84), fp: [1.3, 1.3], hands: sym(0.24, 0.05, 0.36), grip: 0.05 }), 0.45],
    [P({ hip: V(0, 0.55, -0.08), rx: 1.4, spine: 0.05, chest: 0.05, neck: -0.5, head: -0.2,
      feet: sym(0.12, 0.09, -0.46), fp: [1.35, 1.35], hands: sym(0.22, 0.05, 0.4), grip: 0.05 }), 0.5],
    [P({ hip: V(0, 0.52, -0.12), rx: 0.4, spine: 0.2, chest: 0.1, neck: -0.2,
      feet: [V(0.13, ANKLE_H, 0.3), V(-0.12, 0.09, -0.46)], fp: [0, 1.3],
      hands: [V(0.15, 0.55, 0.3), V(-0.24, 0.3, 0.12)], grip: 0.2 }), 0.45],
    [P({ hip: V(0, 0.82, 0.02), rx: 0.3, spine: 0.12, chest: 0.05, neck: -0.1,
      feet: [V(0.13, ANKLE_H, 0.3), V(-0.1, ANKLE_H, -0.02)], fp: [0, 0.2],
      hands: sym(0.22, 0.72, 0.22), grip: 0.25 }), 0.4],
  ],
  // on the back: arms at the sides, sit up, rock forward over the feet, stand
  supine: [
    [P({ hip: V(0, 0.1, -0.02), rx: -1.52, neck: 0.25, head: 0.1,
      feet: sym(0.14, 0.09, 0.9), fp: [-1.25, -1.25], hands: sym(0.3, 0.06, -0.2), grip: 0.1 }), 0.45],
    [P({ hip: V(0, 0.12, -0.06), rx: -0.7, spine: 0.15, chest: 0.1, neck: 0.15, head: 0.05,
      feet: sym(0.15, ANKLE_H, 0.5), fp: [-0.3, -0.3], hands: sym(0.22, 0.05, -0.3), grip: 0.05 }), 0.5],
    [P({ hip: V(0, 0.14, 0.05), rx: 0.2, spine: 0.35, chest: 0.2, neck: -0.2,
      feet: sym(0.15, ANKLE_H, 0.34), hands: [V(0.28, 0.05, 0.12), V(-0.2, 0.3, 0.42)], grip: 0.05 }), 0.45],
    [P({ hip: V(0, 0.45, 0.1), rx: 0.7, spine: 0.3, chest: 0.15, neck: -0.4, head: -0.15,
      feet: sym(0.15, ANKLE_H, 0.32), hands: sym(0.2, 0.35, 0.34), grip: 0.2 }), 0.45],
  ],
  // already propped up (sitting, kneeling): straight to a crouch
  upright: [
    [P({ hip: V(0, 0.45, 0.02), rx: 0.55, spine: 0.3, chest: 0.15, neck: -0.35, head: -0.15,
      feet: sym(0.15, ANKLE_H, 0.3), hands: sym(0.22, 0.3, 0.3), grip: 0.2 }), 0.4],
  ],
};

/**
 * Off the floor and back on your feet. kind: 'prone' | 'supine' | 'upright'.
 * hold: how long the first key is held (the physical pose blends into it meanwhile).
 */
export class GetUp extends Posture {
  constructor(ch, kind, spot, hold, speed = 1) {
    super(ch, 'lie', { ...spot, h: 0 });
    this.isPosture = false;
    this.isGetUp = true;
    const seq = RISE[kind];
    this.exitZ = kind === 'prone' ? 0.12 : 0.28;
    this.keys = [seq[0][0], ...seq.map((s) => s[0]), standPose(this.exitZ)];
    this.durs = [hold, ...seq.map((s) => s[1] / speed)];
    this.phase = 'exit';
    this.t = 0;
  }
  stand() {}
}

// ---------------------------------------------------------------------------------------
// Gestures: hands in the chest's frame (x = left, y = up, z = forward; shoulders sit at
// (±0.185, 0.2, 0)). Each arm has its own weight over whatever the body is doing underneath.
// ---------------------------------------------------------------------------------------
const LISTEN = ['cross', 'hips', 'back', 'loose', 'loose'];

// the emotes: which go on until stopped, how long the rest last
const LOOPS = new Set(['dance', 'disco', 'clap', 'cheer', 'flex', 'zombie', 'feed']);
const EMOTE_T = { thumbsup: 1.8, salute: 2, bow: 2, facepalm: 2.2, dab: 1.6, highfive: 1.6 };
const BEAT = 2; // Hz: 120 bpm

export class Gestures {
  constructor(ch) {
    this.ch = ch;
    this.kind = null;
    this.style = 'loose';     // listening stance for this conversation
    this.look = null;         // world point to look at
    this.lookW = 0;
    this.w = [0, 0];
    this.tgt = [V(), V()];    // chest-local hand targets (smoothed)
    this.want = [V(), V()];
    this.wantW = [0, 0];
    this.pole = [V(), V()];
    this.t = 0;
    this.phraseT = 0;
    this.nod = 0; this.nodV = 0; this.nodT = rnd(1, 3);
    this.oneT = 0;            // one-off gesture timer (shrug, wave, laugh)
    this.one = null;
    ch.lifeHook = (c, dt, posture) => this.update(dt, posture);
  }

  /** Ongoing activity: null, 'talk' or 'listen'. */
  set(kind) {
    if (kind === this.kind) return;
    this.kind = kind;
    this.phraseT = 0;
    if (kind === 'listen' && Math.random() < 0.5) this.style = LISTEN[Math.floor(Math.random() * LISTEN.length)];
  }
  /**
   * A one-off on top: 'shrug', 'wave', 'laugh', 'nod', and the unfriendly ones: 'shake' (fist
   * shaken in the air), 'shoo' (angry get-outta-here wave), 'point', 'handsup', 'comeon',
   * and the sad or shocked ones: 'cry' (face in both hands, shoulders shaking), 'horror'
   * (hands to the mouth), 'despair' (hands on the head).
   * Emotes (the wheel): 'cheer', 'clap', 'thumbsup', 'salute', 'bow', 'facepalm', 'flex',
   * 'dab', 'highfive', 'dance', 'disco' - the ones in LOOPS go on until stop().
   */
  play(one, dur, five = null) {
    if (one === 'nod') { this.nodV -= 3.2; return; }
    this.one = one;
    this.five = five;
    // (bracketed: `a ?? b ? c : d` is `(a ?? b) ? c : d`, which gave every EMOTE_T emote the laugh's
    // random length - a bow cut short, never easing down)
    this.oneDur = this.oneT = dur ?? (LOOPS.has(one) ? Infinity : EMOTE_T[one] ?? (one === 'laugh' ? rnd(1.4, 2.4) : one === 'wave' ? 1.6 : one === 'shake' || one === 'shoo' || one === 'comeon' ? rnd(1.4, 2)
      : one === 'point' ? 1.4 : one === 'handsup' ? 3 : one === 'cry' ? rnd(3, 5) : one === 'horror' ? rnd(1.6, 2.4) : one === 'despair' ? rnd(2, 3) : 1.1));
  }
  /** Any one-off (an emote looping on) ends, easing out. */
  stop() { if (this.one && this.oneT > 0.3) this.oneT = 0.3; }
  newStyle() { this.style = LISTEN[Math.floor(Math.random() * LISTEN.length)]; }

  /** Pick the next talking phrase: which hands, where. */
  phrase() {
    const m = Math.random();
    const j = () => rnd(-0.04, 0.04);
    const W = this.want, K = this.wantW;
    if (m < 0.3) { // both hands shaping the idea
      for (let i = 0; i < 2; i++) { const s = i ? -1 : 1; W[i].set(s * (0.15 + j()), -0.12 + j(), 0.3 + j()); K[i] = 1; }
    } else if (m < 0.65) { // one hand explaining, the other hanging
      const i = Math.random() < 0.6 ? 1 : 0, s = i ? -1 : 1;
      W[i].set(s * (0.12 + j()), -0.07 + j(), 0.33 + j()); K[i] = 1; K[1 - i] = Math.random() < 0.3 ? 0.4 : 0;
      W[1 - i].set(-s * 0.2, -0.3, 0.12);
    } else if (m < 0.82) { // palms open, out to the sides
      for (let i = 0; i < 2; i++) { const s = i ? -1 : 1; W[i].set(s * (0.25 + j()), -0.17 + j(), 0.25); K[i] = 1; }
    } else if (m < 0.92) { // pointing at something
      const i = 1; W[i].set(-0.08 + j(), 0.04 + j(), 0.46); K[i] = 1; K[0] = 0;
    } else { K[0] = K[1] = 0; } // a pause, hands down
    this.phraseT = rnd(0.7, 1.8);
  }

  update(dt, posture) {
    const ch = this.ch;
    this.t += dt;
    const t = this.t;
    const seated = !!posture;
    const W = this.want, K = this.wantW, Pl = this.pole;
    // ---- what the hands want ----
    for (let i = 0; i < 2; i++) Pl[i].set((i ? -1 : 1) * 0.5, -0.4, -0.4);
    if (this.kind === 'talk') {
      this.phraseT -= dt;
      if (this.phraseT <= 0) this.phrase();
    } else if (this.kind === 'listen' && !seated) {
      const st = this.style;
      for (let i = 0; i < 2; i++) {
        const s = i ? -1 : 1;
        if (st === 'cross') { W[i].set(-s * 0.08, -0.2 + i * 0.03, 0.19); Pl[i].set(s * 0.5, -1, 0.2); K[i] = 1; }
        else if (st === 'hips') { W[i].set(s * 0.19, -0.42, -0.01); Pl[i].set(s * 1, 0.2, -0.35); K[i] = 1; }
        else if (st === 'back') { W[i].set(s * 0.06, -0.46, -0.17); Pl[i].set(s * 0.5, -0.5, -0.8); K[i] = 1; }
        else K[i] = 0;
      }
    } else { K[0] = K[1] = 0; }
    // one-offs override
    let laugh = 0, shrug = 0, cry = 0, sobbing = 0;
    // (emotes: the trunk bowed / swayed / bobbing, the head's tilt and turn, the fingers)
    let bow = 0, sway = 0, bob = 0, headZ = 0, headY = 0, headX = 0;
    const curl = [null, null], thumb = [false, false];
    // which way each palm faces (chest frame; null: however the forearm falls), and a pointing index finger
    const palm = [null, null], index = [false, false];
    if (this.one) {
      this.oneT -= dt;
      const e = smooth(clamp(this.oneT / 0.3, 0, 1));
      if (this.one === 'shrug') {
        shrug = e;
        for (let i = 0; i < 2; i++) { const s = i ? -1 : 1; W[i].set(s * 0.3, -0.2, 0.22); Pl[i].set(s * 0.3, -1, -0.3); K[i] = 1; palm[i] = _pUp; }
      } else if (this.one === 'wave') {
        W[1].set(-0.3 + Math.sin(t * 10) * 0.07, 0.44, 0.1); Pl[1].set(-1, -0.6, -0.1); K[1] = 1; palm[1] = _pFwd; curl[1] = 0.05;
      } else if (this.one === 'shake') {
        // fist up by the head, pumping
        W[1].set(-0.24, 0.4 + Math.sin(t * 17) * 0.06, 0.18 + Math.sin(t * 17) * 0.03); Pl[1].set(-1, -0.4, -0.1); K[1] = 1;
        shrug = 0.3 * e;
      } else if (this.one === 'shoo') {
        // back of the hand flicking out: go on, beat it
        const f = 0.5 + 0.5 * Math.sin(t * 10);
        W[1].set(-0.1 - 0.28 * f, 0.02 + 0.08 * f, 0.36 - 0.08 * f); Pl[1].set(-1, -0.6, -0.3); K[1] = 1;
      } else if (this.one === 'point') {
        // (five: someone in particular - a chat line aimed at them: the arm out toward their head)
        if (this.five?.head) {
          ch.chest.worldToLocal(this.five.head.getWorldPosition(_a));
          _a.x += 0.185; _a.y -= 0.2;
          _a.z = Math.max(_a.z, 0.25 * Math.hypot(_a.x, _a.y));
          _a.normalize();
          W[1].set(-0.185, 0.2, 0).addScaledVector(_a, 0.56 + Math.sin(t * 9) * 0.02);
        } else W[1].set(-0.08, 0.16, 0.52 + Math.sin(t * 9) * 0.03);
        Pl[1].set(-1, -0.5, 0); K[1] = 1; curl[1] = 1.3; index[1] = true; palm[1] = _pDown;
      } else if (this.one === 'zombie') {
        // the dead: arms held out in front, reaching and clawing, never quite in step; the
        // head lolling on one side, the trunk hunched forward. zReach (zombie.js) lifts them
        // higher, grabbing for someone close
        const zr = this.zReach || 0, zs = this.zSeed ??= Math.random() * 10;
        for (let i = 0; i < 2; i++) {
          const s = i ? -1 : 1, ph = t * 2.2 + zs + i * 1.9;
          W[i].set(s * (0.14 - zr * 0.05) + 0.02 * Math.sin(ph * 0.7), -0.04 + zr * 0.1 + 0.04 * Math.sin(ph), 0.44 + zr * 0.1 + 0.05 * Math.sin(ph * 1.3));
          Pl[i].set(s * 1, -0.8, -0.1);
          K[i] = 1;
          curl[i] = 0.55 + 0.35 * Math.sin(ph * 1.7);
        }
        bow = 0.22 + zr * 0.1;
        headZ = (zs % 2 < 1 ? 1 : -1) * (0.3 + 0.08 * Math.sin(t * 0.9 + zs));
        headX = 0.12 + 0.06 * Math.sin(t * 1.3 + zs);
        headY = 0.1 * Math.sin(t * 0.6 + zs);
        sway = 0.06 * Math.sin(t * 1.4 + zs);
      } else if (this.one === 'feed') {
        // down on someone, hands dug in, head bobbing into them
        const d = Math.abs(Math.sin(t * 3.2));
        for (let i = 0; i < 2; i++) { const s = i ? -1 : 1; W[i].set(s * 0.13, -0.28, 0.36); Pl[i].set(s * 1, -0.4, -0.2); K[i] = 1; curl[i] = 1.1; }
        bow = 0.45 + d * 0.15;
        headX = 0.3 + d * 0.25;
        headZ = 0.15 * Math.sin(t * 5);
      } else if (this.one === 'handsup') {
        for (let i = 0; i < 2; i++) { const s = i ? -1 : 1; W[i].set(s * 0.27, 0.46, 0.1); Pl[i].set(s * 1, -0.7, -0.2); K[i] = 1; palm[i] = _pFwd; curl[i] = 0.05; }
      } else if (this.one === 'comeon') {
        // arms out wide, beckoning: come at me
        for (let i = 0; i < 2; i++) { const s = i ? -1 : 1; W[i].set(s * 0.36, -0.08 + 0.04 * Math.sin(t * 8), 0.24 + 0.06 * Math.sin(t * 8 + i)); Pl[i].set(s * 1, -0.5, -0.4); K[i] = 1; palm[i] = _pUp; }
        shrug = 0.4 * e;
      } else if (this.one === 'phone') {
        // a phone held to the right ear
        W[1].set(-0.1, 0.4, 0.04); Pl[1].set(-1, -0.8, -0.1); K[1] = 1;
      } else if (this.one === 'cry') {
        // face buried in the hands, head down, sobbing
        const sob = Math.max(0, Math.sin(t * 7.5)) * (0.6 + 0.4 * Math.sin(t * 1.3));
        for (let i = 0; i < 2; i++) { const s = i ? -1 : 1; W[i].set(s * 0.045, 0.36 - sob * 0.015, 0.2); Pl[i].set(s * 0.6, -1, -0.1); K[i] = 1; }
        cry = e; sobbing = sob * e;
      } else if (this.one === 'horror') {
        // both hands to the mouth
        for (let i = 0; i < 2; i++) { const s = i ? -1 : 1; W[i].set(s * 0.03, 0.33, 0.22); Pl[i].set(s * 0.7, -1, -0.1); K[i] = 1; }
        shrug = 0.35 * e;
      } else if (this.one === 'despair') {
        // hands on top of the head
        for (let i = 0; i < 2; i++) { const s = i ? -1 : 1; W[i].set(s * 0.1, 0.56, 0.02); Pl[i].set(s * 1, 0.1, -0.3); K[i] = 1; }
      } else if (this.one === 'laugh') {
        laugh = e;
        for (let i = 0; i < 2; i++) { const s = i ? -1 : 1; W[i].set(s * 0.09, -0.36, 0.2); K[i] = 0.7; }
      } else if (this.one === 'cheer') {
        // both fists punching the air, up on the toes of it
        for (let i = 0; i < 2; i++) { const s = i ? -1 : 1; const f = Math.max(0, Math.sin(t * 9 + i * Math.PI)); W[i].set(s * 0.22, 0.46 + f * 0.14, 0.08); Pl[i].set(s * 1, -0.6, -0.2); K[i] = 1; curl[i] = 1.3; }
        headX = -0.25 * e; bob = 0.02 * Math.abs(Math.sin(t * 9)) * e;
      } else if (this.one === 'clap') {
        // hands meeting in front of the chest (the clap sound is the owner's: clapHit)
        const f = Math.abs(Math.sin(t * 7));
        for (let i = 0; i < 2; i++) { const s = i ? -1 : 1; W[i].set(s * (0.018 + 0.1 * f), 0.05, 0.3); Pl[i].set(s * 1, -0.8, -0.1); K[i] = 1; curl[i] = 0.05; palm[i] = s > 0 ? _pRight : _pLeft; }
        if (this.lastF > 0.12 && f <= 0.12) this.onClap?.();
        this.lastF = f;
      } else if (this.one === 'thumbsup') {
        W[1].set(-0.1, 0.08, 0.42); Pl[1].set(-1, -0.8, -0.2); K[1] = 1; curl[1] = 1.4; thumb[1] = true; palm[1] = _pLeft;
        headZ = 0.1 * e;
      } else if (this.one === 'salute') {
        // flat hand to the brow, stood up straight
        W[1].set(-0.17, 0.45, 0.12); Pl[1].set(-1, 0.1, 0.1); K[1] = 1; curl[1] = 0; palm[1] = _pSalute;
        headX = -0.06 * e; bow = -0.04 * e;
      } else if (this.one === 'vomit') {
        // doubled over, a hand clutching the belly, the other braced out; heaving (organs.js vomit)
        const heave = Math.max(0, Math.sin(t * 5.5)) ** 2;
        const d = smooth(clamp((this.oneDur - this.oneT) / 0.35, 0, 1)) * e;
        bow = (0.62 + 0.14 * heave) * d; headX = (0.35 - 0.15 * heave) * d;
        W[1].set(-0.04, -0.34 + heave * 0.02, 0.2); Pl[1].set(-1, -1, 0); K[1] = d; curl[1] = 0.6;
        W[0].set(0.2, -0.46, 0.26); Pl[0].set(1, -0.6, -0.2); K[0] = 0.8 * d; curl[0] = 0.2;
      } else if (this.one === 'bow') {
        // from the waist, one arm across the front
        const d = smooth(clamp((EMOTE_T.bow - this.oneT) / 0.5, 0, 1)) * e;
        bow = 0.75 * d; headX = 0.25 * d;
        W[1].set(0.02, -0.2, 0.2); Pl[1].set(-1, -1, 0); K[1] = 1;
        W[0].set(0.3, -0.35, -0.18); Pl[0].set(1, -0.5, -0.8); K[0] = 0.8;
      } else if (this.one === 'facepalm') {
        W[1].set(-0.02, 0.35, 0.18); Pl[1].set(-1, -1, 0.2); K[1] = 1; curl[1] = 0.1; palm[1] = _pBack;
        headX = 0.3 * e; headZ = -0.08 * e;
      } else if (this.one === 'flex') {
        // double biceps: fists up by the ears, elbows out at the sides
        const p = 0.02 * Math.sin(t * 5);
        for (let i = 0; i < 2; i++) { const s = i ? -1 : 1; W[i].set(s * 0.36, 0.36 + p, 0.02); Pl[i].set(s * 1, -0.35, 0); K[i] = 1; curl[i] = 1.4; }
        bow = -0.08 * e; headX = -0.1 * e;
      } else if (this.one === 'dab') {
        // right arm flung out and up, face buried in the left elbow
        W[1].set(-0.58, 0.44, 0.14); Pl[1].set(0, -1, 0); K[1] = 1;
        W[0].set(-0.12, 0.33, 0.24); Pl[0].set(-0.2, -0.3, 1); K[0] = 1;
        headX = 0.35 * e; headY = 0.45 * e; headZ = 0.2 * e; bow = 0.12 * e;
      } else if (this.one === 'highfive') {
        // palm up and out - toward whoever's being high-fived, if anyone
        // (five: the Character high-fived - the hands meet halfway, up over the heads... nearly)
        if (this.five?.chest) {
          const m = this.five.chest.getWorldPosition(W[1]).add(ch.chest.getWorldPosition(_a)).multiplyScalar(0.5);
          m.y += 0.4;
          ch.chest.worldToLocal(m);
        } else W[1].set(-0.16, 0.42, 0.36);
        W[1].y = clamp(W[1].y, 0.2, 0.5); W[1].z = clamp(W[1].z, 0.2, 0.46); W[1].x = clamp(W[1].x, -0.35, 0.05);
        Pl[1].set(-1, -0.6, 0); K[1] = 1; curl[1] = 0; palm[1] = _pFive;
      } else if (this.one === 'dance' || this.one === 'disco') {
        // on the beat everyone shares (the wall clock): whoever's dancing is dancing together
        const bt = (Date.now() / 1000) * Math.PI * 2 * BEAT;
        const b = Math.sin(bt), h = Math.sin(bt * 0.5);
        bob = 0.035 * Math.abs(b) * e; sway = 0.14 * h * e; headZ = 0.12 * h * e; headX = 0.1 * Math.abs(b) * e;
        if (this.one === 'dance') {
          // arms pumping, elbows bent, alternating
          for (let i = 0; i < 2; i++) { const s = i ? -1 : 1, f = Math.sin(bt * 0.5 + i * Math.PI); W[i].set(s * 0.2, -0.08 + f * 0.1, 0.24 + f * 0.05); Pl[i].set(s * 1, -0.7, -0.3); K[i] = 1; curl[i] = 1.2; }
        } else {
          // the disco point: up to the corner, down across the hips
          const up = h > 0;
          W[1].set(up ? -0.34 : 0.08, up ? 0.6 : -0.32, up ? 0.14 : 0.24); Pl[1].set(-1, -0.4, 0); K[1] = 1; curl[1] = 1.1;
          W[0].set(0.19, -0.42, -0.01); Pl[0].set(1, 0.2, -0.35); K[0] = 1;
          headY = (up ? -0.25 : 0.15) * e;
        }
      }
      if (this.oneT <= 0) this.one = null;
    }
    // listeners nod now and then; talkers bob their heads with the words
    if (this.kind === 'listen') {
      this.nodT -= dt;
      if (this.nodT <= 0) { this.nodT = rnd(1.5, 4); if (Math.random() < 0.7) this.nodV -= rnd(2, 3.5); }
    }
    for (let t = dt; t > 1e-6; t -= 1 / 120) {
      const h = Math.min(t, 1 / 120);
      this.nodV += (-this.nod * 90 - this.nodV * 11) * h;
      this.nod += this.nodV * h;
    }

    // ---- head and chest ----
    const hasLook = !!this.look;
    this.lookW = lerp(this.lookW, hasLook ? 1 : 0, damp(4, dt));
    if (posture) posture.lookAt = this.look;
    else if (this.lookW > 0.01 && hasLook) {
      ch.root.updateMatrixWorld(true);
      const hp = ch.head.getWorldPosition(_a);
      const d = _b.subVectors(this.look, hp);
      const pitch = clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.5, 0.5);
      ch.neck.rotation.x += pitch * 0.4 * this.lookW;
      ch.head.rotation.x += pitch * 0.6 * this.lookW;
    }
    const talk = this.kind === 'talk' ? 1 : 0;
    ch.head.rotation.x += this.nod + talk * 0.03 * Math.sin(t * 6.3) - laugh * 0.28;
    ch.head.rotation.z += talk * 0.04 * Math.sin(t * 2.1) + shrug * 0.12;
    ch.neck.rotation.x -= laugh * 0.1;
    if (laugh) ch.chest.rotation.x -= laugh * (0.04 + 0.04 * Math.abs(Math.sin(t * 15)));
    if (bow || sway || headX || headY || headZ) {
      ch.chest.rotation.x += bow * 0.55; ch.chest.rotation.z += sway * 0.5;
      ch.neck.rotation.x += bow * 0.2;
      ch.head.rotation.x += headX; ch.head.rotation.y += headY; ch.head.rotation.z += headZ - sway * 0.3;
    }
    // (the chest's rest height is fixed: the bob is always from it)
    this.chestY ??= ch.chest.position.y;
    ch.chest.position.y = this.chestY - bob;
    if (cry) { ch.head.rotation.x += cry * 0.35; ch.neck.rotation.x += cry * 0.15; ch.chest.rotation.x += cry * 0.08 + sobbing * 0.05; }
    ch.root.updateMatrixWorld(true);

    // ---- arms ----
    const armsFree = !ch.armHook;
    const beat = talk * (seated ? 0.6 : 1);
    const sh = _a, lt = _b, pole = _c, end = _e;
    const fwd = V(0, 0, 1).applyQuaternion(ch.chest.getWorldQuaternion(_q));
    const cw = ch.chest.getWorldPosition(V());
    const rest = V();
    ch.arms.forEach((a, i) => {
      const k = armsFree ? K[i] * (seated ? 0.75 : 1) : 0;
      this.w[i] = lerp(this.w[i], k, damp(k > this.w[i] ? 5 : 3.5, dt));
      this.tgt[i].lerp(W[i], damp(7, dt));
      const w = this.w[i];
      if (w < 0.002 || !a.handPos) return;
      lt.copy(this.tgt[i]);
      lt.y += beat * 0.035 * Math.sin(t * 7 + i * 1.7);
      lt.z += beat * 0.02 * Math.sin(t * 4.3 + i * 2.2);
      ch.chest.localToWorld(lt);
      const target = lt.lerpVectors(a.handPos, lt, w);
      ch.chest.localToWorld(sh.set(a.side * 0.185, 0.2, -0.015));
      // elbows: the gesture's own direction, easing from the relaxed one
      pole.copy(this.pole[i]).lerp(rest.set(a.side * 0.35, -0.25, -1), 1 - w);
      ch.chest.localToWorld(pole).sub(cw).normalize();
      solveTwoBone(sh, target, ch.D.UPPER_ARM, ch.D.FOREARM, pole, a.elbow, end);
      orient(a.upper, sh, a.elbow, fwd, true);
      // the palm the way the gesture wants it: roll the forearm so the hand (palm normal
      // -side x its X) faces there, the wrist straightening into it
      _h.copy(fwd);
      if (palm[i]) {
        const P = _pw.copy(palm[i]).transformDirection(ch.chest.matrixWorld).multiplyScalar(-a.side);
        const Y = _y.subVectors(a.elbow, end).normalize();
        _pr.crossVectors(P, Y);
        if (_pr.lengthSq() > 1e-4) _h.lerp(_pr.normalize(), w).normalize();
        a.hand.rotation.x *= 1 - w; a.hand.rotation.z *= 1 - w;
      }
      orient(a.fore, a.elbow, end, _h, true);
      const c = curl[i] != null ? lerp(0.25, curl[i], w) : lerp(0.25, 0.08, K[i] > 0.5 ? w : 0);
      a.fingers.forEach(([f1, f2], j) => { const k = index[i] && j === 0 ? c * (1 - w) : c; f1.rotation.z = -(k + j * 0.06); f2.rotation.z = -(k * 1.15 + j * 0.05); });
      if (thumb[i]) a.thumb[1].rotation.z = 0.4 * w;
      else if (curl[i] != null) a.thumb[1].rotation.z = -c * 0.6;
    });
  }
}
