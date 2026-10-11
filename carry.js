import * as THREE from 'three';
import { poseArm } from './gun.js';

/*
  Carrying litter and debris: E picks the nearest loose piece up (a quick crouch and reach if
  it's on the ground), click throws it where the crosshair is, E again sets it down. Small
  things ride in the right hand and go overarm; big ones (boxes, bin bags, chairs) are held in
  both hands and heaved from the chest.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Q = () => new THREE.Quaternion();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const UP = V(0, 1, 0);
const _s = V(), _yq = Q();

// body frame keys [right, up, forward] from the shoulder line (as melee.js)
const L = ([r, u, f]) => V(-r, u, f);
const HOLD = L([0.2, -0.3, 0.3]), HOLD2 = [L([0.17, -0.2, 0.3]), L([-0.17, -0.2, 0.3])];
const THROW = [
  { p: L([0.26, 0.16, -0.2]), dur: 0.16 },   // wind up behind the shoulder
  { p: L([0.16, 0.1, 0.48]), dur: 0.08, release: true },
  { p: HOLD, dur: 0.25 },
];
const HEAVE = [
  { p: L([0, 0.22, 0.08]), dur: 0.2 },       // up to the chest / over the head
  { p: L([0, 0.12, 0.5]), dur: 0.1, release: true },
  { p: L([0, -0.2, 0.3]), dur: 0.25 },
];

/**
 * How a small piece sits in a fist (hand frame: fingers down -Y, thumb side +Z, palm on
 * local -X - the bone's scale mirrors it per side): its longest side runs across the grip, through the fist (a bottle stands upright
 * with the thumb up), the middle one down along the fingers, the thinnest against the palm.
 * Returns the piece's pose in the hand frame.
 */
const _bx = new THREE.Box3(), _bc = V(), _bs = V();
function fitInHand(m, side) {
  // its own bounds, unrotated
  const pp = m.position.clone(), pq = m.quaternion.clone(), par = m.parent;
  if (par) par.remove(m);
  m.position.set(0, 0, 0); m.quaternion.identity();
  m.updateMatrixWorld(true);
  _bx.setFromObject(m);
  m.position.copy(pp); m.quaternion.copy(pq);
  if (par) par.add(m);
  m.updateMatrixWorld(true);
  if (_bx.isEmpty()) { _bc.set(0, 0, 0); _bs.set(0.06, 0.06, 0.06); } else { _bx.getCenter(_bc); _bx.getSize(_bs); }
  const ax = [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)];
  const size = [_bs.x, _bs.y, _bs.z];
  // (an upright-ish thing keeps its own up as the long side: the ties favour Y)
  const ord = [0, 1, 2].sort((a, b) => (size[b] + (b === 1 ? 0.004 : 0)) - (size[a] + (a === 1 ? 0.004 : 0)));
  const [lo, mid, sh] = ord;
  // columns: which item axis lands on hand X, Y, Z
  const X = ax[sh].clone(), Y = ax[mid].clone(), Z = ax[lo].clone();
  // a proper rotation (no mirror)
  if (V().crossVectors(X, Y).dot(Z) < 0) X.negate();
  const R = new THREE.Matrix4().makeBasis(X, Y, Z).invert(); // item -> hand
  const q = new THREE.Quaternion().setFromRotationMatrix(R);
  const thick = size[sh] * 0.5, along = size[mid] * 0.5;
  // centre just off the palm, in the curl of the fingers
  // (the hand bone is mirrored per side, so its local -X is the palm on both hands)
  const c = V(-clamp(thick + 0.012, 0.02, 0.06), -clamp(0.06 + along * 0.25, 0.065, 0.09), 0.005);
  // the piece's own origin, given where its centre goes
  const off = c.sub(_bc.clone().applyQuaternion(q));
  return { q, off };
}

function bodyFrame(h, o, q) {
  h.hips.getWorldPosition(o);
  o.y += 0.5;
  q.setFromAxisAngle(UP, h.yaw);
}
function curl(a, c) {
  a.fingers.forEach(([f1, f2], j) => { f1.rotation.z = -(c + j * 0.05); f2.rotation.z = -(c * 1.1 + j * 0.04); });
  a.thumb[1].rotation.z = -c * 0.5;
}

export class Carry {
  /** ctx: { debris, litter, sfx, aimPoint } */
  constructor(actor, ctx) {
    this.actor = actor;
    this.ctx = ctx;
    this.it = null;       // the piece (released from the physics while held)
    this.phase = null;    // 'reach' | 'hold' | 'throw'
    this.t = 0;
    this.hook = (h, dt) => this.pose(h, dt);
    this.vel = V();
    this.last = V();
  }
  get item() { return this.it; }
  get busy() { return this.phase === 'reach' || this.phase === 'throw'; }
  get big() { return !!this.it?.pick?.big; }

