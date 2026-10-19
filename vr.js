import * as THREE from 'three';
import { SCHEMA, settings, setSetting } from './settings.js';
import { INKS, shade } from './inks.js';
import { THROWABLES, FUSE } from './throwables.js';
import { poseArm as solveArm } from './gun.js';
import { GRIP_TILT } from './gunmodel.js';
import { curl, armUp } from './melee.js';
import { sweep, partNear } from './strike.js';
import { pullPart } from './grabbing.js';
import { sawStep } from './saw.js';
import { chopPush } from './chop.js';
import { Scanner } from './scanner.js';
import { VRDrive } from './vrdrive.js';
import { VRTouch } from './vrtouch.js';

/*
  WebXR: your head is the camera, your controllers drive the body's arms (two-bone IK onto the
  hand frames the guns and melee weapons already use), the left stick walks, the right stick snap
  turns, and A on the right controller opens a weapon wheel (hold, move the hand onto a slice,
  let go), B opens the spawn menu (vrspawn.js). Guns fire down the controller's pointing ray; bats and blades land when swung for real
  - swept against every body part each frame, as hard as the swing was fast.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Q = () => new THREE.Quaternion();
const UP = V(0, 1, 0);
const frame = (x, y, z, o) => new THREE.Matrix4().makeBasis(x, y, z).setPosition(o);
const gc = Math.cos(GRIP_TILT), gs = Math.sin(GRIP_TILT);
// (gun.js / melee.js: the wrist's frame on a gun's grip / a melee weapon's handle)
const GUN_GRIP_R = frame(V(1, 0, 0), V(0, gs, -gc), V(0, gc, gs), V(-0.03, -0.022, -0.064));
const GUN_GRIP_L = frame(V(1, 0, 0), V(0, gs, -gc), V(0, gc, gs), V(0.03, -0.022, -0.064));
const MELEE_ON = frame(V(1, 0, 0), V(0, 0, -1), V(0, 1, 0), V(-0.03, 0, -0.072));
// where the palm sits on a gun, in the gun's frame: that's what goes on the controller's grip
const GUN_PALM = V(-0.015, -0.05, -0.025);
/*
  The wrist frames above are for a body of standard size; a body sized to you (height
  calibration, or bigger hands) has its wrist further from (or nearer to) the fist, so the
  offsets grow with the hand: else whatever's held sits off in the fingers or up the wrist.
*/
const handK = (h) => (h.S || 1) * (h.look?.handSize ?? 1);
const _sized = new Map();
function sized(M, h) {
  const k = handK(h);
  if (Math.abs(k - 1) < 1e-3) return M;
  let c = _sized.get(M);
  if (!c || c.k !== k) {
    c = M.clone(); c.k = k;
    c.elements[12] *= k; c.elements[13] *= k; c.elements[14] *= k;
    _sized.set(M, c);
  }
  return c;
}
// a held melee weapon: shaft up out of the fist, leaning forward
const MT = 0.75, mc = Math.cos(MT), ms = Math.sin(MT);
const MELEE_ROT = Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(-1, 0, 0), V(0, mc, -ms), V(0, -ms, -mc)));
const FLIP = Q().setFromAxisAngle(UP, Math.PI);
const LEAN = 0.22;        // m the head can lean out from over the body before the world follows
const TURN = Math.PI / 6; // snap turn
const BODY_LAYER = 3;     // your own torso, neck and head: in the shadow, never in your eyes
const ARM = 1.32;         // the arms in VR: this much longer, so the hands reach the controllers

/*
  The arm onto the controller: the IK's arm (already ARM longer in VR) and, when the controller
  is further from the shoulder than that, stretched further still for this arm alone - so the
  hand (and whatever's in it) never comes off the wrist or drops short of where your hand is.
*/
const _sh = new THREE.Vector3();
/**
 * Stretch an arm's upper and forearm meshes along the bone by k (from their built length), and
 * move the hand to the stretched wrist - the body's meshes don't recompose their own matrices
 * (character.js), so each one is re-baked here: else the bones grew and the skin didn't (gaps).
 */
function stretchArm(a, k) {
  for (const g of [a.upper, a.fore]) for (const c of g.children) {
    if (c === a.hand) continue;
    c.userData.vrSY ??= c.scale.y;
    c.userData.vrPY ??= c.position.y;
    c.scale.y = c.userData.vrSY * k;
    c.position.y = c.userData.vrPY * k;
    c.updateMatrix();
  }
  a.hand.userData.vrY ??= a.hand.position.y;
  a.hand.position.y = a.hand.userData.vrY * k;
  a.hand.updateMatrix();
}
function poseArm(h, a, pos, quat, pole) {
  const D = h.D;
  if (D._ua === undefined) return solveArm(h, a, pos, quat, pole);
  h.chest.updateWorldMatrix(true, false);
  h.chest.localToWorld(_sh.set(a.side * 0.185, 0.2, -0.015));
  const full = (D._ua + D._fa) * ARM;
  const k = ARM * Math.max(1, _sh.distanceTo(pos) / (full * 0.995));
  a.userData_k = k;
  stretchArm(a, k);
  D.UPPER_ARM = D._ua * k; D.FOREARM = D._fa * k;
  solveArm(h, a, pos, quat, pole);
  D.UPPER_ARM = D._ua * ARM; D.FOREARM = D._fa * ARM;
}
const EYE = V(0, 0.09, 0.075); // between the eyes, in the head's frame (main.js firstPerson)
const CROUCH = 0.26;      // m your real head drops for the body's full crouch (quick: a body taller than you still gets down)
const PALM = V(0, -0.075, 0.01); // the middle of the palm, in the hand's frame
const GRAB_R = 0.24;      // m from the palm to a body part's surface, to close on it (generous: easy to get hold of people)
const GRAB_CHUNK = 0.22;  // m from the palm to a loose piece's middle
const LET_GO = 1.9;       // m dragged out of the hand (for a moment): it slips
const CARRY_STR = 2.6;
const ROOM_SLACK = 0.04;  // m your real head moves before the body steps after it
// scoped guns: where the scope sits on the gun (gunmodel.js scope()) and how far it zooms
const SCOPES = {
  sniper: { y: 0.1, z0: -0.05, z1: 0.25, r: 0.022, fov: 5 },
  dmr: { y: 0.092, z0: -0.04, z1: 0.2, r: 0.017, fov: 11 },
};    // how much stronger a VR hand holds a person (enough to lift and carry them)

// the weapon wheel's pages (the right trigger, while it's open, flips between them)
export const WHEEL_PAGES = [
  { name: 'MELEE', items: [
    { type: null, name: 'Hands' },
    { type: 'knife', name: 'Knife' },
    { type: 'pencil', name: 'Pencil' },
    { type: 'bat', name: 'Bat' },
    { type: 'machete', name: 'Machete' },
    { type: 'hammer', name: 'Hammer' },
  ] },
  { name: 'GUNS', items: [
    { type: null, name: 'Hands' },
    { type: 'pistol', name: 'Pistol' },
    { type: 'rifle', name: 'Rifle' },
    { type: 'shotgun', name: 'Shotgun' },
    { type: 'sniper', name: 'Sniper' },
  ] },
  { name: 'THROW', items: [
    { type: null, name: 'Hands' },
    { type: 'nade:grenade', name: 'Grenade' },
  ] },
];

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _p = V(), _q = Q(), _s = V(), _v = V(), _w = V();
const _pole = V(), _rx = new THREE.Matrix4();
const _hq = Q(), _hq2 = Q(), _hq3 = Q(), _hq4 = Q(), _hw2 = V(), _hT = V(), _hV = V(), _hw = V(), _hz = V(), _hW = V(), _hP = V(), _hA = V(), _hB = V(), _hC = V(), _hD = V();
// a hand's grip (firmHold): N it can pull with; N m it can twist a body with - one hand, two
const GRIP_F = 1100, GRIP_T1 = 60, GRIP_T2 = 120;
// a grenade in the palm: its top toward the thumb, the pin's ring out where the other hand can reach it
// (the same lean as a melee weapon's shaft; the right hand's keeps the grenade's -x - its ring - to
// the left, toward the other hand, the left hand's mirrors it)
// (the grenade's axes in the hand's frame: its x - away from the ring - up the hand, its top (+y) by
// the thumb, its z - away from the spoon - out of the palm)
const NADE_Q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 1, 0), V(0, 0, 1), V(1, 0, 0)));
const NADE_QL = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 1, 0), V(0, 0, -1), V(-1, 0, 0)));

export class VRMode {
  /** ctx: { renderer, scene, camera, hero, actors, equip(type), sfx } */
  constructor(ctx) {
    Object.assign(this, ctx);
    this.on = false;
    this.move = { x: 0, y: 0 };
    this.run = false;
    this.yaw = 0; this.pitch = 0;
    this.rig = new THREE.Group();
    this.rig.name = 'vr-rig';
    this.rigYaw = 0;
    this.off = V();            // rig position relative to the body's feet
    this.dy = 0;               // rig height over the feet: your real eyes at the body's eyes
    this.recentre = 0;
    this.hands = { left: null, right: null };
    this.prev = { left: {}, right: {} };
    this.turnLatch = false;
    this.twoHand = false;
    this.hitSkip = new Map();  // actor -> when it was last hit (one blow per contact)
    this.prevSeg = null;
    this.wheel = null;
    this.sel = -1;
    this.standY = 0;           // your real eye height standing (from the calibration)
    this.held = { left: null, right: null }; // what each bare hand has hold of
    this.palm = { left: V(), right: V() };
    this.palmVel = { left: V(), right: V() };
    this.palmQ = { left: null, right: null };   // each hand's orientation (a held part turns with it)
    this.sag = { left: 0, right: 0 };           // m a held weight pulls each hand down
    // (Calibrate height: your real standing eye height, kept for next time)
    this.calibY = (() => { try { return +localStorage.getItem('vrStandY') || 0; } catch (e) { return 0; } })();
    this.dy0 = 0;              // rig height over the feet while you stand (crouching, it eases to 0)
    this.freeNow = { left: false, right: false };
    const xr = this.renderer.xr;
    xr.enabled = true;
    xr.setReferenceSpaceType('local-floor');
    xr.setFoveation?.(1);
    for (let i = 0; i < 2; i++) {
      const grip = xr.getControllerGrip(i), ray = xr.getController(i);
      this.rig.add(grip, ray);
      const slot = { grip, ray, src: null };
      ray.addEventListener('connected', (e) => {
        slot.src = e.data;
        this.hands[e.data.handedness === 'left' ? 'left' : 'right'] = slot;
      });
      ray.addEventListener('disconnected', () => {
        for (const k of ['left', 'right']) if (this.hands[k] === slot) this.hands[k] = null;
        slot.src = null;
      });
    }
    this.hook = (h, dt) => this.poseArms(h, dt);
    this.scanner = new Scanner(this);
    this.drive = new VRDrive(this);
    this.touch = new VRTouch(this);
    xr.addEventListener('sessionstart', () => this.enter());
    xr.addEventListener('sessionend', () => this.exit());
    this.button();
  }

