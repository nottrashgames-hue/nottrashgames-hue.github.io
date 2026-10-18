/*
  A "Multiplayer" section on the settings panel (settings.js `settingsExtras`), showing the
  room's status and offering a name and a mic switch. Built by voice.js, which is the one
  module the game hands both the session and itself to.

  In a headset the panel is a desktop thing: there, multiplayer is simply the Arena (you join
  on the way in), and voice follows that - this is for the desktop copy and for testing.
*/

import { settingsExtras, buildSettings } from '../settings.js';

export function mpPanel({ mp, voice }) {
  if (!mp || !voice) return;

  // one listener, refreshing whichever panel is on screen (the panel is rebuilt on every open)
  let refresh = () => {};
  mp.net?.on?.('status', () => refresh());

  settingsExtras.push((el) => {
    const h = document.createElement('h3');
    h.textContent = 'Multiplayer';
    el.appendChild(h);

    const box = document.createElement('div');
    box.className = 'set';
    el.appendChild(box);

    // ---- where we are ----
    const status = document.createElement('div');
    status.className = 'row';
    const sLabel = document.createElement('span');
    sLabel.textContent = 'Status';
    const sValue = document.createElement('span');
    status.append(sLabel, sValue);
    box.appendChild(status);

    // ---- our name ----
    const nameRow = document.createElement('label');
    nameRow.className = 'row';
    const nLabel = document.createElement('span');
    nLabel.textContent = 'Name';
    const nInput = document.createElement('input');
    nInput.type = 'text';
    nInput.maxLength = 16;
    nInput.value = (mp.net && mp.net.name) || '';
    nInput.style.cssText = 'width:9em';
    nInput.addEventListener('change', () => { mp.net.setName(nInput.value); });
    nameRow.append(nLabel, nInput);
    box.appendChild(nameRow);

    // ---- the mic ----
    const micRow = document.createElement('div');
    micRow.className = 'row';
    const mLabel = document.createElement('span');
    mLabel.textContent = 'Voice chat';
    const mic = document.createElement('button');
    mic.className = 'reset';
    mic.addEventListener('click', async () => {
      mic.textContent = '...';
      await voice.setEnabled(!voice.enabled);
      show();
    });
    micRow.append(mLabel, mic);
    box.appendChild(micRow);

    // ---- what to do with it ----
    const hint = document.createElement('div');
    hint.className = 'row';
    hint.style.opacity = '.65';
    hint.textContent = 'Multiplayer is the Arena: pick "Multiplayer Arena" from the menu board. Everyone on that map is in the same room.';
    box.appendChild(hint);

    function show() {
      const net = mp.net || {};
      const n = mp.players ? mp.players.size : 0;
      sValue.textContent =
        net.status === 'online' ? `Online - ${n} other ${n === 1 ? 'player' : 'players'} here`
          : net.status === 'connecting' ? 'Connecting...'
            : net.status === 'offline' ? 'No relay (retrying...)' : 'Off';
      mic.textContent = voice.enabled ? (voice.error || 'On') : 'Off';
    }
    refresh = show;
    show();
  });

  // (the settings panel is built once at startup, before this module has a voice object to
  //  show: build it again so the section is there when the panel is first opened)
  const panel = document.getElementById('settings');
  if (panel) buildSettings(panel);
}
