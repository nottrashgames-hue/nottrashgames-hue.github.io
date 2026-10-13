import * as THREE from 'three';

/*
  Blood painted straight into GPU textures. Every stained surface (bloodsurf.js) is one render
  target; splats, drops, smears, prints and tread are recorded during the frame as a list of
  soft dabs and hard-edged quads, then drawn into their surface's texture in one or two
  instanced draws at the end of it. Nothing is drawn on the CPU and nothing is uploaded: however
  much blood is on the ground, a frame only costs the few quads that were actually added.

  The recorder (Pen) speaks the bit of the 2D canvas API the painters use - a transform,
  globalAlpha, globalCompositeOperation ('source-over' / 'destination-out'), fillRect and
  stroked lines - plus dab() for the soft round brush, so the painters read as before.
  Blending mirrors the canvas exactly (premultiplied): paint is ONE / ONE_MINUS_SRC_ALPHA,
  destination-out ZERO / ONE_MINUS_SRC_ALPHA. Quads are antialiased analytically, and sub-pixel
  dabs and lines spread their coverage over a pixel instead of vanishing.
*/

const F = 12; // floats per op: mode, cx, cy, shape, alpha, ax.x, ax.y, ay.x, ay.y, r, g, b

const VERT = `
  attribute vec4 iP;   // cx, cy (px), shape (0 soft, 1 hard), alpha
  attribute vec4 iA;   // the two half-axes (px)
  attribute vec3 iC;
  uniform vec2 uSize;
  varying vec2 vL, vR;
  varying float vShape, vA;
  varying vec3 vC;
  void main() {
    vec2 ax = iA.xy, ay = iA.zw;
    vec2 R = vec2(length(ax), length(ay));
    // (a pixel and a half of margin all round, for the antialiased edge / sub-pixel spread)
    vec2 l = position.xy * (1.0 + 1.5 / max(R, vec2(1e-4)));
    vec2 p = iP.xy + ax * l.x + ay * l.y;
    vL = l; vR = R; vShape = iP.z; vA = iP.w; vC = iC;
    gl_Position = vec4(p / uSize * 2.0 - 1.0, 0.0, 1.0);
  }`;
const FRAG = (erase) => `
  varying vec2 vL, vR;
  varying float vShape, vA;
  varying vec3 vC;
  void main() {
    float a;
    if (vShape < 0.5) {
      // the soft brush: full in the middle, 75% at 0.55, nothing at the rim
      vec2 Re = max(vR, vec2(0.7));
      float r = length(vL * vR / Re);
      float p = r < 0.55 ? 1.0 - 0.25 * r / 0.55 : 0.75 * (1.0 - (r - 0.55) / 0.45);
      a = max(p, 0.0) * (vR.x * vR.y) / (Re.x * Re.y);
    } else {
      // a hard edge, covered by how much of the pixel is inside it
      vec2 d = vR + 0.5 - abs(vL) * vR;
      vec2 c = clamp(min(d, 2.0 * vR), 0.0, 1.0);
      a = c.x * c.y;
    }
    a *= vA;
    if (a <= 0.0) discard;
    gl_FragColor = ${erase ? 'vec4(0.0, 0.0, 0.0, a)' : 'vec4(vC * a, a)'};
  }`;

function material(erase, uni) {
  const Z = THREE.ZeroFactor, O = THREE.OneFactor, I = THREE.OneMinusSrcAlphaFactor;
  return new THREE.ShaderMaterial({
    uniforms: uni, vertexShader: VERT, fragmentShader: FRAG(erase),
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendEquationAlpha: THREE.AddEquation,
    blendSrc: erase ? Z : O, blendDst: I, blendSrcAlpha: erase ? Z : O, blendDstAlpha: I,
    transparent: true, depthTest: false, depthWrite: false,
  });
}

const alphaOf = (s) => {
  if (typeof s !== 'string') return 1;
  const m = /rgba\([^,]+,[^,]+,[^,]+,\s*([^)]+)\)/.exec(s);
  return m ? parseFloat(m[1]) : 1;
};

