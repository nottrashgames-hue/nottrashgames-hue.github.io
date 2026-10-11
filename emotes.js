/*
  The emote wheel: hold H, flick the mouse toward one, let go of H to do it. (Pointer-locked
  mouse movement steers a cursor out from the middle; with no pointer lock, the mouse itself.)
  What the emotes do is life.js Gestures; this is only the ring.
*/

export const EMOTES = [
  { id: 'wave', label: 'Wave' },
  { id: 'cheer', label: 'Cheer' },
  { id: 'clap', label: 'Clap' },
  { id: 'thumbsup', label: 'Thumbs Up' },
  { id: 'highfive', label: 'High Five' },
  { id: 'dance', label: 'Dance' },
  { id: 'disco', label: 'Disco' },
  { id: 'dab', label: 'Dab' },
  { id: 'flex', label: 'Flex' },
  { id: 'bow', label: 'Bow' },
  { id: 'salute', label: 'Salute' },
  { id: 'facepalm', label: 'Facepalm' },
  { id: 'shrug', label: 'Shrug' },
  { id: 'laugh', label: 'Laugh' },
  { id: 'point', label: 'Point' },
  { id: 'comeon', label: 'Come On' },
];

const R = 180;       // px: the ring's radius
const DEAD = 28;     // px: inside this, nothing's picked

export class EmoteWheel {
  constructor() {
    const el = (this.el = document.createElement('div'));
    el.id = 'emotes';
    const n = EMOTES.length;
    el.innerHTML = '<div class="ring"><div class="hub"></div>' + EMOTES.map((e, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return `<div class="emote" style="left:${Math.cos(a) * R}px;top:${Math.sin(a) * R}px">${e.label}</div>`;
    }).join('') + '</div>';
    document.body.appendChild(el);
    this.items = [...el.querySelectorAll('.emote')];
    this.hub = el.querySelector('.hub');
    this.x = 0; this.y = 0;
    this.sel = -1;
    addEventListener('mousemove', (e) => {
      if (!this.open) return;
      if (document.pointerLockElement) { this.x += e.movementX; this.y += e.movementY; }
      else { this.x = e.clientX - innerWidth / 2; this.y = e.clientY - innerHeight / 2; }
      // (the cursor stays on the ring: flicking past it doesn't lose the pick)
      const d = Math.hypot(this.x, this.y);
      if (d > R) { this.x *= R / d; this.y *= R / d; }
      this.pick();
    });
  }
  get open() { return this.el.classList.contains('on'); }
  show() {
    this.x = this.y = 0;
    this.pick();
    this.el.classList.add('on');
  }
  /** Shut it; the emote picked (or null). */
  hide() {
    if (!this.open) return null;
    this.el.classList.remove('on');
    return this.sel >= 0 ? EMOTES[this.sel].id : null;
  }
  pick() {
    const n = EMOTES.length, d = Math.hypot(this.x, this.y);
    let s = -1;
    if (d > DEAD) {
      const a = Math.atan2(this.y, this.x) + Math.PI / 2;
      s = ((Math.round((a / (Math.PI * 2)) * n) % n) + n) % n;
    }
    if (s !== this.sel) {
      this.items[this.sel]?.classList.remove('sel');
      this.items[s]?.classList.add('sel');
      this.sel = s;
    }
    this.hub.textContent = s >= 0 ? EMOTES[s].label : '';
    this.hub.style.setProperty('--dx', `${this.x}px`);
    this.hub.style.setProperty('--dy', `${this.y}px`);
  }
}
