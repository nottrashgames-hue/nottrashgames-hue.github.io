import * as THREE from 'three';

/*
  Admin tools: for @Rick_Deckard, @Awebb55, @MemeTemple, @HappyHamster, @Kotsoft and @GreenTheLee only (by
  websim username; MemeTemple gets no nuke). A page of the ~ menu
  (spawn.js: the dark red ADMIN TOOLS button):
    NUKE        - a nuclear blast where you stand (throwables.js: seen, heard and felt by everyone)
    God mode    - nothing hurts you: no wounds, no cuts, no blasts, no death, no fire
    Eye blood   - blood pouring out of your eyes
    Laser eyes  - hold the attack button: two red beams out of your eyes at what you aim at,
                  burning through whoever they cross (real hits, like rounds)
    No ragdoll  - nothing knocks you off your feet
    Noclip      - fly through anything: WASD along the view, Space up, C / Ctrl down, Shift fast
  The flags live on the actor (god, noRagdoll, eyeBlood, laserOn) and go out in every snapshot
  (mp.js), so everyone sees the beams and the blood, and nobody else's copy wounds you.
*/

export const ADMINS = ['rick_deckard', 'awebb55', 'memetemple', 'happyhamster', 'kotsoft', 'greenthelee'];
export const isAdmin = (name) => !!name && ADMINS.includes(String(name).toLowerCase());
// (admins who get everything but the nuke)
const NO_NUKE = ['memetemple'];
// (the Gib click toggle in the admin menu - on, aiming over the shoulder at someone, a click
// blows them apart: main.js gibAll - for these two only)
const GIBBERS = ['rick_deckard', 'happyhamster'];
export const canGib = (name) => !!name && GIBBERS.includes(String(name).toLowerCase());
// (the Heart click toggle - aimed at someone, a click turns them into a burst of hearts: main.js poof)
const HEARTERS = ['rick_deckard', 'greenthelee'];
export const canHeart = (name) => !!name && HEARTERS.includes(String(name).toLowerCase());
export const canNuke = (name) => isAdmin(name) && !NO_NUKE.includes(String(name).toLowerCase());

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rnd = (a, b) => a + Math.random() * (b - a);
const _a = V(), _b = V(), _d = V(), _f = V(), _q = new THREE.Quaternion(), UP = V(0, 1, 0);

