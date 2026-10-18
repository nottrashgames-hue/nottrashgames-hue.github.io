import * as THREE from 'three';
import { Gun } from '../gun.js';
import { armUp } from '../melee.js';

/*
  Multiplayer, things lying about: weapons (every pistol, bat, crowbar, machete - the table's,
  bought ones, street people's), street props knocked loose, and litter / chairs being carried.

  Weapons: each has a net id (the ones there at the start: their order, the same on every
  client; later ones: "<creator>~n"). Whoever's simulation changes one - picks it up, drops it,
  puts it away - says so; everybody else's copy follows:
    H  in someone's hands (or pocket): gone from the ground here, their puppet shows it
    L  dropped: loose here too, thrown the same way
    S  came to rest (from whoever last moved it): snapped to exactly where
    R  back where it started (a world reset)
    X  gone (a bought one, reset away)
  Two players grabbing the same one at once: the lower connection id keeps it.

  Props: a wreck / shove is already relayed (mp.js 'prop'); here, where the loose prop ended up.
  Carried things: picked up (gone from everyone's ground), put down / thrown (there again).
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const q3 = (x) => Math.round(x * 1000);
const q4 = (x) => Math.round(x * 10000);
const vec = (v) => [q3(v.x), q3(v.y), q3(v.z)];
const unvec = (a) => V(a[0] / 1000, a[1] / 1000, a[2] / 1000);
const quat = (q) => [q4(q.x), q4(q.y), q4(q.z), q4(q.w)];
const unquat = (a) => new THREE.Quaternion(a[0], a[1], a[2], a[3]).normalize();
const now = () => performance.now() / 1000;
const NUDGE_R = 2.5;   // m: a loose thing waking this close to us is ours to report
const QUIET = 1.5;     // s after someone else's word on it before we'd claim it

export class ItemSync {
  /** mp: the Multiplayer; its g also has guns, melees, makeItem(type), removeItem(w), debris, litter, props. */
  constructor(mp) {
    this.mp = mp;
    this.g = mp.g;
    this.byId = new Map();
    this.idOf = new Map();
    this.seq = 0;
    this.all().forEach((w, i) => this.register(w, 'i' + i));
  }

  all() { return [...this.g.guns, ...this.g.melees]; }
  type(w) { return w.type; }
  /** held / pocketed: H; loose: L; on its spot: R; someone else's: X */
  code(w) { return w.state === 'held' || w.state === 'hidden' ? 'H' : w.state === 'loose' || w.state === 'embed' ? 'L' : w.state === 'remote' ? 'X' : 'R'; }
  register(w, id) {
    this.byId.set(id, w);
    this.idOf.set(w, id);
    w._ns = { seen: this.code(w), by: w.owner, auth: false, settled: true, rxT: -Infinity };
  }
  send(e) { this.mp.send(e); }
  sendItem(w, s, extra = {}) { this.send({ k: 'item', id: this.idOf.get(w), ty: this.type(w), s, ...extra }); }
  pose(w) {
    const m = w.mesh;
    const b = w.loose?.body;
    const p = b ? b.translation() : m.position, r = b ? b.rotation() : m.quaternion;
    return { p: vec(p), q: quat(r) };
  }

  // ------------------------------------------------------------------ out
  /** Once a frame (after the simulation): report what our side did to things. */
  poll() {
    const mp = this.mp, hp = this.g.hero.hero.pos, t = now();
    const here = new Set();
    for (const w of this.all()) {
      here.add(w);
      if (!this.idOf.has(w)) {
        this.register(w, mp.me + '~' + (++this.seq));
        // (a fresh one in someone's pocket needn't be news; one in hand is)
        if (w.state === 'hidden') continue;
        w._ns.seen = null;
      }
      const S = w._ns, st = this.code(w);
      if (st !== S.seen && st !== 'X') {
        const was = S.by;
        S.seen = st;
        const ours = (a) => a && !a.remote;
        if (st === 'H') {
          if (ours(w.owner)) { S.auth = true; this.sendItem(w, 'H', { by: mp.ref(w.owner) }); }
          // (a street person's weapon back in their pocket on a world reset)
          else if (w.npcKit && !w.owner && mp.isHost) this.sendItem(w, 'H', { by: -1 });
        }
        else if (st === 'L') {
          if (ours(was) || S.auth) {
            S.auth = true; S.settled = false;
            const b = w.loose?.body, lv = b ? b.linvel() : V(), av = b ? b.angvel() : V();
            this.sendItem(w, 'L', { ...this.pose(w), v: vec(lv), w: vec(av) });
          }
        } else if (st === 'R' && !w.npcKit) this.sendItem(w, 'R');
      }
      if (w.state === 'held') S.by = w.owner;
      else if (w.state !== 'hidden') S.by = null;
      // loose: whoever moved it last says where it stopped
      if (w.state === 'loose' && w.loose) {
        const b = w.loose.body, asleep = !b || b.isSleeping();
        if (!asleep) {
          if (!S.auth && t - S.rxT > QUIET && b) {
            const p = b.translation();
            if (Math.hypot(p.x - hp.x, p.z - hp.z) < NUDGE_R) S.auth = true;
          }
          S.settled = false;
        } else if (S.auth && !S.settled) { S.settled = true; this.sendItem(w, 'S', this.pose(w)); }
      }
    }
    // gone from the world (a bought one, reset away): gone for everyone
    for (const [w, id] of this.idOf) {
      if (here.has(w)) continue;
      this.idOf.delete(w); this.byId.delete(id);
      if (w._ns.auth || id.startsWith(mp.me + '~')) this.send({ k: 'item', id, ty: this.type(w), s: 'X' });
    }
    this.pollProps(t, hp);
  }

  pollProps(t, hp) {
    const props = this.g.props, D = this.g.debris;
    props.list.forEach((p, i) => {
      if (!p.broken || p.carried || !p.loose || !D.has(p.loose)) return;
      const S = (p._ns ||= { auth: false, settled: true, rxT: -Infinity });
      const b = p.loose.body, asleep = !b || b.isSleeping();
      if (!asleep) {
        if (!S.auth && t - S.rxT > QUIET) {
          const q = b.translation();
          if (Math.hypot(q.x - hp.x, q.z - hp.z) < NUDGE_R) S.auth = true;
        }
        S.settled = false;
      } else if (S.auth && !S.settled) {
        S.settled = true;
        const q = b ? b.translation() : p.loose.mesh.position, r = b ? b.rotation() : p.loose.mesh.quaternion;
        this.send({ k: 'pset', i, p: vec(q), q: quat(r) });
      }
    });
  }
  /** We knocked prop p loose (mp.propBroke): where it lands is ours to report. */
  propMoved(p) { const S = (p._ns ||= { auth: false, settled: true, rxT: -Infinity }); S.auth = true; S.settled = false; }

  /** A pick-up by our player (carry.js): it's gone from everyone's ground. */
  lifted(it) {
    const props = this.g.props, i = props.list.findIndex((p) => p.loose === it);
    if (i >= 0) props.list[i].carried = true;
    const t = this.g.debris.pos(it);
    this.send({ k: 'lift', ty: it.pick?.type || '', i, p: vec(t) });
  }
  /** Put down or thrown by our player: n is the new loose piece, old the one that was carried. */
  set(n, old, vel, spin) {
    const props = this.g.props, i = props.list.findIndex((p) => p.loose === old);
    if (i >= 0) { const p = props.list[i]; p.loose = n; p.carried = false; this.propMoved(p); }
    const m = n.mesh;
    this.send({ k: 'lset', ty: n.pick?.type || '', i, p: vec(m.position), q: quat(m.quaternion), v: vec(vel), s: vec(spin) });
  }

  /** A player just arrived: the host tells them how everything lies. */
  snapshotTo(id) {
    if (!this.mp.isHost) return;
    const l = [];
    for (const [w, wid] of this.idOf) {
      const c = this.code(w);
      // (still as every copy starts)
      if ((c === 'R' || w.state === 'hidden') && wid.startsWith('i')) continue;
      const e = [wid, this.type(w), c === 'X' ? 'H' : c === 'L' ? 'S' : c];
      if (c === 'H') e.push(w.owner ? this.mp.ref(w.owner) : w.npcKit ? -1 : null);
      else if (c === 'L') { const P = this.pose(w); e.push(null, P.p, P.q); }
      l.push(e);
    }
    const pr = [];
    this.g.props.list.forEach((p, i) => {
      if (!p.broken) return;
      if (p.carried) { pr.push([i, 0]); return; }
      if (!p.loose || !this.g.debris.has(p.loose)) return;
      const q = this.g.debris.pos(p.loose), r = p.loose.body ? p.loose.body.rotation() : p.loose.mesh.quaternion;
      pr.push([i, 1, vec(q), quat(r)]);
    });
    this.send({ k: 'items', to: id, l, pr });
  }

  // ------------------------------------------------------------------ in
  onEvent(m) {
    switch (m.k) {
      case 'item': this.apply(m); return true;
      case 'items': {
        if (m.to !== this.mp.me) return true;
        for (const [id, ty, s, by, p, q] of m.l || []) this.apply({ id, ty, s, by, p, q, from: m.from });
        this.muted(() => {
          for (const [i, on, p, q] of m.pr || []) {
            const P = this.g.props.list[i];
            if (!P) continue;
            if (!on) this.g.props.lift(P);
            else this.g.props.settle(P, unvec(p), unquat(q));
          }
        });
        return true;
      }
      case 'pset': {
        const p = this.g.props.list[m.i];
        if (!p || p.carried) return true;
        const S = (p._ns ||= { auth: false, settled: true, rxT: -Infinity });
        S.auth = false; S.rxT = now(); S.settled = true;
        this.muted(() => this.g.props.settle(p, unvec(m.p), unquat(m.q)));
        return true;
      }
      case 'lift': {
        if (m.i >= 0) { const p = this.g.props.list[m.i]; if (p) this.muted(() => this.g.props.lift(p)); return true; }
        // the same kind of litter lying nearest where they picked it up
        const D = this.g.debris, at = unvec(m.p);
        let best = null, bd = 1;
        for (const it of [...D.items, ...D.frozen]) {
          if (it.pick?.type !== m.ty || this.g.carry.item === it) continue;
          const d = D.pos(it).distanceTo(at);
          if (d < bd) { bd = d; best = it; }
        }
        if (best) D.remove(best);
        return true;
      }
      case 'lset': {
        const p = unvec(m.p), q = unquat(m.q), v = unvec(m.v), s = unvec(m.s);
        if (m.i >= 0) {
          const P = this.g.props.list[m.i];
          if (!P) return true;
          this.muted(() => this.g.props.set(P, p, q, v, s));
          const S = (P._ns ||= { auth: false, settled: true, rxT: -Infinity });
          S.auth = false; S.rxT = now();
          return true;
        }
        try {
          const it = this.g.litter.make(m.ty, p, v, s);
          it.body?.setRotation(q, true);
        } catch { /* not a loose kind here */ }
        return true;
      }
    }
    return false;
  }
  muted(fn) { const mp = this.mp; mp.muted = true; try { fn(); } finally { mp.muted = false; } }

  apply(m) {
    let w = this.byId.get(m.id);
    if (!w) {
      if (m.s === 'X') return;
      w = this.g.makeItem(m.ty);
      if (!w) return;
      this.register(w, m.id);
    }
    if (this.type(w) !== m.ty) return;
    const S = w._ns;
    S.auth = false; S.rxT = now(); S.settled = true;
    switch (m.s) {
      case 'H':
        if (!this.yieldTo(w, m.from)) return;
        this.stow(w);
        // a street person's pocket: theirs to draw again should we end up running them
        w.state = w.npcKit && typeof m.by === 'number' ? 'hidden' : 'remote';
        break;
      case 'L': case 'S': {
        if (!this.yieldTo(w, m.from)) return;
        const p = unvec(m.p), q = unquat(m.q);
        if (m.s === 'L' || w.state !== 'loose' || !w.loose?.body) {
          w.owner && this.release(w);
          w.looseAt(p, q, m.v ? unvec(m.v) : V(), m.w ? unvec(m.w) : V());
        }
        if (m.s === 'S') {
          const b = w.loose.body;
          b.setTranslation(p, true); b.setRotation(q, true);
          b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true);
          b.sleep();
          this.g.debris.sync(w.loose);
        }
        break;
      }
      case 'R':
        if (w.owner === this.g.hero) return; // (in our hands: we'll say where it goes)
        w.reset();
        w.mesh.visible = true;
        break;
      case 'X':
        this.stow(w);
        w.mesh.removeFromParent();
        this.byId.delete(m.id); this.idOf.delete(w);
        this.g.removeItem(w);
        return;
    }
    S.seen = this.code(w);
    S.by = w.owner;
  }

  /** Someone else says they have it. We keep it only if we're holding it and got there first. */
  yieldTo(w, from) {
    const A = w.owner;
    if (!A || A.remote) return true;
    if (A === this.g.hero && String(this.mp.me) < String(from)) {
      this.sendItem(w, 'H', { by: this.mp.me }); // ours: tell them again
      return false;
    }
    this.release(w);
    return true;
  }
  /** Out of whoever's hands it's in here, quietly. */
  release(w) {
    const A = w.owner;
    if (!A) return;
    A.hero.armHook = null;
    A.hero.twist = A.hero.bend = 0;
    if (A.gunHeld === w) { w.abortReload?.(); A.gunHeld = null; }
    if (A.meleeHeld === w) A.meleeHeld = null;
    if (A.meleeHeldL === w) A.meleeHeldL = null;
    // (a weapon still in the other hand keeps its hold on the arms)
    if (A.meleeHeld || A.meleeHeldL) armUp(A);
    w.owner = null;
    if (w.hand !== undefined) w.hand = 1;
    w.swing = null;
    w.chop = null;
    w.btn = null;
    A.hero.dip = 0;
    w.queued = false;
  }
  /** Off the ground and out of sight (someone else's hands show it). */
  stow(w) {
    this.release(w);
    if (w.loose) { this.g.debris.release(w.loose); w.loose = null; }
    w.mesh.visible = false;
  }
}
