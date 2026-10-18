import * as THREE from 'three';
import { Actor } from '../actor.js';
import { Net } from './net.js';
import { specialLook, wearSpecial, SPECIAL_SHAPE } from '../special.js';
import { ItemSync } from './itemsync.js';
import { SHAPE_KEYS } from '../character.js';
import { sanitizeLook } from '../wardrobe.js';
import { freshMatrices } from '../slice.js';
import { guardHit, WEAPONS } from '../melee.js';
import { WeaponBlood } from '../weaponblood.js';
import { inkOf } from '../inks.js';

const shapeOf = (l) => SHAPE_KEYS.map((k) => l?.[k]).join();

/*
  Multiplayer, game side. Who simulates what:
  - every client: its own player (and the car it's driving);
  - the host (see server.js): every pedestrian and every car nobody is driving.
  Everyone else sees those as puppets, posed from the owner's snapshots ~130 ms in the past.
  A hit landed on a puppet is shown locally (the wound) and sent to the body's owner, who
  takes it for real and tells everyone else to show the same wound.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Q = () => new THREE.Quaternion();
const PARTS = ['pelvis', 'spine', 'chest', 'head', 'thighL', 'shinL', 'footL', 'upperL', 'foreL', 'thighR', 'shinR', 'footR', 'upperR', 'foreR'];
const MIN_DELAY = 0.09, MAX_DELAY = 0.5; // s: how far in the past puppets are shown (adaptive, per sender)
const SNAP = 3;           // m: a correction bigger than this snaps (respawn, recycled body); smaller ones glide
const P_DT = 1 / 20;      // own-body snapshots
const W_DT = 1 / 12;      // host world snapshots
const NEAR = 55;          // m: pedestrians closer than this to some other player go out every world tick
const BUF = 24;
// Skip sending cars that are asleep (all but every 30th world tick)? Off: parked cars only began to
// sleep once vehicle.js stopped rousing them every step, and the other copies smooth a car by how
// often its snapshots come, so a nudged one would show late. Every car goes out every tick, as ever.
const SKIP_SLEEPING_CARS = false;
const q3 = (x) => Math.round(x * 1000);
const q4 = (x) => Math.round(x * 10000);
const vec = (v) => [q3(v.x), q3(v.y), q3(v.z)];
const unvec = (a, out = V()) => out.set(a[0] / 1000, a[1] / 1000, a[2] / 1000);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const now = () => performance.now() / 1000;
const _qa = Q(), _qb = Q(), _v = V(), _v2 = V();

/** A body's pose: pelvis position, the other parts relative to it, every part's rotation, head, grip. */
function encPose(a) {
  const c = a.capture(a._netCap || (a._netCap = {}));
  // (a part cut off our body is a ghost in our physics, drifting: it goes out on its joint,
  // for copies that haven't got the cut yet)
  a.pinJoints?.(c, 0.1);
  const P = c.pelvis.pos, out = [q3(P.x), q3(P.y), q3(P.z)];
  for (const n of PARTS) {
    const o = c[n];
    if (n !== 'pelvis') out.push(q3(o.pos.x - P.x), q3(o.pos.y - P.y), q3(o.pos.z - P.z));
    out.push(q3(o.quat.x), q3(o.quat.y), q3(o.quat.z), q3(o.quat.w));
  }
  const hq = a.hero.head.quaternion;
  out.push(q3(hq.x), q3(hq.y), q3(hq.z), q3(hq.w));
  out.push(Math.round((a.hero.arms[0].grip ?? 0.3) * 100), Math.round((a.hero.arms[1].grip ?? 0.3) * 100));
  return out;
}
/** Pose A -> B by k into `pose` (+ the head's own rotation and the grips). */
function decPose(A, B, k, pose, head, grip) {
  const lp = (j) => (A[j] + (B[j] - A[j]) * k) / 1000;
  const px = lp(0), py = lp(1), pz = lp(2);
  let i = 3;
  const slq = (out) => {
    _qa.set(A[i], A[i + 1], A[i + 2], A[i + 3]).normalize();
    _qb.set(B[i], B[i + 1], B[i + 2], B[i + 3]).normalize();
    out.slerpQuaternions(_qa, _qb, k);
    i += 4;
  };
  for (const n of PARTS) {
    const o = (pose[n] ||= { pos: V(), quat: Q() });
    if (n === 'pelvis') o.pos.set(px, py, pz);
    else { o.pos.set(px + lp(i), py + lp(i + 1), pz + lp(i + 2)); i += 3; }
    slq(o.quat);
  }
  slq(head);
  grip[0] = (A[i] + (B[i] - A[i]) * k) / 100;
  grip[1] = (A[i + 1] + (B[i + 1] - A[i + 1]) * k) / 100;
  return pose;
}
const lerpAng = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

/**
 * Snapshot buffer at sender-time T: the pair bracketing it and how far between (k), or - past
 * the newest (a late packet) - the newest with how far to extrapolate beyond it (ext) and the
 * one before it (for a velocity). Entries with ts -Infinity are hand-over states: held, never
 * used for velocities.
 */
function sample(buf, T, maxExt = 0.25) {
  if (!buf.length) return null;
  let i = buf.length - 1;
  while (i > 0 && buf[i].ts > T) i--;
  const A = buf[i], B = buf[i + 1];
  if (B) {
    const span = B.ts - A.ts;
    const k = Number.isFinite(span) && span > 1e-4 ? clamp((T - A.ts) / span, 0, 1) : 1;
    return { A: A.s, B: B.s, k, ext: 0, span: Number.isFinite(span) ? span : 0 };
  }
  if (!(A.ts <= T)) return { A: A.s, B: A.s, k: 0, ext: 0, span: 0 }; // (older than anything we have: hold the oldest)
  const P = buf[i - 1];
  const span = P && Number.isFinite(P.ts) && Number.isFinite(A.ts) ? A.ts - P.ts : 0;
  return { A: P && span > 1e-3 ? P.s : A.s, B: A.s, k: 1, ext: Number.isFinite(A.ts) ? Math.min(T - A.ts, maxExt) : 0, span: span > 1e-3 ? span : 0 };
}
function push(buf, ts, s) {
  if (buf.length && ts <= buf[buf.length - 1].ts) return false;
  buf.push({ ts, s });
  if (buf.length > BUF) buf.shift();
  return true;
}

/**
 * A car's snapshots now come from someone else (a hand-over): their clock isn't the last
 * sender's, so what's buffered is kept only as the state to hold until theirs arrive.
 */
function carFrom(R, id) {
  if (R.from === id) return;
  if (R.from !== undefined && R.buf.length) R.buf = [{ ts: -Infinity, s: R.buf[R.buf.length - 1].s }];
  R.from = id;
  R.lastTs = undefined; R.gap = undefined;
}
/** One thing's own snapshot interval (a far or idle pedestrian is only sent now and then). */
function note(R, ts) {
  if (R.lastTs !== undefined && Number.isFinite(R.lastTs) && ts > R.lastTs) {
    const d = clamp(ts - R.lastTs, 0.01, 2);
    R.gap = R.gap === undefined ? d : R.gap + (d - R.gap) * 0.2;
  }
  R.lastTs = ts;
}
/**
 * How much further back than its sender's timeline to show something that's sent sparsely,
 * so it's always between two snapshots rather than off the end of them (eased: no jumps).
 */
function extraDelay(R, rdt) {
  const want = clamp((R.gap ?? 0) * 1.15 - MIN_DELAY, 0, 1.2);
  R.extra = R.extra === undefined ? want : R.extra + (want - R.extra) * Math.min(1, rdt * 1.5);
  return R.extra;
}

/**
 * One sender's timeline. Their clock maps onto ours by the smallest transit time seen (it can
 * only creep up slowly, as real clock drift), how late packets arrive past that sets how far
 * behind we play (a jitter buffer that grows on a bad connection and shrinks back when it
 * settles), and the playback clock itself runs smoothly at real time, nudged toward that
 * target - never stepped (a stepped clock is a teleport on every puppet at once).
 */
