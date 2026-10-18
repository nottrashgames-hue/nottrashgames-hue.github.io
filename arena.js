import * as THREE from 'three';
import { MenuBoard } from './mainmenu.js';

/*
  The arena (sandbox-maps.js buildArena): you start in the little spawn room; the on-screen button
  starts a round and sends you into the pit, where waves of people come in at the gates and go
  for you. Clear a wave, a short breather, the next (more of them, more of them armed). Go down
  and the round's over: everyone in the pit goes and you're back in the spawn room.
  o = { scene, A (level.arena), hero, sfx, spawn(weapon, pos, yaw) -> npc, remove(npc),
        teleport(pos, yaw), toRoom() }
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rnd = (a, b) => a + Math.random() * (b - a);
const MAX_UP = 2;       // in the pit at once
const BREAK_T = 6;      // s between waves
const KEEP_DEAD = 2;    // bodies left lying about (the oldest go: corpses in blood cost frames)

export class Arena {
  constructor(o) {
    Object.assign(this, o);
    this.state = 'idle';   // idle | prep | wave | break | over
    this.wave = 0;
    this.t = 0;
    this.live = [];        // fighters this round
    this.toSpawn = 0;
    this.spawnT = 0;
    this.aimT = 0;
    this.deadT = 0;
    // the start button: on screen in the spawn room (and in the Esc menu)
    this.btn = document.createElement('button');
    this.btn.id = 'arenaStart';
    this.btn.textContent = 'Start round';
    this.btn.addEventListener('click', () => this.press());
    document.body.appendChild(this.btn);
    // and on the spawn room's wall, for a headset (point and pull the trigger) or the crosshair
    this.board = new MenuBoard(this.scene, this.A.board, [{ id: 'start', name: 'Start round', color: '#c8261c' }], () => this.press(), { title: 'Arena', logo: false, width: 2.6 });
    // the wave counter
    this.hud = document.createElement('div');
    this.hud.id = 'arenaHud';
    document.body.appendChild(this.hud);
    this.banner = document.createElement('div');
    this.banner.id = 'arenaBanner';
    document.body.appendChild(this.banner);
    this.bannerT = 0;
  }
  get active() { return this.state !== 'idle' && this.state !== 'over'; }
  /** The crosshair's on the board's button and clicked (true: it took the click). */
  click() { return this.ready && this.board.click(); }
  tap(camera, x, y) { return this.ready && this.board.tap(camera, x, y); }
  /** Can a round be started right now? */
  get ready() { return this.state === 'idle' && !this.hero.brain.dead; }
  /** The start button. */
  press() {
    if (!this.ready) return false;
    this.sfx?.('pickup', 0.4);
    this.start();
    this.onStart?.();
    return true;
  }
  say(text, t = 2.2) { this.banner.textContent = text; this.banner.classList.add('on'); this.bannerT = t; }

  start() {
    this.clear();
    this.wave = 0;
    const e = this.A.entry, a = rnd(0, Math.PI * 2), r = rnd(0, this.A.entryR);
    this.teleport(V(e.x + Math.cos(a) * r, e.y, e.z + Math.sin(a) * r), this.A.entryYaw);
    this.state = 'prep'; this.t = 3;
    this.say('Get ready');
  }
  nextWave() {
    this.wave++;
    this.toSpawn = 2 + this.wave + Math.floor(this.wave * this.wave / 6);
    this.spawnT = 0.5;
    this.state = 'wave';
    this.say('Wave ' + this.wave);
  }
  /** What they come in with: a melee weapon, any of them (o.weapons: the types there are). */
  weapon() {
    const W = this.weapons;
    return W[Math.floor(Math.random() * W.length)];
  }
  up(n) { const A = n.actor; return !A.brain.dead && !n.arenaOut; }
  spawnOne() {
    const gates = this.A.gates;
    const g = gates[Math.floor(Math.random() * gates.length)];
    const p = g.pos.clone().add(V(rnd(-0.6, 0.6), 0, rnd(-0.6, 0.6)));
    const n = this.spawn(this.weapon(), p, g.yaw);
    if (!n) return;
    n.arena = true;
    n.street.arena = true;
    n.downT = 0;
    // tougher as it goes
    Object.assign(n.street.P, { temper: 1, tough: Math.min(1, 0.55 + this.wave * 0.06), crook: false, mouth: 0.4 });
    n.street.crimeT = Infinity;
    this.live.push(n);
    this.go(n);
  }
  /** After whoever's nearest and still standing. */
  go(n) {
    const S = n.street;
    if (!S || n.actor.brain.dead || n.actor.mode !== 'anim') return;
    const T = this.hero;
    if (T.brain.dead) return;
    n.fearT = 0;
    if (S.mode !== 'fight' || S.target !== T) S.startFight(T);
    S.t = 0;
  }
  clear() {
    for (const n of this.live) this.remove(n);
    this.live.length = 0;
    this.toSpawn = 0;
  }
  /** The map's going (or the world's reset): fighters, button and HUD with it. */
  dispose() {
    this.clear();
    this.btn.remove();
    this.board.mesh.removeFromParent(); this.board.laser.removeFromParent();
    this.board.tex.dispose();
    this.hud.remove(); this.banner.remove();
  }
  reset() { this.clear(); this.state = 'idle'; this.wave = 0; this.deadT = 0; }

  update(dt) {
    if ((this.bannerT -= dt) <= 0) this.banner.classList.remove('on');
    this.btn.classList.toggle('on', this.ready);
    this.board.mesh.visible = this.ready;
    if (this.ready) this.board.update(this.camera, this.vr());
    else { this.board.hover = -1; this.board.laser.visible = false; }
    // (mouse captured: it can't be clicked - Esc frees the mouse, and the menu has it too)
    this.btn.classList.toggle('locked', !!document.pointerLockElement);
    const up = this.live.filter((n) => this.up(n));
    this.hud.classList.toggle('on', this.active);
    if (this.active) this.hud.textContent = 'Wave ' + Math.max(1, this.wave) + (this.state === 'wave' ? ' · ' + (up.length + this.toSpawn) + ' left' : '');
    if (!this.active) {
      if (this.state === 'over' && (this.t -= dt) <= 0) this.state = 'idle';
      return;
    }
    // you went down: that's the round
    if (this.hero.brain.dead) {
      if ((this.deadT += dt) > 3) {
        const w = this.wave;
        this.clear();
        this.state = 'over'; this.t = 1;
        this.deadT = 0;
        this.toRoom();
        this.say('You fell on wave ' + w, 3.5);
      }
      return;
    }
    this.deadT = 0;
    // knocked cold for a long while counts as out
    for (const n of up) {
      if (n.actor.mode === 'ragdoll') { if ((n.downT += dt) > 10) n.arenaOut = true; }
      else n.downT = 0;
    }
    // the oldest bodies go
    const dead = this.live.filter((n) => !this.up(n));
    if (dead.length > KEEP_DEAD) {
      const n = dead[0];
      this.remove(n);
      this.live.splice(this.live.indexOf(n), 1);
    }
    if (this.state === 'prep' || this.state === 'break') {
      if ((this.t -= dt) <= 0) this.nextWave();
      return;
    }
    // the wave: in at the gates a few at a time
    if (this.toSpawn > 0 && up.length < MAX_UP && (this.spawnT -= dt) <= 0) {
      this.spawnT = rnd(0.6, 1.4);
      this.toSpawn--;
      this.spawnOne();
    }
    if ((this.aimT -= dt) <= 0) { this.aimT = 0.5; for (const n of up) this.go(n); }
    if (!this.toSpawn && !up.length) {
      this.state = 'break'; this.t = BREAK_T;
      this.say('Wave ' + this.wave + ' cleared');
    }
  }
}
