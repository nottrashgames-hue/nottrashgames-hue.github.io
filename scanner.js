import * as THREE from 'three';
import { buildXray, xmat } from './xraybody.js';

/*
  VR medical scanner. Click the left stick: a pointer comes out of the left hand - aim it at
  someone and pull the left trigger. A monitor opens on the left side of your left hand with
  their x-ray body: the skeleton, organs and vessels, every wound on it (entry and exit holes,
  stabs), each one's path inside and what it went through. With the right hand's ray on the
  monitor, hold the trigger over a bone: it lights up and the monitor names it, with any damage.
  Click the left stick again to put it away.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const SCALE = 0.165;               // the x-ray body on the monitor: 1.8 m -> ~30 cm
const PANEL_W = 0.32, PANEL_H = 0.4;
/*
  On the left palm, turning with the hand. Left grip frame: +X out of the palm, -Z forward (the
  way the fingers point with the hand open). The screen faces out of the palm with its top
  toward the fingertips: turn the palm up and read it.
*/
const MOUNT_POS = V(0.06, 0.0, -0.06);
const MOUNT_Q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, -1, 0), V(0, 0, -1), V(1, 0, 0)));
// X on the left controller steps through what the x-ray shows
const LAYERS = ['All', 'Skeleton', 'Organs', 'Vessels', 'Skin'];
const STATS_W = 0.135, STATS_H = 0.29;
const HIST_H = 0.034, HIST_N = 5;  // the impact history bar along the top: the last 5 hits
// what a hit reached inside (organs.js names) -> what the bar says
const TISSUE = { brain: 'Brain', skull: 'Skull', heart: 'Heart', liver: 'Liver', stomach: 'Stomach', guts: 'Intestines',
  ribs: 'Ribs', pelvis: 'Pelvis', cervical: 'Neck spine', thoracic: 'Upper spine', spineMid: 'Lower spine', lumbar: 'Lower spine',
  lung: 'lung', femur: 'femur', tibia: 'tibia', humerus: 'humerus', forearm: 'radius/ulna' };
const tissueName = (n) => {
  if (TISSUE[n]) return TISSUE[n];
  const k = n.slice(0, -1), sd = n.slice(-1);
  return TISSUE[k] ? (sd === 'L' ? 'L ' : 'R ') + TISSUE[k] : n;
};
const KIND_COL = { gun: '#ff6a4a', blade: '#ffd23a', blunt: '#7fd0ff' };
const _o = V(), _d = V(), _q = new THREE.Quaternion(), _s = V(), _p = V(), _m = new THREE.Matrix4();
const WOUND_COL = { entry: 0xff2a2a, exit: 0xff8a2a, cut: 0xffd23a };
const TRACE_COL = { gun: 0xffa040, stab: 0xffe060 };
const HILITE = new THREE.Color(0xffe14a), HURT = new THREE.Color(0xff4436);
// organ / vessel names the wounds report (organs.js) -> the x-ray's meshes
const ORGAN_OF = { lungL: 'lungL', lungR: 'lungR', heart: 'heart', liver: 'liver', stomach: 'stomach', guts: 'guts', brain: 'brain' };
const VESSEL_OF = { carotidL: ['carotidL'], carotidR: ['carotidR'], aorta: ['aorta'], iliac: ['iliacL', 'iliacR'],
  femoralL: ['femoralL'], femoralR: ['femoralR'], poplitealL: ['poplitealL'], poplitealR: ['poplitealR'], brachialL: ['brachialL'], brachialR: ['brachialR'] };

