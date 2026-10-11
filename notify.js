import { settingsExtras } from './settings.js';
/*
  Opting in to notifications: new skins (yours being ready) and new updates. The asking is
  websim's (its own dialog); the sending is server.js (/api/notify/sync, on every visit, sends
  whatever notices are owed). Two ways in: Settings -> Notifications (a two-way switch), and the
  Donate panel, right when a character's been asked for ("notify me when it's ready").
*/

const N = () => window.websim?.notifications;
const $ = (id) => document.getElementById(id);
let state = 'default';
const views = new Set(); // every control showing the state: redrawn when it changes

async function refresh() {
  try { state = (await N()?.getPermission())?.state || 'default'; } catch { /* unavailable */ }
  for (const v of views) v();
}
async function turnOn() {
  const r = await N()?.requestPermission().catch(() => null);
  state = r?.state || 'default';
  for (const v of views) v();
  return state;
}
async function turnOff() {
  const r = await N()?.revokePermission().catch(() => null);
  state = r?.state || state;
  for (const v of views) v();
}

export function initNotify({ username }) {
  // (this visit: anything owed goes out now - and the server learns who we are)
  if (username) fetch('/api/notify/sync', { method: 'POST' }).catch(() => {});
  if (!N()) return;

  // Settings: one switch that always says how it really is
  settingsExtras.push((el) => {
    const h = document.createElement('h3');
    h.textContent = 'Notifications';
    const box = document.createElement('div');
    box.className = 'set';
    const row = document.createElement('label');
    row.className = 'row';
    const name = document.createElement('span');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'sw';
    row.append(name, input);
    box.appendChild(row);
    el.append(h, box);
    let note = '';
    const draw = () => {
      input.checked = state === 'granted';
      name.textContent = 'New skins & updates' + (note ? ` (${note})` : '');
    };
    views.add(draw);
    draw();
    input.addEventListener('keydown', (e) => { if (e.code !== 'Escape') e.stopPropagation(); });
    input.addEventListener('change', async () => {
      note = '';
      if (input.checked) {
        const s = await turnOn();
        note = s === 'denied' ? 'declined' : s !== 'granted' ? (username ? 'not now' : 'sign in first') : '';
      } else await turnOff();
      draw();
    });
  });

  // Donate: right after asking for a character, the obvious moment to offer it
  const btn = $('donorNotify');
  if (btn) {
    const draw = () => { btn.hidden = !username || state === 'granted'; };
    views.add(draw);
    btn.addEventListener('click', async () => {
      const s = await turnOn();
      const msg = $('donorMsg');
      if (msg) msg.textContent = s === 'granted' ? "You'll get a notification as soon as it's in." : s === 'denied' ? 'Notifications stay off.' : '';
    });
  }
  refresh();
}
