import * as THREE from 'three';
import { inkOf } from './inks.js';

/*
  A vampire (look.vampire: Rick's Dracula, special.js). Most of it lives where the body does:
  a grip that can't be broken and pulls far harder (grabbing.js), faster on his feet
  (character.js), hits that land harder and a body that barely staggers, takes little harm and
  none to its organs (actor.js, organs.js).

  This is the bite. Holding someone (double-tap E), a click sinks the fangs in: the head goes
  down to their neck, and what's held is hauled up to meet it. A torn bite first (the wound
  bleeds on its own), then the drinking - sips drained straight out of their blood, dripping,
  running down his chin. Drained, they go pale (organs.js pallor), fall, fit for want of
  oxygen, faint, and die. Click again to let the bite go; E lets go of them.

  Someone else's body: the bite and every sip go to its owner as hits (Actor.struck, kind
  'bite', mp.js), who loses the blood for real.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;

const DRAIN = 0.034;  // fraction of their blood a second
const SIP = 0.3;      // s between sips
const REACH = 0.13;   // m, mouth to neck, to bite
const _m = V(), _n = V(), _d = V(), _f = V();

export const isVampire = (A) => !!A?.hero?.look?.vampire;

export class Bite {
  /** ctx: { grabber, blood, sfx } */
  constructor(me, ctx) {
    this.me = me;
    this.ctx = ctx;
    this.A = null;
    this.k = 0;           // 0..1: head down into it
    this.pull = V();
    this.side = 1;
    ctx.grabber.headPose = (h, dt) => this.pose(h, dt);
  }
  get active() { return !!this.A; }

  /** Click while holding someone: bite (true), or let the bite go. */
  toggle() {
    if (this.A) { this.stop(); return true; }
    const g = this.ctx.grabber, A = g.target;
    if (!isVampire(this.me) || !g.active || !A?.hero || !A.groups?.head || A.rd?.parts?.head?.gone) return false;
    this.A = A;
    this.t = 0; this.bitten = false; this.sipT = 0; this.gulpT = rnd(0.8, 1.4);
    this.side = Math.random() < 0.5 ? -1 : 1;
    this.pull.set(0, 0, 0);
    g.pull = this.pull;
    return true;
  }
  stop() {
    this.A = null;
    this.ctx.grabber.pull = null;
  }

  /** Mouth (world) and where on their neck it goes. */
  points(mouth, neck) {
    const h = this.me.hero, A = this.A;
    h.head.updateWorldMatrix(true, false);
    h.head.localToWorld(mouth.set(0, -0.045, 0.1));
    const G = A.groups.head;
    G.updateWorldMatrix(true, false);
    G.getWorldPosition(neck);
    // the side of the throat, under the jaw, facing us
    _f.subVectors(mouth, neck).setY(0);
    if (_f.lengthSq() < 1e-6) _f.set(0, 0, 1);
    _f.normalize();
    const right = _d.set(-_f.z, 0, _f.x);
    neck.addScaledVector(_f, 0.045).addScaledVector(right, this.side * 0.035);
    neck.y -= 0.085;
    return neck;
  }

  update(dt) {
    const A = this.A;
    if (!A) { this.k = Math.max(0, this.k - dt * 3); return; }
    const g = this.ctx.grabber;
    if (!g.active || g.target !== A || !A.groups?.head || A.rd?.parts?.head?.gone || !isVampire(this.me)) { this.stop(); return; }
    this.t += dt;
    this.k = Math.min(1, this.k + dt * 2.5);
    const neck = this.points(_m, _n), mouth = _m;
    _d.subVectors(mouth, neck);
    const dist = _d.length();
    // haul them up to the teeth (on top of where the hands hold them)
    this.pull.addScaledVector(_d, dt * 6).clampLength(0, 0.8);
    // (held at arm's length: close enough - the head goes down to them)
    if (dist > 1.2) return;
    const into = _d.clone().negate().normalize();
    if (!this.bitten) {
      if (dist < REACH || this.t > 0.8) {
        this.bitten = true;
        A.struck('head', neck.clone(), into.clone().multiplyScalar(2), into.clone(), { kind: 'bite', vamp: 1, mass: 1, sev: 1.1, ref: 2, maxImp: 4 }, this.me);
        this.ctx.sfx?.('flesh', 0.9, { rate: rnd(0.75, 0.9) });
        this.ctx.sfx?.('splat', 0.5);
        this.stain(mouth, into, 1.4);
      }
      return;
    }
    if (dist > 0.6 || A.brain?.dead) return;
    // drinking
    if ((this.sipT -= dt) <= 0) {
      this.sipT = SIP;
      A.struck('head', neck.clone(), V(), into.clone(), { kind: 'bite', vamp: 1, sip: 1, drain: DRAIN * SIP, sev: 0, mass: 0 }, this.me);
      this.stain(mouth, into, 1);
      const B = this.ctx.blood;
      // what spills: down the neck, off the chin, to the floor
      if (Math.random() < 0.7) B.inked(A).drip(neck.clone().addScaledVector(into, -0.02), V(rnd(-0.1, 0.1), -0.4, rnd(-0.1, 0.1)), rnd(0.005, 0.008));
      if (Math.random() < 0.5) B.inked(A).drip(mouth.clone().add(V(0, -0.03, 0)), V(rnd(-0.1, 0.1), -0.3, rnd(-0.1, 0.1)), rnd(0.004, 0.007));
      if (Math.random() < 0.15) B.inked(A).spray(neck.clone(), V(0, -1, 0).addScaledVector(into, -0.6).normalize(), rnd(0.4, 0.9), 4, 0.5, 0.8);
      if (Math.random() < 0.35) A.wounds?.stamp('head', neck, into, V(0, -1, 0), 'splash', 0.05, 0.08, 0.8);
      if (Math.random() < 0.2) A.wounds?.stamp('chest', neck.clone().add(V(0, -0.15, 0)), into, V(0, -1, 0), 'splash', 0.06, 0.1, 0.7);
    }
    if ((this.gulpT -= dt) <= 0) { this.gulpT = rnd(0.9, 1.6); this.ctx.sfx?.('gulp', 0.6, { vary: 0.1 }); }
  }

  /** Their blood on his mouth and chin (and down his front). */
  stain(mouth, into, amt) {
    const W = this.me.wounds, ink = inkOf(this.A);
    if (!W) return;
    const at = mouth.clone().addScaledVector(into, 0.012).add(V(rnd(-0.02, 0.02), rnd(-0.02, 0.005), 0));
    W.splashForeign('head', at, into.clone().negate(), V(0, -1, 0), ink, 0.025 * amt, 0.9);
    if (Math.random() < 0.25 * amt) {
      const h = this.me.hero;
      W.splashForeign('chest', h.chest.localToWorld(V(rnd(-0.05, 0.05), 0.2, 0.14)), h.forward(V()).negate(), V(0, -1, 0), ink, 0.04, 0.6);
    }
  }

  /** Grabber's head pose: down and into their neck. */
  pose(h, dt) {
    if (this.k <= 0.001) return;
    const k = this.k * this.k * (3 - 2 * this.k);
    if (this.A) {
      const neck = this.points(_m, _n);
      h.chest.updateWorldMatrix(true, false);
      const from = h.neck.getWorldPosition(_f);
      const d = _d.subVectors(neck, from);
      const flat = Math.hypot(d.x, d.z);
      const fwd = h.forward(V());
      const yaw = Math.atan2(fwd.x * d.z - fwd.z * d.x, fwd.x * d.x + fwd.z * d.z);
      this.pitch = lerp(this.pitch || 0, clamp(Math.atan2(-d.y, Math.max(flat, 0.05)), -0.3, 1.1), Math.min(1, dt * 8));
      this.yaw = lerp(this.yaw || 0, clamp(-yaw, -0.8, 0.8), Math.min(1, dt * 8));
    }
    const p = (this.pitch || 0) * k, y = (this.yaw || 0) * k;
    h.neck.rotation.x += p * 0.5;
    h.neck.rotation.y += y * 0.5;
    h.head.rotation.x += p * 0.45;
    h.head.rotation.y += y * 0.5;
    // the head cocked, to get the teeth in under the jaw
    h.head.rotation.z += this.side * 0.35 * k;
  }
}
