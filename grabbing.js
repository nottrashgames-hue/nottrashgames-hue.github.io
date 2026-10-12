import * as THREE from 'three';
import { poseArm } from './gun.js';
import { bodyFrame, curl, handFree } from './melee.js';
import { partNear, capsuleOf } from './strike.js';

/*
  Taking hold of people (and pieces of them) with your bare hands - Z.

  What gets grabbed is picked like a person would: someone on their feet by the collar with
  both hands (or by the arm, or wherever you're looking); someone lying there by a wrist or an
  ankle - both, if the pair are together - to drag them; a cut-off piece is just picked up.
  The hands go to the actual spot on the body and stay on it (procedural IK every frame). The
  body is pulled toward where the hands want to hold it by a force-limited spring on the part
  that's held, the rest of the pull passed up that limb toward the hips (the joints would carry
  it anyway - spreading it keeps the ragdoll from tearing itself apart). Someone standing gets
  yanked off balance and stumbles along; let go (Z) and they're left where they are, or throw
  them with Q. Holding Z tears through the torso.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Q = () => new THREE.Quaternion();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const UP = V(0, 1, 0);
/** A vampire's hands (look.vampire, vampire.js): a grip that can't be broken, and far stronger. */
const vamp = (A) => !!A?.hero?.look?.vampire;
const V_STR = 3.2;

const REACH = 1.8;      // m, flat from our feet, to what we can take hold of
const REACH_IN = 0.22;  // s for a hand to get there
const LET_GO = 1.75;    // m from the shoulder: stretched further than this (for a moment), the grip is lost
const F_HAND = 1150;    // N one hand can pull with (enough, two-handed, to haul a grown man clean off the floor)
const F_CHUNK = 320;    // N on a loose piece
const RIP_TIME = 1.15;  // s of straining before the torso tears

// where the hands want to hold it, in the body frame (x = left, y up, z forward) from the shoulders
const HOLD = {
  collar: (s) => V(s * 0.12, -0.14, 0.34),   // someone on their feet, by the front of the shirt
  arm: (s) => V(s * 0.24, -0.3, 0.42),       // by an arm (or the head), at arm's length
  drag: (s) => V(s * 0.2, -0.8, 0.5),        // someone lying: wrists / ankles at knee height
  carry: (s) => V(s * 0.15, -0.42, 0.4),     // a loose piece, held up in front
};
// which part of a person a hand goes for first (lower: sooner), lying down / on their feet
const PREF_LYING = { foreL: 0, foreR: 0, shinL: 0.05, shinR: 0.05, footL: 0.15, footR: 0.15, head: 0.25, upperL: 0.3, upperR: 0.3, chest: 0.3, thighL: 0.35, thighR: 0.35, pelvis: 0.4, spine: 0.45 };
const PREF_UP = { chest: 0, spine: 0.25, upperL: 0.2, upperR: 0.2, foreL: 0.25, foreR: 0.25, head: 0.3, pelvis: 0.45 };
// how far along a limb (0 at the joint, 1 at the far end) the hand closes round it
const ALONG = { fore: 0.82, shin: 0.86, upper: 0.62, thigh: 0.55, foot: 0.45 };
const LIMB = /^(fore|upper|shin|thigh|foot)([LR])$/;
const TORSO = { chest: 1, spine: 1, pelvis: 1 };

const _at = V(), _q = Q(), _v = V(), _w = V(), _e = V(), _f = V(), _m = new THREE.Matrix4(), _s = V();
const _O = V(), _yq = Q(), _iq = Q();

/** A part's frame in the world: the physics body when it's ragdolled here, else the animated bone. */
function partPose(A, name, at, q) {
  if (A.mode === 'ragdoll' && !A.remote) { A.rd.pos(name, at); A.rd.quat(name, q); }
  else {
    const g = A.groups[name];
    g.updateWorldMatrix(true, false);
    g.getWorldPosition(at); g.getWorldQuaternion(q);
  }
}
const tv = (t, out) => out.set(t.x, t.y, t.z);
/** Is A up on their feet (vs lying / sprawled / dead)? */
function upright(A) {
  if (A.brain?.dead) return false;
  if (A.mode === 'ragdoll' && !A.remote) return A.onFeet();
  const g = A.groups.pelvis;
  g.updateWorldMatrix(true, false);
  return g.getWorldPosition(_v).y - A.hero.pos.y > 0.6;
}