  /** Reach for piece `it` (a debris item with .pick). */
  pick(it) {
    const A = this.actor, h = A.hero;
    if (this.it || A.mode !== 'anim' || h.action) return false;
    this.it = it;
    this.phase = 'reach';
    this.t = 0;
    const t = it.body.translation();
    this.from = V(t.x, t.y, t.z);
    // low down: bend for it
    if (this.from.y - h.pos.y < 0.7) h.crouchHold = 0.45;
    this.prevHook = h.armHook;
    h.armHook = this.hook;
    return true;
  }

  /** E: set it down in front of you. */
  drop(vel = null) {
    if (!this.it) return;
    if (this.phase === 'reach') { this.end(); return; }
    const m = this.it.mesh;
    const v = vel || this.actor.hero.vel.clone().add(V(0, 0.4, 0));
    const old = this.it;
    this.it = this.ctx.debris.readd(old, m.position, m.quaternion, v, V());
    this.onSet?.(this.it, old, v, V());
    this.ctx.sfx?.('pickup', 0.4);
    this.end();
  }

  end() {
    this.fit = null;
    this.grabQ = null;
    const h = this.actor.hero;
    if (h.armHook === this.hook) h.armHook = this.prevHook || null;
    this.it = null;
    this.phase = null;
  }

  /** Click: throw it at the crosshair. */
  throw() {
    if (this.phase !== 'hold') return;
    this.phase = 'throw';
    this.t = 0;
    this.keys = this.big ? HEAVE : THROW;
    this.from = this.cur.clone();
    this.released = false;
    this.ctx.sfx?.('whoosh', 0.4);
  }

