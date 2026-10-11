import * as THREE from 'three';

/*
  Cash in the world: folded bundles of bills that fall, settle on whatever is below them and
  slowly turn so they catch the eye. Walk (or tumble) over one to pocket it. The wallet is
  saved between visits.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rnd = (a, b) => a + Math.random() * (b - a);
const KEY = 'cash';

function billTex() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 112;
  const g = c.getContext('2d');
  g.fillStyle = '#9dbb8a'; g.fillRect(0, 0, 256, 112);
  g.strokeStyle = '#4f7045'; g.lineWidth = 6; g.strokeRect(8, 8, 240, 96);
  g.lineWidth = 2; g.strokeRect(18, 18, 220, 76);
  g.fillStyle = '#6f9262';
  g.beginPath(); g.ellipse(128, 56, 30, 34, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#35502f';
  g.font = '700 40px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('$', 128, 58);
  g.font = '700 22px Georgia, serif';
  g.fillText('20', 40, 36); g.fillText('20', 216, 78);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let GEO = null, MATS = null;
function bundle() {
  if (!GEO) {
    GEO = { stack: new THREE.BoxGeometry(0.16, 0.022, 0.07), band: new THREE.BoxGeometry(0.03, 0.026, 0.074) };
    const face = new THREE.MeshStandardMaterial({ map: billTex(), roughness: 0.85 });
    const edge = new THREE.MeshStandardMaterial({ color: 0xd9dcc8, roughness: 0.9 });
    MATS = { stack: [edge, edge, face, face, edge, edge], band: new THREE.MeshStandardMaterial({ color: 0xc9a13a, roughness: 0.6 }) };
  }
  const g = new THREE.Group();
  const s = new THREE.Mesh(GEO.stack, MATS.stack);
  const b = new THREE.Mesh(GEO.band, MATS.band);
  s.castShadow = true;
  g.add(s, b);
  return g;
}

export class Money {
  constructor(scene, colliders, sfx) {
    this.scene = scene;
    this.colliders = colliders;
    this.sfx = sfx;
    this.items = [];
    this.amount = +(localStorage.getItem(KEY) || 0) || 0;
    this.el = document.getElementById('cash');
    this.popEl = document.getElementById('cashpop');
    this.show();
  }

  show() {
    if (this.el) this.el.textContent = `$${this.amount}`;
    localStorage.setItem(KEY, String(this.amount));
    this.onChange?.(this.amount);
  }
  /** Loaded from the saved profile. */
  set(v) { this.amount = Math.max(0, v | 0); this.show(); }
  pop(text, bad = false) {
    if (!this.popEl) return;
    this.popEl.textContent = text;
    this.popEl.classList.toggle('bad', bad);
    this.popEl.classList.remove('on');
    void this.popEl.offsetWidth; // restart the animation
    this.popEl.classList.add('on');
  }
  add(v) { this.amount += v; this.show(); this.pop(`+$${v}`); }
  /** Spend if we can afford it. */
  spend(v) {
    if (this.amount < v) { this.pop(`need $${v - this.amount} more`, true); return false; }
    this.amount -= v; this.show(); this.pop(`-$${v}`, true);
    return true;
  }

  /** A bundle worth `value` at world `pos`, thrown with `vel` (it drops to the surface below). */
  /** Robbed: up to v comes out of your pocket; returns how much they got. */
  take(v) {
    const got = Math.min(this.amount, v);
    if (got <= 0) return 0;
    this.amount -= got; this.show(); this.pop(`-$${got}`, true);
    return got;
  }
  /** (id: one everybody has a copy of - taking it takes it for all, see onTake / remove;
   *  mine: I just threw it, so it doesn't jump straight back into my pocket) */
  spawn(pos, value, vel = V(), id = null, mine = false) {
    const mesh = bundle();
    mesh.position.copy(pos);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(mesh);
    this.items.push({ mesh, value, vel: vel.clone(), spin: rnd(0.6, 1) * (Math.random() < 0.5 ? -1 : 1), age: 0, rest: false, id, wait: mine ? 1.5 : 0.4 });
  }
  /** Someone died: sometimes they had cash on them, spilled around where they fell. */
  dropFrom(pos, chance = 0.6) {
    if (Math.random() > chance) return;
    const total = Math.round(rnd(15, 90) / 5) * 5, n = total > 50 ? 2 + (Math.random() < 0.4) : 1;
    for (let i = 0; i < n; i++) {
      const v = i < n - 1 ? Math.round(total / n / 5) * 5 : total - Math.round(total / n / 5) * 5 * (n - 1);
      this.spawn(pos.clone().add(V(rnd(-0.15, 0.15), 0.1, rnd(-0.15, 0.15))), v, V(rnd(-1.2, 1.2), rnd(1, 2.2), rnd(-1.2, 1.2)));
    }
  }
  /** Someone else picked it up. */
  remove(id) {
    const i = this.items.findIndex((it) => it.id === id);
    if (i < 0) return;
    this.items[i].mesh.removeFromParent();
    this.items.splice(i, 1);
  }
  clear() {
    for (const it of this.items) it.mesh.removeFromParent();
    this.items = [];
  }

  /** Fall, settle, turn; `pickers` = [{ pos (centre of mass), vel }] of whoever can take it. */
  update(dt, picker) {
    const C = this.colliders, keep = [];
    for (const it of this.items) {
      const m = it.mesh, p = m.position;
      it.age += dt;
      if (!it.rest) {
        it.vel.y -= 9.81 * dt;
        p.addScaledVector(it.vel, dt);
        m.rotation.x += it.vel.length() * dt * 2 * it.spin;
        const gy = C.groundAt(p.x, p.z, p.y + 0.05);
        if (p.y <= gy + 0.012) {
          p.y = gy + 0.012;
          it.vel.multiplyScalar(0.25);
          if (Math.abs(it.vel.y) < 0.4) { it.rest = true; it.base = p.y; m.rotation.x = 0; m.rotation.z = 0; }
          else it.vel.y = Math.abs(it.vel.y) * 0.3;
        }
      } else {
        // a slow turn and a faint lift so it reads as something to pick up
        m.rotation.y += dt * 0.9 * it.spin;
        p.y = it.base + 0.03 + Math.sin(it.age * 2.2) * 0.015;
      }
      // walking over it (or landing on it)
      if (picker && it.age > it.wait) {
        const dx = picker.pos.x - p.x, dz = picker.pos.z - p.z, dy = picker.pos.y - p.y;
        if (dx * dx + dz * dz < 0.5 * 0.5 && dy > -0.3 && dy < 1.4) {
          m.removeFromParent();
          this.add(it.value);
          this.sfx?.('cash', 0.8);
          if (it.id) this.onTake?.(it);
          continue;
        }
      }
      keep.push(it);
    }
    this.items = keep;
  }
}
