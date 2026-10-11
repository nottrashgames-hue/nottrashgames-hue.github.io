/*
  Donating from the pause menu: the player picks a tier, describes the character they want (and
  the colour they bleed), and it goes up as a comment on the project - a tip for the paid tiers,
  which websim's own composer confirms. The creator reads those and builds the bodies (special.js).
    free: your first character    100: each one after    500: custom weapons (up to 5)
    1,000: whatever you want      more (up to 10,000): custom abilities and powers
*/

const MAX = 10000;
const $ = (id) => document.getElementById(id);

export function initDonor({ username }) {
  const btn = $('donate'), panel = $('donor'), controls = $('controls');
  const wish = $('wish'), tip = $('tip'), msg = $('donorMsg');
  const say = (t) => { msg.textContent = t; };
  const tiers = [...document.querySelectorAll('#tiers button')], more = document.querySelector('#tiers .more'), amt = $('tipAmt');
  let credits = 0;
  const label = () => (credits ? `Donate ${credits.toLocaleString()} credits` : 'Send request (free)');
  const pick = (c, el) => {
    credits = c;
    for (const b of tiers) b.classList.toggle('on', b === el);
    more.classList.toggle('on', el === more);
    tip.textContent = label();
    sync();
  };
  for (const b of tiers) b.addEventListener('click', () => pick(+b.dataset.c, b));
  const fromInput = () => {
    const v = Math.round(+amt.value || 0);
    if (v > MAX) { amt.value = MAX; }
    pick(Math.min(MAX, Math.max(0, v)), more);
  };
  amt.addEventListener('focus', fromInput);
  amt.addEventListener('input', fromInput);
  for (const t of ['keydown', 'keyup']) amt.addEventListener(t, (e) => { if (e.code !== 'Escape') e.stopPropagation(); });

  // (typing here isn't playing: only Esc gets through to the game)
  wish.addEventListener('keydown', (e) => { if (e.code !== 'Escape') e.stopPropagation(); });
  wish.addEventListener('keyup', (e) => e.stopPropagation());
  const sync = () => { tip.disabled = !wish.value.trim() || (more.classList.contains('on') && credits <= 1000); };
  wish.addEventListener('input', sync);
  pick(0, tiers[0]);

  tip.addEventListener('click', async () => {
    const text = wish.value.trim();
    if (!text) return;
    if (!username) { say('Sign in to donate.'); return; }
    const r = await window.websim?.postComment?.({ content: `Custom character: ${text}`, ...(credits ? { credits } : null) });
    if (r?.error) say(r.error);
    else say(credits ? 'Confirm the donation to post it.' : 'Thank you! Your character is on its way.');
  });

  // it's up: the request is in
  window.websim?.addEventListener?.('comment:created', (d) => {
    const c = d?.comment;
    if (!c || !username || c.author?.username?.toLowerCase() !== username.toLowerCase()) return;
    if (!c.raw_content?.startsWith('Custom character:')) return;
    wish.value = '';
    sync();
    say('Thank you! Your character is on its way.');
  });

  btn.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    controls.hidden = open;
    // (one side panel at a time: settings shut)
    if (open) { $('settings').hidden = true; $('setBtn').classList.remove('on'); }
    btn.classList.toggle('on', open);
    if (open) { say(username ? '' : 'Sign in to donate.'); wish.focus(); }
  });
}
