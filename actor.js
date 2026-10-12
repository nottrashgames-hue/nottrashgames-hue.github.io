import * as THREE from 'three';
import { Character } from './character.js';
import { Ragdoll } from './ragdoll.js';
import { Brain } from './brain.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { groups, G_PROXY, G_BODY, G_QUERY } from './physics.js';
import { poseArm } from './gun.js';
import { clutchReach } from './ik.js';
import { GetUp } from './life.js';
import { blowDent } from './dent.js';
import { blocks, guardHit } from './melee.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const H = 1 / 240;

/**
 * Owns the animated Character and its physical Ragdoll, and switches between them:
 *   anim     - procedural locomotion drives the body
 *   ragdoll  - physics drives the body, the Brain drives the muscles
 *   blend    - the physical pose eases back into the animated one
 */
// each part's parent, root first (the order joints are pinned in)
const JOINT_PARENT = [
  ['spine', 'pelvis'], ['chest', 'spine'], ['head', 'chest'],
  ['thighL', 'pelvis'], ['shinL', 'thighL'], ['footL', 'shinL'],
  ['thighR', 'pelvis'], ['shinR', 'thighR'], ['footR', 'shinR'],
  ['upperL', 'chest'], ['foreL', 'upperL'], ['upperR', 'chest'], ['foreR', 'upperR'],
];
const _pj = new THREE.Vector3();

