import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { groups, G_WORLD, G_CAR, G_DEBRIS, G_BODY } from '../physics.js';
import { MeshSlicer, meshVolume } from './MeshSlicer.js';
import { Sliceable, TISSUE } from './Sliceable.js';
import { GORE, bloodOn } from './GoreSettings.js';

/*
  SlicePieces - what happens to a sliceable mesh (not a person: those go through slice.js) when
  BladeCutter cuts it:

  - the cut is queued and run inside a per-frame time budget (GORE.sliceBudgetMs), so a flurry
    of cuts spreads over a few frames instead of dropping one below the headset's rate
  - MeshSlicer splits the real geometry (in the mesh's own space) along the blade's plane
  - each half becomes a piece: a mesh (pooled) with the original materials plus the tissue's
    "inside" material on the cap submesh, and a Rapier rigid body with a convex hull collider
    built from its own vertices. Mass is split by volume (same density as the original).
  - both keep the original's momentum (linear + angular, taken at their own centres) and get a
    shove from the blade along its velocity, and a small push apart along the plane normal
  - pieces inherit the Sliceable settings (cuts + 1) and can be cut again; one smaller than
    minVolume, or past maxCuts, isn't registered as sliceable: it just fades out
  - at most GORE.maxPieces at once: past that the oldest fades out and is recycled
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _p = V(), _q = new THREE.Quaternion(), _s = V(), _c = V(), _w = V();
const PIECE_GROUPS = groups(G_DEBRIS, G_WORLD | G_CAR | G_DEBRIS | G_BODY);

// the cut face: wet flesh / bone / bare wood ... (one shared material per tissue)
const capMats = {};
export function capMaterial(tissue) {
  if (capMats[tissue]) return capMats[tissue];
  const T = TISSUE[tissue] || TISSUE.flesh, wet = T.bleeds;
  // a radial gradient: the rim colour at the outside, the core in the middle (fat / meat / bone)
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  const hex = (c) => '#' + c.toString(16).padStart(6, '0');
  gr.addColorStop(0, hex(T.core)); gr.addColorStop(0.7, hex(T.core)); gr.addColorStop(1, hex(T.rim));
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  // speckle: fibres / grain
  for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; g.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 2, 1); }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (capMats[tissue] = new THREE.MeshPhysicalMaterial({
    map: tex, roughness: wet ? 0.38 : 0.85, metalness: tissue === 'armor' ? 0.8 : 0,
    clearcoat: wet ? 0.7 : 0, clearcoatRoughness: 0.25, side: THREE.DoubleSide,
  }));
}

export class SlicePieces {
  /** ctx: { scene, world, blood, sfx } */
  constructor(ctx) {
    this.ctx = ctx;
    this.pieces = [];      // live: { mesh, body, col, age, fade, drip, cap, mats }
    this.pool = [];        // spare meshes
    this.queue = [];       // cut jobs waiting for budget
    this.stats = { lastMs: 0, avgMs: 0, cuts: 0 };
    // (compile the slicer while nothing's happening, not on the first cut)
    setTimeout(() => MeshSlicer.warmup(), 1500);
  }

  /** Ask for obj to be cut along the world plane through pointW across normalW. */
  request(obj, pointW, normalW, bladeVel, onDone = null) {
    if (this.queue.some((j) => j.obj === obj)) return;
    this.queue.push({ obj, point: pointW.clone(), normal: normalW.clone().normalize(), vel: bladeVel.clone(), onDone });
  }

  /** Run queued cuts, as many as fit this frame's budget (always at least one). */
  process() {
    const t0 = performance.now();
    while (this.queue.length) {
      const j = this.queue.shift();
      const s = performance.now();
      const r = this.cut(j.obj, j.point, j.normal, j.vel);
      const ms = performance.now() - s;
      this.stats.lastMs = ms; this.stats.avgMs = this.stats.avgMs * 0.8 + ms * 0.2; this.stats.cuts++;
      j.onDone?.(r);
      if (performance.now() - t0 > GORE.sliceBudgetMs) break;
    }
  }

  /** Cut now. Returns [posPiece, negPiece] (either may be null) or null if nothing was cut. */
  cut(obj, pointW, normalW, bladeVel) {
    const S = Sliceable.of(obj);
    if (!S || S.exhausted || !obj.geometry || !obj.parent) return null;
    obj.updateWorldMatrix(true, false);
    // the plane, into the mesh's own space
    _inv.copy(obj.matrixWorld).invert();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normalW, pointW).applyMatrix4(_inv);
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const r = MeshSlicer.slice(obj.geometry, plane, { capIndex: mats.length });
    if (!r.pos || !r.neg || !r.crossed) return null;

    // what it was doing: its body's motion (or none: a prop standing still)
    const B = obj.userData.sliceBody;
    const lin = B ? B.linvel() : { x: 0, y: 0, z: 0 }, ang = B ? B.angvel() : { x: 0, y: 0, z: 0 };
    const com = B ? B.translation() : obj.getWorldPosition(V());
    const vol0 = meshVolume(obj.geometry) || 1e-6;
    const mass0 = B ? B.mass() : (obj.userData.mass || vol0 * 600);
    obj.matrixWorld.decompose(_p, _q, _s);
    const allMats = [...mats, capMaterial(S.tissue)];
    // (a source mesh whose groups point past its materials: those draw with the first one)
    for (const geo of [r.pos, r.neg]) for (const g of geo.groups) if (g.materialIndex >= allMats.length || (g.materialIndex >= mats.length && g.materialIndex !== mats.length)) g.materialIndex = 0;
    const out = [];
    for (const [geo, sign] of [[r.pos, 1], [r.neg, -1]]) {
      const vol = meshVolume(geo) * Math.abs(_s.x * _s.y * _s.z);
      const piece = this.spawn(geo, allMats, _p, _q, _s, Math.max(0.05, mass0 * (vol / (vol0 * Math.abs(_s.x * _s.y * _s.z)))));
      if (!piece) continue;
      // momentum: the original's velocity at this piece's centre, plus the blade's shove and a
      // small push apart across the cut
      const pc = piece.body.translation();
      _c.set(pc.x - com.x, pc.y - com.y, pc.z - com.z);
      _w.set(ang.x, ang.y, ang.z).cross(_c);
      const push = sign * 0.6;
      piece.body.setLinvel({ x: lin.x + _w.x + bladeVel.x * 0.25 + normalW.x * push, y: lin.y + _w.y + bladeVel.y * 0.25 + normalW.y * push, z: lin.z + _w.z + bladeVel.z * 0.25 + normalW.z * push }, true);
      piece.body.setAngvel(ang, true);
      piece.cap = { pL: plane.coplanarPoint(V()), nL: plane.normal.clone().multiplyScalar(-sign) };
      piece.drip = S.info.bleeds ? GORE.dripTime : 0;
      piece.tissue = S.tissue;
      // sliceable again - unless it's a crumb now, or cut as often as it can be
      const next = S.inherit();
      if (vol >= S.minVolume && !next.exhausted) Sliceable.attach(piece.mesh, next, piece.body);
      else piece.fade = Math.max(piece.fade, 0.001);
      out.push(piece);
    }
    // the original goes (its own body too, if it had one)
    this.remove(obj);
    while (this.pieces.filter((p) => !p.fade && !p.keep).length > GORE.maxPieces) {
      const old = this.pieces.find((p) => !p.fade && !p.keep);
      if (!old) break;
      old.fade = 0.001;
    }
    return out;
  }

  spawn(geo, mats, p, q, s, mass) {
    const { world, scene } = this.ctx;
    // a convex hull of the piece's own vertices (scaled into the world: colliders have no scale)
    const P = geo.attributes.position.array, n = P.length / 3;
    const step = Math.max(1, Math.floor(n / 256)); // (hulls of a few hundred points are plenty)
    const pts = new Float32Array(Math.ceil(n / step) * 3);
    let k = 0;
    for (let i = 0; i < n; i += step) { pts[k++] = P[i * 3] * s.x; pts[k++] = P[i * 3 + 1] * s.y; pts[k++] = P[i * 3 + 2] * s.z; }
    let desc = RAPIER.ColliderDesc.convexHull(pts.subarray(0, k));
    if (!desc) {
      const bb = geo.boundingBox, c = bb.getCenter(V()).multiply(s), e = bb.getSize(V()).multiply(s).multiplyScalar(0.5);
      desc = RAPIER.ColliderDesc.cuboid(Math.max(e.x, 0.005), Math.max(e.y, 0.005), Math.max(e.z, 0.005)).setTranslation(c.x, c.y, c.z);
    }
    desc.setMass(mass).setFriction(0.8).setRestitution(0.05).setCollisionGroups(PIECE_GROUPS);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(0.05).setAngularDamping(0.2).setCcdEnabled(true));
    const col = world.createCollider(desc, body);
    // (a material list needs groups to draw by: one group for a plain geometry)
    if (!geo.groups.length) geo.addGroup(0, geo.index ? geo.index.count : geo.attributes.position.count, 0);
    const mesh = this.pool.pop() || new THREE.Mesh();
    mesh.geometry = geo;
    mesh.material = mats;
    mesh.scale.copy(s);
    mesh.castShadow = true;
    mesh.visible = true;
    scene.add(mesh);
    const piece = { mesh, body, col, mats, age: 0, fade: 0, drip: 0, cap: null };
    this.sync(piece);
    this.pieces.push(piece);
    return piece;
  }

  /** Take a cut mesh out: a piece back to the pool, an original prop out of the scene. */
  remove(obj) {
    Sliceable.detach(obj);
    const i = this.pieces.findIndex((p) => p.mesh === obj);
    if (i >= 0) { this.recycle(this.pieces[i]); this.pieces.splice(i, 1); return; }
    const B = obj.userData.sliceBody;
    if (B) { try { this.ctx.world.removeRigidBody(B); } catch (e) { /* already gone */ } }
    obj.userData.onSliced?.(obj);
    obj.removeFromParent();
  }

  recycle(p) {
    try { this.ctx.world.removeRigidBody(p.body); } catch (e) { /* already gone */ }
    Sliceable.detach(p.mesh);
    p.mesh.removeFromParent();
    p.mesh.geometry.dispose();
    if (p.fadeMats) for (const m of p.fadeMats) m.dispose();
    this.pool.push(p.mesh);
  }

  sync(p) {
    const t = p.body.translation(), r = p.body.rotation();
    p.mesh.position.set(t.x, t.y, t.z);
    p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  update(dt) {
    this.process();
    const blood = this.ctx.blood;
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      this.sync(p);
      p.age += dt;
      // the open cut drips for a while (from its lowest edge: the cap's centre, pushed down)
      if (p.drip > 0 && blood && bloodOn()) {
        p.drip -= dt;
        if (Math.random() < dt * 6 * GORE.bloodAmount) {
          p.mesh.updateMatrixWorld();
          const at = p.cap.pL.clone().applyMatrix4(p.mesh.matrixWorld);
          const v = p.body.linvel();
          blood.drip(at, V(v.x, v.y, v.z));
        }
      }
      if (!p.fade && !p.keep && p.age > GORE.pieceLifetime && p.body.isSleeping()) p.fade = 0.001;
      if (p.fade) {
        if (!p.fadeMats) { // (its own transparent copies, only once it starts to go)
          p.fadeMats = p.mats.map((m) => { const c = m.clone(); c.transparent = true; return c; });
          p.mesh.material = p.fadeMats;
          Sliceable.detach(p.mesh);
        }
        p.fade += dt;
        const k = 1 - p.fade / GORE.fadeTime;
        for (const m of p.fadeMats) m.opacity = Math.max(0, k);
        if (k <= 0) { this.recycle(p); this.pieces.splice(i, 1); }
      }
    }
  }

  clear() {
    for (const p of this.pieces) this.recycle(p);
    this.pieces.length = 0;
    this.queue.length = 0;
  }
}
