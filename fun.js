import * as THREE from 'three';
import { Character, HAIR_STYLES, SHAPE_KEYS } from './character.js';
import { sanitizeLook, DEFAULT_LOOK, SHAPE_RANGE, HAIR_RANGE, TOPS, BOTTOMS, SHOES, HAIRS, STYLE_NAMES } from './wardrobe.js';
import { SKINS } from './people.js';

/*
  The FUN menu (inside the baseplate's spawn menu): make your character whatever you like, free.
  A little turntable shows every change at once; clothes and colours go straight onto you too.
  Body proportions are built into a body (and its ragdoll), so those take a respawn: Apply
  saves the look and rebuilds the world with you in it.
*/

const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const FUN_SKINS = [...SKINS.filter((_, i) => i % 2 === 0), 0x7fc46a, 0x5a9ee0, 0x9a6ad0, 0xe06a8a, 0x9aa0a8, 0xf4f4f0];
const SLIDER_NAMES = { height: 'Height', build: 'Width', limb: 'Limb size', armLen: 'Arm length', legLen: 'Leg length', headSize: 'Head size',
  handSize: 'Hands', footSize: 'Feet', neckLen: 'Neck', eyeSize: 'Eyes', hairSize: 'Hair size' };
const EYES = [0x2b1d14, 0x5a3a1e, 0x3a6fb0, 0x6fb3e0, 0x3f8a4a, 0x8a8f3a, 0x7a7f88, 0x111111, 0xc0282b, 0x8a3ac0, 0xe0b020];

const TABS = [
  { name: 'Body', rows: [
    { key: 'sex', opts: [['m', 'Male'], ['f', 'Female']] },
    ...SHAPE_RANGE.map(([key, min, max]) => ({ key, slider: [min, max] })),
  ] },
  { name: 'Skin', rows: [{ key: 'skin', colors: FUN_SKINS }, { key: 'eyeColor', colors: EYES, label: 'Eyes' }] },
  { name: 'Clothes', rows: [
    { key: 'sleeves', opts: [['short', 'T-shirt'], ['long', 'Long sleeve'], ['tank', 'Tank top']] },
    { key: 'top', colors: TOPS },
    { key: 'legs', opts: [['short', 'Shorts'], ['long', 'Trousers']] },
    { key: 'shorts', colors: BOTTOMS },
    { key: 'shoe', colors: SHOES, label: 'Shoes' },
  ] },
  { name: 'Hair', rows: [
    { key: 'hairStyle', opts: HAIR_STYLES.map((s) => [s, STYLE_NAMES[s]]) },
    ...HAIR_RANGE.map(([key, min, max]) => ({ key, slider: [min, max], live: true })),
    { key: 'hair', colors: HAIRS },
    { key: 'beard', opts: [[null, 'Clean'], ['short', 'Stubble'], ['full', 'Beard'], ['mustache', 'Mustache'], ['goatee', 'Goatee']] },
  ] },
];
const IDLE = { move: V(), run: false, jump: false, crouch: false, camYaw: Math.PI };