export class Grabber {
  /** ctx: { actors, chunks: () => [], sfx, aimPoint, tug(actor, grips, done) for someone else's body } */
  constructor(actor, ctx) {
    this.actor = actor;
    this.ctx = ctx;
    this.grips = [];
    this.load = 0;          // N pulled with, smoothed (it slows you down)
    this.bend = 0; this.dip = 0;
    this.hook = (h, dt) => this.pose(h, dt);
    this.pull = null;       // (vampire.js: a bite) where what's held is hauled on top of the hold, world
    this.headPose = null;   // (vampire.js) posing our head too, after the hands
    this.rip = null;
    this.ripped = false;
    this.throwing = null;
  }
  get active() { return this.grips.length > 0; }
  /** Who / what is held (the first hand's). */
  get target() { const g = this.grips[0]; return g ? g.A || g.chunk : null; }
  handAvailable(i) {
    const A = this.actor;
    if (!handFree(A, i) || A.gunHeld || this.ctx.carrying?.()) return false;
    if (A.meleeHeld?.def.two !== undefined) return false;
    if (i === 1 && A.meleeHeld) return false;
    if (i === 0 && A.meleeHeldL) return false;
    return true;
  }

  // ---------------------------------------------------------------------------------------
  // What's in reach
  // ---------------------------------------------------------------------------------------
  /** The best thing to take hold of right now: { A, name, up } (a person's part) or { chunk }, or null. */
  find(peopleOnly = false, chunksOnly = false, torsoOnly = false) {
    const me = this.actor, h = me.hero;
    if (this.throwing || me.mode !== 'anim' || h.action || me.seat) return null;
    if (!this.handAvailable(0) && !this.handAvailable(1)) return null;
    bodyFrame(h, _O, _yq);
    const feet = h.pos, fwd = h.forward(V());
    const ap = this.ctx.aimPoint, useAim = ap && ap.distanceTo(_O) < 2.6;
    let best = null, bs = Infinity;
    const consider = (p, pref, make) => {
      const dx = p.x - feet.x, dz = p.z - feet.z, flat = Math.hypot(dx, dz), dy = p.y - feet.y;
      if (flat > REACH || dy > 1.9 || dy < -0.35) return;
      const cos = flat > 1e-3 ? (dx * fwd.x + dz * fwd.z) / flat : 1;
      if (flat > 0.35 && cos < 0.15) return; // (behind us)
      const score = pref + flat * 0.6 + (1 - cos) * 0.35 + (useAim ? Math.min(ap.distanceTo(p), 1) * 1.3 : 0);
      if (score < bs) { bs = score; best = make(); }
    };
    for (const A of this.ctx.actors) {
      if (chunksOnly) break;
      if (A === me || A.seat || !A.rd || !A.groups || A.hero.shown === false) continue;
      if (A.remote && !this.ctx.tug) continue;
      partPose(A, 'pelvis', _at, _q);
      if (Math.hypot(_at.x - feet.x, _at.z - feet.z) > 2.4) continue;
      const up = upright(A), PREF = up ? PREF_UP : PREF_LYING;
      for (const name of A.rd.names) {
        if (torsoOnly && !TORSO[name]) continue;
        if (A.rd.parts[name].gone || PREF[name] === undefined) continue;
        const n = partNear(A, name, _O);
        if (n) consider(n.point, PREF[name], () => ({ A, name, up }));
      }
    }
    for (const c of peopleOnly ? [] : this.ctx.chunks?.() || []) {
      if (!c.body || c.held) continue;
      consider(tv(c.body.translation(), _w), 0.1, () => ({ chunk: c }));
    }
    return best;
  }

