import * as THREE from 'three';
import { groups, G_WORLD } from './physics.js';

const SHIFT = 0.07;  // m off its spot (or TILT rad) before a free-standing prop counts as knocked loose
const TILT = 0.22;
import { mat, part } from './litter.js';

/*
  Street furniture that can be wrecked: bins, hydrants, newspaper boxes, post boxes, parking
  meters, café chairs and tables.

  Bolted-down ones (hydrants, post boxes, meters) stand as fixed bodies until they take enough
  punishment. Free-standing ones (bins, newspaper boxes, chairs, tables) are real rigid bodies
  from the start, created ASLEEP: they cost nothing and don't jitter while nobody touches them,
  and wake the moment something does - a car nosing into them, a body landing on them, a blow,
  a kick, a bullet. Once one has been shoved off its spot (or tipped) its footprint leaves the
  walk colliders and it carries on as loose debris.

  Enough punishment wrecks either kind: bins tip and spill, hydrants snap and gush, meters pour
  out coins, newspaper boxes burst their glass and papers.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const IRON = 0x25292d;

/** A fresh mesh of a prop kind (someone else carrying one, in multiplayer). */
export function propMesh(kind, spec = {}) {
  if (!BUILD[kind]) return null;
  const g = new THREE.Group();
  BUILD[kind](g, spec);
  return g;
}

