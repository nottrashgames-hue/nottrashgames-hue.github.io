import * as THREE from 'three';

/*
  The map board on the main menu's wall: look at a button (the crosshair) and click, tap it, or
  point a VR controller at it and pull the trigger.
*/

const W = 1024, H = 640, PW = 3.4, PH = PW * H / W, REACH = 10;
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _d = new THREE.Vector3();

export class MenuBoard {
  /** maps: [{ id, name }]; go(id) */
  constructor(scene, { pos, yaw }, maps, go) {
    this.go = go;
    this.c = document.createElement('canvas');
    this.c.width = W; this.c.height = H;
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    this.mesh.position.copy(pos);
    this.mesh.rotation.y = yaw;
    // a dark frame behind it
    const frame = new THREE.Mesh(new THREE.BoxGeometry(PW + 0.16, PH + 0.16, 0.06), new THREE.MeshStandardMaterial({ color: 0x3b2c22, roughness: 0.7 }));
    frame.position.set(0, 0, -0.04);
    this.mesh.add(frame);
    // the logo on the wall over the board
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.05, toneMapped: false }));
    new THREE.TextureLoader().load('menulogo.png', (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      logo.material.map = t; logo.material.needsUpdate = true;
      const h = 1.15, w = h * t.image.width / t.image.height;
      logo.scale.set(w, h, 1);
      logo.position.set(0, PH / 2 + 0.16 + h / 2, 0);
      logo.visible = true;
    });
    logo.visible = false; // (till the picture's in)
    this.mesh.add(logo);
    scene.add(this.mesh);
    // every map the same size, side by side (up to 3 to a row), centred under the title
    const P = 48, G = 32, per = Math.min(3, maps.length), rows = Math.ceil(maps.length / per);
    const col = (W - P * 2 - G * (per - 1)) / per, bh = Math.min(300, (H - 150 - P - G * (rows - 1)) / rows);
    const top = 150 + (H - 150 - P - rows * bh - G * (rows - 1)) / 2;
    this.buttons = maps.map((m, i) => ({ ...m, x: P + (i % per) * (col + G), y: top + Math.floor(i / per) * (bh + G), w: col, h: bh }));
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

  draw(hover, force) {
    if (!force && hover === this.drawn) return;
    this.drawn = hover;
    const g = this.c.getContext('2d');
    g.fillStyle = '#17161b';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#f2efe8';
    g.font = 'bold 64px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('Choose a map', W / 2, 66);
    this.buttons.forEach((b, i) => {
      const on = i === hover;
      g.fillStyle = on ? '#ffd65a' : 'rgba(255,255,255,0.1)';
      g.beginPath(); g.roundRect(b.x, b.y, b.w, b.h, 22); g.fill();
      g.fillStyle = on ? '#15130c' : '#f2efe8';
      g.font = 'bold 58px system-ui, sans-serif';
      g.fillText(b.name, b.x + b.w / 2, b.y + b.h / 2 + 2);
    });
    this.tex.needsUpdate = true;
  }

  /** Which button a ray (origin o, direction d) is on, and how far away: [index, dist]. */
  pick(o, d) {
    this.rc.set(o, d);
    const hit = this.rc.intersectObject(this.mesh, false)[0];
    if (!hit || hit.distance > REACH) return [-1, 0];
    const px = hit.uv.x * W, py = (1 - hit.uv.y) * H;
    return [this.buttons.findIndex((b) => px > b.x && px < b.x + b.w && py > b.y && py < b.y + b.h), hit.distance];
  }

  /** Each frame. camera: the crosshair ray; vr: the controllers when in a headset. */
  update(camera, vr) {
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
        if (i >= 0 && down && !was) { vr.buzz(hand, 0.5, 50); this.go(this.buttons[i].id); }
      }
    } else {
      camera.getWorldPosition(_p);
      camera.getWorldDirection(_d);
      hover = this.pick(_p, _d)[0];
    }
    this.hover = hover;
    this.draw(hover);
  }

  /** A click with the crosshair: true if it picked a map. */
  click() {
    if (this.hover < 0) return false;
    this.go(this.buttons[this.hover].id);
    return true;
  }

  /** A tap at screen point (x, y). */
  tap(camera, x, y) {
    this.rc.setFromCamera(new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
    const [i] = this.pick(this.rc.ray.origin.clone(), this.rc.ray.direction.clone());
    if (i < 0) return false;
    this.go(this.buttons[i].id);
    return true;
  }
}
