import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildCar, carShapes, SPECS, carMats, topAt } from './carmodel.js';
import { groups, G_WORLD, G_CAR, G_BODY, G_DEBRIS, G_QUERY } from './physics.js';
import { poseArm } from './gun.js';
import { knock } from './npc.js';
import { engineLoop } from './sfx.js';
import { CarStain } from './carstain.js';
import { tyreFrame, tyreDry, resetTyres } from './tyres.js';

/*
  Cars: a Rapier chassis (a hollow compound: floor, nose, tail, doors, roof, dash and seats, so
  bodies can slump inside or fly out through the windshield) on a raycast-wheel vehicle
  controller. Everyone in a seat is posed there each frame from the car's transform; when they
  go physical (shot, crash, bailing out) their ragdoll takes over with the car's velocity.

  Vehicles owns every car: player controls, crash detection and ejection, running people over,
  getting in / out / carjacking, and the far-away LOD swap. Traffic AI lives in traffic.js.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const CAR_MASS = 1300;
const REST = 0.3;                 // suspension rest length
const LOD_FAR = 30, LOD_NEAR = 27; // detailed model inside this range
const EJECT_DV = 9.5;             // m/s of frontal velocity lost in a frame that throws people out
const CAR_FILTER = G_WORLD | G_CAR | G_BODY | G_DEBRIS | G_QUERY;

const _v = V(), _v2 = V(), _v3 = V(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _worldUp = V(0, 1, 0), _bikeUp = V(), _bikeError = V(), _bikeOmega = V();
const _bikeBalance = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();

// ---------------------------------------------------------------- seated poses
// relative joint rotations (Euler XZY, left side; the right side mirrors z and y)
const E = (x, y = 0, z = 0) => ({ x, y, z });
const POSES = {
  driver: {
    pelvis: E(-0.28), spine: E(0.06), chest: E(0.06), head: E(0.2),
    thigh: E(-1.28, 0, 0.06), shin: E(1.2), foot: E(-0.1),
    upper: E(-0.9, 0, 0.1), fore: E(-0.8),
  },
  passenger: {
    pelvis: E(-0.3), spine: E(0.08), chest: E(0.06), head: E(0.22),
    thigh: E(-1.3, 0, 0.1), shin: E(1.45), foot: E(0.05),
    upper: E(-0.25, 0, 0.12), fore: E(-1.35),
  },
};
const relQ = {};
for (const [k, P] of Object.entries(POSES)) {
  relQ[k] = {};
  for (const [part, e] of Object.entries(P)) {
    for (const [side, s] of [['L', 1], ['R', -1]]) {
      relQ[k][part + side] = new THREE.Quaternion().setFromEuler(new THREE.Euler(e.x, e.y * s, e.z * s, 'XZY'));
    }
    relQ[k][part] = relQ[k][part + 'L'];
  }
}

// ---------------------------------------------------------------- a car
export class Car {
  constructor(sys, kind, color, pos, yaw, interior = 0) {
    this.sys = sys;
    this.kind = kind;
    this.color = color;
    this.crashes = 0;
    const S = this.S = SPECS[kind];
    const m = this.m = buildCar(kind, color, sys.env, interior);
    sys.scene.add(m.root);
    m.root.matrixAutoUpdate = false;
    m.root.matrixWorldAutoUpdate = false;
    this.home = { pos: pos.clone(), yaw };
    const w = sys.world;
    const q = _q.setFromAxisAngle(V(0, 1, 0), yaw);
    const L = S.L, H = 1.2, Wd = S.W;
    this.com = S.motorcycle ? V(0, 0.56, -0.02) : V(0, 0.48, S.semi ? -0.7 : 0.05);
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z).setRotation(q)
      .setAdditionalMassProperties(S.mass || CAR_MASS, this.com,
        { x: (S.mass || CAR_MASS) * (H * H + L * L) / 12, y: (S.mass || CAR_MASS) * (Wd * Wd + L * L) / 12, z: (S.mass || CAR_MASS) * (Wd * Wd + H * H) / 12 }, { x: 0, y: 0, z: 0, w: 1 })
      .setLinearDamping(0.02).setAngularDamping(0.5).setCanSleep(true));
    this.cols = [];
    for (const [hx, hy, hz, x, y, z] of carShapes(S)) {
      const c = w.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z)
        .setDensity(0).setFriction(0.45).setRestitution(0.12).setCollisionGroups(groups(G_CAR, CAR_FILTER)), this.body);
      this.cols.push(c);
      sys.carOf.set(c.handle, this);
    }
    // wheels
    const ctl = this.ctl = w.createVehicleController(this.body);
    ctl.indexUpAxis = 1;
    ctl.setIndexForwardAxis = 2;   // (a setter in this Rapier build)
    this.cy = S.r + REST * 0.8;
    S.wheels.forEach((wd, i) => {
      ctl.addWheel({ x: wd.x, y: this.cy, z: wd.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, REST, S.r);
      ctl.setWheelSuspensionStiffness(i, 32);
      ctl.setWheelSuspensionCompression(i, 2.6);
      ctl.setWheelSuspensionRelaxation(i, 3.4);
      ctl.setWheelFrictionSlip(i, wd.front ? 2.1 : 1.95);
      ctl.setWheelSideFrictionStiffness(i, 1);
      ctl.setWheelMaxSuspensionForce(i, 1e5);
      ctl.setWheelMaxSuspensionTravel(i, REST);
    });
    this.seats = S.seats.map((s, i) => ({ ...s, i, car: this, occ: null }));
    this.input = { throttle: 0, steer: 0, brake: 0, hand: false };
    this.steerA = 0;
    this.p = V(); this.q = new THREE.Quaternion(); this.v = V(); this.vPrev = V(); this.w = V();
    this.fwd = V(); this.speed = 0; this.fspeed = 0;
    this.detailed = true;
    this.m.lo.visible = false; // (both come built visible: never draw the two shells over each other)
    this.noBodyT = 0;
    this.hornT = 0;
    this.stand = { hero: { pos: this.p } }; // stands in for a driver when nobody's at the wheel
    this.read();
    this.vPrev.copy(this.v);
    this.sync(true);
  }

  get driver() { return this.seats[0].occ; }
  get yaw() { return Math.atan2(this.fwd.x, this.fwd.z); }

  read() {
    let t = this.body.translation(), r = this.body.rotation(), l = this.body.linvel(), a = this.body.angvel();
    // a physics blow-up (NaN / infinite state) would spread to everything this car touches:
    // put it back where it last was sane, at rest
    if (!Number.isFinite(t.x + t.y + t.z + r.x + r.y + r.z + r.w + l.x + l.y + l.z + a.x + a.y + a.z)) {
      const g = this.good || { p: this.home.pos, q: new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), this.home.yaw) };
      this.body.setTranslation(g.p, true);
      this.body.setRotation(g.q, true);
      if (!this.remote) { this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true); }
      if (this.netV && !this.netV.toArray().every(Number.isFinite)) this.netV.set(0, 0, 0);
      this.input = { throttle: 0, steer: 0, brake: 0, hand: false };
      this.steerA = 0;
      t = g.p; r = g.q; l = a = { x: 0, y: 0, z: 0 };
    } else {
      this.good ||= { p: V(), q: new THREE.Quaternion() };
      this.good.p.set(t.x, t.y, t.z); this.good.q.set(r.x, r.y, r.z, r.w);
    }
    this.p.set(t.x, t.y, t.z); this.q.set(r.x, r.y, r.z, r.w);
    this.v.set(l.x, l.y, l.z); this.w.set(a.x, a.y, a.z);
    if (this.remote && this.netV) { this.v.copy(this.netV); this.w.set(0, 0, 0); }
    this.fwd.set(0, 0, 1).applyQuaternion(this.q);
    this.speed = Math.hypot(this.v.x, this.v.z);
    this.fspeed = this.v.dot(this.fwd);
  }
  /** Car-frame point -> world. */
  toWorld(x, y, z, out = V()) { return out.set(x, y, z).applyQuaternion(this.q).add(this.p); }
  toLocal(p, out = V()) { return out.copy(p).sub(this.p).applyQuaternion(_q2.copy(this.q).invert()); }
  /** Velocity of the chassis at world point p. */
  velAt(p, out = V()) {
    const c = _v3.copy(this.com).applyQuaternion(this.q).add(this.p);
    return out.subVectors(p, c).cross(_v2.copy(this.w)).negate().add(this.v);
  }

  /** Each physics substep: controls into the wheels, drag, the controller. */
  /**
   * Someone else's simulation owns this car (multiplayer): the body follows their snapshots
   * as a kinematic, the wheels just roll with it.
   */
  setRemote(on) {
    on = !!on;
    if (on === !!this.remote) return;
    this.remote = on;
    this.spinA = 0;
    this.body.setBodyType(on ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Dynamic, true);
    this.body.wakeUp();
    this.dirty = true;
  }

  preStep(h) {
    if (this.remote) return;
    const b = this.body;
    const I = this.sys.damage ? this.sys.damage.input(this) : this.input, ctl = this.ctl;
    const active = I.throttle || I.brake || I.hand || Math.abs(I.steer) > 0.01 || this.driver;
    if (b.isSleeping()) {
      if (!active) {
        if (!this.S.motorcycle) return;
        const r = b.rotation();
        _q2.set(r.x, r.y, r.z, r.w);
        _bikeUp.set(0, 1, 0).applyQuaternion(_q2);
        if (_bikeUp.y > 0.999) return;
      }
      b.wakeUp();
    }
    if (this.S.motorcycle) {
      const r = b.rotation(), w = b.angvel();
      _q2.set(r.x, r.y, r.z, r.w);
      _bikeUp.set(0, 1, 0).applyQuaternion(_q2).normalize();
      _bikeBalance.setFromUnitVectors(_bikeUp, _worldUp);
      _bikeError.set(_bikeBalance.x, _bikeBalance.y, _bikeBalance.z).multiplyScalar(2);
      _bikeOmega.set(w.x, w.y, w.z).addScaledVector(_bikeUp, -_bikeOmega.dot(_bikeUp));
      _bikeError.multiplyScalar(700).addScaledVector(_bikeOmega, -420).multiplyScalar(h);
      b.applyTorqueImpulse(_bikeError, false);
    }
    const v = this.fspeed;
    const eng = I.throttle > 0 ? 3300 * I.throttle * Math.max(0, 1 - v / 44)
      : I.throttle < 0 ? 1600 * I.throttle * Math.max(0, 1 + v / 11) : 0;
    const noDriver = !this.driver && !I.throttle;
    const brake = I.brake * 9 + (noDriver && this.speed < 2 ? 3 : noDriver ? 0.4 : 0);
    for (let i = 0; i < this.S.wheels.length; i++) {
      const front = this.S.wheels[i].front;
      ctl.setWheelSteering(i, front ? this.steerA : 0);
      ctl.setWheelEngineForce(i, front ? 0 : eng);
      ctl.setWheelBrake(i, brake + (!front && I.hand ? 14 : 0));
      if (!front) ctl.setWheelFrictionSlip(i, I.hand ? 1.2 : 1.95);
    }
    // air drag and rolling resistance
    // (an awake body needs no waking: and `true` here restarted its sleep timer every substep, so a
    // parked car never slept - all of them were simulated, wheels and all, all the time)
    const l = b.linvel(), sp = Math.hypot(l.x, l.z);
    const k = (0.42 * sp + 14) * h;
    b.applyImpulse({ x: -l.x * k, y: 0, z: -l.z * k }, false);
    ctl.updateVehicle(h, undefined, groups(G_QUERY, G_WORLD));
  }

  /** Once per frame, after physics: steering smoothing, transforms onto the model. */
  sync(force = false) {
    const asleep = this.body.isSleeping();
    if (asleep && !force && !this.dirty) return;
    this.dirty = false;
    const M = this.m, root = M.root;
    root.position.copy(this.p);
    root.quaternion.copy(this.q);
    root.updateMatrix();
    if (this.detailed) {
      const ctl = this.ctl;
      if (this.remote) {
        for (let i = 0; i < M.wheels.length; i++) {
          const w = M.wheels[i], wd = this.S.wheels[i];
          w.position.set(wd.x, this.cy - REST * 0.8, wd.z);
          w.rotation.set(0, wd.front ? this.steerA : 0, 0);
          w.spin.rotation.x = this.spinA;
          w.spin.updateMatrix();
        }
      } else for (let i = 0; i < M.wheels.length; i++) {
        const w = M.wheels[i], wd = this.S.wheels[i];
        const sl = ctl.wheelSuspensionLength(i) ?? REST;
        w.position.set(wd.x, this.cy - sl, wd.z);
        w.rotation.set(0, ctl.wheelSteering(i) || 0, 0);
        w.spin.rotation.x = ctl.wheelRotation(i) || 0;
        w.spin.updateMatrix();
      }
      if (this.S.motorcycle) M.steer.rotation.y = this.steerA * 0.65;
      else M.steer.rotation.z = this.steerA * 5.5;
    }
    // the car's subtree is skipped by the scene's own update (parked cars never move): do it here
    root.matrixWorldAutoUpdate = true;
    root.updateMatrixWorld(true);
    root.matrixWorldAutoUpdate = false;
  }

  setDetail(on) {
    if (on === this.detailed) return;
    this.detailed = on;
    this.m.hi.visible = on;
    this.m.lo.visible = !on;
    this.dirty = true;
  }

  /** Seat -> the occupant's full-body pose in the world (FK from the pelvis). */
  seatPose(seat, out) {
    const a = seat.occ, rd = a.rd, defs = rd.defs;
    const R = relQ[seat.driver ? 'driver' : 'passenger'];
    for (const name of rd.names) {
      const o = (out[name] ||= { pos: V(), quat: new THREE.Quaternion() });
      const par = defs[name].parent;
      if (!par) {
        o.quat.copy(this.q).multiply(R.pelvis);
        this.toWorld(seat.x, seat.y, seat.z, o.pos);
      } else {
        o.quat.copy(out[par].quat).multiply(R[name]);
        o.pos.copy(defs[name].anchor).applyQuaternion(out[par].quat).add(out[par].pos);
      }
    }
    return out;
  }
  /** Hands on the steering wheel rim at ten to two. */
  handsOnWheel(h) {
    const S = this.S, n = _v.copy(S.wheelN).applyQuaternion(this.q);
    const up = V(0, 1, 0).applyQuaternion(this.q);
    const inPlaneUp = up.addScaledVector(n, -up.dot(n)).normalize();
    const left = V(1, 0, 0).applyQuaternion(this.q);
    const turn = this.steerA * 5.5;
    h.arms.forEach((a) => {
      const s = a.side;
      const ang = s * 1.05 + turn;             // from the top of the rim, toward this hand's side
      const c = this.toWorld(S.wheelC.x, S.wheelC.y, S.wheelC.z);
      const dir = V().addScaledVector(inPlaneUp, Math.cos(ang)).addScaledVector(left, Math.sin(ang) * 1).normalize();
      const pos = c.addScaledVector(dir, 0.19).addScaledVector(n, 0.035);
      // palm toward the rim's centre, fingers wrapping forward round it
      const X = dir.clone().multiplyScalar(-s).negate();
      const Y = n.clone();
      const Z = V().crossVectors(X, Y).normalize();
      X.crossVectors(Y, Z).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(_m4.makeBasis(X, Y, Z));
      const pole = V().addScaledVector(left, s * 0.8).add(V(0, -1, 0).applyQuaternion(this.q)).normalize();
      poseArm(h, a, pos, q, pole);
    });
  }

  /** Back where it started, in one piece. */
  reset() {
    const b = this.body, { pos, yaw } = this.home;
    b.setTranslation(pos, true);
    b.setRotation(_q.setFromAxisAngle(V(0, 1, 0), yaw), true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.input = { throttle: 0, steer: 0, brake: 0, hand: false };
    this.steerA = 0;
    this.m.windshield.visible = true;
    this.stain?.clear();
    resetTyres(this);
    this.crashes = 0;
    this.sys.damage?.restore(this);
    this.ai = null;
    this.read();
    this.vPrev.copy(this.v);
    this.sync(true);
  }

  setBodyCollisions(on) {
    for (const c of this.cols) c.setCollisionGroups(groups(G_CAR, on ? CAR_FILTER : CAR_FILTER & ~G_BODY));
  }
}

