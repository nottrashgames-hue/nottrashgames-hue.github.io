import * as THREE from 'three';
import { findThreat } from './brain.js';
import { Posture, Gestures } from './life.js';

/*
  Pedestrians: the same Actor as the player, driven by a tiny wander brain instead of the
  keyboard. Bumping into people (or crashing into them while ragdolling) knocks them into
  the physical stumble/fall behaviours, GTA IV style.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rnd = (a, b) => a + Math.random() * (b - a);

/*
  Social life. An NPC is always doing one thing (this.act):
    walk   - stroll to a spot near home
    idle   - stand about, glancing at things and people
    seat   - walk to a free seat and sit a while
    ground - sit down on the floor;  lie - lie down on the back
    chat   - a conversation (Convo) with someone: meet up, face each other, take turns talking
  Getting knocked over, shot at or hearing gunfire drops whatever they were doing.
*/
export const convos = [];
const HEAD = (a, out) => a.hero.head.getWorldPosition(out);
// an emote seen -> [the answer, how likely, for how long (s) min, max]
const REPLY = {
  wave: ['wave', 0.6, 1.6, 1.6], highfive: ['highfive', 0.85, 1.6, 1.6],
  dance: ['dance', 0.45, 6, 12], disco: ['disco', 0.45, 6, 12],
  cheer: ['cheer', 0.35, 2, 3.5], clap: ['clap', 0.4, 2, 4],
  bow: ['bow', 0.5, 2, 2], salute: ['salute', 0.5, 2, 2], thumbsup: ['thumbsup', 0.4, 1.8, 1.8],
  dab: ['laugh', 0.45, 1.4, 2.2], flex: ['laugh', 0.35, 1.4, 2.2], facepalm: ['laugh', 0.3, 1.4, 2],
  laugh: ['laugh', 0.3, 1.4, 2.2], shrug: ['shrug', 0.3, 1.1, 1.1], comeon: ['shrug', 0.3, 1.1, 1.1],
};

/** A conversation between two people (NPCs, or an NPC and the player). */
export class Convo {
  constructor(a, b, seated = false) {
    this.m = [a, b];
    this.phase = seated ? 'talk' : 'gather';
    this.seated = seated;
    this.t = 0;
    this.endT = rnd(10, 26);
    this.speaker = Math.random() < 0.5 ? 0 : 1;
    this.turnT = rnd(1.5, 4);
    this.waved = false;
    convos.push(this);
  }
  other(x) { return this.m[0] === x ? this.m[1] : this.m[0]; }
  begin() {
    if (this.phase === 'talk') return;
    this.phase = 'talk';
    this.t = 0;
    this.m[1 - this.speaker].gest.play(Math.random() < 0.5 ? 'wave' : 'nod');
  }
  update(dt) {
    this.t += dt;
    const [a, b] = this.m;
    for (const x of this.m) x.gest.look = HEAD(this.other(x).actor, x._look ||= V());
    if (this.phase === 'gather') {
      // the one being approached turns and waits; waves once they're near
      if (!this.waved && a.actor.hero.pos.distanceTo(b.actor.hero.pos) < 5) { this.waved = true; b.gest.play('wave'); }
      if (this.t > 14) this.end();
      return;
    }
    // walked off mid-sentence
    if (a.actor.hero.pos.distanceTo(b.actor.hero.pos) > 4.5 || a.actor.mode === 'ragdoll' || b.actor.mode === 'ragdoll') {
      this.end();
      return;
    }
    this.turnT -= dt;
    if (this.turnT <= 0) {
      if (Math.random() < 0.72) this.speaker = 1 - this.speaker;
      this.turnT = rnd(2, 6);
      const sp = this.m[this.speaker], li = this.m[1 - this.speaker];
      if (Math.random() < 0.18) sp.gest.play('shrug');
      else if (Math.random() < 0.12) { sp.gest.play('laugh'); li.gest.play('laugh'); }
      if (Math.random() < 0.5) li.gest.play('nod');
      if (Math.random() < 0.15) li.gest.newStyle();
      // snatches of what they're saying
      if (Math.random() < 0.4) {
        const ribbing = Math.random() < 0.15;
        sp.say?.(ribbing ? 'banter' : 'chat', { look: li.actor.hero.look });
        if (ribbing) setTimeout(() => { if (this.m.includes(li) && convos.includes(this)) li.say?.('banterBack', null, 'say', true); }, 1700);
      }
    }
    this.m.forEach((x, i) => x.gest.set(i === this.speaker ? 'talk' : 'listen'));
    if (this.t > this.endT) this.end(true);
  }
  end(nice = false) {
    const k = convos.indexOf(this);
    if (k >= 0) convos.splice(k, 1);
    for (const x of this.m) {
      x.gest.set(null);
      x.gest.look = null;
      if (nice) x.gest.play(Math.random() < 0.5 ? 'wave' : 'nod');
      if (x.convo === this) x.convo = null;
      x.onConvoEnd?.(this);
    }
  }
}

