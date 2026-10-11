import * as THREE from 'three';
import { poseArm } from './gun.js';
import { bodyFrame, curl } from './melee.js';
import { sweep } from './strike.js';

/*
  The queen bee's powers (special.js look.queenBee, the body is bee.js):
    hold I    - she reaches back and pulls her stinger out of her abdomen: it's in her hand
                (hold I again to put it back)
    click     - with it out, a stab: a little damage, and venom in them (actor.js: A.venom)
                - and a bee that stings dies: a few seconds later, so does she
    R R       - a lunge: a leap forward the way you're looking; with the stinger out it stabs
                the whole way there, and whoever's in the way gets it
  Venom (venomTick, every body): it burns and drains a little, and every so often they reel.
  It wears off over half a minute or so.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const PULL = 0.55;   // s of holding I to pull it (or put it back)
const STAB = 0.34;   // s a stab takes
const LUNGE = 0.55;  // s a lunge's stab lasts
const DIE_AFTER = 3; // s from a sting landing to the bee dying
const STING = { kind: 'blade', stab: true, mass: 0.35, sev: 0.32, ref: 8, maxImp: 22, venom: 1 };
const _o = V(), _yq = new THREE.Quaternion(), _iq = new THREE.Quaternion(), _hp = V(), _hq = new THREE.Quaternion(), _s = V(), _pole = V();

function buildHeld() {
  const m = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.2, 8), new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 0.35, metalness: 0.2 }));
  m.geometry.rotateX(Math.PI / 2).translate(0, 0, 0.1); // (base at the origin, tip along +z)
  m.castShadow = true;
  return m;
}

export class Queen {
  /** ctx: { hero, actors, scene, sfx, aimDir(), onSting?(actor) } */
  constructor(ctx) {
    this.ctx = ctx;
    this.holdI = false;
    this.holdT = 0;
    this.out = false;
    this.stab = null;      // { t, dur, hit }
    this.dieT = -1;        // counting down to the end, once a sting's landed
    this.held = buildHeld();
    this.held.visible = false;
    ctx.scene.add(this.held);
    this.hook = (h, dt) => this.pose(h, dt);
    this.prevHook = null;
    this.reach = 0;        // 0..1: the hand going back for the stinger / bringing it round
    this.tip0 = V(); this.base0 = V();
  }
  get A() { return this.ctx.hero; }
  get on() { const A = this.A; return !!A.hero.look?.queenBee; }
  can() { const A = this.A; return this.on && A.mode === 'anim' && !A.seat && !A.brain.dead; }

  keyI(down) { this.holdI = down; if (!down) this.holdT = 0; }
  /** A click: with the stinger out, a stab (true: taken). */
  click() {
    if (!this.out || !this.can()) return false;
    if (!this.stab) this.stab = { t: 0, dur: STAB, hit: false };
    return true;
  }
  /** Double-tapped R: a lunge the way we look. */
  lunge() {
    if (!this.can() || !this.A.hero.grounded) return false;
    const h = this.A.hero, d = this.ctx.aimDir().clone().setY(0);
    if (d.lengthSq() < 1e-6) return false;
    d.normalize();
    h.vel.x = d.x * 10.5; h.vel.z = d.z * 10.5;
    h.vy = 3.4;
    h.grounded = false;
    h.jumped = true;
    h.yaw = Math.atan2(d.x, d.z);
    for (const l of h.legs) l.swinging = false;
    this.ctx.sfx('whoosh', 0.7, { rate: 0.75, vary: 0.1 });
    if (this.out) this.stab = { t: 0, dur: LUNGE, hit: false, lunge: true };
    return true;
  }

  setOut(on) {
    const A = this.A, h = A.hero;
    this.out = on;
    if (h.stinger) h.stinger.visible = !on && this.dieT < 0;
    this.held.visible = on;
    if (on) {
      if (h.armHook !== this.hook) { this.prevHook = h.armHook; h.armHook = this.hook; }
      this.ctx.sfx('chop', 0.35, { rate: 1.6, vary: 0.1 });
    } else {
      if (h.armHook === this.hook) h.armHook = this.prevHook;
      if (!this.prevHook) h.twist = 0;
      this.prevHook = null;
      this.stab = null;
    }
  }

  update(dt) {
    const A = this.A, h = A.hero;
    if (!this.on) { if (this.out) this.setOut(false); this.dieT = -1; return; }
    // (back from the dead: whole again, the stinger where it belongs)
    if (!A.brain.dead && this.dead) { this.dead = false; this.dieT = -1; if (h.stinger) h.stinger.visible = true; }
    if (A.brain.dead) { this.dead = true; if (this.out) this.setOut(false); return; }
    // she's stung someone: it's over for her soon
    if (this.dieT >= 0) {
      this.dieT -= dt;
      if (this.dieT <= 0) { this.dieT = -1; A.organs?.die(); return; }
    }
    if (this.out && (A.mode !== 'anim' || A.seat || h.armHook !== this.hook)) this.setOut(false);
    // holding I: the hand goes back for it (or puts it back), and at the end of the hold it's done
    if (this.holdI && this.can() && this.dieT < 0) {
      this.holdT += dt;
      if (h.armHook !== this.hook) { this.prevHook = h.armHook; h.armHook = this.hook; }
      if (this.holdT >= PULL) { this.holdT = -1e9; this.setOut(!this.out); }
    } else if (!this.out && h.armHook === this.hook) { h.armHook = this.prevHook; this.prevHook = null; }
    if (this.stab) {
      this.stab.t += dt;
      if (this.stab.t >= this.stab.dur) this.stab = null;
    }
  }

  /** The arm: reaching back to the abdomen while I's held, the stinger held ready, the stab. */
  pose(h, dt) {
    if (this.prevHook) this.prevHook(h, dt);
    const a = h.arms[1], side = a.side;
    bodyFrame(h, _o, _yq);
    _iq.copy(_yq).invert();
    a.hand.updateWorldMatrix(true, false);
    a.hand.matrixWorld.decompose(_hp, _hq, _s);
    const ready = V(side * 0.2, 0.12, 0.34), back = V(side * 0.16, -0.22, -0.26), thrust = V(side * 0.05, 0.14, 0.66);
    const pulling = this.holdI && this.holdT > 0;
    this.reach = lerp(this.reach, pulling ? 1 : 0, Math.min(1, dt * 10));
    let p;
    if (this.stab) {
      const S = this.stab, u = S.lunge ? smooth(S.t / 0.15) * (1 - smooth((S.t - S.dur + 0.12) / 0.12)) : Math.sin(Math.PI * clamp(S.t / S.dur, 0, 1));
      p = ready.clone().lerp(thrust, u);
    } else if (this.out) p = ready.clone().lerp(back, this.reach * 0.8);
    else {
      // (no stinger in hand: the arm just goes back for it while I's held, and home again)
      if (this.reach < 0.02 && !pulling) return;
      const loco = _hp.clone().sub(_o).applyQuaternion(_iq);
      p = loco.lerp(back, this.reach);
    }
    const wp = p.applyQuaternion(_yq).add(_o);
    const f = h.forward(V());
    _pole.set(f.z * side, 0, -f.x * side).multiplyScalar(0.8).addScaledVector(V(0, 1, 0), -0.6).addScaledVector(f, -0.3).normalize();
    poseArm(h, a, wp, _hq, _pole);
    curl(a, this.out ? 1 : 0.5);
    if (!this.out) return;
    // the stinger in her fist, pointing where she's looking
    a.hand.updateWorldMatrix(true, false);
    a.hand.getWorldPosition(_hp);
    const d = this.ctx.aimDir().clone();
    if (!this.stab) d.lerp(f, 0.5);
    d.normalize();
    this.held.position.copy(_hp);
    this.held.quaternion.setFromUnitVectors(V(0, 0, 1), d);
    this.strike(_hp, d);
  }

  /** The stab's point, swept from last frame's to this one's: the first body it meets gets it. */
  strike(base, d) {
    const tip = base.clone().addScaledVector(d, 0.22);
    const S = this.stab;
    if (S && !S.hit && S.t > 0.04 && (S.lunge || S.t < S.dur * 0.6)) {
      const hit = sweep(this.base0, this.tip0, base, tip, 0.025, this.ctx.actors, this.A, null);
      if (hit && !hit.actor.god) {
        S.hit = true;
        const vel = d.clone().multiplyScalar(S.lunge ? 11 : 8);
        hit.actor.struck(hit.part, hit.point, vel, hit.normal, { ...STING, axis: d.clone() }, this.A);
        this.ctx.sfx('flesh', 0.6, { vary: 0.12 });
        this.ctx.onSting?.(hit.actor);
        // the stinger stays in them (it's gone from her hand) - and a bee that stings dies
        this.setOut(false);
        this.dieT = DIE_AFTER;
        if (this.A.hero.stinger) this.A.hero.stinger.visible = false;
      }
    }
    this.base0.copy(base);
    this.tip0.copy(tip);
  }
}