// ---------------------------------------------------------------- all the cars
export class Vehicles {
  constructor(scene, world, { env, sfx, colliders, camera }) {
    this.scene = scene; this.world = world; this.env = env; this.sfx = sfx;
    this.colliders = colliders; this.camera = camera;
    this.cars = [];
    this.carOf = new Map();       // collider handle -> car
    this.blood = null;            // set by main: tyres pick blood up from its floor
    this.shards = [];
    this.engine = null;
  }

  add(kind, color, pos, yaw, interior) {
    const c = new Car(this, kind, color, pos, yaw, interior);
    this.cars.push(c);
    return c;
  }

  preStep(h) { for (const c of this.cars) c.preStep(h); }

  // ---------- seats ----------
  /** Put actor a into car's seat (pulling out whoever is in it). */
  enter(a, car, seatIdx = 0) {
    const seat = car.seats[seatIdx];
    if (seat.occ && seat.occ !== a) this.pullOut(seat.occ, car, a);
    a.hero.action?.stand?.(true);
    a.hero.action = null;
    a.gunHeld?.drop();
    a.meleeHeldL?.drop(true);
    a.meleeHeld?.drop();
    a.hero.armHook = null;
    // ease from the standing pose into the seat
    a.postSnap = {};
    for (const k in a.cur) a.postSnap[k] = { pos: a.cur[k].pos.clone(), quat: a.cur[k].quat.clone() };
    a.postT = 0;
    seat.occ = a;
    a.seat = seat;
    a.mode = 'anim';
    car.body.wakeUp();
    this.sfx?.('door', 0.7);
  }