class Stream {
  constructor() {
    this.off = null;   // local - sender, at the fastest transit seen
    this.late = 0.03;  // how far past the fastest packets typically arrive (decaying peak)
    this.gap = 0.05;   // the sender's interval between packets
    this.lastTs = null;
    this.play = null;  // sender-time being shown
  }
  arrive(ts, t = now()) {
    const d = t - ts;
    if (this.off === null || d < this.off) this.off = d;
    else this.off += (d - this.off) * 0.002; // (real drift only: slow)
    const late = d - this.off;
    this.late = Math.max(this.late * 0.985, late);
    if (this.lastTs !== null && ts > this.lastTs) this.gap += (clamp(ts - this.lastTs, 0.01, 1) - this.gap) * 0.15;
    this.lastTs = ts;
  }
  get delay() { return clamp(this.gap * 1.25 + this.late * 1.1 + 0.02, MIN_DELAY, MAX_DELAY); }
  /** Advance the playback clock by real time rdt; the sender-time to show now. */
  tick(rdt, t = now()) {
    if (this.off === null) return null;
    const target = t - this.off - this.delay;
    if (this.play === null || Math.abs(target - this.play) > 0.6) this.play = target;
    else {
      // run a touch fast or slow (±10%) to close the difference: no visible jumps
      const err = target - this.play;
      this.play += rdt * (1 + clamp(err * 2, -0.1, 0.1));
    }
    return this.play;
  }
}

export class Session {
  /**
   * g: { scene, world, levelName, hero, npcs, vehicles, shots, props, bubbles, camera, sfx,
   *      addActor(a), removeActor(a), heldOf(a) -> {code, mesh}|null, itemMesh(code),
   *      onRemoteFire(o, d, by), onHostChange(isHost), carry }
   */
  constructor(g) {
    this.g = g;
    // (a handle for the console and for the settings panel's multiplayer section)
    try { window.__mp = this; } catch (e) { /* no window */ }
    this.net = new Net();
    this.players = new Map(); // conn id -> { id, name, actor, tag }
    this.pool = [];
    this.specials = new Map(); // username -> that special body, waiting for them to come back
    this.owner = new Map();   // car index -> conn id driving it
    this.clock = new Map();   // sender id -> Stream (their timeline on ours)
    this.wasHost = true;
    this.pT = this.wT = 0;
    this.wTick = 0;
    this.fullCars = true;
    this.muted = false;
    this.npcIndex = new Map(g.npcs.map((n, i) => [n.actor, i]));
    this.carIndex = new Map(g.vehicles.cars.map((c, i) => [c, i]));
    for (const n of g.npcs) n.actor.onRemoteHit = (...args) => this.forwardHit(n.actor, ...args);
    // throwing up (organs.js): the body's owner decides, everyone sees it come up
    for (const a of [g.hero, ...g.npcs.map((n) => n.actor)]) a.onVomit = (bloody) => { const id = this.ref(a); if (this.live && id !== null) this.send({ k: 'vomit', id, b: bloody ? 1 : 0 }); };
    // a body of ours flattened against the ground (wounds.js): the same crush on every copy
    for (const a of [g.hero, ...g.npcs.map((n) => n.actor)]) a.onDent = (part, p, n, o) => this.dented(a, part, p, n, o);
    // blood (or sick) from our people landing on anyone: the same stain on every copy of them
    this.stains = []; this.stainT = 0;
    if (g.blood) g.blood.onStain = (a, part, p, n, along, ink, sz, vomit) => this.stained(a, part, p, n, along, ink, sz, vomit);
    this.items = new ItemSync(this);
    // a body cut here: the same cut on everyone else's copy of it
    if (g.dismember) g.dismember.onCut = (a, part, pL, nL, vel, seed, gib) => this.cut(a, part, pL, nL, vel, seed, gib);
    this.tags = document.createElement('div');
    this.tags.id = 'tags';
    document.body.appendChild(this.tags);

    const N = this.net;
    N.on('welcome', (m) => this.welcome(m));
    N.on('join', (m) => { this.join(m.player); this.fullCars = true; this.items.snapshotTo(m.player.id); });
    N.on('left', (m) => this.left(m.id));
    N.on('look', (m) => this.onLook(m));
    // (our look goes out with every hello)
    this.net.lookFn = () => g.look?.() || null;
    N.on('host', () => this.roles());
    N.on('own', (m) => this.own(m));
    N.on('deny', (m) => this.deny(m));
    N.on('p', (m) => this.onPlayer(m));
    N.on('w', (m) => this.onWorld(m));
    N.on('e', (m) => this.onEvent(m));
    N.on('reset', () => this.dropAll());
    N.on('closed', () => this.dropAll());
    // how we're running, for the room (server.js): a hidden tab draws no frames, so as host it
    // would hold the whole world still for everyone; a slow one runs it in slow motion
    this.frames = 0; this.lastFrame = now(); this.stT = 0; this.sentAway = null;
    const status = () => this.status();
    setInterval(status, 1000);
    document.addEventListener('visibilitychange', status);
  }
  /** Tell the room whether we're here (drawing frames) and at what framerate. */
  status() {
    if (!this.live) { this.frames = 0; this.stT = now(); return; }
    const t = now(), span = t - this.stT;
    const away = document.hidden || t - this.lastFrame > 1;
    if (away === this.sentAway && span < 3) return;
    const fps = span > 0.5 ? Math.round(this.frames / span) : null;
    this.frames = 0; this.stT = t;
    this.sentAway = away;
    this.net.send({ t: 'st', away, fps: away ? null : fps });
  }

  get live() { return this.net.live; }
  get isHost() { return this.net.isHost; }
  get me() { return this.net.id; }
  /** Other players' bodies, for things that pick a person (shoves). */
  people() { return [...this.players.values()].map((p) => ({ actor: p.actor })); }

  connect() { return this.net.connect(this.g.levelName); }

  // ---------- ids ----------
  ref(a) {
    if (!a) return null;
    if (a === this.g.hero) return this.me;
    if (this.npcIndex.has(a)) return this.npcIndex.get(a);
    return a.netId ?? null;
  }
  actorOf(r) {
    if (r === null || r === undefined) return null;
    if (typeof r === 'number') return this.g.npcs[r]?.actor || null;
    if (r === this.me) return this.g.hero;
    return this.players.get(r)?.actor || null;
  }
  /** Whose simulation this body belongs to. */
  ownerOf(a) {
    if (a === this.g.hero) return this.me;
    if (this.npcIndex.has(a)) return this.net.host;
    return a.netId;
  }
  carLocal(i) {
    const o = this.owner.get(i);
    return o ? o === this.me : this.isHost;
  }

