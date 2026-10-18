import * as THREE from 'three';
import { DIM } from './character.js';
import { solveTwoBone, orient } from './ik.js';
import { HELD_ITEMS } from './strike.js';
import { buildGun, buildMag, buildRifleMag, buildShell, buildMGMag, buildSMGMag, SMG_MAG_LEN, buildDMRMag, buildSniperMag, buildRocketMag, ROCKET_MAG_LEN, MG_MAG_LEN, DMR_MAG_LEN, SNIPER_MAG_LEN, CASE_GEO, CASE_MAT, SHELL_GEO, SHELL_MAT, MUZZLE, PORT, MAG_LEN, MAG_AXIS, RIFLE_MAG_LEN, RIFLE_MAG_AXIS, GRIP_TILT } from './gunmodel.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Q = () => new THREE.Quaternion();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const rnd = (a, b) => a + Math.random() * (b - a);
const seg = (t, a, b) => smooth((t - a) / (b - a));

const UP = V(0, 1, 0);

/** Build a transform from basis columns + origin (all in the parent frame). */
function frame(x, y, z, o) {
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  m.setPosition(o);
  return m;
}
// Hand frames (wrist origin; palm across local Z, fingers down local -Y; palm normal = -side * X).
// Right hand wrapped around the grip, relative to the gun.
const gc = Math.cos(GRIP_TILT), gs = Math.sin(GRIP_TILT);
const RIGHT_GRIP = frame(V(1, 0, 0), V(0, gs, -gc), V(0, gc, gs), V(-0.03, -0.022, -0.064));
// Support hand: palm on the left of the grip, fingers wrapping over the shooting hand, a little lower.
const LEFT_GRIP = (() => {
  const t = GRIP_TILT + 0.35, c = Math.cos(t), s = Math.sin(t);
  return frame(V(1, 0, 0), V(0, s, -c), V(0, c, s), V(0.036, -0.03, -0.046));
})();
// Left hand cupping a magazine's base plate (relative to the magazine).
const LEFT_ON_MAG = frame(V(0, -1, 0), V(0, 0, -1), V(1, 0, 0), V(0, -MAG_LEN - 0.03, -0.046));
// Left hand over the rear of the slide, palm down (relative to the gun).
const LEFT_RACK = frame(V(0, 1, 0), V(1, 0, 0), V(0, 0, -1), V(0.046, 0.064, 0.004));