/** The recorder the painters draw with (one, reused: begin() points it at a surface). */
class Pen {
  constructor() {
    this.ops = null;
    this.TA = 1; this.TB = 0; this.TC = 0; this.TD = 1; this.TE = 0; this.TF = 0;
    this.reset();
    this.path = [];
  }
  reset() {
    this.globalAlpha = 1;
    this.globalCompositeOperation = 'source-over';
    this.fillStyle = [0, 0, 0];
    this.strokeStyle = 'rgba(0,0,0,1)';
    this.lineWidth = 1;
    this.lineCap = 'butt';
  }
  setTransform(a, b, c, d, e, f) { this.TA = a; this.TB = b; this.TC = c; this.TD = d; this.TE = e; this.TF = f; }
  translate(x, y) { this.TE += x * this.TA + y * this.TC; this.TF += x * this.TB + y * this.TD; }
  rotate(r) {
    const c = Math.cos(r), s = Math.sin(r);
    const a = c * this.TA + s * this.TC, b = c * this.TB + s * this.TD;
    this.TC = -s * this.TA + c * this.TC; this.TD = -s * this.TB + c * this.TD;
    this.TA = a; this.TB = b;
  }
  scale(x, y) { this.TA *= x; this.TB *= x; this.TC *= y; this.TD *= y; }
  getT() { return [this.TA, this.TB, this.TC, this.TD, this.TE, this.TF]; }
  setT(m) { this.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]); }

  /** One quad: centre (x, y), half-axes (ux, uy) and (vx, vy), all in the current transform's space. */
  quad(shape, x, y, ux, uy, vx, vy, a, col) {
    if (!(a > 0)) return;
    const { TA, TB, TC, TD } = this, o = this.ops;
    o.push(this.globalCompositeOperation === 'destination-out' ? 1 : 0,
      TA * x + TC * y + this.TE, TB * x + TD * y + this.TF, shape, a > 1 ? 1 : a,
      TA * ux + TC * uy, TB * ux + TD * uy, TA * vx + TC * vy, TB * vx + TD * vy,
      col ? col[0] : 0, col ? col[1] : 0, col ? col[2] : 0);
  }
  /** The soft round brush, centred on (x, y), radii rx, ry, turned by rot, at alpha a. */
  dab(x, y, rx, ry, rot, a, col) {
    const c = rot ? Math.cos(rot) : 1, s = rot ? Math.sin(rot) : 0;
    this.quad(0, x, y, c * rx, s * rx, -s * ry, c * ry, a * this.globalAlpha, col);
  }
  fillRect(x, y, w, h) {
    this.quad(1, x + w / 2, y + h / 2, w / 2, 0, 0, h / 2, this.globalAlpha, this.fillStyle);
  }
  beginPath() { this.path.length = 0; }
  moveTo(x, y) { this.path.push(NaN, NaN, x, y); }
  lineTo(x, y) { this.path.push(x, y); }
  stroke() {
    const P = this.path, hw = this.lineWidth / 2, ext = this.lineCap === 'round' || this.lineCap === 'square' ? hw : 0;
    const a = alphaOf(this.strokeStyle) * this.globalAlpha;
    let px = NaN, py = NaN;
    for (let i = 0; i < P.length; i += 2) {
      const x = P[i], y = P[i + 1];
      if (x !== x) { px = P[i + 2]; py = P[i + 3]; i += 2; continue; }
      const dx = x - px, dy = y - py, L = Math.hypot(dx, dy);
      if (L > 1e-9 && px === px) {
        const ux = dx / L, uy = dy / L, h = L / 2 + ext;
        this.quad(1, (x + px) / 2, (y + py) / 2, ux * h, uy * h, -uy * hw, ux * hw, a, null);
      }
      px = x; py = y;
    }
  }
}

