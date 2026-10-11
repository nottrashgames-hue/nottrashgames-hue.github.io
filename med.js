import * as THREE from 'three';

/*
  First aid: bandages and tourniquets, on yourself or on whoever's under the crosshair close by.
  A bandage over a part stops its ordinary bleeding and slows an arterial jet there; a tourniquet
  round a limb shuts off everything below it (jets and all). Applying one takes a moment, standing
  still with the hands on it. The treatment runs on the copy that owns the body (its blood is the
  one that counts) and every copy gets the dressing on it to see.
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const MED = {
  bandage: { name: 'Bandage', key: 'M', time: 1.4, start: 3 },
  tourniquet: { name: 'Tourniquet', key: 'N', time: 2.2, start: 1 },
};
const LIMB = /^(thigh|shin|foot|upper|fore)[LR]$/;
// a limb and everything hanging off it
const BELOW = { thigh: ['thigh', 'shin', 'foot'], shin: ['shin', 'foot'], foot: ['foot'], upper: ['upper', 'fore'], fore: ['fore'] };
const below = (part) => { const s = part.slice(-1); return BELOW[part.slice(0, -1)].map((k) => k + s); };
// (a tourniquet goes on the upper arm / thigh / shin / forearm, never round a foot)
const tqPart = (part) => part.startsWith('foot') ? 'shin' + part.slice(-1) : part;

const CLOTH = new THREE.MeshStandardMaterial({ color: 0xf1ede2, roughness: 0.95 });
const STRAP = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.7 });
const BUCKLE = new THREE.MeshStandardMaterial({ color: 0xc02a1e, roughness: 0.5 });

/** How much is coming out of `part` on A (its wounds plus any jets there). */
function bleedOf(A, parts, jets) {
  let s = 0;
  const set = new Set(parts);
  for (const w of A.wounds?.wounds || []) if (set.has(w.part)) s += w.bleed;
  for (const j of jets) if (j.actor === A && set.has(partOf(A, j.obj))) s += 3 * j.k;
  return s;
}
function partOf(A, obj) { for (const [n, g] of Object.entries(A.groups)) if (g === obj) return n; return null; }

export class Med {
  /** ctx: { hero, sfx, arteries(), send(A, kind, part) -> true if it went to someone else, onHud() } */
  constructor(ctx) {
    this.ctx = ctx;
    this.pocket = {};
    for (const k in MED) this.pocket[k] = MED[k].start;
    this.job = null;
  }
  refill() { for (const k in MED) this.pocket[k] = Math.max(this.pocket[k] || 0, MED[k].start); this.ctx.onHud?.(); }
  give(kind, n) { this.pocket[kind] = (this.pocket[kind] || 0) + n; this.ctx.onHud?.(); }

  /** The part that most needs it on A (a tourniquet: the limb that's losing most). */
  worst(A, kind) {
    const jets = this.ctx.arteries()?.list || [];
    let best = null, bv = 0.05;
    for (const name of Object.keys(A.groups)) {
      if (kind === 'tourniquet' && !LIMB.test(name)) continue;
      const v = bleedOf(A, kind === 'tourniquet' ? below(tqPart(name)) : [name], jets);
      if (v > bv) { bv = v; best = kind === 'tourniquet' ? tqPart(name) : name; }
    }
    return best;
  }

  /** Start putting one on: on `pk` (the crosshair's pick) if that's someone in reach, else on us. */
  start(kind, pk) {
    const me = this.ctx.hero;
    if (this.job || me.brain.dead || me.mode !== 'anim' || me.seat) return null;
    if (!(this.pocket[kind] > 0)) return 'none';
    let A = me, part = null;
    const other = pk?.actor && pk.actor !== me && pk.actor.hero?.root.parent
      && pk.actor.hero.pos.distanceTo(me.hero.pos) < 1.9 ? pk.actor : null;
    if (other) {
      A = other;
      part = pk.part;
      if (kind === 'tourniquet') part = LIMB.test(part) ? tqPart(part) : this.worst(A, kind);
      else if (bleedOf(A, [part], this.ctx.arteries()?.list || []) < 0.05) part = this.worst(A, kind) || part;
    } else part = this.worst(me, kind);
    if (!part) return kind === 'tourniquet' && !other ? 'nolimb' : 'fine';
    this.job = { kind, A, part, t: 0, at: me.hero.pos.clone() };
    this.ctx.sfx?.('pickup', 0.4);
    return 'ok';
  }
  cancel() { this.job = null; }
  get progress() { return this.job ? clamp(this.job.t / MED[this.job.kind].time, 0, 1) : 0; }
  get label() { return this.job ? (this.job.kind === 'bandage' ? 'Bandaging' : 'Tightening') + (this.job.A === this.ctx.hero ? '' : ' them') : ''; }