  async button() {
    if (!navigator.xr?.isSessionSupported) return;
    const ok = await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
    if (!ok) return;
    const b = document.createElement('button');
    b.id = 'vr-btn';
    b.type = 'button';
    b.textContent = 'Enter VR';
    const start = async () => {
      if (this.on || this.starting) return;
      this.starting = true;
      try {
        // (a little under full resolution per eye: the cheapest frame-rate there is on a Quest)
        this.renderer.xr.setFramebufferScaleFactor(0.8);
        const s = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
        await this.renderer.xr.setSession(s);
      } catch (e) { console.warn('VR session failed', e); }
      this.starting = false;
    };
    b.addEventListener('click', () => {
      if (this.on) { this.renderer.xr.getSession()?.end(); return; }
      start();
    });
    document.body.appendChild(b);
    this.btn = b;
    // came here from another map while in VR: carry straight on in the headset
    if (window.__vrGranted) start();
    else addEventListener('vr-granted', start, { once: true });
  }

  enter() {
    this.on = true;
    this.scene.add(this.rig);
    this.rig.add(this.camera);
    this.camera.near = 0.05;
    this.camera.updateProjectionMatrix();
    // (looking the way the body faces: the camera looks down -Z, the body down +Z)
    this.rigYaw = this.hero.hero.yaw + Math.PI;
    this.off.set(0, 0, 0);
    this.dy = this.dy0 = 0;
    this.recentre = 6;
    this.armLength(ARM);
    this.sun?.shadow.camera.layers.enable(BODY_LAYER);
    this.prevSeg = null;
    if (document.pointerLockElement) document.exitPointerLock();
    this.onEnter?.();
    if (this.btn) this.btn.textContent = 'Exit VR';
  }

  exit() {
    this.on = false;
    this.dropNade();
    this.camera.removeFromParent();
    this.rig.removeFromParent();
    this.camera.near = 0.1;
    this.camera.updateProjectionMatrix();
    this.hero.hero.head.visible = true;
    this.armLength(1);
    this.hideBody(false);
    this.letGo('left'); this.letGo('right');
    this.hero.hero.dip = 0;
    if (this.wheel) this.wheel.visible = false;
    if (this.menu) this.menu.visible = false;
    if (this.scopeGun?.userData_lens) this.scopeGun.userData_lens.visible = false;
    this.scopeGun = null;
    this.spawner?.close();
    this.scanner.close();
    if (this.drive.upTag) this.drive.upTag.visible = false;
    // the arms back to whatever's held
    const A = this.hero, g = A.gunHeld;
    if (g) A.hero.armHook = (h, dt) => g.poseHeld(h, dt); else armUp(A);
    this.move.x = this.move.y = 0;
    this.run = false;
    this.onExit?.();
    if (this.btn) this.btn.textContent = 'Enter VR';
  }

  /**
   * Calibrate height (the menu): stand up straight and press it - the body keeps its own height,
   * your eyes go to its eyes, and crouching for real takes it all the way down (the floor coming
   * up to meet you as you go, so your hands reach the ground). Kept for next time.
   */
  calibrate() {
    if (this.camera.position.y < 0.5 || this.hero.mode !== 'anim') return; // (not tracking yet / lying down)
    this.buzz('left', 0.5, 80); this.buzz('right', 0.5, 80);
    const h = this.hero.hero, B = h.pos;
    h.head.updateWorldMatrix(true, false);
    const eye = _p.copy(EYE).applyMatrix4(h.head.matrixWorld).y - B.y;
    this.calibY = this.standY = this.camera.position.y;
    this.dy = this.dy0 = eye + (h.dip || 0) * CROUCH - this.standY; // (as if the body stood straight)
    try { localStorage.setItem('vrStandY', String(this.calibY)); localStorage.removeItem('vrFloorLock'); } catch (e) { /* private mode */ }
  }

  /** Stretch both arms by k: the bones the IK solves with and the meshes along them (not the hands). */
  armLength(k0, keep = false) {
    const h = this.hero.hero, D = h.D;
    D._ua ??= D.UPPER_ARM; D._fa ??= D.FOREARM;
    D.UPPER_ARM = D._ua * k0; D.FOREARM = D._fa * k0;
    for (const a of h.arms) {
      // keep: each arm as far as it's stretched this frame (poseArm: reaching past its length)
      const k = keep && a.userData_k ? a.userData_k : k0;
      a.userData_k = k;
      // (in the forearm's own frame - already scaled with the body's height)
      stretchArm(a, k);
    }
  }

  /**
   * The trunk, neck and head (everything on the body's root; the arms and legs are their own)
   * onto a layer the headset's eyes don't draw: you see your arms and legs, and still cast a
   * whole shadow. Done every frame so clothes put on in VR go the same way.
   */
  hideBody(on) {
    this.hero.hero.root.traverse((o) => {
      if (!o.isMesh) return;
      if (on) {
        if (o.userData._vrMask === undefined) o.userData._vrMask = o.layers.mask;
        o.layers.set(BODY_LAYER);
      } else if (o.userData._vrMask !== undefined) {
        o.layers.mask = o.userData._vrMask;
        delete o.userData._vrMask;
      }
    });
  }

  uiOpen() { return !!(this.menu?.visible || this.wheel?.visible || this.spawner?.open || this.scanner?.blocking()); }
  pad(hand) { return this.hands[hand]?.src?.gamepad || null; }
  buzz(hand, v, ms) { try { this.pad(hand)?.hapticActuators?.[0]?.pulse?.(v, ms); } catch (e) { /* no rumble */ } }
  btnDown(hand, i) { return !!this.pad(hand)?.buttons[i]?.pressed; }
  btnVal(hand, i) { return this.pad(hand)?.buttons[i]?.value || 0; }
  /** Button i on hand went down (edge) / up (edgeUp) since last asked. */
  edge(hand, i) {
    const P = this.prev[hand], now = this.btnDown(hand, i), was = !!P[i];
    P[i] = now;
    return now && !was;
  }
  edgeUp(hand, i) {
    const P = this.prev[hand], k = 'u' + i, now = this.btnDown(hand, i), was = !!P[k];
    P[k] = now;
    return !now && was;
  }

  /** The head's world position (from the camera's pose in the rig: last frame's). */
  headWorld(out) { return out.copy(this.camera.position).applyQuaternion(this.rig.quaternion).add(this.rig.position); }

