import * as THREE from 'three';

/*
  Survival on the tower roof. A big red button on the helipad starts it (and goes away while a
  game is on). The dead come in waves, out of the roof doors and up over the parapet, and go
  for the nearest player still standing. Nobody respawns mid-game: a fallen player is brought
  back by a teammate kneeling over them (E, held a moment). Everyone down: game over, and the
  button's back. Between waves (and before the first) the shop's open (svshop.js, B), paid for
  with the cash the dead drop (bounty()).

  The host runs it (the zombies are a fixed pool of NPCs at the end of main.js' npcs list,
  parked out of sight until needed, so multiplayer syncs them like anyone else). The others
  follow the host's word: 'sv' (state, every second), 'svGo' (someone pressed the button),
  'svRevive' (you've been picked up), 'svDoor' (a door swinging open).
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rnd = (a, b) => a + Math.random() * (b - a);
const flat = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
export const HIDE = V(0, -60, 0);
const MAX_UP = 10;         // zombies on the roof at once
const PRESS_R = 1.5;       // m from the button
const REVIVE_R = 1.6;      // m from a fallen teammate
const REVIVE_T = 2.5;      // s of kneeling over them
const BREAK_T = 20;        // s between waves (the shop's open)
const FIRST_T = 15;        // s before the first

function labelTex(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  g.font = '900 64px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 10; g.strokeStyle = 'rgba(20,4,4,.85)';
  g.strokeText(text, 128, 50);
  g.fillStyle = '#ffe9e2';
  g.fillText(text, 128, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Survival {
  /**
   * o = { scene, S (the level's survival: doors, ledges, height, half), at (button spot),
   *       zombies: [Npc], hero, mp: () => Multiplayer, sfx, groundAt(x, z, y),
   *       reviveMe(pos) (brings you back where you fell), onOver() (game over: back to normal) }
   */
  constructor(o) {
    Object.assign(this, o);
    this.active = false;
    this.wave = 0;
    this.left = 0;           // zombies still to come or still standing, this wave (shown)
    this.toSpawn = 0;
    this.breakT = 0;
    this.spawnT = 0;
    this.sendT = 0;
    this.aimT = 0;
    this.best = 0;
    this.revive = null;      // { id, actor, t } kneeling over a teammate
    for (const z of this.zombies) this.park(z);
    this.buildButton();
    this.hud = document.createElement('div');
    this.hud.id = 'sv-hud';
    document.body.appendChild(this.hud);
    this.hud.addEventListener('click', (e) => { if (e.target.closest('.sv-shopbtn')) this.onShop?.(); });
    this.drawHud();
  }

  // ---------------------------------------------------------------- the button
  buildButton() {
    const g = this.button = new THREE.Group();
    g.position.copy(this.at);
    const dark = new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.5, metalness: 0.5 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xe8c33a, roughness: 0.6 });
    this.capMat = new THREE.MeshStandardMaterial({ color: 0xd8201a, roughness: 0.3, emissive: 0x8a0a06, emissiveIntensity: 0.6 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.9, 20), dark);
    post.position.y = 0.45;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.08, 24), yellow);
    base.position.y = 0.04;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.24, 0.07, 24), yellow);
    top.position.y = 0.93;
    this.cap = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.capMat);
    this.cap.position.y = 0.96;
    this.cap.scale.y = 0.6;
    for (const m of [post, base, top, this.cap]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex('START'), transparent: true, depthWrite: false }));
    this.label.scale.set(0.9, 0.34, 1);
    this.label.position.y = 1.55;
    g.add(this.label);
    this.scene.add(g);
    this.t = 0;
  }

  /** What E would do here: 'start' | 'revive' | null (for the prompt). */
  prompt() {
    const h = this.hero;
    if (h.brain.dead || h.mode !== 'anim' || h.seat) return null;
    if (!this.active) return flat(h.hero.pos, this.at) < PRESS_R ? 'start' : null;
    if (this.revive) return 'reviving';
    return this.fallenNear() ? 'revive' : null;
  }
  reviveK() { return this.revive ? Math.min(1, this.revive.t / REVIVE_T) : 0; }

  /** E pressed: true if it was ours. */
  use() {
    const p = this.prompt();
    if (p === 'start') {
      this.sfx('button', 0.8);
      this.cap.position.y = 0.93;
      const mp = this.mp();
      if (mp?.live && !mp.isHost) mp.send({ k: 'svGo' });
      else this.start();
      return true;
    }
    if (p === 'revive') {
      const f = this.fallenNear();
      this.revive = { ...f, t: 0 };
      return true;
    }
    return p === 'reviving';
  }

  /** A fallen teammate within reach: { id, actor } or null. */
  fallenNear() {
    const mp = this.mp();
    if (!mp?.live) return null;
    let best = null, bd = REVIVE_R;
    for (const [id, P] of mp.players) {
      const a = P.actor;
      if (!a.brain.dead) continue;
      const d = flat(this.hero.hero.pos, a.hero.pos);
      if (d < bd) { bd = d; best = { id, actor: a }; }
    }
    return best;
  }

  // ---------------------------------------------------------------- the game (host)
  start() {
    if (this.active) return;
    this.active = true;
    this.wave = 0;
    this.breakT = FIRST_T;
    this.toSpawn = 0;
    for (const z of this.zombies) this.park(z);
    this.showButton(false);
    this.banner('Get ready…');
    this.broadcast();
  }
  nextWave() {
    this.wave++;
    this.best = Math.max(this.best, this.wave);
    this.toSpawn = 4 + this.wave * 2;
    this.spawnT = 0.5;
    this.sfx('wave', 0.8);
    this.banner(`Wave ${this.wave}`);
    this.broadcast();
  }
  over() {
    const w = this.wave;
    this.active = false;
    this.toSpawn = 0;
    this.revive = null;
    if (this.mp()?.isHost !== false) for (const z of this.zombies) this.park(z);
    this.showButton(true);
    this.banner(w ? `Overrun on wave ${w}` : 'Game over');
    this.onOver();
  }
  /** A world reset (host): the game's off, the dead put away. */
  reset() {
    if (this.active) { this.over(); this.broadcast(true); }
    else for (const z of this.zombies) this.park(z);
  }
  /** Everyone playing: you and the others. */
  players() {
    const mp = this.mp();
    return [this.hero, ...(mp?.live ? [...mp.players.values()].map((p) => p.actor) : [])];
  }

  /** What one of the dead is worth, this wave. */
  bounty() { return 10 + 5 * Math.floor(this.wave / 2); }
  /** The shop's open: between waves, while the game's on. */
  canShop() { return this.active && this.breakLeft() > 0; }
  breakLeft() {
    const mp = this.mp();
    if (!mp?.live || mp.isHost) return Math.max(0, this.breakT);
    return this.wasBreak ? Math.max(0, this.btLeft || 0) : 0;
  }

  park(z) {
    z.parked = true;
    z.cashDropped = false;
    z.street?.stop();
    z.home = HIDE.clone();
    z.reset();
    z.chatCool = Infinity; // (the dead don't stop for a chat)
    z.actor.hero.setVisible(false);
  }
  /** One of the dead onto the roof: out of a door, or up over the parapet. */
  raise(z) {
    const S = this.S, H = S.height;
    let p, yaw;
    if (Math.random() < 0.55) {
      const i = Math.floor(Math.random() * S.doors.length), d = S.doors[i];
      d.openT = 1.6;
      this.mp()?.send({ k: 'svDoor', i });
      this.sfx('door', 0.5);
      p = d.spot.clone();
      yaw = Math.atan2(d.out.x, d.out.z);
    } else {
      const l = S.ledges[Math.floor(Math.random() * S.ledges.length)];
      const lim = S.half - 1.1;
      p = V(Math.max(-lim, Math.min(lim, l.pos.x)), H, Math.max(-lim, Math.min(lim, l.pos.z)));
      yaw = l.yaw;
    }
    p.y = this.groundAt(p.x, p.z, H + 1);
    z.parked = false;
    z.cashDropped = false;
    z.home = p;
    z.reset();
    z.chatCool = Infinity;
    z.actor.hero.reset(p, yaw);
    z.actor.hero.setVisible(true);
    const st = z.street;
    st.zSpeed = Math.min(1, 0.52 + this.wave * 0.06) * rnd(0.85, 1.1);
    st.zRun = this.wave >= 4 && Math.random() < Math.min(0.7, (this.wave - 3) * 0.15);
    this.aim(z);
  }
  /** Go for the nearest player still on their feet (or at least alive). */
  aim(z) {
    const st = z.street, A = z.actor;
    if (A.brain.dead || z.parked) return;
    let best = null, bd = Infinity;
    for (const a of this.players()) {
      if (a.brain.dead) continue;
      const d = flat(A.hero.pos, a.hero.pos) + (a.mode === 'ragdoll' ? 6 : 0);
      if (d < bd) { bd = d; best = a; }
    }
    if (!best) return;
    if (st.mode === 'fight' && st.target === best) return;
    if (st.mode === 'fight' && st.target && !st.target.brain.dead && flat(A.hero.pos, st.target.hero.pos) < bd + 3) return;
    st.startFight(best);
  }

  hostTick(dt) {
    const up = this.zombies.filter((z) => !z.parked && !z.actor.brain.dead);
    // everyone down: a few seconds to take it in, then it's over
    if (!this.players().some((a) => !a.brain.dead)) {
      if ((this.overT = (this.overT || 0) + dt) > 3.5) { this.overT = 0; this.over(); this.broadcast(true); }
      return;
    }
    this.overT = 0;
    if (this.breakT > 0) {
      this.breakT -= dt;
      if (this.breakT <= 0) this.nextWave();
    } else if (this.wave > 0) {
      this.spawnT -= dt;
      if (this.toSpawn > 0 && up.length < MAX_UP && this.spawnT <= 0) {
        // a parked one, else the longest-dead body
        const z = this.zombies.find((q) => q.parked) || this.zombies.find((q) => q.actor.brain.dead);
        if (z) { this.raise(z); this.toSpawn--; up.push(z); }
        this.spawnT = rnd(0.5, 1.6) * Math.max(0.4, 1 - this.wave * 0.06);
      }
      if (this.toSpawn === 0 && up.length === 0) {
        this.breakT = BREAK_T;
        this.banner(`Wave ${this.wave} cleared`);
        this.broadcast();
      }
    }
    this.left = this.toSpawn + up.length;
    this.aimT -= dt;
    if (this.aimT <= 0) { this.aimT = 0.5; for (const z of up) this.aim(z); }
    this.sendT -= dt;
    if (this.sendT <= 0) this.broadcast();
  }
  broadcast(over = false) {
    this.sendT = 1;
    const mp = this.mp();
    if (!mp?.live) return;
    mp.send({ k: 'sv', on: this.active ? 1 : 0, w: this.wave, n: this.left, b: this.breakT > 0 ? 1 : 0, bt: Math.max(0, Math.round(this.breakT * 10) / 10), over: over ? 1 : 0 });
  }

  /** A survival message from someone else. */
  onEvent(m) {
    const mp = this.mp();
    if (m.k === 'svGo') { if (mp?.isHost) this.start(); return; }
    if (m.k === 'svDoor') { const d = this.S.doors[m.i]; if (d) d.openT = 1.6; return; }
    if (m.k === 'svRevive') {
      if (String(m.to) !== String(mp?.me) || !this.hero.brain.dead || !this.active) return;
      this.reviveMe();
      this.banner('Back on your feet');
      return;
    }
    if (m.k === 'sv') {
      if (mp?.isHost) return;
      const was = this.active, wv = this.wave;
      this.active = !!m.on;
      this.wave = m.w;
      this.left = m.n;
      if (this.active && !was) { this.showButton(false); this.banner('Get ready…'); }
      if (this.active && m.w !== wv && !m.b) { this.sfx('wave', 0.8); this.banner(`Wave ${m.w}`); }
      if (this.active && m.b && !this.wasBreak && m.w > 0) this.banner(`Wave ${m.w} cleared`);
      this.wasBreak = !!m.b;
      this.btLeft = m.bt || 0;
      if (!this.active && was) { this.wave = wv; this.over(); }
    }
  }

  // ---------------------------------------------------------------- every frame (everyone)
  update(dt) {
    this.t += dt;
    if (this.btLeft > 0) this.btLeft -= dt;
    const mp = this.mp();
    if (this.active && (!mp?.live || mp.isHost)) this.hostTick(dt);
    // now and then, a groan from one of them (the nearer, the louder)
    if (this.active && Math.random() < dt * 0.4) {
      const up = this.zombies.filter((z) => !z.actor.brain.dead && z.actor.hero.pos.y > HIDE.y + 20);
      const z = up[Math.floor(Math.random() * up.length)];
      const d = z ? this.hero.hero.pos.distanceTo(z.actor.hero.pos) : Infinity;
      if (d < 25) this.sfx('groan', Math.min(0.7, 6 / (d + 4)), { vary: 0.15 });
    }
    // (someone else's copies of the parked ones: out of sight too)
    for (const z of this.zombies) if (z.actor.remote && z.gest.one !== 'zombie') z.gest.play('zombie');
    for (const z of this.zombies) if (z.actor.remote) { const vis = z.actor.hero.pos.y > HIDE.y + 20; if (z.actor.hero.shown !== vis) z.actor.hero.setVisible(vis); }
    if (this.button.visible) {
      this.label.position.y = 1.55 + Math.sin(this.t * 2.4) * 0.05;
      this.capMat.emissiveIntensity = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(this.t * 4));
      this.cap.position.y += (0.96 - this.cap.position.y) * Math.min(1, dt * 6);
    }
    // kneeling over a teammate: stay close, don't die, and they're back up
    const R = this.revive;
    if (R) {
      const h = this.hero;
      if (!this.active || h.brain.dead || h.mode !== 'anim' || !R.actor.brain.dead || flat(h.hero.pos, R.actor.hero.pos) > REVIVE_R + 0.4) this.revive = null;
      else if ((R.t += dt) >= REVIVE_T) {
        mp?.send({ k: 'svRevive', to: R.id });
        this.sfx('pickup', 0.9);
        this.revive = null;
      }
    }
    this.drawHud();
  }

  showButton(on) { this.button.visible = on; }
  banner(text) {
    this.bannerText = text;
    this.bannerT = performance.now();
  }
  drawHud() {
    const fresh = this.bannerText && performance.now() - this.bannerT < 2600;
    let html = '';
    if (this.active && this.wave > 0) html += `<div class="sv-wave">Wave ${this.wave}<span>${this.left} left</span></div>`;
    if (this.canShop()) html += `<button class="sv-shopbtn"><kbd>B</kbd> Shop<span>${this.wave ? 'next wave' : 'first wave'} in ${Math.ceil(this.breakLeft())}s</span></button>`;
    if (fresh) html += `<div class="sv-banner">${this.bannerText}</div>`;
    if (html !== this._html) { this._html = html; this.hud.innerHTML = html; }
  }
  /** What the death screen should say. */
  deadText() {
    const mp = this.mp();
    const others = mp?.live && [...mp.players.values()].some((p) => !p.actor.brain.dead);
    return others ? 'Down! Wait for a teammate to revive you' : 'Down…';
  }
}
