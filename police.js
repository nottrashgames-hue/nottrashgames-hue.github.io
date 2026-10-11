import * as THREE from 'three';

/*
  The police force: real officers who are always about. Some keep their posts in the station
  (the desk, the door, the back office), some walk the pavements, one drives the patrol car.
  Any attack a cop sees, they step in. When no cop is around, somebody who saw it gets their
  phone out and calls it in: the patrol car comes with its lights going and the nearest officer
  runs over to the caller, who points out where the trouble went.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const flat = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
const yawTo = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export const UNIFORM = { top: 0x1f2d4d, shorts: 0x161b26, shoe: 0x111111 };
const SIGHT = 30;   // m: how far a cop notices trouble
const CALL = { away: 3, talk: 4.5, wait: 45 };

const LINES = {
  call: ['Police? Someone\'s attacking people!', 'Hello, police? There\'s a fight!', 'Yes, police, come quick!', '911? Somebody just got hurt!'],
  stop: ['Police! Stop right there!', 'Hey! Break it up!', 'Police! Hands where I can see them!', 'That\'s enough!'],
  arrive: ['Police. Who called?', 'What happened here?', 'Alright, where are they?'],
  point: ['They went that way!', 'Over there!', 'That\'s them!'],
  clear: ['Nobody here now.', 'Looks clear.', 'Keep an eye out.'],
};

let CAP = null, PHONE = null;
export function capMesh() {
  if (!CAP) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x141c2e, roughness: 0.6 });
    const badge = new THREE.MeshStandardMaterial({ color: 0xd9b440, roughness: 0.3, metalness: 0.6 });
    CAP = { crown: new THREE.CylinderGeometry(0.1, 0.092, 0.07, 20), brim: new THREE.BoxGeometry(0.17, 0.012, 0.09), badge: new THREE.BoxGeometry(0.03, 0.03, 0.005), mat, badgeMat: badge };
  }
  const g = new THREE.Group();
  const crown = new THREE.Mesh(CAP.crown, CAP.mat);
  const brim = new THREE.Mesh(CAP.brim, CAP.mat);
  brim.position.set(0, -0.03, 0.1);
  brim.rotation.x = 0.15;
  const badge = new THREE.Mesh(CAP.badge, CAP.badgeMat);
  badge.position.set(0, 0.0, 0.097);
  g.add(crown, brim, badge);
  g.position.set(0, 0.19, 0.0);
  g.rotation.x = -0.12;
  for (const m of g.children) m.castShadow = true;
  return g;
}
function phoneMesh() {
  PHONE ||= { geo: new THREE.BoxGeometry(0.018, 0.14, 0.07), mat: new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.35, metalness: 0.3 }) };
  const m = new THREE.Mesh(PHONE.geo, PHONE.mat);
  m.position.set(0, -0.02, 0.03);
  return m;
}

/** A uniformed look over a random person. */
export function copLook(look) {
  return { ...look, ...UNIFORM, legs: 'long', sleeves: 'short', hairStyle: look.hairStyle === 'long' ? 'bun' : look.hairStyle };
}

export class Police {
  /**
   * W = { hero, npcs, vehicles, traffic, bubbles, now(), wanted, colliders }
   * roster: [{ npc, beat: 'post' | 'patrol' | 'driver', post? }], car: the patrol car
   */
  constructor(W, roster, car) {
    this.W = W;
    this.roster = roster;
    this.cops = roster.map((r) => r.npc);
    this.car = car;
    this.driver = roster.find((r) => r.beat === 'driver')?.npc || null;
    this.calls = [];
    this.scanT = 1;
    for (const r of roster) {
      const n = r.npc, st = n.street;
      n.cop = true; n.beat = r.beat; n.post = r.post || null;
      st.cop = true;
      Object.assign(st.P, { tough: 1, temper: 0.9, crook: false, weapon: 'bat', mouth: 0.1 });
      st.crimeT = Infinity;
      st.kit = st.makeKit();
      st.kits = { bat: st.kit };
      n.cap = capMesh();
      n.actor.hero.head.add(n.cap);
    }
  }