  /** Where someone climbing out of this seat stands: beside their door, else the other side. */
  exitSpot(car, seat) {
    const S = car.S, C = this.colliders;
    for (const side of [seat.side, -seat.side]) {
      const p = car.toWorld(side * (S.W / 2 + 0.55), 0, seat.z + 0.1);
      const gy = C.groundAt(p.x, p.z, p.y + 1.2);
      if (!C.blocked(p.x, p.z, gy + 0.05, 0.3)) return { p: p.setY(gy), side };
    }
    const p = car.toWorld(0, 0, car.S.hl + 0.8);
    return { p: p.setY(C.groundAt(p.x, p.z, p.y + 1.2)), side: seat.side };
  }

  /** Climb out (or, at speed, bail out and tumble). */
  exit(a) {
    const seat = a.seat;
    if (!seat) return;
    const car = seat.car;
    if (car.speed > 6) {
      // bail: out the door side and into the road with the car's momentum
      const side = V(seat.side, 0, 0).applyQuaternion(car.q);
      this.release(a, 'collapse', side.multiplyScalar(2.5).add(V(0, 1.5, 0)));
      return;
    }
    const { p } = this.exitSpot(car, seat);
    seat.occ = null;
    a.seat = null;
    a.postSnap = null;
    a.snap = {};
    for (const k in a.cur) a.snap[k] = { pos: a.cur[k].pos.clone(), quat: a.cur[k].quat.clone() };
    a.focusSnap = a.hero.pos.clone();
    a.hero.reset(p, car.yaw);
    a.blendT = 0;
    a.blendDur = 0.4;
    a.mode = 'blend';
    this.sfx?.('door', 0.6);
    if (seat.driver) this.abandon(car);
  }
  /** Nobody at the wheel any more: controls go slack, the AI's route is dropped. */
  abandon(car) {
    car.input = { throttle: 0, steer: 0, brake: 0, hand: false };
    car.ai = null;
  }

