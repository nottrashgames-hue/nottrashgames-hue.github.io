import * as THREE from 'three';
import { carMats } from './carmodel.js';
import { tyreMat, TYRE_SECTORS } from './carstain.js';
import { DRY_T } from './dry.js';

/*
  Bloody tyres. Each wheel carries blood on 24 sectors round its tread. Rolling through a wet
  pool (or over a bleeding body) loads the sector touching the ground; every step the sector in
  contact prints a tread track and gives up part of its load, so the tracks repeat once per
  turn of the wheel and fade out over the next few dozen metres. A locked or sliding wheel
  smears one long streak instead and dumps its blood fast.

  Tyre blood dries like everything else: each sector ages from its last fresh load, prints
  less and less as it gets tacky, then turns into a brown crust that no longer prints and only
  slowly wears off the tread as the wheel rolls.
*/

const N = TYRE_SECTORS, TAU = Math.PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const STEP = 0.09;        // m between printed steps while rolling
const TRACK_W = 0.19;
const _cp = V(), _v = V(), _h = V(), UP = V(0, 1, 0);

const sectorAt = (rot) => {
  // the ground touches the tread at angle rot - pi/2 in the wheel's own frame (see tyreMat)
  const a = ((rot - Math.PI / 2) / TAU + 0.5) % 1;
  return Math.floor((a < 0 ? a + 1 : a) * N) % N;
};

function state(car) {
  return (car.tyres ||= car.S.wheels.map(() => ({ sec: new Float32Array(N), age: new Float32Array(N), dry: new Float32Array(N), last: null, odo: 0, rot: 0, mat: null, bodyT: 0 })));
}

export function resetTyres(car) {
  if (!car.tyres) return;
  for (const T of car.tyres) { T.sec.fill(0); T.age.fill(0); T.dry.fill(0); T.last = null; }
}

/** One frame for one car's wheels: pick blood up, print it back down. */
export function tyreFrame(car, dt, floor, actors) {
  const ctl = car.ctl, S = car.S, W = state(car);
  const nearBodies = car.speed > 0.4 ? actors.filter((a) => a.mode === 'ragdoll' && a.wounds
    && Math.abs(a.hero.pos.x - car.p.x) < S.hl + 1 && Math.abs(a.hero.pos.z - car.p.z) < S.hl + 1) : null;
  for (let i = 0; i < W.length; i++) {
    const T = W[i];
    const rot = ctl.wheelRotation(i) || 0;
    const dRot = rot - T.rot;
    T.rot = rot;
    const c = ctl.wheelIsInContact(i) ? ctl.wheelContactPoint(i) : null;
    if (!c) { T.last = null; continue; }
    _cp.set(c.x, c.y, c.z);
    const s = sectorAt(rot), sec = T.sec;
    // fresh blood on the ground here
    const wet = floor.wetAt(_cp);
    if (wet > 0.01) {
      const got = floor.pickup(_cp, Math.min(wet, 0.05 + car.speed * dt * 0.6));
      if (got > 0) for (let k = -1; k <= 1; k++) { const j = (s + k + N) % N; sec[j] = Math.min(1, sec[j] + got * (k ? 0.9 : 1.6)); T.age[j] = 0; }
    }
    // rolling over someone lying there bleeding
    if (nearBodies?.length && (T.bodyT -= dt) <= 0) {
      for (const a of nearBodies) for (const p of a.rd.list) {
        const t = p.body.translation();
        if ((t.x - _cp.x) ** 2 + (t.z - _cp.z) ** 2 > 0.16 || t.y - _cp.y > 0.45) continue;
        const part = a.wounds.parts[p.name];
        const load = 0.12 + (part?.wet || 0) * 0.6 + (a.wounds.wounds.length ? 0.2 : 0);
        for (let k = -2; k <= 2; k++) { const j = (s + k + N) % N; sec[j] = Math.min(1, sec[j] + load * (k ? 0.5 : 1)); T.age[j] = 0; }
        if (part) part.wet = Math.min(1, part.wet + 0.2);
        T.bodyT = 0.12;
      }
    }
    if (!T.last) { T.last = _cp.clone(); continue; }
    const d = Math.hypot(_cp.x - T.last.x, _cp.z - T.last.z);
    // sliding? compare the ground speed along the wheel with how fast it is turning
    car.velAt(_cp, _v).setY(0);
    const steer = i < 2 ? car.steerA : 0;
    _h.copy(car.fwd).setY(0).normalize().applyAxisAngle(UP, steer);
    const vf = _v.dot(_h), vl = Math.sqrt(Math.max(0, _v.lengthSq() - vf * vf));
    const slip = Math.abs(vf - (dt > 0 ? dRot / dt : 0) * S.r);
    const skid = vl > 2.2 || (slip > 3 && _v.length() > 2);
    if (d > 2) { T.last.copy(_cp); continue; } // teleported (reset)
    if (d < (skid ? 0.05 : STEP)) continue;
    // the sector that was on the ground over this step prints
    const js = skid ? s : sectorAt(rot - dRot * 0.5);
    // drying blood gets tacky: less and less of it comes off
    const tack = (j) => sec[j] * (1 - T.age[j]);
    const load = (tack(js) * 2 + tack((js + 1) % N) + tack((js + N - 1) % N)) / 4;
    if (load > 0.015) {
      floor.tyre(T.last, _cp, TRACK_W, load, T.odo, skid);
      if (skid) {
        const k = Math.exp(-d * 2.2);
        for (let j = -2; j <= 2; j++) sec[(js + j + N) % N] *= k;
      } else {
        sec[js] *= 0.68;
        sec[(js + 1) % N] *= 0.85; sec[(js + N - 1) % N] *= 0.85;
      }
    }
    // a dried crust slowly wears off the tread
    const wear = Math.exp(-d / 250);
    for (let j = 0; j < N; j++) T.dry[j] *= wear;
    T.odo += d;
    T.last.copy(_cp);
  }
  return tyreDry(car, dt);
}

/** Every frame, awake or parked: tyre blood ages and dries; the tread shows what it carries. */
export function tyreDry(car, dt) {
  const W = car.tyres;
  if (!W) return false;
  const S = car.S;
  let any = false;
  for (let i = 0; i < W.length; i++) {
    const T = W[i];
    let m = 0;
    for (let j = 0; j < N; j++) {
      if (T.sec[j] > 0.005) {
        T.sec[j] *= Math.exp(-dt / 240);
        T.age[j] += dt / DRY_T;
        if (T.age[j] >= 1) { T.dry[j] = Math.max(T.dry[j], T.sec[j]); T.sec[j] = 0; T.age[j] = 0; }
      } else T.age[j] = 0;
      m = Math.max(m, T.sec[j], T.dry[j]);
    }
    if (m > 0.02 && !T.mat) {
      T.mat = tyreMat(carMats().wheel, T.sec, T.age, T.dry, S.r, S.rimR);
      car.m.wheels[i].spin.material = T.mat;
    }
    any ||= m > 0.02;
  }
  return any;
}