  // ---------- roster ----------
  welcome(m) {
    this.dropAll();
    this.sentAway = null; // (a fresh room: our status goes out again)
    this.sentLook = JSON.stringify(this.g.look?.() || null); // (it went with the hello)
    this.owner = new Map(m.owners);
    for (const p of m.players) this.join(p);
    this.roles();
    this.fullCars = true;
    // already at the wheel when we connected: that car's ours
    const h = this.g.hero;
    if (h.seat?.driver) this.entered(h.seat.car);
  }
  join(p) {
    if (p.id === this.me || this.players.has(p.id)) return;
    // (a special body - special.js - is its own actor, never handed to anyone else)
    // their look (sent with their hello): proportions build the body, the rest is restyled on.
    // (someone with a special body who's chosen to play a normal one says so: plain)
    const look = sanitizeLook(p.look);
    const special = p.look?.plain ? null : specialLook(p.name, p.look?.variant);
    const key = String(p.name).toLowerCase() + '#' + (special?.variant || 0) + '#' + SPECIAL_SHAPE.map((k) => look[k]).join();
    let a = special ? this.specials.get(key) : this.takePooled(look);
    if (special) this.specials.delete(key);
    else if (a) a.hero.restyle(look);
    if (!a) {
      a = new Actor(this.g.scene, this.g.world, { ...wearSpecial(look, special), wardrobe: true });
      a.isPlayer = true;
      this.g.addActor(a, true);
      a.onRemoteHit = (...args) => this.forwardHit(a, ...args);
    } else this.g.addActor(a, false);
    if (special) a.specKey = key;
    a.remote = true;
    a.unsever?.(); // (a recycled body: whole again)
    a.cutSeen = 0;
    a.netId = p.id;
    a.net = { buf: [] };
    a.hero.setVisible(false); // until the first snapshot lands (limbs and all)
    a.brain.dead = false;
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = p.name;
    this.tags.appendChild(tag);
    this.players.set(p.id, { id: p.id, name: p.name, actor: a, tag });
  }
  /** A pooled body built with these proportions (bodies can't be reshaped), or null. */
  takePooled(look) {
    const want = shapeOf(look);
    const i = this.pool.findIndex((a) => shapeOf(a.hero.look) === want);
    return i < 0 ? null : this.pool.splice(i, 1)[0];
  }
  /** Someone changed clothes / colours / hair. */
  onLook(m) {
    const P = this.players.get(m.id);
    if (!P) return;
    P.actor.hero.restyle(sanitizeLook(m.look));
  }
  /** Ours changed: tell everyone (only when it really did). */
  setLook(look) {
    const j = JSON.stringify(look);
    if (j === this.sentLook) return;
    this.sentLook = j;
    if (this.live) this.net.send({ t: 'look', look });
  }
    left(id) {
    const P = this.players.get(id);
    if (!P) return;
    this.players.delete(id);
    this.clock.delete(id);
    const a = P.actor;
    if (a.seat) { if (a.seat.occ === a) a.seat.occ = null; a.seat = null; }
    this.setItem(a, null);
    this.setItem(a, null, 1);
    // the whole body out of sight, and everything of theirs lying about gone with them: the
    // next player to get this pooled body must not inherit its pieces, cuts or wounds
    a.hero.setVisible(false);
    this.g.grabber?.releaseActor?.(a);
    this.g.tugged?.set(a, []);
    this.g.dismember?.dropActor?.(a);
    a.unsever?.();
    a.wounds?.heal();
    a.proxy.setEnabled(false);
    a.netId = null;
    this.g.removeActor(a);
    this.g.bubbles.live.get(a)?.el.remove();
    this.g.bubbles.live.delete(a);
    P.tag.remove();
    if (a.hero.look.fixed && a.specKey) this.specials.set(a.specKey, a);
    else this.pool.push(a);
  }
  /** Connection gone or restarting: back to a world of our own until the next welcome. */
  dropAll() {
    for (const id of [...this.players.keys()]) this.left(id);
    this.owner.clear();
    this.clock.clear();
    this.roles();
  }

  // ---------- who simulates what ----------
  roles() {
    const host = this.isHost, g = this.g;
    const flip = host !== this.wasHost;
    if (flip) {
      this.wasHost = host;
      for (const n of g.npcs) host ? this.adopt(n) : this.puppet(n);
    }
    for (const [i, c] of g.vehicles.cars.entries()) this.carRole(c, i);
    if (flip && host) {
      // cars NPCs were driving on the old host's say-so (their routes went with it): they get out
      for (const n of g.npcs) {
        const s = n.actor.seat;
        if (s?.driver && !s.car.remote) g.vehicles.giveUp(s.car);
      }
    }
    if (flip) g.onHostChange?.(host);
  }
  /** A pedestrian becomes someone else's puppet. */
  puppet(n) {
    const a = n.actor;
    n.convo?.end(true);
    if (a.mode === 'ragdoll') { a.brain.hands.reset(); a.rd.disable(); }
    a.hero.action?.stand?.(true);
    a.hero.action = null;
    a.gunHeld?.reset?.();
    a.meleeHeld?.reset?.();
    a.meleeHeldL?.reset?.();
    a.gunHeld = a.meleeHeld = a.meleeHeldL = null;
    a.hero.armHook = null;
    a.mode = 'anim';
    a.postSnap = null;
    a.pending = null;
    a.remote = true;
    a.net = { buf: [] };
  }
  /** A puppet pedestrian comes back under our own simulation, where it was last seen. */
  adopt(n) {
    const a = n.actor;
    a.remote = false;
    this.setItem(a, null);
    this.setItem(a, null, 1);
    const down = a.net?.down;
    a.net = null;
    if (a.seat) return;
    const h = a.hero;
    h.reset(h.pos.clone(), h.yaw);
    h.update(0.001, { move: V(), run: false, jump: false, camYaw: h.yaw - Math.PI });
    a.headLocal = null;
    a.capture(a.cur); a.capture(a.prev);
    if (down || a.brain.dead) a.goRagdoll('collapse');
  }
  carRole(c, i) {
    const local = this.carLocal(i);
    if (local === !c.remote) return;
    if (local) {
      // taking over the simulation: pick up where its snapshots left it, moving as it was
      c.setRemote(false);
      const last = c.net?.buf[c.net.buf.length - 1]?.s;
      if (last) this.carState(c, last, last, 0, true);
      c.net = null;
    } else {
      c.setRemote(true);
      c.net = { buf: [] };
      c.input = { throttle: 0, steer: 0, brake: 0, hand: false };
    }
  }
  own(m) {
    if (m.id) this.owner.set(m.car, m.id); else this.owner.delete(m.car);
    const c = this.g.vehicles.cars[m.car];
    if (!c) return;
    // handed back: held at the driver's last word on it until the new owner's snapshots come
    if (!m.id && m.s && c.net) c.net.buf = [{ ts: -Infinity, s: m.s }];
    if (m.id && m.id !== this.me && this.isHost) {
      // a player took the wheel of one of ours: the NPC at it is out
      const d = c.driver;
      if (d && !d.remote && d !== this.g.hero) this.g.vehicles.pullOut(d, c, this.players.get(m.id)?.actor);
      c.ai = null;
    }
    this.carRole(c, m.car);
  }
  deny(m) {
    // someone else got there first
    this.owner.delete(m.car);
    const h = this.g.hero, c = this.g.vehicles.cars[m.car];
    if (h.seat?.car === c && h.seat.driver) this.g.vehicles.exit(h);
    this.claimed = null;
    this.roles();
  }

  /** Our player just sat down in car c: at the wheel, it's ours to drive. */
  entered(c) {
    const i = this.carIndex.get(c);
    if (!this.live || i === undefined) return;
    if (!this.g.hero.seat?.driver) return;
    this.claimed = c;
    this.owner.set(i, this.me);
    this.carRole(c, i);
    this.net.send({ t: 'claim', car: i });
  }
  /** Which seat to take at this car's door: another player's car, you ride along. */
  seatFor(c) {
    const o = this.owner.get(this.carIndex.get(c));
    if (o && o !== this.me && this.players.has(o)) return c.seats.findIndex((s, i) => i > 0 && !s.occ);
    return 0;
  }

