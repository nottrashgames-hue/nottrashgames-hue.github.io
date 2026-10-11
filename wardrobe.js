import { HAIR_STYLES, BEARDS } from './character.js';
import { SKINS } from './people.js';

/*
  The clothes store's fitting spot: a panel of what's on the rails. Every pick shows on you at
  once; leaving pays for whatever differs from what you walked in wearing (or puts it all back).
*/

export const DEFAULT_LOOK = {
  skin: 0xd49a78, top: 0xe8e4dc, shorts: 0x2c3442, shoe: 0x40454d, hair: 0x3a2618,
  hairStyle: 'short', sleeves: 'short', legs: 'short', beard: null,
  sex: 'm', height: 1, build: 1, limb: 1, armLen: 1, legLen: 1, headSize: 1,
  handSize: 1, footSize: 1, neckLen: 1, eyeSize: 1, eyeColor: 0x2b1d14, hairSize: 1,
};
const KEYS = Object.keys(DEFAULT_LOOK);
/** The FUN menu's body sliders: [key, min, max]. */
export const SHAPE_RANGE = [['height', 0.3, 2.6], ['build', 0.35, 3], ['limb', 0.3, 3], ['armLen', 0.35, 2.6], ['legLen', 0.35, 2.6], ['headSize', 0.35, 3.2],
  ['handSize', 0.4, 3], ['footSize', 0.4, 3], ['neckLen', 0.2, 4], ['eyeSize', 0.4, 2.6]];
/** Live sliders (no respawn): [key, min, max]. */
export const HAIR_RANGE = [['hairSize', 0.6, 2.2]];

const TOPS = [0xe8e4dc, 0xf0f0ee, 0x2b2d33, 0x3d6fb6, 0x1f3b5c, 0x6f8fb0, 0xc4553d, 0xb03a48, 0x5a8f55,
  0x7a7f45, 0xd9b440, 0xe07b39, 0x8a5aa8, 0xd27a9a, 0x4aa3a0, 0x9a6b44];
const BOTTOMS = [0x2c3442, 0x2a2a30, 0x3b3f4a, 0x1e2a44, 0x2f4a6e, 0x46607f, 0x5a6470, 0x6b5a45,
  0x8a7a60, 0xb9ab8a, 0x55463a, 0x7a2f35];
export { TOPS, BOTTOMS, SHOES, HAIRS, SKIN_PICK, STYLE_NAMES };
const SHOES = [0x40454d, 0x1b1b1d, 0xe9e7e2, 0x6b4a33, 0x8a2a2a, 0x2c3a58, 0xc9a13a, 0x3d7a4a];
const HAIRS = [0x16110d, 0x2e2018, 0x3a2618, 0x5a3a22, 0x7a5230, 0x9a6a3a, 0xc59a5c, 0xe0c283,
  0x8c3f1f, 0xa8532a, 0x8d8a86, 0xd8d4cc, 0x2a4d8f, 0xb03a70];
const SKIN_PICK = SKINS.filter((_, i) => i % 3 === 0);
const STYLE_NAMES = { short: 'Short', buzz: 'Buzz', long: 'Long', bob: 'Bob', ponytail: 'Ponytail', bun: 'Bun', afro: 'Afro',
  mohawk: 'Mohawk', spiky: 'Spiky', mullet: 'Mullet', pigtails: 'Pigtails', curly: 'Curly', bald: 'Bald' };

const TABS = [
  { name: 'Tops', rows: [
    { key: 'top', colors: TOPS, price: 25 },
    { key: 'sleeves', opts: [['short', 'T-shirt'], ['long', 'Long sleeve']], price: 10 },
  ] },
  { name: 'Bottoms', rows: [
    { key: 'shorts', colors: BOTTOMS, price: 25 },
    { key: 'legs', opts: [['short', 'Shorts'], ['long', 'Trousers']], price: 10 },
  ] },
  { name: 'Shoes', rows: [{ key: 'shoe', colors: SHOES, price: 20 }] },
  { name: 'Hair', rows: [
    { key: 'hairStyle', opts: HAIR_STYLES.map((s) => [s, STYLE_NAMES[s]]), price: 15 },
    { key: 'hair', colors: HAIRS, price: 15 },
    { key: 'beard', opts: [[null, 'Clean'], ['short', 'Stubble'], ['full', 'Beard']], price: 10 },
  ] },
  { name: 'Skin', rows: [{ key: 'skin', colors: SKIN_PICK, price: 0 }] },
];
const PRICE = Object.fromEntries(TABS.flatMap((t) => t.rows.map((r) => [r.key, r.price])));
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

