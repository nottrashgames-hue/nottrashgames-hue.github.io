/*
  Touch controls (phones, tablets). Only ever built when main.js decides the device is touch
  first, so a mouse-and-keyboard PC never sees any of it.

    left half of the screen   a floating stick: put a thumb down anywhere, drag to walk, push
                              to the rim to run (at the wheel: steer + gas / brake)
    right half                drag to look, pinch to zoom
    the pad (bottom right)    attack (hold: wind up / full auto; drag it to aim while firing),
                              jump (driving: handbrake), aim, crouch, use, kick - plus reload
                              and throw (hold to aim, let go) when you've got something to use
    top right                 chat, emotes, and ☰ for everything else

  main.js owns every system; it hands in `G`, a small set of verbs and a state() snapshot.
*/
import { EMOTES } from './emotes.js';

export function initTouch(G) {
  const $ = (id) => document.getElementById(id);
  const ui = $('mobile-ui'), canvas = G.canvas;
  const stick = $('m-stick'), knob = $('m-knob');
  const pad = $('m-pad'), drawer = $('m-drawer'), emotes = $('m-emotes');
  const menuBtn = $('m-menu'), promptEl = $('prompt'), nadeEl = $('nades');
  const btn = (m) => pad.querySelector(`[data-m="${m}"]`);
  const B = { attack: btn('attack'), jump: btn('jump'), aim: btn('aim'), crouch: btn('crouch'), use: btn('use'), kick: btn('kick'), reload: btn('reload'), nade: btn('nade'), cycle: btn('cycle') };

  // ---- sheets: the ☰ drawer and the emote picker ----
  emotes.querySelector('.m-grid').innerHTML = EMOTES.map(({ id, label }) => `<button type="button" data-emote="${id}">${label}</button>`).join('');
  const sheetsOpen = () => !drawer.hidden || !emotes.hidden;
  function closeSheets() {
    drawer.hidden = emotes.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.classList.remove('on'); $('m-emote').classList.remove('on');
  }
  function toggleSheet(el, b) {
    const open = el.hidden;
    closeSheets();
    if (!open) return;
    el.hidden = false;
    b.classList.add('on');
    if (el === drawer) { menuBtn.setAttribute('aria-expanded', 'true'); drawerLabels(); }
  }
  menuBtn.addEventListener('click', () => { if (!G.blocked()) toggleSheet(drawer, menuBtn); });
  $('m-emote').addEventListener('click', () => { if (!G.blocked()) toggleSheet(emotes, $('m-emote')); });
  $('m-chat').addEventListener('click', () => { if (G.blocked()) return; closeSheets(); reset(); G.openChat(); });
  emotes.addEventListener('click', (e) => {
    const b = e.target.closest('[data-emote]');
    if (!b) return;
    closeSheets();
    G.emote(b.dataset.emote);
  });
  if (!G.canSpawn) $('m-spawn').hidden = true;
  const fsOk = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  if (!fsOk) $('m-full').hidden = true;
  const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function fullscreen() {
    if (isFull()) { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); return; }
    const el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
    Promise.resolve(req?.call(el, { navigationUI: 'hide' })).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  }
  function drawerLabels() {
    const s = G.state();
    $('m-camera').textContent = s.fp ? 'Third person' : 'First person';
    $('m-full').textContent = isFull() ? 'Exit fullscreen' : 'Fullscreen';
    $('m-cycle').hidden = s.nadeKinds < 2;
  }
  drawer.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (!m || G.blocked()) return;
    // (view toggles keep the drawer open: you see what changed; actions close it)
    if (m === 'fullscreen') { fullscreen(); setTimeout(drawerLabels, 300); return; }
    if (m === 'camera') { G.toggleFP(); drawerLabels(); return; }
    if (m === 'cycle') { G.cycleNade(); return; }
    closeSheets();
    const act = { talk: G.talk, shove: G.shove, grab: G.grab, throw: G.throwWeapon, sit: G.sit, lie: () => G.posture('lie'),
      ragdoll: G.ragdoll, spawn: G.openSpawn, sandbox: G.openSandbox, 'game-menu': G.openMenu }[m];
    act?.();
  });

  // ---- the stick: floats to wherever the left thumb lands ----
  let stickId = null, sx = 0, sy = 0, R = 56;
  function stickAt(x, y) {
    R = stick.offsetWidth / 2 || 56;
    // (kept wholly on screen)
    sx = Math.max(R + 6, Math.min(innerWidth / 2 - R, x));
    sy = Math.max(R + 6, Math.min(innerHeight - R - 6, y));
    stick.style.left = sx + 'px'; stick.style.top = sy + 'px';
  }
  function stickHome() {
    stick.style.left = stick.style.top = '';
    knob.style.transform = '';
    stick.classList.remove('live', 'run');
  }
  function stickMove(x, y) {
    let dx = x - sx, dy = y - sy;
    const d = Math.hypot(dx, dy);
    // dragged well past the rim: the stick follows the thumb
    if (d > R * 1.6) { const k = (d - R * 1.6) / d; sx += dx * k; sy += dy * k; stick.style.left = sx + 'px'; stick.style.top = sy + 'px'; dx = x - sx; dy = y - sy; }
    const l = Math.min(R, Math.hypot(dx, dy)), a = Math.atan2(dy, dx);
    const kx = Math.cos(a) * l, ky = Math.sin(a) * l;
    knob.style.transform = `translate(${kx}px, ${ky}px)`;
    const m = l / R, dead = 0.14;
    const k = m < dead ? 0 : (m - dead) / (1 - dead) / (m || 1);
    const run = m > 0.86;
    G.setMove(kx / R * k, -ky / R * k, run);
    stick.classList.toggle('run', run);
  }
  function stickEnd() { stickId = null; G.setMove(0, 0, false); stickHome(); }

  // ---- looking (and pinching) on the rest of the screen ----
  const looks = new Map(); // pointerId -> { x, y }
  let pinch = 0;
  const pinchDist = () => { const [a, b] = [...looks.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || G.blocked()) return;
    e.preventDefault();
    const left = e.clientX < innerWidth * 0.45 && e.clientY > 70;
    if (left && stickId === null) {
      stickId = e.pointerId;
      stick.classList.add('live');
      stickAt(e.clientX, e.clientY);
      stickMove(e.clientX, e.clientY);
    } else {
      if (sheetsOpen()) { closeSheets(); return; }
      looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (looks.size === 2) pinch = pinchDist();
    }
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickId) { stickMove(e.clientX, e.clientY); return; }
    const p = looks.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (looks.size >= 2) {
      const d = pinchDist();
      if (pinch > 20 && d > 20) G.zoom(pinch / d);
      pinch = d;
      return;
    }
    G.look(dx, dy);
  });
  const lookEnd = (e) => {
    if (e.pointerId === stickId) { stickEnd(); return; }
    looks.delete(e.pointerId);
    pinch = looks.size === 2 ? pinchDist() : 0;
  };
  canvas.addEventListener('pointerup', lookEnd);
  canvas.addEventListener('pointercancel', lookEnd);

  // ---- the pad ----
  // a held button: start on touch, end on lift; dragging the same finger looks around
  const held = new Map(); // button -> { id, x, y, end }
  function hold(b, start, end, drag = true) {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (G.blocked() || held.has(b)) return;
      b.setPointerCapture?.(e.pointerId);
      held.set(b, { id: e.pointerId, x: e.clientX, y: e.clientY, end, drag });
      b.classList.add('pressed');
      start();
    });
    b.addEventListener('pointermove', (e) => {
      const h = held.get(b);
      if (!h || h.id !== e.pointerId || !h.drag) return;
      G.look(e.clientX - h.x, e.clientY - h.y);
      h.x = e.clientX; h.y = e.clientY;
    });
    const up = (e) => {
      const h = held.get(b);
      if (!h || h.id !== e.pointerId) return;
      held.delete(b);
      b.classList.remove('pressed');
      h.end?.();
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  const tap = (b, fn) => hold(b, fn, null, false);
  hold(B.attack, G.attackDown, G.attackUp);
  hold(B.nade, G.nadeDown, G.nadeUp);
  hold(B.jump, () => { if (G.state().driver) G.handbrake(true); else G.jump(); }, () => G.handbrake(false), false);
  tap(B.aim, () => G.setAim(!G.state().aim));
  tap(B.crouch, () => G.posture('crouch'));
  tap(B.use, G.use);
  tap(B.kick, G.kick);
  tap(B.reload, G.reload);
  tap(B.cycle, G.cycleNade);
  // the "E  Pick up …" prompt is a button too, and the throwables readout cycles them
  promptEl.addEventListener('pointerdown', (e) => { e.preventDefault(); if (!G.blocked()) G.use(); });
  nadeEl.addEventListener('pointerdown', (e) => { e.preventDefault(); if (!G.blocked()) G.cycleNade(); });

  /** Let go of everything (a menu opened, the tab went away). */
  function reset() {
    if (stickId !== null) stickEnd();
    looks.clear(); pinch = 0;
    for (const [b, h] of held) { b.classList.remove('pressed'); h.end?.(); }
    held.clear();
  }
  addEventListener('visibilitychange', () => { if (document.hidden) { reset(); closeSheets(); } });
  addEventListener('blur', reset);

  // ---- each frame: the pad shows what you can do right now ----
  let wasBlocked = null;
  const last = {};
  const cls = (k, on) => { if (last[k] !== on) { last[k] = on; ui.classList.toggle(k, on); } };
  const text = (k, el, t) => { if (last[k] !== t) { last[k] = t; el.textContent = t; } };
  function update() {
    const blocked = G.blocked();
    if (blocked !== wasBlocked) {
      wasBlocked = blocked;
      document.body.classList.toggle('mobile-blocked', blocked);
      if (blocked) { reset(); closeSheets(); }
    }
    if (blocked) return;
    const s = G.state();
    if (s.aim && (s.car || s.dead)) G.setAim(false);
    cls('car', s.car); cls('dead', s.dead); cls('armed', s.armed); cls('nade', s.nade && !s.car); cls('nades2', s.nadeKinds > 1 && !s.car);
    cls('aiming', s.aim); cls('crouched', s.crouch); cls('prompt', s.prompt);
    text('atk', B.attack, s.armed ? `Fire\n${s.ammo}` : s.grab || s.carry ? 'Throw' : s.melee ? 'Swing' : 'Punch');
    text('use', B.use, s.car ? 'Exit' : s.prompt ? 'Use' : s.grab ? 'Let go' : s.carry || s.armed || s.melee ? 'Drop' : 'Use');
    text('jmp', B.jump, s.driver ? 'Brake' : 'Jump');
    text('crh', B.crouch, s.posed ? 'Stand' : 'Crouch');
    text('nd', B.nade, s.nadeName || 'Throw');
  }
  closeSheets();
  return { update, reset, closeSheets };
}