/** Distance from point p to segment a-b. */
function segDist(p, a, b) {
  _d.subVectors(b, a);
  const L = _d.lengthSq();
  const t = L > 1e-12 ? Math.max(0, Math.min(1, _p.subVectors(p, a).dot(_d) / L)) : 0;
  return _p.copy(a).addScaledVector(_d, t).distanceTo(p);
}
/** Closest approach of ray (o, unit d) to segment a-b: { dist, t } (t along the ray). */
function raySeg(o, d, a, b) {
  const u = d, v = V().subVectors(b, a), w = V().subVectors(o, a);
  const uv = u.dot(v), vv = v.dot(v), uw = u.dot(w), vw = v.dot(w);
  const den = vv - uv * uv;
  let s = den > 1e-9 ? (uv * vw - vv * uw) / den : 0;
  s = Math.max(0, s);
  let t = vv > 1e-9 ? Math.max(0, Math.min(1, (uv * s + vw) / vv)) : 0;
  s = Math.max(0, uv * t - uw);
  const pa = o.clone().addScaledVector(u, s), pb = a.clone().addScaledVector(v, t);
  return { dist: pa.distanceTo(pb), t: s };
}

function laser(color) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false }));
  l.frustumCulled = false; l.renderOrder = 1001; l.visible = false;
  return l;
}
function setLaser(l, a, b) {
  const p = l.geometry.attributes.position;
  p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, b.x, b.y, b.z);
  p.needsUpdate = true;
  l.visible = true;
}