// ---- the guns: pistol, AR (full auto) and pump shotgun ----
const RIFLE_CASE = new THREE.CylinderGeometry(0.0048, 0.0048, 0.045, 8);
const BIG_CASE = new THREE.CylinderGeometry(0.0062, 0.0062, 0.07, 8);
// (a straight box magazine, dropped straight down; the left hand cups its base)
const onMag = (len) => frame(V(0, -1, 0), V(0, 0, -1), V(1, 0, 0), V(0, -len - 0.02, -0.02));
const DOWN = V(0, -1, 0);
export const GUNS = {
  pistol: {
    name: 'Pistol', cap: 12, cool: 0.12, auto: false, pellets: 1, spread: 0, sound: 'shot', kick: 1, push: 1,
    muzzle: MUZZLE, port: PORT, magLen: MAG_LEN, magAxis: MAG_AXIS, buildMag, travel: 0.042,
    leftGrip: LEFT_GRIP, leftOnMag: LEFT_ON_MAG, leftRack: LEFT_RACK,
    shape: { box: [0.014, 0.035, 0.09] }, offset: V(0, 0.005, 0.06), mass: 0.7, lie: 0.014,
    caseGeo: CASE_GEO, caseMat: CASE_MAT, caseShape: { cyl: [0.0095, 0.0046] }, caseMass: 0.008,
  },
  rifle: {
    name: 'Assault Rifle', cap: 30, cool: 0.095, auto: true, pellets: 1, spread: 0.006, sound: 'rifle', kick: 0.45, push: 0.8, long: true,
    muzzle: V(0, 0.03, 0.64), port: V(-0.018, 0.034, 0.09), magLen: RIFLE_MAG_LEN, magAxis: RIFLE_MAG_AXIS, buildMag: buildRifleMag, travel: 0.05,
    leftGrip: frame(V(0, -1, 0), V(1, 0, 0), V(0, 0, 1), V(0.044, -0.03, 0.29)),
    leftOnMag: frame(V(0, -1, 0), V(0, 0, -1), V(1, 0, 0), V(0, -RIFLE_MAG_LEN - 0.02, -0.02)),
    leftRack: frame(V(0, 1, 0), V(1, 0, 0), V(0, 0, -1), V(0.04, 0.085, -0.03)),
    shape: { box: [0.02, 0.05, 0.46] }, offset: V(0, 0.01, 0.18), mass: 3.2, lie: 0.022,
    caseGeo: RIFLE_CASE, caseMat: CASE_MAT, caseShape: { cyl: [0.0225, 0.0048] }, caseMass: 0.012,
  },
  shotgun: {
    name: 'Shotgun', cap: 6, cool: 0.25, auto: false, pellets: 9, spread: 0.05, sound: 'shotgun', kick: 1.7, push: 1.8, long: true, pump: true,
    muzzle: V(0, 0.034, 0.75), port: V(-0.019, 0.03, 0.08), magLen: 0, magAxis: V(0, -1, 0), buildMag: null, travel: 0.09,
    leftGrip: frame(V(0, -1, 0), V(1, 0, 0), V(0, 0, 1), V(0.047, -0.028, 0.34)),
    shape: { box: [0.02, 0.05, 0.52] }, offset: V(0, 0.01, 0.22), mass: 3.4, lie: 0.022,
    caseGeo: SHELL_GEO, caseMat: SHELL_MAT, caseShape: { cyl: [0.032, 0.0105] }, caseMass: 0.03,
  },
  smg: {
    name: 'Submachine Gun', cap: 32, cool: 0.08, auto: true, pellets: 1, spread: 0.012, sound: 'rifle', kick: 0.34, push: 0.62, long: true,
    muzzle: V(0, 0.03, 0.59), port: V(-0.018, 0.03, 0.1), magLen: SMG_MAG_LEN, magAxis: DOWN, buildMag: buildSMGMag, travel: 0.04,
    leftGrip: frame(V(0, -1, 0), V(1, 0, 0), V(0, 0, 1), V(0.043, -0.03, 0.29)),
    leftOnMag: onMag(SMG_MAG_LEN),
    leftRack: frame(V(0, 1, 0), V(1, 0, 0), V(0, 0, -1), V(0.04, 0.07, -0.02)),
    shape: { box: [0.022, 0.05, 0.39] }, offset: V(0, 0.01, 0.16), mass: 2.7, lie: 0.022,
    caseGeo: RIFLE_CASE, caseMat: CASE_MAT, caseShape: { cyl: [0.0225, 0.0048] }, caseMass: 0.01,
  },
  // belt-fed: a long burst, a lot of climb; heavy to hold
  mg: {
    name: 'Machine Gun', cap: 100, cool: 0.075, auto: true, pellets: 1, spread: 0.014, sound: 'mg', kick: 0.6, push: 1.1, long: true,
    muzzle: V(0, 0.03, 0.85), port: V(-0.026, 0.03, 0.12), magLen: MG_MAG_LEN, magAxis: DOWN, buildMag: buildMGMag, travel: 0.06,
    leftGrip: frame(V(0, -1, 0), V(1, 0, 0), V(0, 0, 1), V(0.05, -0.012, 0.36)),
    leftOnMag: onMag(MG_MAG_LEN),
    leftRack: frame(V(0, 1, 0), V(1, 0, 0), V(0, 0, -1), V(-0.04, 0.06, 0.2)),
    shape: { box: [0.03, 0.06, 0.56] }, offset: V(0, 0.01, 0.28), mass: 9, lie: 0.03,
    caseGeo: RIFLE_CASE, caseMat: CASE_MAT, caseShape: { cyl: [0.0225, 0.0048] }, caseMass: 0.012,
  },
  // semi-auto, scoped: one well-placed round at a time
  dmr: {
    name: 'DMR', cap: 20, cool: 0.2, auto: false, pellets: 1, spread: 0, sound: 'dmr', kick: 1.05, push: 1.2, long: true, zoom: 0.55,
    muzzle: V(0, 0.03, 0.87), port: V(-0.018, 0.034, 0.09), magLen: DMR_MAG_LEN, magAxis: DOWN, buildMag: buildDMRMag, travel: 0.05,
    leftGrip: frame(V(0, -1, 0), V(1, 0, 0), V(0, 0, 1), V(0.046, -0.03, 0.36)),
    leftOnMag: onMag(DMR_MAG_LEN),
    leftRack: frame(V(0, 1, 0), V(1, 0, 0), V(0, 0, -1), V(0.04, 0.085, -0.03)),
    shape: { box: [0.022, 0.06, 0.6] }, offset: V(0, 0.02, 0.28), mass: 4.8, lie: 0.024,
    caseGeo: BIG_CASE, caseMat: CASE_MAT, caseShape: { cyl: [0.035, 0.0062] }, caseMass: 0.016,
  },
  // bolt action: the bolt's worked after every shot (the long cool is the hand doing it)
  sniper: {
    name: 'Sniper Rifle', cap: 5, cool: 1.15, auto: false, pellets: 1, spread: 0, sound: 'sniper', kick: 2.2, push: 2.2, long: true, zoom: 0.3, bolt: true,
    muzzle: V(0, 0.042, 0.88), port: V(-0.02, 0.045, 0.1), magLen: SNIPER_MAG_LEN, magAxis: DOWN, buildMag: buildSniperMag, travel: 0.08,
    leftGrip: frame(V(0, -1, 0), V(1, 0, 0), V(0, 0, 1), V(0.05, -0.024, 0.33)),
    leftOnMag: onMag(SNIPER_MAG_LEN),
    leftRack: frame(V(0, 1, 0), V(1, 0, 0), V(0, 0, -1), V(-0.05, 0.03, 0.02)),
    shape: { box: [0.024, 0.07, 0.6] }, offset: V(0, 0.02, 0.26), mass: 6.5, lie: 0.03,
    caseGeo: BIG_CASE, caseMat: CASE_MAT, caseShape: { cyl: [0.035, 0.0062] }, caseMass: 0.018,
  },
  // launchers: the round is a real thing in flight (throwables.js PROJECTILES), not a bullet
  rocket: {
    name: 'Rocket Launcher', cap: 1, cool: 0.6, auto: false, pellets: 1, spread: 0, sound: 'rocket', kick: 1.3, push: 2.4, long: true,
    projectile: 'rocket', noCase: true, noDrop: true,
    muzzle: V(0, 0.1, 0.78), port: V(0, 0.1, -0.4), magLen: ROCKET_MAG_LEN, magAxis: V(0, 0, 1), buildMag: buildRocketMag, travel: 0.001,
    leftGrip: frame(V(0, -1, 0), V(1, 0, 0), V(0, 0, 1), V(0.03, -0.03, 0.28)),
    leftOnMag: frame(V(0, -1, 0), V(0, 0, -1), V(1, 0, 0), V(0, -ROCKET_MAG_LEN * 0.5, -0.05)),
    leftRack: frame(V(0, 1, 0), V(1, 0, 0), V(0, 0, -1), V(0.05, 0.16, -0.1)),
    shape: { box: [0.05, 0.07, 0.5] }, offset: V(0, 0.08, 0.06), mass: 7, lie: 0.05,
    caseGeo: BIG_CASE, caseMat: CASE_MAT, caseShape: { cyl: [0.035, 0.0062] }, caseMass: 0.018,
  },
  gl: {
    name: 'Grenade Launcher', cap: 4, cool: 0.45, auto: false, pellets: 1, spread: 0, sound: 'launch', kick: 1.5, push: 1.6, long: true, pump: true,
    projectile: 'grenade40',
    muzzle: V(0, 0.044, 0.6), port: V(-0.024, 0.03, 0.08), magLen: 0, magAxis: V(0, -1, 0), buildMag: null, travel: 0.09,
    leftGrip: frame(V(0, -1, 0), V(1, 0, 0), V(0, 0, 1), V(0.05, -0.024, 0.33)),
    shape: { box: [0.03, 0.06, 0.42] }, offset: V(0, 0.02, 0.18), mass: 4, lie: 0.03,
    caseGeo: SHELL_GEO, caseMat: CASE_MAT, caseShape: { cyl: [0.032, 0.0105] }, caseMass: 0.03,
  },
};

