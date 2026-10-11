import * as THREE from 'three';
import { sweep } from './strike.js';
import { poseArm } from './gun.js';
import { armUp, handFree } from './melee.js';

/*
  Throwing what's in your hand (double-tap T): a gun, a bat, a crowbar, a machete. A quick
  overarm throw at the crosshair; the weapon lets go as the arm comes over and flies as a
  physics body, end over end.

  In flight it's swept against everyone like a swing: whatever it meets takes a blow in
  proportion to its weight and speed. A blade that arrives at a sensible angle - tip-first,
  or edge-first across the blade's own plane - goes in and stays in, riding the body part it
  hit (walking about, falling over, lying there). Held in only by the flesh around it, it
  works loose when gravity or the body's jolts pull it back along its own line: pointing up
  out of someone it slides slowly out and drops; pointing down into them it stays put.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Q = () => new THREE.Quaternion();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const UP = V(0, 1, 0);
const G = 9.81;
const L = ([r, u, f], out = V()) => out.set(-r, u, f); // body frame [right, up, forward]

// the throw, right hand in the body frame: back over the shoulder, over the top, through
const WIND = { p: [0.22, 0.24, -0.2], tilt: -1.25, tw: -0.5, dur: 0.2 };
const LET = { p: [0.14, 0.16, 0.46], tilt: 0.35, tw: 0.35, dur: 0.075 };
const FOLLOW = { p: [0.02, -0.26, 0.32], tilt: 0.9, tw: 0.5, dur: 0.24 };

const _o = V(), _q = Q(), _p = V(), _p2 = V(), _hq = Q(), _m = new THREE.Matrix4(), _s = V(), _t = Q();
const _a = V(), _b = V(), _v = V(), _w = V(), _r = V(), _iq = Q();

function bodyFrame(h, o, q) {
  h.hips.getWorldPosition(o);
  o.y += 0.5;
  q.setFromAxisAngle(UP, h.yaw);
}

export class Throws {
  /** ctx: { actors, sfx, aimPoint, scene, shake } */
  constructor(ctx) {
    this.ctx = ctx;
    this.cur = null;          // our throw in progress
    this.flights = new Set(); // weapons in the air, still able to hurt
    this.stuck = new Set();   // blades in bodies
    this.hook = (h, dt) => this.pose(h, dt);
  }
  get busy() { return !!this.cur; }

  /** Throw whatever `actor` holds. False if there's nothing to throw right now. */
  start(actor) {
    const w = actor.meleeHeld || actor.gunHeld;
    const h = actor.hero;
    if (!w || this.cur || actor.mode !== 'anim' || h.action || actor.seat) return false;
    if (w.pickT !== undefined && w.pickT < 1) return false;
    if (w.busy && !w.cocked) return false;          // mid-swing
    if (w.chop) w.chop = null;
    w.btn = null;
    w.abortReload?.();
    // how it sits in the hand now: it stays that way through the throw
    const hand = h.arms[1].hand;
    h.root.updateMatrixWorld(true);
    w.mesh.updateMatrixWorld(true);
    const rel = new THREE.Matrix4().copy(hand.matrixWorld).invert().multiply(w.mesh.matrixWorld);
    bodyFrame(h, _o, _q);
    hand.getWorldPosition(_p);
    hand.getWorldQuaternion(_hq);
    const inv = _q.clone().invert();
    const from = _p.clone().sub(_o).applyQuaternion(inv);
    const fromQ = inv.multiply(_hq);
    // (a weapon in the other hand too: that one stays up at the ready through the throw)
    const other = w.def && actor.meleeHeldL !== w ? actor.meleeHeldL : null;
    this.cur = { actor, w, rel, from, fromQ, t: 0, released: false, prevHook: h.armHook, other };
    h.armHook = this.hook;
    this.ctx.sfx?.('whoosh', 0.5);
    return true;
  }

  /** Arm hook while throwing: the right arm through the keys; the weapon rides the hand until it goes. */
  pose(h, dt) {
    const C = this.cur;
    if (!C) return;
    C.t += dt;
    const A = C.actor;
    const t = C.t;
    if (C.other?.owner === A && C.other.hand === 0) C.other.poseHeld(h, dt);
    const t1 = WIND.dur, t2 = t1 + LET.dur, t3 = t2 + FOLLOW.dur;
    let p, tilt, tw;
    const P = (k) => L(k.p, V());
    if (t < t1) {
      const e = smooth(t / t1);
      p = C.from.clone().lerp(P(WIND), e);
      tilt = lerp(0, WIND.tilt, e); tw = lerp(0, WIND.tw, e);
    } else if (t < t2) {
      const e = (t - t1) / LET.dur;                  // full speed through the release
      p = P(WIND).lerp(P(LET), e);
      tilt = lerp(WIND.tilt, LET.tilt, e); tw = lerp(WIND.tw, LET.tw, e);
    } else {
      const e = smooth((t - t2) / FOLLOW.dur);
      p = P(LET).lerp(P(FOLLOW), e);
      tilt = lerp(LET.tilt, FOLLOW.tilt, e); tw = lerp(LET.tw, FOLLOW.tw, e);
    }
    bodyFrame(h, _o, _q);
    const fwd = h.forward(V());
    const right = V(-fwd.z, 0, fwd.x);
    const target = p.applyQuaternion(_q).add(_o);
    // hand rolls over the top with the arm (tilt about the body's left axis: + brings the tip forward)
    _t.setFromAxisAngle(V(1, 0, 0), tilt);
    const hq = _q.clone().multiply(_t).multiply(C.fromQ);
    // overarm: elbow out to the side and up, behind the hand
    const pole = right.clone().addScaledVector(UP, 0.35).addScaledVector(fwd, -0.4).normalize();
    poseArm(h, h.arms[1], target, hq, pole);
    h.twist = tw;
    if (!C.released) {
      const hand = h.arms[1].hand;
      hand.updateWorldMatrix(true, false);
      _m.multiplyMatrices(hand.matrixWorld, C.rel).decompose(C.w.mesh.position, C.w.mesh.quaternion, _s);
      C.w.mesh.updateMatrixWorld(true);
      if (t >= t2 - 0.01) this.launch(C);
    }
    if (t >= t3) {
      h.twist = 0;
      if (h.armHook === this.hook) h.armHook = null;
      this.cur = null;
      // the other hand's weapon: back in charge of the arms (passed across to the right hand)
      const o = C.other;
      if (o?.owner === A && h.armHook === null) {
        if (!A.meleeHeld && handFree(A, 1)) o.toHand(1); else armUp(A);
      }
    }
    // falling over mid-throw: it just goes
    if (A.mode !== 'anim' && !C.released) this.launch(C);
  }

  launch(C) {
    C.released = true;
    const w = C.w, A = C.actor, h = A.hero, m = w.mesh;
    const pos = m.position.clone(), quat = m.quaternion.clone();
    w.drop(true);                                // (lets go: frees the arms, makes it a body)
    if (!w.loose?.body) return;
    if (this.cur === C) h.armHook = this.hook;   // the follow-through is still ours
    const melee = !!w.def;
    const mass = melee ? w.def.massKg : w.M.mass;
    const speed = melee ? clamp(19 - mass * 2.5, 14, 18) : 14;
    // at the crosshair, a little lob to carry it there
    const aim = this.ctx.aimPoint ? this.ctx.aimPoint.clone() : pos.clone().addScaledVector(h.forward(V()), 10);
    const d = aim.sub(pos);
    const dist = Math.min(d.length(), 30);
    d.normalize();
    const f = h.forward(V());
    if (d.dot(f) < 0.2) d.addScaledVector(f, 0.2 - d.dot(f)).normalize();
    const vel = d.clone().multiplyScalar(speed);
    vel.y += 0.5 * G * (dist / speed) * 0.9;
    vel.add(h.vel);
    // end over end, the tip going forward over the top. A blade spins in its own plane.
    const over = V().crossVectors(UP, d).normalize();
    let spin;
    if (melee) {
      const ax = V(1, 0, 0).applyQuaternion(quat);
      const rate = w.def.hit.kind === 'blade' ? 15 : 11;
      spin = ax.multiplyScalar(Math.sign(ax.dot(over)) || 1).multiplyScalar(rate).addScaledVector(over, 1.5);
    } else {
      spin = over.multiplyScalar(9).add(V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4));
    }
    const b = w.loose.body;
    b.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    b.setAngvel({ x: spin.x, y: spin.y, z: spin.z }, true);
    this.ctx.sfx?.('whoosh', 0.9);
    this.flights.add({ w, by: A, t: 0, hit: new Set([A]), pa: null, pb: null });
  }

  /** Once a frame, after physics. */
  update(dt) {
    for (const F of this.flights) this.fly(F, dt);
    for (const S of this.stuck) this.hold(S, dt);
  }

  fly(F, dt) {
    const w = F.w, b = w.loose?.body;
    if (w.state !== 'loose' || !b) { this.flights.delete(F); return; }
    F.t += dt;
    if (F.t > 0.3) F.hit.delete(F.by);          // (it can come back down on your own head)
    const lv = b.linvel(), sp = Math.hypot(lv.x, lv.y, lv.z);
    if ((sp < 3 && F.t > 0.1) || F.t > 3) { this.flights.delete(F); return; }
    const m = w.mesh;
    m.updateMatrixWorld(true);
    const melee = !!w.def;
    let a, bb, r;
    if (melee) {
      a = V(0, w.def.seg[0], 0).applyMatrix4(m.matrixWorld);
      bb = V(0, w.def.seg[1], 0).applyMatrix4(m.matrixWorld);
      r = w.def.r + 0.01;
    } else {
      a = w.worldPos(V()); bb = a.clone(); r = 0.07;
    }
    if (F.pa) {
      const hit = sweep(F.pa, F.pb, a, bb, r, this.ctx.actors, null, F.hit);
      if (hit) { this.impact(F, hit, a, bb); return; }
    }
    F.pa = a; F.pb = bb;
  }

  impact(F, hit, a, bb) {
    const w = F.w, b = w.loose.body, m = w.mesh;
    const melee = !!w.def;
    const lv = b.linvel(), av = b.angvel(), bt = b.translation();
    const point = hit.point;
    // the speed of the part that hit: flying plus spinning
    _r.set(point.x - bt.x, point.y - bt.y, point.z - bt.z);
    const vp = V(lv.x, lv.y, lv.z).add(_w.set(av.x, av.y, av.z).cross(_r));
    const spd = vp.length();
    F.hit.add(hit.actor);
    this.flights.delete(F);
    if (spd < 3) return;
    // which way it's travelling, in the weapon's own frame (y: hilt -> tip, z: the edge)
    _iq.copy(m.quaternion).invert();
    const dl = vp.clone().applyQuaternion(_iq).normalize();
    const blade = melee && w.def.hit.kind === 'blade';
    const s = hit.s ?? 0.5;
    const stab = blade && s > 0.75 && dl.y > 0.55;
    const slash = blade && !stab && s > 0.25 && dl.z > 0.5;
    const axis = V(0, 1, 0).applyQuaternion(m.quaternion);
    const k = clamp(spd / 14, 0.4, 1.3);
    let W;
    if (melee) {
      W = { ...w.def.hit, axis, sev: w.def.hit.sev * (stab || slash ? 1 : 0.55) * k };
      // the flat or the handle of a blade is just a thing hitting you
      if (blade && !stab && !slash) W.kind = 'blunt';
      if (w.def.harmless) W.harmless = true; // (the knife never injures)
    } else {
      const gm = w.M.mass;
      W = { kind: 'blunt', mass: clamp(gm * 1.6, 0.8, 6), sev: clamp(gm * 0.4, 0.2, 1.1) * k, ref: 11, maxImp: clamp(gm * 30, 20, 70) };
    }
    hit.actor.struck(hit.part, point, vp.clone(), hit.normal, W, F.by);
    this.ctx.sfx?.(melee ? w.def.sound : 'punch', clamp(k, 0.4, 1));
    const harm = !melee || !w.def.harmless;
    if (blade && (stab || slash) && harm) this.ctx.sfx?.('flesh', 0.5 + 0.4 * k);
    if (blade && harm) w.blood?.add(point, stab || slash ? 0.8 : 0.2);
    // edge-first and fast: right through the limb (slice.js), and on it flies
    if (harm && slash && !w.def.noCut && this.ctx.dismember?.tryCut(hit.actor, hit.part, point, vp, axis, V(0, 0, 1).applyQuaternion(m.quaternion),
      { edges: w.def.edges || 1, power: 0.9, cleave: w.def.cleave || 1 })) {
      b.setLinvel({ x: lv.x * 0.7, y: lv.y * 0.7, z: lv.z * 0.7 }, true);
      return;
    }
    // a blade that went in the right way round and hard enough stays in
    if (harm && (stab || slash) && spd > 7) { this.embed(w, hit, stab, spd, vp); return; }
    // anything else bounces off
    b.setLinvel({ x: -lv.x * 0.18, y: Math.abs(lv.y) * 0.25 + 0.6, z: -lv.z * 0.18 }, true);
    b.setAngvel({ x: av.x * 0.4, y: av.y * 0.4, z: av.z * 0.4 }, true);
  }

  embed(w, hit, stab, spd, vp) {
    const A = hit.actor, g = A.groups[hit.part];
    if (!g) return;
    const m = w.mesh;
    // the way in: along the blade for a stab, across it (edge first) for a slash
    const inL = stab ? V(0, 1, 0) : V(0, 0, 1);
    const inW = inL.clone().applyQuaternion(m.quaternion);
    // square it up a little to the direction it was going (it cuts its own path in)
    const depth = clamp(spd * (stab ? 0.0065 : 0.0045), 0.035, stab ? 0.1 : 0.06);
    // the tip / edge point that touched, pushed on in by the depth
    const lead = stab ? V(0, w.def.seg[1], 0) : V(0, lerp(w.def.seg[0], w.def.seg[1], 0.6), 0.035);
    const leadW = lead.clone().applyMatrix4(m.matrixWorld);
    const shift = V().subVectors(hit.point, leadW);
    // only the part of the gap that's along the way in; then the depth itself
    m.position.addScaledVector(inW, shift.dot(inW) + depth);
    w.debris.release(w.loose);
    w.loose = null;
    w.state = 'embed';
    g.attach(m);
    m.updateMatrixWorld(true);
    const S = { w, actor: A, part: hit.part, g, inL, depth, depth0: depth, v: 0, lastP: null, lastV: V(), acc: V() };
    w.embed = S;
    this.stuck.add(S);
  }

  /** A blade let go of while it was stuck in someone (melee.js stickIn): it stays in them. */
  adopt(S) {
    S.lastP = null; S.v = 0; S.lastV.set(0, 0, 0); S.acc.set(0, 0, 0);
    this.stuck.add(S);
  }

  /** Stuck in someone: held by friction, worked loose by gravity and jolts along the blade. */
  hold(S, dt) {
    const w = S.w, m = w.mesh;
    // picked back out by hand / reset / the person's gone from the world
    if (w.embed !== S || w.state !== 'embed') { this.stuck.delete(S); return; }
    if (!m.parent || !S.actor.hero.root.parent) { this.release(S, V()); return; }
    // how the part it's in is moving (its acceleration pulls on the blade like gravity does)
    m.getWorldPosition(_p);
    if (S.lastP && dt > 0) {
      _v.subVectors(_p, S.lastP).divideScalar(dt);
      _a.subVectors(_v, S.lastV).divideScalar(dt).clampLength(0, 120);
      S.acc.lerp(_a, 1 - Math.exp(-dt * 20));
      S.lastV.copy(_v);
    }
    S.lastP = (S.lastP || V()).copy(_p);
    m.getWorldQuaternion(_q);
    const inW = _b.copy(S.inL).applyQuaternion(_q);
    // apparent gravity in the body's frame, along the way out (-inW)
    _w.set(-S.acc.x, -G - S.acc.y, -S.acc.z);
    const pull = -_w.dot(inW);                    // > 0: it wants to come out
    // the deeper it is, the harder the flesh holds it
    const f = S.depth / S.depth0;
    const grip = 7.5 * (0.25 + 0.75 * f);
    // flesh is thick: it creeps rather than slides
    const want = Math.max(0, pull - grip) * 0.012;
    S.v = lerp(S.v, want, 1 - Math.exp(-dt * 6));
    if (S.v > 0) {
      const dd = Math.min(S.depth, S.v * dt);
      S.depth -= dd;
      m.position.addScaledVector(S.inL.clone().applyQuaternion(m.quaternion), -dd);
    }
    if (S.depth <= 0.004) this.release(S, S.lastV.clone().addScaledVector(inW, -0.3));
  }

  release(S, vel) {
    const w = S.w, m = w.mesh;
    this.stuck.delete(S);
    w.embed = null;
    m.updateMatrixWorld(true);
    const pos = V(), quat = Q();
    m.matrixWorld.decompose(pos, quat, _s);
    w.scene.attach(m);
    m.position.copy(pos); m.quaternion.copy(quat);
    w.looseAt(pos, quat, vel, V((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2));
  }

  /** A blade being pulled out by hand (Melee.pick): out of the body, back in the world. */
  static unembed(w) {
    const S = w.embed;
    if (!S) return;
    w.embed = null;
    const m = w.mesh;
    m.updateMatrixWorld(true);
    const pos = V(), quat = Q();
    m.matrixWorld.decompose(pos, quat, _s);
    w.scene.attach(m);
    m.position.copy(pos); m.quaternion.copy(quat);
  }
}