  // ---------------------------------------------------------------------------------------
  // Taking hold / letting go
  // ---------------------------------------------------------------------------------------
  /** Take hold of what find() picked. False if no hand could. */
  start(plan) {
    if (!plan || this.throwing) return false;
    const me = this.actor, h = me.hero;
    this.release();
    bodyFrame(h, _O, _yq);
    const free = [0, 1].filter((i) => this.handAvailable(i));
    if (!free.length) return false;
    const right = V(-h.forward(_v).z, 0, _v.x); // (our actual right)
    // the hand on the side it's on
    const sideOf = (p) => (free.length < 2 ? free[0] : p.clone().sub(_O).dot(right) > 0 ? 1 : 0);
    const grips = [];
    if (plan.chunk) {
      const c = plan.chunk, t = tv(c.body.translation(), V());
      const big = c.what === 'body' || c.what === 'leg';
      const hands = big && free.length > 1 ? [1, 0] : [sideOf(t)];
      for (const i of hands) {
        const side = h.arms[i].side;
        // (two hands on a big piece: either side of its middle)
        const W = t.clone().addScaledVector(_O.clone().sub(t).setY(0).normalize(), 0.04);
        if (hands.length > 1) W.addScaledVector(right, -side * 0.11);
        grips.push(this.chunkGrip(i, c, W, 'carry'));
      }
    } else {
      const { A, name, up } = plan;
      const limb = LIMB.exec(name);
      if (TORSO[name] && free.length > 1) {
        // both hands, one either side of the chest (their front, if they're facing us)
        for (const i of [1, 0]) {
          const side = h.arms[i].side;
          const from = V(side * 0.14, -0.1, 0.25).applyQuaternion(_yq).add(_O);
          grips.push(this.partGrip(i, A, name, from, up ? 'collar' : 'drag'));
        }
      } else {
        partPose(A, name, _at, _q);
        const i = sideOf(_at);
        const mode = up ? 'arm' : 'drag';
        grips.push(this.partGrip(i, A, name, _O, mode));
        // lying there with the other wrist / ankle beside this one: the other hand takes that
        if (!up && limb && free.length > 1) {
          const pair = limb[1] + (limb[2] === 'L' ? 'R' : 'L');
          if (A.rd.parts[pair] && !A.rd.parts[pair].gone) {
            const g2 = this.partGrip(1 - i, A, pair, _O, mode);
            if (g2.W.distanceTo(grips[0].W) < 0.55) grips.push(g2);
          }
        }
      }
    }
    if (!grips.length) return false;
    this.grips = grips;
    this.bend = h.bend || 0; this.dip = h.dip || 0;
    for (const g of grips) if (g.chunk) g.chunk.held = true;
    this.prevHook = h.armHook;
    h.armHook = this.hook;
    this.ctx.sfx?.('grab', 0.5);
    return true;
  }

  /** A hand's hold on part `name` of A, closing on it nearest `from` (world). */
  partGrip(i, A, name, from, mode) {
    const cap = capsuleOf(A, name);
    partPose(A, name, _at, _q);
    const W = V(), n = V();
    const limb = LIMB.exec(name);
    if (limb) {
      // round the limb, near its far end (the wrist, the ankle), on the side facing us
      const [near, far] = cap.a.y > cap.b.y ? [cap.a, cap.b] : [cap.b, cap.a];
      const X = near.clone().lerp(far, ALONG[limb[1]]).applyQuaternion(_q).add(_at);
      const ax = far.clone().sub(near).applyQuaternion(_q).normalize();
      const d = from.clone().sub(X);
      d.addScaledVector(ax, -d.dot(ax));
      if (d.lengthSq() < 1e-6) d.set(0, 1, 0).addScaledVector(ax, -ax.y);
      d.normalize();
      W.copy(X).addScaledVector(d, cap.r * 0.8);
      n.copy(d).negate();
    } else {
      const N = partNear(A, name, from);
      W.copy(N.point).addScaledVector(N.normal, 0.012);
      n.copy(N.normal);
    }
    _iq.copy(_q).invert();
    return {
      i, A, name, mode, t: 0, far: 0, W,
      local: W.clone().sub(_at).applyQuaternion(_iq),
      nLocal: n.applyQuaternion(_iq).normalize(),
      axLocal: limb ? V(0, 1, 0) : null,
      T: V(), vT: V(), str: vamp(this.actor) ? V_STR : 1,
    };
  }
  chunkGrip(i, c, W, mode) {
    const r = c.body.rotation(), t = c.body.translation();
    _iq.set(r.x, r.y, r.z, r.w).invert();
    const n = tv(t, V()).sub(W).normalize();
    return { i, chunk: c, mode, t: 0, far: 0, W: W.clone(), local: W.clone().sub(tv(t, _v)).applyQuaternion(_iq), nLocal: n.applyQuaternion(_iq), axLocal: null, T: V(), vT: V() };
  }

