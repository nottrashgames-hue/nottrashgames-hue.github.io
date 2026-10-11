// WebXR navigation: a page loaded while still in VR (switching maps) is granted a session to carry on in.
// (listened for as early as possible: the event can fire before the game's modules have loaded)
window.__vrGranted = false;
navigator.xr?.addEventListener?.('sessiongranted', () => {
  window.__vrGranted = true;
  window.dispatchEvent(new Event('vr-granted'));
});
