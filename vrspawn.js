import * as THREE from 'three';

/*
  The VR spawn menu (B on the right controller): a panel beside you. Point at a kind of person
  and pull the trigger to pick it, then point anywhere on the ground and pull again to drop one
  there (as many as you like). B again closes it.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const W = 640, PAD = 24, BH = 78, GAP = 14, HEAD = 46;
const _p = V(), _q = new THREE.Quaternion(), _s = V(), _d = V(), _v = V();

export class VRSpawn {
  /** ctx: { sections: () => [{ title, items: [{ id, name, tint }] }], spawn(kind, pos), groundAt(x, z, y) } */
  constructor(vr, ctx) {
    this.vr = vr;
    Object.assign(this, ctx);
    this.kind = null;
    this.mesh = null;
    this.trig = { left: true, right: true };
  }
  get open() { return !!this.mesh?.visible; }

  build() {
    // (the sections: laid out first, the panel as tall as they need)
    const col = (W - PAD * 2 - GAP * 2) / 3;
    this.buttons = [];
    this.heads = [];
    let y = 64;
    for (const S of this.sections()) {
      this.heads.push({ title: S.title, y: y + HEAD / 2 - 6 });
      y += HEAD;
      S.items.forEach((it, i) => this.buttons.push({ ...it, x: PAD + (i % 3) * (col + GAP), y: y + Math.floor(i / 3) * (BH + GAP), w: col, h: BH }));
      y += Math.ceil(S.items.length / 3) * (BH + GAP) + 6;
    }
    const H = (this.H = Math.round(y + PAD - GAP));
    if (this.mesh) {
      this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.tex.dispose();
      this.laser.removeFromParent(); this.marker.removeFromParent();
    }
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = (o) => Object.assign({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }, o);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46 * H / W), new THREE.MeshBasicMaterial(mat({ map: tex })));
    this.mesh.renderOrder = 999;
    this.mesh.frustumCulled = false;
    this.c = c; this.tex = tex;
    this.laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(), V(0, 0, -1)]),
      new THREE.LineBasicMaterial(mat({ color: 0xffd65a, opacity: 0.85 })));
    this.laser.renderOrder = 1000;
    this.laser.frustumCulled = false;
    // where it'll land
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffd65a, transparent: true, opacity: 0.9, depthWrite: false, fog: false, toneMapped: false }));
    this.marker.renderOrder = 998;
    this.marker.visible = false;
    this.vr.rig.add(this.mesh, this.laser);
    this.vr.scene.add(this.marker);
    this.rc = new THREE.Raycaster();
  }

  draw(hover) {
    const key = hover + '|' + this.kind;
    if (this.drawn === key) return;
    this.drawn = key;
    const H = this.H;
    const g = this.c.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(18,18,22,0.88)';
    g.beginPath(); g.roundRect(0, 0, W, H, 28); g.fill();
    g.fillStyle = 'rgba(242,240,234,0.6)';
    g.font = 'bold 28px system-ui, sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(this.kind ? 'Point at the ground, pull trigger' : 'Spawn', PAD + 4, 34);
    g.font = 'bold 22px system-ui, sans-serif';
    g.fillStyle = 'rgba(255,214,90,0.8)';
    for (const S of this.heads) g.fillText(S.title.toUpperCase(), PAD + 4, S.y);
    this.buttons.forEach((b, i) => {
      const on = b.id === this.kind;
      g.fillStyle = i === hover ? '#ffd65a' : on ? 'rgba(255,214,90,0.35)' : 'rgba(255,255,255,0.1)';
      g.beginPath(); g.roundRect(b.x, b.y, b.w, b.h, 18); g.fill();
      if (b.tint && i !== hover) { g.fillStyle = b.tint; g.fillRect(b.x + 14, b.y + b.h - 10, b.w - 28, 4); }
      g.fillStyle = i === hover ? '#15130c' : '#f2f0ea';
      g.font = 'bold 30px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(b.name, b.x + b.w / 2, b.y + b.h / 2);
    });
    this.tex.needsUpdate = true;
  }

  toggle() { if (this.open) this.close(); else this.show(); }
  show() {
    // (what's on offer can change with the map: rebuilt when it has)
    const sig = JSON.stringify(this.sections().map((S) => [S.title, S.items.map((x) => x.id)]));
    if (!this.mesh || sig !== this.sig) { this.sig = sig; this.build(); }
    const vr = this.vr, cam = vr.camera, M = this.mesh;
    // in front of you, off to the left: the right hand is free to point past it at the ground
    _d.set(0, 0, -1).applyQuaternion(cam.quaternion).setY(0);
    if (_d.lengthSq() < 1e-4) _d.set(0, 0, -1);
    _d.normalize();
    M.position.copy(cam.position).addScaledVector(_d, 0.55).addScaledVector(_v.set(_d.z, 0, -_d.x), 0.16);
    M.position.y -= 0.1;
    M.lookAt(vr.headWorld(_v));
    M.visible = true;
    this.drawn = null;
    this.trig = { left: true, right: true };
    this.draw(-1);
    vr.buzz('right', 0.2, 30);
  }
  close() {
    if (!this.mesh) return;
    this.mesh.visible = this.laser.visible = this.marker.visible = false;
    this.kind = null;
  }

  /** Where a ray first meets the ground (or a top you could stand on), or null. */
  ground(o, d) {
    let prev = 0;
    for (let t = 0.2; t < 40; t += 0.2) {
      _v.copy(o).addScaledVector(d, t);
      if (_v.y <= this.groundAt(_v.x, _v.z, _v.y + 0.25)) {
        // (narrow it down)
        let a = prev, b = t;
        for (let k = 0; k < 6; k++) {
          const m = (a + b) / 2;
          _v.copy(o).addScaledVector(d, m);
          if (_v.y <= this.groundAt(_v.x, _v.z, _v.y + 0.25)) b = m; else a = m;
        }
        const p = o.clone().addScaledVector(d, b);
        p.y = this.groundAt(p.x, p.z, p.y + 0.25);
        return { p, dist: b };
      }
      prev = t;
    }
    return null;
  }

  update() {
    const vr = this.vr, M = this.mesh;
    const hand = vr.hands.right?.ray.visible ? 'right' : vr.hands.left?.ray.visible ? 'left' : null;
    for (const k of ['left', 'right']) if (k !== hand) this.trig[k] = vr.btnDown(k, 0);
    if (!hand) { this.laser.visible = this.marker.visible = false; return; }
    const slot = vr.hands[hand];
    slot.ray.matrixWorld.decompose(_p, _q, _s);
    _d.set(0, 0, -1).applyQuaternion(_q);
    const down = vr.btnDown(hand, 0), click = down && !this.trig[hand];
    this.trig[hand] = down;
    let hover = -1, dist = 0;
    this.rc.set(_p, _d);
    const hit = this.rc.intersectObject(M, false)[0];
    this.marker.visible = false;
    if (hit) {
      dist = hit.distance;
      const px = hit.uv.x * W, py = (1 - hit.uv.y) * this.H;
      hover = this.buttons.findIndex((b) => px > b.x && px < b.x + b.w && py > b.y && py < b.y + b.h);
      if (hover !== this.hover) { this.hover = hover; if (hover >= 0) vr.buzz(hand, 0.15, 20); }
      if (click && hover >= 0) {
        const b = this.buttons[hover];
        vr.buzz(hand, 0.5, 50);
        this.kind = this.kind === b.id ? null : b.id;
      }
    } else if (this.kind) {
      this.hover = -1;
      const g = this.ground(_p, _d);
      if (g) {
        dist = g.dist;
        this.marker.position.copy(g.p).setY(g.p.y + 0.02);
        this.marker.visible = true;
        if (click) { this.spawn(this.kind, g.p); vr.buzz(hand, 0.6, 60); vr.sfx?.('pickup', 0.5); }
      } else dist = 6;
    } else this.hover = -1;
    this.draw(hover);
    this.laser.visible = dist > 0;
    if (dist > 0) {
      this.laser.position.copy(slot.ray.position);
      this.laser.quaternion.copy(slot.ray.quaternion);
      this.laser.scale.set(1, 1, dist);
    }
  }
}
