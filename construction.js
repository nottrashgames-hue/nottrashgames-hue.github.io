import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { groups, G_DEBRIS, G_WORLD, G_CAR, G_BODY, G_QUERY } from './physics.js';
import { partNear } from './strike.js';

/*
  Construction (room / baseplate only): boards, nails, bricks and a bucket of cement.

  - Every piece is a loose physics body the hands can pick up (it's handed to the grabbers as a
    "chunk", like a cut-off piece).
  - A nail is driven by a hammer: strike its head and it goes in a bit further each blow. Its
    point sinks into the first thing in front of it; once it's in far enough to come out the
    back of that into something else, the two are nailed together (a fixed joint). Nailed into
    a wall or the floor, whatever it went through is held there.
  - Dip a brick (or a board) in the cement and it comes out mortared: set down against
    something and left to settle, it sets fast to it.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const SOLID = groups(G_DEBRIS, G_WORLD | G_CAR | G_DEBRIS | G_BODY | G_QUERY);
const RAY = groups(G_QUERY, G_WORLD | G_DEBRIS | G_CAR);
const NAIL_L = 0.09;
const MAX_ITEMS = 160;
const _v = V(), _w = V(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = V();
const tv = (t, o) => o.set(t.x, t.y, t.z);
const tq = (r, o) => o.set(r.x, r.y, r.z, r.w);

function woodTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#c4935c'; g.fillRect(0, 0, 256, 32);
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = `rgba(${90 + Math.random() * 40},${55 + Math.random() * 25},25,${0.15 + Math.random() * 0.25})`;
    g.lineWidth = 0.6 + Math.random() * 1.6;
    const y = Math.random() * 32;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= 256; x += 32) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 1.6);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let MATS = null;
function mats() {
  return (MATS ||= {
    wood: new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.85 }),
    brick: new THREE.MeshStandardMaterial({ color: 0x9a4630, roughness: 0.95 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.8, roughness: 0.35 }),
    bucket: new THREE.MeshStandardMaterial({ color: 0x2f6fb8, roughness: 0.6, side: THREE.DoubleSide }),
    mortar: new THREE.MeshStandardMaterial({ color: 0xa8a49a, roughness: 1 }),
    wet: new THREE.MeshStandardMaterial({ color: 0x8f8b82, roughness: 0.55 }),
  });
}

const KINDS = {
  board: { half: [0.6, 0.0125, 0.07], mass: 3 },
  brick: { half: [0.1075, 0.0325, 0.051], mass: 2.3 },
  nail: { half: [0.006, NAIL_L / 2, 0.006], mass: 0.05 },
  cement: { mass: 9 },
};

function buildMesh(kind) {
  const M = mats(), g = new THREE.Group();
  const add = (geo, mat, y = 0) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  if (kind === 'board') add(new THREE.BoxGeometry(1.2, 0.025, 0.14), M.wood);
  else if (kind === 'brick') add(new THREE.BoxGeometry(0.215, 0.065, 0.102), M.brick);
  else if (kind === 'nail') {
    add(new THREE.CylinderGeometry(0.0022, 0.0022, NAIL_L - 0.008, 6), M.steel, 0.002);
    add(new THREE.ConeGeometry(0.0022, 0.008, 6).rotateX(Math.PI), M.steel, -NAIL_L / 2 + 0.004);
    add(new THREE.CylinderGeometry(0.0065, 0.0065, 0.0025, 12), M.steel, NAIL_L / 2 - 0.001);
  } else if (kind === 'cement') {
    add(new THREE.CylinderGeometry(0.16, 0.13, 0.28, 24, 1, true), M.bucket);
    add(new THREE.CircleGeometry(0.13, 24).rotateX(Math.PI / 2), M.bucket, -0.14);
    add(new THREE.CircleGeometry(0.152, 24).rotateX(-Math.PI / 2), M.wet, 0.1);
    add(new THREE.TorusGeometry(0.16, 0.008, 6, 24).rotateX(Math.PI / 2), M.bucket, 0.14);
  }
  return g;
}

export class Construction {
  /** ctx: { scene, world, sfx, hammers: () => [melee], self: () => Set of body handles to ignore } */
  constructor(ctx) {
    this.ctx = ctx;
    this.items = [];
    this.nails = [];  // driven nails (no body of their own any more)
    this.joints = [];
  }

  /** What the hands can take hold of (grabbing.js / vr.js chunks). */
  grabbable() { return this.items; }

  spawn(kind, at, yaw = 0) {
    const K = KINDS[kind];
    if (!K) return null;
    const w = this.ctx.world;
    const lift = kind === 'cement' ? 0.15 : kind === 'board' ? 0.03 : kind === 'brick' ? 0.04 : 0.02;
    const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw);
    if (kind === 'nail') q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), Math.PI / 2)); // (lying on its side)
    const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y + lift, at.z).setRotation(q)
      .setLinearDamping(0.05).setAngularDamping(0.4).setCcdEnabled(true));
    let desc;
    if (kind === 'cement') desc = RAPIER.ColliderDesc.cylinder(0.14, 0.155);
    else desc = RAPIER.ColliderDesc.cuboid(...K.half);
    const col = w.createCollider(desc.setMass(K.mass).setFriction(kind === 'brick' ? 0.9 : 0.75).setRestitution(0.03).setCollisionGroups(SOLID), body);
    const group = buildMesh(kind);
    this.ctx.scene.add(group);
    // (a board: a big piece, two hands on it - grabbing.js)
    const it = { kind, group, body, cols: [col], held: false, what: kind === 'board' ? 'body' : 'construction', t: 0, still: 0 };
    it.half = kind === 'cement' ? [0.155, 0.14, 0.155] : K.half;
    it.near = (p, out = V()) => this.near(it, p, out);
    this.items.push(it);
    this.sync(it);
    if (this.items.length > MAX_ITEMS) this.removeItem(this.items.find((x) => !x.held && !x.joints?.length) || this.items[0]);
    return it;
  }

  /** The point on piece it nearest p (world): where a hand closes on it, not just its middle. */
  near(it, p, out = V()) {
    const b = it.body, t = tv(b.translation(), _v), q = tq(b.rotation(), _q);
    const [hx, hy, hz] = it.half;
    out.copy(p).sub(t).applyQuaternion(_q2.copy(q).invert());
    out.set(clamp(out.x, -hx, hx), clamp(out.y, -hy, hy), clamp(out.z, -hz, hz));
    return out.applyQuaternion(q).add(t);
  }

  removeItem(it) {
    const w = this.ctx.world;
    // nails driven into it go with it
    for (const n of [...this.nails]) if (n.host === it.body) this.removeNail(n);
    for (const j of it.joints || []) this.dropJoint(j);
    const i = this.items.indexOf(it);
    if (i >= 0) this.items.splice(i, 1);
    it.group.removeFromParent();
    if (it.body && w.getRigidBody(it.body.handle)) w.removeRigidBody(it.body);
    it.body = null;
  }
  removeNail(n) {
    const i = this.nails.indexOf(n);
    if (i >= 0) this.nails.splice(i, 1);
    n.group.removeFromParent();
    const w = this.ctx.world;
    if (n.body && w.getRigidBody(n.body.handle)) w.removeRigidBody(n.body);
    if (n.joint) this.dropJoint(n.joint);
  }
  dropJoint(j) {
    const w = this.ctx.world;
    const i = this.joints.indexOf(j);
    if (i >= 0) this.joints.splice(i, 1);
    try { if (w.getImpulseJoint(j.handle)) w.removeImpulseJoint(j, true); } catch (e) { /* gone with its body */ }
  }

  clear() {
    for (const n of [...this.nails]) this.removeNail(n);
    for (const it of [...this.items]) this.removeItem(it);
    for (const j of [...this.joints]) this.dropJoint(j);
  }

  sync(it) {
    const b = it.body;
    tv(b.translation(), it.group.position);
    tq(b.rotation(), it.group.quaternion);
  }

  /** Is this body something a nail or mortar may join to: a construction piece, or the level itself. */
  joinable(body) {
    if (!body) return false;
    if (body.isFixed()) return true;
    return this.items.some((x) => x.body === body && x.kind !== 'nail');
  }

  /** Fix a and b together where they are now (at point p, world). */
  join(a, b, p) {
    if (!a || !b || a === b || (a.isFixed() && b.isFixed())) return null;
    const ta = tv(a.translation(), V()), qa = tq(a.rotation(), new THREE.Quaternion());
    const tb = tv(b.translation(), V()), qb = tq(b.rotation(), new THREE.Quaternion());
    const la = p.clone().sub(ta).applyQuaternion(qa.clone().invert());
    const lb = p.clone().sub(tb).applyQuaternion(qb.clone().invert());
    const fa = qa.clone().invert(), fb = qb.clone().invert();
    const data = RAPIER.JointData.fixed({ x: la.x, y: la.y, z: la.z }, { x: fa.x, y: fa.y, z: fa.z, w: fa.w },
      { x: lb.x, y: lb.y, z: lb.z }, { x: fb.x, y: fb.y, z: fb.z, w: fb.w });
    const j = this.ctx.world.createImpulseJoint(data, a, b, true);
    this.joints.push(j);
    for (const it of this.items) if (it.body === a || it.body === b) (it.joints ||= []).push(j);
    return j;
  }

  /** First thing along a ray (skipping excluded bodies, loose nails and ourselves). */
  cast(from, dir, len, skip) {
    const w = this.ctx.world, self = this.ctx.self?.();
    const ray = new RAPIER.Ray({ x: from.x, y: from.y, z: from.z }, { x: dir.x, y: dir.y, z: dir.z });
    const nailBodies = new Set(this.items.filter((x) => x.kind === 'nail').map((x) => x.body.handle));
    const hit = w.castRay(ray, len, true, undefined, RAY, undefined, undefined, (c) => {
      const b = c.parent();
      if (!b || !b.isEnabled()) return false;
      if (skip && skip.has(b.handle)) return false;
      if (nailBodies.has(b.handle) || self?.has(b.handle)) return false;
      return true;
    });
    if (!hit) return null;
    const t = hit.timeOfImpact ?? hit.toi;
    return { t, point: from.clone().addScaledVector(dir, t), body: hit.collider.parent() };
  }

  update(dt) {
    const w = this.ctx.world;
    for (const it of [...this.items]) {
      if (!it.body || !w.getRigidBody(it.body.handle)) { this.removeItem(it); continue; }
      this.sync(it);
      const p = it.group.position;
      if (p.y < -30 && !it.held) { this.removeItem(it); continue; }
    }
    for (const n of [...this.nails]) {
      if (n.host && !w.getRigidBody(n.host.handle)) { this.removeNail(n); continue; }
      this.poseNail(n);
    }
    this.hammering(dt);
    this.stabbing(dt);
    this.bite(dt);
    this.mortar(dt);
  }

  // ---- nails ----
  /** A driven nail's place: on its host, its point `depth` past where it went in. */
  poseNail(n) {
    const hb = n.host;
    const ht = tv(hb.translation(), _v), hq = tq(hb.rotation(), _q);
    const E = _p.copy(n.lp).applyQuaternion(hq).add(ht);
    const ax = _w.copy(n.la).applyQuaternion(hq);
    n.group.position.copy(E).addScaledVector(ax, n.depth - NAIL_L / 2);
    n.group.quaternion.setFromUnitVectors(V(0, -1, 0), ax);
    n.head = (n.head || V()).copy(E).addScaledVector(ax, n.depth - NAIL_L);
    n.tip = (n.tip || V()).copy(E).addScaledVector(ax, n.depth);
    n.axis = (n.axis || V()).copy(ax);
    if (n.outFor !== n.depth) { n.outFor = n.depth; n.tipOut = this.tipOut(n); }
  }

  /** Has the nail's point come right through its host (out the far side, sharp end showing)? */
  tipOut(n) {
    if (n.depth < 0.012 || n.host.isFixed()) return false;
    const ray = new RAPIER.Ray({ x: n.tip.x, y: n.tip.y, z: n.tip.z }, { x: -n.axis.x, y: -n.axis.y, z: -n.axis.z });
    const hit = this.ctx.world.castRay(ray, n.depth, true, undefined, RAY, undefined, undefined, (c) => c.parent() === n.host);
    // (starting inside it: hit at once - the point's still buried)
    return !!hit && (hit.timeOfImpact ?? hit.toi) > 0.003;
  }

  /**
   * A board with a nail in it, swung into someone: the nail goes into them. The sharp end if
   * it's been driven right through, otherwise the shank left standing out of the wood.
   */
  stabbing(dt) {
    const actors = this.ctx.actors?.() || [], me = this.ctx.owner?.();
    if (!actors.length || dt <= 0) return;
    for (const n of this.nails) {
      const host = this.items.find((x) => x.body === n.host);
      if (!host) { n.prevStab = null; continue; }
      const stub = NAIL_L - n.depth;
      const sharp = n.tipOut;
      if (!sharp && stub < 0.02) { n.prevStab = null; continue; }
      // the end that's standing out, a little in from its very end
      const p = sharp ? n.tip.clone().addScaledVector(n.axis, -0.004) : n.head.clone().addScaledVector(n.axis, 0.004);
      const out = sharp ? n.axis.clone() : n.axis.clone().negate();
      const prev = n.prevStab;
      n.prevStab = p;
      n.stabCool = Math.max(0, (n.stabCool || 0) - dt);
      if (!prev || n.stabCool > 0) continue;
      const vel = p.clone().sub(prev).divideScalar(dt);
      const sp = vel.length();
      if (sp < 2.6 || sp > 60) continue;
      // point first (near enough): it goes in; flat on, the board just thumps them
      if (vel.dot(out) < sp * 0.3) continue;
      let best = null, bd = 0.015;
      for (const A of actors) {
        if (A === me || !A.rd || !A.groups || A.hero?.shown === false || A.seat) continue;
        if (A.hero.pos.distanceTo(p) > 3 && !(A.mode === 'ragdoll')) continue;
        for (const name of A.rd.names) {
          if (A.rd.parts[name]?.gone) continue;
          for (const q of [p, prev.clone().lerp(p, 0.5)]) {
            const h = partNear(A, name, q);
            if (h && h.dist < bd) { bd = h.dist; best = { A, name, h, q }; }
          }
        }
      }
      if (!best) continue;
      n.stabCool = 0.45;
      const { A, name, h } = best;
      const k = clamp(sp / 9, 0.5, 1.5);
      const head = name === 'head';
      A.struck?.(name, h.point.clone(), vel.clone().clampLength(0, 30), h.normal.clone(), {
        kind: 'blade', mass: 1.6, sev: (sharp ? 1.35 : 1) * k * (head ? 1.3 : 1), ref: 9, maxImp: 28 * k,
        axis: out, stab: true, noPush: false, dent: k, shaft: false, label: 'Nail board',
      }, me);
      const B = this.ctx.blood;
      B?.inked(A).spray(h.point, h.normal.clone().negate(), 2.2 + sp * 0.15, Math.round(8 + 6 * k), 0.45, 1);
      this.ctx.sfx?.('flesh', 0.6 + 0.3 * k, { rate: 0.95 + Math.random() * 0.1 });
      this.ctx.sfx?.('punch', 0.5 + 0.3 * k, { rate: 0.75 });
      if (head) this.ctx.sfx?.('crunch', 0.45 * k, { rate: 1.1 });
      this.ctx.buzz?.(0.7);
    }
  }

  hammering(dt) {
    const hs = this.ctx.hammers?.() || [];
    for (const m of hs) {
      if (!m.mesh?.parent) { m._cHead = null; continue; }
      m.mesh.updateMatrixWorld(true);
      const head = V(0, 0.23, 0).applyMatrix4(m.mesh.matrixWorld);
      const prev = m._cHead;
      m._cHead = head;
      m._cCool = Math.max(0, (m._cCool || 0) - dt);
      if (!prev || dt <= 0) continue;
      // the claw (the back of the head): hooked under a nail's head, it draws the nail out
      if (this.claw(m, dt)) continue;
      const vel = head.clone().sub(prev).divideScalar(dt);
      const sp = vel.length();
      if (sp < 1.6 || m._cCool > 0) continue;
      // what the head swept past this frame: the nearest nail head
      let best = null, bd = 0.075;
      const seg = (pt) => {
        const ab = _v.subVectors(head, prev), t = clamp(_w.subVectors(pt, prev).dot(ab) / (ab.lengthSq() || 1), 0, 1);
        return _w.copy(prev).addScaledVector(ab, t).distanceTo(pt);
      };
      for (const n of this.nails) {
        if (n.depth >= NAIL_L - 0.004) continue;
        const d = seg(n.head);
        if (d < bd && vel.dot(n.axis) > sp * 0.35) { bd = d; best = { n }; }
      }
      for (const it of this.items) {
        if (it.kind !== 'nail') continue;
        const c = it.group.position, ax = V(0, -1, 0).applyQuaternion(it.group.quaternion);
        const hd = c.clone().addScaledVector(ax, -NAIL_L / 2);
        const d = Math.min(seg(hd), seg(c) + 0.02);
        if (d < bd) { bd = d; best = { it, ax, hd }; }
      }
      if (!best) continue;
      m._cCool = 0.12;
      const k = clamp(sp / 6, 0.5, 1.4);
      if (best.n) this.drive(best.n, k);
      else this.start(best.it, best.ax, best.hd, vel.clone().normalize(), k);
    }
  }

  /** A loose nail struck: its point goes into whatever it's against. */
  start(it, ax, head, dir, k) {
    // (pointing the way it's hit - near enough along it: it goes in straight; otherwise the blow
    // turns it the way the hammer came down)
    const axis = ax.dot(dir) > 0.6 ? ax.clone() : dir.clone();
    const hit = this.cast(head, axis, NAIL_L + 0.03, new Set([it.body.handle]));
    this.ctx.sfx?.('clank', 0.5, { rate: 1.5 + Math.random() * 0.2 });
    if (!hit || !this.joinable(hit.body) || hit.t < 0.001) return;
    const n = this.stick(it, hit.body, hit.point, axis, 0);
    this.drive(n, k);
  }

  /** Loose nail it, its point in host at E (world) along axis, depth in. */
  stick(it, hb, E, axis, depth) {
    const ht = tv(hb.translation(), V()), hq = tq(hb.rotation(), new THREE.Quaternion()).invert();
    // the loose nail becomes a driven one (its body put away)
    it.body.setEnabled(false);
    const i = this.items.indexOf(it);
    if (i >= 0) this.items.splice(i, 1);
    const n = { it, group: it.group, body: it.body, host: hb, lp: E.clone().sub(ht).applyQuaternion(hq), la: axis.clone().normalize().applyQuaternion(hq), depth };
    this.nails.push(n);
    this.poseNail(n);
    return n;
  }

  /**
   * Pressed point-first against a piece (in the hand, or dropped on it): the nail bites in just
   * a little - enough to stay there, standing in it, and go where the piece goes.
   */
  bite(dt) {
    for (const it of [...this.items]) {
      if (it.kind !== 'nail') continue;
      it.cool = Math.max(0, (it.cool || 0) - dt);
      if (it.cool > 0) continue;
      const c = it.group.position, ax = _p.set(0, -1, 0).applyQuaternion(it.group.quaternion).clone();
      const hit = this.cast(c, ax, NAIL_L / 2 + 0.008, new Set([it.body.handle]));
      if (!hit || !hit.body || hit.body.isFixed() || !this.joinable(hit.body) || hit.t < NAIL_L * 0.25) continue;
      // (it's the point that's against it: the shaft standing off the surface, not lying along it)
      const n = this.stick(it, hit.body, hit.point, ax, 0.012);
      this.ctx.sfx?.('clank', 0.3, { rate: 1.8 });
      this.ctx.buzz?.(0.25);
      void n;
    }
  }

  /** The hammer's claw on a nail: hook on, and the nail comes out as the hammer's drawn back. */
  claw(m, dt) {
    if (m.state !== 'held') { m._claw = null; return false; }
    const c = V(0, 0.237, -0.07).applyMatrix4(m.mesh.matrixWorld);
    let n = m._claw;
    if (n && !this.nails.includes(n)) n = m._claw = null;
    if (!n) {
      let bd = 0.03;
      for (const x of this.nails) {
        const d = x.head.distanceTo(c);
        if (d < bd) { bd = d; n = x; }
      }
      if (!n) return false;
      m._claw = n;
      this.ctx.sfx?.('clank', 0.3, { rate: 0.9 });
      this.ctx.buzz?.(0.3);
    }
    // how far the claw's drawn the head back out along the nail - and off its line: slipped off
    const out = _v.subVectors(c, n.head);
    const along = -out.dot(n.axis);
    const off = out.addScaledVector(n.axis, along).length();
    if (off > 0.05 || along < -0.04) { m._claw = null; return false; }
    if (along > 0.002) {
      const was = n.depth;
      n.depth = Math.max(0, n.depth - along);
      // (out at all: whatever it held together comes apart)
      if (n.joint && n.depth < was) { this.dropJoint(n.joint); n.joint = null; this.ctx.sfx?.('crowbar', 0.35, { rate: 1.4 }); }
      if (Math.random() < 0.3) this.ctx.sfx?.('clank', 0.18, { rate: 0.7 + Math.random() * 0.2 });
      this.ctx.buzz?.(0.15);
      this.poseNail(n);
      if (n.depth <= 0) { this.pullOut(n); m._claw = null; }
    }
    return true;
  }

  /** All the way out: a loose nail again. */
  pullOut(n) {
    const i = this.nails.indexOf(n);
    if (i >= 0) this.nails.splice(i, 1);
    const it = n.it, b = it.body, p = n.group.position, q = n.group.quaternion;
    b.setTranslation({ x: p.x - n.axis.x * 0.01, y: p.y - n.axis.y * 0.01, z: p.z - n.axis.z * 0.01 }, true);
    b.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    b.setLinvel({ x: -n.axis.x * 0.6, y: 0.5 - n.axis.y * 0.6, z: -n.axis.z * 0.6 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    b.setEnabled(true);
    it.cool = 1.2; it.held = false;
    this.items.push(it);
    this.ctx.sfx?.('pin', 0.5, { rate: 1.2 });
  }

  drive(n, k) {
    const was = n.depth;
    n.depth = Math.min(NAIL_L - 0.002, n.depth + 0.028 * k);
    this.poseNail(n);
    this.ctx.sfx?.('clank', 0.45 + 0.3 * k, { rate: 1.25 + n.depth * 3 + Math.random() * 0.1 });
    this.ctx.buzz?.(0.5 * k);
    if (n.joint || n.depth <= was) return;
    // has its point come out of the back into something else? then they're nailed together
    const E = n.head.clone().addScaledVector(n.axis, NAIL_L - n.depth);
    const hit = this.cast(E, n.axis, n.depth, new Set([n.host.handle]));
    if (hit && this.joinable(hit.body) && hit.body !== n.host) {
      n.joint = this.join(n.host, hit.body, hit.point);
      if (n.joint) this.ctx.sfx?.('bolt', 0.4, { rate: 1.3 });
    }
  }

  // ---- bricks and cement ----
  mortar(dt) {
    const w = this.ctx.world;
    const buckets = this.items.filter((x) => x.kind === 'cement');
    for (const it of this.items) {
      if (it.kind !== 'brick' && it.kind !== 'board') continue;
      if (!it.wet && !it.set) {
        for (const B of buckets) {
          const top = _p.set(0, 0.1, 0).applyQuaternion(B.group.quaternion).add(B.group.position);
          if (it.group.position.distanceTo(top) < 0.2) { this.wet(it); break; }
        }
        continue;
      }
      if (!it.wet || it.held) { it.still = 0; continue; }
      const lv = it.body.linvel(), av = it.body.angvel();
      if (Math.hypot(lv.x, lv.y, lv.z) > 0.12 || Math.hypot(av.x, av.y, av.z) > 0.4) { it.still = 0; continue; }
      it.still += dt;
      if (it.still < 0.45) continue;
      // set: fixed to everything it's resting against
      const touching = new Map();
      for (const c of it.cols) {
        w.contactPairsWith(c, (o) => {
          const ob = o.parent();
          if (!ob || ob === it.body || touching.has(ob.handle) || !this.joinable(ob)) return;
          let n = 0;
          w.contactPair(c, o, (man) => { n += man.numContacts(); });
          if (n > 0) touching.set(ob.handle, ob);
        });
      }
      if (!touching.size) continue;
      for (const ob of [...touching.values()].slice(0, 4)) this.join(it.body, ob, it.group.position.clone());
      it.wet = false; it.set = true;
      for (const m of it.mortarMeshes || []) m.material = mats().mortar;
      this.ctx.sfx?.('brick', 0.35, { rate: 1.3 });
    }
  }

  wet(it) {
    it.wet = true;
    const M = mats();
    const [hx, hy, hz] = KINDS[it.kind].half;
    it.mortarMeshes = [-1, 1].map((s) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2 + 0.006, 0.008, hz * 2 + 0.006), M.wet);
      m.position.y = s * (hy + 0.003);
      it.group.add(m);
      return m;
    });
    this.ctx.sfx?.('splat', 0.4, { rate: 0.8 });
  }
}
