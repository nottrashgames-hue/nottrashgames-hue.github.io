import * as THREE from 'three';

/*
  The loading screen between maps: a dark veil with the map's name and a spinner. On a screen
  it's a page overlay; in a headset it's a sphere around your head (the page can't be seen there).
  Driven from the game loop (update), which keeps running in VR where the page's frames stop.
*/

const FADE = 0.25; // s, in or out

export class Loading {
  constructor(camera) {
    this.camera = camera;
    this.el = document.createElement('div');
    this.el.id = 'loading';
    this.el.innerHTML = '<i></i><span></span>';
    document.body.appendChild(this.el);
    this.a = 0;
    this.want = 0;
    this.wait = null;
    this.vr = null;
  }

  buildVr() {
    const mat = (o) => new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false, opacity: 0, ...o });
    const g = new THREE.Group();
    const veil = new THREE.Mesh(new THREE.SphereGeometry(0.6, 24, 16), mat({ color: 0x111014, side: THREE.BackSide }));
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.1), mat({ map: tex }));
    label.position.set(0, -0.06, -0.5);
    const spin = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.038, 32, 1, 0, Math.PI * 1.4), mat({ color: 0xffd65a }));
    spin.position.set(0, 0.05, -0.5);
    for (const [i, m] of [veil, label, spin].entries()) { m.renderOrder = 10000 + i; m.frustumCulled = false; g.add(m); }
    this.vr = { g, veil, label, spin, c, tex };
  }

  /** Fade in; resolves once the screen is covered. */
  show(name, inVr) {
    this.el.querySelector('span').textContent = 'Loading ' + name;
    this.el.classList.add('on');
    if (inVr) {
      if (!this.vr) this.buildVr();
      const { c, tex } = this.vr, g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      g.fillStyle = '#f2efe8'; g.font = 'bold 54px system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('Loading ' + name, c.width / 2, c.height / 2);
      tex.needsUpdate = true;
      this.camera.add(this.vr.g);
    }
    this.want = 1;
    return new Promise((res) => {
      this.wait = res;
      // (in case no frames are drawn: a hidden tab)
      setTimeout(() => this.done(), FADE * 1000 + 400);
    });
  }
  done() { const w = this.wait; this.wait = null; w?.(); }

  hide() { this.want = 0; this.el.classList.remove('on'); }

  update(dt) {
    const step = Math.min(dt, 0.1) / FADE;
    this.a = this.want > this.a ? Math.min(1, this.a + step) : Math.max(0, this.a - step);
    if (this.want === 1 && this.a >= 1) this.done();
    if (!this.vr) return;
    const { g, veil, label, spin } = this.vr;
    veil.material.opacity = this.a;
    label.material.opacity = spin.material.opacity = this.a;
    spin.rotation.z -= dt * 6;
    if (this.a <= 0 && this.want === 0 && g.parent) g.removeFromParent();
  }
}
