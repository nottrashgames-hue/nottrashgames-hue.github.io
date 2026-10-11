/*
  The lobby menu (Esc -> Lobbies): every lobby going on every level (server.js splits each level
  into lobbies of a capped size, filling them up and opening new ones as people arrive), how
  full each is and who's in it. Join one (another level's: the page reloads onto that level,
  straight into it), or open a new empty one on this level. Refreshed while it's open.
  Private lobbies: open one (it gets an invite code to share), or type a code to join one;
  anyone playing can be invited with a click (they get a toast with a Join button: inviteToast).
*/

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const PICK_KEY = 'lobbyPick';

/** A lobby picked on another level before the reload: { n, code } for this level, taken once. */
export function takeLobbyPick(map) {
  try {
    const p = JSON.parse(sessionStorage.getItem(PICK_KEY) || 'null');
    sessionStorage.removeItem(PICK_KEY);
    return p && p.map === map ? { n: p.n ?? null, code: p.code || null } : { n: null, code: null };
  } catch { return { n: null, code: null }; }
}
/** Over to another level, straight into lobby n / the private lobby `code` once it's loaded. */
export function pickThenGo(map, n, code, goLevel) {
  try { sessionStorage.setItem(PICK_KEY, JSON.stringify({ map, n, code })); } catch { /* private mode: auto pick */ }
  goLevel(map);
}

