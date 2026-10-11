import * as THREE from 'three';

function grassTexture() {
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let seed = 78421;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  g.fillStyle = '#648f48';
  g.fillRect(0, 0, S, S);
  // Overdraw wrapped color variation and fine blades so the repeating texture has no grid marks.
  for (let i = 0; i < 90; i++) {
    const x = rand() * S, y = rand() * S, r = 12 + rand() * 54;
    const color = i % 2 ? 'rgba(37,69,27,0.28)' : 'rgba(177,190,91,0.18)';
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const gx = x + ox, gy = y + oy;
      const grad = g.createRadialGradient(gx, gy, 0, gx, gy, r);
      grad.addColorStop(0, color); grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.fillRect(gx - r, gy - r, r * 2, r * 2);
    }
  }
  for (let i = 0; i < 11000; i++) {
    const v = rand(), x = rand() * S, y = rand() * S;
    const w = 1 + rand(), h = 2 + rand() * 4;
    g.fillStyle = v < 0.5 ? 'rgba(34,67,25,0.44)' : 'rgba(168,193,91,0.38)';
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) g.fillRect(x + ox, y + oy, w, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const STEP = 0.22; // tallest ledge the feet just walk up onto

/*
  Uniform xz grid over a list of shapes, so queries only look at shapes near the point
  instead of every shape in the level. Candidates always come back in the list's own order
  (sorted, deduplicated), so every query gives exactly the result a full scan would.
*/
const GRID = 2; // m per cell
const gkey = (ix, iz) => (ix + 32768) * 65536 + (iz + 32768);
const EMPTY = Object.freeze([]);
class ShapeGrid {
  constructor(list, bounds) {
    this.cells = new Map();
    this.stamp = new Uint32Array(list.length);
    this.tick = 0;
    this.out = [];
    list.forEach((s, i) => {
      const [x0, z0, x1, z1] = bounds(s);
      const ax = Math.floor(x0 / GRID), bx = Math.floor(x1 / GRID), az = Math.floor(z0 / GRID), bz = Math.floor(z1 / GRID);
      for (let ix = ax; ix <= bx; ix++) for (let iz = az; iz <= bz; iz++) {
        const k = gkey(ix, iz);
        let c = this.cells.get(k);
        if (!c) this.cells.set(k, (c = []));
        c.push(i);
      }
    });
  }
  /** Indices of every shape whose cells touch the rect, ascending. The array is reused. */
  query(x0, z0, x1, z1) {
    const out = this.out;
    out.length = 0;
    const ax = Math.floor(x0 / GRID), bx = Math.floor(x1 / GRID), az = Math.floor(z0 / GRID), bz = Math.floor(z1 / GRID);
    if (ax === bx && az === bz) return this.cells.get(gkey(ax, az)) || EMPTY; // one cell: already ascending (read only!)
    if ((bx - ax + 1) * (bz - az + 1) > 4096) { // absurdly big query: everything
      for (let i = 0; i < this.stamp.length; i++) out.push(i);
      return out;
    }
    const t = ++this.tick, st = this.stamp;
    if (t === 0xffffffff) { st.fill(0); this.tick = 1; }
    for (let ix = ax; ix <= bx; ix++) for (let iz = az; iz <= bz; iz++) {
      const c = this.cells.get(gkey(ix, iz));
      if (!c) continue;
      for (let i = 0; i < c.length; i++) { const j = c[i]; if (st[j] !== this.tick) { st[j] = this.tick; out.push(j); } }
    }
    if (out.length > 1) out.sort((a, b) => a - b);
    return out;
  }
}
export { ShapeGrid };

export class Colliders {
  constructor() { this.boxes = []; this.circles = []; this.solids = []; }

  /** Spatial index of boxes / circles, rebuilt whenever shapes were added. */
  bi() {
    if (this._bg?.n !== this.boxes.length) {
      this._bg = new ShapeGrid(this.boxes, (b) => [b.minX, b.minZ, b.maxX, b.maxZ]);
      this._bg.n = this.boxes.length;
    }
    return this._bg;
  }
  ci() {
    if (this._cg?.n !== this.circles.length) {
      this._cg = new ShapeGrid(this.circles, (c) => [c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r]);
      this._cg.n = this.circles.length;
    }
    return this._cg;
  }

  /** Height of the highest walkable top under (x, z) (within r) that is not above fromY. */
  groundAt(x, z, fromY = Infinity, r = 0) {
    let g = 0;
    const B = this.boxes, C = this.circles;
    const bl = this.bi().query(x - r, z - r, x + r, z + r);
    for (let k = 0; k < bl.length; k++) {
      const b = B[bl[k]];
      if (b.top > fromY + 0.001 || b.top <= g) continue;
      if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) g = b.top;
    }
    const cl = this.ci().query(x - r, z - r, x + r, z + r);
    for (let k = 0; k < cl.length; k++) {
      const c = C[cl[k]];
      if (c.top > fromY + 0.001 || c.top <= g) continue;
      if (Math.hypot(x - c.x, z - c.z) < c.r + r) g = c.top;
    }
    return g;
  }

  /** Surface material beneath a point, for walkable shapes tagged with one. */
  surfaceAt(x, z, fromY = Infinity, r = 0.03) {
    let surface = null, top = -Infinity;
    const boxes = this.boxes, bi = this.bi().query(x - r, z - r, x + r, z + r);
    for (let i = 0; i < bi.length; i++) {
      const b = boxes[bi[i]];
      if (!b.surface || b.top > fromY + 0.02 || b.top <= top) continue;
      if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) { surface = b.surface; top = b.top; }
    }
    const circles = this.circles, ci = this.ci().query(x - r, z - r, x + r, z + r);
    for (let i = 0; i < ci.length; i++) {
      const c = circles[ci[i]];
      if (!c.surface || c.top > fromY + 0.02 || c.top <= top || Math.hypot(x - c.x, z - c.z) >= c.r + r) continue;
      surface = c.surface; top = c.top;
    }
    return surface;
  }

  /** The shapes overlapping an xz rect, for many groundAtIn() lookups inside it. */
  region(x0, z0, x1, z1, out = { boxes: [], circles: [] }) {
    out.boxes.length = out.circles.length = 0;
    const bl = this.bi().query(x0, z0, x1, z1);
    for (let k = 0; k < bl.length; k++) out.boxes.push(this.boxes[bl[k]]);
    const cl = this.ci().query(x0, z0, x1, z1);
    for (let k = 0; k < cl.length; k++) out.circles.push(this.circles[cl[k]]);
    return out;
  }
  /** groundAt() for a point (x, z) that lies inside `reg` (from region()). */
  groundAtIn(reg, x, z, fromY = Infinity) {
    let g = 0;
    const B = reg.boxes, C = reg.circles;
    for (let k = 0; k < B.length; k++) {
      const b = B[k];
      if (b.top > fromY + 0.001 || b.top <= g) continue;
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) g = b.top;
    }
    for (let k = 0; k < C.length; k++) {
      const c = C[k];
      if (c.top > fromY + 0.001 || c.top <= g) continue;
      if (Math.hypot(x - c.x, z - c.z) < c.r) g = c.top;
    }
    return g;
  }

  /** Is there a shape rising above y within r of (x, z)? */
  blocked(x, z, y, r) {
    const B = this.boxes, C = this.circles;
    const bl = this.bi().query(x - r, z - r, x + r, z + r);
    for (let k = 0; k < bl.length; k++) {
      const b = B[bl[k]];
      if (b.top <= y) continue;
      const cx = Math.max(b.minX, Math.min(x, b.maxX)), cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
    }
    const cl = this.ci().query(x - r, z - r, x + r, z + r);
    for (let k = 0; k < cl.length; k++) {
      const c = C[cl[k]];
      if (c.top > y && Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
    }
    return false;
  }

  /**
   * First obstacle hit by a horizontal ray from p along unit dir (xz) within maxDist whose top
   * is between minRise and maxRise above feetY. Returns the entry distance, top height, depth
   * through the shape along dir, and the outward face normal.
   */
  ledge(p, dir, feetY, maxDist, minRise = 0.3, maxRise = 2.4) {
    let best = null;
    const consider = (t0, t1, top, nx, nz) => {
      const rise = top - feetY;
      if (t0 < 0 || t0 > maxDist || rise < minRise || rise > maxRise) return;
      if (best && best.t <= t0) return;
      best = { t: t0, top, depth: t1 - t0, nx, nz, rise };
    };
    // only shapes the segment p -> p + dir * maxDist can reach (hits past maxDist are rejected)
    const ex = p.x + dir.x * maxDist, ez = p.z + dir.z * maxDist;
    const qx0 = Math.min(p.x, ex), qx1 = Math.max(p.x, ex), qz0 = Math.min(p.z, ez), qz1 = Math.max(p.z, ez);
    const bl = this.bi().query(qx0, qz0, qx1, qz1);
    for (let k = 0; k < bl.length; k++) {
      const b = this.boxes[bl[k]];
      let t0 = -Infinity, t1 = Infinity, nx = 0, nz = 0;
      for (let ax = 0; ax < 2; ax++) {
        const o = ax ? p.z : p.x, d = ax ? dir.z : dir.x, lo = ax ? b.minZ : b.minX, hi = ax ? b.maxZ : b.maxX;
        if (Math.abs(d) < 1e-6) { if (o < lo || o > hi) t0 = Infinity; continue; }
        let a = (lo - o) / d, c = (hi - o) / d;
        const n = d > 0 ? -1 : 1;
        if (a > c) { const s = a; a = c; c = s; }
        if (a > t0) { t0 = a; nx = ax === 0 ? n : 0; nz = ax === 1 ? n : 0; }
        t1 = Math.min(t1, c);
      }
      if (t0 < t1) consider(t0, t1, b.top, nx, nz);
    }
    const cl = this.ci().query(qx0, qz0, qx1, qz1);
    for (let k = 0; k < cl.length; k++) {
      const c = this.circles[cl[k]];
      const ox = p.x - c.x, oz = p.z - c.z;
      const bq = ox * dir.x + oz * dir.z, cq = ox * ox + oz * oz - c.r * c.r;
      const disc = bq * bq - cq;
      if (disc <= 0) continue;
      const s = Math.sqrt(disc), t0 = -bq - s, t1 = -bq + s;
      const hx = ox + dir.x * t0, hz = oz + dir.z * t0, l = Math.hypot(hx, hz) || 1;
      consider(t0, t1, c.top, hx / l, hz / l);
    }
    return best;
  }

  /** Push p out of every shape taller than a step above feetY. */
  resolve(p, r, vel, feetY = 0) {
    // Shapes are handled in list order (pushes compound). Only the ones near the start point
    // can matter while p stays within SLACK of it; if a push carries it further, the rest of
    // the list is walked in full, so the result is always what a full scan gives.
    const SLACK = 1;
    let sx = p.x, sz = p.z;
    const bl = this.bi().query(sx - r - SLACK, sz - r - SLACK, sx + r + SLACK, sz + r + SLACK);
    for (let k = 0, far = false, i = 0; far ? i < this.boxes.length : k < bl.length; far ? i++ : k++) {
      if (!far) i = bl[k];
      this._pushBox(this.boxes[i], p, r, vel, feetY);
      if (!far && (Math.abs(p.x - sx) > SLACK || Math.abs(p.z - sz) > SLACK)) { far = true; }
    }
    sx = p.x; sz = p.z;
    const cl = this.ci().query(sx - r - SLACK, sz - r - SLACK, sx + r + SLACK, sz + r + SLACK);
    for (let k = 0, far = false, i = 0; far ? i < this.circles.length : k < cl.length; far ? i++ : k++) {
      if (!far) i = cl[k];
      this._pushCircle(this.circles[i], p, r, vel, feetY);
      if (!far && (Math.abs(p.x - sx) > SLACK || Math.abs(p.z - sz) > SLACK)) { far = true; }
    }
  }
  _pushBox(b, p, r, vel, feetY) {
    {
      if (b.top <= feetY + STEP) return;
      const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
      let dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 < 1e-8) { // inside: push out on nearest face
          const opts = [[p.x - b.minX, -1, 0], [b.maxX - p.x, 1, 0], [p.z - b.minZ, 0, -1], [b.maxZ - p.z, 0, 1]];
          opts.sort((a, c) => a[0] - c[0]);
          dx = opts[0][1]; dz = opts[0][2];
          p.x += dx * (opts[0][0] + r); p.z += dz * (opts[0][0] + r);
        } else {
          const d = Math.sqrt(d2);
          dx /= d; dz /= d;
          p.x = cx + dx * r; p.z = cz + dz * r;
        }
        const vn = vel.x * dx + vel.z * dz;
        if (vn < 0) { vel.x -= vn * dx; vel.z -= vn * dz; }
      }
    }
  }
  _pushCircle(c, p, r, vel, feetY) {
    {
      if (c.top <= feetY + STEP) return;
      let dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz), m = c.r + r;
      if (d < m && d > 1e-6) {
        dx /= d; dz /= d;
        p.x = c.x + dx * m; p.z = c.z + dz * m;
        const vn = vel.x * dx + vel.z * dz;
        if (vn < 0) { vel.x -= vn * dx; vel.z -= vn * dz; }
      }
    }
  }
}