export class Actor {
  constructor(scene, world, look = {}) {
    this.world = world;
    this.god = !!look.invincible;
    this.hero = new Character(scene, look);
    this.hero.actor = this; // (for costume parts that act on how it is: spider.js)
    this.proxy = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -5, 0));
    world.createCollider(
      RAPIER.ColliderDesc.capsule(0.55, 0.26).setFriction(0.4).setCollisionGroups(groups(G_PROXY, G_BODY | G_QUERY)),
      this.proxy);
    (world.proxyOwner ||= new Map()).set(this.proxy.handle, this);
    this.rd = new Ragdoll(world, this.hero.S, this.hero.kA, this.hero.kL);
    this.brain = new Brain(this.rd);
    this.mode = 'anim';
    this.acc = 0;
    this.cur = {};
    this.prev = {};
    this.lastDt = 1 / 60;
    this.pending = null;
    this._focus = V();

    const h = this.hero;
    this.groups = { pelvis: h.hips, spine: h.spine, chest: h.chest, head: h.neck };
    for (const [i, n] of [[0, 'L'], [1, 'R']]) {
      this.groups['thigh' + n] = h.legs[i].thigh;
      this.groups['shin' + n] = h.legs[i].shin;
      this.groups['foot' + n] = h.legs[i].foot;
      this.groups['upper' + n] = h.arms[i].upper;
      this.groups['fore' + n] = h.arms[i].fore;
    }
    this.capture(this.cur);
    this.capture(this.prev);
  }

  /**
   * A pose from somewhere else (a network snapshot): any part that's come away from where
   * its joint holds it (the owner's copy had it cut off - a massless ghost drifting in their
   * physics - or the snapshot's just wrong) is put back on its joint. Parents come first.
   */
  pinJoints(pose, slack = 0.05) {
    // (the ragdoll's own joints: a part's origin sits at def.anchor in its parent's frame)
    const D = this.rd.defs;
    for (const [n, par] of JOINT_PARENT) {
      const o = pose[n], pp = pose[par], d = D[n];
      if (!o || !pp || !d?.anchor || d.parent !== par) continue;
      const want = _pj.set(d.anchor.x, d.anchor.y, d.anchor.z).applyQuaternion(pp.quat).add(pp.pos);
      if (o.pos.distanceToSquared(want) > slack * slack) o.pos.copy(want);
    }
    return pose;
  }

  get pos() { return this.hero.pos; }

  /** Camera focus: the character's feet while animated, derived from the COM while physical. */
  focus() {
    if (this.mode === 'anim') return this.hero.pos;
    if (this.mode === 'blend') return this._focus.lerpVectors(this.focusSnap, this.hero.pos, smooth(this.blendT));
    const c = this.rd.com(this._c || (this._c = V()));
    return this._focus.set(c.x, Math.max(-0.6, c.y - 0.95), c.z);
  }

  // ---------- pose transfer ----------
  capture(out) {
    this.hero.root.updateMatrixWorld(true);
    for (const name in this.groups) {
      const o = (out[name] ||= { pos: V(), quat: new THREE.Quaternion() });
      this.groups[name].getWorldPosition(o.pos);
      this.groups[name].getWorldQuaternion(o.quat);
    }
    return out;
  }

  apply(pose) {
    const h = this.hero, G = this.groups;
    h.root.position.set(0, 0, 0);
    h.root.quaternion.identity();
    const inv = new THREE.Quaternion();
    // the torso chain sits under the (height-)scaled hips: local offsets are in its units
    const k = 1 / h.S;
    const setLocal = (obj, parent, p) => {
      inv.copy(pose[parent].quat).invert();
      obj.quaternion.copy(inv).multiply(pose[p].quat);
      obj.position.copy(pose[p].pos).sub(pose[parent].pos).applyQuaternion(inv).multiplyScalar(k);
    };
    G.pelvis.position.copy(pose.pelvis.pos);
    G.pelvis.quaternion.copy(pose.pelvis.quat);
    setLocal(G.spine, 'pelvis', 'spine');
    setLocal(G.chest, 'spine', 'chest');
    setLocal(G.head, 'chest', 'head');
    if (this.headLocal) h.head.quaternion.copy(this.headLocal);
    for (const n of ['thighL', 'shinL', 'footL', 'upperL', 'foreL', 'thighR', 'shinR', 'footR', 'upperR', 'foreR']) {
      G[n].position.copy(pose[n].pos);
      G[n].quaternion.copy(pose[n].quat);
    }
    for (const l of h.legs) l.toe.rotation.x = 0;
  }

  setGrip(grip, dt) {
    this.hero.arms.forEach((a, i) => {
      a.grip = (a.grip ?? 0.3) + (grip[i] - (a.grip ?? 0.3)) * Math.min(1, dt * 10);
      const curl = -0.15 + a.grip * 1.5;
      a.fingers.forEach(([f1, f2], j) => {
        f1.rotation.z = -(curl + j * 0.06);
        f2.rotation.z = -(curl * 1.15 + j * 0.05);
      });
      a.thumb[1].rotation.z = -Math.max(0, curl) * 0.6;
    });
  }

  // ---------- mode switches ----------
  goRagdoll(kind, opts) {
    // someone else's body (multiplayer puppet): its own client decides how it falls
    if (this.remote) return;
    // (admin.js: no ragdoll - nothing knocks you off your feet, unless you're dead)
    if (this.noRagdoll && !this.brain.dead) return;
    // sitting in a car: the car hands the body over with its own velocity
    if (this.seat) { this.seat.car.sys.release(this, kind); return; }
    // only someone actually on their feet can stagger and try to keep their balance: seated,
    // lying, mid-climb or mid-getting-up, the body just goes where physics takes it
    if (kind === 'stumble' && !this.onFeet()) { kind = 'collapse'; opts = undefined; }
    // a vampire (look.vampire, vampire.js): shrugs off what would stagger anyone else, and
    // what does rock him he steadies from quickly
    if (kind === 'stumble' && this.hero.look?.vampire && !this.brain.dead) {
      const bal = opts?.balance ?? 0.7;
      if (bal > 0.55) return;
      opts = { ...opts, balance: 1 - (1 - bal) * 0.4, decay: (opts?.decay ?? 0.4) * 0.45 };
    }
    this.postSnap = null;
    this.hero.action = null;
    this.headLocal = this.hero.head.quaternion.clone();
    this.rd.enable(this.cur, this.prev, this.lastDt);
    this.brain.start(kind, opts);
    this.mode = 'ragdoll';
    this.acc = 0;
    this.sensed = false; // muscles wait for the brain's first update (bumps land mid-frame)
  }

  toggleRagdoll() {
    if (this.mode === 'anim') {
      const h = this.hero;
      const speed = Math.hypot(h.vel.x, h.vel.z);
      if (!h.grounded || !this.onFeet()) this.goRagdoll('collapse');
      else if (speed < 0.8) {
        // standing: go woozy - lurch off balance and stagger around before going down
        this.goRagdoll('stumble', { balance: 0.85, decay: 0.28, daze: true });
        const a = h.yaw;
        const off = (Math.random() - 0.5) * 2.2 + (Math.random() < 0.25 ? Math.PI : 0);
        const dir = V(Math.sin(a + off), 0, Math.cos(a + off));
        const imp = dir.multiplyScalar(40 + Math.random() * 25);
        imp.y = 2;
        this.pending = { imp, local: V(0, 0.18, 0) };
      }
      // on the move: a few staggering steps before going down
      else this.goRagdoll('stumble', { balance: clamp(0.75 - speed * 0.06, 0.4, 0.7), decay: 0.55 });
    } else if (this.mode === 'ragdoll' && !this.crippled) this.getUp(false);
  }

  /** Centre of mass + velocity, for other people's threat sensing. */
  bodyState(out) {
    if (this.mode === 'ragdoll') { this.rd.com(out.pos); this.rd.comVel(out.vel); }
    else { out.pos.copy(this.hero.pos).setY(this.hero.pos.y + 0.95); out.vel.copy(this.hero.vel); }
    return out;
  }

  /** Standing upright under our own control (not in a posture, climb, or getting up)? */
  onFeet() {
    if (this.mode === 'ragdoll') return this.brain.state === 'balance';
    if (this.mode === 'blend' || this.hero.action) return false;
    const pel = this.cur.pelvis;
    return !pel || pel.pos.y - this.hero.pos.y > 0.7;
  }

  /** Still on our feet but something's about to hit us: switch to the active body, braced. */
  brace() {
    if (this.seat || this.mode !== 'anim' || !this.onFeet()) return;
    this.goRagdoll('stumble', { balance: 1, decay: 0.04 });
  }

  /** Animated arm hook: the clutching hand pressed flat onto the wound. */
  holdWound(h) {
    const C = this.brain.clutch;
    if (!C) { h.armHook = null; return; }
    const g = this.groups[C.part];
    g.updateWorldMatrix(true, false);
    const w = g.localToWorld(C.local.clone());
    const n = C.nLocal.clone().transformDirection(g.matrixWorld);
    const a = h.arms[C.i];
    // a wound on the back: the hand goes round its own side onto the back, low (ik.js clutchReach)
    const back = clutchReach(C.part, w, n, h.chest.getWorldPosition(V()), h.chest.getWorldQuaternion(new THREE.Quaternion()), a.side);
    // palm (normal = -side * X) faces into the body, fingers pointing down - round the back,
    // in toward the spine (the wrist can't turn them down there)
    const X = n.clone().multiplyScalar(a.side);
    const outW = V(a.side, 0, 0).transformDirection(h.chest.matrixWorld);
    const Y = V(0, 1, 0).lerp(outW.addScaledVector(V(0, 1, 0), 0.5).normalize(), back);
    Y.addScaledVector(X, -Y.dot(X)).normalize();
    const Z = V().crossVectors(X, Y);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    const wrist = w.addScaledVector(n, 0.03).addScaledVector(Y, 0.05);
    const fwd = h.forward(V());
    const out = V(fwd.z, 0, -fwd.x).multiplyScalar(a.side); // this arm's side of the body
    // (elbow: down and a little back; reaching round behind, out to the side and well back)
    poseArm(h, a, wrist, q, out.multiplyScalar(lerp(0.7, 1, back)).add(V(0, lerp(-1, -0.25, back), 0)).addScaledVector(fwd, lerp(-0.4, -1, back)).normalize());
    a.fingers.forEach(([f1, f2]) => { f1.rotation.z = -0.35; f2.rotation.z = -0.3; });
  }

  /** Hit by a bullet on part `name` at world `point`, travelling along `dir`. */
  shot(name, point, dir) {
    // (admin.js: god mode - nothing touches you)
    if (this.god) return;
    if (this.remote) {
      // the wound shows here; the body's owner takes the hit for real
      this.onRemoteHit?.('shot', name, point, dir);
      this.wounds?.gunshot(name, point, dir);
      return;
    }
    const res = this.wounds?.gunshot(name, point, dir);
    const w = res?.entry, O = res?.organs || { hits: [] };
    const kind = name.replace(/[LR]$/, '');
    const b = this.brain;
    // what it went through inside decides the reaction
    if (O.lethal) this.organs?.die();
    const dead = b.dead;
    const S = this.organs?.state;
    const floored = O.down || (S && (S.noRise || S.out));
    // how badly it takes the legs out from under you
    const opts = floored ? null
      : kind === 'head' ? { balance: 0.4, decay: 0.8, daze: true }
      : kind === 'thigh' || kind === 'shin' || kind === 'foot' ? { balance: 0.35, decay: 0.9 }
      : kind === 'upper' || kind === 'fore' ? { balance: 0.8, decay: 0.3 }
      : { balance: 0.6, decay: 0.5 };
    if (this.mode !== 'ragdoll') {
      if (this.mode === 'blend') this.hero.action = null;
      this.goRagdoll(opts && !dead ? 'stumble' : 'collapse', opts || undefined);
    } else if (b.state === 'balance' && opts) {
      b.bal = Math.min(b.bal, opts.balance);
      b.decay = Math.max(b.decay, opts.decay);
    } else if (b.state === 'balance' && floored) b.bal = 0;
    if (dead) b.dead = true;
    else if (w) b.wounded(name, w.local, w.nLocal);
    b.shots = (b.shots || 0) + 1;
    // (no shooter to hand: look back along the line it came in on)
    if (!dead) b.hitBy(null, point.clone().addScaledVector(dir.clone().normalize(), -8));
    // the round's shove, at the exact spot it went in
    const imp = dir.clone().normalize().multiplyScalar(kind === 'head' ? 22 : 30);
    this.pending = { imp, part: name, point: point.clone() };
    this.onShot?.(name, O);
    if (!dead) this.onPain?.(name, 'shot', 1);
  }

  /**
   * Hit by a melee blow on part `name` at world `point`. vel = the striking surface's velocity,
   * n = direction into the body, w = { kind: 'fist'|'blunt'|'blade', mass, sev, edge }, by = attacker.
   */
  struck(name, point, vel, n, w, by) {
    if (this.god) return;
    // a vampire's blows land far harder (once: the boosted blow is what goes over the network)
    if (by?.hero?.look?.vampire && w.kind !== 'bite' && !w.vk) w = { ...w, vk: 1, sev: w.sev * 1.6, mass: w.mass * 1.9, maxImp: (w.maxImp || 90) * 1.9 };
    const kind = name.replace(/[LR]$/, '');
    const head = kind === 'head', leg = kind === 'thigh' || kind === 'shin' || kind === 'foot';
    const speed = vel.length();
    const vampMe = !!this.hero.look?.vampire;
    const sev = w.sev * clamp(speed / (w.ref || 8), 0.35, 1.4) * (head ? 1.15 : 1) * (vampMe ? 0.45 : 1);
    // a vampire drinking (vampire.js): a sip of blood out of the bite already made, no new wound
    if (w.kind === 'bite' && w.sip) {
      // (someone else's body: its owner drains it for real; this copy only goes pale)
      if (this.organs && !this.brain.dead) this.organs.blood = Math.max(this.remote ? 0.5 : 0, this.organs.blood - (w.drain || 0));
      if (this.remote) this.onRemoteHit?.('struck', name, point, vel, n, w, by);
      else if (by && by !== this) this.lastHurt = { by, t: performance.now() / 1000 };
      return;
    }
    // a melee weapon (melee.js / throw.js): it knocks you about, but leaves no mark at all
    if (w.harmless) {
      if (this.remote) { this.onRemoteHit?.('struck', name, point, vel, n, w, by); return; }
      if (blocks(this, by, point)) { guardHit(this, vel, by, 1, Actor.sfx); return 'guard'; }
      if (by && by !== this) this.brain.hitBy?.(by, null);
      if (this.mode !== 'ragdoll') {
        if (this.mode === 'blend') this.hero.action = null;
        this.goRagdoll('stumble', { balance: head ? 0.4 : 0.6, decay: 0.5 });
      }
      const imp = vel.clone().multiplyScalar(w.mass || 1).clampLength(0, (w.maxImp || 90) * 0.7);
      this.pending = { imp, part: name, point: point.clone() };
      return;
    }
    // a heavy blunt blow crushes the body in (dent.js) - on every copy that sees this hit
    const dent = blowDent(kind, speed, w, n);
    if (dent) this.wounds?.dent(name, point, n, dent);
    if (this.remote) {
      this.onRemoteHit?.('struck', name, point, vel, n, w, by);
      if (w.kind === 'blade') this.wounds?.[w.stab ? 'stab' : 'chop'](name, point, n, vel, w.axis, sev);
      else if (w.kind === 'bite') this.wounds?.bite(name, point, n, sev, true);
      else this.wounds?.injure(name, point, n, vel, sev);
      return;
    }
    // bitten (a zombie, latched on: zombie.js): torn open, bleeding, held fast - no knock back
    if (w.kind === 'bite') {
      if (by && by !== this) this.lastHurt = { by, t: performance.now() / 1000 };
      this.wounds?.bite(name, point, n, sev);
      this.organs?.blunt(name, sev * 0.4, 'fist');
      if (!w.vamp) Actor.onBite?.(this, by); // (infection: infect.js - not from a vampire)
      this.heldT = Math.max(this.heldT || 0, 0.9);
      this.onStruck?.(by, false, name, sev);
      if (!this.brain.dead) this.onPain?.(name, 'shot', sev);
      return;
    }
    // caught on our guard (a melee weapon held up, melee.js): a clang, no harm (their copy of
    // us hadn't seen the guard yet)
    if (w.kind !== 'bite' && blocks(this, by, point)) { guardHit(this, vel, by, 1, Actor.sfx); return 'guard'; }
    const b = this.brain, O = this.organs;
    // (who hurt us last: a death is put down to them)
    if (by && by !== this) this.lastHurt = { by, t: performance.now() / 1000 };
    // a queen bee's sting (queen.js): venom in the blood
    if (w.venom) this.venom = Math.min(2, (this.venom || 0) + w.venom);
    let wound = null;
    if (w.kind === 'blade') wound = this.wounds?.[w.stab ? 'stab' : 'chop'](name, point, n, vel, w.axis, sev);
    else {
      this.wounds?.injure(name, point, n, vel, sev);
      // blunt trauma: concussion, cracked ribs, a ruptured liver, snapped bones (organs.js)
      O?.blunt(name, sev, w.kind);
    }
    const dead = b.dead;
    const S = O?.state;
    const floored = dead || (S && (S.noRise || S.out));
    // how hard it rocks you: fists stagger, weapons take you off your feet
    const heavy = w.kind !== 'fist';
    const opts = floored ? null
      : head ? { balance: heavy ? 0.25 : 0.55 - sev * 0.3, decay: heavy ? 1 : 0.55, daze: true }
      : leg ? { balance: heavy ? 0.3 : 0.65, decay: heavy ? 0.9 : 0.45 }
      : { balance: heavy ? 0.45 : 0.74 - sev * 0.25, decay: heavy ? 0.6 : 0.32 };
    if (this.mode !== 'ragdoll') {
      if (this.mode === 'blend') this.hero.action = null;
      this.goRagdoll(opts ? 'stumble' : 'collapse', opts || undefined);
    } else if (b.state === 'balance' && opts) {
      b.bal = Math.min(b.bal, opts.balance);
      b.decay = Math.max(b.decay, opts.decay);
    } else if (b.state === 'balance' && floored) b.bal = 0;
    if (wound && !dead) b.wounded(name, wound.local, wound.nLocal);
    // whoever did it is who we watch now
    if (!dead) b.hitBy(by, by ? null : point.clone().addScaledVector(vel.clone().normalize(), -3));
    const imp = vel.clone().multiplyScalar(w.mass).clampLength(0, w.maxImp || 90);
    imp.addScaledVector(n, imp.length() * 0.15);
    this.pending = { imp, part: name, point: point.clone() };
    this.onStruck?.(by, heavy, name, sev);
    if (!dead) this.onPain?.(name, 'pain', sev);
  }

  /** Push the character in direction dir (horizontal unit vector). */
  shove(dir) {
    if (this.god) return;
    if (this.remote) { this.onRemoteHit?.('shove', dir); return; }
    if (this.mode === 'blend') return;
    if (this.mode === 'anim') this.goRagdoll('stumble', { balance: 1, decay: 0.16 });
    const imp = dir.clone().setY(0).normalize().multiplyScalar(95 + Math.random() * 50);
    imp.y = 8;
    // hit somewhere on the upper torso
    const local = V((Math.random() - 0.5) * 0.2, 0.08 + Math.random() * 0.15, 0);
    this.pending = { imp, local };
  }

  getUp(fromBalance) {
    // broken leg, spine, fainted, bleeding out...: you stay down
    if (this.organs && !this.organs.canRise()) return;
    if (this.tied) return; // (bound hand and foot: rope.js)
    const rd = this.rd, h = this.hero;
    this.focusSnap = this.focus().clone();
    this.snap = rd.read({});
    for (const k in this.snap) this.snap[k] = { pos: this.snap[k].pos.clone(), quat: this.snap[k].quat.clone() };
    const pel = this.snap.pelvis.pos, head = this.snap.head.pos;
    let yaw = this.brain.heading();
    const gy0 = rd.groundY(pel.x, pel.z, pel.y + 0.2), gy = gy0 > 0.05 ? gy0 : 0;
    this.brain.hands.reset();
    rd.disable();
    this.headLocal = null;
    // how we're lying decides how we get up
    const cq = this.snap.chest.quat;
    const up = V(0, 1, 0).applyQuaternion(cq), front = V(0, 0, 1).applyQuaternion(cq);
    const height = pel.y - gy;
    let kind = null;
    if (!fromBalance && !(up.y > 0.8 && height > 0.7)) {
      if (up.y > 0.55) { kind = 'upright'; yaw = Math.atan2(front.x, front.z); }
      else {
        // face down: rise facing the way the head points; on the back: sit up toward the feet
        kind = front.y < 0 ? 'prone' : 'supine';
        const s = kind === 'prone' ? 1 : -1;
        const dx = (head.x - pel.x) * s, dz = (head.z - pel.z) * s;
        if (dx * dx + dz * dz > 0.01) yaw = Math.atan2(dx, dz);
      }
    }
    if (kind) {
      const o = V(pel.x, gy, pel.z);
      const hold = 0.5;
      const act = new GetUp(h, kind, { o, yaw }, hold, this.isPlayer ? 1.2 : 1);
      h.reset(act.toWorld(V(0, 0, act.exitZ)), yaw);
      h.action = act;
      this.blendDur = hold;
    } else {
      h.reset(V(pel.x, gy, pel.z), yaw);
      this.blendDur = fromBalance ? 0.35 : 0.6;
    }
    // still hurt: on your feet, one hand stays pressed to the wound
    if (this.brain.clutch && !h.armHook) h.armHook = (ch) => this.holdWound(ch);
    this.blendT = 0;
    this.mode = 'blend';
  }

  /** Back on your feet at pos, healed, whatever state the body was in. */
  respawn(pos, yaw) {
    if (this.seat) { const s = this.seat; s.occ = null; this.seat = null; this.postSnap = null; if (s.driver) s.car.sys.abandon(s.car); }
    if (this.mode === 'ragdoll') { this.brain.hands.reset(); this.rd.disable(); }
    this.mode = 'anim';
    this.headLocal = null;
    this.postSnap = null;
    this.pending = null;
    this.recovered = false;
    // (cut up: whole again)
    this.unsever?.();
    this.healGash?.(); // (gash.js: half-cut limbs whole again)
    // (gone up in hearts: back in one piece, and seen again)
    if (this.poofed) { this.poofed = false; this.hero.setVisible(true); }
    this.crippled = false;
    this.tied = null;
    this.wounds?.heal();
    this.organs?.heal();
    if (!this.gunHeld && !this.meleeHeld && !this.meleeHeldL) this.hero.armHook = null;
    this.hero.twist = this.hero.bend = 0;
    this.hero.reset(pos, yaw);
    this.hero.update(0.001, { move: V(), run: false, jump: false, camYaw: yaw - Math.PI });
    this.capture(this.cur);
    this.capture(this.prev);
  }

  /** Pose = from -> to by k (rotations slerped, limbs re-chained from the pelvis), applied. */
  blendInto(from, to, k) {
    const out = this.blendPose || (this.blendPose = {});
    const defs = this.rd.defs;
    for (const name of this.rd.names) {
      const o = (out[name] ||= { pos: V(), quat: new THREE.Quaternion() });
      o.quat.slerpQuaternions(from[name].quat, to[name].quat, k);
      const par = defs[name].parent;
      if (!par) o.pos.lerpVectors(from[name].pos, to[name].pos, k);
      else o.pos.copy(defs[name].anchor).applyQuaternion(out[par].quat).add(out[par].pos);
    }
    this.apply(out);
  }

  // ---------- physics hooks (called by stepPhysics) ----------
  preStep(h, f = 1) {
    if (this.mode === 'ragdoll' && this.sensed) {
      this.brain.assist(h);
      this.rd.drive();
    }
    this.proxyFollow(f);
  }
  postStep() {
    this.rd.guard();
    if (this.mode === 'ragdoll' && this.pending) {
      const { imp, local, part, point } = this.pending;
      if (part) this.rd.impulseAt(part, imp, point);
      else this.rd.impulseAt('chest', imp, this.rd.point('chest', local));
      this.pending = null;
    }
  }
  /** After the world has been stepped this frame: show the physical pose, maybe get up. */
  afterPhysics(dt) {
    if (this.mode !== 'ragdoll') return;
    this.apply(this.rd.read(this.pose || (this.pose = {})));
    this.setGrip(this.brain.grip, dt);
    if (this.recovered) { this.recovered = false; if (!this.crippled) this.getUp(true); }
  }

  /**
   * While animated, a kinematic capsule tracks the character so ragdolls (other people,
   * lying or stumbling) get physically bumped and shouldered aside.
   */
  proxyFollow(f = 1) {
    const on = this.mode !== 'ragdoll';
    const p = this.hero.pos, at = { x: p.x, y: p.y + 0.9, z: p.z };
    const from = (this._proxyFrom ||= { x: at.x, y: at.y, z: at.z });
    if (on !== this.proxy.isEnabled()) {
      this.proxy.setEnabled(on);
      if (on) { this.proxy.setTranslation(at, true); Object.assign(from, at); } // re-appear in place, don't sweep there
    }
    if (!on) return;
    // (this frame's move spread over its substeps: f is how far through them we are)
    const k = Math.min(1, Math.max(0, f));
    // (a jump of metres is a teleport, not a move: no sweeping through everything in between)
    if ((at.x - from.x) ** 2 + (at.y - from.y) ** 2 + (at.z - from.z) ** 2 > 4) Object.assign(from, at);
    this.proxy.setNextKinematicTranslation({ x: from.x + (at.x - from.x) * k, y: from.y + (at.y - from.y) * k, z: from.z + (at.z - from.z) * k });
    if (k >= 1) Object.assign(from, at);
  }

  // ---------- per frame ----------
  update(dt, ctrl, colliders) {
    this.lastDt = dt || 1 / 60;
    if (this.remote) return;
    // in a car: posed in the seat after physics (Vehicles.seatFrame)
    if (this.seat) return;
    // blood loss makes you slow and unsteady on your feet (may buckle you into a stagger)
    if (this.mode === 'anim' && this.organs && ctrl) ctrl = this.organs.limit(ctrl, dt);
    // held fast (a zombie hanging off you): barely any headway, no running, no jumping
    if (this.heldT > 0) {
      this.heldT -= dt;
      if (ctrl) ctrl = { ...ctrl, move: ctrl.move.clone().multiplyScalar(0.3), run: false, jump: false };
    }
    if (this.mode === 'anim') {
      // keep the last two animated poses so the ragdoll inherits the motion
      const t = this.prev; this.prev = this.cur; this.cur = t;
      const wasAction = !!this.hero.action;
      this.hero.update(dt, ctrl, colliders);
      if (wasAction !== !!this.hero.action) {
        // climb/vault just started or ended: ease from the previous pose into the new one
        this.postSnap = {};
        for (const k in this.prev) this.postSnap[k] = { pos: this.prev[k].pos.clone(), quat: this.prev[k].quat.clone() };
        this.postT = 0;
      }
      this.capture(this.cur);
      if (this.postSnap) {
        this.postT += dt / 0.22;
        if (this.postT >= 1) this.postSnap = null;
        else {
          this.blendInto(this.postSnap, this.cur, smooth(this.postT));
          this.capture(this.cur);
        }
      }
      return;
    }
    if (this.mode === 'ragdoll') {
      // muscles are planned here; the shared world is stepped by stepPhysics()
      this.recovered = this.brain.update(dt);
      this.rd.selfCollide(dt);
      this.sensed = true;
      return;
    }
    // blend: run the animation standing still and ease from the physical pose into it
    this.blendT = Math.min(1, this.blendT + dt / this.blendDur);
    const t = this.prev; this.prev = this.cur; this.cur = t;
    this.hero.update(dt, { ...ctrl, move: new THREE.Vector3(), jump: false, run: false }, colliders);
    this.capture(this.cur);
    this.blendInto(this.snap, this.cur, smooth(this.blendT));
    this.capture(this.cur); // the pose on screen is what a new fall starts from
    this.setGrip([0.3, 0.3], dt);
    if (this.blendT >= 1) {
      this.mode = 'anim';
      this.headLocal = null;
    }
  }
}