GUNS.deagle = { ...GUNS.pistol, name: 'Desert Eagle', cap: 7, cool: 0.28, sound: 'dmr', kick: 1.9, push: 1.8, mass: 1.9, shape: { box: [0.018, 0.045, 0.12] }, caseShape: { cyl: [0.011, 0.006] }, caseMass: 0.016 };
GUNS.m1911 = { ...GUNS.pistol, name: 'Colt M1911', cap: 7, cool: 0.19, sound: 'shot', kick: 1.05, push: 1.1, mass: 1.05 };
GUNS.ak47 = { ...GUNS.rifle, name: 'AK-47', cap: 30, cool: 0.105, spread: 0.009, kick: 0.62, push: 1.0, mass: 3.8 };
GUNS.ak74 = { ...GUNS.rifle, name: 'AK-74', cap: 30, cool: 0.09, spread: 0.007, kick: 0.52, push: 0.92, mass: 3.4 };

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _p = V(), _q = Q(), _s = V();
const _sh = V(), _el = V(), _end = V(), _pole = V(), _hint = V(), _fq = Q();

const _out = V(), _pole2 = V(), _el2 = V(), _fa = V(), _ua = V();
/** Is this arm's elbow buried in the torso (chest space: ribs out to ~0.2 m each side)? */
function elbowInside(h, a) {
  h.chest.worldToLocal(_el2.copy(a.elbow));
  return a.side * _el2.x < 0.215 && _el2.y > -0.36 && _el2.y < 0.26 && _el2.z > -0.15 && _el2.z < 0.16;
}

/** Two-bone IK the arm so its hand lands at wrist `pos` with world rotation `quat`. */
export function poseArm(h, a, pos, quat, pole) {
  h.chest.localToWorld(_sh.set(a.side * 0.185, 0.2, -0.015));
  solveTwoBone(_sh, pos, h.D.UPPER_ARM, h.D.FOREARM, pole, a.elbow, _end);
  // keep the elbow out of the torso: swing the pole outward until it clears the ribs
  _out.set(a.side, 0, 0).transformDirection(h.chest.matrixWorld);
  for (let k = 0; k < 5 && elbowInside(h, a); k++) {
    _pole2.copy(pole).addScaledVector(_out, 0.6 * (k + 1)).normalize();
    solveTwoBone(_sh, pos, h.D.UPPER_ARM, h.D.FOREARM, _pole2, a.elbow, _end);
  }
  _hint.set(0, 0, 1).applyQuaternion(quat);      // thumb side: the forearm rolls to meet it
  const fwd = h.forward(V());
  // the upper arm's roll: the inside of the elbow faces the forearm, as it does - smooth whatever
  // the hand is turning (the old forward/thumb hint swung it round half a turn in a frame as a
  // chop went over the top: a twitch); a near-straight arm keeps the old hint (and its last roll)
  const fa = _fa.subVectors(_end, a.elbow).normalize(), ua = _ua.subVectors(a.elbow, _sh).normalize();
  const bent = clamp((1 - Math.abs(fa.dot(ua))) * 5, 0, 1);
  const uh = fwd.lerp(_hint, 0.3).multiplyScalar(1 - bent).addScaledVector(fa, bent);
  orient(a.upper, _sh, a.elbow, uh, true);
  orient(a.fore, a.elbow, _end, _hint, true);
  a.hand.quaternion.copy(a.fore.quaternion).invert().multiply(quat);
}
function curl(a, c, index = c) {
  a.fingers.forEach(([f1, f2], j) => {
    const k = j === 0 ? index : c;
    f1.rotation.z = -(k + j * 0.05);
    f2.rotation.z = -(k * 1.1 + j * 0.04);
  });
  a.thumb[1].rotation.z = -c * 0.5;
}
/** Current world wrist position + rotation of an arm (as locomotion left it). */
function readHand(a, pos, quat) {
  a.hand.updateWorldMatrix(true, false);
  a.hand.matrixWorld.decompose(pos, quat, _s);
  return pos;
}

/** Shared material for the muzzle glow: a warm radial falloff, added over whatever is behind. */
let GLOW = null;
function glowMat() {
  if (GLOW) return GLOW;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,220,160,0.9)');
  grad.addColorStop(0.25, 'rgba(255,176,96,0.45)');
  grad.addColorStop(1, 'rgba(255,150,60,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  GLOW = new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: true });
  return GLOW;
}

