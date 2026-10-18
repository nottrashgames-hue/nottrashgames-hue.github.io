import * as THREE from 'three';
import { sweep, parry } from './strike.js';
import { parriedBlow } from './melee.js';
import { inkOf } from './inks.js';

/*
  Kicks (X): the leg motion lives in the character (startKick); this sweeps the foot while it's
  live and lands the blow - on people, on street furniture, and on whatever's lying about (kick
  a can down the street). Which kick: a stamp when someone's lying at your feet, a low kick from
  a crouch, else a push kick at the belly.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const HIT = {
  front: { kind: 'blunt', mass: 11, sev: 0.75, ref: 8, maxImp: 105, dent: 0.2 },
  low: { kind: 'blunt', mass: 8, sev: 0.6, ref: 7, maxImp: 70, dent: 0.2 },
  stomp: { kind: 'blunt', mass: 14, sev: 1.1, ref: 7, maxImp: 95, dent: 0.8 },
};
// how hard each one lands on the screen (hit-stop, camera), and how long the foot stays in them
const FEEL = { front: [0.17, 0.08], low: [0.12, 0.06], stomp: [0.22, 0.1] };

export class Kick {
  /** ctx: { actors, sfx, hitWorld(point, vel, dmg, by) } */
  constructor(actor, ctx) {
    this.actor = actor;
    this.ctx = ctx;
    this.prev = null;
    this.hit = new Set();
    this.world = false;
    this.next = 1;
  }
  get busy() { return !!this.actor.hero.kick; }

  /** Pick the kick for the situation and start it. */
  start(kind = null) {
    const A = this.actor, h = A.hero;
    if (A.mode !== 'anim' || h.action || A.seat || h.kick) return false;
    if (!kind) {
      kind = (h.cF || 0) > 0.5 ? 'low' : 'front';
      // someone down right in front of us: stamp on them
      const f = h.forward(V());
      for (const o of this.ctx.actors) {
        // (someone else's body, down on their screen: a multiplayer puppet)
        if (o === A || (o.mode !== 'ragdoll' && !o.net?.down)) continue;
        const c = o.mode === 'ragdoll' ? o.rd.pos('chest', V()) : o.groups.chest.getWorldPosition(V());
        const d = c.clone().sub(h.pos); d.y = 0;
        const dist = d.length();
        if (dist < 0.95 && dist > 0.15 && d.dot(f) > dist * 0.5 && c.y - h.pos.y < 0.45) { kind = 'stomp'; break; }
      }
    }
    // the stronger (right) leg, mostly
    const leg = Math.random() < 0.8 ? 1 : 0;
    if (!h.startKick(kind, leg)) return false;
    this.kind = kind;
    this.hit.clear();
    this.world = false;
    this.prev = null;
    this.whoosh = false;
    this.parried = false;
    return true;
  }

  /** After the character's update: sweep the foot. */
  update(dt) {
    const h = this.actor.hero, k = h.kick;
    if (!k) { this.prev = null; return; }
    if (!h.kickLive) { this.prev = null; return; }
    const l = h.legs[k.leg];
    l.foot.updateWorldMatrix(true, false);
    const heel = V(0, -0.02, -0.04).applyMatrix4(l.foot.matrixWorld);
    const toe = V(0, -0.02, 0.17).applyMatrix4(l.foot.matrixWorld);
    if (!this.whoosh) { this.whoosh = true; this.ctx.sfx?.('whoosh', 0.35); }
    if (this.prev && dt > 0) {
      const vel = toe.clone().sub(this.prev[1]).divideScalar(dt).clampLength(0, 16);
      // (a push kick keeps shoving through the hold at the end)
      if (vel.length() < 1.2 && this.kind !== 'stomp') vel.copy(h.forward(V())).multiplyScalar(3);
      // (a stomp: the body's weight straight down through them, pinning them to the floor)
      if (this.kind === 'stomp') vel.set(vel.x * 0.2, Math.min(vel.y, -7), vel.z * 0.2);
      let hit = this.parried ? null : sweep(this.prev[0], this.prev[1], heel, toe, 0.07, this.ctx.actors, this.actor, this.hit);
      // a weapon (or a gun) held in the way: the foot stops on it
      const pr = this.parried ? null : parry(this.prev[0], this.prev[1], heel, toe, 0.06, this.actor, hit ? hit.k : 1);
      if (pr) {
        this.parried = true;
        hit = null;
        parriedBlow(pr, vel, this.actor, 0.8, this.ctx.sfx);
        this.ctx.impact?.(0.08, this.actor, pr.owner);
        k.stop = 0.06;
      }
      if (hit) {
        this.hit.add(hit.actor);
        const push = vel.clone();
        if (this.kind === 'front') push.addScaledVector(h.forward(V()), 6).setY(Math.max(push.y, 0.5));
        const head = hit.part === 'head' || hit.part === 'neck';
        hit.actor.struck(hit.part, hit.point, push, hit.normal, HIT[this.kind], this.actor);
        const [amt, hold] = FEEL[this.kind];
        const stomp = this.kind === 'stomp';
        this.ctx.sfx?.('kick', 1, { rate: stomp ? 0.8 : 0.95 + Math.random() * 0.1 });
        this.ctx.sfx?.('punch', 0.75, { rate: stomp ? 0.62 : 0.8 });
        this.ctx.sfx?.('impact', stomp ? 0.7 : 0.45, { rate: 0.5 });
        this.ctx.impact?.(amt * (head ? 1.25 : 1), this.actor, hit.actor);
        k.stop = hold;
        // a stomp to the head of someone already bleeding: it splashes
        if (stomp && this.ctx.blood && (hit.actor.wounds?.parts[hit.part]?.wet || 0) > 0.2) {
          this.ctx.blood.inked(hit.actor).spray(hit.point, V(0, 1, 0), 1.2, 5, 0.5, 0.8);
        }
      }
      if (!this.world && this.ctx.hitWorld?.(toe, vel.clone().addScaledVector(h.forward(V()), 3), this.kind === 'stomp' ? 10 : 16, this.actor)) {
        this.world = true;
        this.ctx.sfx?.('kick', 0.6);
      }
    }
    this.prev = [heel, toe];
  }
}
