import * as THREE from 'three';

/*
  The dead (survival.js on the tower, or out of the spawn menu anywhere): what one looks like,
  and how one goes about it. A zombie is an ordinary Npc + Street with zombie set; its body
  is undead (organs.js: no pain or shock, only the brain, the spine, the legs or bleeding
  nearly dry stop it). ZombieBrain replaces the street fighting:
    chase  - a shambling, lurching walk at whoever's nearest and alive, arms out, clawing
    lunge  - close enough: a lurch forward, grabbing
    latch  - got hold: hangs off them (they can barely move), biting - the neck, the
             shoulders, the arms - until it's knocked off (any hit that floors it) or shaken
             loose after a while
    feed   - they're down: crouched over them, biting
  Bites go through Actor.struck (kind 'bite'), so someone else's body is bitten on its
  owner's machine like any other blow.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const flat = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
const yawTo = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const _p = V(), _n = V();

/** A zombie's look, over an ordinary random one (makeLook()). */
export function zombieLook(L) {
  const dull = (c, k) => new THREE.Color(c).lerp(new THREE.Color(0x3a3a30), k).getHex();
  return Object.assign(L, {
    skin: new THREE.Color().setHSL(0.2 + Math.random() * 0.08, 0.14 + Math.random() * 0.12, 0.4 + Math.random() * 0.1).getHex(),
    top: dull(L.top, 0.55), shorts: dull(L.shorts, 0.5), shoe: dull(L.shoe, 0.4),
    legs: 'long', beard: null, blood: 'rotten', costume: 'zombie',
  });
}

/** Make this Npc (its Street already attached) one of the dead. */
export function makeZombie(npc) {
  npc.zombie = true;
  npc.hear = () => {};
  npc.chatCool = Infinity;
  const st = npc.street;
  Object.assign(st.P, { tough: 1, temper: 1, crook: false, weapon: null, mouth: 0 });
  st.zombie = true;
  st.crimeT = Infinity;
  st.zb = new ZombieBrain(npc);
  npc.gest.play('zombie');
}

export class ZombieBrain {
  constructor(npc) {
    this.npc = npc;
    this.st = npc.street;
    this.A = npc.actor;
    this.state = 'chase';
    this.t = 0;
    this.cool = 0;
    this.biteT = 0;
    this.lookT = 0;
    this.T = null;
    this.gait = Math.random() * 10;
  }

  /** Whoever it's after: survival.js picks for it; otherwise the nearest living soul. */
  pickTarget() {
    const st = this.st, A = this.A, all = st.W.actors?.() || [];
    let best = null, bd = 25;
    for (const a of all) {
      if (a === A || a.brain.dead || a.npc?.zombie || a.seat) continue;
      const d = flat(A.hero.pos, a.hero.pos) + (a.mode === 'ragdoll' ? 4 : 0);
      if (d < bd) { bd = d; best = a; }
    }
    if (best && best !== st.target) st.startFight(best);
  }

  set(state) { this.state = state; this.t = 0; }

  /** The controls for this frame (the host's / whoever simulates it), or null. */
  control(dt, colliders) {
    const A = this.A, h = A.hero, st = this.st, npc = this.npc, G = npc.gest;
    if (A.organs && !A.organs.undead) A.organs.undead = true;
    this.t += dt; this.cool -= dt; this.gait += dt;
    // (on its own - the spawn menu - it finds someone for itself)
    if (!npc.survival && (this.lookT -= dt) <= 0) { this.lookT = 1; if (!st.target || st.target.brain.dead) this.pickTarget(); }
    const T = st.mode === 'fight' ? st.target : null;
    if (T !== this.T) { this.T = T; this.set('chase'); }
    if (A.mode !== 'anim' || A.seat) { if (this.state !== 'chase') this.set('chase'); return null; }
    if (G.one !== 'zombie' && G.one !== 'feed') G.play('zombie');
    if (!T || T.brain.dead && this.state !== 'feed') { G.zReach = 0; return this.idle(dt); }
    const tp = T.seat ? T.seat.car.p : T.hero.pos;
    const dist = flat(h.pos, tp), face = yawTo(h.pos, tp);
    const down = T.mode === 'ragdoll';

    if (this.state === 'feed') return this.feed(dt, T, colliders);
    if (down && !T.seat) { this.set('feed'); return this.feed(dt, T, colliders); }

    if (this.state === 'latch') {
      // hanging off them: pulled along, facing into them, biting
      if (T.seat || dist > 1.2 || this.t > this.holdFor) { this.cool = rnd(1.2, 2.2); this.set('chase'); }
      else {
        G.zReach = 1;
        _p.set(tp.x - h.pos.x, 0, tp.z - h.pos.z);
        const d = _p.length();
        const mv = npc.move.copy(_p).multiplyScalar(d > 0.5 ? clamp((d - 0.5) * 4, 0, 1) / Math.max(d, 1e-3) : 0);
        if ((this.biteT -= dt) <= 0) { this.biteT = rnd(1.1, 1.7); this.bite(T, false); }
        return this.ctrl(mv, face, false, false, 1);
      }
    }
    if (this.state === 'lunge') {
      G.zReach = 1;
      const mv = npc.move.set(Math.sin(face), 0, Math.cos(face));
      if (this.t > 0.32) {
        if (dist < 0.8 && !T.seat) {
          this.set('latch');
          this.holdFor = rnd(4, 8);
          this.biteT = rnd(0.35, 0.6);
          T.heldT = Math.max(T.heldT || 0, 0.8);
        } else { this.cool = rnd(0.8, 1.4); this.set('chase'); }
      }
      return this.ctrl(mv, face, false, false, 1.15);
    }
    // chase: shamble at them, reaching as they get close
    G.zReach = clamp(1.4 - dist / 2.2, 0, 1);
    const mv = st.goTo(tp, 0.55, colliders, 1);
    if (dist < 0.95 && this.cool <= 0 && !T.seat && Math.abs(wrap(face - h.yaw)) < 0.7) { this.set('lunge'); npc.move.set(0, 0, 0); }
    return this.ctrl(mv, face, dist > 3 && st.zRun, false, st.zSpeed ?? 0.6);
  }

