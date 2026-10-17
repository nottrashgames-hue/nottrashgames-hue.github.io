import * as THREE from 'three';

/*
  The baseplate's lawn: a ground texture with real blade detail and a slow large-scale
  patchiness (so the tiling doesn't show).
*/

// value noise for the ground's large patches
const NOISE = /* glsl */ `
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1, 0)), u.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), u.x), u.y);
}
// 1 = lush, darker; 0 = dry, yellower
float gLush(vec2 w) { return gNoise(w * 0.045) * 0.6 + gNoise(w * 0.16 + 3.1) * 0.3 + gNoise(w * 0.6 + 9.7) * 0.1; }
vec3 gTint(vec2 w) {
  float l = gLush(w);
  float dry = smoothstep(0.55, 0.85, gNoise(w * 0.022 + 17.0));
  vec3 t = mix(vec3(1.18, 1.1, 0.82), vec3(0.8, 0.92, 0.78), l);
  return mix(t, t * vec3(1.25, 1.08, 0.62), dry * 0.55);
}
`;

function grassTexture() {
  const S = 1024, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let seed = 78421;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  // draw f at x,y and wherever it would wrap round the edges (the texture tiles)
  const wrap = (x, y, r, f) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const gx = x + ox, gy = y + oy;
      if (gx + r < 0 || gy + r < 0 || gx - r > S || gy - r > S) continue;
      f(gx, gy);
    }
  };
  g.fillStyle = '#4f7436';
  g.fillRect(0, 0, S, S);
  // soil showing through at the roots, and soft clumps of colour
  for (let i = 0; i < 260; i++) {
    const x = rand() * S, y = rand() * S, r = 10 + rand() * 70;
    const k = rand();
    const col = k < 0.25 ? 'rgba(74,58,36,0.22)' : k < 0.6 ? 'rgba(28,54,20,0.3)' : 'rgba(150,170,80,0.18)';
    wrap(x, y, r, (gx, gy) => {
      const grad = g.createRadialGradient(gx, gy, 0, gx, gy, r);
      grad.addColorStop(0, col); grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.fillRect(gx - r, gy - r, r * 2, r * 2);
    });
  }
  // blades, back to front: dark undergrowth first, then the lit tips on top
  g.lineCap = 'round';
  const layers = [
    { n: 26000, light: [0.14, 0.28], len: [5, 12], w: [1.2, 2.2], a: 0.75 },
    { n: 22000, light: [0.26, 0.42], len: [6, 15], w: [1, 1.8], a: 0.8 },
    { n: 12000, light: [0.4, 0.58], len: [5, 12], w: [0.8, 1.4], a: 0.75 },
  ];
  for (const L of layers) {
    for (let i = 0; i < L.n; i++) {
      const x = rand() * S, y = rand() * S;
      const len = L.len[0] + rand() * (L.len[1] - L.len[0]);
      const ang = rand() * Math.PI * 2, bend = (rand() - 0.5) * 0.9;
      const hue = 78 + rand() * 32 - (rand() < 0.08 ? 30 : 0); // the odd yellowed blade
      const light = (L.light[0] + rand() * (L.light[1] - L.light[0])) * 100;
      const sat = 35 + rand() * 30;
      g.strokeStyle = `hsla(${hue},${sat}%,${light}%,${L.a})`;
      g.lineWidth = L.w[0] + rand() * (L.w[1] - L.w[0]);
      const ex = Math.cos(ang) * len, ey = Math.sin(ang) * len;
      const cx = ex * 0.5 - ey * bend * 0.5, cy = ey * 0.5 + ex * bend * 0.5;
      wrap(x, y, len, (gx, gy) => {
        g.beginPath(); g.moveTo(gx, gy); g.quadraticCurveTo(gx + cx, gy + cy, gx + ex, gy + ey); g.stroke();
      });
    }
  }
  // a few clover leaves and dry bits
  for (let i = 0; i < 500; i++) {
    const x = rand() * S, y = rand() * S, clover = rand() < 0.6;
    g.fillStyle = clover ? `hsla(${95 + rand() * 15},40%,${26 + rand() * 10}%,0.85)` : `hsla(${38 + rand() * 10},35%,${38 + rand() * 12}%,0.7)`;
    wrap(x, y, 6, (gx, gy) => {
      if (clover) for (let k = 0; k < 3; k++) { const a = k * 2.09 + rand(); g.beginPath(); g.arc(gx + Math.cos(a) * 2.2, gy + Math.sin(a) * 2.2, 2.2, 0, 7); g.fill(); }
      else g.fillRect(gx, gy, 1 + rand() * 2, 3 + rand() * 4);
    });
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The ground plane (size m square, at y = 0). */
export function grassGround(size, renderer) {
  const tex = grassTexture();
  const TILE = 7; // m per texture repeat
  tex.repeat.set(size / TILE, size / TILE);
  tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec2 vGW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = 'varying vec2 vGW;\n' + NOISE + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= gTint(vGW);');
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  return ground;
}
