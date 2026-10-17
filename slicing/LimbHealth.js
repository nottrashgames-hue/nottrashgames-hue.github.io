/*
  What losing a part does to a person, on top of what slice.js already does when it parts a
  body (it knocks them down into a ragdoll, opens the artery, and a head or torso cut kills -
  organs.die; a leg cut cripples). This adds the rest of "where the cut lands matters", through
  the game's own health state (organs.js):
    - an arm (hand / forearm / upper arm): that arm is useless (organs.state.armOut) and drops
      whatever it was holding
    - a leg (foot / shin / thigh): crippled, limping on what's left (organs.state.limp)
    - head, neck, torso: dead (organs.die - a lethal cut always ends in a ragdoll)
*/
const ARM = new Set(['hand', 'fore', 'upper']), LEG = new Set(['foot', 'shin', 'thigh']);
const LETHAL = new Set(['head', 'neck', 'chest', 'spine', 'pelvis']);

export function limbLost(A, part) {
  if (!A || A.remote) return;           // (someone else's body: their own client decides)
  const kind = part.replace(/[LR]$/, ''), side = part.endsWith('L') ? 0 : part.endsWith('R') ? 1 : -1;
  const O = A.organs, S = O?.state;
  if (ARM.has(kind) && side >= 0) {
    if (S?.armOut) S.armOut[side] = true;
    if (side === 1) { A.meleeHeld?.drop?.(); A.gunHeld?.drop?.(); }
    else A.meleeHeldL?.drop?.();
  } else if (LEG.has(kind)) {
    A.crippled = true;
    S?.limp?.add?.(part);
    if (A.mode !== 'ragdoll') A.goRagdoll?.('collapse');
  } else if (LETHAL.has(kind)) {
    if (!A.brain?.dead) O?.die?.();
    if (A.mode !== 'ragdoll') A.goRagdoll?.('collapse');
  }
  O?.apply?.();
}
