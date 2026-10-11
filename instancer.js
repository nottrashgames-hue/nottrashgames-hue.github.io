import * as THREE from 'three';

/*
  Instanced drawing for the loose clutter of the world: litter, casings, street furniture and
  the bits it breaks into. An object "attached" here keeps its Object3D (the transform holder -
  position / quaternion / scale, children and all) but leaves the scene graph: each of its meshes
  becomes one instance in a shared InstancedMesh, pooled by geometry + material look (colour
  goes per instance, so every can colour shares one draw call). `update(obj)` rewrites its
  instances after it moves; `detach(obj)` gives it back its real meshes (picked up, carried).
*/

const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _c = new THREE.Color();

class Pool {
  constructor(scene, geo, mat, cast) {
    this.scene = scene; this.geo = geo; this.mat = mat; this.cast = cast;
    this.cap = 0; this.n = 0; this.refs = []; this.im = null; this.dirty = false;
    this.grow(32);
  }
  grow(cap) {
    const old = this.im;
    const im = new THREE.InstancedMesh(this.geo, this.mat, cap);
    im.castShadow = this.cast; im.receiveShadow = true;
    im.frustumCulled = false; // instances are anywhere; each pool is one cheap call
    im.matrixAutoUpdate = false;
    im.setColorAt(0, _c.set(0xffffff));
    if (old) {
      im.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, this.n * 16));
      im.instanceColor.array.set(old.instanceColor.array.subarray(0, this.n * 3));
      old.removeFromParent(); old.dispose();
    }
    im.count = this.n;
    im.userData.pool = true;
    this.scene.add(im);
    this.im = im; this.cap = cap;
  }
  add(ref, color) {
    if (this.n >= this.cap) this.grow(this.cap * 2);
    const i = this.n++;
    ref.i = i;
    this.refs[i] = ref;
    this.im.setColorAt(i, color);
    this.im.instanceColor.needsUpdate = true;
    this.im.count = this.n;
    return i;
  }
  remove(ref) {
    const i = ref.i, last = --this.n;
    if (i !== last) {
      const mover = this.refs[last];
      const A = this.im.instanceMatrix.array, C = this.im.instanceColor.array;
      A.copyWithin(i * 16, last * 16, last * 16 + 16);
      C.copyWithin(i * 3, last * 3, last * 3 + 3);
      this.refs[i] = mover; mover.i = i;
      this.im.instanceColor.needsUpdate = true;
    }
    this.refs[last] = null;
    ref.i = -1;
    this.im.count = this.n;
    this.dirty = true;
  }
  set(ref, m) { m.toArray(this.im.instanceMatrix.array, ref.i * 16); this.dirty = true; }
}

// materials that differ only in colour share one white twin (colour goes per instance)
const TWINS = new Map();
function twin(m) {
  if (!m.isMeshStandardMaterial || m.map || m.vertexColors) return { mat: m, color: _c.set(0xffffff).clone() };
  const k = [m.roughness, m.metalness, m.opacity, m.transparent, m.side, m.emissive.getHex(), m.emissiveIntensity, m.envMap?.uuid, m.flatShading, m.depthWrite, m.polygonOffset].join('|');
  let t = TWINS.get(k);
  if (!t) { t = m.clone(); t.color.set(0xffffff); TWINS.set(k, t); }
  return { mat: t, color: m.color.clone() };
}

export class Instancer {
  constructor(scene) {
    this.scene = scene;
    this.pools = new Map();
  }
  pool(geo, mat, cast) {
    const k = `${geo.uuid}|${mat.uuid}|${cast ? 1 : 0}`;
    let p = this.pools.get(k);
    if (!p) this.pools.set(k, (p = new Pool(this.scene, geo, mat, cast)));
    return p;
  }

  /** Draw obj (a Mesh or a Group of them) instanced from now on; it leaves the scene graph. */
  attach(obj) {
    if (obj.userData.inst) return obj.userData.inst;
    obj.updateMatrix();
    obj.updateMatrixWorld(true);
    _inv.copy(obj.matrixWorld).invert();
    const slots = [];
    const walk = (o) => {
      if (!o.visible) return;
      if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !Array.isArray(o.material)) {
        const { mat, color } = twin(o.material);
        const s = { pool: this.pool(o.geometry, mat, o.castShadow), i: -1, local: _m.multiplyMatrices(_inv, o.matrixWorld).clone() };
        s.pool.add(s, color);
        slots.push(s);
      }
      for (const c of o.children) walk(c);
    };
    walk(obj);
    const h = { slots };
    obj.userData.inst = h;
    obj.removeFromParent();
    this.update(obj);
    return h;
  }

  /** Real meshes again (added to `parent`, the scene by default). */
  detach(obj, parent = this.scene) {
    const h = obj.userData.inst;
    if (h) {
      for (const s of h.slots) s.pool.remove(s);
      obj.userData.inst = null;
    }
    if (parent && obj.parent !== parent) parent.add(obj);
  }

  /** Gone for good. */
  drop(obj) { this.detach(obj, null); }

  /** It moved: rewrite its instances from obj.position / quaternion / scale. */
  update(obj) {
    const h = obj.userData.inst;
    if (!h) return;
    obj.updateMatrix();
    for (const s of h.slots) s.pool.set(s, _m.multiplyMatrices(obj.matrix, s.local));
  }

  /** Once per frame, before rendering. */
  flush() {
    for (const p of this.pools.values()) if (p.dirty) { p.im.instanceMatrix.needsUpdate = true; p.dirty = false; }
  }
}