  // ---------- snapshots out ----------
  actorState(a) {
    // (down, the feet position stays where they fell: where the body is now counts)
    const h = a.hero, s = { p: vec(a.mode === 'ragdoll' ? a.focus() : h.pos), y: q3(h.yaw), f: (a.brain.dead ? 1 : 0) | (a.mode === 'ragdoll' ? 2 : 0) | (a.burnT > 0 ? 4 : 0) | (a.god ? 8 : 0) | (a.eyeBlood ? 16 : 0) | (a.laserOn ? 32 : 0) | (a.guard ? 64 : 0) | (a.poofed ? 128 : 0) | (a.wingFlying ? 256 : 0) };
    // (admin.js: laser eyes on - what they're burning into)
    if (a.laserOn && a.laserAt) s.l = vec(a.laserAt);
    if (a.seat) s.s = [this.carIndex.get(a.seat.car), a.seat.car.seats.indexOf(a.seat)];
    else s.k = encPose(a);
    if (a.cutGen) s.c = a.cutGen;
    if (a._cut?.count) s.x = a._cut.count;
    const held = this.g.heldOf(a);
    if (held) {
      const m = held.mesh;
      m.getWorldPosition(_v);
      m.getWorldQuaternion(_qa);
      s.h = [held.code, q3(_v.x), q3(_v.y), q3(_v.z), q4(_qa.x), q4(_qa.y), q4(_qa.z), q4(_qa.w)];
    }
    // (a second weapon, in the left hand)
    const L2 = a.meleeHeldL;
    if (L2) {
      L2.mesh.getWorldPosition(_v);
      L2.mesh.getWorldQuaternion(_qa);
      s.h2 = [L2.type, q3(_v.x), q3(_v.y), q3(_v.z), q4(_qa.x), q4(_qa.y), q4(_qa.z), q4(_qa.w)];
    }
    return s;
  }
  carOut(c) {
    const p = c.p, q = c.q, v = c.v;
    return [q3(p.x), q3(p.y), q3(p.z), q4(q.x), q4(q.y), q4(q.z), q4(q.w), Math.round(v.x * 100), Math.round(v.y * 100), Math.round(v.z * 100),
      q3(c.steerA), (c.braking ? 1 : 0) | (c.m.windshield.visible ? 0 : 2)];
  }

  update(dt) {
    // The Multiplayer Arena is the networked place: you join on the way in and leave on the way
    // out (a room is a level - see multiplayer/net.js). Every other level is single player,
    // exactly as it was.
    const arena = !!(this.g.level && this.g.level.mpArena);
    if (arena && !this.net.want) this.connect();
    else if (!arena && this.net.want) this.net.close();
    // a map change while online is a different room: move over, then carry on
    if (this.net.live && this.net.level && this.g.levelName !== this.net.level) { this.net.connect(this.g.levelName); return; }
    if (!this.live) return;
    this.flushStains(dt);
    this.applyPuppets();
    this.releaseCheck();
  }
  /** After the frame's simulation: send what we own, put name tags over heads. */
  post(dt) {
    if (!this.live) { this.tags.style.display = 'none'; return; }
    this.tags.style.display = '';
    const t = now(), g = this.g;
    this.frames++; this.lastFrame = t;
    if (t - this.pT >= P_DT) {
      this.pT = t;
      const m = { t: 'p', ts: Math.round(t * 1000) / 1000, a: this.actorState(g.hero) };
      const cs = [];
      for (const [i, id] of this.owner) if (id === this.me) cs.push([i, this.carOut(g.vehicles.cars[i])]);
      if (cs.length) m.c = cs;
      this.net.send(m);
    }
    if (this.isHost && this.players.size && t - this.wT >= W_DT) {
      this.wT = t;
      this.wTick++;
      const others = [...this.players.values()].map((p) => p.actor.hero.pos);
      const n = [];
      for (const [i, npc] of g.npcs.entries()) {
        const a = npc.actor, p = a.hero.pos;
        const near = others.some((o) => Math.abs(o.x - p.x) < NEAR && Math.abs(o.z - p.z) < NEAR);
        // (someone standing about - or lying still - changes slowly: sent less often, and
        // shown further back on the other end so it's still smooth)
        const sp = a._sentP || (a._sentP = V(1e9, 0, 0));
        const still = sp.distanceToSquared(p) < 0.0016 && !a.hero.action;
        const every = near ? (still ? 3 : 1) : (still ? 8 : 4);
        if (every > 1 && this.wTick % every !== i % every) continue;
        sp.copy(p);
        n.push([i, this.actorState(a)]);
      }
      const c = [];
      const full = this.fullCars || this.wTick % 30 === 0;
      this.fullCars = false;
      for (const [i, car] of g.vehicles.cars.entries()) {
        if (this.owner.has(i)) continue;
        if (SKIP_SLEEPING_CARS && !full && car.body.isSleeping()) continue;
        c.push([i, this.carOut(car)]);
      }
      const m = { t: 'w', ts: Math.round(t * 1000) / 1000, n, c };
      if (g.level.nav?.t !== undefined) m.sig = Math.round(g.level.nav.t * 100) / 100;
      this.net.send(m);
    }
    this.items.poll();
    this.placeTags();
  }

  /** Left the driver's seat of a car we'd claimed: hand it back. */
  releaseCheck() {
    const c = this.claimed;
    if (!c) return;
    const h = this.g.hero;
    if (h.seat?.car === c && h.seat.driver) return;
    this.claimed = null;
    const i = this.carIndex.get(c);
    if (this.owner.get(i) !== this.me) return;
    this.owner.delete(i);
    this.net.send({ t: 'release', car: i, s: this.carOut(c) });
    // the host carries on with it from here
    if (!this.isHost) {
      this.carRole(c, i);
      push(c.net.buf, -Infinity, this.carOut(c));
    }
  }

  // ---------- snapshots in ----------
  /** A packet from `id` stamped `ts` (their clock) just arrived. */
  stamp(id, ts) {
    let S = this.clock.get(id);
    if (!S) this.clock.set(id, (S = new Stream()));
    S.arrive(ts);
    return S;
  }
  /** Sender-time to show `id`'s things at, this frame (null: nothing from them yet). */
  showT(id) { return this.times?.get(id) ?? null; }

  onPlayer(m) {
    const P = this.players.get(m.id);
    if (!P) return;
    this.stamp(m.id, m.ts);
    note(P.actor.net, m.ts);
    push(P.actor.net.buf, m.ts, m.a);
    if (m.c) for (const [i, s] of m.c) {
      const c = this.g.vehicles.cars[i];
      if (c?.net && this.owner.get(i) === m.id) { carFrom(c.net, m.id); note(c.net, m.ts); push(c.net.buf, m.ts, s); }
    }
  }
  onWorld(m) {
    if (this.isHost) return;
    const host = this.net.host;
    this.stamp(host, m.ts);
    for (const [i, s] of m.n) {
      const a = this.g.npcs[i]?.actor;
      if (a?.net) { note(a.net, m.ts); push(a.net.buf, m.ts, s); }
    }
    for (const [i, s] of m.c) {
      const c = this.g.vehicles.cars[i];
      if (c?.net && !this.owner.has(i)) { carFrom(c.net, host); note(c.net, m.ts); push(c.net.buf, m.ts, s); }
    }
    if (m.sig !== undefined && this.g.level.nav) this.g.level.nav.t = m.sig;
  }