/** A clean copy of a saved look (unknown keys dropped, gaps filled with the default). */
export function sanitizeLook(l) {
  const out = { ...DEFAULT_LOOK };
  if (l && typeof l === 'object') for (const k of KEYS) if (k in l) out[k] = l[k];
  if (!HAIR_STYLES.includes(out.hairStyle)) out.hairStyle = 'short';
  if (out.sex !== 'f') out.sex = 'm';
  for (const [k, lo, hi] of [...SHAPE_RANGE, ...HAIR_RANGE]) out[k] = Math.min(hi, Math.max(lo, +out[k] || 1));
  if (!BEARDS.includes(out.beard)) out.beard = null;
  if (typeof out.eyeColor !== 'number') out.eyeColor = DEFAULT_LOOK.eyeColor;
  return out;
}

export class Wardrobe {
  /** body = the player's Character; money = the wallet; onClose(bought) after leaving. */
  constructor(body, money, sfx, onClose) {
    this.body = body; this.money = money; this.sfx = sfx; this.onClose = onClose;
    this.open = false;
    this.tab = 0;
    const el = this.el = document.createElement('div');
    el.id = 'shop';
    el.innerHTML = `<div class="tabs"></div><div class="rows"></div>
      <div class="foot"><span class="total"></span><button class="cancel">Leave</button><button class="buy">Buy</button></div>`;
    document.body.appendChild(el);
    el.querySelector('.cancel').addEventListener('click', () => this.close(false));
    el.querySelector('.buy').addEventListener('click', () => this.close(true));
  }

  get cost() {
    let c = 0;
    for (const k of KEYS) if (this.cur[k] !== this.start[k]) c += PRICE[k] || 0;
    return c;
  }

  show() {
    this.open = true;
    this.start = sanitizeLook(this.body.look);
    this.cur = { ...this.start };
    this.el.classList.add('on');
    this.render();
  }

  close(buy) {
    if (!this.open) return;
    const cost = this.cost;
    if (buy && cost > 0) {
      if (!this.money.spend(cost)) { this.sfx?.('dry', 0.6); return; }
      this.sfx?.('buy', 0.7);
    } else if (!buy || cost === 0) {
      this.body.restyle(this.start); // put it all back on the rails
    }
    this.open = false;
    this.el.classList.remove('on');
    this.onClose?.(buy && cost > 0);
  }

  set(key, v) {
    this.cur[key] = v;
    this.body.restyle({ [key]: v });
    this.sfx?.('pickup', 0.25);
    this.render();
  }

  render() {
    const el = this.el;
    const tabs = el.querySelector('.tabs');
    tabs.innerHTML = '';
    TABS.forEach((t, i) => {
      const b = document.createElement('button');
      b.textContent = t.name;
      b.classList.toggle('on', i === this.tab);
      b.addEventListener('click', () => { this.tab = i; this.render(); });
      tabs.appendChild(b);
    });
    const rows = el.querySelector('.rows');
    rows.innerHTML = '';
    for (const r of TABS[this.tab].rows) {
      const row = document.createElement('div');
      row.className = r.colors ? 'row sw' : 'row op';
      for (const v of r.colors || r.opts) {
        const val = r.colors ? v : v[0];
        const b = document.createElement('button');
        if (r.colors) b.style.background = hex(v);
        else b.textContent = v[1];
        b.classList.toggle('on', this.cur[r.key] === val);
        b.addEventListener('click', () => this.set(r.key, val));
        row.appendChild(b);
      }
      const price = document.createElement('i');
      price.textContent = r.price ? `$${r.price}` : 'free';
      row.appendChild(price);
      rows.appendChild(row);
    }
    const cost = this.cost;
    const tot = el.querySelector('.total');
    tot.textContent = cost ? `$${cost}` : '';
    tot.classList.toggle('bad', cost > this.money.amount);
    el.querySelector('.buy').textContent = cost ? 'Buy' : 'Done';
  }
}