// Meshes are built in the prop's own frame: +z = forward (u), +x = right (v), y = up.
const BUILD = {
  trash(g) {
    const c = mat(0x2f4a3a, 0.6, 0.3), d = mat(0x263b2f, 0.6, 0.3);
    part(g, 'cyl', d, 0, 0.04, 0, 0.6, 0.08, 0.6);
    part(g, 'cyl', c, 0, 0.46, 0, 0.56, 0.84, 0.56);
    for (let k = 0; k < 3; k++) part(g, 'cyl', d, 0, 0.2 + k * 0.3, 0, 0.575, 0.04, 0.575);
    const lid = new THREE.Group();
    part(lid, 'cyl', d, 0, 0, 0, 0.64, 0.06, 0.64);
    part(lid, 'cyl', mat(0x0d0d0d, 0.9), 0, 0.035, 0, 0.36, 0.012, 0.36);
    lid.position.y = 0.9;
    g.add(lid);
    g.userData.lid = lid;
  },
  hydrant(g) {
    const c = mat(0xb8261d, 0.5, 0.2), w = mat(0xd9d4c8, 0.5, 0.3);
    part(g, 'cyl', c, 0, 0.03, 0, 0.34, 0.06, 0.34);
    part(g, 'cyl', c, 0, 0.3, 0, 0.24, 0.52, 0.24);
    part(g, 'cyl', c, 0, 0.58, 0, 0.3, 0.05, 0.3);
    part(g, 'sph', c, 0, 0.63, 0, 0.24, 0.2, 0.24);
    part(g, 'cyl', w, 0, 0.75, 0, 0.06, 0.06, 0.06);
    part(g, 'cyl', w, 0, 0.4, 0.14, 0.1, 0.1, 0.1, Math.PI / 2);
    for (const v of [-1, 1]) part(g, 'cyl', c, v * 0.14, 0.44, 0, 0.07, 0.08, 0.07, 0, 0, Math.PI / 2);
  },
  news(g, s) {
    const c = mat(s.color ?? 0xc0392b, 0.55, 0.2), iron = mat(IRON, 0.5, 0.6);
    part(g, 'box', iron, 0, 0.15, 0, 0.3, 0.3, 0.3);
    part(g, 'box', c, 0, 0.66, 0, 0.48, 0.72, 0.42);
    g.userData.glass = part(g, 'box', mat(0x99aab5, 0.1, 0.3, { opacity: 0.6 }), 0, 0.78, 0.212, 0.38, 0.3, 0.01);
    part(g, 'box', mat(0xe9e5da, 1), 0, 0.72, 0.19, 0.34, 0.2, 0.02);
    part(g, 'box', mat(0x2a2a2a, 0.5), 0, 0.52, 0.215, 0.2, 0.05, 0.02);
    part(g, 'box', c, 0, 1.03, -0.02, 0.5, 0.03, 0.46);
  },
  mail(g) {
    const c = mat(0x24509a, 0.5, 0.25), iron = mat(IRON, 0.5, 0.6);
    for (const [u, v] of [[0.2, 0.2], [0.2, -0.2], [-0.2, 0.2], [-0.2, -0.2]]) part(g, 'box', iron, v, 0.08, u, 0.05, 0.16, 0.05);
    part(g, 'box', c, 0, 0.62, 0, 0.52, 0.92, 0.5);
    part(g, 'cyl', c, 0, 1.08, 0, 0.5, 0.52, 0.5, 0, 0, Math.PI / 2);
    part(g, 'box', mat(0x1b3d78, 0.5, 0.25), 0, 0.98, 0.255, 0.34, 0.1, 0.02);
  },
  meter(g) {
    const m = mat(0x4a4f55, 0.45, 0.6), head = new THREE.Group();
    part(g, 'cyl', m, 0, 0.55, 0, 0.06, 1.1, 0.06);
    const hm = mat(0x55606a, 0.45, 0.5);
    part(head, 'box', hm, 0, 0, 0, 0.2, 0.26, 0.16);
    part(head, 'box', mat(0x9fb3c0, 0.1, 0.3), 0, 0.04, 0.085, 0.14, 0.1, 0.01);
    part(head, 'sph', hm, 0, 0.14, 0, 0.18, 0.1, 0.2);
    head.position.y = 1.22;
    g.add(head);
    g.userData.head = head;
  },
  chair(g) {
    const c = mat(0x2e3a36, 0.6, 0.2), iron = mat(IRON, 0.5, 0.6), H = 0.46;
    part(g, 'box', c, 0, H - 0.015, 0, 0.42, 0.03, 0.42);
    for (const [u, v] of [[0.18, 0.18], [0.18, -0.18], [-0.18, 0.18], [-0.18, -0.18]]) part(g, 'cyl', iron, v, H / 2, u, 0.03, H, 0.03);
    for (const v of [0.18, -0.18]) part(g, 'cyl', iron, v, H + 0.22, -0.2, 0.03, 0.44, 0.03);
    part(g, 'box', c, 0, H + 0.36, -0.2, 0.4, 0.14, 0.03);
  },
  table(g) {
    const iron = mat(IRON, 0.5, 0.6);
    part(g, 'cyl', iron, 0, 0.37, 0, 0.06, 0.74, 0.06);
    part(g, 'cyl', mat(0xe8e4dc, 0.5), 0, 0.75, 0, 0.8, 0.03, 0.8);
    part(g, 'cyl', iron, 0, 0.02, 0, 0.45, 0.04, 0.45);
  },
};

/*
  hp: punishment it takes; mass: its body; shape/off: its body (prop frame); r/h: reach for
  blows (a cylinder round its foot); carBreak: how much it resists a car (a hydrant stops a slow
  one); bolted: fixed in place until wrecked (the rest stand free, asleep).
*/
const DEFS = {
  trash: { hp: 30, mass: 14, shape: { cyl: [0.46, 0.3] }, off: V(0, 0.46, 0), r: 0.32, h: 0.95, sound: 'bin', hitSound: 'clang' },
  hydrant: { bolted: true, hp: 260, mass: 60, shape: { cyl: [0.38, 0.14] }, off: V(0, 0.38, 0), r: 0.18, h: 0.8, sound: 'clang', hitSound: 'clang', carBreak: 5 },
  news: { hp: 45, mass: 28, shape: { box: [0.24, 0.52, 0.22] }, off: V(0, 0.52, 0), r: 0.32, h: 1.05, sound: 'bin', hitSound: 'clang' },
  mail: { bolted: true, hp: 110, mass: 45, shape: { box: [0.26, 0.66, 0.26] }, off: V(0, 0.66, 0), r: 0.34, h: 1.32, sound: 'bin', hitSound: 'clang', carBreak: 3 },
  meter: { bolted: true, hp: 28, mass: 7, shape: { cyl: [0.68, 0.05] }, off: V(0, 0.68, 0), r: 0.14, h: 1.42, sound: 'clang', hitSound: 'clang' },
  chair: { hp: 7, mass: 4, shape: { box: [0.21, 0.45, 0.22] }, off: V(0, 0.45, 0), r: 0.3, h: 0.92, sound: 'wood', hitSound: 'wood' },
  table: { hp: 14, mass: 10, shape: { cyl: [0.38, 0.4] }, off: V(0, 0.38, 0), r: 0.42, h: 0.8, sound: 'wood', hitSound: 'wood' },
};

