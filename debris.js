import * as THREE from 'three';
import { groups, G_WORLD, G_DEBRIS, G_CAR, G_BODY } from './physics.js';

const tv = (v, out) => out.set(v.x, v.y, v.z);
const ZERO = { x: 0, y: 0, z: 0 };

// the simulation radius: loose pieces further than this from the player (and at rest) leave the
// physics world - still drawn where they lay - and come back as they get near again
export const SIM_R = 30;
const THAW_R = SIM_R - 4;     // hysteresis
const AWAKE_R = SIM_R + 14;   // still moving out there: frozen anyway past this
// litter lying about is frozen (just drawn) until you're this close, and again once you leave
const LITTER_THAW_R = 6, LITTER_KEEP_R = 10;
const SCAN = 0.2;             // s between radius passes
const THAW_BUDGET = 60;       // bodies made per pass (a burst of them costs a frame)
const CASING_LIFE = 3;        // s a spent casing lies about before it's gone

/**
 * Small rigid props (casings, magazines, a dropped gun, litter) simulated in the shared Rapier
 * world. Each piece reports hard impacts (sudden velocity changes) so it can clink. Pieces added
 * with `inst` are drawn instanced (instancer.js) and take part in the simulation radius.
 */
export class Debris {
  constructor(scene, world, RAPIER, sfx, inst = null) {
    this.scene = scene;
    this.world = world;
    this.R = RAPIER;
    this.sfx = sfx;
    this.inst = inst;
    this.items = [];     // in the physics world
    this.frozen = [];    // out of range: no body, just drawn
    this.focus = new THREE.Vector3();
    this.scanT = 0;
  }

  /**
   * shape: { box: [hx,hy,hz] } | { cyl: [halfH, r] } | { ball: r }, relative to the mesh origin via `offset`.
   * Returns the item; the mesh is moved to the body every frame.
   */
  add(mesh, shape, { pos, quat, vel, angVel, mass = 0.01, restitution = 0.35, friction = 0.6, sound = null, cap = 80, kind = 'misc', offset = null, damping = 0.05, angDamping = 0.3, ccd = true, inst = false, solid = false }) {
    const opts = { mass, restitution, friction, sound, cap, kind, offset, damping, angDamping, ccd, solid, inst: inst && !!this.inst };
    const it = { mesh, body: null, sound, kind, shape, offset, mass, opts, lastV: tv(vel, new THREE.Vector3()), quiet: 0, age: 0, inst: opts.inst };
    this.body(it, pos, quat, vel, angVel);
    mesh.position.copy(pos);
    mesh.quaternion.copy(quat);
    if (it.inst) this.inst.attach(mesh);
    else if (mesh.parent !== this.scene) this.scene.add(mesh);
    this.items.push(it);
    // oldest of this kind goes once over the cap
    let n = 0;
    for (const x of this.items) if (x.kind === kind) n++;
    if (n > cap) this.remove(this.items.find((x) => x.kind === kind));
    this.sync(it);
    return it;
  }

  /**
   * A piece lying at rest out of range: drawn, not simulated until the player comes near.
   * The mesh must already be posed where it lies.
   */
  addFrozen(mesh, shape, opts) {
    const o = { mass: 0.01, restitution: 0.35, friction: 0.6, sound: null, cap: 80, kind: 'misc', offset: null, damping: 0.05, angDamping: 0.3, ccd: true, ...opts, inst: true };
    const it = { mesh, body: null, sound: o.sound, kind: o.kind, shape, offset: o.offset, mass: o.mass, opts: o, lastV: new THREE.Vector3(), quiet: 0, age: 0, inst: true, frozen: true };
    this.inst.attach(mesh);
    this.frozen.push(it);
    return it;
  }

  body(it, pos, quat, vel = ZERO, angVel = ZERO, sleep = false) {
    const R = this.R, o = it.opts, shape = it.shape;
    const desc = R.RigidBodyDesc.dynamic()
      .setCanSleep(true)
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      .setLinvel(vel.x, vel.y, vel.z)
      .setAngvel(angVel ? { x: angVel.x, y: angVel.y, z: angVel.z } : ZERO)
      .setCcdEnabled(o.ccd)
      .setLinearDamping(o.damping)
      .setAngularDamping(o.angDamping);
    if (sleep) desc.setSleeping(true);
    const body = this.world.createRigidBody(desc);
    const cd = shape.box ? R.ColliderDesc.cuboid(...shape.box) : shape.ball ? R.ColliderDesc.ball(shape.ball) : R.ColliderDesc.cylinder(...shape.cyl);
    if (o.offset) cd.setTranslation(o.offset.x, o.offset.y, o.offset.z);
    cd.setMass(o.mass).setRestitution(o.restitution).setFriction(o.friction)
      // (solid: big enough that bodies land on it and shove it about too)
      .setCollisionGroups(groups(G_DEBRIS, G_WORLD | G_DEBRIS | G_CAR | (o.solid ? G_BODY : 0)));
    this.world.createCollider(cd, body);
    if (sleep) body.sleep(); // (adding the collider mustn't have roused it)
    it.body = body;
    it.sleeping = sleep;
  }

  /** Where it is (whether simulated or not). */
  pos(it, out = new THREE.Vector3()) {
    if (it.body) return tv(it.body.translation(), out);
    return out.copy(it.mesh.position);
  }

  has(it) { return this.items.includes(it) || this.frozen.includes(it); }