  /** Dragged out of the car (carjacked): lands beside it, shoved away. */
  pullOut(a, car, by = null) {
    const seat = a.seat;
    // someone else's body: their own client does the climbing out
    if (a.remote) { if (seat) { seat.occ = null; a.seat = null; } return; }
    this.exit(a);
    if (a.mode === 'blend') {
      const away = V(seat.side, 0, 0).applyQuaternion(car.q);
      a.mode = 'anim';
      a.hero.update(0.001, { move: V(), run: false, jump: false, camYaw: a.hero.yaw - Math.PI });
      a.capture(a.cur); a.capture(a.prev);
      a.shove(away);
    }
    a.onJacked?.(by);
  }

  /**
   * The occupant goes physical (shot, ejected, bailing): the ragdoll starts moving with the
   * car, plus `extra` (m/s).
   */
  release(a, kind = 'collapse', extra = null, vel = null) {
    const seat = a.seat;
    if (!seat || a.remote) return;
    const car = seat.car;
    seat.occ = null;
    a.seat = null;
    a.postSnap = null;
    if (car.driver === null && seat.driver) this.abandon(car);
    if (a.mode !== 'ragdoll') a.goRagdoll(kind === 'stumble' ? 'collapse' : kind);
    for (const p of a.rd.list) {
      const t = p.body.translation();
      const v = vel ? _v.copy(vel) : car.velAt(_v2.set(t.x, t.y, t.z), _v);
      if (extra) v.add(extra);
      p.body.setLinvel(v, true);
    }
    if (extra) { car.noBodyT = 0.4; car.setBodyCollisions(false); }
  }