  /** Let go of A (and anything that came off them) - they've gone. */
  releaseActor(A) {
    if (this.grips.some((g) => g.A === A || g.chunk?.actor === A)) this.release();
  }

  /** Let go of everything. fling: thrown, toward where we're looking. */
  release(fling = false) {
    if (!this.grips.length) return;
    const h = this.actor.hero;
    if (fling) this.fling();
    const remote = new Set();
    for (const g of this.grips) {
      if (g.chunk) g.chunk.held = false;
      if (g.A?.remote) remote.add(g.A);
    }
    for (const A of remote) this.ctx.tug?.(A, [], true);
    this.grips = [];
    this.load = 0;
    this.rip = null;
    this.throwing = null;
    if (h.armHook === this.hook) h.armHook = this.prevHook || null;
    this.prevHook = null;
    h.bend = h.dip = h.twist = 0;
  }

  /** Begin the held-Z torso tear animation. */
  beginRip() {
    const A = this.target;
    if (!this.active || !A?.rd || !this.grips.some((g) => g.A === A)) return false;
    this.ripped = false;
    this.throwing = null;
    this.rip = { A, t: 0 };
    return true;
  }

  /** Stop charging a tear. Returns true if this press already finished the rip. */
  endRip() {
    const done = this.ripped;
    this.rip = null;
    return done;
  }

  /** Q: wind up, hurl the held person or body piece, then recover the arms. */
  throw() {
    const g = this.grips[0];
    if (!g || this.throwing) return false;
    g.t = Math.max(g.t, REACH_IN);
    this.rip = null;
    this.throwing = { t: 0, launched: false, hands: this.grips.map((q) => q.i) };
    return true;
  }

  finishRip() {
    const A = this.rip?.A;
    this.rip = null;
    if (!A || !A.groups?.spine || !this.ctx.sever) return false;
    const spine = A.groups.spine;
    spine.updateWorldMatrix(true, false);
    const point = spine.localToWorld(V(0, 0.1, 0));
    const vel = this.actor.hero.forward(V()).multiplyScalar(20).add(V(0, 4, 0));
    const ok = this.ctx.sever(A, 'spine', point, V(0, 1, 0), vel);
    if (ok) {
      this.ripped = true;
      this.prevHook = null;
      this.release();
    }
    return ok;
  }

  /** Thrown: whatever's held flies off toward the crosshair (a person goes whole). */
  fling() {
    const h = this.actor.hero, g0 = this.grips[0];
    if (!g0 || g0.t < REACH_IN) return;
    bodyFrame(h, _O, _yq);
    const W = this.anchor(g0, V());
    const ap = this.ctx.aimPoint;
    const dir = ap && ap.distanceTo(W) > 0.5 ? ap.clone().sub(W) : h.forward(V());
    dir.normalize();
    dir.y = Math.max(dir.y, 0) + 0.35;
    dir.normalize();
    if (g0.chunk) {
      const b = g0.chunk.body, v = dir.multiplyScalar(9);
      b.setLinvel({ x: v.x + h.vel.x, y: v.y, z: v.z + h.vel.z }, true);
      b.setAngvel({ x: (Math.random() - 0.5) * 12, y: (Math.random() - 0.5) * 12, z: (Math.random() - 0.5) * 12 }, true);
    } else if (g0.A && !g0.A.remote) {
      const A = g0.A;
      if (A.mode !== 'ragdoll') A.goRagdoll('collapse');
      // lighter held by the extremities (a swing, not a shove): the whole of them goes
      const k = TORSO[g0.name] ? 5.5 : 4.2;
      A.rd.phys(() => { for (const P of A.rd.list) if (!P.gone) P.body.applyImpulse(_v.copy(dir).multiplyScalar(P.mass * k), true); });
    } else if (g0.A?.remote) this.ctx.tug?.(g0.A, [], true, dir.clone().multiplyScalar(9));
    this.ctx.sfx?.('whoosh', 0.55, { rate: 0.8 });
    h.lunge = h.forward(V()).multiplyScalar(1.5);
  }

