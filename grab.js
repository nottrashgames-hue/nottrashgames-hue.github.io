import * as THREE from 'three';
import { DIM } from './character.js';
import { groups, G_WORLD, G_PROXY, G_BODY, G_QUERY } from './physics.js';

/*
  Procedural grabbing for the active ragdoll. Each hand can reach for, and then hold on to:
    - ledges / edges of level geometry (strong grip)
    - flat walls and poles (a braced palm: weaker, slips sooner)
    - other people: their ragdoll parts, or the capsule of someone still on their feet
  A held grip is a strength-limited spring between palm and anchor, not a rigid joint: it
  carries a lot, but a heavy fall or a hard yank tears it loose, and grip fatigues with time.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const tv = (r, out) => out.set(r.x, r.y, r.z);

const PALM = V(0, -(DIM.FOREARM + 0.07), 0); // grip point in the forearm+hand body frame
const REACH = 0.64;                          // shoulder -> palm, fully extended
const QUERY = groups(G_QUERY, G_WORLD | G_PROXY | G_BODY);

// per kind: max holding force (N, one hand), how long before fatigue sets in (s), slip distance
const KIND = {
  ledge: { f: 520, t: 4.5, slip: 0.1 },
  wall: { f: 220, t: 1.6, slip: 0.06 },
  person: { f: 330, t: 2.4, slip: 0.12 },
};

const _p = V(), _v = V(), _w = V(), _a = V(), _q = new THREE.Quaternion();

export class Hands {
  constructor(rd) {
    this.rd = rd;
    this.world = rd.world;
    this.own = new Set();
    for (const p of rd.list) for (const c of p.cols) this.own.add(c.handle);
    this.hands = ['L', 'R'].map((n, i) => ({
      n, side: i ? -1 : 1, part: rd.parts['fore' + n], state: 'free', t: 0, cool: 0,
      target: null, anchor: V(), load: 0,
    }));
  }

  reset() { for (const h of this.hands) this.free(h, 0); }

  palm(h, out = V()) { return this.rd.point('fore' + h.n, PALM, out); }
  shoulder(h, out = V()) { return this.rd.point('chest', this.rd.parts['upper' + h.n].def.anchor, out); }

  /** Closest graspable point to `probe` within reach of hand h's shoulder, or null. */
  find(h, probe) {
    const w = this.world;
    const hit = w.projectPoint(probe, true, undefined, QUERY, undefined, undefined,
      (c) => !this.own.has(c.handle) && c.handle !== w.groundCollider?.handle && c.parent()?.isEnabled());
    if (!hit) return null;
    const pt = tv(hit.point, V());
    const sh = this.shoulder(h, _a);
    if (pt.distanceTo(sh) > REACH || pt.distanceTo(probe) > 0.5) return null;
    const col = hit.collider, body = col.parent();
    let kind = 'person';
    if (body.isFixed()) {
      // a ledge if there's walkable top surface right behind the point
      const out = _v.subVectors(probe, pt).setY(0);
      if (out.lengthSq() > 1e-6) out.normalize();
      const gy = this.rd.groundY(pt.x - out.x * 0.04, pt.z - out.z * 0.04, pt.y + 0.25);
      kind = Math.abs(gy - pt.y) < 0.05 && pt.y > 0.25 ? 'ledge' : 'wall';
      if (kind === 'ledge') pt.y = gy; // hand wraps over the edge
    }
    return { body, point: pt, kind };
  }

  /** Start reaching toward candidate c (from find). */
  reach(h, c) {
    h.state = 'reach';
    h.t = 0;
    h.kind = c.kind;
    h.body = c.body;
    h.local = this.toLocal(c.body, c.point, V());
    h.load = 0;
  }

  free(h, cool = 0.5) {
    h.state = 'free';
    h.body = null;
    h.cool = cool;
    h.t = 0;
  }

  toLocal(body, pt, out) {
    const r = body.rotation();
    _q.set(r.x, r.y, r.z, r.w).invert();
    return out.copy(pt).sub(tv(body.translation(), _w)).applyQuaternion(_q);
  }
  toWorld(body, local, out) {
    const r = body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    return out.copy(local).applyQuaternion(_q).add(tv(body.translation(), _w));
  }
  /** Current world position of the hand's target / anchor (moves with people). */
  targetPoint(h, out = V()) { return this.toWorld(h.body, h.local, out); }

  holding(i) { return this.hands[i].state === 'hold'; }
  anyHold() { return this.hands.some((h) => h.state === 'hold'); }
  /** 0..1: how much the grips are currently carrying relative to body weight. */
  support() { return this.hands.reduce((s, h) => s + (h.state === 'hold' ? h.load : 0), 0) / 735; }

  /** Frame update: timers, give-up when the target moved out of reach. */
  update(dt) {
    for (const h of this.hands) {
      h.cool = Math.max(0, h.cool - dt);
      if (h.state === 'free') continue;
      h.t += dt;
      if (!h.body || !h.body.isValid?.() || !h.body.isEnabled()) { this.free(h); continue; }
      const tp = this.targetPoint(h, _p);
      if (h.state === 'reach') {
        if (tp.distanceTo(this.shoulder(h, _a)) > REACH + 0.08 || h.t > 0.6) this.free(h, 0.25);
      } else if (h.t > KIND[h.kind].t * 1.8) this.free(h, 1); // exhausted
    }
  }

  /** Physics step: close the grip on contact, hold with a force-limited spring. */
  step(dt) {
    for (const h of this.hands) {
      if (h.state === 'free' || !h.body) continue;
      // (the hand cut off, or what it held cut off: a ghost part, next to weightless - a
      // 9000 N/m spring on it flings it to infinity)
      if (h.part.gone || !h.body.isValid?.() || (h.body.isDynamic() && h.body.mass() < 0.05)) { this.free(h, 0.3); continue; }
      const palm = this.palm(h, _p);
      const tp = this.targetPoint(h, V());
      const d = tp.sub(palm);
      const dist = d.length();
      if (h.state === 'reach') {
        if (dist < 0.1) { h.state = 'hold'; h.t = 0; }
        continue;
      }
      const K = KIND[h.kind];
      if (dist > K.slip) { this.free(h, 0.6); continue; } // torn loose
      // spring-damper on the palm; relative velocity includes a moving target
      const hb = h.part.body;
      const vPalm = pointVel(hb, palm, _v);
      const vT = pointVel(h.body, _a.copy(palm).add(d), _w);
      const f = d.multiplyScalar(9000).addScaledVector(vPalm.sub(vT), -260);
      // fatigue: full strength for K.t seconds, then it fades
      const fat = clamp(1 - (h.t - K.t) / (K.t * 0.8), 0, 1);
      const max = K.f * fat;
      const m = f.length();
      h.load = Math.min(m, max);
      if (m > max) {
        f.multiplyScalar(max / m);
        if (m > max * 2.2) { this.free(h, 0.6); continue; } // yanked out of the hand
      }
      f.multiplyScalar(dt);
      hb.applyImpulseAtPoint(f, palm, true);
      if (h.body.isDynamic()) h.body.applyImpulseAtPoint(f.negate(), palm, true); // pull on whoever we hold
      else if (!h.body.isFixed()) {
        // holding on to someone still on their feet: they feel the tug
        const who = this.world.proxyOwner?.get(h.body.handle);
        if (who) {
          who.tug = (who.tug || 0) + h.load * dt;
          (who.tugDir ||= V()).subVectors(palm, who.hero.pos).setY(0);
        }
      }
    }
  }
}

function pointVel(body, p, out) {
  const lv = body.linvel(), av = body.angvel(), c = body.worldCom();
  const rx = p.x - c.x, ry = p.y - c.y, rz = p.z - c.z;
  return out.set(lv.x + av.y * rz - av.z * ry, lv.y + av.z * rx - av.x * rz, lv.z + av.x * ry - av.y * rx);
}