export function updateSocial(dt) {
  for (const c of convos.slice()) c.update(dt);
}

export class Npc {
  constructor(actor, home, ctx) {
    this.actor = actor;
    actor.npc = this;
    this.street = null;           // attitude, fights and crime (street.js), attached later
    this.home = home.clone();
    this.ctx = ctx;               // { seats, npcs, colliders }
    this.gest = new Gestures(actor.hero);
    this.act = { type: 'idle', t: rnd(0.5, 2) };
    this.convo = null;
    this.glareT = 0;
    this.stuckT = 0;
    this.downT = 0;
    this.fearT = 0;
    this.fleeFrom = null;
    this.glanceT = rnd(1, 3);
    this.chatCool = rnd(3, 10);
    this.move = V();
    // city sidewalks (ctx.nav): which node we last reached, where from, how we walk
    this.navAt = null;
    this.navPrev = null;
    this.laneOff = rnd(0.15, 0.75);
    this.pace = rnd(0.62, 0.86);
  }

  get free() {
    const A = this.actor;
    return A.mode === 'anim' && !this.convo && this.fearT <= 0 && !A.brain.shots && this.glareT <= 0 &&
      (this.act.type === 'walk' || this.act.type === 'idle') && !this.street?.busy;
  }
  say(kind, about, tone, force) { this.street?.say(kind, about, tone, force); }
  get posture() { const a = this.actor.hero.action; return a?.isPosture ? a : null; }

