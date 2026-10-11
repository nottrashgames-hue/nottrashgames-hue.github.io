import * as THREE from 'three';

/*
  Building blocks for the city level: canvas textures, materials that map textures in world
  space (so one unit box can be scaled into any wall without stretching), and Batch, which
  gathers thousands of transformed boxes / cylinders into one InstancedMesh per material.
*/

// ---------- seeded random ----------
export function rng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + r() * (hi - lo);
  r.int = (lo, hi) => Math.floor(lo + r() * (hi - lo + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  return r;
}

// ---------- textures ----------
function canvasTex(size, draw, { srgb = true, aniso = 4 } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}
function noise(g, S, amt, seed = 1) {
  const r = rng(seed);
  const img = g.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amt;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}
function blotches(g, S, n, col, rmax, seed) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * S, y = r() * S, rr = r() * rmax + 4;
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
}

// asphalt: one texture = 4 m
export const asphaltTex = () => canvasTex(512, (g, S) => {
  g.fillStyle = '#4a4c50'; g.fillRect(0, 0, S, S);
  blotches(g, S, 40, 'rgba(20,20,22,0.18)', 90, 3);
  blotches(g, S, 25, 'rgba(120,120,120,0.08)', 60, 4);
  noise(g, S, 30, 5);
  // a few hairline cracks
  const r = rng(9);
  g.strokeStyle = 'rgba(20,20,22,0.35)'; g.lineWidth = 1.2;
  for (let i = 0; i < 6; i++) {
    let x = r() * S, y = r() * S;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; g.lineTo(x, y); }
    g.stroke();
  }
}, { aniso: 8 });
// sidewalk: one texture = 3 m, 1.5 m slabs
export const sidewalkTex = () => canvasTex(512, (g, S) => {
  g.fillStyle = '#b5b1aa'; g.fillRect(0, 0, S, S);
  const r = rng(11);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const v = 170 + r() * 22;
    g.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
    g.fillRect(i * S / 2 + 2, j * S / 2 + 2, S / 2 - 4, S / 2 - 4);
  }
  blotches(g, S, 30, 'rgba(60,55,50,0.10)', 50, 12);
  noise(g, S, 22, 13);
  g.fillStyle = 'rgba(70,66,60,0.7)';
  for (let i = 0; i <= 2; i++) { g.fillRect(i * S / 2 - 2, 0, 4, S); g.fillRect(0, i * S / 2 - 2, S, 4); }
}, { aniso: 8 });
// brick: one texture = 2 m
export const brickTex = () => canvasTex(512, (g, S) => {
  g.fillStyle = '#b9b3ab'; g.fillRect(0, 0, S, S);
  const r = rng(21);
  const bw = S / 8, bh = S / 30; // 25 cm x 6.7 cm
  for (let row = 0; row < 30; row++) {
    const off = (row % 2) * bw / 2;
    for (let c = -1; c < 9; c++) {
      const v = 200 + (r() - 0.5) * 60;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(c * bw + off + 1, row * bh + 1, bw - 2, bh - 2);
    }
  }
  noise(g, S, 18, 22);
});
// render / stucco: one texture = 2 m
export const stuccoTex = () => canvasTex(512, (g, S) => {
  g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, S, S);
  blotches(g, S, 50, 'rgba(0,0,0,0.05)', 70, 31);
  noise(g, S, 26, 32);
});
// concrete panels: one texture = 3 m
export const concreteTex = () => canvasTex(512, (g, S) => {
  g.fillStyle = '#dcdcdc'; g.fillRect(0, 0, S, S);
  blotches(g, S, 30, 'rgba(0,0,0,0.06)', 80, 41);
  noise(g, S, 20, 42);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 0, S, 3); g.fillRect(0, 0, 3, S);
});

/**
 * Standard material whose `map` is sampled with world-space coordinates picked by the
 * surface normal (walls: horizontal x vertical, floors: x/z). `scale` = texture repeats/m.
 */
