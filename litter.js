import * as THREE from 'three';
import { sweep } from './strike.js';

/*
  Litter: cans, bottles, bricks, cigarette butts, cups, paper, boxes, bin bags - little rigid
  bodies in the shared debris world. Scattered about the pavements at the start, spilled out of
  knocked-over bins and smashed boxes, and every one of them can be picked up (E), carried and
  thrown (carry.js). Thrown things hurt whoever they hit, in proportion to their weight.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const MATS = new Map();
export function mat(color, rough = 0.7, metal = 0, extra = {}) {
  const k = `${color}|${rough}|${metal}|${extra.opacity ?? 1}`;
  if (!MATS.has(k)) MATS.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra, transparent: (extra.opacity ?? 1) < 1 }));
  return MATS.get(k);
}
export const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
  cylLo: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  cone: new THREE.CylinderGeometry(0.5, 0.38, 1, 12),
  ball: new THREE.IcosahedronGeometry(0.5, 0),
  sph: new THREE.SphereGeometry(0.5, 12, 8),
};
/** A primitive part (unit geometry scaled to size) added to group g. (Litter and props cast no shadows.) */
export function part(g, geo, material, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, shadow = false) {
  const m = new THREE.Mesh(GEO[geo], material);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.rotation.set(rx, ry, rz);
  m.castShadow = shadow;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

// ------------------------------------------------------------------ the kinds of rubbish
const CAN_COLS = [0xc4161c, 0xb8bcc2, 0x1f6e3a, 0x1c4fa0, 0xe8c31f, 0x111111, 0xe06a1a];
const GLASS_COLS = [0x2f6b2a, 0x6b3d12, 0xa8c8c0];
export const LITTER = {
  can: {
    mass: 0.02, sound: 'can', r: 0.07, rest: 0.4,
    build() {
      const g = new THREE.Group(), crushed = Math.random() < 0.35 ? rnd(0.45, 0.7) : 1;
      part(g, 'cyl', mat(pick(CAN_COLS), 0.35, 0.6), 0, 0, 0, 0.066, 0.1 * crushed, 0.066, 0, 0, crushed < 1 ? rnd(-0.2, 0.2) : 0);
      for (const s of [-1, 1]) part(g, 'cyl', mat(0xc9cdd2, 0.3, 0.8), 0, s * (0.05 * crushed + 0.005), 0, 0.058, 0.012, 0.058);
      g.userData.h = 0.061 * crushed;
      return g;
    },
    shape: (g) => ({ cyl: [g.userData.h, 0.033] }),
  },
  bottle: {
    mass: 0.35, sound: 'tick', r: 0.12, rest: 0.25, smash: 7,
    build() {
      const g = new THREE.Group(), m = mat(pick(GLASS_COLS), 0.08, 0.1, { opacity: 0.82 });
      part(g, 'cyl', m, 0, -0.03, 0, 0.07, 0.17, 0.07);
      part(g, 'cone', m, 0, 0.07, 0, 0.05, 0.04, 0.05, Math.PI);
      part(g, 'cyl', m, 0, 0.12, 0, 0.026, 0.07, 0.026);
      return g;
    },
    shape: () => ({ cyl: [0.12, 0.035] }), off: V(0, 0.02, 0),
  },
  brick: {
    mass: 2.6, sound: 'brick', r: 0.13, rest: 0.08,
    build() {
      const g = new THREE.Group();
      part(g, 'box', mat(pick([0x9a4a36, 0x8a3f2e, 0xa65a40]), 0.95), 0, 0, 0, 0.215, 0.065, 0.1025);
      return g;
    },
    shape: () => ({ box: [0.1075, 0.0325, 0.051] }),
  },
  chunk: {
    mass: 1.1, sound: 'brick', r: 0.09, rest: 0.08,
    build() {
      const g = new THREE.Group();
      part(g, 'ball', mat(pick([0x8f8c86, 0x9a4a36, 0x7d7a74]), 0.95), 0, 0, 0, rnd(0.09, 0.13), rnd(0.06, 0.09), rnd(0.08, 0.12), rnd(0, 3), rnd(0, 3), 0);
      return g;
    },
    shape: () => ({ box: [0.05, 0.035, 0.05] }),
  },
  butt: {
    mass: 0.001, sound: null, r: 0.03, rest: 0.1, tiny: true,
    build() {
      const g = new THREE.Group();
      part(g, 'cylLo', mat(0xd98a3a, 0.9), 0, -0.007, 0, 0.0085, 0.016, 0.0085, 0, 0, 0, false);
      part(g, 'cylLo', mat(0xf2efe6, 0.9), 0, 0.008, 0, 0.008, 0.014, 0.008, 0, 0, 0, false);
      part(g, 'cylLo', mat(0x2a2522, 1), 0, 0.0155, 0, 0.0082, 0.002, 0.0082, 0, 0, 0, false);
      return g;
    },
    shape: () => ({ box: [0.0045, 0.016, 0.0045] }),
  },
  cup: {
    mass: 0.015, sound: 'paper', r: 0.08, rest: 0.2,
    build() {
      const g = new THREE.Group();
      part(g, 'cone', mat(0xf4f1ea, 0.8), 0, 0, 0, 0.085, 0.11, 0.085);
      part(g, 'cone', mat(pick([0x7a5230, 0x2a6e4a, 0xb2332b]), 0.9), 0, 0, 0, 0.087, 0.045, 0.087);
      part(g, 'cyl', mat(0xffffff, 0.6), 0, 0.058, 0, 0.088, 0.008, 0.088);
      return g;
    },
    shape: () => ({ cyl: [0.058, 0.04] }), damp: 0.4,
  },
  paper: {
    mass: 0.006, sound: null, r: 0.05, rest: 0.1,
    build() {
      const g = new THREE.Group();
      part(g, 'ball', mat(pick([0xf2f0ea, 0xe8e2cf, 0xd9d4c4]), 1), 0, 0, 0, 0.07, 0.06, 0.065, rnd(0, 3), rnd(0, 3), 0);
      return g;
    },
    shape: () => ({ ball: 0.032 }), damp: 1.2,
  },
  sheet: {
    mass: 0.03, sound: null, r: 0.16, rest: 0.02,
    build() {
      const g = new THREE.Group();
      part(g, 'box', mat(0xe9e5da, 1), 0, 0, 0, 0.29, 0.006, 0.21);
      part(g, 'box', mat(0x6a6a6a, 1), -0.05, 0.0035, 0, 0.15, 0.001, 0.17, 0, 0, 0, false);
      return g;
    },
    shape: () => ({ box: [0.145, 0.004, 0.105] }), damp: 3, angDamp: 3,
  },
  letter: {
    mass: 0.01, sound: null, r: 0.1, rest: 0.02,
    build() {
      const g = new THREE.Group();
      part(g, 'box', mat(pick([0xf5f1e6, 0xdcc9a0, 0xe7eef5]), 1), 0, 0, 0, 0.16, 0.004, 0.1);
      return g;
    },
    shape: () => ({ box: [0.08, 0.003, 0.05] }), damp: 3, angDamp: 3,
  },
  box: {
    mass: 0.6, sound: 'paper', r: 0.25, rest: 0.1, big: true,
    build() {
      const g = new THREE.Group(), s = rnd(0.8, 1.25);
      part(g, 'box', mat(pick([0xb08a5a, 0xa47d4e, 0xc09a68]), 0.95), 0, 0, 0, 0.36 * s, 0.26 * s, 0.3 * s);
      part(g, 'box', mat(0xd8c49a, 0.9), 0, 0.13 * s + 0.001, 0, 0.06, 0.002, 0.3 * s + 0.002, 0, 0, 0, false);
      g.userData.s = s;
      return g;
    },
    shape: (g) => ({ box: [0.18 * g.userData.s, 0.13 * g.userData.s, 0.15 * g.userData.s] }),
  },
  bag: {
    mass: 2.5, sound: 'paper', r: 0.28, rest: 0.05, big: true,
    build() {
      const g = new THREE.Group(), m = mat(0x151617, 0.45, 0.05);
      part(g, 'sph', m, 0, 0, 0, 0.42, 0.4, 0.38);
      part(g, 'cone', m, 0, 0.22, 0, 0.08, 0.1, 0.08);
      return g;
    },
    shape: () => ({ ball: 0.19 }), damp: 0.8, angDamp: 2,
  },
};

const _v = V(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const MIX = ['can', 'can', 'can', 'butt', 'butt', 'butt', 'butt', 'bottle', 'bottle', 'brick', 'brick', 'chunk', 'cup', 'cup', 'paper', 'paper', 'sheet', 'box', 'bag'];

// streaming: the pavements are littered cell by cell around the player
const CELL = 24, SPAWN_R = 62, GONE_R = 82, PER_CELL = 7;

export class Litter {
  /** ctx: { scene, debris, sfx, actors, props? } */
  constructor(ctx) {
    this.ctx = ctx;
    this.flying = new Set();   // thrown pieces still moving fast enough to hurt
  }

  /** One piece of `type` at pos, moving at vel. */
  make(type, pos, vel = V(), spin = null) {
    const D = LITTER[type];
    const mesh = D.build();
    const q = _q.setFromEuler(_e.set(rnd(0, 6.28), rnd(0, 6.28), rnd(0, 6.28)));
    // flat things lie flat, cans and bottles on their sides mostly
    if (type === 'sheet' || type === 'letter' || type === 'box' || type === 'brick') q.setFromEuler(_e.set(0, rnd(0, 6.28), 0));
    if (D.tiny) mesh.traverse((m) => { m.castShadow = false; });
    const it = this.ctx.debris.add(mesh, D.shape(mesh), {
      pos, quat: q, vel, angVel: spin || V(rnd(-4, 4), rnd(-4, 4), rnd(-4, 4)), ...this.opts(D),
    });
    return this.tag(it, type);
  }

  opts(D) {
    return {
      mass: D.mass, restitution: D.rest, friction: 0.7, sound: D.sound, kind: 'litter', cap: 300,
      offset: D.off || null, damping: D.damp ?? 0.05, angDamping: D.angDamp ?? 0.4, ccd: !D.tiny, inst: true,
    };
  }

  /**
   * One piece already lying at rest on the ground at p (no physics until the player comes
   * near): flat things flat, round things on their sides.
   */
  lay(type, p, g) {
    const D = LITTER[type];
    const mesh = D.build(), sh = D.shape(mesh), yaw = rnd(0, 6.28);
    if (D.tiny) mesh.traverse((m) => { m.castShadow = false; });
    let y;
    if (sh.box) { mesh.quaternion.setFromEuler(_e.set(0, yaw, 0)); y = sh.box[1]; }
    else if (sh.ball) { mesh.quaternion.setFromEuler(_e.set(rnd(0, 6.28), yaw, rnd(0, 6.28))); y = sh.ball; }
    else if (type === 'can' && Math.random() < 0.3) { mesh.quaternion.setFromEuler(_e.set(0, yaw, 0)); y = sh.cyl[0]; }
    else { mesh.quaternion.setFromEuler(_e.set(Math.PI / 2, yaw, 0, 'YXZ')); y = sh.cyl[1]; }
    mesh.position.set(p.x, g + y + 0.002, p.z);
    return this.tag(this.ctx.debris.addFrozen(mesh, sh, this.opts(D)), type);
  }

  /** Mark a debris piece as litter of `type`: pick-up-able, throwable. */
  tag(it, type, extra = {}) {
    const D = LITTER[type] || {};
    it.pick = { type, mass: it.mass ?? D.mass, r: D.r ?? 0.12, big: !!D.big, ...extra };
    if (D.smash) it.onImpact = (dv, piece) => { if (dv > D.smash) this.smash(piece); };
    return it;
  }

  /** Something breakable (a bottle) shattering where it is. */
  smash(it) {
    const t = it.body.translation(), lv = it.body.linvel();
    const at = V(t.x, t.y, t.z);
    this.ctx.debris.remove(it);
    this.land(it);
    this.ctx.sfx?.('bottle', 0.8);
    this.ctx.glass?.(at, V(lv.x, Math.abs(lv.y) * 0.3, lv.z).multiplyScalar(0.3), 18, it.mesh.children[0]?.material);
  }

  /** Scatter n pieces about, lying still on the ground: spot() gives a point, ground(p) its height. */
  scatter(spot, ground, n = 70) {
    for (let i = 0; i < n; i++) {
      const p = spot();
      if (!p) continue;
      const type = pick(MIX);
      // butts come in little clusters
      const k = type === 'butt' ? 3 + Math.floor(Math.random() * 4) : 1;
      // laid down at rest where it lies, asleep until something knocks into it
      for (let j = 0; j < k; j++) {
        const q = p.clone().add(V(rnd(-0.3, 0.3), 0, rnd(-0.3, 0.3)));
        this.lay(type, q, ground(q));
      }
    }
  }

  /** A burst of `types` from pos (a bin going over, a box bursting). */
  spill(pos, vel, types, n) {
    for (let i = 0; i < n; i++) {
      const p = pos.clone().add(V(rnd(-0.15, 0.15), rnd(0, 0.25), rnd(-0.15, 0.15)));
      this.make(pick(types), p, vel.clone().multiplyScalar(rnd(0.3, 0.8)).add(V(rnd(-1.2, 1.2), rnd(0.5, 2.2), rnd(-1.2, 1.2))));
    }
  }

  /** Launched by `by`: it hurts whoever it hits until it slows down. */
  thrown(it, by) {
    it.thrower = by;
    it.flyT = 0;
    it.hitSet = new Set([by]);
    it.flying = true;
    const t = it.body.translation();
    it.prevP = V(t.x, t.y, t.z);
    this.flying.add(it);
  }

  update(dt) {
    const { actors, props } = this.ctx;
    for (const it of this.flying) {
      if (!it.body) { this.land(it); continue; }
      it.flyT += dt;
      const t = it.body.translation(), lv = it.body.linvel();
      const p = V(t.x, t.y, t.z), vel = V(lv.x, lv.y, lv.z), sp = vel.length();
      if (sp < 3 || it.flyT > 3) { this.land(it); continue; }
      const r = clamp(it.pick.r * 0.6, 0.04, 0.2);
      const hit = sweep(it.prevP, it.prevP, p, p, r, actors, it.thrower, it.hitSet);
      if (hit) {
        it.hitSet.add(hit.actor);
        const m = it.pick.mass;
        // weight is what hurts: a brick to the head floors people, a can just annoys them
        hit.actor.struck(hit.part, hit.point, vel.clone(), hit.normal,
          { kind: 'blunt', mass: clamp(m * 1.6, 0.15, 6), sev: clamp(m * 0.38, 0.02, 1.1), ref: 10, maxImp: clamp(m * 30, 3, 80) }, it.thrower);
        this.ctx.sfx?.(m > 1 ? 'punch' : 'tick', clamp(m, 0.25, 0.9));
        // it bounces off them
        it.body.setLinvel({ x: -lv.x * 0.2, y: lv.y * 0.3 + 0.5, z: -lv.z * 0.2 }, true);
        if (it.onImpact) it.onImpact(99, it);
        this.land(it);
        continue;
      }
      // smashing into street furniture
      if (props?.strike(p, vel, it.pick.mass * sp * 0.6, it.thrower)) {
        it.body.setLinvel({ x: -lv.x * 0.25, y: lv.y * 0.3, z: -lv.z * 0.25 }, true);
        if (it.onImpact) it.onImpact(99, it);
        this.land(it);
        continue;
      }
      it.prevP.copy(p);
    }
  }

  land(it) { it.flying = false; this.flying.delete(it); }

  /**
   * Streaming (levels with pavements to litter): cells within SPAWN_R of the player get their
   * rubbish laid down (lying still, drawn instanced - debris.js brings it to life up close); past
   * GONE_R it's all swept away again, and the cell is littered afresh when you come back.
   * spotIn(x0, z0, x1, z1) -> a pavement point in that box or null; ground(p) -> its height.
   */
  stream(focus, spotIn, ground, all = false) {
    const S = this.cells ||= new Map();
    this.streamT = (this.streamT || 0) - 1;
    if (!all && this.streamT > 0) return;
    this.streamT = 8; // frames between passes
    const fx = focus.x, fz = focus.z;
    const n = Math.ceil(SPAWN_R / CELL) + 1, cx = Math.floor(fx / CELL), cz = Math.floor(fz / CELL);
    let budget = all ? 1e9 : 3;
    for (let i = cx - n; i <= cx + n && budget > 0; i++) {
      for (let j = cz - n; j <= cz + n && budget > 0; j++) {
        const k = i * 4096 + j;
        if (S.has(k)) continue;
        const x0 = i * CELL, z0 = j * CELL;
        if (Math.hypot(x0 + CELL / 2 - fx, z0 + CELL / 2 - fz) > SPAWN_R) continue;
        S.set(k, [x0 + CELL / 2, z0 + CELL / 2]);
        budget--;
        for (let s = 0; s < PER_CELL; s++) {
          const p = spotIn(x0, z0, x0 + CELL, z0 + CELL);
          if (!p) break;
          const type = pick(MIX);
          const c = type === 'butt' ? 3 + Math.floor(Math.random() * 4) : 1;
          for (let m = 0; m < c; m++) {
            const q = p.clone().add(V(rnd(-0.3, 0.3), 0, rnd(-0.3, 0.3)));
            this.lay(type, q, ground(q));
          }
        }
      }
    }
    // far away: forgotten
    const G2 = GONE_R * GONE_R;
    for (const [k, [x, z]] of S) if ((x - fx) ** 2 + (z - fz) ** 2 > G2) S.delete(k);
    const D = this.ctx.debris;
    for (let i = D.frozen.length - 1; i >= 0; i--) {
      const it = D.frozen[i], p = it.mesh.position;
      if (it.kind === 'litter' && (p.x - fx) ** 2 + (p.z - fz) ** 2 > G2) D.remove(it);
    }
  }

  clear() { for (const it of this.flying) it.flying = false; this.flying.clear(); this.cells?.clear(); }
}