  pickTarget(colliders) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, r = rnd(2, 8);
      const x = this.home.x + Math.cos(a) * r, z = this.home.z + Math.sin(a) * r;
      if (!colliders.blocked(x, z, 0.05, 0.5)) return V(x, 0, z);
    }
    return this.home.clone();
  }

  /** Drop everything (knocked down, scared). */
  abort() {
    if (this.convo) this.convo.end();
    if (this.act.seat) this.act.seat.by = null;
    if (this.act.spot) this.act.spot.by = null;
    this.navAt = this.navPrev = null;
    this.act = { type: 'idle', t: rnd(1, 3) };
    this.gest.set(null);
    this.gest.look = null;
  }
  /** Healed and back home, with nothing on their mind (world reset). */
  reset() {
    this.abort();
    this.actor.respawn(this.home, Math.random() * Math.PI * 2);
    this.act = { type: 'idle', t: rnd(0.5, 2) };
    this.glareT = this.stuckT = this.downT = this.fearT = 0;
    this.fleeFrom = null;
    this.angry = false;
    this.chatCool = rnd(3, 10);
    this.move.set(0, 0, 0);
    this.glareAt = null;
    this.street?.reset();
  }
  onConvoEnd() {
    if (this.act.type === 'chat') this.act = { type: 'idle', t: rnd(0.5, 2) };
    this.chatCool = rnd(8, 20);
  }

  /** Gunfire at `from`: the closer it is, the surer they are to bolt. */
  hear(from, shooter) {
    const A = this.actor;
    if (A.brain.dead || shooter === A) return;
    const d = A.hero.pos.distanceTo(from);
    if (d > 30 || (d > 12 && Math.random() < 0.4)) return;
    // the brave (and the armed) stand their ground, or shoot back; the rest drop whatever
    // they were up to
    if (this.street) { if (this.street.heardShots(shooter)) return; if (this.street.mode) this.street.stop(); }
    if (d < 15 && Math.random() < 0.35) this.say('scared', null, 'scared');
    this.fearT = Math.max(this.fearT, rnd(5, 10) * (d < 10 ? 1.4 : 1));
    this.fleeFrom = (shooter?.hero?.pos || from).clone();
    this.abort();
    this.posture?.stand(true);
  }

  /** Controls for this frame. */
  think(dt, player, colliders, others) {
    const A = this.actor, h = A.hero;
    this.street?.tick(dt);
    this.glareT = Math.max(0, this.glareT - dt);
    this.fearT = Math.max(0, this.fearT - dt);
    this.chatCool -= dt;

    // something big coming at us fast: go physical and brace for it (euphoria-style)
    if (A.mode === 'anim' && others) {
      const th = findThreat(A.state.pos, A.state.vel, others, 0.4);
      if (th && th.closing > 3) { A.brace(); this.angry = true; }
    }

    // lying on the ground: stay down while hurting, then pick yourself up
    if (A.mode === 'ragdoll') {
      if (this.convo || this.act.type !== 'idle') this.abort();
      const b = A.brain;
      if (b.dead) return null;
      this.downT += dt;
      // shot: stays down holding it for a good while
      const hurt = b.clutch ? 7 : 0;
      const settled = b.state === 'ground' && b.stateT > 1.8 + hurt && b.speed < 0.35 && b.writhe < 0.1;
      if (settled || this.downT > 9 + hurt * 1.5) A.getUp(false);
      return null;
    }
    this.downT = 0;
    if (A.mode !== 'anim') return null;

    this.move.set(0, 0, 0);
    const toP = V(player.hero.pos.x - h.pos.x, 0, player.hero.pos.z - h.pos.z);
    const P = this.posture;
    const stand = (yaw = h.yaw) => ({ move: this.move, run: false, jump: false, camYaw: yaw - Math.PI });

    // (anything kicking off ends dancing along)
    if (this.act.type === 'emote' && (this.fearT > 0 || A.brain.shots || this.glareT > 0 || this.street?.busy)) { this.gest.stop(); this.act = { type: 'idle', t: rnd(0.5, 2) }; }
    // fights, robberies, mouthing off
    const sc = this.street?.control(dt, colliders);
    if (sc) { if (P) P.stand(true); return sc; }

    // shot, or heard shots: get away from the shooter, fast
    if (A.brain.shots || this.fearT > 0) {
      if (P) { P.stand(true); return stand(); }
      const from = this.fleeFrom || player.hero.pos;
      const away = V(h.pos.x - from.x, 0, h.pos.z - from.z);
      if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
      away.normalize();
      // steer round whatever's in the way
      for (const a of [0, 0.7, -0.7, 1.4, -1.4]) {
        const c = Math.cos(a), sn = Math.sin(a);
        const d = V(away.x * c + away.z * sn, 0, -away.x * sn + away.z * c);
        if (!colliders.blocked(h.pos.x + d.x * 0.8, h.pos.z + d.z * 0.8, h.pos.y + 0.25, 0.4)) { this.move.copy(d); break; }
      }
      const dist = Math.hypot(h.pos.x - from.x, h.pos.z - from.z);
      // looking back over the shoulder at the danger
      return { move: this.move, run: dist < 25, jump: false, camYaw: Math.atan2(from.x - h.pos.x, from.z - h.pos.z) - Math.PI };
    }
    if (this.glareT > 0) {
      // stop and stare down whoever knocked you over
      if (P) P.stand();
      const at = this.glareAt?.hero && !this.glareAt.seat ? this.glareAt : player;
      this.gest.look = HEAD(at, this._pl ||= V());
      return stand(Math.atan2(at.hero.pos.x - h.pos.x, at.hero.pos.z - h.pos.z));
    }

    const act = this.act;
    if (act.type === 'chat' && !this.convo) this.act = { type: 'idle', t: rnd(0.5, 2) };
    switch (this.act.type) {
      case 'chat': return this.doChat(dt, h);
      case 'seat': return this.doSeat(dt, h, colliders, stand);
      case 'ground': case 'lie': return this.doFloor(dt, h, stand);
      case 'browse': return this.doBrowse(dt, h, colliders, stand);
      case 'emote': {
        // stood facing whoever started it, until it's done
        act.t -= dt;
        if (act.t <= 0 || !act.by?.hero) { this.gest.stop(); this.gest.look = null; this.next(colliders); break; }
        this.gest.look = HEAD(act.by, this._pl ||= V());
        return stand(Math.atan2(act.by.hero.pos.x - h.pos.x, act.by.hero.pos.z - h.pos.z));
      }
      case 'walk': {
        if (act.nav) { const c = this.navWalk(dt, h, colliders); if (c) return c; break; }
        const d = V(act.target.x - h.pos.x, 0, act.target.z - h.pos.z);
        const dist = d.length();
        const sp = Math.hypot(h.vel.x, h.vel.z);
        this.stuckT = sp < 0.3 ? this.stuckT + dt : 0;
        if (dist < 0.4 || this.stuckT > 1.5) { this.stuckT = 0; this.next(colliders); }
        else this.move.copy(d.divideScalar(dist)).multiplyScalar(clamp(dist, 0.35, 0.8));
        break;
      }
      default: // idle
        act.t -= dt;
        if (act.t <= 0) this.next(colliders);
    }
    this.glances(dt, h, player);
    // player close: look at them
    return stand(toP.length() < 3.5 ? Math.atan2(toP.x, toP.z) : h.yaw);
  }

  /**
   * Someone nearby emoted (`id`, the wheel's): maybe join in or answer it - stopping to face
   * them for a bit. `to`: it was aimed at us (a high five). Nothing if we're busy or scared.
   */
  react(id, by, to = false) {
    if (id === 'highfive' && !to) return;
    const A = this.actor;
    if (this.convo || A.remote || A.mode !== 'anim' || A.brain.dead || A.brain.shots || this.fearT > 0 || this.glareT > 0 || this.street?.busy || this.cop) return;
    const R = REPLY[id];
    if (!R || (!to && Math.random() > R[1])) return;
    const [resp, , d0, d1] = R;
    const dur = rnd(d0, d1);
    this.gest.look = HEAD(by, V());
    // (sat down, or lying about: just the hands)
    if (this.act.type !== 'idle' && this.act.type !== 'walk' && this.act.type !== 'browse' && this.act.type !== 'emote') {
      if (this.act.type === 'seat') this.gest.play(resp === 'dance' || resp === 'disco' ? 'clap' : resp, dur);
      return;
    }
    this.act = { type: 'emote', t: dur, by };
    this.gest.play(resp, dur, to ? by.hero : null);
  }

  /** Choose what to do next. */
  next(colliders) {
    const h = this.actor.hero, C = this.ctx;
    const r = Math.random();
    if (C.nav) { this.nextInCity(colliders, r); return; }
    // someone to talk to?
    if (r < 0.3 && this.chatCool <= 0) {
      const mates = C.npcs.filter((n) => n !== this && n.free && n.chatCool <= 0 && n.actor.hero.pos.distanceTo(h.pos) < 12);
      if (mates.length) {
        const m = mates[Math.floor(Math.random() * mates.length)];
        const c = new Convo(this, m);
        this.convo = m.convo = c;
        this.act = { type: 'chat' }; m.act = { type: 'chat' };
        return;
      }
    }
    if (r < 0.52) {
      // a free seat nearby (sometimes one next to somebody already sitting)
      const seats = C.seats.filter((s) => !s.by && s.o.distanceTo(h.pos) < 16);
      if (seats.length) {
        seats.sort((a, b) => this.seatScore(a) - this.seatScore(b));
        const seat = seats[Math.floor(Math.random() * Math.min(3, seats.length))];
        seat.by = this;
        this.act = { type: 'seat', seat, phase: 'go', t: rnd(12, 35), goT: 0 };
        return;
      }
    }
    if (r < 0.6 && this.roomToLie(colliders, 0.3)) { this.act = { type: 'ground', phase: 'start', t: rnd(10, 25) }; return; }
    if (r < 0.66 && this.roomToLie(colliders, 1.1)) { this.act = { type: 'lie', phase: 'start', t: rnd(14, 35) }; return; }
    if (r < 0.8) { this.act = { type: 'idle', t: rnd(2, 6) }; return; }
    this.act = { type: 'walk', target: this.pickTarget(colliders) };
  }
  /** Head off walking again: along the sidewalks in the city, somewhere near home otherwise. */
  wander(colliders) {
    if (this.ctx.nav) this.navStep();
    else this.act = { type: 'walk', target: this.pickTarget(colliders) };
  }

  /** City life: mostly walking the sidewalks; now and then a chat, a bench, a shop window. */
  nextInCity(colliders, r) {
    const h = this.actor.hero, C = this.ctx, nav = C.nav;
    if (r < 0.1 && this.chatCool <= 0) {
      const mates = C.npcs.filter((n) => n !== this && n.free && n.chatCool <= 0 &&
        n.actor.hero.pos.distanceTo(h.pos) < 9 && nav.clear(h.pos, n.actor.hero.pos, 0.2));
      if (mates.length) {
        const m = mates[Math.floor(Math.random() * mates.length)];
        const c = new Convo(this, m);
        this.convo = m.convo = c;
        this.act = { type: 'chat' }; m.act = { type: 'chat' };
        return;
      }
    }
    if (r < 0.2) {
      const seats = C.seats.filter((s) => !s.by && s.o.distanceTo(h.pos) < 12);
      seats.sort((a, b) => this.seatScore(a) - this.seatScore(b));
      const seat = seats.slice(0, 3).find((s) => {
        const ap = V(Math.sin(s.yaw), 0, Math.cos(s.yaw)).multiplyScalar(0.45).add(s.o);
        return nav.clear(h.pos, ap);
      });
      if (seat) {
        seat.by = this;
        this.act = { type: 'seat', seat, phase: 'go', t: rnd(10, 30), goT: 0 };
        this.navAt = null;
        return;
      }
    }
    if (r < 0.34) {
      const spot = nav.spotNear(h.pos, 12);
      if (spot) {
        spot.by = this;
        this.act = { type: 'browse', spot, phase: 'go', t: rnd(3, 9), goT: 0 };
        this.navAt = null;
        return;
      }
    }
    if (r < 0.4) { this.act = { type: 'idle', t: rnd(1.5, 4) }; return; }
    this.navStep();
  }

  /** Set off along the next stretch of sidewalk (or crosswalk) from where we are. */
  navStep() {
    const nav = this.ctx.nav, h = this.actor.hero;
    if (!this.navAt || this.navAt.p.distanceTo(h.pos) > 2.5) {
      const n = nav.nearest(h.pos);
      this.navAt = this.navPrev = null;
      this.act = { type: 'walk', nav: true, to: n, from: h.pos.clone(), phase: 'go' };
      return;
    }
    const l = nav.next(this.navAt, this.navPrev);
    this.act = { type: 'walk', nav: true, to: l.to, from: this.navAt.p.clone(), link: l, phase: l.cross ? 'curb' : 'go' };
  }

  /** Turn `dir` (unit, xz) aside from whatever is right in front of us. */
  steer(h, dir, colliders) {
    const y = h.pos.y + 0.25;
    for (const a of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4]) {
      const c = Math.cos(a), s = Math.sin(a);
      const x = dir.x * c + dir.z * s, z = -dir.x * s + dir.z * c;
      if (!colliders.blocked(h.pos.x + x * 0.7, h.pos.z + z * 0.7, y, 0.3)) { dir.set(x, 0, z); return dir; }
    }
    return dir;
  }

  /** Walk toward p (keeping to the right of the from->p line); true once there. */
  walkTo(h, from, p, colliders, speed, arrive = 0.45) {
    const d = V(p.x - from.x, 0, p.z - from.z);
    const L = d.length();
    let tx = p.x, tz = p.z;
    if (L > 0.5) { d.divideScalar(L); tx += -d.z * this.laneOff; tz += d.x * this.laneOff; }
    const to = V(tx - h.pos.x, 0, tz - h.pos.z);
    const dist = to.length();
    if (dist < arrive) return true;
    to.divideScalar(dist);
    if (dist > 1) this.steer(h, to, colliders);
    this.move.copy(to).multiplyScalar(clamp(dist, 0.35, speed));
    return false;
  }

  navWalk(dt, h, colliders) {
    const act = this.act, nav = this.ctx.nav, l = act.link;
    const sp = Math.hypot(h.vel.x, h.vel.z);
    if (act.phase !== 'wait') {
      this.stuckT = sp < 0.25 ? this.stuckT + dt : 0;
      if (this.stuckT > 2.5) { this.stuckT = 0; this.navAt = null; this.next(colliders); return null; }
    }
    if (act.phase === 'curb') {
      if (this.walkTo(h, act.from, l.wait, colliders, this.pace, 0.4)) { act.phase = 'wait'; act.waitT = 0; }
      return null;
    }
    if (act.phase === 'wait') {
      // at the curb: wait for the little walking man, watching the signal across the street
      act.waitT += dt;
      const face = Math.atan2(l.far.x - l.wait.x, l.far.z - l.wait.z);
      this.gest.look = (this._sig ||= V()).set(l.far.x, 2.9, l.far.z);
      if (nav.walkLeft(l.cross) > 4 || act.waitT > 45) {
        act.phase = 'cross';
        act.from = l.wait.clone();
        this.gest.look = null;
        return null;
      }
      return { move: this.move, run: false, jump: false, camYaw: face - Math.PI, faceYaw: face };
    }
    if (act.phase === 'cross') {
      // hurry up if it starts flashing
      const hurry = nav.signals[l.cross] !== 'walk';
      if (this.walkTo(h, act.from, l.far, colliders, hurry ? 1 : this.pace, 0.5)) { act.phase = 'go'; act.from = l.far.clone(); }
      if (hurry) return { move: this.move, run: true, jump: false, camYaw: h.yaw - Math.PI };
      return null;
    }
    if (this.walkTo(h, act.from, act.to.p, colliders, this.pace, 0.55)) {
      this.navPrev = this.navAt;
      this.navAt = act.to;
      if (Math.random() < 0.8) this.navStep();
      else this.next(colliders);
    }
    return null;
  }

  /** Stop at a shop window and have a look. */
  doBrowse(dt, h, colliders, stand) {
    const act = this.act, s = act.spot;
    if (act.phase === 'go') {
      act.goT += dt;
      if (act.goT > 15) { s.by = null; this.next(colliders); return stand(); }
      const d = V(s.pos.x - h.pos.x, 0, s.pos.z - h.pos.z), dist = d.length();
      if (dist > 0.3) {
        d.divideScalar(dist);
        if (dist > 1) this.steer(h, d, colliders);
        this.move.copy(d).multiplyScalar(clamp(dist, 0.3, this.pace));
        return stand();
      }
      act.phase = 'look';
      act.lookT = 0;
    }
    act.t -= dt;
    act.lookT += dt;
    // eyes wander along the display
    const w = Math.sin(act.lookT * 0.6 + s.pos.x) * 0.8;
    this.gest.look = (this._win ||= V()).copy(s.look).add(V(Math.cos(s.yaw) * w, Math.sin(act.lookT * 0.9) * 0.3, -Math.sin(s.yaw) * w));
    if (Math.random() < dt * 0.08) this.gest.play(Math.random() < 0.5 ? 'nod' : 'shrug');
    if (act.t <= 0) { s.by = null; this.gest.look = null; this.next(colliders); return stand(); }
    return { move: this.move, run: false, jump: false, camYaw: s.yaw - Math.PI, faceYaw: s.yaw };
  }

  seatScore(s) {
    const d = s.o.distanceTo(this.actor.hero.pos);
    const social = this.ctx.seats.some((o) => o !== s && o.by && o.o.distanceTo(s.o) < 1) ? -4 : 0;
    return d + social + rnd(0, 3);
  }
  roomToLie(col, back) {
    const h = this.actor.hero, f = h.forward();
    for (const k of [-back, 0, 0.9]) {
      const x = h.pos.x + f.x * k, z = h.pos.z + f.z * k;
      if (col.blocked(x, z, h.pos.y + 0.05, 0.45) || Math.abs(col.groundAt(x, z, h.pos.y + 0.3) - h.pos.y) > 0.02) return false;
    }
    return true;
  }

  /** Head turns toward whoever is near and in front, now and then. */
  glances(dt, h, player) {
    if (this.convo) return;
    this.glanceT -= dt;
    if (this.glanceT > 0) return;
    this.glanceT = rnd(1.5, 4);
    this.gest.look = null;
    if (Math.random() < 0.35) return;
    let best = null, bd = 5;
    for (const o of [player, ...this.ctx.npcs.map((n) => n.actor)]) {
      if (o === this.actor || o.mode === 'ragdoll' && Math.random() < 0.5) continue;
      const d = o.hero.pos.distanceTo(h.pos);
      const f = h.forward(), dx = o.hero.pos.x - h.pos.x, dz = o.hero.pos.z - h.pos.z;
      if (d < bd && (f.x * dx + f.z * dz) > -0.2 * d) { best = o; bd = d; }
    }
    if (best) {
      this.gest.look = HEAD(best, this._gl ||= V());
      if (bd < 2.5 && Math.random() < 0.3) this.gest.play('nod');
    }
  }

  doChat(dt, h) {
    const c = this.convo, o = c.other(this).actor.hero;
    const d = V(o.pos.x - h.pos.x, 0, o.pos.z - h.pos.z);
    const dist = d.length();
    const face = Math.atan2(d.x, d.z);
    if (c.seated) return { move: this.move, run: false, jump: false, camYaw: face - Math.PI };
    if (c.phase === 'gather') {
      // the initiator walks up; the other waits, turned toward them
      if (c.m[0] === this && dist > 1.25) this.move.copy(d).divideScalar(dist).multiplyScalar(clamp(dist * 0.5, 0.4, 0.8));
      else if (dist <= 1.3) c.begin();
      return { move: this.move, run: false, jump: false, camYaw: face - Math.PI, faceYaw: dist < 6 || c.m[1] === this ? face : undefined };
    }
    // talking: keep a comfortable distance, square up to them
    if (dist < 0.9) this.move.copy(d).divideScalar(-dist).multiplyScalar(0.3);
    else if (dist > 1.7) this.move.copy(d).divideScalar(dist).multiplyScalar(0.45);
    if (dist > 4) c.end();
    return { move: this.move, run: false, jump: false, camYaw: face - Math.PI, faceYaw: face };
  }

  doSeat(dt, h, colliders, stand) {
    const act = this.act, seat = act.seat;
    const P = this.posture;
    if (act.phase === 'go') {
      const ap = V(Math.sin(seat.yaw), 0, Math.cos(seat.yaw)).multiplyScalar(0.45).add(seat.o);
      const d = V(ap.x - h.pos.x, 0, ap.z - h.pos.z), dist = d.length();
      act.goT += dt;
      if (act.goT > 20) { seat.by = null; this.next(colliders); return stand(); }
      if (dist > 0.22) { this.move.copy(d).divideScalar(dist).multiplyScalar(clamp(dist, 0.3, 0.8)); return stand(); }
      if (h.action || !h.grounded) return stand();
      h.action = new Posture(h, 'sit', seat);
      act.phase = 'sit';
      return stand();
    }
    if (act.phase === 'sit') {
      if (!P) { this.act = { type: 'idle', t: rnd(1, 3) }; seat.by = null; return stand(); }
      act.t -= dt;
      // somebody sitting right next to us: strike up a conversation
      if (P.settled && !this.convo && this.chatCool <= 0 && Math.random() < dt * 0.25) {
        const m = this.ctx.npcs.find((n) => n !== this && !n.convo && n.act.type === 'seat' && n.posture?.settled &&
          n.act.seat.o.distanceTo(seat.o) < 1.6 && n.chatCool <= 0);
        if (m) { const c = new Convo(this, m, true); this.convo = m.convo = c; }
      }
      if (act.t <= 0 && !this.convo) { P.stand(); act.phase = 'up'; }
      if (!this.convo) P.lookAt = this.gest.look;
      return stand();
    }
    // getting up
    if (!P) { seat.by = null; this.wander(colliders); }
    return stand();
  }

  doFloor(dt, h, stand) {
    const act = this.act, P = this.posture;
    if (act.phase === 'start') {
      if (h.action || !h.grounded) return stand();
      h.action = new Posture(h, act.type, { o: h.pos.clone(), yaw: h.yaw, h: 0 });
      act.phase = 'down';
      return stand();
    }
    if (!P) { this.act = { type: 'idle', t: rnd(1, 2) }; return stand(); }
    if (act.phase === 'down') {
      act.t -= dt;
      if (act.t <= 0) { P.stand(); act.phase = 'up'; }
    }
    return stand();
  }
}