  take(it) {
    let i = this.items.indexOf(it);
    if (i >= 0) { this.items.splice(i, 1); return true; }
    i = this.frozen.indexOf(it);
    if (i >= 0) { this.frozen.splice(i, 1); return true; }
    return false;
  }

  remove(it) {
    if (!this.take(it)) return;
    if (it.body) this.world.removeRigidBody(it.body);
    it.body = null;
    if (it.inst) this.inst.drop(it.mesh);
    else it.mesh.removeFromParent();
  }

  /** Take a piece out of the simulation but keep its mesh (e.g. picking the gun back up). */
  release(it) {
    if (!this.take(it)) return;
    if (it.body) this.world.removeRigidBody(it.body);
    it.body = null;
    it.frozen = false;
    if (it.inst) this.inst.detach(it.mesh);
  }

  /** Put a released piece back into the simulation (thrown, dropped); keeps its tags. */
  readd(it, pos, quat, vel, angVel) {
    const n = this.add(it.mesh, it.shape, { ...it.opts, pos, quat, vel, angVel });
    for (const k of ['pick', 'onImpact', 'cell']) if (it[k]) n[k] = it[k];
    return n;
  }

  /** Remove every loose piece (casings, mags...). Items in `keep` are only released. */
  clear(keep = new Set()) {
    for (const it of [...this.items, ...this.frozen]) keep.has(it) ? this.release(it) : this.remove(it);
  }

  sync(it) {
    const t = it.body.translation(), r = it.body.rotation();
    it.mesh.position.set(t.x, t.y, t.z);
    it.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    if (it.inst) this.inst.update(it.mesh);
  }

  /** Out of range: its body goes, it stays drawn where it is. */
  freeze(it) {
    const i = this.items.indexOf(it);
    if (i < 0) return;
    this.sync(it);
    this.items.splice(i, 1);
    this.world.removeRigidBody(it.body);
    it.body = null;
    it.frozen = true;
    this.frozen.push(it);
  }

  thaw(it, i) {
    this.frozen.splice(i, 1);
    it.frozen = false;
    this.body(it, it.mesh.position, it.mesh.quaternion, ZERO, ZERO, true);
    it.lastV.set(0, 0, 0);
    this.items.push(it);
  }

  /** The simulation radius: who's in the physics world, who's just drawn. */
  radius(focus) {
    const f = focus, R2 = SIM_R * SIM_R, A2 = AWAKE_R * AWAKE_R, T2 = THAW_R * THAW_R;
    const LT2 = LITTER_THAW_R * LITTER_THAW_R, LK2 = LITTER_KEEP_R * LITTER_KEEP_R;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (!it.inst || it.flying) continue;
      const t = it.body.translation();
      const d2 = (t.x - f.x) ** 2 + (t.z - f.z) ** 2;
      if (d2 > A2 || (d2 > (it.kind === 'litter' ? LK2 : R2) && it.body.isSleeping())) this.freeze(it);
    }
    let budget = THAW_BUDGET;
    for (let i = this.frozen.length - 1; i >= 0 && budget > 0; i--) {
      const it = this.frozen[i], p = it.mesh.position;
      if ((p.x - f.x) ** 2 + (p.z - f.z) ** 2 < (it.kind === 'litter' ? LT2 : T2)) { this.thaw(it, i); budget--; }
    }
  }

  /** Call once per frame after physics; `focus` is where the player is. */
  update(dt, focus = null) {
    const v = this._v || (this._v = new THREE.Vector3());
    const hits = [];
    // spent casings vanish a few seconds after they're ejected
    for (const it of [...this.items, ...this.frozen]) {
      if (it.kind !== 'casing') continue;
      if (it.frozen) it.age += dt;
      if (it.age > CASING_LIFE) this.remove(it);
    }
    for (const it of this.items) {
      it.age += dt;
      it.quiet = Math.max(0, it.quiet - dt);
      if (it.body.isSleeping()) {
        // (one last sync as it drops off to sleep; nothing to do after that)
        if (!it.sleeping) { it.sleeping = true; this.sync(it); it.lastV.set(0, 0, 0); }
        continue;
      }
      it.sleeping = false;
      this.sync(it);
      tv(it.body.linvel(), v);
      // (the smaller of the raw change and the change beyond gravity: neither falling nor lying
      // still reads as a hit, at any framerate)
      const dv = Math.min(v.distanceTo(it.lastV), Math.hypot(v.x - it.lastV.x, v.y - it.lastV.y + 9.81 * dt, v.z - it.lastV.z));
      if (it.sound && dv > 0.45 && it.quiet <= 0) {
        this.sfx?.(it.sound, Math.min(1, dv / 3.5));
        it.quiet = 0.06;
      }
      if (it.onImpact && dv > 0.45) hits.push([it, dv, it.lastV.clone()]);
      it.lastV.copy(v);
    }
    // (after the loop: an impact may remove the piece, e.g. a bottle smashing)
    for (const [it, dv, before] of hits) if (this.items.includes(it)) it.onImpact(dv, it, before);
    if (focus) {
      this.focus.copy(focus);
      this.scanT -= dt;
      if (this.scanT <= 0) { this.scanT = SCAN; this.radius(focus); }
    }
    this.inst?.flush();
  }

  /** Loose pieces within r of p (optionally only those passing `test`). */
  near(p, r, test) {
    const out = [];
    for (const it of this.items) {
      const t = it.body.translation();
      const d2 = (t.x - p.x) ** 2 + (t.y - p.y) ** 2 + (t.z - p.z) ** 2;
      if (d2 < r * r && (!test || test(it))) out.push(it);
    }
    return out;
  }
}
