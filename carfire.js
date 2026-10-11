import * as THREE from 'three';
import { settings } from './settings.js';

/*
  Cars get wrecked: every hard hit (a sudden loss of speed well past a bump) does damage. A
  battered car smokes from under the bonnet; one damaged past repair starts a fuse - thick
  black smoke, then the engine catches, the fire grows, and about 30 s after it gave out it
  goes up (a frag-sized blast: nades.explode). What's left is a charred shell that won't drive,
  still burning for a while. A world reset puts it all back (restore).
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rnd = (a, b) => a + Math.random() * (b - a);

const HIT_DV = 6;          // speed lost (m/s) before a crash does any damage
const PER_DV = 9;          // damage per m/s past that
const SMOKY = 35;          // light smoke from here
const CRITICAL = 100;      // the fuse starts
const FIRE_AT = 12;        // s after critical: flames
const BOOM_AT = 30;        // s after critical: it goes up
const AFTERBURN = 25;      // s the wreck keeps burning

const FLAME0 = [1, 0.78, 0.35], FLAME1 = [0.85, 0.18, 0.02];
const GREY0 = [0.55, 0.55, 0.55], GREY1 = [0.7, 0.7, 0.7];
const BLACK0 = [0.06, 0.055, 0.05], BLACK1 = [0.22, 0.21, 0.2];
const DEAD_INPUT = Object.freeze({ throttle: 0, steer: 0, brake: 0, hand: false });

let CHAR = null;
const charMat = () => (CHAR ||= new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 0.95, metalness: 0.1 }));

export class CarDamage {
  /** ctx: { fx (the Throwables: particles, explode, vol), release(actor, vel), burn(actor) }. */
  constructor(ctx) {
    this.ctx = ctx;
    this._p = V(); this._d = V();
  }

  /** A crash on car `c` that lost `dv` m/s. */
  hit(c, dv) {
    if (c.dead || dv < HIT_DV) return;
    c.dmg = (c.dmg || 0) + (dv - HIT_DV) * PER_DV;
    if (c.dmg >= CRITICAL && c.fuseT == null) c.fuseT = 0;
  }

  /** The input a car actually drives with (a burnt-out one: none). */
  input(c) { return c.dead ? DEAD_INPUT : c.input; }

  /** A point on the car, in its own frame (+z forward, y up from the ground). */
  at(c, x, y, z, out = this._p) { return out.set(x, y, z).applyQuaternion(c.q).add(c.p); }

  update(dt, cars) {
    const fx = this.ctx.fx;
    this.cars = cars;
    let loud = 0;
    for (const c of cars) {
      const dmg = c.dmg || 0;
      if (dmg < SMOKY && !c.dead) continue;
      const hood = c.S.hl - 0.75;
      // flames: from FIRE_AT, growing to the blast; after it, the whole shell, dying away
      let fire = 0;
      if (c.dead) fire = Math.max(0, 1 - c.burnT / AFTERBURN);
      else if (c.fuseT != null) {
        c.fuseT += dt;
        if (c.fuseT >= FIRE_AT) fire = 0.25 + 0.75 * Math.min(1, (c.fuseT - FIRE_AT) / (BOOM_AT - FIRE_AT));
        if (c.fuseT >= BOOM_AT) { this.explode(c); continue; }
      }
      if (c.dead) c.burnT += dt;
      if (!c.remote && fire > 0) this.scorchSeats(c, dt);
      loud = Math.max(loud, fx.vol(c.p, 0.9 * fire));
      if (!settings.fx) continue;
      // smoke: grey wisps when it's knocked about, black and thick once it's dying
      const heavy = c.fuseT != null || c.dead;
      const rate = heavy ? 14 + fire * 10 : 3 + (dmg - SMOKY) / (CRITICAL - SMOKY) * 6;
      for (let n = poisson(rate * dt); n > 0; n--) {
        const p = this.at(c, rnd(-0.4, 0.4), 0.95, c.dead ? rnd(-1, 1.2) : hood + rnd(-0.3, 0.3)).clone();
        fx.smoke.emit({ p, v: V(rnd(-0.3, 0.3), rnd(0.8, 1.6), rnd(-0.3, 0.3)), life: rnd(2, heavy ? 4.5 : 3),
          s0: heavy ? 0.5 : 0.3, s1: heavy ? rnd(2.4, 3.4) : 1.6, c0: heavy ? BLACK0 : GREY0, c1: heavy ? BLACK1 : GREY1,
          a0: heavy ? 0.6 : 0.3, a1: 0, drag: 0.8, rise: 0.6 });
      }
      for (let n = poisson(fire * 70 * dt); n > 0; n--) {
        const spread = c.dead ? 1 : 0.3 + fire * 0.5;
        const p = this.at(c, rnd(-0.65, 0.65) * spread, 0.85 + rnd(0, 0.2), c.dead ? rnd(-1.6, 1.6) : hood + rnd(-0.5, 0.5) * spread).clone();
        fx.fire.emit({ p, v: V(rnd(-0.3, 0.3), rnd(0.6, 1.6), rnd(-0.3, 0.3)), life: rnd(0.35, 0.8),
          s0: rnd(0.35, 0.7) * (0.6 + fire * 0.6), s1: 0.08, c0: FLAME0, c1: FLAME1, a0: 0.9, a1: 0, drag: 1.5, rise: 2.5 });
      }
    }
    fx.carLoud = loud;
  }

  /** Sitting in a car that's on fire: you catch too. */
  scorchSeats(c, dt) {
    for (const s of c.seats) if (s.occ && !s.occ.remote && Math.random() < dt * 0.4) this.ctx.burn?.(s.occ);
  }

  explode(c) {
    const { fx, release, burn } = this.ctx;
    c.fuseT = null;
    c.dead = true;
    c.burnT = 0;
    // whoever's still inside comes out with it
    for (const s of c.seats) {
      const a = s.occ;
      if (!a || a.remote) continue;
      const v = V(rnd(-3, 3), rnd(5, 7), rnd(-3, 3)).add(c.v);
      release(a, v);
      burn?.(a);
    }
    const centre = this.at(c, 0, 0.7, 0).clone();
    if (!c.remote) {
      fx.explode(centre, null, true);
      // the car jumps
      const b = c.body;
      b.wakeUp();
      const m = b.mass();
      b.applyImpulse({ x: rnd(-0.3, 0.3) * m, y: 5.5 * m, z: rnd(-0.3, 0.3) * m }, true);
      b.applyTorqueImpulse({ x: rnd(-1, 1) * 2 * m, y: rnd(-1, 1) * 0.7 * m, z: rnd(-1, 1) * 2 * m }, true);
    } else fx.explode(centre, null, false);
    // the people close by catch alight
    for (const A of fx.ctx.actors) if (!A.remote && A.hero.pos.distanceTo(centre) < 3.2) burn?.(A);
    // cars parked alongside take a beating (enough, close up, to set them going too)
    for (const o of this.cars || []) {
      if (o === c || o.dead || o.remote) continue;
      const d = o.p.distanceTo(c.p);
      if (d < 6) this.hit(o, HIT_DV + (1 - d / 6) * 10);
    }
    this.char(c);
    c.m.windshield.visible = false;
  }

  /** Charred: every painted / trimmed surface black (put back by restore). */
  char(c) {
    if (c._mats) return;
    c._mats = new Map();
    c.m.root.traverse((o) => {
      if (!o.isMesh || o.material?.transparent) return;
      c._mats.set(o, o.material);
      o.material = charMat();
    });
  }

  /** As good as new (a world reset). */
  restore(c) {
    c.dmg = 0; c.fuseT = null; c.dead = false; c.burnT = 0;
    if (c._mats) { for (const [o, m] of c._mats) o.material = m; c._mats = null; }
  }
}

function poisson(mean) {
  // (a whole number of particles per frame whose average is `mean`)
  let n = Math.floor(mean);
  if (Math.random() < mean - n) n++;
  return n;
}