// ------------------------------------------------------------------ glass shards / water
class Shards {
  constructor(scene) { this.scene = scene; this.list = []; this.geo = new THREE.BoxGeometry(0.03, 0.004, 0.026); }
  burst(at, vel, n, material) {
    const m0 = material || mat(0xcfe6ee, 0.1, 0.4, { opacity: 0.7 });
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.geo, m0);
      m.position.copy(at).add(V(rnd(-0.08, 0.08), rnd(-0.05, 0.08), rnd(-0.08, 0.08)));
      m.rotation.set(rnd(0, 6), rnd(0, 6), rnd(0, 6));
      const v = vel.clone().add(V(rnd(-2, 2), rnd(0.5, 2.5), rnd(-2, 2)));
      this.scene.add(m);
      this.list.push({ m, v, t: 0, w: V(rnd(-20, 20), rnd(-20, 20), 0) });
    }
    while (this.list.length > 300) this.list.shift().m.removeFromParent();
  }
  update(dt, ground) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      s.t += dt;
      if (!s.rest) {
        s.v.y -= 9.81 * dt;
        s.m.position.addScaledVector(s.v, dt);
        s.m.rotation.x += s.w.x * dt; s.m.rotation.y += s.w.y * dt;
        const g = ground(s.m.position) + 0.004;
        if (s.m.position.y < g) { s.m.position.y = g; s.m.rotation.set(0, rnd(0, 6), 0); s.rest = true; }
      }
      if (s.t > 40) { s.m.removeFromParent(); this.list.splice(i, 1); }
    }
  }
  clear() { for (const s of this.list) s.m.removeFromParent(); this.list.length = 0; }
}

/** A burst main gushing from a snapped hydrant: a column of spray that knocks people about. */
class Gusher {
  constructor(scene, at) {
    this.at = at.clone();
    this.t = 0;
    this.life = 14;
    const N = 260;
    this.n = N;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.age = new Float32Array(N).map(() => -Math.random() * 1.2);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xd6ecf5, size: 0.09, transparent: true, opacity: 0.75, depthWrite: false }));
    this.pts.frustumCulled = false;
    scene.add(this.pts);
    for (let i = 0; i < N; i++) this.pos[i * 3 + 1] = -99;
  }
  get alive() { return this.t < this.life + 1.5; }
  update(dt, ground) {
    this.t += dt;
    const P = this.pos, Vv = this.vel, on = this.t < this.life;
    const power = on ? clamp((this.life - this.t) / 3, 0.35, 1) : 0;
    for (let i = 0; i < this.n; i++) {
      const j = i * 3;
      this.age[i] += dt;
      if (this.age[i] < 0) continue;
      if (P[j + 1] < -50 || this.age[i] > 1.6) {
        if (!on) { P[j + 1] = -99; continue; }
        this.age[i] = 0;
        P[j] = this.at.x + rnd(-0.04, 0.04); P[j + 1] = this.at.y; P[j + 2] = this.at.z + rnd(-0.04, 0.04);
        const a = Math.random() * 6.283, s = rnd(0.2, 1.1);
        Vv[j] = Math.cos(a) * s; Vv[j + 1] = rnd(6.5, 9) * power; Vv[j + 2] = Math.sin(a) * s;
      }
      Vv[j + 1] -= 9.81 * dt;
      P[j] += Vv[j] * dt; P[j + 1] += Vv[j + 1] * dt; P[j + 2] += Vv[j + 2] * dt;
      if (P[j + 1] < this.at.y - 0.02 && Vv[j + 1] < 0) {
        // splash outward along the pavement
        P[j + 1] = this.at.y; Vv[j] *= 1.8; Vv[j + 2] *= 1.8; Vv[j + 1] = Math.abs(Vv[j + 1]) * 0.15;
      }
    }
    this.pts.geometry.attributes.position.needsUpdate = true;
    return power;
  }
  dispose() { this.pts.removeFromParent(); this.pts.geometry.dispose(); }
}