  /** Nearest car door to p within reach: { car, seat }. */
  doorNear(p, reach = 1.6) {
    let best = null, bd = reach;
    for (const c of this.cars) {
      if (c.p.distanceToSquared(p) > 16) continue;
      const S = c.S;
      const seats = S.motorcycle ? c.seats : c.seats.slice(0, 2);
      for (const s of seats) {
        const d = c.toWorld(s.side * (S.W / 2 + 0.35), 0.9, s.z + 0.1, _v).distanceTo(_v2.set(p.x, p.y + 0.9, p.z));
        if (d < bd) { bd = d; best = { car: c, seat: s }; }
      }
    }
    return best;
  }

  playerCar() { return this._player?.seat?.car || null; }

  // ---------- per frame ----------
  /** After the world was stepped: crashes, hits, seated bodies, models. */
  after(dt, actors, player) {
    this._player = player;
    const cam = this.camera.position;
    const budget = { n: 2 }; // car stain uploads this frame
    for (const c of this.cars) {
      c.read();
      if (c.noBodyT > 0 && (c.noBodyT -= dt) <= 0) c.setBodyCollisions(true);
      // steering eases toward the input
      const maxA = 0.6 / (1 + c.speed * c.speed / 380);
      if (c.remote) {
        // steer angle comes with the snapshots; the wheels roll at the car's speed
        if (c.speed > 0.05) { c.spinA += c.fspeed * dt / c.S.r; c.dirty = true; }
      } else {
        const tgt = clamp(c.input.steer, -1, 1) * maxA;
        c.steerA += clamp(tgt - c.steerA, -3 * dt, 3 * dt);
        if (!c.body.isSleeping()) this.crash(c);
      }
      c.vPrev.copy(c.v);
      const d2 = cam.distanceToSquared(c.p);
      c.setDetail(c.detailed ? d2 < LOD_FAR * LOD_FAR : d2 < LOD_NEAR * LOD_NEAR);
      c.sync();
      const braking = c.input.brake > 0.05 || (c.driver && c.input.throttle < 0 && c.fspeed > 0.5);
      if (braking !== c.braking) { c.braking = braking; c.m.brake.material = braking ? carMats().brake : carMats().tail; }
      if (c.speed > 1.2) this.hitPeople(c, actors, dt);
      if (this.blood && !c.body.isSleeping()) tyreFrame(c, dt, this.blood.floor, actors);
      else tyreDry(c, dt);
      c.stain?.update(dt, budget);
      // a police car on a call: the lightbar flashes red / blue
      if (c.m.lights) {
        const L = c.m.lights, t = performance.now() / 1000;
        const on = c.siren ? (Math.floor(t * 6) % 2) : -1;
        L.red.material.emissiveIntensity = on === 0 ? 4 : 0.2;
        L.blue.material.emissiveIntensity = on === 1 ? 4 : 0.2;
      }
    }
    // everyone sitting in a car, posed where the car is now
    for (const a of actors) if (a.seat) this.seatFrame(a, dt);
    this.updateShards(dt);
    this.engineSound(player);
  }

