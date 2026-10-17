import * as THREE from 'three';
import { label } from './doorhint.js';

/*
  Driving in VR. On foot: squeeze a grip with your hand on a car's door handle to get in.
  In the seat: your eyes ride in the driver's head, turning with the car; squeeze a grip with a
  hand on the steering wheel's rim to take hold of it and turn it for real (one hand or two);
  the right trigger is the gas, the left trigger brakes (then reverses); B gets you out.
  Let go of the wheel and it straightens itself.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const EYE = V(0, 0.09, 0.075);   // (vr.js: between the eyes, in the head's frame)
const SEAT_FWD = 0.22;           // m your eyes sit ahead of the driver's (closer to the wheel)
const MAX_TURN = 3.3;            // rad of wheel for full lock (vehicle.js: steer angle x 5.5)
const HANDS = ['left', 'right'];
const TAU = Math.PI * 2;
const wrap = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
const _a = V(), _b = V(), _pole = V();

export class VRDrive {
  constructor(vr) {
    this.vr = vr;
    this.grip = { left: null, right: null }; // each hand's angle round the rim while it holds it
    this.off = { left: 0, right: 0 };         // where on the rim it took hold, in the wheel's own turn
    this.sq = { left: false, right: false };
    this.turn = 0;
    this.seat = null;      // the seat the view was last lined up in
    this.anchor = V();     // where your real head was then (rig space)
    this.rel = 0;          // the rig's yaw from the car's
    this.t = performance.now();
  }

  handPos(hand, out) {
    const s = this.vr.hands[hand];
    return s?.grip.visible ? out.setFromMatrixPosition(s.grip.matrixWorld) : null;
  }

  /** The wheel in the world: centre, face normal, and the rim's up / left in its plane. */
  wheel(car) {
    const S = car.S;
    if (!S.wheelC) return null;
    const c = car.toWorld(S.wheelC.x, S.wheelC.y, S.wheelC.z, V());
    const n = S.wheelN.clone().applyQuaternion(car.q);
    const up = V(0, 1, 0).applyQuaternion(car.q);
    up.addScaledVector(n, -up.dot(n)).normalize();
    const left = V(1, 0, 0).applyQuaternion(car.q);
    left.addScaledVector(n, -left.dot(n)).normalize();
    return { c, n, up, left };
  }

  /** Start of the frame. Returns true while you're in a car (the sticks and B are ours then). */
  input() {
    const vr = this.vr, A = vr.hero;
    const now = performance.now(), dt = Math.min(0.05, (now - this.t) / 1000);
    this.t = now;
    const held = {}, pressed = {};
    for (const h of HANDS) { const v = vr.btnVal(h, 1) > 0.5; pressed[h] = v && !this.sq[h]; this.sq[h] = held[h] = v; }
    this.hint = null;
    if (!A.seat) {
      this.grip.left = this.grip.right = null;
      A.hero.wheelGrip = null;
      this.turn = 0;
      this.seat = null;
      if (A.brain?.dead || vr.uiOpen()) return false;
      // a car door near either hand: shown (doorhint.js), ready once it's in reach
      let bd = Infinity;
      for (const h of HANDS) {
        const p = this.handPos(h, _a);
        const door = p && !vr.held[h] && vr.doorNear?.(_b.copy(p).setY(p.y - 0.9), 1.4);
        if (!door) continue;
        const S = door.car.S, d = door.car.toWorld(door.seat.side * (S.W / 2 + 0.35), 0.9, door.seat.z + 0.1, V()).distanceTo(p);
        if (d < bd) { bd = d; this.hint = { ...door, ready: d < 0.55, vr: true }; }
      }
      // a squeeze on a door handle: in
      for (const h of HANDS) {
        if (!pressed[h] || vr.held[h]) continue;
        const p = this.handPos(h, _a);
        if (!p) continue;
        const door = vr.doorNear?.(_b.copy(p).setY(p.y - 0.9));
        if (door && vr.enterCar?.(door)) { vr.buzz(h, 0.5, 60); return true; }
      }
      return false;
    }
    vr.move.x = vr.move.y = 0;
    vr.run = false;
    // B: out
    if (vr.edge('right', 5)) {
      vr.exitCar?.();
      vr.recentre = 6;
      this.grip.left = this.grip.right = null;
      return true;
    }
    const seat = A.seat, car = seat.car;
    // or a squeeze on the inside door handle (by your side, a hand not on the wheel)
    {
      const S = car.S, handle = car.toWorld(seat.side * (S.W / 2 - 0.14), (seat.y || 0.6) + 0.35, seat.z + 0.3, V());
      for (const h of HANDS) {
        if (!pressed[h] || this.grip[h] !== null) continue;
        const p = this.handPos(h, _a);
        if (p && p.distanceTo(handle) < 0.25) {
          vr.exitCar?.();
          vr.recentre = 6;
          this.grip.left = this.grip.right = null;
          return true;
        }
      }
    }
    if (!seat.driver) return true;
    const F = this.wheel(car);
    let sum = 0, n = 0;
    for (const h of HANDS) {
      const p = F && held[h] ? this.handPos(h, _a) : null;
      if (!p) { this.grip[h] = null; continue; }
      const d = p.sub(F.c), axial = d.dot(F.n);
      d.addScaledVector(F.n, -axial);
      const r = d.length(), ang = Math.atan2(d.dot(F.left), d.dot(F.up));
      if (this.grip[h] === null) {
        // take hold: the squeeze with the hand on (or near) the rim
        if (pressed[h] && Math.abs(axial) < 0.18 && r > 0.05 && r < 0.38) {
          this.grip[h] = ang;
          this.off[h] = ang - (car.steerA || 0) * 5.5; // (anywhere round it: top, bottom, either side)
          vr.buzz(h, 0.35, 40);
        }
        continue;
      }
      const da = r < 0.03 ? 0 : wrap(ang - this.grip[h]); // (through the hub: no angle to go by)
      this.grip[h] = ang;
      sum += da; n++;
    }
    // (vehicle.js handsOnWheel: each held hand stays on the rim where it took hold)
    A.hero.wheelGrip = [this.grip.left !== null ? this.off.left : null, this.grip.right !== null ? this.off.right : null];
    if (n) this.turn = Math.max(-MAX_TURN, Math.min(MAX_TURN, this.turn + sum / n));
    else this.turn *= Math.exp(-dt * 2.5);
    // (main.js drive(): steer = -x, the gas / brake from y)
    vr.move.x = -this.turn / MAX_TURN;
    vr.move.y = vr.btnVal('right', 0) - vr.btnVal('left', 0);
    // a buzz in the hands on the wheel, with the engine
    const hum = Math.min(1, Math.abs(car.fspeed) / 30);
    if (hum > 0.05) for (const h of HANDS) if (this.grip[h] !== null && Math.random() < 0.15) vr.buzz(h, 0.04 + hum * 0.12, 20);
    return true;
  }

  /** The rig in the car: your eyes in the driver's, facing the way the car does. */
  place() {
    const vr = this.vr, A = vr.hero, seat = A.seat, car = seat.car, h = A.hero, cam = vr.camera;
    if (this.seat !== seat && cam.position.lengthSq() > 1e-6) {
      // (lined up once, getting in: wherever you're facing and standing for real is the seat)
      this.seat = seat;
      const d = _a.set(0, 0, -1).applyQuaternion(cam.quaternion);
      this.rel = Math.PI - Math.atan2(-d.x, -d.z);
      this.anchor.copy(cam.position);
    }
    vr.rigYaw = car.yaw + this.rel;
    vr.rig.quaternion.setFromAxisAngle(UP, vr.rigYaw);
    h.head.updateWorldMatrix(true, false);
    const E = _a.copy(EYE).applyMatrix4(h.head.matrixWorld);
    E.x += car.fwd.x * SEAT_FWD; E.z += car.fwd.z * SEAT_FWD;
    vr.rig.position.copy(E).sub(_b.copy(this.anchor).applyQuaternion(vr.rig.quaternion));
    vr.rig.updateMatrixWorld(true);
  }

  /** Every frame: knocked down (and alive), a tag in front of your eyes - A to get up. */
  after() {
    const vr = this.vr, A = vr.hero, down = A.mode === 'ragdoll' && !A.brain?.dead && !A.seat;
    if (down && !this.upTag) {
      this.upTag = label('Press A to get up');
      this.upTag.scale.set(0.32, 0.08, 1);
      this.upTag.position.set(0, -0.12, -0.7);
      vr.camera.add(this.upTag);
    }
    if (this.upTag) this.upTag.visible = down;
  }

  /** Just before render: a hand that isn't on the wheel goes where your real hand is. */
  frame() {
    const vr = this.vr, A = vr.hero, h = A.hero, seat = A.seat;
    const fwd = h.forward(V()), right = V(-fwd.z, 0, fwd.x);
    const pole = (a) => _pole.copy(right).multiplyScalar(a.side > 0 ? -0.7 : 0.7).addScaledVector(UP, -0.8).addScaledVector(fwd, -0.25).normalize();
    for (const [i, hand] of [[0, 'left'], [1, 'right']]) {
      const slot = vr.hands[hand];
      if (!slot?.grip.visible || (seat.driver && this.grip[hand] !== null)) { vr.letGo(hand); continue; }
      vr.freeNow[hand] = false;
      vr.freeHand(h, slot, h.arms[i], pole, hand, 0);
      if (!vr.freeNow[hand]) vr.letGo(hand);
    }
  }
}
