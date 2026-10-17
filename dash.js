import * as THREE from 'three';
import { ghBase } from './carmodel.js';

/*
  The dash display in the car you're driving: a lit digital cluster over the gauges behind the
  steering wheel - speed in mph, and the gear (D / R / N).
*/

const CW = 384, CH = 128;

export class Dash {
  constructor() {
    this.c = document.createElement('canvas');
    this.c.width = CW; this.c.height = CH;
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.1), new THREE.MeshBasicMaterial({
      map: this.tex, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    // its housing: a thin dark slab behind the screen, on a little stalk down into the hood
    const black = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.6 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.115, 0.02), black);
    back.position.z = -0.011;
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.02), black);
    stalk.position.set(0, -0.07, -0.015);
    this.mesh.add(back, stalk);
    this.car = null;
    this.shown = '';
  }

  /** car: the one you're at the wheel of, or null. */
  update(car) {
    if (car && !car.S.wheelC) car = null; // (a motorcycle: no dash)
    if (car !== this.car) {
      this.mesh.removeFromParent();
      this.car = car;
      this.shown = '';
      if (car) {
        const S = car.S, dTop = ghBase(S, S.cabin[1]) - 0.01;
        // on top of the gauge hood, high enough to read over the wheel's rim
        this.mesh.position.set(S.wheelC.x, dTop + 0.17, S.dashZ + 0.08);
        // facing back at the driver (turned round), tipped back a little toward their eyes - text the right way up
        this.mesh.rotation.set(-0.25, Math.PI, 0, 'YXZ');
        car.m.hi.add(this.mesh);
        car.m.root.updateMatrixWorld(true);
      }
    }
    if (!car) return;
    const v = car.fspeed, mph = Math.round(Math.abs(v) * 2.237);
    const gear = v < -0.4 || (car.input.throttle < 0 && Math.abs(v) < 0.4) ? 'R' : car.input.throttle > 0 || v > 0.4 ? 'D' : 'N';
    const key = mph + gear;
    if (key === this.shown) return;
    this.shown = key;
    const g = this.c.getContext('2d');
    g.fillStyle = '#05080c'; g.fillRect(0, 0, CW, CH);
    // speed bar along the bottom (0..120 mph)
    const k = Math.min(1, mph / 120);
    g.fillStyle = '#16232e'; g.fillRect(20, 108, CW - 40, 8);
    g.fillStyle = k > 0.8 ? '#ff5a3c' : '#4fd2ff'; g.fillRect(20, 108, (CW - 40) * k, 8);
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#e9f6ff'; g.font = 'bold 86px system-ui, sans-serif'; g.textAlign = 'right';
    g.fillText(String(mph), 230, 92);
    g.fillStyle = '#7fa3b8'; g.font = 'bold 26px system-ui, sans-serif'; g.textAlign = 'left';
    g.fillText('MPH', 240, 92);
    g.fillStyle = gear === 'R' ? '#ff8a5a' : '#8dff7a'; g.font = 'bold 54px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText(gear, 340, 74);
    g.fillStyle = '#5c7385'; g.font = 'bold 18px system-ui, sans-serif'; g.textAlign = 'left';
    g.fillText('B  GET OUT', 20, 26);
    this.tex.needsUpdate = true;
  }
}