// ------------------------------------------------------------------ the props
const _v = V(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

export class Props {
  /** ctx: { scene, world, RAPIER, debris, litter, money, sfx, colliders, seats } */
  constructor(specs, ctx) {
    this.ctx = ctx;
    this.shards = new Shards(ctx.scene);
    this.gushers = [];
    this.list = specs.map((s) => this.build(s));
    this.spray = null;
  }
  get inst() { return this.ctx.debris?.inst; }

  build(spec) {
    const D = DEFS[spec.kind];
    const g = new THREE.Group();
    BUILD[spec.kind](g, spec);
    const p = { spec, D, g, hp: D.hp, broken: false, col: null, loose: null, wob: 0, wobV: 0, wobAx: V(1, 0, 0), parts: [] };
    this.place(p);
    return p;
  }

  /** Standing where it was built, solid. */
  place(p) {
    const { spec, D, g } = p, { world, RAPIER: R, scene } = this.ctx;
    g.position.set(spec.x, spec.y, spec.z);
    g.rotation.set(0, spec.yaw, 0);
    g.quaternion.setFromEuler(g.rotation);
    this.inst?.detach(g, null);
    // reattach pieces that came off
    for (const [child, pos, quat] of p.parts) { g.add(child); child.position.copy(pos); child.quaternion.copy(quat); child.visible = true; }
    p.parts.length = 0;
    if (g.userData.glass) g.userData.glass.visible = true;
    // standing, it's drawn instanced with all the others of its kind (instancer.js)
    if (this.inst) this.inst.attach(g); else if (g.parent !== scene) scene.add(g);
    const rot = _q.setFromAxisAngle(_v.set(0, 1, 0), spec.yaw);
    const cd = D.shape.box ? R.ColliderDesc.cuboid(...D.shape.box) : R.ColliderDesc.cylinder(...D.shape.cyl);
    // (a world member, so everything bumps into it: people, ragdolls, cars, litter, rays)
    cd.setFriction(0.8).setRestitution(0.05).setCollisionGroups(groups(G_WORLD, 0xffff));
    if (p.body) { world.removeRigidBody(p.body); p.body = null; }
    if (D.bolted) {
      // bolted down: one collider on a single shared fixed body
      this.fixed ||= world.createRigidBody(R.RigidBodyDesc.fixed());
      const o = _v.copy(D.off).applyQuaternion(rot);
      cd.setTranslation(spec.x + o.x, spec.y + o.y, spec.z + o.z).setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
      p.col = world.createCollider(cd, this.fixed);
    } else {
      // standing free: its own dynamic body, asleep until something touches it
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic()
        .setTranslation(spec.x, spec.y + 0.002, spec.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
        .setLinearDamping(0.05).setAngularDamping(0.3)
        .setCanSleep(true).setSleeping(true));
      cd.setTranslation(D.off.x, D.off.y, D.off.z).setMass(D.mass);
      p.col = world.createCollider(cd, body);
      body.sleep(); // (adding the collider mustn't have roused it)
      p.body = body;
      p.awake = false;
    }
    for (const w of spec.walk) { if (w._top !== undefined) w.top = w._top; }
    p.hp = D.hp; p.broken = false; p.wob = p.wobV = 0;
  }

  /** A litter bin standing upright within r of pos (to drop rubbish in), or null. */
  binNear(pos, r = 1.25) {
    for (const p of this.list) {
      if (p.spec.kind !== 'trash' || p.broken || p.carried) continue;
      const t = p.body ? p.body.translation() : p.g.position;
      if (Math.hypot(t.x - pos.x, t.z - pos.z) > r || Math.abs(t.y - pos.y) > 1.2) continue;
      if (p.body) { const q = p.body.rotation(); if (1 - 2 * (q.x * q.x + q.z * q.z) < 0.8) continue; }
      return p;
    }
    return null;
  }

  /** Its footing on the pavement (for reach tests): world point + height. */
  near(point, pad = 0.05) {
    let best = null, bd = Infinity;
    for (const p of this.list) {
      if (p.broken) continue;
      const s = p.spec, dx = point.x - s.x, dz = point.z - s.z;
      if (Math.abs(dx) > 1 || Math.abs(dz) > 1) continue;
      const d = Math.hypot(dx, dz);
      if (d > p.D.r + pad || point.y < s.y - 0.05 || point.y > s.y + p.D.h + pad) continue;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /**
   * A blow (swing, kick, thrown thing) at `point` moving at `vel`, worth `dmg`. Returns the prop
   * it landed on (standing ones only - loose ones are just debris by then).
   */
  strike(point, vel, dmg, by = null) {
    const p = this.near(point);
    if (!p) return null;
    p.hp -= dmg;
    this.ctx.sfx?.(p.D.hitSound, clamp(dmg / 25, 0.25, 0.9));
    if (p.body) {
      // standing free: the blow shoves it for real (and wakes it)
      const J = _v.copy(vel).setY(0).normalize().multiplyScalar(clamp(dmg * 0.7, 1, 40));
      J.y = J.length() * 0.1;
      p.body.applyImpulseAtPoint({ x: J.x, y: J.y, z: J.z }, { x: point.x, y: point.y, z: point.z }, true);
    } else {
      // bolted down: it rocks with the blow
      p.wobAx.set(vel.z, 0, -vel.x).normalize();
      p.wobV += clamp(dmg / p.D.mass, 0.02, 0.6) * 6;
    }
    if (p.hp <= 0) this.break(p, vel.clone().multiplyScalar(clamp(3 / p.D.mass, 0.05, 0.6)).add(V(0, 0.5, 0)), point);
    p.by = by;
    return p;
  }

  /** Wrecked: it comes loose (see loosen) with everything that goes with it - spills, gushes, shattered glass. */
  break(p, vel, at = null, wreck = true) { this.loosen(p, vel, null, at, wreck); }

  /**
   * Off its spot: the standing body goes and it carries on as loose debris, moving at vel /
   * angVel (null: a tumble from vel). wreck: smashed rather than shoved - bins spill, glass goes.
   */
  loosen(p, vel, angVel = null, at = null, wreck = false) {
    if (p.broken) return;
    const { debris, world, litter, money, sfx, seats } = this.ctx;
    const { D, g, spec } = p;
    p.broken = true;
    if (p.body) {
      // pick up exactly where its own body had got to
      const t = p.body.translation(), r = p.body.rotation();
      g.position.set(t.x, t.y, t.z); g.quaternion.set(r.x, r.y, r.z, r.w);
      world.removeRigidBody(p.body);
      p.body = null;
    } else world.removeCollider(p.col, false);
    p.col = null;
    for (const w of spec.walk) { w._top ??= w.top; w.top = -100; }
    if (wreck) sfx?.(D.sound, 0.9);
    this.inst?.detach(g);
    g.updateMatrixWorld(true);
    // a chair someone's sitting on: it's gone from under them
    if (spec.seat) {
      spec.seat.o.y -= 100;
      const who = spec.seat.by;
      if (who?.actor && who.actor.mode === 'anim') who.actor.shove(vel.clone().setY(0).normalize().multiplyScalar(0.5));
    }
    const base = g.position.clone();
    const spin = angVel || V(vel.z, rnd(-1, 1), -vel.x).multiplyScalar(1.5);
    // bits that come away on their own
    const detach = (child, shape, mass, v, sound, type) => {
      const wp = child.getWorldPosition(V()), wq = child.getWorldQuaternion(new THREE.Quaternion());
      p.parts.push([child, child.position.clone(), child.quaternion.clone()]);
      this.ctx.scene.add(child);
      const it = debris.add(child, shape, { pos: wp, quat: wq, vel: v, angVel: V(rnd(-6, 6), rnd(-6, 6), rnd(-6, 6)), mass, restitution: 0.2, sound, kind: 'litter', cap: 300, inst: true });
      litter.tag(it, type, { mass });
      p.pieces = (p.pieces || []).concat(it);
      return it;
    };
    const up = base.clone().setY(base.y + D.h * 0.8);
    if (!wreck) {
      // just shoved off its spot: nothing spills
    } else if (spec.kind === 'trash') {
      detach(g.userData.lid, { cyl: [0.03, 0.32] }, 1.2, vel.clone().add(V(rnd(-1, 1), 2.5, rnd(-1, 1))), 'clang', 'lid');
      litter.spill(up, vel, ['can', 'can', 'paper', 'paper', 'cup', 'bottle', 'butt', 'butt', 'bag', 'sheet'], 9);
    } else if (spec.kind === 'news') {
      g.userData.glass.visible = false;
      this.shards.burst(base.clone().setY(base.y + 0.78), vel, 16);
      sfx?.('glass', 0.7);
      litter.spill(up, vel, ['sheet'], 6);
    } else if (spec.kind === 'mail') {
      litter.spill(up, vel, ['letter'], 10);
    } else if (spec.kind === 'meter') {
      detach(g.userData.head, { box: [0.1, 0.13, 0.08] }, 3, vel.clone().add(V(0, 1.5, 0)), 'clang', 'meterhead');
      for (let i = 0; i < 3; i++) money.spawn(up.clone(), 1 + Math.floor(Math.random() * 3), V(rnd(-1.5, 1.5), rnd(1.5, 3), rnd(-1.5, 1.5)));
    } else if (spec.kind === 'hydrant') {
      this.gushers.push(new Gusher(this.ctx.scene, base.clone().setY(base.y + 0.06)));
    }
    p.loose = debris.add(g, D.shape, {
      pos: g.position, quat: g.quaternion, vel, angVel: spin, mass: D.mass, restitution: 0.12, friction: 0.7,
      sound: D.sound === 'wood' ? 'wood' : 'clang', kind: 'prop', cap: 200, offset: D.off, inst: true, solid: true,
    });
    // chairs are light enough to pick up and throw
    if (spec.kind === 'chair') litter.tag(p.loose, 'chair', { mass: D.mass, r: 0.35, big: true });
    this.onBreak?.(p, at, p.by, wreck);
  }

  // ---- multiplayer (mp.js): someone else's copy of what happened to a prop ----
  /** Taken off the ground by someone (a chair picked up): gone from here until they put it down. */
  lift(p) {
    if (!p.broken) this.loosen(p, V(), V());
    const D = this.ctx.debris;
    if (p.loose && D.has(p.loose)) D.release(p.loose);
    this.inst?.detach(p.g, null);
    p.g.removeFromParent();
    p.carried = true;
  }
  /** Put down / thrown by someone: loose again at pos, moving at vel. */
  set(p, pos, quat, vel, spin) {
    if (!p.broken) this.loosen(p, V(), V());
    const D = this.ctx.debris, { D: d, g, spec } = p;
    if (p.loose && D.has(p.loose)) D.release(p.loose);
    p.carried = false;
    this.inst?.detach(g, null);
    p.loose = D.add(g, d.shape, {
      pos, quat, vel, angVel: spin, mass: d.mass, restitution: 0.12, friction: 0.7,
      sound: d.sound === 'wood' ? 'wood' : 'clang', kind: 'prop', cap: 200, offset: d.off, inst: true, solid: true,
    });
    if (spec.kind === 'chair') this.ctx.litter.tag(p.loose, 'chair', { mass: d.mass, r: 0.35, big: true });
    return p.loose;
  }
  /** Where it came to rest on its owner's screen. */
  settle(p, pos, quat) {
    if (!p.broken) this.loosen(p, V(), V());
    const it = p.loose;
    if (!it || !this.ctx.debris.has(it)) return;
    if (it.body) {
      it.body.setTranslation(pos, true);
      it.body.setRotation(quat, true);
      it.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      it.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      it.body.sleep();
      this.ctx.debris.sync(it);
    } else {
      it.mesh.position.copy(pos);
      it.mesh.quaternion.copy(quat);
      this.inst?.update(it.mesh);
    }
  }

  /** Cars ploughing into things: checked just before the physics step, so a prop gives way instead of stopping the car dead. */
  cars(cars, dt) {
    for (const c of cars) {
      if (!(c.speed >= 1.5)) continue; // (NaN too)
      const S = c.S, ahead = c.speed * dt * 3 + 0.15;
      for (const p of this.list) {
        if (p.broken) continue;
        const s = p.spec;
        if (Math.abs(s.x - c.p.x) > 4 || Math.abs(s.z - c.p.z) > 4) continue;
        const l = c.toLocal(_v.set(s.x, s.y + 0.3, s.z), _v);
        const mx = S.W / 2 + p.D.r + ahead - Math.abs(l.x), mz = S.hl + p.D.r + ahead - Math.abs(l.z);
        if (mx < 0 || mz < 0 || l.y < -1 || l.y > 1.6) continue;
        const at = V(s.x, s.y + 0.4, s.z);
        const cv = c.velAt(at, V());
        const sp = cv.length();
        if (!Number.isFinite(sp)) continue;
        // anchored things (hydrants, post boxes) stop a crawling car; anything else goes over
        if (p.D.carBreak && sp < p.D.carBreak) continue;
        this.break(p, cv.clone().multiplyScalar(0.8).add(V(0, sp * 0.18 + 0.8, 0)), at);
        // it takes a bite out of the car's speed on the way
        const k = clamp(p.D.mass / 900, 0.01, 0.12);
        const v = c.body.linvel();
        c.body.setLinvel({ x: v.x * (1 - k), y: v.y, z: v.z * (1 - k) }, true);
        this.ctx.sfx?.('crash', clamp(sp / 20, 0.2, 0.6));
        p.by = c.driver;
      }
    }
  }

  update(dt, actors) {
    const ground = (q) => this.ctx.colliders.groundAt(q.x, q.z, q.y + 0.05);
    // free-standing ones something woke: follow the body; shoved off the spot, it's loose
    for (const p of this.list) {
      if (p.broken || !p.body) continue;
      if (p.body.isSleeping()) {
        // (dozed back off where it was nudged to: one last sync)
        if (p.awake) { p.awake = false; this.follow(p); }
        continue;
      }
      p.awake = true;
      this.follow(p);
      const s = p.spec, t = p.body.translation();
      const up = _v.set(0, 1, 0).applyQuaternion(p.g.quaternion).y;
      if (Math.hypot(t.x - s.x, t.z - s.z) > SHIFT || up < Math.cos(TILT)) {
        const lv = p.body.linvel(), av = p.body.angvel();
        const v = V(lv.x, lv.y, lv.z);
        // knocked flying rather than nudged: that's a wreck (the bin goes over and spills)
        this.loosen(p, v, V(av.x, av.y, av.z), null, v.length() > 4.5);
      }
    }
    // rocking after a blow
    for (const p of this.list) {
      if (p.broken || (!p.wob && !p.wobV)) continue;
      p.wobV += (-p.wob * 260 - p.wobV * 9) * dt;
      p.wob += p.wobV * dt;
      if (Math.abs(p.wob) < 1e-4 && Math.abs(p.wobV) < 1e-3) { p.wob = p.wobV = 0; }
      _q.setFromAxisAngle(p.wobAx, clamp(p.wob, -0.3, 0.3));
      p.g.quaternion.setFromAxisAngle(_v.set(0, 1, 0), p.spec.yaw).premultiply(_q);
      this.inst?.update(p.g);
    }
    this.shards.update(dt, ground);
    let loud = 0;
    for (let i = this.gushers.length - 1; i >= 0; i--) {
      const G = this.gushers[i];
      const power = G.update(dt, ground);
      if (!G.alive) { G.dispose(); this.gushers.splice(i, 1); continue; }
      // the column throws around anyone standing in it, and whatever's lying on it
      if (power > 0) {
        const d = this.ctx.camera ? this.ctx.camera.position.distanceTo(G.at) : 10;
        loud = Math.max(loud, power * clamp(1 - d / 30, 0, 1));
        for (const a of actors) {
          if (a.seat) continue;
          const hp = a.hero.pos;
          if (Math.hypot(hp.x - G.at.x, hp.z - G.at.z) > 0.45) continue;
          // (tuned at 60fps: k scales every push to the frame's length)
          const k = dt * 60;
          if (a.mode === 'ragdoll') { for (const pt of a.rd.list) pt.body.applyImpulse({ x: rnd(-0.05, 0.05) * k, y: 0.45 * power * k, z: rnd(-0.05, 0.05) * k }, true); }
          // (a standing person: shoved at most ~15 times a second, whatever the framerate)
          else if (!(a.jetT > performance.now())) { a.jetT = performance.now() + 66; a.shove(V(hp.x - G.at.x, 0, hp.z - G.at.z).normalize().multiplyScalar(0.8)); }
        }
        for (const it of this.ctx.debris.near(G.at.clone().setY(G.at.y + 0.4), 0.6)) {
          it.body.applyImpulse({ x: rnd(-0.1, 0.1) * it.mass * dt * 60, y: it.mass * 14 * dt, z: rnd(-0.1, 0.1) * it.mass * dt * 60 }, true);
        }
      }
    }
    if (this.gushers.length || this.spray) {
      this.spray ||= this.ctx.loop?.('spray');
      this.spray?.set(loud * 0.7, 1);
    }
  }

  follow(p) {
    const t = p.body.translation(), r = p.body.rotation();
    p.g.position.set(t.x, t.y, t.z);
    p.g.quaternion.set(r.x, r.y, r.z, r.w);
    this.inst?.update(p.g);
  }

  /**
   * Broken ones far from `focus` and out of sight (seen(p) false) stand again, as new - so a
   * street you smashed up is back to normal next time round. Pieces someone's holding: left be.
   */
  recycle(focus, far, seen) {
    const D = this.ctx.debris;
    for (const p of this.list) {
      const s = p.spec;
      if (!p.broken || p.carried || this.gushers.some((G) => Math.hypot(G.at.x - s.x, G.at.z - s.z) < 1)) continue;
      const at = p.loose ? D.pos(p.loose) : p.g.position;
      if (Math.hypot(s.x - focus.x, s.z - focus.z) < far || Math.hypot(at.x - focus.x, at.z - focus.z) < far) continue;
      if (seen(_v.set(s.x, s.y, s.z)) || seen(at)) continue;
      const bits = [p.loose, ...(p.pieces || [])].filter(Boolean);
      if (bits.some((it) => !D.has(it))) continue;
      for (const it of bits) D.remove(it);
      p.loose = null; p.pieces = null;
      this.place(p);
      if (s.seat) { s.seat.o.y += 100; s.seat.by = null; }
    }
  }

  /** Gone for good (a placed prop, when the map changes). */
  remove(p) {
    const { world } = this.ctx;
    if (p.loose) this.ctx.debris?.release(p.loose);
    p.loose = null;
    this.inst?.detach(p.g, null);
    p.g.removeFromParent();
    if (p.body) world.removeRigidBody(p.body);
    else if (p.col) world.removeCollider(p.col, true);
    p.body = p.col = null;
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
  }

  reset() {
    for (const p of this.list) {
      if (p.broken) {
        if (p.loose) this.ctx.debris.release(p.loose);
        p.loose = null; p.pieces = null; p.carried = false;
        this.place(p);
        if (p.spec.seat) { p.spec.seat.o.y += 100; p.spec.seat.by = null; }
      }
    }
    this.shards.clear();
    for (const G of this.gushers) G.dispose();
    this.gushers.length = 0;
    this.spray?.set(0, 1);
  }
}