  update(dt) {
    const J = this.job, me = this.ctx.hero;
    if (!J) return;
    // it takes both hands and standing still (theirs too: out of reach, gone, and it's off)
    const far = J.A !== me && J.A.hero.pos.distanceTo(me.hero.pos) > 2.3;
    if (me.brain.dead || me.mode !== 'anim' || me.seat || me.hero.pos.distanceTo(J.at) > 0.5 || far || !J.A.hero.root.parent) { this.job = null; return; }
    J.t += dt;
    if (J.t < MED[J.kind].time) return;
    this.job = null;
    this.pocket[J.kind]--;
    this.ctx.onHud?.();
    this.ctx.sfx?.('clap', 0.35);
    // theirs to apply if they're someone else's body; either way, it's on for everyone
    if (!(J.A.remote && this.ctx.send?.(J.A, J.kind, J.part))) treat(J.A, J.kind, J.part, this.ctx.arteries());
    this.ctx.show?.(J.A, J.kind, J.part);
  }
}

/** The treatment itself (on the body's owning copy): the bleeding stops, or slows. */
export function treat(A, kind, part, arteries) {
  const parts = kind === 'tourniquet' ? below(part) : [part];
  const set = new Set(parts);
  for (const w of A.wounds?.wounds || []) {
    if (!set.has(w.part)) continue;
    w.bleed *= kind === 'tourniquet' ? 0 : 0.08;
    w.clot = 2;
  }
  if (arteries) {
    for (const j of arteries.list) {
      if (j.actor !== A || !set.has(partOf(A, j.obj))) continue;
      // a bandage packs it: a weak ooze that closes up; a tourniquet stops it dead
      if (kind === 'tourniquet') j.clot = 0.01;
      else { j.k *= 0.3; j.clot = Math.min(j.clot, 8); }
    }
    arteries.list = arteries.list.filter((j) => j.clot > 0.01);
  }
  if (kind === 'tourniquet' && A.organs) A.organs.internal *= 0.7;
}

/** The dressing, on the body where it went (every copy). */
export function dress(A, kind, part) {
  const W = A.wounds, P = W?.parts[part], g = A.groups[part];
  if (!g) return;
  // the limb's cross-section, from its meshes in the part's own space
  const box = new THREE.Box3();
  g.updateWorldMatrix(true, true);
  const inv = g.matrixWorld.clone().invert();
  for (const m of P?.meshes || []) {
    if (!m.geometry) continue;
    m.geometry.computeBoundingBox?.();
    box.union(m.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)));
  }
  const torso = !LIMB.test(part) && part !== 'head';
  const c = box.isEmpty() ? V(0, torso ? 0.1 : -0.12, 0) : box.getCenter(V());
  const size = box.isEmpty() ? V(0.3, 0.2, 0.2) : box.getSize(V());
  let r = torso ? 0.16 : part === 'head' ? 0.07 : Math.max(size.x, size.z) * 0.5;
  // bandage: over the worst wound there; tourniquet: high up the limb
  let y = c.y;
  if (kind === 'tourniquet') y = box.isEmpty() ? -0.05 : box.max.y - size.y * 0.2;
  else {
    const w = (W?.wounds || []).filter((q) => q.part === part).sort((a, b) => b.bleed - a.bleed)[0];
    if (w) y = w.local.y;
    if (part === 'head') { y = c.y - size.y * 0.35; r = 0.055; } // (round the neck)
  }
  const grp = new THREE.Group();
  grp.userData.decal = true;
  grp.position.set(c.x, y, c.z);
  if (kind === 'bandage') {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.07, r * 1.07, torso ? 0.12 : 0.07, 16, 1, true), CLOTH);
    band.material.side = THREE.DoubleSide;
    grp.add(band);
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(r * 1.08, 0.005, 4, 16), CLOTH);
    wrap.rotation.x = Math.PI / 2; wrap.position.y = 0.012; wrap.rotation.z = 0.2;
    grp.add(wrap);
  } else {
    const strap = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, 0.011, 6, 18), STRAP);
    strap.rotation.x = Math.PI / 2;
    grp.add(strap);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.02), BUCKLE);
    buckle.position.set(0, 0, r * 1.04);
    grp.add(buckle);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.07, 6), STRAP);
    rod.rotation.z = Math.PI / 2; rod.position.set(0, 0, r * 1.04 + 0.015);
    grp.add(rod);
  }
  for (const m of grp.children) { m.userData.decal = true; m.castShadow = true; }
  g.add(grp);
  (A.dressings ||= []).push(grp);
}

/** All of A's dressings off (healed / respawned). */
export function undress(A) {
  for (const d of A.dressings || []) d.removeFromParent();
  A.dressings = [];
}