const _d = V(), _n = V();

/** Knock `b` over with an impulse along dir, sized by impact speed (m/s). */
export function knock(b, dir, impact, lateral = 0) {
  if (b.untouchable) return; // (main.js: nobody can knock you over)
  const soft = impact < 3.2;
  b.goRagdoll('stumble', soft
    ? { balance: 1, decay: 0.08 }
    : { balance: clamp(1.1 - impact * 0.1, 0.35, 0.85), decay: 0.22 + impact * 0.04 });
  const imp = dir.clone().setY(0).normalize().multiplyScalar(soft ? 25 + impact * 10 : 30 + impact * 20);
  imp.y = 4 + impact * 1.5;
  // off-centre hits spin people round (shoulder checks)
  b.pending = { imp, local: V(clamp(lateral, -1, 1) * 0.16, 0.12 + Math.random() * 0.1, 0) };
}

/**
 * Body contact between everyone this frame.
 *  - two upright people: the faster one shoulders the slower one; slow contact just shoves apart
 *  - a ragdoll tumbling into an upright person takes them down with it
 */
export function resolveBumps(actors, dt) {
  for (const a of actors) {
    a.bumpT = Math.max(0, (a.bumpT || 0) - dt);
    // someone hanging off us drags us off balance
    if (a.tug > 0) {
      if (a.mode === 'anim' && a.tug > 40 && a.tugDir?.lengthSq() > 1e-6) {
        knock(a, a.tugDir, 2.2);
        a.tug = 0;
      }
      a.tug *= Math.exp(-dt * 2.5);
    }
  }
  for (let i = 0; i < actors.length; i++) {
    for (let j = i + 1; j < actors.length; j++) {
      const A = actors[i], B = actors[j];
      if (A.seat || B.seat) continue;
      const upA = A.mode !== 'ragdoll', upB = B.mode !== 'ragdoll';
      if (upA && upB) bumpUpright(A, B, dt);
      else if (upA !== upB) bumpTumble(upA ? B : A, upA ? A : B, dt);
    }
  }
}

