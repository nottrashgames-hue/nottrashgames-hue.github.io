import * as THREE from 'three';

/*
  Every other player's name, floating over their head (a sprite: seen the same in a headset as
  on a screen). Names come from the session: each mp.players entry's look.name (sent with the
  outfit - main.js netLook) or its name.
*/

const H = 64;

class Tag {
  constructor(scene) {
    this.c = document.createElement('canvas');
    this.c.height = H;
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false, fog: false }));
    this.sprite.renderOrder = 998;
    scene.add(this.sprite);
    this.text = null;
  }
  set(text) {
    if (text === this.text) return;
    this.text = text;
    const g = this.c.getContext('2d');
    g.font = 'bold 40px system-ui, sans-serif';
    const w = Math.ceil(g.measureText(text).width) + 40;
    this.c.width = w;
    g.font = 'bold 40px system-ui, sans-serif';
    g.fillStyle = 'rgba(15,21,20,0.72)';
    g.beginPath(); g.roundRect(0, 4, w, H - 8, (H - 8) / 2); g.fill();
    g.fillStyle = '#f2efe8';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, H / 2 + 1);
    this.tex.dispose();
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite.material.map = this.tex;
    this.sprite.material.needsUpdate = true;
    const k = 0.0028; // m per pixel
    this.sprite.scale.set(w * k * 0.5, H * k * 0.5, 1);
  }
  dispose() { this.sprite.removeFromParent(); this.tex.dispose(); this.sprite.material.dispose(); }
}

const _p = new THREE.Vector3();

export class NameTags {
  constructor(scene) { this.scene = scene; this.tags = new Map(); }
  /** Each frame: players = mp.players (id -> { name, look, actor }). */
  update(players, on = true) {
    for (const [id, t] of this.tags) if (!players.has(id)) { t.dispose(); this.tags.delete(id); }
    for (const [id, P] of players) {
      const A = P.actor;
      if (!A?.hero) continue;
      let t = this.tags.get(id);
      if (!t) this.tags.set(id, t = new Tag(this.scene));
      t.set(String(P.look?.name || A.hero.look?.name || P.name || 'Player').slice(0, 16));
      // (no head any more - cut off: over the neck)
      (A.hero.head || A.hero.neck).getWorldPosition(_p);
      t.sprite.position.copy(_p).y += 0.42;
      t.sprite.visible = on && A.hero.shown !== false;
    }
  }
  clear() { for (const t of this.tags.values()) t.dispose(); this.tags.clear(); }
}
