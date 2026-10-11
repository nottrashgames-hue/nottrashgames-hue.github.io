/*
  The spawn menu (baseplate only, ~): everything in the game, by category, put down in front
  of you. The catalogue and the actual spawning are main.js's (it owns every system); this is
  just the panel: a search box and a grid of buttons.
*/

export class SpawnMenu {
  /**
   * cats: [{ name, items: [{ id, label }] }]; onPick(id) spawns it; onClose() when it shuts.
   */
  constructor(cats, onPick, onClose, makeFun, makeAdmin) {
    this.cats = cats;
    this.onClose = onClose;
    const el = (this.el = document.createElement('div'));
    el.id = 'spawn';
    el.innerHTML = '<div class="panel"><div class="top"><input type="search" placeholder="Search" spellcheck="false"><button class="funBtn">FUN</button><button class="adminBtn">ADMIN TOOLS</button><button class="shut" aria-label="Close">✕</button></div><div class="list"></div></div>';
    document.body.appendChild(el);
    const list = (this.list = el.querySelector('.list'));
    // the FUN menu: dress up / reshape your character (fun.js), in the same panel
    this.funBtn = el.querySelector('.funBtn');
    this.fun = makeFun?.(el.querySelector('.panel'));
    if (this.fun) {
      this.fun.onDone = () => this.funMode(false);
      this.funBtn.addEventListener('click', () => this.funMode(!this.fun.open));
    } else this.funBtn.remove();
    // admin tools (admin.js): only ever built for the admins
    this.adminBtn = el.querySelector('.adminBtn');
    this.admin = makeAdmin?.(el.querySelector('.panel'));
    if (this.admin) {
      this.admin.onDone = () => this.close();
      this.adminBtn.addEventListener('click', () => this.adminMode(!this.admin.open));
    } else this.adminBtn.remove();
    this.search = el.querySelector('input');
    el.querySelector('.shut').addEventListener('click', () => this.close());
    // (touch: no keyboard popping up over the list unless you ask for it)
    this.autoFocus = !document.documentElement.classList.contains('touch');
    this.buttons = [];
    for (const c of cats) {
      const h = document.createElement('h3');
      h.textContent = c.name;
      const grid = document.createElement('div');
      grid.className = 'grid';
      for (const it of c.items) {
        const b = document.createElement('button');
        b.textContent = it.label;
        b.addEventListener('click', () => onPick(it.id));
        grid.appendChild(b);
        this.buttons.push({ b, text: (it.label + ' ' + c.name).toLowerCase(), h, grid });
      }
      list.append(h, grid);
    }
    this.search.addEventListener('input', () => this.filter());
    this.search.addEventListener('keydown', (e) => {
      // Enter spawns the first match
      if (e.code === 'Enter') { this.buttons.find((x) => x.b.style.display !== 'none')?.b.click(); e.preventDefault(); }
    });
    el.addEventListener('mousedown', (e) => { if (e.target === el) this.close(); });
  }
  get open() { return this.el.classList.contains('on'); }
  adminMode(on) {
    if (on && this.fun?.open) this.funMode(false);
    if (on) this.admin.show(); else this.admin.hide();
    this.el.classList.toggle('adminOn', on);
    this.adminBtn.textContent = on ? 'Spawn' : 'ADMIN TOOLS';
    if (!on && this.autoFocus) setTimeout(() => this.search.focus(), 0);
  }
  funMode(on) {
    if (on && this.admin?.open) this.adminMode(false);
    if (on) this.fun.show(); else this.fun.hide();
    this.el.classList.toggle('funOn', on);
    this.funBtn.textContent = on ? 'Spawn' : 'FUN';
    if (!on && this.autoFocus) setTimeout(() => this.search.focus(), 0);
  }
  filter() {
    const q = this.search.value.trim().toLowerCase();
    const shown = new Set();
    for (const x of this.buttons) {
      const on = !q || x.text.includes(q);
      x.b.style.display = on ? '' : 'none';
      if (on) shown.add(x.grid);
    }
    for (const x of this.buttons) { x.h.style.display = x.grid.style.display = shown.has(x.grid) ? '' : 'none'; }
  }
  show() {
    this.el.classList.add('on');
    this.search.value = '';
    this.filter();
    // (nothing to spawn here: straight to the admin tools, and no way back to an empty list)
    if (this.admin && !this.cats?.length) { this.adminMode(true); this.adminBtn.style.display = 'none'; return; }
    if (this.autoFocus) setTimeout(() => this.search.focus(), 0);
  }
  close() {
    if (!this.open) return;
    if (this.fun?.open) this.funMode(false);
    if (this.admin?.open) this.adminMode(false);
    this.el.classList.remove('on');
    this.search.blur();
    this.onClose?.();
  }
}
