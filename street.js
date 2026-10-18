import * as THREE from 'three';
import { line } from './lines.js';
import { Feelings } from './feelings.js';
import { Fists, Melee } from './melee.js';
import { Kick } from './kick.js';
import { Gun } from './gun.js';

/*
  Street life with an attitude, layered over the pedestrian brain (npc.js):
    - running their mouth: roasting you, your car, each other; angry waves and shaken fists
    - reacting to being bumped, shoved, punched, hit by a car: glare, yell, or fight
    - fights: squaring up with fists, or with whatever they carry (bat, crowbar, machete, pistol)
    - crimes, for the crooked ones: mugging people (you too), picking fights, smashing car windows
  One Street per Npc. control() takes over the body while it's busy with something (a fight,
  a robbery...) and returns null otherwise, so ordinary city life carries on underneath.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const flat = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
const yawTo = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const HIDE = V(0, -60, 0);

// how close a weapon has to be to land
const REACH = { fists: 0.72, bat: 0.95, crowbar: 0.82, machete: 0.85, longsword: 1.05, spear: 1.2, sledge: 0.95, fireaxe: 1, hatchet: 0.78, hammer: 0.72, knife: 0.7, pencil: 0.65, ruler: 0.8 };

export class Street {
  /**
   * W = { player, npcs, bubbles, sfx, vehicles, money, scene, debris, meleeCtx, melees, guns,
   *       onFire, now() }
   */
  constructor(npc, persona, W) {
    this.npc = npc;
    this.A = npc.actor;
    this.P = persona;
    this.W = W;
    this.mode = null;          // null | 'fight' | 'mug' | 'victim' | 'vandal' | 'getWeapon'
    this.target = null;        // actor
    this.t = 0;
    this.sayCool = rnd(2, 8);
    this.roastCool = rnd(6, 20);
    this.crimeT = persona.crook ? rnd(15, 60) : Infinity;
    this.scanT = rnd(0, 0.5);
    this.atkCool = 0;
    this.aim = V();
    this.fists = new Fists(this.A, { ...W.meleeCtx, aimPoint: this.aim });
    this.kicks = new Kick(this.A, W.meleeCtx);
    this.kit = null;           // their own weapon (Melee | Gun), made on first use
    this.cash = 0;             // loot from robberies (spills when they die)
    this.after = null;         // a reaction waiting until they're back on their feet
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.nearCars = new Map();
    // made up front: a gun or weapon appearing mid-game would stall a frame building it
    this.kit = this.makeKit();
    this.feel = new Feelings(this);
  }

  get busy() { return !!this.mode || !!this.feel?.grief; }
  /** Busy with something that shouldn't be interrupted by gunfire nearby. */
  get steady() { return this.mode === 'fight' && (this.P.tough > 0.6 || this.P.weapon === 'pistol'); }
  get armedWith() { return this.P.weapon; }

  // ---------------------------------------------------------------- talking
  say(kind, about, tone = 'say', force = false) {
    if (this.zombie) return; // (the dead don't talk)
    if (this.A.brain.dead || this.A.seat) return;
    if (!force && this.sayCool > 0) return;
    const W = this.W, now = W.now();
    // not everybody at once: a small global gap between unprompted lines
    if (!force && now - (W.lastLine || 0) < 1.2) return;
    W.lastLine = now;
    const dur = W.bubbles.say(this.A, line(kind, about), { tone });
    this.sayCool = dur + rnd(1.5, 4);
  }
  gesture(g, dur) { if (!this.zombie) this.npc.gest.play(g, dur); }

  // ---------------------------------------------------------------- being messed with
  /**
   * Someone did something to us. how: 'bump' | 'knock' | 'fist' | 'armed' | 'shot' | 'car' |
   * 'roast' | 'jacked'
   */
  provoked(by, how) {
    const A = this.A, P = this.P;
    if (A.brain.dead || by === A) return;
    if (this.zombie || this.arena) return; // (survival.js / arena.js pick who they go for)
    if (by && !by.brain) by = null; // a driverless car
    const npc = this.npc;
    // the police don't take it: whoever did it is nicked
    if (this.cop) {
      if (by && !by.npc?.cop && !(this.mode === 'fight' && this.target === by)) this.afterUp(() => this.W.police?.engage(npc, by));
      return;
    }
    // already at it with them: that just proves the point
    if (this.mode === 'fight' && this.target === by) return;
    // mid-robbery the victim bites back: the robber fights
    if (by && this.mode === 'mug' && this.target === by) { this.startFight(by); return; }
    const theyArmed = by && (by.gunHeld || by.meleeHeld);
    const iArmed = !!P.weapon;
    const fightChance = {
      bump: 0.04, knock: 0.35, fist: 0.6, armed: 0.35, shot: 0.25, car: 0.15, roast: 0.12, jacked: 0.55,
    }[how] ?? 0.3;
    // the tougher and angrier, the likelier to go for it; armed people are braver, and a gun
    // pointed at you makes most people think twice
    let f = fightChance * (0.25 + P.tough * 1.1) * (0.6 + P.temper * 0.8);
    if (iArmed) f *= 1.6;
    if (theyArmed && !iArmed) f *= 0.35;
    if (by?.gunHeld && P.weapon !== 'pistol') f *= 0.4;
    if (how === 'bump' && P.temper < 0.7) f = 0;
    const scared = how === 'shot' || how === 'armed' || (theyArmed && P.tough < 0.5);

    if (by && Math.random() < f) {
      this.afterUp(() => this.startFight(by));
      return;
    }
    if (scared) {
      if (this.mode === 'victim' || this.mode === 'mug') this.stop();
      npc.fearT = Math.max(npc.fearT, rnd(6, 12));
      npc.fleeFrom = (by?.hero.pos || A.hero.pos).clone();
      // (being shot: the pain says it - feelings.js)
      if (how !== 'shot') this.say('scared', null, 'scared', true);
      return;
    }
    // not worth a fight: glare, yell, and wave them off
    if (how === 'car') {
      this.afterUp(() => {
        this.say(Math.random() < 0.5 ? 'runOver' : 'nearMiss', null, 'angry', true);
        this.gesture(Math.random() < 0.5 ? 'shake' : 'shoo');
        npc.glareT = Math.max(npc.glareT, 2);
        npc.glareAt = by;
      });
      return;
    }
    npc.glareAt = by;
    const mad = how !== 'bump' || P.temper > 0.55;
    this.afterUp(() => {
      if (mad) {
        this.say(how === 'bump' ? 'bumped' : Math.random() < 0.5 ? 'glare' : 'angry', null, 'angry', true);
        this.gesture(Math.random() < 0.5 ? 'shake' : Math.random() < 0.5 ? 'shoo' : 'point');
      } else if (Math.random() < 0.6) this.say('bumped', null, 'say', true);
      npc.glareT = Math.max(npc.glareT, mad ? rnd(2, 4) : rnd(1, 2));
    });
  }
  /** Brushed past (walked into, not knocked over): now and then worth a word. */
  bumped(by) {
    if ((this.bumpCool || 0) > 0 || this.mode) return;
    this.bumpCool = rnd(4, 8);
    this.provoked(by, 'bump');
  }
  /** Run fn now if on our feet, else once we've got back up. */
  afterUp(fn) {
    if (this.upright) fn();
    else this.after = fn;
  }
  /** On our feet (or just sitting: that's quick to get out of), not falling or getting up. */
  get upright() { const a = this.A.hero.action; return this.A.mode === 'anim' && !this.A.seat && (!a || a.isPosture); }

  /** Heard gunfire from shooter: the brave and armed might shoot back instead of running. */
  heardShots(shooter) {
    if (this.cop) { this.W.police?.shots(this.npc, shooter); return true; }
    if (this.steady) return true;
    if (shooter && shooter !== this.A && this.P.weapon === 'pistol' && this.P.tough > 0.55 && Math.random() < 0.5 &&
      flat(shooter.hero.pos, this.A.hero.pos) < 20) {
      this.startFight(shooter);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- modes
  startFight(T) {
    if (!T || T === this.A || T.brain.dead || this.A.brain.dead) return;
    const was = this.mode;
    this.feel.grief = null;
    this.npc.abort();
    this.npc.posture?.stand(true);
    this.npc.fearT = 0;
    this.mode = 'fight';
    this.target = T;
    this.t = 0;
    this.downT = 0;
    this.atkCool = rnd(0.3, 0.8);
    if (was !== 'mug') {
      this.say(this.P.weapon === 'pistol' ? 'gunOut' : 'angry', null, 'angry', true);
      this.gesture(Math.random() < 0.5 ? 'comeon' : 'shake');
    }
    this.draw();
    this.W.witness?.(this.A, T);
  }

  startMug(T) {
    this.npc.abort();
    this.mode = 'mug';
    this.target = T;
    this.t = 0;
    this.phase = 'approach';
  }

  startVandal(car) {
    this.npc.abort();
    this.mode = 'vandal';
    this.car = car;
    this.t = 0;
    this.phase = 'approach';
    this.swings = 0;
  }

  /** Back to ordinary life (weapon put away). */
  stop() {
    const T = this.target;
    if (this.mode === 'mug' && T?.npc?.street.mode === 'victim') T.npc.street.stop();
    this.mode = null;
    this.target = null;
    this.car = null;
    this.fists.cancel();
    this.holster();
    this.npc.gest.look = null;
  }

  // ---------------------------------------------------------------- weapons
  makeKit() {
    const W = this.W, type = this.P.weapon;
    if (!type) return null;
    let k;
    if (type === 'pistol') {
      k = new Gun(W.scene, { x: 0, top: HIDE.y, z: 0 }, W.debris, W.sfx);
      k.onFire = W.onFire;
      W.guns.push(k);
    } else {
      k = new Melee(type, W.scene, W.debris, W.meleeCtx, { pos: HIDE, quat: new THREE.Quaternion() });
      W.melees.push(k);
    }
    k.npcKit = true;
    k.mesh.visible = false;
    k.state = 'hidden';
    return k;
  }
  /** Weapon out, if we have one on us. */
  draw() {
    const A = this.A;
    if (!this.P.weapon || A.mode !== 'anim' || A.hero.action) return;
    this.kit ||= this.makeKit();
    const k = this.kit;
    if (k.state !== 'hidden') return; // lost it (dropped, or somebody else has it)
    const hand = A.hero.arms[1].hand.getWorldPosition(V());
    k.mesh.position.copy(hand);
    k.mesh.visible = true;
    k.state = 'rest';
    if (k instanceof Gun) { k.aimPoint = this.aim; k.interact(A); }
    else k.pick(A);
  }
  holster() {
    const k = this.kit, A = this.A;
    if (!k || k.owner !== A) return;
    if (this.keepOut && !A.brain.dead) return; // (never put away: Baldi's ruler)
    A.hero.armHook = null;
    A.hero.twist = A.hero.bend = 0;
    if (k instanceof Gun) { k.abortReload(); A.gunHeld = null; }
    else { k.swing = null; A.meleeHeld = null; }
    k.owner = null;
    k.state = 'hidden';
    k.mesh.visible = false;
    k.mesh.position.copy(HIDE);
  }
  /** World reset: everything back in the pocket. */
  reset() {
    const ko = this.keepOut;
    this.keepOut = false; // (a world reset puts even Baldi's ruler away: it's back out once he's up)
    this.stop();
    this.keepOut = ko;
    this.after = null;
    this.feel.reset();
    this.cash = 0;
    this.crimeT = this.P.crook ? rnd(15, 60) : Infinity;
    const k = this.kit;
    if (k) {
      if (k.owner && k.owner !== this.A) {
        const o = k.owner;
        o.hero.armHook = null;
        if (o.gunHeld === k) o.gunHeld = null;
        if (o.meleeHeld === k) o.meleeHeld = null;
      }
      k.owner = null;
      k.state = 'hidden';
      k.mesh.visible = false;
      if (k.mesh.parent !== this.W.scene) this.W.scene.add(k.mesh);
      k.mesh.position.copy(HIDE);
    }
  }

  // ---------------------------------------------------------------- per frame
  /** Always runs (even while down): timers, weapon bookkeeping. */
  tick(dt) {
    this.sayCool -= dt;
    this.roastCool -= dt;
    this.atkCool -= dt;
    this.bumpCool = (this.bumpCool || 0) - dt;
    this.t += dt;
    if (!this.mode && this.npc.free) this.crimeT -= dt;
    this.fists.update();
    this.kicks.update(dt);
    if (this.after && this.upright) { const f = this.after; this.after = null; f(); }
    if (this.A.brain.dead) { if (this.mode) this.stop(); this.after = null; }
    // always armed: back in hand as soon as we're up (and haven't lost it)
    else if (this.keepOut && this.kit?.state === 'hidden' && this.upright && !this.A.hero.action) this.draw();
    this.feel.tick(dt);
  }

  /** Take over the controls while busy; null to let ordinary life carry on. */
  control(dt, colliders) {
    if (this.zombie) return this.zb ? this.zb.control(dt, colliders) : null; // (zombie.js)
    if (!this.mode && this.W.police) {
      const c = this.W.police.control(this, dt, colliders);
      if (c) return c;
    }
    if (!this.mode && this.feel.grief) {
      const c = this.feel.control(dt, colliders);
      if (c) return c;
    }
    if (!this.mode && this.keepOut) {
      const c = this.fetchKit(colliders);
      if (c) return c;
    }
    if (!this.mode) {
      this.ambient(dt);
      if (this.crimeT <= 0 && this.npc.free) this.crime();
      if (!this.mode) return null;
    }
    const A = this.A;
    if (A.mode !== 'anim' || A.seat) return null;
    if (this.mode === 'fight') return this.fight(dt, colliders);
    if (this.mode === 'mug') return this.mug(dt, colliders);
    if (this.mode === 'victim') return this.victim(dt);
    if (this.mode === 'vandal') return this.vandal(dt, colliders);
    return null;
  }

  /**
   * Always armed (keepOut): a weapon knocked out of our hands is fetched if it's close; one
   * that's gone (far off, or somebody else has it) is replaced with a new one from the pocket.
   */
  fetchKit(colliders) {
    const A = this.A, k = this.kit, h = A.hero;
    if (!k || A.mode !== 'anim' || A.seat || A.meleeHeld || A.gunHeld) return null;
    if (k.state === 'hidden' || k.owner === A) return null;
    if (k.state !== 'loose' || k.owner) { this.kit = this.makeKit(); return null; }
    const kp = k.worldPos(V());
    if (flat(h.pos, kp) > 7 || Math.abs(kp.y - h.pos.y) > 2) { this.kit = this.makeKit(); return null; }
    const mv = this.goTo(kp, 0.35, colliders, 1);
    if (flat(h.pos, kp) < 0.9) k.pick(A);
    return this.ctrl(mv, yawTo(h.pos, kp), false);
  }

  ctrl(move, face, run = false) {
    // a zombie shambles (survival.js sets how fast, wave by wave)
    if (this.zombie) { move.multiplyScalar(this.zSpeed ?? 0.6); run = run && !!this.zRun; }
    return { move, run, jump: false, camYaw: face - Math.PI, faceYaw: face };
  }
  /** Move toward p (steering round things), stopping at `stop`; returns the move vector. */
  goTo(p, stop, colliders, speed = 1) {
    const h = this.A.hero, m = this.npc.move.set(p.x - h.pos.x, 0, p.z - h.pos.z);
    const d = m.length();
    if (d <= stop || d < 1e-3) return m.set(0, 0, 0);
    m.divideScalar(d);
    if (d > 1.2) this.npc.steer(h, m, colliders);
    return m.multiplyScalar(clamp((d - stop) * 1.5, 0.3, speed));
  }

  fight(dt, colliders) {
    const A = this.A, h = A.hero, T = this.target, P = this.P;
    if (!T || T.brain.dead) return this.win();
    const tp = T.seat ? T.seat.car.p : T.hero.pos;
    const dist = flat(h.pos, tp);
    // they drove off / got away / we're hurting: forget it
    // (police don't give up: the wanted level decides when they're off the case)
    if (!this.zombie && !this.arena && ((!this.cop && (dist > 30 || this.t > 45)) || (A.brain.shots && P.tough < 0.8) || (A.organs?.weak || 0) > 0.5)) {
      if (A.brain.shots) { this.npc.fearT = rnd(6, 10); this.npc.fleeFrom = tp.clone(); this.say('scared', null, 'scared', true); }
      this.stop();
      return null;
    }
    // they're down: give it a moment, then a parting shot
    if (T.mode === 'ragdoll' && !T.brain.dead) {
      this.downT += dt;
      if (this.downT > rnd(2.5, 4.5)) return this.win();
    } else this.downT = 0;

    // our weapon got knocked out of our hands: go and get it back if it's close
    const k = this.kit;
    if (k && k.state === 'loose' && !A.gunHeld && !A.meleeHeld) {
      const kp = k.worldPos(V());
      if (flat(h.pos, kp) < 7 && dist > 2) {
        const mv = this.goTo(kp, 0.35, colliders, 1);
        if (flat(h.pos, kp) < 0.9) {
          if (k instanceof Gun) { k.aimPoint = this.aim; k.interact(A); } else k.pick(A);
        }
        return this.ctrl(mv, yawTo(h.pos, kp), true);
      }
    } else if (k && k.state === 'hidden') this.draw();

    const face = yawTo(h.pos, tp);
    // a cop with a gun shoots at the car you're in
    if (T.seat && this.cop && A.gunHeld) { this.aim.copy(tp).setY(tp.y + 1); return this.shootAt(dt, T, dist, face, colliders); }
    if (T.seat) {
      // they're in a car: stand by it yelling, until they drive off
      const mv = this.goTo(tp, 2.2, colliders, 1);
      if (Math.random() < dt * 0.5) { this.say(Math.random() < 0.5 ? 'car' : 'angry', { kind: T.seat.car.kind, color: T.seat.car.color }, 'angry'); this.gesture('shake'); }
      return this.ctrl(mv, face, dist > 5);
    }
    // aim at their chest (wherever the body is)
    this.aim.copy(T.state.pos);
    if (T.mode !== 'ragdoll') this.aim.y += 0.35;
    if (A.gunHeld) return this.shootAt(dt, T, dist, face, colliders);

    const w = A.meleeHeld ? A.meleeHeld.type : 'fists';
    const reach = REACH[w] ?? 0.8;
    let mv;
    if (T.mode === 'ragdoll' && !A.meleeHeld) {
      // no point punching the floor: stand over them, and the nasty ones put the boot in
      const chest = T.rd.pos('chest', V());
      mv = this.goTo(chest, 0.6, colliders, 0.6);
      if (P.temper > 0.55 && this.atkCool <= 0 && flat(h.pos, chest) < 0.95 && Math.abs(wrap(yawTo(h.pos, chest) - h.yaw)) < 0.6) {
        if (this.kicks.start('stomp')) { this.atkCool = rnd(0.9, 1.8); if (Math.random() < 0.3) this.say('won', null, 'angry'); }
      }
      return this.ctrl(mv, yawTo(h.pos, chest), false);
    } else if (dist > reach) {
      mv = this.goTo(tp, reach * 0.85, colliders, 1);
    } else {
      // in range: keep a little space, circle a touch
      const h2 = this.npc.move.set(h.pos.x - tp.x, 0, h.pos.z - tp.z).normalize();
      mv = dist < reach * 0.55 ? h2.multiplyScalar(0.5) : h2.set(-h2.z * this.strafe, 0, h2.x * this.strafe).multiplyScalar(0.15);
      if (Math.random() < dt * 0.4) this.strafe *= -1;
    }
    const facing = Math.abs(wrap(face - h.yaw)) < 0.5;
    if (dist < reach + 0.15 && facing && this.atkCool <= 0 && (T.mode !== 'ragdoll' || A.meleeHeld)) {
      if (A.meleeHeld) { A.meleeHeld.attack(T.mode === 'ragdoll' || Math.random() < 0.2 ? 'over' : null); this.atkCool = rnd(0.9, 1.6); }
      else if (Math.random() < 0.22 && dist > reach * 0.6 && this.kicks.start('front')) { this.fists.cancel(); this.atkCool = rnd(0.8, 1.4); }
      else { this.fists.punch(); this.atkCool = rnd(0.35, 0.9) * (Math.random() < 0.3 ? 2 : 1); }
      if (Math.random() < 0.12) this.say('angry', null, 'angry');
    }
    if (Math.random() < dt * 0.08) this.say(Math.random() < 0.5 ? 'angry' : 'roast', T.hero ? { look: T.hero.look } : null, 'angry');
    return this.ctrl(mv, face, dist > 2.5);
  }

  shootAt(dt, T, dist, face, colliders) {
    const A = this.A, h = A.hero, g = A.gunHeld, tp = T.seat ? T.seat.car.p : T.hero.pos;
    g.raise = Math.max(g.raise, 0.6);
    // keep a shooting distance
    let mv;
    if (dist > 11) mv = this.goTo(tp, 9, colliders, 1);
    else if (dist < 3) mv = this.npc.move.set(h.pos.x - tp.x, 0, h.pos.z - tp.z).normalize().multiplyScalar(0.6);
    else mv = this.npc.move.set(0, 0, 0);
    // bad shots: the further, the wider
    const spread = 0.12 + dist * 0.035;
    this.aim.x += rnd(-spread, spread); this.aim.y += rnd(-spread, spread) * 0.7; this.aim.z += rnd(-spread, spread);
    if (!g.chambered && g.ammo <= 0 && g.reloadT < 0) g.reload();
    const facing = Math.abs(wrap(face - h.yaw)) < 0.25;
    if (facing && g.aimW > 0.8 && this.atkCool <= 0 && T.mode !== 'ragdoll' && dist < 22) {
      g.fire();
      this.atkCool = rnd(0.3, 0.9) * (Math.random() < 0.25 ? 2.5 : 1);
    }
    if (Math.random() < dt * 0.1) this.say('gunOut', null, 'angry');
    return this.ctrl(mv, face, dist > 13);
  }

  win() {
    const T = this.target;
    const was = this.robbing;
    this.robbing = false;
    if (T && !T.brain.dead) {
      this.say('won', null, 'angry', true);
      this.gesture(Math.random() < 0.5 ? 'comeon' : 'point');
    }
    // a robbery that turned into a beating: they still take the money
    if (was && T && flat(this.A.hero.pos, T.hero.pos) < 3) this.loot(T);
    this.stop();
    return null;
  }

  loot(T) {
    const W = this.W;
    let got = 0;
    if (T === W.player) got = W.money.take(Math.round(rnd(15, 90) / 5) * 5);
    else { got = T.npc?.street ? Math.max(T.npc.street.cash, Math.round(rnd(5, 60) / 5) * 5) : 0; if (T.npc?.street) T.npc.street.cash = 0; }
    this.cash += got;
    return got;
  }

  mug(dt, colliders) {
    const A = this.A, h = A.hero, T = this.target, W = this.W;
    if (!T || T.brain.dead || T.seat || T.mode === 'ragdoll' || this.t > 30) { this.stop(); return null; }
    const tn = T.npc;
    if (tn && (tn.fearT > 0 || tn.street.mode && tn.street.mode !== 'victim')) { this.stop(); return null; }
    const dist = flat(h.pos, T.hero.pos), face = yawTo(h.pos, T.hero.pos);
    if (this.phase === 'approach') {
      if (dist > 25) { this.stop(); return null; }
      const mv = this.goTo(T.hero.pos, 1.1, colliders, 0.9);
      if (dist < 1.5) {
        this.phase = 'demand';
        this.t = 0;
        this.robbing = true;
        this.draw();
        this.say('mug', null, 'angry', true);
        if (!this.P.weapon) this.gesture('point');
        W.witness?.(A, T);
        if (tn) {
          // a tough one who isn't staring down a gun: not today
          const threat = this.P.weapon === 'pistol' ? 0.25 : this.P.weapon ? 0.6 : 1;
          if (tn.street.P.tough * threat > 0.55 && Math.random() < 0.7) {
            tn.street.say('mugRefuse', null, 'angry', true);
            tn.street.startFight(A);
            this.startFight(T);
            return null;
          }
          tn.street.becomeVictim(A);
        }
      }
      return this.ctrl(mv, face, dist > 6);
    }
    // demand: stand in their face; they hand it over, or we make them
    if (A.gunHeld) { A.gunHeld.raise = Math.max(A.gunHeld.raise, 0.5); this.aim.copy(T.state.pos).setY(T.state.pos.y + 0.3); }
    if (T === W.player) {
      if (dist > 5) {
        // walked off on me?
        this.say('angry', null, 'angry', true);
        this.startFight(T);
        return null;
      }
      if (this.t > 4) {
        const got = this.loot(T);
        if (got > 0) { this.say('mugDone', null, 'say', true); this.leave(T); }
        else { this.W.bubbles.say(A, "You're BROKE?! Useless!", { tone: 'angry' }); this.startFight(T); }
        return null;
      }
      if (this.t > 2 && Math.random() < dt * 0.6) this.say('mug', null, 'angry', true);
    } else if (this.t > 2.8) {
      this.loot(T);
      this.say('mugDone', null, 'say', true);
      tn?.street.robbed(A);
      this.leave(T);
      return null;
    }
    const mv = this.goTo(T.hero.pos, 1.0, colliders, 0.5);
    return this.ctrl(mv, face);
  }
  /** Job done: stash the weapon and hurry off. */
  leave(from) {
    this.robbing = false;
    this.stop();
    this.npc.fearT = rnd(4, 7); // (just to get away fast: runs off, looking back)
    this.npc.fleeFrom = from.hero.pos.clone();
  }

  becomeVictim(by) {
    this.npc.abort();
    this.npc.posture?.stand(true);
    this.mode = 'victim';
    this.target = by;
    this.t = 0;
    this.gesture('handsup', 3.5);
    setTimeout(() => { if (this.mode === 'victim') this.say('mugged', null, 'scared', true); }, 700);
  }
  victim(dt) {
    const T = this.target;
    if (!T || this.t > 6 || T.mode === 'ragdoll' || T.brain.dead) { this.stop(); return null; }
    const h = this.A.hero;
    this.npc.gest.look = T.hero.head.getWorldPosition(this._lk ||= V());
    return this.ctrl(this.npc.move.set(0, 0, 0), yawTo(h.pos, T.hero.pos));
  }
  robbed(by) {
    this.stop();
    const npc = this.npc;
    npc.fearT = rnd(5, 9);
    npc.fleeFrom = by.hero.pos.clone();
    setTimeout(() => this.say('robbedAfter', null, 'scared', true), 900);
  }

  vandal(dt, colliders) {
    const A = this.A, h = A.hero, c = this.car;
    if (!c || c.driver || c.speed > 1 || this.t > 25) { this.stop(); return null; }
    // stand beside the driver's window
    const spot = c.toWorld(c.S.W / 2 + 0.6, 0, 0.3, V());
    const win = c.toWorld(0, 1.0, 0.4, V());
    const dist = flat(h.pos, spot), face = yawTo(h.pos, win);
    if (this.phase === 'approach') {
      const mv = this.goTo(spot, 0.3, colliders, 0.9);
      if (dist < 0.5) { this.phase = 'smash'; this.t = 0; this.draw(); this.say('vandal', null, 'angry', true); }
      return this.ctrl(mv, face, dist > 8);
    }
    if (this.t > 1 && this.atkCool <= 0) {
      if (A.meleeHeld) A.meleeHeld.attack(); else this.fists.punch();
      this.atkCool = rnd(0.7, 1.1);
      this.swings++;
      this.W.sfx?.('crash', 0.25);
      if (this.swings >= 3) {
        this.W.vehicles.shatter(c);
        c.crashes += 3;
        this.W.witness?.(A, null);
        this.leave({ hero: { pos: c.p } });
        return null;
      }
    }
    return this.ctrl(this.npc.move.set(0, 0, 0), face);
  }

  // ---------------------------------------------------------------- crime
  crime() {
    const A = this.A, h = A.hero, W = this.W;
    this.crimeT = rnd(35, 90);
    const r = Math.random();
    const people = [W.player, ...W.npcs.map((n) => n.actor)].filter((o) => o !== A && !o.brain.dead && !o.seat &&
      o.mode === 'anim' && flat(o.hero.pos, h.pos) < 16 && (!o.npc || o.npc.free));
    if (r < 0.55 && people.length) {
      // a robbery: you're a juicy target if you're close
      const you = people.includes(W.player) && Math.random() < 0.45;
      this.startMug(you ? W.player : people[Math.floor(Math.random() * people.length)]);
      return;
    }
    if (r < 0.75) {
      const cars = W.vehicles.cars.filter((c) => !c.driver && c.speed < 0.5 && c.m.windshield.visible && flat(c.p, h.pos) < 20);
      if (cars.length) { this.startVandal(cars[Math.floor(Math.random() * cars.length)]); return; }
    }
    if (people.length) {
      // just looking for trouble
      const T = people[Math.floor(Math.random() * people.length)];
      this.say('roast', { look: T.hero.look }, 'angry', true);
      this.afterUp(() => this.startFight(T));
    }
  }

  // ---------------------------------------------------------------- mouth
  /** Every so often: look around for someone (or some car) to comment on. */
  ambient(dt) {
    const npc = this.npc, A = this.A, h = A.hero, W = this.W, P = this.P;
    this.scanT -= dt;
    if (this.scanT > 0 || A.mode !== 'anim') return;
    this.scanT = rnd(0.35, 0.6);
    if (npc.convo || npc.fearT > 0) return;
    const pl = W.player;
    // cars flying past too close: yell and shake a fist at them
    for (const c of W.vehicles.cars) {
      if (c.speed < 5) continue;
      const d = flat(c.p, h.pos);
      if (d < 3.2 && !this.nearCars.get(c)) {
        this.nearCars.set(c, true);
        if (Math.random() < 0.4 + P.temper * 0.5) {
          npc.gest.look = c.p.clone().setY(1.2);
          this.say('nearMiss', null, 'angry', true);
          this.gesture(Math.random() < 0.6 ? 'shake' : 'shoo');
        }
      } else if (d > 6) this.nearCars.delete(c);
    }
    if (this.roastCool > 0 || npc.glareT > 0) return;
    // one heckler at a time
    if (W.now() - (W.lastRoast || -99) < 5) return;
    const chance = P.mouth * 0.14;
    // you, on foot or at the wheel
    const pd = flat(pl.seat ? pl.seat.car.p : pl.hero.pos, h.pos);
    if (pd < (pl.seat ? 7 : 4.5) && !pl.brain.dead && Math.random() < chance) {
      this.roastCool = rnd(14, 35);
      W.lastRoast = W.now();
      if (pl.seat) {
        const c = pl.seat.car;
        this.say('car', { kind: c.kind, color: c.color, wrecked: c.crashes > 2 || !c.m.windshield.visible }, P.temper > 0.5 ? 'angry' : 'say', true);
      } else {
        this.say('roast', { look: pl.hero.look, bleeding: (pl.organs?.blood ?? 1) < 0.9, armed: !!(pl.gunHeld || pl.meleeHeld) },
          P.temper > 0.55 ? 'angry' : 'say', true);
      }
      npc.gest.look = (pl.seat ? pl.seat.car.p.clone().setY(1.2) : pl.hero.head.getWorldPosition(V()));
      if (P.temper > 0.5 && Math.random() < 0.6) this.gesture(Math.random() < 0.5 ? 'shoo' : 'point');
      else if (Math.random() < 0.3) this.gesture('laugh');
      return;
    }
    // each other
    if (!npc.free || Math.random() > chance * 0.5) return;
    const near = W.npcs.find((o) => o !== npc && o.free && flat(o.actor.hero.pos, h.pos) < 3.5);
    if (!near) return;
    this.roastCool = rnd(18, 45);
    W.lastRoast = W.now();
    const them = near.street;
    this.say(Math.random() < 0.5 ? 'banter' : 'roast', { look: near.actor.hero.look }, P.temper > 0.6 ? 'angry' : 'say', true);
    npc.gest.look = near.actor.hero.head.getWorldPosition(V());
    near.gest.look = h.head.getWorldPosition(V());
    setTimeout(() => {
      if (them.A.brain.dead || them.mode) return;
      // two hotheads: that escalates
      if (them.P.temper > 0.55 && P.temper > 0.5 && Math.random() < (them.P.tough + P.tough) * 0.3) {
        them.say('angry', null, 'angry', true);
        them.startFight(A);
        if (!this.mode) this.startFight(them.A);
      } else {
        them.say('banterBack', null, them.P.temper > 0.6 ? 'angry' : 'say', true);
        if (them.P.temper > 0.6) them.gesture('shoo');
      }
    }, 1500 + Math.random() * 800);
  }
}
