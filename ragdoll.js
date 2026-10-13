import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { groups, G_WORLD, G_PROXY, G_QUERY, G_CAR, G_DEBRIS } from './physics.js';
import { DIM } from './character.js';

/*
  Physical body of the character. Every rigid body's frame is exactly the frame of the
  matching bone group in Character (origin at the proximal joint, +Y pointing back up the
  bone, +Z forward), so pose transfer in either direction is a straight copy.

  Segment masses and centre-of-mass locations follow de Leva (1996) anthropometric tables
  for a 75 kg adult male; inertia tensors are computed from each segment's approximating
  solid about its own COM. Joints are ball joints with per-axis anatomical limits and
  implicit (solver-side) motors acting as muscles: X = flex/extend, Z = ab/adduct,
  Y = twist about the bone. Knees are true hinges.
*/

const { THIGH, SHIN, UPPER_ARM, FOREARM } = DIM;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// collision categories
const T = 2, H = 4, UA = 8, FA = 16, TH = 32, SH = 64;
const W = G_WORLD | G_PROXY | G_QUERY | G_CAR | G_DEBRIS; // (debris only touches bodies if it's `solid`)
// (limited set: what's always been on, from the moment a body goes physical)
const FILTER = {
  [T]: W | FA | SH,
  [H]: W | FA | TH | SH,
  [UA]: W | FA | TH | SH,
  [FA]: W | T | H | UA | FA | TH | SH,
  [TH]: W | H | UA | FA | TH,
  [SH]: W | T | H | UA | FA | SH,
};
// full self-collision: every limb against the trunk, the head and each other (only the pairs
// joined by a joint are exempt, via the joint). The trunk doesn't test against itself.
const B = T | H | UA | FA | TH | SH;
const FULL = { [T]: W | (B & ~T), [H]: W | B, [UA]: W | B, [FA]: W | B, [TH]: W | B, [SH]: W | B };

export const TOTAL_MASS = 75;

// inertia helpers (about COM, principal axes = body axes)
const boxI = (m, w, h, d) => V(m * (h * h + d * d) / 12, m * (w * w + d * d) / 12, m * (w * w + h * h) / 12);
const rodI = (m, L, r) => V(m * (L * L / 12 + r * r / 4), m * r * r / 2, m * (L * L / 12 + r * r / 4));
const ellI = (m, a, b, c) => V(m * (b * b + c * c) / 5, m * (a * a + c * c) / 5, m * (a * a + b * b) / 5);

