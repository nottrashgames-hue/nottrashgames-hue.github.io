import * as THREE from 'three';
import { GORE } from './GoreSettings.js';

/*
  Debug mode for the slicer (GORE.debug; F9 toggles it, or open the page with ?slicedebug):
  the gizmos are drawn as lines in the world -
    yellow  the blade's sweep each step (base and tip, last step -> this step)
    red     every cut plane (a square on the plane through its point, and its normal)
    cyan    where the edge met something
  - and a readout (pinned in front of the camera, so it's there in the headset too): loose
  pieces, cuts queued, the last / average slice time in ms.
*/

const KEEP_SWEEPS = 90, KEEP_PLANES = 12, KEEP_POINTS = 40, MAXV = 4096;

export class SliceDebug {
  constructor(scene, camera, pieces, getCutters) {
    this.scene = scene; this.camera = camera; this.pieces = pieces; this.getCutters = getCutters;
    this.on = GORE.debug || /[?&]slicedebug/.test(location.search);
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAXV * 3); this.col = new Float32Array(MAXV * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
    this.lines.frustumCulled = false; this.lines.renderOrder = 999;
    this.cv = document.createElement('canvas'); this.cv.width = 256; this.cv.height = 64;
    this.tex = new THREE.CanvasTexture(this.cv);
    this.hud = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, depthTest: false, transparent: true }));
    this.hud.scale.set(0.16, 0.04, 1); this.hud.position.set(0.12, -0.1, -0.4); this.hud.renderOrder = 1000;
    // (desktop: the camera isn't in the scene, so the readout is a page overlay instead)
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:60;font:12px monospace;color:#9f9;background:rgba(0,0,0,.55);padding:4px 6px;pointer-events:none;white-space:pre';
    this.t = 0;
    addEventListener('keydown', (e) => { if (e.code === 'F9') { this.on = !this.on; e.preventDefault(); } });
  }

  update(dt) {
    GORE.debug = this.on;
    const cutters = this.getCutters();
    for (const c of cutters) c.ctx.debugSlice = this.on;
    if (!this.on) { this.lines.removeFromParent(); this.hud.removeFromParent(); this.el.remove(); return; }
    if (!this.lines.parent) this.scene.add(this.lines);
    const vr = !!this.camera.parent;
    if (vr && this.hud.parent !== this.camera) { this.camera.add(this.hud); this.el.remove(); }
    if (!vr && !this.el.isConnected) { this.hud.removeFromParent(); document.body.appendChild(this.el); }
    let n = 0;
    const P = this.pos, C = this.col;
    const seg = (a, b, r, g, bl) => {
      if (n + 2 > MAXV) return;
      P.set([a.x, a.y, a.z, b.x, b.y, b.z], n * 3);
      C.set([r, g, bl, r, g, bl], n * 3);
      n += 2;
    };
    const u = new THREE.Vector3(), v = new THREE.Vector3(), p = new THREE.Vector3();
    for (const c of cutters) {
      const T = c.trace;
      if (T.sweeps.length > KEEP_SWEEPS) T.sweeps.splice(0, T.sweeps.length - KEEP_SWEEPS);
      if (T.planes.length > KEEP_PLANES) T.planes.splice(0, T.planes.length - KEEP_PLANES);
      if (T.points.length > KEEP_POINTS) T.points.splice(0, T.points.length - KEEP_POINTS);
      for (const [a0, b0, a1, b1] of T.sweeps) { seg(a0, a1, 0.9, 0.8, 0.1); seg(b0, b1, 1, 0.9, 0.2); seg(a1, b1, 0.5, 0.45, 0.05); }
      for (const { point, n: nn } of T.planes) {
        u.set(Math.abs(nn.x) < 0.9 ? 1 : 0, Math.abs(nn.x) < 0.9 ? 0 : 1, 0).cross(nn).normalize().multiplyScalar(0.18);
        v.crossVectors(nn, u);
        const k = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([x, y]) => point.clone().addScaledVector(u, x).addScaledVector(v, y));
        for (let i = 0; i < 4; i++) seg(k[i], k[(i + 1) % 4], 1, 0.15, 0.15);
        seg(k[0], k[2], 0.6, 0.1, 0.1); seg(k[1], k[3], 0.6, 0.1, 0.1);
        seg(point, p.copy(point).addScaledVector(nn, 0.12), 1, 0.4, 0.4);
      }
      for (const q of T.points) {
        seg(p.copy(q).setX(q.x - 0.015), u.copy(q).setX(q.x + 0.015), 0.2, 1, 1);
        seg(p.copy(q).setY(q.y - 0.015), u.copy(q).setY(q.y + 0.015), 0.2, 1, 1);
        seg(p.copy(q).setZ(q.z - 0.015), u.copy(q).setZ(q.z + 0.015), 0.2, 1, 1);
      }
    }
    const geo = this.lines.geometry;
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = geo.attributes.color.needsUpdate = true;
    // the readout, a few times a second
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.2;
    const g = this.cv.getContext('2d'), s = this.pieces.stats;
    g.clearRect(0, 0, 256, 64);
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#9f9'; g.font = '16px monospace';
    const l1 = `pieces ${this.pieces.pieces.length}/${GORE.maxPieces}  queue ${this.pieces.queue.length}`;
    const l2 = `slice ${s.lastMs.toFixed(2)}ms avg ${s.avgMs.toFixed(2)} n${s.cuts}`;
    g.fillText(l1, 8, 24); g.fillText(l2, 8, 48);
    this.el.textContent = l1 + '\n' + l2;
    this.tex.needsUpdate = true;
  }
}