export function worldMat(opts, scale) {
  const m = new THREE.MeshStandardMaterial(opts);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uvScale = { value: scale };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 wp_ = vec4(transformed, 1.0);
        vec3 wn_ = objectNormal;
        #ifdef USE_INSTANCING
          wp_ = instanceMatrix * wp_;
          wn_ = mat3(instanceMatrix) * wn_;
        #endif
        vWP = (modelMatrix * wp_).xyz;
        vWN = normalize(mat3(modelMatrix) * wn_);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;\nuniform float uvScale;')
      .replace('#include <map_fragment>', `
        vec3 an_ = abs(vWN);
        vec2 wuv_ = an_.y > 0.6 ? vWP.xz : (an_.x > an_.z ? vec2(vWP.z, vWP.y) : vWP.xy);
        diffuseColor *= texture2D(map, wuv_ * uvScale);`);
  };
  // scale is a uniform: every worldMat shares one program (onBeforeCompile still runs per
  // material, so each keeps its own uvScale)
  m.customProgramCacheKey = () => 'worldmat';
  return m;
}

// ---------- instancing ----------
const _o = new THREE.Object3D(), _c = new THREE.Color();
export const BOX = new THREE.BoxGeometry(1, 1, 1);
export const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
export const CYL_LO = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
export const SPHERE = new THREE.IcosahedronGeometry(0.5, 1);
export const CONE = new THREE.ConeGeometry(0.5, 1, 12);
export const PLANE = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

/**
 * While an anchor is set, every instance added to any batch is filed under the anchor's
 * chunk cell instead of its own centre: a building's facade details all land in one cell,
 * so its near-detail and far-simplified batches switch together (see LOD below).
 */
let anchor = null;
export const anchorAt = (x, z) => { anchor = [x, z]; };
export const anchorOff = () => { anchor = null; };
/** Run fn anchored at (x, z) unless something bigger (a building, a lot) already holds the anchor. */
export function anchored(x, z, fn) {
  if (anchor) return fn();
  anchor = [x, z];
  try { return fn(); } finally { anchor = null; }
}

/**
 * Facade LOD. A batch built with { lod: NEAR } is only drawn while its cell is within LOD_FAR
 * of the camera (frames, mullions, sills, shallow trim, rails); one with { lod: FAR } only
 * beyond it (the simplified stand-ins, e.g. one glass band per office floor). Both use the
 * same fixed grid, so a cell's two versions swap in the same frame.
 */
export const NEAR = 1, FAR = 2;
export const LOD_FAR = 60;          // m from the camera to a cell's footprint
const LOD_CELL = 32;
export const lodMeshes = [];        // every NEAR / FAR mesh built (city.js hands it to main.js)
/**
 * Foliage doesn't swap hard: its batches use ditherFade materials, which cross-dissolve each
 * instance between LOD_FAR - FADE and LOD_FAR + FADE by its own distance, so here a faded
 * cell only needs to be shown while any of it is inside its side of that band.
 */
export const FADE = 10;
/** Show each LOD mesh on the right side of LOD_FAR for a camera at (x, z). */
export function updateLod(list, x, z) {
  for (const m of list) {
    const L = m.userData.lod;
    const ax = L.x0 - x, bx = x - L.x0 - LOD_CELL, az = L.z0 - z, bz = z - L.z0 - LOD_CELL;
    const dx = Math.max(ax, 0, bx), dz = Math.max(az, 0, bz);
    const dMin = Math.sqrt(dx * dx + dz * dz);
    if (!L.fade) { m.visible = L.kind === NEAR ? dMin < LOD_FAR : dMin >= LOD_FAR; continue; }
    const fx = Math.max(-ax, -bx), fz = Math.max(-az, -bz); // to the cell's far corner
    const dMax = Math.sqrt(fx * fx + fz * fz);
    m.visible = L.kind === NEAR ? dMin < LOD_FAR + FADE : dMax > LOD_FAR - FADE;
  }
}

/**
 * A copy of mat that dissolves an LOD level in or out with screen-space dither (no blending,
 * no sorting): each instance takes its distance from the camera, t runs 0 -> 1 across the
 * fade band, and the NEAR copy drops the fragments the FAR copy keeps, so the two together
 * always cover the tree exactly once.
 */