// shapes: [kind, ...size, x, y, z, rotZ]
function partDefs(S = 1, kA = 1, kL = 1) {
  const P = {
    pelvis: { m: 8.4, com: V(0, -0.03, -0.01), I: boxI(8.4, 0.3, 0.2, 0.2), g: T,
      shapes: [['capX', 0.06, 0.095, 0, -0.03, 0]] },
    spine: { parent: 'pelvis', anchor: V(0, 0.1, 0), m: 12.2, com: V(0, 0.1, 0), I: boxI(12.2, 0.26, 0.2, 0.17), g: T,
      shapes: [['capX', 0.05, 0.085, 0, 0.1, 0]] },
    chest: { parent: 'spine', anchor: V(0, 0.2, 0), m: 12.0, com: V(0, 0.13, -0.01), I: boxI(12, 0.32, 0.3, 0.19), g: T,
      shapes: [['rbox', 0.1, 0.1, 0.05, 0.04, 0, 0.13, -0.005]] },
    head: { parent: 'chest', anchor: V(0, 0.255, -0.005), m: 5.2, com: V(0, 0.14, 0.012), I: ellI(5.2, 0.075, 0.11, 0.095), g: H,
      shapes: [['capY', 0.022, 0.09, 0, 0.165, 0.016], ['capY', 0.03, 0.045, 0, 0.04, 0]] },
  };
  for (const [s, n] of [[1, 'L'], [-1, 'R']]) {
    P['thigh' + n] = { side: s, parent: 'pelvis', anchor: V(s * 0.088, -0.055, 0), m: 10.6, com: V(0, -0.4095 * THIGH, 0),
      I: rodI(10.6, THIGH, 0.07), g: TH, shapes: [['capY', 0.15, 0.07, 0, -0.22, 0]] };
    P['shin' + n] = { side: s, parent: 'thigh' + n, anchor: V(0, -THIGH, 0), m: 3.25, com: V(0, -0.4459 * SHIN, 0),
      I: rodI(3.25, SHIN, 0.045), g: SH, shapes: [['capY', 0.165, 0.048, 0, -0.215, 0]] };
    P['foot' + n] = { side: s, parent: 'shin' + n, anchor: V(0, -SHIN, 0), m: 1.03, com: V(0, -0.045, 0.055),
      I: boxI(1.03, 0.09, 0.07, 0.25), g: SH, shapes: [['rbox', 0.035, 0.027, 0.115, 0.01, 0, -0.047, 0.06]], foot: true };
    P['upper' + n] = { side: s, parent: 'chest', anchor: V(s * 0.185, 0.2, -0.015), m: 2.0, com: V(0, -0.5772 * UPPER_ARM, 0),
      I: rodI(2.0, UPPER_ARM, 0.045), g: UA, shapes: [['capY', 0.1, 0.045, 0, -0.145, 0]] };
    // forearm + hand as one segment: COM = mass-weighted forearm (45.7%) and hand (~4cm past wrist)
    const fc = (1.2 * 0.4574 * FOREARM + 0.46 * (FOREARM + 0.04)) / 1.66;
    P['fore' + n] = { side: s, parent: 'upper' + n, anchor: V(0, -UPPER_ARM, 0), m: 1.66, com: V(0, -fc, 0),
      I: rodI(1.66, FOREARM + 0.09, 0.035), g: FA, shapes: [['capY', 0.14, 0.036, 0, -0.175, 0]] };
  }
  // longer / shorter arms and legs (the FUN menu): the limb parts stretch along their bones
  for (const [n, k] of [['thigh', kL], ['shin', kL], ['upper', kA], ['fore', kA]]) {
    if (k === 1) continue;
    for (const d of [P[n + 'L'], P[n + 'R']]) {
      d.com.y *= k;
      d.I.x *= k * k; d.I.z *= k * k;
      d.shapes = d.shapes.map(([t, h, r, x, y, z]) => [t, h * k, r, x, y * k, z]);
    }
  }
  for (const n of ['L', 'R']) {
    P['shin' + n].anchor.y *= kL; P['foot' + n].anchor.y *= kL; P['fore' + n].anchor.y *= kA;
  }
  if (S !== 1) {
    // a taller / shorter body: every length scales, inertia with length squared
    for (const d of Object.values(P)) {
      d.anchor?.multiplyScalar(S);
      d.com.multiplyScalar(S);
      d.I.multiplyScalar(S * S);
      d.shapes = d.shapes.map(([k, ...n]) => [k, ...n.map((x) => x * S)]);
    }
  }
  return P;
}

// Joint ranges (radians, rotation-vector components, left side; right mirrors Z and Y) and
// muscle stiffness at full strength (N·m/rad).
const R = (x, z, y) => ({ x, z, y });
const JOINTS = {
  spine: { lim: R([-0.45, 0.9], [-0.4, 0.4], [-0.45, 0.45]), k: 1400 },
  chest: { lim: R([-0.45, 0.7], [-0.35, 0.35], [-0.5, 0.5]), k: 1100 },
  head: { lim: R([-0.8, 0.9], [-0.6, 0.6], [-1.25, 1.25]), k: 160 },
  thigh: { lim: R([-2.3, 0.5], [-0.45, 1.1], [-0.7, 0.7]), k: 1600 },
  shin: { hinge: [0, 2.6], k: 1400 },
  foot: { lim: R([-0.45, 0.85], [-0.35, 0.35], [-0.35, 0.35]), k: 500 },
  upper: { lim: R([-3.0, 1.0], [-0.6, 2.8], [-1.4, 1.4]), k: 380 },
  fore: { lim: R([-2.6, 0.02], [-0.2, 0.2], [-1.4, 1.4]), k: 220 },
};
const AX = ['x', 'y', 'z']; // raw joint axes AngX=3, AngY=4, AngZ=5
const MAX_V = 9, MAX_W = 28; // hand-off speed caps (m/s, rad/s)

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'XZY');
const _v = V(), _v2 = V(), _w = V();

