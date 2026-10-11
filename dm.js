/*
  Lines aimed at you: whoever said it (picture and @name) and what they said, pinned on your
  screen for as long as their bubble lasts - there even when they're behind you.
*/
const MAX = 3;

export class DirectLines {
  constructor(parent = document.body) {
    this.root = document.createElement('div');
    this.root.id = 'dms';
    parent.appendChild(this.root);
  }

  show(name, text, dur) {
    const el = document.createElement('div');
    el.className = 'dm';
    const img = document.createElement('img');
    img.alt = '';
    img.src = `https://images.websim.com/avatar/${encodeURIComponent(name)}`;
    img.onerror = () => img.remove();
    const body = document.createElement('div');
    const who = document.createElement('b');
    who.textContent = `@${name}`;
    const said = document.createElement('span');
    said.textContent = text;
    body.append(who, said);
    el.append(img, body);
    this.root.prepend(el);
    while (this.root.children.length > MAX) this.root.lastChild.remove();
    requestAnimationFrame(() => el.classList.add('on'));
    setTimeout(() => {
      el.classList.remove('on');
      setTimeout(() => el.remove(), 350);
    }, Math.max(6, dur) * 1000);
  }
}