  /** Start of the frame: sticks and buttons. */
  input() {
    const L = this.pad('left'), R = this.pad('right');
    // walk: left stick, relative to where you're looking (pushed all the way: run; clicking it is the scanner)
    const lx = L?.axes[2] || 0, ly = L?.axes[3] || 0;
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    this.move.x = dz(lx); this.move.y = -dz(ly);
    this.run = Math.hypot(lx, ly) > 0.95;
    // in a car (vrdrive.js): the wheel, the triggers and B are the car's
    const inCar = this.drive.input();
    // snap turn: right stick, round the head
    const rx = R?.axes[2] || 0;
    if (inCar) this.turnLatch = true;
    else if (Math.abs(rx) > 0.7 && !this.turnLatch) { this.turnLatch = true; this.turn(rx > 0 ? -TURN : TURN); }
    else if (Math.abs(rx) < 0.3) this.turnLatch = false;
    this.roomWalk();
    // where you're looking
    _v.set(0, 0, -1).applyQuaternion(this.camera.quaternion).applyAxisAngle(UP, this.rigYaw);
    this.yaw = Math.atan2(-_v.x, -_v.z);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, -_v.y)));
    // weapon wheel: hold A on the right, let go to pick
    // knocked down (alive, out of a car): A gets you back up instead (vrdrive.js shows the tag)
    const A0 = this.hero, down = A0.mode === 'ragdoll' && !A0.brain?.dead && !A0.seat;
    if (down) { if (this.edge('right', 4)) { this.closeWheel(false); this.standUp?.(); } }
    else if (this.edge('right', 4) && !this.menu?.visible && !this.spawner?.open) this.openWheel();
    if (this.edgeUp('right', 4)) this.closeWheel(true);
    // the wheel open: the right trigger turns its page (it never fires then: uiOpen)
    const trig = this.edge('right', 0);
    if (trig && this.wheel?.visible) this.flipPage(1);
    // B: the spawn menu (an empty gun reloads itself when you pull the trigger)
    if (!inCar && this.edge('right', 5) && this.spawner && !this.noSpawn) {
      if (this.menu?.visible) { this.menu.visible = false; this.laser.visible = false; }
      this.closeWheel(false);
      this.spawner.toggle();
    }
    if (this.spawner?.open) this.spawner.update();
    // the menu button on the left controller (or Y, where the headset keeps that one to itself)
    let menuBtn = this.edge('left', 5);
    const lb = L?.buttons.length || 0;
    for (let i = 6; i < lb; i++) if (this.edge('left', i)) menuBtn = true;
    if (menuBtn) { this.spawner?.close(); this.toggleMenu(); }
    if (this.menu?.visible) this.updateMenu();
    this.scanner.input();
  }

  /**
   * Walk around your room and the body comes with you: wherever your real head goes, the body's
   * eyes follow (a wall stops the body - then the old lean takes over and the world gives way).
   */
  roomWalk() {
    const A = this.hero, h = A.hero;
    if (this.recentre > 0 || A.mode !== 'anim' || A.seat || A.brain?.dead || h.action?.isPosture) return;
    if (this.camera.position.lengthSq() < 1e-6) return;
    h.head.updateWorldMatrix(true, false);
    const E = _p.copy(EYE).applyMatrix4(h.head.matrixWorld), H = this.headWorld(_w);
    const dx = H.x - E.x, dz = H.z - E.z, d = Math.hypot(dx, dz);
    if (d <= ROOM_SLACK || d > 1.5) return; // (a jump that big: a recentre, not a step)
    const k = (d - ROOM_SLACK) / d;
    h.pos.x += dx * k; h.pos.z += dz * k;
    this.off.x -= dx * k; this.off.z -= dz * k;
  }

  turn(d) {
    const H = this.headWorld(V()), B = this.hero.hero.pos;
    this.rig.position.sub(H).applyAxisAngle(UP, d).add(H);
    this.rigYaw += d;
    this.off.set(this.rig.position.x - B.x, 0, this.rig.position.z - B.z);
  }

  /** After the controls are read: face where you look; the arms are ours. */
  ctrl(input) {
    input.faceYaw = this.yaw + Math.PI;
    input.camYaw = this.yaw;
    this.hero.hero.armHook = this.hook;
  }

  /** The rig over the body: your eyes where its eyes are, give or take a lean. */
  place(h) {
    if (this.hero.seat) { this.drive.place(); return; }
    const B = h.pos;
    this.rig.quaternion.setFromAxisAngle(UP, this.rigYaw);
    this.rig.position.set(B.x + this.off.x, B.y + this.dy, B.z + this.off.z);
    const tracked = this.camera.position.lengthSq() > 1e-6;
    // the body's own eyes
    h.head.updateWorldMatrix(true, false);
    const E = _p.copy(EYE).applyMatrix4(h.head.matrixWorld);
    const H = this.headWorld(_w);
    const dx = H.x - E.x, dz = H.z - E.z, d = Math.hypot(dx, dz);
    if (tracked && this.recentre > 0 && this.hero.mode === 'anim') {
      // (once, coming in: your height matched to the body's - standing or sitting, tall or short)
      this.recentre--;
      this.off.x -= dx; this.off.z -= dz;
      // (your eyes where the body's are: standing at your calibrated height, else as you are now)
      this.standY = this.calibY || this.camera.position.y;
      this.dy = this.dy0 = E.y - B.y - this.standY;
    } else if (d > LEAN) { const k = (d - LEAN) / d; this.off.x -= dx * k; this.off.z -= dz * k; }
    this.rig.position.set(B.x + this.off.x, B.y + this.dy, B.z + this.off.z);
    this.rig.updateMatrixWorld(true);
  }

  /** Just before render: the rig's final place, your own head out of the way, the wheel. */
  frame() {
    const h = this.hero.hero;
    this.place(h);
    if (this.hero.seat) this.drive.frame();
    this.drive.after();
    this.touch.update();
    this.scanner.frame();
    h.head.visible = false;
    this.hideBody(true);
    this.armLength(ARM, true); // (the wardrobe can rebuild sleeves: keep them stretched too - as far as each arm reached)
    if (this.wheel?.visible) this.updateWheel();
    this.scopeTick();
    this.flightTick();
    const now = performance.now();
    for (const [a, t] of this.hitSkip) if (now - t > 400) this.hitSkip.delete(a);
  }

  /**
   * People thrown with your hands: the first time any part of them meets something hard enough
   * (its speed changing by more than SLAM in a frame), they're injured - bones go, a head knocks
   * them out, a trunk takes blunt trauma - scaled with how hard they hit.
   */
  flightTick() {
    if (!this.flung?.size) return;
    const now = performance.now(), dt = Math.min(0.05, (now - (this.flightAt || now)) / 1000);
    this.flightAt = now;
    if (!dt) return;
    const SLAM = 7;
    for (const [A, f] of this.flung) {
      f.t -= dt;
      if (f.t <= 0 || !A.rd || A.mode !== 'ragdoll' || !this.actors.includes(A) || this.held.left?.A === A || this.held.right?.A === A) { this.flung.delete(A); continue; }
      let worst = null, wm = 0;
      for (const p of A.rd.list) {
        if (p.gone) continue;
        const lv = p.body.linvel(), last = f.last.get(p);
        if (last) {
          const dx = lv.x - last.x, dy = lv.y - last.y + 9.81 * dt, dz = lv.z - last.z, m = Math.hypot(dx, dy, dz);
          if (m > wm && p.touch !== false) { wm = m; worst = { p, n: V(dx, dy, dz).normalize(), vIn: V(last.x, last.y, last.z) }; }
        }
        f.last.set(p, { x: lv.x, y: lv.y, z: lv.z });
      }
      if (wm < SLAM || !worst) continue;
      this.flung.delete(A);
      this.slam(A, worst.p.name, worst.n, worst.vIn, wm);
    }
  }
  slam(A, name, n, vIn, mag) {
    const sev = Math.min(4, 1.2 + (mag - 7) / 3), O = A.organs, kind = name.replace(/[LR]$/, ''), side = name.slice(-1);
    const P = A.rd.parts[name], point = A.rd.point(name, P.def.com, V()).addScaledVector(n, -0.08);
    A.wounds?.injure(name, point, n, vIn, sev);
    if (O && !A.brain.dead && !O.vamp) {
      if (kind === 'shin' || kind === 'thigh' || kind === 'foot') O.breakLeg(side);
      else if (kind === 'upper' || kind === 'fore' || kind === 'hand') O.breakArm(side);
      else if (kind === 'head') { O.faint?.(2 + sev * 2); O.hurtBrain?.(sev * 0.08, true); }
      else O.blunt?.(name, sev, 'blunt');
      // a really hard one: something else goes too
      if (sev > 2.5) { if (Math.random() < 0.5) O.breakLeg(Math.random() < 0.5 ? 'L' : 'R'); else O.breakArm(Math.random() < 0.5 ? 'L' : 'R'); }
      O.state.pain = Math.min(1, O.state.pain + 0.3 * sev);
      O.apply?.();
      A.onPain?.(name, 'pain', sev);
    }
    this.sfx?.('crunch', Math.min(1, 0.4 + sev * 0.15));
    for (const h of ['left', 'right']) this.buzz(h, 0.4, 40);
  }

  // ---- the arms (the body's armHook: the last thing in its animation each frame) ----
  poseArms(h, dt) {
    if (!this.on || this.hero.seat) return;
    this.place(h);
    h.twist = h.bend = 0;
    this.crouch(h);
    this.freeNow.left = this.freeNow.right = false;
    const A = this.hero, gun = A.gunHeld, mel = A.meleeHeld;
    const R = this.hands.right, L = this.hands.left;
    const fwd = h.forward(V()), right = V(-fwd.z, 0, fwd.x);
    // elbows down and out, a touch back
    const pole = (a) => _pole.copy(right).multiplyScalar(a.side > 0 ? -0.7 : 0.7).addScaledVector(UP, -0.8).addScaledVector(fwd, -0.25).normalize();
    const aR = h.arms[1], aL = h.arms[0];
    aR.userData_k = aL.userData_k = ARM; // (stretched again below if the controller is out of reach)
    let leftDone = false;
    if (R?.grip.visible) {
      if (gun && gun.state === 'held') leftDone = this.holdGun(h, gun, R, L, aR, aL, pole, dt);
      else if (mel && mel.state === 'held' && mel.stuckIn) this.holdStuck(h, mel, R, aR, pole, dt);
      else if (mel && mel.state === 'held') this.holdMelee(h, mel, R, aR, pole, dt);
      else this.freeHand(h, R, aR, pole, 'right', dt);
    }
    if (!leftDone && L?.grip.visible) this.freeHand(h, L, aL, pole, 'left', dt);
    // a hand that's gone to a weapon (or lost tracking) lets go
    for (const k of ['left', 'right']) if (!this.freeNow[k]) this.letGo(k);
  }

  /**
   * Crouch for real and the body does too: how far your head is under its standing height,
   * as a share of a full crouch (the body's knee bend, character.js dip); lower still, it
   * bends over at the waist as well.
   */
  crouch(h) {
    if (this.recentre > 0 || !this.standY) { h.dip = 0; return; }
    const y = this.camera.position.y;
    if (y > this.standY) this.standY += (y - this.standY) * 0.05; // (stood up straighter)
    const drop = this.standY - y;
    const k = Math.min(1, Math.max(0, (drop - 0.04) / CROUCH));
    h.dip = k < 0.03 ? 0 : k;
    h.bend = Math.min(0.5, Math.max(0, (drop - CROUCH - 0.04) / 0.35));
    // the floor comes up to meet you: head down to ~45% of standing, your real floor is the floor
    const t = Math.min(1, Math.max(0, drop / (this.standY * 0.55)));
    this.dy = this.dy0 * (1 - t * t * (3 - 2 * t));
  }

  /** An empty hand on the controller: fingers close with grip / trigger. */
  freeHand(h, slot, a, pole, hand, dt = 0) {
    slot.grip.matrixWorld.decompose(_p, _q, _s);
    _q.multiply(FLIP);
    _v.copy(GUN_PALM);
    if (hand === 'left') _v.x = -_v.x;
    _p.sub(_v.applyQuaternion(_q));
    _m.compose(_p, _q, _s.set(1, 1, 1)).multiply(sized(hand === 'left' ? GUN_GRIP_L : GUN_GRIP_R, h));
    _m.decompose(_p, _q, _s);
    // something heavy in the hand: it drags the hand down a little (sag, eased - holding())
    const sg = this.held[hand] ? (this.sag[hand] || 0) : (this.sag[hand] = 0);
    if (sg) _p.y -= sg;
    (this.palmQ[hand] ||= Q()).copy(_q);
    poseArm(h, a, _p, _q, pole(a));
    this.freeNow[hand] = true;
    // the palm, and how fast it's going (to throw with)
    const P = this.palm[hand], pv = this.palmVel[hand];
    const was = _w.copy(P);
    P.copy(PALM).multiplyScalar(handK(h)).applyQuaternion(_q).add(_p);
    if (dt > 0) pv.lerp(was.sub(P).multiplyScalar(-1 / dt), 0.5);
    // a grenade: held in this hand, or this hand on its pin
    if (this.nade && this.nadeHand(hand, a, _q, dt, _p, h)) return;
    // squeeze: take hold of whatever the palm is on; let go to drop (or throw) it
    if (this.edge(hand, 1) && !this.held[hand] && !this.uiOpen()) this.grab(hand, h.arms.indexOf(a));
    if (this.held[hand] && !this.btnDown(hand, 1)) this.letGo(hand, true);
    if (this.held[hand]) this.holding(hand, dt);
    curl(a, this.held[hand] ? 1.25 : 0.25 + 1.25 * Math.max(this.btnVal(hand, 1), this.btnVal(hand, 0) * 0.7));
  }

  // ---- a grenade (the wheel's THROW page): one hand holds it, the other pulls the pin ----
  /** A grenade of `kind` into the hand (the right one). */
  holdNade(kind, hand = 'right') {
    this.dropNade();
    const mesh = THROWABLES[kind].build();
    this.scene.add(mesh);
    this.nade = { kind, mesh, hand, cook: -1, pin: null, pinBy: null, gripped: false };
    this.buzz(hand, 0.3, 30);
  }
  /** Put away (not lit) - or, lit, let fall where it is: it still goes off. */
  dropNade() {
    const N = this.nade;
    if (!N) return;
    this.nade = null;
    N.mesh.removeFromParent();
    if (N.pin) this.nades?.bit(N.pin, V());
    if (N.cook >= 0) this.nades?.launch(N.kind, this.hero, N.mesh.position.clone(), V(0, 0.3, 0), N.cook);
  }
  /**
   * This frame's hand `hand` (pose q, palm this.palm[hand]) with a grenade about: holding it, on
   * its pin, or reaching for the pin. True when the hand's taken care of (no grabbing).
   */
  nadeHand(hand, a, q, dt, wrist, h) {
    const N = this.nade, P = this.palm[hand], NS = this.nades;
    if (hand === N.hand) {
      // in the hand's own frame (fingers down -y, the palm toward +x on the right, the thumb +z):
      // the ball against the palm where a handle would be, its top up by the thumb, the spoon on
      // the palm, the ring out past the fingertips for the other hand to reach
      const k = handK(h), sx = hand === 'left' ? -1 : 1;
      N.mesh.quaternion.copy(q).multiply(hand === 'left' ? NADE_QL : NADE_Q);
      N.mesh.position.copy(wrist).add(_v.set(sx * 0.048 * k, -0.078 * k, 0).applyQuaternion(q))
        .sub(_w.set(0, N.mesh.userData.mid ?? 0.035, 0).applyQuaternion(N.mesh.quaternion));
      N.mesh.updateMatrixWorld(true);
      curl(a, 0.85);
      const grip = this.btnDown(hand, 1);
      if (grip) N.gripped = true;
      if (N.cook >= 0) {
        N.cook += dt;
        // held too long: it goes off in your hand
        if (N.cook >= FUSE[N.kind]) {
          this.nade = null; N.mesh.removeFromParent();
          if (N.pin) NS?.bit(N.pin, V());
          NS?.launch(N.kind, this.hero, N.mesh.position.clone(), V(), FUSE[N.kind]);
          return true;
        }
        // the grip let go: thrown, at the hand's speed (the spoon flies off)
        if (N.gripped && !grip) {
          this.nade = null; N.mesh.removeFromParent();
          if (N.pin) NS?.bit(N.pin, V());
          NS?.launch(N.kind, this.hero, N.mesh.position.clone(), _w.copy(this.palmVel[hand]).multiplyScalar(1.3), N.cook);
          this.sfx?.('whoosh', 0.4, { rate: 0.85, vary: 0.1 });
          this.buzz(hand, 0.4, 30);
        }
      }
      return true;
    }
    // the other hand, on the pin: it comes with the hand until you let go of it
    if (N.pinBy === hand) {
      // (the ring between the fingers, where the fist closes)
      const sx = hand === 'left' ? -1 : 1, k = handK(h);
      N.pin.position.copy(wrist).add(_v.set(sx * 0.03 * k, -0.075 * k, 0).applyQuaternion(q));
      N.pin.quaternion.copy(q).multiply(hand === 'left' ? NADE_QL : NADE_Q);
      curl(a, 0.9);
      if (!this.btnDown(hand, 1)) { NS?.bit(N.pin, this.palmVel[hand]); N.pin = null; N.pinBy = null; }
      return true;
    }
    // reaching for the ring: squeeze on it and the pin's out, the fuse lit
    if (N.cook < 0 && N.mesh.userData.ring) {
      const ring = N.mesh.localToWorld(_w.copy(N.mesh.userData.ring));
      const d = ring.distanceTo(P);
      if (d < 0.1 && !N.near) { N.near = true; this.buzz(hand, 0.15, 15); }
      else if (d > 0.13) N.near = false;
      if (d < 0.1 && this.edge(hand, 1)) {
        const pin = N.mesh.userData.pin;
        pin.removeFromParent();
        this.scene.add(pin);
        N.pin = pin; N.pinBy = hand; N.cook = 0;
        this.sfx?.('pin', 0.6, { vary: 0.1 });
        this.buzz(hand, 0.7, 50); this.buzz(N.hand, 0.4, 40);
        curl(a, 0.9);
        return true;
      }
    }
    return false;
  }

  // ---- bare hands: picking up people and pieces of them ----
  /** Close the hand on the nearest body part or loose piece within reach of the palm. */
  grab(hand, i) {
    const G = this.grabber, palm = this.palm[hand];
    if (!G) return;
    let best = null, bd = Infinity;
    for (const A of this.actors) {
      if (A === this.hero || (A.remote && !G.ctx?.tug) || A.seat || !A.rd || !A.groups || A.hero.shown === false) continue;
      // (ragdolled, the body can be metres from where their feet were: go by where it really is)
      const at = A.mode === 'ragdoll' && !A.remote && A.rd.parts.pelvis && !A.rd.parts.pelvis.gone ? A.rd.pos('pelvis', _w) : A.hero.pos;
      if (at.distanceTo(palm) > 3) continue;
      for (const name of A.rd.names) {
        if (A.rd.parts[name]?.gone) continue;
        const n = partNear(A, name, palm);
        if (n && n.dist < GRAB_R && n.dist < bd) { bd = n.dist; best = { A, name }; }
      }
    }
    for (const c of this.chunks?.() || []) {
      if (!c.body || c.held) continue;
      // (a construction piece: from its surface - a long board is taken hold of anywhere along it)
      const t = c.near ? c.near(palm, _w) : c.body.translation();
      const d = Math.hypot(t.x - palm.x, t.y - palm.y, t.z - palm.z) - (c.near ? 0.06 : GRAB_CHUNK) + (c.near ? 0 : GRAB_R);
      if (d < GRAB_R && d < bd) { bd = d; best = { chunk: c }; }
    }
    if (!best) return;
    // (the other hand already on that same piece: this one takes it)
    const other = hand === 'left' ? 'right' : 'left', o = this.held[other];
    if (o && best.chunk && o.chunk === best.chunk) this.letGo(other);
    const g = best.chunk ? G.chunkGrip(i, best.chunk, palm, 'carry') : G.partGrip(i, best.A, best.name, palm, 'arm');
    g.t = 1; g.far = 0;
    if (g.chunk) g.chunk.held = true;
    else g.str = Math.max(g.str || 1, CARRY_STR);
    this.held[hand] = g;
    this.buzz(hand, 0.5, 40);
    this.sfx?.('grab', 0.5);
  }

  /** Each frame something's held: it's pulled to the palm (the physics does it, preStep). */
  holding(hand, dt) {
    const g = this.held[hand], G = this.grabber;
    // cut off while held: the hand keeps the piece that came away
    if (g.A && (!this.actors.includes(g.A) || g.A.rd.parts[g.name]?.gone)) {
      const c = G.pieceOf(g);
      if (!c) { this.letGo(hand); return; }
      Object.assign(g, G.chunkGrip(g.i, c, g.W, 'carry'), { A: null, name: null, t: 1, rel: null, relWith: undefined });
      c.held = true;
    }
    if (g.chunk && !this.chunks?.().includes(g.chunk)) { this.letGo(hand); return; }
    G.anchor(g, g.W);
    g.T.copy(this.palm[hand]);
    g.vT.copy(this.palmVel[hand]);
    // the hand's turn: what it holds turns with it (holdTurn)
    if (this.palmQ[hand]) {
      const q = this.palmQ[hand];
      if (g.Q && dt > 0) {
        // (how fast the hand's turning: carried into what it holds)
        const d = _hq.copy(q).multiply(_hq3.copy(g.Q).invert());
        if (d.w < 0) { d.x = -d.x; d.y = -d.y; d.z = -d.z; d.w = -d.w; }
        (g.wT ||= V()).lerp(_v.set(d.x, d.y, d.z).multiplyScalar(2 / dt), 0.5).clampLength(0, 20);
      }
      (g.Q ||= Q()).copy(q);
    }
    // the weight on this hand: a slight drag down (a whole body, one-handed: ~5 cm; two hands share it)
    {
      const A = g.A, both = this.held.left && this.held.right && this.held.left.A && this.held.left.A === this.held.right.A;
      let kg = 0;
      if (A && A.mode === 'ragdoll' && !A.remote) kg = (A.rd.mass || 70) * 0.55 / (both ? 2 : 1) + (A.rd.parts[g.name]?.mass || 2);
      else if (g.chunk?.body) kg = g.chunk.body.mass?.() || 3;
      // (and however far it's really hanging below the hand: the weight winning)
      const lag = A && A.mode === 'ragdoll' ? Math.max(0, g.T.y - g.W.y) * 0.5 : 0;
      const want = Math.min(0.08, Math.max(kg * 9.81 / 1150 * 0.13, lag));
      this.sag[hand] += (want - this.sag[hand]) * Math.min(1, dt * 6);
    }
    const d = g.W.distanceTo(g.T);
    g.far = d > LET_GO ? g.far + dt : 0;
    if (g.far > 0.3) { this.letGo(hand); return; }
    // someone on their feet, pulled on: off balance, they go where they're hauled
    const A = g.A;
    if (A && !A.remote && A.mode === 'anim' && d > 0.06) A.goRagdoll('stumble', { balance: 0.9, decay: 0.12 });
    // someone else's body: their own client does the pulling (mp.js) - send it our hands
    if (A?.remote) {
      this.tugT = (this.tugT || 0) - dt;
      if (this.tugT <= 0 && hand === this.tugHand()) {
        this.tugT = 1 / 15;
        G.ctx?.tug?.(A, [this.held.left, this.held.right].filter((x) => x?.A === A));
      }
    }
  }
  /** The one hand that sends the tug when both hold the same person. */
  tugHand() { return this.held.right?.A?.remote ? 'right' : 'left'; }

  /** Open the hand. thrown: it keeps the hand's speed. */
  letGo(hand, thrown = false) {
    const g = this.held[hand];
    if (!g) return;
    this.held[hand] = null;
    const v = this.palmVel[hand];
    if (g.chunk) {
      g.chunk.held = false;
      if (thrown && g.chunk.body) {
        const k = 1.3;
        g.chunk.body.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
      }
    } else if (g.A?.remote) {
      const other = this.held[hand === 'left' ? 'right' : 'left'];
      if (other?.A === g.A) this.tugT = 0; // (the other hand carries on alone)
      else this.grabber.ctx?.tug?.(g.A, [], true, thrown && v.lengthSq() > 4 ? v.clone().multiplyScalar(1.2) : null);
    } else if (thrown && g.A?.mode === 'ragdoll' && v.lengthSq() > 4) {
      // (a fling: the whole of them goes with it, the part held most)
      const A = g.A, P = A.rd.parts[g.name];
      A.rd.phys(() => {
        for (const Pt of A.rd.list) if (!Pt.gone) Pt.body.applyImpulse(_v.copy(v).multiplyScalar(Pt.mass * (Pt === P ? 0.6 : 0.25)), true);
      });
      // watched in flight: a hard landing hurts (flightTick)
      if (!this.soft) { (this.flung ||= new Map()).set(A, { t: 3, last: new Map() }); this.flightAt = performance.now(); }
    }
  }

  /**
   * The grip: the part in your hand is driven toward your palm (and its turn in your hand) every
   * physics substep - but only as hard as a hand can. A person is heavy: one hand moves them with
   * effort and barely turns them; two hands share the weight and, with leverage between them, turn
   * them easily. What the hand drives goes into the part held and, through it, the rest of the
   * body (the limb it hangs off most), so they come as a whole, with their weight dragging behind.
   * hands: how many of yours are on this person. other: the other hand on this same part.
   */
  firmHold(g, H, other = null, hands = 1) {
    const A = g.A, rd = A.rd, P = rd.parts[g.name];
    if (!P || P.gone) return;
    const b = P.body, r = b.rotation(), t = b.translation(), lv = b.linvel(), av = b.angvel();
    const cur = _hq.set(r.x, r.y, r.z, r.w);
    const T = other ? _hT.copy(g.T).lerp(other.T, 0.5) : _hT.copy(g.T);
    const vT = other ? _hV.copy(g.vT).lerp(other.vT, 0.5) : _hV.copy(g.vT);
    const str = g.str || 1, bodyM = rd.mass || 70;
    // what the hand(s) have to move: this part, and their share of the body behind it
    const M = P.mass + bodyM * 0.55 / hands;
    // and to turn: the part is clamped in the hand (no pivoting round the grip like a ball joint);
    // the rest of the body hangs off it through its own joints
    const I = P.mass * 0.03 + bodyM * (hands > 1 ? 0.015 : 0.02);
    const F = GRIP_F * str * (other ? 2 : 1);           // N
    const TQ = (hands > 1 ? GRIP_T2 : GRIP_T1) * str;    // N m
    // where the hand wants it: the grip point on the palm (closing the gap over a few substeps)...
    const W = rd.point(g.name, g.local, _hW);
    const arm = _hA.set(W.x - t.x, W.y - t.y, W.z - t.z);
    const wantV = _hP.subVectors(T, W).multiplyScalar(1 / (H * 4)).add(vT).clampLength(0, 12);
    // ...and turned the way the hand is (two hands on one part: they hold it, it turns as they do)
    const wantW = _hw.set(av.x, av.y, av.z).multiplyScalar(0.92);
    if (g.Q) {
      // (one part in both hands: it keeps its turn between them)
      const hq = other?.Q ? _hq4.copy(g.Q).slerp(other.Q, 0.5) : _hq4.copy(g.Q);
      const key = other?.Q ? other : null;
      if (!g.rel || g.relWith !== key) { g.rel = hq.clone().invert().multiply(cur); g.relWith = key; }
      const e = _hq2.copy(hq).multiply(g.rel).multiply(_hq3.copy(cur).invert());
      if (e.w < 0) { e.x = -e.x; e.y = -e.y; e.z = -e.z; e.w = -e.w; }
      const wT = other?.Q ? _hw2.copy(g.wT || _hz).lerp(other.wT || _hz, 0.5) : (g.wT || _hz);
      wantW.set(e.x, e.y, e.z).multiplyScalar(2 / (H * 5)).add(wT).clampLength(0, 18);
    }
    // what it takes, capped at what the hand has in it
    const vW = _hB.set(av.x, av.y, av.z).cross(arm).add(_hC.set(lv.x, lv.y, lv.z)); // (the grip point's own speed)
    const dv = wantV.sub(vW).clampLength(0, F * H / M);
    const dw = wantW.sub(_hD.set(av.x, av.y, av.z)).clampLength(0, TQ * H / I);
    // the part held: turned, and its grip point moved (less what the turn already does there)
    const nl = _hC.add(dv).sub(_hB.crossVectors(dw, arm));
    b.setLinvel({ x: nl.x, y: nl.y, z: nl.z }, true);
    b.setAngvel({ x: av.x + dw.x, y: av.y + dw.y, z: av.z + dw.z }, true);
    // the rest of what the hand put in goes on into the body: mostly up the limb it's attached by
    const rest = M - P.mass;
    if (rest <= 0) return;
    const chain = [];
    let mc = 0, mo = 0;
    for (let n = P.def.parent; n; n = rd.parts[n].def.parent) { const C = rd.parts[n]; if (C && !C.gone) { chain.push(C); mc += C.mass; } }
    for (const C of rd.list) if (C !== P && !C.gone && !chain.includes(C)) mo += C.mass;
    const kc = chain.length ? 0.7 : 0, ko = 1 - kc;
    for (const C of rd.list) {
      if (C === P || C.gone) continue;
      const inChain = chain.includes(C);
      const share = inChain ? kc * C.mass / mc : mo > 0 ? ko * C.mass / mo : 0;
      if (share <= 0) continue;
      const j = rest * share;
      C.body.applyImpulse({ x: dv.x * j, y: dv.y * j, z: dv.z * j }, true);
    }
  }

  /** A loose piece in the hand turns with the hand (a clamp, not a ball joint at the palm). */
  turnChunk(g, H) {
    const b = g.chunk?.body;
    if (!b || !g.Q) return;
    const r = b.rotation(), cur = _hq.set(r.x, r.y, r.z, r.w);
    if (!g.rel || g.relWith !== null) { g.rel = g.Q.clone().invert().multiply(cur); g.relWith = null; }
    const e = _hq2.copy(g.Q).multiply(g.rel).multiply(_hq3.copy(cur).invert());
    if (e.w < 0) { e.x = -e.x; e.y = -e.y; e.z = -e.z; e.w = -e.w; }
    const w = _hw.set(e.x, e.y, e.z).multiplyScalar(2 / (H * 4)).add(g.wT || _hz).clampLength(0, 25);
    b.setAngvel({ x: w.x, y: w.y, z: w.z }, true);
  }

  /** Each physics substep (main.js): what the hands hold is pulled toward them. */
  preStep(H) {
    if (!this.on) return;
    const L = this.held.left, R = this.held.right;
    for (const g of [L, R]) {
      if (!g) continue;
      if (g.chunk) { this.grabber.pullChunk(g, H); this.turnChunk(g, H); }
      else if (g.A.mode === 'ragdoll' && !g.A.remote) {
        const o = g === L ? R : L, same = o && o.A === g.A && o.name === g.name;
        if (same && g === R) continue; // (one part in both hands: the left drives it, to between them)
        this.firmHold(g, H, same ? o : null, o && o.A === g.A ? 2 : 1);
      }
    }
  }

  holdGun(h, gun, R, L, aR, aL, pole, dt) {
    const M = gun.M;
    gun.pickT = 1;
    // barrel down the controller's pointing ray, the grip in the palm
    R.ray.matrixWorld.decompose(_p, _q, _s);
    const q = _q.clone().multiply(FLIP);
    const pos = V().setFromMatrixPosition(R.grip.matrixWorld);
    // a long gun with the left hand on its fore-end (squeeze to take hold): aimed between the hands
    let two = false;
    if (M.long && L?.grip.visible && this.btnVal('left', 1) > 0.5) {
      const lp = V().setFromMatrixPosition(L.grip.matrixWorld);
      if (!this.twoHand) {
        _m.compose(pos.clone().sub(GUN_PALM.clone().applyQuaternion(q)), q, _s.set(1, 1, 1)).multiply(sized(M.leftGrip, h));
        if (V().setFromMatrixPosition(_m).distanceTo(lp) < 0.22) this.twoHand = true;
      }
      if (this.twoHand) {
        const z = lp.sub(pos);
        if (z.lengthSq() > 0.01) {
          z.normalize();
          const up = V(0, 1, 0).applyQuaternion(q);
          const x = V().crossVectors(up, z).normalize();
          const y = V().crossVectors(z, x);
          q.setFromRotationMatrix(_m.makeBasis(x, y, z));
          two = true;
        }
      }
    } else this.twoHand = false;
    pos.sub(GUN_PALM.clone().applyQuaternion(q));
    const Rc = gun.recoil;
    const gm = _m2.compose(pos, q, _s.set(1, 1, 1));
    gm.multiply(_rx.makeRotationX(-Rc.a * 0.5)).multiply(_m.makeTranslation(0, 0, -Rc.z * 0.06));
    gm.decompose(gun.mesh.position, gun.mesh.quaternion, _s);
    gun.mesh.updateMatrixWorld(true);
    gun.vel.copy(gun.mesh.position).sub(gun.lastPos).divideScalar(Math.max(dt, 1e-3));
    if (gun.vel.length() > 30) gun.vel.set(0, 0, 0);
    gun.lastPos.copy(gun.mesh.position);
    const G = gun.mesh.matrixWorld;
    _m.multiplyMatrices(G, sized(GUN_GRIP_R, h)).decompose(_p, _q, _s);
    poseArm(h, aR, _p, _q, pole(aR));
    curl(aR, 1.35, 0.75 - this.btnVal('right', 0) * 0.3);
    if (two) {
      _m.multiplyMatrices(G, sized(M.leftGrip, h));
      if (M.pump && gun.slide) _m.multiply(_rx.makeTranslation(0, 0, gun.slide.position.z));
      _m.decompose(_p, _q, _s);
      poseArm(h, aL, _p, _q, pole(aL));
      curl(aL, 1.2);
    }
    // the trigger (the wheel open: no shooting)
    const pull = this.btnDown('right', 0), was = this._trig;
    this._trig = pull;
    if (pull && !this.uiOpen() && (M.auto || !was)) this.shoot(gun);
    return two;
  }

  shoot(gun) {
    if (!gun.chambered && gun.ammo <= 0 && gun.pumpT < 0 && gun.cool <= 0) { this.reload(); return; }
    const S = SCOPES[gun.type];
    // (a scoped gun: the round lands on the crosshair - down the scope's own line, 150 m out)
    if (S) gun.aimPoint.copy(V(0, S.y, S.z1 + 150).applyMatrix4(gun.mesh.matrixWorld));
    else gun.aimPoint.copy(V(0, 0, 1).applyQuaternion(gun.mesh.quaternion).multiplyScalar(80).add(gun.mesh.position));
    const before = gun.cool;
    gun.fire();
    if (gun.cool > before && gun.chambered !== undefined) this.buzz('right', Math.min(1, 0.45 * (gun.M.kick || 1) + 0.2), 50);
  }

  /** No fumbling with magazines in VR: a fresh one, straight in. */
  reload() {
    const g = this.hero.gunHeld;
    if (!g || g.state !== 'held') return;
    if (g.ammo >= g.M.cap && g.chambered) return;
    g.abortReload();
    g.ammo = g.M.cap;
    if (g.mag) g.mag.visible = true;
    g.chambered = true; g.locked = false; g.pumpT = -1; g.boltT = -1; g.spent = false;
    this.sfx?.('magin', 0.8);
    this.buzz('right', 0.3, 40);
  }

  // ---- scopes: the rear lens shows what's down the tube, zoomed (its own little camera) ----
  scopeTick() {
    const g = this.hero.gunHeld, S = g && g.state === 'held' && SCOPES[g.type];
    if (this.scopeGun && this.scopeGun !== g) { this.scopeGun.userData_lens && (this.scopeGun.userData_lens.visible = false); this.scopeGun = null; }
    if (!S) return;
    if (!this.scopeRT) {
      this.scopeRT = new THREE.WebGLRenderTarget(400, 400);
      this.scopeRT.texture.colorSpace = THREE.SRGBColorSpace;
      this.scopeCam = new THREE.PerspectiveCamera(S.fov, 1, 0.08, 400);
      // the reticle: fine crosshair, thicker posts toward the edge, a black ring round it
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const x = c.getContext('2d');
      x.fillStyle = '#000';
      x.beginPath(); x.arc(128, 128, 128, 0, 6.3); x.arc(128, 128, 118, 0, 6.3, true); x.fill();
      x.fillRect(127, 0, 2, 256); x.fillRect(0, 127, 256, 2);
      for (const [a, b, w, hh] of [[124, 0, 8, 80], [124, 176, 8, 80], [0, 124, 80, 8], [176, 124, 80, 8]]) x.fillRect(a, b, w, hh);
      x.fillStyle = '#d22'; x.beginPath(); x.arc(128, 128, 2.5, 0, 6.3); x.fill();
      const rt = new THREE.CanvasTexture(c); rt.colorSpace = THREE.SRGBColorSpace;
      this.reticleMat = new THREE.MeshBasicMaterial({ map: rt, transparent: true, depthWrite: false, toneMapped: false, fog: false });
    }
    if (!g.userData_lens) {
      const lens = new THREE.Group();
      const view = new THREE.Mesh(new THREE.CircleGeometry(S.r * 1.05, 32), new THREE.MeshBasicMaterial({ map: this.scopeRT.texture, toneMapped: false, fog: false }));
      const ret = new THREE.Mesh(new THREE.CircleGeometry(S.r * 1.05, 32), this.reticleMat);
      ret.position.z = 0.0006; ret.renderOrder = 1;
      lens.add(view, ret);
      // (facing back down the gun, at you)
      lens.rotation.y = Math.PI;
      lens.position.set(0, S.y, S.z0 - 0.004);
      g.mesh.add(lens);
      g.userData_lens = lens;
    }
    const lens = g.userData_lens;
    lens.visible = true;
    this.scopeGun = g;
    // only drawn with your eye near enough to look through it
    lens.updateWorldMatrix(true, false);
    const near = _v.setFromMatrixPosition(lens.matrixWorld).distanceTo(this.headWorld(_w)) < 0.45;
    lens.children[0].material.color.setScalar(near ? 1 : 0.05);
    if (!near) return;
    const C = this.scopeCam;
    if (C.fov !== S.fov) { C.fov = S.fov; C.updateProjectionMatrix(); }
    _m.compose(_s.set(0, S.y, S.z1 + 0.02), _q.copy(FLIP), _w.set(1, 1, 1));
    _m.premultiply(g.mesh.matrixWorld).decompose(C.position, C.quaternion, _s);
    C.updateMatrixWorld(true);
    const R = this.renderer, xr = R.xr, was = xr.enabled, prev = R.getRenderTarget();
    lens.visible = false;
    xr.enabled = false;
    R.setRenderTarget(this.scopeRT);
    R.render(this.scene, C);
    R.setRenderTarget(prev);
    xr.enabled = was;
    lens.visible = true;
  }

  /**
   * A knife in someone, Bonelab style: it's locked on the line it went in along (no turning in
   * the wound - it's fixed to the body part), and only slides in or out along it. The flesh
   * grips: small hand movements don't shift it at all, bigger ones drag it a fraction at a time,
   * harder the deeper it is; at the hilt it stops dead. Pushed deeper it reaches what's inside.
   * Pull straight back to draw it out; wrench the hand well off the line and it tears free.
   */
  holdStuck(h, m, R, aR, pole, dt) {
    const S = m.stuckIn, mesh = m.mesh, A = S.actor;
    if (!mesh.parent || !A.hero.root.parent) { m.unstick(false); return; }
    S.goal = null; // (the hand drives it, not poseStuck)
    // a cutting edge turns in the wound with your wrist - slowly, carving round as it goes
    if (m.cutter && !S.chop) {
      R.grip.matrixWorld.decompose(_p, _q, _s);
      m.twistStuck(_q.multiply(MELEE_ROT).clone(), dt);
      if (m.stuckIn !== S) { this.prevSeg = null; return; }
    }
    mesh.updateMatrixWorld(true);
    const handle = V().setFromMatrixPosition(mesh.matrixWorld);
    const ctrl = V().setFromMatrixPosition(R.grip.matrixWorld);
    const inW = S.inL.clone().transformDirection(mesh.matrixWorld);
    const rel = ctrl.clone().sub(handle), push = rel.dot(inW), off = rel.addScaledVector(inW, -push).length();
    // (a chopper wedged in its kerf: drawn along its length, the edge slices on - chop.js)
    const K = S.chop;
    let along = 0;
    if (K) {
      const ax = _w.set(0, 1, 0).transformDirection(mesh.matrixWorld);
      const a = ctrl.dot(ax);
      if (S.lastAlong != null) along = a - S.lastAlong;
      S.lastAlong = a;
      if (Math.abs(along) > 0.05) along = 0; // (a jump: tracking, not a stroke)
    }
    // stabbed in (or stuck partway) with a cutting edge: drawn sideways, the edge cuts its way
    // on through from inside instead of being pulled out (slicing/BladeCutter.js beginCut)
    if (S.pierce && m.cutter) {
      const lat = S.lastOff != null ? (off - S.lastOff) / Math.max(dt, 1e-3) : 0;
      S.lastOff = off;
      if (off > 0.045 && lat > 0.6) {
        const A = S.actor, part = S.part;
        m.unstick(false);
        m.cutter.beginCut(A, part, lat);
        this.buzz('right', 0.7, 40);
        this.prevSeg = null;
        return;
      }
    }
    if (off > (K ? 0.28 : 0.2)) { this.ripOut(m); return; }
    // the grip of the flesh: a dead zone, then a lagging, speed-capped drag
    const GRIP = 0.008 + S.depth * 0.04;
    let dd = 0;
    if (Math.abs(push) > GRIP) {
      const want = push - Math.sign(push) * GRIP;
      const k = 1 - Math.exp(-dt * (push > 0 ? 9 : 12) / (1 + S.depth * 10));
      const cap = dt * (push > 0 ? 0.7 : 0.9);
      dd = Math.max(-cap, Math.min(cap, want * k));
    }
    // pushed on in, or drawn along: the kerf goes deeper - and through, the limb's off
    if (K && (dd > 0 || along)) {
      if (chopPush(m, K, Math.max(0, dd), along)) {
        this.buzz('right', 1, 90);
        m.unstick(true);
        this.prevSeg = null;
        return;
      }
      if (Math.abs(along) > 0.002) this.buzz('right', Math.min(1, 0.2 + Math.abs(along) / dt * 0.25), 25);
      // the edge sinks as the kerf deepens
      S.max = Math.max(S.max, Math.min(K.r * 2.05, K.k * K.r * 2 + 0.02));
    }
    // a cutting edge stuck edge first (the swing ran out in them): pushed on, it cuts on through
    if (m.cutter && !K && S.inL.z > 0.9 && dd > 0) {
      S.vrAcc = (S.vrAcc || 0) + dd;
      dd = 0;
      if (S.vrAcc > 0.008) {
        const go = S.vrAcc; S.vrAcc = 0;
        this.buzz('right', 0.6, 35);
        m.driveOn(go);
        if (!m.stuckIn) { this.prevSeg = null; return; }
      }
    }
    if (dd > 0 && S.depth + dd > S.max) {
      dd = Math.max(0, S.max - S.depth);
      // at the hilt: the push goes into them instead
      if (!A.remote && A.mode === 'ragdoll' && !A.pending && push > 0.05) A.pending = { imp: inW.clone().multiplyScalar(4 * push / 0.05), part: S.part, point: handle.clone() };
      this.buzz('right', 0.5, 30);
    }
    if (dd) {
      S.depth += dd;
      mesh.position.addScaledVector(_v.copy(S.inL).applyQuaternion(mesh.quaternion), dd);
      mesh.updateMatrixWorld(true);
      // you feel every bit of it
      this.buzz('right', Math.min(1, 0.15 + Math.abs(dd) / dt * 0.8), 25);
      if (Math.abs(dd) > 0.003 && Math.random() < 0.35) this.sfx?.('flesh', 0.18 + Math.abs(dd) * 15, { rate: dd > 0 ? 0.9 : 1.3 });
      // in deeper than it's been: what's along the new stretch of the track is cut
      if (S.depth > S.track + 0.02 && A.organs && !A.remote && !A.brain.dead) {
        const tip = V(0, m.def.seg[1], 0).applyMatrix4(mesh.matrixWorld);
        const from = tip.clone().addScaledVector(inW, -(S.depth - S.track));
        const o = A.organs.shot(from, inW, tip);
        if (o?.lethal) A.organs.die();
        A.onPain?.(S.part, 'pain', 0.6);
        S.track = S.depth;
      }
    }
    if (S.depth <= 0.004) {
      // out: drawn clean, a little blood after it
      m.unstick(true);
      this.prevSeg = null;
      return;
    }
    // the hand stays on the handle, wherever the controller wanders
    _m.multiplyMatrices(mesh.matrixWorld, sized(MELEE_ON, h)).decompose(_p, _q, _s);
    poseArm(h, aR, _p, _q, pole(aR));
    curl(aR, 1.5);
  }
  ripOut(m) {
    m.unstick(true);
    this.buzz('right', 0.8, 70);
    this.prevSeg = null;
  }

  /**
   * A cutting blade in the hand (slicing/BladeCutter.js): it doesn't go through the level - a
   * wall, the floor, a car push it back out (along the surface's normal, so it slides along it),
   * with a clank and a jolt the moment it meets it - and dragged through something tough it
   * lags behind the hand, as if held back by it.
   */
  bladeWorld(m, dt) {
    const mesh = m.mesh, cast = m.ctx.castSeg, C = m.cutter;
    // held back by the flesh it's in: the blade only goes a share of the way the hand does each
    // frame (more in bone), so it trails behind and you have to pull it through - up to a hand's
    // breadth behind, then it comes along. Out of them, it catches back up to the hand.
    m.cutLag ||= V();
    const sp = m.tipVel.length(), hold = C.hold();
    if (hold > 0 && m._bladeAt) {
      // the hand's move this frame, from where the blade was
      const want = _v.copy(mesh.position).sub(m._bladeAt);
      // deeper in is fought: only so fast (flesh ~1.3 m/s, bone ~0.5) and only a share of it;
      // drawing it back out the way it came goes easily
      const dir = C.holdDir, inward = want.dot(dir);
      if (inward > 0) {
        const maxIn = (1.2 - hold * 1.05) * dt; // (flesh ~0.6 m/s, bone ~0.2)
        const keep = Math.min(inward * (1 - hold * 0.75), maxIn);
        want.addScaledVector(dir, keep - inward);
      }
      // sideways through the flesh (dragging the cut along) is held back too, less
      const side = _w.copy(want).addScaledVector(dir, -want.dot(dir));
      want.addScaledVector(side, -hold * 0.7);
      const blade = m._bladeAt.clone().add(want);
      m.cutLag.subVectors(blade, mesh.position).clampLength(0, 0.22);
      // the strain of it, in the hand: harder the further it's held back
      const now = performance.now();
      if (now - (m._strainT || 0) > 50) { m._strainT = now; this.buzz('right', Math.min(1, 0.25 + m.cutLag.length() * 6), 45); }
    } else m.cutLag.multiplyScalar(Math.exp(-dt * 14));
    mesh.position.add(m.cutLag);
    (m._bladeAt ||= V()).copy(mesh.position);
    mesh.updateMatrixWorld(true);
    if (!cast) return;
    const hilt = _w.set(0, 0, 0).applyMatrix4(mesh.matrixWorld).clone();
    const tip = V(0, m.def.seg[1] + 0.02, 0).applyMatrix4(mesh.matrixWorld);
    const hit = cast(hilt, tip);
    if (!hit) { m._wall = false; return; }
    // out of it: the part of the blade past the surface, moved back to it
    const depth = tip.clone().sub(hit.point).dot(hit.normal);
    if (depth < 0) mesh.position.addScaledVector(hit.normal, -depth + 0.004);
    mesh.updateMatrixWorld(true);
    if (!m._wall && sp > 1.5) {
      this.sfx?.(m.def.ground || 'clank', Math.min(1, 0.25 + sp / 14));
      this.buzz('right', Math.min(1, 0.4 + sp / 12), 50);
    }
    m._wall = true;
  }

  holdMelee(h, m, R, aR, pole, dt) {
    R.grip.matrixWorld.decompose(_p, _q, _s);
    _q.multiply(MELEE_ROT);
    const mesh = m.mesh;
    mesh.position.copy(_p);
    if (m.def.saw && m.sawOff) mesh.position.add(m.sawOff);
    mesh.quaternion.copy(_q);
    mesh.updateMatrixWorld(true);
    if (m.cutter) this.bladeWorld(m, dt);
    const gm = mesh.matrixWorld;
    m.vel.copy(mesh.position).sub(m.lastPos).divideScalar(Math.max(dt, 1e-3));
    if (m.vel.length() > 30) m.vel.set(0, 0, 0);
    m.lastPos.copy(mesh.position);
    _m.multiplyMatrices(gm, sized(MELEE_ON, h)).decompose(_p, _q, _s);
    poseArm(h, aR, _p, _q, pole(aR));
    curl(aR, 1.5);
    // contact: the business end, swept from last frame to this one
    const d = m.def;
    const a1 = V(0, d.seg[0], 0).applyMatrix4(gm), b1 = V(0, d.seg[1], 0).applyMatrix4(gm);
    const P = this.prevSeg;
    this.prevSeg = { a: a1, b: b1, m };
    if (!P || P.m !== m) return;
    const a0 = P.a, b0 = P.b;
    m.tipVel.copy(b1).sub(b0).divideScalar(Math.max(dt, 1e-3)).clampLength(0, 40);
    const fast = m.tipVel.length();
    // a cutting edge (the machete): swept through whatever it's in, cut where it really went
    // (slicing/BladeCutter.js); stalled or stabbed in, it's stuck there now (holdStuck)
    if (m.cutter) {
      m.cutter.haptic = (v, ms) => this.buzz('right', v, ms);
      m.cutter.step(dt, { live: true, handVel: m.vel });
      if (m.stuckIn) { this.prevSeg = null; return; }
    }
    // the saw: worked back and forth for real, against whoever its teeth are on
    if (d.saw) {
      m.onSawStroke = (k) => this.buzz('right', Math.min(1, 0.35 + k * 0.4), 60);
      m.sawDrag = sawStep(m, this.hero, dt, this.actors, true);
      return;
    }
    if (fast > 4) m.trail.push(V(0, (d.seg[0] + d.seg[1]) * 0.5, 0).applyMatrix4(gm), V(0, d.seg[1] + 0.01, 0).applyMatrix4(gm), Math.min(1, (fast - 4) / 10));
    // a knife eased in point first, slowly: no blow, it just starts to go in (and is pushed on from there)
    if (d.stab && fast < 2.5) {
      if (fast < 0.5 || m.tipVel.dot(_v.subVectors(b1, a1).normalize()) < fast * 0.7) return;
      const hit = sweep(a0, b0, a1, b1, d.r, this.actors, this.hero, new Set(this.hitSkip.keys()));
      if (!hit || !hit.actor.groups?.[hit.part] || hit.actor.remote) return;
      hit.actor.wounds?.stab(hit.part, hit.point, hit.normal || _v.clone().negate(), m.tipVel.clone(), _v.clone(), 0.5);
      m.stickIn(hit, m.tipVel.clone(), _v.clone(), 1);
      this.prevSeg = null;
      this.buzz('right', 0.4, 40);
      return;
    }
    if (fast < 2.5) return;
    const skip = new Set(this.hitSkip.keys());
    // (never your own body: a swing in VR passes right through you)
    const hit = sweep(a0, b0, a1, b1, d.r, this.actors, this.hero, skip);
    if (hit) {
      // (melee.js land: the blow, the cut, the sound - it logs the hit on a swing)
      m.swing = { keys: [], t: 0, dur: 1, liveEnd: 1, hit: new Set(), whoosh: true, style: null, world: true };
      m.land(hit, a0, b0, a1, b1, dt, 1);
      m.swing = null;
      // (a knife stays in them till you pull it back out; anything else springs free)
      if (m.stuckIn && !d.stab && !m.stuckIn.chop && !m.stuckIn.pierce) m.unstick(true, true);
      if (m.stuckIn) this.prevSeg = null;
      this.hitSkip.set(hit.actor, performance.now());
      skip.add(hit.actor);
      this.buzz('right', Math.min(1, 0.3 + fast / 18), 70);
    }
    m.slashLoose(a0, b0, a1, b1, dt, 1, skip);
  }

  // ---- the menu: point with either hand, pull the trigger ----
  buildMenu() {
    const c = document.createElement('canvas');
    const L = this.MENU;
    const cw = this.menuPage === 'settings' ? 1024 : 512;
    const ch = Math.max(...L.map((b) => b.y + b.h)) + 40;
    c.width = cw; c.height = ch;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const pw = cw === 1024 ? 0.85 : 0.5;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, pw * ch / cw),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
    mesh.renderOrder = 999;
    mesh.frustumCulled = false;
    mesh.userData = { c, tex, hover: -2, n: this.MENU.length, page: this.menuPage, tab: this.setTab };
    // a pointer line from whichever hand is aiming at it
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffd65a, transparent: true, opacity: 0.8, depthTest: false, fog: false });
    this.laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(), V(0, 0, -1)]), lineMat);
    this.laser.renderOrder = 1000;
    this.laser.frustumCulled = false;
    this.laser.visible = false;
    this.rig.add(mesh, this.laser);
    this.rc = new THREE.Raycaster();
    return mesh;
  }
  // buttons, in canvas pixels
  get MENU() {
    if (this.menuPage === 'settings') {
      // Back, then a tab per section (Gore, Graphics, Audio); the tab's settings below it:
      // on/off switches two to a row, sliders (volumes, the blood colour) a row each
      const tab = SCHEMA.find((c) => c.name === this.setTab) || SCHEMA[0];
      const rows = [{ label: 'Back', act: () => this.openPage('main'), x: 30, y: 30, w: 200, h: 80, keep: true }];
      const tw = (964 - 220 - 2 * 12) / SCHEMA.length;
      SCHEMA.forEach((c, i) => rows.push({
        label: c.name, tab: true, on: c === tab, keep: true,
        x: 250 + i * (tw + 12), y: 30, w: tw, h: 80,
        act: () => { if (c !== tab) { this.setTab = c.name; this.openPage('settings'); } },
      }));
      let y = 130, col = 0;
      for (const it of tab.items) {
        if (it.type === 'range' || it.type === 'select') {
          if (col) { y += 82; col = 0; }
          rows.push({ label: it.label, k: it.k, it, slider: true, keep: true, x: 30, y, w: 964, h: 70, act: () => {} });
          y += 82;
        } else {
          rows.push({ label: it.label, k: it.k, keep: true, x: 30 + col * 492, y, w: 472, h: 70, act: () => setSetting(it.k, !settings[it.k]) });
          if (col) { y += 82; col = 0; } else col = 1;
        }
      }
      return rows;
    }
    return [
      ...(this.canStartRound?.() ? [{ label: 'Start round', act: () => this.startRound?.() }] : []),
      ...(this.noReset ? [] : [{ label: 'Reset world', act: () => this.resetWorld?.() }]),
      { label: 'Clear blood', act: () => this.clearBlood?.() },
      { label: 'Settings', act: () => this.openPage('settings'), keep: true },
      { label: 'Calibrate height', act: () => this.calibrate() },
      ...(this.backToMenu ? [{ label: 'Back to menu', act: () => this.backToMenu() }] : []),
    ].map((b, i) => ({ ...b, x: 30, y: 40 + i * 120, w: 452, h: 100 }));
  }
  /** A slider row's track, in canvas pixels. */
  sliderTrack(b) { return { x0: b.x + 360, x1: b.x + b.w - 130 }; }
  /** The pointer at canvas x on slider row b: its setting to the value there. */
  slide(b, px) {
    const { x0, x1 } = this.sliderTrack(b), it = b.it;
    const f = Math.min(1, Math.max(0, (px - x0) / (x1 - x0)));
    if (it.type === 'select') {
      const n = it.opts.length;
      setSetting(it.k, it.opts[Math.min(n - 1, Math.floor(f * n))][0]);
    } else {
      const v = Math.round((it.min + f * (it.max - it.min)) / it.step) * it.step;
      setSetting(it.k, +v.toFixed(4));
    }
  }
  /** Draw slider row b's track and value (a row of colour swatches for a select: the blood colour). */
  drawSlider(g, b, hov) {
    const { x0, x1 } = this.sliderTrack(b), it = b.it, cy = b.y + b.h / 2;
    let text;
    if (it.type === 'select') {
      const n = it.opts.length, w = (x1 - x0) / n, cur = it.opts.findIndex(([k]) => k === settings[it.k]);
      it.opts.forEach(([k], i) => {
        const ink = INKS.findIndex((x) => x.name === k);
        // (natural: everyone bleeds their own - shown as a split of red and the rest)
        const [r, gg, bb] = shade(ink < 0 ? 0 : ink, 0.62, 0.03, 0.035);
        g.fillStyle = `rgb(${r * 255 | 0},${gg * 255 | 0},${bb * 255 | 0})`;
        g.beginPath(); g.roundRect(x0 + i * w + 3, cy - 20, w - 6, 40, 8); g.fill();
        if (ink < 0) { g.fillStyle = '#fff'; g.font = 'bold 20px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('N', x0 + i * w + w / 2, cy + 1); }
        if (i === cur) { g.strokeStyle = hov ? '#15130c' : '#fff'; g.lineWidth = 4; g.beginPath(); g.roundRect(x0 + i * w, cy - 24, w, 48, 10); g.stroke(); }
      });
      text = it.opts[cur]?.[1] ?? '';
    } else {
      const f = (settings[it.k] - it.min) / (it.max - it.min);
      g.fillStyle = hov ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.18)';
      g.beginPath(); g.roundRect(x0, cy - 6, x1 - x0, 12, 6); g.fill();
      g.fillStyle = hov ? '#15130c' : '#4fbf6a';
      g.beginPath(); g.roundRect(x0, cy - 6, Math.max(12, (x1 - x0) * f), 12, 6); g.fill();
      g.fillStyle = hov ? '#15130c' : '#fff';
      g.beginPath(); g.arc(x0 + (x1 - x0) * f, cy, 16, 0, Math.PI * 2); g.fill();
      text = it.fmt ? it.fmt(settings[it.k]) : String(settings[it.k]);
    }
    g.fillStyle = hov ? '#15130c' : '#f2f0ea';
    g.font = 'bold 24px system-ui, sans-serif';
    g.textAlign = 'right';
    g.fillText(text, b.x + b.w - 16, cy + 1);
  }
  /** Switch the menu to another page, in the same spot. */
  openPage(page) {
    this.menuPage = page;
    this.menu.visible = false;
    this.toggleMenu(true);
  }
  drawMenu(hover) {
    const W = this.menu, { c, tex } = W.userData;
    if (W.userData.hover === hover) return;
    W.userData.hover = hover;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(18,18,22,0.85)';
    g.beginPath(); g.roundRect(0, 0, c.width, c.height, 28); g.fill();
    this.MENU.forEach((b, i) => {
      const on = b.k && !b.slider ? !!settings[b.k] : null;
      g.fillStyle = i === hover ? '#ffd65a' : b.tab && b.on ? 'rgba(255,214,90,0.35)' : on === false ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)';
      g.beginPath(); g.roundRect(b.x, b.y, b.w, b.h, 18); g.fill();
      g.fillStyle = i === hover ? '#15130c' : on === false ? '#8d8a84' : '#f2f0ea';
      g.textBaseline = 'middle';
      if (b.slider) {
        g.font = 'bold 26px system-ui, sans-serif';
        g.textAlign = 'left';
        let t = b.label;
        while (g.measureText(t).width > 330 && t.length > 4) t = t.slice(0, -2) + '…';
        g.fillText(t, b.x + 18, b.y + b.h / 2 + 1);
        this.drawSlider(g, b, i === hover);
      } else if (b.k) {
        // a setting: its name, and an on/off pill at the right
        g.font = 'bold 26px system-ui, sans-serif';
        g.textAlign = 'left';
        let t = b.label;
        while (g.measureText(t).width > b.w - 130 && t.length > 4) t = t.slice(0, -2) + '…';
        g.fillText(t, b.x + 18, b.y + b.h / 2 + 1);
        const px = b.x + b.w - 96, py = b.y + b.h / 2 - 18;
        g.fillStyle = on ? '#4fbf6a' : 'rgba(255,255,255,0.18)';
        g.beginPath(); g.roundRect(px, py, 78, 36, 18); g.fill();
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(on ? px + 60 : px + 18, py + 18, 14, 0, Math.PI * 2); g.fill();
      } else {
        g.font = `bold ${b.tab || b.label === 'Back' && b.w < 300 ? 34 : 42}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
      }
    });
    tex.needsUpdate = true;
  }
  toggleMenu(keepPage = false) {
    if (this.menu?.visible) { this.menu.visible = false; this.laser.visible = false; return; }
    if (!keepPage) this.menuPage = 'main';
    // (built for a different set of buttons - Back to menu comes and goes with the map, the
    // settings page is its own size: again, to fit)
    if (this.menu && (this.menu.userData.n !== this.MENU.length || this.menu.userData.page !== this.menuPage || this.menu.userData.tab !== this.setTab)) {
      this.menu.removeFromParent(); this.menu.geometry.dispose(); this.menu.material.map.dispose(); this.menu.material.dispose();
      this.laser.removeFromParent(); this.laser.geometry.dispose(); this.laser.material.dispose();
      this.menu = null;
    }
    this.menu ||= this.buildMenu();
    if (this.wheel) this.wheel.visible = false;
    const M = this.menu;
    // half a metre in front of your eyes, a little below, facing you
    _v.set(0, 0, -1).applyQuaternion(this.camera.quaternion).setY(0);
    if (_v.lengthSq() < 1e-4) _v.set(0, 0, -1);
    _v.normalize();
    // (the big settings page a little further off, so it all fits in view)
    const big = this.menuPage === 'settings';
    M.position.copy(this.camera.position).addScaledVector(_v, big ? 0.85 : 0.55);
    M.position.y -= big ? 0.05 : 0.12;
    M.lookAt(this.headWorld(_w));
    M.visible = true;
    M.userData.hover = -2;
    this.menuHover = -1;
    this.drawMenu(-1);
    this.menuTrig = { left: true, right: true }; // (a trigger already down doesn't click)
    this.buzz('left', 0.2, 30);
  }
  updateMenu() {
    const M = this.menu;
    let hover = -1, by = null, dist = 0;
    for (const hand of ['right', 'left']) {
      const slot = this.hands[hand];
      if (!slot?.ray.visible) continue;
      slot.ray.matrixWorld.decompose(_p, _q, _s);
      this.rc.set(_p, _v.set(0, 0, -1).applyQuaternion(_q));
      const hit = this.rc.intersectObject(M, false)[0];
      if (!hit) continue;
      const { c } = M.userData, px = hit.uv.x * c.width, py = (1 - hit.uv.y) * c.height;
      const i = this.MENU.findIndex((b) => px > b.x && px < b.x + b.w && py > b.y && py < b.y + b.h);
      by = slot; dist = hit.distance;
      if (i >= 0) hover = i;
      const down = this.btnDown(hand, 0), was = this.menuTrig[hand];
      this.menuTrig[hand] = down;
      // a slider: pressed on it, it follows the pointer for as long as the trigger is held
      if (down && !was && i >= 0 && this.MENU[i].slider) this.sliding = this.MENU[i].k;
      if (!down) this.sliding = null;
      if (this.sliding) {
        const rows = this.MENU, b = rows.find((r) => r.k === this.sliding && r.slider);
        if (b) {
          const before = settings[b.k];
          this.slide(b, px);
          if (settings[b.k] !== before) { this.buzz(hand, 0.12, 12); M.userData.hover = -2; }
        }
        hover = rows.indexOf(b);
        if (!was) this.buzz(hand, 0.5, 50);
        this.menuHover = hover;
        this.drawMenu(hover);
        this.laser.visible = true;
        this.laser.position.copy(slot.ray.position); this.laser.quaternion.copy(slot.ray.quaternion); this.laser.scale.set(1, 1, hit.distance);
        return;
      }
      if (down && !was && i >= 0) {
        this.buzz(hand, 0.5, 50);
        const b = this.MENU[i];
        b.act();
        if (b.keep) { if (this.menu === M) { M.userData.hover = -2; this.drawMenu(i); } return; }
        M.visible = false; this.laser.visible = false;
        return;
      }
      break;
    }
    for (const hand of ['right', 'left']) if (this.hands[hand] !== by) this.menuTrig[hand] = this.btnDown(hand, 0);
    if (hover !== this.menuHover) { this.menuHover = hover; if (hover >= 0) this.buzz(by === this.hands.left ? 'left' : 'right', 0.15, 20); }
    this.drawMenu(hover);
    // the pointer line
    this.laser.visible = !!by;
    if (by) {
      this.laser.position.copy(by.ray.position);
      this.laser.quaternion.copy(by.ray.quaternion);
      this.laser.scale.set(1, 1, dist);
    }
  }

  // ---- the weapon wheel ----
  buildWheel() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
    mesh.renderOrder = 999;
    mesh.frustumCulled = false;
    mesh.userData = { c, tex, sel: -2 };
    this.rig.add(mesh);
    return mesh;
  }
  drawWheel(sel) {
    const W = this.wheel, { c, tex } = W.userData;
    if (W.userData.sel === sel && W.userData.page === this.page) return;
    W.userData.sel = sel; W.userData.page = this.page;
    const WHEEL = this.items, P = WHEEL_PAGES[this.page];
    const g = c.getContext('2d'), N = WHEEL.length, cx = 256, R0 = 80, R1 = 248;
    g.clearRect(0, 0, 512, 512);
    // the hub: which page, and arrows to the others
    g.beginPath(); g.arc(cx, cx, R0 - 6, 0, Math.PI * 2); g.fillStyle = 'rgba(18,18,22,0.85)'; g.fill();
    g.fillStyle = '#ffd65a'; g.font = 'bold 26px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(P.name, cx, cx - 10);
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = 'bold 22px system-ui, sans-serif';
    g.fillText((this.page + 1) + '/' + WHEEL_PAGES.length + '  \u25B6', cx, cx + 20);
    const cur = this.currentType();
    for (let i = 0; i < N; i++) {
      // slice i: centred straight up, going round clockwise
      const mid = -Math.PI / 2 + (i / N) * Math.PI * 2, a0 = mid - Math.PI / N + 0.025, a1 = mid + Math.PI / N - 0.025;
      g.beginPath();
      g.arc(cx, cx, R1, a0, a1);
      g.arc(cx, cx, R0, a1, a0, true);
      g.closePath();
      g.fillStyle = i === sel ? 'rgba(255,214,90,0.95)' : 'rgba(18,18,22,0.8)';
      g.fill();
      g.lineWidth = 4;
      g.strokeStyle = WHEEL[i].type === cur ? 'rgba(255,214,90,0.95)' : 'rgba(255,255,255,0.15)';
      g.stroke();
      const r = (R0 + R1) / 2;
      g.fillStyle = i === sel ? '#15130c' : '#f2f0ea';
      g.font = 'bold 34px system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(WHEEL[i].name, cx + Math.cos(mid) * r, cx + Math.sin(mid) * r);
    }
    tex.needsUpdate = true;
  }
  get items() { return WHEEL_PAGES[this.page || 0].items; }
  flipPage(d) {
    const n = WHEEL_PAGES.length;
    this.page = ((this.page || 0) + d + n) % n;
    this.sel = -1;
    this.buzz('right', 0.3, 30);
    this.drawWheel(-1);
  }
  currentType() {
    const A = this.hero;
    if (A.gunHeld) return A.gunHeld.type;
    if (A.meleeHeld) return A.meleeHeld.type;
    if (this.nade) return 'nade:' + this.nade.kind;
    return null;
  }
  openWheel() {
    if (this.noWheel) return; // (the multiplayer arena: you fight with what you spawned with)
    const R = this.hands.right;
    if (!R?.grip.visible) return;
    this.wheel ||= this.buildWheel();
    const W = this.wheel;
    W.position.copy(R.grip.position);
    W.lookAt(this.headWorld(_w));
    W.visible = true;
    W.userData.sel = -2;
    this.sel = -1;
    // (opens on the page of what's in hand)
    const cur = this.currentType();
    const pi = WHEEL_PAGES.findIndex((p) => cur && p.items.some((it) => it.type === cur));
    if (pi >= 0) this.page = pi;
    this.page ??= 0;
    this.drawWheel(-1);
    this.buzz('right', 0.2, 30);
  }
  updateWheel() {
    const R = this.hands.right, W = this.wheel;
    if (!R) return;
    // how far the hand's moved from where the wheel opened, in the wheel's plane
    _v.copy(R.grip.position).sub(W.position).applyQuaternion(_q.copy(W.quaternion).invert());
    let sel = -1;
    if (Math.hypot(_v.x, _v.y) > 0.045) {
      const N = this.items.length, a = Math.atan2(-_v.y, _v.x) + Math.PI / 2; // 0 up, clockwise
      sel = ((Math.round(a / (Math.PI * 2 / N)) % N) + N) % N;
    }
    if (sel !== this.sel) { this.sel = sel; if (sel >= 0) this.buzz('right', 0.15, 20); }
    this.drawWheel(sel);
  }
  closeWheel(pick) {
    const W = this.wheel;
    if (!W?.visible) return;
    if (pick) this.updateWheel();
    W.visible = false;
    if (pick && this.sel >= 0) {
      const t = this.items[this.sel].type;
      if (t !== this.currentType()) { this.equip(t); this.prevSeg = null; this.twoHand = false; this.buzz('right', 0.4, 40); }
    }
  }
}
