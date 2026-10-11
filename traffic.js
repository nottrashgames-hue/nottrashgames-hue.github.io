import * as THREE from 'three';

/*
  Traffic: AI drivers on the street grid. Every intersection has four arms; an arm either
  leads to the next intersection or runs out to a dead end, where cars swing round in a wide
  U-turn and come back. Drivers keep to the right-hand lane, stop at red lights, turn at
  junctions, follow the car in front and brake (and honk) for people in the road.

  A route is a list of points { x, z, v (speed limit), stop (signal group at a stop line) },
  extended one junction at a time as the car drives it.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const CRUISE = 11;
const _l = V();

export class Traffic {
  constructor(roads, sys, sfx) {
    this.R = roads;
    this.sys = sys;
    this.sfx = sfx;
    this.nodes = [];
    for (const x of roads.xs) for (const z of roads.zs) this.nodes.push({ x, z });
  }

  // ---------- geometry ----------
  right(d) { return [-d[1], d[0]]; }
  entry(I, d) { const r = this.right(d), R = this.R; return [I.x - d[0] * R.stop + r[0] * R.lane, I.z - d[1] * R.stop + r[1] * R.lane]; }
  exitP(I, d) { const r = this.right(d), R = this.R; return [I.x + d[0] * R.exit + r[0] * R.lane, I.z + d[1] * R.exit + r[1] * R.lane]; }
  /** The next intersection from I heading d, or null (a dead end). */
  next(I, d) {
    let best = null, bd = Infinity;
    for (const J of this.nodes) {
      if (J === I) continue;
      const dx = J.x - I.x, dz = J.z - I.z;
      if (d[0] ? (dz !== 0 || dx * d[0] <= 0) : (dx !== 0 || dz * d[1] <= 0)) continue;
      const dist = Math.abs(dx + dz);
      if (dist < bd) { bd = dist; best = J; }
    }
    return best;
  }
  line(out, a, b, v, step = 3) {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let i = 1; i <= n; i++) out.push({ x: a[0] + (b[0] - a[0]) * i / n, z: a[1] + (b[1] - a[1]) * i / n, v });
  }
  /** Through intersection I, arriving heading d, leaving heading d2. */
  connector(out, I, d, d2) {
    const a = this.entry(I, d), b = this.exitP(I, d2);
    const group = d[0] ? 'vx' : 'vz';
    out.push({ x: a[0], z: a[1], v: CRUISE, stop: group });
    if (d[0] === d2[0] && d[1] === d2[1]) { this.line(out, a, b, CRUISE); return; }
    const left = d2[0] === -this.right(d)[0] && d2[1] === -this.right(d)[1];
    const k = Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.42;
    const p1 = [a[0] + d[0] * k, a[1] + d[1] * k], p2 = [b[0] - d2[0] * k, b[1] - d2[1] * k];
    const v = left ? 7.5 : 5.5;
    for (let i = 1; i <= 10; i++) {
      const t = i / 10, u = 1 - t;
      out.push({
        x: u * u * u * a[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * b[0],
        z: u * u * u * a[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * b[1], v,
      });
    }
  }
  /** Out of I heading d: to the next junction, or down the dead end and back. Returns the new state. */
  link(out, I, d) {
    const J = this.next(I, d), a = this.exitP(I, d);
    if (J) { this.line(out, a, this.entry(J, d), CRUISE); return { I: J, d }; }
    const R = this.R, r = this.right(d);
    const at = (along, off) => {
      // along the street (world coordinate along d), off = right of the travel direction
      const cx = d[0] ? 0 : I.x, cz = d[0] ? I.z : 0;
      return [cx + d[0] * along + r[0] * off, cz + d[1] * along + r[1] * off];
    };
    const far = R.end, rad = 3.8;
    this.line(out, a, at(far - 12, R.lane), CRUISE);
    this.line(out, at(far - 12, R.lane), at(far - 5, rad), 5, 1.5);
    for (let i = 1; i <= 12; i++) {
      const th = (i / 12) * Math.PI;
      const p = at(far - 5 + Math.sin(th) * rad, Math.cos(th) * rad);
      out.push({ x: p[0], z: p[1], v: 4.5 });
    }
    this.line(out, at(far - 5, -rad), at(far - 12, -R.lane), 5, 1.5);
    const back = [-d[0], -d[1]];
    this.line(out, at(far - 12, -R.lane), this.entry(I, back), CRUISE);
    return { I, d: back };
  }
  /** Keep a few junctions of route ahead of the car. */
  extend(ai) {
    while (ai.pts.length - ai.i < 30) {
      const { I, d } = ai.st, r = this.right(d);
      const t = Math.random();
      let d2 = t < 0.45 ? d : t < 0.75 ? r : [-r[0], -r[1]];
      // somewhere to be (a police car on a call): the turn that gets closest
      if (ai.goal) {
        let bd = Infinity;
        for (const c of [d, r, [-r[0], -r[1]]]) {
          const J = this.next(I, c);
          const s = J ? Math.hypot(J.x - ai.goal.x, J.z - ai.goal.z) : Math.hypot(I.x - ai.goal.x, I.z - ai.goal.z) + 40;
          if (s < bd) { bd = s; d2 = c; }
        }
      }
      this.connector(ai.pts, I, d, d2);
      ai.st = this.link(ai.pts, I, d2);
    }
    // drop what's long behind
    if (ai.i > 60) { ai.pts.splice(0, ai.i - 10); ai.i = 10; }
  }

  // ---------- spawning ----------
  /** n places in the lanes, heading into a junction, well apart: { pos, yaw, st }. */
  spawns(n) {
    const out = [], dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let tries = 0; out.length < n && tries < 400; tries++) {
      const I = this.nodes[Math.floor(Math.random() * this.nodes.length)];
      const d = dirs[Math.floor(Math.random() * 4)];
      const e = this.entry(I, d);
      const back = 8 + Math.random() * 22;
      const p = [e[0] - d[0] * back, e[1] - d[1] * back];
      if (out.some((o) => Math.hypot(o.pos.x - p[0], o.pos.z - p[1]) < 14)) continue;
      out.push({ pos: V(p[0], 0, p[1]), yaw: Math.atan2(d[0], d[1]), st: { I, d }, start: p, e });
    }
    return out;
  }
  /** Join the traffic from wherever the car is: the lane into the junction it's facing. */
  attachHere(car) {
    const p = car.p, f = car.fwd, dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let best = null, bs = Infinity;
    for (const I of this.nodes) for (const d of dirs) {
      if (d[0] * f.x + d[1] * f.z < 0.3) continue;
      const e = this.entry(I, d), dx = e[0] - p.x, dz = e[1] - p.z;
      const along = dx * d[0] + dz * d[1], lat = Math.abs(dx * d[1] - dz * d[0]);
      if (along < 4 || lat > 6) continue;
      if (along < bs) { bs = along; best = { st: { I, d }, e }; }
    }
    if (!best) return false;
    const { d } = best.st, r = this.right(d);
    // pull out into the lane a few metres ahead
    const lane = [best.e[0] - d[0] * Math.max(0, bs - 6), best.e[1] - d[1] * Math.max(0, bs - 6)];
    const off = (lane[0] - p.x) * r[0] + (lane[1] - p.z) * r[1];
    const start = [p.x + r[0] * off + d[0] * 5, p.z + r[1] * off + d[1] * 5];
    this.attach(car, { st: best.st, start: bs > 12 ? start : [p.x, p.z], e: best.e });
    return true;
  }
  attach(car, sp) {
    const ai = { pts: [], i: 0, st: sp.st, stuckT: 0, waitT: 0, ignoreT: 0, hornCool: 0 };
    this.line(ai.pts, sp.start, sp.e, CRUISE);
    ai.pts.pop();       // the entry point itself comes with the connector (and its stop line)
    this.extend(ai);
    car.ai = ai;
  }

  // ---------- driving ----------
  drive(car, dt, cars, actors, player) {
    const ai = car.ai;
    if (!ai || !car.driver) return;
    const pts = ai.pts, p = car.p, f = car.fwd, v = car.fspeed;
    ai.hornCool -= dt;
    // flipped, or knocked far off the route: give up and get out
    const up = V(0, 1, 0).applyQuaternion(car.q).y;
    let near = Infinity;
    for (let k = Math.max(0, ai.i - 2); k < Math.min(pts.length, ai.i + 6); k++) near = Math.min(near, Math.hypot(pts[k].x - p.x, pts[k].z - p.z));
    if (up < 0.4 || near > 9) { ai.lostT = (ai.lostT || 0) + dt; if (ai.lostT > 2) { this.sys.giveUp(car); return; } }
    else ai.lostT = 0;
    // pass the points we've reached
    while (ai.i < pts.length - 1) {
      const q = pts[ai.i], dx = q.x - p.x, dz = q.z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 6.25 || (dx * f.x + dz * f.z < 0 && d2 < 49)) ai.i++;
      else break;
    }
    this.extend(ai);

    // steering: pure pursuit on a point a speed-dependent distance down the route
    const Ld = 3.5 + Math.max(0, v) * 0.38;
    let tx = pts[ai.i].x, tz = pts[ai.i].z, acc = Math.hypot(tx - p.x, tz - p.z);
    for (let k = ai.i + 1; k < pts.length && acc < Ld; k++) {
      acc += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z);
      tx = pts[k].x; tz = pts[k].z;
    }
    const l = car.toLocal(_l.set(tx, p.y, tz), _l);
    const wb = car.S.axles[0] - car.S.axles[1];
    const delta = Math.atan2(2 * wb * l.x, l.x * l.x + l.z * l.z);
    const maxA = 0.6 / (1 + car.speed * car.speed / 380);
    car.input.steer = clamp(delta / maxA, -1, 1);

    // speed: the route's limits and red lights ahead, then anything in the way
    const siren = !!car.siren, fast = siren ? 1.6 : 1;
    let vt = CRUISE * fast, dist = Math.hypot(pts[ai.i].x - p.x, pts[ai.i].z - p.z);
    const sig = this.R.signals;
    for (let k = ai.i; k < pts.length && dist < 45; k++) {
      if (k > ai.i) dist += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z);
      const q = pts[k];
      vt = Math.min(vt, Math.sqrt(q.v * q.v * fast + 2 * 3 * Math.max(0, dist - 2)));
      if (q.stop && !siren) {
        const s = sig[q.stop];
        // yellow when too close to stop comfortably: go on through
        const committed = s === 'y' && dist < v * v / 8 + 2;
        if (s !== 'g' && !committed) vt = Math.min(vt, dist < 1.2 ? 0 : Math.sqrt(2 * 3.2 * Math.max(0, dist - 1.2)));
      }
    }
    let blocked = null;
    const S = car.S;
    if (ai.ignoreT > 0) ai.ignoreT -= dt;
    else for (const c of cars) {
      if (c === car || Math.abs(c.p.x - p.x) > 30 || Math.abs(c.p.z - p.z) > 30) continue;
      const o = car.toLocal(c.p, _l);
      if (o.z < 0 || o.z > 28) continue;
      const lat = Math.abs(o.x);
      const facing = c.fwd.dot(f);
      // in our lane ahead (or cutting across right in front)
      if (lat > (facing < -0.5 ? 1.3 : 2.1)) continue;
      const gap = o.z - S.hl - c.S.hl - 1.6;
      const cv = Math.max(0, c.v.dot(f));
      const allow = gap <= 0 ? 0 : cv + Math.sqrt(2 * 4 * gap);
      if (allow < vt) { vt = allow; blocked = c; }
    }
    for (const a of actors) {
      if (a.seat) continue;
      const sp = a.state.pos;
      if (Math.abs(sp.x - p.x) > 25 || Math.abs(sp.z - p.z) > 25) continue;
      const o = car.toLocal(sp, _l);
      if (o.z < 0 || Math.abs(o.x) > 1.55 || o.y > 2.5) continue;
      const gap = o.z - S.hl - 1.4;
      if (gap > 4 + Math.max(0, v) * 1.6) continue;
      const allow = gap <= 0 ? 0 : Math.sqrt(2 * 6 * gap);
      if (allow < vt) { vt = allow; blocked = a; }
    }
    // stuck behind something that isn't moving: honk, then after a while squeeze past
    if (blocked && vt < 0.5 && Math.abs(v) < 0.5) {
      ai.waitT += dt;
      if (ai.waitT > 1.5 && ai.hornCool <= 0 && (blocked === player || blocked.driver === player || blocked.driver === undefined)) {
        ai.hornCool = 2.5 + Math.random() * 2;
        const d = car.p.distanceTo(player.hero.pos);
        if (d < 40) this.sfx?.('horn', clamp(1 - d / 40, 0.1, 0.8));
      }
      if (ai.waitT > 7 && blocked.fwd) { ai.ignoreT = 2.5; ai.waitT = 0; }
    } else ai.waitT = 0;

    // pedals
    const I = car.input;
    if (vt < 0.3 && v < 0.6) { I.throttle = 0; I.brake = 1; }
    else if (v < vt) { I.throttle = clamp((vt - v) * 0.45 + 0.1, 0, 1); I.brake = 0; }
    else { I.throttle = 0; I.brake = clamp((v - vt) * 0.35, 0, 1); }
    I.hand = false;
  }
}