export class BloodPainter {
  constructor() {
    this.renderer = null;
    this.pen = new Pen();
    this.pending = new Set();
    this.uni = { uSize: { value: new THREE.Vector2(1, 1) } };
    this.mats = [material(false, this.uni), material(true, this.uni)];
    this.cap = 0;
    this.grow(4096);
    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = false;
    this.mesh = new THREE.Mesh(this.geo, this.mats[0]);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.scene.add(this.mesh);
    this.cam = new THREE.OrthographicCamera();
  }
  grow(n) {
    this.geo?.dispose();
    this.cap = n;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (k) => new THREE.InstancedBufferAttribute(new Float32Array(n * k), k).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iP', (this.iP = mk(4)));
    g.setAttribute('iA', (this.iA = mk(4)));
    g.setAttribute('iC', (this.iC = mk(3)));
    g.instanceCount = 0;
    this.geo = g;
    if (this.mesh) this.mesh.geometry = g;
  }
  /** A texture to paint into, w x h px (starts empty). */
  target(w, h) {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      depthBuffer: false, stencilBuffer: false, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
    });
    rt.texture.anisotropy = 4;
    rt.texture.colorSpace = THREE.NoColorSpace;
    return rt;
  }
  /** Start recording onto surface S (S.rt, S.ops), surface metres -> pixels by (sx, sy). */
  begin(S, sx, sy) {
    const p = this.pen;
    p.ops = (S.ops ||= []);
    p.reset();
    p.setTransform(sx, 0, 0, sy, 0, 0);
    this.pending.add(S);
    return p;
  }
  /** Wipe a rectangle of S to nothing (pixels). */
  clearRect(S, x, y, w, h) {
    const p = this.begin(S, 1, 1);
    p.globalCompositeOperation = 'destination-out';
    p.fillRect(x, y, w, h);
    p.reset();
  }
  forget(S) { this.pending.delete(S); S.ops = null; }

  /** Draw everything recorded this frame into its surface. */
  flush() {
    const R = this.renderer;
    if (!this.pending.size || !R) return;
    const prevRT = R.getRenderTarget(), xr = R.xr.enabled, auto = R.autoClear, sh = R.shadowMap.autoUpdate;
    R.xr.enabled = false; R.autoClear = false; R.shadowMap.autoUpdate = false;
    for (const S of this.pending) {
      const O = S.ops;
      if (!O || !O.length || !S.rt) { if (O) O.length = 0; continue; }
      this.uni.uSize.value.set(S.rt.width, S.rt.height);
      R.setRenderTarget(S.rt);
      // runs of the same compositing, in the order they were painted
      let i = 0;
      while (i < O.length) {
        const mode = O[i];
        let j = i;
        while (j < O.length && O[j] === mode) j += F;
        let n = (j - i) / F;
        if (n > this.cap) this.grow(Math.min(1 << 20, 1 << Math.ceil(Math.log2(n))));
        n = Math.min(n, this.cap);
        const P = this.iP.array, A = this.iA.array, C = this.iC.array;
        for (let k = 0, q = i; k < n; k++, q += F) {
          P[k * 4] = O[q + 1]; P[k * 4 + 1] = O[q + 2]; P[k * 4 + 2] = O[q + 3]; P[k * 4 + 3] = O[q + 4];
          A[k * 4] = O[q + 5]; A[k * 4 + 1] = O[q + 6]; A[k * 4 + 2] = O[q + 7]; A[k * 4 + 3] = O[q + 8];
          C[k * 3] = O[q + 9]; C[k * 3 + 1] = O[q + 10]; C[k * 3 + 2] = O[q + 11];
        }
        for (const [a, k] of [[this.iP, 4], [this.iA, 4], [this.iC, 3]]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * k); a.needsUpdate = true; }
        this.geo.instanceCount = n;
        this.mesh.material = this.mats[mode];
        R.render(this.scene, this.cam);
        i = j;
      }
      O.length = 0;
    }
    this.pending.clear();
    R.setRenderTarget(prevRT);
    R.xr.enabled = xr; R.autoClear = auto; R.shadowMap.autoUpdate = sh;
  }
}