  // ---------------------------------------------------------------- who's around
  /** Can this officer drop what they're doing and respond? */
  free(n) {
    const A = n.actor, st = n.street;
    return !A.remote && !A.brain.dead && A.mode === 'anim' && !(A.organs?.weak > 0.5) && !st.mode && !n.chasing;
  }
  /** The nearest officer who can see `at` (and could respond). */
  seer(at, range = SIGHT, busyOk = false) {
    let best = null, bd = range;
    for (const n of this.cops) {
      if (n.actor.seat || !(busyOk ? !n.actor.brain.dead && n.actor.mode === 'anim' : this.free(n))) continue;
      const d = flat(n.actor.hero.pos, at);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  say(A, kind, tone = 'say') {
    this.W.bubbles.say(A, pick(LINES[kind]), { tone });
  }
  /** Go after whoever's doing it. */
  engage(n, T) {
    if (!T || T.brain.dead || n.street.mode === 'fight' && n.street.target === T) return;
    n.duty = null;
    n.street.startFight(T);
    this.say(n.actor, 'stop', 'angry');
  }

  // ---------------------------------------------------------------- calling it in
  /** Something happened to `victim` by `suspect` at `at` that nobody in uniform saw. */
  report(suspect, at, victim) {
    if (this.calls.length >= 2 || this.calls.some((c) => c.suspect === suspect)) return;
    const W = this.W;
    const ok = (n) => {
      const A = n.actor;
      return !n.cop && n.street && !A.remote && !A.brain.dead && A.mode === 'anim' && !A.seat &&
        n.actor !== suspect && !n.street.mode && !n.convo && !this.calls.some((c) => c.caller === n);
    };
    let caller = null, bd = 25;
    for (const n of W.npcs) {
      if (!ok(n)) continue;
      const d = flat(n.actor.hero.pos, at) + (n === victim ? -6 : 0) + Math.random() * 4;
      if (d < bd) { bd = d; caller = n; }
    }
    if (!caller) return;
    caller.abort();
    this.calls.push({ caller, suspect, at: at.clone(), t: 0, phase: 'away', said: false, phone: null, cops: [] });
  }

  endCall(c) {
    const i = this.calls.indexOf(c);
    if (i >= 0) this.calls.splice(i, 1);
    if (c.phone) { c.phone.removeFromParent(); c.phone = null; }
    const g = c.caller.gest;
    if (g.one === 'phone') g.one = null;
    for (const n of this.cops) if (n.duty?.call === c) n.duty = null;
  }

  /** The call goes through: the car and the nearest officer on foot head to the caller. */
  dispatch(c) {
    const W = this.W, at = c.caller.actor.hero.pos;
    if (c.suspect === W.hero) W.wanted?.reported();
    const onFoot = this.cops.filter((n) => n !== this.driver && this.free(n) && !n.actor.seat && (n.beat !== 'post' || flat(n.actor.hero.pos, at) < 50))
      .sort((a, b) => flat(a.actor.hero.pos, at) - flat(b.actor.hero.pos, at));
    const go = onFoot.slice(0, 1);
    const d = this.driver;
    if (d && !d.actor.brain.dead && !d.street.mode && !d.chasing) go.push(d);
    for (const n of go) { n.duty = { call: c, t: 0, phase: 'go' }; c.cops.push(n); }
  }

  /** The caller: get clear, phone it in, then wait for the police to turn up. */
  caller(c, st, dt, colliders) {
    const n = c.caller, A = n.actor, h = A.hero, S = c.suspect;
    c.t += dt;
    const sp = S.seat ? S.seat.car.p : S.hero.pos;
    const ds = flat(h.pos, sp);
    if (c.phase === 'away') {
      if (ds > 12 || c.t > CALL.away) { c.phase = 'phone'; c.t = 0; }
      else {
        const away = V(h.pos.x * 2 - sp.x, 0, h.pos.z * 2 - sp.z);
        return st.ctrl(st.goTo(away, 0, colliders, 1), yawTo(sp, h.pos), true);
      }
    }
    if (c.phase === 'phone') {
      if (!c.phone) { c.phone = phoneMesh(); h.arms[1].hand.add(c.phone); }
      n.gest.play('phone', 99);
      if (!c.said && c.t > 0.8) { c.said = true; this.W.bubbles.say(A, pick(LINES.call), { tone: 'scared', dur: 3.2 }); }
      if (c.t > CALL.talk) {
        c.phone.removeFromParent(); c.phone = null;
        n.gest.one = null;
        c.phase = 'wait'; c.t = 0;
        this.dispatch(c);
      }
      return st.ctrl(n.move.set(0, 0, 0), yawTo(h.pos, sp));
    }
    // waiting: keep well back if the trouble comes this way
    if (ds < 6 && !S.brain.dead) { this.endCall(c); n.fearT = rnd(5, 8); n.fleeFrom = sp.clone(); return null; }
    if (c.t > CALL.wait || !c.cops.length) { this.endCall(c); return null; }
    const cop = c.cops.map((k) => k.actor).find((k) => !k.seat && flat(k.hero.pos, h.pos) < 6);
    return st.ctrl(n.move.set(0, 0, 0), cop ? yawTo(h.pos, cop.hero.pos) : h.yaw);
  }

  // ---------------------------------------------------------------- on duty
  /** Called from Street.control for everyone not already fighting: null lets ordinary life go on. */
  control(st, dt, colliders) {
    const n = st.npc, A = st.A;
    if (A.mode !== 'anim' || A.seat) return null;
    if (!n.cop) {
      const c = this.calls.find((k) => k.caller === n);
      return c ? this.caller(c, st, dt, colliders) : null;
    }
    n.chatCool = n.beat === 'post' ? Infinity : n.chatCool;
    const h = A.hero;
    if (n.duty) {
      const D = n.duty, c = D.call, C = c.caller.actor;
      D.t += dt;
      if (D.t > 70 || !this.calls.includes(c) && D.phase === 'go') { n.duty = null; return null; }
      if (D.phase === 'go') {
        const d = flat(h.pos, C.hero.pos);
        if (d > 2.6) return st.ctrl(st.goTo(C.hero.pos, 2.2, colliders, 1), yawTo(h.pos, C.hero.pos), d > 5);
        D.phase = 'scene'; D.t2 = 0;
        this.say(A, 'arrive');
        const S = c.suspect;
        const near = !S.brain.dead && flat(S.seat ? S.seat.car.p : S.hero.pos, C.hero.pos) < 40;
        setTimeout(() => {
          if (C.brain.dead || C.mode !== 'anim') return;
          this.W.bubbles.say(C, pick(near ? LINES.point : ['They ran off...', 'They\'re gone now.']), { tone: 'scared' });
          c.caller.gest.play('point');
        }, 900);
        D.near = near;
      }
      // at the scene: hear them out, then go after the suspect if they're still around
      D.t2 += dt;
      const S = c.suspect;
      if (D.t2 > 2.2) {
        this.endCall(c);
        if (D.near && !S.brain.dead && (S !== this.W.hero || this.W.wanted?.stars > 0)) this.engage(n, S);
        else { this.say(A, 'clear'); n.duty = null; }
        return null;
      }
      return st.ctrl(n.move.set(0, 0, 0), yawTo(h.pos, C.hero.pos));
    }
    // the driver, out of the car with nothing to do: back to it
    if (n === this.driver && this.carUsable()) {
      const car = this.car, side = V(-car.fwd.z, 0, car.fwd.x).multiplyScalar(-1.3).add(car.p);
      const d = flat(h.pos, side);
      if (d < 1.6) { this.W.vehicles.enter(A, car, 0); A.postSnap = null; this.W.traffic?.attachHere(car); return null; }
      return st.ctrl(st.goTo(side, 0, colliders, 1), yawTo(h.pos, side), d > 12);
    }
    // back to their post
    if (n.post) {
      const P = n.post, d = flat(h.pos, P.pos);
      if (d > 0.35) {
        n.backT = (n.backT || 0) + dt;
        if (n.backT > 60 && flat(h.pos, this.W.hero.hero.pos) > 40) { n.backT = 0; n.reset(); return null; }
        return st.ctrl(st.goTo(P.pos, 0.2, colliders, d > 3 ? 1 : 0.5), yawTo(h.pos, P.pos), d > 10);
      }
      n.backT = 0;
      return st.ctrl(n.move.set(0, 0, 0), P.yaw);
    }
    return null;
  }

  carUsable() {
    const car = this.car, d = this.driver;
    if (!car || !d || d.actor.seat) return false;
    const up = V(0, 1, 0).applyQuaternion(car.q).y;
    return !car.driver && up > 0.7 && flat(car.p, d.actor.hero.pos) < 80 && !d.chasing && !d.street.mode;
  }

  /** Heard shots: a cop doesn't run, they go and deal with it. */
  shots(n, shooter) {
    if (!shooter || shooter === n.actor || shooter.npc?.cop || shooter === this.W.hero) return;
    if (this.free(n) && flat(shooter.hero.pos, n.actor.hero.pos) < 40) this.engage(n, shooter);
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const W = this.W;
    // somebody on the phone got knocked down or hurt: the call's dropped
    for (const c of [...this.calls]) {
      const A = c.caller.actor;
      if (A.brain.dead || A.mode !== 'anim' && c.phase !== 'wait') this.endCall(c);
    }
    this.drive(dt);
    this.scanT -= dt;
    if (this.scanT > 0) return;
    this.scanT = 0.4;
    // trouble on the street between other people: step in if there's a cop to see it
    for (const n of W.npcs) {
      const st = n.street, A = n.actor;
      if (n.cop || !st || A.remote || A.brain.dead || A.mode !== 'anim') continue;
      if (st.mode !== 'fight' && st.mode !== 'mug' && st.mode !== 'vandal') continue;
      if (st.mode === 'fight' && st.target?.npc?.cop) continue; // fighting a cop already: they'll handle it
      if (this.cops.some((k) => k.street.mode === 'fight' && k.street.target === A)) continue;
      const cop = this.seer(A.hero.pos);
      if (cop) this.engage(cop, A);
      else if (st.mode !== 'fight' || st.target !== W.hero) this.report(A, A.hero.pos, st.target?.npc || null);
    }
  }

  /** The patrol car: out on its rounds, or lights on to a call or a chase. */
  drive(dt) {
    const car = this.car, d = this.driver, W = this.W;
    if (!car) return;
    // the player took it
    if (car.driver === W.hero && !this.stolen) { this.stolen = true; W.wanted?.crime('jack', null, true); }
    if (car.driver !== W.hero) this.stolen = false;
    if (!d || d.actor.seat?.car !== car) { if (!car.driver) car.siren = false; return; }
    const goal = d.duty ? d.duty.call.caller.actor.hero.pos
      : d.chasing ? (W.hero.seat ? W.hero.seat.car.p : W.hero.hero.pos) : null;
    car.siren = !!goal;
    if (!goal) {
      if (car.ai) car.ai.goal = null;
      else if (!W.traffic?.attachHere(car)) W.vehicles.exit(d.actor);
      return;
    }
    const dist = flat(car.p, goal);
    if (dist > 16 && car.ai) { car.ai.goal = { x: goal.x, z: goal.z }; return; }
    if (dist > 16 && !car.ai && !car.parkT && W.traffic?.attachHere(car)) return;
    // there: pull up and get out
    car.ai = null;
    const I = car.input;
    I.throttle = 0; I.brake = 1; I.steer = 0;
    car.parkT = (car.parkT || 0) + dt;
    if (Math.abs(car.fspeed) < 1 || car.parkT > 3) {
      car.parkT = 0;
      W.vehicles.exit(d.actor);
      if (d.chasing) d.street.startFight(W.hero);
    }
  }

  /** World reset: everyone back on their beat, the car at the kerb out front. */
  reset() {
    for (const c of [...this.calls]) this.endCall(c);
    for (const n of this.cops) { n.duty = null; n.chasing = false; n.backT = 0; }
    const car = this.car, d = this.driver;
    if (car && d) {
      if (d.actor.seat) this.W.vehicles.exit(d.actor);
      car.reset();
      car.ai = null;
      car.siren = false;
      this.W.vehicles.enter(d.actor, car, 0);
      d.actor.postSnap = null;
    }
  }
}
