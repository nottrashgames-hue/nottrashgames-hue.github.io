import * as THREE from 'three';

/*
  Sliceable - marks a mesh (a prop, a loose piece) or a body part as cuttable, and says how.
  Put one on an Object3D with Sliceable.attach(obj, opts); pieces cut from it inherit a copy
  (cuts + 1) and can be cut again until maxCuts, or until they're smaller than minVolume - then
  they fade out instead (SlicePieces).

  Body parts aren't Object3Ds you attach to: their settings come from LIMBS below (looked up by
  part kind), so every person in the game is sliceable without touching character.js.
*/

// what each tissue does to a blade: resistance (how much of the swing's speed, m/s, a cut through
// 10 cm of it uses up - a 10 m/s swing goes through ~30 cm of flesh, ~5 cm of armour never starts), the cap's colours (outer rim / core), whether it bleeds and what it sounds like
export const TISSUE = {
  flesh: { resistance: 3, rim: 0xd8a080, core: 0xa3222a, bleeds: true, sound: 'flesh', crack: false },
  bone:  { resistance: 6, rim: 0xb83a3a, core: 0xeee6d2, bleeds: true, sound: 'flesh', crack: true },
  armor: { resistance: 40, rim: 0x8a9096, core: 0x6c7278, bleeds: false, sound: 'clank', crack: false },
  cloth: { resistance: 1, rim: 0x9a8d7a, core: 0x7a6d5a, bleeds: false, sound: 'whoosh', crack: false },
  wood:  { resistance: 3.5, rim: 0xc8a06a, core: 0xe0c08a, bleeds: false, sound: 'chop', crack: false },
};

const DEFAULTS = { tissue: 'flesh', resistance: null, minCutVelocity: 3, canBeCut: true, maxCuts: 6, minVolume: 0.00004 };

export class Sliceable {
  constructor(opts = {}) {
    Object.assign(this, DEFAULTS, opts);
    if (this.resistance == null) this.resistance = TISSUE[this.tissue]?.resistance ?? 4;
    this.cuts = opts.cuts || 0;
  }
  get info() { return TISSUE[this.tissue] || TISSUE.flesh; }
  /** A piece cut from this: the same settings, one more cut deep. */
  inherit() { return new Sliceable({ ...this, cuts: this.cuts + 1 }); }
  get exhausted() { return !this.canBeCut || this.cuts >= this.maxCuts; }

  // ---- the registry of sliceable meshes in the scene (what BladeCutter tests against) ----
  static all = new Set();
  /** Make obj (a Mesh) sliceable. body: its Rapier rigid body, if it already has one. */
  static attach(obj, opts = {}, body = null) {
    obj.userData.sliceable = opts instanceof Sliceable ? opts : new Sliceable(opts);
    obj.userData.sliceBody = body;
    Sliceable.all.add(obj);
    return obj.userData.sliceable;
  }
  static detach(obj) { Sliceable.all.delete(obj); delete obj.userData.sliceable; }
  static of(obj) { return obj?.userData?.sliceable || null; }
}

// body parts by kind: flesh round a bone (the bone's share of the resistance is added when the
// blade's path crosses it - BladeCutter), how fast an edge has to be going to start in
export const LIMBS = {
  hand:   new Sliceable({ tissue: 'flesh', resistance: 2.5, minCutVelocity: 1.5 }),
  foot:   new Sliceable({ tissue: 'flesh', resistance: 3, minCutVelocity: 1.75 }),
  fore:   new Sliceable({ tissue: 'flesh', resistance: 3, minCutVelocity: 1.75 }),
  upper:  new Sliceable({ tissue: 'flesh', resistance: 3.5, minCutVelocity: 2.0 }),
  head:   new Sliceable({ tissue: 'bone', resistance: 4, minCutVelocity: 2.25 }),
  neck:   new Sliceable({ tissue: 'flesh', resistance: 3, minCutVelocity: 2.0 }),
  shin:   new Sliceable({ tissue: 'flesh', resistance: 3.5, minCutVelocity: 2.0 }),
  thigh:  new Sliceable({ tissue: 'flesh', resistance: 4.5, minCutVelocity: 2.25 }),
  pelvis: new Sliceable({ tissue: 'flesh', resistance: 4.5, minCutVelocity: 2.75 }),
  spine:  new Sliceable({ tissue: 'flesh', resistance: 4.2, minCutVelocity: 2.75 }),
  chest:  new Sliceable({ tissue: 'flesh', resistance: 4.5, minCutVelocity: 3.0 }),
};
// bone in the middle of each: radius as a share of the part's
export const BONE_SHARE = { fore: 0.3, upper: 0.32, shin: 0.3, thigh: 0.3, head: 0.9, neck: 0.3, chest: 0.4, spine: 0.25, pelvis: 0.45, hand: 0.2, foot: 0.2 };
export function limbOf(part) { return LIMBS[String(part).replace(/[LR]$/, '')] || null; }

export const _tmpColor = new THREE.Color();