// rotation vector (axis * angle) of quaternion q, shortest way
function rotVec(q, out) {
  let { x, y, z, w } = q;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.sqrt(x * x + y * y + z * z);
  if (s < 1e-9) return out.set(0, 0, 0);
  const ang = 2 * Math.atan2(s, w);
  return out.set(x, y, z).multiplyScalar(ang / s);
}
const tv = (r, out = V()) => out.set(r.x, r.y, r.z);

export class Ragdoll {
  constructor(world, S = 1, kA = 1, kL = 1) {
    this.world = world;
    this.S = S;
    this.kA = kA; this.kL = kL;
    // standing pelvis height relative to a standard-legged body of this height
    this.hipK = (0.95 + (THIGH + SHIN) * (kL - 1)) / 0.95;
    this.defs = partDefs(S, kA, kL);
    this.names = Object.keys(this.defs);
    this.parts = {};
    this.list = [];
    this.active = false;
    // collider / mass changes waiting for the bodies to be enabled (see phys)
    this.ops = [];
    for (const name of this.names) this.buildPart(name);
    for (const p of this.list) if (p.def.parent) this.buildJoint(p);
    this.computeInertia();
  }

  buildPart(name) {
    const d = this.defs[name];
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setAdditionalMassProperties(d.m, d.com, d.I, { x: 0, y: 0, z: 0, w: 1 })
        .setLinearDamping(0.02)
        .setAngularDamping(0.3)
        .setCanSleep(false)
        .setEnabled(false)
    );
    const cols = this.makeCols(d, body);
    const p = { name, def: d, body, cols, touch: false, side: d.side || 0, kind: name.replace(/[LR]$/, ''), children: [], mass: d.m, gone: false };
    this.parts[name] = p;
    this.list.push(p);
  }

  makeCols(d, body) {
    const gr = groups(d.g, FILTER[d.g]);
    const cols = [];
    for (const s of d.shapes) {
      let c;
      if (s[0] === 'capY') c = RAPIER.ColliderDesc.capsule(s[1], s[2]).setTranslation(s[3], s[4], s[5]);
      else if (s[0] === 'capX') c = RAPIER.ColliderDesc.capsule(s[1], s[2]).setTranslation(s[3], s[4], s[5])
        .setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 });
      else c = RAPIER.ColliderDesc.roundCuboid(s[1], s[2], s[3], s[4]).setTranslation(s[5], s[6], s[7]);
      c.setDensity(0).setFriction(d.foot ? 1.1 : 0.75).setRestitution(0.05).setCollisionGroups(gr);
      const col = this.world.createCollider(c, body);
      col._g = d.g;
      cols.push(col);
    }
    return cols;
  }

  /**
   * Swapping colliders on (or re-massing) a DISABLED body crashes Rapier's next step (a wasm
   * "unreachable" panic in the query pipeline, and the physics world is dead from then on) -
   * which is exactly what a cut on a puppet (a remote player: never physical here) or a
   * respawn out of the animated pose did. So while the ragdoll's off, such changes wait, and
   * run in order the moment its bodies are enabled again.
   */
  phys(fn) {
    if (this.active) fn();
    else this.ops.push(fn);
  }

  /** Whole again (a respawn): every cut part gets its own colliders and mass back. `onFresh(handle)` for each new collider. */
  restore(onFresh = null) {
    // (cuts still waiting to happen needn't now: only what the bodies really have gets undone)
    if (!this.active) this.ops = [];
    for (const p of this.list) {
      if (p.physCut) this.phys(() => {
        p.physCut = false;
        for (const c of p.cols) this.world.removeCollider(c, false);
        p.cols = this.makeCols(p.def, p.body);
        for (const c of p.cols) onFresh?.(c.handle);
        p.body.setAdditionalMassProperties(p.def.m, p.def.com, p.def.I, { x: 0, y: 0, z: 0, w: 1 }, true);
      });
      if (!p.gone && p.cutY === undefined) continue;
      p.mass = p.def.m;
      p.gone = false;
      if (p.parent) p.strength = 0.5; // (a cut-off part's muscles were let go)
      p.cap = null;
      p.cutY = undefined;
    }
    this.mass = undefined;
    this.cutAny = false;
  }

  buildJoint(p) {
    const d = p.def;
    const parent = this.parts[d.parent];
    parent.children.push(p);
    p.parent = parent;
    const J = JOINTS[p.kind];
    const s = p.side || 1;
    const zero = { x: 0, y: 0, z: 0 };
    p.hinge = !!J.hinge;
    const jd = p.hinge
      ? RAPIER.JointData.revolute(d.anchor, zero, { x: 1, y: 0, z: 0 })
      : RAPIER.JointData.spherical(d.anchor, zero);
    p.joint = this.world.createImpulseJoint(jd, parent.body, p.body, true);
    p.joint.setContactsEnabled(false);
    const raw = p.joint.rawSet, h = p.joint.handle;
    if (p.hinge) {
      p.joint.setLimits(J.hinge[0], J.hinge[1]);
      p.joint.configureMotorModel(RAPIER.MotorModel.ForceBased);
      p.lim = { x: J.hinge, y: [0, 0], z: [0, 0] };
    } else {
      const m = (r) => (s > 0 ? r : [-r[1], -r[0]]);
      p.lim = { x: J.lim.x, z: m(J.lim.z), y: m(J.lim.y) };
      AX.forEach((a, i) => {
        raw.jointSetLimits(h, 3 + i, p.lim[a][0], p.lim[a][1]);
        raw.jointConfigureMotorModel(h, 3 + i, RAPIER.MotorModel.ForceBased);
      });
    }
    p.k = J.k;
    // muscle state, written by the behaviour layer
    p.target = { x: 0, y: 0, z: 0 };   // relative Euler XZY (hinge uses x)
    p.targetQ = null;                   // or a relative quaternion
    p.world = null;                     // or a world-space rotation
    p.strength = 0.5;
    p.damping = 1;
  }

  // Inertia of everything distal to each joint, about the joint (rest pose); sets damping so
  // each muscle is near critically damped at full strength.
  computeInertia() {
    for (const p of this.list) {
      p.restPos = p.parent ? p.parent.restPos.clone().add(p.def.anchor) : V();
      p.restCom = p.restPos.clone().add(p.def.com);
    }
    const d = V();
    for (const p of this.list) {
      if (!p.parent) continue;
      let I = 0;
      const stack = [p];
      while (stack.length) {
        const c = stack.pop();
        d.subVectors(c.restCom, p.restPos);
        I += c.def.m * (d.lengthSq() - d.y * d.y * 0.5) + (c.def.I.x + c.def.I.z) / 2;
        stack.push(...c.children);
      }
      p.Isub = I;
      p.d = 2 * Math.sqrt(p.k * I);
    }
  }

  // ---------- pose transfer ----------
  /** Place bodies on the animated pose; `prev` gives one-frame-old pose for velocities. */
  enable(cur, prev, dt) {
    // whatever the animation was doing (sitting, lying, climbing, mid-blend), hand the physics
    // a pose it can hold: joints inside their limits, every part on its parent's anchor...
    cur = this.sanitize(cur, this._sc || (this._sc = {}));
    prev = this.sanitize(prev[this.names[0]] ? prev : cur, this._sp || (this._sp = {}));
    dt = Math.max(dt || 1 / 60, 1 / 240);
    const qd = new THREE.Quaternion();
    // ...moving no faster than a body plausibly can (teleports/snaps don't become launches)
    for (const p of this.list) {
      const c = cur[p.name], o = prev[p.name];
      const b = p.body;
      b.setEnabled(true);
      b.setTranslation(c.pos, true);
      b.setRotation(c.quat, true);
      const comNow = p.def.com.clone().applyQuaternion(c.quat).add(c.pos);
      const comOld = p.def.com.clone().applyQuaternion(o.quat).add(o.pos);
      b.setLinvel(comNow.sub(comOld).divideScalar(dt).clampLength(0, MAX_V), true);
      qd.copy(c.quat).multiply(_q.copy(o.quat).invert());
      b.setAngvel(rotVec(qd, _v).divideScalar(dt).clampLength(0, MAX_W), true);
      b.resetForces(true);
      b.resetTorques(true);
    }
    // (cuts and restores that came while it was off: now, on enabled bodies)
    const ops = this.ops;
    this.ops = [];
    for (const fn of ops) fn();
    // ...and not starting inside the level (a seat, the floor under someone lying down)
    this.depenetrate();
    // limbs only start colliding with the body / each other once they're clear of it (a pose
    // with a hand resting on a thigh would otherwise blow apart on the first step)
    for (const p of this.list) for (const c of p.cols) { if (c._gone) continue; c.setCollisionGroups(groups(c._g, FILTER[c._g])); c._full = false; }
    this.selfT = 0.12;
    this.active = true;
  }

  /** Each frame while physical: switch parts over to full self-collision as they come clear. */
  selfCollide(dt) {
    if (!this.active) return;
    this.selfT -= dt;
    if (this.selfT > 0) return;
    this.selfT = 0.1;
    const own = [];
    for (const p of this.list) if (!p.gone) for (const c of p.cols) own.push([p, c]);
    let pending = false;
    for (const [p, c] of own) {
      if (c._full) continue;
      const g = c._g, add = FULL[g] & ~FILTER[g];
      let clear = true;
      for (const [q, o] of own) {
        if (o === c || q === p || q === p.parent || q.parent === p) continue;
        if (!(add & o._g) && !(FULL[o._g] & ~FILTER[o._g] & g)) continue; // not a new pair
        const ct = c.contactCollider(o, 0.004);
        if (ct) { clear = false; break; }
      }
      if (clear) { c.setCollisionGroups(groups(g, FULL[g])); c._full = true; }
      else pending = true;
    }
    if (!pending) this.selfT = Infinity;
  }

  /** pose -> out: relative rotations clamped to the joint limits, limbs re-chained from the pelvis. */
  sanitize(pose, out) {
    const rel = _q, pq = _q2;
    for (const p of this.list) {
      const c = pose[p.name];
      const o = (out[p.name] ||= { pos: V(), quat: new THREE.Quaternion() });
      if (!p.parent) { o.pos.copy(c.pos); o.quat.copy(c.quat).normalize(); continue; }
      const P = out[p.parent.name];
      rel.copy(pq.copy(P.quat).invert()).multiply(c.quat);
      if (rel.w < 0) rel.set(-rel.x, -rel.y, -rel.z, -rel.w);
      const L = p.lim, m = 0.01;
      if (p.hinge) {
        const a = clamp(2 * Math.atan2(rel.x, rel.w), L.x[0] + m, L.x[1] - m);
        rel.set(Math.sin(a / 2), 0, 0, Math.cos(a / 2));
      } else {
        // the motors' own measure: angle = 2·asin(component) per axis
        for (const a of AX) rel[a] = clamp(rel[a], Math.sin((L[a][0] + m) / 2), Math.sin((L[a][1] - m) / 2));
        const n = rel.x * rel.x + rel.y * rel.y + rel.z * rel.z;
        if (n > 1) { const s = 1 / Math.sqrt(n); rel.x *= s; rel.y *= s; rel.z *= s; }
        rel.w = Math.sqrt(Math.max(0, 1 - Math.min(1, n)));
      }
      o.quat.copy(P.quat).multiply(rel).normalize();
      o.pos.copy(p.def.anchor).applyQuaternion(P.quat).add(P.pos);
    }
    return out;
  }

  /** Push the whole body out of any static geometry it was placed overlapping. */
  depenetrate() {
    const w = this.world;
    if (!this.statics || this.staticGen !== (w._staticGen || 0) || !w._staticBounds) {
      this.staticGen = w._staticGen || 0;
      // the level's fixed colliders, each with a bounding sphere (shared by every ragdoll)
      this.statics = w._staticBounds ||= (() => {
        const out = [];
        w.colliders.forEach((c) => {
          if (!c.parent()?.isFixed()) return;
          const t = c.translation();
          let rad = Infinity;
          const st = c.shapeType();
          if (st === RAPIER.ShapeType?.Cuboid) { const h = c.halfExtents(); rad = Math.hypot(h.x, h.y, h.z); }
          else if (st === RAPIER.ShapeType?.Cylinder) rad = Math.hypot(c.radius(), c.halfHeight());
          out.push({ c, x: t.x, y: t.y, z: t.z, rad });
        });
        return out;
      })();
    }
    // only what's within reach of the body (it's never shifted more than 0.6 m below)
    const pel = this.parts.pelvis.body.translation();
    const near = [];
    for (const s of this.statics) {
      if (!w.getCollider(s.c.handle)) continue; // (removed: a map switch)
      const d = Math.hypot(s.x - pel.x, s.y - pel.y, s.z - pel.z);
      if (!(d > s.rad + 3)) near.push(s.c);
    }
    const shift = V(), n = V();
    for (let it = 0; it < 6; it++) {
      w.propagateModifiedBodyPositionsToColliders();
      let depth = 0.003;
      n.set(0, 0, 0);
      for (const p of this.list) for (const c of p.cols) for (const s of near) {
        const ct = c.contactCollider(s, 0);
        if (ct && -ct.distance > depth) { depth = -ct.distance; n.set(ct.normal2.x, ct.normal2.y, ct.normal2.z); }
      }
      if (!n.lengthSq()) break;
      _v.copy(n).multiplyScalar(depth + 0.004);
      if (shift.clone().add(_v).length() > 0.6) break; // buried deep: leave it to the solver
      shift.add(_v);
      for (const p of this.list) {
        const t = p.body.translation();
        p.body.setTranslation({ x: t.x + _v.x, y: t.y + _v.y, z: t.z + _v.z }, true);
      }
    }
  }

  disable() {
    for (const p of this.list) p.body.setEnabled(false);
    this.active = false;
  }

  /** World transforms of every part. */
  read(out = {}) {
    for (const p of this.list) {
      const o = (out[p.name] ||= { pos: V(), quat: new THREE.Quaternion() });
      tv(p.body.translation(), o.pos);
      const r = p.body.rotation();
      o.quat.set(r.x, r.y, r.z, r.w);
    }
    return out;
  }

  // ---------- state queries ----------
  /** Refresh which parts touch static level geometry. */
  updateContacts() {
    const w = this.world;
    for (const p of this.list) {
      let touch = false;
      for (const c of p.cols) {
        w.contactPairsWith(c, (o) => {
          if (touch || !o.parent()?.isFixed()) return;
          w.contactPair(c, o, (m) => { if (m.numContacts() > 0) touch = true; });
        });
        if (touch) break;
      }
      p.touch = touch;
    }
  }
  /**
   * Contact impulse (N s, the last physics step) pressing on each part from anything that isn't
   * this body - the ground, a car, someone standing on it: fn(part, impulse).
   */
  pressure(fn) {
    const w = this.world;
    const own = this._own ||= new Set();
    own.clear();
    for (const p of this.list) own.add(p.body.handle);
    for (const p of this.list) {
      if (p.gone) continue;
      let J = 0;
      for (const c of p.cols) {
        w.contactPairsWith(c, (o) => {
          const b = o.parent();
          if (b && own.has(b.handle)) return;
          w.contactPair(c, o, (m) => { for (let i = 0, n = m.numContacts(); i < n; i++) J += m.contactImpulse(i); });
        });
      }
      if (J > 0) fn(p, J);
    }
  }
  /** Height of the level surface below (x, fromY, z). */
  groundY(x, z, fromY = 3) {
    this._ray ||= new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this._ray.origin = { x, y: fromY, z };
    const hit = this.world.castRay(this._ray, 50, true, undefined, groups(0x8000, G_WORLD));
    return hit ? fromY - hit.timeOfImpact : 0;
  }
  com(out = V()) {
    out.set(0, 0, 0);
    for (const p of this.list) out.addScaledVector(tv(p.body.worldCom(), _v), p.mass);
    return out.divideScalar(this.mass || TOTAL_MASS);
  }
  comVel(out = V()) {
    out.set(0, 0, 0);
    for (const p of this.list) out.addScaledVector(tv(p.body.linvel(), _v), p.mass);
    return out.divideScalar(this.mass || TOTAL_MASS);
  }

  // ---------- dismemberment ----------
  /**
   * Cut through part `name` at local height `cutY` along its bone (the joint is at 0). What's
   * left of the part becomes a short stump collider, lighter by what was lost; everything past
   * the cut (the rest of the limb) stays jointed on but goes weightless, limp and untouchable -
   * a ghost the behaviour code can keep driving harmlessly, while the real severed piece flies
   * as its own body (see slice.js). Returns the parts that went.
   */
  sever(name, cutY) {
    const P = this.parts[name];
    if (!P || P.gone) return null;
    const gone = [];
    const walk = (p) => { for (const c of p.children) { if (!c.gone) gone.push(c); walk(c); } };
    walk(P);
    for (const q of gone) {
      q.gone = true;
      this.phys(() => {
        q.physCut = true;
        for (const c of q.cols) { c.setCollisionGroups(0); c._gone = true; }
        q.body.setAdditionalMassProperties(0.01, { x: 0, y: 0, z: 0 }, { x: 1e-5, y: 1e-5, z: 1e-5 }, { x: 0, y: 0, z: 0, w: 1 }, true);
      });
      q.mass = 0.01;
      q.strength = 0;
    }
    // the stump: from the joint to the cut, as thick as the limb was
    const sh = P.def.shapes[0];
    const r = sh[0] === 'capY' ? sh[2] : sh[0] === 'capX' ? sh[2] : Math.max(sh[1], sh[3]) + sh[4];
    const x = sh[0] === 'rbox' ? sh[5] : sh[3], z = sh[0] === 'rbox' ? sh[7] : sh[5];
    const full = Math.abs(sh[0] === 'rbox' ? sh[6] : sh[4]) + (sh[0] === 'capY' ? sh[1] + sh[2] : 0.1);
    const len = Math.abs(cutY);
    const f = clamp(len / Math.max(full, 0.05), 0.12, 1);
    P.mass = P.def.m * f;
    const I = P.def.I.clone().multiplyScalar(f * f * f).max(V(1e-4, 1e-4, 1e-4));
    const mass = P.mass;
    this.phys(() => {
      P.physCut = true;
      const g = P.cols[0]._g, full0 = P.cols[0]._full;
      for (const c of P.cols) this.world.removeCollider(c, false);
      const cd = RAPIER.ColliderDesc.capsule(Math.max(0.004, len / 2 - r * 0.5), r * 0.95).setTranslation(x, cutY / 2, z)
        .setDensity(0).setFriction(0.75).setRestitution(0.05)
        .setCollisionGroups(groups(g, (full0 ? FULL : FILTER)[g]));
      const col = this.world.createCollider(cd, P.body);
      col._g = g; col._full = full0;
      P.cols = [col];
      P.body.setAdditionalMassProperties(mass, { x: 0, y: cutY / 2, z: 0 }, { x: I.x, y: I.y, z: I.z }, { x: 0, y: 0, z: 0, w: 1 }, true);
    });
    // what hits test against now: the stump
    P.cap = { a: V(x, 0, z), b: V(x, cutY, z), r };
    P.cutY = cutY;
    this.cutAny = true;
    this.mass = this.list.reduce((m, p) => m + p.mass, 0);
    return gone;
  }
  pos(name, out = V()) { return tv(this.parts[name].body.translation(), out); }
  quat(name, out = new THREE.Quaternion()) { const r = this.parts[name].body.rotation(); return out.set(r.x, r.y, r.z, r.w); }
  vel(name, out = V()) { return tv(this.parts[name].body.linvel(), out); }
  angvel(name, out = V()) { return tv(this.parts[name].body.angvel(), out); }
  /** Point in a part's local frame -> world. */
  point(name, local, out = V()) {
    return out.copy(local).applyQuaternion(this.quat(name, _q2)).add(this.pos(name, _v2));
  }
  axis(name, local, out = V()) { return out.copy(local).applyQuaternion(this.quat(name, _q2)); }

  /** Current relative joint rotation as rotation-vector components (the motors' measure). */
  angles(name) {
    const p = this.parts[name];
    const q = this.quat(p.parent.name, _q).invert().multiply(this.quat(name, _q2));
    if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    return { x: 2 * Math.asin(q.x), z: 2 * Math.asin(q.z), y: 2 * Math.asin(q.y) };
  }

  // ---------- muscles ----------
  /** Push muscle targets into the joint motors. Call once per frame (motors are implicit). */
  drive() {
    const qp = new THREE.Quaternion(), qt = new THREE.Quaternion();
    for (const p of this.list) {
      if (!p.parent) continue;
      // (a severed ghost: no muscle, no friction)
      const s = p.gone ? 0 : Math.max(0, p.strength);
      const k = p.k * s;
      const dmp = p.gone ? 0 : p.d * (Math.sqrt(s) * p.damping + 0.04); // a little passive joint friction
      if (p.hinge) {
        p.joint.configureMotorPosition(clamp(p.target.x, p.lim.x[0], p.lim.x[1]), k, dmp);
        continue;
      }
      // relative target rotation
      if (p.world) {
        this.quat(p.parent.name, qp);
        qt.copy(qp.invert()).multiply(p.world);
      } else if (p.targetQ) qt.copy(p.targetQ);
      else {
        const t = p.target;
        _e.set(t.x, t.y, t.z, 'XZY');
        qt.setFromEuler(_e);
      }
      if (qt.w < 0) qt.set(-qt.x, -qt.y, -qt.z, -qt.w);
      // the motors measure each axis as 2·asin(imag): feeding the same measure of the target
      // makes the equilibrium exactly the target rotation
      const raw = p.joint.rawSet, h = p.joint.handle;
      for (let i = 0; i < 3; i++) {
        const a = AX[i];
        const tgt = clamp(2 * Math.asin(clamp(qt[a], -1, 1)), p.lim[a][0], p.lim[a][1]);
        raw.jointConfigureMotorPosition(h, 3 + i, tgt, k, dmp);
      }
    }
  }

  /** External "balance assist" torque on a part toward a world rotation. */
  assistRotation(name, qTarget, wn, dt, maxT = 400, onlyTilt = false) {
    const b = this.parts[name].body;
    const q = this.quat(name, _q);
    rotVec(_q2.copy(qTarget).multiply(q.invert()), _v);
    if (onlyTilt) _v.y = 0;
    const I = 12; // approximate whole-body inertia seen about the pelvis
    const w = tv(b.angvel(), _w);
    if (onlyTilt) w.y = 0;
    const t = _v.multiplyScalar(I * wn * wn).addScaledVector(w, -2 * I * wn);
    const m = t.length();
    if (m > maxT) t.multiplyScalar(maxT / m);
    b.applyTorqueImpulse(t.multiplyScalar(dt), true);
  }
  /**
   * The part a push on `name` actually lands on: a severed ghost (0.01 kg, next to no inertia)
   * would take any real force as thousands of m/s and blow the whole physics world up, so it
   * goes to the stump it hangs off instead. (Hits for a part that's gone come in over the
   * network, from someone who hadn't seen the cut yet; hands and muscles may still ask too.)
   */
  live(name) {
    let p = this.parts[name];
    while (p && p.gone && p.parent) p = p.parent;
    return p && !p.gone ? p : null;
  }
  force(name, f, dt) {
    const p = this.live(name);
    if (p) p.body.applyImpulse(_v.copy(f).multiplyScalar(dt), true);
  }
  impulseAt(name, imp, point) {
    const p = this.live(name);
    if (!p || !Number.isFinite(imp.x + imp.y + imp.z + point.x + point.y + point.z)) return;
    p.body.applyImpulseAtPoint(imp, point, true);
  }
  /**
   * After each step, with cuts: the ghosts ride along with what they hang from. Anything that
   * still got flung (or went non-finite) is put back before it can wreck the broad phase.
   */
  guard() {
    if (!this.cutAny || !this.active) return;
    for (const p of this.list) {
      if (!p.gone) continue;
      const b = p.body, v = b.linvel(), w = b.angvel(), t = b.translation();
      const pb = p.parent.body, pv = pb.linvel();
      const bad = !Number.isFinite(v.x + v.y + v.z + w.x + w.y + w.z + t.x + t.y + t.z);
      const dv = Math.hypot(v.x - pv.x, v.y - pv.y, v.z - pv.z);
      const pt = pb.translation();
      // (a ghost torn well away from what it hangs off: back on it)
      if (!bad && Math.hypot(t.x - pt.x, t.y - pt.y, t.z - pt.z) > 1.5) {
        b.setTranslation(pt, false); b.setLinvel(pv, false); b.setAngvel(pb.angvel(), false);
        continue;
      }
      if (bad) {
        b.setTranslation(pt, false); b.setRotation(pb.rotation(), false);
      }
      if (bad || dv > 25) b.setLinvel(pv, false);
      if (bad || Math.hypot(w.x, w.y, w.z) > 60) b.setAngvel(pb.angvel(), false);
    }
  }
}