export function ditherFade(mat, kind) {
  const m = mat.clone();
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vFadeD;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec3 fc_ = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #ifdef USE_INSTANCING
          fc_ = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #endif
        vFadeD = distance(fc_.xz, cameraPosition.xz);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFadeD;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        {
          float t_ = clamp((vFadeD - ${(LOD_FAR - FADE).toFixed(1)}) / ${(2 * FADE).toFixed(1)}, 0.0, 1.0);
          float n_ = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (${kind === NEAR ? 'n_ < t_' : 'n_ >= t_'}) discard;
        }`);
  };
  m.customProgramCacheKey = () => 'ditherfade' + kind;
  return m;
}

/** Collect transformed copies of one geometry+material, then build a single InstancedMesh. */
export class Batch {
  constructor(geo, mat, { cast = true, receive = true, lod = 0, fade = false } = {}) {
    this.geo = geo; this.mat = mat; this.cast = cast; this.receive = receive; this.lod = lod; this.fade = fade;
    this.m = []; this.c = []; this.k = [];
  }
  /** Centre (x, y, z), size (sx, sy, sz), yaw about Y then pitch about local X, roll about local Z. */
  add(x, y, z, sx, sy, sz, color = 0xffffff, yaw = 0, pitch = 0, roll = 0) {
    _o.position.set(x, y, z);
    _o.rotation.set(pitch, yaw, roll, 'YXZ');
    _o.scale.set(sx, sy, sz);
    _o.updateMatrix();
    this.m.push(_o.matrix.clone());
    this.c.push(color);
    this.k.push(anchor ? anchor[0] : x, anchor ? anchor[1] : z);
    return this;
  }
  /**
   * One InstancedMesh per C x C m cell of the ground plan (instances go to the cell their
   * centre, or anchor, is in), each with its own tight bounds, so the camera and the sun's
   * shadow pass only draw the cells they can actually see. Returns the meshes.
   */
  build(scene) {
    if (!this.m.length) return [];
    const cells = new Map();
    // Always cut by geography, however few instances: a batch spread over the map as one mesh
    // never culls (its bounds cover everything). Dense batches get the finer grid; only a
    // batch whose instances all sit within one cell stays a single draw call. LOD batches
    // always use the shared LOD grid.
    const n = this.m.length, K = this.k;
    const C = this.lod ? LOD_CELL : n >= DENSE ? CHUNK : CHUNK_SPARSE;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = K[2 * i], z = K[2 * i + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    if (!this.lod && x1 - x0 <= C && z1 - z0 <= C) cells.set(0, this.m.map((_, i) => i));
    else {
      for (let i = 0; i < n; i++) {
        const k = (Math.floor(K[2 * i] / C) + 2048) * 4096 + Math.floor(K[2 * i + 1] / C) + 2048;
        let c = cells.get(k);
        if (!c) cells.set(k, (c = []));
        c.push(i);
      }
    }
    const out = [];
    for (const [key, idx] of cells) {
      const im = new THREE.InstancedMesh(this.geo, this.mat, idx.length);
      idx.forEach((j, i) => { im.setMatrixAt(i, this.m[j]); im.setColorAt(i, _c.set(this.c[j])); });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = this.cast; im.receiveShadow = this.receive;
      im.computeBoundingSphere();
      im.computeBoundingBox?.();
      im.matrixAutoUpdate = false; // static: never moves
      im.updateMatrix();
      if (this.lod) {
        im.userData.lod = { kind: this.lod, fade: this.fade, x0: (Math.floor(key / 4096) - 2048) * C, z0: ((key % 4096) - 2048) * C };
        im.visible = this.lod === FAR; // until the first updateLod
        lodMeshes.push(im);
      }
      scene.add(im);
      out.push(im);
    }
    this.m = []; this.c = []; this.k = []; // built: free the staging copies
    return out;
  }
}
const CHUNK = 32;        // m per render chunk for dense batches
const CHUNK_SPARSE = 48; // m per chunk for sparser ones (fewer, still-local draw calls)
const DENSE = 1500;      // instance count at which a batch uses the finer grid

/**
 * A frame for placing things on one face of a building: u runs along the wall, `out` is
 * distance in front of it, y is height. Everything added is turned to face outward.
 */
export class Face {
  constructor(cx, cz, nx, nz, len) {
    this.cx = cx; this.cz = cz; this.nx = nx; this.nz = nz; this.len = len;
    this.yaw = Math.atan2(nx, nz);
    this.ux = Math.cos(this.yaw); this.uz = -Math.sin(this.yaw);
  }
  point(u, out) { return [this.cx + this.ux * u + this.nx * out, this.cz + this.uz * u + this.nz * out]; }
  /** Box w (along wall) x h x d (out of wall) whose back sits `out` m in front of the wall. */
  box(batch, u, y, out, w, h, d, color, pitch = 0, roll = 0) {
    const [x, z] = this.point(u, out + d / 2);
    batch.add(x, y, z, w, h, d, color, this.yaw, pitch, roll);
  }
}