  /** Every puppet posed where its owner had it a (per-sender, adaptive) moment ago. */
  applyPuppets() {
    const g = this.g, t = now();
    // real time since last frame (the game's dt freezes for hit-stop; the network doesn't)
    const rdt = clamp(t - (this.lastApply ?? t), 0, 0.1);
    this.lastApply = t;
    const times = (this.times ||= new Map());
    times.clear();
    for (const [id, S] of this.clock) { const T = S.tick(rdt, t); if (T !== null) times.set(id, T); }
    for (const P of this.players.values()) this.applyActor(P.actor, this.showT(P.id), rdt);
    if (!this.isHost) {
      const T = this.showT(this.net.host);
      for (const n of g.npcs) this.applyActor(n.actor, T, rdt);
    }
    for (const c of g.vehicles.cars) {
      if (!c.remote || !c.net?.buf.length) continue;
      this.applyCar(c, this.showT(c.net.from), rdt);
    }
  }
  applyCar(c, T, rdt) {
    const R = c.net;
    if (T === null) T = R.buf[R.buf.length - 1].ts; // (only a hand-over state: hold it)
    const b = sample(R.buf, T - extraDelay(R, rdt), 0.35);
    const jump = Math.abs(b.A[0] - b.B[0]) + Math.abs(b.A[2] - b.B[2]) > 8000;
    if (jump) { R.shownOk = false; this.carState(c, b.A, b.B, Math.round(b.k), true); return; }
    this.carFollow(c, b, rdt);
  }
  /**
   * A remote car between its snapshots: position along a curve through both that matches the
   * velocity at each end (Hermite: a turning car arcs instead of cutting corners), past the
   * newest carried on at its velocity, and the kinematic body eased onto that.
   */
  carFollow(c, b, rdt) {
    const A = b.A, B = b.B, R = c.net, k = b.k, T = b.span;
    const tgt = _v2;
    const va = _v.set(A[7], A[8], A[9]).divideScalar(100);
    const vb = (R.vb ||= V()).set(B[7], B[8], B[9]).divideScalar(100);
    if (b.ext > 0 || T <= 0) tgt.set(B[0] / 1000, B[1] / 1000, B[2] / 1000).addScaledVector(vb, b.ext);
    else {
      const k2 = k * k, k3 = k2 * k;
      const h00 = 2 * k3 - 3 * k2 + 1, h10 = k3 - 2 * k2 + k, h01 = -2 * k3 + 3 * k2, h11 = k3 - k2;
      tgt.set(
        h00 * A[0] / 1000 + h10 * T * va.x + h01 * B[0] / 1000 + h11 * T * vb.x,
        h00 * A[1] / 1000 + h10 * T * va.y + h01 * B[1] / 1000 + h11 * T * vb.y,
        h00 * A[2] / 1000 + h10 * T * va.z + h01 * B[2] / 1000 + h11 * T * vb.z);
    }
    _qa.set(A[3], A[4], A[5], A[6]).normalize();
    _qb.set(B[3], B[4], B[5], B[6]).normalize();
    _qa.slerp(_qb, k);
    const vel = (c.netV ||= V()).copy(va).lerp(vb, k);
    const shown = (R.shown ||= V()), shownQ = (R.shownQ ||= Q());
    if (!R.shownOk || shown.distanceToSquared(tgt) > SNAP * SNAP * 4) { shown.copy(tgt); shownQ.copy(_qa); R.shownOk = true; }
    else {
      shown.addScaledVector(vel, rdt).lerp(tgt, 1 - Math.exp(-rdt * 10));
      shownQ.slerp(_qa, 1 - Math.exp(-rdt * 14));
    }
    const body = c.body, t = body.translation(), r = body.rotation();
    const moved = Math.abs(t.x - shown.x) + Math.abs(t.y - shown.y) + Math.abs(t.z - shown.z) > 1e-4
      || Math.abs(r.x - shownQ.x) + Math.abs(r.y - shownQ.y) + Math.abs(r.z - shownQ.z) + Math.abs(r.w - shownQ.w) > 1e-4;
    if (moved) {
      body.setNextKinematicTranslation(shown);
      body.setNextKinematicRotation(shownQ);
      c.dirty = true;
    }
    c.steerA = (A[10] + (B[10] - A[10]) * k) / 1000;
    c.input.brake = (B[11] & 1) ? 1 : 0;
    if ((B[11] & 2) && c.m.windshield.visible) this.g.vehicles.shatter(c);
  }
  applyActor(a, T, rdt) {
    const R = a.net;
    if (!R || !R.buf.length) return;
    if (T === null) T = R.buf[R.buf.length - 1].ts;
    const b = sample(R.buf, T - extraDelay(R, rdt), 0.25);
    const A = b.A, B = b.B, h = a.hero;
    // a jump (respawned, recycled across the map): no sliding there
    const jump = Math.abs(A.p[0] - B.p[0]) + Math.abs(A.p[2] - B.p[2]) > 4000;
    const k = jump ? Math.round(b.k) : b.k;
    const S = k < 0.5 ? A : B;
    a.brain.dead = !!(S.f & 1);
    R.down = !!(S.f & 2);
    a.burnVis = !!(S.f & 4);
    // admin powers (admin.js): god mode, blood from the eyes, laser eyes and where they're looking
    a.god = !!(S.f & 8);
    a.eyeBlood = !!(S.f & 16);
    a.guard = !!(S.f & 64); // (blocking with a melee weapon: melee.js blocks)
    a.wingFlying = !!(S.f & 256);
    // gone up in hearts (the admin menu's Heart click): hidden, and the burst the moment it goes
    const poof = !!(S.f & 128);
    if (poof && !a.poofed && !a.poofSeen) this.g.onPoof?.(a);
    a.poofed = poof;
    if (!poof) a.poofSeen = false;
    a.laserOn = !!(S.f & 32) && !!S.l;
    if (a.laserOn) (a.laserAt ||= new THREE.Vector3()).set(S.l[0] / 1000, S.l[1] / 1000, S.l[2] / 1000);
    // they were put back together (respawned): so is our copy of them
    if ((S.c || 0) > (a.cutSeen || 0)) { a.cutSeen = S.c; a.unsever?.(); R.cutBad = R.cutTries = 0; }
    // our copy is missing cuts the owner has: for a moment that's just the cut on its way; any
    // longer, ask for theirs again. (Not put back to whole first: that brought the original limb
    // back beside the piece already flown off and took the stump's faces away; a cut we already
    // have is refused when replayed, so only the missing ones land. A copy with MORE cuts than
    // the owner is left alone: a respawn - S.c above - is what makes it whole.)
    else if ((S.x || 0) > (a._cut?.count || 0)) {
      R.cutBad = (R.cutBad || 0) + 1;
      if (R.cutBad > 90 && (R.cutTries || 0) < 3) {
        R.cutBad = -200; // (then give the replay time to land)
        R.cutTries = (R.cutTries || 0) + 1;
        console.warn('[gore] cuts out of step with the owner: theirs', S.x, 'ours', a._cut?.count || 0, '- asking for a replay');
        const id = this.ref(a), to = this.ownerOf(a);
        if (id !== null && to) this.send({ k: 'cutsync', id, to });
      }
    } else if (R.cutBad > 0) R.cutBad = R.cutTries = 0;
    else if (R.cutBad < 0) R.cutBad++;
    if (h.shown === !!a.poofed) h.setVisible(!a.poofed);
    // the seat
    const car = S.s ? g_car(this, S.s[0]) : null;
    const want = car ? car.seats[S.s[1]] : null;
    if (a.seat !== want) {
      if (a.seat) { if (a.seat.occ === a) a.seat.occ = null; a.seat = null; }
      if (want && (!want.occ || want.occ.remote)) {
        if (want.occ) want.occ.seat = null;
        want.occ = a;
        a.seat = want;
        a.postSnap = null;
      }
    }
    // feet and heading
    const pa = A.p, pb = B.p;
    const x = (pa[0] + (pb[0] - pa[0]) * k) / 1000, y = (pa[1] + (pb[1] - pa[1]) * k) / 1000, z = (pa[2] + (pb[2] - pa[2]) * k) / 1000;
    // their velocity, from the snapshots either side (steady: not from our frame-to-frame)
    const vel = R.vel || (R.vel = V());
    if (b.span > 0 && !jump) vel.set(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]).divideScalar(1000 * b.span).clampLength(0, 25);
    else vel.set(0, 0, 0);
    // where they are now: between snapshots, or (a packet late) carried on along that velocity
    const tgt = _v2.set(x, y, z).addScaledVector(vel, b.ext);
    // shown: follows the target smoothly (a correction glides in over a few frames instead of
    // popping); a big one - a respawn - snaps
    const shown = R.shown || (R.shown = V());
    if (!R.shownOk || jump || a.seat || shown.distanceToSquared(tgt) > SNAP * SNAP) { shown.copy(tgt); R.shownOk = true; }
    else {
      shown.addScaledVector(vel, rdt);
      shown.lerp(tgt, 1 - Math.exp(-rdt * 9));
    }
    // (the whole body moves with that: everything is shifted by where shown is vs the snapshot)
    const shift = R.shift || (R.shift = V());
    shift.set(shown.x - x, shown.y - y, shown.z - z);
    if (!a.seat) h.vel.copy(vel);
    h.pos.copy(shown);
    h.yaw = lerpAng(A.y / 1000, B.y / 1000, k);
    h.grounded = true;
    // the body (seated: the car poses it, in Vehicles.seatFrame)
    if (!a.seat && (A.k || B.k)) {
      const t = a.prev; a.prev = a.cur; a.cur = t;
      const grip = R.grip || (R.grip = [0.3, 0.3]);
      a.headLocal ||= Q();
      decPose(A.k || B.k, B.k || A.k, k, R.pose || (R.pose = {}), a.headLocal, grip);
      if (shift.lengthSq() > 1e-10) for (const n of PARTS) R.pose[n].pos.add(shift);
      a.pinJoints?.(R.pose, 0.1);
      a.apply(R.pose);
      h.arms[0].grip = grip[0]; h.arms[1].grip = grip[1];
      a.setGrip(grip, 1);
      a.capture(a.cur);
    }
    // what's in their hand
    // what's in their hands (the right, and a second weapon in the left)
    for (const [slot, key] of [[0, 'h'], [1, 'h2']]) {
      const ha = A[key] && B[key] && A[key][0] === B[key][0] ? A[key] : null;
      const hs = S[key];
      this.setItem(a, hs ? hs[0] : null, slot);
      const item = slot ? R.item2 : R.item;
      if (hs && item) {
        const hb = ha ? B[key] : hs, h0 = ha || hs;
        item.position.set((h0[1] + (hb[1] - h0[1]) * k) / 1000, (h0[2] + (hb[2] - h0[2]) * k) / 1000, (h0[3] + (hb[3] - h0[3]) * k) / 1000).add(shift);
        _qa.set(h0[4], h0[5], h0[6], h0[7]).normalize();
        _qb.set(hb[4], hb[5], hb[6], hb[7]).normalize();
        item.quaternion.slerpQuaternions(_qa, _qb, k);
        this.runWeaponBlood(R, slot, item, rdt);
      }
    }
  }
  setItem(a, code, slot = 0) {
    const R = a.net || {};
    const I = slot ? 'item2' : 'item', C = slot ? 'itemCode2' : 'itemCode', B = slot ? 'wb2' : 'wb';
    if ((R[C] || null) === (code || null)) return;
    R[B]?.clear();
    R[B] = null;
    if (R.wbs) R.wbs[slot] = null;
    R[I]?.removeFromParent();
    R[I] = null;
    R[C] = code || null;
    if (!code) return;
    const m = this.g.itemMesh(code);
    if (!m) return;
    this.g.scene.add(m);
    R[I] = m;
    // a melee weapon in their hand bloodies, runs, drips and flings it off just like our own
    // (weaponblood.js), fed by the blows it's seen landing here (bloodyWeapon)
    if (WEAPONS[code] && this.g.blood) R[B] = new WeaponBlood(m, WEAPONS[code], this.g.blood);
  }
  /** Their weapon this frame: how it moved (from where it's drawn) drives the running, dripping and cast-off. */
  runWeaponBlood(R, slot, item, rdt) {
    const wb = slot ? R.wb2 : R.wb;
    if (!wb) return;
    item.updateMatrixWorld(true);
    const st = ((R.wbs ||= [null, null])[slot] ||= { p: V(), t: V(), vel: V(), tipVel: V(), ok: false });
    const tip = _v.set(0, wb.def.seg[1], 0).applyMatrix4(item.matrixWorld);
    if (st.ok && rdt > 1e-3) {
      st.vel.subVectors(item.position, st.p).divideScalar(rdt);
      st.tipVel.subVectors(tip, st.t).divideScalar(rdt);
      // (a jump - a respawn, a snap - isn't a swing)
      if (st.vel.lengthSq() > 1600 || st.tipVel.lengthSq() > 3600) { st.vel.set(0, 0, 0); st.tipVel.set(0, 0, 0); }
    } else { st.vel.set(0, 0, 0); st.tipVel.set(0, 0, 0); }
    st.p.copy(item.position); st.t.copy(tip); st.ok = true;
    wb.update(rdt, st.vel, st.tipVel);
  }
  /**
   * Another player's melee blow landed on `victim` (our copy of someone, or our own body): blood
   * onto their weapon where it went in, as much as it comes away with on their screen (melee.js land).
   */
  bloodyWeapon(victim, h, x) {
    if (h !== 'struck' || !victim || !Array.isArray(x)) return;
    const by = this.actorOf(x[5]), R = by?.remote ? by.net : null;
    if (!R) return;
    const w = x[4] || {};
    for (const slot of [0, 1]) {
      const code = slot ? R.itemCode2 : R.itemCode, wb = slot ? R.wb2 : R.wb, def = WEAPONS[code];
      // (their blow with this weapon - not a kick or a punch while it's in the other hand)
      if (!wb || !def || w.mass !== def.hit.mass || w.ref !== def.hit.ref) continue;
      const k = clamp(unvec(x[2], _v).length() / 12, 0.4, 1);
      const power = def.hit.sev && w.sev ? w.sev / def.hit.sev : 1;
      const wet = victim.wounds?.parts[x[0]]?.wet || 0;
      const amt = def.hit.kind === 'blade' ? 0.45 + 0.35 * k * power : wet * 0.6 * k;
      const G = victim.groups[x[0]] || victim.groups.pelvis;
      G.updateWorldMatrix(true, false);
      wb.add(G.localToWorld(unvec(x[1])), amt, inkOf(victim));
      return;
    }
  }
  /** Snapshot pose A -> B by k onto a car (kinematic while remote; `teleport` when taking it over). */
  carState(c, A, B, k, teleport) {
    const l = (j) => (A[j] + (B[j] - A[j]) * k);
    _v.set(l(0) / 1000, l(1) / 1000, l(2) / 1000);
    _qa.set(A[3], A[4], A[5], A[6]).normalize();
    _qb.set(B[3], B[4], B[5], B[6]).normalize();
    _qa.slerp(_qb, k);
    const b = c.body;
    // (a kinematic body's own velocity is gone by the end of the physics step: keep the driver's)
    (c.netV ||= V()).set(l(7) / 100, l(8) / 100, l(9) / 100);
    if (teleport) {
      b.setTranslation(_v, true);
      b.setRotation(_qa, true);
      if (!c.remote) b.setLinvel(c.netV, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      c.dirty = true;
    } else {
      const t = b.translation(), r = b.rotation();
      const moved = Math.abs(t.x - _v.x) + Math.abs(t.y - _v.y) + Math.abs(t.z - _v.z) > 1e-4
        || Math.abs(r.x - _qa.x) + Math.abs(r.y - _qa.y) + Math.abs(r.z - _qa.z) + Math.abs(r.w - _qa.w) > 1e-4;
      if (moved) {
        b.setNextKinematicTranslation(_v);
        b.setNextKinematicRotation(_qa);
        c.dirty = true;
      }
      c.steerA = l(10) / 1000;
      c.input.brake = (B[11] & 1) ? 1 : 0;
    }
    if ((B[11] & 2) && c.m.windshield.visible) this.g.vehicles.shatter(c);
  }

  // ---------- events ----------
  send(e) { if (this.live) this.net.send({ t: 'e', ...e }); }

  /** A bandage / tourniquet on someone (med.js): the owner treats it, everyone sees it. True if it's theirs to treat. */
  med(a, kind, part) {
    if (!this.live) return false;
    const to = this.ownerOf(a), id = this.ref(a);
    if (id === null) return false;
    this.send({ k: 'med', to, id, h: kind, p: part });
    return !!to && to !== this.me;
  }

  /** A hit landed on someone else's body: tell its owner. */
  forwardHit(a, kind, ...args) {
    if (this.muted || !this.live) return;
    const to = this.ownerOf(a);
    if (!to || to === this.me) return;
    const loc = (name, p) => { const G = a.groups[name] || a.groups.pelvis; G.updateWorldMatrix(true, false); return vec(G.worldToLocal(_v.copy(p))); };
    let x;
    if (kind === 'shot') x = [args[0], loc(args[0], args[1]), vec(args[2])];
    else if (kind === 'struck') {
      const [name, point, vel, n, w, by] = args;
      const ws = { ...w };
      if (w.axis?.isVector3) ws.axis = vec(w.axis);
      x = [name, loc(name, point), vec(vel), vec(n), ws, this.ref(by)];
    } else if (kind === 'guard') x = [vec(args[0]), Math.round((args[1] || 1) * 100) / 100, this.ref(args[2])];
    else x = [vec(args[0])];
    this.send({ k: 'hit', to, id: this.ref(a), h: kind, x });
  }
  /** One of our bodies was crushed in by something that isn't a hit (a fall): tell everyone. */
  dented(a, part, p, n, o) {
    if (!this.live || this.muted || a.remote) return;
    const id = this.ref(a), G = a.groups[part];
    if (id === null || !G) return;
    G.updateWorldMatrix(true, false);
    const nl = _v2.copy(n).applyQuaternion(G.getWorldQuaternion(_qa).invert());
    this.send({ k: 'dent', id, part, p: vec(G.worldToLocal(_v.copy(p))), n: [q4(nl.x), q4(nl.y), q4(nl.z)],
      o: { depth: q4(o.depth), R: q4(o.R), cap: q4(o.cap), flat: o.flat ? 1 : 0 } });
  }
  /** A drop of our people's landed on a (any) body here: queued for everyone else's copy of it. */
  stained(a, part, p, n, along, ink, sz, vomit) {
    if (!this.live || this.muted || this.stains.length >= 24 || typeof ink !== 'number') return;
    const id = this.ref(a), G = a.groups?.[part];
    if (id === null || !G) return;
    G.updateWorldMatrix(true, false);
    const iq = G.getWorldQuaternion(_qa).invert();
    const nl = _v2.copy(n).applyQuaternion(iq);
    const al = along.clone().normalize().applyQuaternion(iq);
    this.stains.push([id, part, vec(G.worldToLocal(_v.copy(p))), [q4(nl.x), q4(nl.y), q4(nl.z)], [q3(al.x), q3(al.y), q3(al.z)], ink, q4(sz), vomit ? 1 : 0]);
  }
  flushStains(dt) {
    if ((this.stainT -= dt) > 0 || !this.stains.length) return;
    this.stainT = 0.15;
    this.send({ k: 'stn', s: this.stains.splice(0, 16) });
  }
  /** Someone else's blood on a body, as it landed on their screen. */
  landStains(list) {
    if (!Array.isArray(list)) return;
    for (const x of list.slice(0, 16)) {
      const a = this.actorOf(x[0]), part = x[1], W = a?.wounds, G = a?.groups?.[part];
      if (!W?.parts[part] || !G || typeof x[5] !== 'number') continue;
      freshMatrices(a);
      G.updateWorldMatrix(true, false);
      const q = G.getWorldQuaternion(_qa);
      const p = G.localToWorld(unvec(x[2]));
      const n = new THREE.Vector3(x[3][0], x[3][1], x[3][2]).divideScalar(10000).applyQuaternion(q).normalize();
      const along = new THREE.Vector3(x[4][0], x[4][1], x[4][2]).divideScalar(1000).applyQuaternion(q);
      const ink = x[5], sz = Math.min(0.08, Math.max(0.002, x[6] / 10000)), vomit = !!x[7];
      try {
        if (ink === inkOf(a) && !vomit) W.stamp(part, p, n, along, 'splash', sz, sz * (0.6 + Math.random() * 0.4), 0.8);
        else W.splashForeign(part, p, n, along, ink, sz, vomit ? 0.9 : 0.8);
        if (!vomit) W.wetPart(W.parts[part], 0.03, ink);
      } catch { /* (an ink this copy doesn't know) */ }
    }
  }
  /** Someone else's body (a player, or the host's pedestrian) to go up in hearts: its owner does it. */
  poof(a) {
    if (!this.live) return;
    const to = this.ownerOf(a), id = this.ref(a);
    if (to && id !== null && to !== this.me) this.send({ k: 'poof', to, id });
  }
  /** Replay a (serialized) hit on actor a. */
  landHit(a, h, x) {
    // (the wound is laid on the meshes where they're drawn now: limbs too, not the last render)
    freshMatrices(a);
    const pt = (name, l) => { const G = a.groups[name] || a.groups.pelvis; G.updateWorldMatrix(true, false); return G.localToWorld(unvec(l)); };
    if (h === 'shot') a.shot(x[0], pt(x[0], x[1]), unvec(x[2]));
    else if (h === 'struck') {
      const w = { ...x[4] };
      if (Array.isArray(w.axis)) w.axis = unvec(w.axis);
      return a.struck(x[0], pt(x[0], x[1]), unvec(x[2]), unvec(x[3]), w, this.actorOf(x[5]));
    } else if (h === 'guard') guardHit(a, unvec(x[0]), this.actorOf(x[2]), x[1], this.g.sfx);
    else if (h === 'shove') a.shove(unvec(x[0]));
  }
  /** Our hands on someone else's body (grabbing.js): its owner does the pulling. */
  tug(a, grips, done = false, fling = null) {
    if (!this.live || this.muted) return;
    const to = this.ownerOf(a);
    if (!to || to === this.me) return;
    const G = done ? [] : grips.map((g) => [g.name, vec(g.local), vec(g.T), vec(g.vT), g.str || 1]);
    this.send({ k: 'tug', to, id: this.ref(a), g: G, ...(fling ? { v: vec(fling) } : {}) });
  }
  /** An emote from the wheel (null: stopped), `to` whoever it's aimed at (a high five). */
  emote(e, to = null) {
    if (!this.live) return;
    const id = this.ref(this.g.hero);
    if (id === null) return;
    this.send({ k: 'emote', id, e, w: to ? this.ref(to) : null });
  }
  onEvent(m) {
    const g = this.g;
    switch (m.k) {
      // turn our body into hearts (someone's Heart click on their copy of it)
      case 'poof': {
        if (m.to !== this.me) return;
        const a = this.actorOf(m.id);
        if (a && !a.remote) this.g.poof?.(a, true);
        return;
      }
      case 'vomit': {
        const a = this.actorOf(m.id);
        if (a && a !== g.hero && this.ownerOf(a) !== this.me) a.organs?.vomit(!!m.b);
        return;
      }
      case 'emote': {
        const a = this.actorOf(m.id);
        if (!a?.remote) return;
        g.onRemoteEmote?.(a, m.e || null, m.w != null ? this.actorOf(m.w) : null);
        return;
      }
      case 'stn': this.landStains(m.s); return;
      case 'tug': {
        if (m.to !== this.me) return;
        const a = this.actorOf(m.id);
        if (!a || a.remote || !g.tugged) return;
        g.tugged.set(a, (m.g || []).filter((x) => a.rd.parts[x[0]]).map((x) => ({ name: x[0], local: unvec(x[1]), T: unvec(x[2]), vT: unvec(x[3]), str: Math.min(4, Math.max(1, +x[4] || 1)) })), m.v ? unvec(m.v) : null);
        return;
      }
      case 'hit': {
        if (m.to !== this.me) return;
        const a = this.actorOf(m.id);
        if (!a || a.remote) return;
        const r = this.landHit(a, m.h, m.x);
        if (r !== 'guard') this.bloodyWeapon(a, m.h, m.x);
        // everyone but the hitter (who already shows it) sees the same wound (or, caught on our
        // guard after all - their copy of us hadn't got it up yet - the clang)
        if (r === 'guard') this.send({ k: 'wnd', id: m.id, h: 'guard', x: [m.x[2], 1, m.x[5]] });
        else if (m.h !== 'shove') this.send({ k: 'wnd', id: m.id, h: m.h, x: m.x, skip: m.from });
        return;
      }
      case 'wnd': {
        if (m.skip === this.me) return;
        const a = this.actorOf(m.id);
        if (!a?.remote) return;
        this.muted = true;
        try { this.landHit(a, m.h, m.x); } finally { this.muted = false; }
        this.bloodyWeapon(a, m.h, m.x);
        return;
      }
      case 'fire': {
        const by = this.actorOf(m.by);
        g.onRemoteFire(unvec(m.o), unvec(m.d).normalize(), by);
        return;
      }
      case 'prop': {
        const p = g.props.list[m.i];
        if (!p || p.broken) return;
        this.muted = true;
        try { g.props.break(p, unvec(m.v), m.at ? unvec(m.at) : null, m.w !== 0); } finally { this.muted = false; }
        p._ns = { auth: false, settled: true, rxT: now() };
        return;
      }
      case 'throw':
        g.onRemoteThrow?.(m.ty, unvec(m.p), unvec(m.v), unvec(m.s));
        return;
      case 'cut': this.onCut(m); return;
      case 'dent': {
        const a = this.actorOf(m.id), G = a?.groups?.[m.part];
        if (!a?.remote || !G || !a.wounds) return;
        freshMatrices(a);
        const p = G.localToWorld(unvec(m.p));
        const n = V().set(m.n[0] / 1e4, m.n[1] / 1e4, m.n[2] / 1e4).applyQuaternion(G.getWorldQuaternion(_qa)).normalize();
        const o = m.o || {};
        a.wounds.dent(m.part, p, n, { depth: clamp(o.depth / 1e4, 0, 0.08), R: clamp(o.R / 1e4, 0.01, 0.2), cap: clamp(o.cap / 1e4, 0, 0.1), flat: !!o.flat });
        return;
      }
      case 'cutsync': {
        // someone's copy of one of ours went wrong: the cuts it really has, to them only
        if (String(m.to) !== String(this.me)) return;
        const a = this.actorOf(m.id);
        if (!a || a.remote) return;
        for (const c of a.cutLog || []) this.send({ ...c, to: String(m.from), g: a.cutGen || 0 });
        return;
      }
      case 'nade': if (m.by !== this.me) g.onNade?.(m, this.actorOf(m.by)); return;
      case 'sv': case 'svGo': case 'svRevive': case 'svDoor': g.onSurvival?.(m); return;
      case 'cash': case 'cashTake': g.onCash?.(m); return;
      case 'turn': g.onTurn?.(m); return;
      case 'tie': if (String(m.from) !== String(this.me)) g.onTie?.(m); return;
      case 'med': if (String(m.from) !== String(this.me)) g.onMed?.(m, this.actorOf(m.id), m.to === this.me); return;
      case 'say': {
        const a = this.actorOf(m.id);
        const to = m.w != null ? this.actorOf(m.w) : null;
        if (a) { this.muted = true; try { g.bubbles.say(a, m.x, { dur: m.d, tone: m.o, to }); } finally { this.muted = false; } }
        return;
      }
      default: this.items.onEvent(m);
    }
  }
  /** A shot fired by someone whose simulation is ours. */
  fired(origin, dir, shooter) {
    if (!this.live || !shooter || shooter.remote) return;
    this.send({ k: 'fire', o: vec(origin), d: vec(dir), by: this.ref(shooter) });
  }
  threw(type, p, v, spin) {
    if (this.live) this.send({ k: 'throw', ty: type, p: vec(p), v: vec(v), s: vec(spin) });
  }
  propBroke(p, vel, at, wreck = true) {
    if (!this.live || this.muted) return;
    const i = this.g.props.list.indexOf(p);
    if (i < 0) return;
    this.send({ k: 'prop', i, v: vec(vel), at: at ? vec(at) : null, w: wreck ? 1 : 0 });
    this.items.propMoved(p);
  }
  /** We cut a body (ours, or a copy of someone else's): send the cut, in the part's own frame. */
  cut(a, part, pL, nL, vel, seed, gib = false) {
    if (!this.live) return;
    const id = this.ref(a);
    if (id === null) return;
    const x = gib ? 1 : 0;
    if (!a.remote) this.logCut(a, { k: 'cut', id, part, seed, x, p: [q4(pL.x), q4(pL.y), q4(pL.z)], n: [q4(nL.x), q4(nL.y), q4(nL.z)], v: vec(vel) });
    this.send({
      k: 'cut', id, part, seed, x, p: [q4(pL.x), q4(pL.y), q4(pL.z)], n: [q4(nL.x), q4(nL.y), q4(nL.z)], v: vec(vel),
      // (which life of the body: a cut from before a respawn doesn't apply)
      g: a.remote ? (a.cutSeen || 0) : (a.cutGen || 0),
    });
  }
  /** The cuts a body of ours really has (this life): replayed to a copy that got out of step. */
  logCut(a, c) {
    if (a.cutLogGen !== (a.cutGen || 0)) { a.cutLog = []; a.cutLogGen = a.cutGen || 0; }
    a.cutLog.push(c);
  }
  /** Someone cut a body: ours for real (it's our physics), anyone else's copy for the look. */
  onCut(m) {
    if (m.to !== undefined && String(m.to) !== String(this.me)) return;
    const a = this.actorOf(m.id), D = this.g.dismember;
    if (!a || !D || !a.groups?.[m.part]) return;
    if (a.remote) { if (m.g < (a.cutSeen || 0)) return; a.cutSeen = m.g; }
    else if (m.g !== (a.cutGen || 0)) return;
    const G = a.groups[m.part];
    // (every limb where it's drawn now: they aren't under the root)
    freshMatrices(a);
    const point = G.localToWorld(V(m.p[0] / 1e4, m.p[1] / 1e4, m.p[2] / 1e4));
    const n = V(m.n[0] / 1e4, m.n[1] / 1e4, m.n[2] / 1e4).applyQuaternion(G.getWorldQuaternion(_qa)).normalize();
    this.muted = true;
    let ok = false;
    try { ok = D.sever(a, m.part, point, n, unvec(m.v), { seed: m.seed, net: true, gib: !!m.x }); } finally { this.muted = false; }
    // (ours: it's real now - and theirs to replay if a copy loses it)
    if (ok && !a.remote) { const { to, from, t, ...c } = m; this.logCut(a, c); }
    // a limb taken off with another player's blade: it comes away soaked (melee.js land: a cut is 1)
    if (ok && m.to === undefined && !m.x) {
      const R = this.actorOf(m.from)?.net;
      for (const slot of [0, 1]) {
        const wb = R && (slot ? R.wb2 : R.wb);
        if (wb && WEAPONS[slot ? R.itemCode2 : R.itemCode]?.hit.kind === 'blade') { wb.add(point, 1, inkOf(a)); break; }
      }
    }
    if (!ok) console.warn("[gore] a cut from another client wasn't applied:", m.part, a.remote ? '(their copy)' : '(our own body)');
  }

  said(a, text, opts) {
    if (!this.live || this.muted || a.remote) return;
    const id = this.ref(a);
    if (id === null) return;
    const to = opts?.to ? this.ref(opts.to) : null;
    this.send({ k: 'say', id, x: String(text).slice(0, 200), o: opts?.tone || 'say', d: opts?.dur || 2.8, ...(to !== null ? { w: to } : {}) });
  }
  /** Another player's name (null: not a player). */
  nameOf(a) {
    for (const P of this.players.values()) if (P.actor === a) return P.name;
    return null;
  }

  // ---------- name tags ----------
  placeTags() {
    const cam = this.g.camera, w = innerWidth, h = innerHeight;
    for (const P of this.players.values()) {
      const a = P.actor, el = P.tag;
      a.hero.head.getWorldPosition(_v2);
      _v2.y += 0.42;
      const d = _v2.distanceTo(cam.position);
      _v.copy(_v2).project(cam);
      if (!a.hero.shown || _v.z > 1 || d > 70 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(${((_v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - _v.y) / 2 * h).toFixed(1)}px) translate(-50%, -100%)`;
      el.style.opacity = String(clamp(1.4 - d / 50, 0.25, 1));
    }
  }
}

const g_car = (mp, i) => mp.g.vehicles.cars[i] || null;
