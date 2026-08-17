// Bridge the native auto-updater into the sandboxed renderer. contextIsolation
// is on, so window.skrimpadUpdater is the ONLY channel the page gets — it can
// ask main to check / install / roll back, and subscribe to updater events.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('skrimpadUpdater', {
  check: () => ipcRenderer.invoke('updater:check'),
  install: () => ipcRenderer.invoke('updater:install'),
  revert: (good) => ipcRenderer.invoke('updater:revert', good),
  on: (cb) => ipcRenderer.on('updater:event', (_e, evt, info) => { try { cb(evt, info); } catch (e) {} }),
});

// The Bluetooth scan, as it happens. main.js suppresses Electron's own device
// chooser (this app knows which controller it is looking for), which made the
// whole scan invisible — so it reports each tick here instead, and the MIDI
// window turns it into a sentence. A scan you can watch is the difference
// between "it is not working" and "it can see the controller but the name does
// not match".
contextBridge.exposeInMainWorld('skrimpadBluetooth', {
  onScan: (cb) => ipcRenderer.on('bt:scan', (_e, info) => { try { cb(info); } catch (e) {} }),
});