  launch() {
    const it = this.it, m = it.mesh, A = this.actor;
    const mass = it.pick.mass;
    const speed = clamp(17 - mass * 2.2, this.big ? 5 : 8, 17);
    const aim = this.ctx.aimPoint ? this.ctx.aimPoint.clone() : m.position.clone().addScaledVector(A.hero.forward(V()), 10);
    const d = aim.sub(m.position);
    const dist = Math.min(d.length(), 30);
    d.normalize();
    // keep the throw in front of us even if the crosshair is behind (camera over the shoulder)
    const f = A.hero.forward(V());
    if (d.dot(f) < 0.2) d.addScaledVector(f, 0.2 - d.dot(f)).normalize();
    const vel = d.multiplyScalar(speed);
    // lob it a little so it arrives near the crosshair
    vel.y += 0.5 * 9.81 * (dist / speed);
    vel.add(A.hero.vel);
    const spin = this.big ? V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5) : V(-f.z * 12, Math.random() * 4, f.x * 12);
    const n = this.ctx.debris.readd(it, m.position, m.quaternion, vel, spin);
    this.ctx.litter?.thrown(n, A);
    this.onLaunch?.(it.pick.type, m.position, vel, spin);
    this.onSet?.(n, it, vel, spin);
    this.it = null;
  }

  update() {
    const A = this.actor;
    if (!this.it && !this.phase) return;
    // knocked over / in a car / climbing: it's dropped
    if (A.mode !== 'anim' || A.seat || A.hero.action || A.brain?.dead) {
      if (this.it && this.phase !== 'reach') this.drop(this.vel.clone().clampLength(0, 4));
      else this.end();
      return;
    }
    if (A.hero.armHook !== this.hook && this.phase) {
      // something else took the arms (a gun raised): let go
      if (this.it && this.phase !== 'reach') this.drop(); else { this.it = null; this.phase = null; }
    }
  }

  pose(h, dt) {
    const it = this.it;
    if (!this.phase) return;
    this.t += dt;
    const O = V(), yq = _yq;
    bodyFrame(h, O, yq);
    const iq = yq.clone().invert();
    const aR = h.arms[1], aL = h.arms[0];
    const locoR = V(), locoRq = Q(), locoL = V(), locoLq = Q();
    aR.hand.updateWorldMatrix(true, false); aR.hand.matrixWorld.decompose(locoR, locoRq, _s);
    aL.hand.updateWorldMatrix(true, false); aL.hand.matrixWorld.decompose(locoL, locoLq, _s);
    const toLocal = (w) => w.clone().sub(O).applyQuaternion(iq);
    const big = this.big;
    let p; // right hand target (body frame)
    let w = 1;
    if (this.phase === 'reach') {
      // down to it, then back up to the hold
      const T = 0.38, G = 0.2;
      if (this.t < T) {
        const k = smooth(this.t / T);
        p = toLocal(locoR).lerp(toLocal(this.from).add(V(big ? 0.12 : 0, big ? 0.05 : 0.08, -0.02)), k);
      } else {
        if (!this.grabbed) {
          this.grabbed = true;
          this.ctx.debris.release(it);
          this.ctx.sfx?.('pickup', 0.5);
          this.fromL = toLocal(it.mesh.position);
          // settle it into the grip from however it was lying
          if (!big) this.fit = fitInHand(it.mesh, aR.side);
          this.grabQ = it.mesh.quaternion.clone();
          this.grabP = it.mesh.position.clone();
          this.grabT = this.t;
        }
        const k = smooth((this.t - T) / G);
        p = this.fromL.clone().lerp(big ? HOLD2[0] : HOLD, k);
        if (this.t > T + G) { this.phase = 'hold'; this.grabbed = false; }
      }
    } else if (this.phase === 'hold') {
      p = (big ? HOLD2[0] : HOLD).clone();
      // a gentle bob with the walk
      p.y += Math.sin(h.phase * Math.PI * 4) * 0.01 * clamp(Math.hypot(h.vel.x, h.vel.z), 0, 1);
    } else {
      let t = this.t, i = 0, a = this.from;
      while (i < this.keys.length - 1 && t > this.keys[i].dur) { t -= this.keys[i].dur; a = this.keys[i].p; if (this.keys[i].release && !this.released) { this.released = true; this.launch(); } i++; }
      const K = this.keys[i];
      const k = i === 1 ? 1 - (1 - clamp(t / K.dur, 0, 1)) ** 2 : smooth(t / K.dur);
      p = a.clone().lerp(K.p, k);
      h.twist = (i === 0 ? -0.5 * k : i === 1 ? lerp(-0.5, 0.4, k) : 0.4 * (1 - k)) * (big ? 0.3 : 1);
      if (i === this.keys.length - 1 && t >= K.dur) { h.twist = 0; this.end(); return; }
      if (!this.it) w = 1 - k; // empty-handed on the way back
    }
    this.cur = p.clone();
    const fwd = h.forward(V());
    const right = V(-fwd.z, 0, fwd.x).negate();
    const wpR = p.clone().applyQuaternion(yq).add(O);
    if (w < 1) wpR.lerp(locoR, 1 - w);
    const pole = V().copy(right).multiplyScalar(0.9).addScaledVector(UP, -0.6).addScaledVector(fwd, -0.3).normalize();
    // palm turned in / under what it holds
    const hq = yq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.2, 0, big ? -1.4 : -0.3)));
    if (this.phase === 'reach' && this.t < 0.38) hq.slerp(locoRq, 1 - smooth(this.t / 0.38));
    poseArm(h, aR, wpR, hq, pole);
    curl(aR, it ? (big ? 0.6 : 1.05) : 0.4);
    if (big && (this.phase !== 'reach' || this.t > 0.2)) {
      // the other hand, across the load
      const wpL = p.clone().add(V(0.34, 0, 0)).applyQuaternion(yq).add(O);
      if (w < 1) wpL.lerp(locoL, 1 - w);
      const poleL = V().copy(right).multiplyScalar(-0.9).addScaledVector(UP, -0.6).addScaledVector(fwd, -0.3).normalize();
      const hqL = yq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.2, 0, 1.4)));
      poseArm(h, aL, wpL, hqL, poleL);
      curl(aL, 0.6);
    }
    // the piece rides in the hand(s)
    if (it && (this.phase !== 'reach' || this.grabbed || this.t >= 0.38)) {
      const m = it.mesh;
      aR.hand.updateWorldMatrix(true, false);
      if (big) {
        const c = p.clone().add(V(0.17, 0.02, 0.1)).applyQuaternion(yq).add(O);
        m.position.copy(c);
        m.quaternion.slerp(yq, Math.min(1, dt * 12));
      } else {
        if (!this.fit) this.fit = fitInHand(m, aR.side);
        const hp = V(), hq = Q();
        aR.hand.matrixWorld.decompose(hp, hq, _s);
        const tq = hq.multiply(this.fit.q);
        const tp = this.fit.off.clone().applyMatrix4(aR.hand.matrixWorld);
        // (just grabbed: it turns into the grip rather than snapping)
        const g = this.grabQ ? smooth((this.t - this.grabT) / 0.14) : 1;
        if (g < 1 && this.phase === 'reach') { m.position.lerpVectors(this.grabP, tp, g); m.quaternion.slerpQuaternions(this.grabQ, tq, g); }
        else { m.position.copy(tp); m.quaternion.copy(tq); this.grabQ = null; }
      }
      this.vel.copy(m.position).sub(this.last).divideScalar(Math.max(dt, 1e-3)).clampLength(0, 20);
      this.last.copy(m.position);
    }
  }
}
