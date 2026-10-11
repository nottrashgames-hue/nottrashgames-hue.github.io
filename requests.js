/*
  The character requests list: for @Rick_Deckard alone, in the pause menu. Every so often (and
  whenever it's opened) it reads the project's comments for requests - "Custom character: ..."
  posts from the Donate panel, and any tip - and files the new ones with the server (server.js
  /api/requests), so they're kept whatever happens to the comments. Biggest donations first;
  each one can be checked off when it's done.
*/

const SCAN_EVERY = 90; // seconds
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function initRequests({ username }) {
  if ((username || '').toLowerCase() !== 'rick_deckard') return;
  const col = document.querySelector('#menu .col'), donate = $('donate');
  const btn = document.createElement('button');
  btn.id = 'reqBtn';
  btn.className = 'toggle';
  btn.textContent = 'Requests';
  col.insertBefore(btn, donate.nextSibling);
  const pane = document.createElement('div');
  pane.id = 'requests';
  pane.hidden = true;
  pane.innerHTML = `<div class="rq-head"><h3>Requests</h3><label><input type="checkbox" class="rq-showdone"> Show done</label></div>
    <p class="rq-sum"></p><div class="rq-list"></div>`;
  $('donor').after(pane);
  const list = pane.querySelector('.rq-list'), sum = pane.querySelector('.rq-sum'), showDone = pane.querySelector('.rq-showdone');
  let items = [];

  const render = () => {
    const open = items.filter((r) => !r.done), shown = showDone.checked ? items : open;
    const owed = open.reduce((a, r) => a + r.credits, 0);
    sum.textContent = items.length ? `${open.length} to do · ${owed.toLocaleString()} credits · ${items.length - open.length} done` : 'No requests yet.';
    list.innerHTML = shown.map((r) => `
      <div class="rq${r.done ? ' done' : ''}" data-id="${esc(r.id)}">
        <input type="checkbox" ${r.done ? 'checked' : ''} title="Done">
        <div class="rq-body">
          <div class="rq-top">
            <a href="https://websim.com/@${esc(r.username)}" target="_blank" rel="noopener"><img src="https://images.websim.com/avatar/${esc(r.username)}" alt="">@${esc(r.username)}</a>
            <b class="rq-cr${r.credits ? '' : ' free'}">${r.credits ? r.credits.toLocaleString() : 'Free'}</b>
          </div>
          <p>${esc(r.content)}</p>
          <time>${r.created ? new Date(r.created).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</time>
        </div>
      </div>`).join('');
  };
  list.addEventListener('change', async (e) => {
    const row = e.target.closest('.rq');
    if (!row) return;
    const r = items.find((x) => x.id === row.dataset.id);
    if (!r) return;
    r.done = e.target.checked ? 1 : 0;
    render();
    try { await fetch('/api/requests/done', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: r.id, done: !!r.done }) }); } catch { /* next load shows the truth */ }
  });
  showDone.addEventListener('change', render);

  const load = async () => {
    try {
      const r = await fetch('/api/requests');
      if (!r.ok) return;
      items = (await r.json()).items || [];
      items.sort((a, b) => b.credits - a.credits || String(a.created).localeCompare(String(b.created)));
      render();
    } catch { /* offline */ }
  };

  // the comments, read for requests: the Donate panel's own posts, and every tip
  const scan = async () => {
    const W = window.websim;
    if (!W?.getComments) return;
    const found = [];
    const take = (c) => {
      const text = c.raw_content || '';
      const credits = c.card_data?.type === 'tip_comment' ? +c.card_data.credits_spent || 0 : 0;
      if (!/^\s*custom character:/i.test(text) && !credits) return;
      const u = c.author?.username;
      if (!u || u.toLowerCase() === 'rick_deckard') return;
      found.push({ id: c.id, username: u, content: text.replace(/^\s*custom character:\s*/i, '').trim() || '(no description)', credits, created: c.created_at });
    };
    try {
      for (const q of [{ q: 'Custom character' }, { only_tips: true }]) {
        let page = await W.getComments({ first: 100, ...q });
        for (let n = 0; page && n < 10; n++) {
          for (const c of page.comments || []) take(c.comment || c);
          page = page.hasNextPage && page.next ? await page.next() : null;
        }
      }
    } catch { /* try again next time */ }
    const uniq = [...new Map(found.map((f) => [f.id, f])).values()];
    if (uniq.length) {
      try { await fetch('/api/requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: uniq }) }); } catch { /* next scan */ }
    }
    await load();
  };

  const others = [['setBtn', 'settings'], ['donate', 'donor'], ['lobbyBtn', 'lobbies']];
  const shut = () => { pane.hidden = true; btn.classList.remove('on'); };
  btn.addEventListener('click', () => {
    if (!pane.hidden) { shut(); $('controls').hidden = false; return; }
    // (one pane at a time: whichever else is open closes)
    for (const [b, p] of others) if ($(b)?.classList.contains('on')) $(b).click();
    for (const [, p] of others) if ($(p)) $(p).hidden = true;
    $('controls').hidden = true;
    pane.hidden = false;
    btn.classList.add('on');
    render();
    scan();
  });
  for (const [b] of others) $(b)?.addEventListener('click', () => { if (!pane.hidden) shut(); });
  // new comments: a new request, most likely
  window.websim?.addEventListener?.('comment:created', () => setTimeout(scan, 1500));
  scan();
  setInterval(scan, SCAN_EVERY * 1000);
}