  // ---------------------------------------------------------------------------------------
  // Every frame
  // ---------------------------------------------------------------------------------------
  /** Where grip g's hand is on them now (world). */
  anchor(g, out) {
    if (g.chunk) {
      const r = g.chunk.body.rotation(), t = g.chunk.body.translation();
      return out.copy(g.local).applyQuaternion(_q.set(r.x, r.y, r.z, r.w)).add(_v.set(t.x, t.y, t.z));
    }
    partPose(g.A, g.name, _at, _q);
    return out.copy(g.local).applyQuaternion(_q).add(_at);
  }
  /** The way into them at the grip (world): the palm faces it. */
  inward(g, out) {
    if (g.chunk) { const r = g.chunk.body.rotation(); return out.copy(g.nLocal).applyQuaternion(_q.set(r.x, r.y, r.z, r.w)); }
    partPose(g.A, g.name, _at, _q);
    return out.copy(g.nLocal).applyQuaternion(_q);
  }

  /** Before physics: is everything still held, and where do the hands want it. */
  update(dt) {
    const me = this.actor, h = me.hero;
    if (this.throwing) {
      const T = this.throwing;
      T.t += dt;
      if (!T.launched && T.t >= 0.18) {
        this.fling();
        for (const g of this.grips) {
          if (g.chunk) g.chunk.held = false;
        }
        this.grips = [];
        this.load = 0;
        T.launched = true;
      }
      if (T.t >= 0.55) {
        this.throwing = null;
        if (h.armHook === this.hook) h.armHook = this.prevHook || null;
        this.prevHook = null;
        h.bend = h.dip = h.twist = 0;
      }
      return;
    }
    if (!this.grips.length) return;
    if (me.mode !== 'anim' || h.action || me.seat || h.armHook !== this.hook) { this.release(); return; }
    bodyFrame(h, _O, _yq);
    for (const g of [...this.grips]) {
      // cut off while held: the hand keeps the piece that came away
      if (g.A && (!this.ctx.actors.includes(g.A) || g.A.rd.parts[g.name]?.gone)) {
        const c = this.pieceOf(g);
        if (c) { Object.assign(g, this.chunkGrip(g.i, c, g.W, 'carry'), { A: null, name: null, t: Math.max(g.t, REACH_IN) }); c.held = true; }
        else { this.drop(g); continue; }
      }
      if (g.chunk && !this.ctx.chunks?.().includes(g.chunk)) { this.drop(g); continue; }
      if (!this.handAvailable(g.i)) { this.drop(g); continue; }
      const A = g.A;
      this.anchor(g, g.W);
      h.chest.localToWorld(_s.set(h.arms[g.i].side * 0.185, 0.2, -0.015));
      // (a vampire never lets go - short of something tearing them apart by metres)
      const lim = vamp(me) ? 4 : LET_GO;
      g.far = g.W.distanceTo(_s) > lim ? g.far + dt : 0;
      if (g.far > 0.3) { this.drop(g); continue; }
      g.T.copy(HOLD[g.mode](h.arms[g.i].side)).applyQuaternion(_yq).add(_O);
      if (this.pull) g.T.add(this.pull);
      g.ripOffset ||= V();
      g.ripOffset.set(0, 0, 0);
      if (this.rip?.A === A) {
        const amount = smooth(this.rip.t / RIP_TIME) * 0.34;
        g.ripOffset.set(1, 0, 0).applyQuaternion(_yq).multiplyScalar(h.arms[g.i].side * amount);
        g.T.add(g.ripOffset);
      }
      g.vT.copy(h.vel);
      // someone on their feet, hauled on: they're pulled off balance (and stagger along)
      if (A && !A.remote && A.mode === 'anim' && g.t > REACH_IN && g.T.distanceTo(g.W) > 0.16) {
        A.goRagdoll('stumble', { balance: 0.6, decay: 0.12 });
      }
    }
    if (!this.grips.length) return;
    if (this.rip) {
      this.rip.t += dt;
      if (this.rip.t >= RIP_TIME) { this.finishRip(); return; }
    }
    // someone else's body: its own client pulls it (mp.js)
    const remote = this.grips.filter((g) => g.A?.remote && g.t > REACH_IN);
    if (remote.length && this.ctx.tug) {
      this.tugT = (this.tugT || 0) - dt;
      if (this.tugT <= 0) { this.tugT = 1 / 30; this.ctx.tug(remote[0].A, remote); }
    }
    this.load *= Math.exp(-dt * 4);
  }
  /** The loose piece a held part went off with, when it's been cut off. */
  pieceOf(g) {
    let best = null, bd = 0.7;
    for (const c of this.ctx.chunks?.() || []) {
      if (c.actor !== g.A || c.gen !== (g.A.cutGen || 0) || c.held) continue;
      const d = tv(c.body.translation(), _v).distanceTo(g.W);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  drop(g) {
    if (g.chunk) g.chunk.held = false;
    this.grips = this.grips.filter((x) => x !== g);
    if (!this.grips.length) this.release();
  }

  /** Each physics substep: pull what's held toward where the hands want it. */
  preStep(H) {
    for (const g of this.grips) {
      if (g.t < REACH_IN * 0.7) continue;
      if (g.chunk) this.pullChunk(g, H);
      else if (g.A.mode === 'ragdoll' && !g.A.remote) this.pullPart(g, H);
    }
  }
  pullChunk(g, H) {
    const b = g.chunk.body;
    const r = b.rotation(), t = b.translation(), lv = b.linvel(), av = b.angvel();
    const W = _w.copy(g.local).applyQuaternion(_q.set(r.x, r.y, r.z, r.w)).add(_v.set(t.x, t.y, t.z));
    const rr = _e.subVectors(W, _v);
    const vel = _f.set(av.x, av.y, av.z).cross(rr).add(_v.set(lv.x, lv.y, lv.z));
    const M = b.mass() || 2;
    const wn = 13;
    const F = _e.subVectors(g.T, W).multiplyScalar(wn * wn).addScaledVector(_v.subVectors(g.vT, vel), 2 * wn).multiplyScalar(M);
    F.y += M * 9.81;
    F.clampLength(0, F_CHUNK);
    b.applyImpulseAtPoint(F.multiplyScalar(H), W, true);
    const k = Math.exp(-H * 5);
    b.setAngvel({ x: av.x * k, y: av.y * k, z: av.z * k }, true);
    this.load = Math.max(this.load, M * 30);
  }
  pullPart(g, H) {
    const share = this.grips.filter((x) => x.A === g.A).length;
    this.load = Math.max(this.load, pullPart(g, H, share) * share);
  }

  /** Arm hook: the hands on them, wherever they are. */
  pose(h, dt) {
    if (this.throwing) { this.poseThrow(h, dt); return; }
    if (!this.grips.length) return;
    this.prevHook?.(h, dt);
    bodyFrame(h, _O, _yq);
    const fwd = h.forward(V());
    let low = Infinity;
    for (const g of this.grips) {
      g.t += dt;
      const a = h.arms[g.i], side = a.side;
      const W = this.anchor(g, V()).add(g.ripOffset || V());
      low = Math.min(low, W.y - h.pos.y);
      // reaching in from where the hand was
      const k = smooth(g.t / REACH_IN);
      a.hand.updateWorldMatrix(true, false);
      const lp = V(), lq = Q();
      a.hand.matrixWorld.decompose(lp, lq, _s);
      // palm onto them, fingers wrapped round (down its length, never along a limb)
      const into = this.inward(g, V()).normalize();
      const fing = V(0, -1, 0).addScaledVector(into, into.y);
      if (g.axLocal) {
        const ax = g.axLocal.clone().applyQuaternion(_q).normalize();
        fing.addScaledVector(ax, -fing.dot(ax));
        if (fing.lengthSq() < 1e-4) fing.crossVectors(ax, into);
      }
      if (fing.lengthSq() < 1e-4) fing.copy(fwd);
      fing.normalize();
      const y = fing.clone().negate();
      const x = into.clone().multiplyScalar(-side);
      x.addScaledVector(y, -x.dot(y)).normalize();
      const z = V().crossVectors(x, y);
      const hq = Q().setFromRotationMatrix(_m.makeBasis(x, y, z));
      // (the palm on it, not the wrist: the hand's origin is back up from there)
      const at = W.clone().addScaledVector(into, -0.025).addScaledVector(fing, -0.06);
      lp.lerp(at, k); lq.slerp(hq, k);
      const outSide = V(fwd.z, 0, -fwd.x).multiplyScalar(side);
      const pole = outSide.multiplyScalar(0.8).addScaledVector(UP, -0.7).addScaledVector(fwd, -0.3).normalize();
      poseArm(h, a, lp, lq, pole);
      curl(a, lerp(0.3, 1.2, k));
    }
    // reaching down to someone lying there: bend at the waist, sink at the knees
    const wantB = clamp((0.9 - low) / 0.75, 0, 1) * 0.6, wantD = clamp((0.72 - low) / 0.6, 0, 1) * 0.5;
    const r = Math.min(1, dt * 6);
    this.bend = lerp(this.bend, wantB, r); this.dip = lerp(this.dip, wantD, r);
    h.bend = this.bend; h.dip = this.dip;
    h.twist = this.rip ? -0.12 * smooth(this.rip.t / RIP_TIME) : 0;
    this.headPose?.(h, dt);
  }

  /** Animated overarm heave, including the recovery after the target leaves the hands. */
  poseThrow(h, dt = 0) {
    this.prevHook?.(h, dt);
    bodyFrame(h, _O, _yq);
    const fwd = h.forward(V()), right = V(fwd.z, 0, -fwd.x);
    const T = this.throwing.t;
    const wind = smooth(T / 0.18);
    const strike = smooth((T - 0.18) / 0.12);
    const recover = smooth((T - 0.3) / 0.25);
    const natural = [];
    for (const a of h.arms) {
      a.hand.updateWorldMatrix(true, false);
      const p = V(), q = Q();
      a.hand.matrixWorld.decompose(p, q, _s);
      natural.push({ p, q });
    }
    for (let i = 0; i < 2; i++) {
      if (!this.throwing.hands.includes(i)) continue;
      const a = h.arms[i], side = a.side;
      const back = -0.34 + 0.62 * strike;
      const p = _O.clone()
        .addScaledVector(right, side * (0.32 - 0.12 * strike))
        .addScaledVector(UP, 0.45 + 0.45 * wind - 0.08 * strike)
        .addScaledVector(fwd, T < 0.18 ? lerp(0.3, -0.35, wind) : back);
      const weight = T < 0.3 ? 1 : 1 - recover;
      p.lerp(natural[i].p, 1 - weight);
      const q = _yq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.9 + 0.7 * strike, 0, side * 0.25)));
      q.slerp(natural[i].q, 1 - weight);
      const pole = V(right.x * side * 0.75 - fwd.x * 0.3, -0.65, right.z * side * 0.75 - fwd.z * 0.3).normalize();
      poseArm(h, a, p, q, pole);
      curl(a, T < 0.3 ? 1.15 : lerp(1.15, 0.3, recover));
    }
    h.twist = T < 0.18 ? -0.32 * wind : 0.42 * (1 - strike);
  }
}