  /** Nobody to go for: stand swaying, wandering a step now and then. */
  idle(dt) {
    const h = this.A.hero;
    return this.ctrl(this.npc.move.set(0, 0, 0), h.yaw + Math.sin(this.gait * 0.4) * 0.3, false, false, 0);
  }

  /** Down on them: crouched over the chest, biting into them. */
  feed(dt, T, colliders) {
    const A = this.A, h = A.hero, G = this.npc.gest;
    if (T.mode !== 'ragdoll' && !T.brain.dead) { G.play('zombie'); this.set('chase'); return null; }
    const chest = T.rd?.pos ? T.rd.pos('chest', _p) : T.hero.pos;
    const d = flat(h.pos, chest);
    const mv = this.st.goTo(chest, 0.45, colliders, 0.6);
    const close = d < 0.8;
    if (close && G.one !== 'feed') G.play('feed');
    if (!close && G.one !== 'zombie') G.play('zombie');
    if (close && (this.biteT -= dt) <= 0) { this.biteT = rnd(1.4, 2.2); this.bite(T, true); }
    return this.ctrl(mv, yawTo(h.pos, chest), false, close, 0.7);
  }

  /** Teeth in: somewhere it can reach (the throat and shoulders standing, anywhere lying). */
  bite(T, down) {
    const A = this.A, h = A.hero;
    const r = Math.random();
    const part = down
      ? (r < 0.3 ? 'chest' : r < 0.5 ? 'head' : r < 0.75 ? (Math.random() < 0.5 ? 'upperL' : 'upperR') : (Math.random() < 0.5 ? 'foreL' : 'foreR'))
      : (r < 0.4 ? 'head' : r < 0.75 ? (Math.random() < 0.5 ? 'upperL' : 'upperR') : (Math.random() < 0.5 ? 'foreL' : 'foreR'));
    const G = T.groups?.[part] || T.hero?.[part === 'head' ? 'head' : 'chest'];
    if (!G) return;
    G.updateWorldMatrix(true, false);
    const c = G.getWorldPosition(V());
    // the side facing us, a little under the jaw for the throat
    h.head.updateWorldMatrix(true, false);
    const mouth = h.head.getWorldPosition(V());
    _n.subVectors(c, mouth).normalize();
    const point = c.clone().addScaledVector(_n, -0.06);
    if (part === 'head') point.y -= 0.06;
    T.struck(part, point, _n.clone().multiplyScalar(2), _n.clone(), { kind: 'bite', mass: 1, sev: rnd(0.8, 1.25), ref: 2, maxImp: 10 }, A);
    const sfx = this.st.W.sfx;
    sfx?.('flesh', 0.9, { rate: rnd(0.8, 1) });
    sfx?.('splat', 0.5, { rate: rnd(0.9, 1.1) });
    if (Math.random() < 0.5) sfx?.('groan', 0.55, { vary: 0.15 });
    // (a head-toss into it)
    this.npc.gest.nodV -= 4;
  }

  ctrl(move, face, run, crouch, speed) {
    // a lurching, uneven step: each stride dragged
    const lurch = 0.62 + 0.38 * Math.abs(Math.sin(this.gait * 2.6));
    move.multiplyScalar(speed * (speed < 1.1 ? lurch : 1));
    return { move, run: !!run, jump: false, crouch: !!crouch, camYaw: face - Math.PI, faceYaw: face };
  }
}