/** The page in the ~ menu. tools: { nuke(), flags: { key: { get(), set(on) } } } */
export class AdminMenu {
  constructor(panel, tools) {
    const el = (this.el = document.createElement('div'));
    el.className = 'admin';
    el.innerHTML = (tools.nuke ? '<button class="nuke">☢ NUKE</button>' : '') +
      (tools.announce ? `<div class="announce"><input maxlength="200" placeholder="Message to all players">
        <select>${[[5, '5s'], [10, '10s'], [30, '30s'], [60, '1m'], [300, '5m'], [600, '10m']].map(([s, l]) => `<option value="${s}"${s === 10 ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <button>Send</button></div>` : '') + '<div class="toggles"></div>';
    panel.appendChild(el);
    el.querySelector('.nuke')?.addEventListener('click', () => { tools.nuke(); this.onDone?.(); });
    const ann = el.querySelector('.announce');
    if (ann) {
      const input = ann.querySelector('input'), sel = ann.querySelector('select');
      const send = () => {
        const text = input.value.trim();
        if (!text) return;
        tools.announce(text, +sel.value);
        input.value = '';
        this.onDone?.();
      };
      ann.querySelector('button').addEventListener('click', send);
      // (typing here isn't playing: keys stay out of the game)
      for (const ev of ['keydown', 'keyup']) input.addEventListener(ev, (e) => {
        e.stopPropagation();
        if (ev === 'keydown' && (e.code === 'Enter' || e.code === 'NumpadEnter')) { send(); e.preventDefault(); }
      });
    }
    const box = el.querySelector('.toggles');
    const LABEL = { god: 'God mode', eyeBlood: 'Eye blood', laser: 'Laser eyes', noRagdoll: 'No ragdoll', noclip: 'Noclip', gib: 'Gib click', heart: 'Heart click' };
    this.rows = [];
    for (const [k, f] of Object.entries(tools.flags)) {
      const b = document.createElement('button');
      b.className = 'tog';
      b.addEventListener('click', () => { f.set(!f.get()); this.refresh(); });
      box.appendChild(b);
      this.rows.push({ b, f, label: LABEL[k] || k });
    }
    this.refresh();
  }
  get open() { return this.el.classList.contains('on'); }
  refresh() { for (const r of this.rows) { const on = r.f.get(); r.b.classList.toggle('on', on); r.b.textContent = r.label + (on ? '  ON' : '  OFF'); } }
  show() { this.refresh(); this.el.classList.add('on'); }
  hide() { this.el.classList.remove('on'); }
}

/**
 * The powers, drawn for everyone who has them on (you and other players alike), and the laser's
 * hits for your own. ctx: { scene, actors, blood, shots, sfx, camera, hero, aimPoint, firing() }
 */
export class AdminPowers {
  constructor(ctx) {
    this.ctx = ctx;
    this.beams = new Map();
    this.fireT = 0;
    this.zapT = 0;
    this.bleedT = 0;
    const geo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    geo.translate(0, 0.5, 0);
    this.geo = geo;
    this.core = new THREE.MeshBasicMaterial({ color: 0xffe0e0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.glow = new THREE.MeshBasicMaterial({ color: 0xff1a10, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    this.dotMat = new THREE.SpriteMaterial({ map: glowTex(), color: 0xff3020, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  }

  /** Where this actor's eyes are, and which way they look (world). Null if not to be seen. */
  eyes(a) {
    const h = a.hero;
    if (!h.eyes?.length || h.shown === false) return null;
    return h.eyes.map((e) => e.eye.getWorldPosition(V()));
  }
  beamSet(a) {
    let B = this.beams.get(a);
    if (!B) {
      B = [0, 1].map(() => {
        const g = new THREE.Group();
        const core = new THREE.Mesh(this.geo, this.core), glow = new THREE.Mesh(this.geo, this.glow);
        core.frustumCulled = glow.frustumCulled = false;
        g.add(core, glow);
        const dot = new THREE.Sprite(this.dotMat);
        this.ctx.scene.add(g, dot);
        return { g, core, glow, dot };
      });
      this.beams.set(a, B);
    }
    return B;
  }
  hideBeams(a) { const B = this.beams.get(a); if (B) for (const b of B) { b.g.visible = b.dot.visible = false; } }

  update(dt) {
    const { actors, hero, blood, shots, sfx, camera, aimPoint } = this.ctx;
    this.bleedT += dt;
    const bleed = this.bleedT >= 1 / 45;
    if (bleed) this.bleedT = 0;
    // (our own laser: on while the button's held and we're up and about)
    hero.laserOn = !!(hero.laserMode && this.ctx.firing() && !hero.brain.dead && !hero.seat);
    if (hero.laserOn) hero.laserAt = aimPoint.clone();
    for (const a of actors) {
      const near = camera.position.distanceTo(a.hero.pos) < 70;
      const eyes = (a.eyeBlood || a.laserOn) && near ? this.eyes(a) : null;
      // blood out of the eyes: running down the face, and spurting now and then
      if (a.eyeBlood && eyes && bleed) {
        a.hero.face.getWorldQuaternion(_q);
        _f.set(0, 0, 1).applyQuaternion(_q);
        for (const e of eyes) {
          const spurt = Math.random() < 0.12;
          _d.copy(_f).multiplyScalar(spurt ? 1 : 0.4).addScaledVector(UP, spurt ? 0.3 : -0.2).normalize();
          blood.inked(a).spray(e.clone().addScaledVector(_f, 0.012), _d, spurt ? rnd(3, 5) : rnd(0.6, 1.4), spurt ? 4 : 1, spurt ? 0.35 : 0.2, spurt ? 1.1 : 0.8);
        }
      }
      if (!a.laserOn || !eyes || !a.laserAt) { this.hideBeams(a); continue; }
      // the beams: from each eye to what's being looked at (ours: to whatever's in the way)
      const B = this.beamSet(a);
      const mid = _a.copy(eyes[0]).add(eyes[1]).multiplyScalar(0.5);
      let end = _b.copy(a.laserAt);
      if (a === hero) {
        _d.copy(end).sub(mid).normalize();
        const hit = shots.pick(mid.clone().addScaledVector(_d, 0.15), _d, hero, 120);
        end = hit ? _b.copy(hit.point) : _b.copy(mid).addScaledVector(_d, 120);
      }
      const t = performance.now() / 1000;
      eyes.forEach((e, i) => {
        const b = B[i];
        _d.copy(end).sub(e);
        const len = _d.length();
        if (len < 0.05) { b.g.visible = b.dot.visible = false; return; }
        b.g.visible = b.dot.visible = true;
        b.g.position.copy(e);
        b.g.quaternion.setFromUnitVectors(UP, _d.divideScalar(len));
        const w = 1 + 0.25 * Math.sin(t * 60 + i * 2);
        b.core.scale.set(0.004 * w, len, 0.004 * w);
        b.glow.scale.set(0.014 * w, len, 0.014 * w);
        b.dot.position.copy(end);
        b.dot.scale.setScalar(0.35 * w);
      });
      if (near) {
        this.zapT -= dt;
        if (this.zapT <= 0) { this.zapT = 0.5; sfx('laser', 0.5 / (1 + (camera.position.distanceTo(mid) / 12) ** 2), { vary: 0.05 }); }
      }
      // ours burns through what it touches: a hit every few hundredths of a second, eyes in turn
      if (a === hero) {
        this.fireT -= dt;
        while (this.fireT <= 0) {
          this.fireT += 0.06;
          const e = eyes[(this.eyeI = (this.eyeI || 0) ^ 1)];
          _d.copy(end).sub(e).normalize();
          shots.fire(e.clone().addScaledVector(_d, 0.15), _d.clone(), hero, false, 120);
        }
      }
    }
    // (gone: people who left)
    for (const a of this.beams.keys()) if (!actors.includes(a)) {
      for (const b of this.beams.get(a)) { b.g.removeFromParent(); b.dot.removeFromParent(); }
      this.beams.delete(a);
    }
  }
}

let GLOW = null;
function glowTex() {
  if (GLOW) return GLOW;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.3, 'rgba(255,90,60,0.8)'); r.addColorStop(1, 'rgba(255,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return (GLOW = new THREE.CanvasTexture(c));
}

/**
 * Noclip: a stand-in for the level's colliders under your feet - the floor is wherever you're
 * flying, and nothing is in the way. fly(hero, input, dt) moves you.
 */
export class Noclip {
  constructor() {
    this.y = 0;
    const self = this;
    this.colliders = {
      groundAt: () => self.y,
      resolve() {},
      blocked: () => false,
      solids: [], circles: [],
    };
  }
  start(hero) { this.y = hero.hero.pos.y; }
  /** Your own move for this frame: WASD along the view, Space / C (or Ctrl) up / down, Shift fast. */
  fly(hero, { move, run, up, down }, dt) {
    const h = hero.hero, sp = run ? 22 : 7;
    h.pos.x += move.x * sp * dt;
    h.pos.z += move.z * sp * dt;
    this.y += ((up ? sp : 0) - (down ? sp : 0)) * dt;
    h.pos.y = this.y;
    h.vel.set(0, 0, 0);
    h.vy = 0;
    h.grounded = true;
  }
}