export class LobbyMenu {
  /**
   * el: the panel; net: the connection (net.js); map: this level; label(map): its name;
   * online(): multiplayer on at all; goLevel(map): reload onto another level
   */
  constructor(el, { net, map, label, online, goLevel }) {
    this.el = el; this.net = net; this.map = map; this.label = label; this.online = online; this.goLevel = goLevel;
    this.open = false;
    this.busy = false;
    this.note = '';
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b || b.disabled) return;
      const a = b.dataset.act;
      if (a === 'join') this.join(b.dataset.map, +b.dataset.n);
      else if (a === 'new') this.join(this.map, 'new');
      else if (a === 'priv') this.goPrivate('new');
      else if (a === 'code') this.goPrivate(el.querySelector('.lb-code input')?.value || '');
      else if (a === 'leave') this.join(this.map, 'new');
      else if (a === 'copy') { navigator.clipboard?.writeText(this.net.code).catch(() => {}); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1200); }
      else if (a === 'invite') { this.net.invite(b.dataset.id); b.disabled = true; b.textContent = 'Sent'; this.sent.set(b.dataset.id, Date.now()); }
    });
    // (the code box: typing there isn't playing; Enter joins)
    el.addEventListener('keydown', (e) => {
      if (!e.target.closest('.lb-code input')) return;
      e.stopPropagation();
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { this.goPrivate(e.target.value); e.preventDefault(); }
    });
    el.addEventListener('keyup', (e) => { if (e.target.closest('.lb-code input')) e.stopPropagation(); });
    this.sent = new Map(); // conn id -> when we invited them (the button stays 'Sent' a while)
    // (the answer to a swap into a lobby that filled up meanwhile; a welcome: we're in)
    net.on('lobbyFull', (m) => { this.busy = false; this.note = m.code ? `That private lobby is full.` : `Lobby #${m.lobby} just filled up.`; this.refresh(); });
    net.on('badCode', (m) => { this.busy = false; this.note = `No lobby with the code ${m.code || '(empty)'}.`; this.refresh(); });
    net.on('codeMap', (m) => pickThenGo(m.map, null, m.code, this.goLevel));
    net.on('invited', (m) => { this.note = `Invite sent to ${m.name}.`; if (this.open) this.render(this.last); });
    net.on('welcome', () => { if (this.busy) { this.busy = false; this.note = ''; } if (this.open) this.refresh(); });
  }

  show() {
    this.open = true;
    this.el.hidden = false;
    this.note = '';
    this.render(null);
    this.refresh();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.refresh(), 3000);
  }
  hide() {
    this.open = false;
    this.el.hidden = true;
    clearInterval(this.timer);
  }

  async refresh() {
    if (!this.open) return;
    if (!this.online() || !this.net.room) { this.render(null); return; }
    const r = await this.net.lobbies();
    if (this.open) this.render(r);
  }

  join(map, n) {
    if (map !== this.map) { pickThenGo(map, n, null, this.goLevel); return; }
    if (n === this.net.lobby && !this.net.code) return;
    this.busy = true;
    this.note = n === 'new' ? 'Opening a new lobby…' : `Joining lobby #${n}…`;
    this.render(this.last);
    this.net.swap(n);
  }

  /** Into a private lobby: 'new', or by its code. */
  goPrivate(code) {
    code = code === 'new' ? 'new' : String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code || !this.online()) return;
    if (code === this.net.code) return;
    this.busy = true;
    this.note = code === 'new' ? 'Opening a private lobby…' : `Joining ${code}…`;
    this.render(this.last);
    this.net.goPrivate(code);
  }

  render(r) {
    if (r) this.last = r;
    const off = !this.online();
    let html = '<h3>Lobbies</h3>';
    if (off) html += '<p class="lb-note">Multiplayer is off. Turn it on to play with others.</p>';
    else if (!r) html += '<p class="lb-note">Connecting…</p>';
    else {
      const here = this.net.lobby;
      html += `<p class="lb-sum"><b>${r.online}</b> playing in <b>${r.list.length}</b> ${r.list.length === 1 ? 'lobby' : 'lobbies'} · up to ${r.cap} each</p>`;
      // this level's lobbies first, then the others'
      const list = [...r.list].sort((a, b) => (a.map === this.map ? 0 : 1) - (b.map === this.map ? 0 : 1));
      let lastMap = null;
      html += '<div class="lb-list">';
      for (const L of list) {
        if (L.map !== lastMap) { html += `<div class="lb-map">${esc(this.label(L.map))}</div>`; lastMap = L.map; }
        const mine = L.map === this.map && L.n === here, full = L.count >= L.cap;
        const who = L.names.slice(0, 6).map(esc).join(', ') + (L.count > 6 ? ` +${L.count - 6}` : '');
        html += `<div class="lb-row${mine ? ' mine' : ''}">
          <div class="lb-info"><div class="lb-top"><span class="lb-name">Lobby #${L.n}</span><span class="lb-count">${L.count}/${L.cap}</span></div>
            <div class="lb-bar"><i style="width:${Math.min(100, (L.count / L.cap) * 100)}%"></i></div>
            <div class="lb-who">${who}</div></div>
          ${mine ? '<span class="lb-here">You’re here</span>'
            : `<button data-act="join" data-map="${esc(L.map)}" data-n="${L.n}"${full || this.busy ? ' disabled' : ''}>${full ? 'Full' : 'Join'}</button>`}
        </div>`;
      }
      html += '</div>';
      html += `<button class="lb-new" data-act="new"${this.busy ? ' disabled' : ''}>New lobby</button>`;
      // private lobbies: ours (its code to share), or open one / join one by code
      const B = this.busy ? ' disabled' : '';
      html += '<h3 class="lb-h">Private lobby</h3>';
      if (this.net.code) {
        html += `<div class="lb-row mine lb-priv"><div class="lb-info"><div class="lb-top"><span class="lb-name">Invite code</span></div>
          <div class="lb-codeval">${esc(this.net.code)}</div></div><button data-act="copy">Copy</button></div>
          <button class="lb-new" data-act="leave"${B}>Leave private lobby</button>`;
      } else {
        html += `<button class="lb-new" data-act="priv"${B}>Create private lobby</button>
          <div class="lb-code"><input maxlength="6" placeholder="Invite code" spellcheck="false" autocomplete="off"><button data-act="code"${B}>Join</button></div>`;
      }
      // everyone else playing: one click asks them over
      const others = (r.people || []).filter((p) => String(p.id) !== String(this.net.id));
      if (others.length) {
        html += '<h3 class="lb-h">Invite players</h3><div class="lb-list">';
        const now = Date.now();
        for (const p of others) {
          const sent = now - (this.sent.get(String(p.id)) || 0) < 8000;
          const where = p.priv ? 'private lobby' : `${esc(this.label(p.map))} #${p.lobby}`;
          const here = p.map === this.map && (this.net.code ? false : p.lobby === this.net.lobby && !p.priv);
          html += `<div class="lb-row"><div class="lb-info"><div class="lb-top"><span class="lb-name">${esc(p.name)}</span></div>
            <div class="lb-who">${where}</div></div>
            ${here ? '<span class="lb-here">Here</span>' : `<button data-act="invite" data-id="${esc(p.id)}"${sent ? ' disabled' : ''}>${sent ? 'Sent' : 'Invite'}</button>`}</div>`;
        }
        html += '</div>';
      }
    }
    if (this.note) html += `<p class="lb-note">${esc(this.note)}</p>`;
    const inp = this.el.querySelector('.lb-code input'), typed = inp?.value || '', focused = inp && document.activeElement === inp;
    this.el.innerHTML = html;
    const inp2 = this.el.querySelector('.lb-code input');
    if (inp2) { inp2.value = typed; if (focused) inp2.focus(); }
  }
}

/**
 * An invite from someone playing (server.js 'invite'): a toast with Join / dismiss, gone by
 * itself after a while. join(m): go where they are ({ map, lobby } or a private { map, code }).
 */
// (Y takes the newest invite: no need to let go of the mouse mid-game)
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyY' || e.repeat || e.target.closest?.('input, textarea')) return;
  const list = document.querySelectorAll('#invites .invite:not(.out)');
  list[list.length - 1]?.accept?.();
});
export function inviteToast(m, join) {
  let box = document.getElementById('invites');
  if (!box) { box = document.createElement('div'); box.id = 'invites'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'invite';
  t.innerHTML = `<div class="iv-text"><b>${esc(m.from)}</b> invited you to ${m.code ? 'a private lobby' : 'their lobby'}</div>
    <button class="iv-join">Join <kbd>Y</kbd></button><button class="iv-x" aria-label="Dismiss">✕</button>`;
  const gone = () => { t.classList.add('out'); t.accept = null; setTimeout(() => t.remove(), 250); };
  t.accept = () => { gone(); join(m); };
  t.querySelector('.iv-join').addEventListener('click', () => t.accept?.());
  t.querySelector('.iv-x').addEventListener('click', gone);
  box.appendChild(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(gone, 20000);
}
