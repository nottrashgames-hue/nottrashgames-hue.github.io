/*
  Bloodline save persistence.

  The game keeps everything it saves - the wallet, the outfit, the settings, and the VR height
  calibration (vrStandY) - in the browser's localStorage. On a headset that storage can be
  evicted, and it is never a file you can hold on to. So this mirrors the whole save into a real
  JSON file in the app's own storage (the Origin Private File System, a file called
  bloodline-save.json) and, if localStorage ever comes up empty, restores it from that file.

  It never changes how the game saves: the game still reads and writes localStorage
  synchronously. This only keeps a copy behind it. The game waits on window.__persistReady so it
  can never start (and overwrite the backup with fresh defaults) before the restore has run.
*/
(function () {
  var FILE = 'bloodline-save.json';
  var RELOADED = 'bl-save-restored';

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

  // The whole game is gated on this promise (index.html imports main.js from it). A promise that
  // merely never settles is NOT caught by .catch - so if the storage call hangs (the first OPFS
  // touch can, especially cold, and on the headset it is the *first* thing the page does), the
  // game would never start and the page would sit loading forever. Resolve once, whatever happens:
  // a late restore has already had its chance by the time this fires.
  function startOnce() {
    var done = false;
    return function () {
      if (done) return;
      done = true;
      try { startMirroring(); } catch (e) { /* mirroring is a nicety: never let it stop the game */ }
      resolve();
    };
  }
  var resolve;
  var gate = new Promise(function (r) { resolve = r; });
  var ready = startOnce();

  // (a save file that has not answered in a few seconds is not coming: start the game anyway)
  setTimeout(ready, 4000);

  readFile().then(function (saved) {
    if (wasEmpty && saved && saved.data && !isEmpty(saved.data)) {
      for (var k in saved.data) {
        if (Object.prototype.hasOwnProperty.call(saved.data, k)) { try { localStorage.setItem(k, saved.data[k]); } catch (e) {} }
      }
      // (if the write took, put the game in front of the restored save once)
      if (!isEmpty(snapshot())) {
        var already = false;
        try { already = sessionStorage.getItem(RELOADED) === '1'; } catch (e) {}
        if (!already) {
          try { sessionStorage.setItem(RELOADED, '1'); } catch (e) {}
          location.reload();
          return; // (the page is going away; the game must not start yet)
        }
      }
    }
    ready();
  }).catch(function () { ready(); });

  window.__persistReady = gate;
})();