  seatFrame(a, dt) {
    const seat = a.seat, car = seat.car, h = a.hero;
    const t = a.prev; a.prev = a.cur; a.cur = t;
    const pose = car.seatPose(seat, a._seatPose || (a._seatPose = {}));
    h.yaw = car.yaw;
    if (a.postSnap) {
      a.postT += dt / 0.35;
      if (a.postT >= 1) a.postSnap = null;
    }
    if (a.postSnap) a.blendInto(a.postSnap, pose, a.postT * a.postT * (3 - 2 * a.postT));
    else a.apply(pose);
    h.root.updateMatrixWorld(true);
    if (seat.driver) { car.handsOnWheel(h); a.setGrip([0.85, 0.85], dt); }
    else a.setGrip([0.35, 0.35], dt);
    a.capture(a.cur);
    // "where they are" for everyone else: over the seat, moving with the car
    h.pos.copy(pose.pelvis.pos).y -= 0.95;
    h.vel.copy(car.v);
    h.grounded = true;
  }

  /** A sudden loss of speed: the crunch, and whoever's inside keeps going. */
  crash(c) {
    const dvx = c.v.x - c.vPrev.x, dvz = c.v.z - c.vPrev.z;
    const dv = Math.hypot(dvx, dvz);
    if (dv < 3.5) return;
    this.sfx?.('crash', clamp((dv - 3) / 10, 0.15, 1));
    c.crashes++;
    this.damage?.hit(c, dv); // (carfire.js: hard hits wreck it)
    c.hornT = 0;
    const frontal = -(dvx * c.fwd.x + dvz * c.fwd.z);  // speed lost straight ahead
    if (frontal < EJECT_DV) return;
    // through the windshield
    let out = false;
    for (const s of c.seats) {
      const a = s.occ;
      if (!a || s.rear) continue;
      out = true;
      const vel = c.vPrev.clone().multiplyScalar(0.85);
      vel.y = Math.max(vel.y, 0) + 2.2 + Math.random();
      this.release(a, 'collapse', V(), vel);
      c.noBodyT = 0.45; c.setBodyCollisions(false);
      a.onEjected?.();
    }
    if (out || frontal > EJECT_DV * 1.4) this.shatter(c);
  }