export class FunMenu {
  /** body = the player's Character; save(look) keeps it; rebuild(look) respawns into a new body. */
  constructor(parent, body, { save, rebuild, sfx, special }) {
    this.body = body; this.save = save; this.rebuild = rebuild; this.sfx = sfx;
    this.special = special; // { on, set(on) } for someone with a custom character of their own
    this.tab = 0;
    this.open = false;
    const el = (this.el = document.createElement('div'));
    el.className = 'fun';
    el.innerHTML = `<canvas class="doll"></canvas>
      <div class="side"><div class="tabs"></div><div class="rows"></div>
      <div class="foot"><button class="spec" hidden></button><button class="reset">Reset</button><button class="apply">Done</button></div></div>`;
    parent.appendChild(el);
    this.canvas = el.querySelector('.doll');
    el.querySelector('.reset').addEventListener('click', () => this.reset());
    if (special?.skins) {
      // several skins of their own: one button each (the one worn lit), and the normal body
      const spec = el.querySelector('.spec'), box = document.createElement('span');
      box.className = 'skins';
      spec.parentNode.insertBefore(box, spec);
      const opts = [...special.skins.map((n, i) => [n, special.on && special.skin === i, () => special.set(true, i)]),
        ['Normal', !special.on, () => special.set(false)]];
      for (const [name, on, pick] of opts) {
        const b = document.createElement('button');
        b.className = on ? 'on' : '';
        b.textContent = name;
        b.disabled = on;
        b.addEventListener('click', () => { this.open = false; pick(); });
        box.appendChild(b);
      }
    } else if (special) {
      const b = el.querySelector('.spec');
      b.hidden = false;
      b.textContent = special.on ? 'Use normal character' : 'Reset back to custom skin';
      b.classList.toggle('go', !special.on);
      b.addEventListener('click', () => { this.open = false; special.set(!special.on); });
    }
    el.querySelector('.apply').addEventListener('click', () => this.apply());
    // drag the doll round
    let drag = null;
    this.canvas.addEventListener('pointerdown', (e) => { drag = e.clientX; this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => { if (drag != null) { this.spin -= (e.clientX - drag) * 0.012; drag = e.clientX; this.spinT = 3; } });
    this.canvas.addEventListener('pointerup', () => { drag = null; });
  }

  // ---------- the turntable ----------
  initStage() {
    if (this.renderer) return;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true }));
    r.setPixelRatio(Math.min(2, devicePixelRatio));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3530, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 4, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xbcd4ff, 1.1);
    rim.position.set(-3, 2, -3);
    this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.55, 40), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.002;
    this.scene.add(floor);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
    this.spin = 0.35; this.spinT = 0;
  }

  shapeOf(l) { return SHAPE_KEYS.map((k) => l[k]).join(); }

  /** A fresh doll for the current proportions (clothes and colours restyle it in place). */
  buildDoll() {
    this.dropDoll();
    const L = this.body.look, fixed = L.fixed ? Object.fromEntries(L.fixed.map((k) => [k, L[k]])) : null;
    const look = { ...this.cur, ...fixed, fixed: L.fixed, wardrobe: true };
    // (a special body: the sliders scale its own proportions - special.js wearSpecial)
    if (L.base) for (const k in L.base) look[k] = L.base[k] * (this.cur[k] || 1);
    const d = (this.doll = new Character(this.scene, look));
    d.reset(V(), 0);
    this.dollShape = this.shapeOf(this.cur);
    this.parts = [d.root, ...d.legs.flatMap((l) => [l.thigh, l.shin, l.foot]), ...d.arms.flatMap((a) => [a.upper, a.fore])];
  }
  dropDoll() {
    if (!this.doll) return;
    for (const o of this.parts) {
      o.removeFromParent();
      o.traverse((m) => { if (m.isMesh) m.geometry.dispose(); });
    }
    for (const m of Object.values(this.doll.mat)) m.dispose();
    this.doll = null;
  }

  frame = () => {
    if (!this.open) return;
    requestAnimationFrame(this.frame);
    const now = performance.now(), dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    if (this.dirtyT != null && now > this.dirtyT) { this.dirtyT = null; this.buildDoll(); }
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())) this.renderer.setSize(w, h, false);
    this.doll.update(dt, IDLE);
    // slow turn (paused a moment after you drag it)
    this.spinT -= dt;
    if (this.spinT <= 0) this.spin += dt * 0.5;
    const D = this.doll.D, H = D.HIP_Y + 0.72 * this.doll.S * ((this.cur.headSize - 1) * 0.3 + 1);
    const dist = H * 2.2 + 0.6, ty = H * 0.52;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(Math.sin(this.spin) * dist, ty + 0.15, Math.cos(this.spin) * dist);
    this.camera.lookAt(0, ty, 0);
    this.renderer.render(this.scene, this.camera);
  };

  // ---------- open / close ----------
  show() {
    this.initStage();
    this.open = true;
    this.cur = sanitizeLook(this.body.look);
    const B = this.body.look.base;
    if (B) for (const k in B) this.cur[k] = Math.round((this.body.look[k] / B[k]) * 100) / 100;
    this.built = this.shapeOf(this.cur); // (what the real body is made as)
    this.el.classList.add('on');
    this.buildDoll();
    this.render();
    this.last = 0;
    requestAnimationFrame(this.frame);
  }
  hide() {
    if (!this.open) return;
    this.open = false;
    this.el.classList.remove('on');
    this.dropDoll();
    this.save(this.cur);
  }

  get pending() { return this.shapeOf(this.cur) !== this.built; }

  set(key, v, quiet) {
    this.cur[key] = v;
    if (SHAPE_KEYS.includes(key)) this.dirtyT = performance.now() + (quiet ? 90 : 0);
    else { this.doll.restyle({ [key]: v }); this.body.restyle({ [key]: v }); }
    if (!quiet) { this.sfx?.('pickup', 0.25); this.render(); } else this.renderFoot();
  }

  reset() {
    const keep = this.cur;
    this.cur = sanitizeLook({ ...DEFAULT_LOOK });
    this.body.restyle(this.cur);
    this.doll.restyle(this.cur);
    if (this.shapeOf(keep) !== this.shapeOf(this.cur)) this.dirtyT = performance.now();
    this.sfx?.('pickup', 0.3);
    this.render();
  }

  apply() {
    if (this.pending) { this.open = false; this.rebuild(this.cur); return; }
    this.hide();
    this.onDone?.();
  }

  // ---------- the controls ----------
  renderFoot() {
    const b = this.el.querySelector('.apply');
    b.textContent = this.pending ? 'Apply & respawn' : 'Done';
    b.classList.toggle('go', this.pending);
  }

  render() {
    const tabs = this.el.querySelector('.tabs');
    tabs.innerHTML = '';
    TABS.forEach((t, i) => {
      const b = document.createElement('button');
      b.textContent = t.name;
      b.classList.toggle('on', i === this.tab);
      b.addEventListener('click', () => { this.tab = i; this.render(); });
      tabs.appendChild(b);
    });
    const rows = this.el.querySelector('.rows');
    rows.innerHTML = '';
    for (const r of TABS[this.tab].rows) {
      const row = document.createElement('div');
      if (r.slider) {
        row.className = 'row sl';
        const [min, max] = r.slider;
        row.innerHTML = `<label>${SLIDER_NAMES[r.key]}</label><input type="range" min="${min}" max="${max}" step="0.01"><output></output>`;
        const inp = row.querySelector('input'), out = row.querySelector('output');
        const show = () => { out.textContent = Math.round(this.cur[r.key] * 100) + '%'; };
        inp.value = this.cur[r.key];
        show();
        inp.addEventListener('input', () => { this.set(r.key, +inp.value, true); show(); });
        inp.addEventListener('dblclick', () => { inp.value = 1; this.set(r.key, 1, true); show(); });
      } else if (r.colors) {
        row.className = 'row sw';
        if (r.label) row.dataset.label = r.label;
        let match = false;
        for (const c of r.colors) {
          const b = document.createElement('button');
          b.style.background = hex(c);
          const on = this.cur[r.key] === c;
          match ||= on;
          b.classList.toggle('on', on);
          b.addEventListener('click', () => this.set(r.key, c));
          row.appendChild(b);
        }
        // any colour at all
        const pick = document.createElement('label');
        pick.className = 'pick' + (match ? '' : ' on');
        pick.innerHTML = '<input type="color">';
        const ci = pick.querySelector('input');
        ci.value = hex(this.cur[r.key] ?? 0);
        if (!match) pick.style.background = ci.value;
        ci.addEventListener('input', () => {
          const v = parseInt(ci.value.slice(1), 16);
          this.cur[r.key] = v;
          this.doll.restyle({ [r.key]: v }); this.body.restyle({ [r.key]: v });
          pick.style.background = ci.value;
          pick.classList.add('on');
          for (const b of row.querySelectorAll('button')) b.classList.remove('on');
        });
        row.appendChild(pick);
      } else {
        row.className = 'row op';
        for (const [val, name] of r.opts) {
          const b = document.createElement('button');
          b.textContent = name;
          b.classList.toggle('on', this.cur[r.key] === val);
          b.addEventListener('click', () => this.set(r.key, val));
          row.appendChild(b);
        }
      }
      rows.appendChild(row);
    }
    this.renderFoot();
  }
}
