import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { HAIR_STYLES } from './character.js';
import { TOPS, BOTTOMS, SHOES, HAIRS, SKIN_PICK, STYLE_NAMES } from './wardrobe.js';
import { Keyboard } from './vrkeyboard.js';

/*
  The dressing booth in the main menu room: a full-length mirror and, beside it, a panel of
  everything you can change - look at a button (the crosshair) and click, tap it, or point a VR
  controller at it and pull the trigger. Every pick goes straight on (free), and is saved.
*/

const W = 1024, PW = 1.5, REACH = 6, MIRROR_NEAR = 4.5;
const LX = 200, RX = W - 28, SW = 54, TB = 118, BH = 52, G = 8, PAD = 26, ROWG = 18;
const ROWS = [
  ['Skin', 'skin', SKIN_PICK],
  ['Hair', 'hairStyle', HAIR_STYLES.map((s) => [s, STYLE_NAMES[s] || s])],
  ['Colour', 'hair', HAIRS],
  ['Beard', 'beard', [[null, 'None'], ['short', 'Stubble'], ['full', 'Beard']]],
  ['Top', 'top', TOPS],
  ['Sleeves', 'sleeves', [['short', 'Short'], ['long', 'Long']]],
  ['Bottoms', 'shorts', BOTTOMS],
  ['Length', 'legs', [['short', 'Shorts'], ['long', 'Trousers']]],
  ['Shoes', 'shoe', SHOES],
];
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _d = new THREE.Vector3();