/**
 * Venom, in everyone this copy simulates: it burns (pain), drains a little blood, and every few
 * seconds they reel. Our own dose tints the screen (el). Wears off by itself.
 */
export function venomTick(actors, dt, hero, el) {
  for (const A of actors) {
    if (!(A.venom > 0)) continue;
    A.venom = Math.max(0, A.venom - dt / 30);
    if (A.remote || A.brain.dead || A.god) continue;
    const k = Math.min(1, A.venom);
    const O = A.organs;
    if (O) { O.blood = Math.max(0.05, O.blood - 0.0035 * k * dt); O.state.pain = Math.max(O.state.pain || 0, 0.35 * k); }
    A.venomReel = (A.venomReel ?? 2 + Math.random() * 3) - dt;
    if (A.venomReel <= 0) {
      A.venomReel = 3 + Math.random() * 4 / (0.5 + k);
      if (A.mode === 'anim' && !A.seat && Math.random() < 0.3 + 0.5 * k) A.goRagdoll('stumble', { balance: 0.7 - 0.25 * k, decay: 0.15 + 0.2 * k });
    }
  }
  if (el) {
    const v = hero.brain.dead ? 0 : Math.min(1, hero.venom || 0);
    const q = Math.round(v * 30) / 30;
    if (el._q !== q) { el._q = q; el.style.opacity = String(q * 0.85); }
  }
}
