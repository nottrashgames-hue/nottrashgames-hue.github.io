import * as THREE from 'three';

/*
  A faint smear of air behind a fast swing: the weapon's business end (two points along it)
  sampled every frame while the strike is live, drawn as a ribbon that fades out behind it.
*/

const N = 14;         // samples kept
const LIFE = 0.11;    // seconds a sample stays visible

export class SwingTrail {
  constructor(scene) {
    this.pts = []; // { a, b, t }
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 2 * 3);
    this.col = new Float32Array(N * 2 * 4);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.tint = [1, 1, 1];
  }

  /** A new sample of the blade (world points a -> b), with how strongly it shows (0..1). */
  push(a, b, k = 1) {
    this.pts.unshift({ a: a.clone(), b: b.clone(), t: 0, k });
    if (this.pts.length > N) this.pts.length = N;
  }
  cut() { this.pts.length = 0; this.mesh.visible = false; }

  update(dt) {
    const P = this.pts;
    for (const p of P) p.t += dt;
    while (P.length && P[P.length - 1].t > LIFE) P.pop();
    if (P.length < 2) { this.mesh.visible = false; return; }
    const pos = this.pos, col = this.col, [r, g, b] = this.tint;
    for (let i = 0; i < N; i++) {
      const p = P[Math.min(i, P.length - 1)];
      const f = i < P.length ? (1 - p.t / LIFE) * (1 - i / P.length) : 0;
      const al = Math.max(0, f) * 0.28 * p.k;
      pos.set([p.a.x, p.a.y, p.a.z, p.b.x, p.b.y, p.b.z], i * 6);
      // the inner edge (toward the hands) fades out: only the far end really blurs
      col.set([r, g, b, al * 0.15, r, g, b, al], i * 8);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
    this.mesh.visible = true;
  }
}
