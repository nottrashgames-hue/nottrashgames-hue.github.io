/*
  The survival shop (between waves on the tower): every weapon in the game at a price, bought
  straight into your hand (throwables into your pocket). The catalogue is here; the buying is
  main.js's (onBuy(item) -> true if it went through).
*/

// what each one's worth: cheap junk and tools up to the heavy guns
export const PRICES = {
  melee: { ruler: 5, knife: 25, bat: 30, hammer: 35, crowbar: 45, hatchet: 70, machete: 90, spear: 180, fireaxe: 200, sledge: 220, longsword: 260 },
  guns: { pistol: 150, shotgun: 400, rifle: 750, dmr: 900, sniper: 1100, mg: 1400, gl: 1600, rocket: 2000 },
  throw: { molotov: 40, gas: 60, frag: 120 },
};

export class SvShop {
  /** names: type -> display name; onBuy(item); onClose(); money() -> current cash; left() -> s until the wave */
  constructor({ names, onBuy, onClose, money, left }) {
    Object.assign(this, { onBuy, onClose, money, left });
    this.open = false;
    const el = (this.el = document.createElement('div'));
    el.id = 'svshop';
    el.innerHTML = '<div class="panel"><div class="top"><b class="cash"></b><span class="left"></span><button class="shut" aria-label="Close">✕</button></div><div class="list"></div></div>';
    document.body.appendChild(el);
    el.querySelector('.shut').addEventListener('click', () => this.close());
    el.addEventListener('click', (e) => { if (e.target === el) this.close(); });
    const list = el.querySelector('.list');
    this.btns = [];
    for (const [cat, title] of [['melee', 'Melee'], ['guns', 'Guns'], ['throw', 'Throwables']]) {
      const h = document.createElement('h3');
      h.textContent = title;
      const grid = document.createElement('div');
      grid.className = 'grid';
      const items = Object.entries(PRICES[cat]).sort((a, b) => a[1] - b[1]);
      for (const [type, price] of items) {
        const b = document.createElement('button');
        b.innerHTML = `<span>${names(type)}</span><i>$${price}</i>`;
        const it = { type, price, cat };
        b.addEventListener('click', () => { if (this.onBuy(it)) this.refresh(); });
        grid.appendChild(b);
        this.btns.push({ b, price });
      }
      list.append(h, grid);
    }
    this.cashEl = el.querySelector('.cash');
    this.leftEl = el.querySelector('.left');
  }
  show() { this.open = true; this.el.classList.add('on'); this.refresh(); }
  close() {
    if (!this.open) return;
    this.open = false;
    this.el.classList.remove('on');
    this.onClose?.();
  }
  refresh() {
    const m = this.money();
    this.cashEl.textContent = `$${m}`;
    for (const { b, price } of this.btns) b.classList.toggle('poor', price > m);
  }
  update() {
    if (!this.open) return;
    const t = `next wave in ${Math.ceil(this.left())}s`;
    if (t !== this._t) { this._t = t; this.leftEl.textContent = t; this.refresh(); }
  }
}
