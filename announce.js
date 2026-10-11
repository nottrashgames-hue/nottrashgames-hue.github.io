/*
  An admin's global message (server.js 'announce'): a banner across the top of the screen,
  with who sent it, for the seconds they picked. A newer one replaces the one showing.
*/
let el = null, timer = 0;

export function showAnnounce({ text, s, from }) {
  if (!el) {
    el = document.createElement('div');
    el.id = 'announce';
    el.innerHTML = '<div class="from"></div><div class="text"></div><div class="bar"></div>';
    document.body.appendChild(el);
  }
  el.querySelector('.from').textContent = from ? '@' + from : '';
  el.querySelector('.text').textContent = text;
  const bar = el.querySelector('.bar');
  bar.style.transition = 'none';
  bar.style.transform = 'scaleX(1)';
  el.classList.add('on');
  void bar.offsetWidth;
  bar.style.transition = `transform ${s}s linear`;
  bar.style.transform = 'scaleX(0)';
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('on'), s * 1000);
}
