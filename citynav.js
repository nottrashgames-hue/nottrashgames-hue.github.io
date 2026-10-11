import * as THREE from 'three';

/*
  Where city pedestrians can go: a graph of walking lines down the middle of every sidewalk,
  joined across the streets by crosswalks that obey the pedestrian signals, plus a few paths
  through the plaza. Also owns the signal cycle and the shop windows people stop to look in.

  Signal cycle (30 s): people crossing along x walk, then it flashes, then the same for z.
  Vehicle lights follow: traffic running parallel to the walkers has green.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const PERIOD = 30;

export class CityNav {
  constructor({ edges, lane, active, crossX, crossZ, y, colliders, shopSpots, extra = [] }) {
    this.y = y;
    this.colliders = colliders;
    this.spots = shopSpots;
    this.nodes = [];
    this.byKey = new Map();
    this.t = 0;
    this.signals = {};
    this.segs = []; // sidewalk stretches, for random spawn points

    const key = (x, z) => `${Math.round(x * 10)},${Math.round(z * 10)}`;
    const node = (x, z) => {
      const k = key(x, z);
      let n = this.byKey.get(k);
      if (!n) { n = { id: this.nodes.length, p: V(x, y, z), links: [] }; this.byKey.set(k, n); this.nodes.push(n); }
      return n;
    };
    const link = (a, b, cross = null, waitA = null, waitB = null) => {
      if (a === b || a.links.some((l) => l.to === b)) return;
      a.links.push({ to: b, cross, wait: waitA, far: waitB });
      b.links.push({ to: a, cross, wait: waitB, far: waitA });
    };
    const extraPts = extra.flat();

    // sidewalk walking lines
    for (const e of edges) {
      const c = e.c + e.n * lane;
      const lim = e.along === 'x' ? active.x : active.z;
      const s = Math.max(e.a0 + lane, -lim), t = Math.min(e.a1 - lane, lim);
      if (t - s < 2) continue;
      const cuts = new Set([s, t]);
      for (const k of e.along === 'x' ? crossX : crossZ) if (k > s + 0.5 && k < t - 0.5) cuts.add(k);
      for (const [px, pz] of extraPts) {
        const [u, w] = e.along === 'x' ? [px, pz] : [pz, px];
        if (Math.abs(w - c) < 0.05 && u > s && u < t) cuts.add(u);
      }
      const list = [...cuts].sort((p, q) => p - q);
      for (let i = 0; i < list.length - 1; i++) {
        const A = e.along === 'x' ? node(list[i], c) : node(c, list[i]);
        const B = e.along === 'x' ? node(list[i + 1], c) : node(c, list[i + 1]);
        link(A, B);
        this.segs.push([A, B]);
      }
    }
    // crosswalks: over the streets that run along z (walking along x) and along x (walking along z)
    const has = (x, z) => this.byKey.get(key(x, z));
    for (const z of crossZ) for (const [a, b] of [[-42, -31], [31, 42]]) {
      const A = has(a - lane, z), B = has(b + lane, z);
      if (A && B) link(A, B, 'x', V(a - 0.7, y, z), V(b + 0.7, y, z));
    }
    for (const x of crossX) for (const [a, b] of [[-34, -23], [23, 34]]) {
      const A = has(x, a - lane), B = has(x, b + lane);
      if (A && B) link(A, B, 'z', V(x, y, a - 0.7), V(x, y, b + 0.7));
    }
    // the plaza
    for (const [[ax, az], [bx, bz]] of extra) link(node(ax, az), node(bx, bz));
  }

  update(dt) {
    this.t = (this.t + dt) % PERIOD;
    const t = this.t, S = this.signals;
    S.x = t < 11 ? 'walk' : t < 15 ? 'flash' : 'hand';
    S.z = t >= 15 && t < 26 ? 'walk' : t >= 26 ? 'flash' : 'hand';
    S.vz = t < 15 ? 'r' : t < 28 ? 'g' : 'y';
    S.vx = t < 13 ? 'g' : t < 15 ? 'y' : 'r';
  }
  /** Seconds of 'walk' left for group g (0 if it isn't showing walk). */
  walkLeft(g) {
    if (this.signals[g] !== 'walk') return 0;
    return g === 'x' ? 11 - this.t : 26 - this.t;
  }

  /** Can you get from a to b in a straight line without walking into anything? */
  clear(a, b, r = 0.28) {
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
    const n = Math.ceil(L / 0.5), y = Math.max(a.y, b.y) + 0.3;
    for (let i = 1; i < n; i++) {
      const k = i / n;
      if (this.colliders.blocked(a.x + dx * k, a.z + dz * k, y, r)) return false;
    }
    return true;
  }

  /** The closest node you can walk straight to. */
  nearest(p) {
    const sorted = this.nodes.slice().sort((a, b) => a.p.distanceToSquared(p) - b.p.distanceToSquared(p));
    for (const n of sorted.slice(0, 8)) if (this.clear(p, n.p)) return n;
    return sorted[0];
  }

  /** Which way to go on from node `at`, having come from `prev`: mostly onward, sometimes across. */
  next(at, prev) {
    let opts = at.links.filter((l) => l.to !== prev);
    if (!opts.length) opts = at.links;
    const w = opts.map((l) => (l.cross ? 0.55 : 1));
    let r = Math.random() * w.reduce((s, x) => s + x, 0);
    for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i]; }
    return opts[opts.length - 1];
  }

  /** A free shop window within reach of p. */
  spotNear(p, range = 14) {
    const c = this.spots.filter((s) => !s.by && s.pos.distanceTo(p) < range);
    c.sort(() => Math.random() - 0.5);
    for (const s of c.slice(0, 4)) if (this.clear(p, s.pos)) return s;
    return null;
  }

  /** Somewhere on a sidewalk, for spawning people. */
  /** A random pavement point inside the box x0..x1, z0..z1 (null if no walkway crosses it). */
  spotIn(x0, z0, x1, z1) {
    const G = this.segGrid ||= new Map();
    const k = `${x0},${z0},${x1},${z1}`;
    let list = G.get(k);
    if (!list) {
      list = this.segs.filter(([A, B]) => Math.max(A.p.x, B.p.x) >= x0 && Math.min(A.p.x, B.p.x) <= x1 && Math.max(A.p.z, B.p.z) >= z0 && Math.min(A.p.z, B.p.z) <= z1);
      G.set(k, list);
    }
    if (!list.length) return null;
    for (let i = 0; i < 8; i++) {
      const [A, B] = list[Math.floor(Math.random() * list.length)];
      const p = A.p.clone().lerp(B.p, 0.05 + Math.random() * 0.9);
      const d = B.p.clone().sub(A.p).normalize();
      const o = (Math.random() - 0.5) * 1.6;
      p.x += -d.z * o; p.z += d.x * o;
      if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1) return p;
    }
    return null;
  }

  randomSpot() {
    const [A, B] = this.segs[Math.floor(Math.random() * this.segs.length)];
    const p = A.p.clone().lerp(B.p, 0.1 + Math.random() * 0.8);
    const d = B.p.clone().sub(A.p).normalize();
    p.x += -d.z * (Math.random() - 0.5) * 1.6;
    p.z += d.x * (Math.random() - 0.5) * 1.6;
    return p;
  }
}