/**
 * One hand's pull on part g.name of g.A (ragdolled here), toward g.T moving at g.vT, split
 * `share` ways with the other hands on the same person. Returns the force (N).
 */
export function pullPart(g, H, share = 1) {
  const A = g.A, rd = A.rd, P = rd.parts[g.name];
  if (!P || P.gone) return 0;
  const b = P.body;
  const W = rd.point(g.name, g.local, _w);
  const t = b.translation(), lv = b.linvel(), av = b.angvel();
  const vel = _f.set(av.x, av.y, av.z).cross(_e.set(W.x - t.x, W.y - t.y, W.z - t.z)).add(_v.set(lv.x, lv.y, lv.z));
  const M = (rd.mass || 70) * 0.7 / share;
  const str = g.str || 1;
  // (a stiff, well-damped hold: what's in your hands goes where they go, with no wobble)
  const wn = 10.5 * Math.sqrt(str);
  const F = _e.subVectors(g.T, W).multiplyScalar(wn * wn).addScaledVector(_v.subVectors(g.vT, vel), 2 * 1.05 * wn).multiplyScalar(M);
  // the hands carry the body's weight too (shared out between them), not just the part's: lifted,
  // they come up off the ground instead of hanging off a stretched arm
  F.y += ((rd.mass || 70) * 0.55 / share + P.mass) * 9.81;
  F.clampLength(0, F_HAND * str);
  const mag = F.length();
  if (mag < 1e-6) return 0;
  // the part held takes what it can; the rest is passed on up the limb to the hips
  const own = Math.min(mag, P.mass * 160 * Math.sqrt(str));
  b.applyImpulseAtPoint(_v.copy(F).multiplyScalar((own / mag) * H), W, true);
  const rest = mag - own;
  if (rest <= 0) return mag;
  const chain = [];
  let m = 0;
  for (let n = P.def.parent; n; n = rd.parts[n].def.parent) { const C = rd.parts[n]; if (!C.gone) { chain.push(C); m += C.mass; } }
  for (const C of chain) C.body.applyImpulse(_v.copy(F).multiplyScalar((rest / mag) * (C.mass / m) * H), true);
  return mag;
}