export class Gun {
  constructor(scene, table, debris, sfx, type = 'pistol') {
    this.scene = scene;
    this.debris = debris;
    this.sfx = sfx;
    this.type = type;
    const M = this.M = GUNS[type];
    this.auto = M.auto;
    this.pumpT = -1;         // shotgun: working the pump (s), -1 when not
    this.boltT = -1;         // bolt action: working the bolt (s), -1 when not
    const { gun, slide, mag, magWell } = buildGun(type);
    this.mesh = gun;
    HELD_ITEMS.add(this); // (in a hand, it's in the way of blows: strike.js parry)
    this.slide = slide;
    this.mag = mag;          // mesh currently in the well (null while out)
    this.magWell = magWell;
    scene.add(gun);

    // resting on the table, lying on its right side
    this.restPos = V(table.x - 0.15, table.top + 0.014, table.z + 0.05);
    this.restQuat = Q().setFromEuler(new THREE.Euler(0, 0.6, -Math.PI / 2, 'YXZ'));
    this.state = 'rest';
    this.owner = null;
    this.loose = null;       // debris item while dropped
    this.placeRest();

    this.ammo = M.cap;       // rounds in the magazine (the shotgun's tube)
    this.chambered = true;
    this.slideBack = 0;      // 0..1 (1 = locked open)
    this.cycleT = 1;
    this.locked = false;
    this.cool = 0;
    this.recoil = { a: 0, va: 0, z: 0, vz: 0, r: 0, vr: 0 };
    this.aim = false;
    this.aimW = 0;
    this.raise = 0;          // seconds of "shots fired, stay up"
    this.aimPoint = V();
    this.pickT = 0;
    this.reloadT = -1;
    this.newMag = null;
    this.onFire = null;      // (origin, dir) => void
    this.lastPos = V();
    this.vel = V();

    // muzzle flash
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.flash = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.16), flashMat);
      p.rotation.set(Math.PI / 2, 0, (i * Math.PI) / 3);
      p.position.z = 0.07;
      this.flash.add(p);
    }
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), flashMat);
    this.flash.add(core);
    this.flash.position.copy(M.muzzle);
    if (M.long) this.flash.scale.setScalar(1.4);
    this.flash.visible = false;
    gun.add(this.flash);
    // no PointLight: even at intensity 0 it makes every standard material in the city light
    // it, every pixel, every frame (and adding/removing one per shot recompiles shaders).
    // A soft additive glow billboard around the muzzle sells the flash instead.
    this.glow = new THREE.Sprite(glowMat());
    this.glow.scale.setScalar(0.55);
    this.glow.position.copy(M.muzzle).z += 0.05;
    this.glow.visible = false;
    gun.add(this.glow);
    this.flashT = 0;
  }

  placeRest() {
    this.mesh.position.copy(this.restPos);
    this.mesh.quaternion.copy(this.restQuat);
  }

  /** Back on the table, loaded, as at the start. Call after debris.clear(). */
  reset() {
    const actor = this.owner;
    this.abortReload();
    if (actor) { actor.hero.armHook = null; actor.gunHeld = null; }
    this.owner = null;
    this.loose = null;
    this.state = 'rest';
    if (this.mesh.parent !== this.scene) this.scene.add(this.mesh);
    this.placeRest();
    if (this.mag) this.mag.removeFromParent();
    this.mag = null;
    if (this.M.buildMag) { this.mag = this.M.buildMag(true); this.magWell.add(this.mag); this.mag.position.set(0, 0, 0); }
    this.ammo = this.M.cap;
    this.pumpT = -1; this.boltT = -1;
    this.chambered = true;
    this.locked = false;
    this.slideBack = 0;
    this.cycleT = 1;
    this.cool = this.raise = this.flashT = 0;
    this.aim = false; this.aimW = 0;
    this.flash.visible = false;
    this.glow.visible = false;
    for (const k in this.recoil) this.recoil[k] = 0;
  }

  worldPos(out = V()) { return this.mesh.getWorldPosition(out); }

  /** E: pick up if close enough, or drop what we hold. */
  interact(actor) {
    if (this.state === 'held') { if (this.owner === actor) this.drop(); return; }
    if (actor.mode !== 'anim') return;
    if (actor.hero.look?.noGuns) return; // (a body that can't hold one: the queen bee, special.js)
    if (actor.organs && !actor.organs.canHold(1)) return; // shooting arm is broken
    const d = this.worldPos(V()).sub(actor.hero.pos);
    if (Math.hypot(d.x, d.z) > 1.4 || d.y > 1.6) return;
    this.pickFrom = { pos: this.mesh.position.clone(), quat: this.mesh.quaternion.clone() };
    if (this.loose) { this.debris.release(this.loose); this.loose = null; }
    this.state = 'held';
    this.owner = actor;
    actor.gunHeld = this;
    this.pickT = 0;
    this.reloadT = -1;
    actor.hero.armHook = (h, dt) => this.poseHeld(h, dt);
    this.sfx?.('pickup', 0.7);
  }

  drop() {
    const actor = this.owner;
    if (!actor) return;
    actor.hero.armHook = null;
    actor.gunHeld = null;
    this.owner = null;
    this.state = 'loose';
    this.abortReload();
    this.mesh.updateMatrixWorld(true);
    this.looseAt(this.mesh.position, this.mesh.quaternion, this.vel.clone().clampLength(0, 6), V(rnd(-4, 4), rnd(-4, 4), rnd(-4, 4)));
  }

  /** Lying loose (a physics body) at pos / quat, moving at vel / angVel. */
  looseAt(pos, quat, vel, angVel) {
    if (this.loose) { this.debris.release(this.loose); this.loose = null; }
    if (this.mesh.parent !== this.scene) this.scene.add(this.mesh);
    this.mesh.visible = true;
    this.state = 'loose';
    const M = this.M;
    this.loose = this.debris.add(this.mesh, M.shape, {
      pos: pos.clone(), quat: quat.clone(), vel, angVel,
      mass: M.mass, restitution: 0.2, sound: 'drop', kind: 'gun', offset: M.offset,
    });
  }

  fire() {
    const M = this.M;
    // a shotgun with one in the chamber can cut its reload short to shoot
    if (M.pump && this.reloadT >= 0 && this.chambered && this.cool <= 0) this.abortReload();
    if (this.state !== 'held' || this.pickT < 1 || this.reloadT >= 0 || this.cool > 0 || this.pumpT >= 0) return;
    // (time overrun past the last cooldown is kept: full auto fires at its real rate, not snapped to frames)
    this.cool = M.cool + Math.min(0, this.cool);
    this.raise = 1.6;
    if (!this.chambered) { this.sfx?.('dry', 0.7); return; }
    // the bullet goes from the muzzle toward what the crosshair is on
    const origin = this.mesh.localToWorld(M.muzzle.clone());
    const aim = this.aimPoint.clone().sub(origin);
    if (aim.lengthSq() < 0.01) aim.set(0, 0, 1).applyQuaternion(this.mesh.quaternion);
    aim.normalize();
    const up = V(0, 1, 0), side = V().crossVectors(aim, up).normalize(), up2 = V().crossVectors(side, aim);
    // shaky, weak hands: the round goes where the swaying muzzle points, not the crosshair
    if (this.sway && (this.sway[0] || this.sway[1])) aim.addScaledVector(side, this.sway[0]).addScaledVector(up2, this.sway[1]).normalize();
    for (let i = 0; i < M.pellets; i++) {
      const dir = aim.clone();
      if (M.spread) {
        const a = Math.random() * Math.PI * 2, r = M.spread * Math.sqrt(Math.random());
        dir.addScaledVector(side, Math.cos(a) * r).addScaledVector(up2, Math.sin(a) * r).normalize();
      }
      this.onFire?.(origin, dir, this.owner, this);
    }
    this.sfx?.(M.sound, 1);
    // recoil: muzzle flips up, gun drives back, a touch of roll
    const R = this.recoil;
    R.va += rnd(9, 12) * M.kick;
    R.vz += 1.6 * M.push;
    R.vr += rnd(-2, 2) * M.kick;
    this.flashT = 0.045;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(rnd(0.8, 1.25) * (M.long ? 1.4 : 1));
    this.owner?.hero && (this.owner.recoilKick = 1);
    // shotgun: work the pump to eject and chamber the next
    if (M.pump) { this.chambered = false; this.spent = true; this.pumpT = 0; return; }
    // bolt action: the case stays in until the bolt's worked (update)
    if (M.bolt) this.boltT = 0;
    // (a rocket: the warhead's gone out of the front, nothing comes out of the side)
    else if (M.noCase) { if (this.mag) this.mag.visible = false; }
    // cycle: eject the spent case, strip the next round if there is one
    else this.ejectCase();
    if (this.ammo > 0) { this.ammo--; this.chambered = true; this.cycleT = 0; }
    else { this.chambered = false; this.locked = true; this.cycleT = 0; }
  }

  ejectCase() {
    const m = this.mesh;
    m.updateMatrixWorld(true);
    const M = this.M;
    const pos = m.localToWorld(M.port.clone());
    const right = V(-1, 0, 0).transformDirection(m.matrixWorld);
    const up = V(0, 1, 0).transformDirection(m.matrixWorld);
    const back = V(0, 0, -1).transformDirection(m.matrixWorld);
    const vel = this.vel.clone()
      .addScaledVector(right, rnd(2.2, 3.4)).addScaledVector(up, rnd(1.4, 2.4)).addScaledVector(back, rnd(0.2, 0.8));
    const quat = m.quaternion.clone().multiply(_fq.setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)));
    const mesh = new THREE.Mesh(M.caseGeo, M.caseMat);
    mesh.castShadow = true;
    this.debris.add(mesh, M.caseShape, {
      pos, quat, vel, angVel: V(rnd(-30, 30), rnd(-40, 40), rnd(-30, 30)),
      mass: M.caseMass, restitution: 0.45, friction: 0.5, sound: 'casing', kind: 'casing', cap: 60, inst: true,
    });
  }

  reload() {
    if (this.state !== 'held' || this.pickT < 1 || this.reloadT >= 0) return;
    if (this.ammo === this.M.cap && this.chambered) return;
    if (this.M.pump && this.ammo === this.M.cap) { if (this.pumpT < 0) { this.spent = false; this.pumpT = 0.15; } return; }
    this.reloadT = 0;
    this.racks = this.locked || !this.chambered;
    this.dropped = false;
    this.seated = false;
  }

  abortReload() {
    if (this.reloadT < 0) return;
    this.reloadT = -1;
    if (this.newMag) { this.newMag.removeFromParent(); this.newMag = null; }
    if (!this.mag && this.M.buildMag) { this.mag = this.M.buildMag(this.ammo > 0); this.magWell.add(this.mag); this.mag.position.set(0, 0, 0); }
    // (the shotgun: rounds loaded so far stay in; one still needed in the chamber gets pumped)
    if (this.M.pump && !this.chambered && this.ammo > 0 && this.pumpT < 0) { this.spent = false; this.pumpT = 0.15; }
  }

  /** Magazine leaves the well and becomes a physics prop. */
  releaseMag() {
    const old = this.mag;
    if (!old) return;
    // (the spent rocket's nothing to drop)
    if (this.M.noDrop) { old.removeFromParent(); this.mag = null; this.ammo = 0; return; }
    old.updateWorldMatrix(true, false);
    const pos = V(), quat = Q();
    old.matrixWorld.decompose(pos, quat, _s);
    this.scene.add(old);
    old.position.copy(pos);
    old.quaternion.copy(quat);
    const M = this.M;
    const axis = M.magAxis.clone().transformDirection(this.mesh.matrixWorld);
    this.debris.add(old, { box: [M.long ? 0.012 : 0.0105, M.magLen / 2, M.long ? 0.03 : 0.016] }, {
      pos, quat, vel: this.vel.clone().addScaledVector(axis, 1.4), angVel: V(rnd(-3, 3), rnd(-2, 2), rnd(-3, 3)),
      mass: M.long ? 0.25 : 0.1, restitution: 0.25, sound: 'mag', kind: 'mag', cap: 12, offset: V(0, -M.magLen / 2, 0),
    });
    this.mag = null;
    this.ammo = 0;
    this.sfx?.('magout', 0.8);
  }

  /** Per-frame bookkeeping (before the owner's animation update). */
  update(dt) {
    this.cool = Math.max(-dt, this.cool - dt);
    this.raise = Math.max(0, this.raise - dt);
    // the owner going limp throws the gun
    if (this.state === 'held' && this.owner.mode !== 'anim') this.drop();
    // spring the recoil back
    const R = this.recoil;
    // stiff springs: fixed small substeps so long frames can't blow them up
    const n = Math.ceil(dt / (1 / 240)), h = dt / n;
    for (let i = 0; i < n; i++) {
      R.va += (-R.a * 260 - R.va * 26) * h; R.a += R.va * h;
      R.vz += (-R.z * 420 - R.vz * 34) * h; R.z += R.vz * h;
      R.vr += (-R.r * 200 - R.vr * 22) * h; R.r += R.vr * h;
    }
    // slide: snaps back and runs home (or stays locked open on an empty mag)
    this.cycleT += dt;
    let sb = 0;
    if (this.cycleT < 0.09) sb = this.cycleT < 0.025 ? this.cycleT / 0.025 : 1 - (this.cycleT - 0.025) / 0.065;
    if (this.locked && this.cycleT > 0.025) sb = 0.85;
    if (this.rackPull !== undefined) sb = Math.max(sb, this.rackPull);
    // the bolt: once the recoil's settled, back (the case flies), then forward on the next
    if (this.boltT >= 0 && this.M.bolt) {
      if (this.cycleT < 0.09) sb = 0;
      const t0 = this.boltT, t = (this.boltT += dt);
      if (t0 < 0.3 && t >= 0.3) this.sfx?.('bolt', 0.8);
      if (t0 < 0.48 && t >= 0.48) this.ejectCase();
      sb = t < 0.3 ? 0 : t < 0.46 ? (t - 0.3) / 0.16 : t < 0.62 ? 1 : t < 0.8 ? 1 - (t - 0.62) / 0.18 : 0;
      if (this.locked && t > 0.5) sb = Math.max(sb, 0.85);
      if (t >= 0.8) this.boltT = -1;
    }
    // the pump: back (the spent shell flies out), then forward (the next one's in)
    if (this.pumpT >= 0) {
      const t0 = this.pumpT, t = (this.pumpT += dt);
      if (t0 < 0.22 && t >= 0.22) this.sfx?.('pump', 0.8);
      if (t0 < 0.33 && t >= 0.33 && this.spent !== false) this.ejectCase();
      sb = t < 0.22 ? 0 : t < 0.36 ? (t - 0.22) / 0.14 : t < 0.5 ? 1 - (t - 0.36) / 0.14 : 0;
      if (t >= 0.5) {
        this.pumpT = -1;
        if (this.ammo > 0) { this.ammo--; this.chambered = true; }
      }
    }
    this.slideBack = sb;
    this.slide.position.z = -this.M.travel * clamp(sb, 0, 1);
    // flash
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    this.glow.visible = this.flash.visible;
    if (this.state === 'held') {
      this.pickT = Math.min(1, this.pickT + dt / 0.45);
      const up = this.aim || this.raise > 0 || this.reloadT >= 0;
      this.aimW = lerp(this.aimW, up ? 1 : 0, damp(this.raise > 0 && !this.aim ? 18 : 10, dt));
      if (this.reloadT >= 0) this.stepReload(dt);
    }
    if (this.state === 'loose' && this.loose?.body.isSleeping()) this.loose.lastV.set(0, 0, 0);
  }

  stepReload(dt) {
    if (this.M.pump) return this.stepShells(dt);
    const t0 = this.reloadT;
    const t = (this.reloadT += dt);
    if (t0 < 0.14 && t >= 0.14) this.releaseMag();
    if (t0 < 0.3 && t >= 0.3) {
      // hand reaches the pouch: a fresh magazine appears in it
      this.newMag = this.M.buildMag(true);
      this.newMag.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.scene.add(this.newMag);
    }
    if (t0 < 1.02 && t >= 1.02 && this.newMag) {
      // seated
      this.newMag.removeFromParent();
      this.magWell.add(this.newMag);
      this.newMag.position.set(0, 0, 0);
      this.newMag.quaternion.identity();
      this.mag = this.newMag;
      this.newMag = null;
      this.ammo = this.M.cap;
      this.sfx?.('magin', 0.9);
      this.recoil.va -= 3;
    }
    if (this.racks) {
      if (t0 < 1.38 && t >= 1.38) this.sfx?.('rackback', 0.8);
      if (t0 < 1.5 && t >= 1.5) {
        this.locked = false;
        this.rackPull = undefined;
        this.cycleT = 0.03;           // slide slams home
        this.ammo--; this.chambered = true;
        this.sfx?.('rack', 0.9);
        this.recoil.va += 2;
      }
    }
    if (t >= (this.racks ? 1.8 : 1.35)) { this.reloadT = -1; this.rackPull = undefined; }
  }

  /** Shotgun reload: a shell at a time from the belt into the loading port, then pump one in. */
  stepShells(dt) {
    const t0 = this.reloadT, t = (this.reloadT += dt), M = this.M;
    if (t0 < 0.22 && t >= 0.22) {
      this.newMag = buildShell();
      this.newMag.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.scene.add(this.newMag);
    }
    if (t0 < 0.5 && t >= 0.5) {
      if (this.newMag) { this.newMag.removeFromParent(); this.newMag = null; }
      this.ammo = Math.min(M.cap, this.ammo + 1);
      this.sfx?.('shell', 0.8);
      this.recoil.va -= 1;
    }
    if (t >= 0.62) {
      if (this.ammo < M.cap) this.reloadT = 0.02;
      else {
        this.reloadT = -1;
        if (!this.chambered) { this.spent = false; this.pumpT = 0.15; }
      }
    }
  }

  /** Gun world pose for the current stance, into `m`. */
  heldPose(h, m) {
    const chest = h.chest.localToWorld(V(0, 0.19, 0.02));
    const yaw = h.yaw;
    const fwd = V(Math.sin(yaw), 0, Math.cos(yaw));
    const right = V(-Math.cos(yaw), 0, Math.sin(yaw)); // character's right (side -1)
    // aim: arms out, sights on the aim point
    const long = this.M.long;
    // (a long gun is shouldered: the grip in close under the eye, the stock against the shoulder)
    // (a pistol: both arms out in front, the gun up at chin height on the body's centre line)
    const aimPos = long ? chest.clone().addScaledVector(fwd, 0.35).addScaledVector(UP, 0.045).addScaledVector(right, 0.1)
      : chest.clone().addScaledVector(fwd, 0.5).addScaledVector(UP, 0.06).addScaledVector(right, 0.005);
    // aim as yaw/pitch relative to the body, clamped and smoothed, so a crosshair sliding over
    // something close, off to the side or behind can't whip or roll the gun around
    const to = this.aimPoint.clone().sub(aimPos);
    let yawOff = 0, pitch = 0;
    if (to.lengthSq() > 0.36) {
      const f = to.dot(fwd), r = to.dot(right);
      yawOff = f > 0.05 ? clamp(Math.atan2(r, f), -0.3, 0.3) : 0;
      pitch = clamp(Math.atan2(to.y, Math.hypot(f, r)), -1.1, 1.1);
    }
    const k = Math.min(1, (this._dt || 0.016) * 25);
    this.aimYaw = lerp(this.aimYaw ?? 0, yawOff, k);
    this.aimPitch = lerp(this.aimPitch ?? 0, pitch, k);
    // weak from blood loss: the sights won't hold still
    const wk = this.owner?.organs?.weak || 0;
    this.swayT = (this.swayT || 0) + (this._dt || 0.016);
    const st = this.swayT;
    this.sway = wk > 0.02 ? [
      wk * 0.06 * (Math.sin(st * 1.9) + 0.5 * Math.sin(st * 4.7 + 2)),
      wk * 0.05 * (Math.sin(st * 1.4 + 1) + 0.5 * Math.sin(st * 5.3)),
    ] : [0, 0];
    const ay = this.aimYaw + this.sway[0], ap = this.aimPitch + this.sway[1];
    const cp = Math.cos(ap);
    const aimDir = fwd.clone().multiplyScalar(Math.cos(ay) * cp)
      .addScaledVector(right, Math.sin(ay) * cp).addScaledVector(UP, Math.sin(ap));
    // low ready: tucked in, muzzle to the floor ahead
    const lowPos = long ? chest.clone().addScaledVector(fwd, 0.3).addScaledVector(UP, -0.16).addScaledVector(right, 0.1)
      : chest.clone().addScaledVector(fwd, 0.37).addScaledVector(UP, -0.21).addScaledVector(right, 0.03);
    const lowDir = long ? fwd.clone().addScaledVector(UP, -0.6).addScaledVector(right, -0.15).normalize()
      : fwd.clone().multiplyScalar(0.6).addScaledVector(UP, -0.8).normalize();
    // reload: brought in close, canted, muzzle up a little
    this.rlW = lerp(this.rlW || 0, this.M.pump && this.reloadT >= 0 ? 1 : 0, damp(8, this._dt || 0.016));
    const rl = this.M.pump ? this.rlW
      : this.reloadT >= 0 ? seg(this.reloadT, 0, 0.14) * (1 - seg(this.reloadT, this.racks ? 1.6 : 1.12, this.racks ? 1.8 : 1.35)) : 0;
    const rlPos = long ? chest.clone().addScaledVector(fwd, 0.34).addScaledVector(UP, -0.12).addScaledVector(right, 0.07)
      : chest.clone().addScaledVector(fwd, 0.35).addScaledVector(UP, -0.17).addScaledVector(right, 0.02);
    const rlDir = fwd.clone().addScaledVector(UP, long ? 0.12 : 0.35).addScaledVector(right, long ? -0.3 : -0.15).normalize();

    const w = this.aimW;
    const pos = lowPos.lerp(aimPos, w).lerp(rlPos, rl);
    const dir = lowDir.lerp(aimDir, w).lerp(rlDir, rl).normalize();
    const R = this.recoil;
    // basis: +Z along dir, up as close to world up as possible, then recoil + cant
    const z = dir;
    const x = V().crossVectors(UP, z).normalize();
    const y = V().crossVectors(z, x);
    m.makeBasis(x, y, z).setPosition(pos);
    _m2.makeRotationZ(R.r * 0.3 - rl * 0.55).premultiply(_m.makeRotationX(-R.a * 0.5));
    _m2.setPosition(0, 0, -R.z * 0.06);
    m.multiply(_m2);
    return m;
  }

  /** Character arm hook: place the gun and pose both arms onto it. */
  poseHeld(h, dt) {
    this._dt = dt;
    // aiming up or down, the trunk bends with it (the gun pivoting alone in front of an upright
    // body looked stiff): spine and chest take part of the pitch, as much as the gun is up
    const tp = (this.aimPitch || 0) * this.aimW;
    if (Math.abs(tp) > 1e-4) {
      h.spine.rotation.x -= tp * 0.18;
      h.chest.rotation.x -= tp * 0.27;
      h.spine.updateMatrixWorld(true);
    }
    const gm = this.heldPose(h, this._gm || (this._gm = new THREE.Matrix4()));
    const aR = h.arms[1], aL = h.arms[0];
    const locoR = readHand(aR, V(), Q()), locoRq = aR.hand.getWorldQuaternion(Q());
    const locoL = readHand(aL, V(), Q()), locoLq = aL.hand.getWorldQuaternion(Q());

    // picking up: right hand goes to the gun where it lies, then brings it up
    const pt = this.pickT;
    const reach = smooth(pt / 0.5), lift = smooth((pt - 0.45) / 0.55);
    if (lift < 1 && this.pickFrom) {
      const rest = _m.compose(this.pickFrom.pos, this.pickFrom.quat, _s.set(1, 1, 1));
      const a = V(), qa = Q(), b = V(), qb = Q();
      rest.decompose(a, qa, _s); gm.decompose(b, qb, _s);
      gm.compose(a.lerp(b, lift), qa.slerp(qb, lift), _s.set(1, 1, 1));
    }
    gm.decompose(this.mesh.position, this.mesh.quaternion, _s);
    this.mesh.updateMatrixWorld(true);
    const p = this.mesh.position;
    this.vel.copy(p).sub(this.lastPos).divideScalar(Math.max(dt, 1e-3));
    if (this.vel.length() > 30) this.vel.set(0, 0, 0);
    this.lastPos.copy(p);

    const fwd = h.forward(V());
    const right = V(-fwd.z, 0, fwd.x); // character's right (body frame x = left)
    // right hand: on the grip
    _m.multiplyMatrices(gm, RIGHT_GRIP).decompose(_p, _q, _s);
    _p.lerp(locoR, 1 - reach);
    _q.slerp(locoRq, 1 - reach);
    // (elbows: a pistol held out has them down and only a little out; a shouldered long gun lifts
    // the firing elbow out to the side)
    const pw = this.M.long ? 0 : this.aimW;
    _pole.copy(right).multiplyScalar(lerp(1.0, 0.55, pw)).addScaledVector(UP, lerp(-0.8, -1.0, pw)).addScaledVector(fwd, -0.05).normalize();
    poseArm(h, aR, _p, _q, _pole);
    curl(aR, lerp(0.4, 1.35, reach), lerp(0.4, 0.75, reach));

    // left hand: support grip, or whatever the reload needs
    let lw = lift;
    const lp = V(), lq = Q();
    let lcurl = 1.2;
    // (on the shotgun the support hand rides the pump)
    _m.multiplyMatrices(gm, this.M.leftGrip);
    if (this.M.pump) _m.multiply(_m2.makeTranslation(0, 0, this.slide.position.z));
    _m.decompose(lp, lq, _s);
    if (this.reloadT >= 0) (this.M.pump ? this.shellHand(h, gm, lp, lq) : this.reloadHand(h, gm, lp, lq, (c) => { lcurl = c; }));
    lp.lerp(locoL, 1 - lw);
    lq.slerp(locoLq, 1 - lw);
    _pole.copy(right).multiplyScalar(-lerp(1.0, 0.55, pw)).addScaledVector(UP, lerp(-0.8, -1.0, pw)).addScaledVector(fwd, -0.05).normalize();
    poseArm(h, aL, lp, lq, _pole);
    curl(aL, lerp(0.3, lcurl, lw));
  }

  /** Left hand loading shells: grip -> belt -> loading port, and round again. */
  shellHand(h, gm, lp, lq) {
    const t = this.reloadT;
    const pouch = h.hips.localToWorld(V(0.14, 0.02, 0.06));
    const hipQ = h.hips.getWorldQuaternion(Q()).multiply(_fq.setFromEuler(new THREE.Euler(0.15, 0, 0.1)));
    this.magWell.updateWorldMatrix(true, false);
    // under the port, palm up, thumb pushing the shell in
    _m.multiplyMatrices(this.magWell.matrixWorld, _m2.copy(this.M.leftGrip).setPosition(0.035, -0.035, -0.01)).decompose(_p, _q, _s);
    const port = _p.clone(), portQ = _q.clone();
    if (t < 0.22) { const k = seg(t, 0, 0.22); lp.copy(port).lerp(pouch, k); lq.copy(portQ).slerp(hipQ, k); }
    else { const k = seg(t, 0.24, 0.5); lp.copy(pouch).lerp(port, k); lq.copy(hipQ).slerp(portQ, k); }
    if (this.newMag) {
      this.newMag.position.copy(lp).addScaledVector(UP, 0.02);
      this.newMag.quaternion.copy(this.mesh.quaternion).multiply(_fq.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));
    }
  }

  /** Left hand during a reload: pouch -> magazine into the well -> (rack) -> back on the grip. */
  reloadHand(h, gm, lp, lq, setCurl) {
    const t = this.reloadT;
    const grip = { p: lp.clone(), q: lq.clone() };
    // magazine poses
    const pouch = h.hips.localToWorld(V(0.15, -0.02, 0.02));
    const hipQ = h.hips.getWorldQuaternion(Q()).multiply(_fq.setFromEuler(new THREE.Euler(0.15, 0, 0.1)));
    const wellQ = Q(), wellP = V();
    this.magWell.updateWorldMatrix(true, false);
    this.magWell.matrixWorld.decompose(wellP, wellQ, _s);
    const axis = this.M.magAxis.clone().transformDirection(this.mesh.matrixWorld);
    const below = wellP.clone().addScaledVector(axis, 0.09);
    const magP = V(), magQ = Q();
    let holdMag = false;
    if (t < 0.3) {
      // off the grip, down to the pouch
      const k = seg(t, 0.02, 0.3);
      const at = _m.compose(pouch, hipQ, _s.set(1, 1, 1)).multiply(this.M.leftOnMag);
      at.decompose(_p, _q, _s);
      lp.lerp(_p, k); lq.slerp(_q, k);
      setCurl(lerp(1.2, 0.5, k));
    } else if (t < 1.02) {
      // magazine travels from the pouch up under the well (on an arc), then slides in
      const k = seg(t, 0.36, 0.86);
      magP.lerpVectors(pouch, below, k).addScaledVector(UP, Math.sin(k * Math.PI) * 0.06);
      magQ.copy(hipQ).slerp(wellQ, smooth((k - 0.2) / 0.7));
      const ins = seg(t, 0.86, 1.0);
      magP.lerp(wellP, ins);
      holdMag = true;
      setCurl(0.75);
    } else if (this.racks && t < 1.6) {
      // over the top, pull the slide, let it go
      const k = seg(t, 1.04, 1.26);
      const pull = seg(t, 1.3, 1.44);
      this.rackPull = t < 1.5 ? pull * 0.95 : undefined;
      _m.multiplyMatrices(gm, this.M.leftRack).decompose(_p, _q, _s);
      _p.addScaledVector(V(0, 0, -1).transformDirection(this.mesh.matrixWorld), this.M.travel * pull + (t > 1.5 ? 0.05 * seg(t, 1.5, 1.6) : 0));
      // start from under the well where the insert ended
      const from = _m2.compose(wellP, wellQ, _s.set(1, 1, 1)).multiply(this.M.leftOnMag);
      const fp = V(), fq = Q();
      from.decompose(fp, fq, _s);
      lp.copy(fp).lerp(_p, k); lq.copy(fq).slerp(_q, k);
      setCurl(lerp(0.75, 1.3, k) - (t > 1.5 ? 0.6 : 0));
    } else {
      // back onto the grip
      const start = this.racks ? 1.6 : 1.02, end = this.racks ? 1.8 : 1.3;
      const k = seg(t, start, end);
      let fp, fq;
      if (this.racks) {
        _m.multiplyMatrices(gm, this.M.leftRack).decompose(_p, _q, _s);
        _p.addScaledVector(V(0, 0, -1).transformDirection(this.mesh.matrixWorld), 0.09);
        fp = _p.clone(); fq = _q.clone();
      } else {
        _m.compose(wellP, wellQ, _s.set(1, 1, 1)).multiply(this.M.leftOnMag).decompose(_p, _q, _s);
        fp = _p.clone(); fq = _q.clone();
      }
      lp.copy(fp).lerp(grip.p, k); lq.copy(fq).slerp(grip.q, k);
      setCurl(lerp(0.8, 1.2, k));
    }
    if (holdMag && this.newMag) {
      this.newMag.position.copy(magP);
      this.newMag.quaternion.copy(magQ);
      _m.compose(magP, magQ, _s.set(1, 1, 1)).multiply(this.M.leftOnMag).decompose(lp, lq, _s);
    } else if (this.newMag && t >= 0.3) {
      // just grabbed it: it sits in the hand
      this.newMag.position.copy(pouch);
      this.newMag.quaternion.copy(hipQ);
    }
  }
}