  shatter(c) {
    if (!c.m.windshield.visible) return;
    c.m.windshield.visible = false;
    this.sfx?.('glass', 0.9);
    const S = c.S;
    const geo = this._shardGeo ||= new THREE.BoxGeometry(0.035, 0.004, 0.03);
    const mat = this._shardMat ||= new THREE.MeshStandardMaterial({ color: 0xcfe6ee, roughness: 0.1, metalness: 0.4, transparent: true, opacity: 0.7 });
    for (let i = 0; i < 40; i++) {
      const t = Math.random();
      const zy = [S.ws[0] + (S.rf[0] - S.ws[0]) * t, S.ws[1] + (S.rf[1] - S.ws[1]) * t];
      const m = new THREE.Mesh(geo, mat);
      c.toWorld((Math.random() - 0.5) * 2 * S.gx, zy[1], zy[0], m.position);
      m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      const v = c.vPrev.clone().multiplyScalar(0.6 + Math.random() * 0.3).add(V((Math.random() - 0.5) * 3, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 3));
      this.scene.add(m);
      this.shards.push({ m, v, t: 0, w: V(Math.random() * 20 - 10, Math.random() * 20 - 10, 0) });
    }
  }
  updateShards(dt) {
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.t += dt;
      if (s.m.position.y > 0.01) {
        s.v.y -= 9.81 * dt;
        s.m.position.addScaledVector(s.v, dt);
        s.m.rotation.x += s.w.x * dt; s.m.rotation.y += s.w.y * dt;
        if (s.m.position.y < 0.01) { s.m.position.y = 0.01; s.m.rotation.set(0, Math.random() * 6, 0); }
      }
      if (s.t > 25) { s.m.removeFromParent(); this.shards.splice(i, 1); }
    }
  }

  /** People on their feet in the car's path: hit hard enough, they go over the bonnet. */
  hitPeople(c, actors, dt = 1 / 60) {
    const S = c.S;
    for (const a of actors) {
      if (a.seat || a.remote || a.mode === 'ragdoll' || a.carHitT > 0) continue;
      const hp = a.hero.pos;
      if (Math.abs(hp.x - c.p.x) > 3.5 || Math.abs(hp.z - c.p.z) > 3.5) continue;
      const l = c.toLocal(_v.set(hp.x, hp.y + 0.5, hp.z), _v);
      const mx = S.W / 2 + 0.25 - Math.abs(l.x), mz = S.hl + 0.25 - Math.abs(l.z);
      if (mx < 0 || mz < 0 || l.y < -0.6 || l.y > 1.6) continue;
      // contact normal (car -> person) in the car frame, along the shallower overlap
      const nL = mz < mx ? V(0, 0, Math.sign(l.z)) : V(Math.sign(l.x), 0, 0);
      const n = nL.clone().applyQuaternion(c.q);
      const at = V(hp.x, hp.y + 0.55, hp.z);
      const cv = c.velAt(at, V());
      const rel = cv.dot(n) - a.hero.vel.dot(n);
      if (rel > 3) {
        // struck: legs taken out at bumper height, thrown with the car
        const part = Math.random() < 0.5 ? 'thighL' : 'thighR';
        const sev = clamp(rel / 9, 0.3, 2.2);
        a.struck(part, at, cv.clone().setY(0), n, { kind: 'blunt', mass: 22, sev, ref: 9, maxImp: 60 + rel * 30, dent: 0.35 }, c.driver || c.stand);
        if (a.mode === 'ragdoll') {
          for (const p of a.rd.list) {
            const lv = p.body.linvel();
            const low = p.kind === 'thigh' || p.kind === 'shin' || p.kind === 'foot';
            const k = low ? 0.9 : 0.55;
            p.body.setLinvel({ x: lv.x + cv.x * k, y: lv.y + rel * (low ? 0.12 : 0.22) + 0.6, z: lv.z + cv.z * k }, true);
          }
          if (rel > 13 && a.organs && Math.random() < (rel - 13) / 12) a.organs.die();
        }
        a.carHitT = 0.6;
        if (rel > 5 && !a.wounds?.dry) this.bloodOnCar(c, l, nL, rel);
        a.onKnocked?.(c.driver || c.stand);
        this.sfx?.('bat', clamp(rel / 12, 0.3, 1));
        if (c.driver?.isPlayer) this.sfx?.('flesh', 0.6);
      } else if (rel > 1.4) {
        knock(a, cv.clone().setY(0), rel * 1.4, 0);
        a.carHitT = 0.8;
        a.onKnocked?.(c.driver || c.stand);
      } else {
        // slow: they're just pushed along out of the way
        const push = Math.min(mx, mz) * (1 - 0.5 ** (dt * 60));
        hp.addScaledVector(n.setY(0), push);
      }
    }
  }

  /**
   * Someone struck hard: blood where they met the car (l: their position in the car frame, nL
   * the side they were hit by), and up over the bonnet or boot where they rolled.
   */
  bloodOnCar(c, l, nL, rel) {
    const S = c.S, st = (c.stain ||= new CarStain(c));
    const sev = Math.min(1, (rel - 5) / 10);
    const p = V(), v = V();
    const n = 2 + Math.round(sev * 6);
    for (let i = 0; i < n; i++) {
      if (nL.z) {
        // along the face and back over the bonnet / boot
        const back = (i / n) * (0.4 + sev * 0.9);
        p.set(clamp(l.x + (Math.random() - 0.5) * 0.5, -S.W / 2 + 0.1, S.W / 2 - 0.1), 0, nL.z * (S.hl - back));
        p.y = back < 0.06 ? 0.45 + Math.random() * 0.2 : topAt(S, p.z) + 0.02;
        v.set(0, 0, -nL.z * rel);
      } else {
        p.set(nL.x * (S.W / 2), 0.45 + Math.random() * 0.45, clamp(l.z + (Math.random() - 0.5) * 0.7, -S.hl, S.hl));
        v.set(-nL.x * rel, 0, 0);
      }
      st.splat(p, v, 0.02 + sev * 0.03, 0.6 + sev * 0.4);
    }
  }

  /** Characters walking into a stopped car are kept outside it. */
  keepOut(actors, dt) {
    for (const a of actors) {
      if (a.carHitT > 0) a.carHitT -= dt;
      if (a.seat || a.mode === 'ragdoll') continue;
      const hp = a.hero.pos;
      for (const c of this.cars) {
        if (Math.abs(hp.x - c.p.x) > 3.2 || Math.abs(hp.z - c.p.z) > 3.2) continue;
        const S = c.S;
        const l = c.toLocal(_v.set(hp.x, hp.y + 0.5, hp.z), _v);
        if (l.y < -0.6 || l.y > 1.5) continue;
        const r = 0.28;
        const mx = S.W / 2 + r - Math.abs(l.x), mz = S.hl + r - Math.abs(l.z);
        if (mx <= 0 || mz <= 0) continue;
        if (mx < mz) l.x += Math.sign(l.x) * mx; else l.z += Math.sign(l.z) * mz;
        l.applyQuaternion(c.q).add(c.p);
        hp.x = l.x; hp.z = l.z;
      }
    }
  }

  engineSound(player) {
    const car = player?.seat?.car;
    if (!car) { this.engine?.set(0, 1); return; }
    this.engine ||= engineLoop('engine');
    const rpm = 0.8 + Math.min(1.6, Math.abs(car.fspeed) / 16) + Math.abs(car.input.throttle) * 0.25;
    this.engine.set(0.28 + Math.abs(car.input.throttle) * 0.25, rpm);
  }

  clear() {
    for (const s of this.shards) s.m.removeFromParent();
    this.shards.length = 0;
  }
}
