/*
  Saved progress: the wallet and the outfit. Always kept in localStorage; for a signed-in
  player also on the server (/api/profile), so it follows them to any device. On load the
  server copy wins if there is one; otherwise the local one is uploaded.
*/

const LOOK_KEY = 'look';
let online = false, timer = 0, pending = null;

export function localLook() {
  try { return JSON.parse(localStorage.getItem(LOOK_KEY) || 'null'); } catch { return null; }
}

/** { cash, look } from the server (null if signed out / nothing saved / offline). */
export async function loadProfile() {
  try {
    const r = await fetch('/api/profile');
    if (!r.ok) return null;
    online = true;
    const j = await r.json();
    return j.found ? { cash: j.cash, look: j.look, updated: +j.updated || 0 } : { fresh: true };
  } catch { return null; }
}

function flush(keepalive = false) {
  clearTimeout(timer); timer = 0;
  if (!pending || !online) return;
  const body = JSON.stringify(pending);
  pending = null;
  fetch('/api/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive }).catch(() => {});
}

/** Remember the current state (locally at once, on the server a moment later). */
export function saveProfile(cash, look) {
  localStorage.setItem('cash', String(cash));
  if (look) { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); localStorage.setItem('lookT', String(Date.now())); }
  pending = { cash, look };
  if (!online) return;
  if (!timer) timer = setTimeout(() => flush(), 2500);
}
/** When this device last saved its outfit (0: never). */
export function localLookTime() { return +localStorage.getItem('lookT') || 0; }
export function goOnline() { online = true; }

addEventListener('pagehide', () => flush(true));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
