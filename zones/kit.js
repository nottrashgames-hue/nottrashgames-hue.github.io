import * as THREE from 'three';
import { rng } from '../cityparts.js';

/*
  Shared bits for the outer districts: canvas textures (all tile seamlessly, sampled in world
  space by worldMat), a few extra unit geometries for instancing, and roof helpers that work in
  the props Frame (u = forward, v = right, y = up).
*/

function canvasTex(size, draw, aniso = 8) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}
function noise(g, S, amt, seed) {
  const r = rng(seed), img = g.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amt;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}
/** Soft blobs, drawn wrapped so the tile stays seamless. */
function blotches(g, S, n, col, rmax, seed) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * S, y = r() * S, rr = r() * rmax + 4;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const cx = x + ox, cy = y + oy;
      if (cx + rr < 0 || cx - rr > S || cy + rr < 0 || cy - rr > S) continue;
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
      gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
    }
  }
}

export function zoneTextures(maxAniso = 8) {
  const T = {};
  // anisotropy only pays on surfaces seen at grazing angles: the ground planes get 8, walls,
  // roofs, rock and water 4 (never the GPU's 16 by default)
  const ground = Math.min(8, maxAniso), aniso = Math.min(4, maxAniso);
  // lawn: 4 m a tile
  T.grass = canvasTex(512, (g, S) => {
    g.fillStyle = '#5f8a3e'; g.fillRect(0, 0, S, S);
    blotches(g, S, 60, 'rgba(40,70,25,0.25)', 70, 51);
    blotches(g, S, 40, 'rgba(150,170,70,0.16)', 60, 52);
    const r = rng(53);
    for (let i = 0; i < 9000; i++) {
      const x = r() * S, y = r() * S, v = r();
      g.fillStyle = v < 0.5 ? 'rgba(35,65,22,0.5)' : 'rgba(140,175,80,0.45)';
      g.fillRect(x, y, 1.5, 3 + r() * 3);
    }
    noise(g, S, 14, 54);
  }, ground);
  // desert sand: 5 m a tile
  T.sand = canvasTex(512, (g, S) => {
    g.fillStyle = '#cfae7c'; g.fillRect(0, 0, S, S);
    blotches(g, S, 50, 'rgba(150,105,60,0.18)', 90, 61);
    blotches(g, S, 40, 'rgba(240,215,170,0.2)', 70, 62);
    const r = rng(63);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${90 + r() * 40},${70 + r() * 30},${50 + r() * 20},0.55)`; g.fillRect(r() * S, r() * S, 2 + r() * 3, 2 + r() * 2); }
    noise(g, S, 22, 64);
  }, ground);
  // clapboard siding: 2 m a tile, 20 cm boards
  T.siding = canvasTex(256, (g, S) => {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, S, S);
    const n = 10, h = S / n;
    for (let i = 0; i < n; i++) {
      const gr = g.createLinearGradient(0, i * h, 0, (i + 1) * h);
      gr.addColorStop(0, '#d0d0d0'); gr.addColorStop(0.18, '#f4f4f4'); gr.addColorStop(1, '#e2e2e2');
      g.fillStyle = gr; g.fillRect(0, i * h, S, h);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, (i + 1) * h - 2, S, 2);
    }
    noise(g, S, 10, 71);
  }, aniso);
  // asphalt shingles: 2 m a tile
  T.shingle = canvasTex(256, (g, S) => {
    g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, S, S);
    const r = rng(81), rows = 12, h = S / rows, w = S / 8;
    for (let i = 0; i < rows; i++) for (let k = -1; k < 9; k++) {
      const v = 150 + (r() - 0.5) * 70;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(k * w + (i % 2) * w / 2 + 1, i * h + 1, w - 2, h - 2);
    }
    noise(g, S, 30, 82);
  }, aniso);
  // cut stone blocks: 2 m a tile
  T.stone = canvasTex(256, (g, S) => {
    g.fillStyle = '#9d978c'; g.fillRect(0, 0, S, S);
    const r = rng(91), rows = 5, h = S / rows;
    for (let i = 0; i < rows; i++) {
      let x = (i % 2) * 30 - 30;
      while (x < S) {
        const w = 40 + r() * 50, v = 200 + (r() - 0.5) * 50;
        g.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
        g.fillRect(x + 2, i * h + 2, w - 4, h - 4);
        x += w;
      }
    }
    // (the row that ran off the right edge carries on at the left)
    noise(g, S, 26, 92);
  }, aniso);
  // sandstone strata: 6 m a tile
  T.rock = canvasTex(256, (g, S) => {
    g.fillStyle = '#b77a52'; g.fillRect(0, 0, S, S);
    const r = rng(101);
    for (let y = 0; y < S; y += 4 + r() * 10) {
      const v = r();
      g.fillStyle = v < 0.3 ? 'rgba(90,45,25,0.35)' : v < 0.6 ? 'rgba(230,170,120,0.3)' : 'rgba(160,90,60,0.25)';
      g.fillRect(0, y, S, 2 + r() * 6);
    }
    blotches(g, S, 30, 'rgba(60,30,15,0.2)', 40, 102);
    noise(g, S, 24, 103);
  }, aniso);
  // water: a tangent-space normal map from a few crossing sine swells (seamless)
  {
    const S = 256, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d'), img = g.createImageData(S, S);
    const waves = [[3, 1, 1.0], [-2, 3, 0.7], [5, -2, 0.45], [1, 6, 0.35], [-7, -4, 0.2]];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let dx = 0, dy = 0;
      for (const [a, b, amp] of waves) {
        const ph = ((a * x + b * y) / S) * Math.PI * 2;
        const d = Math.cos(ph) * amp;
        dx += d * a; dy += d * b;
      }
      const k = 0.06, nx = -dx * k, ny = -dy * k, l = Math.hypot(nx, ny, 1);
      const i = (y * S + x) * 4;
      img.data[i] = (nx / l * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    T.waterN = t;
  }
  return T;
}

// ---------- geometry ----------
/** Unit gable prism: triangle in the u-y plane (base u -0.5..0.5 at y 0, apex y 1), 1 deep in v. */
export const PRISM = (() => {
  const p = [
    // v = +0.5 end and v = -0.5 end (geometry x = v, z = u)
    0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0,
    -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0,
    // slope toward +u
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0,
    // slope toward -u
    0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0,
    // bottom
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((p.length / 3) * 2), 2));
  g.computeVertexNormals();
  return g;
})();
/** Unit square pyramid, base 1 x 1 at y -0.5, apex at y 0.5. */
export const PYRAMID = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4);
export const ROCK = new THREE.IcosahedronGeometry(0.5, 0);
export const DISC = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);

// ---------- helpers ----------
/**
 * A gable roof over a w (along v) x d (along u) footprint whose walls top out at y: wall-coloured
 * gable ends (the prism) and two overhanging shingle slabs. Ridge runs along v.
 */
export function gable(F, { roof, gable: gableB }, u, v, d, w, y, rise, wallCol, roofCol, over = 0.45) {
  F.put(gableB, u, y, v, d, rise, w, wallCol);
  const half = d / 2 + over, drop = rise * over / (d / 2);
  const lo = y - drop + 0.06, hi = y + rise + 0.06;
  F.slope(roof, u - half, lo, u, hi, v, w + over * 2, 0.12, roofCol);
  F.slope(roof, u, hi, u + half, lo, v, w + over * 2, 0.12, roofCol);
}

/** Point-in-polygon (xz pairs). */
export function inPoly(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
