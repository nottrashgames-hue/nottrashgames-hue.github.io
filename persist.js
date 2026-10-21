/*
  Bloodline save persistence.

  The game keeps everything it saves - the wallet, the outfit, the settings, and the VR height
  calibration (vrStandY) - in the browser's localStorage. On a headset that storage can be
  evicted, and it is never a file you can hold on to. So this mirrors the whole save into a real
  JSON file in the app's own storage (the Origin Private File System, a file called
  bloodline-save.json) and, if localStorage ever comes up empty, restores it from that file.

  It never changes how the game saves: the game still reads and writes localStorage
  synchronously. This only keeps a copy behind it. The game does NOT wait on it: window.__persistReady
  resolves at once, and a restore happens behind the game. Nothing here can block a boot.
*/
(function () {
  var FILE = 'bloodline-save.json';

  function snapshot() {
    var data = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        data[k] = localStorage.getItem(k);
      }
    } catch (e) { /* no storage: nothing to do */ }
    return data;
  }
  function isEmpty(d) { return !d || Object.keys(d).length === 0; }
  function dir() {
    try { return navigator.storage && navigator.storage.getDirectory ? navigator.storage.getDirectory() : null; }
    catch (e) { return null; }
  }
  function readFile() {
    return Promise.resolve(dir()).then(function (d) {
      if (!d) return null;
      return d.getFileHandle(FILE).then(function (fh) {
        return fh.getFile().then(function (f) { return f.text(); });
      }).then(function (t) { return JSON.parse(t); }).catch(function () { return null; });
    }).catch(function () { return null; });
  }
  function writeFile(obj) {
    return Promise.resolve(dir()).then(function (d) {
      if (!d) return false;
      return d.getFileHandle(FILE, { create: true }).then(function (fh) {
        return fh.createWritable();
      }).then(function (w) {
        return w.write(JSON.stringify(obj)).then(function () { return w.close(); });
      }).then(function () { return true; }).catch(function () { return false; });
    }).catch(function () { return false; });
  }

  // (decided now, before the game gets a chance to write anything)
  var wasEmpty = isEmpty(snapshot());
  var last = null;

  function backup() {
    var data = snapshot();
    if (isEmpty(data)) return Promise.resolve();
    var body = JSON.stringify(data);
    if (body === last) return Promise.resolve();
    last = body;
    return writeFile({ v: 1, app: 'bloodline', at: Date.now(), data: data });
  }

  // ask the OS/browser not to evict the site's data
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) {}

  function startMirroring() {
    last = JSON.stringify(snapshot());
    setInterval(backup, 3000);
    addEventListener('pagehide', function () { backup(); }, true);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') backup(); });
    window.__bloodlineBackup = backup;
  }

  // THE GAME IS NEVER GATED ON STORAGE. This is deliberate, and it is the whole point of this file.
  //
  // The game used to wait on window.__persistReady before main.js would load, so that a restore
  // could finish first. That is a trap: a promise that never settles is NOT caught by .catch, and
  // the first storage touch on a headset can hang indefinitely - so the game never started and the
  // page sat on the loading screen forever. A save file is not worth an unstartable game.
  //
  // So the offer is always resolved immediately. Mirroring starts at once, and the restore runs
  // behind the game: if it lands in time the first frame reads the saved state (localStorage is
  // read synchronously by the game, and this callback runs before the first frame is drawn); if it
  // never lands, the game still runs with whatever localStorage already had. Nothing here can
  // block the boot, whatever the browser does.
  var resolve;
  var gate = new Promise(function (r) { resolve = r; });

  try { startMirroring(); } catch (e) { /* mirroring is a nicety: never let it stop the game */ }
  resolve();

  // (restore is best-effort and strictly after the game is free to start: no reload, no waiting,
  //  no loop - a restore that reloads is exactly the infinite-loading bug we are removing)
  try {
    readFile().then(function (saved) {
      if (wasEmpty && saved && saved.data && !isEmpty(saved.data)) {
        for (var k in saved.data) {
          if (Object.prototype.hasOwnProperty.call(saved.data, k)) { try { localStorage.setItem(k, saved.data[k]); } catch (e) {} }
        }
        // (record that a restore happened, so a save file is not mistaken for a live session)
        backup();
      }
    }).catch(function () {});
  } catch (e) {}

  window.__persistReady = gate;
})();