/** Sky colour, fog, hemisphere fill and the shadow-casting sun. */
export function addSky(scene, { sky = 0xa9c1d6, fogNear = 40, fogFar = 160, hemi = 1.3, sunI = 2.6, span = 14, near = 1, far = 50 } = {}) {
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.Fog(sky, fogNear, fogFar);
  scene.add(new THREE.HemisphereLight(0xdfeeff, 0x6b6456, hemi));
  const sun = new THREE.DirectionalLight(0xfff1dc, sunI);
  sun.position.set(8, 14, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = s.bottom = -span; s.right = s.top = span; s.near = near; s.far = far;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  return sun;
}

/** The wooden table the gun and melee weapons are laid out on; floor = height it stands on. */
export function addTable(scene, colliders, x, z, floor = 0, w = 1.4, d = 0.75) {
  const table = { x, z, w, d, top: floor + 0.78 };
  const legH = 0.78;
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x5e3b22, roughness: 0.6 });
  const g = new THREE.Group();
  g.position.set(x, floor, z);
  const top = new THREE.Mesh(new THREE.BoxGeometry(table.w, 0.05, table.d), wood);
  top.position.y = legH - 0.025;
  g.add(top);
  const apron = new THREE.Mesh(new THREE.BoxGeometry(table.w - 0.12, 0.08, table.d - 0.12), dark);
  apron.position.y = legH - 0.09;
  g.add(apron);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, legH - 0.05, 0.06), dark);
    leg.position.set(sx * (table.w / 2 - 0.07), (legH - 0.05) / 2, sz * (table.d / 2 - 0.07));
    g.add(leg);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } }); // (props cast no shadows)
  scene.add(g);
  const h = table.top;
  colliders.boxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: h, surface: 'wood' });
  // blood only stains its top: the sides of the collision volume are open air under the table
  colliders.solids.push({ type: 'box', x, y: h / 2, z, w, h, d, topOnly: true });
  return table;
}

