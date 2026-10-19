import * as THREE from 'three';

/*
  A keyboard of our own, drawn on a panel in the world (no system / Meta keyboard): point a VR
  controller at a key and pull the trigger, or put the crosshair on it and click, or tap it.
  On a desktop the real keyboard types into it too while it's open.
  Used by the dressing booth (booth.js) for your name.
*/

const W = 1024, KW = 84, KH = 76, G = 10, TOP = 128, PAD = 24;
const ROWS = [
  '1234567890'.split(''),
  'qwertyuiop'.split(''),
  [...'asdfghjkl'.split(''), '-'],
  ['shift', ...'zxcvbnm'.split(''), '_', 'back'],
  ['cancel', 'space', 'done'],
];
const WIDE = { shift: 1.6, back: 1.6, space: 5.2, done: 2.4, cancel: 2.4 };
const LABEL = { shift: '⇧', back: '⌫', space: 'space', done: 'Done', cancel: 'Cancel' };
export const NAME_MAX = 16;

export class Keyboard {
  /** parent: the object it hangs on; width: metres across. */
  constructor(parent, width = 1.3) {
    this.keys = [];
    let y = TOP;
    for (const row of ROWS) {
      const units = row.reduce((s, k) => s + (WIDE[k] || 1), 0);
      const rw = units * KW + (row.length - 1) * G;
      let x = (W - rw) / 2;
      for (const k of row) {
        const w = (WIDE[k] || 1) * KW;
        this.keys.push({ k, x, y, w, h: KH });
        x += w + G;
      }
      y += KH + G;
    }
    this.H = y - G + PAD;
    this.c = document.createElement('canvas');
    this.c.width = W; this.c.height = this.H;
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const h = width * this.H / W;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, h), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.06, h + 0.06, 0.03), new THREE.MeshStandardMaterial({ color: 0x2a211b, roughness: 0.7 }));
    frame.position.z = -0.02;
    this.mesh.add(frame);
    this.mesh.visible = false;
    parent.add(this.mesh);
    this.rc = new THREE.Raycaster();
    this.text = '';
    this.shift = false;
    this.drawn = null;
    this.onKey = (e) => this.physical(e);
  }
  get open() { return this.mesh.visible; }

  /** Start typing: text to begin from, done(text) on Done (cancel: nothing). */
  show(text, done) {
    this.text = (text || '').slice(0, NAME_MAX);
    this.done = done;
    this.shift = false;
    this.mesh.visible = true;
    this.draw(-1, true);
    addEventListener('keydown', this.onKey, true);
  }
  hide() {
    this.mesh.visible = false;
    removeEventListener('keydown', this.onKey, true);
  }

  /** The key under a ray: [index, distance] (index -1: the panel, but no key; distance 0: missed). */
  pick(o, d, reach = 6) {
    if (!this.open) return [-1, 0];
    this.rc.set(o, d);
    const hit = this.rc.intersectObject(this.mesh, false)[0];
    if (!hit || hit.distance > reach) return [-1, 0];
    const px = hit.uv.x * W, py = (1 - hit.uv.y) * this.H;
    return [this.keys.findIndex((b) => px > b.x && px < b.x + b.w && py > b.y && py < b.y + b.h), hit.distance];
  }

  press(i) {
    const b = this.keys[i];
    if (!b) return false;
    this.type(b.k);
    return true;
  }
  type(k) {
    if (k === 'shift') this.shift = !this.shift;
    else if (k === 'back') this.text = this.text.slice(0, -1);
    else if (k === 'cancel') this.hide();
    else if (k === 'done') { this.hide(); this.done?.(this.text.trim()); }
    else if (this.text.length < NAME_MAX) {
      const ch = k === 'space' ? ' ' : this.shift ? k.toUpperCase() : k;
      if (ch === ' ' && (!this.text || this.text.endsWith(' '))) return;
      this.text += ch;
      this.shift = false;
    }
    this.draw(this.hover ?? -1, true);
  }
  /** The real keyboard, while it's open (and nothing else hears those keys). */
  physical(e) {
    if (!this.open || e.ctrlKey || e.metaKey || e.altKey) return;
    let k = null;
    if (e.key === 'Enter') k = 'done';
    else if (e.key === 'Escape') k = 'cancel';
    else if (e.key === 'Backspace') k = 'back';
    else if (e.key === ' ') k = 'space';
    else if (/^[a-zA-Z0-9_-]$/.test(e.key)) {
      if (this.text.length < NAME_MAX) this.text += e.key;
      this.draw(this.hover ?? -1, true);
    } else return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (k) this.type(k);
  }

  draw(hover, force) {
    this.hover = hover;
    const key = hover + '|' + this.text + '|' + this.shift;
    if (!force && key === this.drawn) return;
    this.drawn = key;
    const g = this.c.getContext('2d');
    g.fillStyle = '#17161b';
    g.fillRect(0, 0, W, this.H);
    // the line being typed
    g.beginPath(); g.roundRect(PAD, PAD, W - PAD * 2, TOP - PAD * 2, 14);
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fill();
    g.lineWidth = 3; g.strokeStyle = '#ffd65a'; g.stroke();
    g.textBaseline = 'middle'; g.textAlign = 'left';
    g.font = 'bold 44px system-ui, sans-serif';
    const ty = TOP / 2;
    if (this.text) { g.fillStyle = '#f2efe8'; g.fillText(this.text, PAD + 22, ty); }
    else { g.fillStyle = 'rgba(242,239,232,0.35)'; g.fillText('Type a name', PAD + 22, ty); }
    const cx = PAD + 22 + (this.text ? g.measureText(this.text).width : 0) + 4;
    g.fillStyle = '#ffd65a'; g.fillRect(cx, ty - 24, 4, 48);
    g.textAlign = 'right'; g.font = 'bold 24px system-ui, sans-serif'; g.fillStyle = 'rgba(242,239,232,0.4)';
    g.fillText(this.text.length + '/' + NAME_MAX, W - PAD - 18, ty);
    // the keys
    g.textAlign = 'center';
    this.keys.forEach((b, i) => {
      const special = b.k.length > 1, lit = (b.k === 'shift' && this.shift) || b.k === 'done';
      g.beginPath(); g.roundRect(b.x, b.y, b.w, b.h, 12);
      g.fillStyle = lit ? '#ffd65a' : i === hover ? 'rgba(255,255,255,0.28)' : special ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.1)';
      g.fill();
      g.fillStyle = lit ? '#15130c' : '#f2efe8';
      g.font = (special && b.k !== 'shift' && b.k !== 'back' ? 'bold 30px' : 'bold 38px') + ' system-ui, sans-serif';
      const t = LABEL[b.k] || (this.shift ? b.k.toUpperCase() : b.k);
      g.fillText(t, b.x + b.w / 2, b.y + b.h / 2 + 2);
    });
    this.tex.needsUpdate = true;
  }
}
