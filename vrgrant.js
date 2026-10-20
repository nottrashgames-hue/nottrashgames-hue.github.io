// WebXR navigation: a page loaded while still in VR (switching maps) is granted a session to carry on in.
// (listened for as early as possible: the event can fire before the game's modules have loaded)
//
// The game has to be able to ask later whether a grant *already* happened, not just wait for the
// event: the headset fires sessiongranted while our modules are still downloading, so by the time
// the VR button is built the event is long past. Holding the grant as a flag - plus handing it to
// anyone who asks - is what makes a warm launch still come up in VR instead of sitting on the
// page. `consume()` reads it once (the caller starts a session off it); a later grant still fires
// the event for anyone listening.
window.__vrGranted = false;
window.__vrGrant = null;
navigator.xr?.addEventListener?.('sessiongranted', () => {
  window.__vrGranted = true;
  // (the granted session, kept so a late caller can adopt it rather than asking again)
  try { window.__vrGrant = navigator.xr.getSession?.() || null; } catch (e) { window.__vrGrant = null; }
  window.dispatchEvent(new Event('vr-granted'));
});
// Returning whether a grant happened before this call, so a caller can act on it immediately.
window.__vrTakeGrant = function () {
  const had = window.__vrGranted;
  window.__vrGranted = false;
  const s = window.__vrGrant;
  window.__vrGrant = null;
  return had ? (s || true) : false;
};
