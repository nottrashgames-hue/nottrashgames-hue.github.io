import * as THREE from 'three';

/*
  Hearts: a body gone up in a burst of pink and red hearts (the admin menu's Heart click, admin.js
  canHeart). burst(actor) throws a cloud of little hearts out of every part of the body - they
  pop out, drift up, tumble and fade.
*/

const rnd = (a, b) => a + Math.random() * (b - a);
const COLS = [0xff2d6f, 0xff5c9a, 0xff8fc0, 0xe0103f, 0xffb3d6, 0xff4060];
let TEX = null;
function heartTex() {
  if (TEX) return TEX;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(32, 56);
  g.bezierCurveTo(4, 36, 4, 12, 20, 10);
  g.bezierCurveTo(28, 9, 32, 16, 32, 20);
  g.bezierCurveTo(32, 16, 36, 9, 44, 10);
  g.bezierCurveTo(60, 12, 60, 36, 32, 56);
  g.fill();
  TEX = new THREE.CanvasTexture(c);
  TEX.colorSpace = THREE.SRGBColorSpace;
  return TEX;
}

export class Hearts {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.mats = COLS.map((c) => new THREE.SpriteMaterial({ map: heartTex(), color: c, transparent: true, depthWrite: false }));
  }

  /** A body gone up in hearts: out of each part of it. */
  burst(actor) {
    const pts = [];
    for (const g of Object.values(actor.groups || {})) if (g?.getWorldPosition) pts.push(g.getWorldPosition(new THREE.Vector3()));
    if (!pts.length) pts.push(actor.hero.pos.clone().setY(actor.hero.pos.y + 1));
    const n = 110;
    for (let i = 0; i < n; i++) {
      const at = pts[i % pts.length].clone().add(new THREE.Vector3(rnd(-0.08, 0.08), rnd(-0.08, 0.08), rnd(-0.08, 0.08)));
      const s = new THREE.Sprite(this.mats[(Math.random() * this.mats.length) | 0].clone());
      s.position.copy(at);
      const size = rnd(0.07, 0.17);
      s.scale.setScalar(0.001);
      this.scene.add(s);
      const v = new THREE.Vector3(rnd(-1, 1), rnd(0.2, 1.4), rnd(-1, 1)).normalize().multiplyScalar(rnd(1.2, 3.6));
      this.list.push({ s, v, size, t: 0, life: rnd(1.6, 2.8), spin: rnd(-3, 3), wob: rnd(0, 6.28) });
    }
    // (too many about: the oldest go)
    while (this.list.length > 600) this.kill(0);
  }
  kill(i) {
    const h = this.list[i];
    this.scene.remove(h.s);
    h.s.material.dispose();
    this.list.splice(i, 1);
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const h = this.list[i];
      h.t += dt;
      if (h.t >= h.life) { this.kill(i); continue; }
      // out fast, then floating up, swaying
      h.v.multiplyScalar(Math.exp(-dt * 2.2));
      h.v.y += dt * 0.9;
      h.s.position.addScaledVector(h.v, dt);
      h.s.position.x += Math.sin(h.t * 4 + h.wob) * dt * 0.15;
      const u = h.t / h.life;
      const pop = Math.min(1, h.t / 0.12);
      h.s.scale.setScalar(h.size * pop * (1 + 0.15 * Math.sin(h.t * 9 + h.wob)));
      h.s.material.rotation += h.spin * dt;
      h.s.material.opacity = u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
    }
  }
}