export class Scanner {
  constructor(vr) {
    this.vr = vr;
    this.picking = false;   // the pointer is out
    this.target = null;     // who the pointer's on
    this.A = null;          // whose body the monitor shows
    this.aimed = false;     // the right ray on the monitor
    this.bone = null;       // the bone being pointed at
    this.sig = '';
    this.layer = 0;
    this.lasL = laser(0x5ff6ff);
    this.lasR = laser(0xffe14a);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.012, 6, 32), new THREE.MeshBasicMaterial({ color: 0x5ff6ff, transparent: true, opacity: 0.85, depthTest: false }));
    this.ring.rotation.x = Math.PI / 2; this.ring.renderOrder = 1001; this.ring.visible = false;
    vr.scene.add(this.lasL, this.lasR, this.ring);
  }

  blocking() { return this.picking || this.aimed; }

  build() {
    if (this.mon) return;
    const mon = this.mon = new THREE.Group();
    mon.name = 'scanner';
    const back = this.back = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), new THREE.MeshBasicMaterial({ color: 0x03060a, transparent: true, opacity: 0.94 }));
    back.position.z = -0.04;
    mon.add(back);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(PANEL_W, PANEL_H)), new THREE.LineBasicMaterial({ color: 0x2fb8c8, transparent: true, opacity: 0.8 }));
    edge.position.z = -0.039;
    mon.add(edge);
    this.x = buildXray();
    this.x.root.scale.setScalar(SCALE);
    this.x.root.position.set(-0.075, -0.15, 0);
    mon.add(this.x.root);
    // vitals, to the right of the body
    const sc = this.sv = document.createElement('canvas');
    sc.width = 360; sc.height = 800;
    this.stex = new THREE.CanvasTexture(sc);
    this.stex.colorSpace = THREE.SRGBColorSpace;
    const st = new THREE.Mesh(new THREE.PlaneGeometry(STATS_W, STATS_H), new THREE.MeshBasicMaterial({ map: this.stex, transparent: true, depthTest: false }));
    st.position.set(PANEL_W / 2 - STATS_W / 2 - 0.008, -0.005, -0.02);
    // the impact history along the top
    const hc = this.hv = document.createElement('canvas');
    hc.width = 1024; hc.height = Math.round(1024 * HIST_H / (PANEL_W - 0.01));
    this.htex = new THREE.CanvasTexture(hc);
    this.htex.colorSpace = THREE.SRGBColorSpace;
    const hb = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W - 0.01, HIST_H), new THREE.MeshBasicMaterial({ map: this.htex, transparent: true, depthTest: false }));
    hb.position.set(0, PANEL_H / 2 - HIST_H / 2 - 0.005, -0.02);
    hb.renderOrder = 20;
    mon.add(hb);
    st.renderOrder = 20;
    mon.add(st);
    this.statT = 0;
    this.marks = [];
    // the label strip under the body
    const c = this.cv = document.createElement('canvas');
    c.width = 1024; c.height = 128;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W - 0.01, (PANEL_W - 0.01) / 8), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false }));
    lab.position.set(0, -PANEL_H / 2 + (PANEL_W - 0.01) / 16 + 0.005, -0.02);
    lab.renderOrder = 20;
    mon.add(lab);
    this.label(null);
  }

  /** The strip: the bone's name, what it's called, and what's wrong with it. */
  label(b) {
    const c = this.cv, g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(8,22,30,0.92)';
    g.fillRect(0, 0, c.width, c.height);
    g.font = '600 38px system-ui, sans-serif';
    g.textBaseline = 'top';
    if (!b) {
      g.fillStyle = '#6fa9b4';
      g.font = '500 30px system-ui, sans-serif';
      const L = LAYERS[this.layer || 0];
      g.fillText(L === 'All' || L === 'Skeleton' ? 'Point at a bone, hold trigger' : 'Showing: ' + L, 18, 46);
      g.textAlign = 'right';
      g.fillStyle = '#5ff6ff';
      g.fillText('X: ' + L + ' (' + (this.layer + 1) + '/' + LAYERS.length + ')', c.width - 18, 46);
      g.textAlign = 'left';
    } else {
      const U = b.userData;
      g.fillStyle = '#ffe14a';
      g.fillText(U.name, 18, 16);
      g.font = '400 28px system-ui, sans-serif';
      g.fillStyle = '#9fc6cf';
      g.fillText(U.sub, 18, 70);
      const tags = this.hurt.get(b);
      g.font = '600 34px system-ui, sans-serif';
      g.textAlign = 'right';
      if (!tags?.size) { g.fillStyle = '#5fe08a'; g.fillText('Intact', c.width - 18, 44); }
      else {
        const T = { fracture: 'Fractured', gun: 'Gunshot damage', stab: 'Stab damage' };
        g.fillStyle = '#ff6a5a';
        g.fillText([...tags].map((t) => T[t]).join(' / '), c.width - 18, 44);
      }
      g.textAlign = 'left';
    }
    this.tex.needsUpdate = true;
  }

  open(A) {
    this.build();
    if (this.bone) this.unlight(this.bone);
    this.A = A;
    this.sig = '';
    this.bone = null;
    this.hurt = new Map();
    this.label(null);
    this.statT = 0;
    const grip = this.vr.hands.left?.grip;
    (grip || this.vr.scene).add(this.mon);
    this.mon.position.copy(MOUNT_POS);
    this.mon.quaternion.copy(MOUNT_Q);
    this.vr.buzz('left', 0.6, 60);
  }

  close() {
    this.picking = false; this.target = null; this.aimed = false;
    this.A = null;
    if (this.mon) this.mon.removeFromParent();
    this.lasL.visible = this.lasR.visible = this.ring.visible = false;
  }

  ray(hand) {
    const slot = this.vr.hands[hand];
    if (!slot?.ray) return null;
    slot.ray.matrixWorld.decompose(_o, _q, _s);
    return { o: _o.clone(), d: V(0, 0, -1).applyQuaternion(_q).normalize() };
  }

  /** Who's under the left pointer. */
  findTarget(r) {
    let best = null, bt = Infinity;
    const a = V(), b = V();
    for (const A of this.vr.actors) {
      if (A === this.vr.hero || !A.groups?.pelvis || A.poofed) continue;
      A.groups.pelvis.getWorldPosition(a);
      A.groups.head.getWorldPosition(b);
      b.y += 0.1;
      const h = raySeg(r.o, r.d, a, b);
      if (h.t > 40 || h.dist > 0.35) continue;
      const score = h.t + h.dist * 20;
      if (score < bt) { bt = score; best = A; }
    }
    return best;
  }

  /** Start of the frame (vr.input): the stick, the triggers. */
  input() {
    const vr = this.vr;
    if (vr.edge('left', 3)) {
      if (this.picking) this.picking = false;
      else if (this.A) this.close();
      else { this.picking = true; vr.buzz('left', 0.3, 30); }
    }
    if (this.A && !vr.actors.includes(this.A)) this.close();
    if (vr.edge('left', 4) && this.A) { this.layer = (this.layer + 1) % LAYERS.length; this.applyLayer(); this.statT = 0; vr.buzz('left', 0.3, 25); }
    if (this.picking) {
      const r = this.ray('left');
      this.target = r ? this.findTarget(r) : null;
      if (this.target !== this._lastT && this.target) vr.buzz('left', 0.15, 15);
      this._lastT = this.target;
      if (vr.edge('left', 0) && this.target) { const A = this.target; this.picking = false; this.target = null; this.open(A); }
    } else { this.target = null; vr.edge('left', 0); }
    // the right ray on the monitor: the trigger names bones (and never fires the gun)
    this.aimed = false;
    if (this.A && this.mon) {
      const r = this.ray('right');
      if (r) {
        this._rc ||= new THREE.Raycaster();
        this._rc.set(r.o, r.d); this._rc.far = 2;
        const hit = this._rc.intersectObject(this.back, false)[0];
        if (hit) {
          this.aimed = true;
          this.aimAt = hit.point.clone();
          this.rayR = r;
        }
      }
    }
  }

  /** The bone nearest the right ray (picking is forgiving: finger bones are millimetres wide on here). */
  pickBone(r) {
    const M = this.x.inner.matrixWorld, k = SCALE;
    let best = null, bs = Infinity;
    for (const b of this.x.bones) {
      if (!b.visible) continue;
      const tol = (b.userData.r * 0.6 + 0.004) * k + 0.0025;
      for (const p0 of b.userData.pts) {
        const p = _p.copy(p0).applyMatrix4(M);
        const v = p.sub(r.o), t = v.dot(r.d);
        if (t < 0) continue;
        const perp = Math.sqrt(Math.max(0, v.lengthSq() - t * t));
        if (perp > tol) continue;
        const s = t + (perp / tol) * 0.012;
        if (s < bs) { bs = s; best = b; }
      }
    }
    return best;
  }

  /** Model-space copy of a point in part `name`'s frame. */
  toModel(name, v) {
    const g = this.x.parts[name];
    if (!g) return null;
    _m.copy(this.x.inner.matrixWorld).invert().multiply(g.matrixWorld);
    return v.clone().applyMatrix4(_m);
  }

  /** Rebuild the wound overlay and the damage on bones, organs and vessels. */
  refresh() {
    const A = this.A, X = this.x;
    const wounds = A.wounds?.wounds || [], traces = A.wounds?.traces || [], frac = A.organs?.fractures;
    const sig = wounds.length + '|' + traces.length + '|' + (frac?.size || 0);
    if (sig === this.sig) return;
    this.sig = sig;
    for (const m of this.marks) { m.removeFromParent(); m.geometry !== this._dot && m.geometry.dispose(); m.material.dispose(); }
    this.marks = [];
    X.root.updateMatrixWorld(true);
    // wounds on the skin: glowing through everything
    this._dot ||= new THREE.SphereGeometry(1, 10, 8);
    const mk = (parent, geo, col, a = 0.95) => {
      const m = new THREE.Mesh(geo, xmat(col, { a, f: 0.8, base: 0.9, add: true, dt: false, dw: false }));
      m.renderOrder = 10;
      parent.add(m);
      this.marks.push(m);
      return m;
    };
    for (const w of wounds) {
      const P = X.parts[w.part];
      if (!P || !w.local) continue;
      const r = w.kind === 'exit' ? 0.017 : w.kind === 'cut' ? 0.012 : 0.012;
      const m = mk(P, this._dot, WOUND_COL[w.kind] || WOUND_COL.cut);
      m.position.copy(w.local);
      if (w.kind === 'cut') { m.scale.set(0.006, 0.02, 0.006); if (w.nLocal) m.quaternion.setFromUnitVectors(V(0, 0, 1), w.nLocal.clone().normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), 0.6)); }
      else m.scale.setScalar(r);
      m.userData.pulse = w.kind;
    }
    // each wound's path inside
    for (const t of traces) {
      const P = X.parts[t.part];
      if (!P) continue;
      const len = t.a.distanceTo(t.b);
      if (len < 1e-4) continue;
      const g = new THREE.CylinderGeometry(0.004, 0.004, len, 5, 1, true);
      const m = mk(P, g, TRACE_COL[t.kind], 0.7);
      m.userData.trace = true;
      m.position.copy(t.a).add(t.b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(V(0, 1, 0), _d.subVectors(t.b, t.a).normalize());
    }
    // what's damaged
    const hurt = this.hurt = new Map();
    const tag = (b, k) => { let s = hurt.get(b); if (!s) hurt.set(b, (s = new Set())); s.add(k); };
    const segs = traces.map((t) => ({ t, a: this.toModel(t.part, t.a), b: this.toModel(t.part, t.b) })).filter((s) => s.a);
    for (const b of X.bones) {
      const U = b.userData;
      for (const s of segs) {
        let dmin = Infinity;
        for (const p of U.pts) dmin = Math.min(dmin, segDist(p, s.a, s.b));
        if (dmin < 0.007 || (dmin < (U.cls === 'multi' ? 0.03 : 0.08) && s.t.hits.some((h) => U.ids.includes(h)))) tag(b, s.t.kind);
      }
      if (frac) for (const f of frac) if (U.cls === 'one' && U.ids.includes(f)) tag(b, 'fracture');
    }
    const hitNames = new Set(traces.flatMap((t) => t.hits));
    this.badOrgans = [...hitNames].map((n) => X.organs[ORGAN_OF[n]]).filter(Boolean);
    this.badVessels = [...hitNames].flatMap((n) => (VESSEL_OF[n] || []).flatMap((k) => X.vessels[k] || []));
    // colours back, then the damage on top
    for (const b of X.bones) b.userData.mat.uniforms.c.value.copy(b.userData.mat.userData.base);
    for (const k in X.organs) { const u = X.organs[k].material.uniforms; u.c.value.copy(X.organs[k].material.userData.base); u.a.value = 0.42; }
    for (const k in X.vessels) for (const m of X.vessels[k]) m.material.uniforms.c.value.copy(m.material.userData.base);
    for (const b of hurt.keys()) b.userData.mat.uniforms.c.value.copy(b.userData.mat.userData.base).lerp(HURT, 0.75);
    if (this.bone) { this.bone.userData.mat.uniforms.c.value.copy(HILITE); this.label(this.bone); }
    this.applyLayer();
  }

  /** Show only the current layer (wounds always; their paths inside, unless it's just the skin). */
  applyLayer() {
    const X = this.x;
    if (!X) return;
    const L = LAYERS[this.layer];
    const all = L === 'All';
    for (const b of X.bones) b.visible = all || L === 'Skeleton';
    for (const k in X.organs) X.organs[k].visible = all || L === 'Organs';
    for (const k in X.vessels) for (const m of X.vessels[k]) m.visible = all || L === 'Vessels';
    for (const m of X.shells) m.visible = all || L === 'Skin';
    for (const m of this.marks) if (m.userData.trace) m.visible = L !== 'Skin';
    // (a bone that's gone from view can't stay picked)
    if (this.bone && !this.bone.visible) { this.unlight(this.bone); this.bone = null; }
    this.label(this.bone);
  }

  /** Just before render (vr.frame): the monitor on the hand, the pointers, the overlay. */
  frame() {
    const vr = this.vr, now = performance.now() / 1000;
    // the left pointer and whoever it's on
    const rl = this.picking ? this.ray('left') : null;
    if (rl) {
      let end = rl.o.clone().addScaledVector(rl.d, 6);
      if (this.target) {
        const hp = this.target.groups.head.getWorldPosition(V());
        const cp = this.target.groups.chest.getWorldPosition(V());
        end = cp;
        this.ring.position.copy(hp).add(V(0, 0.38, 0));
        this.ring.scale.setScalar(1 + 0.08 * Math.sin(now * 6));
        this.ring.visible = true;
      } else this.ring.visible = false;
      setLaser(this.lasL, rl.o, end);
    } else { this.lasL.visible = false; this.ring.visible = false; }

    if (!this.A || !this.mon) { this.lasR.visible = false; return; }
    // on the left palm (the controller reconnected: onto the new one)
    const grip = vr.hands.left?.grip;
    if (grip && this.mon.parent !== grip) { grip.add(this.mon); this.mon.position.copy(MOUNT_POS); this.mon.quaternion.copy(MOUNT_Q); }
    this.mon.updateMatrixWorld(true);
    this.refresh();
    this.statT -= 1 / 60;
    if (this.statT <= 0) { this.statT = 0.25; this.stats(); this.history(); }
    // naming bones: the right trigger held, the ray on the monitor
    if (this.aimed && this.rayR) {
      setLaser(this.lasR, this.rayR.o, this.aimAt);
      if (vr.btnDown('right', 0)) {
        const b = this.pickBone(this.rayR);
        if (b && b !== this.bone) {
          if (this.bone) this.unlight(this.bone);
          this.bone = b;
          b.userData.mat.uniforms.c.value.copy(HILITE);
          b.userData.mat.uniforms.f.value = 1.2;
          this.label(b);
          vr.buzz('right', 0.25, 20);
        }
      }
    } else this.lasR.visible = false;
    // the damage throbs
    const k = 0.5 + 0.5 * Math.sin(now * 5);
    for (const m of this.badOrgans || []) { m.material.uniforms.c.value.copy(m.material.userData.base).lerp(HURT, 0.5 + 0.4 * k); m.material.uniforms.a.value = 0.45 + 0.3 * k; }
    for (const m of this.badVessels || []) m.material.uniforms.c.value.setRGB(1, 0.25 + 0.6 * k, 0.25 + 0.4 * k);
    for (const m of this.marks) if (m.userData.pulse) { const s = 1 + 0.25 * k; m.material.uniforms.a.value = 0.6 + 0.4 * k; m.userData.s0 ||= m.scale.clone(); m.scale.copy(m.userData.s0).multiplyScalar(s); }
  }

  /** The vitals column: blood, consciousness, heart, lungs, brain, spine, bones... */
  stats() {
    const A = this.A, O = A.organs, S = O?.state, b = A.brain;
    const c = this.sv, g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(8,22,30,0.92)';
    g.fillRect(0, 0, c.width, c.height);
    const RED = '#ff5a4a', AMB = '#ffb43a', GRN = '#5fe08a', DIM = '#7fa9b2', WHT = '#e6f6fa';
    let y = 18;
    // the headline
    let head = 'CONSCIOUS', hc = GRN;
    if (b?.dead) {
      head = O?.cause === 'brain' ? 'BRAIN DEAD' : 'DEAD'; hc = RED;
    } else if (b?.neuro?.seizing) { head = 'SEIZING'; hc = RED; }
    else if (S?.out) { head = 'KNOCKED OUT'; hc = AMB; }
    g.font = '700 40px system-ui, sans-serif';
    g.textBaseline = 'top';
    g.fillStyle = hc;
    g.fillText(head, 18, y);
    y += 50;
    g.font = '400 24px system-ui, sans-serif';
    g.fillStyle = DIM;
    const why = b?.dead ? ({ brain: 'Brain destroyed', blood: 'Bled out', heart: 'Cardiac arrest', other: 'No vital signs' })[O?.cause] || 'No vital signs'
      : S?.out && O.wakeT !== undefined && O.wakeT < 1e8 ? 'Waking in ~' + Math.ceil(O.wakeT) + 's'
      : S?.out ? 'Unresponsive' : O?.undead ? 'Undead' : 'Responsive';
    g.fillText(why, 18, y);
    y += 44;
    if (!O) { this.stex.needsUpdate = true; return; }
    // blood
    const pct = Math.max(0, Math.round(O.blood * 100));
    g.font = '600 26px system-ui, sans-serif';
    g.fillStyle = WHT;
    g.fillText('Blood', 18, y);
    g.textAlign = 'right';
    const bc = O.blood > 0.85 ? GRN : O.blood > 0.65 ? AMB : RED;
    g.fillStyle = bc;
    g.fillText(pct + '%', c.width - 18, y);
    g.textAlign = 'left';
    y += 36;
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(18, y, c.width - 36, 16);
    g.fillStyle = bc;
    g.fillRect(18, y, (c.width - 36) * Math.min(1, O.blood), 16);
    y += 24;
    g.font = '400 22px system-ui, sans-serif';
    g.fillStyle = DIM;
    g.fillText(O.volume.toFixed(1) + ' / ' + O.maxVol.toFixed(1) + ' L', 18, y);
    y += 40;
    // the rest, a row each
    const row = (k, v, col) => {
      g.font = '500 24px system-ui, sans-serif';
      g.fillStyle = DIM;
      g.fillText(k, 18, y);
      g.textAlign = 'right';
      g.font = '600 24px system-ui, sans-serif';
      g.fillStyle = col;
      g.fillText(v, c.width - 18, y);
      g.textAlign = 'left';
      y += 38;
    };
    const dead = !!b?.dead;
    const W = A.wounds?.wounds || [];
    const nGun = W.filter((w) => w.kind === 'entry').length, nStab = (A.wounds?.traces || []).filter((t) => t.kind === 'stab').length;
    const nCut = W.filter((w) => w.kind === 'cut').length;
    row('Heart', dead ? 'Stopped' : S.dieT >= 0 ? 'Failing ' + Math.ceil(S.dieT) + 's' : 'Beating', dead || S.dieT >= 0 ? RED : GRN);
    row('Breathing', dead ? 'None' : S.lung >= 2 ? 'Both lungs hit' : S.lung ? 'Lung punctured' : 'Normal', dead || S.lung >= 2 ? RED : S.lung ? AMB : GRN);
    const bd = O.brainDmg || 0;
    const pc = Math.round(bd * 100);
    let bv, bcol;
    if (dead) { bv = O.cause === 'brain' ? 'Brain dead' : 'No activity'; bcol = RED; }
    else if (b?.neuro?.seizing) { bv = 'Seizing'; bcol = RED; }
    else if (bd > 0.45) { bv = 'Severe ' + pc + '%'; bcol = RED; }
    else if (bd > 0.15) { bv = 'Damaged ' + pc + '%'; bcol = AMB; }
    else if (bd > 0.003) { bv = 'Concussed ' + Math.max(1, pc) + '%'; bcol = AMB; }
    else if (S.out) { bv = 'Unconscious'; bcol = AMB; }
    else { bv = 'Normal'; bcol = GRN; }
    row('Brain', bv, bcol);
    if (O.postureKind && !dead) row('Posturing', O.postureKind, RED);
    const lim = S.limp;
    const neck = S.armOut[0] && S.armOut[1] && lim.has('chest');
    const legs = lim.has('thighL') && lim.has('thighR');
    row('Spine', neck ? 'Paralysed (neck)' : legs ? 'Paralysed (legs)' : 'OK', neck || legs ? RED : GRN);
    const fr = O.fractures?.size || 0, ribs = S.ribs || 0;
    row('Fractures', fr || ribs ? (fr ? fr + ' bone' + (fr > 1 ? 's' : '') : '') + (fr && ribs ? ', ' : '') + (ribs ? ribs + ' rib' + (ribs > 1 ? 's' : '') : '') : 'None', fr ? RED : ribs ? AMB : GRN);
    row('Internal bleed', O.internal > 0.01 ? 'Heavy' : O.internal > 0.002 ? 'Moderate' : O.internal > 0.0003 ? 'Slight' : 'None', O.internal > 0.01 ? RED : O.internal > 0.0003 ? AMB : GRN);
    row('Gut', S.gut ? 'Wounded' : 'OK', S.gut ? AMB : GRN);
    // pain: what the body reports (organs.js) plus what every wound, break and torn organ would hurt
    // (organs.js only counts some injuries as pain - a plain gunshot to a limb adds none there)
    const pain = Math.min(1, S.pain + nGun * 0.18 + nStab * 0.15 + Math.max(0, nCut - nStab) * 0.06
      + (O.fractures?.size || 0) * 0.25 + (S.ribs || 0) * 0.1 + S.gut * 0.35 + S.lung * 0.15 + (1 - O.blood) * 0.4);
    const pp = Math.round(pain * 100);
    if (O.undead) row('Pain', 'Feels none', GRN);
    else if (dead) row('Pain', 'None', DIM);
    else if (S.out || b?.neuro?.seizing) row('Pain', 'Unaware (' + pp + '%)', AMB);
    else row('Pain', (pain > 0.7 ? 'Severe ' : pain > 0.35 ? 'Moderate ' : pain > 0.05 ? 'Mild ' : 'None ') + (pain > 0.05 ? pp + '%' : ''), pain > 0.7 ? RED : pain > 0.05 ? AMB : GRN);
    row('Gunshots', String(nGun), nGun ? RED : GRN);
    row('Stab wounds', String(nStab), nStab ? RED : GRN);
    if (nCut > nStab) row('Cuts', String(nCut - nStab), AMB);
    if (O.fit && !dead) row('Vomiting', O.fit.bloody ? 'Blood' : 'Yes', O.fit.bloody ? RED : AMB);
    this.stex.needsUpdate = true;
  }

  /** The last few weapon hits that landed on a part, newest first: what with, where, how long ago. */
  history() {
    const c = this.hv, g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(8,22,30,0.92)';
    g.fillRect(0, 0, c.width, c.height);
    const L = (this.A.hitLog || []).slice(-HIST_N).reverse();
    const w = c.width / HIST_N, now = performance.now();
    g.textBaseline = 'top';
    if (!L.length) {
      g.font = '500 30px system-ui, sans-serif';
      g.fillStyle = '#6fa9b4';
      g.fillText('Impact history: no bones or organs hit yet', 18, c.height / 2 - 16);
    }
    L.forEach((h, i) => {
      const x = i * w;
      if (i) { g.fillStyle = 'rgba(95,246,255,0.18)'; g.fillRect(x, 8, 2, c.height - 16); }
      if (i === 0) { g.fillStyle = 'rgba(255,225,74,0.1)'; g.fillRect(x, 0, w, c.height); }
      g.font = '700 26px system-ui, sans-serif';
      g.fillStyle = KIND_COL[h.kind] || '#e6f6fa';
      g.fillText(h.weapon.length > 13 ? h.weapon.slice(0, 12) + '.' : h.weapon, x + 12, 14);
      g.font = '500 24px system-ui, sans-serif';
      g.fillStyle = '#e6f6fa';
      // (the bones and organs it reached; as many as fit)
      g.font = '500 22px system-ui, sans-serif';
      g.fillStyle = '#e6f6fa';
      const names = [...new Set(h.tissues.map(tissueName))];
      let txt = names.join(', ');
      if (g.measureText(txt).width > w - 20) {
        let k = names.length;
        while (k > 1 && g.measureText(names.slice(0, k).join(', ') + ' +' + (names.length - k)).width > w - 20) k--;
        txt = names.slice(0, k).join(', ') + (k < names.length ? ' +' + (names.length - k) : '');
      }
      g.fillText(txt, x + 12, 60);
      const age = (now - h.t) / 1000;
      g.font = '400 20px system-ui, sans-serif';
      g.fillStyle = '#6fa9b4';
      g.textAlign = 'right';
      g.fillText(age < 60 ? Math.floor(age) + 's' : Math.floor(age / 60) + 'm', x + w - 10, 12);
      g.textAlign = 'left';
    });
    this.htex.needsUpdate = true;
  }

  unlight(b) {
    const U = b.userData;
    U.mat.uniforms.f.value = U.f0;
    U.mat.uniforms.c.value.copy(U.mat.userData.base);
    if (this.hurt?.has(b)) U.mat.uniforms.c.value.lerp(HURT, 0.75);
  }
}