/**
 * Our own bodies (us, or the people we simulate) held by someone on another client: their
 * hands' pull comes over the network (mp.js) and is applied here, where the physics is.
 */
export class Tugged {
  constructor() { this.map = new Map(); }
  /** grips: [{ name, local, T, vT }] from actor A's grabber; empty: let go. */
  set(A, grips, fling = null) {
    if (!grips.length && !fling) { this.map.delete(A); return; }
    this.map.set(A, { grips: grips.map((g) => ({ ...g, A })), age: 0, fling });
  }
  update(dt) {
    for (const [A, S] of this.map) {
      S.age += dt;
      // (not heard from them in a while: they've let go)
      if (S.age > 0.5 || A.seat || !A.rd) { this.map.delete(A); continue; }
      if (S.fling) {
        if (A.mode !== 'ragdoll') A.goRagdoll('collapse');
        if (A.mode === 'ragdoll') {
          const v = S.fling;
          A.rd.phys(() => { for (const P of A.rd.list) if (!P.gone) P.body.applyImpulse(_v.copy(v).multiplyScalar(P.mass), true); });
          this.map.delete(A);
        }
        continue;
      }
      // hauled on: off balance
      // (held by someone: they've got you - much less fight in your legs than a shove)
      if (A.mode === 'anim' && !A.hero.action) A.goRagdoll('stumble', { balance: 0.55, decay: 0.12 });
      // (the hold's target carries on moving between messages)
      for (const g of S.grips) g.T.addScaledVector(g.vT, dt);
    }
  }
  preStep(H) {
    for (const [A, S] of this.map) {
      if (A.mode !== 'ragdoll') continue;
      for (const g of S.grips) pullPart(g, H, S.grips.length);
    }
  }
}