function bumpUpright(A, B, dt = 1 / 60) {
  const pa = A.hero.pos, pb = B.hero.pos;
  _d.set(pb.x - pa.x, 0, pb.z - pa.z);
  const dist = _d.length();
  if (dist > 0.6 || dist < 1e-4 || Math.abs(pa.y - pb.y) > 1) return;
  _n.copy(_d).divideScalar(dist); // A -> B
  const va = A.hero.vel, vb = B.hero.vel;
  const aIn = va.x * _n.x + va.z * _n.z, bIn = -(vb.x * _n.x + vb.z * _n.z);
  const rel = aIn + bIn;
  const hitter = aIn >= bIn ? A : B, hit = hitter === A ? B : A;
  const dir = hitter === A ? _n.clone() : _n.clone().negate();
  const hv = hitter.hero.vel;
  const hitterSpeed = Math.hypot(hv.x, hv.z);
  if (rel > 2.3 && hitterSpeed > 2.6 && !hit.bumpT && A.mode === 'anim' && B.mode === 'anim') {
    // A wing-powered tackle gets a brighter impact and a little extra knockback.
    const wingHit = !!hitter.wingFlying;
    const side = (hv.x * dir.z - hv.z * dir.x) / Math.max(hitterSpeed, 1e-3);
    knock(hit, V(hv.x, 0, hv.z).normalize().lerp(dir, 0.5), wingHit ? Math.max(6.5, rel * 1.45) : rel, side * 2.5);
    hit.bumpT = wingHit ? 1.2 : 1;
    if (wingHit) hitter.onWingCollision?.(hit);
    hit.onKnocked?.(hitter);
    // the hitter loses a chunk of momentum; a hard enough sprint trips them up too
    const into = hv.x * dir.x + hv.z * dir.z;
    hv.x -= dir.x * into * 0.55; hv.z -= dir.z * into * 0.55;
    if (rel > 5 && Math.random() < 0.2) knock(hitter, V(hv.x, 0, hv.z).lengthSq() > 0.1 ? V(hv.x, 0, hv.z) : dir, rel * 0.5);
    return;
  }
  // gentle contact: push apart, mostly moving whoever is slower / not the player
  // (half the overlap per 60fps frame, as a rate: the same separation per second at any framerate)
  const push = (0.6 - dist) * (1 - 0.5 ** (dt * 60));
  if (dist < 0.5) { if (A.isPlayer) B.npc?.street?.bumped(A); else if (B.isPlayer) A.npc?.street?.bumped(B); }
  const wa = A.isPlayer ? 0.25 : 0.5, wb = B.isPlayer ? 0.25 : 0.5;
  pa.x -= _n.x * push * wa * 2; pa.z -= _n.z * push * wa * 2;
  pb.x += _n.x * push * wb * 2; pb.z += _n.z * push * wb * 2;
}

