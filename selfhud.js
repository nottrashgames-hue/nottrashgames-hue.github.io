/*
  Two on-screen buttons for your own body: "Stand up" while you're ragdolled, and "Hit yourself"
  while you've a melee weapon in hand. Going limp lets go of the mouse so the button can be clicked.
*/
export class SelfHud {
  /** ctx: { hero, standUp(), hitSelf(), canvas, locked() } */
  constructor(ctx) {
    Object.assign(this, ctx);
    this.root = document.createElement('div');
    this.root.id = 'self-btns';
    this.root.innerHTML = '<button type="button" data-a="stand">Stand up <kbd>G</kbd></button><button type="button" data-a="hit">Hit yourself <kbd>J</kbd></button>';
    this.stand = this.root.querySelector('[data-a="stand"]');
    this.hit = this.root.querySelector('[data-a="hit"]');
    for (const b of [this.stand, this.hit]) for (const ev of ['pointerdown', 'mousedown', 'touchstart']) b.addEventListener(ev, (e) => e.stopPropagation());
    this.stand.addEventListener('click', (e) => { e.stopPropagation(); this.standUp(); this.relock(); });
    this.hit.addEventListener('click', (e) => { e.stopPropagation(); this.hitSelf(); });
    document.body.appendChild(this.root);
    this.wasDown = false;
  }
  relock() { if (!this.mobile) this.canvas.requestPointerLock?.()?.catch?.(() => {}); }
  update() {
    const A = this.hero, down = A.mode === 'ragdoll' && !A.brain.dead && !A.seat;
    // (just gone limp: the cursor back, to reach the button)
    if (down && !this.wasDown && document.pointerLockElement) document.exitPointerLock();
    this.wasDown = down;
    this.stand.hidden = !down;
    this.hit.hidden = !(A.meleeHeld || A.meleeHeldL) || A.brain.dead || !!A.seat;
    this.root.classList.toggle('on', !this.stand.hidden || !this.hit.hidden);
  }
}
