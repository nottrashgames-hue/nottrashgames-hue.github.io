import * as THREE from 'three';

/*
  Blood streams: an artery's jet drawn as one smooth rope of blood instead of hundreds of drops.
  Each jet emits a light "stream point" at a steady rate; the points fly ballistically (gravity,
  a little drag), and every frame the live points of a stream are joined, in the order they came
  out, into a camera-facing ribbon through a Catmull-Rom curve - so a pulsing jet reads as a
  single arc that surges and sags with the heartbeat and trails behind a moving body.
  Points that land (the floor, a box) are gone from the rope and leave one heavy drop where they
  hit, which paints the pool / the splash sound through the normal drop pipeline (blood.js).
  Everything is one draw call, billboarded in the vertex shader.
*/

const MAXP = 1400;     // stream points alive, all streams together
const SUB = 3;         // curve samples between two points
const MAXV = MAXP * SUB * 2 + 8;
const G = 9.81;
const LIFE = 2.2;

function ribbon() {
  const g = new THREE.BufferGeometry();
  const mk = (k) => new THREE.BufferAttribute(new Float32Array(MAXV * k), k).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', mk(3));
  g.setAttribute('tang', mk(3));
  g.setAttribute('side', mk(1));
  g.setAttribute('width', mk(1));
  g.setAttribute('color', mk(3));
  const idx = new THREE.BufferAttribute(new Uint16Array(MAXV * 3), 1).setUsage(THREE.DynamicDrawUsage);
  g.setIndex(idx);
  g.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: `
      attribute vec3 tang;
      attribute float side;
      attribute float width;
      attribute vec3 color;
      varying vec3 vCol;
      varying float vSide;
      void main() {
        vCol = color;
        vSide = side;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 t = (modelViewMatrix * vec4(tang, 0.0)).xyz;
        vec3 off = cross(t, normalize(-mv.xyz));
        float l = length(off);
        off = l > 1e-6 ? off / l : vec3(1.0, 0.0, 0.0);
        // (never thinner than ~a pixel far off: it still reads as a line)
        float w = max(width, -mv.z * 0.0009);
        mv.xyz += off * side * w;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vCol;
      varying float vSide;
      void main() {
        float r = vSide;
        // round: darker at the rims, a wet glint running along it
        vec3 c = vCol * (1.0 - 0.45 * r * r);
        c += vec3(0.45) * smoothstep(0.32, 0.0, abs(r + 0.3));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  // (always 'visible': with nothing to draw it costs nothing, and its shader is compiled at
  // load instead of stalling the first cut)
  m.renderOrder = 1;
  return m;
}

const _a = new THREE.Vector3(), _t = new THREE.Vector3(), _c = new THREE.Vector3();

export class BloodStreams {
  /** blood: the BloodSystem (for landing drops); colour(ink) -> THREE.Color */
  constructor(blood, scene, colour) {
    this.blood = blood;
    this.colour = colour;
    this.list = [];
    this.count = 0;
    this.mesh = ribbon();
    scene.add(this.mesh);
  }

  /** A new stream (one per jet). src: whose blood. */
  open(src, ink) {
    const s = { src, ink, pts: [], closed: false };
    this.list.push(s);
    return s;
  }
  /** No more blood out of it: what's in the air finishes falling. */
  close(s) { if (s) s.closed = true; }

  emit(s, pos, vel, width) {
    if (this.count >= MAXP) return;
    s.pts.push({ p: pos.clone(), prev: pos.clone(), v: vel.clone(), w: width, age: 0, dead: false, col: this.colour(s.ink) });
    this.count++;
  }

  clear() {
    this.list.length = 0;
    this.count = 0;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  update(dt) {
    const B = this.blood, F = B.floor;
    let n = 0;
    for (let si = this.list.length - 1; si >= 0; si--) {
      const s = this.list[si], P = s.pts;
      for (const q of P) {
        if (q.dead) continue;
        q.age += dt;
        q.prev.copy(q.p);
        q.v.multiplyScalar(Math.exp(-0.15 * dt));
        q.v.y -= G * dt;
        q.p.addScaledVector(q.v, dt);
        let land = null;
        const hit = F.hitBox(q.prev, q.p);
        if (hit) land = hit.point;
        else if (q.p.y <= 0.002) land = q.p.setY(0.003);
        if (land || q.age > LIFE) {
          q.dead = true;
          // where it came down: one heavy drop, painted (and heard) by the drop pipeline
          if (land) B.inked(s.src).drip(_a.copy(q.prev).lerp(land, 0.9), q.v, Math.min(0.011, Math.max(0.0062, q.w * 1.5)));
        }
      }
      // (the oldest end lands first: drop what's gone off the front)
      let k = 0;
      while (k < P.length && P[k].dead) k++;
      if (k) P.splice(0, k);
      if (!P.length && s.closed) { this.list.splice(si, 1); continue; }
      n += P.length;
    }
    this.count = n;
    this.draw();
  }

  draw() {
    const g = this.mesh.geometry, A = g.attributes;
    const pos = A.position.array, tg = A.tang.array, sd = A.side.array, wd = A.width.array, cl = A.color.array, ix = g.index.array;
    let v = 0, i = 0;
    const put = (c, t, w, col) => {
      if (v + 2 > MAXV) return false;
      for (let k = 0; k < 2; k++) {
        const o = (v + k) * 3;
        pos[o] = c.x; pos[o + 1] = c.y; pos[o + 2] = c.z;
        tg[o] = t.x; tg[o + 1] = t.y; tg[o + 2] = t.z;
        cl[o] = col.r; cl[o + 1] = col.g; cl[o + 2] = col.b;
        sd[v + k] = k ? 1 : -1;
        wd[v + k] = w;
      }
      v += 2;
      return true;
    };
    for (const s of this.list) {
      const P = s.pts;
      // runs of live points (one landing mid-rope - on a box - breaks it there)
      let a = 0;
      while (a < P.length) {
        while (a < P.length && P[a].dead) a++;
        let b = a;
        while (b < P.length && !P[b].dead) b++;
        const m = b - a;
        if (m >= 2) {
          const first = v;
          const total = (m - 1) * SUB + 1;
          let si = 0;
          for (let j = a; j < b - 1; j++) {
            const p0 = P[Math.max(a, j - 1)].p, p1 = P[j].p, p2 = P[j + 1].p, p3 = P[Math.min(b - 1, j + 2)].p;
            const last = j === b - 2;
            for (let k = 0; k < (last ? SUB + 1 : SUB); k++, si++) {
              const t = k / SUB, t2 = t * t, t3 = t2 * t;
              // Catmull-Rom point and tangent
              _c.set(0, 0, 0)
                .addScaledVector(p0, -0.5 * t3 + t2 - 0.5 * t)
                .addScaledVector(p1, 1.5 * t3 - 2.5 * t2 + 1)
                .addScaledVector(p2, -1.5 * t3 + 2 * t2 + 0.5 * t)
                .addScaledVector(p3, 0.5 * t3 - 0.5 * t2);
              _t.set(0, 0, 0)
                .addScaledVector(p0, -1.5 * t2 + 2 * t - 0.5)
                .addScaledVector(p1, 4.5 * t2 - 5 * t)
                .addScaledVector(p2, -4.5 * t2 + 4 * t + 0.5)
                .addScaledVector(p3, 1.5 * t2 - t);
              const q = P[j], r = P[j + 1];
              let w = q.w + (r.w - q.w) * t;
              // thinning as it stretches out, rounded off at both ends
              const age = q.age + (r.age - q.age) * t;
              w *= Math.max(0.35, 1 - age * 0.45);
              const e = Math.min(si, total - 1 - si);
              if (e < 2) w *= 0.45 + 0.275 * e;
              if (!put(_c, _t, w, q.col)) break;
            }
          }
          const samples = (v - first) / 2;
          for (let k = 0; k + 1 < samples; k++) {
            const o = first + k * 2;
            ix[i++] = o; ix[i++] = o + 1; ix[i++] = o + 2;
            ix[i++] = o + 1; ix[i++] = o + 3; ix[i++] = o + 2;
          }
        }
        a = b;
      }
    }
    if (v) {
      for (const [at, k] of [[A.position, 3], [A.tang, 3], [A.side, 1], [A.width, 1], [A.color, 3]]) {
        at.clearUpdateRanges(); at.addUpdateRange(0, v * k); at.needsUpdate = true;
      }
      g.index.clearUpdateRanges(); g.index.addUpdateRange(0, i); g.index.needsUpdate = true;
    }
    g.setDrawRange(0, i);
  }
}