function bumpTumble(R, U, dt = 1 / 60) {
  if (U.mode !== 'anim') return;
  const c = R.rd.com(_d), v = R.rd.comVel(_n);
  const p = U.hero.pos;
  const dx = p.x - c.x, dz = p.z - c.z, dist = Math.hypot(dx, dz);
  // an upright runner ploughing into a body: their capsule shoves it, and they lose momentum
  const uv = U.hero.vel;
  const into = -(uv.x * dx + uv.z * dz) / Math.max(dist, 1e-3);
  if (dist < 0.55 && into > 1.2 && c.y - p.y < 1.6) {
    // the body resists: the runner can't just plough through it
    const k = 0.6 * Math.min(1, dt * 60) * into / Math.max(dist, 1e-3);
    uv.x += dx * k; uv.z += dz * k;
    if (U.bumpT) return;
    // momentum transfer into the body (the runner's shoulder), once per contact
    const dir = V(-dx, 0, -dz).normalize();
    const side = (uv.x * dir.z - uv.z * dir.x) / Math.max(Math.hypot(uv.x, uv.z), 1e-3);
    const imp = dir.clone().lerp(V(uv.x, 0, uv.z).normalize(), 0.5).normalize().multiplyScalar(20 + into * 15);
    imp.y = 2;
    R.pending = { imp, local: V(clamp(side * 2.5, -1, 1) * 0.15, 0.15, 0) };
    if (R.brain.state === 'balance') R.brain.bal = Math.max(0, R.brain.bal - into * 0.1);
    U.bumpT = 0.5;
    R.onKnocked?.(U);
    if (into > 5.5 && Math.random() < 0.2) knock(U, V(uv.x - dx, 0, uv.z - dz), into * 0.4);
    return;
  }
  const sp = Math.hypot(v.x, v.z);
  if (dist > 0.55 || c.y - p.y > 1.6 || c.y - p.y < 0.15) return;
  // moving toward them fast enough
  const toward = (v.x * dx + v.z * dz) / Math.max(dist, 1e-3);
  if (U.bumpT || sp < 2.6 || toward < 2.1) return;
  knock(U, V(v.x, 0, v.z), toward * 0.9, (Math.random() - 0.5));
  U.bumpT = 1;
  U.onKnocked?.(R);
}