/**
 * Seats: the long sides of every box that stands seat-high above the floor beside it, one
 * spot per ~0.7 m, facing out. o = the floor point at the front edge, h = seat height above it.
 */
export function findSeats(colliders) {
  const seats = [];
  for (const b of colliders.boxes) {
    if (b.noSeat) continue;
    const W = b.maxX - b.minX, D = b.maxZ - b.minZ;
    const alongX = W >= D;
    const L = alongX ? W : D, n = Math.max(1, Math.floor((L - 0.2) / 0.7));
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      for (const s of [-1, 1]) {
        const o = alongX
          ? new THREE.Vector3(b.minX + u * W, 0, s > 0 ? b.maxZ : b.minZ)
          : new THREE.Vector3(s > 0 ? b.maxX : b.minX, 0, b.minZ + u * D);
        const yaw = alongX ? (s > 0 ? 0 : Math.PI) : (s > 0 ? Math.PI / 2 : -Math.PI / 2);
        // benches with a backrest: only the front
        if (b.seatYaw !== undefined && Math.abs(Math.atan2(Math.sin(yaw - b.seatYaw), Math.cos(yaw - b.seatYaw))) > 0.1) continue;
        const fx = o.x + Math.sin(yaw) * 0.3, fz = o.z + Math.cos(yaw) * 0.3;
        const floor = colliders.groundAt(fx, fz, b.top - 0.1);
        const h = b.top - floor;
        if (h < 0.38 || h > 0.62) continue;
        // something in the way of your legs
        if (colliders.blocked(fx, fz, floor + 0.1, 0.12)) continue;
        o.y = floor;
        seats.push({ o, yaw, h, by: null });
      }
    }
  }
  return seats;
}

/**
 * A basic one-room house centred on (cx, cz): 10 x 8 m, 3 m walls, the door in the +z wall.
 * Walls are ground columns (the walking colliders); what's above an opening (lintels) and the
 * roof are physics solids only - people walk under them, bodies and cars still hit them.
 */
export function buildBaseplate(scene, renderer) {
  const sun = addSky(scene);
  const tex = grassTexture();
  const SIZE = 400;
  tex.repeat.set(SIZE / 16, SIZE / 16);
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE, SIZE),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  return {
    colliders: new Colliders(), sun, seats: [], parking: [],
    // Keep the weapon system's rest point offscreen; this level has no display tables.
    table: { x: 10000, z: 10000, top: 0 },
    surfaceAt: () => 'grass',
    spawn: new THREE.Vector3(0, 0, 0), spawnYaw: 0, spawnR: 6, npcs: 1,
  };
}