export class DressingBooth {
  /** spot: { mirror: {pos, yaw}, panel: {pos, yaw} }; body(): the player's Character; changed() after each pick. */
  /** naming: { get(): the name now, set(name) } - the Name row, typed on our own keyboard (vrkeyboard.js). */
  constructor(scene, spot, body, changed, naming = null) {
    this.body = body; this.changed = changed; this.naming = naming;
    this.group = new THREE.Group();
    scene.add(this.group);

    // the mirror: a frame with dull glass in it from afar; the real reflection (a whole extra
    // render of the scene) is only built - and drawn - once you're near it (see nearMirror)
    const MW = 1.2, MH = 2.1;
    const holder = this.mirrorHolder = new THREE.Group();
    holder.position.copy(spot.mirror.pos); holder.rotation.y = spot.mirror.yaw;
    const mf = new THREE.Mesh(new THREE.BoxGeometry(MW + 0.12, MH + 0.12, 0.05), new THREE.MeshStandardMaterial({ color: 0x3b2c22, roughness: 0.6 }));
    mf.position.z = -0.03;
    holder.add(mf);
    this.glass = new THREE.Mesh(new THREE.PlaneGeometry(MW, MH), new THREE.MeshStandardMaterial({ color: 0x9aa3a8, roughness: 0.3, metalness: 0.6 }));
    holder.add(this.glass);
    this.mirrorSize = [MW, MH];
    this.mirror = null;
    this.group.add(holder);

    // the panel: laid out once, every option a button
    this.buttons = [];
    let y = PAD;
    // the name you go by, over your head on everyone's screen: click it to type a new one
    const nameRow = naming ? { label: 'Name', y, h: BH } : null;
    if (naming) { this.buttons.push({ key: '__name', x: LX, y, w: RX - LX, h: BH }); y += BH + ROWG; }
    this.rows = ROWS.map(([label, key, items]) => {
      const colors = typeof items[0] === 'number', bw = colors ? SW : TB, bh = colors ? SW : BH;
      const per = Math.floor((RX - LX + G) / (bw + G));
      const top = y;
      items.forEach((it, i) => {
        const val = colors ? it : it[0];
        this.buttons.push({ key, val, text: colors ? null : it[1], x: LX + (i % per) * (bw + G), y: top + Math.floor(i / per) * (bh + G), w: bw, h: bh });
      });
      y += Math.ceil(items.length / per) * (bh + G) - G + ROWG;
      return { label, y: top, h: bh };
    });
    if (nameRow) this.rows.unshift(nameRow);
    const H = this.H = Math.ceil(y - ROWG + PAD);
    this.c = document.createElement('canvas');
    this.c.width = W; this.c.height = H;
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const PH = PW * H / W;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    this.mesh.position.copy(spot.panel.pos); this.mesh.rotation.y = spot.panel.yaw;
    const pf = new THREE.Mesh(new THREE.BoxGeometry(PW + 0.1, PH + 0.1, 0.05), new THREE.MeshStandardMaterial({ color: 0x3b2c22, roughness: 0.7 }));
    pf.position.z = -0.03;
    this.mesh.add(pf);
    this.group.add(this.mesh);
    // the keyboard comes up just in front of the panel, over its top
    this.kb = new Keyboard(this.mesh, PW * 0.96);
    const kbH = PW * 0.96 * this.kb.H / 1024;
    this.kb.mesh.position.set(0, PH / 2 - kbH / 2 - 0.02, 0.1);

    this.rc = new THREE.Raycaster();
    this.hover = -1;
    this.trig = { left: true, right: true };
    this.laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0xffd65a, transparent: true, opacity: 0.85, fog: false }));
    this.laser.frustumCulled = false;
    this.laser.visible = false;
    scene.add(this.laser);
    this.draw(-1, true);
  }

  set visible(on) { this.group.visible = on; if (!on) { this.laser.visible = false; this.kb?.hide(); } }

  /** The reflection only within MIRROR_NEAR m of the mirror (built the first time you come close). */
  nearMirror(camera) {
    camera.getWorldPosition(_p);
    const d = _p.distanceTo(this.mirrorHolder.position);
    const on = this.mirror?.visible ? d < MIRROR_NEAR + 0.6 : d < MIRROR_NEAR;
    if (on && !this.mirror) {
      const [MW, MH] = this.mirrorSize;
      // (a real reflection: everything, your own head too - even in a headset, where it's hidden from your eyes)
      const m = this.mirror = new Reflector(new THREE.PlaneGeometry(MW, MH), { textureWidth: 512, textureHeight: 896, color: 0xb8c0c4, multisample: 2 });
      m.camera.layers.enableAll();
      const before = m.onBeforeRender;
      m.onBeforeRender = (r, s, c, ...rest) => {
        const head = this.body().head, was = head.visible;
        head.visible = true;
        before.call(m, r, s, c, ...rest);
        head.visible = was;
      };
      this.mirrorHolder.add(m);
    }
    if (this.mirror) this.mirror.visible = on;
    this.glass.visible = !on;
  }

  /** What's worn, as a string: redraw when it changes (or the hover moves). */
  key(hover) { const L = this.body().look; return hover + '|' + (this.naming?.get() || '') + '|' + ROWS.map(([, k]) => L[k]).join(','); }

  draw(hover, force) {
    const k = this.key(hover);
    if (!force && k === this.drawn) return;
    this.drawn = k;
    const g = this.c.getContext('2d'), L = this.body().look;
    g.fillStyle = '#17161b';
    g.fillRect(0, 0, W, this.H);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = 'bold 34px system-ui, sans-serif';
    g.fillStyle = '#bdb8ae';
    for (const r of this.rows) g.fillText(r.label, PAD, r.y + r.h / 2 + 1);
    g.textAlign = 'center';
    g.font = 'bold 28px system-ui, sans-serif';
    this.buttons.forEach((b, i) => {
      if (b.key === '__name') {
        g.beginPath(); g.roundRect(b.x, b.y, b.w, b.h, 12);
        g.fillStyle = i === hover ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)'; g.fill();
        g.textAlign = 'left'; g.fillStyle = '#f2efe8';
        g.fillText(this.naming.get(), b.x + 18, b.y + b.h / 2 + 1);
        g.textAlign = 'right'; g.fillStyle = '#ffd65a';
        g.fillText('✎ Edit', b.x + b.w - 18, b.y + b.h / 2 + 1);
        g.textAlign = 'center';
        return;
      }
      const on = L[b.key] === b.val || (b.key === 'beard' && b.val === null && !L.beard), hov = i === hover;
      g.beginPath(); g.roundRect(b.x, b.y, b.w, b.h, b.text ? 12 : 10);
      if (b.text) {
        g.fillStyle = on ? '#ffd65a' : hov ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)';
        g.fill();
        g.fillStyle = on ? '#15130c' : '#f2efe8';
        g.fillText(b.text, b.x + b.w / 2, b.y + b.h / 2 + 1);
      } else {
        g.fillStyle = hex(b.val);
        g.fill();
        if (on || hov) { g.lineWidth = on ? 6 : 3; g.strokeStyle = on ? '#ffd65a' : '#f2efe8'; g.stroke(); }
      }
    });
    this.tex.needsUpdate = true;
  }

  pick(o, d) {
    // (the keyboard's up: it's all you can point at, its keys numbered after the panel's buttons)
    if (this.kb.open) {
      const [i, dist] = this.kb.pick(o, d, REACH);
      return [i >= 0 ? this.buttons.length + i : -1, dist];
    }
    this.rc.set(o, d);
    const hit = this.rc.intersectObject(this.mesh, false)[0];
    if (!hit || hit.distance > REACH) return [-1, 0];
    const px = hit.uv.x * W, py = (1 - hit.uv.y) * this.H;
    return [this.buttons.findIndex((b) => px > b.x && px < b.x + b.w && py > b.y && py < b.y + b.h), hit.distance];
  }

  choose(i) {
    if (this.kb.open) return this.kb.press(i - this.buttons.length) || true;
    const b = this.buttons[i];
    if (!b) return false;
    if (b.key === '__name') {
      this.kb.show(this.naming.get(), (name) => { this.naming.set(name); this.draw(this.hover, true); });
      return true;
    }
    this.body().restyle({ [b.key]: b.val });
    this.changed?.();
    return true;
  }

  /** Each frame (while in the menu room). camera: the crosshair ray; vr: the controllers in a headset. */
  update(camera, vr) {
    if (!this.group.visible) return;
    this.nearMirror(camera);
    let hover = -1;
    this.laser.visible = false;
    if (vr?.on) {
      for (const hand of ['right', 'left']) {
        const slot = vr.hands[hand], down = vr.btnDown(hand, 0), was = this.trig[hand];
        this.trig[hand] = down;
        if (!slot?.ray.visible || vr.uiOpen()) continue;
        slot.ray.matrixWorld.decompose(_p, _q, _s);
        _d.set(0, 0, -1).applyQuaternion(_q);
        const [i, dist] = this.pick(_p, _d);
        if (!dist || hover >= 0) continue;
        hover = i;
        this.laser.position.copy(_p); this.laser.quaternion.copy(_q); this.laser.scale.set(1, 1, dist);
        this.laser.visible = true;
        if (i !== this.hover && i >= 0) vr.buzz(hand, 0.15, 20);
        if (i >= 0 && down && !was) { vr.buzz(hand, 0.5, 50); this.choose(i); }
      }
    } else {
      camera.getWorldPosition(_p);
      camera.getWorldDirection(_d);
      hover = this.pick(_p, _d)[0];
    }
    this.hover = hover;
    this.draw(this.kb.open ? -1 : hover);
    if (this.kb.open) this.kb.draw(hover >= this.buttons.length ? hover - this.buttons.length : -1);
  }

  click() { return this.hover >= 0 && this.choose(this.hover); }

  tap(camera, x, y) {
    this.rc.setFromCamera(new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
    const [i] = this.pick(this.rc.ray.origin.clone(), this.rc.ray.direction.clone());
    return i >= 0 && this.choose(i);
  }
}
