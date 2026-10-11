import * as THREE from 'three';
import { solveTwoBone, orient, kneePole } from './ik.js';

/*
  costume 'threefold' (special.js): a third arm and a third leg, built from the body's own limb
  pieces (so they're its skin, its size, its hand and foot), and a one-piece swimsuit.

  The extra limbs are a layer on top of the humanoid animation, like the spider's legs: the rig,
  the ragdoll, the network and every pose still know two arms and two legs, and these read where
  the body is each frame and keep up with it by themselves - walking, running, crouched, seated,
  climbing, knocked down, dead, a puppet posed over the network, the FUN menu's doll:
    - the third leg stands behind the other two, its foot planted until the body has moved off
      it, then stepping (an arc) to where it belongs: between and a little behind the real feet,
      wherever they are. Off the ground (in the air, flung about) it just follows them.
    - the third arm comes out of the left side, under the left shoulder, and echoes the left arm
      a moment late: the swing of a walk, a gesture, a two-handed hold, hanging limp.
  No physics of their own; they go wherever the body goes (and are hidden with it).
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);

// the third arm's shoulder (chest frame: +x left, +z front) - under the left one
const SHOULDER3 = V(0.155, 0.04, 0.01);
// the third hip (hips frame), and where its foot goes: from the midpoint of the other two, back
const HIP3 = V(0, -0.07, -0.065);
const BEHIND = 0.15;
// how late the third arm is on the left one (s): walking, about half a swing - they alternate
const LAG = 0.32;

export function threefold(ch) {
  const S = ch.S || 1, kA = ch.kA || 1, kL = ch.kL || 1;
  const L = ch.look;
  const leg = ch.buildLeg(0, 0.25);
  const arm = ch.buildArm(1);
  // (sized as the others are: character.js's constructor has already done theirs)
  if (S !== 1 || kA !== 1 || kL !== 1) {
    for (const g of [leg.thigh, leg.shin]) g.scale.set(S, S * kL, S);
    leg.foot.scale.setScalar(S);
    for (const g of [arm.upper, arm.fore]) g.scale.set(S, S * kA, S);
  }
  if (L.handSize && L.handSize !== 1) arm.hand.scale.multiplyScalar(L.handSize);
  if (L.footSize && L.footSize !== 1) { leg.foot.scale.x *= L.footSize; leg.foot.scale.z *= L.footSize; }
  const groups = [leg.thigh, leg.shin, leg.foot, arm.upper, arm.fore];
  // hidden and shown with the rest of the body
  ch.visualGroups.push(...groups);
  const all = [];
  for (const g of groups) g.traverse((m) => {
    if (!m.isMesh) return;
    all.push(m);
    m.castShadow = m.receiveShadow = true;
    // (they're placed from their own draw: culled where they were left - at first the world's
    // origin - they'd never be drawn, so never placed)
    m.frustumCulled = false;
    m.userData.decal = true; // (no stain volume of its own)
  });

  // ---- the one-piece swimsuit: the torso's shirt and shorts are one colour (special.js); no
  // sleeves, nothing down the thighs, and the shoulder caps are skin ----
  const M = ch.mat;
  const bare = (g) => g.traverse((m) => { if (m.isMesh && (m.material === M.shorts || m.material === M.top)) m.visible = false; });
  for (const l of [...ch.legs, leg]) bare(l.thigh), bare(l.shin);
  for (const a of [...ch.arms, arm]) bare(a.upper), bare(a.fore);
  // (the wardrobe can't bring them back: nothing left for it to switch between)
  if (ch.legSets) ch.legSets.short.length = ch.legSets.long.length = 0;
  if (ch.sleeveSets) ch.sleeveSets.short.length = ch.sleeveSets.long.length = 0;
  // (the shoulder sockets: shirt-coloured blobs on the ribcage - bare shoulders here)
  for (const m of ch.ribcage.children) if (m.isMesh && !m.isSkinnedMesh && m.material === M.top) m.material = M.skin;
  // and one for the third arm to come out of
  const sock = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), M.skin);
  const kS = Math.pow(L.build ?? 1, 0.5) * 0.9 * (L.limb ?? 1);
  sock.scale.set(0.046 * kS, 0.046 * kS, 0.048 * kS);
  sock.position.copy(SHOULDER3).add(V(-0.02, 0, 0));
  sock.castShadow = sock.receiveShadow = true;
  ch.ribcage.add(sock);

  // ---- scratch ----
  const hipQ = new THREE.Quaternion(), chestQ = new THREE.Quaternion(), q = new THREE.Quaternion();
  const hipJ = V(), target = V(), foot = V(), from = V(), to = V(), ankle = V(), knee = V(), end = V(), pole = V();
  const a0 = V(), a1 = V(), back = V(), sh = V(), sh0 = V(), rel = V(), elbow = V(), hand = V(), fwd = V(), out = V();
  const hist = []; // the left arm's recent hand offsets (chest frame) and hand turns, for the echo
  let lastT = 0, inited = false, stepT = -1, stepDur = 0.2, yaw = 0;
  const eul = new THREE.Euler(0, 0, 0, 'YXZ');

  const ground = (x, z, fromY) => {
    const c = ch.colliders;
    if (c) { const g = c.groundAt(x, z, fromY, 0.03); if (Number.isFinite(g)) return g; }
    return fromY - 1;
  };

  function tick(dt) {
    const D = ch.D, AH = D.ANKLE_H;
    ch.hips.updateWorldMatrix(true, false);
    ch.chest.updateWorldMatrix(true, false);
    ch.hips.getWorldQuaternion(hipQ);
    ch.chest.getWorldQuaternion(chestQ);

    // ---- the leg ----
    ch.hips.localToWorld(hipJ.copy(HIP3));
    // where it belongs: between the two real feet, back from them along the pelvis
    ch.legs[0].foot.getWorldPosition(a0);
    ch.legs[1].foot.getWorldPosition(a1);
    back.set(0, 0, -1).applyQuaternion(hipQ);
    fwd.set(0, 0, 1).applyQuaternion(hipQ);
    back.y = 0;
    if (back.lengthSq() > 1e-4) back.normalize();
    target.addVectors(a0, a1).multiplyScalar(0.5).addScaledVector(back, BEHIND * S);
    target.y -= AH; // (ankle -> sole)
    const g = ground(target.x, target.z, target.y + 0.5);
    const onGround = target.y - g < 0.12;
    if (!inited) { foot.copy(target); inited = true; }
    if (onGround) {
      target.y = g;
      // planted until the body has moved off it (or it's left behind out of reach), then a step
      if (stepT < 0 && (foot.distanceTo(target) > 0.2 * S || foot.distanceTo(hipJ) > (D.THIGH + D.SHIN) * 1.02)) {
        from.copy(foot); to.copy(target); stepT = 0;
        const sp = Math.hypot(a0.x - a1.x, a0.z - a1.z);
        stepDur = clamp(0.24 - sp * 0.08, 0.13, 0.24);
      }
      if (stepT >= 0) {
        stepT += dt / stepDur;
        to.lerp(target, 1 - Math.exp(-dt * 12)); // (the landing spot glides with the body)
        const k = smooth(Math.min(1, stepT));
        foot.lerpVectors(from, to, k);
        foot.y += Math.sin(Math.PI * Math.min(1, stepT)) * 0.09 * S;
        if (stepT >= 1) stepT = -1;
      }
      // (never through the floor)
      foot.y = Math.max(foot.y, ground(foot.x, foot.z, foot.y + 0.4));
    } else {
      // off the ground: it goes along with the other two
      stepT = -1;
      foot.lerp(target, 1 - Math.exp(-dt * 14));
    }
    ankle.copy(foot).setY(foot.y + AH);
    kneePole(hipQ, hipJ, ankle, 0, pole, 0);
    solveTwoBone(hipJ, ankle, D.THIGH, D.SHIN, pole, knee, end);
    orient(leg.thigh, hipJ, knee, pole);
    orient(leg.shin, knee, end, pole);
    leg.foot.position.copy(end);
    // the foot turned the way the pelvis faces, flat (pointing a little down when it's in the air)
    yaw = Math.atan2(fwd.x, fwd.z);
    eul.set(onGround ? (stepT >= 0 ? 0.25 * Math.sin(Math.PI * stepT) : 0) : 0.4, yaw, 0);
    leg.foot.quaternion.setFromEuler(eul);

    // ---- the arm: the left one's hand, relative to its shoulder, a moment late ----
    const A = ch.arms[0];
    ch.chest.localToWorld(sh0.set(0.185, 0.2, -0.015));
    A.hand.getWorldPosition(hand);
    rel.subVectors(hand, sh0).applyQuaternion(q.copy(chestQ).invert());
    const hq = A.hand.getWorldQuaternion(new THREE.Quaternion()).premultiply(q);
    hist.push({ t: lastT, rel: rel.clone(), q: hq });
    while (hist.length > 2 && hist[1].t <= lastT - LAG) hist.shift();
    const h0 = hist[0];
    ch.chest.localToWorld(sh.copy(SHOULDER3));
    // (reaching a touch lower and further out than the one it echoes: it hangs from lower down)
    target.copy(h0.rel).add(out.set(0.075, -0.04, 0.03)).applyQuaternion(chestQ).add(sh);
    pole.set(1, -0.5, -0.6).applyQuaternion(chestQ).normalize();
    solveTwoBone(sh, target, D.UPPER_ARM, D.FOREARM, pole, elbow, end);
    fwd.set(0, 0, 1).applyQuaternion(chestQ);
    orient(arm.upper, sh, elbow, fwd, true);
    orient(arm.fore, elbow, end, fwd, true);
    q.copy(h0.q).premultiply(chestQ);
    arm.hand.quaternion.copy(arm.fore.quaternion).invert().multiply(q);
    // the fingers as the left hand has them
    arm.fingers.forEach(([f1, f2], j) => { f1.rotation.z = A.fingers[j][0].rotation.z; f2.rotation.z = A.fingers[j][1].rotation.z; });
    arm.thumb[1].rotation.z = A.thumb[1].rotation.z;
    for (const gr of groups) gr.updateMatrixWorld(true);
  }

  // driven from the render (whichever of its meshes is drawn first each frame moves them all), so
  // it keeps up with anything that moves the body: the player, a puppet, a ragdoll, a doll
  const drive = () => {
    const now = performance.now() / 1000;
    if (lastT && now - lastT < 0.004) return;
    const dt = lastT ? clamp(now - lastT, 1 / 240, 0.05) : 1 / 60;
    lastT = now;
    tick(dt);
  };
  for (const m of all) m.onBeforeRender = drive;
}
